// ═══ عملیات برنامهٔ درسی — نسخه‌ها، چرخهٔ حیات، دروس، قواعد ═══
package admin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/session"
)

func curriculumAuditValues(action string, entityID int64, details any) (string, string, string) {
	raw, _ := json.Marshal(details)
	iso := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	h := sha256.Sum256([]byte("|" + action + "|" + strconv.FormatInt(entityID, 10) + "|" + iso))
	return string(raw), iso, hex.EncodeToString(h[:])
}

func curriculumAuditTx(ctx context.Context, tx pgx.Tx, userID int64, action string, entityID int64, details any) {
	raw, _, hash := curriculumAuditValues(action, entityID, details)
	var prev string
	_ = tx.QueryRow(ctx, `select coalesce(hash,'') from audit_logs order by id desc limit 1`).Scan(&prev)
	_, _ = tx.Exec(ctx, `insert into audit_logs ("actorUserId", action, "entityType", "entityId", details, "prevHash", hash)
		values ($1,$2,'curriculum',$3,$4,$5,$6)`, userID, action, entityID, raw, prev, hash)
}

func (s *Service) curriculumAudit(ctx context.Context, userID int64, action string, entityID int64, details any) {
	raw, _, hash := curriculumAuditValues(action, entityID, details)
	var prev string
	_ = s.DB.Pool.QueryRow(ctx, `select coalesce(hash,'') from audit_logs order by id desc limit 1`).Scan(&prev)
	_, _ = s.DB.Pool.Exec(ctx, `insert into audit_logs ("actorUserId", action, "entityType", "entityId", details, "prevHash", hash)
		values ($1,$2,'curriculum',$3,$4,$5,$6)`, userID, action, entityID, raw, prev, hash)
}

// ── خواندن ──

// GetCurriculumOverview فهرست رشته‌ها/نسخه‌ها/گرایش‌ها (پورت read.ts).
func (s *Service) GetCurriculumOverview(ctx context.Context, user *session.User, cookie string) (*CurriculumOverview, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := &CurriculumOverview{Majors: []map[string]any{}, Versions: []CurriculumVersionRow{}, Tracks: []map[string]any{}}
	scope := ""
	args := []any{}
	if uniID != nil {
		scope = ` where (m."universityId" = $1 or m."universityId" is null)`
		args = append(args, *uniID)
	}
	mrows, err := s.DB.Pool.Query(ctx, `
		select m.id, m."majorCode", m.name, m."degreeLevelId", d.title, d.code, d."termCount", d."isGraduate"
		  from majors m left join degree_level_configs d on d.id = m."degreeLevelId"`+scope+`
		 order by m.name`, args...)
	if err == nil {
		for mrows.Next() {
			r := map[string]any{}
			var code, dtitle, dcode *string
			var termCount, isGraduate *int
			var id, degID int64
			var name string
			if err := mrows.Scan(&id, &code, &name, &degID, &dtitle, &dcode, &termCount, &isGraduate); err == nil {
				r["id"] = id
				r["code"] = code
				r["name"] = name
				r["degreeLevelId"] = degID
				r["degreeTitle"] = dtitle
				r["degreeCode"] = dcode
				r["degreeTermCount"] = termCount
				r["degreeIsGraduate"] = isGraduate
				out.Majors = append(out.Majors, r)
			}
		}
		mrows.Close()
	}
	vscope := ""
	vargs := []any{}
	if uniID != nil {
		vscope = ` where (v."universityId" = $1 or v."universityId" is null)`
		vargs = append(vargs, *uniID)
	}
	vrows, err := s.DB.Pool.Query(ctx, `
		select v.id, v."majorId", v."degreeLevelId", v."trackId", v."versionCode", v.title, v.status,
		       v."entryYearFrom", v."entryYearTo", coalesce(v."totalRequiredUnits",'0')::text,
		       (select count(*)::int from curriculum_courses cc where cc."curriculumVersionId" = v.id)
		  from curriculum_versions v`+vscope+`
		 order by v."majorId", v."entryYearFrom" desc, v."versionCode" desc`, vargs...)
	if err != nil {
		return out, nil
	}
	for vrows.Next() {
		var r CurriculumVersionRow
		if err := vrows.Scan(&r.ID, &r.MajorID, &r.DegreeLevelID, &r.TrackID, &r.VersionCode, &r.Title, &r.Status,
			&r.EntryYearFrom, &r.EntryYearTo, &r.TotalRequiredUnits, &r.CourseCount); err == nil {
			out.Versions = append(out.Versions, r)
		}
	}
	vrows.Close()
	trows, err := s.DB.Pool.Query(ctx, `select id, code, title, "majorId" from curriculum_tracks order by id`)
	if err == nil {
		for trows.Next() {
			r := map[string]any{}
			var id, majorID int64
			var code, title *string
			if err := trows.Scan(&id, &code, &title, &majorID); err == nil {
				r["id"] = id
				r["code"] = code
				r["title"] = title
				r["majorId"] = majorID
				out.Tracks = append(out.Tracks, r)
			}
		}
		trows.Close()
	}
	return out, nil
}

// GetCurriculumDetail جزئیات کامل نسخه + چک‌ها (پورت read.ts/version detail).
func (s *Service) GetCurriculumDetail(ctx context.Context, versionID int64) (*CurriculumVersionDetail, error) {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return nil, err
	}
	courses, err := s.loadCurriculumCourses(ctx, versionID)
	if err != nil {
		return nil, err
	}
	rules, err := s.loadCurriculumRules(ctx, versionID)
	if err != nil {
		return nil, err
	}
	checks, err := s.curriculumChecks(ctx, versionID, v, courses, rules)
	if err != nil {
		return nil, err
	}
	blocked := false
	for _, c := range checks {
		if c.Severity == "ERROR" {
			blocked = true
			break
		}
	}
	detail := &CurriculumVersionDetail{
		Courses: courses, Rules: rules, Checks: checks, Blocked: blocked,
	}
	detail.Version = CurriculumVersionRow{
		ID: v["id"].(int64), MajorID: v["majorId"].(int64), DegreeLevelID: v["degreeLevelId"].(int64),
		TrackID: v["trackId"].(*int64), VersionCode: v["versionCode"].(string), Title: v["title"].(string),
		Status: v["status"].(string), EntryYearFrom: v["entryYearFrom"].(int),
		EntryYearTo: v["entryYearTo"].(*int), TotalRequiredUnits: v["totalRequiredUnits"].(string),
		MaxUnitsPerTerm: v["maxUnitsPerTerm"].(*int),
	}
	arows, err := s.DB.Pool.Query(ctx, `
		select a.id, a."approvalType", a."fromStatus", a."toStatus", a."decisionNote", a."approvedAt"::text,
		       coalesce(u."firstName" || ' ' || u."lastName",'—')
		  from curriculum_approvals a left join users u on u.id = a."approvedByUserId"
		 where a."curriculumVersionId" = $1 order by a."approvedAt" desc, a.id desc`, versionID)
	if err == nil {
		for arows.Next() {
			var r CurriculumApprovalRow
			if err := arows.Scan(&r.ID, &r.ApprovalType, &r.FromStatus, &r.ToStatus, &r.DecisionNote, &r.ApprovedAt, &r.ApprovedBy); err == nil {
				detail.Approvals = append(detail.Approvals, r)
			}
		}
		arows.Close()
	}
	if detail.Approvals == nil {
		detail.Approvals = []CurriculumApprovalRow{}
	}
	return detail, nil
}

// curriculumChecks ساخت ورودی اعتبارسنج و اجرای چک‌ها.
func (s *Service) curriculumChecks(ctx context.Context, versionID int64, v map[string]any, courses []CurriculumCourseRow, rules []CurriculumRuleRow) ([]CurriculumCheckResult, error) {
	degID := v["degreeLevelId"].(int64)
	var degCode *string
	var degTitle *string
	var degMax *int
	var degGrad *int
	_ = s.DB.Pool.QueryRow(ctx, `select code, title, "maxUnitsPerTerm", "isGraduate" from degree_level_configs where id = $1`, degID).
		Scan(&degCode, &degTitle, &degMax, &degGrad)
	maxUnits := v["maxUnitsPerTerm"].(*int)
	minRoleCounts := map[string]int{"GENERAL": 1, "CORE": 1, "MAJOR": 1}
	if degGrad != nil && *degGrad == 1 {
		minRoleCounts["THESIS"] = 1
	} else if degCode != nil && (strings.Contains(*degCode, "MASTER") || strings.Contains(*degCode, "PHD")) {
		minRoleCounts["THESIS"] = 1
	} else if degTitle != nil && (strings.Contains(*degTitle, "ارشد") || strings.Contains(*degTitle, "دکترا")) {
		minRoleCounts["THESIS"] = 1
	}
	if maxUnits == nil && degMax != nil {
		maxUnits = degMax
	}
	bank := map[string]bool{}
	brows, err := s.DB.Pool.Query(ctx, `select code from courses`)
	if err == nil {
		for brows.Next() {
			var code string
			if brows.Scan(&code) == nil {
				bank[code] = true
			}
		}
		brows.Close()
	}
	total, _ := strconv.ParseFloat(v["totalRequiredUnits"].(string), 64)
	in := curriculumCheckInput{
		TotalRequiredUnits: total,
		MaxUnitsPerTerm:    maxUnits,
		TrackID:            v["trackId"].(*int64),
		Courses:            courses,
		Rules:              rules,
		ExistingCodes:      bank,
		MinRoleCounts:      minRoleCounts,
		MinRoleUnits:       ParseRoleUnitTargets(v["minRoleUnits"]),
	}
	return ValidateCurriculumCore(in), nil
}

// RunCurriculumChecks اعتبارسنجی بدون تغییر وضعیت.
func (s *Service) RunCurriculumChecks(ctx context.Context, versionID int64) ([]CurriculumCheckResult, bool, error) {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return nil, false, err
	}
	courses, err := s.loadCurriculumCourses(ctx, versionID)
	if err != nil {
		return nil, false, err
	}
	rules, err := s.loadCurriculumRules(ctx, versionID)
	if err != nil {
		return nil, false, err
	}
	checks, err := s.curriculumChecks(ctx, versionID, v, courses, rules)
	blocked := false
	for _, c := range checks {
		if c.Severity == "ERROR" {
			blocked = true
			break
		}
	}
	return checks, blocked, err
}

// ── نسخه‌ها ──

type CurriculumCreateInput struct {
	MajorID            int64    `json:"majorId"`
	DegreeLevelID      *int64   `json:"degreeLevelId"`
	TrackID            *int64   `json:"trackId"`
	VersionCode        string   `json:"versionCode"`
	Title              string   `json:"title"`
	EntryYearFrom      int      `json:"entryYearFrom"`
	EntryYearTo        *int     `json:"entryYearTo"`
	TotalRequiredUnits *float64 `json:"totalRequiredUnits"`
	MaxUnitsPerTerm    *int     `json:"maxUnitsPerTerm"`
	CloneFromID        *int64   `json:"cloneFromId"`
}

func (s *Service) curriculumDeepCopy(ctx context.Context, tx pgx.Tx, fromID, toID int64) error {
	if _, err := tx.Exec(ctx, `
		insert into curriculum_courses ("curriculumVersionId","courseId","roleType",units,"theoryUnits","practicalUnits",
		                               "isRequired","isElective","isGraduationRequired","recommendedSemester",
		                               "minGrade","autoCorequisiteAllowed")
		select $2,"courseId","roleType",units,"theoryUnits","practicalUnits","isRequired","isElective",
		       "isGraduationRequired","recommendedSemester","minGrade","autoCorequisiteAllowed"
		  from curriculum_courses where "curriculumVersionId" = $1`, fromID, toID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		insert into course_rules ("courseId","syllabusId","ruleType","logicTree","customPassingGrade")
		select "courseId",$2,"ruleType","logicTree","customPassingGrade" from course_rules where "syllabusId" = $1`, fromID, toID)
	return err
}

func (s *Service) CreateCurriculumVersion(ctx context.Context, user *session.User, cookie string, in CurriculumCreateInput) (int64, string, error) {
	var majorName string
	var majorDeg *int64
	if err := s.DB.Pool.QueryRow(ctx, `select name, "degreeLevelId" from majors where id = $1`, in.MajorID).Scan(&majorName, &majorDeg); err != nil {
		return 0, "", errors.New("رشتهٔ انتخابی یافت نشد.")
	}
	deg := in.DegreeLevelID
	if deg == nil {
		deg = majorDeg
	}
	code := strings.TrimSpace(in.VersionCode)
	if code == "" {
		return 0, "", errors.New("کد نسخه الزامی است.")
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = fmt.Sprintf("برنامهٔ %s %s", majorName, code)
	}
	if err := s.curriculumAssertUnique(ctx, in.MajorID, *deg, in.TrackID, code, nil); err != nil {
		return 0, "", err
	}
	uniID := s.UniversityID(ctx, user, cookie)
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback(ctx)
	// برخی نصب‌ها ردیف‌ها را با id صریح وارد کرده‌اند؛ ترتیب را همیشه ترمیم کن.
	_, _ = tx.Exec(ctx, `select setval('syllabuses_id_seq',
		GREATEST((select coalesce(max(id),0) from curriculum_versions),
		         (select last_value from syllabuses_id_seq)), true)`)
	var total any
	if in.TotalRequiredUnits != nil {
		total = strconv.FormatFloat(*in.TotalRequiredUnits, 'f', -1, 64)
	}
	var createdID int64
	if err := tx.QueryRow(ctx, `
		insert into curriculum_versions ("universityId","majorId","degreeLevelId","trackId","versionCode",title,status,
		                                "entryYearFrom","entryYearTo","totalRequiredUnits","maxUnitsPerTerm","createdByStaffId")
		values ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,null) returning id`,
		uniID, in.MajorID, *deg, in.TrackID, code, title, in.EntryYearFrom, in.EntryYearTo, total, in.MaxUnitsPerTerm).Scan(&createdID); err != nil {
		return 0, "", err
	}
	clonedFrom := int64(0)
	if in.CloneFromID != nil {
		src, err := s.curriculumVersion(ctx, *in.CloneFromID)
		if err != nil {
			return 0, "", err
		}
		if err := s.curriculumDeepCopy(ctx, tx, *in.CloneFromID, createdID); err != nil {
			return 0, "", err
		}
		staffID, err := s.curriculumActorStaff(ctx, user)
		if err != nil {
			return 0, "", err
		}
		var evID int64
		if err := tx.QueryRow(ctx, `
			insert into curriculum_approvals ("curriculumVersionId","approvalType","fromStatus","toStatus","approvedByStaffId","approvedByUserId","decisionNote")
			values ($1,'CREATE_REVISION',$2,'DRAFT',$3,$4,$5) returning id`,
			createdID, fmt.Sprint(src["status"]), staffID, user.ID,
			fmt.Sprintf("کپی از نسخهٔ %s (%s)", src["versionCode"], src["status"])).Scan(&evID); err != nil {
			return 0, "", err
		}
		clonedFrom = *in.CloneFromID
	}
	curriculumAuditTx(ctx, tx, user.ID, "CURRICULUM_VERSION_CREATED", createdID, map[string]any{
		"majorId": in.MajorID, "versionCode": code, "clonedFrom": clonedFrom,
	})
	if err := tx.Commit(ctx); err != nil {
		return 0, "", err
	}
	return createdID, fmt.Sprintf("نسخهٔ %s ساخته شد.", code), nil
}

type CurriculumMetaPatch struct {
	Title              *string            `json:"title"`
	VersionCode        *string            `json:"versionCode"`
	TrackID            *int64             `json:"trackId"`
	EntryYearFrom      *int               `json:"entryYearFrom"`
	EntryYearTo        *int               `json:"entryYearTo"`
	EffectiveFrom      *string            `json:"effectiveFrom"`
	EffectiveTo        *string            `json:"effectiveTo"`
	TotalRequiredUnits *float64           `json:"totalRequiredUnits"`
	MaxUnitsPerTerm    *int               `json:"maxUnitsPerTerm"`
	MinRoleUnits       map[string]float64 `json:"minRoleUnits"`
	HasMinRoleUnits    bool               `json:"hasMinRoleUnits"`
	HasTrackID         bool               `json:"hasTrackId"`
}

func (s *Service) UpdateCurriculumMeta(ctx context.Context, user *session.User, versionID int64, p CurriculumMetaPatch) error {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return err
	}
	if err := curriculumAssertEditable(v); err != nil {
		return err
	}
	trackArg := v["trackId"].(*int64)
	if p.HasTrackID {
		trackArg = p.TrackID
	}
	newCode := v["versionCode"].(string)
	if p.VersionCode != nil && strings.TrimSpace(*p.VersionCode) != newCode {
		newCode = strings.TrimSpace(*p.VersionCode)
		if err := s.curriculumAssertUnique(ctx, v["majorId"].(int64), v["degreeLevelId"].(int64), trackArg, newCode, &versionID); err != nil {
			return err
		}
	}
	title := v["title"].(string)
	if p.Title != nil {
		title = strings.TrimSpace(*p.Title)
	}
	totalArg := v["totalRequiredUnits"].(string)
	if p.TotalRequiredUnits != nil {
		totalArg = strconv.FormatFloat(*p.TotalRequiredUnits, 'f', -1, 64)
	}
	maxArg := v["maxUnitsPerTerm"].(*int)
	if p.MaxUnitsPerTerm != nil {
		maxArg = p.MaxUnitsPerTerm
	}
	entryFrom := v["entryYearFrom"].(int)
	if p.EntryYearFrom != nil {
		entryFrom = *p.EntryYearFrom
	}
	entryTo := v["entryYearTo"].(*int)
	if p.EntryYearTo != nil {
		entryTo = p.EntryYearTo
	}
	effFrom, _ := v["effectiveFrom"].(*int64)
	effTo, _ := v["effectiveTo"].(*int64)
	minRole, _ := v["minRoleUnits"].(*string)
	if p.HasMinRoleUnits {
		if len(p.MinRoleUnits) > 0 {
			raw, _ := json.Marshal(p.MinRoleUnits)
			str := string(raw)
			minRole = &str
		} else {
			minRole = nil
		}
	}
	_, err = s.DB.Pool.Exec(ctx, `
		update curriculum_versions set title = $2, "versionCode" = $3, "trackId" = $4,
		       "entryYearFrom" = $5, "entryYearTo" = $6, "effectiveFrom" = $7, "effectiveTo" = $8,
		       "totalRequiredUnits" = $9, "maxUnitsPerTerm" = $10, "minRoleUnits" = $11, "updatedAt" = now()
		 where id = $1`, versionID, title, newCode, trackArg, entryFrom, entryTo, effFrom, effTo, totalArg, maxArg, minRole)
	if err != nil {
		return err
	}
	s.curriculumAudit(ctx, user.ID, "CURRICULUM_VERSION_META_UPDATED", versionID, p)
	return nil
}

func (s *Service) CreateCurriculumRevision(ctx context.Context, user *session.User, cookie string, versionID int64) (int64, string, error) {
	src, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return 0, "", err
	}
	status := fmt.Sprint(src["status"])
	if status != "APPROVED" && status != "PUBLISHED" {
		return 0, "", fmt.Errorf("ساخت ویرایش فقط از نسخهٔ تأییدشده/منتشرشده ممکن است (وضعیت فعلی: %s).", status)
	}
	newCode := NextRevisionCode(fmt.Sprint(src["versionCode"]))
	oldCode := fmt.Sprint(src["versionCode"])
	if err := s.curriculumAssertUnique(ctx, src["majorId"].(int64), src["degreeLevelId"].(int64), src["trackId"].(*int64), newCode, nil); err != nil {
		return 0, "", err
	}
	uniID := s.UniversityID(ctx, user, cookie)
	if src["universityId"] != nil {
		if id, ok := src["universityId"].(*int64); ok && id != nil {
			uniID = id
		}
	}
	title := strings.Replace(fmt.Sprint(src["title"]), oldCode, newCode, 1)
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback(ctx)
	var createdID int64
	if err := tx.QueryRow(ctx, `
		insert into curriculum_versions ("universityId","majorId","degreeLevelId","trackId","versionCode",title,status,
		                                "entryYearFrom","entryYearTo","effectiveFrom","effectiveTo",
		                                "totalRequiredUnits","maxUnitsPerTerm")
		values ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12) returning id`,
		uniID, src["majorId"], src["degreeLevelId"], src["trackId"], newCode, title,
		src["entryYearFrom"], src["entryYearTo"], src["effectiveFrom"], src["effectiveTo"],
		src["totalRequiredUnits"], src["maxUnitsPerTerm"]).Scan(&createdID); err != nil {
		return 0, "", err
	}
	if err := s.curriculumDeepCopy(ctx, tx, versionID, createdID); err != nil {
		return 0, "", err
	}
	staffID, err := s.curriculumActorStaff(ctx, user)
	if err != nil {
		return 0, "", err
	}
	var evID int64
	if err := tx.QueryRow(ctx, `
		insert into curriculum_approvals ("curriculumVersionId","approvalType","fromStatus","toStatus","approvedByStaffId","approvedByUserId","decisionNote")
		values ($1,'CREATE_REVISION',$2,'DRAFT',$3,$4,$5) returning id`,
		createdID, status, staffID, user.ID, fmt.Sprintf("ویرایش از نسخهٔ %s (%s)", oldCode, status)).Scan(&evID); err != nil {
		return 0, "", err
	}
	if _, err := tx.Exec(ctx, `update curriculum_versions set "approvalId" = $2 where id = $1`, createdID, evID); err != nil {
		return 0, "", err
	}
	curriculumAuditTx(ctx, tx, user.ID, "CURRICULUM_REVISION_CREATED", createdID, map[string]any{
		"sourceId": versionID, "sourceCode": oldCode, "newCode": newCode,
	})
	if err := tx.Commit(ctx); err != nil {
		return 0, "", err
	}
	return createdID, fmt.Sprintf("نسخهٔ %s (DRAFT) از روی %s ساخته شد.", newCode, oldCode), nil
}

// ── چرخهٔ حیات ──

func (s *Service) transitionCurriculum(ctx context.Context, user *session.User, versionID int64, to, approvalType, action, note string) (string, error) {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return "", err
	}
	from := fmt.Sprint(v["status"])
	if err := curriculumAssertTransition(from, to, action); err != nil {
		return "", err
	}
	staffID, err := s.curriculumActorStaff(ctx, user)
	if err != nil {
		return "", err
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var evID int64
	if err := tx.QueryRow(ctx, `
		insert into curriculum_approvals ("curriculumVersionId","approvalType","fromStatus","toStatus","approvedByStaffId","approvedByUserId","decisionNote")
		values ($1,$2,$3,$4,$5,$6,$7) returning id`,
		versionID, approvalType, from, to, staffID, user.ID, note).Scan(&evID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `update curriculum_versions set status = $2, "approvalId" = $3, "updatedAt" = now() where id = $1`, versionID, to, evID); err != nil {
		return "", err
	}
	curriculumAuditTx(ctx, tx, user.ID, "CURRICULUM_"+strings.ToUpper(strings.TrimSuffix(approvalType, "_SUBMIT")), versionID, note)
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	switch to {
	case "REVIEW":
		return "نسخه به بازبینی (REVIEW) ارجاع شد.", nil
	case "APPROVED":
		return "نسخه تأیید شد (APPROVED).", nil
	case "DRAFT":
		return "نسخه برای اصلاح به DRAFT بازگشت.", nil
	case "ARCHIVED":
		return "نسخه بایگانی شد (ARCHIVED).", nil
	}
	return "وضعیت نسخه به " + to + " تغییر کرد.", nil
}

// TransitionCurriculum گذارهای ساده (approve/reject/archive) — publish جداگانه است.
func (s *Service) TransitionCurriculum(ctx context.Context, user *session.User, versionID int64, to, approvalType, action, note string) (string, error) {
	return s.transitionCurriculum(ctx, user, versionID, to, approvalType, action, note)
}

func (s *Service) SubmitCurriculum(ctx context.Context, user *session.User, versionID int64, note string) ([]CurriculumCheckResult, string, error) {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return nil, "", err
	}
	if err := curriculumAssertTransition(fmt.Sprint(v["status"]), "REVIEW", "submit"); err != nil {
		return nil, "", err
	}
	courses, err := s.loadCurriculumCourses(ctx, versionID)
	if err != nil {
		return nil, "", err
	}
	rules, err := s.loadCurriculumRules(ctx, versionID)
	if err != nil {
		return nil, "", err
	}
	checks, err := s.curriculumChecks(ctx, versionID, v, courses, rules)
	if err != nil {
		return nil, "", err
	}
	blocking := []string{}
	for _, c := range checks {
		if c.Severity == "ERROR" {
			blocking = append(blocking, c.Check)
		}
	}
	if len(blocking) > 0 {
		return checks, "", fmt.Errorf("برنامهٔ درسی %d مانع جدی دارد و قابل ارجاع به تأیید نیست: %s", len(blocking), strings.Join(blocking, "، "))
	}
	msg, err := s.transitionCurriculum(ctx, user, versionID, "REVIEW", "DRAFT_SUBMIT", "submit", note)
	return checks, msg, err
}

func (s *Service) PublishCurriculum(ctx context.Context, user *session.User, versionID int64, note string) ([]string, string, error) {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return nil, "", err
	}
	if err := curriculumAssertTransition(fmt.Sprint(v["status"]), "PUBLISHED", "publish"); err != nil {
		return nil, "", err
	}
	staffID, err := s.curriculumActorStaff(ctx, user)
	if err != nil {
		return nil, "", err
	}
	code := fmt.Sprint(v["versionCode"])
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, "", err
	}
	defer tx.Rollback(ctx)
	rrows, err := tx.Query(ctx, `
		select id, "versionCode" from curriculum_versions
		 where "majorId" = $1 and "degreeLevelId" = $2 and coalesce("trackId",0) = $3
		   and status = 'PUBLISHED' and id <> $4`,
		v["majorId"], v["degreeLevelId"], int64(0), versionID)
	if err != nil {
		return nil, "", err
	}
	type rival struct {
		id   int64
		code string
	}
	rivals := []rival{}
	for rrows.Next() {
		var r rival
		if err := rrows.Scan(&r.id, &r.code); err == nil {
			rivals = append(rivals, r)
		}
	}
	rrows.Close()
	for _, r := range rivals {
		if _, err := tx.Exec(ctx, `
			insert into curriculum_approvals ("curriculumVersionId","approvalType","fromStatus","toStatus","approvedByStaffId","approvedByUserId","decisionNote")
			values ($1,'ARCHIVE','PUBLISHED','ARCHIVED',$2,$3,$4)`, r.id, staffID, user.ID,
			fmt.Sprintf("با انتشار نسخهٔ %s بایگانی شد.", code)); err != nil {
			return nil, "", err
		}
		if _, err := tx.Exec(ctx, `update curriculum_versions set status = 'ARCHIVED', "updatedAt" = now() where id = $1`, r.id); err != nil {
			return nil, "", err
		}
	}
	var evID int64
	if err := tx.QueryRow(ctx, `
		insert into curriculum_approvals ("curriculumVersionId","approvalType","fromStatus","toStatus","approvedByStaffId","approvedByUserId","decisionNote")
		values ($1,'PUBLISH','APPROVED','PUBLISHED',$2,$3,$4) returning id`,
		versionID, staffID, user.ID, note).Scan(&evID); err != nil {
		return nil, "", err
	}
	if _, err := tx.Exec(ctx, `update curriculum_versions set status = 'PUBLISHED', "approvalId" = $3, "updatedAt" = now() where id = $1 and status = $2`, versionID, "APPROVED", evID); err != nil {
		return nil, "", err
	}
	superseded := []string{}
	for _, r := range rivals {
		superseded = append(superseded, r.code)
	}
	curriculumAuditTx(ctx, tx, user.ID, "CURRICULUM_PUBLISHED", versionID, map[string]any{"superseded": superseded})
	if err := tx.Commit(ctx); err != nil {
		return nil, "", err
	}
	msg := "نسخه منتشر شد (PUBLISHED)."
	if len(rivals) > 0 {
		msg = fmt.Sprintf("نسخه منتشر شد و %d نسخهٔ رقیب بایگانی گردید.", len(rivals))
	}
	return superseded, msg, nil
}

// ── دروس نسخه ──

type CurriculumAddCourse struct {
	CourseID               int64    `json:"courseId"`
	RoleType               string   `json:"roleType"`
	RecommendedSemester    *int     `json:"recommendedSemester"`
	IsRequired             *int     `json:"isRequired"`
	IsElective             *int     `json:"isElective"`
	IsGraduationRequired   *int     `json:"isGraduationRequired"`
	MinGrade               *float64 `json:"minGrade"`
	AutoCorequisiteAllowed *int     `json:"autoCorequisiteAllowed"`
	PassGradeStatusCode    *string  `json:"passGradeStatusCode"`
	FailGradeStatusCode    *string  `json:"failGradeStatusCode"`
}

func roleTypeOr(v string) string {
	v = strings.TrimSpace(v)
	switch v {
	case "CORE", "MAJOR", "ELECTIVE", "GENERAL", "THESIS", "INTERNSHIP", "WORKSHOP":
		return v
	}
	return "CORE"
}

func (s *Service) AddCurriculumCourse(ctx context.Context, user *session.User, versionID int64, it CurriculumAddCourse) (string, error) {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return "", err
	}
	if err := curriculumAssertEditable(v); err != nil {
		return "", err
	}
	var courseTitle, courseCode string
	if err := s.DB.Pool.QueryRow(ctx, `select code, title from courses where id = $1`, it.CourseID).Scan(&courseCode, &courseTitle); err != nil {
		return "", errors.New("درس انتخابی در بانک دروس یافت نشد.")
	}
	var one int
	if err := s.DB.Pool.QueryRow(ctx, `select 1 from curriculum_courses where "curriculumVersionId" = $1 and "courseId" = $2 limit 1`, versionID, it.CourseID).Scan(&one); err == nil {
		return "", errors.New("این درس از قبل در نسخه وجود دارد.")
	}
	isReq := 1
	if it.IsRequired != nil {
		isReq = *it.IsRequired
	}
	isElec := 0
	if it.IsElective != nil {
		isElec = *it.IsElective
	}
	isGrad := 0
	if it.IsGraduationRequired != nil {
		isGrad = *it.IsGraduationRequired
	}
	auto := 0
	if it.AutoCorequisiteAllowed != nil {
		auto = *it.AutoCorequisiteAllowed
	}
	var minGrade any
	if it.MinGrade != nil {
		minGrade = strconv.FormatFloat(*it.MinGrade, 'f', -1, 64)
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		insert into curriculum_courses ("curriculumVersionId","courseId","roleType","recommendedSemester",
		                               "isRequired","isElective","isGraduationRequired","minGrade",
		                               "autoCorequisiteAllowed","passGradeStatusCode","failGradeStatusCode")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		versionID, it.CourseID, roleTypeOr(it.RoleType), it.RecommendedSemester,
		isReq, isElec, isGrad, minGrade, auto, it.PassGradeStatusCode, it.FailGradeStatusCode); err != nil {
		return "", err
	}
	s.curriculumAudit(ctx, user.ID, "CURRICULUM_COURSE_ADDED", versionID, map[string]any{"courseId": it.CourseID, "code": courseCode})
	return fmt.Sprintf("درس «%s» به نسخه افزوده شد.", courseTitle), nil
}

func (s *Service) BulkAddCurriculumCourses(ctx context.Context, user *session.User, versionID int64, items []CurriculumAddCourse) (int, []int64, string, error) {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return 0, nil, "", err
	}
	if err := curriculumAssertEditable(v); err != nil {
		return 0, nil, "", err
	}
	added := 0
	skipped := []int64{}
	for _, it := range items {
		var one int
		if err := s.DB.Pool.QueryRow(ctx, `select 1 from curriculum_courses where "curriculumVersionId" = $1 and "courseId" = $2 limit 1`, versionID, it.CourseID).Scan(&one); err == nil {
			skipped = append(skipped, it.CourseID)
			continue
		}
		isReq, isElec, isGrad, auto := 1, 0, 0, 0
		if it.IsRequired != nil {
			isReq = *it.IsRequired
		}
		if it.IsElective != nil {
			isElec = *it.IsElective
		}
		if it.IsGraduationRequired != nil {
			isGrad = *it.IsGraduationRequired
		}
		if it.AutoCorequisiteAllowed != nil {
			auto = *it.AutoCorequisiteAllowed
		}
		var minGrade any
		if it.MinGrade != nil {
			minGrade = strconv.FormatFloat(*it.MinGrade, 'f', -1, 64)
		}
		if _, err := s.DB.Pool.Exec(ctx, `
			insert into curriculum_courses ("curriculumVersionId","courseId","roleType","recommendedSemester",
			                               "isRequired","isElective","isGraduationRequired","minGrade",
			                               "autoCorequisiteAllowed","passGradeStatusCode","failGradeStatusCode")
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			versionID, it.CourseID, roleTypeOr(it.RoleType), it.RecommendedSemester,
			isReq, isElec, isGrad, minGrade, auto, it.PassGradeStatusCode, it.FailGradeStatusCode); err != nil {
			return added, skipped, "", err
		}
		added++
	}
	return added, skipped, fmt.Sprintf("%d درس افزوده شد.", added), nil
}

func (s *Service) RemoveCurriculumCourse(ctx context.Context, user *session.User, versionID, courseID int64) (string, error) {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return "", err
	}
	if err := curriculumAssertEditable(v); err != nil {
		return "", err
	}
	var courseTitle string
	if err := s.DB.Pool.QueryRow(ctx, `select title from courses where id = $1`, courseID).Scan(&courseTitle); err != nil {
		return "", errors.New("درس یافت نشد.")
	}
	var dep int
	if err := s.DB.Pool.QueryRow(ctx, `
		select e.id from enrollments e join course_offerings o on o.id = e."offeringId"
		 where o."courseId" = $1 limit 1`, courseID).Scan(&dep); err == nil {
		return "", errors.New("این درس دارای ثبتنام فعال است و امکان حذف از نسخه وجود ندارد.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from curriculum_courses where "curriculumVersionId" = $1 and "courseId" = $2`, versionID, courseID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `delete from course_rules where "syllabusId" = $1 and "courseId" = $2`, versionID, courseID); err != nil {
		return "", err
	}
	curriculumAuditTx(ctx, tx, user.ID, "CURRICULUM_COURSE_REMOVED", versionID, map[string]any{"courseId": courseID})
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return fmt.Sprintf("درس «%s» از نسخه حذف شد.", courseTitle), nil
}

type CurriculumCoursePatch struct {
	RoleType               *string  `json:"roleType"`
	Units                  *float64 `json:"units"`
	HasUnits               bool     `json:"hasUnits"`
	TheoryUnits            *float64 `json:"theoryUnits"`
	HasTheory              bool     `json:"hasTheory"`
	PracticalUnits         *float64 `json:"practicalUnits"`
	HasPractical           bool     `json:"hasPractical"`
	IsRequired             *int     `json:"isRequired"`
	IsElective             *int     `json:"isElective"`
	IsGraduationRequired   *int     `json:"isGraduationRequired"`
	MinGrade               *float64 `json:"minGrade"`
	HasMinGrade            bool     `json:"hasMinGrade"`
	AutoCorequisiteAllowed *int     `json:"autoCorequisiteAllowed"`
	PassGradeStatusCode    *string  `json:"passGradeStatusCode"`
	HasPassCode            bool     `json:"hasPassCode"`
	FailGradeStatusCode    *string  `json:"failGradeStatusCode"`
	HasFailCode            bool     `json:"hasFailCode"`
}

func (s *Service) UpdateCurriculumCourse(ctx context.Context, user *session.User, versionID, courseID int64, p CurriculumCoursePatch) error {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return err
	}
	if err := curriculumAssertEditable(v); err != nil {
		return err
	}
	var roleType string
	var units, theory, practical, minGrade *string
	var isReq, isElec, isGrad, auto int
	var passCode, failCode *string
	if err := s.DB.Pool.QueryRow(ctx, `
		select coalesce("roleType",'CORE'), units::text, "theoryUnits"::text, "practicalUnits"::text,
		       "isRequired", "isElective", "isGraduationRequired", "minGrade"::text,
		       "autoCorequisiteAllowed", "passGradeStatusCode", "failGradeStatusCode"
		  from curriculum_courses where "curriculumVersionId" = $1 and "courseId" = $2`,
		versionID, courseID).Scan(&roleType, &units, &theory, &practical, &isReq, &isElec, &isGrad, &minGrade, &auto, &passCode, &failCode); err != nil {
		return errors.New("درس در این نسخه وجود ندارد.")
	}
	if p.RoleType != nil {
		roleType = roleTypeOr(*p.RoleType)
	}
	if p.HasUnits {
		if p.Units != nil {
			s := strconv.FormatFloat(*p.Units, 'f', -1, 64)
			units = &s
		} else {
			units = nil
		}
	}
	if p.HasTheory {
		if p.TheoryUnits != nil {
			s := strconv.FormatFloat(*p.TheoryUnits, 'f', -1, 64)
			theory = &s
		} else {
			theory = nil
		}
	}
	if p.HasPractical {
		if p.PracticalUnits != nil {
			s := strconv.FormatFloat(*p.PracticalUnits, 'f', -1, 64)
			practical = &s
		} else {
			practical = nil
		}
	}
	if p.IsRequired != nil {
		isReq = *p.IsRequired
	}
	if p.IsElective != nil {
		isElec = *p.IsElective
	}
	if p.IsGraduationRequired != nil {
		isGrad = *p.IsGraduationRequired
	}
	if p.HasMinGrade {
		if p.MinGrade != nil {
			s := strconv.FormatFloat(*p.MinGrade, 'f', -1, 64)
			minGrade = &s
		} else {
			minGrade = nil
		}
	}
	if p.AutoCorequisiteAllowed != nil {
		auto = *p.AutoCorequisiteAllowed
	}
	if p.HasPassCode {
		passCode = p.PassGradeStatusCode
	}
	if p.HasFailCode {
		failCode = p.FailGradeStatusCode
	}
	_, err = s.DB.Pool.Exec(ctx, `
		update curriculum_courses set "roleType" = $3, units = $4, "theoryUnits" = $5, "practicalUnits" = $6,
		       "isRequired" = $7, "isElective" = $8, "isGraduationRequired" = $9, "minGrade" = $10,
		       "autoCorequisiteAllowed" = $11, "passGradeStatusCode" = $12, "failGradeStatusCode" = $13
		 where "curriculumVersionId" = $1 and "courseId" = $2`,
		versionID, courseID, roleType, units, theory, practical, isReq, isElec, isGrad, minGrade, auto, passCode, failCode)
	return err
}

func (s *Service) AssignCurriculumSemester(ctx context.Context, user *session.User, versionID, courseID int64, semester *int) (string, error) {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return "", err
	}
	if err := curriculumAssertEditable(v); err != nil {
		return "", err
	}
	if semester != nil && (*semester < 1 || *semester > 9) {
		return "", errors.New("شماره ترم باید بین ۱ تا ۹ باشد (۹ = تابستان، خالی = نامشخص).")
	}
	if _, err := s.DB.Pool.Exec(ctx, `update curriculum_courses set "recommendedSemester" = $3 where "curriculumVersionId" = $1 and "courseId" = $2`, versionID, courseID, semester); err != nil {
		return "", err
	}
	if semester == nil {
		return "ترم درس آزاد شد.", nil
	}
	if *semester == 9 {
		return "درس به ترم تابستان تخصیص یافت.", nil
	}
	return fmt.Sprintf("درس به ترم %d تخصیص یافت.", *semester), nil
}

func (s *Service) SyncCurriculumRoles(ctx context.Context, user *session.User, versionID int64) (int, string, error) {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return 0, "", err
	}
	if err := curriculumAssertEditable(v); err != nil {
		return 0, "", err
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select cc."courseId", cc."roleType", c."courseType"
		  from curriculum_courses cc join courses c on c.id = cc."courseId"
		 where cc."curriculumVersionId" = $1`, versionID)
	if err != nil {
		return 0, "", err
	}
	type row struct {
		courseID   int64
		roleType   string
		courseType *string
	}
	list := []row{}
	for rows.Next() {
		var r row
		if rows.Scan(&r.courseID, &r.roleType, &r.courseType) == nil {
			list = append(list, r)
		}
	}
	rows.Close()
	updated := 0
	for _, r := range list {
		mapped := roleFromBankType(r.courseType)
		if mapped != r.roleType {
			if _, err := s.DB.Pool.Exec(ctx, `update curriculum_courses set "roleType" = $3 where "curriculumVersionId" = $1 and "courseId" = $2`, versionID, r.courseID, mapped); err != nil {
				return updated, "", err
			}
			updated++
		}
	}
	if updated > 0 {
		return updated, fmt.Sprintf("نقش %d درس از روی نوع بانک اصلاح شد.", updated), nil
	}
	return 0, "همهٔ نقش‌ها از قبل با بانک هماهنگ بودند.", nil
}

func (s *Service) MarkGradRequiredBulk(ctx context.Context, user *session.User, versionID int64) (int, int, string, error) {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return 0, 0, "", err
	}
	if err := curriculumAssertEditable(v); err != nil {
		return 0, 0, "", err
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select "courseId", coalesce("isGraduationRequired",0) from curriculum_courses
		 where "curriculumVersionId" = $1 and ("isRequired" = 1 or "roleType" in ('CORE','MAJOR'))`, versionID)
	if err != nil {
		return 0, 0, "", err
	}
	type row struct {
		courseID int64
		marked   int
	}
	list := []row{}
	for rows.Next() {
		var r row
		if rows.Scan(&r.courseID, &r.marked) == nil {
			list = append(list, r)
		}
	}
	rows.Close()
	updated := 0
	for _, r := range list {
		if r.marked == 1 {
			continue
		}
		if _, err := s.DB.Pool.Exec(ctx, `update curriculum_courses set "isGraduationRequired" = 1 where "curriculumVersionId" = $1 and "courseId" = $2`, versionID, r.courseID); err != nil {
			return updated, len(list), "", err
		}
		updated++
	}
	if len(list) == 0 {
		return 0, 0, "هیچ درس الزامی (یا CORE/MAJOR) در این نسخه نیست؛ اول نقش/الزامی دروس را مشخص کنید.", nil
	}
	return updated, len(list), fmt.Sprintf("شرط فارغ‌التحصیلی برای %d درس از %d درس الزامی علامت خورد.", updated, len(list)), nil
}

// roleFromBankType پورت lib/bank-roles (تنها منبع نگاشت).
func roleFromBankType(courseType *string) string {
	t := ""
	if courseType != nil {
		t = strings.TrimSpace(*courseType)
	}
	switch t {
	case "عمومی":
		return "GENERAL"
	case "پایه":
		return "CORE"
	case "اصلی":
		return "MAJOR"
	case "اختیاری":
		return "ELECTIVE"
	}
	return "CORE"
}

// ── قواعد ──

func (s *Service) setCurriculumRule(ctx context.Context, user *session.User, versionID, courseID int64, ruleType string, treeInput map[string]any) (string, error) {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return "", err
	}
	if err := curriculumAssertEditable(v); err != nil {
		return "", err
	}
	var one int
	if err := s.DB.Pool.QueryRow(ctx, `select 1 from curriculum_courses where "curriculumVersionId" = $1 and "courseId" = $2 limit 1`, versionID, courseID).Scan(&one); err != nil {
		return "", errors.New("ابتدا درس را به نسخه اضافه کنید.")
	}
	if treeInput == nil {
		if _, err := s.DB.Pool.Exec(ctx, `delete from course_rules where "syllabusId" = $1 and "courseId" = $2 and "ruleType" = $3`, versionID, courseID, ruleType); err != nil {
			return "", err
		}
		if ruleType == "PREREQ" {
			return "پیش‌نیاز حذف شد.", nil
		}
		return "هم‌نیاز حذف شد.", nil
	}
	tree, err := NormalizeLogicNode(treeInput)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(tree)
	var existing int64
	err = s.DB.Pool.QueryRow(ctx, `select id from course_rules where "syllabusId" = $1 and "courseId" = $2 and "ruleType" = $3 limit 1`, versionID, courseID, ruleType).Scan(&existing)
	if err == nil {
		if _, err := s.DB.Pool.Exec(ctx, `update course_rules set "logicTree" = $2 where id = $1`, existing, string(raw)); err != nil {
			return "", err
		}
	} else {
		if _, err := s.DB.Pool.Exec(ctx, `insert into course_rules ("courseId","syllabusId","ruleType","logicTree") values ($1,$2,$3,$4)`, courseID, versionID, ruleType, string(raw)); err != nil {
			return "", err
		}
	}
	if ruleType == "PREREQ" {
		return "پیش‌نیاز ثبت شد.", nil
	}
	return "هم‌نیاز ثبت شد.", nil
}

func (s *Service) SetCurriculumPrereq(ctx context.Context, user *session.User, versionID, courseID int64, tree map[string]any) (string, error) {
	return s.setCurriculumRule(ctx, user, versionID, courseID, "PREREQ", tree)
}

func (s *Service) SetCurriculumCoreq(ctx context.Context, user *session.User, versionID, courseID int64, tree map[string]any) (string, error) {
	return s.setCurriculumRule(ctx, user, versionID, courseID, "COREQ", tree)
}

func (s *Service) SetCurriculumPassingGrade(ctx context.Context, user *session.User, versionID, courseID int64, minGrade *float64) (string, error) {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return "", err
	}
	if err := curriculumAssertEditable(v); err != nil {
		return "", err
	}
	if minGrade != nil && (*minGrade < 0 || *minGrade > 20) {
		return "", errors.New("کف نمره باید بین ۰ تا ۲۰ باشد.")
	}
	var val any
	if minGrade != nil {
		val = strconv.FormatFloat(*minGrade, 'f', -1, 64)
	}
	if _, err := s.DB.Pool.Exec(ctx, `update curriculum_courses set "minGrade" = $3 where "curriculumVersionId" = $1 and "courseId" = $2`, versionID, courseID, val); err != nil {
		return "", err
	}
	return "کف نمرهٔ درس ثبت شد.", nil
}

func (s *Service) SetCurriculumCourseGradeCodes(ctx context.Context, user *session.User, versionID, courseID int64, passCode, failCode *string) error {
	v, err := s.curriculumVersion(ctx, versionID)
	if err != nil {
		return err
	}
	if err := curriculumAssertEditable(v); err != nil {
		return err
	}
	_, err = s.DB.Pool.Exec(ctx, `
		update curriculum_courses set "passGradeStatusCode" = $3, "failGradeStatusCode" = $4
		 where "curriculumVersionId" = $1 and "courseId" = $2`, versionID, courseID, nullableTrim(passCode), nullableTrim(failCode))
	return err
}

// ── بانک دروس (نسخهٔ سبک مخصوص کاتالوگ) ──

type CurriculumBankInput struct {
	Code             string  `json:"code"`
	Title            string  `json:"title"`
	TheoreticalUnits float64 `json:"theoreticalUnits"`
	PracticalUnits   float64 `json:"practicalUnits"`
	CourseType       string  `json:"courseType"`
	GradingType      string  `json:"gradingType"`
	AffectsGpa       *int    `json:"affectsGpa"`
	DepartmentID     *int64  `json:"departmentId"`
}

func (s *Service) CreateCurriculumBankCourse(ctx context.Context, user *session.User, in CurriculumBankInput) (int64, string, error) {
	code := strings.TrimSpace(in.Code)
	title := strings.TrimSpace(in.Title)
	theo, prac := in.TheoreticalUnits, in.PracticalUnits
	if code == "" || title == "" {
		return 0, "", errors.New("کد درس و نام درس الزامی است.")
	}
	if theo < 0 || prac < 0 || theo+prac <= 0 {
		return 0, "", errors.New("واحد نظری/عملی نامعتبر است (مجموع باید بیشتر از صفر باشد).")
	}
	var one int
	if err := s.DB.Pool.QueryRow(ctx, `select 1 from courses where code = $1 limit 1`, code).Scan(&one); err == nil {
		return 0, "", fmt.Errorf("کد درس تکراری است: %s", code)
	}
	if in.DepartmentID != nil {
		var dID int64
		if err := s.DB.Pool.QueryRow(ctx, `select id from departments where id = $1`, *in.DepartmentID).Scan(&dID); err != nil {
			return 0, "", errors.New("گروه آموزشی انتخاب‌شده یافت نشد.")
		}
	}
	grading := "NUMERIC"
	if in.GradingType == "PASS_FAIL" {
		grading = "PASS_FAIL"
	}
	affects := 1
	if in.AffectsGpa != nil && *in.AffectsGpa == 0 {
		affects = 0
	}
	courseType := strings.TrimSpace(in.CourseType)
	if courseType == "" {
		courseType = "تخصصی"
	}
	var id int64
	if err := s.DB.Pool.QueryRow(ctx, `
		insert into courses (code, title, "theoreticalUnits", "practicalUnits", units, "courseType", "gradingType", "affectsGpa", "departmentId")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
		code, title, strconv.FormatFloat(theo, 'f', -1, 64), strconv.FormatFloat(prac, 'f', -1, 64),
		strconv.FormatFloat(theo+prac, 'f', -1, 64), courseType, grading, affects, in.DepartmentID).Scan(&id); err != nil {
		return 0, "", err
	}
	return id, fmt.Sprintf("درس «%s» در بانک تعریف شد (%s واحد).", title, jalaliNum(theo+prac)), nil
}

func (s *Service) UpdateCurriculumBankCourse(ctx context.Context, user *session.User, courseID int64, in CurriculumBankInput) (string, error) {
	var existingTitle string
	var curTheo, curPrac *float64
	if err := s.DB.Pool.QueryRow(ctx, `select title, "theoreticalUnits"::float8, "practicalUnits"::float8 from courses where id = $1`, courseID).Scan(&existingTitle, &curTheo, &curPrac); err != nil {
		return "", errors.New("درس یافت نشد.")
	}
	theo := in.TheoreticalUnits
	if in.TheoreticalUnits == 0 && curTheo != nil {
		theo = *curTheo
	}
	prac := in.PracticalUnits
	if in.PracticalUnits == 0 && curPrac != nil {
		prac = *curPrac
	}
	title := existingTitle
	if in.Title != "" {
		title = strings.TrimSpace(in.Title)
	}
	courseType := strings.TrimSpace(in.CourseType)
	grading := in.GradingType
	var affects any
	if in.AffectsGpa != nil {
		affects = boolInt(*in.AffectsGpa != 0)
	}
	_, err := s.DB.Pool.Exec(ctx, `
		update courses set title = $2, "theoreticalUnits" = $3, "practicalUnits" = $4, units = $5,
		       "courseType" = nullif($6,''), "gradingType" = nullif($7,''), "affectsGpa" = coalesce($8, "affectsGpa")
		 where id = $1`,
		courseID, title, strconv.FormatFloat(theo, 'f', -1, 64), strconv.FormatFloat(prac, 'f', -1, 64),
		strconv.FormatFloat(theo+prac, 'f', -1, 64), courseType, grading, affects)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("درس «%s» به‌روزرسانی شد.", existingTitle), nil
}

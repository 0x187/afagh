// ═══ ثبت‌نام دستی کارشناس (تک/bulk)، کاتالوگ دانشجو و تاریخچه — پورت admin/manual-enroll ═══
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"backend-go/internal/enroll"
	"backend-go/internal/fa"
	"backend-go/internal/session"
)

// ManualOffering ارائهٔ درس برای کارشناس.
type ManualOffering struct {
	OfferingID    int64    `json:"offeringId"`
	Code          string   `json:"code"`
	Title         string   `json:"title"`
	GroupNumber   int      `json:"groupNumber"`
	Units         *float64 `json:"units"`
	Capacity      int      `json:"capacity"`
	EnrolledCount int      `json:"enrolledCount"`
	ProfessorName string   `json:"professorName"`
}

func (s *Service) settingBool(ctx context.Context, key string, fallback bool) bool {
	if s.Store == nil {
		return fallback
	}
	raw, err := s.Store.Get(ctx, key)
	if err != nil {
		return fallback
	}
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return fallback
}

// SearchManualStudents جست‌وجوی دانشجوی فعال برای ثبت دستی.
func (s *Service) SearchManualStudents(ctx context.Context, user *session.User, cookie, q string) ([]WarningStudentHit, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := []WarningStudentHit{}
	if uniID == nil || strings.TrimSpace(q) == "" {
		return out, nil
	}
	like := "%" + fa.EscapeLikeChars(fa.ToEnDigits(strings.TrimSpace(q))) + "%"
	rows, err := s.DB.Pool.Query(ctx, `
		select st.id, coalesce(st."studentCode",''), (u."firstName" || ' ' || u."lastName"), st."entryYear"
		  from students st join users u on u.id = st."userId"
		 where st.status = 'ACTIVE' and st."universityId" = $1
		   and (st."studentCode" ilike $2 escape '\' or (u."firstName" || ' ' || u."lastName") ilike $2 escape '\')
		 order by st.id desc limit 20`, *uniID, like)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var h WarningStudentHit
		if err := rows.Scan(&h.StudentID, &h.StudentCode, &h.Name, &h.EntryYear); err == nil {
			out = append(out, h)
		}
	}
	return out, nil
}

// ListManualOfferings ارائه‌های فعال ترم.
func (s *Service) ListManualOfferings(ctx context.Context, user *session.User, cookie string, termID int64) ([]ManualOffering, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := []ManualOffering{}
	if uniID == nil || termID <= 0 {
		return out, nil
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.code, c.title, coalesce(o."groupNumber",0), c.units::float8,
		       coalesce(o.capacity,0), coalesce(o."enrolledCount",0),
		       coalesce(nullif(trim(u."firstName" || ' ' || u."lastName"), ''), '—')
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		 where o."termId" = $1 and coalesce(o."isActive",1) = 1 and o."universityId" = $2
		 order by c.title, o."groupNumber" limit 4000`, termID, *uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var o ManualOffering
		if err := rows.Scan(&o.OfferingID, &o.Code, &o.Title, &o.GroupNumber, &o.Units,
			&o.Capacity, &o.EnrolledCount, &o.ProfessorName); err == nil {
			out = append(out, o)
		}
	}
	return out, nil
}

// ─────────────────── تداخل ───────────────────

type schedSlot struct {
	OfferingID int64
	Day        *int
	Start      *string
	End        *string
	ExamDate   *string
}

func toMin(hhmm string) int {
	parts := strings.Split(hhmm, ":")
	if len(parts) < 2 {
		return 0
	}
	h, _ := strconv.Atoi(parts[0])
	m, _ := strconv.Atoi(parts[1])
	return h*60 + m
}

func rangesOverlap(a, b, c, d string) bool {
	return toMin(a) < toMin(d) && toMin(c) < toMin(b)
}

// conflictIndex ایندکس تداخل هفتگی/امتحانی هر ارائه با بقیهٔ ثبت‌نام‌های دانشجو.
func (s *Service) conflictIndex(ctx context.Context, studentID, termID int64) map[int64][]string {
	out := map[int64][]string{}
	erows, err := s.DB.Pool.Query(ctx, `
		select e."offeringId", c.title
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1 and o."termId" = $2
		   and e.status in ('REGISTERED','WAITLISTED','PENDING_COUNCIL')`, studentID, termID)
	if err != nil {
		return out
	}
	type er struct {
		OfferingID int64
		Title      string
	}
	list := []er{}
	ids := []int64{}
	for erows.Next() {
		var e er
		if err := erows.Scan(&e.OfferingID, &e.Title); err == nil {
			list = append(list, e)
			ids = append(ids, e.OfferingID)
		}
	}
	erows.Close()
	if len(ids) == 0 {
		return out
	}
	titleBy := map[int64]string{}
	for _, e := range list {
		titleBy[e.OfferingID] = e.Title
	}
	srows, err := s.DB.Pool.Query(ctx, `
		select "offeringId", "dayOfWeek", to_char("startTime",'HH24:MI'), to_char("endTime",'HH24:MI'), "examDate"::text
		  from schedules where "offeringId" = any($1) and "scheduleType" in ('CLASS','EXAM')`, ids)
	if err != nil {
		return out
	}
	byOff := map[int64][]schedSlot{}
	offIDs := []int64{}
	seen := map[int64]bool{}
	for srows.Next() {
		var sl schedSlot
		if err := srows.Scan(&sl.OfferingID, &sl.Day, &sl.Start, &sl.End, &sl.ExamDate); err == nil {
			byOff[sl.OfferingID] = append(byOff[sl.OfferingID], sl)
			if !seen[sl.OfferingID] {
				seen[sl.OfferingID] = true
				offIDs = append(offIDs, sl.OfferingID)
			}
		}
	}
	srows.Close()
	for i := 0; i < len(offIDs); i++ {
		for j := i + 1; j < len(offIDs); j++ {
			a, b := byOff[offIDs[i]], byOff[offIDs[j]]
			aTitle := titleBy[offIDs[i]]
			if aTitle == "" {
				aTitle = fmt.Sprintf("درس %d", offIDs[i])
			}
			bTitle := titleBy[offIDs[j]]
			if bTitle == "" {
				bTitle = fmt.Sprintf("درس %d", offIDs[j])
			}
			for _, sa := range a {
				for _, sb := range b {
					if sa.Day != nil && sb.Day != nil && *sa.Day == *sb.Day && sa.Start != nil && sb.Start != nil && sa.End != nil && sb.End != nil {
						if rangesOverlap(*sa.Start, *sa.End, *sb.Start, *sb.End) {
							out[offIDs[i]] = append(out[offIDs[i]], fmt.Sprintf("تداخل هفتگی با «%s» (روز %d)", bTitle, *sa.Day))
							out[offIDs[j]] = append(out[offIDs[j]], fmt.Sprintf("تداخل هفتگی با «%s» (روز %d)", aTitle, *sa.Day))
						}
					}
				}
			}
			for _, ea := range a {
				for _, eb := range b {
					if ea.ExamDate != nil && eb.ExamDate != nil && *ea.ExamDate == *eb.ExamDate && ea.Start != nil && eb.Start != nil {
						out[offIDs[i]] = append(out[offIDs[i]], fmt.Sprintf("تداخل امتحانی با «%s» (%s)", bTitle, *ea.ExamDate))
						out[offIDs[j]] = append(out[offIDs[j]], fmt.Sprintf("تداخل امتحانی با «%s» (%s)", aTitle, *ea.ExamDate))
					}
				}
			}
		}
	}
	return out
}

// StudentWarning اخطار آیین‌نامه.
type StudentWarning struct {
	Code   string `json:"code"`
	Level  string `json:"level"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

// ManualStudentWarnings اخطارهای قابل‌توجه برای انتخاب واحد.
func (s *Service) ManualStudentWarnings(ctx context.Context, user *session.User, cookie string, studentID, termID int64) ([]StudentWarning, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	items := []StudentWarning{}
	if uniID == nil {
		return items, errors.New("دانشگاه فعال نامشخص است.")
	}
	var status string
	var studentUni *int64
	var extraProb, extraSem int
	err := s.DB.Pool.QueryRow(ctx, `
		select status, "universityId", coalesce("extraAllowedProbations",0), coalesce("extraAllowedSemesters",0)
		  from students where id = $1`, studentID).Scan(&status, &studentUni, &extraProb, &extraSem)
	if err != nil {
		return items, errors.New("دانشجو یافت نشد.")
	}
	if studentUni != nil && *studentUni != *uniID {
		return items, errors.New("این دانشجو از دانشگاه دیگری است.")
	}
	if status == "BLOCKED_COMMISSION" {
		items = append(items, StudentWarning{Code: "status_blocked", Level: "block", Title: "مسدود", Detail: "پروندهٔ دانشجو برای کمیسیون مسدود است."})
	} else if status == "PROBATION" {
		items = append(items, StudentWarning{Code: "status_probation", Level: "warn", Title: "مشروط", Detail: "دانشجو در وضعیت مشروط است."})
	}
	if summary, err := enroll.EvaluateStudentRegulationStatus(ctx, s.DB.Pool, studentID, &termID); err == nil && summary != nil {
		maxProb := 3 + extraProb
		maxSem := 8 + extraSem - summary.EquivalenceSemesters
		if summary.TotalProbations >= maxProb {
			items = append(items, StudentWarning{Code: "probation_limit", Level: "block", Title: "سقف مشروطیت",
				Detail: fmt.Sprintf("%d ترم مشروطی از سقف %d ترم — ادامهٔ تحصیل نیازمند کمیسیون است.", summary.TotalProbations, maxProb)})
		}
		if summary.CompletedSemesters >= maxSem {
			items = append(items, StudentWarning{Code: "tenure_limit", Level: "block", Title: "پایان سنوات",
				Detail: fmt.Sprintf("%d ترم از سقف %d ترم — نیازمند سنوات ارفاقی.", summary.CompletedSemesters, maxSem)})
		}
	}
	var cleared *int
	_ = s.DB.Pool.QueryRow(ctx, `
		select "isCleared" from financial_clearances where "studentId" = $1 and "termId" = $2 limit 1`,
		studentID, termID).Scan(&cleared)
	if cleared == nil || *cleared != 1 {
		items = append(items, StudentWarning{Code: "not_settled", Level: "warn", Title: "تسویهٔ ترم", Detail: "تسویهٔ مالی این ترم ثبت نشده است."})
	}
	return items, nil
}

// ManualEnrollInput ورودی تک‌ثبت‌نام.
type ManualEnrollInput struct {
	StudentID  int64  `json:"studentId"`
	OfferingID int64  `json:"offeringId"`
	Override   bool   `json:"override"`
	Reason     string `json:"reason"`
}

// ManualEnroll ثبت‌نام تک‌نفره به‌جای دانشجو با همان گیت‌های آیین‌نامه.
func (s *Service) ManualEnroll(ctx context.Context, user *session.User, cookie string, in ManualEnrollInput) (int64, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال نامشخص است.")
	}
	reason := strings.TrimSpace(in.Reason)
	overrideAllowed := s.settingBool(ctx, "ENROLL_EXPERT_OVERRIDE", true)
	if in.Override && !overrideAllowed {
		return 0, errors.New("نادیده‌گرفتن آیین‌نامه در حال حاضر غیرمجاز است (تنظیم سازمان).")
	}
	if in.Override && len([]rune(reason)) < 5 {
		return 0, errors.New("وقتی آیین‌نامه را نادیده می‌گیری، دلیل (حداقل ۵ نویسه) الزامی است.")
	}
	var stuStatus string
	var stuUni *int64
	var majorID *int64
	if err := s.DB.Pool.QueryRow(ctx, `select status, "universityId", "majorId" from students where id = $1`, in.StudentID).
		Scan(&stuStatus, &stuUni, &majorID); err != nil || stuStatus != "ACTIVE" {
		return 0, errors.New("دانشجوی فعال یافت نشد.")
	}
	if stuUni != nil && *stuUni != *uniID {
		return 0, errors.New("این دانشجو از دانشگاه دیگری است.")
	}
	var offTerm int64
	var offUni *int64
	var offCapacity, offEnrolled int
	var offCourseID int64
	var offActive int
	if err := s.DB.Pool.QueryRow(ctx, `
		select "termId", "universityId", coalesce(capacity,0), coalesce("enrolledCount",0), "courseId", coalesce("isActive",1)
		  from course_offerings where id = $1`, in.OfferingID).
		Scan(&offTerm, &offUni, &offCapacity, &offEnrolled, &offCourseID, &offActive); err != nil || offActive == 0 {
		return 0, errors.New("کلاس یافت نشد یا غیرفعال است.")
	}
	if offUni == nil {
		return 0, errors.New("دانشگاه کلاس نامشخص است.")
	}
	if *offUni != *uniID {
		return 0, errors.New("این کلاس متعلق به دانشگاه دیگری است.")
	}
	var dup int
	if err := s.DB.Pool.QueryRow(ctx, `select 1 from enrollments where "studentId" = $1 and "offeringId" = $2 limit 1`,
		in.StudentID, in.OfferingID).Scan(&dup); err == nil {
		return 0, errors.New("این دانشجو همین‌الان در این کلاس ثبت است.")
	}
	if !in.Override && offCapacity > 0 && offEnrolled >= offCapacity {
		return 0, errors.New("ظرفیت کلاس پر است — برای تخطی، نادیده‌گرفتن (با دلیل) لازم است.")
	}
	var newUnits float64
	_ = s.DB.Pool.QueryRow(ctx, `select coalesce(units,0)::float8 from courses where id = $1`, offCourseID).Scan(&newUnits)
	var allowedMax *float64
	if summary, err := enroll.EvaluateStudentRegulationStatus(ctx, s.DB.Pool, in.StudentID, &offTerm); err == nil && summary != nil {
		v := summary.EffectiveMaxUnits
		allowedMax = &v
	}
	var curUnits float64
	_ = s.DB.Pool.QueryRow(ctx, `
		select coalesce(sum(c.units),0)::float8 from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1 and o."termId" = $2 and e.status in ('REGISTERED','PENDING_COUNCIL')`,
		in.StudentID, offTerm).Scan(&curUnits)
	if !in.Override && allowedMax != nil && curUnits+newUnits > *allowedMax {
		return 0, fmt.Errorf("سقف واحد: ثبت‌شده %s + این درس %s = %s واحد، بیش از سقف مجاز %s واحد است — برای تخطی، نادیده‌گرفتن (با دلیل) لازم است.",
			trimNum(curUnits), trimNum(newUnits), trimNum(curUnits+newUnits), trimNum(*allowedMax))
	}
	prereqViolated := ""
	if pctx, err := enroll.BuildPrereqContext(ctx, s.DB.Pool, in.StudentID); err == nil && pctx != nil {
		if rule := pctx.RuleByCourse[offCourseID]; rule != nil {
			if ok, missing := enroll.EvaluateLogicTree(rule, pctx.Passed); !ok {
				names := []string{}
				for _, c := range missing {
					if t, ok := pctx.Titles[c]; ok && t != "" {
						names = append(names, t)
					} else {
						names = append(names, c)
					}
				}
				prereqViolated = strings.Join(names, "، ")
			}
		}
	}
	if !in.Override && prereqViolated != "" {
		return 0, fmt.Errorf("پیش‌نیاز برآورده نشده: نیازمند گذراندن «%s» است — برای تخطی، نادیده‌گرفتن (با دلیل) لازم است.", prereqViolated)
	}
	conflicts := s.conflictIndex(ctx, in.StudentID, offTerm)[in.OfferingID]
	if len(conflicts) > 0 && !in.Override {
		return 0, fmt.Errorf("درس با برنامهٔ دانشجو تداخل دارد — برای ثبت «بر اساس حکم شورا» باید نادیده‌گرفتن+دلیل فعال باشد. (%s)", conflicts[0])
	}
	warnings, _ := s.ManualStudentWarnings(ctx, user, cookie, in.StudentID, offTerm)
	blocks := []string{}
	codes := []string{}
	for _, w := range warnings {
		codes = append(codes, w.Code)
		if w.Level == "block" {
			blocks = append(blocks, w.Title)
		}
	}
	if len(blocks) > 0 && !in.Override {
		return 0, fmt.Errorf("اخطار آیین‌نامه: %s — برای صدور مجوز، نادیده‌گرفتن+دلیل را فعال کن.", strings.Join(blocks, "، "))
	}
	var overridden any
	if in.Override {
		if len(conflicts) > 0 {
			codes = append(codes, "conflict")
		}
		if prereqViolated != "" {
			codes = append(codes, "prereq")
		}
		if allowedMax != nil && curUnits+newUnits > *allowedMax {
			codes = append(codes, "max_units")
		}
		codes = uniqueStrings(codes)
		b, _ := json.Marshal(codes)
		overridden = string(b)
	}
	var enrollID int64
	council := 0
	if len(conflicts) > 0 {
		council = 1
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	overrideVal := 0
	var reasonVal any
	if in.Override {
		overrideVal = 1
		reasonVal = reason
	}
	if err := tx.QueryRow(ctx, `
		insert into enrollments ("studentId","offeringId",status,"universityId","enrolledByUserId","enrollOverride","enrollOverrideReason","councilRuling","overriddenRules")
		values ($1,$2,'REGISTERED',$3,$4,$5,$6,$7,$8) returning id`,
		in.StudentID, in.OfferingID, stuUni, user.ID, overrideVal, reasonVal, council, overridden).Scan(&enrollID); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `update course_offerings set "enrolledCount" = "enrolledCount" + 1 where id = $1 and "universityId" = $2`, in.OfferingID, *uniID); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return enrollID, nil
}

func trimNum(v float64) string {
	if v == float64(int64(v)) {
		return strconv.FormatInt(int64(v), 10)
	}
	return strconv.FormatFloat(v, 'f', 2, 64)
}

func uniqueStrings(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// DropManualEnrollment حذف/اصلاح ثبت‌نام توسط کارشناس.
func (s *Service) DropManualEnrollment(ctx context.Context, user *session.User, cookie string, enrollmentID int64, reason string) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	var studentID, offeringID int64
	var status string
	var studentUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select e."studentId", e."offeringId", e.status, st."universityId"
		  from enrollments e join students st on st.id = e."studentId" where e.id = $1`, enrollmentID).
		Scan(&studentID, &offeringID, &status, &studentUni); err != nil {
		return errors.New("ثبت‌نام یافت نشد.")
	}
	if studentUni != nil && *studentUni != *uniID {
		return errors.New("این دانشجو از دانشگاه دیگری است.")
	}
	if status == "DROPPED" || status == "COMPLETED" {
		return errors.New("این ثبت‌نام قبلاً حذف/نهایی شده است.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var reasonVal any
	if strings.TrimSpace(reason) != "" {
		reasonVal = strings.TrimSpace(reason)
	}
	if _, err := tx.Exec(ctx, `
		update enrollments set status = 'DROPPED', "enrolledByUserId" = $2, "enrollOverrideReason" = $3 where id = $1`,
		enrollmentID, user.ID, reasonVal); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update course_offerings set "enrolledCount" = greatest("enrolledCount" - 1, 0) where id = $1`, offeringID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─────────────────── عملیات گروهی ───────────────────

// BulkFilter فیلتر گروه مخاطب.
type BulkFilter struct {
	TermID       int64   `json:"termId"`
	EntryYear    *int    `json:"entryYear"`
	EntryTerm    *int    `json:"entryTerm"`
	MajorID      *int64  `json:"majorId"`
	DepartmentID *int64  `json:"departmentId"`
	FacultyID    *int64  `json:"facultyId"`
	StudentIDs   []int64 `json:"studentIds"`
}

func (s *Service) bulkStudentIDs(ctx context.Context, uniID int64, f BulkFilter) ([]int64, error) {
	args := []any{}
	conds := []string{}
	if len(f.StudentIDs) > 0 {
		args = append(args, f.StudentIDs)
		conds = append(conds, fmt.Sprintf(`st.id = any($%d)`, len(args)))
		args = append(args, uniID)
		conds = append(conds, fmt.Sprintf(`st."universityId" = $%d`, len(args)))
	} else {
		args = append(args, uniID)
		conds = append(conds, `st.status = 'ACTIVE'`, fmt.Sprintf(`st."universityId" = $%d`, len(args)))
		if f.EntryYear != nil {
			args = append(args, *f.EntryYear)
			conds = append(conds, fmt.Sprintf(`st."entryYear" = $%d`, len(args)))
		}
		if f.EntryTerm != nil {
			args = append(args, *f.EntryTerm)
			conds = append(conds, fmt.Sprintf(`st."entryTerm" = $%d`, len(args)))
		}
		if f.MajorID != nil {
			args = append(args, *f.MajorID)
			conds = append(conds, fmt.Sprintf(`st."majorId" = $%d`, len(args)))
		}
		if f.DepartmentID != nil {
			args = append(args, *f.DepartmentID)
			conds = append(conds, fmt.Sprintf(`st."majorId" in (select id from majors where "departmentId" = $%d)`, len(args)))
		} else if f.FacultyID != nil {
			args = append(args, *f.FacultyID)
			conds = append(conds, fmt.Sprintf(`st."majorId" in (select id from majors where "facultyId" = $%d)`, len(args)))
		}
	}
	rows, err := s.DB.Pool.Query(ctx, `select st.id from students st where `+strings.Join(conds, " and ")+` limit 20000`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			out = append(out, id)
		}
	}
	return out, nil
}

// CountBulkStudents شمارش گروه مخاطب.
func (s *Service) CountBulkStudents(ctx context.Context, user *session.User, cookie string, f BulkFilter) (int, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال نامشخص است.")
	}
	ids, err := s.bulkStudentIDs(ctx, *uniID, f)
	return len(ids), err
}

// BulkEnrollResult نتیجهٔ عملیات گروهی.
type BulkEnrollResult struct {
	Inserted int `json:"inserted"`
	Skipped  int `json:"skipped"`
	Total    int `json:"total"`
	Dropped  int `json:"dropped"`
}

// BulkEnroll ثبت دسته‌جمعی (سقف ۳۰۰۰ ردیف).
func (s *Service) BulkEnroll(ctx context.Context, user *session.User, cookie string, f BulkFilter, offeringIDs []int64, override bool, reason string) (*BulkEnrollResult, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	if override && !s.settingBool(ctx, "ENROLL_EXPERT_OVERRIDE", true) {
		return nil, errors.New("نادیده‌گرفتن آیین‌نامه غیرمجاز است (تنظیم سازمان).")
	}
	if override && len([]rune(strings.TrimSpace(reason))) < 5 {
		return nil, errors.New("دلیل نادیده‌گرفتن (≥۵ نویسه) الزامی است.")
	}
	if len(offeringIDs) == 0 {
		return nil, errors.New("حداقل یک کلاس انتخاب کنید.")
	}
	sids, err := s.bulkStudentIDs(ctx, *uniID, f)
	if err != nil {
		return nil, err
	}
	if len(sids) == 0 {
		return nil, errors.New("هیچ دانشجویی با این فیلتر پیدا نشد.")
	}
	res := &BulkEnrollResult{Total: len(sids)}
	for _, oid := range offeringIDs {
		var offUni *int64
		var cap, enrolled int
		if err := s.DB.Pool.QueryRow(ctx, `
			select "universityId", coalesce(capacity,0), coalesce("enrolledCount",0) from course_offerings where id = $1`, oid).
			Scan(&offUni, &cap, &enrolled); err != nil {
			res.Skipped++
			continue
		}
		if offUni != nil && *offUni != *uniID {
			res.Skipped++
			continue
		}
		for _, sid := range sids {
			if res.Inserted+res.Skipped >= 3000 {
				break
			}
			var dup int
			if err := s.DB.Pool.QueryRow(ctx, `select 1 from enrollments where "studentId" = $1 and "offeringId" = $2 limit 1`, sid, oid).Scan(&dup); err == nil {
				res.Skipped++
				continue
			}
			if !override && cap > 0 && enrolled >= cap {
				res.Skipped++
				continue
			}
			overrideVal := 0
			council := 0
			var reasonVal any
			if override {
				overrideVal = 1
				reasonVal = strings.TrimSpace(reason)
				council = 1
			}
			tag, err := s.DB.Pool.Exec(ctx, `
				insert into enrollments ("studentId","offeringId",status,"universityId","enrolledByUserId","enrollOverride","enrollOverrideReason","councilRuling")
				values ($1,$2,'REGISTERED',$3,$4,$5,$6,$7)
				on conflict ("studentId","offeringId") do nothing`,
				sid, oid, offUni, user.ID, overrideVal, reasonVal, council)
			if err != nil || tag.RowsAffected() == 0 {
				res.Skipped++
				continue
			}
			res.Inserted++
			enrolled++
			_, _ = s.DB.Pool.Exec(ctx, `update course_offerings set "enrolledCount" = "enrolledCount" + 1 where id = $1 and "universityId" = $2`, oid, *uniID)
		}
	}
	return res, nil
}

// BulkDrop حذف دسته‌جمعی ثبت‌نام‌های REGISTERED.
func (s *Service) BulkDrop(ctx context.Context, user *session.User, cookie string, f BulkFilter, offeringIDs []int64, reason string) (*BulkEnrollResult, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	if len(offeringIDs) == 0 {
		return nil, errors.New("حداقل یک کلاس انتخاب کنید.")
	}
	sids, err := s.bulkStudentIDs(ctx, *uniID, f)
	if err != nil {
		return nil, err
	}
	if len(sids) == 0 {
		return nil, errors.New("هیچ دانشجویی با این فیلتر پیدا نشد.")
	}
	res := &BulkEnrollResult{Total: len(sids)}
	var reasonVal any
	if strings.TrimSpace(reason) != "" {
		reasonVal = strings.TrimSpace(reason)
	}
	for _, oid := range offeringIDs {
		var offUni *int64
		if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from course_offerings where id = $1`, oid).Scan(&offUni); err != nil {
			continue
		}
		if offUni != nil && *offUni != *uniID {
			continue
		}
		tag, err := s.DB.Pool.Exec(ctx, `
			update enrollments set status = 'DROPPED', "enrolledByUserId" = $3, "enrollOverrideReason" = $4
			 where "studentId" = any($1) and "offeringId" = $2 and status = 'REGISTERED' and "universityId" = $5`,
			sids, oid, user.ID, reasonVal, *uniID)
		if err != nil {
			continue
		}
		n := int(tag.RowsAffected())
		res.Dropped += n
		if n > 0 {
			_, _ = s.DB.Pool.Exec(ctx, `update course_offerings set "enrolledCount" = greatest("enrolledCount" - $2, 0) where id = $1`, oid, n)
		}
	}
	return res, nil
}

// ManualHistoryRow ردیف تاریخچهٔ ثبت دستی.
type ManualHistoryRow struct {
	ID          int64   `json:"id"`
	StudentCode string  `json:"studentCode"`
	StudentName string  `json:"studentName"`
	CourseCode  string  `json:"courseCode"`
	CourseTitle string  `json:"courseTitle"`
	GroupNumber int     `json:"groupNumber"`
	TermTitle   string  `json:"termTitle"`
	Who         string  `json:"who"`
	When        *string `json:"when"`
	Override    bool    `json:"override"`
	Reason      *string `json:"reason"`
}

// ManualEnrollHistory تاریخچهٔ ثبت‌های کارشناسی.
func (s *Service) ManualEnrollHistory(ctx context.Context, user *session.User, cookie string, limit int) ([]ManualHistoryRow, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := []ManualHistoryRow{}
	if uniID == nil {
		return out, nil
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select e.id, coalesce(st."studentCode",''), (su."firstName" || ' ' || su."lastName"),
		       c.code, c.title, coalesce(o."groupNumber",0), t.title,
		       coalesce((wu."firstName" || ' ' || wu."lastName"), '—'),
		       e."registeredAt", coalesce(e."enrollOverride",0), e."enrollOverrideReason"
		  from enrollments e
		  join students st on st.id = e."studentId"
		  join users su on su.id = st."userId"
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		  join academic_terms t on t.id = o."termId"
		  left join users wu on wu.id = e."enrolledByUserId"
		 where e."enrolledByUserId" is not null and e."universityId" = $1
		 order by e.id desc limit $2`, *uniID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r ManualHistoryRow
		var when *time.Time
		var ov int
		if err := rows.Scan(&r.ID, &r.StudentCode, &r.StudentName, &r.CourseCode, &r.CourseTitle,
			&r.GroupNumber, &r.TermTitle, &r.Who, &when, &ov, &r.Reason); err == nil {
			r.Override = ov != 0
			if when != nil {
				v := when.UTC().Format(time.RFC3339)
				r.When = &v
			}
			out = append(out, r)
		}
	}
	return out, nil
}

// ActivateTermForFilter فعال/غیرفعال کردن دانشجویان فیلتر در یک ترم.
func (s *Service) ActivateTermForFilter(ctx context.Context, user *session.User, cookie string, f BulkFilter, active bool) (int, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال نامشخص است.")
	}
	var termCode string
	var termUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "termCode", "universityId" from academic_terms where id = $1`, f.TermID).
		Scan(&termCode, &termUni); err != nil {
		return 0, errors.New("ترم یافت نشد.")
	}
	if termUni != nil && *termUni != *uniID {
		return 0, errors.New("این ترم متعلق به دانشگاه دیگری است.")
	}
	sids, err := s.bulkStudentIDs(ctx, *uniID, f)
	if err != nil {
		return 0, err
	}
	if len(sids) == 0 {
		return 0, errors.New("هیچ دانشجویی با این فیلتر پیدا نشد.")
	}
	statusCode := "INACTIVE"
	statusTitle := "غیرفعال در ترم"
	if active {
		statusCode = "ACTIVE"
		statusTitle = "فعال در ترم"
	}
	for _, sid := range sids {
		_, _ = s.DB.Pool.Exec(ctx, `
			insert into student_term_states ("studentId","termId","termCode","statusCode","statusTitle","activatedByUserId","activatedAt","universityId")
			values ($1,$2,$3,$4,$5,$6,now(),$7)
			on conflict ("studentId","termId") do update set "statusCode" = excluded."statusCode",
			  "statusTitle" = excluded."statusTitle", "activatedByUserId" = excluded."activatedByUserId", "activatedAt" = now()`,
			sid, f.TermID, termCode, statusCode, statusTitle, user.ID, termUni)
	}
	return len(sids), nil
}

// CatalogOffering ردیف کاتالوگ دانشجو برای کارشناس.
type CatalogOffering struct {
	ManualOffering
	CourseID         int64    `json:"courseId"`
	Offered          bool     `json:"offered"`
	AlreadyEnrolled  bool     `json:"alreadyEnrolled"`
	EnrollmentID     *int64   `json:"enrollmentId"`
	EnrollmentStatus *string  `json:"enrollmentStatus"`
	Prereq           *string  `json:"prereq"`
	PrereqMissing    *string  `json:"prereqMissing"`
	Conflicts        []string `json:"conflicts"`
	Scope            string   `json:"scope"`
}

// CatalogEnrollment درس ثبت‌شدهٔ فعلی.
type CatalogEnrollment struct {
	EnrollmentID  int64    `json:"enrollmentId"`
	OfferingID    int64    `json:"offeringId"`
	CourseID      int64    `json:"courseId"`
	Code          string   `json:"code"`
	Title         string   `json:"title"`
	GroupNumber   int      `json:"groupNumber"`
	Units         *float64 `json:"units"`
	Status        string   `json:"status"`
	ProfessorName string   `json:"professorName"`
	RegisteredAt  *string  `json:"registeredAt"`
	Override      bool     `json:"override"`
}

// CatalogChart خلاصهٔ چارت/سقف.
type CatalogChart struct {
	VersionCode       *string  `json:"versionCode"`
	Title             *string  `json:"title"`
	ChartCount        int      `json:"chartCount"`
	CommonCount       int      `json:"commonCount"`
	OtherCount        int      `json:"otherCount"`
	Message           *string  `json:"message,omitempty"`
	EffectiveMaxUnits *float64 `json:"effectiveMaxUnits"`
	CurrentUnits      float64  `json:"currentUnits"`
}

// CatalogResult پاسخ کاتالوگ.
type CatalogResult struct {
	Items             []CatalogOffering   `json:"items"`
	Enrolled          []CatalogEnrollment `json:"enrolled"`
	Chart             CatalogChart        `json:"chart"`
	ChartOfferedCount int                 `json:"chartOfferedCount"`
	ChartTotalCount   int                 `json:"chartTotalCount"`
}

// StudentCatalog کاتالوگ همان دانشجو برای کارشناس (چارت/مشترک/سایر + پیش‌نیاز/تداخل).
func (s *Service) StudentCatalog(ctx context.Context, user *session.User, cookie string, studentID, termID int64, q string) (*CatalogResult, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := &CatalogResult{Items: []CatalogOffering{}, Enrolled: []CatalogEnrollment{}, Chart: CatalogChart{}}
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	var stuUni *int64
	var majorID *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId", "majorId" from students where id = $1`, studentID).
		Scan(&stuUni, &majorID); err != nil {
		return nil, errors.New("دانشجو یافت نشد.")
	}
	if stuUni != nil && *stuUni != *uniID {
		return nil, errors.New("این دانشجو از دانشگاه دیگری است.")
	}

	// چارت
	chartCourseIDs := map[int64]bool{}
	if version, err := enroll.ResolveStudentCurriculum(ctx, s.DB.Pool, studentID); err == nil && version != nil {
		vc := version.VersionCode
		out.Chart.VersionCode = &vc
		var title string
		_ = s.DB.Pool.QueryRow(ctx, `select title from curriculum_versions where id = $1`, version.ID).Scan(&title)
		if title != "" {
			out.Chart.Title = &title
		}
		if rows, err := s.DB.Pool.Query(ctx, `
			select "courseId" from curriculum_courses where "curriculumVersionId" = $1`, version.ID); err == nil {
			for rows.Next() {
				var id int64
				if err := rows.Scan(&id); err == nil {
					chartCourseIDs[id] = true
				}
			}
			rows.Close()
		}
	} else {
		msg := "برای این رشته/سال ورود نسخهٔ برنامهٔ درسی قابل اعمالی ثبت نشده است."
		out.Chart.Message = &msg
	}

	type enrolledRow struct {
		CourseID     int64
		EnrollmentID int64
		Status       string
	}
	enrolled := []enrolledRow{}
	erows, err := s.DB.Pool.Query(ctx, `
		select c.id, e.id, e.status
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1 and o."termId" = $2
		   and e.status in ('REGISTERED','WAITLISTED','PENDING_COUNCIL')`, studentID, termID)
	if err == nil {
		for erows.Next() {
			var r enrolledRow
			if err := erows.Scan(&r.CourseID, &r.EnrollmentID, &r.Status); err == nil {
				enrolled = append(enrolled, r)
			}
		}
		erows.Close()
	}
	enrollByCourse := map[int64]enrolledRow{}
	for _, e := range enrolled {
		enrollByCourse[e.CourseID] = e
	}

	// ارائه‌ها
	type row struct {
		OfferingID    int64
		CourseID      int64
		Code, Title   string
		GroupNumber   int
		Units         *float64
		Capacity      int
		Enrolled      int
		OfferingScope *string
		DeptKind      *string
		ProfessorName string
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.id, c.code, c.title, coalesce(o."groupNumber",0), c.units::float8,
		       coalesce(o.capacity,0), coalesce(o."enrolledCount",0), c."offeringScope", to_jsonb(d)->>'kind',
		       coalesce(nullif(trim(u."firstName" || ' ' || u."lastName"),''), '—')
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join departments d on d.id = c."departmentId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		 where o."termId" = $1 and coalesce(o."isActive",1) = 1 and o."universityId" = $2
		 order by c.title, o."groupNumber" limit 4000`, termID, *uniID)
	if err != nil {
		return nil, err
	}
	offerings := []row{}
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.OfferingID, &r.CourseID, &r.Code, &r.Title, &r.GroupNumber, &r.Units,
			&r.Capacity, &r.Enrolled, &r.OfferingScope, &r.DeptKind, &r.ProfessorName); err == nil {
			offerings = append(offerings, r)
		}
	}
	rows.Close()

	pctx, _ := enroll.BuildPrereqContext(ctx, s.DB.Pool, studentID)
	conflicts := s.conflictIndex(ctx, studentID, termID)

	var currentUnits float64
	_ = s.DB.Pool.QueryRow(ctx, `
		select coalesce(sum(c.units),0)::float8 from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1 and o."termId" = $2 and e.status in ('REGISTERED','PENDING_COUNCIL')`,
		studentID, termID).Scan(&currentUnits)
	if summary, err := enroll.EvaluateStudentRegulationStatus(ctx, s.DB.Pool, studentID, &termID); err == nil && summary != nil {
		v := summary.EffectiveMaxUnits
		out.Chart.EffectiveMaxUnits = &v
	}
	out.Chart.CurrentUnits = currentUnits

	// درس‌های ثبت‌شده
	crows, err := s.DB.Pool.Query(ctx, `
		select e.id, e."offeringId", c.id, c.code, c.title, coalesce(o."groupNumber",0), c.units::float8,
		       e.status, coalesce(nullif(trim(u."firstName" || ' ' || u."lastName"),''), '—'),
		       e."registeredAt", coalesce(e."enrollOverride",0)
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		 where e."studentId" = $1 and o."termId" = $2
		   and e.status in ('REGISTERED','WAITLISTED','PENDING_COUNCIL')
		 order by c.title`, studentID, termID)
	if err == nil {
		for crows.Next() {
			var e CatalogEnrollment
			var when *time.Time
			var ov int
			if err := crows.Scan(&e.EnrollmentID, &e.OfferingID, &e.CourseID, &e.Code, &e.Title, &e.GroupNumber,
				&e.Units, &e.Status, &e.ProfessorName, &when, &ov); err == nil {
				e.Override = ov != 0
				if when != nil {
					v := when.UTC().Format(time.RFC3339)
					e.RegisteredAt = &v
				}
				out.Enrolled = append(out.Enrolled, e)
			}
		}
		crows.Close()
	}

	needle := strings.ToLower(fa.ToEnDigits(strings.TrimSpace(q)))
	offeredCourseIDs := map[int64]bool{}
	for _, r := range offerings {
		offeredCourseIDs[r.CourseID] = true
		scope := "other"
		if chartCourseIDs[r.CourseID] {
			scope = "chart"
			out.Chart.ChartCount++
		} else if (r.DeptKind != nil && *r.DeptKind == "GENERAL") ||
			(r.OfferingScope != nil && (*r.OfferingScope == "GENERAL_SERVICE" || *r.OfferingScope == "UNIVERSITY_WIDE")) {
			scope = "common"
			out.Chart.CommonCount++
		} else {
			out.Chart.OtherCount++
		}
		if needle != "" {
			hay := strings.ToLower(fa.ToEnDigits(r.Code + " " + r.Title))
			if !strings.Contains(hay, needle) {
				continue
			}
		}
		item := CatalogOffering{
			ManualOffering: ManualOffering{
				OfferingID: r.OfferingID, Code: r.Code, Title: r.Title, GroupNumber: r.GroupNumber,
				Units: r.Units, Capacity: r.Capacity, EnrolledCount: r.Enrolled, ProfessorName: r.ProfessorName,
			},
			CourseID: r.CourseID, Offered: true, Scope: scope,
			Conflicts: conflicts[r.OfferingID],
		}
		if item.Conflicts == nil {
			item.Conflicts = []string{}
		}
		if pctx != nil {
			if rule := pctx.RuleByCourse[r.CourseID]; rule != nil {
				if label := enroll.FormatPrereq(rule, pctx.Titles); label != "" {
					item.Prereq = &label
				}
				if ok, missing := enroll.EvaluateLogicTree(rule, pctx.Passed); !ok {
					names := []string{}
					for _, c := range missing {
						if t, ok := pctx.Titles[c]; ok && t != "" {
							names = append(names, t)
						} else {
							names = append(names, c)
						}
					}
					msg := strings.Join(names, "، ")
					item.PrereqMissing = &msg
				}
			}
		}
		if e, ok := enrollByCourse[r.CourseID]; ok {
			item.AlreadyEnrolled = true
			id := e.EnrollmentID
			st := e.Status
			item.EnrollmentID = &id
			item.EnrollmentStatus = &st
		}
		out.Items = append(out.Items, item)
	}
	out.ChartOfferedCount = out.Chart.ChartCount
	out.ChartTotalCount = len(chartCourseIDs)

	// دروس چارتی که در ترم ارائه نشده‌اند
	missing := []int64{}
	for id := range chartCourseIDs {
		if !offeredCourseIDs[id] {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		sort.Slice(missing, func(i, j int) bool { return missing[i] < missing[j] })
		mrows, err := s.DB.Pool.Query(ctx, `
			select id, code, title, units::float8 from courses where id = any($1) order by title limit 2000`, missing)
		if err == nil {
			for mrows.Next() {
				var id int64
				var code, title string
				var units *float64
				if err := mrows.Scan(&id, &code, &title, &units); err != nil {
					continue
				}
				if needle != "" {
					hay := strings.ToLower(fa.ToEnDigits(code + " " + title))
					if !strings.Contains(hay, needle) {
						continue
					}
				}
				item := CatalogOffering{
					ManualOffering: ManualOffering{OfferingID: 0, Code: code, Title: title, GroupNumber: 0, Units: units, ProfessorName: "—"},
					CourseID:       id, Offered: false, Scope: "chart", Conflicts: []string{},
				}
				if pctx != nil {
					if rule := pctx.RuleByCourse[id]; rule != nil {
						if label := enroll.FormatPrereq(rule, pctx.Titles); label != "" {
							item.Prereq = &label
						}
						if ok, miss := enroll.EvaluateLogicTree(rule, pctx.Passed); !ok {
							names := []string{}
							for _, c := range miss {
								if t, ok := pctx.Titles[c]; ok && t != "" {
									names = append(names, t)
								} else {
									names = append(names, c)
								}
							}
							msg := strings.Join(names, "، ")
							item.PrereqMissing = &msg
						}
					}
				}
				if e, ok := enrollByCourse[id]; ok {
					item.AlreadyEnrolled = true
					eid := e.EnrollmentID
					st := e.Status
					item.EnrollmentID = &eid
					item.EnrollmentStatus = &st
				}
				out.Items = append(out.Items, item)
			}
			mrows.Close()
		}
	}
	return out, nil
}

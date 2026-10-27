// ═══ دفترچهٔ نمرات استاد — پورت professor/grades ═══
package professor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"backend-go/internal/jalali"
	"backend-go/internal/otp"
)

// GradeStudent دانشجو در دفترچه.
type GradeStudent struct {
	StudentID    int64    `json:"studentId"`
	StudentCode  string   `json:"studentCode"`
	FullName     string   `json:"fullName"`
	EnrollmentID int64    `json:"enrollmentId"`
	OfferingID   int64    `json:"enrollmentOfferingId"`
	EntryYear    int      `json:"entryYear"`
	GradeValue   *float64 `json:"gradeValue"`
	GradeStatus  string   `json:"status"`
	SamaCode     *string  `json:"samaGradeStatusCode"`
}

// GradeAppeal اعتراض دانشجو.
type GradeAppeal struct {
	ID                   int64    `json:"id"`
	StudentID            int64    `json:"studentId"`
	StudentCode          string   `json:"studentCode"`
	FullName             string   `json:"fullName"`
	CurrentGrade         *float64 `json:"currentGrade"`
	StudentMessage       string   `json:"studentMessage"`
	Status               string   `json:"status"`
	ProfessorReply       *string  `json:"professorReply"`
	NewGrade             *float64 `json:"newGrade"`
	CreatedAt            *string  `json:"createdAt"`
	EnrollmentOfferingID int64    `json:"enrollmentOfferingId"`
}

// Rubric بارم پیش‌فرض.
type Rubric struct {
	Midterm       float64 `json:"midterm"`
	Homework      float64 `json:"homework"`
	Participation float64 `json:"participation"`
	Practical     float64 `json:"practical"`
	FinalExam     float64 `json:"finalExam"`
}

// GradeOffering ارائه در دفترچه.
type GradeOffering struct {
	ID                 int64          `json:"id"`
	Code               string         `json:"code"`
	Title              string         `json:"title"`
	GroupNumber        int            `json:"groupNumber"`
	Units              float64        `json:"units"`
	CourseType         string         `json:"courseType"`
	IsCoTaught         bool           `json:"isCoTaught"`
	CoRole             *string        `json:"coTaughtRole"`
	CoPartnerName      *string        `json:"coPartnerName"`
	IsFinalized        bool           `json:"isFinalized"`
	FinalizedAt        *string        `json:"finalizedAt"`
	FinalSignatureHash *string        `json:"finalSignatureHash"`
	GradeDeadline      *string        `json:"gradeDeadline"`
	IsThesis           bool           `json:"isThesis"`
	Rubric             Rubric         `json:"rubric"`
	Students           []GradeStudent `json:"students"`
	Appeals            []GradeAppeal  `json:"appeals"`
}

// GradesResponse پاسخ دفترچه.
type GradesResponse struct {
	Professor ProfessorInfo   `json:"professor"`
	Term      TermInfo        `json:"term"`
	Offerings []GradeOffering `json:"offerings"`
}

// GetGrades پورت professor/grades/page.tsx (بدون دادهٔ دمو).
func (s *Service) GetGrades(ctx context.Context, userID int64, cookie *int64) (*GradesResponse, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, errNoStaff
	}
	term := s.ResolveTerm(ctx, st.UniversityID, cookie)
	resp := &GradesResponse{Professor: s.professorInfo(ctx, st), Term: term, Offerings: []GradeOffering{}}
	if term.ID == nil {
		return resp, nil
	}

	type offRow struct {
		ID           int64
		Code         string
		Title        string
		Units        float64
		Group        int
		Nature       string
		ProfessorID  *int64
		IsActive     int
		FinalizedAt  *time.Time
		GradesHash   *string
		OfferingType string
	}
	orows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.code, c.title, c.units, coalesce(o."groupNumber",0),
		       coalesce(c."courseNature",''), o."professorId", coalesce(o."isActive",1),
		       o."gradesFinalizedAt", o."gradesHash", coalesce(o."offeringType",'NORMAL')
		  from course_offerings o join courses c on c.id = o."courseId"
		 where o."termId" = $1 and (o."professorId" = $2 or exists (
		       select 1 from offering_professors op where op."offeringId" = o.id and op."staffId" = $2))
		 order by c.title, o."groupNumber"`, *term.ID, st.ID)
	if err != nil {
		return nil, err
	}
	offerings := []offRow{}
	for orows.Next() {
		var o offRow
		if err := orows.Scan(&o.ID, &o.Code, &o.Title, &o.Units, &o.Group, &o.Nature,
			&o.ProfessorID, &o.IsActive, &o.FinalizedAt, &o.GradesHash, &o.OfferingType); err == nil {
			offerings = append(offerings, o)
		}
	}
	orows.Close()
	if len(offerings) == 0 {
		return resp, nil
	}
	offeringIDs := []int64{}
	for _, o := range offerings {
		offeringIDs = append(offeringIDs, o.ID)
	}

	// همکاران درس مشترک و نقش.
	type coRow struct {
		OfferingID int64
		StaffID    int64
		Role       string
		Share      float64
		Name       string
	}
	coRows := []coRow{}
	crows, err := s.DB.Pool.Query(ctx, `
		select op."offeringId", op."staffId", coalesce(op.role,''), coalesce(op."sharePercentage",0),
		       coalesce(u."firstName" || ' ' || u."lastName",'')
		  from offering_professors op
		  join staff st on st.id = op."staffId"
		  join users u on u.id = st."userId"
		 where op."offeringId" = any($1)`, offeringIDs)
	if err == nil {
		for crows.Next() {
			var r coRow
			if err := crows.Scan(&r.OfferingID, &r.StaffID, &r.Role, &r.Share, &r.Name); err == nil {
				coRows = append(coRows, r)
			}
		}
		crows.Close()
	}
	coByOffering := map[int64][]coRow{}
	for _, r := range coRows {
		coByOffering[r.OfferingID] = append(coByOffering[r.OfferingID], r)
	}

	// دانشجویان.
	srows, err := s.DB.Pool.Query(ctx, `
		select e.id, e."offeringId", e."studentId", st."studentCode",
		       coalesce(u."firstName" || ' ' || u."lastName",''),
		       st."entryYear", e."gradeValue", coalesce(e."gradeStatus",'PENDING'), e."samaGradeStatusCode"
		  from enrollments e
		  join students st on st.id = e."studentId"
		  join users u on u.id = st."userId"
		 where e."offeringId" = any($1) and e.status <> 'DROPPED'
		 order by u."lastName", u."firstName"`, offeringIDs)
	if err != nil {
		return nil, err
	}
	studentsByOffering := map[int64][]GradeStudent{}
	for srows.Next() {
		var gs GradeStudent
		if err := srows.Scan(&gs.EnrollmentID, &gs.OfferingID, &gs.StudentID, &gs.StudentCode,
			&gs.FullName, &gs.EntryYear, &gs.GradeValue, &gs.GradeStatus, &gs.SamaCode); err == nil {
			gs.FullName = strings.TrimSpace(gs.FullName)
			studentsByOffering[gs.OfferingID] = append(studentsByOffering[gs.OfferingID], gs)
		}
	}
	srows.Close()

	// اعتراض‌ها.
	appealsByOffering := map[int64][]GradeAppeal{}
	arows, err := s.DB.Pool.Query(ctx, `
		select a.id, a."enrollmentId", e."studentId", st."studentCode",
		       coalesce(u."firstName" || ' ' || u."lastName",''), e."gradeValue",
		       coalesce(a."studentMessage",''), coalesce(a.status,'OPEN'),
		       a."professorReply", a."newGrade", a."createdAt"::text, e."offeringId"
		  from grade_appeals a
		  join enrollments e on e.id = a."enrollmentId"
		  join students st on st.id = e."studentId"
		  join users u on u.id = st."userId"
		 where e."offeringId" = any($1)
		 order by a.id desc`, offeringIDs)
	if err == nil {
		for arows.Next() {
			var a GradeAppeal
			if err := arows.Scan(&a.ID, new(int64), &a.StudentID, &a.StudentCode, &a.FullName,
				&a.CurrentGrade, &a.StudentMessage, &a.Status, &a.ProfessorReply,
				&a.NewGrade, &a.CreatedAt, &a.EnrollmentOfferingID); err == nil {
				a.FullName = strings.TrimSpace(a.FullName)
				appealsByOffering[a.EnrollmentOfferingID] = append(appealsByOffering[a.EnrollmentOfferingID], a)
			}
		}
		arows.Close()
	}

	for _, o := range offerings {
		coList := coByOffering[o.ID]
		isCo := len(coList) >= 2
		var role *string
		var partner *string
		if isCo {
			for _, r := range coList {
				if r.StaffID == st.ID {
					v := "THEORY"
					if strings.EqualFold(r.Role, "PRACTICAL") || strings.EqualFold(r.Role, "LAB") {
						v = "LAB"
					}
					role = &v
				}
			}
			sorted := append([]coRow{}, coList...)
			sort.SliceStable(sorted, func(a, b int) bool { return sorted[a].Share > sorted[b].Share })
			if sorted[0].StaffID != st.ID {
				p := strings.TrimSpace(sorted[0].Name)
				partner = &p
			}
		}
		finalizedAt := (*string)(nil)
		if o.FinalizedAt != nil {
			v := o.FinalizedAt.Format(time.RFC3339)
			finalizedAt = &v
		}
		item := GradeOffering{
			ID: o.ID, Code: o.Code, Title: o.Title, GroupNumber: o.Group, Units: o.Units,
			CourseType: mapCourseType(o.Nature), IsCoTaught: isCo, CoRole: role, CoPartnerName: partner,
			IsFinalized: o.FinalizedAt != nil, FinalizedAt: finalizedAt,
			FinalSignatureHash: o.GradesHash, GradeDeadline: term.GradeDeadline,
			IsThesis: strings.Contains(strings.ToLower(o.OfferingType), "THESIS") || strings.Contains(o.Title, "پایان‌نامه"),
			Rubric:   Rubric{Midterm: 5, Homework: 3, Participation: 2, Practical: 0, FinalExam: 10},
			Students: studentsByOffering[o.ID], Appeals: appealsByOffering[o.ID],
		}
		if item.Students == nil {
			item.Students = []GradeStudent{}
		}
		if item.Appeals == nil {
			item.Appeals = []GradeAppeal{}
		}
		resp.Offerings = append(resp.Offerings, item)
	}
	return resp, nil
}

func (s *Service) ownsOffering(ctx context.Context, staffID, offeringID int64) (bool, error) {
	var professorID *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "professorId" from course_offerings where id = $1`, offeringID).Scan(&professorID); err != nil {
		return false, errors.New("ارائهٔ درس یافت نشد.")
	}
	if professorID != nil && *professorID == staffID {
		return true, nil
	}
	var one int
	if err := s.DB.Pool.QueryRow(ctx, `
		select 1 from offering_professors where "offeringId" = $1 and "staffId" = $2 limit 1`,
		offeringID, staffID).Scan(&one); err == nil {
		return true, nil
	}
	return false, errors.New("شما استاد مسئول این درس نیستید.")
}

func (s *Service) logGradeChange(ctx context.Context, enrollmentID, studentID, offeringID int64, action string, newValue *float64, newStatus, reason string, userID int64) {
	var oldValue *float64
	var oldStatus *string
	_ = s.DB.Pool.QueryRow(ctx, `
		select "gradeValue", "gradeStatus" from enrollments where id = $1`, enrollmentID).Scan(&oldValue, &oldStatus)
	details, _ := json.Marshal(map[string]any{})
	_ = details
	_, _ = s.DB.Pool.Exec(ctx, `
		insert into grade_change_log ("enrollmentId","studentId","offeringId",action,
		       "oldGradeValue","newGradeValue","oldGradeStatus","newGradeStatus","actorUserId","actorRole",reason)
		values ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8,'PROFESSOR',$9)`,
		enrollmentID, studentID, offeringID, oldValue, newValue, oldStatus, newStatus, userID, reason)
}

// SaveScore ذخیرهٔ نمرهٔ نهایی یک دانشجو (DRAFT) با قفل نهایی.
func (s *Service) SaveScore(ctx context.Context, userID, offeringID, studentID int64, value *float64) error {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return errNoStaff
	}
	owned, err := s.ownsOffering(ctx, st.ID, offeringID)
	if err != nil || !owned {
		return err
	}
	var finalizedAt *time.Time
	_ = s.DB.Pool.QueryRow(ctx, `select "gradesFinalizedAt" from course_offerings where id = $1`, offeringID).Scan(&finalizedAt)
	if finalizedAt != nil {
		return errors.New("نمرات این ارائه نهایی شده است؛ تغییر فقط با بازگشایی توسط مدیر.")
	}
	if value != nil && (*value < 0 || *value > 20) {
		return errors.New("نمره باید بین ۰ تا ۲۰ باشد.")
	}
	var enrollmentID int64
	err = s.DB.Pool.QueryRow(ctx, `
		select id from enrollments where "offeringId" = $1 and "studentId" = $2 limit 1`, offeringID, studentID).Scan(&enrollmentID)
	if err != nil {
		return errors.New("دانشجو در این درس ثبت‌نام نشده است.")
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		update enrollments set "gradeValue" = $1, "gradeStatus" = 'DRAFT' where id = $2`, value, enrollmentID); err != nil {
		return err
	}
	s.logGradeChange(ctx, enrollmentID, studentID, offeringID, "DRAFT", value, "DRAFT", "ویرایش نمره توسط استاد", userID)
	return nil
}

// SubmitTemporary ثبت موقت همهٔ نمرات درس.
func (s *Service) SubmitTemporary(ctx context.Context, userID, offeringID int64) error {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return errNoStaff
	}
	owned, err := s.ownsOffering(ctx, st.ID, offeringID)
	if err != nil || !owned {
		return err
	}
	var finalizedAt *time.Time
	_ = s.DB.Pool.QueryRow(ctx, `select "gradesFinalizedAt" from course_offerings where id = $1`, offeringID).Scan(&finalizedAt)
	if finalizedAt != nil {
		return errors.New("نمرات این ارائه نهایی شده است؛ ثبت موقت مجدد فقط با بازگشایی توسط مدیر امکان‌پذیر است.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `update course_offerings set "gradesTemporaryAt" = now() where id = $1`, offeringID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update enrollments set "gradeStatus" = 'TEMPORARY' where "offeringId" = $1`, offeringID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RequestFinalizeOTP صدور کد نهایی‌سازی.
func (s *Service) RequestFinalizeOTP(ctx context.Context, userID, offeringID int64) (string, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return "", errNoStaff
	}
	owned, err := s.ownsOffering(ctx, st.ID, offeringID)
	if err != nil || !owned {
		return "", err
	}
	var recent int
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*) from grade_submission_otps where "staffId" = $1 and "offeringId" = $2
		   and "createdAt" > now() - interval '15 minutes'`, st.ID, offeringID).Scan(&recent)
	if recent >= 3 {
		return "", errors.New("تعداد درخواست کد بیش از حد مجاز است. چند دقیقهٔ دیگر دوباره تلاش کنید.")
	}
	pepper, err := otp.Pepper(s.Production)
	if err != nil {
		return "", err
	}
	code, err := otp.NewCode()
	if err != nil {
		return "", err
	}
	hash := otp.Digest(pepper, code, fmt.Sprintf("grade:%d:%d", st.ID, offeringID))
	if _, err := s.DB.Pool.Exec(ctx, `
		delete from grade_submission_otps where "staffId" = $1 and "offeringId" = $2`, st.ID, offeringID); err != nil {
		return "", err
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		insert into grade_submission_otps ("staffId","offeringId","otpHash","expiresAt")
		values ($1,$2,$3, now() + interval '5 minutes')`, st.ID, offeringID, hash); err != nil {
		return "", err
	}
	text := "کد تأیید قفل نهایی نمرات (آفاق): " + code + " — تا ۵ دقیقه معتبر است."
	payload, _ := json.Marshal(map[string]string{"text": text})
	_, _ = s.DB.Pool.Exec(ctx, `
		insert into notifications ("userId","eventCode",payload) values ($1,'GRADE_FINALIZE_OTP',$2)`,
		st.UserID, string(payload))
	if s.Production {
		return "", nil
	}
	return code, nil
}

// Finalize با OTP، زنجیرهٔ هش و ثبت وضعیت نهایی.
func (s *Service) Finalize(ctx context.Context, userID, offeringID int64, code string) error {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return errNoStaff
	}
	owned, err := s.ownsOffering(ctx, st.ID, offeringID)
	if err != nil || !owned {
		return err
	}
	var (
		rowID     int64
		hash      string
		expiresAt time.Time
		isUsed    int
		attempts  int
		lockedAt  *time.Time
	)
	err = s.DB.Pool.QueryRow(ctx, `
		select id, "otpHash", "expiresAt", coalesce("isUsed",0), coalesce(attempts,0), "lockedAt"
		  from grade_submission_otps
		 where "staffId" = $1 and "offeringId" = $2 and coalesce("isUsed",0) = 0
		 order by id desc limit 1`, st.ID, offeringID).
		Scan(&rowID, &hash, &expiresAt, &isUsed, &attempts, &lockedAt)
	if err != nil {
		return errors.New("کد تأییدی فعالی وجود ندارد؛ دوباره درخواست کد بدهید.")
	}
	if expiresAt.Before(time.Now()) {
		return errors.New("کد تأیید منقضی شده است؛ کد جدید بگیرید.")
	}
	if lockedAt != nil {
		return errors.New("به دلیل تلاش‌های ناموفق، درخواست امضا قفل شده است.")
	}
	pepper, err := otp.Pepper(s.Production)
	if err != nil {
		return err
	}
	inputHash := otp.Digest(pepper, code, fmt.Sprintf("grade:%d:%d", st.ID, offeringID))
	if !otp.Equal(inputHash, hash) && !otp.Equal(otp.LegacyDigest(code), hash) {
		attempts++
		var locked any
		if attempts >= 5 {
			locked = time.Now()
		}
		_, _ = s.DB.Pool.Exec(ctx, `update grade_submission_otps set attempts = $1, "lockedAt" = $2 where id = $3`, attempts, locked, rowID)
		return fmt.Errorf("کد تأیید نادرست است. (تلاش %d از ۵)", attempts)
	}

	// هش زنجیره‌ای از نمرات ذخیره‌شده.
	type gradeRow struct {
		ID         int64
		StudentID  int64
		GradeValue *float64
		Status     string
	}
	grows, err := s.DB.Pool.Query(ctx, `
		select id, "studentId", "gradeValue", coalesce("gradeStatus",'PENDING')
		  from enrollments where "offeringId" = $1 order by "studentId"`, offeringID)
	if err != nil {
		return err
	}
	grades := []gradeRow{}
	for grows.Next() {
		var g gradeRow
		if err := grows.Scan(&g.ID, &g.StudentID, &g.GradeValue, &g.Status); err == nil {
			grades = append(grades, g)
		}
	}
	grows.Close()
	var prevHash *string
	_ = s.DB.Pool.QueryRow(ctx, `select "gradesHash" from course_offerings where id = $1`, offeringID).Scan(&prevHash)
	now := time.Now()
	chainGrades := []any{}
	for _, g := range grades {
		chainGrades = append(chainGrades, []any{g.StudentID, g.GradeValue, "FINALIZED"})
	}
	chainInput, _ := json.Marshal(map[string]any{
		"offeringId": offeringID, "finalizedAt": now.UTC().Format("2006-01-02T15:04:05.000Z"),
		"prevHash": prevHash, "grades": chainGrades,
	})
	sum := sha256.Sum256(chainInput)
	memberHash := "SHA256:" + hex.EncodeToString(sum[:])

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `update grade_submission_otps set "isUsed" = 1 where id = $1`, rowID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update course_offerings set "gradesFinalizedAt" = $1, "gradesHash" = $2 where id = $3`,
		now, memberHash, offeringID); err != nil {
		return err
	}
	for _, g := range grades {
		if _, err := tx.Exec(ctx, `
			update enrollments set "gradeStatus" = 'FINALIZED' where id = $1`, g.ID); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	for _, g := range grades {
		s.logGradeChange(ctx, g.ID, g.StudentID, offeringID, "FINALIZED", g.GradeValue, "FINALIZED", "نهایی‌سازی نمرات با OTP", userID)
	}
	return nil
}

// ResolveAppeal رسیدگی به اعتراض.
type AppealDecision struct {
	AppealID int64    `json:"appealId"`
	Decision string   `json:"decision"`
	NewGrade *float64 `json:"newGrade"`
	Reply    string   `json:"reply"`
}

// ResolveAppealAction پورت resolveAppealAction.
func (s *Service) ResolveAppealAction(ctx context.Context, userID int64, input AppealDecision) error {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return errNoStaff
	}
	if input.Decision != "ACCEPTED" && input.Decision != "REJECTED" {
		return errors.New("تصمیم نامعتبر است.")
	}
	if input.Decision == "ACCEPTED" && (input.NewGrade == nil || *input.NewGrade < 0 || *input.NewGrade > 20) {
		return errors.New("نمرهٔ جدید باید بین ۰ تا ۲۰ باشد.")
	}
	if len([]rune(input.Reply)) > 1000 {
		return errors.New("متن پاسخ بیش از حد طولانی است.")
	}
	var (
		enrollmentID int64
		offeringID   int64
		studentID    int64
		status       string
	)
	err = s.DB.Pool.QueryRow(ctx, `
		select a."enrollmentId", e."offeringId", e."studentId", coalesce(a.status,'OPEN')
		  from grade_appeals a join enrollments e on e.id = a."enrollmentId"
		 where a.id = $1`, input.AppealID).
		Scan(&enrollmentID, &offeringID, &studentID, &status)
	if err != nil {
		return errors.New("اعتراض یافت نشد.")
	}
	if status != "OPEN" {
		return errors.New("اعتراض یافت نشد یا قبلاً بسته شده است.")
	}
	owned, err := s.ownsOffering(ctx, st.ID, offeringID)
	if err != nil || !owned {
		return errors.New("شما استاد مسئول این درس نیستید.")
	}
	var reply *string
	if strings.TrimSpace(input.Reply) != "" {
		v := strings.TrimSpace(input.Reply)
		reply = &v
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `
		update grade_appeals set status = $1, "professorReply" = $2, "newGrade" = $3 where id = $4`,
		input.Decision, reply, input.NewGrade, input.AppealID); err != nil {
		return err
	}
	if input.Decision == "ACCEPTED" && input.NewGrade != nil {
		if _, err := tx.Exec(ctx, `
			update enrollments set "gradeValue" = $1, "gradeStatus" = 'FINALIZED' where id = $2`,
			input.NewGrade, enrollmentID); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if input.Decision == "ACCEPTED" && input.NewGrade != nil {
		s.logGradeChange(ctx, enrollmentID, studentID, offeringID, "APPEAL", input.NewGrade, "FINALIZED", "پذیرش اعتراض", userID)
	}
	return nil
}

// UnfinalizeRequest درخواست بازگشایی.
type UnfinalizeRequest struct {
	ID         int64   `json:"id"`
	OfferingID int64   `json:"offeringId"`
	Reason     string  `json:"reason"`
	Status     string  `json:"status"`
	CreatedAt  *string `json:"createdAt"`
	ReviewNote *string `json:"reviewNote"`
}

// RequestUnfinalize ثبت درخواست بازگشایی نمرات.
func (s *Service) RequestUnfinalize(ctx context.Context, userID, offeringID int64, reason string) error {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return errNoStaff
	}
	owned, err := s.ownsOffering(ctx, st.ID, offeringID)
	if err != nil || !owned {
		return err
	}
	reason = strings.TrimSpace(reason)
	if len([]rune(reason)) < 5 {
		return errors.New("دلیل درخواست را کامل بنویسید.")
	}
	var open int
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*) from grade_unfinalize_requests where "offeringId" = $1 and status = 'PENDING'`, offeringID).Scan(&open)
	if open > 0 {
		return errors.New("برای این درس یک درخواست بازگشاییِ باز وجود دارد.")
	}
	_, err = s.DB.Pool.Exec(ctx, `
		insert into grade_unfinalize_requests ("offeringId","requestedByUserId",reason,status)
		values ($1,$2,$3,'PENDING')`, offeringID, userID, reason)
	return err
}

// GetUnfinalizeRequests فهرست درخواست‌های بازگشایی استاد.
func (s *Service) GetUnfinalizeRequests(ctx context.Context, userID int64) ([]UnfinalizeRequest, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return nil, errNoStaff
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select r.id, r."offeringId", coalesce(r.reason,''), coalesce(r.status,'PENDING'),
		       r."createdAt"::text, r."reviewNote"
		  from grade_unfinalize_requests r
		  join course_offerings o on o.id = r."offeringId"
		 where o."professorId" = $1 or exists (
		       select 1 from offering_professors op where op."offeringId" = o.id and op."staffId" = $1)
		 order by r.id desc limit 50`, st.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UnfinalizeRequest{}
	for rows.Next() {
		var r UnfinalizeRequest
		if err := rows.Scan(&r.ID, &r.OfferingID, &r.Reason, &r.Status, &r.CreatedAt, &r.ReviewNote); err == nil {
			out = append(out, r)
		}
	}
	return out, nil
}

var _ = jalali.FaDigits

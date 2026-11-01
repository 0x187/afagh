// ═══ Short-term (free) course management — port of admin/short-courses ═══
package admin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"backend-go/internal/jalali"
	"backend-go/internal/session"
)

// ShortTermLearner participant.
type ShortTermLearner struct {
	RegistrationID    int64    `json:"registrationId"`
	ID                int64    `json:"id"`
	FullName          string   `json:"fullName"`
	FullNameEn        string   `json:"fullNameEn"`
	NationalID        string   `json:"nationalId"`
	Mobile            string   `json:"mobile"`
	CourseID          int64    `json:"courseId"`
	AmountPaid        float64  `json:"amountPaid"`
	DiscountCode      *string  `json:"discountCode,omitempty"`
	PaymentStatus     string   `json:"paymentStatus"`
	AttendanceCount   int      `json:"attendanceCount"`
	TotalSessions     int      `json:"totalSessions"`
	FinalGrade        *float64 `json:"finalGrade,omitempty"`
	IsPassed          bool     `json:"isPassed"`
	CertificateNumber *string  `json:"certificateNumber,omitempty"`
	CertificateIssued bool     `json:"certificateIssued"`
	RegisteredAt      string   `json:"registeredAt"`
}

// ShortTermCourse short-term course.
type ShortTermCourse struct {
	ID             int64              `json:"id"`
	Code           string             `json:"code"`
	Title          string             `json:"title"`
	TitleEn        string             `json:"titleEn"`
	Category       string             `json:"category"`
	Hours          int                `json:"hours"`
	TuitionPrice   int64              `json:"tuitionPrice"`
	Capacity       int                `json:"capacity"`
	EnrolledCount  int                `json:"enrolledCount"`
	InstructorName string             `json:"instructorName"`
	PassingGrade   float64            `json:"passingGrade"`
	MaxAbsences    int                `json:"maxAbsences"`
	Status         string             `json:"status"`
	Learners       []ShortTermLearner `json:"learners"`
}

// ShortTermDiscount discount code.
type ShortTermDiscount struct {
	ID                int64  `json:"id"`
	Code              string `json:"code"`
	CourseID          *int64 `json:"courseId"`
	DiscountPercent   int    `json:"discountPercent"`
	MaxDiscountAmount *int64 `json:"maxDiscountAmount"`
	MaxUsage          int    `json:"maxUsage"`
	UsedCount         int    `json:"usedCount"`
	IsActive          bool   `json:"isActive"`
}

// ShortCoursesData initial bundle.
type ShortCoursesData struct {
	Courses   []ShortTermCourse   `json:"courses"`
	Discounts []ShortTermDiscount `json:"discounts"`
}

// ShortCourses list of courses and discount codes.
func (s *Service) ShortCourses(ctx context.Context, user *session.User, cookie string) (*ShortCoursesData, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := &ShortCoursesData{Courses: []ShortTermCourse{}, Discounts: []ShortTermDiscount{}}
	if uniID == nil {
		return out, nil
	}
	courseIdx := map[int64]int{}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, code, title, coalesce("titleEn",''), coalesce(category,''),
		       coalesce(hours,0), coalesce("tuitionPrice",0), coalesce(capacity,0), coalesce("enrolledCount",0),
		       coalesce("instructorName",''), coalesce("passingGrade",12)::float8, coalesce("maxAbsences",3),
		       coalesce(status,'OPEN')
		  from short_term_courses where "universityId" = $1 or "universityId" is null order by id desc`, *uniID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var c ShortTermCourse
		if err := rows.Scan(&c.ID, &c.Code, &c.Title, &c.TitleEn, &c.Category, &c.Hours,
			&c.TuitionPrice, &c.Capacity, &c.EnrolledCount, &c.InstructorName,
			&c.PassingGrade, &c.MaxAbsences, &c.Status); err == nil {
			c.Learners = []ShortTermLearner{}
			courseIdx[c.ID] = len(out.Courses)
			out.Courses = append(out.Courses, c)
		}
	}
	rows.Close()

	lrows, err := s.DB.Pool.Query(ctx, `
		select r.id, r."learnerId", r."courseId", r."amountPaid", r."discountCode", r."paymentStatus",
		       coalesce(r."attendanceCount",0), coalesce(r."totalSessions",10), r."finalGrade"::float8,
		       coalesce(r."isPassed",0), coalesce(r."certificateIssued",0), r."createdAt",
		       l."fullName", coalesce(l."fullNameEn",''), coalesce(l."nationalId",''), l.mobile,
		       c."certificateNumber"
		  from short_term_registrations r
		  join short_term_learners l on l.id = r."learnerId"
		  left join short_term_certificates c on c."registrationId" = r.id
		 where r."universityId" = $1 or r."universityId" is null
		 order by r.id`, *uniID)
	if err != nil {
		return nil, err
	}
	for lrows.Next() {
		var x ShortTermLearner
		var passed, issued int
		var created *time.Time
		if err := lrows.Scan(&x.RegistrationID, &x.ID, &x.CourseID, &x.AmountPaid, &x.DiscountCode,
			&x.PaymentStatus, &x.AttendanceCount, &x.TotalSessions, &x.FinalGrade, &passed, &issued,
			&created, &x.FullName, &x.FullNameEn, &x.NationalID, &x.Mobile, &x.CertificateNumber); err != nil {
			continue
		}
		x.IsPassed = passed != 0
		x.CertificateIssued = issued != 0 || x.CertificateNumber != nil
		if created != nil {
			x.RegisteredAt = jalaliDate(*created)
		} else {
			x.RegisteredAt = "—"
		}
		if idx, ok := courseIdx[x.CourseID]; ok {
			out.Courses[idx].Learners = append(out.Courses[idx].Learners, x)
		}
	}
	lrows.Close()

	drows, err := s.DB.Pool.Query(ctx, `
		select id, code, "courseId", "discountPercent", "maxDiscountAmount", coalesce("maxUsage",100),
		       coalesce("usedCount",0), coalesce("isActive",1)
		  from short_term_discounts where "universityId" = $1 or "universityId" is null order by id`, *uniID)
	if err == nil {
		for drows.Next() {
			var d ShortTermDiscount
			var active int
			if err := drows.Scan(&d.ID, &d.Code, &d.CourseID, &d.DiscountPercent, &d.MaxDiscountAmount,
				&d.MaxUsage, &d.UsedCount, &active); err == nil {
				d.IsActive = active != 0
				out.Discounts = append(out.Discounts, d)
			}
		}
		drows.Close()
	}
	return out, nil
}

func jalaliDate(t time.Time) string {
	return jalali.ToShamsi(t.Format(time.RFC3339))
}

// ShortCourseCreateInput course creation input.
type ShortCourseCreateInput struct {
	Code, Title, TitleEn, Category, InstructorName string
	Hours, TuitionPrice, Capacity                  int
}

// CreateShortCourse creates a short-term course.
func (s *Service) CreateShortCourse(ctx context.Context, user *session.User, cookie string, in ShortCourseCreateInput) (int64, string, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return 0, "", errors.New("دانشگاه فعال نامشخص است.")
	}
	code := strings.ToUpper(strings.TrimSpace(in.Code))
	title := strings.TrimSpace(in.Title)
	instructor := strings.TrimSpace(in.InstructorName)
	if code == "" || title == "" || instructor == "" {
		return 0, "", errors.New("کد، عنوان و نام مدرس الزامی است.")
	}
	var dup int
	if err := s.DB.Pool.QueryRow(ctx, `
		select 1 from short_term_courses where code = $1 and ("universityId" = $2 or "universityId" is null) limit 1`,
		code, *uniID).Scan(&dup); err == nil {
		return 0, "", fmt.Errorf("کد دوره «%s» پیش‌تر ثبت شده است.", code)
	}
	hours := in.Hours
	if hours < 1 {
		hours = 1
	}
	price := in.TuitionPrice
	if price < 0 {
		price = 0
	}
	capacity := in.Capacity
	if capacity < 1 {
		capacity = 1
	}
	category := strings.TrimSpace(in.Category)
	if category == "" {
		category = "مهندسی و فناوری"
	}
	var id int64
	err := s.DB.Pool.QueryRow(ctx, `
		insert into short_term_courses ("universityId",code,title,"titleEn",category,hours,"tuitionPrice",capacity,"instructorName")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
		*uniID, code, title, nilIfBlankStr(in.TitleEn), category, hours, price, capacity, instructor).Scan(&id)
	if err != nil {
		return 0, "", err
	}
	return id, code, nil
}

// ShortCourseLearnerInput participant registration input.
type ShortCourseLearnerInput struct {
	CourseID   int64  `json:"courseId"`
	FullName   string `json:"fullName"`
	FullNameEn string `json:"fullNameEn"`
	NationalID string `json:"nationalId"`
	Mobile     string `json:"mobile"`
}

// AddShortTermLearner registers a participant + PENDING enrollment.
func (s *Service) AddShortTermLearner(ctx context.Context, user *session.User, cookie string, in ShortCourseLearnerInput) (int64, int64, string, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return 0, 0, "", errors.New("دانشگاه فعال نامشخص است.")
	}
	mobile := strings.TrimSpace(in.Mobile)
	fullName := strings.TrimSpace(in.FullName)
	if mobile == "" || fullName == "" {
		return 0, 0, "", errors.New("نام و شمارهٔ همراه الزامی است.")
	}
	var courseUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from short_term_courses where id = $1`, in.CourseID).Scan(&courseUni); err != nil {
		return 0, 0, "", errors.New("دوره یافت نشد.")
	}
	if courseUni != nil && *courseUni != *uniID {
		return 0, 0, "", errors.New("دوره متعلق به دانشگاه دیگری است.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, 0, "", err
	}
	defer tx.Rollback(ctx)
	var learnerID int64
	if err := tx.QueryRow(ctx, `
		insert into short_term_learners ("universityId",mobile,"fullName","fullNameEn","nationalId")
		values ($1,$2,$3,$4,$5) returning id`,
		*uniID, mobile, fullName, nilIfBlankStr(in.FullNameEn), nilIfBlankStr(in.NationalID)).Scan(&learnerID); err != nil {
		return 0, 0, "", err
	}
	tracking := "AFQ-" + strings.ToUpper(strconv.FormatInt(time.Now().UnixMilli(), 36))
	var regID int64
	if err := tx.QueryRow(ctx, `
		insert into short_term_registrations ("universityId","learnerId","courseId","trackingCode","paymentStatus")
		values ($1,$2,$3,$4,'PENDING') returning id`, *uniID, learnerID, in.CourseID, tracking).Scan(&regID); err != nil {
		return 0, 0, "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, "", err
	}
	return learnerID, regID, tracking, nil
}

// UpdateShortTermRegistration records attendance/score and calculates pass.
func (s *Service) UpdateShortTermRegistration(ctx context.Context, user *session.User, cookie string, regID int64, attendance *int, grade *float64) (bool, float64, int, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return false, 0, 0, errors.New("دانشگاه فعال نامشخص است.")
	}
	var courseID int64
	var totalSessions int
	var regUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select "courseId", coalesce("totalSessions",10), "universityId" from short_term_registrations where id = $1`, regID).
		Scan(&courseID, &totalSessions, &regUni); err != nil {
		return false, 0, 0, errors.New("ثبت‌نام یافت نشد.")
	}
	if regUni != nil && *regUni != *uniID {
		return false, 0, 0, errors.New("ثبت‌نام متعلق به دانشگاه دیگری است.")
	}
	var passing float64 = 12
	var maxAbs int = 3
	_ = s.DB.Pool.QueryRow(ctx, `
		select coalesce("passingGrade",12)::float8, coalesce("maxAbsences",3) from short_term_courses where id = $1`, courseID).
		Scan(&passing, &maxAbs)
	sets := []string{}
	args := []any{}
	if attendance != nil {
		v := *attendance
		if v < 0 {
			v = 0
		}
		args = append(args, v)
		sets = append(sets, `"attendanceCount" = $`+strconv.Itoa(len(args)))
	}
	if grade != nil {
		v := float64(int64(*grade*100+0.5)) / 100
		args = append(args, v)
		sets = append(sets, `"finalGrade" = $`+strconv.Itoa(len(args)))
	}
	var newGrade *float64
	var newAtt *int
	if err := s.DB.Pool.QueryRow(ctx, `
		select "finalGrade"::float8, "attendanceCount" from short_term_registrations where id = $1`, regID).
		Scan(&newGrade, &newAtt); err != nil {
		return false, 0, 0, err
	}
	if attendance != nil {
		att := *attendance
		if att < 0 {
			att = 0
		}
		newAtt = &att
	}
	if grade != nil {
		v := float64(int64(*grade*100+0.5)) / 100
		newGrade = &v
	}
	passed := false
	if newAtt != nil && newGrade != nil {
		absences := totalSessions - *newAtt
		if absences < 0 {
			absences = 0
		}
		passed = *newGrade >= passing && absences <= maxAbs
		v := 0
		if passed {
			v = 1
		}
		args = append(args, v)
		sets = append(sets, `"isPassed" = $`+strconv.Itoa(len(args)))
	}
	if len(sets) > 0 {
		args = append(args, regID)
		if _, err := s.DB.Pool.Exec(ctx, `update short_term_registrations set `+strings.Join(sets, ", ")+` where id = $`+strconv.Itoa(len(args)), args...); err != nil {
			return false, 0, 0, err
		}
	}
	var afterPassed, afterAtt int
	var afterGrade *float64
	_ = s.DB.Pool.QueryRow(ctx, `
		select coalesce("isPassed",0), "finalGrade"::float8, coalesce("attendanceCount",0)
		  from short_term_registrations where id = $1`, regID).Scan(&afterPassed, &afterGrade, &afterAtt)
	g := 0.0
	if afterGrade != nil {
		g = *afterGrade
	}
	return afterPassed != 0, g, afterAtt, nil
}

// IssueShortTermCertificate issues a certificate with a serial number and fingerprint.
type ShortCertificateIssued struct {
	ID                int64  `json:"id"`
	CertificateNumber string `json:"certificateNumber"`
	VerificationHash  string `json:"verificationHash"`
}

func (s *Service) IssueShortTermCertificate(ctx context.Context, user *session.User, cookie string, regID int64) (*ShortCertificateIssued, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	var regUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from short_term_registrations where id = $1`, regID).Scan(&regUni); err != nil {
		return nil, errors.New("ثبت‌نام یافت نشد.")
	}
	if regUni != nil && *regUni != *uniID {
		return nil, errors.New("ثبت‌نام متعلق به دانشگاه دیگری است.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var learnerID, courseID int64
	var isPassed, issued int
	if err := tx.QueryRow(ctx, `
		select "learnerId", "courseId", coalesce("isPassed",0), coalesce("certificateIssued",0)
		  from short_term_registrations where id = $1 for update`, regID).Scan(&learnerID, &courseID, &isPassed, &issued); err != nil {
		return nil, errors.New("ثبت‌نام یافت نشد.")
	}
	if isPassed == 0 {
		return nil, errors.New("فقط برای پذیرفته‌شدگان گواهینامه صادر می‌شود.")
	}
	if issued != 0 {
		return nil, errors.New("برای این ثبت‌نام پیش‌تر گواهینامه صادر شده است.")
	}
	var courseTitle, courseTitleEn string
	var hours int
	var fullName, fullNameEn, nationalID, mobile string
	if err := tx.QueryRow(ctx, `
		select title, coalesce("titleEn",''), coalesce(hours,0) from short_term_courses where id = $1`, courseID).
		Scan(&courseTitle, &courseTitleEn, &hours); err != nil {
		return nil, errors.New("دوره یا شرکت‌کننده یافت نشد.")
	}
	if err := tx.QueryRow(ctx, `
		select "fullName", coalesce("fullNameEn",''), coalesce("nationalId",''), mobile
		  from short_term_learners where id = $1`, learnerID).
		Scan(&fullName, &fullNameEn, &nationalID, &mobile); err != nil {
		return nil, errors.New("دوره یا شرکت‌کننده یافت نشد.")
	}
	_ = nationalID
	_ = mobile
	// counter
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('short_term_certificate_seq', 0))`); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `create sequence if not exists short_term_certificate_seq`); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		select setval('short_term_certificate_seq',
		  greatest((select count(*)::int from short_term_certificates),
		           (select last_value::int from short_term_certificate_seq)), true)`); err != nil {
		return nil, err
	}
	var seq int64
	if err := tx.QueryRow(ctx, `select nextval('short_term_certificate_seq')`).Scan(&seq); err != nil {
		return nil, err
	}
	if seq <= 0 {
		return nil, errors.New("تولید شمارهٔ گواهینامه ناموفق بود.")
	}
	year := time.Now().Year()
	certNo := fmt.Sprintf("AFQ-CERT-%d-%d", year, 1000+seq)
	var grade float64
	_ = tx.QueryRow(ctx, `select coalesce("finalGrade",0)::float8 from short_term_registrations where id = $1`, regID).Scan(&grade)
	grade = float64(int64(grade*100+0.5)) / 100
	issueDate := fmt.Sprintf("%d/%02d/%02d", year, int(time.Now().Month()), time.Now().Day())
	fingerprint := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%d|%.2f|%d|%s",
		strings.ToUpper(certNo), learnerID, courseID, grade, hours, issueDate)))
	hash := hex.EncodeToString(fingerprint[:])
	var owner any
	if regUni != nil {
		owner = *regUni
	}
	var certID int64
	if err := tx.QueryRow(ctx, `
		insert into short_term_certificates ("certificateNumber","verificationHash","learnerId","courseId",
		  "registrationId","fullNameFa","fullNameEn","courseTitleFa","courseTitleEn",grade,"totalHours","issueDate","universityId")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
		certNo, hash, learnerID, courseID, regID, fullName, nilIfBlankStr(fullNameEn),
		courseTitle, nilIfBlankStr(courseTitleEn), fmtNum(grade), hours, issueDate, owner).Scan(&certID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		update short_term_registrations set "certificateIssued" = 1, "certificateId" = $2 where id = $1`,
		regID, certID); err != nil {
		return nil, err
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "SHORT_TERM_CERTIFICATE_ISSUED", "short_term_certificate", certID,
		fmt.Sprintf(`{"registrationId":%d,"certificateNumber":%s,"reason":"صدور گواهینامه توسط کارشناس آموزش"}`,
			regID, jsonQuote(certNo))); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &ShortCertificateIssued{ID: certID, CertificateNumber: certNo, VerificationHash: hash}, nil
}

// RevokeShortTermCertificate revokes a certificate.
func (s *Service) RevokeShortTermCertificate(ctx context.Context, user *session.User, cookie, certNumber, reason string) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	code := strings.ToUpper(strings.TrimSpace(certNumber))
	if code == "" {
		return errors.New("شمارهٔ گواهینامه را وارد کنید.")
	}
	var certID int64
	var certUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select id, "universityId" from short_term_certificates where "certificateNumber" = $1`, code).
		Scan(&certID, &certUni); err != nil {
		return errors.New("گواهینامه یافت نشد.")
	}
	if certUni != nil && *certUni != *uniID {
		return errors.New("گواهینامه متعلق به دانشگاه دیگری است.")
	}
	why := strings.TrimSpace(reason)
	if why == "" {
		why = "باطل‌سازی توسط مدیر آموزش"
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		update short_term_certificates set "isRevoked" = 1 where "certificateNumber" = $1`, code); err != nil {
		return err
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "SHORT_TERM_CERTIFICATE_REVOKED", "short_term_certificate", certID,
		fmt.Sprintf(`{"certificateNumber":%s,"reason":%s}`, jsonQuote(code), jsonQuote(why))); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UpdateShortCourseStatus changes the course status.
func (s *Service) UpdateShortCourseStatus(ctx context.Context, user *session.User, cookie string, courseID int64, status string) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	if status != "OPEN" && status != "IN_PROGRESS" && status != "COMPLETED" {
		return errors.New("وضعیت نامعتبر است.")
	}
	var rowUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from short_term_courses where id = $1`, courseID).Scan(&rowUni); err != nil {
		return errors.New("دوره یافت نشد.")
	}
	if rowUni != nil && *rowUni != *uniID {
		return errors.New("دوره متعلق به دانشگاه دیگری است.")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		update short_term_courses set status = $2 where id = $1 and ("universityId" = $3 or "universityId" is null)`,
		courseID, status, *uniID)
	return err
}

// SyncShortCourseCounts syncs the registration counts.
func (s *Service) SyncShortCourseCounts(ctx context.Context, user *session.User, cookie string) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		update short_term_courses c set "enrolledCount" = coalesce(x.n,0)
		  from (select "courseId", count(*)::int n from short_term_registrations group by "courseId") x
		 where x."courseId" = c.id and (c."universityId" = $1 or c."universityId" is null)`, *uniID)
	return err
}

// ShortTermDiscountInput discount code creation input.
type ShortTermDiscountInput struct {
	Code              string
	CourseID          *int64
	DiscountPercent   int
	MaxDiscountAmount *int64
	MaxUsage          *int
}

// CreateShortTermDiscount creates a discount code.
func (s *Service) CreateShortTermDiscount(ctx context.Context, user *session.User, cookie string, in ShortTermDiscountInput) (int64, string, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return 0, "", errors.New("دانشگاه فعال نامشخص است.")
	}
	code := strings.ToUpper(strings.TrimSpace(in.Code))
	if len(code) < 3 || len(code) > 20 {
		return 0, "", errors.New("کد تخفیف باید ۳ تا ۲۰ کاراکتر انگلیسی/رقمی باشد.")
	}
	for _, r := range code {
		if !((r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return 0, "", errors.New("کد تخفیف باید ۳ تا ۲۰ کاراکتر انگلیسی/رقمی باشد.")
		}
	}
	if in.DiscountPercent < 1 || in.DiscountPercent > 100 {
		return 0, "", errors.New("درصد تخفیف باید بین ۱ تا ۱۰۰ باشد.")
	}
	maxUsage := 100
	if in.MaxUsage != nil {
		if *in.MaxUsage < 1 {
			return 0, "", errors.New("سهمیهٔ مصرف باید عدد صحیح مثبت باشد.")
		}
		maxUsage = *in.MaxUsage
	}
	if in.CourseID != nil {
		var cUni *int64
		if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from short_term_courses where id = $1`, *in.CourseID).Scan(&cUni); err != nil {
			return 0, "", errors.New("دوره یافت نشد.")
		}
		if cUni != nil && *cUni != *uniID {
			return 0, "", errors.New("دوره متعلق به دانشگاه دیگری است.")
		}
	}
	var id int64
	err := s.DB.Pool.QueryRow(ctx, `
		insert into short_term_discounts ("universityId",code,"courseId","discountPercent","maxDiscountAmount","maxUsage","isActive")
		values ($1,$2,$3,$4,$5,$6,1) returning id`,
		*uniID, code, in.CourseID, in.DiscountPercent, in.MaxDiscountAmount, maxUsage).Scan(&id)
	if err != nil {
		return 0, "", fmt.Errorf("ساخت کد تخفیف ناموفق بود (ممکن است کد تکراری باشد): %s", err.Error())
	}
	return id, code, nil
}

// ListShortTermDiscounts lists discount codes (optionally by course).
func (s *Service) ListShortTermDiscounts(ctx context.Context, user *session.User, cookie string, courseID *int64) ([]ShortTermDiscount, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := []ShortTermDiscount{}
	if uniID == nil {
		return out, nil
	}
	args := []any{*uniID}
	conds := []string{`("universityId" = $1 or "universityId" is null)`}
	if courseID != nil {
		args = append(args, *courseID)
		conds = append(conds, `"courseId" = $`+strconv.Itoa(len(args)))
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, code, "courseId", "discountPercent", "maxDiscountAmount", coalesce("maxUsage",100),
		       coalesce("usedCount",0), coalesce("isActive",1)
		  from short_term_discounts where `+strings.Join(conds, " and ")+` order by id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var d ShortTermDiscount
		var active int
		if err := rows.Scan(&d.ID, &d.Code, &d.CourseID, &d.DiscountPercent, &d.MaxDiscountAmount,
			&d.MaxUsage, &d.UsedCount, &active); err == nil {
			d.IsActive = active != 0
			out = append(out, d)
		}
	}
	return out, nil
}

// ToggleShortTermDiscount enable/disable.
func (s *Service) ToggleShortTermDiscount(ctx context.Context, user *session.User, cookie string, id int64, active bool) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	var rowUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from short_term_discounts where id = $1`, id).Scan(&rowUni); err != nil {
		return errors.New("کد تخفیف یافت نشد.")
	}
	if rowUni != nil && *rowUni != *uniID {
		return errors.New("کد تخفیف متعلق به دانشگاه دیگری است.")
	}
	v := 0
	if active {
		v = 1
	}
	_, err := s.DB.Pool.Exec(ctx, `update short_term_discounts set "isActive" = $2 where id = $1`, id, v)
	return err
}

// ConfirmShortTermPayment records the tuition payment (PENDING → PAID).
func (s *Service) ConfirmShortTermPayment(ctx context.Context, user *session.User, cookie string, regID int64, refID string, amount float64) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	ref := strings.TrimSpace(refID)
	if regID <= 0 || ref == "" || amount < 0 {
		return errors.New("شناسهٔ ثبت‌نام، شمارهٔ پیگیری و مبلغ الزامی است.")
	}
	var rowUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from short_term_registrations where id = $1`, regID).Scan(&rowUni); err != nil {
		return errors.New("ثبت‌نام یافت نشد.")
	}
	if rowUni != nil && *rowUni != *uniID {
		return errors.New("ثبت‌نام متعلق به دانشگاه دیگری است.")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		update short_term_registrations set "paymentStatus" = 'PAID', "amountPaid" = $2, "paymentRefId" = $3
		 where id = $1 and ("universityId" = $4 or "universityId" is null)`,
		regID, int64(amount+0.5), ref, *uniID)
	return err
}

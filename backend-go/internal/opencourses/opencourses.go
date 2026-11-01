// ═══ open-course catalog and public registration — open-courses port ═══
package opencourses

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the open-course service.
type Service struct {
	Pool *pgxpool.Pool
}

// Course is a public course.
type Course struct {
	ID             int64   `json:"id"`
	Code           string  `json:"code"`
	Title          string  `json:"title"`
	TitleEn        string  `json:"titleEn"`
	Category       string  `json:"category"`
	Description    string  `json:"description"`
	Hours          int     `json:"hours"`
	TuitionPrice   float64 `json:"tuitionPrice"`
	Capacity       int     `json:"capacity"`
	EnrolledCount  int     `json:"enrolledCount"`
	InstructorName string  `json:"instructorName"`
	InstructorBio  string  `json:"instructorBio"`
	Syllabus       []string `json:"syllabus"`
	ScheduleText   string  `json:"scheduleText"`
	StartDate      string  `json:"startDate"`
	EndDate        string  `json:"endDate"`
	PassingGrade   float64 `json:"passingGrade"`
}

// List: live open-course catalog — OPEN only.
func (s *Service) List(ctx context.Context) ([]Course, error) {
	rows, err := s.Pool.Query(ctx, `
		select id, code, title, coalesce("titleEn",''), coalesce(category,'مهندسی و فناوری'),
		       coalesce(description,''), hours, "tuitionPrice"::float8, capacity,
		       coalesce("enrolledCount",0), "instructorName", coalesce("instructorBio",''),
		       coalesce("syllabusJson",'[]'), coalesce("scheduleText",''),
		       coalesce("startDate",''), coalesce("endDate",''), coalesce("passingGrade",12)::float8
		  from short_term_courses where status = 'OPEN' order by "createdAt" desc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Course{}
	for rows.Next() {
		var c Course
		var syllabusRaw string
		if err := rows.Scan(&c.ID, &c.Code, &c.Title, &c.TitleEn, &c.Category, &c.Description,
			&c.Hours, &c.TuitionPrice, &c.Capacity, &c.EnrolledCount, &c.InstructorName, &c.InstructorBio,
			&syllabusRaw, &c.ScheduleText, &c.StartDate, &c.EndDate, &c.PassingGrade); err != nil {
			continue
		}
		c.Syllabus = []string{}
		var arr []any
		if json.Unmarshal([]byte(syllabusRaw), &arr) == nil {
			for _, it := range arr {
				c.Syllabus = append(c.Syllabus, fmt.Sprint(it))
			}
		}
		out = append(out, c)
	}
	return out, nil
}

// DiscountResult is the discount-code validity preview.
type DiscountResult struct {
	OK             bool    `json:"ok"`
	DiscountAmount float64 `json:"discountAmount,omitempty"`
	Error          string  `json:"error,omitempty"`
}

// ValidateDiscount ports validateDiscountCodeAction.
func (s *Service) ValidateDiscount(ctx context.Context, courseID int64, rawCode string) *DiscountResult {
	code := strings.ToUpper(strings.TrimSpace(rawCode))
	if code == "" {
		return &DiscountResult{OK: false, Error: "کد تخفیف را وارد کنید."}
	}
	var id int64
	var percent float64
	var maxDiscount *float64
	var usedCount, maxUsage *int
	err := s.Pool.QueryRow(ctx, `
		select id, "discountPercent"::float8, "maxDiscountAmount"::float8, "usedCount", "maxUsage"
		  from short_term_discounts
		 where code = $1 and "isActive" = 1 and ("courseId" = $2 or "courseId" is null)
		 limit 1`, code, courseID).Scan(&id, &percent, &maxDiscount, &usedCount, &maxUsage)
	if err != nil {
		return &DiscountResult{OK: false, Error: "کد تخفیف نامعتبر یا مخصوص این دوره نیست."}
	}
	uc, mu := 0, 100
	if usedCount != nil {
		uc = *usedCount
	}
	if maxUsage != nil {
		mu = *maxUsage
	}
	if uc >= mu {
		return &DiscountResult{OK: false, Error: "سهمیهٔ این کد تخفیف تکمیل شده است."}
	}
	var price float64
	if err := s.Pool.QueryRow(ctx, `select "tuitionPrice"::float8 from short_term_courses where id = $1`, courseID).Scan(&price); err != nil {
		return &DiscountResult{OK: false, Error: "دوره یافت نشد."}
	}
	raw := math.Round(price * percent / 100)
	amount := raw
	if maxDiscount != nil && *maxDiscount > 0 && raw > *maxDiscount {
		amount = *maxDiscount
	}
	return &DiscountResult{OK: true, DiscountAmount: amount}
}

// RegisterInput is the public registration input.
type RegisterInput struct {
	CourseID     int64  `json:"courseId"`
	FullName     string `json:"fullName"`
	FullNameEn   string `json:"fullNameEn"`
	NationalID   string `json:"nationalId"`
	Mobile       string `json:"mobile"`
	DiscountCode string `json:"discountCode"`
}

// RegisterResult is the registration result.
type RegisterResult struct {
	OK             bool    `json:"ok"`
	TrackingCode   string  `json:"trackingCode,omitempty"`
	AmountDue      float64 `json:"amountDue,omitempty"`
	DiscountAmount float64 `json:"discountAmount,omitempty"`
	Error          string  `json:"error,omitempty"`
}

func validMobile(m string) bool {
	if len(m) != 11 || m[0] != '0' || m[1] != '9' {
		return false
	}
	for _, r := range m {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func validNationalID(n string) bool {
	if len(n) != 10 {
		return false
	}
	for _, r := range n {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// Register ports registerOpenCourseAction — creates a PENDING record with a server-side tracking code.
func (s *Service) Register(ctx context.Context, in RegisterInput) *RegisterResult {
	fullName := strings.TrimSpace(in.FullName)
	mobile := strings.TrimSpace(in.Mobile)
	nationalID := strings.TrimSpace(in.NationalID)
	if fullName == "" || mobile == "" {
		return &RegisterResult{Error: "نام و شمارهٔ همراه الزامی است."}
	}
	if !validMobile(mobile) {
		return &RegisterResult{Error: "شمارهٔ همراه معتبر نیست (مثال: 09123456789)."}
	}
	if !validNationalID(nationalID) {
		return &RegisterResult{Error: "کد ملی باید ۱۰ رقم باشد."}
	}

	var price float64
	var capacity, enrolled, hours int
	var status string
	err := s.Pool.QueryRow(ctx, `
		select "tuitionPrice"::float8, capacity, coalesce("enrolledCount",0), hours, status
		  from short_term_courses where id = $1`, in.CourseID).Scan(&price, &capacity, &enrolled, &hours, &status)
	if err != nil || status != "OPEN" {
		return &RegisterResult{Error: "دوره یافت نشد یا ثبت‌نام آن بسته است."}
	}
	if enrolled >= capacity {
		return &RegisterResult{Error: "ظرفیت این دوره تکمیل شده است."}
	}

	discountCode := strings.ToUpper(strings.TrimSpace(in.DiscountCode))
	discountAmount := 0.0
	var usedDiscountID int64
	if discountCode != "" {
		var percent float64
		var maxDiscount *float64
		var usedCount, maxUsage *int
		err := s.Pool.QueryRow(ctx, `
			select id, "discountPercent"::float8, "maxDiscountAmount"::float8, "usedCount", "maxUsage"
			  from short_term_discounts
			 where code = $1 and "isActive" = 1 and ("courseId" = $2 or "courseId" is null)
			 limit 1`, discountCode, in.CourseID).Scan(&usedDiscountID, &percent, &maxDiscount, &usedCount, &maxUsage)
		if err != nil {
			return &RegisterResult{Error: "کد تخفیف نامعتبر است."}
		}
		uc, mu := 0, 100
		if usedCount != nil {
			uc = *usedCount
		}
		if maxUsage != nil {
			mu = *maxUsage
		}
		if uc >= mu {
			return &RegisterResult{Error: "سهمیهٔ این کد تخفیف تکمیل شده است."}
		}
		raw := math.Round(price * percent / 100)
		discountAmount = raw
		if maxDiscount != nil && *maxDiscount > 0 && raw > *maxDiscount {
			discountAmount = *maxDiscount
		}
	}
	amountDue := math.Max(0, price-discountAmount)

	buf := make([]byte, 4)
	_, _ = rand.Read(buf)
	trackingCode := fmt.Sprintf("AFQ-%d-%s", time.Now().Year(), strings.ToUpper(hex.EncodeToString(buf)))

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return &RegisterResult{Error: "ثبت‌نام ناموفق بود."}
	}
	defer tx.Rollback(ctx)

	// Learner: upsert by mobile number (national ID only if empty).
	var learnerID int64
	var existingNational *string
	err = tx.QueryRow(ctx, `select id, "nationalId" from short_term_learners where mobile = $1 limit 1`, mobile).
		Scan(&learnerID, &existingNational)
	if err == nil {
		if existingNational != nil && *existingNational != "" && *existingNational != nationalID {
			return &RegisterResult{Error: "این شمارهٔ همراه قبلاً با کد ملی دیگری ثبت شده است."}
		}
		if _, err := tx.Exec(ctx, `update short_term_learners set "fullName" = $2, "nationalId" = $3 where id = $1`,
			learnerID, fullName, nationalID); err != nil {
			return &RegisterResult{Error: "ثبت‌نام ناموفق بود."}
		}
	} else {
		if err := tx.QueryRow(ctx, `
			insert into short_term_learners (mobile, "fullName", "fullNameEn", "nationalId")
			values ($1,$2,$3,$4) returning id`,
			mobile, fullName, nullIfEmpty(in.FullNameEn), nationalID).Scan(&learnerID); err != nil {
			return &RegisterResult{Error: "ثبت‌نام ناموفق بود."}
		}
	}

	sessions := int(math.Round(float64(hours) / 5))
	if sessions < 8 {
		sessions = 8
	}
	if sessions > 16 {
		sessions = 16
	}
	var regID int64
	var discountCodeArg any
	if discountCode != "" {
		discountCodeArg = discountCode
	}
	var discountArg any
	if discountAmount > 0 {
		discountArg = discountAmount
	}
	if err := tx.QueryRow(ctx, `
		insert into short_term_registrations ("learnerId","courseId","trackingCode","discountAmount","discountCode",
		  "amountPaid","paymentStatus","totalSessions")
		values ($1,$2,$3,$4,$5,0,'PENDING',$6) returning id`,
		learnerID, in.CourseID, trackingCode, discountArg, discountCodeArg, sessions).Scan(&regID); err != nil {
		return &RegisterResult{Error: "ثبت‌نام ناموفق بود."}
	}

	// consume the discount-code quota — condition in WHERE for concurrency.
	if usedDiscountID > 0 {
		tag, err := tx.Exec(ctx, `
			update short_term_discounts
			   set "usedCount" = coalesce("usedCount",0) + 1
			 where id = $1 and "isActive" = 1
			   and coalesce("usedCount",0) < coalesce("maxUsage",100)`, usedDiscountID)
		if err != nil || tag.RowsAffected() == 0 {
			return &RegisterResult{Error: "سهمیهٔ کد تخفیف در همین لحظه تکمیل شد؛ دوباره تلاش کنید."}
		}
	}
	if _, err := tx.Exec(ctx, `
		update short_term_courses set "enrolledCount" = coalesce("enrolledCount",0) + 1 where id = $1`, in.CourseID); err != nil {
		return &RegisterResult{Error: "ثبت‌نام ناموفق بود."}
	}
	if err := tx.Commit(ctx); err != nil {
		return &RegisterResult{Error: "ثبت‌نام ناموفق بود."}
	}
	return &RegisterResult{OK: true, TrackingCode: trackingCode, AmountDue: amountDue, DiscountAmount: discountAmount}
}

func nullIfEmpty(v string) *string {
	if t := strings.TrimSpace(v); t != "" {
		return &t
	}
	return nil
}

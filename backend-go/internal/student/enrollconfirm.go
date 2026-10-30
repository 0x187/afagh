// ═══ تأییدیهٔ انتخاب واحد — پورت issueEnrollConfirmToken + verifyEnrollConfirm ═══
package student

import (
	"context"
	"errors"
	"strings"

	"backend-go/internal/qr"
)

// ConfirmCourse ردیف درس در تأییدیه.
type ConfirmCourse struct {
	CourseTitle   string  `json:"courseTitle"`
	CourseCode    string  `json:"courseCode"`
	Units         int     `json:"units"`
	GroupNumber   int     `json:"groupNumber"`
	ProfessorName *string `json:"professorName"`
	Status        string  `json:"status"`
}

// EnrollConfirmData دادهٔ سند تأییدیه.
type EnrollConfirmData struct {
	StudentID        int64           `json:"studentId"`
	StudentName      string          `json:"studentName"`
	StudentCode      string          `json:"studentCode"`
	NationalIDMasked string          `json:"nationalIdMasked"`
	MajorName        *string         `json:"majorName"`
	TermID           int64           `json:"termId"`
	TermTitle        string          `json:"termTitle"`
	Courses          []ConfirmCourse `json:"courses"`
	TotalUnits       int             `json:"totalUnits"`
	CheckedAt        string          `json:"checkedAt"`
}

// EnrollConfirmResponse پاسخ صفحه.
type EnrollConfirmResponse struct {
	TermTitle    string             `json:"termTitle"`
	Blocked      *string            `json:"blocked"`
	VerifyURL    *string            `json:"verifyUrl"`
	ExpiresAt    *string            `json:"expiresAt"`
	QRSVG        string             `json:"qrSvg"`
	Data         *EnrollConfirmData `json:"data"`
	EmptyMessage *string            `json:"emptyMessage"`
}

// GetEnrollConfirm تأییدیهٔ نیمسال انتخابی (کوکی) — بدون انتخاب، پیام راهنما.
func (s *Service) GetEnrollConfirm(ctx context.Context, userID int64, termCookie *int64, publicBaseURL string) (*EnrollConfirmResponse, error) {
	me, err := s.Resolve(ctx, userID)
	if err != nil {
		return nil, err
	}
	if me == nil {
		return nil, errNoStudent
	}
	resp := &EnrollConfirmResponse{}

	selection := s.Scope.GetTermScope(ctx, me.UniversityID, termCookie)
	termID := selection.SelectedID
	if termID == nil {
		msg := "نیمسالی انتخاب نشده است؛ از فیلتر نیمسال یک نیمسال را انتخاب کنید."
		resp.Blocked = &msg
		resp.EmptyMessage = &msg
		return resp, nil
	}
	_ = s.Pool.QueryRow(ctx, `select title from academic_terms where id = $1`, *termID).Scan(&resp.TermTitle)

	// صدور توکن.
	ttlMin := 20160.0
	if s.Settings != nil {
		ttlMin = s.Settings.GetNumber(ctx, "ENROLL_CONFIRM_TTL_MINUTES", 20160)
	}
	if !(ttlMin > 0) {
		msg := "مدت اعتبار تأییدیهٔ انتخاب واحد (ENROLL_CONFIRM_TTL_MINUTES) باید عددی بزرگ‌تر از صفر باشد."
		resp.Blocked = &msg
		resp.EmptyMessage = &msg
		return resp, nil
	}
	if ttlMin > 525600 {
		ttlMin = 525600
	}
	uni := int64(0)
	if me.UniversityID != nil {
		uni = *me.UniversityID
	}
	token, err := s.Signer.Sign(ctx, map[string]any{
		"uid": userID, "term": *termID, "sid": me.ID, "sc": me.StudentCode,
		"uni": uni, "kind": "ENROLL_CONFIRM",
	}, int(ttlMin)*60)
	if err != nil {
		msg := err.Error()
		resp.Blocked = &msg
		resp.EmptyMessage = &msg
		return resp, nil
	}
	if publicBaseURL != "" {
		url := strings.TrimRight(publicBaseURL, "/") + "/verify-enrollment/" + token
		resp.VerifyURL = &url
		if svg, err := qr.SVG(url, qr.Options{Level: "M", Size: 160, Margin: 4}); err == nil {
			resp.QRSVG = svg
		}
	}
	exp := expiresAtISO(int(ttlMin) * 60)
	resp.ExpiresAt = &exp

	// دادهٔ زندهٔ دروس همین نیمسال (به‌جز حذف‌شده‌ها).
	var fullName, nationalCode, majorName *string
	_ = s.Pool.QueryRow(ctx, `
		select (u."firstName" || ' ' || u."lastName"), u."nationalCode", m.name
		  from students st
		  join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		 where st.id = $1`, me.ID).Scan(&fullName, &nationalCode, &majorName)

	rows, err := s.Pool.Query(ctx, `
		select c.title, c.code, coalesce(c.units,0)::int, coalesce(o."groupNumber",0),
		       (pu."firstName" || ' ' || pu."lastName"), en.status
		  from enrollments en
		  join course_offerings o on o.id = en."offeringId"
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = o."professorId"
		  left join users pu on pu.id = st."userId"
		 where en."studentId" = $1 and o."termId" = $2 and en.status <> 'DROPPED'
		 order by c.title`, me.ID, *termID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	courses := []ConfirmCourse{}
	for rows.Next() {
		var c ConfirmCourse
		var profName *string
		if err := rows.Scan(&c.CourseTitle, &c.CourseCode, &c.Units, &c.GroupNumber, &profName, &c.Status); err != nil {
			return nil, err
		}
		if profName != nil && strings.TrimSpace(*profName) != "" {
			name := strings.TrimSpace(*profName)
			c.ProfessorName = &name
		}
		courses = append(courses, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(courses) == 0 {
		msg := "برای این دانشجو در این نیمسال ثبت‌نامی (به‌جز حذف‌شده) وجود ندارد."
		resp.EmptyMessage = &msg
		return resp, nil
	}

	data := &EnrollConfirmData{
		StudentID:        me.ID,
		StudentCode:      me.StudentCode,
		NationalIDMasked: maskNationalCode(nationalCode),
		MajorName:        majorName,
		TermID:           *termID,
		TermTitle:        resp.TermTitle,
		Courses:          courses,
		CheckedAt:        nowISO(),
	}
	if fullName != nil {
		data.StudentName = strings.TrimSpace(*fullName)
	}
	for _, c := range courses {
		data.TotalUnits += c.Units
	}
	resp.Data = data
	return resp, nil
}

// IssueEnrollConfirmFor صدور توکن تأییدیهٔ انتخاب واحد توسط کارشناس ادمین.
// خروجی: توکن، زمان انقضای ISO.
func (s *Service) IssueEnrollConfirmFor(ctx context.Context, studentID, termID int64) (string, string, error) {
	var userID int64
	var studentCode string
	var universityID *int64
	if err := s.Pool.QueryRow(ctx, `
		select "userId", "studentCode", "universityId" from students where id = $1`, studentID).
		Scan(&userID, &studentCode, &universityID); err != nil {
		return "", "", errNoStudent
	}
	ttlMin := 20160.0
	if s.Settings != nil {
		ttlMin = s.Settings.GetNumber(ctx, "ENROLL_CONFIRM_TTL_MINUTES", 20160)
	}
	if !(ttlMin > 0) {
		return "", "", errors.New("مدت اعتبار تأییدیهٔ انتخاب واحد نامعتبر است.")
	}
	if ttlMin > 525600 {
		ttlMin = 525600
	}
	uni := int64(0)
	if universityID != nil {
		uni = *universityID
	}
	token, err := s.Signer.Sign(ctx, map[string]any{
		"uid": userID, "term": termID, "sid": studentID, "sc": studentCode,
		"uni": uni, "kind": "ENROLL_CONFIRM",
	}, int(ttlMin)*60)
	if err != nil {
		return "", "", err
	}
	return token, expiresAtISO(int(ttlMin) * 60), nil
}

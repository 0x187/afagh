// ═══ پیکربندی دپارتمان‌های تسویه و کارتابل دانش‌آموختگان ═══
package graduation

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"strings"
	"time"

	"backend-go/internal/safeurl"
)

// DeptInput ورودی ذخیرهٔ دپارتمان.
type DeptInput struct {
	ID                  *int64  `json:"id"`
	Code                string  `json:"code"`
	Title               string  `json:"title"`
	AutoCheck           string  `json:"autoCheck"`
	APIURL              *string `json:"apiUrl"`
	ResponsibleRoleCode *string `json:"responsibleRoleCode"`
	SortOrder           *int    `json:"sortOrder"`
	IsActive            *bool   `json:"isActive"`
	Hint                *string `json:"hint"`
}

func assertSafeHTTP(raw string) error {
	v := strings.TrimSpace(raw)
	if v == "" {
		return nil
	}
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" {
		return errors.New("نشانی سرویس نامعتبر است.")
	}
	host := u.Hostname()
	if strings.EqualFold(host, "localhost") {
		return errors.New("نشانی سرویس نامعتبر است.")
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()) {
		return errors.New("نشانی سرویس نامعتبر است.")
	}
	return nil
}

// SaveDepartment پورت saveDepartmentAction.
func (s *Service) SaveDepartment(ctx context.Context, universityID *int64, in DeptInput) ([]Dept, error) {
	code := strings.ToUpper(strings.TrimSpace(in.Code))
	if !deptCodeRe.MatchString(code) {
		return nil, ErrDeptCode
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = code
	}
	auto := strings.ToUpper(strings.TrimSpace(in.AutoCheck))
	switch auto {
	case "", "NONE":
		auto = "NONE"
	case "FINANCE_LEDGER", "HTTP_API":
	default:
		return nil, errors.New("نوع بررسی نامعتبر است.")
	}
	var apiURL *string
	if in.APIURL != nil && strings.TrimSpace(*in.APIURL) != "" {
		if err := assertSafeHTTP(*in.APIURL); err != nil {
			return nil, err
		}
		v := strings.TrimSpace(*in.APIURL)
		apiURL = &v
	}
	var role *string
	if in.ResponsibleRoleCode != nil && strings.TrimSpace(*in.ResponsibleRoleCode) != "" {
		v := strings.TrimSpace(*in.ResponsibleRoleCode)
		role = &v
	}
	sortOrder := 100
	if in.SortOrder != nil {
		sortOrder = *in.SortOrder
	}
	active := 1
	if in.IsActive != nil && !*in.IsActive {
		active = 0
	}
	var hint *string
	if in.Hint != nil && strings.TrimSpace(*in.Hint) != "" {
		v := strings.TrimSpace(*in.Hint)
		hint = &v
	}

	if in.ID != nil && *in.ID > 0 {
		var rowUni *int64
		if err := s.Pool.QueryRow(ctx, `select "universityId" from clearance_departments where id = $1`, *in.ID).Scan(&rowUni); err != nil {
			return nil, errors.New("دپارتمان یافت نشد.")
		}
		if rowUni != nil && universityID != nil && *rowUni != *universityID {
			return nil, errors.New("دسترسی ندارید.")
		}
		if _, err := s.Pool.Exec(ctx, `
			update clearance_departments set code = $2, title = $3, "autoCheck" = $4, "apiUrl" = $5,
			       "responsibleRoleCode" = $6, "sortOrder" = $7, "isActive" = $8, hint = $9
			 where id = $1`,
			*in.ID, code, title, auto, apiURL, role, sortOrder, active, hint); err != nil {
			return nil, err
		}
	} else {
		var dupUni *int64
		err := s.Pool.QueryRow(ctx, `select "universityId" from clearance_departments where code = $1`, code).Scan(&dupUni)
		if err == nil && dupUni != nil && universityID != nil && *dupUni != *universityID {
			return nil, errors.New("این کد متعلق به دانشگاه دیگری است.")
		}
		if _, err := s.Pool.Exec(ctx, `
			insert into clearance_departments (code,title,"autoCheck","apiUrl","responsibleRoleCode","sortOrder","isActive",hint,"universityId")
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			on conflict (code) do update set title = excluded.title, "autoCheck" = excluded."autoCheck",
			  "apiUrl" = excluded."apiUrl", "responsibleRoleCode" = excluded."responsibleRoleCode",
			  "sortOrder" = excluded."sortOrder", "isActive" = excluded."isActive", hint = excluded.hint`,
			code, title, auto, apiURL, role, sortOrder, active, hint, universityID); err != nil {
			return nil, err
		}
	}
	return s.Departments(ctx, universityID, false)
}

// DeleteDepartment غیرفعال‌سازی دپارتمان.
func (s *Service) DeleteDepartment(ctx context.Context, universityID *int64, id int64) error {
	var rowUni *int64
	if err := s.Pool.QueryRow(ctx, `select "universityId" from clearance_departments where id = $1`, id).Scan(&rowUni); err != nil {
		return errors.New("دپارتمان یافت نشد.")
	}
	if rowUni != nil && universityID != nil && *rowUni != *universityID {
		return errors.New("دسترسی ندارید.")
	}
	_, err := s.Pool.Exec(ctx, `update clearance_departments set "isActive" = 0 where id = $1`, id)
	return err
}

// ─────────────────── دانش‌آموختگان ───────────────────

// AlumniService تعرفهٔ خدمات.
type AlumniService struct {
	Code             string  `json:"code"`
	Title            string  `json:"title"`
	Hint             string  `json:"hint"`
	NeedsDestination bool    `json:"needsDestination"`
	Fee              float64 `json:"fee"`
}

type alumniServiceDef struct {
	Code, Title, FeeKey, Hint string
	NeedsDestination          bool
}

var alumniServiceDefs = []alumniServiceDef{
	{"OFFICIAL_TRANSCRIPT", "ریزنمرات رسمی (مهر و موم‌شده)", "ALUMNI_FEE_TRANSCRIPT", "صدور ریزنمرات رسمی جهت ارائه به دانشگاه/سازمان", false},
	{"TRANSLATION_CONFIRM", "تأییدیهٔ تحصیلی برای دارالترجمه", "ALUMNI_FEE_TRANSLATION", "نام دارالترجمه یا سازمان مقصد را بنویسید", true},
	{"DEGREE_RELEASE", "آزادسازی مدرک (خرید تعهد خدمت)", "ALUMNI_FEE_RELEASE", "پس از تسویهٔ تعهد خدمت، دانشنامه آزاد می‌شود", false},
	{"DUPLICATE_DEGREE", "صدور المثنی مدرک", "ALUMNI_FEE_DUPLICATE", "در صورت مفقودی؛ نیازمند بررسی اداره آموزش", false},
}

// ServiceCatalog پورت serviceCatalog.
func (s *Service) ServiceCatalog(ctx context.Context) []AlumniService {
	out := make([]AlumniService, 0, len(alumniServiceDefs))
	for _, d := range alumniServiceDefs {
		fee := 0.0
		if s.Settings != nil {
			fee = s.Settings.GetNumber(ctx, d.FeeKey, 0)
		}
		out = append(out, AlumniService{Code: d.Code, Title: d.Title, Hint: d.Hint, NeedsDestination: d.NeedsDestination, Fee: fee})
	}
	return out
}

// AlumniRow درخواست خدمت دانش‌آموخته.
type AlumniRow struct {
	ID           int64      `json:"id"`
	RequestType  string     `json:"requestType"`
	TrackingCode string     `json:"trackingCode"`
	Status       string     `json:"status"`
	Fee          float64    `json:"fee"`
	Destination  *string    `json:"destination"`
	Description  *string    `json:"description"`
	AdminNote    *string    `json:"adminNote"`
	StudentID    int64      `json:"studentId"`
	StudentCode  string     `json:"studentCode"`
	FullName     string     `json:"fullName"`
	CreatedAt    *time.Time `json:"createdAt"`
}

// AllRequests پورت allRequests.
func (s *Service) AllRequests(ctx context.Context, status string) ([]AlumniRow, error) {
	args := []any{}
	where := ""
	if status != "" && status != "ALL" {
		args = append(args, status)
		where = ` where r.status = $1`
	}
	rows, err := s.Pool.Query(ctx, `
		select r.id, r."requestType", r."trackingCode", r.status, coalesce(r.fee,0)::float8,
		       r.destination, r.description, r."adminNote", r."studentId",
		       st."studentCode", (u."firstName" || ' ' || u."lastName"), r."createdAt"
		  from alumni_requests r
		  join students st on st.id = r."studentId"
		  join users u on u.id = st."userId"`+where+`
		 order by r.id desc limit 200`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AlumniRow{}
	for rows.Next() {
		var r AlumniRow
		if err := rows.Scan(&r.ID, &r.RequestType, &r.TrackingCode, &r.Status, &r.Fee,
			&r.Destination, &r.Description, &r.AdminNote, &r.StudentID,
			&r.StudentCode, &r.FullName, &r.CreatedAt); err == nil {
			out = append(out, r)
		}
	}
	return out, nil
}

// ResolveAlumniInput ورودی پاسخ به درخواست.
type ResolveAlumniInput struct {
	RequestID     int64   `json:"requestId"`
	Status        string  `json:"status"`
	Note          *string `json:"note"`
	ResultFileURL *string `json:"resultFileUrl"`
	UserID        int64   `json:"-"`
}

// ResolveRequest پورت resolveRequest.
func (s *Service) ResolveRequest(ctx context.Context, in ResolveAlumniInput) error {
	switch in.Status {
	case "IN_REVIEW", "DONE", "REJECTED":
	default:
		return errors.New("وضعیت نامعتبر است.")
	}
	var studentID int64
	var tracking string
	var oldNote, oldFile *string
	if err := s.Pool.QueryRow(ctx, `
		select "studentId", "trackingCode", "adminNote", "resultFileUrl" from alumni_requests where id = $1`,
		in.RequestID).Scan(&studentID, &tracking, &oldNote, &oldFile); err != nil {
		return errors.New("درخواست یافت نشد.")
	}
	note := oldNote
	if in.Note != nil {
		note = in.Note
	}
	file := oldFile
	if in.ResultFileURL != nil && safeurl.IsSafeLinkURL(strings.TrimSpace(*in.ResultFileURL)) {
		v := strings.TrimSpace(*in.ResultFileURL)
		file = &v
	}
	if _, err := s.Pool.Exec(ctx, `
		update alumni_requests set status = $2, "adminNote" = $3, "resultFileUrl" = $4,
		       "handledBy" = $5, "updatedAt" = now() where id = $1`,
		in.RequestID, in.Status, note, file, in.UserID); err != nil {
		return err
	}
	var userID int64
	if err := s.Pool.QueryRow(ctx, `select "userId" from students where id = $1`, studentID).Scan(&userID); err == nil && userID > 0 {
		text := "درخواست " + tracking + " در حال بررسی است."
		switch in.Status {
		case "DONE":
			text = "درخواست " + tracking + " انجام شد."
			if note != nil && strings.TrimSpace(*note) != "" {
				text += " " + strings.TrimSpace(*note)
			}
		case "REJECTED":
			text = "درخواست " + tracking + " رد شد."
			if note != nil && strings.TrimSpace(*note) != "" {
				text += " دلیل: " + strings.TrimSpace(*note)
			}
		}
		payload := `{"text":` + mustJSONString(text) + `}`
		_, _ = s.Pool.Exec(ctx, `insert into notifications ("userId","eventCode",payload) values ($1,$2,$3)`,
			userID, "ALUMNI_REQUEST_"+in.Status, payload)
	}
	return nil
}

func mustJSONString(v string) string {
	b, _ := json.Marshal(v)
	return string(b)
}

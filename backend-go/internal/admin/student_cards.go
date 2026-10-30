// ═══ کارت دانشجویی — صدور، تمدید، ابطال و چاپ ═══
package admin

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"backend-go/internal/fa"
	"backend-go/internal/jalali"
	"backend-go/internal/qr"
	"backend-go/internal/session"
)

// StudentCardStats آمار کارت‌ها.
type StudentCardStats struct {
	Total   int `json:"total"`
	Issued  int `json:"issued"`
	Blocked int `json:"blocked"`
	Expired int `json:"expired"`
}

// StudentCardInfo کارت یک دانشجو.
type StudentCardInfo struct {
	ID          int64   `json:"id"`
	Token       string  `json:"token"`
	PrintStatus string  `json:"printStatus"`
	RFID        *string `json:"rfidSerialNumber"`
	IssuedAt    *string `json:"issuedAt"`
	ExpiresAt   *string `json:"expiresAt"`
	Expired     bool    `json:"expired"`
}

// StudentCardRow ردیف فهرست کارت‌ها.
type StudentCardRow struct {
	StudentID    int64            `json:"studentId"`
	StudentCode  string           `json:"studentCode"`
	FullName     string           `json:"fullName"`
	NationalCode *string          `json:"nationalCode"`
	Status       string           `json:"status"`
	EntryYear    *int             `json:"entryYear"`
	MajorName    *string          `json:"majorName"`
	DegreeLevel  *string          `json:"degreeLevel"`
	Card         *StudentCardInfo `json:"card"`
	Debt         float64          `json:"debt"`
}

// StudentCardsResponse پاسخ فهرست.
type StudentCardsResponse struct {
	Rows       []StudentCardRow `json:"rows"`
	Total      int              `json:"total"`
	Page       int              `json:"page"`
	TotalPages int              `json:"totalPages"`
	PerPage    int              `json:"perPage"`
	Stats      StudentCardStats `json:"stats"`
	ValidDays  int              `json:"validDays"`
	SecretSet  bool             `json:"secretSet"`
}

const cardPerPage = 50

func (s *Service) settingNumber(ctx context.Context, key string, fallback float64) float64 {
	if s.Store == nil {
		return fallback
	}
	raw, err := s.Store.Get(ctx, key)
	if err != nil {
		return fallback
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return fallback
	}
	return v
}

// ListStudentCards پورت صفحهٔ admin/student-cards (با تجمیع یک‌بارهٔ دفتر مالی).
func (s *Service) ListStudentCards(ctx context.Context, user *session.User, cookie, q string, page int) (*StudentCardsResponse, error) {
	resp := &StudentCardsResponse{
		Rows: []StudentCardRow{}, Page: 1, PerPage: cardPerPage,
		ValidDays: int(s.settingNumber(ctx, "STUDENT_CARD_VALID_DAYS", 365)),
	}
	if s.Store != nil {
		if v, err := s.Store.Get(ctx, "TICKET_TOKEN_SECRET"); err == nil {
			resp.SecretSet = strings.TrimSpace(v) != ""
		}
	}
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return resp, nil
	}
	if page < 1 {
		page = 1
	}
	args := []any{*uniID}
	conds := []string{`st."universityId" = $1`}
	if q = strings.TrimSpace(q); q != "" {
		like := "%" + fa.EscapeLikeChars(fa.ToEnDigits(q)) + "%"
		args = append(args, like)
		p := "$" + strconv.Itoa(len(args))
		conds = append(conds, fmt.Sprintf(`(st."studentCode" ILIKE %s ESCAPE '\' OR u."nationalCode" ILIKE %s ESCAPE '\'
			OR u."firstName" ILIKE %s ESCAPE '\' OR u."lastName" ILIKE %s ESCAPE '\')`, p, p, p, p))
	}
	where := strings.Join(conds, " and ")

	var total int
	if err := s.DB.Pool.QueryRow(ctx, `
		select count(*)::int from students st join users u on u.id = st."userId" where `+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	totalPages := (total + cardPerPage - 1) / cardPerPage
	if totalPages < 1 {
		totalPages = 1
	}
	if page > totalPages {
		page = totalPages
	}
	dataArgs := append([]any{}, args...)
	dataArgs = append(dataArgs, cardPerPage, (page-1)*cardPerPage)
	rows, err := s.DB.Pool.Query(ctx, `
		select st.id, coalesce(st."studentCode",''), (u."firstName" || ' ' || u."lastName"),
		       u."nationalCode", st.status, st."entryYear", m.name, d.title,
		       sc.id, sc."secureToken", sc."printStatus", sc."rfidSerialNumber",
		       sc."issuedAt", sc."expiresAt",
		       coalesce((select sum(case when sl."transactionType" in ('TUITION_CHARGE','CHARGE') then sl.amount else -sl.amount end)
		                   from student_ledger sl where sl."studentId" = st.id), 0)::float8
		  from students st
		  join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		  left join degree_level_configs d on d.id = st."degreeLevelId"
		  left join student_cards sc on sc."studentId" = st.id
		 where `+where+`
		 order by st.id desc limit $`+strconv.Itoa(len(dataArgs)-1)+` offset $`+strconv.Itoa(len(dataArgs)), dataArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r StudentCardRow
		var cardID *int64
		var token, printStatus, rfid *string
		var issuedAt, expiresAt *time.Time
		if err := rows.Scan(&r.StudentID, &r.StudentCode, &r.FullName, &r.NationalCode, &r.Status,
			&r.EntryYear, &r.MajorName, &r.DegreeLevel, &cardID, &token, &printStatus, &rfid,
			&issuedAt, &expiresAt, &r.Debt); err != nil {
			continue
		}
		if r.Debt < 0 {
			r.Debt = 0
		}
		if cardID != nil && token != nil {
			info := &StudentCardInfo{ID: *cardID, Token: *token, PrintStatus: "PENDING", RFID: rfid}
			if printStatus != nil {
				info.PrintStatus = *printStatus
			}
			if issuedAt != nil {
				v := issuedAt.UTC().Format(time.RFC3339)
				info.IssuedAt = &v
			}
			if expiresAt != nil {
				v := expiresAt.UTC().Format(time.RFC3339)
				info.ExpiresAt = &v
				info.Expired = expiresAt.Before(time.Now())
			}
			r.Card = info
		}
		resp.Rows = append(resp.Rows, r)
	}
	resp.Total = total
	resp.Page = page
	resp.TotalPages = totalPages

	// آمار کلی (مستقل از صفحه/جست‌وجو — همان رفتار TS)
	_ = s.DB.Pool.QueryRow(ctx, `select count(*)::int from students`).Scan(&resp.Stats.Total)
	_ = s.DB.Pool.QueryRow(ctx, `select count(*)::int from student_cards`).Scan(&resp.Stats.Issued)
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*)::int from (
		  select "studentId" from student_ledger group by "studentId"
		  having sum(case when "transactionType" in ('TUITION_CHARGE','CHARGE') then amount else -amount end) > 0
		) d`).Scan(&resp.Stats.Blocked)
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*)::int from student_cards
		 where "expiresAt" < now() or "printStatus" in ('REVOKED','LOST')`).Scan(&resp.Stats.Expired)
	return resp, nil
}

// IssueCardResult نتیجهٔ صدور.
type IssueCardResult struct {
	Token   string `json:"token"`
	Renewed bool   `json:"renewed"`
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return strings.Repeat("0", n*2)
	}
	return hex.EncodeToString(b)
}

// IssueStudentCard پورت issueStudentCard (توکن ۴۸ کاراکتری/QRFID).
func (s *Service) IssueStudentCard(ctx context.Context, user *session.User, cookie string, studentID int64, force bool) (*IssueCardResult, error) {
	if err := s.studentInUniversity(ctx, user, cookie, studentID); err != nil {
		return nil, err
	}
	validDays := int(s.settingNumber(ctx, "STUDENT_CARD_VALID_DAYS", 365))
	if validDays <= 0 {
		validDays = 365
	}
	now := time.Now().UTC()
	expires := now.Add(time.Duration(validDays) * 24 * time.Hour)

	var cardID int64
	var token string
	err := s.DB.Pool.QueryRow(ctx, `select id, coalesce("secureToken",'') from student_cards where "studentId" = $1 limit 1`, studentID).Scan(&cardID, &token)
	if err == nil && !force {
		_, err := s.DB.Pool.Exec(ctx, `
			update student_cards set "printStatus" = 'PRINTED', "issuedAt" = $2, "expiresAt" = $3 where id = $1`,
			cardID, now, expires)
		if err != nil {
			return nil, err
		}
		return &IssueCardResult{Token: token, Renewed: true}, nil
	}
	newToken := randomHex(24)
	if err == nil {
		_, err := s.DB.Pool.Exec(ctx, `
			update student_cards set "secureToken" = $2, "printStatus" = 'PRINTED',
			       "issuedAt" = $3, "expiresAt" = $4 where id = $1`,
			cardID, newToken, now, expires)
		if err != nil {
			return nil, err
		}
		return &IssueCardResult{Token: newToken, Renewed: false}, nil
	}
	rfid := fmt.Sprintf("E280-%s-%s-%s",
		strings.ToUpper(randomHex(2)), strings.ToUpper(randomHex(2)), strings.ToUpper(randomHex(2)))
	_, err = s.DB.Pool.Exec(ctx, `
		insert into student_cards ("studentId","secureToken","printStatus","rfidSerialNumber","issuedAt","expiresAt")
		values ($1,$2,'PRINTED',$3,$4,$5)`, studentID, newToken, rfid, now, expires)
	if err != nil {
		return nil, err
	}
	return &IssueCardResult{Token: newToken, Renewed: false}, nil
}

// RevokeStudentCard ابطال/مفقودی کارت.
func (s *Service) RevokeStudentCard(ctx context.Context, user *session.User, cookie string, studentID int64, status string) error {
	if status != "REVOKED" && status != "LOST" {
		return errors.New("وضعیت نامعتبر است.")
	}
	if err := s.studentInUniversity(ctx, user, cookie, studentID); err != nil {
		return err
	}
	_, err := s.DB.Pool.Exec(ctx, `update student_cards set "printStatus" = $2 where "studentId" = $1`, studentID, status)
	return err
}

func (s *Service) studentInUniversity(ctx context.Context, user *session.User, cookie string, studentID int64) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	var sUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, studentID).Scan(&sUni); err != nil {
		return errors.New("دانشجو یافت نشد.")
	}
	if sUni != nil && *sUni != *uniID {
		return errors.New("دانشجو متعلق به دانشگاه دیگری است.")
	}
	return nil
}

// StudentCardPrint دادهٔ صفحهٔ چاپ کارت.
type StudentCardPrint struct {
	StudentID    int64   `json:"studentId"`
	UserID       int64   `json:"userId"`
	StudentCode  string  `json:"studentCode"`
	FullName     string  `json:"fullName"`
	NationalCode *string `json:"nationalCode"`
	EntryYear    int     `json:"entryYear"`
	Status       string  `json:"status"`
	MajorName    *string `json:"majorName"`
	DegreeTitle  *string `json:"degreeTitle"`
	University   string  `json:"universityTitle"`
	LogoURL      *string `json:"logoUrl"`
	HasPhoto     bool    `json:"hasPhoto"`
	CardToken    *string `json:"cardToken"`
	CardStatus   *string `json:"cardStatus"`
	ValidUntil   *string `json:"validUntil"`
	VerifyURL    string  `json:"verifyUrl"`
	QRSVG        string  `json:"qrSvg"`
}

// StudentCardPrintData پورت صفحهٔ چاپ کارت با QR گیت حراست.
func (s *Service) StudentCardPrintData(ctx context.Context, studentID int64) (*StudentCardPrint, error) {
	var out StudentCardPrint
	var expires *time.Time
	err := s.DB.Pool.QueryRow(ctx, `
		select st.id, st."userId", coalesce(st."studentCode",''), (u."firstName" || ' ' || u."lastName"),
		       u."nationalCode", st."entryYear", st.status, m.name, d.title,
		       coalesce(uni.title,''), uni."logoUrl", (coalesce(to_jsonb(u)->>'photoKey','') <> ''),
		       sc."secureToken", sc."printStatus", sc."expiresAt"
		  from students st
		  join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		  left join degree_level_configs d on d.id = st."degreeLevelId"
		  left join universities uni on uni.id = st."universityId"
		  left join student_cards sc on sc."studentId" = st.id
		 where st.id = $1`, studentID).
		Scan(&out.StudentID, &out.UserID, &out.StudentCode, &out.FullName, &out.NationalCode,
			&out.EntryYear, &out.Status, &out.MajorName, &out.DegreeTitle,
			&out.University, &out.LogoURL, &out.HasPhoto,
			&out.CardToken, &out.CardStatus, &expires)
	if err != nil {
		return nil, errors.New("دانشجو یافت نشد.")
	}
	if expires != nil {
		v := jalali.ToShamsi(expires.UTC().Format(time.RFC3339))
		out.ValidUntil = &v
	}
	if out.LogoURL == nil || *out.LogoURL == "" {
		if s.Store != nil {
			if v, err := s.Store.Get(ctx, "UNIVERSITY_LOGO"); err == nil && strings.TrimSpace(v) != "" {
				vv := strings.TrimSpace(v)
				out.LogoURL = &vv
			}
		}
	}
	if out.CardToken != nil && *out.CardToken != "" {
		base := "http://localhost:8080"
		if s.Store != nil {
			if v, err := s.Store.Get(ctx, "PUBLIC_BASE_URL"); err == nil && strings.TrimSpace(v) != "" {
				base = strings.TrimRight(strings.TrimSpace(v), "/")
			}
		}
		out.VerifyURL = base + "/id/" + *out.CardToken
		if svg, err := qr.SVG(out.VerifyURL, qr.Options{Level: "Q", Size: 128, Margin: 4}); err == nil {
			out.QRSVG = svg
		}
	}
	return &out, nil
}

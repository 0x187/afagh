// ═══ عملیات گردش‌کار فارغ‌التحصیلی — تأیید، ایرانداک، تسویه، صدور ═══
package graduation

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/irandoc"
	"backend-go/internal/money"
)

// ApproveByHead تأیید مدیر گروه و پیشروی خودکار.
func (s *Service) ApproveByHead(ctx context.Context, auditID, userID int64, note *string) error {
	tag, err := s.Pool.Exec(ctx, `
		update graduation_audits set "headApprovalStatus" = 1, "headApprovedBy" = $2,
		       "headApprovedAt" = now(), "headNote" = $3, "lastEventAt" = now()
		 where id = $1`, auditID, userID, note)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("پرونده یافت نشد.")
	}
	return s.Students.AdvanceDossierByID(ctx, auditID)
}

// Hold توقف پرونده با دلیل.
func (s *Service) Hold(ctx context.Context, auditID int64, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return errors.New("دلیل توقف را بنویسید.")
	}
	var studentID int64
	if err := s.Pool.QueryRow(ctx, `select "studentId" from graduation_audits where id = $1`, auditID).Scan(&studentID); err != nil {
		return errors.New("پرونده یافت نشد.")
	}
	if _, err := s.Pool.Exec(ctx, `
		update graduation_audits set "workflowStatus" = 'ON_HOLD', note = $2, "lastEventAt" = now()
		 where id = $1`, auditID, reason); err != nil {
		return err
	}
	var userID int64
	if err := s.Pool.QueryRow(ctx, `select "userId" from students where id = $1`, studentID).Scan(&userID); err == nil {
		s.notifyUser(ctx, userID, "GRADUATION_HOLD", "پروندهٔ فارغ‌التحصیلی شما متوقف شد: "+reason)
	}
	return nil
}

// Resume رفع توقف و ورود دوباره به چرخهٔ خودکار.
func (s *Service) Resume(ctx context.Context, auditID int64) error {
	if _, err := s.Pool.Exec(ctx, `
		update graduation_audits set "workflowStatus" = 'CATALOG_REVIEW', note = null, "lastEventAt" = now()
		 where id = $1`, auditID); err != nil {
		return err
	}
	return s.Students.AdvanceDossierByID(ctx, auditID)
}

// Advance بازمحاسبهٔ وضعیت.
func (s *Service) Advance(ctx context.Context, auditID int64) (map[string]any, error) {
	before, _ := s.dossierStatus(ctx, auditID)
	if err := s.Students.AdvanceDossierByID(ctx, auditID); err != nil {
		return nil, err
	}
	after, _ := s.dossierStatus(ctx, auditID)
	return map[string]any{"status": after, "changed": after != before}, nil
}

func (s *Service) dossierStatus(ctx context.Context, auditID int64) (string, error) {
	var st string
	err := s.Pool.QueryRow(ctx, `select "workflowStatus" from graduation_audits where id = $1`, auditID).Scan(&st)
	return st, err
}

// ─────────────────── ایرانداک ───────────────────

// IrandocOutcome نتیجهٔ استعلام همانندجویی.
type IrandocOutcome struct {
	Passed     bool    `json:"passed"`
	Similarity float64 `json:"similarity"`
	Message    string  `json:"message"`
}

// RunIrandoc پورت runIrandoc.
func (s *Service) RunIrandoc(ctx context.Context, auditID int64, trackingCode, thesisTitle string) (*IrandocOutcome, error) {
	var studentID int64
	var thesisRequired int
	var savedTracking, savedTitle *string
	if err := s.Pool.QueryRow(ctx, `
		select "studentId", coalesce("thesisRequired",0), "irandocTrackingCode", "thesisTitle"
		  from graduation_audits where id = $1`, auditID).
		Scan(&studentID, &thesisRequired, &savedTracking, &savedTitle); err != nil {
		return nil, errors.New("پرونده یافت نشد.")
	}
	if thesisRequired == 0 {
		_, _ = s.Pool.Exec(ctx, `update graduation_audits set "irandocStatus" = 'SKIPPED', "lastEventAt" = now() where id = $1`, auditID)
		return &IrandocOutcome{Passed: true, Message: "این مقطع پایان‌نامه ندارد؛ مرحله رد شد."}, nil
	}
	tracking := strings.TrimSpace(trackingCode)
	if tracking == "" && savedTracking != nil {
		tracking = strings.TrimSpace(*savedTracking)
	}
	if tracking == "" {
		return nil, errors.New("کد رهگیری ثبت پایان‌نامه در ایرانداک وارد نشده است.")
	}
	title := strings.TrimSpace(thesisTitle)
	if title == "" && savedTitle != nil {
		title = strings.TrimSpace(*savedTitle)
	}
	if title == "" {
		title = "پایان‌نامه"
	}
	threshold := 20.0
	if s.Settings != nil {
		threshold = s.Settings.GetNumber(ctx, "GRAD_IRANDOC_MAX_SIMILARITY", 20)
	}
	var nationalCode *string
	_ = s.Pool.QueryRow(ctx, `
		select u."nationalCode" from students st join users u on u.id = st."userId" where st.id = $1`, studentID).Scan(&nationalCode)
	nc := ""
	if nationalCode != nil {
		nc = *nationalCode
	}
	check := irandoc.Check(ctx, s.Settings, irandoc.Params{
		NationalCode: nc, TrackingCode: tracking, ThesisTitle: title, Threshold: threshold,
	})
	res := &IrandocOutcome{Passed: check.Decision == "AUTO_APPROVE", Similarity: check.SimilarityPercentage, Message: check.Message}
	passed := res.Passed
	status := "REJECTED"
	if passed {
		status = "PASSED"
	}
	var similarity any
	if res.Similarity > 0 {
		similarity = res.Similarity
	}
	_, _ = s.Pool.Exec(ctx, `
		update graduation_audits set "irandocTrackingCode" = $2, "thesisTitle" = $3,
		       "irandocSimilarityScore" = $4, "irandocStatus" = $5, "irandocCheckedAt" = now(),
		       "lastEventAt" = now() where id = $1`,
		auditID, tracking, title, similarity, status)
	var userID int64
	if err := s.Pool.QueryRow(ctx, `select "userId" from students where id = $1`, studentID).Scan(&userID); err == nil {
		text := fmt.Sprintf("استعلام همانندجویی پایان‌نامه انجام شد: %s٪ (مجاز تا %s٪).", trimFloat(res.Similarity), trimFloat(threshold))
		if !passed {
			text = fmt.Sprintf("درصد همانندجویی پایان‌نامه (%s٪) بیش از سقف مجاز است؛ برای اصلاح با تحصیلات تکمیلی تماس بگیرید.", trimFloat(res.Similarity))
		}
		s.notifyUser(ctx, userID, "GRADUATION_IRANDOC", text)
	}
	if passed {
		_ = s.Students.AdvanceDossierByID(ctx, auditID)
	}
	return res, nil
}

// safeJSONPost POST با گارد مقصد عمومی (بدون localhost/آی‌پی خصوصی).
func safeJSONPost(ctx context.Context, rawURL string, body []byte, headers map[string]string) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, errors.New("نشانی نامعتبر است")
	}
	host := u.Hostname()
	if host == "" || strings.EqualFold(host, "localhost") {
		return nil, errors.New("مقصد نامعتبر است")
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()) {
		return nil, errors.New("مقصد نامعتبر است")
	}
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, rawURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return raw, nil
}

// ─────────────────── تسویه‌حساب ───────────────────

// StartClearance ساخت چک‌لیست، اطلاع‌رسانی و بررسی خودکار.
func (s *Service) StartClearance(ctx context.Context, auditID int64) (map[string]any, error) {
	var studentID int64
	if err := s.Pool.QueryRow(ctx, `select "studentId" from graduation_audits where id = $1`, auditID).Scan(&studentID); err != nil {
		return nil, errors.New("پرونده یافت نشد.")
	}
	deps, err := s.Departments(ctx, nil, true)
	if err != nil {
		return nil, err
	}
	for _, d := range deps {
		_, _ = s.Pool.Exec(ctx, `
			insert into clearance_checklist ("studentId","auditId",department,status)
			values ($1,$2,$3,'PENDING') on conflict do nothing`, studentID, auditID, d.Code)
	}
	_, _ = s.Pool.Exec(ctx, `update graduation_audits set "workflowStatus" = 'CLEARANCE', "lastEventAt" = now() where id = $1`, auditID)
	var userID int64
	_ = s.Pool.QueryRow(ctx, `select "userId" from students where id = $1`, studentID).Scan(&userID)
	for _, d := range deps {
		if d.ResponsibleRoleCode != nil {
			s.notifyRole(ctx, *d.ResponsibleRoleCode, "CLEARANCE_REQUEST",
				fmt.Sprintf("درخواست تسویه‌حساب «%s» برای یک دانش‌آموخته در انتظار بررسی است.", d.Title))
		}
	}
	if userID > 0 {
		s.notifyUser(ctx, userID, "GRADUATION_CLEARANCE", "مرحلهٔ تسویه‌حساب پروندهٔ شما به‌صورت هم‌زمان در همهٔ واحدها آغاز شد.")
	}
	return s.RunAutoClearance(ctx, auditID)
}

// AutoClearanceResult نتیجهٔ بررسی خودکار.
type AutoClearanceResult struct {
	AutoCleared int `json:"autoCleared"`
	WithDebt    int `json:"withDebt"`
}

// RunAutoClearance پورت runAutoClearance.
func (s *Service) RunAutoClearance(ctx context.Context, auditID int64) (map[string]any, error) {
	var studentID int64
	if err := s.Pool.QueryRow(ctx, `select "studentId" from graduation_audits where id = $1`, auditID).Scan(&studentID); err != nil {
		return nil, errors.New("پرونده یافت نشد.")
	}
	deps, err := s.Departments(ctx, nil, true)
	if err != nil {
		return nil, err
	}
	depByCode := map[string]Dept{}
	for _, d := range deps {
		depByCode[d.Code] = d
	}
	rows, err := s.Pool.Query(ctx, `
		select id, department, status, coalesce("amountDue",0)::float8
		  from clearance_checklist where "auditId" = $1`, auditID)
	if err != nil {
		return nil, err
	}
	type item struct {
		ID         int64
		AmountDue  float64
		Department string
		Status     string
	}
	list := []item{}
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.ID, &it.Department, &it.Status, &it.AmountDue); err == nil {
			list = append(list, it)
		}
	}
	rows.Close()

	autoCleared, withDebt := 0, 0
	for _, it := range list {
		if it.Status == "CLEARED" || it.Status == "WAIVED" {
			continue
		}
		dep, ok := depByCode[it.Department]
		if !ok {
			continue
		}
		switch dep.AutoCheck {
		case "FINANCE_LEDGER":
			balance := s.Students.LedgerBalanceOfStudent(ctx, studentID)
			cleared := balance <= 0
			status := "HAS_DEBT"
			detail := "مانده بدهی: " + faThousands(balance) + " ریال"
			var resolved any
			if cleared {
				status = "CLEARED"
				detail = "بدهی مالی صفر است — تأیید خودکار سیستم."
				resolved = time.Now().UTC()
				autoCleared++
			} else {
				withDebt++
			}
			_, _ = s.Pool.Exec(ctx, `
				update clearance_checklist set status = $2, "amountDue" = $3, detail = $4,
				       "autoChecked" = 1, "resolvedAt" = $5 where id = $1`,
				it.ID, status, maxF(balance, 0), detail, resolved)
		case "HTTP_API":
			if dep.APIURL == nil || strings.TrimSpace(*dep.APIURL) == "" {
				continue
			}
			apiURL := *dep.APIURL
			sep := "?"
			if strings.Contains(apiURL, "?") {
				sep = "&"
			}
			raw, err := safeJSONGet(ctx, apiURL+sep+"studentId="+fmt.Sprint(studentID))
			if err != nil {
				msg := fmt.Sprintf("سرویس «%s» پاسخ نداد؛ نیاز به بررسی کارشناس. (%s)", dep.Title, truncateErr(err.Error()))
				_, _ = s.Pool.Exec(ctx, `update clearance_checklist set detail = $2 where id = $1`, it.ID, msg)
				continue
			}
			var j struct {
				Cleared   bool    `json:"cleared"`
				AmountDue float64 `json:"amountDue"`
				Detail    string  `json:"detail"`
			}
			if err := json.Unmarshal(raw, &j); err != nil {
				continue
			}
			status := "HAS_DEBT"
			detail := "بدهی/امانت باز طبق سرویس بیرونی."
			var resolved any
			if j.Cleared {
				status = "CLEARED"
				detail = "تأیید خودکار سرویس بیرونی."
				resolved = time.Now().UTC()
				autoCleared++
			} else {
				withDebt++
			}
			if strings.TrimSpace(j.Detail) != "" {
				detail = j.Detail
			}
			_, _ = s.Pool.Exec(ctx, `
				update clearance_checklist set status = $2, "amountDue" = $3, detail = $4,
				       "autoChecked" = 1, "resolvedAt" = $5 where id = $1`,
				it.ID, status, int64(j.AmountDue+0.5), detail, resolved)
		}
	}

	if withDebt > 0 {
		fresh, _ := s.Pool.Query(ctx, `
			select department, coalesce("amountDue",0)::float8 from clearance_checklist
			 where "auditId" = $1 and status = 'HAS_DEBT'`, auditID)
		lines := []string{"برای ادامهٔ فرآیند فارغ‌التحصیلی، تسویه‌حساب موارد زیر باقی مانده است:"}
		if fresh != nil {
			for fresh.Next() {
				var dep string
				var amount float64
				if err := fresh.Scan(&dep, &amount); err == nil {
					title := dep
					if d, ok := depByCode[dep]; ok {
						title = d.Title
					}
					line := "• " + title
					if amount > 0 {
						line += " — " + faThousands(amount) + " ریال"
					}
					lines = append(lines, line)
				}
			}
			fresh.Close()
		}
		lines = append(lines, "پس از تسویه، سامانه به‌صورت خودکار وضعیت را سبز می‌کند و نیازی به مراجعهٔ حضوری نیست.")
		var userID int64
		if err := s.Pool.QueryRow(ctx, `select "userId" from students where id = $1`, studentID).Scan(&userID); err == nil {
			s.notifyUser(ctx, userID, "GRADUATION_CLEARANCE_DEBT", strings.Join(lines, "\n"))
		}
	}
	_ = s.Students.AdvanceDossierByID(ctx, auditID)
	return map[string]any{"autoCleared": autoCleared, "withDebt": withDebt}, nil
}

func safeJSONGet(ctx context.Context, rawURL string) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, errors.New("نشانی نامعتبر است")
	}
	host := u.Hostname()
	if host == "" || strings.EqualFold(host, "localhost") {
		return nil, errors.New("مقصد نامعتبر است")
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()) {
		return nil, errors.New("مقصد نامعتبر است")
	}
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return raw, nil
}

func truncateErr(s string) string {
	if len(s) > 80 {
		return s[:80]
	}
	return s
}

func maxF(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func faThousands(v float64) string {
	return moneyFormat(v)
}

func moneyFormat(v float64) string {
	// جداکنندهٔ هزارگان با ارقام فارسی — بدون وابستگی به locale.
	n := int64(v + 0.5)
	neg := n < 0
	if neg {
		n = -n
	}
	s := fmt.Sprintf("%d", n)
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteRune('٬')
		}
		b.WriteRune(r)
	}
	out := faDigits(b.String())
	if neg {
		return "-" + out
	}
	return out
}

func faDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune('۰' + (r - '0'))
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// SetClearance ثبت دستی وضعیت یک ردیف تسویه.
func (s *Service) SetClearance(ctx context.Context, checklistID int64, status string, detail *string, amountDue *float64, userID int64) error {
	switch status {
	case "CLEARED", "HAS_DEBT", "WAIVED", "PENDING":
	default:
		return errors.New("وضعیت نامعتبر است.")
	}
	var auditID *int64
	var currentDetail *string
	var currentAmount *float64
	if err := s.Pool.QueryRow(ctx, `
		select "auditId", detail, "amountDue"::float8 from clearance_checklist where id = $1`, checklistID).
		Scan(&auditID, &currentDetail, &currentAmount); err != nil {
		return errors.New("ردیف تسویه یافت نشد.")
	}
	d := currentDetail
	if detail != nil {
		d = detail
	}
	amount := 0.0
	if currentAmount != nil {
		amount = *currentAmount
	}
	if amountDue != nil {
		amount = *amountDue
	}
	var resolved any
	if status == "CLEARED" || status == "WAIVED" {
		resolved = time.Now().UTC()
	}
	if _, err := s.Pool.Exec(ctx, `
		update clearance_checklist set status = $2, detail = $3, "amountDue" = $4,
		       "resolvedBy" = $5, "resolvedAt" = $6, "autoChecked" = 0 where id = $1`,
		checklistID, status, d, int64(amount+0.5), userID, resolved); err != nil {
		return err
	}
	if auditID != nil {
		return s.Students.AdvanceDossierByID(ctx, *auditID)
	}
	return nil
}

// ─────────────────── سجاد و کد صحت ───────────────────

func (s *Service) sajjadPending(ctx context.Context, auditID int64) bool {
	require := s.Settings != nil && s.Settings.GetBool(ctx, "GRAD_REQUIRE_SAJJAD")
	if !require {
		return false
	}
	var status, code *string
	_ = s.Pool.QueryRow(ctx, `select "sajjadStatus", "sajjadRequestCode" from graduation_audits where id = $1`, auditID).
		Scan(&status, &code)
	if status != nil && (*status == "SKIPPED" || *status == "CONFIRMED") {
		return false
	}
	return code == nil || strings.TrimSpace(*code) == ""
}

// WaiveSajjad معاف‌کردن از گام سجاد.
func (s *Service) WaiveSajjad(ctx context.Context, auditID int64, note *string) error {
	if note != nil && strings.TrimSpace(*note) != "" {
		_, _ = s.Pool.Exec(ctx, `
			update graduation_audits set "sajjadStatus" = 'SKIPPED', "headNote" = $2, "lastEventAt" = now()
			 where id = $1`, auditID, *note)
	} else {
		_, _ = s.Pool.Exec(ctx, `
			update graduation_audits set "sajjadStatus" = 'SKIPPED', "lastEventAt" = now() where id = $1`, auditID)
	}
	return s.Students.AdvanceDossierByID(ctx, auditID)
}

// MinistryCodeResult نتیجهٔ دریافت کد صحت.
type MinistryCodeResult struct {
	Code   string `json:"code"`
	Online bool   `json:"online"`
}

// RequestMinistryCode پورت requestMinistryCode.
func (s *Service) RequestMinistryCode(ctx context.Context, auditID int64) (*MinistryCodeResult, error) {
	var studentID int64
	if err := s.Pool.QueryRow(ctx, `select "studentId" from graduation_audits where id = $1`, auditID).Scan(&studentID); err != nil {
		return nil, errors.New("پرونده یافت نشد.")
	}
	if s.sajjadPending(ctx, auditID) {
		return nil, errors.New("ابتدا دانشجو باید در سامانهٔ سجاد درخواست کد صحت ثبت و کد رهگیری را در پرونده وارد کند.")
	}
	var studentCode string
	var nationalCode, firstName, lastName *string
	var requestCode *string
	_ = s.Pool.QueryRow(ctx, `
		select st."studentCode", u."nationalCode", u."firstName", u."lastName", g."sajjadRequestCode"
		  from students st join users u on u.id = st."userId"
		  join graduation_audits g on g."studentId" = st.id
		 where g.id = $1`, auditID).Scan(&studentCode, &nationalCode, &firstName, &lastName, &requestCode)

	code := ""
	online := false
	base := ""
	if s.Settings != nil {
		v, _ := s.Settings.Get(ctx, "SAJJAD_BASE_URL")
		base = strings.TrimRight(strings.TrimSpace(v), "/")
	}
	if base != "" {
		nc := ""
		if nationalCode != nil {
			nc = *nationalCode
		}
		payload, _ := json.Marshal(map[string]any{
			"national_id": nc, "student_code": studentCode,
			"full_name":    strings.TrimSpace(deref(firstName) + " " + deref(lastName)),
			"request_code": requestCode,
		})
		token := ""
		if s.Settings != nil {
			token, _ = s.Settings.Get(ctx, "IRANDOC_TOKEN")
		}
		raw, err := safeJSONPost(ctx, base+"/degree-verification", payload,
			map[string]string{"Authorization": "Bearer " + token})
		if err == nil {
			var j struct {
				VerificationCode string `json:"verificationCode"`
				Code             string `json:"code"`
			}
			if json.Unmarshal(raw, &j) == nil {
				code = strings.TrimSpace(j.VerificationCode)
				if code == "" {
					code = strings.TrimSpace(j.Code)
				}
				online = code != ""
			}
		}
	}
	if code == "" {
		code = "LOCAL-" + strings.ToUpper(randHex(8))
	}
	_, _ = s.Pool.Exec(ctx, `
		update graduation_audits set note = $2, "sajjadStatus" = 'CONFIRMED',
		       "sajjadConfirmedAt" = now(), "lastEventAt" = now() where id = $1`,
		auditID, "کد صحت: "+code)
	return &MinistryCodeResult{Code: code, Online: online}, nil
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ─────────────────── تمبر و صدور ───────────────────

// SettleStampFee ثبت پرداخت هزینهٔ تمبر توسط واحد مالی (اتمیک + ممیزی).
func (s *Service) SettleStampFee(ctx context.Context, auditID, actorUserID int64) (int64, float64, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx)
	var studentID int64
	var termID, universityID *int64
	var feeText string
	var paid int
	if err := tx.QueryRow(ctx, `
		select "studentId", "graduationTermId", "universityId", coalesce("stampFeeAmount",0)::text,
		       coalesce("stampFeePaid",0)
		  from graduation_audits where id = $1 for update`, auditID).
		Scan(&studentID, &termID, &universityID, &feeText, &paid); err != nil {
		return 0, 0, errors.New("پرونده یافت نشد.")
	}
	if paid != 0 {
		return 0, 0, errors.New("این هزینه پیش‌تر تسویه شده است.")
	}
	fee := money.SafeRials(feeText)
	if fee == nil || *fee <= 0 {
		return 0, 0, errors.New("مبلغ هزینهٔ تمبر نامعتبر یا صفر است.")
	}
	var ledgerID int64
	if err := tx.QueryRow(ctx, `
		insert into student_ledger ("studentId","termId","transactionType",amount,description,"universityId")
		values ($1,$2,'PAYMENT',$3,$4,$5) returning id`,
		studentID, termID, fmt.Sprintf("%d", *fee),
		"پرداخت هزینهٔ تمبر ابطال دانشنامه (تأیید واحد مالی)", universityID).Scan(&ledgerID); err != nil {
		return 0, 0, err
	}
	tag, err := tx.Exec(ctx, `
		update graduation_audits set "stampFeePaid" = 1, "lastEventAt" = now()
		 where id = $1 and coalesce("stampFeePaid",0) = 0`, auditID)
	if err != nil {
		return 0, 0, err
	}
	if tag.RowsAffected() != 1 {
		return 0, 0, errors.New("وضعیت پرونده در همین لحظه تغییر کرد؛ دوباره تلاش کنید.")
	}
	details := fmt.Sprintf(`{"studentId":%d,"ledgerTxnId":%d,"amount":%d}`, studentID, ledgerID, *fee)
	if err := writeAuditTx(ctx, tx, &actorUserID, "GRADUATION_STAMP_FEE_SETTLED", "graduation_audits", auditID, details); err != nil {
		return 0, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return ledgerID, float64(*fee), nil
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return strings.Repeat("0", n*2)
	}
	return hex.EncodeToString(b)
}

// DegreeIssued نتیجهٔ صدور.
type DegreeIssued struct {
	SerialNo   string `json:"serialNo"`
	VerifyCode string `json:"verifyCode"`
}

// IssueDegree پورت issueDegree.
func (s *Service) IssueDegree(ctx context.Context, auditID int64, degreeType string, userID int64, ministryCode *string) (*DegreeIssued, error) {
	switch degreeType {
	case "TEMPORARY", "PERMANENT", "TRANSCRIPT":
	default:
		return nil, errors.New("نوع مدرک نامعتبر است.")
	}
	var studentID int64
	var status string
	var gpa *float64
	var passedUnits float64
	if err := s.Pool.QueryRow(ctx, `
		select "studentId", "workflowStatus", gpa::float8, coalesce("passedUnits",0)::float8
		  from graduation_audits where id = $1`, auditID).
		Scan(&studentID, &status, &gpa, &passedUnits); err != nil {
		return nil, errors.New("پرونده یافت نشد.")
	}
	if degreeType != "TRANSCRIPT" && status != "READY_TO_ISSUE" && status != "ISSUED" {
		return nil, errors.New("پرونده هنوز آمادهٔ صدور نیست؛ مراحل تسویه و مدارک پایانی باید کامل شود.")
	}
	if degreeType == "PERMANENT" && (ministryCode == nil || strings.TrimSpace(*ministryCode) == "") {
		var existing *string
		_ = s.Pool.QueryRow(ctx, `
			select "ministryVerificationCode" from issued_degrees
			 where "studentId" = $1 and "ministryVerificationCode" is not null
			 order by id desc limit 1`, studentID).Scan(&existing)
		if existing == nil || strings.TrimSpace(*existing) == "" {
			return nil, errors.New("برای دانشنامه، ابتدا «کد صحت» وزارت علوم (سجاد) باید دریافت شود.")
		}
		ministryCode = existing
	}

	var studentCode string
	var entryYear int
	var firstName, lastName, nationalCode *string
	var majorName, degreeTitle *string
	if err := s.Pool.QueryRow(ctx, `
		select st."studentCode", st."entryYear", u."firstName", u."lastName", u."nationalCode", m.name, d.title
		  from students st join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		  left join degree_level_configs d on d.id = st."degreeLevelId"
		 where st.id = $1`, studentID).
		Scan(&studentCode, &entryYear, &firstName, &lastName, &nationalCode, &majorName, &degreeTitle); err != nil {
		return nil, errors.New("دانشجو یافت نشد.")
	}

	prefix := "AF"
	if s.Settings != nil {
		if v, err := s.Settings.Get(ctx, "GRAD_SERIAL_PREFIX"); err == nil && strings.TrimSpace(v) != "" {
			prefix = strings.TrimSpace(v)
		}
	}
	year := time.Now().Year()
	serialNo := ""
	for i := 0; i < 5; i++ {
		cand := fmt.Sprintf("%s-%c%d-%s", prefix, degreeType[0], year, strings.ToUpper(randHex(4)))
		var exists int
		if err := s.Pool.QueryRow(ctx, `select 1 from issued_degrees where "serialNo" = $1 limit 1`, cand).Scan(&exists); err != nil {
			serialNo = cand
			break
		}
	}
	if serialNo == "" {
		serialNo = fmt.Sprintf("%s-%c%d-%s", prefix, degreeType[0], year, strings.ToUpper(randHex(6)))
	}
	verifyCode := ""
	for i := 0; i < 5; i++ {
		cand := strings.ToUpper(randHex(16))
		var exists int
		if err := s.Pool.QueryRow(ctx, `select 1 from issued_degrees where "verifyCode" = $1 limit 1`, cand).Scan(&exists); err != nil {
			verifyCode = cand
			break
		}
	}
	if verifyCode == "" {
		verifyCode = strings.ToUpper(randHex(16))
	}

	nc := ""
	if nationalCode != nil {
		nc = maskNational(*nationalCode)
	}
	snapshot := map[string]any{
		"fullName":           strings.TrimSpace(deref(firstName) + " " + deref(lastName)),
		"nationalCodeMasked": nc,
		"studentCode":        studentCode,
		"major":              majorName,
		"degree":             degreeTitle,
		"gpa":                gpa,
		"passedUnits":        passedUnits,
		"entryYear":          entryYear,
		"issuedAtIso":        time.Now().UTC().Format(time.RFC3339Nano),
		"degreeType":         degreeType,
	}
	ministryVal := ""
	if ministryCode != nil {
		ministryVal = *ministryCode
	}
	documentHash := degreeHash(serialNo, verifyCode, snapshot, ministryVal)

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		insert into issued_degrees ("studentId","degreeType","serialNo","verifyCode",
		  "ministryVerificationCode","documentHash",snapshot,"issuedByUserId")
		values ($1,$2,$3,$4,$5,$6,$7,$8)`,
		studentID, degreeType, serialNo, verifyCode, ministryCode, documentHash,
		mustJSON(snapshot), userID); err != nil {
		return nil, err
	}
	var studentUserID int64
	if degreeType != "TRANSCRIPT" {
		if _, err := tx.Exec(ctx, `
			update graduation_audits set "workflowStatus" = 'ISSUED', "completedAt" = now(), "lastEventAt" = now()
			 where id = $1`, auditID); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `update students set status = 'GRADUATED' where id = $1`, studentID); err != nil {
			return nil, err
		}
		_, _ = tx.Exec(ctx, `insert into alumni_profiles ("studentId") values ($1) on conflict ("studentId") do nothing`, studentID)
		_ = tx.QueryRow(ctx, `select "userId" from students where id = $1`, studentID).Scan(&studentUserID)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	if degreeType != "TRANSCRIPT" && studentUserID > 0 {
		label := "گواهینامهٔ موقت"
		if degreeType == "PERMANENT" {
			label = "دانشنامهٔ"
		}
		s.notifyUser(ctx, studentUserID, "DEGREE_ISSUED",
			fmt.Sprintf("%s شما با شمارهٔ %s صادر شد. از «پورتال دانش‌آموختگان» قابل مشاهده و استعلام است.", label, serialNo))
	}
	return &DegreeIssued{SerialNo: serialNo, VerifyCode: verifyCode}, nil
}

// MarkDelivered ثبت تحویل مدرک.
func (s *Service) MarkDelivered(ctx context.Context, degreeID int64, deliveredTo string) error {
	if strings.TrimSpace(deliveredTo) == "" {
		deliveredTo = "شخص دانش‌آموخته"
	}
	tag, err := s.Pool.Exec(ctx, `
		update issued_degrees set "isDelivered" = 1, "deliveredAt" = now(), "deliveredTo" = $2 where id = $1`,
		degreeID, deliveredTo)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("مدرک یافت نشد.")
	}
	return nil
}

func maskNational(v string) string {
	s := strings.TrimSpace(v)
	if len(s) == 10 {
		return s[:3] + "****" + s[7:]
	}
	return s
}

func mustJSON(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

// canonicalOf پرتوی canonical: کلیدهای مرتب، بدون فاصله، بدون escape HTML و با
// json.Number تا اعداد اعشاری دقیقاً مثل سند بازخوانی شوند.
func canonicalOf(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return "null"
	}
	var parsed any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&parsed); err != nil {
		return "null"
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(parsed); err != nil {
		return "null"
	}
	return strings.TrimRight(buf.String(), "\n")
}

func degreeHash(serialNo, verifyCode string, snapshot map[string]any, ministryCode string) string {
	h := sha256.Sum256([]byte(serialNo + "|" + verifyCode + "|" + canonicalOf(snapshot) + "|" + ministryCode))
	return hex.EncodeToString(h[:])
}

// writeAuditTx درج حسابرسی زنجیره‌هش (همان قرارداد جدول audit_logs).
func writeAuditTx(ctx context.Context, tx pgx.Tx, actorUserID *int64, action, entityType string, entityID int64, details string) error {
	var prev string
	if err := tx.QueryRow(ctx, `select coalesce(hash,'') from audit_logs order by id desc limit 1 for update`).Scan(&prev); err != nil && err != pgx.ErrNoRows {
		prev = ""
	}
	h := sha256.Sum256([]byte(prev + "|" + action + "|" + entityType + "|" + fmt.Sprintf("%d", entityID) + "|" + details))
	_, err := tx.Exec(ctx, `
		insert into audit_logs ("actorUserId", action, "entityType", "entityId", details, "prevHash", hash)
		values ($1,$2,$3,$4,$5,$6,$7)`,
		actorUserID, action, entityType, entityID, details, prev, hex.EncodeToString(h[:]))
	return err
}

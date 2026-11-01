// ═══ Supplementary public/session page endpoints — port of the remaining Next pages ═══
//
// Coverage:
//   - public verification of a sealed document with content signature (verify/document/[hash])
//   - alumni portal — STUDENT session with a GRADUATED record
//   - exam proctor panel (proctor) — PROCTOR/ADMIN/EDU_EXPERT session
//   - professor check-in via classroom door QR scan (p/[code]) + controller worklist
//
// All responses are {"ok":true,"data":...} or {"ok":false,"error":"Persian"}.
// Public verification pages are sessionless and kept fail-closed with rate limiting.
package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/jalali"
	"backend-go/internal/ratelimit"
	"backend-go/internal/session"
	"backend-go/internal/settings"
	"backend-go/internal/verification"
)

// PublicExtraAPI supplementary endpoints — standalone struct so it doesn't mix with PublicAPI/AdminAPI.
type PublicExtraAPI struct {
	Pool     *pgxpool.Pool
	Store    *session.Store
	Settings *settings.Store
	Limiter  *ratelimit.Limiter
	Signer   *verification.Signer
}

// Register binds the routes on the router.
func (a *PublicExtraAPI) Register(r gin.IRouter) {
	// Public (sessionless)
	r.GET("/public/document/:hash", a.extraVerifyDocument)
	r.GET("/public/room/:code", a.extraRoomPublic)

	// Alumni portal (session)
	r.GET("/alumni/summary", a.extraAlumniSummary)
	r.POST("/alumni/profile", a.extraAlumniSaveProfile)
	r.POST("/alumni/requests", a.extraAlumniSubmitRequest)
	r.POST("/alumni/requests/:id/pay", a.extraAlumniPayRequest)

	// Exam proctor panel (session)
	r.GET("/proctor/sessions", a.extraProctorSessions)
	r.POST("/proctor/clock-in", a.extraProctorClockIn)
	r.POST("/proctor/verify", a.extraProctorVerify)
	r.POST("/proctor/scan", a.extraProctorScan)

	// Check-in via classroom door QR (session)
	r.GET("/room-checkin/:code", a.extraRoomCheckinState)
	r.POST("/room-checkin/:code/record", a.extraRoomCheckinRecord)
}

// ─────────────────────────── Shared helpers ───────────────────────────

func (a *PublicExtraAPI) extraAllow(c *gin.Context, key string, limit, windowSec int) bool {
	if a.Limiter == nil {
		return true
	}
	ok, _, err := a.Limiter.Allow(c.Request.Context(), key, limit, windowSec)
	if err != nil {
		return true
	}
	if !ok {
		c.JSON(http.StatusTooManyRequests, gin.H{"ok": false, "error": "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد تلاش کنید."})
	}
	return ok
}

func (a *PublicExtraAPI) extraUser(c *gin.Context) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" || a.Store == nil {
		return nil
	}
	user, _ := a.Store.Get(c.Request.Context(), token, false)
	return user
}

func (a *PublicExtraAPI) extraRequireRoles(c *gin.Context, roles []string) *session.User {
	user := a.extraUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	for _, r := range user.Roles {
		for _, want := range roles {
			if r == want {
				return user
			}
		}
	}
	c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی غیرمجاز"})
	return nil
}

func (a *PublicExtraAPI) extraSetting(ctx context.Context, key, fallback string) string {
	if a.Settings == nil {
		return fallback
	}
	v, err := a.Settings.Get(ctx, key)
	if err != nil || strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}

func (a *PublicExtraAPI) extraSettingNumber(ctx context.Context, key string, fallback float64) float64 {
	if a.Settings == nil {
		return fallback
	}
	return a.Settings.GetNumber(ctx, key, fallback)
}

// extraAudit — same audit chain (auditChain): chained hash over the previous row.
func (a *PublicExtraAPI) extraAudit(ctx context.Context, tx pgx.Tx, actorUserID int64, action, entityType string, entityID int64, details map[string]any, ip string) {
	var prev string
	_ = tx.QueryRow(ctx, `select coalesce(hash,'') from audit_logs order by id desc limit 1`).Scan(&prev)
	nowISO := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	hashSrc := prev + "|" + action + "|" + strconv.FormatInt(entityID, 10) + "|" + nowISO
	sum := sha256.Sum256([]byte(hashSrc))
	detailsJSON, _ := json.Marshal(details)
	_, _ = tx.Exec(ctx, `
		insert into audit_logs ("actorUserId", action, "entityType", "entityId", details, "prevHash", hash, "ipAddress")
		values (nullif($1,0)::integer, $2, $3, nullif($4,0)::integer, $5, $6, $7, nullif($8,''))`,
		actorUserID, action, entityType, entityID, string(detailsJSON), prev, hex.EncodeToString(sum[:]), ip)
}

func extraClientIP(c *gin.Context) string {
	fwd := strings.TrimSpace(strings.Split(c.GetHeader("x-forwarded-for"), ",")[0])
	if fwd == "" {
		fwd = strings.TrimSpace(c.GetHeader("x-real-ip"))
	}
	if len(fwd) > 50 {
		fwd = fwd[:50]
	}
	return fwd
}

// tehranNowExtra — "now" in Tehran time (fixed +3:30; Iran has had no daylight saving since 1401).
// Output: Jalali date 'YYYY/MM/DD' (same class_sessions.sessionDate format) and minute of day.
func tehranNowExtra(now time.Time) (string, int) {
	tehran := now.UTC().Add(3*time.Hour + 30*time.Minute)
	j := jalali.ToJalaliFromTime(tehran)
	return fmt.Sprintf("%d/%02d/%02d", j.Y, j.M, j.D), tehran.Hour()*60 + tehran.Minute()
}

var extraHmRe = regexp.MustCompile(`^(\d{1,2}):(\d{2})$`)
var extraHmPrefixRe = regexp.MustCompile(`^(\d{1,2}):(\d{2})`)
var extraJalaliRe = regexp.MustCompile(`^(\d{4})/(\d{2})/(\d{2})$`)
var extraRoomCodeRe = regexp.MustCompile(`^room-(\d{1,9})$`)

const (
	extraCheckinOpenMinBefore = 30
	extraCheckinOpenMinAfter  = 20
)

func extraHMToMinutes(v string) int {
	m := extraHmRe.FindStringSubmatch(strings.TrimSpace(v))
	if m == nil {
		return -1
	}
	h, _ := strconv.Atoi(m[1])
	mi, _ := strconv.Atoi(m[2])
	if h < 0 || h > 23 || mi < 0 || mi > 59 {
		return -1
	}
	return h*60 + mi
}

func extraMinutesToHm(total int) string {
	t := ((total % 1440) + 1440) % 1440
	return fmt.Sprintf("%02d:%02d", t/60, t%60)
}

func extraHM5(v string) string { return strings.TrimSpace(v)[:min2(len(strings.TrimSpace(v)), 5)] }

func min2(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// extraCheckinState — port of checkinState; a valid session without a time is "closed" (fail-closed).
func extraCheckinState(startTime, endTime string, nowMinutes int) string {
	start := extraHMToMinutes(startTime)
	end := extraHMToMinutes(endTime)
	if start < 0 || end < 0 {
		return "CLOSED"
	}
	if nowMinutes < start-extraCheckinOpenMinBefore {
		return "BEFORE"
	}
	if nowMinutes > end+extraCheckinOpenMinAfter {
		return "CLOSED"
	}
	return "OPEN"
}

// extraIranDow — Iranian weekday from the Jalali date (Saturday=0 … Friday=6).
func extraIranDow(jalaliDate string) int {
	m := extraJalaliRe.FindStringSubmatch(strings.TrimSpace(jalaliDate))
	if m == nil {
		return -1
	}
	jy, _ := strconv.Atoi(m[1])
	jm, _ := strconv.Atoi(m[2])
	jd, _ := strconv.Atoi(m[3])
	if jm < 1 || jm > 12 || jd < 1 || jd > 31 {
		return -1
	}
	g := jalali.ToGregorian(jy, jm, jd)
	// getUTCDay: Sunday=0 … Saturday=6 → shift so Saturday=0
	jsDay := int(time.Date(g.Y, time.Month(g.M), g.D, 0, 0, 0, 0, time.UTC).Weekday())
	return (jsDay + 1) % 7
}

// ───────────────── 1) Public verification of a sealed document (official form QR) ─────────────────

type extraDocumentInfo struct {
	ID                 int64  `json:"id"`
	TypeTitle          string `json:"typeTitle"`
	FileName           string `json:"fileName"`
	ContentHash        string `json:"contentHash"`
	VerificationStatus string `json:"verificationStatus"`
	UploadedAtShamsi   string `json:"uploadedAtShamsi"`
	OwnerName          string `json:"ownerName"`
	StudentCode        string `json:"studentCode"`
}

// extraVerifyDocument — port of verify/document/[hash]/page.tsx; public and sessionless.
func (a *PublicExtraAPI) extraVerifyDocument(c *gin.Context) {
	if !a.extraAllow(c, "verify-document:"+c.ClientIP(), 20, 600) {
		return
	}
	hash := strings.TrimSpace(c.Param("hash"))
	if hash == "" || len(hash) > 64 {
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"found": false}})
		return
	}
	var info extraDocumentInfo
	var uploadedAt *time.Time
	var typeTitle, fileName, verifStatus, first, last *string
	var studentCode *int64
	err := a.Pool.QueryRow(c.Request.Context(), `
		select sd.id, dt.title, sd."fileName", coalesce(sd."contentHash",''), coalesce(sd."verificationStatus",''),
		       sd."uploadedAt", u."firstName", u."lastName", st."studentCode"
		  from student_documents sd
		  left join document_types dt on dt.id = sd."typeId"
		  left join users u on u.id = sd."personUserId"
		  left join students st on st."userId" = sd."personUserId"
		 where sd."contentHash" = $1
		 order by sd.id desc limit 1`, hash).
		Scan(&info.ID, &typeTitle, &fileName, &info.ContentHash, &verifStatus, &uploadedAt, &first, &last, &studentCode)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"found": false, "error": "خطا در استعلام."}})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"found": false}})
		return
	}
	info.TypeTitle = extraStr(typeTitle)
	info.FileName = extraStr(fileName)
	info.VerificationStatus = extraStr(verifStatus)
	info.OwnerName = strings.TrimSpace(extraStr(first) + " " + extraStr(last))
	if studentCode != nil {
		info.StudentCode = strconv.FormatInt(*studentCode, 10)
	}
	if uploadedAt != nil {
		info.UploadedAtShamsi = jalali.ToShamsi(uploadedAt.Format(time.RFC3339))
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"found": true, "doc": info}})
}

func extraStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ───────────────── 2) Alumni portal ─────────────────

type extraAlumniService struct {
	Code             string  `json:"code"`
	Title            string  `json:"title"`
	Hint             string  `json:"hint"`
	NeedsDestination bool    `json:"needsDestination"`
	Fee              float64 `json:"fee"`
	FeeKey           string  `json:"-"`
}

// Same ALUMNI_SERVICES as in src/lib/alumni.ts
var extraAlumniServices = []extraAlumniService{
	{Code: "OFFICIAL_TRANSCRIPT", Title: "ریزنمرات رسمی (مهر و موم‌شده)", Hint: "صدور ریزنمرات رسمی جهت ارائه به دانشگاه/سازمان", FeeKey: "ALUMNI_FEE_TRANSCRIPT"},
	{Code: "TRANSLATION_CONFIRM", Title: "تأییدیهٔ تحصیلی برای دارالترجمه", Hint: "نام دارالترجمه یا سازمان مقصد را بنویسید", NeedsDestination: true, FeeKey: "ALUMNI_FEE_TRANSLATION"},
	{Code: "DEGREE_RELEASE", Title: "آزادسازی مدرک (خرید تعهد خدمت)", Hint: "پس از تسویهٔ تعهد خدمت، دانشنامه آزاد می‌شود", FeeKey: "ALUMNI_FEE_RELEASE"},
	{Code: "DUPLICATE_DEGREE", Title: "صدور المثنی مدرک", Hint: "در صورت مفقودی؛ نیازمند بررسی اداره آموزش", FeeKey: "ALUMNI_FEE_DUPLICATE"},
}

type extraAlumniMe struct {
	StudentID    int64   `json:"-"`
	FullName     string  `json:"fullName"`
	StudentCode  int64   `json:"studentCode"`
	MajorName    *string `json:"majorName"`
	DegreeTitle  *string `json:"degreeTitle"`
	EntryYear    *int    `json:"entryYear"`
	Status       string  `json:"-"`
	UserID       int64   `json:"-"`
	UniversityID *int64  `json:"-"`
}

// extraAlumniOf — port of alumniOf: GRADUATED record first, then the newest.
func (a *PublicExtraAPI) extraAlumniOf(ctx context.Context, userID int64) *extraAlumniMe {
	var m extraAlumniMe
	var status string
	var firstName, lastName *string
	err := a.Pool.QueryRow(ctx, `
		select st.id, st.status, st."studentCode", st."entryYear", st."userId", st."universityId",
		       u."firstName", u."lastName", mj.name, dlc.title
		  from students st
		  join users u on u.id = st."userId"
		  left join majors mj on mj.id = st."majorId"
		  left join degree_level_configs dlc on dlc.id = st."degreeLevelId"
		 where st."userId" = $1
		 order by case when st.status = 'GRADUATED' THEN 0 ELSE 1 END, st.id desc
		 limit 1`, userID).
		Scan(&m.StudentID, &status, &m.StudentCode, &m.EntryYear, &m.UserID, &m.UniversityID,
			&firstName, &lastName, &m.MajorName, &m.DegreeTitle)
	if err != nil || status != "GRADUATED" {
		return nil
	}
	m.Status = status
	m.FullName = strings.TrimSpace(extraStr(firstName) + " " + extraStr(lastName))
	return &m
}

type extraAlumniRequest struct {
	ID            int64   `json:"id"`
	RequestType   string  `json:"requestType"`
	TrackingCode  string  `json:"trackingCode"`
	Status        string  `json:"status"`
	Fee           float64 `json:"fee"`
	Destination   *string `json:"destination"`
	Description   *string `json:"description"`
	ResultFileURL *string `json:"resultFileUrl"`
	AdminNote     *string `json:"adminNote"`
	CreatedAt     *string `json:"createdAt"`
	PaidAt        *string `json:"paidAt"`
}

func (a *PublicExtraAPI) extraAlumniRequests(ctx context.Context, studentID int64) []extraAlumniRequest {
	rows, err := a.Pool.Query(ctx, `
		select id, "requestType", "trackingCode", status, fee::float8, destination, description,
		       "resultFileUrl", "adminNote", "createdAt"::text, "paidAt"::text
		  from alumni_requests where "studentId" = $1 order by id desc`, studentID)
	out := []extraAlumniRequest{}
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r extraAlumniRequest
		var fee *float64
		var createdAt, paidAt *string
		if err := rows.Scan(&r.ID, &r.RequestType, &r.TrackingCode, &r.Status, &fee, &r.Destination, &r.Description,
			&r.ResultFileURL, &r.AdminNote, &createdAt, &paidAt); err != nil {
			continue
		}
		if fee != nil {
			r.Fee = *fee
		}
		r.CreatedAt = extraIsoPtr(createdAt)
		r.PaidAt = extraIsoPtr(paidAt)
		out = append(out, r)
	}
	return out
}

// extraIsoPtr — converts timestamp::text to a full ISO string (compatible with new Date()).
func extraIsoPtr(ts *string) *string {
	if ts == nil {
		return nil
	}
	if t, err := time.Parse("2006-01-02 15:04:05.999999-07", *ts); err == nil {
		iso := t.UTC().Format(time.RFC3339)
		return &iso
	}
	if t, err := time.Parse("2006-01-02 15:04:05.999999", *ts); err == nil {
		iso := t.UTC().Format(time.RFC3339)
		return &iso
	}
	return ts
}

// extraAlumniSummary — a single view of all portal data (port of the parallel-loaded Next page).
func (a *PublicExtraAPI) extraAlumniSummary(c *gin.Context) {
	user := a.extraRequireRoles(c, []string{"STUDENT"})
	if user == nil {
		return
	}
	me := a.extraAlumniOf(c.Request.Context(), user.ID)
	if me == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"me": nil}})
		return
	}
	ctx := c.Request.Context()
	services := make([]extraAlumniService, 0, len(extraAlumniServices))
	for _, s := range extraAlumniServices {
		s.Fee = a.extraSettingNumber(ctx, s.FeeKey, 0)
		services = append(services, s)
	}

	degrees := []gin.H{}
	drows, err := a.Pool.Query(ctx, `
		select id, "degreeType", "serialNo", "verifyCode", "ministryVerificationCode",
		       coalesce("isDelivered",0), "issuedAt"
		  from issued_degrees where "studentId" = $1 order by id desc`, me.StudentID)
	if err == nil {
		defer drows.Close()
		for drows.Next() {
			var id int64
			var degreeType, serialNo, verifyCode string
			var ministryCode *string
			var isDelivered int
			var issuedAt time.Time
			if drows.Scan(&id, &degreeType, &serialNo, &verifyCode, &ministryCode, &isDelivered, &issuedAt) == nil {
				degrees = append(degrees, gin.H{
					"id": id, "degreeType": degreeType, "serialNo": serialNo, "verifyCode": verifyCode,
					"ministryVerificationCode": ministryCode, "isDelivered": isDelivered == 1,
					"issuedAt": issuedAt.UTC().Format(time.RFC3339),
				})
			}
		}
	}

	// Profile (upsert-less read)
	profile := gin.H{"employmentStatus": "", "organization": "", "jobTitle": "",
		"contactEmail": "", "contactMobile": "", "linkedinUrl": "", "allowContact": true}
	var emp, org, job, email, mobile, linkedin *string
	var allowContact *int
	err = a.Pool.QueryRow(ctx, `
		select "employmentStatus", organization, "jobTitle", "contactEmail", "contactMobile", "linkedinUrl", "allowContact"
		  from alumni_profiles where "studentId" = $1 limit 1`, me.StudentID).
		Scan(&emp, &org, &job, &email, &mobile, &linkedin, &allowContact)
	if err == nil {
		profile = gin.H{
			"employmentStatus": extraStr(emp), "organization": extraStr(org), "jobTitle": extraStr(job),
			"contactEmail": extraStr(email), "contactMobile": extraStr(mobile), "linkedinUrl": extraStr(linkedin),
			"allowContact": allowContact == nil || *allowContact != 0,
		}
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"me":       me,
		"services": services,
		"degrees":  degrees,
		"requests": a.extraAlumniRequests(ctx, me.StudentID),
		"profile":  profile,
	}})
}

// extraAlumniSaveProfile — port of saveProfileAction/upsert.
func (a *PublicExtraAPI) extraAlumniSaveProfile(c *gin.Context) {
	user := a.extraRequireRoles(c, []string{"STUDENT"})
	if user == nil {
		return
	}
	me := a.extraAlumniOf(c.Request.Context(), user.ID)
	if me == nil {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "این بخش ویژهٔ دانش‌آموختگان است."})
		return
	}
	var in struct {
		EmploymentStatus string `json:"employmentStatus"`
		Organization     string `json:"organization"`
		JobTitle         string `json:"jobTitle"`
		ContactEmail     string `json:"contactEmail"`
		ContactMobile    string `json:"contactMobile"`
		LinkedinURL      string `json:"linkedinUrl"`
		AllowContact     *bool  `json:"allowContact"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	allow := 1
	if in.AllowContact != nil && !*in.AllowContact {
		allow = 0
	}
	_, err := a.Pool.Exec(c.Request.Context(), `
		insert into alumni_profiles ("studentId", "employmentStatus", organization, "jobTitle",
		                            "contactEmail", "contactMobile", "linkedinUrl", "allowContact", "updatedAt")
		values ($1, nullif($2,''), nullif($3,''), nullif($4,''), nullif($5,''), nullif($6,''), nullif($7,''), $8, now())
		on conflict ("studentId") do update set
			"employmentStatus" = excluded."employmentStatus", organization = excluded.organization,
			"jobTitle" = excluded."jobTitle", "contactEmail" = excluded."contactEmail",
			"contactMobile" = excluded."contactMobile", "linkedinUrl" = excluded."linkedinUrl",
			"allowContact" = excluded."allowContact", "updatedAt" = now()`,
		me.StudentID, in.EmploymentStatus, in.Organization, in.JobTitle,
		in.ContactEmail, in.ContactMobile, in.LinkedinURL, allow)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ذخیرهٔ اطلاعات ناموفق بود."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// extraAlumniSubmitRequest — port of submitRequestAction (no payment on the student side).
func (a *PublicExtraAPI) extraAlumniSubmitRequest(c *gin.Context) {
	user := a.extraRequireRoles(c, []string{"STUDENT"})
	if user == nil {
		return
	}
	me := a.extraAlumniOf(c.Request.Context(), user.ID)
	if me == nil {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "این بخش ویژهٔ دانش‌آموختگان است."})
		return
	}
	var in struct {
		RequestType string `json:"requestType"`
		Destination string `json:"destination"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	var svc *extraAlumniService
	for i := range extraAlumniServices {
		if extraAlumniServices[i].Code == in.RequestType {
			svc = &extraAlumniServices[i]
			break
		}
	}
	if svc == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "نوع خدمت نامعتبر است."})
		return
	}
	dest := strings.TrimSpace(in.Destination)
	if svc.NeedsDestination && dest == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "مقصد (دارالترجمه/سازمان) الزامی است."})
		return
	}
	fee := a.extraSettingNumber(c.Request.Context(), svc.FeeKey, 0)
	status := "IN_REVIEW"
	if fee > 0 {
		status = "AWAITING_PAYMENT"
	}
	// Tracking code 'AL-' + 8 hex nibbles (same tracking as in TS)
	rnd := make([]byte, 4)
	_, _ = rand.Read(rnd)
	tracking := "AL-" + strings.ToUpper(hex.EncodeToString(rnd))
	var universityID *int64
	_ = a.Pool.QueryRow(c.Request.Context(), `select "universityId" from students where id = $1`, me.StudentID).Scan(&universityID)
	_, err := a.Pool.Exec(c.Request.Context(), `
		insert into alumni_requests ("studentId", "requestType", "trackingCode", status, fee, destination, description, "universityId")
		values ($1, $2, $3, $4, $5, nullif($6,''), nullif($7,''), $8)`,
		me.StudentID, svc.Code, tracking, status, strconv.FormatFloat(fee, 'f', 0, 64), dest, strings.TrimSpace(in.Description), universityID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ثبت درخواست ناموفق بود."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"requests": a.extraAlumniRequests(c.Request.Context(), me.StudentID)}})
}

// extraAlumniPayRequest — ⛔ port of payRequest: settlement only with finance unit approval; fail-closed.
func (a *PublicExtraAPI) extraAlumniPayRequest(c *gin.Context) {
	user := a.extraRequireRoles(c, []string{"STUDENT"})
	if user == nil {
		return
	}
	me := a.extraAlumniOf(c.Request.Context(), user.ID)
	if me == nil {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "این بخش ویژهٔ دانش‌آموختگان است."})
		return
	}
	reqID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || reqID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ درخواست نامعتبر است."})
		return
	}
	var status string
	err = a.Pool.QueryRow(c.Request.Context(),
		`select status from alumni_requests where id = $1 and "studentId" = $2 limit 1`, reqID, me.StudentID).Scan(&status)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "درخواست یافت نشد."})
		return
	}
	if status != "AWAITING_PAYMENT" {
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"already": true, "requests": a.extraAlumniRequests(c.Request.Context(), me.StudentID)}})
		return
	}
	c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "پرداخت هزینه باید از طریق واحد مالی انجام و تأیید شود."})
}

// ───────────────── 3) Exam proctor panel ─────────────────

type extraProctorRosterItem struct {
	StudentID          int64   `json:"studentId"`
	SeatNumber         int     `json:"seatNumber"`
	BlockKey           string  `json:"blockKey"`
	StudentName        string  `json:"studentName"`
	StudentCode        string  `json:"studentCode"`
	NationalCodeMasked string  `json:"nationalCodeMasked"`
	MajorTitle         string  `json:"majorTitle"`
	CourseCode         string  `json:"courseCode"`
	CourseTitle        string  `json:"courseTitle"`
	IsPresent          bool    `json:"isPresent"`
	CheckInMethod      *string `json:"checkInMethod"`
	HasTemporaryPermit bool    `json:"hasTemporaryPermit"`
	CheckInTime        *string `json:"checkInTime"`
}

type extraProctorSession struct {
	ID            int64                    `json:"id"`
	HallID        int64                    `json:"hallId"`
	HallName      string                   `json:"hallName"`
	BuildingName  string                   `json:"buildingName"`
	HallCapacity  int                      `json:"hallCapacity"`
	ExamDate      string                   `json:"examDate"`
	StartTime     string                   `json:"startTime"`
	EndTime       string                   `json:"endTime"`
	ClockInStatus string                   `json:"clockInStatus"`
	Roster        []extraProctorRosterItem `json:"roster"`
}

// extraUserUniScope — list of allowed universities; nil = unlimited (platform ADMIN account).
func (a *PublicExtraAPI) extraUserUniScope(ctx context.Context, user *session.User) []int64 {
	ids := map[int64]bool{}
	if user.UniversityID != nil {
		ids[*user.UniversityID] = true
	}
	if len(ids) == 0 && extraHasRole(user, "ADMIN") {
		return nil
	}
	if extraHasRole(user, "EDU_EXPERT") {
		rows, err := a.Pool.Query(ctx, `
			select case when "scopeType" = 'UNIVERSITY' then coalesce("scopeId", "universityId") else "universityId" end
			  from expert_scopes where "userId" = $1`, user.ID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id *int64
				if rows.Scan(&id) == nil && id != nil {
					ids[*id] = true
				}
			}
		}
	}
	if len(ids) == 0 {
		var st, sf *int64
		_ = a.Pool.QueryRow(ctx, `select "universityId" from students where "userId" = $1 limit 1`, user.ID).Scan(&st)
		_ = a.Pool.QueryRow(ctx, `select "universityId" from staff where "userId" = $1 limit 1`, user.ID).Scan(&sf)
		if st != nil {
			ids[*st] = true
		}
		if sf != nil {
			ids[*sf] = true
		}
	}
	if len(ids) == 0 {
		return []int64{}
	}
	out := make([]int64, 0, len(ids))
	for id := range ids {
		out = append(out, id)
	}
	return out
}

func (a *PublicExtraAPI) extraCanActOnUni(ctx context.Context, user *session.User, universityID *int64) bool {
	if universityID == nil {
		return false // Record without a university: unknown → reject
	}
	allowed := a.extraUserUniScope(ctx, user)
	if allowed == nil {
		return true
	}
	for _, id := range allowed {
		if id == *universityID {
			return true
		}
	}
	return false
}

func extraHasRole(user *session.User, role string) bool {
	for _, r := range user.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// extraStaffIDOf — user's faculty staff record.
func (a *PublicExtraAPI) extraStaffIDOf(ctx context.Context, userID int64) (int64, bool) {
	var id int64
	err := a.Pool.QueryRow(ctx, `select id from staff where "userId" = $1 limit 1`, userID).Scan(&id)
	return id, err == nil
}

// extraProctorSessions — port of proctor/page.tsx: assigned sessions + actual seats.
func (a *PublicExtraAPI) extraProctorSessions(c *gin.Context) {
	user := a.extraRequireRoles(c, []string{"PROCTOR", "ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	ctx := c.Request.Context()
	staffID, ok := a.extraStaffIDOf(ctx, user.ID)
	if !ok {
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"staffName": user.Name, "noStaff": true, "sessions": []gin.H{}}})
		return
	}

	type assignedRow struct {
		sessionID    int64
		examDate     string
		startTime    string
		endTime      string
		hallID       int64
		hallName     string
		buildingName string
		hallCapacity int
		attendance   *string
	}
	assigned := []assignedRow{}
	rows, err := a.Pool.Query(ctx, `
		select es.id, es."examDate", es."startTime", es."endTime", eh.id, eh.name,
		       coalesce(eh."buildingName",''), eh."totalCapacity", iv."attendanceStatus"
		  from invigilators iv
		  join exam_sessions es on es.id = iv."sessionId"
		  join exam_halls eh on eh.id = iv."hallId"
		 where iv."staffId" = $1 order by es."examDate", es."startTime"`, staffID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دریافت جلسات ناموفق بود."})
		return
	}
	for rows.Next() {
		var r assignedRow
		if rows.Scan(&r.sessionID, &r.examDate, &r.startTime, &r.endTime, &r.hallID, &r.hallName,
			&r.buildingName, &r.hallCapacity, &r.attendance) == nil {
			assigned = append(assigned, r)
		}
	}
	rows.Close()

	sessions := []extraProctorSession{}
	for _, s := range assigned {
		sess := extraProctorSession{
			ID: s.sessionID, HallID: s.hallID, HallName: s.hallName, BuildingName: s.buildingName,
			HallCapacity: s.hallCapacity, ExamDate: s.examDate, StartTime: s.startTime, EndTime: s.endTime,
			ClockInStatus: "PENDING", Roster: []extraProctorRosterItem{},
		}
		if s.attendance != nil && *s.attendance != "" {
			sess.ClockInStatus = *s.attendance
		}
		rrows, err := a.Pool.Query(ctx, `
			select st.id, st."studentCode", u."firstName", u."lastName", u."nationalCode",
			       coalesce(mj.name,'—'), co.code, coalesce(co.title,''), sa."seatNumber", coalesce(sa."blockKey",''),
			       coalesce(ea."isPresent",0), ea."checkInMethod", coalesce(ea."hasTemporaryPermit",0), ea."checkInTime"
			  from seat_allocations sa
			  join enrollments e on e.id = sa."enrollmentId"
			  join students st on st.id = e."studentId"
			  join users u on u.id = st."userId"
			  join course_offerings co2 on co2.id = e."offeringId"
			  join courses co on co.id = co2."courseId"
			  left join majors mj on mj.id = st."majorId"
			  left join exam_attendances ea on ea."examId" = $1 and ea."studentId" = st.id
			 where sa."sessionId" = $1 and sa."hallId" = $2
			 order by sa."seatNumber"`, s.sessionID, s.hallID)
		if err == nil {
			for rrows.Next() {
				var it extraProctorRosterItem
				var firstName, lastName, nationalCode *string
				var studentCode *int64
				var present, permit int
				var checkInTime *time.Time
				if rrows.Scan(&it.StudentID, &studentCode, &firstName, &lastName, &nationalCode, &it.MajorTitle,
					&it.CourseCode, &it.CourseTitle, &it.SeatNumber, &it.BlockKey, &present, &it.CheckInMethod,
					&permit, &checkInTime) == nil {
					it.StudentName = strings.TrimSpace(extraStr(firstName) + " " + extraStr(lastName))
					if studentCode != nil {
						it.StudentCode = strconv.FormatInt(*studentCode, 10)
					}
					nc := extraStr(nationalCode)
					if len([]rune(nc)) > 4 {
						r := []rune(nc)
						it.NationalCodeMasked = string(r[:3]) + "******" + string(r[len(r)-1:])
					} else {
						it.NationalCodeMasked = "—"
					}
					it.IsPresent = present == 1
					it.HasTemporaryPermit = permit == 1
					if checkInTime != nil {
						teh := checkInTime.UTC().Add(3*time.Hour + 30*time.Minute)
						hm := teh.Format("15:04")
						it.CheckInTime = &hm
					}
					sess.Roster = append(sess.Roster, it)
				}
			}
			rrows.Close()
		}
		sessions = append(sessions, sess)
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"staffName": user.Name, "sessions": sessions}})
}

// extraExamSessionTenant — session universityId (with fallback to the term) — port of assertSessionTenant.
func (a *PublicExtraAPI) extraExamSessionTenant(ctx context.Context, sessionID int64) (*int64, error) {
	var uni, termUni *int64
	var termID int64
	err := a.Pool.QueryRow(ctx, `select "universityId", "termId" from exam_sessions where id = $1`, sessionID).
		Scan(&uni, &termID)
	if err != nil {
		return nil, errors.New("جلسهٔ امتحان یافت نشد.")
	}
	_ = a.Pool.QueryRow(ctx, `select "universityId" from academic_terms where id = $1`, termID).Scan(&termUni)
	if uni != nil && termUni != nil && *uni != *termUni {
		return nil, errors.New("رد بین‌دانشگاهی: جلسهٔ امتحان متعلق به دانشگاه دیگری است.")
	}
	if uni == nil {
		return termUni, nil
	}
	return uni, nil
}

// extraProctorClockIn — port of proctorClockIn: proctor clock-in under advisory lock.
func (a *PublicExtraAPI) extraProctorClockIn(c *gin.Context) {
	user := a.extraRequireRoles(c, []string{"PROCTOR", "ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	staffID, ok := a.extraStaffIDOf(c.Request.Context(), user.ID)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "پروندهٔ پرسنلی یافت نشد."})
		return
	}
	var in struct {
		SessionID int64 `json:"sessionId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.SessionID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	ctx := c.Request.Context()
	expectedUni, err := a.extraExamSessionTenant(ctx, in.SessionID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	if !a.extraCanActOnUni(ctx, user, expectedUni) {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "این جلسه در دامنهٔ دانشگاهی شما نیست."})
		return
	}
	var assignedUni *int64
	err = a.Pool.QueryRow(ctx, `
		select "universityId" from exam_invigilators
		 where "examId" = $1 and "staffId" = $2 limit 1`, in.SessionID, staffID).Scan(&assignedUni)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شما به این جلسهٔ امتحانی تخصیص نیافته‌اید."})
		return
	}
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خطای تراکنش."})
		return
	}
	defer tx.Rollback(ctx)
	_, _ = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('exam_clockin'), $1)`, in.SessionID)
	upd, err := tx.Exec(ctx, `
		update exam_invigilators set "clockInTime" = now()
		 where "examId" = $1 and "staffId" = $2 and "clockInTime" is null`, in.SessionID, staffID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ثبت ورود ناموفق بود."})
		return
	}
	if upd.RowsAffected() > 0 {
		a.extraAudit(ctx, tx, user.ID, "EXAM_PROCTOR_CLOCKED_IN", "exam_session", in.SessionID,
			map[string]any{"staffIds": []int64{staffID}}, extraClientIP(c))
	}
	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ثبت ورود ناموفق بود."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"clockedIn": upd.RowsAffected()}})
}

type extraCheckIn struct {
	StudentID          int64  `json:"studentId"`
	IsPresent          int    `json:"isPresent"`
	Method             string `json:"method"`
	HasTemporaryPermit int    `json:"hasTemporaryPermit"`
}

var extraCheckinMethods = map[string]bool{"QR_SCAN": true, "MANUAL_BY_INVIGILATOR": true, "SYSTEM_EXCUSE": true}

// extraValidateCheckIns — port of validateCheckIns: strict whitelist before SQL.
func extraValidateCheckIns(raw []extraCheckIn) ([]extraCheckIn, error) {
	if len(raw) == 0 {
		return nil, errors.New("ردیف تأییدی برای بررسی ارسال نشده است.")
	}
	out := make([]extraCheckIn, 0, len(raw))
	for _, c := range raw {
		if c.StudentID <= 0 {
			return nil, errors.New("شناسهٔ دانشجو نامعتبر است.")
		}
		if c.IsPresent != 0 && c.IsPresent != 1 {
			return nil, errors.New("مقدار حضور و غیاب نامعتبر است.")
		}
		method := c.Method
		if method == "" {
			method = "QR_SCAN"
		}
		if !extraCheckinMethods[method] {
			return nil, errors.New("روش ثبت حضور نامعتبر است.")
		}
		if c.HasTemporaryPermit != 0 && c.HasTemporaryPermit != 1 {
			return nil, errors.New("مقدار مجوز موقت نامعتبر است.")
		}
		out = append(out, extraCheckIn{StudentID: c.StudentID, IsPresent: c.IsPresent, Method: method, HasTemporaryPermit: c.HasTemporaryPermit})
	}
	return out, nil
}

// extraProctorVerify — port of proctorVerifyAttendance: batch update under lock.
func (a *PublicExtraAPI) extraProctorVerify(c *gin.Context) {
	user := a.extraRequireRoles(c, []string{"PROCTOR", "ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	staffID, ok := a.extraStaffIDOf(c.Request.Context(), user.ID)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "پروندهٔ پرسنلی یافت نشد."})
		return
	}
	var in struct {
		SessionID int64          `json:"sessionId"`
		HallID    int64          `json:"hallId"`
		CheckIns  []extraCheckIn `json:"checkIns"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.SessionID <= 0 || in.HallID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	checkIns, err := extraValidateCheckIns(in.CheckIns)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	ctx := c.Request.Context()
	expectedUni, err := a.extraExamSessionTenant(ctx, in.SessionID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	if !a.extraCanActOnUni(ctx, user, expectedUni) {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "این جلسه در دامنهٔ دانشگاهی شما نیست."})
		return
	}
	var hallUni *int64
	if err := a.Pool.QueryRow(ctx, `select "universityId" from exam_halls where id = $1`, in.HallID).Scan(&hallUni); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "سالن یافت نشد."})
		return
	}
	if expectedUni != nil && hallUni != nil && *expectedUni != *hallUni {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "رد بین‌دانشگاهی: سالن امتحان متعلق به دانشگاه دیگری است."})
		return
	}
	var assignedUni *int64
	err = a.Pool.QueryRow(ctx, `
		select "universityId" from invigilators
		 where "sessionId" = $1 and "hallId" = $2 and "staffId" = $3 limit 1`,
		in.SessionID, in.HallID, staffID).Scan(&assignedUni)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "این مراقب به این سالن در این جلسه تخصیص نیافته است."})
		return
	}
	if expectedUni != nil && assignedUni != nil && *expectedUni != *assignedUni {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "رد بین‌دانشگاهی: مراقب تخصیص‌یافته متعلق به دانشگاه دیگری است."})
		return
	}

	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خطای تراکنش."})
		return
	}
	defer tx.Rollback(ctx)
	_, _ = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('exam_attendance'), $1)`, in.SessionID)

	// VALUES fully parameterized (same TS pattern) — no string goes directly into SQL.
	n := len(checkIns)
	var sb strings.Builder
	args := make([]any, 0, n*4)
	for i, ci := range checkIns {
		if i > 0 {
			sb.WriteString(",")
		}
		base := i * 4
		fmt.Fprintf(&sb, "($%d::int,$%d::int,$%d::text,$%d::int)", base+1, base+2, base+3, base+4)
		args = append(args, ci.StudentID, ci.IsPresent, ci.Method, ci.HasTemporaryPermit)
	}
	upd, err := tx.Exec(ctx, `
		update exam_attendances a set
			"isPresent" = v.is_present,
			"checkInMethod" = v.method,
			"hasTemporaryPermit" = v.temp,
			"verifiedByStaffId" = $`+strconv.Itoa(n*4+1)+`,
			"checkInTime" = case when v.is_present = 1 then now() else null end
		from (values `+sb.String()+`) as v("studentId", "is_present", "method", "temp")
		where a."examId" = $`+strconv.Itoa(n*4+2)+`
			and a."studentId" = v."studentId"
			and a."studentId" in (
				select e."studentId" from seat_allocations sa
				join enrollments e on e.id = sa."enrollmentId"
				where sa."sessionId" = $`+strconv.Itoa(n*4+2)+` and sa."hallId" = $`+strconv.Itoa(n*4+3)+`)`,
		append(args, any(staffID), any(in.SessionID), any(in.HallID))...)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ثبت حضور ناموفق بود."})
		return
	}
	a.extraAudit(ctx, tx, user.ID, "EXAM_ATTENDANCE_VERIFIED", "exam_hall", in.HallID, map[string]any{
		"sessionId": in.SessionID, "proctorStaffId": staffID, "count": upd.RowsAffected(),
	}, extraClientIP(c))
	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ثبت حضور ناموفق بود."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"verified": upd.RowsAffected()}})
}

// extraProctorScan — port of examProctorScanAction: exam card QR scan with system signature.
func (a *PublicExtraAPI) extraProctorScan(c *gin.Context) {
	user := a.extraRequireRoles(c, []string{"PROCTOR", "ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	staffID, ok := a.extraStaffIDOf(c.Request.Context(), user.ID)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "پروندهٔ پرسنلی یافت نشد."})
		return
	}
	var in struct {
		SessionID int64  `json:"sessionId"`
		HallID    int64  `json:"hallId"`
		Raw       string `json:"raw"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	raw := strings.TrimSpace(in.Raw)
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "چیزی اسکن نشد."})
		return
	}
	token := raw
	if m := regexp.MustCompile(`(?i)exam-ticket/([^/?#\s]+)`).FindStringSubmatch(raw); m != nil {
		token = m[1]
	}
	if a.Signer == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "بررسی کارت در دسترس نیست."})
		return
	}
	payload, valid, err := a.Signer.Verify(c.Request.Context(), token)
	if err != nil || !valid || extraStrPtr(payload["kind"]) != "EXAM" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "کارت ورود به جلسه نامعتبر است."})
		return
	}
	studentID := a.extraResolveStudent(c.Request.Context(), payload)
	if studentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشجویی با این کارت یافت نشد."})
		return
	}
	var fullName, studentCode string
	err = a.Pool.QueryRow(c.Request.Context(), `
		select coalesce(u."firstName" || ' ' || u."lastName",''), st."studentCode"::text
		  from students st join users u on u.id = st."userId" where st.id = $1`, studentID).Scan(&fullName, &studentCode)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشجویی با این کارت یافت نشد."})
		return
	}
	// Check-in of the same student in the same session/hall (proctor identity from session, not payload)
	checkIns := []extraCheckIn{{StudentID: studentID, IsPresent: 1, Method: "QR_SCAN", HasTemporaryPermit: 0}}
	ctx := c.Request.Context()
	expectedUni, err := a.extraExamSessionTenant(ctx, in.SessionID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	if !a.extraCanActOnUni(ctx, user, expectedUni) {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "این جلسه در دامنهٔ دانشگاهی شما نیست."})
		return
	}
	verified := a.extraVerifyAttendanceCore(ctx, user, staffID, in.SessionID, in.HallID, checkIns, c)
	if verified < 0 {
		return // Error response already written
	}
	if verified == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": fullName + " در این جلسه/سالن ثبت‌نام نشده است (کارت سالن دیگری است).", "studentName": fullName})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"studentId": studentID, "studentName": fullName, "studentCode": studentCode, "verified": verified,
	}})
}

func extraStrPtr(v any) string {
	s, _ := v.(string)
	return s
}

// extraResolveStudent — port of resolveStudent in publicverify: student ID from payload.
func (a *PublicExtraAPI) extraResolveStudent(ctx context.Context, payload map[string]any) int64 {
	uid := toExtraInt(payload["uid"])
	sid := toExtraInt(payload["sid"])
	if uid <= 0 {
		return 0
	}
	if sid > 0 {
		var userID int64
		err := a.Pool.QueryRow(ctx, `
			select st."userId" from students st
			 where st.id = $1 and (st."userId" = $2 or exists(
			   select 1 from users u2 where u2.id = st."userId" and u2."nationalCode" = (
			     select "nationalCode" from users where id = $2)))`, sid, uid).Scan(&userID)
		if err == nil {
			return sid
		}
	}
	var picked int64
	err := a.Pool.QueryRow(ctx, `
		select id from students where "userId" = $1
		 order by case when status = 'ACTIVE' then 0 else 1 end,
		          (select count(*) from enrollments e where e."studentId" = students.id) desc,
		          id desc
		 limit 1`, uid).Scan(&picked)
	if err != nil {
		return 0
	}
	return picked
}

func toExtraInt(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	case json.Number:
		i, _ := n.Int64()
		return i
	}
	return 0
}

// extraVerifyAttendanceCore — shared hall attendance core; -1 means the error response was already written.
func (a *PublicExtraAPI) extraVerifyAttendanceCore(ctx context.Context, user *session.User, staffID, sessionID, hallID int64, checkIns []extraCheckIn, c *gin.Context) int64 {
	var hallUni *int64
	if err := a.Pool.QueryRow(ctx, `select "universityId" from exam_halls where id = $1`, hallID).Scan(&hallUni); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "سالن یافت نشد."})
		return -1
	}
	expectedUni, err := a.extraExamSessionTenant(ctx, sessionID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return -1
	}
	if expectedUni != nil && hallUni != nil && *expectedUni != *hallUni {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "رد بین‌دانشگاهی: سالن امتحان متعلق به دانشگاه دیگری است."})
		return -1
	}
	var assignedUni *int64
	if err := a.Pool.QueryRow(ctx, `
		select "universityId" from invigilators
		 where "sessionId" = $1 and "hallId" = $2 and "staffId" = $3 limit 1`,
		sessionID, hallID, staffID).Scan(&assignedUni); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "این مراقب به این سالن در این جلسه تخصیص نیافته است."})
		return -1
	}
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خطای تراکنش."})
		return -1
	}
	defer tx.Rollback(ctx)
	_, _ = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('exam_attendance'), $1)`, sessionID)
	n := len(checkIns)
	var sb strings.Builder
	args := make([]any, 0, n*4+3)
	for i, ci := range checkIns {
		if i > 0 {
			sb.WriteString(",")
		}
		base := i * 4
		fmt.Fprintf(&sb, "($%d::int,$%d::int,$%d::text,$%d::int)", base+1, base+2, base+3, base+4)
		args = append(args, ci.StudentID, ci.IsPresent, ci.Method, ci.HasTemporaryPermit)
	}
	upd, err := tx.Exec(ctx, `
		update exam_attendances a set
			"isPresent" = v.is_present,
			"checkInMethod" = v.method,
			"hasTemporaryPermit" = v.temp,
			"verifiedByStaffId" = $`+strconv.Itoa(n*4+1)+`,
			"checkInTime" = case when v.is_present = 1 then now() else null end
		from (values `+sb.String()+`) as v("studentId", "is_present", "method", "temp")
		where a."examId" = $`+strconv.Itoa(n*4+2)+`
			and a."studentId" = v."studentId"
			and a."studentId" in (
				select e."studentId" from seat_allocations sa
				join enrollments e on e.id = sa."enrollmentId"
				where sa."sessionId" = $`+strconv.Itoa(n*4+2)+` and sa."hallId" = $`+strconv.Itoa(n*4+3)+`)`,
		append(args, any(staffID), any(sessionID), any(hallID))...)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ثبت حضور ناموفق بود."})
		return -1
	}
	a.extraAudit(ctx, tx, user.ID, "EXAM_ATTENDANCE_VERIFIED", "exam_hall", hallID, map[string]any{
		"sessionId": sessionID, "proctorStaffId": staffID, "count": upd.RowsAffected(),
	}, extraClientIP(c))
	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ثبت حضور ناموفق بود."})
		return -1
	}
	return upd.RowsAffected()
}

// ───────────────── 4) Professor check-in via classroom door QR (p/[code]) ─────────────────

type extraRoomSessionRow struct {
	ID                     int64   `json:"id"`
	OfferingID             int64   `json:"offeringId"`
	SessionDate            string  `json:"sessionDate"`
	StartTime              string  `json:"startTime"`
	EndTime                string  `json:"endTime"`
	ProfessorID            *int64  `json:"professorId"`
	CourseTitle            string  `json:"courseTitle"`
	CourseCode             string  `json:"courseCode"`
	GroupNumber            int     `json:"groupNumber"`
	RoomID                 int64   `json:"roomId"`
	SharedScheduleGroupKey *string `json:"sharedScheduleGroupKey"`
	// Temporary for the core
	explicitRoomID *int64
}

func (r extraRoomSessionRow) mergeKey() string {
	shared := strings.TrimSpace(extraStr(r.SharedScheduleGroupKey))
	if shared != "" {
		if strings.HasPrefix(shared, "SOLO-") {
			return "SOLO:" + strconv.FormatInt(r.OfferingID, 10)
		}
		return "K:" + shared
	}
	st := extraNormTime(r.StartTime)
	en := extraNormTime(r.EndTime)
	if st == "" || en == "" || r.RoomID == 0 || r.ProfessorID == nil {
		return ""
	}
	return fmt.Sprintf("A:%d|%d|%s|%s", r.RoomID, *r.ProfessorID, st, en)
}

func extraNormTime(v string) string {
	m := extraHmPrefixRe.FindStringSubmatch(strings.TrimSpace(v))
	if m == nil {
		return ""
	}
	h, _ := strconv.Atoi(m[1])
	mi, _ := strconv.Atoi(m[2])
	if h > 23 || mi > 59 {
		return ""
	}
	return fmt.Sprintf("%02d:%02d", h, mi)
}

type extraMergedGroup struct {
	Key              string
	Merged           bool
	PrimarySessionID int64
	MemberSessionIDs []int64
	Members          []extraRoomSessionRow
}

// extraGroupMerged — port of groupSessionsIntoMerged: session rows → "physical class".
func extraGroupMerged(rows []extraRoomSessionRow) []extraMergedGroup {
	groups := []extraMergedGroup{}
	byKey := map[string]*extraMergedGroup{}
	for _, row := range rows {
		k := row.mergeKey()
		if k == "" {
			groups = append(groups, extraMergedGroup{
				Key: "", Merged: false, PrimarySessionID: row.ID,
				MemberSessionIDs: []int64{row.ID}, Members: []extraRoomSessionRow{row},
			})
			continue
		}
		g, exists := byKey[k]
		if !exists {
			groups = append(groups, extraMergedGroup{})
			g = &groups[len(groups)-1]
			*g = extraMergedGroup{Key: k, Merged: false, PrimarySessionID: row.ID, MemberSessionIDs: []int64{}, Members: []extraRoomSessionRow{}}
			byKey[k] = g
		}
		g.Members = append(g.Members, row)
	}
	final := make([]extraMergedGroup, 0, len(groups))
	for _, g := range groups {
		if len(g.Members) > 1 {
			g.Merged = true
			// Sort members by sessionId
			for i := 0; i < len(g.Members); i++ {
				for j := i + 1; j < len(g.Members); j++ {
					if g.Members[j].ID < g.Members[i].ID {
						g.Members[i], g.Members[j] = g.Members[j], g.Members[i]
					}
				}
			}
		}
		g.MemberSessionIDs = []int64{}
		for _, m := range g.Members {
			g.MemberSessionIDs = append(g.MemberSessionIDs, m.ID)
		}
		if len(g.MemberSessionIDs) > 0 {
			g.PrimarySessionID = g.MemberSessionIDs[0]
		}
		final = append(final, g)
	}
	return final
}

func extraMergeMemberTitles(members []extraRoomSessionRow) string {
	seen := map[string]bool{}
	titles := []string{}
	for _, m := range members {
		t := strings.TrimSpace(m.CourseTitle)
		if t != "" && !seen[t] {
			seen[t] = true
			titles = append(titles, t)
		}
	}
	return strings.Join(titles, " · ")
}

func extraRoomCode(code string) int64 {
	m := extraRoomCodeRe.FindStringSubmatch(strings.TrimSpace(code))
	if m == nil {
		return 0
	}
	id, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil || id <= 0 {
		return 0
	}
	return id
}

type extraRoomContext struct {
	ID           int64
	Name         string
	BuildingName string
	Floor        string
	IsActive     int
	UniversityID *int64
	FacultyID    *int64
}

func (a *PublicExtraAPI) extraRoomOf(ctx context.Context, roomID int64) *extraRoomContext {
	var r extraRoomContext
	var building, floor *string
	err := a.Pool.QueryRow(ctx, `
		select id, name, "buildingName", floor, coalesce("isActive",1), "universityId", "facultyId"
		  from classrooms where id = $1`, roomID).
		Scan(&r.ID, &r.Name, &building, &floor, &r.IsActive, &r.UniversityID, &r.FacultyID)
	if err != nil {
		return nil
	}
	r.BuildingName = extraStr(building)
	r.Floor = extraStr(floor)
	return &r
}

// extraRoomSlots — weekly slots of a room on a given day; key «offeringId|HH:MM».
func (a *PublicExtraAPI) extraRoomSlots(ctx context.Context, roomID int64, dow int) (map[string]bool, []int64) {
	keys := map[string]bool{}
	ids := []int64{}
	seen := map[int64]bool{}
	rows, err := a.Pool.Query(ctx, `
		select "offeringId", "startTime"::text from schedules
		 where "roomId" = $1 and "scheduleType" = 'CLASS' and "dayOfWeek" = $2`, roomID, dow)
	if err != nil {
		return keys, ids
	}
	defer rows.Close()
	for rows.Next() {
		var offeringID int64
		var st string
		if rows.Scan(&offeringID, &st) == nil {
			keys[fmt.Sprintf("%d|%s", offeringID, extraHM5(st))] = true
			if !seen[offeringID] {
				seen[offeringID] = true
				ids = append(ids, offeringID)
			}
		}
	}
	return keys, ids
}

// extraSessionsInRoom — port of listSessionsInRoom: today's room sessions from the weekly schedule.
func (a *PublicExtraAPI) extraSessionsInRoom(ctx context.Context, roomID int64, jalaliDate string) []extraRoomSessionRow {
	out := []extraRoomSessionRow{}
	dow := extraIranDow(jalaliDate)
	if dow < 0 {
		return out
	}
	keys, offeringIDs := a.extraRoomSlots(ctx, roomID, dow)

	sqlScope := `("roomId" = $2`
	args := []any{jalaliDate, roomID}
	if len(offeringIDs) > 0 {
		args = append(args, offeringIDs)
		sqlScope += fmt.Sprintf(` or "offeringId" = any($%d)`, len(args))
	}
	sqlScope += ")"
	q := fmt.Sprintf(`
		select cs.id, cs."offeringId", cs."sessionDate", cs."startTime"::text, cs."endTime"::text, cs."roomId",
		       co."professorId", coalesce(co.title,''), coalesce(c.code,''), co."groupNumber", co."sharedScheduleGroupKey"
		  from class_sessions cs
		  join course_offerings co on co.id = cs."offeringId"
		  join courses c on c.id = co."courseId"
		 where cs."sessionDate" = $1 and coalesce(cs."isActive",1) = 1 and %s
		 order by cs."startTime" asc`, sqlScope)
	rows, err := a.Pool.Query(ctx, q, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r extraRoomSessionRow
		if rows.Scan(&r.ID, &r.OfferingID, &r.SessionDate, &r.StartTime, &r.EndTime, &r.explicitRoomID,
			&r.ProfessorID, &r.CourseTitle, &r.CourseCode, &r.GroupNumber, &r.SharedScheduleGroupKey) != nil {
			continue
		}
		ok := r.explicitRoomID != nil && *r.explicitRoomID == roomID
		if !ok && r.explicitRoomID == nil {
			ok = keys[fmt.Sprintf("%d|%s", r.OfferingID, extraHM5(r.StartTime))]
		}
		if !ok {
			continue
		}
		r.RoomID = roomID
		r.StartTime = extraHM5(r.StartTime)
		r.EndTime = extraHM5(r.EndTime)
		out = append(out, r)
	}
	return out
}

type extraWeeklySlot struct {
	ScheduleID    int64  `json:"scheduleId"`
	OfferingID    int64  `json:"offeringId"`
	DayOfWeek     int    `json:"dayOfWeek"`
	StartTime     string `json:"startTime"`
	EndTime       string `json:"endTime"`
	ProfessorID   *int64 `json:"professorId"`
	ProfessorName string `json:"professorName"`
	CourseTitle   string `json:"courseTitle"`
	CourseCode    string `json:"courseCode"`
	GroupNumber   int    `json:"groupNumber"`
}

// extraWeeklyInRoom — port of listWeeklySessionsInRoom: exactly what is printed on the door poster.
func (a *PublicExtraAPI) extraWeeklyInRoom(ctx context.Context, roomID int64, termID *int64) []extraWeeklySlot {
	out := []extraWeeklySlot{}
	q := `
		select s.id, s."offeringId", coalesce(s."dayOfWeek",0), s."startTime"::text, s."endTime"::text,
		       co."professorId", coalesce(co.title,''), coalesce(c.code,''), co."groupNumber"
		  from schedules s
		  join course_offerings co on co.id = s."offeringId"
		  join courses c on c.id = co."courseId"
		 where s."roomId" = $1 and s."scheduleType" = 'CLASS' and coalesce(co."isActive",1) = 1`
	args := []any{roomID}
	if termID != nil {
		q += ` and co."termId" = $2`
		args = append(args, *termID)
	}
	q += ` order by coalesce(s."dayOfWeek",0) asc, s."startTime" asc`
	rows, err := a.Pool.Query(ctx, q, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	profIDs := map[int64]bool{}
	type rawSlot struct {
		s extraWeeklySlot
	}
	raws := []rawSlot{}
	for rows.Next() {
		var s extraWeeklySlot
		var st, et string
		if rows.Scan(&s.ScheduleID, &s.OfferingID, &s.DayOfWeek, &st, &et, &s.ProfessorID, &s.CourseTitle, &s.CourseCode, &s.GroupNumber) != nil {
			continue
		}
		s.StartTime = extraHM5(st)
		s.EndTime = extraHM5(et)
		if s.ProfessorID != nil {
			profIDs[*s.ProfessorID] = true
		}
		raws = append(raws, rawSlot{s})
	}
	rows.Close()
	names := map[int64]string{}
	if len(profIDs) > 0 {
		ids := make([]int64, 0, len(profIDs))
		for id := range profIDs {
			ids = append(ids, id)
		}
		prows, err := a.Pool.Query(ctx, `
			select stf.id, coalesce(u."firstName",''), coalesce(u."lastName",'')
			  from staff stf join users u on u.id = stf."userId" where stf.id = any($1)`, ids)
		if err == nil {
			defer prows.Close()
			for prows.Next() {
				var id int64
				var fn, ln string
				if prows.Scan(&id, &fn, &ln) == nil {
					names[id] = strings.TrimSpace(fn + " " + ln)
				}
			}
		}
	}
	for _, r := range raws {
		r.s.ProfessorName = "—"
		if r.s.ProfessorID != nil {
			if n, ok := names[*r.s.ProfessorID]; ok && n != "" {
				r.s.ProfessorName = n
			}
		}
		out = append(out, r.s)
	}
	return out
}

// extraTermForUniversity — port of currentTermFor (date-driven effective term selection).
func (a *PublicExtraAPI) extraTermForUniversity(ctx context.Context, universityID *int64) *int64 {
	q := `select id, coalesce("isCurrent",0), "startDate", "endDate" from academic_terms`
	args := []any{}
	if universityID != nil {
		q += ` where "universityId" = $1`
		args = append(args, *universityID)
	}
	q += ` order by id asc`
	rows, err := a.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	type termRow struct {
		id        int64
		isCurrent int
		start     *time.Time
		end       *time.Time
	}
	terms := []termRow{}
	for rows.Next() {
		var t termRow
		if rows.Scan(&t.id, &t.isCurrent, &t.start, &t.end) == nil {
			terms = append(terms, t)
		}
	}
	rows.Close()
	if len(terms) == 0 {
		return nil
	}
	now := time.Now().UTC()
	// 1) the term whose range includes today
	var best *termRow
	for i := range terms {
		t := &terms[i]
		if t.start != nil && t.end != nil && !now.Before(*t.start) && !now.After(*t.end) {
			if best == nil || (t.start != nil && best.start != nil && t.start.After(*best.start)) {
				best = t
			}
		}
	}
	if best != nil {
		return &best.id
	}
	// 2) the isCurrent flag
	for i := range terms {
		if terms[i].isCurrent == 1 {
			if best == nil || terms[i].id > best.id {
				best = &terms[i]
			}
		}
	}
	if best != nil {
		return &best.id
	}
	// 3) most recently started
	for i := range terms {
		t := &terms[i]
		if t.start != nil && !t.start.After(now) {
			if best == nil || (t.start != nil && best.start != nil && t.start.After(*best.start)) || (best.start == nil) {
				best = t
			}
		}
	}
	if best != nil {
		return &best.id
	}
	// 4) nearest upcoming
	for i := range terms {
		t := &terms[i]
		if t.start != nil && t.start.After(now) {
			if best == nil || t.start.Before(*best.start) {
				best = t
			}
		}
	}
	if best == nil {
		return nil
	}
	return &best.id
}

// extraRecorderPolicy — port of getRecorderPolicy (admin setting; unknown value = BOTH).
func (a *PublicExtraAPI) extraRecorderPolicy(ctx context.Context) (mode string, profAllowed, ctrlAllowed, roomScoped bool) {
	mode = strings.ToUpper(strings.TrimSpace(a.extraSetting(ctx, "ATTENDANCE_RECORDER_MODE", "BOTH")))
	if mode != "PROFESSOR" && mode != "CONTROLLER" {
		mode = "BOTH"
	}
	roomScoped = true
	if a.Settings != nil {
		v, err := a.Settings.Get(ctx, "ATTENDANCE_CONTROLLER_ROOM_SCOPED")
		if err == nil {
			v = strings.ToLower(strings.TrimSpace(v))
			if v == "0" || v == "false" || v == "off" || v == "no" {
				roomScoped = false
			}
		}
	}
	return mode, mode != "CONTROLLER", mode != "PROFESSOR", roomScoped
}

// extraCanControlRoom — port of canControlRoom: controller scope from specific to general.
func (a *PublicExtraAPI) extraCanControlRoom(ctx context.Context, user *session.User, roomID int64) (bool, string) {
	if extraHasRole(user, "ADMIN") {
		return true, "admin"
	}
	isController := extraHasRole(user, "ATTENDANCE_CONTROLLER")
	isExpert := extraHasRole(user, "EDU_EXPERT")
	if !isController && !isExpert {
		return false, ""
	}
	room := a.extraRoomOf(ctx, roomID)
	if room == nil {
		return false, ""
	}
	// 1) direct room assignment
	var one int64
	err := a.Pool.QueryRow(ctx, `
		select id from classroom_edu_experts where "classroomId" = $1 and "userId" = $2 limit 1`,
		roomID, user.ID).Scan(&one)
	if err == nil {
		return true, "room"
	}
	// 2) course exception
	offeringIDs := []int64{}
	orows, err := a.Pool.Query(ctx, `
		select distinct "offeringId" from schedules where "roomId" = $1 and "scheduleType" <> 'EXAM' and "offeringId" is not null`, roomID)
	if err == nil {
		for orows.Next() {
			var id int64
			if orows.Scan(&id) == nil {
				offeringIDs = append(offeringIDs, id)
			}
		}
		orows.Close()
	}
	if len(offeringIDs) > 0 {
		err = a.Pool.QueryRow(ctx, `
			select id from course_offering_edu_experts
			 where "offeringId" = any($1) and "userId" = $2 limit 1`, offeringIDs, user.ID).Scan(&one)
		if err == nil {
			return true, "offering"
		}
	}
	// 3) role scope: the room's faculty or university
	var one2 int64
	err = a.Pool.QueryRow(ctx, `
		select 1 from expert_scopes
		 where "userId" = $1 and (
		   ("scopeType" = 'FACULTY' and "scopeId" = $2) or
		   ("scopeType" = 'UNIVERSITY' and "scopeId" = $3)
		 ) limit 1`, user.ID, extraNullInt(room.FacultyID), extraNullInt(room.UniversityID)).Scan(&one2)
	if err == nil {
		if room.FacultyID != nil {
			return true, "faculty"
		}
		if room.UniversityID != nil {
			return true, "university"
		}
	}
	// 4) the user's own university if "limited to room" is off
	_, _, _, roomScoped := a.extraRecorderPolicy(ctx)
	if !roomScoped && user.UniversityID != nil && (room.UniversityID == nil || *room.UniversityID == *user.UniversityID) {
		return true, "university"
	}
	return false, ""
}

func extraNullInt(v *int64) any {
	if v == nil {
		return nil
	}
	return *v
}

// extraRoomPublic — public header of the QR page (sessionless, like Next which shows the header to everyone).
func (a *PublicExtraAPI) extraRoomPublic(c *gin.Context) {
	roomID := extraRoomCode(c.Param("code"))
	if roomID == 0 {
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"found": false, "reason": "badroom"}})
		return
	}
	room := a.extraRoomOf(c.Request.Context(), roomID)
	if room == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"found": false, "reason": "notfound"}})
		return
	}
	var uniTitle *string
	if room.UniversityID != nil {
		_ = a.Pool.QueryRow(c.Request.Context(), `select title from universities where id = $1`, *room.UniversityID).Scan(&uniTitle)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"found": true,
		"room": gin.H{
			"id": room.ID, "name": room.Name, "buildingName": room.BuildingName,
			"floor": room.Floor, "isActive": room.IsActive,
		},
		"uniTitle": uniTitle,
	}})
}

// extraRoomCheckinState — full QR page state for the logged-in user.
func (a *PublicExtraAPI) extraRoomCheckinState(c *gin.Context) {
	user := a.extraUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	roomID := extraRoomCode(c.Param("code"))
	if roomID == 0 {
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"badroom": true}})
		return
	}
	ctx := c.Request.Context()
	room := a.extraRoomOf(ctx, roomID)
	if room == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"notfound": true}})
		return
	}
	// Cross-university boundary: a room's QR must not show another university's schedule.
	myUni := user.UniversityID
	staffID, hasStaff := a.extraStaffIDOf(ctx, user.ID)
	if myUni == nil && hasStaff {
		var su *int64
		_ = a.Pool.QueryRow(ctx, `select "universityId" from staff where id = $1`, staffID).Scan(&su)
		myUni = su
	}
	if myUni != nil && room.UniversityID != nil && *myUni != *room.UniversityID {
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"wronguni": true}})
		return
	}

	jalaliToday, nowMinutes := tehranNowExtra(time.Now())
	policyMode, profAllowed, ctrlAllowed, _ := a.extraRecorderPolicy(ctx)
	ctrlCanSrc := ""
	ctrlCan := false
	if ctrlAllowed {
		ctrlCan, ctrlCanSrc = a.extraCanControlRoom(ctx, user, roomID)
	}

	today := a.extraSessionsInRoom(ctx, roomID, jalaliToday)

	// Shared professor (offering_professors)
	sharedSet := map[int64]bool{}
	sharedOfferings := []int64{}
	nonMine := []int64{}
	for _, r := range today {
		if r.ProfessorID == nil || *r.ProfessorID != staffID {
			nonMine = append(nonMine, r.OfferingID)
		}
	}
	if hasStaff && len(nonMine) > 0 {
		a.extraCollectShared(ctx, staffID, nonMine, &sharedSet, &sharedOfferings)
	}
	isMine := func(r extraRoomSessionRow) bool {
		return hasStaff && ((r.ProfessorID != nil && *r.ProfessorID == staffID) || sharedSet[r.OfferingID])
	}

	// My recorded rows
	recordedMine := map[int64]*time.Time{}
	if hasStaff && len(today) > 0 {
		ids := make([]int64, 0, len(today))
		for _, r := range today {
			ids = append(ids, r.ID)
		}
		rrows, err := a.Pool.Query(ctx, `
			select "sessionId", "recordedAt" from professor_class_attendance
			 where "sessionId" = any($1) and "staffId" = $2`, ids, staffID)
		if err == nil {
			for rrows.Next() {
				var sid int64
				var at time.Time
				if rrows.Scan(&sid, &at) == nil {
					t := at
					recordedMine[sid] = &t
				}
			}
			rrows.Close()
		}
	}
	// Everyone's (non-voided) check-ins for each of today's sessions
	recordedAny := map[int64]*time.Time{}
	if len(today) > 0 {
		ids := make([]int64, 0, len(today))
		for _, r := range today {
			ids = append(ids, r.ID)
		}
		arows, err := a.Pool.Query(ctx, `
			select "sessionId", "recordedAt" from professor_class_attendance
			 where "sessionId" = any($1) and coalesce(status,'') <> 'REVOKED'
			 order by id asc`, ids)
		if err == nil {
			for arows.Next() {
				var sid int64
				var at time.Time
				if arows.Scan(&sid, &at) == nil {
					if _, exists := recordedAny[sid]; !exists {
						t := at
						recordedAny[sid] = &t
					}
				}
			}
			arows.Close()
		}
	}

	// Today's merged grouping of the room
	groups := extraGroupMerged(today)

	// "focus" session: my first unchecked OPEN ← OPEN ← BEFORE ← last
	type focusRow struct {
		row      extraRoomSessionRow
		state    string
		window   [2]string
		recorded *time.Time
	}
	mineRows := []focusRow{}
	for _, r := range today {
		if !isMine(r) {
			continue
		}
		fr := focusRow{row: r, state: extraCheckinState(r.StartTime, r.EndTime, nowMinutes)}
		openAt := extraHMToMinutes(r.StartTime) - extraCheckinOpenMinBefore
		closeAt := extraHMToMinutes(r.EndTime) + extraCheckinOpenMinAfter
		if extraHMToMinutes(r.StartTime) >= 0 && extraHMToMinutes(r.EndTime) >= 0 {
			fr.window = [2]string{extraMinutesToHm(openAt), extraMinutesToHm(closeAt)}
		}
		if at, ok := recordedMine[r.ID]; ok {
			fr.recorded = at
		}
		mineRows = append(mineRows, fr)
	}
	var focus *focusRow
	for i := range mineRows {
		if mineRows[i].state == "OPEN" && mineRows[i].recorded == nil {
			focus = &mineRows[i]
			break
		}
	}
	if focus == nil {
		for i := range mineRows {
			if mineRows[i].state == "OPEN" {
				focus = &mineRows[i]
				break
			}
		}
	}
	if focus == nil {
		for i := range mineRows {
			if mineRows[i].state == "BEFORE" {
				focus = &mineRows[i]
				break
			}
		}
	}
	if focus == nil && len(mineRows) > 0 {
		focus = &mineRows[len(mineRows)-1]
	}

	focusJSON := func() gin.H {
		if focus == nil {
			return nil
		}
		var focusGroup *extraMergedGroup
		for i := range groups {
			for _, sid := range groups[i].MemberSessionIDs {
				if sid == focus.row.ID {
					focusGroup = &groups[i]
				}
			}
		}
		var recordedAt *string
		if focus.recorded != nil {
			teh := focus.recorded.UTC().Add(3*time.Hour + 30*time.Minute)
			s := teh.Format("15:04")
			recordedAt = &s
		}
		var windowFrom, windowTo string
		if focus.window[0] != "" {
			windowFrom, windowTo = focus.window[0], focus.window[1]
		}
		h := gin.H{
			"id": focus.row.ID, "offeringId": focus.row.OfferingID, "sessionDate": focus.row.SessionDate,
			"startTime": focus.row.StartTime, "endTime": focus.row.EndTime,
			"courseTitle": focus.row.CourseTitle, "courseCode": focus.row.CourseCode,
			"groupNumber": focus.row.GroupNumber, "state": focus.state,
			"recorded": focus.recorded != nil, "recordedAt": recordedAt,
		}
		if windowFrom != "" {
			h["window"] = gin.H{"from": windowFrom, "to": windowTo}
		}
		if focusGroup != nil && focusGroup.Merged {
			h["merged"] = true
			h["memberCount"] = len(focusGroup.Members)
			h["memberTitles"] = extraMergeMemberTitles(focusGroup.Members)
		}
		return h
	}

	// Upcoming sessions of the same professor in this room (when there is no class today)
	upcoming := []gin.H{}
	if focus == nil && hasStaff {
		up := a.extraUpcomingInRoom(ctx, roomID, jalaliToday, staffID, sharedSet, 3)
		for _, u := range up {
			upcoming = append(upcoming, gin.H{
				"id": u.ID, "sessionDate": u.SessionDate, "startTime": u.StartTime, "endTime": u.EndTime,
				"courseTitle": u.CourseTitle, "courseCode": u.CourseCode,
			})
		}
	}

	// Controller worklist — today's room groups
	ctrlGroups := []gin.H{}
	if ctrlCan {
		for i := range groups {
			if len(groups[i].Members) == 0 {
				continue
			}
			m := groups[i].Members[0]
			var recordedAt *string
			if at, ok := recordedAny[m.ID]; ok {
				teh := at.UTC().Add(3*time.Hour + 30*time.Minute)
				s := teh.Format("15:04")
				recordedAt = &s
			}
			ctrlGroups = append(ctrlGroups, gin.H{
				"sessionId": m.ID, "startTime": m.StartTime, "endTime": m.EndTime,
				"courseTitle": m.CourseTitle, "courseCode": m.CourseCode, "groupNumber": m.GroupNumber,
				"professorId": m.ProfessorID, "recordedAt": recordedAt,
				"merged": groups[i].Merged, "memberCount": len(groups[i].Members),
				"memberTitles": extraMergeMemberTitles(groups[i].Members),
			})
		}
	}

	// Weekly schedule + same-name rooms
	termID := a.extraTermForUniversity(ctx, room.UniversityID)
	weekly := a.extraWeeklyInRoom(ctx, roomID, termID)
	weeklyShared := map[int64]bool{}
	if hasStaff && len(weekly) > 0 {
		ids := []int64{}
		seen := map[int64]bool{}
		for _, w := range weekly {
			if !seen[w.OfferingID] {
				seen[w.OfferingID] = true
				ids = append(ids, w.OfferingID)
			}
		}
		a.extraCollectShared(ctx, staffID, ids, &weeklyShared, &sharedOfferings)
	}
	mySharedList := []int64{}
	seenShared := map[int64]bool{}
	for _, id := range sharedOfferings {
		if !seenShared[id] {
			seenShared[id] = true
			mySharedList = append(mySharedList, id)
		}
	}

	// Same-name rooms with a schedule (when this room has none)
	twinRooms := []gin.H{}
	if len(weekly) == 0 {
		twinRooms = a.extraTwinRooms(ctx, roomID, room.Name)
	}

	// Today's map for linking a weekly slot to a session (key «offeringId|HH:MM»)
	todayBySlot := map[string]gin.H{}
	for _, r := range today {
		key := fmt.Sprintf("%d|%s", r.OfferingID, r.StartTime)
		if _, exists := todayBySlot[key]; !exists {
			var recMineAt, recAnyAt *string
			if at, ok := recordedMine[r.ID]; ok {
				teh := at.UTC().Add(3*time.Hour + 30*time.Minute)
				s := teh.Format("15:04")
				recMineAt = &s
			}
			if at, ok := recordedAny[r.ID]; ok {
				teh := at.UTC().Add(3*time.Hour + 30*time.Minute)
				s := teh.Format("15:04")
				recAnyAt = &s
			}
			todayBySlot[key] = gin.H{"sessionId": r.ID, "recordedMine": recMineAt != nil, "recordedMineAt": recMineAt,
				"recordedAny": recAnyAt != nil, "recordedAnyAt": recAnyAt}
		}
	}

	// Tehran today for display
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"roomId": roomID, "todayJalali": jalaliToday, "todayDow": extraIranDow(jalaliToday),
		"room": gin.H{"id": room.ID, "name": room.Name, "buildingName": room.BuildingName,
			"floor": room.Floor, "isActive": room.IsActive},
		"staffName":         user.Name,
		"me":                gin.H{"staffId": staffID, "hasStaff": hasStaff, "name": user.Name, "isProfessor": extraHasRole(user, "PROFESSOR")},
		"policy":            gin.H{"mode": policyMode, "professorAllowed": profAllowed, "controllerAllowed": ctrlAllowed},
		"control":           gin.H{"allowed": ctrlCan, "source": ctrlCanSrc},
		"focus":             focusJSON(),
		"upcoming":          upcoming,
		"ctrlGroups":        ctrlGroups,
		"weekly":            weekly,
		"mySharedOfferings": mySharedList,
		"todayBySlot":       todayBySlot,
		"twinRooms":         twinRooms,
		"noStaff":           !hasStaff,
	}})
}

func (a *PublicExtraAPI) extraCollectShared(ctx context.Context, staffID int64, offeringIDs []int64, sharedSet *map[int64]bool, sharedList *[]int64) {
	rows, err := a.Pool.Query(ctx, `
		select "offeringId" from offering_professors where "staffId" = $1 and "offeringId" = any($2)`, staffID, offeringIDs)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			(*sharedSet)[id] = true
			*sharedList = append(*sharedList, id)
		}
	}
}

// extraUpcomingInRoom — port of listUpcomingSessionsInRoom (only the professor's own/shared sessions).
func (a *PublicExtraAPI) extraUpcomingInRoom(ctx context.Context, roomID int64, afterJalali string, staffID int64, sharedSet map[int64]bool, limit int) []extraRoomSessionRow {
	out := []extraRoomSessionRow{}
	// Slots of all days
	slotsByDow := map[int]map[string]bool{}
	allOfferings := []int64{}
	seen := map[int64]bool{}
	for dow := 0; dow <= 6; dow++ {
		keys, ids := a.extraRoomSlots(ctx, roomID, dow)
		slotsByDow[dow] = keys
		for _, id := range ids {
			if !seen[id] {
				seen[id] = true
				allOfferings = append(allOfferings, id)
			}
		}
	}
	args := []any{afterJalali, roomID}
	sqlScope := `("roomId" = $2`
	if len(allOfferings) > 0 {
		args = append(args, allOfferings)
		sqlScope += fmt.Sprintf(` or "offeringId" = any($%d)`, len(args))
	}
	sqlScope += ")"
	q := fmt.Sprintf(`
		select cs.id, cs."offeringId", cs."sessionDate", cs."startTime"::text, cs."endTime"::text, cs."roomId",
		       co."professorId", coalesce(co.title,''), coalesce(c.code,''), co."groupNumber", co."sharedScheduleGroupKey"
		  from class_sessions cs
		  join course_offerings co on co.id = cs."offeringId"
		  join courses c on c.id = co."courseId"
		 where cs."sessionDate" > $1 and coalesce(cs."isActive",1) = 1 and %s
		 order by cs."sessionDate" asc, cs."startTime" asc limit 400`, sqlScope)
	rows, err := a.Pool.Query(ctx, q, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r extraRoomSessionRow
		if rows.Scan(&r.ID, &r.OfferingID, &r.SessionDate, &r.StartTime, &r.EndTime, &r.explicitRoomID,
			&r.ProfessorID, &r.CourseTitle, &r.CourseCode, &r.GroupNumber, &r.SharedScheduleGroupKey) != nil {
			continue
		}
		ok := r.explicitRoomID != nil && *r.explicitRoomID == roomID
		if !ok && r.explicitRoomID == nil {
			if dow := extraIranDow(r.SessionDate); dow >= 0 {
				ok = slotsByDow[dow][fmt.Sprintf("%d|%s", r.OfferingID, extraHM5(r.StartTime))]
			}
		}
		if !ok {
			continue
		}
		mine := (r.ProfessorID != nil && *r.ProfessorID == staffID) || sharedSet[r.OfferingID]
		if !mine {
			continue
		}
		r.RoomID = roomID
		r.StartTime = extraHM5(r.StartTime)
		r.EndTime = extraHM5(r.EndTime)
		out = append(out, r)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// extraTwinRooms — same-name rooms with a schedule (port of twinRooms).
func (a *PublicExtraAPI) extraTwinRooms(ctx context.Context, roomID int64, name string) []gin.H {
	same := []int64{}
	rows, err := a.Pool.Query(ctx, `
		select id from classrooms where name = $1 and id <> $2 and coalesce("isActive",1) = 1`, name, roomID)
	if err == nil {
		for rows.Next() {
			var id int64
			if rows.Scan(&id) == nil {
				same = append(same, id)
			}
		}
		rows.Close()
	}
	if len(same) == 0 {
		return []gin.H{}
	}
	counts := map[int64]int{}
	crows, err := a.Pool.Query(ctx, `
		select "roomId" from schedules
		 where "roomId" = any($1) and "scheduleType" = 'CLASS' and "roomId" is not null`, same)
	if err == nil {
		for crows.Next() {
			var id int64
			if crows.Scan(&id) == nil {
				counts[id]++
			}
		}
		crows.Close()
	}
	out := []gin.H{}
	for _, id := range same {
		if counts[id] > 0 {
			out = append(out, gin.H{"id": id, "slots": counts[id]})
		}
	}
	// Sort descending by session count
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j]["slots"].(int) > out[i]["slots"].(int) {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

// extraRoomCheckinRecord — port of recordCore/recordRoomAttendance; the final decision is only here.
func (a *PublicExtraAPI) extraRoomCheckinRecord(c *gin.Context) {
	user := a.extraUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	roomID := extraRoomCode(c.Param("code"))
	if roomID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "کد این QR معتبر نیست. لطفاً QR سردر کلاس را دوباره اسکن کنید."})
		return
	}
	var in struct {
		SessionID int64 `json:"sessionId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.SessionID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "جلسهٔ معتبری برای ثبت حضور یافت نشد."})
		return
	}
	ctx := c.Request.Context()
	staffID, hasStaff := a.extraStaffIDOf(ctx, user.ID)
	if !hasStaff {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "برای این حساب پروندهٔ هیئت علمی ثبت نشده است؛ این صفحه مخصوص استادان است."})
		return
	}
	jalaliToday, nowMinutes := tehranNowExtra(time.Now())
	today := a.extraSessionsInRoom(ctx, roomID, jalaliToday)
	var sess *extraRoomSessionRow
	for i := range today {
		if today[i].ID == in.SessionID {
			sess = &today[i]
			break
		}
	}
	if sess == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "جلسهٔ معتبری برای ثبت حضور یافت نشد."})
		return
	}
	if extraCheckinState(sess.StartTime, sess.EndTime, nowMinutes) != "OPEN" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اکنون خارج از بازهٔ مجاز ثبت حضور است."})
		return
	}
	var offeringProfessorID *int64
	if err := a.Pool.QueryRow(ctx, `select "professorId" from course_offerings where id = $1`, sess.OfferingID).Scan(&offeringProfessorID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "جلسهٔ معتبری برای ثبت حضور یافت نشد."})
		return
	}
	room := a.extraRoomOf(ctx, roomID)
	if room == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "کد این QR معتبر نیست. لطفاً QR سردر کلاس را دوباره اسکن کنید."})
		return
	}
	myUni := user.UniversityID
	if myUni == nil {
		var su *int64
		_ = a.Pool.QueryRow(ctx, `select "universityId" from staff where id = $1`, staffID).Scan(&su)
		myUni = su
	}
	if myUni != nil && room.UniversityID != nil && *myUni != *room.UniversityID {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "این اتاق به دانشگاه دیگری تعلق دارد."})
		return
	}
	// Path A: the course's own professor
	owns := offeringProfessorID != nil && *offeringProfessorID == staffID
	if !owns {
		var one int64
		err := a.Pool.QueryRow(ctx, `
			select id from offering_professors where "offeringId" = $1 and "staffId" = $2 limit 1`,
			sess.OfferingID, staffID).Scan(&one)
		owns = err == nil
	}
	_, profAllowed, ctrlAllowed, _ := a.extraRecorderPolicy(ctx)
	controlAllowed, _ := a.extraCanControlRoom(ctx, user, roomID)
	via := ""
	if owns && profAllowed {
		via = "professor"
	} else if controlAllowed && ctrlAllowed {
		via = "controller"
	}
	if via == "" {
		if owns {
			c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "بر اساس تنظیم سامانه، ثبت حضور در این دانشگاه فقط توسط کنترل‌کنندهٔ حضور و غیاب انجام می‌شود."})
			return
		}
		if controlAllowed {
			c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "بر اساس تنظیم سامانه، ثبت حضور فقط توسط خودِ استاد انجام می‌شود."})
			return
		}
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "شما استاد این درس نیستید و کنترل‌کنندهٔ این اتاق هم نیستید."})
		return
	}

	// Expand to the whole merged class (port of resolveMergedSessionTargets)
	groups := extraGroupMerged(today)
	var mine *extraMergedGroup
	for i := range groups {
		for _, sid := range groups[i].MemberSessionIDs {
			if sid == sess.ID {
				mine = &groups[i]
			}
		}
	}
	sessionIDs := []int64{sess.ID}
	merged := false
	if mine != nil {
		sessionIDs = append([]int64{}, mine.MemberSessionIDs...)
		merged = mine.Merged
	}
	// Fill in members without a session (manual merge K: only)
	manualKey := ""
	_ = a.Pool.QueryRow(ctx, `select coalesce("sharedScheduleGroupKey",'') from course_offerings where id = $1`, sess.OfferingID).Scan(&manualKey)
	manualKey = strings.TrimSpace(manualKey)
	if manualKey != "" && !strings.HasPrefix(manualKey, "SOLO-") {
		siblings := []int64{}
		srows, err := a.Pool.Query(ctx, `select id from course_offerings where "sharedScheduleGroupKey" = $1`, manualKey)
		if err == nil {
			for srows.Next() {
				var id int64
				if srows.Scan(&id) == nil && id != sess.OfferingID {
					siblings = append(siblings, id)
				}
			}
			srows.Close()
		}
		present := map[int64]bool{}
		for _, sid := range sessionIDs {
			present[sid] = true
		}
		offeringPresent := map[int64]bool{}
		for _, r := range today {
			offeringPresent[r.OfferingID] = true
		}
		dow := extraIranDow(sess.SessionDate)
		for _, oid := range siblings {
			if present[oid] || offeringPresent[oid] || dow < 0 {
				continue
			}
			// Does this offering have a schedule in this room/day/hour?
			var slotID int64
			err := a.Pool.QueryRow(ctx, `
				select id from schedules where "offeringId" = $1 and "roomId" = $2 and "scheduleType" = 'CLASS'
				  and "dayOfWeek" = $3 and "startTime" = $4 limit 1`,
				oid, roomID, dow, sess.StartTime).Scan(&slotID)
			if err != nil {
				continue
			}
			var oUni *int64
			_ = a.Pool.QueryRow(ctx, `select "universityId" from course_offerings where id = $1`, oid).Scan(&oUni)
			var createdID int64
			err = a.Pool.QueryRow(ctx, `
				insert into class_sessions ("offeringId", "sessionDate", "startTime", "endTime", status, "roomId", "universityId")
				values ($1, $2, $3, $4, 'HELD', $5, $6) returning id`,
				oid, sess.SessionDate, sess.StartTime, sess.EndTime, roomID, oUni).Scan(&createdID)
			_ = err // session insert failure is tolerated: the session row is optional
		}
	}

	// The professor who must be recorded for each session
	staffFor := map[int64]*int64{}
	for _, sid := range sessionIDs {
		var profID *int64
		_ = a.Pool.QueryRow(ctx, `
			select co."professorId" from class_sessions cs
			  join course_offerings co on co.id = cs."offeringId"
			 where cs.id = $1`, sid).Scan(&profID)
		if via == "professor" {
			mineProf := profID != nil && *profID == staffID
			if !mineProf {
				var sharedOne int64
				err := a.Pool.QueryRow(ctx, `
					select op.id from offering_professors op
					  join class_sessions cs on cs."offeringId" = op."offeringId"
					 where cs.id = $1 and op."staffId" = $2 limit 1`, sid, staffID).Scan(&sharedOne)
				if err == nil {
					id := staffID
					staffFor[sid] = &id
				}
			} else {
				id := staffID
				staffFor[sid] = &id
			}
		} else {
			staffFor[sid] = profID
		}
	}

	ip := extraClientIP(c)
	ua := c.GetHeader("user-agent")
	if len(ua) > 500 {
		ua = ua[:500]
	}
	method := "QR_BY_CONTROLLER"
	if via == "professor" {
		method = "QR_SCAN"
	}
	recordedCount := int64(0)
	eligibleCount := 0
	alreadyAll := true
	for _, sid := range sessionIDs {
		recStaff := staffFor[sid]
		if recStaff == nil {
			continue
		}
		eligibleCount++
		var existing int64
		if err := a.Pool.QueryRow(ctx, `
			select id from professor_class_attendance where "sessionId" = $1 and "staffId" = $2 limit 1`,
			sid, *recStaff).Scan(&existing); err == nil {
			continue
		}
		alreadyAll = false
		note := (*string)(nil)
		if via == "controller" {
			n := "ثبت با اسکن QR سردر توسط کنترل‌کنندهٔ حضور و غیاب"
			if merged {
				n = "ثبت با اسکن QR سردر توسط کنترل‌کنندهٔ حضور و غیاب (کلاس ادغامی)"
			}
			note = &n
		} else if merged {
			n := "ثبت با اسکن QR سردر (کلاس ادغامی)"
			note = &n
		}
		var confirmedBy any
		if via == "controller" {
			confirmedBy = staffID
		}
		_, err := a.Pool.Exec(ctx, `
			insert into professor_class_attendance
				("sessionId", "staffId", "verificationMethod", status, "recordedIpAddress", "deviceUserAgent",
				 "confirmedByStaffId", note, "universityId")
			values ($1, $2, $3, 'VALID', nullif($4,''), nullif($5,''), $6, $7, $8)`,
			sid, *recStaff, method, ip, ua, confirmedBy, note, room.UniversityID)
		if err == nil {
			recordedCount++
		}
	}
	if eligibleCount == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "برای این جلسه استادی ثبت نشده است؛ ابتدا استاد درس را در سامانه مشخص کنید."})
		return
	}

	msg := "ok"
	if alreadyAll {
		msg = "already"
	} else if via == "controller" {
		if merged {
			msg = "okctrlmerged"
		} else {
			msg = "okctrl"
		}
	} else if merged {
		msg = "okmerged"
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"via": via, "already": alreadyAll, "recordedCount": recordedCount, "merged": merged,
		"message": msg,
	}})
}

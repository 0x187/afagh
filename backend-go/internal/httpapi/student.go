// ═══ اندپوینت‌های پرتال دانشجو (فاز ۳) ═══
package httpapi

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/enroll"
	"backend-go/internal/session"
	"backend-go/internal/settings"
	"backend-go/internal/student"
)

// StudentAPI هندلرهای دادهٔ دانشجو.
type StudentAPI struct {
	Svc      *student.Service
	Enroll   *enroll.Service
	Store    *session.Store
	Settings *settings.Store
}

func (a *StudentAPI) Register(r gin.IRouter) {
	r.GET("/student/me", a.me)
	r.GET("/student/schedule", a.schedule)
	r.GET("/student/dashboard", a.dashboard)
	r.GET("/student/transcript", a.transcript)
	r.GET("/student/exam-card", a.examCard)
	r.GET("/student/enroll-confirm", a.enrollConfirm)
	r.GET("/student/virtual-classes", a.virtualClasses)
	r.POST("/student/virtual-classes/join", a.virtualClassJoin)
	r.GET("/student/documents", a.documents)
	r.GET("/student/lesson-plan/:offeringId", a.lessonPlan)
	r.GET("/student/requests", a.requests)
	r.POST("/student/requests/submit", a.requestSubmit)
	r.POST("/student/requests/satisfaction", a.requestSatisfaction)
	r.POST("/student/requests/attachment", a.requestAttachment)
	r.GET("/student/finance", a.finance)
	r.GET("/student/chart", a.chart)
	r.GET("/student/graduation", a.graduationTracker)
	r.POST("/student/graduation/sajjad", a.graduationSajjad)
	r.POST("/student/graduation/photo", a.graduationPhoto)
	r.GET("/student/channels", a.channels)
	r.POST("/student/channels", a.saveChannel)
	r.GET("/student/thesis", a.thesis)
	r.POST("/student/thesis/title", a.thesisTitle)
	r.POST("/student/thesis/proposal", a.thesisProposal)
	r.POST("/student/thesis/defense", a.thesisDefense)
	r.POST("/student/thesis/final", a.thesisFinal)
}

func (a *StudentAPI) currentUser(c *gin.Context) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		return nil
	}
	u, _ := a.Store.Get(c.Request.Context(), token, false)
	return u
}

func hasRole(u *session.User, role string) bool {
	for _, r := range u.Roles {
		if r == role || r == "ADMIN" {
			return true
		}
	}
	return false
}

// me مشخصات پروندهٔ دانشجوی جاری.
func (a *StudentAPI) me(c *gin.Context) {
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	if !hasRole(user, "STUDENT") {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی به پرتال دانشجو مجاز نیست."})
		return
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
		return
	}
	if rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok": true,
		"student": gin.H{
			"id": rec.ID, "studentCode": rec.StudentCode, "status": rec.Status,
			"entryYear": rec.EntryYear, "majorId": rec.MajorID,
			"degreeLevelId": rec.DegreeLevelID, "universityId": rec.UniversityID,
		},
	})
}

// schedule برنامهٔ هفتگی — ?termId= برای انتخاب ترم (اختیاری؛ کوکی هم پشتیبانی می‌شود).
func (a *StudentAPI) schedule(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	termID := termIDQueryOrCookie(c)

	resp, err := a.Svc.GetSchedule(c.Request.Context(), user.ID, user.Name, termID)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "پروندهٔ دانشجویی یافت نشد") {
			c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": msg})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

// requireStudent کاربر را از سشن می‌خواند و نقش دانشجو را بررسی می‌کند.
func (a *StudentAPI) requireStudent(c *gin.Context) *session.User {
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	if !hasRole(user, "STUDENT") {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی به پرتال دانشجو مجاز نیست."})
		return nil
	}
	return user
}

// termIDQueryOrCookie ترم انتخابی: ?termId= سپس کوکی انتخاب نیمسال.
func termIDQueryOrCookie(c *gin.Context) *int64 {
	raw := strings.TrimSpace(c.Query("termId"))
	if raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
			return &n
		}
		return nil
	}
	return termIDFromCookie(c)
}

func (a *StudentAPI) fail(c *gin.Context, err error) {
	fmt.Printf("[student-api] %s: %v\n", c.FullPath(), err)
	msg := err.Error()
	if strings.Contains(msg, "پروندهٔ دانشجویی یافت نشد") {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": msg})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
}

func (a *StudentAPI) publicBaseURL(c *gin.Context) string {
	if a.Settings != nil {
		if v, err := a.Settings.Get(c.Request.Context(), "PUBLIC_BASE_URL"); err == nil {
			if v = strings.TrimSpace(v); v != "" {
				return strings.TrimRight(v, "/")
			}
		}
	}
	proto := c.GetHeader("X-Forwarded-Proto")
	if proto == "" {
		if c.Request.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	host := c.GetHeader("X-Forwarded-Host")
	if host == "" {
		host = c.Request.Host
	}
	return proto + "://" + host
}

// enrollConfirm تأییدیهٔ انتخاب واحد نیمسال انتخابی + QR.
func (a *StudentAPI) enrollConfirm(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetEnrollConfirm(c.Request.Context(), user.ID, termIDFromCookie(c), a.publicBaseURL(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

// virtualClasses جلسات کلاس مجازی ترم انتخابی.
func (a *StudentAPI) virtualClasses(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil || rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return
	}
	termID := termIDFromCookie(c)
	sessions, err := a.Svc.ListVirtualClasses(c.Request.Context(), rec.ID, termID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "sessions": sessions})
}

// virtualClassJoin صدور لینک SSO بیگ‌بلوباتن — نقش سمت سرور تعیین می‌شود.
func (a *StudentAPI) virtualClassJoin(c *gin.Context) {
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	var body struct {
		MeetingID string `json:"meetingId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ جلسه نامعتبر است."})
		return
	}
	link, err := a.Svc.JoinVirtualClass(c.Request.Context(), user.ID, user.Roles, body.MeetingID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "url": link})
}

// documents مدارک بارگذاری‌شدهٔ دانشجو.
func (a *StudentAPI) documents(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	docs, err := a.Svc.ListDocuments(c.Request.Context(), user.ID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "documents": docs})
}

// lessonPlan طرح درس منتشرشده — فقط برای دانشجوی ثبت‌نام‌شدهٔ همان ارائه.
func (a *StudentAPI) lessonPlan(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	id, err := strconv.ParseInt(c.Param("offeringId"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ ارائهٔ درس نامعتبر است."})
		return
	}
	view, err := a.Svc.GetLessonPlan(c.Request.Context(), user.ID, id)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": view})
}

// thesis نمای پایان‌نامه و پروپوزال.
func (a *StudentAPI) thesis(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetThesis(c.Request.Context(), user.ID, user.Name)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

// thesisTitle ثبت فاز ۱ (عنوان و استاد راهنما).
func (a *StudentAPI) thesisTitle(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil || rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return
	}
	var body struct {
		AuditID      int64  `json:"auditId"`
		SupervisorID int64  `json:"supervisorId"`
		TitleFa      string `json:"titleFa"`
		TitleEn      string `json:"titleEn"`
		Keywords     string `json:"keywords"`
		Abstract     string `json:"abstract"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.AuditID <= 0 || body.SupervisorID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SubmitThesisTitle(c.Request.Context(), user.ID, rec.ID, body.AuditID, body.SupervisorID, body.TitleFa, body.TitleEn, body.Keywords, body.Abstract); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// thesisUploadItem کمکی برای دو مسیر آپلود.
func (a *StudentAPI) thesisUploadItem(c *gin.Context) (auditID int64, fileName, mime string, data []byte, ok bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 10*1024*1024+2048)
	auditID, _ = strconv.ParseInt(c.PostForm("auditId"), 10, 64)
	if auditID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ پرونده نامعتبر است."})
		return 0, "", "", nil, false
	}
	fileHeader, err := c.FormFile("file")
	if err != nil || fileHeader.Size <= 0 || fileHeader.Size > 10*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "فایل نامعتبر است (حداکثر ۱۰ مگابایت)."})
		return 0, "", "", nil, false
	}
	f, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خواندن فایل ناموفق بود."})
		return 0, "", "", nil, false
	}
	defer f.Close()
	buf := make([]byte, fileHeader.Size)
	if _, err := io.ReadFull(f, buf); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خواندن فایل ناموفق بود."})
		return 0, "", "", nil, false
	}
	return auditID, fileHeader.Filename, fileHeader.Header.Get("Content-Type"), buf, true
}

// thesisProposal بارگذاری پروپوزال.
func (a *StudentAPI) thesisProposal(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil || rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return
	}
	auditID, name, mime, data, ok := a.thesisUploadItem(c)
	if !ok {
		return
	}
	if err := a.Svc.SubmitThesisProposal(c.Request.Context(), user.ID, rec.ID, auditID, name, mime, data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// thesisDefense درخواست دفاع.
func (a *StudentAPI) thesisDefense(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil || rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return
	}
	var body struct {
		AuditID int64 `json:"auditId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.AuditID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.RequestThesisDefense(c.Request.Context(), rec.ID, body.AuditID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// thesisFinal بارگذاری پایان‌نامهٔ نهایی.
func (a *StudentAPI) thesisFinal(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil || rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return
	}
	auditID, name, mime, data, ok := a.thesisUploadItem(c)
	if !ok {
		return
	}
	if err := a.Svc.SubmitFinalThesis(c.Request.Context(), user.ID, rec.ID, auditID, name, mime, data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// graduationTracker ردیاب فارغ‌التحصیلی.
func (a *StudentAPI) graduationTracker(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil || rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return
	}
	tracker, err := a.Svc.GetTracker(c.Request.Context(), rec.ID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "tracker": tracker})
}

// graduationSajjad ثبت کد رهگیری سجاد.
func (a *StudentAPI) graduationSajjad(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil || rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return
	}
	var body struct {
		AuditID int64  `json:"auditId"`
		Code    string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.AuditID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SubmitSajjad(c.Request.Context(), rec.ID, body.AuditID, body.Code); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// graduationPhoto آپلود عکس ۴×۳ (multipart: auditId + file).
func (a *StudentAPI) graduationPhoto(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil || rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 10*1024*1024+2048)
	auditID, _ := strconv.ParseInt(c.PostForm("auditId"), 10, 64)
	if auditID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ پرونده نامعتبر است."})
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil || fileHeader.Size <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "فایلی انتخاب نشده است."})
		return
	}
	f, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خواندن فایل ناموفق بود."})
		return
	}
	defer f.Close()
	buf := make([]byte, fileHeader.Size)
	if _, err := io.ReadFull(f, buf); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خواندن فایل ناموفق بود."})
		return
	}
	if err := a.Svc.AttachGraduationPhoto(c.Request.Context(), user.ID, rec.ID, auditID, fileHeader.Filename, fileHeader.Header.Get("Content-Type"), buf); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// channels کانال‌های اطلاع‌رسانی.
func (a *StudentAPI) channels(c *gin.Context) {
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": a.Svc.GetChannels(c.Request.Context(), user.ID)})
}

// saveChannel ثبت/حذف نشانی کانال.
func (a *StudentAPI) saveChannel(c *gin.Context) {
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	var body struct {
		Channel string `json:"channel"`
		Address string `json:"address"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveChannel(c.Request.Context(), user.ID, body.Channel, body.Address); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// chart چارت تحصیلی مصوب + وضعیت دروس دانشجو.
func (a *StudentAPI) chart(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetChart(c.Request.Context(), user.ID, user.Name, termIDFromCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

// finance کارنامهٔ مالی ترم‌به‌ترم + چک/وام + QR.
func (a *StudentAPI) finance(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	var recordID *int64
	if raw := strings.TrimSpace(c.Query("record")); raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
			recordID = &n
		}
	}
	resp, err := a.Svc.GetFinance(c.Request.Context(), user.ID, recordID, termIDFromCookie(c), a.publicBaseURL(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

// requests میز خدمات — فرایندها و درخواست‌های دانشجو.
func (a *StudentAPI) requests(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.ListRequests(c.Request.Context(), user.ID, user.Name)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

// requestSubmit ثبت درخواست جدید.
func (a *StudentAPI) requestSubmit(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil || rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return
	}
	var body struct {
		ProcessCode string         `json:"processCode"`
		FormData    map[string]any `json:"formData"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.ProcessCode) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res := a.Svc.SubmitRequest(c.Request.Context(), user.ID, rec.ID, body.ProcessCode, body.FormData)
	if !res.OK {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": res.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "trackingCode": res.TrackingCode, "status": res.Status})
}

// requestSatisfaction ثبت امتیاز رضایت (فقط درخواست خود دانشجو).
func (a *StudentAPI) requestSatisfaction(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil || rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return
	}
	var body struct {
		RequestID int64  `json:"requestId"`
		Score     int    `json:"score"`
		Feedback  string `json:"feedback"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.RequestID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.RateSatisfaction(c.Request.Context(), rec.ID, body.RequestID, body.Score, body.Feedback); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// requestAttachment آپلود پیوست درخواست (multipart/form-data — فیلد file).
func (a *StudentAPI) requestAttachment(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil || rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 10*1024*1024+1024)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "فایلی انتخاب نشده است."})
		return
	}
	if fileHeader.Size <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "فایلی انتخاب نشده است."})
		return
	}
	if fileHeader.Size > 10*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "حجم پیوست نباید بیش از ۱۰ مگابایت باشد."})
		return
	}
	f, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خواندن فایل ناموفق بود."})
		return
	}
	defer f.Close()
	buf := make([]byte, fileHeader.Size)
	if _, err := io.ReadFull(f, buf); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خواندن فایل ناموفق بود."})
		return
	}
	att, err := a.Svc.UploadRequestAttachment(c.Request.Context(), rec.ID, fileHeader.Filename, fileHeader.Header.Get("Content-Type"), buf)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "attachment": att})
}

// dashboard دادهٔ صفحهٔ اول دانشجو.
func (a *StudentAPI) dashboard(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetDashboard(c.Request.Context(), user.ID, user.Name, termIDQueryOrCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

// transcript کارنامهٔ تحصیلی — ?record= برای مقطع دیگر، ?termId= برای فیلتر ترم.
func (a *StudentAPI) transcript(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	var recordID *int64
	if raw := strings.TrimSpace(c.Query("record")); raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
			recordID = &n
		}
	}
	resp, err := a.Svc.GetTranscript(c.Request.Context(), user.ID, user.Name, recordID, termIDQueryOrCookie(c), a.publicBaseURL(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

// examCard کارت آزمون + توکن ورود + QR.
func (a *StudentAPI) examCard(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetExamCard(c.Request.Context(), user.ID, termIDQueryOrCookie(c), a.publicBaseURL(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

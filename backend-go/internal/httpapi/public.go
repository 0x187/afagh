// ═══ Login page showcase — port of getLoginShowcase from src/lib/login-showcase.ts ═══
//
// Public and sessionless: selected university + active notices and slides (global +
// same university). If the tables are not migrated yet, returns a safe empty result
// so the login page doesn't crash (same catch as in TS).
package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/opencourses"
	"backend-go/internal/publicverify"
	"backend-go/internal/ratelimit"
	"backend-go/internal/settings"
)

// ShowcaseUniversity / ShowcaseNotice / ShowcaseSlide — same TS types.
type ShowcaseUniversity struct {
	ID      int64   `json:"id"`
	Code    string  `json:"code"`
	Title   string  `json:"title"`
	LogoURL *string `json:"logoUrl"`
}

type ShowcaseNotice struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
	Body  string `json:"body"`
	Kind  string `json:"kind"`
}

type ShowcaseSlide struct {
	ID       int64  `json:"id"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
	ImageURL string `json:"imageUrl"`
	LinkURL  string `json:"linkUrl"`
}

type LoginShowcase struct {
	Universities []ShowcaseUniversity `json:"universities"`
	University   ShowcaseUniversity   `json:"university"`
	Notices      []ShowcaseNotice     `json:"notices"`
	Slides       []ShowcaseSlide      `json:"slides"`
}

// PublicAPI public sessionless endpoints.
type PublicAPI struct {
	Pool     *pgxpool.Pool
	Settings *settings.Store
	Verify   *publicverify.Service
	Open     *opencourses.Service
	Limiter  *ratelimit.Limiter
}

func (a *PublicAPI) Register(r gin.IRouter) {
	r.GET("/public/login-showcase", a.loginShowcase)
	r.GET("/public/verify/:token", a.verifyToken)
	r.GET("/public/id/:token", a.verifyStudentCard)
	r.GET("/public/degree/:code", a.verifyDegree)
	r.GET("/public/certificate/:code", a.verifyCertificate)
	r.GET("/public/open-courses", a.openCourses)
	r.POST("/public/open-courses/discount", a.openCourseDiscount)
	r.POST("/public/open-courses/register", a.openCourseRegister)
}

func (a *PublicAPI) openCourses(c *gin.Context) {
	if a.Open == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "در دسترس نیست."})
		return
	}
	rows, err := a.Open.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دریافت کاتالوگ ناموفق بود."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"courses": rows}})
}

func (a *PublicAPI) allowPublic(c *gin.Context, key string, limit, windowSec int) bool {
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

func (a *PublicAPI) openCourseDiscount(c *gin.Context) {
	if a.Open == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "در دسترس نیست."})
		return
	}
	if !a.allowPublic(c, "open-discount:"+c.ClientIP(), 30, 60) {
		return
	}
	var body struct {
		CourseID int64  `json:"courseId"`
		Code     string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.CourseID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res := a.Open.ValidateDiscount(c.Request.Context(), body.CourseID, body.Code)
	if !res.OK {
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"ok": false, "error": res.Error}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"ok": true, "discountAmount": res.DiscountAmount}})
}

func (a *PublicAPI) openCourseRegister(c *gin.Context) {
	if a.Open == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "در دسترس نیست."})
		return
	}
	if !a.allowPublic(c, "open-register:"+c.ClientIP(), 5, 600) {
		return
	}
	var body opencourses.RegisterInput
	if err := c.ShouldBindJSON(&body); err != nil || body.CourseID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res := a.Open.Register(c.Request.Context(), body)
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *PublicAPI) verifyStudentCard(c *gin.Context) {
	if a.Verify == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "استعلام در دسترس نیست."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": a.Verify.VerifyStudentCard(c.Request.Context(), c.Param("token"))})
}

func (a *PublicAPI) verifyDegree(c *gin.Context) {
	if a.Verify == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "استعلام در دسترس نیست."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": a.Verify.VerifyDegree(c.Request.Context(), c.Param("code"))})
}

func (a *PublicAPI) verifyCertificate(c *gin.Context) {
	if a.Verify == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "استعلام در دسترس نیست."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": a.Verify.VerifyCertificate(c.Request.Context(), c.Param("code"))})
}

// verifyToken public verification of a signed token (transcript/finance/enrollment/exam card).
func (a *PublicAPI) verifyToken(c *gin.Context) {
	if a.Verify == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "استعلام در دسترس نیست."})
		return
	}
	token := strings.TrimSpace(c.Param("token"))
	res := a.Verify.Verify(c.Request.Context(), token)
	if !res.OK {
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

var fallbackShowcaseUni = ShowcaseUniversity{ID: 0, Code: "AFAGH", Title: "دانشگاه آفاق"}

// loginShowcase port of getLoginShowcase with the ?u=CODE parameter.
func (a *PublicAPI) loginShowcase(c *gin.Context) {
	ctx := c.Request.Context()
	empty := LoginShowcase{Universities: []ShowcaseUniversity{}, University: fallbackShowcaseUni, Notices: []ShowcaseNotice{}, Slides: []ShowcaseSlide{}}

	unis, err := a.universities(ctx)
	if err != nil || len(unis) == 0 {
		c.JSON(http.StatusOK, gin.H{"ok": true, "showcase": empty})
		return
	}

	wantCode := strings.ToUpper(strings.TrimSpace(c.Query("u")))
	uni := unis[0]
	for _, u := range unis {
		if u.Code == wantCode {
			uni = u
			break
		}
	}
	if wantCode != "" && uni.Code != wantCode {
		for _, u := range unis {
			if u.Code == "AFAGH" {
				uni = u
				break
			}
		}
	}

	// Global emblem (UNIVERSITY_LOGO setting) when the university has no custom emblem.
	globalLogo := ""
	if a.Settings != nil {
		globalLogo, _ = a.Settings.Get(ctx, "UNIVERSITY_LOGO")
	}
	logoOf := func(u ShowcaseUniversity) *string {
		if u.LogoURL != nil && *u.LogoURL != "" {
			return u.LogoURL
		}
		if globalLogo != "" {
			v := globalLogo
			return &v
		}
		return nil
	}
	for i := range unis {
		unis[i].LogoURL = logoOf(unis[i])
	}
	uni.LogoURL = logoOf(uni)

	notices, _ := a.notices(ctx, uni.ID)
	slides, _ := a.slides(ctx, uni.ID)

	c.JSON(http.StatusOK, gin.H{"ok": true, "showcase": LoginShowcase{
		Universities: unis,
		University:   uni,
		Notices:      notices,
		Slides:       slides,
	}})
}

func (a *PublicAPI) universities(ctx context.Context) ([]ShowcaseUniversity, error) {
	rows, err := a.Pool.Query(ctx,
		`select id, code, title, "logoUrl" from universities where "isActive" = 1 order by id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ShowcaseUniversity{}
	for rows.Next() {
		var u ShowcaseUniversity
		if err := rows.Scan(&u.ID, &u.Code, &u.Title, &u.LogoURL); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (a *PublicAPI) notices(ctx context.Context, uniID int64) ([]ShowcaseNotice, error) {
	rows, err := a.Pool.Query(ctx,
		`select id, title, body, kind from login_notices
		  where "isActive" = 1 and ("universityId" is null or "universityId" = $1)
		  order by "sortOrder" asc, id asc`, uniID)
	if err != nil {
		return []ShowcaseNotice{}, err
	}
	defer rows.Close()
	out := []ShowcaseNotice{}
	for rows.Next() {
		var n ShowcaseNotice
		var kind *string
		if err := rows.Scan(&n.ID, &n.Title, &n.Body, &kind); err != nil {
			return []ShowcaseNotice{}, err
		}
		if kind != nil && *kind != "" {
			n.Kind = *kind
		} else {
			n.Kind = "info"
		}
		if n.Title != "" {
			out = append(out, n)
		}
	}
	return out, rows.Err()
}

func (a *PublicAPI) slides(ctx context.Context, uniID int64) ([]ShowcaseSlide, error) {
	rows, err := a.Pool.Query(ctx,
		`select id, title, subtitle, "imageUrl", "linkUrl" from login_slides
		  where "isActive" = 1 and ("universityId" is null or "universityId" = $1)
		  order by "sortOrder" asc, id asc`, uniID)
	if err != nil {
		return []ShowcaseSlide{}, err
	}
	defer rows.Close()
	out := []ShowcaseSlide{}
	for rows.Next() {
		var s ShowcaseSlide
		if err := rows.Scan(&s.ID, &s.Title, &s.Subtitle, &s.ImageURL, &s.LinkURL); err != nil {
			return []ShowcaseSlide{}, err
		}
		if s.Title != "" {
			out = append(out, s)
		}
	}
	return out, rows.Err()
}

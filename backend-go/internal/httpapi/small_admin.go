// ═══ اندپوینت‌های کوچک باقیمانده: student-finance، login-showcase، code-hub ═══
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"backend-go/internal/session"
)

var smallAdminRoles = []string{"ADMIN", "FINANCE_EXPERT", "FINANCE"}

// SmallAdminAPI هندلرهای صفحات کوچک باقیمانده.
type SmallAdminAPI struct {
	Admin *AdminAPI
}

func (a *SmallAdminAPI) require(c *gin.Context) *session.User {
	return a.Admin.requireRoles(c, smallAdminRoles)
}

func (a *SmallAdminAPI) universityID(c *gin.Context, user *session.User) *int64 {
	return a.Admin.Svc.UniversityID(c.Request.Context(), user, a.Admin.uniCookie(c))
}

func (a *SmallAdminAPI) Register(r gin.IRouter) {
	r.GET("/admin/student-finance/ledger", a.studentFinanceLedger)
	r.GET("/admin/login-showcase", a.loginShowcaseGet)
	r.POST("/admin/login-showcase/notice", a.loginNoticeCreate)
	r.POST("/admin/login-showcase/notice/toggle", a.loginNoticeToggle)
	r.POST("/admin/login-showcase/notice/delete", a.loginNoticeDelete)
	r.POST("/admin/login-showcase/slide", a.loginSlideCreate)
	r.POST("/admin/login-showcase/slide/toggle", a.loginSlideToggle)
	r.POST("/admin/login-showcase/slide/delete", a.loginSlideDelete)
}

// studentFinanceLedger دفتر مالی کل دانشگاه (پورت admin/student-finance).
func (a *SmallAdminAPI) studentFinanceLedger(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	uniID := a.universityID(c, user)
	args := []any{}
	where := ""
	if uniID != nil {
		where = ` where (sl."universityId" = $1 or sl."universityId" is null)`
		args = append(args, *uniID)
	}
	rows, err := a.Admin.Svc.DB.Pool.Query(c.Request.Context(), `
		select sl.id, st."studentCode", u."firstName" || ' ' || u."lastName",
		       sl."transactionType", sl.amount::float8, coalesce(sl.description,''),
		       coalesce(t."termCode",''), sl."createdAt"::text
		  from student_ledger sl
		  join students st on st.id = sl."studentId"
		  join users u on u.id = st."userId"
		  left join academic_terms t on t.id = sl."termId"`+where+`
		 order by sl."createdAt" desc limit 500`, args...)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	defer rows.Close()
	type row struct {
		ID              int64   `json:"id"`
		StudentCode     string  `json:"studentCode"`
		StudentName     string  `json:"studentName"`
		TransactionType string  `json:"transactionType"`
		Amount          float64 `json:"amount"`
		Description     string  `json:"description"`
		TermCode        string  `json:"termCode"`
		CreatedAt       string  `json:"createdAt"`
	}
	out := []row{}
	for rows.Next() {
		var r row
		if rows.Scan(&r.ID, &r.StudentCode, &r.StudentName, &r.TransactionType, &r.Amount, &r.Description, &r.TermCode, &r.CreatedAt) == nil {
			out = append(out, r)
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": out}})
}

// ── login-showcase ──

func (a *SmallAdminAPI) loginShowcaseGet(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	ctx := c.Request.Context()
	notices := []map[string]any{}
	nrows, err := a.Admin.Svc.DB.Pool.Query(ctx, `select id, title, body, kind, coalesce("isActive",1), coalesce("sortOrder",0) from login_notices order by coalesce("sortOrder",0), id`)
	if err == nil {
		for nrows.Next() {
			var id, active, sort int
			var title, body, kind string
			if nrows.Scan(&id, &title, &body, &kind, &active, &sort) == nil {
				notices = append(notices, map[string]any{"id": id, "title": title, "body": body, "kind": kind, "isActive": active, "sortOrder": sort})
			}
		}
		nrows.Close()
	}
	slides := []map[string]any{}
	srows, err := a.Admin.Svc.DB.Pool.Query(ctx, `select id, title, coalesce(subtitle,''), "imageUrl", "linkUrl", coalesce("isActive",1), coalesce("sortOrder",0) from login_slides order by coalesce("sortOrder",0), id`)
	if err == nil {
		for srows.Next() {
			var id, active, sort int
			var title, subtitle, img, link string
			if srows.Scan(&id, &title, &subtitle, &img, &link, &active, &sort) == nil {
				slides = append(slides, map[string]any{"id": id, "title": title, "subtitle": subtitle, "imageUrl": img, "linkUrl": link, "isActive": active, "sortOrder": sort})
			}
		}
		srows.Close()
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"notices": notices, "slides": slides}})
}

func (a *SmallAdminAPI) loginNoticeCreate(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct {
		Text string `json:"text"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.Text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "متن اطلاعیه الزامی است."})
		return
	}
	_, err := a.Admin.Svc.DB.Pool.Exec(c.Request.Context(), `insert into login_notices (title, body, "isActive") values ($1,$2,1)`, in.Text, in.Text)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *SmallAdminAPI) loginNoticeToggle(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct {
		ID       int  `json:"id"`
		IsActive bool `json:"isActive"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه نامعتبر."})
		return
	}
	v := 0
	if in.IsActive {
		v = 1
	}
	_, err := a.Admin.Svc.DB.Pool.Exec(c.Request.Context(), `update login_notices set "isActive" = $2 where id = $1`, in.ID, v)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *SmallAdminAPI) loginNoticeDelete(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct {
		ID int `json:"id"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه نامعتبر."})
		return
	}
	_, err := a.Admin.Svc.DB.Pool.Exec(c.Request.Context(), `delete from login_notices where id = $1`, in.ID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *SmallAdminAPI) loginSlideCreate(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct {
		Title    string `json:"title"`
		ImageUrl string `json:"imageUrl"`
		LinkUrl  string `json:"linkUrl"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.Title == "" || in.ImageUrl == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "عنوان و نشانی تصویر الزامی است."})
		return
	}
	_, err := a.Admin.Svc.DB.Pool.Exec(c.Request.Context(),
		`insert into login_slides (title, "imageUrl", "linkUrl", "isActive") values ($1,$2,nullif($3,''),1)`,
		in.Title, in.ImageUrl, in.LinkUrl)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *SmallAdminAPI) loginSlideToggle(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct {
		ID       int  `json:"id"`
		IsActive bool `json:"isActive"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه نامعتبر."})
		return
	}
	v := 0
	if in.IsActive {
		v = 1
	}
	_, err := a.Admin.Svc.DB.Pool.Exec(c.Request.Context(), `update login_slides set "isActive" = $2 where id = $1`, in.ID, v)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *SmallAdminAPI) loginSlideDelete(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct {
		ID int `json:"id"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه نامعتبر."})
		return
	}
	_, err := a.Admin.Svc.DB.Pool.Exec(c.Request.Context(), `delete from login_slides where id = $1`, in.ID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ═══ موتور گردش کار و کارتابل ادمین — پورت workflow-engine/analytics ═══
//
//  ماشین وضعیت پرونده: SUBMITTED/IN_REVIEW/RETURNED → APPROVED/REJECTED
//  اقدام‌ها: APPROVE (مرحله بعد یا نهایی) / REJECT / RETURN_FOR_REVISION / ESCALATE
//  همهٔ جابه‌جایی‌ها داخل یک تراکنش با قفل سطری و حسابرسی.
package workflow

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Settings حداقل وابستگی تنظیمات.
type Settings interface {
	Get(ctx context.Context, key string) (string, error)
}

// Engine موتور گردش کار.
type Engine struct {
	Pool     *pgxpool.Pool
	Settings Settings
	Handlers []Handler
	// Notify اطلاع‌رسانی به دانشجو (درج در notifications).
	Notify func(ctx context.Context, userID int64, eventCode, text string)
}

// New ساخت موتور.
func New(pool *pgxpool.Pool, settings Settings) *Engine {
	return &Engine{Pool: pool, Settings: settings, Handlers: []Handler{}}
}

var terminalStatuses = map[string]bool{"APPROVED": true, "REJECTED": true, "CANCELLED": true}
var openStatuses = map[string]bool{"SUBMITTED": true, "IN_REVIEW": true, "RETURNED": true}

// ─────────────────── کارتابل ───────────────────

// ProcessStep گام فرایند.
type ProcessStep struct {
	ID                    int64  `json:"id"`
	StepOrder             int    `json:"stepOrder"`
	Title                 string `json:"title"`
	StepType              string `json:"stepType"`
	RoleCode              string `json:"roleCode"`
	SLAHours              int    `json:"slaHours"`
	TimeoutAction         string `json:"timeoutAction"`
	TimeoutEscalateToRole string `json:"timeoutEscalateToRole,omitempty"`
}

// ProcessDefinition فرایند.
type ProcessDefinition struct {
	ID          int64         `json:"id"`
	Code        string        `json:"code"`
	Title       string        `json:"title"`
	Category    string        `json:"category"`
	Description string        `json:"description"`
	FeeAmount   float64       `json:"feeAmount"`
	FormSchema  []any         `json:"formSchema"`
	Steps       []ProcessStep `json:"steps"`
}

// InboxCheckpoint چک‌پوینت موازی.
type InboxCheckpoint struct {
	ID              int64   `json:"id"`
	DepartmentCode  string  `json:"departmentCode"`
	DepartmentTitle string  `json:"departmentTitle"`
	IsCleared       bool    `json:"isCleared"`
	Notes           *string `json:"notes"`
}

// InboxItem ردیف کارتابل.
type InboxItem struct {
	ID               int64             `json:"id"`
	TrackingCode     string            `json:"trackingCode"`
	StudentName      string            `json:"studentName"`
	StudentCode      string            `json:"studentCode"`
	ProcessTitle     string            `json:"processTitle"`
	ProcessCode      string            `json:"processCode"`
	Status           string            `json:"status"`
	Created          *string           `json:"created"`
	CurrentStepTitle *string           `json:"currentStepTitle"`
	CurrentRoleCode  *string           `json:"currentRoleCode"`
	SLAHours         int               `json:"slaHours"`
	HoursElapsed     int               `json:"hoursElapsed"`
	IsBreached       bool              `json:"isBreached"`
	FormData         map[string]any    `json:"formData"`
	SatisfactionScore *int             `json:"satisfactionScore"`
	Checkpoints      []InboxCheckpoint `json:"checkpoints"`
}

// HeatmapItem نقشهٔ حرارتی مرحله.
type HeatmapItem struct {
	ProcessID        int64   `json:"processId"`
	ProcessCode      string  `json:"processCode"`
	ProcessTitle     string  `json:"processTitle"`
	StepID           int64   `json:"stepId"`
	StepTitle        string  `json:"stepTitle"`
	RoleCode         string  `json:"roleCode"`
	TargetSLAHours   int     `json:"targetSlaHours"`
	AvgDurationHours float64 `json:"avgDurationHours"`
	PendingCount     int     `json:"pendingCount"`
	BreachCount      int     `json:"breachCount"`
	StatusLevel      string  `json:"statusLevel"`
}

// DepartmentQueueItem صف یک نقش.
type DepartmentQueueItem struct {
	RoleCode           string  `json:"roleCode"`
	RoleTitleFa        string  `json:"roleTitleFa"`
	PendingCount       int     `json:"pendingCount"`
	OldestPendingHours int     `json:"oldestPendingHours"`
	AvgWaitHours       float64 `json:"avgWaitHours"`
}

// StaffKpiItem KPI نقش.
type StaffKpiItem struct {
	ActorRole            string  `json:"actorRole"`
	FullName             string  `json:"fullName"`
	TotalResolved        int     `json:"totalResolved"`
	AvgMttrHours         float64 `json:"avgMttrHours"`
	SLAAdherencePercent  int     `json:"slaAdherencePercent"`
	EscalationCount      int     `json:"escalationCount"`
	AvgCsatScore         float64 `json:"avgCsatScore"`
	ProductivityScore    int     `json:"productivityScore"`
}

// Analytics تحلیل کارتابل.
type Analytics struct {
	Summary struct {
		TotalRequests      int     `json:"totalRequests"`
		ActiveRequests     int     `json:"activeRequests"`
		ApprovedRequests   int     `json:"approvedRequests"`
		RejectedRequests   int     `json:"rejectedRequests"`
		BounceRatePercent  float64 `json:"bounceRatePercent"`
		AvgSatisfaction    float64 `json:"avgSatisfaction"`
	} `json:"summary"`
	Heatmap         []HeatmapItem        `json:"heatmap"`
	DepartmentQueues []DepartmentQueueItem `json:"departmentQueues"`
	StaffKpiList    []StaffKpiItem       `json:"staffKpiList"`
}

var roleTitles = map[string]string{
	"SUPERVISOR": "استاد راهنما", "DEPARTMENT_HEAD": "مدیر گروه آموزشی",
	"EDU_EXPERT": "کارشناس آموزش کل", "FINANCE_EXPERT": "کارشناس امور مالی",
	"LIBRARY_STAFF": "مسئول کتابخانه مرکزی", "WELFARE_STAFF": "کارشناس صندوق رفاه",
	"LAB_STAFF": "مسئول آزمایشگاه و کارگاه", "GRADUATION_EXPERT": "کارشناس فارغ‌التحصیلی",
	"VICE_CHANCELLOR": "معاونت آموزشی و تحصیلات تکمیلی", "MULTI_CHECKPOINT": "تسویه چندگانه موازی",
	"SYSTEM_BOT": "ربات هوشمند سیستمی", "PROFESSOR": "استاد درس",
}

// WorkflowsData پاسخ صفحهٔ گردش کار.
type WorkflowsData struct {
	Processes []ProcessDefinition `json:"processes"`
	Inbox     []InboxItem         `json:"inbox"`
	Analytics Analytics           `json:"analytics"`
}

// LoadAdminWorkflows پورت page admin/workflows.
func (e *Engine) LoadAdminWorkflows(ctx context.Context, universityID *int64) (*WorkflowsData, error) {
	out := &WorkflowsData{Processes: []ProcessDefinition{}, Inbox: []InboxItem{}}

	// فرایندها
	args := []any{}
	scope := ""
	if universityID != nil {
		scope = ` where ("universityId" = $1 or "universityId" is null)`
		args = append(args, *universityID)
	}
	prows, err := e.Pool.Query(ctx, `
		select id, coalesce(code,''), coalesce(title,''), coalesce(category,'عمومی'),
		       coalesce(description,''), "feeAmount"::float8, "formSchema"
		  from process_definitions`+scope+` order by id`, args...)
	if err != nil {
		return nil, err
	}
	procByID := map[int64]*ProcessDefinition{}
	for prows.Next() {
		var p ProcessDefinition
		var schema *string
		if err := prows.Scan(&p.ID, &p.Code, &p.Title, &p.Category, &p.Description, &p.FeeAmount, &schema); err != nil {
			continue
		}
		p.FormSchema = []any{}
		if schema != nil && strings.TrimSpace(*schema) != "" {
			_ = json.Unmarshal([]byte(*schema), &p.FormSchema)
			if p.FormSchema == nil {
				p.FormSchema = []any{}
			}
		}
		p.Steps = []ProcessStep{}
		out.Processes = append(out.Processes, p)
	}
	prows.Close()
	for i := range out.Processes {
		procByID[out.Processes[i].ID] = &out.Processes[i]
	}
	stepRows, err := e.Pool.Query(ctx, `
		select id, "processId", "stepOrder", title, coalesce("stepType",'USER'), coalesce("roleCode",'USER'),
		       coalesce("slaHours",48), coalesce("timeoutAction",'ESCALATE'), "timeoutEscalateToRole"
		  from process_steps order by "stepOrder"`)
	if err != nil {
		return nil, err
	}
	stepByID := map[int64]ProcessStep{}
	for stepRows.Next() {
		var pid int64
		var s ProcessStep
		var escalateTo *string
		if err := stepRows.Scan(&s.ID, &pid, &s.StepOrder, &s.Title, &s.StepType, &s.RoleCode,
			&s.SLAHours, &s.TimeoutAction, &escalateTo); err != nil {
			continue
		}
		if escalateTo != nil {
			s.TimeoutEscalateToRole = *escalateTo
		}
		stepByID[s.ID] = s
		if p, ok := procByID[pid]; ok {
			p.Steps = append(p.Steps, s)
		}
	}
	stepRows.Close()

	// کارتابل — ۵۰ درخواست اخیر
	reqScope := ""
	reqArgs := []any{}
	if universityID != nil {
		reqScope = ` where (r."universityId" = $1 or st."universityId" = $1 or (r."universityId" is null and st."universityId" is null))`
		reqArgs = append(reqArgs, *universityID)
	}
	type reqRow struct {
		ID            int64
		TrackingCode  string
		Status        string
		Created       *time.Time
		FormData      *string
		CurrentStepID *int64
		SatScore      *int
		StudentCode   string
		FirstName     string
		LastName      string
		ProcTitle     string
		ProcCode      string
	}
	reqs := []reqRow{}
	rrows, err := e.Pool.Query(ctx, `
		select r.id, r."trackingCode", coalesce(r.status,'SUBMITTED'), r."createdAt", r."formData",
		       r."currentStepId", r."satisfactionScore",
		       coalesce(st."studentCode",''), coalesce(u."firstName",''), coalesce(u."lastName",''),
		       coalesce(p.title,''), coalesce(p.code,'')
		  from student_requests r
		  left join students st on st.id = r."studentId"
		  left join users u on u.id = st."userId"
		  join process_definitions p on p.id = r."processId"`+reqScope+`
		 order by r.id desc limit 50`, reqArgs...)
	if err != nil {
		return nil, err
	}
	for rrows.Next() {
		var r reqRow
		if err := rrows.Scan(&r.ID, &r.TrackingCode, &r.Status, &r.Created, &r.FormData, &r.CurrentStepID, &r.SatScore,
			&r.StudentCode, &r.FirstName, &r.LastName, &r.ProcTitle, &r.ProcCode); err == nil {
			reqs = append(reqs, r)
		}
	}
	rrows.Close()

	ids := make([]int64, len(reqs))
	for i, r := range reqs {
		ids[i] = r.ID
	}
	type logRow struct {
		ID         int64
		RequestID  int64
		AssignedAt *time.Time
		CompletedAt *time.Time
		Action     *string
		ActorRole  *string
		Duration   *int
		SLAStatus  *string
		StepID     *int64
	}
	logs := []logRow{}
	if len(ids) > 0 {
		lrows, err := e.Pool.Query(ctx, `
			select id, "requestId", "assignedAt", "completedAt", action, "actorRole", "durationMinutes", "slaStatus", "stepId"
			  from request_step_logs where "requestId" = any($1) order by id`, ids)
		if err == nil {
			for lrows.Next() {
				var l logRow
				if err := lrows.Scan(&l.ID, &l.RequestID, &l.AssignedAt, &l.CompletedAt, &l.Action, &l.ActorRole, &l.Duration, &l.SLAStatus, &l.StepID); err == nil {
					logs = append(logs, l)
				}
			}
			lrows.Close()
		}
	}
	type cpRow struct {
		ID              int64
		RequestID       int64
		DepartmentCode  string
		DepartmentTitle string
		IsCleared       *int
		Notes           *string
	}
	cps := []cpRow{}
	if len(ids) > 0 {
		crows, err := e.Pool.Query(ctx, `
			select id, "requestId", coalesce("departmentCode",''), coalesce("departmentTitle",''), "isCleared", notes
			  from request_parallel_checkpoints where "requestId" = any($1)`, ids)
		if err == nil {
			for crows.Next() {
				var c cpRow
				if err := crows.Scan(&c.ID, &c.RequestID, &c.DepartmentCode, &c.DepartmentTitle, &c.IsCleared, &c.Notes); err == nil {
					cps = append(cps, c)
				}
			}
			crows.Close()
		}
	}

	now := time.Now()
	for _, r := range reqs {
		item := InboxItem{
			ID: r.ID, TrackingCode: r.TrackingCode,
			StudentName: strings.TrimSpace(r.FirstName + " " + r.LastName),
			StudentCode: r.StudentCode, ProcessTitle: r.ProcTitle, ProcessCode: r.ProcCode,
			Status: r.Status, FormData: map[string]any{}, SatisfactionScore: r.SatScore,
			SLAHours: 48, Checkpoints: []InboxCheckpoint{},
		}
		if r.Created != nil {
			v := r.Created.Format(time.RFC3339)
			item.Created = &v
		}
		if r.FormData != nil && strings.TrimSpace(*r.FormData) != "" {
			_ = json.Unmarshal([]byte(*r.FormData), &item.FormData)
			if item.FormData == nil {
				item.FormData = map[string]any{}
			}
		}
		if r.CurrentStepID != nil {
			if s, ok := stepByID[*r.CurrentStepID]; ok {
				t := s.Title
				rc := s.RoleCode
				item.CurrentStepTitle = &t
				item.CurrentRoleCode = &rc
				item.SLAHours = s.SLAHours
			}
		}
		// بازترین لاگ این پرونده (مبنای محاسبهٔ زمان توقف)
		var last *logRow
		for i := range logs {
			l := &logs[i]
			if l.RequestID != r.ID || l.CompletedAt != nil {
				continue
			}
			if last == nil || l.ID > last.ID {
				last = l
			}
		}
		ref := r.Created
		if last != nil && last.AssignedAt != nil {
			ref = last.AssignedAt
		}
		if ref != nil {
			item.HoursElapsed = int(now.Sub(*ref).Hours() + 0.5)
		}
		item.IsBreached = item.HoursElapsed > item.SLAHours && r.Status != "APPROVED" && r.Status != "REJECTED"
		for _, c := range cps {
			if c.RequestID != r.ID {
				continue
			}
			item.Checkpoints = append(item.Checkpoints, InboxCheckpoint{
				ID: c.ID, DepartmentCode: c.DepartmentCode, DepartmentTitle: c.DepartmentTitle,
				IsCleared: c.IsCleared != nil && *c.IsCleared == 1, Notes: c.Notes,
			})
		}
		out.Inbox = append(out.Inbox, item)
	}

	out.Analytics = e.computeAnalytics(ctx, universityID)
	return out, nil
}

// computeAnalytics پورت getWorkflowAnalytics (KPI پرسنل از لاگ‌های واقعی).
func (e *Engine) computeAnalytics(ctx context.Context, universityID *int64) Analytics {
	var a Analytics
	a.Heatmap = []HeatmapItem{}
	a.DepartmentQueues = []DepartmentQueueItem{}
	a.StaffKpiList = []StaffKpiItem{}

	scope := ""
	args := []any{}
	if universityID != nil {
		scope = ` where ("universityId" = $1 or "universityId" is null)`
		args = append(args, *universityID)
	}
	_ = e.Pool.QueryRow(ctx, `select count(*)::int from student_requests`+scope, args...).Scan(&a.Summary.TotalRequests)
	var active, approved, rejected int
	_ = e.Pool.QueryRow(ctx, `select count(*)::int from student_requests where status in ('SUBMITTED','IN_REVIEW')`).Scan(&active)
	_ = e.Pool.QueryRow(ctx, `select count(*)::int from student_requests where status = 'APPROVED'`).Scan(&approved)
	_ = e.Pool.QueryRow(ctx, `select count(*)::int from student_requests where status in ('REJECTED','RETURNED')`).Scan(&rejected)
	a.Summary.ActiveRequests = active
	a.Summary.ApprovedRequests = approved
	a.Summary.RejectedRequests = rejected
	if a.Summary.TotalRequests > 0 {
		a.Summary.BounceRatePercent = float64(int(float64(rejected)/float64(a.Summary.TotalRequests)*1000)) / 10
	}
	var avgCsat *float64
	_ = e.Pool.QueryRow(ctx, `select avg("satisfactionScore")::float8 from student_requests where "satisfactionScore" is not null`).Scan(&avgCsat)
	if avgCsat != nil {
		a.Summary.AvgSatisfaction = float64(int(*avgCsat*10)) / 10
	}

	// نقشهٔ حرارتی
	type stepDef struct {
		ProcessID   int64
		ProcessCode string
		ProcessTitle string
		StepID      int64
		StepTitle   string
		RoleCode    string
		SLAHours    int
	}
	steps := []stepDef{}
	srows, err := e.Pool.Query(ctx, `
		select p.id, coalesce(p.code,''), coalesce(p.title,''), s.id, s.title, coalesce(s."roleCode",'USER'), coalesce(s."slaHours",48)
		  from process_steps s join process_definitions p on p.id = s."processId"`)
	if err == nil {
		for srows.Next() {
			var s stepDef
			if err := srows.Scan(&s.ProcessID, &s.ProcessCode, &s.ProcessTitle, &s.StepID, &s.StepTitle, &s.RoleCode, &s.SLAHours); err == nil {
				steps = append(steps, s)
			}
		}
		srows.Close()
	}
	type logAgg struct {
		StepID      *int64
		Duration    *int
		Completed   *time.Time
		Assigned    *time.Time
		SLAStatus   *string
		ActorRole   *string
		Action      *string
	}
	logs := []logAgg{}
	lrows, err := e.Pool.Query(ctx, `
		select "stepId", "durationMinutes", "completedAt", "assignedAt", "slaStatus", "actorRole", action
		  from request_step_logs`)
	if err == nil {
		for lrows.Next() {
			var l logAgg
			if err := lrows.Scan(&l.StepID, &l.Duration, &l.Completed, &l.Assigned, &l.SLAStatus, &l.ActorRole, &l.Action); err == nil {
				logs = append(logs, l)
			}
		}
		lrows.Close()
	}
	now := time.Now()
	for _, s := range steps {
		var totalDur, completed, pending, breaches int
		for _, l := range logs {
			if l.StepID == nil || *l.StepID != s.StepID {
				continue
			}
			if l.Completed != nil && l.Duration != nil {
				totalDur += *l.Duration
				completed++
			}
			if l.Completed == nil {
				pending++
			}
			if (l.SLAStatus != nil && *l.SLAStatus == "SLA_BREACHED") || (l.Duration != nil && *l.Duration > s.SLAHours*60) {
				breaches++
			}
		}
		avg := 0.0
		if completed > 0 {
			avg = float64(int((float64(totalDur)/float64(completed)/60)*10)) / 10
		}
		level := "NORMAL"
		if avg > float64(s.SLAHours) || breaches > 3 {
			level = "BOTTLENECK"
		} else if avg > float64(s.SLAHours)*0.7 || breaches > 0 {
			level = "WARNING"
		}
		displayAvg := avg
		if displayAvg == 0 {
			displayAvg = float64(int(float64(s.SLAHours)*0.45))
		}
		a.Heatmap = append(a.Heatmap, HeatmapItem{
			ProcessID: s.ProcessID, ProcessCode: s.ProcessCode, ProcessTitle: s.ProcessTitle,
			StepID: s.StepID, StepTitle: s.StepTitle, RoleCode: s.RoleCode,
			TargetSLAHours: s.SLAHours, AvgDurationHours: displayAvg,
			PendingCount: pending, BreachCount: breaches, StatusLevel: level,
		})
	}

	// صف بخش‌ها
	type roleAgg struct {
		pending   int
		durations []float64
	}
	byRole := map[string]*roleAgg{}
	for _, l := range logs {
		role := "EDU_EXPERT"
		if l.ActorRole != nil && *l.ActorRole != "" {
			role = *l.ActorRole
		}
		agg := byRole[role]
		if agg == nil {
			agg = &roleAgg{}
			byRole[role] = agg
		}
		if l.Completed == nil && l.Assigned != nil {
			agg.pending++
			agg.durations = append(agg.durations, now.Sub(*l.Assigned).Hours())
		} else if l.Duration != nil {
			agg.durations = append(agg.durations, float64(*l.Duration)/60)
		}
	}
	roles := make([]string, 0, len(byRole))
	for r := range byRole {
		roles = append(roles, r)
	}
	sort.Strings(roles)
	for _, role := range roles {
		if role == "SYSTEM_BOT" {
			continue
		}
		agg := byRole[role]
		maxAge, sum := 0.0, 0.0
		for _, d := range agg.durations {
			if d > maxAge {
				maxAge = d
			}
			sum += d
		}
		avgWait := 0.0
		if len(agg.durations) > 0 {
			avgWait = sum / float64(len(agg.durations))
		}
		title := roleTitles[role]
		if title == "" {
			title = role
		}
		a.DepartmentQueues = append(a.DepartmentQueues, DepartmentQueueItem{
			RoleCode: role, RoleTitleFa: title, PendingCount: agg.pending,
			OldestPendingHours: int(maxAge + 0.5), AvgWaitHours: float64(int(avgWait*10)) / 10,
		})
	}

	// KPI پرسنل — از لاگ‌های واقعی (به تفکیک نقش)
	for _, role := range roles {
		if role == "SYSTEM_BOT" || role == "SYSTEM_SLA_ENGINE" {
			continue
		}
		resolved, onTime, escalated := 0, 0, 0
		totalDur := 0
		for _, l := range logs {
			r := "EDU_EXPERT"
			if l.ActorRole != nil && *l.ActorRole != "" {
				r = *l.ActorRole
			}
			if r != role {
				continue
			}
			if l.Action != nil && *l.Action == "ESCALATE" {
				escalated++
			}
			if l.Completed != nil && l.Duration != nil {
				resolved++
				totalDur += *l.Duration
				if l.SLAStatus == nil || *l.SLAStatus != "SLA_BREACHED" {
					onTime++
				}
			}
		}
		if resolved == 0 {
			continue
		}
		slaPct := int(float64(onTime) / float64(resolved) * 100)
		avgH := float64(int(float64(totalDur)/float64(resolved)/60*10)) / 10
		title := roleTitles[role]
		if title == "" {
			title = role
		}
		productivity := slaPct*5/10 + 0
		a.StaffKpiList = append(a.StaffKpiList, StaffKpiItem{
			ActorRole: role, FullName: title, TotalResolved: resolved, AvgMttrHours: avgH,
			SLAAdherencePercent: slaPct, EscalationCount: escalated,
			ProductivityScore: productivity,
		})
	}
	return a
}

// ─────────────────── پیشبرد مرحله ───────────────────

// AdvanceResult نتیجهٔ اقدام.
type AdvanceResult struct {
	Status             string  `json:"status"` // MOVED_TO_NEXT_STEP | APPROVED_FINAL | REJECTED | RETURNED | ESCALATED | ALREADY_FINAL
	NextStepTitle      string  `json:"nextStepTitle,omitempty"`
	CertificateNumber  string  `json:"certificateNumber,omitempty"`
	TargetRole         string  `json:"targetRole,omitempty"`
}

// ActionResult پاسخ اقدام.
type ActionResult struct {
	Result *AdvanceResult `json:"result"`
	Events *DispatchStats `json:"events,omitempty"`
}

// DispatchStats آمار پردازش رویدادها.
type DispatchStats struct {
	Processed int `json:"processed"`
	Failed    int `json:"failed"`
	Skipped   int `json:"skipped"`
}

// Actor کاربر اقدام‌کننده.
type Actor struct {
	StaffID *int64
	Role    string
	UserID  int64
}

type dispatchIntent struct {
	processCode       string
	eventCode         string
	stepTitle         *string
	certificateNumber *string
	notifyUserID      int64
	notifyEvent       string
	notifyText        string
}

// AdvanceWorkflowStep پورت advanceWorkflowStep — همه در یک تراکنش با قفل سطری.
func (e *Engine) AdvanceWorkflowStep(ctx context.Context, requestID int64, actor Actor, action, note string) (*ActionResult, error) {
	now := time.Now()
	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// قفل سطری: دو اقدام همزمان روی یک پرونده پشت سر هم صف می‌شوند.
	var status string
	var processID int64
	var studentID int64
	var trackingCode string
	var currentStepID *int64
	var formData *string
	var certificateNumber *string
	err = tx.QueryRow(ctx, `
		select coalesce(status,'SUBMITTED'), "processId", "studentId", "trackingCode", "currentStepId", "formData", "certificateNumber"
		  from student_requests where id = $1 for update`, requestID).
		Scan(&status, &processID, &studentID, &trackingCode, &currentStepID, &formData, &certificateNumber)
	if err != nil {
		return nil, errors.New("درخواست یافت نشد.")
	}
	if terminalStatuses[status] {
		return &ActionResult{Result: &AdvanceResult{Status: "ALREADY_FINAL"}}, nil
	}

	var stepTitle, stepTimeoutRole *string
	var stepSLA *int
	var stepOrder int
	if currentStepID != nil {
		var s string
		var sla int
		var tr *string
		var ord int
		if err := tx.QueryRow(ctx, `
			select title, coalesce("slaHours",48), "timeoutEscalateToRole", "stepOrder"
			  from process_steps where id = $1`, *currentStepID).Scan(&s, &sla, &tr, &ord); err == nil {
			stepTitle, stepSLA, stepTimeoutRole, stepOrder = &s, &sla, tr, ord
		}
	}

	type stepRow struct {
		ID     int64
		Order  int
		Title  string
		Role   string
	}
	allSteps := []stepRow{}
	srows, err := tx.Query(ctx, `
		select id, "stepOrder", title, coalesce("roleCode",'USER')
		  from process_steps where "processId" = $1 order by "stepOrder"`, processID)
	if err != nil {
		return nil, err
	}
	for srows.Next() {
		var s stepRow
		if err := srows.Scan(&s.ID, &s.Order, &s.Title, &s.Role); err == nil {
			allSteps = append(allSteps, s)
		}
	}
	srows.Close()

	// بازترین لاگ پرونده.
	var lastLogID int64
	var lastAssigned *time.Time
	var lastAction *string
	var lastActorRole *string
	err = tx.QueryRow(ctx, `
		select id, "assignedAt", action, "actorRole" from request_step_logs
		 where "requestId" = $1 and "completedAt" is null
		 order by id desc, "assignedAt" desc limit 1`, requestID).
		Scan(&lastLogID, &lastAssigned, &lastAction, &lastActorRole)
	hasLastLog := err == nil

	durationMin := 0
	if hasLastLog && lastAssigned != nil {
		durationMin = int(now.Sub(*lastAssigned).Minutes() + 0.5)
		if durationMin < 0 {
			durationMin = 0
		}
	}
	// بستن لاگ مرحلهٔ جاری.
	if hasLastLog {
		slaBreached := stepSLA != nil && durationMin > *stepSLA*60
		slaStatus := "ON_TIME"
		if slaBreached {
			slaStatus = "SLA_BREACHED"
		}
		noteText := note
		if noteText == "" {
			if action == "APPROVE" {
				noteText = "تایید شد"
			} else {
				noteText = "رد شد"
			}
		}
		if _, err := tx.Exec(ctx, `
			update request_step_logs set "completedAt" = $2, "actorStaffId" = $3, "actorRole" = $4,
			  action = $5, note = $6, "durationMinutes" = $7, "slaStatus" = $8
			 where id = $1`, lastLogID, now, actor.StaffID, actor.Role, action, noteText, durationMin, slaStatus); err != nil {
			return nil, err
		}
	}

	var studentUserID int64
	_ = tx.QueryRow(ctx, `select "userId" from students where id = $1`, studentID).Scan(&studentUserID)

	processCode := ""
	_ = tx.QueryRow(ctx, `select coalesce(code,'') from process_definitions where id = $1`, processID).Scan(&processCode)

	var intent *dispatchIntent
	var result AdvanceResult

	switch action {
	case "REJECT":
		if _, err := tx.Exec(ctx, `update student_requests set status = 'REJECTED', "updatedAt" = $2 where id = $1`, requestID, now); err != nil {
			return nil, err
		}
		text := fmt.Sprintf("درخواست شما با کد رهگیری %s رد شد. دلیل: %s", trackingCode, fallback(note, "عدم احراز شرایط"))
		e.fireEvent(ctx, tx, requestID, processCode, "WORKFLOW_REJECTED", formData)
		result = AdvanceResult{Status: "REJECTED"}
		intent = &dispatchIntent{processCode: processCode, eventCode: "WORKFLOW_REJECTED", stepTitle: stepTitle,
			notifyUserID: studentUserID, notifyEvent: "REQUEST_REJECTED", notifyText: text}
	case "RETURN_FOR_REVISION":
		if _, err := tx.Exec(ctx, `update student_requests set status = 'RETURNED', "updatedAt" = $2 where id = $1`, requestID, now); err != nil {
			return nil, err
		}
		text := fmt.Sprintf("درخواست %s جهت اصلاح مدارک به شما بازگردانده شد: %s", trackingCode, fallback(note, "لطفاً فرم را ویرایش کنید."))
		e.fireEvent(ctx, tx, requestID, processCode, "WORKFLOW_RETURNED", formData)
		result = AdvanceResult{Status: "RETURNED"}
		intent = &dispatchIntent{processCode: processCode, eventCode: "WORKFLOW_RETURNED", stepTitle: stepTitle,
			notifyUserID: studentUserID, notifyEvent: "REQUEST_RETURNED", notifyText: text}
	case "ESCALATE":
		nextRole := "VICE_CHANCELLOR"
		if stepTimeoutRole != nil && *stepTimeoutRole != "" {
			nextRole = *stepTimeoutRole
		}
		// idempotent: اگر همین مرحله پیش‌تر ارجاع شده، دوباره ثبت نمی‌شود.
		if hasLastLog && lastAction != nil && *lastAction == "ESCALATE" {
			if lastActorRole != nil && *lastActorRole != "" {
				nextRole = *lastActorRole
			}
			return &ActionResult{Result: &AdvanceResult{Status: "ESCALATED", TargetRole: nextRole}}, nil
		}
		if _, err := tx.Exec(ctx, `update student_requests set status = 'IN_REVIEW', "updatedAt" = $2 where id = $1`, requestID, now); err != nil {
			return nil, err
		}
		var stepID int64
		if currentStepID != nil {
			stepID = *currentStepID
		} else if len(allSteps) > 0 {
			stepID = allSteps[0].ID
		}
		if _, err := tx.Exec(ctx, `
			insert into request_step_logs ("requestId","stepId","assignedAt","actorRole",action,note,"slaStatus")
			values ($1,$2,$3,$4,'ESCALATE',$5,'ESCALATED')`,
			requestID, stepID, now, nextRole,
			fmt.Sprintf("ارجاع مدیریتی پرونده به %s: %s", nextRole, fallback(note, "به دلیل عدم اقدام در مهلت یا نیاز به تصمیم مقام بالاتر"))); err != nil {
			return nil, err
		}
		result = AdvanceResult{Status: "ESCALATED", TargetRole: nextRole}
	default: // APPROVE
		var next *stepRow
		for i := range allSteps {
			if allSteps[i].Order > stepOrder {
				next = &allSteps[i]
				break
			}
		}
		if next != nil {
			if _, err := tx.Exec(ctx, `update student_requests set "currentStepId" = $2, status = 'IN_REVIEW', "updatedAt" = $3 where id = $1`,
				requestID, next.ID, now); err != nil {
				return nil, err
			}
			if _, err := tx.Exec(ctx, `
				insert into request_step_logs ("requestId","stepId","assignedAt","actorRole",action,note,"slaStatus")
				values ($1,$2,$3,$4,'ASSIGN',$5,'ON_TIME')`,
				requestID, next.ID, now, fallback(next.Role, "USER"),
				fmt.Sprintf("پرونده به مرحله «%s» ارجاع داده شد.", next.Title)); err != nil {
				return nil, err
			}
			e.fireEvent(ctx, tx, requestID, processCode, "WORKFLOW_STEP_MOVED", formData)
			result = AdvanceResult{Status: "MOVED_TO_NEXT_STEP", NextStepTitle: next.Title}
		} else {
			// آخرین مرحله → تأیید نهایی و اختتام پرونده
			h := sha256.Sum256([]byte(trackingCode + ":" + strconv.FormatInt(studentID, 10) + ":" + now.UTC().Format(time.RFC3339Nano) + ":AFAGH_FINAL"))
			digitalHash := hex.EncodeToString(h[:])
			cert := "DOC-" + trackingCode
			if certificateNumber != nil && *certificateNumber != "" {
				cert = *certificateNumber
			}
			if _, err := tx.Exec(ctx, `
				update student_requests set status = 'APPROVED', "digitalStampHash" = $2,
				  "certificateNumber" = $3, "issuedAt" = $4, "updatedAt" = $4 where id = $1`,
				requestID, digitalHash, cert, now); err != nil {
				return nil, err
			}
			e.fireEvent(ctx, tx, requestID, processCode, "WORKFLOW_FINAL_APPROVED", formData)
			text := fmt.Sprintf("درخواست شما با کد رهگیری %s به طور کامل تایید و نهایی گردید.", trackingCode)
			result = AdvanceResult{Status: "APPROVED_FINAL", CertificateNumber: cert}
			intent = &dispatchIntent{processCode: processCode, eventCode: "WORKFLOW_FINAL_APPROVED",
				stepTitle: stepTitle, certificateNumber: &cert,
				notifyUserID: studentUserID, notifyEvent: "REQUEST_APPROVED", notifyText: text}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	out := &ActionResult{Result: &result}
	if intent != nil {
		stats := e.DispatchAfterCommit(ctx, requestID, intent)
		out.Events = &stats
		if intent.notifyUserID > 0 && e.Notify != nil {
			e.Notify(ctx, intent.notifyUserID, intent.notifyEvent, intent.notifyText)
		}
	}
	return out, nil
}

func fallback(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

// ─────────────────── تسویهٔ موازی ───────────────────

// ClearCheckpointResult نتیجهٔ پاک‌کردن چک‌پوینت.
type ClearCheckpointResult struct {
	OK         bool           `json:"ok"`
	AllCleared bool           `json:"allCleared"`
	Advanced   *AdvanceResult `json:"advanced,omitempty"`
}

// ClearParallelCheckpoint پورت clearParallelCheckpoint — اتمی.
func (e *Engine) ClearParallelCheckpoint(ctx context.Context, checkpointID int64, clearedByStaffID *int64, notes string) (*ClearCheckpointResult, error) {
	now := time.Now()
	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var requestID int64
	err = tx.QueryRow(ctx, `select "requestId" from request_parallel_checkpoints where id = $1 for update`, checkpointID).Scan(&requestID)
	if err != nil {
		return nil, errors.New("چک‌پوینت تسویه یافت نشد.")
	}
	var reqStatus *string
	if err := tx.QueryRow(ctx, `select status from student_requests where id = $1 for update`, requestID).Scan(&reqStatus); err != nil {
		return nil, errors.New("درخواست مرتبط با چک‌پوینت یافت نشد.")
	}
	notesVal := notes
	if strings.TrimSpace(notesVal) == "" {
		notesVal = "تسویه حساب تایید گردید."
	}
	if _, err := tx.Exec(ctx, `
		update request_parallel_checkpoints set "isCleared" = 1, "clearedByStaffId" = $2,
		  "clearedAt" = $3, notes = $4 where id = $1`, checkpointID, clearedByStaffID, now, notesVal); err != nil {
		return nil, err
	}
	var total, cleared int
	if err := tx.QueryRow(ctx, `
		select count(*)::int, coalesce(sum(case when "isCleared" = 1 then 1 else 0 end),0)::int
		  from request_parallel_checkpoints where "requestId" = $1`, requestID).Scan(&total, &cleared); err != nil {
		return nil, err
	}
	done := total > 0 && cleared >= total
	out := &ClearCheckpointResult{OK: true, AllCleared: done}
	if done {
		advanced, err := e.advanceWithinTx(ctx, tx, requestID, Actor{StaffID: clearedByStaffID, Role: "MULTI_CHECKPOINT"},
			"APPROVE", "تمامی بخش‌های موازی تسویه حساب، تأیید شدند.", now)
		if err != nil {
			return nil, err
		}
		out.Advanced = advanced
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

// advanceWithinTx نسخهٔ درون‌تراکنشی پیشبرد (برای تسویهٔ موازی) — منطق اصلی
// با قفل سطری از پیش گرفته‌شده تکرار می‌شود تا تراکنش تودرتو نسازیم.
func (e *Engine) advanceWithinTx(ctx context.Context, tx pgx.Tx, requestID int64, actor Actor, action, note string, now time.Time) (*AdvanceResult, error) {
	var status string
	var processID int64
	var studentID int64
	var trackingCode string
	var currentStepID *int64
	var formData *string
	var certificateNumber *string
	err := tx.QueryRow(ctx, `
		select coalesce(status,'SUBMITTED'), "processId", "studentId", "trackingCode", "currentStepId", "formData", "certificateNumber"
		  from student_requests where id = $1`, requestID).
		Scan(&status, &processID, &studentID, &trackingCode, &currentStepID, &formData, &certificateNumber)
	if err != nil {
		return nil, errors.New("درخواست یافت نشد.")
	}
	if terminalStatuses[status] {
		return &AdvanceResult{Status: "ALREADY_FINAL"}, nil
	}
	var stepOrder int
	if currentStepID != nil {
		_ = tx.QueryRow(ctx, `select "stepOrder" from process_steps where id = $1`, *currentStepID).Scan(&stepOrder)
	}
	var nextID *int64
	var nextTitle, nextRole *string
	var nextOrder *int
	err = tx.QueryRow(ctx, `
		select id, title, coalesce("roleCode",'USER'), "stepOrder" from process_steps
		 where "processId" = $1 and "stepOrder" > $2 order by "stepOrder" limit 1`, processID, stepOrder).
		Scan(&nextID, &nextTitle, &nextRole, &nextOrder)
	if err == nil && nextID != nil {
		if _, err := tx.Exec(ctx, `update student_requests set "currentStepId" = $2, status = 'IN_REVIEW', "updatedAt" = $3 where id = $1`,
			requestID, *nextID, now); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `
			insert into request_step_logs ("requestId","stepId","assignedAt","actorRole",action,note,"slaStatus")
			values ($1,$2,$3,$4,'ASSIGN',$5,'ON_TIME')`,
			requestID, *nextID, now, *nextRole, fmt.Sprintf("پرونده به مرحله «%s» ارجاع داده شد.", *nextTitle)); err != nil {
			return nil, err
		}
		return &AdvanceResult{Status: "MOVED_TO_NEXT_STEP", NextStepTitle: *nextTitle}, nil
	}
	// آخرین مرحله
	h := sha256.Sum256([]byte(trackingCode + ":" + strconv.FormatInt(studentID, 10) + ":" + now.UTC().Format(time.RFC3339Nano) + ":AFAGH_FINAL"))
	cert := "DOC-" + trackingCode
	if certificateNumber != nil && *certificateNumber != "" {
		cert = *certificateNumber
	}
	if _, err := tx.Exec(ctx, `
		update student_requests set status = 'APPROVED', "digitalStampHash" = $2,
		  "certificateNumber" = $3, "issuedAt" = $4, "updatedAt" = $4 where id = $1`,
		requestID, hex.EncodeToString(h[:]), cert, now); err != nil {
		return nil, err
	}
	processCode := ""
	_ = tx.QueryRow(ctx, `select coalesce(code,'') from process_definitions where id = $1`, processID).Scan(&processCode)
	e.fireEvent(ctx, tx, requestID, processCode, "WORKFLOW_FINAL_APPROVED", formData)
	return &AdvanceResult{Status: "APPROVED_FINAL", CertificateNumber: cert}, nil
}

// ─────────────────── SLA ───────────────────

// SLAItem نتیجهٔ اقدام خودکار مهلت.
type SLAItem struct {
	RequestID    int64  `json:"requestId"`
	TrackingCode string `json:"trackingCode"`
	StepTitle    string `json:"stepTitle"`
	ActionTaken  string `json:"actionTaken"`
}

// CheckAndTriggerSLATimeouts پورت checkAndTriggerSlaTimeouts — قفل مشورتی.
func (e *Engine) CheckAndTriggerSLATimeouts(ctx context.Context) ([]SLAItem, error) {
	var got bool
	_ = e.Pool.QueryRow(ctx, `select pg_try_advisory_lock(hashtext('afagh:workflow:sla'))`).Scan(&got)
	if !got {
		return []SLAItem{}, nil
	}
	defer func() {
		_, _ = e.Pool.Exec(ctx, `select pg_advisory_unlock(hashtext('afagh:workflow:sla'))`)
	}()

	rows, err := e.Pool.Query(ctx, `
		select r.id, r."trackingCode", s.title, s."slaHours",
		       coalesce(s."timeoutAction",''), coalesce(s."timeoutEscalateToRole",'')
		  from student_requests r
		  join process_steps s on s.id = r."currentStepId"
		  join lateral (
		    select l2."assignedAt" from request_step_logs l2
		     where l2."requestId" = r.id and l2."completedAt" is null
		     order by l2.id desc limit 1
		  ) l on true
		 where r.status in ('SUBMITTED', 'IN_REVIEW', 'RETURNED')
		   and s."slaHours" is not null and s."slaHours" > 0
		   and l."assignedAt" is not null
		   and l."assignedAt" < (now() - (s."slaHours" || ' hours')::interval)
		 order by r.id`)
	if err != nil {
		return nil, err
	}
	type due struct {
		RequestID    int64
		TrackingCode string
		StepTitle    string
		SLAHours     int
		TimeoutAction string
		EscalateTo   string
	}
	list := []due{}
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.RequestID, &d.TrackingCode, &d.StepTitle, &d.SLAHours, &d.TimeoutAction, &d.EscalateTo); err == nil {
			list = append(list, d)
		}
	}
	rows.Close()

	results := []SLAItem{}
	for _, d := range list {
		action := strings.ToUpper(strings.TrimSpace(d.TimeoutAction))
		var taken, label string
		switch action {
		case "ESCALATE":
			taken, label = "ESCALATE", "ESCALATE TO "+fallback(d.EscalateTo, "VICE_CHANCELLOR")
		case "AUTO_APPROVE":
			taken, label = "APPROVE", "AUTO_APPROVE"
		case "AUTO_REJECT":
			taken, label = "REJECT", "AUTO_REJECT"
		default:
			continue
		}
		note := ""
		switch taken {
		case "ESCALATE":
			note = fmt.Sprintf("انقضای مهلت پاسخگویی (%d ساعت) — ارجاع خودکار سیستمی به %s", d.SLAHours, fallback(d.EscalateTo, "VICE_CHANCELLOR"))
		case "APPROVE":
			note = fmt.Sprintf("انقضای مهلت قانونی مرحله (%d ساعت) — تایید خودکار و عبور از مرحله به استناد آیین‌نامه تسریع امور", d.SLAHours)
		case "REJECT":
			note = fmt.Sprintf("انقضای مهلت قانونی مرحله (%d ساعت) — بسته‌شدن خودکار پرونده به دلیل عدم ارائه مدارک در مهلت", d.SLAHours)
		}
		if _, err := e.AdvanceWorkflowStep(ctx, d.RequestID, Actor{Role: "SYSTEM_SLA_ENGINE"}, taken, note); err != nil {
			continue
		}
		results = append(results, SLAItem{RequestID: d.RequestID, TrackingCode: d.TrackingCode, StepTitle: d.StepTitle, ActionTaken: label})
	}
	return results, nil
}

// ─────────────────── ذخیرهٔ فرایند ───────────────────

// SaveProcessInput ورودی ذخیرهٔ فرایند.
type SaveProcessInput struct {
	ID          int64         `json:"id"`
	Code        string        `json:"code"`
	Title       string        `json:"title"`
	Category    string        `json:"category"`
	Description string        `json:"description"`
	FeeAmount   float64       `json:"feeAmount"`
	FormSchema  []any         `json:"formSchema"`
	Steps       []ProcessStep `json:"steps"`
}

// SaveProcessDefinition پورت adminSaveProcessDefinitionAction.
func (e *Engine) SaveProcessDefinition(ctx context.Context, universityID *int64, in SaveProcessInput) (int64, error) {
	if universityID == nil {
		return 0, errors.New("دانشگاه فعال نامشخص است.")
	}
	schemaBytes, _ := json.Marshal(in.FormSchema)
	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	processID := in.ID
	if processID > 0 {
		var rowUni *int64
		if err := tx.QueryRow(ctx, `select "universityId" from process_definitions where id = $1`, processID).Scan(&rowUni); err != nil {
			return 0, errors.New("فرایند یافت نشد.")
		}
		if rowUni != nil && *rowUni != *universityID {
			return 0, errors.New("فرایند متعلق به دانشگاه دیگری است.")
		}
		if _, err := tx.Exec(ctx, `
			update process_definitions set title = $2, category = $3, description = $4,
			  "feeAmount" = $5, "formSchema" = $6
			 where id = $1 and ("universityId" = $7 or "universityId" is null)`,
			processID, in.Title, in.Category, in.Description, fmtNum(in.FeeAmount), string(schemaBytes), *universityID); err != nil {
			return 0, err
		}
	} else {
		err := tx.QueryRow(ctx, `
			insert into process_definitions ("universityId", code, title, category, description, "feeAmount", "formSchema")
			values ($1,$2,$3,$4,$5,$6,$7) returning id`,
			*universityID, in.Code, in.Title, in.Category, in.Description, fmtNum(in.FeeAmount), string(schemaBytes)).Scan(&processID)
		if err != nil {
			return 0, err
		}
	}
	// به‌روزرسانی گام‌ها — حذف و درج دسته‌جمعی در همان تراکنش.
	if _, err := tx.Exec(ctx, `delete from process_steps where "processId" = $1`, processID); err != nil {
		return 0, err
	}
	for _, s := range in.Steps {
		stepType := s.StepType
		switch stepType {
		case "USER", "AUTO_INTEGRATION", "PARALLEL_GATEWAY":
		default:
			stepType = "USER"
		}
		timeoutAction := s.TimeoutAction
		switch timeoutAction {
		case "ESCALATE", "AUTO_APPROVE", "AUTO_REJECT", "NOTIFY":
		default:
			timeoutAction = "ESCALATE"
		}
		var escalateTo *string
		if strings.TrimSpace(s.TimeoutEscalateToRole) != "" {
			v := strings.TrimSpace(s.TimeoutEscalateToRole)
			escalateTo = &v
		}
		if _, err := tx.Exec(ctx, `
			insert into process_steps ("processId","stepOrder",title,"stepType","roleCode","slaHours","timeoutAction","timeoutEscalateToRole")
			values ($1,$2,$3,$4,$5,$6,$7,$8)`,
			processID, s.StepOrder, s.Title, stepType, fallback(s.RoleCode, "USER"), maxInt(1, s.SLAHours), timeoutAction, escalateTo); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return processID, nil
}

func fmtNum(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func maxInt(a, b int) int { if a > b { return a }; return b }

// ─────────────────── ابزار ───────────────────

func truncRunes(v string, n int) string {
	if utf8.RuneCountInString(v) <= n {
		return v
	}
	r := []rune(v)
	return string(r[:n])
}

// AssertRequestUniversity درخواست باید متعلق به دانشگاه داده‌شده باشد (fail-closed).
func (e *Engine) AssertRequestUniversity(ctx context.Context, requestID, universityID int64) error {
	var reqUni, stuUni *int64
	if err := e.Pool.QueryRow(ctx, `
		select r."universityId", st."universityId"
		  from student_requests r left join students st on st.id = r."studentId"
		 where r.id = $1`, requestID).Scan(&reqUni, &stuUni); err != nil {
		return errors.New("درخواست یافت نشد.")
	}
	owner := reqUni
	if owner == nil {
		owner = stuUni
	}
	if owner != nil && *owner != universityID {
		return errors.New("درخواست متعلق به دانشگاه دیگری است.")
	}
	return nil
}

// CheckpointRequestID شناسهٔ درخواست یک چک‌پوینت.
func (e *Engine) CheckpointRequestID(ctx context.Context, checkpointID int64) (int64, error) {
	var reqID int64
	if err := e.Pool.QueryRow(ctx, `select "requestId" from request_parallel_checkpoints where id = $1`, checkpointID).Scan(&reqID); err != nil {
		return 0, errors.New("چک‌پوینت تسویه یافت نشد.")
	}
	return reqID, nil
}

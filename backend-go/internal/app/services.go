package app

import (
	"context"
	"strconv"

	"backend-go/internal/admin"
	"backend-go/internal/archive"
	"backend-go/internal/authn"
	"backend-go/internal/backup"
	"backend-go/internal/bi"
	"backend-go/internal/cron"
	"backend-go/internal/enroll"
	"backend-go/internal/graduation"
	"backend-go/internal/groupmanager"
	"backend-go/internal/httpapi"
	"backend-go/internal/messaging"
	"backend-go/internal/payroll"
	"backend-go/internal/professor"
	"backend-go/internal/reports"
	"backend-go/internal/session"
	"backend-go/internal/sessionlock"
	"backend-go/internal/student"
	"backend-go/internal/tuition"
	"backend-go/internal/workflow"
)

// buildServices constructs the domain services and their cross-wiring.
// HTTP adapters are built later in http.go; only engines live here.
func (a *App) buildServices() {
	// Phase 1: authentication stack.
	a.locks = sessionlock.New(a.Redis, a.settings)
	authCfg := authn.ConfigFromEnv()
	a.authSvc = authn.NewService(a.DB.Pool, authCfg, a.limiter, a.signer, a.locks)

	// Phase 3+: domain services.
	a.studentSvc = student.New(a.DB.Pool, a.scopeSvc, a.settings, a.signer)
	// The archive store is optional: without S3 the archive features degrade
	// to their no-storage paths (same behavior as the original wiring).
	a.backupSvc = backup.New(a.DB.Pool, "/tmp/backups")
	if ar, err := archive.New(a.Cfg.S3Endpoint, a.Cfg.S3AccessKey, a.Cfg.S3SecretKey, a.Cfg.S3Bucket); err == nil {
		a.studentSvc.Archive = ar
		a.archiveStore = ar
	}
	a.enrollSvc = enroll.NewService(a.DB, a.Redis, a.settings, a.scopeSvc, a.production)
	a.enrollSvc.StartWorker()
	a.professorSvc = professor.New(a.DB, a.settings, a.scopeSvc)
	a.professorSvc.Production = a.production
	a.gmSvc = groupmanager.New(a.DB, a.settings, a.scopeSvc)

	a.admin = admin.New(a.DB, a.scopeSvc)
	a.admin.SetStore(&settingsStoreAdapter{store: a.settings})
	a.adminAPI = &httpapi.AdminAPI{
		Svc: a.admin, Store: a.store,
		StudentFinance: a.studentSvc, Archive: a.archiveStore, Signer: a.signer,
	}
	a.adminAPI.Graduation = graduation.New(a.DB.Pool, a.settings, a.studentSvc)

	// Payroll engine + approval chain with DB-backed resolver closures.
	a.payrollEngine = payroll.New(a.DB.Pool, a.settings)
	a.payrollApprovals = payroll.NewApprovals(a.payrollEngine)
	a.payrollApprovals.StaffByUser = a.staffByUserClosure()
	a.payrollApprovals.HeadedDepts = a.headedDeptsClosure()
	a.payrollApprovals.CanActUni = a.canActUniClosure()

	a.biSvc = bi.New(a.DB.Pool, a.settings)
	a.adminAPI.BI = a.biSvc
	a.adminAPI.Reports = reports.New(a.DB.Pool, a.admin, a.payrollEngine, a.biSvc)
	a.adminAPI.Reports.Graduation = a.adminAPI.Graduation

	// Messaging: package-level default + background polling (skips channels
	// without tokens, so a nil Redis is fine here too).
	a.messagingSvc = messaging.New(a.DB.Pool, a.settings)
	messaging.Default = a.messagingSvc
	messaging.SetRateLimiter(a.limiter)
	go a.messagingSvc.StartAllPolling(a.Redis)
	a.adminAPI.Messaging = a.messagingSvc
	a.adminAPI.Pool = a.DB.Pool

	a.tuitionEngine = tuition.New(a.DB.Pool, a.settings)
	a.studentSvc.Tuition = a.tuitionEngine

	a.workflowEngine = workflow.New(a.DB.Pool, a.settings)
	a.workflowEngine.RegisterDefaultHandlers(a.tuitionEngine)
	a.workflowEngine.Notify = a.workflowNotify()

	a.cronEngine = cron.New(a.DB.Pool, a.settings, a.workflowEngine)
	cron.SetGraduationService(a.adminAPI.Graduation)
}

func (a *App) staffByUserClosure() func(context.Context, int64) (*payroll.StaffRef, error) {
	return func(ctx context.Context, userID int64) (*payroll.StaffRef, error) {
		var ref payroll.StaffRef
		err := a.DB.Pool.QueryRow(ctx,
			`select id, "departmentId", "universityId" from staff where "userId" = $1 limit 1`,
			userID).
			Scan(&ref.StaffID, &ref.DepartmentID, &ref.UniversityID)
		if err != nil {
			return nil, err
		}
		return &ref, nil
	}
}

func (a *App) headedDeptsClosure() func(context.Context, int64, *int64) ([]int64, error) {
	return func(ctx context.Context, staffID int64, ownDeptID *int64) ([]int64, error) {
		out := []int64{}
		rows, err := a.DB.Pool.Query(ctx,
			`select id from departments where "headStaffId" = $1 order by name`, staffID)
		if err == nil {
			for rows.Next() {
				var id int64
				if err := rows.Scan(&id); err == nil {
					out = append(out, id)
				}
			}
			rows.Close()
		}
		if len(out) == 0 && ownDeptID != nil {
			out = append(out, *ownDeptID)
		}
		return out, nil
	}
}

func (a *App) canActUniClosure() func(context.Context, *payroll.SessionUser, int64) bool {
	return func(ctx context.Context, u *payroll.SessionUser, universityID int64) bool {
		su := &session.User{ID: u.ID, Roles: u.Roles}
		return a.scopeSvc.CanActOnUniversity(ctx, su, &universityID)
	}
}

func (a *App) workflowNotify() func(context.Context, int64, string, string) {
	return func(ctx context.Context, userID int64, eventCode, text string) {
		payload := `{"text":` + strconv.Quote(text) + `}`
		_, _ = a.DB.Pool.Exec(ctx,
			`insert into notifications ("userId","eventCode",payload) values ($1,$2,$3)`,
			userID, eventCode, payload)
	}
}

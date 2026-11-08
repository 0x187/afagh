// ═══ Admin panel endpoints (phase 6) ═══
package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/admin"
	"backend-go/internal/archive"
	"backend-go/internal/bi"
	"backend-go/internal/graduation"
	"backend-go/internal/messaging"
	"backend-go/internal/reports"
	"backend-go/internal/scope"
	"backend-go/internal/session"
	"backend-go/internal/student"
	"backend-go/internal/verification"
)

// AdminAPI is the admin handlers.
type AdminAPI struct {
	Svc            *admin.Service
	Store          *session.Store
	StudentFinance *student.Service
	Archive        *archive.Store
	Reports        *reports.Service
	Graduation     *graduation.Service
	Signer         *verification.Signer
	BI             *bi.Service
	Messaging      *messaging.Service
	Pool           *pgxpool.Pool
}

func (a *AdminAPI) Register(r gin.IRouter) {
	r.GET("/admin/dashboard", a.dashboard)
	r.POST("/admin/requests/:id/decision", a.requestDecision)
	r.GET("/admin/students", a.students)
	r.POST("/admin/students/active", a.studentActive)
	r.POST("/admin/students/reset-password", a.studentResetPassword)
	r.GET("/admin/departments", a.departments)
	r.GET("/admin/staff", a.staff)
	r.GET("/admin/offerings", a.offerings)
	r.POST("/admin/offerings/window", a.offeringsWindow)
	r.POST("/admin/offerings/targeting", a.offeringsTargeting)
	r.POST("/admin/offerings/type", a.offeringsType)
	r.GET("/admin/evaluations", a.evaluations)
	r.POST("/admin/evaluations", a.createEvaluation)
	r.POST("/admin/evaluations/toggle", a.toggleEvaluation)
	r.POST("/admin/evaluations/delete", a.deleteEvaluation)
	r.GET("/admin/weekly-board", a.weeklyBoard)
	r.GET("/admin/settings", a.settings)
	r.POST("/admin/settings", a.saveSetting)
	r.POST("/admin/settings/reset", a.resetSetting)
	r.GET("/admin/classrooms", a.adminClassrooms)
	r.POST("/admin/classrooms", a.adminSaveClassroom)
	r.POST("/admin/classrooms/delete", a.adminDeleteClassroom)
	r.POST("/admin/classrooms/bulk", a.adminBulkClassrooms)
	r.GET("/admin/exams", a.exams)
	r.POST("/admin/exams/sessions", a.createExamSession)
	r.POST("/admin/exams/assign", a.assignExamSession)
	r.POST("/admin/exams/halls", a.createExamHall)
	r.POST("/admin/exams/seats", a.generateExamSeats)
	r.GET("/admin/attendance/manual", a.attendanceManual)
	r.POST("/admin/attendance/confirm", a.attendanceConfirm)
	r.POST("/admin/attendance/status", a.attendanceStatus)
	r.GET("/admin/attendance/control", a.attendanceControl)
	r.POST("/admin/attendance/record", a.attendanceRecord)
	r.GET("/admin/finance", a.financeStudents)
	r.GET("/admin/finance/student/:id", a.financeStudent)
	r.GET("/admin/finance/reports/options", a.financeReportOptions)
	r.POST("/admin/finance/reports/run", a.financeReportRun)
	r.POST("/admin/finance/reports/export", a.financeReportExport)
	r.GET("/admin/reports/options", a.financeReportOptions)
	r.POST("/admin/reports/run", a.financeReportRun)
	r.POST("/admin/reports/export", a.financeReportExport)
	r.GET("/admin/finance/reports/students", a.financeStatementStudents)
	r.GET("/admin/finance/reports/student-statement", a.financeStudentStatement)
	r.GET("/admin/warnings", a.warningsList)
	r.GET("/admin/warnings/students", a.warningsStudents)
	r.POST("/admin/warnings", a.warningsCreate)
	r.POST("/admin/warnings/update", a.warningsUpdate)
	r.POST("/admin/warnings/delete", a.warningsDelete)
	r.GET("/admin/graduation", a.graduationSeed)
	r.POST("/admin/graduation/scan", a.graduationScan)
	r.POST("/admin/graduation/list", a.graduationList)
	r.POST("/admin/graduation/dossier", a.graduationDossier)
	r.POST("/admin/graduation/head-approve", a.graduationHeadApprove)
	r.POST("/admin/graduation/hold", a.graduationHold)
	r.POST("/admin/graduation/resume", a.graduationResume)
	r.POST("/admin/graduation/irandoc", a.graduationIrandoc)
	r.POST("/admin/graduation/start-clearance", a.graduationStartClearance)
	r.POST("/admin/graduation/auto-clearance", a.graduationAutoClearance)
	r.POST("/admin/graduation/set-clearance", a.graduationSetClearance)
	r.POST("/admin/graduation/advance", a.graduationAdvance)
	r.POST("/admin/graduation/ministry-code", a.graduationMinistryCode)
	r.POST("/admin/graduation/waive-sajjad", a.graduationWaiveSajjad)
	r.POST("/admin/graduation/issue", a.graduationIssue)
	r.POST("/admin/graduation/deliver", a.graduationDeliver)
	r.POST("/admin/graduation/department/save", a.graduationDepartmentSave)
	r.POST("/admin/graduation/department/delete", a.graduationDepartmentDelete)
	r.POST("/admin/graduation/alumni/requests", a.graduationAlumniRequests)
	r.POST("/admin/graduation/alumni/resolve", a.graduationAlumniResolve)
	r.GET("/admin/student-cards", a.studentCardsList)
	r.POST("/admin/student-cards/issue", a.studentCardIssue)
	r.POST("/admin/student-cards/revoke", a.studentCardRevoke)
	r.GET("/admin/student-cards/print", a.studentCardPrint)
	r.GET("/photo/:userId", a.photo)
	r.GET("/admin/dorm", a.dormList)
	r.POST("/admin/dorm", a.dormCreate)
	r.POST("/admin/dorm/update", a.dormUpdate)
	r.POST("/admin/dorm/delete", a.dormDelete)
	r.GET("/admin/students/search", a.adminStudentSearch)
	r.GET("/admin/admissions", a.admissionsBundle)
	r.POST("/admin/admissions/stage", a.admissionsStage)
	r.POST("/admin/admissions/import", a.admissionsImport)
	r.POST("/admin/admissions/mapping", a.admissionsMapping)
	r.POST("/admin/admissions/formula", a.admissionsFormula)
	r.POST("/admin/admissions/manual", a.admissionsManual)
	r.POST("/admin/admissions/irandoc-test", a.admissionsIrandoc)
	r.GET("/admin/enrollment-approvals", a.enrollmentApprovals)
	r.POST("/admin/enrollment-approvals", a.enrollmentApprovalCreate)
	r.POST("/admin/enrollment-approvals/update", a.enrollmentApprovalUpdate)
	r.POST("/admin/enrollment-approvals/delete", a.enrollmentApprovalDelete)
	r.GET("/admin/enrollment-confirmation", a.enrollmentConfirmation)
	r.GET("/admin/offering-merge", a.offeringMergeGroups)
	r.POST("/admin/offering-merge/update", a.offeringMergeUpdate)
	r.GET("/admin/equivalence-clusters", a.equivalenceClusters)
	r.POST("/admin/equivalence-clusters", a.equivalenceClusterCreate)
	r.POST("/admin/equivalence-clusters/update", a.equivalenceClusterUpdate)
	r.POST("/admin/equivalence-clusters/delete", a.equivalenceClusterDelete)
	r.POST("/admin/equivalence-clusters/members", a.equivalenceClusterMembers)
	r.GET("/admin/manual-enroll/students", a.manualStudents)
	r.GET("/admin/manual-enroll/offerings", a.manualOfferings)
	r.GET("/admin/manual-enroll/catalog", a.manualCatalog)
	r.GET("/admin/manual-enroll/warnings", a.manualWarnings)
	r.GET("/admin/manual-enroll/history", a.manualHistory)
	r.POST("/admin/manual-enroll", a.manualEnroll)
	r.POST("/admin/manual-enroll/drop", a.manualDrop)
	r.POST("/admin/manual-enroll/bulk-count", a.manualBulkCount)
	r.POST("/admin/manual-enroll/bulk-enroll", a.manualBulkEnroll)
	r.POST("/admin/manual-enroll/bulk-drop", a.manualBulkDrop)
	r.POST("/admin/manual-enroll/activate-term", a.manualActivateTerm)
	r.GET("/admin/group-transfer/targets", a.transferTargets)
	r.GET("/admin/group-transfer/roster", a.transferRoster)
	r.GET("/admin/group-transfer/target-groups", a.transferTargetGroups)
	r.POST("/admin/group-transfer", a.transferStudent)
	r.GET("/admin/tuition-rules", a.tuitionRules)
	r.POST("/admin/tuition-rules", a.tuitionRuleSave)
	r.POST("/admin/tuition-rules/delete", a.tuitionRuleDelete)
	r.POST("/admin/tuition-rules/import-legacy", a.tuitionImportLegacy)
	r.POST("/admin/tuition-rules/equiv-mode", a.tuitionEquivMode)
	r.GET("/admin/tuition-tariff", a.tuitionTariff)
	r.POST("/admin/tuition-tariff/save", a.tuitionTariffSave)
	r.POST("/admin/tuition-tariff/copy", a.tuitionTariffCopy)
	r.GET("/admin/defense-scheduling", a.defenseBoard)
	r.POST("/admin/defense-scheduling/approve-proposal", a.defenseApproveProposal)
	r.POST("/admin/defense-scheduling/supervisor-approve", a.defenseSupervisorApprove)
	r.POST("/admin/defense-scheduling/schedule", a.defenseSchedule)
	r.POST("/admin/defense-scheduling/result", a.defenseRecordResult)
	r.POST("/admin/defense-scheduling/pool/save", a.defensePoolSave)
	r.POST("/admin/defense-scheduling/pool/toggle", a.defensePoolToggle)
	r.GET("/admin/short-courses", a.shortCourses)
	r.POST("/admin/short-courses", a.shortCourseCreate)
	r.POST("/admin/short-courses/learner", a.shortCourseAddLearner)
	r.POST("/admin/short-courses/registration/update", a.shortCourseUpdateRegistration)
	r.POST("/admin/short-courses/certificate", a.shortCourseIssueCertificate)
	r.POST("/admin/short-courses/certificate/revoke", a.shortCourseRevokeCertificate)
	r.POST("/admin/short-courses/status", a.shortCourseStatus)
	r.POST("/admin/short-courses/sync", a.shortCourseSync)
	r.GET("/admin/short-courses/discounts", a.shortCourseDiscounts)
	r.POST("/admin/short-courses/discounts", a.shortCourseDiscountCreate)
	r.POST("/admin/short-courses/discounts/toggle", a.shortCourseDiscountToggle)
	r.POST("/admin/short-courses/payment", a.shortCoursePayment)
	r.GET("/admin/lesson-plans", a.lessonPlansAdmin)
	r.POST("/admin/lesson-plans/settings", a.lessonPlansSettings)
	r.POST("/admin/regulation-check/scan", a.regulationScan)
	r.POST("/admin/regulation-check/apply", a.regulationApply)
	r.POST("/admin/regulation-check/status-scan", a.regulationStatusScan)
	r.GET("/admin/grade-status-codes", a.gradeStatusCodes)
	r.GET("/admin/curriculum/majors", a.curriculumMajors)
	r.GET("/admin/curriculum/departments", a.curriculumDepartments)
	r.GET("/admin/curriculum/degree-levels", a.curriculumDegreeLevels)
	r.GET("/admin/curriculum/clusters", a.curriculumClusters)
	r.GET("/admin/curriculum/versions", a.curriculumVersions)
	r.GET("/admin/curriculum/courses", a.curriculumCourses)
	r.GET("/admin/curriculum/offered", a.curriculumOffered)
	r.GET("/admin/curriculum/bank", a.curriculumBank)
	r.PATCH("/admin/curriculum/bank", a.curriculumBankUpdate)
	r.PATCH("/admin/curriculum/grade-codes", a.curriculumGradeCodes)
	r.GET("/admin/grade-thresholds", a.gradeThresholdsGet)
	r.POST("/admin/grade-thresholds", a.gradeThresholdsSave)
	r.GET("/admin/templates", a.templatesList)
	r.POST("/admin/templates", a.templatesSave)
	r.POST("/admin/templates/test", a.templatesTest)
	r.GET("/admin/curriculum/overview", a.curriculumOverview)
	r.GET("/admin/curriculum/versions/:id", a.curriculumDetail)
	r.POST("/admin/curriculum/validate", a.curriculumValidate)
	r.POST("/admin/curriculum/versions", a.curriculumCreate)
	r.POST("/admin/curriculum/versions/:id/meta", a.curriculumUpdateMeta)
	r.POST("/admin/curriculum/versions/:id/revision", a.curriculumRevision)
	r.POST("/admin/curriculum/versions/:id/submit", a.curriculumSubmit)
	r.POST("/admin/curriculum/versions/:id/approve", a.curriculumTransition("approve", "REVIEW", "APPROVED", "HEAD_APPROVE"))
	r.POST("/admin/curriculum/versions/:id/reject", a.curriculumTransition("reject", "REVIEW", "DRAFT", "REJECT"))
	r.POST("/admin/curriculum/versions/:id/publish", a.curriculumTransition("publish", "APPROVED", "PUBLISHED", "PUBLISH"))
	r.POST("/admin/curriculum/versions/:id/archive", a.curriculumTransition("archive", "PUBLISHED", "ARCHIVED", "ARCHIVE"))
	r.POST("/admin/curriculum/versions/:id/courses/add", a.curriculumAddCourse)
	r.POST("/admin/curriculum/versions/:id/courses/bulk", a.curriculumBulkAdd)
	r.POST("/admin/curriculum/versions/:id/courses/remove", a.curriculumRemoveCourse)
	r.POST("/admin/curriculum/versions/:id/courses/update", a.curriculumUpdateCourse)
	r.POST("/admin/curriculum/versions/:id/courses/semester", a.curriculumAssignSemester)
	r.POST("/admin/curriculum/versions/:id/courses/sync-roles", a.curriculumSyncRoles)
	r.POST("/admin/curriculum/versions/:id/courses/mark-grad", a.curriculumMarkGrad)
	r.POST("/admin/curriculum/versions/:id/rules/prereq", a.curriculumSetRule("PREREQ"))
	r.POST("/admin/curriculum/versions/:id/rules/coreq", a.curriculumSetRule("COREQ"))
	r.POST("/admin/curriculum/versions/:id/rules/passing-grade", a.curriculumPassingGrade)
	r.POST("/admin/curriculum/versions/:id/rules/grade-codes", a.curriculumCourseCodes)
	r.POST("/admin/curriculum/bank/new", a.curriculumBankNew)
	r.POST("/admin/curriculum/bank/edit", a.curriculumBankEdit)
	r.POST("/admin/sanjesh/preview", a.sanjeshPreview)
	r.POST("/admin/sanjesh/commit", a.sanjeshCommit)
	r.GET("/admin/bi", a.biDashboard)
	r.POST("/admin/bi/refresh-dashboards", a.biRefreshDashboards)
	r.POST("/admin/bi/refresh", a.biRefreshAll)
	r.POST("/admin/bi/invalidate", a.biInvalidate)
	r.GET("/admin/bi/status", a.biStatus)
	r.POST("/admin/bi/professor-panel", a.biProfessorPanel)
	r.POST("/admin/finance/adjust", a.financeAdjust)
	r.GET("/admin/course-finance", a.courseFinance)
	r.POST("/admin/course-finance", a.setCourseFinance)
	r.GET("/admin/finance/rules", a.financeRules)
	r.POST("/admin/finance/rules/discount-type", a.saveDiscountType)
	r.POST("/admin/finance/rules/discount-type/delete", a.deleteDiscountType)
	r.POST("/admin/finance/rules/sponsor", a.saveSponsor)
	r.POST("/admin/finance/rules/sponsor/delete", a.deleteSponsor)
	r.POST("/admin/finance/rules/loan-product", a.saveLoanProduct)
	r.POST("/admin/finance/rules/loan-product/delete", a.deleteLoanProduct)
	r.POST("/admin/finance/rules/formula", a.saveFormula)
	r.POST("/admin/finance/rules/formula/delete", a.deleteFormula)
	r.GET("/admin/discipline", a.disciplineList)
	r.GET("/admin/discipline/students", a.disciplineStudents)
	r.POST("/admin/discipline", a.disciplineCreate)
	r.POST("/admin/discipline/update", a.disciplineUpdate)
	r.POST("/admin/discipline/delete", a.disciplineDelete)
	r.GET("/admin/council", a.councilMeetings)
	r.POST("/admin/council", a.councilMeetingSave)
	r.POST("/admin/council/delete", a.councilMeetingDelete)
	r.GET("/admin/council/decisions", a.councilDecisions)
	r.POST("/admin/council/decisions", a.councilDecisionSave)
	r.POST("/admin/council/decisions/delete", a.councilDecisionDelete)
	r.GET("/admin/finance/student-formula", a.financeStudentFormula)
	r.POST("/admin/finance/student-formula", a.financeStudentFormulaCreate)
	r.POST("/admin/finance/student-formula/update", a.financeStudentFormulaUpdate)
	r.POST("/admin/finance/student-formula/delete", a.financeStudentFormulaDelete)
	r.GET("/admin/finance/welfare", a.financeWelfareFunds)
	r.GET("/admin/finance/welfare/loans", a.financeWelfareLoans)
	r.POST("/admin/finance/welfare", a.financeWelfareFundCreate)
	r.POST("/admin/finance/welfare/update", a.financeWelfareFundUpdate)
	r.POST("/admin/finance/welfare/delete", a.financeWelfareFundDelete)
	r.POST("/admin/finance/welfare/assign-loan", a.financeWelfareAssignLoan)
	r.GET("/admin/finance/time-control", a.financeTimeControl)
	r.POST("/admin/finance/time-control", a.financeTimeControlSave)
	r.GET("/admin/finance/coefficients", a.financeCoefficients)
	r.POST("/admin/finance/coefficients", a.financeCoefficientSave)
	r.POST("/admin/finance/coefficients/delete", a.financeCoefficientDelete)
	r.GET("/admin/finance/subject-fees", a.financeSubjectFees)
	r.POST("/admin/finance/subject-fees", a.financeSubjectFeeSave)
	r.POST("/admin/finance/subject-fees/delete", a.financeSubjectFeeDelete)
	r.GET("/admin/finance/subject-fees/assign", a.financeSubjectFeeAssignments)
	r.POST("/admin/finance/subject-fees/assign", a.financeSubjectFeeAssign)
	r.POST("/admin/finance/subject-fees/assign/delete", a.financeSubjectFeeAssignDelete)
	r.GET("/admin/archive/documents", a.archiveDocuments)
	r.POST("/admin/archive/verify", a.archiveVerify)
	r.POST("/admin/archive/upload", a.archiveUpload)
	r.GET("/admin/archive/file/:id", a.archiveFile)
	r.GET("/admin/pos/terminals", a.posTerminals)
	r.GET("/admin/pos/transactions", a.posTransactions)
	r.POST("/admin/pos/sale", a.posSale)
	r.POST("/admin/pos/void", a.posVoid)
}

var adminRoles = []string{
	"ADMIN", "EDU_EXPERT", "ARCHIVE_EXPERT", "GRADUATEAFFAIRS", "MILITARY_OFFICER",
	"FINANCE_EXPERT", "FINANCE", "VAULT_MANAGER", "VICE_EDU", "DEP_HEAD", "PROCTOR",
}

func (a *AdminAPI) requireAdmin(c *gin.Context) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	user, _ := a.Store.Get(c.Request.Context(), token, false)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	allowed := false
	for _, r := range user.Roles {
		for _, want := range adminRoles {
			if r == want {
				allowed = true
			}
		}
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی به پنل مدیریت مجاز نیست."})
		return nil
	}
	return user
}

func (a *AdminAPI) uniCookie(c *gin.Context) string {
	if v, err := c.Cookie(scope.UniversityCookie); err == nil {
		return v
	}
	return ""
}

func (a *AdminAPI) fail(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
}

func (a *AdminAPI) dashboard(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetDashboard(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) staff(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	rows, err := a.Svc.ListStaff(c.Request.Context(), user, a.uniCookie(c), strings.TrimSpace(c.Query("q")))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "rows": rows})
}

// ─────────────────── Disciplinary committee / council ───────────────────

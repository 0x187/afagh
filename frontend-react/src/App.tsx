import { Route, Routes } from 'react-router-dom';
import { lazy, Suspense, type ComponentType } from 'react';

// Route pages are code-split: every page below is a separate chunk that
// loads on first navigation. Shell and landing stay in the entry chunk.
function lazyNamed(load: () => Promise<Record<string, unknown>>, name: string) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}

const StudentSchedulePage = lazyNamed(() => import('@/routes/student/SchedulePage'), 'StudentSchedulePage');
const VirtualClassesAdminPage = lazyNamed(() => import('@/routes/admin/VirtualClassesAdminPage'), 'VirtualClassesAdminPage');
const GradeObjectionsPage = lazyNamed(() => import('@/routes/admin/GradeObjectionsPage'), 'GradeObjectionsPage');
const ExpertScopesPage = lazyNamed(() => import('@/routes/admin/ExpertScopesPage'), 'ExpertScopesPage');
const PermissionsPage = lazyNamed(() => import('@/routes/admin/PermissionsPage'), 'PermissionsPage');
const UniversitiesPage = lazyNamed(() => import('@/routes/admin/UniversitiesPage'), 'UniversitiesPage');
const SamaSyncPage = lazyNamed(() => import('@/routes/admin/SamaSyncPage'), 'SamaSyncPage');
const AdminReportsBuilderPage = lazyNamed(() => import('@/routes/admin/ReportsBuilderPage'), 'AdminReportsBuilderPage');
const AdminReportsSavedPage = lazyNamed(() => import('@/routes/admin/ReportsSavedPage'), 'AdminReportsSavedPage');
const AdminBackupPage = lazyNamed(() => import('@/routes/admin/BackupPage'), 'AdminBackupPage');
const AdminTermsPage = lazyNamed(() => import('@/routes/admin/TermsPage'), 'TermsPage');
const AdminGradesAuditPage = lazyNamed(() => import('@/routes/admin/GradesAuditPage'), 'GradesAuditPage');
const AdminSahamSettingsPage = lazyNamed(() => import('@/routes/admin/SahamSettingsPage'), 'AdminSahamSettingsPage');
const AdminCompliancePolicyPage = lazyNamed(() => import('@/routes/admin/CompliancePolicyPage'), 'AdminCompliancePolicyPage');
const AdminFinanceStudentDetailPage = lazyNamed(() => import('@/routes/admin/FinanceStudentDetailPage'), 'AdminFinanceStudentDetailPage');
const StudentDashboardPage = lazyNamed(() => import('@/routes/student/DashboardPage'), 'StudentDashboardPage');
const StudentTranscriptPage = lazyNamed(() => import('@/routes/student/TranscriptPage'), 'StudentTranscriptPage');
const StudentExamCardPage = lazyNamed(() => import('@/routes/student/ExamCardPage'), 'StudentExamCardPage');
const StudentEnrollPage = lazyNamed(() => import('@/routes/student/EnrollPage'), 'StudentEnrollPage');
const StudentEnrollConfirmPage = lazyNamed(() => import('@/routes/student/EnrollConfirmPage'), 'StudentEnrollConfirmPage');
const StudentVirtualClassesPage = lazyNamed(() => import('@/routes/student/VirtualClassesPage'), 'StudentVirtualClassesPage');
const StudentDocumentsPage = lazyNamed(() => import('@/routes/student/DocumentsPage'), 'StudentDocumentsPage');
const StudentLessonPlanPage = lazyNamed(() => import('@/routes/student/LessonPlanPage'), 'StudentLessonPlanPage');
const StudentRequestsPage = lazyNamed(() => import('@/routes/student/RequestsPage'), 'StudentRequestsPage');
const StudentFinancePage = lazyNamed(() => import('@/routes/student/FinancePage'), 'StudentFinancePage');
const StudentChartPage = lazyNamed(() => import('@/routes/student/ChartPage'), 'StudentChartPage');
const StudentGraduationPage = lazyNamed(() => import('@/routes/student/GraduationPage'), 'StudentGraduationPage');
const StudentThesisPage = lazyNamed(() => import('@/routes/student/ThesisPage'), 'StudentThesisPage');
const ProfessorDashboardPage = lazyNamed(() => import('@/routes/professor/DashboardPage'), 'ProfessorDashboardPage');
const ProfessorSchedulePage = lazyNamed(() => import('@/routes/professor/SchedulePage'), 'ProfessorSchedulePage');
const ProfessorContractPage = lazyNamed(() => import('@/routes/professor/ContractPage'), 'ProfessorContractPage');
const ProfessorDocumentsPage = lazyNamed(() => import('@/routes/professor/DocumentsPage'), 'ProfessorDocumentsPage');
const ProfessorBroadcastPage = lazyNamed(() => import('@/routes/professor/BroadcastPage'), 'ProfessorBroadcastPage');
const ProfessorAvailabilityPage = lazyNamed(() => import('@/routes/professor/AvailabilityPage'), 'ProfessorAvailabilityPage');
const ProfessorAttendancePage = lazyNamed(() => import('@/routes/professor/AttendancePage'), 'ProfessorAttendancePage');
const ProfessorGradesPage = lazyNamed(() => import('@/routes/professor/GradesPage'), 'ProfessorGradesPage');
const ProfessorEvaluationPage = lazyNamed(() => import('@/routes/professor/EvaluationPage'), 'ProfessorEvaluationPage');
const ProfessorPerformancePage = lazyNamed(() => import('@/routes/professor/PerformancePage'), 'ProfessorPerformancePage');
const ProfessorLessonPlanPage = lazyNamed(() => import('@/routes/professor/LessonPlanPage'), 'ProfessorLessonPlanPage');
const ProfessorPayrollPage = lazyNamed(() => import('@/routes/professor/PayrollPage'), 'ProfessorPayrollPage');
const GmCoursesPage = lazyNamed(() => import('@/routes/groupmanager/CoursesPage'), 'GmCoursesPage');
const GmOfferingsPage = lazyNamed(() => import('@/routes/groupmanager/OfferingsPage'), 'GmOfferingsPage');
const GmClassroomsPage = lazyNamed(() => import('@/routes/groupmanager/ClassroomsPage'), 'GmClassroomsPage');
const GmGrantsPage = lazyNamed(() => import('@/routes/groupmanager/GrantsPage'), 'GmGrantsPage');
const GmCompensatoryPage = lazyNamed(() => import('@/routes/groupmanager/CompensatoryPage'), 'GmCompensatoryPage');
const GmBypassPage = lazyNamed(() => import('@/routes/groupmanager/BypassPage'), 'GmBypassPage');
const GmEquivalencePage = lazyNamed(() => import('@/routes/groupmanager/EquivalencePage'), 'GmEquivalencePage');
const AdminDashboardPage = lazyNamed(() => import('@/routes/admin/DashboardPage'), 'AdminDashboardPage');
const AdminStudentsPage = lazyNamed(() => import('@/routes/admin/StudentsPage'), 'AdminStudentsPage');
const AdminDepartmentsPage = lazyNamed(() => import('@/routes/admin/DepartmentsPage'), 'AdminDepartmentsPage');
const AdminCodesPage = lazyNamed(() => import('@/routes/admin/CodesPage'), 'AdminCodesPage');
const AdminMigrationPage = lazyNamed(() => import('@/routes/admin/MigrationSahamSaminPages'), 'AdminMigrationPage');
const AdminSahamPage = lazyNamed(() => import('@/routes/admin/MigrationSahamSaminPages'), 'AdminSahamPage');
const AdminSaminPage = lazyNamed(() => import('@/routes/admin/MigrationSahamSaminPages'), 'AdminSaminPage');
const AdminCodeHubPage = lazyNamed(() => import('@/routes/admin/SmallAdminPages'), 'AdminCodeHubPage');
const AdminStudentFinancePage = lazyNamed(() => import('@/routes/admin/SmallAdminPages'), 'AdminStudentFinancePage');
const AdminLoginShowcasePage = lazyNamed(() => import('@/routes/admin/SmallAdminPages'), 'AdminLoginShowcasePage');
const AdminRegulationsPage = lazyNamed(() => import('@/routes/admin/SchedulingSuitePages'), 'AdminRegulationsPage');
const AdminEduExpertAssignPage = lazyNamed(() => import('@/routes/admin/SchedulingSuitePages'), 'AdminEduExpertAssignPage');
const AdminSchedulingPage = lazyNamed(() => import('@/routes/admin/SchedulingSuitePages'), 'AdminSchedulingPage');
const AdminBroadcastPage = lazyNamed(() => import('@/routes/admin/LastAdminPages'), 'AdminBroadcastPage');
const AdminBypassPage = lazyNamed(() => import('@/routes/admin/LastAdminPages'), 'AdminBypassPage');
const AdminClassSessionsPage = lazyNamed(() => import('@/routes/admin/LastAdminPages'), 'AdminClassSessionsPage');
const AdminExamHandoverPage = lazyNamed(() => import('@/routes/admin/LastAdminPages'), 'AdminExamHandoverPage');
const AdminOfferingEditorPage = lazyNamed(() => import('@/routes/admin/LastAdminPages'), 'AdminOfferingEditorPage');
const AdminScheduleConflictsPage = lazyNamed(() => import('@/routes/admin/LastAdminPages'), 'AdminScheduleConflictsPage');
const ExamHandoverPage = lazyNamed(() => import('@/routes/admin/PayrollSimulatorAndHandover'), 'ExamHandoverPage');
const PayrollSimulatorPage = lazyNamed(() => import('@/routes/admin/PayrollSimulatorAndHandover'), 'PayrollSimulatorPage');
const AdminStaffPage = lazyNamed(() => import('@/routes/admin/StaffPage'), 'AdminStaffPage');
const AdminOfferingsPage = lazyNamed(() => import('@/routes/admin/OfferingsPage'), 'AdminOfferingsPage');
const AdminEvaluationsPage = lazyNamed(() => import('@/routes/admin/EvaluationsPage'), 'AdminEvaluationsPage');
const AdminWeeklyBoardPage = lazyNamed(() => import('@/routes/admin/WeeklyBoardPage'), 'AdminWeeklyBoardPage');
const AdminSettingsPage = lazyNamed(() => import('@/routes/admin/SettingsPage'), 'AdminSettingsPage');
const AdminExamsPage = lazyNamed(() => import('@/routes/admin/ExamsPage'), 'AdminExamsPage');
const AdminManualAttendancePage = lazyNamed(() => import('@/routes/admin/AttendancePages'), 'AdminManualAttendancePage');
const AdminAttendanceControlPage = lazyNamed(() => import('@/routes/admin/AttendancePages'), 'AdminAttendanceControlPage');
const AdminFinancePage = lazyNamed(() => import('@/routes/admin/FinancePages'), 'AdminFinancePage');
const AdminStudentFinanceRoute = lazyNamed(() => import('@/routes/admin/FinancePages'), 'AdminStudentFinanceRoute');
const AdminCourseFinancePage = lazyNamed(() => import('@/routes/admin/FinancePages'), 'AdminCourseFinancePage');
const AdminFinanceReportsPage = lazyNamed(() => import('@/routes/admin/FinanceReportsPage'), 'AdminFinanceReportsPage');
const AdminStudentStatementPage = lazyNamed(() => import('@/routes/admin/StudentStatementPage'), 'AdminStudentStatementPage');
const AdminPayrollPage = lazyNamed(() => import('@/routes/admin/PayrollPage'), 'AdminPayrollPage');
const AdminFinanceRulesPage = lazyNamed(() => import('@/routes/admin/FinanceRulesPage'), 'AdminFinanceRulesPage');
const AdminPosPage = lazyNamed(() => import('@/routes/admin/PosPage'), 'AdminPosPage');
const AdminWorkflowsPage = lazyNamed(() => import('@/routes/admin/WorkflowsPage'), 'AdminWorkflowsPage');
const AdminArchivePage = lazyNamed(() => import('@/routes/admin/ArchivePage'), 'AdminArchivePage');
const PayrollCoveragePage = lazyNamed(() => import('@/routes/admin/PayrollExtraPages'), 'PayrollCoveragePage');
const PayrollRolesPage = lazyNamed(() => import('@/routes/admin/PayrollExtraPages'), 'PayrollRolesPage');
const TeachingRolesPage = lazyNamed(() => import('@/routes/admin/PayrollExtraPages'), 'TeachingRolesPage');
const PayrollDecreesPage = lazyNamed(() => import('@/routes/admin/PayrollDecreesPage'), 'PayrollDecreesPage');
const PayrollRegsObjectionsPage = lazyNamed(() => import('@/routes/admin/PayrollRegsObjectionsPage'), 'PayrollRegsObjectionsPage');
const PayrollOperationsPage = lazyNamed(() => import('@/routes/admin/PayrollOperationsPage'), 'PayrollOperationsPage');
const AdminFinanceAdvancedPage = lazyNamed(() => import('@/routes/admin/FinanceAdvancedPage'), 'AdminFinanceAdvancedPage');
const AdminWelfarePage = lazyNamed(() => import('@/routes/admin/FinanceWelfarePage'), 'AdminWelfarePage');
const AdminDisciplinePage = lazyNamed(() => import('@/routes/admin/DisciplinePage'), 'AdminDisciplinePage');
const AdminCouncilPage = lazyNamed(() => import('@/routes/admin/CouncilPage'), 'AdminCouncilPage');
const AdminWarningsPage = lazyNamed(() => import('@/routes/admin/WarningsPage'), 'AdminWarningsPage');
const AdminGraduationPage = lazyNamed(() => import('@/routes/admin/GraduationPage'), 'AdminGraduationPage');
const AdminStudentCardsPage = lazyNamed(() => import('@/routes/admin/StudentCardsPage'), 'AdminStudentCardsPage');
const StudentCardPrintPage = lazyNamed(() => import('@/routes/admin/StudentCardPrintPage'), 'StudentCardPrintPage');
const AdminDormPage = lazyNamed(() => import('@/routes/admin/DormPage'), 'AdminDormPage');
const AdminAdmissionsPage = lazyNamed(() => import('@/routes/admin/AdmissionsPage'), 'AdminAdmissionsPage');
const AdminEnrollmentApprovalsPage = lazyNamed(() => import('@/routes/admin/EnrollmentApprovalsPage'), 'AdminEnrollmentApprovalsPage');
const AdminEnrollmentConfirmationPage = lazyNamed(() => import('@/routes/admin/EnrollmentConfirmationPage'), 'AdminEnrollmentConfirmationPage');
const AdminCourseMergePage = lazyNamed(() => import('@/routes/admin/CourseMergePage'), 'AdminCourseMergePage');
const AdminEquivalenceClustersPage = lazyNamed(() => import('@/routes/admin/EquivalenceClustersPage'), 'AdminEquivalenceClustersPage');
const AdminManualEnrollPage = lazyNamed(() => import('@/routes/admin/ManualEnrollPage'), 'AdminManualEnrollPage');
const AdminGroupTransferPage = lazyNamed(() => import('@/routes/admin/GroupTransferPage'), 'AdminGroupTransferPage');
const AdminTuitionRulesPage = lazyNamed(() => import('@/routes/admin/TuitionRulesPage'), 'AdminTuitionRulesPage');
const AdminTuitionTariffPage = lazyNamed(() => import('@/routes/admin/TuitionTariffPage'), 'AdminTuitionTariffPage');
const AdminDefenseSchedulingPage = lazyNamed(() => import('@/routes/admin/DefenseSchedulingPage'), 'AdminDefenseSchedulingPage');
const AdminShortCoursesPage = lazyNamed(() => import('@/routes/admin/ShortCoursesPage'), 'AdminShortCoursesPage');
const AdminLessonPlansPage = lazyNamed(() => import('@/routes/admin/LessonPlansPage'), 'AdminLessonPlansPage');
const AdminRegulationCheckPage = lazyNamed(() => import('@/routes/admin/RegulationCheckPage'), 'AdminRegulationCheckPage');
const AdminGradeCodesPage = lazyNamed(() => import('@/routes/admin/GradeCodesPage'), 'AdminGradeCodesPage');
const AdminBiPage = lazyNamed(() => import('@/routes/admin/BiPage'), 'AdminBiPage');
const AdminSanjeshImportPage = lazyNamed(() => import('@/routes/admin/SanjeshImportPage'), 'AdminSanjeshImportPage');
const AdminEduReportsPage = lazyNamed(() => import('@/routes/admin/EduReportsPage'), 'AdminEduReportsPage');
const AdminCategoryPage = lazyNamed(() => import('@/routes/admin/CategoryPage'), 'AdminCategoryPage');
const AdminCurriculumPage = lazyNamed(() => import('@/routes/admin/CurriculumPage'), 'AdminCurriculumPage');
const AdminTemplatesPage = lazyNamed(() => import('@/routes/admin/TemplatesPage'), 'AdminTemplatesPage');
const NotFound = lazyNamed(() => import('@/routes/NotFound'), 'NotFound');
const ExamTicketPage = lazyNamed(() => import('@/routes/public/PublicVerifyPages'), 'ExamTicketPage');
const VerifyEnrollmentPage = lazyNamed(() => import('@/routes/public/PublicVerifyPages'), 'VerifyEnrollmentPage');
const VerifyFinancePage = lazyNamed(() => import('@/routes/public/PublicVerifyPages'), 'VerifyFinancePage');
const VerifyTranscriptPage = lazyNamed(() => import('@/routes/public/PublicVerifyPages'), 'VerifyTranscriptPage');
const StudentIdCardPage = lazyNamed(() => import('@/routes/public/PublicExtraPages'), 'StudentIdCardPage');
const VerifyCertificatePage = lazyNamed(() => import('@/routes/public/PublicExtraPages'), 'VerifyCertificatePage');
const VerifyDegreePage = lazyNamed(() => import('@/routes/public/PublicExtraPages'), 'VerifyDegreePage');
const OpenCoursesPage = lazyNamed(() => import('@/routes/public/OpenCoursesPage'), 'OpenCoursesPage');
const MessengerPage = lazyNamed(() => import('@/routes/public/MessengerPage'), 'MessengerPage');
const VerifyCodePage = lazyNamed(() => import('@/routes/public/PublicRestPages'), 'VerifyCodePage');
const VerifySearchPage = lazyNamed(() => import('@/routes/public/PublicRestPages'), 'VerifySearchPage');
const VerifyDocumentPage = lazyNamed(() => import('@/routes/public/PublicRestPages'), 'VerifyDocumentPage');
const VerifyDegreeSearchPage = lazyNamed(() => import('@/routes/public/PublicRestPages'), 'VerifyDegreeSearchPage');
const HelpPage = lazyNamed(() => import('@/routes/public/PublicRestPages'), 'HelpPage');
const ManualPage = lazyNamed(() => import('@/routes/public/PublicRestPages'), 'ManualPage');
const AlumniPage = lazyNamed(() => import('@/routes/public/PublicRestPages'), 'AlumniPage');
const ProctorPage = lazyNamed(() => import('@/routes/public/PublicRestPages'), 'ProctorPage');
const PublicProfilePage = lazyNamed(() => import('@/routes/public/PublicRestPages'), 'PublicProfilePage');

import { AppShell } from '@/components/shell/AppShell';
import { PwaRegister } from '@/components/shell/PwaRegister';
import { ChangePassword } from '@/routes/ChangePassword';
import { LoginPage } from '@/routes/login/LoginPage';
import { RoleLanding } from '@/routes/RoleLanding';

export function App() {
  return (
    <>
      <PwaRegister />
      <Suspense fallback={<div className="p-8 text-center text-xs text-muted-foreground">در حال بارگذاری…</div>}>
      <Routes>
        {/* Public routes (no shell/header) */}
        <Route path="login" element={<LoginPage />} />
        {/* Public inquiry pages (root, no shell/session) */}
        <Route path="verify-transcript/:token" element={<VerifyTranscriptPage />} />
        <Route path="verify-finance/:token" element={<VerifyFinancePage />} />
        <Route path="verify-enrollment/:token" element={<VerifyEnrollmentPage />} />
        <Route path="exam-ticket/:token" element={<ExamTicketPage />} />
        <Route path="id/:token" element={<StudentIdCardPage />} />
        <Route path="verify-degree" element={<VerifyDegreePage />} />
        <Route path="verify-degree/:code" element={<VerifyDegreePage />} />
        <Route path="verify-certificate" element={<VerifyCertificatePage />} />
        <Route path="verify-certificate/:code" element={<VerifyCertificatePage />} />
        <Route path="open-courses" element={<OpenCoursesPage />} />
        <Route path="messenger" element={<MessengerPage />} />
        <Route path="verify" element={<VerifySearchPage />} />
        <Route path="verify/search" element={<VerifySearchPage />} />
        <Route path="verify/:code" element={<VerifyCodePage />} />
        <Route path="verify/document/:hash" element={<VerifyDocumentPage />} />
        <Route path="verify-degree/search" element={<VerifyDegreeSearchPage />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="manual" element={<ManualPage />} />
        <Route path="alumni" element={<AlumniPage />} />
        <Route path="proctor" element={<ProctorPage />} />
        <Route path="p/:code" element={<PublicProfilePage />} />
        <Route path="exam-handover/:token" element={<ExamHandoverPage />} />
        <Route path="change-password" element={<ChangePassword />} />

        {/* Protected shell — the session guard is inside AppShell */}
        <Route element={<AppShell />}>
          <Route index element={<RoleLanding />} />
          <Route path="student" element={<StudentDashboardPage />} />
          <Route path="student/schedule" element={<StudentSchedulePage />} />
          <Route path="student/transcript" element={<StudentTranscriptPage />} />
          <Route path="student/exam-card" element={<StudentExamCardPage />} />
          <Route path="student/enroll" element={<StudentEnrollPage />} />
          <Route path="student/enroll-confirm" element={<StudentEnrollConfirmPage />} />
          <Route path="student/virtual-classes" element={<StudentVirtualClassesPage />} />
          <Route path="student/documents" element={<StudentDocumentsPage />} />
          <Route path="student/lesson-plan/:offeringId" element={<StudentLessonPlanPage />} />
          <Route path="student/requests" element={<StudentRequestsPage />} />
          <Route path="student/finance" element={<StudentFinancePage />} />
          <Route path="student/chart" element={<StudentChartPage />} />
          <Route path="student/graduation" element={<StudentGraduationPage />} />
          <Route path="student/thesis-proposal" element={<StudentThesisPage />} />
          <Route path="professor" element={<ProfessorDashboardPage />} />
          <Route path="professor/schedule" element={<ProfessorSchedulePage />} />
          <Route path="professor/contract" element={<ProfessorContractPage />} />
          <Route path="professor/documents" element={<ProfessorDocumentsPage />} />
          <Route path="professor/broadcast" element={<ProfessorBroadcastPage />} />
          <Route path="professor/availability" element={<ProfessorAvailabilityPage />} />
          <Route path="professor/attendance" element={<ProfessorAttendancePage />} />
          <Route path="professor/grades" element={<ProfessorGradesPage />} />
          <Route path="professor/evaluation" element={<ProfessorEvaluationPage />} />
          <Route path="professor/performance" element={<ProfessorPerformancePage />} />
          <Route path="professor/payroll" element={<ProfessorPayrollPage />} />
          <Route path="professor/lesson-plan" element={<ProfessorLessonPlanPage />} />
          <Route path="professor/lesson-plan/:offeringId" element={<ProfessorLessonPlanPage />} />
          <Route path="group-manager" element={<GmCoursesPage />} />
          <Route path="group-manager/courses" element={<GmCoursesPage />} />
          <Route path="group-manager/offerings" element={<GmOfferingsPage />} />
          <Route path="group-manager/classrooms" element={<GmClassroomsPage />} />
          <Route path="group-manager/grants" element={<GmGrantsPage />} />
          <Route path="group-manager/compensatory" element={<GmCompensatoryPage />} />
          <Route path="group-manager/bypass" element={<GmBypassPage />} />
          <Route path="group-manager/equivalence" element={<GmEquivalencePage />} />
          <Route path="admin" element={<AdminDashboardPage />} />
          <Route path="admin/students" element={<AdminStudentsPage />} />
          <Route path="admin/departments" element={<AdminDepartmentsPage />} />
          <Route path="admin/codes" element={<AdminCodesPage />} />
          <Route path="admin/migration" element={<AdminMigrationPage />} />
          <Route path="admin/saham" element={<AdminSahamPage />} />
          <Route path="admin/samin" element={<AdminSaminPage />} />
          <Route path="admin/code-hub" element={<AdminCodeHubPage />} />
          <Route path="admin/student-finance" element={<AdminStudentFinancePage />} />
          <Route path="admin/login-showcase" element={<AdminLoginShowcasePage />} />
          <Route path="admin/regulations" element={<AdminRegulationsPage />} />
          <Route path="admin/edu-expert-assign" element={<AdminEduExpertAssignPage />} />
          <Route path="admin/scheduling" element={<AdminSchedulingPage />} />
          <Route path="admin/broadcast" element={<AdminBroadcastPage />} />
          <Route path="admin/bypass" element={<AdminBypassPage />} />
          <Route path="admin/class-sessions" element={<AdminClassSessionsPage />} />
          <Route path="admin/exams/handover" element={<AdminExamHandoverPage />} />
          <Route path="admin/offering-editor" element={<AdminOfferingEditorPage />} />
          <Route path="admin/schedule-conflicts" element={<AdminScheduleConflictsPage />} />
          <Route path="admin/payroll/simulator" element={<PayrollSimulatorPage />} />
          <Route path="admin/staff" element={<AdminStaffPage />} />
          <Route path="admin/offerings" element={<AdminOfferingsPage />} />
          <Route path="admin/evaluations" element={<AdminEvaluationsPage />} />
          <Route path="admin/weekly-board" element={<AdminWeeklyBoardPage />} />
          <Route path="admin/settings" element={<AdminSettingsPage />} />
          <Route path="admin/exams" element={<AdminExamsPage />} />
          <Route path="admin/attendance-manual" element={<AdminManualAttendancePage />} />
          <Route path="admin/attendance-control" element={<AdminAttendanceControlPage />} />
          <Route path="admin/finance" element={<AdminFinancePage />} />
          <Route path="admin/finance/reports" element={<AdminFinanceReportsPage />} />
          <Route path="admin/finance/reports/student-statement" element={<AdminStudentStatementPage />} />
          <Route path="admin/finance/student/:id" element={<AdminFinanceStudentDetailPage />} />
          <Route path="admin/finance/student/:id/manage" element={<AdminStudentFinanceRoute />} />
          <Route path="admin/course-finance" element={<AdminCourseFinancePage />} />
          <Route path="admin/payroll" element={<AdminPayrollPage />} />
          <Route path="admin/payroll/roles" element={<PayrollRolesPage />} />
          <Route path="admin/payroll/teaching-roles" element={<TeachingRolesPage />} />
          <Route path="admin/payroll/coverage" element={<PayrollCoveragePage />} />
          <Route path="admin/payroll/decrees" element={<PayrollDecreesPage />} />
          <Route path="admin/payroll/regs-objections" element={<PayrollRegsObjectionsPage />} />
          <Route path="admin/payroll/operations" element={<PayrollOperationsPage />} />
          <Route path="admin/payroll/exam-payments" element={<PayrollOperationsPage />} />
          <Route path="admin/payroll/objections" element={<PayrollRegsObjectionsPage />} />
          <Route path="admin/payroll/regulations" element={<PayrollRegsObjectionsPage />} />
          <Route path="admin/payroll/thesis" element={<PayrollOperationsPage />} />
          <Route path="admin/finance/rules" element={<AdminFinanceRulesPage />} />
          <Route path="admin/finance/advanced" element={<AdminFinanceAdvancedPage />} />
          <Route path="admin/finance/student-formula" element={<AdminFinanceAdvancedPage />} />
          <Route path="admin/finance/time-control" element={<AdminFinanceAdvancedPage />} />
          <Route path="admin/finance/welfare" element={<AdminWelfarePage />} />
          <Route path="admin/finance/pos" element={<AdminPosPage />} />
          <Route path="admin/workflows" element={<AdminWorkflowsPage />} />
          <Route path="admin/archive" element={<AdminArchivePage />} />
          <Route path="admin/discipline" element={<AdminDisciplinePage />} />
          <Route path="admin/council" element={<AdminCouncilPage />} />
          <Route path="admin/warnings" element={<AdminWarningsPage />} />
          <Route path="admin/graduation" element={<AdminGraduationPage />} />
          <Route path="admin/student-cards" element={<AdminStudentCardsPage />} />
          <Route path="admin/student-cards/card/:studentId" element={<StudentCardPrintPage />} />
          <Route path="admin/dorm" element={<AdminDormPage />} />
          <Route path="admin/admissions" element={<AdminAdmissionsPage />} />
          <Route path="admin/enrollment-approvals" element={<AdminEnrollmentApprovalsPage />} />
          <Route path="admin/enrollment-confirmation" element={<AdminEnrollmentConfirmationPage />} />
          <Route path="admin/course-merge" element={<AdminCourseMergePage />} />
          <Route path="admin/equivalence-clusters" element={<AdminEquivalenceClustersPage />} />
          <Route path="admin/manual-enroll" element={<AdminManualEnrollPage />} />
          <Route path="admin/group-transfer" element={<AdminGroupTransferPage />} />
          <Route path="admin/tuition" element={<AdminTuitionRulesPage />} />
          <Route path="admin/tuition/tariff" element={<AdminTuitionTariffPage />} />
          <Route path="admin/defense-scheduling" element={<AdminDefenseSchedulingPage />} />
          <Route path="admin/short-courses" element={<AdminShortCoursesPage />} />
          <Route path="admin/lesson-plans" element={<AdminLessonPlansPage />} />
          <Route path="admin/regulation-check" element={<AdminRegulationCheckPage />} />
          <Route path="admin/grade-status-codes" element={<AdminGradeCodesPage />} />
          <Route path="admin/bi" element={<AdminBiPage />} />
          <Route path="admin/sanjesh-import" element={<AdminSanjeshImportPage />} />
          <Route path="admin/reports" element={<AdminEduReportsPage />} />
          <Route path="admin/reports/builder" element={<AdminReportsBuilderPage />} />
          <Route path="admin/reports/saved" element={<AdminReportsSavedPage />} />
          <Route path="admin/virtual-classes" element={<VirtualClassesAdminPage />} />
          <Route path="admin/grade-objections" element={<GradeObjectionsPage />} />
          <Route path="admin/expert-scopes" element={<ExpertScopesPage />} />
          <Route path="admin/permissions" element={<PermissionsPage />} />
          <Route path="admin/universities" element={<UniversitiesPage />} />
          <Route path="admin/sama-sync" element={<SamaSyncPage />} />
          <Route path="admin/backup" element={<AdminBackupPage />} />
          <Route path="admin/terms" element={<AdminTermsPage />} />
          <Route path="admin/grades/audit" element={<AdminGradesAuditPage />} />
          <Route path="admin/saham/settings" element={<AdminSahamSettingsPage />} />
          <Route path="admin/compliance-policy" element={<AdminCompliancePolicyPage />} />
          <Route path="admin/c/:group" element={<AdminCategoryPage />} />
          <Route path="admin/curriculum" element={<AdminCurriculumPage />} />
          <Route path="admin/templates" element={<AdminTemplatesPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
    </>
  );
}

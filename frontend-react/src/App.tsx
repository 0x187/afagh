import { Route, Routes } from 'react-router-dom';

import { AppShell } from '@/components/shell/AppShell';
import { PwaRegister } from '@/components/shell/PwaRegister';
import { ChangePassword } from '@/routes/ChangePassword';
import { LoginPage } from '@/routes/login/LoginPage';
import { Home } from '@/routes/Home';
import { StudentSchedulePage } from '@/routes/student/SchedulePage';
import { StudentDashboardPage } from '@/routes/student/DashboardPage';
import { StudentTranscriptPage } from '@/routes/student/TranscriptPage';
import { StudentExamCardPage } from '@/routes/student/ExamCardPage';
import { StudentEnrollPage } from '@/routes/student/EnrollPage';
import { StudentEnrollConfirmPage } from '@/routes/student/EnrollConfirmPage';
import { StudentVirtualClassesPage } from '@/routes/student/VirtualClassesPage';
import { StudentDocumentsPage } from '@/routes/student/DocumentsPage';
import { StudentLessonPlanPage } from '@/routes/student/LessonPlanPage';
import { StudentRequestsPage } from '@/routes/student/RequestsPage';
import { StudentFinancePage } from '@/routes/student/FinancePage';
import { StudentChartPage } from '@/routes/student/ChartPage';
import { StudentGraduationPage } from '@/routes/student/GraduationPage';
import { StudentThesisPage } from '@/routes/student/ThesisPage';
import { ProfessorDashboardPage } from '@/routes/professor/DashboardPage';
import { ProfessorSchedulePage } from '@/routes/professor/SchedulePage';
import { ProfessorContractPage } from '@/routes/professor/ContractPage';
import { ProfessorDocumentsPage } from '@/routes/professor/DocumentsPage';
import { ProfessorBroadcastPage } from '@/routes/professor/BroadcastPage';
import { ProfessorAvailabilityPage } from '@/routes/professor/AvailabilityPage';
import { ProfessorAttendancePage } from '@/routes/professor/AttendancePage';
import { ProfessorGradesPage } from '@/routes/professor/GradesPage';
import { ProfessorEvaluationPage } from '@/routes/professor/EvaluationPage';
import { ProfessorPerformancePage } from '@/routes/professor/PerformancePage';
import { ProfessorLessonPlanPage } from '@/routes/professor/LessonPlanPage';
import { ProfessorPayrollPage } from '@/routes/professor/PayrollPage';
import { GmCoursesPage } from '@/routes/groupmanager/CoursesPage';
import { GmOfferingsPage } from '@/routes/groupmanager/OfferingsPage';
import { GmClassroomsPage } from '@/routes/groupmanager/ClassroomsPage';
import { GmGrantsPage } from '@/routes/groupmanager/GrantsPage';
import { GmCompensatoryPage } from '@/routes/groupmanager/CompensatoryPage';
import { GmBypassPage } from '@/routes/groupmanager/BypassPage';
import { GmEquivalencePage } from '@/routes/groupmanager/EquivalencePage';
import { AdminDashboardPage } from '@/routes/admin/DashboardPage';
import { AdminStudentsPage } from '@/routes/admin/StudentsPage';
import { AdminDepartmentsPage } from '@/routes/admin/DepartmentsPage';
import { AdminStaffPage } from '@/routes/admin/StaffPage';
import { AdminOfferingsPage } from '@/routes/admin/OfferingsPage';
import { AdminEvaluationsPage } from '@/routes/admin/EvaluationsPage';
import { AdminWeeklyBoardPage } from '@/routes/admin/WeeklyBoardPage';
import { AdminSettingsPage } from '@/routes/admin/SettingsPage';
import { AdminExamsPage } from '@/routes/admin/ExamsPage';
import { AdminManualAttendancePage, AdminAttendanceControlPage } from '@/routes/admin/AttendancePages';
import { AdminFinancePage, AdminStudentFinanceRoute, AdminCourseFinancePage } from '@/routes/admin/FinancePages';
import { AdminFinanceReportsPage } from '@/routes/admin/FinanceReportsPage';
import { AdminStudentStatementPage } from '@/routes/admin/StudentStatementPage';
import { AdminPayrollPage } from '@/routes/admin/PayrollPage';
import { AdminFinanceRulesPage } from '@/routes/admin/FinanceRulesPage';
import { AdminPosPage } from '@/routes/admin/PosPage';
import { AdminWorkflowsPage } from '@/routes/admin/WorkflowsPage';
import { AdminArchivePage } from '@/routes/admin/ArchivePage';
import { PayrollCoveragePage, PayrollRolesPage, TeachingRolesPage } from '@/routes/admin/PayrollExtraPages';
import { PayrollDecreesPage } from '@/routes/admin/PayrollDecreesPage';
import { PayrollRegsObjectionsPage } from '@/routes/admin/PayrollRegsObjectionsPage';
import { PayrollOperationsPage } from '@/routes/admin/PayrollOperationsPage';
import { AdminFinanceAdvancedPage } from '@/routes/admin/FinanceAdvancedPage';
import { AdminWelfarePage } from '@/routes/admin/FinanceWelfarePage';
import { AdminDisciplinePage } from '@/routes/admin/DisciplinePage';
import { AdminCouncilPage } from '@/routes/admin/CouncilPage';
import { AdminWarningsPage } from '@/routes/admin/WarningsPage';
import { AdminGraduationPage } from '@/routes/admin/GraduationPage';
import { AdminStudentCardsPage } from '@/routes/admin/StudentCardsPage';
import { StudentCardPrintPage } from '@/routes/admin/StudentCardPrintPage';
import { AdminDormPage } from '@/routes/admin/DormPage';
import { AdminAdmissionsPage } from '@/routes/admin/AdmissionsPage';
import { AdminEnrollmentApprovalsPage } from '@/routes/admin/EnrollmentApprovalsPage';
import { AdminEnrollmentConfirmationPage } from '@/routes/admin/EnrollmentConfirmationPage';
import { AdminCourseMergePage } from '@/routes/admin/CourseMergePage';
import { AdminEquivalenceClustersPage } from '@/routes/admin/EquivalenceClustersPage';
import { AdminManualEnrollPage } from '@/routes/admin/ManualEnrollPage';
import { AdminGroupTransferPage } from '@/routes/admin/GroupTransferPage';
import { AdminTuitionRulesPage } from '@/routes/admin/TuitionRulesPage';
import { AdminTuitionTariffPage } from '@/routes/admin/TuitionTariffPage';
import { AdminDefenseSchedulingPage } from '@/routes/admin/DefenseSchedulingPage';
import { AdminShortCoursesPage } from '@/routes/admin/ShortCoursesPage';
import { AdminLessonPlansPage } from '@/routes/admin/LessonPlansPage';
import { AdminRegulationCheckPage } from '@/routes/admin/RegulationCheckPage';
import { AdminGradeCodesPage } from '@/routes/admin/GradeCodesPage';
import { AdminBiPage } from '@/routes/admin/BiPage';
import { AdminSanjeshImportPage } from '@/routes/admin/SanjeshImportPage';
import { NotFound } from '@/routes/NotFound';
import { ExamTicketPage, VerifyEnrollmentPage, VerifyFinancePage, VerifyTranscriptPage } from '@/routes/public/PublicVerifyPages';
import { StudentIdCardPage, VerifyCertificatePage, VerifyDegreePage } from '@/routes/public/PublicExtraPages';
import { OpenCoursesPage } from '@/routes/public/OpenCoursesPage';

export function App() {
  return (
    <>
      <PwaRegister />
      <Routes>
        {/* مسیرهای عمومی (بدون شل/سربرگ) */}
        <Route path="login" element={<LoginPage />} />
        {/* صفحات استعلام عمومی (ریشه، بدون شل/نشست) */}
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
        <Route path="change-password" element={<ChangePassword />} />

        {/* شل محافظت‌شده — گارد نشست داخل AppShell است */}
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
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
          <Route path="admin/finance/student/:id" element={<AdminStudentFinanceRoute />} />
          <Route path="admin/course-finance" element={<AdminCourseFinancePage />} />
          <Route path="admin/payroll" element={<AdminPayrollPage />} />
          <Route path="admin/payroll/roles" element={<PayrollRolesPage />} />
          <Route path="admin/payroll/teaching-roles" element={<TeachingRolesPage />} />
          <Route path="admin/payroll/coverage" element={<PayrollCoveragePage />} />
          <Route path="admin/payroll/decrees" element={<PayrollDecreesPage />} />
          <Route path="admin/payroll/regs-objections" element={<PayrollRegsObjectionsPage />} />
          <Route path="admin/payroll/operations" element={<PayrollOperationsPage />} />
          <Route path="admin/finance/rules" element={<AdminFinanceRulesPage />} />
          <Route path="admin/finance/advanced" element={<AdminFinanceAdvancedPage />} />
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
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}

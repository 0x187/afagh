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
import { NotFound } from '@/routes/NotFound';

export function App() {
  return (
    <>
      <PwaRegister />
      <Routes>
        {/* مسیرهای عمومی (بدون شل/سربرگ) */}
        <Route path="login" element={<LoginPage />} />
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
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}

'use client';

// ═══════════════════════════════════════════════════════════════════════
//  پوستهٔ کارتابل — فقط می‌داند «کدام تب باز است» و قطعات را کنار هم می‌چیند.
//  هیچ state و هیچ محاسبه‌ای اینجا نیست.
// ═══════════════════════════════════════════════════════════════════════
import { usePlanning } from '../PlanningProvider';
import PlanningToast from './PlanningToast';
import PlanningHeader from './PlanningHeader';
import PlanningTabsBar from './PlanningTabsBar';
import ProgramScopeTab from './ProgramScopeTab';
import CurriculumAssignTab from './CurriculumAssignTab';
import ProfessorQuotasTab from './ProfessorQuotasTab';
import DeptRoomsTab from './DeptRoomsTab';
import SmartAssignTab from './SmartAssignTab';
import WeeklyMatrixTab from './WeeklyMatrixTab';
import ApprovedTab from './ApprovedTab';
import TermCalendarTab from './TermCalendarTab';
import ProfAvailabilityModal from './ProfAvailabilityModal';

export default function PlanningShell() {
  const { activeMainTab } = usePlanning();
  return (
    <div className="min-h-screen bg-sky-50/70 text-slate-800 p-3 sm:p-6 space-y-5" dir="rtl">
      <PlanningToast />
      <PlanningHeader />
      <PlanningTabsBar />

      {activeMainTab === 'PROGRAM_SCOPE' && <ProgramScopeTab />}
      {activeMainTab === 'CURRICULUM_ASSIGN' && <CurriculumAssignTab />}
      {activeMainTab === 'PROF_QUOTAS' && <ProfessorQuotasTab />}
      {activeMainTab === 'DEPT_ROOMS' && <DeptRoomsTab />}
      {activeMainTab === 'SCENARIOS' && <SmartAssignTab />}
      {activeMainTab === 'PROFESSOR_SCHEDULE' && <WeeklyMatrixTab />}
      {activeMainTab === 'APPROVED' && <ApprovedTab />}
      {activeMainTab === 'TERM_CALENDAR' && <TermCalendarTab />}

      <ProfAvailabilityModal />
    </div>
  );
}

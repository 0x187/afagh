'use client';

// ════════════════════════════════════════════════════════════════════════
//  پوستهٔ ماژول برنامهٔ درسی — ترتیب چیدمان قطعات، بدون state و بدون محاسبه.
//  هر بلوک شرطِ رندر خودش را داخل فایل خودش نگه داشته (رفتار قبلی، عیناً).
// ════════════════════════════════════════════════════════════════════════
import CurriculumToast from './CurriculumToast';
import CurriculumHeader from './CurriculumHeader';
import CurriculumTabsBar from './CurriculumTabsBar';
import CatalogTab from './CatalogTab';
import VersionDetailPanel from './VersionDetailPanel';
import NewVersionModal from './NewVersionModal';
import EditVersionModal from './EditVersionModal';
import NewCourseModal from './NewCourseModal';
import CourseRulesModal from './CourseRulesModal';
import AddCourseModal from './AddCourseModal';
import RejectModal from './RejectModal';

export default function CurriculumShell() {
  return (
    <div className="curriculum-shell min-h-screen bg-sky-50/70 text-slate-800 p-3 sm:p-6 space-y-5" dir="rtl">
      <CurriculumToast />
      {/* سربرگ و تب‌ها در چاپ حذف می‌شوند تا فقط چارت روی کاغذ بیاید */}
      <div className="print:hidden space-y-5">
        <CurriculumHeader />
        <CurriculumTabsBar />
      </div>
      <CatalogTab />
      <VersionDetailPanel />
      <NewVersionModal />
      <EditVersionModal />
      <NewCourseModal />
      <CourseRulesModal />
      <AddCourseModal />
      <RejectModal />
    </div>
  );
}

/**
 * تست رندر مستقل هر قطعهٔ UI پنل برنامهٔ درسی — بدون React Server، بدون DB
 *
 * اجرا: npm test
 * چرا: پس از شکستن مگاکامپوننت ۱۸۳۱ سطری به ۱۷ فایل، باید مطمئن شویم هر فایل
 *   (۱) مستقل import می‌شود، (۲) با همان context می‌سازد، (۳) JSX‌اش بدون خطا
 *   رندر می‌شود و محتوای درستش را نشان می‌دهد — نه فقط «کامپایل می‌شود».
 * رندر با react-dom/server انجام می‌شود و context ساختگی؛ هیچ اکشن/DB‌ای صدا
 * زده نمی‌شود (کامپوننت‌ها فقط مصرف‌کنندهٔ context‌اند).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { CurriculumCtx } from '../src/app/admin/curriculum/curriculum-context.ts';
import { leafCourseCodesOf, leafTotalOf, dependencyWarningsMap } from '../src/app/admin/curriculum/curriculum-core.ts';
import AddCourseModal from '../src/app/admin/curriculum/components/AddCourseModal.tsx';
import CatalogTab from '../src/app/admin/curriculum/components/CatalogTab.tsx';
import CourseRulesModal from '../src/app/admin/curriculum/components/CourseRulesModal.tsx';
import CoursesTab from '../src/app/admin/curriculum/components/CoursesTab.tsx';
import CurriculumHeader from '../src/app/admin/curriculum/components/CurriculumHeader.tsx';
import CurriculumShell from '../src/app/admin/curriculum/components/CurriculumShell.tsx';
import CurriculumTabsBar from '../src/app/admin/curriculum/components/CurriculumTabsBar.tsx';
import CurriculumToast from '../src/app/admin/curriculum/components/CurriculumToast.tsx';
import DetailHeaderBar from '../src/app/admin/curriculum/components/DetailHeaderBar.tsx';
import NewCourseModal from '../src/app/admin/curriculum/components/NewCourseModal.tsx';
import NewVersionModal from '../src/app/admin/curriculum/components/NewVersionModal.tsx';
import RejectModal from '../src/app/admin/curriculum/components/RejectModal.tsx';
import RoleTargetsEditor from '../src/app/admin/curriculum/components/RoleTargetsEditor.tsx';
import SemestersTab from '../src/app/admin/curriculum/components/SemestersTab.tsx';
import TransferTab from '../src/app/admin/curriculum/components/TransferTab.tsx';
import VerifyTab from '../src/app/admin/curriculum/components/VerifyTab.tsx';
import VersionDetailPanel from '../src/app/admin/curriculum/components/VersionDetailPanel.tsx';

const noop = () => {};
const courses = [
  { courseId: 21, code: 'CM101', title: 'مبانی برنامه‌سازی', units: 3, roleType: 'CORE', isRequired: 1, isElective: 0, isGraduationRequired: 0, recommendedSemester: 1, minGrade: null, passGradeStatusCode: null, failGradeStatusCode: null },
  { courseId: 22, code: 'CM102', title: 'ساختار داده', units: 3, roleType: 'GENERAL', isRequired: 0, isElective: 1, isGraduationRequired: 0, recommendedSemester: null, minGrade: 10, passGradeStatusCode: null, failGradeStatusCode: null },
];
const detail = {
  version: { id: 10, majorId: 1, degreeLevelId: 2, trackId: 1, versionCode: '1402-1', title: 'برنامهٔ کارشناسی ۱۴۰۲', status: 'DRAFT', entryYearFrom: 1402, entryYearTo: null, totalRequiredUnits: '140', courseCount: 2, maxUnitsPerTerm: 24, minRoleUnits: { CORE: 60, GENERAL: 20 } },
  courses,
  rules: [{ courseId: 22, ruleType: 'PREREQ', logicTree: { operator: 'AND', conditions: [{ course: 'CM101' }] } }],
  approvals: [{ id: 1, approvalType: 'DRAFT_SAVED', fromStatus: 'DRAFT', toStatus: 'DRAFT', decisionNote: 'پیش‌نویس اولیه', approvedAt: '2025-01-01T00:00:00Z' }],
  checks: [{ check: 'UNITS_TOTAL', severity: 'WARN' as const, message: 'جمع واحدها از سقف واحد ترم کمتر است', affected: [21, 22] }],
};
const majors = [{ id: 1, code: 'CM', name: 'مهندسی کامپیوتر', degreeLevelId: 2, degreeTitle: 'کارشناسی ناپیوسته', degreeCode: 'AA', degreeTermCount: 4, degreeIsGraduate: 0, facultyName: 'دانشکدهٔ فنی', departmentName: 'گروه کامپیوتر', minUnits: 140, tracks: ['سخت‌افزار'] }];
const versions = [detail.version];
const bank = [
  { id: 21, code: 'CM101', title: 'مبانی برنامه‌سازی', units: '3', courseType: 'اصلی' },
  { id: 22, code: 'CM102', title: 'ساختار داده', units: '3', courseType: 'عمومی' },
];

function ctx(extra: Record<string, unknown> = {}) {
  return {
    majors, versions, tracks: [{ id: 1, code: 'AA', title: 'سخت‌افزار' }],
    selectedMajorId: 1, setSelectedMajorId: noop, selectedVersionId: 10, setSelectedVersionId: noop,
    selectedVersion: detail.version, majorVersions: versions,
    detail, setDetail: noop, detailLoading: false,
    bank, setBank: noop, bankLoading: false, bankQuery: '', setBankQuery: noop, codePrefix: '', setCodePrefix: noop,
    bankSelected: new Set([21]), setBankSelected: noop, bankRoles: { 22: 'MAJOR' }, setBankRoles: noop,
    bulkRoleType: 'CORE', setBulkRoleType: noop, bankFiltered: bank, bankVisible: bank, allFilteredSelected: false,
    roleForBank: (b: { id: number; courseType: string }) => (b.id === 21 ? 'CORE' : 'GENERAL'),
    toggleSelectAllBank: noop, closeAddCourse: noop, handleAddCourse: noop, handleBulkAddCourses: noop,
    modal: null as string | null, setModal: noop, busy: false, toast: { text: 'نسخه ذخیره شد', type: 'success' as const }, showToast: noop,
    handleSyncRequisites: noop,
    newVersionForm: { versionCode: '1404-1', title: 'برنامهٔ ۱۴۰۴', entryYearFrom: 1404, totalRequiredUnits: 140, maxUnitsPerTerm: 24, cloneFromId: '' },
    setNewVersionForm: noop,
    addCourseForm: { courseId: '21', roleType: 'CORE', recommendedSemester: '2' }, setAddCourseForm: noop,
    rejectNote: 'کسری واحد عمومی', setRejectNote: noop,
    newCourseForm: { code: 'CM900', title: 'درس جدید', theo: 3, prac: 1, courseType: 'تخصصی', grading: 'NUMERIC', gpa: true, departmentId: '1' },
    setNewCourseForm: noop,
    depts: [{ id: 1, name: 'گروه کامپیوتر' }], deptsLoading: false, handleCreateBankCourse: noop,
    ruleCourseId: 22, setRuleCourseId: noop,
    ruleForm: { pre: ['CM101'], preOp: 'AND' as const, co: [], coOp: 'OR' as const, minGrade: '12', passGradeStatusCode: '', failGradeStatusCode: '', minUnits: '', minTerm: '' }, setRuleForm: noop,
    toggleRuleCode: noop, handleSaveRules: noop, handleCreateVersion: noop, handleTransferToMajor: noop,
    handleValidate: noop, handleSubmit: noop, handleApprove: noop, handleReject: noop, handlePublish: noop,
    handleArchive: noop, handleCreateRevision: noop, handleSyncRoles: noop, handleMarkGradReq: noop,
    handleRemoveCourse: noop, handleAssignSemester: noop, handleUpdateMaxUnits: noop, handleUpdateRequired: noop,
    handleUpdateRole: noop, handleUpdateGradReq: noop, handleSaveRoleTargets: noop,
    activeTab: 'CATALOG' as string, setActiveTab: noop, transferMajorId: 1, setTransferMajorId: noop,
    transferEntryTermId: 0, setTransferEntryTermId: noop, terms: [],
    dragCourseId: null, setDragCourseId: noop, dropTarget: null, setDropTarget: noop,
    facultyFilter: '', setFacultyFilter: noop, deptFilter: '', setDeptFilter: noop,
    faculties: ['دانشکدهٔ فنی'], departments: ['گروه کامپیوتر'], filteredMajors: majors,
    reloadOverview: async () => {}, reloadDetail: async () => {}, run: async () => true,
    courseCodeOf: new Map([[21, 'CM101'], [22, 'CM102']]), isDraft: true,
    semesterCourses: new Map([[1, [courses[0]]]]), unassignedCourses: [courses[1]],
    totalPlannedUnits: 6, degreeMajor: majors[0], chartTermCount: 4, planTerms: [1, 2, 3, 4],
    overflowTerms: [], gridTerms: [1, 2, 3, 4, 9], isOverflowTerm: () => false,
    typeSummary: [{ role: 'CORE', count: 1, units: 3 }, { role: 'GENERAL', count: 1, units: 3 }],
    roleTargets: { CORE: 60, GENERAL: 20 }, unitsByRole: new Map([['CORE', 3], ['GENERAL', 3]]),
    roleTargetsKey: '10:core', ruleText: (id: number, t: string) => (t === 'PREREQ' ? 'مبانی برنامه‌سازی' : null),
    openRules: noop, semLabel: (s: number | null) => (s == null ? 'نامشخص' : `ترم ${s}`),
    leafCourseCodesOf, leafTotalOf, semesterUnitTotal: (l: { units: number }[]) => l.reduce((s, c) => s + c.units, 0),
    // هشدارهای پیش‌نیاز/هم‌نیاز — با همان تابعِ واقعی ساخته می‌شود تا mock
    // هرگز از کدِ در حالِ اجرا عقب نماند (CoursesTab و SemestersTab آن را می‌خوانند).
    depWarnings: dependencyWarningsMap(courses, detail.rules as Parameters<typeof dependencyWarningsMap>[1]),
    ...extra,
  } as never;
}

const RoleTargetsCase = () => (
  <RoleTargetsEditor initial={{ CORE: 60 }} unitsByRole={new Map([['CORE', 3]])} totalRequired={140} disabled={false} onSave={noop} />
);

const CASES: [string, React.ComponentType, string[], Record<string, unknown>?][] = [
  ['CurriculumToast', CurriculumToast, ['نسخه ذخیره شد'], undefined],
  ['CurriculumHeader', CurriculumHeader, ['مدیریت نسخه‌های برنامهٔ درسی', 'دانشکده:', 'مهندسی کامپیوتر', 'چارت ۴ ترمه'], undefined],
  ['CurriculumTabsBar', CurriculumTabsBar, ['تعریف کاتالوگ رشته', 'نسخهٔ فعال: 1402-1', 'پیش‌نویس'], undefined],
  ['CatalogTab', CatalogTab, ['🗂️ نسخه‌های این رشته', 'کد نسخه', '1402-1'], { activeTab: 'CATALOG' }],
  ['DetailHeaderBar', DetailHeaderBar, ['برنامهٔ کارشناسی ۱۴۰۲', 'ایجاد نسخهٔ جدید'], { activeTab: 'COURSES' }],
  ['VerifyTab', VerifyTab, ['🎯 سهم واحد هر نوع درس', 'جمع واحدها از سقف واحد ترم کمتر است', 'واحد (Enter/Blur برای ذخیره)', '!در حال بارگذاری جزئیات از سرور'], { activeTab: 'VERIFY' }],
  ['CoursesTab', CoursesTab, ['مبانی برنامه‌سازی', 'پیش‌نیاز / هم‌نیاز', 'افزودن درس از بانک'], { activeTab: 'COURSES' }],
  ['SemestersTab', SemestersTab, ['تابستان', 'نامشخص', 'ساختار داده'], { activeTab: 'SEMESTERS' }],
  ['TransferTab', TransferTab, ['نسخهٔ جدید (R+1) از همین نسخه', 'مهندسی کامپیوتر'], { activeTab: 'TRANSFER' }],
  ['NewVersionModal', NewVersionModal, ['ایجاد نسخهٔ جدید برای', '1404-1', 'کپی عمیق از نسخهٔ دیگر'], { modal: 'NEW_VERSION' }],
  ['NewCourseModal', NewCourseModal, ['معرفی درس جدید در بانک دروس', 'CM900', 'عددی'], { modal: 'NEW_COURSE' }],
  ['CourseRulesModal', CourseRulesModal, ['پیش‌نیاز / هم‌نیاز — CM102', 'مبانی برنامه‌سازی', 'درس به‌عنوان پیش‌نیاز انتخاب شد'], { modal: 'RULES', ruleCourse: courses[1] }],
  ['AddCourseModal', AddCourseModal, ['افزودن درس از بانک دروس', 'ساختار داده'], { modal: 'ADD_COURSE' }],
  ['RejectModal', RejectModal, ['رد نسخه و بازگشت به پیش‌نویس', 'کسری واحد عمومی'], { modal: 'REJECT' }],
  ['RoleTargetsEditor', RoleTargetsCase, ['۳ واحد (کسری ۵۷)', 'ذخیره سهم‌ها', 'کسری ۵۷'], undefined],
  ['VersionDetailPanel', VersionDetailPanel, ['ساختار داده', 'پیش‌نیاز / هم‌نیاز'], { activeTab: 'COURSES' }],
  ['CurriculumShell', CurriculumShell, ['مدیریت نسخه‌های برنامهٔ درسی', 'تعریف کاتالوگ رشته', '🗂️ نسخه‌های این رشته'], undefined],
];

let fail = 0;
for (const [name, Comp, markers, extra] of CASES) {
  try {
    const html = renderToStaticMarkup(
      <CurriculumCtx.Provider value={ctx(extra ?? {})}>
        <Comp />
      </CurriculumCtx.Provider>
    );
    const missing = markers.filter(m => m.startsWith('!') ? html.includes(m.slice(1)) : !html.includes(m));
    const ok = html.length > 40 && missing.length === 0;
    if (!ok) fail++;
    console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(20)} ${String(html.length).padStart(6)} کاراکتر${missing.length ? ` — ماکر نبود: ${JSON.stringify(missing)}` : ''}`);
  } catch (e) {
    fail++;
    console.log(`  ❌ ${name.padEnd(20)} خطای رندر: ${String(e).slice(0, 160)}`);
  }
}
console.log(fail === 0 ? '\n🏁 همهٔ قطعهٔ UI مستقل رندر شدند.' : `\n🏁 ${fail} قطعه مشکل داشت.`);
process.exit(fail === 0 ? 0 : 1);

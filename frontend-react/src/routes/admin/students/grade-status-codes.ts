// ═══════════════════════════════════════════════════════════════════════
//  Sama "grade status code" reference table — port of lib/grade-status-codes.ts
//  (client-side copy: the Go side mirrors it in internal/gradestatus).
// ═══════════════════════════════════════════════════════════════════════

export type GradeStatusCode = {
  code: string;
  title: string;
  /** counted as passed */
  passed: boolean;
  /** affects the overall GPA */
  affectsGpa: boolean;
  /** affects the term GPA */
  affectsTermGpa?: boolean;
  /** the course is dropped (medical, council, emergency…) */
  isDropped?: boolean;
};

export const GRADE_STATUS_CODES: GradeStatusCode[] = [
  { code: '-91', title: 'حذف آيين نامه 91 (کارداني _ کارشناسي)', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '-6', title: 'تقلبهاي مشكوك', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '-5', title: 'انصراف', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '-4', title: 'حذف توسط استاد راهنما در حذف و اضافه', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '-3', title: 'حذف توسط استاد راهنما در انتخاب واحد', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '-1', title: 'حذف در حذف و اضافه', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '0', title: 'نامشخص', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '1', title: 'درس عادي - قبول', passed: true, affectsGpa: true, affectsTermGpa: true, isDropped: false },
  { code: '2', title: 'درس عادي - مردود', passed: false, affectsGpa: true, affectsTermGpa: true, isDropped: false },
  { code: '3', title: 'در معادل سازي پذيرفته شده با احتساب در معدل کل', passed: true, affectsGpa: true, affectsTermGpa: true, isDropped: false },
  { code: '4', title: 'در معادل سازي پذيرفته نشده', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '5', title: 'غيبت در جلسه امتحان', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '6', title: 'حذف اضطراري', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '7', title: 'حذف توسط شوراي آموزشي', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '8', title: 'حذف توسط ستاد دانشجويان شاهد و ايثارگر', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '9', title: 'حذف توسط کميسيون موارد خاص', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '10', title: 'نمره گزارش نشده', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '11', title: 'جبراني- بااحتساب درمعدل', passed: true, affectsGpa: true, affectsTermGpa: true, isDropped: false },
  { code: '12', title: 'جبراني بدون احتساب در معدل-قبول', passed: true, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '13', title: 'ناتمام', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '14', title: 'حذف پزشکي', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '15', title: 'حذف‌ترم بااحتساب', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '16', title: 'در معادل سازي پذيرفته شده بدون احتساب معدل', passed: true, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '17', title: 'درمعادل‌سازي‌پذيرفته‌شده‌جزواحدبدون‌احتسابمعدل', passed: true, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '18', title: 'پايان نامه 941-قبول', passed: true, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '19', title: 'درحال تحقيق', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '20', title: 'بدون تاثير در معدل ترم و معدل کل', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '22', title: 'جبراني بدون احتساب در معدل - مردود', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '23', title: 'پيش نياز-قبول موثر در نيمسال', passed: true, affectsGpa: false, affectsTermGpa: true, isDropped: false },
  { code: '24', title: 'پيش نياز -مردود موثر در نيمسال', passed: false, affectsGpa: false, affectsTermGpa: true, isDropped: false },
  { code: '27', title: 'رساله دکتري', passed: true, affectsGpa: true, affectsTermGpa: true, isDropped: false },
  { code: '28', title: 'بدون احتساب در معدل', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '29', title: 'دروس‌کمبودبدون‌احتساب‌درمعدل', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '32', title: 'جبراني-معادلسازي', passed: true, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '40', title: 'معرفي به استاد', passed: true, affectsGpa: true, affectsTermGpa: true, isDropped: false },
  { code: '44', title: 'دروس پيش‌دانشگاهي/جبراني بدون احتساب', passed: true, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '46', title: 'دروس پيش‌دانشگاهي/جبراني بدون احتساب - مردود', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '50', title: 'خودخوان - قبول', passed: true, affectsGpa: true, affectsTermGpa: true, isDropped: false },
  { code: '51', title: 'خودخوان - مردود', passed: false, affectsGpa: true, affectsTermGpa: true, isDropped: false },
  { code: '52', title: 'تخلف در امتحان', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '53', title: 'دروس‌خودخوان _قبول(جبراني‌بدون‌احتساب‌درمعدل)', passed: true, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '54', title: 'فوت', passed: true, affectsGpa: true, affectsTermGpa: true, isDropped: false },
  { code: '55', title: 'حذف توسط كميته انضباطي', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '200', title: 'حذف آيين نامه اي ماده 23', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '201', title: 'حذف بدليل مرودي درترم هاي قبل', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '300', title: 'غيبت غير موجه بيش از حددر کلاس', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: false },
  { code: '400', title: 'حذف آموزشي', passed: false, affectsGpa: false, affectsTermGpa: false, isDropped: true },
  { code: '931', title: 'حذف آيين نامه 93 (کارداني _ کارشناسي)', passed: false, affectsGpa: false, affectsTermGpa: true, isDropped: false },
  { code: '941', title: 'حذف آيين نامه 94 (کارشناسي ارشد)', passed: false, affectsGpa: false, affectsTermGpa: true, isDropped: false },
  { code: '951', title: 'حذف آيين نامه 95 (دکترا)', passed: false, affectsGpa: false, affectsTermGpa: true, isDropped: false },
];

export const NON_GPA_CODES: ReadonlySet<string> = new Set(
  GRADE_STATUS_CODES.filter((g) => !g.affectsGpa).map((g) => g.code),
);

export const NON_GPA_PASS_CODES: ReadonlySet<string> = new Set(
  GRADE_STATUS_CODES.filter((g) => g.passed && !g.affectsGpa).map((g) => g.code),
);

export const NON_TERM_GPA_CODES: ReadonlySet<string> = new Set(
  GRADE_STATUS_CODES.filter((g) => !g.affectsTermGpa).map((g) => g.code),
);

export const DROPPED_CODES: ReadonlySet<string> = new Set(
  GRADE_STATUS_CODES.filter((g) => g.isDropped).map((g) => g.code),
);

export function gradeStatusTitleOf(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim();
  return GRADE_STATUS_CODES.find((g) => g.code === c)?.title ?? null;
}

export function isPassedStatusCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const c = code.trim();
  const found = GRADE_STATUS_CODES.find((g) => g.code === c);
  return found ? found.passed : false;
}

export function isDroppedStatusCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return DROPPED_CODES.has(code.trim());
}

/** Frozen codes the regulation logic never rewrites (drops/absence/equiv…). */
export const REGULATION_FROZEN_CODES: ReadonlySet<string> = new Set([
  '3', '4', '5', '6', '7', '8', '9', '10', '13', '14', '15', '16', '17', '18', '19', '20',
  '22', '28', '29', '32', '36', '40', '44', '46', '50', '51', '52', '53', '55',
  '200', '201', '300', '400', '-1', '-3', '-4', '-5', '0',
]);

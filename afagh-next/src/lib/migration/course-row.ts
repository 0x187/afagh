// ═══ تجزیهٔ یک ردیف «درس» از فایل سیستم قدیمی — ماژول خالص ═══
//
// چرا جدا از engine.ts؟ engine به @/db و codemap (و در نتیجه `server-only`)
// وابسته است و در تست واحد اصلاً import نمی‌شود. قاعده‌های دادهٔ درس اینجا
// بدون هیچ وابستگی نگه داشته می‌شوند تا `tests/migration-course.test.ts`
// مستقیم رویشان اجرا شود.
//
// پیشینه: نسخهٔ قبلی مهاجرت فقط «کد، نام، واحد، نوع» را می‌خواند؛ مقطع درس،
// گروه آموزشی و تفکیک واحد نظری/عملی در انتقال از بین می‌رفت و کاتالوگ جدید
// برای شهریه و برنامه‌ریزی درسی ناقص می‌ماند.

import { codeOf, norm, num } from './normalize';

/** خوانندهٔ ستون: فهرست نامک‌ها → مقدار سلول (رشتهٔ خالی اگر ستون نبود) */
/**
 * خوانندهٔ سلول. `opts.exact` یعنی «فقط سرستونی که دقیقاً یکی از این نامک‌هاست»
 * — برای نامک‌های عامی مثل «واحد» که نباید ستون تخصصی «واحد تئوری» را بردارند.
 */
export type CellReader = (aliases: string[], opts?: { exact?: boolean }) => string;

export type ParsedCourseRow = {
  code: string;
  title: string;
  /** کل واحد — همیشه ملاک نهایی ثبت */
  units: number;
  theory: number;
  practical: number;
  courseType: string | null;
  /** عنوان/کد مقطع در فایل قدیمی؛ تطبیق با degree_level_configs در commit */
  degreeName: string | null;
  /** نام/کد گروه آموزشی در فایل قدیمی؛ تطبیق با departments در commit */
  deptName: string | null;
  /** «کد گروه آموزشی» — بر نام مقدم است (نام‌های هم‌شکل در دانشکده‌های مختلف) */
  deptCode: string | null;
  /** «کد مقطع» — بر عنوان مقطع مقدم است */
  degreeCode: string | null;
  /** متن خام «پیش‌نیاز» از جدول دروس قدیمی (تبدیل به course_rules در commit) */
  prereqText: string | null;
  /** متن خام «هم‌نیاز» */
  coreqText: string | null;
  /** متن خام «دروس هم‌ارز / معادل» */
  equivText: string | null;
};

export type CourseRowResult =
  | { ok: true; row: ParsedCourseRow; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

/** نامک‌های پذیرفته‌شدهٔ هر ستون (مرجع واحد: هم تجزیه، هم قالب اکسل، هم راهنما) */
export const COURSE_ALIASES = {
  code: ['کد درس', 'کددرس', 'course_code', 'code'],
  title: ['نام درس', 'عنوان درس', 'title'],
  units: ['واحد', 'تعداد واحد', 'کل واحد', 'units', 'total_units'],
  theory: ['واحد نظری', 'واحد تئوری', 'نظری', 'تئوری', 'theory_units', 'theoretical_units'],
  practical: ['واحد عملی', 'عملی', 'آزمایشگاه', 'practical_units', 'lab_units'],
  type: ['نوع', 'نوع درس', 'course_type'],
  degree: ['مقطع', 'مقطع درس', 'مقطع تحصیلی', 'سطح', 'degree', 'degree_level'],
  degreeCode: ['کد مقطع', 'کد مقطع تحصیلی', 'degree_code', 'degree_level_code'],
  department: ['نام گروه آموزشی', 'گروه آموزشی', 'گروه', 'گروه درسی', 'دپارتمان', 'department', 'dept'],
  departmentCode: ['کد گروه آموزشی', 'کد گروه', 'department_code', 'dept_code'],
  // ── سه ستونی که در مهاجرت قبلی از دست می‌رفتند ──
  prereq: ['پیش نیاز', 'پیش‌نیاز', 'پیشنیاز', 'پیش نیازها', 'پیش‌نیازها', 'دروس پیش نیاز', 'دروس پیش‌نیاز', 'prereq', 'prerequisite', 'prerequisites', 'pre_requisite'],
  coreq: ['هم نیاز', 'هم‌نیاز', 'همنیاز', 'هم نیازها', 'هم‌نیازها', 'دروس هم نیاز', 'co requisite', 'corequisite', 'coreq', 'co_requisite'],
  equiv: ['هم ارز', 'هم‌ارز', 'همارز', 'دروس هم ارز', 'دروس هم‌ارز', 'معادل', 'دروس معادل', 'درس معادل', 'equivalent', 'equivalent_courses', 'equivalents'],
} as const;

/** درس‌هایی که ماهیتاً عملی‌اند — برای وقتی فایل تفکیک واحد ندارد */
const PRACTICAL_TYPE = /عمل|آزمایش|کارگاه|practical|lab|workshop/i;

const MAX_UNITS = 12;

/**
 * یک ردیف درس را می‌خواند و به رکورد کامل کاتالوگ تبدیل می‌کند.
 *
 * قواعد واحد (به ترتیب اولویت):
 *  ۱. اگر «واحد» نبود ولی نظری/عملی بود → واحد = نظری + عملی
 *  ۲. اگر نظری و عملی هیچ‌کدام نبود → بر پایهٔ «نوع درس» تفکیک می‌شود
 *  ۳. اگر هر سه بودند ولی جمع نخواند → هشدار؛ ملاک ثبت ستون «واحد» است
 *     (ردیف حذف نمی‌شود، چون در دادهٔ قدیمی این ناسازگاری بسیار رایج است)
 */
export function parseCourseRow(get: CellReader): CourseRowResult {
  const warnings: string[] = [];
  const A = COURSE_ALIASES;

  const code = codeOf(get([...A.code]));
  const title = get([...A.title]);
  const rawUnits = get([...A.units], { exact: true });
  const type = get([...A.type]);
  const degreeName = get([...A.degree]);
  const deptName = get([...A.department]);
  // سه ستون قواعد — اگر در فایل نباشند رشتهٔ خالی برمی‌گردد (بدون خطا)
  const prereqText = get([...A.prereq]) || null;
  const coreqText = get([...A.coreq]) || null;
  const equivText = get([...A.equiv]) || null;
  const deptCode = codeOf(get([...A.departmentCode]));
  const degreeCode = codeOf(get([...A.degreeCode]));

  let theory = num(get([...A.theory]));
  let practical = num(get([...A.practical]));
  let units = num(rawUnits);

  if (!code || !title) return { ok: false, error: 'کد درس و نام درس الزامی است.', warnings };

  if (units == null && (theory != null || practical != null)) units = (theory ?? 0) + (practical ?? 0);
  if (units == null) return { ok: false, error: `واحد نامعتبر: ${rawUnits || '(خالی)'}`, warnings };
  if (units <= 0 || units > MAX_UNITS) return { ok: false, error: `واحد نامعتبر: ${rawUnits}`, warnings };

  if (theory == null && practical == null) {
    const isPractical = PRACTICAL_TYPE.test(norm(type));
    theory = isPractical ? 0 : units;
    practical = isPractical ? units : 0;
    warnings.push(
      type
        ? `واحد نظری/عملی در فایل نبود — بر اساس نوع درس «${type}» تفکیک شد (${theory}/${practical}).`
        : 'واحد نظری/عملی در فایل نبود — کل واحد نظری در نظر گرفته شد.',
    );
  } else {
    theory = theory ?? 0;
    practical = practical ?? 0;
    const sum = theory + practical;
    if (Math.abs(sum - units) > 0.01) {
      warnings.push(`جمع واحد نظری (${theory}) و عملی (${practical}) برابر ${sum} است ولی ستون «واحد» ${units} — ملاک ثبت، ستون «واحد» است.`);
    }
  }

  if (theory < 0 || practical < 0) return { ok: false, error: 'واحد نظری/عملی نمی‌تواند منفی باشد.', warnings };

  return {
    ok: true,
    warnings,
    row: {
      code, title, units, theory, practical,
      courseType: type || null,
      degreeName: degreeName || null,
      deptName: deptName || null,
      deptCode: deptCode || null,
      degreeCode: degreeCode || null,
      prereqText,
      coreqText,
      equivText,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  هستهٔ خالصِ معدل — یک نقطهٔ حقیقت برای هر دو موتور پروژه
//
//  این ماژول عمداً هیچ وابستگی‌ای به DB/React/Next ندارد تا هر دو موتور
//  (calculateOfficialGPA و auditStudent) و نیز تست واحد بتوانند هستهٔ یکسانِ
//  تجمیع را صدا بزنند. هر جا قبلاً حلقهٔ تجمیع دستی نوشته شده بود، حالا از
//  همین توابع خالص استفاده می‌شود.
//
//  قاعدهٔ «نمرهٔ ردیف به معدل می‌آید یا نه» در grade-status-codes.ts
//  (`rowCountsTowardGpa`) زندگی می‌کند و از همین‌جا صدا زده می‌شود؛ بنابراین
//  هیچ‌جا فهرست دومی از کدهای سما وجود ندارد.
// ═══════════════════════════════════════════════════════════════════════
import { isPassedStatusCode, rowCountsTowardGpa } from './grade-status-codes';

// ───────────────────────────────────────────────────────────────────────────
//  ابزارهای عددی: محاسبهٔ معدل با حساب صحیح (بدون خطای ممیز شناور)
//
//  نمره تا دو رقم اعشار و واحد تا یک رقم اعشار است؛ بنابراین همهٔ جمع‌ها روی
//  اعداد صحیح مقیاس‌شده انجام و فقط در انتها یک تقسیم صورت می‌گیرد. با این کار
//  خطای انباشتی نوع 0.1 + 0.2 = 0.30000000000000004 اصلاً به وجود نمی‌آید.
// ───────────────────────────────────────────────────────────────────────────

const GRADE_SCALE = 100; // نمره: دو رقم اعشار
const UNIT_SCALE = 10;   // واحد: یک رقم اعشار

/**
 * تبدیل امنِ مقدار نمره به عدد.
 * رشتهٔ خالی، فاصله، مقدار غیرعددی و NaN ⇒ null (یعنی «نمره‌ای ثبت نشده»)
 * تا هرگز به‌اشتباه صفر در معدل دانشجو اثر نگذارد.
 */
export function parseGrade(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'number' ? value : String(value).trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** تبدیل امنِ تعداد واحد؛ مقدار نامعتبر یا منفی ⇒ صفر */
export function parseUnits(value: unknown): number {
  const n = parseGrade(value);
  if (n === null || n < 0) return 0;
  return n;
}

/** گرد کردن نیم‌بالا روی دو رقم اعشار، بدون خطای ممیز شناور */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * انباشتگر معدل: جمع‌ها روی اعداد صحیح مقیاس‌شده نگه‌داری می‌شوند.
 *   weighted = Σ (نمره×۱۰۰) × (واحد×۱۰)
 *   units    = Σ (واحد×۱۰)
 */
export class GpaAccumulator {
  private weighted = 0;
  private unitsScaled = 0;

  add(grade: number, units: number) {
    const g = Math.round(grade * GRADE_SCALE);
    const u = Math.round(units * UNIT_SCALE);
    if (u <= 0) return;
    this.weighted += g * u;
    this.unitsScaled += u;
  }

  get hasUnits() { return this.unitsScaled > 0; }
  get units() { return this.unitsScaled / UNIT_SCALE; }

  /** معدل دقیق (بدون گرد کردن) برای مقایسه‌های آیین‌نامه‌ای مثل آستانهٔ مشروطی */
  exact(): number | null {
    if (this.unitsScaled <= 0) return null;
    return this.weighted / (this.unitsScaled * GRADE_SCALE);
  }

  /** معدل گردشده روی دو رقم اعشار برای نمایش و ذخیره در دیتابیس */
  rounded(): number | null {
    if (this.unitsScaled <= 0) return null;
    return Math.round((this.weighted * 100) / (this.unitsScaled * GRADE_SCALE)) / 100;
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  شکلِ ردیف کارنامه برای هستهٔ تجمیع (ساختاری و شلِ عمدی: هم SELECT موتور
//  آیین‌نامه و هم SELECT موتور فارغ‌التحصیلی باید بدون تغییر به آن بخوانند).
// ───────────────────────────────────────────────────────────────────────────

export type GpaRow = {
  courseId?: number | null;
  code?: string | null;
  units?: unknown;
  gradeValue?: unknown;
  gradeStatus?: string | null;
  samaGradeStatusCode?: string | null;
  gradingType?: string | null;
  affectsGpa?: number | null;
  courseMinMark?: unknown;
};

/** حد نصاب قبولی هر ردیف: اول minPassedMark خود درس، بعد پیش‌فرض آیین‌نامه */
function thresholdFactory(passingGrade: number) {
  return (r: GpaRow): number => {
    const m = r.courseMinMark != null ? Number(r.courseMinMark) : NaN;
    return Number.isFinite(m) && m >= 0 && m <= 20 ? m : passingGrade;
  };
}

/** آیا ردیف «قبول» است؟ (معادل‌سازی/معاف/کد سمای قبولی هم قبولی است) */
function isPassedRow(r: GpaRow, grade: number | null, bar: number): boolean {
  const isSpecialPass =
    r.gradeStatus === 'EXEMPT' || r.gradeStatus === 'PASSED_NO_GRADE' ||
    isPassedStatusCode(r.samaGradeStatusCode);
  if (isSpecialPass) return true;
  return r.gradingType === 'DESCRIPTIVE' ? grade === 1 : (grade !== null && grade >= bar);
}

// ═══════════════════════════════════════════════════════════════════════════
//  ۱) هستهٔ «معدل رسمی» — calculateOfficialGPA (موتور آیین‌نامه‌ها)
// ═══════════════════════════════════════════════════════════════════════════

export type OfficialGpaInput = {
  /** کف قبولی پیش‌فرض آیین‌نامه (وقتی minPassedMark درس معتبر نباشد) */
  passingGrade: number;
  /** حد نصاب قبولی مجدد (تبصرهٔ ۱۳۹۱) */
  retakeMinGrade: number;
  /** سیاست نمرهٔ مردودی: EXCLUDE_ALWAYS | EXCLUDE_IF_PASSED | EXCLUDE_IF_PASSED_1391 | KEEP_ALWAYS */
  policy: string;
  /** فقط بهترین نمرهٔ هر کد درس شمرده شود */
  dedupeRepeated: boolean;
};

export type OfficialGpaCore = {
  gpa: number;
  totalUnits: number;
  passedUnits: number;
  excludedCount: number;
};

/**
 * هستهٔ خالصِ محاسبهٔ معدل کل. دقیقاً همان قاعده‌ای را اجرا می‌کند که پیش از
 * این بازآرایی داخل calculateOfficialGPA حلقه‌به‌حلقه نوشته شده بود؛ فقط از
 * DB جدا شده تا قابل تست باشد و تا هر دو موتور از یک پیاده‌سازی استفاده کنند.
 */
export function aggregateOfficialGpaRows(
  rows: readonly GpaRow[],
  input: OfficialGpaInput,
): OfficialGpaCore {
  const thresholdOf = thresholdFactory(input.passingGrade);
  const is1391 = input.policy === 'EXCLUDE_IF_PASSED_1391';
  // بخشنامهٔ ۲/۲۱/۲۸۳۴۲۸ + دادنامهٔ ۲۱۵۶۰۳۱: نمرهٔ مردودی مطلقاً وارد معدل کل نمیشود
  const excludeAlways = input.policy === 'EXCLUDE_ALWAYS';

  // نقشه‌برداری دروسِ واجدِ حذف مردودی قبلی:
  // سیاست عادی: هر قبولی (با کف عادی همان درس) مردودی قبلی را حذف می‌کند؛
  // تبصره ۱۳۹۱: فقط قبولیِ مجدد با حد نصاب retakeMinGrade (مثلاً ۱۴) حذف می‌کند.
  const passedCourses = new Set<string>();
  for (const r of rows) {
    const g = parseGrade(r.gradeValue);
    const bar = is1391 ? input.retakeMinGrade : thresholdOf(r);
    if (isPassedRow(r, g, bar) && r.code != null) passedCourses.add(r.code);
  }

  // dedupeRepeatedCourses: برای هر کد درس، فقط بالاترین نمرهٔ FINALIZED نگه داشته می‌شود
  const bestByCode = new Map<string, GpaRow>();
  if (input.dedupeRepeated) {
    for (const r of rows) {
      const g = parseGrade(r.gradeValue);
      if (g === null) continue;
      const cur = bestByCode.get(String(r.code));
      const curG = cur ? parseGrade(cur.gradeValue) : null;
      if (!cur || curG === null || g > curG) bestByCode.set(String(r.code), r);
    }
  }

  const acc = new GpaAccumulator();
  let passedUnits = 0;
  let excludedCount = 0;

  for (const r of rows) {
    const g = parseGrade(r.gradeValue);
    if (g === null) continue; // نمرهٔ ثبت‌نشده/خالی هرگز در صورت و مخرج نمی‌آید
    const u = parseUnits(r.units);
    const passed = r.gradingType === 'DESCRIPTIVE' ? g === 1 : g >= thresholdOf(r);

    // dedupeRepeatedCourses فعال: تلاش‌های غیربهترینِ همان درس نه در واحدهای
    // گذرانده و نه در معدل شمرده می‌شوند
    if (input.dedupeRepeated && bestByCode.get(String(r.code)) !== r) { excludedCount++; continue; }

    if (passed) {
      passedUnits = round2(passedUnits + u);
    }

    /**
     * دروس توصیفی، بی‌تاثیر در معدل، یا با کد سمای بدون احتساب (مثل ۱۲: جبرانی
     * بدون احتساب در معدل) وارد مخرج و صورت معدل نمی‌شوند — ولی واحد قبولی
     * (بالا) همچنان در passedUnits شمرده شده است.
     * 🔗 قاعده از grade-status-codes.rowCountsTowardGpa می‌آید (تعریف مرجع مشترک).
     */
    if (!rowCountsTowardGpa({
      samaGradeStatusCode: r.samaGradeStatusCode,
      courseAffectsGpa: r.affectsGpa,
      gradingType: r.gradingType,
    })) continue;

    // اعمال سیاست نمرهٔ مردودی:
    // EXCLUDE_ALWAYS — نمرهٔ مردودی در ریزنمرات و میانگین نیمسال میماند ولی
    //   مطلقاً وارد معدل کل نمیشود، بدون وابستگی به قبولی مجدد (حکم لازمالاجرا).
    // سیاستهای قدیمی — فقط پس از قبولی مجدد همان درس حذف میکنند (مادهٔ ۵۳).
    const failedIsExcluded = excludeAlways ||
      ((input.policy === 'EXCLUDE_IF_PASSED' || is1391) && passedCourses.has(String(r.code)));
    if (!passed && failedIsExcluded) {
      excludedCount++;
      continue; // حذف از صورت و مخرج معدل کل
    }

    acc.add(g, u);
  }

  return { gpa: acc.rounded() ?? 0, totalUnits: acc.units, passedUnits, excludedCount };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ۲) هستهٔ «معدلِ دروازهٔ فارغ‌التحصیلی» — auditStudent (موتور فارغ‌التحصیلی)
// ═══════════════════════════════════════════════════════════════════════════

export type AuditCore = {
  /** واحدهای گذرانده (هر ردیف قبولی، فارغ از اینکه کدش در معدل اثر دارد یا نه) */
  passedUnits: number;
  /** معدل کل گردشده؛ null یعنی هنوز هیچ نمرهٔ عددیِ مؤثری وجود ندارد */
  gpa: number | null;
  /** شناسهٔ درس‌های گذرانده (برای تطبیق با سرفصل) */
  passedIds: ReadonlySet<number>;
};

/**
 * هستهٔ خالصِ تطبیق کارنامه با سرفصل. پیش از این بازآرایی، auditStudent نمرهٔ
 * ردیف را صرفاً با `courses.affectsGpa` تصمیم می‌گرفت و کد سمای «قبولیِ بدون
 * احتساب» (۱۲، ۱۶، ۱۷، ۱۸، ۲۳، ۳۲، ۴۴، ۵۳) را نادیده می‌گرفت؛ در حالی که موتور
 * آیین‌نامه همان ردیف‌ها را از معدل کنار می‌گذاشت. نتیجه‌اش دو موتور بود که برای
 * یک کارنامهٔ یکسان دو عدد متفاوت می‌دادند (و ۶ دانشجو را از مسدود به واجد
 * شرایط فارغ‌التحصیلی می‌بردند). حالا هر دو از rowCountsTowardGpa استفاده
 * می‌کنند؛ واحدها همچنان برای هر ردیف قبولی شمرده می‌شوند.
 *
 * تفاوت‌های باقی‌مانده با calculateOfficialGPA (عمدی و مستند در
 * tests/gpa-engine-parity.test.ts): این هسته سیاست حذف مردودی و
 * dedupeRepeatedCourses ندارد (تصمیم آیین‌نامه‌ایِ موتور رسمی است) و نمرهٔ
 * ردیف‌های مردود را اصلاً وارد نمی‌کند.
 */
export function aggregateAuditTranscript(rows: readonly GpaRow[], passing: number): AuditCore {
  const thresholdOf = thresholdFactory(passing);
  const passedIds = new Set<number>();
  let passedUnits = 0;
  const acc = new GpaAccumulator(); // حساب صحیح؛ بدون خطای ممیز شناور
  for (const t of rows) {
    const g = parseGrade(t.gradeValue); // نمرهٔ خالی/NaN = ثبت‌نشده، نه صفر
    const u = parseUnits(t.units);
    const isSpecialPass = t.gradeStatus === 'EXEMPT' || t.gradeStatus === 'PASSED_NO_GRADE' || isPassedStatusCode(t.samaGradeStatusCode);
    const ok = isSpecialPass || (g != null && g >= thresholdOf(t));
    if (!ok) continue;
    if (t.courseId != null) passedIds.add(t.courseId);
    passedUnits = round2(passedUnits + u);
    if (g != null && rowCountsTowardGpa({
      samaGradeStatusCode: t.samaGradeStatusCode,
      courseAffectsGpa: t.affectsGpa,
      gradingType: t.gradingType,
    })) {
      acc.add(g, u);
    }
  }
  return { passedUnits, gpa: acc.rounded(), passedIds };
}
/**
 * ═══════════════════════════════════════════════════════════════════════
 * هستهٔ خالص موتور برنامه‌ریزی درسی (بدون DB — قابل تست واحد در CI)
 *
 * مسئولیت‌ها: اعتبارسنجی ورودی‌های گروه درسی، تشخیص هم‌پوشانی زمانی،
 * امتیازدهی پیشنهادها (نزدیکی دانشکده + ترجیح استاد + تناسب ظرفیت)،
 * پیش‌بینی تعداد گروه از تقاضا، ماشین فازها و طبقه‌بندی سلامت برنامه.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────── ثابت‌ها و انواع ───────────────────────────

import { d2j, j2d, toGregorian, toJalaliFromDate } from './calendar';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  نرمال‌سازی و قالب‌بندی کد ترم (Term Code)
 * ────────────────────────────────────────────────────────────────────────
 *  از مهاجرت ۲۰۲۶-۱۰-۰۱ دیتابیس کاننیکال است: همهٔ کدها ۵ رقمی‌اند
 *  (۴ رقم سال + ۱ رقم نوع ترم) و termType ستون معتبر است، نه حدس از کد.
 *
 *  استاندارد آفاق (رقم آخر = نوع ترم):
 *  - ۱ → نیمسال اول (NORMAL)      مثال: 13921
 *  - ۲ → نیمسال دوم (NORMAL)      مثال: 13922
 *  - ۳ → نیمسال تابستان (SUMMER)  مثال: 13923
 *  - بقیه ارقام → معادل‌سازی (EQUIVALENCE)  مثال: 13920، 13900
 *
 *  مسیرهای قدیمی (فقط برای سازگاری با دادهٔ خام legacy — در DB فعلی وجود ندارند):
 *  - ۳ رقمی NYT (قرارداد شمس: دهه + رقم سال + ترم) → '13' + کد (891 → 13891)
 *  - ۴ رقمی 14XY (قرارداد شمس برای ۱۴۰۰ به بعد) → سال ‎۱۴۰۰+X‎، ترم Y
 *    (1401 → 14001، 1411 → 14011)
 *
 *  ترتیب در کارنامه:
 *  ۱. تمام ترم‌های معادل‌سازی اول می‌آیند (sortKey کوچک)
 *  ۲. بعد ترم‌های تحصیلی بر اساس سال و نیمسال (صعودی)
 * ════════════════════════════════════════════════════════════════════════════
 */
export interface NormalizedTerm {
  originalCode: string;
  normalizedCode: string;        // همیشه ۵ رقمی
  academicYear: number;          // ۴ رقم اول (مثال: ۱۳۹۲)
  semester: number;              // رقم آخر (۱/۲ نرمال، ۳ تابستان، بقیه معادل‌سازی)
  termType: 'NORMAL' | 'SUMMER' | 'EQUIVALENCE' | 'UNKNOWN';
  sortKey: number;               // برای مرتب‌سازی: معادل‌سازی اول (۰xxxxx)، بعد نرمال (۱xxxxx)
  displayYear: string;           // «۱۳۹۴-۱۳۹۵»
  displaySemester: string;       // «نیمسال اول»، «نیمسال دوم»، «نیمسال تابستان»، «معادل‌سازی»
}

/**
 * رقم آخر کد ترم → نوع ترم (استاندارد آفاق — با ستون termType دیتابیس یکسان است)
 */
export function termTypeFromDigit(d: number): NormalizedTerm['termType'] {
  if (d === 1 || d === 2) return 'NORMAL';
  if (d === 3) return 'SUMMER';
  return 'EQUIVALENCE';
}

/**
 * نرمال‌سازی کد ترم به فرمت ۵ رقمی استاندارد
 */
export function normalizeTermCode(raw: string | number | null | undefined): NormalizedTerm | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // نگاشت به ۵ رقم کاننیکال
  let normalized = '';
  // --- ۵ رقمی: از قبل استاندارد است ---
  if (/^\d{5}$/.test(s)) {
    normalized = s;
  }
  // --- ۳ رقمی قدیمی (NYT، فقط دههٔ ۸ و ۹): پیشوند ۱۳ (مطابق مهاجرت) ---
  // بقیه (مثل ۱۰۱ بچ معادل‌سازی) در DB جدید وجود ندارند → null
  else if (/^\d{3}$/.test(s)) {
    if (!/^[89]/.test(s)) return null;
    normalized = '13' + s;
  }
  // --- ۴ رقمی قدیمی شمس (14XY): سال ۱۴۰۰+X، ترم Y (مطابق مهاجرت) ---
  else if (/^14\d{2}$/.test(s)) {
    const x = parseInt(s.slice(2, 3), 10);
    normalized = String(1400 + x) + s.slice(3, 4);
  }
  // --- موارد دیگر: استخراج رقم ---
  else {
    const digits = s.replace(/\D/g, '');
    if (digits.length >= 5) normalized = digits.slice(0, 5);
    else if (digits.length === 3 && /^[89]/.test(digits)) normalized = '13' + digits;
    else if (digits.length === 4 && /^14/.test(digits)) {
      normalized = String(1400 + parseInt(digits.slice(2, 3), 10)) + digits.slice(3, 4);
    } else {
      return null; // نتوانستیم پارس کنیم
    }
  }

  const academicYear = parseInt(normalized.slice(0, 4), 10);
  const semester = parseInt(normalized.slice(4, 5), 10);
  // سال نامعتبر (مثل ۱۳۱۰ یا ۱۴۰ قدیم، یا آیندهٔ دور مثل ۱۴۵۵) را رد کن
  // سقف ۱۴۲۰: امسال ~۱۴۰۵ است و ترم‌ها حداکثر چند سال جلوتر ساخته می‌شن
  if (academicYear < 1300 || academicYear > 1420) return null;
  // نوع ترم فقط از رقم آخر — بدون حدس اضافه
  const termType = termTypeFromDigit(semester);

  // کلید مرتب‌سازی:
  // معادل‌سازی‌ها اول (۰xxxxx)
  // بعد ترم‌های نرمال و تابستان (۱xxxxx)
  const sortKey = termType === 'EQUIVALENCE'
    ? parseInt(normalized)
    : 100000 + academicYear * 10 + semester;

  // نمایش سال تحصیلی: «۱۳۹۴-۱۳۹۵»
  const displayYear = `${academicYear}-${academicYear + 1}`;

  // نمایش نیمسال
  let displaySemester = '';
  if (termType === 'EQUIVALENCE') displaySemester = 'معادل‌سازی';
  else if (termType === 'SUMMER') displaySemester = 'نیمسال تابستان';
  else if (semester === 1) displaySemester = 'نیمسال اول';
  else if (semester === 2) displaySemester = 'نیمسال دوم';
  else displaySemester = 'نامشخص';

  return {
    originalCode: s,
    normalizedCode: normalized,
    academicYear,
    semester,
    termType,
    sortKey,
    displayYear,
    displaySemester,
  };
}

/**
 * مرتب‌سازی لیست ترم‌ها برای کارنامه
 * ۱. معادل‌سازی‌ها اول (به ترتیب کد)
 * ۲. ترم‌های نرمال بر اساس سال و نیمسال
 * ۳. ترم‌های تابستان در جایگاه خود سال
 */
export function sortTermsForTranscript<T extends { termCode: string }>(terms: T[]): T[] {
  return [...terms].sort((a, b) => {
    const na = normalizeTermCode(a.termCode);
    const nb = normalizeTermCode(b.termCode);
    if (!na || !nb) return 0;
    if (na.sortKey !== nb.sortKey) return na.sortKey - nb.sortKey;
    return String(a.termCode).localeCompare(String(b.termCode));
  });
}

/**
 * گروه‌بندی ترم‌ها برای نمایش در کارنامه.
 * معادل‌سازی‌ها (سوابق پایه) در یک بلوک جدا در ابتدای کارنامه می‌آیند،
 * بعد سال‌های تحصیلی به ترتیب نزولی (جدیدتر اول).
 */
export const EQUIVALENCE_GROUP_YEAR = 0;

export function groupTermsByAcademicYear<T extends { termCode: string }>(
  terms: T[],
  getRows: (t: T) => any[]
): Array<{
  academicYear: number;
  displayYear: string;
  terms: Array<T & { normalized: NormalizedTerm; rows: any[] }>;
}> {
  const sorted = sortTermsForTranscript(terms);
  const map = new Map<number, Array<T & { normalized: NormalizedTerm; rows: any[] }>>();
  const equiv: Array<T & { normalized: NormalizedTerm; rows: any[] }> = [];

  for (const t of sorted) {
    const norm = normalizeTermCode(t.termCode);
    if (!norm) continue;
    const item = { ...t, normalized: norm, rows: getRows(t) };
    if (norm.termType === 'EQUIVALENCE') {
      equiv.push(item); // معادل‌سازی‌ها جدا — اول کارنامه
      continue;
    }
    const year = norm.academicYear;
    if (!map.has(year)) map.set(year, []);
    map.get(year)!.push(item);
  }

  // سال‌ها را نزولی مرتب کنیم (جديدتر اول)
  const years = Array.from(map.keys()).sort((a, b) => b - a);
  const groups = years.map(y => ({
    academicYear: y,
    displayYear: `${y}-${y + 1}`,
    terms: map.get(y)!,
  }));
  if (equiv.length > 0) {
    groups.unshift({
      academicYear: EQUIVALENCE_GROUP_YEAR,
      displayYear: 'سوابق و معادل‌سازی',
      terms: equiv,
    });
  }
  return groups;
}
export const GENDERS = ['MALE', 'FEMALE', 'MIXED'] as const;
export type ClassGender = (typeof GENDERS)[number];

export const SHIFTS = ['MORNING', 'EVENING'] as const;
export type Shift = (typeof SHIFTS)[number];
/** مرز شیفت‌ها (دقیقه از نیمه‌شب) — صبح تا ۱۲:۰۰، عصر از ۱۳:۳۰ */
export const SHIFT_BOUNDARY = { morningEnd: 12 * 60, eveningStart: 13 * 60 + 30 } as const;

export const OFFERING_SCOPES = ['DEPARTMENTAL', 'GENERAL_SERVICE'] as const;
export type OfferingScope = (typeof OFFERING_SCOPES)[number];

export const LOCATION_TYPES = ['IN_CAMPUS', 'OUT_CAMPUS'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const SCHEDULING_PHASES = ['SUPPLY', 'ALLOCATION', 'REVIEW', 'PUBLISHED'] as const;
export type SchedulingPhase = (typeof SCHEDULING_PHASES)[number];

export const MAX_GROUPS = 20;        // سقف گروه درسی (دروس عمومی تا ۲۰ گروه)
export const MIN_CAPACITY = 5;
export const MAX_CAPACITY = 500;
export const DAYS_PER_WEEK = 7;      // شنبه تا جمعه
export const MINUTES_GRID = 30;      // گرید نیم‌ساعته برای پیشنهادها

export interface GroupDraftInput {
  groupNumber: number;
  capacity: number;
  gender: ClassGender;
  professorId: number;
  classroomId: number;
  dayOfWeek: number;        // 0..6 (شنبه=0)
  startTime: string;        // "HH:MM"
  endTime: string;          // "HH:MM"
}

export interface ValidatedGroupDraft extends GroupDraftInput {
  startMinutes: number;
  endMinutes: number;
  shift: Shift;
}

// ─────────────────────────── ابزار زمان ───────────────────────────

export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) throw new Error('قالب ساعت نامعتبر است.');
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error('قالب ساعت نامعتبر است.');
  return h * 60 + min;
}

export function shiftOf(startMinutes: number, endMinutes: number): Shift {
  if (endMinutes <= SHIFT_BOUNDARY.morningEnd) return 'MORNING';
  if (startMinutes >= SHIFT_BOUNDARY.eveningStart) return 'EVENING';
  // بازه‌ای که از مرز شیفت رد می‌شود → اعتبارسنجی آن را رد می‌کند
  throw new Error('بازهٔ زمانی نباید از مرز شیفت‌ها عبور کند (صبح تا ۱۲:۰۰ — عصر از ۱۳:۳۰).');
}

/** هم‌پوشانی دو بازه (دقیقه): تداخل اگر aStart < bEnd و bStart < aEnd */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// ─────────────────────────── اعتبارسنجی ───────────────────────────

/**
 * اعتبارسنجی لیست گروه‌های درسی + نرمال‌سازی (شمارهٔ ترتیبی، شیفت، دقیقه).
 * هر ورودی نامعتبر → throw با پیام فارسی (دفاع سرور، مستقل از UI).
 */
export function validateGroupDrafts(inputs: GroupDraftInput[], ownerIsServicePool: boolean): ValidatedGroupDraft[] {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error('هیچ گروه درسی برای برنامه‌ریزی ارسال نشده است.');
  }
  if (inputs.length > MAX_GROUPS) {
    throw new Error(`تعداد گروه‌های درسی از سقف ${MAX_GROUPS} بیشتر است.`);
  }
  const out: ValidatedGroupDraft[] = [];
  const seen = new Set<number>();
  for (const raw of inputs) {
    if (!raw || typeof raw !== 'object') throw new Error('ردیف گروه درسی نامعتبر است.');
    const g = Number(raw.groupNumber);
    if (!Number.isInteger(g) || g < 1 || g > MAX_GROUPS) throw new Error('شمارهٔ گروه نامعتبر است.');
    if (seen.has(g)) throw new Error(`شمارهٔ گروه ${g} تکراری است.`);
    seen.add(g);

    const cap = Number(raw.capacity);
    if (!Number.isInteger(cap) || cap < MIN_CAPACITY || cap > MAX_CAPACITY) {
      throw new Error(`ظرفیت گروه ${g} نامعتبر است (${MIN_CAPACITY}..${MAX_CAPACITY}).`);
    }
    if (!GENDERS.includes(raw.gender)) throw new Error(`جنسیت گروه ${g} نامعتبر است.`);
    const pid = Number(raw.professorId);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`استاد گروه ${g} نامعتبر است.`);
    const rid = Number(raw.classroomId);
    if (!Number.isInteger(rid) || rid <= 0) throw new Error(`کلاس فیزیکی گروه ${g} نامعتبر است.`);
    const day = Number(raw.dayOfWeek);
    if (!Number.isInteger(day) || day < 0 || day >= DAYS_PER_WEEK) throw new Error(`روز گروه ${g} نامعتبر است.`);

    const start = toMinutes(raw.startTime);
    const end = toMinutes(raw.endTime);
    if (start >= end) throw new Error(`بازهٔ زمانی گروه ${g} نامعتبر است (پایان قبل از شروع).`);
    if (end - start > 4 * 60) throw new Error(`مدت جلسهٔ گروه ${g} نباید از ۴ ساعت بیشتر شود.`);

    // قواعد شیفت: کارگاه‌های خارج دانشگاه یکپارچه در یک شیفت می‌مانند
    let shift: Shift;
    try {
      shift = shiftOf(start, end);
    } catch (e) {
      throw new Error(`گروه ${g}: ${(e as Error).message}`);
    }
    if (ownerIsServicePool && shift !== 'MORNING' && shift !== 'EVENING') {
      throw new Error(`گروه ${g}: شیفت نامعتبر.`);
    }
    out.push({ ...raw, groupNumber: g, capacity: cap, professorId: pid, classroomId: rid, dayOfWeek: day, startMinutes: start, endMinutes: end, shift });
  }
  // مرتب‌سازی صعودی شمارهٔ گروه (ثبات خروجی برای تزریق)
  return out.sort((a, b) => a.groupNumber - b.groupNumber);
}

// ─────────────────────────── امتیازدهی پیشنهادها ───────────────────────────

export const SCORE = {
  sameFaculty: 40,      // کلاس داخل دانشکدهٔ هدف (بدون جابجایی)
  crossFaculty: 10,     // فاصلهٔ بین‌دانشکده‌ای
  preferredTime: 50,    // داخل بازهٔ حضورِ ترجیحی استاد
  okTime: 20,           // خارج بازهٔ ترجیحی ولی داخل ساعات حضور
  capacityPerfect: 30,  // مازاد ظرفیت ۰..۱۵ نفر
  capacityGood: 10,     // مازاد ۱۶..۴۰ نفر
  capacityOver: -60,    // ظرفیت کلاس کمتر از نیاز (هرگز پیشنهاد نمی‌شود)
  gapAllowed: 40,       // مازاد بی‌معنا (بیش از ۴۰ نفر) → ۰
  // ── فشرده‌سازی برنامهٔ استاد: روزِ پشت‌سرهم، بدون ساعت خالی ──
  adjacentBlock: 45,    // اسلات دقیقاً چسبیده به یک کلاس موجود همان روز
  sameDay: 20,          // همان روزی که استاد از قبل کلاس دارد (کمتر رفت‌وآمد)
  internalGap: -35,     // به‌ازای هر ساعت خالیِ ایجادشده بین دو کلاس همان روز
} as const;

export interface SlotScoreInput {
  roomFacultyId: number | null;
  targetFacultyId: number | null;
  inPreferredWindow: boolean;
  inAvailableWindow: boolean;
  roomCapacity: number;
  requiredCapacity: number;
  /** اسلات دقیقاً به ابتدا/انتهای یک بلوک کلاسِ موجودِ همان روز چسبیده است */
  adjacentToExisting?: boolean;
  /** استاد در همان روز کلاس دیگری دارد */
  dayAlreadyUsed?: boolean;
  /** تعداد ساعت‌های خالیِ جدیدی که این انتخاب بین کلاس‌های همان روز می‌سازد */
  gapsCreated?: number;
}

export function calculateSlotScore(p: SlotScoreInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // الزام سخت: ظرفیت فیزیکی کافی باشد
  if (p.roomCapacity < p.requiredCapacity) {
    return { score: SCORE.capacityOver, reasons: [`ظرفیت کلاس (${p.roomCapacity}) کمتر از نیاز (${p.requiredCapacity}) است.`] };
  }
  if (!p.inAvailableWindow) {
    return { score: -100, reasons: ['خارج از ساعات حضور استاد است.'] };
  }

  // فاکتور ۱: نزدیکی مکانی به دانشکدهٔ هدف (زونینگ)
  if (p.targetFacultyId && p.roomFacultyId === p.targetFacultyId) {
    score += SCORE.sameFaculty;
    reasons.push('داخل دانشکدهٔ هدف (بدون جابجایی)');
  } else {
    score += SCORE.crossFaculty;
    reasons.push(p.targetFacultyId ? 'فاصلهٔ بین‌دانشکده‌ای' : 'دانشکدهٔ هدف مشخص نشده');
  }

  // فاکتور ۲: ترجیح زمانی استاد
  if (p.inPreferredWindow) {
    score += SCORE.preferredTime;
    reasons.push('زمان ترجیحی استاد');
  } else {
    score += SCORE.okTime;
    reasons.push('زمان مقدور (داخل ساعات حضور)');
  }

  // فاکتور ۳: تناسب ظرفیت کلاس
  const diff = p.roomCapacity - p.requiredCapacity;
  if (diff >= 0 && diff <= 15) {
    score += SCORE.capacityPerfect;
    reasons.push('تناسب عالی ظرفیت');
  } else if (diff <= 40) {
    score += SCORE.capacityGood;
    reasons.push('تناسب قابل قبول ظرفیت');
  }

  // فاکتور ۴: فشرده‌سازی روز استاد — «پشت سر هم، بدون ساعت خالی»
  if (p.adjacentToExisting) {
    score += SCORE.adjacentBlock;
    reasons.push('چسبیده به کلاس قبلی/بعدیِ همان روز (بدون ساعت خالی)');
  }
  if (p.dayAlreadyUsed) {
    score += SCORE.sameDay;
    reasons.push('همان روزِ کلاس‌های دیگر استاد (کمتر رفت‌وآمد)');
  }
  const gaps = Math.max(0, Number(p.gapsCreated ?? 0));
  if (gaps > 0) {
    score += SCORE.internalGap * gaps;
    reasons.push(`${gaps} ساعت خالی بین کلاس‌های همان روز ایجاد می‌کند`);
  }

  return { score, reasons };
}

/**
 * شمارش «ساعت‌های خالیِ داخلی» یک روز.
 *
 * خروجی = تعداد فاصله‌های ≥ minGap دقیقه‌ای بین دو بلوک کلاسِ همان روز.
 * مثال: ۸–۱۰ و ۱۲–۱۴ ⇒ یک ساعت خالی (۱۰–۱۲) ⇒ ۱.
 * همان چیزی که کاربر می‌گوید نباید باشد: «اول ۸ پر بشه، ۱۰ خالی باشه، بعد
 * ۱۲ دوباره با یک رشتهٔ دیگر درس بدن».
 */
export function countInternalGaps(
  blocks: { start: number; end: number }[],
  minGap = 30,
): number {
  if (blocks.length < 2) return 0;
  const sorted = [...blocks].sort((x, y) => x.start - y.start);
  let gaps = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start - sorted[i - 1].end >= minGap) gaps++;
  }
  return gaps;
}

// ─────────────────────────── پیش‌بینی تقاضا ───────────────────────────

/** تعداد گروه پیشنهادی از روی متقاضیان واقعی (سقف ۲۰ گروه) */
export function suggestedGroupCount(eligibleStudents: number, standardCapacity: number): number {
  if (!Number.isFinite(eligibleStudents) || eligibleStudents < 0) throw new Error('تعداد متقاضی نامعتبر است.');
  const cap = Number(standardCapacity);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error('ظرفیت استاندارد نامعتبر است.');
  if (eligibleStudents === 0) return 1; // حداقل یک گروه (حفظ درس در چارت)
  return Math.min(MAX_GROUPS, Math.max(1, Math.ceil(eligibleStudents / cap)));
}

/** توزیع سهمیهٔ گروه‌ها بین دانشکده‌ها بر اساس جمعیت متقاضی (برای زونینگ) */
export function distributeGroupsByFaculty(
  perFaculty: { facultyId: number | null; eligible: number }[],
  standardCapacity: number,
): { facultyId: number | null; eligible: number; groups: number }[] {
  return perFaculty
    .map(f => ({ ...f, groups: suggestedGroupCount(f.eligible, standardCapacity) }))
    .sort((a, b) => b.eligible - a.eligible);
}

// ─────────────────────────── سهمیهٔ کلاس‌ها (فاز ۱) ───────────────────────────

export interface RoomGrantInput {
  classroomId: number;
  capacity: number;
  shifts: Shift[];
}
export interface DeptShareInput {
  departmentId: number;
  activeStudents: number;
}

/**
 * تخصیص اولیهٔ سهمیهٔ (سالن، شیفت) به گروه‌های یک دانشکده — نسبت مستقیم با
 * جمعیت دانشجویان فعال هر گروه؛ کلاس‌های بزرگتر (ظرفیت بالاتر) اول به
 * گروه‌های پرجمعیت‌تر داده می‌شود. خروجی: لیست گرنت‌ها (قابل تست بدون DB).
 */
export function allocateQuotaShifts(
  rooms: RoomGrantInput[],
  depts: DeptShareInput[],
): { departmentId: number; classroomId: number; capacity: number; shift: Shift }[] {
  const totalStudents = depts.reduce((s, d) => s + d.activeStudents, 0);
  if (totalStudents <= 0 || rooms.length === 0) return [];
  const slots = rooms.reduce((s, r) => s + r.shifts.length, 0);

  const sortedRooms = [...rooms].sort((a, b) => b.capacity - a.capacity);
  const grants: { departmentId: number; classroomId: number; capacity: number; shift: Shift }[] = [];
  const pool = sortedRooms.flatMap(r => r.shifts.map(shift => ({ classroomId: r.classroomId, capacity: r.capacity, shift })));

  // سهمیهٔ هر گروه = نسبت جمعیت × کل اسلات‌ها (حداقل ۱، حداکثر کل استخر)
  const shares = depts
    .map(d => ({ ...d, quota: Math.max(1, Math.round((d.activeStudents / totalStudents) * slots)) }))
    .sort((a, b) => b.activeStudents - a.activeStudents);

  let cursor = 0;
  for (const d of shares) {
    for (let i = 0; i < d.quota && cursor < pool.length; i++) {
      const slot = pool[cursor++];
      grants.push({ departmentId: d.departmentId, classroomId: slot.classroomId, capacity: slot.capacity, shift: slot.shift });
    }
  }
  return grants;
}

// ─────────────────────────── ماشین فازها ───────────────────────────

const PHASE_ORDER: Record<SchedulingPhase, number> = { SUPPLY: 0, ALLOCATION: 1, REVIEW: 2, PUBLISHED: 3 };

export function canTransition(from: SchedulingPhase, to: SchedulingPhase): boolean {
  return PHASE_ORDER[to] === PHASE_ORDER[from] + 1;
}

/** آیا ویرایش برنامه در این فاز مجاز است؟ (هرگز در PUBLISHED) */
export function canEditInPhase(phase: SchedulingPhase): boolean {
  return phase === 'SUPPLY' || phase === 'ALLOCATION' || phase === 'REVIEW';
}

/** آیا کلاسِ استخر عمومی در این فاز قابل تخصیص است؟ (تأمین ≠ تخصیص) */
export function canAllocateInPhase(phase: SchedulingPhase): boolean {
  return phase === 'ALLOCATION' || phase === 'REVIEW';
}

// ─────────────────────────── سلامت برنامه ───────────────────────────

export const UTILIZATION = { underfilledThreshold: 0.5, fullThreshold: 0.9 } as const;

export type UtilizationClass = 'UNDERFILLED' | 'NORMAL' | 'FULL' | 'OVERBOOKED';

export function classifyUtilization(enrolled: number, capacity: number): UtilizationClass {
  if (capacity <= 0) return 'OVERBOOKED';
  const ratio = enrolled / capacity;
  if (ratio > 1) return 'OVERBOOKED';
  if (ratio >= UTILIZATION.fullThreshold) return 'FULL';
  if (ratio <= UTILIZATION.underfilledThreshold) return 'UNDERFILLED';
  return 'NORMAL';
}

/** بهره‌وری (سالن، شیفت) در مقابل ساعات قابل استفاده */
export function shiftUtilization(usedMinutes: number, shiftMinutes: number): number {
  if (shiftMinutes <= 0) return 0;
  return Math.min(1, usedMinutes / shiftMinutes);
}

// ─────────────────────────────────────────────────────────────────────────
// فاز ۶ — قیود سخت برنامهٔ هفتگی (Hard Constraints) — خالص و تست‌پذیر
// پاسخ به بازبینی (بند ۹): «۰٪ تداخل تضمین‌شده» فقط بعد از اثبات این چک‌هاست.
// این توابع هیچ DB نمی‌خوانند؛ داده از Scheduling Engine تزریق می‌شود.
// ─────────────────────────────────────────────────────────────────────────

/** یک ردیف برنامهٔ هفتگی برای قیود سخت */
export interface ScheduleConflictInput {
  offeringId: number;
  groupNumber: number | null;
  dayOfWeek: number | null;          // 0..6 (شنبه=0) — null = بدون روز (ناقص)
  startTime: string;                 // HH:MM
  endTime: string;
  roomId: number | null;
  requiredCapacity: number;          // ظرفیت کلاس (course_offerings.capacity)
  professorIds: (number | null)[];   // اصلی + استاد دوم (Co-Teaching)
  offeringTitle: string;
}

/** ظرفیت و عنوان سالن — مبنای چک ROOM_CAPACITY */
export interface RoomCapacityInfo {
  id: number;
  capacity: number;
  title: string;
}

export type ScheduleConflictType = 'ROOM_OVERLAP' | 'PROFESSOR_OVERLAP' | 'ROOM_CAPACITY';

export interface ScheduleConflict {
  type: ScheduleConflictType;
  severity: 'ERROR'; // قیود سخت همیشه ERROR اند (مانع انتشار برنامه)
  message: string;
  offeringIds: number[];
}

/**
 * تشخیص تداخل‌های سخت در یک برنامهٔ هفتگی:
 *   • ROOM_OVERLAP       → دو کلاس هم‌زمان در یک سالن
 *   • PROFESSOR_OVERLAP  → تداخل استاد (اصلی یا دوم) بین دو کلاس هم‌زمان
 *   • ROOM_CAPACITY      → ظرفیت کلاس بیشتر از ظرفیت فیزیکی سالن
 * ورودی باید پیش از تبدیل به اعشارِ واحد Toman ساده شده باشد؛ این‌جا فقط
 * مقایسهٔ زمانی با overlaps() موجود انجام می‌شود.
 */
export function detectScheduleConflicts(
  entries: ScheduleConflictInput[],
  rooms: RoomCapacityInfo[]
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  const byRoom = new Map<number | null, ScheduleConflictInput[]>();
  const byProf = new Map<number, ScheduleConflictInput[]>();

  for (const e of entries) {
    if (e.roomId != null) {
      const arr = byRoom.get(e.roomId) ?? [];
      arr.push(e);
      byRoom.set(e.roomId, arr);
    }
    for (const pid of e.professorIds) {
      if (pid == null) continue;
      const arr = byProf.get(pid) ?? [];
      arr.push(e);
      byProf.set(pid, arr);
    }
  }

  const sameDayOverlap = (a: ScheduleConflictInput, b: ScheduleConflictInput) =>
    a.dayOfWeek != null && a.dayOfWeek === b.dayOfWeek &&
    overlaps(toMinutes(a.startTime), toMinutes(a.endTime), toMinutes(b.startTime), toMinutes(b.endTime));

  // ROOM_OVERLAP
  for (const [roomId, list] of byRoom) {
    if (roomId == null) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (sameDayOverlap(list[i], list[j])) {
          conflicts.push({
            type: 'ROOM_OVERLAP',
            severity: 'ERROR',
            message: `سالن ${roomId}: «${list[i].offeringTitle}» و «${list[j].offeringTitle}» هم‌زمان‌اند.`,
            offeringIds: [...new Set([list[i].offeringId, list[j].offeringId])],
          });
        }
      }
    }
  }

  // PROFESSOR_OVERLAP (استاد اصلی یا دوم)
  for (const [profId, list] of byProf) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (sameDayOverlap(list[i], list[j])) {
          conflicts.push({
            type: 'PROFESSOR_OVERLAP',
            severity: 'ERROR',
            message: `استاد ${profId}: تداخل بین «${list[i].offeringTitle}» و «${list[j].offeringTitle}».`,
            offeringIds: [...new Set([list[i].offeringId, list[j].offeringId])],
          });
        }
      }
    }
  }

  // ROOM_CAPACITY
  const roomCap = new Map(rooms.map((r) => [r.id, r]));
  for (const e of entries) {
    const room = e.roomId != null ? roomCap.get(e.roomId) : undefined;
    if (room && e.requiredCapacity > room.capacity) {
      conflicts.push({
        type: 'ROOM_CAPACITY',
        severity: 'ERROR',
        message: `سالن «${room.title}» (ظرفیت ${room.capacity}) برای «${e.offeringTitle}» (${e.requiredCapacity} نفر) کوچک است.`,
        offeringIds: [e.offeringId],
      });
    }
  }

  return conflicts;
}

/** آیا برنامه بدون هیچ قید سخت نقض‌شده است؟ (پیش‌شرط انتشار) */
export function hasHardConflicts(conflicts: ScheduleConflict[]): boolean {
  return conflicts.length > 0;
}

/**
 * تاریخ جلسات یک درس در ترم — خالص، بدون DB.
 * قرارداد: dayOfWeek: 0..6 (شنبه = 0)، termStart تاریخ اولین روز هفتهٔ اول است.
 *   ALL  → ۱۶ جلسهٔ هفتگی
 *   EVEN → هفته‌های زوج (جلسات ۲، ۴، …، ۱۶ — ۸ جلسه)
 *   ODD  → هفته‌های فرد (جلسات ۱، ۳، …، ۱۵ — ۸ جلسه)
 * خروجی: sessionNo (از ۱) + Date میلادی — تبدیل به شمسی در لایهٔ DB انجام می‌شود.
 */
export function sessionDatesFor(
  termStart: Date,
  dayOfWeek: number,
  scheduleType: 'ALL' | 'EVEN' | 'ODD',
  totalSessions = 16
): { sessionNo: number; date: Date }[] {
  if (dayOfWeek < 0 || dayOfWeek > 6) return [];
  const base = new Date(termStart.getTime());
  base.setUTCHours(0, 0, 0, 0);
  const offsetDays = dayOfWeek; // شنبه = 0
  const first = new Date(base.getTime() + offsetDays * 86400000);
  const out: { sessionNo: number; date: Date }[] = [];
  let no = 1;
  for (let w = 0; w < totalSessions; w++) {
    const week = w + 1; // 1-based
    const take = scheduleType === 'ALL' || (scheduleType === 'EVEN' && week % 2 === 0) || (scheduleType === 'ODD' && week % 2 === 1);
    if (take) {
      out.push({ sessionNo: no, date: new Date(first.getTime() + w * 7 * 86400000) });
      no++;
    }
  }
  return out;
}
// ═══════════════════════════════════════════════════════════════════════
// فاز ۶ — قیود سخت V2 + مولد تاریخ جلسات (خالص و تست‌پذیر)
// ═══════════════════════════════════════════════════════════════════════

/** قیود سخت V2: خروجیِ ساختاریافتهٔ «قبل از امتیازدهی» — نه KPI تبلیغاتی */
export type HardConflictKind = 'PROFESSOR_OVERLAP' | 'ROOM_OVERLAP' | 'CAPACITY_OVERFLOW';

export interface HardConflictEntry {
  offeringId: number;
  groupNumber: number;
  courseCode: string;
  /** استاد اصلی + استاد دوم (Co-Teaching از offering_professors) */
  professorIds: number[];
  roomId: number | null;
  dayOfWeek: number;      // 0..6 (شنبه=0)
  startMinutes: number;
  endMinutes: number;
  enrolledCount: number;  // ثبت‌نام‌شدهٔ واقعی (یا پیش‌بینی تقاضا)
  capacity: number;       // ظرفیت سالن (0 = نامشخص)
}

export interface HardConflict {
  kind: HardConflictKind;
  offeringIds: [number, number] | [number];
  message: string;
}

/**
 * تشخیص قیود سخت روی جدول زمان‌بندی‌شده:
 *  - CAPACITY_OVERFLOW: ظرفیت سالن < تعداد ثبت‌نامی
 *  - PROFESSOR_OVERLAP: استاد (اصلی یا دوم) در دو کلاس هم‌زمان
 *  - ROOM_OVERLAP:       یک سالن در دو کلاس هم‌زمان
 * پیام‌ها از داده ساخته می‌شوند (نه ثابت).
 */
/** سقف پیش‌فرض تعداد تداخل‌های *فهرست‌شده* (شمارش کامل جداگانه برمی‌گردد) */
export const HARD_CONFLICT_LIST_LIMIT = 500;

export interface HardConflictReport {
  /** حداکثر `limit` مورد — برای نمایش به کاربر */
  conflicts: HardConflict[];
  /** شمار واقعی همهٔ تداخل‌ها (بدون سقف) */
  total: number;
  /** آیا فهرست بریده شده است؟ */
  truncated: boolean;
}

/**
 * یافتن قیدهای سختِ برنامهٔ درسی.
 *
 * ⚠️ چرا این تابع بازنویسی شد: نسخهٔ قبلی همهٔ جفت‌های ممکن را می‌سنجید
 * (O(n²)) و برای *هر* جفتِ متداخل یک شیء با پیام متنی می‌ساخت. روی داده‌ای
 * در مقیاس واقعی (۳۳۰۰ ارائهٔ درس در یک ترم) این کار حافظهٔ Node را تمام
 * می‌کرد و **کل سرور** — نه فقط این صفحه — با «heap out of memory» می‌مرد.
 *
 * حالا:
 *   • مقایسه فقط درون سطل‌های «روز+سالن» و «روز+استاد» انجام می‌شود (تداخل
 *     تعریفاً جز در این دو حالت ممکن نیست)، با جاروی خطی روی زمان شروع؛
 *   • شمارش کامل با شمارندهٔ عددی است (بدون تخصیص حافظه)، ولی فقط `limit`
 *     مورد نخست به‌صورت شیء ساخته می‌شود.
 * خروجی از نظر معنا با نسخهٔ قبل یکسان است: همان جفت‌ها، همان نوع‌ها.
 */
export function analyzeHardConflicts(
  rows: HardConflictEntry[],
  limit: number = HARD_CONFLICT_LIST_LIMIT,
): HardConflictReport {
  const out: HardConflict[] = [];
  let total = 0;
  const push = (c: () => HardConflict) => {
    total++;
    if (out.length < limit) out.push(c());
  };

  // ── ۱) سرریز ظرفیت: مستقل از بقیه، خطی ──
  for (const r of rows) {
    if (r.capacity > 0 && r.enrolledCount > r.capacity) {
      push(() => ({
        kind: 'CAPACITY_OVERFLOW',
        offeringIds: [r.offeringId],
        message: `«${r.courseCode}» گروه ${r.groupNumber}: ${r.enrolledCount} ثبت‌نامی در کلاس با ظرفیت ${r.capacity}`,
      }));
    }
  }

  // ── ۲) تداخل‌های زمانی، فقط درون سطل‌های هم‌روزِ هم‌سالن / هم‌استاد ──
  // ترتیب خروجی مثل قبل بر پایهٔ جایگاه ردیف در ورودی است (idx).
  type Item = { idx: number; r: HardConflictEntry };
  const buckets = new Map<string, Item[]>();
  const add = (key: string, it: Item) => {
    const b = buckets.get(key);
    if (b) b.push(it); else buckets.set(key, [it]);
  };
  rows.forEach((r, idx) => {
    if (r.roomId != null) add(`R|${r.dayOfWeek}|${r.roomId}`, { idx, r });
    for (const p of r.professorIds) add(`P|${r.dayOfWeek}|${p}`, { idx, r });
  });

  // برای اینکه یک جفتِ «هم‌استادِ چنداستادی» دوبار شمرده نشود
  const seenProfPair = new Set<number>();
  const pairKey = (i: number, j: number) => (i < j ? i * 1e7 + j : j * 1e7 + i);

  for (const [key, items] of buckets) {
    if (items.length < 2) continue;
    const isRoom = key.charCodeAt(0) === 82; // 'R'
    items.sort((a, b) => a.r.startMinutes - b.r.startMinutes || a.idx - b.idx);
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        // مرتب‌شده بر اساس شروع: از اولین ردیفی که دیرتر از پایان a شروع شود، بقیه هم متداخل نیستند
        if (b.r.startMinutes >= a.r.endMinutes) break;
        if (!overlaps(a.r.startMinutes, a.r.endMinutes, b.r.startMinutes, b.r.endMinutes)) continue;
        const [x, y] = a.idx < b.idx ? [a, b] : [b, a];
        if (isRoom) {
          push(() => ({
            kind: 'ROOM_OVERLAP',
            offeringIds: [x.r.offeringId, y.r.offeringId],
            message: `تداخل سالن: «${x.r.courseCode}» گروه ${x.r.groupNumber} با «${y.r.courseCode}» گروه ${y.r.groupNumber}`,
          }));
        } else {
          const k = pairKey(x.idx, y.idx);
          if (seenProfPair.has(k)) continue;
          seenProfPair.add(k);
          push(() => ({
            kind: 'PROFESSOR_OVERLAP',
            offeringIds: [x.r.offeringId, y.r.offeringId],
            message: `تداخل استاد: «${x.r.courseCode}» گروه ${x.r.groupNumber} با «${y.r.courseCode}» گروه ${y.r.groupNumber}`,
          }));
        }
      }
    }
  }

  return { conflicts: out, total, truncated: total > out.length };
}

/** نسخهٔ سازگار با کد قبلی — فهرستِ سقف‌دار (برای شمار دقیق از analyzeHardConflicts استفاده کنید) */
export function detectHardConflicts(
  rows: HardConflictEntry[],
  limit: number = HARD_CONFLICT_LIST_LIMIT,
): HardConflict[] {
  return analyzeHardConflicts(rows, limit).conflicts;
}

// ─────────────────────────── تاریخ جلسات ───────────────────────────

export type WeekRecurrence = 'ALL' | 'EVEN' | 'ODD';

export interface SessionDateInput {
  /** شروع ترم (Date از academic_terms.startDate) — پایهٔ محاسبه در صورت نبود classStartDate */
  termStart: Date;
  /** شروع کلاس‌ها (academic_terms.classStartDate) — اگر داده شود بر termStart مقدم است */
  classStartDate?: Date;
  /** پایان کلاس‌ها (academic_terms.classEndDate) — جلسه‌ای پس از آن ساخته نمی‌شود */
  classEndDate?: Date;
  /** 0..6 (شنبه=0) */
  dayOfWeek: number;
  /** تعداد جلسات (پیش‌فرض ۱۶) */
  sessionsCount: number;
  /** هفتهٔ اول ترم «فرد» است؟ (برای EVEN/ODD — پیش‌فرض: بله) */
  oddFirstWeek?: boolean;
  /** تاریخ‌های تعطیل رسمی 'YYYY/MM/DD' شمسی — حذف خودکار */
  holidays?: string[];
}

export interface GeneratedSession {
  sessionNo: number;
  /** 'YYYY/MM/DD' شمسی */
  jalaliDate: string;
  jm: number;
  jd: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** روز هفتهٔ 0..6 (شنبه=0) → باقی‌ماندهٔ JDN بر ۷ (شنبه=5) */
function jalaliWeekdayToJdnMod(dow: number): number {
  return (5 + dow) % 7;
}

/**
 * تولید تاریخ جلسات هفتگی یک کلاس:
 *  - مبدأ = classStartDate اگر داده شده، وگرنه startDate ترم
 *  - اولین تکرارِ روزِ هفته روی/بعد از مبدأ
 *  - گام ۷ روزه تا رسیدن به sessionsCount (یا تا پایان classEndDate)
 *  - هفته‌های زوج/فرد و تعطیلات رسمی حذف می‌شوند
 *  - سقف ایمنی ۴۰ هفته (جلوگیری از حلقهٔ بی‌پایان)
 */
export function computeSessionDates(
  px: SessionDateInput & { recurrence?: WeekRecurrence },
): GeneratedSession[] {
  const { termStart, dayOfWeek, sessionsCount, oddFirstWeek = true } = px;
  if (dayOfWeek < 0 || dayOfWeek > 6) throw new Error('روز هفته باید ۰..۶ باشد (شنبه=۰).');
  if (sessionsCount < 1 || sessionsCount > 60) throw new Error('تعداد جلسات باید ۱..۶۰ باشد.');
  const holidays = new Set((px.holidays ?? []).map(h => h.trim()).filter(Boolean));
  // مبدأ جلسات: شروع کلاس‌ها، با fallback به شروع ترم
  const base = px.classStartDate ?? termStart;
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const endCap = px.classEndDate ? new Date(px.classEndDate.getFullYear(), px.classEndDate.getMonth(), px.classEndDate.getDate()) : null;
  const j0 = toJalaliFromDate(start);
  let jdn = j2d(j0.jy, j0.jm, j0.jd);
  const target = jalaliWeekdayToJdnMod(dayOfWeek);
  while ((((jdn % 7) + 7) % 7) !== target) jdn += 1;
  const out: GeneratedSession[] = [];
  let weekIndex = 1;
  for (let guard = 0; guard < 40 * 7 && out.length < sessionsCount; guard++) {
    const isEven = weekIndex % 2 === 0;
    const rec = px.recurrence ?? 'ALL';
    const weekOk = rec === 'ALL'
      ? true
      : oddFirstWeek
        ? (isEven ? rec === 'EVEN' : rec === 'ODD')
        : (isEven ? rec === 'ODD' : rec === 'EVEN');
    const j = d2j(jdn);
    const ds = `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`;
    // توقف اگر از پایان کلاس‌ها گذشته باشیم
    if (endCap) {
      const gg = toGregorian(j.jy, j.jm, j.jd);
      const cur = new Date(gg.gy, gg.gm - 1, gg.gd);
      if (cur > endCap) break;
    }
    if (weekOk && !holidays.has(ds)) {
      out.push({ sessionNo: out.length + 1, jalaliDate: ds, jm: j.jm, jd: j.jd });
    }
    jdn += 7;
    weekIndex += 1;
  }
  return out;
}

/** تبدیل تاریخ شمسی 'YYYY/MM/DD' به Date میلادی (ذخیره در academic_terms) */
export function parseJalaliDate(s: string): Date {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s.trim());
  if (!m) throw new Error(`قالب تاریخ شمسی نامعتبر: «${s}» (مورد انتظار YYYY/MM/DD)`);
  const { gy, gm, gd } = toGregorian(Number(m[1]), Number(m[2]), Number(m[3]));
  return new Date(gy, gm - 1, gd);
}

/** تاریخ شمسی 'YYYY/MM/DD' از Date میلادی */
export function jalaliDateOf(d: Date): string {
  const j = toJalaliFromDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  return `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`;
}


// ═══════════════════════════════════════════════════════════════════════
//  هستهٔ خالص کارنامه — بدون React، بدون DB، بدون DOM.
//  معدل/مشروطی/تفکیک نوع درس + تبدیل تاریخ جلالی + رقم و حروف فارسی.
//  همه قابل Unit Test → tests/transcript-summary.test.ts
// ═══════════════════════════════════════════════════════════════════════
import type { TranscriptRow } from './actions';
import type { TermGroup, TranscriptSummary } from './types';
export type { TranscriptRow } from './actions';
import type { RegulationConfig } from '@/lib/regulations-engine';
import {
  GRADE_STATUS_CODES,
  NON_GPA_CODES,
  NON_TERM_GPA_CODES,
  REGULATION_FROZEN_CODES,
  isPassedStatusCode,
  isDroppedStatusCode,
} from '@/lib/grade-status-codes';

/** true اگر این ردیف کارنامه نباید در معدل کل دانشگاه اثر کند (مثل ۱۲: جبرانی بدون احتساب) */
export const isNonGpaRow = (r: Pick<TranscriptRow, 'gradeStatusCode'>): boolean => {
  const c = r.gradeStatusCode?.trim();
  return !!c && NON_GPA_CODES.has(c);
};

/** true اگر این ردیف کارنامه نباید در معدل نیمسال اثر کند */
export const isNonTermGpaRow = (r: Pick<TranscriptRow, 'gradeStatusCode'>): boolean => {
  const c = r.gradeStatusCode?.trim();
  return !!c && NON_TERM_GPA_CODES.has(c);
};

/* ── کارنامه رسمی: گروه‌بندی ترم + معدل ── */
export const numOrNull = (v: string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** آستانه‌های اجرایی آیین‌نامه ملاک (پیش‌فرض: قبولی ۱۰، مشروطی ۱۲) */
export type RegThresholds = {
  pass: number;
  prob: number;
  exclFailed: boolean;        // حذف مردودی از کل (EXCLUDE_IF_PASSED یا EXCLUDE_IF_PASSED_1391)
  exclFromTerm: boolean;      // حذف مردودی از نیمسال (فقط EXCLUDE_IF_PASSED_1391)
  retakeMinGrade: number;     // حد نصاب قبولی مجدد (فقط تبصره ۱۳۹۱)
  is1391: boolean;            // سیاست تبصره ۱۳۹۱ فعال است
  regulationLabel?: string;   // برچسب آیین‌نامه
  dedupeRepeated: boolean;    // فقط بهترین نمرهٔ هر کد درس در معدل کل شمرده شود (سوییچ ادمین)
  minUnits: number;           // حدنصاب واحد ترم برای احتساب مشروطی (۰ = آیین‌نامه حد ندارد، رفتار قبلی)
};
export function regThresholds(cfg: RegulationConfig | null | undefined): RegThresholds {
  const passRaw = cfg?.grading_and_gpa?.default_passing_grade;
  const probRaw = cfg?.probation_and_tenure?.probation_gpa_threshold;
  const retakeRaw = cfg?.grading_and_gpa?.retakeMinGrade;
  const pass = passRaw != null ? Number(passRaw) : 10;
  const prob = probRaw != null ? Number(probRaw) : 12;
  const policy = cfg?.grading_and_gpa?.failed_course_gpa_policy;
  const retakeMin = retakeRaw != null ? Number(retakeRaw) : pass;
  const minRaw = cfg?.regular_term_rules?.min_units ?? cfg?.levels?.LONG?.min_units ?? cfg?.levels?.SHORT?.min_units;
  const minUnits = minRaw != null ? Number(minRaw) : 0;
  return {
    pass: Number.isFinite(pass) ? pass : 10,
    prob: Number.isFinite(prob) ? prob : 12,
    exclFailed: policy === 'EXCLUDE_ALWAYS' || policy === 'EXCLUDE_IF_PASSED' || policy === 'EXCLUDE_IF_PASSED_1391',
    exclFromTerm: policy === 'EXCLUDE_IF_PASSED_1391',
    retakeMinGrade: Number.isFinite(retakeMin) ? retakeMin : 10,
    is1391: policy === 'EXCLUDE_IF_PASSED_1391',
    regulationLabel: cfg?.grading_and_gpa?.regulationLabel,
    dedupeRepeated: cfg?.grading_and_gpa?.dedupeRepeatedCourses === true,
    minUnits: Number.isFinite(minUnits) && minUnits > 0 ? minUnits : 0,
  };
}

/** درس‌هایی که دست‌کم یک بار با حد نصاب لازم قبول شده‌اند (برای سیاست حذف مردودی از معدل کل) */
export function passedCourseSet(rows: TranscriptRow[], minGrade: number): Set<string> {
  const set = new Set<string>();
  for (const r of rows) {
    const g = numOrNull(r.gradeValue);
    if (r.gradeStatus === 'EXEMPT' || r.gradeStatus === 'PASSED_NO_GRADE') set.add(r.courseCode);
    else if (isPassedStatusCode(r.gradeStatusCode)) set.add(r.courseCode);
    else if (g !== null && g >= minGrade && r.gradeStatus === 'FINALIZED') set.add(r.courseCode);
  }
  return set;
}

/** حد نصاب «قبول مجدد» برای حذف مردودی: فقط تبصره ۱۳۹۱ از retakeMinGrade استفاده می‌کند */
export const retakeBar = (th: RegThresholds): number => (th.is1391 ? th.retakeMinGrade : th.pass);

export function summarizeTerm(rows: TranscriptRow[], pass = 10): { taken: number; passed: number; failed: number; wsum: number; wunits: number; dropped: number } {
  let taken = 0, passed = 0, failed = 0, wsum = 0, wunits = 0, dropUnits = 0;
  for (const r of rows) {
    const u = numOrNull(r.units) ?? 0;
    const g = numOrNull(r.gradeValue);
    const code = r.gradeStatusCode?.trim() || null;
    const dropped = isDroppedStatusCode(code);
    // وضع ۷ (حذف توسط شورای آموزشی)، ۶ (حذف اضطراری) و ۵ (غیبت در جلسه امتحان):
    // در «اخذشده» حساب می‌شوند ولی نه در «گذرانده/موثر» و نه در معدل.
    const takenOnly = code === '7' || code === '6' || code === '5';

    if (r.gradeStatus === 'PENDING') continue;

    // دروس حذف‌شده (پزشکی و ...) در جدول ترم نمایش داده می‌شوند ولی در واحدهای ترم/مردودی/معدل احتساب نمی‌شوند؛
    // به‌جز وضع ۷ (حذف شورا) و ۶ (حذف اضطراری) که باید در «اخذشده» بیایند.
    // واحد حذف‌شده‌ها جداگانه جمع می‌شود تا در سطر «حذف» سما چاپ شود.
    if (dropped && !takenOnly) { dropUnits += u; continue; }

    taken += u;
    // اخذشده‌ی خالص: نه گذرانده، نه مردودی، نه معدل (نمرهٔ آن در هیچ معدلی اثر ندارد)
    if (takenOnly) continue;

    const isPassed = r.gradeStatus === 'EXEMPT' ||
                     r.gradeStatus === 'PASSED_NO_GRADE' ||
                     isPassedStatusCode(code) ||
                     (g !== null && g >= pass);

    if (isPassed) {
      passed += u;
    } else {
      failed += u;
    }

    // معدل نیمسال: فقط نمرات FINALIZED که طبق کد وضع نمره در معدل نیمسال اثر دارند
    if (g !== null && r.gradeStatus === 'FINALIZED' && !isNonTermGpaRow(r)) {
      wsum += g * u;
      wunits += u;
    }
  }
  return { taken, passed, failed, wsum, wunits, dropped: dropUnits };
}

/** برای هر کد درس، تنها رکورد با بالاترین نمرهٔ FINALIZED را نگه می‌دارد (برای dedupeRepeatedCourses) */
export function bestFinalizedRowPerCourse(rows: TranscriptRow[]): Map<string, TranscriptRow> {
  const best = new Map<string, TranscriptRow>();
  for (const r of rows) {
    if (r.gradeStatus !== 'FINALIZED') continue;
    const g = numOrNull(r.gradeValue);
    if (g === null) continue;
    const cur = best.get(r.courseCode);
    const curG = cur ? numOrNull(cur.gradeValue) : null;
    if (!cur || curG === null || g > curG) best.set(r.courseCode, r);
  }
  return best;
}

/** جمع معدل کل با سیاست نمره مردودی آیین‌نامه */
export function summarizeTotal(rows: TranscriptRow[], th: RegThresholds): { wsum: number; wunits: number } {
  const passedSet = th.exclFailed ? passedCourseSet(rows, retakeBar(th)) : null;
  const bestRow = th.dedupeRepeated ? bestFinalizedRowPerCourse(rows) : null;
  let wsum = 0, wunits = 0;
  for (const r of rows) {
    const u = numOrNull(r.units) ?? 0;
    const g = numOrNull(r.gradeValue);
    if (g === null || r.gradeStatus !== 'FINALIZED') continue;
    // کدهای سمای بدون احتساب در معدل کل یا حذف‌شده کنار گذاشته می‌شوند
    if (isNonGpaRow(r) || isDroppedStatusCode(r.gradeStatusCode)) continue;
    // dedupeRepeatedCourses: اگر این تلاش بهترین نمرهٔ همین درس نیست، از معدل کل کنار گذاشته می‌شود
    if (bestRow && bestRow.get(r.courseCode) !== r) continue;
    // EXCLUDE_IF_PASSED: مردودی درسی که بعداً قبول شده از معدل کل حذف می‌شود
    if (passedSet && g < th.pass && passedSet.has(r.courseCode)) continue;
    wsum += g * u;
    wunits += u;
  }
  return { wsum, wunits };
}

export function groupTranscript(rows: TranscriptRow[], cfg?: RegulationConfig | null): TranscriptSummary {
  const th = regThresholds(cfg);
  const passedSet = th.exclFailed ? passedCourseSet(rows, retakeBar(th)) : null;
  const map = new Map<string, TranscriptRow[]>();
  for (const r of rows) {
    const k = r.termCode || '—';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  const terms: TermGroup[] = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'en'))
    .flatMap(([termCode, rs]) => {
      // حذف در حذف و اضافه (کد ۱-) در کارنامه رسمی نمایش داده نمی‌شود (در سوابق نمرات هست)
      const visibleRows = rs.filter(r => (r.gradeStatusCode?.trim() ?? '') !== '-1');
      if (visibleRows.length === 0) return [];
      // اعمال حذف مردودی از نیمسال (فقط EXCLUDE_IF_PASSED_1391)
      // کدهای منجمد (۵/۶/۷/۲۲) آیین‌نامه رویشان اثر ندارد: نه تغییر، نه برچسب
      let effectiveRows = visibleRows;
      if (th.exclFromTerm && passedSet) {
        effectiveRows = rs.map(r => {
          const code = (r.gradeStatusCode || '').trim();
          if (code && REGULATION_FROZEN_CODES.has(code)) return r;
          const g = numOrNull(r.gradeValue);
          if (g !== null && g < th.pass && passedSet.has(r.courseCode) && r.gradeStatus === 'FINALIZED') {
            return { ...r, _excludedByRegulation: th.regulationLabel || 'آیین‌نامه ۱۳۹۱' };
          }
          return r;
        });
      }
      const s = summarizeTerm(effectiveRows, th.pass);
      const gpa = s.wunits ? s.wsum / s.wunits : null;
      const termTitle = rs.find(r => r.termTitle)?.termTitle ?? null;
      const isSummer = termCode.endsWith('3') || (termTitle?.includes('تابستان') ?? false);
      const isEquiv = termCode.endsWith('5') || termCode.toUpperCase().includes('EQ') || (termTitle?.includes('معادل') ?? false);
      const canHaveProbation = !isSummer && !isEquiv;
      // حدنصاب واحد: اگر واحد اخذشدهٔ ترم (پس از حذف‌ها) از کف آیین‌نامه کمتر باشد، مشروطی احتساب نمی‌شود
      const unitsOk = th.minUnits > 0 ? s.taken >= th.minUnits : true;
      const fileProb = rs.find(r => r.termProbation !== null)?.termProbation ?? null;
      return [{
        termCode, termTitle,
        termStatusTitle: rs.find(r => r.termStatusTitle)?.termStatusTitle ?? null,
        probation: canHaveProbation && unitsOk ? (fileProb ?? (gpa !== null && gpa < th.prob)) : false,
        rows: effectiveRows,
        taken: s.taken, passed: s.passed, failed: s.failed, points: s.wsum,
        gpa,
        /** واحدهای موثر در معدل نیمسال (مخرج معدل) — سطر «موثر» سما */
        effectiveUnits: s.wunits,
        /** واحدهای حذف‌شدهٔ احتساب‌نشده در اخذشده — سطر «حذف» سما */
        droppedUnits: s.dropped,
        cumTaken: 0, cumPassed: 0, cumFailed: 0, cumPoints: 0, cumGpa: null, cumEffectiveUnits: 0,
      }];
    });
  // جمع تجمیعی «کل» تا پایان هر نیمسال (معدل کل با سیاست نمره مردودی آیین‌نامه)
  let ct = 0, cp = 0, cf = 0, cw = 0, cwu = 0;
  for (const t of terms) {
    const s = summarizeTerm(t.rows, th.pass);
    ct += s.taken; cp += s.passed; cf += s.failed;
    for (const r of t.rows) {
      const u = numOrNull(r.units) ?? 0;
      const g = numOrNull(r.gradeValue);
      if (g === null || r.gradeStatus !== 'FINALIZED') continue;
      if (isNonGpaRow(r) || isDroppedStatusCode(r.gradeStatusCode)) continue;
      if (passedSet && g < th.pass && passedSet.has(r.courseCode)) continue;
      cw += g * u; cwu += u;
    }
    t.cumTaken = ct; t.cumPassed = cp; t.cumFailed = cf;
    t.cumPoints = cw; t.cumGpa = cwu ? cw / cwu : null; t.cumEffectiveUnits = cwu;
  }
  const all = summarizeTerm(rows, th.pass);
  const tot = summarizeTotal(rows, th);
  return { terms, totalTaken: all.taken, totalPassed: all.passed, gpa: tot.wunits ? tot.wsum / tot.wunits : null, passGrade: th.pass, probThreshold: th.prob, minUnits: th.minUnits };
}

export const faNum = (n: number | null | undefined, digits = 2): string =>
  n == null ? '—' : n.toLocaleString('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** ارقام لاتین → فارسی (برای سال/کد ترم؛ بدون جداکنندهٔ هزارگان) */
export const faDigits = (v: string | number): string =>
  String(v).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[+d]);

/** رشتهٔ عددی خام سما (مثل '12.75') → فارسی با گردکردن (غیرعددی دست‌نخورده، خالی → خط تیره) */
export const faStr = (v: string | null | undefined, digits = 2): string => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return faNum(n, digits);
};

/**
 * عنوان نمایشی نیمسال برای سربرگ کارنامهٔ سما («نیمسال اول ۱۴۰۳-۱۴۰۴»).
 * اگر عنوان واقعی از فایل آمده همان می‌ماند؛ فقط کدهای خامی مثل «ترم 14002»
 * یا «14002» (سال ۴رقمی/۳رقمی + شمارهٔ نیمسال) به فارسی ساخته می‌شوند.
 */
export function termDisplayTitle(termCode: string, termTitle: string | null): string {
  const t = (termTitle || '').trim();
  if (t && !/^(ترم\s*)?\d{4,6}$/.test(t)) return t;
  const code = (termCode || '').trim();
  const m = code.match(/^(\d{3,4})(\d)$/);
  if (m) {
    const y = m[1].length === 4 ? +m[1] : 1000 + +m[1];
    const s = +m[2];
    const range = `${faDigits(y)}-${faDigits(y + 1)}`;
    if (s === 1) return `نیمسال اول ${range}`;
    if (s === 2) return `نیمسال دوم ${range}`;
    if (s === 3) return `تابستان ${range}`;
    if (s === 5) return `معادل‌سازی ${range}`;
  }
  if (/EQ/i.test(code)) return `معادل‌سازی ${faDigits(code)}`;
  return code.endsWith('3') ? 'نیمسال تابستان' : 'نیمسال';
}

/**
 * تاریخ شروع تحصیل از سال+ترم ورودی (ترم ۱: اول مهر، ترم ۲: اول بهمن).
 * چون فقط سال و شماره ترم ذخیره می‌شود، روز/ماه قراردادی است.
 */
export function entryDateFa(entryYear: number | null | undefined, entryTerm: number | null | undefined): string {
  if (entryYear == null || !Number.isFinite(Number(entryYear))) return '—';
  const y = Number(entryYear);
  const md = Number(entryTerm) === 2 ? '11/01' : '07/01';
  return faDigits(`${y}/${md}`);
}
/**
 * رشتهٔ راهنمای دامنه‌های کیفی پایان‌نامه برای خط «توضیح وضع نمرات» سما.
 * (سازگار با thesisQualitativeLabel؛ اگر حد قبولی ≥۱۲ باشد «قابل قبول» ندارد)
 */
export function thesisLegend(pass = 10): string {
  const f0 = (n: number) => faNum(n, 0);
  const f2 = (n: number) => faNum(n);
  const parts = [`مردود (کمتر از ${f0(pass)})`];
  if (pass < 12) parts.push(`قابل قبول (${f0(pass)} تا ${f2(11.99)})`);
  parts.push(`خوب (${f0(Math.max(12, pass))} تا ${f2(14.99)})`);
  parts.push(`خیلی خوب (${f0(15)} تا ${f2(17.99)})`);
  parts.push(`عالی (${f0(18)} تا ${f0(20)})`);
  return parts.join(' · ');
}
/**
 * نمرهٔ عددی پایان‌نامه → برچسب کیفی برای چاپ («عالی» تا «مردود»).
 * مقیاس پیش‌فرض: ۱۸–۲۰ عالی، ۱۵–۱۸ خیلی خوب، ۱۲–۱۵ خوب، حد قبولی–۱۲ قابل قبول.
 */
export function thesisQualitativeLabel(g: number | null, pass = 10): string {
  if (g === null || !Number.isFinite(g)) return '—';
  if (g >= 18) return 'عالی';
  if (g >= 15) return 'خیلی خوب';
  if (g >= 12) return 'خوب';
  if (g >= pass) return 'قابل قبول';
  return 'مردود';
}

/** میلادی → جلالی (برای تاریخ تهیه/تولد در کارنامه) */
export function g2j(gy: number, gm: number, gd: number): [number, number, number] {
  const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  let jl = 0, jm = 0, jd = 0;
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + ~~((gy2 + 3) / 4) - ~~((gy2 + 99) / 100) + ~~((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * ~~(days / 12053);
  days %= 12053;
  jy += 4 * ~~(days / 1461);
  days %= 1461;
  if (days > 365) { jy += ~~((days - 1) / 365); days = (days - 1) % 365; }
  const jm0 = days < 186 ? 1 + ~~(days / 31) : 7 + ~~((days - 186) / 30);
  const jd0 = days < 186 ? 1 + (days % 31) : 1 + ((days - 186) % 30);
  jl = jy; jm = jm0; jd = jd0;
  void breaks;
  return [jl, jm, jd];
}

export function todayJalali(): string {
  const d = new Date();
  const [jy, jm, jd] = g2j(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

export function dateToJalali(v: string | null | undefined): string {
  if (!v) return '—';
  const s = String(v);
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) {
    // فرمت‌های دیگر (مثل خروجی Date) را با Date پارس کن
    const d = new Date(s);
    if (isNaN(d.getTime())) return s.slice(0, 10);
    m = [ '', String(d.getUTCFullYear()), String(d.getUTCMonth() + 1), String(d.getUTCDate()) ];
  }
  const [jy, jm, jd] = g2j(+m[1], +m[2], +m[3]);
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

/** معدل به حروف فارسی (مثل «هفده و بیست و شش صدم») */
export const FA_ONES = ['صفر', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه', 'ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده', 'بیست'];
/** ده‌تایی‌ها — بدون این جدول، اعداد رُندِ ده‌تایی (۳۰، ۵۰، …) اشتباه ساخته می‌شد */
export const FA_TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];

/** عدد صحیح ۰..۹۹ به حروف فارسی */
export function faIntWords(n: number): string {
  if (n <= 20) return FA_ONES[n];
  const t = Math.floor(n / 10), o = n % 10;
  return o === 0 ? FA_TENS[t] : `${FA_TENS[t]} و ${FA_ONES[o]}`;
}

export function faWords(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const neg = n < 0 ? 'منفی ' : '';
  const a = Math.abs(Math.round(n * 100) / 100);
  const ip = Math.floor(a);
  const fp = Math.round((a - ip) * 100);
  if (ip >= 100) return `${neg}${faNum(a)}`;
  const ipW = faIntWords(ip);
  if (!fp) return `${neg}${ipW}`;
  return `${neg}${ipW} و ${faIntWords(fp)} صدم`;
}

/** نرمال‌سازی نوع درس به ۶ ستون جدول سما */
export function courseTypeGroup(t: string | null | undefined): string {
  const s = (t || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  if (/پایان.?نامه|thesis/i.test(s)) return 'پایان‌نامه';
  if (/جبران/i.test(s)) return 'جبرانی';
  if (/اختیار/i.test(s)) return 'اختیاری';
  if (/پایه/i.test(s)) return 'پایه';
  if (/اصلی|تخصص/i.test(s)) return 'اصلی-تخصصی';
  if (/عموم/i.test(s)) return 'عمومی';
  return 'اختیاری';
}

export type TypeBreakdown = { type: string; units: number; gpa: number | null };
export function breakdownByType(rows: TranscriptRow[], cfg?: RegulationConfig | null): TypeBreakdown[] {
  const th = regThresholds(cfg);
  const order = ['عمومی', 'پایه', 'اصلی-تخصصی', 'اختیاری', 'جبرانی', 'پایان‌نامه'];
  const passedSet = th.exclFailed ? passedCourseSet(rows, retakeBar(th)) : null;
  const acc = new Map<string, { units: number; wsum: number; wunits: number }>();
  for (const r of rows) {
    const code = r.gradeStatusCode?.trim() || null;
    if (isDroppedStatusCode(code)) continue;
    const g = courseTypeGroup(r.courseType);
    if (!acc.has(g)) acc.set(g, { units: 0, wsum: 0, wunits: 0 });
    const a = acc.get(g)!;
    const u = numOrNull(r.units) ?? 0;
    const gv = numOrNull(r.gradeValue);
    const isPassed = r.gradeStatus === 'EXEMPT' ||
                     r.gradeStatus === 'PASSED_NO_GRADE' ||
                     isPassedStatusCode(code) ||
                     (gv === null || gv >= th.pass);
    if (r.gradeStatus !== 'PENDING' && isPassed) a.units += u;
    if (gv !== null && r.gradeStatus === 'FINALIZED' && !isNonGpaRow(r)) {
      if (passedSet && gv < th.pass && passedSet.has(r.courseCode)) continue;
      a.wsum += gv * u; a.wunits += u;
    }
  }
  return order.map(t => {
    const a = acc.get(t);
    return { type: t, units: a?.units ?? 0, gpa: a && a.wunits ? a.wsum / a.wunits : null };
  });
}

/** حل برچسب فارسی کد سما با fallback به خود کد */
export function codeLabel(map: Record<string, string> | undefined, v: string | null | undefined): string {
  if (!v || v === '—') return '—';
  return (map && map[v]) || v;
}

/* ── دامنهٔ دانشگاهیِ نمرات سیستم قدیمی (legacy_grades) ──
 *
 * جدول legacy_grades نه ستون universityId دارد و نه کلید مرکب با دانشگاه؛
 * تنها مرزبندی‌اش «مبدأ» است (sourceCode) و قرارداد سراسریِ پروژه این است:
 *     legacy_grades.sourceCode = universities.code
 * (همین قرارداد را scripts/transfer-report.mjs و audit-all-unis-coverage.mjs
 * برای گزارش‌گیری چنددانشگاهی به کار می‌برند و واردساز سما هم مبدأ را با
 * کد دانشگاه می‌سازد). چون studentCode بین دانشگاه‌ها تصادف می‌کند
 * (۱۴۹ تصادف شمس∩آفاق)، پیوستن بدون sourceCode کدِ وضعیتِ دانشگاه دیگر را
 * روی کارنامه می‌نشاند.
 */
export function legacySourceCodeFor(universityCode: string | null | undefined): string | null {
  const c = String(universityCode ?? '').trim().toUpperCase();
  return /^[A-Z0-9_-]{2,50}$/.test(c) ? c : null;
}

/** ردیف‌های نمرهٔ قدیمیِ همین مبدأ — دفاع تکمیلی کنار فیلتر sourceCode در SQL */
export function legacyRowOfSource<T extends { sourceCode?: string | null }>(rows: T[], sourceCode: string | null): T[] {
  const want = legacySourceCodeFor(sourceCode);
  if (!want) return [];
  return rows.filter(r => legacySourceCodeFor(r.sourceCode) === want);
}

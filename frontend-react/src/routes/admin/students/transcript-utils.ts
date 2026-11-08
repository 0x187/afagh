// ═══════════════════════════════════════════════════════════════════════
//  Pure transcript core — port of afagh-next/src/app/admin/students/transcript-utils.ts
//  GPA/probation/type grouping + Jalali dates + Persian digits/words. No React, no fetch.
// ═══════════════════════════════════════════════════════════════════════
import type { TranscriptRow, RegulationConfig } from '@/lib/students-dossier-api';
import {
  NON_GPA_CODES,
  NON_TERM_GPA_CODES,
  REGULATION_FROZEN_CODES,
  isDroppedStatusCode,
  isPassedStatusCode,
} from './grade-status-codes';

export type { TranscriptRow };

/** true when this row must not affect the overall GPA (e.g. code 12 compensatory) */
export const isNonGpaRow = (r: Pick<TranscriptRow, 'gradeStatusCode'>): boolean => {
  const c = r.gradeStatusCode?.trim();
  return !!c && NON_GPA_CODES.has(c);
};

/** true when this row must not affect the term GPA */
export const isNonTermGpaRow = (r: Pick<TranscriptRow, 'gradeStatusCode'>): boolean => {
  const c = r.gradeStatusCode?.trim();
  return !!c && NON_TERM_GPA_CODES.has(c);
};

/* ── official transcript: term grouping + GPA ── */
export const numOrNull = (v: string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type RegThresholds = {
  pass: number;
  prob: number;
  exclFailed: boolean;
  exclFromTerm: boolean;
  retakeMinGrade: number;
  is1391: boolean;
  regulationLabel?: string;
  dedupeRepeated: boolean;
  minUnits: number;
};

/** Operational thresholds of the student's regulation (defaults: pass 10, probation 12) */
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

/** Courses passed at least once with the required bar (for the exclude-failed policy) */
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

/** Retake bar for excluding a failed row: only the 1391 bylaw uses retakeMinGrade */
export const retakeBar = (th: RegThresholds): number => (th.is1391 ? th.retakeMinGrade : th.pass);

export function summarizeTerm(rows: TranscriptRow[], pass = 10): { taken: number; passed: number; failed: number; wsum: number; wunits: number; dropped: number } {
  let taken = 0, passed = 0, failed = 0, wsum = 0, wunits = 0, dropUnits = 0;
  for (const r of rows) {
    const u = numOrNull(r.units) ?? 0;
    const g = numOrNull(r.gradeValue);
    const code = r.gradeStatusCode?.trim() || null;
    const dropped = isDroppedStatusCode(code);
    // Statuses 7 (council drop), 6 (emergency drop) and 5 (exam absence) count
    // in "taken" but neither in "passed/units" nor in the GPA.
    const takenOnly = code === '7' || code === '6' || code === '5';

    if (r.gradeStatus === 'PENDING') continue;
    if (dropped && !takenOnly) { dropUnits += u; continue; }

    taken += u;
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

    // Term GPA: only FINALIZED grades whose code counts toward the term GPA
    if (g !== null && r.gradeStatus === 'FINALIZED' && !isNonTermGpaRow(r)) {
      wsum += g * u;
      wunits += u;
    }
  }
  return { taken, passed, failed, wsum, wunits, dropped: dropUnits };
}

/** Keeps only the best FINALIZED grade per course code (for dedupeRepeatedCourses) */
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

export function summarizeTotal(rows: TranscriptRow[], th: RegThresholds): { wsum: number; wunits: number } {
  const passedSet = th.exclFailed ? passedCourseSet(rows, retakeBar(th)) : null;
  const bestRow = th.dedupeRepeated ? bestFinalizedRowPerCourse(rows) : null;
  let wsum = 0, wunits = 0;
  for (const r of rows) {
    const u = numOrNull(r.units) ?? 0;
    const g = numOrNull(r.gradeValue);
    if (g === null || r.gradeStatus !== 'FINALIZED') continue;
    if (isNonGpaRow(r) || isDroppedStatusCode(r.gradeStatusCode)) continue;
    if (bestRow && bestRow.get(r.courseCode) !== r) continue;
    if (passedSet && g < th.pass && passedSet.has(r.courseCode)) continue;
    wsum += g * u;
    wunits += u;
  }
  return { wsum, wunits };
}

export type TermGroup = {
  termCode: string;
  termTitle: string | null;
  termStatusTitle: string | null;
  probation: boolean;
  rows: TranscriptRow[];
  taken: number;
  passed: number;
  failed: number;
  points: number;
  gpa: number | null;
  effectiveUnits: number;
  droppedUnits: number;
  cumTaken: number;
  cumPassed: number;
  cumFailed: number;
  cumPoints: number;
  cumGpa: number | null;
  cumEffectiveUnits: number;
};

export type TranscriptSummary = {
  terms: TermGroup[];
  totalTaken: number;
  totalPassed: number;
  gpa: number | null;
  passGrade: number;
  probThreshold: number;
  minUnits: number;
};

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
      // Add-drop drop (code -1) is never shown on the official transcript
      const visibleRows = rs.filter((r) => (r.gradeStatusCode?.trim() ?? '') !== '-1');
      if (visibleRows.length === 0) return [];
      // Term-level exclusion of a later-passed failure (only EXCLUDE_IF_PASSED_1391)
      let effectiveRows = visibleRows;
      if (th.exclFromTerm && passedSet) {
        effectiveRows = rs.map((r) => {
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
      const termTitle = rs.find((r) => r.termTitle)?.termTitle ?? null;
      const isSummer = termCode.endsWith('3') || (termTitle?.includes('تابستان') ?? false);
      const isEquiv = termCode.endsWith('5') || termCode.toUpperCase().includes('EQ') || (termTitle?.includes('معادل') ?? false);
      const canHaveProbation = !isSummer && !isEquiv;
      const unitsOk = th.minUnits > 0 ? s.taken >= th.minUnits : true;
      const fileProb = rs.find((r) => r.termProbation !== null)?.termProbation ?? null;
      return [{
        termCode, termTitle,
        termStatusTitle: rs.find((r) => r.termStatusTitle)?.termStatusTitle ?? null,
        probation: canHaveProbation && unitsOk ? (fileProb ?? (gpa !== null && gpa < th.prob)) : false,
        rows: effectiveRows,
        taken: s.taken, passed: s.passed, failed: s.failed, points: s.wsum,
        gpa,
        effectiveUnits: s.wunits,
        droppedUnits: s.dropped,
        cumTaken: 0, cumPassed: 0, cumFailed: 0, cumPoints: 0, cumGpa: null, cumEffectiveUnits: 0,
      }];
    });
  // Cumulative totals up to the end of each term (overall GPA with the policy)
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

/** faNum — Persian locale number with bounded fraction digits (— for null) */
export const faNum = (n: number | null | undefined, digits = 2): string =>
  n == null ? '—' : n.toLocaleString('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** Latin → Persian digits (years/term codes — no thousands separator) */
export const faDigit = (v: string | number): string =>
  String(v).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);

/** Sama raw numeric string ('12.75') → Persian with rounding (non-numeric kept) */
export const faStr = (v: string | null | undefined, digits = 2): string => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return faNum(n, digits);
};

/** Display title of a term for the Sama transcript header */
export function termDisplayTitle(termCode: string, termTitle: string | null): string {
  const t = (termTitle || '').trim();
  if (t && !/^(ترم\s*)?\d{4,6}$/.test(t)) return t;
  const code = (termCode || '').trim();
  const m = code.match(/^(\d{3,4})(\d)$/);
  if (m) {
    const y = m[1].length === 4 ? +m[1] : 1000 + +m[1];
    const s = +m[2];
    const range = `${faDigit(y)}-${faDigit(y + 1)}`;
    if (s === 1) return `نیمسال اول ${range}`;
    if (s === 2) return `نیمسال دوم ${range}`;
    if (s === 3) return `تابستان ${range}`;
    if (s === 5) return `معادل‌سازی ${range}`;
  }
  if (/EQ/i.test(code)) return `معادل‌سازی ${faDigit(code)}`;
  return code.endsWith('3') ? 'نیمسال تابستان' : 'نیمسال';
}

/** Education start date from entry year+term (term 2 → Bahman 1st) */
export function entryDateFa(entryYear: number | null | undefined, entryTerm: number | null | undefined): string {
  if (entryYear == null || !Number.isFinite(Number(entryYear))) return '—';
  const y = Number(entryYear);
  const md = Number(entryTerm) === 2 ? '11/01' : '07/01';
  return faDigit(`${y}/${md}`);
}

/** Qualitative thesis scale legend for the Sama status-notes line */
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

/** Numeric thesis grade → qualitative label for printing */
export function thesisQualitativeLabel(g: number | null, pass = 10): string {
  if (g === null || !Number.isFinite(g)) return '—';
  if (g >= 18) return 'عالی';
  if (g >= 15) return 'خیلی خوب';
  if (g >= 12) return 'خوب';
  if (g >= pass) return 'قابل قبول';
  return 'مردود';
}

/** Gregorian → Jalali (for the transcript issue/birth dates) */
export function g2j(gy: number, gm: number, gd: number): [number, number, number] {
  const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  void breaks;
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  let g = gy - (gy <= 1600 ? 621 : 1600);
  const gy2 = gm > 2 ? g + 1 : g;
  let days = 365 * g + ~~((gy2 + 3) / 4) - ~~((gy2 + 99) / 100) + ~~((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * ~~(days / 12053);
  days %= 12053;
  jy += 4 * ~~(days / 1461);
  days %= 1461;
  if (days > 365) { jy += ~~((days - 1) / 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + ~~(days / 31) : 7 + ~~((days - 186) / 30);
  const jd = days < 186 ? 1 + (days % 31) : 1 + ((days - 186) % 30);
  return [jy, jm, jd];
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
    const d = new Date(s);
    if (isNaN(d.getTime())) return s.slice(0, 10);
    m = ['', String(d.getUTCFullYear()), String(d.getUTCMonth() + 1), String(d.getUTCDate())];
  }
  const [jy, jm, jd] = g2j(+m[1], +m[2], +m[3]);
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

const FA_ONES = ['صفر', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه', 'ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده', 'بیست'];
const FA_TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];

function faIntWords(n: number): string {
  if (n <= 20) return FA_ONES[n];
  const t = Math.floor(n / 10), o = n % 10;
  return o === 0 ? FA_TENS[t] : `${FA_TENS[t]} و ${FA_ONES[o]}`;
}

/** GPA in Persian words ('هفده و بیست و شش صدم') */
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

/** Course type → the 6 columns of the Sama breakdown table */
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
  return order.map((t) => {
    const a = acc.get(t);
    return { type: t, units: a?.units ?? 0, gpa: a && a.wunits ? a.wsum / a.wunits : null };
  });
}

/** Persian label of a Sama code with a fallback to the raw code */
export function codeLabel(map: Record<string, string> | undefined, v: string | null | undefined): string {
  if (!v || v === '—') return '—';
  return (map && map[v]) || v;
}

// ════════════════════════════════════════════════════════════════════════
//  هستهٔ خالص ماژول برنامهٔ درسی — بدون React، بدون DB، بدون DOM.
//  ثابت‌های نمایشی + قاعدهٔ درختی + چارت ترمی + فیلترها.
//  همه قابل Unit Test → tests/curriculum-core.test.ts
// ════════════════════════════════════════════════════════════════════════
import { compareCourseCode, type LogicNode } from '@/lib/curriculum-types';
import { SUMMER_SEMESTER, isSummerSemester } from '@/lib/term-plan';
import type { BankCourse, CourseRow, MajorItem, CurriculumTab, RuleRow } from './types';

// ─────────────────────────── ثابت‌های نمایشی ───────────────────────────

export const faNum = (n: any) => (n === null || n === undefined || n === '' ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

export const STATUS_UI: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'پیش‌نویس', cls: 'bg-slate-200 text-slate-800' },
  REVIEW: { label: 'در بازبینی', cls: 'bg-amber-200 text-amber-900' },
  APPROVED: { label: 'تأییدشده', cls: 'bg-blue-200 text-blue-900' },
  PUBLISHED: { label: 'منتشرشده', cls: 'bg-emerald-200 text-emerald-900' },
  ARCHIVED: { label: 'بایگانی‌شده', cls: 'bg-rose-200 text-rose-900' },
};

export const ROLE_LABELS: Record<string, string> = {
  CORE: 'پایه', MAJOR: 'اصلی', SPECIALIZED: 'تخصصی', ELECTIVE: 'اختیاری', GENERAL: 'عمومی',
  THESIS: 'پایان‌نامه', INTERNSHIP: 'کارآموزی', WORKSHOP: 'کارگاه',
};

/**
 * انواعِ «سهم واحد» که در ستون minRoleUnits مجازند اما نقشِ درس در
 * curriculum_courses نیستند (CHECK دیتابیس فقط ۸ نقش بالا را می‌پذیرد).
 * «جبرانی» واحد مشخصی در چارت ندارد ولی مدیر گروه باید بتواند سهم آن را تعیین کند.
 */
export const EXTRA_ROLE_LABELS: Record<string, string> = {
  COMPENSATORY: 'جبرانی',
};

/** همهٔ انواعِ قابل انتخاب در ویرایشگر سهم واحد (ترتیب نمایش) */
export const ROLE_TARGET_KEYS: string[] = [...Object.keys(ROLE_LABELS), ...Object.keys(EXTRA_ROLE_LABELS)];

/** برچسب فارسی هر نوع — شامل انواع خارج از enum (جبرانی) و کلیدهای ناشناخته */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? EXTRA_ROLE_LABELS[role] ?? role;
}

export const TABS: { key: CurriculumTab; icon: string; label: string }[] = [
  { key: 'CATALOG', icon: '🗂️', label: 'تعریف کاتالوگ رشته' },
  { key: 'COURSES', icon: '📖', label: 'دروس کاتالوگ' },
  { key: 'SEMESTERS', icon: '📅', label: 'ترم‌بندی چارت' },
  { key: 'VERIFY', icon: '🧪', label: 'بررسی و خاتمه' },
  { key: 'TRANSFER', icon: '🔄', label: 'انتقال کاتالوگ' },
];


export const faDate = (d: Date | string | null | undefined) => {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short' }).format(dt);
};

export const leafCourseCodesOf = (t: LogicNode | undefined): string[] => {
  if (!t) return [];
  const out: string[] = [];
  for (const c of t.conditions ?? []) {
    const n = c as unknown as LogicNode;
    if (n.operator) out.push(...leafCourseCodesOf(n));
    else if ((c as { course?: unknown }).course != null) out.push(String((c as { course?: unknown }).course));
  }
  return out;
};

/**
 * شرط‌های «غیردرسی» درخت قاعده — همان چیزهایی که در جدول دروس قدیم به‌جای
 * کد درس نوشته می‌شد: «۴۷ واحد پاس‌کرده» و «حداقل ترم ۷».
 * این‌ها کمبود درس نیستند، ولی باید در متن هشدار دیده شوند.
 */
export const nonCourseConditionsOf = (t: LogicNode | undefined): { unitsPassed: number[]; minSemester: number[] } => {
  const out = { unitsPassed: [] as number[], minSemester: [] as number[] };
  const walk = (node: LogicNode | undefined) => {
    for (const c of node?.conditions ?? []) {
      const n = c as unknown as LogicNode;
      if (n.operator) { walk(n); continue; }
      const cc = c as { unitsPassed?: unknown; minSemester?: unknown };
      if (cc.unitsPassed != null) out.unitsPassed.push(Number(cc.unitsPassed));
      if (cc.minSemester != null) out.minSemester.push(Number(cc.minSemester));
    }
  };
  walk(t);
  return out;
};

/** متن فارسی شرط‌های غیردرسی: «۴۷ واحد پاس‌کرده»، «حداقل ترم ۷» */
export function nonCourseConditionsText(t: LogicNode | undefined): string {
  const { unitsPassed, minSemester } = nonCourseConditionsOf(t);
  return [
    ...unitsPassed.map(u => `${faNum(u)} واحد پاس‌کرده`),
    ...minSemester.map(s => `حداقل ترم ${faNum(s)}`),
  ].join(' · ');
}

/**
 * مرتب‌سازی «طبیعی» کد درس — پیاده‌سازی در لایهٔ دامنه است تا هم چارت ترمی و
 * هم متنِ قواعد از یک قاعده استفاده کنند (re-export برای سازگاری با واردکننده‌های قبلی).
 */
export { compareCourseCode };

export const leafTotalOf = (t: LogicNode | undefined): number => {
  if (!t) return 0;
  let n = 0;
  for (const c of t.conditions ?? []) {
    const sn = c as unknown as LogicNode;
    n += sn.operator ? leafTotalOf(sn) : 1;
  }
  return n;
};

// ─────────────── هشدار پوشش پیش‌نیاز/هم‌نیاز در چارت (هنگام چیدمان) ───────────────
// وقتی مدیرگروه درس را در ترمی قرار می‌دهد (درگ‌اندراپ یا منوی ترم کاتالوگ)،
// اگر آن درس پیش‌نیاز یا هم‌نیاز دارد که (الف) اصلاً در دروس نسخه نیست یا
// (ب) در نسخه هست ولی هنوز ترم‌بندی نشده (در استخرِ بی‌ترم)، هشدار بده که
// ابتدا باید آن را به چارت اضافه/ترم‌بندی کرد. منطق خالص → قابل Unit Test.

export interface DepWarning {
  courseId: number;
  code: string;
  type: 'PREREQ' | 'COREQ';
  /** کدهای ارجاع‌شده‌ای که اصلاً در دروس نسخه نیستند و هم‌ارزی هم برایشان پیدا نشد */
  missing: string[];
  /** کدهای ارجاع‌شده‌ای که در نسخه‌اند ولی recommendedSemester ندارند (در استخر بی‌ترم) */
  unassigned: string[];
  /** نقض ترتیب: پیش‌نیاز در ترم دیرتر/هم‌ترم، یا هم‌نیاز در ترمِ زودتر از درس وابسته */
  badOrder: string[];
  /**
   * کدهایی که خودشان در نسخه نیستند ولی **درس هم‌ارزشان** در نسخه هست.
   * مثال واقعی: هم‌نیاز «54118» در چارت نیست، ولی درس «X» با آن هم‌ارز است.
   */
  viaEquivalent: { code: string; equivalent: string }[];
  /** کد → عنوان درس (برای نمایش نام در بَج، نه فقط کد) */
  names: Record<string, string>;
  /** شرط‌های غیردرسی («۴۷ واحد پاس‌کرده»، «حداقل ترم ۷») — کمبود نیستند، ولی باید دیده شوند */
  extra: string[];
  /** درس وابسته در اولین ترمِ ممکن (ترم ۱) ثبت شده در حالی که پیش‌نیاز دارد — غیرممکن (ترم ۰ وجود ندارد) */
  impossibleTerm: boolean;
  /** قاعدهٔ شکست‌خورده از نوع «یا» بود — هر گزینه‌ای کافی است، ولی هیچ‌کدام برقرار نبود */
  anyOf?: boolean;
}

/**
 * هم‌ارزِ یک کدِ خارج از نسخه: آیا درسی در همین نسخه هست که در
 * `equivalentCourseCodes` خودش این کد را داشته باشد؟ (یا برعکس)
 * این همان چیزی است که در سیستم قدیمی «دروس هم ارز / متضاد» نام داشت.
 */
export function findEquivalentInVersion(
  code: string,
  courses: CourseRow[] | null | undefined,
): CourseRow | null {
  const target = String(code ?? '').trim().toUpperCase();
  if (!target) return null;
  for (const c of courses ?? []) {
    const list = String(c.equivalentCourseCodes ?? '')
      .split(/[,،|\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (list.includes(target)) return c;
  }
  return null;
}

export function dependencyWarnings(
  courses: CourseRow[] | null | undefined,
  rules: RuleRow[] | null | undefined,
): DepWarning[] {
  const byId = new Map((courses ?? []).map((c) => [c.courseId, c]));
  const byCode = new Map((courses ?? []).map((c) => [c.code, c]));
  const out: DepWarning[] = [];
  for (const r of rules ?? []) {
    if (r.ruleType !== 'PREREQ' && r.ruleType !== 'COREQ') continue;
    const ruleType: 'PREREQ' | 'COREQ' = r.ruleType === 'PREREQ' ? 'PREREQ' : 'COREQ';
    const dep = byId.get(r.courseId);
    if (!dep) continue; // قاعدهٔ درس خارج‌از‌نسخه (توسط چک دیگری رصد می‌شود)
    const codes = leafCourseCodesOf(r.logicTree);
    const extraText = nonCourseConditionsText(r.logicTree);

    type Issues = {
      names: Record<string, string>;
      missing: string[]; unassigned: string[]; badOrder: string[];
      viaEquivalent: { code: string; equivalent: string }[];
    };
    const emptyIssues = (): Issues => ({ names: {}, missing: [], unassigned: [], badOrder: [], viaEquivalent: [] });
    const mergeInto = (dst: Issues, src: Issues) => {
      Object.assign(dst.names, src.names);
      for (const k of ['missing', 'unassigned', 'badOrder'] as const) {
        for (const c of src[k]) if (!dst[k].includes(c)) dst[k].push(c);
      }
      for (const v of src.viaEquivalent) if (!dst.viaEquivalent.some(x => x.code === v.code)) dst.viaEquivalent.push(v);
    };

    /**
     * ارزیابی شرط با احترام به عملگرها.
     * برای OR کافی است **یکی** برقرار باشد؛ پس تا وقتی یک شرط برقرار است،
     * بقیه حتی ارزیابی/گزارش نمی‌شوند (خطای پیشین: همهٔ کدها AND فرض می‌شدند).
     */
    const evalCond = (cond: { course?: string; operator?: 'AND' | 'OR'; conditions?: unknown[] }): { ok: boolean; issues: Issues } => {
      if (cond.operator) {
        const children = ((cond.conditions ?? []) as { course?: string; operator?: 'AND' | 'OR'; conditions?: unknown[] }[]).map(evalCond);
        if (cond.operator === 'OR') {
          if (children.some(c => c.ok)) return { ok: true, issues: emptyIssues() };
          const iss = emptyIssues();
          for (const c of children) mergeInto(iss, c.issues);
          return { ok: false, issues: iss };
        }
        let ok = true;
        const iss = emptyIssues();
        for (const c of children) { if (!c.ok) ok = false; mergeInto(iss, c.issues); }
        return { ok, issues: iss };
      }
      // شرط غیردرسی (واحد/ترم/نمره) — در هشدار چارت بررسی نمی‌شود
      const code = String(cond.course ?? '').toUpperCase().trim();
      if (!code) return { ok: true, issues: emptyIssues() };

      const iss = emptyIssues();
      const target = byCode.get(code);
      if (!target) {
        // شاید هم‌ارزش در چارت باشد — «خارج از نسخه» گفتن در این حالت گمراه‌کننده است
        const eq = findEquivalentInVersion(code, courses);
        if (eq) {
          iss.names[code] = eq.title;
          const eqSem = eq.recommendedSemester ?? null;
          const bad = dep.recommendedSemester != null && eqSem != null && (
            ruleType === 'PREREQ' ? eqSem >= dep.recommendedSemester : eqSem > dep.recommendedSemester
          );
          if (bad) { iss.badOrder.push(code); return { ok: false, issues: iss }; }
          iss.viaEquivalent.push({ code, equivalent: eq.code });
          return { ok: true, issues: emptyIssues() };
        }
        iss.missing.push(code);
        return { ok: false, issues: iss };
      }
      iss.names[code] = target.title;
      if (target.recommendedSemester == null) { iss.unassigned.push(code); return { ok: false, issues: iss }; }
      // پیش‌نیاز باید در ترمی زودتر باشد؛ هم‌نیاز باید هم‌ترم یا در ترمی زودتر باشد (فقط ترمِ بعدتر خطاست)
      const badOrder =
        dep.recommendedSemester != null && (
          ruleType === 'PREREQ'
            ? target.recommendedSemester >= dep.recommendedSemester
            : target.recommendedSemester > dep.recommendedSemester
        );
      if (badOrder) { iss.badOrder.push(code); return { ok: false, issues: iss }; }
      return { ok: true, issues: emptyIssues() };
    };

    const verdict = evalCond(r.logicTree as { operator: 'AND' | 'OR'; conditions: unknown[] });
    // درس دارای پیش‌نیاز در اولین ترم (ترم ۱ ≤) → غیرممکن: ترم ۰ وجود ندارد
    const impossibleTerm =
      !verdict.ok &&
      ruleType === 'PREREQ' &&
      dep.recommendedSemester != null &&
      dep.recommendedSemester <= 1 &&
      codes.length > 0;
    if (!verdict.ok && (verdict.issues.missing.length || verdict.issues.unassigned.length || verdict.issues.badOrder.length || verdict.issues.viaEquivalent.length || impossibleTerm)) {
      out.push({
        courseId: dep.courseId, code: dep.code, type: ruleType,
        missing: verdict.issues.missing, unassigned: verdict.issues.unassigned, badOrder: verdict.issues.badOrder,
        viaEquivalent: verdict.issues.viaEquivalent, names: verdict.issues.names,
        extra: extraText ? [extraText] : [], impossibleTerm,
        // قاعده با «یا» شکست خورده ⇒ هیچ‌کدام از گزینه‌ها برقرار نبود
        anyOf: r.logicTree?.operator === 'OR',
      });
    }
  }
  return out;
}

/** نگاشت courseId → هشدارها (برای دسترسی O(1) در کارتِ هر درس) */
export function dependencyWarningsMap(
  courses: CourseRow[] | null | undefined,
  rules: RuleRow[] | null | undefined,
): Map<number, DepWarning[]> {
  const m = new Map<number, DepWarning[]>();
  for (const w of dependencyWarnings(courses, rules)) {
    const arr = m.get(w.courseId) ?? [];
    arr.push(w);
    m.set(w.courseId, arr);
  }
  return m;
}

/** «کد — عنوان» برای نمایش؛ اگر عنوان نباشد فقط کد */
const labelOf = (w: DepWarning, code: string): string => {
  const t = w.names[code];
  return t ? `${t} (${code})` : code;
};

/** متن فارسی هشدار — برای tooltip / نمایش زیر کارت درس */
export function dependencyWarningText(w: DepWarning): string {
  const parts: string[] = [];
  const any = w.anyOf ? ' (یکی از این دروس کافی است)' : '';
  if (w.impossibleTerm) {
    parts.push('این درس پیش‌نیاز دارد و نمی‌تواند در ترم ۱ ثبت شود — زیرا امکان گذراندن پیش‌نیاز در ترم ۰ (که وجود ندارد) وجود ندارد؛ پیش‌نیاز باید در ترمی زودتر گذرانده شود.');
  }
  if (w.badOrder.length) {
    parts.push(
      w.type === 'PREREQ'
        ? `پیش‌نیاز «${w.badOrder.map(c => labelOf(w, c)).join('، ')}» باید در ترمی زودتر از این درس باشد (ترتیب ترمی رعایت نشده).`
        : `هم‌نیاز «${w.badOrder.map(c => labelOf(w, c)).join('، ')}» در ترمی بعدتر از این درس قرار گرفته — هم‌نیاز باید هم‌ترم یا در ترمی زودتر (پیش از این درس) اخذ شود.`,
    );
  }
  if (w.unassigned.length) {
    parts.push(
      w.type === 'PREREQ'
        ? `پیش‌نیاز «${w.unassigned.map(c => labelOf(w, c)).join('، ')}» هنوز ترم‌بندی نشده${any} — ابتدا یکی از آن‌ها را در ترمی زودتر قرار دهید.`
        : `هم‌نیاز «${w.unassigned.map(c => labelOf(w, c)).join('، ')}» هنوز ترم‌بندی نشده${any} — باید هم‌ترم با این درس باشد.`,
    );
  }
  if (w.viaEquivalent.length) {
    parts.push(
      `این کدها در نسخه نیستند ولی درس هم‌ارزشان در چارت هست: ${w.viaEquivalent.map(v => `${v.code} ← ${labelOf(w, v.equivalent)}`).join('، ')} — ترتیب ترمی همان درس هم‌ارز را رعایت کنید یا کد قاعده را به کد هم‌ارز تغییر دهید.`,
    );
  }
  if (w.missing.length) {
    parts.push(
      w.type === 'PREREQ'
        ? `پیش‌نیاز «${w.missing.join('، ')}» در نسخه موجود نیست${any} — ابتدا درس پیش‌نیاز را به چارت اضافه کنید.`
        : `هم‌نیاز «${w.missing.join('، ')}» در نسخه موجود نیست${any} — ابتدا درس اصلی را اضافه کنید، سپس درس هم‌نیاز.`,
    );
  }
  if (w.extra.length) {
    parts.push(`شرط‌های غیردرسی این قاعده: ${w.extra.join(' و ')}.`);
  }
  return parts.join(' ');
}

/**
 * برچسب کوتاهِ بَج روی کارت درس — با **نام درس‌ها** (خواستهٔ مدیر گروه) و
 * بدون نیاز به دو خط: «پیش‌نیاز ناقص: ساختار و تنوع گیاهی، آزمایشگاه شیمی».
 */
export function depWarningBadge(warns: DepWarning[]): { icon: string; label: string; tone: 'red' | 'amber' | 'blue' } | null {
  if (!warns || warns.length === 0) return null;
  const impossible = warns.some(w => w.impossibleTerm);
  const type = warns.some(w => w.type === 'PREREQ') ? 'پیش‌نیاز' : 'هم‌نیاز';
  const codes = [...new Set(warns.flatMap(w => [...w.missing, ...w.unassigned, ...w.badOrder]))];
  // اگر دو کدِ مختلف نامِ یکسان داشته باشند (مثلاً «مبانی فیزیولوژی» با دو کد),
  // نمایش فقط نام گمراه‌کننده است — پس کد را هم می‌نویسیم.
  const titles = [...new Set(codes.map(c => {
    const w = warns.find(x => x.names[c]);
    const t = w ? w.names[c] : c;
    return titles.has(t) ? `${t} (${c})` : t;
  }))];
  const titleCounts = new Map<string, number>();
  for (const t of titles) titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
  const eqOnly = codes.length === 0 && warns.some(w => w.viaEquivalent.length > 0);
  const eqTitles = [...new Set(warns.flatMap(w => w.viaEquivalent.map(v => w.names[v.equivalent] ?? v.equivalent)))];

  if (eqOnly) {
    return { icon: '🔁', label: `${type} از طریق هم‌ارزی: ${eqTitles.join('، ')}`, tone: 'blue' };
  }
  const head = titles.length > 0 ? `: ${titles.join('، ')}` : '';
  const anyOf = warns.some(w => w.anyOf);
  return { icon: impossible ? '⛔' : '⚠️', label: `${type} ناقص${anyOf ? ' (هیچ‌کدام از گزینه‌ها)' : ''}${head}`, tone: impossible ? 'red' : 'amber' };
}


// ─────────────────────────── پیوندپذیری تب‌ها ───────────────────────────

export const CURRICULUM_TABS = TABS.map(t => t.key);

/** مقدار ?tab= نامعتبر/خالی → تب اول (هر تب مستقل قابل رندر باشد) */
export function resolveTab(raw: string | null | undefined): CurriculumTab {
  return (CURRICULUM_TABS as readonly string[]).includes(raw ?? '') ? (raw as CurriculumTab) : CURRICULUM_TABS[0];
}

// ─────────────────────────── درخت قاعدهٔ درس ───────────────────────────
// (این چهار تابع فقط روی LogicNode کار می‌کنند: هیچ DB و React ندارند.)

/** ساخت درخت AND/OR از کدهای درس — لیست خالی یعنی «بدون قاعده» (null) */
export function buildRuleTree(
  codes: string[],
  op: 'AND' | 'OR',
  extra?: { unitsPassed?: number | null; minSemester?: number | null },
): LogicNode | null {
  const extras: { unitsPassed?: number; minSemester?: number }[] = [];
  if (extra?.unitsPassed != null && Number(extra.unitsPassed) > 0) extras.push({ unitsPassed: Number(extra.unitsPassed) });
  if (extra?.minSemester != null && Number(extra.minSemester) > 0) extras.push({ minSemester: Number(extra.minSemester) });

  // بدون شرط غیردرسی → همان ساختار سادهٔ قبلی (سازگاری کامل با داده و تست‌های موجود)
  if (extras.length === 0) {
    return codes.length === 0 ? null : { operator: op, conditions: codes.map(code => ({ course: code })) };
  }
  const parts: LogicNode['conditions'] = [];
  if (codes.length === 1) parts.push({ course: codes[0] });
  else if (codes.length > 1) parts.push({ operator: op, conditions: codes.map(code => ({ course: code })) });
  parts.push(...extras);
  return { operator: 'AND', conditions: parts };
}

/**
 * بررسی «کف نمره» واردشده در مودال قاعده.
 * بدون تغییر → changed:false (اکشن صدا زده نمی‌شود)؛ بجز ۰..۲۰ → error.
 */
export function validateMinGrade(raw: string | null | undefined, current: string): { changed: boolean; value: number | null; error: string | null } {
  const trimmed = (raw ?? '').trim();
  if (trimmed === current) return { changed: false, value: null, error: null };
  const parsed = trimmed === '' ? null : Number(trimmed);
  if (parsed != null && (!(parsed >= 0) || !(parsed <= 20))) {
    return { changed: true, value: null, error: 'کف نمره باید بین ۰ تا ۲۰ باشد.' };
  }
  return { changed: true, value: parsed, error: null };
}

// ─────────────────────── چیدمان چارت ترمی (خالص) ───────────────────────

export type SemesterGroups = { bySemester: Map<number, CourseRow[]>; unassigned: CourseRow[] };

/** تفکیک دروس نسخه به «ترم مشخص» و «بدون ترم» */
export function groupBySemester(courses: CourseRow[] | null | undefined): SemesterGroups {
  const bySemester = new Map<number, CourseRow[]>();
  const unassigned: CourseRow[] = [];
  for (const c of courses ?? []) {
    if (c.recommendedSemester != null) {
      const arr = bySemester.get(c.recommendedSemester) ?? [];
      arr.push(c);
      bySemester.set(c.recommendedSemester, arr);
    } else {
      unassigned.push(c);
    }
  }
  // ترتیب داخل هر ترم و استخرِ بی‌ترم: **بر اساس کد درس** (نه نام) — خواستهٔ مدیر گروه
  for (const arr of bySemester.values()) arr.sort((a, b) => compareCourseCode(a.code, b.code));
  unassigned.sort((a, b) => compareCourseCode(a.code, b.code));
  return { bySemester, unassigned };
}

/** جمع واحد یک فهرست درس (واحد نامعتبر = صفر) */
export function semesterUnitTotal(list: CourseRow[] | null | undefined): number {
  return (list ?? []).reduce((s, c) => s + Number(c.units || 0), 0);
}

/** ترم‌های خارج از چارت که در داده هست (مثلاً نسخهٔ کاردانی با درس در ترم ۵..۸) گم نمی‌شوند */
export function overflowSemesters(usedTerms: Iterable<number>, planTerms: number[]): number[] {
  return [...usedTerms].filter(t => t !== SUMMER_SEMESTER && !planTerms.includes(t)).sort((a, b) => a - b);
}

/** ستون‌های شبکهٔ ترم: چارت + سرریزها + تابستان */
export function termGrid(planTerms: number[], usedTerms: Iterable<number>): number[] {
  return [...planTerms, ...overflowSemesters(usedTerms, planTerms), SUMMER_SEMESTER];
}

/** آیا این ترم بیرون از چارت مقطع است؟ (برچسب هشدار در سرستون) */
export function isOverflowSemester(sem: number, planTerms: number[]): boolean {
  return !planTerms.includes(sem) && !isSummerSemester(sem);
}

/** برچسب فارسی شمارهٔ ترم */
export function semLabel(sem: number | null | undefined): string {
  return sem == null ? 'نامشخص' : isSummerSemester(sem) ? 'تابستان' : `ترم ${faNum(sem)}`;
}

// ─────────────────────── خلاصهٔ نوع درس / سهم نقش ───────────────────────

export type TypeSummaryRow = { role: string; count: number; units: number };

/** جمع‌بندی نوع درس نسخه (معادل «نمایش اطلاعات نوع درس» مدل قدیم: جمع ۲) */
export function typeSummaryRows(courses: CourseRow[] | null | undefined): TypeSummaryRow[] {
  const m = new Map<string, { count: number; units: number }>();
  for (const c of courses ?? []) {
    const e = m.get(c.roleType) ?? { count: 0, units: 0 };
    e.count += 1; e.units += Number(c.units || 0);
    m.set(c.roleType, e);
  }
  const order = ROLE_TARGET_KEYS;
  return [...m.entries()]
    .map(([role, v]) => ({ role, ...v }))
    .sort((a, b) => (order.indexOf(a.role) === -1 ? 99 : order.indexOf(a.role)) - (order.indexOf(b.role) === -1 ? 99 : order.indexOf(b.role)));
}

/** واحد موجود هر نقش (برای مقایسه با سهم مقرر در ویرایشگر سطرِ نقش) */
export function unitsByRoleMap(courses: CourseRow[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of courses ?? []) m.set(c.roleType, (m.get(c.roleType) ?? 0) + Number(c.units || 0));
  return m;
}

/** تعداد درس موجود هر نقش — «چند درس از هر نوع» از خودِ همین چارت شمرده می‌شود */
export function countsByRoleMap(courses: CourseRow[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of courses ?? []) m.set(c.roleType, (m.get(c.roleType) ?? 0) + 1);
  return m;
}

// ─────────────────── فیلتر درختی رشته و بانک دروس ───────────────────

const faSort = (a: string, b: string) => a.localeCompare(b, 'fa');

/** دانشکده‌های یکتا، مرتب (فیلتر بالای صفحه) */
export function facultyNames(majors: MajorItem[]): string[] {
  return [...new Set(majors.map(m => m.facultyName).filter(Boolean) as string[])].sort(faSort);
}

/** گروه‌های آموزشیِ یک دانشکده (یا همه، اگر دانشکده انتخاب نشده) */
export function departmentNames(majors: MajorItem[], faculty: string): string[] {
  const pool = faculty ? majors.filter(m => m.facultyName === faculty) : majors;
  return [...new Set(pool.map(m => m.departmentName).filter(Boolean) as string[])].sort(faSort);
}

/** رشته‌های قابل‌نمایش پس از فیلتر دانشکده/گروه */
export function filterMajorsByTree(majors: MajorItem[], faculty: string, dept: string): MajorItem[] {
  return majors.filter(m => (!faculty || m.facultyName === faculty) && (!dept || m.departmentName === dept));
}

/** سقف ردیف‌های بانک در مودال (جلوگیری از رندر هزاران ردیف) */
export const BANK_VISIBLE_LIMIT = 60;

export function filterBankCourses(bank: BankCourse[], query: string, prefix: string): BankCourse[] {
  const q = query.trim();
  const p = prefix.trim();
  return bank.filter(b => {
    const okQ = !q || String(b.id).includes(q) || b.code.includes(q) || b.title.includes(q);
    const okP = !p || b.code.startsWith(p);
    return okQ && okP;
  });
}

/** سقف نمایش + برچسب «بیش از X مورد» — همان منطق قبلی، فقط خالص */
export function visibleBank(bankFiltered: BankCourse[]): BankCourse[] {
  return bankFiltered.slice(0, BANK_VISIBLE_LIMIT);
}

export function allBankSelected(bankFiltered: BankCourse[], selected: Set<number>): boolean {
  return bankFiltered.length > 0 && bankFiltered.every(b => selected.has(b.id));
}

import { cookies } from 'next/headers';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { academic_terms } from '@/db/schema';
import { toEnDigits } from '@/lib/persian-search';

export const TERM_COOKIE = 'afagh_term';

export const TEACHING_TERM_TYPES = ['NORMAL', 'SUMMER'] as const;
export const HIDDEN_TERM_TYPES = ['EQUIVALENCE', 'SPECIAL'] as const;
export const TERM_SWITCHER_LIMIT = 30;

export type TermType = (typeof TEACHING_TERM_TYPES)[number] | (typeof HIDDEN_TERM_TYPES)[number];

export type TermScope = {
  id: number;
  termCode: string;
  title: string;
  startDate: Date | null;
  endDate: Date | null;
  isCurrent: boolean;
  isEffectiveCurrent: boolean;
  termType?: string | null;
  academicYear?: number | null;
  sortOrder?: number | null;
};

export type TermListOptions = {
  includeSpecial?: boolean;
  limit?: number | null;
};

export type TermCodeLike = {
  id?: number | null;
  termCode: string;
  termType?: string | null;
  academicYear?: number | null;
  sortOrder?: number | null;
};

type TermLike = {
  id: number;
  startDate: Date | null;
  endDate: Date | null;
  isCurrent?: boolean | number | null;
};

const SEMESTER_INDEX: Record<string, number> = { '1': 0, '2': 1, '3': 2 };

export function normalizeTermType(termType: string | null | undefined): string {
  return (termType ?? '').trim().toUpperCase();
}

export function isTeachingTerm(term: { termType?: string | null } | null | undefined): boolean {
  const type = normalizeTermType(term?.termType);
  if (!type) return true;
  return !(HIDDEN_TERM_TYPES as readonly string[]).includes(type);
}

export function filterTeachingTerms<T extends { termType?: string | null }>(
  terms: T[],
  options: TermListOptions = {},
): T[] {
  if (options.includeSpecial === true) return [...(terms ?? [])];
  return (terms ?? []).filter(isTeachingTerm);
}

export function termSemesterIndex(termCode: string | null | undefined): number {
  // ارقام فارسی/عربی هم پذیرفته شود (کدهای مهاجرت‌شده از سما)
  const last = toEnDigits((termCode ?? '').trim()).slice(-1);
  const index = SEMESTER_INDEX[last];
  return index === undefined ? 3 : index;
}

export function termAcademicYear(term: TermCodeLike): number | null {
  if (typeof term.academicYear === 'number' && Number.isFinite(term.academicYear)) return term.academicYear;
  const head = toEnDigits((term.termCode ?? '').trim()).slice(0, 4);
  if (!/^\d{4}$/.test(head)) return null;
  const fromCode = Number(head);
  return Number.isFinite(fromCode) ? fromCode : null;
}

export function termCodeNumber(termCode: string | null | undefined): number {
  // ارقام فارسی/عربی → لاتین (کدهای مهاجرت‌شده از سما با ارقام فارسی
  // ذخیره شده‌اند و Number() روی آن‌ها NaN می‌دهد — منجر به محاسبهٔ اشتباه
  // شمارهٔ ترم و مرتب‌سازی خراب می‌شده).
  const parsed = Number(toEnDigits((termCode ?? '').trim()));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function termRank(term: TermCodeLike): {
  year: number;
  semester: number;
  code: number;
  id: number;
} {
  return {
    year: termAcademicYear(term) ?? Number.NEGATIVE_INFINITY,
    semester: termSemesterIndex(term.termCode),
    code: termCodeNumber(term.termCode),
    id: typeof term.id === 'number' && Number.isFinite(term.id) ? term.id : Number.NEGATIVE_INFINITY,
  };
}

export function sortTermsChronologically<T extends TermCodeLike>(terms: T[] | null | undefined): T[] {
  return (terms ?? [])
    .map((term, index) => ({ term, index, rank: termRank(term) }))
    .sort(
      (a, b) =>
        b.rank.year - a.rank.year ||
        a.rank.semester - b.rank.semester ||
        b.rank.code - a.rank.code ||
        a.rank.id - b.rank.id ||
        a.index - b.index,
    )
    .map((x) => x.term);
}

export function termContainsToday(term: TermLike, today: Date): boolean {
  if (!term.startDate) return false;
  const start = new Date(term.startDate).getTime();
  const now = today.getTime();
  if (Number.isNaN(start) || now < start) return false;
  if (!term.endDate) return true;
  const end = new Date(term.endDate).getTime();
  if (Number.isNaN(end)) return true;
  return now <= end;
}

function byStartDesc(a: TermLike, b: TermLike): number {
  const av = a.startDate ? new Date(a.startDate).getTime() : 0;
  const bv = b.startDate ? new Date(b.startDate).getTime() : 0;
  return bv - av;
}

export function pickEffectiveTerm<T extends TermLike>(terms: T[], today: Date = new Date()): T | null {
  if (!terms || terms.length === 0) return null;
  const containing = terms.filter((t) => termContainsToday(t, today));
  if (containing.length) return [...containing].sort(byStartDesc)[0];
  const flagged = terms.filter((t) => !!t.isCurrent);
  if (flagged.length) return [...flagged].sort(byStartDesc)[0];
  const started = terms.filter((t) => t.startDate && new Date(t.startDate).getTime() <= today.getTime());
  if (started.length) return [...started].sort(byStartDesc)[0];
  const upcoming = terms
    .filter((t) => t.startDate && new Date(t.startDate).getTime() > today.getTime())
    .sort((a, b) => byStartDesc(b, a));
  return upcoming[0] ?? null;
}

export function capTerms<T>(terms: T[], limit: number | null | undefined): T[] {
  if (limit === null || limit === undefined || !(limit > 0)) return terms;
  return terms.slice(0, limit);
}

export function resolveSelectedTerm<T extends { id: number }>(
  ordered: T[],
  limit: number | null | undefined,
  wantedId: number | null | undefined,
): { terms: T[]; selectedId: number | null } {
  const picked = wantedId === null || wantedId === undefined ? null : ordered.find((t) => t.id === wantedId) ?? null;
  if (!picked) return { terms: capTerms(ordered, limit), selectedId: null };
  const capped = capTerms(ordered, limit);
  if (capped.some((t) => t.id === picked.id)) return { terms: capped, selectedId: picked.id };
  return { terms: [...capped, picked], selectedId: picked.id };
}

function resolveLimit(options: TermListOptions): number | null | undefined {
  return options.limit === undefined ? TERM_SWITCHER_LIMIT : options.limit;
}

/**
 * ── کشِ کوتاه‌مدتِ فهرستِ ترم‌ها (۳۰ ثانیه) ──────────────────────────────────
 *
 * چرا: `loadOrderedTerms` یک کوئری روی `academic_terms` است و در **هر** بارگذاری
 * صفحهٔ پنل‌ها (سربرگ + صفحه + سوییچر نیمسال) چند بار تکرار می‌شد. فهرستِ ترم‌ها
 * عملاً ثابت است و فقط وقتی مدیر ترم/دانشگاه را عوض می‌کند تغییر می‌کند؛ پس
 * نگه‌داشتنِ آن برای ۳۰ ثانیه هم درست است و هم چند رفت‌وبرگشتِ دیتابیس را از
 * مسیرِ هر ناوبری حذف می‌کند.
 *
 * ⚠ چرا TTL و نه کشِ دائمی: تغییراتِ مدیریتی (افزودن ترم، عوض‌کردن «ترم جاری»)
 * باید حداکثر تا نیم دقیقه بعد دیده شوند — بدون نیاز به ری‌استارت یا
 * `revalidateTag`. کلید شاملِ دانشگاه و گزینه‌هاست تا نتایج قاطی نشوند.
 */
const TERM_CACHE_TTL_MS = 30_000;
const TERM_CACHE_MAX = 120;
const termCache = new Map<string, { at: number; data: TermScope[] }>();

function termCacheKey(universityId: number | null | undefined, options: TermListOptions): string {
  return `${universityId ?? 0}|${options.includeSpecial === true ? 1 : 0}|${options.limit === undefined ? 'd' : String(options.limit)}`;
}

/** پاک‌کردنِ کشِ ترم‌ها — پس از عملیاتِ مدیریتی که فهرست را عوض می‌کند. */
export function invalidateTermCache(): void {
  termCache.clear();
}

async function loadOrderedTerms(
  universityId: number | null | undefined,
  options: TermListOptions = {},
): Promise<TermScope[]> {
  if (!universityId) return [];
  const key = termCacheKey(universityId, options);
  const hit = termCache.get(key);
  if (hit && Date.now() - hit.at < TERM_CACHE_TTL_MS) return hit.data;
  try {
    const rows = await db
      .select({
        id: academic_terms.id,
        termCode: academic_terms.termCode,
        title: academic_terms.title,
        startDate: academic_terms.startDate,
        endDate: academic_terms.endDate,
        isCurrent: academic_terms.isCurrent,
        termType: academic_terms.termType,
        academicYear: academic_terms.academicYear,
        sortOrder: academic_terms.sortOrder,
      })
      .from(academic_terms)
      .where(eq(academic_terms.universityId, universityId))
      .orderBy(desc(academic_terms.id));
    const visible = filterTeachingTerms(rows, options);
    const ordered = sortTermsChronologically(visible).map((r) => ({
      id: r.id,
      termCode: r.termCode,
      title: r.title,
      startDate: r.startDate,
      endDate: r.endDate,
      isCurrent: !!r.isCurrent,
      isEffectiveCurrent: false,
      termType: r.termType,
      academicYear: r.academicYear,
      sortOrder: r.sortOrder,
    }));
    const effective = pickEffectiveTerm(ordered, new Date());
    const result = !effective
      ? ordered
      : ordered.map((r) => (r.id === effective.id ? { ...r, isEffectiveCurrent: true } : r));
    // ذخیره در کشِ کوتاه‌مدت (با سقفِ اندازه تا حافظه در طولِ عمرِ پروسه رشد نکند)
    if (termCache.size >= TERM_CACHE_MAX) termCache.clear();
    termCache.set(key, { at: Date.now(), data: result });
    return result;
  } catch {
    return [];
  }
}

export async function listTermsForUniversity(
  universityId: number | null | undefined,
  options: TermListOptions = {},
): Promise<TermScope[]> {
  const ordered = await loadOrderedTerms(universityId, options);
  return capTerms(ordered, resolveLimit(options));
}

export async function getTermScope(
  universityId: number | null | undefined,
  options: TermListOptions = {},
): Promise<{
  terms: TermScope[];
  selectedId: number | null;
  effectiveId: number | null;
}> {
  const ordered = await loadOrderedTerms(universityId, options);
  const effectiveId = ordered.find((t) => t.isEffectiveCurrent)?.id ?? null;
  const raw = (await cookies()).get(TERM_COOKIE)?.value?.trim();
  const wanted = raw ? Number(raw) : NaN;
  const { terms, selectedId } = resolveSelectedTerm(
    ordered,
    resolveLimit(options),
    Number.isFinite(wanted) ? wanted : null,
  );
  return { terms, selectedId, effectiveId };
}

export async function getSelectedTerm(universityId: number | null | undefined): Promise<TermScope | null> {
  const { terms, selectedId } = await getTermScope(universityId);
  if (selectedId) return terms.find((t) => t.id === selectedId) ?? null;
  return terms.find((t) => t.isEffectiveCurrent) ?? null;
}

/**
 * شمارهٔ ترتیبِ ترمِ تحصیلیِ دانشجو بر مبنای ورودی — نه ستونِ `currentTermNo`.
 * کدِ ترمِ ورود از entryYear+entryTerm ساخته می‌شود (مثلاً 1403+2 ⇒ «14032»)
 * و جایگاهِ آن در فهرستِ مرتبِ ترم‌های آموزشیِ دانشگاه تا ترمِ هدف شمرده می‌شود.
 * اگر ترمِ ورود در فهرست نباشد، اولین ترمِ >= آن مبنا می‌شود (ورودی‌های خیلی قدیمی).
 */
export function termOrdinalForEntry(opts: {
  entryYear: number | null | undefined;
  entryTerm: number | null | undefined;
  terms: TermCodeLike[];
  targetTermCode: string | null | undefined;
}): number | null {
  const { entryYear, entryTerm, targetTermCode } = opts;
  if (entryYear == null || !targetTermCode) return null;
  const entryCode = Number(`${entryYear}${entryTerm ?? 1}`);
  const targetCode = termCodeNumber(targetTermCode);
  if (!Number.isFinite(entryCode) || !Number.isFinite(targetCode) || targetCode === Number.NEGATIVE_INFINITY) return null;
  // شمارهٔ ترم را مستقیماً از کدهای ترم حساب می‌کنیم (هر سال = ۲ نیمسال):
  // ورودی ۱۴۰۳۲ → ۴ نیمسال پس از مبدأ، ۱۴۰۵۱ → ۷ نیمسال ⇒ اختلاف + ۱ = ترم ۴.
  // این روش مستقل از این است که دانشگاه چه تعداد ترم را در جدول ثبت کرده باشد
  // (پیش‌تر به‌خاطر کوتاه‌بودن فهرستِ ترم‌ها، همیشه «ترم ۱» نمایش می‌داد).
  const semOf = (code: number) => Math.floor(code / 10) * 2 + (code % 10);
  const ord = semOf(targetCode) - semOf(entryCode) + 1;
  return ord >= 1 ? ord : null;
}
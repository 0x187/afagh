// ============================================================================
// پیشنهاد هوشمند نگاشت «رشتهٔ سنجش» → «رشتهٔ داخلی دانشگاه»
// ----------------------------------------------------------------------------
// چرا لازم است: کد رشتهٔ سنجش (مثل ۳۵۹۱ برای حسابداری) هیچ رابطهٔ عددی با
// کد رشتهٔ داخلی ندارد و جدول sanjesh_mappings هم فقط با تطبیق **دقیق** کد کار
// می‌کند. نتیجه: هر فایل تازه همهٔ ردیف‌ها PENDING_MAPPING می‌شد، در حالی که
// نام رشته («حسابداري») همان‌جا داخل فایل هست.
//
// اصل طراحی: این ماژول فقط **پیشنهاد** می‌دهد. هیچ نگاشتی خودکار نوشته
// نمی‌شود؛ کارشناس با یک کلیک تأیید می‌کند. عمداً هیچ‌جا `db` صدا زده نمی‌شود.
// ============================================================================

/** نرمال‌سازی فارسی/عربی برای مقایسهٔ نام رشته */
export function normalizeFa(input: string): string {
  return String(input ?? '')
    .replace(/[\u064A\u0649]/g, 'ی') // ي عربی و ى
    .replace(/\u0643/g, 'ک') // ك عربی
    .replace(/[\u0623\u0625\u0622]/g, 'ا')
    .replace(/\u0629/g, 'ه') // ة
    .replace(/[\u200B-\u200F\uFEFF]/g, '') // نیم‌فاصله و کاراکترهای جهت
    .replace(/[()\[\]{}«»"'،,.:;؛\-_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * شباهت دو رشتهٔ نرمال‌شده (۰ تا ۱) — ضریب Dice روی دو‌حرفی‌ها.
 * برای نام‌های کوتاه فارسی نتیجهٔ پایدارتری از Levenshtein می‌دهد، چون
 * ترتیب و هم‌پوشانی را با هم می‌سنجد.
 */
export function stringSimilarity(a: string, b: string): number {
  const x = normalizeFa(a);
  const y = normalizeFa(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const bigrams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };

  const bx = bigrams(x);
  const by = bigrams(y);
  let inter = 0;
  for (const [g, n] of bx) inter += Math.min(n, by.get(g) ?? 0);

  const total = Math.max(0, x.length - 1) + Math.max(0, y.length - 1);
  if (total === 0) return 0;
  const dice = (2 * inter) / total;

  // اگر یکی زیرمجموعهٔ دیگری باشد («حسابداری» در «حسابداری دولتی») امتیاز
  // را بالا می‌بریم تا زیرمجموعه‌ها از دست نروند.
  const bonus = x.includes(y) || y.includes(x) ? 0.15 : 0;
  return Math.min(1, dice + bonus);
}

export interface SuggestTarget {
  id: number;
  name: string;
  majorCode?: string | null;
}

export interface Suggestion<T extends SuggestTarget = SuggestTarget> {
  major: T;
  score: number;
  /** ۰..۱۰۰ برای نمایش */
  percent: number;
}

/**
 * رتبه‌بندی رشته‌های داخلی برای یک نام رشتهٔ سنجش.
 * - `minScore` آستانهٔ پذیرش پیشنهاد است (پیش‌فرض ۰٫۵).
 * - خروجی همیشه مرتب‌شده و حداکثر `limit` مورد.
 */
export function suggestMajor<T extends SuggestTarget>(
  sanjeshMajorTitle: string,
  candidates: T[],
  opts: { minScore?: number; limit?: number } = {},
): Suggestion<T>[] {
  const minScore = opts.minScore ?? 0.5;
  const limit = opts.limit ?? 3;
  const title = String(sanjeshMajorTitle ?? '').trim();
  if (!title) return [];

  const scored = candidates
    .map((major) => {
      const score = stringSimilarity(title, major.name);
      return { major, score, percent: Math.round(score * 100) };
    })
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score);

  // اگر دو نام دقیقاً یک امتیاز دارند، ترتیب الفبا پایدار می‌ماند
  return scored.slice(0, limit);
}

/** بهترین پیشنهاد یا null */
export function bestSuggestion<T extends SuggestTarget>(
  sanjeshMajorTitle: string,
  candidates: T[],
  minScore = 0.5,
): Suggestion<T> | null {
  return suggestMajor(sanjeshMajorTitle, candidates, { minScore, limit: 1 })[0] ?? null;
}

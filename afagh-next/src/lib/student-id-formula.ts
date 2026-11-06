// ============================================================================
// موتور فرمول‌ساز پویای شمارهٔ دانشجویی — ماژول مشترک (Shared Formula Engine)
// ----------------------------------------------------------------------------
// این ماژول تک‌منبعِ حقیقت (single source of truth) برای هم‌ترازی فرمول شمارهٔ
// دانشجویی بین **سرور** (تولید واقعی شماره) و **کلاینت** (پیش‌نمایش زنده) است.
// پیش‌تر موتور سرور و شبیه‌ساز کلاینت دو پیاده‌سازی جداگانه داشتند که با هم
// دِریفت می‌کردند (کلاینت `{Year:2}` را یک‌جور نشان می‌داد، سرور جور دیگر).
// حالا هر دو از `applyFormula`/`validateFormula` استفاده می‌کنند.
//
// فرمت توکن:  {نام:عرض}
//   نام  → یکی از کلیدهای شناخته‌شده (جدول FORMULA_TOKENS)
//   عرض  → تعداد ارقام (عدد صحیح مثبت). مقدار از راست پر/بریده می‌شود.
// هر متن خارج از براکت «همان‌طور که هست» (ثابت) باقی می‌ماند — مثلاً پیشوند
// دانشگاه یا جداکننده.
// ============================================================================

export interface FormulaTokenDef {
  key: string;
  label: string;
  desc: string;
  /**
   * اگر مقدار از عرضِ توکن بلندتر باشد، از سمت چپ بریده شود.
   * فقط برای «سال» درست است (۱۴۰۵ با عرض ۲ ⇒ ۰۵). برای بقیهٔ متغیرها
   * بریدن به معنیِ دگرگون‌کردنِ بی‌صدای داده است (۱۰۰۰ با عرض ۳ ⇒ ۰۰۰)
   * و باید خطا بدهد، نه اینکه پنهانی کوتاه شود.
   */
  truncate?: boolean;
  /** مقدار نمونه برای پیش‌نمایش (با عرض پیش‌فرض ۳) */
  sample: (width?: number) => string;
}

/** کاتالوگ متغیرهای قابل استفاده در فرمول — کلاینت برای دکمهٔ درج از آن استفاده می‌کند */
export const FORMULA_TOKENS: FormulaTokenDef[] = [
  { key: 'Year', label: 'سال ورود', desc: 'آخرین ۲ یا ۴ رقم سال (مثلاً ۰۵ یا ۱۴۰۵)', truncate: true, sample: (w) => (w && w >= 4 ? '1405' : '05') },
  { key: 'DegreeCode', label: 'کد مقطع', desc: '۱=کارشناسی، ۲=کارشناسی‌ارشد، ۳=دکتری', sample: () => '1' },
  { key: 'MajorCode', label: 'کد رشته', desc: 'کد رشتهٔ داخلی (تعداد ارقام دلخواه)', sample: (w) => (w && w >= 3 ? '412' : '412').slice(-(w || 3)) },
  { key: 'Seq', label: 'شماره سریال', desc: 'شمارندهٔ اتمیک پذیرش (از چپ با صفر پر می‌شود)', sample: (w) => String(15).padStart(w || 3, '0') },
  { key: 'QuotaCode', label: 'کد سهمیه', desc: 'کد سهمیه/منطقه (۱=عادی، ۲=منطقه۲، …)', sample: (w) => String(1).padStart(w || 1, '0') },
  { key: 'UniversityCode', label: 'کد دانشگاه', desc: 'کد شعبه/دانشگاه (در صورت چند واحدی بودن)', sample: (w) => String(1).padStart(w || 2, '0') },
  { key: 'Gender', label: 'جنسیت', desc: '۱=مرد، ۲=زن (از فایل سنجش)', sample: () => '1' },
  { key: 'Province', label: 'کد استان', desc: 'کد استان محل سکونت (۲ رقم)', sample: (w) => String(11).padStart(w || 2, '0') },
  { key: 'Settlement', label: 'بومی/غیربومی', desc: '۱=بومی، ۲=غیربومی', sample: () => '1' },
  { key: 'DiplomaCode', label: 'کد دیپلم', desc: 'کد رشتهٔ دیپلم داوطلب', sample: () => '41110' },
  { key: 'TermCode', label: 'ترم ورود', desc: 'شمارهٔ ترم ورود (۱ = نیمسال اول)', sample: () => '1' },
];

export const KNOWN_TOKEN_KEYS = new Set(FORMULA_TOKENS.map((t) => t.key));

const TOKEN_DEF = new Map(FORMULA_TOKENS.map((t) => [t.key, t]));

/** فرمول پیش‌فرض — همگام با ستون student_id_formulas */
export const DEFAULT_FORMULA = '{Year:2}{DegreeCode:1}{MajorCode:3}{Seq:3}';

/** تبدیل کد مقطع (BS/MS/PHD) به رقم تک‌رقمی */
export function degreeCodeFor(code: string | null | undefined): string {
  if (code === 'MS') return '2';
  if (code === 'PHD') return '3';
  return '1'; // BS و موارد ناشناخته
}

const TOKEN_RE = /\{([A-Za-z]+):(\d+)\}/g;

/**
 * اعمال فرمول روی نقشهٔ مقادیر.
 * - متغیرهای شناخته‌شده با عرض درست پر/بریده می‌شوند.
 * - متغیر ناشناخته یا براکت نامتعادل ⇒ در `errors` ثبت می‌شود (و همان‌طور رها می‌شود).
 */
export function applyFormula(
  formula: string,
  vars: Record<string, string>,
): { result: string; errors: string[] } {
  const errors: string[] = [];

  const result = formula.replace(TOKEN_RE, (m, key: string, wStr: string) => {
    const width = Number(wStr);
    const def = TOKEN_DEF.get(key);
    if (!def) {
      errors.push(`متغیر ناشناخته: {${key}:${wStr}}`);
      return m;
    }
    const raw = vars[key] ?? '';
    if (raw === '') {
      // مقدار در دسترس نیست ⇒ صفر گذاشتن، جعلِ داده است. صریح خطا می‌دهیم.
      errors.push(`مقدار «${def.label}» برای این ردیف در دسترس نیست — یا فرمول را عوض کنید یا دادهٔ منبع را کامل کنید.`);
      return '?'.repeat(width);
    }
    if (raw.length > width) {
      // فقط «سال» حق دارد از چپ بریده شود (۱۴۰۵ ⇒ ۰۵). بقیه باید خطا بدهند
      // تا عددی مثل ۱۰۰۰ در عرض ۳ به‌صورت پنهانی «۰۰۰» نشود.
      if (def.truncate) return raw.slice(-width);
      errors.push(
        `مقدار {${key}:${width}} از عرض ${width} رقم بلندتر است («${raw}») — عرض را در فرمول زیاد کنید.`,
      );
      return raw;
    }
    return raw.padStart(width, '0');
  });

  // براکت‌های باز/بستهٔ نامتعادل یا فرمت‌های ناقص که با TOKEN_RE همخوانی نداشتند
  const leftover = result.match(/\{[^{}]*\}?|}[^{}]*\}/g);
  if (leftover) {
    for (const piece of leftover) {
      if (!/^\{[A-Za-z]+:\d+\}$/.test(piece)) {
        errors.push(`قالب نامعتبر: "${piece}" (باید {نام:عرض} باشد)`);
      }
    }
  }

  return { result, errors };
}

/**
 * اعتبارسنجی صرفِ نحو فرمول — بدون مقادیر.
 * برای نمایش خطاها در هنگام تایپ در فرم استفاده می‌شود.
 */
export function validateFormula(formula: string): string[] {
  const errors: string[] = [];

  const blocks = formula.match(/\{([^{}]*)\}/g) || [];
  for (const b of blocks) {
    const inner = b.slice(1, -1);
    const m = inner.match(/^([A-Za-z]+):(\d+)$/);
    if (!m) {
      errors.push(`قالب نامعتبر: ${b} (باید {نام:عرض} باشد)`);
      continue;
    }
    const key = m[1];
    const width = Number(m[2]);
    if (!KNOWN_TOKEN_KEYS.has(key)) errors.push(`متغیر ناشناخته: {${key}:${m[2]}}`);
    if (!(width > 0)) errors.push(`عرض باید عددی مثبت باشد: {${key}:${m[2]}}`);
  }

  const open = (formula.match(/\{/g) || []).length;
  const close = (formula.match(/\}/g) || []).length;
  if (open !== close) errors.push('براکت‌های { و } نامتعادل هستند');

  return errors;
}

// ============================================================================
// پیش‌نمایش (فقط کلاینت / تست) — ورودی‌ها را به نقشهٔ مقادیر تبدیل می‌کند
// ============================================================================

export interface SimInputs {
  entryYear: number;
  degreeCode: string; // رقم آماده (۱/۲/۳) — کلاینت از degreeCodeFor می‌سازد
  majorCode: string;
  seq: number;
  quotaCode?: number;
  universityCode?: string;
}

export function simulateStudentId(
  formula: string,
  inputs: SimInputs,
): { result: string; errors: string[] } {
  const vars: Record<string, string> = {
    Year: String(inputs.entryYear ?? 1405),
    DegreeCode: inputs.degreeCode || '1',
    MajorCode: inputs.majorCode || '',
    Seq: String(inputs.seq ?? 0),
    QuotaCode: String(inputs.quotaCode ?? ''),
    UniversityCode: String(inputs.universityCode ?? ''),
  };
  return applyFormula(formula, vars);
}

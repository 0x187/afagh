/**
 * تشخیص کدگذاری و نرمال‌سازی مقادیر فایل‌های سنجش
 *
 * فایل‌های واقعی سه کدگذاری دارند:
 *   - UTF-16LE با BOM (`FF FE`) — قالب امروزی سنجش
 *   - UTF-8 با BOM (`EF BB BF`) — برخی خروجی‌های وب
 *   - Windows-1256 بدون BOM — فایل‌های قدیمی‌تر
 */

export type SanjeshEncoding = 'utf-16le' | 'utf-8' | 'windows-1256';

export interface DecodedFile {
  encoding: SanjeshEncoding;
  hadBom: boolean;
  text: string;
}

/** ارقام فارسی و عربی → ASCII */
const DIGIT_MAP: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

/** ي/ك عربی → ی/ک فارسی */
const LETTER_MAP: Record<string, string> = {
  'ي': 'ی',
  'ك': 'ک',
  'ۀ': 'ه',
  'ة': 'ه',
  'أ': 'ا',
  'إ': 'ا',
  'آ': 'آ',
  'ؤ': 'و',
  'ئ': 'ی',
  '\u200c': ' ', // نیم‌فاصله → فاصله برای مقایسه
};

/** مقدارِ «غایب» در فایل‌های سنجش — خط تیره است، نه صفر */
const ABSENT_MARKERS = new Set(['------', '-----', '----', '---', '--', '-', 'NULL', 'null', 'N/A']);

export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) out += DIGIT_MAP[ch] ?? ch;
  return out;
}

/** نرمال‌سازی برای مقایسهٔ نام (نه برای ذخیره) */
export function normalizePersian(input: string): string {
  let out = '';
  for (const ch of input) out += LETTER_MAP[ch] ?? ch;
  return out
    .replace(/\s+/g, ' ')
    .replace(/[\u064B-\u0652]/g, '') // اعراب
    .trim();
}

/** فقط ارقام ASCII */
export function digitsOnly(input: string): string {
  return normalizeDigits(input).replace(/\D/g, '');
}

export function isAbsent(raw: string | null | undefined): boolean {
  if (raw == null) return true;
  const v = raw.trim();
  return v === '' || ABSENT_MARKERS.has(v);
}

/** تشخیص کدگذاری از BOM */
export function detectEncoding(buf: Uint8Array): { encoding: SanjeshEncoding; hadBom: boolean } {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { encoding: 'utf-16le', hadBom: true };
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { encoding: 'utf-8', hadBom: true };
  // بدون BOM: اگر تعداد بایت‌های صفر در موقعیت‌های فرد زیاد باشد، UTF-16LE است
  let oddZeros = 0;
  const probe = Math.min(buf.length, 2048);
  for (let i = 1; i < probe; i += 2) if (buf[i] === 0) oddZeros++;
  if (probe > 20 && oddZeros > probe / 4) return { encoding: 'utf-16le', hadBom: false };
  return { encoding: 'windows-1256', hadBom: false };
}

/** رمزگشایی بایت‌ها به متن با تشخیص خودکار */
export function decodeSanjeshBuffer(buf: Uint8Array): DecodedFile {
  const { encoding, hadBom } = detectEncoding(buf);
  if (encoding === 'utf-16le') {
    const text = new TextDecoder('utf-16le').decode(buf).replace(/^\uFEFF/, '');
    return { encoding, hadBom, text };
  }
  if (encoding === 'utf-8') {
    const text = new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '');
    return { encoding, hadBom, text };
  }
  // windows-1256؛ اگر TextDecoder پشتیبانی نکند، latin1 به‌عنوان آخرین راه
  try {
    return { encoding, hadBom, text: new TextDecoder('windows-1256').decode(buf) };
  } catch {
    return { encoding, hadBom, text: new TextDecoder('latin1').decode(buf) };
  }
}

/**
 * اعتبارسنجی کد ملی ایران (۱۰ رقم + رقم کنترلی).
 * ارقام تکراری (۱۱۱۱۱۱۱۱۱۱) نامعتبر شمرده می‌شوند.
 */
export function isValidNationalCode(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const code = digitsOnly(raw);
  if (code.length !== 10) return false;
  if (/^(\d)\1{9}$/.test(code)) return false;
  const check = Number(code[9]);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(code[i]) * (10 - i);
  const rem = sum % 11;
  return rem < 2 ? check === rem : check === 11 - rem;
}

/**
 * تاریخ تولد سنجش به برچسب شمسی `YYYY-MM-DD`.
 *   - ۶ رقم: `YYMMDD` — سال دورقمی، همیشه ۱۳xx (در فایل ۱۴۰۵ کاردانی: ۶۶..۸۷)
 *   - ۸ رقم: `YYYYMMDD`
 * مقدار نامعتبر ⇒ null. تاریخ میلادی تولید نمی‌شود؛ قرارداد پروژه: ستون‌های date برچسب شمسی دارند.
 */
export function parseSanjeshBirthDate(raw: string | null | undefined): string | null {
  if (isAbsent(raw)) return null;
  const d = digitsOnly(raw!);
  let y: number, m: number, day: number;
  if (d.length === 6) {
    y = 1300 + Number(d.slice(0, 2));
    m = Number(d.slice(2, 4));
    day = Number(d.slice(4, 6));
  } else if (d.length === 8) {
    y = Number(d.slice(0, 4));
    m = Number(d.slice(4, 6));
    day = Number(d.slice(6, 8));
  } else {
    return null;
  }
  if (y < 1300 || y > 1500 || m < 1 || m > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * «سال اخذ دیپلم» چندمقداری است: `1404,0000,0000` (تا ۳ دیپلم).
 * مقدار اولِ غیرصفر برگردانده می‌شود.
 */
export function parseMultiYear(raw: string | null | undefined): number | null {
  if (isAbsent(raw)) return null;
  const parts = normalizeDigits(raw!).split(/[,،;|/]+/).map((p) => digitsOnly(p));
  for (const p of parts) {
    if (p.length === 4) {
      const n = Number(p);
      if (n >= 1300 && n <= 1500) return n;
    }
  }
  return null;
}

/** عدد صحیح بدون تفسیر مقیاس؛ `------` ⇒ null */
export function parseRawInt(raw: string | null | undefined): number | null {
  if (isAbsent(raw)) return null;
  const v = normalizeDigits(raw!).replace(/[^\d-]/g, '');
  if (v === '' || v === '-') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** عدد اعشاری؛ برای معدل که ممکن است `1597` یعنی 15.97 باشد — تفسیر نمی‌شود */
export function parseDecimalHint(raw: string | null | undefined): number | null {
  if (isAbsent(raw)) return null;
  const v = normalizeDigits(raw!).replace(/[^\d.]/g, '');
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** متن تمیزشده؛ خالی ⇒ null */
export function cleanText(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.trim().replace(/\s+/g, ' ');
  return v === '' || ABSENT_MARKERS.has(v) ? null : v;
}

/** کد عددی به‌صورت رشته با صفرهای ابتدایی حفظ‌شده */
export function cleanCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = normalizeDigits(raw).trim();
  return v === '' || ABSENT_MARKERS.has(v) ? null : v;
}

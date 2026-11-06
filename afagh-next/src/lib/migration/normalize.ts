// ═══ نرمال‌سازی دادهٔ سیستم‌های قدیمی ═══
// ارقام فارسی/عربی، جداکنندهٔ هزارگان، ممیز فارسی، فاصله‌های نیم‌فاصله، تاریخ شمسی→میلادی

const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

// ── حروف عربی → فارسی ──
// فایل‌های سیستم‌های قدیمی (و هر چیزی که از ویندوزِ عربی یا اکسل قدیمی آمده)
// «ي» عربی (U+064A) و «ك» عربی (U+0643) دارند، نه «ی» و «ک» فارسی. تا امروز
// این تفاوتِ نامرئی باعث می‌شد هیچ ستونی از آن فایل‌ها شناسایی نشود و
// جست‌وجوی نام‌ها (دانشکده، گروه) هم بی‌صدا شکست بخورد.
const ARABIC_LETTERS: [RegExp, string][] = [
  [/[\u064A\u0649\u06CD\u06D2]/g, 'ی'],   // ي ى ۍ ے → ی
  [/[\u0643\u06AA\u06AB]/g, 'ک'],          // ك ڪ ګ → ک
  [/\u0629/g, 'ه'],                          // ة → ه
  [/[\u0624]/g, 'و'],                        // ؤ → و
  [/[\u064B-\u0652\u0670]/g, ''],          // اعراب (فتحه، ضمه، تشدید…)
  [/[\u200d\u2066-\u2069\u202a-\u202e]/g, ''], // نویسه‌های کنترلی دوطرفه
];

/** «ي» و «ك» عربی و اعراب را به شکل فارسی برمی‌گرداند (بدون دست‌زدن به آ/ا) */
export function faLetters(s: string): string {
  let out = s;
  for (const [re, to] of ARABIC_LETTERS) out = out.replace(re, to);
  return out;
}

/** ارقام فارسی/عربی → لاتین + حذف جداکنندهٔ هزارگان (٬ ، ,) + ممیز فارسی ٫→. + فاصله‌های زائد */
export function norm(v: unknown): string {
  if (v == null) return '';
  return faLetters(String(v))
    .replace(/[۰-۹]/g, d => FA.indexOf(d).toString())
    .replace(/[٠-٩]/g, d => AR.indexOf(d).toString())
    .replace(/[\u066C\u2019,\s](?=\d{3}\b)/g, '')   // جداکنندهٔ هزارگان ٬ ' ,
    .replace(/\u066B/g, '.')                          // ممیز فارسی ٫
    .replace(/[\u200c\u200f]/g, ' ')                 // نیم‌فاصله → فاصله (برای متن‌ها)
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** عدد از هر فرمت فارسی — null اگر خالی/نامعتبر */
export function num(v: unknown): number | null {
  const s = norm(v).replace(/ /g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** بله/true/1/yes → true */
export function boolFa(v: unknown): boolean {
  const s = norm(v).toLowerCase();
  return ['1', 'بله', 'true', 'yes', 'y', '✓'].includes(s);
}

/**
 * کد (رشته/مقطع/درس/ترم): اکسل و CSV خروجیِ پایتون، عدد صحیح را «84.0» می‌دهند.
 * بدون این، کد رشتهٔ «84.0» هیچ‌وقت با «84» سامانه تطبیق نمی‌خورد و پیام
 * «رشته یافت نشد» می‌دهد، در حالی که رشته با همین کد در سامانه هست.
 */
export function codeOf(v: unknown): string {
  const s = norm(v);
  return /^-?\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s;
}

/** تاریخ شمسی (1399/08/15 یا 1399-08-15) → Date ؛ میلادی ISO هم قبول */
export function dateFa(v: unknown): Date | null {
  const s = norm(v).replace(/[-.]/g, '/');
  if (!s) return null;
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const g = jalaliToGregorian(+m[1], +m[2], +m[3]);
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd, 8, 30, 0));
}

/** الگوریتم استاندارد جلالی→میلادی (jalaali) */
export function jalaliToGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  jy += 1595;
  let days = -355668 + 365 * jy + ~~(jy / 33) * 8 + ~~(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * ~~(days / 146097);
  days %= 146097;
  if (days > 36524) {
    days--;
    gy += 100 * ~~(days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * ~~(days / 1461);
  days %= 1461;
  if (days > 365) {
    days -= 366;
    gy += 1;
    while (days > 364) { days -= 365; gy += 1; }
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const sal = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (; gm < 12 && gd > sal[gm]; gm++) gd -= sal[gm];
  return { gy, gm: gm + 1, gd };
}

/** اعتبارسنجی کد ملی (چک‌سام) — خروجی: 'ok' | 'format' | 'checksum' */
export function checkNationalCode(code: string): 'ok' | 'format' | 'checksum' {
  if (!/^\d{10}$/.test(code)) return 'format';
  if (/^(\d)\1{9}$/.test(code)) return 'checksum';
  const sum = code.split('').slice(0, 9).reduce((s, d, i) => s + +d * (10 - i), 0);
  const r = sum % 11;
  const check = +code[9];
  return (r < 2 ? r : 11 - r) === check ? 'ok' : 'checksum';
}

/** CSV مقاوم: BOM، کوتیشن، کاما/سمی‌کالن/تب، CRLF */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const firstLine = clean.split('\n')[0] || '';
  const delim = [',', ';', '\t'].map(d => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQ) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { cur.push(field); field = ''; }
    else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
    else field += c;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

/** یافتن ستون با نامک‌های فارسی/انگلیسی (بدون حساسیت به فاصله/زیرخط) */
/**
 * کلید تطبیق سرستون: علاوه بر نرمال‌سازی معمول، شکل‌های نوشتاری‌ای که در
 * عمل یک چیزند را یکی می‌کند — «گروه اموزشي» و «گروه آموزشی» باید یک ستون
 * شناخته شوند، وگرنه کاربر باید تک‌تک ۳۶ ستون را دستی نگاشت کند.
 */
export function headerKey(x: string): string {
  return norm(x)
    .toLowerCase()
    .replace(/[آأإٲٳ]/g, 'ا')
    .replace(/[\s_\-./\\()[\]:،,]+/g, '');
}

/**
 * پیدا کردن ستون بر پایهٔ نامک‌ها.
 *
 * گذر اول: برابری دقیق (پس از یکسان‌سازی نوشتار).
 * گذر دوم: سرستونی که نامک را در خود دارد — «شماره موبايل» برای نامک
 *   «موبایل». فقط برای نامک‌های ۴ نویسه به بالا و فقط وقتی *یک* سرستون
 *   می‌خورد؛ وگرنه حدسِ مبهم می‌تواند داده را در ستون اشتباه بنشاند.
 *
 * `exact`: گذر دوم را خاموش می‌کند. برای نامک‌های تک‌کلمه‌ایِ عام که فایل
 *   می‌تواند نسخهٔ *تخصصی‌ترِ* آن‌ها را داشته باشد لازم است: نامک «واحد»
 *   نباید ستون «واحد تئوری» را بردارد، وگرنه واحد کل اشتباه ثبت می‌شود.
 */
export function pickCol(
  headers: string[],
  aliases: string[],
  opts?: { exact?: boolean },
): { idx: number; matched?: string } {
  const hk = headers.map(headerKey);
  for (const a of aliases) {
    const i = hk.indexOf(headerKey(a));
    if (i >= 0) return { idx: i, matched: a };
  }
  if (opts?.exact) return { idx: -1 };
  for (const a of aliases) {
    const k = headerKey(a);
    if (k.length < 4) continue;
    let found = -1;
    let count = 0;
    hk.forEach((h, i) => { if (h.includes(k)) { count++; if (found < 0) found = i; } });
    if (count === 1) return { idx: found, matched: a };
  }
  return { idx: -1 };
}

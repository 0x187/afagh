// ══════════════════════════════════════════════════════════════════════
//  آفاق ERP — خروجی مستقیم Word/Text اسناد مالی
//  (بازسازی قابلیت «خروجی Word/Text مستقیم» سیستم قدیم)
//
//  این ماژول «کاملاً خالص» (pure) است: بدون وابستگی npm، بدون دیتابیس،
//  بدون سمت سرور/کلاینت. تولید HTML سازگار با Word (فرمت HTML قدیمی که
//  Word بدون تبدیل باز می‌کند) و متن سادهٔ UTF-8 برای فایل .txt.
//
//  نکتهٔ Word: فایل .doc اینجا در حقیقت HTML با مای‌تایپ application/msword
//  است — Word آن را مثل DOC واقعی باز می‌کند (ترفند استانداردِ خروجی سرور؛
//  برخلاف export-utils.ts که سمت کلاینت docx واقعی با کتابخانهٔ docx می‌سازد).
//
//  ▸ RTL و فارسی: dir="rtl" + متا charset + فونت وزیرمتن/تاهوما.
//  ▸ گارد تزریق فرمول CSV از `csv-injection.ts` می‌آید (تک‌منبع با مسیر کلاینت).
// ══════════════════════════════════════════════════════════════════════

import { csvQuote } from './csv-injection';

/** مای‌تایپ فایل Word (HTML قدیمی) */
export const DOC_CONTENT_TYPE = 'application/msword';
/** مای‌تایپ متن ساده — BOM در نقطهٔ استفاده اضافه شود تا فارسی در Notepad/Excel درست باشد */
export const TXT_CONTENT_TYPE = 'text/plain;charset=utf-8';
export const CSV_CONTENT_TYPE = 'text/csv;charset=utf-8';

export interface ExportColumn {
  /** کلید ستون در هر ردیف */
  key: string;
  /** عنوان فارسی ستون */
  title: string;
}

export interface ExportDocInput {
  /** عنوان سند (مثلاً «صورت‌حساب مالی دانشجو») */
  title: string;
  /** زیرعنوان اختیاری */
  subtitle?: string;
  /** اطلاعات سربرگ (نام دانشجو، شماره دانشجویی، بازهٔ گزارش و…) */
  meta?: Array<{ label: string; value: string }>;
  columns: ExportColumn[];
  /** ردیف‌های داده — مقادیر با toString نمایش داده می‌شوند */
  rows: Array<Record<string, unknown>>;
  /** پانویس اختیاری (جمع کل، توضیح حقوقی و…) */
  footer?: string;
}

/** فرمت اعداد با جداکنندهٔ هزارگان فارسی (ریال) */
export function faMoney(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return (Number.isFinite(v) ? v : 0).toLocaleString('fa-IR');
}

/** تاریخ/ساعت شمسی برای سربرگ گزارش‌ها */
export function faNow(): string {
  return new Date().toLocaleString('fa-IR');
}

/** escaping امن برای درون‌سازی متن خام در HTML (مانع XSS/شکستن جدول) */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const cellText = (row: Record<string, unknown>, key: string): string => {
  const v = row[key];
  if (typeof v === 'number') return faMoney(v);
  return String(v ?? '');
};

/**
 * ساخت فایل Word (HTML راست‌به‌چپ سازگار با Word).
 * خروجی را با DOC_CONTENT_TYPE و پسوند .doc برگردانید.
 */
export function buildWordDocHtml(input: ExportDocInput): string {
  const { title, subtitle, meta, columns, rows, footer } = input;

  const headRows = (meta ?? [])
    .map((m) => `<tr><td class="meta-l">${esc(m.label)}</td><td class="meta-v">${esc(m.value)}</td></tr>`)
    .join('\n');

  const colHead = columns.map((c) => `<th>${esc(c.title)}</th>`).join('');
  const bodyRows = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${esc(cellText(r, c.key))}</td>`).join('')}</tr>`)
    .join('\n');

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<title>${esc(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4; margin: 1.5cm; }
  body { font-family: 'Vazirmatn', 'Tahoma', Arial, sans-serif; direction: rtl; text-align: right; color: #111827; font-size: 11pt; }
  h1 { text-align: center; font-size: 16pt; margin: 0 0 4px 0; }
  h2 { text-align: center; font-size: 12pt; color: #475569; font-weight: normal; margin: 0 0 12px 0; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { border: 1px solid #334155; padding: 4px 6px; font-size: 10pt; }
  th { background: #e2e8f0; font-weight: bold; }
  table.meta { border: none; width: auto; margin-bottom: 10px; }
  table.meta td { border: none; padding: 1px 8px 1px 0; font-size: 10pt; }
  td.meta-l { color: #475569; font-weight: bold; white-space: nowrap; }
  .footer { margin-top: 14px; font-size: 10pt; color: #334155; border-top: 1px solid #94a3b8; padding-top: 6px; }
  .generated { margin-top: 18px; text-align: center; font-size: 9pt; color: #64748b; }
</style>
</head>
<body dir="rtl">
  <h1>${esc(title)}</h1>
  ${subtitle ? `<h2>${esc(subtitle)}</h2>` : ''}
  ${headRows ? `<table class="meta">${headRows}</table>` : ''}
  <table>
    <thead><tr>${colHead}</tr></thead>
    <tbody>
${bodyRows}
    </tbody>
  </table>
  ${footer ? `<div class="footer">${esc(footer)}</div>` : ''}
  <div class="generated">تاریخ استخراج گزارش: ${esc(faNow())}</div>
</body>
</html>`;
}

/**
 * ساخت متن سادهٔ UTF-8 (برای .txt).
 * جداکنندهٔ « | » و خط جداکنندهٔ خط‌تیره‌ای — بدون پدینگ ستونی
 * (پدینگ با حروف فارسی/عربی در ادیتورهای مختلف به‌هم می‌ریزد).
 */
export function buildPlainText(input: ExportDocInput): string {
  const { title, subtitle, meta, columns, rows, footer } = input;
  const lines: string[] = [];

  lines.push(title);
  if (subtitle) lines.push(subtitle);
  for (const m of meta ?? []) lines.push(`${m.label}: ${m.value}`);
  lines.push('');

  lines.push(columns.map((c) => c.title).join(' | '));
  lines.push(columns.map(() => '---').join('---'));
  for (const r of rows) lines.push(columns.map((c) => cellText(r, c.key)).join(' | '));

  if (footer) lines.push('', footer);
  lines.push('', `تاریخ استخراج گزارش: ${faNow()}`);
  return lines.join('\n');
}

/**
 * یک سلول CSV: گارد فرمول (مشترک با export-utils از `csv-injection`) +
 * نقل‌قول دوتایی. عدد در این مسیر با `faMoney` قالب می‌گیرد (برخلاف مسیر
 * کلاینت که مقدار خام را می‌گذارد).
 */
export function csvCell(v: unknown): string {
  return csvQuote(typeof v === 'number' ? faMoney(v) : v);
}

/** ساخت CSV (برای format=csv در مسیر سروری خروجی) */
export function buildCsv(input: Pick<ExportDocInput, 'columns' | 'rows'>): string {
  const header = input.columns.map((c) => csvCell(c.title)).join(',');
  const body = input.rows.map((r) => input.columns.map((c) => csvCell(r[c.key])).join(',')).join('\n');
  return header + '\n' + body;
}

/**
 * نام فایل خروجی ایمن: فقط کاراکترهای مجاز، بدون فاصلهٔ اضافه، با مهر زمانی
 * تا دو خروجی پشت‌سرهم جایگزین هم نشوند. پسوند بدون نقطه هم پذیرفته می‌شود.
 */
export function makeExportFilename(base: string, ext: string): string {
  const safeBase =
    String(base ?? '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'export';
  const cleanExt = String(ext ?? '').trim().replace(/^\./, '').toLowerCase() || 'txt';
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${safeBase}_${stamp}.${cleanExt}`;
}

/**
 * پارسر فایل‌های سازمان سنجش
 * -------------------------
 * فرمت واقعی (تأییدشده روی سه فایل واقعی):
 *   - هر خط = یک داوطلب
 *   - جداکنندهٔ فیلدها `$`
 *   - هر فیلد با فاصله تا طول اعلامی پر شده، سپس `$`
 *   - کدگذاری UTF-16LE با BOM
 *
 * پارسر **هرگز** به‌خاطر اختلاف تعداد ستون شکست نمی‌خورد:
 *   - ستون بیشتر از قالب  ⇒ با کلید `extra_<n>` ذخیره و «نگاشت‌نشده» علامت می‌خورد
 *   - ستون کمتر از قالب   ⇒ `null` می‌شود و در `warnings` گزارش می‌شود
 * این همان رفتاری است که صفحهٔ «تطبیق فیلدها» در سیستم قبلی داشت.
 */

import {
  cleanCode,
  cleanText,
  decodeSanjeshBuffer,
  digitsOnly,
  isAbsent,
  isValidNationalCode,
  normalizeDigits,
  normalizePersian,
  parseMultiYear,
  parseRawInt,
  parseSanjeshBirthDate,
  repairNationalCode,
  type SanjeshEncoding,
} from './decode';

/** حداقل شکل قالب لازم برای پارس — هم قالب کد و هم قالب دیتابیس را می‌پذیرد */
export interface ParseTemplate {
  key: string;
  columnCount: number;
  columns: {
    colIndex: number;
    sanjeshTitle: string;
    charCount: number;
    targetField: string;
  }[];
}

export interface LengthIssue {
  colIndex: number;
  declared: number;
  actual: number;
}

export interface SanjeshParsedRow {
  /** شمارهٔ ردیف در فایل — از ۱ (بدون احتساب خطوط خالی) */
  rowNo: number;
  /** خط اصلی، بدون هیچ دستکاری */
  rawLine: string;
  /** همهٔ ستون‌ها با کلید شمارهٔ ستون — شامل ستون‌های نگاشت‌نشده */
  columns: Record<string, string>;
  /** ستون‌های نگاشت‌شده با کلید فیلد مقصد */
  fields: Record<string, string>;
  /** مقادیر نرمال‌شده (تاریخ شمسی، عدد، کد ملی تمیزشده…) */
  normalized: Record<string, string | number | null>;
  /** شمارهٔ ستون‌هایی که طولشان از اعلام قالب بیشتر بود */
  lengthIssues: LengthIssue[];
  nationalCode: string | null;
  nationalCodeValid: boolean;
  /** صفرِ اول از فایل افتاده بود و با تأیید رقم کنترلی بازگردانده شد */
  nationalCodeRepaired: boolean;
  fullName: string | null;
  applicantNo: string | null;
  uniqueId: string | null;
}

export interface SanjeshParseResult {
  encoding: SanjeshEncoding;
  hadBom: boolean;
  /** تعداد ستون تشخیص‌داده‌شده از خود فایل (نه از قالب) */
  colCount: number;
  rowCount: number;
  rows: SanjeshParsedRow[];
  /** ستون‌هایی که قالب برایشان تعریف ندارد */
  extraColumns: number[];
  /** ستون‌های قالب که در فایل وجود ندارند */
  missingColumns: number[];
  /** هشدارهای سطح فایل */
  warnings: string[];
  /** طول مشاهده‌شدهٔ هر ستون — برای ساخت قالب از روی فایل */
  observedLengths: Record<string, number>;
  /** نمونهٔ اولین مقدار غیرخالی هر ستون — برای ساخت قالب از روی فایل */
  samples: Record<string, string>;
}

/** تقسیم یک خط به فیلدها؛ `$` جداکننده است و فاصله‌های لبه حذف می‌شوند. */
function splitLine(line: string): string[] {
  // اگر فایل با `$` تمام شود، آخرین جزء خالیِ ناشی از آن حذف می‌شود
  const parts = line.split('$');
  if (parts.length > 1 && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.map((p) => p.replace(/\r$/, ''));
}

/** تبدیل مقدار خام یک ستون به مقدار نرمال‌شده، بر اساس نام فیلد */
function normalizeField(field: string, raw: string): string | number | null {
  if (isAbsent(raw)) return null;
  switch (field) {
    case 'nationalCode': {
      // صفرِ اولِ افتاده بازگردانده می‌شود (سما عدد را بدون صفر ذخیره می‌کند)
      const { value } = repairNationalCode(raw);
      return value || null;
    }
    case 'idNumber':
    case 'applicantNo':
    case 'fileNo':
    case 'uniqueId':
    case 'foreignerRef':
    case 'academicRecordRef':
    case 'phone':
    case 'mobile':
    case 'postalCode':
      return digitsOnly(raw) || null;
    case 'birthDate':
      return parseSanjeshBirthDate(raw);
    case 'diplomaYear':
      return parseMultiYear(raw);
    case 'diplomaGpa':
    case 'associateGpa':
    case 'bachelorGpa':
    case 'totalScore':
    case 'totalRank':
    case 'nationalRank':
    case 'quotaRank':
    case 'orientationRank':
    case 'priority':
    case 'veteranMonths':
    case 'degreeDate':
    case 'preUniversityYear':
      return parseRawInt(raw);
    default:
      if (field.startsWith('rawScore')) return parseRawInt(raw);
      return cleanText(raw);
  }
}

/**
 * پارس بایت‌های فایل.
 * @param input بایت‌های فایل یا متن رمزگشایی‌شده
 * @param template قالب مورد انتظار (اختیاری) — بدون قالب هم پارس انجام می‌شود
 */
export function parseSanjeshFile(
  input: Uint8Array | string,
  template?: ParseTemplate | null,
): SanjeshParseResult {
  let text: string;
  let encoding: SanjeshEncoding;
  let hadBom: boolean;

  if (typeof input === 'string') {
    text = input.replace(/^\uFEFF/, '');
    encoding = 'utf-8';
    hadBom = input.charCodeAt(0) === 0xfeff;
  } else {
    const decoded = decodeSanjeshBuffer(input);
    text = decoded.text;
    encoding = decoded.encoding;
    hadBom = decoded.hadBom;
  }

  const rawLines = text.split(/\r?\n/).filter((l) => l.trim() !== '');

  const byCol = new Map<number, ParseTemplate['columns'][number]>();
  if (template) for (const c of template.columns) byCol.set(c.colIndex, c);

  // ── گذر اول: تعیین تعداد ستون از خود فایل ──
  const splitCache: string[][] = new Array(rawLines.length);
  let colCount = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const parts = splitLine(rawLines[i]);
    splitCache[i] = parts;
    if (parts.length > colCount) colCount = parts.length;
  }

  const extraColumns: number[] = [];
  const missingColumns: number[] = [];
  if (template) {
    for (let c = 1; c <= colCount; c++) if (!byCol.has(c)) extraColumns.push(c);
    for (let c = 1; c <= template.columnCount; c++) if (c > colCount) missingColumns.push(c);
  }

  const observedLengths: Record<string, number> = {};
  const samples: Record<string, string> = {};
  const lengthIssuesGlobal: LengthIssue[] = [];
  const rows: SanjeshParsedRow[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const parts = splitCache[i];
    const columns: Record<string, string> = {};
    const fields: Record<string, string> = {};
    const normalized: Record<string, string | number | null> = {};
    const lengthIssues: LengthIssue[] = [];

    for (let c = 1; c <= colCount; c++) {
      const raw = parts[c - 1] ?? '';
      const trimmed = raw.trim();
      columns[String(c)] = trimmed;

      // آمار ستون — برای «ساخت قالب از روی فایل»
      const len = raw.replace(/\s+$/, '').length;
      if (len > (observedLengths[String(c)] ?? 0)) observedLengths[String(c)] = len;
      if (trimmed !== '' && samples[String(c)] === undefined) samples[String(c)] = trimmed;

      const def = byCol.get(c);
      const fieldName = def?.targetField ?? `extra_${c}`;
      fields[fieldName] = trimmed;
      normalized[fieldName] = normalizeField(fieldName, trimmed);

      if (def && raw.length > def.charCount) {
        lengthIssues.push({ colIndex: c, declared: def.charCount, actual: raw.length });
      }
    }

    // ستون‌های غایب → null صریح، تا کلید در dataJson باشد
    if (template) {
      for (const c of missingColumns) {
        const def = byCol.get(c);
        if (!def) continue;
        fields[def.targetField] = '';
        normalized[def.targetField] = null;
      }
    }

    const ncRaw = fields.nationalCode ?? '';
    const ncFix = repairNationalCode(ncRaw);
    const nationalCode = (normalized.nationalCode as string | null) ?? null;
    const first = cleanText(fields.firstName ?? '');
    const last = cleanText(fields.lastName ?? '');
    const fullName = [first, last].filter(Boolean).join(' ') || null;

    rows.push({
      rowNo: i + 1,
      rawLine: rawLines[i],
      columns,
      fields,
      normalized,
      lengthIssues,
      nationalCode,
      nationalCodeValid: isValidNationalCode(nationalCode),
      nationalCodeRepaired: ncFix.repaired,
      fullName,
      applicantNo: (normalized.applicantNo as string | null) ?? null,
      uniqueId: (normalized.uniqueId as string | null) ?? null,
    });

    if (lengthIssues.length) lengthIssuesGlobal.push(...lengthIssues);
  }

  const warnings: string[] = [];
  if (template && colCount !== template.columnCount) {
    warnings.push(
      `تعداد ستون فایل (${colCount}) با قالب «${template.key}» (${template.columnCount}) یکسان نیست.` +
        (extraColumns.length ? ` ${extraColumns.length} ستون نگاشت‌نشده دارد.` : '') +
        (missingColumns.length ? ` ${missingColumns.length} ستون قالب در فایل غایب است.` : ''),
    );
  }
  if (lengthIssuesGlobal.length) {
    warnings.push(`${lengthIssuesGlobal.length} مقدار از طول اعلامی قالب بلندتر است (مقادیر حفظ شدند).`);
  }
  const invalidNc = rows.filter((r) => r.nationalCode && !r.nationalCodeValid).length;
  if (invalidNc) warnings.push(`${invalidNc} کد ملی از نظر رقم کنترلی نامعتبر است.`);

  return {
    encoding,
    hadBom,
    colCount,
    rowCount: rows.length,
    rows,
    extraColumns,
    missingColumns,
    warnings,
    observedLengths,
    samples,
  };
}

/** فشرده‌سازی یک ردیف برای ذخیره در `sanjesh_file_rows.dataJson` */
export interface SanjeshRowPayload {
  fields: Record<string, string>;
  columns: Record<string, string>;
  meta: {
    templateKey: string | null;
    colCount: number;
    lengthIssues: LengthIssue[];
    nationalCodeValid: boolean;
  };
}

export function buildRowPayload(row: SanjeshParsedRow, templateKey: string | null, colCount: number): SanjeshRowPayload {
  return {
    fields: row.fields,
    columns: row.columns,
    meta: {
      templateKey,
      colCount,
      lengthIssues: row.lengthIssues,
      nationalCodeValid: row.nationalCodeValid,
    },
  };
}

/** اثر انگشت سادهٔ محتوا برای تشخیص ردیف تکراری */
export function rowFingerprint(row: SanjeshParsedRow): string {
  const basis = [
    row.nationalCode ?? '',
    row.applicantNo ?? '',
    normalizePersian(row.fields.lastName ?? ''),
    normalizePersian(row.fields.firstName ?? ''),
    row.fields.birthDate ?? '',
  ].join('|');
  // FNV-1a 32-bit — کافی برای تشخیص تکرار در یک فایل
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** آیا این ستون در قالب تعریف نشده است؟ */
export function isUnmappedField(field: string): boolean {
  return field.startsWith('extra_');
}

/** کد ملی خام ستون‌های نگاشت‌نشده را هم پیدا می‌کند (وقتی قالب تعریف نشده) */
export function guessNationalCodeColumn(result: SanjeshParseResult): number | null {
  for (let c = 1; c <= result.colCount; c++) {
    const vals = result.rows.map((r) => r.columns[String(c)] ?? '').filter((v) => v !== '');
    if (vals.length === 0) continue;
    const allTen = vals.every((v) => digitsOnly(v).length === 10);
    const mostlyValid = vals.filter((v) => isValidNationalCode(v)).length / vals.length > 0.9;
    if (allTen && mostlyValid) return c;
  }
  return null;
}

export { normalizeDigits };

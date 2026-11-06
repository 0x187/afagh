/**
 * خواندنِ فایل‌های TSV که از سما بیرون کشیده می‌شوند.
 *
 * ── چرا این‌قدر «تحمل» دارد ──
 * خروجیِ `sqlcmd` بسته به نسخه و سوئیچ‌ها سه شکل مختلف دارد: با سرستون، بدون
 * سرستون (فقط داده)، و با خطِ جداکنندهٔ تیره‌های `---`. فایل‌های دست‌سازِ
 * کارشناسان هم گاهی cp1256 است و گاهی UTF-8، گاهی BOM دارد و گاهی خطِ اولش
 * خالی است. هر کدام از این‌ها قبلاً یک بار همگام‌سازی را شکسته است، پس پارسر
 * همه را می‌پذیرد و در بدترین حالت `warnings` می‌دهد، نه استثنا.
 */

import type { SamaEnrollRow, SamaStudentRow } from './types';
import { groupNumber, normalizeDigits, parseGrade, termKey } from './normalize';

/** دیکد کردنِ بایت‌ها با پشتیبانی از cp1256 (انکودینگِ رایجِ خروجی‌های فارسیِ ویندوز). */
export function decodeBuffer(buf: Uint8Array, encoding = 'utf-8'): string {
  const enc = encoding.toLowerCase().replace('_', '-');
  if (enc === 'cp1256' || enc === 'windows-1256') {
    try {
      return new TextDecoder('windows-1256').decode(buf);
    } catch {
      // ICU سبک — به UTF-8 برمی‌گردیم و هشدار در سطح پارسر می‌ماند
      return new TextDecoder('utf-8').decode(buf);
    }
  }
  return new TextDecoder('utf-8').decode(buf);
}

const splitLines = (text: string): string[] =>
  text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');

const isSeparatorLine = (line: string): boolean => /^[-=\s]+$/.test(line) && line.includes('-');

/**
 * ستون‌ها را از سرستون پیدا می‌کند. نام‌های پذیرفته‌شده عمداً زیادند: هر بار
 * که فایل از یک کوئریِ متفاوت می‌آمد، سرستون عوض می‌شد.
 */
export interface ColumnAliases { [logical: string]: string[] }

function findColumns(header: string[], aliases: ColumnAliases): Record<string, number> {
  const norm = header.map((h) => normalizeDigits(h).replace(/[\s_"'`]/g, '').toLowerCase());
  const out: Record<string, number> = {};
  for (const [logical, names] of Object.entries(aliases)) {
    for (const name of names) {
      const target = normalizeDigits(name).replace(/[\s_"'`]/g, '').toLowerCase();
      const idx = norm.indexOf(target);
      if (idx >= 0) { out[logical] = idx; break; }
    }
  }
  return out;
}

const ENROLL_ALIASES: ColumnAliases = {
  studentCode: ['Stno', 'StudentCode', 'student_code', 'کد دانشجو', 'شماره دانشجویی', 'stdno'],
  termCode: ['TermCode', 'term_code', 'کد ترم', 'ترم'],
  courseCode: ['LessonCode', 'CourseCode', 'course_code', 'کد درس', 'کد درس سما'],
  groupNumber: ['LessonGroup', 'GroupNumber', 'group', 'گروه', 'شماره گروه'],
  grade: ['Mark', 'Grade', 'gradeValue', 'نمره', 'نمره نهایی'],
  statusCode: ['Status', 'GradeStatus', 'statusCode', 'وضعیت', 'کد وضعیت'],
};

const STUDENT_ALIASES: ColumnAliases = {
  studentCode: ['Stno', 'StudentCode', 'Code', 'کد دانشجو', 'شماره دانشجویی'],
  fullName: ['FullName', 'Name', 'NAME', 'نام', 'نام و نام خانوادگی'],
  majorCode: ['MajorCode', 'ReshteCode', 'کد رشته'],
  statusCode: ['Status', 'StatusCode', 'وضعیت', 'کد وضعیت'],
  entryYear: ['EntryYear', 'Year', 'سال ورود'],
};

export interface ParsedEnrollments {
  rows: SamaEnrollRow[];
  termCode: string;
  warnings: string[];
  /** ستون‌هایی که در فایل پیدا نشدند */
  missingColumns: string[];
}

/**
 * پارسِ فایل انتخاب واحد. اگر ستونِ «گروه» نباشد، `groupNumber` تهی می‌ماند و
 * موتور تطبیق آن را «گروه نامعلوم» می‌بیند (به‌جای حدس زدنِ گروه ۱).
 */
export function parseEnrollmentTsv(text: string, opts: { termCode?: string } = {}): ParsedEnrollments {
  const lines = splitLines(text).filter((l) => l.trim() !== '');
  const warnings: string[] = [];
  if (lines.length === 0) return { rows: [], termCode: opts.termCode ?? '', warnings: ['فایل خالی است'], missingColumns: [] };

  const header = lines[0].split('\t');
  const cols = findColumns(header, ENROLL_ALIASES);
  const hasHeader = cols.studentCode != null && cols.courseCode != null;
  const missingColumns = Object.keys(ENROLL_ALIASES).filter((k) => cols[k] == null);

  let start = hasHeader ? 1 : 0;
  if (hasHeader && lines[start] && isSeparatorLine(lines[start])) start++;
  if (!hasHeader) {
    // بدون سرستون: ترتیبِ متعارفِ کوئریِ ما  Stno, TermCode, LessonCode, LessonGroup, Mark, Status
    cols.studentCode = 0; cols.termCode = 1; cols.courseCode = 2;
    cols.groupNumber = 3; cols.grade = 4; cols.statusCode = 5;
    warnings.push('سرستون پیدا نشد؛ ترتیب متعارف ستون‌ها فرض شد (Stno, TermCode, LessonCode, LessonGroup, Mark, Status)');
  }

  const rows: SamaEnrollRow[] = [];
  let bad = 0;
  for (let i = start; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const pick = (idx?: number) => (idx == null ? '' : (cells[idx] ?? ''));
    const studentCode = normalizeDigits(pick(cols.studentCode));
    const courseCode = normalizeDigits(pick(cols.courseCode));
    if (!studentCode || !courseCode) { bad++; continue; }
    const termCode = termKey(pick(cols.termCode)) || (opts.termCode ?? '');
    rows.push({
      studentCode,
      termCode,
      courseCode,
      groupNumber: groupNumber(pick(cols.groupNumber)),
      grade: parseGrade(pick(cols.grade)),
      statusCode: normalizeDigits(pick(cols.statusCode)) || null,
    });
  }
  if (bad) warnings.push(`${bad} ردیفِ ناقص (بدون کد دانشجو یا کد درس) نادیده گرفته شد`);
  if (missingColumns.includes('groupNumber')) warnings.push('ستون گروه در فایل نیست — اختلافِ گروه قابل تشخیص نیست');
  if (missingColumns.includes('grade')) warnings.push('ستون نمره در فایل نیست — پرکردن نمره انجام نمی‌شود');

  const termCode = rows.find((r) => r.termCode)?.termCode ?? opts.termCode ?? '';
  return { rows, termCode, warnings, missingColumns };
}

export interface ParsedStudents {
  rows: SamaStudentRow[];
  warnings: string[];
}

export function parseStudentTsv(text: string): ParsedStudents {
  const lines = splitLines(text).filter((l) => l.trim() !== '');
  const warnings: string[] = [];
  if (lines.length === 0) return { rows: [], warnings: ['فایل خالی است'] };
  const header = lines[0].split('\t');
  const cols = findColumns(header, STUDENT_ALIASES);
  const hasHeader = cols.studentCode != null;
  let start = hasHeader ? 1 : 0;
  if (hasHeader && lines[start] && isSeparatorLine(lines[start])) start++;
  if (!hasHeader) {
    cols.studentCode = 0; cols.fullName = 1; cols.majorCode = 2; cols.statusCode = 3; cols.entryYear = 4;
    warnings.push('سرستون پیدا نشد؛ ترتیب متعارف فرض شد');
  }
  const rows: SamaStudentRow[] = [];
  let bad = 0;
  for (let i = start; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const pick = (idx?: number) => (idx == null ? '' : (cells[idx] ?? ''));
    const studentCode = normalizeDigits(pick(cols.studentCode));
    if (!studentCode) { bad++; continue; }
    const y = normalizeDigits(pick(cols.entryYear)).replace(/\D+/g, '');
    rows.push({
      studentCode,
      fullName: normalizeDigits(pick(cols.fullName)) || null,
      majorCode: normalizeDigits(pick(cols.majorCode)) || null,
      statusCode: normalizeDigits(pick(cols.statusCode)) || null,
      entryYear: y ? Number(y) : null,
    });
  }
  if (bad) warnings.push(`${bad} ردیفِ بدون کد دانشجو نادیده گرفته شد`);
  return { rows, warnings };
}

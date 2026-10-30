// ═══ کلاینت مرکز کدها — پورت afagh-next/src/app/admin/codes (tables.ts + actions.ts) ═══
import { apiGet, apiPost } from './api';

// ── پورت tables.ts ──

export type CodeTable = 'faculty' | 'department' | 'major' | 'degree' | 'course' | 'term';

export type CodeRow = {
  id: number;
  code: string | null;
  title: string;
  /** زمینهٔ والد: دانشکدهٔ گروه، گروه و مقطعِ رشته… تا کاربر بداند کدام رکورد است */
  context: string | null;
  /** آیا این کد در همین جدول تکراری است؟ */
  duplicate: boolean;
  /** فقط ترم: تاریخ شروع/پایان به قالب 'YYYY-MM-DDTHH:mm' یا null */
  startDate?: string | null;
  endDate?: string | null;
  /** کد استاندارد/کد وزارت — برای اتصال به ثمین (ستون‌های مرجع) */
  standardCode?: string | null;
  ministryCode?: string | null;
};

export type CodeStat = {
  id: CodeTable;
  title: string;
  hint: string;
  editable: boolean;
  creatable: boolean;
  total: number;
  missing: number;
  duplicate: number;
};

export const CODE_TABLES: { id: CodeTable; title: string; hint: string; editable: boolean; creatable: boolean }[] = [
  { id: 'faculty', title: 'دانشکده‌ها', hint: 'کد دانشکده — ریشهٔ ساختار سازمانی', editable: true, creatable: true },
  { id: 'department', title: 'گروه‌های آموزشی', hint: 'کد گروه — ذیل دانشکده', editable: true, creatable: false },
  { id: 'major', title: 'رشته‌ها و گرایش‌ها', hint: 'کد رشته — مقطع و گروه و دانشکده را مشخص می‌کند', editable: true, creatable: true },
  { id: 'degree', title: 'مقاطع تحصیلی', hint: 'کد مقطع — در فایل‌های دانشجو و درس به کار می‌رود', editable: true, creatable: true },
  { id: 'course', title: 'دروس', hint: 'کد درس — کلید یکتای کاتالوگ', editable: true, creatable: false },
  // ترم: کدش ثابت است (در انتخاب واحد، نمره، شهریه و کارنامه ریشه دوانده)، ولی
  // زمان‌بندی ترم (شروع/پایان، انتخاب واحد، حذف و اضافه، امتحانات) ویرایش‌پذیر است.
  { id: 'term', title: 'ترم‌ها', hint: 'کد ترم — مثلاً ۴۰۳۱ · کد ثابت، زمان‌بندی ترم ویرایش‌پذیر است', editable: false, creatable: true },
];

/** برای جدول‌هایی که ساختِ رکورد از این صفحه ممکن نیست، کاربر را کجا بفرستیم */
export const CREATE_ELSEWHERE: Partial<Record<CodeTable, { href: string; label: string }>> = {
  department: { href: '/admin/departments', label: 'ساخت گروه آموزشی در صفحهٔ «گروه‌های آموزشی»' },
  course: { href: '/group-manager/courses', label: 'ساخت درس در کارتابل مدیر گروه ← دروس' },
};

/** برچسب دکمهٔ افزودن — از عنوان جمعِ جدول ساخته نمی‌شود تا فارسی درست بماند */
export const ADD_LABEL: Partial<Record<CodeTable, string>> = {
  faculty: 'افزودن دانشکده',
  major: 'افزودن رشته',
  degree: 'افزودن مقطع تحصیلی',
  term: 'افزودن ترم',
};

export type FieldKind = 'text' | 'code' | 'number' | 'select' | 'date' | 'jdate';

export type NewField = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  hint?: string;
  def?: string;
  /** گزینه‌های select از سرور می‌آید (مقاطع، گروه‌ها یا دانشکده‌ها) */
  optionsFrom?: 'degree' | 'department' | 'faculty';
  /** گزینه‌های ثابت — وقتی به دیتابیس وابسته نیستند */
  choices?: { value: string; label: string }[];
};

/** گزینه‌های والد برای فرم ساخت — از سرور پر می‌شود */
export type FormOptions = {
  degree: { value: string; label: string }[];
  department: { value: string; label: string }[];
  faculty: { value: string; label: string }[];
};

/** کد استاندارد مشترک همهٔ جدول‌های مرجع — برای اتصال به ثمین. */
const SAMIN_CODE_FIELDS: NewField[] = [
  { name: 'standardCode', label: 'کد استاندارد', kind: 'code', hint: 'کد استاندارد وزارت علوم — اختیاری و در هر زمان قابل تغییر' },
];

/** فقط کد استاندارد (بدون کد وزارتی) — برای ترم که کد داخلی ندارد */
const TERM_STANDARD_CODE_FIELD: NewField[] = [
  { name: 'standardCode', label: 'کد استاندارد وزارت', kind: 'code', hint: 'کد استاندارد وزارت علوم برای این ترم — خودکار از کد ترم ساخته می‌شود، در صورت نیاز تغییرش دهید' },
];

/** تعریف فرم «افزودن» برای هر جدول — پورت NEW_FIELDS */
export const NEW_FIELDS: Partial<Record<CodeTable, NewField[]>> = {
  degree: [
    { name: 'title', label: 'عنوان مقطع', kind: 'text', required: true, hint: 'مثلاً: کارشناسی ارشد ناپیوسته' },
    { name: 'code', label: 'کد مقطع', kind: 'code', required: true, hint: 'همان کدی که در فایل‌های دانشجو و درس می‌آید — مثلاً 3' },
    ...SAMIN_CODE_FIELDS,
    { name: 'defaultPassingGrade', label: 'نمرهٔ قبولی', kind: 'number', def: '10', hint: 'حد نصاب قبولی در هر درس' },
    { name: 'conditionalGpaThreshold', label: 'معدل مشروطی', kind: 'number', def: '12', hint: 'زیر این معدل، دانشجو مشروط می‌شود' },
    { name: 'maxUnitsPerTerm', label: 'سقف واحد هر ترم', kind: 'number', def: '20' },
    { name: 'termCount', label: 'تعداد ترم تحصیل', kind: 'number', required: true, def: '8', hint: 'کاردانی/ناپیوسته/ارشد: ۴ · کارشناسی پیوسته: ۸ · چارت ترم‌بندی با همین ساخته می‌شود' },
    {
      name: 'isGraduate', label: 'تحصیلات تکمیلی؟', kind: 'select', required: true, def: '0',
      choices: [
        { value: '0', label: 'نه — کاردانی/کارشناسی' },
        { value: '1', label: 'بله — ارشد/دکترا' },
      ],
    },
  ],
  faculty: [
    { name: 'name', label: 'نام دانشکده', kind: 'text', required: true },
    { name: 'code', label: 'کد دانشکده', kind: 'code', hint: 'اختیاری ولی توصیه می‌شود — انتقال داده اول با کد تطبیق می‌دهد' },
    ...SAMIN_CODE_FIELDS,
  ],
  term: [
    { name: 'code', label: 'کد ترم', kind: 'code', required: true, hint: 'مثلاً 4031 = نیم‌سال اول سال ۱۴۰۳ · پس از ثبت قابل تغییر نیست' },
    ...TERM_STANDARD_CODE_FIELD,
    { name: 'title', label: 'عنوان ترم', kind: 'text', required: true, hint: 'مثلاً: نیم‌سال اول ۱۴۰۳-۱۴۰۴' },
    {
      name: 'termType', label: 'نوع ترم', kind: 'select', required: true, def: 'NORMAL',
      choices: [
        { value: 'NORMAL', label: 'عادی (نیم‌سال)' },
        { value: 'SUMMER', label: 'تابستان' },
        { value: 'EQUIVALENCE', label: 'معادل‌سازی' },
      ],
    },
  ],
  major: [
    { name: 'name', label: 'نام رشته', kind: 'text', required: true },
    { name: 'code', label: 'کد رشته', kind: 'code', hint: 'اختیاری ولی توصیه می‌شود' },
    ...SAMIN_CODE_FIELDS,
    { name: 'degreeLevelId', label: 'مقطع', kind: 'select', required: true, optionsFrom: 'degree' },
    { name: 'departmentId', label: 'گروه آموزشی', kind: 'select', optionsFrom: 'department', hint: 'دانشکده خودکار از روی گروه پر می‌شود' },
    { name: 'minUnits', label: 'حداقل واحد', kind: 'number' },
  ],
  // گروه و درس از این صفحه ساخته نمی‌شوند (CREATE_ELSEWHERE) — تعریف فیلدها
  // فقط برای یکپارچگی با بقیهٔ جدول‌ها و استفادهٔ احتمالی آینده است.
  department: [...SAMIN_CODE_FIELDS],
  course: [...SAMIN_CODE_FIELDS],
};

const YES_NO = [
  { value: '0', label: 'نه' },
  { value: '1', label: 'بله' },
];

/** فرم «ویرایش» برای جدول‌هایی که فیلدهایشان با فرم ساخت فرق دارد (مثل ترم) — پورت EDIT_FIELDS */
export const EDIT_FIELDS: Partial<Record<CodeTable, NewField[]>> = {
  // ویرایش عمومی رشته/گروه/درس/دانشکده — همان فیلدهای فرم ساخت + کد استاندارد
  faculty: [
    { name: 'name', label: 'نام دانشکده', kind: 'text', required: true },
    ...SAMIN_CODE_FIELDS,
  ],
  department: [
    { name: 'name', label: 'نام گروه آموزشی', kind: 'text', required: true },
    { name: 'facultyId', label: 'دانشکده', kind: 'select', required: true, optionsFrom: 'faculty' },
    ...SAMIN_CODE_FIELDS,
  ],
  major: [
    { name: 'name', label: 'نام رشته', kind: 'text', required: true },
    { name: 'degreeLevelId', label: 'مقطع', kind: 'select', required: true, optionsFrom: 'degree' },
    { name: 'departmentId', label: 'گروه آموزشی', kind: 'select', optionsFrom: 'department' },
    { name: 'minUnits', label: 'حداقل واحد', kind: 'number' },
    ...SAMIN_CODE_FIELDS,
  ],
  course: [
    { name: 'title', label: 'عنوان درس', kind: 'text', required: true },
    ...SAMIN_CODE_FIELDS,
  ],
  term: [
    { name: 'title', label: 'عنوان ترم', kind: 'text', required: true, hint: 'مثلاً: نیم‌سال اول ۱۴۰۳-۱۴۰۴' },
    {
      name: 'termType', label: 'نوع ترم', kind: 'select', required: true,
      choices: [
        { value: 'NORMAL', label: 'عادی (نیم‌سال)' },
        { value: 'SUMMER', label: 'تابستان' },
        { value: 'EQUIVALENCE', label: 'معادل‌سازی' },
        { value: 'SPECIAL', label: 'ویژه' },
      ],
    },
    // کد استاندارد وزارت برای ترم باقی می‌ماند (خودکار پر می‌شود، در صورت نیاز قابل تغییر)
    ...TERM_STANDARD_CODE_FIELD,
    { name: 'academicYear', label: 'سال تحصیلی', kind: 'number', hint: 'مثلاً 1403 — مبنای گزارش‌ها و تقویم تحصیلی' },
    { name: 'startDate', label: 'شروع ترم', kind: 'date' },
    { name: 'endDate', label: 'پایان ترم', kind: 'date' },
    { name: 'enrollmentStartDate', label: 'شروع انتخاب واحد', kind: 'date' },
    { name: 'enrollmentEndDate', label: 'پایان انتخاب واحد', kind: 'date' },
    { name: 'addDropStartDate', label: 'شروع حذف و اضافه', kind: 'date' },
    { name: 'addDropEndDate', label: 'پایان حذف و اضافه', kind: 'date' },
    { name: 'gradeEntryDeadline', label: 'مهلت ثبت نمره', kind: 'date' },
    { name: 'examStartDate', label: 'شروع امتحانات', kind: 'jdate', hint: 'شمسی: 1404/01/15 — پنجرهٔ کل امتحانات (بازهٔ عمومی/تخصصی در ماژول امتحانات)' },
    { name: 'examEndDate', label: 'پایان امتحانات', kind: 'jdate' },
    { name: 'appealWindowDays', label: 'مهلت اعتراض دانشجو (روز)', kind: 'number', def: '3' },
    { name: 'professorAppealSlaDays', label: 'مهلت پاسخ استاد (روز)', kind: 'number', def: '5' },
    { name: 'isCurrent', label: 'ترم جاری؟', kind: 'select', def: '0', choices: YES_NO, hint: 'در هر دانشگاه فقط یک ترم جاری است — فعال‌کردن، بقیه را خاموش می‌کند' },
    { name: 'isEnrollmentOpen', label: 'انتخاب واحد باز است؟', kind: 'select', def: '0', choices: YES_NO, hint: 'در هر دانشگاه فقط برای یک ترم باز است' },
  ],
};

// ── فراخوانی‌های API — پورت actions.ts ──

export type MissingSummary = { table: string; missing: number };

/** آمار سلامت کدها — کارت‌های بالای صفحه */
export async function getCodeStats(): Promise<CodeStat[]> {
  const res = await apiGet<{ ok: boolean; data: { stats: CodeStat[] } }>('/admin/codes/stats');
  return res.data.stats;
}

/** فهرست کدهای یک جدول (با جست‌وجو) */
export async function getCodeRows(table: CodeTable, q = ''): Promise<CodeRow[]> {
  const sp = new URLSearchParams({ table });
  if (q) sp.set('q', q);
  const res = await apiGet<{ ok: boolean; data: { rows: CodeRow[] } }>(`/admin/codes/rows?${sp}`);
  return res.data.rows;
}

/** خلاصهٔ جدول‌های دارای رکورد بی‌کد */
export async function getMissingCodeSummary(): Promise<MissingSummary[]> {
  const res = await apiGet<{ ok: boolean; data: { missing: MissingSummary[] } }>('/admin/codes/missing-summary');
  return res.data.missing;
}

/** گزینه‌های والد فرم ساخت */
export async function getCodeFormOptions(): Promise<FormOptions> {
  const res = await apiGet<{ ok: boolean; data: FormOptions }>('/admin/codes/form-options');
  return {
    degree: res.data.degree ?? [],
    department: res.data.department ?? [],
    faculty: res.data.faculty ?? [],
  };
}

/** متن CSV یک جدول — دانلود از متن در صفحه انجام می‌شود */
export async function exportCodesCsv(table: CodeTable): Promise<string> {
  const res = await apiGet<{ ok: boolean; data: { csv: string } }>(`/admin/codes/export?table=${table}`);
  return res.data.csv;
}

/** شمار رکوردهای جدول بدون بارگذاری کامل */
export async function countCodeRows(table: CodeTable): Promise<number> {
  const res = await apiGet<{ ok: boolean; data: { count: number } }>(`/admin/codes/count?table=${table}`);
  return res.data.count;
}

/** ویرایش کد یک رکورد — کدهای ثمینی اختیاری‌اند (نفرستدن = دست‌نخورده) */
export async function setCode(
  table: CodeTable, id: number, code: string,
  extra?: { standardCode?: string; ministryCode?: string },
): Promise<void> {
  await apiPost('/admin/codes/set-code', {
    table,
    id,
    code,
    ...(extra?.standardCode !== undefined ? { standardCode: extra.standardCode } : {}),
    ...(extra?.ministryCode !== undefined ? { ministryCode: extra.ministryCode } : {}),
  });
}

/** ساخت رکورد مرجع تازه (مقطع/دانشکده/رشته/ترم) */
export async function createCodeRow(table: CodeTable, values: Record<string, string>): Promise<{ id: number }> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/codes/create', { table, values });
  return res.data;
}

/** ویرایش عمومی سطر (دانشکده/گروه/رشته/درس) */
export async function updateCodeRow(table: CodeTable, id: number, values: Record<string, string>): Promise<void> {
  await apiPost('/admin/codes/row/update', { table, id, values });
}

/** حذف رکورد مرجع — فقط وقتی هیچ‌جا استفاده نشده باشد */
export async function deleteCodeRow(table: CodeTable, id: number): Promise<void> {
  await apiPost('/admin/codes/delete', { table, id });
}

/** خواندن یک سطر برای فرم ویرایش عمومی (دانشکده/گروه/رشته/درس) */
export async function getCodeRow(table: CodeTable, id: number): Promise<Record<string, string> | null> {
  const res = await apiGet<{ ok: boolean; data: { row: Record<string, string> | null } }>(
    `/admin/codes/row?table=${table}&id=${id}`,
  );
  return res.data.row;
}

/** خواندن یک مقطع برای فرم ویرایش — همان فیلدهای فرم ساخت، همه رشته */
export async function getDegreeRow(id: number): Promise<Record<string, string> | null> {
  const res = await apiGet<{ ok: boolean; data: { degree: Record<string, unknown> | null } }>(`/admin/codes/degree?id=${id}`);
  const d = res.data.degree;
  if (!d) return null;
  const s = (v: unknown): string => (v == null ? '' : String(v));
  return {
    title: s(d.title),
    code: s(d.code),
    standardCode: s(d.standardCode),
    ministryCode: s(d.ministryCode),
    defaultPassingGrade: s(d.defaultPassingGrade),
    conditionalGpaThreshold: s(d.conditionalGpaThreshold),
    maxUnitsPerTerm: s(d.maxUnitsPerTerm),
    termCount: s(d.termCount),
    isGraduate: d.isGraduate != null ? s(d.isGraduate) : '0',
  };
}

/** ویرایش مقطع — همهٔ فیلدهای فرم ساخت */
export async function updateDegreeRow(id: number, values: Record<string, string>): Promise<void> {
  await apiPost('/admin/codes/degree/update', { id, values });
}

/** خواندن یک ترم برای فرم ویرایش زمان‌بندی */
export async function getTermRow(id: number): Promise<Record<string, string> | null> {
  const res = await apiGet<{ ok: boolean; data: { term: Record<string, string> | null } }>(`/admin/codes/term?id=${id}`);
  return res.data.term;
}

/** ویرایش زمان‌بندی ترم (شروع/پایان، انتخاب واحد، حذف و اضافه، امتحانات، اعتراضات) */
export async function updateTermRow(id: number, values: Record<string, string>): Promise<void> {
  await apiPost('/admin/codes/term/update', { id, values });
}

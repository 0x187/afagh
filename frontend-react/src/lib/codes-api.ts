// ═══ Codes center client — port of afagh-next/src/app/admin/codes (tables.ts + actions.ts) ═══
import { apiGet, apiPost } from './api';

// ── Port of tables.ts ──

export type CodeTable = 'faculty' | 'department' | 'major' | 'degree' | 'course' | 'term';

export type CodeRow = {
  id: number;
  code: string | null;
  title: string;
  /** Parent context: group's faculty, group, and major's level… so the user knows which record it is */
  context: string | null;
  /** Is this code a duplicate within the same table? */
  duplicate: boolean;
  /** Term only: start/end dates in 'YYYY-MM-DDTHH:mm' format or null */
  startDate?: string | null;
  endDate?: string | null;
  /** Standard code/ministry code — for linking to Samin (reference columns) */
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
  // Term: its code is fixed (rooted in course registration, grades, tuition, and transcripts), but
  // the term schedule (start/end, course registration, add/drop, exams) is editable.
  { id: 'term', title: 'ترم‌ها', hint: 'کد ترم — مثلاً ۴۰۳۱ · کد ثابت، زمان‌بندی ترم ویرایش‌پذیر است', editable: false, creatable: true },
];

/** Where to send the user for tables whose records cannot be created from this page */
export const CREATE_ELSEWHERE: Partial<Record<CodeTable, { href: string; label: string }>> = {
  department: { href: '/admin/departments', label: 'ساخت گروه آموزشی در صفحهٔ «گروه‌های آموزشی»' },
  course: { href: '/group-manager/courses', label: 'ساخت درس در کارتابل مدیر گروه ← دروس' },
};

/** Add button label — not derived from the table's plural title so the Persian stays correct */
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
  /** Select options come from the server (levels, groups, or faculties) */
  optionsFrom?: 'degree' | 'department' | 'faculty';
  /** Fixed options — for when they do not depend on the database */
  choices?: { value: string; label: string }[];
};

/** Parent options for the create form — populated from the server */
export type FormOptions = {
  degree: { value: string; label: string }[];
  department: { value: string; label: string }[];
  faculty: { value: string; label: string }[];
};

/** Standard code shared by all reference tables — for linking to Samin. */
const SAMIN_CODE_FIELDS: NewField[] = [
  { name: 'standardCode', label: 'کد استاندارد', kind: 'code', hint: 'کد استاندارد وزارت علوم — اختیاری و در هر زمان قابل تغییر' },
];

/** Standard code only (no ministry code) — for term, which has no internal code */
const TERM_STANDARD_CODE_FIELD: NewField[] = [
  { name: 'standardCode', label: 'کد استاندارد وزارت', kind: 'code', hint: 'کد استاندارد وزارت علوم برای این ترم — خودکار از کد ترم ساخته می‌شود، در صورت نیاز تغییرش دهید' },
];

/** "Add" form definition for each table — port of NEW_FIELDS */
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
  // Groups and courses are not created from this page (CREATE_ELSEWHERE) — the field definitions
  // exist only for consistency with the other tables and possible future use.
  department: [...SAMIN_CODE_FIELDS],
  course: [...SAMIN_CODE_FIELDS],
};

const YES_NO = [
  { value: '0', label: 'نه' },
  { value: '1', label: 'بله' },
];

/** "Edit" form for tables whose fields differ from the create form (e.g. term) — port of EDIT_FIELDS */
export const EDIT_FIELDS: Partial<Record<CodeTable, NewField[]>> = {
  // Generic editing of major/group/course/faculty — same fields as the create form + standard code
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
    // The ministry standard code remains for term (auto-filled, changeable if needed)
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

// ── API calls — port of actions.ts ──

export type MissingSummary = { table: string; missing: number };

/** Code health stats — cards at the top of the page */
export async function getCodeStats(): Promise<CodeStat[]> {
  const res = await apiGet<{ ok: boolean; data: { stats: CodeStat[] } }>('/admin/codes/stats');
  return res.data.stats;
}

/** List of codes of a table (with search) */
export async function getCodeRows(table: CodeTable, q = ''): Promise<CodeRow[]> {
  const sp = new URLSearchParams({ table });
  if (q) sp.set('q', q);
  const res = await apiGet<{ ok: boolean; data: { rows: CodeRow[] } }>(`/admin/codes/rows?${sp}`);
  return res.data.rows;
}

/** Summary of tables with records lacking a code */
export async function getMissingCodeSummary(): Promise<MissingSummary[]> {
  const res = await apiGet<{ ok: boolean; data: { missing: MissingSummary[] } }>('/admin/codes/missing-summary');
  return res.data.missing;
}

/** Parent options for the create form */
export async function getCodeFormOptions(): Promise<FormOptions> {
  const res = await apiGet<{ ok: boolean; data: FormOptions }>('/admin/codes/form-options');
  return {
    degree: res.data.degree ?? [],
    department: res.data.department ?? [],
    faculty: res.data.faculty ?? [],
  };
}

/** CSV text of a table — the download happens in-page from the text */
export async function exportCodesCsv(table: CodeTable): Promise<string> {
  const res = await apiGet<{ ok: boolean; data: { csv: string } }>(`/admin/codes/export?table=${table}`);
  return res.data.csv;
}

/** Count of a table's records without a full load */
export async function countCodeRows(table: CodeTable): Promise<number> {
  const res = await apiGet<{ ok: boolean; data: { count: number } }>(`/admin/codes/count?table=${table}`);
  return res.data.count;
}

/** Edit a record's code — Samin codes are optional (not sending = untouched) */
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

/** Create a new reference record (level/faculty/major/term) */
export async function createCodeRow(table: CodeTable, values: Record<string, string>): Promise<{ id: number }> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/codes/create', { table, values });
  return res.data;
}

/** Generic row editing (faculty/group/major/course) */
export async function updateCodeRow(table: CodeTable, id: number, values: Record<string, string>): Promise<void> {
  await apiPost('/admin/codes/row/update', { table, id, values });
}

/** Delete a reference record — only when it is unused anywhere */
export async function deleteCodeRow(table: CodeTable, id: number): Promise<void> {
  await apiPost('/admin/codes/delete', { table, id });
}

/** Read a row for the generic edit form (faculty/group/major/course) */
export async function getCodeRow(table: CodeTable, id: number): Promise<Record<string, string> | null> {
  const res = await apiGet<{ ok: boolean; data: { row: Record<string, string> | null } }>(
    `/admin/codes/row?table=${table}&id=${id}`,
  );
  return res.data.row;
}

/** Read a level for the edit form — same fields as the create form, all string */
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

/** Edit a level — all fields of the create form */
export async function updateDegreeRow(id: number, values: Record<string, string>): Promise<void> {
  await apiPost('/admin/codes/degree/update', { id, values });
}

/** Read a term for the schedule edit form */
export async function getTermRow(id: number): Promise<Record<string, string> | null> {
  const res = await apiGet<{ ok: boolean; data: { term: Record<string, string> | null } }>(`/admin/codes/term?id=${id}`);
  return res.data.term;
}

/** Edit term schedule (start/end, course registration, add/drop, exams, objections) */
export async function updateTermRow(id: number, values: Record<string, string>): Promise<void> {
  await apiPost('/admin/codes/term/update', { id, values });
}

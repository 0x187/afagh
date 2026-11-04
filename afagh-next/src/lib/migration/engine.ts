import { randomBytes, scryptSync } from 'crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  academic_terms, course_offerings, courses, curriculum_courses, curriculum_tracks, curriculum_versions, degree_level_configs,
  departments, educational_regulations, enrollments, faculties, financial_clearances,
  majors, migration_runs, roles, staff, student_ledger, students, user_roles, users,
} from '@/db/schema';
import { boolFa, checkNationalCode, codeOf, dateFa, norm, num } from './normalize';
import { clearPermissionCache } from '@/lib/permissions-enforcer';
import { computeGradeStatus } from '@/lib/grade-utils';
import { COURSE_ALIASES, parseCourseRow } from './course-row';
import { parseEquivalentCodes, parseRequisiteText } from '@/lib/prereq-text';
import { syncRequisiteRulesFromCourses } from '@/lib/requisite-sync';
import {
  DEPARTMENT_ALIASES, FACULTY_ALIASES, MAJOR_ALIASES, PROFESSOR_ALIASES,
  parseDepartmentRow, parseFacultyRow, parseMajorRow, parseProfessorRow,
} from './reference-rows';
import { iterate, pickTable, type Table } from './tabular';
import { codeRewriterFor, noopRewriter, resolverFor, type CodeRewriter, type MapDomain } from './codemap';
import { roleFromBankType } from '@/lib/bank-roles';

// ═══ سامانهٔ مهاجرت داده از سیستم قدیمی — آموزشی + مالی ═══
// معماری: parse → normalize → validate → (dry-run گزارش | commit تراکنشی idempotent)
// ورودی: فایل اکسل (xlsx) یا CSV با سرستون‌های فارسی یا انگلیسی (نامک‌ها انعطاف‌پذیر)

export type Entity =
  | 'faculty' | 'department' | 'major' | 'professor'
  | 'student' | 'course' | 'term' | 'enrollment' | 'ledger' | 'clearance' | 'curriculum';
export const ENTITIES: { id: Entity; title: string; sample: string }[] = [
  { id: 'faculty', title: 'دانشکده‌ها', sample: 'کد دانشکده, نام دانشکده' },
  { id: 'department', title: 'گروه‌های آموزشی', sample: 'کد گروه, نام گروه, کد دانشکده, نام دانشکده' },
  { id: 'major', title: 'رشته‌ها و گرایش‌ها', sample: 'کد رشته, نام رشته, کد مقطع, مقطع, کد گروه آموزشی, نام گروه آموزشی, کد دانشکده, نام دانشکده, گرایش, حداقل واحد, کد استاندارد, تاریخ تاسیس, فعال' },
  { id: 'professor', title: 'اطلاعات استادان', sample: 'کد استادی, کد ملی, نام, نام خانوادگی, لقب, گروه آموزشی, دانشکده, مرتبه علمی, مدرک, طریقه همکاری, تاریخ استخدام, رشته و گرایش, موبایل' },
  { id: 'student', title: 'دانشجویان (هویت + پرونده)', sample: 'کد ملی, نام, نام خانوادگی, شماره دانشجویی, سال ورود, کد رشته, نام رشته, کد مقطع, مقطع, وضعیت, شماره شناسنامه, نام پدر, تاریخ تولد, محل تولد, جنسیت' },
  { id: 'course', title: 'دروس', sample: 'کد درس, نام درس, واحد, واحد نظری, واحد عملی, نوع, کد مقطع, مقطع, کد گروه آموزشی, نام گروه آموزشی' },
  { id: 'term', title: 'ترم‌ها', sample: 'کد ترم, عنوان ترم, ترم جاری' },
  { id: 'enrollment', title: 'ثبت‌نام‌ها و نمرات (آموزشی)', sample: 'شماره دانشجویی, کد درس, کد ترم, نمره, وضعیت نمره' },
  { id: 'ledger', title: 'صورتحساب دانشجویان (مالی)', sample: 'شماره دانشجویی, کد ترم, نوع, مبلغ, شرح, تاریخ' },
  { id: 'clearance', title: 'تسویه‌حساب ترمی (مالی)', sample: 'شماره دانشجویی, کد ترم, تسویه' },
  { id: 'curriculum', title: 'چارت/برنامهٔ درسی رشته', sample: 'کد رشته, نام رشته, کد مقطع, مقطع, از ورودی, تا ورودی, کد درس, نام درس, واحد, ترم پیشنهادی, نقش, الزامی' },
];

export type RowIssue = { row: number; msg: string };
export type Report = {
  entity: Entity; fileName: string; total: number; invalid: number;
  willInsert: number; existing: number;
  errors: RowIssue[]; warnings: RowIssue[];
  sample: Record<string, unknown>[];
};

const STUDENT_STATUS: Record<string, string> = {
  'فعال': 'ACTIVE', 'active': 'ACTIVE',
  'مسدود': 'BLOCKED_COMMISSION', 'blocked': 'BLOCKED_COMMISSION',
  'فارغ التحصیل': 'GRADUATED', 'فارغ‌التحصیل': 'GRADUATED', 'graduated': 'GRADUATED',
  'اخراج': 'EXPELLED', 'انصراف': 'EXPELLED', 'expelled': 'EXPELLED',
};
const GRADE_STATUS: Record<string, string> = { 'قطعی': 'FINALIZED', 'موقت': 'TEMPORARY', 'finalized': 'FINALIZED', 'temporary': 'TEMPORARY' };
const GENDER: Record<string, string> = {
  'مرد': 'MALE', 'مذکر': 'MALE', 'male': 'MALE', 'm': 'MALE',
  'زن': 'FEMALE', 'مونث': 'FEMALE', 'female': 'FEMALE', 'f': 'FEMALE',
};
const TX_TYPE: Record<string, string> = {
  'بدهی': 'DEBIT', 'قبض': 'DEBIT', 'debit': 'DEBIT', 'طلب': 'CREDIT', 'بستانکار': 'CREDIT',
  'پرداخت': 'CREDIT', 'واریز': 'CREDIT', 'credit': 'CREDIT', 'برگشت': 'CREDIT',
};

/** هش رمز عبور با همان قالب salt:scrypt(password) — سازگار با src/lib/auth.ts */
function hashDefault(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}`;
}

/**
 * 🔐 رمز یکبارمصرف تصادفی (۱۴۴ بیت آنتروپی).
 * هرگز از کد ملی — که قابل‌حدس است — مشتق نمی‌شود.
 */
function randomOneTimePassword(): string {
  return randomBytes(18).toString('base64url').slice(0, 24);
}

export type Prepared = {
  report: Report;
  rows: Record<string, unknown>[];   // ردیف‌های سالمِ نرمال‌شده آمادهٔ درج
  rowNumbers: number[];              // شمارهٔ خط هر ردیف سالم
};

// ── مرحلهٔ ۱+۲: تجزیه و اعتبارسنجی ──
const ENTITY_HINTS: Record<Entity, string[][]> = {
  faculty: [[...FACULTY_ALIASES.name], [...FACULTY_ALIASES.code]],
  department: [[...DEPARTMENT_ALIASES.name], [...DEPARTMENT_ALIASES.code], [...DEPARTMENT_ALIASES.faculty]],
  major: [[...MAJOR_ALIASES.code], [...MAJOR_ALIASES.name], [...MAJOR_ALIASES.degree]],
  professor: [[...PROFESSOR_ALIASES.staffCode], [...PROFESSOR_ALIASES.last], [...PROFESSOR_ALIASES.department]],
  student: [['کد ملی', 'national_code'], ['شماره دانشجویی', 'student_code'], ['نام خانوادگی', 'last_name']],
  course: [[...COURSE_ALIASES.code], [...COURSE_ALIASES.title], [...COURSE_ALIASES.units], [...COURSE_ALIASES.theory], [...COURSE_ALIASES.degree]],
  term: [['کد ترم', 'term_code'], ['عنوان ترم', 'title']],
  enrollment: [['شماره دانشجویی', 'student_code'], ['کد درس', 'course_code'], ['نمره', 'grade']],
  ledger: [['شماره دانشجویی', 'student_code'], ['مبلغ', 'amount'], ['نوع', 'type']],
  clearance: [['شماره دانشجویی', 'student_code'], ['تسویه', 'cleared']],
  curriculum: [['کد رشته', 'major_code'], ['کد درس', 'course_code']],
};

/**
 * مرحلهٔ تجزیه/اعتبارسنجی — کاملاً خالص (بدون DB) تا در تست واحد پوشش داده شود.
 * `dryRun` و `commit` هر دو از همین یک تابع استفاده می‌کنند، پس گزارشِ پیش‌نمایش
 * دقیقاً همان چیزی است که در ثبت نهایی اعمال می‌شود.
 */
export function prepare(entity: Entity, tables: Table[], fileName: string): Prepared {
  const report: Report = { entity, fileName, total: 0, invalid: 0, willInsert: 0, existing: 0, errors: [], warnings: [], sample: [] };
  const table = pickTable(tables, ENTITY_HINTS[entity]);
  if (!table || !table.rows.length) { report.errors.push({ row: 0, msg: 'فایل خالی یا بدون ردیف داده است.' }); return { report, rows: [], rowNumbers: [] }; }
  const body = iterate(table);
  report.total = body.length;

  const rows: Record<string, unknown>[] = [];

  body.forEach(rec => {
    const ln = rec.line; // شمارهٔ خط انسانی (۱ = سرستون)
    const get = rec.get;
    const err = (m: string) => report.errors.push({ row: ln, msg: m });
    const warn = (m: string) => report.warnings.push({ row: ln, msg: m });

    if (entity === 'student') {
      const nc = get(['کد ملی', 'کدملی', 'national_code', 'nationalcode', 'ncode']);
      const first = get(['نام', 'first_name', 'firstname']);
      const last = get(['نام خانوادگی', 'نامخانوادگی', 'last_name', 'lastname']);
      const code = get(['شماره دانشجویی', 'شمارهدانشجویی', 'student_code', 'studentcode']);
      const entryYear = num(get(['سال ورود', 'ورودی', 'entry_year']));
      const entryTerm = num(get(['نیمسال ورود', 'نیمسال ورودی', 'entry_term', 'entryTerm']));
      const majorName = get(['نام رشته', 'رشته', 'گرایش', 'major']);
      // ⭐ «کد رشته» سند اصالت است: نام رشته می‌تواند در دو مقطع یا دو دانشکده
      //    تکرار شود، ولی کد یکتاست و مقطع/گروه/دانشکده را هم مشخص می‌کند.
      const majorCode = codeOf(get(['کد رشته', 'کدرشته', 'major_code']));
      const degreeName = get(['مقطع', 'مقطع تحصیلی', 'سطح', 'degree', 'degree_level']);
      const degreeCode = codeOf(get(['کد مقطع', 'کد مقطع تحصیلی', 'degree_code', 'degree_level_code']));
      const statusFa = get(['وضعیت']) || 'فعال';
      // اطلاعات شناسنامه‌ای (اختیاری در فایل قدیمی، ولی برای اسناد رسمی لازم است)
      const birthCertNo = get(['شماره شناسنامه', 'شمارهشناسنامه', 'birth_cert_no', 'shenasname']);
      const birthCertSeries = get(['سریال شناسنامه', 'سری شناسنامه', 'birth_cert_series', 'series']);
      const placeOfBirth = get(['محل تولد', 'محلتولد', 'place_of_birth', 'birth_place']);
      const placeOfIssue = get(['محل صدور', 'محلصدور', 'place_of_issue']);
      const birthDate = dateFa(get(['تاریخ تولد', 'تاریختولد', 'birth_date', 'birthdate']));
      const fatherName = get(['نام پدر', 'نامپدر', 'father_name', 'father']);
      const genderFa = get(['جنسیت', 'جنس', 'gender', 'sex']);
      const address = get(['آدرس', 'نشانی', 'address']);
      // نام فایل عکس در سیستم قدیمی؛ آرشیو ZIP عکس‌ها بعداً با همین نام وصل می‌شود
      const photoFile = get(['نام فایل عکس', 'عکس', 'فایل عکس', 'تصویر', 'photo', 'photo_file', 'image', 'picture']);
      if (!nc || !first || !last || !code) return err('کد ملی/نام/نام خانوادگی/شماره دانشجویی الزامی است.');
      const chk = checkNationalCode(nc);
      if (chk === 'format') return err(`کد ملی نامعتبر: ${nc}`);
      if (chk === 'checksum') warn(`چک‌سام کد ملی ${nc} منطبق نیست (ثبت می‌شود — در سیستم قدیمی هم رایج است).`);
      if (!/^\d{8,14}$/.test(code)) return err(`شماره دانشجویی نامعتبر: ${code}`);
      if (!entryYear || entryYear < 1330 || entryYear > 1410) warn(`سال ورود نامعمول: ${entryYear}`);
      if (!majorCode && !majorName) warn('نه «کد رشته» و نه «نام رشته» در این سطر نیست — دانشجو بدون رشته ثبت می‌شود.');
      if (!majorCode && majorName && !degreeName && !degreeCode)
        warn(`رشتهٔ «${majorName}» فقط با نام می‌آید (بدون «کد رشته» و بدون مقطع) — اگر رشتهٔ هم‌نامی در مقطع یا دانشکدهٔ دیگر باشد، خطر تطبیق اشتباه هست.`);
      else if (!degreeName && !degreeCode) warn(`مقطع ذکر نشده — رشته ممکن است با مقطع دیگر هم‌نام باشد و اشتباه تطبیق یابد.`);
      const status = STUDENT_STATUS[statusFa] ?? (/^[A-Z_]+$/.test(statusFa) ? statusFa : 'ACTIVE');
      const gender = GENDER[genderFa ?? ''] ?? (/^(MALE|FEMALE)$/i.test(genderFa ?? '') ? (genderFa as string).toUpperCase() : null);
      rows.push({
        nationalCode: nc, firstName: first, lastName: last, studentCode: code,
        entryYear: entryYear ?? 1400, entryTerm: entryTerm ?? 1, majorName, majorCode: majorCode || null,
        degreeName: degreeName || null, degreeCode: degreeCode || null, status,
        birthCertNo: birthCertNo || null, birthCertSeries: birthCertSeries || null,
        placeOfBirth: placeOfBirth || null, placeOfIssue: placeOfIssue || null,
        birthDate: birthDate ?? null, fatherName: fatherName || null, gender, address: address || null,
        photoFile: photoFile || null,
      });
    }

    if (entity === 'faculty' || entity === 'department' || entity === 'major' || entity === 'professor') {
      const parser = entity === 'faculty' ? parseFacultyRow
        : entity === 'department' ? parseDepartmentRow
        : entity === 'major' ? parseMajorRow
        : parseProfessorRow;
      const res = parser(get);
      res.warnings.forEach(warn);
      if (!res.ok) return err(res.error);
      rows.push({ ...res.row });
    }

    if (entity === 'course') {
      const res = parseCourseRow(get);
      res.warnings.forEach(warn);
      if (!res.ok) return err(res.error);
      rows.push({ ...res.row });
    }

    if (entity === 'term') {
      const code = get(['کد ترم', 'کدترم', 'term_code', 'code']);
      const title = get(['عنوان ترم', 'نام ترم', 'title']) || `ترم ${code}`;
      const isCurrent = boolFa(get(['ترم جاری', 'جاری', 'is_current']));
      if (!code || !/^\d{3,5}$/.test(code)) return err(`کد ترم نامعتبر: ${code}`);
      rows.push({ termCode: code, title, isCurrent });
    }

    if (entity === 'enrollment') {
      const sc = codeOf(get(['شماره دانشجویی', 'student_code']));
      const cc = codeOf(get(['کد درس', 'course_code']));
      const tc = codeOf(get(['کد ترم', 'term_code']));
      const grade = num(get(['نمره', 'grade', 'نمره نهایی']));
      const gsRaw = get(['وضعیت نمره', 'grade_status']) || 'قطعی';
      if (!sc || !cc || !tc) return err('شماره دانشجویی، کد درس و کد ترم الزامی است.');
      if (grade != null && (grade < 0 || grade > 20)) return err(`نمره خارج از بازه: ${grade}`);
      rows.push({ studentCode: sc, courseCode: cc, termCode: tc, gradeValue: grade, gradeStatus: computeGradeStatus(grade) });
    }

    if (entity === 'ledger') {
      const sc = get(['شماره دانشجویی', 'student_code']);
      const tc = get(['کد ترم', 'term_code']);
      const ttRaw = get(['نوع', 'نوع تراکنش', 'type']);
      const amount = num(get(['مبلغ', 'amount']));
      const desc = get(['شرح', 'توضیحات', 'description']) || 'مهاجرت از سیستم قدیمی';
      const dt = dateFa(get(['تاریخ', 'تاریخ تراکنش', 'date']));
      const tt = TX_TYPE[ttRaw] ?? (/^[A-Z]+$/.test(ttRaw) ? ttRaw : null);
      if (!sc) return err('شماره دانشجویی الزامی است.');
      if (!tt) return err(`نوع تراکنش نامعتبر: «${ttRaw}» (بدهی/پرداخت)`);
      if (amount == null || amount <= 0) return err(`مبلغ نامعتبر: ${get(['مبلغ', 'amount'])}`);
      rows.push({ studentCode: sc, termCode: tc, transactionType: tt, amount: Math.round(amount), description: desc, createdAt: dt ?? new Date() });
    }

    if (entity === 'clearance') {
      const sc = get(['شماره دانشجویی', 'student_code']);
      const tc = get(['کد ترم', 'term_code']);
      const cleared = boolFa(get(['تسویه', 'وضعیت تسویه', 'cleared']));
      if (!sc || !tc) return err('شماره دانشجویی و کد ترم الزامی است.');
      rows.push({ studentCode: sc, termCode: tc, isCleared: cleared });
    }

    if (entity === 'curriculum') {
      // ⚠️ کدها با codeOf خوانده می‌شوند: اکسلِ خروجی پایتون عدد را «84.0» می‌دهد
      //    و بدون این، رشته/مقطع/درسِ موجود هم «یافت نشد» می‌شد.
      const majorCode = codeOf(get(['کد رشته', 'کدرشته', 'major_code']));
      const majorName = get(['نام رشته', 'رشته', 'major', 'major_name']);
      const degreeCode = codeOf(get(['کد مقطع', 'کد مقطع تحصیلی', 'degree_code', 'degree_level_code']));
      const degreeName = get(['مقطع', 'مقطع تحصیلی', 'degree', 'degree_level']);
      const courseCode = codeOf(get(['کد درس', 'کددرس', 'course_code']));
      const courseTitle = get(['نام درس', 'عنوان درس', 'نام', 'course_title', 'title']);
      const entryFromRaw = get(['از ورودی', 'ازورودی', 'ورودی از', 'entry_from', 'entryYearFrom', 'entry_year_from']);
      const entryToRaw = get(['تا ورودی', 'تاورودی', 'ورودی تا', 'entry_to', 'entryYearTo', 'entry_year_to']);
      const entryFrom = num(entryFromRaw);
      const entryTo = num(entryToRaw);
      if (entryFromRaw && (entryFrom == null || entryFrom < 1300 || entryFrom > 1500)) return err(`«از ورودی» نامعتبر: ${entryFromRaw} (۱۳۰۰..۱۵۰۰)`);
      if (entryToRaw && (entryTo == null || entryTo < 1300 || entryTo > 1500)) return err(`«تا ورودی» نامعتبر: ${entryToRaw} (۱۳۰۰..۱۵۰۰)`);
      if (entryFrom != null && entryTo != null && entryTo < entryFrom) return err(`«تا ورودی» (${entryTo}) کوچک‌تر از «از ورودی» (${entryFrom}) است.`);
      // ⛔ ستون «واحد» عمداً خوانده نمی‌شود: واحدِ هر درس فقط از بانک دروس می‌آید.
      //    (اگر در فایل عددی خلاف بانک نوشته شود، نباید در چارت بنشیند.)
      const semRaw = num(get(['ترم پیشنهادی', 'ترم', 'ترم تحصیلی', 'semester', 'recommended_semester']));
      const roleRaw = String(get(['نقش', 'نوع درس در چارت', 'نقش درس', 'role', 'role_type']) || '').trim();
      const isReqRaw = get(['الزامی', 'درس الزامی', 'is_required', 'required']);
      if (!majorCode && !majorName) return err('کد یا نام رشته الزامی است.');
      if (!courseCode) return err('کد درس الزامی است.');
      const sem = semRaw != null && semRaw >= 1 && semRaw <= 9 ? semRaw : null;
      if (semRaw != null && sem == null) warn(`ترم پیشنهادی «${semRaw}» خارج از بازهٔ ۱..۹ است — خالی گذاشته می‌شود.`);
      // نگاشت فارسی/انگلیسی نقش به کد استاندارد چارت
      // ⚠️ «اصلی» و «تخصصی» دو نوعِ جدا هستند (در بانک دروس هم جدا تعریف شده‌اند)
      const ROLE_MAP: Record<string, string> = {
        'پایه': 'CORE', 'core': 'CORE',
        'اصلی': 'MAJOR', 'major': 'MAJOR',
        'تخصصی': 'SPECIALIZED', 'specialized': 'SPECIALIZED',
        'اختیاری': 'ELECTIVE', 'انتخابی': 'ELECTIVE', 'elective': 'ELECTIVE',
        'عمومی': 'GENERAL', 'مشترک': 'GENERAL', 'general': 'GENERAL',
        'پایان‌نامه': 'THESIS', 'thesis': 'THESIS', 'کارآموزی': 'INTERNSHIP', 'کارورزی': 'INTERNSHIP', 'internship': 'INTERNSHIP',
        'کارگاه': 'WORKSHOP', 'workshop': 'WORKSHOP', 'جبرانی': 'COMPENSATORY', 'compensatory': 'COMPENSATORY',
      };
      const ROLE_CODES = ['CORE', 'MAJOR', 'SPECIALIZED', 'ELECTIVE', 'GENERAL', 'THESIS', 'INTERNSHIP', 'WORKSHOP', 'COMPENSATORY'];
      // ستون نقش خالی ⇒ null (نه CORE): نوع درس از بانک دروس خوانده می‌شود
      const role = roleRaw
        ? (ROLE_MAP[roleRaw] ?? ROLE_MAP[norm(roleRaw)] ?? (ROLE_CODES.includes(roleRaw.toUpperCase()) ? roleRaw.toUpperCase() : 'CORE'))
        : null;
      if (roleRaw && !ROLE_MAP[roleRaw] && !ROLE_MAP[norm(roleRaw)] && !ROLE_CODES.includes(roleRaw.toUpperCase()))
        warn(`نقش درس «${roleRaw}» شناخته نشد — از نوع درس در بانک خوانده می‌شود.`);
      const isRequired = isReqRaw == null || isReqRaw === '' ? true : boolFa(isReqRaw);
      rows.push({
        majorCode: majorCode || null, majorName: majorName || null,
        degreeCode: degreeCode || null, degreeName: degreeName || null,
        entryYearFrom: entryFrom ?? null, entryYearTo: entryTo ?? null,
        courseCode, courseTitle: courseTitle || null, units: null, recommendedSemester: sem, roleType: role, isRequired,
      });
    }
  });

  report.invalid = report.errors.length;
  report.sample = rows.slice(0, 5);
  return { report, rows, rowNumbers: rows.map((_, i) => i) };
}

// ── مرحلهٔ ۳: dry-run — شبیه‌سازی بدون نوشتن ──
export async function dryRun(entity: Entity, tables: Table[], fileName: string, universityId?: number | null): Promise<Report> {
  const { report, rows } = prepare(entity, tables, fileName);
  const codes = rows.map(r => String(r.studentCode ?? ''));

  if (entity === 'student') {
    const exUsers = await db.select({ c: users.nationalCode }).from(users).where(inArray(users.nationalCode, rows.map(r => String(r.nationalCode))));
    const exStudents = await db.select({ c: students.studentCode }).from(students).where(inArray(students.studentCode, codes));
    const u = new Set(exUsers.map(x => x.c)); const s = new Set(exStudents.map(x => x.c));
    for (const r of rows) {
      const dup = u.has(String(r.nationalCode)) || s.has(String(r.studentCode));
      if (dup) { report.existing++; report.warnings.push({ row: 0, msg: `${r.studentCode} از قبل موجود است — نادیده گرفته می‌شود.` }); }
      else report.willInsert++;
    }
  }
  if (entity === 'faculty') {
    const ex = await db.select({ id: faculties.id, name: faculties.name, code: faculties.facultyCode }).from(faculties);
    for (const r of rows) {
      const hit = ex.find(f => (r.code && norm(f.code ?? '') === norm(String(r.code))) || norm(f.name) === norm(String(r.name)));
      hit ? report.existing++ : report.willInsert++;
    }
  }
  if (entity === 'department') {
    const ex = await db.select({ id: departments.id, name: departments.name, code: departments.departmentCode }).from(departments);
    for (const r of rows) {
      const hit = ex.find(d => (r.code && norm(d.code ?? '') === norm(String(r.code))) || norm(d.name) === norm(String(r.name)));
      hit ? report.existing++ : report.willInsert++;
    }
  }
  if (entity === 'major') {
    const ex = new Set((await db.select({ c: majors.majorCode }).from(majors)).map(x => norm(x.c ?? '')));
    for (const r of rows) ex.has(norm(String(r.code))) ? report.existing++ : report.willInsert++;
  }
  if (entity === 'professor') {
    const ex = new Set((await db.select({ c: staff.staffCode }).from(staff)).map(x => norm(x.c)));
    for (const r of rows) ex.has(norm(String(r.staffCode))) ? report.existing++ : report.willInsert++;
  }
  if (entity === 'course') {
    const ex = new Set((await db.select({ c: courses.code }).from(courses).where(inArray(courses.code, rows.map(r => String(r.code))))).map(x => x.c));
    for (const r of rows) ex.has(String(r.code)) ? report.existing++ : report.willInsert++;
  }
  if (entity === 'term') {
    const ex = new Set((await db.select({ c: academic_terms.termCode }).from(academic_terms).where(inArray(academic_terms.termCode, rows.map(r => String(r.termCode))))).map(x => x.c));
    for (const r of rows) ex.has(String(r.termCode)) ? report.existing++ : report.willInsert++;
  }
  if (entity === 'enrollment' || entity === 'ledger' || entity === 'clearance') {
    const known = new Set((await db.select({ c: students.studentCode }).from(students).where(inArray(students.studentCode, codes))).map(x => x.c));
    for (const r of rows) {
      if (!known.has(String(r.studentCode))) { report.invalid++; report.errors.push({ row: 0, msg: `دانشجو ${r.studentCode} در سامانه نیست — اول فایل دانشجویان را مهاجرت کنید.` }); }
      else report.willInsert++;
    }
  }
  if (entity === 'curriculum') {
    const majorRows = await db.select({ id: majors.id, code: majors.majorCode, name: majors.name, degreeLevelId: majors.degreeLevelId }).from(majors)
      // 🔒 اگر دانشگاه مقصد انتخاب شده، فقط رشته‌های همان دانشگاه بررسی می‌شوند
      .where(universityId ? eq(majors.universityId, universityId) : undefined);
    const courseRows = await db.select({ id: courses.id, code: courses.code }).from(courses)
      .where(inArray(courses.code, [...new Set(rows.map(r => String(r.courseCode)))]));
    const courseSet = new Set(courseRows.map(c => c.code));
    const majorSeen = new Map<string, number>(); // major|degree|entryFrom-entryTo → count
    for (const r of rows) {
      const mCode = norm(String(r.majorCode ?? ''));
      const mName = norm(String(r.majorName ?? ''));
      const major = (mCode ? majorRows.find(m => norm(m.code ?? '') === mCode) : null)
        ?? majorRows.find(m => norm(m.name) === mName);
      if (!major) { report.invalid++; report.errors.push({ row: 0, msg: `رشته «${r.majorCode || r.majorName}» در سامانه نیست — اول فایل رشته‌ها را مهاجرت کنید.` }); continue; }
      if (!courseSet.has(String(r.courseCode))) { report.invalid++; report.errors.push({ row: 0, msg: `درس ${r.courseCode} در سامانه نیست — اول فایل دروس را مهاجرت کنید.` }); continue; }
      report.willInsert++;
      const ef = (r as Record<string, unknown>).entryYearFrom as number | null;
      const et = (r as Record<string, unknown>).entryYearTo as number | null;
      const key = `${major.id}|${major.degreeLevelId}|${ef ?? 'null'}|${et ?? 'null'}`;
      if (!majorSeen.has(key)) majorSeen.set(key, 0);
      majorSeen.set(key, (majorSeen.get(key) ?? 0) + 1);
    }
    if (majorSeen.size) report.warnings.push({ row: 0, msg: `${majorSeen.size} نسخهٔ چارت (به ازای هر رشته/مقطع/بازهٔ ورودی) ایجاد یا به‌روزرسانی می‌شود.` });
  }
  report.errors = report.errors.slice(0, 50);
  report.warnings = report.warnings.slice(0, 50);
  return report;
}

// ── مرحلهٔ ۴: commit — درج تراکنشی idempotent + تاریخچه ──
export async function commit(
  userId: number, entity: Entity, tables: Table[], fileName: string,
  sourceCode = 'LEGACY',
  /** جایگزینی کد قدیمی با «کد جدید»ِ تأییدشده در میز تطبیق کدها (پیش‌فرض: روشن) */
  rewriteCodes = true,
  /**
   * دانشگاه مقصد. در سامانهٔ چنددانشگاهی، کاربر پیش از انتقال انتخاب می‌کند؛
   * رکوردهای ساخته‌شده به همین دانشگاه می‌چسبند و تطبیق رشته هم فقط داخل
   * همین دانشگاه انجام می‌شود تا کد مشترکِ دو دانشگاه، رشتهٔ اشتباه را نگیرد.
   */
  universityId: number | null = null,
): Promise<Report> {
  const { report, rows } = prepare(entity, tables, fileName);
  let inserted = 0; let existing = 0;

  // ── سامانهٔ جایگزینی کد: هر دامنه فقط یک بار از دیتابیس خوانده می‌شود ──
  const rewriter = async (domain: MapDomain): Promise<CodeRewriter> =>
    rewriteCodes ? codeRewriterFor(sourceCode, domain) : noopRewriter();

  /** گزارش شفافِ «چه کدی با چه کدی جایگزین شد» — بدون آن، تغییر کد نامرئی می‌ماند */
  const reportRewrites = (rw: CodeRewriter, label: string) => {
    const used = rw.used();
    if (!used.length) return;
    const preview = used.slice(0, 10).map(u => `${u.from} → ${u.to}`).join('، ');
    report.warnings.push({
      row: 0,
      msg: `🔁 جایگزینی کد ${label}: ${used.length} کد قدیمی با کد جدیدِ تأییدشده ثبت شد (${preview}${used.length > 10 ? ' …' : ''}).`,
    });
  };

  if (entity === 'student') {
    const majorRows = await db.select().from(majors);
    const degreeRows = await db.select().from(degree_level_configs);
    const regRows = await db.select().from(educational_regulations);
    const majorMap = await resolverFor(sourceCode, 'MAJOR');       // میز تطبیق کدها
    const degreeMap = await resolverFor(sourceCode, 'DEGREE');     // میز تطبیق مقطع
    const statusMap = await resolverFor(sourceCode, 'STUDENT_STATUS');
    for (const r of rows) {
      const mKey = norm(String(r.majorName ?? ''));
      const mCode = norm(String(r.majorCode ?? ''));
      // ── حل مقطع: کد مقطع مقدم بر عنوان مقطع ──
      const dCode = norm(String(r.degreeCode ?? ''));
      const dKey = norm(String(r.degreeName ?? ''));
      let degree: (typeof degreeRows)[number] | null = null;
      if (dCode) {
        degree = degreeRows.find(d => norm(d.code) === dCode)
          ?? (degreeMap.get(dCode)?.id ? degreeRows.find(d => d.id === degreeMap.get(dCode)!.id) : null)
          ?? null;
        if (!degree) report.warnings.push({ row: 0, msg: `کد مقطع «${r.degreeCode}» شناخته نشد — در میز «تطبیق کدها» دامنهٔ «مقطع تحصیلی» را کامل کنید.` });
      }
      if (!degree && dKey) {
        degree = (degreeMap.get(dKey)?.id ? degreeRows.find(d => d.id === degreeMap.get(dKey)!.id) : null)
          ?? degreeRows.find(d => norm(d.title) === dKey)
          ?? degreeRows.find(d => norm(d.code) === dKey)
          ?? null;
        if (!degree) report.warnings.push({ row: 0, msg: `مقطع «${r.degreeName}» تطبیق نخورد — رشته/آیین‌نامه بدون مقطع انتخاب می‌شود.` });
      }
      const degId = degree?.id ?? null;

      // ── تطبیق رشته: «کد رشته» قطعی است و بر نام مقدم ──
      //    نام فقط وقتی به کار می‌آید که کد نیامده باشد، و آن هم مقیدِ مقطع.
      const sameDegree = (m: (typeof majorRows)[number]) => degId == null || m.degreeLevelId === degId;
      let major: (typeof majorRows)[number] | null = null;
      if (mCode) {
        major = majorRows.find(m => norm(m.majorCode ?? '') === mCode) ?? null;
        // میز تطبیق کدها: کد قدیمی → رشتهٔ جدید
        if (!major) {
          const byMap = majorMap.get(mCode);
          if (byMap?.id) major = majorRows.find(m => m.id === byMap.id) ?? null;
        }
        if (!major) report.warnings.push({ row: 0, msg: `کد رشتهٔ «${r.majorCode}»${r.majorName ? ` («${r.majorName}»)` : ''} در سامانه نیست — رشته‌ها را وارد کنید یا در میز «تطبیق کدها» دامنهٔ «رشته» را کامل کنید.` });
        else if (degId != null && major.degreeLevelId !== degId) {
          // کد و مقطعِ فایل با هم نمی‌خوانند؛ کد را معتبر می‌گیریم ولی صدایش می‌زنیم
          report.warnings.push({ row: 0, msg: `کد رشتهٔ «${r.majorCode}» در سامانه مقطع دیگری دارد؛ کد ملاک قرار گرفت و مقطع فایل («${r.degreeName}») نادیده شد.` });
        }
      }
      if (!major && mKey) {
        const mapped = majorMap.get(mKey);
        const byName = majorRows.filter(m => norm(m.name) === mKey && sameDegree(m));
        major = (mapped?.id ? majorRows.find(m => m.id === mapped.id) : null)
          ?? (byName.length === 1 ? byName[0] : null)
          ?? null;
        if (!major && byName.length > 1) {
          report.errors.push({ row: 0, msg: `«${r.majorName}» به چند رشته می‌خورد و «کد رشته» در فایل نیست — تطبیق قطعی ممکن نیست؛ ستون «کد رشته» را به فایل دانشجو اضافه کنید.` });
        } else if (!major) {
          report.warnings.push({ row: 0, msg: `رشتهٔ «${r.majorName}»${degId ? ` (مقطع ${r.degreeName})` : ''} تطبیق نخورد — بدون رشته ثبت شد (میز تطبیق کدها).` });
        }
      }

      // ── آیین‌نامه: متناسب با مقطع و سال ورود (بدون مقدار سخت‌کد) ──
      const entryYr = Number(r.entryYear);
      const regForDegree = regRows
        .filter(g => (degId == null ? true : g.degreeLevelId === degId))
        .filter(g => g.effectiveFromYear <= entryYr && (g.effectiveToYear == null || g.effectiveToYear >= entryYr));
      const reg = regForDegree[0]
        ?? regRows.filter(g => degId == null ? true : g.degreeLevelId === degId)[0]
        ?? regRows[0]
        ?? null;
      if (!reg) { report.errors.push({ row: 0, msg: `آیین‌نامه‌ای برای مقطع «${r.degreeName ?? 'نامعلوم'}» یافت نشد — ابتدا مقاطع و آیین‌نامه‌ها را تعریف کنید.` }); continue; }

      const mappedStatus = statusMap.get(norm(String(r.status)))?.code;
      if (mappedStatus) r.status = mappedStatus;
      // 🔐 رمز یکبارمصرف تصادفی برای حساب تازه — دیگر از کد ملی مشتق نمی‌شود
      const oneTimePassword = randomOneTimePassword();
      const res = await db.transaction(async tx => {
        let userCreated = false;
        let [u] = await tx.insert(users).values({
          nationalCode: String(r.nationalCode), firstName: String(r.firstName), lastName: String(r.lastName),
          birthCertNo: r.birthCertNo as string | null, birthCertSeries: r.birthCertSeries as string | null,
          placeOfBirth: r.placeOfBirth as string | null, placeOfIssue: r.placeOfIssue as string | null,
          birthDate: (r.birthDate as Date | null) ?? null, fatherName: r.fatherName as string | null,
          gender: r.gender as string | null, address: r.address as string | null,
          photoFileName: (r.photoFile as string | null) ?? null,   // ZIP عکس‌ها بعداً با همین نام وصل می‌شود
          passwordHash: hashDefault(oneTimePassword),   // رمز یکبارمصرف تصادفی (نه کد ملی)
          mustChangePassword: 1,                        // اولین ورود → تغییر اجباری رمز
        }).onConflictDoNothing().returning({ id: users.id });
        if (!u) {
          [u] = await tx.select({ id: users.id }).from(users).where(eq(users.nationalCode, String(r.nationalCode))).limit(1);
          if (r.photoFile) {
            await tx.update(users).set({ photoFileName: String(r.photoFile) })
              .where(and(eq(users.id, u.id), isNull(users.photoFileName)));
          }
          const [exSt] = await tx.select({ id: students.id }).from(students).where(eq(students.studentCode, String(r.studentCode))).limit(1);
          if (exSt) return { studentInserted: false, userCreated: false }; // موجود
        } else {
          userCreated = true;
        }
        const [st] = await tx.insert(students).values({
          userId: u.id, studentCode: String(r.studentCode), majorId: major?.id ?? null,
          degreeLevelId: reg.degreeLevelId, regulationId: reg.id, entryYear: entryYr, entryTerm: Number(r.entryTerm) ?? 1, status: String(r.status),
          ...(universityId ? { universityId } : {}),
        }).onConflictDoNothing().returning({ id: students.id });
        return { studentInserted: !!st, userCreated };
      });
      if (res.studentInserted) {
        inserted++;
        // 📣 رمز یکبارمصرف از همان کانال گزارش مهاجرت (هشدارهای گزارش) یک‌بار به مدیر نشان داده می‌شود
        if (res.userCreated) report.warnings.push({ row: 0, msg: `🔐 رمز یکبارمصرف دانشجو ${r.studentCode} (کد ملی ${r.nationalCode}): ${oneTimePassword} — در اولین ورود تغییر اجباری است.` });
      } else existing++;
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  دادهٔ پایهٔ سازمانی: دانشکده → گروه → رشته/گرایش → استاد
  //  (ترتیب واردکردن هم باید همین باشد؛ هر لایه به لایهٔ قبل تکیه دارد)
  // ══════════════════════════════════════════════════════════════

  /**
   * دانشکده را پیدا یا (در صورت نبود) می‌سازد.
   *
   * ترتیب تطبیق عمدی است: **اول کد، بعد نام**. کد سند اصالت است و یکتاست؛
   * نام ممکن است در دو سازمان/دو مقطع تکرار شود. اگر فقط با نام تطبیق بخورد
   * هشدار می‌دهیم تا در گزارش انتقال دیده شود.
   */
  async function ensureFaculty(name: string | null, code: string | null, auto: boolean): Promise<number | null> {
    const cKey = norm(String(code ?? ''));
    const nKey = norm(String(name ?? ''));
    if (!cKey && !nKey) return null;
    const all = await db.select({ id: faculties.id, name: faculties.name, code: faculties.facultyCode }).from(faculties);

    if (cKey) {
      const byCode = all.find(f => norm(f.code ?? '') === cKey);
      if (byCode) return byCode.id;
    }
    if (nKey) {
      const byName = all.filter(f => norm(f.name) === nKey);
      if (byName.length > 1) {
        report.errors.push({ row: 0, msg: `چند دانشکده به نام «${name}» هست و «کد دانشکده» در فایل نیامده — تطبیق قطعی ممکن نیست؛ ستون «کد دانشکده» را به فایل اضافه کنید.` });
        return null;
      }
      if (byName.length === 1) {
        // کد را همین‌جا تکمیل کن تا دفعهٔ بعد تطبیق قطعی باشد
        if (cKey && !byName[0].code) await db.update(faculties).set({ facultyCode: String(code) }).where(eq(faculties.id, byName[0].id));
        else if (!cKey) report.warnings.push({ row: 0, msg: `دانشکدهٔ «${name}» فقط با نام تطبیق خورد (کد در فایل نبود).` });
        return byName[0].id;
      }
    }
    if (!auto) return null;
    const [nf] = await db.insert(faculties).values({ name: String(name ?? code), facultyCode: code ? String(code) : null }).returning({ id: faculties.id });
    report.warnings.push({ row: 0, msg: `دانشکدهٔ «${name ?? code}»${code ? ` (کد ${code})` : ' بدون کد'} در سامانه نبود — خودکار ساخته شد.` });
    return nf.id;
  }

  /**
   * گروه آموزشی را پیدا یا می‌سازد.
   *
   * ⚠️ تطبیق نام **حتماً درون همان دانشکده** انجام می‌شود. پیش‌تر نام در کل
   * سامانه جستجو می‌شد و «مهندسی کامپیوتر»ِ دانشکدهٔ فنی با «مهندسی کامپیوتر»ِ
   * دانشکدهٔ علوم یکی گرفته می‌شد — همان اشتباهی که کد قرار است جلویش را بگیرد.
   */
  async function ensureDepartment(name: string | null, code: string | null, facultyId: number | null, auto: boolean): Promise<number | null> {
    const cKey = norm(String(code ?? ''));
    const nKey = norm(String(name ?? ''));
    if (!cKey && !nKey) return null;
    const all = await db.select({ id: departments.id, name: departments.name, code: departments.departmentCode, facultyId: departments.facultyId }).from(departments);

    if (cKey) {
      const byCode = all.find(d => norm(d.code ?? '') === cKey);
      if (byCode) return byCode.id;
    }
    if (nKey) {
      // فقط درون دانشکدهٔ داده‌شده؛ اگر دانشکده معلوم نیست، کل سامانه ولی با
      // شرط یکتا بودن نام — وگرنه ابهام است و باید کد بیاید.
      const pool = facultyId != null ? all.filter(d => d.facultyId === facultyId) : all;
      const byName = pool.filter(d => norm(d.name) === nKey);
      if (byName.length > 1) {
        report.errors.push({ row: 0, msg: `چند گروه به نام «${name}»${facultyId != null ? ' در این دانشکده' : ''} هست و «کد گروه» در فایل نیامده — تطبیق قطعی ممکن نیست؛ ستون «کد گروه آموزشی» را اضافه کنید.` });
        return null;
      }
      if (byName.length === 1) {
        if (cKey && !byName[0].code) await db.update(departments).set({ departmentCode: String(code) }).where(eq(departments.id, byName[0].id));
        else if (!cKey) report.warnings.push({ row: 0, msg: `گروه «${name}» فقط با نام تطبیق خورد (کد در فایل نبود).` });
        return byName[0].id;
      }
    }
    if (!auto) return null;
    const fid = facultyId ?? (await db.select({ id: faculties.id }).from(faculties).limit(1))[0]?.id;
    if (!fid) { report.errors.push({ row: 0, msg: `گروه «${name ?? code}» ساخته نشد — هیچ دانشکده‌ای تعریف نشده است؛ اول فایل دانشکده‌ها را وارد کنید.` }); return null; }
    const [nd] = await db.insert(departments).values({ name: String(name ?? code), facultyId: fid, departmentCode: code ? String(code) : null }).returning({ id: departments.id });
    report.warnings.push({ row: 0, msg: `گروه آموزشی «${name ?? code}»${code ? ` (کد ${code})` : ' بدون کد'} در سامانه نبود — خودکار ساخته شد.` });
    return nd.id;
  }

  if (entity === 'faculty') {
    for (const r of rows) {
      const all = await db.select({ id: faculties.id, name: faculties.name, code: faculties.facultyCode }).from(faculties);
      const k = norm(String(r.code ?? ''));
      const hit = (k ? all.find(f => norm(f.code ?? '') === k) : null) ?? all.find(f => norm(f.name) === norm(String(r.name)));
      if (hit) {
        existing++;
        if (r.code && !hit.code) await db.update(faculties).set({ facultyCode: String(r.code) }).where(eq(faculties.id, hit.id));
        continue;
      }
      await db.insert(faculties).values({ name: String(r.name), facultyCode: r.code ? String(r.code) : null });
      inserted++;
    }
  }

  if (entity === 'department') {
    for (const r of rows) {
      const facultyId = await ensureFaculty(r.facultyName as string | null, r.facultyCode as string | null, true);
      const all = await db.select({ id: departments.id, name: departments.name, code: departments.departmentCode }).from(departments);
      const k = norm(String(r.code ?? ''));
      const hit = (k ? all.find(d => norm(d.code ?? '') === k) : null) ?? all.find(d => norm(d.name) === norm(String(r.name)));
      if (hit) {
        existing++;
        const patch: Record<string, unknown> = {};
        if (r.code && !hit.code) patch.departmentCode = String(r.code);
        if (facultyId) patch.facultyId = facultyId;
        if (Object.keys(patch).length) await db.update(departments).set(patch).where(eq(departments.id, hit.id));
        continue;
      }
      const fid = facultyId ?? (await db.select({ id: faculties.id }).from(faculties).limit(1))[0]?.id;
      if (!fid) { report.errors.push({ row: 0, msg: `گروه «${r.name}» ساخته نشد — هیچ دانشکده‌ای تعریف نشده است.` }); continue; }
      await db.insert(departments).values({ name: String(r.name), facultyId: fid, departmentCode: r.code ? String(r.code) : null });
      inserted++;
    }
  }

  if (entity === 'major') {
    const rw = await rewriter('MAJOR');
    const degreeMap = await resolverFor(sourceCode, 'DEGREE');
    const degreeRows = await db.select({ id: degree_level_configs.id, code: degree_level_configs.code, title: degree_level_configs.title }).from(degree_level_configs);
    const warnedOnce = new Set<string>();
    let tracksMade = 0;

    for (const r of rows) {
      // ── مقطع: بدون آن رشته قابل ثبت نیست (ستون NOT NULL) ──
      const dk = norm(String(r.degreeName ?? ''));
      const mapped = degreeMap.get(dk)?.id;
      const degree = (mapped ? degreeRows.find(d => d.id === mapped) : null)
        ?? degreeRows.find(d => norm(d.title) === dk)
        ?? degreeRows.find(d => norm(d.code) === dk);
      if (!degree) {
        report.errors.push({ row: 0, msg: `رشتهٔ «${r.name}» (${r.code}) ثبت نشد — مقطع «${r.degreeName ?? 'خالی'}» شناخته نشد؛ در میز «تطبیق کدها» دامنهٔ «مقطع تحصیلی» را کامل کنید.` });
        continue;
      }

      const facultyId = await ensureFaculty(r.facultyName as string | null, r.facultyCode as string | null, true);
      const departmentId = await ensureDepartment(r.departmentName as string | null, r.departmentCode as string | null, facultyId, true);

      const finalCode = rw.apply(String(r.code));
      if (finalCode !== String(r.code) && !warnedOnce.has('C:' + r.code)) {
        warnedOnce.add('C:' + r.code);
      }

      const values = {
        name: String(r.name), degreeLevelId: degree.id, departmentId, facultyId,
        majorCode: finalCode,
        universityId: universityId ?? null,
        minUnits: (r.minUnits as number | null) ?? null,
        standardCode: (r.standardCode as string | null) ?? null,
        establishedDate: (r.establishedDate as string | null) ?? null,
        terminatedDate: (r.terminatedDate as string | null) ?? null,
        isActive: r.isActive ? 1 : 0,
        headStaffCode: (r.headStaffCode as string | null) ?? null,
        headName: (r.headName as string | null) ?? null,
        expertName: (r.expertName as string | null) ?? null,
        lastCouncilDate: (r.lastCouncilDate as string | null) ?? null,
      };

      const ins = await db.insert(majors).values(values).onConflictDoNothing({ target: majors.majorCode }).returning({ id: majors.id });
      let majorId = ins[0]?.id ?? null;
      if (majorId) inserted++;
      else {
        existing++;
        const [cur] = await db.select().from(majors).where(eq(majors.majorCode, finalCode)).limit(1);
        if (!cur) continue;
        majorId = cur.id;
        // تکمیل فیلدهای خالیِ رشتهٔ موجود (بدون بازنویسی دادهٔ پرشده)
        const patch: Record<string, unknown> = {};
        if (cur.universityId == null && universityId != null) patch.universityId = universityId;
        if (cur.departmentId == null && departmentId != null) patch.departmentId = departmentId;
        if (cur.facultyId == null && facultyId != null) patch.facultyId = facultyId;
        if (cur.minUnits == null && values.minUnits != null) patch.minUnits = values.minUnits;
        if (!cur.standardCode && values.standardCode) patch.standardCode = values.standardCode;
        if (!cur.establishedDate && values.establishedDate) patch.establishedDate = values.establishedDate;
        if (!cur.terminatedDate && values.terminatedDate) patch.terminatedDate = values.terminatedDate;
        if (!cur.headStaffCode && values.headStaffCode) patch.headStaffCode = values.headStaffCode;
        if (!cur.headName && values.headName) patch.headName = values.headName;
        if (!cur.expertName && values.expertName) patch.expertName = values.expertName;
        if (!cur.lastCouncilDate && values.lastCouncilDate) patch.lastCouncilDate = values.lastCouncilDate;
        if (Object.keys(patch).length) await db.update(majors).set(patch).where(eq(majors.id, cur.id));
      }

      // ── گرایش: چند سطر با یک کد رشته و گرایش‌های مختلف مجاز است ──
      if (majorId && r.trackTitle) {
        const t = await db.insert(curriculum_tracks)
          .values({ majorId, title: String(r.trackTitle), code: (r.trackCode as string | null) ?? null })
          .onConflictDoNothing()
          .returning({ id: curriculum_tracks.id });
        if (t.length) tracksMade++;
      }
    }
    if (tracksMade) report.warnings.push({ row: 0, msg: `${tracksMade} گرایش جدید ذیل رشته‌ها ساخته شد.` });
    reportRewrites(rw, 'رشته');
  }

  if (entity === 'professor') {
    /**
     * فیلدهای هویتیِ استاد که در جدول users می‌نشینند (فایل قدیمی همان
     * ستون‌های فایل دانشجویان را دارد: نام پدر، شناسنامه، تولد، آدرس…).
     * تاریخ تولد شمسی است و باید به تاریخ میلادی تبدیل شود.
     */
    const identityOf = (r: Record<string, unknown>) => ({
      gender: (r.gender as string | null) ?? null,
      mobile: (r.mobile as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      photoFileName: (r.photoFile as string | null) ?? null,
      fatherName: (r.fatherName as string | null) ?? null,
      birthCertNo: (r.birthCertNo as string | null) ?? null,
      birthDate: dateFa(r.birthDate as string | null),
      placeOfBirth: (r.placeOfBirth as string | null) ?? null,
      placeOfIssue: (r.placeOfIssue as string | null) ?? null,
      address: (r.address as string | null) ?? null,
    });

    /** فقط خانه‌های خالیِ کاربر موجود پر می‌شود؛ دادهٔ ویرایش‌شده دست نمی‌خورد */
    const fillEmptyUser = async (userId: number, r: Record<string, unknown>) => {
      const [cur] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!cur) return;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(identityOf(r))) {
        if (v == null || v === '') continue;
        const curVal = (cur as Record<string, unknown>)[k];
        if (curVal == null || curVal === '') patch[k] = v;
      }
      if (Object.keys(patch).length) await db.update(users).set(patch).where(eq(users.id, userId));
    };

    for (const r of rows) {
      const facultyId = await ensureFaculty(r.facultyName as string | null, r.facultyCode as string | null, true);
      const departmentId = await ensureDepartment(r.departmentName as string | null, r.departmentCode as string | null, facultyId, true);
      const staffCode = String(r.staffCode);

      const [dup] = await db.select({ id: staff.id }).from(staff).where(eq(staff.staffCode, staffCode)).limit(1);
      const staffFields = {
        departmentId, facultyId,
        staffType: 'PROFESSOR',
        academicRank: (r.academicRank as string | null) ?? null,
        degree: (r.degree as string | null) ?? null,
        title: (r.title as string | null) ?? null,
        isActive: r.isActive ? 1 : 0,
        cooperationType: (r.cooperationType as string | null) ?? null,
        personnelNo: (r.personnelNo as string | null) ?? null,
        employmentType: (r.employmentType as string | null) ?? null,
        hireDate: (r.hireDate as string | null) ?? null,
        lastDegreeYear: (r.lastDegreeYear as number | null) ?? null,
        fieldOfStudy: (r.fieldOfStudy as string | null) ?? null,
        fieldMain: (r.fieldMain as string | null) ?? null,
        maritalStatus: (r.maritalStatus as string | null) ?? null,
        maritalStatusCode: (r.maritalStatusCode as number | null) ?? null,
        lastDegreeCountryCode: (r.lastDegreeCountryCode as string | null) ?? null,
        lastDegreeUniversity: (r.lastDegreeUniversity as string | null) ?? null,
        academicBase: (r.academicBase as string | null) ?? null,
        birthProvince: (r.birthProvince as string | null) ?? null,
        birthCity: (r.birthCity as string | null) ?? null,
        bankAccountNo: (r.bankAccountNo as string | null) ?? null,
        phone: (r.phone as string | null) ?? null,
      };

      if (dup) {
        existing++;
        // فقط فیلدهای خالی تکمیل می‌شوند (دادهٔ ویرایش‌شدهٔ دستی حفظ می‌شود)
        const [cur] = await db.select().from(staff).where(eq(staff.id, dup.id)).limit(1);
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(staffFields)) {
          if (v == null || v === '') continue;
          const curVal = (cur as Record<string, unknown>)[k];
          if (curVal == null || curVal === '') patch[k] = v;
        }
        if (Object.keys(patch).length) await db.update(staff).set(patch).where(eq(staff.id, dup.id));
        continue;
      }

      // ── حساب کاربری: کلید هویتی، کد ملی است ──
      const nc = r.nationalCode as string | null;
      let userId: number | null = null;
      if (nc) {
        const [exU] = await db.select({ id: users.id }).from(users).where(eq(users.nationalCode, nc)).limit(1);
        if (exU) {
          const [alreadyStaff] = await db.select({ id: staff.id }).from(staff).where(eq(staff.userId, exU.id)).limit(1);
          if (alreadyStaff) {
            report.errors.push({ row: 0, msg: `کد ملی ${nc} از قبل به کد استادی دیگری وصل است — استاد ${staffCode} ثبت نشد (کد ملی تکراری در فایل؟).` });
            continue;
          }
          userId = exU.id;
          await fillEmptyUser(exU.id, r);
        } else {
          // 🔐 رمز یکبارمصرف تصادفی — دیگر از کد ملی مشتق نمی‌شود
          const oneTimePassword = randomOneTimePassword();
          const [nu] = await db.insert(users).values({
            nationalCode: nc, firstName: String(r.firstName), lastName: String(r.lastName),
            ...identityOf(r),
            passwordHash: hashDefault(oneTimePassword),
            mustChangePassword: 1,           // اولین ورود → تغییر اجباری رمز
          }).returning({ id: users.id });
          userId = nu.id;
          // 📣 رمز یکبارمصرف از همان کانال گزارش مهاجرت یک‌بار به مدیر نشان داده می‌شود
          report.warnings.push({ row: 0, msg: `🔐 رمز یکبارمصرف استاد ${staffCode} (کد ملی ${nc}): ${oneTimePassword} — در اولین ورود تغییر اجباری است.` });
        }
      } else {
        // بدون کد ملی: شناسهٔ جایگزینِ رزروشده تا ستون NOT NULL پر شود و
        // در عین حال هرگز با هویت واقعی کسی ادغام نشود.
        const placeholder = ('9' + staffCode.replace(/\D/g, '').padStart(9, '0')).slice(0, 10);
        const [clash] = await db.select({ id: users.id }).from(users).where(eq(users.nationalCode, placeholder)).limit(1);
        if (clash) {
          report.errors.push({ row: 0, msg: `استاد ${staffCode} بدون کد ملی است و شناسهٔ جایگزین «${placeholder}» قبلاً استفاده شده — کد ملی را در فایل کامل کنید.` });
          continue;
        }
        const [nu] = await db.insert(users).values({
          nationalCode: placeholder, firstName: String(r.firstName), lastName: String(r.lastName),
          ...identityOf(r),
          passwordHash: hashDefault(randomOneTimePassword()),   // ورود ناممکن تا اصلاح کد ملی
          mustChangePassword: 1,
        }).returning({ id: users.id });
        userId = nu.id;
      }

      if (userId == null) continue;
      await db.insert(staff).values({ userId, staffCode, ...staffFields }).onConflictDoNothing();

      // 🔑 نقش «استاد»: بدون آن، ورود موفق است ولی کاربر به /login?e=norole
      //    برمی‌گردد و اصلاً وارد کارتابل /professor نمی‌شود (homeFor در auth.ts).
      let [profRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, 'PROFESSOR')).limit(1);
      if (!profRole) {
        const created = await db.insert(roles)
          .values({ code: 'PROFESSOR', title: 'استاد', isSystem: 1 })
          .onConflictDoNothing({ target: roles.code })
          .returning({ id: roles.id });
        profRole = created[0]
          ?? (await db.select({ id: roles.id }).from(roles).where(eq(roles.code, 'PROFESSOR')).limit(1))[0];
      }
      if (profRole) {
        await db.insert(user_roles).values({ userId, roleId: profRole.id })
          .onConflictDoNothing({ target: [user_roles.userId, user_roles.roleId] })
          .catch(() => {});
        clearPermissionCache();
      }
      inserted++;
    }
  }

  if (entity === 'course') {
    const rw = await rewriter('COURSE');
    let enriched = 0;   // درس‌های موجود که فیلدهای خالی‌شان از این فایل کامل شد
    let prereqImported = 0, coreqImported = 0, equivImported = 0;   // قواعد خوانده‌شده از جدول دروس
    const warnedOnce = new Set<string>();   // هر مقطع/گروهِ تطبیق‌نخورده فقط یک بار هشدار بگیرد
    // ── حل «مقطع» و «گروه آموزشی» با همان سازوکار میز تطبیق کدها ──
    const degreeMap = await resolverFor(sourceCode, 'DEGREE');
    const deptMap = await resolverFor(sourceCode, 'DEPARTMENT');
    const typeMap = await resolverFor(sourceCode, 'COURSE_TYPE');
    const degreeRows = await db.select({ id: degree_level_configs.id, code: degree_level_configs.code, title: degree_level_configs.title }).from(degree_level_configs);
    const deptRows = await db.select({ id: departments.id, name: departments.name, code: departments.departmentCode }).from(departments);

    const resolveDegree = (name: string | null): number | null => {
      const k = norm(String(name ?? ''));
      if (!k) return null;
      const mapped = degreeMap.get(k)?.id;
      const hit = (mapped ? degreeRows.find(d => d.id === mapped) : null)
        ?? degreeRows.find(d => norm(d.title) === k)
        ?? degreeRows.find(d => norm(d.code) === k);
      if (!hit && !warnedOnce.has('D:' + k)) {
        warnedOnce.add('D:' + k);
        report.warnings.push({ row: 0, msg: `مقطع «${name}» تطبیق نخورد — درس‌های مربوطه بدون مقطع (مشترک) ثبت شدند؛ در میز «تطبیق کدها» دامنهٔ «مقطع تحصیلی» را کامل کنید.` });
      }
      return hit?.id ?? null;
    };
    /**
     * گروه آموزشی درس — **اول کد، بعد نام**. اگر نام به چند گروه بخورد (مثلاً
     * «مهندسی کامپیوتر» در دو دانشکده) بدون کد، تطبیق قطعی نیست و به‌جای
     * حدس‌زدن، درس بدون گروه می‌ماند و خطا گزارش می‌شود.
     */
    const resolveDept = (name: string | null, code: string | null): number | null => {
      const cKey = norm(String(code ?? ''));
      const nKey = norm(String(name ?? ''));
      if (cKey) {
        const byCode = deptRows.find(d => norm(d.code ?? '') === cKey)
          ?? (deptMap.get(cKey)?.id ? deptRows.find(d => d.id === deptMap.get(cKey)!.id) : null);
        if (byCode) return byCode.id;
        if (!warnedOnce.has('PC:' + cKey)) {
          warnedOnce.add('PC:' + cKey);
          report.warnings.push({ row: 0, msg: `کد گروه آموزشی «${code}» شناخته نشد — در میز «تطبیق کدها» دامنهٔ «گروه آموزشی» را کامل کنید.` });
        }
      }
      if (!nKey) return null;
      const mapped = deptMap.get(nKey)?.id;
      if (mapped) return deptRows.find(d => d.id === mapped)?.id ?? null;
      const byName = deptRows.filter(d => norm(d.name) === nKey);
      if (byName.length === 1) return byName[0].id;
      if (byName.length > 1) {
        if (!warnedOnce.has('PD:' + nKey)) {
          warnedOnce.add('PD:' + nKey);
          report.errors.push({ row: 0, msg: `«${name}» به چند گروه آموزشی می‌خورد و «کد گروه آموزشی» در فایل نیست — ستون کد را اضافه کنید تا درس به گروه درست بچسبد.` });
        }
        return null;
      }
      if (!warnedOnce.has('P:' + nKey)) {
        warnedOnce.add('P:' + nKey);
        report.warnings.push({ row: 0, msg: `گروه آموزشی «${name}» تطبیق نخورد — درس‌های مربوطه بدون گروه ثبت شدند؛ در میز «تطبیق کدها» دامنهٔ «گروه آموزشی» را کامل کنید.` });
      }
      return null;
    };

    for (const r of rows) {
      const degreeLevelId = resolveDegree((r.degreeCode as string | null) || (r.degreeName as string | null));
      const departmentId = resolveDept(r.deptName as string | null, r.deptCode as string | null);
      const rawType = r.courseType ? String(r.courseType) : null;
      const courseType = rawType ? (typeMap.get(norm(rawType))?.code ?? rawType) : null;

      // ── قواعد درس از «جدول دروس» ──
      // متن خام «پیش‌نیاز» نگه داشته می‌شود (ترجمه به course_rules در گام
      // همگام‌سازی انجام می‌شود، چون قواعد مقیّد به نسخهٔ برنامه‌اند) و
      // «هم‌نیاز / هم‌ارز» به فهرست کد نرمال‌شده تبدیل می‌شوند.
      const prereqText = r.prereqText ? String(r.prereqText).trim() : null;
      const prereqTree = parseRequisiteText(prereqText);
      const coreqTree = parseRequisiteText(r.coreqText as string | null);
      const equivCodes = parseEquivalentCodes(r.equivText as string | null, String(r.code));
      const coRequisites = coreqTree
        ? coreqTree.conditions.map(c => ('course' in c ? String(c.course) : '')).filter(Boolean).join(',').slice(0, 200)
        : null;
      const equivalentCourseCodes = equivCodes.length ? equivCodes.join(',').slice(0, 2000) : null;

      const values = {
        code: rw.apply(String(r.code)),   // 🔁 کد جدیدِ تأییدشده (اگر تعریف شده باشد)
        title: String(r.title), units: String(r.units),
        theoreticalUnits: String(r.theory), practicalUnits: String(r.practical),
        courseType, departmentId, degreeLevelId,
        ...(prereqText ? { prereqText } : {}),
        ...(coRequisites ? { coRequisites } : {}),
        ...(equivalentCourseCodes ? { equivalentCourseCodes } : {}),
      };
      const r0 = await db.insert(courses).values(values).onConflictDoNothing().returning({ id: courses.id });
      if (r0.length) {
        inserted++;
        if (prereqTree) prereqImported++;
        if (coreqTree) coreqImported++;
        if (equivalentCourseCodes) equivImported++;
        continue;
      }

      // درس از قبل هست: فقط جاهای خالی را پر می‌کنیم (دادهٔ دستیِ کاربر بازنویسی نمی‌شود).
      // بدون این گام، فایلِ کاملِ دوم هیچ اثری نداشت و «مقطع/گروه/واحد عملی» تا ابد خالی می‌ماند.
      existing++;
      const [cur] = await db
        .select({
          id: courses.id, theoreticalUnits: courses.theoreticalUnits, practicalUnits: courses.practicalUnits,
          courseType: courses.courseType, departmentId: courses.departmentId, degreeLevelId: courses.degreeLevelId,
          prereqText: courses.prereqText, coRequisites: courses.coRequisites, equivalentCourseCodes: courses.equivalentCourseCodes,
        })
        .from(courses).where(eq(courses.code, values.code)).limit(1);
      if (!cur) continue;

      const patch: Record<string, unknown> = {};
      if (Number(cur.theoreticalUnits ?? 0) === 0 && Number(values.theoreticalUnits) !== 0) patch.theoreticalUnits = values.theoreticalUnits;
      if (Number(cur.practicalUnits ?? 0) === 0 && Number(values.practicalUnits) !== 0) patch.practicalUnits = values.practicalUnits;
      if (!cur.courseType && values.courseType) patch.courseType = values.courseType;
      if (cur.departmentId == null && departmentId != null) patch.departmentId = departmentId;
      if (cur.degreeLevelId == null && degreeLevelId != null) patch.degreeLevelId = degreeLevelId;
      // سه ستون قواعد — فقط اگر در سامانه خالی باشند (دادهٔ دستی حفظ می‌شود)
      if (!cur.prereqText && prereqText) { patch.prereqText = prereqText; if (prereqTree) prereqImported++; }
      if (!cur.coRequisites && coRequisites) { patch.coRequisites = coRequisites; if (coreqTree) coreqImported++; }
      if (!cur.equivalentCourseCodes && equivalentCourseCodes) { patch.equivalentCourseCodes = equivalentCourseCodes; if (equivalentCourseCodes) equivImported++; }

      if (Object.keys(patch).length) {
        await db.update(courses).set(patch).where(eq(courses.id, cur.id));
        enriched++;
      }
    }
    if (enriched) {
      report.warnings.push({ row: 0, msg: `${enriched} درسِ موجود با اطلاعات این فایل کامل شد (مقطع/گروه/تفکیک واحد) — مقادیر پرشدهٔ قبلی دست نخورد.` });
    }
    // ── قواعد پیش‌نیاز/هم‌نیاز: از جدول دروس به course_rules نسخه‌ها ──
    if (prereqImported || coreqImported || equivImported) {
      report.warnings.push({
        row: 0,
        msg: `از جدول دروس خوانده شد: ${prereqImported} درس با پیش‌نیاز، ${coreqImported} با هم‌نیاز و ${equivImported} با دروس هم‌ارز.`,
      });
    }
    if (prereqImported || coreqImported) {
      try {
        const sync = await syncRequisiteRulesFromCourses();
        if (sync.prereqRules || sync.coreqRules) {
          report.warnings.push({
            row: 0,
            msg: `${sync.prereqRules} قاعدهٔ پیش‌نیاز و ${sync.coreqRules} قاعدهٔ هم‌نیاز از جدول دروس به چارت ${sync.versions} نسخه اضافه شد.`,
          });
        } else if (sync.versions === 0) {
          report.warnings.push({ row: 0, msg: 'پیش‌نیازها خوانده شد ولی هنوز هیچ چارتی درس ندارد؛ پس از تعریف چارت، دکمهٔ «همگام‌سازی پیش‌نیاز از جدول دروس» را بزنید.' });
        }
        if (sync.unresolvedCodes.length) {
          report.warnings.push({ row: 0, msg: `${sync.unresolvedCodes.length} کد پیش‌نیاز/هم‌نیاز در بانک دروس نبود (نمونه: ${sync.unresolvedCodes.slice(0, 6).join('، ')}).` });
        }
      } catch (e: any) {
        report.warnings.push({ row: 0, msg: `همگام‌سازی قواعد انجام نشد: ${e?.message ?? e}` });
      }
    }
    reportRewrites(rw, 'درس');
  }

  if (entity === 'term') {
    for (const r of rows) {
      const r0 = await db.insert(academic_terms).values({
        termCode: String(r.termCode), title: String(r.title), isCurrent: r.isCurrent ? 1 : 0,
      }).onConflictDoNothing().returning({ id: academic_terms.id });
      if (r0.length) {
        inserted++;
        if (r.isCurrent) {
          await db.update(academic_terms).set({ isCurrent: 0 });          // فقط یک ترم جاری
          await db.update(academic_terms).set({ isCurrent: 1 }).where(eq(academic_terms.id, r0[0].id));
        }
      } else existing++;
    }
  }

  if (entity === 'enrollment') {
    const stu = await db.select({ id: students.id, code: students.studentCode }).from(students);
    // 🔁 اگر هنگام انتقالِ «دروس» کد قدیمی با کد جدید جایگزین شده باشد، فایل
    //    نمرات/ثبت‌نام هنوز کد قدیمی را دارد؛ پس همان جایگزینی اینجا هم اعمال
    //    می‌شود تا درسِ تکراری با کد قدیمی ساخته نشود.
    const rwCourse = await rewriter('COURSE');
    const crs = await db.select({ id: courses.id, code: courses.code }).from(courses);
    const trm = await db.select({ id: academic_terms.id, code: academic_terms.termCode }).from(academic_terms);
    for (const r of rows) {
      const s = stu.find(x => x.code === String(r.studentCode));
      const t = trm.find(x => x.code === String(r.termCode));
      if (!s || !t) { report.errors.push({ row: 0, msg: `${r.studentCode}/${r.termCode} یافت نشد.` }); continue; }
      const wantedCourseCode = rwCourse.apply(String(r.courseCode));
      let c = crs.find(x => x.code === wantedCourseCode);
      if (!c) { // درس قدیمی — placeholder می‌سازیم تا نمره برنامهٔ درسی جدید را خراب نکند
        const warnBak = report.warnings.length;
        const [nc] = await db.insert(courses).values({ code: wantedCourseCode, title: `درس مهاجرتی ${wantedCourseCode}`, units: '0' }).onConflictDoNothing().returning({ id: courses.id });
        if (nc) { c = { id: nc.id, code: wantedCourseCode }; crs.push(c); report.warnings.push({ row: 0, msg: `درس ${wantedCourseCode} نبود — به‌صورت placeholder ساخته شد.` }); }
        else { const [ex] = await db.select({ id: courses.id, code: courses.code }).from(courses).where(eq(courses.code, wantedCourseCode)); c = ex; crs.push(c); }
        void warnBak;
      }
      // ارائهٔ مهاجرتی: یک گروه با ظرفیت باز برای آن ترم/درس
      let [off] = await db.select({ id: course_offerings.id }).from(course_offerings)
        .where(and(eq(course_offerings.termId, t.id), eq(course_offerings.courseId, c.id))).limit(1);
      if (!off) {
        [off] = await db.insert(course_offerings).values({
          termId: t.id, courseId: c.id, capacity: 999, groupNumber: 1, enrolledCount: 0, isActive: 1,
        }).returning({ id: course_offerings.id });
      }
      const r0 = await db.insert(enrollments).values({
        studentId: s.id, offeringId: off.id, status: 'REGISTERED',
        gradeValue: r.gradeValue != null ? String(r.gradeValue) : null,
        gradeStatus: String(r.gradeStatus), hasEvaluated: r.gradeValue != null ? 1 : 0,
      }).onConflictDoNothing().returning({ id: enrollments.id });
      r0.length ? inserted++ : existing++;
    }
    reportRewrites(rwCourse, 'درس');
  }

  if (entity === 'ledger') {
    const stu = await db.select({ id: students.id, code: students.studentCode }).from(students);
    const trm = await db.select({ id: academic_terms.id, code: academic_terms.termCode }).from(academic_terms);
    for (const r of rows) {
      const s = stu.find(x => x.code === String(r.studentCode));
      const t = trm.find(x => x.code === String(r.termCode));
      if (!s) { report.errors.push({ row: 0, msg: `دانشجو ${r.studentCode} یافت نشد.` }); continue; }
      const dup = await db.select({ id: student_ledger.id }).from(student_ledger)
        .where(and(eq(student_ledger.studentId, s.id), eq(student_ledger.amount, String(r.amount)), eq(student_ledger.description, String(r.description)))).limit(1);
      if (dup.length) { existing++; continue; }
      await db.insert(student_ledger).values({
        studentId: s.id, termId: t?.id ?? null, transactionType: String(r.transactionType),
        amount: String(r.amount), description: `[مهاجرت] ${r.description}`,
        createdAt: r.createdAt as Date,
      });
      inserted++;
    }
  }

  if (entity === 'clearance') {
    const stu = await db.select({ id: students.id, code: students.studentCode }).from(students);
    const trm = await db.select({ id: academic_terms.id, code: academic_terms.termCode }).from(academic_terms);
    for (const r of rows) {
      const s = stu.find(x => x.code === String(r.studentCode));
      const t = trm.find(x => x.code === String(r.termCode));
      if (!s || !t) { report.errors.push({ row: 0, msg: `${r.studentCode}/${r.termCode} یافت نشد.` }); continue; }
      const r0 = await db.insert(financial_clearances).values({
        studentId: s.id, termId: t.id, isCleared: r.isCleared ? 1 : 0, clearedAt: r.isCleared ? new Date() : null,
      }).onConflictDoUpdate({ target: [financial_clearances.studentId, financial_clearances.termId], set: { isCleared: r.isCleared ? 1 : 0 } })
        .returning({ id: financial_clearances.id });
      r0.length ? inserted++ : existing++;
    }
  }

  if (entity === 'curriculum') {
    // ── انتقال چارت: برای هر (رشته/مقطع/بازهٔ ورودی) یک نسخهٔ PUBLISHED می‌سازیم
    //    و درس‌های آن را در curriculum_courses درج می‌کنیم (idempotent). اگر
    //    سرفصل بعد از دو سال عوض شد، دو بازهٔ مختلف دو نسخهٔ جدا می‌گیرند.
    const degreeRows = await db.select({ id: degree_level_configs.id, code: degree_level_configs.code, title: degree_level_configs.title }).from(degree_level_configs);
    const degreeMap = await resolverFor(sourceCode, 'DEGREE');
    const majorRows = await db.select({ id: majors.id, code: majors.majorCode, name: majors.name, degreeLevelId: majors.degreeLevelId }).from(majors)
      // 🔒 دانشگاه مقصد: کد ۸۴ در دانشگاه ۱ و ۲ می‌تواند دو رشتهٔ متفاوت باشد
      .where(universityId ? eq(majors.universityId, universityId) : undefined);
    const allCourses = await db.select({ id: courses.id, code: courses.code, title: courses.title, units: courses.units, courseType: courses.courseType }).from(courses);
    const courseByCode = new Map(allCourses.map(c => [c.code, c]));
    const rwCourse = await rewriter('COURSE');

    // گروه‌بندی ردیف‌ها بر اساس (majorId, degreeLevelId, entryYearFrom, entryYearTo) → یک نسخهٔ چارت
    // roleType = null یعنی در فایل خالی بود ⇒ از نوع درس در بانک دروس خوانده می‌شود
    type ChartRow = { courseCode: string; courseTitle: string | null; units: number | null; recommendedSemester: number | null; roleType: string | null; isRequired: boolean };
    const groups = new Map<string, { majorId: number; degreeLevelId: number; entryYearFrom: number; entryYearTo: number | null; label: string; items: ChartRow[] }>();
    for (const r of rows) {
      const mCode = norm(String(r.majorCode ?? ''));
      const mName = norm(String(r.majorName ?? ''));
      const major = (mCode ? majorRows.find(m => norm(m.code ?? '') === mCode) : null)
        ?? majorRows.find(m => norm(m.name) === mName);
      if (!major) { report.errors.push({ row: 0, msg: `رشته «${r.majorCode || r.majorName}» یافت نشد — ردیف رد شد.` }); continue; }
      const ef = (r as Record<string, unknown>).entryYearFrom as number | null;
      const et = (r as Record<string, unknown>).entryYearTo as number | null;
      const entryFrom = ef ?? 1300;
      const entryTo = et ?? null;
      const key = `${major.id}|${major.degreeLevelId}|${entryFrom}|${entryTo ?? 'null'}`;
      if (!groups.has(key)) groups.set(key, { majorId: major.id, degreeLevelId: major.degreeLevelId, entryYearFrom: entryFrom, entryYearTo: entryTo, label: `${major.name}`, items: [] });
      groups.get(key)!.items.push({
        courseCode: rwCourse.apply(String(r.courseCode)), courseTitle: (r.courseTitle as string | null) ?? null,
        units: (r.units as number | null) ?? null, recommendedSemester: (r.recommendedSemester as number | null) ?? null,
        roleType: (r.roleType as string | null) ?? null, isRequired: r.isRequired !== false,
      });
    }

    let versionsMade = 0, coursesLinked = 0, rolesFromBank = 0;
    const zeroUnitWarned = new Set<string>();
    for (const g of groups.values()) {
      // نسخهٔ چارتِ این رشته/مقطع/بازهٔ ورودی — با وضعیت «پیش‌نویس»
      // تا کاربر ابتدا بازبینی کند و بعد خودش منتشر کند.
      const verLabel = g.entryYearTo ? `${g.entryYearFrom}–${g.entryYearTo}` : `${g.entryYearFrom} به بعد`;
      const versionCode = `LEGACY-${g.entryYearFrom}${g.entryYearTo ? `-${g.entryYearTo}` : ''}`;

      // محاسبهٔ خودکار جمع واحدها بر حسب نقش و کل واحد لازم برای فارغ‌التحصیلی
      // نقشِ خالی از بانک دروس خوانده می‌شود (نه «پایه» به‌صورت پیش‌فرض)
      const roleOf = (it: ChartRow): string => {
        if (it.roleType) return it.roleType;
        const c = courseByCode.get(it.courseCode);
        return roleFromBankType(c?.courseType ?? null);
      };
      const byRole: Record<string, number> = {};
      let totalUnitsCalc = 0;
      for (const it of g.items) {
        const c = courseByCode.get(it.courseCode);
        const u = Number(it.units ?? c?.units ?? 0);
        if (!Number.isFinite(u) || u <= 0) continue;
        const role = roleOf(it);
        byRole[role] = (byRole[role] ?? 0) + u;
        totalUnitsCalc += u;
      }
      for (const k of Object.keys(byRole)) byRole[k] = Math.round(byRole[k] * 10) / 10;
      totalUnitsCalc = Math.round(totalUnitsCalc * 10) / 10;
      const minRoleUnitsJson = JSON.stringify(byRole);

      const [existingVer] = await db.select({ id: curriculum_versions.id, totalRequiredUnits: curriculum_versions.totalRequiredUnits, minRoleUnits: curriculum_versions.minRoleUnits }).from(curriculum_versions)
        .where(and(eq(curriculum_versions.majorId, g.majorId), eq(curriculum_versions.degreeLevelId, g.degreeLevelId),
          isNull(curriculum_versions.trackId),
          eq(curriculum_versions.entryYearFrom, g.entryYearFrom),
          g.entryYearTo == null ? isNull(curriculum_versions.entryYearTo) : eq(curriculum_versions.entryYearTo, g.entryYearTo))).limit(1);
      let versionId = existingVer?.id ?? null;
      if (!versionId) {
        const [ins] = await db.insert(curriculum_versions).values({
          majorId: g.majorId, degreeLevelId: g.degreeLevelId, trackId: null,
          versionCode, title: `برنامهٔ درسی مهاجرتی ${g.label} (ورودی ${verLabel})`,
          status: 'DRAFT', entryYearFrom: g.entryYearFrom, entryYearTo: g.entryYearTo,
          totalRequiredUnits: String(totalUnitsCalc),
          minRoleUnits: minRoleUnitsJson,
          universityId: universityId ?? null,
        }).returning({ id: curriculum_versions.id });
        versionId = ins?.id ?? null;
        if (versionId) versionsMade++;
      } else {
        // اگه نسخه از قبل هست ولی آمار خالی شده، کاملش می‌کنیم
        const patch: Record<string, unknown> = {};
        const curTotal = existingVer.totalRequiredUnits ? Number(existingVer.totalRequiredUnits) : 0;
        if ((!curTotal || curTotal === 0) && totalUnitsCalc > 0) patch.totalRequiredUnits = String(totalUnitsCalc);
        if (!existingVer.minRoleUnits && Object.keys(byRole).length) patch.minRoleUnits = minRoleUnitsJson;
        if (Object.keys(patch).length) {
          await db.update(curriculum_versions).set(patch).where(eq(curriculum_versions.id, existingVer.id));
        }
      }
      if (!versionId) continue;

      for (const it of g.items) {
        const c = courseByCode.get(it.courseCode);
        if (!c) { report.warnings.push({ row: 0, msg: `درس ${it.courseCode} یافت نشد — وصل نشد.` }); continue; }
        const roleType = roleOf(it);
        // واحد فقط از بانک دروس — عددِ داخل فایل نادیده گرفته می‌شود
        const bankUnits = Number(c.units ?? 0);
        if (!(bankUnits > 0) && zeroUnitWarned.size < 10) {
          zeroUnitWarned.add(c.code);
          report.warnings.push({ row: 0, msg: `درس ${c.code} در بانک دروس «۰ واحد» است — همان ۰ در چارت ثبت شد؛ واحد را در بانک دروس اصلاح کنید.` });
        }
        if (!it.roleType) rolesFromBank++;
        const r0 = await db.insert(curriculum_courses).values({
          curriculumVersionId: versionId, courseId: c.id, roleType,
          units: c.units != null ? String(c.units) : null,
          isRequired: it.isRequired ? 1 : 0, isElective: roleType === 'ELECTIVE' ? 1 : 0,
          // «الزامی» در فایل باید «شرط فارغ‌التحصیلی» هم بشود، وگرنه اعتبارسنجی
          // چارت با خطای GRADUATION_COVERAGE («هیچ درسی علامت‌گذاری نشده») می‌افتد.
          // پایان‌نامه و کارآموزی هم شرط فارغ‌التحصیلی‌اند، نه فقط پایه/اصلی/تخصصی.
          isGraduationRequired: it.isRequired ? 1 : 0,
          recommendedSemester: it.recommendedSemester,
        }).onConflictDoNothing().returning({ id: curriculum_courses.id });
        if (r0.length) { coursesLinked++; inserted++; } else existing++;
      }
    }
    if (versionsMade) report.warnings.push({ row: 0, msg: `${versionsMade} نسخهٔ چارت با وضعیت «پیش‌نویس (DRAFT)» ساخته شد — پس از بازبینی، خودتان منتشر کنید.` });
    if (coursesLinked) report.warnings.push({ row: 0, msg: `${coursesLinked} درس به چارت‌ها وصل شد.` });
    if (rolesFromBank) report.warnings.push({ row: 0, msg: `نقش ${rolesFromBank} درس در فایل خالی بود — نوع درس از بانک دروس خوانده و اعمال شد.` });
    reportRewrites(rwCourse, 'درس (چارت)');
  }

  report.willInsert = inserted;
  report.existing = existing;
  report.errors = report.errors.slice(0, 50);
  report.warnings = report.warnings.slice(0, 50);
  await db.insert(migration_runs).values({
    entity, fileName, mode: 'COMMIT', totalRows: report.total, inserted, skippedExisting: existing,
    invalid: report.invalid, report: JSON.stringify(report), status: report.errors.length && !inserted ? 'FAILED' : 'OK', triggeredByUserId: userId,
  });
  return report;
}

export async function logDryRun(userId: number, report: Report) {
  await db.insert(migration_runs).values({
    entity: report.entity, fileName: report.fileName, mode: 'DRY', totalRows: report.total,
    inserted: 0, skippedExisting: 0, invalid: report.invalid,
    report: JSON.stringify(report), status: 'OK', triggeredByUserId: userId,
  });
}

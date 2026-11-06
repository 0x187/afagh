/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تست موتور تطبیق سما → آفاق (بدون پایگاه داده)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  هر مورد این تست از یک خرابیِ واقعی در همگام‌سازی‌های دستیِ گذشته آمده است:
 *
 *   ۱) ارقام فارسی در فایل کارشناس → همه ردیف‌ها «گم‌شده» می‌شدند.
 *   ۲) صفرِ پیشرو در کد دانشجو/درس → تطبیقِ صفر.
 *   ۳) ارائهٔ تکراری (گروه واقعی + ارائهٔ خالیِ مهاجرت) → ثبت‌نام روی
 *      ارائهٔ خالی می‌نشست و ظرفیت کلاس غلط می‌شد.
 *   ۴) دانشجو در گروه دیگر → «واحد تکراری» ساخته می‌شد.
 *   ۵) واحد اضافی در آفاق → حذف خودکار؛ باید فقط گزارش شود.
 *   ۶) کد دانشجوی تکراری بین دانشگاه‌ها → نمره به دانشجوی موسسهٔ دیگر می‌چسبید.
 */

import { studentKey, courseKey, parseGrade, offeringKey } from '@/lib/sama-sync/normalize';
import { parseEnrollmentTsv } from '@/lib/sama-sync/parse';
import { buildPlan } from '@/lib/sama-sync/plan';
import { toMarkdown } from '@/lib/sama-sync/report';
import type { AfaghSnapshot, SamaSnapshot } from '@/lib/sama-sync/types';

let pass = 0;
let fail = 0;
const t = (name: string, fn: () => unknown): void => {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    console.error(`  ✗ ${name}\n     ${(e as Error).message}`);
  }
};
const eq = (a: unknown, b: unknown, msg = ''): void => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg} انتظار ${JSON.stringify(b)} ولی ${JSON.stringify(a)}`);
  }
};

console.log('\n── نرمال‌سازی ──');

t('ارقام فارسی و عربی به ASCII تبدیل می‌شوند', () => {
  eq(studentKey('۳۱۴۱۲۰۰۱'), '31412001');
  eq(studentKey('٣١٤١٢٠٠١'), '31412001');
});

t('صفرِ پیشرو در کد دانشجو و کد درس حذف می‌شود', () => {
  eq(studentKey('0031412001'), '31412001');
  eq(courseKey('051127'), '51127');
  eq(courseKey('51127'), '51127');
});

t('کد خالی یا فقط‌حرفی کلید تهی می‌دهد', () => {
  eq(studentKey(''), '');
  eq(courseKey('الف'), '');
});

t('نمره: ۲۰۰ یعنی ۲۰٫۰ (صفر اضافه)', () => {
  eq(parseGrade('۲۰۰'), 20);
  eq(parseGrade('19.5'), 19.5);
  eq(parseGrade('۱۹٫۷۵'), 19.75);
  eq(parseGrade(''), null);
  eq(parseGrade('غایب'), null);
});

t('کلید ارائه از ترم/درس/گروه ساخته می‌شود', () => {
  eq(offeringKey('۱۴۰۵۱', '۵۱۱۲۷', '۰۳'), '14051|51127|3');
});

console.log('\n── پارسر TSV ──');

t('سرستون لاتین سما تشخیص داده می‌شود', () => {
  const tsv = ['Stno\tTermCode\tLessonCode\tLessonGroup\tMark\tStatus',
    '31412001\t14051\t51127\t1\t18.5\tP',
    '31412001\t14051\t51128\t2\t\t'].join('\n');
  const p = parseEnrollmentTsv(tsv);
  eq(p.rows.length, 2);
  eq(p.rows[0].groupNumber, 1);
  eq(p.rows[0].grade, 18.5);
  eq(p.rows[1].grade, null);
  eq(p.termCode, '14051');
});

t('سرستون فارسی هم پذیرفته می‌شود', () => {
  const tsv = ['کد دانشجو\tکد ترم\tکد درس\tگروه\tنمره',
    '۳۱۴۱۲۰۰۱\t۱۴۰۵۱\t۵۱۱۲۷\t۱\t۱۵'].join('\n');
  const p = parseEnrollmentTsv(tsv);
  eq(p.rows.length, 1);
  eq(p.rows[0].studentCode, '31412001');
  eq(p.rows[0].grade, 15);
});

t('فایل بدون سرستون با ترتیب متعارف خوانده می‌شود', () => {
  const tsv = '31412001\t14051\t51127\t1\t17\tP';
  const p = parseEnrollmentTsv(tsv);
  eq(p.rows.length, 1);
  eq(p.rows[0].courseCode, '51127');
  if (!p.warnings.some((w) => w.includes('سرستون'))) throw new Error('هشدار سرستون داده نشد');
});

t('ردیف ناقص نادیده گرفته و هشدار داده می‌شود', () => {
  const tsv = ['Stno\tTermCode\tLessonCode\tLessonGroup\tMark',
    '31412001\t14051\t\t1\t18'].join('\n');
  const p = parseEnrollmentTsv(tsv);
  eq(p.rows.length, 0);
  if (!p.warnings.length) throw new Error('هشدار ردیف ناقص داده نشد');
});

console.log('\n── موتور تطبیق ──');

/** پایهٔ مشترک: یک ترم، دو دانشجو، دو درس، سه ارائه. */
function baseAfagh(): AfaghSnapshot {
  return {
    universityId: 1,
    termCode: '14051',
    termId: 111,
    students: [
      { id: 10, studentCode: '31412001', status: 'ACTIVE' },
      { id: 11, studentCode: '31412002', status: 'ACTIVE' },
    ],
    offerings: [
      { id: 100, termId: 111, termCode: '14051', courseCode: '51127', groupNumber: 1, isActive: 1, enrolledCount: 30 },
      { id: 101, termId: 111, termCode: '14051', courseCode: '51128', groupNumber: 1, isActive: 1, enrolledCount: 20 },
      { id: 102, termId: 111, termCode: '14051', courseCode: '51128', groupNumber: 2, isActive: 1, enrolledCount: 5 },
    ],
    enrollments: [
      { id: 900, studentId: 10, offeringId: 100, status: 'REGISTERED', gradeValue: '18' },
    ],
  };
}

const samaOf = (rows: SamaSnapshot['enrollments'], warnings: string[] = []): SamaSnapshot => ({
  termCode: '14051', enrollments: rows, students: [], warnings,
});

t('تطبیق کامل + افزودنیِ محض', () => {
  const plan = buildPlan(
    samaOf([
      { studentCode: '31412001', termCode: '14051', courseCode: '51127', groupNumber: 1, grade: 18, statusCode: null },
      { studentCode: '31412002', termCode: '14051', courseCode: '51128', groupNumber: 2, grade: 16, statusCode: null },
    ]),
    baseAfagh(),
  );
  eq(plan.stats.matched, 1, 'تطبیق:');
  eq(plan.stats.addEnrollment, 1, 'افزودنی:');
  eq(plan.actions.length, 1);
  eq(plan.actions[0].kind, 'INSERT_ENROLLMENT');
  eq(plan.actions[0].offeringId, 102);
  eq(plan.actions[0].grade, 16);
});

t('نمرهٔ خالی در آفاق پر می‌شود، نمرهٔ موجود بازنویسی نمی‌شود', () => {
  const snap = baseAfagh();
  snap.enrollments[0].gradeValue = null;
  const fill = buildPlan(
    samaOf([{ studentCode: '31412001', termCode: '14051', courseCode: '51127', groupNumber: 1, grade: 18, statusCode: null }]),
    snap,
  );
  eq(fill.actions.length, 1);
  eq(fill.actions[0].kind, 'FILL_GRADE');
  eq(fill.actions[0].enrollmentId, 900);

  const conflict = buildPlan(
    samaOf([{ studentCode: '31412001', termCode: '14051', courseCode: '51127', groupNumber: 1, grade: 12, statusCode: null }]),
    baseAfagh(),
  );
  eq(conflict.actions.length, 0, 'بازنویسی نباید عمل بسازد:');
  eq(conflict.issues.filter((i) => i.code === 'STATUS_MISMATCH').length, 1);
});

t('اختلاف گروه فقط گزارش می‌شود و واحد تکراری نمی‌سازد', () => {
  const plan = buildPlan(
    samaOf([{ studentCode: '31412001', termCode: '14051', courseCode: '51127', groupNumber: 3, grade: null, statusCode: null }]),
    baseAfagh(),
  );
  // ارائهٔ گروه ۳ وجود ندارد ⇒ OFFERING_MISSING، نه افزودن
  eq(plan.stats.addEnrollment, 0);
  eq(plan.stats.offeringMissing, 1);

  const snap = baseAfagh();
  snap.offerings.push({ id: 103, termId: 111, termCode: '14051', courseCode: '51127', groupNumber: 3, isActive: 1, enrolledCount: 0 });
  const plan2 = buildPlan(
    samaOf([{ studentCode: '31412001', termCode: '14051', courseCode: '51127', groupNumber: 3, grade: null, statusCode: null }]),
    snap,
  );
  eq(plan2.stats.groupMismatch, 1);
  eq(plan2.stats.addEnrollment, 0, 'واحد تکراری نباید ساخته شود:');
});

t('ارائهٔ تکراری: ارائهٔ دارای دانشجو انتخاب می‌شود نه خالی', () => {
  const snap = baseAfagh();
  // ارائهٔ خالیِ مهاجرت با شناسهٔ کوچک‌تر — اگر «اولین» انتخاب شود، اشتباه است
  snap.offerings.unshift({ id: 99, termId: 111, termCode: '14051', courseCode: '51128', groupNumber: 2, isActive: 1, enrolledCount: 0 });
  const plan = buildPlan(
    samaOf([{ studentCode: '31412002', termCode: '14051', courseCode: '51128', groupNumber: 2, grade: 14, statusCode: null }]),
    snap,
  );
  eq(plan.stats.duplicateOffering, 1);
  eq(plan.actions[0].offeringId, 102, 'ارائهٔ دارای دانشجو باید انتخاب شود:');
});

t('واحد اضافی در آفاق هرگز حذف نمی‌شود — فقط گزارش', () => {
  const plan = buildPlan(samaOf([]), baseAfagh());
  eq(plan.stats.extraEnrollment, 1);
  eq(plan.actions.length, 0);
  eq(plan.issues.filter((i) => i.code === 'EXTRA_ENROLLMENT').length, 1);
});

t('دانشجوی گم‌شده یک‌بار گزارش می‌شود، نه به تعداد واحدها', () => {
  const plan = buildPlan(
    samaOf([
      { studentCode: '99999999', termCode: '14051', courseCode: '51127', groupNumber: 1, grade: null, statusCode: null },
      { studentCode: '99999999', termCode: '14051', courseCode: '51128', groupNumber: 1, grade: null, statusCode: null },
    ]),
    baseAfagh(),
  );
  eq(plan.stats.studentMissing, 1);
  eq(plan.issues.filter((i) => i.code === 'ADD_STUDENT').length, 1);
});

t('کد دانشجوی تکراری داخل دانشگاه مبهم علامت می‌خورد و نوشتنی رخ نمی‌دهد', () => {
  const snap = baseAfagh();
  snap.students.push({ id: 12, studentCode: '31412001', status: 'ACTIVE' });
  const plan = buildPlan(
    samaOf([{ studentCode: '31412001', termCode: '14051', courseCode: '51128', groupNumber: 1, grade: 10, statusCode: null }]),
    snap,
  );
  eq(plan.stats.studentAmbiguous, 1);
  eq(plan.actions.length, 0);
});

t('ردیف تکراری سما با نمرهٔ موجود، نمره را از دست نمی‌دهد', () => {
  const snap = baseAfagh();
  snap.enrollments[0].gradeValue = null;
  const plan = buildPlan(
    samaOf([
      { studentCode: '31412001', termCode: '14051', courseCode: '51127', groupNumber: 1, grade: null, statusCode: null },
      { studentCode: '31412001', termCode: '14051', courseCode: '51127', groupNumber: 1, grade: 19, statusCode: null },
    ]),
    snap,
  );
  eq(plan.stats.samaEnrollmentRows, 1);
  eq(plan.actions[0].grade, 19);
});

t('ردیفِ ترم دیگر نادیده گرفته می‌شود', () => {
  const plan = buildPlan(
    samaOf([{ studentCode: '31412002', termCode: '14042', courseCode: '51128', groupNumber: 1, grade: 20, statusCode: null }]),
    baseAfagh(),
  );
  eq(plan.stats.samaEnrollmentRows, 0);
  eq(plan.actions.length, 0);
});

t('گزارش مارک‌داون تولید می‌شود و خلاصهٔ عددی دارد', () => {
  const plan = buildPlan(
    samaOf([{ studentCode: '31412002', termCode: '14051', courseCode: '51128', groupNumber: 2, grade: 16, statusCode: null }]),
    baseAfagh(),
  );
  const md = toMarkdown(plan, { source: 'test.tsv' });
  if (!md.includes('# گزارش همگام‌سازی')) throw new Error('سرتیتر گزارش نیست');
  if (!md.includes('تطبیق کامل')) throw new Error('جدول خلاصه نیست');
  if (!md.includes('test.tsv')) throw new Error('منبع در گزارش نیست');
});

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} موفق، ${fail} ناموفق\n`);
if (fail > 0) process.exitCode = 1;

/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیت «انتقال سنجش باید idempotent باشد»
 *
 *  چرا این تست وجود دارد:
 *    کاربر فایل سنجش ۵۰ نفره را بارگذاری کرد و بار اول ۴۶ پرونده ساخته شد،
 *    ولی `staging.studentId` پر نشد. در تلاش دوم، برای **همهٔ** آن ۴۶ نفر
 *    پیام «پروندهٔ فعال با همین رشته و ورودی وجود دارد» آمد — یعنی عملاً
 *    انتقال برای ۵۰ نفر قفل شد و کاربر مجبور شد رکوردها را دستی حذف کند.
 *
 *    دو علت ریشه‌ای:
 *      ۱) کد به‌جای «وصل کردن» ردیف صف به پروندهٔ موجود، استثنا پرتاب می‌کرد.
 *      ۲) تطبیق فقط با `majorId` بود، ولی جدول majors چند رکورد هم‌نام با
 *         شناسه‌های متفاوت دارد (حسابداری: ۱۱۱ و ۲۲۷). نتیجه: پروندهٔ دومِ
 *         هم‌نام برای همان دانشجو.
 *
 *  این تست هر دو را قفل می‌کند تا باگ برنگردد.
 * ════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickExistingProfile } from '../src/lib/admissions-dedupe';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(HERE, '..', 'src', 'lib', 'admissions-engine.ts');
const ENGINE_SRC = readFileSync(ENGINE, 'utf8');

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log(`  ✓ ${m}`); }
  else { fail++; console.error(`  ✗ ${m}`); }
};

const profile = (id: number, majorId: number | null, majorName: string | null) => ({
  id,
  studentCode: `40519${String(id).padStart(5, '0')}`,
  majorId,
  majorName,
});

console.log('\n▶ وصل شدن به پروندهٔ موجود (به‌جای خطا)');
{
  const candidates = [profile(14971, 111, 'حسابداري')];

  const sameId = pickExistingProfile(candidates, { majorId: 111, majorName: 'حسابداري' });
  ok(sameId?.profile.id === 14971, 'شناسهٔ رشتهٔ یکسان → وصل می‌شود');
  ok(sameId?.reason === 'same-major-id', 'دلیل وصل: same-major-id');

  // هستهٔ باگ: ردیف سنجش به رشتهٔ ۲۲۷ نگاشت شده ولی پروندهٔ موجود روی ۱۱۱ است.
  const sameName = pickExistingProfile(candidates, { majorId: 227, majorName: 'حسابداري' });
  ok(sameName?.profile.id === 14971, 'شناسهٔ متفاوت ولی نام یکسان → وصل می‌شود (باگ قبلی: پروندهٔ دوم)');
  ok(sameName?.reason === 'same-major-name', 'دلیل وصل: same-major-name');

  const arabic = pickExistingProfile([profile(7, 500, 'حسابداري')], { majorId: 999, majorName: 'حسابداری' });
  ok(arabic?.profile.id === 7, 'ي عربی و ی فارسی یکسان دیده می‌شوند');

  const spaced = pickExistingProfile([profile(8, 501, ' الکترونيک- الکترونيک عمومي ')], {
    majorId: 998,
    majorName: 'الکترونیک- الکترونیک عمومی',
  });
  ok(spaced?.profile.id === 8, 'فاصلهٔ اضافی و کشیده (ـ) مانع تطبیق نمی‌شود');
}

console.log('\n▶ پذیرش تازه نباید وصل شود');
{
  const candidates = [profile(14977, 122, 'الکترونيک')];
  ok(
    pickExistingProfile(candidates, { majorId: 231, majorName: 'مکانيک خودرو' }) === null,
    'رشتهٔ متفاوت → null (پذیرش تازه)',
  );
  ok(pickExistingProfile([], { majorId: 1, majorName: 'حسابداری' }) === null, 'بدون پرونده → null');
  ok(pickExistingProfile(candidates, { majorId: 999, majorName: '' }) === null, 'نام خالی و شناسهٔ متفاوت → null');
  ok(pickExistingProfile(candidates, { majorId: null, majorName: null }) === null, 'ورودی خالی → null');
}

console.log('\n▶ هرگز استثنا پرتاب نمی‌کند');
{
  let threw = false;
  try {
    pickExistingProfile(
      [{ id: 1, studentCode: null, majorId: null, majorName: null }],
      { majorId: 5, majorName: null },
    );
  } catch { threw = true; }
  ok(!threw, 'پروندهٔ ناقص (رشتهٔ null) باعث خطا نمی‌شود');
}

console.log('\n▶ گارد منبع: کد دیگر خطای «پروندهٔ فعال» نمی‌دهد');
{
  ok(
    !ENGINE_SRC.includes('پروندهٔ فعال با همین رشته و ورودی وجود دارد'),
    'پیام خطای قدیمی حذف شده است',
  );
  ok(
    ENGINE_SRC.includes('pickExistingProfile'),
    'موتور از تابع مشترک pickExistingProfile استفاده می‌کند',
  );
  ok(
    ENGINE_SRC.includes('assignedStudentCode: dup.studentCode'),
    'هنگام وصل شدن، شمارهٔ دانشجویی در staging ثبت می‌شود (علت اصلی باگ)',
  );
  ok(
    ENGINE_SRC.includes('linked: true'),
    'نتیجهٔ «وصل شد» به لایهٔ UI گزارش می‌شود',
  );
  ok(
    ENGINE_SRC.includes('allExisting.filter(e => e.entryYear === entryYear)'),
    'پنل «تکراری» فقط پروندهٔ همان ورودی را نشان می‌دهد (پروندهٔ ۱۴۰۱ با پذیرش ۱۴۰۵ تداخل ندارد)',
  );
  ok(
    !ENGINE_SRC.includes('const existing = byNc.get(r.nationalCode) ?? [];'),
    'فهرست بدون فیلتر ورودی برگردانده نمی‌شود',
  );
}

console.log(`\n${fail === 0 ? '✅' : '❌'} admissions-idempotent-transfer: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

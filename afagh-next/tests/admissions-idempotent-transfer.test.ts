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
const PAGE = path.join(HERE, '..', 'src', 'app', 'admin', 'admissions', 'page.tsx');
const PAGE_SRC = readFileSync(PAGE, 'utf8');
const CLIENT = path.join(HERE, '..', 'src', 'app', 'admin', 'admissions', 'AdmissionsClient.tsx');
const CLIENT_SRC = readFileSync(CLIENT, 'utf8');
const REVERT = path.join(HERE, '..', 'src', 'app', 'admin', 'admissions', 'revert.ts');
const REVERT_SRC = readFileSync(REVERT, 'utf8');

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

console.log('\n▶ گارد منبع: مقطع از رشتهٔ تطبیق‌داده‌شده خوانده می‌شود');
{
  ok(
    PAGE_SRC.includes('major?.degreeLevelId ?? s.degreeLevelId'),
    'page.tsx مقطع را از رشتهٔ نگاشت‌شده می‌گیرد (نه فقط از فایل سنجش)',
  );
  ok(
    PAGE_SRC.includes('degreeLevelName: level?.title ?? null'),
    'نام مقطع به کلاینت پاس داده می‌شود',
  );
  ok(
    CLIENT_SRC.includes('s?.degreeLevelName || s?.rawSanjeshData?.degreeLevel'),
    'کلاینت ابتدا مقطعِ رشتهٔ نگاشت‌شده را می‌خواند',
  );
  ok(
    CLIENT_SRC.includes('degreeTitleOf(st)'),
    'همهٔ جدول‌ها از همان resolver استفاده می‌کنند',
  );

  // TDZ: اگر تابع بعد از اولین مصرف‌کننده‌اش تعریف شود، در رندر اول
  // «Cannot access '…' before initialization» می‌دهد. ترتیب اعلان را می‌سنجیم.
  const declAt = CLIENT_SRC.indexOf('const degreeTitleOf =');
  const calls: number[] = [];
  for (let i = CLIENT_SRC.indexOf('degreeTitleOf('); i > -1; i = CLIENT_SRC.indexOf('degreeTitleOf(', i + 1)) {
    calls.push(i);
  }
  ok(declAt > -1, 'degreeTitleOf تعریف شده است');
  ok(calls.length > 0, 'degreeTitleOf واقعاً استفاده می‌شود');
  ok(
    declAt > -1 && calls.every(i => i > declAt),
    'همهٔ مصرف‌های degreeTitleOf بعد از تعریفش هستند (گارد TDZ)',
  );
}

console.log('\n▶ گارد منبع: شمارهٔ صادرشده در جدول دیده می‌شود');
{
  ok(
    PAGE_SRC.includes('assignedStudentCode: s.assignedStudentCode'),
    'page.tsx شمارهٔ صادرشده را به کلاینت پاس می‌دهد',
  );
  ok(
    CLIENT_SRC.includes("label: 'شمارهٔ دانشجویی'"),
    'ستون «شمارهٔ دانشجویی» در جدول صف تعریف شده',
  );
  ok(
    CLIENT_SRC.includes("{s.assignedStudentCode}"),
    'جدول بازبینی خود شماره را نشان می‌دهد (نه فقط برچسب «صادر شد»)',
  );
  ok(
    CLIENT_SRC.includes("'شمارهٔ دانشجویی', 'کد ملی'"),
    'خروجی اکسل هم ستون شمارهٔ دانشجویی دارد',
  );
}

console.log('\n▶ گارد منبع: شمارهٔ صادرشده را می‌توان حذف و دوباره صادر کرد');
{
  ok(
    REVERT_SRC.includes('export async function revokeAssignedNumbersAction'),
    'اکشن «حذف شماره‌های صادرشده» وجود دارد',
  );
  ok(
    REVERT_SRC.includes("r.status === 'NUMBER_ASSIGNED' || r.status === 'IMPORTED'"),
    'فقط ردیف‌های دارای شمارهٔ صادرشده هدف قرار می‌گیرند',
  );
  ok(
    REVERT_SRC.includes("FROM enrollments WHERE \"studentId\"") &&
      REVERT_SRC.includes("FROM student_ledger WHERE \"studentId\"") &&
      REVERT_SRC.includes("FROM payment_transactions WHERE \"studentId\""),
    'قبل از حذف، سابقهٔ آموزشی/مالی بررسی می‌شود',
  );
  ok(
    REVERT_SRC.includes('حذف شماره مجاز نیست'),
    'دانشجوی دارای سابقه حذف نمی‌شود (محافظت از داده)',
  );
  ok(
    REVERT_SRC.includes('assignedStudentCode: null') &&
      REVERT_SRC.includes("status: 'RESOLVED'"),
    'ردیف صف به RESOLVED برمی‌گردد تا شمارهٔ تازه صادر شود',
  );
  ok(
    CLIENT_SRC.includes('revokeAssignedNumbersAction'),
    'کلاینت اکشن حذف شماره را وارد می‌کند',
  );
  ok(
    CLIENT_SRC.includes('const handleRevokeNumbers'),
    'هندلر «حذف شماره‌های صادرشده» تعریف شده',
  );
  ok(
    CLIENT_SRC.includes('حذف شماره‌های صادرشده'),
    'دکمهٔ حذف شماره در نوار ابزار رندر می‌شود',
  );
  // گارد ایمنی: هر عملیات مخرب باید confirm داشته باشد.
  const revokeBody = CLIENT_SRC.slice(
    CLIENT_SRC.indexOf('const handleRevokeNumbers'),
    CLIENT_SRC.indexOf('const handleRevertResolved'),
  );
  ok(
    revokeBody.includes('confirm('),
    'حذف شماره بدون تأیید کاربر اجرا نمی‌شود',
  );
  ok(
    CLIENT_SRC.slice(
      CLIENT_SRC.indexOf('const handleRevertResolved'),
      CLIENT_SRC.indexOf('const handleRevertStaged'),
    ).includes('confirm('),
    'handleRevertResolved هم تأیید می‌گیرد (قبلاً ناخواسته حذف شده بود)',
  );
}

console.log('\n▶ گارد منبع: انتخاب فرمول شماره دانشجویی داخل همین تب');
{
  ok(
    CLIENT_SRC.includes('const transferFormulaOf'),
    'تابع خواندن فرمولِ مؤثرِ مقطع تعریف شده',
  );
  ok(
    CLIENT_SRC.includes('const handleSaveTransferFormula'),
    'هندلر ذخیرهٔ فرمول داخل تب صف وجود دارد',
  );
  ok(
    CLIENT_SRC.includes('saveStudentIdFormulaAction(degreeLevelId, f)'),
    'ذخیره به‌ازای «مقطع» انجام می‌شود (همان کلید پایگاه‌داده)',
  );
  ok(
    CLIENT_SRC.includes('فرمول شمارهٔ دانشجوییِ این انتقال'),
    'پنل انتخاب فرمول رندر می‌شود',
  );
  ok(
    CLIENT_SRC.includes('کتابخانهٔ مدل‌ها'),
    'می‌توان از مدل‌های آمادهٔ فرمول انتخاب کرد',
  );
  ok(
    CLIENT_SRC.includes('validateFormula(value)'),
    'فرمول قبل از ذخیره اعتبارسنجی می‌شود',
  );
  // TDZ: همین دام یک بار کامپوننت را کرش کرد («Cannot access 'e' before initialization»).
  const fDecl = CLIENT_SRC.indexOf('const transferFormulaOf');
  const fCalls: number[] = [];
  for (let i = CLIENT_SRC.indexOf('transferFormulaOf('); i > -1; i = CLIENT_SRC.indexOf('transferFormulaOf(', i + 1)) {
    fCalls.push(i);
  }
  ok(
    fDecl > -1 && fCalls.every(i => i > fDecl),
    'همهٔ مصرف‌های transferFormulaOf بعد از تعریفش هستند (گارد TDZ)',
  );
}

console.log('\n▶ گارد منبع: جدول بازبینی فیلتر/سورت دارد و دکمه‌هایش صادق‌اند');
{
  ok(
    CLIENT_SRC.includes('const reviewTable = useClientTable(readyRows, REVIEW_COLS)'),
    'جدول بازبینی از همان زیرساخت جدول صف استفاده می‌کند',
  );
  ok(
    CLIENT_SRC.includes('<ClientTh') && CLIENT_SRC.includes('onFilter={v => reviewTable.setFilter(col.key, v)}'),
    'هر سرستون فیلتر و سورت دارد',
  );
  ok(
    CLIENT_SRC.includes('{reviewTable.visible.map((s, i) => {'),
    'بدنهٔ جدول از ردیف‌های فیلترشده رندر می‌شود',
  );
  ok(
    CLIENT_SRC.includes("label: 'تأیید', get: () => '', sortable: false, filterable: false"),
    'ستون‌های تأیید و # عمداً سورت/فیلتر ندارند',
  );

  // باگ گزارش‌شده: «لغو همه» کار نمی‌کرد چون دکمه‌ها روی مجموعهٔ خالیِ ready
  // اجرا می‌شدند ولی جدول همهٔ ردیف‌ها را نشان می‌داد.
  ok(
    CLIENT_SRC.includes('disabled={reviewedCount === 0}'),
    '«لغو همه» وقتی چیزی برای لغو نیست غیرفعال است',
  );
  ok(
    CLIENT_SRC.includes('disabled={ready.length === 0 || unreviewed.length === 0}'),
    '«تأیید همه» وقتی ردیفی نیست غیرفعال است',
  );
  ok(
    CLIENT_SRC.includes('چیزی برای بازبینی نمانده'),
    'وقتی ردیفی آمادهٔ بازبینی نیست، پیام توضیحی نشان داده می‌شود',
  );
  ok(
    !CLIENT_SRC.includes('{reviewed.size.toLocaleString'),
    'شمارنده از اندازهٔ خامِ Set استفاده نمی‌کند (باگ «۵۰ از ۰»)',
  );
  ok(
    CLIENT_SRC.includes('const reviewedCount = ready.filter(s => reviewed.has(s.id)).length'),
    'شمارنده بر «اشتراک با ready» حساب می‌شود',
  );
  ok(
    CLIENT_SRC.includes('setReviewed(new Set());') &&
      CLIENT_SRC.includes('شناسه‌های تأییدشده هم پاک شوند'),
    'بعد از صدور شماره، وضعیت تأیید پاک می‌شود',
  );
}

console.log(`\n${fail === 0 ? '✅' : '❌'} admissions-idempotent-transfer: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

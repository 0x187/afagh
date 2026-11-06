/**
 * تست visibility فرآیندهای پایان‌نامه بر اساس مقطع — دانشجوی کاردانی/کارشناسی
 * نباید فرآیندهای پایان‌نامه/پروپوزال/دفاع را ببیند (خواستهٔ ۱۴۰۵-۰۸).
 */
import { isGraduateDegreeLevel, isThesisProcess } from '../src/lib/request-visibility';

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — expected ${expected}, got ${actual}`}`);
}

// ── isGraduateDegreeLevel ──
check('BS → غیرارشد', isGraduateDegreeLevel({ code: 'BS', title: 'کارشناسی پیوسته' }), false);
check('AD → غیرارشد', isGraduateDegreeLevel({ code: 'AD', title: 'کاردانی پیوسته' }), false);
check('BA → غیرارشد', isGraduateDegreeLevel({ code: 'BA' }), false);
check('AS → غیرارشد', isGraduateDegreeLevel({ code: 'AS' }), false);
check('MS → ارشد', isGraduateDegreeLevel({ code: 'MS', title: 'کارشناسی ارشد' }), true);
check('PHD → ارشد', isGraduateDegreeLevel({ code: 'PHD', title: 'دکتری حرفه‌ای' }), true);
check('MBA → ارشد', isGraduateDegreeLevel({ code: 'MBA' }), true);
check('DIPLOMA → غیرارشد (کد ناشناخته، بدون عنوان)', isGraduateDegreeLevel({ code: 'DIPLOMA' }), false);
check('فلگ isGraduate=1 مقدم بر کد', isGraduateDegreeLevel({ code: 'BS', isGraduate: 1 }), true);
check('فلگ isGraduate=0 مقدم بر کد', isGraduateDegreeLevel({ code: 'MS', isGraduate: 0 }), false);
check('عنوان «کارشناسی ارشد» → ارشد', isGraduateDegreeLevel({ title: 'کارشناسی ارشد' }), true);
check('عنوان «دکتری تخصصی» → ارشد', isGraduateDegreeLevel({ title: 'دکتری تخصصی' }), true);
check('عنوان «کاردانی» → غیرارشد', isGraduateDegreeLevel({ title: 'کاردانی ناپیوسته' }), false);
check('مقطع NULL → غیرارشد (محافظه‌کارانه)', isGraduateDegreeLevel(null), false);
check('مقطع خالی → غیرارشد', isGraduateDegreeLevel({}), false);

// ── isThesisProcess ──
check('کد THESIS_DEFENSE', isThesisProcess({ code: 'THESIS_DEFENSE' }), true);
check('کد THESIS_PROPOSAL', isThesisProcess({ code: 'THESIS_PROPOSAL' }), true);
check('عنوان پیش‌فرض سیستم', isThesisProcess({ code: 'X1', title: 'درخواست تعیین وقت و مجوز دفاع پایان‌نامه' }), true);
check('عنوان دیتابیس prod (پیکربی پروپوزال/پایان‌نامه)', isThesisProcess({ code: 'CUSTOM_9', title: 'پیکربی پروپوزال/پایان‌نامه' }), true);
check('نیم‌فاصله «پایان‌نامه»', isThesisProcess({ title: 'پیگیری پایان‌نامه دانشجو' }), true);
check('فاصله‌دار «پایان نامه»', isThesisProcess({ title: 'پیگیری پایان نامه دانشجو' }), true);
check('کلمه «دفاع» در توصیف', isThesisProcess({ code: 'X2', description: 'هماهنگی جلسه دفاع' }), true);
check('کلمه «رساله»', isThesisProcess({ title: 'تصویب رساله دکتری' }), true);
check('فرآیند غیرپایان‌نامه', isThesisProcess({ code: 'ENROLLMENT_CERT', title: 'گواهی اشتغال به تحصیل رسمی', description: 'صدور آنی گواهی' }), false);
check('فرآیند مرخصی', isThesisProcess({ code: 'LEAVE', title: 'درخواست مرخصی تحصیلی' }), false);
check(
  'تأیید کارنامهٔ مالی (FINANCE_STATEMENT) پایان‌نامه نیست و برای همهٔ مقاطع می‌ماند',
  isThesisProcess({
    code: 'FINANCE_STATEMENT',
    title: 'تأیید کارنامهٔ مالی برای چاپ معتبر (QR)',
    description: 'کارنامهٔ مالی مشاهده‌ای پرتال فاقد اعتبار اداری است. با تأیید کارشناس امور مالی، نسخهٔ دارای رمز استعلام (QR) برای چاپ معتبر فعال می‌شود.',
  }),
  false,
);
check('Y/K عربی هم می‌گیرد', isThesisProcess({ title: 'درخواست دفاع از پايان‌نامه' }), true);

// ── ترکیب نهایی: گیت مقطع ──
const thesisProc = { code: 'THESIS_DEFENSE', title: 'درخواست تعیین وقت و مجوز دفاع پایان‌نامه' };
const visible = (
  level: Parameters<typeof isGraduateDegreeLevel>[0],
  proc: { code?: string; title?: string } = thesisProc,
) => (isThesisProcess(proc) ? isGraduateDegreeLevel(level) : true);
check('دانشجوی BS فرآیند پایان‌نامه نمی‌بیند', visible({ code: 'BS' }), false);
check('دانشجوی AD فرآیند پایان‌نامه نمی‌بیند', visible({ code: 'AD' }), false);
check('دانشجوی MS فرآیند پایان‌نامه می‌بیند', visible({ code: 'MS' }), true);
check('دانشجوی PHD فرآیند پایان‌نامه می‌بیند', visible({ code: 'PHD' }), true);
check('مقطع نامشخص فرآیند پایان‌نامه نمی‌بیند', visible(null), false);
check('دانشجوی BS فرآیند گواهی می‌بیند', visible({ code: 'BS' }, { code: 'ENROLLMENT_CERT' }), true);

if (failed > 0) {
  console.error(`\n${failed} تست شکست خورد.`);
  process.exit(1);
}
console.log('\nهمهٔ تست‌های request-visibility سبز شد.');

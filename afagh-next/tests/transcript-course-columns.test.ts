/**
 * گیت «یکنواختی ریز شهریهٔ متغیر دروس» در کارنامهٔ مالی نوع الف و نوع ب.
 *
 * درخواست کارشناسان مالی:
 *   • واحد نظری و واحد عملی جدا دیده شود و ستون «واحد» حذف گردد،
 *   • کد «نوع درس مالی» ساده داخل پرانتز، کنار نام، **در چاپ/PDF هم** دیده شود،
 *   • سرستون «نوع درس مالی» باشد،
 *   • سربرگ ترم «نام نیمسال» + «وضع نیمسال» + «مبنای نرخ» + «کد گروه تعرفه»،
 *   • جدول ۸ستونه در چاپ A4 یک کارت تمامعرض بگیرد (دو کارت جا نمیشود).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { termTypeFromDigit, normalizeTermCode } from '../src/lib/scheduling-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const rd = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); }
  else { fail++; console.error('  ✗', m); }
};

const A = rd('src/components/FinancialTranscript.tsx');
const B = rd('src/components/FinancialTranscriptFlat.tsx');
const CSS = rd('src/app/globals.css');
const TC = rd('src/lib/transcript-courses.ts');
const TT = rd('src/lib/tuition-tariff.ts');
const ADMIN = rd('src/app/admin/finance/student/[id]/page.tsx');
const STU = rd('src/app/student/finance/page.tsx');
const API = rd('src/app/api/admin/finance/reports/student-statement/route.ts');

console.log('\n── یکنواختی ستونهای کارنامهٔ مالی ──');

for (const [name, src] of [['نوع الف', A], ['نوع ب', B]] as const) {
  ok(src.includes('نوع درس مالی'), `${name}: سرستون «نوع درس مالی»`);
  ok(src.includes('واحد نظری') && src.includes('واحد عملی'), `${name}: واحد نظری و عملی جدا`);
  ok(!/>واحد<\/th>/.test(src), `${name}: ستون مستقل «واحد» حذف شد`);
  ok(src.includes('tr-mali-code') && /tr-mali-code[^>]*>[^<]*\({fa\(/.test(src), `${name}: کد داخل پرانتز`);
  ok(!/tr-mali-code[^>]*tr-print-hide/.test(src), `${name}: کد در چاپ پنهان نمیشود`);
  ok(src.includes('وضع نیمسال') && src.includes("t.statusTitle || '—'"), `${name}: وضع نیمسال همیشه دیده میشود`);
  ok(src.includes('مبنای نرخ') && src.includes('کد گروه تعرفه'), `${name}: مبنای نرخ و کد گروه تعرفه`);
  ok(src.includes('tariffGroupCode?: string | null'), `${name}: پراپ کد گروه تعرفه تعریف شد`);
  ok(src.includes('rateBasisLabel'), `${name}: مبنای نرخ از تابع مشترک`);
  ok(src.includes('نام نیمسال') && src.includes('<TermTitle t={t} />'), `${name}: نام کامل نیمسال`);
  ok(src.includes("termType === 'EQUIVALENCE'") || src.includes("norm.termType === 'EQUIVALENCE'"), `${name}: نیمسال معادلسازی`);
  ok(src.includes("norm.termType === 'SUMMER'"), `${name}: نیمسال تابستان`);
}

ok(!A.includes('tr-print-hide font-mono text-[7px]'), 'نوع الف: کد خاکستری ریزِ صفحهای حذف شد');
ok(!B.includes('tr-print-hide ms-1 font-mono'), 'نوع ب: کد خاکستری ریزِ صفحهای حذف شد');
ok(A.includes('colSpan={7}'), 'نوع الف: جمع متغیر دروس با ۸ ستون هماهنگ شد');
ok(!B.includes('{fa(r.c.units)}'), 'نوع ب: سلول «واحد» حذف شد');
ok(B.includes('totalTheoryUnits') && B.includes('totalPracticalUnits'), 'نوع ب: جمع واحدها نظری/عملی شد');

ok(CSS.includes('.tr-fin-root .tr-fin-row { grid-template-columns: minmax(0, 1fr) !important;'), 'چاپ A4: یک کارت تمامعرض');
ok(A.includes('i += 1') && A.includes('grid-cols-1') && !A.includes('sm:grid-cols-2'), 'نوع الف: DOM هم یک کارت تمامعرض در هر ردیف (صفحه و چاپ یکسان)');
ok(!/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(CSS), 'چاپ: قاعدهٔ ۲کارتۀ قدیمی حذف شد');
ok(CSS.includes('.tr-mali-code, .tr-flat-root .tr-mali-code { display: inline !important;'), 'چاپ: کد نوع درس مالی پنهان نمیشود');
ok(CSS.includes('.tr-fin-root .tr-term-meta'), 'چاپ: سربرگ ترم استایل گرفت');

ok(TT.includes('uPriceCode: tuition_term_tariff.uPriceCode') && TT.includes('groupVotes'), 'لایهٔ تعرفه: کد گروه خوانده میشود');
ok(TC.includes('tariffGroupCode') && TC.includes('computeTariffCourseLinesForTerms(studentId, ids, tariffMeta)'), 'لایهٔ ریز دروس: کد گروه عبور داده میشود');
ok(ADMIN.includes('tariffGroupCode') && STU.includes('tariffGroupCode') && API.includes('tariffGroupCode'), 'ادمین / دانشجو / صورتحساب: کد گروه تحویل شد');

console.log('\n── نام نیمسال و قانون معادلسازی ──');
ok(termTypeFromDigit(1) === 'NORMAL' && termTypeFromDigit(2) === 'NORMAL', 'رقم آخر ۱ و ۲ → نیمسال عادی');
ok(termTypeFromDigit(3) === 'SUMMER', 'رقم آخر ۳ → نیمسال تابستان');
ok([0, 4, 5, 6, 7, 8, 9].every((d) => termTypeFromDigit(d) === 'EQUIVALENCE'), 'هر رقم آخری جز ۱/۲/۳ → نیمسال معادلسازی');
ok(normalizeTermCode('14044')?.termType === 'EQUIVALENCE', 'نمونهٔ کاربر: کد 14044 → نیمسال معادلسازی');
ok(A.includes('t.statusTitle ||') && B.includes('t.statusTitle ||'), 'وضع نیمسال (عادی / مرخصی با احتساب سنوات / …) دستنخورده چاپ میشود');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

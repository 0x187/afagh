/**
 * ═══════════════════════════════════════════════════════════════════════
 *  «بیتس» سما در کارنامهٔ مالی — تخفیف است، نه پرداخت
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  سما ستون‌های `TermAms.Fix_Bates` / `Units_Bates` / `Mab_Bates` را داشت و
 *  فرمولش `TermAcc = TermPays − (fix + units + bates) + adjust` بود؛ یعنی
 *  «بیتس» یک **تخفیف/کسر** از شهریه است (رتبهٔ علمی، ایثارگری، …). هنگام
 *  مهاجرت، همین مبلغ به‌صورت ردیفِ `TUITION_BATES` در `student_ledger` درج شد.
 *
 *  چون `TUITION_BATES` در واژگان کانونی از نوع «اعتبار» است، موتور کارنامه
 *  آن را زیرِ شاخهٔ «پرداخت» می‌انداخت و سند رسمی یک تخفیف را «واریز دانشجو»
 *  نشان می‌داد. این تست همان را قفل می‌کند:
 *
 *   ۱) ردیف بیتس باید رویدادِ `DISCOUNT` بسازد، نه `PAYMENT`.
 *   ۲) ماندهٔ ترم نباید تغییر کند (هر دو از بدهی کم می‌شوند).
 *   ۳) «پرداخت» ترم فقط واریز واقعی باشد.
 *   ۴) تخفیفِ دفتری در ستون «تخفیف» جمع شود.
 */

import { buildTranscript, ledgerCreditLabel, LEDGER_DISCOUNT_TYPES } from '@/lib/finance-rules/statement';

let pass = 0;
let fail = 0;
const t = (name: string, fn: () => unknown): void => {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}\n     ${(e as Error).message}`); }
};
const eq = (a: unknown, b: unknown, msg = ''): void => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} انتظار ${JSON.stringify(b)} ولی ${JSON.stringify(a)}`);
};

const ledger = (type: string, amount: number, description: string | null = null) => ({
  id: 0, termId: 7, transactionType: type, amount, description, createdAt: null,
});

console.log('\n── برچسب و واژگان ──');

t('بیتس برچسب «تخفیف» می‌گیرد، نه «شهریهٔ قدیمی»', () => {
  eq(ledgerCreditLabel('TUITION_BATES', 'بیتس شهریهٔ قدیمی (TermAms id=143222)'), 'تخفیف بیتس (سما)');
});

t('انواع تخفیفِ دفتری در فهرست قفل‌شده‌اند', () => {
  for (const x of ['TUITION_BATES', 'DISCOUNT_FIXED', 'DISCOUNT_VARIABLE', 'SUBJECT_DEDUCTIVE', 'TUITION_ADJUST_INC']) {
    if (!LEDGER_DISCOUNT_TYPES.has(x)) throw new Error(`${x} در فهرست نیست`);
  }
  if (LEDGER_DISCOUNT_TYPES.has('PAYMENT')) throw new Error('PAYMENT نباید تخفیف شمرده شود');
});

console.log('\n── کارنامه ──');

const TERM = {
  ledger: [
    ledger('TUITION_FIXED', 10_000_000, 'شهریه ثابت'),
    ledger('TUITION_VARIABLE', 5_000_000, 'شهریه متغیر'),
    ledger('TUITION_BATES', 3_000_000, 'بیتس شهریهٔ قدیمی (TermAms id=143222)'),
    ledger('PAYMENT', 8_000_000, 'واریز نقدی'),
  ],
  termTitles: { 7: 'نیمسال اول ۱۴۰۴-۱۴۰۵' },
  termCodes: { 7: '14041' },
};

t('بیتس رویداد تخفیف می‌سازد و «پرداخت» را بالا نمی‌برد', () => {
  const [s] = buildTranscript(TERM);
  const bates = s.events.filter((e) => e.label.includes('بیتس'));
  eq(bates.length, 1, 'رویداد بیتس:');
  eq(bates[0].kind, 'DISCOUNT');
  eq(bates[0].sign, 1);
  eq(s.payments, 8_000_000, 'پرداخت واقعی:');
});

t('مانده با قبل یکسان است (بیتس از بدهی کم می‌شود)', () => {
  const [s] = buildTranscript(TERM);
  // ۱۵٬۰۰۰٬۰۰۰ بدهی − ۳٬۰۰۰٬۰۰۰ تخفیف − ۸٬۰۰۰٬۰۰۰ پرداخت
  eq(s.netPayable, 12_000_000, 'خالص:');
  eq(s.balance, 4_000_000, 'مانده:');
});

t('تخفیفِ دفتری در ستون «تخفیف» جمع می‌شود', () => {
  const [s] = buildTranscript(TERM);
  eq(s.discounts, 3_000_000);
});

t('شهریهٔ ثابت و متغیر تفکیک می‌شوند', () => {
  const [s] = buildTranscript(TERM);
  eq(s.tuitionFixed, 10_000_000);
  eq(s.tuitionVariable, 5_000_000);
});

t('تعدیل افزایشی سما هم تخفیف است', () => {
  const [s] = buildTranscript({
    ledger: [ledger('TUITION_FIXED', 5_000_000), ledger('TUITION_ADJUST_INC', 500_000, null)],
    termTitles: { 7: 'x' }, termCodes: { 7: '14041' },
  });
  eq(s.discounts, 500_000);
  eq(s.payments, 0);
  eq(s.balance, 4_500_000);
});

t('پوشش بنیادِ دفتری در ستون «پوشش» می‌رود نه «پرداخت»', () => {
  const [s] = buildTranscript({
    ledger: [ledger('TUITION_FIXED', 5_000_000), ledger('SPONSORSHIP', 1_000_000, 'پوشش بنیاد')],
    termTitles: { 7: 'x' }, termCodes: { 7: '14041' },
  });
  eq(s.sponsorships, 1_000_000);
  eq(s.payments, 0);
  eq(s.balance, 4_000_000);
});

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} موفق، ${fail} ناموفق\n`);
if (fail > 0) process.exitCode = 1;

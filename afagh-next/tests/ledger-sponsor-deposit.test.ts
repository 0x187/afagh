/**
 * ═══════════════════════════════════════════════════════════════════════
 *  واریزی که پرداخت‌کننده‌اش شخص ثالث است — «پوشش بنیاد» یا «وام»، نه پرداخت
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  سما مبلغِ بنیاد/سازمان دولتی را در `TermAms.TermPays` می‌آورد؛ یعنی از
 *  نظر تراز، «واریز» است و مانده را درست می‌سازد. ولی `StdPays` نوعِ واریز
 *  را «سهم بنياد يا سازمان دولتي» ثبت می‌کند. موتور کارنامه همهٔ ردیف‌های
 *  اعتباری را «پرداخت» می‌شمرد و نتیجه این می‌شد که در سندِ چاپی:
 *
 *      پرداخت: ۱۲۹٬۹۰۱٬۷۲۵        ← درست
 *      پوشش بنیاد: ۰               ← تناقض آشکار
 *
 *  (کاربر دقیقاً همین را گزارش کرد.) این تست قفل می‌کند:
 *
 *   ۱) واریزِ بنیاد رویدادِ `SPONSOR` بسازد، نه `PAYMENT`.
 *   ۲) مانده **مطلقاً** تغییر نکند — جابه‌جایی بین «خالص» و «مانده» است.
 *   ۳) مستندسازتِ فیش/پرداخت‌کننده حفظ شود (پول واقعی است).
 *   ۴) اگر پوشش از شهریهٔ ترم بیشتر باشد، سقف نخورد (بستانکاری نپرد).
 *   ۵) واریزِ وام تحصیلی به ردیف «وام» برود.
 *   ۶) واریز نقدیِ معمولی همچنان «پرداخت» بماند.
 */

import {
  buildTranscript,
  isSponsorDeposit,
  isCharityDeposit,
  isLoanDeposit,
  ledgerCreditLabel,
  transcriptTotals,
} from '@/lib/finance-rules/statement';

let pass = 0;
let fail = 0;
const t = (name: string, fn: () => unknown): void => {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}\n     ${(e as Error).message}`); }
};
const eq = (a: unknown, b: unknown, msg = ''): void => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} انتظار ${JSON.stringify(b)} ولی ${JSON.stringify(a)}`);
};

type Extra = {
  depositType?: string | null;
  receiptNo?: string | null;
  payerName?: string | null;
  depositDate?: string | null;
  /** دلیل تخفیف (از سما: PercentBates.Rem / Mab_Bates.Rem) */
  legacyRem?: string | null;
};

const ledger = (type: string, amount: number, extra: Extra = {}, description: string | null = null) => ({
  id: 0, termId: 7, transactionType: type, amount, description, createdAt: null, ...extra,
});

console.log('\n── تشخیص نوع واریز ──');

t('«سهم بنياد يا سازمان دولتي» (ي عربی) شناسایی می‌شود', () => {
  eq(isSponsorDeposit('سهم بنياد يا سازمان دولتي'), true);
});

t('«سهم بنیاد» با ی فارسی هم شناسایی می‌شود', () => {
  eq(isSponsorDeposit('سهم بنیاد'), true);
});

t('«سازمان دولتی» تنها هم کافی است', () => {
  eq(isSponsorDeposit('سازمان دولتي'), true);
});

t('واریز نقدی/کارت‌خوان پوشش نیست', () => {
  for (const d of ['نقدي', 'اينترنتي سامان', 'چک', 'پرداخت آنلاين سامان', '', null]) {
    eq(isSponsorDeposit(d), false, `${d}:`);
  }
});

t('«وام تحصيلي» وام شمرده می‌شود، پوشش نه', () => {
  eq(isLoanDeposit('وام تحصيلي'), true);
  eq(isLoanDeposit('وام تحصیلی'), true);
  eq(isSponsorDeposit('وام تحصيلي'), false);
  eq(isLoanDeposit('نقدي'), false);
});

t('«صندوق خيريه» پوشش خیرین است، نه بنیاد و نه پرداخت', () => {
  eq(isCharityDeposit('صندوق خيريه'), true);
  eq(isCharityDeposit('صندوق خیریه'), true);
  eq(isSponsorDeposit('صندوق خيريه'), false);
  eq(isCharityDeposit('سهم بنياد يا سازمان دولتي'), false);
});

console.log('\n── موردِ واقعی: دانشجو ۴۰۳۱۳۸۶۰۲۸ / ترم ۱۴۰۳۱ ──');

/**
 * دادهٔ واقعی از سما (TermAms): Fix_Price 38,274,301 + Units_Price 91,627,424
 * = 129,901,725 و همان مبلغ به‌عنوان «سهم بنياد يا سازمان دولتي» واریز شده،
 * با فیش 40200328874 و پرداخت‌کنندهٔ «خيراللهي-رقيه». TermAcc سما = 0.
 */
const REAL = {
  ledger: [
    ledger('TUITION_FIXED', 38_274_301, {}, 'شهریه ثابت (TermAms id=172675)'),
    ledger('TUITION_VARIABLE', 91_627_424, {}, 'شهریه متغیر (TermAms id=172675)'),
    ledger('PAYMENT', 129_901_725, {
      depositType: 'سهم بنياد يا سازمان دولتي',
      receiptNo: '40200328874',
      payerName: 'خيراللهي-رقيه',
      depositDate: '2025-12-01T00:00:00Z',
    }, 'پرداخت از سيستم قديمي — فيش 40200328874 (سهم بنياد يا سازمان دولتي)'),
  ],
  termTitles: { 7: 'نیمسال اول ۱۴۰۳-۱۴۰۴' },
  termCodes: { 7: '14031' },
};

t('واریزِ بنیاد در ستون «پوشش» می‌نشیند، نه «پرداخت»', () => {
  const [s] = buildTranscript(REAL);
  eq(s.sponsorships, 129_901_725, 'پوشش:');
  eq(s.payments, 0, 'پرداخت:');
  eq(s.sponsorshipsFromDeposits, 129_901_725, 'سهم واریزی:');
});

t('ماندهٔ ترم صفر می‌ماند (همان TermAcc سما)', () => {
  const [s] = buildTranscript(REAL);
  eq(s.netPayable, 0, 'خالص:');
  eq(s.balance, 0, 'مانده:');
});

t('رویداد با نوع SPONSOR ساخته می‌شود ولی فیش و پرداخت‌کننده حفظ می‌شود', () => {
  const [s] = buildTranscript(REAL);
  const ev = s.events.find((e) => e.amount === 129_901_725 && e.kind !== 'CHARGE');
  if (!ev) throw new Error('رویداد پیدا نشد');
  eq(ev.kind, 'SPONSOR');
  eq(ev.receiptNo, '40200328874', 'فیش:');
  eq(ev.payerName, 'خيراللهي-رقيه', 'پرداخت‌کننده:');
  eq(ev.depositType, 'سهم بنياد يا سازمان دولتي', 'نوع واریز:');
  eq(ev.datedByDeposit, true, 'تاریخ واریز:');
});

t('جمع کل هم پوشش را نشان می‌دهد و پرداخت را صفر', () => {
  const totals = transcriptTotals(buildTranscript(REAL));
  eq(totals.sponsorships, 129_901_725);
  eq(totals.sponsorshipsFromDeposits, 129_901_725);
  eq(totals.payments, 0);
  eq(totals.balance, 0);
});

console.log('\n── سقف و لبه‌ها ──');

t('پوششِ واریزی بیش از شهریه سقف نمی‌خورد (بستانکاری حفظ می‌شود)', () => {
  const [s] = buildTranscript({
    ledger: [
      ledger('TUITION_FIXED', 10_000_000),
      ledger('PAYMENT', 15_000_000, { depositType: 'سهم بنياد يا سازمان دولتي' }),
    ],
    termTitles: { 7: 'x' }, termCodes: { 7: '14041' },
  });
  // همان نتیجهٔ پیش از تفکیک: ۱۰م بدهی − ۱۵م واریز = ۵م بستانکار
  eq(s.sponsorships, 15_000_000);
  eq(s.netPayable, -5_000_000);
  eq(s.balance, -5_000_000);
});

t('پوششِ جدولی همچنان سقف می‌خورد (رفتار قبلی دست‌نخورده)', () => {
  const [s] = buildTranscript({
    ledger: [ledger('TUITION_FIXED', 10_000_000)],
    sponsorships: [{ id: 1, title: 'کمیته امداد', amount: 40_000_000 }],
    termTitles: { 7: 'x' }, termCodes: { 7: '14041' },
  });
  eq(s.sponsorships, 10_000_000, 'سقف‌خورده:');
  eq(s.netPayable, 0);
});

t('واریزِ وام تحصیلی به ردیف «وام» می‌رود و مانده ثابت می‌ماند', () => {
  const [s] = buildTranscript({
    ledger: [
      ledger('TUITION_FIXED', 100_000_000),
      ledger('PAYMENT', 50_000_000, { depositType: 'وام تحصيلي' }),
    ],
    termTitles: { 7: 'x' }, termCodes: { 7: '14041' },
  });
  eq(s.loans, 50_000_000, 'وام:');
  eq(s.payments, 0, 'پرداخت:');
  eq(s.balance, 50_000_000, 'مانده:');
});

t('واریز نقدی همچنان «پرداخت» می‌ماند', () => {
  const [s] = buildTranscript({
    ledger: [
      ledger('TUITION_FIXED', 10_000_000),
      ledger('PAYMENT', 4_000_000, { depositType: 'نقدي' }),
    ],
    termTitles: { 7: 'x' }, termCodes: { 7: '14041' },
  });
  eq(s.payments, 4_000_000);
  eq(s.sponsorships, 0);
  eq(s.loans, 0);
  eq(s.balance, 6_000_000);
});

t('ترکیب پرداخت نقدی + پوشش بنیاد + وام، همه جدا و مانده درست', () => {
  const [s] = buildTranscript({
    ledger: [
      ledger('TUITION_FIXED', 100_000_000),
      ledger('PAYMENT', 40_000_000, { depositType: 'سهم بنياد يا سازمان دولتي' }),
      ledger('PAYMENT', 20_000_000, { depositType: 'نقدي' }),
      ledger('PAYMENT', 10_000_000, { depositType: 'وام تحصيلي' }),
    ],
    termTitles: { 7: 'x' }, termCodes: { 7: '14041' },
  });
  eq(s.sponsorships, 40_000_000);
  eq(s.payments, 20_000_000);
  eq(s.loans, 10_000_000);
  // ۱۰۰ − ۴۰ پوشش = ۶۰ خالص − ۲۰ نقد − ۱۰ وام = ۳۰ مانده
  eq(s.netPayable, 60_000_000);
  eq(s.balance, 30_000_000);
});

console.log('\n── صندوق خیریه با برچسب مستقل ──');

t('واریز صندوق خیریه در «پوشش خیرین» می‌نشیند', () => {
  const [s] = buildTranscript({
    ledger: [
      ledger('TUITION_FIXED', 20_000_000),
      ledger('PAYMENT', 5_000_000, { depositType: 'صندوق خيريه' }),
    ],
    termTitles: { 7: 'x' }, termCodes: { 7: '14041' },
  });
  eq(s.charityCoverage, 5_000_000, 'خیرین:');
  eq(s.sponsorships, 5_000_000, 'جمع پوشش:');
  eq(s.sponsorshipsFromDeposits, 0, 'سهم بنیاد:');
  eq(s.payments, 0, 'پرداخت:');
  eq(s.balance, 15_000_000, 'مانده:');
});

t('رویداد خیریه نوع CHARITY می‌گیرد و فیشش می‌ماند', () => {
  const [s] = buildTranscript({
    ledger: [
      ledger('TUITION_FIXED', 20_000_000),
      ledger('PAYMENT', 5_000_000, {
        depositType: 'صندوق خيريه', receiptNo: '123456', payerName: 'موسسه خيريه',
      }),
    ],
    termTitles: { 7: 'x' }, termCodes: { 7: '14041' },
  });
  const ev = s.events.find((e) => e.kind === 'CHARITY');
  if (!ev) throw new Error('رویداد CHARITY پیدا نشد');
  eq(ev.receiptNo, '123456');
  eq(ev.amount, 5_000_000);
});

t('بنیاد و خیرین در یک ترم جدا جمع می‌شوند', () => {
  const [s] = buildTranscript({
    ledger: [
      ledger('TUITION_FIXED', 50_000_000),
      ledger('PAYMENT', 30_000_000, { depositType: 'سهم بنياد يا سازمان دولتي' }),
      ledger('PAYMENT', 5_000_000, { depositType: 'صندوق خيريه' }),
    ],
    termTitles: { 7: 'x' }, termCodes: { 7: '14041' },
  });
  eq(s.sponsorshipsFromDeposits, 30_000_000);
  eq(s.charityCoverage, 5_000_000);
  eq(s.sponsorships, 35_000_000, 'جمع پوشش:');
  eq(s.balance, 15_000_000, 'مانده:');
  // نمایش: پوشش بنیاد = sponsorships − charity
  eq(s.sponsorships - (s.charityCoverage ?? 0), 30_000_000);
});

console.log('\n── دلیل تخفیف در برچسب ──');

t('دلیل تخفیف به برچسب بیتس می‌چسبد', () => {
  eq(
    ledgerCreditLabel('TUITION_BATES', 'تخفیف بیتس (سما)', 'رياست'),
    'تخفیف بیتس (سما) — رياست',
  );
});

t('بدون دلیل، برچسب دست‌نخورده می‌ماند', () => {
  eq(ledgerCreditLabel('TUITION_BATES', null, null), 'تخفیف بیتس (سما)');
  eq(ledgerCreditLabel('TUITION_BATES', null, ''), 'تخفیف بیتس (سما)');
  // «0» در سما یعنی «دلیلی ثبت نشده» — نباید چاپ شود
  eq(ledgerCreditLabel('TUITION_BATES', null, '0'), 'تخفیف بیتس (سما)');
});

t('دلیل در رویداد تخفیف کارنامه دیده می‌شود', () => {
  const [s] = buildTranscript({
    ledger: [
      ledger('TUITION_FIXED', 10_000_000),
      ledger('TUITION_BATES', 3_000_000, { legacyRem: 'ايثارگري' }),
    ],
    termTitles: { 7: 'x' }, termCodes: { 7: '14041' },
  });
  const ev = s.events.find((e) => e.kind === 'DISCOUNT');
  if (!ev) throw new Error('رویداد تخفیف پیدا نشد');
  eq(ev.label, 'تخفیف بیتس (سما) — ايثارگري');
});

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} موفق، ${fail} ناموفق\n`);
if (fail > 0) process.exitCode = 1;
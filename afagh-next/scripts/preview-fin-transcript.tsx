/**
 * پیش‌نمایشِ طراحیِ کارنامهٔ مالی — بدون دیتابیس و بدون اجرای اپ.
 *
 * کاربرد:
 *   npx tsx scripts/preview-fin-transcript.tsx out.html
 *
 * کامپوننت واقعی `FinancialTranscript` را با دادهٔ نمونه به HTML استاتیک
 * می‌ریزد و CSS کامپایل‌شدهٔ Tailwind (شامل قواعد چاپ globals.css) را
 * داخلش تزریق می‌کند تا در مرورگر دقیقاً همان‌طور دیده شود که در اپ
 * رندر می‌شود. برای «تأییدِ طراحی پیش از build» است؛ در بیلد نهایی
 * نقشی ندارد و نباید در tsconfig بیلد مزاحم شود (tsc --noEmit فقط
 * تایپ‌چک می‌کند و این فایل تمیز تایپ‌شده است).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, writeFileSync } from 'node:fs';
import FinancialTranscript, {
  type TranscriptStudentView,
  type TranscriptTermView,
  type TranscriptTotalsView,
  type TranscriptChequeView,
  type TranscriptLoanView,
  type TranscriptEventView,
} from '@/components/FinancialTranscript';
import FinancialTranscriptFlat from '@/components/FinancialTranscriptFlat';
import FinanceVerifyBlock from '@/components/FinanceVerifyBlock';

/* ── دادهٔ نمونه ─────────────────────────────────────────────────── */

const R = (n: number) => n; // مبالغ به ریال

const student: TranscriptStudentView = {
  fullName: 'علی محمدی',
  studentCode: '40112345',
  nationalCode: '0079458213',
  majorTitle: 'مهندسی کامپیوتر',
  degreeTitle: 'کارشناسی',
  facultyTitle: 'دانشکدهٔ فنی و مهندسی',
  quotaType: 'NORMAL',
  courseType: 'روزانه',
  admissionMethod: 'آزمون سراسری',
  status: 'ACTIVE',
  entryYear: 1403,
  entryTerm: 1,
  entryDate: '2024-09-21',
  settlementDate: null,
  birthCertNo: '12045',
  birthDate: '2005-06-21',
  documentNo: '۱۴۰۵/مالی/۲۳۱',
  photoUrl: null,
  originUniversityTitle: null,
};

const coursesT1: TranscriptTermView['courses'] = [
  { courseCode: 'CE101', courseTitle: 'مبانی برنامه‌سازی', units: 3, perUnit: 0, amount: R(36_000_000), grade: 18.5, courseNature: 'نظری', maliType: 1, offeringType: 'THEORY', theoreticalUnits: 3, practicalUnits: 0 },
  { courseCode: 'MA101', courseTitle: 'ریاضیات عمومی ۱', units: 3, perUnit: 0, amount: R(36_000_000), grade: 15.25, courseNature: 'نظری', maliType: 2, offeringType: 'THEORY', theoreticalUnits: 3, practicalUnits: 0 },
  { courseCode: 'PH101', courseTitle: 'فیزیک عمومی ۱', units: 3, perUnit: 0, amount: R(39_600_000), grade: 12, courseNature: 'نظری', maliType: 3, offeringType: 'THEORY', theoreticalUnits: 3, practicalUnits: 0 },
  { courseCode: 'CE102', courseTitle: 'کارگاه کامپیوتر', units: 1, perUnit: 0, amount: R(28_800_000), grade: 20, courseNature: 'عملی', maliType: 4, offeringType: 'PRACTICAL', theoreticalUnits: 0, practicalUnits: 1 },
  { courseCode: 'GE101', courseTitle: 'تربیت بدنی عمومی', units: 1, perUnit: 0, amount: R(0), grade: null, courseNature: 'عملی', maliType: null, offeringType: 'PRACTICAL', theoreticalUnits: 0, practicalUnits: 1 },
];

const ev = (e: Partial<TranscriptEventView> & Pick<TranscriptEventView, 'kind' | 'label' | 'amount' | 'sign'>): TranscriptEventView => ({
  kind: e.kind, label: e.label, amount: e.amount, sign: e.sign,
  dateMs: e.dateMs ?? new Date('2024-11-05').getTime(),
  depositType: e.depositType ?? null,
  payerName: e.payerName ?? null,
  receiptNo: e.receiptNo ?? null,
  accountNo: e.accountNo ?? null,
  bankName: e.bankName ?? null,
  legacyRem: e.legacyRem ?? null,
});

const terms: TranscriptTermView[] = [
  {
    termId: 101, termTitle: 'نیمسال اول ۱۴۰۴-۱۴۰۵', termCode: '14041', statusTitle: 'در حال تحصیل',
    charges: R(428_000_000), tuitionFixed: R(96_000_000), tuitionVariable: R(332_000_000),
    discounts: R(42_800_000), sponsorships: R(80_000_000), sponsorshipsFromDeposits: R(50_000_000), charityCoverage: R(30_000_000),
    netPayable: R(305_200_000), payments: R(150_000_000),
    chequesCleared: R(80_000_000), chequesPending: R(40_000_000), chequesBounced: 0, loans: 0,
    balance: R(35_200_000),
    events: [
      ev({ kind: 'CHARGE', label: 'بدهی شهریهٔ ترم', amount: R(428_000_000), sign: -1 }),
      ev({ kind: 'DISCOUNT', label: 'تخفیف خادمین (۱۰٪)', amount: R(42_800_000), sign: 1 }),
      ev({ kind: 'SPONSOR', label: 'پوشش بنیاد امور دانشجویان', amount: R(50_000_000), sign: 1, depositType: 'واریز سازمانی' }),
      ev({ kind: 'CHARITY', label: 'پوشش خیرین (صندوق خیریه)', amount: R(30_000_000), sign: 1 }),
      ev({ kind: 'PAYMENT', label: 'پرداخت نقدی', amount: R(90_000_000), sign: 1, depositType: 'نقدی', payerName: 'علی محمدی', receiptNo: '۲۴۵۷۱', accountNo: 'IR820540102680020817909002', bankName: 'ملت', legacyRem: 'قسط اول شهریه نیمسال اول' }),
      ev({ kind: 'PAYMENT', label: 'پرداخت کارت‌خوان', amount: R(60_000_000), sign: 1, depositType: 'کارت‌خوان سامان', payerName: 'رضا محمدی (پدر)', receiptNo: '۲۴۶۱۲', cardNo: '6219-8610-****-4527' }),
      ev({ kind: 'CHEQUE', label: 'چک وصول‌شده', amount: R(80_000_000), sign: 1, depositType: 'چک' }),
    ],
    courses: coursesT1,
    coursesBasis: 'TARIFF',
  },
  {
    termId: 102, termTitle: 'نیمسال دوم ۱۴۰۴-۱۴۰۵', termCode: '14042', statusTitle: 'در حال تحصیل',
    charges: R(452_000_000), tuitionFixed: R(96_000_000), tuitionVariable: R(356_000_000),
    discounts: R(45_200_000), sponsorships: R(60_000_000),
    netPayable: R(346_800_000), payments: R(120_000_000),
    chequesCleared: R(40_000_000), chequesPending: R(60_000_000), chequesBounced: 0, loans: R(50_000_000),
    balance: R(76_800_000),
    events: [
      ev({ kind: 'CHARGE', label: 'بدهی شهریهٔ ترم', amount: R(452_000_000), sign: -1 }),
      ev({ kind: 'DISCOUNT', label: 'تخفیف خادمین (۱۰٪)', amount: R(45_200_000), sign: 1 }),
      ev({ kind: 'SPONSOR', label: 'پوشش بنیاد امور دانشجویان', amount: R(60_000_000), sign: 1, depositType: 'واریز سازمانی' }),
      ev({ kind: 'LOAN', label: 'وام صندوق رفاه', amount: R(50_000_000), sign: 1 }),
      ev({ kind: 'PAYMENT', label: 'پرداخت نقدی', amount: R(120_000_000), sign: 1, depositType: 'نقدی', payerName: 'علی محمدی', receiptNo: '۲۵۱۸۴', accountNo: 'IR820540102680020817909002', bankName: 'ملت', legacyRem: 'قسط اول شهریه نیمسال دوم' }),
      ev({ kind: 'CHEQUE', label: 'چک وصول‌شده', amount: R(40_000_000), sign: 1, depositType: 'چک' }),
    ],
    courses: [
      { courseCode: 'CE201', courseTitle: 'برنامه‌سازی پیشرفته', units: 3, perUnit: 0, amount: R(38_400_000), grade: null, courseNature: 'نظری', maliType: 1, offeringType: 'THEORY', theoreticalUnits: 3, practicalUnits: 0 },
      { courseCode: 'CE202', courseTitle: 'مدارهای منطقی', units: 3, perUnit: 0, amount: R(38_400_000), grade: null, courseNature: 'نظری', maliType: 1, offeringType: 'THEORY', theoreticalUnits: 2, practicalUnits: 1 },
      { courseCode: 'MA201', courseTitle: 'معادلات دیفرانسیل', units: 3, perUnit: 0, amount: R(36_000_000), grade: null, courseNature: 'نظری', maliType: 2, offeringType: 'THEORY', theoreticalUnits: 3, practicalUnits: 0 },
      { courseCode: 'CE203', courseTitle: 'آزمایشگاه مدارهای منطقی', units: 1, perUnit: 0, amount: R(30_000_000), grade: null, courseNature: 'عملی', maliType: 4, offeringType: 'PRACTICAL', theoreticalUnits: 0, practicalUnits: 1 },
    ],
    coursesBasis: 'TARIFF',
  },
];

const totals: TranscriptTotalsView = {
  charges: R(880_000_000),
  discounts: R(88_000_000),
  sponsorships: R(140_000_000),
  sponsorshipsFromDeposits: R(110_000_000),
  charityCoverage: R(30_000_000),
  payments: R(270_000_000),
  chequesCleared: R(120_000_000),
  chequesPending: R(100_000_000),
  chequesBounced: 0,
  loans: R(50_000_000),
  balance: R(112_000_000),
};

const cheques: TranscriptChequeView[] = [
  { id: 1, chequeNo: '۷۷۱۴۵۲', bankName: 'ملت', amount: R(40_000_000), dueDate: '2025-02-20', status: 'وصول‌شده' },
  { id: 2, chequeNo: '۷۷۱۴۵۳', bankName: 'ملت', amount: R(60_000_000), dueDate: '2025-04-20', status: 'در جریان' },
];

const loans: TranscriptLoanView[] = [
  { id: 1, productTitle: 'وام شهریه', lender: 'صندوق رفاه دانشجویان', amount: R(50_000_000), installments: 12, status: 'فعال' },
];

/* ── QR استعلام (واقعی اگر بستهٔ qrcode نصب باشد، وگرنه جای‌نگهدار) ── */

async function buildVerifyBlock() {
  const url = 'https://afagh.ac.ir/verify/finance/DEMO-SAMPLE-1405-0231';
  let qrSvg = '';
  try {
    const mod = await import('qrcode');
    qrSvg = await (mod.default ?? mod).toString(url, { type: 'svg', margin: 0, width: 160 });
  } catch {
    qrSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160"><rect width="160" height="160" fill="#fff"/><g fill="#000"><rect x="16" y="16" width="48" height="48"/><rect x="96" y="16" width="48" height="48"/><rect x="16" y="96" width="48" height="48"/><rect x="80" y="80" width="16" height="16"/><rect x="112" y="96" width="16" height="16"/><rect x="96" y="128" width="32" height="16"/></g><g fill="#fff"><rect x="28" y="28" width="24" height="24"/><rect x="108" y="28" width="24" height="24"/><rect x="28" y="108" width="24" height="24"/></g></svg>';
  }
  return createElement(FinanceVerifyBlock, { url, qr: qrSvg, expiresAt: '2026-11-27' });
}

/* ── مونتاژ سند HTML ─────────────────────────────────────────────── */

async function main() {
  const outCards = process.argv[2] || 'preview-fin-transcript.html';
  const outFlat = process.argv[3] || 'preview-fin-transcript-flat.html';
  const css = readFileSync('.preview-fin/tw.css', 'utf8');
  const verifyBlock = await buildVerifyBlock();

  const props = {
    student, terms, totals,
    universityTitle: 'دانشگاه آفاق',
    logoUrl: null,
    issuedAt: '۱۴۰۵/۰۸/۰۵',
    scopeLabel: 'جمع کل دوره',
    showEvents: true,
    viewerRole: 'FINANCE' as const,
    cheques, loans,
    verifyBlock,
  };

  const docCards = renderToStaticMarkup(createElement(FinancialTranscript, props));
  const docFlat = renderToStaticMarkup(createElement(FinancialTranscriptFlat, props));

  const page = (doc: string, title: string) => `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${css}</style>
<style>
  body { background: #cbd5e1; padding: 14px; font-family: Vazirmatn, Tahoma, sans-serif; }
  .transcript-print-area { max-width: 210mm; margin: 0 auto; }
  @media print { body { background: #fff; padding: 0; } .transcript-print-area { max-width: none; } }
</style>
</head>
<body>
${doc}
</body>
</html>`;

  writeFileSync(outCards, page(docCards, 'نمونهٔ کارنامهٔ مالی — مدل کارتی (اصلی)'), 'utf8');
  writeFileSync(outFlat, page(docFlat, 'نمونهٔ کارنامهٔ مالی — مدل تخت (مدل دوم)'), 'utf8');
  console.log(`written: ${outCards} (${(docCards.length / 1024).toFixed(0)} KB) / ${outFlat} (${(docFlat.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });

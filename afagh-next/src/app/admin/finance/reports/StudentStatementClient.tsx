'use client';

import { useState, useEffect } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title, LineElement, PointElement } from 'chart.js';
import { saveAs } from 'file-saver';
import FinancialTranscript from '@/components/FinancialTranscript';
import { doPrintTranscript } from '@/components/print-transcript';
import FinanceVerifyBlock from '@/components/FinanceVerifyBlock';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title, LineElement, PointElement);

const fa = (n: number) => Number(n || 0).toLocaleString('fa-IR');

interface StatementRow {
  termId: number;
  termCode: string;
  termTitle: string;
  /** وضعیت نیمسال دانشجو (در حال تحصیل / مرخصی / مهمان / انصراف / …) — می‌تواند تهی باشد */
  statusTitle?: string | null;
  tuitionFixed: number;
  tuitionVariable: number;
  discountFixed: number;
  discountVariable: number;
  subjectAdditive: number;
  subjectDeductive: number;
  sponsorship: number;
  payments: number;
  posPayments: number;
  loans: number;
  balance: number;
  // اعداد کانونی کارنامه (از API صورت‌حساب — برابر با getStudentFinance)
  charges: number;
  discounts: number;
  sponsorships: number;
  /** بخشی از پوشش که از واریزِ واقعیِ بنیاد/سازمان دولتی آمده است */
  sponsorshipsFromDeposits?: number;
  /** پوشش صندوق خیریه (زیرمجموعهٔ پوشش، با برچسب مستقل) */
  charityCoverage?: number;
  canonicalPayments: number;
  chequesCleared: number;
  chequesPending: number;
  chequesBounced: number;
  canonicalLoans: number;
  netPayable: number;
  coursesBasis?: 'TARIFF' | 'LEDGER';
  tariffGroupCode?: string | null;
  courses?: {
    courseCode: string | null;
    courseTitle: string | null;
    units: number;
    perUnit: number;
    amount: number;
    /** نوع درس مالی سما — جای ستون «نرخ واحد» در ریز کارنامه */
    maliType?: number | null;
    offeringType?: string | null;
    grade?: number | null;
    courseNature?: string | null;
    theoreticalUnits?: number;
    practicalUnits?: number;
  }[];
}

interface Props {
  studentId: number;
  studentName: string;
  studentCode: string;
  universityTitle?: string | null;
  logoUrl?: string | null;
  verify?: { url: string; qr: string; expiresAt: string | null } | null;
}

function generateCSV(data: StatementRow[], studentName: string, studentCode: string): string {
  const headers = ['ترم', 'کد ترم', 'شهریه ثابت', 'شهریه متغیر', 'تخفیف ثابت', 'تخفیف متغیر', 'موضوعی افزایشی', 'موضوعی کاهشی', 'پوشش بنیاد', 'پرداخت آنلاین', 'پرداخت POS', 'وام', 'مانده'];
  const rows = data.map(d => [
    d.termTitle, d.termCode, fa(d.tuitionFixed), fa(d.tuitionVariable), fa(d.discountFixed), fa(d.discountVariable),
    fa(d.subjectAdditive), fa(d.subjectDeductive), fa(d.sponsorship), fa(d.payments), fa(d.posPayments), fa(d.loans), fa(d.balance)
  ]);
  const titleRow = [`صورت حساب مالی - ${studentName} (${studentCode})`, '', '', '', '', '', '', '', '', '', '', '', ''];
  const dateRow = [`تاریخ: ${new Date().toLocaleString('fa-IR')}`, '', '', '', '', '', '', '', '', '', '', '', ''];
  return [titleRow, dateRow, headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function generateText(data: StatementRow[], studentName: string, studentCode: string): string {
  const colWidths = [20, 12, 16, 16, 14, 14, 16, 14, 14, 14, 14, 12, 16];
  const headers = ['ترم', 'کد ترم', 'شهریه ثابت', 'شهریه متغیر', 'تخفیف ثابت', 'تخفیف متغیر', 'موضوعی +\nافزایشی', 'موضوعی -\nکاهشی', 'پوشش\nبنیاد', 'پرداخت\nآنلاین', 'پرداخت\nPOS', 'وام', 'مانده'];
  const pad = (s: string, w: number) => s.padEnd(w);
  const headerLine = headers.map((h, i) => pad(h, colWidths[i])).join(' | ');
  const sepLine = colWidths.map(w => '-'.repeat(w)).join('-+-');
  const body = data.map(d => [d.termTitle, d.termCode, fa(d.tuitionFixed), fa(d.tuitionVariable), fa(d.discountFixed), fa(d.discountVariable), fa(d.subjectAdditive), fa(d.subjectDeductive), fa(d.sponsorship), fa(d.payments), fa(d.posPayments), fa(d.loans), fa(d.balance)]
    .map((v, i) => pad(v, colWidths[i])).join(' | ')).join('\n');
  const totals = ['جمع کل', '', fa(data.reduce((s, d) => s + d.tuitionFixed, 0)), fa(data.reduce((s, d) => s + d.tuitionVariable, 0)), fa(data.reduce((s, d) => s + d.discountFixed, 0)), fa(data.reduce((s, d) => s + d.discountVariable, 0)), fa(data.reduce((s, d) => s + d.subjectAdditive, 0)), fa(data.reduce((s, d) => s + d.subjectDeductive, 0)), fa(data.reduce((s, d) => s + d.sponsorship, 0)), fa(data.reduce((s, d) => s + d.payments, 0)), fa(data.reduce((s, d) => s + d.posPayments, 0)), fa(data.reduce((s, d) => s + d.loans, 0)), fa(data.reduce((s, d) => s + d.balance, 0))]
    .map((v, i) => pad(v, colWidths[i])).join(' | ');
  return `صورت حساب مالی - ${studentName} (${studentCode})\nتاریخ: ${new Date().toLocaleString('fa-IR')}\n\n${headerLine}\n${sepLine}\n${body}\n${sepLine}\n${totals}`;
}

/** کارت خلاصهٔ عددی بالای صورت‌حساب */
function SumBox({ icon, label, value, tone, sub }: { icon: string; label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className={`relative rounded-xl border bg-gradient-to-b p-3 pt-4 text-center shadow-sm ${tone}`}>
      <p className="text-lg font-black leading-tight">{value}</p>
      <p className="mt-0.5 text-2xs font-medium opacity-75">{label}</p>
      {sub && <p className="mt-0.5 text-3xs font-bold opacity-90">{sub}</p>}
      <span className="absolute -top-2.5 right-2 text-sm">{icon}</span>
    </div>
  );
}

export default function StudentStatementClient({ studentId, studentName, studentCode, universityTitle, logoUrl, verify }: Props) {
  const [data, setData] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');
  const [exporting, setExporting] = useState<string | null>(null);

  // رنگ‌های نمودار باید با تم زنده بمانند — toggle تم بدون رفرش صفحه انجام می‌شود
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains('dark'));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    fetch(`/api/admin/finance/reports/student-statement?studentId=${studentId}`)
      .then(r => r.json())
      .then(d => { setData(d.rows || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [studentId]);

  // نمودار فقط وقتی ساخته می‌شود که حالت نمودار فعال است؛ تمیزکاری با cleanup
  // (نسخهٔ قبلی با chartInstance در state حلقهٔ destroy/create می‌ساخت)
  useEffect(() => {
    if (viewMode !== 'chart' || !data.length) return;
    const ctx = document.getElementById('balanceChart') as HTMLCanvasElement;
    if (!ctx) return;

    const chart = new ChartJS(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.termCode),
        datasets: [
          { label: 'بدهکاری (شهریه+موضوعی)', data: data.map(d => d.tuitionFixed + d.tuitionVariable + d.subjectAdditive), backgroundColor: 'rgba(239, 68, 68, 0.7)' },
          { label: 'بستانکاری (پرداخت+تخفیف+بنیاد)', data: data.map(d => d.payments + d.posPayments + d.discountFixed + d.discountVariable + d.sponsorship + d.subjectDeductive), backgroundColor: 'rgba(16, 185, 129, 0.7)' },
          { label: 'مانده', data: data.map(d => d.balance), type: 'line', borderColor: 'rgb(59, 130, 246)', backgroundColor: 'rgba(59, 130, 246, 0.1)', yAxisID: 'y1', tension: 0.3, fill: false, pointRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: isDark ? '#e2e8f0' : '#334155', font: { family: 'Vazirmatn, Tahoma' } } },
          title: { display: true, text: 'روند مانده ترم‌به‌ترم', color: isDark ? '#e2e8f0' : '#334155', font: { family: 'Vazirmatn, Tahoma', size: 14 } },
        },
        scales: {
          x: { ticks: { color: isDark ? '#cbd5e1' : '#475569' }, grid: { color: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(100,116,139,0.16)' } },
          y: {
            beginAtZero: true,
            ticks: { color: isDark ? '#cbd5e1' : '#475569', callback: v => fa(Number(v)) },
            grid: { color: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(100,116,139,0.16)' },
          },
          y1: {
            type: 'linear', display: true, position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: isDark ? '#cbd5e1' : '#475569', callback: v => fa(Number(v)) },
          },
        },
      },
    });
    return () => chart.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, viewMode, isDark]);

  const exportCSV = () => {
    setExporting('csv');
    const csv = generateCSV(data, studentName, studentCode);
    const blob = new Blob([new TextEncoder().encode(csv)], { type: 'text/csv;charset=utf-8' });
    saveAs(blob, `statement_${studentCode}_${Date.now()}.csv`);
    setExporting(null);
  };

  const exportText = () => {
    setExporting('txt');
    const txt = generateText(data, studentName, studentCode);
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `statement_${studentCode}_${Date.now()}.txt`);
    setExporting(null);
  };

  /** چاپ: همان منطق کارنامهٔ تحصیلی (کپی ایزولهٔ .transcript-print-area + A4) */
  const printStatement = () => doPrintTranscript('landscape');

  if (loading) return <div className="card p-6 text-center text-slate-500">⏳ در حال بارگذاری صورت حساب...</div>;

  const totals = data.reduce(
    (acc, d) => ({
      charges: acc.charges + (d.charges ?? 0),
      discounts: acc.discounts + (d.discounts ?? 0),
      sponsorships: acc.sponsorships + (d.sponsorships ?? 0),
      payments: acc.payments + (d.canonicalPayments ?? 0),
      chequesCleared: acc.chequesCleared + (d.chequesCleared ?? 0),
      chequesPending: acc.chequesPending + (d.chequesPending ?? 0),
      chequesBounced: acc.chequesBounced + (d.chequesBounced ?? 0),
      loans: acc.loans + (d.canonicalLoans ?? 0),
      balance: acc.balance + (d.balance ?? 0),
    }),
    { charges: 0, discounts: 0, sponsorships: 0, payments: 0, chequesCleared: 0, chequesPending: 0, chequesBounced: 0, loans: 0, balance: 0 },
  );
  const paidTotal = totals.payments + totals.chequesCleared + totals.loans;

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── سربرگ premium ── */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-l from-slate-800 via-indigo-900 to-indigo-700 p-4 text-white shadow-lg print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-black sm:text-lg">📄 صورت‌حساب مالی — {studentName}</h1>
            <p className="mt-1 text-2xs text-indigo-100/90">
              شمارهٔ دانشجویی: <span dir="ltr" className="font-mono">{studentCode}</span> — ۹ مشخصهٔ سما (ثابت/متغیر/پرداختی/تخفیف ثابت/متغیر/موضوعی + و − /بنیاد/وام)
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={printStatement} className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm">
              🖨️ چاپ / PDF رسمی
            </button>
            <button
              onClick={() => setViewMode(v => v === 'table' ? 'chart' : 'table')}
              className="rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20"
            >
              {viewMode === 'table' ? '📊 نمودار روند' : '📊 بستن نمودار'}
            </button>
            <button
              onClick={exportCSV}
              disabled={exporting === 'csv'}
              className="rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20 disabled:opacity-50"
            >
              {exporting === 'csv' ? '⏳…' : '📥 CSV'}
            </button>
            <button
              onClick={exportText}
              disabled={exporting === 'txt'}
              className="rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20 disabled:opacity-50"
            >
              {exporting === 'txt' ? '⏳…' : '📥 متن'}
            </button>
          </div>
        </div>
      </div>

      {/* ── نوار KPI خلاصه ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 print:hidden">
        <SumBox icon="💸" label="جمع شهریه (ریال)" value={fa(totals.charges)} tone="border-rose-200 from-rose-50 to-white text-rose-700" />
        <SumBox icon="🎁" label="تخفیف + پوشش بنیاد (ریال)" value={fa(totals.discounts + totals.sponsorships)} tone="border-violet-200 from-violet-50 to-white text-violet-700" />
        <SumBox icon="💵" label="پرداخت + چک وصولی + وام (ریال)" value={fa(paidTotal)} tone="border-emerald-200 from-emerald-50 to-white text-emerald-700" />
        <SumBox icon="⏳" label="چک در انتظار وصول (ریال)" value={fa(totals.chequesPending)} tone="border-amber-200 from-amber-50 to-white text-amber-700" />
        <SumBox
          icon={totals.balance > 0 ? '🔴' : '🟢'}
          label={totals.balance > 0 ? 'ماندهٔ بدهی (ریال)' : totals.balance < 0 ? 'بستانکاری (ریال)' : 'وضعیت حساب'}
          value={fa(Math.abs(totals.balance))}
          tone={totals.balance > 0 ? 'border-rose-300 from-rose-100 to-white text-rose-800' : 'border-emerald-300 from-emerald-100 to-white text-emerald-800'}
        />
      </div>

      {viewMode === 'chart' && (
        <div className="card print:hidden" style={{ height: 400 }}>
          <canvas id="balanceChart" />
        </div>
      )}

      {/* سند رسمی — همیشه رندر می‌شود تا چاپ از هر حالتی درست خروجی دهد */}
      <div className="print-area">
        <FinancialTranscript
          student={{ fullName: studentName, studentCode }}
          terms={data.map((d) => ({
            termId: d.termId,
            termTitle: d.termTitle,
            statusTitle: d.statusTitle ?? null,
            termCode: d.termCode ?? null,
            charges: d.charges ?? 0,
            // تفکیک شهریه (سما هم ثابت و متغیر را جدا می‌نویسد)
            tuitionFixed: d.tuitionFixed ?? 0,
            tuitionVariable: d.tuitionVariable ?? 0,
            discounts: d.discounts ?? 0,
            sponsorships: d.sponsorships ?? 0,
            sponsorshipsFromDeposits: d.sponsorshipsFromDeposits ?? 0,
            charityCoverage: d.charityCoverage ?? 0,
            netPayable: d.netPayable ?? 0,
            payments: d.canonicalPayments ?? 0,
            chequesCleared: d.chequesCleared ?? 0,
            chequesPending: d.chequesPending ?? 0,
            chequesBounced: d.chequesBounced ?? 0,
            loans: d.canonicalLoans ?? 0,
            balance: d.balance ?? 0,
            events: [],
            courses: d.courses ?? [],
            coursesBasis: d.coursesBasis ?? 'LEDGER',
            tariffGroupCode: d.tariffGroupCode ?? null,
          }))}
          totals={totals}
          showEvents={false}
          viewerRole="FINANCE"
          universityTitle={universityTitle}
          logoUrl={logoUrl}
          verifyBlock={verify ? <FinanceVerifyBlock url={verify.url} qr={verify.qr} expiresAt={verify.expiresAt} /> : undefined}
        />
      </div>
    </div>
  );
}
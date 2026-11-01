import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FileText, Printer, Search, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { FinancialTranscript } from '@/components/FinancialTranscript';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toEnDigits } from '@/lib/fa';
import { doPrintTranscript } from '@/lib/print';
import { getStatementStudents, getStudentStatement, type PickerStudent, type StatementRow } from '@/lib/reports-api';

// ═══ Student statement / financial transcript — port of finance/reports/student-statement ═══

const fa = (n: number | null | undefined) => Number(n || 0).toLocaleString('fa-IR');

const AVATAR_TONES = [
  'from-emerald-500 to-teal-600',
  'from-indigo-500 to-blue-600',
  'from-violet-500 to-purple-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-sky-500 to-cyan-600',
];

type SortKey = 'code' | 'balance' | 'name';

function download(name: string, content: string, type: string) {
  const blob = new Blob([new TextEncoder().encode(content)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function generateCSV(data: StatementRow[], studentName: string, studentCode: string): string {
  const headers = ['ترم', 'کد ترم', 'شهریه ثابت', 'شهریه متغیر', 'تخفیف ثابت', 'تخفیف متغیر', 'موضوعی افزایشی', 'موضوعی کاهشی', 'پوشش بنیاد', 'پرداخت آنلاین', 'پرداخت POS', 'وام', 'مانده'];
  const rows = data.map((d) => [
    d.termTitle, d.termCode, fa(d.tuitionFixed), fa(d.tuitionVariable), fa(d.discountFixed), fa(d.discountVariable),
    fa(d.subjectAdditive), fa(d.subjectDeductive), fa(d.sponsorship), fa(d.payments), fa(d.posPayments), fa(d.loans), fa(d.balance),
  ]);
  const titleRow = [`صورت حساب مالی - ${studentName} (${studentCode})`, '', '', '', '', '', '', '', '', '', '', '', ''];
  const dateRow = [`تاریخ: ${new Date().toLocaleString('fa-IR')}`, '', '', '', '', '', '', '', '', '', '', '', ''];
  return [titleRow, dateRow, headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function generateText(data: StatementRow[], studentName: string, studentCode: string): string {
  const colWidths = [20, 12, 16, 16, 14, 14, 16, 14, 14, 14, 14, 12, 16];
  const headers = ['ترم', 'کد ترم', 'شهریه ثابت', 'شهریه متغیر', 'تخفیف ثابت', 'تخفیف متغیر', 'موضوعی +\nافزایشی', 'موضوعی -\nکاهشی', 'پوشش\nبنیاد', 'پرداخت\nآنلاین', 'پرداخت\nPOS', 'وام', 'مانده'];
  const pad = (s: string, w: number) => s.padEnd(w);
  const headerLine = headers.map((h, i) => pad(h, colWidths[i])).join(' | ');
  const sepLine = colWidths.map((w) => '-'.repeat(w)).join('-+-');
  const body = data.map((d) => [d.termTitle, d.termCode, fa(d.tuitionFixed), fa(d.tuitionVariable), fa(d.discountFixed), fa(d.discountVariable), fa(d.subjectAdditive), fa(d.subjectDeductive), fa(d.sponsorship), fa(d.payments), fa(d.posPayments), fa(d.loans), fa(d.balance)]
    .map((v, i) => pad(v, colWidths[i])).join(' | ')).join('\n');
  const totals = ['جمع کل', '', fa(data.reduce((s, d) => s + d.tuitionFixed, 0)), fa(data.reduce((s, d) => s + d.tuitionVariable, 0)), fa(data.reduce((s, d) => s + d.discountFixed, 0)), fa(data.reduce((s, d) => s + d.discountVariable, 0)), fa(data.reduce((s, d) => s + d.subjectAdditive, 0)), fa(data.reduce((s, d) => s + d.subjectDeductive, 0)), fa(data.reduce((s, d) => s + d.sponsorship, 0)), fa(data.reduce((s, d) => s + d.payments, 0)), fa(data.reduce((s, d) => s + d.posPayments, 0)), fa(data.reduce((s, d) => s + d.loans, 0)), fa(data.reduce((s, d) => s + d.balance, 0))]
    .map((v, i) => pad(v, colWidths[i])).join(' | ');
  return `صورت حساب مالی - ${studentName} (${studentCode})\nتاریخ: ${new Date().toLocaleString('fa-IR')}\n\n${headerLine}\n${sepLine}\n${body}\n${sepLine}\n${totals}`;
}

/** Lightweight dependency-free bar chart — term-by-term balance trend. */
function BalanceChart({ data }: { data: StatementRow[] }) {
  const W = 860;
  const H = 260;
  const padL = 20;
  const padB = 26;
  const padT = 16;
  const n = data.length;
  const barW = Math.max(4, Math.min(22, (W - padL * 2) / Math.max(1, n * 2.4)));
  const step = n > 0 ? (W - padL * 2) / n : 1;
  const maxVal = Math.max(
    1,
    ...data.map((d) => Math.max(d.tuitionFixed + d.tuitionVariable + d.subjectAdditive, d.payments + d.posPayments + d.discountFixed + d.discountVariable + d.sponsorship + d.subjectDeductive, Math.abs(d.balance))),
  );
  const scale = (v: number) => (H - padT - padB) * (v / maxVal);
  const points = data.map((d, i) => {
    const x = padL + step * i + step / 2;
    const y = H - padB - Math.max(0, Math.min(H - padT - padB, scale(Math.abs(d.balance))));
    return `${x},${y}`;
  }).join(' ');
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card p-3">
      <div className="mb-1 flex flex-wrap items-center gap-3 text-[10px] font-bold text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-rose-500" /> بدهکاری</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-emerald-500" /> بستانکاری</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-blue-500" /> روند مانده</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full" role="img" aria-label="روند مانده ترم‌به‌ترم">
        <line x1={padL} y1={H - padB} x2={W - padL} y2={H - padB} stroke="currentColor" className="text-border" />
        {data.map((d, i) => {
          const cx = padL + step * i + step / 2;
          const debt = d.tuitionFixed + d.tuitionVariable + d.subjectAdditive;
          const credit = d.payments + d.posPayments + d.discountFixed + d.discountVariable + d.sponsorship + d.subjectDeductive;
          return (
            <g key={d.termId}>
              <rect x={cx - barW - 1} y={H - padB - scale(debt)} width={barW} height={scale(debt)} className="fill-rose-500/70" rx={2} />
              <rect x={cx + 1} y={H - padB - scale(credit)} width={barW} height={scale(credit)} className="fill-emerald-500/70" rx={2} />
              <text x={cx} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[9px]" direction="ltr">{d.termCode || '—'}</text>
            </g>
          );
        })}
        {n > 0 ? <polyline points={points} fill="none" className="stroke-blue-500" strokeWidth={2.5} strokeLinejoin="round" /> : null}
      </svg>
    </div>
  );
}

function SumBox({ icon, label, value, tone, sub }: { icon: string; label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className={`relative rounded-xl border bg-gradient-to-b p-3 pt-4 text-center shadow-xs ${tone}`}>
      <p className="text-lg font-black leading-tight">{value}</p>
      <p className="mt-0.5 text-[11px] font-medium opacity-75">{label}</p>
      {sub ? <p className="mt-0.5 text-[10px] font-bold opacity-90">{sub}</p> : null}
      <span className="absolute -top-2.5 right-2 text-sm">{icon}</span>
    </div>
  );
}

export function AdminStudentStatementPage() {
  const [params] = useSearchParams();
  const studentId = Number(params.get('studentId') ?? 0);
  return studentId ? <StatementView studentId={studentId} /> : <StudentPickerView />;
}

function StudentPickerView() {
  const { data: students = [], isLoading, isError } = useQuery({ queryKey: ['statement-students'], queryFn: getStatementStudents, staleTime: 30_000 });
  const [query, setQuery] = useState('');
  const [onlyDebtors, setOnlyDebtors] = useState(false);
  const [sort, setSort] = useState<SortKey>('code');

  const stats = useMemo(() => {
    let debtors = 0;
    let receivable = 0;
    let chequesWaiting = 0;
    for (const s of students) {
      if (s.balance > 0) {
        debtors++;
        receivable += s.balance;
      }
      chequesWaiting += s.pendingCheques || 0;
    }
    return { total: students.length, debtors, receivable, chequesWaiting };
  }, [students]);

  const rows = useMemo(() => {
    const q = toEnDigits(query.trim().toLowerCase());
    const out = students.filter((s: PickerStudent) => {
      if (onlyDebtors && s.balance <= 0) return false;
      if (!q) return true;
      const hay = toEnDigits(
        [s.firstName ?? '', s.lastName ?? '', s.studentCode ?? '', s.nationalCode ?? '', s.majorTitle ?? '', s.degreeTitle ?? '']
          .join(' ')
          .toLowerCase(),
      );
      return hay.includes(q);
    });
    out.sort((a, b) => {
      if (sort === 'balance') return b.balance - a.balance;
      if (sort === 'name') return `${a.lastName ?? ''} ${a.firstName ?? ''}`.localeCompare(`${b.lastName ?? ''} ${b.firstName ?? ''}`, 'fa');
      return (a.studentCode ?? '').localeCompare(b.studentCode ?? '', 'fa', { numeric: true });
    });
    return out;
  }, [students, query, onlyDebtors, sort]);

  const KPIS = [
    { icon: '👥', label: 'کل دانشجویان', value: fa(stats.total), tone: 'from-slate-500/15 to-slate-50/60 border-slate-300', valueTone: 'text-slate-800' },
    { icon: '⚠️', label: 'بدهکاران', value: fa(stats.debtors), tone: 'from-rose-500/15 to-rose-50/60 border-rose-300', valueTone: 'text-rose-700' },
    { icon: '💰', label: 'جمع دریافتنی', value: `${fa(stats.receivable)} ریال`, tone: 'from-emerald-500/15 to-emerald-50/60 border-emerald-300', valueTone: 'text-emerald-700' },
    { icon: '🧾', label: 'چک در انتظار', value: `${fa(stats.chequesWaiting)} ریال`, tone: 'from-amber-500/15 to-amber-50/60 border-amber-300', valueTone: 'text-amber-700' },
  ];

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت فهرست دانشجویان ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 text-white">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-black sm:text-xl">📄 صورت‌حساب / کارنامهٔ مالی دانشجو</h1>
              <p className="mt-1 text-xs text-emerald-50/90">دانشجو را جستجو کنید؛ سند رسمی ترم‌به‌ترم با امکان چاپ A4 باز می‌شود</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/admin/finance/reports" className="rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20">↩️ مرکز گزارش‌ها</Link>
              <Link to="/admin/finance" className="rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20">🗂️ کارتابل مالی</Link>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {KPIS.map((k) => (
          <div key={k.label} className={`rounded-xl border bg-gradient-to-b p-3 shadow-xs ${k.tone}`}>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground"><span>{k.icon}</span>{k.label}</div>
            <div className={`mt-1 text-sm font-black ${k.valueTone}`}>{k.value}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جستجو بر اساس نام، کد دانشجویی، کد ملی یا رشته…" className="pr-9" />
          </div>
          <button
            type="button"
            onClick={() => setOnlyDebtors((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${onlyDebtors ? 'border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200' : 'border-border bg-card text-muted-foreground hover:border-slate-300'}`}
          >
            ⚠️ فقط بدهکاران
          </button>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-9 rounded-lg border border-input bg-card px-2 text-xs font-bold">
            <option value="code">مرتب‌سازی: کد دانشجویی</option>
            <option value="balance">مرتب‌سازی: بیشترین بدهی</option>
            <option value="name">مرتب‌سازی: نام خانوادگی</option>
          </select>
          <span className="rounded-lg bg-muted px-2.5 py-2 text-[11px] font-bold text-muted-foreground">{fa(rows.length)} از {fa(students.length)} نفر</span>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-collapse text-right text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-muted/95 text-muted-foreground backdrop-blur">
                <th className="p-2.5 font-black">دانشجو</th>
                <th className="p-2.5 font-black">رشته / مقطع</th>
                <th className="p-2.5 font-black">ورودی</th>
                <th className="p-2.5 font-black">مانده کل</th>
                <th className="p-2.5 font-black">چک در انتظار</th>
                <th className="p-2.5 font-black">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const tone = AVATAR_TONES[s.studentId % AVATAR_TONES.length];
                const name = `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || 'بدون نام';
                return (
                  <tr key={s.studentId} className="border-b border-border/50 last:border-0 transition hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20">
                    <td className="p-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[11px] font-black text-white ${tone}`}>
                          {(s.firstName?.[0] ?? '') + (s.lastName?.[0] ?? '') || '؟'}
                        </span>
                        <span>
                          <span className="block font-bold">{name}</span>
                          <span className="block font-mono text-[10px] text-muted-foreground">
                            {s.studentCode ?? '—'}
                            {s.nationalCode ? ` · ملی ${s.nationalCode}` : ''}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="p-2.5 text-muted-foreground">
                      <span className="block">{s.majorTitle ?? '—'}</span>
                      <span className="block text-[10px] opacity-70">{s.degreeTitle ?? ''}</span>
                    </td>
                    <td className="p-2.5 text-muted-foreground">{s.entryYear ? fa(s.entryYear) : '—'}</td>
                    <td className="p-2.5">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-black ${s.balance > 0 ? 'border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'}`}>
                        {fa(s.balance)} ریال
                      </span>
                    </td>
                    <td className="p-2.5 text-xs text-amber-700 dark:text-amber-300">{s.pendingCheques ? `${fa(s.pendingCheques)} ریال` : '—'}</td>
                    <td className="p-2.5">
                      <Link to={`/admin/finance/reports/student-statement?studentId=${s.studentId}`} className="inline-block rounded-lg bg-gradient-to-l from-emerald-600 to-teal-700 px-3 py-1.5 text-[11px] font-black text-white shadow-xs transition hover:from-emerald-700 hover:to-teal-800">
                        📄 صورت حساب
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-muted-foreground">
                    <div className="text-3xl">🔎</div>
                    <div className="mt-2 text-xs font-bold">دانشجویی با این جستجو یافت نشد</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-center text-[11px] text-muted-foreground">
        سند صادرشده، همان کارنامهٔ مالی رسمی است — با سربرگ دانشگاه، جمع‌کل، جدول ترم‌ها و محل امضای کارشناس
      </p>
    </div>
  );
}

function StatementView({ studentId }: { studentId: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-statement', studentId],
    queryFn: () => getStudentStatement(studentId),
    staleTime: 30_000,
  });
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');
  const [exporting, setExporting] = useState<string | null>(null);

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-[60vh] w-full" /></div>;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت صورت‌حساب ناموفق بود.</CardContent></Card>;

  const rows = data.rows;
  const totals = rows.reduce(
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
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-indigo-900 to-indigo-700 text-white print:hidden">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-black sm:text-lg">📄 صورت‌حساب مالی — {data.student.name}</h1>
              <p className="mt-1 text-[11px] text-indigo-100/90">
                شمارهٔ دانشجویی: <span dir="ltr" className="font-mono">{data.student.code}</span> — ۹ مشخصهٔ سما (ثابت/متغیر/پرداختی/تخفیف ثابت/متغیر/موضوعی + و − /بنیاد/وام)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="success" onClick={() => doPrintTranscript('landscape')}><Printer className="size-4" aria-hidden /> چاپ / PDF رسمی</Button>
              <Button size="sm" variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20" onClick={() => setViewMode((v) => (v === 'table' ? 'chart' : 'table'))}>
                📊 {viewMode === 'table' ? 'نمودار روند' : 'بستن نمودار'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20"
                disabled={exporting === 'csv'}
                onClick={() => {
                  setExporting('csv');
                  download(`statement_${data.student.code}_${Date.now()}.csv`, generateCSV(rows, data.student.name, data.student.code), 'text/csv;charset=utf-8');
                  setExporting(null);
                }}
              >
                {exporting === 'csv' ? '⏳…' : '📥 CSV'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20"
                disabled={exporting === 'txt'}
                onClick={() => {
                  setExporting('txt');
                  download(`statement_${data.student.code}_${Date.now()}.txt`, generateText(rows, data.student.name, data.student.code), 'text/plain;charset=utf-8');
                  setExporting(null);
                }}
              >
                {exporting === 'txt' ? '⏳…' : '📥 متن'}
              </Button>
              <Link to="/admin/finance/reports/student-statement" className="inline-flex items-center gap-1 rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20">
                <ArrowRight className="size-3.5" aria-hidden /> انتخاب دانشجو
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 print:hidden md:grid-cols-5">
        <SumBox icon="💸" label="جمع شهریه (ریال)" value={fa(totals.charges)} tone="border-rose-200 from-rose-50 to-white text-rose-700 dark:border-rose-800 dark:from-rose-950/40 dark:to-card dark:text-rose-200" />
        <SumBox icon="🎁" label="تخفیف + پوشش بنیاد (ریال)" value={fa(totals.discounts + totals.sponsorships)} tone="border-violet-200 from-violet-50 to-white text-violet-700 dark:border-violet-800 dark:from-violet-950/40 dark:to-card dark:text-violet-200" />
        <SumBox icon="💵" label="پرداخت + چک وصولی + وام (ریال)" value={fa(paidTotal)} tone="border-emerald-200 from-emerald-50 to-white text-emerald-700 dark:border-emerald-800 dark:from-emerald-950/40 dark:to-card dark:text-emerald-200" />
        <SumBox icon="⏳" label="چک در انتظار وصول (ریال)" value={fa(totals.chequesPending)} tone="border-amber-200 from-amber-50 to-white text-amber-700 dark:border-amber-800 dark:from-amber-950/40 dark:to-card dark:text-amber-200" />
        <SumBox
          icon={totals.balance > 0 ? '🔴' : '🟢'}
          label={totals.balance > 0 ? 'ماندهٔ بدهی (ریال)' : totals.balance < 0 ? 'بستانکاری (ریال)' : 'وضعیت حساب'}
          value={fa(Math.abs(totals.balance))}
          tone={totals.balance > 0 ? 'border-rose-300 from-rose-100 to-white text-rose-800 dark:border-rose-700 dark:from-rose-950/50 dark:to-card dark:text-rose-200' : 'border-emerald-300 from-emerald-100 to-white text-emerald-800 dark:border-emerald-700 dark:from-emerald-950/50 dark:to-card dark:text-emerald-200'}
        />
      </div>

      {viewMode === 'chart' ? (
        <div className="print:hidden">
          <div className="mb-1 flex items-center gap-1 text-xs font-bold text-muted-foreground"><Table2 className="size-3.5" aria-hidden /> روند مانده ترم‌به‌ترم</div>
          <BalanceChart data={rows} />
        </div>
      ) : null}

      <div className="print-area">
        <FinancialTranscript
          student={{ fullName: data.student.name, studentCode: data.student.code, status: null }}
          terms={rows.map((d) => ({
            termId: d.termId,
            termTitle: d.termTitle,
            termCode: d.termCode || null,
            charges: d.charges ?? 0,
            discounts: d.discounts ?? 0,
            sponsorships: d.sponsorships ?? 0,
            netPayable: d.netPayable ?? 0,
            payments: d.canonicalPayments ?? 0,
            chequesCleared: d.chequesCleared ?? 0,
            chequesPending: d.chequesPending ?? 0,
            chequesBounced: d.chequesBounced ?? 0,
            loans: d.canonicalLoans ?? 0,
            balance: d.balance ?? 0,
            events: [],
            courses: d.courses ?? [],
            coursesBasis: d.coursesBasis,
          }))}
          totals={totals}
          showEvents={false}
        />
      </div>

      <p className="flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground print:hidden">
        <FileText className="size-3.5" aria-hidden /> این سند از همان موتور کانونی کارنامهٔ مالی ساخته می‌شود — جمع ریز دروس همیشه با شهریهٔ متغیر دفتر کل یکی است.
      </p>
    </div>
  );
}

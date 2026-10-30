import { useQuery } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, toEnDigits } from '@/lib/fa';
import {
  exportFinanceReport,
  getReportOptions,
  runFinanceReport,
  type ReportFilters,
  type ReportResult,
} from '@/lib/reports-api';

// ═══ مرکز گزارش‌های مالی — پورت admin/finance/reports ═══

type CardDef = {
  kind: string;
  icon: string;
  title: string;
  needsTerm?: boolean;
  customs?: { key: string; title: string }[];
};

const CARDS: CardDef[] = [
  { kind: 'tuition', icon: '💰', title: 'گزارش شهریه / تراکنش مالی', needsTerm: true },
  { kind: 'tuition-tariff', icon: '💰', title: 'تعرفه تحصیلی', needsTerm: true },
  { kind: 'tuition-statement', icon: '🧾', title: 'صورت‌حساب شهریه', needsTerm: true },
  {
    kind: 'finance-worklist', icon: '🗂️', title: 'کارتابل مالی (مانده دانشجویان)',
    customs: [{ key: 'onlyDebtors', title: 'فقط بدهکار (1)' }],
  },
  { kind: 'payroll-overview', icon: '💵', title: 'حق‌التدریس اساتید', needsTerm: true },
  { kind: 'bi-teaching-quality', icon: '🎯', title: 'کیفیت تدریس اساتید (BI)' },
  { kind: 'bi-facilities', icon: '🏫', title: 'امکانات کلاس‌ها (BI)' },
];

/** گزارش‌های سطح درس/استاد: فیلترهای دانشجویی برایشان معنا ندارد. */
const COURSE_LEVEL_KINDS = new Set([
  'tuition-tariff', 'payroll-overview', 'bi-teaching-quality', 'bi-facilities',
]);

const DOCKS = [
  { href: '/admin/finance/reports/student-statement', icon: '📄', title: 'صورت‌حساب / کارنامهٔ مالی', desc: 'سند رسمی ترم‌به‌ترم + چاپ PDF' },
  { href: '/admin/finance', icon: '🗂️', title: 'کارتابل مالی', desc: 'ماندهٔ همهٔ دانشجویان + فیلتر' },
  { href: '/admin/finance/rules', icon: '⚙️', title: 'قواعد مالی', desc: 'انواع تخفیف، بنیادها و فرمول‌ها' },
  { href: '/admin/finance/advanced', icon: '🎯', title: 'فرمول ویژهٔ دانشجو', desc: 'استثناهای شهریهٔ دانشجویی' },
  { href: '/admin/finance/welfare', icon: '🤝', title: 'صندوق رفاه', desc: 'وام‌ها و پوشش‌های رفاهی' },
  { href: '/admin/finance/pos', icon: '🏧', title: 'ترمینال‌های POS', desc: 'دستگاه‌ها و تراکنش‌ها' },
  { href: '/admin/finance', icon: '💳', title: 'امور مالی دانشجویان', desc: 'ثبت تعدیل دفتر دانشجو' },
];

const faNum = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

function jalaliSmart(value: unknown, withTime = false): string {
  if (value === null || value === undefined || value === '') return '—';
  const raw = String(value).trim();
  if (/^1[34]\d{2}[/-]\d{1,2}[/-]\d{1,2}/.test(raw)) return faDigits(raw.replace(/-/g, '/'));
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return faDigits(raw);
  try {
    const date = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
    if (!withTime) return date;
    return `${date} ${faDigits(String(d.getHours()).padStart(2, '0'))}:${faDigits(String(d.getMinutes()).padStart(2, '0'))}`;
  } catch {
    return faDigits(raw);
  }
}

function fmtCell(value: unknown, format?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (format) {
    case 'DATE': return jalaliSmart(value);
    case 'DATETIME': return jalaliSmart(value, true);
    case 'MONEY': return `${faNum(Math.round(Number(value) || 0).toLocaleString('en-US'))} ریال`;
    case 'NUMBER': return faNum(Number(value).toLocaleString('en-US'));
    default: return String(value);
  }
}

export function AdminFinanceReportsPage() {
  const { data: opts, isLoading } = useQuery({ queryKey: ['finance-report-options'], queryFn: getReportOptions, staleTime: 60_000 });

  const [kind, setKind] = useState('tuition');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [degreeId, setDegreeId] = useState(0);
  const [facultyId, setFacultyId] = useState(0);
  const [departmentId, setDepartmentId] = useState(0);
  const [majorId, setMajorId] = useState(0);
  const [entryYear, setEntryYear] = useState(0);
  const [q, setQ] = useState('');
  const [nationalCode, setNationalCode] = useState('');
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [res, setRes] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState('');

  const card = CARDS.find((c) => c.kind === kind);
  const showStudentFilters = !COURSE_LEVEL_KINDS.has(kind);
  const termValue = term || opts?.latestTerm || '';

  const visibleCards = useMemo(() => {
    const needle = toEnDigits(search.trim().toLowerCase());
    if (!needle) return CARDS;
    return CARDS.filter((c) => toEnDigits(c.title.toLowerCase()).includes(needle) || c.kind.includes(needle));
  }, [search]);

  const filters: ReportFilters = {
    term: card?.needsTerm ? termValue : '',
    degreeId, facultyId, departmentId, majorId, entryYear,
    q: q.trim(), nationalCode: nationalCode.trim(), page: 1,
    onlyDebtors: extra.onlyDebtors === '1',
  };

  async function run(page = 1) {
    if (!opts) return;
    setLoading(true);
    setErr('');
    try {
      setRes(await runFinanceReport(kind, { ...filters, page }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطای نامشخص در اجرای گزارش');
    } finally {
      setLoading(false);
    }
  }

  function pick(k: string) {
    setKind(k);
    setRes(null);
    setErr('');
  }

  async function doExport() {
    setExporting(true);
    setErr('');
    try {
      const { header, lines } = await exportFinanceReport(kind, { ...filters, page: 1 });
      const esc = (v: string) => {
        const s = /^[=+\-@|\t\r]/.test(v.trimStart()) ? `'${v}` : v;
        return `"${s.replace(/"/g, '""')}"`;
      };
      const csv = '\ufeff' + [header.map(esc).join(','), ...lines.map((l) => l.map(esc).join(','))].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `report-${kind}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطای نامشخص در خروجی');
    } finally {
      setExporting(false);
    }
  }

  if (isLoading || !opts) return <Skeleton className="h-72 w-full" />;

  return (
    <div className="space-y-4">
      {/* ── سربرگ premium ── */}
      <Card className="border-0 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 text-white">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-black sm:text-xl">
                <Landmark className="size-5" aria-hidden /> مرکز گزارش‌های مالی (سما)
              </h1>
              <p className="mt-1 text-xs text-emerald-50/90">
                شهریه، تعرفه، صورت‌حساب، کارتابل مالی، حق‌التدریس و BI مالی — همه صفحه‌بندی‌شده با خروجی Excel
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/admin/finance" className="rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20">
                🗂️ کارتابل مالی
              </Link>
              <Link to="/admin/finance/reports/student-statement" className="rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20">
                📄 کارنامهٔ مالی دانشجو
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── کاشی‌های دسترسی سریع ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {DOCKS.map((d) => (
          <Link key={d.title} to={d.href} className="group rounded-xl border border-border bg-card p-3 shadow-xs transition-all hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md">
            <div className="flex items-center gap-2">
              <span className="text-xl">{d.icon}</span>
              <span className="text-[12px] font-black">{d.title}</span>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{d.desc}</p>
          </Link>
        ))}
      </div>

      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
        مرکز گزارش‌های مالی
      </p>

      {/* ── جست‌وجوی گزارش‌ها ── */}
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`🔍 جست‌وجو در گزارش‌ها… (${CARDS.length} گزارش)`} />

      {/* ── کارت‌های گزارش ── */}
      {visibleCards.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">گزارشی با این عبارت یافت نشد.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {visibleCards.map((c) => (
            <button
              key={c.kind}
              type="button"
              onClick={() => pick(c.kind)}
              className={`flex items-center gap-2 rounded-lg border-2 p-3 text-right text-[13px] font-bold shadow-xs transition-all ${
                kind === c.kind
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-950 shadow-md dark:bg-indigo-950/40 dark:text-indigo-100'
                  : 'border-border bg-card text-foreground hover:border-indigo-300 hover:shadow'
              }`}
            >
              <span className="text-2xl">{c.icon}</span>
              <span>{c.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── نوار فیلتر ── */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 p-3 text-xs">
          {card?.needsTerm ? (
            <label className="flex items-center gap-1">
              <span className="font-bold text-muted-foreground">ترم:</span>
              <select value={termValue} onChange={(e) => setTerm(e.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2 font-mono" dir="ltr">
                {opts.terms.map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-1">
            <span className="font-bold text-muted-foreground">مقطع:</span>
            <select value={degreeId} onChange={(e) => setDegreeId(Number(e.target.value))} className="h-8 max-w-44 rounded-lg border border-input bg-transparent px-2">
              <option value={0}>همه</option>
              {opts.degrees.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </label>
          {showStudentFilters ? (
            <>
              <label className="flex items-center gap-1">
                <span className="font-bold text-muted-foreground">دانشکده:</span>
                <select value={facultyId} onChange={(e) => setFacultyId(Number(e.target.value))} className="h-8 max-w-44 rounded-lg border border-input bg-transparent px-2">
                  <option value={0}>همه</option>
                  {opts.faculties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="font-bold text-muted-foreground">گروه آموزشی:</span>
                <select value={departmentId} onChange={(e) => setDepartmentId(Number(e.target.value))} className="h-8 max-w-44 rounded-lg border border-input bg-transparent px-2">
                  <option value={0}>همه</option>
                  {opts.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="font-bold text-muted-foreground">رشته:</span>
                <select value={majorId} onChange={(e) => setMajorId(Number(e.target.value))} className="h-8 max-w-52 rounded-lg border border-input bg-transparent px-2">
                  <option value={0}>همه</option>
                  {opts.majors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="font-bold text-muted-foreground">ورودی:</span>
                <select value={entryYear} onChange={(e) => setEntryYear(Number(e.target.value))} className="h-8 rounded-lg border border-input bg-transparent px-2 font-mono" dir="ltr">
                  <option value={0}>همه</option>
                  {opts.entryYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="font-bold text-muted-foreground">کد ملی:</span>
                <Input value={nationalCode} onChange={(e) => setNationalCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void run(1)} placeholder="کد ملی..." className="h-8 w-36 font-mono" dir="ltr" />
              </label>
            </>
          ) : null}
          {(card?.customs ?? []).map((c) => (
            <label key={c.key} className="flex items-center gap-1">
              <span className="font-bold text-muted-foreground">{c.title}:</span>
              <Input value={extra[c.key] ?? ''} onChange={(e) => setExtra({ ...extra, [c.key]: e.target.value })} className="h-8 w-24" />
            </label>
          ))}
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void run(1)} placeholder="🔍 شماره/نام/کد ملی..." className="h-8 w-48" />
          <Button size="sm" onClick={() => void run(1)} disabled={loading}>
            {loading ? '⏳ در حال اجرا...' : '▶ اجرای گزارش'}
          </Button>
          {res && res.rows.length > 0 ? (
            <Button size="sm" variant="success" className="mr-auto" onClick={() => void doExport()} disabled={exporting}>
              {exporting ? '⏳...' : '📥 خروجی Excel (CSV)'}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* ── نتیجه ── */}
      <Card className="overflow-hidden">
        {err ? (
          <p className="bg-rose-50 p-8 text-center text-sm font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">خطا: {err}</p>
        ) : !res ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            گزارش «{card?.title}» را انتخاب و <b>اجرای گزارش</b> را بزنید.
          </p>
        ) : res.rows.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-300">رکوردی با این فیلترها یافت نشد.</p>
            {res.summary ? <p className="mt-2 text-xs leading-6 text-muted-foreground">{res.summary}</p> : null}
          </div>
        ) : (
          <>
            {res.summary ? <div className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-bold">{res.summary}</div> : null}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-xs">
                <thead className="sticky top-0 border-b border-border bg-muted font-bold">
                  <tr>
                    {res.columns.map((c) => <th key={c.key} className="whitespace-nowrap p-2">{c.title}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {res.rows.map((r, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                      {res.columns.map((c) => (
                        <td key={c.key} className="whitespace-nowrap p-2 font-mono" dir={/^[0-9]/.test(String(r[c.key] ?? '')) ? 'ltr' : 'auto'}>
                          {fmtCell(r[c.key], c.format)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {res.totalPages > 1 ? (
              <div className="flex items-center justify-center gap-2 border-t border-border p-3 text-xs">
                <Button size="sm" variant="outline" disabled={res.page <= 1} onClick={() => void runFinanceReport(kind, { ...filters, page: res.page - 1 }).then(setRes)}>قبلی ▶</Button>
                <span className="font-bold">صفحه {res.page.toLocaleString('fa-IR')} از {res.totalPages.toLocaleString('fa-IR')} ({res.total.toLocaleString('fa-IR')} رکورد)</span>
                <Button size="sm" variant="outline" disabled={res.page >= res.totalPages} onClick={() => void runFinanceReport(kind, { ...filters, page: res.page + 1 }).then(setRes)}>◀ بعدی</Button>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <p className="text-center text-[11px] text-muted-foreground">
        اعداد از همان موتورهای کانونی کارتابل/کارنامه/حقوق می‌آیند — گزارش و صفحهٔ تخصصی واگرا نمی‌شوند.
      </p>
    </div>
  );
}

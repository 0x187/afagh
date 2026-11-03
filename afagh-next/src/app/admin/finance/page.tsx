import Link from 'next/link';
import PrintButton from '@/components/PrintButton';
import { requireRole } from '@/lib/auth';
import { listFinanceStudents, listFinanceFilterOptions, summarizeFinanceStudents, countFinanceStudents } from '@/lib/finance-engine';
import { getCurrentUniversity } from '@/lib/university-scope';
import { getTermScope } from '@/lib/term-scope';
import FinanceTable from './FinanceTable';

export const dynamic = 'force-dynamic';

const FINANCE = ['ADMIN', 'FINANCE_EXPERT', 'FINANCE'];

const fa = (n: number) => Number(n || 0).toLocaleString('fa-IR');

/** ساخت URL صفحه‌بندی با حفظ فیلترهای فعلی (رشته/مقطع/ورودی/جستجو/بدهکار). */
function buildFinanceHref(
  sp: { majorId?: string; degreeLevelId?: string; entryYear?: string; q?: string; debtors?: string },
  p: number,
): string {
  const params = new URLSearchParams();
  if (sp.majorId) params.set('majorId', sp.majorId);
  if (sp.degreeLevelId) params.set('degreeLevelId', sp.degreeLevelId);
  if (sp.entryYear) params.set('entryYear', sp.entryYear);
  if (sp.q) params.set('q', sp.q);
  if (sp.debtors) params.set('debtors', sp.debtors);
  if (p > 1) params.set('page', String(p));
  const qs = params.toString();
  return qs ? `/admin/finance?${qs}` : '/admin/finance';
}

type KpiTone = 'slate' | 'rose' | 'violet' | 'indigo' | 'emerald' | 'amber' | 'sky';

const KPI_TONE: Record<KpiTone, { wrap: string; text: string; icon: string }> = {
  slate: { wrap: 'from-slate-50 to-white border-slate-200', text: 'text-slate-800', icon: 'bg-slate-700' },
  rose: { wrap: 'from-rose-50 to-white border-rose-200', text: 'text-rose-700', icon: 'bg-rose-600' },
  violet: { wrap: 'from-violet-50 to-white border-violet-200', text: 'text-violet-700', icon: 'bg-violet-600' },
  indigo: { wrap: 'from-indigo-50 to-white border-indigo-200', text: 'text-indigo-700', icon: 'bg-indigo-600' },
  emerald: { wrap: 'from-emerald-50 to-white border-emerald-200', text: 'text-emerald-700', icon: 'bg-emerald-600' },
  amber: { wrap: 'from-amber-50 to-white border-amber-200', text: 'text-amber-700', icon: 'bg-amber-500' },
  sky: { wrap: 'from-sky-50 to-white border-sky-200', text: 'text-sky-700', icon: 'bg-sky-600' },
};

function Kpi({ icon, label, value, tone, sub }: { icon: string; label: string; value: string; tone: KpiTone; sub?: string }) {
  const t = KPI_TONE[tone];
  return (
    <div className={`rounded-xl border bg-gradient-to-b ${t.wrap} p-3 text-center shadow-sm transition-shadow hover:shadow`}>
      <div className={`mx-auto mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg text-sm text-white shadow-sm ${t.icon}`}>
        {icon}
      </div>
      <p className={`text-lg font-black leading-tight ${t.text}`}>{value}</p>
      <p className="mt-0.5 text-2xs font-medium text-slate-500">{label}</p>
      {sub && <p className={`mt-0.5 text-3xs font-bold ${t.text} opacity-80`}>{sub}</p>}
    </div>
  );
}

export default async function FinanceWorklistPage(props: {
  searchParams: Promise<{
    majorId?: string;
    degreeLevelId?: string;
    entryYear?: string;
    q?: string;
    debtors?: string;
    page?: string;
  }>;
}) {
  await requireRole(FINANCE);

  const currentUniversity = await getCurrentUniversity();
  const currentUniversityId = currentUniversity?.id ?? null;

  // دامنهٔ نیمسال از سوییچر سربرگ (کوکی afagh_term) می‌آید؛ null = همهٔ نیمسال‌ها
  const termScope = await getTermScope(currentUniversityId);
  const scopeTermId = termScope.selectedId;
  const scopeTermTitle = scopeTermId
    ? (termScope.terms.find((t) => t.id === scopeTermId)?.title ?? `نیمسال ${scopeTermId}`)
    : null;

  const sp = (await props.searchParams) || {};
  const majorId = Number(sp.majorId) || null;
  const degreeLevelId = Number(sp.degreeLevelId) || null;
  const entryYear = Number(sp.entryYear) || null;
  const search = (sp.q || '').trim();
  const onlyDebtors = sp.debtors === '1';
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 100;

  // کارتابل حالا صفحه‌بندی شده است:
  //   • students → فقط صفحهٔ جاری (۱۰۰ ردیف) — بار شبکه/پارس ~۱۰برابر کمتر
  //   • summary  → جمع کل روی همهٔ دانشجویانِ فیلتر‌شده (نوار KPI همچنان درست)
  //   • count    → تعداد کل برای نوار صفحه‌بندی
  const [options, students, summary, count] = await Promise.all([
    listFinanceFilterOptions({ universityId: currentUniversityId }),
    listFinanceStudents({
      majorId, degreeLevelId, entryYear, search, onlyDebtors,
      limit: pageSize, offset: (page - 1) * pageSize,
      universityId: currentUniversityId,
      termId: scopeTermId,
    }),
    summarizeFinanceStudents({
      majorId, degreeLevelId, entryYear, search, onlyDebtors,
      universityId: currentUniversityId,
      termId: scopeTermId,
    }),
    countFinanceStudents({
      majorId, degreeLevelId, entryYear, search, onlyDebtors,
      universityId: currentUniversityId,
    }),
  ]);

  const collected = summary.payments + summary.chequesCleared + summary.loans;
  const netDebtBase = summary.charges - summary.discounts - summary.sponsorships;
  const collectionRate = netDebtBase > 0
    ? Math.min(100, Math.round((collected / netDebtBase) * 100))
    : collected > 0 ? 100 : 0;

  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const rangeFrom = (page - 1) * pageSize + 1;
  const rangeTo = Math.min(page * pageSize, count);

  const inputCls =
    'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500';
  const dockCls =
    'rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold text-white backdrop-blur transition hover:bg-white/20';

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── سربرگ premium ── */}
      <div className="overflow-hidden rounded-2xl border border-emerald-900/20 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 p-5 text-white shadow-lg print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-black sm:text-xl">🗂️ کارتابل کارشناس مالی</h1>
            <p className="mt-1 text-xs text-emerald-50/90">
              فهرست کامل دانشجویان با ماندهٔ مالی — فیلتر رشته، مقطع و ورودی؛ ورود مستقیم به کارنامهٔ مالی هر دانشجو
            </p>
            {/* دامنهٔ فعال: دانشگاه × نیمسال — تا معلوم باشد اعداد متعلق به کدام بازه‌اند */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-2xs font-bold">
                🏛️ {currentUniversity ? currentUniversity.title : 'بدون دانشگاه'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-2xs font-bold">
                📅 {scopeTermTitle ?? 'همهٔ نیمسال‌ها'}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/finance/rules" className={dockCls}>⚙️ قواعد مالی</Link>
            <Link href="/admin/tuition" className={dockCls}>🧮 موتور شهریه</Link>
            <Link href="/admin/finance/student-formula" className={dockCls}>🎯 فرمول ویژه</Link>
            <Link href="/admin/finance/welfare" className={dockCls}>🤝 صندوق رفاه</Link>
            <Link href="/admin/finance/reports" className={dockCls}>📊 مرکز گزارش‌ها</Link>
            <PrintButton />
          </div>
        </div>
      </div>

      {/* ── نوار KPI ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 print:hidden">
        <Kpi icon="👥" label="دانشجوی فیلتر‌شده" value={fa(count)} tone="slate" sub={`${fa(summary.debtorCount)} بدهکار`} />
        <Kpi icon="💸" label="جمع شهریه (ریال)" value={fa(summary.charges)} tone="rose" />
        <Kpi icon="🎁" label="جمع تخفیف (ریال)" value={fa(summary.discounts)} tone="violet" />
        <Kpi icon="🏛️" label="پوشش بنیادها (ریال)" value={fa(summary.sponsorships)} tone="indigo" />
        <Kpi icon="💵" label="پرداخت نقدی (ریال)" value={fa(summary.payments)} tone="emerald" sub={`وام: ${fa(summary.loans)}`} />
        <Kpi icon="🧾" label="چک وصول‌شده (ریال)" value={fa(summary.chequesCleared)} tone="emerald" sub={`در انتظار: ${fa(summary.pendingCheques)}`} />
        <Kpi icon="⏳" label="چک در انتظار (ریال)" value={fa(summary.pendingCheques)} tone="amber" />
        <Kpi
          icon={summary.balance > 0 ? '🔴' : '🟢'}
          label="ماندهٔ خالص (ریال)"
          value={fa(Math.abs(summary.balance))}
          tone={summary.balance > 0 ? 'rose' : 'emerald'}
          sub={summary.balance > 0 ? 'بدهکار' : summary.balance < 0 ? 'بستانکار' : 'تسویه'}
        />
        {/* نرخ وصول — کارت تمام‌عرض */}
        <div className="col-span-2 rounded-xl border border-indigo-200 bg-gradient-to-b from-indigo-50 to-white p-3 shadow-sm md:col-span-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-black text-indigo-800">📈 نرخ وصول شهریه (پرداخت + چک وصولی + وام نسبت به خالص بدهی)</span>
            <span className="font-black text-indigo-700">{fa(collectionRate)}٪</span>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-gradient-to-l from-emerald-500 to-teal-400 transition-all"
              style={{ width: `${collectionRate}%` }}
            />
          </div>
          <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-2xs text-slate-500">
            <span>جمع وصولی: <b className="text-emerald-700">{fa(collected)} ریال</b></span>
            <span>خالص قابل‌وصول: <b className="text-rose-700">{fa(Math.max(0, netDebtBase))} ریال</b></span>
          </div>
        </div>
      </div>

      {/* ── فیلترها ── */}
      <form method="get" className="card print:hidden">
        <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
          <h2 className="text-xs font-black text-slate-700">🔍 فیلترها</h2>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <input type="checkbox" name="debtors" value="1" defaultChecked={onlyDebtors} className="accent-emerald-700" />
            فقط دانشجویان بدهکار
          </label>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="flex flex-col gap-1">
            <span className="text-2xs font-medium text-slate-600">رشته</span>
            <select name="majorId" defaultValue={majorId ?? ''} className={inputCls}>
              <option value="">همهٔ رشته‌ها</option>
              {options.majors.map((m) => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-2xs font-medium text-slate-600">مقطع</span>
            <select name="degreeLevelId" defaultValue={degreeLevelId ?? ''} className={inputCls}>
              <option value="">همهٔ مقاطع</option>
              {options.degrees.map((d) => (
                <option key={d.id} value={d.id}>{d.title}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-2xs font-medium text-slate-600">ورودی</span>
            <select name="entryYear" defaultValue={entryYear ?? ''} className={inputCls}>
              <option value="">همهٔ ورودی‌ها</option>
              {options.entryYears.map((y) => (
                <option key={y} value={y}>{fa(y)}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-2xs font-medium text-slate-600">جستجو (نام، کد ملی، شمارهٔ دانشجویی)</span>
            <input name="q" defaultValue={search} placeholder="جستجو…" className={inputCls} />
          </label>

          <div className="flex items-end gap-2">
            <button type="submit" className="rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white shadow-sm">
              اعمال فیلتر
            </button>
            <Link href="/admin/finance" className="rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">
              پاک‌کردن
            </Link>
          </div>
        </div>
      </form>

      {/* فهرست دانشجویان */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
          <h2 className="font-bold text-slate-800">
            فهرست دانشجویان ({fa(students.length)} از {fa(count)})
          </h2>
          <p className="text-2xs text-slate-500 print:hidden">برای کارنامهٔ مالی روی نام دانشجو کلیک کنید</p>
        </div>

        {students.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">دانشجویی با این فیلترها یافت نشد.</p>
        ) : (
          <FinanceTable students={students} />
        )}

        {/* نوار صفحه‌بندی */}
        {count > pageSize && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 print:hidden">
            <span className="text-2xs text-slate-500">
              صفحهٔ {fa(page)} از {fa(pageCount)} - نمایش {fa(rangeFrom)} تا {fa(rangeTo)}
            </span>
            <div className="flex items-center gap-2">
              <Link
                href={buildFinanceHref(sp, page - 1)}
                aria-disabled={page <= 1}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                  page <= 1
                    ? 'pointer-events-none bg-slate-100 text-slate-400'
                    : 'bg-emerald-700 text-white hover:bg-emerald-800'
                }`}
              >
                › قبلی
              </Link>
              <Link
                href={buildFinanceHref(sp, page + 1)}
                aria-disabled={page >= pageCount}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                  page >= pageCount
                    ? 'pointer-events-none bg-slate-100 text-slate-400'
                    : 'bg-emerald-700 text-white hover:bg-emerald-800'
                }`}
              >
                بعدی ‹
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

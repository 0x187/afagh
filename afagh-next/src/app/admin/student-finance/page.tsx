import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';

export const dynamic = 'force-dynamic';

const TX_FA: Record<string, string> = {
  TUITION_CHARGE: 'شارژ شهریه',
  CHARGE: 'بدهی',
  PAYMENT: 'پرداخت',
  CREDIT: 'بستانکاری',
};

const txFa = (t: string) => TX_FA[t] ?? t;

const fa = (n: number) => Math.round(n).toLocaleString('fa-IR');

export default async function StudentFinancePage({
  searchParams,
}: {
  // در Next 16 مقدار searchParams یک Promise است — بدون await، فیلترِ
  // «نوع واریز» همیشه undefined می‌شد و بی‌صدا کار نمی‌کرد.
  searchParams: Promise<{ depositType?: string }>;
}) {
  await requireRole(['ADMIN', 'FINANCE_EXPERT', 'FINANCE']);
  const sp = await searchParams;

  const currentUniversity = await getCurrentUniversity();
  const currentUniversityId = currentUniversity?.id ?? null;
  // دفتر مالی دانشگاه فعال: ردیف‌های همین دانشگاه + سراسری (universityId=null)
  const ledgerScope = currentUniversityId
    ? sql`where ("universityId" = ${currentUniversityId} or "universityId" is null)`
    : sql``;
  const studentScope = currentUniversityId
    ? sql`and (st."universityId" = ${currentUniversityId} or st."universityId" is null)`
    : sql``;
  const requestScope = currentUniversityId
    ? sql`and (r."universityId" = ${currentUniversityId} or r."universityId" is null)`
    : sql``;

  // ── جمع کل شارژ/وصول و تعداد تراکنش‌ها ──
  const [tot] = (
    await db.execute(sql`
      select
        coalesce(sum(case when "transactionType" in ('TUITION_CHARGE','CHARGE') then amount else 0 end),0)::float8 as charged,
        coalesce(sum(case when "transactionType" in ('PAYMENT','CREDIT') then amount else 0 end),0)::float8 as paid,
        count(*)::int as txns
      from student_ledger ${ledgerScope}`)
  ).rows as unknown as { charged: number; paid: number; txns: number }[];

  // ── ماندهٔ هر دانشجو و استخراج بدهکاران ──
  const debtors = (
    await db.execute(sql`
      select b.bal::float8 as bal, st."studentCode", u."firstName", u."lastName"
      from (
        select "studentId",
          sum(case when "transactionType" in ('TUITION_CHARGE','CHARGE') then -amount
                   when "transactionType" in ('PAYMENT','CREDIT') then amount else 0 end) as bal
        from student_ledger ${ledgerScope} group by "studentId"
      ) b
      join students st on st.id = b."studentId"
      join users u on u.id = st."userId"
      where b.bal < 0 ${studentScope}
      order by b.bal asc
      limit 12`)
  ).rows as unknown as { bal: number; studentCode: string; firstName: string; lastName: string }[];

  const totalDebt = debtors.reduce((s, d) => s + -d.bal, 0);

  // ── پرونده‌های در انتظار اقدام مالی ──
  const pending = (
    await db.execute(sql`
      select r."trackingCode", r.status, pd.title, ps.title as step, u."firstName", u."lastName"
      from student_requests r
      join process_steps ps on ps.id = r."currentStepId"
      join students st on st.id = r."studentId"
      join users u on u.id = st."userId"
      left join process_definitions pd on pd.id = r."processId"
      where ps."roleCode" in ('FINANCE_EXPERT','FINANCE')
        and r.status not in ('APPROVED','REJECTED','CANCELLED') ${requestScope} ${studentScope}
      order by r.id desc limit 10`)
  ).rows as unknown as { trackingCode: string; status: string; title: string | null; step: string; firstName: string; lastName: string }[];

  // ── آخرین تراکنش‌های دفتر مالی ──
  const recent = (
    await db.execute(sql`
      select l."transactionType", l.amount::float8 as amount, l.description, l."createdAt",
             l."depositType", l."depositDate",
             st."studentCode", u."firstName", u."lastName"
      from student_ledger l
      join students st on st.id = l."studentId"
      join users u on u.id = st."userId"
      where 1=1 ${studentScope}
      order by l.id desc limit 10`)
  ).rows as unknown as {
    transactionType: string;
    amount: number;
    description: string | null;
    createdAt: Date | null;
    depositType: string | null;
    depositDate: Date | null;
    studentCode: string;
    firstName: string;
    lastName: string;
  }[];

  // ── تفکیک وصولی بر اساس «نوع واریز» ──
  // نوع واریزِ ردیف‌های منتقل‌شده از سیستم قدیمی به‌صورت متن در انتهای شرح
  // آمده است: «پرداخت از سیستم قدیمی — فیش N (نوع واریز)». اینجا همان پرانتز
  // را استخراج می‌کنیم تا بخش مالی بدون SQL گزارش بگیرد.
  const payScope = currentUniversityId
    ? sql`and (l."universityId" = ${currentUniversityId} or l."universityId" is null)`
    : sql``;

  // ── فیلتر نوع واریز (از ستون ساختاریافتهٔ جدید — مهاجرت ۰۱۱۹) ──
  const depositTypeFilter =
    typeof sp?.depositType === 'string' && sp.depositType.length > 0
      ? sp.depositType
      : null;
  const filterSql = depositTypeFilter
    ? sql`and l."depositType" = ${depositTypeFilter}`
    : sql``;

  // گزینه‌های فیلتر: انواع واریزِ موجود در دفتر (هم‌گام با داده پس از بک‌فیل)
  const depositTypeOptions = (
    await db.execute(sql`
      select distinct coalesce(l."depositType", 'نامشخص / بدون شرح') as dt
      from student_ledger l
      where l."transactionType" = 'PAYMENT' ${payScope}
      order by 1`)
  ).rows as unknown as { dt: string }[];

  // ── تفکیک وصولی بر اساس «نوع واریز» ──
  // از ستون ساختاریافتهٔ depositType استفاده می‌کند (پس از بک‌فیلِ مهاجرت ۰۱۱۹
  // مقدارش از متنِ description پر شده است)؛ گزارش‌گیری دیگر به متنِ شرح وابسته نیست.
  const byMethod = (
    await db.execute(sql`
      select
        coalesce(l."depositType", 'نامشخص / بدون شرح') as deposit_type,
        count(*)::int as txn_count,
        coalesce(sum(l.amount), 0)::float8 as total_amount
      from student_ledger l
      where l."transactionType" = 'PAYMENT' ${payScope} ${filterSql}
      group by 1
      order by 2 desc`)
  ).rows as unknown as { deposit_type: string; txn_count: number; total_amount: number }[];

  const methodTotal = byMethod.reduce((s, r) => s + r.total_amount, 0);
  const methodCount = byMethod.reduce((s, r) => s + r.txn_count, 0);
  const pct = (v: number) => (methodTotal ? (v / methodTotal) * 100 : 0);

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── سربرگ premium ── */}
      <div className="overflow-hidden rounded-2xl border border-emerald-900/20 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 p-4 text-white shadow-lg print:hidden sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black sm:text-xl">💳 امور مالی دانشجویان</h1>
            <p className="mt-1 text-xs text-emerald-50/90">شهریه، دفتر مالی دانشجویان و پرونده‌های در انتظار اقدام مالی</p>
          </div>
          <Link
            href="/admin/finance/reports"
            className="rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20"
          >
            📊 مرکز گزارش‌ها
          </Link>
        </div>
      </div>

      {/* آمار کل */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card text-center">
          <p className="text-xl font-bold text-slate-800">{fa(tot?.charged ?? 0)}</p>
          <p className="text-xs text-slate-500">جمع شارژ/بدهی (ریال)</p>
        </div>
        <div className="card text-center">
          <p className="text-xl font-bold text-emerald-700">{fa(tot?.paid ?? 0)}</p>
          <p className="text-xs text-slate-500">جمع وصولی/بستانکاری (ریال)</p>
        </div>
        <div className="card text-center">
          <p className="text-xl font-bold text-rose-700">{fa(totalDebt)}</p>
          <p className="text-xs text-slate-500">مانده بدهی دانشجویان (ریال)</p>
        </div>
        <div className="card text-center">
          <p className="text-xl font-bold text-indigo-700">{debtors.length > 0 ? fa(debtors.length) + ' دانشجو' : '—'}</p>
          <p className="text-xs text-slate-500">دانشجویان بدهکار (نمونهٔ برتر)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* بدهکاران */}
        <div className="card">
          <h2 className="font-bold text-slate-800 mb-3 border-b border-slate-100 pb-2">دانشجویان بدهکار (بیشترین بدهی)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm rt">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-200">
                  <th className="p-2">دانشجو</th>
                  <th className="p-2">کد</th>
                  <th className="p-2">مانده بدهی (ریال)</th>
                </tr>
              </thead>
              <tbody>
                {debtors.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-5 text-center text-slate-400">
                      دانشجوی بدهکاری ثبت نشده است.
                    </td>
                  </tr>
                )}
                {debtors.map(d => (
                  <tr key={d.studentCode} className="border-t border-slate-100">
                    <td className="p-2 font-semibold text-slate-800">{d.firstName} {d.lastName}</td>
                    <td className="p-2 font-mono text-xs text-slate-500" dir="ltr">{d.studentCode}</td>
                    <td className="p-2 font-bold text-rose-700">{fa(-d.bal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* در انتظار اقدام مالی */}
        <div className="card">
          <h2 className="font-bold text-slate-800 mb-3 border-b border-slate-100 pb-2">پرونده‌های در انتظار اقدام مالی</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm rt">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-200">
                  <th className="p-2">کد رهگیری</th>
                  <th className="p-2">دانشجو</th>
                  <th className="p-2">فرآیند / گام</th>
                </tr>
              </thead>
              <tbody>
                {pending.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-5 text-center text-slate-400">
                      پرونده‌ای در صف مالی نیست.
                    </td>
                  </tr>
                )}
                {pending.map(p => (
                  <tr key={p.trackingCode} className="border-t border-slate-100">
                    <td className="p-2 font-mono text-xs font-bold text-slate-700" dir="ltr">{p.trackingCode}</td>
                    <td className="p-2 text-slate-800">{p.firstName} {p.lastName}</td>
                    <td className="p-2 text-xs text-slate-600">
                      {p.title ?? '—'} · {p.step}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* تفکیک وصولی بر اساس نوع واریز */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <h2 className="font-bold text-slate-800">تفکیک وصولی بر اساس نوع واریز</h2>
          <span className="text-xs font-bold text-slate-500">
            {fa(methodCount)} تراکنش · جمع {fa(methodTotal)} ریال
          </span>
        </div>

        {/* فیلتر نوع واریز — فرم GET ساده (سازگار با کامپوننت سرور) */}
        <form method="get" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
          <label htmlFor="depositType" className="text-xs font-bold text-slate-600">فیلتر نوع واریز:</label>
          <select
            id="depositType"
            name="depositType"
            defaultValue={depositTypeFilter ?? ''}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
          >
            <option value="">همهٔ انواع</option>
            {depositTypeOptions.map((o) => (
              <option key={o.dt} value={o.dt}>{o.dt}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white transition hover:bg-emerald-700">
            اعمال فیلتر
          </button>
          {depositTypeFilter && (
            <a href="/admin/student-finance" className="text-xs font-bold text-rose-600 hover:underline">حذف فیلتر</a>
          )}
        </form>

        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-2xs font-bold leading-5 text-amber-900">
          ⚠️ این تفکیک از متنِ شرحِ ردیف‌های منتقل‌شده از سیستم قدیمی استخراج شده است
          («پرداخت از سیستم قدیمی — فیش N (نوع واریز)»). <b>تاریخ واریز واقعی در مهاجرت حفظ نشده</b>
          و جداول جزئیاتِ چک و پرداخت آنلاین خالی‌اند؛ برای گزارشِ تاریخ‌دار باید داده از سیستم قدیمی دوباره وارد شود.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm rt">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-200">
                <th className="p-2">نوع واریز</th>
                <th className="p-2">تعداد تراکنش</th>
                <th className="p-2">جمع مبلغ (ریال)</th>
                <th className="p-2">سهم</th>
              </tr>
            </thead>
            <tbody>
              {byMethod.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-5 text-center text-slate-400">
                    پرداختی در دفتر مالی ثبت نشده است.
                  </td>
                </tr>
              )}
              {byMethod.map(r => (
                <tr key={r.deposit_type} className="border-t border-slate-100">
                  <td className="p-2 font-semibold text-slate-800">{r.deposit_type}</td>
                  <td className="p-2 text-slate-600">{fa(r.txn_count)}</td>
                  <td className={`p-2 font-bold ${r.total_amount < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {fa(r.total_amount)}
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${Math.min(100, Math.abs(pct(r.total_amount)))}%` }}
                        />
                      </div>
                      <span className="text-2xs font-bold text-slate-500" dir="ltr">
                        {pct(r.total_amount).toFixed(1)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {byMethod.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-black text-slate-800">
                  <td className="p-2">جمع کل</td>
                  <td className="p-2">{fa(methodCount)}</td>
                  <td className="p-2">{fa(methodTotal)}</td>
                  <td className="p-2 text-xs text-slate-500">۱۰۰٪</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* آخرین تراکنش‌ها */}
      <div className="card">
        <h2 className="font-bold text-slate-800 mb-3 border-b border-slate-100 pb-2">آخرین تراکنش‌های دفتر مالی</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm rt">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-200">
                <th className="p-2">تاریخ</th>
                <th className="p-2">دانشجو</th>
                <th className="p-2">نوع</th>
                <th className="p-2">نوع واریز</th>
                <th className="p-2">تاریخ واریز</th>
                <th className="p-2">مبلغ (ریال)</th>
                <th className="p-2">شرح</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-5 text-center text-slate-400">
                    تراکنشی در دفتر مالی ثبت نشده است.
                  </td>
                </tr>
              )}
              {recent.map((t, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="p-2 text-xs text-slate-500">
                    {t.createdAt ? new Date(t.createdAt).toLocaleDateString('fa-IR') : '—'}
                  </td>
                  <td className="p-2 text-slate-800">
                    {t.firstName} {t.lastName}
                    <span className="text-3xs font-mono text-slate-400 mr-1" dir="ltr">{t.studentCode}</span>
                  </td>
                  <td className="p-2 text-xs">{txFa(t.transactionType)}</td>
                  <td className="p-2 text-xs text-slate-600">{t.depositType ?? '—'}</td>
                  <td className="p-2 text-xs text-slate-500">
                    {t.depositDate ? new Date(t.depositDate).toLocaleDateString('fa-IR') : '—'}
                  </td>
                  <td className="p-2 font-bold text-slate-700">{fa(t.amount)}</td>
                  <td className="p-2 text-xs text-slate-500 truncate max-w-[220px]">{t.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

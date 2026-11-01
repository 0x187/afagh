import Link from 'next/link';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { sanjesh_file_rows, sanjesh_files } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { getScopedFile } from '@/lib/sanjesh/access';
import { fileCounters } from '@/lib/sanjesh/ingest';
import { runMatchAction, setRowStatusAction } from '../../actions';
import { Counter, Flash, SanjeshSteps } from '../../_ui';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  MATCHED: 'bg-emerald-100 text-emerald-800',
  DUPLICATE: 'bg-sky-100 text-sky-800',
  INVALID: 'bg-red-100 text-red-700',
  IGNORED: 'bg-slate-200 text-slate-600',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'در انتظار',
  MATCHED: 'تطبیق‌یافته',
  DUPLICATE: 'تکراری/مبهم',
  INVALID: 'نامعتبر',
  IGNORED: 'نادیده',
};

export default async function SanjeshRowsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; err?: string; q?: string; status?: string; page?: string }>;
}) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const fileId = Number(id);
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const q = (sp.q ?? '').trim();
  const status = (sp.status ?? '').trim();

  const uniScope = await getCurrentUniversity();
  const file = await getScopedFile(fileId, uniScope?.id ?? null);
  if (!file) return <div className="p-6 text-sm text-red-600">فایل یافت نشد.</div>;

  const conds = [eq(sanjesh_file_rows.fileId, fileId)];
  if (q) {
    const like = `%${q}%`;
    const cond = or(
      ilike(sanjesh_file_rows.nationalCode, like),
      ilike(sanjesh_file_rows.fullName, like),
      ilike(sanjesh_file_rows.applicantNo, like),
      ilike(sanjesh_file_rows.uniqueId, like),
    );
    if (cond) conds.push(cond);
  }
  if (status) conds.push(eq(sanjesh_file_rows.matchStatus, status));
  const where = and(...conds);

  const [rows, counters, totalRes] = await Promise.all([
    db
      .select()
      .from(sanjesh_file_rows)
      .where(where)
      .orderBy(asc(sanjesh_file_rows.rowNo))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    fileCounters(fileId),
    db.select({ n: sql<number>`count(*)::int` }).from(sanjesh_file_rows).where(where),
  ]);
  const total = Number(totalRes[0]?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    for (const [k, v] of Object.entries(over)) p.set(k, String(v));
    return `?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      <SanjeshSteps fileId={fileId} active="rows" />
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-base font-bold text-slate-800">لیست سنجش — {file.title}</h1>
          <p className="text-[11px] text-slate-500">
            همهٔ ستون‌های خام هر ردیف در دیتابیس ذخیره شده است؛ برای دیدن جزئیات روی «مشاهده» بزنید.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Counter label="کل" value={counters.total} />
          <Counter label="تطبیق‌یافته" value={counters.matched} tone="emerald" />
          <Counter label="در انتظار" value={counters.pending} tone="amber" />
          <Counter label="تکراری" value={counters.duplicate} tone="sky" />
          <Counter label="نامعتبر" value={counters.invalid} tone="red" />
        </div>
      </header>

      <Flash msg={sp.msg} err={sp.err} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form action={runMatchAction}>
          <input type="hidden" name="fileId" value={fileId} />
          <button className="btn-primary !py-1 text-xs">تطبیق با دانشجویان (کد ملی)</button>
        </form>
        <form className="flex items-center gap-1" action={`/admin/sanjesh/${fileId}/rows`}>
          <input name="q" defaultValue={q} placeholder="کد ملی / نام / شماره داوطلب" className="input !w-56 !py-1 !px-2 text-xs" />
          <select name="status" defaultValue={status} className="input !w-32 !py-1 !px-2 text-xs">
            <option value="">همه وضعیت‌ها</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button className="btn-ghost !py-1 text-xs">جستجو</button>
        </form>
      </div>

      <div className="overflow-auto rounded-xl border border-slate-200">
        <table className="w-full text-right text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
            <tr>
              <th className="sticky right-0 z-20 w-12 bg-slate-100 p-2 font-medium shadow-[-2px_0_0_0_#cbd5e1]">ردیف</th>
              <th className="p-2 font-medium">نام</th>
              <th className="p-2 font-medium">کد ملی</th>
              <th className="p-2 font-medium">شماره داوطلب</th>
              <th className="p-2 font-medium">شناسه یکتا</th>
              <th className="p-2 font-medium">وضعیت</th>
              <th className="p-2 font-medium">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-400">
                  ردیفی با این فیلتر یافت نشد.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-800 dark:even:bg-slate-900">
                  <td className="sticky right-0 z-10 bg-inherit p-2 text-center tabular-nums text-slate-500 shadow-[-2px_0_0_0_#e2e8f0]">
                    {r.rowNo}
                  </td>
                  <td className="p-2 text-slate-700">{r.fullName ?? '—'}</td>
                  <td className="p-2 tabular-nums text-slate-600" dir="ltr">
                    {r.nationalCode ?? '—'}
                    {!r.nationalCodeValid && r.nationalCode && <span className="ms-1 text-[10px] text-red-600">(نامعتبر)</span>}
                  </td>
                  <td className="p-2 tabular-nums text-slate-600" dir="ltr">
                    {r.applicantNo ?? '—'}
                  </td>
                  <td className="p-2 tabular-nums text-slate-500" dir="ltr">
                    {r.uniqueId ?? '—'}
                  </td>
                  <td className="p-2">
                    <span className={`badge ${STATUS_BADGE[r.matchStatus] ?? 'bg-slate-100 text-slate-600'}`}>
                      {STATUS_LABEL[r.matchStatus] ?? r.matchStatus}
                    </span>
                    {r.matchNote && <div className="mt-0.5 text-[10px] text-slate-400">{r.matchNote}</div>}
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/sanjesh/${fileId}/rows/${r.id}`} className="text-[11px] text-teal-700 hover:underline">
                        مشاهده
                      </Link>
                      <form action={setRowStatusAction}>
                        <input type="hidden" name="fileId" value={fileId} />
                        <input type="hidden" name="rowId" value={r.id} />
                        <input type="hidden" name="status" value={r.matchStatus === 'IGNORED' ? 'PENDING' : 'IGNORED'} />
                        <button className="text-[11px] text-slate-500 hover:underline">
                          {r.matchStatus === 'IGNORED' ? 'بازگردانی' : 'نادیده'}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1 text-xs">
          {page > 1 && (
            <Link href={`/admin/sanjesh/${fileId}/rows${qs({ page: page - 1 })}`} className="btn-ghost !py-1">
              قبلی
            </Link>
          )}
          <span className="px-2 text-slate-500">
            صفحهٔ {page.toLocaleString('fa-IR')} از {pages.toLocaleString('fa-IR')} · {total.toLocaleString('fa-IR')} ردیف
          </span>
          {page < pages && (
            <Link href={`/admin/sanjesh/${fileId}/rows${qs({ page: page + 1 })}`} className="btn-ghost !py-1">
              بعدی
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

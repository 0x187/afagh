import { and, asc, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { admissions_staging, sanjesh_file_rows, sanjesh_files } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { getScopedFile } from '@/lib/sanjesh/access';
import { fileCounters } from '@/lib/sanjesh/ingest';
import { stageMatchedAction } from '../../actions';
import { Counter, Flash, SanjeshSteps } from '../../_ui';

export const dynamic = 'force-dynamic';

export default async function SanjeshMatchedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const fileId = Number(id);

  const uniScope = await getCurrentUniversity();
  const file = await getScopedFile(fileId, uniScope?.id ?? null);
  if (!file) return <div className="p-6 text-sm text-red-600">فایل یافت نشد.</div>;

  const [matchedRows, counters, stagedRes] = await Promise.all([
    db
      .select({
        id: sanjesh_file_rows.id,
        rowNo: sanjesh_file_rows.rowNo,
        fullName: sanjesh_file_rows.fullName,
        nationalCode: sanjesh_file_rows.nationalCode,
        studentId: sanjesh_file_rows.studentId,
        matchedAt: sanjesh_file_rows.matchedAt,
      })
      .from(sanjesh_file_rows)
      .where(and(eq(sanjesh_file_rows.fileId, fileId), eq(sanjesh_file_rows.matchStatus, 'MATCHED')))
      .orderBy(asc(sanjesh_file_rows.rowNo))
      .limit(300),
    fileCounters(fileId),
    db.select({ n: sql<number>`count(*)::int` }).from(admissions_staging).where(eq(admissions_staging.fileId, fileId)),
  ]);

  const stagedCount = Number(stagedRes[0]?.n ?? 0);

  return (
    <div className="mx-auto max-w-6xl p-4">
      <SanjeshSteps fileId={fileId} active="matched" />
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-base font-bold text-slate-800">تطبیق داده شده — {file.title}</h1>
          <p className="text-[11px] text-slate-500">
            ردیف‌هایی که با کد ملی به یک دانشجوی موجود وصل شده‌اند. با «انتقال به پذیرش» در جدول پذیرش ثبت می‌شوند.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Counter label="تطبیق‌یافته" value={counters.matched} tone="emerald" />
          <Counter label="منتقل‌شده" value={stagedCount} tone="sky" />
          <Counter label="در انتظار" value={counters.pending} tone="amber" />
        </div>
      </header>

      <Flash msg={sp.msg} err={sp.err} />

      <div className="mb-3">
        <form action={stageMatchedAction}>
          <input type="hidden" name="fileId" value={fileId} />
          <button className="btn-primary !py-1.5 text-xs" disabled={counters.matched === 0}>
            انتقال {counters.matched.toLocaleString('fa-IR')} ردیف تطبیق‌یافته به پذیرش
          </button>
        </form>
      </div>

      <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200">
        <table className="w-full text-right text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
            <tr>
              <th className="sticky right-0 z-20 w-12 bg-slate-100 p-2 font-medium shadow-[-2px_0_0_0_#cbd5e1]">ردیف</th>
              <th className="p-2 font-medium">نام</th>
              <th className="p-2 font-medium">کد ملی</th>
              <th className="p-2 font-medium">شناسهٔ دانشجو</th>
              <th className="p-2 font-medium">زمان تطبیق</th>
            </tr>
          </thead>
          <tbody>
            {matchedRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-slate-400">
                  هنوز ردیفی تطبیق نیافته است. ابتدا در «لیست سنجش» دکمهٔ تطبیق را بزنید.
                </td>
              </tr>
            ) : (
              matchedRows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                  <td className="sticky right-0 z-10 bg-inherit p-2 text-center tabular-nums text-slate-500 shadow-[-2px_0_0_0_#e2e8f0]">
                    {r.rowNo}
                  </td>
                  <td className="p-2 text-slate-700">{r.fullName ?? '—'}</td>
                  <td className="p-2 tabular-nums text-slate-600" dir="ltr">
                    {r.nationalCode ?? '—'}
                  </td>
                  <td className="p-2 tabular-nums text-slate-600">{r.studentId ?? '—'}</td>
                  <td className="p-2 text-[10px] text-slate-400">
                    {r.matchedAt ? new Date(r.matchedAt).toLocaleString('fa-IR') : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {matchedRows.length === 300 && (
        <p className="mt-2 text-[10px] text-slate-400">فقط ۳۰۰ ردیف اول نمایش داده شده است.</p>
      )}
    </div>
  );
}

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import Link from 'next/link';

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

  const [readyRows, counters, stagedRes] = await Promise.all([
    db
      .select({
        id: sanjesh_file_rows.id,
        rowNo: sanjesh_file_rows.rowNo,
        fullName: sanjesh_file_rows.fullName,
        nationalCode: sanjesh_file_rows.nationalCode,
        studentId: sanjesh_file_rows.studentId,
        matchStatus: sanjesh_file_rows.matchStatus,
        matchedAt: sanjesh_file_rows.matchedAt,
      })
      .from(sanjesh_file_rows)
      .where(
        and(
          eq(sanjesh_file_rows.fileId, fileId),
          inArray(sanjesh_file_rows.matchStatus, ['PENDING', 'MATCHED']),
        ),
      )
      .orderBy(asc(sanjesh_file_rows.rowNo))
      .limit(300),
    fileCounters(fileId),
    db.select({ n: sql<number>`count(*)::int` }).from(admissions_staging).where(eq(admissions_staging.fileId, fileId)),
  ]);

  const stagedCount = Number(stagedRes[0]?.n ?? 0);
  const readyCount = counters.pending + counters.matched;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <SanjeshSteps fileId={fileId} active="matched" />
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-base font-bold text-slate-800">تطبیق داده شده — {file.title}</h1>
          <p className="text-[11px] text-slate-500">
            ردیف‌های معتبر این فایل که آمادهٔ ورود به صف پذیرش‌اند. ردیف‌های «نامعتبر»، «تکراری» و «نادیده‌گرفته‌شده» منتقل
            نمی‌شوند. ستون «دانشجوی موجود» فقط نشان می‌دهد داوطلب از قبل در سامانه هست یا نه؛ مانع انتقال نیست.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Counter label="آمادهٔ انتقال" value={readyCount} tone="emerald" />
          <Counter label="دانشجوی موجود" value={counters.matched} tone="sky" />
          <Counter label="منتقل‌شده" value={stagedCount} tone="sky" />
          <Counter label="نامعتبر" value={counters.invalid} tone="red" />
        </div>
      </header>

      <Flash msg={sp.msg} err={sp.err} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form action={stageMatchedAction}>
          <input type="hidden" name="fileId" value={fileId} />
          <button className="btn-primary !py-1.5 text-xs" disabled={readyCount === 0}>
            انتقال {readyCount.toLocaleString('fa-IR')} ردیف به پذیرش
          </button>
        </form>
        <Link
          href="/admin/admissions"
          className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-bold text-indigo-800 hover:bg-indigo-100"
        >
          ادامه: صف پذیرش و نگاشت رشته ←
        </Link>
      </div>

      <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200">
        <table className="w-full text-right text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
            <tr>
              <th className="sticky right-0 z-20 w-12 bg-slate-100 p-2 font-medium shadow-[-2px_0_0_0_#cbd5e1]">ردیف</th>
              <th className="p-2 font-medium">نام</th>
              <th className="p-2 font-medium">کد ملی</th>
              <th className="p-2 font-medium">دانشجوی موجود</th>
              <th className="p-2 font-medium">زمان تطبیق</th>
            </tr>
          </thead>
          <tbody>
            {readyRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-slate-400">
                  ردیف معتبری برای انتقال نیست (همه نامعتبر، تکراری یا نادیده‌گرفته شده‌اند).
                </td>
              </tr>
            ) : (
              readyRows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                  <td className="sticky right-0 z-10 bg-inherit p-2 text-center tabular-nums text-slate-500 shadow-[-2px_0_0_0_#e2e8f0]">
                    {r.rowNo}
                  </td>
                  <td className="p-2 text-slate-700">{r.fullName ?? '—'}</td>
                  <td className="p-2 tabular-nums text-slate-600" dir="ltr">
                    {r.nationalCode ?? '—'}
                  </td>
                  <td className="p-2 text-[11px]">
                    {r.matchStatus === 'MATCHED' ? (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-800">
                        بله · شناسه {r.studentId}
                      </span>
                    ) : (
                      <span className="text-slate-400">داوطلب جدید</span>
                    )}
                  </td>
                  <td className="p-2 text-[10px] text-slate-400">
                    {r.matchedAt ? new Date(r.matchedAt).toLocaleString('fa-IR') : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {readyRows.length === 300 && (
        <p className="mt-2 text-[10px] text-slate-400">فقط ۳۰۰ ردیف اول نمایش داده شده است.</p>
      )}
    </div>
  );
}

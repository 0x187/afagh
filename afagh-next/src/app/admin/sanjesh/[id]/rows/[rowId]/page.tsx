import Link from 'next/link';
import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { sanjesh_file_fields, sanjesh_file_rows, sanjesh_files } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getScopedFile } from '@/lib/sanjesh/access';
import { getCurrentUniversity } from '@/lib/university-scope';
import { SanjeshSteps } from '../../../_ui';

export const dynamic = 'force-dynamic';

interface RowPayload {
  fields?: Record<string, string>;
  columns?: Record<string, string>;
  meta?: { templateKey?: string | null; colCount?: number; nationalCodeValid?: boolean };
}

/**
 * جزئیات یک داوطلب: **همهٔ ستون‌های فایل** — چه نگاشت‌شده و چه نگاشت‌نشده.
 * این صفحه اثباتِ «هیچ داده‌ای دور ریخته نمی‌شود» است.
 */
export default async function SanjeshRowDetailPage({
  params,
}: {
  params: Promise<{ id: string; rowId: string }>;
}) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  const { id, rowId } = await params;
  const fileId = Number(id);
  const rId = Number(rowId);

  const uniScope = await getCurrentUniversity();
  const file = await getScopedFile(fileId, uniScope?.id ?? null);
  const [row] = await db
    .select()
    .from(sanjesh_file_rows)
    .where(and(eq(sanjesh_file_rows.fileId, fileId), eq(sanjesh_file_rows.id, rId)))
    .limit(1);

  if (!file || !row) return <div className="p-6 text-sm text-red-600">ردیف یافت نشد.</div>;

  const fields = await db
    .select()
    .from(sanjesh_file_fields)
    .where(eq(sanjesh_file_fields.fileId, fileId))
    .orderBy(asc(sanjesh_file_fields.colIndex));

  const payload = (row.dataJson ?? {}) as RowPayload;
  const rawCols = payload.columns ?? {};
  const mappedByCol = new Map(fields.map((f) => [f.colIndex, f]));
  const totalCols = Math.max(fields.length, Object.keys(rawCols).length);

  return (
    <div className="mx-auto max-w-5xl p-4">
      <SanjeshSteps fileId={fileId} active="rows" />

      <header className="mb-3">
        <h1 className="text-base font-bold text-slate-800">
          داوطلب ردیف {row.rowNo.toLocaleString('fa-IR')} — {row.fullName ?? 'بدون نام'}
        </h1>
        <p className="text-2xs text-slate-500" dir="ltr">
          nationalCode={row.nationalCode ?? '—'} · applicantNo={row.applicantNo ?? '—'} · uniqueId={row.uniqueId ?? '—'} · hash=
          {row.rowHash ?? '—'}
        </p>
      </header>

      <div className="mb-3 flex flex-wrap gap-1.5 text-2xs">
        <span className="badge bg-slate-100 text-slate-600">وضعیت: {row.matchStatus}</span>
        {row.studentId && <span className="badge bg-emerald-100 text-emerald-800">شناسهٔ دانشجو: {row.studentId}</span>}
        <span className="badge bg-sky-100 text-sky-800">{totalCols} ستون ذخیره‌شده</span>
        <Link href={`/admin/sanjesh/${fileId}/rows`} className="badge bg-white text-teal-700 hover:underline">
          ← بازگشت به لیست
        </Link>
      </div>

      <section className="card mb-3">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">همهٔ ستون‌های فایل</h2>
        <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
              <tr>
                <th className="sticky right-0 z-20 w-12 bg-slate-100 p-2 font-medium shadow-[-2px_0_0_0_#cbd5e1]">#</th>
                <th className="p-2 font-medium">عنوان سنجش</th>
                <th className="p-2 font-medium">فیلد مقصد</th>
                <th className="p-2 font-medium">مقدار خام</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: totalCols }, (_, i) => i + 1).map((c) => {
                const f = mappedByCol.get(c);
                const raw = rawCols[String(c)] ?? '';
                const unmapped = !f?.isMapped;
                return (
                  <tr key={c} className={unmapped ? 'border-t border-slate-100 bg-amber-50/50' : 'border-t border-slate-100'}>
                    <td className="sticky right-0 z-10 bg-inherit p-2 text-center tabular-nums text-slate-500 shadow-[-2px_0_0_0_#e2e8f0]">
                      {c}
                    </td>
                    <td className="p-2 text-slate-700">{f?.sanjeshTitle ?? `ستون ${c}`}</td>
                    <td className="p-2 text-slate-500" dir="ltr">
                      {f?.targetField ?? <span className="text-amber-700">نگاشت‌نشده</span>}
                    </td>
                    <td className="p-2 text-slate-700" dir="auto">
                      {raw === '' ? <span className="text-slate-300">—</span> : raw}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">خط اصلی فایل (بدون دستکاری)</h2>
        <pre className="max-h-48 overflow-auto rounded-xl bg-slate-900 p-3 text-3xs leading-5 text-slate-200" dir="ltr">
          {row.rawLine}
        </pre>
      </section>
    </div>
  );
}

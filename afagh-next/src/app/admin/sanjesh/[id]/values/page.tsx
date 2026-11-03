import { asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { sanjesh_files, sanjesh_value_maps } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { getScopedFile } from '@/lib/sanjesh/access';
import { deleteValueMapAction, saveValueMapAction, seedValueMapsFromTemplateAction } from '../../actions';
import { Flash, SanjeshSteps } from '../../_ui';

export const dynamic = 'force-dynamic';

export default async function SanjeshValuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; err?: string; field?: string }>;
}) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const fileId = Number(id);

  const uniScope = await getCurrentUniversity();
  const file = await getScopedFile(fileId, uniScope?.id ?? null);
  if (!file) return <div className="p-6 text-sm text-red-600">فایل یافت نشد.</div>;

  const maps = await db
    .select()
    .from(sanjesh_value_maps)
    .where(eq(sanjesh_value_maps.fileId, fileId))
    .orderBy(asc(sanjesh_value_maps.field), asc(sanjesh_value_maps.sanjeshValue));

  // گروه‌بندی بر اساس فیلد
  const grouped = new Map<string, typeof maps>();
  for (const m of maps) {
    const list = grouped.get(m.field) ?? [];
    list.push(m);
    grouped.set(m.field, list);
  }
  const fieldFilter = (sp.field ?? '').trim();
  const shown = fieldFilter ? [...grouped.entries()].filter(([f]) => f === fieldFilter) : [...grouped.entries()];

  return (
    <div className="mx-auto max-w-5xl p-4">
      <SanjeshSteps fileId={fileId} active="values" />
      <header className="mb-3">
        <h1 className="text-base font-bold text-slate-800">جدول براورد — {file.title}</h1>
        <p className="text-2xs text-slate-500">
          هر مقدار سنجش (کد یا عنوان) را به عنوان/کد داخلی آفاق نگاشت می‌کند. جدول براورد هم کد و هم عنوان را به‌عنوان
          کلید می‌پذیرد.
        </p>
      </header>

      <Flash msg={sp.msg} err={sp.err} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form action={seedValueMapsFromTemplateAction}>
          <input type="hidden" name="fileId" value={fileId} />
          <button className="btn-ghost !py-1 text-xs">پرکردن از دیکدهای قالب</button>
        </form>
        <span className="text-2xs text-slate-500">{maps.length.toLocaleString('fa-IR')} ردیف براورد</span>
      </div>

      {/* افزودن ردیف براورد */}
      <section className="card mb-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">افزودن / ویرایش براورد</h2>
        <form action={saveValueMapAction} className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
          <input type="hidden" name="fileId" value={fileId} />
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-3xs text-slate-500 md:col-span-2">
            <span>فیلد</span>
            <input name="field" required className="input !py-1 !px-2 text-xs" dir="ltr" placeholder="gender" />
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-3xs text-slate-500 md:col-span-2">
            <span>مقدار سنجش</span>
            <input name="sanjeshValue" required className="input !py-1 !px-2 text-xs" dir="auto" placeholder="2 یا مرد" />
          </label>
          <label className="col-span-2 flex min-w-0 flex-col gap-0.5 text-3xs text-slate-500 md:col-span-2">
            <span>عنوان سنجش</span>
            <input name="sanjeshLabel" className="input !py-1 !px-2 text-xs" />
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-3xs text-slate-500 md:col-span-1">
            <span>کد داخلی</span>
            <input name="internalValue" className="input !py-1 !px-2 text-xs" dir="ltr" placeholder="MALE" />
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-3xs text-slate-500 md:col-span-2">
            <span>عنوان داخلی</span>
            <input name="internalLabel" className="input !py-1 !px-2 text-xs" />
          </label>
          <button className="btn-primary col-span-2 !py-1.5 text-xs md:col-span-2">ذخیره</button>
        </form>
      </section>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">هنوز براوردی تعریف نشده است.</p>
      ) : (
        shown.map(([field, list]) => (
          <section key={field} className="card mb-3">
            <h3 className="mb-2 text-xs font-semibold text-slate-700" dir="ltr">
              {field}
            </h3>
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-1.5 font-medium">مقدار سنجش</th>
                  <th className="p-1.5 font-medium">عنوان سنجش</th>
                  <th className="p-1.5 font-medium">کد داخلی</th>
                  <th className="p-1.5 font-medium">عنوان داخلی</th>
                  <th className="w-16 p-1.5 font-medium">حذف</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="p-1.5 font-mono text-slate-700" dir="ltr">
                      {m.sanjeshValue}
                    </td>
                    <td className="p-1.5 text-slate-600">{m.sanjeshLabel ?? '—'}</td>
                    <td className="p-1.5 font-mono text-slate-600" dir="ltr">
                      {m.internalValue ?? '—'}
                    </td>
                    <td className="p-1.5 text-slate-600">{m.internalLabel ?? '—'}</td>
                    <td className="p-1.5">
                      <form action={deleteValueMapAction}>
                        <input type="hidden" name="fileId" value={fileId} />
                        <input type="hidden" name="id" value={m.id} />
                        <button className="text-2xs text-red-600 hover:underline">حذف</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}

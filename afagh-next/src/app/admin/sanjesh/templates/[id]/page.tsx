import Link from 'next/link';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { sanjesh_templates } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { loadTemplateByKey } from '@/lib/sanjesh/template-store';
import { getCurrentUniversity } from '@/lib/university-scope';
import { SANJESH_TEMPLATES } from '@/lib/sanjesh/templates';
import { saveTemplateAction } from '../../actions';
import { Flash } from '../../_ui';

export const dynamic = 'force-dynamic';

/** فیلدهای مقصد ممکن — همان مجموعهٔ صفحهٔ تطبیق فیلدها */
const TARGET_FIELDS: string[] = (() => {
  const set = new Set<string>();
  for (const t of SANJESH_TEMPLATES) for (const c of t.columns) set.add(c.targetField);
  return [...set].filter((f) => !f.startsWith('extra_')).sort();
})();

export default async function TemplateEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const key = decodeURIComponent(id);

  const uni = await getCurrentUniversity();
  const tpl = await loadTemplateByKey(key, uni?.id ?? null);
  if (!tpl) return <div className="p-6 text-sm text-red-600">قالب «{key}» یافت نشد.</div>;

  // isBuiltin فقط در دیتابیس است
  let dbRow: typeof sanjesh_templates.$inferSelect | undefined;
  try {
    const rows = await db.select().from(sanjesh_templates).where(eq(sanjesh_templates.key, key)).limit(5);
    // اولویت: قالب اختصاصی همین دانشگاه، بعد قالب سراسری
    dbRow = rows.find((r) => r.universityId != null && r.universityId === (uni?.id ?? null)) ?? rows.find((r) => r.universityId == null) ?? rows[0];
  } catch {
    dbRow = undefined;
  }
  const isBuiltin = dbRow?.isBuiltin ?? false;
  const templateId = dbRow?.id ?? 0;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-base font-bold text-slate-800">
            قالب <span dir="ltr">{tpl.key}</span> — {tpl.title}
          </h1>
          <p className="text-[11px] text-slate-500">
            {tpl.columnCount} ستون · نوع {tpl.examKind} · سال {tpl.examYear}
            {tpl.verifiedWithRealFile ? ' · اعتبارسنجی‌شده با فایل واقعی' : ' · بدون نمونهٔ واقعی'}
          </p>
        </div>
        <Link href="/admin/sanjesh/templates" className="btn-ghost !py-1 text-xs">
          ← فهرست قالب‌ها
        </Link>
      </header>

      <Flash msg={sp.msg} err={sp.err} />

      {isBuiltin && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          این قالب پیش‌فرض است و قابل ویرایش نیست. برای تغییر ساختار، از صفحهٔ قالب‌ها یک «کپی برای سال جدید» بسازید.
        </div>
      )}

      <form action={saveTemplateAction}>
        <input type="hidden" name="id" value={templateId} />
        <input type="hidden" name="key" value={tpl.key} />
        <input type="hidden" name="columnCount" value={tpl.columns.length} />

        <section className="card mb-3">
          <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
            <label className="col-span-2 flex min-w-0 flex-col gap-0.5 text-[10px] text-slate-500 md:col-span-5">
              <span>عنوان</span>
              <input name="title" defaultValue={tpl.title} disabled={isBuiltin} className="input !py-1 !px-2 text-xs" />
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-slate-500 md:col-span-2">
              <span>نوع آزمون</span>
              <select name="examKind" defaultValue={tpl.examKind} disabled={isBuiltin} className="input !py-1 !px-2 text-xs" dir="ltr">
                <option value="FANI">FANI</option>
                <option value="ARSHAD">ARSHAD</option>
                <option value="K2K">K2K</option>
                <option value="SARASARI">SARASARI</option>
                <option value="CUSTOM">CUSTOM</option>
              </select>
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-slate-500 md:col-span-2">
              <span>سال</span>
              <input name="examYear" defaultValue={tpl.examYear} disabled={isBuiltin} inputMode="numeric" className="input !py-1 !px-2 text-xs" dir="ltr" />
            </label>
            <div className="col-span-2 flex items-end md:col-span-3">
              <span className="text-[11px] text-slate-500">
                {tpl.columns.length.toLocaleString('fa-IR')} ستون
              </span>
            </div>
          </div>
        </section>

        <div className="max-h-[58vh] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 z-20 bg-slate-100 text-slate-600">
              <tr>
                <th className="sticky right-0 z-30 w-12 bg-slate-100 p-2 font-medium shadow-[-2px_0_0_0_#cbd5e1]">#</th>
                <th className="p-2 font-medium">عنوان ستون (سنجش)</th>
                <th className="w-20 p-2 font-medium">طول</th>
                <th className="w-64 p-2 font-medium">فیلد مقصد</th>
              </tr>
            </thead>
            <tbody>
              {tpl.columns.map((c) => {
                const isExtra = c.targetField.startsWith('extra_');
                return (
                  <tr key={c.colIndex} className={isExtra ? 'border-t border-slate-100 bg-amber-50/40' : 'border-t border-slate-100'}>
                    <td className="sticky right-0 z-10 bg-inherit p-2 text-center tabular-nums text-slate-500 shadow-[-2px_0_0_0_#e2e8f0]">
                      {c.colIndex}
                    </td>
                    <td className="p-1">
                      <input
                        name={`col_${c.colIndex}_title`}
                        defaultValue={c.sanjeshTitle}
                        disabled={isBuiltin}
                        className="input !py-1 !px-2 text-xs"
                      />
                    </td>
                    <td className="p-1">
                      <input
                        name={`col_${c.colIndex}_len`}
                        defaultValue={c.charCount}
                        disabled={isBuiltin}
                        inputMode="numeric"
                        className="input !py-1 !px-2 text-center text-xs"
                        dir="ltr"
                      />
                    </td>
                    <td className="p-1">
                      <select
                        name={`col_${c.colIndex}_field`}
                        defaultValue={isExtra ? '__none__' : c.targetField}
                        disabled={isBuiltin}
                        className="input !py-1 !px-2 text-xs"
                      >
                        <option value="__none__">— نگاشت‌نشده —</option>
                        {TARGET_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!isBuiltin && (
          <div className="mt-3">
            <button className="btn-primary !py-1.5 text-xs">ذخیرهٔ قالب</button>
          </div>
        )}
      </form>
    </div>
  );
}

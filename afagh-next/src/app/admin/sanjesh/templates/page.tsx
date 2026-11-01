import Link from 'next/link';

import { requireRole } from '@/lib/auth';
import { listTemplates } from '@/lib/sanjesh/template-store';
import { getCurrentUniversity } from '@/lib/university-scope';
import { buildTemplateFromFileAction, cloneTemplateAction, seedBuiltinTemplatesAction } from '../actions';
import { Flash } from '../_ui';

export const dynamic = 'force-dynamic';

export default async function SanjeshTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  const sp = (await searchParams) ?? {};
  const uni = await getCurrentUniversity();
  const templates = await listTemplates(uni?.id ?? null);

  return (
    <div className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-800">قالب‌های ساختار سنجش</h1>
          <p className="mt-1 text-xs text-slate-500">
            هر سال ممکن است چند فیلد به ساختار فایل اضافه یا کم شود. قالب‌ها در دیتابیس ذخیره می‌شوند و شما می‌توانید
            قالب تازه بسازید، از روی فایل بسازید، یا یک قالب موجود را برای سال جدید کپی و ویرایش کنید.
          </p>
        </div>
        <Link href="/admin/sanjesh" className="btn-ghost !py-1 text-xs">
          ← فایل‌های سنجش
        </Link>
      </header>

      <Flash msg={sp.msg} err={sp.err} />

      {/* فهرست قالب‌ها */}
      <section className="card mb-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">قالب‌های موجود ({templates.length.toLocaleString('fa-IR')})</h2>
          <form action={seedBuiltinTemplatesAction}>
            <button className="btn-ghost !py-1 text-xs">درج قالب‌های پیش‌فرض در دیتابیس</button>
          </form>
        </div>

        <div className="overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="p-2 font-medium">کلید</th>
                <th className="p-2 font-medium">عنوان</th>
                <th className="p-2 font-medium">نوع</th>
                <th className="p-2 font-medium">سال</th>
                <th className="p-2 font-medium">ستون</th>
                <th className="p-2 font-medium">منبع</th>
                <th className="p-2 font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.key} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-800 dark:even:bg-slate-900">
                  <td className="p-2 font-mono text-slate-700" dir="ltr">
                    {t.key}
                  </td>
                  <td className="p-2 text-slate-700">{t.title}</td>
                  <td className="p-2 text-slate-600" dir="ltr">
                    {t.examKind}
                  </td>
                  <td className="p-2 tabular-nums text-slate-600">{t.examYear}</td>
                  <td className="p-2 tabular-nums text-slate-600">{t.columnCount}</td>
                  <td className="p-2">
                    {t.verifiedWithRealFile ? (
                      <span className="badge bg-emerald-100 text-emerald-800">اعتبارسنجی‌شده با فایل واقعی</span>
                    ) : (
                      <span className="badge bg-amber-100 text-amber-800">بدون نمونهٔ واقعی</span>
                    )}
                  </td>
                  <td className="p-2">
                    <Link href={`/admin/sanjesh/templates/${encodeURIComponent(t.key)}`} className="text-[11px] text-teal-700 hover:underline">
                      ویرایش ستون‌ها
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ساخت قالب از روی فایل */}
      <section className="card mb-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">ساخت قالب از روی فایل</h2>
        <p className="mb-3 text-[11px] text-slate-500">
          فایل یک نمونه را بدهید؛ تعداد و طول ستون‌ها و نمونهٔ هر ستون استخراج می‌شود و یک قالب با ستون‌های عمومی ساخته
          می‌شود. بعد در صفحهٔ ویرایش، عنوان و فیلد مقصد هر ستون را تعیین کنید.
        </p>
        <form action={buildTemplateFromFileAction} className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
          <label className="col-span-2 flex min-w-0 flex-col gap-0.5 text-[10px] text-slate-500 md:col-span-4">
            <span>فایل نمونه</span>
            <input type="file" name="file" required accept=".txt,.dat,.csv,text/plain" className="input !py-1 text-xs" />
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-slate-500 md:col-span-2">
            <span>کلید (انگلیسی بزرگ)</span>
            <input name="key" required placeholder="FANI_1406" className="input !py-1 !px-2 text-xs" dir="ltr" />
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-slate-500 md:col-span-3">
            <span>عنوان</span>
            <input name="title" required placeholder="کاردانی فنی ۱۴۰۶" className="input !py-1 !px-2 text-xs" />
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-slate-500 md:col-span-1">
            <span>سال</span>
            <input name="examYear" defaultValue={1406} inputMode="numeric" className="input !py-1 !px-2 text-xs" dir="ltr" />
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-slate-500 md:col-span-1">
            <span>نوع</span>
            <select name="examKind" className="input !py-1 !px-2 text-xs" dir="ltr">
              <option value="FANI">FANI</option>
              <option value="ARSHAD">ARSHAD</option>
              <option value="K2K">K2K</option>
              <option value="SARASARI">SARASARI</option>
              <option value="CUSTOM">CUSTOM</option>
            </select>
          </label>
          <button className="btn-primary col-span-2 !py-1.5 text-xs md:col-span-1">ساخت</button>
        </form>
      </section>

      {/* کپی قالب موجود */}
      <section className="card">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">کپی قالب برای سال جدید</h2>
        <p className="mb-3 text-[11px] text-slate-500">
          قالب‌های پیش‌فرض قابل ویرایش نیستند؛ با کپی، یک نسخهٔ قابل ویرایش برای سال جدید بسازید و فیلدهای تغییر‌یافته را
          اصلاح کنید.
        </p>
        <form action={cloneTemplateAction} className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
          <label className="col-span-2 flex min-w-0 flex-col gap-0.5 text-[10px] text-slate-500 md:col-span-3">
            <span>قالب مبدأ</span>
            <select name="sourceKey" required className="input !py-1 !px-2 text-xs">
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.key} ({t.columnCount} ستون)
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-slate-500 md:col-span-2">
            <span>کلید جدید</span>
            <input name="newKey" required placeholder="FANI_1406" className="input !py-1 !px-2 text-xs" dir="ltr" />
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-slate-500 md:col-span-3">
            <span>عنوان</span>
            <input name="title" required placeholder="کاردانی فنی ۱۴۰۶" className="input !py-1 !px-2 text-xs" />
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-slate-500 md:col-span-1">
            <span>سال</span>
            <input name="examYear" defaultValue={1406} inputMode="numeric" className="input !py-1 !px-2 text-xs" dir="ltr" />
          </label>
          <button className="btn-primary col-span-2 !py-1.5 text-xs md:col-span-3">کپی و ویرایش</button>
        </form>
      </section>
    </div>
  );
}

import Link from 'next/link';
import { desc } from 'drizzle-orm';

import { db } from '@/db';
import { academic_terms, sanjesh_files } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { universityScope } from '@/lib/sanjesh/access';
import { countersForFiles } from '@/lib/sanjesh/ingest';
import { listTemplates } from '@/lib/sanjesh/template-store';
import { getCurrentUniversity } from '@/lib/university-scope';
import { deleteSanjeshFileAction, uploadSanjeshFileAction } from './actions';
import { Flash } from './_ui';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  FIELDS_READY: 'تطبیق فیلدها',
  VALUED: 'براورد شده',
  STAGED: 'منتقل به پذیرش',
  DONE: 'تکمیل',
};

export default async function SanjeshFilesPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  const sp = (await searchParams) ?? {};

  const uni = await getCurrentUniversity();
  const [files, templates, terms] = await Promise.all([
    (async () => {
      // دامنهٔ دانشگاه الزامی: هر دانشگاه فقط فایل‌های خودش را می‌بیند
      const scope = universityScope(sanjesh_files.universityId, uni?.id ?? null);
      const q = db.select().from(sanjesh_files);
      const rows = scope ? await q.where(scope).orderBy(desc(sanjesh_files.id)).limit(100)
                         : await q.orderBy(desc(sanjesh_files.id)).limit(100);
      return rows;
    })(),
    listTemplates(uni?.id ?? null),
    db
      .select({ id: academic_terms.id, termCode: academic_terms.termCode })
      .from(academic_terms)
      .orderBy(desc(academic_terms.termCode))
      .limit(20)
      .catch(() => [] as { id: number; termCode: string }[]),
  ]);

  const counters = await countersForFiles(files.map((f) => f.id));

  return (
    <div className="mx-auto max-w-6xl p-4">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-800">تبدیل اطلاعات سازمان سنجش</h1>
          <p className="mt-1 text-xs text-slate-500">
            فایل سنجش را بارگذاری کنید؛ همهٔ ستون‌ها (حتی نگاشت‌نشده‌ها) در دیتابیس ذخیره می‌شوند. سپس تطبیق فیلدها، براورد،
            تطبیق با دانشجویان و انتقال به صف پذیرش.
          </p>
        </div>
        {/* ادامهٔ جریان: صف پذیرش در همین ماژول است، نه کارت جداگانه در «آموزش» */}
        <Link
          href="/admin/admissions"
          className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-2xs font-bold text-indigo-800 hover:bg-indigo-100"
        >
          📥 صف پذیرش و ثبت‌نام نهایی ←
        </Link>
      </header>

      <Flash msg={sp.msg} err={sp.err} />

      {/* ── بارگذاری فایل ── */}
      <section className="card mb-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">بارگذاری فایل جدید</h2>
        <form action={uploadSanjeshFileAction} className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
          <label className="col-span-2 flex min-w-0 flex-col gap-0.5 text-3xs text-slate-500 md:col-span-4">
            <span>فایل سنجش (UTF-16LE / UTF-8 / Windows-1256)</span>
            <input type="file" name="file" accept=".txt,.dat,.csv,text/plain" required className="input !py-1 text-xs" />
          </label>
          <label className="col-span-2 flex min-w-0 flex-col gap-0.5 text-3xs text-slate-500 md:col-span-3">
            <span>عنوان فایل</span>
            <input name="title" className="input !py-1 !px-2 text-xs" placeholder="مثلاً کاردانی فنی ۱۴۰۵" />
          </label>
          <label className="col-span-2 flex min-w-0 flex-col gap-0.5 text-3xs text-slate-500 md:col-span-3">
            <span>قالب</span>
            <select name="templateKey" className="input !py-1 !px-2 text-xs">
              <option value="">تشخیص خودکار از تعداد ستون</option>
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.key} — {t.title} ({t.columnCount} ستون)
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-3xs text-slate-500 md:col-span-1">
            <span>سال</span>
            <input name="examYear" defaultValue={1405} inputMode="numeric" className="input !py-1 !px-2 text-xs" dir="ltr" />
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-3xs text-slate-500 md:col-span-1">
            <span>ترم مقصد</span>
            <select name="termId" className="input !py-1 !px-2 text-xs">
              <option value="">—</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.termCode}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-3xs text-slate-500 md:col-span-2">
            <span>جداکننده</span>
            <select name="separator" defaultValue="" className="input !py-1 !px-2 text-xs">
              <option value="">خودکار ($)</option>
              <option value="$">$ (پیش‌فرض سنجش)</option>
              <option value=",">کاما ,</option>
              <option value=";">نقطه‌ویرگول ;</option>
              <option value="|">پایپ |</option>
              <option value="\\t">تب</option>
            </select>
          </label>
          <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-3xs text-slate-500 md:col-span-2">
            <span>شیوهٔ کدینگ</span>
            <select name="encoding" defaultValue="" className="input !py-1 !px-2 text-xs">
              <option value="">تشخیص خودکار</option>
              <option value="utf-16le">UTF-16LE</option>
              <option value="utf-8">UTF-8</option>
              <option value="windows-1256">Windows-1256</option>
            </select>
          </label>
          <button className="btn-primary col-span-2 !py-1.5 text-xs md:col-span-2">بارگذاری و پارس</button>
        </form>
        <p className="mt-2 text-3xs text-slate-400">
          تعداد ستون از خودِ فایل خوانده می‌شود (نه از قالب) و بعد با قالب‌های شناخته‌شده مقایسه می‌شود؛
          چهار نوع فایل داریم: کاردانی ۵۷، ارشد ۷۴، کاردانی‌به‌کارشناسی ۶۹، سراسری ۸۵ ستون. اگر قالب را
          انتخاب نکنید و تعداد ستون دقیقاً برابر نباشد، نزدیک‌ترین قالب (حداکثر ۵ ستون اختلاف) انتخاب و
          هشدارش ثبت می‌شود. ستون‌های اضافه به‌عنوان «نگاشت‌نشده» ذخیره می‌شوند و از دست نمی‌روند.
        </p>
      </section>

      {/* ── فهرست فایل‌ها ── */}
      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">فایل‌های بارگذاری‌شده ({files.length.toLocaleString('fa-IR')})</h2>
          <Link href="/admin/sanjesh/templates" className="text-xs text-teal-700 hover:underline">
            مدیریت قالب‌ها ←
          </Link>
        </div>

        {files.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">هنوز فایلی بارگذاری نشده است.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-2 font-medium">عنوان</th>
                  <th className="p-2 font-medium">قالب</th>
                  <th className="p-2 font-medium">سال</th>
                  <th className="p-2 font-medium">ستون</th>
                  <th className="p-2 font-medium">ردیف</th>
                  <th className="p-2 font-medium">وضعیت تطبیق</th>
                  <th className="p-2 font-medium">وضعیت</th>
                  <th className="p-2 font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => {
                  const c = counters.get(f.id) ?? {};
                  const total = Object.values(c).reduce((s, n) => s + n, 0);
                  return (
                    <tr key={f.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-800 dark:even:bg-slate-900">
                      <td className="p-2">
                        <Link href={`/admin/sanjesh/${f.id}/fields`} className="font-medium text-teal-700 hover:underline">
                          {f.title}
                        </Link>
                        <div className="text-3xs text-slate-400" dir="ltr">
                          {f.fileName}
                        </div>
                      </td>
                      <td className="p-2 text-slate-600" dir="ltr">
                        {f.templateKey ?? '—'}
                      </td>
                      <td className="p-2 tabular-nums text-slate-600">{f.examYear ?? '—'}</td>
                      <td className="p-2 tabular-nums text-slate-600">{f.columnCount}</td>
                      <td className="p-2 tabular-nums text-slate-600">{f.rowCount.toLocaleString('fa-IR')}</td>
                      <td className="p-2 text-slate-600">
                        <span className="text-emerald-700">{c.MATCHED ?? 0}</span> /{' '}
                        <span className="text-slate-500">{total.toLocaleString('fa-IR')}</span>
                      </td>
                      <td className="p-2">
                        <span className="badge bg-slate-100 text-slate-600">{STATUS_LABEL[f.status] ?? f.status}</span>
                      </td>
                      <td className="p-2">
                        <form action={deleteSanjeshFileAction}>
                          <input type="hidden" name="id" value={f.id} />
                          <button className="text-2xs text-red-600 hover:underline">حذف</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

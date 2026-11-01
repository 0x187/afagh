import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { sanjesh_file_fields, sanjesh_files } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { getScopedFile } from '@/lib/sanjesh/access';
import { fileCounters } from '@/lib/sanjesh/ingest';
import { SANJESH_TEMPLATES } from '@/lib/sanjesh/templates';
import { autoMapFieldsAction, saveFieldMappingAction } from '../../actions';
import { Counter, Flash, SanjeshSteps } from '../../_ui';

export const dynamic = 'force-dynamic';

/** همهٔ فیلدهای مقصد ممکن — از اتحاد قالب‌های پیش‌فرض */
const ALL_TARGET_FIELDS: string[] = (() => {
  const set = new Set<string>();
  for (const t of SANJESH_TEMPLATES) for (const c of t.columns) set.add(c.targetField);
  // فیلدهای پرکاربرد که ممکن است در قالب‌های سفارشی لازم شوند
  for (const extra of [
    'uniqueId', 'fileNo', 'applicantNo', 'firstName', 'lastName', 'fatherName', 'gender',
    'birthDate', 'idNumber', 'nationalCode', 'mobile', 'phone', 'email', 'address', 'postalCode',
    'majorCode', 'majorTitle', 'fieldCode', 'fieldTitle', 'fieldPlaceCode', 'fieldPlaceTitle',
    'universityCode', 'universityTitle', 'orientationCode', 'orientationTitle',
    'quotaFinalCode', 'quotaAdmitCode', 'quotaRegCode', 'nativeProvinceCode',
    'provinceResidenceCode', 'cityResidenceCode', 'provinceCurrentCode', 'cityCurrentCode',
    'provinceDiplomaCode', 'diplomaCode', 'diplomaYear', 'diplomaGpa',
    'totalScore', 'totalRank', 'nationalRank', 'priority',
    'languageCode', 'languageTitle', 'religionCode', 'religionTitle',
    'disabilityCode', 'foreignerCode', 'foreignerRef', 'defectCode',
    'militaryStatusCode', 'courseCode', 'courseTitle', 'semesterCode', 'examStatus',
  ]) set.add(extra);
  return [...set].sort();
})();

const FIELD_LABEL: Record<string, string> = {
  uniqueId: 'شناسه یکتا',
  fileNo: 'شماره پرونده',
  applicantNo: 'شماره داوطلب',
  firstName: 'نام',
  lastName: 'نام خانوادگی',
  fatherName: 'نام پدر',
  gender: 'جنسیت',
  birthDate: 'تاریخ تولد',
  idNumber: 'شماره شناسنامه',
  nationalCode: 'کد ملی',
  mobile: 'تلفن همراه',
  phone: 'تلفن ثابت',
  email: 'پست الکترونیکی',
  address: 'نشانی',
  postalCode: 'کد پستی',
  majorCode: 'کد رشته',
  majorTitle: 'عنوان رشته',
  fieldCode: 'کد رشته امتحانی',
  fieldTitle: 'عنوان رشته امتحانی',
  fieldPlaceCode: 'کد رشته محل قبولی',
  fieldPlaceTitle: 'عنوان رشته محل قبولی',
  universityCode: 'کد دانشگاه',
  universityTitle: 'عنوان دانشگاه',
  orientationCode: 'کد گرایش',
  orientationTitle: 'عنوان گرایش',
  quotaFinalCode: 'کد سهمیه نهایی',
  quotaAdmitCode: 'کد سهمیه قبولی',
  quotaRegCode: 'کد سهمیه ثبت‌نامی',
  provinceResidenceCode: 'کد استان اقامت',
  cityResidenceCode: 'کد شهر اقامت',
  provinceCurrentCode: 'کد استان سکونت',
  cityCurrentCode: 'کد شهر سکونت',
  provinceDiplomaCode: 'کد استان اخذ دیپلم',
  diplomaCode: 'کد دیپلم',
  diplomaYear: 'سال اخذ دیپلم',
  diplomaGpa: 'معدل دیپلم',
  totalScore: 'نمره کل',
  totalRank: 'رتبه کل',
  nationalRank: 'رتبه کشوری',
  priority: 'اولویت قبولی',
  languageCode: 'کد زبان',
  languageTitle: 'عنوان زبان',
  religionCode: 'کد دین',
  disabilityCode: 'کد معلولیت',
  foreignerCode: 'کد اتباع خارجی',
  foreignerRef: 'کد پیگیری اتباع',
  defectCode: 'کد نقص',
  militaryStatusCode: 'وضعیت نظام وظیفه',
  courseCode: 'کد دوره',
  courseTitle: 'عنوان دوره',
  semesterCode: 'نیمسال قبولی',
  examStatus: 'وضعیت آزمون',
};

const label = (f: string) => FIELD_LABEL[f] ?? f;

export default async function SanjeshFieldsPage({
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
  if (!file) {
    return <div className="p-6 text-sm text-red-600">فایل یافت نشد.</div>;
  }

  const [fields, counters] = await Promise.all([
    db
      .select()
      .from(sanjesh_file_fields)
      .where(eq(sanjesh_file_fields.fileId, fileId))
      .orderBy(asc(sanjesh_file_fields.colIndex)),
    fileCounters(fileId),
  ]);

  const mapped = fields.filter((f) => f.isMapped).length;
  const warnings: string[] = Array.isArray(file.warningsJson) ? (file.warningsJson as string[]) : [];

  return (
    <div className="mx-auto max-w-6xl p-4">
      <SanjeshSteps fileId={fileId} active="fields" />
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-base font-bold text-slate-800">{file.title}</h1>
          <p className="text-[11px] text-slate-500" dir="ltr">
            {file.fileName} · {file.encoding} · {file.columnCount} col · {file.rowCount} rows
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Counter label="ردیف" value={counters.total} />
          <Counter label="تطبیق‌یافته" value={counters.matched} tone="emerald" />
          <Counter label="در انتظار" value={counters.pending} tone="amber" />
          <Counter label="نامعتبر" value={counters.invalid} tone="red" />
          <Counter label="ستون نگاشت‌نشده" value={counters.unmappedFields} tone="sky" />
        </div>
      </header>

      <Flash msg={sp.msg} err={sp.err} />

      {warnings.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          {warnings.map((w, i) => (
            <div key={i}>• {w}</div>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form action={autoMapFieldsAction}>
          <input type="hidden" name="fileId" value={fileId} />
          <button className="btn-ghost !py-1 text-xs">اعمال نگاشت قالب روی همهٔ ستون‌ها</button>
        </form>
        <span className="text-[11px] text-slate-500">
          {mapped} از {fields.length} ستون نگاشت شده است.
        </span>
      </div>

      <form action={saveFieldMappingAction}>
        <input type="hidden" name="fileId" value={fileId} />

        <div className="max-h-[64vh] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 z-20 bg-slate-100 text-slate-600">
              <tr>
                <th className="sticky right-0 z-30 w-14 bg-slate-100 p-2 font-medium shadow-[-2px_0_0_0_#cbd5e1]">ستون</th>
                <th className="p-2 font-medium">عنوان سنجش</th>
                <th className="w-16 p-2 font-medium">طول</th>
                <th className="p-2 font-medium">نمونهٔ فیلد</th>
                <th className="w-64 p-2 font-medium">فیلد مقصد آفاق</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id} className={f.isMapped ? 'border-t border-slate-100 bg-white' : 'border-t border-slate-100 bg-amber-50/50'}>
                  <td className="sticky right-0 z-10 bg-inherit p-2 text-center tabular-nums text-slate-500 shadow-[-2px_0_0_0_#e2e8f0]">
                    {f.colIndex}
                  </td>
                  <td className="p-2 text-slate-700">{f.sanjeshTitle}</td>
                  <td className="p-2 text-center tabular-nums text-slate-500">{f.charCount}</td>
                  <td className="max-w-[22rem] truncate p-2 text-slate-500" title={f.sampleValue ?? ''} dir="auto">
                    {f.sampleValue ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="p-1">
                    <select
                      name={`field_${f.colIndex}`}
                      defaultValue={f.targetField ?? '__none__'}
                      className="input !py-1 !px-2 text-xs"
                    >
                      <option value="__none__">— نگاشت‌نشده —</option>
                      {ALL_TARGET_FIELDS.map((tf) => (
                        <option key={tf} value={tf}>
                          {label(tf)} ({tf})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button className="btn-primary !py-1.5 text-xs">ذخیرهٔ تطبیق و بازنگاشت داده‌ها</button>
          <Link href={`/admin/sanjesh/${fileId}/rows`} className="btn-ghost !py-1.5 text-xs">
            مرحلهٔ بعد: لیست سنجش ←
          </Link>
        </div>
      </form>

      <p className="mt-2 text-[10px] text-slate-400">
        ستون‌های نگاشت‌نشده حذف نمی‌شوند؛ مقدار خامشان در همان ردیف ذخیره باقی می‌ماند. با تغییر نگاشت، داده‌ها از روی
        ستون‌های ذخیره‌شده بازسازی می‌شوند و نیازی به بارگذاری دوبارهٔ فایل نیست.
      </p>
    </div>
  );
}

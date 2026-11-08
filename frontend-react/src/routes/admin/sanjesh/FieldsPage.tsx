import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import {
  autoMapSanjeshFields,
  getSanjeshFields,
  saveSanjeshFieldMapping,
  type SanjeshFieldRow,
} from '@/lib/sanjesh-drilldown-api';

import { SanjeshCounter, SanjeshFlash, SanjeshSteps } from './_ui';

// ═══ /admin/sanjesh/:id/fields — port of sanjesh/[id]/fields/page.tsx ═══
// Column ↔ destination-field mapping. Unmapped columns keep their raw value in
// every row; changing the mapping rebuilds dataJson.fields without re-uploading.

/** All possible destination fields — union of the builtin templates + frequent extras. */
const ALL_TARGET_FIELDS: string[] = [
  'acceptedWithoutExam', 'academicRecordRef', 'address', 'admitStatus', 'applicantNo', 'associateGpa',
  'bachelorGpa', 'behyar', 'birthDate', 'cancelFormReceived', 'cityBirthCode', 'cityBirthTitle',
  'cityCurrentCode', 'cityCurrentTitle', 'cityDiplomaCode', 'cityPrev1Code', 'cityPrev2Code',
  'cityResidenceCode', 'cityResidenceTitle', 'commitmentCode', 'defectCode', 'degreeCode',
  'degreeDate', 'degreeUniversityCode', 'degreeUniversityTitle', 'diplomaCode', 'diplomaGpa',
  'diplomaTypeCode', 'diplomaYear', 'disabilityCode', 'disabilitySeverityCode', 'disabilityTitle',
  'districtBirthCode', 'districtDiplomaCode', 'districtPrev1Code', 'districtPrev2Code',
  'districtResidenceCode', 'educationSystemCode', 'email', 'employmentStatusCode', 'examStatus',
  'fieldCode', 'fieldGroup', 'fieldPlaceCode', 'fieldPlaceTitle', 'fileNo', 'firstName',
  'foreignerCode', 'foreignerRef', 'foreignerTitle', 'fatherName', 'gender', 'graduatedAssociate',
  'graduatedBachelor', 'graduatedMajorCode', 'graduatedMajorTitle', 'graduatedMaster',
  'graduatedPlaceCode', 'graduatedPlaceTitle', 'gpaMismatch', 'hasQuotaThreshold', 'healthCommitmentCode',
  'idNumber', 'languageCode', 'languageTitle', 'lastName', 'leftHanded', 'majorCode', 'majorTitle',
  'militaryStatusCode', 'mobile', 'nationalCode', 'nationalRank', 'nativeFlag', 'nativeProvinceCode',
  'orientationCode', 'orientationRank', 'orientationTitle', 'phone', 'postalCode', 'preUniversityTypeCode',
  'preUniversityYear', 'previousFieldCode', 'previousFieldGroup', 'previousFieldRow', 'priority',
  'provinceBirthCode', 'provinceCurrentCode', 'provinceCurrentTitle', 'provinceDiplomaCode',
  'provinceDiplomaTitle', 'provincePrev1Code', 'provincePrev2Code', 'provinceResidenceCode',
  'provinceResidenceTitle', 'quotaAdmitCode', 'quotaAdmitTitle', 'quotaFinalCode', 'quotaFinalTitle',
  'quotaRank', 'quotaRegCode', 'quotaRegTitle', 'religionCode', 'religionTitle', 'semesterCode',
  'teacher', 'topStudent', 'totalRank', 'totalScore', 'uniqueId', 'universityCode', 'universityTitle',
  'veteranMonths', 'veteranOrgTitle', 'veteranTypeCode',
  // raw scores 1..21 (expanded rows)
  ...Array.from({ length: 21 }, (_, i) => `rawScore${i + 1}`),
].sort();

const FIELD_LABEL: Record<string, string> = {
  uniqueId: 'شناسه یکتا', fileNo: 'شماره پرونده', applicantNo: 'شماره داوطلب',
  firstName: 'نام', lastName: 'نام خانوادگی', fatherName: 'نام پدر', gender: 'جنسیت',
  birthDate: 'تاریخ تولد', idNumber: 'شماره شناسنامه', nationalCode: 'کد ملی',
  mobile: 'تلفن همراه', phone: 'تلفن ثابت', email: 'پست الکترونیکی', address: 'نشانی',
  postalCode: 'کد پستی', majorCode: 'کد رشته', majorTitle: 'عنوان رشته',
  fieldCode: 'کد رشته امتحانی', fieldTitle: 'عنوان رشته امتحانی',
  fieldPlaceCode: 'کد رشته محل قبولی', fieldPlaceTitle: 'عنوان رشته محل قبولی',
  universityCode: 'کد دانشگاه', universityTitle: 'عنوان دانشگاه',
  orientationCode: 'کد گرایش', orientationTitle: 'عنوان گرایش',
  quotaFinalCode: 'کد سهمیه نهایی', quotaAdmitCode: 'کد سهمیه قبولی', quotaRegCode: 'کد سهمیه ثبت‌نامی',
  provinceResidenceCode: 'کد استان اقامت', cityResidenceCode: 'کد شهر اقامت',
  provinceCurrentCode: 'کد استان سکونت', cityCurrentCode: 'کد شهر سکونت',
  provinceDiplomaCode: 'کد استان اخذ دیپلم', diplomaCode: 'کد دیپلم',
  diplomaYear: 'سال اخذ دیپلم', diplomaGpa: 'معدل دیپلم',
  totalScore: 'نمره کل', totalRank: 'رتبه کل', nationalRank: 'رتبه کشوری', priority: 'اولویت قبولی',
  languageCode: 'کد زبان', languageTitle: 'عنوان زبان', religionCode: 'کد دین',
  disabilityCode: 'کد معلولیت', foreignerCode: 'کد اتباع خارجی', foreignerRef: 'کد پیگیری اتباع',
  defectCode: 'کد نقص', militaryStatusCode: 'وضعیت نظام وظیفه', courseCode: 'کد دوره',
  courseTitle: 'عنوان دوره', semesterCode: 'نیمسال قبولی', examStatus: 'وضعیت آزمون',
};

const label = (f: string) => FIELD_LABEL[f] ?? f;

export function SanjeshFieldsPage() {
  const params = useParams();
  const fileId = Number(params.id);
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sanjesh-fields', fileId],
    queryFn: () => getSanjeshFields(fileId),
    enabled: Number.isFinite(fileId) && fileId > 0,
  });

  // Local mapping edits keyed by column index — saved as one batch.
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const view = data;
  const fields: SanjeshFieldRow[] = view?.fields ?? [];
  const mapped = useMemo(() => fields.filter((f) => (edits[f.colIndex] !== undefined ? edits[f.colIndex] !== '' : f.isMapped)).length, [fields, edits]);

  const current = (f: SanjeshFieldRow) =>
    edits[f.colIndex] !== undefined ? edits[f.colIndex] : (f.targetField ?? '');

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const updates = fields.map((f) => ({ colIndex: f.colIndex, target: current(f) }));
      const message = await saveSanjeshFieldMapping(fileId, updates);
      setMsg({ kind: 'ok', text: message });
      setEdits({});
      await qc.invalidateQueries({ queryKey: ['sanjesh-fields', fileId] });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'ذخیرهٔ تطبیق ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  };

  const autoMap = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const message = await autoMapSanjeshFields(fileId);
      setMsg({ kind: 'ok', text: message });
      setEdits({});
      await qc.invalidateQueries({ queryKey: ['sanjesh-fields', fileId] });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'نگاشت خودکار ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  };

  if (!Number.isFinite(fileId) || fileId <= 0)
    return <p className="p-6 text-sm text-red-600">شناسهٔ فایل نامعتبر است.</p>;
  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !view)
    return (
      <p className="p-6 text-sm text-red-600">
        {error instanceof Error ? error.message : 'فایل یافت نشد.'}
      </p>
    );

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <SanjeshSteps fileId={fileId} active="fields" />
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-base font-black text-foreground">{view.file.title}</h1>
          <p className="text-[10px] text-muted-foreground" dir="ltr">
            {view.file.fileName} · {view.file.encoding} · {faNumber(view.file.columnCount)} col · {faNumber(view.file.rowCount)} rows
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <SanjeshCounter label="ردیف" value={view.counters.total} />
          <SanjeshCounter label="تطبیق‌یافته" value={view.counters.matched} tone="emerald" />
          <SanjeshCounter label="در انتظار" value={view.counters.pending} tone="amber" />
          <SanjeshCounter label="نامعتبر" value={view.counters.invalid} tone="red" />
          <SanjeshCounter label="ستون نگاشت‌نشده" value={view.counters.unmappedFields} tone="sky" />
        </div>
      </header>

      <SanjeshFlash msg={msg?.kind === 'ok' ? msg.text : null} err={msg?.kind === 'err' ? msg.text : null} />

      {(view.file.warnings ?? []).length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {view.file.warnings.map((w, i) => (
            <div key={i}>• {w}</div>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={autoMap}>
          اعمال نگاشت قالب روی همهٔ ستون‌ها
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {faNumber(mapped)} از {faNumber(fields.length)} ستون نگاشت شده است.
        </span>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="max-h-[64vh] overflow-auto rounded-xl border border-border">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 z-20 bg-muted text-muted-foreground">
                <tr>
                  <th className="sticky right-0 z-30 w-14 bg-muted p-2 font-bold shadow-[-2px_0_0_0_rgba(148,163,184,0.5)]">ستون</th>
                  <th className="p-2 font-bold">عنوان سنجش</th>
                  <th className="w-16 p-2 font-bold">طول</th>
                  <th className="p-2 font-bold">نمونهٔ فیلد</th>
                  <th className="w-64 p-2 font-bold">فیلد مقصد آفاق</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr
                    key={f.id}
                    className={
                      current(f) !== ''
                        ? 'border-t border-border/50 bg-transparent'
                        : 'border-t border-border/50 bg-amber-50/50 dark:bg-amber-950/20'
                    }
                  >
                    <td className="sticky right-0 z-10 bg-inherit p-2 text-center tabular-nums text-muted-foreground shadow-[-2px_0_0_0_rgba(148,163,184,0.35)]">
                      {faNumber(f.colIndex)}
                    </td>
                    <td className="p-2">{f.sanjeshTitle}</td>
                    <td className="p-2 text-center tabular-nums text-muted-foreground">{faNumber(f.charCount)}</td>
                    <td className="max-w-[22rem] truncate p-2 text-muted-foreground" title={f.sampleValue ?? ''} dir="auto">
                      {f.sampleValue ?? <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="p-1">
                      <select
                        value={current(f)}
                        onChange={(e) => setEdits((m) => ({ ...m, [f.colIndex]: e.target.value }))}
                        className="w-full rounded-lg border border-input bg-card px-2 py-1 text-xs"
                      >
                        <option value="">— نگاشت‌نشده —</option>
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

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={save}>
              {busy ? 'در حال ذخیره…' : 'ذخیرهٔ تطبیق و بازنگاشت داده‌ها'}
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link to={`/admin/sanjesh/${fileId}/rows`}>مرحلهٔ بعد: لیست سنجش ←</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-[10px] leading-5 text-muted-foreground">
        ستون‌های نگاشت‌نشده حذف نمی‌شوند؛ مقدار خامشان در همان ردیف ذخیره باقی می‌ماند. با تغییر نگاشت، داده‌ها از روی
        ستون‌های ذخیره‌شده بازسازی می‌شوند و نیازی به بارگذاری دوبارهٔ فایل نیست.
      </p>
    </div>
  );
}

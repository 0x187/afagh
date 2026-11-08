import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import {
  getSanjeshTemplate,
  saveSanjeshTemplate,
  type SanjeshTemplateColumnInput,
} from '@/lib/sanjesh-drilldown-api';

import { SanjeshFlash } from './_ui';

// ═══ /admin/sanjesh/templates/:key — port of sanjesh/templates/[id]/page.tsx ═══
// Column editor of one template. Builtin templates are locked — clone them
// from the templates page first. Unmapped columns are stored as null so the
// raw data survives the remap.

const EXAM_KINDS = ['FANI', 'ARSHAD', 'K2K', 'SARASARI', 'CUSTOM'] as const;

/** Possible destination fields — the same set as the fields page (without extra_*). */
const TARGET_FIELDS: string[] = [
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
].sort();

export function SanjeshTemplateDetailPage() {
  const params = useParams();
  const key = decodeURIComponent(params.key ?? '');
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sanjesh-template', key],
    queryFn: () => getSanjeshTemplate(key),
    enabled: key !== '',
  });

  const tpl = data?.template;
  // isBuiltin comes from the database row only (the builtin code fallback is
  // always locked too).
  const isBuiltin = data?.db?.isBuiltin ?? tpl?.isBuiltin ?? true;
  const templateId = data?.db?.id ?? 0;

  const [edits, setEdits] = useState<Record<number, SanjeshTemplateColumnInput>>({});
  const [meta, setMeta] = useState<{ title: string; examKind: string; examYear: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const col = (c: SanjeshTemplateColumnInput): SanjeshTemplateColumnInput =>
    edits[c.colIndex] ?? { ...c, targetField: c.targetField ?? '' };
  const metaOf = () =>
    meta ?? { title: tpl?.title ?? '', examKind: tpl?.examKind ?? 'CUSTOM', examYear: String(tpl?.examYear ?? '') };

  const save = async () => {
    if (!tpl) return;
    setBusy(true);
    setMsg(null);
    try {
      const m = metaOf();
      const message = await saveSanjeshTemplate({
        id: templateId,
        key: tpl.key,
        title: m.title.trim(),
        examKind: m.examKind,
        examYear: Number(m.examYear),
        columns: tpl.columns.map((c) => col({ colIndex: c.colIndex, sanjeshTitle: c.sanjeshTitle, charCount: c.charCount, targetField: c.targetField ?? '' })),
      });
      setMsg({ kind: 'ok', text: message });
      setEdits({});
      setMeta(null);
      await qc.invalidateQueries({ queryKey: ['sanjesh-template', key] });
      await qc.invalidateQueries({ queryKey: ['sanjesh-templates'] });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'ذخیرهٔ قالب ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  };

  if (key === '') return <p className="p-6 text-sm text-red-600">کلید قالب نامعتبر است.</p>;
  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !tpl)
    return <p className="p-6 text-sm text-red-600">{error instanceof Error ? error.message : `قالب «${key}» یافت نشد.`}</p>;

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-base font-black text-foreground">
            قالب <span dir="ltr">{tpl.key}</span> — {tpl.title}
          </h1>
          <p className="text-[11px] text-muted-foreground">
            {faNumber(tpl.columnCount)} ستون · نوع {tpl.examKind} · سال {faNumber(tpl.examYear)}
            {tpl.verifiedWithRealFile ? ' · اعتبارسنجی‌شده با فایل واقعی' : ' · بدون نمونهٔ واقعی'}
          </p>
        </div>
        <Button size="sm" variant="ghost" asChild>
          <Link to="/admin/sanjesh/templates">← فهرست قالب‌ها</Link>
        </Button>
      </header>

      <SanjeshFlash msg={msg?.kind === 'ok' ? msg.text : null} err={msg?.kind === 'err' ? msg.text : null} />

      {isBuiltin && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          این قالب پیش‌فرض است و قابل ویرایش نیست. برای تغییر ساختار، از صفحهٔ قالب‌ها یک «کپی برای سال جدید» بسازید.
        </div>
      )}

      <Card className="mb-3">
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
            <label className="col-span-2 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-5">
              <span>عنوان</span>
              <input
                value={metaOf().title}
                disabled={isBuiltin}
                onChange={(e) => setMeta((m) => ({ ...(m ?? metaOf()), title: e.target.value }))}
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs disabled:opacity-60"
              />
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-2">
              <span>نوع آزمون</span>
              <select
                value={metaOf().examKind}
                disabled={isBuiltin}
                onChange={(e) => setMeta((m) => ({ ...(m ?? metaOf()), examKind: e.target.value }))}
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs disabled:opacity-60"
                dir="ltr"
              >
                {EXAM_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-2">
              <span>سال</span>
              <input
                value={metaOf().examYear}
                disabled={isBuiltin}
                inputMode="numeric"
                onChange={(e) => setMeta((m) => ({ ...(m ?? metaOf()), examYear: e.target.value }))}
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs disabled:opacity-60"
                dir="ltr"
              />
            </label>
            <div className="col-span-2 flex items-end md:col-span-3">
              <span className="text-[11px] text-muted-foreground">{faNumber(tpl.columns.length)} ستون</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="max-h-[58vh] overflow-auto rounded-xl border border-border">
        <table className="w-full text-right text-xs">
          <thead className="sticky top-0 z-20 bg-muted text-muted-foreground">
            <tr>
              <th className="sticky right-0 z-30 w-12 bg-muted p-2 font-bold shadow-[-2px_0_0_0_rgba(148,163,184,0.5)]">#</th>
              <th className="p-2 font-bold">عنوان ستون (سنجش)</th>
              <th className="w-20 p-2 font-bold">طول</th>
              <th className="w-64 p-2 font-bold">فیلد مقصد</th>
            </tr>
          </thead>
          <tbody>
            {tpl.columns.map((c) => {
              const cur = col({ colIndex: c.colIndex, sanjeshTitle: c.sanjeshTitle, charCount: c.charCount, targetField: c.targetField ?? '' });
              const isExtra = c.targetField != null && c.targetField.startsWith('extra_');
              return (
                <tr key={c.colIndex} className={isExtra ? 'border-t border-border/50 bg-amber-50/40 dark:bg-amber-950/20' : 'border-t border-border/50'}>
                  <td className="sticky right-0 z-10 bg-inherit p-2 text-center tabular-nums text-muted-foreground shadow-[-2px_0_0_0_rgba(148,163,184,0.35)]">
                    {faNumber(c.colIndex)}
                  </td>
                  <td className="p-1">
                    <input
                      value={cur.sanjeshTitle}
                      disabled={isBuiltin}
                      onChange={(e) => setEdits((m) => ({ ...m, [c.colIndex]: { ...cur, sanjeshTitle: e.target.value } }))}
                      className="w-full rounded-lg border border-input bg-card px-2 py-1 text-xs disabled:opacity-60"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      value={String(cur.charCount)}
                      disabled={isBuiltin}
                      inputMode="numeric"
                      onChange={(e) => setEdits((m) => ({ ...m, [c.colIndex]: { ...cur, charCount: Number(e.target.value) || 0 } }))}
                      className="w-full rounded-lg border border-input bg-card px-2 py-1 text-center text-xs disabled:opacity-60"
                      dir="ltr"
                    />
                  </td>
                  <td className="p-1">
                    <select
                      value={isExtra ? '' : cur.targetField}
                      disabled={isBuiltin}
                      onChange={(e) => setEdits((m) => ({ ...m, [c.colIndex]: { ...cur, targetField: e.target.value } }))}
                      className="w-full rounded-lg border border-input bg-card px-2 py-1 text-xs disabled:opacity-60"
                    >
                      <option value="">— نگاشت‌نشده —</option>
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
          <Button size="sm" disabled={busy} onClick={save}>
            {busy ? 'در حال ذخیره…' : 'ذخیرهٔ قالب'}
          </Button>
        </div>
      )}
    </div>
  );
}

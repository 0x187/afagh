import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, FileSpreadsheet, GraduationCap, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, toEnDigits } from '@/lib/fa';
import {
  getAdmissionsBundle,
  importStaged,
  registerManualStudent,
  saveSanjeshMapping,
  saveStudentIdFormula,
  stageSanjesh,
  testIrandoc,
  type AdmissionsBundle,
  type IrandocResult,
  type ManualAdmissionInput,
  type StagingItem,
} from '@/lib/admissions-api';

// ═══ Admissions: Sanjesh, student-number formula, manual entry, and Irandoc test — port of admin/admissions ═══

const SAMPLE = `0011223344, علیرضا, پیروزمند, 11204, منطقه ۱, 09121111111, 1420, کنکور, کارشناسی, مهندسی, 1
0022334455, نگین, شجاعی, 11205, منطقه ۲, 09122222222, 2150, کنکور, کارشناسی, مهندسی, 1
0033445566, سهراب, کیانی, 11301, منطقه ۱, 09123333333, 980, کنکور, کارشناسی, مهندسی, 1
0044556677, آناهیتا, کریمی, 99999, سهمیه ایثارگران, 09124444444, 4500, آزاد, کارشناسی ارشد, مدیریت, 2`;

type Tab = 'SANJESH_STAGING' | 'ID_FORMULA' | 'MANUAL_ADMISSION' | 'IRANDOC_TEST';

const TABS: { key: Tab; label: string; icon: typeof GraduationCap }[] = [
  { key: 'SANJESH_STAGING', label: 'ورود دادهٔ سنجش', icon: FileSpreadsheet },
  { key: 'ID_FORMULA', label: 'فرمول شماره دانشجویی', icon: ClipboardCheck },
  { key: 'MANUAL_ADMISSION', label: 'ثبت‌نام دستی', icon: UserPlus },
  { key: 'IRANDOC_TEST', label: 'تست ایرانداک', icon: GraduationCap },
];

function jdate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
  } catch {
    return '—';
  }
}

export function AdminAdmissionsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('SANJESH_STAGING');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const { data, isLoading, isError } = useQuery({ queryKey: ['admissions-bundle'], queryFn: getAdmissionsBundle, staleTime: 20_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admissions-bundle'] });

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت دادهٔ پذیرش ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-violet-800 via-indigo-800 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black"><GraduationCap className="size-5" aria-hidden /> پذیرش دانشجو (ورود دادهٔ سازمان سنجش)</h1>
          <p className="mt-1 text-xs text-indigo-100">نگاشت کد رشته‌های سنجش، ورود گروهی داوطلبان، فرمول شماره دانشجویی، ثبت دستی و استعلام ایرانداک</p>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="text-muted-foreground"><span aria-hidden>✕</span><span className="sr-only">بستن</span></button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-black ${tab === t.key ? 'border-indigo-800 bg-indigo-700 text-white' : 'border-border bg-card text-muted-foreground'}`}>
              <Icon className="size-3.5" aria-hidden /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'SANJESH_STAGING' ? <StagingTab bundle={data} onMsg={setMsg} onRefresh={refresh} /> : null}
      {tab === 'ID_FORMULA' ? <FormulaTab bundle={data} onMsg={setMsg} onRefresh={refresh} /> : null}
      {tab === 'MANUAL_ADMISSION' ? <ManualTab bundle={data} onMsg={setMsg} onRefresh={refresh} /> : null}
      {tab === 'IRANDOC_TEST' ? <IrandocTab onMsg={setMsg} /> : null}
    </div>
  );
}

function StagingTab({ bundle, onMsg, onRefresh }: {
  bundle: AdmissionsBundle;
  onMsg: (m: { kind: 'ok' | 'err'; text: string }) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [rawText, setRawText] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mapping, setMapping] = useState({ code: '', majorId: bundle.majors[0]?.id ?? 0, quota: '' });

  const stageMut = useMutation({
    mutationFn: () => stageSanjesh(rawText, 1405),
    onSuccess: async (r) => {
      onMsg({ kind: 'ok', text: `${faNumber(r.count)} ردیف در Staging ثبت شد.` });
      setSelected(new Set());
      await onRefresh();
    },
    onError: (e: Error) => onMsg({ kind: 'err', text: e.message }),
  });
  const importMut = useMutation({
    mutationFn: () => importStaged([...selected]),
    onSuccess: async (r) => {
      const fail = r.failures.length ? ` — ${faNumber(r.failures.length)} خطا` : '';
      onMsg({ kind: r.failures.length ? 'err' : 'ok', text: `${faNumber(r.imported.length)} دانشجو ثبت شد${fail}.` });
      setSelected(new Set());
      await onRefresh();
    },
    onError: (e: Error) => onMsg({ kind: 'err', text: e.message }),
  });
  const mapMut = useMutation({
    mutationFn: () => saveSanjeshMapping(mapping.code.trim(), mapping.majorId, mapping.quota),
    onSuccess: async () => {
      onMsg({ kind: 'ok', text: 'نگاشت ذخیره شد.' });
      setMapping({ ...mapping, code: '' });
      await onRefresh();
    },
    onError: (e: Error) => onMsg({ kind: 'err', text: e.message }),
  });

  const resolved = bundle.stagingList.filter((s) => s.status === 'RESOLVED' && !s.studentId);
  const allSelected = resolved.length > 0 && resolved.every((s) => selected.has(s.id));
  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-2 pt-4">
          <h3 className="text-xs font-black">۱) ورود دادهٔ متنی سازمان سنجش</h3>
          <p className="text-[11px] text-muted-foreground">هر خط: کد ملی، نام، نام خانوادگی، کد رشتهٔ سنجش، سهمیه، موبایل، رتبه، نوع آزمون، مقطع، گروه رشته، کد دانشگاه (ستون‌های اختیاری).</p>
          <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={5} className="w-full rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-[11px]" placeholder="کد ملی, نام, نام خانوادگی, کد رشته سنجش, سهمیه…" dir="ltr" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!rawText.trim() || stageMut.isPending} onClick={() => stageMut.mutate()}>{stageMut.isPending ? 'در حال پردازش…' : 'پردازش و Stage'}</Button>
            <Button size="sm" variant="outline" onClick={() => setRawText(SAMPLE)}>بارگذاری نمونه</Button>
            <Button size="sm" variant="outline" onClick={() => setRawText('')}>پاک‌کردن</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-black">۲) داوطلبان Staging ({faNumber(bundle.stagingList.length)} ردیف اخیر)</h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setSelected(new Set(resolved.map((s) => s.id)))}>انتخاب همهٔ آماده‌ها</Button>
              <Button size="sm" disabled={selected.size === 0 || importMut.isPending} onClick={() => importMut.mutate()}>
                {importMut.isPending ? 'در حال ثبت…' : `ثبت نهایی ${faNumber(selected.size)} نفر`}
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-[11px]">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="p-2"><input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(resolved.map((s) => s.id)) : new Set())} /></th>
                  {['کد ملی', 'نام', 'کد سنجش', 'نوع آزمون', 'مقطع', 'گروه رشته', 'رشتهٔ دانشگاه', 'سهمیه', 'کد دانشگاه', 'وضعیت'].map((h) => <th key={h} className="whitespace-nowrap p-2 text-right font-black">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {bundle.stagingList.map((s: StagingItem) => {
                  const ready = s.status === 'RESOLVED' && !s.studentId;
                  return (
                    <tr key={s.id} className="border-t border-border/50">
                      <td className="p-2 text-center">{ready ? <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} /> : null}</td>
                      <td className="p-2 font-mono" dir="ltr">{faDigits(s.nationalCode)}</td>
                      <td className="p-2 font-bold">{s.fullName ?? '—'}</td>
                      <td className="p-2 font-mono" dir="ltr">{s.rawSanjeshData?.sanjeshCode ?? '—'}</td>
                      <td className="p-2">{s.rawSanjeshData?.examType ?? '—'}</td>
                      <td className="p-2">{s.rawSanjeshData?.degreeLevel ?? '—'}</td>
                      <td className="p-2">{s.rawSanjeshData?.majorGroup ?? '—'}</td>
                      <td className="p-2">{s.mappedMajorName ?? '—'}</td>
                      <td className="p-2">{s.rawSanjeshData?.quota ?? s.quotaType ?? '—'}</td>
                      <td className="p-2 font-mono" dir="ltr">{s.rawSanjeshData?.universityCode ?? '—'}</td>
                      <td className="p-2">
                        <Badge variant={s.studentId ? 'success' : s.status === 'RESOLVED' ? 'accent' : 'warning'}>
                          {s.studentId ? 'ثبت‌شده' : s.status === 'RESOLVED' ? 'آمادهٔ ثبت' : 'بدون نگاشت'}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
                {bundle.stagingList.length === 0 ? <tr><td colSpan={11} className="p-6 text-center text-muted-foreground">داده‌ای در Staging نیست.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <h3 className="text-xs font-black">۳) نگاشت کد رشتهٔ سنجش به رشتهٔ دانشگاه</h3>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>کد سنجش</span><Input value={mapping.code} onChange={(e) => setMapping({ ...mapping, code: toEnDigits(e.target.value) })} className="h-8 w-32 font-mono" dir="ltr" /></label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>رشتهٔ داخلی</span>
              <select value={mapping.majorId} onChange={(e) => setMapping({ ...mapping, majorId: Number(e.target.value) })} className="h-8 max-w-64 rounded-lg border border-input bg-card px-2 text-[11px]">
                {bundle.majors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>سهمیه</span><Input value={mapping.quota} onChange={(e) => setMapping({ ...mapping, quota: e.target.value })} className="h-8 w-40" placeholder="سهمیه عادی" /></label>
            <Button size="sm" disabled={!mapping.code.trim() || !mapping.majorId || mapMut.isPending} onClick={() => mapMut.mutate()}>ذخیرهٔ نگاشت</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-[11px]">
              <thead className="bg-muted/60 text-muted-foreground"><tr>{['کد سنجش', 'رشتهٔ داخلی', 'سهمیه'].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
              <tbody>
                {bundle.mappings.map((m) => (
                  <tr key={m.id} className="border-t border-border/50">
                    <td className="p-2 font-mono" dir="ltr">{m.sanjeshCode}</td>
                    <td className="p-2">{m.majorName ?? '—'}</td>
                    <td className="p-2">{m.sanjeshQuota ?? '—'}</td>
                  </tr>
                ))}
                {bundle.mappings.length === 0 ? <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">نگاشتی ثبت نشده است.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <h3 className="mb-2 text-xs font-black">۴) لاگ استعلام‌های سرویس (۲۰ مورد اخیر)</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-[11px]">
              <thead className="bg-muted/60 text-muted-foreground"><tr>{['سرویس', 'نشانی', 'کد پاسخ', 'مدت', 'نتیجه', 'زمان'].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
              <tbody>
                {bundle.apiLogs.map((l) => (
                  <tr key={l.id} className="border-t border-border/50">
                    <td className="p-2 font-mono" dir="ltr">{l.serviceName}</td>
                    <td className="max-w-64 truncate p-2 font-mono text-[10px]" dir="ltr" title={l.requestUrl}>{l.requestUrl}</td>
                    <td className="p-2 font-mono">{l.responseStatus ?? '—'}</td>
                    <td className="p-2 font-mono">{l.durationMs != null ? `${faNumber(l.durationMs)}ms` : '—'}</td>
                    <td className="p-2">{l.isSuccess ? '✅' : '⛔'}</td>
                    <td className="p-2">{jdate(l.executedAt)}</td>
                  </tr>
                ))}
                {bundle.apiLogs.length === 0 ? <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">لاگی ثبت نشده است.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FormulaTab({ bundle, onMsg, onRefresh }: {
  bundle: { degreeLevels: { id: number; title: string; code: string }[]; formulas: { degreeLevelId: number | null; formula: string; currentSequence: number | null }[] };
  onMsg: (m: { kind: 'ok' | 'err'; text: string }) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [degreeId, setDegreeId] = useState(bundle.degreeLevels[0]?.id ?? 1);
  const initial = bundle.formulas.find((f) => f.degreeLevelId === degreeId)?.formula ?? '{Year:2}{DegreeCode:1}{MajorCode:3}{Seq:3}';
  const [formula, setFormula] = useState(initial);
  const [simYear, setSimYear] = useState(1405);
  const [simMajor, setSimMajor] = useState('412');
  const [simSeq, setSimSeq] = useState(15);

  const saveMut = useMutation({
    mutationFn: () => saveStudentIdFormula(degreeId, formula),
    onSuccess: async () => { onMsg({ kind: 'ok', text: 'فرمول ذخیره شد.' }); await onRefresh(); },
    onError: (e: Error) => onMsg({ kind: 'err', text: e.message }),
  });

  const preview = useMemo(() => {
    const level = bundle.degreeLevels.find((l) => l.id === degreeId);
    const digit = level?.code === 'BS' ? '1' : level?.code === 'MS' ? '2' : level?.code === 'PHD' ? '3' : '1';
    let out = formula
      .replaceAll('{Year:2}', String(simYear).slice(-2))
      .replaceAll('{DegreeCode:1}', digit)
      .replaceAll('{MajorCode:3}', toEnDigits(String(simMajor)).padStart(3, '0').slice(-3))
      .replaceAll('{Seq:3}', String(simSeq).padStart(3, '0'))
      .replaceAll('{QuotaCode:1}', '1');
    if (!out || out === formula) out = `${String(simYear).slice(-2)}${digit}${String(simMajor).padStart(3, '0').slice(-3)}${String(simSeq).padStart(3, '0')}`;
    return out;
  }, [formula, degreeId, simYear, simMajor, simSeq, bundle.degreeLevels]);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardContent className="space-y-2 pt-4">
          <h3 className="text-xs font-black">فرمول شمارهٔ دانشجویی هر مقطع</h3>
          <label className="block space-y-1 text-[10px] text-muted-foreground"><span>مقطع</span>
            <select
              value={degreeId}
              onChange={(e) => {
                const id = Number(e.target.value);
                setDegreeId(id);
                setFormula(bundle.formulas.find((f) => f.degreeLevelId === id)?.formula ?? '{Year:2}{DegreeCode:1}{MajorCode:3}{Seq:3}');
              }}
              className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px]"
            >
              {bundle.degreeLevels.map((l) => <option key={l.id} value={l.id}>{l.title} ({l.code})</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-[10px] text-muted-foreground"><span>الگو</span><Input value={formula} onChange={(e) => setFormula(e.target.value)} className="h-8 font-mono text-[11px]" dir="ltr" /></label>
          <p className="text-[10px] leading-5 text-muted-foreground">
            متغیرها: <code>{'{Year:2}'}</code> سال ورود دو رقم، <code>{'{DegreeCode:1}'}</code> کد مقطع، <code>{'{MajorCode:3}'}</code> کد رشته، <code>{'{Seq:3}'}</code> شمارنده، <code>{'{QuotaCode:1}'}</code> کد سهمیه.
          </p>
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px]">
            شمارندهٔ فعلی: <b className="font-mono">{faNumber(bundle.formulas.find((f) => f.degreeLevelId === degreeId)?.currentSequence ?? 0)}</b>
          </div>
          <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>ذخیرهٔ فرمول</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <h3 className="text-xs font-black">پیش‌نمایش زنده</h3>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>سال ورود</span><Input type="number" value={simYear} onChange={(e) => setSimYear(Number(e.target.value))} className="h-8 font-mono" dir="ltr" /></label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>کد رشته</span><Input value={simMajor} onChange={(e) => setSimMajor(toEnDigits(e.target.value))} className="h-8 font-mono" dir="ltr" /></label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>شمارنده</span><Input type="number" value={simSeq} onChange={(e) => setSimSeq(Number(e.target.value))} className="h-8 font-mono" dir="ltr" /></label>
          </div>
          <div className="rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 p-4 text-center">
            <div className="text-[10px] font-bold text-muted-foreground">شمارهٔ دانشجویی تولیدی</div>
            <div className="mt-1 font-mono text-2xl font-black tracking-widest" dir="ltr">{preview}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ManualTab({ bundle, onMsg, onRefresh }: {
  bundle: { majors: { id: number; name: string; degreeLevelId: number | null }[]; degreeLevels: { id: number; title: string }[] };
  onMsg: (m: { kind: 'ok' | 'err'; text: string }) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [form, setForm] = useState<ManualAdmissionInput>({
    nationalCode: '', firstName: '', lastName: '', mobile: '',
    majorId: bundle.majors[0]?.id ?? 0, degreeLevelId: bundle.degreeLevels[0]?.id ?? 1,
    entryYear: 1405, entryTerm: 1, quotaType: 'NORMAL', admissionType: 'NORMAL',
  });
  const [result, setResult] = useState<{ studentCode: string; fullName: string } | null>(null);
  const mut = useMutation({
    mutationFn: () => registerManualStudent(form),
    onSuccess: async (r) => {
      setResult(r);
      onMsg({ kind: 'ok', text: `دانشجو با شمارهٔ ${r.studentCode} ثبت شد.` });
      setForm({ ...form, nationalCode: '', firstName: '', lastName: '', mobile: '' });
      await onRefresh();
    },
    onError: (e: Error) => onMsg({ kind: 'err', text: e.message }),
  });

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardContent className="space-y-3 pt-4">
          <h3 className="text-xs font-black">ثبت‌نام دستی / انتقالی / اتباع خارجی</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>کد ملی *</span><Input value={form.nationalCode} onChange={(e) => setForm({ ...form, nationalCode: toEnDigits(e.target.value) })} className="h-8 font-mono" dir="ltr" maxLength={10} /></label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>موبایل</span><Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: toEnDigits(e.target.value) })} className="h-8 font-mono" dir="ltr" placeholder="09xxxxxxxxx" /></label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>نام *</span><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="h-8" /></label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>نام خانوادگی *</span><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="h-8" /></label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>رشته *</span>
              <select value={form.majorId} onChange={(e) => setForm({ ...form, majorId: Number(e.target.value) })} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px]">
                {bundle.majors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>مقطع *</span>
              <select value={form.degreeLevelId} onChange={(e) => setForm({ ...form, degreeLevelId: Number(e.target.value) })} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px]">
                {bundle.degreeLevels.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>سال ورود</span><Input type="number" value={form.entryYear} onChange={(e) => setForm({ ...form, entryYear: Number(e.target.value) })} className="h-8 font-mono" dir="ltr" /></label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>نیمسال ورود</span>
              <select value={form.entryTerm} onChange={(e) => setForm({ ...form, entryTerm: Number(e.target.value) })} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px]">
                <option value={1}>نیمسال اول</option><option value={2}>نیمسال دوم</option><option value={3}>تابستان</option>
              </select>
            </label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>سهمیه</span>
              <select value={form.quotaType} onChange={(e) => setForm({ ...form, quotaType: e.target.value })} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px]">
                <option value="NORMAL">عادی</option><option value="SHAHED">شاهد / ایثارگر</option><option value="STAFF">کارکنان</option><option value="TOP_TALENT">استعداد درخشان</option>
              </select>
            </label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>نوع پذیرش</span>
              <select value={form.admissionType} onChange={(e) => setForm({ ...form, admissionType: e.target.value as ManualAdmissionInput['admissionType'] })} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px]">
                <option value="NORMAL">عادی</option><option value="TRANSFER">انتقالی</option><option value="INTERNATIONAL">اتباع خارجی</option><option value="FREE_COURSE">دورهٔ آزاد</option>
              </select>
            </label>
          </div>
          <Button size="sm" disabled={mut.isPending || !form.nationalCode || !form.firstName || !form.lastName} onClick={() => mut.mutate()}>{mut.isPending ? 'در حال ثبت…' : 'ثبت‌نام دانشجو'}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-2 pt-4">
          <h3 className="text-xs font-black">نتیجهٔ آخرین ثبت</h3>
          {result ? (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-[11px] dark:border-emerald-800 dark:bg-emerald-950/40">
              <p className="font-black text-emerald-800 dark:text-emerald-200">{result.fullName}</p>
              <p className="mt-1 font-mono text-emerald-700 dark:text-emerald-300" dir="ltr">{result.studentCode}</p>
            </div>
          ) : <p className="text-[11px] text-muted-foreground">پس از ثبت، شمارهٔ دانشجویی تولیدی این‌جا نمایش داده می‌شود.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function IrandocTab({ onMsg }: { onMsg: (m: { kind: 'ok' | 'err'; text: string }) => void }) {
  const [form, setForm] = useState({ nationalCode: '', trackingCode: '', thesisTitle: '', maxAllowedThreshold: 20 });
  const [result, setResult] = useState<IrandocResult | null>(null);
  const mut = useMutation({
    mutationFn: () => testIrandoc(form),
    onSuccess: (r) => { setResult(r); onMsg({ kind: 'ok', text: 'استعلام انجام شد.' }); },
    onError: (e: Error) => onMsg({ kind: 'err', text: e.message }),
  });
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardContent className="space-y-2 pt-4">
          <h3 className="text-xs font-black">استعلام آزمایشی همانندجویی ایرانداک</h3>
          <label className="block space-y-1 text-[10px] text-muted-foreground"><span>کد ملی</span><Input value={form.nationalCode} onChange={(e) => setForm({ ...form, nationalCode: toEnDigits(e.target.value) })} className="h-8 font-mono" dir="ltr" maxLength={10} /></label>
          <label className="block space-y-1 text-[10px] text-muted-foreground"><span>کد رهگیری</span><Input value={form.trackingCode} onChange={(e) => setForm({ ...form, trackingCode: e.target.value })} className="h-8 font-mono" dir="ltr" /></label>
          <label className="block space-y-1 text-[10px] text-muted-foreground"><span>عنوان پایان‌نامه</span><Input value={form.thesisTitle} onChange={(e) => setForm({ ...form, thesisTitle: e.target.value })} className="h-8" /></label>
          <label className="block space-y-1 text-[10px] text-muted-foreground"><span>سقف مجاز (٪)</span><Input type="number" value={form.maxAllowedThreshold} onChange={(e) => setForm({ ...form, maxAllowedThreshold: Number(e.target.value) })} className="h-8 font-mono" dir="ltr" /></label>
          <Button size="sm" disabled={mut.isPending || !form.nationalCode || !form.trackingCode} onClick={() => mut.mutate()}>{mut.isPending ? 'در حال استعلام…' : 'استعلام ایرانداک'}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-2 pt-4">
          <h3 className="text-xs font-black">نتیجه</h3>
          {result ? (
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between rounded-lg bg-muted/50 px-2 py-1"><span className="text-muted-foreground">وضعیت</span><b>{result.status}</b></div>
              <div className="flex justify-between rounded-lg bg-muted/50 px-2 py-1"><span className="text-muted-foreground">درصد مشابهت</span><b className="font-mono">{faNumber(result.similarityPercentage)}٪</b></div>
              <div className="flex justify-between rounded-lg bg-muted/50 px-2 py-1"><span className="text-muted-foreground">سقف مجاز</span><b className="font-mono">{faNumber(result.maxAllowedThreshold)}٪</b></div>
              <div className="flex justify-between rounded-lg bg-muted/50 px-2 py-1"><span className="text-muted-foreground">تصمیم</span><b dir="ltr">{result.decision}</b></div>
              <p className={`mt-2 rounded-lg border p-2 leading-5 ${result.decision === 'AUTO_APPROVE' ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>{result.message}</p>
            </div>
          ) : <p className="text-[11px] text-muted-foreground">نتیجهٔ استعلام این‌جا نمایش داده می‌شود.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

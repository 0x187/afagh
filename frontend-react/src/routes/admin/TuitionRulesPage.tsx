import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, FileSpreadsheet, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import {
  deleteTuitionRule,
  getTuitionRules,
  importLegacyFeeRules,
  saveTuitionRule,
  setEquivFixedMode,
  type TuitionRuleRow,
} from '@/lib/tuition-api';

// ═══ موتور شهریه: قواعد و سیاست معادل‌سازی — پورت admin/tuition ═══

const TERM_TYPES = [
  { value: '', label: 'همهٔ ترم‌ها' },
  { value: 'REGULAR', label: 'نیمسال عادی' },
  { value: 'SUMMER', label: 'تابستان' },
  { value: 'EQUIVALENCE', label: 'معادل‌سازی' },
  { value: 'SPECIAL', label: 'ویژه' },
];
const OFFERING_TYPES = [
  { value: '', label: 'همهٔ ارائه‌ها' },
  { value: 'NORMAL', label: 'عادی' },
  { value: 'TRANSFER', label: 'معادل‌سازی/انتقال' },
  { value: 'COMPENSATORY', label: 'جبرانی' },
  { value: 'THESIS', label: 'پایان‌نامه/رساله' },
];
const EQUIV_MODES = [
  { value: 'ONCE', label: 'یک‌بار (اولین نیمسال معادل‌سازی)', hint: 'شهریهٔ ثابت فقط روی اولین نیمسال معادل‌سازی دانشجو' },
  { value: 'PER_TERM', label: 'به ازای هر نیمسال معادل‌سازی', hint: 'هر ۲۰ واحد معادل‌سازی شهریهٔ ثابت جدا می‌دهد' },
  { value: 'NONE', label: 'بدون شهریهٔ ثابت', hint: 'فقط شهریهٔ متغیر به ازای هر واحد محاسبه می‌شود' },
];

const emptyForm = {
  id: undefined as number | undefined,
  degreeLevelId: '',
  termType: '',
  offeringType: '',
  fixedTuition: '',
  perUnitTuition: '',
  effectiveFromYear: '',
  isActive: true,
  note: '',
};

export function AdminTuitionRulesPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['tuition-rules'], queryFn: getTuitionRules, staleTime: 20_000 });
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['tuition-rules'] });

  const saveMut = useMutation({
    mutationFn: () =>
      saveTuitionRule({
        id: form.id,
        degreeLevelId: form.degreeLevelId ? Number(form.degreeLevelId) : null,
        termType: form.termType || null,
        offeringType: form.offeringType || null,
        fixedTuition: Number(form.fixedTuition || 0),
        perUnitTuition: Number(form.perUnitTuition || 0),
        effectiveFromYear: form.effectiveFromYear ? Number(form.effectiveFromYear) : null,
        isActive: form.isActive,
        note: form.note || null,
      }),
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'قاعده ذخیره شد.' }); setForm(emptyForm); await refresh(); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteTuitionRule(id),
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'قاعده حذف شد.' }); await refresh(); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });
  const importMut = useMutation({
    mutationFn: importLegacyFeeRules,
    onSuccess: async (r) => { setMsg({ kind: 'ok', text: `${faNumber(r.created)} قاعده ساخته شد، ${faNumber(r.skipped)} تکراری رد شد.` }); await refresh(); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });
  const modeMut = useMutation({
    mutationFn: setEquivFixedMode,
    onSuccess: async (saved) => { setMsg({ kind: 'ok', text: `سیاست معادل‌سازی: ${saved}` }); await refresh(); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت قواعد شهریه ناموفق بود.</CardContent></Card>;

  const degreeOf = (id: number | null) => data.degrees.find((d) => d.id === id)?.title ?? 'همهٔ مقاطع';

  function edit(r: TuitionRuleRow) {
    setForm({
      id: r.id,
      degreeLevelId: r.degreeLevelId == null ? '' : String(r.degreeLevelId),
      termType: r.termType ?? '',
      offeringType: r.offeringType ?? '',
      fixedTuition: String(r.fixedTuition),
      perUnitTuition: String(r.perUnitTuition),
      effectiveFromYear: r.effectiveFromYear == null ? '' : String(r.effectiveFromYear),
      isActive: r.isActive,
      note: r.note ?? '',
    });
  }

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-violet-800 via-indigo-800 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-black"><Calculator className="size-5" aria-hidden /> موتور شهریه</h1>
            <p className="mt-1 text-xs text-indigo-100">قواعد شهریهٔ ثابت/متغیر بر پایهٔ مقطع، نوع ترم، نوع ارائه و سال ورود + سیاست شهریهٔ ثابت معادل‌سازی</p>
          </div>
          <Button asChild size="sm" className="bg-white text-slate-900 hover:bg-white/90">
            <Link to="/admin/tuition/tariff">📐 تعرفهٔ سالانهٔ متغیر</Link>
          </Button>
        </CardContent>
      </Card>

      {msg ? <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>{msg.text}</div> : null}

      <Card>
        <CardContent className="space-y-2 pt-4">
          <h3 className="text-xs font-black">سیاست شهریهٔ ثابت معادل‌سازی</h3>
          <p className="text-[11px] text-muted-foreground">دروس معادل‌سازی هر ۲۰ واحد در یک نیمسال جدا (۰۰EQ) ثبت می‌شوند؛ این سیاست تعیین می‌کند شهریهٔ ثابت چند بار شارژ شود. شهریهٔ متغیر در همهٔ حالت‌ها به ازای هر واحد محاسبه می‌شود.</p>
          <div className="flex flex-wrap gap-2">
            {EQUIV_MODES.map((m) => (
              <button key={m.value} type="button" onClick={() => modeMut.mutate(m.value)} className={`rounded-xl border px-3 py-2 text-right text-[11px] ${data.equivFixedMode === m.value ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-border'}`}>
                <b className="block">{m.label}</b>
                <span className="text-[10px] text-muted-foreground">{m.hint}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="overflow-x-auto pt-4">
            <h3 className="mb-2 text-xs font-black">قواعد فعال ({faNumber(data.rules.length)})</h3>
            <table className="w-full border-collapse text-right text-[11px]">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>{['مقطع', 'نوع ترم', 'نوع ارائه', 'ثابت (ریال)', 'هر واحد (ریال)', 'از سال', 'فعال', 'یادداشت', ''].map((h) => <th key={h} className="whitespace-nowrap p-2 text-right font-black">{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.rules.map((r) => (
                  <tr key={r.id} className="border-t border-border/50">
                    <td className="p-2">{degreeOf(r.degreeLevelId)}</td>
                    <td className="p-2 font-mono text-[10px]" dir="ltr">{r.termType ?? 'همه'}</td>
                    <td className="p-2 font-mono text-[10px]" dir="ltr">{r.offeringType ?? 'همه'}</td>
                    <td className="p-2 font-mono">{faNumber(r.fixedTuition)}</td>
                    <td className="p-2 font-mono">{faNumber(r.perUnitTuition)}</td>
                    <td className="p-2 font-mono">{r.effectiveFromYear == null ? '—' : faNumber(r.effectiveFromYear)}</td>
                    <td className="p-2">{r.isActive ? <Badge variant="success">فعال</Badge> : <Badge variant="secondary">غیرفعال</Badge>}</td>
                    <td className="max-w-40 truncate p-2 text-muted-foreground" title={r.note ?? ''}>{r.note ?? '—'}</td>
                    <td className="whitespace-nowrap p-2">
                      <button type="button" onClick={() => edit(r)} className="text-[11px] text-indigo-700 hover:underline dark:text-indigo-300">ویرایش</button>
                      <button type="button" onClick={() => { if (confirm('این قاعده حذف شود؟')) deleteMut.mutate(r.id); }} className="ms-2 text-[11px] text-rose-600 hover:underline">حذف</button>
                    </td>
                  </tr>
                ))}
                {data.rules.length === 0 ? <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">قاعده‌ای ثبت نشده است.</td></tr> : null}
              </tbody>
            </table>
            <div className="mt-2">
              <Button size="sm" variant="outline" disabled={importMut.isPending} onClick={() => importMut.mutate()}>
                <FileSpreadsheet className="size-4" aria-hidden /> درون‌ریزی از قواعد مالی قدیمی
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-xs font-black">{form.id ? 'ویرایش قاعده' : 'قاعدهٔ جدید'}</h3>
            <label className="block space-y-1 text-[10px] text-muted-foreground"><span>مقطع</span>
              <select value={form.degreeLevelId} onChange={(e) => setForm({ ...form, degreeLevelId: e.target.value })} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px]">
                <option value="">همهٔ مقاطع</option>
                {data.degrees.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[10px] text-muted-foreground"><span>نوع ترم</span>
                <select value={form.termType} onChange={(e) => setForm({ ...form, termType: e.target.value })} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px]">
                  {TERM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-[10px] text-muted-foreground"><span>نوع ارائه</span>
                <select value={form.offeringType} onChange={(e) => setForm({ ...form, offeringType: e.target.value })} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px]">
                  {OFFERING_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-[10px] text-muted-foreground"><span>شهریهٔ ثابت (ریال)</span><Input type="number" value={form.fixedTuition} onChange={(e) => setForm({ ...form, fixedTuition: e.target.value })} className="h-8 font-mono" dir="ltr" /></label>
              <label className="space-y-1 text-[10px] text-muted-foreground"><span>هر واحد (ریال)</span><Input type="number" value={form.perUnitTuition} onChange={(e) => setForm({ ...form, perUnitTuition: e.target.value })} className="h-8 font-mono" dir="ltr" /></label>
              <label className="space-y-1 text-[10px] text-muted-foreground"><span>از سال ورود</span><Input type="number" value={form.effectiveFromYear} onChange={(e) => setForm({ ...form, effectiveFromYear: e.target.value })} className="h-8 font-mono" dir="ltr" /></label>
              <label className="flex items-center gap-1.5 pt-5 text-[11px] font-bold"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> فعال</label>
            </div>
            <label className="block space-y-1 text-[10px] text-muted-foreground"><span>یادداشت</span><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="h-8 text-[11px]" /></label>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}><Save className="size-3.5" aria-hidden /> ذخیره</Button>
              <Button size="sm" variant="outline" onClick={() => setForm(emptyForm)}>جدید</Button>
            </div>
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground"><Trash2 className="size-3" aria-hidden /> حذف قاعده فقط روی ردیف‌های همین دانشگاه مجاز است.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

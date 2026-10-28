import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Building2, Calculator, Landmark, Pencil, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  deleteDiscountType, deleteFormula, deleteLoanProduct, deleteSponsor,
  getFinanceRules, saveDiscountType, saveFormula, saveLoanProduct, saveSponsor,
  type FinanceDiscountType, type FinanceFormula, type FinanceLoanProduct, type FinanceSponsor,
} from '@/lib/admin-api';

// ═══ تعاریف موتور مالی — پورت admin/finance/rules ═══

type Tab = 'discounts' | 'sponsors' | 'formulas' | 'loans' | 'coefs';

const TABS: { key: Tab; label: string; icon: typeof Settings2 }[] = [
  { key: 'discounts', label: 'انواع تخفیف', icon: Award },
  { key: 'sponsors', label: 'بنیادهای حامی', icon: Building2 },
  { key: 'formulas', label: 'فرمول‌های شهریه', icon: Calculator },
  { key: 'loans', label: 'نهادهای وام', icon: Landmark },
  { key: 'coefs', label: 'ضرایب و مبالغ موضوعی', icon: Settings2 },
];

export function AdminFinanceRulesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('discounts');
  const [msg, setMsg] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ['finance-rules'], queryFn: getFinanceRules, staleTime: 30_000 });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['finance-rules'] });
  };
  const onErr = (e: Error) => setMsg(e.message);
  const onOk = (m: string) => { setMsg(m); void refresh(); };

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت تعاریف مالی ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-base font-black"><Settings2 className="size-5" aria-hidden /> تعاریف موتور مالی</h1>
          <p className="mt-0.5 text-xs text-emerald-100">انواع تخفیف، بنیادهای حامی، فرمول‌های شهریه، نهادهای وام، ضریب افزایشی نیمسال و مبالغ موضوعی</p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <Button key={t.key} size="sm" variant={tab === t.key ? 'default' : 'outline'} onClick={() => setTab(t.key)}>
              <Icon className="size-4" aria-hidden /> {t.label}
            </Button>
          );
        })}
      </div>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      {tab === 'discounts' ? <DiscountsTab rows={data.discountTypes} onOk={onOk} onErr={onErr} /> : null}
      {tab === 'sponsors' ? <SponsorsTab rows={data.sponsors} onOk={onOk} onErr={onErr} /> : null}
      {tab === 'formulas' ? <FormulasTab rows={data.formulas} degrees={data.degrees} majors={data.majors} onOk={onOk} onErr={onErr} /> : null}
      {tab === 'loans' ? <LoansTab rows={data.loanProducts} onOk={onOk} onErr={onErr} /> : null}
      {tab === 'coefs' ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">ضرایب افزایشی نیمسال (tuition_coefficients)</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-[11px]">
                <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">ترم</th><th className="p-1.5 text-center">ضریب متغیر</th><th className="p-1.5 text-center">ضریب ثابت</th><th className="p-1.5">یادداشت</th></tr></thead>
                <tbody>
                  {data.coefficients.length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">ردیفی ثبت نشده است.</td></tr> : data.coefficients.map((c) => (
                    <tr key={c.id} className="border-b border-border/40 last:border-0">
                      <td className="p-1.5">{c.termTitle ?? '—'}</td>
                      <td className="p-1.5 text-center font-mono">{faNumber(c.variableCoefficient)}</td>
                      <td className="p-1.5 text-center font-mono">{faNumber(c.fixedCoefficient)}</td>
                      <td className="p-1.5 text-muted-foreground">{c.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">مبالغ موضوعی (subject_fee_types)</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-[11px]">
                <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">کد</th><th className="p-1.5">عنوان</th><th className="p-1.5">نوع</th><th className="p-1.5 text-left">مبلغ ثابت</th><th className="p-1.5 text-center">درصد متغیر</th><th className="p-1.5 text-center">فعال</th></tr></thead>
                <tbody>
                  {data.subjectFeeTypes.length === 0 ? <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">ردیفی ثبت نشده است.</td></tr> : data.subjectFeeTypes.map((f) => (
                    <tr key={f.id} className="border-b border-border/40 last:border-0">
                      <td className="p-1.5 font-mono" dir="ltr">{f.code}</td>
                      <td className="p-1.5">{f.title}</td>
                      <td className="p-1.5">{f.kind}</td>
                      <td className="p-1.5 text-left font-mono">{faNumber(f.fixedAmount)}</td>
                      <td className="p-1.5 text-center font-mono">{faNumber(f.variablePercent)}٪</td>
                      <td className="p-1.5 text-center">{f.isActive ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

type TabProps<T> = { rows: T[]; onOk: (m: string) => void; onErr: (e: Error) => void };

// ─────────────────── تب تخفیف‌ها ───────────────────

const emptyDiscount = { id: 0, code: '', title: '', kind: 'PERCENT', defaultPercent: 0, defaultAmount: 0, maxPercent: '', requiresApproval: false, requiresDocument: false, isActive: true, note: '' };

function DiscountsTab({ rows, onOk, onErr }: TabProps<FinanceDiscountType>) {
  const [form, setForm] = useState({ ...emptyDiscount });
  const saveMut = useMutation({
    mutationFn: () => saveDiscountType({
      ...form,
      maxPercent: form.maxPercent === '' ? null : Number(form.maxPercent),
    }),
    onSuccess: () => { setForm({ ...emptyDiscount }); onOk('نوع تخفیف ذخیره شد.'); },
    onError: onErr,
  });
  const delMut = useMutation({ mutationFn: deleteDiscountType, onSuccess: () => onOk('حذف شد.'), onError: onErr });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>انواع تخفیف شهریه</span>
          <span className="text-[11px] font-normal text-muted-foreground">{faNumber(rows.length)} ردیف</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <div><Label>کد</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label>عنوان</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 h-8" /></div>
          <div><Label>نوع</Label>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2">
              <option value="PERCENT">درصدی</option>
              <option value="FIXED">مبلغ ثابت</option>
            </select>
          </div>
          <div><Label>درصد پیش‌فرض</Label><Input type="number" value={form.defaultPercent} onChange={(e) => setForm({ ...form, defaultPercent: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label>مبلغ پیش‌فرض</Label><Input type="number" value={form.defaultAmount} onChange={(e) => setForm({ ...form, defaultAmount: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label>سقف درصد</Label><Input type="number" value={form.maxPercent} onChange={(e) => setForm({ ...form, maxPercent: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" placeholder="—" /></div>
          <div className="flex items-end gap-3 text-[11px]">
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.requiresApproval} onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })} /> نیاز به تأیید</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.requiresDocument} onChange={(e) => setForm({ ...form, requiresDocument: e.target.checked })} /> مدرک</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> فعال</label>
          </div>
          <div className="lg:col-span-2"><Label>یادداشت</Label><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-1 h-8" /></div>
          <div className="flex items-end">
            <Button size="sm" disabled={saveMut.isPending || !form.code || !form.title} onClick={() => saveMut.mutate()}>
              {form.id ? <Save className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />} {form.id ? 'ذخیرهٔ ویرایش' : 'افزودن'}
            </Button>
            {form.id ? <Button size="sm" variant="ghost" className="mr-1" onClick={() => setForm({ ...emptyDiscount })}>انصراف</Button> : null}
          </div>
        </div>
        <table className="w-full border-collapse text-right text-xs">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2">نوع</th><th className="p-2 text-center">درصد</th><th className="p-2 text-left">مبلغ</th><th className="p-2 text-center">سقف</th><th className="p-2 text-center">تأیید/مدرک</th><th className="p-2 text-center">فعال</th><th className="p-2"></th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">ردیفی ثبت نشده است.</td></tr> : rows.map((r) => (
              <tr key={r.id} className="border-b border-border/40 last:border-0">
                <td className="p-2 font-mono text-[10px]" dir="ltr">{r.code}</td>
                <td className="p-2 font-semibold">{r.title}</td>
                <td className="p-2">{r.kind === 'FIXED' ? 'ثابت' : 'درصدی'}</td>
                <td className="p-2 text-center font-mono">{faNumber(r.defaultPercent)}٪</td>
                <td className="p-2 text-left font-mono">{faNumber(r.defaultAmount)}</td>
                <td className="p-2 text-center font-mono">{r.maxPercent == null ? '—' : `${faNumber(r.maxPercent)}٪`}</td>
                <td className="p-2 text-center text-[10px]">{r.requiresApproval ? 'تأیید ' : ''}{r.requiresDocument ? 'مدرک' : ''}{!r.requiresApproval && !r.requiresDocument ? '—' : ''}</td>
                <td className="p-2 text-center"><Badge variant={r.isActive ? 'default' : 'outline'} className="text-[10px]">{r.isActive ? 'فعال' : 'غیرفعال'}</Badge></td>
                <td className="p-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setForm({ id: r.id, code: r.code, title: r.title, kind: r.kind, defaultPercent: r.defaultPercent, defaultAmount: r.defaultAmount, maxPercent: r.maxPercent == null ? '' : String(r.maxPercent), requiresApproval: r.requiresApproval, requiresDocument: r.requiresDocument, isActive: r.isActive, note: r.note ?? '' })}><Pencil className="size-3.5" aria-hidden /></Button>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delMut.isPending} onClick={() => { if (confirm(`حذف «${r.title}»؟`)) delMut.mutate(r.id); }}><Trash2 className="size-3.5" aria-hidden /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─────────────────── تب بنیادها ───────────────────

const emptySponsor = { id: 0, code: '', title: '', contactInfo: '', settlementMethod: 'DIRECT', isActive: true, note: '' };

function SponsorsTab({ rows, onOk, onErr }: TabProps<FinanceSponsor>) {
  const [form, setForm] = useState({ ...emptySponsor });
  const saveMut = useMutation({ mutationFn: () => saveSponsor(form), onSuccess: () => { setForm({ ...emptySponsor }); onOk('بنیاد ذخیره شد.'); }, onError: onErr });
  const delMut = useMutation({ mutationFn: deleteSponsor, onSuccess: () => onOk('حذف شد.'), onError: onErr });
  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <div><Label>کد</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label>عنوان</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 h-8" /></div>
          <div><Label>اطلاعات تماس</Label><Input value={form.contactInfo} onChange={(e) => setForm({ ...form, contactInfo: e.target.value })} className="mt-1 h-8" /></div>
          <div><Label>روش تسویه</Label>
            <select value={form.settlementMethod} onChange={(e) => setForm({ ...form, settlementMethod: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2">
              <option value="DIRECT">مستقیم</option>
              <option value="REIMBURSE">بازپرداخت</option>
            </select>
          </div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> فعال</label>
            <Button size="sm" disabled={saveMut.isPending || !form.code || !form.title} onClick={() => saveMut.mutate()}>
              {form.id ? <Save className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />} {form.id ? 'ذخیره' : 'افزودن'}
            </Button>
          </div>
        </div>
        <table className="w-full border-collapse text-right text-xs">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2">تماس</th><th className="p-2">تسویه</th><th className="p-2 text-center">فعال</th><th className="p-2"></th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">ردیفی ثبت نشده است.</td></tr> : rows.map((r) => (
              <tr key={r.id} className="border-b border-border/40 last:border-0">
                <td className="p-2 font-mono text-[10px]" dir="ltr">{r.code}</td>
                <td className="p-2 font-semibold">{r.title}</td>
                <td className="p-2">{r.contactInfo ?? '—'}</td>
                <td className="p-2">{r.settlementMethod === 'REIMBURSE' ? 'بازپرداخت' : 'مستقیم'}</td>
                <td className="p-2 text-center"><Badge variant={r.isActive ? 'default' : 'outline'} className="text-[10px]">{r.isActive ? 'فعال' : 'غیرفعال'}</Badge></td>
                <td className="p-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setForm({ id: r.id, code: r.code, title: r.title, contactInfo: r.contactInfo ?? '', settlementMethod: r.settlementMethod, isActive: r.isActive, note: r.note ?? '' })}><Pencil className="size-3.5" aria-hidden /></Button>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delMut.isPending} onClick={() => { if (confirm(`حذف «${r.title}»؟`)) delMut.mutate(r.id); }}><Trash2 className="size-3.5" aria-hidden /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─────────────────── تب فرمول‌ها ───────────────────

const emptyFormula = { id: 0, code: '', title: '', degreeLevelId: '', majorId: '', entryYearFrom: '', entryYearTo: '', fixedAmount: 0, perUnitTheory: 0, perUnitPractical: 0, perUnitGeneral: 0, priority: 100, isActive: true, note: '' };

function FormulasTab({ rows, degrees, majors, onOk, onErr }: TabProps<FinanceFormula> & { degrees: { id: number; title: string }[]; majors: { id: number; title: string }[] }) {
  const [form, setForm] = useState({ ...emptyFormula });
  const saveMut = useMutation({
    mutationFn: () => saveFormula({
      ...form,
      degreeLevelId: form.degreeLevelId === '' ? null : Number(form.degreeLevelId),
      majorId: form.majorId === '' ? null : Number(form.majorId),
      entryYearFrom: form.entryYearFrom === '' ? null : Number(form.entryYearFrom),
      entryYearTo: form.entryYearTo === '' ? null : Number(form.entryYearTo),
    }),
    onSuccess: () => { setForm({ ...emptyFormula }); onOk('فرمول ذخیره شد.'); },
    onError: onErr,
  });
  const delMut = useMutation({ mutationFn: deleteFormula, onSuccess: () => onOk('حذف شد.'), onError: onErr });
  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-6">
          <div><Label>کد</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div className="lg:col-span-2"><Label>عنوان</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 h-8" /></div>
          <div><Label>مقطع</Label>
            <select value={form.degreeLevelId} onChange={(e) => setForm({ ...form, degreeLevelId: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2">
              <option value="">همه</option>
              {degrees.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </div>
          <div><Label>رشته</Label>
            <select value={form.majorId} onChange={(e) => setForm({ ...form, majorId: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2">
              <option value="">همه</option>
              {majors.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-1">
            <div className="flex-1"><Label>از ورودی</Label><Input value={form.entryYearFrom} onChange={(e) => setForm({ ...form, entryYearFrom: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" placeholder="—" /></div>
            <div className="flex-1"><Label>تا</Label><Input value={form.entryYearTo} onChange={(e) => setForm({ ...form, entryYearTo: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" placeholder="—" /></div>
          </div>
          <div><Label>ثابت (ریال)</Label><Input type="number" value={form.fixedAmount} onChange={(e) => setForm({ ...form, fixedAmount: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label>نظری/واحد</Label><Input type="number" value={form.perUnitTheory} onChange={(e) => setForm({ ...form, perUnitTheory: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label>عملی/واحد</Label><Input type="number" value={form.perUnitPractical} onChange={(e) => setForm({ ...form, perUnitPractical: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label>عمومی/واحد</Label><Input type="number" value={form.perUnitGeneral} onChange={(e) => setForm({ ...form, perUnitGeneral: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label>اولویت</Label><Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> فعال</label>
            <Button size="sm" disabled={saveMut.isPending || !form.code || !form.title} onClick={() => saveMut.mutate()}>
              {form.id ? <Save className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />} {form.id ? 'ذخیره' : 'افزودن'}
            </Button>
            {form.id ? <Button size="sm" variant="ghost" onClick={() => setForm({ ...emptyFormula })}>انصراف</Button> : null}
          </div>
        </div>
        <table className="w-full border-collapse text-right text-xs">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2 text-center">ورودی</th><th className="p-2 text-left">ثابت</th><th className="p-2 text-left">نظری</th><th className="p-2 text-left">عملی</th><th className="p-2 text-left">عمومی</th><th className="p-2 text-center">اولویت</th><th className="p-2 text-center">فعال</th><th className="p-2"></th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">فرمولی ثبت نشده است.</td></tr> : rows.map((r) => (
              <tr key={r.id} className="border-b border-border/40 last:border-0">
                <td className="p-2 font-mono text-[10px]" dir="ltr">{r.code}</td>
                <td className="p-2 font-semibold">{r.title}</td>
                <td className="p-2 text-center font-mono text-[10px]">{r.entryYearFrom == null && r.entryYearTo == null ? 'همه' : `${r.entryYearFrom == null ? '—' : faDigits(r.entryYearFrom)}..${r.entryYearTo == null ? '—' : faDigits(r.entryYearTo)}`}</td>
                <td className="p-2 text-left font-mono">{faNumber(r.fixedAmount)}</td>
                <td className="p-2 text-left font-mono">{faNumber(r.perUnitTheory)}</td>
                <td className="p-2 text-left font-mono">{faNumber(r.perUnitPractical)}</td>
                <td className="p-2 text-left font-mono">{faNumber(r.perUnitGeneral)}</td>
                <td className="p-2 text-center font-mono">{faNumber(r.priority)}</td>
                <td className="p-2 text-center"><Badge variant={r.isActive ? 'default' : 'outline'} className="text-[10px]">{r.isActive ? 'فعال' : 'غیرفعال'}</Badge></td>
                <td className="p-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setForm({ id: r.id, code: r.code, title: r.title, degreeLevelId: r.degreeLevelId == null ? '' : String(r.degreeLevelId), majorId: r.majorId == null ? '' : String(r.majorId), entryYearFrom: r.entryYearFrom == null ? '' : String(r.entryYearFrom), entryYearTo: r.entryYearTo == null ? '' : String(r.entryYearTo), fixedAmount: r.fixedAmount, perUnitTheory: r.perUnitTheory, perUnitPractical: r.perUnitPractical, perUnitGeneral: r.perUnitGeneral, priority: r.priority, isActive: r.isActive, note: r.note ?? '' })}><Pencil className="size-3.5" aria-hidden /></Button>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delMut.isPending} onClick={() => { if (confirm(`حذف «${r.title}»؟`)) delMut.mutate(r.id); }}><Trash2 className="size-3.5" aria-hidden /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─────────────────── تب وام‌ها ───────────────────

const emptyLoan = { id: 0, code: '', title: '', lender: '', maxAmount: '', defaultAmount: 0, defaultInstallments: 12, isInterestFree: true, requiresApproval: true, isActive: true, note: '' };

function LoansTab({ rows, onOk, onErr }: TabProps<FinanceLoanProduct>) {
  const [form, setForm] = useState({ ...emptyLoan });
  const saveMut = useMutation({
    mutationFn: () => saveLoanProduct({ ...form, maxAmount: form.maxAmount === '' ? null : Number(form.maxAmount) }),
    onSuccess: () => { setForm({ ...emptyLoan }); onOk('نهاد وام ذخیره شد.'); },
    onError: onErr,
  });
  const delMut = useMutation({ mutationFn: deleteLoanProduct, onSuccess: () => onOk('حذف شد.'), onError: onErr });
  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-6">
          <div><Label>کد</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div className="lg:col-span-2"><Label>عنوان</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 h-8" /></div>
          <div><Label>نهاد پرداخت‌کننده</Label><Input value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} className="mt-1 h-8" /></div>
          <div><Label>سقف مبلغ</Label><Input type="number" value={form.maxAmount} onChange={(e) => setForm({ ...form, maxAmount: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" placeholder="—" /></div>
          <div><Label>مبلغ پیش‌فرض</Label><Input type="number" value={form.defaultAmount} onChange={(e) => setForm({ ...form, defaultAmount: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label>اقساط</Label><Input type="number" value={form.defaultInstallments} onChange={(e) => setForm({ ...form, defaultInstallments: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div className="flex items-end gap-3 text-[11px]">
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.isInterestFree} onChange={(e) => setForm({ ...form, isInterestFree: e.target.checked })} /> بدون سود</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.requiresApproval} onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })} /> تأیید</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> فعال</label>
          </div>
          <div className="flex items-end">
            <Button size="sm" disabled={saveMut.isPending || !form.code || !form.title || !form.lender} onClick={() => saveMut.mutate()}>
              {form.id ? <Save className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />} {form.id ? 'ذخیره' : 'افزودن'}
            </Button>
          </div>
        </div>
        <table className="w-full border-collapse text-right text-xs">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2">نهاد</th><th className="p-2 text-left">سقف</th><th className="p-2 text-left">پیش‌فرض</th><th className="p-2 text-center">اقساط</th><th className="p-2 text-center">بدون سود</th><th className="p-2 text-center">فعال</th><th className="p-2"></th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">ردیفی ثبت نشده است.</td></tr> : rows.map((r) => (
              <tr key={r.id} className="border-b border-border/40 last:border-0">
                <td className="p-2 font-mono text-[10px]" dir="ltr">{r.code}</td>
                <td className="p-2 font-semibold">{r.title}</td>
                <td className="p-2">{r.lender}</td>
                <td className="p-2 text-left font-mono">{r.maxAmount == null ? '—' : faNumber(r.maxAmount)}</td>
                <td className="p-2 text-left font-mono">{faNumber(r.defaultAmount)}</td>
                <td className="p-2 text-center font-mono">{faNumber(r.defaultInstallments)}</td>
                <td className="p-2 text-center">{r.isInterestFree ? '✓' : '—'}</td>
                <td className="p-2 text-center"><Badge variant={r.isActive ? 'default' : 'outline'} className="text-[10px]">{r.isActive ? 'فعال' : 'غیرفعال'}</Badge></td>
                <td className="p-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setForm({ id: r.id, code: r.code, title: r.title, lender: r.lender, maxAmount: r.maxAmount == null ? '' : String(r.maxAmount), defaultAmount: r.defaultAmount, defaultInstallments: r.defaultInstallments, isInterestFree: r.isInterestFree, requiresApproval: r.requiresApproval, isActive: r.isActive, note: r.note ?? '' })}><Pencil className="size-3.5" aria-hidden /></Button>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delMut.isPending} onClick={() => { if (confirm(`حذف «${r.title}»؟`)) delMut.mutate(r.id); }}><Trash2 className="size-3.5" aria-hidden /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

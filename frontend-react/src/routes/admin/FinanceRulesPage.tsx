import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Building2, Calculator, Landmark, Pencil, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  assignSubjectFee, deleteDiscountType, deleteFinanceCoefficient, deleteFinanceSubjectFeeType,
  deleteFormula, deleteLoanProduct, deleteSponsor, deleteSubjectFeeAssignment,
  getFinanceCoefficients, getFinanceRules, getFinanceSubjectFeeTypes, getSubjectFeeAssignments,
  saveDiscountType, saveFinanceCoefficient, saveFinanceSubjectFeeType, saveFormula, saveLoanProduct, saveSponsor,
  type FinanceCoefficient, type FinanceDiscountType, type FinanceFormula, type FinanceLoanProduct,
  type FinanceSponsor, type FinanceSubjectFeeType, type SubjectFeeAssignment,
} from '@/lib/admin-api';

// ═══ Finance engine definitions — port of admin/finance/rules ═══

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
      {tab === 'coefs' ? <CoefsTab terms={data.terms} onOk={onOk} onErr={onErr} /> : null}
    </div>
  );
}

type TabProps<T> = { rows: T[]; onOk: (m: string) => void; onErr: (e: Error) => void };

// ─────────────────── Discounts tab ───────────────────

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

// ─────────────────── Foundations tab ───────────────────

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

// ─────────────────── Formulas tab ───────────────────

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

// ─────────────────── Loans tab ───────────────────

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

// ─────────────────── Subject coefficients/amounts tab (editor) ───────────────────

function CoefsTab({ terms, onOk, onErr }: { terms: { id: number; termCode: string; termTitle: string }[]; onOk: (m: string) => void; onErr: (e: Error) => void }) {
  const qc = useQueryClient();
  const coefs = useQuery({ queryKey: ['finance-coefficients'], queryFn: getFinanceCoefficients, staleTime: 20_000 });
  const types = useQuery({ queryKey: ['finance-subject-fees'], queryFn: getFinanceSubjectFeeTypes, staleTime: 20_000 });
  const [coefForm, setCoefForm] = useState({ termId: 0, variable: 1, fixed: 1, note: '' });
  const [typeForm, setTypeForm] = useState({ id: 0, code: '', title: '', kind: 'ADDITIVE', fixedAmount: 0, variablePercent: 0, appliesTo: 'BOTH', isActive: true, note: '' });
  const [assignForm, setAssignForm] = useState({ studentId: '', termId: 0, typeId: 0, amount: '', note: '' });
  const [assignList, setAssignList] = useState<SubjectFeeAssignment[]>([]);
  const [assignMsg, setAssignMsg] = useState<string | null>(null);

  const refreshCoefs = () => void qc.invalidateQueries({ queryKey: ['finance-coefficients'] });
  const refreshTypes = () => void qc.invalidateQueries({ queryKey: ['finance-subject-fees'] });

  const saveCoefMut = useMutation({
    mutationFn: () => saveFinanceCoefficient({
      termId: coefForm.termId || (terms[0]?.id ?? 0),
      variableCoefficient: coefForm.variable,
      fixedCoefficient: coefForm.fixed,
      note: coefForm.note || undefined,
    }),
    onSuccess: () => { onOk('ضریب نیمسال ذخیره شد.'); refreshCoefs(); },
    onError: onErr,
  });
  const delCoefMut = useMutation({
    mutationFn: deleteFinanceCoefficient,
    onSuccess: () => { onOk('ضریب حذف شد.'); refreshCoefs(); },
    onError: onErr,
  });
  const saveTypeMut = useMutation({
    mutationFn: () => saveFinanceSubjectFeeType({ ...typeForm, id: typeForm.id || undefined, note: typeForm.note || undefined }),
    onSuccess: () => { onOk('نوع مبلغ موضوعی ذخیره شد.'); setTypeForm({ id: 0, code: '', title: '', kind: 'ADDITIVE', fixedAmount: 0, variablePercent: 0, appliesTo: 'BOTH', isActive: true, note: '' }); refreshTypes(); },
    onError: onErr,
  });
  const delTypeMut = useMutation({
    mutationFn: deleteFinanceSubjectFeeType,
    onSuccess: () => { onOk('نوع مبلغ حذف شد.'); refreshTypes(); },
    onError: onErr,
  });
  const assignMut = useMutation({
    mutationFn: () => assignSubjectFee({
      studentId: Number(assignForm.studentId),
      termId: assignForm.termId || (terms[0]?.id ?? 0),
      subjectFeeTypeId: assignForm.typeId,
      amount: Number(assignForm.amount),
      note: assignForm.note || undefined,
    }),
    onSuccess: async () => {
      setAssignMsg('تخصیص ثبت شد.');
      setAssignForm({ ...assignForm, amount: '', note: '' });
      await loadAssignments();
    },
    onError: (e: Error) => setAssignMsg(e.message),
  });
  const delAssignMut = useMutation({
    mutationFn: deleteSubjectFeeAssignment,
    onSuccess: async () => { setAssignMsg('حذف شد.'); await loadAssignments(); },
    onError: (e: Error) => setAssignMsg(e.message),
  });
  const loadAssignments = async () => {
    const sid = Number(assignForm.studentId);
    if (sid <= 0) return;
    try {
      setAssignList(await getSubjectFeeAssignments(sid, assignForm.termId || undefined));
    } catch (e) {
      setAssignMsg((e as Error).message);
    }
  };

  useEffect(() => {
    if (coefForm.termId === 0 && terms.length > 0) setCoefForm((f) => ({ ...f, termId: terms[0].id }));
    if (assignForm.termId === 0 && terms.length > 0) setAssignForm((f) => ({ ...f, termId: terms[0].id }));
  }, [terms, coefForm.termId, assignForm.termId]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">ضریب افزایشی نیمسال — upsert با سقف ±۲۰٪ در هر مرحله</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="sm:col-span-2"><Label className="text-[11px]">ترم</Label>
                <select value={coefForm.termId} onChange={(e) => setCoefForm({ ...coefForm, termId: Number(e.target.value) })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                  {terms.map((t) => <option key={t.id} value={t.id}>{t.termTitle}</option>)}
                </select>
              </div>
              <div><Label className="text-[11px]">ضریب متغیر</Label><Input type="number" step="0.01" value={coefForm.variable} onChange={(e) => setCoefForm({ ...coefForm, variable: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
              <div><Label className="text-[11px]">ضریب ثابت</Label><Input type="number" step="0.01" value={coefForm.fixed} onChange={(e) => setCoefForm({ ...coefForm, fixed: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
              <div className="sm:col-span-3"><Label className="text-[11px]">یادداشت</Label><Input value={coefForm.note} onChange={(e) => setCoefForm({ ...coefForm, note: e.target.value })} className="mt-1 h-8" /></div>
              <div className="flex items-end"><Button size="sm" disabled={saveCoefMut.isPending} onClick={() => saveCoefMut.mutate()}><Save className="size-4" aria-hidden /> ذخیره</Button></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-[11px]">
                <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">ترم</th><th className="p-1.5 text-center">متغیر</th><th className="p-1.5 text-center">ثابت</th><th className="p-1.5">یادداشت</th><th className="p-1.5"></th></tr></thead>
                <tbody>
                  {(coefs.data ?? []).length === 0 ? <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">ردیفی ثبت نشده است.</td></tr> : (coefs.data ?? []).map((c: FinanceCoefficient) => (
                    <tr key={c.id} className="border-b border-border/40 last:border-0">
                      <td className="p-1.5">{c.termTitle ?? '—'}</td>
                      <td className="p-1.5 text-center font-mono">{faNumber(c.variableCoefficient)}</td>
                      <td className="p-1.5 text-center font-mono">{faNumber(c.fixedCoefficient)}</td>
                      <td className="p-1.5 text-muted-foreground">{c.note ?? '—'}</td>
                      <td className="p-1.5"><Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delCoefMut.isPending} onClick={() => delCoefMut.mutate(c.id)}><Trash2 className="size-3" aria-hidden /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">نوع مبلغ موضوعی (افزایشی/کاهشی)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-3">
              <div><Label className="text-[11px]">کد</Label><Input value={typeForm.code} onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
              <div className="sm:col-span-2"><Label className="text-[11px]">عنوان</Label><Input value={typeForm.title} onChange={(e) => setTypeForm({ ...typeForm, title: e.target.value })} className="mt-1 h-8" /></div>
              <div><Label className="text-[11px]">نوع</Label>
                <select value={typeForm.kind} onChange={(e) => setTypeForm({ ...typeForm, kind: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                  <option value="ADDITIVE">افزایشی</option>
                  <option value="DEDUCTIVE">کاهشی</option>
                </select>
              </div>
              <div><Label className="text-[11px]">مبلغ ثابت</Label><Input type="number" value={typeForm.fixedAmount} onChange={(e) => setTypeForm({ ...typeForm, fixedAmount: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
              <div><Label className="text-[11px]">درصد متغیر</Label><Input type="number" value={typeForm.variablePercent} onChange={(e) => setTypeForm({ ...typeForm, variablePercent: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
              <div><Label className="text-[11px]">اعمال بر</Label>
                <select value={typeForm.appliesTo} onChange={(e) => setTypeForm({ ...typeForm, appliesTo: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                  <option value="BOTH">هر دو</option>
                  <option value="FIXED">ثابت</option>
                  <option value="VARIABLE">متغیر</option>
                </select>
              </div>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={typeForm.isActive} onChange={(e) => setTypeForm({ ...typeForm, isActive: e.target.checked })} /> فعال</label>
                <Button size="sm" disabled={saveTypeMut.isPending || !typeForm.code || !typeForm.title} onClick={() => saveTypeMut.mutate()}>
                  {typeForm.id ? <Save className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />} {typeForm.id ? 'ذخیره' : 'افزودن'}
                </Button>
                {typeForm.id ? <Button size="sm" variant="ghost" onClick={() => setTypeForm({ id: 0, code: '', title: '', kind: 'ADDITIVE', fixedAmount: 0, variablePercent: 0, appliesTo: 'BOTH', isActive: true, note: '' })}>انصراف</Button> : null}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-[11px]">
                <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">کد</th><th className="p-1.5">عنوان</th><th className="p-1.5">نوع</th><th className="p-1.5 text-left">ثابت</th><th className="p-1.5 text-center">٪</th><th className="p-1.5 text-center">فعال</th><th className="p-1.5"></th></tr></thead>
                <tbody>
                  {(types.data ?? []).length === 0 ? <tr><td colSpan={7} className="p-3 text-center text-muted-foreground">ردیفی ثبت نشده است.</td></tr> : (types.data ?? []).map((f: FinanceSubjectFeeType) => (
                    <tr key={f.id} className="border-b border-border/40 last:border-0">
                      <td className="p-1.5 font-mono text-[10px]" dir="ltr">{f.code}</td>
                      <td className="p-1.5">{f.title}</td>
                      <td className="p-1.5">{f.kind === 'DEDUCTIVE' ? 'کاهشی' : 'افزایشی'}</td>
                      <td className="p-1.5 text-left font-mono">{faNumber(f.fixedAmount)}</td>
                      <td className="p-1.5 text-center font-mono">{faNumber(f.variablePercent)}</td>
                      <td className="p-1.5 text-center">{f.isActive ? '✓' : '—'}</td>
                      <td className="p-1.5">
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setTypeForm({ id: f.id, code: f.code, title: f.title, kind: f.kind, fixedAmount: f.fixedAmount, variablePercent: f.variablePercent, appliesTo: f.appliesTo ?? 'BOTH', isActive: f.isActive, note: f.note ?? '' })}><Pencil className="size-3" aria-hidden /></Button>
                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delTypeMut.isPending} onClick={() => { if (confirm(`حذف «${f.title}»؟`)) delTypeMut.mutate(f.id); }}><Trash2 className="size-3" aria-hidden /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">تخصیص مبلغ موضوعی به دانشجو</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-5">
            <div><Label className="text-[11px]">شناسهٔ دانشجو</Label><Input value={assignForm.studentId} onChange={(e) => setAssignForm({ ...assignForm, studentId: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
            <div><Label className="text-[11px]">ترم</Label>
              <select value={assignForm.termId} onChange={(e) => setAssignForm({ ...assignForm, termId: Number(e.target.value) })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                {terms.map((t) => <option key={t.id} value={t.id}>{t.termTitle}</option>)}
              </select>
            </div>
            <div><Label className="text-[11px]">نوع</Label>
              <select value={assignForm.typeId} onChange={(e) => setAssignForm({ ...assignForm, typeId: Number(e.target.value) })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                <option value="0">—</option>
                {(types.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
              </select>
            </div>
            <div><Label className="text-[11px]">مبلغ (ریال)</Label><Input type="number" value={assignForm.amount} onChange={(e) => setAssignForm({ ...assignForm, amount: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
            <div className="flex items-end gap-1.5">
              <Button size="sm" disabled={assignMut.isPending || !assignForm.studentId || !assignForm.typeId || !assignForm.amount} onClick={() => assignMut.mutate()}><Plus className="size-4" aria-hidden /> تخصیص</Button>
              <Button size="sm" variant="outline" disabled={!assignForm.studentId} onClick={loadAssignments}>نمایش</Button>
            </div>
          </div>
          {assignMsg ? <p className="text-[11px] text-muted-foreground">{assignMsg}</p> : null}
          {assignList.length > 0 ? (
            <table className="w-full border-collapse text-right text-[11px]">
              <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">نوع</th><th className="p-1.5 text-left">مبلغ</th><th className="p-1.5">یادداشت</th><th className="p-1.5"></th></tr></thead>
              <tbody>
                {assignList.map((a) => (
                  <tr key={a.id} className="border-b border-border/40 last:border-0">
                    <td className="p-1.5">{a.typeTitle} <span className="text-[10px] text-muted-foreground">({a.typeKind === 'DEDUCTIVE' ? 'کاهشی' : 'افزایشی'})</span></td>
                    <td className="p-1.5 text-left font-mono">{faNumber(a.amount)}</td>
                    <td className="p-1.5 text-muted-foreground">{a.note ?? '—'}</td>
                    <td className="p-1.5"><Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delAssignMut.isPending} onClick={() => delAssignMut.mutate(a.id)}><Trash2 className="size-3" aria-hidden /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

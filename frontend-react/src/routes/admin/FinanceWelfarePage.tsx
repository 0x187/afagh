import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins, Pencil, Plus, Save, Trash2, Users } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faRial } from '@/lib/fa';
import {
  assignLoanToFund, createWelfareFund, deleteWelfareFund, getWelfareFunds,
  getWelfareLoans, updateWelfareFund, type WelfareFund,
} from '@/lib/admin-api';

// ═══ صندوق رفاه — صندوق‌ها و انتساب وام — پورت admin/finance/welfare ═══

const emptyFund = { id: 0, code: '', title: '', description: '', isActive: true };

export function AdminWelfarePage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyFund });
  const [selectedFund, setSelectedFund] = useState<WelfareFund | 'unassigned' | null>(null);
  const [page, setPage] = useState(1);

  const funds = useQuery({ queryKey: ['welfare-funds'], queryFn: getWelfareFunds, staleTime: 15_000 });
  const loans = useQuery({
    queryKey: ['welfare-loans', selectedFund === null ? 'none' : selectedFund === 'unassigned' ? 'unassigned' : selectedFund.id, page],
    queryFn: () => getWelfareLoans(selectedFund === 'unassigned' ? 'unassigned' : selectedFund === null ? 'unassigned' : (selectedFund as WelfareFund).id, page),
    enabled: selectedFund !== null,
    staleTime: 10_000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['welfare-funds'] });
    void qc.invalidateQueries({ queryKey: ['welfare-loans'] });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const input = { code: form.code, title: form.title, description: form.description || null, isActive: form.isActive };
      if (form.id) await updateWelfareFund(form.id, input);
      else await createWelfareFund(input);
    },
    onSuccess: () => { setMsg(form.id ? 'صندوق ویرایش شد.' : 'صندوق ساخته شد.'); setForm({ ...emptyFund }); refresh(); },
    onError: (e: Error) => setMsg(e.message === 'duplicate_code' ? 'این کد صندوق قبلاً ثبت شده است.' : e.message),
  });
  const delMut = useMutation({
    mutationFn: deleteWelfareFund,
    onSuccess: () => { setMsg('صندوق حذف شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message.includes('fund_in_use') ? 'صندوق دارای وام است؛ ابتدا وام‌ها را منتقل کنید.' : e.message),
  });
  const assignMut = useMutation({
    mutationFn: ({ loanId, fundId }: { loanId: number; fundId: number | null }) => assignLoanToFund(loanId, fundId),
    onSuccess: () => { setMsg('انتساب صندوق به‌روزرسانی شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });

  if (funds.isLoading) return <Skeleton className="h-72 w-full" />;
  if (funds.isError || !funds.data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت صندوق‌ها ناموفق بود.</CardContent></Card>;

  const fundOptions = funds.data;
  const pageCount = Math.max(1, Math.ceil((loans.data?.total ?? 0) / 50));

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-emerald-800 via-teal-800 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-base font-black"><HandCoins className="size-5" aria-hidden /> صندوق رفاه</h1>
          <p className="mt-0.5 text-xs text-emerald-100">صندوق‌های حمایتی و انتساب وام دانشجویان — مبلغ وام از دفتر مالی بدهی/اعتبار می‌سازد.</p>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Plus className="size-4" aria-hidden /> {form.id ? 'ویرایش صندوق' : 'صندوق جدید'}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            <div><Label className="text-[11px]">کد</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
            <div className="sm:col-span-2"><Label className="text-[11px]">عنوان</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 h-8" /></div>
            <div className="sm:col-span-2"><Label className="text-[11px]">توضیح</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 h-8" /></div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> فعال</label>
              <Button size="sm" disabled={saveMut.isPending || !form.code || !form.title} onClick={() => saveMut.mutate()}>
                {form.id ? <Save className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />} {form.id ? 'ذخیره' : 'ساخت'}
              </Button>
              {form.id ? <Button size="sm" variant="ghost" onClick={() => setForm({ ...emptyFund })}>انصراف</Button> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">صندوق‌ها</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            <button type="button" onClick={() => { setSelectedFund('unassigned'); setPage(1); }}
              className={`flex w-full items-center justify-between rounded-xl border px-2.5 py-1.5 text-[11px] ${selectedFund === 'unassigned' ? 'border-amber-400 bg-amber-50 dark:bg-amber-950' : 'border-border hover:bg-muted/40'}`}>
              <span className="font-bold">بدون صندوق</span>
              <Badge variant="outline" className="text-[10px]"><Users className="ml-1 size-3" aria-hidden /> وام‌های بی‌صندوق</Badge>
            </button>
            {fundOptions.length === 0 ? <p className="py-3 text-center text-xs text-muted-foreground">صندوقی ثبت نشده است.</p> : fundOptions.map((f) => (
              <div key={f.id} className={`flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-[11px] ${selectedFund !== 'unassigned' && selectedFund?.id === f.id ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20' : 'border-border'}`}>
                <button type="button" className="text-right font-bold underline decoration-dotted underline-offset-4" onClick={() => { setSelectedFund(f); setPage(1); }}>{f.title}</button>
                <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{f.code}</span>
                <Badge className={f.isActive ? 'border-transparent bg-emerald-100 text-emerald-800' : 'border-transparent bg-slate-100 text-slate-700'}>{f.isActive ? 'فعال' : 'غیرفعال'}</Badge>
                <span className="text-muted-foreground">{faDigits(f.loanCount)} وام</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setForm({ id: f.id, code: f.code, title: f.title, description: f.description ?? '', isActive: f.isActive })}><Pencil className="size-3" aria-hidden /></Button>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delMut.isPending} onClick={() => { if (confirm(`حذف صندوق «${f.title}»؟`)) delMut.mutate(f.id); }}><Trash2 className="size-3" aria-hidden /></Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {selectedFund !== null ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">وام‌های {selectedFund === 'unassigned' ? 'بدون صندوق' : selectedFund.title}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {loans.isLoading ? <Skeleton className="h-24 w-full" /> : (
              <table className="w-full border-collapse text-right text-[11px]">
                <thead><tr className="border-b border-border bg-muted/60 text-muted-foreground">
                  <th className="p-1.5">دانشجو</th><th className="p-1.5">وام</th><th className="p-1.5 text-left">مبلغ</th>
                  <th className="p-1.5 text-center">اقساط</th><th className="p-1.5 text-center">وضعیت</th><th className="p-1.5">انتساب صندوق</th>
                </tr></thead>
                <tbody>
                  {(loans.data?.rows ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="p-5 text-center text-muted-foreground">وامی یافت نشد.</td></tr>
                  ) : (loans.data?.rows ?? []).map((l) => (
                    <tr key={l.id} className="border-b border-border/40 last:border-0">
                      <td className="p-1.5">{l.studentName} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{faDigits(l.studentCode)}</span></td>
                      <td className="p-1.5">{l.loanCode ?? l.lender ?? '—'}</td>
                      <td className="p-1.5 text-left font-mono">{faRial(l.amount)}</td>
                      <td className="p-1.5 text-center font-mono">{l.installments == null ? '—' : faDigits(l.installments)}</td>
                      <td className="p-1.5 text-center">{l.status ?? '—'}</td>
                      <td className="p-1.5">
                        <select value={l.welfareFundId ?? ''} onChange={(e) => assignMut.mutate({ loanId: l.id, fundId: e.target.value === '' ? null : Number(e.target.value) })}
                          className="h-6 rounded border border-input bg-transparent px-1 text-[10px]">
                          <option value="">بدون صندوق</option>
                          {fundOptions.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pageCount > 1 ? (
              <div className="mt-2 flex items-center justify-center gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>قبلی</Button>
                <span className="text-[11px] text-muted-foreground">صفحهٔ {faDigits(page)} از {faDigits(pageCount)}</span>
                <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>بعدی</Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

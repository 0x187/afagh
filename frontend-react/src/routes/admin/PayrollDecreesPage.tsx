import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSignature, Printer, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  deleteDecreeDraft, finalizeDecree, getDecreeDetail, getPayrollTerms,
  issueDecree, listDecrees, searchPayrollStaff,
  type DecreeDetail, type DecreeSigner, type StaffHit,
} from '@/lib/payroll-api';

// ═══ Educational decrees — port of payroll/decrees ═══

const STATUS_FA: Record<string, string> = { DRAFT: 'پیش‌نویس', ISSUED: 'صادرشده' };
const SECTION_FA: Record<string, string> = {
  COURSES: 'تدریس', THESIS: 'پایان‌نامه', ACTIVITIES: 'فعالیت‌ها', EXAM: 'امتحان', SUMMARY: 'جمع‌بندی',
};

export function PayrollDecreesPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [termId, setTermId] = useState(0);
  const [staffQuery, setStaffQuery] = useState('');
  const [staffId, setStaffId] = useState(0);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [signers, setSigners] = useState<DecreeSigner[]>([
    { title: 'معاون آموزشی', name: '' }, { title: 'مدیر گروه', name: '' },
    { title: 'رئیس دانشگاه', name: '' }, { title: 'کارشناس مالی', name: '' },
  ]);
  const [detail, setDetail] = useState<DecreeDetail | null>(null);

  const terms = useQuery({ queryKey: ['payroll-terms'], queryFn: getPayrollTerms, staleTime: 60_000 });
  const current = (terms.data ?? []).find((t) => t.isCurrent) ?? (terms.data ?? [])[0];
  const effectiveTerm = termId || (current?.id ?? 0);
  const hits = useQuery({
    queryKey: ['payroll-staff', staffQuery],
    queryFn: () => searchPayrollStaff(staffQuery),
    enabled: staffQuery.trim().length >= 2,
  });
  const list = useQuery({
    queryKey: ['decrees', effectiveTerm],
    queryFn: () => listDecrees(effectiveTerm),
    enabled: effectiveTerm > 0,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['decrees', effectiveTerm] });

  const issueMut = useMutation({
    mutationFn: () => issueDecree(staffId, effectiveTerm, signers),
    onSuccess: (id) => { setMsg(`ابلاغ #${faNumber(id)} به‌صورت پیش‌نویس صادر شد.`); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const finalizeMut = useMutation({
    mutationFn: finalizeDecree,
    onSuccess: () => { setMsg('ابلاغ نهایی شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const delMut = useMutation({
    mutationFn: deleteDecreeDraft,
    onSuccess: () => { setMsg('پیش‌نویس حذف شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const detailMut = useMutation({
    mutationFn: () => getDecreeDetail(detail!.id),
    onSuccess: (d) => setDetail(d),
    onError: (e: Error) => setMsg(e.message),
  });

  if (terms.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-indigo-900 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-base font-black"><FileSignature className="size-5" aria-hidden /> ابلاغ‌های آموزشی</h1>
            <p className="mt-0.5 text-xs text-indigo-100">صدور ابلاغ تدریس با اسنپ‌شات محاسبه، اقلام بخش‌ها و شمارهٔ دبیرخانهٔ خودکار</p>
          </div>
          <select value={effectiveTerm} onChange={(e) => setTermId(Number(e.target.value))} className="h-8 rounded-lg border border-white/30 bg-transparent px-2 text-xs text-white">
            {(terms.data ?? []).map((t) => <option key={t.id} value={t.id} className="text-foreground">{t.title}</option>)}
          </select>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">صدور ابلاغ جدید</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-[11px]">جست‌وجوی استاد</Label>
              <Input value={staffQuery} onChange={(e) => setStaffQuery(e.target.value)} className="mt-1 h-8" placeholder="کد پرسنلی یا نام…" />
              {(hits.data ?? []).length > 0 ? (
                <div className="mt-1 space-y-0.5">
                  {(hits.data ?? []).map((h: StaffHit) => (
                    <button key={h.id} type="button" onClick={() => { setStaffId(h.id); setSelectedStaff(`${h.name} — ${h.staffCode ? faDigits(h.staffCode) : ''}`); setStaffQuery(''); }}
                      className={`block w-full rounded border px-2 py-0.5 text-right text-[11px] ${staffId === h.id ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950' : 'border-border'}`}>
                      {h.name} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{h.staffCode}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {selectedStaff ? <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">انتخاب: {selectedStaff}</p> : null}
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[11px]">امضاکنندگان (حداکثر ۴)</Label>
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                {signers.map((s, i) => (
                  <div key={i} className="flex gap-1">
                    <Input value={s.name} onChange={(e) => setSigners(signers.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                      className="h-8 text-[11px]" placeholder={s.title} aria-label={s.title} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <Button size="sm" disabled={issueMut.isPending || !staffId || !effectiveTerm} onClick={() => issueMut.mutate()}>
            <FileSignature className="size-4" aria-hidden /> صدور پیش‌نویس ابلاغ
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">فهرست ابلاغ‌ها — {current?.title ?? ''}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {list.isLoading ? <Skeleton className="h-32 w-full" /> : (
            <table className="w-full border-collapse text-right text-xs">
              <thead><tr className="border-b border-border bg-muted/60 text-muted-foreground">
                <th className="p-2">شمارهٔ دبیرخانه</th><th className="p-2">استاد</th><th className="p-2">وضعیت</th><th className="p-2">تاریخ صدور</th><th className="p-2"></th>
              </tr></thead>
              <tbody>
                {(list.data ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">ابلاغی برای این ترم ثبت نشده است.</td></tr>
                ) : (list.data ?? []).map((d) => (
                  <tr key={d.id} className="border-b border-border/40 last:border-0">
                    <td className="p-2 font-mono">{faNumber(d.secretariatNo)}</td>
                    <td className="p-2">
                      <button type="button" onClick={() => { setDetail(d as never); detailMut.mutate(); }} className="font-bold underline decoration-dotted underline-offset-4">{d.staffName}</button>
                      <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{d.staffCode ? faDigits(d.staffCode) : ''}</div>
                    </td>
                    <td className="p-2"><Badge className={d.status === 'ISSUED' ? 'border-transparent bg-emerald-100 text-emerald-800' : 'border-transparent bg-amber-100 text-amber-800'}>{STATUS_FA[d.status] ?? d.status}</Badge></td>
                    <td className="p-2 font-mono text-[10px]" dir="ltr">{d.issuedAt ? faDigits(d.issuedAt.slice(0, 10)) : '—'}</td>
                    <td className="p-2">
                      <div className="flex gap-1">
                        {d.status === 'DRAFT' ? (
                          <>
                            <Button size="sm" className="h-6 bg-emerald-700 px-1.5 text-[10px] text-white hover:bg-emerald-800" disabled={finalizeMut.isPending} onClick={() => finalizeMut.mutate(d.id)}>نهایی</Button>
                            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delMut.isPending} onClick={() => { if (confirm('حذف پیش‌نویس؟')) delMut.mutate(d.id); }}><Trash2 className="size-3.5" aria-hidden /></Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" dir="rtl">
          <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>ابلاغ شمارهٔ {faNumber(detail.secretariatNo)} — {detail.staffName}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7" onClick={() => window.print()}><Printer className="size-3.5" aria-hidden /></Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setDetail(null)}>بستن</Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-[11px]">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">ترم: {detail.termTitle ?? '—'}</Badge>
                <Badge variant="outline">وضعیت: {STATUS_FA[detail.status] ?? detail.status}</Badge>
                {detail.issuedByName ? <Badge variant="outline">صادرکننده: {detail.issuedByName}</Badge> : null}
              </div>
              {detail.signers.length > 0 ? (
                <p className="text-muted-foreground">امضاکنندگان: {detail.signers.map((s) => `${s.title}: ${s.name}`).filter((s) => !s.endsWith(': ')).join(' · ') || '—'}</p>
              ) : null}
              <table className="w-full border-collapse text-right">
                <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">بخش</th><th className="p-1.5">شرح</th><th className="p-1.5 text-center">واحد</th><th className="p-1.5 text-left">مبلغ</th></tr></thead>
                <tbody>
                  {detail.items.map((it) => (
                    <tr key={it.id} className={it.section === 'SUMMARY' ? 'border-t-2 border-border font-black' : 'border-b border-border/40'}>
                      <td className="p-1.5">{SECTION_FA[it.section] ?? it.section}</td>
                      <td className="p-1.5">{it.title}</td>
                      <td className="p-1.5 text-center font-mono">{it.units == null ? '—' : faNumber(it.units)}</td>
                      <td className="p-1.5 text-left font-mono">{it.amount == null ? '—' : faNumber(it.amount)}</td>
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

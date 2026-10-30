import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, Printer, Wallet } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  createProfessorObjection, getProfessorObjections, getProfessorPayslip,
} from '@/lib/payroll-api';

// ═══ فیش حقالتدریس استاد + اعتراض — پورت پورتال استاد ═══

export function ProfessorPayrollPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [objectionText, setObjectionText] = useState('');

  const payslip = useQuery({ queryKey: ['professor-payslip'], queryFn: getProfessorPayslip, staleTime: 30_000 });
  const objections = useQuery({ queryKey: ['professor-objections'], queryFn: getProfessorObjections, staleTime: 30_000 });

  const objMut = useMutation({
    mutationFn: () => {
      const sid = payslip.data?.statement?.id;
      if (!sid) throw new Error('فیش محاسبه‌شده‌ای وجود ندارد.');
      return createProfessorObjection(sid, objectionText);
    },
    onSuccess: () => {
      setMsg('اعتراض شما ثبت شد و در کارتابل کارشناس قرار گرفت.');
      setObjectionText('');
      void qc.invalidateQueries({ queryKey: ['professor-objections'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (payslip.isLoading) return <Skeleton className="h-72 w-full" />;
  if (payslip.isError || !payslip.data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت فیش ناموفق بود.</CardContent></Card>;
  }

  const d = payslip.data;
  const c = d.calc;
  const settled = d.statement?.status === 'FINAL_SETTLED';
  const canObject = d.statement && d.statement.status !== 'FINAL_SETTLED';

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-emerald-900 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-base font-black"><Wallet className="size-5" aria-hidden /> فیش حق‌التدریس — {d.term}</h1>
            <p className="mt-0.5 text-xs text-emerald-100">
              {d.computed ? (settled ? 'تسویهٔ نهایی انجام شده است.' : 'فیش این ترم محاسبه شده است.') : 'فیش این ترم هنوز محاسبه نشده است.'}
            </p>
          </div>
          {d.computed ? <Button size="sm" className="bg-white/15 text-white hover:bg-white/25" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> چاپ</Button> : null}
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      {c ? (
        <>
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  ['ناخالص (ریال)', faNumber(c.gross)],
                  ['کسر غیبت (ریال)', faNumber(c.absenceDeductionRial)],
                  ['مالیات (ریال)', faNumber(c.tax)],
                  ['خالص (ریال)', faNumber(c.net)],
                ] as const).map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-border bg-muted/30 px-3 py-2">
                    <div className="text-[10px] text-muted-foreground">{k}</div>
                    <div className="mt-0.5 font-mono text-sm font-black">{v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <Badge variant="outline">واحد مؤثر: {faNumber(c.totalEffectiveUnits)} / معادل {faNumber(c.totalEquivalentUnits)}</Badge>
                <Badge variant="outline">موظفی: {faNumber(c.dutyUnits)} واحد</Badge>
                <Badge variant="outline">نرخ: {faNumber(c.rate)} ریال/واحد</Badge>
                <Badge variant="outline">نرخ از: {c.rateSource === 'SNAPSHOT' ? 'اسنپ‌شات قرارداد' : c.rateSource === 'FRACTION' ? 'نسبت حکم' : 'جدول'}</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="overflow-x-auto pt-4">
              <table className="w-full border-collapse text-right text-[11px]">
                <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">درس</th><th className="p-1.5">نقش</th><th className="p-1.5 text-center">جلسات</th><th className="p-1.5">ضرایب/فرمول</th><th className="p-1.5 text-center">معادل</th><th className="p-1.5 text-center">مؤثر</th><th className="p-1.5 text-left">ناخالص</th></tr></thead>
                <tbody>
                  {c.rows.map((r) => (
                    <tr key={r.offeringId} className="border-b border-border/40 last:border-0">
                      <td className="p-1.5">{r.courseTitle} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{r.courseCode}</span></td>
                      <td className="p-1.5">{r.payRole}</td>
                      <td className="p-1.5 text-center font-mono">{faNumber(r.sessions.held)}{r.sessions.netAbsences > 0 ? <span className="text-rose-600"> −{faNumber(r.sessions.netAbsences)}</span> : null}</td>
                      <td className="p-1.5">{r.coefficients}</td>
                      <td className="p-1.5 text-center font-mono">{faNumber(r.equivalentUnits)}</td>
                      <td className="p-1.5 text-center font-mono">{faNumber(r.effectiveUnits)}</td>
                      <td className="p-1.5 text-left font-mono">{faNumber(r.grossRial)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}

      {canObject ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Gavel className="size-4" aria-hidden /> اعتراض به فیش</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Label className="text-[11px]">متن اعتراض (حداقل ۵ حرف)</Label>
            <textarea value={objectionText} onChange={(e) => setObjectionText(e.target.value)} rows={3}
              className="w-full rounded-lg border border-input bg-transparent p-2 text-xs" placeholder="اشکال فیش را دقیق شرح دهید…" />
            <Button size="sm" disabled={objMut.isPending || objectionText.trim().length < 5} onClick={() => objMut.mutate()}>
              ثبت اعتراض
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">اعتراض‌های من</CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          {objections.isLoading ? <Skeleton className="h-20 w-full" /> : (objections.data ?? []).length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">اعتراضی ثبت نکرده‌اید.</p>
          ) : (objections.data ?? []).map((o) => (
            <div key={o.id} className="rounded-xl border border-border px-3 py-2 text-[11px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge className={
                  o.status === 'OPEN' ? 'border-transparent bg-amber-100 text-amber-800' :
                  o.status === 'RESOLVED' ? 'border-transparent bg-emerald-100 text-emerald-800' :
                  'border-transparent bg-slate-100 text-slate-700'
                }>
                  {o.status === 'OPEN' ? 'در انتظار رسیدگی' : o.status === 'RESOLVED' ? 'رسیدگی شد' : 'وارد نیست'}
                </Badge>
                <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{o.createdAt ? faDigits(o.createdAt.slice(0, 10)) : ''}</span>
              </div>
              <p className="mt-1">{o.text}</p>
              {o.reviewNote ? <p className="mt-1 rounded-lg bg-muted/40 p-1.5 text-muted-foreground">پاسخ کارشناس: {o.reviewNote}</p> : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

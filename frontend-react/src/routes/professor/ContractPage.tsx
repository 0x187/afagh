import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSignature, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, faRial } from '@/lib/fa';
import { getProfessorContract, sendContractOTP, signContract } from '@/lib/professor-api';

// ═══ Professor teaching contract — port of professor/contract ═══

export function ProfessorContractPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['professor-contract'], queryFn: getProfessorContract, staleTime: 30_000 });
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const otpMut = useMutation({
    mutationFn: (documentId: number) => sendContractOTP(documentId),
    onSuccess: (r) => {
      setDevOtp(r.devOtp ?? null);
      setMsg('کد تأیید صادر شد.');
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const signMut = useMutation({
    mutationFn: ({ documentId }: { documentId: number }) => signContract(documentId, otp),
    onSuccess: async () => {
      setMsg('قرارداد با موفقیت امضا شد.');
      setOtp('');
      setDevOtp(null);
      await qc.invalidateQueries({ queryKey: ['professor-contract'] });
      await qc.invalidateQueries({ queryKey: ['professor-dashboard'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-[60vh] w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت قرارداد ناموفق بود.</CardContent></Card>;
  }

  if (!data.contract) {
    return (
      <Card>
        <CardContent className="space-y-2 p-8 text-center">
          <p className="text-sm font-bold">{data.message ?? 'قرارداد قابل ساخت نیست.'}</p>
          <p className="text-xs text-muted-foreground">پس از تخصیص دروس توسط مدیر گروه، قرارداد به‌صورت خودکار ساخته می‌شود.</p>
        </CardContent>
      </Card>
    );
  }

  const c = data.contract;
  const signed = c.signatureStatus === 'SIGNED';

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
            <FileSignature className="size-4.5" aria-hidden />
          </span>
          <div>
            <h1 className="text-sm font-bold">قرارداد حق‌التدریس — {c.termTitle}</h1>
            <p className="text-[11px] text-muted-foreground">شمارهٔ قرارداد: <b className="font-mono" dir="ltr">{c.contractNo}</b></p>
          </div>
        </div>
        {signed ? (
          <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            <ShieldCheck className="me-1 size-3.5" aria-hidden /> امضا شده در {faDigits(c.signedAt?.slice(0, 10) ?? '')}
          </Badge>
        ) : (
          <Badge className="border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100">در انتظار امضای الکترونیک</Badge>
        )}
      </div>

      {msg ? <div className="no-print rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      {!signed && c.documentId ? (
        <Card className="no-print">
          <CardContent className="space-y-2 p-4">
            <p className="text-xs font-bold">امضای الکترونیک با کد یک‌بارمصرف</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={otpMut.isPending} onClick={() => otpMut.mutate(c.documentId!)}>
                دریافت کد تأیید
              </Button>
              <Input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="کد ۶ رقمی" className="h-8 max-w-40 text-center font-mono" inputMode="numeric" />
              <Button size="sm" disabled={signMut.isPending || otp.trim().length < 4} onClick={() => signMut.mutate({ documentId: c.documentId! })}>
                ثبت امضا
              </Button>
            </div>
            {devOtp ? <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">کد توسعه (فقط محلی): <span className="font-mono" dir="ltr">{devOtp}</span></p> : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="print-area space-y-4 rounded-xl border-2 border-slate-800 bg-white p-5 text-xs text-slate-900 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-slate-800 pb-3">
          <div>
            <p className="text-[11px] text-slate-500">جمهوری اسلامی ایران — {data.university.title}</p>
            <h2 className="mt-1 text-base font-black">قرارداد حق‌التدریس آموزشی اعضای هیئت علمی و مدعو</h2>
            <p className="mt-1 text-[11px]">شمارهٔ قرارداد: <b className="font-mono" dir="ltr">{c.contractNo}</b> · تاریخ صدور: {faDigits(c.contractDate)}</p>
          </div>
          <div className="text-left text-[10px] text-slate-500">
            <p>کد سند: <span className="font-mono">{faDigits(c.contractNo)}</span></p>
            <p>هش سند: <span className="font-mono" dir="ltr">{c.digitalHash ? c.digitalHash.slice(0, 16) : '—'}</span></p>
          </div>
        </div>

        <p className="leading-7">
          این قرارداد بر اساس آیین‌نامهٔ استخدامی اعضای هیئت علمی و مصوبات هیئت امنای دانشگاه، در تاریخ{' '}
          <b>{faDigits(c.contractDate)}</b> فیمابین طرفین زیر منعقد می‌گردد:
        </p>
        <p className="leading-7">
          <b>طرف اول:</b> {data.university.title} به نمایندگی ادارهٔ کل آموزش.
          <br />
          <b>طرف دوم:</b> {c.professorName}، کد ملی: <span className="font-mono">{faDigits(c.nationalCode)}</span>،
          کد پرسنلی: <span className="font-mono">{faDigits(c.staffCode)}</span>، مرتبهٔ علمی: {c.academicRank || '—'}،
          دانشکده/گروه: {c.departmentName || '—'}، نوع همکاری: {c.cooperationType}.
        </p>

        <table className="w-full border-collapse text-right text-[11px]">
          <thead>
            <tr className="border-y-2 border-slate-800 bg-slate-100 font-bold">
              <th className="border-l border-slate-300 p-1.5">ردیف</th>
              <th className="border-l border-slate-300 p-1.5">کد درس</th>
              <th className="border-l border-slate-300 p-1.5">عنوان درس</th>
              <th className="border-l border-slate-300 p-1.5 text-center">گروه</th>
              <th className="border-l border-slate-300 p-1.5 text-center">واحد نظری</th>
              <th className="border-l border-slate-300 p-1.5 text-center">واحد عملی</th>
              <th className="border-l border-slate-300 p-1.5 text-center">ساعت هفتگی</th>
              <th className="p-1.5 text-center">ساعت ترم</th>
            </tr>
          </thead>
          <tbody>
            {c.lines.map((l, i) => (
              <tr key={`${l.offeringId}-${i}`} className="border-b border-slate-200">
                <td className="border-l border-slate-200 p-1.5 text-center text-slate-500">{faNumber(i + 1)}</td>
                <td className="border-l border-slate-200 p-1.5 font-mono" dir="ltr">{l.code}</td>
                <td className="border-l border-slate-200 p-1.5 font-semibold">{l.title}</td>
                <td className="border-l border-slate-200 p-1.5 text-center">{faNumber(l.groupNumber)}</td>
                <td className="border-l border-slate-200 p-1.5 text-center">{faNumber(l.theoryUnits)}</td>
                <td className="border-l border-slate-200 p-1.5 text-center">{faNumber(l.practicalUnits)}</td>
                <td className="border-l border-slate-200 p-1.5 text-center">{faNumber(l.weeklyHours)}</td>
                <td className="p-1.5 text-center">{faNumber(l.termTotalHours)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-800 font-black">
              <td className="p-1.5" colSpan={3}>جمع کل</td>
              <td className="p-1.5 text-center">{faNumber(c.totalUnits)} واحد</td>
              <td className="p-1.5 text-center" colSpan={2} />
              <td className="p-1.5 text-center">{faNumber(c.totalTermHours)} ساعت</td>
              <td />
            </tr>
          </tfoot>
        </table>

        <div className="grid gap-2 sm:grid-cols-4">
          {[
            ['نرخ ساعتی', faRial(c.hourlyRate)],
            ['مبلغ ناخالص', faRial(c.grossAmount)],
            [`کسورات (${faNumber(c.taxRatePercent)}٪ مالیات + ${faNumber(c.insuranceRatePercent)}٪ بیمه)`, faRial(c.taxDeduction + c.insuranceDeduction)],
            ['مبلغ خالص', faRial(c.netAmount)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] font-bold text-slate-500">{k}</div>
              <div className="mt-0.5 font-mono text-[12px] font-black">{v}</div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-500">
          پرداخت میان‌ترم: {faRial(c.midtermPayment)} · پرداخت پایان‌ترم: {faRial(c.finalPayment)} — منقضی بر اساس آیین‌نامهٔ مالی دانشگاه.
        </p>

        <div className="grid grid-cols-2 gap-4 border-t border-slate-400 pt-4 text-center text-[11px] font-bold">
          <div>
            <p>طرف دوم — استاد</p>
            <div className="mt-8 border-t border-slate-400 pt-1">{c.professorName}</div>
          </div>
          <div>
            <p>طرف اول — دانشگاه</p>
            <div className="mt-8 border-t border-slate-400 pt-1">مهر و امضای ادارهٔ آموزش</div>
          </div>
        </div>
        {signed ? (
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-[10px] text-emerald-900">
            ✓ این سند در {faDigits(c.signedAt?.slice(0, 19).replace('T', ' ') ?? '')} به‌صورت الکترونیک امضا شده است.
          </p>
        ) : null}
      </div>
    </div>
  );
}

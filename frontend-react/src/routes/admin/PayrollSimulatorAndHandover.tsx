import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet, apiPost } from '@/lib/api';
import { faNumber } from '@/lib/fa';

// ═══ صفحهٔ عمومی تحویل اوراق امتحان + شبیه‌ساز حقوق (دادهٔ نمونه) ═══

type HandoverVerify = {
  ok: boolean; step: string; title: string;
  details: { label: string; value: string }[];
  sessionId: number; hallId: number; offeringId: number;
  reason?: string; message?: string;
};

export function ExamHandoverPage() {
  const { token } = useParams<{ token: string }>();
  const q = useQuery({
    queryKey: ['exam-handover', token],
    queryFn: () => apiGet<{ ok: boolean; data: HandoverVerify }>(`/public/exam-handover/${encodeURIComponent(token ?? '')}`).then((r) => r.data),
    retry: false,
  });
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const confirm = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; data: { message?: string }; error?: string }>(`/public/exam-handover/${encodeURIComponent(token ?? '')}/confirm`, {}),
    onSuccess: (res) => {
      if (res.ok) setResult({ ok: true, text: res.data?.message ?? 'تحویل ثبت شد.' });
      else setResult({ ok: false, text: res.error ?? 'ثبت تحویل ممکن نشد.' });
    },
    onError: (e: Error) => setResult({ ok: false, text: e.message }),
  });

  if (q.isLoading) return <div className="flex min-h-screen items-center justify-center bg-slate-100"><Skeleton className="h-64 w-96" /></div>;

  if (q.isError || !q.data || !q.data.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4" dir="rtl">
        <div className="w-full max-w-lg space-y-4 rounded-3xl border-2 border-rose-500 bg-slate-900 p-6 text-center text-slate-100 shadow-2xl">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-rose-950 text-4xl text-rose-400">✕</div>
          <h2 className="text-xl font-black text-rose-400">{q.data?.reason === 'EXPIRED' ? 'کد تحویل منقضی شده است' : 'کد تحویل نامعتبر است'}</h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-slate-300">{q.data?.message ?? 'کد تحویل نامعتبر است.'}</p>
          <Link to="/" className="inline-block rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200">بازگشت</Link>
        </div>
      </div>
    );
  }

  const d = q.data;
  const stepLabel: Record<string, string> = {
    VAULT: 'دریافت اوراق سالن توسط مخزن', FINALIZE: 'نهاییسازی تحویل اوراق به مخزن',
    INSTRUCTOR: 'تحویل اوراق درس به استاد', ARCHIVE: 'بازگشت اوراق به بایگانی',
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4" dir="rtl">
      <div className="w-full max-w-xl space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full border-2 border-indigo-500 bg-indigo-50 text-2xl">🧾</div>
          <h1 className="text-lg font-black text-slate-900">{d.title}</h1>
          <p className="mt-1 text-xs font-bold text-indigo-700">{stepLabel[d.step] ?? d.step}</p>
        </div>
        <dl className="space-y-2 text-xs">
          {d.details.map((det, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <dt className="font-bold text-slate-500">{det.label}</dt>
              <dd className="font-black text-slate-800">{det.value}</dd>
            </div>
          ))}
        </dl>
        {result?.ok ? (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-center">
            <div className="text-2xl">✓</div>
            <p className="mt-1 text-sm font-black text-emerald-800">{result.text}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <Button className="w-full rounded-2xl bg-indigo-900 py-3 text-sm font-black text-white" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
              {confirm.isPending ? 'در حال ثبت…' : `✅ تأیید ${stepLabel[d.step] ?? d.step}`}
            </Button>
            {result && !result.ok ? <p className="rounded-xl border border-rose-300 bg-rose-50 p-2 text-center text-xs font-bold text-rose-800">{result.text}</p> : null}
          </div>
        )}
        <p className="text-center text-[10px] text-slate-500">هر تحویل با هویت تحویلگیرنده و در زنجیرهٔ ممیزی ثبت می‌شود — کد یکبارمصرف و کوتاه‌مدت است (۳ ساعت).</p>
      </div>
    </div>
  );
}

// ═══ شبیه‌ساز سناریوی حقوق — دادهٔ نمونه صرفاً کلاینتی ═══

type SimProf = {
  id: number; name: string; staffCode: string; contractType: string; units: number;
  baseRatePerUnit: number; taxRate: number; overloadUnits: number;
  classAbsencePenaltyAmount: number; examAbsencePenaltyAmount: number; lateGradePenaltyAmount: number;
  grossAmount: number; taxAmount: number; totalDeductions: number; netAmount: number;
  status: 'DRAFT' | 'DEPT_HEAD_APPROVED' | 'DEAN_APPROVED' | 'FINANCE_SETTLED';
  gradesFinalized: boolean; contractSigned: boolean;
};

const STATUS_FA_SIM: Record<string, string> = {
  DRAFT: 'پیش‌نویس', DEPT_HEAD_APPROVED: 'تأیید مدیر گروه', DEAN_APPROVED: 'تأیید معاون', FINANCE_SETTLED: 'تسویه‌شده',
};

function mkProf(id: number, name: string, code: string, ct: string, units: number, rate: number, tax: number, over: number, gf: boolean, cs: boolean): SimProf {
  const gross = over * rate;
  const taxAmt = gross * tax;
  const ded = taxAmt;
  const net = Math.max(0, gross - ded);
  return {
    id, name, staffCode: code, contractType: ct, units, baseRatePerUnit: rate, taxRate: tax,
    overloadUnits: over, classAbsencePenaltyAmount: 0, examAbsencePenaltyAmount: 0, lateGradePenaltyAmount: 0,
    grossAmount: gross, taxAmount: taxAmt, totalDeductions: ded, netAmount: net,
    status: 'DRAFT', gradesFinalized: gf, contractSigned: cs,
  };
}

const INITIAL_PROFS: SimProf[] = [
  mkProf(1, 'دکتر علی رضایی', '31410000', 'ALL_TERM', 12, 1_800_000, 0.1, 12, true, true),
  mkProf(2, 'دکتر مریم احمدی', '31410001', 'MILESTONE', 8, 2_000_000, 0.08, 8, true, true),
  mkProf(3, 'دکتر رضا کریمی', '31410002', 'ALL_TERM', 10, 1_500_000, 0.12, 6, false, true),
  mkProf(4, 'دکتر سارا موسوی', '31410003', 'HOURLY', 6, 2_200_000, 0.09, 4, true, false),
];

const nextStatus = (s: SimProf['status']): SimProf['status'] => {
  if (s === 'DRAFT') return 'DEPT_HEAD_APPROVED';
  if (s === 'DEPT_HEAD_APPROVED') return 'DEAN_APPROVED';
  if (s === 'DEAN_APPROVED') return 'FINANCE_SETTLED';
  return s;
};

export function PayrollSimulatorPage() {
  const [profs, setProfs] = useState(INITIAL_PROFS);
  const [msg, setMsg] = useState('');

  function recalcAll() {
    setProfs((prev) => prev.map((r) => {
      const gross = r.overloadUnits * r.baseRatePerUnit;
      const tax = gross * r.taxRate;
      const net = Math.max(0, gross - tax);
      return { ...r, grossAmount: gross, taxAmount: tax, totalDeductions: tax, netAmount: net };
    }));
    setMsg('همهٔ فیش‌ها بازمحاسبه شد.');
  }

  function approveStage(id: number) {
    setProfs((prev) => prev.map((r) => (r.id === id ? { ...r, status: nextStatus(r.status) } : r)));
  }

  function batchSettle() {
    setProfs((prev) => prev.map((r) => (r.status === 'DEAN_APPROVED' && r.gradesFinalized && r.contractSigned ? { ...r, status: 'FINANCE_SETTLED' as const } : r)));
    setMsg('تسویهٔ گروهی انجام شد (فقط فیش‌های واجد شرایط).');
  }

  function updateRate(id: number, newRate: number) {
    setProfs((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const gross = r.overloadUnits * newRate;
      const tax = gross * r.taxRate;
      return { ...r, baseRatePerUnit: newRate, grossAmount: gross, taxAmount: tax, totalDeductions: tax, netAmount: Math.max(0, gross - tax) };
    }));
  }

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-purple-900 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="text-lg font-black">🧪 شبیه‌ساز سناریوی حقوق و دستمزد</h1>
            <p className="mt-1 text-xs text-purple-200">دادهٔ نمونه صرفاً کلاینتی — هیچ چیزی در دیتابیس نوشته نمی‌شود</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="bg-white text-slate-900 hover:bg-white/90" onClick={recalcAll}>محاسبهٔ دوباره</Button>
            <Button size="sm" variant="outline" className="border-white/25 bg-white/10 text-white" onClick={batchSettle}>تسویهٔ گروهی</Button>
          </div>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs font-bold">{msg}</div> : null}

      <Card>
        <CardContent className="overflow-x-auto pt-4">
          <table className="w-full border-collapse text-right text-[11px]">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>{['استاد', 'نرخ پایه (ریال/واحد)', 'واحد اضافه‌تدریس', 'ناخالص', 'مالیات', 'خالص', 'وضعیت', 'شرط‌ها', ''].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr>
            </thead>
            <tbody>
              {profs.map((r) => (
                <tr key={r.id} className="border-t border-border/50">
                  <td className="p-2"><b>{r.name}</b> <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{r.staffCode}</span></td>
                  <td className="p-2"><Input type="number" value={r.baseRatePerUnit} onChange={(e) => updateRate(r.id, Number(e.target.value) || 0)} className="h-6 w-28 text-center font-mono text-[10px]" dir="ltr" /></td>
                  <td className="p-2 font-mono">{faNumber(r.overloadUnits)}</td>
                  <td className="p-2 font-mono font-bold">{faNumber(Math.round(r.grossAmount))}</td>
                  <td className="p-2 font-mono text-rose-700 dark:text-rose-300">{faNumber(Math.round(r.taxAmount))}</td>
                  <td className="p-2 font-mono font-black text-emerald-700 dark:text-emerald-300">{faNumber(Math.round(r.netAmount))}</td>
                  <td className="p-2"><Badge variant={r.status === 'FINANCE_SETTLED' ? 'success' : r.status === 'DRAFT' ? 'secondary' : 'warning'} className="text-[9px]">{STATUS_FA_SIM[r.status]}</Badge></td>
                  <td className="p-2 text-[10px]">{r.gradesFinalized ? '✅ نمرات' : '⛔ نمرات'} {r.contractSigned ? '✅ قرارداد' : '⛔ قرارداد'}</td>
                  <td className="p-2">{r.status !== 'FINANCE_SETTLED' ? <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => approveStage(r.id)}>ارتقا</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

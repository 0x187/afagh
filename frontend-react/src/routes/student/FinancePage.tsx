import { useQuery } from '@tanstack/react-query';
import { Banknote, CreditCard, Landmark, Printer, ReceiptText, ScanLine, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, faRial } from '@/lib/fa';
import { getFinance, type FinanceTerm } from '@/lib/student-api';

// ═══ امور مالی دانشجو — پورت student/finance ═══

const EVENT_KIND: Record<string, string> = {
  CHARGE: 'بدهی',
  DISCOUNT: 'تخفیف',
  SPONSOR: 'پوشش بنیاد',
  PAYMENT: 'پرداخت',
  CHEQUE: 'چک',
  LOAN: 'وام',
};

function TermBlock({ term }: { term: FinanceTerm }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-100 px-3 py-2 dark:bg-slate-800">
        <p className="text-xs font-black">
          {term.termTitle || 'بدون ترم'}
          {term.termCode ? <span className="ms-2 font-mono text-[10px] text-slate-500" dir="ltr">({term.termCode})</span> : null}
        </p>
        <span className={`text-xs font-black ${term.balance > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
          مانده: {faRial(term.balance)}
        </span>
      </div>
      <table className="w-full border-collapse text-right text-[11px]">
        <thead>
          <tr className="border-b border-slate-300 bg-slate-50 font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
            <th className="p-1.5">شرح</th>
            <th className="w-24 p-1.5 text-center">نوع</th>
            <th className="w-32 p-1.5 text-left">مبلغ</th>
          </tr>
        </thead>
        <tbody>
          {term.events.length === 0 ? (
            <tr><td colSpan={3} className="p-3 text-center text-slate-400">رویدادی ثبت نشده است.</td></tr>
          ) : (
            term.events.map((e, i) => (
              <tr key={i} className="border-b border-slate-200 last:border-0 dark:border-slate-800">
                <td className="p-1.5 font-medium">{e.label}</td>
                <td className="p-1.5 text-center text-slate-500">{EVENT_KIND[e.kind] ?? e.kind}</td>
                <td className={`p-1.5 text-left font-mono font-bold ${e.sign > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                  {e.sign > 0 ? '+' : '−'}{faNumber(e.amount)}
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-300 bg-slate-50 text-[10px] font-bold dark:border-slate-700 dark:bg-slate-800/60">
            <td className="p-1.5" colSpan={2}>بدهی / تخفیف / پرداخت</td>
            <td className="p-1.5 text-left font-mono" dir="ltr">
              {faNumber(term.charges)} / {faNumber(term.discounts + term.sponsorships)} / {faNumber(term.payments)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function StudentFinancePage() {
  const [params, setParams] = useSearchParams();
  const record = params.get('record') ? Number(params.get('record')) : null;
  const [printing, setPrinting] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-finance', record],
    queryFn: () => getFinance({ record }),
    staleTime: 30_000,
  });

  function doPrint() {
    setPrinting(true);
    window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 60);
  }

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-[60vh] w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت اطلاعات مالی ناموفق بود.</CardContent></Card>;
  }

  const t = data.totals;

  return (
    <div className="space-y-4">
      {data.records.length > 1 ? (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 text-xs shadow-xs">
          <span className="font-bold text-muted-foreground">پروندهٔ مالی (مقطع):</span>
          {data.records.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('record', String(r.id));
                setParams(next, { replace: true });
              }}
              className={`rounded-lg border px-2.5 py-1 font-bold transition ${
                r.id === data.activeRecordId ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {r.degreeTitle ?? 'مقطع نامشخص'} · <span className="font-mono" dir="ltr">{faDigits(r.studentCode)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            <ReceiptText className="size-4.5" aria-hidden />
          </span>
          <div>
            <h1 className="text-sm font-bold">امور مالی من</h1>
            <p className="text-[11px] text-muted-foreground">کارنامهٔ مالی ترم‌به‌ترم، چک‌ها و وام‌ها</p>
          </div>
        </div>
        <Button size="sm" onClick={doPrint} disabled={printing}>
          <Printer className="size-4" aria-hidden /> چاپ کارنامهٔ مالی
        </Button>
      </div>

      {data.dueSoon.length > 0 ? (
        <div className="no-print rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/50">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-100">
            <TriangleAlert className="size-4" aria-hidden /> چک در شرف سررسید
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-900 dark:text-amber-100">
            {data.dueSoon.map((c) => (
              <li key={c.id}>
                چک شمارهٔ {faDigits(c.chequeNo || '—')}{c.bankName ? ` بانک ${c.bankName}` : ''} به مبلغ {faRial(c.amount)} —{' '}
                {c.overdue ? (
                  <b className="text-rose-700 dark:text-rose-300">از سررسید گذشته است</b>
                ) : c.daysLeft === 0 ? (
                  <b>امروز سررسید می‌شود</b>
                ) : (
                  <span>{faNumber(c.daysLeft ?? 0)} روز تا سررسید</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-amber-800 dark:text-amber-200">لطفاً پیش از سررسید نسبت به تأمین موجودی اقدام کنید تا چک برگشت نخورد.</p>
        </div>
      ) : null}

      {data.notifications.length > 0 ? (
        <Card className="no-print">
          <CardContent className="space-y-1.5 p-4">
            <h2 className="border-b border-border/60 pb-2 text-sm font-bold">پیام‌های مالی</h2>
            {data.notifications.map((n) => (
              <p key={n.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>{n.text || n.event}</span>
                <span className="text-[10px] text-muted-foreground">
                  {n.dateMs ? faDigits(new Date(n.dateMs).toLocaleDateString('fa-IR')) : '—'}
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="print-area space-y-4 rounded-xl border-2 border-slate-800 bg-white p-4 text-slate-900 dark:border-slate-600">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-slate-800 pb-3">
          <div>
            <p className="text-[11px] text-slate-500">{data.university.title} — سامانهٔ جامع آموزشی</p>
            <h2 className="text-base font-black">کارنامهٔ مالی دانشجو</h2>
            <p className="mt-0.5 text-[11px] text-slate-600">
              {data.student.fullName} · {faDigits(data.student.studentCode)} · {data.student.majorTitle ?? '—'} — {data.student.degreeTitle ?? '—'}
            </p>
            <p className="text-[10px] text-slate-500">تاریخ صدور: {faDigits(data.issuedAt)}</p>
          </div>
          {data.qr ? (
            <div className="size-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white" dangerouslySetInnerHTML={{ __html: data.qr.svg }} />
          ) : (
            <Landmark className="size-9 text-slate-300" aria-hidden />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {([
            ['مجموع بدهی', faRial(t.charges), 'text-rose-700'],
            ['تخفیف و پوشش', faRial(t.discounts + t.sponsorships), 'text-emerald-700'],
            ['پرداخت‌ها', faRial(t.payments + t.chequesCleared), 'text-emerald-700'],
            ['مانده', faRial(t.balance), t.balance > 0 ? 'text-rose-700' : 'text-emerald-700'],
          ] as [string, string, string][]).map(([k, v, cls]) => (
            <div key={k} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] font-bold text-slate-500">{k}</div>
              <div className={`mt-0.5 font-mono text-[12px] font-black ${cls}`}>{v}</div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {data.terms.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">رویداد مالی ثبت نشده است.</p>
          ) : (
            data.terms.map((term) => <TermBlock key={term.termId} term={term} />)
          )}
        </div>

        {data.cheques.length > 0 ? (
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-black"><Banknote className="size-3.5" aria-hidden /> چک‌ها</p>
            <table className="w-full border-collapse text-right text-[11px]">
              <thead>
                <tr className="border-y border-slate-300 bg-slate-50 font-bold dark:bg-slate-800/60">
                  <th className="p-1.5">شمارهٔ چک</th>
                  <th className="p-1.5">بانک</th>
                  <th className="p-1.5 text-left">مبلغ</th>
                  <th className="p-1.5 text-center">سررسید</th>
                  <th className="p-1.5 text-center">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {data.cheques.map((c) => (
                  <tr key={c.id} className="border-b border-slate-200 last:border-0">
                    <td className="p-1.5 font-mono">{faDigits(c.chequeNo ?? '—')}</td>
                    <td className="p-1.5">{c.bankName ?? '—'}</td>
                    <td className="p-1.5 text-left font-mono">{faNumber(c.amount)}</td>
                    <td className="p-1.5 text-center">{c.dueDate ? faDigits(c.dueDate.slice(0, 10)) : '—'}</td>
                    <td className="p-1.5 text-center">{c.status === 'PENDING' ? 'در جریان' : c.status === 'CLEARED' ? 'وصول‌شده' : 'برگشتی'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {data.loans.length > 0 ? (
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-black"><CreditCard className="size-3.5" aria-hidden /> وام‌ها</p>
            <table className="w-full border-collapse text-right text-[11px]">
              <thead>
                <tr className="border-y border-slate-300 bg-slate-50 font-bold dark:bg-slate-800/60">
                  <th className="p-1.5">محصول</th>
                  <th className="p-1.5 text-left">مبلغ</th>
                  <th className="p-1.5 text-center">اقساط</th>
                  <th className="p-1.5 text-center">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {data.loans.map((l) => (
                  <tr key={l.id} className="border-b border-slate-200 last:border-0">
                    <td className="p-1.5">{l.productTitle ?? l.lender ?? '—'}</td>
                    <td className="p-1.5 text-left font-mono">{faNumber(l.amount)}</td>
                    <td className="p-1.5 text-center">{l.installments ? faNumber(l.installments) : '—'}</td>
                    <td className="p-1.5 text-center">{l.status === 'ACTIVE' ? 'فعال' : l.status ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {data.qr ? (
          <div className="flex items-center gap-2 border-t border-slate-300 pt-2 text-[10px] text-slate-500">
            <ScanLine className="size-3" aria-hidden />
            استعلام برخط: <span dir="ltr" className="break-all font-mono">{data.qr.url}</span>
            <Badge variant="secondary" className="text-[9px]">اعتبار: {faDigits(data.qr.expiresAt.slice(0, 10))}</Badge>
          </div>
        ) : null}
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CreditCard, RefreshCw, Send } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getPosTerminals, getPosTransactions, recordPosSale, voidPosTransaction } from '@/lib/admin-api';

// ═══ مدیریت ترمینال‌های POS — پورت admin/finance/pos ═══

const ENTRY_FA: Record<string, string> = {
  CHIP: 'چیپ', CONTACTLESS: 'بی‌تماس', MAGSTRIPE: 'نوار مغناطیسی', FALLBACK: 'فالبک', MANUAL: 'دستی',
};
const TXN_FA: Record<string, string> = { SALE: 'فروش', REFUND: 'برگشت', VOID: 'ویدی', SETTLEMENT: 'تسویه' };
const STATUS_FA: Record<string, string> = {
  APPROVED: 'تأییدشده', PENDING: 'در انتظار راستی‌آزمایی', VOIDED: 'ویدشده', FAILED: 'ناموفق',
};

export function AdminPosPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const { data: terminals, isLoading: tLoading } = useQuery({ queryKey: ['pos-terminals'], queryFn: getPosTerminals, staleTime: 20_000 });
  const { data: txns, isLoading: xLoading } = useQuery({ queryKey: ['pos-transactions'], queryFn: () => getPosTransactions({ limit: 50 }), staleTime: 10_000 });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['pos-transactions'] });
  };

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-base font-black"><CreditCard className="size-5" aria-hidden /> ترمینال‌های POS (پرداخت حضوری)</h1>
            <p className="mt-0.5 text-xs text-emerald-100">ثبت پرداخت کارت‌خوان فیزیکی، ویدی تراکنش، گزارش روزانه — پرداخت تا راستی‌آزمایی بانکی PENDING می‌ماند.</p>
          </div>
          <Button size="sm" className="bg-white/15 text-white hover:bg-white/25" onClick={refresh}><RefreshCw className="size-4" aria-hidden /> بازخوانی</Button>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      {tLoading ? <Skeleton className="h-40 w-full" /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(terminals ?? []).length === 0 ? (
            <Card className="md:col-span-2 xl:col-span-3">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                هیچ ترمینال POS فعالی تعریف نشده — از تعاریف مالی یا مدیریت درگاه‌ها ترمینال اضافه کنید.
              </CardContent>
            </Card>
          ) : (terminals ?? []).map((t) => (
            <PosTerminalCard key={t.id} terminal={t} onMsg={setMsg} onDone={refresh} />
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">آخرین تراکنش‌های POS</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {xLoading ? <Skeleton className="h-32 w-full" /> : (
            <table className="w-full border-collapse text-right text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                  <th className="p-2">STAN</th><th className="p-2">RRN</th><th className="p-2">مبلغ</th>
                  <th className="p-2">نوع</th><th className="p-2">روش کارت</th><th className="p-2">وضعیت</th>
                  <th className="p-2">ترمینال</th><th className="p-2">دانشجو</th><th className="p-2">زمان</th><th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {(txns ?? []).length === 0 ? (
                  <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">تراکنشی ثبت نشده است.</td></tr>
                ) : (txns ?? []).map((tx) => (
                  <PosTxnRow key={tx.id} tx={tx} onMsg={setMsg} onDone={refresh} />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PosTerminalCard({ terminal, onMsg, onDone }: {
  terminal: { code: string; title: string; location: string | null; terminalId: string | null };
  onMsg: (m: string) => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    studentCode: '', amount: '', stan: '', rrn: '', authorizationRef: '', entryMode: 'CHIP', cardPan: '', cardholderName: '',
  });
  const saleMut = useMutation({
    mutationFn: () => recordPosSale({
      terminalCode: terminal.code,
      studentCode: form.studentCode,
      amount: Number(form.amount),
      stan: form.stan,
      rrn: form.rrn || undefined,
      authorizationRef: form.authorizationRef,
      entryMode: form.entryMode,
      cardPan: form.cardPan,
      cardholderName: form.cardholderName || undefined,
    }),
    onSuccess: () => {
      onMsg(`تراکنش ${form.stan} به‌صورت PENDING ثبت شد (در انتظار راستی‌آزمایی بانکی).`);
      setForm({ ...form, stan: '', rrn: '', authorizationRef: '', amount: '', cardPan: '' });
      onDone();
    },
    onError: (e: Error) => onMsg(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{terminal.title}</span>
          <Badge variant="outline" className="font-mono text-[10px]" dir="ltr">{terminal.code}</Badge>
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">{terminal.location ?? '—'} {terminal.terminalId ? `· ترمینال ${terminal.terminalId}` : ''}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div><Label>شمارهٔ دانشجویی</Label><Input value={form.studentCode} onChange={(e) => setForm({ ...form, studentCode: e.target.value })} className="mt-1 h-8" dir="ltr" placeholder="31412001" /></div>
          <div><Label>مبلغ (ریال)</Label><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label>STAN</Label><Input value={form.stan} onChange={(e) => setForm({ ...form, stan: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label>RRN</Label><Input value={form.rrn} onChange={(e) => setForm({ ...form, rrn: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" placeholder="اختیاری" /></div>
          <div className="col-span-2"><Label>شناسهٔ مجوز بانکی (۶ تا ۴۰ نویسه)</Label><Input value={form.authorizationRef} onChange={(e) => setForm({ ...form, authorizationRef: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label>روش کارت</Label>
            <select value={form.entryMode} onChange={(e) => setForm({ ...form, entryMode: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2">
              {Object.entries(ENTRY_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><Label>شمارهٔ کارت</Label><Input value={form.cardPan} onChange={(e) => setForm({ ...form, cardPan: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" placeholder="6037…" /></div>
          <div className="col-span-2"><Label>نام دارنده</Label><Input value={form.cardholderName} onChange={(e) => setForm({ ...form, cardholderName: e.target.value })} className="mt-1 h-8" /></div>
        </div>
        <Button size="sm" className="w-full" disabled={saleMut.isPending || !form.studentCode || !form.amount || !form.stan || !form.authorizationRef || !form.cardPan} onClick={() => saleMut.mutate()}>
          <Send className="size-4" aria-hidden /> ثبت پرداخت (PENDING)
        </Button>
      </CardContent>
    </Card>
  );
}

function PosTxnRow({ tx, onMsg, onDone }: {
  tx: {
    id: number; stan: string; rrn: string | null; amount: number; txnType: string; entryMode: string; status: string;
    terminalCode: string; terminalTitle: string; studentCode: string; studentName: string; createdAt: string | null; cardPan: string | null;
  };
  onMsg: (m: string) => void;
  onDone: () => void;
}) {
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const voidMut = useMutation({
    mutationFn: () => voidPosTransaction(tx.terminalCode, tx.stan, reason),
    onSuccess: () => { setVoiding(false); setReason(''); onMsg(`تراکنش ${tx.stan} وید شد و برگشتی دفتر مالی ثبت گردید.`); onDone(); },
    onError: (e: Error) => onMsg(e.message),
  });
  return (
    <>
      <tr className="border-b border-border/40 last:border-0">
        <td className="p-2 font-mono text-[10px]" dir="ltr">{tx.stan}</td>
        <td className="p-2 font-mono text-[10px]" dir="ltr">{tx.rrn ?? '—'}</td>
        <td className="p-2 font-mono font-bold">{faNumber(tx.amount)}</td>
        <td className="p-2">
          <Badge className={tx.txnType === 'SALE' ? 'border-transparent bg-emerald-100 text-emerald-800' : tx.txnType === 'VOID' ? 'border-transparent bg-rose-100 text-rose-800' : 'border-transparent bg-amber-100 text-amber-800'}>
            {TXN_FA[tx.txnType] ?? tx.txnType}
          </Badge>
        </td>
        <td className="p-2">{ENTRY_FA[tx.entryMode] ?? tx.entryMode}</td>
        <td className="p-2">
          <Badge className={tx.status === 'APPROVED' ? 'border-transparent bg-emerald-100 text-emerald-800' : tx.status === 'PENDING' ? 'border-transparent bg-amber-100 text-amber-800' : 'border-transparent bg-muted text-muted-foreground'}>
            {STATUS_FA[tx.status] ?? tx.status}
          </Badge>
        </td>
        <td className="p-2">{tx.terminalTitle} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{tx.terminalCode}</span></td>
        <td className="p-2">{tx.studentName} <span className="font-mono text-[10px]" dir="ltr">{faDigits(tx.studentCode)}</span></td>
        <td className="p-2 font-mono text-[10px]" dir="ltr">{tx.createdAt ? faDigits(tx.createdAt.slice(0, 16)) : '—'}</td>
        <td className="p-2">
          {tx.status === 'APPROVED' && tx.txnType === 'SALE' ? (
            <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px] text-rose-700" onClick={() => setVoiding(true)}>
              <Ban className="size-3" aria-hidden /> ویدی
            </Button>
          ) : null}
        </td>
      </tr>
      {voiding ? (
        <tr className="border-b border-border/40 bg-rose-50/40 dark:bg-rose-950/20">
          <td colSpan={10} className="p-2">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="font-bold text-rose-800 dark:text-rose-300">ویدی {tx.stan} —</span>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="دلیل ویدی (الزامی)" className="h-7 min-w-56 flex-1" />
              <Button size="sm" className="h-7 bg-rose-700 text-[11px] text-white hover:bg-rose-800" disabled={voidMut.isPending || !reason} onClick={() => voidMut.mutate()}>ثبت ویدی</Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => { setVoiding(false); setReason(''); }}>انصراف</Button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

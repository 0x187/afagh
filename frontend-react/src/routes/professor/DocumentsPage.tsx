import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits } from '@/lib/fa';
import {
  getProfessorDocument,
  getProfessorDocuments,
  sendDocumentOTP,
  signDocument,
} from '@/lib/professor-api';

// ═══ اسناد الکترونیک استاد — پورت professor/documents ═══

function faDate(v: string | null): string {
  if (!v) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
  } catch {
    return faDigits(v.slice(0, 10));
  }
}

function DocumentDetail({ id }: { id: number }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['professor-document', id], queryFn: () => getProfessorDocument(id) });
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const otpMut = useMutation({
    mutationFn: () => sendDocumentOTP(id),
    onSuccess: (r) => {
      setDevOtp(r.devOtp ?? null);
      setMsg('کد تأیید صادر شد.');
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const signMut = useMutation({
    mutationFn: () => signDocument(id, otp),
    onSuccess: async () => {
      setMsg('سند امضا شد.');
      setOtp('');
      setDevOtp(null);
      await qc.invalidateQueries({ queryKey: ['professor-document', id] });
      await qc.invalidateQueries({ queryKey: ['professor-documents'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading || !data) return <Skeleton className="h-40 w-full" />;
  const d = data.document;
  const snapshot = data.snapshot as Record<string, unknown>;
  const entries = Object.entries(snapshot).filter(([, v]) => v == null || typeof v !== 'object');

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black">{d.title}</h2>
          <Badge className={d.signatureStatus === 'SIGNED' ? 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100'}>
            {d.signatureStatus === 'SIGNED' ? 'امضا شده' : 'در انتظار امضا'}
          </Badge>
        </div>
        <div className="grid gap-1 sm:grid-cols-2">
          {entries.slice(0, 24).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-2 py-1 text-[11px]">
              <span className="text-muted-foreground">{k}</span>
              <b className="truncate font-mono" dir="ltr">{String(v ?? '—')}</b>
            </div>
          ))}
        </div>
        {d.documentHash ? <p className="break-all text-[10px] text-muted-foreground">هش: <span className="font-mono" dir="ltr">{d.documentHash}</span></p> : null}
        {d.signatureStatus !== 'SIGNED' ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
            <Button size="sm" variant="outline" onClick={() => otpMut.mutate()} disabled={otpMut.isPending}>دریافت کد تأیید</Button>
            <Input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="کد ۶ رقمی" className="h-8 max-w-36 text-center font-mono" inputMode="numeric" />
            <Button size="sm" onClick={() => signMut.mutate()} disabled={signMut.isPending || otp.trim().length < 4}>ثبت امضا</Button>
            {devOtp ? <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">کد توسعه: <b className="font-mono" dir="ltr">{devOtp}</b></span> : null}
          </div>
        ) : null}
        {msg ? <p className="text-[11px] text-muted-foreground">{msg}</p> : null}
      </CardContent>
    </Card>
  );
}

export function ProfessorDocumentsPage() {
  const [selected, setSelected] = useState<number | null>(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ['professor-documents'], queryFn: getProfessorDocuments, staleTime: 30_000 });

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت اسناد ناموفق بود.</CardContent></Card>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 shadow-xs">
        <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          <FileText className="size-4.5" aria-hidden />
        </span>
        <div>
          <h1 className="text-sm font-bold">اسناد الکترونیک من</h1>
          <p className="text-[11px] text-muted-foreground">قراردادها و احکام با امضای الکترونیک و هش دیجیتال</p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          {data.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">سندی برای شما ثبت نشده است.</CardContent></Card>
          ) : (
            data.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelected(d.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border p-3 text-right shadow-xs transition ${selected === d.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40'}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {d.signatureStatus === 'SIGNED' ? (
                    <ShieldCheck className="size-4 shrink-0 text-emerald-600" aria-hidden />
                  ) : (
                    <ShieldQuestion className="size-4 shrink-0 text-amber-500" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold">{d.title}</p>
                    <p className="text-[10px] text-muted-foreground">ایجاد: {faDate(d.createdAt)}{d.signedAt ? ` · امضا: ${faDate(d.signedAt)}` : ''}</p>
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">{d.docType}</Badge>
              </button>
            ))
          )}
        </div>
        <div>{selected ? <DocumentDetail id={selected} /> : null}</div>
      </div>
    </div>
  );
}

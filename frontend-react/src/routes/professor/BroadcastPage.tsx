import { useMutation, useQuery } from '@tanstack/react-query';
import { MessageSquareText, Send } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  getBroadcast,
  previewBroadcast,
  sendBroadcast,
  type BroadcastReport,
} from '@/lib/professor-api';

// ═══ پیام به کلاس — پورت professor/broadcast ═══

const CHANNELS = [
  { key: 'INAPP', label: '📥 داخل پورتال' },
  { key: 'SOROUSH', label: '🟣 سروش' },
  { key: 'BALE', label: '🟢 بله' },
  { key: 'EITAA', label: '🟠 ایتا' },
];

export function ProfessorBroadcastPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['professor-broadcast'], queryFn: getBroadcast, staleTime: 30_000 });
  const [offeringId, setOfferingId] = useState('');
  const [channels, setChannels] = useState<string[]>(['INAPP']);
  const [text, setText] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [report, setReport] = useState<BroadcastReport | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!offeringId && data?.classes[0]) setOfferingId(String(data.classes[0].offeringId));
  }, [data, offeringId]);

  const previewMut = useMutation({
    mutationFn: () => previewBroadcast(Number(offeringId)),
    onSuccess: setCount,
    onError: (e: Error) => setMsg(e.message),
  });
  const sendMut = useMutation({
    mutationFn: () => sendBroadcast(Number(offeringId), channels, text),
    onSuccess: (r) => {
      setReport(r);
      setText('');
      setMsg(null);
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-56 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت کلاس‌ها ناموفق بود.</CardContent></Card>;
  }

  if (data.classes.length === 0) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">کلاسی برای ارسال پیام ندارید.</CardContent></Card>;
  }

  const selected = data.classes.find((c) => String(c.offeringId) === offeringId);

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-indigo-700 to-sky-600 text-white">
        <CardContent className="flex items-center gap-3 p-5">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15">
            <MessageSquareText className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-base font-black">پیام به دانشجویان کلاس</h1>
            <p className="mt-0.5 text-xs text-white/85">ارسال پیام درون‌سامانه‌ای و کانال‌های پیام‌رسان به دانشجویان فعال کلاس</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-bold" htmlFor="class">کلاس</label>
              <select
                id="class"
                value={offeringId}
                onChange={(e) => {
                  setOfferingId(e.target.value);
                  setCount(null);
                  setReport(null);
                }}
                className="mt-1 h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {data.classes.map((c) => (
                  <option key={c.offeringId} value={c.offeringId}>{c.label} — {c.termTitle} ({faNumber(c.enrolled)} نفر)</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <Button size="sm" variant="outline" onClick={() => previewMut.mutate()} disabled={previewMut.isPending || !offeringId}>
                پیش‌نمایش گیرندگان
              </Button>
              {count != null ? <Badge variant="secondary">{faNumber(count)} دانشجوی فعال</Badge> : null}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold">کانال‌های ارسال</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {CHANNELS.map((ch) => (
                <label key={ch.key} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${channels.includes(ch.key) ? 'border-primary bg-primary/10' : 'border-border'}`}>
                  <input
                    type="checkbox"
                    checked={channels.includes(ch.key)}
                    onChange={(e) => setChannels((prev) => (e.target.checked ? [...prev, ch.key] : prev.filter((x) => x !== ch.key)))}
                  />
                  {ch.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="body" className="text-xs font-bold">متن پیام</label>
            <textarea
              id="body"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="mt-1 min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring"
              placeholder="متن پیام (۳ تا ۲۰۰۰ نویسه)…"
            />
            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{faNumber(text.length)} / ۲۰۰۰</span>
              <BtnSend disabled={sendMut.isPending || text.trim().length < 3 || channels.length === 0} onClick={() => sendMut.mutate()} />
            </div>
          </div>

          {msg ? <p className="text-xs text-rose-700 dark:text-rose-300">{msg}</p> : null}

          {report ? (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
              <p className="font-black">✓ ارسال شد — {faNumber(report.total)} نفر:</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>📥 صندوق داخل پورتال: <b>{faNumber(report.inbox)} نفر</b></li>
                {report.sent.filter((s) => s.channel !== 'INAPP').map((s) => <li key={s.channel}>{s.channel}: {faNumber(s.n)} نفر</li>)}
                {report.failedRequests > 0 ? <li className="text-rose-700">خطا: {faNumber(report.failedRequests)} مورد</li> : null}
              </ul>
              {selected ? <p className="mt-1 text-[11px] text-emerald-800 dark:text-emerald-200">کلاس: {selected.label}</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {data.history.length > 0 ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">سابقهٔ پیام‌های ارسال‌شده</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.history.map((h) => (
              <div key={h.eventCode} className="rounded-xl border border-border bg-muted/30 p-2.5 text-[11px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">{h.body || '—'}</span>
                  <span className="text-muted-foreground">{h.sentAt ? faDigits(h.sentAt.slice(0, 16).replace('T', ' ')) : '—'} · {faNumber(h.total)} نفر</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function BtnSend({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Button size="sm" disabled={disabled} onClick={onClick}>
      <Send className="size-4" aria-hidden /> ارسال پیام
    </Button>
  );
}

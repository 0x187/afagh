import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, ExternalLink, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { faDigits, toEnDigits } from '@/lib/fa';
import {
  getConfirmationTerms,
  issueEnrollmentConfirmation,
  searchApprovalStudents,
  type ApprovalStudentHit,
} from '@/lib/enrollment-api';

// ═══ Issuing the enrollment confirmation (education expert) — port of admin/enrollment-confirmation ═══

function jdate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return '—';
  }
}

export function AdminEnrollmentConfirmationPage() {
  const [studentQ, setStudentQ] = useState('');
  const [hits, setHits] = useState<ApprovalStudentHit[]>([]);
  const [picked, setPicked] = useState<ApprovalStudentHit | null>(null);
  const [termId, setTermId] = useState<number | ''>('');
  const [result, setResult] = useState<{ verifyUrl: string; expiresAt: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: terms = [] } = useQuery({ queryKey: ['confirmation-terms'], queryFn: getConfirmationTerms, staleTime: 60_000 });

  useEffect(() => {
    if (!termId) {
      const cur = terms.find((t) => t.isCurrent === 1);
      if (cur) setTermId(cur.id);
    }
  }, [terms, termId]);

  useEffect(() => {
    if (picked) return;
    const q = studentQ.trim();
    if (q.length < 2) { setHits([]); return; }
    const t = setTimeout(() => { searchApprovalStudents(q).then(setHits).catch(() => setHits([])); }, 300);
    return () => clearTimeout(t);
  }, [studentQ, picked]);

  async function issue() {
    setMsg(null);
    setResult(null);
    if (!picked) { setMsg({ kind: 'err', text: 'دانشجو را از لیست جست‌وجو انتخاب کنید.' }); return; }
    if (!termId) { setMsg({ kind: 'err', text: 'نیمسال را انتخاب کنید.' }); return; }
    setBusy(true);
    try {
      const r = await issueEnrollmentConfirmation(picked.studentId, Number(termId));
      setResult({ verifyUrl: r.verifyUrl, expiresAt: r.expiresAt });
      setMsg({ kind: 'ok', text: 'تأییدیه صادر شد؛ با باز کردن پیوند، برگهٔ قابل چاپ نمایش داده می‌شود.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="border-0 bg-gradient-to-l from-emerald-800 via-teal-800 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black"><BadgeCheck className="size-5" aria-hidden /> تأییدیهٔ انتخاب واحد (کارشناس)</h1>
          <p className="mt-1 text-xs text-emerald-100">صدور برگهٔ تأییدیه با QR استعلام برخط برای هر دانشجو و نیمسال — کارشناس پیوند را باز کرده و چاپ می‌گیرد.</p>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="text-muted-foreground"><X className="size-3.5" aria-hidden /><span className="sr-only">بستن</span></button>
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">دانشجو</label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={picked ? `${picked.name} (${picked.studentCode})` : studentQ}
                onChange={(e) => { setStudentQ(toEnDigits(e.target.value)); setPicked(null); setResult(null); }}
                className="pr-9"
                placeholder="نام یا شماره دانشجو… (حداقل ۲ حرف)"
              />
            </div>
            {hits.length > 0 && !picked ? (
              <div className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {hits.map((h) => (
                  <button key={h.studentId} type="button" onClick={() => { setPicked(h); setHits([]); setStudentQ(h.name); }} className="w-full px-3 py-2 text-right text-sm hover:bg-accent">
                    {h.name} <span className="font-mono text-xs text-muted-foreground">{h.studentCode}</span>
                    {h.entryYear ? <span className="text-xs text-muted-foreground"> — ورود {faDigits(String(h.entryYear))}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>نیمسال</span>
            <select value={termId} onChange={(e) => setTermId(e.target.value ? Number(e.target.value) : '')} className="h-9 w-full rounded-lg border border-input bg-card px-2 text-sm">
              <option value="">— انتخاب نیمسال —</option>
              {terms.map((t) => <option key={t.id} value={t.id}>{t.title}{t.isCurrent === 1 ? ' (جاری)' : ''}</option>)}
            </select>
          </label>

          <Button className="w-full" disabled={busy} onClick={() => void issue()}>{busy ? 'در حال صدور…' : 'صدور تأییدیه'}</Button>
        </CardContent>
      </Card>

      {result ? (
        <Card className="border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30">
          <CardContent className="space-y-2 pt-4 text-sm">
            <p className="font-bold text-emerald-800 dark:text-emerald-200">تأییدیه صادر شد (معتبر تا {jdate(result.expiresAt)})</p>
            <Button asChild className="w-full">
              <a href={result.verifyUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" aria-hidden /> باز کردن برگهٔ قابل چاپ</a>
            </Button>
            <div className="break-all text-[11px] text-muted-foreground" dir="ltr">{result.verifyUrl}</div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

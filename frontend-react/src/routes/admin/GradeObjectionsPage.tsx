import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits } from '@/lib/fa';
import { getGradeObjections, reviewGradeObjection, type GradeObjectionRow } from '@/lib/admin-modules6-api';

// ═══ بررسی اعتراض به نمره — port of admin/grade-objections ═══

const STATUS_FA: Record<string, string> = {
  PENDING: 'در حال بررسی',
  REVIEWED: 'بررسی شد',
  ACCEPTED: 'پذیرفته شد',
  REJECTED: 'رد شد',
};

function StatusChip({ status }: { status: string }) {
  const cls =
    status === 'PENDING'
      ? 'bg-amber-100 text-amber-900'
      : status === 'ACCEPTED'
        ? 'bg-emerald-100 text-emerald-900'
        : status === 'REJECTED'
          ? 'bg-rose-100 text-rose-900'
          : 'bg-muted text-muted-foreground';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-black ${cls}`}>{STATUS_FA[status] ?? status}</span>;
}

export function GradeObjectionsPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const openQ = useQuery({ queryKey: ['grade-objections', 'PENDING'], queryFn: () => getGradeObjections('PENDING') });
  const historyQ = useQuery({ queryKey: ['grade-objections', 'OTHER'], queryFn: () => getGradeObjections('OTHER') });

  const open = openQ.data?.rows ?? [];
  const history = historyQ.data?.rows ?? [];

  const doReview = async (id: number, decision: 'ACCEPTED' | 'REJECTED') => {
    setMsg(null);
    setBusy(true);
    try {
      const r = await reviewGradeObjection(id, decision, note);
      if (!r.ok) {
        setMsg(r.error ?? 'خطا در ثبت بررسی.');
        return;
      }
      setReviewId(null);
      setNote('');
      setMsg(decision === 'ACCEPTED' ? 'اعتراض پذیرفته شد ✅' : 'اعتراض رد شد.');
      void qc.invalidateQueries({ queryKey: ['grade-objections'] });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-amber-900 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="text-base font-black">📨 اعتراض‌های دانشجویان به نمره</h1>
          <p className="mt-1 text-xs text-amber-100">
            صف بررسی و سوابق اعتراض‌های ثبت‌شده روی نمره‌ها.
          </p>
        </CardContent>
      </Card>

      {msg ? <Card><CardContent className="px-4 py-2.5 text-xs font-bold text-foreground">{msg}</CardContent></Card> : null}

      {/* ── Review queue ── */}
      <Card>
        <CardContent className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-black">
            صف بررسی
            <Badge variant="secondary">{faDigits(open.length)} باز</Badge>
          </h2>
          {openQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : open.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">اعتراض بازی نیست ✅</p>
          ) : (
            open.map((o) => <ObjectionCard key={o.id} o={o} reviewId={reviewId} setReviewId={setReviewId} note={note} setNote={setNote} busy={busy} doReview={doReview} />)
          )}
        </CardContent>
      </Card>

      {/* ── History ── */}
      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-sm font-black">سوابق بررسی‌ها</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  {['دانشجو', 'درس / ترم', 'متن اعتراض', 'وضعیت', 'یادداشت کارشناس'].map((h) => (
                    <th key={h} className="p-2 text-right font-black">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-border/50">
                    <td className="whitespace-nowrap p-2 font-bold">
                      {h.studentName}
                      <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{h.studentCode ?? ''}</div>
                    </td>
                    <td className="whitespace-nowrap p-2 text-muted-foreground">{h.courseTitle ?? '—'} · {h.termTitle ?? '—'}</td>
                    <td className="max-w-64 truncate p-2" title={h.requestText}>{h.requestText}</td>
                    <td className="p-2 text-center"><StatusChip status={h.status} /></td>
                    <td className="p-2 text-muted-foreground">{h.reviewerNote ?? '—'}</td>
                  </tr>
                ))}
                {history.length === 0 ? (
                  <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">سابقه‌ای ثبت نشده است.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ObjectionCard(props: {
  o: GradeObjectionRow;
  reviewId: number | null;
  setReviewId: (v: number | null) => void;
  note: string;
  setNote: (v: string) => void;
  busy: boolean;
  doReview: (id: number, decision: 'ACCEPTED' | 'REJECTED') => void;
}) {
  const { o, reviewId, setReviewId, note, setNote, busy, doReview } = props;
  const reviewing = reviewId === o.id;
  return (
    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <b className="text-foreground">{o.studentName}</b>
        <span className="font-mono text-muted-foreground" dir="ltr">{o.studentCode}</span>
        <span className="text-muted-foreground">· {o.termTitle ?? '—'}</span>
        <span className="text-muted-foreground">
          · {o.courseTitle ?? '—'}{' '}
          <span className="font-mono" dir="ltr">({o.courseCode ?? '—'})</span>
        </span>
        <span className="text-muted-foreground">· نمره {o.gradeAtObjection ?? '—'}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm">{o.requestText}</p>
      {reviewing ? (
        <div className="space-y-2 pt-1">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="یادداشت بررسی (الزامی، حداقل ۳ کاراکتر)…"
            rows={2}
            className="w-full rounded-xl border border-border bg-background px-2 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || note.trim().length < 3} onClick={() => doReview(o.id, 'ACCEPTED')}>
              پذیرفته شد
            </Button>
            <Button size="sm" variant="destructive" disabled={busy || note.trim().length < 3} onClick={() => doReview(o.id, 'REJECTED')}>
              وارد نیست (رد)
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setReviewId(null); setNote(''); }}>
              انصراف
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setReviewId(o.id)}>
          بررسی…
        </Button>
      )}
    </div>
  );
}

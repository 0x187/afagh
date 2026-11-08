import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toJalaliFromDate, faDigits } from '@/lib/calendar';
import {
  getGradesAudit,
  requestStepUp,
  reviewUnfinalize,
  type GradesAuditLogRow,
} from '@/lib/small-pages-api';

// ═══ /admin/grades/audit — port of grades/audit/page.tsx + UnfinalizeReviewClient.tsx ═══
// The global grade change log (audit trail) + the two-stage review of the
// unfinalize requests. The query string drives q (client-side filter, like the
// reference) and page.

const PAGE_SIZE = 50;

function faDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const { jy, jm, jd } = toJalaliFromDate(d);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return faDigits(`${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')} ${time}`);
}

function fa(n: number): string {
  return faDigits(Number(n || 0).toLocaleString('en-US'));
}

function nameOf(first?: string | null, last?: string | null, fallback?: string | null): string {
  const full = `${first ?? ''} ${last ?? ''}`.trim();
  return full || fallback || '—';
}

/** Review controls for one unfinalize request — port of UnfinalizeReviewClient. */
function UnfinalizeReviewClient({
  requestId,
  currentStage,
  canFinalApprove,
  onDone,
}: {
  requestId: number;
  currentStage: 'PENDING' | 'REVIEWED';
  canFinalApprove?: boolean;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [extendTo, setExtendTo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [needStepUp, setNeedStepUp] = useState(false);
  const [password, setPassword] = useState('');
  const [pendingRetry, setPendingRetry] = useState<null | { decision: 'REVIEWED' | 'APPROVED' | 'REJECTED' }>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (decision: 'REVIEWED' | 'APPROVED' | 'REJECTED') => {
    setBusy(decision);
    setError(null);
    try {
      const res = await reviewUnfinalize({
        requestId,
        decision,
        note: note.trim() || null,
        extendDeadlineTo: extendTo.trim() || null,
      });
      setDone(res.message || 'انجام شد.');
      onDone();
    } catch (e) {
      const text = e instanceof Error ? e.message : 'عملیات ناموفق بود.';
      if (text.startsWith('STEPUP_REQUIRED')) {
        setNeedStepUp(true);
        setPendingRetry({ decision });
        setError('برای ادامه، رمز عبور خود را تأیید کنید (تأیید دومرحله‌ای).');
        return;
      }
      setError(text);
    } finally {
      setBusy(null);
    }
  };

  const confirmStepUp = async () => {
    if (!password) {
      setError('رمز عبور را وارد کنید.');
      return;
    }
    setBusy('STEPUP');
    setError(null);
    try {
      const s = await requestStepUp('grades:edit', password);
      if (!s.ok) {
        setError('تأیید رمز ناموفق بود.');
        return;
      }
      setNeedStepUp(false);
      setPassword('');
      if (pendingRetry) {
        const d = pendingRetry.decision;
        setPendingRetry(null);
        await run(d);
      }
    } finally {
      setBusy(null);
    }
  };

  if (done) return <span className="text-2xs font-black text-emerald-700 dark:text-emerald-300">{done}</span>;

  return (
    <div className="space-y-2 min-w-[220px]">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="توضیح بررسی (اختیاری)"
        className="w-full bg-card border border-input rounded px-2 py-1 text-2xs"
      />
      {(currentStage === 'REVIEWED' || canFinalApprove) && (
        <input
          type="date"
          value={extendTo}
          onChange={(e) => setExtendTo(e.target.value)}
          title="تمدید مهلت اختصاصی ثبت نمره (اختیاری، نمایشی)"
          className="w-full bg-card border border-input rounded px-2 py-1 text-2xs"
        />
      )}
      {needStepUp && (
        <div className="flex gap-1">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="رمز عبور برای تأیید دومرحله‌ای"
            className="flex-1 bg-card border-2 border-amber-400 rounded px-2 py-1 text-2xs"
          />
          <button
            onClick={confirmStepUp}
            disabled={busy === 'STEPUP'}
            className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 text-2xs font-black rounded disabled:opacity-50"
          >
            تأیید رمز
          </button>
        </div>
      )}
      {error && <p className="text-3xs font-bold text-rose-600">{error}</p>}
      <div className="flex gap-1">
        {currentStage === 'PENDING' ? (
          <>
            <button
              onClick={() => run('REVIEWED')}
              disabled={!!busy}
              className="flex-1 px-2 py-1 bg-indigo-700 hover:bg-indigo-800 text-white text-2xs font-bold rounded disabled:opacity-50"
            >
              {busy === 'REVIEWED' ? '…' : 'تأیید مرحلهٔ اول'}
            </button>
            <button
              onClick={() => run('REJECTED')}
              disabled={!!busy}
              className="flex-1 px-2 py-1 bg-card border border-rose-300 text-rose-700 dark:text-rose-300 dark:border-rose-800 text-2xs font-bold rounded disabled:opacity-50"
            >
              {busy === 'REJECTED' ? '…' : 'رد'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => run('APPROVED')}
              disabled={!!busy}
              className="flex-1 px-2 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-2xs font-bold rounded disabled:opacity-50"
            >
              {busy === 'APPROVED' ? '…' : 'تأیید نهایی (معاون آموزشی)'}
            </button>
            <button
              onClick={() => run('REJECTED')}
              disabled={!!busy}
              className="flex-1 px-2 py-1 bg-card border border-rose-300 text-rose-700 dark:text-rose-300 dark:border-rose-800 text-2xs font-bold rounded disabled:opacity-50"
            >
              {busy === 'REJECTED' ? '…' : 'رد'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function LogRowCells({ r, index }: { r: GradesAuditLogRow; index: number }) {
  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-muted/40">
      <td className="p-2 font-mono text-muted-foreground">{fa(index + 1)}</td>
      <td className="p-2 font-mono" dir="ltr">{faDateTime(r.createdAt)}</td>
      <td className="p-2 font-mono">{r.studentCode ?? (r.studentId != null ? `#${r.studentId}` : '—')}</td>
      <td className="p-2">
        <span className="font-mono font-bold">{r.courseCode ?? '—'}</span>
        <span className="block text-3xs text-muted-foreground truncate max-w-[180px]">{r.courseTitle ?? '—'}</span>
      </td>
      <td className="p-2 font-mono">{r.termCode ?? '—'}</td>
      <td className="p-2"><span className="px-2 py-0.5 rounded font-mono text-3xs font-bold bg-muted">{r.action}</span></td>
      <td className="p-2 text-center font-mono">
        <span className="text-muted-foreground">{r.oldGradeValue ?? '—'}</span> <span className="opacity-50">←</span>{' '}
        <span className="text-indigo-700 dark:text-indigo-300 font-bold">{r.newGradeValue ?? '—'}</span>
      </td>
      <td className="p-2">
        <span className="font-bold">{nameOf(r.actorFirstName, r.actorLastName, r.actorUserId != null ? `#${r.actorUserId}` : '—')}</span>
        <span className="block text-3xs text-muted-foreground font-mono">[{r.actorRole ?? '—'}]</span>
      </td>
      <td className="p-2 max-w-xs truncate" title={r.reason ?? undefined}>{r.reason ?? '—'}</td>
    </tr>
  );
}

export function GradesAuditPage() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim();
  const page = Math.max(Number.parseInt(searchParams.get('page') ?? '1', 10) || 1, 1);
  const [filter, setFilter] = useState(q);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['grades-audit', page],
    queryFn: () => getGradesAudit(page),
  });
  const bundle = data?.data;
  const canFinalApprove = data?.canFinalApprove ?? false;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['grades-audit', page] });
  };

  const openUnfinalize = (bundle?.pending ?? []).filter((r) => r.status === 'PENDING' || r.status === 'REVIEWED');

  const filtered: GradesAuditLogRow[] = filterRows(bundle?.rows ?? [], q);
  const offset = (page - 1) * PAGE_SIZE;

  const goPage = (p: number) => {
    const sp = new URLSearchParams(searchParams);
    if (q) sp.set('q', q);
    else sp.delete('q');
    sp.set('page', String(p));
    setSearchParams(sp);
  };

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-sm font-black">📜 لاگ سراسری تغییرات نمرات (Audit Trail)</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to="/admin/students"><ArrowRight className="size-3.5" aria-hidden /> بازگشت به پرونده‌ها</Link>
          </Button>
        </div>
      </div>

      {/* ── Two-stage unfinalize review requests ── */}
      <Card className="border-amber-300 bg-amber-50/60 dark:bg-amber-950/30 dark:border-amber-800">
        <CardContent className="space-y-2 pt-4">
          <h2 className="font-black text-sm text-amber-900 dark:text-amber-200">
            🔓 درخواست‌های بازگشایی نمرات نهایی‌شده ({fa(openUnfinalize.length)})
          </h2>
          {openUnfinalize.length === 0 ? (
            <p className="text-2xs text-amber-800 dark:text-amber-300 font-bold">درخواست بازی وجود ندارد.</p>
          ) : (
            <div className="overflow-x-auto bg-card rounded-lg border border-amber-200 dark:border-amber-800">
              <table className="w-full text-right text-2xs">
                <thead className="bg-amber-100 dark:bg-amber-950/60 border-b border-amber-300 dark:border-amber-800 font-bold">
                  <tr>
                    <th className="p-2">#</th>
                    <th className="p-2">درس</th>
                    <th className="p-2">ترم</th>
                    <th className="p-2">استاد درخواست‌کننده</th>
                    <th className="p-2">دلیل</th>
                    <th className="p-2">تاریخ</th>
                    <th className="p-2">مرحله</th>
                    <th className="p-2">بررسی</th>
                  </tr>
                </thead>
                <tbody>
                  {openUnfinalize.map((r) => (
                    <tr key={r.id} className="border-b border-amber-100 dark:border-amber-900 hover:bg-amber-50 dark:hover:bg-amber-950/50">
                      <td className="p-2 font-mono text-muted-foreground">#{r.id}</td>
                      <td className="p-2">
                        <span className="font-mono font-bold">{r.courseCode ?? '—'}</span>
                        <span className="block text-3xs text-muted-foreground truncate max-w-[180px]">{r.courseTitle ?? `ارائهٔ ${r.offeringId}`}</span>
                      </td>
                      <td className="p-2 font-mono">{r.termCode ?? '—'}</td>
                      <td className="p-2 font-bold">{nameOf(r.requesterFirstName, r.requesterLastName)}</td>
                      <td className="p-2 max-w-xs truncate" title={r.reason}>{r.reason}</td>
                      <td className="p-2 font-mono" dir="ltr">{faDateTime(r.createdAt)}</td>
                      <td className="p-2">
                        {r.status === 'PENDING' ? (
                          <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-900 font-bold text-3xs">مرحلهٔ ۱ ⏳</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-indigo-200 text-indigo-900 font-bold text-3xs">در انتظار معاون آموزشی</span>
                        )}
                      </td>
                      <td className="p-2">
                        <UnfinalizeReviewClient
                          requestId={r.id}
                          currentStage={r.status as 'PENDING' | 'REVIEWED'}
                          canFinalApprove={canFinalApprove}
                          onDone={refresh}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const sp = new URLSearchParams(searchParams);
          if (filter.trim()) sp.set('q', filter.trim());
          else sp.delete('q');
          setSearchParams(sp);
        }}
      >
        <input
          name="q"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="جستجو: کد درس / عنوان درس / شماره دانشجویی / ترم"
          className="flex-1 max-w-md bg-card border border-input rounded px-3 py-1.5 text-xs"
        />
        <button type="submit" className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold rounded">
          جستجو
        </button>
        {q && (
          <Link to="/admin/grades/audit" className="px-3 py-1.5 bg-muted border border-input text-xs rounded">
            پاک‌سازی
          </Link>
        )}
      </form>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-2xs">
              <thead className="bg-muted/60 border-b border-border font-bold">
                <tr>
                  <th className="p-2">#</th>
                  <th className="p-2">تاریخ</th>
                  <th className="p-2">دانشجو</th>
                  <th className="p-2">درس</th>
                  <th className="p-2">ترم</th>
                  <th className="p-2">عملیات</th>
                  <th className="p-2 text-center">قبل → بعد</th>
                  <th className="p-2">اقدام‌کننده</th>
                  <th className="p-2">دلیل</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">لاگی یافت نشد.</td></tr>
                ) : (
                  filtered.map((r, i) => <LogRowCells key={r.id} r={r} index={offset + i} />)
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">صفحه {fa(page)}</span>
        <div className="flex gap-2">
          {page > 1 && (
            <Button size="sm" variant="outline" onClick={() => goPage(page - 1)}>‹ قبلی</Button>
          )}
          {bundle?.hasNext && (
            <Button size="sm" onClick={() => goPage(page + 1)}>بعدی ›</Button>
          )}
        </div>
      </div>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {isError && (
        <Card><CardContent className="py-6 text-center text-sm font-bold text-rose-700">دریافت لاگ ناکام بود.</CardContent></Card>
      )}
    </div>
  );
}

/** Same simple client-side filter as the reference (after fetch). */
function filterRows(rows: GradesAuditLogRow[], q: string): GradesAuditLogRow[] {
  if (!q) return rows;
  const needle = q.toLowerCase();
  return rows.filter((r) => {
    const hay = `${r.courseCode ?? ''} ${r.courseTitle ?? ''} ${r.studentCode ?? ''} ${r.termCode ?? ''}`.toLowerCase();
    return hay.includes(needle);
  });
}

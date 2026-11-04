'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import MobileCardList, { type CardColumn } from '@/components/MobileCardList';
import {
  loadConflictsAction,
  markConflictGroupReviewedAction,
  markOfferingsMergedAction,
  markOfferingsMergedBulkAction,
  undoConflictGroupAction,
} from './actions';
import {
  CONFLICT_REASON_CODES,
  CONFLICT_REASON_LABELS,
  minutesToHm,
  type ConflictGroup,
  type ConflictPair,
  type ConflictSlot,
} from '@/lib/schedule-conflicts-core';
import type { ScheduleConflictReport } from '@/lib/schedule-conflicts';

type Term = { id: number; termCode: string; title: string };

const fa = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString('fa-IR');

const KIND_BADGE: Record<ConflictPair['kind'] | 'MIXED', { label: string; cls: string }> = {
  PROFESSOR: { label: 'استاد', cls: 'bg-violet-700/30 text-violet-200 border-violet-500/40' },
  ROOM: { label: 'سالن', cls: 'bg-amber-700/30 text-amber-200 border-amber-500/40' },
  MIXED: { label: 'استاد+سالن', cls: 'bg-rose-700/30 text-rose-200 border-rose-500/40' },
};

/** یک درسِ درگیر در مسئله */
function SlotLine({ s }: { s: ConflictSlot }) {
  return (
    <div className="leading-5">
      <span className="font-mono text-2xs text-slate-500" dir="ltr">
        {s.courseCode}
      </span>{' '}
      <span className="text-[12px]">{s.courseTitle}</span>
      <span className="text-2xs text-slate-500">
        {' '}
        • گروه {fa(s.groupNumber)} • {fa(s.enrolledCount)} نفر
        {s.roomName ? ` • ${s.roomName}` : ''}
      </span>
    </div>
  );
}

export default function ScheduleConflictsClient({ terms }: { terms: Term[] }) {
  const [termId, setTermId] = useState<number | null>(terms[0]?.id ?? null);
  const [report, setReport] = useState<ScheduleConflictReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [kind, setKind] = useState<'ALL' | 'PROFESSOR' | 'ROOM'>('ALL');
  const [showReviewed, setShowReviewed] = useState(false);
  const [q, setQ] = useState('');
  const [busy, startTransition] = useTransition();

  const load = useCallback((tid: number) => {
    setError(null);
    setMsg(null);
    setLoading(true);
    startTransition(async () => {
      const res = await loadConflictsAction(tid);
      setLoading(false);
      if (res.ok) setReport(res.report);
      else setError(res.error);
    });
  }, []);

  useEffect(() => {
    if (termId) load(termId);
  }, [termId, load]);

  const visible = useMemo(() => {
    if (!report) return [] as ConflictGroup[];
    const src = report.groups.filter((g) => (showReviewed ? g.reviewed : !g.reviewed));
    const byKind = kind === 'ALL' ? src : src.filter((g) => g.kinds.includes(kind));
    const needle = q.trim().toLowerCase();
    if (!needle) return byKind;
    return byKind.filter((g) =>
      [
        g.entityName,
        g.dayName,
        ...g.slots.map((s) => `${s.courseCode} ${s.courseTitle} ${s.roomName ?? ''}`),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [report, kind, showReviewed, q]);

  const onMergeGroup = (g: ConflictGroup) => {
    if (!termId) return;
    const ids = g.slots.map((s) => s.offeringId);
    if (ids.length < 2) return;
    if (
      !window.confirm(
        `${ids.length} کلاس به‌عنوان یک جلسهٔ ادغامی ثبت شوند؟\n\n` +
          g.slots.map((s) => `• ${s.courseCode} ${s.courseTitle} (گروه ${s.groupNumber})`).join('\n') +
          `\n\nدر تقویم استاد با برچسب «کلاس ادغامی» نمایش داده می‌شوند و از این گزارش حذف می‌شوند.`,
      )
    )
      return;
    setMsg(null);
    startTransition(async () => {
      const res = await markOfferingsMergedAction(termId, ids);
      setMsg(res.ok ? res.message ?? 'ادغام شد.' : res.error);
      if (res.ok) load(termId);
    });
  };

  const onAcceptGroup = (g: ConflictGroup, reasonCode: string) => {
    if (!termId) return;
    setMsg(null);
    startTransition(async () => {
      const res = await markConflictGroupReviewedAction({
        termId,
        reasonCode,
        items: g.pairs.map((p) => ({
          fingerprint: p.fingerprint,
          kind: p.kind,
          entityId: p.entityId,
          dayOfWeek: p.dayOfWeek,
          scheduleAId: p.a.scheduleId,
          scheduleBId: p.b.scheduleId,
        })),
      });
      setMsg(res.ok ? res.message ?? 'بررسی شد.' : res.error);
      if (res.ok) load(termId);
    });
  };

  const onMergeAllLikely = () => {
    if (!termId || !report) return;
    const targets = report.groups.filter((g) => !g.reviewed && g.likelyMerged && g.slots.length >= 2);
    if (!targets.length) return;
    const total = targets.reduce((n, g) => n + g.slots.length, 0);
    if (
      !window.confirm(
        `${targets.length} مسئله که «احتمالاً یک جلسه» هستند ادغام شوند؟ (${total} کلاس)\n\n` +
          `شرط: همان استاد، همان سالن، اختلافِ ساعت کمتر از ۲۰ دقیقه.\n` +
          `مواردی که سالن یا استادشان متفاوت است دست‌نخورده می‌مانند.`,
      )
    )
      return;
    setMsg(null);
    startTransition(async () => {
      const res = await markOfferingsMergedBulkAction(
        termId,
        targets.map((g) => g.slots.map((s) => s.offeringId)),
      );
      setMsg(res.ok ? res.message ?? 'ادغام شد.' : res.error);
      if (res.ok) load(termId);
    });
  };

  const onUndoGroup = (g: ConflictGroup) => {
    if (!termId) return;
    setMsg(null);
    startTransition(async () => {
      const res = await undoConflictGroupAction(termId, g.pairs.map((p) => p.fingerprint));
      setMsg(res.ok ? res.message ?? 'بازگشت.' : res.error);
      if (res.ok) load(termId);
    });
  };

  const reasonOf = (g: ConflictGroup) => {
    if (!report) return null;
    for (const p of g.pairs) {
      const r = report.reviewed[p.fingerprint];
      if (r) return r;
    }
    return null;
  };

  const groupActions = (g: ConflictGroup) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={() => onMergeGroup(g)}
        disabled={busy || g.slots.length < 2}
        className="rounded bg-violet-600 px-2 py-1 text-2xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
        title="همهٔ دروسِ این بازه به‌عنوان یک جلسهٔ ادغامی ثبت می‌شوند"
      >
        ادغام {g.slots.length > 2 ? `(${fa(g.slots.length)} درس)` : ''}
      </button>
      <select
        defaultValue=""
        onChange={(e) => e.target.value && onAcceptGroup(g, e.target.value)}
        className="rounded border px-1.5 py-1 text-2xs bg-white dark:bg-slate-800"
        title="پذیرش کلِ این مسئله با ذکر دلیل"
      >
        <option value="">پذیرش…</option>
        {CONFLICT_REASON_CODES.map((c) => (
          <option key={c} value={c}>
            {CONFLICT_REASON_LABELS[c] ?? c}
          </option>
        ))}
      </select>
      <Link prefetch={false}
        href="/admin/offering-editor"
        className="rounded border border-slate-400 px-2 py-1 text-2xs hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        اصلاح
      </Link>
    </div>
  );

  const columns: CardColumn<ConflictGroup>[] = [
    {
      key: 'entity',
      label: 'موجودیت',
      title: true,
      render: (g) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {g.entities.map((e) => (
            <span key={`${e.kind}:${e.id}`} className="flex items-center gap-1">
              <span className={`rounded-full border px-1.5 py-0.5 text-3xs ${KIND_BADGE[e.kind].cls}`}>
                {KIND_BADGE[e.kind].label}
              </span>
              <span>{e.name}</span>
            </span>
          ))}
        </span>
      ),
    },
    {
      key: 'when',
      label: 'زمان',
      subtitle: true,
      render: (g) => (
        <span className="font-mono text-2xs" dir="ltr">
          {g.dayName} {minutesToHm(g.windowFrom)}–{minutesToHm(g.windowTo)}
          {g.likelyMerged ? ' · احتمالاً یک جلسه' : ''}
        </span>
      ),
    },
    {
      key: 'slots',
      label: 'دروس درگیر',
      render: (g) => (
        <div className="space-y-0.5">
          {g.slots.map((s) => (
            <SlotLine key={s.offeringId} s={s} />
          ))}
        </div>
      ),
    },
    { key: 'students', label: 'دانشجو', render: (g) => fa(g.students) },
  ];

  return (
    <div dir="rtl" className="space-y-4">
      {/* ── سربرگ ── */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">گزارش تداخل‌های واقعی برنامهٔ هفتگی</h1>
        <span className="text-xs text-slate-400">کارشناس آموزش — بررسی و رفع</span>
        <select
          value={termId ?? ''}
          onChange={(e) => setTermId(Number(e.target.value))}
          className="ms-auto rounded border px-2 py-1.5 text-sm bg-white dark:bg-slate-800"
          aria-label="ترم"
        >
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>

      {msg && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-2 text-sm text-emerald-200">{msg}</div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-2 text-sm text-rose-200">{error}</div>
      )}

      {/* ── آمار ── */}
      {report && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="مسئلهٔ باز" value={fa(report.openIssues)} tone="rose" />
          <Stat label="احتمالاً یک جلسه (یک‌کلیکی)" value={fa(report.likelyMergedIssues)} tone="amber" />
          <Stat label="جفتِ تداخلِ باز" value={fa(report.pairs.length - report.reviewedCount)} />
          <Stat label="ادغامی (حذف‌شده)" value={fa(report.mergedSkipped)} tone="ok" />
          <Stat
            label="استاد / سالن درگیر"
            value={`${fa(report.summary.professorEntities)} / ${fa(report.summary.roomEntities)}`}
          />
        </div>
      )}

      {/* ── اقدامِ گروهی برای مواردِ قطعی ── */}
      {report && report.likelyMergedIssues > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
          <span className="text-xs leading-6 text-amber-900">
            {fa(report.likelyMergedIssues)} مسئله «احتمالاً یک جلسه» است: همان استاد، همان سالن و اختلافِ ساعت
            کمتر از ۲۰ دقیقه. با یک کلیک همه ادغام می‌شوند؛ مواردی که استاد یا سالنشان متفاوت است دست‌نخورده
            می‌مانند.
          </span>
          <button
            onClick={onMergeAllLikely}
            disabled={busy}
            className="ms-auto rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50"
          >
            ادغام همهٔ مواردِ قطعی
          </button>
        </div>
      )}

      {/* ── فیلترها ── */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex rounded-lg border border-slate-300 dark:border-slate-700 p-0.5 text-xs">
            {(['ALL', 'PROFESSOR', 'ROOM'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded px-2.5 py-1 ${kind === k ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
              >
                {k === 'ALL' ? 'همه' : k === 'PROFESSOR' ? 'استاد' : 'سالن'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={showReviewed}
              onChange={(e) => setShowReviewed(e.target.checked)}
              className="size-4"
            />
            نمایش بررسی‌شده‌ها ({fa(report ? report.totalIssues - report.openIssues : 0)})
          </label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جست‌وجو درس / استاد / سالن…"
            className="ms-auto w-full rounded border px-2 py-1.5 text-sm bg-white dark:bg-slate-800 sm:w-64"
          />
        </div>
      </div>

      {loading && <div className="text-sm text-slate-500">در حال بارگذاری…</div>}

      {!loading && report && (
        <>
          {/* ── نمای دسکتاپ ── */}
          <div className="card hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs rt">
                <thead>
                  <tr className="text-slate-500">
                    <th className="p-2">موجودیتِ درگیر</th>
                    <th className="p-2">روز</th>
                    <th className="p-2">بازه</th>
                    <th className="p-2">دروس درگیر</th>
                    <th className="p-2">دانشجو</th>
                    <th className="p-2">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((g) => {
                    const rev = reasonOf(g);
                    return (
                      <tr key={g.key} className="border-t border-slate-100 dark:border-slate-700 align-top">
                        <td className="p-2 font-medium">
                          <div className="space-y-0.5">
                            {g.entities.map((e) => (
                              <div key={`${e.kind}:${e.id}`} className="flex items-center gap-1">
                                <span
                                  className={`rounded-full border px-1.5 py-0.5 text-3xs ${KIND_BADGE[e.kind].cls}`}
                                >
                                  {KIND_BADGE[e.kind].label}
                                </span>
                                <span>{e.name}</span>
                              </div>
                            ))}
                          </div>
                          {g.likelyMerged && (
                            <span
                              className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-3xs font-bold text-amber-800"
                              title="همان استاد، همان سالن و اختلافِ ساعت کمتر از ۲۰ دقیقه — به‌احتمالِ زیاد یک جلسه است"
                            >
                              احتمالاً یک جلسه
                            </span>
                          )}
                        </td>
                        <td className="p-2 whitespace-nowrap">{g.dayName}</td>
                        <td className="p-2 whitespace-nowrap font-mono" dir="ltr">
                          {minutesToHm(g.windowFrom)}–{minutesToHm(g.windowTo)}
                          <div className="text-3xs text-slate-400">
                            هم‌پوشانی {minutesToHm(g.overlapFrom)}–{minutesToHm(g.overlapTo)}
                          </div>
                        </td>
                        <td className="p-2">
                          <div className="space-y-0.5">
                            {g.slots.map((s) => (
                              <SlotLine key={s.offeringId} s={s} />
                            ))}
                          </div>
                          {g.slots.length > 2 && (
                            <div className="mt-1 text-3xs text-slate-400">
                              {fa(g.slots.length)} درس در یک بازه — یک مسئله، نه {fa(g.pairs.length)} مسئله.
                            </div>
                          )}
                        </td>
                        <td className="p-2 font-mono" dir="ltr">
                          {fa(g.students)}
                        </td>
                        <td className="p-2">
                          {rev ? (
                            <div className="space-y-1">
                              <span className="inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-3xs font-bold text-emerald-800">
                                {CONFLICT_REASON_LABELS[rev.reasonCode ?? 'OTHER'] ?? rev.reasonCode}
                              </span>
                              <div className="text-3xs text-slate-400">
                                {rev.reviewedByName ?? ''} {rev.reviewedAt ?? ''}
                              </div>
                              <button
                                onClick={() => onUndoGroup(g)}
                                disabled={busy}
                                className="rounded border px-2 py-0.5 text-3xs hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                بازگردانی
                              </button>
                            </div>
                          ) : (
                            groupActions(g)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-slate-400">
                        {showReviewed ? 'موردی بررسی‌شده یافت نشد.' : 'تداخلِ واقعیِ باز یافت نشد. 🎉'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── نمای موبایل ── */}
          <MobileCardList
            rows={visible}
            columns={columns}
            getKey={(g) => g.key}
            renderActions={(g) => (reasonOf(g) ? (
              <button
                onClick={() => onUndoGroup(g)}
                disabled={busy}
                className="rounded border px-3 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                بازگردانیِ بررسی
              </button>
            ) : (
              groupActions(g)
            ))}
          />
        </>
      )}

      <p className="text-2xs leading-6 text-slate-500">
        هر ردیف یک <b>مسئله</b> است، نه یک جفت: اگر استاد در یک بازه پنج درس داشته باشد، همه در یک ردیف
        فهرست می‌شوند. برچسبِ «احتمالاً یک جلسه» یعنی همان استاد، همان سالن و اختلافِ ساعت کمتر از ۲۰ دقیقه —
        با یک کلیک «ادغام» کلِ آن بازه یک جلسهٔ ادغامی می‌شود (چیزی خودکار پنهان نمی‌شود؛ تصمیم با شماست).
        {report ? (
          <>
            {' '}
            این ترم {fa(report.slotsScanned)} ردیف برنامه بررسی شد
            {report.duplicateSlots > 0 ? ` (${fa(report.duplicateSlots)} ردیفِ تکراری یک‌بار شمرده شد)` : ''}.
          </>
        ) : null}{' '}
        تداخلِ امتحانی و تداخلِ برنامهٔ دانشجویان در{' '}
        <Link prefetch={false} href="/admin/reports" className="text-indigo-600 underline">
          مرکز گزارش‌ها
        </Link>{' '}
        قابل مشاهده است.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'rose' | 'ok' | 'amber' }) {
  const cls =
    tone === 'rose'
      ? 'border-rose-200 bg-rose-50 text-rose-800'
      : tone === 'ok'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : tone === 'amber'
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-slate-200 bg-slate-50 text-slate-800';
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`}>
      <p className="text-3xs opacity-80">{label}</p>
      <p className="font-mono text-base font-bold" dir="ltr">{value}</p>
    </div>
  );
}

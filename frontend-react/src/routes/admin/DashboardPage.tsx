import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getAdminDashboard } from '@/lib/admin-api';
import { useSession } from '@/lib/session';
import { groupedModules } from './admin-modules';
import { MakeupInboxCard } from './MakeupInboxCard';
import PanelHero, { HeroStatsRow } from '@/components/PanelHero';

// ═══ Admin dashboard — line-by-line port of admin/page.tsx ═══
// Showcase hero (with the request-status stats row), the category grid, the
// live grade activity card, the Redis waiting-room status and the council
// inbox with sortable columns and the approve/reject actions.

const STATUS_FA: Record<string, string> = {
  SUBMITTED: 'ثبت‌شده', IN_REVIEW: 'در بررسی', APPROVED: 'تاییدشده', REJECTED: 'ردشده', RETURNED: 'بازگشتی', DRAFT: 'پیش‌نویس',
};

const STATUS_COLOR: Record<string, string> = {
  SUBMITTED: 'bg-amber-100 text-amber-800 border border-amber-300 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  IN_REVIEW: 'bg-sky-100 text-sky-800 border border-sky-300 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200',
  APPROVED: 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  REJECTED: 'bg-red-100 text-red-700 border border-red-300 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
  RETURNED: 'bg-purple-100 text-purple-800 border border-purple-300 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-200',
};

/** Sortable column header — click navigates with ?sort=col&dir=asc|desc. */
function InboxTh({
  label, col, sortKey, sortDir,
}: {
  label: string;
  col: string;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
}) {
  const [, setParams] = useSearchParams();
  const active = sortKey === col;
  const next = () => {
    if (sortKey !== col) setParams({ sort: col, dir: 'asc' });
    else if (sortDir === 'asc') setParams({ sort: col, dir: 'desc' });
    else setParams({});
  };
  return (
    <th className="p-2.5">
      <button
        type="button"
        onClick={next}
        title="مرتب‌سازی"
        className={`whitespace-nowrap font-bold hover:text-indigo-700 ${active ? 'text-indigo-700' : ''}`}
      >
        {label}{' '}
        <span className="inline-block w-4 text-center">
          {active ? (sortDir === 'asc' ? '▲' : '▼') : <span className="opacity-30">↕</span>}
        </span>
      </button>
    </th>
  );
}

/** Council decision buttons — port of RequestActionButtons (approve/reject). */
function RequestActionButtons({ requestId, status }: { requestId: number; status: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const decidable = ['SUBMITTED', 'IN_REVIEW', 'DRAFT'].includes(status);
  const decision = useMutation({
    mutationFn: async (action: 'APPROVE' | 'REJECT') => {
      const res = await fetch(`/api/v2/admin/requests/${requestId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      return res.json() as Promise<{ ok: boolean; error?: string }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
      setBusy(false);
    },
    onError: () => setBusy(false),
  });
  if (!decidable) {
    return <span className="text-[10px] text-slate-400">{STATUS_FA[status] ?? status} ✓</span>;
  }
  const run = (action: 'APPROVE' | 'REJECT') => {
    if (busy) return;
    if (action === 'REJECT' && !window.confirm('این درخواست رد شود؟')) return;
    setBusy(true);
    decision.mutate(action);
  };
  return (
    <div className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => run('APPROVE')}
        className="rounded-lg bg-emerald-600 px-2.5 py-1 text-2xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
      >
        تأیید
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => run('REJECT')}
        className="rounded-lg bg-rose-600 px-2.5 py-1 text-2xs font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
      >
        رد
      </button>
    </div>
  );
}

export function AdminDashboardPage() {
  const [params] = useSearchParams();
  const { data: session } = useSession();
  const roles = session?.user?.roles ?? [];
  const isEdu = roles.includes('ADMIN') || roles.includes('EDU_EXPERT');
  const sortKey = (params.get('sort') || '').trim() || null;
  const sortDir = params.get('dir') === 'desc' ? 'desc' : 'asc';

  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-dashboard'], queryFn: getAdminDashboard, staleTime: 20_000 });

  const groups = groupedModules(roles);
  const moduleCount = groups.reduce((s, g) => s + g.modules.length, 0);

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (isError || !data) {
    return <div className="card">دریافت داشبورد مدیریت ناموفق بود.</div>;
  }

  const counts = data.requestStatusCounts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || data.stats.requestsTotal;
  const inbox = data.inbox ?? [];

  return (
    <div className="space-y-5">
      {/* ═══ Showcase hero ═══ */}
      <PanelHero
        tone="indigo"
        icon="🧭"
        eyebrow="کارتابل مدیریت"
        title="داشبورد مدیریت جامع"
        subtitle={`${faNumber(moduleCount)} ماژول در دسترسِ نقش شما — برای ورود به هر حوزه، دستهٔ مربوط را انتخاب کنید.`}
        statsSlot={
          isEdu ? (
            <HeroStatsRow
              stats={[
                { label: 'کل درخواست‌ها', value: faNumber(total), tone: 'text-indigo-700', title: 'همهٔ درخواست‌های ثبت‌شدهٔ این دانشگاه' },
                ...(['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'] as const).map(k => ({
                  label: STATUS_FA[k],
                  value: faNumber(counts[k] ?? 0),
                  title: `درخواست‌های ${STATUS_FA[k]}`,
                })),
              ]}
            />
          ) : undefined
        }
      />

      {/* ═══ Category cards ═══ */}
      <section>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
          {groups.map(g => (
            <Link
              key={g.key}
              to={`/admin/c/${g.key}`}
              className="group relative flex h-full items-start gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg sm:p-4"
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-0.5 origin-right scale-x-0 bg-gradient-to-l from-indigo-500 via-violet-500 to-fuchsia-500 transition-transform duration-200 group-hover:scale-x-100"
              />
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-lg text-white shadow-sm transition-transform group-hover:scale-105">
                {g.emoji}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[12px] font-extrabold leading-tight text-slate-800 sm:text-sm">{g.title}</h3>
                <p className="mt-1 hidden text-[10px] leading-5 text-slate-500 sm:block">{g.desc}</p>
                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-black text-indigo-700">
                  {faNumber(g.modules.length)} ماژول
                  <span aria-hidden className="transition-transform group-hover:-translate-x-0.5">←</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {isEdu && (
        <>
          {/* Makeup class requests inbox (streamed separately in the reference) */}
          <MakeupInboxCard />

          {/* 🔴 Live grade activity */}
          <div className="card border-red-300">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <h2 className="text-sm font-extrabold text-slate-900">🔴 فعالیت زندهٔ نمرات</h2>
              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                {(data.gradeLive ?? []).length} تغییر در ۳۰ دقیقهٔ اخیر
              </span>
            </div>
            {(data.gradeLive ?? []).length === 0 ? (
              <p className="text-xs text-slate-400">در ۳۰ دقیقهٔ اخیر تغییری در نمرات ثبت نشده است.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {(data.gradeLive ?? []).map((g, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-2 border-b border-slate-100 pb-1.5">
                    <b>{g.actor}</b>
                    {g.actorRole ? <span className="text-slate-500">({g.actorRole})</span> : null}
                    <span>دانشجو <span className="font-mono" dir="ltr">{faDigits(g.studentCode ?? '—')}</span></span>
                    <span className="text-slate-600">{g.course}</span>
                    <span>→ <b className="font-mono">{faDigits(g.grade ?? '—')}</b></span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Redis waiting-room engine status */}
          <div className={'card flex flex-wrap items-center justify-between gap-3 ' + (data.queueLength >= 0 ? 'border-emerald-300' : 'border-red-300')}>
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                aria-hidden
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500"
                style={{ boxShadow: '0 0 0 4px rgba(16,185,129,.15)' }}
              />
              <div className="min-w-0">
                <h2 className="text-sm font-extrabold text-slate-900">اتاق انتظار Redis (§۶۹۰۶)</h2>
                <p className="mt-0.5 text-[11px] font-bold text-slate-500">
                  فعال — {faNumber(data.warmedOfferings)} کلاس گرم‌شده · صف ثبت نهایی: {faNumber(data.queueLength)} درخواست
                </p>
              </div>
            </div>
          </div>

          {/* Council inbox */}
          <div className="card !p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-extrabold text-slate-900">کارتابل رسیدگی به درخواست‌های دانشجویی</h2>
                <p className="mt-0.5 text-[11px] font-bold text-slate-500">شورای آموزشی · {faNumber(inbox.length)} پروندهٔ اخیر</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <InboxTh label="کد رهگیری" col="track" sortKey={sortKey} sortDir={sortDir} />
                    <InboxTh label="دانشجو" col="name" sortKey={sortKey} sortDir={sortDir} />
                    <InboxTh label="موضوع / درس" col="proc" sortKey={sortKey} sortDir={sortDir} />
                    <InboxTh label="وضعیت" col="status" sortKey={sortKey} sortDir={sortDir} />
                    <InboxTh label="زمان" col="created" sortKey={sortKey} sortDir={sortDir} />
                    <th className="p-2.5 text-left">اقدام شورا</th>
                  </tr>
                </thead>
                <tbody>
                  {inbox.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center">
                        <p className="text-2xl" aria-hidden>🗂️</p>
                        <p className="mt-1 text-xs font-bold text-slate-500">درخواستی در کارتابل موجود نیست.</p>
                        <p className="mt-0.5 text-[10px] font-bold text-slate-400">درخواست‌های تازه پس از ثبت دانشجو همین‌جا دیده می‌شوند.</p>
                      </td>
                    </tr>
                  )}
                  {inbox.map(r => (
                    <tr key={r.id} className="border-t border-slate-100 transition-colors hover:bg-slate-50/70">
                      <td className="p-2.5 font-mono text-xs font-bold text-slate-700" dir="ltr">{faDigits(r.trackingCode)}</td>
                      <td className="p-2.5">
                        <p className="font-semibold text-slate-800">{r.studentName}</p>
                        <p className="font-mono text-[10px] text-slate-400" dir="ltr">{faDigits(r.studentCode)}</p>
                      </td>
                      <td className="p-2.5">
                        <p className="text-xs font-medium text-slate-700">
                          {r.offeringTitle ? `اخذ درس ${r.offeringTitle}` : (r.processTitle || 'کمیسیون موارد خاص')}
                        </p>
                        {r.reasons && r.reasons.length > 0 ? (
                          <p className="mt-0.5 max-w-[200px] truncate text-[10px] text-amber-700" title={r.reasons.join('، ')}>
                            {r.reasons.join('، ')}
                          </p>
                        ) : null}
                      </td>
                      <td className="p-2.5">
                        <span className={'inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ' + (STATUS_COLOR[r.status] ?? '')}>
                          {STATUS_FA[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="p-2.5 text-xs text-slate-500">
                        {r.created ? new Date(r.created).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>
                      <td className="p-2.5 text-left">
                        <RequestActionButtons requestId={r.id} status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

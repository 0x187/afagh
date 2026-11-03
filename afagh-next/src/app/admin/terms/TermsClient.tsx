'use client';

import { useMemo, useState, useTransition } from 'react';
import { toJalaliFromDate } from '@/lib/calendar';
import MobileCardList, { type CardColumn } from '@/components/MobileCardList';
import {
  activateTermAction,
  bulkActivateTermsAction,
  syncTermsWithDateAction,
  type SyncResult,
} from './actions';

const HIDDEN_TERM_TYPES = ['EQUIVALENCE', 'SPECIAL'];

type Uni = { id: number; code: string; title: string };

type TermRow = {
  id: number;
  universityId: number | null;
  termCode: string;
  title: string;
  termType: string;
  academicYear: number | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  containsToday: boolean;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function jalaliOf(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const j = toJalaliFromDate(d);
  return `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`;
}

const TERM_TYPE_LABEL: Record<string, string> = {
  NORMAL: 'نیمسال',
  SUMMER: 'تابستان',
  EQUIVALENCE: 'معادل‌سازی',
  SPECIAL: 'ویژه',
};

const termColumns: CardColumn<TermRow>[] = [
  { key: 'title', label: 'عنوان', title: true },
  { key: 'termCode', label: 'کد', subtitle: true },
  { key: 'termType', label: 'نوع', render: (t) => TERM_TYPE_LABEL[t.termType] ?? t.termType },
  { key: 'startDate', label: 'شروع', render: (t) => jalaliOf(t.startDate) },
  { key: 'endDate', label: 'پایان', render: (t) => jalaliOf(t.endDate) },
  {
    key: 'isCurrent',
    label: 'پرچم فعال',
    bare: true,
    render: (t) =>
      t.isCurrent ? (
        <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-3xs">فعال</span>
      ) : (
        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-3xs">—</span>
      ),
  },
  {
    key: 'containsToday',
    label: 'امروز داخل این نیمسال است؟',
    bare: true,
    render: (t) =>
      t.containsToday ? (
        <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-3xs">بله</span>
      ) : (
        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-3xs">خیر</span>
      ),
  },
];

export default function TermsClient({
  today,
  universities,
  terms,
  activeCount,
  containingCount,
}: {
  today: string;
  universities: Uni[];
  terms: TermRow[];
  activeCount: number;
  containingCount: number;
}) {
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' | 'info' } | null>(null);
  const [syncReport, setSyncReport] = useState<SyncResult | null>(null);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<'single' | 'bulk' | 'sync' | null>(null);
  const [teachingOnly, setTeachingOnly] = useState(false);
  const [, startTransition] = useTransition();

  const visibleTerms = useMemo(
    () => (teachingOnly ? terms.filter((t) => !HIDDEN_TERM_TYPES.includes(t.termType)) : terms),
    [terms, teachingOnly],
  );
  const hiddenCount = terms.length - visibleTerms.length;

  const grouped = useMemo(() => {
    const map = new Map<number, TermRow[]>();
    for (const t of visibleTerms) {
      if (t.universityId == null) continue;
      const list = map.get(t.universityId) ?? [];
      list.push(t);
      map.set(t.universityId, list);
    }
    return map;
  }, [visibleTerms]);

  const orphanTerms = useMemo(() => visibleTerms.filter((t) => t.universityId == null), [visibleTerms]);

  const uniLabel = (id: number) => {
    const u = universities.find((x) => x.id === id);
    return u ? `${u.title} (${u.code})` : `دانشگاه ${id}`;
  };

  const bulkSelected = Object.entries(picks).filter(([, v]) => v !== '');

  function run(
    kind: 'single' | 'bulk' | 'sync',
    fn: () => Promise<{ ok: boolean; message?: string; error?: string }>,
  ) {
    setBusy(kind);
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) setMsg({ text: res.message ?? 'انجام شد', kind: 'ok' });
        else setMsg({ text: res.error ?? 'خطای نامشخص', kind: 'error' });
      } catch (e: any) {
        setMsg({ text: e?.message ?? 'خطای ارتباط با سرور', kind: 'error' });
      } finally {
        setBusy(null);
      }
    });
  }

  const msgClass =
    msg?.kind === 'ok'
      ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
      : msg?.kind === 'error'
        ? 'bg-rose-50 border border-rose-200 text-rose-800'
        : 'bg-amber-50 border border-amber-200 text-amber-800';

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h2 className="font-bold text-sm">نیمسال‌های فعال — همهٔ دانشگاه‌ها</h2>
        <p className="text-xs leading-6 text-slate-500">
          فهرست زیر همهٔ نیمسال‌های همهٔ دانشگاه‌ها را نشان می‌دهد (نه فقط دانشگاه جاری). ستون
          <b> «پرچم فعال»</b> مقدار <span className="font-mono">isCurrent</span> در پایگاه‌داده است و ستون
          <b> «امروز داخل این نیمسال است؟»</b> از روی بازهٔ <span className="font-mono">startDate</span> تا
          <span className="font-mono"> endDate</span> و تاریخ امروز ({jalaliOf(today)}) محاسبه می‌شود.
          قاعدهٔ سامانه: هر دانشگاه حداکثر یک نیمسال فعال دارد و با هر فعال‌سازی، پرچم بقیهٔ نیمسال‌های
          همان دانشگاه در یک تراکنش صفر می‌شود.
        </p>
        <label className="flex items-center gap-2 text-2xs text-slate-600">
          <input
            type="checkbox"
            checked={teachingOnly}
            onChange={(e) => {
              setTeachingOnly(e.target.checked);
              setPicks({});
            }}
            className="accent-slate-700"
          />
          فقط نیمسال‌های آموزشی
          <span className="text-slate-400">
            (معادل‌سازی و ویژه پنهان شوند — {hiddenCount.toLocaleString('fa-IR')} ردیف)
          </span>
        </label>
        <div className="flex flex-wrap gap-2 text-2xs">
          <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">
            کل نیمسال‌ها: <b className="tabular-nums">{terms.length.toLocaleString('fa-IR')}</b>
          </span>
          <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">
            نمایش‌داده‌شده: <b className="tabular-nums">{visibleTerms.length.toLocaleString('fa-IR')}</b>
          </span>
          <span className="px-2 py-1 rounded bg-indigo-100 text-indigo-800">
            پرچم فعال: <b className="tabular-nums">{activeCount.toLocaleString('fa-IR')}</b>
          </span>
          <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-800">
            شامل تاریخ امروز: <b className="tabular-nums">{containingCount.toLocaleString('fa-IR')}</b>
          </span>
        </div>
      </div>

      {msg && <div className={`text-xs p-2 rounded leading-6 ${msgClass}`}>{msg.text}</div>}

      <div className="card space-y-3">
        <h3 className="font-bold text-xs">همگام‌سازی با تاریخ</h3>
        <p className="text-2xs leading-6 text-slate-500">
          برای هر دانشگاه، نیمسالی که بازهٔ تاریخش امروز را در بر می‌گیرد فعال می‌شود و پرچم فعالِ
          نیمسال‌های دیگر همان دانشگاه صفر می‌گردد. نیمسال‌هایی که <span className="font-mono">startDate</span>
          خالی دارند هرگز فعال نمی‌شوند. اگر دانشگاهی نیمسالِ شامل امروز نداشته باشد، چیزی صفر
          نمی‌شود و همان دانشگاه صریحاً گزارش می‌شود. محاسبهٔ تاریخ کاملاً سمت سرور انجام می‌شود.
        </p>
        <button
          disabled={busy !== null}
          onClick={() => run('sync', async () => {
            const res = await syncTermsWithDateAction();
            setSyncReport(res);
            return res;
          })}
          className="bg-indigo-600 text-white px-4 py-1.5 rounded text-xs disabled:opacity-50"
        >
          {busy === 'sync' ? 'در حال همگام‌سازی…' : 'همگام‌سازی با تاریخ'}
        </button>

        {syncReport?.ok && (
          <div className="text-2xs leading-6 border border-slate-200 rounded p-2 space-y-2 bg-slate-50">
            <div>
              <b className="text-emerald-700">فعال‌شده ({syncReport.activated.length}):</b>{' '}
              {syncReport.activated.length
                ? syncReport.activated.map((a) => `${a.university} → ${a.termCode}`).join('، ')
                : 'موردی نبود'}
            </div>
            <div>
              <b className="text-slate-700">مطابق تاریخ از قبل ({syncReport.unchanged.length}):</b>{' '}
              {syncReport.unchanged.length
                ? syncReport.unchanged.map((a) => `${a.university} → ${a.termCode}`).join('، ')
                : 'موردی نبود'}
            </div>
            <div>
              <b className="text-rose-700">بدون نیمسال شامل امروز ({syncReport.noContaining.length}):</b>{' '}
              {syncReport.noContaining.length ? syncReport.noContaining.join(' | ') : 'موردی نبود'}
            </div>
            <div className="text-slate-600">پرچم فعالِ کهنهٔ صفرشده: {syncReport.cleared.toLocaleString('fa-IR')}</div>
          </div>
        )}
        {syncReport && !syncReport.ok && (
          <div className="text-2xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
            {syncReport.error}
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <h3 className="font-bold text-xs">فعال‌سازی گروهی برای چند دانشگاه</h3>
        <p className="text-2xs leading-6 text-slate-500">
          برای هر دانشگاه یک نیمسال انتخاب کنید و با یک ارسال، همه با هم فعال می‌شوند. برای هر دانشگاه
          قاعدهٔ «یک نیمسال فعال» اعمال می‌شود. دانشگاهی که خالی بماند دست‌نخورده است.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {universities.map((u) => {
            const list = grouped.get(u.id) ?? [];
            const active = list.find((t) => t.isCurrent);
            return (
              <label key={u.id} className="block border border-slate-200 rounded p-2 space-y-1">
                <span className="block text-2xs font-bold text-slate-700">
                  {u.title} ({u.code})
                  <span className="font-normal text-slate-500"> — {list.length.toLocaleString('fa-IR')} نیمسال</span>
                </span>
                <span className="block text-3xs text-slate-500">
                  فعال فعلی: {active ? `${active.termCode} — ${active.title}` : 'هیچ'}
                </span>
                <select
                  value={picks[u.id] ?? ''}
                  onChange={(e) => setPicks((p) => ({ ...p, [u.id]: e.target.value }))}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-2xs bg-white"
                >
                  <option value="">— انتخاب نیمسال —</option>
                  {list.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.termCode} — {t.title}
                      {t.isCurrent ? ' (فعال)' : ''}
                      {t.containsToday ? ' • شامل امروز' : ''}
                      {t.startDate ? '' : ' • بدون تاریخ شروع'}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            disabled={busy !== null || bulkSelected.length === 0}
            onClick={() =>
              run('bulk', async () => {
                const payload = bulkSelected.map(([uniId, termId]) => ({
                  universityId: Number(uniId),
                  termId: Number(termId),
                }));
                const res = await bulkActivateTermsAction(payload);
                if (res.ok) setPicks({});
                return res;
              })
            }
            className="bg-emerald-600 text-white px-4 py-1.5 rounded text-xs disabled:opacity-50"
          >
            {busy === 'bulk'
              ? 'در حال اعمال…'
              : `فعال‌سازی گروهی (${bulkSelected.length.toLocaleString('fa-IR')} دانشگاه)`}
          </button>
          <button
            disabled={busy !== null || bulkSelected.length === 0}
            onClick={() => setPicks({})}
            className="border border-slate-300 text-slate-700 px-3 py-1.5 rounded text-xs disabled:opacity-50"
          >
            پاک کردن انتخاب
          </button>
        </div>
      </div>

      {universities.map((u) => {
        const list = grouped.get(u.id) ?? [];
        const active = list.find((t) => t.isCurrent);
        const containing = list.filter((t) => t.containsToday);
        return (
          <div key={u.id} className="card space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-bold text-xs">
                {u.title} ({u.code})
                <span className="font-normal text-slate-500"> — {list.length.toLocaleString('fa-IR')} نیمسال</span>
              </h3>
              <div className="text-3xs text-slate-500">
                فعال فعلی:{' '}
                {active ? (
                  <span className="text-emerald-700 font-bold">
                    {active.termCode} — {active.title}
                  </span>
                ) : (
                  <span className="text-rose-600 font-bold">هیچ نیمسال فعالی ندارد</span>
                )}
                {' • '}
                شامل تاریخ امروز:{' '}
                {containing.length ? (
                  <span className="text-indigo-700 font-bold">
                    {containing.map((t) => t.termCode).join('، ')}
                  </span>
                ) : (
                  <span className="text-amber-700 font-bold">هیچ‌کدام</span>
                )}
              </div>
            </div>
            {list.length === 0 ? (
              <div className="text-2xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-2">
                برای این دانشگاه هیچ نیمسالی ثبت نشده است.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="hidden md:table w-full text-2xs rt">
                  <thead>
                    <tr className="bg-slate-50 border-b text-slate-600">
                      <th className="px-2 py-1 text-right">کد</th>
                      <th className="px-2 py-1 text-right">عنوان</th>
                      <th className="px-2 py-1 text-right">نوع</th>
                      <th className="px-2 py-1 text-right">شروع</th>
                      <th className="px-2 py-1 text-right">پایان</th>
                      <th className="px-2 py-1 text-center">پرچم فعال</th>
                      <th className="px-2 py-1 text-center">امروز داخل این نیمسال است؟</th>
                      <th className="px-2 py-1 text-center">عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((t) => (
                      <tr
                        key={t.id}
                        className={`border-b ${t.isCurrent ? 'bg-emerald-50/60' : ''} ${
                          t.containsToday ? 'border-r-2 border-r-indigo-400' : ''
                        }`}
                      >
                        <td className="px-2 py-1 font-mono">{t.termCode}</td>
                        <td className="px-2 py-1">{t.title}</td>
                        <td className="px-2 py-1 text-slate-500">
                          {TERM_TYPE_LABEL[t.termType] ?? t.termType}
                        </td>
                        <td className="px-2 py-1 tabular-nums">
                          {jalaliOf(t.startDate)}
                          {!t.startDate && <span className="text-rose-600"> (بدون تاریخ)</span>}
                        </td>
                        <td className="px-2 py-1 tabular-nums">{jalaliOf(t.endDate)}</td>
                        <td className="px-2 py-1 text-center">
                          {t.isCurrent ? (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-3xs">فعال</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-3xs">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-center">
                          {t.containsToday ? (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-3xs">
                              بله
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-3xs">خیر</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button
                            disabled={busy !== null}
                            onClick={() => run('single', async () => activateTermAction(t.id))}
                            className="border border-indigo-300 text-indigo-700 px-2 py-0.5 rounded text-3xs hover:bg-indigo-50 disabled:opacity-50"
                          >
                            فعال‌سازی برای {u.code}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <MobileCardList
                  rows={list}
                  columns={termColumns}
                  getKey={(t) => t.id}
                  renderActions={(t) => (
                    <button
                      disabled={busy !== null}
                      onClick={() => run('single', async () => activateTermAction(t.id))}
                      className="border border-indigo-300 text-indigo-700 px-2 py-0.5 rounded text-3xs hover:bg-indigo-50 disabled:opacity-50"
                    >
                      فعال‌سازی برای {u.code}
                    </button>
                  )}
                  empty={<div>موردی یافت نشد.</div>}
                />
              </div>
            )}
          </div>
        );
      })}

      {orphanTerms.length > 0 && (
        <div className="card space-y-2">
          <h3 className="font-bold text-xs text-amber-700">
            نیمسال‌های بدون دانشگاه ({orphanTerms.length.toLocaleString('fa-IR')})
          </h3>
          <p className="text-2xs text-slate-500">
            این نیمسال‌ها <span className="font-mono">universityId</span> ندارند و قابل فعال‌سازی نیستند.
          </p>
          <div className="flex flex-wrap gap-1">
            {orphanTerms.map((t) => (
              <span key={t.id} className="text-3xs px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                {t.termCode} — {t.title}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

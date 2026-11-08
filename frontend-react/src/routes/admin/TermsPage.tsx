import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toJalaliFromDate, faDigits } from '@/lib/calendar';
import {
  activateTermAdmin,
  bulkActivateTermsAdmin,
  getTermsAdminBundle,
  syncTermsWithDateAdmin,
  type SmallTermRow,
  type TermsSyncResult,
} from '@/lib/small-pages-api';

// ═══ /admin/terms — port of admin/terms/page.tsx + TermsClient.tsx ═══
// All terms of all universities with the isCurrent flag vs the date-derived
// containsToday; single/bulk activation and the sync-with-date engine.

const HIDDEN_TERM_TYPES = ['EQUIVALENCE', 'SPECIAL'];

const TERM_TYPE_LABEL: Record<string, string> = {
  NORMAL: 'نیمسال',
  SUMMER: 'تابستان',
  EQUIVALENCE: 'معادل‌سازی',
  SPECIAL: 'ویژه',
};

function jalaliOf(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const { jy, jm, jd } = toJalaliFromDate(d);
  return faDigits(`${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`);
}

function fa(n: number): string {
  return faDigits(Number(n || 0).toLocaleString('en-US'));
}

function Msg({ msg }: { msg: { text: string; kind: 'ok' | 'error' | 'info' } | null }) {
  if (!msg) return null;
  const cls =
    msg.kind === 'ok'
      ? 'bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200'
      : msg.kind === 'error'
        ? 'bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'
        : 'bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200';
  return <div className={`text-xs p-2 rounded leading-6 ${cls}`}>{msg.text}</div>;
}

export function TermsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-terms-bundle'],
    queryFn: getTermsAdminBundle,
  });
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' | 'info' } | null>(null);
  const [syncReport, setSyncReport] = useState<TermsSyncResult | null>(null);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [teachingOnly, setTeachingOnly] = useState(false);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['admin-terms-bundle'] });
  };

  const singleMut = useMutation({
    mutationFn: (termId: number) => activateTermAdmin(termId),
    onSuccess: async (res) => {
      if (res.ok) setMsg({ text: res.message ?? 'انجام شد', kind: 'ok' });
      else setMsg({ text: res.error ?? 'خطای نامشخص', kind: 'error' });
      await invalidate();
    },
    onError: (e: Error) => setMsg({ text: e.message || 'خطای ارتباط با سرور', kind: 'error' }),
  });
  const bulkMut = useMutation({
    mutationFn: (payload: { universityId: number; termId: number }[]) => bulkActivateTermsAdmin(payload),
    onSuccess: async (res) => {
      if (res.ok) setMsg({ text: res.message ?? 'انجام شد', kind: 'ok' });
      else setMsg({ text: res.error ?? 'خطای نامشخص', kind: 'error' });
      setPicks({});
      await invalidate();
    },
    onError: (e: Error) => setMsg({ text: e.message || 'خطای ارتباط با سرور', kind: 'error' }),
  });
  const syncMut = useMutation({
    mutationFn: syncTermsWithDateAdmin,
    onSuccess: async (res) => {
      setSyncReport(res);
      if (res.ok) setMsg({ text: res.message ?? 'انجام شد', kind: 'ok' });
      else setMsg({ text: res.error ?? 'خطای نامشخص', kind: 'error' });
      await invalidate();
    },
    onError: (e: Error) => setMsg({ text: e.message || 'خطای ارتباط با سرور', kind: 'error' }),
  });
  const busy = singleMut.isPending || bulkMut.isPending || syncMut.isPending;

  const terms = data?.terms ?? [];
  const visibleTerms = useMemo(
    () =>
      teachingOnly
        ? terms.filter((t) => !HIDDEN_TERM_TYPES.includes((t.termType ?? '').trim().toUpperCase()))
        : terms,
    [terms, teachingOnly],
  );
  const hiddenCount = terms.length - visibleTerms.length;

  const grouped = useMemo(() => {
    const map = new Map<number, SmallTermRow[]>();
    for (const t of visibleTerms) {
      if (t.universityId == null) continue;
      const list = map.get(t.universityId) ?? [];
      list.push(t);
      map.set(t.universityId, list);
    }
    return map;
  }, [visibleTerms]);

  const orphanTerms = useMemo(() => visibleTerms.filter((t) => t.universityId == null), [visibleTerms]);


  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data)
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت نیمسال‌ها ناموفق بود.</CardContent></Card>;

  const bulkSelected = Object.entries(picks).filter(([, v]) => v !== '');

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-sm font-black">🗓️ مدیریت نیمسال‌ها — همهٔ دانشگاه‌ها</h1>
        <Button size="sm" variant="outline" asChild>
          <Link to="/admin"><ArrowRight className="size-3.5" aria-hidden /> بازگشت به پیشخوان</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <h2 className="font-bold text-sm">نیمسال‌های فعال — همهٔ دانشگاه‌ها</h2>
          <p className="text-xs leading-6 text-muted-foreground">
            فهرست زیر همهٔ نیمسال‌های همهٔ دانشگاه‌ها را نشان می‌دهد (نه فقط دانشگاه جاری). ستون
            <b> «پرچم فعال»</b> مقدار <span className="font-mono">isCurrent</span> در پایگاه‌داده است و ستون
            <b> «امروز داخل این نیمسال است؟»</b> از روی بازهٔ <span className="font-mono">startDate</span> تا
            <span className="font-mono"> endDate</span> و تاریخ امروز ({jalaliOf(data.today)}) محاسبه می‌شود.
            قاعدهٔ سامانه: هر دانشگاه حداکثر یک نیمسال فعال دارد و با هر فعال‌سازی، پرچم بقیهٔ نیمسال‌های
            همان دانشگاه در یک تراکنش صفر می‌شود.
          </p>
          <label className="flex items-center gap-2 text-2xs text-muted-foreground">
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
            <span className="opacity-70">(معادل‌سازی و ویژه پنهان شوند — {fa(hiddenCount)} ردیف)</span>
          </label>
          <div className="flex flex-wrap gap-2 text-2xs">
            <span className="px-2 py-1 rounded bg-muted text-foreground/80">کل نیمسال‌ها: <b className="tabular-nums">{fa(data.terms.length)}</b></span>
            <span className="px-2 py-1 rounded bg-muted text-foreground/80">نمایش‌داده‌شده: <b className="tabular-nums">{fa(visibleTerms.length)}</b></span>
            <span className="px-2 py-1 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">پرچم فعال: <b className="tabular-nums">{fa(data.activeCount)}</b></span>
            <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">شامل تاریخ امروز: <b className="tabular-nums">{fa(data.containingCount)}</b></span>
          </div>
        </CardContent>
      </Card>

      <Msg msg={msg} />

      <Card>
        <CardContent className="space-y-3 pt-4">
          <h3 className="font-bold text-xs">همگام‌سازی با تاریخ</h3>
          <p className="text-2xs leading-6 text-muted-foreground">
            برای هر دانشگاه، نیمسالی که بازهٔ تاریخش امروز را در بر می‌گیرد فعال می‌شود و پرچم فعالِ
            نیمسال‌های دیگر همان دانشگاه صفر می‌گردد. نیمسال‌هایی که <span className="font-mono">startDate</span>
            خالی دارند هرگز فعال نمی‌شوند. اگر دانشگاهی نیمسالِ شامل امروز نداشته باشد، چیزی صفر
            نمی‌شود و همان دانشگاه صریحاً گزارش می‌شود. محاسبهٔ تاریخ کاملاً سمت سرور انجام می‌شود.
          </p>
          <Button size="sm" disabled={busy} onClick={() => syncMut.mutate()}>
            {syncMut.isPending ? 'در حال همگام‌سازی…' : 'همگام‌سازی با تاریخ'}
          </Button>

          {syncReport?.ok && (
            <div className="text-2xs leading-6 border border-border rounded p-2 space-y-2 bg-muted/40">
              <div>
                <b className="text-emerald-700 dark:text-emerald-300">فعال‌شده ({fa(syncReport.activated.length)}):</b>{' '}
                {syncReport.activated.length
                  ? syncReport.activated.map((a) => `${a.university} → ${a.termCode}`).join('، ')
                  : 'موردی نبود'}
              </div>
              <div>
                <b>مطابق تاریخ از قبل ({fa(syncReport.unchanged.length)}):</b>{' '}
                {syncReport.unchanged.length
                  ? syncReport.unchanged.map((a) => `${a.university} → ${a.termCode}`).join('، ')
                  : 'موردی نبود'}
              </div>
              <div>
                <b className="text-rose-700 dark:text-rose-300">بدون نیمسال شامل امروز ({fa(syncReport.noContaining.length)}):</b>{' '}
                {syncReport.noContaining.length ? syncReport.noContaining.join(' | ') : 'موردی نبود'}
              </div>
              <div className="text-muted-foreground">پرچم فعالِ کهنهٔ صفرشده: {fa(syncReport.cleared)}</div>
            </div>
          )}
          {syncReport && !syncReport.ok && (
            <div className="text-2xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200">
              {syncReport.error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <h3 className="font-bold text-xs">فعال‌سازی گروهی برای چند دانشگاه</h3>
          <p className="text-2xs leading-6 text-muted-foreground">
            برای هر دانشگاه یک نیمسال انتخاب کنید و با یک ارسال، همه با هم فعال می‌شوند. برای هر دانشگاه
            قاعدهٔ «یک نیمسال فعال» اعمال می‌شود. دانشگاهی که خالی بماند دست‌نخورده است.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data.universities.map((u) => {
              const list = grouped.get(u.id) ?? [];
              const active = list.find((t) => t.isCurrent);
              return (
                <label key={u.id} className="block border border-border rounded p-2 space-y-1">
                  <span className="block text-2xs font-bold text-foreground/80">
                    {u.title} ({u.code})
                    <span className="font-normal text-muted-foreground"> — {fa(list.length)} نیمسال</span>
                  </span>
                  <span className="block text-3xs text-muted-foreground">
                    فعال فعلی: {active ? `${active.termCode} — ${active.title}` : 'هیچ'}
                  </span>
                  <select
                    value={picks[u.id] ?? ''}
                    onChange={(e) => setPicks((p) => ({ ...p, [u.id]: e.target.value }))}
                    className="w-full border border-input rounded px-2 py-1 text-2xs bg-card"
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
            <Button
              size="sm"
              disabled={busy || bulkSelected.length === 0}
              onClick={() =>
                bulkMut.mutate(
                  bulkSelected.map(([uniId, termId]) => ({ universityId: Number(uniId), termId: Number(termId) })),
                )
              }
            >
              {bulkMut.isPending
                ? 'در حال اعمال…'
                : `فعال‌سازی گروهی (${fa(bulkSelected.length)} دانشگاه)`}
            </Button>
            <Button size="sm" variant="outline" disabled={busy || bulkSelected.length === 0} onClick={() => setPicks({})}>
              پاک کردن انتخاب
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.universities.map((u) => {
        const list = grouped.get(u.id) ?? [];
        const active = list.find((t) => t.isCurrent);
        const containing = list.filter((t) => t.containsToday);
        return (
          <Card key={u.id}>
            <CardContent className="space-y-2 pt-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-bold text-xs">
                  {u.title} ({u.code})
                  <span className="font-normal text-muted-foreground"> — {fa(list.length)} نیمسال</span>
                </h3>
                <div className="text-3xs text-muted-foreground">
                  فعال فعلی:{' '}
                  {active ? (
                    <span className="text-emerald-700 dark:text-emerald-300 font-bold">{active.termCode} — {active.title}</span>
                  ) : (
                    <span className="text-rose-600 font-bold">هیچ نیمسال فعالی ندارد</span>
                  )}
                  {' • '}
                  شامل تاریخ امروز:{' '}
                  {containing.length ? (
                    <span className="text-indigo-700 dark:text-indigo-300 font-bold">{containing.map((t) => t.termCode).join('، ')}</span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300 font-bold">هیچ‌کدام</span>
                  )}
                </div>
              </div>
              {list.length === 0 ? (
                <div className="text-2xs text-muted-foreground bg-muted/40 border border-border rounded p-2">
                  برای این دانشگاه هیچ نیمسالی ثبت نشده است.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-2xs">
                    <thead>
                      <tr className="bg-muted/60 border-b border-border text-muted-foreground">
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
                          className={`border-b border-border/50 last:border-0 ${t.isCurrent ? 'bg-emerald-50/60 dark:bg-emerald-950/30' : ''} ${
                            t.containsToday ? 'border-r-2 border-r-indigo-400' : ''
                          }`}
                        >
                          <td className="px-2 py-1 font-mono">{t.termCode}</td>
                          <td className="px-2 py-1">{t.title}</td>
                          <td className="px-2 py-1 text-muted-foreground">{TERM_TYPE_LABEL[(t.termType ?? '').trim().toUpperCase()] ?? t.termType ?? '—'}</td>
                          <td className="px-2 py-1 tabular-nums">
                            {jalaliOf(t.startDate)}
                            {!t.startDate && <span className="text-rose-600"> (بدون تاریخ)</span>}
                          </td>
                          <td className="px-2 py-1 tabular-nums">{jalaliOf(t.endDate)}</td>
                          <td className="px-2 py-1 text-center">
                            {t.isCurrent ? (
                              <Badge className="border-transparent bg-emerald-600 text-white text-3xs">فعال</Badge>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-3xs">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-center">
                            {t.containsToday ? (
                              <Badge className="border-transparent bg-indigo-600 text-white text-3xs">بله</Badge>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-3xs">خیر</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-center">
                            <button
                              disabled={busy}
                              onClick={() => singleMut.mutate(t.id)}
                              className="border border-indigo-300 text-indigo-700 dark:text-indigo-300 dark:border-indigo-700 px-2 py-0.5 rounded text-3xs hover:bg-indigo-50 dark:hover:bg-indigo-950/50 disabled:opacity-50"
                            >
                              فعال‌سازی برای {u.code}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {orphanTerms.length > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="font-bold text-xs text-amber-700 dark:text-amber-300">
              نیمسال‌های بدون دانشگاه ({fa(orphanTerms.length)})
            </h3>
            <p className="text-2xs text-muted-foreground">
              این نیمسال‌ها <span className="font-mono">universityId</span> ندارند و قابل فعال‌سازی نیستند.
            </p>
            <div className="flex flex-wrap gap-1">
              {orphanTerms.map((t) => (
                <span key={t.id} className="text-3xs px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200">
                  {t.termCode} — {t.title}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

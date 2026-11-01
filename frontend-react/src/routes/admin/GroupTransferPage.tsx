import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { faDigits, faNumber, toEnDigits } from '@/lib/fa';
import { getConfirmationTerms } from '@/lib/enrollment-api';
import {
  getTransferRoster,
  getTransferTargetGroups,
  getTransferTargets,
  transferStudent,
  type GroupRosterRow,
  type TransferCourseGroup,
  type TransferOffering,
  type TransferRosterOffer,
} from '@/lib/group-transfer-api';

// ═══ Moving a student between groups of one course — port of admin/group-transfer ═══

const STATUS_LABEL: Record<string, string> = {
  REGISTERED: 'ثبت‌شده', WAITLISTED: 'لیست انتظار', PENDING_COUNCIL: 'حکم شورا',
  FINALIZED: 'نهایی', DROPPED: 'حذف‌شده', COMPLETED: 'تکمیل',
};

type ResultItem = {
  enrollmentId: number; name: string; code: string; ok: boolean;
  warnings: string[]; blocks: string[]; error?: string;
};

export function AdminGroupTransferPage() {
  const [termId, setTermId] = useState(0);
  const [q, setQ] = useState('');
  const [courses, setCourses] = useState<TransferCourseGroup[]>([]);
  const [selCourseID, setSelCourseID] = useState<number | null>(null);
  const [srcOfferingID, setSrcOfferingID] = useState<number | null>(null);
  const [offer, setOffer] = useState<TransferRosterOffer | null>(null);
  const [roster, setRoster] = useState<GroupRosterRow[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [targets, setTargets] = useState<TransferOffering[]>([]);
  const [toOfferingID, setToOfferingID] = useState<number | null>(null);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [reasonBy, setReasonBy] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const { data: terms = [] } = useQuery({ queryKey: ['confirmation-terms'], queryFn: getConfirmationTerms, staleTime: 60_000 });

  useEffect(() => {
    if (!termId && terms.length) {
      const cur = terms.find((t) => t.isCurrent === 1);
      setTermId(cur ? cur.id : terms[0].id);
    }
  }, [terms, termId]);

  useEffect(() => {
    if (!termId) return;
    getTransferTargets(termId).then(setCourses).catch(() => setCourses([]));
    setSelCourseID(null); setSrcOfferingID(null); setOffer(null); setRoster([]); setTargets([]); setResults([]);
  }, [termId]);

  const filtered = useMemo(() => {
    const needle = toEnDigits(q.trim().toLowerCase());
    const list = needle ? courses.filter((c) => toEnDigits((c.code + ' ' + c.title).toLowerCase()).includes(needle)) : courses;
    return list.slice(0, 25);
  }, [courses, q]);

  const selCourse = courses.find((c) => c.courseId === selCourseID) ?? null;
  const target = targets.find((t) => t.offeringId === toOfferingID) ?? null;

  async function loadRoster(oid: number) {
    setBusy(true);
    setMsg(null);
    try {
      const [r, t] = await Promise.all([getTransferRoster(termId, oid), getTransferTargetGroups(termId, oid)]);
      setOffer(r.offer);
      setRoster(r.roster);
      setSelected([]);
      setResults([]);
      setReasonBy({});
      setTargets(t.groups);
      setToOfferingID(t.groups[0]?.offeringId ?? null);
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    } finally {
      setBusy(false);
    }
  }

  function onPickCourse(c: TransferCourseGroup) {
    setSelCourseID(c.courseId);
    setSrcOfferingID(null); setOffer(null); setRoster([]); setSelected([]); setTargets([]); setToOfferingID(null); setResults([]);
  }

  async function runTransfer(eids: number[], overrideReason?: string) {
    if (!toOfferingID) { setMsg({ kind: 'err', text: 'گروه مقصد را انتخاب کنید.' }); return; }
    if (!eids.length) { setMsg({ kind: 'err', text: 'حداقل یک دانشجو انتخاب کنید.' }); return; }
    setBusy(true);
    setMsg(null);
    const out: ResultItem[] = [];
    for (const eid of eids) {
      const row = roster.find((r) => r.enrollmentId === eid);
      const r = await transferStudent({ enrollmentId: eid, toOfferingId: toOfferingID, overrideReason }).catch(() => ({ ok: false, error: 'خطا', warnings: [] as string[], blocks: [] as string[] }));
      out.push({
        enrollmentId: eid,
        name: row ? `${row.firstName} ${row.lastName}`.trim() : `کد ${eid}`,
        code: row?.studentCode ?? '',
        ok: r.ok,
        warnings: r.warnings ?? [],
        blocks: r.blocks ?? [],
        error: r.ok ? undefined : r.error,
      });
    }
    setResults(out);
    setBusy(false);
    if (out.some((x) => x.ok) && srcOfferingID) {
      const r = await getTransferRoster(termId, srcOfferingID).catch(() => null);
      if (r) { setOffer(r.offer); setRoster(r.roster); setSelected([]); }
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-cyan-800 via-sky-800 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black"><ArrowLeftRight className="size-5" aria-hidden /> انتقال دانشجو بین گروه‌های یک درس</h1>
          <p className="mt-1 text-xs text-cyan-100">همان ردیف ثبت‌نام جابه‌جا می‌شود؛ ظرفیت، تداخل، مشروطیت/سنوات، مالی و حدنصاب مبدأ پیش از انتقال دوباره بررسی می‌شوند.</p>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="text-muted-foreground"><X className="size-3.5" aria-hidden /><span className="sr-only">بستن</span></button>
        </div>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 p-3">
          <label className="space-y-1 text-[10px] text-muted-foreground"><span>نیمسال</span>
            <select value={termId} onChange={(e) => setTermId(Number(e.target.value))} className="h-8 rounded-lg border border-input bg-card px-2 text-xs">
              {terms.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی درس (کد یا نام)…" className="h-8 pr-8 text-xs" />
          </div>
          <span className="text-[11px] font-bold text-muted-foreground">{faNumber(courses.length)} درس در ترم</span>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-xs font-black">۱) درس و گروه مبدأ</h3>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {filtered.map((c) => (
                <button key={c.courseId} type="button" onClick={() => onPickCourse(c)} className={`w-full rounded-lg border px-2 py-1.5 text-right text-[11px] ${selCourseID === c.courseId ? 'border-cyan-500 bg-cyan-50 font-black dark:bg-cyan-950/40' : 'border-border hover:bg-muted/50'}`}>
                  <span className="block truncate">{c.title}</span>
                  <span className="block font-mono text-[10px] text-muted-foreground" dir="ltr">{c.code} · {c.departmentName}</span>
                </button>
              ))}
              {filtered.length === 0 ? <p className="p-3 text-center text-[11px] text-muted-foreground">درسی یافت نشد.</p> : null}
            </div>
            {selCourse ? (
              <div className="space-y-1 border-t border-border/60 pt-2">
                <p className="text-[10px] font-bold text-muted-foreground">گروه مبدأ را انتخاب کنید:</p>
                {selCourse.offerings.map((o) => (
                  <button key={o.offeringId} type="button" onClick={() => { setSrcOfferingID(o.offeringId); void loadRoster(o.offeringId); }} className={`flex w-full items-center justify-between rounded-lg border px-2 py-1 text-[11px] ${srcOfferingID === o.offeringId ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-950/40' : 'border-border'}`}>
                    <span>گروه {faNumber(o.groupNumber)} · {o.professorName}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{faNumber(o.enrolledCount)}/{faNumber(o.capacity)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <h3 className="text-xs font-black">۲) دانشجویان گروه مبدأ</h3>
              {roster.some((r) => r.status === 'REGISTERED') ? (
                <button type="button" className="text-[10px] font-bold text-cyan-700 hover:underline dark:text-cyan-300" onClick={() => setSelected(roster.filter((r) => r.status === 'REGISTERED').map((r) => r.enrollmentId))}>انتخاب همهٔ قابل‌انتقال</button>
              ) : null}
            </div>
            {offer ? <p className="text-[11px] text-muted-foreground">{offer.courseTitle} ({offer.courseCode}) · گروه {faNumber(offer.groupNumber)} · {faNumber(offer.enrolledCount)}/{faNumber(offer.capacity)}</p> : null}
            <div className="max-h-[26rem] divide-y divide-border/60 overflow-y-auto">
              {roster.map((r) => {
                const can = r.status === 'REGISTERED';
                return (
                  <div key={r.enrollmentId} className={`flex items-center gap-2 py-2 ${can ? '' : 'opacity-55'}`}>
                    <input type="checkbox" className="size-4" disabled={!can} checked={selected.includes(r.enrollmentId)} onChange={() => setSelected((p) => p.includes(r.enrollmentId) ? p.filter((x) => x !== r.enrollmentId) : [...p, r.enrollmentId])} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-black">{r.firstName} {r.lastName}</div>
                      <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{faDigits(r.studentCode)}</div>
                    </div>
                    <Badge variant={can ? 'success' : 'secondary'} className="text-[9px]">{STATUS_LABEL[r.status] ?? r.status}</Badge>
                    <Button size="sm" className="h-6 px-2 text-[10px]" disabled={!can || busy || !toOfferingID} onClick={() => void runTransfer([r.enrollmentId])}>انتقال</Button>
                  </div>
                );
              })}
              {roster.length === 0 ? <p className="p-4 text-center text-[11px] text-muted-foreground">گروه مبدأ را انتخاب کن تا فهرست دانشجویان بیاید.</p> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col space-y-2 pt-4">
            <h3 className="text-xs font-black">۳) گروه مقصد (همان درس، همین ترم)</h3>
            {targets.length > 0 ? (
              <label className="space-y-1 text-[10px] text-muted-foreground"><span>گروه مقصد</span>
                <select value={toOfferingID ?? ''} onChange={(e) => setToOfferingID(e.target.value ? Number(e.target.value) : null)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px]">
                  {targets.map((t) => <option key={t.offeringId} value={t.offeringId}>گ{faNumber(t.groupNumber)} ({faNumber(t.enrolledCount)}/{faNumber(t.capacity)}) · {t.professorName}</option>)}
                </select>
              </label>
            ) : srcOfferingID ? <p className="text-[11px] text-muted-foreground">گروه دیگری برای این درس ارائه نشده است.</p> : null}
            {target ? (
              <div className="space-y-1 rounded-xl border border-cyan-200 bg-cyan-50/60 p-2 text-[11px] dark:border-cyan-800 dark:bg-cyan-950/30">
                <div className="flex justify-between"><span className="font-bold">ظرفیت ثبت‌شده</span><span className="font-black">{faNumber(target.enrolledCount)} از {faNumber(target.capacity)}</span></div>
                <div className="flex justify-between"><span className="font-bold">ظرفیت خالی</span><span className={`font-black ${target.capacity - target.enrolledCount <= 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{faNumber(Math.max(target.capacity - target.enrolledCount, 0))} نفر{target.capacity - target.enrolledCount <= 0 ? ' (تکمیل — نیاز به دلیل)' : ''}</span></div>
              </div>
            ) : null}
            <Button className="mt-auto w-full" disabled={busy || selected.length === 0 || !toOfferingID} onClick={() => void runTransfer(selected)}>
              {busy ? '… در حال انتقال' : `انتقال ${faNumber(selected.length)} دانشجوی انتخاب‌شده`}
            </Button>
            <p className="text-[10px] leading-5 text-muted-foreground">برای تخطی از گیت سخت (ظرفیت/امتحان تکراری)، «انتقال با دلیل» (≥۵ نویسه) در نتایج همان دانشجو فعال می‌شود.</p>
          </CardContent>
        </Card>
      </div>

      {results.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-xs font-black">نتایج انتقال ({faNumber(results.length)} دانشجو)</h3>
            <div className="space-y-2">
              {results.map((res) => {
                const reason = reasonBy[res.enrollmentId] ?? '';
                return (
                  <div key={res.enrollmentId} className={`space-y-1 rounded-xl border p-2 ${res.ok ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-rose-200 bg-rose-50/60 dark:border-rose-800 dark:bg-rose-950/30'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-black">{res.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{res.code}</span>
                      <Badge variant={res.ok ? 'success' : 'destructive'} className="text-[9px]">{res.ok ? 'منتقل شد' : 'انتقال نشد'}</Badge>
                    </div>
                    {res.ok && res.warnings.map((w, i) => <div key={i} className="text-[10px] font-bold text-amber-700 dark:text-amber-300">⚠️ {w}</div>)}
                    {!res.ok ? (
                      <>
                        {res.blocks.map((b, i) => <div key={i} className="text-[10px] font-bold text-rose-700 dark:text-rose-300">❌ {b}</div>)}
                        {res.blocks.length === 0 && res.error ? <div className="text-[10px] font-bold text-rose-700 dark:text-rose-300">❌ {res.error}</div> : null}
                        {res.blocks.length > 0 ? (
                          <div className="space-y-1 rounded-lg border border-rose-200 bg-card p-2 dark:border-rose-800">
                            <p className="text-[10px] font-black text-rose-700 dark:text-rose-300">🔓 انتقال با دلیل (نادیده‌گرفتن آیین‌نامه):</p>
                            <textarea value={reason} onChange={(e) => setReasonBy((p) => ({ ...p, [res.enrollmentId]: e.target.value }))} rows={2} className="w-full rounded-lg border border-input bg-transparent px-2 py-1 text-[11px]" placeholder="دلیل (حداقل ۵ نویسه) — در ممیزی ثبت می‌شود…" />
                            <Button size="sm" variant="warning" className="w-full" disabled={busy || reason.trim().length < 5} onClick={() => void runTransfer([res.enrollmentId], reason.trim())}>🔓 انتقال با دلیل</Button>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

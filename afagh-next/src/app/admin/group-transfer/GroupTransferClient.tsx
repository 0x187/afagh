'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getGroupRosterAction,
  getTransferTargetGroupsAction,
  getTransferTargetsAction,
  transferStudentAction,
  type GroupRosterRow,
  type TransferCourseGroup,
  type TransferOffering,
} from './actions';

const sel = 'w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white';

const STATUS_LABEL: Record<string, string> = {
  REGISTERED: 'ثبت‌شده',
  WAITLISTED: 'صف انتظار',
  PENDING_COUNCIL: 'در انتظار شورا',
  DROPPED: 'حذف‌شده',
};

const STATUS_CHIP: Record<string, string> = {
  REGISTERED: 'bg-emerald-100 text-emerald-800',
  WAITLISTED: 'bg-amber-100 text-amber-800',
  PENDING_COUNCIL: 'bg-sky-100 text-sky-800',
  DROPPED: 'bg-rose-100 text-rose-700',
};

interface ResultItem {
  enrollmentId: number;
  name: string;
  code: string;
  ok: boolean;
  warnings: string[];
  blocks: string[];
  error?: string;
}

function fa(n: number | null | undefined): string {
  return Number.isFinite(Number(n)) ? Number(n).toLocaleString('fa-IR') : '—';
}

export default function GroupTransferClient({ terms }: { terms: { id: number; title: string; isCurrent: boolean }[] }) {
  const [termId, setTermId] = useState(() => terms.find(t => t.isCurrent)?.id ?? terms[0]?.id ?? 0);
  const [courses, setCourses] = useState<TransferCourseGroup[]>([]);
  const [q, setQ] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selCourseId, setSelCourseId] = useState<number | null>(null);
  const [srcOfferingId, setSrcOfferingId] = useState<number | null>(null);
  const [offer, setOffer] = useState<{ courseCode: string; courseTitle: string; groupNumber: number; capacity: number; enrolledCount: number; professorName: string } | null>(null);
  const [roster, setRoster] = useState<GroupRosterRow[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [targets, setTargets] = useState<TransferOffering[]>([]);
  const [toOfferingId, setToOfferingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [reasonBy, setReasonBy] = useState<Record<number, string>>({});

  const selCourse = useMemo(() => courses.find(c => c.courseId === selCourseId) ?? null, [courses, selCourseId]);

  const loadCourses = async (tid: number) => {
    if (!tid) { setCourses([]); return; }
    const r = await getTransferTargetsAction(tid).catch(() => ({ ok: false as const, error: 'خطا' }));
    if (r.ok) setCourses(r.courses ?? []);
    else setMsg({ kind: 'err', text: r.error ?? 'خطا در بارگذاری دروس.' });
  };
  useEffect(() => { loadCourses(termId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [termId]);

  const resetPane = () => {
    setSrcOfferingId(null); setOffer(null); setRoster([]); setSelected([]);
    setTargets([]); setToOfferingId(null); setResults([]); setReasonBy({});
  };

  const onPickCourse = (c: TransferCourseGroup) => {
    setSelCourseId(c.courseId);
    setQ(`${c.code} ${c.title}`);
    setShowDropdown(false);
    resetPane();
  };

  const onTermChange = (tid: number) => {
    setTermId(tid);
    setSelCourseId(null); setQ(''); resetPane();
  };

  const filteredCourses = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const list = qq ? courses.filter(c => (c.code + ' ' + c.title).toLowerCase().includes(qq)) : courses;
    return list.slice(0, 25);
  }, [courses, q]);

  const loadRoster = async (oid: number) => {
    setBusy(true); setMsg(null);
    const [r1, r2] = await Promise.all([
      getGroupRosterAction(termId, oid).catch(() => ({ ok: false as const, error: 'خطا' })),
      getTransferTargetGroupsAction(termId, oid).catch(() => ({ ok: false as const, error: 'خطا' })),
    ]);
    if (!r1.ok) { setMsg({ kind: 'err', text: r1.error ?? 'خطا' }); setBusy(false); return; }
    setOffer(r1.offer ?? null);
    setRoster(r1.roster ?? []);
    setSelected([]); setResults([]); setReasonBy({});
    if (r2.ok) {
      setTargets(r2.groups ?? []);
      setToOfferingId((r2.groups ?? [])[0]?.offeringId ?? null);
    }
    setBusy(false);
  };

  const onSourceGroup = (oid: number | null) => {
    setSrcOfferingId(oid);
    setOffer(null); setRoster([]); setSelected([]); setTargets([]); setToOfferingId(null); setResults([]); setReasonBy({});
    if (oid) loadRoster(oid);
  };

  const toggleSelect = (eid: number) => {
    setSelected(p => p.includes(eid) ? p.filter(x => x !== eid) : [...p, eid]);
  };

  const canTransfer = (row: GroupRosterRow) => row.status === 'REGISTERED';

  const runTransfer = async (eids: number[], overrideReason?: string) => {
    if (!toOfferingId) { setMsg({ kind: 'err', text: 'گروه مقصد را انتخاب کنید.' }); return; }
    if (!eids.length) { setMsg({ kind: 'err', text: 'حداقل یک دانشجو انتخاب کنید.' }); return; }
    setBusy(true); setMsg(null);
    const out: ResultItem[] = [];
    for (const eid of eids) {
      const row = roster.find(r => r.enrollmentId === eid);
      const r = await transferStudentAction({ enrollmentId: eid, toOfferingId, overrideReason }).catch(() => ({ ok: false as const, error: 'خطا' }));
      out.push({
        enrollmentId: eid,
        name: row ? `${row.firstName} ${row.lastName}`.trim() : `کد ${eid}`,
        code: row?.studentCode ?? '',
        ok: !!r.ok,
        warnings: (r as any).warnings ?? [],
        blocks: (r as any).blocks ?? [],
        error: r.ok ? undefined : ((r as any).error ?? 'ناموفق'),
      });
    }
    setResults(out);
    setBusy(false);
    // بروزرسانی شمارنده‌های گروه‌ها بعد از انتقال موفق
    if (out.some(x => x.ok)) {
      const r1 = await getGroupRosterAction(termId, srcOfferingId ?? -1).catch(() => null);
      if (r1?.ok) {
        setOffer(r1.offer ?? null);
        setRoster(r1.roster ?? []);
        setSelected([]);
      }
    }
  };

  const doSelected = () => runTransfer(selected);
  const doOne = (eid: number) => runTransfer([eid]);
  const doOneWithReason = (eid: number) => {
    const reason = (reasonBy[eid] ?? '').trim();
    if (reason.length < 5) { setMsg({ kind: 'err', text: 'دلیل نادیده‌گرفتن (حداقل ۵ نویسه) الزامی است.' }); return; }
    runTransfer([eid], reason);
  };

  const target = targets.find(t => t.offeringId === toOfferingId) ?? null;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="card">
        <h1 className="font-black text-base">🔀 انتقال دانشجو بین گروه‌های یک درس</h1>
        <p className="text-xs text-slate-500 mt-1">
          فهرست دانشجویانِ گروه مبدأ را ببین و آن‌ها را به گروه دیگری از <b>همان درس</b> منتقل کن —
          با همهٔ گیت‌های سخت موتور ثبت‌نام (ظرفیت، تداخل کلاس/امتحان، مشروطیت/سنوات، مالی) و امکان «انتقال با دلیل» برای تخطی.
        </p>
      </div>

      {/* ── نوار بالا: ترم + جست‌وجوی درس + گروه مبدأ ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="grid sm:grid-cols-3 gap-2">
          <label className="text-xs font-bold text-slate-600">
            ترم
            <select value={termId} onChange={e => onTermChange(Number(e.target.value))} className={sel + ' mt-1'}>
              {terms.map(t => <option key={t.id} value={t.id}>{t.title}{t.isCurrent ? ' (جاری)' : ''}</option>)}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-600 relative">
            جست‌وجوی درس (کد یا عنوان)
            <input
              value={q}
              onChange={e => { setQ(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              placeholder="مثلاً ریاضی عمومی ۱…"
              className={sel + ' mt-1'}
            />
            {showDropdown && filteredCourses.length > 0 && (
              <div className="absolute z-20 top-full right-0 left-0 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg divide-y divide-slate-100">
                {filteredCourses.map(c => (
                  <button key={c.courseId} type="button" onClick={() => onPickCourse(c)}
                    className="w-full text-right px-3 py-2 text-xs hover:bg-indigo-50">
                    <span className="font-black text-slate-800">{c.code} {c.title}</span>
                    <span className="text-slate-400 text-3xs"> · {c.units ?? ''} واحد · {c.offerings.length} گروه · {c.departmentName}</span>
                  </button>
                ))}
              </div>
            )}
          </label>

          <label className="text-xs font-bold text-slate-600">
            گروه مبدأ
            <select
              value={srcOfferingId ?? ''}
              onChange={e => onSourceGroup(e.target.value ? Number(e.target.value) : null)}
              className={sel + ' mt-1'}
              disabled={!selCourse}
            >
              <option value="">— گروهی را انتخاب کن —</option>
              {(selCourse?.offerings ?? []).map(o => (
                <option key={o.offeringId} value={o.offeringId}>
                  گ{o.groupNumber} ({fa(o.enrolledCount)}/{fa(o.capacity)}) · {o.professorName}
                </option>
              ))}
            </select>
          </label>
        </div>
        {q && !filteredCourses.length && <p className="text-2xs text-slate-400">درسی با این کد/عنوان در این ترم (در محدودهٔ دسترسی شما) پیدا نشد.</p>}
      </div>

      {/* ── دو پنجره: فهرست مبدأ (چپ) | مقصد + انتقال (راست) ── */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* ══ LEFT: فهرست دانشجویان گروه مبدأ ══ */}
        <div className="rounded-2xl border border-indigo-200 bg-white overflow-hidden flex flex-col">
          <div className="p-3 border-b border-indigo-100 bg-indigo-50/60 flex items-center justify-between gap-2">
            <p className="text-xs font-black text-indigo-900">
              👥 دانشجویان گروه مبدأ {offer ? `· ${offer.courseCode} ${offer.courseTitle} (گ${offer.groupNumber})` : ''}
            </p>
            {offer && (
              <span className="text-3xs text-indigo-700 font-bold">
                ثبت‌شده {fa(offer.enrolledCount)}/{fa(offer.capacity)} · {offer.professorName}
              </span>
            )}
          </div>

          {roster.length > 0 && (
            <div className="p-2 border-b border-slate-100 flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-2xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={selected.length > 0 && selected.length === roster.filter(canTransfer).length}
                  onChange={e => setSelected(e.target.checked ? roster.filter(canTransfer).map(r => r.enrollmentId) : [])}
                />
                انتخاب همهٔ قابل‌انتقال ({fa(roster.filter(canTransfer).length)})
              </label>
              <span className="text-3xs text-slate-400 mr-auto">فقط وضعیت «ثبت‌شده» قابل انتقال است.</span>
            </div>
          )}

          <div className="max-h-[26rem] overflow-y-auto divide-y divide-slate-100">
            {roster.map(row => (
              <div key={row.enrollmentId} className={'flex items-center gap-2 px-3 py-2 ' + (canTransfer(row) ? '' : 'opacity-55')}>
                <input
                  type="checkbox"
                  className="w-4 h-4 shrink-0"
                  disabled={!canTransfer(row)}
                  checked={selected.includes(row.enrollmentId)}
                  onChange={() => toggleSelect(row.enrollmentId)}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-slate-800 truncate">{row.firstName} {row.lastName}</p>
                  <p className="text-3xs text-slate-400">{row.studentCode}</p>
                </div>
                <span className={'shrink-0 rounded-full px-2 py-0.5 text-3xs font-black ' + (STATUS_CHIP[row.status] ?? 'bg-slate-200 text-slate-600')}>
                  {STATUS_LABEL[row.status] ?? row.status}
                </span>
                <button
                  disabled={!canTransfer(row) || busy || !toOfferingId}
                  onClick={() => doOne(row.enrollmentId)}
                  className="shrink-0 rounded-lg bg-cyan-700 px-2.5 py-1 text-2xs font-black text-white disabled:opacity-40 hover:bg-cyan-800"
                >
                  🔀 انتقال
                </button>
              </div>
            ))}
            {!roster.length && !busy && (
              <p className="p-4 text-xs text-slate-400 text-center">گروه مبدأ را انتخاب کن تا فهرست دانشجویان بیاید.</p>
            )}
          </div>
        </div>

        {/* ══ RIGHT: انتخاب گروه مقصد + دکمهٔ انتقال ══ */}
        <div className="rounded-2xl border border-cyan-200 bg-white p-4 space-y-3 flex flex-col">
          <p className="text-xs font-black text-cyan-900">🎯 گروه مقصد (همان درس، همین ترم)</p>

          {targets.length > 0 && (
            <label className="text-xs font-bold text-slate-600">
              گروه مقصد
              <select value={toOfferingId ?? ''} onChange={e => setToOfferingId(e.target.value ? Number(e.target.value) : null)} className={sel + ' mt-1'}>
                {targets.map(t => (
                  <option key={t.offeringId} value={t.offeringId}>
                    گ{t.groupNumber} ({fa(t.enrolledCount)}/{fa(t.capacity)}) · {t.professorName}
                  </option>
                ))}
              </select>
            </label>
          )}

          {target && (
            <div className="rounded-xl border border-cyan-100 bg-cyan-50/60 p-3 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-cyan-900">ظرفیت ثبت‌شده</span>
                <span className="font-black">{fa(target.enrolledCount)} از {fa(target.capacity)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-cyan-900">ظرفیت خالی</span>
                <span className={'font-black ' + (target.capacity - target.enrolledCount <= 0 ? 'text-rose-700' : 'text-emerald-700')}>
                  {fa(Math.max(target.capacity - target.enrolledCount, 0))} نفر
                  {target.capacity - target.enrolledCount <= 0 && ' (تکمیل — نیاز به دلیل)'}
                </span>
              </div>
            </div>
          )}
          {!target && targets.length > 0 && <p className="text-2xs text-slate-400">هیچ گروه دیگری برای این درس انتخاب نشده است.</p>}
          {targets.length === 0 && srcOfferingId && !busy && (
            <p className="text-2xs text-slate-400">درس دیگری از این درس در ترم ارائه نشده است (گروه مقصدی برای انتقال نیست).</p>
          )}

          <button
            onClick={doSelected}
            disabled={busy || !selected.length || !toOfferingId}
            className="mt-auto w-full py-3 rounded-xl bg-cyan-700 text-white font-black text-sm disabled:opacity-40 hover:bg-cyan-800"
          >
            {busy ? '…در حال انتقال' : `🔀 انتقال ${fa(selected.length)} دانشجوی انتخاب‌شده`}
          </button>
          <p className="text-3xs text-slate-400 leading-5">
            انتقال، همان ردیف ثبت‌نام را از گروه مبدأ به گروه مقصد می‌برد (offeringId عوض می‌شود)؛
            همهٔ گیت‌ها پیش از انتقال دوباره اجرا می‌شوند. برای تخطی از گیت سخت، «انتقال با دلیل» (دلیل ≥۵ نویسه) در پایین.
          </p>
        </div>
      </div>

      {/* ── نتایج هر دانشجو ── */}
      {results.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="p-3 border-b bg-slate-50 font-black text-sm">نتایج انتقال ({fa(results.length)} دانشجو)</div>
          <div className="divide-y divide-slate-100">
            {results.map(res => {
              const reason = reasonBy[res.enrollmentId] ?? '';
              return (
                <div key={res.enrollmentId} className={'p-3 space-y-2 ' + (res.ok ? 'bg-emerald-50/50' : 'bg-rose-50/50')}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-xs text-slate-800">{res.name}</span>
                    <span className="text-3xs text-slate-400">{res.code}</span>
                    {res.ok
                      ? <span className="rounded-full bg-emerald-200 text-emerald-900 px-2 py-0.5 text-3xs font-black">✅ منتقل شد</span>
                      : <span className="rounded-full bg-rose-200 text-rose-900 px-2 py-0.5 text-3xs font-black">⛔ انتقال نشد</span>}
                  </div>

                  {res.ok && res.warnings.length > 0 && (
                    <ul className="space-y-1">
                      {res.warnings.map((w, i) => (
                        <li key={i} className="text-2xs font-bold text-amber-800">⚠️ {w}</li>
                      ))}
                    </ul>
                  )}

                  {!res.ok && (
                    <>
                      {res.blocks.length > 0 ? (
                        <ul className="space-y-1">
                          {res.blocks.map((b, i) => (
                            <li key={i} className="text-2xs font-bold text-rose-800">❌ {b}</li>
                          ))}
                        </ul>
                      ) : res.error ? (
                        <p className="text-2xs font-bold text-rose-800">❌ {res.error}</p>
                      ) : null}
                      {res.blocks.length > 0 && (
                        <div className="rounded-xl border border-rose-200 bg-white p-2 space-y-2">
                          <p className="text-3xs font-black text-rose-800">🔓 انتقال با دلیل (نادیده‌گرفتن آیین‌نامه):</p>
                          <textarea
                            value={reason}
                            onChange={e => setReasonBy(p => ({ ...p, [res.enrollmentId]: e.target.value }))}
                            placeholder="دلیل (حداقل ۵ نویسه) — در ممیزی ثبت می‌شود…"
                            rows={2}
                            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
                          />
                          <button
                            disabled={busy || reason.trim().length < 5}
                            onClick={() => doOneWithReason(res.enrollmentId)}
                            className="w-full rounded-lg bg-amber-700 py-2 text-white font-black text-xs disabled:opacity-40 hover:bg-amber-800"
                          >
                            🔓 انتقال با دلیل
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {msg && <div className={`rounded-2xl border p-3 text-xs font-black leading-6 ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{msg.text}</div>}
    </div>
  );
}
'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addClassroomExpertAction,
  addOfferingEduExpertAction,
  bulkAddOfferingEduExpertAction,
  bulkSetOfferingEduExpertAction,
  clearAllClassroomExpertsAction,
  clearTermEduExpertAction,
  removeClassroomExpertAction,
  removeOfferingEduExpertAction,
  type EduExpertAssignInit,
} from './actions';

import MobileCardList, { type CardColumn } from '@/components/MobileCardList';

type Row = EduExpertAssignInit['rows'][number];
type Room = EduExpertAssignInit['rooms'][number];

const DAYS = ['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

const SOURCE_LABEL: Record<string, string> = {
  offering: 'استثنای درس',
  classroom: 'از اتاق',
  scope: 'از نقش‌ها',
  none: '—',
};

export default function EduExpertAssignClient({ init }: { init: EduExpertAssignInit }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [termId, setTermId] = useState(
    () => init.terms.find((t) => t.isCurrent)?.id ?? init.terms[init.terms.length - 1]?.id ?? 0,
  );
  /* تبِ اصلی «اتاق‌ها» است چون واحدِ واقعیِ مسئولیت همان است؛ جدولِ درس‌ها
     فقط برای استثناها لازم می‌شود. */
  const [tab, setTab] = useState<'rooms' | 'offerings'>('rooms');

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* ── اتاق‌ها ── */
  const [roomQuery, setRoomQuery] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [selectedRooms, setSelectedRooms] = useState<Set<number>>(new Set());
  const [openRoom, setOpenRoom] = useState<number | null>(null);
  const [roomOverrides, setRoomOverrides] = useState<Map<number, number[]>>(new Map());
  const [bulkExpert, setBulkExpert] = useState<number | null>(null);

  /* ── استثناها ── */
  const [query, setQuery] = useState('');
  const [scheduledOnly, setScheduledOnly] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [offOverrides, setOffOverrides] = useState<Map<number, number[]>>(new Map());

  const nameOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of init.candidates) m.set(c.userId, c.name);
    return m;
  }, [init.candidates]);

  const roomExpertIds = (r: Room): number[] => roomOverrides.get(r.roomId) ?? r.expertIds;
  const offExpertIds = (r: Row): number[] => offOverrides.get(r.offeringId) ?? r.assignedUserIds;

  const rooms = useMemo(() => {
    const q = roomQuery.trim();
    return init.rooms.filter((r) => {
      if (unassignedOnly && (roomOverrides.get(r.roomId) ?? r.expertIds).length) return false;
      if (!q) return true;
      return (
        r.roomName.includes(q) ||
        (r.facultyName ?? r.buildingName ?? '').includes(q) ||
        r.departments.some((d) => d.includes(q)) ||
        (roomOverrides.get(r.roomId) ?? r.expertIds).some((id) => (nameOf.get(id) ?? '').includes(q))
      );
    });
  }, [init.rooms, roomQuery, unassignedOnly, roomOverrides, nameOf]);

  const rows = useMemo(() => {
    const q = query.trim();
    return init.rows.filter((r) => {
      if (scheduledOnly && !r.hasSchedule) return false;
      if (!q) return true;
      return (
        r.courseTitle.includes(q) ||
        String(r.offeringId).includes(q) ||
        r.rooms.some((n) => n.includes(q)) ||
        (offOverrides.get(r.offeringId) ?? r.assignedUserIds).some((id) => (nameOf.get(id) ?? '').includes(q))
      );
    });
  }, [init.rows, query, scheduledOnly, offOverrides, nameOf]);

  function toggleIn(set: Set<number>, id: number): Set<number> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  /* ── عملیاتِ اتاق ── */
  async function addToRoom(r: Room, userId: number) {
    if (!userId) return;
    if (roomExpertIds(r).includes(userId)) {
      setMsg({ ok: false, text: `${nameOf.get(userId) ?? userId} از قبل مسئول این اتاق است.` });
      return;
    }
    setMsg(null);
    const res = await addClassroomExpertAction([r.roomId], userId);
    if (res.ok) {
      setRoomOverrides((p) => new Map(p).set(r.roomId, [...roomExpertIds(r), userId]));
      setMsg({ ok: true, text: 'کارشناس به اتاق اضافه شد.' });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? 'خطا' });
  }

  async function removeFromRoom(r: Room, userId: number) {
    setMsg(null);
    const res = await removeClassroomExpertAction(r.roomId, userId);
    if (res.ok) {
      setRoomOverrides((p) => new Map(p).set(r.roomId, res.userIds ?? roomExpertIds(r).filter((x) => x !== userId)));
      setMsg({ ok: true, text: 'کارشناس از اتاق حذف شد.' });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? 'خطا' });
  }

  async function bulkAddToRooms() {
    const ids = [...selectedRooms];
    if (!ids.length) return setMsg({ ok: false, text: 'هیچ اتاقی انتخاب نشده.' });
    if (!bulkExpert) return setMsg({ ok: false, text: 'اول یک کارشناس انتخاب کنید.' });
    setMsg(null);
    const res = await addClassroomExpertAction(ids, bulkExpert);
    if (res.ok) {
      setRoomOverrides((p) => {
        const next = new Map(p);
        for (const r of init.rooms) {
          if (!ids.includes(r.roomId)) continue;
          const cur = next.get(r.roomId) ?? r.expertIds;
          if (!cur.includes(bulkExpert)) next.set(r.roomId, [...cur, bulkExpert]);
        }
        return next;
      });
      setMsg({ ok: true, text: `${nameOf.get(bulkExpert) ?? ''} به ${res.updated ?? 0} اتاق اضافه شد.` });
      setSelectedRooms(new Set());
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? 'خطا' });
  }

  async function clearRooms() {
    setMsg(null);
    const res = await clearAllClassroomExpertsAction();
    if (res.ok) {
      setRoomOverrides(new Map(init.rooms.map((r) => [r.roomId, []])));
      setMsg({ ok: true, text: `${res.updated ?? 0} تخصیصِ اتاق آزاد شد.` });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? 'خطا' });
  }

  /* ── عملیاتِ استثنا ── */
  async function addToOffering(r: Row, userId: number) {
    if (!userId) return;
    setMsg(null);
    const res = await addOfferingEduExpertAction(r.offeringId, userId);
    if (res.ok) {
      setOffOverrides((p) => new Map(p).set(r.offeringId, [...offExpertIds(r), userId]));
      setMsg({ ok: true, text: 'استثنا ثبت شد.' });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? 'خطا' });
  }

  async function removeFromOffering(r: Row, userId: number) {
    setMsg(null);
    const res = await removeOfferingEduExpertAction(r.offeringId, userId);
    if (res.ok) {
      setOffOverrides((p) => new Map(p).set(r.offeringId, res.userIds ?? offExpertIds(r).filter((x) => x !== userId)));
      setMsg({ ok: true, text: 'استثنا حذف شد.' });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? 'خطا' });
  }

  async function doBulkOffering(mode: 'replace' | 'add') {
    const picked = rows.filter((r) => selected.has(r.offeringId));
    if (!picked.length) return setMsg({ ok: false, text: 'هیچ درسی انتخاب نشده.' });
    if (mode === 'add' && !bulkExpert) return setMsg({ ok: false, text: 'اول یک کارشناس انتخاب کنید.' });
    setMsg(null);
    const ids = picked.map((r) => r.offeringId);

    if (mode === 'add') {
      const res = await bulkAddOfferingEduExpertAction(ids, bulkExpert as number);
      if (res.ok) {
        setMsg({ ok: true, text: `${res.updated ?? 0} درس به فهرست اضافه شد.` });
        setSelected(new Set());
        router.refresh();
      } else setMsg({ ok: false, text: res.error ?? 'خطا' });
      return;
    }
    const res = await bulkSetOfferingEduExpertAction(ids, bulkExpert);
    if (res.ok) {
      setMsg({ ok: true, text: `${res.updated ?? 0} درس بازنویسی شد.` });
      setSelected(new Set());
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? 'خطا' });
  }

  async function clearTerm() {
    if (!termId) return;
    setMsg(null);
    const res = await clearTermEduExpertAction(termId);
    if (res.ok) {
      setOffOverrides(new Map(init.rows.map((r) => [r.offeringId, []])));
      setMsg({ ok: true, text: `${res.updated ?? 0} استثنا آزاد شد.` });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? 'خطا' });
  }

  /* ── شمارنده‌ها ── */
  const roomAssigned = init.rooms.filter((r) => r.expertIds.length > 0).length;
  const roomUnassigned = init.rooms.length - roomAssigned;
  const roomMulti = init.rooms.filter((r) => r.expertIds.length > 1).length;
  const totalSessions = init.rooms.reduce((s, r) => s + r.sessionCount, 0);
  const offExplicit = init.rows.filter((r) => r.source === 'offering').length;
  const offFromRoom = init.rows.filter((r) => r.source === 'classroom').length;
  const offFromScope = init.rows.filter((r) => r.source === 'scope').length;
  const offNone = init.rows.filter((r) => r.source == null).length;

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block mb-1 font-bold">ترم</span>
            <select
              className="input"
              value={termId}
              onChange={(e) => {
                setTermId(Number(e.target.value));
                startTransition(() => {
                  const p = new URLSearchParams();
                  p.set('term', e.target.value);
                  router.push(`?${p.toString()}`);
                });
              }}
            >
              {init.terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                  {t.isCurrent ? ' (جاری)' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="flex-1" />

          <label className="text-sm">
            <span className="block mb-1 font-bold">کارشناس</span>
            <select
              className="input"
              value={bulkExpert ?? ''}
              onChange={(e) => setBulkExpert(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— انتخاب کارشناس —</option>
              {init.candidates.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
          <button className={tab === 'rooms' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('rooms')}>
            اتاق‌ها ({init.rooms.length})
          </button>
          <button className={tab === 'offerings' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('offerings')}>
            استثناهای درس ({offExplicit})
          </button>
        </div>

        {msg && <div className={`text-sm font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</div>}
      </div>

      {tab === 'rooms' && (
        <>
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm flex-1 min-w-[220px]">
                <span className="block mb-1 font-bold">جستجوی اتاق</span>
                <input
                  className="input"
                  value={roomQuery}
                  onChange={(e) => setRoomQuery(e.target.value)}
                  placeholder="نام اتاق، ساختمان، گروه یا نام کارشناس"
                />
              </label>
              <button
                className="btn btn-primary"
                onClick={bulkAddToRooms}
                disabled={pending || !selectedRooms.size || !bulkExpert}
              >
                ＋ افزودن به {selectedRooms.size} اتاق
              </button>
              <button className="btn" onClick={clearRooms} disabled={pending}>
                آزاد کردن همهٔ اتاق‌ها
              </button>
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-slate-600">
              <span>اتاق‌های دارای سانس: <b>{init.rooms.length}</b></span>
              <span className="text-slate-800">کل سانس‌های هفته: <b>{totalSessions}</b></span>
              <span className="text-indigo-700">دارای کارشناس: <b>{roomAssigned}</b></span>
              <span className="text-fuchsia-700">چند‌کارشناسه: <b>{roomMulti}</b></span>
              <span className="text-amber-700">بدون کارشناس: <b>{roomUnassigned}</b></span>
              <label className="flex items-center gap-1.5 font-bold text-slate-800">
                <input type="checkbox" checked={unassignedOnly} onChange={(e) => setUnassignedOnly(e.target.checked)} />
                فقط اتاق‌های بدون کارشناس
              </label>
            </div>

            <p className="text-[11px] leading-5 text-slate-600">
              کارشناس را به <b>اتاق</b> بدهید، نه به درس. هر درسی که در آن اتاق سانس دارد خودکار مالِ همان کارشناس می‌شود و با
              جابه‌جاییِ برنامه هم خودش را به‌روز می‌کند. برای حالتِ خاص، تبِ «استثناهای درس».
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rooms.map((r) => {
              const ids = roomExpertIds(r);
              const open = openRoom === r.roomId;
              const byDay = new Map<number, Room['sessions']>();
              for (const s of r.sessions) {
                const d = s.dayOfWeek ?? 0;
                const list = byDay.get(d) ?? [];
                list.push(s);
                byDay.set(d, list);
              }
              const days = [...byDay.keys()].sort((a, b) => a - b);
              return (
                <div key={r.roomId} className="card p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedRooms.has(r.roomId)}
                      onChange={() => setSelectedRooms((p) => toggleIn(p, r.roomId))}
                      aria-label={`انتخاب ${r.roomName}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-sm">{r.roomName}</p>
                      <p className="text-[11px] text-slate-500">
                        {[r.facultyName ?? r.buildingName, r.floor ? `طبقه ${r.floor}` : null].filter(Boolean).join(' · ') || 'بدون دانشکده'}
                        {' · '}
                        {r.sessionCount} سانس · {r.offeringCount} درس
                      </p>
                    </div>
                  </div>

                  {!!r.departments.length && (
                    <p className="text-[11px] text-slate-500">گروه‌ها: {r.departments.join(' · ')}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-1">
                    {ids.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-800"
                      >
                        {nameOf.get(id) ?? `#${id}`}
                        <button
                          type="button"
                          onClick={() => removeFromRoom(r, id)}
                          disabled={pending}
                          className="text-rose-600 hover:text-rose-800 font-black"
                          aria-label={`حذف ${nameOf.get(id) ?? id} از ${r.roomName}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {!ids.length && <span className="text-[11px] text-amber-700">بدون کارشناس</span>}
                  </div>

                  {/* انتخاب‌گرِ کارشناس در سطرِ جداگانه و با عرضِ کامل — نام‌ها
                      بلندند («… — کنترل‌کنندهٔ حضور») و در سلکتِ ۷رِمی بریده می‌شوند. */}
                  <select
                    dir="rtl"
                    className="input w-full text-[11px] py-1 h-8"
                    value=""
                    disabled={pending}
                    onChange={(e) => {
                      const v = e.target.value;
                      e.target.value = '';
                      if (v) addToRoom(r, Number(v));
                    }}
                  >
                    <option value="">＋ افزودن کارشناس / کنترل‌کننده…</option>
                    {init.candidates
                      .filter((c) => !ids.includes(c.userId))
                      .map((c) => (
                        <option key={c.userId} value={c.userId}>
                          {c.name}
                        </option>
                      ))}
                  </select>

                  <button
                    className="text-[11px] font-bold text-indigo-700 underline"
                    onClick={() => setOpenRoom(open ? null : r.roomId)}
                  >
                    {open ? 'بستنِ برنامهٔ هفتگی' : `برنامهٔ هفتگی (${r.sessionCount} سانس)`}
                  </button>

                  {open && (
                    <div className="space-y-2 border-t border-slate-200 pt-2">
                      {days.map((d) => (
                        <div key={d}>
                          <p className="text-[11px] font-black text-slate-700 mb-1">{DAYS[d] ?? d}</p>
                          <div className="space-y-1">
                            {(byDay.get(d) ?? []).map((s) => (
                              <div key={s.scheduleId} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1">
                                <span className="text-[11px] text-slate-500 w-16 shrink-0">
                                  {s.start}–{s.end}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-bold truncate">{s.courseTitle}</p>
                                  <p className="text-[10px] text-slate-500 truncate">
                                    {s.professorName} · گروه {s.groupNumber}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {!days.length && <p className="text-[11px] text-slate-400">سانسی ثبت نشده.</p>}
                    </div>
                  )}
                </div>
              );
            })}
            {!rooms.length && (
              <div className="card p-6 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">
                اتاقی با این مشخصات پیدا نشد.
                {init.rooms.length === 0 && (
                  <span className="block mt-1 text-xs">این ترم هنوز هیچ سانس/اتاقی ثبت نشده است.</span>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'offerings' && (
        <>
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm flex-1 min-w-[220px]">
                <span className="block mb-1 font-bold">جستجوی درس</span>
                <input
                  className="input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="نام درس، شمارهٔ ارائه، اتاق یا نام کارشناس"
                />
              </label>
              <button
                className="btn btn-primary"
                onClick={() => doBulkOffering('add')}
                disabled={pending || !selected.size || !bulkExpert}
              >
                ＋ افزودن به {selected.size} درس
              </button>
              <button className="btn" onClick={() => doBulkOffering('replace')} disabled={pending || !selected.size}>
                جایگزینی روی {selected.size} درس
              </button>
              <button className="btn" onClick={clearTerm} disabled={pending}>
                آزاد کردن استثناهای ترم
              </button>
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-slate-600">
              <span>کل درس‌های ترم: <b>{init.rows.length}</b></span>
              <span className="text-indigo-700">استثنای درس: <b>{offExplicit}</b></span>
              <span className="text-sky-700">از اتاق: <b>{offFromRoom}</b></span>
              <span className="text-emerald-700">از نقش‌ها: <b>{offFromScope}</b></span>
              <span className="text-amber-700">بدون کارشناس: <b>{offNone}</b></span>
              <label className="flex items-center gap-1.5 font-bold text-slate-800">
                <input type="checkbox" checked={scheduledOnly} onChange={(e) => setScheduledOnly(e.target.checked)} />
                فقط درس‌های دارای برنامه (اتاق)
              </label>
            </div>

            <p className="text-[11px] leading-5 text-slate-600">
              این تب فقط برای <b>استثنا</b> است: درسی که باید کارشناسِ خاصی بگیرد، مستقل از اتاقش. برای کارِ روزمره از تبِ
              «اتاق‌ها» استفاده کنید.
            </p>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm rt hidden md:table">
              <thead className="bg-slate-900 text-white">
                <tr>
                  <th className="p-2 w-8">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((r) => selected.has(r.offeringId))}
                      onChange={() =>
                        setSelected((p) => {
                          const all = rows.length > 0 && rows.every((r) => selected.has(r.offeringId));
                          const next = new Set(p);
                          rows.forEach((r) => (all ? next.delete(r.offeringId) : next.add(r.offeringId)));
                          return next;
                        })
                      }
                      aria-label="انتخاب همه"
                    />
                  </th>
                  <th className="p-2 text-right">#</th>
                  <th className="p-2 text-right">درس</th>
                  <th className="p-2 text-right">گروه</th>
                  <th className="p-2 text-right">کلاس (اتاق)</th>
                  <th className="p-2 text-right">کارشناسان</th>
                  <th className="p-2 text-right">منبع</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ids = offExpertIds(r);
                  return (
                    <tr key={r.offeringId} className="border-b border-slate-200 hover:bg-slate-50 align-top">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selected.has(r.offeringId)}
                          onChange={() => setSelected((p) => toggleIn(p, r.offeringId))}
                          aria-label={`انتخاب ${r.courseTitle}`}
                        />
                      </td>
                      <td className="p-2 text-slate-500">{r.offeringId}</td>
                      <td className="p-2 font-bold">{r.courseTitle}</td>
                      <td className="p-2">{r.groupNumber}</td>
                      <td className="p-2 font-bold text-slate-800">
                        {r.rooms.length ? r.rooms.join(' · ') : <span className="text-slate-400 font-normal">بدون اتاق</span>}
                      </td>
                      <td className="p-2 min-w-[240px]">
                        <div className="flex flex-wrap items-center gap-1">
                          {ids.map((id) => (
                            <span
                              key={id}
                              className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-800"
                            >
                              {nameOf.get(id) ?? `#${id}`}
                              <button
                                type="button"
                                onClick={() => removeFromOffering(r, id)}
                                disabled={pending}
                                className="text-rose-600 hover:text-rose-800 font-black"
                                aria-label={`حذف ${nameOf.get(id) ?? id}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          {!ids.length && (
                            <span className="text-[11px] text-slate-400">
                              {r.resolvedUserId
                                ? `${SOURCE_LABEL[r.source ?? 'none']}: ${nameOf.get(r.resolvedUserId) ?? r.resolvedUserId}`
                                : 'بدون کارشناس'}
                            </span>
                          )}
                          <select
                            dir="rtl"
                            className="input text-[11px] py-0.5 h-7 min-w-[9rem]"
                            value=""
                            disabled={pending}
                            onChange={(e) => {
                              const v = e.target.value;
                              e.target.value = '';
                              if (v) addToOffering(r, Number(v));
                            }}
                          >
                            <option value="">＋ افزودن کارشناس…</option>
                            {init.candidates
                              .filter((c) => !ids.includes(c.userId))
                              .map((c) => (
                                <option key={c.userId} value={c.userId}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                        </div>
                      </td>
                      <td className="p-2">
                        <span
                          className={
                            r.source === 'offering'
                              ? 'text-indigo-700 font-bold'
                              : r.source === 'classroom'
                                ? 'text-sky-700'
                                : r.source === 'scope'
                                  ? 'text-emerald-700'
                                  : 'text-slate-400'
                          }
                        >
                          {SOURCE_LABEL[r.source ?? 'none']}
                          {ids.length > 1 ? ` (${ids.length} نفر)` : ''}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-500">
                      درسی یافت نشد.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <MobileCardList
              rows={rows}
              columns={[
                { key: 'courseTitle', label: 'درس', title: true },
                { key: 'offeringId', label: '#', subtitle: true, render: (r) => r.offeringId },
                { key: 'groupNumber', label: 'گروه', render: (r) => r.groupNumber },
                {
                  key: 'rooms',
                  label: 'کلاس (اتاق)',
                  render: (r) => (r.rooms.length ? r.rooms.join(' · ') : 'بدون اتاق'),
                },
                {
                  key: 'source',
                  label: 'منبع',
                  render: (r) => {
                    const n = offExpertIds(r).length;
                    return (
                      <span
                        className={
                          r.source === 'offering'
                            ? 'text-indigo-700 font-bold'
                            : r.source === 'classroom'
                              ? 'text-sky-700'
                              : r.source === 'scope'
                                ? 'text-emerald-700'
                                : 'text-slate-400'
                        }
                      >
                        {SOURCE_LABEL[r.source ?? 'none']}
                        {n > 1 ? ` (${n} نفر)` : ''}
                      </span>
                    );
                  },
                },
              ]}
              getKey={(r) => r.offeringId}
              renderActions={(r) => {
                const ids = offExpertIds(r);
                return (
                  <div className="flex flex-wrap items-center gap-1">
                    {ids.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-800"
                      >
                        {nameOf.get(id) ?? `#${id}`}
                        <button
                          type="button"
                          onClick={() => removeFromOffering(r, id)}
                          disabled={pending}
                          className="text-rose-600 hover:text-rose-800 font-black"
                          aria-label={`حذف ${nameOf.get(id) ?? id}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {!ids.length && (
                      <span className="text-[11px] text-slate-400">
                        {r.resolvedUserId
                          ? `${SOURCE_LABEL[r.source ?? 'none']}: ${nameOf.get(r.resolvedUserId) ?? r.resolvedUserId}`
                          : 'بدون کارشناس'}
                      </span>
                    )}
                    <select
                      dir="rtl"
                      className="input text-[11px] py-0.5 h-7 min-w-[9rem]"
                      value=""
                      disabled={pending}
                      onChange={(e) => {
                        const v = e.target.value;
                        e.target.value = '';
                        if (v) addToOffering(r, Number(v));
                      }}
                    >
                      <option value="">＋ افزودن کارشناس…</option>
                      {init.candidates
                        .filter((c) => !ids.includes(c.userId))
                        .map((c) => (
                          <option key={c.userId} value={c.userId}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>
                );
              }}
              empty={<div className="p-6 text-center text-sm text-slate-500">درسی یافت نشد.</div>}
            />
          </div>
        </>
      )}

      <div className="card p-4 text-xs leading-6 text-slate-600 space-y-1">
        <p><b>زنجیرهٔ تصمیم (از دقیق به کلی):</b></p>
        <p>۱. <b>استثنای درس</b> — اگر برای خودِ درس کارشناس تعیین شود، همان برنده است.</p>
        <p>۲. <b>کارشناسِ اتاق</b> — هر درسی که در آن اتاق سانس دارد، خودکار مالِ کارشناسِ اتاق است.</p>
        <p>۳. <b>نقش‌ها</b> — اگر هیچ‌کدام نبود، از تخصیص گروه/دانشکده/دانشگاه پایین می‌آید.</p>
        <p>۴. یک اتاق و یک درس می‌توانند چند کارشناس داشته باشند؛ با × هر کدام را جدا حذف کنید.</p>
      </div>
    </div>
  );
}

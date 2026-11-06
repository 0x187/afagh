'use client';

import { useMemo, useState, useTransition } from 'react';
import { recordAttendanceFromConsole } from '@/app/p/[code]/actions';
import { mergeBadgeText } from '@/lib/merged-class-core';

const faNum = (v: number) => String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export interface ControlRowView {
  roomId: number;
  roomName: string;
  buildingName: string | null;
  sessionId: number;
  startTime: string;
  endTime: string;
  courseTitle: string;
  courseCode: string;
  groupNumber: string;
  professorName: string;
  professorStaffCode: string | null;
  facultyName: string | null;
  /** BEFORE | OPEN | CLOSED */
  state: string;
  windowFrom: string;
  windowTo: string;
  recorded: boolean;
  recordedAtLabel: string | null;
  recordedBy: string | null;
  recordedMethod: string | null;
  /** این ردیف یک «کلاس ادغامی» است — چند عرضه در یک جلسهٔ فیزیکی */
  merged: boolean;
  /** چند عرضه در این کلاس ادغام شده‌اند */
  memberCount: number;
  /** عناوینِ درس‌های عضو — برای نمایشِ کوچکِ زیرِ عنوان */
  memberTitles: string;
  /** همهٔ شناسهٔ جلسه‌های عضو (ثبت روی همهٔ این‌ها اعمال می‌شود) */
  memberSessionIds: number[];
}

const ERR_FA: Record<string, string> = {
  nosession: 'جلسهٔ معتبری یافت نشد.',
  window: 'اکنون خارج از بازهٔ مجاز ثبت است.',
  badroom: 'اتاق معتبر نیست.',
  wronguni: 'این اتاق به دانشگاه شما تعلق ندارد.',
  notyours: 'شما مجاز به ثبت حضور این اتاق نیستید.',
  profblocked: 'تنظیم سامانه: ثبت فقط توسط کنترل‌کننده انجام می‌شود.',
  ctrlblocked: 'تنظیم سامانه: ثبت فقط توسط خودِ استاد انجام می‌شود.',
  notstaff: 'برای حساب شما پروندهٔ پرسنلی ثبت نشده است.',
  notloggedin: 'نشست شما منقضی شده؛ دوباره وارد شوید.',
  noprof: 'برای این جلسه استادی ثبت نشده است.',
};

type Filter = 'all' | 'pending' | 'done';

/**
 * کارتابلِ «حضور و غیاب امروز» برای کنترل‌کنندهٔ حضور.
 *
 * چرا Client: ثبت باید بدون پرشِ صفحه انجام شود؛ کنترل‌کننده پشتِ سرِ هم چند
 * اتاق را می‌گردد و هر بار رفرشِ کامل، وقتِ بین دو کلاس را می‌خورد.
 * اعتبارسنجیِ نهایی همچنان در Server Action است (`recordAttendanceFromConsole`).
 */
export default function AttendanceControlClient({
  rows,
  minuteNow,
  date,
}: {
  rows: ControlRowView[];
  minuteNow: number;
  date?: string;
}) {
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>('all');
  const [filterFaculty, setFilterFaculty] = useState('');
  const [filterRoom, setFilterRoom] = useState('');
  const [filterProfCode, setFilterProfCode] = useState('');
  const [filterCourseCode, setFilterCourseCode] = useState('');
  const [layout, setLayout] = useState<'row' | 'col'>('row');
  const [q, setQ] = useState('');

  const isDone = (r: ControlRowView) => done[r.sessionId] ?? r.recorded;

  const view = useMemo(() => {
    const needle = q.trim();
    return rows.filter((r) => {
      if (filter === 'pending' && isDone(r)) return false;
      if (filter === 'done' && !isDone(r)) return false;
      if (filterFaculty && r.facultyName !== filterFaculty) return false;
      if (filterRoom && r.roomName !== filterRoom) return false;
      if (filterProfCode && !(r.professorStaffCode ?? '').includes(filterProfCode)) return false;
      if (filterCourseCode && !r.courseCode.includes(filterCourseCode)) return false;
      if (needle) {
        const hay = `${r.roomName} ${r.courseTitle} ${r.courseCode} ${r.professorName} ${r.memberTitles}`;
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, filter, q, done, filterFaculty, filterRoom, filterProfCode, filterCourseCode]);

  const grouped = useMemo(() => {
    const m = new Map<number, ControlRowView[]>();
    for (const r of view) {
      const list = m.get(r.roomId) ?? [];
      list.push(r);
      m.set(r.roomId, list);
    }
    return [...m.entries()];
  }, [view]);

  const total = rows.length;
  const doneCount = rows.filter(isDone).length;

  function record(r: ControlRowView) {
    setErr(null);
    setNote(null);
    setPendingId(r.sessionId);
    startTransition(async () => {
      const res = await recordAttendanceFromConsole({ roomId: r.roomId, sessionId: r.sessionId, date });
      setPendingId(null);
      if (res.ok) {
        setDone((d) => ({ ...d, [r.sessionId]: true }));
        if (res.merged) {
          setNote(`این کلاس ${mergeBadgeText(r.memberCount)} بود؛ حضور روی همهٔ ${faNum(res.recordedCount ?? r.memberCount)} جلسه ثبت شد.`);
        }
      } else {
        setErr(ERR_FA[res.error ?? ''] ?? 'ثبت حضور ممکن نشد.');
      }
    });
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-black text-slate-900">حضور و غیاب امروز</div>
          <span
            className={`text-3xs font-black rounded-full px-2 py-0.5 ${
              total > 0 && doneCount === total
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {faNum(doneCount)} از {faNum(total)} کلاس ثبت شد
          </span>
        </div>

        <div className="text-3xs font-bold text-slate-500 leading-6">
          کلاس‌های ادغامی (چند عرضه در یک جلسه با یک استاد) فقط یک ردیف با نشان 🔗 دیده می‌شوند و ثبتِ
          آن روی همهٔ عرضه‌ها اعمال می‌شود.
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['all', 'همه'],
              ['pending', 'ثبت‌نشده'],
              ['done', 'ثبت‌شده'],
            ] as const
          ).map(([v, t]) => (
            <button
              key={v}
              type="button"
              onClick={() => setFilter(v)}
              className={`rounded-xl px-3 py-1.5 text-2xs font-black ${
                filter === v ? 'bg-indigo-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {t}
            </button>
          ))}
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => setLayout('row')} className={`rounded-lg px-3 py-1 text-3xs font-black ${layout === 'row' ? 'bg-white text-indigo-800 shadow' : 'text-slate-600'}`}>ردیفی</button>
            <button type="button" onClick={() => setLayout('col')} className={`rounded-lg px-3 py-1 text-3xs font-black ${layout === 'col' ? 'bg-white text-indigo-800 shadow' : 'text-slate-600'}`}>ستونی</button>
          </div>
          <select onChange={(e) => { if (e.target.value !== '') window.location.href = '/admin/attendance-control?day=' + e.target.value; }} className="rounded-xl border border-slate-300 px-3 py-1.5 text-2xs font-bold">
            <option value="">همهٔ روزها</option>
            {['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنج‌شنبه','جمعه'].map((d, i) => (
              <option key={i} value={i}>{d}</option>
            ))}
          </select>
          <select value={filterFaculty} onChange={(e) => setFilterFaculty(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-1.5 text-2xs font-bold">
            <option value="">همهٔ دانشکده‌ها</option>
            {[...new Set(rows.map((r) => r.facultyName).filter(Boolean))].map((f) => (
              <option key={f as string} value={f as string}>{f as string}</option>
            ))}
          </select>
          <select value={filterRoom} onChange={(e) => setFilterRoom(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-1.5 text-2xs font-bold">
            <option value="">همهٔ اتاق‌ها</option>
            {[...new Set(rows.filter((r) => !filterFaculty || r.facultyName === filterFaculty).map((r) => r.roomName))].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <input value={filterProfCode} onChange={(e) => setFilterProfCode(e.target.value)} placeholder="کد استاد" className="w-24 rounded-xl border border-slate-300 px-3 py-1.5 text-2xs font-bold" dir="ltr" />
          <input value={filterCourseCode} onChange={(e) => setFilterCourseCode(e.target.value)} placeholder="کد درس" className="w-24 rounded-xl border border-slate-300 px-3 py-1.5 text-2xs font-bold" dir="ltr" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جست‌وجوی اتاق / درس / استاد…"
            className="flex-1 min-w-[180px] rounded-xl border border-slate-300 px-3 py-1.5 text-2xs font-bold"
          />
        </div>

        {err ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-2xs font-bold text-rose-800">
            {err}
          </div>
        ) : null}

        {note ? (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-2xs font-bold text-indigo-900">
            🔗 {note}
          </div>
        ) : null}
      </div>

      {grouped.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-xs font-bold text-slate-500">
          {rows.length === 0
            ? 'امروز برای اتاق‌های تحت مسئولیت شما جلسه‌ای ثبت نشده است.'
            : 'با این فیلتر چیزی پیدا نشد.'}
        </div>
      ) : (
        grouped.map(([roomId, list]) => {
          const roomDone = list.filter(isDone).length;
          return (
            <div key={roomId} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between gap-2 bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                <div className="text-xs font-black text-slate-800">
                  🚪 {list[0].roomName}
                  {list[0].buildingName ? <span className="text-slate-400 font-bold"> — {list[0].buildingName}</span> : null}
                </div>
                <div className="text-3xs font-bold text-slate-500">
                  {faNum(roomDone)} از {faNum(list.length)} کلاس ثبت شد
                </div>
              </div>

              <div className={layout === 'col' ? 'grid grid-cols-1 sm:grid-cols-2 gap-2 p-2' : 'divide-y divide-slate-100'}>
                {list.map((r) => {
                  const ok = isDone(r);
                  const busy = pendingId === r.sessionId;
                  return (
                    <div key={r.sessionId} className={`px-4 py-2.5 flex items-center gap-3 ${ok ? 'bg-emerald-50/40' : ''}`}>
                      <div className="text-3xs font-bold text-slate-500 w-14 shrink-0 leading-4" dir="ltr">
                        {r.startTime}
                        <br />
                        {r.endTime}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-2xs font-black text-slate-800 truncate">{r.courseTitle}</span>
                          {r.merged ? (
                            <span
                              title={`این کلاس از ${faNum(r.memberCount)} عرضه تشکیل شده: ${r.memberTitles}`}
                              className="shrink-0 text-[9px] font-black rounded-full px-1.5 py-0.5 bg-violet-100 text-violet-800 border border-violet-200"
                            >
                              🔗 {mergeBadgeText(r.memberCount)}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-3xs font-bold text-slate-500 truncate">
                          {r.professorName} · گروه {r.groupNumber} · {r.courseCode}
                        </div>
                        {r.merged && r.memberTitles ? (
                          <div className="text-[9px] font-bold text-violet-700/80 truncate" title={r.memberTitles}>
                            {r.memberTitles}
                          </div>
                        ) : null}
                      </div>

                      {ok ? (
                        <div className="text-left shrink-0">
                          <div className="text-[9px] font-black text-emerald-800 bg-emerald-100 border border-emerald-200 rounded-lg px-2 py-1">
                            ثبت شد
                          </div>
                          {r.recordedAtLabel || done[r.sessionId] ? (
                            <div className="text-[8px] font-bold text-emerald-700 mt-0.5">
                              {r.recordedAtLabel ?? 'همین حالا'}
                              {r.recordedBy ? ` · ${r.recordedBy}` : ''}
                            </div>
                          ) : null}
                        </div>
                      ) : r.state === 'OPEN' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => record(r)}
                          className="shrink-0 rounded-lg bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white text-3xs font-black px-3 py-1.5 shadow-sm"
                        >
                          {busy ? '…' : 'ثبت حضور'}
                        </button>
                      ) : r.state === 'BEFORE' ? (
                        <div className="text-left shrink-0">
                          <div className="text-[9px] font-bold text-slate-400">هنوز باز نشده</div>
                          <div className="text-[8px] font-bold text-slate-400" dir="ltr">
                            {r.windowFrom}–{r.windowTo}
                          </div>
                        </div>
                      ) : (
                        <div className="text-[9px] font-bold text-slate-400 shrink-0">گذشته</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      <div className="text-[9px] font-bold text-slate-400 text-center">
        بازهٔ مجازِ هر جلسه: از ۳۰ دقیقه پیش از شروع تا ۲۰ دقیقه پس از پایان · زمان فعلی:{' '}
        {String(Math.floor(minuteNow / 60)).padStart(2, '0')}:{String(minuteNow % 60).padStart(2, '0')}
      </div>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { toggleSessionFlagAction } from './actions';

import MobileCardList, { type CardColumn } from '@/components/MobileCardList';

export interface OfferingRow {
  id: number;
  code: string;
  title: string;
  groupNumber: number;
  professorName: string | null;
  staffCode: string | null;
  sessionCount: number;
  holidayCount: number;
}

export interface SessionRow {
  id: number;
  sessionNo: number | null;
  sessionDate: string;
  startTime: string;
  endTime: string;
  status: string;
  isMakeUp: number | null;
  isHoliday: number;
  isExtraSession: number;
  isActive: number;
  createdAt: string | null;
  professorViewedAt: string | null;
  updatedAt: string | null;
  roomName: string | null;
  topic: string | null;
}

const faNum = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

const jdate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return faNum(d.toLocaleDateString('fa-IR'));
};

const STATUS_FA: Record<string, string> = {
  SCHEDULED: 'برنامه‌ریزی‌شده',
  HELD: 'برگزار‌شده',
  ABSENT: 'غیبت استاد',
  CANCELLED: 'لغو‌شده',
};

/** مدیریت جلسات درس — انتخاب درس، جدول جلسات با پرچم‌ها و مهرهای زمانی */
export default function ClassSessionsClient({
  terms, termId, termCode, termTitle, query, offerings, selectedOfferingId, sessions,
}: {
  terms: { id: number; title: string; termCode: string; isActive: boolean }[];
  termId: number;
  termCode: string;
  termTitle: string;
  query: string;
  offerings: OfferingRow[];
  selectedOfferingId: number;
  sessions: SessionRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [flags, setFlags] = useState<Record<number, Partial<Record<'isHoliday' | 'isExtraSession' | 'isActive', boolean>>>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState(query);

  const selected = offerings.find(o => o.id === selectedOfferingId) ?? null;
  const flagOf = (s: SessionRow, k: 'isHoliday' | 'isExtraSession' | 'isActive') => flags[s.id]?.[k] ?? Number(s[k]) === 1;

  const go = (params: Record<string, string | number>) => {
    const sp = new URLSearchParams({ term: String(termId) });
    if (selectedOfferingId) sp.set('offeringId', String(selectedOfferingId));
    if (q.trim()) sp.set('q', q.trim());
    for (const [k, v] of Object.entries(params)) sp.set(k, String(v));
    window.location.href = `/admin/class-sessions?${sp.toString()}`;
  };

  const toggle = (s: SessionRow, k: 'isHoliday' | 'isExtraSession' | 'isActive') => {
    startTransition(async () => {
      const res = await toggleSessionFlagAction({ sessionId: s.id, flag: k });
      if (res.ok) {
        setFlags(prev => ({ ...prev, [s.id]: { ...prev[s.id], [k]: res.value === 1 } }));
        const label = k === 'isHoliday' ? 'تعطیل' : k === 'isExtraSession' ? 'فوق‌برنامه' : 'فعال';
        setMsg({ ok: true, text: `جلسهٔ ${faNum(s.sessionNo)} — «${label}» ${res.value === 1 ? 'فعال' : 'غیرفعال'} شد.` });
      } else {
        setMsg({ ok: false, text: res.error ?? 'تغییر پرچم ممکن نشد.' });
      }
    });
  };

  const Chip = ({ on, label, onClick, tone }: { on: boolean; label: string; onClick: () => void; tone: string }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`rounded-full border px-2 py-0.5 text-3xs font-black transition disabled:opacity-40 ${
        on ? tone : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'}`}
    >
      {on ? '✓' : '○'} {label}
    </button>
  );

  return (
    <div className="space-y-4" dir="rtl">
      <div className="overflow-hidden rounded-2xl border border-slate-800/20 bg-gradient-to-l from-slate-900 via-slate-800 to-indigo-900 p-4 text-white shadow-lg">
        <h1 className="text-lg font-black">📅 مدیریت جلسات درس</h1>
        <p className="mt-1 text-xs text-slate-200/90">
          انتخاب نیمسال و درس → جدول کامل جلسات با پرچم‌های «تعطیل / فوق‌برنامه / فعال»، مهرهای زمانی ممیزی،
          و میان‌بر «لیست دانشجویان» برای حضور و غیاب همان درس.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-300 bg-white p-3">
        <label className="text-2xs font-bold text-slate-700">
          نیمسال
          <select
            value={termId}
            onChange={e => go({ term: e.target.value, offeringId: '' })}
            className="mt-1 block min-w-[220px] rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          >
            {terms.map(t => (
              <option key={t.id} value={t.id}>{t.title} ({t.termCode}){t.isActive ? ' — نیمسال فعال' : ''}</option>
            ))}
          </select>
        </label>
        <label className="text-2xs font-bold text-slate-700">
          جست‌وجو (کد/نام درس یا استاد)
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') go({ q: q, offeringId: '' }); }}
            className="mt-1 block w-56 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          />
        </label>
        <button
          type="button"
          onClick={() => go({ q: q, offeringId: '' })}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-black text-white hover:bg-slate-900"
        >
          جست‌وجو
        </button>
        <label className="text-2xs font-bold text-slate-700">
          درس
          <select
            value={selectedOfferingId}
            onChange={e => go({ offeringId: e.target.value })}
            className="mt-1 block min-w-[280px] rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          >
            {offerings.length === 0 && <option value="">درسی یافت نشد</option>}
            {offerings.map(o => (
              <option key={o.id} value={o.id}>
                {o.code} — {o.title} (گروه {faNum(o.groupNumber)}) · {o.professorName ?? 'بدون استاد'} · {faNum(o.sessionCount)} جلسه
              </option>
            ))}
          </select>
        </label>
        <span className="mr-auto text-2xs text-slate-500">
          {faNum(offerings.length)} درس · {termTitle}
        </span>
      </div>

      {msg && (
        <div className={`rounded-lg border px-3 py-2 text-xs font-bold ${msg.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-rose-300 bg-rose-50 text-rose-800'}`}>
          {msg.text}
        </div>
      )}

      {selected && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white p-3 text-xs">
          <div className="font-bold text-slate-800">
            {selected.code} — {selected.title}
            <span className="mr-2 font-normal text-slate-500">
              گروه {faNum(selected.groupNumber)} · استاد {selected.professorName ?? '—'}
              {selected.staffCode ? ` (${selected.staffCode})` : ''} · {faNum(selected.sessionCount)} جلسه
              {selected.holidayCount > 0 ? ` · ${faNum(selected.holidayCount)} تعطیل` : ''}
            </span>
          </div>
          <a
            href={`/admin/reports?kind=attendance-list&term=${encodeURIComponent(termCode)}&courseCode=${encodeURIComponent(selected.code)}`}
            className="rounded-lg bg-indigo-700 px-3 py-1.5 text-2xs font-black text-white hover:bg-indigo-800"
          >
            👥 لیست دانشجویان (حضور و غیاب)
          </a>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
        <table className="w-full text-xs rt hidden md:table">
          <thead>
            <tr className="bg-slate-900 text-center text-2xs text-white">
              <th className="p-2.5">جلسه</th>
              <th className="p-2.5">تاریخ</th>
              <th className="p-2.5">ساعت</th>
              <th className="p-2.5">محل تشکیل</th>
              <th className="p-2.5">وضعیت</th>
              <th className="p-2.5">جبرانی</th>
              <th className="p-2.5">تعطیل</th>
              <th className="p-2.5">فوق‌برنامه</th>
              <th className="p-2.5">فعال</th>
              <th className="p-2.5">تاریخ ایجاد</th>
              <th className="p-2.5">مشاهدهٔ استاد</th>
              <th className="p-2.5">آخرین تغییر</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id} className={`border-b border-slate-100 ${!flagOf(s, 'isActive') ? 'bg-slate-50 text-slate-400' : ''}`}>
                <td className="p-2.5 text-center font-mono font-black text-slate-700">{faNum(s.sessionNo)}</td>
                <td className="p-2.5 text-center font-mono">{faNum(s.sessionDate)}</td>
                <td className="p-2.5 text-center font-mono text-3xs text-slate-500" dir="ltr">{s.startTime}–{s.endTime}</td>
                <td className="p-2.5 text-center text-slate-600">{s.roomName ?? '—'}</td>
                <td className="p-2.5 text-center">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-3xs font-black text-slate-700">
                    {STATUS_FA[s.status] ?? s.status}
                  </span>
                </td>
                <td className="p-2.5 text-center">
                  {Number(s.isMakeUp ?? 0) === 1
                    ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-3xs font-black text-amber-800">جبرانی</span>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="p-2.5 text-center">
                  <Chip on={flagOf(s, 'isHoliday')} label="تعطیل" tone="border-rose-300 bg-rose-100 text-rose-800" onClick={() => toggle(s, 'isHoliday')} />
                </td>
                <td className="p-2.5 text-center">
                  <Chip on={flagOf(s, 'isExtraSession')} label="فوق‌برنامه" tone="border-violet-300 bg-violet-100 text-violet-800" onClick={() => toggle(s, 'isExtraSession')} />
                </td>
                <td className="p-2.5 text-center">
                  <Chip on={flagOf(s, 'isActive')} label="فعال" tone="border-emerald-300 bg-emerald-100 text-emerald-800" onClick={() => toggle(s, 'isActive')} />
                </td>
                <td className="p-2.5 text-center text-3xs text-slate-500">{jdate(s.createdAt)}</td>
                <td className="p-2.5 text-center text-3xs text-slate-500">{jdate(s.professorViewedAt)}</td>
                <td className="p-2.5 text-center text-3xs text-slate-500">{jdate(s.updatedAt)}</td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={12} className="p-6 text-center text-slate-500">
                  برای این درس جلسه‌ای ثبت نشده است؛ ابتدا از «برنامه‌ریزی درسی ← تقویم ترم» جلسات ترم را تولید کنید.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <MobileCardList
          rows={sessions}
          columns={[
            { key: 'sessionNo', label: 'جلسه', title: true, render: (s) => faNum(s.sessionNo) },
            { key: 'sessionDate', label: 'تاریخ', subtitle: true, render: (s) => faNum(s.sessionDate) },
            { key: 'startTime', label: 'ساعت', render: (s) => <span dir="ltr">{s.startTime}–{s.endTime}</span> },
            { key: 'roomName', label: 'محل تشکیل', render: (s) => s.roomName ?? '—' },
            {
              key: 'status',
              label: 'وضعیت',
              render: (s) => (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-3xs font-black text-slate-700">
                  {STATUS_FA[s.status] ?? s.status}
                </span>
              ),
            },
            {
              key: 'isMakeUp',
              label: 'جبرانی',
              render: (s) =>
                Number(s.isMakeUp ?? 0) === 1 ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-3xs font-black text-amber-800">جبرانی</span>
                ) : (
                  '—'
                ),
            },
            { key: 'createdAt', label: 'تاریخ ایجاد', render: (s) => jdate(s.createdAt) },
            { key: 'professorViewedAt', label: 'مشاهدهٔ استاد', render: (s) => jdate(s.professorViewedAt) },
            { key: 'updatedAt', label: 'آخرین تغییر', render: (s) => jdate(s.updatedAt) },
          ]}
          getKey={(s) => s.id}
          renderActions={(s) => (
            <div className="flex flex-wrap gap-1">
              <Chip on={flagOf(s, 'isHoliday')} label="تعطیل" tone="border-rose-300 bg-rose-100 text-rose-800" onClick={() => toggle(s, 'isHoliday')} />
              <Chip on={flagOf(s, 'isExtraSession')} label="فوق‌برنامه" tone="border-violet-300 bg-violet-100 text-violet-800" onClick={() => toggle(s, 'isExtraSession')} />
              <Chip on={flagOf(s, 'isActive')} label="فعال" tone="border-emerald-300 bg-emerald-100 text-emerald-800" onClick={() => toggle(s, 'isActive')} />
            </div>
          )}
          empty={<div className="p-6 text-center text-sm text-slate-500">برای این درس جلسه‌ای ثبت نشده است؛ ابتدا از «برنامه‌ریزی درسی ← تقویم ترم» جلسات ترم را تولید کنید.</div>}
        />
      </div>
    </div>
  );
}

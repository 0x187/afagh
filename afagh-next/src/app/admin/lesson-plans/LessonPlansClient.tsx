'use client';

import React, { useMemo, useState } from 'react';
import {
  listLessonPlanStatus,
  setLessonPlanRequired,
} from '@/app/professor/lesson-plan/actions';

interface StatusRow {
  offeringId: number;
  courseTitle: string;
  professorName: string;
  status: string;
  sessionsCount: number;
  weightsSum: number;
  updatedAt: string | null;
}

const faNum = (n: unknown) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

function statusBadge(status: string): { label: string; cls: string } {
  const s = String(status ?? '').toUpperCase();
  if (s === 'SUBMITTED') return { label: 'ثبت نهایی', cls: 'bg-emerald-100 text-emerald-800' };
  if (s === 'DRAFT') return { label: 'پیش‌نویس', cls: 'bg-amber-100 text-amber-900' };
  return { label: 'ثبت نشده', cls: 'bg-slate-100 text-slate-600' };
}

export default function LessonPlansClient({
  universityId,
  universityTitle,
  initialRows,
}: {
  universityId: number | null;
  universityTitle: string;
  initialRows: StatusRow[];
}) {
  const [rows, setRows] = useState<StatusRow[]>(initialRows);
  const [isRequired, setIsRequired] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const total = rows.length;
  const submitted = rows.filter(r => String(r.status).toUpperCase() === 'SUBMITTED').length;
  const pct = useMemo(() => (total === 0 ? 0 : Math.round((submitted / total) * 100)), [submitted, total]);

  const doSave = async () => {
    if (!universityId) {
      setErr('دانشگاه فعال مشخص نیست.');
      return;
    }
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await setLessonPlanRequired(universityId, isRequired, notice || undefined);
      if (!res.ok) {
        setErr(res.error || 'خطا در ذخیره تنظیمات.');
        return;
      }
      setMsg('تنظیمات الزام طرح درس ذخیره شد.');
    } catch {
      setErr('خطا در ارتباط با سرور.');
    } finally {
      setSaving(false);
    }
  };

  const doRefresh = async () => {
    if (!universityId) return;
    setRefreshing(true);
    try {
      const fresh = await listLessonPlanStatus(universityId);
      setRows(
        fresh.map((r: { offeringId: number; courseTitle: string; professorName: string; status: string; sessionsCount: number; weightsSum: number; updatedAt: unknown }) => ({
          offeringId: r.offeringId,
          courseTitle: r.courseTitle,
          professorName: r.professorName,
          status: r.status,
          sessionsCount: r.sessionsCount,
          weightsSum: r.weightsSum,
          updatedAt: r.updatedAt ? String(r.updatedAt) : null,
        })),
      );
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-5 font-sans">
      <div className="bg-gradient-to-l from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-5 shadow-lg border border-indigo-700/50">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold bg-amber-400 text-slate-950">
              {universityTitle}
            </span>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight mt-1">📋 پایش طرح درس ارائه‌ها</h1>
            <p className="text-xs text-indigo-200 mt-1">
              {faNum(submitted)} از {faNum(total)} ارائه ثبت نهایی شده‌اند ({faNum(pct)}٪)
            </p>
          </div>
          <button
            onClick={doRefresh}
            disabled={refreshing || !universityId}
            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/20 transition disabled:opacity-50"
          >
            {refreshing ? 'در حال به‌روزرسانی…' : 'به‌روزرسانی جدول'}
          </button>
        </div>
        <div className="mt-3 h-2 rounded-full bg-white/15 overflow-hidden">
          <div className="h-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-3">
        <h3 className="font-extrabold text-slate-900 text-base">الزام تکمیل طرح درس</h3>
        <p className="text-2xs text-slate-500 leading-5">
          فعال‌سازی این گزینه فقط یک بنر یادآوری برای اساتید نمایش می‌دهد و هیچ‌گاه مانع ثبت نمره یا سایر
          عملیات آموزشی نمی‌شود.
        </p>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <input
            type="checkbox"
            checked={isRequired}
            onChange={e => setIsRequired(e.target.checked)}
            className="w-4 h-4 accent-indigo-700"
          />
          تکمیل طرح درس از سوی آموزش الزامی شده است
        </label>
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1.5">اطلاعیه برای اساتید (اختیاری):</label>
          <textarea
            value={notice}
            onChange={e => setNotice(e.target.value)}
            rows={2}
            placeholder="متن اطلاعیه…"
            className="w-full border border-slate-300 rounded-xl p-3 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {msg && <p className="text-2xs font-bold text-emerald-700">{msg}</p>}
        {err && <p className="text-2xs font-bold text-rose-700">{err}</p>}
        <button
          onClick={doSave}
          disabled={saving || !universityId}
          className="px-6 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs shadow transition disabled:opacity-50"
        >
          {saving ? 'در حال ذخیره…' : 'ذخیره تنظیمات'}
        </button>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-3">
        <h3 className="font-extrabold text-slate-900 text-base">وضعیت طرح درس ارائه‌ها</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs rt">
            <thead>
              <tr className="bg-slate-900 text-white text-center">
                <th className="p-2.5 border border-slate-800 w-12">ردیف</th>
                <th className="p-2.5 border border-slate-800">درس</th>
                <th className="p-2.5 border border-slate-800">استاد</th>
                <th className="p-2.5 border border-slate-800 w-28">وضعیت</th>
                <th className="p-2.5 border border-slate-800 w-24">جلسات</th>
                <th className="p-2.5 border border-slate-800 w-24">جمع بارم</th>
                <th className="p-2.5 border border-slate-800 w-32">آخرین به‌روزرسانی</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400 font-bold">
                    ارائه‌ای برای پایش وجود ندارد.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  const b = statusBadge(r.status);
                  return (
                    <tr key={r.offeringId} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="p-2 border border-slate-200 text-center font-bold text-slate-500">
                        {faNum(i + 1)}
                      </td>
                      <td className="p-2 border border-slate-200 font-extrabold text-slate-900">{r.courseTitle}</td>
                      <td className="p-2 border border-slate-200 text-slate-700">{r.professorName}</td>
                      <td className="p-2 border border-slate-200 text-center">
                        <span className={`px-2 py-0.5 rounded-full font-bold text-3xs ${b.cls}`}>{b.label}</span>
                      </td>
                      <td className="p-2 border border-slate-200 text-center font-bold">{faNum(r.sessionsCount)}</td>
                      <td className="p-2 border border-slate-200 text-center font-bold">{faNum(r.weightsSum)}</td>
                      <td className="p-2 border border-slate-200 text-center text-slate-500 text-2xs">
                        {r.updatedAt ?? '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

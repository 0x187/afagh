'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

interface Stats {
  total: number;
  submitted: number;
  filtered: number;
}

/** هم‌اند با LESSON_PLAN_PAGE_SIZE سمتِ سرور */
const PAGE_SIZE = 200;

const faNum = (n: unknown) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

function statusBadge(status: string): { label: string; cls: string } {
  const s = String(status ?? '').toUpperCase();
  if (s === 'SUBMITTED') return { label: 'ثبت نهایی', cls: 'bg-emerald-100 text-emerald-800' };
  if (s === 'DRAFT') return { label: 'پیش‌نویس', cls: 'bg-amber-100 text-amber-900' };
  return { label: 'ثبت نشده', cls: 'bg-slate-100 text-slate-600' };
}

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'همه' },
  { key: 'NONE', label: 'ثبت نشده' },
  { key: 'DRAFT', label: 'پیش‌نویس' },
  { key: 'SUBMITTED', label: 'ثبت نهایی' },
];

export default function LessonPlansClient({
  universityId,
  universityTitle,
  initialRows,
  initialStats,
}: {
  universityId: number | null;
  universityTitle: string;
  initialRows: StatusRow[];
  initialStats: Stats;
}) {
  const [rows, setRows] = useState<StatusRow[]>(initialRows);
  const [stats, setStats] = useState<Stats>(initialStats);
  const [isRequired, setIsRequired] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ── جست‌وجوی سروری (به‌جای لودِ کلِ ارائه‌ها در payload صفحه) ──
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const firstRun = useRef(true);

  const total = stats.total;
  const submitted = stats.submitted;
  const hasMore = stats.filtered > rows.length;
  const pct = useMemo(() => (total === 0 ? 0 : Math.round((submitted / total) * 100)), [submitted, total]);

  const loadPage = useCallback(
    async (offset: number, replace: boolean, q: string, st: string) => {
      if (!universityId) return;
      setRefreshing(true);
      try {
        const res = await listLessonPlanStatus(universityId, {
          query: q || undefined,
          status: st || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        const mapped = res.rows.map(r => ({
          offeringId: r.offeringId,
          courseTitle: r.courseTitle,
          professorName: r.professorName,
          status: r.status,
          sessionsCount: r.sessionsCount,
          weightsSum: r.weightsSum,
          updatedAt: r.updatedAt ? String(r.updatedAt) : null,
        }));
        setRows(prev => (replace ? mapped : [...prev, ...mapped]));
        setStats({ total: res.total, submitted: res.submitted, filtered: res.filtered });
      } catch {
        setErr('خطا در دریافت فهرست.');
      } finally {
        setRefreshing(false);
      }
    },
    [universityId],
  );

  // جست‌وجوی بی‌صدا با تأخیر — هر کلید یک کوئری نیست
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => void loadPage(0, true, query, status), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status]);

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
            onClick={() => void loadPage(0, true, query, status)}
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-extrabold text-slate-900 text-base">وضعیت طرح درس ارائه‌ها</h3>
          <span className="text-2xs text-slate-400">
            {faNum(rows.length)} از {faNum(stats.filtered)} ردیفِ فیلترشده
          </span>
        </div>

        {/* جست‌وجوی سروری — عبارت به سرور می‌رود، نه کلِ جدول به مرورگر */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="جست‌وجو: نام درس یا استاد…"
            className="flex-1 min-w-52 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.key || 'all'}
                type="button"
                onClick={() => setStatus(f.key)}
                className={`px-2.5 py-1.5 rounded-lg text-2xs font-bold border transition ${
                  status === f.key
                    ? 'bg-indigo-700 text-white border-indigo-700'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

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
                    {refreshing ? 'در حال دریافت…' : 'ردیفی با این جست‌وجو پیدا نشد.'}
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

        {hasMore && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => void loadPage(rows.length, false, query, status)}
              disabled={refreshing}
              className="px-5 py-2 rounded-xl border border-indigo-300 bg-indigo-50 text-indigo-800 font-bold text-xs transition hover:bg-indigo-100 disabled:opacity-50"
            >
              {refreshing ? 'در حال دریافت…' : `نمایش ${faNum(Math.min(PAGE_SIZE, stats.filtered - rows.length))} ردیف بعدی`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { scanMismatchedSamaCodes, applyCorrectedSamaCodes, scanGraduatedWithoutGrades, getUniversityId } from '../grades/actions';
import type { MismatchRow, StatusMismatchRow } from '../grades/actions';

export default function RegulationCheckClient() {
  const [universityId, setUniversityId] = useState<number | null>(null);
  const [rows, setRows] = useState<MismatchRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [scanning, startScan] = useTransition();
  const [fixing, startFix] = useTransition();
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState('');
  const [statusRows, setStatusRows] = useState<StatusMismatchRow[]>([]);
  const [statusScanning, startStatusScan] = useTransition();
  const [statusMsg, setStatusMsg] = useState('');

  const doStatusScan = async () => {
    setStatusMsg('');
    setStatusRows([]);
    const r = await getUniversityId();
    setUniversityId(r.universityId);
    startStatusScan(async () => {
      try {
        const result = await scanGraduatedWithoutGrades(200, r.universityId ?? undefined);
        setStatusRows(result.rows);
        setStatusMsg(result.rows.length === 0 ? 'مغایرتی یافت نشد.' : `${result.rows.length} فارغ‌التحصیل بدون سابقه نمره پیدا شد.`);
      } catch (e: any) {
        setStatusMsg('خطا: ' + (e?.message || 'نامشخص'));
      }
    });
  };

  const doScan = async () => {
    setMsg('');
    setRows([]);
    setSelected(new Set());
    const r = await getUniversityId();
    setUniversityId(r.universityId);
    startScan(async () => {
      try {
        const result = await scanMismatchedSamaCodes(r.universityId ?? undefined);
        setRows(result.rows);
        setMsg(result.rows.length === 0
          ? `مغایرتی در ${result.scanned} نمرهٔ بررسی‌شده نیست.`
          : `${result.rows.length} نمره با کد نادرست پیدا شد (از ${result.scanned} بررسی‌شده${result.truncated ? ' — اسکن محدود به ۲۰۰۰ ردیف اول است' : ''}).`);
      } catch (e: any) {
        setMsg('خطا: ' + (e?.message || 'نامشخص'));
      }
    });
  };

  const doFix = async () => {
    const ids = [...selected];
    if (ids.length === 0) { setMsg('ابتدا نمراتی را انتخاب کنید.'); return; }
    const r = await getUniversityId();
    setUniversityId(r.universityId);
    startFix(async () => {
      try {
        const result = await applyCorrectedSamaCodes(ids, r.universityId ?? undefined);
        setMsg(`${result.applied} نمره اصلاح شد.`);
        setSelected(new Set());
        doScan();
      } catch (e: any) {
        setMsg('خطا: ' + (e?.message || 'نامشخص'));
      }
    });
  };

  const doFixAll = async () => {
    const ids = rows.map(r => r.enrollmentId);
    if (ids.length === 0) return;
    const r = await getUniversityId();
    setUniversityId(r.universityId);
    startFix(async () => {
      try {
        const result = await applyCorrectedSamaCodes(ids, r.universityId ?? undefined);
        setMsg(`${result.applied} نمره اصلاح شد.`);
        setSelected(new Set());
        doScan();
      } catch (e: any) {
        setMsg('خطا: ' + (e?.message || 'نامشخص'));
      }
    });
  };

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const filtered = rows.filter(r => !filter || r.studentCode.includes(filter) || r.courseCode.includes(filter) || r.studentName.includes(filter));
    if (selected.size === filtered.length) { setSelected(new Set()); } else { setSelected(new Set(filtered.map(r => r.enrollmentId))); }
  };

  const filtered = rows.filter(r => !filter || r.studentCode.includes(filter) || r.courseCode.includes(filter) || r.studentName.includes(filter));

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4" dir="rtl">
      <h1 className="text-xl font-extrabold text-slate-800 border-b-2 border-slate-700 pb-2">
        بررسی کدهای وضعیت نمره سما (آیین‌نامه)
      </h1>

      <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <b>توضیح:</b> این ابزار تمام نمرات تثبیت‌شده را با محاسبه مجدد آیین‌نامه مقایسه می‌کند.
        اگر کد وضعیت فعلی با کد صحیح آیین‌نامه متفاوت باشد، آن را نشان می‌دهد.
        کدهای قدیمی ممکن است از داده‌های اولیه سما کپی شده باشند و صحیح نباشند.
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={doScan}
          disabled={scanning}
          className="px-4 py-2 bg-indigo-700 hover:bg-indigo-800 text-white font-bold rounded shadow disabled:opacity-50"
        >
          {scanning ? 'در حال بررسی...' : 'اسکن همه نمرات'}
        </button>

        {rows.length > 0 && (
          <>
            <button
              onClick={doFix}
              disabled={fixing || selected.size === 0}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded shadow disabled:opacity-50"
            >
              {fixing ? 'در حال اصلاح...' : `اصلاح انتخاب‌شده (${selected.size})`}
            </button>
            <button
              onClick={doFixAll}
              disabled={fixing}
              className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white font-bold rounded shadow disabled:opacity-50"
            >
              {fixing ? 'در حال اصلاح...' : `اصلاح همه (${rows.length})`}
            </button>
          </>
        )}

        <input
          type="text"
          placeholder="جستجوی کد دانشجویی / کد درس / نام..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="flex-1 bg-white border border-slate-300 rounded px-3 py-2 text-xs font-mono"
        />
      </div>

      {msg && (
        <div className={`p-3 rounded text-sm font-bold ${msg.includes('خطا') ? 'bg-red-100 text-red-800 border border-red-300 dark:border-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-green-100 text-green-800 border border-green-300 dark:border-green-800 dark:bg-green-950 dark:text-green-200'}`}>
          {msg}
        </div>
      )}

      {rows.length > 0 && (
        <div className="text-xs text-slate-600">
          نمایش {filtered.length} از {rows.length} نمره نادرست
        </div>
      )}

      {rows.length > 0 && (
        <div className="border border-slate-300 rounded-lg overflow-x-auto">
          <table className="w-full text-2xs text-right rt">
            <thead className="bg-slate-100 border-b border-slate-300 font-bold">
              <tr>
                <th className="p-2 w-8">
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} className="accent-indigo-600" />
                </th>
                <th className="p-2">کد دانشجویی</th>
                <th className="p-2">نام</th>
                <th className="p-2">ترم</th>
                <th className="p-2">کد درس</th>
                <th className="p-2">نام درس</th>
                <th className="p-2 text-center">نمره</th>
                <th className="p-2 text-center">کد اصلی سما</th>
                <th className="p-2 text-center">کد فعلی</th>
                <th className="p-2 text-center">کد صحیح</th>
                <th className="p-2">عنوان صحیح</th>
                <th className="p-2">آیین‌نامه</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr
                  key={r.enrollmentId}
                  className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${selected.has(r.enrollmentId) ? 'bg-indigo-50' : ''}`}
                  onClick={() => toggle(r.enrollmentId)}
                >
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={selected.has(r.enrollmentId)}
                      onChange={() => toggle(r.enrollmentId)}
                      onClick={e => e.stopPropagation()}
                      className="accent-indigo-600"
                    />
                  </td>
                  <td className="p-2 font-mono">{r.studentCode}</td>
                  <td className="p-2">{r.studentName}</td>
                  <td className="p-2 font-mono">{r.termCode}</td>
                  <td className="p-2 font-mono">{r.courseCode}</td>
                  <td className="p-2">{r.courseTitle}</td>
                  <td className="p-2 text-center font-mono font-bold">{r.gradeValue}</td>
                  <td className="p-2 text-center font-mono">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-300">
                      {r.originalCode || '—'}
                    </span>
                  </td>
                  <td className="p-2 text-center font-mono">
                    <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 font-bold border border-red-300 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                      {r.currentCode || '—'}
                    </span>
                  </td>
                  <td className="p-2 text-center font-mono">
                    <span className="px-2 py-0.5 rounded bg-green-100 text-green-700 font-bold border border-green-300 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                      {r.correctCode || '—'}
                    </span>
                  </td>
                  <td className="p-2 text-3xs">{r.correctTitle}</td>
                  <td className="p-2 text-3xs text-slate-500">{r.regulationTitle || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!scanning && rows.length === 0 && !msg && (
        <div className="text-center text-slate-400 py-12">
          دکمه «اسکن همه نمرات» را بزنید تا کدهای وضعیت بررسی شوند.
        </div>
      )}

      {/* ── مغایرت وضعیت: فارغ‌التحصیل بدون نمره ── */}
      <div className="border-t-2 border-slate-700 pt-4 mt-6 space-y-3">
        <h2 className="text-base font-extrabold text-slate-800">مغایرت وضعیت فارغ‌التحصیلی</h2>
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <b>توضیح:</b> وضعیت فارغ‌التحصیلی از داده ثبتی می‌آید و مستقل از نمرات است.
          اگر برای فارغ‌التحصیلی نه نمره نهایی و نه سابقه legacy ثبت شده باشد،
          یعنی جزئیات نمراتش در اکسپورت سما جا مانده (مثل انتقالی با سوابق) و باید پیگیری شود.
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={doStatusScan}
            disabled={statusScanning}
            className="px-4 py-2 bg-indigo-700 hover:bg-indigo-800 text-white font-bold rounded shadow disabled:opacity-50"
          >
            {statusScanning ? 'در حال بررسی...' : 'اسکن فارغ‌التحصیلان بدون نمره'}
          </button>
          {statusMsg && (
            <div className={`p-2 rounded text-xs font-bold ${statusMsg.includes('خطا') ? 'bg-red-100 text-red-800 border border-red-300 dark:border-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-green-100 text-green-800 border border-green-300 dark:border-green-800 dark:bg-green-950 dark:text-green-200'}`}>
              {statusMsg}
            </div>
          )}
        </div>
        {statusRows.length > 0 && (
          <div className="border border-slate-300 rounded-lg overflow-x-auto">
            <table className="w-full text-2xs text-right rt">
              <thead className="bg-slate-100 border-b border-slate-300 font-bold">
                <tr>
                  <th className="p-2">کد دانشجویی</th>
                  <th className="p-2">نام</th>
                  <th className="p-2">تاریخ فراغت</th>
                  <th className="p-2">آیین‌نامه</th>
                </tr>
              </thead>
              <tbody>
                {statusRows.map(r => (
                  <tr key={r.studentId} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-2 font-mono">{r.studentCode}</td>
                    <td className="p-2">{r.studentName}</td>
                    <td className="p-2 font-mono">{r.graduateDate || '—'}</td>
                    <td className="p-2 text-3xs text-slate-500">{r.regulationTitle || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

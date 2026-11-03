'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { askConfirm } from '@/lib/ui-feedback';

type Msg = { text: string; kind: 'ok' | 'error' } | null;

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

function toJalali(iso: string | Date | null): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  const gy = d.getFullYear(), gm = d.getMonth() + 1, gd = d.getDate();
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100)
    + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
}

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `خطا (${res.status})`);
  return data;
}

const DORM_STATUSES = ['active', 'ended', 'revoked'] as const;
const STATUS_LABEL: Record<string, string> = { active: 'فعال', ended: 'پایان‌یافته', revoked: 'لغوشده' };
function statusBadgeClass(s: string): string {
  if (s === 'active') return 'bg-emerald-100 text-emerald-700';
  if (s === 'ended') return 'bg-slate-200 text-slate-600';
  return 'bg-rose-100 text-rose-700';
}

interface DormRow {
  id: number;
  studentId: number;
  studentCode: string;
  fullName: string;
  majorName: string | null;
  degreeLevel: string | null;
  dormName: string | null;
  roomNo: string | null;
  bedNo: string | null;
  academicYear: string | null;
  validFrom: string | null;
  validTo: string | null;
  status: string | null;
  createdAt: string | null;
}

interface StudentHit { studentId: number; studentCode: string; name: string; entryYear: number | null; }

export default function DormClient() {
  const [rows, setRows] = useState<DormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, startTransition] = useTransition();
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DormRow | null>(null);
  const [printRow, setPrintRow] = useState<DormRow | null>(null);

  const load = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const qs = status ? `?status=${status}` : '';
      const data = await api(`/api/admin/dorm${qs}`);
      setRows(data.rows || []);
    } catch (e: any) {
      setMsg({ text: e.message, kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (id: number) => {
    const ok = await askConfirm({
      title: 'حذف سکونت',
      body: `سکونت #${id} حذف شود؟`,
      confirmText: 'حذف کن',
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await api(`/api/admin/dorm?id=${id}`, { method: 'DELETE' });
        setMsg({ text: 'سکونت حذف شد.', kind: 'ok' });
        load(statusFilter);
      } catch (e: any) {
        setMsg({ text: e.message, kind: 'error' });
      }
    });
  };

  const endResidence = (id: number) => startTransition(async () => {
    try {
      await api(`/api/admin/dorm?id=${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ended' }) });
      setMsg({ text: 'سکونت پایان یافت.', kind: 'ok' });
      load(statusFilter);
    } catch (e: any) {
      setMsg({ text: e.message, kind: 'error' });
    }
  });

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">کارت سکونت خوابگاه</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ثبت سکونت دوره‌ای دانشجو (خوابگاه، اتاق، تخت، سال تحصیلی) و صدور کارت سکونت قابل چاپ
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg"
        >
          ＋ سکونت جدید
        </button>
      </div>

      {msg && (
        <div className={`px-3 py-2 rounded-lg text-sm border ${msg.kind === 'ok'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {msg.text}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-3 flex gap-2 items-end flex-wrap">
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block">وضعیت</span>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); startTransition(() => load(e.target.value)); }}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white min-w-[140px]"
          >
            <option value="">همه</option>
            {DORM_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <span className="text-xs text-slate-400 mr-auto">{rows.length} رکورد</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm rt">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-2 text-right">#</th>
              <th className="p-2 text-right">دانشجو</th>
              <th className="p-2 text-right">شماره</th>
              <th className="p-2 text-right">خوابگاه</th>
              <th className="p-2 text-right">اتاق / تخت</th>
              <th className="p-2 text-right">سال تحصیلی</th>
              <th className="p-2 text-right">اعتبار</th>
              <th className="p-2 text-right">وضعیت</th>
              <th className="p-2 text-right">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="p-6 text-center text-slate-400">در حال بارگذاری…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="p-6 text-center text-slate-400">سکونتی یافت نشد.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-2 text-slate-500">{r.id}</td>
                <td className="p-2 font-medium">{r.fullName || '—'}</td>
                <td className="p-2 font-mono text-xs">{r.studentCode}</td>
                <td className="p-2">{r.dormName || '—'}</td>
                <td className="p-2 text-xs">{r.roomNo || '—'} / {r.bedNo || '—'}</td>
                <td className="p-2 text-xs">{r.academicYear || '—'}</td>
                <td className="p-2 text-xs">
                  {r.validFrom ? toJalali(r.validFrom) : '—'} تا {r.validTo ? toJalali(r.validTo) : '—'}
                </td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${statusBadgeClass(r.status || '')}`}>
                    {STATUS_LABEL[r.status || ''] || r.status}
                  </span>
                </td>
                <td className="p-2 whitespace-nowrap">
                  <button
                    onClick={() => setPrintRow(r)}
                    className="text-indigo-600 hover:underline text-xs ml-2"
                  >چاپ کارت</button>
                  {r.status === 'active' && (
                    <button
                      onClick={() => endResidence(r.id)}
                      className="text-amber-600 hover:underline text-xs ml-2"
                    >پایان</button>
                  )}
                  <button
                    onClick={() => { setEditing(r); setShowForm(true); }}
                    className="text-blue-600 hover:underline text-xs ml-2"
                  >ویرایش</button>
                  <button onClick={() => remove(r.id)} className="text-rose-600 hover:underline text-xs">حذف</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <DormForm
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={(m) => { setMsg({ text: m, kind: 'ok' }); setShowForm(false); startTransition(() => load(statusFilter)); }}
        />
      )}

      {printRow && <ResidenceCard row={printRow} onClose={() => setPrintRow(null)} />}
    </div>
  );
}

// ═══════════ فرم ایجاد/ویرایش ═══════════

function DormForm({ editing, onClose, onSaved }: {
  editing: DormRow | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [studentQuery, setStudentQuery] = useState(editing?.fullName || '');
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [picked, setPicked] = useState<StudentHit | null>(
    editing ? { studentId: editing.studentId, studentCode: editing.studentCode, name: editing.fullName, entryYear: null } : null,
  );
  const [dormName, setDormName] = useState(editing?.dormName || '');
  const [roomNo, setRoomNo] = useState(editing?.roomNo || '');
  const [bedNo, setBedNo] = useState(editing?.bedNo || '');
  const [academicYear, setAcademicYear] = useState(editing?.academicYear || '۱۴۰۴-۱۴۰۵');
  const [validFrom, setValidFrom] = useState(() => editing?.validFrom ? editing.validFrom.slice(0, 10) : '');
  const [validTo, setValidTo] = useState(() => editing?.validTo ? editing.validTo.slice(0, 10) : '');
  const [status, setStatus] = useState(editing?.status || 'active');
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchStudents = (q: string) => {
    setStudentQuery(q);
    setPicked(null);
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) { setHits([]); return; }
    debounce.current = setTimeout(async () => {
      try {
        const data = await api(`/api/admin/enrollment-approvals?action=students&q=${encodeURIComponent(q.trim())}`);
        setHits(data.hits || []);
      } catch { setHits([]); }
    }, 300);
  };

  const save = () => startTransition(async () => {
    setErr('');
    try {
      if (editing) {
        await api(`/api/admin/dorm?id=${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            dormName: dormName || null,
            roomNo: roomNo || null,
            bedNo: bedNo || null,
            academicYear: academicYear || null,
            validFrom: validFrom || null,
            validTo: validTo || null,
            status,
          }),
        });
        onSaved('سکونت به‌روزرسانی شد.');
      } else {
        if (!picked) { setErr('دانشجو را از لیست جست‌وجو انتخاب کنید.'); return; }
        await api('/api/admin/dorm', {
          method: 'POST',
          body: JSON.stringify({
            studentId: picked.studentId,
            dormName: dormName || null,
            roomNo: roomNo || null,
            bedNo: bedNo || null,
            academicYear: academicYear || null,
            validFrom: validFrom || null,
            validTo: validTo || null,
            status,
          }),
        });
        onSaved('سکونت جدید ثبت شد.');
      }
    } catch (e: any) {
      setErr(e.message || 'خطا در ذخیره');
    }
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800">{editing ? `ویرایش سکونت #${editing.id}` : 'سکونت خوابگاهی جدید'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2 rounded-lg">{err}</div>}

        {!editing && (
          <div className="space-y-1">
            <label className="text-xs text-slate-500">دانشجو</label>
            <input
              value={picked ? `${picked.name} (${picked.studentCode})` : studentQuery}
              onChange={(e) => searchStudents(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="نام یا شماره دانشجو… (حداقل ۲ حرف)"
            />
            {hits.length > 0 && !picked && (
              <div className="border border-slate-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-100">
                {hits.map((h) => (
                  <button key={h.studentId} type="button"
                    onClick={() => { setPicked(h); setHits([]); setStudentQuery(h.name); }}
                    className="w-full text-right px-3 py-2 text-sm hover:bg-blue-50">
                    {h.name} <span className="text-xs text-slate-400 font-mono">{h.studentCode}</span>
                    {h.entryYear ? <span className="text-xs text-slate-400"> — ورود {h.entryYear}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <label className="block text-xs text-slate-500 space-y-1">
            <span className="block">نام خوابگاه</span>
            <input value={dormName} onChange={(e) => setDormName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="مثلاً خوابگاه شهید بهشتی" />
          </label>
          <label className="block text-xs text-slate-500 space-y-1">
            <span className="block">اتاق</span>
            <input value={roomNo} onChange={(e) => setRoomNo(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="۱۰۱" />
          </label>
          <label className="block text-xs text-slate-500 space-y-1">
            <span className="block">تخت</span>
            <input value={bedNo} onChange={(e) => setBedNo(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="۲" />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <label className="block text-xs text-slate-500 space-y-1">
            <span className="block">سال تحصیلی</span>
            <input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="۱۴۰۴-۱۴۰۵" />
          </label>
          <label className="block text-xs text-slate-500 space-y-1">
            <span className="block">از تاریخ</span>
            <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs text-slate-500 space-y-1">
            <span className="block">تا تاریخ</span>
            <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
        </div>

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">وضعیت</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
            {DORM_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600">انصراف</button>
          <button onClick={save} disabled={busy}
            className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════ کارت سکونت قابل چاپ ═══════════

function ResidenceCard({ row, onClose }: { row: DormRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="border-2 border-slate-700 rounded-xl p-5 text-center space-y-2">
          <div className="font-bold text-lg text-slate-800">کارت سکونت خوابگاه</div>
          <div className="text-xs text-slate-500">سال تحصیلی {row.academicYear || '—'}</div>
          <div className="pt-2 space-y-1.5 text-sm text-right">
            <div className="flex justify-between border-b border-dashed border-slate-200 pb-1">
              <span className="text-slate-500">نام دانشجو</span><span className="font-medium">{row.fullName}</span>
            </div>
            <div className="flex justify-between border-b border-dashed border-slate-200 pb-1">
              <span className="text-slate-500">شماره دانشجویی</span><span className="font-mono">{row.studentCode}</span>
            </div>
            <div className="flex justify-between border-b border-dashed border-slate-200 pb-1">
              <span className="text-slate-500">رشته / مقطع</span><span>{row.majorName || '—'} {row.degreeLevel ? `(${row.degreeLevel})` : ''}</span>
            </div>
            <div className="flex justify-between border-b border-dashed border-slate-200 pb-1">
              <span className="text-slate-500">خوابگاه</span><span className="font-medium">{row.dormName || '—'}</span>
            </div>
            <div className="flex justify-between border-b border-dashed border-slate-200 pb-1">
              <span className="text-slate-500">اتاق / تخت</span><span>{row.roomNo || '—'} / {row.bedNo || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">اعتبار</span>
              <span>{row.validFrom ? toJalali(row.validFrom) : '—'} تا {row.validTo ? toJalali(row.validTo) : '—'}</span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600">بستن</button>
          <button onClick={() => window.print()}
            className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg">چاپ</button>
        </div>
      </div>
    </div>
  );
}

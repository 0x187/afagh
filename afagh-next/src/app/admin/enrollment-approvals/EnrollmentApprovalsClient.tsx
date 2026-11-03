'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { askConfirm } from '@/lib/ui-feedback';

type Msg = { text: string; kind: 'ok' | 'error' } | null;

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

/** تاریخ میلادی → شمسی (ساده، بدون وابستگی) */
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

/** تاریخ+ساعت میلادی → شمسی با ساعت */
function toJalaliTime(iso: string | Date | null): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return `${toJalali(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
const STATUS_LABEL: Record<string, string> = { PENDING: 'در انتظار', APPROVED: 'تأییدشده', REJECTED: 'ردشده' };
function statusBadgeClass(s: string): string {
  if (s === 'APPROVED') return 'bg-emerald-100 text-emerald-700';
  if (s === 'REJECTED') return 'bg-rose-100 text-rose-700';
  return 'bg-amber-100 text-amber-700';
}

interface ApprovalRow {
  id: number;
  studentId: number;
  studentCode: string | null;
  studentName: string | null;
  offeringId: number;
  courseTitle: string | null;
  courseCode: string | null;
  termTitle: string | null;
  groupNumber: number | null;
  status: string;
  note: string | null;
  requestedBy: number | null;
  decidedBy: number | null;
  decidedAt: string | null;
  createdAt: string | null;
}

interface StudentHit { studentId: number; studentCode: string; name: string; entryYear: number | null; }
interface OfferingHit {
  offeringId: number;
  courseTitle: string;
  courseCode: string;
  termTitle: string;
  groupNumber: number;
  capacity: number;
  enrolledCount: number;
}

interface Filters { q: string; status: string; }

function buildQuery(f: Filters, page: number): string {
  const qs = new URLSearchParams();
  if (f.q.trim()) qs.set('q', f.q.trim());
  if (f.status) qs.set('status', f.status);
  if (page > 1) qs.set('page', String(page));
  return qs.toString();
}

export default function EnrollmentApprovalsClient() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, startTransition] = useTransition();

  const [filters, setFilters] = useState<Filters>({ q: '', status: '' });
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async (f: Filters, p: number) => {
    setLoading(true);
    try {
      const qs = buildQuery(f, p);
      const data = await api(`/api/admin/enrollment-approvals${qs ? `?${qs}` : ''}`);
      setRows(data.rows || []);
      setTotal(data.total || 0);
      setPage(data.page || p);
    } catch (e: any) {
      setMsg({ text: e.message, kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters, 1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => startTransition(() => load(filters, 1));
  const onPage = (p: number) => startTransition(() => load(filters, p));

  const decide = (id: number, status: 'APPROVED' | 'REJECTED', okMsg: string) => {
    const note = status === 'REJECTED' ? prompt('دلیل رد (اختیاری):') : null;
    if (status === 'REJECTED' && note === null) return; // انصراف از prompt
    startTransition(async () => {
      try {
        await api(`/api/admin/enrollment-approvals?id=${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status, note: note || null }),
        });
        setMsg({ text: okMsg, kind: 'ok' });
        load(filters, page);
      } catch (e: any) {
        setMsg({ text: e.message, kind: 'error' });
      }
    });
  };

  const remove = async (id: number) => {
    const ok = await askConfirm({
      title: 'حذف درخواست',
      body: `درخواست #${id} حذف شود؟`,
      confirmText: 'حذف کن',
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await api(`/api/admin/enrollment-approvals?id=${id}`, { method: 'DELETE' });
        setMsg({ text: 'درخواست حذف شد.', kind: 'ok' });
        load(filters, page);
      } catch (e: any) {
        setMsg({ text: e.message, kind: 'error' });
      }
    });
  };

  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">تأییدیهٔ انتخاب واحد انگلیسی</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            درخواست ثبت‌نام درس انگلیسی → بررسی کارشناس → تأیید یا رد. چرخه: در انتظار ← تأییدشده / ردشده
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg"
        >
          ＋ درخواست جدید
        </button>
      </div>

      {msg && (
        <div className={`px-3 py-2 rounded-lg text-sm border ${msg.kind === 'ok'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {msg.text}
        </div>
      )}

      {/* فیلترها */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
        <label className="text-xs text-slate-500 space-y-1 md:col-span-2">
          <span className="block">جست‌وجو (نام/شماره دانشجو یا عنوان درس)</span>
          <input
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            placeholder="نام، شماره دانشجو یا نام درس…"
          />
        </label>
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block">وضعیت</span>
          <select
            value={filters.status}
            onChange={(e) => { setFilters({ ...filters, status: e.target.value }); startTransition(() => load({ ...filters, status: e.target.value }, 1)); }}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
          >
            <option value="">همه</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <button
          onClick={applyFilters}
          disabled={busy}
          className="bg-slate-700 hover:bg-slate-800 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50"
        >
          اعمال فیلتر
        </button>
      </div>

      {/* جدول */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm rt">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-2 text-right">#</th>
              <th className="p-2 text-right">دانشجو</th>
              <th className="p-2 text-right">شماره</th>
              <th className="p-2 text-right">درس</th>
              <th className="p-2 text-right">ترم / گروه</th>
              <th className="p-2 text-right">درخواست</th>
              <th className="p-2 text-right">تصمیم</th>
              <th className="p-2 text-right">وضعیت</th>
              <th className="p-2 text-right">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="p-6 text-center text-slate-400">در حال بارگذاری…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="p-6 text-center text-slate-400">درخواستی یافت نشد.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-2 text-slate-500">{r.id}</td>
                <td className="p-2 font-medium">{r.studentName || '—'}</td>
                <td className="p-2 font-mono text-xs">{r.studentCode || '—'}</td>
                <td className="p-2 max-w-[220px] truncate" title={r.note || ''}>
                  {r.courseTitle || '—'}
                  {r.courseCode ? <span className="text-xs text-slate-400 font-mono"> ({r.courseCode})</span> : null}
                </td>
                <td className="p-2 text-xs">{r.termTitle || '—'}{r.groupNumber != null ? ` — گروه ${r.groupNumber}` : ''}</td>
                <td className="p-2 text-xs">{toJalaliTime(r.createdAt)}</td>
                <td className="p-2 text-xs">{r.decidedAt ? toJalaliTime(r.decidedAt) : '—'}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${statusBadgeClass(r.status)}`}>
                    {STATUS_LABEL[r.status] || r.status}
                  </span>
                </td>
                <td className="p-2 whitespace-nowrap">
                  {r.status === 'PENDING' && (
                    <>
                      <button
                        onClick={() => decide(r.id, 'APPROVED', 'درخواست تأیید شد.')}
                        className="text-emerald-600 hover:underline text-xs ml-2"
                      >تأیید</button>
                      <button
                        onClick={() => decide(r.id, 'REJECTED', 'درخواست رد شد.')}
                        className="text-amber-600 hover:underline text-xs ml-2"
                      >رد</button>
                    </>
                  )}
                  <button onClick={() => remove(r.id)} className="text-rose-600 hover:underline text-xs">حذف</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* صفحه‌بندی */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => onPage(page - 1)}
            className="px-3 py-1 border border-slate-300 rounded-lg disabled:opacity-40">قبلی</button>
          <span className="text-slate-600">صفحه {page} از {pageCount}</span>
          <button disabled={page >= pageCount} onClick={() => onPage(page + 1)}
            className="px-3 py-1 border border-slate-300 rounded-lg disabled:opacity-40">بعدی</button>
        </div>
      )}

      {showForm && (
        <RequestForm
          onClose={() => setShowForm(false)}
          onSaved={(m) => { setMsg({ text: m, kind: 'ok' }); setShowForm(false); startTransition(() => load(filters, page)); }}
        />
      )}
    </div>
  );
}

// ═══════════ فرم ثبت درخواست (مودال) ═══════════

function RequestForm({ onClose, onSaved }: {
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [studentQuery, setStudentQuery] = useState('');
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [picked, setPicked] = useState<StudentHit | null>(null);
  const [offeringQuery, setOfferingQuery] = useState('');
  const [offeringHits, setOfferingHits] = useState<OfferingHit[]>([]);
  const [pickedOffering, setPickedOffering] = useState<OfferingHit | null>(null);
  const [note, setNote] = useState('');
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounce2 = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const searchOfferings = (q: string) => {
    setOfferingQuery(q);
    setPickedOffering(null);
    if (debounce2.current) clearTimeout(debounce2.current);
    debounce2.current = setTimeout(async () => {
      try {
        const data = await api(`/api/admin/enrollment-approvals?action=offerings&q=${encodeURIComponent(q.trim())}`);
        setOfferingHits(data.hits || []);
      } catch { setOfferingHits([]); }
    }, 300);
  };

  useEffect(() => { searchOfferings(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => startTransition(async () => {
    setErr('');
    try {
      if (!picked) { setErr('دانشجو را از لیست جست‌وجو انتخاب کنید.'); return; }
      if (!pickedOffering) { setErr('ارائهٔ درس انگلیسی را انتخاب کنید.'); return; }
      await api('/api/admin/enrollment-approvals', {
        method: 'POST',
        body: JSON.stringify({
          studentId: picked.studentId,
          offeringId: pickedOffering.offeringId,
          note: note || null,
        }),
      });
      onSaved('درخواست تأیید ثبت شد (در انتظار بررسی).');
    } catch (e: any) {
      setErr(e.message || 'خطا در ذخیره');
    }
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800">درخواست تأیید ثبت‌نام انگلیسی</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2 rounded-lg">{err}</div>}

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

        <div className="space-y-1">
          <label className="text-xs text-slate-500">ارائهٔ درس انگلیسی</label>
          <input
            value={pickedOffering ? `${pickedOffering.courseTitle} — ${pickedOffering.termTitle} (گروه ${pickedOffering.groupNumber})` : offeringQuery}
            onChange={(e) => searchOfferings(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="جست‌وجوی درس… (خالی = همهٔ درس‌های زبان)"
          />
          {offeringHits.length > 0 && !pickedOffering && (
            <div className="border border-slate-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-100">
              {offeringHits.map((o) => (
                <button key={o.offeringId} type="button"
                  onClick={() => { setPickedOffering(o); setOfferingHits([]); setOfferingQuery(o.courseTitle); }}
                  className="w-full text-right px-3 py-2 text-sm hover:bg-blue-50">
                  {o.courseTitle} <span className="text-xs text-slate-400 font-mono">{o.courseCode}</span>
                  <span className="text-xs text-slate-400"> — {o.termTitle}، گروه {o.groupNumber} ({o.enrolledCount}/{o.capacity})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">یادداشت (اختیاری)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="توضیح درخواست…" />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600">انصراف</button>
          <button onClick={save} disabled={busy}
            className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
            {busy ? 'در حال ذخیره…' : 'ثبت درخواست'}
          </button>
        </div>
      </div>
    </div>
  );
}

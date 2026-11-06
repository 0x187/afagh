'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  WARNING_STATUSES, WARNING_TYPES, WARNING_TYPE_LABEL,
  statusBadgeClass, warningTypeLabel,
} from '@/lib/scheduled-warnings-shared';
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

interface WarnRow {
  id: number;
  studentId: number;
  studentCode: string | null;
  studentName: string | null;
  warningType: string | null;
  title: string | null;
  message: string | null;
  sendAt: string;
  sentAt: string | null;
  status: string;
  createdAt: string | null;
}

interface StudentHit { studentId: number; studentCode: string; name: string; entryYear: number | null; }

interface Filters { q: string; status: string; type: string; dateFrom: string; dateTo: string; }

function buildQuery(f: Filters, page: number): string {
  const qs = new URLSearchParams();
  if (f.q.trim()) qs.set('q', f.q.trim());
  if (f.status) qs.set('status', f.status);
  if (f.type) qs.set('type', f.type);
  if (f.dateFrom) qs.set('dateFrom', f.dateFrom);
  if (f.dateTo) qs.set('dateTo', f.dateTo);
  if (page > 1) qs.set('page', String(page));
  return qs.toString();
}

export default function WarningsClient() {
  const [rows, setRows] = useState<WarnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, startTransition] = useTransition();

  const [filters, setFilters] = useState<Filters>({ q: '', status: '', type: '', dateFrom: '', dateTo: '' });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WarnRow | null>(null);

  const load = useCallback(async (f: Filters, p: number) => {
    setLoading(true);
    try {
      const qs = buildQuery(f, p);
      const data = await api(`/api/admin/warnings${qs ? `?${qs}` : ''}`);
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

  const patch = (id: number, body: Record<string, unknown>, okMsg: string) => startTransition(async () => {
    try {
      await api(`/api/admin/warnings?id=${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMsg({ text: okMsg, kind: 'ok' });
      load(filters, page);
    } catch (e: any) {
      setMsg({ text: e.message, kind: 'error' });
    }
  });

  const remove = async (id: number) => {
    const ok = await askConfirm({ title: 'حذف هشدار', body: `هشدار #${id} حذف شود؟`, confirmText: 'حذف کن', danger: true });
    if (!ok) return;
    startTransition(async () => {
      try {
        await api(`/api/admin/warnings?id=${id}`, { method: 'DELETE' });
        setMsg({ text: 'هشدار حذف شد.', kind: 'ok' });
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
          <h1 className="text-xl font-bold text-slate-800">هشدارهای زمان‌بندی‌شده</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ارسال خودکار در موعد مقرر روی همهٔ کانال‌های فعال: داخل‌پورتال، پیامک، تلگرام، بله، ایتا، سروش و ای‌گپ
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg"
        >
          ＋ هشدار جدید
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
      <div className="bg-white border border-slate-200 rounded-xl p-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block">جست‌وجو (نام/شماره/عنوان)</span>
          <input
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            placeholder="نام یا شماره دانشجو…"
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
            {WARNING_STATUSES.map((s) => <option key={s} value={s}>{s === 'pending' ? 'در انتظار' : s === 'sent' ? 'ارسال‌شده' : 'لغوشده'}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block">نوع</span>
          <select
            value={filters.type}
            onChange={(e) => { setFilters({ ...filters, type: e.target.value }); startTransition(() => load({ ...filters, type: e.target.value }, 1)); }}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
          >
            <option value="">همه</option>
            {WARNING_TYPES.map((t) => <option key={t} value={t}>{WARNING_TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block">از تاریخ ارسال</span>
          <input type="date" value={filters.dateFrom}
            onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block">تا تاریخ ارسال</span>
          <input type="date" value={filters.dateTo}
            onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
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
              <th className="p-2 text-right">نوع</th>
              <th className="p-2 text-right">عنوان</th>
              <th className="p-2 text-right">موعد ارسال</th>
              <th className="p-2 text-right">ارسال‌شده</th>
              <th className="p-2 text-right">وضعیت</th>
              <th className="p-2 text-right">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="p-6 text-center text-slate-400">در حال بارگذاری…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="p-6 text-center text-slate-400">هشداری یافت نشد.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-2 text-slate-500">{r.id}</td>
                <td className="p-2 font-medium">{r.studentName || '—'}</td>
                <td className="p-2 font-mono text-xs">{r.studentCode || '—'}</td>
                <td className="p-2 text-xs">{warningTypeLabel(r.warningType)}</td>
                <td className="p-2 max-w-[220px] truncate" title={r.message || ''}>{r.title || '—'}</td>
                <td className="p-2 text-xs">{toJalaliTime(r.sendAt)}</td>
                <td className="p-2 text-xs">{r.sentAt ? toJalaliTime(r.sentAt) : '—'}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${statusBadgeClass(r.status)}`}>
                    {r.status === 'pending' ? 'در انتظار' : r.status === 'sent' ? 'ارسال‌شده' : 'لغوشده'}
                  </span>
                </td>
                <td className="p-2 whitespace-nowrap">
                  {r.status === 'pending' && (
                    <>
                      <button
                        onClick={() => patch(r.id, { sendNow: true }, 'ارسال فوری در صف قرار گرفت؛ کرون بعدی بلافاصله می‌فرستد.')}
                        className="text-emerald-600 hover:underline text-xs ml-2"
                      >ارسال فوری</button>
                      <button
                        onClick={() => patch(r.id, { status: 'cancelled' }, 'هشدار لغو شد.')}
                        className="text-amber-600 hover:underline text-xs ml-2"
                      >لغو</button>
                    </>
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
        <WarnForm
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={(m) => { setMsg({ text: m, kind: 'ok' }); setShowForm(false); startTransition(() => load(filters, page)); }}
        />
      )}
    </div>
  );
}

// ═══════════ فرم ایجاد/ویرایش (مودال) ═══════════

function WarnForm({ editing, onClose, onSaved }: {
  editing: WarnRow | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [studentQuery, setStudentQuery] = useState(editing?.studentName || '');
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [picked, setPicked] = useState<StudentHit | null>(
    editing ? { studentId: editing.studentId, studentCode: editing.studentCode || '', name: editing.studentName || '', entryYear: null } : null,
  );
  const [warningType, setWarningType] = useState(editing?.warningType || WARNING_TYPES[0]);
  const [title, setTitle] = useState(editing?.title || '');
  const [message, setMessage] = useState(editing?.message || '');
  const [sendAt, setSendAt] = useState(() => {
    if (editing?.sendAt) {
      const d = new Date(editing.sendAt);
      if (!Number.isNaN(d.getTime())) {
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      }
    }
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  });
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
        const data = await api(`/api/admin/warnings?action=students&q=${encodeURIComponent(q.trim())}`);
        setHits(data.hits || []);
      } catch { setHits([]); }
    }, 300);
  };

  const save = () => startTransition(async () => {
    setErr('');
    try {
      if (editing) {
        await api(`/api/admin/warnings?id=${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: title || null,
            message: message || null,
            warningType,
            sendAt: new Date(sendAt).toISOString(),
          }),
        });
        onSaved('هشدار به‌روزرسانی شد.');
      } else {
        if (!picked) { setErr('دانشجو را از لیست جست‌وجو انتخاب کنید.'); return; }
        const dt = new Date(sendAt);
        if (Number.isNaN(dt.getTime())) { setErr('زمان ارسال نامعتبر است.'); return; }
        await api('/api/admin/warnings', {
          method: 'POST',
          body: JSON.stringify({
            studentId: picked.studentId,
            warningType,
            title: title || null,
            message: message || null,
            sendAt: dt.toISOString(),
          }),
        });
        onSaved('هشدار جدید ثبت شد و در موعد مقرر ارسال می‌شود.');
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
          <h2 className="font-bold text-slate-800">{editing ? `ویرایش هشدار #${editing.id}` : 'هشدار زمان‌بندی‌شده جدید'}</h2>
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

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-slate-500 space-y-1">
            <span className="block">نوع هشدار</span>
            <select value={warningType} onChange={(e) => setWarningType(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
              {WARNING_TYPES.map((t) => <option key={t} value={t}>{WARNING_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <label className="block text-xs text-slate-500 space-y-1">
            <span className="block">موعد ارسال</span>
            <input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
        </div>

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">عنوان</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="مثلاً یادآوری سررسید شهریه…" />
        </label>

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">متن پیام</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="متنی که برای دانشجو ارسال می‌شود…" />
        </label>

        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-500">
          ارسال خودکار: در موعد تعیین‌شده روی همهٔ کانال‌های فعال (داخل‌پورتال + پیامک + پیام‌رسان‌های متصل).
          کانال‌ها از تنظیم «کانال‌های ارسال هشدار زمان‌بندی‌شده» خوانده می‌شوند.
        </div>

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

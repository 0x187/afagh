'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { notify, askConfirm } from '@/lib/ui-feedback';

function toJalali(gy: number, gm: number, gd: number): string {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    g_d_m[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}
const faDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
};
const faNum = (v: unknown) => Number(v ?? 0).toLocaleString('fa-IR');

interface OverrideRow {
  id: number;
  studentId: number;
  studentCode: string;
  studentName: string;
  termId: number | null;
  termTitle: string;
  fixedAmount: string;
  perUnitAmount: string;
  reason: string | null;
  isActive: number;
  createdAt: string | null;
}
interface StudentHit {
  studentId: number;
  studentCode: string;
  name: string;
  entryYear: number | null;
}
interface Term {
  id: number;
  title: string;
  termCode: string;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'خطای سرور');
  return data;
}

const BASE = '/api/admin/finance/student-formula';

export default function StudentFormulaClient() {
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [terms, setTerms] = useState<Term[]>([]);
  const [modal, setModal] = useState<null | { edit?: OverrideRow }>(null);
  const [busy, startTransition] = useTransition();

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), q });
    if (activeOnly) params.set('active', '1');
    const data = await api(`${BASE}?${params}`);
    setRows(data.rows ?? []);
    setTotal(data.total ?? 0);
  }, [page, q, activeOnly]);

  useEffect(() => {
    startTransition(() => load().catch(() => {}));
  }, [load]);
  useEffect(() => {
    api(`${BASE}?action=terms`)
      .then((d) => setTerms(d.terms ?? []))
      .catch(() => {});
  }, []);

  const toggle = (row: OverrideRow) =>
    startTransition(async () => {
      try {
        await api(`${BASE}?id=${row.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: row.isActive ? 0 : 1 }),
        });
        await load();
      } catch (e) {
        notify(e instanceof Error ? e.message : 'خطا', 'error');
      }
    });

  const remove = async (row: OverrideRow) => {
    const ok = await askConfirm({
      title: 'حذف فرمول ویژه',
      body: `فرمول ویژهٔ ${row.studentName} حذف شود؟`,
      confirmText: 'حذف کن',
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await api(`${BASE}?id=${row.id}`, { method: 'DELETE' });
        await load();
      } catch (e) {
        notify(e instanceof Error ? e.message : 'خطا', 'error');
      }
    });
  };

  const pageCount = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── سربرگ premium ── */}
      <div className="overflow-hidden rounded-2xl border border-emerald-900/20 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 p-4 text-white shadow-lg print:hidden sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black sm:text-xl">🎯 فرمول ویژهٔ شهریهٔ دانشجو</h1>
            <p className="mt-1 text-xs text-emerald-50/90">
              مبلغ ثابت و نرخ واحد اختصاصی که جایگزین قاعدهٔ عمومی شهریه می‌شود (اولویت: ترم خاص، بعد همهٔ ترم‌ها)
            </p>
          </div>
          <button
            onClick={() => setModal({})}
            className="rounded-lg border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-black backdrop-blur transition hover:bg-white/25"
          >
            ＋ فرمول جدید
          </button>
        </div>
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-2xs font-medium text-slate-600">جستجو (نام / شماره دانشجویی)</span>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="جستجو…"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700 pb-2">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => {
              setActiveOnly(e.target.checked);
              setPage(1);
            }}
            className="accent-emerald-700"
          />
          فقط فعال‌ها
        </label>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-xs rt">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 px-2 text-right">دانشجو</th>
              <th className="py-2 px-2 text-right">دامنه</th>
              <th className="py-2 px-2 text-right">مبلغ ثابت (ریال)</th>
              <th className="py-2 px-2 text-right">نرخ هر واحد (ریال)</th>
              <th className="py-2 px-2 text-right">دلیل</th>
              <th className="py-2 px-2 text-right">وضعیت</th>
              <th className="py-2 px-2 text-right">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2 px-2">
                  <div className="font-medium text-slate-800">{r.studentName}</div>
                  <div className="text-2xs text-slate-500">{r.studentCode}</div>
                </td>
                <td className="py-2 px-2">{r.termTitle}</td>
                <td className="py-2 px-2">{faNum(r.fixedAmount)}</td>
                <td className="py-2 px-2">{faNum(r.perUnitAmount)}</td>
                <td className="py-2 px-2 max-w-48 truncate" title={r.reason ?? ''}>
                  {r.reason ?? '—'}
                </td>
                <td className="py-2 px-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-2xs ${
                      r.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {r.isActive ? 'فعال' : 'غیرفعال'}
                  </span>
                </td>
                <td className="py-2 px-2">
                  <div className="flex gap-1">
                    <button
                      onClick={() => toggle(r)}
                      disabled={busy}
                      className="rounded bg-slate-100 hover:bg-slate-200 px-2 py-1 text-2xs"
                    >
                      {r.isActive ? 'غیرفعال' : 'فعال'}
                    </button>
                    <button
                      onClick={() => setModal({ edit: r })}
                      className="rounded bg-slate-100 hover:bg-slate-200 px-2 py-1 text-2xs"
                    >
                      ویرایش
                    </button>
                    <button
                      onClick={() => remove(r)}
                      disabled={busy}
                      className="rounded bg-rose-100 hover:bg-rose-200 px-2 py-1 text-2xs text-rose-700"
                    >
                      حذف
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500">
                  فرمولی یافت نشد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between py-2 text-xs text-slate-600">
          <span>
            صفحه {faNum(page)} از {faNum(pageCount)} — مجموع {faNum(total)}
          </span>
          <div className="flex gap-1">
            <button
              disabled={page <= 1 || busy}
              onClick={() => setPage((p) => p - 1)}
              className="rounded bg-slate-100 px-2 py-1 disabled:opacity-50"
            >
              قبلی
            </button>
            <button
              disabled={page >= pageCount || busy}
              onClick={() => setPage((p) => p + 1)}
              className="rounded bg-slate-100 px-2 py-1 disabled:opacity-50"
            >
              بعدی
            </button>
          </div>
        </div>
      </div>

      {modal && (
        <FormulaForm
          edit={modal.edit}
          terms={terms}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function FormulaForm({
  edit,
  terms,
  onClose,
  onSaved,
}: {
  edit?: OverrideRow;
  terms: Term[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [studentQ, setStudentQ] = useState(edit ? `${edit.studentName} (${edit.studentCode})` : '');
  const [studentId, setStudentId] = useState<number | null>(edit?.studentId ?? null);
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [termId, setTermId] = useState<string>(edit?.termId ? String(edit.termId) : '');
  const [fixed, setFixed] = useState(edit ? String(Number(edit.fixedAmount)) : '0');
  const [perUnit, setPerUnit] = useState(edit ? String(Number(edit.perUnitAmount)) : '0');
  const [reason, setReason] = useState(edit?.reason ?? '');
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (edit) return;
    if (timer.current) clearTimeout(timer.current);
    if (!studentQ.trim() || studentId) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const d = await api(
          `/api/admin/enrollment-approvals?action=students&q=${encodeURIComponent(studentQ.trim())}`,
        );
        setHits(d.hits ?? []);
      } catch {
        setHits([]);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [studentQ, studentId, edit]);

  const save = async () => {
    if (!studentId) {
      notify('دانشجو را از فهرست انتخاب کنید', 'error');
      return;
    }
    const fixedAmount = Math.trunc(Number(fixed) || 0);
    const perUnitAmount = Math.trunc(Number(perUnit) || 0);
    if (fixedAmount < 0 || perUnitAmount < 0) {
      notify('مبالغ نمی‌توانند منفی باشند', 'error');
      return;
    }
    if (fixedAmount === 0 && perUnitAmount === 0) {
      notify('حداقل یکی از مبالغ باید بزرگ‌تر از صفر باشد', 'error');
      return;
    }
    setSaving(true);
    try {
      if (edit) {
        await api(`${BASE}?id=${edit.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            termId: termId ? Number(termId) : null,
            fixedAmount,
            perUnitAmount,
            reason: reason || null,
          }),
        });
      } else {
        await api(BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId,
            termId: termId ? Number(termId) : null,
            fixedAmount,
            perUnitAmount,
            reason: reason || null,
          }),
        });
      }
      onSaved();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'خطا', 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl" dir="rtl">
        <h2 className="font-bold text-slate-800 mb-3">{edit ? 'ویرایش فرمول ویژه' : 'فرمول ویژهٔ جدید'}</h2>
        <div className="space-y-3">
          {!edit && (
            <label className="flex flex-col gap-1 relative">
              <span className="text-2xs font-medium text-slate-600">دانشجو</span>
              <input
                value={studentQ}
                onChange={(e) => {
                  setStudentQ(e.target.value);
                  setStudentId(null);
                }}
                placeholder="نام یا شماره دانشجویی…"
                className={inputCls}
              />
              {hits.length > 0 && (
                <div className="absolute top-full z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-40 overflow-auto">
                  {hits.map((h) => (
                    <button
                      key={h.studentId}
                      type="button"
                      onClick={() => {
                        setStudentId(h.studentId);
                        setStudentQ(`${h.name} (${h.studentCode})`);
                        setHits([]);
                      }}
                      className="block w-full px-3 py-1.5 text-right text-xs hover:bg-slate-100"
                    >
                      {h.name} — {h.studentCode}
                    </button>
                  ))}
                </div>
              )}
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-2xs font-medium text-slate-600">دامنه (خالی = همهٔ ترم‌ها)</span>
            <select value={termId} onChange={(e) => setTermId(e.target.value)} className={inputCls}>
              <option value="">همهٔ ترم‌ها</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.termCode})
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-2xs font-medium text-slate-600">مبلغ ثابت (ریال)</span>
              <input
                value={fixed}
                onChange={(e) => setFixed(e.target.value)}
                inputMode="numeric"
                dir="ltr"
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-2xs font-medium text-slate-600">نرخ هر واحد (ریال)</span>
              <input
                value={perUnit}
                onChange={(e) => setPerUnit(e.target.value)}
                inputMode="numeric"
                dir="ltr"
                className={inputCls}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-2xs font-medium text-slate-600">دلیل / مصوبه</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className={inputCls}
              placeholder="مثلاً: مصوبهٔ کمیسیون موارد خاص…"
            />
          </label>
          {!edit && (
            <p className="text-2xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
              با ثبت فرمول جدید، فرمول فعال قبلی همین دانشجو در همین دامنه غیرفعال می‌شود.
            </p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs">
            انصراف
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {saving ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </div>
      </div>
    </div>
  );
}

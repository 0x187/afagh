'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { notify, askConfirm } from '@/lib/ui-feedback';

const faNum = (v: unknown) => Number(v ?? 0).toLocaleString('fa-IR');

interface Fund {
  id: number;
  code: string;
  title: string;
  description: string | null;
  isActive: number;
  loanCount: number;
}
interface LoanRow {
  id: number;
  studentId: number;
  studentCode: string;
  studentName: string;
  lender: string;
  loanCode: string | null;
  amount: string;
  installments: number;
  status: string;
  welfareFundId: number | null;
  fundTitle: string | null;
  createdAt: string | null;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'خطای سرور');
  return data;
}

const BASE = '/api/admin/finance/welfare';
const LOAN_STATUS: Record<string, string> = {
  ACTIVE: 'فعال',
  SETTLED: 'تسویه‌شده',
  CANCELLED: 'لغوشده',
};

export default function WelfareClient() {
  const [funds, setFunds] = useState<Fund[]>([]);
  const [selected, setSelected] = useState<string>('unassigned');
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [loanTotal, setLoanTotal] = useState(0);
  const [loanPage, setLoanPage] = useState(1);
  const [modal, setModal] = useState<null | { edit?: Fund }>(null);
  const [busy, startTransition] = useTransition();

  const loadFunds = useCallback(async () => {
    const data = await api(BASE);
    setFunds(data.funds ?? []);
  }, []);

  const loadLoans = useCallback(async () => {
    const params = new URLSearchParams({ fundId: selected, page: String(loanPage) });
    const data = await api(`${BASE}?${params}`);
    setLoans(data.rows ?? []);
    setLoanTotal(data.total ?? 0);
  }, [selected, loanPage]);

  useEffect(() => {
    startTransition(() => loadFunds().catch(() => {}));
  }, [loadFunds]);
  useEffect(() => {
    startTransition(() => loadLoans().catch(() => {}));
  }, [loadLoans]);

  const refreshAll = () => {
    loadFunds();
    loadLoans();
  };

  const assign = (loanId: number, fundId: number | null) =>
    startTransition(async () => {
      try {
        await api(BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'assign-loan', loanId, fundId }),
        });
        refreshAll();
      } catch (e) {
        notify(e instanceof Error ? e.message : 'خطا', 'error');
      }
    });

  const remove = async (f: Fund) => {
    if (f.loanCount > 0) {
      notify(`این صندوق ${faNum(f.loanCount)} وام دارد؛ اول وام‌ها را به صندوق دیگری منتقل کنید.`, 'error');
      return;
    }
    const ok = await askConfirm({
      title: 'حذف صندوق',
      body: `صندوق «${f.title}» حذف شود؟`,
      confirmText: 'حذف کن',
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await api(`${BASE}?id=${f.id}`, { method: 'DELETE' });
        loadFunds();
      } catch (e) {
        notify(e instanceof Error ? e.message : 'خطا', 'error');
      }
    });
  };

  const loanPages = Math.max(1, Math.ceil(loanTotal / 50));
  const selectedTitle =
    selected === 'unassigned' ? 'وام‌های بدون صندوق' : (funds.find((f) => String(f.id) === selected)?.title ?? '');

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── سربرگ premium ── */}
      <div className="overflow-hidden rounded-2xl border border-emerald-900/20 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 p-4 text-white shadow-lg print:hidden sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black sm:text-xl">🤝 صندوق رفاه دانشجویان</h1>
            <p className="mt-1 text-xs text-emerald-50/90">
              صندوق‌ها به‌عنوان مفهوم جدا + انتساب هر وام به یک صندوق (پوشش شکاف سما)
            </p>
          </div>
          <button
            onClick={() => setModal({})}
            className="rounded-lg border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-black backdrop-blur transition hover:bg-white/25"
          >
            ＋ صندوق جدید
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold text-slate-800 mb-2 text-sm">صندوق‌ها</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <button
            onClick={() => {
              setSelected('unassigned');
              setLoanPage(1);
            }}
            className={`rounded-lg border px-3 py-2 text-right text-xs ${
              selected === 'unassigned'
                ? 'border-amber-500 bg-amber-50'
                : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <div className="font-medium text-slate-800">📥 وام‌های بدون صندوق</div>
            <div className="text-2xs text-slate-500">انتساب‌نیافته‌ها</div>
          </button>
          {funds.map((f) => (
            <div
              key={f.id}
              className={`rounded-lg border px-3 py-2 ${
                selected === String(f.id) ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-200'
              }`}
            >
              <button
                onClick={() => {
                  setSelected(String(f.id));
                  setLoanPage(1);
                }}
                className="block w-full text-right"
              >
                <div className="font-medium text-slate-800 text-xs">
                  {f.title}
                  {!f.isActive && <span className="text-slate-400"> (غیرفعال)</span>}
                </div>
                <div className="text-2xs text-slate-500">
                  {f.code} — {faNum(f.loanCount)} وام
                </div>
              </button>
              <div className="mt-1 flex gap-1">
                <button
                  onClick={() => setModal({ edit: f })}
                  className="rounded bg-slate-100 hover:bg-slate-200 px-2 py-0.5 text-2xs"
                >
                  ویرایش
                </button>
                <button
                  onClick={() => remove(f)}
                  disabled={busy}
                  className="rounded bg-rose-100 hover:bg-rose-200 px-2 py-0.5 text-2xs text-rose-700"
                >
                  حذف
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="font-bold text-slate-800 mb-2 text-sm">
          {selectedTitle} ({faNum(loanTotal)})
        </h2>
        <table className="w-full text-xs rt">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 px-2 text-right">دانشجو</th>
              <th className="py-2 px-2 text-right">پرداخت‌کننده</th>
              <th className="py-2 px-2 text-right">مبلغ (ریال)</th>
              <th className="py-2 px-2 text-right">اقساط</th>
              <th className="py-2 px-2 text-right">وضعیت</th>
              <th className="py-2 px-2 text-right">صندوق</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2 px-2">
                  <div className="font-medium text-slate-800">{l.studentName}</div>
                  <div className="text-2xs text-slate-500">{l.studentCode}</div>
                </td>
                <td className="py-2 px-2">{l.lender}</td>
                <td className="py-2 px-2">{faNum(l.amount)}</td>
                <td className="py-2 px-2">{faNum(l.installments)}</td>
                <td className="py-2 px-2">{LOAN_STATUS[l.status] ?? l.status}</td>
                <td className="py-2 px-2">
                  <select
                    value={l.welfareFundId ? String(l.welfareFundId) : ''}
                    disabled={busy}
                    onChange={(e) => assign(l.id, e.target.value ? Number(e.target.value) : null)}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-2xs"
                  >
                    <option value="">بدون صندوق</option>
                    {funds
                      .filter((f) => f.isActive)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.title}
                        </option>
                      ))}
                  </select>
                </td>
              </tr>
            ))}
            {loans.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">
                  وامی در این بخش نیست.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between py-2 text-xs text-slate-600">
          <span>
            صفحه {faNum(loanPage)} از {faNum(loanPages)}
          </span>
          <div className="flex gap-1">
            <button
              disabled={loanPage <= 1 || busy}
              onClick={() => setLoanPage((p) => p - 1)}
              className="rounded bg-slate-100 px-2 py-1 disabled:opacity-50"
            >
              قبلی
            </button>
            <button
              disabled={loanPage >= loanPages || busy}
              onClick={() => setLoanPage((p) => p + 1)}
              className="rounded bg-slate-100 px-2 py-1 disabled:opacity-50"
            >
              بعدی
            </button>
          </div>
        </div>
      </div>

      {modal && (
        <FundForm
          edit={modal.edit}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            loadFunds();
          }}
        />
      )}
    </div>
  );
}

function FundForm({
  edit,
  onClose,
  onSaved,
}: {
  edit?: Fund;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(edit?.code ?? '');
  const [title, setTitle] = useState(edit?.title ?? '');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [isActive, setIsActive] = useState(edit ? edit.isActive === 1 : true);
  const [saving, setSaving] = useState(false);
  const inputCls =
    'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800';

  const save = async () => {
    if (!code.trim() || !title.trim()) {
      notify('کد و عنوان صندوق الزامی است', 'error');
      return;
    }
    setSaving(true);
    try {
      if (edit) {
        await api(`${BASE}?id=${edit.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: code.trim(),
            title: title.trim(),
            description: description || null,
            isActive: isActive ? 1 : 0,
          }),
        });
      } else {
        await api(BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: code.trim(),
            title: title.trim(),
            description: description || null,
            isActive: isActive ? 1 : 0,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl" dir="rtl">
        <h2 className="font-bold text-slate-800 mb-3">{edit ? 'ویرایش صندوق' : 'صندوق جدید'}</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-2xs font-medium text-slate-600">کد (انگلیسی، یکتا)</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-2xs font-medium text-slate-600">عنوان</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-2xs font-medium text-slate-600">توضیح</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="accent-emerald-700"
            />
            فعال
          </label>
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

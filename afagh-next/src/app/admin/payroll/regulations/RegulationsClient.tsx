'use client';

import { useState, useTransition } from 'react';
import { askConfirm } from '@/lib/ui-feedback';

type Version = {
  id: number; code: string; title: string; year: number | null;
  description: string | null; isActive: number; createdAt: string | null;
};

const faNum = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export default function RegulationsClient(props: {
  initial: Version[];
  actions: {
    createAction: (input: { code: string; title: string; year: number | null; description: string | null }) => Promise<{ ok: boolean; error?: string; id?: number }>;
    activateAction: (id: number) => Promise<{ ok: boolean; error?: string }>;
    deleteAction: (id: number) => Promise<{ ok: boolean; error?: string }>;
  };
}) {
  const { actions } = props;
  const [rows, setRows] = useState<Version[]>(props.initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [description, setDescription] = useState('');

  function reload() {
    window.location.reload();
  }

  function doCreate() {
    setMsg(null);
    start(async () => {
      const res = await actions.createAction({
        code, title,
        year: year.trim() === '' ? null : Number(year),
        description: description.trim() || null,
      });
      if (!res.ok) { setMsg(res.error ?? 'خطا در ساخت نسخه.'); return; }
      setMsg('نسخه ساخته شد (غیرفعال).');
      reload();
    });
  }

  function doActivate(id: number) {
    setMsg(null);
    start(async () => {
      const res = await actions.activateAction(id);
      if (!res.ok) { setMsg(res.error ?? 'خطا در فعال‌سازی.'); return; }
      setRows(rs => rs.map(r => ({ ...r, isActive: r.id === id ? 1 : 0 })));
      setMsg('نسخه فعال شد.');
    });
  }

  async function doDelete(id: number) {
    const ok = await askConfirm({ title: 'حذف نسخهٔ آیین‌نامه', body: 'این نسخه حذف شود؟', confirmText: 'حذف کن', danger: true });
    if (!ok) return;
    start(async () => {
      const res = await actions.deleteAction(id);
      if (!res.ok) { setMsg(res.error ?? 'خطا در حذف.'); return; }
      setRows(rs => rs.filter(r => r.id !== id));
      setMsg('نسخه حذف شد.');
    });
  }

  const inputCls = 'w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-black text-slate-900">نسخه‌های آیین‌نامهٔ حق‌التدریس</h1>
        <a href="/admin/payroll" className="text-sm text-slate-600 underline">بازگشت به میز حق‌التدریس</a>
      </div>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        در هر دانشگاه فقط یک نسخه فعال است؛ فعال‌سازی نسخهٔ جدید، نسخهٔ قبلی را غیرفعال می‌کند. نسخهٔ فعال حذف نمی‌شود.
      </div>

      {msg ? <div className="rounded-xl border border-slate-300 bg-slate-50 p-2.5 text-sm text-slate-800">{msg}</div> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="font-black text-slate-900 text-sm">نسخهٔ جدید</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          <div>
            <label className="text-xs text-slate-500">کد (مثل 1405-1)</label>
            <input value={code} onChange={e => setCode(e.target.value)} className={`${inputCls} font-mono`} dir="ltr" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-500">عنوان</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="آیین‌نامهٔ سال ۱۴۰۵" />
          </div>
          <div>
            <label className="text-xs text-slate-500">سال</label>
            <input value={year} onChange={e => setYear(e.target.value)} className={inputCls} type="number" dir="ltr" />
          </div>
          <div>
            <button onClick={doCreate} disabled={pending} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">افزودن</button>
          </div>
          <div className="col-span-2 md:col-span-5">
            <label className="text-xs text-slate-500">توضیح</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className={inputCls} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm rt">
            <thead>
              <tr className="text-xs text-slate-500 border-b">
                <th className="p-2 text-right">کد</th>
                <th className="p-2 text-right">عنوان</th>
                <th className="p-2">سال</th>
                <th className="p-2">وضعیت</th>
                <th className="p-2">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="p-2 font-mono text-xs" dir="ltr">{r.code}</td>
                  <td className="p-2 font-bold">
                    {r.title}
                    {r.description ? <div className="text-2xs font-normal text-slate-500">{r.description}</div> : null}
                  </td>
                  <td className="p-2 text-center">{r.year == null ? '—' : faNum(r.year)}</td>
                  <td className="p-2 text-center">
                    {r.isActive === 1
                      ? <span className="px-2 py-0.5 rounded-full text-3xs font-black bg-emerald-600 text-white">فعال</span>
                      : <span className="px-2 py-0.5 rounded-full text-3xs font-black bg-slate-200 text-slate-600">بایگانی</span>}
                  </td>
                  <td className="p-2 text-center whitespace-nowrap">
                    {r.isActive !== 1 ? (
                      <>
                        <button onClick={() => doActivate(r.id)} disabled={pending} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-2 py-1 text-xs text-white disabled:opacity-50">فعال‌سازی</button>{' '}
                        <button onClick={() => doDelete(r.id)} disabled={pending} className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-50">حذف</button>
                      </>
                    ) : <span className="text-xs text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="p-4 text-center text-xs text-slate-500">نسخه‌ای ثبت نشده است.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

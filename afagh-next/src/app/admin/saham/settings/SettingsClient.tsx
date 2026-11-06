'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { deleteInstituteCode, saveInstituteCode, type InstituteCodeInput } from './actions';
import type { InstituteCodeRow } from './page';
import { askConfirm } from '@/lib/ui-feedback';

interface Props {
  universities: { id: number; code: string; title: string }[];
  faculties: { id: number; universityId: number; name: string }[];
  initialCodes: InstituteCodeRow[];
  provinces: { code: string; title: string }[];
  cities: { provinceCode: string; code: string; title: string }[];
}

const emptyForm = (universityId: number): InstituteCodeInput => ({
  universityId,
  facultyId: null,
  title: '',
  code: '',
  provinceCode: '',
  cityCode: '',
  isDefault: false,
  isActive: true,
});

export default function SettingsClient({ universities, faculties, initialCodes, provinces, cities }: Props) {
  const [uniId, setUniId] = useState(universities[0]?.id ?? 0);
  const [codes, setCodes] = useState<InstituteCodeRow[]>(initialCodes);
  const [form, setForm] = useState<InstituteCodeInput>(emptyForm(universities[0]?.id ?? 0));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const uniFacs = useMemo(() => faculties.filter(f => f.universityId === uniId), [faculties, uniId]);
  const uniCodes = useMemo(() => codes.filter(c => c.universityId === uniId), [codes, uniId]);
  const provCities = useMemo(() => cities.filter(c => c.provinceCode === form.provinceCode), [cities, form.provinceCode]);
  const cityName = (provinceCode: string | null, cityCode: string | null) =>
    cities.find(c => c.provinceCode === provinceCode && c.code === cityCode)?.title ?? '';
  const provName = (code: string | null) => provinces.find(p => p.code === code)?.title ?? '';

  const pickUni = (id: number) => {
    setUniId(id);
    setForm(emptyForm(id));
    setEditingId(null);
    setMsg(null);
  };

  const startEdit = (r: InstituteCodeRow) => {
    setEditingId(r.id);
    setForm({
      id: r.id,
      universityId: r.universityId,
      facultyId: r.facultyId,
      title: r.title,
      code: r.code,
      provinceCode: r.provinceCode ?? '',
      cityCode: r.cityCode ?? '',
      isDefault: r.isDefault === 1,
      isActive: r.isActive === 1,
    });
    setMsg(null);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const res = await saveInstituteCode({ ...form, universityId: uniId });
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: 'err', text: res.error });
      return;
    }
    setMsg({ kind: 'ok', text: '✅ ذخیره شد.' });
    // بازخوانی ساده: فرم ریست، لیست را از سرور نمی‌گیریم — صفحه رفرش می‌شود
    setForm(emptyForm(uniId));
    setEditingId(null);
    window.location.reload();
  };

  const remove = async (id: number) => {
    const ok = await askConfirm({ title: 'حذف کد سهام', body: 'این سطر حذف شود؟', confirmText: 'حذف کن', danger: true });
    if (!ok) return;
    const res = await deleteInstituteCode(id);
    if (!res.ok) {
      setMsg({ kind: 'err', text: res.error });
      return;
    }
    setCodes(cs => cs.filter(c => c.id !== id));
  };

  const set = <K extends keyof InstituteCodeInput>(k: K, v: InstituteCodeInput[K]) =>
    setForm(f => ({ ...f, [k]: v, ...(k === 'provinceCode' ? { cityCode: '' } : null) }));

  return (
    <div className="space-y-3">
      {msg && (
        <div className={`rounded-xl border p-3 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-300 bg-emerald-50/70 text-emerald-800' : 'border-red-300 bg-red-50/70 text-red-800'}`}>
          {msg.text}
        </div>
      )}

      <div className="card !p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-600">دانشگاه:</span>
          {universities.map(u => (
            <button
              key={u.id}
              onClick={() => pickUni(u.id)}
              className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${uniId === u.id ? 'bg-indigo-700 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {u.title}
            </button>
          ))}
          <Link prefetch={false} href="/admin/saham" className="mr-auto text-2xs font-bold text-indigo-700 underline">
            بازگشت به گزارش‌ها ←
          </Link>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-right text-xs rt">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="p-2.5">عنوان واحد</th>
              <th className="p-2.5">کد ۱۲ رقمی</th>
              <th className="p-2.5">استان/شهر استقرار</th>
              <th className="p-2.5">پیش‌فرض</th>
              <th className="p-2.5">فعال</th>
              <th className="p-2.5">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {uniCodes.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-slate-400">هنوز کدی برای این دانشگاه ثبت نشده — از فرم پایین اضافه کنید.</td></tr>
            )}
            {uniCodes.map(r => (
              <tr key={r.id} className="border-t border-slate-200">
                <td className="p-2.5 font-bold">{r.title}</td>
                <td className="p-2.5 font-mono" dir="ltr">{r.code}</td>
                <td className="p-2.5">{provName(r.provinceCode)}{r.cityCode ? ` / ${cityName(r.provinceCode, r.cityCode)}` : ''}</td>
                <td className="p-2.5">{r.isDefault === 1 ? '⭐' : '—'}</td>
                <td className="p-2.5">{r.isActive === 1 ? '✅' : '⛔'}</td>
                <td className="p-2.5">
                  <div className="flex gap-1.5">
                    <button onClick={() => startEdit(r)} className="rounded border border-slate-300 px-2 py-1 text-2xs font-bold text-slate-600 hover:bg-slate-100">ویرایش</button>
                    <button onClick={() => remove(r.id)} className="rounded border border-red-300 px-2 py-1 text-2xs font-bold text-red-600 hover:bg-red-50">حذف</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card space-y-2">
        <h3 className="font-bold text-sm">{editingId ? 'ویرایش سطر' : 'سطر جدید'}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="text-2xs text-slate-600">عنوان واحد/دانشکده
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="مثلاً دانشکده فنی و مهندسی" className="mt-1 w-full rounded border px-2 py-1.5 text-xs" />
          </label>
          <label className="text-2xs text-slate-600">کد ۱۲ رقمی
            <input value={form.code} onChange={e => set('code', e.target.value)} placeholder="060500510020" dir="ltr" inputMode="numeric" maxLength={12} className="mt-1 w-full rounded border px-2 py-1.5 text-xs font-mono" />
          </label>
          <label className="text-2xs text-slate-600">اتصال به دانشکدهٔ سیستم (اختیاری)
            <select value={form.facultyId ?? ''} onChange={e => set('facultyId', e.target.value ? Number(e.target.value) : null)} className="mt-1 w-full rounded border px-2 py-1.5 text-xs">
              <option value="">— بدون اتصال (مثل حوزه ستادی) —</option>
              {uniFacs.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <label className="text-2xs text-slate-600">استان محل استقرار
            <select value={form.provinceCode} onChange={e => set('provinceCode', e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 text-xs">
              <option value="">—</option>
              {provinces.map(p => <option key={p.code} value={p.code}>{p.title}</option>)}
            </select>
          </label>
          <label className="text-2xs text-slate-600">شهر محل استقرار
            <select value={form.cityCode} onChange={e => set('cityCode', e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 text-xs">
              <option value="">—</option>
              {provCities.map(c => <option key={c.code} value={c.code}>{c.title}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-4 pb-1">
            <label className="flex items-center gap-1.5 text-2xs text-slate-600">
              <input type="checkbox" checked={form.isDefault} onChange={e => set('isDefault', e.target.checked)} className="h-4 w-4" /> پیش‌فرض
            </label>
            <label className="flex items-center gap-1.5 text-2xs text-slate-600">
              <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} className="h-4 w-4" /> فعال
            </label>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className="rounded bg-indigo-700 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-800 disabled:opacity-40">
            {busy ? '⏳…' : editingId ? 'ذخیرهٔ ویرایش' : '➕ افزودن'}
          </button>
          {editingId && (
            <button onClick={() => { setEditingId(null); setForm(emptyForm(uniId)); }} className="rounded border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600">
              انصراف
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

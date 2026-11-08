import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { deleteSahamInstituteCode, getSahamSettings, saveSahamInstituteCode } from '@/lib/migration-api';

// ═══ /admin/saham/settings — port of saham/settings/page.tsx + SettingsClient.tsx ═══
// Institute codes for the Saham reports: the 12-digit unit/faculty code, the
// official title and the province/city of the campus — per university.
// The backend (GET/POST /admin/saham/settings, POST /admin/saham/settings/delete)
// already exists in internal/admin/saham.go.

type InstituteCodeRow = {
  id: number;
  universityId: number;
  facultyId: number | null;
  title: string;
  code: string;
  provinceCode: string | null;
  cityCode: string | null;
  isDefault: number;
  isActive: number;
};

type SahamSettingsBundle = {
  universities: { id: number; code: string; title: string; kind: string }[];
  faculties: { id: number; universityId: number; name: string }[];
  provinces: { code: string; title: string }[];
  cities: { provinceCode: string; code: string; title: string }[];
  codes: InstituteCodeRow[];
};

type InstituteCodeInput = {
  id?: number;
  universityId: number;
  facultyId: number | null;
  title: string;
  code: string;
  provinceCode: string;
  cityCode: string;
  isDefault: boolean;
  isActive: boolean;
};

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

/** ۱۲رقمی بودن کد واحد — همان اعتبارسنجی اکشن مرجع */
function checkCode(code: string): string | null {
  const c = code.trim();
  if (!/^\d{12}$/.test(c)) return 'کد واحد باید دقیقاً ۱۲ رقم باشد.';
  return null;
}

export function SahamSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['saham-settings'],
    queryFn: () => getSahamSettings() as Promise<Record<string, unknown>>,
    select: (raw): SahamSettingsBundle => ({
      universities: (raw.universities as SahamSettingsBundle['universities']) ?? [],
      faculties: (raw.faculties as SahamSettingsBundle['faculties']) ?? [],
      provinces: (raw.provinces as SahamSettingsBundle['provinces']) ?? [],
      cities: (raw.cities as SahamSettingsBundle['cities']) ?? [],
      codes: (raw.codes as InstituteCodeRow[]) ?? [],
    }),
  });

  const [uniId, setUniId] = useState(0);
  const [form, setForm] = useState<InstituteCodeInput | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const bundle: SahamSettingsBundle = data ?? {
    universities: [], faculties: [], provinces: [], cities: [], codes: [],
  };
  const activeUniId = uniId || bundle.universities[0]?.id || 0;
  const activeForm = form ?? emptyForm(activeUniId);

  const uniFacs = useMemo(() => bundle.faculties.filter((f) => f.universityId === activeUniId), [bundle.faculties, activeUniId]);
  const uniCodes = useMemo(() => bundle.codes.filter((c) => c.universityId === activeUniId), [bundle.codes, activeUniId]);
  const provCities = useMemo(() => bundle.cities.filter((c) => c.provinceCode === activeForm.provinceCode), [bundle.cities, activeForm.provinceCode]);
  const cityName = (provinceCode: string | null, cityCode: string | null) =>
    bundle.cities.find((c) => c.provinceCode === provinceCode && c.code === cityCode)?.title ?? '';
  const provName = (code: string | null) => bundle.provinces.find((p) => p.code === code)?.title ?? '';

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

  const set = <K extends keyof InstituteCodeInput>(k: K, v: InstituteCodeInput[K]) => {
    setForm((f) => {
      const base = f ?? emptyForm(activeUniId);
      return { ...base, [k]: v, ...(k === 'provinceCode' ? { cityCode: '' } : null) };
    });
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const input = { ...activeForm, universityId: activeUniId };
      const title = input.title.trim();
      if (!title) {
        setMsg({ kind: 'err', text: 'عنوان واحد لازم است.' });
        return;
      }
      const codeErr = checkCode(input.code);
      if (codeErr) {
        setMsg({ kind: 'err', text: codeErr });
        return;
      }
      await saveSahamInstituteCode({
        id: input.id,
        universityId: input.universityId,
        facultyId: input.facultyId,
        title,
        code: input.code.trim(),
        provinceCode: input.provinceCode.trim(),
        cityCode: input.cityCode.trim(),
        isDefault: input.isDefault,
        isActive: input.isActive,
      });
      setMsg({ kind: 'ok', text: '✅ ذخیره شد.' });
      setForm(emptyForm(activeUniId));
      setEditingId(null);
      await qc.invalidateQueries({ queryKey: ['saham-settings'] });
      await qc.invalidateQueries({ queryKey: ['saham'] });
    } catch (e) {
      // The backend maps a duplicate 12-digit code to the exact reference message.
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'این کد قبلاً برای همین دانشگاه ثبت شده است.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('حذف کد سهام — این سطر حذف شود؟')) return;
    try {
      await deleteSahamInstituteCode(id);
      await qc.invalidateQueries({ queryKey: ['saham-settings'] });
      await qc.invalidateQueries({ queryKey: ['saham'] });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا در حذف.' });
    }
  };

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError)
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت تنظیمات سهام ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-sm font-black">⚙️ اطلاعات اولیهٔ مؤسسات برای سهام</h1>
        <Button size="sm" variant="outline" asChild>
          <Link to="/admin/saham"><ArrowRight className="size-3.5" aria-hidden /> بازگشت به گزارش‌ها</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-2">
          <p className="text-xs leading-6 text-muted-foreground">
            کد ۱۲ رقمی واحد/دانشکده، نام رسمی، و استان/شهر محل استقرار را <b>برای هر دانشگاه جدا</b> اینجا وارد کنید.
            همین اطلاعات در خروجی هر سه گزارش سهام استفاده می‌شود؛ اگر دانشکده‌ای کد نداشته باشد، ستون کد آن
            ردیف‌ها <b>خالی</b> می‌ماند (حدس زده نمی‌شود).
          </p>
        </CardContent>
      </Card>

      {msg && (
        <div className={`rounded-xl border p-3 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-300 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-300 bg-rose-50/70 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>
          {msg.text}
        </div>
      )}

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-muted-foreground">دانشگاه:</span>
            {bundle.universities.map((u) => (
              <button
                key={u.id}
                onClick={() => pickUni(u.id)}
                className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${activeUniId === u.id ? 'bg-indigo-700 text-white shadow' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
              >
                {u.title}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-right text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
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
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">هنوز کدی برای این دانشگاه ثبت نشده — از فرم پایین اضافه کنید.</td></tr>
              )}
              {uniCodes.map((r) => (
                <tr key={r.id} className="border-t border-border/50">
                  <td className="p-2.5 font-bold">{r.title}</td>
                  <td className="p-2.5 font-mono" dir="ltr">{r.code}</td>
                  <td className="p-2.5">{provName(r.provinceCode)}{r.cityCode ? ` / ${cityName(r.provinceCode, r.cityCode)}` : ''}</td>
                  <td className="p-2.5">{r.isDefault === 1 ? '⭐' : '—'}</td>
                  <td className="p-2.5">{r.isActive === 1 ? '✅' : '⛔'}</td>
                  <td className="p-2.5">
                    <div className="flex gap-1.5">
                      <button onClick={() => startEdit(r)} className="rounded border border-input px-2 py-1 text-2xs font-bold text-muted-foreground hover:bg-muted">ویرایش</button>
                      <button onClick={() => void remove(r.id)} className="rounded border border-rose-300 dark:border-rose-800 px-2 py-1 text-2xs font-bold text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40">حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 space-y-2">
          <h3 className="font-bold text-sm">{editingId ? 'ویرایش سطر' : 'سطر جدید'}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="text-2xs text-muted-foreground">عنوان واحد/دانشکده
              <input value={activeForm.title} onChange={(e) => set('title', e.target.value)} placeholder="مثلاً دانشکده فنی و مهندسی" className="mt-1 w-full rounded border border-input bg-card px-2 py-1.5 text-xs" />
            </label>
            <label className="text-2xs text-muted-foreground">کد ۱۲ رقمی
              <input value={activeForm.code} onChange={(e) => set('code', e.target.value)} placeholder="060500510020" dir="ltr" inputMode="numeric" maxLength={12} className="mt-1 w-full rounded border border-input bg-card px-2 py-1.5 text-xs font-mono" />
            </label>
            <label className="text-2xs text-muted-foreground">اتصال به دانشکدهٔ سیستم (اختیاری)
              <select value={activeForm.facultyId ?? ''} onChange={(e) => set('facultyId', e.target.value ? Number(e.target.value) : null)} className="mt-1 w-full rounded border border-input bg-card px-2 py-1.5 text-xs">
                <option value="">— بدون اتصال (مثل حوزه ستادی) —</option>
                {uniFacs.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="text-2xs text-muted-foreground">استان محل استقرار
              <select value={activeForm.provinceCode} onChange={(e) => set('provinceCode', e.target.value)} className="mt-1 w-full rounded border border-input bg-card px-2 py-1.5 text-xs">
                <option value="">—</option>
                {bundle.provinces.map((p) => <option key={p.code} value={p.code}>{p.title}</option>)}
              </select>
            </label>
            <label className="text-2xs text-muted-foreground">شهر محل استقرار
              <select value={activeForm.cityCode} onChange={(e) => set('cityCode', e.target.value)} className="mt-1 w-full rounded border border-input bg-card px-2 py-1.5 text-xs">
                <option value="">—</option>
                {provCities.map((c) => <option key={c.code} value={c.code}>{c.title}</option>)}
              </select>
            </label>
            <div className="flex items-end gap-4 pb-1">
              <label className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                <input type="checkbox" checked={activeForm.isDefault} onChange={(e) => set('isDefault', e.target.checked)} className="h-4 w-4" /> پیش‌فرض
              </label>
              <label className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                <input type="checkbox" checked={activeForm.isActive} onChange={(e) => set('isActive', e.target.checked)} className="h-4 w-4" /> فعال
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void save()} disabled={busy} className="rounded bg-indigo-700 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-800 disabled:opacity-40">
              {busy ? '⏳…' : editingId ? 'ذخیرهٔ ویرایش' : '➕ افزودن'}
            </button>
            {editingId && (
              <button onClick={() => { setEditingId(null); setForm(emptyForm(activeUniId)); }} className="rounded border border-input px-4 py-2 text-xs font-bold text-muted-foreground">
                انصراف
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

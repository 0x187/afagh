import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits } from '@/lib/fa';
import { deleteUniversityAdmin, getUniversitiesAdmin, upsertUniversityAdmin, type UniversityAdminRow } from '@/lib/admin-modules6-api';

// ═══ مدیریت دانشگاه‌ها (چندمستأجری) — port of admin/universities ═══

const KIND_FA: Record<string, string> = { OWN: 'آفاق', DISSOLVED: 'منحل‌شده', MERGED: 'ادغام‌شده' };

const EMPTY_FORM = { id: 0, code: '', title: '', kind: 'DISSOLVED', saminCode: '' };

export function UniversitiesPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({ queryKey: ['admin-universities'], queryFn: getUniversitiesAdmin });
  const rows = q.data?.rows ?? [];

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await upsertUniversityAdmin({
        id: form.id || undefined,
        code: form.code.trim(),
        title: form.title.trim(),
        kind: form.kind,
        saminCode: form.saminCode.trim(),
      });
      if (!r.ok) {
        setMsg(r.error ?? 'ذخیره دانشگاه ناموفق بود.');
        return;
      }
      setForm(EMPTY_FORM);
      setMsg('✅ ذخیره شد.');
      void qc.invalidateQueries({ queryKey: ['admin-universities'] });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: UniversityAdminRow) => {
    if (!window.confirm(`دانشگاه «${u.title}» حذف شود؟ (در صورت وجود دادهٔ متصل، پایگاه‌داده جلوی حذف را می‌گیرد)`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await deleteUniversityAdmin(u.id);
      setMsg(r.ok ? '✅ حذف شد.' : `⛔ ${r.error ?? ''}`);
      void qc.invalidateQueries({ queryKey: ['admin-universities'] });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-emerald-900 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="text-base font-black">🏛️ مدیریت دانشگاه‌ها (چندمستأجری)</h1>
          <p className="mt-1 text-xs leading-6 text-emerald-100">
            هر دانشگاه یک ردیف با کد یکتاست. دانشگاه جدید = فقط «افزودن» از همین‌جا؛ فایل سما در «انتقال داده» و کلید سجاد در «ثمین» وصل می‌شود.
          </p>
        </CardContent>
      </Card>

      {msg ? <Card><CardContent className="px-4 py-2.5 text-xs font-bold text-foreground">{msg}</CardContent></Card> : null}

      <Card>
        <CardContent className="space-y-2">
          <h2 className="text-sm font-black">{form.id ? `ویرایش دانشگاه #${faDigits(form.id)}` : 'افزودن دانشگاه'}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Input placeholder="کد (ZARINE)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} dir="ltr" />
            <Input placeholder="عنوان" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <select className="h-9 rounded-md border border-border bg-background px-3 text-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(KIND_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Input placeholder="کد ثمین (اختیاری)" value={form.saminCode} onChange={(e) => setForm({ ...form, saminCode: e.target.value })} dir="ltr" />
            <div className="flex gap-2">
              <Button disabled={busy || !form.code.trim() || !form.title.trim()} onClick={() => void submit()}>ذخیره</Button>
              {form.id ? <Button variant="ghost" onClick={() => setForm(EMPTY_FORM)}>انصراف</Button> : null}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">کد فقط حروف A-Z، رقم، زیرخط یا خط تیره (۲ تا ۳۰ نویسه).</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto">
          {q.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <table className="w-full text-right text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  {['کد', 'عنوان', 'نوع', 'کد ثمین', 'اتصال ثمین', 'وضعیت', ''].map((h, i) => (
                    <th key={i} className="p-2 text-right font-black">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="border-t border-border/50">
                    <td className="p-2 font-mono font-bold" dir="ltr">{u.code}</td>
                    <td className="p-2 font-bold">{u.title}</td>
                    <td className="p-2">{KIND_FA[u.kind] ?? u.kind}</td>
                    <td className="p-2 font-mono" dir="ltr">{u.saminCode ?? '—'}</td>
                    <td className="p-2">
                      {u.saminConnected ? (
                        <Badge variant="secondary">متصل{u.saminEnabled ? '' : ' (خاموش)'}</Badge>
                      ) : (
                        <Badge variant="outline">وصل نشده</Badge>
                      )}
                    </td>
                    <td className="p-2">
                      {u.isActive === 1 ? <Badge>فعال</Badge> : <Badge variant="outline">غیرفعال</Badge>}
                    </td>
                    <td className="p-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setForm({ id: u.id, code: u.code, title: u.title, kind: u.kind, saminCode: u.saminCode ?? '' })}>
                          ویرایش
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-600" disabled={busy} onClick={() => void remove(u)}>
                          حذف
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">دانشگاهی ثبت نشده است.</td></tr>
                ) : null}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

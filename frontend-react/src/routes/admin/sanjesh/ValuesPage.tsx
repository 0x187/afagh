import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import {
  deleteSanjeshValueMap,
  getSanjeshValues,
  saveSanjeshValueMap,
  seedSanjeshValueMapsFromTemplate,
} from '@/lib/sanjesh-drilldown-api';

import { SanjeshFlash, SanjeshSteps } from './_ui';

// ═══ /admin/sanjesh/:id/values — port of sanjesh/[id]/values/page.tsx ═══
// Decode tables: each sanjesh value (code or title) maps to an internal
// afagh code/title. Both code and title are accepted as the lookup key.

export function SanjeshValuesPage() {
  const params = useParams();
  const fileId = Number(params.id);
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const fieldFilter = (searchParams.get('field') ?? '').trim();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sanjesh-values', fileId],
    queryFn: () => getSanjeshValues(fileId),
    enabled: Number.isFinite(fileId) && fileId > 0,
  });

  const [form, setForm] = useState({ field: '', sanjeshValue: '', sanjeshLabel: '', internalValue: '', internalLabel: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const maps = data?.maps ?? [];
  const grouped = useMemo(() => {
    const map = new Map<string, typeof maps>();
    for (const m of maps) {
      const list = map.get(m.field) ?? [];
      list.push(m);
      map.set(m.field, list);
    }
    return [...map.entries()];
  }, [maps]);
  const shown = fieldFilter ? grouped.filter(([f]) => f === fieldFilter) : grouped;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      const message = await fn();
      setMsg({ kind: 'ok', text: message });
      await qc.invalidateQueries({ queryKey: ['sanjesh-values', fileId] });
      return true;
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'عملیات ناموفق بود.' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!form.field.trim() || !form.sanjeshValue.trim()) {
      setMsg({ kind: 'err', text: 'فیلد و مقدار سنجش الزامی است.' });
      return;
    }
    void run(async () => {
      const message = await saveSanjeshValueMap(fileId, {
        field: form.field.trim(),
        sanjeshValue: form.sanjeshValue.trim(),
        sanjeshLabel: form.sanjeshLabel.trim(),
        internalValue: form.internalValue.trim(),
        internalLabel: form.internalLabel.trim(),
      });
      setForm({ field: '', sanjeshValue: '', sanjeshLabel: '', internalValue: '', internalLabel: '' });
      return message;
    });
  };

  if (!Number.isFinite(fileId) || fileId <= 0)
    return <p className="p-6 text-sm text-red-600">شناسهٔ فایل نامعتبر است.</p>;
  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data)
    return <p className="p-6 text-sm text-red-600">{error instanceof Error ? error.message : 'فایل یافت نشد.'}</p>;

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <SanjeshSteps fileId={fileId} active="values" />
      <header className="mb-3">
        <h1 className="text-base font-black text-foreground">جدول براورد — {data.file.title}</h1>
        <p className="text-[11px] text-muted-foreground">
          هر مقدار سنجش (کد یا عنوان) را به عنوان/کد داخلی آفاق نگاشت می‌کند. جدول براورد هم کد و هم عنوان را به‌عنوان
          کلید می‌پذیرد.
        </p>
      </header>

      <SanjeshFlash msg={msg?.kind === 'ok' ? msg.text : null} err={msg?.kind === 'err' ? msg.text : null} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => seedSanjeshValueMapsFromTemplate(fileId))}>
          پرکردن از دیکدهای قالب
        </Button>
        <span className="text-[11px] text-muted-foreground">{faNumber(maps.length)} ردیف براورد</span>
      </div>

      {/* add / edit a decode row */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <h2 className="mb-2 text-sm font-bold">افزودن / ویرایش براورد</h2>
          <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-2">
              <span>فیلد</span>
              <input
                value={form.field}
                onChange={(e) => setForm((f) => ({ ...f, field: e.target.value }))}
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs"
                dir="ltr"
                placeholder="gender"
              />
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-2">
              <span>مقدار سنجش</span>
              <input
                value={form.sanjeshValue}
                onChange={(e) => setForm((f) => ({ ...f, sanjeshValue: e.target.value }))}
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs"
                dir="auto"
                placeholder="2 یا مرد"
              />
            </label>
            <label className="col-span-2 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-2">
              <span>عنوان سنجش</span>
              <input
                value={form.sanjeshLabel}
                onChange={(e) => setForm((f) => ({ ...f, sanjeshLabel: e.target.value }))}
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs"
              />
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-1">
              <span>کد داخلی</span>
              <input
                value={form.internalValue}
                onChange={(e) => setForm((f) => ({ ...f, internalValue: e.target.value }))}
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs"
                dir="ltr"
                placeholder="MALE"
              />
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-2">
              <span>عنوان داخلی</span>
              <input
                value={form.internalLabel}
                onChange={(e) => setForm((f) => ({ ...f, internalLabel: e.target.value }))}
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs"
              />
            </label>
            <Button size="sm" className="col-span-2 md:col-span-2" disabled={busy} onClick={save}>
              ذخیره
            </Button>
          </div>
        </CardContent>
      </Card>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">هنوز براوردی تعریف نشده است.</p>
      ) : (
        shown.map(([field, list]) => (
          <Card key={field} className="mb-3">
            <CardContent className="pt-4">
              <h3 className="mb-2 text-xs font-bold" dir="ltr">
                {field}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="p-1.5 font-bold">مقدار سنجش</th>
                      <th className="p-1.5 font-bold">عنوان سنجش</th>
                      <th className="p-1.5 font-bold">کد داخلی</th>
                      <th className="p-1.5 font-bold">عنوان داخلی</th>
                      <th className="w-16 p-1.5 font-bold">حذف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((m) => (
                      <tr key={m.id} className="border-t border-border/50">
                        <td className="p-1.5 font-mono" dir="ltr">
                          {m.sanjeshValue}
                        </td>
                        <td className="p-1.5">{m.sanjeshLabel ?? '—'}</td>
                        <td className="p-1.5 font-mono" dir="ltr">
                          {m.internalValue ?? '—'}
                        </td>
                        <td className="p-1.5">{m.internalLabel ?? '—'}</td>
                        <td className="p-1.5">
                          <button
                            type="button"
                            className="text-[11px] text-red-600 hover:underline disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void run(() => deleteSanjeshValueMap(fileId, m.id))}
                          >
                            حذف
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

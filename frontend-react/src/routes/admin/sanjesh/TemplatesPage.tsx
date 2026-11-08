import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import {
  buildSanjeshTemplateFromFile,
  cloneSanjeshTemplate,
  listSanjeshTemplates,
  seedSanjeshBuiltinTemplates,
  type SanjeshTemplate,
} from '@/lib/sanjesh-drilldown-api';

import { SanjeshFlash } from './_ui';

// ═══ /admin/sanjesh/templates — port of sanjesh/templates/page.tsx ═══
// Templates live in the database (yearly structure changes), the four builtin
// ones are seeded once and stay locked (clone to edit).

const EXAM_KINDS = ['FANI', 'ARSHAD', 'K2K', 'SARASARI', 'CUSTOM'] as const;

export function SanjeshTemplatesPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sanjesh-templates'],
    queryFn: () => listSanjeshTemplates(),
  });
  const templates: SanjeshTemplate[] = data ?? [];

  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const buildFileRef = useRef<HTMLInputElement>(null);
  const [buildForm, setBuildForm] = useState({ key: '', title: '', examYear: '1406', examKind: 'CUSTOM' });
  const [cloneForm, setCloneForm] = useState({ sourceKey: '', newKey: '', title: '', examYear: '1406' });

  const run = async (fn: () => Promise<{ message: string; id?: number | null }>) => {
    setBusy(true);
    setMsg(null);
    try {
      const { message, id } = await fn();
      setMsg({ kind: 'ok', text: message });
      await qc.invalidateQueries({ queryKey: ['sanjesh-templates'] });
      return id ?? null;
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'عملیات ناموفق بود.' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const buildFromFile = () => {
    const file = buildFileRef.current?.files?.[0];
    if (!file) {
      setMsg({ kind: 'err', text: 'فایل انتخاب نشده است.' });
      return;
    }
    void run(async () =>
      buildSanjeshTemplateFromFile({
        file,
        key: buildForm.key.trim(),
        title: buildForm.title.trim(),
        examKind: buildForm.examKind,
        examYear: Number(buildForm.examYear),
      }),
    );
  };

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError)
    return (
      <p className="p-6 text-sm text-red-600">{error instanceof Error ? error.message : 'فهرست قالب‌ها ناموفق بود.'}</p>
    );

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-black text-foreground">قالب‌های ساختار سنجش</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            هر سال ممکن است چند فیلد به ساختار فایل اضافه یا کم شود. قالب‌ها در دیتابیس ذخیره می‌شوند و شما می‌توانید
            قالب تازه بسازید، از روی فایل بسازید، یا یک قالب موجود را برای سال جدید کپی و ویرایش کنید.
          </p>
        </div>
        <Button size="sm" variant="ghost" asChild>
          <Link to="/admin/sanjesh">← فایل‌های سنجش</Link>
        </Button>
      </header>

      <SanjeshFlash msg={msg?.kind === 'ok' ? msg.text : null} err={msg?.kind === 'err' ? msg.text : null} />

      {/* template list */}
      <Card className="mb-5">
        <CardContent className="pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold">قالب‌های موجود ({faNumber(templates.length)})</h2>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => ({ message: await seedSanjeshBuiltinTemplates() }))}>
              درج قالب‌های پیش‌فرض در دیتابیس
            </Button>
          </div>
          <div className="overflow-auto rounded-xl border border-border">
            <table className="w-full text-right text-xs">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-2 font-bold">کلید</th>
                  <th className="p-2 font-bold">عنوان</th>
                  <th className="p-2 font-bold">نوع</th>
                  <th className="p-2 font-bold">سال</th>
                  <th className="p-2 font-bold">ستون</th>
                  <th className="p-2 font-bold">منبع</th>
                  <th className="p-2 font-bold">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.key} className="border-t border-border/50">
                    <td className="p-2 font-mono" dir="ltr">
                      {t.key}
                    </td>
                    <td className="p-2">{t.title}</td>
                    <td className="p-2" dir="ltr">
                      {t.examKind}
                    </td>
                    <td className="p-2 tabular-nums">{faNumber(t.examYear)}</td>
                    <td className="p-2 tabular-nums">{faNumber(t.columnCount)}</td>
                    <td className="p-2">
                      {t.verifiedWithRealFile ? (
                        <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                          اعتبارسنجی‌شده با فایل واقعی
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                          بدون نمونهٔ واقعی
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <Link to={`/admin/sanjesh/templates/${encodeURIComponent(t.key)}`} className="text-[11px] text-teal-700 hover:underline dark:text-teal-400">
                        ویرایش ستون‌ها
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* build from a sample file */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <h2 className="mb-1 text-sm font-bold">ساخت قالب از روی فایل</h2>
          <p className="mb-3 text-[11px] text-muted-foreground">
            فایل یک نمونه را بدهید؛ تعداد و طول ستون‌ها و نمونهٔ هر ستون استخراج می‌شود و یک قالب با ستون‌های عمومی ساخته
            می‌شود. بعد در صفحهٔ ویرایش، عنوان و فیلد مقصد هر ستون را تعیین کنید.
          </p>
          <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
            <label className="col-span-2 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-4">
              <span>فایل نمونه</span>
              <input ref={buildFileRef} type="file" accept=".txt,.dat,.csv,text/plain" className="text-xs" />
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-2">
              <span>کلید (انگلیسی بزرگ)</span>
              <input
                value={buildForm.key}
                onChange={(e) => setBuildForm((f) => ({ ...f, key: e.target.value }))}
                placeholder="FANI_1406"
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs"
                dir="ltr"
              />
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-3">
              <span>عنوان</span>
              <input
                value={buildForm.title}
                onChange={(e) => setBuildForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="کاردانی فنی ۱۴۰۶"
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs"
              />
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-1">
              <span>سال</span>
              <input
                value={buildForm.examYear}
                onChange={(e) => setBuildForm((f) => ({ ...f, examYear: e.target.value }))}
                inputMode="numeric"
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs"
                dir="ltr"
              />
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-1">
              <span>نوع</span>
              <select
                value={buildForm.examKind}
                onChange={(e) => setBuildForm((f) => ({ ...f, examKind: e.target.value }))}
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs"
                dir="ltr"
              >
                {EXAM_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" className="col-span-2 md:col-span-1" disabled={busy} onClick={buildFromFile}>
              ساخت
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* clone for a new year */}
      <Card>
        <CardContent className="pt-4">
          <h2 className="mb-1 text-sm font-bold">کپی قالب برای سال جدید</h2>
          <p className="mb-3 text-[11px] text-muted-foreground">
            قالب‌های پیش‌فرض قابل ویرایش نیستند؛ با کپی، یک نسخهٔ قابل ویرایش برای سال جدید بسازید و فیلدهای تغییر‌یافته را
            اصلاح کنید.
          </p>
          <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
            <label className="col-span-2 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-3">
              <span>قالب مبدأ</span>
              <select
                value={cloneForm.sourceKey}
                onChange={(e) => setCloneForm((f) => ({ ...f, sourceKey: e.target.value }))}
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs"
              >
                <option value="">—</option>
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.key} ({faNumber(t.columnCount)} ستون)
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-2">
              <span>کلید جدید</span>
              <input
                value={cloneForm.newKey}
                onChange={(e) => setCloneForm((f) => ({ ...f, newKey: e.target.value }))}
                placeholder="FANI_1406"
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs"
                dir="ltr"
              />
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-3">
              <span>عنوان</span>
              <input
                value={cloneForm.title}
                onChange={(e) => setCloneForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="کاردانی فنی ۱۴۰۶"
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs"
              />
            </label>
            <label className="col-span-1 flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground md:col-span-1">
              <span>سال</span>
              <input
                value={cloneForm.examYear}
                onChange={(e) => setCloneForm((f) => ({ ...f, examYear: e.target.value }))}
                inputMode="numeric"
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs"
                dir="ltr"
              />
            </label>
            <Button
              size="sm"
              className="col-span-2 md:col-span-3"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await cloneSanjeshTemplate({
                    sourceKey: cloneForm.sourceKey,
                    newKey: cloneForm.newKey.trim(),
                    title: cloneForm.title.trim(),
                    examYear: Number(cloneForm.examYear),
                  });
                  return { message: r.message, id: r.id };
                })
              }
            >
              کپی و ویرایش
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

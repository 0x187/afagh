import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getComplianceBundle,
  resetComplianceOverride,
  saveComplianceOverride,
  seed1402GraduateRegulations,
  type PolicyRow,
} from '@/lib/small-pages-api';

// ═══ /admin/compliance-policy — port of compliance-policy/page.tsx + CompliancePolicyClient.tsx ═══
// The layered regulation-compliance panel: legal defaults are the baseline, a
// reasoned admin override wins, and legacy config cannot bypass BINDING rules.
// The catalog and the resolution live in the Go service (small_pages.go).

function toText(kind: PolicyRow['kind'], v: unknown): string {
  if (v == null) return '';
  if (kind === 'list') return Array.isArray(v) ? v.map(String).join(', ') : String(v);
  if (kind === 'map') return typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
  return String(v);
}

function fromText(kind: PolicyRow['kind'], raw: string): unknown {
  if (kind === 'number') return raw.trim() === '' ? '' : Number(raw);
  if (kind === 'boolean') return raw === 'true';
  if (kind === 'map') return raw.trim();
  return raw;
}

function fmt(v: unknown): string {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.join('، ');
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'بله' : 'خیر';
  return String(v);
}

export function CompliancePolicyPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['compliance-policy'],
    queryFn: () => getComplianceBundle(),
  });
  const rows = data?.rows ?? [];
  const groups = data?.groups ?? [];
  const context = data?.context;

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [filter, setFilter] = useState('');

  const draftOf = (r: PolicyRow) => draft[r.key] ?? toText(r.kind, r.value);

  const visible = useMemo(
    () =>
      rows.filter((r) => !filter || `${r.label} ${r.key} ${r.reference} ${r.help}`.toLowerCase().includes(filter.toLowerCase())),
    [rows, filter],
  );

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['compliance-policy'] });
  };

  async function save(row: PolicyRow) {
    setBusy(row.key);
    setMsg(null);
    try {
      const res = await saveComplianceOverride({
        key: row.key,
        value: fromText(row.kind, draftOf(row)),
        reason: reason.trim() || (row.binding ? '' : 'تغییر پیکربندی از پنل انطباق آیین‌نامه'),
      });
      if (res.ok) {
        setMsg({ ok: true, text: `«${row.label}» ذخیره شد. تغییر با دلیل ثبت گردید و بلافاصله در موتورها اعمال می‌شود.` });
        await refresh();
      } else {
        setMsg({ ok: false, text: 'خطا در ذخیره.' });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'خطا در ذخیره.' });
    } finally {
      setBusy(null);
    }
  }

  async function reset(row: PolicyRow) {
    if (row.overrideId == null) return;
    setBusy(row.key);
    setMsg(null);
    try {
      const res = await resetComplianceOverride(row.overrideId);
      if (res.ok) {
        setMsg({ ok: true, text: `اورراید «${row.label}» حذف شد → بازگشت به پیش‌فرض قانونی.` });
        await refresh();
      } else {
        setMsg({ ok: false, text: 'خطا در حذف.' });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'خطا در حذف.' });
    } finally {
      setBusy(null);
    }
  }

  async function seed() {
    setBusy('__seed');
    setMsg(null);
    try {
      const res = await seed1402GraduateRegulations();
      if (res.ok) {
        setMsg({
          ok: true,
          text: `ردیف‌های ۱۴۰۲ تحصیلات تکمیلی: ${res.created.length} ایجاد، ${res.skipped.length} از پیش موجود.${res.created.length ? ' (' + res.created.join('، ') + ')' : ''}`,
        });
        await refresh();
      } else {
        setMsg({ ok: false, text: 'خطا در ایجاد ردیف‌ها.' });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'خطا در ایجاد ردیف‌ها.' });
    } finally {
      setBusy(null);
    }
  }

  const changed = (r: PolicyRow) => (draft[r.key] ?? '') !== toText(r.kind, r.value);

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !context)
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت سیاست‌های انطباق ناموفق بود.</CardContent></Card>;

  return (
    <div dir="rtl" className="space-y-5">
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-extrabold">انطباق آیین‌نامهٔ ۱۴۰۲ — سیاست‌های پیش‌فرض و قابل تغییر</h1>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                رفتارِ درست قانونی <b>پیش‌فرض</b> است. هر مقدار قابل اورراید دامنه‌دار است؛ برای تغییر احکام لازم‌الاجرا ثبت دلیل الزامی است.
                پیکربندی کهنه‌ای که قانون را نقض کند اعمال نمی‌شود و در همین صفحه به‌عنوان «تعارض» دیده می‌شود.
              </p>
            </div>
            <div className="flex gap-2">
              <span className="text-2xs bg-muted rounded-lg px-2 py-1 font-mono" dir="ltr">
                {context.family} / {context.level} / {context.entryYear} / U{context.universityId ?? '—'}
              </span>
              <button
                onClick={() => void seed()}
                disabled={busy === '__seed'}
                className="text-2xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy === '__seed' ? 'در حال ایجاد…' : 'ایجاد ردیف‌های ۱۴۰۲ ارشد/دکتری'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <label className="block md:col-span-2">
              <span className="text-2xs font-bold text-muted-foreground">دلیل تغییر (برای همهٔ ذخیره‌ها ثبت می‌شود)</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: بخشنامهٔ معاونت آموزشی شمارهٔ … / مصوبهٔ شورای آموزشی"
                className="mt-1 w-full border border-input bg-card rounded-lg px-3 py-2 text-xs"
              />
            </label>
            <label className="block">
              <span className="text-2xs font-bold text-muted-foreground">جستجوی سیاست</span>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="مادهٔ ۱۲، معدل، غیبت…"
                className="mt-1 w-full border border-input bg-card rounded-lg px-3 py-2 text-xs"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2 text-2xs">
            <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200 rounded-lg px-2 py-1">
              {rows.length} سیاست · {rows.filter((r) => r.binding).length} لازم‌الاجرا
            </span>
            <span className="bg-muted text-foreground/80 border border-border rounded-lg px-2 py-1">
              {data?.overrideCount ?? 0} اورراید فعال
            </span>
            <span className="bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200 rounded-lg px-2 py-1">
              {rows.filter((r) => r.legalConflict).length} تعارض پیکربندی قدیمی (اعمال نشد)
            </span>
          </div>
          {msg && (
            <div className={`text-xs rounded-lg px-3 py-2 border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200' : 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'}`}>
              {msg.text}
            </div>
          )}
        </CardContent>
      </Card>

      {groups.map((g) => {
        const list = visible.filter((r) => r.group === g);
        if (!list.length) return null;
        return (
          <Card key={g}>
            <CardContent className="space-y-3 pt-4">
              <h2 className="text-sm font-extrabold border-b border-border pb-2">{g}</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {list.map((r) => (
                  <div key={r.key} className={`rounded-xl border p-3 space-y-2 ${r.legalConflict ? 'border-amber-300 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/30' : 'border-border bg-muted/30'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold">{r.label}</div>
                        <div className="text-2xs text-muted-foreground font-mono" dir="ltr">{r.key}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`text-2xs rounded px-1.5 py-0.5 border font-bold ${r.source === 'override' ? 'bg-indigo-50 border-indigo-200 text-indigo-800 dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-200' : r.source === 'legal-guard' ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200' : 'bg-muted border-border text-foreground/80'}`}>
                          {r.sourceLabel}
                        </span>
                        {r.binding && <span className="text-2xs text-rose-700 dark:text-rose-300 font-bold">قانون لازم‌الاجرا</span>}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {r.kind === 'enum' ? (
                        <select
                          value={draftOf(r)}
                          onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })}
                          className="border border-input bg-card rounded-lg px-2 py-1.5 text-xs min-w-[16rem]"
                        >
                          {(r.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : r.kind === 'boolean' ? (
                        <select
                          value={draftOf(r)}
                          onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })}
                          className="border border-input bg-card rounded-lg px-2 py-1.5 text-xs"
                        >
                          <option value="true">بله</option><option value="false">خیر</option>
                        </select>
                      ) : r.kind === 'map' ? (
                        <textarea
                          value={draftOf(r)}
                          onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })}
                          rows={4}
                          dir="ltr"
                          className="w-full border border-input bg-card rounded-lg px-2 py-1.5 text-2xs font-mono"
                        />
                      ) : (
                        <input
                          type={r.kind === 'number' ? 'number' : 'text'}
                          min={r.min}
                          max={r.max}
                          value={draftOf(r)}
                          onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })}
                          className="w-full border border-input bg-card rounded-lg px-2 py-1.5 text-xs"
                        />
                      )}
                    </div>

                    <div className="text-2xs text-muted-foreground leading-relaxed">{r.help}</div>
                    <div className="text-2xs text-muted-foreground/80 leading-relaxed">مستند: {r.reference}</div>
                    <div className="text-2xs bg-card border border-border rounded-lg px-2 py-1">
                      پیش‌فرض قانونی: <b>{fmt(r.legal)}</b>
                      {r.legalConflict && (
                        <span className="text-amber-700 dark:text-amber-300"> · مقدار قدیمی کنارگذاشته‌شده: <b dir="ltr">{fmt(r.shadowed)}</b></span>
                      )}
                    </div>
                    {r.overrideId != null && (
                      <div className="text-2xs text-indigo-700 dark:text-indigo-300">دلیل اورراید: {r.overrideReason}</div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => void save(r)}
                        disabled={!changed(r) || busy === r.key}
                        className="text-2xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                      >
                        {busy === r.key ? 'در حال ذخیره…' : 'ذخیرهٔ اورراید'}
                      </button>
                      {r.overrideId != null && (
                        <button
                          onClick={() => void reset(r)}
                          disabled={busy === r.key}
                          className="text-2xs font-bold px-3 py-1.5 rounded-lg bg-card border border-input text-foreground/80 hover:bg-muted"
                        >
                          بازگشت به پیش‌فرض قانونی
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

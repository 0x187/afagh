import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, RefreshCw, X } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, toEnDigits } from '@/lib/fa';
import {
  advanceDossier,
  alumniRequests,
  autoClearance,
  deleteDepartment,
  deliverDegree,
  getDossier,
  getGraduationSeed,
  headApprove,
  holdDossier,
  issueDegree,
  requestMinistryCode,
  resolveAlumni,
  resumeDossier,
  runIrandoc,
  saveDepartment,
  scanGraduation,
  setClearance,
  startClearance,
  waiveSajjad,
  type AlumniRow,
  type ChecklistItem,
  type Dossier,
  type GradDept,
  type GradRow,
  type GradStep,
} from '@/lib/graduation-api';

// ═══ Graduation and document issuance desk — port of admin/graduation ═══

const STATUS_STYLE: Record<string, string> = {
  CATALOG_REVIEW: 'border-slate-300 bg-slate-100 text-slate-700',
  HEAD_APPROVAL: 'border-amber-300 bg-amber-100 text-amber-800',
  IRANDOC_VERIFICATION: 'border-violet-300 bg-violet-100 text-violet-800',
  CLEARANCE: 'border-sky-300 bg-sky-100 text-sky-800',
  SAJJAD_REQUEST: 'border-indigo-300 bg-indigo-100 text-indigo-800',
  FINAL_DOCS: 'border-orange-300 bg-orange-100 text-orange-800',
  READY_TO_ISSUE: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  ISSUED: 'border-emerald-800 bg-emerald-700 text-white',
  ON_HOLD: 'border-rose-300 bg-rose-100 text-rose-800',
};

const CLEAR_STYLE: Record<string, string> = {
  PENDING: 'border-slate-300 bg-slate-100 text-slate-600',
  CLEARED: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  HAS_DEBT: 'border-rose-300 bg-rose-100 text-rose-800',
  WAIVED: 'border-indigo-300 bg-indigo-100 text-indigo-800',
};

const CLEAR_LABEL: Record<string, string> = {
  PENDING: 'در انتظار', CLEARED: 'تسویه شد', HAS_DEBT: 'بدهی دارد', WAIVED: 'معاف',
};

const ALUMNI_STATUS: Record<string, string> = {
  AWAITING_PAYMENT: 'در انتظار پرداخت', PAID: 'پرداخت‌شده', IN_REVIEW: 'در حال بررسی',
  DONE: 'انجام شد', REJECTED: 'رد شد',
};

const DEGREE_LABEL: Record<string, string> = {
  TEMPORARY: 'گواهینامهٔ موقت', PERMANENT: 'دانشنامه (اصل)', TRANSCRIPT: 'ریزنمرات رسمی',
};

function dt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return '—';
  }
}

const money = (n: number | null | undefined) => `${faNumber(n ?? 0)} ریال`;

export function AdminGraduationPage() {
  const qc = useQueryClient();
  const seed = useQuery({ queryKey: ['graduation-seed'], queryFn: getGraduationSeed, staleTime: 20_000 });
  const [tab, setTab] = useState<'PIPELINE' | 'DEPTS' | 'ALUMNI'>('PIPELINE');
  const [filter, setFilter] = useState('ALL');
  const [q, setQ] = useState('');
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [alumniFilter, setAlumniFilter] = useState('ALL');

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['graduation-seed'] });
  };

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا در انجام عملیات.' });
    } finally {
      setBusy(false);
    }
  };

  const scanMut = useMutation({
    mutationFn: () => scanGraduation({ force: true }),
    onSuccess: async (r) => {
      setMsg({ kind: 'ok', text: `پویش انجام شد: ${faNumber(r.scan.scanned)} بررسی، ${faNumber(r.scan.opened)} پروندهٔ جدید.` });
      await refresh();
    },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  const openDossier = (id: number) =>
    withBusy(async () => {
      setDossier(await getDossier(id));
    });

  if (seed.isLoading) return <Skeleton className="h-80 w-full" />;
  if (seed.isError || !seed.data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت میز فارغ‌التحصیلی ناموفق بود.</CardContent></Card>;
  }

  const { rows, stats, departments, alumniRequests: alumni, services, steps } = seed.data;
  const needle = toEnDigits(q.trim());
  const filtered = rows.filter((r) =>
    (filter === 'ALL' || r.workflowStatus === filter) &&
    (!needle || toEnDigits(r.studentCode).includes(needle) || r.fullName.includes(q.trim())),
  );

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-emerald-800 to-teal-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black sm:text-xl"><GraduationCap className="size-5" aria-hidden /> فارغ‌التحصیلی، تسویه‌حساب و صدور مدارک</h1>
          <p className="mt-1 text-[11px] leading-6 text-emerald-100 sm:text-xs">
            سامانه رویدادمحور است: با قطعی‌شدن آخرین نمره، پروندهٔ دانشجو خودکار باز می‌شود، به کارتابل مدیر گروه می‌رود،
            استعلام ایرانداک گرفته می‌شود و تسویه‌حساب همهٔ دپارتمان‌ها هم‌زمان شروع می‌شود. دانشجو فقط نوار پیشرفت را می‌بیند.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="border-white/25 bg-white/15 text-white hover:bg-white/25" disabled={scanMut.isPending} onClick={() => scanMut.mutate()}>
              <RefreshCw className="size-4" aria-hidden /> اجرای پویش خودکار فارغ‌التحصیلی
            </Button>
            <span className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold">
              مدارک صادرشده: {faNumber(stats.issuedDocs)} — تحویل‌نشده: {faNumber(stats.undelivered)}
            </span>
          </div>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>
          {msg.text}
          <button type="button" className="float-left text-muted-foreground" onClick={() => setMsg(null)}><X className="size-3.5" aria-hidden /><span className="sr-only">بستن</span></button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-9">
        {stats.steps.map((s) => (
          <button
            key={s.code}
            type="button"
            onClick={() => setFilter(s.code)}
            className={`rounded-xl border-2 bg-card p-3 text-right shadow-xs transition ${filter === s.code ? 'border-emerald-600' : 'border-transparent'}`}
          >
            <div className="text-[10px] font-bold leading-4 text-muted-foreground">{s.title}</div>
            <div className="text-lg font-black">{faNumber(s.count)}</div>
          </button>
        ))}
        <button type="button" onClick={() => setFilter('ON_HOLD')} className={`rounded-xl border-2 bg-card p-3 text-right shadow-xs ${filter === 'ON_HOLD' ? 'border-rose-600' : 'border-transparent'}`}>
          <div className="text-[10px] font-bold leading-4 text-rose-600">متوقف‌شده</div>
          <div className="text-lg font-black text-rose-700 dark:text-rose-300">{faNumber(stats.onHold)}</div>
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {([['PIPELINE', '🎓 پرونده‌ها'], ['DEPTS', '🏛️ دپارتمان‌های تسویه'], ['ALUMNI', '💼 خدمات دانش‌آموختگان']] as const).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded-xl border px-4 py-2 text-xs font-black ${tab === k ? 'border-emerald-800 bg-emerald-700 text-white' : 'border-border bg-card text-muted-foreground'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === 'PIPELINE' ? (
        <Card className="p-0">
          <CardContent className="p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی نام یا شمارهٔ دانشجویی…" className="w-64 text-xs" />
              <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 rounded-lg border border-input bg-card px-2 text-xs font-bold">
                <option value="ALL">همهٔ وضعیت‌ها</option>
                {steps.map((s) => <option key={s.code} value={s.code}>{s.title}</option>)}
                <option value="ON_HOLD">متوقف‌شده</option>
              </select>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>به‌روزرسانی</Button>
              <span className="text-[11px] font-bold text-muted-foreground">{faNumber(filtered.length)} پرونده</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-[11px] sm:text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    {['دانشجو', 'رشته / مقطع', 'واحد', 'معدل', 'مدیر گروه', 'ایرانداک', 'وضعیت', 'آخرین رویداد', ''].map((h) => (
                      <th key={h} className="whitespace-nowrap p-2 text-right font-black">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r: GradRow) => (
                    <tr key={r.id} className="border-t border-border/50 hover:bg-muted/40">
                      <td className="p-2">
                        <div className="font-black">{r.fullName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{faDigits(r.studentCode)}</div>
                      </td>
                      <td className="p-2">{r.majorName ?? '—'}<div className="text-[10px] text-muted-foreground">{r.degreeTitle ?? ''}</div></td>
                      <td className="p-2 font-mono">{faNumber(r.passedUnits)}/{faNumber(r.requiredUnits)}</td>
                      <td className="p-2 font-mono">{r.gpa == null ? '—' : faNumber(r.gpa)}</td>
                      <td className="p-2">{r.headApproved ? '✅' : '⏳'}</td>
                      <td className="p-2">{!r.thesisRequired ? '—' : r.irandocStatus === 'PASSED' ? '✅' : r.irandocStatus === 'REJECTED' ? '⛔' : '⏳'}</td>
                      <td className="p-2">
                        <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-black ${STATUS_STYLE[r.workflowStatus] ?? 'border-slate-300 bg-slate-100'}`}>
                          {steps.find((s) => s.code === r.workflowStatus)?.title ?? r.workflowStatus}
                        </span>
                      </td>
                      <td className="p-2 text-[10px] text-muted-foreground">{dt(r.lastEventAt)}</td>
                      <td className="p-2">
                        <Button size="sm" className="h-7 px-2 text-[10px]" onClick={() => void openDossier(r.id)}>پرونده</Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr><td colSpan={9} className="p-6 text-center font-bold text-muted-foreground">پرونده‌ای با این فیلتر نیست. برای باز شدن خودکار پرونده‌ها «اجرای پویش» را بزنید.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'DEPTS' ? (
        <DeptsTab
          depts={departments}
          busy={busy}
          onSaved={async (deps, text) => { setMsg({ kind: 'ok', text }); await refresh(); void deps; }}
          onError={(text) => setMsg({ kind: 'err', text })}
        />
      ) : null}

      {tab === 'ALUMNI' ? (
        <AlumniTab
          rows={alumni}
          services={services}
          busy={busy}
          filter={alumniFilter}
          onFilter={(s) => setAlumniFilter(s)}
          onResolve={(input, okText) =>
            withBusy(async () => {
              await resolveAlumni(input);
              setMsg({ kind: 'ok', text: okText });
              await refresh();
            })
          }
          onReload={async () => {
            await alumniRequests(alumniFilter);
            await refresh();
          }}
        />
      ) : null}

      {dossier ? (
        <DossierDrawer
          d={dossier}
          steps={steps}
          busy={busy}
          onClose={() => setDossier(null)}
          onDossier={(d) => {
            if (d) setDossier(d);
            void refresh();
          }}
          onMsg={(kind, text) => setMsg({ kind, text })}
        />
      ) : null}
    </div>
  );
}

function DeptsTab({ depts, busy, onSaved, onError }: {
  depts: GradDept[];
  busy: boolean;
  onSaved: (deps: GradDept[], text: string) => Promise<void>;
  onError: (text: string) => void;
}) {
  const empty = { id: undefined as number | undefined, code: '', title: '', autoCheck: 'NONE', apiUrl: '', responsibleRoleCode: '', sortOrder: 100, isActive: true, hint: '' };
  const [form, setForm] = useState(empty);

  async function save() {
    try {
      const deps = await saveDepartment({
        id: form.id, code: form.code, title: form.title, autoCheck: form.autoCheck,
        apiUrl: form.apiUrl || undefined, responsibleRoleCode: form.responsibleRoleCode || undefined,
        sortOrder: Number(form.sortOrder), isActive: form.isActive, hint: form.hint || undefined,
      });
      await onSaved(deps, 'دپارتمان ذخیره شد.');
      setForm(empty);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'ذخیره ناموفق بود.');
    }
  }

  async function remove(id: number) {
    try {
      await deleteDepartment(id);
      await onSaved([], 'دپارتمان غیرفعال شد.');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'حذف ناموفق بود.');
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardContent className="overflow-x-auto pt-4">
          <h3 className="mb-2 text-xs font-black">دپارتمان‌های تسویه‌حساب (کاملاً قابل پیکربندی)</h3>
          <table className="w-full border-collapse text-right text-[11px]">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>{['کد', 'عنوان', 'بررسی خودکار', 'نقش مسئول', 'ترتیب', 'فعال', ''].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr>
            </thead>
            <tbody>
              {[...depts].sort((a, b) => a.sortOrder - b.sortOrder).map((d) => (
                <tr key={d.id} className="border-t border-border/50">
                  <td className="p-2 font-mono" dir="ltr">{d.code}</td>
                  <td className="p-2 font-bold">{d.title}</td>
                  <td className="p-2">{d.autoCheck === 'FINANCE_LEDGER' ? 'از دفتر مالی' : d.autoCheck === 'HTTP_API' ? 'سرویس بیرونی' : 'دستی'}</td>
                  <td className="p-2 font-mono text-[10px]" dir="ltr">{d.responsibleRoleCode ?? '—'}</td>
                  <td className="p-2">{faNumber(d.sortOrder)}</td>
                  <td className="p-2">{d.isActive ? '✅' : '⛔'}</td>
                  <td className="flex gap-1 p-2">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setForm({
                      id: d.id, code: d.code, title: d.title, autoCheck: d.autoCheck,
                      apiUrl: d.apiUrl ?? '', responsibleRoleCode: d.responsibleRoleCode ?? '',
                      sortOrder: d.sortOrder, isActive: d.isActive, hint: d.hint ?? '',
                    })}>ویرایش</Button>
                    <Button size="sm" variant="destructive" className="h-6 px-2 text-[10px]" onClick={() => void remove(d.id)}>غیرفعال</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
            «از دفتر مالی» یعنی سیستم خودش مانده بدهی را حساب می‌کند و اگر صفر بود بدون دخالت کارشناس سبز می‌شود.
            «سرویس بیرونی» برای کتابخانه/خوابگاه است: نشانی API باید پاسخ JSON با کلیدهای cleared و amountDue بدهد.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <h3 className="text-xs font-black">{form.id ? 'ویرایش دپارتمان' : 'دپارتمان جدید'}</h3>
          {([['code', 'کد لاتین'], ['title', 'عنوان فارسی'], ['responsibleRoleCode', 'کد نقش مسئول'], ['apiUrl', 'نشانی سرویس استعلام'], ['hint', 'راهنما']] as const).map(([k, l]) => (
            <label key={k} className="block">
              <span className="text-[10px] font-bold text-muted-foreground">{l}</span>
              <Input value={String(form[k] ?? '')} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-0.5 h-8 text-[11px]" dir={k === 'code' || k === 'responsibleRoleCode' || k === 'apiUrl' ? 'ltr' : 'auto'} />
            </label>
          ))}
          <label className="block">
            <span className="text-[10px] font-bold text-muted-foreground">نوع بررسی</span>
            <select value={form.autoCheck} onChange={(e) => setForm({ ...form, autoCheck: e.target.value })} className="mt-0.5 h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
              <option value="NONE">دستی (کارشناس)</option>
              <option value="FINANCE_LEDGER">خودکار از دفتر مالی</option>
              <option value="HTTP_API">خودکار از سرویس بیرونی</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold text-muted-foreground">ترتیب نمایش</span>
            <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} className="mt-0.5 h-8 text-[11px]" dir="ltr" />
          </label>
          <label className="flex items-center gap-2 text-[11px] font-bold">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> فعال
          </label>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" disabled={busy} onClick={() => void save()}>ذخیره</Button>
            <Button size="sm" variant="outline" onClick={() => setForm(empty)}>جدید</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AlumniTab({ rows, services, busy, filter, onFilter, onResolve, onReload }: {
  rows: AlumniRow[];
  services: { code: string; title: string; hint: string; fee: number }[];
  busy: boolean;
  filter: string;
  onFilter: (s: string) => void;
  onResolve: (input: { requestId: number; status: 'IN_REVIEW' | 'DONE' | 'REJECTED'; note?: string }, okText: string) => void;
  onReload: () => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const visible = filter === 'ALL' ? rows : rows.filter((r) => r.status === filter);
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-4">
          <h3 className="mb-2 text-xs font-black">تعرفهٔ خدمات (از تنظیمات سامانه خوانده می‌شود)</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {services.map((s) => (
              <div key={s.code} className="rounded-xl border border-border bg-card p-2">
                <div className="text-[11px] font-black">{s.title}</div>
                <div className="text-[10px] text-muted-foreground">{s.hint}</div>
                <div className="mt-1 text-[11px] font-black text-emerald-700 dark:text-emerald-300">{s.fee > 0 ? money(s.fee) : 'رایگان'}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto pt-4">
          <div className="mb-2 flex flex-wrap gap-2">
            {['ALL', 'AWAITING_PAYMENT', 'PAID', 'IN_REVIEW', 'DONE', 'REJECTED'].map((s) => (
              <button key={s} type="button" onClick={() => { onFilter(s); void onReload(); }} className={`rounded-lg px-2 py-1 text-[10px] font-black ${filter === s ? 'bg-emerald-700 text-white' : 'bg-muted text-muted-foreground'}`}>
                {s === 'ALL' ? 'همه' : ALUMNI_STATUS[s]}
              </button>
            ))}
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت کارشناس برای اقدام بعدی" className="h-8 max-w-sm flex-1 text-[10px]" />
          </div>
          <table className="w-full border-collapse text-right text-[11px]">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>{['کد رهگیری', 'دانش‌آموخته', 'خدمت', 'مقصد', 'هزینه', 'وضعیت', 'تاریخ', 'اقدام'].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-border/50">
                  <td className="p-2 font-mono" dir="ltr">{r.trackingCode}</td>
                  <td className="p-2 font-bold">{r.fullName}<div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{faDigits(r.studentCode)}</div></td>
                  <td className="p-2">{services.find((s) => s.code === r.requestType)?.title ?? r.requestType}</td>
                  <td className="p-2">{r.destination ?? '—'}</td>
                  <td className="p-2 font-mono">{r.fee ? money(r.fee) : 'رایگان'}</td>
                  <td className="p-2 font-bold">{ALUMNI_STATUS[r.status] ?? r.status}</td>
                  <td className="p-2 text-[10px]">{dt(r.createdAt)}</td>
                  <td className="flex gap-1 p-2">
                    <Button size="sm" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => onResolve({ requestId: r.id, status: 'DONE', note: note || undefined }, 'انجام شد.')}>انجام شد</Button>
                    <Button size="sm" variant="destructive" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => onResolve({ requestId: r.id, status: 'REJECTED', note: note || undefined }, 'رد شد.')}>رد</Button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 ? <tr><td colSpan={8} className="p-6 text-center font-bold text-muted-foreground">درخواستی ثبت نشده است.</td></tr> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-2">
      <div className="text-[10px] font-bold text-muted-foreground">{label}</div>
      <div className="text-[11px] font-black">{value}</div>
    </div>
  );
}

function DossierDrawer({ d, steps, busy, onClose, onDossier, onMsg }: {
  d: Dossier;
  steps: GradStep[];
  busy: boolean;
  onClose: () => void;
  onDossier: (d: Dossier | null) => void;
  onMsg: (kind: 'ok' | 'err', text: string) => void;
}) {
  const a = d.audit;
  const [note, setNote] = useState('');
  const [tracking, setTracking] = useState(a.irandocTrackingCode ?? '');
  const [title, setTitle] = useState(a.thesisTitle ?? '');
  const [holdReason, setHoldReason] = useState('');
  const [deliverTo, setDeliverTo] = useState('');
  const stepIdx = steps.findIndex((s) => s.code === a.workflowStatus);

  const act = async (fn: () => Promise<Dossier | null>, okText?: string) => {
    try {
      const next = await fn();
      if (next) onDossier(next);
      else onDossier(null);
      if (okText) onMsg('ok', okText);
    } catch (e) {
      onMsg('err', e instanceof Error ? e.message : 'خطا در انجام عملیات.');
    }
  };

  const clearanceSummary = useMemo(() => ({
    total: d.checklist.length,
    open: d.checklist.filter((c) => c.status !== 'CLEARED' && c.status !== 'WAIVED').length,
  }), [d.checklist]);

  const ministry = a.note?.startsWith('کد صحت') ? a.note.replace('کد صحت: ', '') : '';

  return (
    <div className="fixed inset-0 z-50 flex justify-start bg-black/40" dir="rtl" onClick={onClose}>
      <div className="h-full w-full max-w-3xl space-y-3 overflow-y-auto bg-background p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-black">{d.student.fullName}</h2>
            <p className="font-mono text-[11px] text-muted-foreground" dir="ltr">{faDigits(d.student.studentCode)} — {d.student.majorName ?? '—'} / {d.student.degreeTitle ?? '—'}</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground"><X className="size-5" aria-hidden /><span className="sr-only">بستن</span></button>
        </div>

        <Card>
          <CardContent className="overflow-x-auto pt-4">
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {steps.map((s, i) => (
                <Fragment key={s.code}>
                  <div className={`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-black ${
                    i < stepIdx ? 'border-emerald-700 bg-emerald-600 text-white'
                      : i === stepIdx ? 'border-amber-500 bg-amber-400 text-amber-950'
                        : 'border-border bg-card text-muted-foreground'}`}>
                    {s.title}
                  </div>
                  {i < steps.length - 1 ? <span className="text-muted-foreground">‹</span> : null}
                </Fragment>
              ))}
            </div>
            {a.workflowStatus === 'ON_HOLD' ? <div className="mt-2 text-[11px] font-black text-rose-700 dark:text-rose-300">⛔ پرونده متوقف است: {a.note}</div> : null}
          </CardContent>
        </Card>

        {/* 1) Syllabus matching */}
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-xs font-black">۱) تطبیق سرفصل (خودکار)</h3>
            <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
              <Info label="واحد گذرانده" value={faNumber(a.passedUnits)} />
              <Info label="حداقل واحد" value={faNumber(a.requiredUnits)} />
              <Info label="معدل کل" value={a.gpa == null ? '—' : faNumber(a.gpa)} />
              <Info label="کامل بودن سرفصل" value={a.catalogOk ? '✅ کامل' : '⛔ ناقص'} />
            </div>
            {a.missingCourses.length > 0 ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                <b>دروس باقی‌مانده:</b> {a.missingCourses.map((c) => `${c.title} (${c.code})`).join('، ')}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* 2) Group manager */}
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-xs font-black">۲) تأیید مدیر گروه</h3>
            {a.headApprovalStatus ? (
              <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">✅ تأیید شد در {dt(a.headApprovedAt)} {a.headNote ? `— ${a.headNote}` : ''}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت مدیر گروه (اختیاری)" className="h-8 min-w-48 flex-1 text-[11px]" />
                <Button size="sm" disabled={busy} onClick={() => void act(() => headApprove(a.id, note || undefined), 'تأیید مدیر گروه ثبت شد؛ مراحل بعد خودکار آغاز شد.')}>تأیید و ارجاع خودکار</Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-1">
              <Input value={holdReason} onChange={(e) => setHoldReason(e.target.value)} placeholder="دلیل توقف پرونده" className="h-8 min-w-48 flex-1 text-[11px]" />
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => void act(() => holdDossier(a.id, holdReason), 'پرونده متوقف شد.')}>توقف</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => resumeDossier(a.id), 'پرونده از سر گرفته شد.')}>رفع توقف</Button>
            </div>
          </CardContent>
        </Card>

        {/* 3) Irandoc */}
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-xs font-black">۳) همانندجویی ایرانداک {a.thesisRequired ? '(الزامی برای این مقطع)' : '(این مقطع پایان‌نامه ندارد)'}</h3>
            {a.thesisRequired ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="کد رهگیری ثبت پایان‌نامه" className="h-8 text-[11px]" dir="ltr" />
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان پایان‌نامه" className="h-8 text-[11px]" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" className="bg-violet-700 text-white hover:bg-violet-800" disabled={busy} onClick={() => void act(async () => {
                    const r = await runIrandoc(a.id, tracking, title);
                    onMsg(r.result?.passed ? 'ok' : 'err', r.result?.message ?? 'استعلام انجام شد.');
                    return r.dossier;
                  })}>استعلام خودکار ایرانداک</Button>
                  <span className="text-[11px] font-bold text-muted-foreground">
                    وضعیت: {a.irandocStatus ?? '—'} — درصد همانندی: {a.irandocSimilarityScore == null ? '—' : faNumber(a.irandocSimilarityScore)}
                  </span>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* 4) Parallel settlement */}
        <Card>
          <CardContent className="space-y-2 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-black">۴) تسویه‌حساب موازی ({faNumber(clearanceSummary.total - clearanceSummary.open)} از {faNumber(clearanceSummary.total)} تسویه)</h3>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 bg-sky-700 px-2 text-[10px] text-white hover:bg-sky-800" disabled={busy} onClick={() => void act(() => startClearance(a.id), 'تسویه‌حساب برای همهٔ دپارتمان‌ها آغاز شد.')}>آغاز/تکمیل چک‌لیست</Button>
                <Button size="sm" className="h-7 px-2 text-[10px]" disabled={busy} onClick={() => void act(async () => {
                  const r = await autoClearance(a.id);
                  onMsg('ok', `بررسی خودکار: ${faNumber(r.result?.autoCleared ?? 0)} تسویه، ${faNumber(r.result?.withDebt ?? 0)} بدهی.`);
                  return r.dossier;
                })}>بررسی خودکار مجدد</Button>
              </div>
            </div>
            {d.checklist.length === 0 ? <p className="text-[11px] font-bold text-muted-foreground">هنوز چک‌لیستی ساخته نشده است.</p> : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {d.checklist.map((c: ChecklistItem) => (
                <div key={c.id} className="space-y-1 rounded-xl border border-border bg-card p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black">{c.title}</span>
                    <span className={`rounded border px-2 py-0.5 text-[10px] font-black ${CLEAR_STYLE[c.status] ?? ''}`}>
                      {CLEAR_LABEL[c.status] ?? c.status}{c.autoChecked ? ' (خودکار)' : ''}
                    </span>
                  </div>
                  {c.amountDue > 0 ? <div className="text-[10px] font-bold text-rose-700 dark:text-rose-300">بدهی: {money(c.amountDue)}</div> : null}
                  {c.detail ? <div className="text-[10px] leading-4 text-muted-foreground">{c.detail}</div> : null}
                  <div className="flex flex-wrap gap-1">
                    {(['CLEARED', 'HAS_DEBT', 'WAIVED'] as const).map((s) => (
                      <button key={s} type="button" disabled={busy} onClick={() => void act(() => setClearance({ checklistId: c.id, auditId: a.id, status: s, detail: `ثبت دستی کارشناس (${CLEAR_LABEL[s]})` }))} className="rounded bg-muted px-2 py-0.5 text-[10px] font-bold hover:bg-accent">
                        {CLEAR_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 5) Sajjad */}
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-xs font-black">۵) درخواست کد صحت در سجاد (اقدام دانشجو)</h3>
            <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
              <Info label="وضعیت" value={a.sajjadStatus === 'CONFIRMED' ? '✅ کد صحت دریافت شد' : a.sajjadStatus === 'SKIPPED' ? '➖ معاف' : a.sajjadRequestCode ? '⏳ ثبت‌شده توسط دانشجو' : '⏳ در انتظار اقدام دانشجو'} />
              <Info label="کد رهگیری سجاد" value={a.sajjadRequestCode ?? '—'} />
              <Info label="تاریخ ثبت" value={dt(a.sajjadRequestedAt)} />
            </div>
            <p className="text-[10px] leading-5 text-muted-foreground">تا وقتی دانشجو کد رهگیری درخواست سجاد را ثبت نکند، پرونده به کارشناس صدور مدرک ارجاع نمی‌شود و «دریافت کد صحت» نیز مسدود است.</p>
            <Button size="sm" variant="secondary" className="h-7 text-[10px]" disabled={busy} onClick={() => void act(() => waiveSajjad(a.id, 'معافیت از گام سجاد توسط کارشناس'), 'گام سجاد معاف شد.')}>معاف‌کردن از گام سجاد</Button>
          </CardContent>
        </Card>

        {/* 6) Final documents and issuance */}
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-xs font-black">۶) مدارک پایانی و صدور</h3>
            <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
              <Info label="عکس ۴×۳" value={a.photoDocumentId ? '✅ بارگذاری شد' : '⏳ در انتظار دانشجو'} />
              <Info label="تمبر ابطال" value={a.stampFeeAmount <= 0 ? 'غیرفعال' : a.stampFeePaid ? '✅ پرداخت شد' : `⏳ ${money(a.stampFeeAmount)}`} />
              <Info label="کد صحت وزارت" value={ministry || '—'} />
              <Info label="وضعیت" value={steps.find((s) => s.code === a.workflowStatus)?.title ?? a.workflowStatus} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" className="h-7 text-[10px]" disabled={busy} onClick={() => void act(() => advanceDossier(a.id), 'وضعیت پرونده بازمحاسبه شد.')}>بازمحاسبهٔ وضعیت</Button>
              <Button size="sm" className="h-7 text-[10px]" disabled={busy} onClick={() => void act(() => issueDegree({ auditId: a.id, degreeType: 'TEMPORARY' }).then((r) => { onMsg('ok', `گواهینامهٔ موقت صادر شد (${r.serialNo}).`); return r.dossier; }))}>صدور گواهینامهٔ موقت</Button>
              <Button size="sm" className="h-7 bg-indigo-700 text-[10px] text-white hover:bg-indigo-800" disabled={busy} onClick={() => void act(async () => {
                const r = await requestMinistryCode(a.id);
                onMsg('ok', `کد صحت دریافت شد: ${r.code}${r.online ? '' : ' (محلی — سرویس سجاد پیکربندی نشده)'}`);
                return r.dossier;
              })}>دریافت کد صحت (سجاد)</Button>
              <Button size="sm" className="h-7 bg-indigo-900 text-[10px] text-white hover:bg-indigo-950" disabled={busy} onClick={() => void act(() => issueDegree({ auditId: a.id, degreeType: 'PERMANENT', ministryVerificationCode: ministry || undefined }).then((r) => { onMsg('ok', `دانشنامه صادر شد (${r.serialNo}).`); return r.dossier; }))}>صدور دانشنامهٔ اصلی</Button>
              <Button size="sm" className="h-7 bg-slate-700 text-[10px] text-white hover:bg-slate-800" disabled={busy} onClick={() => void act(() => issueDegree({ auditId: a.id, degreeType: 'TRANSCRIPT' }).then((r) => { onMsg('ok', `ریزنمرات رسمی صادر شد (${r.serialNo}).`); return r.dossier; }))}>صدور ریزنمرات رسمی</Button>
            </div>

            {d.degrees.length > 0 ? (
              <table className="mt-2 w-full border-collapse text-right text-[10px]">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>{['نوع', 'سریال', 'کد استعلام', 'کد صحت', 'تاریخ', 'تحویل'].map((h) => <th key={h} className="p-1 text-right font-black">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {d.degrees.map((g) => (
                    <tr key={g.id} className="border-t border-border/50">
                      <td className="p-1 font-bold">{DEGREE_LABEL[g.degreeType] ?? g.degreeType}</td>
                      <td className="p-1 font-mono" dir="ltr">{g.serialNo}</td>
                      <td className="p-1 font-mono">
                        <a className="text-emerald-700 underline dark:text-emerald-300" href={`/verify-degree/${g.verifyCode}`} target="_blank" rel="noreferrer" dir="ltr">{g.verifyCode}</a>
                      </td>
                      <td className="p-1 font-mono" dir="ltr">{g.ministryVerificationCode ?? '—'}</td>
                      <td className="p-1">{dt(g.issuedAt)}</td>
                      <td className="p-1">
                        {g.isDelivered ? '✅' : (
                          <span className="flex gap-1">
                            <Input value={deliverTo} onChange={(e) => setDeliverTo(e.target.value)} placeholder="تحویل به" className="h-6 w-24 text-[10px]" />
                            <Button size="sm" variant="secondary" className="h-6 px-1.5 text-[10px]" disabled={busy} onClick={() => void act(() => deliverDegree(g.id, a.id, deliverTo), 'تحویل ثبت شد.')}>ثبت</Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </CardContent>
        </Card>

        {/* 7) Messages */}
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-xs font-black">۷) پیام‌های ارسال‌شده به دانشجو</h3>
            {d.deliveries.length === 0 ? (
              <p className="text-[11px] font-bold text-muted-foreground">هنوز پیام بیرونی‌ای ارسال نشده است. کانال‌ها و سرویس پیامک در «تنظیمات ← پیامک و ربات‌های پیام‌رسان» پیکربندی می‌شوند.</p>
            ) : (
              <table className="w-full border-collapse text-right text-[10px]">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>{['رویداد', 'کانال', 'گیرنده', 'نتیجه', 'زمان'].map((h) => <th key={h} className="p-1 text-right font-black">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {d.deliveries.map((v) => (
                    <tr key={v.id} className="border-t border-border/50">
                      <td className="p-1 font-mono" dir="ltr">{v.eventCode}</td>
                      <td className="p-1 font-bold">{v.channelLabel}</td>
                      <td className="p-1 font-mono" dir="ltr">{v.target ?? '—'}</td>
                      <td className="p-1">
                        <span className={`rounded px-1.5 py-0.5 font-black ${v.status === 'SENT' ? 'bg-emerald-100 text-emerald-800' : v.status === 'FAILED' ? 'bg-rose-100 text-rose-800' : 'bg-muted text-muted-foreground'}`}>
                          {v.status === 'SENT' ? 'ارسال شد' : v.status === 'FAILED' ? 'ناموفق' : 'ارسال نشد'}
                        </span>
                        {v.error ? <div className="mt-0.5 text-[9px] text-muted-foreground">{v.error}</div> : null}
                      </td>
                      <td className="p-1">{dt(v.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

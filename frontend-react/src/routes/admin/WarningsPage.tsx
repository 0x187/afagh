import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { faDigits, faNumber } from '@/lib/fa';
import {
  createWarning,
  deleteWarning,
  listWarnings,
  searchWarningStudents,
  updateWarning,
  type WarningFilters,
  type WarningRow,
  type WarningStudentHit,
} from '@/lib/warnings-api';

// ═══ Scheduled warnings — port of admin/warnings ═══

const WARNING_STATUSES = ['pending', 'sent', 'cancelled'] as const;
const WARNING_TYPES = [
  'TUITION_DEADLINE', 'LOW_ATTENDANCE', 'MISSING_DOCS',
  'EXAM_REMINDER', 'ENROLL_DEADLINE', 'CUSTOM',
] as const;

const WARNING_TYPE_LABEL: Record<string, string> = {
  TUITION_DEADLINE: 'یادآوری شهریه',
  LOW_ATTENDANCE: 'هشدار غیبت',
  MISSING_DOCS: 'نقص مدارک',
  EXAM_REMINDER: 'یادآوری امتحان',
  ENROLL_DEADLINE: 'مهلت انتخاب واحد',
  CUSTOM: 'دلخواه',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'در انتظار',
  sent: 'ارسال‌شده',
  cancelled: 'لغوشده',
};

function statusBadge(s: string): string {
  if (s === 'pending') return 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
  if (s === 'sent') return 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
  return 'border-transparent bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

function warningTypeLabel(t: string | null): string {
  if (!t) return '—';
  return WARNING_TYPE_LABEL[t] ?? t;
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

function jalaliDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    const date = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
    return `${date} ${faDigits(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`)}`;
  } catch {
    return '—';
  }
}

/** ISO → datetime-local value (local time) */
function toLocalInput(iso: string | null | undefined): string {
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }
  }
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

type Msg = { text: string; kind: 'ok' | 'error' } | null;

export function AdminWarningsPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<WarningFilters>({ q: '', status: '', type: '', dateFrom: '', dateTo: '', page: 1 });
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<Msg>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WarningRow | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-warnings', filters, page],
    queryFn: () => listWarnings({ ...filters, page }),
    staleTime: 15_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-warnings'] });

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => updateWarning(id, body),
    onSuccess: async (_data, vars) => {
      const text = vars.body.sendNow
        ? 'ارسال فوری در صف قرار گرفت؛ کرون بعدی بلافاصله می‌فرستد.'
        : vars.body.status === 'cancelled'
          ? 'هشدار لغو شد.'
          : 'هشدار به‌روزرسانی شد.';
      setMsg({ text, kind: 'ok' });
      await refresh();
    },
    onError: (e: Error) => setMsg({ text: e.message, kind: 'error' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteWarning(id),
    onSuccess: async () => {
      setMsg({ text: 'هشدار حذف شد.', kind: 'ok' });
      await refresh();
    },
    onError: (e: Error) => setMsg({ text: e.message, kind: 'error' }),
  });

  const apply = () => {
    setPage(1);
    void refresh();
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-rose-800 via-amber-700 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-black"><BellRing className="size-5" aria-hidden /> هشدارهای زمان‌بندی‌شده</h1>
            <p className="mt-1 text-xs text-amber-50/90">
              ارسال خودکار در موعد مقرر روی همهٔ کانال‌های فعال: داخل‌پورتال، پیامک، تلگرام، بله، ایتا، سروش و ای‌گپ
            </p>
          </div>
          <Button size="sm" className="bg-white text-slate-900 hover:bg-white/90" onClick={() => { setEditing(null); setShowForm(true); }}>
            <Plus className="size-4" aria-hidden /> هشدار جدید
          </Button>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`rounded-xl border px-3 py-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>
          {msg.text}
        </div>
      ) : null}

      <Card>
        <CardContent className="grid grid-cols-1 items-end gap-2 p-3 md:grid-cols-6">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">جست‌وجو (نام/شماره/عنوان)</span>
            <Input value={filters.q ?? ''} onChange={(e) => setFilters({ ...filters, q: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && apply()} placeholder="نام یا شماره دانشجو…" className="h-8" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">وضعیت</span>
            <select
              value={filters.status ?? ''}
              onChange={(e) => { const v = e.target.value; setFilters((f) => ({ ...f, status: v })); setPage(1); }}
              className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm"
            >
              <option value="">همه</option>
              {WARNING_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">نوع</span>
            <select
              value={filters.type ?? ''}
              onChange={(e) => { const v = e.target.value; setFilters((f) => ({ ...f, type: v })); setPage(1); }}
              className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm"
            >
              <option value="">همه</option>
              {WARNING_TYPES.map((t) => <option key={t} value={t}>{WARNING_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">از تاریخ ارسال</span>
            <Input type="date" value={filters.dateFrom ?? ''} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} className="h-8" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">تا تاریخ ارسال</span>
            <Input type="date" value={filters.dateTo ?? ''} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} className="h-8" />
          </label>
          <Button size="sm" onClick={apply}>اعمال فیلتر</Button>
        </CardContent>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className="p-2 text-right">#</th>
              <th className="p-2 text-right">دانشجو</th>
              <th className="p-2 text-right">شماره</th>
              <th className="p-2 text-right">نوع</th>
              <th className="p-2 text-right">عنوان</th>
              <th className="p-2 text-right">موعد ارسال</th>
              <th className="p-2 text-right">ارسال‌شده</th>
              <th className="p-2 text-right">وضعیت</th>
              <th className="p-2 text-right">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">در حال بارگذاری…</td></tr>
            ) : isError ? (
              <tr><td colSpan={9} className="p-6 text-center text-rose-600">دریافت هشدارها ناموفق بود.</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">هشداری یافت نشد.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-border/50 hover:bg-muted/40">
                <td className="p-2 text-muted-foreground">{faNumber(r.id)}</td>
                <td className="p-2 font-medium">{r.studentName || '—'}</td>
                <td className="p-2 font-mono text-xs" dir="ltr">{r.studentCode || '—'}</td>
                <td className="p-2 text-xs">{warningTypeLabel(r.warningType)}</td>
                <td className="max-w-[220px] truncate p-2" title={r.message || ''}>{r.title || '—'}</td>
                <td className="p-2 text-xs">{jalaliDateTime(r.sendAt)}</td>
                <td className="p-2 text-xs">{r.sentAt ? jalaliDateTime(r.sentAt) : '—'}</td>
                <td className="p-2"><Badge className={statusBadge(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                <td className="whitespace-nowrap p-2">
                  {r.status === 'pending' ? (
                    <>
                      <button type="button" onClick={() => patchMut.mutate({ id: r.id, body: { sendNow: true } })} className="text-xs text-emerald-600 hover:underline">ارسال فوری</button>
                      <button type="button" onClick={() => patchMut.mutate({ id: r.id, body: { status: 'cancelled' } })} className="ms-2 text-xs text-amber-600 hover:underline">لغو</button>
                    </>
                  ) : null}
                  <button type="button" onClick={() => { setEditing(r); setShowForm(true); }} className="ms-2 text-xs text-blue-600 hover:underline">ویرایش</button>
                  <button
                    type="button"
                    onClick={() => { if (confirm(`هشدار #${r.id} حذف شود؟`)) deleteMut.mutate(r.id); }}
                    className="ms-2 text-xs text-rose-600 hover:underline"
                  >
                    حذف
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>قبلی</Button>
          <span className="text-muted-foreground">صفحه {faNumber(page)} از {faNumber(pageCount)}</span>
          <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>بعدی</Button>
        </div>
      ) : null}

      {showForm ? (
        <WarnForm
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={async (text) => {
            setMsg({ text, kind: 'ok' });
            setShowForm(false);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function WarnForm({ editing, onClose, onSaved }: { editing: WarningRow | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [studentQuery, setStudentQuery] = useState(editing?.studentName || '');
  const [picked, setPicked] = useState<WarningStudentHit | null>(
    editing ? { studentId: editing.studentId, studentCode: editing.studentCode || '', name: editing.studentName || '', entryYear: null } : null,
  );
  const [hits, setHits] = useState<WarningStudentHit[]>([]);
  const [warningType, setWarningType] = useState(editing?.warningType || WARNING_TYPES[0]);
  const [title, setTitle] = useState(editing?.title || '');
  const [message, setMessage] = useState(editing?.message || '');
  const [sendAt, setSendAt] = useState(toLocalInput(editing?.sendAt));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Student search with a 300ms delay (same behavior as the Next form)
  useEffect(() => {
    if (editing) return;
    const q = studentQuery.trim();
    if (picked || q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      searchWarningStudents(q).then(setHits).catch(() => setHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [studentQuery, picked, editing]);

  const save = async () => {
    setErr('');
    setBusy(true);
    try {
      if (editing) {
        await updateWarning(editing.id, {
          title: title || null,
          message: message || null,
          warningType,
          sendAt: new Date(sendAt).toISOString(),
        });
        onSaved('هشدار به‌روزرسانی شد.');
      } else {
        if (!picked) { setErr('دانشجو را از لیست جست‌وجو انتخاب کنید.'); return; }
        const dt = new Date(sendAt);
        if (Number.isNaN(dt.getTime())) { setErr('زمان ارسال نامعتبر است.'); return; }
        await createWarning({ studentId: picked.studentId, warningType, title: title || null, message: message || null, sendAt: dt.toISOString() });
        onSaved('هشدار جدید ثبت شد و در موعد مقرر ارسال می‌شود.');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطا در ذخیره');
    } finally {
      setBusy(false);
    }
  };

  const titleText = useMemo(() => (editing ? `ویرایش هشدار #${editing.id}` : 'هشدار زمان‌بندی‌شده جدید'), [editing]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} dir="rtl">
      <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold">{titleText}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-5" aria-hidden /><span className="sr-only">بستن</span></button>
        </div>

        {err ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{err}</div> : null}

        {!editing ? (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">دانشجو</label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={picked ? `${picked.name} (${picked.studentCode})` : studentQuery}
                onChange={(e) => { setStudentQuery(e.target.value); setPicked(null); }}
                className="pr-9"
                placeholder="نام یا شماره دانشجو… (حداقل ۲ حرف)"
              />
            </div>
            {hits.length > 0 && !picked ? (
              <div className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {hits.map((h) => (
                  <button key={h.studentId} type="button" onClick={() => { setPicked(h); setHits([]); setStudentQuery(h.name); }} className="w-full px-3 py-2 text-right text-sm hover:bg-accent">
                    {h.name} <span className="font-mono text-xs text-muted-foreground">{h.studentCode}</span>
                    {h.entryYear ? <span className="text-xs text-muted-foreground"> — ورود {faNumber(h.entryYear)}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span className="block">نوع هشدار</span>
            <select value={warningType} onChange={(e) => setWarningType(e.target.value)} className="h-9 w-full rounded-lg border border-input bg-card px-2 text-sm">
              {WARNING_TYPES.map((t) => <option key={t} value={t}>{WARNING_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span className="block">موعد ارسال</span>
            <Input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
          </label>
        </div>

        <label className="block space-y-1 text-xs text-muted-foreground">
          <span className="block">عنوان</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً یادآوری سررسید شهریه…" />
        </label>

        <label className="block space-y-1 text-xs text-muted-foreground">
          <span className="block">متن پیام</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm" placeholder="متنی که برای دانشجو ارسال می‌شود…" />
        </label>

        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          ارسال خودکار: در موعد تعیین‌شده روی همهٔ کانال‌های فعال (داخل‌پورتال + پیامک + پیام‌رسان‌های متصل). کانال‌ها از تنظیم «کانال‌های ارسال هشدار زمان‌بندی‌شده» خوانده می‌شوند.
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={onClose}>انصراف</Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>{busy ? 'در حال ذخیره…' : 'ذخیره'}</Button>
        </div>
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Clock3, FileUp, Inbox, Send, Star, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, faRial } from '@/lib/fa';
import {
  getRequestsPage,
  rateRequest,
  submitRequest,
  uploadRequestAttachment,
  type RequestFormField,
  type RequestProcess,
  type StudentRequestRow,
} from '@/lib/student-api';

// ═══ Student service desk — port of student/requests ═══

const STATUS_FA: Record<string, string> = {
  SUBMITTED: 'ثبت‌شده و در صف بررسی',
  IN_REVIEW: 'در دست بررسی کارشناس',
  APPROVED: 'تأیید نهایی شده',
  REJECTED: 'ردشده',
  RETURNED: 'نیازمند بازبینی و اصلاح',
};

const STATUS_CLASS: Record<string, string> = {
  SUBMITTED: 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
  IN_REVIEW: 'border-transparent bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100',
  APPROVED: 'border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  REJECTED: 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-100',
  RETURNED: 'border-transparent bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-100',
};

const ROLE_FA: Record<string, string> = {
  SUPERVISOR: 'استاد راهنما',
  DEPARTMENT_HEAD: 'مدیر گروه آموزشی',
  EDU_EXPERT: 'کارشناس آموزش کل',
  FINANCE_EXPERT: 'کارشناس امور مالی',
  LIBRARY_STAFF: 'مسئول کتابخانه',
  WELFARE_STAFF: 'صندوق رفاه',
  LAB_STAFF: 'آزمایشگاه و کارگاه',
  GRADUATION_EXPERT: 'کارشناس فارغ‌التحصیلی',
  VICE_CHANCELLOR: 'معاونت آموزشی',
  MULTI_CHECKPOINT: 'تسویه چندگانه',
  SYSTEM_BOT: 'سامانهٔ خودکار آفاق',
  PROFESSOR: 'استاد درس',
  USER: 'کاربر',
};

function faDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return faDigits(iso.slice(0, 16));
  }
}

type FormValues = Record<string, unknown>;

function DynamicField({
  field,
  value,
  onChange,
  onUpload,
  uploading,
}: {
  field: RequestFormField;
  value: unknown;
  onChange: (v: unknown) => void;
  onUpload: (f: File) => void;
  uploading: boolean;
}) {
  const common = 'mt-1';
  if (field.type === 'textarea') {
    return (
      <div>
        <Label htmlFor={field.key}>{field.label}{field.required ? <span className="text-rose-600"> *</span> : null}</Label>
        <textarea
          id={field.key}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
        />
        {field.helperText ? <p className="mt-1 text-[10px] text-muted-foreground">{field.helperText}</p> : null}
      </div>
    );
  }
  if (field.type === 'select') {
    return (
      <div>
        <Label htmlFor={field.key}>{field.label}{field.required ? <span className="text-rose-600"> *</span> : null}</Label>
        <select
          id={field.key}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
        >
          <option value="">— انتخاب کنید —</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {field.helperText ? <p className="mt-1 text-[10px] text-muted-foreground">{field.helperText}</p> : null}
      </div>
    );
  }
  if (field.type === 'file') {
    const uploaded = value as { name?: string } | undefined;
    return (
      <div>
        <Label htmlFor={field.key}>{field.label}{field.required ? <span className="text-rose-600"> *</span> : null}</Label>
        <label htmlFor={field.key} className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input px-3 py-2.5 text-xs text-muted-foreground hover:bg-muted/50">
          <FileUp className="size-4" aria-hidden />
          {uploading ? 'در حال بارگذاری…' : uploaded?.name ? `پیوست: ${uploaded.name}` : 'انتخاب فایل (تصویر یا PDF تا ۱۰ مگابایت)'}
          <input
            id={field.key}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
        </label>
        {field.helperText ? <p className="mt-1 text-[10px] text-muted-foreground">{field.helperText}</p> : null}
      </div>
    );
  }
  return (
    <div>
      <Label htmlFor={field.key}>{field.label}{field.required ? <span className="text-rose-600"> *</span> : null}</Label>
      <Input
        id={field.key}
        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
        value={String(value ?? '')}
        placeholder={field.placeholder}
        className={common}
        onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
      />
      {field.helperText ? <p className="mt-1 text-[10px] text-muted-foreground">{field.helperText}</p> : null}
    </div>
  );
}

function RequestCard({ req, onRate }: { req: StudentRequestRow; onRate: (id: number, score: number, feedback: string) => void }) {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(req.satisfactionScore ?? 0);
  const [feedback, setFeedback] = useState(req.feedbackText ?? '');
  const canRate = req.status === 'APPROVED' || req.status === 'REJECTED';

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-black">
              {req.processTitle}
              <Badge className={STATUS_CLASS[req.status] ?? ''}>{STATUS_FA[req.status] ?? req.status}</Badge>
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              کد رهگیری: <b className="font-mono" dir="ltr">{req.trackingCode}</b> · {req.category} · ثبت: {faDateTime(req.created)}
            </p>
            {req.certificateNumber ? (
              <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">شمارهٔ گواهی: <b dir="ltr">{req.certificateNumber}</b></p>
            ) : null}
          </div>
          <button type="button" className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-bold hover:bg-muted" onClick={() => setOpen((v) => !v)}>
            {open ? 'بستن جزئیات' : 'جزئیات پرونده'}
          </button>
        </div>

        {open ? (
          <div className="space-y-3 pt-1">
            {req.logs.length > 0 ? (
              <div>
                <p className="mb-1 text-[11px] font-bold text-muted-foreground">گردش کار</p>
                <ol className="space-y-1.5 border-s-2 border-border ps-3">
                  {req.logs.map((l) => (
                    <li key={l.id} className="text-[11px]">
                      <span className="font-bold">{ROLE_FA[l.actorRole ?? 'USER'] ?? l.actorRole}</span>
                      {l.action ? <span className="text-muted-foreground"> · {l.action}</span> : null}
                      <p className="text-muted-foreground">{l.note ?? '—'}</p>
                      <p className="text-[10px] text-muted-foreground/70">{faDateTime(l.assignedAt)}{l.completedAt ? ` → ${faDateTime(l.completedAt)}` : ''}</p>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {req.checkpoints.length > 0 ? (
              <div>
                <p className="mb-1 text-[11px] font-bold text-muted-foreground">تسویه‌های موازی</p>
                <div className="flex flex-wrap gap-1.5">
                  {req.checkpoints.map((c) => (
                    <span key={c.id} className={`rounded-lg px-2 py-1 text-[10px] font-bold ${c.isCleared ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                      {c.isCleared ? '✓' : '…'} {c.departmentTitle}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {canRate ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
            <span className="text-[11px] font-bold text-muted-foreground">رضایت از خدمت:</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-label={`امتیاز ${n}`} onClick={() => setScore(n)}>
                <Star className={`size-4 ${n <= score ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`} aria-hidden />
              </button>
            ))}
            <Input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="بازخورد (اختیاری)" className="h-7 max-w-56 text-[11px]" />
            <Button size="sm" variant="outline" disabled={score < 1} onClick={() => onRate(req.id, score, feedback)}>
              ثبت
            </Button>
          </div>
        ) : req.satisfactionScore ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            امتیاز شما: {'★'.repeat(req.satisfactionScore)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function StudentRequestsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-requests'],
    queryFn: getRequestsPage,
    staleTime: 30_000,
  });
  const [active, setActive] = useState<RequestProcess | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const submitMut = useMutation({
    mutationFn: ({ code, form }: { code: string; form: FormValues }) => submitRequest(code, form),
    onSuccess: async (r) => {
      setSuccess(`درخواست با کد رهگیری ${r.trackingCode} ثبت شد.`);
      setActive(null);
      setValues({});
      await qc.invalidateQueries({ queryKey: ['student-requests'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const rateMut = useMutation({
    mutationFn: ({ id, score, feedback }: { id: number; score: number; feedback: string }) => rateRequest(id, score, feedback),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['student-requests'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const categories = useMemo(() => {
    const map = new Map<string, RequestProcess[]>();
    for (const p of data?.processes ?? []) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return [...map.entries()];
  }, [data]);

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت میز خدمات ناموفق بود.</CardContent></Card>;
  }

  const pending = data.myRequests.filter((r) => r.status === 'SUBMITTED' || r.status === 'IN_REVIEW').length;
  const approved = data.myRequests.filter((r) => r.status === 'APPROVED').length;

  function pick(p: RequestProcess) {
    setActive(p);
    setError(null);
    setSuccess(null);
    const initial: FormValues = {};
    for (const f of p.formSchema) {
      if (f.defaultValue !== undefined) initial[f.key] = f.defaultValue;
    }
    setValues(initial);
  }

  function submit() {
    if (!active) return;
    setError(null);
    for (const f of active.formSchema) {
      if (f.required && (values[f.key] === undefined || values[f.key] === '' || values[f.key] == null)) {
        setError(`فیلد «${f.label}» الزامی است.`);
        return;
      }
    }
    submitMut.mutate({ code: active.code, form: values });
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-0 bg-gradient-to-l from-indigo-700 via-indigo-600 to-sky-600 text-white shadow-lg">
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <ClipboardList className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-black">میز خدمات الکترونیک</h1>
            <p className="mt-1 text-xs text-white/85">
              {data.student.name} · {data.studentCode} · {data.majorName} — {data.degreeTitle}
            </p>
          </div>
          <div className="flex gap-2 text-[11px]">
            <span className="rounded-lg bg-white/15 px-2.5 py-1.5">⏳ {faNumber(pending)} در جریان</span>
            <span className="rounded-lg bg-white/15 px-2.5 py-1.5">✓ {faNumber(approved)} تأییدشده</span>
          </div>
        </CardContent>
      </Card>

      {success ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          <CheckCircle2 className="size-4" aria-hidden /> {success}
        </div>
      ) : null}
      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100">
          <XCircle className="size-4" aria-hidden /> {error}
        </div>
      ) : null}

      {active ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-black">{active.title}</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{active.description}</p>
                {active.feeAmount > 0 ? <p className="mt-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">هزینهٔ فرایند: {faRial(active.feeAmount)}</p> : null}
              </div>
              <Button size="sm" variant="outline" onClick={() => setActive(null)}>بستن</Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {active.formSchema.map((f) => (
                <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  <DynamicField
                    field={f}
                    value={values[f.key]}
                    onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                    uploading={uploadingKey === f.key}
                    onUpload={async (file) => {
                      setUploadingKey(f.key);
                      setError(null);
                      try {
                        const att = await uploadRequestAttachment(file);
                        setValues((prev) => ({ ...prev, [f.key]: att }));
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'بارگذاری پیوست ناموفق بود.');
                      } finally {
                        setUploadingKey(null);
                      }
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setActive(null)}>انصراف</Button>
              <Button size="sm" onClick={submit} disabled={submitMut.isPending || uploadingKey !== null}>
                <Send className="size-4" aria-hidden /> ثبت درخواست
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {categories.map(([category, list]) => (
            <div key={category} className="space-y-2">
              <h2 className="px-1 text-xs font-black text-muted-foreground">{category}</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {list.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick(p)}
                    className="rounded-xl border border-border bg-card p-3 text-right shadow-xs transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                  >
                    <p className="text-sm font-black">{p.title}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{p.description}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock3 className="size-3" aria-hidden /> {faNumber(p.steps[0]?.slaHours ?? 48)} ساعت</span>
                      {p.feeAmount > 0 ? <span>{faRial(p.feeAmount)}</span> : <span className="text-emerald-700 dark:text-emerald-300">بدون هزینه</span>}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h2 className="flex items-center gap-2 px-1 text-sm font-black">
          <Inbox className="size-4 text-primary" aria-hidden />
          درخواست‌های من
          <Badge variant="secondary">{faDigits(data.myRequests.length)}</Badge>
        </h2>
        {data.myRequests.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">هنوز درخواستی ثبت نکرده‌اید.</CardContent></Card>
        ) : (
          data.myRequests.map((r) => (
            <RequestCard key={r.id} req={r} onRate={(id, score, feedback) => rateMut.mutate({ id, score, feedback })} />
          ))
        )}
      </div>
    </div>
  );
}

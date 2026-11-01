import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, toEnDigits } from '@/lib/fa';
import {
  createEnrollApproval,
  deleteEnrollApproval,
  listEnrollApprovals,
  searchApprovalOfferings,
  searchApprovalStudents,
  updateEnrollApproval,
  type ApprovalOfferingHit,
  type ApprovalStudentHit,
  type EnrollApprovalRow,
} from '@/lib/enrollment-api';

// ═══ Enrollment approval (language courses) — port of admin/enrollment-approvals ═══

function statusTone(s: string) {
  if (s === 'APPROVED') return 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
  if (s === 'REJECTED') return 'border-transparent bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200';
  return 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
}
const STATUS_LABEL: Record<string, string> = { PENDING: 'در انتظار', APPROVED: 'تأییدشده', REJECTED: 'ردشده' };

function jdate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return '—';
  }
}

export function AdminEnrollmentApprovalsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setQuery(q); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['enroll-approvals', query, status, page],
    queryFn: () => listEnrollApprovals({ q: query, status, page }),
    staleTime: 15_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['enroll-approvals'] });

  const decideMut = useMutation({
    mutationFn: ({ id, next, note }: { id: number; next: string; note?: string | null }) => updateEnrollApproval(id, { status: next, note: note ?? null }),
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'وضعیت درخواست به‌روزرسانی شد.' }); await refresh(); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteEnrollApproval(id),
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'درخواست حذف شد.' }); await refresh(); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت درخواست‌ها ناموفق بود.</CardContent></Card>;

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-indigo-800 via-blue-800 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-black"><ClipboardList className="size-5" aria-hidden /> تأیید انتخاب واحد (دروس زبان)</h1>
            <p className="mt-1 text-xs text-indigo-100">درخواست‌های نیازمند تأیید کارشناس برای ثبت دروس زبان/انگلیسی</p>
          </div>
          <Button size="sm" className="bg-white text-slate-900 hover:bg-white/90" onClick={() => setShowForm(true)}>＋ درخواست جدید</Button>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="text-muted-foreground"><X className="size-3.5" aria-hidden /><span className="sr-only">بستن</span></button>
        </div>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="شماره دانشجویی، نام یا عنوان درس…" className="pr-9" />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-input bg-card px-2 text-xs font-bold">
            <option value="">همهٔ وضعیت‌ها</option>
            <option value="PENDING">در انتظار</option>
            <option value="APPROVED">تأییدشده</option>
            <option value="REJECTED">ردشده</option>
          </select>
          <span className="text-[11px] font-bold text-muted-foreground">{faNumber(data.total)} درخواست</span>
        </CardContent>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full border-collapse text-right text-xs">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>{['دانشجو', 'درس', 'نیمسال / گروه', 'وضعیت', 'یادداشت', 'تاریخ', 'عملیات'].map((h) => <th key={h} className="whitespace-nowrap p-2.5 font-black">{h}</th>)}</tr>
          </thead>
          <tbody>
            {data.rows.map((r: EnrollApprovalRow) => (
              <tr key={r.id} className="border-t border-border/50 hover:bg-muted/40">
                <td className="p-2.5">
                  <div className="font-bold">{r.studentName}</div>
                  <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{faDigits(r.studentCode)}</div>
                </td>
                <td className="p-2.5">{r.courseTitle}<div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{r.courseCode}</div></td>
                <td className="p-2.5 text-[11px]">{r.termTitle} / {r.groupNumber ?? '—'}</td>
                <td className="p-2.5"><Badge className={statusTone(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                <td className="max-w-48 truncate p-2.5 text-[11px] text-muted-foreground" title={r.note ?? ''}>{r.note ?? '—'}</td>
                <td className="p-2.5 text-[10px] text-muted-foreground">{jdate(r.createdAt)}</td>
                <td className="whitespace-nowrap p-2.5">
                  {r.status === 'PENDING' ? (
                    <>
                      <button type="button" className="text-xs text-emerald-600 hover:underline" onClick={() => decideMut.mutate({ id: r.id, next: 'APPROVED' })}>تأیید</button>
                      <button
                        type="button"
                        className="ms-2 text-xs text-rose-600 hover:underline"
                        onClick={() => {
                          const reason = window.prompt('دلیل رد (اختیاری):');
                          if (reason === null) return;
                          decideMut.mutate({ id: r.id, next: 'REJECTED', note: reason || null });
                        }}
                      >رد</button>
                    </>
                  ) : null}
                  <button type="button" className="ms-2 text-xs text-slate-600 hover:underline dark:text-slate-300" onClick={() => {
                    const note = window.prompt('یادداشت:', r.note ?? '');
                    if (note === null) return;
                    decideMut.mutate({ id: r.id, next: r.status, note: note || null });
                  }}>یادداشت</button>
                  <button type="button" className="ms-2 text-xs text-rose-700 hover:underline" onClick={() => { if (confirm(`درخواست #${r.id} حذف شود؟`)) deleteMut.mutate(r.id); }}>حذف</button>
                </td>
              </tr>
            ))}
            {data.rows.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">درخواستی یافت نشد.</td></tr> : null}
          </tbody>
        </table>
      </Card>

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 text-xs font-bold text-muted-foreground">
          <Button size="sm" variant="outline" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>قبلی</Button>
          <span>صفحهٔ {faNumber(data.page)} از {faNumber(totalPages)}</span>
          <Button size="sm" variant="outline" disabled={data.page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>بعدی</Button>
        </div>
      ) : null}

      {showForm ? <ApprovalForm onClose={() => setShowForm(false)} onSaved={async (text) => { setMsg({ kind: 'ok', text }); setShowForm(false); await refresh(); }} /> : null}
    </div>
  );
}

function ApprovalForm({ onClose, onSaved }: { onClose: () => void; onSaved: (text: string) => Promise<void> }) {
  const [studentQ, setStudentQ] = useState('');
  const [studentHits, setStudentHits] = useState<ApprovalStudentHit[]>([]);
  const [pickedStudent, setPickedStudent] = useState<ApprovalStudentHit | null>(null);
  const [offeringQ, setOfferingQ] = useState('');
  const [offerings, setOfferings] = useState<ApprovalOfferingHit[]>([]);
  const [pickedOffering, setPickedOffering] = useState<ApprovalOfferingHit | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pickedStudent) return;
    const q = studentQ.trim();
    if (!q) { setStudentHits([]); return; }
    const t = setTimeout(() => { searchApprovalStudents(q).then(setStudentHits).catch(() => setStudentHits([])); }, 300);
    return () => clearTimeout(t);
  }, [studentQ, pickedStudent]);

  useEffect(() => {
    if (pickedOffering) return;
    const t = setTimeout(() => { searchApprovalOfferings(offeringQ).then(setOfferings).catch(() => setOfferings([])); }, 250);
    return () => clearTimeout(t);
  }, [offeringQ, pickedOffering]);

  const save = async () => {
    if (!pickedStudent || !pickedOffering) { setErr('دانشجو و درس را انتخاب کنید.'); return; }
    setBusy(true);
    setErr('');
    try {
      await createEnrollApproval({ studentId: pickedStudent.studentId, offeringId: pickedOffering.offeringId, note: note || null });
      await onSaved('درخواست تأیید ثبت شد.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطا در ثبت');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} dir="rtl">
      <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold">درخواست تأیید انتخاب واحد</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground"><X className="size-5" aria-hidden /><span className="sr-only">بستن</span></button>
        </div>
        {err ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{err}</div> : null}

        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>دانشجو</span>
          <Input value={pickedStudent ? `${pickedStudent.name} (${pickedStudent.studentCode})` : studentQ} onChange={(e) => { setStudentQ(toEnDigits(e.target.value)); setPickedStudent(null); }} placeholder="نام یا شماره دانشجو…" />
          {studentHits.length > 0 && !pickedStudent ? (
            <div className="max-h-36 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {studentHits.map((h) => (
                <button key={h.studentId} type="button" onClick={() => { setPickedStudent(h); setStudentHits([]); }} className="w-full px-3 py-2 text-right text-sm hover:bg-accent">
                  {h.name} <span className="font-mono text-xs text-muted-foreground">{h.studentCode}</span>
                </button>
              ))}
            </div>
          ) : null}
        </label>

        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>درس (پیش‌فرض: دروس زبان/انگلیسی)</span>
          <Input value={pickedOffering ? `${pickedOffering.courseTitle} (${pickedOffering.courseCode}) — ${pickedOffering.termTitle}` : offeringQ} onChange={(e) => { setOfferingQ(e.target.value); setPickedOffering(null); }} placeholder="عنوان یا کد درس…" />
          {offerings.length > 0 && !pickedOffering ? (
            <div className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {offerings.map((o) => (
                <button key={o.offeringId} type="button" onClick={() => { setPickedOffering(o); setOfferings([]); }} className="w-full px-3 py-2 text-right text-sm hover:bg-accent">
                  <span className="font-bold">{o.courseTitle}</span> <span className="font-mono text-xs text-muted-foreground">{o.courseCode}</span>
                  <span className="block text-[10px] text-muted-foreground">{o.termTitle} · گروه {o.groupNumber ?? '—'} · {faNumber(o.enrolledCount)}/{faNumber(o.capacity)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </label>

        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>یادداشت</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm" placeholder="توضیح برای کارشناس…" />
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onClose}>انصراف</Button>
          <Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? 'در حال ثبت…' : 'ثبت درخواست'}</Button>
        </div>
      </div>
    </div>
  );
}

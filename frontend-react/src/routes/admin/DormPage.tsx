import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, Printer, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, toEnDigits } from '@/lib/fa';
import {
  createDormResidence,
  deleteDormResidence,
  listDormResidences,
  searchDormStudents,
  updateDormResidence,
  type DormRow,
  type DormStudentHit,
} from '@/lib/dorm-api';

// ═══ کارت سکونت خوابگاه — پورت admin/dorm ═══

const DORM_STATUSES = ['active', 'ended', 'revoked'] as const;
const STATUS_LABEL: Record<string, string> = { active: 'فعال', ended: 'پایان‌یافته', revoked: 'لغوشده' };

function statusBadge(s: string) {
  if (s === 'active') return 'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200';
  if (s === 'ended') return 'border-transparent bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return 'border-transparent bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200';
}

function jdate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return '—';
  }
}

export function AdminDormPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DormRow | null>(null);
  const [printRow, setPrintRow] = useState<DormRow | null>(null);

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ['dorm-residences', statusFilter],
    queryFn: () => listDormResidences(statusFilter),
    staleTime: 15_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['dorm-residences'] });

  const endMut = useMutation({
    mutationFn: (id: number) => updateDormResidence(id, { status: 'ended' }),
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'سکونت پایان یافت.' }); await refresh(); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteDormResidence(id),
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'سکونت حذف شد.' }); await refresh(); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت سکونت‌های خوابگاه ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-sky-800 via-indigo-800 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-black"><BedDouble className="size-5" aria-hidden /> کارت سکونت خوابگاه</h1>
            <p className="mt-1 text-xs text-sky-100">ثبت سکونت دوره‌ای دانشجو (خوابگاه، اتاق، تخت، سال تحصیلی) و صدور کارت سکونت قابل چاپ</p>
          </div>
          <Button size="sm" className="bg-white text-slate-900 hover:bg-white/90" onClick={() => { setEditing(null); setShowForm(true); }}>＋ سکونت جدید</Button>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="text-muted-foreground"><X className="size-3.5" aria-hidden /><span className="sr-only">بستن</span></button>
        </div>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 p-3">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">وضعیت</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 min-w-36 rounded-lg border border-input bg-card px-2 text-sm">
              <option value="">همه</option>
              {DORM_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <span className="mr-auto text-xs text-muted-foreground">{faNumber(rows.length)} رکورد</span>
        </CardContent>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full border-collapse text-right text-sm">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>{['#', 'دانشجو', 'شماره', 'خوابگاه', 'اتاق / تخت', 'سال تحصیلی', 'اعتبار', 'وضعیت', 'عملیات'].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">سکونتی یافت نشد.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-border/50 hover:bg-muted/40">
                <td className="p-2 text-muted-foreground">{faNumber(r.id)}</td>
                <td className="p-2 font-medium">{r.fullName || '—'}</td>
                <td className="p-2 font-mono text-xs" dir="ltr">{faDigits(r.studentCode)}</td>
                <td className="p-2">{r.dormName || '—'}</td>
                <td className="p-2 text-xs">{r.roomNo || '—'} / {r.bedNo || '—'}</td>
                <td className="p-2 text-xs">{r.academicYear || '—'}</td>
                <td className="p-2 text-xs">{jdate(r.validFrom)} تا {jdate(r.validTo)}</td>
                <td className="p-2"><Badge className={statusBadge(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                <td className="whitespace-nowrap p-2">
                  <button type="button" onClick={() => setPrintRow(r)} className="text-xs text-indigo-600 hover:underline"><Printer className="inline size-3" aria-hidden /> چاپ کارت</button>
                  {r.status === 'active' ? <button type="button" onClick={() => endMut.mutate(r.id)} className="ms-2 text-xs text-amber-600 hover:underline">پایان</button> : null}
                  <button type="button" onClick={() => { setEditing(r); setShowForm(true); }} className="ms-2 text-xs text-blue-600 hover:underline">ویرایش</button>
                  <button type="button" onClick={() => { if (confirm(`سکونت #${r.id} حذف شود؟`)) deleteMut.mutate(r.id); }} className="ms-2 text-xs text-rose-600 hover:underline">حذف</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showForm ? (
        <DormForm
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={async (text) => { setMsg({ kind: 'ok', text }); setShowForm(false); await refresh(); }}
        />
      ) : null}

      {printRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPrintRow(null)} dir="rtl">
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-2 rounded-xl border-2 border-slate-700 p-5 text-center">
              <div className="text-lg font-bold">کارت سکونت خوابگاه</div>
              <div className="text-xs text-muted-foreground">سال تحصیلی {printRow.academicYear || '—'}</div>
              <div className="space-y-1.5 pt-2 text-right text-sm">
                {([
                  ['نام دانشجو', printRow.fullName],
                  ['شماره دانشجویی', printRow.studentCode],
                  ['رشته / مقطع', `${printRow.majorName || '—'}${printRow.degreeLevel ? ` (${printRow.degreeLevel})` : ''}`],
                  ['خوابگاه', printRow.dormName || '—'],
                  ['اتاق / تخت', `${printRow.roomNo || '—'} / ${printRow.bedNo || '—'}`],
                  ['اعتبار', `${jdate(printRow.validFrom)} تا ${jdate(printRow.validTo)}`],
                ] as const).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2 border-b border-dashed border-border pb-1 last:border-0">
                    <span className="text-muted-foreground">{label}</span><span className="font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="no-print flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setPrintRow(null)}>بستن</Button>
              <Button size="sm" onClick={() => window.print()}>چاپ</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DormForm({ editing, onClose, onSaved }: { editing: DormRow | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [studentQuery, setStudentQuery] = useState(editing?.fullName || '');
  const [hits, setHits] = useState<DormStudentHit[]>([]);
  const [picked, setPicked] = useState<DormStudentHit | null>(
    editing ? { studentId: editing.studentId, studentCode: editing.studentCode, name: editing.fullName, entryYear: null } : null,
  );
  const [dormName, setDormName] = useState(editing?.dormName || '');
  const [roomNo, setRoomNo] = useState(editing?.roomNo || '');
  const [bedNo, setBedNo] = useState(editing?.bedNo || '');
  const [academicYear, setAcademicYear] = useState(editing?.academicYear || '۱۴۰۴-۱۴۰۵');
  const [validFrom, setValidFrom] = useState(editing?.validFrom ? editing.validFrom.slice(0, 10) : '');
  const [validTo, setValidTo] = useState(editing?.validTo ? editing.validTo.slice(0, 10) : '');
  const [status, setStatus] = useState(editing?.status || 'active');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing || picked) return;
    const q = studentQuery.trim();
    if (q.length < 2) { setHits([]); return; }
    const t = setTimeout(() => { searchDormStudents(q).then(setHits).catch(() => setHits([])); }, 300);
    return () => clearTimeout(t);
  }, [studentQuery, picked, editing]);

  const save = async () => {
    setErr('');
    setBusy(true);
    const payload = {
      dormName: dormName || null,
      roomNo: roomNo || null,
      bedNo: bedNo || null,
      academicYear: academicYear || null,
      validFrom: validFrom || null,
      validTo: validTo || null,
      status,
    };
    try {
      if (editing) {
        await updateDormResidence(editing.id, payload);
        onSaved('سکونت به‌روزرسانی شد.');
      } else {
        if (!picked) { setErr('دانشجو را از لیست جست‌وجو انتخاب کنید.'); return; }
        await createDormResidence({ studentId: picked.studentId, ...payload });
        onSaved('سکونت جدید ثبت شد.');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطا در ذخیره');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} dir="rtl">
      <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold">{editing ? `ویرایش سکونت #${editing.id}` : 'سکونت خوابگاهی جدید'}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground"><X className="size-5" aria-hidden /><span className="sr-only">بستن</span></button>
        </div>

        {err ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{err}</div> : null}

        {!editing ? (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">دانشجو</label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={picked ? `${picked.name} (${picked.studentCode})` : studentQuery}
                onChange={(e) => { setStudentQuery(toEnDigits(e.target.value)); setPicked(null); }}
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

        <div className="grid grid-cols-3 gap-3">
          {([['نام خوابگاه', dormName, setDormName, 'مثلاً خوابگاه شهید بهشتی'], ['اتاق', roomNo, setRoomNo, '۱۰۱'], ['تخت', bedNo, setBedNo, '۲']] as const).map(([label, value, setter, placeholder]) => (
            <label key={label} className="block space-y-1 text-xs text-muted-foreground">
              <span className="block">{label}</span>
              <Input value={value} onChange={(e) => setter(e.target.value)} placeholder={placeholder} />
            </label>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span className="block">سال تحصیلی</span>
            <Input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="۱۴۰۴-۱۴۰۵" />
          </label>
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span className="block">از تاریخ</span>
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </label>
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span className="block">تا تاریخ</span>
            <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </label>
        </div>

        <label className="block space-y-1 text-xs text-muted-foreground">
          <span className="block">وضعیت</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-full rounded-lg border border-input bg-card px-2 text-sm">
            {DORM_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={onClose}>انصراف</Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>{busy ? 'در حال ذخیره…' : 'ذخیره'}</Button>
        </div>
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Printer, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  issueStudentCard,
  listStudentCards,
  revokeStudentCard,
  type StudentCardRow,
} from '@/lib/student-cards-api';

// ═══ صدور و مدیریت کارت دانشجویی — پورت admin/student-cards ═══

const STATUS_TONE: Record<string, string> = {
  PRINTED: 'border-emerald-300 bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  PENDING: 'border-slate-300 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  LOST: 'border-amber-300 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  REVOKED: 'border-rose-300 bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
};

const mask = (c: string | null) => (!c ? '—' : c.length <= 5 ? c : `${c.slice(0, 3)}${'*'.repeat(c.length - 5)}${c.slice(-2)}`);

function jdate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return '—';
  }
}

export function AdminStudentCardsPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setQ(query); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-cards', q, page],
    queryFn: () => listStudentCards(q, page),
    staleTime: 15_000,
  });

  const issueMut = useMutation({
    mutationFn: ({ studentId, force }: { studentId: number; force: boolean }) => issueStudentCard(studentId, force),
    onSuccess: async (r) => {
      setMsg(r.renewed ? 'کارت تمدید شد.' : 'کارت صادر شد و توکن جدید ساخته شد.');
      await qc.invalidateQueries({ queryKey: ['student-cards'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const revokeMut = useMutation({
    mutationFn: ({ studentId, status }: { studentId: number; status: 'REVOKED' | 'LOST' }) => revokeStudentCard(studentId, status),
    onSuccess: async () => {
      setMsg('وضعیت کارت به‌روزرسانی شد.');
      await qc.invalidateQueries({ queryKey: ['student-cards'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت فهرست کارت‌ها ناموفق بود.</CardContent></Card>;

  const from = data.total === 0 ? 0 : (data.page - 1) * data.perPage + 1;
  const to = Math.min(data.page * data.perPage, data.total);

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-indigo-800 via-indigo-700 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-base font-black"><CreditCard className="size-5" aria-hidden /> صدور و مدیریت کارت دانشجویی</h1>
          <p className="mt-1 text-xs text-indigo-100">
            توکن امنیتی چاپ‌شده روی کارت، همان چیزی است که گیت حراست در <span className="font-mono" dir="ltr">/id/[token]</span> استعلام می‌کند.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
            <span className="rounded-lg border border-white/20 bg-white/10 px-2 py-1">اعتبار پیش‌فرض کارت: {faNumber(data.validDays)} روز (از تنظیمات سامانه)</span>
            <span className={`rounded-lg border px-2 py-1 ${data.secretSet ? 'border-emerald-300 bg-emerald-500/20 text-emerald-100' : 'border-rose-300 bg-rose-500/20 text-rose-100'}`}>
              {data.secretSet ? '✓ کلید امضای توکن (TICKET_TOKEN_SECRET) تنظیم شده' : '⚠️ کلید امضای توکن تنظیم نشده — کارت ورود به جلسه صادر نمی‌شود'}
            </span>
          </div>
        </CardContent>
      </Card>

      {msg ? (
        <div className="flex items-center justify-between rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">
          <span>{msg}</span>
          <button type="button" onClick={() => setMsg(null)} className="text-indigo-500"><span aria-hidden>✕</span><span className="sr-only">بستن</span></button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {([
          ['دانشجویان', data.stats.total],
          ['کارت صادرشده', data.stats.issued],
          ['مسدودی مالی', data.stats.blocked],
          ['باطل/منقضی/مفقود', data.stats.expired],
        ] as const).map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-3">
              <div className="text-[11px] font-bold text-muted-foreground">{label}</div>
              <div className="text-lg font-black">{faNumber(value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجو با شمارهٔ دانشجویی، کد ملی یا نام…" className="pr-9" />
          </div>
          {query ? <Button size="sm" variant="outline" onClick={() => setQuery('')}>پاک‌کردن</Button> : null}
          <span className="text-[11px] font-bold text-muted-foreground">
            {q ? `${faNumber(data.total)} نتیجه برای «${q}»` : `${faNumber(data.total)} دانشجو`}
          </span>
        </CardContent>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full border-collapse text-right text-xs">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              {['دانشجو', 'شمارهٔ دانشجویی', 'وضعیت تحصیلی', 'بدهی (ریال)', 'وضعیت کارت', 'انقضا', 'توکن امنیتی', 'عملیات'].map((h) => (
                <th key={h} className="whitespace-nowrap p-2.5 font-bold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: StudentCardRow) => (
              <tr key={r.studentId} className="border-t border-border/50 hover:bg-muted/40">
                <td className="p-2.5">
                  <div className="font-bold">{r.fullName}</div>
                  <div className="text-[10px] text-muted-foreground">{r.degreeLevel ?? '—'} · {r.majorName ?? 'بدون رشته'}</div>
                </td>
                <td className="p-2.5 font-mono font-bold" dir="ltr">{faDigits(r.studentCode)}</td>
                <td className="p-2.5">
                  <Badge variant={r.status === 'ACTIVE' ? 'success' : 'secondary'}>{r.status}</Badge>
                </td>
                <td className={`p-2.5 font-mono font-bold ${r.debt > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground'}`}>{faNumber(r.debt)}</td>
                <td className="p-2.5">
                  {r.card ? (
                    <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[r.card.printStatus] ?? STATUS_TONE.PENDING}`}>
                      {r.card.printStatus}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-muted-foreground">صادر نشده</span>
                  )}
                </td>
                <td className="p-2.5 font-mono text-[11px]" dir="ltr">{r.card?.expiresAt ? jdate(r.card.expiresAt) : '—'}</td>
                <td className="p-2.5">
                  {r.card ? <span className="font-mono text-[10px] text-muted-foreground" dir="ltr" title={r.card.token}>{r.card.token.slice(0, 12)}…</span> : '—'}
                </td>
                <td className="p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button size="sm" className="h-7 px-2 text-[10px]" disabled={issueMut.isPending} onClick={() => issueMut.mutate({ studentId: r.studentId, force: false })}>
                      {r.card ? 'تمدید' : 'صدور کارت'}
                    </Button>
                    {r.card ? (
                      <>
                        <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" disabled={issueMut.isPending} onClick={() => issueMut.mutate({ studentId: r.studentId, force: true })}>تعویض توکن</Button>
                        <Button size="sm" variant="outline" className="h-7 border-emerald-300 bg-emerald-50 px-2 text-[10px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" asChild>
                          <Link to={`/admin/student-cards/card/${r.studentId}`} target="_blank"><Printer className="size-3" aria-hidden /> چاپ کارت (QR)</Link>
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" asChild>
                          <a href={`/id/${r.card.token}`} target="_blank" rel="noreferrer">تست گیت ↗</a>
                        </Button>
                        <Button size="sm" variant="warning" className="h-7 px-2 text-[10px]" disabled={revokeMut.isPending} onClick={() => revokeMut.mutate({ studentId: r.studentId, status: 'LOST' })}>مفقودی</Button>
                        <Button size="sm" variant="destructive" className="h-7 px-2 text-[10px]" disabled={revokeMut.isPending} onClick={() => revokeMut.mutate({ studentId: r.studentId, status: 'REVOKED' })}>ابطال</Button>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {data.rows.length === 0 ? (
              <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">{q ? `دانشجویی با «${q}» یافت نشد.` : 'دانشجویی یافت نشد.'}</td></tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      {data.totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-muted-foreground">
          <span>نمایش {faNumber(from)}–{faNumber(to)} از {faNumber(data.total)}</span>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-7" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← قبلی</Button>
            <span className="px-2">صفحهٔ {faNumber(data.page)} از {faNumber(data.totalPages)}</span>
            <Button size="sm" variant="outline" className="h-7" disabled={data.page >= data.totalPages} onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}>بعدی →</Button>
          </div>
        </div>
      ) : null}

      <p className="text-[11px] leading-5 text-muted-foreground">
        کارت با وضعیت «باطل/مفقود/منقضی»، دانشجوی غیرفعال و دانشجوی دارای بدهی در گیت حراست قرمز می‌شود و ورود
        مجاز نیست. کد ملی در این فهرست ماسک‌شده نمایش داده می‌شود: <span className="font-mono" dir="ltr">{mask(data.rows[0]?.nationalCode ?? null)}</span>
      </p>
    </div>
  );
}

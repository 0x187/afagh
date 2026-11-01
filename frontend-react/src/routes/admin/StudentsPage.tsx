import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Search, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getAdminStudents, resetStudentPassword, setStudentActive } from '@/lib/admin-api';

// ═══ Student management — port of admin/students ═══

const STATUS_FA: Record<string, string> = {
  ACTIVE: 'مجاز به ادامه تحصیل', GRADUATED: 'فارغ‌التحصیل', PROBATION: 'مشروط',
  EXPELLED: 'اخراجی', WITHDRAWN: 'انصرافی', SUSPENDED: 'معلق', NO_SHOW: 'عدم مراجعه', TRANSFERRED: 'انتقالی',
};

const STATUSES = ['ALL', 'ACTIVE', 'GRADUATED', 'PROBATION', 'WITHDRAWN', 'SUSPENDED', 'NO_SHOW'];

export function AdminStudentsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-students', query, status, page],
    queryFn: () => getAdminStudents({ q: query, status, page }),
    staleTime: 20_000,
  });
  const activeMut = useMutation({
    mutationFn: ({ userId, active }: { userId: number; active: boolean }) => setStudentActive(userId, active),
    onSuccess: async () => {
      setMsg('وضعیت حساب تغییر کرد.');
      await qc.invalidateQueries({ queryKey: ['admin-students'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const resetMut = useMutation({
    mutationFn: (userId: number) => resetStudentPassword(userId),
    onSuccess: () => setMsg('رمز به کد ملی بازنشانی شد و تغییر رمز در ورود بعدی اجباری است.'),
    onError: (e: Error) => setMsg(e.message),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-emerald-800 to-teal-700 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="text-base font-black">مدیریت دانشجویان</h1>
            <p className="mt-0.5 text-xs text-emerald-100">{data ? `${faNumber(data.total)} دانشجو در دانشگاه فعال` : 'در حال بارگذاری…'}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="کد دانشجویی، کد ملی یا نام…" className="pr-9" onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); setQuery(search); } }} />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-input bg-transparent px-2 text-xs">
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'همهٔ وضعیت‌ها' : STATUS_FA[s] ?? s}</option>)}
          </select>
          <Button size="sm" onClick={() => { setPage(1); setQuery(search); }}>جست‌وجو</Button>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      {isLoading ? <Skeleton className="h-72 w-full" /> : isError || !data ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت دانشجویان ناموفق بود.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-right text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                  <th className="p-2.5">شمارهٔ دانشجویی</th><th className="p-2.5">نام</th><th className="p-2.5">کد ملی</th>
                  <th className="p-2.5">رشته / مقطع</th><th className="p-2.5 text-center">ورودی</th><th className="p-2.5">وضعیت</th><th className="p-2.5 text-center">حساب</th><th className="p-2.5 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">دانشجویی با این فیلتر یافت نشد.</td></tr>
                ) : data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                    <td className="p-2.5 font-mono text-[10px]" dir="ltr">{faDigits(r.studentCode)}</td>
                    <td className="p-2.5 font-bold">{r.fullName}</td>
                    <td className="p-2.5 font-mono text-[10px]" dir="ltr">{r.nationalCode ? faDigits(r.nationalCode) : '—'}</td>
                    <td className="p-2.5">{r.majorName ?? '—'} <span className="text-[10px] text-muted-foreground">{r.degreeTitle ?? ''}</span></td>
                    <td className="p-2.5 text-center">{faNumber(r.entryYear)}{r.entryTerm === 2 ? '/۲' : ''}</td>
                    <td className="p-2.5"><Badge variant={r.status === 'ACTIVE' ? 'default' : 'secondary'} className="text-[10px]">{STATUS_FA[r.status] ?? r.status}</Badge></td>
                    <td className="p-2.5 text-center">
                      {r.isActive ? <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 text-[10px]">فعال</Badge> : <Badge className="border-transparent bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200 text-[10px]">غیرفعال</Badge>}
                    </td>
                    <td className="p-2.5">
                      <div className="flex justify-center gap-1">
                        <Button size="sm" variant="outline" className="h-7 px-2" title={r.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'} disabled={activeMut.isPending} onClick={() => activeMut.mutate({ userId: r.id, active: !r.isActive })}>
                          {r.isActive ? <UserX className="size-3.5" aria-hidden /> : <UserCheck className="size-3.5" aria-hidden />}
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 px-2" title="بازنشانی رمز به کد ملی" disabled={resetMut.isPending} onClick={() => resetMut.mutate(r.id)}>
                          <KeyRound className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</Button>
        <span className="text-xs text-muted-foreground">صفحهٔ {faNumber(page)} از {faNumber(totalPages)}</span>
        <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>بعدی</Button>
      </div>

      <p className="text-center text-[10px] text-muted-foreground">
        نکته: «بازنشانی رمز» رمز را برابر کد ملی می‌گذارد و در ورود بعدی تغییر رمز اجباری می‌شود.
      </p>
    </div>
  );
}

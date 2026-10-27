import { useQuery } from '@tanstack/react-query';
import { Search, UserRound } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getAdminStaff } from '@/lib/admin-api';

// ═══ کارکنان و اساتید — پورت admin/staff (خواندن) ═══
export function AdminStaffPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-staff', query], queryFn: () => getAdminStaff(query), staleTime: 30_000 });

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-slate-900 to-indigo-800 text-white">
        <CardContent className="p-5">
          <h1 className="text-base font-black">کارکنان و اساتید</h1>
          <p className="mt-0.5 text-xs text-indigo-200">{data ? `${faNumber(data.length)} پروندهٔ کارمندی` : '…'}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="کد پرسنلی، نام یا کد ملی…" className="pr-9" onKeyDown={(e) => { if (e.key === 'Enter') setQuery(search); }} />
          </div>
          <Button size="sm" onClick={() => setQuery(search)}>جست‌وجو</Button>
        </CardContent>
      </Card>
      {isLoading ? <Skeleton className="h-64 w-full" /> : isError || !data ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت کارکنان ناموفق بود.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-right text-xs">
              <thead><tr className="border-b border-border bg-muted/60 text-muted-foreground"><th className="p-2.5">کد پرسنلی</th><th className="p-2.5">نام</th><th className="p-2.5">کد ملی</th><th className="p-2.5">مرتبه / نوع</th><th className="p-2.5">گروه</th><th className="p-2.5 text-center">وضعیت</th></tr></thead>
              <tbody>
                {data.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">پرونده‌ای یافت نشد.</td></tr> : data.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-0">
                    <td className="p-2.5 font-mono text-[10px]" dir="ltr">{faDigits(r.staffCode)}</td>
                    <td className="p-2.5 font-bold"><span className="flex items-center gap-1.5"><UserRound className="size-3.5 text-muted-foreground" aria-hidden /> {r.fullName}</span></td>
                    <td className="p-2.5 font-mono text-[10px]" dir="ltr">{r.nationalCode ? faDigits(r.nationalCode) : '—'}</td>
                    <td className="p-2.5">{r.academicRank ?? r.staffType ?? '—'}</td>
                    <td className="p-2.5">{r.departmentName ?? '—'}</td>
                    <td className="p-2.5 text-center"><Badge variant={r.isActive ? 'default' : 'secondary'} className="text-[10px]">{r.isActive ? 'فعال' : 'غیرفعال'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

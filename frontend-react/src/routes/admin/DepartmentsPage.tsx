import { useQuery } from '@tanstack/react-query';
import { Building2, Users } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import { getAdminDepartments } from '@/lib/admin-api';

// ═══ Faculties and groups — port of admin/departments (read) ═══
export function AdminDepartmentsPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-departments'], queryFn: getAdminDepartments, staleTime: 60_000 });
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت دانشکده‌ها ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-indigo-800 to-sky-700 text-white">
        <CardContent className="p-5">
          <h1 className="text-base font-black">دانشکده‌ها و گروه‌های آموزشی</h1>
          <p className="mt-0.5 text-xs text-indigo-100">{faNumber(data.faculties.length)} دانشکده · {faNumber(data.departments.length)} گروه</p>
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.faculties.map((f) => {
          const deps = data.departments.filter((d) => d.facultyId === f.id);
          return (
            <Card key={f.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm"><Building2 className="size-4 text-indigo-600" aria-hidden /> {f.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {deps.length === 0 ? <p className="text-xs text-muted-foreground">گروهی ثبت نشده است.</p> : deps.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs">
                    <span className="flex items-center gap-1.5"><Users className="size-3.5 text-muted-foreground" aria-hidden /> {d.name}</span>
                    {d.code ? <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{d.code}</span> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import { getSanjeshEnrolled } from '@/lib/sanjesh-drilldown-api';

import { SanjeshCounter, SanjeshFlash, SanjeshSteps } from './_ui';

// ═══ /admin/sanjesh/:id/enrolled — port of sanjesh/[id]/enrolled/page.tsx ═══
// Rows handed over to the admissions workspace. The rest of the process
// (student-code assignment, user creation) happens in /admin/admissions.

export function SanjeshEnrolledPage() {
  const params = useParams();
  const fileId = Number(params.id);
  const [search] = useSearchParams();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sanjesh-enrolled', fileId],
    queryFn: () => getSanjeshEnrolled(fileId),
    enabled: Number.isFinite(fileId) && fileId > 0,
  });

  if (!Number.isFinite(fileId) || fileId <= 0)
    return <p className="p-6 text-sm text-red-600">شناسهٔ فایل نامعتبر است.</p>;
  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data)
    return <p className="p-6 text-sm text-red-600">{error instanceof Error ? error.message : 'فایل یافت نشد.'}</p>;

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <SanjeshSteps fileId={fileId} active="enrolled" />
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-base font-black text-foreground">ثبت‌نام‌شده — {data.file.title}</h1>
          <p className="text-[11px] text-muted-foreground">
            ردیف‌هایی که به کارتابل پذیرش منتقل شده‌اند. ادامهٔ فرآیند (تخصیص شمارهٔ دانشجویی و ساخت کاربر) در کارتابل
            پذیرش انجام می‌شود.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <SanjeshCounter label="منتقل‌شده" value={data.staged.length} tone="sky" />
          <SanjeshCounter label="دارای شمارهٔ دانشجویی" value={data.withCode} tone="emerald" />
        </div>
      </header>

      <SanjeshFlash msg={search.get('msg')} err={search.get('err')} />

      <div className="mb-3">
        <Button size="sm" variant="ghost" asChild>
          <Link to="/admin/admissions">رفتن به کارتابل پذیرش ←</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="max-h-[60vh] overflow-auto rounded-xl border border-border">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                <tr>
                  <th className="sticky right-0 z-20 w-12 bg-muted p-2 font-bold shadow-[-2px_0_0_0_rgba(148,163,184,0.5)]">ردیف</th>
                  <th className="p-2 font-bold">نام</th>
                  <th className="p-2 font-bold">کد ملی</th>
                  <th className="p-2 font-bold">شمارهٔ دانشجویی</th>
                  <th className="p-2 font-bold">وضعیت پذیرش</th>
                  <th className="p-2 font-bold">وضعیت ثبت‌نام</th>
                </tr>
              </thead>
              <tbody>
                {data.staged.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground">
                      هنوز ردیفی به پذیرش منتقل نشده است.
                    </td>
                  </tr>
                ) : (
                  data.staged.map((s) => (
                    <tr key={s.id} className="border-t border-border/50">
                      <td className="sticky right-0 z-10 bg-inherit p-2 text-center tabular-nums text-muted-foreground shadow-[-2px_0_0_0_rgba(148,163,184,0.35)]">
                        {s.rowNo != null ? faNumber(s.rowNo) : '—'}
                      </td>
                      <td className="p-2">{s.fullName ?? '—'}</td>
                      <td className="p-2 tabular-nums" dir="ltr">
                        {s.nationalCode ?? '—'}
                      </td>
                      <td className="p-2 tabular-nums" dir="ltr">
                        {s.studentCode ?? s.assignedStudentCode ?? <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="p-2">{s.status ?? '—'}</td>
                      <td className="p-2">
                        <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                          {s.onboardingStatus ?? '—'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {data.staged.length === 500 && (
            <p className="mt-2 text-[10px] text-muted-foreground">فقط ۵۰۰ ردیف اول نمایش داده شده است.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits } from '@/lib/fa';
import { getSamaSyncStatus } from '@/lib/admin-modules6-api';

// ═══ همگام‌سازی سما → آفاق (وضعیت + سوابق) — port of admin/sama-sync ═══
//
// The weekly apply engine runs server-side (cron); this page shows the active
// university, its terms and the recorded SAMA_SYNC_APPLY runs. The trigger
// button stays disabled until the cron is ported to the Go backend.

export function SamaSyncPage() {
  const q = useQuery({ queryKey: ['admin-sama-sync'], queryFn: getSamaSyncStatus, staleTime: 30_000 });
  const st = q.data?.data;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-sky-900 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="text-base font-black">🔄 همگام‌سازی سما → آفاق</h1>
          <p className="mt-1 text-xs leading-6 text-sky-100">
            اجرای هفتگی: افزودنِ ثبت‌نام‌هایی که در سما هستند و در آفاق نیستند، و پرکردنِ نمره‌های خالی.
            حذف واحد یا بازنویسی نمرهٔ موجود هرگز انجام نمی‌شود — این‌ها به‌عنوان اختلاف گزارش می‌شوند.
          </p>
          {st ? (
            <p className="mt-2 text-[10px] text-sky-200">
              دانشگاه فعال: <b>{st.universityTitle}</b> · ترم جاری: <b>{st.currentTermCode ?? '—'}</b>
            </p>
          ) : null}
        </CardContent>
      </Card>

      {q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError || !st ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت وضعیت همگام‌سازی ناموفق بود. (فقط مدیر ارشد سامانه)</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button disabled={!st.available} title={st.available ? undefined : 'موتور اجرا روی سرور (cron) فعال نیست'}>
                ▶ اجرای همگام‌سازی
              </Button>
              {!st.available ? (
                <span className="text-xs font-bold text-muted-foreground">
                  موتور اجرای هفتگی سما روی نسخهٔ فعلی فعال نیست؛ اجرا باید از سرور انجام شود. این صفحه وضعیت و سوابق را نشان می‌دهد.
                </span>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2">
              <h2 className="text-sm font-black">نیم‌سال‌های دانشگاه</h2>
              <div className="flex flex-wrap gap-1.5">
                {st.terms.map((t) => (
                  <Badge key={t.termCode} variant={t.isCurrent ? 'default' : 'outline'}>
                    {t.termCode} — {t.title}{t.isCurrent ? ' (جاری)' : ''}
                  </Badge>
                ))}
                {!st.terms.length && <p className="text-xs text-muted-foreground">نیم‌سالی ثبت نشده است.</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2">
              <h2 className="text-sm font-black">آخرین اجراها</h2>
              {st.runs.length === 0 ? (
                <p className="text-xs text-muted-foreground">تا امروز اجرایی ثبت نشده است.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-muted/60 text-muted-foreground">
                      <tr>
                        {['#', 'زمان', 'کاربر', 'ترم', 'افزوده', 'نمره'].map((h) => (
                          <th key={h} className="p-2 text-right font-black">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {st.runs.map((r) => (
                        <tr key={r.id} className="border-t border-border/50">
                          <td className="p-2 font-mono text-muted-foreground" dir="ltr">{faDigits(r.id)}</td>
                          <td className="p-2 font-mono" dir="ltr">{r.at.slice(0, 19).replace('T', ' ')}</td>
                          <td className="p-2">{r.actor ?? '—'}</td>
                          <td className="p-2 font-mono" dir="ltr">{r.termCode ?? '—'}</td>
                          <td className="p-2 font-bold text-emerald-700 dark:text-emerald-400">{faDigits(r.inserted)}</td>
                          <td className="p-2 font-bold text-sky-700 dark:text-sky-400">{faDigits(r.gradesFilled)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

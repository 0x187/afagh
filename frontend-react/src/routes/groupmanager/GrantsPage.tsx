import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Search } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getGrants, saveGrant } from '@/lib/groupmanager-api';
import { GmLayout } from './GmLayout';

// ═══ Higher-term course grant — port of group-manager/grants ═══

export function GmGrantsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const major = params.get('major') ? Number(params.get('major')) : undefined;
  const year = params.get('year') ? Number(params.get('year')) : undefined;
  const student = params.get('student') ? Number(params.get('student')) : undefined;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['gm-grants', major, year, student],
    queryFn: () => getGrants({ major, year, student }),
    staleTime: 20_000,
  });
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const grantMut = useMutation({
    mutationFn: ({ courseId, revoke }: { courseId: number; revoke: boolean }) =>
      saveGrant(student!, courseId, reasons[courseId] ?? '', revoke),
    onSuccess: async () => {
      setMsg('تخصیص به‌روزرسانی شد.');
      await qc.invalidateQueries({ queryKey: ['gm-grants'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  function select(nextMajor?: number, nextYear?: number, nextStudent?: number) {
    const p = new URLSearchParams();
    if (nextMajor) p.set('major', String(nextMajor));
    if (nextYear) p.set('year', String(nextYear));
    if (nextStudent) p.set('student', String(nextStudent));
    setParams(p);
  }

  return (
    <GmLayout>
      {isLoading ? <Skeleton className="h-72 w-full" /> : isError || !data ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت اطلاعات تخصیص ناموفق بود.</CardContent></Card>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-4 text-xs leading-6 text-muted-foreground shadow-xs">
            درسِ ترم‌های بالاتر فقط با تخصیص شما برای دانشجو نمایان می‌شود. تخصیص تنها برای دروس داخل چارتِ همان دانشجو ممکن است.
          </div>
          {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

          <Card>
            <CardContent className="flex flex-wrap items-end gap-2 p-3">
              <div>
                <label className="text-[11px] font-bold" htmlFor="gm-major">رشته</label>
                <select id="gm-major" value={data.majorId} onChange={(e) => select(Number(e.target.value), data.year)} className="mt-1 h-8 rounded-lg border border-input bg-transparent px-2 text-xs">
                  {data.majors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold" htmlFor="gm-year">ورودی</label>
                <select id="gm-year" value={data.year} onChange={(e) => select(data.majorId, Number(e.target.value))} className="mt-1 h-8 rounded-lg border border-input bg-transparent px-2 text-xs">
                  {data.years.map((y) => <option key={y} value={y}>{faNumber(y)}</option>)}
                </select>
              </div>
              <Button size="sm" variant="outline" onClick={() => select(data.majorId, data.year)}><Search className="size-4" aria-hidden /> نمایش</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">دانشجویان ({faNumber(data.students.length)})</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-xs">
                <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2">نام</th><th className="p-2">شمارهٔ دانشجویی</th><th className="p-2">ورودی</th><th className="p-2"></th></tr></thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.id} className={`border-b border-border/50 last:border-0 ${data.selected?.id === s.id ? 'bg-primary/5' : ''}`}>
                      <td className="p-2 font-bold">{s.fullName}</td>
                      <td className="p-2 font-mono text-[10px]" dir="ltr">{s.studentCode}</td>
                      <td className="p-2">{faNumber(s.entryYear)}{s.entryTerm === 2 ? '/۲' : ''}</td>
                      <td className="p-2">
                        <Button size="sm" variant="outline" className="h-7" onClick={() => select(data.majorId, data.year, s.id)}>تخصیص درس</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {data.selected ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  چارت {data.selected.fullName} — {data.selected.majorName}
                  {data.versionCode ? ` (نسخهٔ ${faDigits(data.versionCode)})` : ''}
                  {data.termOrdinal != null ? ` · ترم ${faNumber(data.termOrdinal)}` : ''}
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {!data.chartResolved ? (
                  <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                    برای این دانشجو چارت منتشرشده‌ای حل نشده است؛ ابتدا چارت رشته را منتشر کنید.
                  </p>
                ) : (
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                        <th className="p-2">کد</th><th className="p-2">درس</th><th className="p-2">واحد</th><th className="p-2">ترم چارت</th><th className="p-2">وضعیت</th><th className="p-2">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.chartRows.map((r) => (
                        <tr key={r.courseId} className="border-b border-border/50 last:border-0">
                          <td className="p-2 font-mono text-[10px]" dir="ltr">{r.code}</td>
                          <td className="p-2 font-semibold">{r.title}</td>
                          <td className="p-2">{faNumber(r.units)}</td>
                          <td className="p-2">{r.recommendedSemester == null ? '—' : faNumber(r.recommendedSemester)}</td>
                          <td className="p-2">
                            {r.granted ? <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">تخصیص‌شده</Badge>
                              : r.isHigher ? <Badge className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">ترم بالاتر — مخفی</Badge>
                              : <Badge variant="secondary">قابل اخذ</Badge>}
                          </td>
                          <td className="p-2">
                            {r.granted ? (
                              <Button size="sm" variant="ghost" className="h-7 text-rose-600" onClick={() => grantMut.mutate({ courseId: r.courseId, revoke: true })}>لغو تخصیص</Button>
                            ) : r.isHigher ? (
                              <span className="flex items-center gap-1">
                                <Input value={reasons[r.courseId] ?? ''} onChange={(e) => setReasons((prev) => ({ ...prev, [r.courseId]: e.target.value }))} placeholder="دلیل (اختیاری)" className="h-7 w-32 text-[10px]" />
                                <Button size="sm" className="h-7" onClick={() => grantMut.mutate({ courseId: r.courseId, revoke: false })}><ListChecks className="size-3.5" aria-hidden /> تخصیص</Button>
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </GmLayout>
  );
}

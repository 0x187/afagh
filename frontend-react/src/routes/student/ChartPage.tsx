import { useQuery } from '@tanstack/react-query';
import { Map, Printer, ShoppingCart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getChart, type ChartRow } from '@/lib/student-api';

// ═══ چارت تحصیلی دانشجو — پورت student/chart ═══

const ROLE_FA: Record<string, string> = {
  CORE: 'اصلی',
  MAJOR: 'تخصصی',
  ELECTIVE: 'اختیاری',
  GENERAL: 'عمومی',
  THESIS: 'پایان‌نامه',
  INTERNSHIP: 'کارآموزی',
  WORKSHOP: 'کارگاهی',
};

function StatusBadge({ row }: { row: ChartRow }) {
  switch (row.status) {
    case 'PASSED':
      return <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">✓ گذرانده‌شده</Badge>;
    case 'IN_PROGRESS':
      return <Badge className="border-transparent bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200">⏳ در حال گذران</Badge>;
    case 'MISSING_PAST':
      return <Badge className="border-transparent bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">✗ اخذنشده (ترم گذشته)</Badge>;
    default:
      return <Badge variant="secondary">🔒 ترم‌های بعد</Badge>;
  }
}

export function StudentChartPage() {
  const [printing, setPrinting] = useState(false);
  const { data, isLoading, isError } = useQuery({ queryKey: ['student-chart'], queryFn: getChart, staleTime: 60_000 });

  useEffect(() => {
    if (!data?.highlightAnchor) return;
    const el = document.getElementById(data.highlightAnchor);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [data?.highlightAnchor]);

  function doPrint() {
    setPrinting(true);
    window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 60);
  }

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-72 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت چارت تحصیلی ناموفق بود.</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-0 bg-gradient-to-l from-emerald-800 to-teal-900 p-5 text-white shadow-md">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15">
            <Map className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-base font-extrabold">چارت تحصیلی و کاتالوگ سرفصل دروس مصوب</h1>
            <p className="mt-0.5 text-xs text-emerald-200">
              رشته: {data.majorName} — مقطع: {data.degreeTitle}
              {data.versionCode ? ` — نسخهٔ ${faDigits(data.versionCode)}` : ''}
              {` — ${faNumber(data.chartUnits)} واحد در سرفصل`}
              {data.requiredUnits > 0 ? ` / ${faNumber(data.requiredUnits)} واحد الزامی` : ''}
            </p>
          </div>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <Link to="/student/enroll" className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-50">
            <ShoppingCart className="size-4" aria-hidden /> ورود به انتخاب واحد
          </Link>
          <Button size="sm" variant="secondary" onClick={doPrint} disabled={printing}>
            <Printer className="size-4" aria-hidden /> چاپ
          </Button>
        </div>
      </div>

      {data.semesters.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 py-8 text-center">
            <p className="text-sm font-bold">چارت برای این دانشجو تعریف نشده است.</p>
            <p className="text-xs text-muted-foreground">
              نسخهٔ برنامهٔ درسیِ منتشرشده‌ای برای رشته و مقطع شما (سال ورود {faDigits(data.entryYear)}) ثبت نشده است.
            </p>
            <p className="text-xs text-muted-foreground">
              سوابق واقعی دروس اخذشدهٔ شما: {faNumber(data.enrollmentCount)} عنوان درسی در کارنامه ثبت شده است.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {data.filteredTermTitle && data.currentSemesterNo == null ? (
            <p className="rounded-xl border border-border bg-card p-4 text-center text-xs text-muted-foreground">
              در نیمسال «{data.filteredTermTitle}» درسی برای شما ثبت نشده است؛ بلوکی از چارت برجسته نمی‌شود.
            </p>
          ) : null}

          <div className="space-y-4">
            {data.semesters.map((sem) => (
              <Card
                key={sem.key}
                id={`afagh-term-sem-${sem.key}`}
                className={`scroll-mt-24 ${sem.isHighlighted ? 'border-2 border-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-900' : ''}`}
              >
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold">{sem.title}</span>
                      <Badge variant="secondary" className="font-mono">{faNumber(sem.units)} واحد</Badge>
                      {sem.isHighlighted ? (
                        <Badge className="border-transparent bg-emerald-600 text-white">نیمسال انتخابی</Badge>
                      ) : null}
                    </div>
                    {sem.isCurrent ? (
                      <Link to="/student/enroll" className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                        ⚡ انتخاب هوشمند این ترم
                      </Link>
                    ) : null}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-right text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                          <th className="p-2">کد درس</th>
                          <th className="p-2">عنوان درس</th>
                          <th className="p-2 text-center">واحد</th>
                          <th className="p-2">نوع</th>
                          <th className="p-2">پیش‌نیازها</th>
                          <th className="p-2 text-left">وضعیت شما</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sem.rows.map((c) => (
                          <tr key={c.id} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                            <td className="p-2 font-mono text-muted-foreground" dir="ltr">{c.code}</td>
                            <td className="p-2 font-semibold">{c.title}</td>
                            <td className="p-2 text-center font-mono font-bold">{faNumber(c.units)}</td>
                            <td className="p-2 text-muted-foreground">{ROLE_FA[c.roleType] ?? c.roleType}</td>
                            <td className="p-2 text-muted-foreground">{c.prereqCodes.length ? c.prereqCodes.join('، ') : '—'}</td>
                            <td className="p-2 text-left"><StatusBadge row={c} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            💡 <b>راهنمای سرفصل:</b> بر اساس چارت مصوب رشته، اخذ دروس ترم‌های بالاتر فقط با رعایت تمامی پیش‌نیازها و سقف واحدهای ترم مجاز است.
          </div>

          <Card>
            <CardContent className="space-y-3 p-4">
              <h4 className="text-sm font-extrabold">📋 جمع‌بندی نوع درس و پیشرفت شما</h4>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-muted text-center">
                      <th className="border border-border p-2">نوع درس</th>
                      <th className="border border-border p-2">تعداد (گذرانده / کل)</th>
                      <th className="border border-border p-2">واحد (گذرانده / کل)</th>
                      <th className="border border-border p-2">✓</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.roleSummary.map((r) => (
                      <tr key={r.roleType} className="text-center">
                        <td className="border border-border p-2 font-extrabold">{ROLE_FA[r.roleType] ?? r.roleType}</td>
                        <td className="border border-border p-2 font-black">{faNumber(r.passed)} / {faNumber(r.total)}</td>
                        <td className="border border-border p-2 font-black">{faNumber(r.passedUnits)} / {faNumber(r.units)}</td>
                        <td className="border border-border p-2">
                          {r.total > 0 && r.passed === r.total ? <span className="font-black text-emerald-600">✓</span> : <span className="inline-block size-4 rounded-sm border-2 border-muted-foreground/50" />}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-indigo-50 text-center font-black dark:bg-indigo-950/40">
                      <td className="border border-border p-2">جمع کل</td>
                      <td className="border border-border p-2">
                        {faNumber(data.roleSummary.reduce((s, r) => s + r.passed, 0))} / {faNumber(data.roleSummary.reduce((s, r) => s + r.total, 0))}
                      </td>
                      <td className="border border-border p-2">
                        {faNumber(data.roleSummary.reduce((s, r) => s + r.passedUnits, 0))} / {faNumber(data.roleSummary.reduce((s, r) => s + r.units, 0))}
                      </td>
                      <td className="border border-border p-2">
                        {data.roleSummary.length > 0 && data.roleSummary.every((r) => r.passed === r.total) ? (
                          <span className="font-black text-emerald-600">✓</span>
                        ) : (
                          <span className="inline-block size-4 rounded-sm border-2 border-muted-foreground/50" />
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] font-bold text-muted-foreground">خانهٔ تیک‌دار = همهٔ دروس آن نوع گذرانده شده‌اند؛ خالی = هنوز مانده.</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

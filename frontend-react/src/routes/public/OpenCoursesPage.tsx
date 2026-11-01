import { useMutation, useQuery } from '@tanstack/react-query';
import { BookOpen, CalendarDays, CheckCircle2, Clock, GraduationCap, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet, apiPost } from '@/lib/api';
import { faDigits, faRial } from '@/lib/fa';

// ═══ Public open-course catalog — port of open-courses ═══

type OpenCourse = {
  id: number; code: string; title: string; titleEn: string; category: string; description: string;
  hours: number; tuitionPrice: number; capacity: number; enrolledCount: number;
  instructorName: string; instructorBio: string; syllabus: string[];
  scheduleText: string; startDate: string; endDate: string; passingGrade: number;
};

type DiscountPreview = { ok: boolean; discountAmount?: number; error?: string };
type RegisterResult = { ok: boolean; trackingCode?: string; amountDue?: number; discountAmount?: number; error?: string };

export function OpenCoursesPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['open-courses'],
    queryFn: () => apiGet<{ ok: boolean; data: { courses: OpenCourse[] } }>('/public/open-courses').then((r) => r.data.courses),
    staleTime: 30_000,
  });
  const [selected, setSelected] = useState<OpenCourse | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 p-4 dark:from-slate-950 dark:to-slate-900" dir="rtl">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-3xl bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 p-6 text-white shadow-lg">
          <h1 className="flex items-center gap-2 text-lg font-black sm:text-xl"><GraduationCap className="size-6" aria-hidden /> دوره‌های آزاد دانشگاه آفاق</h1>
          <p className="mt-1 text-xs text-emerald-100">ثبت‌نام آنلاین، بدون نیاز به حساب دانشجویی — پرداخت پس از ثبت‌نام در محل دانشگاه انجام می‌شود.</p>
        </div>

        {isLoading ? <Skeleton className="h-64 w-full" /> : isError || !data ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت کاتالوگ دوره‌ها ناموفق بود.</CardContent></Card>
        ) : data.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">در حال حاضر دورهٔ آزاد فعالی برای ثبت‌نام وجود ندارد.</CardContent></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.map((c) => (
              <Card key={c.id} className="overflow-hidden">
                <CardHeader className="pb-1">
                  <CardTitle className="flex items-start justify-between gap-2 text-sm">
                    <span>{c.title}</span>
                    <Badge variant="outline" className="shrink-0 font-mono text-[10px]" dir="ltr">{c.code}</Badge>
                  </CardTitle>
                  <p className="text-[11px] text-muted-foreground">{c.titleEn || c.category}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="line-clamp-2 text-[11px] leading-5 text-muted-foreground">{c.description || '—'}</p>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <span className="flex items-center gap-1"><Clock className="size-3.5 text-muted-foreground" aria-hidden /> {faDigits(c.hours)} ساعت</span>
                    <span className="flex items-center gap-1"><UserRound className="size-3.5 text-muted-foreground" aria-hidden /> {c.instructorName}</span>
                    <span className="flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-300">{faRial(c.tuitionPrice)}</span>
                    <span className="flex items-center gap-1">{faDigits(c.enrolledCount)} / {faDigits(c.capacity)} نفر</span>
                    {c.startDate ? <span className="col-span-2 flex items-center gap-1 text-muted-foreground"><CalendarDays className="size-3.5" aria-hidden /> {faDigits(c.startDate)} تا {faDigits(c.endDate)}</span> : null}
                  </div>
                  {c.scheduleText ? <p className="text-[10px] text-muted-foreground">🕐 {c.scheduleText}</p> : null}
                  <Button size="sm" className="w-full" disabled={c.enrolledCount >= c.capacity} onClick={() => setSelected(c)}>
                    {c.enrolledCount >= c.capacity ? 'ظرفیت تکمیل' : 'ثبت‌نام در دوره'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {selected ? <RegisterDialog course={selected} onClose={() => setSelected(null)} /> : null}
      </div>
    </div>
  );
}

function RegisterDialog({ course, onClose }: { course: OpenCourse; onClose: () => void }) {
  const [form, setForm] = useState({ fullName: '', fullNameEn: '', nationalId: '', mobile: '', discountCode: '' });
  const [preview, setPreview] = useState<DiscountPreview | null>(null);
  const [result, setResult] = useState<RegisterResult | null>(null);

  const discountMut = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; data: DiscountPreview }>('/public/open-courses/discount', { courseId: course.id, code: form.discountCode }).then((r) => r.data),
    onSuccess: (d) => setPreview(d),
  });
  const registerMut = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; data: RegisterResult }>('/public/open-courses/register', { courseId: course.id, ...form }).then((r) => r.data),
    onSuccess: (r) => setResult(r),
  });

  const amountDue = useMemo(() => {
    const discount = preview?.ok ? (preview.discountAmount ?? 0) : 0;
    return Math.max(0, course.tuitionPrice - discount);
  }, [preview, course.tuitionPrice]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" dir="rtl">
      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>ثبت‌نام — {course.title}</span>
            <Button size="sm" variant="ghost" onClick={onClose}>بستن</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {result?.ok ? (
            <div className="space-y-2 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-center dark:border-emerald-800 dark:bg-emerald-950/40">
              <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden />
              <p className="text-sm font-black text-emerald-800 dark:text-emerald-200">ثبت‌نام شما با موفقیت ثبت شد</p>
              <p className="text-xs text-muted-foreground">کد رهگیری: <b className="font-mono" dir="ltr">{result.trackingCode}</b></p>
              <p className="text-xs">مبلغ قابل پرداخت: <b className="font-mono">{faRial(result.amountDue ?? 0)}</b></p>
              {(result.discountAmount ?? 0) > 0 ? <p className="text-[11px] text-emerald-700 dark:text-emerald-300">تخفیف اعمال‌شده: {faRial(result.discountAmount)}</p> : null}
              <p className="rounded-xl bg-white/70 p-2 text-[10px] leading-5 text-muted-foreground dark:bg-slate-900/70">
                پرداخت را با همین کد رهگیری در محل دانشگاه (شعبهٔ بانک/صندوق) انجام دهید. ظرفیت شما تا پرداخت رزرو می‌ماند.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-[11px]">نام و نام خانوادگی</Label><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="mt-1 h-8" /></div>
                <div><Label className="text-[11px]">نام انگلیسی</Label><Input value={form.fullNameEn} onChange={(e) => setForm({ ...form, fullNameEn: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
                <div><Label className="text-[11px]">کد ملی</Label><Input value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" maxLength={10} /></div>
                <div><Label className="text-[11px]">شمارهٔ همراه</Label><Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" placeholder="0912…" maxLength={11} /></div>
                <div className="col-span-2"><Label className="text-[11px]">کد تخفیف (اختیاری)</Label>
                  <div className="mt-1 flex gap-1.5">
                    <Input value={form.discountCode} onChange={(e) => { setForm({ ...form, discountCode: e.target.value }); setPreview(null); }} className="h-8 font-mono" dir="ltr" />
                    <Button size="sm" variant="outline" className="h-8" disabled={discountMut.isPending || !form.discountCode} onClick={() => discountMut.mutate()}>بررسی</Button>
                  </div>
                </div>
              </div>
              {preview ? (
                preview.ok ? (
                  <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                    تخفیف: {faRial(preview.discountAmount)} — مبلغ نهایی: {faRial(amountDue)}
                  </p>
                ) : (
                  <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{preview.error}</p>
                )
              ) : null}
              {registerMut.data && !registerMut.data.ok && registerMut.data.error ? (
                <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{registerMut.data.error}</p>
              ) : null}
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-2 text-[11px]">
                <span><BookOpen className="ml-1 inline size-3.5" aria-hidden /> شهریه: {faRial(course.tuitionPrice)}</span>
                <span className="font-black">قابل پرداخت: {faRial(amountDue)}</span>
              </div>
              <Button className="w-full" disabled={registerMut.isPending || !form.fullName || !form.nationalId || !form.mobile} onClick={() => registerMut.mutate()}>
                ثبت‌نام و دریافت کد رهگیری
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

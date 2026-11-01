import { useQuery } from '@tanstack/react-query';
import { CalendarClock, IdCard, Printer, ScanLine, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faRial } from '@/lib/fa';
import { getStudentExamCard } from '@/lib/student-api';

// ═══ Exam card and session entry — port of student/exam-card ═══

function faDate(value: string): string {
  if (!value || value === '—') return '—';
  return faDigits(value.replace(/-/g, '/'));
}

/** Today's date in Jalali (Intl fa-IR calendar in modern browsers). */
function todayFa(): string {
  try {
    return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return '—';
  }
}

export function StudentExamCardPage() {
  const [printing, setPrinting] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-exam-card'],
    queryFn: () => getStudentExamCard(),
    staleTime: 60_000,
  });

  function doPrint() {
    setPrinting(true);
    window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 60);
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }
  if (isError || !data || !data.card) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {data?.examTicketBlocked ?? 'دریافت کارت آزمون ناموفق بود.'}
        </CardContent>
      </Card>
    );
  }

  const card = data.card;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 px-4 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
            <IdCard className="size-4.5" aria-hidden />
          </span>
          <div>
            <h1 className="text-sm font-bold">کارت ورود به جلسهٔ آزمون — {card.termTitle}</h1>
            <p className="text-[11px] text-muted-foreground">
              همراه داشتن این برگهٔ چاپ‌شده و کارت ملی در جلسهٔ آزمون الزامی است.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={doPrint} disabled={printing}>
          <Printer className="size-4" aria-hidden />
          چاپ برگهٔ A4
        </Button>
      </div>

      {data.noCourses ? (
        <p className="no-print rounded-xl border border-border bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
          برای این نیمسال هیچ ثبت‌نامی برای شما ثبت نشده است؛ بنابراین برنامهٔ امتحان یا صندلی‌ای وجود ندارد.
        </p>
      ) : null}

      {!card.isFinancialCleared ? (
        <div className="no-print flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            بدهی مالی شما {faRial(card.debtRials)} است. صدور کارت ورود به جلسه در گیت آزمون تا تسویهٔ کامل
            ممکن نیست.
          </p>
        </div>
      ) : null}

      {data.examTicketBlocked ? (
        <div className="no-print rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {data.examTicketBlocked}
        </div>
      ) : null}

      {/* Card sheet */}
      <div className="print-area overflow-hidden rounded-xl border-2 border-slate-800 bg-white text-slate-900 shadow-xl">
        <div className="border-b-2 border-slate-800 bg-gradient-to-l from-slate-900 to-indigo-900 px-5 py-4 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-right">
              <p className="text-[11px] text-white/70">جمهوری اسلامی ایران — وزارت علوم، تحقیقات و فناوری</p>
              <h2 className="text-lg font-black">{data.university.title}</h2>
              <p className="text-[11px] text-white/80">کارت ورود به جلسهٔ امتحانات پایان نیمسال</p>
            </div>
            <div className="text-left text-[11px]">
              <p>نیمسال: <b>{card.termTitle}</b></p>
              <p>تاریخ چاپ: <b>{todayFa()}</b></p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 border-b border-slate-300 p-4">
          {data.ticketQr ? (
            <div
              className="size-28 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white"
              dangerouslySetInnerHTML={{ __html: data.ticketQr.svg }}
            />
          ) : null}
          <div className="grid min-w-52 flex-1 grid-cols-1 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
            <p><span className="text-slate-500">نام و نام خانوادگی: </span><b>{card.fullName}</b></p>
            <p><span className="text-slate-500">شمارهٔ دانشجویی: </span><b className="font-mono" dir="ltr">{faDigits(card.studentCode)}</b></p>
            <p><span className="text-slate-500">کد ملی: </span><b className="font-mono" dir="ltr">{faDigits(card.nationalIdMasked)}</b></p>
            <p><span className="text-slate-500">رشته: </span><b>{card.majorName ?? '—'}</b></p>
            <p><span className="text-slate-500">سال ورود: </span><b>{faDigits(card.entryYear)}</b></p>
            <p>
              <span className="text-slate-500">وضعیت مالی: </span>
              {card.isFinancialCleared ? (
                <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">تسویه ✓</Badge>
              ) : (
                <Badge className="border-transparent bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">{faRial(card.debtRials)}</Badge>
              )}
            </p>
          </div>
          <div className="flex flex-col items-center gap-1 text-center text-[10px] text-slate-500">
            <ScanLine className="size-5" aria-hidden />
            <span>استعلام در گیت آزمون</span>
          </div>
        </div>

        <table className="w-full border-collapse text-right text-[11px]">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-100 font-bold text-slate-800">
              <th className="w-8 border-l border-slate-300 p-2 text-center">#</th>
              <th className="border-l border-slate-300 p-2">نام درس</th>
              <th className="w-20 border-l border-slate-300 p-2 text-center">کد درس</th>
              <th className="w-16 border-l border-slate-300 p-2 text-center">واحد</th>
              <th className="w-28 border-l border-slate-300 p-2 text-center">تاریخ آزمون</th>
              <th className="w-32 border-l border-slate-300 p-2 text-center">ساعت</th>
              <th className="w-28 border-l border-slate-300 p-2 text-center">سالن</th>
              <th className="w-20 p-2 text-center">صندلی</th>
            </tr>
          </thead>
          <tbody>
            {card.courses.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-400">درسی برای این نیمسال ثبت نشده است.</td>
              </tr>
            ) : (
              card.courses.map((c, idx) => (
                <tr key={c.enrollmentId} className="border-b border-slate-200 last:border-0">
                  <td className="border-l border-slate-200 p-2 text-center text-slate-500">{faDigits(idx + 1)}</td>
                  <td className="border-l border-slate-200 p-2 font-semibold">
                    {c.courseTitle}
                    <span className="mr-2 text-[10px] text-slate-400">استاد: {c.professorName}</span>
                  </td>
                  <td className="border-l border-slate-200 p-2 text-center font-mono" dir="ltr">{c.courseCode}</td>
                  <td className="border-l border-slate-200 p-2 text-center font-bold">{faDigits(c.units)}</td>
                  <td className="border-l border-slate-200 p-2 text-center">{faDate(c.examDate)}</td>
                  <td className="border-l border-slate-200 p-2 text-center font-mono" dir="ltr">{faDigits(c.examTime)}</td>
                  <td className="border-l border-slate-200 p-2 text-center">{c.examHall ?? '—'}</td>
                  <td className="p-2 text-center">
                    {c.seatNumber != null ? (
                      <b className="font-mono text-indigo-800">{faDigits(c.seatNumber)}</b>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="space-y-2 border-t border-slate-300 bg-slate-50 px-4 py-3 text-[10px] leading-relaxed text-slate-600">
          <p className="flex items-center gap-1.5 font-bold text-slate-800">
            <CalendarClock className="size-3.5" aria-hidden />
            نکات مهم جلسهٔ آزمون
          </p>
          <p>
            حضور ۳۰ دقیقه پیش از شروع آزمون در سالن الزامی است. همراه داشتن کارت ملی، کارت آزمون چاپ‌شده و
            خودکار مشکی. استفاده از هرگونه دستگاه الکترونیکی ممنوع و موجب لغو آزمون می‌شود.
          </p>
          <p className="text-slate-500">
            {data.evaluationWindow.message} {data.evaluationWindow.title ? `— ${data.evaluationWindow.title}` : ''}
          </p>
        </div>
      </div>

      <p className="no-print text-center text-[10px] text-muted-foreground">
        این برگه با QR امضاشده صادر شده است؛ تغییر یا تکثیر آن موجب بطلان کارت می‌شود.
      </p>
    </div>
  );
}

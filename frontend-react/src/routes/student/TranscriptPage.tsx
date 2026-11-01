import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Printer, ScanLine, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getStudentTranscript, type TranscriptRow, type TranscriptTerm } from '@/lib/student-api';

// ═══ Academic transcript — port of student/transcript/page.tsx ═══

function resultLabel(row: TranscriptRow): { text: string; className: string } {
  if (row.emergencyWithdrawal) return { text: 'حذف اضطراری', className: 'text-rose-600 dark:text-rose-400' };
  if (row.status === 'EQUIV_PASSED') return { text: 'معادل', className: 'text-teal-600 dark:text-teal-400' };
  switch (row.result) {
    case 'PENDING':
      return { text: 'جاری', className: 'text-muted-foreground font-normal' };
    case 'FAILED':
      return { text: 'مردود', className: 'text-red-600 dark:text-red-400' };
    case 'PASSED':
      return { text: 'قبول', className: 'text-emerald-600 dark:text-emerald-400' };
    default:
      return { text: row.result, className: 'text-muted-foreground' };
  }
}

function TermCard({ term }: { term: TranscriptTerm }) {
  return (
    <div className="flex flex-col justify-between overflow-hidden rounded-xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div>
        <div className="flex items-center justify-between gap-2 border-b border-slate-300 bg-slate-100 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
          <span className="flex items-center gap-1.5 text-[11px] font-black text-slate-900 dark:text-slate-100">
            📚 {term.displayTitle}
            {term.termType === 'EQUIVALENCE' ? (
              <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">معادل‌سازی</span>
            ) : null}
            {term.termType === 'SUMMER' ? (
              <span className="rounded bg-sky-100 px-1 py-0.5 text-[9px] font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-200">تابستان</span>
            ) : null}
            {term.isCurrent ? (
              <span className="rounded bg-emerald-700 px-1.5 py-0.5 text-[9px] font-bold text-white">جاری</span>
            ) : null}
          </span>
          <span className="font-mono text-[10px] text-slate-600 dark:text-slate-300" dir="ltr">
            {faDigits(term.displayYear)} / {faDigits(term.semester)}
          </span>
        </div>
        <table className="w-full border-collapse text-right text-[11px]">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50 font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100">
              <th className="w-6 border-l border-slate-200 p-1 text-center dark:border-slate-700">#</th>
              <th className="w-16 border-l border-slate-200 p-1 text-center dark:border-slate-700">کد درس</th>
              <th className="border-l border-slate-200 p-1 dark:border-slate-700">نام درس</th>
              <th className="w-12 border-l border-slate-200 p-1 text-center dark:border-slate-700">واحد</th>
              <th className="w-14 border-l border-slate-200 p-1 text-center dark:border-slate-700">نمره</th>
              <th className="w-20 p-1 text-center">نتیجه</th>
            </tr>
          </thead>
          <tbody>
            {term.rows.map((row, idx) => {
              const res = resultLabel(row);
              return (
                <tr key={row.enrollmentId} className="border-b border-slate-200 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                  <td className="border-l border-slate-200 p-1 text-center text-slate-500 dark:border-slate-800">{faDigits(idx + 1)}</td>
                  <td className="border-l border-slate-200 p-1 text-center font-mono text-[10px] dark:border-slate-800" dir="ltr">{row.code}</td>
                  <td className="border-l border-slate-200 p-1 font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100">{row.title}</td>
                  <td className="border-l border-slate-200 p-1 text-center font-bold dark:border-slate-800">{faDigits(row.units)}</td>
                  <td className="border-l border-slate-200 p-1 text-center font-black dark:border-slate-800">
                    {row.grade == null ? (
                      <span className="text-slate-400">—</span>
                    ) : row.isDescriptive ? (
                      <span className="text-[10px] text-emerald-700 dark:text-emerald-300">قبول</span>
                    ) : (
                      faDigits(row.grade.toFixed(2))
                    )}
                  </td>
                  <td className={`p-1 text-center text-[10px] font-bold ${res.className}`}>{res.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-slate-300 bg-slate-100 p-2 text-[10px] font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
        <div className="flex gap-3">
          <span>اخذ: <b className="font-mono">{faDigits(term.units)}</b></span>
          <span>گذرانده: <b className="font-mono text-emerald-700 dark:text-emerald-300">{faDigits(term.passedUnits)}</b></span>
        </div>
        <span>معدل: <b className="font-mono">{term.gpa == null ? '—' : faDigits(term.gpa.toFixed(2))}</b></span>
      </div>
    </div>
  );
}

export function StudentTranscriptPage() {
  const [params, setParams] = useSearchParams();
  const record = params.get('record') ? Number(params.get('record')) : null;
  const [printing, setPrinting] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-transcript', record],
    queryFn: () => getStudentTranscript({ record }),
    staleTime: 30_000,
  });

  function chooseRecord(id: number) {
    const next = new URLSearchParams(params);
    next.set('record', String(id));
    setParams(next, { replace: true });
  }

  function doPrint() {
    setPrinting(true);
    // After one tick, the print class is applied to the document and the window opens.
    window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 60);
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[70vh] w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          دریافت کارنامه ناموفق بود.
        </CardContent>
      </Card>
    );
  }

  const totals = data.totals;
  const gpaText = totals.gpa == null ? '—' : faDigits(totals.gpa.toFixed(2));

  return (
    <div className="space-y-4">
      {data.records.length > 1 ? (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 text-xs shadow-xs">
          <span className="font-bold text-muted-foreground">پروندهٔ تحصیلی (مقطع):</span>
          {data.records.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => chooseRecord(r.id)}
              className={`rounded-lg border px-2.5 py-1 font-bold transition ${
                r.id === data.activeRecordId
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {r.degreeTitle ?? 'مقطع نامشخص'} · <span className="font-mono" dir="ltr">{faDigits(r.studentCode)}</span>
              {r.status === 'GRADUATED' ? ' — فارغ‌التحصیل' : ''}
            </button>
          ))}
        </div>
      ) : null}

      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 px-4 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            <ScrollText className="size-4.5" aria-hidden />
          </span>
          <div>
            <h1 className="text-sm font-bold">کارنامه کل تحصیلی (نسخهٔ رسمی اداری)</h1>
            <p className="text-[11px] text-muted-foreground">ریزنمرات، محاسبهٔ آیین‌نامه‌ای و استعلام برخط اصالت</p>
          </div>
        </div>
        <Button size="sm" onClick={doPrint} disabled={printing}>
          <Printer className="size-4" aria-hidden />
          چاپ کارنامه
        </Button>
      </div>

      <div className="print-area rounded-xl border-2 border-slate-800 bg-white p-5 text-xs text-slate-900 shadow-xl sm:p-8 dark:border-slate-600">
        {/* Header */}
        <div className="mb-4 border-b-2 border-slate-800 pb-4">
          <div className="grid grid-cols-1 items-center gap-3 text-center sm:grid-cols-3">
            <div className="space-y-0.5 text-right">
              <p className="font-bold">جمهوری اسلامی ایران</p>
              <p className="font-semibold">وزارت علوم، تحقیقات و فناوری</p>
              <p className="text-sm font-extrabold">{data.university.title}</p>
              <p className="text-[11px] text-slate-500">معاونت آموزشی و تحصیلات تکمیلی</p>
            </div>
            <div className="flex flex-col items-center justify-center">
              {data.university.logoUrl ? (
                <img src={data.university.logoUrl} alt="آرم دانشگاه" className="mb-1 h-12 w-12 object-contain" />
              ) : (
                <span className="mb-1 flex size-11 items-center justify-center rounded-full border border-slate-300">
                  <BadgeCheck className="size-6 text-slate-400" aria-hidden />
                </span>
              )}
              <h2 className="border-b border-slate-800 px-4 pb-0.5 text-base font-black tracking-wide">
                کارنامه کل تحصیلی دانشجو
              </h2>
              <p className="mt-0.5 text-[10px] text-slate-600">ریزنمرات قطعی دوره‌های آموزشی</p>
            </div>
            <div className="space-y-1 font-mono text-[11px] sm:text-left">
              <p><span className="font-sans text-slate-500">شمارهٔ پرونده: </span><b>{faDigits(data.student.studentCode)}</b></p>
              <p><span className="font-sans text-slate-500">مقطع: </span><b>{data.degreeTitle}</b></p>
              <p><span className="font-sans text-slate-500">وضعیت: </span><b className="font-sans text-emerald-800">{data.statusLabel}</b></p>
            </div>
          </div>
        </div>

        {/* Identity */}
        <div className="mb-5 overflow-hidden border border-slate-800">
          <div className="border-b border-slate-800 bg-slate-100 px-3 py-1 text-[11px] font-bold">
            مشخصات فردی، تحصیلی و آیین‌نامهٔ ملاک عمل
          </div>
          <table className="w-full border-collapse text-right text-[11px]">
            <tbody>
              <tr className="border-b border-slate-300">
                <td className="w-1/6 border-l border-slate-300 bg-slate-50 p-1.5 font-medium text-slate-600">نام و نام خانوادگی:</td>
                <td className="w-2/6 border-l border-slate-300 p-1.5 font-bold">{data.student.name}</td>
                <td className="w-1/6 border-l border-slate-300 bg-slate-50 p-1.5 font-medium text-slate-600">شمارهٔ دانشجویی:</td>
                <td className="w-2/6 p-1.5 font-mono font-bold" dir="ltr">{faDigits(data.student.studentCode)}</td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="border-l border-slate-300 bg-slate-50 p-1.5 font-medium text-slate-600">کد ملی:</td>
                <td className="border-l border-slate-300 p-1.5 font-mono" dir="ltr">{faDigits(data.nationalIdMasked)}</td>
                <td className="border-l border-slate-300 bg-slate-50 p-1.5 font-medium text-slate-600">مقطع تحصیلی:</td>
                <td className="p-1.5 font-semibold">{data.degreeTitle}</td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="border-l border-slate-300 bg-slate-50 p-1.5 font-medium text-slate-600">رشتهٔ تحصیلی:</td>
                <td className="border-l border-slate-300 p-1.5 font-bold">{data.majorName}</td>
                <td className="border-l border-slate-300 bg-slate-50 p-1.5 font-medium text-slate-600">سال ورود / نوع دوره:</td>
                <td className="p-1.5 font-semibold">{faDigits(data.entryYear)} / {data.studyType}</td>
              </tr>
              <tr>
                <td className="border-l border-slate-300 bg-slate-50 p-1.5 font-medium text-slate-600">آیین‌نامهٔ ملاک عمل:</td>
                <td colSpan={3} className="p-1.5 font-semibold">
                  <span className="font-bold text-indigo-950">{data.regulationTitle}</span>
                  <span className="mr-2 text-[10px] text-slate-500">({data.regulationPolicy})</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Term transcripts */}
        {data.academicYears.length === 0 ? (
          <div className="p-8 text-center text-slate-400">هنوز درسی در پروندهٔ کارنامه ثبت نشده است.</div>
        ) : null}

        {data.academicYears.map((year) => (
          <div key={`${year.academicYear}-${year.isEquivalent}`} className="mb-4 space-y-3">
            <div className="rounded-xl border border-indigo-700 bg-gradient-to-l from-indigo-900 via-indigo-800 to-slate-800 px-4 py-2.5 text-sm font-extrabold text-white">
              {year.isEquivalent ? (
                <span>📚 {year.displayYear}</span>
              ) : (
                <span>📅 سال تحصیلی <bdi dir="ltr" className="font-mono">{faDigits(year.displayYear)}</bdi></span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {year.terms.map((term) => (
                <TermCard key={term.termId} term={term} />
              ))}
            </div>
          </div>
        ))}

        {/* Summary */}
        <div className="mt-6 overflow-hidden border-2 border-slate-800">
          <div className="bg-slate-800 px-3 py-1 text-center text-xs font-bold text-white">
            خلاصهٔ وضعیت تحصیلی کل دوره تا تاریخ صدور کارنامه
          </div>
          <table className="w-full border-collapse text-center text-[11px] font-bold">
            <tbody>
              <tr className="border-b border-slate-400 bg-slate-100 text-slate-700">
                <td className="border-l border-slate-300 p-2">کل واحدهای اخذشده</td>
                <td className="border-l border-slate-300 p-2">کل واحدهای گذرانده</td>
                <td className="border-l border-slate-300 p-2">کل واحدهای مردودی</td>
                <td className="border-l border-slate-300 p-2">واحدهای مؤثر در معدل</td>
                <td className="border-l border-slate-300 bg-slate-200 p-2 text-slate-950">معدل کل دوره (GPA)</td>
                <td className="p-2">وضعیت نهایی دانشجو</td>
              </tr>
              <tr className="font-mono text-xs text-slate-950">
                <td className="border-l border-slate-300 p-2">{faNumber(totals.enrolledUnits)} واحد</td>
                <td className="border-l border-slate-300 p-2 text-emerald-800">{faNumber(totals.passedUnits)} واحد</td>
                <td className="border-l border-slate-300 p-2 text-red-700">{faNumber(totals.failedUnits)} واحد</td>
                <td className="border-l border-slate-300 p-2">{faNumber(totals.gradedUnits)} واحد</td>
                <td className="border-l border-slate-300 bg-emerald-50 p-2 text-sm font-black text-emerald-950">{gpaText}</td>
                <td className="p-2 font-sans font-bold text-emerald-800">{data.statusLabel}</td>
              </tr>
            </tbody>
          </table>
          {totals.excludedCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-medium text-emerald-900">
              <span>
                ✨ تعداد <b>{faNumber(totals.excludedCount)} نمرهٔ مردودی</b> پس از قبولی مجدد، طبق آیین‌نامه از
                مخرج و صورت معدل کل کسر گردید.
              </span>
              <span className="font-bold text-emerald-950">آیین‌نامهٔ ملاک عمل</span>
            </div>
          ) : null}
        </div>

        {/* Authenticity QR */}
        {data.qr ? (
          <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-slate-300 bg-slate-50 p-3">
            <div
              className="size-28 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white"
              dangerouslySetInnerHTML={{ __html: data.qr.svg }}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex items-center gap-1.5 text-xs font-black text-slate-900">
                <ScanLine className="size-4" aria-hidden />
                استعلام برخط اصالت این کارنامه
              </p>
              <p className="text-[11px] text-slate-600">
                با اسکن QR یا مراجعه به نشانی زیر، اصالت و خلاصهٔ وضعیت تحصیلی این سند را از سامانه استعلام کنید.
              </p>
              <p className="break-all font-mono text-[10px] text-slate-500" dir="ltr">{data.qr.url}</p>
              <p className="text-[10px] text-slate-500">
                اعتبار پیوند تا: <b dir="ltr">{faDigits(data.qr.expiresAt.slice(0, 10))}</b>
              </p>
            </div>
          </div>
        ) : null}

        {/* Legal text and signature */}
        <div className="mt-6 space-y-4 border-t border-slate-400 pt-3 text-[10px] text-slate-600">
          <p className="leading-relaxed">
            <b>تذکر مهم:</b> این کارنامه صرفاً جهت اطلاع از وضعیت تحصیلی دانشجو صادر گردیده و هرگونه خط‌خوردگی
            یا تغییر در مندرجات آن، سند را از درجهٔ اعتبار ساقط می‌نماید. نمرات دروس توصیفی در مخرج معدل عددی
            لحاظ نمی‌شوند.
          </p>
          <div className="grid grid-cols-3 gap-2 pb-4 pt-6 text-center font-bold text-slate-800">
            <div>
              <p>کارشناس امور آموزشی و بایگانی</p>
              <div className="flex h-12 items-end justify-center text-[9px] text-slate-400">(امضا و تاریخ)</div>
            </div>
            <div>
              <p>محل مهر ادارهٔ کل آموزش دانشگاه</p>
              <div className="mx-auto mt-2 flex size-16 items-center justify-center rounded-full border border-dashed border-slate-400 text-[9px] text-slate-400">
                محل مهر
              </div>
            </div>
            <div>
              <p>مدیر کل امور آموزشی و تحصیلات تکمیلی</p>
              <div className="flex h-12 items-end justify-center text-[9px] text-slate-400">(امضا و تأیید نهایی)</div>
            </div>
          </div>
        </div>
      </div>

      <p className="no-print text-center text-[10px] text-muted-foreground">
        برای چاپ صحیح، در پنجرهٔ چاپ جهت کاغذ را «افقی» و حاشیه را «پیش‌فرض» انتخاب کنید.
      </p>
    </div>
  );
}

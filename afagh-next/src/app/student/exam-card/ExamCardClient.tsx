'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import type { ExamCardData } from '@/lib/verification';
import QrSvg from '@/components/QrSvg';
import { submitCourseEvaluationAction } from './actions';

// ==========================================
// INTERFACES & TYPES
// ==========================================

/** یک ردیف درس — دقیقاً همان ساختاری که `getExamCardData` از پایگاه داده می‌سازد */
export interface StudentCourseEvaluationItem {
  enrollmentId: number;
  courseCode: string;
  courseTitle: string;
  units: number;
  professorName: string | null;
  classRoomName: string | null;
  hasEvaluated: boolean;
  examDate: string;
  examTime: string;
  examHall: string | null;
  seatNumber: number | null;
}

interface Props {
  user: {
    id: number;
    name: string;
    roles: string[];
  };
  /** نشانی عمومی سامانه — از پیکربندی سامانه خوانده می‌شود (بدون مقدار ثابت در کد) */
  publicBaseUrl: string;
  /** توکن امضاشدهٔ کارت ورود به جلسه — سرور از پایگاه داده می‌سازد */
  examTicket: { token: string; expiresAt: string } | null;
  /** علت ممانعت از صدور کارت (مثلاً بدهی مالی) */
  examTicketBlocked: string | null;
  /** دادهٔ واقعی کارت: هویت دانشجو، دروس، سالن/صندلی و بدهی — همه از پایگاه داده */
  card: ExamCardData | null;
  /** SVG کیوآر واقعی و قابل اسکن توکن کارت — سمت سرور با موتور QR تولید می‌شود */
  ticketQr?: string;
  /** حساب دمو: داده‌ها نمایشی است و هیچ ارزشیابی‌ای در پایگاه داده ثبت نمی‌شود */
  demo?: boolean;
  universityLogoUrl?: string | null;
  /** وضعیت پنجرهٔ باز/بستهٔ ارزشیابی (از سرور — دورهٔ فعالِ مدیریت) */
  evaluationWindow?: { open: boolean; message: string; title: string | null };
}

/**
 * پیش‌تر چهار درس ساختگی («ریاضی عمومی ۱ / سالن آمفی‌تئاتر مرکزی / صندلی ۳۰۱»)
 * اینجا هاردکد بود. حالا فهرست دروس، سالن، شمارهٔ صندلی، بدهی و هویت دانشجو
 * همگی از پایگاه داده خوانده و به‌صورت prop تزریق می‌شوند.
 */

// Persian solar date converter helper
function toShamsi(dStr: string | null | undefined): string {
  if (!dStr) return '—';
  if (dStr.startsWith('13') || dStr.startsWith('14') || dStr.startsWith('۱۴') || dStr.startsWith('۱۳')) {
    return dStr;
  }
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    return new Intl.DateTimeFormat('fa-IR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return dStr;
  }
}

export default function ExamCardClient({ user, publicBaseUrl, examTicket, examTicketBlocked, card, ticketQr, demo = false, universityLogoUrl, evaluationWindow }: Props) {
  const [courses, setCourses] = useState<StudentCourseEvaluationItem[]>(card?.courses ?? []);
  /** بدهی واقعی از دفتر کل مالی — نه یک عدد ثابت */
  const [financialDebt, setFinancialDebt] = useState<number>(card?.debt ?? 0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [savingEval, setSavingEval] = useState(false);
  const [, startTransition] = useTransition();

  // Evaluation Modal
  const [evaluatingCourse, setEvaluatingCourse] = useState<StudentCourseEvaluationItem | null>(null);
  const [evalForm, setEvalForm] = useState({
    profMastery: 5,        // تسلط علمی
    profTeachingSkill: 4,  // شیوه تدریس و انتقال مفاهیم
    profDiscipline: 5,     // نظم و انضباط در شروع و پایان کلاس
    profRespect: 5,        // اخلاق و احترام به دانشجو
    roomProjector: 4,      // کیفیت ویدئوپروژکتور و تجهیزات سمعی بصری
    roomAirCondition: 2,   // سیستم سرمایش/گرمایش و تهویه
    roomLighting: 4,       // روشنایی و نور کلاس
    roomCleanliness: 4,    // نظافت و تمیزی صندلی‌ها
    anonymousFeedback: '', // نظر و پیشنهاد محرمانه
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 6000);
  };

  /**
   * ثبت ارزشیابی در پایگاه داده (evaluation_responses + enrollments.hasEvaluated).
   * پیش‌تر این دکمه فقط یک setState بود و هیچ چیزی ذخیره نمی‌شد.
   */
  const handleSubmitEvaluation = () => {
    if (!evaluatingCourse) return;
    const target = evaluatingCourse;
    setSavingEval(true);
    startTransition(async () => {
      const res = await submitCourseEvaluationAction(target.enrollmentId, {
        profMastery: evalForm.profMastery,
        profTeachingSkill: evalForm.profTeachingSkill,
        profDiscipline: evalForm.profDiscipline,
        profRespect: evalForm.profRespect,
        roomProjector: evalForm.roomProjector,
        roomAirCondition: evalForm.roomAirCondition,
        roomLighting: evalForm.roomLighting,
        roomCleanliness: evalForm.roomCleanliness,
        comment: evalForm.anonymousFeedback,
      });
      setSavingEval(false);
      if (!res.ok) {
        showToast(`⚠️ ${res.error ?? 'ثبت ارزشیابی ناموفق بود.'}`);
        return;
      }
      setCourses(prev => prev.map(c => (c.enrollmentId === target.enrollmentId ? { ...c, hasEvaluated: true } : c)));
      setEvaluatingCourse(null);
      showToast(`✓ فرم ارزشیابی درس «${target.courseTitle}» در پایگاه داده ثبت شد (شناسهٔ پاسخ: ${res.responseId}).`);
    });
  };

  // Checkpoints logic
  const isFinancialCleared = financialDebt === 0;
  const pendingEvalsCount = courses.filter(c => !c.hasEvaluated).length;
  const isAllEvaluated = pendingEvalsCount === 0;
  const isCardUnlocked = isFinancialCleared && isAllEvaluated;

  return (
    <div className="space-y-4">
      {/* Top Banner */}
      <div className="card bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 text-white p-5 rounded-2xl shadow-md border border-emerald-700/50 print:hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center text-3xl shadow-inner">
              📇
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-black text-lg sm:text-xl tracking-tight">
                  دریافت کارت ورود به جلسه و گیت ارزشیابی هوشمند
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-400 text-slate-950 shadow-xs">
                  {card?.termTitle ?? '—'}
                </span>
              </div>
              <p className="text-xs text-emerald-200 mt-1">
                صدور کارت ورود به جلسه مشروط به تسویه مالی و تکمیل ارزشیابی اساتید و کیفیت امکانات کلاس‌ها می‌باشد
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span
              className={`px-3 py-1.5 rounded-xl font-extrabold text-xs shadow-xs flex items-center gap-1.5 ${
                isCardUnlocked
                  ? 'bg-emerald-500 text-white animate-pulse'
                  : 'bg-amber-500/90 text-slate-950'
              }`}
            >
              <span>{isCardUnlocked ? '✓ کارت صادر و فعال شد' : '🔒 کارت قفل است'}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Toast Alert */}
      {toastMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-xs font-bold flex items-center justify-between shadow-xs animate-in fade-in print:hidden">
          <div className="flex items-center gap-2">
            <span className="text-lg">📢</span>
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-emerald-700 font-black">✕</button>
        </div>
      )}

      {/* DUAL CHECKPOINT STATUS DASHBOARD */}
      <div className="card space-y-3.5 border-l-4 border-l-emerald-600 print:hidden">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <h2 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
            <span>🛡️ وضعیت گیت‌های کنترل دوگانه صدور کارت (Dual-Checkpoint)</span>
          </h2>
          <span className="text-xs text-slate-500 font-bold">
            {isCardUnlocked ? '۲ از ۲ گیت تایید شد' : 'نیازمند اقدام'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* Checkpoint 1: Financial Clearance */}
          <div
            className={`p-4 rounded-2xl border transition ${
              isFinancialCleared
                ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
                : 'bg-rose-50/70 border-rose-300 text-rose-950'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{isFinancialCleared ? '🟢' : '🔴'}</span>
                <h3 className="font-black text-sm">۱. چک‌پوینت تسویه حساب مالی</h3>
              </div>
              <span
                className={`text-2xs px-2.5 py-0.5 rounded-full font-black ${
                  isFinancialCleared ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'
                }`}
              >
                {isFinancialCleared ? '✓ تایید و تسویه کامل' : 'بدهکار'}
              </span>
            </div>

            <p className="text-xs text-slate-600 mb-3">
              {isFinancialCleared
                ? 'تراز مالی شما در دفتر کل صفر است و مجوز شرکت در امتحانات از نظر مالی صادر شده است.'
                : `بدهی ثبت‌شده در دفتر کل مالی: ${financialDebt.toLocaleString('fa-IR')} ریال`}
            </p>

            {!isFinancialCleared && (
              <div className="rounded-xl border border-rose-300 bg-rose-50 p-2.5 text-2xs font-bold leading-5 text-rose-900">
                پرداخت از طریق امور مالی دانشگاه انجام و در دفتر کل ثبت می‌شود؛ پس از ثبت تراکنش، این گیت به‌صورت
                خودکار سبز می‌شود. برای پیگیری، درخواست «تسویهٔ مالی» ثبت کنید.
                <Link prefetch={false} href="/student/requests" className="mt-1 block text-rose-700 underline">ثبت درخواست تسویه ←</Link>
              </div>
            )}
          </div>

          {/* Checkpoint 2: Evaluation Clearance */}
          <div
            className={`p-4 rounded-2xl border transition ${
              isAllEvaluated
                ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
                : 'bg-amber-50/70 border-amber-300 text-amber-950'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{isAllEvaluated ? '🟢' : '🟡'}</span>
                <h3 className="font-black text-sm">۲. چک‌پوینت ارزشیابی هوشمند اساتید</h3>
              </div>
              <span
                className={`text-2xs px-2.5 py-0.5 rounded-full font-black ${
                  isAllEvaluated ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-200 text-amber-900'
                }`}
              >
                {isAllEvaluated ? '✓ کلیه دروس تکمیل شد' : `${pendingEvalsCount} درس باقیمانده`}
              </span>
            </div>

            <p className="text-xs text-slate-600 mb-2">
              {isAllEvaluated
                ? 'کلیه اساتید و امکانات فیزیکی کلاس‌ها با موفقیت و به صورت ناشناس ارزشیابی شدند.'
                : 'برای تضمین کیفیت آموزش و مشاهده کارت ورود به جلسه، تکمیل فرم‌های ارزشیابی الزامی است.'}
            </p>

            {evaluationWindow && (
              <p className={`mb-2 rounded-xl border px-3 py-2 text-2xs font-bold ${
                evaluationWindow.open
                  ? 'border-emerald-300 bg-emerald-100/60 text-emerald-900'
                  : 'border-rose-300 bg-rose-50 text-rose-800'
              }`}>
                {evaluationWindow.open ? '🟢' : '🔒'} {evaluationWindow.message}
              </p>
            )}

            <div className="text-2xs font-bold text-slate-500">
              ارزشیابی پیش از آزمون انجام می‌شود و استاد تا پس از نهایی شدن نمرات هیچ دسترسی‌ای به نظرات ندارد.
            </div>
          </div>
        </div>
      </div>

      {/* COURSE EVALUATION LIST */}
      <div className="card space-y-3 print:hidden">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div>
            <h3 className="font-black text-slate-900 text-sm">
              لیست دروس انتخابی ترم و وضعیت ارزشیابی ({courses.length} عنوان درس)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              روی دکمه «شروع ارزشیابی» هر درس کلیک کنید تا کیفیت تدریس استاد و امکانات کلاس را ثبت نمایید
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          {courses.map(course => (
            <div
              key={course.enrollmentId}
              className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                course.hasEvaluated
                  ? 'bg-emerald-50/40 border-emerald-200'
                  : 'bg-amber-50/40 border-amber-200 shadow-xs'
              }`}
            >
              <div className="space-y-1 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-black text-slate-900 text-sm">
                    {course.courseTitle}
                  </span>
                  <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    کد: {course.courseCode}
                  </span>
                  <span className="text-xs font-bold text-indigo-900 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
                    استاد: {course.professorName ?? '—'}
                  </span>
                  <span className="text-xs font-medium text-slate-600">
                    🏛️ محل تشکیل: {course.classRoomName ?? '—'}
                  </span>
                </div>

                <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5">
                  <span>📅 تاریخ امتحان: <strong className="font-mono text-slate-900">{toShamsi(course.examDate)}</strong></span>
                  <span>⏰ ساعت: <strong className="font-mono text-slate-900">{course.examTime}</strong></span>
                  <span>🏛️ سالن آزمون: <strong className="text-slate-900">{course.examHall ?? 'تخصیص نیافته'}</strong></span>
                  <span>🪑 شماره صندلی: <strong className="text-indigo-900 font-mono font-black">{course.seatNumber != null ? `صندلی ${course.seatNumber}` : 'تخصیص نیافته'}</strong></span>
                </div>
              </div>

              <div className="self-end sm:self-auto">
                {course.hasEvaluated ? (
                  <span className="px-3.5 py-1.5 rounded-xl bg-emerald-100 text-emerald-900 font-black text-xs flex items-center gap-1 border border-emerald-300">
                    <span>✓ ارزشیابی شد</span>
                  </span>
                ) : demo ? (
                  <span className="px-3.5 py-1.5 rounded-xl bg-slate-100 text-slate-600 font-black text-xs border border-slate-300">
                    ارزشیابی در حساب دمو ثبت نمی‌شود
                  </span>
                ) : !(evaluationWindow?.open ?? false) ? (
                  /* پنجرهٔ ارزشیابی تعیین نشده/بسته است → دکمهٔ همان درس قفل می‌شود.
                     پیش‌تر فقط یک نوار وضعیت بالای صفحه بود و دکمه فعال می‌ماند؛
                     دانشجو فرم را پر می‌کرد و آخر کار خطای سرور می‌گرفت. */
                  <button
                    type="button"
                    disabled
                    title={evaluationWindow?.message ?? 'زمان ارزشیابی برای این ترم تعیین نشده است — تا تعیین مهلت، دکمهٔ ارزشیابی قفل است.'}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-100 text-slate-500 font-black text-xs border border-slate-300 cursor-not-allowed flex items-center gap-1.5"
                  >
                    <span>🔒 ارزشیابی قفل است</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setEvaluatingCourse(course);
                      setEvalForm({
                        profMastery: 5,
                        profTeachingSkill: 4,
                        profDiscipline: 5,
                        profRespect: 5,
                        roomProjector: 4,
                        roomAirCondition: 3,
                        roomLighting: 4,
                        roomCleanliness: 4,
                        anonymousFeedback: '',
                      });
                    }}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 text-slate-950 font-black text-xs shadow-xs transition flex items-center gap-1.5"
                  >
                    <span>📝 شروع ارزشیابی استاد و کلاس</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* UNLOCKED OFFICIAL EXAM CARD */}
      {isCardUnlocked ? (
        <div
          id="exam-card-print-area"
          className="card space-y-4 border-2 border-emerald-600 shadow-xl bg-white p-6 rounded-3xl animate-in fade-in zoom-in-95 print:border-2 print:border-black print:rounded-none print:shadow-none print:p-4 print:m-0"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b-2 border-slate-800 pb-3">
            <div className="flex items-center gap-3">
              {universityLogoUrl ? (
                <img src={universityLogoUrl} alt="" width={48} height={48} className="w-12 h-12 object-contain" />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-2xl shadow-md">
                  آ
                </div>
              )}
              <div>
                <h2 className="font-black text-slate-900 text-base sm:text-lg">
                  کارت رسمی ورود به جلسه آزمون‌های پایان‌ترم دانشگاه آفاق
                </h2>
                <p className="text-xs text-slate-600 font-bold">
                  {card?.termTitle ?? '—'} · ورودی {card?.entryYear ? String(card.entryYear).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]) : '—'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 print:hidden">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs shadow flex items-center gap-1.5 transition active:scale-95"
              >
                <span>🖨️ چاپ و ذخیره کارت (PDF)</span>
              </button>
            </div>
          </div>

          {/* Student Profile Info Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-300 text-xs">
            <div>
              <span className="text-slate-500 block text-2xs">نام و نام خانوادگی:</span>
              <strong className="text-slate-900 text-sm font-black">{card?.fullName ?? user.name}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-2xs">شماره دانشجویی:</span>
              <strong className="font-mono text-slate-900 text-sm font-black" dir="ltr">{card?.studentCode ?? '—'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-2xs">کد ملی داوطلب (ماسک‌شده):</span>
              <strong className="font-mono text-slate-900 text-sm font-black" dir="ltr">{card?.nationalIdMasked ?? '—'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-2xs">رشته تحصیلی:</span>
              <strong className="text-slate-900 text-sm font-black">{card?.majorName ?? '—'}</strong>
            </div>
          </div>

          {/* Exams Timetable on the Card */}
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs border-collapse border border-slate-400 rt">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="p-2 border border-slate-700 text-center w-10">ردیف</th>
                  <th className="p-2 border border-slate-700 text-center w-20">کد درس</th>
                  <th className="p-2 border border-slate-700">عنوان درس</th>
                  <th className="p-2 border border-slate-700">استاد مدرس</th>
                  <th className="p-2 border border-slate-700 text-center w-28">تاریخ امتحان</th>
                  <th className="p-2 border border-slate-700 text-center w-32">ساعت و سانس</th>
                  <th className="p-2 border border-slate-700">حوزه و سالن آزمون</th>
                  <th className="p-2 border border-slate-700 text-center font-black w-28">شماره صندلی داوطلب</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((c, idx) => (
                  <tr key={c.enrollmentId} className="border-b border-slate-300 hover:bg-slate-50 transition">
                    <td className="p-2 border border-slate-300 text-center font-bold">{idx + 1}</td>
                    <td className="p-2 border border-slate-300 font-mono font-bold text-slate-700 text-center" dir="ltr">{c.courseCode}</td>
                    <td className="p-2 border border-slate-300 font-black text-slate-900">{c.courseTitle} ({c.units} واحد)</td>
                    <td className="p-2 border border-slate-300 text-slate-800 font-bold">{c.professorName ?? '—'}</td>
                    <td className="p-2 border border-slate-300 text-center font-mono font-black text-slate-900 bg-slate-100/60">{toShamsi(c.examDate)}</td>
                    <td className="p-2 border border-slate-300 text-center font-mono text-slate-700">{c.examTime}</td>
                    <td className="p-2 border border-slate-300 font-bold text-slate-900">🏛️ {c.examHall ?? 'تخصیص نیافته'}</td>
                    <td className="p-2 border border-slate-300 text-center bg-indigo-50/80">
                      <span className="px-2.5 py-0.5 rounded-lg bg-indigo-950 text-white font-mono font-black text-xs">
                        {c.seatNumber != null ? `صندلی ${c.seatNumber}` : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* QR Code & Security Barcode Verification Block */}
          <div className="p-3.5 bg-slate-900 text-white rounded-xl flex items-center justify-between gap-4 text-xs">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-base">🔐</span>
                <h4 className="font-black text-emerald-400">کد امنیتی و بارکد اختصاصی آزمون:</h4>
              </div>
              <p className="text-slate-300 font-mono text-3xs break-all" dir="ltr">
                {examTicket ? examTicket.token : 'AFAGH-EXAM-NOT-ISSUED'}
              </p>
              <p className="text-3xs text-slate-400">
                این بارکد توسط مراقب سالن با اسکنر QR-Code در ورودی جلسه جهت ثبت حضور و احراز هویت اسکن خواهد شد.
              </p>
            </div>

            <div className="p-2 bg-white rounded-xl text-slate-950 text-center shadow flex flex-col items-center justify-center">
              {examTicket ? (
                ticketQr ? (
                  <QrSvg
                    svg={ticketQr}
                    className="[&>svg]:rounded-lg [&>svg]:bg-white [&>svg]:w-28 [&>svg]:h-28 print:[&>svg]:w-32 print:[&>svg]:h-32"
                  />
                ) : (
                  <span className="text-3xs text-slate-400">QR در دسترس نیست</span>
                )
              ) : (
                <div className="flex h-[75px] w-[75px] flex-col items-center justify-center rounded-lg border border-amber-500/60 bg-amber-950/40 text-center text-[8px] font-bold leading-3 text-amber-200">
                  کارت صادر<br />نشده
                </div>
              )}
              <span className="text-[9px] font-mono font-bold text-slate-700 block mt-0.5">{card?.studentCode ?? '—'}</span>
            </div>
          </div>

          <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-300 text-3xs text-amber-950 font-bold leading-relaxed">
            ⚠️ <strong>نکات مهم امتحانات:</strong> همراه داشتن پرینت این کارت و کارت شناسایی معتبر الزامی است. همراه داشتن تلفن همراه، ساعت هوشمند و یادداشت تقلب تخلف محسوب شده و صورت‌جلسه انضباطی تنظیم خواهد شد.
          </div>
        </div>
      ) : (
        <div className="p-8 text-center bg-slate-50 rounded-3xl border-2 border-dashed border-slate-300 text-slate-500 space-y-3 print:hidden">
          <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-3xl mx-auto">
            🔒
          </div>
          <h3 className="font-black text-slate-900 text-base">
            کارت ورود به جلسه قفل است
          </h3>
          <p className="text-xs text-slate-600 max-w-md mx-auto">
            برای صدور و مشاهده کارت ورود به جلسه و دریافت شماره صندلی‌ها، ابتدا باید بدهی شهریه متغیر تسویه شده و تمام فرم‌های ارزشیابی اساتید تکمیل گردند.
          </p>
        </div>
      )}

      {/* Print Specific CSS */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm;
          }
          body, html {
            background: #ffffff !important;
            color: #000000 !important;
            font-size: 11px !important;
          }
          header, footer, nav, .print\\:hidden, [role="navigation"] {
            display: none !important;
          }
          #exam-card-print-area {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            box-shadow: none !important;
            border: 2px solid #000 !important;
            border-radius: 8px !important;
            padding: 12px !important;
            background: #fff !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>

      {/* ========================================================================= */}
      {/* MODAL: SMART COURSE & FACULTY EVALUATION FORM */}
      {/* ========================================================================= */}
      {evaluatingCourse && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-4 bg-indigo-950 text-white flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-sm sm:text-base">
                  📝 فرم ارزشیابی هوشمند کیفیت تدریس و امکانات کلاس
                </h3>
                <span className="text-xs text-indigo-300">
                  درس: {evaluatingCourse.courseTitle} · استاد: {evaluatingCourse.professorName} ({evaluatingCourse.classRoomName})
                </span>
              </div>
              <button onClick={() => setEvaluatingCourse(null)} className="text-white/60 hover:text-white">✕</button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-950 text-xs font-bold flex items-center gap-2">
                <span className="text-base">🛡️</span>
                <span>پاسخ‌های شما کاملاً محرمانه، رمزنگاری‌شده و بدون نام ذخیره می‌شود.</span>
              </div>

              {/* Section 1: Professor Teaching Quality */}
              <div className="space-y-3">
                <h4 className="font-black text-slate-900 text-xs sm:text-sm border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
                  <span>👨‍🏫 ۱. ارزیابی کیفیت تدریس و عملکرد آموزشی استاد:</span>
                </h4>

                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl">
                    <span className="font-bold text-slate-800">تسلط علمی و احاطه استاد بر سرفصل‌های درس:</span>
                    <select
                      value={evalForm.profMastery}
                      onChange={e => setEvalForm({ ...evalForm, profMastery: Number(e.target.value) })}
                      className="border border-slate-300 rounded-lg p-1.5 font-bold text-xs bg-white text-indigo-950"
                    >
                      <option value={5}>⭐⭐⭐⭐⭐ عالی (۵)</option>
                      <option value={4}>⭐⭐⭐⭐ خوب (۴)</option>
                      <option value={3}>⭐⭐⭐ متوسط (۳)</option>
                      <option value={2}>⭐⭐ ضعیف (۲)</option>
                      <option value={1}>⭐ بسیار ضعیف (۱)</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl">
                    <span className="font-bold text-slate-800">شیوه تدریس، فن بیان و ایجاد انگیزه و مشارکت:</span>
                    <select
                      value={evalForm.profTeachingSkill}
                      onChange={e => setEvalForm({ ...evalForm, profTeachingSkill: Number(e.target.value) })}
                      className="border border-slate-300 rounded-lg p-1.5 font-bold text-xs bg-white text-indigo-950"
                    >
                      <option value={5}>⭐⭐⭐⭐⭐ عالی (۵)</option>
                      <option value={4}>⭐⭐⭐⭐ خوب (۴)</option>
                      <option value={3}>⭐⭐⭐ متوسط (۳)</option>
                      <option value={2}>⭐⭐ ضعیف (۲)</option>
                      <option value={1}>⭐ بسیار ضعیف (۱)</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl">
                    <span className="font-bold text-slate-800">نظم در تشکیل به موقع کلاس‌ها و حضور مستمر:</span>
                    <select
                      value={evalForm.profDiscipline}
                      onChange={e => setEvalForm({ ...evalForm, profDiscipline: Number(e.target.value) })}
                      className="border border-slate-300 rounded-lg p-1.5 font-bold text-xs bg-white text-indigo-950"
                    >
                      <option value={5}>⭐⭐⭐⭐⭐ عالی (۵)</option>
                      <option value={4}>⭐⭐⭐⭐ خوب (۴)</option>
                      <option value={3}>⭐⭐⭐ متوسط (۳)</option>
                      <option value={2}>⭐⭐ ضعیف (۲)</option>
                      <option value={1}>⭐ بسیار ضعیف (۱)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 2: Physical Facilities Analysis */}
              <div className="space-y-3 pt-2">
                <h4 className="font-black text-slate-900 text-xs sm:text-sm border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
                  <span>🏛️ ۲. ارزیابی کیفیت امکانات و تجهیزات فیزیکی کلاس ({evaluatingCourse.classRoomName}):</span>
                </h4>

                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl">
                    <span className="font-bold text-slate-800">کیفیت ویدئوپروژکتور، وایت‌برد و تجهیزات سمعی بصری:</span>
                    <select
                      value={evalForm.roomProjector}
                      onChange={e => setEvalForm({ ...evalForm, roomProjector: Number(e.target.value) })}
                      className="border border-slate-300 rounded-lg p-1.5 font-bold text-xs bg-white text-indigo-950"
                    >
                      <option value={5}>⭐⭐⭐⭐⭐ عالی و بدون نقص (۵)</option>
                      <option value={4}>⭐⭐⭐⭐ خوب (۴)</option>
                      <option value={3}>⭐⭐⭐ متوسط (۳)</option>
                      <option value={2}>⭐⭐ ضعیف و نیازمند تعمیر (۲)</option>
                      <option value={1}>⭐ خراب / غیرقابل استفاده (۱)</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl">
                    <span className="font-bold text-slate-800">سیستم تهویه، سرمایش/گرمایش و دمای کلاس:</span>
                    <select
                      value={evalForm.roomAirCondition}
                      onChange={e => setEvalForm({ ...evalForm, roomAirCondition: Number(e.target.value) })}
                      className="border border-slate-300 rounded-lg p-1.5 font-bold text-xs bg-white text-indigo-950"
                    >
                      <option value={5}>⭐⭐⭐⭐⭐ کاملاً مطلوب (۵)</option>
                      <option value={4}>⭐⭐⭐⭐ خوب (۴)</option>
                      <option value={3}>⭐⭐⭐ متوسط (۳)</option>
                      <option value={2}>⭐⭐ نامطلوب / نیازمند سرویس (۲)</option>
                      <option value={1}>⭐ بسیار نامساعد (۱)</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl">
                    <span className="font-bold text-slate-800">نور، روشنایی و نظافت عمومی کلاس:</span>
                    <select
                      value={evalForm.roomLighting}
                      onChange={e => setEvalForm({ ...evalForm, roomLighting: Number(e.target.value) })}
                      className="border border-slate-300 rounded-lg p-1.5 font-bold text-xs bg-white text-indigo-950"
                    >
                      <option value={5}>⭐⭐⭐⭐⭐ عالی (۵)</option>
                      <option value={4}>⭐⭐⭐⭐ خوب (۴)</option>
                      <option value={3}>⭐⭐⭐ متوسط (۳)</option>
                      <option value={2}>⭐⭐ ضعیف (۲)</option>
                      <option value={1}>⭐ بسیار ضعیف (۱)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 3: Confidential Feedback */}
              <div className="space-y-1.5 pt-2">
                <label className="font-bold text-slate-800 block">
                  نظرات و پیشنهادات محرمانه شما جهت بهبود کیفیت آموزشی:
                </label>
                <textarea
                  rows={3}
                  value={evalForm.anonymousFeedback}
                  onChange={e => setEvalForm({ ...evalForm, anonymousFeedback: e.target.value })}
                  placeholder="پیشنهادات خود در خصوص نحوه تدریس استاد یا نیازهای فیزیکی کلاس را وارد نمایید..."
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs bg-white font-bold"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setEvaluatingCourse(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 text-slate-700 font-bold text-xs"
              >
                انصراف
              </button>
              <button
                onClick={handleSubmitEvaluation}
                className="px-6 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 text-white font-black text-xs shadow transition"
              >
                ✓ ثبت قطعی ارزشیابی و تایید گیت
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * ExamAggregationTab — تجمیع اوراق امتحانی و بایگانی
 *
 * بخشی از جراحی معماری PayrollEngineClient (گام Component Splitting): این فایل
 * فقط رندر منطق تب خودش است؛ وضعیت از payrollReducer و اکشن‌ها از PayrollApi
 * (در PayrollEngineClient به‌صورت bound به dispatch تعریف می‌شوند) می‌آید.
 */
import { faNum } from '../payrollData';
import type { PayrollState, PayrollApi } from '../payrollReducer';

interface Props {
  state: PayrollState;
  api: PayrollApi;
}

export default function ExamAggregationTab({ state, api }: Props) {
  const { courseExamAggregations } = state;
  const { showToast, setCourseExamAggregations } = api;
  return (
    <>
        <div className="card space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-black text-slate-900 text-base">
                  📦 تجمیع اوراق امتحانات چندسالنه، تحویل با QR و بازگشت به بایگانی (No Sheet, No Pay!)
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-indigo-100 text-indigo-900 border border-indigo-200">
                  الگوی سد تجمیعی (Barrier Synchronization)
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                صبر تا تحویل ۱۰۰٪ برگه‌ها از تمام سالن‌ها قبل از ارسال پیامک به استاد · قفل تسویه مالی ۶۰٪ تا زمان تحویل فیزیکی اوراق به بایگانی
              </p>
            </div>
          </div>

          {/* Workflow Explanation Banner */}
          <div className="p-4 bg-slate-900 text-white rounded-2xl space-y-2 text-xs">
            <h4 className="font-black text-amber-300">
              🔗 زنجیره ۴ مرحله‌ای ممیزی اوراق امتحانی و تسویه حساب مالی اساتید:
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1 text-2xs text-indigo-100">
              <div className="bg-white/10 p-2.5 rounded-xl border border-white/10">
                <b>۱. تجمیع بسته‌ها در مخزن:</b> بررسی تمام سالن‌ها. تا آخرین برگه نرسد، پیامکی برای استاد ارسال نمی‌شود.
              </div>
              <div className="bg-white/10 p-2.5 rounded-xl border border-white/10">
                <b>۲. تحویل به استاد با QR:</b> استاد بارکد روی گوشی را به مسئول مخزن نشان می‌دهد و مهلت ۱۰ روزه نمره فعال می‌شود.
              </div>
              <div className="bg-white/10 p-2.5 rounded-xl border border-white/10">
                <b>۳. ثبت قطعی نمرات:</b> ورود نمرات در سامانه با تایید دو مرحله‌ای OTP.
              </div>
              <div className="bg-white/10 p-2.5 rounded-xl border border-white/10">
                <b>۴. بازگشت به بایگانی:</b> تحویل اوراق فیزیکی به کارشناس بایگانی و آزادسازی تسویه نهایی ۶۰٪ حق‌التدریس.
              </div>
            </div>
          </div>

          {/* Aggregations Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-right text-xs border-collapse rt">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="p-3">کد درس</th>
                  <th className="p-3">عنوان درس امتحانی</th>
                  <th className="p-3">استاد مدرس</th>
                  <th className="p-3 text-center">وضعیت سالن‌ها</th>
                  <th className="p-3 text-center">تعداد کل اوراق</th>
                  <th className="p-3 text-center">پیامک تجمیعی به استاد</th>
                  <th className="p-3 text-center">تحویل به استاد (QR)</th>
                  <th className="p-3 text-center">بازگشت به بایگانی</th>
                  <th className="p-3 text-left">عملیات بایگانی</th>
                </tr>
              </thead>
              <tbody>
                {courseExamAggregations.map(agg => (
                  <tr key={agg.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td className="p-3 font-mono font-bold text-slate-700" dir="ltr">
                      {agg.courseCode}
                    </td>
                    <td className="p-3 font-black text-slate-900">{agg.courseTitle}</td>
                    <td className="p-3 font-bold text-indigo-950">{agg.professorName}</td>

                    {/* Multi-hall Barrier Status */}
                    <td className="p-3 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-xl text-3xs font-black ${
                          agg.isFullyCollected
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-900 animate-pulse'
                        }`}
                      >
                        {faNum(agg.receivedHallsCount)} از {faNum(agg.totalHallsCount)} سالن تحویل شد
                      </span>
                    </td>

                    <td className="p-3 text-center font-mono font-black text-slate-800">
                      {faNum(agg.totalDeliveredSheets)} از {faNum(agg.totalExpectedSheets)} برگه
                    </td>

                    {/* SMS Status */}
                    <td className="p-3 text-center">
                      {agg.notificationSent ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-3xs">
                          ✓ پیامک ارسال شد
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-3xs">
                          قفل (منتظر سایر سالن‌ها)
                        </span>
                      )}
                    </td>

                    {/* Professor Pickup QR Status */}
                    <td className="p-3 text-center">
                      {agg.pickupQrStatus === 'PICKED_UP_BY_PROF' ? (
                        <div>
                          <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-950 font-bold text-3xs">
                            ✓ تحویل به استاد با QR
                          </span>
                          <span className="text-[9px] text-slate-500 block font-mono mt-0.5">
                            مهلت نمره: {agg.gradeDeadline}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-3xs">در انتظار تجمیع</span>
                      )}
                    </td>

                    {/* Physical Archive Return Gate */}
                    <td className="p-3 text-center">
                      {agg.papersReturnedToArchive ? (
                        <span className="px-2.5 py-1 rounded-xl bg-emerald-600 text-white font-black text-3xs shadow-xs">
                          ✓ تحویل بایگانی شد (تسویه مالی آزاد)
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-xl bg-rose-100 text-rose-800 font-black text-3xs">
                          ⛔ دست استاد (تسویه مالی قفل)
                        </span>
                      )}
                    </td>

                    <td className="p-3 text-left">
                      {!agg.papersReturnedToArchive && agg.pickupQrStatus === 'PICKED_UP_BY_PROF' && (
                        <button
                          onClick={() => {
                            setCourseExamAggregations(prev =>
                              prev.map(a =>
                                a.id === agg.id
                                  ? {
                                      ...a,
                                      papersReturnedToArchive: true,
                                      archiveReturnDate: '۱۴۰۵/۱۰/۲۹',
                                    }
                                  : a
                              )
                            );
                            showToast(
                              `✓ اوراق تصحیح‌شده درس «${agg.courseTitle}» با موفقیت در بایگانی تحویل گرفته شد و قفل تسویه مالی ۶۰٪ آزاد گردید.`
                            );
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black text-3xs shadow-xs"
                        >
                          تایید دریافت اوراق در بایگانی 📥
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
    </>
  );
}

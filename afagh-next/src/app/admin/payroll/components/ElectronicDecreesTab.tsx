'use client';

/**
 * ElectronicDecreesTab — ابلاغیه‌های تدریس
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

export default function ElectronicDecreesTab({ state, api }: Props) {
  const { appointmentDecrees } = state;
  const { handleBatchGenerateDecrees, handleSendDecreeReminder, setSelectedDecreeForView } = api;
  return (
    <>
        <div className="card space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-black text-slate-900 text-base">
                  📜 مدیریت و صدور ابلاغیه‌های رسمی تدریس (Teaching Appointment Decrees)
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-indigo-100 text-indigo-900 border border-indigo-200">
                  سامانه ۱۰۰٪ بدون کاغذ (Paperless)
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                صدور ابلاغیه‌های تدریس ترم با امضای الکترونیک، احراز هویت دو مرحله‌ای پیامکی (2FA/OTP) و قفل گلوگاه‌های آموزشی
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleBatchGenerateDecrees}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-800 to-indigo-950 hover:from-indigo-900 text-white font-extrabold text-xs shadow flex items-center gap-1.5 transition active:scale-95"
              >
                <span>🚀 صدور دسته‌جمعی ابلاغیه‌های ترم</span>
              </button>
            </div>
          </div>

          {/* Decrees Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-right text-xs border-collapse rt">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="p-2.5">شماره حکم ابلاغیه</th>
                  <th className="p-2.5">نام استاد</th>
                  <th className="p-2.5">مرتبه و دانشکده</th>
                  <th className="p-2.5">دروس مصوب تخصیص‌یافته</th>
                  <th className="p-2.5 text-center">مجموع ساعات ترم</th>
                  <th className="p-2.5 text-center">وضعیت امضای الکترونیک</th>
                  <th className="p-2.5 text-center">شناسه امنیتی (Hash)</th>
                  <th className="p-2.5 text-left">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {appointmentDecrees.map(decree => (
                  <tr key={decree.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-2.5 font-mono font-bold text-slate-700" dir="ltr">
                      {decree.decreeNo}
                    </td>
                    <td className="p-2.5 font-black text-slate-900">{decree.profName}</td>
                    <td className="p-2.5 text-slate-700">
                      <div>{decree.academicRank}</div>
                      <div className="text-3xs text-slate-500">{decree.departmentName}</div>
                    </td>
                    <td className="p-2.5 font-bold text-indigo-950">
                      {decree.coursesList.map(c => `${c.title} (${c.units} واحد)`).join('، ')}
                    </td>
                    <td className="p-2.5 text-center font-mono font-bold text-slate-800">
                      {decree.totalTermHours} ساعت ({decree.totalWeeklyHours} ساعت/هفته)
                    </td>
                    <td className="p-2.5 text-center">
                      {decree.signatureStatus === 'SIGNED' ? (
                        <div>
                          <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-emerald-600 text-white shadow-xs">
                            ✓ امضا شده با OTP
                          </span>
                          <div className="text-[9px] text-slate-500 font-mono mt-0.5">{decree.signedAt}</div>
                        </div>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-amber-500 text-slate-950">
                          در انتظار امضای استاد
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 text-center font-mono text-3xs text-slate-500" dir="ltr">
                      {decree.documentHash ? `${decree.documentHash.slice(0, 16)}...` : '—'}
                    </td>
                    <td className="p-2.5 text-left">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setSelectedDecreeForView(decree)}
                          className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 font-black text-2xs transition"
                        >
                          📜 مشاهده ابلاغیه
                        </button>
                        {decree.signatureStatus === 'PENDING' && (
                          <button
                            onClick={() => handleSendDecreeReminder(decree.profName)}
                            className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-300 font-black text-3xs transition"
                          >
                            📲 پیامک یادآوری
                          </button>
                        )}
                      </div>
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

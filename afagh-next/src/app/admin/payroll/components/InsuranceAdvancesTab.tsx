'use client';

/**
 * InsuranceAdvancesTab — بیمه و مساعده
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

export default function InsuranceAdvancesTab({ state, api }: Props) {
  const { globalTaminSyncEnabled, profFinancialSettings } = state;
  const { showToast, setGlobalTaminSyncEnabled, setProfFinancialSettings } = api;
  return (
    <>
        <div className="card space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-black text-slate-900 text-base">
                  🏥 مدیریت هوشمند بیمه روزانه تامین اجتماعی، مالیات تکلیفی و مساعده‌های میان‌ترم
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-emerald-100 text-emerald-900 border border-emerald-200">
                  قانون یک روز بیمه به ازای هر روز حضور
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                محاسبه خودکار ۱ روز بیمه در تاریخ‌های تدریس بدون احتساب تکراری در روزهای چندکلاسه · فعال‌سازی گزینشی مساعده فقط برای اساتید متقاضی
              </p>
            </div>

            {/* Global Master Switch */}
            <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-2xl border border-slate-200">
              <span className="text-xs font-black text-slate-800">کلید اصلی اتصال به تامین اجتماعی:</span>
              <button
                onClick={() => {
                  setGlobalTaminSyncEnabled(!globalTaminSyncEnabled);
                  showToast(
                    `ارسال خودکار به سامانه تامین اجتماعی ${
                      !globalTaminSyncEnabled ? 'فعال (ON)' : 'غیرفعال (OFF)'
                    } شد.`
                  );
                }}
                className={`px-3 py-1 rounded-xl text-xs font-black transition ${
                  globalTaminSyncEnabled
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-300 text-slate-700'
                }`}
              >
                {globalTaminSyncEnabled ? 'روشن (ON) ✓' : 'خاموش (OFF)'}
              </button>
            </div>
          </div>

          {/* Logic Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-200 space-y-1">
              <span className="text-indigo-900 font-bold block">قانون بیمه روزانه تامین اجتماعی:</span>
              <p className="text-indigo-950 font-bold leading-5">
                اگر استادی در یک روز ۳ کلاس (صبح، ظهر، عصر) داشته باشد، دقیقاً <b>۱ روز بیمه</b> رد می‌شود تا روزهای کارکرد ماهانه از سقف تجاوز نکند.
              </p>
            </div>

            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 space-y-1 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <span className="text-amber-900 font-bold block">سیاست پرداخت مساعده (Advance):</span>
              <p className="text-amber-950 font-bold leading-5">
                منوی درخواست علی‌الحساب برای عموم اساتید <b>پنهان</b> است تا بار مالی زودرس ایجاد نشود؛ مدیر مالی می‌تواند به صورت موردی آن را برای استاد فعال کند.
              </p>
            </div>

            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-1 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              <span className="text-emerald-900 font-bold block">کسر خودکار در تسویه نهایی:</span>
              <p className="text-emerald-950 font-bold leading-5">
                مبالغ مساعده پرداخت‌شده در میان‌ترم، به طور اتوماتیک از فیش تسویه حساب پایان ترم کسر می‌شوند (جلوگیری از پرداخت مضاعف).
              </p>
            </div>
          </div>

          {/* Table of Professors Settings */}
          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-right text-xs border-collapse rt">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="p-3">کد</th>
                  <th className="p-3">نام عضو هیئت علمی / مدرس</th>
                  <th className="p-3 text-center">روزهای تدریس ماه جاری</th>
                  <th className="p-3 text-center">بیمه تامین اجتماعی</th>
                  <th className="p-3 text-center">مالیات تکلیفی ۱۰٪</th>
                  <th className="p-3 text-center">دسترسی به درخواست مساعده</th>
                  <th className="p-3 text-center">مبلغ علی‌الحساب</th>
                  <th className="p-3 text-left">عملیات مالی</th>
                </tr>
              </thead>
              <tbody>
                {profFinancialSettings.map(prof => (
                  <tr key={prof.staffId} className="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td className="p-3 font-mono font-bold text-slate-600" dir="ltr">
                      {prof.staffCode}
                    </td>
                    <td className="p-3 font-black text-slate-900">{prof.name}</td>
                    <td className="p-3 text-center font-mono font-black text-indigo-950">
                      {faNum(prof.daysTaughtCount)} روز کارکرد
                    </td>

                    {/* Insurance Toggle */}
                    <td className="p-3 text-center">
                      <button
                        onClick={() => {
                          setProfFinancialSettings(prev =>
                            prev.map(p =>
                              p.staffId === prof.staffId ? { ...p, isInsuranceEnabled: !p.isInsuranceEnabled } : p
                            )
                          );
                          showToast(`وضعیت بیمه تامین اجتماعی برای ${prof.name} تغییر یافت.`);
                        }}
                        className={`px-2.5 py-1 rounded-xl text-3xs font-black transition ${
                          prof.isInsuranceEnabled
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {prof.isInsuranceEnabled ? '✓ مشمول بیمه روزانه' : 'معاف / خویش‌فرما'}
                      </button>
                    </td>

                    {/* Tax Status */}
                    <td className="p-3 text-center">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-3xs">
                        {prof.isTaxExempt ? 'معاف از مالیات' : '۱۰٪ کسر استاندارد'}
                      </span>
                    </td>

                    {/* Advance Request Access Toggle */}
                    <td className="p-3 text-center">
                      <button
                        onClick={() => {
                          const newState = !prof.canRequestAdvance;
                          setProfFinancialSettings(prev =>
                            prev.map(p =>
                              p.staffId === prof.staffId ? { ...p, canRequestAdvance: newState } : p
                            )
                          );
                          showToast(
                            `دسترسی به دکمه مساعده برای «${prof.name}» در پنل استادی ${
                              newState ? '🟢 فعال (قابل رویت)' : '🔴 پنهان (غیرفعال)'
                            } شد.`
                          );
                        }}
                        className={`px-2.5 py-1 rounded-xl text-3xs font-black transition shadow-xs ${
                          prof.canRequestAdvance
                            ? 'bg-amber-400 text-slate-950 border border-amber-500'
                            : 'bg-slate-100 text-slate-400 border border-slate-200'
                        }`}
                      >
                        {prof.canRequestAdvance ? '🔓 منو در پنل فعال است' : '🔒 پنهان از دید استاد'}
                      </button>
                    </td>

                    {/* Advance Amount Status */}
                    <td className="p-3 text-center font-mono">
                      {prof.advanceAmountRequested > 0 ? (
                        <div>
                          <span className="font-bold text-amber-700">
                            {faNum(prof.advanceAmountApproved.toLocaleString('fa-IR'))} ريال
                          </span>
                          <span className="block text-[9px] text-slate-500 font-sans">
                            {prof.advanceStatus === 'PAID' ? 'پرداخت شده (آماده کسر در تسویه)' : 'تایید شده'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-3xs">بدون مساعده</span>
                      )}
                    </td>

                    <td className="p-3 text-left">
                      {prof.advanceStatus === 'APPROVED' && (
                        <button
                          onClick={() => {
                            setProfFinancialSettings(prev =>
                              prev.map(p =>
                                p.staffId === prof.staffId ? { ...p, advanceStatus: 'PAID' } : p
                              )
                            );
                            showToast(`دستور پرداخت مساعده برای ${prof.name} صادر شد و سند حسابداری ثبت گردید.`);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black text-3xs shadow-xs"
                        >
                          پرداخت علی‌الحساب 💳
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

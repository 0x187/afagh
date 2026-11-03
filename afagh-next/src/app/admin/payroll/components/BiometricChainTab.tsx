'use client';

/**
 * BiometricChainTab — پایش تردد بیومتریک و پیوستگی کلاس‌ها
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

export default function BiometricChainTab({ state, api }: Props) {
  const { biometricLogs } = state;
  const { showToast } = api;
  return (
    <>
        <div className="card space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-black text-slate-900 text-base">
                  🧬 موتور تطبیق هوشمند اثر انگشت گیت ورودی و پیوستگی کلاس‌ها (Chain Matching)
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-emerald-100 text-emerald-900 border border-emerald-200">
                  اتصال به گیت‌های سخت‌افزاری ZKTeco / Suprema
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                تطبیق لاگ تردد گیت با ساعات کلاسی، تایید خودکار کلاس‌های متوالی بدون نیاز به ثبت مکرر اثر انگشت (Buffer Time: ۱۵ الی ۳۰ دقیقه)
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs">
                📶 وضعیت وب‌هوک گیت ورودی: برخط (Live)
              </span>
            </div>
          </div>

          {/* KPI Cards for Biometric Attendance */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-indigo-50 rounded-2xl border border-indigo-200">
              <span className="text-indigo-800 text-2xs block font-bold">تطبیق با گیت ورودی (۰۷:۴۵):</span>
              <span className="text-base font-black text-indigo-950 font-mono">
                {biometricLogs.filter(l => l.verificationMethod === 'GATE_FINGERPRINT').length} جلسه (کلاس اول) 🧬
              </span>
            </div>
            <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 dark:border-emerald-800 dark:bg-emerald-950">
              <span className="text-emerald-800 text-2xs block font-bold dark:text-emerald-200">پیوستگی زنجیره‌ای (Chain Match):</span>
              <span className="text-base font-black text-emerald-950 font-mono">
                {biometricLogs.filter(l => l.verificationMethod === 'CHAIN_MATCHING_CONTINUOUS').length} جلسه (کلاس‌های متوالی) 🔗
              </span>
            </div>
            <div className="p-3 bg-blue-50 rounded-2xl border border-blue-200">
              <span className="text-blue-800 text-2xs block font-bold">لاگین سیستم تریبون کلاس (SSO):</span>
              <span className="text-base font-black text-blue-950 font-mono">
                {biometricLogs.filter(l => l.verificationMethod === 'CLASS_PC_LOGIN').length} جلسه تاییدشده 🖥️
              </span>
            </div>
            <div className="p-3 bg-rose-50 rounded-2xl border border-rose-200">
              <span className="text-rose-800 text-2xs block font-bold">غیبت غیرموجه قطعی (کسر از حقوق):</span>
              <span className="text-base font-black text-rose-950 font-mono">
                {biometricLogs.filter(l => l.verificationMethod === 'UNJUSTIFIED_ABSENCE').length} جلسه ⚠️
              </span>
            </div>
          </div>

          {/* Logic Explanation Box */}
          <div className="p-4 bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-2xl space-y-2 text-xs">
            <h4 className="font-black text-amber-300 text-xs">
              💡 نحوه عملکرد منطق پیوستگی زنجیره‌ای (Chain Matching Logic) برای کلاس‌های پشت‌سرهم:
            </h4>
            <p className="text-indigo-100 leading-5">
              اگر استادی در یک روز دو کلاس متوالی داشته باشد (مثلاً کلاس اول ۰۸:۰۰ الی ۱۰:۰۰ و کلاس دوم ۱۰:۰۰ الی ۱۲:۰۰):
              <br />
              ۱. سیستم کلاس اول را با اثر انگشت ثبت‌شده در گیت ورودی (ساعت ۰۷:۴۸) تایید می‌کند.
              <br />
              ۲. برای کلاس دوم، سیستم <b>به هیچ وجه</b> به دنبال اثر انگشت مجدد در گیت ورودی نمی‌گردد؛ بلکه پایان موفقیت‌آمیز کلاس اول را به عنوان حضور پیوسته در محیط دانشگاه محسوب کرده و با احتساب ۱۵ الی ۳۰ دقیقه پنجره جابجایی بین ساختمان‌ها، کلاس دوم را به طور خودکار تایید می‌کند.
            </p>
          </div>

          {/* Biometric Logs Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-right text-xs border-collapse rt">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="p-2.5">کد</th>
                  <th className="p-2.5">نام استاد</th>
                  <th className="p-2.5 text-center">تاریخ</th>
                  <th className="p-2.5">عنوان درس و گروه</th>
                  <th className="p-2.5 text-center">ساعت کلاسی</th>
                  <th className="p-2.5 text-center">تردد گیت ورودی</th>
                  <th className="p-2.5 text-center">روش تایید حضور</th>
                  <th className="p-2.5">جزئیات و آی‌پی ثبت‌شده</th>
                  <th className="p-2.5 text-center">اثر مالی</th>
                </tr>
              </thead>
              <tbody>
                {biometricLogs.map(log => (
                  <tr
                    key={log.id}
                    className={`border-b border-slate-100 ${
                      log.isFlaggedSuspicious ? 'bg-rose-50/80 font-bold' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="p-2.5 font-mono" dir="ltr">{log.staffCode}</td>
                    <td className="p-2.5 font-black text-slate-900">{log.profName}</td>
                    <td className="p-2.5 text-center font-mono font-bold text-slate-700">{log.sessionDate}</td>
                    <td className="p-2.5 font-bold text-indigo-950">
                      {log.courseTitle} (گروه {log.groupNumber})
                    </td>
                    <td className="p-2.5 text-center font-mono font-bold">{log.classTime}</td>
                    <td className="p-2.5 text-center font-mono font-bold">
                      {log.gatePunchTime ? (
                        <span className="text-emerald-700">✓ {log.gatePunchTime}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="p-2.5 text-center">
                      {log.verificationMethod === 'GATE_FINGERPRINT' && (
                        <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-indigo-100 text-indigo-900">
                          🧬 اثر انگشت گیت
                        </span>
                      )}
                      {log.verificationMethod === 'CHAIN_MATCHING_CONTINUOUS' && (
                        <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-emerald-100 text-emerald-900">
                          🔗 پیوستگی زنجیره‌ای (پشت‌سرهم)
                        </span>
                      )}
                      {log.verificationMethod === 'CLASS_PC_LOGIN' && (
                        <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-blue-100 text-blue-900">
                          🖥️ ورود به سیستم کلاس
                        </span>
                      )}
                      {log.verificationMethod === 'UNJUSTIFIED_ABSENCE' && (
                        <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-rose-600 text-white">
                          ⚠️ غیبت غیرموجه قطعی
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 text-2xs text-slate-600">
                      <div>{log.verificationDetail}</div>
                      <div className="font-mono text-3xs text-slate-400" dir="ltr">{log.ipAddress}</div>
                    </td>
                    <td className="p-2.5 text-center">
                      {log.payrollPenaltyAmount > 0 ? (
                        <span className="font-mono font-black text-rose-700">
                          - {log.payrollPenaltyAmount.toLocaleString('fa-IR')} ريال
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-bold">بدون کسر</span>
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

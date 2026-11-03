'use client';

/**
 * BaseRatesTab — نرخ‌های پایه
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

export default function BaseRatesTab({ state, api }: Props) {
  const { baseRates } = state;
  const { handleUpdateBaseRate } = api;
  return (
    <>
        <div className="card space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="font-black text-slate-900 text-base">
                جدول تعرفه پایه حق‌التدریس بر اساس مرتبه علمی و مدرک تحصیلی
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                تعیین نرخ مصوب هیئت امنا به ازای هر واحد معادل تدریس یا هر ساعت کارکرد آموزشی در سال تحصیلی ۱۴۰۵
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {baseRates.map(rate => (
              <div key={rate.id} className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-black text-slate-900 text-sm">
                    مرتبه: {rate.academicRank} ({rate.degree})
                  </span>
                  <div className="flex items-center gap-1.5">
                    {rate.academicBase && (
                      <span className="text-3xs px-2 py-0.5 rounded bg-violet-50 text-violet-900 font-bold">
                        پایه {rate.academicBase}
                      </span>
                    )}
                    {rate.academicBase == null && (
                      <span className="text-3xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">
                        همهٔ پایه‌ها
                      </span>
                    )}
                    <span className="text-3xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-900 font-bold">
                      سال {faNum(rate.effectiveYear)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-slate-500 block text-2xs">نرخ مصوب هر واحد معادل (ريال):</span>
                    <input
                      type="number"
                      value={rate.ratePerUnit}
                      onChange={e => handleUpdateBaseRate(rate.id, parseInt(e.target.value) || 0)}
                      className="w-full mt-1 border border-slate-300 rounded px-2 py-1 font-mono font-bold text-slate-800 text-xs"
                    />
                  </div>
                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-slate-500 block text-2xs">معادل هر ساعت تدریس (ريال):</span>
                    <span className="block mt-2 font-mono font-black text-indigo-900 text-sm">
                      {rate.ratePerHour.toLocaleString('fa-IR')}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
    </>
  );
}

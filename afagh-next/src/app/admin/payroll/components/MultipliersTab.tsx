'use client';

/**
 * MultipliersTab — ضرایب آیین‌نامه
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

export default function MultipliersTab({ state, api }: Props) {
  const { multipliers } = state;
  const { handleUpdateMultiplier } = api;
  return (
    <>
        <div className="card space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="font-black text-slate-900 text-base">
                موتور ضرایب پویا و آیین‌نامه محاسبه واحدهای معادل (Dynamic Coefficients)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                فرمولاسیون هوشمند: واحد درس × ضریب نوع درس (عملی ۱.۵) × ضریب مقطع (ارشد ۱.۲ / دکتری ۱.۵) × ضریب جمعیت کلاس
              </p>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-right text-xs border-collapse rt">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="p-2.5">عنوان قانون ضریب</th>
                  <th className="p-2.5">دسته‌بندی</th>
                  <th className="p-2.5 text-center">ضریب اعمالی</th>
                  <th className="p-2.5">شرح قانون و استناد آیین‌نامه‌ای</th>
                  <th className="p-2.5 text-center">وضعیت فعال</th>
                </tr>
              </thead>
              <tbody>
                {multipliers.map(rule => (
                  <tr key={rule.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-2.5 font-black text-slate-900">{rule.ruleTitle}</td>
                    <td className="p-2.5">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-3xs font-bold">
                        {rule.category}
                      </span>
                    </td>
                    <td className="p-2.5 text-center">
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="3"
                        value={rule.multiplier}
                        onChange={e => handleUpdateMultiplier(rule.id, parseFloat(e.target.value) || 1.0)}
                        className="w-20 text-center border border-slate-300 rounded px-1.5 py-0.5 font-mono font-bold text-slate-800 text-xs"
                      />
                    </td>
                    <td className="p-2.5 text-slate-600 text-2xs">{rule.description}</td>
                    <td className="p-2.5 text-center">
                      <span className="px-2 py-0.5 rounded-full text-3xs font-black bg-emerald-100 text-emerald-900">
                        فعال ✓
                      </span>
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

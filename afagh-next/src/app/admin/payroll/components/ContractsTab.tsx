'use client';

/**
 * ContractsTab — قراردادها
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

export default function ContractsTab({ state, api }: Props) {
  const { payrollRecords } = state;
  const { showToast } = api;
  return (
    <>
        <div className="card space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="font-black text-slate-900 text-base">
                مدیریت قراردادهای ترمیک و ساعات موظفی اساتید
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                تفکیک قرارداد اعضای هیئت علمی تمام‌وقت (موظفی ۱۰ الی ۱۲ واحد) از اساتید مدعو (محاسبه حق‌التدریس از واحد ۱)
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {payrollRecords.map(rec => (
              <div key={rec.id} className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-black text-slate-900 text-sm">{rec.name}</h3>
                    <p className="text-2xs text-slate-500">کد پرسنلی: {rec.staffCode} · مرتبه: {rec.academicRank}</p>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-3xs font-black ${
                    rec.contractType === 'FULL_TIME_FACULTY' ? 'bg-indigo-100 text-indigo-900' : 'bg-amber-100 text-amber-900'
                  }`}>
                    {rec.contractType === 'FULL_TIME_FACULTY' ? 'هیئت علمی تمام‌وقت' : 'استاد مدعو / حق‌التدریس'}
                  </span>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500 text-2xs block">سقف موظفی آموزشی:</span>
                    <span className="font-mono font-black text-slate-900">{rec.baseDutyUnits} واحد ترمیک</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-2xs block">نرخ مالیات تکلیفی:</span>
                    <span className="font-mono font-black text-slate-900">{(rec.taxRate * 100)}٪ (ماده ۸۶ ق.م.م)</span>
                  </div>
                  <div className="col-span-2 pt-1 border-t border-slate-200">
                    <span className="text-slate-500 text-2xs block">شماره شبا بانکی جهت واریز:</span>
                    <span className="font-mono text-slate-800 text-2xs" dir="ltr">{rec.iban}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
    </>
  );
}

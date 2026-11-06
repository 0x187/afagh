'use client';

/**
 * BankDisketteTab — دیسکت بانکی
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

export default function BankDisketteTab({ state, api }: Props) {
  const { payrollRecords } = state;
  const { handleExportBankDiskette } = api;
  return (
    <>
        <div className="card space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="font-black text-slate-900 text-base">
                صدور دیسکت پرداخت بانکی (سامانه پایا و ساتنا بانک مرکزی)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                تولید خروجی استاندارد دیسکت انتقال وجه گروهی بر اساس شماره‌های شبای تاییدشده اساتید
              </p>
            </div>

            <button
              onClick={handleExportBankDiskette}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-800 text-white font-extrabold text-xs shadow flex items-center gap-1.5 transition"
            >
              <span>💾 بارگیری مستقیم فایل دیسکت بانکی (CSV/TXT)</span>
            </button>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-right text-xs border-collapse rt">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="p-2.5">ردیف</th>
                  <th className="p-2.5">نام و نام خانوادگی استاد</th>
                  <th className="p-2.5">کد ملی</th>
                  <th className="p-2.5">شماره شبا مقصد (IBAN)</th>
                  <th className="p-2.5">بانک عامل</th>
                  <th className="p-2.5 text-center">مبلغ خالص واریزی (ريال)</th>
                  <th className="p-2.5 text-center">شناسه پرداخت بانکی</th>
                </tr>
              </thead>
              <tbody>
                {payrollRecords.map((rec, idx) => (
                  <tr key={rec.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-2.5 font-mono">{idx + 1}</td>
                    <td className="p-2.5 font-black text-slate-900">{rec.name}</td>
                    <td className="p-2.5 font-mono" dir="ltr">{rec.nationalCode}</td>
                    <td className="p-2.5 font-mono text-2xs text-slate-700" dir="ltr">{rec.iban}</td>
                    <td className="p-2.5 font-bold text-slate-800">{rec.bankName}</td>
                    <td className="p-2.5 text-center font-mono font-black text-emerald-800 text-sm bg-emerald-50/40">
                      {rec.netAmount.toLocaleString('fa-IR')}
                    </td>
                    <td className="p-2.5 text-center font-mono text-slate-500" dir="ltr">
                      PAY-1405-{rec.id}
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

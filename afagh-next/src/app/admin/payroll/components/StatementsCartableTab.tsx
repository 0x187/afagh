'use client';

/**
 * StatementsCartableTab — کارتابل فیش‌های حق‌التدریس اساتید
 *
 * بخشی از جراحی معماری PayrollEngineClient (گام Component Splitting): این فایل
 * فقط رندر منطق تب خودش است؛ وضعیت از payrollReducer و اکشن‌ها از PayrollApi
 * (در PayrollEngineClient به‌صورت bound به dispatch تعریف می‌شوند) می‌آید.
 */
import { faNum } from '../payrollData';
import type { PayrollState, PayrollApi } from '../payrollReducer';
import { normalizeFa, faIncludes } from '@/lib/persian-search';

interface Props {
  state: PayrollState;
  api: PayrollApi;
}

export default function StatementsCartableTab({ state, api }: Props) {
  const { payrollRecords, paymentPolicy, searchQuery, contractFilter, statusFilter } = state;
  const { showToast, handleApproveStage, handleBatchSettle, setContractFilter, setStatusFilter, setSearchQuery, setDetailedPayslipRecord, setPaymentPolicy } = api;
  return (
    <>
        <div className="card space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="font-black text-slate-900 text-base">
                کارتابل صدور و تایید چندمرحله‌ای فیش‌های حق‌التدریس ترم
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                گردش کار رسمی: پیش‌نویس سیستمی ← تایید مدیر گروه ← تایید معاونت آموزشی ← تسویه امور مالی
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleBatchSettle}
                className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs shadow flex items-center gap-1.5 transition active:scale-95"
              >
                <span>✅ تسویه و واریز کلیه فیش‌های تاییدشده</span>
              </button>
            </div>
          </div>

          {/* Payment Policy Selector Banner */}
          <div className="p-3.5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5">
              <span className="text-amber-300 font-bold block">⚖️ شیوه و خط‌مشی پرداخت حق‌التدریس دانشگاه:</span>
              <p className="text-indigo-200 text-2xs">
                {paymentPolicy === 'FULL_TERM_END'
                  ? 'سیاست فعلی: پرداخت ۱۰۰٪ حق‌التدریس در پایان ترم پس از تایید نمرات و تحویل فیزیکی اوراق به بایگانی'
                  : 'سیاست فعلی: پرداخت ۳ مرحله‌ای در طول ترم (۲۰٪ پس از جلسه ۴ + ۳۰٪ پس از میان‌ترم + ۵۰٪ تسویه نهایی بایگانی)'}
              </p>
            </div>

            <div className="flex items-center gap-1.5 bg-white/10 p-1 rounded-xl border border-white/15 shrink-0">
              <button
                onClick={() => {
                  setPaymentPolicy('FULL_TERM_END');
                  showToast('سیاست پرداخت به «۱۰۰٪ یکجا در پایان ترم» تغییر یافت.');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  paymentPolicy === 'FULL_TERM_END'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                پرداخت یکجا پایان ترم
              </button>
              <button
                onClick={() => {
                  setPaymentPolicy('MILESTONE_INSTALLMENTS');
                  showToast('سیاست پرداخت به «اقساطی ۳ مرحله‌ای در طول ترم با شروط جلسات» تغییر یافت.');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  paymentPolicy === 'MILESTONE_INSTALLMENTS'
                    ? 'bg-amber-400 text-slate-950 font-black shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                پرداخت اقساطی چندمرحله‌ای
              </button>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-700">نوع قرارداد:</span>
                <select
                  value={contractFilter}
                  onChange={e => setContractFilter(e.target.value)}
                  className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800"
                >
                  <option value="ALL">همه اساتید</option>
                  <option value="FULL_TIME_FACULTY">اعضای هیئت علمی تمام‌وقت</option>
                  <option value="ADJUNCT">اساتید مدعو / حق‌التدریس</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-700">وضعیت گردش کار:</span>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800"
                >
                  <option value="ALL">همه وضعیت‌ها</option>
                  <option value="DRAFT">پیش‌نویس سیستمی</option>
                  <option value="DEPT_HEAD_APPROVED">تایید مدیر گروه</option>
                  <option value="DEAN_APPROVED">تایید معاونت آموزشی</option>
                  <option value="FINANCE_SETTLED">تسویه نهایی مالی</option>
                </select>
              </div>
            </div>

            <div className="w-full sm:w-64">
              <input
                type="text"
                placeholder="جستجو با نام استاد یا کد پرسنلی..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-1.5 text-xs bg-white text-slate-800"
              />
            </div>
          </div>

          {/* Table of Statements */}
          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-right text-xs border-collapse rt">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="p-2.5">کد</th>
                  <th className="p-2.5">نام استاد</th>
                  <th className="p-2.5">مرتبه علمی</th>
                  <th className="p-2.5">نوع قرارداد و موظفی</th>
                  <th className="p-2.5 text-center">کل واحد معادل</th>
                  <th className="p-2.5 text-center">واحد مازاد</th>
                  <th className="p-2.5 text-center">ناخالص (ريال)</th>
                  <th className="p-2.5 text-center">کسورات (ريال)</th>
                  <th className="p-2.5 text-center">خالص دریافتی (ريال)</th>
                  <th className="p-2.5 text-center">گلوگاه‌های تسویه</th>
                  <th className="p-2.5 text-center">وضعیت تایید</th>
                  <th className="p-2.5 text-left">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {payrollRecords
                  .filter(r => {
                    if (contractFilter !== 'ALL' && r.contractType !== contractFilter) return false;
                    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
                    if (normalizeFa(searchQuery)) {
                      const q = normalizeFa(searchQuery);
                      return faIncludes(r.name, q) || r.staffCode.includes(q) || r.nationalCode.includes(q);
                    }
                    return true;
                  })
                  .map(rec => (
                    <tr key={rec.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                      <td className="p-2.5 font-mono font-bold text-slate-700" dir="ltr">
                        {rec.staffCode}
                      </td>
                      <td className="p-2.5 font-black text-slate-900">
                        <div>{rec.name}</div>
                        <div className="text-3xs text-slate-500">{rec.departmentName}</div>
                      </td>
                      <td className="p-2.5 font-bold text-indigo-950">{rec.academicRank}</td>
                      <td className="p-2.5 text-2xs">
                        {rec.contractType === 'FULL_TIME_FACULTY' ? (
                          <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-900 font-bold">
                            هیئت علمی ({rec.baseDutyUnits} واحد موظفی)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-950 font-bold">
                            اساتید مدعو (از واحد اول)
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 text-center font-mono font-bold text-slate-800">
                        {rec.totalEquivalentUnits.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-center font-mono font-black text-indigo-900">
                        {rec.overloadUnits.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-center font-mono font-bold text-slate-700">
                        {rec.grossAmount.toLocaleString('fa-IR')}
                      </td>
                      <td className="p-2.5 text-center font-mono font-bold text-rose-700">
                        {rec.totalDeductions.toLocaleString('fa-IR')}
                      </td>
                      <td className="p-2.5 text-center font-mono font-black text-emerald-800 text-sm bg-emerald-50/40">
                        {rec.netAmount.toLocaleString('fa-IR')}
                      </td>
                      <td className="p-2.5 text-center">
                        <div className="flex flex-col gap-0.5 text-[9px] font-bold">
                          <span className={rec.gradesFinalized ? 'text-emerald-700' : 'text-rose-600'}>
                            {rec.gradesFinalized ? '✓ نمرات نهایی' : '⚠️ نمرات باز'}
                          </span>
                          <span className={rec.contractSigned ? 'text-emerald-700' : 'text-rose-600'}>
                            {rec.contractSigned ? '✓ امضای قرارداد' : '⚠️ فاقد امضا'}
                          </span>
                        </div>
                      </td>
                      <td className="p-2.5 text-center">
                        {rec.status === 'FINANCE_SETTLED' ? (
                          <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-emerald-600 text-white">
                            ✓ تسویه نهایی مالی
                          </span>
                        ) : rec.status === 'DEAN_APPROVED' ? (
                          <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-blue-600 text-white">
                            ✓ تایید معاونت آموزش
                          </span>
                        ) : rec.status === 'DEPT_HEAD_APPROVED' ? (
                          <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-indigo-600 text-white">
                            ✓ تایید مدیر گروه
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-3xs font-black bg-slate-200 text-slate-800">
                            پیش‌نویس سیستمی
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 text-left">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setDetailedPayslipRecord(rec)}
                            className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 font-black text-2xs transition"
                          >
                            📄 فیش تفصیلی
                          </button>
                          {rec.status !== 'FINANCE_SETTLED' && (
                            <button
                              onClick={() => handleApproveStage(rec.id)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black text-3xs shadow-xs transition"
                            >
                              ✓ تایید مرحله
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

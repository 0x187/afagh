/**
 * PayrollEngineClient — پوستهٔ اصلی (Orchestrator) شبیه‌ساز حقوق و دستمزد اساتید
 *
 * جراحی معماری طبق نقشه: این فایل فقط نگه‌دارندهٔ تب‌ها و توزیع‌کنندهٔ وضعیت است؛
 *   - وضعیت و منطق انتقال‌ها: payrollReducer.ts (قابل Unit Test)
 *   - تایپ‌ها و دادهٔ اولیه:   payrollData.ts
 *   - هر تب:                  components/*Tab.tsx (فقط رندر منطق خودش)
 * اتصال به دادهٔ واقعی (Server Actions در ../actions + payroll-engine) توسط
 * LivePayrollClient انجام می‌شود؛ این شبیه‌ساز برای سناریوهای آموزشی است.
 */
'use client';

import React, { useMemo, useReducer } from 'react';
import Link from 'next/link';
import {
  faNum,
  INITIAL_APPOINTMENT_DECREES,
  INITIAL_BASE_RATES,
  INITIAL_BIOMETRIC_LOGS,
  INITIAL_COURSE_EXAM_AGGREGATIONS,
  INITIAL_MULTIPLIERS,
  INITIAL_PAYROLL_RECORDS,
  INITIAL_PROF_FINANCIAL_SETTINGS,
} from './payrollData';
import type { PayrollTabType } from './payrollData';
import { flashToast, initialPayrollState, payrollReducer } from './payrollReducer';
import type { PayrollApi } from './payrollReducer';
import StatementsCartableTab from './components/StatementsCartableTab';
import BiometricChainTab from './components/BiometricChainTab';
import ElectronicDecreesTab from './components/ElectronicDecreesTab';
import InsuranceAdvancesTab from './components/InsuranceAdvancesTab';
import ExamAggregationTab from './components/ExamAggregationTab';
import BaseRatesTab from './components/BaseRatesTab';
import MultipliersTab from './components/MultipliersTab';
import ContractsTab from './components/ContractsTab';
import BankDisketteTab from './components/BankDisketteTab';
import CoefficientsRulesTab from './components/CoefficientsRulesTab';
import { notify } from '@/lib/ui-feedback';

export default function PayrollEngineClient({ universityTitle }: { universityTitle?: string | null } = {}) {
  const [state, dispatch] = useReducer(
    payrollReducer,
    null,
    () => initialPayrollState({
      payrollRecords: INITIAL_PAYROLL_RECORDS,
      baseRates: INITIAL_BASE_RATES,
      multipliers: INITIAL_MULTIPLIERS,
      biometricLogs: INITIAL_BIOMETRIC_LOGS,
      appointmentDecrees: INITIAL_APPOINTMENT_DECREES,
      courseExamAggregations: INITIAL_COURSE_EXAM_AGGREGATIONS,
      profFinancialSettings: INITIAL_PROF_FINANCIAL_SETTINGS,
    })
  );

  // از state — برای بنر، تب‌بار و مودال‌های شل
  const {
    activeTab, payrollRecords, toastMessage,
    detailedPayslipRecord, selectedDecreeForView,
  } = state;

  // ── آمار تجمیعی (KPI) ──
  const totalNetAmount = useMemo(() => payrollRecords.reduce((s, r) => s + r.netAmount, 0), [payrollRecords]);
  const totalGrossAmount = useMemo(() => payrollRecords.reduce((s, r) => s + r.grossAmount, 0), [payrollRecords]);
  const totalDeductionsAmount = useMemo(() => payrollRecords.reduce((s, r) => s + r.totalDeductions, 0), [payrollRecords]);
  const totalEquivalentUnitsCount = useMemo(() => payrollRecords.reduce((s, r) => s + r.totalEquivalentUnits, 0), [payrollRecords]);
  const fullTimeFacultyCount = useMemo(() => payrollRecords.filter(r => r.contractType === 'FULL_TIME_FACULTY').length, [payrollRecords]);
  const adjunctFacultyCount = useMemo(() => payrollRecords.filter(r => r.contractType === 'ADJUNCT').length, [payrollRecords]);

  // ── اکشن‌های باندشده به dispatch (قرارداد PayrollApi) ──
  const api: PayrollApi = {
    showToast: (msg) => flashToast(dispatch, msg),
    handleRecalculateAll: () => {
      dispatch({ type: 'RECALCULATE_ALL' });
      flashToast(dispatch, '🔄 محاسبات حقوق و حق‌التدریس کلیه اساتید بر اساس آخرین لاگ‌های حضور، امتحانات و ضرایب بازمحاسبه گردید.');
    },
    handleApproveStage: (id) => {
      const rec = state.payrollRecords.find(r => r.id === id);
      if (!rec) return;
      // گلوگاه‌های قانونی (Enforcement Gates)
      if (rec.status === 'DEAN_APPROVED') {
        if (!rec.gradesFinalized) {
          notify('⛔ گلوگاه تسویه مالی: استاد هنوز کلیه نمرات دروس ترم را نهایی نکرده است. صدور سند تسویه مالی مسدود است.', 'error');
          return;
        }
        if (!rec.contractSigned || !rec.appointmentSigned) {
          notify('⛔ گلوگاه اسناد: استاد هنوز قرارداد یا ابلاغیه تدریس را با امضای الکترونیک تایید نکرده است.', 'error');
          return;
        }
      }
      dispatch({ type: 'APPROVE_STAGE', payload: id });
      flashToast(dispatch, `✓ وضعیت تایید فیش حقوقی «${rec.name}» به مرحله بعدی ارتقا یافت.`);
    },
    handleBatchSettle: () => {
      const eligible = state.payrollRecords.filter(r => r.status === 'DEAN_APPROVED' && r.gradesFinalized && r.contractSigned);
      if (eligible.length === 0) {
        flashToast(dispatch, '⚠️ فیش آماده تسویه‌ای که کلیه گلوگاه‌های نمرات و امضای الکترونیک را پاس کرده باشد یافت نشد.');
        return;
      }
      dispatch({ type: 'BATCH_SETTLE' });
      flashToast(dispatch, `💳 تعداد ${eligible.length} فیش تاییدشده با موفقیت تسویه نهایی و سند پرداخت آن‌ها صادر شد.`);
    },
    handleExportBankDiskette: () => {
      const csvContent =
        'data:text/csv;charset=utf-8,' +
        'شماره ردیف,شماره شبا مقصد,نام صاحب حساب,مبلغ خالص (ریال),کد پرسنلی,کد ملی,نام بانک,شناسه پرداخت\n' +
        state.payrollRecords
          .map((r, idx) => `${idx + 1},${r.iban},${r.name},${r.netAmount},${r.staffCode},${r.nationalCode},${r.bankName},PAY-1405-${r.id}`)
          .join('\n');
      const link = document.createElement('a');
      link.setAttribute('href', encodeURI(csvContent));
      link.setAttribute('download', `Faculty_Payroll_Bank_Diskette_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      flashToast(dispatch, '💾 فایل استاندارد دیسکت پرداخت بانکی (پایا/ساتنا/شبا) اساتید با موفقیت بارگیری شد.');
    },
    handleBatchGenerateDecrees: () => {
      flashToast(dispatch, '🚀 ابلاغیه‌های رسمی تدریس (Teaching Appointment Decrees) برای کلیه ۴۰۰ استاد ترم در ۳ ثانیه تولید و پیامک اطلاع‌رسانی ارسال گردید.');
    },
    handleSendDecreeReminder: (profName) => {
      flashToast(dispatch, `📲 پیامک یادآوری امضای الکترونیکی ابلاغیه تدریس با موفقیت برای «${profName}» ارسال شد.`);
    },
    handleUpdateBaseRate: (id, newRate) => {
      dispatch({ type: 'UPDATE_BASE_RATE', payload: { id, newRate } });
      flashToast(dispatch, 'تعرفه پایه مرتبه علمی با موفقیت به‌روزرسانی گردید.');
    },
    handleUpdateMultiplier: (id, newMul) => {
      dispatch({ type: 'UPDATE_MULTIPLIER', payload: { id, newMul } });
      flashToast(dispatch, 'ضریب آیین‌نامه با موفقیت ذخیره شد.');
    },
    setContractFilter: (v) => dispatch({ type: 'SET_CONTRACT_FILTER', payload: v }),
    setStatusFilter: (v) => dispatch({ type: 'SET_STATUS_FILTER', payload: v }),
    setSearchQuery: (v) => dispatch({ type: 'SET_SEARCH', payload: v }),
    setDetailedPayslipRecord: (r) => dispatch({ type: 'SET_SLIP', payload: r }),
    setSelectedDecreeForView: (d) => dispatch({ type: 'SET_DECREE', payload: d }),
    setGlobalTaminSyncEnabled: () => dispatch({ type: 'TOGGLE_TAMIN_SYNC' }),
    setPaymentPolicy: (v) => dispatch({ type: 'SET_PAYMENT_POLICY', payload: v }),
    setCourseExamAggregations: (updater) => dispatch({ type: 'SET_EXAM_AGGREGATIONS', payload: updater }),
    setProfFinancialSettings: (updater) => dispatch({ type: 'SET_PROF_FINANCIAL_SETTINGS', payload: updater }),
    setActiveTab: (t: PayrollTabType) => dispatch({ type: 'SET_TAB', payload: t }),
    setToastMessage: (m) => dispatch({ type: 'SET_TOAST', payload: m }),
  };

  // اکشن‌های مورد استفاده در بنر/تب‌بار/مودال‌های شل
  const {
    handleRecalculateAll, handleExportBankDiskette, setToastMessage,
    setActiveTab, setSelectedDecreeForView, setDetailedPayslipRecord,
  } = api;

  return (
    <div className="space-y-4">
      {/* Top Banner & Title */}
      <div className="card bg-gradient-to-l from-indigo-950 via-slate-900 to-indigo-900 text-white p-5 rounded-2xl shadow-lg border border-indigo-800/40">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-indigo-700/80 border border-indigo-400/30 flex items-center justify-center text-3xl shadow-inner">
              💼
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-black text-lg sm:text-xl tracking-tight">
                  سامانه جامع محاسبه حق‌التدریس، حضور بیومتریک و ابلاغیه‌های اساتید
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-500/90 text-white shadow-xs">
                  نیمسال اول ۱۴۰۵-۱۴۰۴
                </span>
              </div>
              <p className="text-xs text-indigo-200 mt-1">
                تطبیق هوشمند اثر انگشت گیت با منطق پیوستگی زنجیره‌ای (Chain Matching)، صدور ۱۰۰٪ بدون کاغذ ابلاغیه‌ها و دیسکت بانکی
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleRecalculateAll}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 text-slate-950 font-black text-xs shadow-md flex items-center gap-1.5 transition active:scale-95"
            >
              <span>🔄 بازمحاسبه آنلاین کلیه فیش‌ها</span>
            </button>
            <button
              onClick={handleExportBankDiskette}
              className="px-3.5 py-2 rounded-xl bg-indigo-800/80 hover:bg-indigo-700 text-indigo-100 font-bold text-xs border border-indigo-600/50 flex items-center gap-1.5 transition"
            >
              <span>💾 دریافت دیسکت بانکی (شبا)</span>
            </button>
            <Link prefetch={false}
              href="/admin/exams"
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-600/50 flex items-center gap-1.5 transition"
            >
              <span>📝 ماژول امتحانات و صورتجلسات ←</span>
            </Link>
          </div>
        </div>

        {/* Quick KPI Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-4 mt-4 border-t border-indigo-800/60 text-xs">
          <div className="p-2.5 bg-indigo-900/60 rounded-xl border border-indigo-700/40">
            <span className="text-indigo-300 block text-2xs">کل خالص پرداختی ترم:</span>
            <span className="text-base font-black text-emerald-400 font-mono">
              {totalNetAmount.toLocaleString('fa-IR')} <span className="text-3xs font-normal text-indigo-200">ريال</span>
            </span>
          </div>
          <div className="p-2.5 bg-indigo-900/60 rounded-xl border border-indigo-700/40">
            <span className="text-indigo-300 block text-2xs">تعداد کل اساتید:</span>
            <span className="text-base font-black text-white">
              {payrollRecords.length} نفر ({fullTimeFacultyCount} هیئت علمی · {adjunctFacultyCount} مدعو)
            </span>
          </div>
          <div className="p-2.5 bg-indigo-900/60 rounded-xl border border-indigo-700/40">
            <span className="text-indigo-300 block text-2xs">مجموع واحدهای معادل:</span>
            <span className="text-base font-black text-amber-300 font-mono">
              {totalEquivalentUnitsCount.toFixed(2)} واحد
            </span>
          </div>
          <div className="p-2.5 bg-indigo-900/60 rounded-xl border border-indigo-700/40">
            <span className="text-indigo-300 block text-2xs">مجموع کسورات قانونی و انضباطی:</span>
            <span className="text-base font-black text-rose-300 font-mono">
              {totalDeductionsAmount.toLocaleString('fa-IR')} <span className="text-3xs font-normal text-indigo-200">ريال</span>
            </span>
          </div>
          <div className="p-2.5 bg-indigo-900/60 rounded-xl border border-indigo-700/40">
            <span className="text-indigo-300 block text-2xs">وضعیت تسویه مالی:</span>
            <span className="text-base font-black text-emerald-300">
              {payrollRecords.filter(r => r.status === 'FINANCE_SETTLED').length} فیش تسویه شده
            </span>
          </div>
        </div>
      </div>

      {/* Toast Alert */}
      {toastMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-xs font-bold flex items-center justify-between shadow-xs animate-in fade-in dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <span className="text-lg">📢</span>
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-emerald-700 font-black">✕</button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 bg-white p-2 rounded-2xl shadow-xs border border-slate-200">
        <button
          onClick={() => setActiveTab('STATEMENTS_CARTABLE')}
          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'STATEMENTS_CARTABLE'
              ? 'bg-indigo-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>📋 کارتابل فیش‌های حق‌التدریس اساتید</span>
        </button>

        <button
          onClick={() => setActiveTab('ATTENDANCE_BIOMETRIC_CHAIN')}
          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'ATTENDANCE_BIOMETRIC_CHAIN'
              ? 'bg-indigo-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>🧬 پایش تردد بیومتریک و پیوستگی کلاس‌ها (Chain Matching)</span>
        </button>

        <button
          onClick={() => setActiveTab('ELECTRONIC_DECREES')}
          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'ELECTRONIC_DECREES'
              ? 'bg-indigo-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>📜 ابلاغیه‌ها و صدور احکام تدریس (E-Sign)</span>
        </button>

        <button
          onClick={() => setActiveTab('INSURANCE_AND_ADVANCES')}
          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'INSURANCE_AND_ADVANCES'
              ? 'bg-indigo-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>🏥 بیمه تامین اجتماعی، مالیات و مساعده</span>
        </button>

        <button
          onClick={() => setActiveTab('EXAM_AGGREGATION_CHAIN')}
          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'EXAM_AGGREGATION_CHAIN'
              ? 'bg-indigo-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>📦 تجمیع اوراق امتحانی و بایگانی (No Sheet, No Pay)</span>
        </button>

        <button
          onClick={() => setActiveTab('BASE_RATES')}
          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'BASE_RATES'
              ? 'bg-indigo-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>🏷️ جدول تعرفه پایه مرتبه علمی</span>
        </button>

        <button
          onClick={() => setActiveTab('MULTIPLIERS')}
          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'MULTIPLIERS'
              ? 'bg-indigo-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>⚙️ موتور ضرایب پویا (تئوری/عملی/ارشد/دکتری)</span>
        </button>

        <button
          onClick={() => setActiveTab('CONTRACTS')}
          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'CONTRACTS'
              ? 'bg-indigo-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>📝 قراردادها و سقف موظفی</span>
        </button>

        <button
          onClick={() => setActiveTab('BANK_DISKETTE')}
          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'BANK_DISKETTE'
              ? 'bg-indigo-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>💳 صدور دیسکت پرداخت بانکی (شبا)</span>
        </button>

        <button
          onClick={() => setActiveTab('COEFFICIENTS_RULES')}
          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'COEFFICIENTS_RULES'
              ? 'bg-indigo-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>⚙️ ضرایب و قوانین محاسبه</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: STATEMENTS CARTABLE */}
      {/* ========================================================================= */}

      {/* ==== بدنهٔ تب‌ها (کامپوننت‌های جدا) ==== */}
      {activeTab === 'STATEMENTS_CARTABLE' && <StatementsCartableTab state={state} api={api} />}
      {activeTab === 'ATTENDANCE_BIOMETRIC_CHAIN' && <BiometricChainTab state={state} api={api} />}
      {activeTab === 'ELECTRONIC_DECREES' && <ElectronicDecreesTab state={state} api={api} />}
      {activeTab === 'INSURANCE_AND_ADVANCES' && <InsuranceAdvancesTab state={state} api={api} />}
      {activeTab === 'EXAM_AGGREGATION_CHAIN' && <ExamAggregationTab state={state} api={api} />}
      {activeTab === 'BASE_RATES' && <BaseRatesTab state={state} api={api} />}
      {activeTab === 'MULTIPLIERS' && <MultipliersTab state={state} api={api} />}
      {activeTab === 'CONTRACTS' && <ContractsTab state={state} api={api} />}
      {activeTab === 'BANK_DISKETTE' && <BankDisketteTab state={state} api={api} />}
      {activeTab === 'COEFFICIENTS_RULES' && <CoefficientsRulesTab state={state} api={api} />}


      {/* ========================================================================= */}
      {/* MODAL: APPOINTMENT DECREE VIEW */}
      {/* ========================================================================= */}
      {selectedDecreeForView && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print:static print:block print:bg-white print:p-0 print:overflow-visible">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in">
            <div className="p-4 bg-indigo-950 text-white flex items-center justify-between print:hidden">
              <div className="flex items-center gap-2">
                <span className="text-xl">📜</span>
                <div>
                  <h3 className="font-extrabold text-sm sm:text-base">
                    ابلاغیه رسمی تدریس{universityTitle ? ` — ${universityTitle}` : ''}
                  </h3>
                  <p className="text-2xs text-indigo-300">
                    شماره حکم: {selectedDecreeForView.decreeNo} · {selectedDecreeForView.termTitle}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedDecreeForView(null)}
                className="text-white/60 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="print-area p-6 overflow-y-auto space-y-4 text-xs">
              <div className="text-center space-y-1 border-b pb-4">
                <h2 className="font-black text-slate-900 text-base">جمهوری اسلامی ایران — وزارت علوم، تحقیقات و فناوری</h2>
                <h3 className="font-bold text-slate-700">حکم رسمی ابلاغ تدریس و وظایف آموزشی نیمسال</h3>
              </div>

              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 grid grid-cols-2 gap-2">
                <div>نام عضو هیئت علمی / مدرس: <strong>{selectedDecreeForView.profName}</strong></div>
                <div>کد پرسنلی: <strong className="font-mono">{selectedDecreeForView.staffCode}</strong></div>
                <div>مرتبه علمی: <strong>{selectedDecreeForView.academicRank}</strong></div>
                <div>دانشکده / گروه: <strong>{selectedDecreeForView.departmentName}</strong></div>
              </div>

              <div>
                <h4 className="font-black text-slate-900 mb-2">فهرست دروس مصوب ابلاغ‌شده جهت تدریس:</h4>
                <table className="w-full text-right text-xs border-collapse rt">
                  <thead>
                    <tr className="bg-slate-100 border-b">
                      <th className="p-2">کد درس</th>
                      <th className="p-2">عنوان درس</th>
                      <th className="p-2 text-center">گروه</th>
                      <th className="p-2 text-center">تعداد واحد</th>
                      <th className="p-2 text-center">ساعت تدریس هفتگی</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDecreeForView.coursesList.map((c, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2 font-mono" dir="ltr">{c.code}</td>
                        <td className="p-2 font-bold">{c.title}</td>
                        <td className="p-2 text-center">گروه {c.group}</td>
                        <td className="p-2 text-center font-bold">{c.units} واحد</td>
                        <td className="p-2 text-center font-bold">{c.weeklyHours} ساعت</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Digital Signature Stamp */}
              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-300 flex items-center justify-between">
                <div className="space-y-1">
                  <span className="font-black text-emerald-950 block text-xs">
                    {selectedDecreeForView.signatureStatus === 'SIGNED' ? '✓ سند دارای امضای الکترونیک معتبر و غیرقابل انکار است' : 'در انتظار تایید و امضای الکترونیک استاد'}
                  </span>
                  {selectedDecreeForView.signedAt && (
                    <span className="text-3xs text-emerald-800 font-mono block">
                      تاریخ امضا: {selectedDecreeForView.signedAt} · کد OTP: {selectedDecreeForView.otpUsed}
                    </span>
                  )}
                  {selectedDecreeForView.documentHash && (
                    <span className="text-[9px] text-slate-500 font-mono block" dir="ltr">
                      Hash: {selectedDecreeForView.documentHash}
                    </span>
                  )}
                </div>
                <div className="w-16 h-16 rounded-2xl bg-emerald-600 text-white flex items-center justify-center text-2xl font-black shadow-md">
                  ✓
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t flex justify-end gap-2 print:hidden">
              <button
                onClick={() => setSelectedDecreeForView(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs"
              >
                بستن
              </button>
              <button
                onClick={() => window.print()}
                className="px-6 py-2 rounded-xl bg-indigo-900 text-white font-black text-xs shadow"
              >
                🖨️ پرینت حکم
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DETAILED OFFICIAL PAYSLIP PREVIEW */}
      {/* ========================================================================= */}
      {detailedPayslipRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print:static print:block print:bg-white print:p-0 print:overflow-visible">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in">
            {/* Payslip Header */}
            <div className="p-4 bg-indigo-950 text-white flex items-center justify-between print:hidden">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-700 flex items-center justify-center font-black">
                  آ
                </div>
                <div>
                  <h3 className="font-extrabold text-sm sm:text-base">
                    فیش رسمی حق‌التدریس و کارکرد آموزشی اساتید — دانشگاه آفاق
                  </h3>
                  <p className="text-2xs text-indigo-300">
                    نیمسال اول ۱۴۰۵-۱۴۰۴ · شماره سند: AFAGH-PAY-1405-{detailedPayslipRecord.id}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDetailedPayslipRecord(null)}
                className="text-white/60 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Payslip Body */}
            <div className="print-area p-6 overflow-y-auto space-y-5 text-xs">
              {/* Professor Profile Box */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 text-2xs block">نام استاد:</span>
                  <span className="font-black text-slate-900 text-sm">{detailedPayslipRecord.name}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-2xs block">کد پرسنلی / کد ملی:</span>
                  <span className="font-mono font-bold text-slate-800" dir="ltr">
                    {detailedPayslipRecord.staffCode} · {detailedPayslipRecord.nationalCode}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 text-2xs block">مرتبه علمی و مدرک:</span>
                  <span className="font-bold text-indigo-900">
                    {detailedPayslipRecord.academicRank} ({detailedPayslipRecord.degree})
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 text-2xs block">نوع قرارداد / سقف موظفی:</span>
                  <span className="font-bold text-slate-800">
                    {detailedPayslipRecord.contractType === 'FULL_TIME_FACULTY'
                      ? `هیئت علمی (${detailedPayslipRecord.baseDutyUnits} واحد موظفی)`
                      : 'استاد مدعو (۰ واحد موظفی)'}
                  </span>
                </div>
              </div>

              {/* Course Breakdown Table */}
              <div>
                <h4 className="font-black text-slate-900 text-xs mb-2">
                  📚 ریز دروس تدریس‌شده و محاسبه واحدهای معادل (Coefficients & Equivalent Units):
                </h4>
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-right text-xs border-collapse rt">
                    <thead>
                      <tr className="bg-slate-100 text-slate-800 border-b">
                        <th className="p-2">کد درس</th>
                        <th className="p-2">عنوان درس</th>
                        <th className="p-2">مقطع</th>
                        <th className="p-2">نوع درس</th>
                        <th className="p-2 text-center">واحد مصوب</th>
                        <th className="p-2 text-center">دانشجویان</th>
                        <th className="p-2 text-center">ضریب اعمالی</th>
                        <th className="p-2 text-center">سهم تدریس</th>
                        <th className="p-2 text-center">واحد معادل نهایی</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailedPayslipRecord.courses.map(crs => (
                        <tr key={crs.id} className="border-b border-slate-100">
                          <td className="p-2 font-mono" dir="ltr">{crs.courseCode}</td>
                          <td className="p-2 font-black">{crs.courseTitle}</td>
                          <td className="p-2 text-slate-600">{crs.degreeLevel}</td>
                          <td className="p-2">{crs.courseType}</td>
                          <td className="p-2 text-center font-mono">{crs.units}</td>
                          <td className="p-2 text-center font-mono">{crs.studentsCount} نفر</td>
                          <td className="p-2 text-center font-mono font-bold text-indigo-900">× {crs.multiplier.toFixed(2)}</td>
                          <td className="p-2 text-center font-mono">{crs.teachingSharePercent}٪</td>
                          <td className="p-2 text-center font-mono font-black text-emerald-800 bg-emerald-50/50">
                            {crs.equivalentUnits.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Financial Breakdown Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Earnings */}
                <div className="p-4 bg-emerald-50/50 rounded-2xl border border-emerald-200 space-y-2">
                  <h4 className="font-black text-emerald-950 text-xs border-b border-emerald-200 pb-1.5">
                    💵 کارکرد و حق‌التدریس ناخالص:
                  </h4>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600">مجموع کل واحدهای معادل تدریس:</span>
                    <span className="font-mono font-black text-slate-900">{detailedPayslipRecord.totalEquivalentUnits.toFixed(2)} واحد</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600">کسر سقف موظفی آموزشی (هیئت علمی):</span>
                    <span className="font-mono font-bold text-slate-700">- {detailedPayslipRecord.baseDutyUnits.toFixed(2)} واحد</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600">خالص واحدهای مازاد قابل پرداخت:</span>
                    <span className="font-mono font-black text-indigo-900">{detailedPayslipRecord.overloadUnits.toFixed(2)} واحد</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600">نرخ مصوب هر واحد معادل:</span>
                    <span className="font-mono font-bold text-slate-800">{detailedPayslipRecord.baseRatePerUnit.toLocaleString('fa-IR')} ريال</span>
                  </div>
                  <div className="flex justify-between text-xs pt-2 border-t border-emerald-200">
                    <span className="font-black text-emerald-950">جمع کل حق‌التدریس ناخالص:</span>
                    <span className="font-mono font-black text-emerald-900 text-sm">
                      {detailedPayslipRecord.grossAmount.toLocaleString('fa-IR')} ريال
                    </span>
                  </div>
                </div>

                {/* Deductions */}
                <div className="p-4 bg-rose-50/50 rounded-2xl border border-rose-200 space-y-2">
                  <h4 className="font-black text-rose-950 text-xs border-b border-rose-200 pb-1.5">
                    📉 کسورات قانونی، انضباطی و مالیاتی:
                  </h4>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600">مالیات تکلیفی ۱۰٪ (ماده ۸۶ ق.م.م):</span>
                    <span className="font-mono font-bold text-rose-800">{detailedPayslipRecord.taxAmount.toLocaleString('fa-IR')} ريال</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600">کسر غیبت کلاسی بدون جبرانی:</span>
                    <span className="font-mono font-bold text-rose-800">
                      {detailedPayslipRecord.classAbsencePenaltyAmount > 0
                        ? `${detailedPayslipRecord.classAbsencePenaltyAmount.toLocaleString('fa-IR')} ريال`
                        : '۰ ريال'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600">جریمه غیبت در جلسه امتحان پایانی:</span>
                    <span className="font-mono font-bold text-rose-800">
                      {detailedPayslipRecord.examAbsencePenaltyAmount > 0
                        ? `${detailedPayslipRecord.examAbsencePenaltyAmount.toLocaleString('fa-IR')} ريال`
                        : '۰ ريال'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600">جریمه تاخیر در ثبت نمرات (خارج از SLA):</span>
                    <span className="font-mono font-bold text-rose-800">
                      {detailedPayslipRecord.lateGradePenaltyAmount > 0
                        ? `${detailedPayslipRecord.lateGradePenaltyAmount.toLocaleString('fa-IR')} ريال`
                        : '۰ ريال'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs pt-2 border-t border-rose-200">
                    <span className="font-black text-rose-950">جمع کل کسورات:</span>
                    <span className="font-mono font-black text-rose-900 text-sm">
                      {detailedPayslipRecord.totalDeductions.toLocaleString('fa-IR')} ريال
                    </span>
                  </div>
                </div>
              </div>

              {/* Net Payable Banner */}
              <div className="p-4 bg-gradient-to-r from-emerald-600 to-teal-700 text-white rounded-2xl shadow-md flex items-center justify-between">
                <div>
                  <span className="text-xs text-emerald-100 block font-bold">مبلغ خالص قابل پرداخت و واریز به حساب بانکی:</span>
                  <span className="font-mono font-black text-xl sm:text-2xl">
                    {detailedPayslipRecord.netAmount.toLocaleString('fa-IR')} <span className="text-xs font-normal">ريال</span>
                  </span>
                </div>
                <div className="text-left text-xs font-mono">
                  <span className="block text-emerald-200 text-3xs">شماره شبا:</span>
                  <span className="font-black" dir="ltr">{detailedPayslipRecord.iban}</span>
                </div>
              </div>

              {/* Signatures and Seals */}
              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-200 text-center text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                  <span className="text-slate-500 font-bold block text-3xs">تایید مدیر گروه آموزشی:</span>
                  <span className="font-black text-slate-800">دکتر رضا رضایی</span>
                  <span className="text-emerald-700 font-mono text-[9px] block">✓ امضای دیجیتال ثبت شد</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                  <span className="text-slate-500 font-bold block text-3xs">تایید معاونت آموزشی دانشکده:</span>
                  <span className="font-black text-slate-800">دکتر محمدرضا صادقی</span>
                  <span className="text-emerald-700 font-mono text-[9px] block">✓ امضای دیجیتال ثبت شد</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                  <span className="text-slate-500 font-bold block text-3xs">مهر اداره کل امور مالی و پرداخت:</span>
                  <span className="font-black text-slate-800">{universityTitle || '—'}</span>
                  <span className="text-emerald-700 font-mono text-[9px] block">✓ پلمب و سند حسابداری صادر شد</span>
                </div>
              </div>
            </div>

            {/* Payslip Footer */}
            <div className="p-4 bg-slate-50 border-t flex justify-end gap-2 print:hidden">
              <button
                onClick={() => setDetailedPayslipRecord(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs"
              >
                بستن
              </button>
              <button
                onClick={() => {
                  window.print();
                }}
                className="px-6 py-2 rounded-xl bg-indigo-900 hover:bg-indigo-950 text-white font-black text-xs shadow flex items-center gap-1.5"
              >
                <span>🖨️ پرینت رسمی فیش حقوقی</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


'use client';

/**
 * ProfessorGradesClient — پوستهٔ اصلی (Orchestrator) ماژول نمرات استاد
 *
 * طبق نقشهٔ جراحی معماری (گام ۱ Component Splitting): این فایل فقط نگه‌دارندهٔ
 * تب‌ها و توزیع‌کنندهٔ داده‌هاست؛ منطق انتقال‌های وضعیت در gradesReducer.ts و
 * قواعد ریاضی در grades-core.ts (قابل Unit Test) و اکشن‌های سرور در actions.ts
 * قرار دارند. هر تب فقط مسئول رندر منطق خودش است:
 *
 *   /components/RosterTab.tsx      — جدول ورود نمرات (useOptimistic + Server Action)
 *   /components/RubricTab.tsx      — تنظیمات بارم‌بندی و سهم‌ها
 *   /components/AppealsTab.tsx     — کارتابل رسیدگی به اعتراضات
 *   /components/AnalyticsTab.tsx   — تحلیل آماری
 *   /components/CertificateTab.tsx — صورت‌جلسهٔ رسمی و بایگانی
 */
import React, { useEffect, useReducer } from 'react';
import type { GradeAppealItem, GradeTabType, GradingCourseOffering } from './types';
import { faNum } from './types';
import { gradesReducer, initialGradesState, flashToast } from './gradesReducer';
import { isOfferingFinalized } from './grades-core';
import { requestFinalizeOtpAction } from './actions';
import RosterTab from './components/RosterTab';
import RubricTab from './components/RubricTab';
import AppealsTab from './components/AppealsTab';
import AnalyticsTab from './components/AnalyticsTab';
import CertificateTab from './components/CertificateTab';

export type { GradingCourseOffering, RubricWeights, StudentGradeItem, GradeAppealItem } from './types';

interface Props {
  professor: {
    id: number;
    name: string;
    staffCode: string;
    universityTitle: string;
    universityLogoUrl?: string | null;
  };
  termTitle: string;
  initialOfferings: GradingCourseOffering[];
  defaultOfferingId?: number;
}

const TAB_DEFS: { key: GradeTabType; label: string; icon: string }[] = [
  { key: 'ROSTER', label: 'ورود نمرات', icon: '📝' },
  { key: 'RUBRIC', label: 'بارم‌بندی', icon: '⚖️' },
  { key: 'APPEALS', label: 'اعتراضات', icon: '📩' },
  { key: 'ANALYTICS', label: 'تحلیل آماری', icon: '📊' },
  { key: 'CERTIFICATE', label: 'صورت‌جلسه و بایگانی', icon: '📜' },
];

export default function ProfessorGradesClient({
  professor,
  termTitle,
  initialOfferings,
  defaultOfferingId,
}: Props) {
  const [state, dispatch] = useReducer(
    gradesReducer,
    initialOfferings,
    (offerings) => initialGradesState(offerings, defaultOfferingId)
  );

  const currentOffering = state.offerings.find(o => o.id === state.selectedOfferingId) || state.offerings[0];
  const isOfferingFullyFinalized = isOfferingFinalized(currentOffering);
  const coTaught = !!currentOffering?.isCoTaught && !!currentOffering?.coTaughtDetails;

  // زمان «ذخیرهٔ خودکار» از پاسخ واقعی سرور (saveGradeAction) به‌روز می‌شود — نه تایمر محلی

  /** سازوکار «مشاهدهٔ اعتراض از جدول» — انتقال به تب اعتراضات */
  const openAppealFromRoster = (_appeal: GradeAppealItem) => {
    dispatch({ type: 'SET_TAB', payload: 'APPEALS' });
  };

  /** درخواست کد OTP هنگام باز شدن مودال قفل — نتیجه (کد دمو) به مودال بازمی‌گردد */
  const requestOtp = async (offeringId: number, memberOfferingIds?: number[]) => {
    try {
      const res = await requestFinalizeOtpAction({ ok: true } as any, { offeringId, memberOfferingIds });
      return { ok: res.ok, demoOtp: res.demoOtp, error: res.error };
    } catch {
      return { ok: false, error: 'خطا در درخواست کد تأیید.' };
    }
  };

  if (!currentOffering) {
    return <div className="card text-center p-8 text-slate-600 font-bold">درسی برای این نیمسال یافت نشد.</div>;
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* بنر بالای صفحه */}
      <div className="bg-gradient-to-l from-indigo-950 via-indigo-900 to-slate-900 rounded-3xl p-5 sm:p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute -left-10 -top-10 w-44 h-44 rounded-full bg-white/5" />
        <div className="absolute -right-6 bottom-0 w-24 h-24 rounded-full bg-amber-400/10" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-3xs font-black">نیمسال جاری</span>
              <span className="text-2xs font-bold text-indigo-200">{termTitle || 'نیمسال تعیین نشده'}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black mt-2">مدیریت نمرات استاد {professor.name}</h1>
            <p className="text-xs text-indigo-200 font-bold mt-1">
              کد پرسنلی: {professor.staffCode} · تعداد دروس: {faNum(state.offerings.length)}
            </p>
          </div>

          <div className="bg-white/10 border border-white/20 rounded-2xl p-3 backdrop-blur-sm">
            <div className="text-3xs font-black text-indigo-200 mb-1.5">درس فعال:</div>
            <select
              value={currentOffering.id}
              onChange={e => dispatch({ type: 'SET_OFFERING', payload: Number(e.target.value) })}
              className="w-full sm:w-64 bg-white text-slate-900 rounded-xl px-3 py-2 text-xs font-black focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              {state.offerings.map(o => (
                <option key={o.id} value={o.id}>
                  {o.title} (گروه {o.groupNumber}) — {o.isCoTaught ? 'مشترک' : 'تک‌استادی'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* سوییچ نقش در درس مشترک */}
      {coTaught && currentOffering.coTaughtDetails && (
        <div className="bg-white rounded-2xl p-3 shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-black text-slate-700">
            🔗 درس به‌صورت مشترک برگزار می‌شود:
            <span className="text-indigo-800"> {currentOffering.coTaughtDetails.theoryProfName} </span>
            (تئوری، سهم {faNum(currentOffering.coTaughtDetails.theoryWeightRatio * 100)}٪)
            و
            <span className="text-purple-800"> {currentOffering.coTaughtDetails.labProfName} </span>
            (عملی، سهم {faNum(currentOffering.coTaughtDetails.labWeightRatio * 100)}٪)
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => dispatch({ type: 'SWITCH_CO_ROLE', payload: 'THEORY' })}
              className={`px-3 py-1.5 rounded-xl text-2xs font-black transition ${currentOffering.coTaughtDetails.currentProfRole === 'THEORY' ? 'bg-indigo-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              دیدگاه تئوری
            </button>
            <button
              onClick={() => dispatch({ type: 'SWITCH_CO_ROLE', payload: 'LAB' })}
              className={`px-3 py-1.5 rounded-xl text-2xs font-black transition ${currentOffering.coTaughtDetails.currentProfRole === 'LAB' ? 'bg-purple-800 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              دیدگاه عملی
            </button>
          </div>
        </div>
      )}

      {/* نوار تب‌ها */}
      <div className="flex flex-wrap gap-2">
        {TAB_DEFS.map(tab => {
          const active = state.activeTab === tab.key;
          if (tab.key === 'RUBRIC' && coTaught) return null;
          return (
            <button
              key={tab.key}
              onClick={() => dispatch({ type: 'SET_TAB', payload: tab.key })}
              className={`px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5 ${
                active
                  ? tab.key === 'CERTIFICATE'
                    ? 'bg-emerald-700 text-white shadow-sm'
                    : 'bg-indigo-900 text-white shadow-sm'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* بدنهٔ تب‌ها */}
      {state.activeTab === 'ROSTER' && (
        <RosterTab
          offering={currentOffering}
          termTitle={termTitle}
          lastAutoSaveTime={state.lastAutoSaveTime}
          onRequestFinalizeOtp={() => requestOtp(currentOffering.id, currentOffering.memberOfferingIds)}
          dispatch={dispatch}
        />
      )}

      {state.activeTab === 'RUBRIC' && !coTaught && (
        <RubricTab offering={currentOffering} dispatch={dispatch} />
      )}

      {state.activeTab === 'APPEALS' && (
        <AppealsTab offering={currentOffering} dispatch={dispatch} onOpenAppeal={openAppealFromRoster} />
      )}

      {state.activeTab === 'ANALYTICS' && <AnalyticsTab offering={currentOffering} />}

      {state.activeTab === 'CERTIFICATE' && (
        <CertificateTab
          offering={currentOffering}
          termTitle={termTitle}
          professorName={professor.name}
          universityTitle={professor.universityTitle}
          universityLogoUrl={professor.universityLogoUrl ?? null}
          dispatch={dispatch}
        />
      )}

      {/* Toast */}
      {state.toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md bg-slate-950 text-white rounded-2xl px-5 py-3.5 shadow-2xl text-xs font-black leading-6 animate-pulse">
          {state.toastMessage}
        </div>
      )}
    </div>
  );
}

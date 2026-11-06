'use client';

/**
 * AppealsTab — کارتابل رسیدگی به اعتراضات دانشجویان
 *
 * وضعیت مودال و فیلدهای ویرایش اعتراض به‌صورت کاملاً ایزوله در همین کامپوننت
 * نگه‌داری می‌شود (توسعهٔ تیمی بدون درگیری با کدهای RosterTab)؛ تصمیم نهایی با
 * RESOLVE_APPEAL در gradesReducer ثبت و در دیتابیس توسط resolveAppealAction
 * (Server Action در actions.ts) همگام می‌شود.
 */
import { useActionState, useState } from 'react';
import type { GradeAppealItem, GradingCourseOffering } from '../types';
import { faNum } from '../types';
import type { GradesDispatch } from '../gradesReducer';
import { flashToast } from '../gradesReducer';
import { resolveAppealAction, ResolveAppealPayload } from '../actions';

interface AppealsTabProps {
  offering: GradingCourseOffering;
  dispatch: GradesDispatch;
  onOpenAppeal: (appeal: GradeAppealItem) => void;
}

export default function AppealsTab({ offering, dispatch, onOpenAppeal }: AppealsTabProps) {
  const [modal, setModal] = useState<{ appeal: GradeAppealItem; reply: string; breakdown: Record<string, number> } | null>(null);
  const [appealState, appealAction, isResolving] = useActionState(resolveAppealAction, { ok: true });

  const liveCalculated = (() => {
    if (!modal) return 0;
    const b = modal.breakdown;
    if (offering.isCoTaught && offering.coTaughtDetails) {
      const t = b.theoryProfScore || 0;
      const l = b.labProfScore || 0;
      return Math.min(20, Math.round((t * offering.coTaughtDetails.theoryWeightRatio + l * offering.coTaughtDetails.labWeightRatio) * 100) / 100);
    }
    const sum = (b.midtermScore || 0) + (b.homeworkScore || 0) + (b.participationScore || 0) + (b.practicalScore || 0) + (b.finalExamScore || 0);
    return Math.min(20, Math.round(sum * 100) / 100);
  })();

  const openModal = (appeal: GradeAppealItem) => {
    const st = offering.students.find(s => s.studentId === appeal.studentId);
    setModal({
      appeal,
      reply: appeal.professorReply || '',
      breakdown: {
        midtermScore: st?.midtermScore ?? 0,
        homeworkScore: st?.homeworkScore ?? 0,
        participationScore: st?.participationScore ?? 0,
        practicalScore: st?.practicalScore ?? 0,
        finalExamScore: st?.finalExamScore ?? 0,
        theoryProfScore: st?.theoryProfScore ?? 0,
        labProfScore: st?.labProfScore ?? 0,
      },
    });
  };

  const decide = (decision: 'ACCEPTED' | 'REJECTED') => {
    if (!modal) return;
    dispatch({
      type: 'RESOLVE_APPEAL',
      payload: {
        appealId: modal.appeal.id,
        decision,
        reply: modal.reply,
        breakdown: modal.breakdown as any,
      },
    });
    // همگام‌سازی پس‌زمینه با سرور
    const payload: ResolveAppealPayload = {
      appealId: modal.appeal.id,
      studentCode: modal.appeal.studentCode,
      offeringId: modal.appeal.enrollmentOfferingId ?? offering.id,
      decision,
      reply: modal.reply,
      newGrade: decision === 'ACCEPTED' ? liveCalculated : modal.appeal.currentGrade,
    };
    void appealAction(payload);
    flashToast(
      dispatch,
      decision === 'ACCEPTED' ? '✓ اعتراض دانشجو پذیرفته شد و نمره جدید در سامانه ثبت گردید.' : '✕ اعتراض دانشجو پس از بررسی رد گردید.',
      5000
    );
    setModal(null);
  };

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 space-y-4 print:hidden">
      <div className="pb-3 border-b border-slate-100">
        <h3 className="font-black text-slate-900 text-base">
          کارتابل رسیدگی به اعتراضات دانشجویان (درس {offering.title})
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          مهلت رسیدگی استاد از تنظیمات ترم (میدان professorAppealSlaDays) خوانده می‌شود.
        </p>
      </div>

      {offering.appeals.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
          <div className="text-4xl mb-2">✅</div>
          <p className="font-black text-slate-700 text-sm">اعتراضی برای این درس ثبت نشده است.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {offering.appeals.map(appeal => (
            <div key={appeal.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-black text-slate-900 text-xs">{appeal.fullName}</span>
                  <span className="font-mono text-xs text-slate-500 mr-1">({faNum(appeal.studentCode)})</span>
                  <span className="text-3xs text-slate-400 font-bold">
                    نمره موقت: {faNum(appeal.currentGrade)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-3xs text-slate-400 font-bold">{appeal.createdAt}</span>
                  <span className={`px-2 py-0.5 rounded-full text-3xs font-black ${
                    appeal.status === 'ACCEPTED'
                      ? 'bg-emerald-100 text-emerald-800'
                      : appeal.status === 'REJECTED'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-900'
                  }`}>
                    {appeal.status === 'ACCEPTED' ? 'پذیرفته شده' : appeal.status === 'REJECTED' ? 'رد شده' : 'در انتظار بررسی'}
                  </span>
                </div>
              </div>

              <p className="leading-6 text-xs text-slate-700 bg-white border border-slate-200 rounded-xl p-3">
                <span className="font-black text-slate-900">📩 متن اعتراض: </span>
                {appeal.studentMessage}
              </p>

              {appeal.status !== 'OPEN' && (
                <div className="p-3 bg-slate-100 rounded-xl text-xs space-y-1">
                  {appeal.status === 'ACCEPTED' && (
                    <p className="font-bold text-emerald-700">نمره جدید ابلاغی: {faNum(appeal.newGrade)} از ۲۰</p>
                  )}
                  <p className="leading-5">
                    <span className="font-black text-slate-800">پاسخ استاد: </span>
                    {appeal.professorReply || 'بدون توضیح'}
                  </p>
                </div>
              )}

              {appeal.status === 'OPEN' ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => openModal(appeal)}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs transition"
                  >
                    ✍️ رسیدگی و بازبینی نمره
                  </button>
                  <button
                    onClick={() => onOpenAppeal(appeal)}
                    className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
                  >
                    مشاهدهٔ پرونده
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => openModal(appeal)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold text-xs transition"
                >
                  مشاهدهٔ جزئیات
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* مودال رسیدگی به اعتراض — ایزوله در همین کامپوننت */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" dir="rtl">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h4 className="font-black text-slate-900 text-sm">
                رسیدگی به اعتراض {modal.appeal.fullName} ({faNum(modal.appeal.studentCode)})
              </h4>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-700 font-black">✕</button>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs leading-6">
              <span className="font-black text-amber-900">اعتراض دانشجو: </span>
              {modal.appeal.studentMessage}
            </div>

            {offering.isCoTaught && offering.coTaughtDetails ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-2xs font-black text-slate-600">
                  نمرهٔ تئوری (از ۲۰)
                  <input
                    type="number" min={0} max={20} step={0.25}
                    value={modal.breakdown.theoryProfScore}
                    onChange={e => setModal(m => m && ({ ...m, breakdown: { ...m.breakdown, theoryProfScore: Number(e.target.value) } }))}
                    className="mt-1 w-full border-2 border-indigo-200 rounded-xl p-2 text-center font-black focus:ring-2 focus:ring-indigo-500"
                  />
                </label>
                <label className="text-2xs font-black text-slate-600">
                  نمرهٔ عملی (از ۲۰)
                  <input
                    type="number" min={0} max={20} step={0.25}
                    value={modal.breakdown.labProfScore}
                    onChange={e => setModal(m => m && ({ ...m, breakdown: { ...m.breakdown, labProfScore: Number(e.target.value) } }))}
                    className="mt-1 w-full border-2 border-purple-200 rounded-xl p-2 text-center font-black focus:ring-2 focus:ring-purple-500"
                  />
                </label>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-2xs font-black text-slate-600">
                  میان‌ترم ({faNum(offering.rubric.midterm)})
                  <input type="number" min={0} max={offering.rubric.midterm} step={0.25}
                    value={modal.breakdown.midtermScore}
                    onChange={e => setModal(m => m && ({ ...m, breakdown: { ...m.breakdown, midtermScore: Number(e.target.value) } }))}
                    className="mt-1 w-full border-2 border-slate-200 rounded-xl p-2 text-center font-black focus:ring-2 focus:ring-indigo-500" />
                </label>
                <label className="text-2xs font-black text-slate-600">
                  تکالیف ({faNum(offering.rubric.homework)})
                  <input type="number" min={0} max={offering.rubric.homework} step={0.25}
                    value={modal.breakdown.homeworkScore}
                    onChange={e => setModal(m => m && ({ ...m, breakdown: { ...m.breakdown, homeworkScore: Number(e.target.value) } }))}
                    className="mt-1 w-full border-2 border-slate-200 rounded-xl p-2 text-center font-black focus:ring-2 focus:ring-indigo-500" />
                </label>
                <label className="text-2xs font-black text-slate-600">
                  حضور ({faNum(offering.rubric.participation)})
                  <input type="number" min={0} max={offering.rubric.participation} step={0.25}
                    value={modal.breakdown.participationScore}
                    onChange={e => setModal(m => m && ({ ...m, breakdown: { ...m.breakdown, participationScore: Number(e.target.value) } }))}
                    className="mt-1 w-full border-2 border-slate-200 rounded-xl p-2 text-center font-black focus:ring-2 focus:ring-indigo-500" />
                </label>
                {offering.rubric.practical > 0 && (
                  <label className="text-2xs font-black text-slate-600">
                    عملی ({faNum(offering.rubric.practical)})
                    <input type="number" min={0} max={offering.rubric.practical} step={0.25}
                      value={modal.breakdown.practicalScore}
                      onChange={e => setModal(m => m && ({ ...m, breakdown: { ...m.breakdown, practicalScore: Number(e.target.value) } }))}
                      className="mt-1 w-full border-2 border-slate-200 rounded-xl p-2 text-center font-black focus:ring-2 focus:ring-indigo-500" />
                  </label>
                )}
                <label className="text-2xs font-black text-slate-600">
                  پایان‌ترم ({faNum(offering.rubric.finalExam)})
                  <input type="number" min={0} max={offering.rubric.finalExam} step={0.25}
                    value={modal.breakdown.finalExamScore}
                    onChange={e => setModal(m => m && ({ ...m, breakdown: { ...m.breakdown, finalExamScore: Number(e.target.value) } }))}
                    className="mt-1 w-full border-2 border-slate-200 rounded-xl p-2 text-center font-black focus:ring-2 focus:ring-indigo-500" />
                </label>
              </div>
            )}

            <div className="p-3 bg-slate-900 rounded-2xl text-center">
              <div className="text-3xs text-slate-400 font-bold">نمرهٔ نهایی محاسبه‌شده (از ۲۰)</div>
              <div className="text-3xl font-black text-amber-300">{faNum(liveCalculated)}</div>
            </div>

            <label className="text-2xs font-black text-slate-600 block">
              پاسخ استاد (متن پیام برای دانشجو)
              <textarea
                rows={3}
                value={modal.reply}
                onChange={e => setModal(m => m && ({ ...m, reply: e.target.value }))}
                placeholder="توضیح تصمیم و در صورت رد اعتراض، دلیل..."
                className="mt-1 w-full border-2 border-slate-200 rounded-xl p-3 text-xs font-bold focus:ring-2 focus:ring-indigo-500"
              />
            </label>

            <div className="flex gap-2">
              <button
                onClick={() => decide('ACCEPTED')}
                disabled={isResolving}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-sm transition"
              >
                ✓ پذیرش و ثبت نمرهٔ جدید
              </button>
              <button
                onClick={() => decide('REJECTED')}
                disabled={isResolving}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-black text-sm transition"
              >
                ✕ رد اعتراض
              </button>
            </div>

            {appealState?.error && (
              <p className="text-2xs font-bold text-rose-600">⚠ {appealState.error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

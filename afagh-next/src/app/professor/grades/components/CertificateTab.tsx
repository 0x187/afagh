'use client';

/**
 * CertificateTab — صورت‌جلسهٔ رسمی نهایی و بایگانی (چاپ بومی بدون کتابخانهٔ PDF)
 */
import type { GradingCourseOffering } from '../types';
import { faNum } from '../types';
import type { GradesDispatch } from '../gradesReducer';
import { flashToast } from '../gradesReducer';

interface CertificateTabProps {
  offering: GradingCourseOffering;
  termTitle: string;
  professorName: string;
  universityTitle: string;
  universityLogoUrl?: string | null;
  dispatch: GradesDispatch;
}

export default function CertificateTab({ offering, termTitle, professorName, universityTitle, universityLogoUrl, dispatch }: CertificateTabProps) {
  const isPass = (g: number | undefined) => (g ?? 0) >= 10;

  const handleArchive = () => {
    dispatch({ type: 'ARCHIVE_CERTIFICATE' });
    flashToast(dispatch, '📁 صورت‌جلسهٔ رسمی آزمون در پروندهٔ الکترونیک این درس علامت‌گذاری شد.', 6000);
  };

  return (
    <div className="print-area bg-white rounded-3xl p-6 shadow-xl border-2 border-slate-800 space-y-6">
      {/* سربرگ رسمی */}
      <div className="border-b-2 border-slate-900 pb-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {universityLogoUrl ? (
            <img src={universityLogoUrl} alt="" width={56} height={56} className="w-14 h-14 object-contain" />
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-slate-950 text-white flex items-center justify-center font-black text-2xl shadow-md">
              آ
            </div>
          )}
          <div>
            <h2 className="text-base sm:text-lg font-black text-slate-950">
              {universityTitle || 'نام دانشگاه در سامانه ثبت نشده است'} — معاونت آموزشی و تحصیلات تکمیلی
            </h2>
            <p className="text-xs font-bold text-slate-600">
              صورت‌جلسه رسمی و لیست نمرات نهایی پایان‌ترم · {termTitle || 'نیمسال تعیین نشده'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 rounded-xl bg-indigo-900 hover:bg-indigo-950 text-white font-black text-xs shadow flex items-center gap-1.5"
          >
            <span>🖨️ چاپ و ذخیره صورت‌جلسه (PDF)</span>
          </button>
          {!offering.isArchived ? (
            <button
              onClick={handleArchive}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow flex items-center gap-1.5"
            >
              <span>📁 ثبت امضای دیجیتال و بایگانی اسناد</span>
            </button>
          ) : (
            <span className="px-4 py-2 rounded-xl bg-emerald-100 text-emerald-950 font-black text-xs border border-emerald-300 flex items-center gap-1.5">
              <span>✓ در پرونده الکترونیک بایگانی شد</span>
            </span>
          )}
        </div>
      </div>

      {/* مشخصات */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-300 text-xs">
        <div>
          <span className="text-slate-500 block text-2xs">عنوان و کد درس:</span>
          <strong className="text-slate-900 text-sm font-black">{offering.title} ({offering.code})</strong>
        </div>
        <div>
          <span className="text-slate-500 block text-2xs">گروه و تعداد واحد:</span>
          <strong className="text-slate-900 text-sm font-black">گروه {faNum(offering.groupNumber)} · {faNum(offering.units)} واحد</strong>
        </div>
        <div>
          <span className="text-slate-500 block text-2xs">استاد / اساتید درس:</span>
          <strong className="text-slate-900 text-xs font-black">
            {offering.isCoTaught && offering.coTaughtDetails
              ? `${offering.coTaughtDetails.theoryProfName} و ${offering.coTaughtDetails.labProfName}`
              : professorName}
          </strong>
        </div>
        <div>
          <span className="text-slate-500 block text-2xs">وضعیت صورت‌جلسه:</span>
          <strong className="text-emerald-800 text-xs font-black">
            {offering.isFinalized ? 'قفل قطعی و نهایی‌شده ✓' : 'پیش‌نویس — قفل نهایی نشده'}
          </strong>
        </div>
      </div>

      {/* جدول نمرات */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-slate-400 text-xs rt">
          <thead>
            <tr className="bg-slate-900 text-white text-center">
              <th className="p-2 border border-slate-700 w-12 font-bold">ردیف</th>
              <th className="p-2 border border-slate-700 font-bold">شماره دانشجویی</th>
              <th className="p-2 border border-slate-700 text-right font-bold">نام و نام خانوادگی دانشجو</th>
              {offering.isCoTaught ? (
                <>
                  <th className="p-2 border border-slate-700 font-bold">نمره تئوری ({faNum((offering.coTaughtDetails?.theoryWeightRatio || 0.6) * 100)}٪)</th>
                  <th className="p-2 border border-slate-700 font-bold">نمره عملی ({faNum((offering.coTaughtDetails?.labWeightRatio || 0.4) * 100)}٪)</th>
                </>
              ) : (
                <th className="p-2 border border-slate-700 font-bold">نمره مستمر و کلاسی</th>
              )}
              <th className="p-2 border border-slate-700 font-black text-amber-300">نمره نهایی (از ۲۰)</th>
              <th className="p-2 border border-slate-700 font-bold">نتیجه ارزشیابی</th>
            </tr>
          </thead>
          <tbody>
            {offering.students.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 border border-slate-300 text-center font-bold text-slate-500">
                  هنوز داده‌ای ثبت نشده است
                </td>
              </tr>
            ) : offering.students.map((st, idx) => {
              const hasScore = st.calculatedFinalScore !== undefined;
              const finalScore = st.calculatedFinalScore ?? 0;
              return (
                <tr key={st.studentId} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="p-2 border border-slate-300 text-center font-bold text-slate-500">{faNum(idx + 1)}</td>
                  <td className="p-2 border border-slate-300 font-mono text-center font-bold text-indigo-950" dir="ltr">{st.studentCode}</td>
                  <td className="p-2 border border-slate-300 font-black text-slate-900">{st.fullName}</td>
                  {offering.isCoTaught ? (
                    <>
                      <td className="p-2 border border-slate-300 text-center font-bold">{faNum(st.theoryProfScore ?? '—')}</td>
                      <td className="p-2 border border-slate-300 text-center font-bold">{faNum(st.labProfScore ?? '—')}</td>
                    </>
                  ) : (
                    <td className="p-2 border border-slate-300 text-center font-bold">
                      {faNum(((st.midtermScore ?? 0) + (st.homeworkScore ?? 0) + (st.participationScore ?? 0) + (st.practicalScore ?? 0)).toFixed(2))}
                    </td>
                  )}
                  <td className="p-2 border border-slate-300 text-center font-black text-slate-950">{hasScore ? faNum(Number(finalScore.toFixed(2))) : '—'}</td>
                  <td className="p-2 border border-slate-300 text-center">
                    {!hasScore ? (
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold text-3xs">ثبت نشده</span>
                    ) : isPass(finalScore) ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-3xs">قبول</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-3xs">مردود</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* امضاها */}
      <div className="grid grid-cols-2 gap-6 pt-4 border-t border-slate-300">
        <div className="text-center">
          {offering.isCoTaught && offering.coTaughtDetails ? (
            <>
              <div className="text-xs font-black text-slate-800">{offering.coTaughtDetails.theoryProfName}</div>
              <div className="text-3xs text-slate-500 font-bold">استاد بخش تئوری</div>
            </>
          ) : (
            <>
              <div className="text-xs font-black text-slate-800">{professorName}</div>
              <div className="text-3xs text-slate-500 font-bold">استاد درس</div>
            </>
          )}
          <div className="mt-6 border-t border-dashed border-slate-400 pt-1 text-3xs text-slate-400 font-bold">امضا و مهر</div>
        </div>
        <div className="text-center">
          <div className="text-xs font-black text-slate-800">معاونت آموزشی {universityTitle || 'دانشگاه'}</div>
          <div className="text-3xs text-slate-500 font-bold">اداره آموزش و امور دانشجویی</div>
          <div className="mt-6 border-t border-dashed border-slate-400 pt-1 text-3xs text-slate-400 font-bold">امضا و مهر</div>
        </div>
      </div>
    </div>
  );
}

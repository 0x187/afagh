'use client';

/**
 * AnalyticsTab — تحلیل آماری و توزیع فراوانی نمرات (فقط‌خواندنی)
 */
import type { GradingCourseOffering } from '../types';
import { faNum } from '../types';
import { computeClassStats, computeDistribution } from '../grades-core';

interface AnalyticsTabProps {
  offering: GradingCourseOffering;
}

export default function AnalyticsTab({ offering }: AnalyticsTabProps) {
  const dist = computeDistribution(offering.students);
  const stats = computeClassStats(offering.students);
  const gradedCount = offering.students.filter(s => s.calculatedFinalScore !== undefined).length;
  const total = gradedCount || 1;

  const bars: { label: string; count: number; color: string; range: string }[] = [
    { label: 'عالی', count: dist.excellent, color: 'bg-emerald-500', range: '۱۷ تا ۲۰' },
    { label: 'خوب', count: dist.good, color: 'bg-sky-500', range: '۱۴ تا ۱۶.۹۹' },
    { label: 'قابل قبول', count: dist.fair, color: 'bg-amber-500', range: '۱۰ تا ۱۳.۹۹' },
    { label: 'مردود', count: dist.fail, color: 'bg-rose-500', range: 'کمتر از ۱۰' },
  ];

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 space-y-6 print:hidden">
      <div className="pb-3 border-b border-slate-100">
        <h3 className="font-black text-slate-900 text-base">
          تحلیل آماری و توزیع فراوانی نمرات درس {offering.title}
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          بر اساس نمرات نهایی محاسبه‌شده از بارم‌بندی مصوب
        </p>
      </div>

      {/* کارت‌های آمار */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center">
          <div className="text-2xl font-black text-emerald-800">{faNum(stats.passed)}</div>
          <div className="text-2xs font-black text-emerald-700 mt-1">تعداد قبول</div>
        </div>
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-center">
          <div className="text-2xl font-black text-rose-800">{faNum(stats.failed)}</div>
          <div className="text-2xs font-black text-rose-700 mt-1">تعداد مردود</div>
        </div>
        <div className="p-4 bg-sky-50 border border-sky-200 rounded-2xl text-center">
          <div className="text-2xl font-black text-sky-800">
            {gradedCount > 0 ? faNum(Number(stats.average.toFixed(2))) : '—'}
          </div>
          <div className="text-2xs font-black text-sky-700 mt-1">میانگین کلاس</div>
        </div>
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-center">
          <div className="text-2xl font-black text-slate-800">{faNum(offering.students.length)}</div>
          <div className="text-2xs font-black text-slate-600 mt-1">تعداد دانشجو</div>
        </div>
      </div>

      {/* نمودار توزیع */}
      <div className="space-y-3">
        <div className="text-xs font-black text-slate-700">📊 توزیع فراوانی نمرات</div>
        {gradedCount === 0 && (
          <p className="text-xs font-bold text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-xl p-4 text-center">
            هنوز داده‌ای ثبت نشده است — هیچ نمره‌ای برای این درس وارد نشده، بنابراین توزیعی برای نمایش وجود ندارد.
          </p>
        )}
        {bars.map(b => (
          <div key={b.label} className="flex items-center gap-3">
            <div className="w-24 text-2xs font-black text-slate-600">{b.label} <span className="text-slate-400 font-bold">({b.range})</span></div>
            <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
              <div
                className={`h-full ${b.color} rounded-full transition-all duration-500`}
                style={{ width: `${Math.min(100, (b.count / total) * 100)}%` }}
              />
            </div>
            <div className="w-10 text-center text-xs font-black text-slate-800">{faNum(b.count)}</div>
          </div>
        ))}
      </div>

      <p className="text-3xs text-slate-400 font-bold leading-5">
        💡 تحلیل فوق به‌صورت زنده از آخرین نمرات محاسبه می‌شود؛ پس از قفل قطعی درس، این آمار برای نیمسال بایگانی می‌گردد.
      </p>
    </div>
  );
}

'use client';

/**
 * RubricTab — تنظیمات بارم‌بندی (سهم‌بندی آزمون‌ها و تکالیف)
 *
 * تمام منطق (کلمپ دانشجویان به بارم جدید، الگوهای آماده) در gradesReducer و
 * grades-core است؛ این کامپوننت فقط رویدادها را dispatch می‌کند.
 */
import type { GradingCourseOffering, RubricField, RubricPreset } from '../types';
import { faNum } from '../types';
import type { GradesDispatch } from '../gradesReducer';
import { flashToast } from '../gradesReducer';
import { RUBRIC_PRESETS, isRubricValid, totalRubricOf } from '../grades-core';

interface RubricTabProps {
  offering: GradingCourseOffering;
  dispatch: GradesDispatch;
}

const PRESET_LABEL: Record<RubricPreset, string> = {
  STANDARD_THEORY: '📘 نظری استاندارد',
  BALANCED: '⚖️ متعادل',
  PRACTICAL_HEAVY: '🔬 عملی‌محور',
  FINAL_HEAVY: '🏁 پایان‌ترم‌محور',
};

const FIELDS: { key: RubricField; label: string; hint: string }[] = [
  { key: 'midterm', label: 'میان‌ترم', hint: 'آزمون میان‌ترم' },
  { key: 'homework', label: 'تکالیف و تمرین', hint: 'تمرین‌های کلاسی و خانگی' },
  { key: 'participation', label: 'حضور و فعالیت', hint: 'حضور فعال در کلاس' },
  { key: 'practical', label: 'بخش عملی', hint: 'کارگاه و آزمایشگاه' },
  { key: 'finalExam', label: 'پایان‌ترم', hint: 'آزمون پایان‌ترم' },
];

export default function RubricTab({ offering, dispatch }: RubricTabProps) {
  const total = totalRubricOf(offering.rubric);
  const valid = isRubricValid(offering.rubric);
  const locked = !!offering.isFinalized;

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 space-y-5 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h3 className="font-black text-slate-900 text-base">
            تنظیم و بارم‌بندی سهم آزمون‌ها و تکالیف درس {offering.title}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            مجموع بارم باید دقیقاً ۲۰ باشد. با تغییر بارم، سقف نمرات دانشجویان به‌صورت خودکار تنظیم می‌گردد.
          </p>
        </div>
        <span className={`px-3 py-1.5 rounded-xl font-black text-xs ${valid ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
          مجموع بارم: {faNum(total)} از ۲۰ {valid ? '✓' : '✗'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(RUBRIC_PRESETS) as RubricPreset[]).map(preset => (
          <button
            key={preset}
            onClick={() => {
              dispatch({ type: 'APPLY_RUBRIC_PRESET', payload: preset });
              flashToast(dispatch, 'الگوی بارم‌بندی با مجموع ۲۰ اعمال شد و سقف نمرات دانشجویان بر اساس بارم تنظیم گردید.');
            }}
            disabled={locked}
            className="px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 text-indigo-900 border border-indigo-200 font-bold text-xs transition"
          >
            {PRESET_LABEL[preset]}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {FIELDS.map(f => (
          <div key={f.key} className="flex items-center justify-between gap-4 p-3 bg-slate-50 rounded-2xl border border-slate-200">
            <div>
              <div className="font-black text-slate-900 text-xs">{f.label}</div>
              <div className="text-3xs text-slate-500 font-bold">{f.hint}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-3xs text-slate-400 font-bold">سهم از ۲۰:</span>
              <input
                type="number"
                min={0}
                max={20}
                disabled={locked}
                value={offering.rubric[f.key]}
                onChange={e => dispatch({
                  type: 'UPDATE_RUBRIC_FIELD',
                  payload: { field: f.key, value: Number(e.target.value) },
                })}
                className="w-20 border-2 border-indigo-200 rounded-xl p-2 text-center font-black text-indigo-950 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>
          </div>
        ))}
      </div>

      {!valid && (
        <p className="text-2xs font-black text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3">
          ⚠ مجموع بارم‌بندی برابر {faNum(total)} است و باید دقیقاً ۲۰ باشد. تا قبل از اصلاح، امکان «ثبت موقت» و «قفل قطعی» وجود ندارد.
        </p>
      )}
    </div>
  );
}

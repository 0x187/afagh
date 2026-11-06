'use client';

// کارت «سهم واحد هر نوع درس» — یک نسخهٔ مشترک برای دو تب:
//   • تعریف کاتالوگ رشته (تب ۱): هنگام تعریف/ویرایش نسخه، انواعِ همین رشته را می‌سازید
//   • بررسی و خاتمه (تب ۴): همان مقادیر در کنار یافته‌های اعتبارسنجی دیده می‌شوند
// هر دو کارت به یک state سرور (minRoleUnits نسخه) می‌نویسند؛ فقط یکی در هر لحظه رندر می‌شود.
import { useCurriculum } from '../curriculum-context';
import { faNum } from '../curriculum-core';
import RoleTargetsEditor from './RoleTargetsEditor';

export default function RoleTargetsCard({ showHint = true }: { showHint?: boolean }) {
  const {
    busy,
    detail,
    handleSaveRoleTargets,
    isDraft,
    roleTargets,
    roleTargetsKey,
    unitsByRole,
    countsByRole,
  } = useCurriculum();

  if (!detail) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-extrabold text-slate-900 text-sm">🎯 سهم واحد هر نوع درس (مقرر این نسخه)</h4>
        <span className="text-3xs font-bold text-slate-400">
          {Object.keys(roleTargets ?? {}).length} نوع تعیین‌شده
        </span>
      </div>
      {showHint && (
        <p className="text-2xs text-slate-500 font-bold leading-relaxed">
          برای هر نوع درسی که این رشته دارد، یک ردیف باز کنید: اول نوع درس را انتخاب کنید، بعد تعداد واحد لازم را بنویسید.
          انواعی که اضافه نکنید «مقرر» محسوب نمی‌شوند؛ مثلاً رشته‌ای که درس عمومی یا جبرانی ندارد، لازم نیست ردیف آن را بسازد.
          جمع سهم‌ها معمولاً باید با «واحد الزامی» نسخه ({faNum(detail.version.totalRequiredUnits)} واحد) بخواند.
          ولیدیتور در چک ROLE_UNITS_COVERAGE هر سهم را با واحد موجود می‌سنجد.
        </p>
      )}
      <RoleTargetsEditor
        key={roleTargetsKey}
        initial={roleTargets}
        unitsByRole={unitsByRole}
        countsByRole={countsByRole}
        totalRequired={Number(detail.version.totalRequiredUnits ?? 0)}
        disabled={!isDraft || busy}
        onSave={handleSaveRoleTargets}
      />
    </div>
  );
}

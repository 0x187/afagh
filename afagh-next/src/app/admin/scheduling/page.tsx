import { requireRole } from '@/lib/auth';
import { getSchedulingWorkspaceLightAction } from './actions';
import DepartmentPlanningClient from './DepartmentPlanningClient';
import { getTimeSlots } from '@/lib/schedule-config';

export const dynamic = 'force-dynamic';

export default async function DepartmentPlanningPage({
  searchParams,
}: {
  /** ?tab=SCENARIOS → تب آغازین (اعتبارسنجی با resolveTab در هسته انجام می‌شود) */
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);

  // دامنهٔ دانشگاه فقط سمت سرور تعیین می‌شود (نیازی به پاس‌دادن نیست).
  // نسخهٔ سبک: فقط اسکلت (ترم/رشته/فاز/تقویم) — لیستهای سنگین را کلاینت
  // بعد از اولین paint واکشی میکند تا RSC این صفحه ~۱٫۷MB نباشد.
  const workspace: any = await getSchedulingWorkspaceLightAction();
  if (!workspace.ok) {
    return (
      <div dir="rtl" className="min-h-screen bg-sky-50/70 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-rose-200 p-6 max-w-md text-center space-y-2">
          <div className="text-2xl">⚠️</div>
          <h2 className="font-extrabold text-slate-900">بارگذاری کارتابل برنامه‌ریزی درسی ناموفق بود</h2>
          <p className="text-xs text-slate-600 font-bold">{workspace.error}</p>
        </div>
      </div>
    );
  }
  const sp = await searchParams;
  const tab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  // همان زنگ‌هایی که استاد در «اعلام حضور» می‌بیند — منبع واحد: تنظیمات دانشگاه
  const timeSlots = await getTimeSlots();
  return <DepartmentPlanningClient initial={workspace} tab={tab} timeSlots={timeSlots} />;
}

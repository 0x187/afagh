import { requireRole } from '@/lib/auth';
import { getSchedulingWorkspaceLightAction } from '@/app/admin/scheduling/actions';
import DepartmentPlanningClient from '@/app/admin/scheduling/DepartmentPlanningClient';
import { getTimeSlots } from '@/lib/schedule-config';

export const dynamic = 'force-dynamic';

/**
 * تابلوی «برنامه‌ریزی درسی» مدیرگروه — همان تابلوی تعاملیِ ادمین
 * (`DepartmentPlanningClient`: ماتریس هفتگی، پیشنهاد هوشمند، سلامت برنامه،
 * تخصیص گروه) اما با دو تفاوتِ امنیتی که در `actions.ts` اعمال شده‌اند:
 *   ۱) دادهٔ کارتابل به دروسِ گروه‌های تحت مدیریتِ همین کاربر محدود می‌شود
 *      (`deptHeadScope` در `getSchedulingWorkspaceAction`).
 *   ۲) عملیاتِ حساسِ کل‌دانشگاهی (تولید جلسهٔ کل ترم، انتشار فاز) برای مدیرگروه
 *      با پیام روشن قفل است؛ تأمین گروه درسی فقط برای گروه خودش مجاز است.
 */
export default async function GroupSchedulingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  await requireRole(['DEP_HEAD']);

  // نسخهٔ سبک: فقط اسکلت — دامنهٔ مدیرگروه در واکشیِ کاملِ سمتِ کلاینت
  // (getSchedulingWorkspaceAction) همان‌طور که قبل اعمال می‌شود.
  const workspace: any = await getSchedulingWorkspaceLightAction();
  if (!workspace.ok) {
    return (
      <div dir="rtl" className="rounded-2xl border border-rose-200 bg-white p-6 text-center">
        <p className="text-lg font-extrabold text-rose-700">بارگذاری کارتابل برنامه‌ریزی درسی ناموفق بود</p>
        <p className="mt-2 text-xs font-bold text-slate-600">{workspace.error}</p>
      </div>
    );
  }

  const sp = await searchParams;
  const tab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const timeSlots = await getTimeSlots();
  return <DepartmentPlanningClient initial={workspace} tab={tab} timeSlots={timeSlots} scope="dept" />;
}

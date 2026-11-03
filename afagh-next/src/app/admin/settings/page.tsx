import { eq, isNull, or } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { resolveAllSettings, SETTING_GROUPS } from '@/lib/settings';
import { SECRET_MASK, type SettingView } from '@/lib/settings-shared';
import { getCurrentUniversity } from '@/lib/university-scope';
import { db } from '@/db';
import { classrooms, departments, faculties } from '@/db/schema';
import SettingsClient from './SettingsClient';
import ClassroomManager from './ClassroomManager';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  await requireRole(['ADMIN']);
  const all = await resolveAllSettings();

  // مقادیر محرمانه هرگز به مرورگر فرستاده نمی‌شوند — فقط ماسک
  const view: SettingView[] = all.map(s => ({
    key: s.key,
    env: s.env,
    group: s.group,
    label: s.label,
    type: s.type,
    help: s.help,
    envOnly: s.envOnly,
    source: s.source,
    hasEnv: s.hasEnv,
    value: s.type === 'secret' ? (s.value ? SECRET_MASK : '') : s.value,
    default: s.default,
    options: s.options,
  }));

  const uni = await getCurrentUniversity().catch(() => null);
  const rooms = uni
    ? await db.select().from(classrooms).where(eq(classrooms.universityId, uni.id)).orderBy(classrooms.name)
    : [];
  /**
   * دانشکده‌های همان دانشگاهِ فعال (سوییچ دانشگاه).
   *
   * چرا «دانشکده» و نه «ساختمان»؟ ساختمان در سامانه تعریف ندارد و ورودیِ آزاد
   * بود؛ نتیجه اینکه هر کس یک نام می‌نوشت («ساختمان ۲»، «ابوریحان»، «۲»…) و
   * داده قابل گزارش‌گیری نبود. دانشکده موجودیتِ واقعیِ سامانه است و با سوییچ
   * دانشگاه هم‌تراز می‌ماند. ستون `buildingName` در دیتابیس دست‌نخورده می‌ماند
   * (دادهٔ قبلی حذف نمی‌شود)، ولی از این پس نوشته نمی‌شود.
   */
  const facultiesOfUni = uni
    ? await db
        .select({ id: faculties.id, name: faculties.name })
        .from(faculties)
        .where(eq(faculties.universityId, uni.id))
        .orderBy(faculties.name)
    : [];

  /**
   * گروه‌های آموزشی همین دانشگاه (+ ردیف‌های عمومی با `universityId = NULL`).
   *
   * برای ستون «گروه مسئول» در جدول کلاس‌ها: بعضی سالن‌ها به یک گروه مشخص تعلق
   * دارند، نه به کل دانشکده — مثل باشگاه‌ها و استخر که مال «گروه مشترک تربیت
   * بدنی» هستند. بدون این ستون، موتور تخصیص سهمیهٔ باشگاه را به گروه‌های دیگر
   * می‌داد.
   */
  const departmentsOfUni = uni
    ? await db
        .select({ id: departments.id, name: departments.name, code: departments.departmentCode })
        .from(departments)
        .where(or(eq(departments.universityId, uni.id), isNull(departments.universityId)))
        .orderBy(departments.name)
    : [];

  return (
    <div className="space-y-8">
      {/*
        پنل «داده‌های پایه» به‌عنوان تبِ مستقل به SettingsClient پاس داده می‌شود.
        پیش‌تر به‌شکل `<details open>` زیرِ کل صفحه بود؛ با هر کلیک روی تب‌های
        پیکربندی باز می‌ماند و کاربر گمان می‌کرد دکمه‌ها به مدیریت کلاس‌ها
        می‌روند. حالا فقط با انتخاب همان دکمه دیده می‌شود.
      */}
      <SettingsClient
        settings={view}
        groups={[...SETTING_GROUPS]}
        baseData={
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <h2 className="text-lg font-extrabold text-slate-800">داده‌های پایه (رکوردها)</h2>
              <p className="text-xs text-slate-500 mt-1">
                افزودن/ویرایش کلاس‌ها و دیگر موجودیت‌ها — مختص دانشگاه «{uni?.title ?? '—'}».
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
              {/* موجودیت‌های دیگر (دانشکده‌ها، رشته‌ها، ترم‌ها و…) در ادامه اینجا اضافه می‌شوند. */}
              <ClassroomManager rooms={rooms} faculties={facultiesOfUni} departments={departmentsOfUni} />
            </div>
          </div>
        }
      />
    </div>
  );
}

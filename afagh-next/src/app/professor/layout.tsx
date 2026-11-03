import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { departments, users, universities } from '@/db/schema';
import { getStaffByUser, requireRole, endCurrentSession } from '@/lib/auth';
import { headedDepartments } from '@/lib/group-manager';
import { getSiblingAccounts } from '@/lib/account-switch';
import PanelSwitcher from '@/components/PanelSwitcher';
import { ADMIN_PANEL_ROLES } from '@/lib/panel-links';
import SessionLock from '@/components/SessionLock';
import TermSwitcher from '@/components/TermSwitcher';
import HeaderActions from '@/components/HeaderActions';
import UserAvatar from '@/components/UserAvatar';
import BackToDashboard from '@/components/BackToDashboard';
import ProfessorNav from './ProfessorNav';
import { professorTermFilter } from '@/lib/professor-term-filter';
import { getSetting } from '@/lib/settings';

const faNum = (n: any) => (n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

export default async function ProfessorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(['PROFESSOR']);
  const me = await getStaffByUser(user.id);
  // عکس پرسنلی استاد (برای آواتار هدر) — کلید شیء، نمایش از مسیر امن
  const [photoRow] = await db.select({ photoKey: users.photoKey }).from(users).where(eq(users.id, user.id)).limit(1);

  // نام گروه آموزشی واقعی
  let deptName = '—';
  if (me?.departmentId) {
    const [d] = await db.select({ name: departments.name }).from(departments).where(eq(departments.id, me.departmentId)).limit(1);
    if (d) deptName = d.name;
  }

  // ── ادغام کارتابل استاد و مدیر گروه ──
  // استادی که مدیر یک یا چند گروه است نباید دو حساب/دو ورود جدا داشته باشد؛
  // پنل گروه از همین‌جا یک کلیک فاصله دارد. نام گروه‌ها را هم نشان می‌دهیم تا
  // مدیرِ «دروس عمومی» بداند سرپرستی کدام گروه با اوست.
  const headed = user.roles.includes('DEP_HEAD') && me ? await headedDepartments(me.id, me.departmentId ?? null) : [];

  // نقش‌های ستادی/کارشناسی (کارشناس مالی، آموزش، …) هم باید از همین‌جا لینک
  // داشبورد مدیریت را ببینند — پیش‌تر استادِ چندنقشی هیچ راهی به /admin نداشت.
  // برای نقش‌های سفارشی (RBAC) هم اگر مجوز واقعی داشته باشد لینک ساخته می‌شود.
  const alreadyAdmin = user.roles.some(r => (ADMIN_PANEL_ROLES as readonly string[]).includes(r));
  let permissionCount = 0;
  if (!alreadyAdmin) {
    // فقط مجوزهای «نقش سفارشی» شمرده می‌شود؛ نقش‌های سیستمی (DEP_HEAD/PROFESSOR/STUDENT)
    // مجوزهای ذاتی دارند و نباید لینک «داشبورد مدیریت» بسازند.
    const { getUserCustomPermissionCodes } = await import('@/lib/permissions-enforcer');
    permissionCount = (await getUserCustomPermissionCodes(user.id).catch(() => [])).length;
  }

  // حساب‌های هم‌شخص (کد پرسنلی/دانشجویی دیگرِ همین کدملی) برای بنر جابه‌جایی
  const siblings = await getSiblingAccounts().catch(() => []);

  // قفل خودکار بیکاری — سرور-محور (مدت به تفکیک نقش؛ ۰ = غیرفعال).
  // منبع حقیقت «زمان آخرین فعالیت» است؛ پس رفرش قفل را دور نمی‌زند و کاربرِ در حال کار بیرون نمی‌افتد.
  const { evaluateIdleLock, resolveIdleTimeoutMinutes, idleMinutes, resolveReauthMinutes } = await import('@/lib/session-lock');
  const lockMin = await resolveIdleTimeoutMinutes(user.roles).catch(() => 15);
  // غیبت طولانی (بیش از SESSION_REAUTH_MINUTES) → نشست همین دستگاه بسته شود و
  // کاربر به صفحهٔ ورود برود؛ نه قفل روی صفحهٔ کهنهٔ چند ساعت پیش.
  if (lockMin > 0) {
    const reauthMin = await resolveReauthMinutes(lockMin).catch(() => 0);
    const away = reauthMin > 0 ? await idleMinutes(user.id).catch(() => null) : null;
    if (away != null && away >= reauthMin) {
      await endCurrentSession().catch(() => {});
      redirect('/login?expired=1');
    }
  }
  const lockOn = await evaluateIdleLock(user.id, lockMin).catch(() => false);

  // استاد به یک دانشگاه تعلق دارد؛ فیلتر نیمسال فقط با همان دانشگاه اعتبارسنجی می‌شود
  const universityId = me?.universityId ?? null;
  // فقط فهرست نیمسال‌ها برای سوییچر سربرگ لازم است. آمار چهارگانه (کلاس‌ها،
  // ساعات حضور، قرارداد، مهلت نمرات) به داشبورد منتقل شده؛ پس کوئری‌های سنگین
  // آن‌ها از مسیر هر بار بارگذاریِ سربرگ حذف شدند.
  const termFilter = await professorTermFilter(universityId);
  const termScope = { terms: termFilter.terms, selectedId: termFilter.selectedTerm?.id ?? null };

  const uniRow = universityId
    ? await db.select({ title: universities.title, logoUrl: universities.logoUrl }).from(universities).where(eq(universities.id, universityId)).limit(1)
    : [];
  const universityLogoUrl = uniRow?.[0]?.logoUrl || (await getSetting('UNIVERSITY_LOGO').catch(() => '')) || null;

  return (
    <div className="min-h-screen bg-slate-50 print:!bg-white" dir="rtl">
      <header className="print:hidden bg-slate-900 text-white shadow-md border-b border-slate-800 sticky top-0 z-40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 p-4">
          {/* تک‌ردیفه مثل پنل مدیر: ارم + هویت + همهٔ ابزارها (نیمسال/نقش/راهنما/خروج) */}
          <div className="flex flex-wrap items-center gap-2 min-w-0 w-full">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {/* ارم دانشگاه جای حرف ثابت «آفاق» — اگر ارمی ثبت نشده باشد،
                  همان حرف به‌عنوان fallback نمایش داده می‌شود */}
              {universityLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={universityLogoUrl}
                  alt="نشان دانشگاه"
                  className="w-9 h-9 rounded-xl bg-white object-contain p-0.5 shadow shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-black text-sm text-white shadow shrink-0">
                  آفاق
                </div>
              )}
              <UserAvatar userId={user.id} hasPhoto={!!photoRow?.photoKey} name={user.name} className="w-9 h-9 shrink-0" fallbackClass="bg-indigo-500" />
              <div className="min-w-0">
                {/* متن خوش‌آمدگویی = لینک بازگشت به کارتابل استاد.
                    کاربر گفت «در کارتابل استاد در هدر نوشته‌ای که روش می‌زدیم و
                    به کارتابل برمی‌گشتیم نیست» — در پنل مدیر این عنوان لینک بود
                    ولی اینجا متن ساده بود و راهی به /professor نداشت. */}
                <Link href="/professor" title="بازگشت به کارتابل استاد" className="block hover:opacity-90 transition-opacity">
                  <p className="font-extrabold text-sm sm:text-base truncate">
                    {/* در موبایل سلامِ کوتاه‌تر تا نام استاد کامل دیده شود */}
                    <span className="sm:hidden">استاد {user.name}</span>
                    <span className="hidden sm:inline">خوش آمدید، استاد گرامی {user.name}</span>
                  </p>
                </Link>
                <p className="text-xs text-slate-400 truncate">
                  کد پرسنلی: {me ? faNum(me.staffCode) : '—'}
                  {me?.academicRank ? ` · مرتبه علمی: ${me.academicRank}` : ''}
                  {` · گروه: ${deptName}`}
                </p>
              </div>
            </div>
            {/* یک ارتفاع و یک تراز برای همهٔ کنترل‌ها (`.hdr-controls` در globals.css) */}
            <div className="hdr-controls flex flex-wrap items-center gap-2 shrink-0">
              <TermSwitcher
                terms={termScope.terms}
                selectedId={termScope.selectedId}
              />
              <PanelSwitcher
                roles={user.roles}
                current="professor"
                permissionCount={permissionCount}
                siblings={siblings}
                groupTitle={
                  headed.length === 1
                    ? headed[0].name
                    : headed.length > 1
                      ? `${headed.length.toLocaleString('fa-IR')} گروه`
                      : undefined
                }
              />
              {/* ابزارهای یکسان با بقیهٔ کارتابل‌ها — از `HeaderActions`.
                  (پیش‌تر هر کارتابل اندازه/آیکون/برچسب خودش را داشت.) */}
              <HeaderActions helpHref="/help/professor" pdfHref="/help/pdfs/professor.pdf" />
            </div>
          </div>

          {/* ⓘ کاشی‌های چهارگانهٔ وضعیت از اینجا حذف شدند: در موبایل دو ردیف
              کامل از سربرگ را می‌بلعیدند و کاربر مجبور بود برای دیدن محتوا
              اسکرول کند. همان چهار عدد حالا در داشبورد (/professor) به شکل
              یک نوارِ چهارکاشیِ فشرده نمایش داده می‌شوند — جای طبیعی آمار. */}

        </div>

      </header>

      <main id="main" className="mx-auto w-full max-w-6xl min-w-0 overflow-x-hidden p-4 sm:p-6 pb-24 md:pb-6">
        {/* دکمهٔ بازگشت به کارتابل استاد — روی همهٔ زیرصفحه‌ها (نه خودِ /professor)
            رنگ از `lib/back-button.ts` می‌آید تا با بقیهٔ پنل‌ها یکی بماند. */}
        <BackToDashboard href="/professor" label="بازگشت به کارتابل استاد" />
        {children}
      </main>
      <ProfessorNav />
      <SessionLock name={user.name} timeoutMin={lockMin} initialLocked={lockOn} />
    </div>
  );
}

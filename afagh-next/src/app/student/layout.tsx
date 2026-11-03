import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, universities, degree_level_configs } from '@/db/schema';
import { getStudentByUser, requireRole, endCurrentSession } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { studentDebtRials } from '@/lib/verification';
import { alumniOf } from '@/lib/alumni';
import { getSiblingAccounts } from '@/lib/account-switch';
import PanelSwitcher from '@/components/PanelSwitcher';
import { ADMIN_PANEL_ROLES } from '@/lib/panel-links';
import SessionLock from '@/components/SessionLock';
import TermSwitcher from '@/components/TermSwitcher';
import { getTermScope, termOrdinalForEntry } from '@/lib/term-scope';
import { isDemoStudentUser } from '@/lib/demo-accounts';
import { DEMO_STUDENT } from '@/lib/demo-student-data';
import HeaderActions from '@/components/HeaderActions';
import StudentNav, { StudentSidebar } from './StudentNav';
import UserAvatar from '@/components/UserAvatar';
import BackToDashboard from '@/components/BackToDashboard';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(['STUDENT']);

  // پس از صدور مدرک، حساب کاربر از پورتال دانشجویی به پورتال دانش‌آموختگان منتقل می‌شود
  if (await alumniOf(user.id)) redirect('/alumni');

  const me = await getStudentByUser(user.id);
  // عکس پرسنلی کاربر (آواتار هدر) + جنسیت (چیپ نظام وظیفه فقط برای مردان)
  const [userRow] = await db
    .select({ photoKey: users.photoKey, gender: users.gender })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  // ── داده‌های سربرگ ادغام‌شده ───────────────────────────────────────────────
  // پیش از این، خوش‌آمدگویی/رشته/وضعیت مالی/ترم در یک کارت سبز جداگانه زیر هدر
  // («هیرو») نمایش داده می‌شد و با خود هدر تکرار می‌شد. حالا همه در یک بلوک
  // سبز بالای صفحه جمع شده‌اند و کارت جداگانه‌ای وجود ندارد.
  const [uniRow, levelRow] = await Promise.all([
    me?.universityId
      ? db.select({ title: universities.title, logoUrl: universities.logoUrl }).from(universities).where(eq(universities.id, me.universityId)).limit(1)
      : Promise.resolve([]),
    me?.degreeLevelId
      ? db.select({ title: degree_level_configs.title }).from(degree_level_configs).where(eq(degree_level_configs.id, me.degreeLevelId)).limit(1)
      : Promise.resolve([]),
  ]);
  const universityLogoUrl = uniRow?.[0]?.logoUrl || (await getSetting('UNIVERSITY_LOGO').catch(() => '')) || null;
  // رشته (major) عمداً خوانده/نمایش داده نمی‌شود؛ در هدر موبایل فقط نام و مقطع کافی است.
  const levelTitle = levelRow?.[0]?.title ?? null;

  // وضعیت مالی — یک کوئری سبک روی دفتر تراکنش (همان محاسبهٔ بدهی کارت آزمون)
  const debtRials = me ? await studentDebtRials(me.id).catch(() => null) : null;
  const financialLabel =
    debtRials == null
      ? 'نامشخص'
      : debtRials === 0
        ? 'تسویه کامل (تراز ۰ ریال)'
        : `بدهی ${debtRials.toLocaleString('fa-IR')} ریال`;

  const termScope = await getTermScope(me?.universityId ?? null);
  const demo = await isDemoStudentUser(user.id);
  const sidebarStudentCode = demo ? DEMO_STUDENT.studentCode : me?.studentCode ?? null;

  // شمارهٔ «ترم» هدر = وضعیتِ تحصیلیِ فعلیِ دانشجو، نه ترمِ در حال مرور.
  // پیش‌تر از «ترمِ انتخاب‌شده» حساب می‌شد؛ با مرورِ یک نیمسال قدیمی‌تر شماره
  // اشتباهاً کم می‌شد (مثلاً ترم ۴ → ترم ۲). حالا همیشه از «ترمِ جاریِ مؤثر»
  // محاسبه می‌شود و سوییچر نیمسال فقط فهرست‌ها را فیلتر می‌کند.
  const currentTermForOrdinal =
    termScope.terms.find(t => t.id === termScope.effectiveId) ??
    termScope.terms.find(t => t.isEffectiveCurrent) ??
    null;
  const studentTermOrdinal = currentTermForOrdinal && me
    ? termOrdinalForEntry({
        entryYear: me.entryYear,
        entryTerm: me.entryTerm,
        terms: [],
        targetTermCode: currentTermForOrdinal.termCode,
      })
    : null;

  const firstName = (user.name || '').trim().split(/\s+/)[0] || 'دانشجو';

  // حساب‌های هم‌شخص (شماره دانشجویی/کد پرسنلی دیگرِ همین کدملی) برای سوییچر بالای صفحه
  const siblings = await getSiblingAccounts().catch(() => []);

  // دانشجو معمولاً یک نقش دارد؛ فقط وقتی نقش/مجوز دیگری هم دارد سراغ RBAC می‌رویم
  // تا یک کوئری اضافه به هر بارگذاری پنل دانشجو تحمیل نشود.
  const hasStaffRole = user.roles.some(r => r !== 'STUDENT');
  const alreadyAdmin = user.roles.some(r => (ADMIN_PANEL_ROLES as readonly string[]).includes(r));
  let permissionCount = 0;
  if (hasStaffRole && !alreadyAdmin) {
    // فقط مجوزهای «نقش سفارشی» شمرده می‌شود؛ نقش‌های سیستمی (DEP_HEAD/PROFESSOR/STUDENT)
    // مجوزهای ذاتی دارند و نباید لینک «داشبورد مدیریت» بسازند.
    const { getUserCustomPermissionCodes } = await import('@/lib/permissions-enforcer');
    permissionCount = (await getUserCustomPermissionCodes(user.id).catch(() => [])).length;
  }

  // قفل خودکار بیکاری — سرور-محور (مدت به تفکیک نقش؛ ۰ = غیرفعال).
  // منبع حقیقت «زمان آخرین فعالیت» است؛ پس رفرش قفل را دور نمی‌زند و کاربرِ در حال کار بیرون نمی‌افتد.
  const { evaluateIdleLock, resolveIdleTimeoutMinutes, idleMinutes, resolveReauthMinutes } = await import('@/lib/session-lock');
  const lockMin = await resolveIdleTimeoutMinutes(user.roles).catch(() => 15);
  // غیبت طولانی → پایان نشست همین دستگاه و هدایت به صفحهٔ ورود
  if (lockMin > 0) {
    const reauthMin = await resolveReauthMinutes(lockMin).catch(() => 0);
    const away = reauthMin > 0 ? await idleMinutes(user.id).catch(() => null) : null;
    if (away != null && away >= reauthMin) {
      await endCurrentSession().catch(() => {});
      redirect('/login?expired=1');
    }
  }
  const lockOn = await evaluateIdleLock(user.id, lockMin).catch(() => false);

  return (
    <div className="app-page min-h-screen bg-slate-100 print:!bg-white flex flex-col" dir="rtl">
      {/* هدر دانشجو — طراحی دو‌ردیفه و پایدار در موبایل:
          ردیف ۱: نشان دانشگاه + آواتار + خوش‌آمدگویی (فقط نام) + دکمه‌های راهنما/تم/خروج
          ردیف ۲: چیپ‌های وضعیت (مالی/سخا/ترم) + سوییچر ترم/کارتابل
          رشته (major) عمداً حذف شد تا خط هویت در موبایل سرریز/بریده نشود. */}
      <header className="app-header bg-emerald-800 text-white print:hidden sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex flex-col gap-2 px-3 sm:px-4 py-2.5">

          {/* ردیف ۱ — هویت و دکمه‌ها */}
          <div className="flex items-center gap-2 min-w-0">
            {universityLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={universityLogoUrl}
                alt="نشان دانشگاه"
                className="w-8 h-8 rounded-lg bg-white object-contain p-0.5 shadow-inner shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center font-bold text-base shadow-inner shrink-0">
                آ
              </div>
            )}
            <UserAvatar userId={user.id} hasPhoto={!!userRow?.photoKey} name={user.name} className="w-8 h-8 shrink-0" fallbackClass="bg-emerald-700" />

            {/* خوش‌آمدگویی — رشته حذف شد؛ مقطع/ورودی فقط در دسکتاپ به‌صورت زیرنویس */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs sm:text-sm font-extrabold leading-tight">
                خوش‌آمدی {firstName} عزیز 👋
              </p>
              {(levelTitle || me?.entryYear) && (
                <p className="hidden sm:block truncate text-3xs font-bold text-emerald-200 leading-tight">
                  {levelTitle || '—'} · ورودی {me?.entryYear ?? '—'}
                </p>
              )}
            </div>

            {/* دکمه‌های راهنما/تم/خروج — از کامپوننت مشترک `HeaderActions`
                (هم‌اندازه و هم‌آیکون با کارتابل مدیریت و استاد). */}
            <div className="flex items-center gap-1.5 shrink-0">
              <HeaderActions helpHref="/help/student" pdfHref="/help/pdfs/student.pdf" />
            </div>
          </div>

          {/* ردیف ۲ — چیپ‌های وضعیت + سوییچرها */}
          <div className="flex flex-wrap items-center gap-1.5 text-3xs sm:text-2xs min-w-0">
            {/* چیپ مالی «کشسان» است: در موبایل فضای باقی‌مانده را پر می‌کند و متنش
                کوتاه می‌شود تا سوییچر ترم همیشه در همین ردیف بماند (هدر سه‌ردیفه نشود). */}
            <span
              title={financialLabel}
              className="inline-flex min-w-0 flex-1 md:flex-none items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-400/30 px-1.5 py-0.5 font-bold text-emerald-100"
            >
              <span className="shrink-0">💳 مالی:</span>
              <b className="min-w-0 truncate font-black text-white">{financialLabel}</b>
            </span>
            {/* نظام وظیفه فقط برای دانشجویان مرد معنادار است (بانوان معف‌اند) */}
            {userRow?.gender !== 'FEMALE' && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-teal-500/20 border border-teal-400/30 px-1.5 py-0.5 font-bold text-teal-100">
                <span>🪖 سخا:</span>
                <b className="font-black text-white">{me?.militaryStatus || 'ثبت نشده'}</b>
              </span>
            )}
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-indigo-500/20 border border-indigo-400/30 px-1.5 py-0.5 font-bold text-indigo-100">
              <span>🎓 ترم:</span>
              <b className="font-black text-white">
                {(studentTermOrdinal ?? me?.currentTermNo ?? 0).toLocaleString('fa-IR')}
              </b>
            </span>

            {/* سوییچر ترم و کارتابل — `relative` برای باز شدن پنل کشویی موبایل در همین ردیف */}
            <div className="relative flex items-center gap-1.5 ms-auto shrink-0">
              <TermSwitcher
                terms={termScope.terms}
                selectedId={termScope.selectedId}
              />
              {/* سوییچ به کارتابل استاد/مدیر گروه/ستادی و سایر حساب‌های هم‌کدملی
                  از همین سوییچر واحد انجام می‌شود. */}
              <PanelSwitcher
                roles={user.roles}
                current="student"
                permissionCount={permissionCount}
                siblings={siblings}
              />
            </div>
          </div>
        </div>
      </header>

      {/* بدنه دو ستونه دسکتاپ: سایدبار سمت راست + محتوای اصلی */}
      <div className="flex-1 max-w-7xl w-full mx-auto flex flex-col md:flex-row">
        {/* سایدبار عمودی سمت راست (دسکتاپ) */}
        <StudentSidebar user={{ name: user.name, studentCode: sidebarStudentCode }} />

        {/* محتوای اصلی صفحه */}
        <main id="main" className="flex-1 min-w-0 overflow-x-hidden print:!overflow-visible print:!px-0 print:!pb-2 p-3 sm:p-5 md:p-6 pb-24 md:pb-8">
          {/* دکمهٔ بازگشت به کارتابل دانشجو — روی همهٔ زیرصفحه‌ها (نه خودِ /student).
              در موبایل مفیدتر است: سایدبار پنهان است و تنها راه قبلی نوار پایین بود. */}
          <BackToDashboard href="/student" label="بازگشت به کارتابل دانشجو" />
          {children}
        </main>
      </div>

      {/* نوار ناوبری پایین فقط برای موبایل */}
      <StudentNav />
      <SessionLock name={user.name} timeoutMin={lockMin} initialLocked={lockOn} />
    </div>
  );
}

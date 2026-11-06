/**
 * استایل مشترکِ دکمهٔ «بازگشت» — یک نقطهٔ حقیقت تا رنگش در پنل‌ها از هم جدا نشود.
 *
 * چرا ماژول جدا؟ دکمه در سه جای مختلف رندر می‌شود (`BackToDashboard` برای
 * پنل استاد/دانشجو/مدیر گروه، `AdminBackBar` برای شاخهٔ مدیریت، و
 * `professor/layout` که کلاس دلخواه می‌داد). پیش‌تر هر کدام رشتهٔ خودش را
 * داشت و رنگ‌ها بی‌سر‌و‌صدا واگرا می‌شدند.
 *
 * 🎨 رنگ: کهربایی (amber). دلیل انتخاب:
 *   • آبی/نیلی/زمردی در این سامانه رزرو شده‌اند برای اکشن اصلی و هدرِ هر
 *     دانشگاه؛ دکمهٔ بازگشت نباید با CTA اصلی رقابت کند.
 *   • کهربایی روی پس‌زمینهٔ روشنِ صفحات (`bg-sky-50/70`) کنتراست کافی دارد و
 *     معنای «برگرد» را بدون جیغ‌زدن می‌رساند.
 *   • در تم تاریک هم نسخهٔ کم‌نور دارد تا سفیدِ تخت چشم را نزند.
 */
export const BACK_BTN_CLASS =
  'inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-2xs font-bold text-amber-900 shadow-xs transition hover:border-amber-400 hover:bg-amber-100 hover:text-amber-950 dark:border-amber-600/60 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-900/60';

/** میان‌برِ کنارِ دکمهٔ بازگشت (داشبورد کل) — هم‌خانوادهٔ کهربایی ولی کم‌رنگ‌تر */
export const BACK_HOME_CLASS =
  'inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50/50 px-2 py-1 text-2xs font-medium text-amber-700/80 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300/80 dark:hover:bg-amber-900/40';

import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import Icon from '@/components/ui/Icon';
import { logoutAction } from '@/app/login/actions';
import type { UniTheme } from '@/lib/university-theme';

/**
 * خوشهٔ ابزارهای هدر — «راهنما / PDF / تم / خروج» در **یک** کامپوننت.
 *
 * چرا: سه کارتابل (مدیریت/استاد/دانشجو) هرکدام این چهار دکمه را با اندازه،
 * رنگ، آیکون (اموجی) و برچسب متفاوت دستی نوشته بودند؛ کاربری که بین کارتابل‌ها
 * جابه‌جا می‌شود با سه زبان بصری روبه‌رو می‌شد. اینجا یک منبع حقیقت است:
 *  • ارتفاع/شعاع/فونت یکسان (`h-8`, `rounded-lg`, `text-xs`)
 *  • آیکون SVG به‌جای اموجی (هم‌تراز با متن فارسی)
 *  • دکمهٔ «خروج» با متن کوتاه در موبایل و کامل در دسکتاپ
 *
 * Server Component است (فقط `ThemeToggle` کلاینتی است) تا `logoutAction`
 * بدون لایهٔ اضافه اجرا شود.
 */
export default function HeaderActions({
  helpHref,
  pdfHref,
  theme,
}: {
  helpHref: string;
  pdfHref?: string;
  /** رنگ‌های برندِ کارتابل (از `uniThemeResolved`) */
  theme?: Pick<UniTheme, 'soft' | 'ring'>;
}) {
  const ghost = `text-xs font-medium border px-3 h-8 inline-flex items-center gap-1.5 rounded-lg transition-colors ${
    theme ? `${theme.soft} ${theme.ring} hover:opacity-90` : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200'
  }`;

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Link href={helpHref} className={`hidden sm:inline-flex ${ghost}`}>
        <Icon emoji="📖" className="h-3.5 w-3.5" />
        راهنما
      </Link>
      {pdfHref ? (
        <a href={pdfHref} download className={`hidden md:inline-flex ${ghost}`}>
          <Icon emoji="📕" className="h-3.5 w-3.5" />
          PDF
        </a>
      ) : null}
      <ThemeToggle />
      <form action={logoutAction} className="shrink-0">
        <button
          type="submit"
          className="inline-flex h-8 items-center rounded-lg bg-rose-600 px-3 text-xs font-bold text-white transition-colors hover:bg-rose-500"
        >
          <span className="sm:hidden">خروج</span>
          <span className="hidden sm:inline">خروج از سامانه</span>
        </button>
      </form>
    </div>
  );
}

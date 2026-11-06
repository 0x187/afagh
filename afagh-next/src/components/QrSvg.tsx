/**
 * رندر امنِ QR — تنها نقطهٔ مجازِ درجِ HTML خام برای QR در کل پروژه.
 *
 * چرا: پیش‌تر ۶ نقطه (`VerifyQrBlock`, `FinanceVerifyBlock`, کارت دانشجویی،
 * کارت ورود به جلسه، تأیید مدرک، تأیید ثبت‌نام) هرکدام مستقیماً
 * `dangerouslySetInnerHTML` می‌زدند. منبعِ امروزِ این رشتهٔ SVG سرور و کتابخانهٔ
 * `qrcode` است (ورودیِ کاربر نیست)، اما تکرارِ ۶ نقطه‌ایِ درجِ HTML خام یعنی
 * فردا با یک تغییر کوچک (مثلاً QR از منبع دیگر) سوراخ امنیتی باز می‌شود.
 *
 * این کامپوننت پیش از درج، شکلِ محتوا را اعتبارسنجی می‌کند:
 *   ① رشته باید با `<svg` شروع و با `</svg>` تمام شود (بدون HTML اطراف)
 *   ② هیچ `<script>` / `<foreignObject>` / صفتِ رویداد (`on*=`) / `javascript:`
 *      در آن نباشد
 * اگر اعتبارسنجی رد شود، چیزی رندر نمی‌شود (fail-closed) و نه خطا پرتاب می‌شود
 * — سند چاپی نباید به‌خاطر یک QR خراب کل صفحه را از دست بدهد.
 *
 * کامپوننت عمداً بدون hook و بدون 'use client' است تا هم در Server Component
 * و هم در Client Component قابل استفاده باشد.
 */

type Props = {
  /** رشتهٔ SVG خروجی `qrSvg()`؛ خالی/نامعتبر ⇒ هیچ‌چیز رندر نمی‌شود */
  svg?: string | null;
  /** کلاس‌های جعبهٔ نگه‌دارنده (همان `[&>svg]:...` قبلی روی همین می‌نشیند) */
  className?: string;
};

/** الگوهای ممنوعه در یک SVG بی‌خطر */
const FORBIDDEN = /<script|<foreignObject|\son[a-z]+\s*=|javascript:/i;

/** آیا این رشته یک SVG خالص و بی‌خطر است؟ */
export function isSafeQrSvg(svg: string): boolean {
  const s = svg.trim();
  if (!s.startsWith('<svg') || !s.endsWith('</svg>')) return false;
  return !FORBIDDEN.test(s);
}

export default function QrSvg({ svg, className }: Props) {
  if (!svg || !isSafeQrSvg(svg)) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}

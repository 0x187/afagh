import { NextRequest, NextResponse } from 'next/server';
import { logout, SESSION_COOKIE, SESSION_COOKIE_HOST } from '@/lib/auth';
import { assertCsrf } from '@/lib/security';

export const dynamic = 'force-dynamic';

/** Location نسبی است تا پشت پروکسی/CDN هم امن بماند (الگوی /api/scope/term). */
function redirect(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

/**
 * خروج از حساب — مسیر HTTP، آیینهٔ `logoutAction`.
 *
 * چرا این مسیر وجود دارد: دکمهٔ خروجِ صفحهٔ قفل بیکاری (SessionLock) پیش‌تر فقط
 * یک Server Action بود. دو مشکل داشت:
 *   ۱) فرمش داخل فرم بازگشایی تودرتو بود و مرورگر تگِ داخلی را دور می‌ریزد
 *      (اصلاح شد — دو فرمِ خواهر).
 *   ۲) خودِ Server Action اگر پشت پروکسی/CDN به‌دلیل بررسی Origin/Host رد شود،
 *      کاربر پشت صفحهٔ قفل گیر می‌کند. دقیقاً همین دلیل باعث شده برای «بازگشایی»
 *      مسیر HTTP جدا ساخته شود (api/session/unlock)، ولی برای «خروج» ساخته
 *      نشده بود.
 *
 * این مسیر همان `logout()` را صدا می‌زند (باطل‌کردن نشست‌ها + پاک‌کردن پرچم
 * قفل) و با یک POST معمولیِ فرم کار می‌کند — بدون JS و بدون Server Action.
 */
export async function POST(req: NextRequest) {
  const csrf = assertCsrf(req);
  if (csrf) return csrf;

  // خطای احتمالی نباید کاربر را پشت صفحهٔ قفل نگه دارد
  await logout().catch(() => ({ ok: false }));

  const res = redirect('/login');
  // پاک‌سازی صریح روی پاسخ — مستقل از اینکه Next جهش‌های cookies() را ادغام کند
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(SESSION_COOKIE_HOST);
  return res;
}

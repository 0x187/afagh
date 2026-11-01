/**
 * شناسهٔ نسخهٔ بیلدِ در حال اجرا — برای تشخیص «باندل کهنه» در مرورگر.
 *
 * `NEXT_PUBLIC_BUILD_ID` هنگام بیلد inline می‌شود، پس این مقدار همان نسخه‌ای
 * است که سرور با آن بیلد شده. کلاینت مقدار خودش را دارد؛ اگر متفاوت بود یعنی
 * مرورگر روی بیلد قدیمی است و Server Actionهای صفحه در سرور وجود ندارند
 * (خطای «Failed to find Server Action» و دکمه‌های بی‌اثر).
 *
 * این مسیر در Service Worker کش نمی‌شود (قاعدهٔ `/api/` در sw.js).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return Response.json(
    { id: process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } },
  );
}

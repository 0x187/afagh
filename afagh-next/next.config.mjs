/** @type {import('next').NextConfig} */
// output: 'standalone' → خروجی خودکفا برای ایمیج Docker (سرور کوچک node server.js)
// NEXT_SKIP_TYPE_CHECK=1 → رد کردن تایپ‌چک هنگام بیلد داکر (حافظه‌بر است؛
// در توسعه و CI با «npm run typecheck» به‌طور کامل انجام می‌شود).
const skipTypeCheck = process.env.NEXT_SKIP_TYPE_CHECK === '1';

// output:'standalone' فقط برای ایمیج Docker لازم است (CMD node server.js).
// روی ویندوز/اجرای محلی باید خاموش باشد، چون «next start» با standalone
// ترکیب پشتیبانی‌نشده است و خودِ Next هشدار می‌دهد. Dockerfile این متغیر را
// در مرحلهٔ builder تنظیم می‌کند.
const standalone = process.env.AFAGH_STANDALONE === '1';

/**
 * شناسهٔ نسخهٔ بیلد — برای تشخیص «باندل کهنه» در مرورگر کاربر.
 *
 * چرا لازم است: بعد از هر deploy، تبِ بازِ کاربر با باندلِ JS قدیمی به کار خود
 * ادامه می‌دهد؛ ناوبری سمت کلاینت، RSC بیلدِ جدید را می‌گیرد ولی شناسهٔ
 * Server Actionها در باندلِ قدیمی وجود ندارد و Next آن‌ها را با خطای
 * «Failed to find Server Action» رد می‌کند — یعنی دکمه‌ها بی‌صدا کار نمی‌کنند.
 * این مقدار هنگام بیلد در باندل کلاینت و سرور هر دو inline می‌شود، پس با
 * مقایسه‌اش با پاسخِ /api/version می‌توان نسخهٔ کهنه را تشخیص داد.
 */
const buildId = process.env.NEXT_PUBLIC_BUILD_ID || `b${Date.now()}`;

// توجه (Next 16): کلید «eslint» در next.config دیگر پشتیبانی نمی‌شود و خودِ
// «next build» هم دیگر ESLint اجرا نمی‌کند؛ گذاشتنش فقط دو هشدار
// «Unrecognized key(s) in object: 'eslint'» در لاگ بیلد تولید می‌کرد.
// (پروژه اسکریپت lint جداگانه ندارد؛ دروازه‌های CI تایپ‌چک و تست‌اند.)
const nextConfig = {
  reactStrictMode: true,
  /**
   * ⚡ کشِ سمتِ کلاینتِ RSC (staleTimes).
   *
   * پیش‌فرضِ Next 15/16 برای صفحاتِ داینامیک صفر است؛ یعنی هر بار «برگشت» به
   * صفحه‌ای که چند لحظه پیش دیده‌ایم، دوباره یک درخواستِ کامل به سرور می‌زند و
   * کاربر منتظر می‌ماند. در این سامانه ۱۴۹ صفحه `force-dynamic` هستند، پس این
   * رفتار گران‌ترین بخشِ «لگِ» ناوبری بود.
   *
   * با ۱۰ ثانیه: رفت‌وبرگشت بین صفحاتِ بازدیدشده فوری می‌شود، ولی داده حداکثر
   * ۱۰ ثانیه کهنه می‌ماند. هر Server Action که `revalidatePath` صدا بزند این کش
   * را باطل می‌کند، پس ثبت/ویرایش‌ها همان لحظه دیده می‌شوند. عدد عمداً کوچک
   * انتخاب شد (نه ۳۰ یا ۶۰) چون در سامانهٔ آموزشی، کهنگیِ نمره/مالی گران است.
   */
  experimental: {
    staleTimes: { dynamic: 10, static: 180 },
  },
  // شناسهٔ نسخه در باندل کلاینت و سرور هر دو inline می‌شود (VersionGuard + /api/version)
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  // 🔒 افشای فناوری را خاموش می‌کند (X-Powered-By: Next.js)
  poweredByHeader: false,
  ...(standalone ? { output: 'standalone' } : {}),
  typescript: { ignoreBuildErrors: skipTypeCheck },
  /**
   * هدرهای امنیتی پایه روی همهٔ پاسخ‌ها.
   *
   * توجه: `frame-ancestors`/`X-Frame-Options` عمداً اینجا نیست، چون سامانه در
   * «دامنهٔ واسط» داخل iframe استفاده می‌شود و بستن قاب، آن یکپارچگی را می‌شکند؛
   * دروازهٔ کلیک‌جکینگ باید در لبه (CDN/Caddy) و با علم به همان یکپارچگی تنظیم شود.
   */
  async headers() {
    // مسیرهای استعلام عمومی: نه ایندکس شوند و نه در کش مرورگر/پروکسی بمانند
    // (لینک امضاشدهٔ سند با PII نباید در نتایج جست‌وجو یا کش میانی بایگانی شود).
    const verifyPaths = [
      '/verify-transcript',
      '/verify-finance',
      '/verify-enrollment',
      '/exam-ticket',
      '/id',
      '/verify',
      '/exam-handover',
    ];
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(self), camera=(self), payment=()' },
          // CSP حداقلی و بی‌خطر: جلوی <object>/<base> تزریقی را می‌گیرد بدون
          // اینکه اسکریپت‌های درون‌خطی Next را بشکند.
          { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'" },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
      ...verifyPaths.map(p => ({
        source: `${p}/:path*`,
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      })),
      /**
       * دارایی‌های ایستای `public/` — کش طولانی.
       *
       * ⚠ چرا لازم شد: Next برای فایل‌های داخل `public/` پیش‌فرض
       * `Cache-Control: public, max-age=0` می‌فرستد، یعنی **هیچ‌وقت کش نمی‌شوند**.
       * در HAR یک بارگذاریِ `/admin/scheduling` دیده شد که `manifest.webmanifest`
       * (۶۷۶ بایت!) **۱۷ بار** درخواست شد و هر بار ۲۰۰ تا ۵۳۰ میلی‌ثانیه طول کشید
       * — چیزی حدود ۵ ثانیه رفت‌وبرگشتِ کامل برای یک فایل ثابت. علتش همین
       * `max-age=0` بود: مرورگر در هر ناوبری دوباره سراغ سرور می‌رفت.
       *
       * `manifest.webmanifest` و آیکون‌ها محتوای ثابت‌اند و به نشست/دانشگاه وابسته
       * نیستند، پس کش یک‌روزه بی‌خطر است. `sw.js` عمداً در این فهرست نیست: باید
       * همیشه تازه بماند تا نسخهٔ جدید Service Worker زودتر فعال شود.
       */
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
      {
        source: '/icons/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }],
      },
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;

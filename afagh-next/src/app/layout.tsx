import type { Metadata, Viewport } from 'next';
import './globals.css';
import '../styles/mobile-tables.css';
import PrintThemeGuard from '@/components/PrintThemeGuard';
import MobileTableEnhancer from '@/components/MobileTableEnhancer';
import PwaRegister from '@/components/PwaRegister';
import VersionGuard from '@/components/VersionGuard';
import { ToastProvider } from '@/components/ui/Toast';
import { ConfirmProvider } from '@/components/ui/Confirm';

export const metadata: Metadata = {
  title: 'سامانه جامع آفاق',
  description: 'کالبد Next.js + PostgreSQL — سه داشبورد ایزوله',
  applicationName: 'آفاق',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'آفاق', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      {/* پیش‌بارگذاری فونت فارسیِ محلی: چون «font-display: swap» است، بدون preload
          مرورگر اول متن را با Tahoma (فونتِ جانشین) می‌کشد و بعد به Vazirmatn می‌پرد —
          همان چیزی که کاربر «فونت اشتباه» گزارش می‌کند. وزن ۴۰۰ متن اصلی، ۷۰۰
          تیترهای متوسط و ۹۰۰ تیترهای `font-black`. */}
      <link rel="preload" href="/fonts/vazirmatn-arabic-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preload" href="/fonts/vazirmatn-latin-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preload" href="/fonts/vazirmatn-arabic-700.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preload" href="/fonts/vazirmatn-latin-700.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      {/* وزن ۹۰۰ هم پیش‌بارگذاری می‌شود: تیترهای `font-black` در همهٔ پنل‌ها
          به آن نیاز دارند و اگر دیر برسد، متن ابتدا با ۷۰۰ و بعد با ۹۰۰
          کشیده می‌شود (همان «جهش فونت»). */}
      <link rel="preload" href="/fonts/vazirmatn-900.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <body className="min-h-screen">
        {/* ── جلوگیری از «فلش سفید» حالت شب ──
            پیش از این کلاس `dark` در useEffect داخل ThemeToggle ست می‌شد، یعنی
            بعد از اولین paint: هر رفرش یک فلش روشن و یک پرش چیدمان (به‌دلیل
            رندرنشدن دکمه تا mount) داشت. این اسکریپت هم‌زمان با پارس بدن و
            پیش از paint اجرا می‌شود، پس هیچ فلشی دیده نمی‌شود.
            `suppressHydrationWarning` روی <html> برای همین تغییرِ کلاس است. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var s=localStorage.getItem('theme');" +
              "var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;" +
              "var e=document.documentElement;e.classList.toggle('dark',d);" +
              "e.style.colorScheme=d?'dark':'light';}catch(e){}})();",
          }}
        />
        <a href="#main" className="skip-link print:hidden">پرش به محتوای اصلی</a>
        <PrintThemeGuard />
        <MobileTableEnhancer />
        <PwaRegister />
        {/* تشخیص «باندل کهنه» بعد از هر deploy — بدون آن، دکمه‌ها بی‌صدا کار نمی‌کنند */}
        <VersionGuard />
        {/* لایهٔ بازخورد سراسری: توست (جانشین alert) و دیالوگ تأیید (جانشین
            confirm) — پوشش‌دهندهٔ همهٔ صفحات و همهٔ کارتابل‌ها هستند. */}
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}

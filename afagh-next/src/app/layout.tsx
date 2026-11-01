import type { Metadata, Viewport } from 'next';
import './globals.css';
import '../styles/mobile-tables.css';
import PrintThemeGuard from '@/components/PrintThemeGuard';
import MobileTableEnhancer from '@/components/MobileTableEnhancer';
import PwaRegister from '@/components/PwaRegister';
import VersionGuard from '@/components/VersionGuard';

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
    <html lang="fa" dir="rtl">
      {/* پیش‌بارگذاری فونت فارسیِ محلی: چون «font-display: swap» است، بدون preload
          مرورگر اول متن را با Tahoma (فونتِ جانشین) می‌کشد و بعد به Vazirmatn می‌پرد —
          همان چیزی که کاربر «فونت اشتباه» گزارش می‌کند. وزن ۴۰۰ متن اصلی و وزن ۷۰۰
          تیترهای راهنماها (font-bold/black که به ۷۰۰ می‌افتند) را پوشش می‌دهد. */}
      <link rel="preload" href="/fonts/vazirmatn-arabic-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preload" href="/fonts/vazirmatn-latin-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preload" href="/fonts/vazirmatn-arabic-700.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preload" href="/fonts/vazirmatn-latin-700.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <body className="min-h-screen">
        <PrintThemeGuard />
        <MobileTableEnhancer />
        <PwaRegister />
        {/* تشخیص «باندل کهنه» بعد از هر deploy — بدون آن، دکمه‌ها بی‌صدا کار نمی‌کنند */}
        <VersionGuard />
        {children}
      </body>
    </html>
  );
}

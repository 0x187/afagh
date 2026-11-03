import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: { sans: ['Vazirmatn', 'Tahoma', 'sans-serif'] },
      /* ── سازگاری با کلاس‌های سبکِ v4 که در کد استفاده شده‌اند ──
         پیش‌تر `shadow-xs` (۱۱۲ مورد) و `backdrop-blur-xs`/`blur-xs` (۳۸ مورد)
         در تیلویند ۳ وجود نداشتند و **بی‌صدا حذف** می‌شدند؛ نتیجه: کارت‌ها و
         منوها بدون سایه و بدون بلور رندر می‌شدند («UI تخت»).
         اینجا همان پله‌ها با نامِ موردانتظارِ کد تعریف می‌شوند. */
      boxShadow: {
        xs: '0 1px 2px 0 rgb(15 23 42 / 0.06)',
        '2xs': '0 1px 1px 0 rgb(15 23 42 / 0.04)',
      },
      blur: { xs: '2px' },
      backdropBlur: { xs: '2px' },

      /* ── شعاع‌های معنایی: به‌جای پنج شعاع پراکندهٔ lg/xl/2xl/3xl ── */
      borderRadius: { control: '0.75rem', card: '1rem', panel: '1.25rem' },

      /* ── پله‌های متنِ ریز: جانشین اندازه‌های هاردکد `text-[10px]`/`text-[11px]` ──
         با کف ۱۱px برای خوانایی فارسی؛ نام‌ها همان اندازهٔ واقعی را می‌دهند. */
      fontSize: {
        '2xs': ['0.75rem', { lineHeight: '1.5' }],
        '3xs': ['0.6875rem', { lineHeight: '1.45' }],
      },

      /* ── انیمیشن ورود (جانشین پلاگین نصب‌نشدهٔ tailwindcss-animate) ──
         کد فعلی از ترکیب `animate-in fade-in zoom-in-95` استفاده می‌کند؛
         همان قرارداد در globals.css با کلاس‌های سازگار پیاده شده است.
         این کلیدها برای استفاده‌های تازه (`animate-enter`) هم در دسترس‌اند. */
      keyframes: {
        enter: {
          from: { opacity: '0', transform: 'translate3d(0, 0.25rem, 0) scale(0.98)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: { enter: 'enter 180ms ease-out both' },

      transitionDuration: { DEFAULT: '150ms' },
    },
  },
  plugins: [],
};
export default config;


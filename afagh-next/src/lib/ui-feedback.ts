/**
 * پلِ بازخوردِ سراسری — دسترسی به توست و دیالوگ تأیید از **هر** ماژول کلاینتی،
 * بدون نیاز به هوک React.
 *
 * چرا: سیستم توست/تأیید مبتنی بر Context در کامپوننت‌های عمیق و در
 * توابع کمکیِ بیرون از کامپوننت (مثل `const remove = (f) => …`) قابل استفاده
 * نیست؛ و ۳۲ فراخوانی `alert()` و ~۴۵ فراخوانی `confirm()` در کدبیس پراکنده‌اند.
 * این پل، دو Provider را یک‌بار ثبت می‌کند و بقیهٔ کد فقط `notify()` /
 * `askConfirm()` را صدا می‌زند.
 *
 * اگر Provider نصب نشده باشد (SSR، تست، صفحهٔ بدون layout) رفتار امن دارد:
 *  • `notify` → `console.warn` (هرگز exception نمی‌دهد)
 *  • `askConfirm` → `window.confirm` به‌عنوان آخرین چاره، تا هیچ تأییدی بی‌صدا
 *    «رد» نشود (fail-open فقط برای تأیید، نه برای عملیات).
 */
export type ToastKind = 'success' | 'error' | 'info';

export type ConfirmOptions = {
  title: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

/* دو شکافِ جدا، نه یک شیء مشترک: ToastProvider بیرونِ ConfirmProvider است و
   افکتِ فرزند پیش از والد اجرا می‌شود؛ با یک رجیستریِ واحد، ثبتِ والد ثبتِ
   فرزند را بازنویسی می‌کرد و همهٔ تأییدها بی‌صدا «false» می‌شدند. */
type ToastFn = (text: string, kind?: ToastKind) => void;
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

let toastFn: ToastFn | null = null;
let confirmFn: ConfirmFn | null = null;

/** فقط توسط ToastProvider فراخوانی می‌شود (در useEffect). */
export function registerToast(fn: ToastFn | null) {
  toastFn = fn;
}

/** فقط توسط ConfirmProvider فراخوانی می‌شود (در useEffect). */
export function registerConfirm(fn: ConfirmFn | null) {
  confirmFn = fn;
}

export function notify(text: string, kind: ToastKind = 'info') {
  if (toastFn) {
    toastFn(text, kind);
    return;
  }
  if (typeof console !== 'undefined') console.warn('[notify]', kind, text);
}

export async function askConfirm(opts: ConfirmOptions): Promise<boolean> {
  if (confirmFn) return confirmFn(opts);
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm([opts.title, opts.body].filter(Boolean).join('\n\n'));
  }
  return false;
}

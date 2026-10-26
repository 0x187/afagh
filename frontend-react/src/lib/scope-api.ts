import { ApiError, apiGet, apiPost } from './api';

// ═══ کلاینت تایپ‌دار scope و تعویض حساب — قرارداد فاز ۱ (phase1-contracts.md) ═══
//
//  • GET  /api/v2/scope                → وضعیت جاری + فهرست‌های مجاز
//  • POST /api/v2/scope/university     → ست کوکی `afagh_uni`
//  • POST /api/v2/scope/term           → ست کوکی `afagh_term` (null = پاک‌کردن)
//  • POST /api/v2/auth/switch-account  → ورود به حساب هم‌شخص با رمزِ همان حساب
//
// همهٔ مسیرها همان سشن کوکی‌محور را می‌برند؛ خطاها پیام فارسی آمادهٔ نمایش دارند.

/** دانشگاه از دید کلاینت — قرارداد: `universities:[{id,title}]`. */
export type ScopeUniversity = { id: number; title: string };

/**
 * ترم از دید کلاینت — میدان‌های لازم سوییچر از TermScope اصلی؛ بقیهٔ میدان‌های
 * سرور (تاریخ‌ها و…) در قرارداد سرویس‌نشده‌اند و این‌جا استفاده نمی‌شوند.
 */
export type ScopeTerm = {
  id: number;
  termCode: string;
  title: string;
  /** ترمِ مؤثرِ جاری بر اساس تقویم — سرور محاسبه می‌کند (برچسب «نیمسال جاری»). */
  isEffectiveCurrent?: boolean;
};

export type ScopeResponse = {
  ok: boolean;
  universityId: number | null;
  termId: number | null;
  /** نام دیگر انتخاب‌شده — سازگاری با قرارداد (هر دو در پاسخ سرور هستند) */
  selectedTermId?: number | null;
  universities: ScopeUniversity[];
  terms: ScopeTerm[];
};

/** وضعیت جاری دامنه‌ها — پورت مجاز‌بودن‌ها سمت سرور انجام می‌شود. */
export function getScope(): Promise<ScopeResponse> {
  return apiGet<ScopeResponse>('/scope');
}

/**
 * انتخاب «دانشگاه فعال». اعتبارسنجی مجاز‌بودنِ هدف برای این کاربر سمت سرور است
 * (مرز امنیتی چندمؤسسه‌ای)؛ شکست → ApiError با پیام فارسی.
 */
export function setUniversity(id: number): Promise<unknown> {
  return apiPost('/scope/university', { universityId: id });
}

/**
 * انتخاب «نیمسال فعال»؛ `null` = «همهٔ نیمسال‌ها» (پاک‌شدن کوکی — عین مقدار
 * خالی فرم اصلی). ترم باید متعلق به دانشگاه فعال باشد؛ بررسی سمت سرور.
 */
export function setTerm(id: number | null): Promise<unknown> {
  return apiPost('/scope/term', { termId: id });
}

// ── تعویض حساب هم‌شخص ────────────────────────────────────────────────────────

/** عین SiblingAccount در account-switch.ts سامانهٔ فعلی. */
export type SiblingAccount = {
  kind: 'staff' | 'student';
  code: string;
  name: string;
  universityTitle: string | null;
};

export type SwitchAccountResult = { ok: boolean; error?: string; mustChange?: boolean };

/**
 * ورود به حساب هم‌شخص (همان کدملی، کد پرسنلی/دانشجویی دیگر) با رمزِ همان حساب.
 *
 * پورت `switchAccountAction(kind, code, password)` — قرارداد فاز ۱ عین اکشن
 * اصلی است و `kind` لازم می‌ماند تا سرور کد پرسنلی را از شمارهٔ دانشجویی
 * تشخیص دهد؛ بنابراین امضا سه‌پارامتری حفظ شده است (نه `switchAccount(code, pw)`).
 *
 * برخلاف مسیرهای scope، نتیجهٔ کسب‌کار هم‌شکل اکشن اصلی به‌صورت شیء برمی‌گردد
 * (نه throw) تا فرمِ تعویض حساب همان تصمیم‌های اکشن اصلی را بگیرد.
 */
export async function switchAccount(
  kind: 'staff' | 'student',
  code: string,
  password: string,
): Promise<SwitchAccountResult> {
  try {
    const res = await apiPost<SwitchAccountResult>('/auth/switch-account', { kind, code, password });
    if (res.ok) return { ok: true, mustChange: res.mustChange === true };
    return { ok: false, error: res.error || 'انجام نشد.' };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'ارتباط با سرور برقرار نشد.' };
  }
}

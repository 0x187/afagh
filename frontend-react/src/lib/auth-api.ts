// ═══ کلاینت API احراز هویت (قرارداد فاز ۱) ═══
import { ApiError, apiGet, apiPost } from './api';

export type LoginCandidate = {
  id: number;
  name: string;
  staffCodes: string[];
  universityTitle: string | null;
  roles: string[];
};

export type LoginResponse =
  | { ok: true; mustChange: boolean }
  | { ok: false; error: string }
  | { ok: false; needChoice: true; token: string; candidates: LoginCandidate[] };

export type SimpleAuthResponse = { ok: boolean; error?: string; mustChange?: boolean };

/** ورود — ارقام توسط فیلد ورودی و بکند نرمال می‌شوند. */
export function login(identifier: string, password: string): Promise<LoginResponse> {
  return apiPost<LoginResponse>('/auth/login', { identifier, password });
}

/** انتخاب حساب وقتی یک شناسه چند حساب هم‌رمز دارد. */
export function chooseAccount(token: string, userId: number): Promise<SimpleAuthResponse> {
  return apiPost<SimpleAuthResponse>('/auth/choose-account', { token, userId });
}

export function logout(): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/auth/logout');
}

export function changePassword(currentPassword: string, newPassword: string): Promise<SimpleAuthResponse> {
  return apiPost<SimpleAuthResponse>('/auth/change-password', { currentPassword, newPassword });
}

export type SiblingAccount = {
  kind: 'staff' | 'student';
  code: string;
  name: string;
  universityTitle: string | null;
};

export function getSiblingAccounts(): Promise<{ ok: boolean; accounts: SiblingAccount[]; error?: string }> {
  return apiGet<{ ok: boolean; accounts: SiblingAccount[]; error?: string }>('/auth/siblings');
}

export function switchAccount(kind: 'staff' | 'student', code: string, password: string): Promise<SimpleAuthResponse> {
  return apiPost<SimpleAuthResponse>('/auth/switch-account', { kind, code, password });
}

export { ApiError };

// ── ویترین عمومی صفحهٔ ورود (بدون نشست) ──
export type ShowcaseUniversity = { id: number; code: string; title: string; logoUrl: string | null };
export type ShowcaseNotice = { id: number; title: string; body: string; kind: string };
export type ShowcaseSlide = { id: number; title: string; subtitle: string; imageUrl: string; linkUrl: string };
export type LoginShowcase = {
  universities: ShowcaseUniversity[];
  university: ShowcaseUniversity;
  notices: ShowcaseNotice[];
  slides: ShowcaseSlide[];
};

export async function getLoginShowcase(u?: string): Promise<LoginShowcase> {
  const res = await apiGet<{ ok: boolean; showcase: LoginShowcase }>(
    `/public/login-showcase${u ? `?u=${encodeURIComponent(u)}` : ''}`,
  );
  return res.showcase;
}

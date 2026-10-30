// ═══ کلاینت اتصال پیام‌رسان — پورت messenger-link-actions.ts ═══
//
//	۱) mintLinkToken: کاربر واردشده → کد انسانی + دیپ‌لینک (۱۰ دقیقه اعتبار)
//	۲) confirmLink: پس از ارسال /start در بات → تأیید نهایی + verifiedAt
//	۳) checkPairing: بررسی سبک وضعیت جفت‌سازی (برای تأیید خودکار سمت کلاینت)
//	۴) listMyChannels / revokeChannel: وضعیت کانال‌ها و لغو اتصال
import { apiGet, apiPost } from './api';

export type MessengerChannelKey = 'SOROUSH' | 'BALE' | 'EITAA' | 'TELEGRAM' | 'IGAP';

/** همان فهرست MessengerConnectClient در Next */
export const MESSENGER_CHANNELS: ReadonlyArray<{
  key: MessengerChannelKey;
  label: string;
  bot: string;
  ready: boolean;
}> = [
  { key: 'SOROUSH', label: 'سروش‌پلاس', bot: '@afaghbot', ready: true },
  { key: 'BALE', label: 'بله', bot: '', ready: true },
  { key: 'EITAA', label: 'ایتا', bot: '', ready: true },
  { key: 'TELEGRAM', label: 'تلگرام', bot: '', ready: false },
  { key: 'IGAP', label: 'آی‌گپ', bot: '', ready: false },
];

export type MintLinkResult = {
  ok: boolean;
  code?: string;
  token?: string;
  deepLink?: string | null;
  pairingText?: string;
  expiresAt?: string;
  error?: string;
};

export type PairingStatusResult = {
  ok: boolean;
  paired?: boolean;
  channel?: string;
  error?: string;
};

export type UserChannel = {
  channel: string;
  address: string;
  isActive: boolean;
  label: string | null;
};

/** صدور کد اتصال برای یک کانال (نیازمند ورود) */
export async function mintLinkToken(channel: MessengerChannelKey | string): Promise<MintLinkResult> {
  return apiPost<MintLinkResult>('/messenger/link/token', { channel });
}

/** بررسی اینکه آیا بات /start را دریافت کرده (بدون تأیید نهایی) */
export async function checkPairing(code: string): Promise<PairingStatusResult> {
  return apiGet<PairingStatusResult>(`/messenger/link/status?code=${encodeURIComponent(code)}`);
}

/** تأیید نهایی اتصال پس از ارسال /start در بات (نیازمند ورود) */
export async function confirmLink(code: string): Promise<{ ok: boolean; channel?: string; error?: string }> {
  return apiPost<{ ok: boolean; channel?: string; error?: string }>('/messenger/link/confirm', { code });
}

/** کانال‌های ثبت‌شدهٔ کاربر (وضعیت اتصال هر پیام‌رسان) */
export async function listMyChannels(): Promise<UserChannel[]> {
  const res = await apiGet<{ ok: boolean; data: UserChannel[] }>('/messenger/channels');
  return res.data ?? [];
}

/** لغو اتصال یک پیام‌رسان (حذف نشانی کانال) */
export async function revokeChannel(channel: MessengerChannelKey | string): Promise<void> {
  await apiPost('/messenger/channels/revoke', { channel });
}

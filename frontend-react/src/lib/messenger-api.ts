// ═══ Messenger linking client — port of messenger-link-actions.ts ═══
//
//	1) mintLinkToken: logged-in user → human-readable code + deep link (valid for 10 minutes)
//	2) confirmLink: after /start is sent in the bot → final confirmation + verifiedAt
//	3) checkPairing: lightweight pairing status check (for client-side auto-confirmation)
//	4) listMyChannels / revokeChannel: channel status and link revocation
import { apiGet, apiPost } from './api';

export type MessengerChannelKey = 'SOROUSH' | 'BALE' | 'EITAA' | 'TELEGRAM' | 'IGAP';

/** Same list as MessengerConnectClient in Next */
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

/** Issue a link code for a channel (requires login) */
export async function mintLinkToken(channel: MessengerChannelKey | string): Promise<MintLinkResult> {
  return apiPost<MintLinkResult>('/messenger/link/token', { channel });
}

/** Check whether the bot has received /start (without final confirmation) */
export async function checkPairing(code: string): Promise<PairingStatusResult> {
  return apiGet<PairingStatusResult>(`/messenger/link/status?code=${encodeURIComponent(code)}`);
}

/** Final link confirmation after /start is sent in the bot (requires login) */
export async function confirmLink(code: string): Promise<{ ok: boolean; channel?: string; error?: string }> {
  return apiPost<{ ok: boolean; channel?: string; error?: string }>('/messenger/link/confirm', { code });
}

/** The user's registered channels (link status of each messenger) */
export async function listMyChannels(): Promise<UserChannel[]> {
  const res = await apiGet<{ ok: boolean; data: UserChannel[] }>('/messenger/channels');
  return res.data ?? [];
}

/** Revoke a messenger link (remove the channel address) */
export async function revokeChannel(channel: MessengerChannelKey | string): Promise<void> {
  await apiPost('/messenger/channels/revoke', { channel });
}

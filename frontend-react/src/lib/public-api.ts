// ═══ Public inquiry client (no session) ═══
import { apiGet } from './api';

export type PublicVerifyResult = {
  ok: boolean;
  kind?: string;
  reason?: string;
  message?: string;
  doc?: unknown;
};

export async function verifyPublicToken(token: string): Promise<PublicVerifyResult> {
  const res = await apiGet<{ ok: boolean; data: PublicVerifyResult }>(`/public/verify/${encodeURIComponent(token)}`);
  return res.data;
}

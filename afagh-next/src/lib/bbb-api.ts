import 'server-only';
import crypto from 'crypto';
import { getBbbConfig } from '@/lib/settings';

// فراخوانی‌های سمت سرور به API بیگ‌بلوباتن (create / isMeetingRunning / getMeetingInfo).
// کلید مخفی و رمزهای عمومی فقط در سرور استفاده می‌شوند و هرگز به مرورگر نمی‌روند.
// نام جلسه‌ها ثابت و بر پایهٔ شناسهٔ ارائه است، پس ساخت دوباره بی‌خطر (idempotent) است.

type BbbConfig = Awaited<ReturnType<typeof getBbbConfig>>;

/** شناسهٔ یکتا و پایدار جلسهٔ هر ارائه */
export function meetingIdFor(offeringId: number): string {
  return `afagh-off-${offeringId}`;
}

function sha1(raw: string): string {
  return crypto.createHash('sha1').update(raw).digest('hex');
}

/** امضای درخواست با الگوریتم پیکربندی‌شده (SHA1/SHA256/SHA512) */
export function signBbbRequest(callName: string, queryString: string, secret: string, algo: 'SHA1' | 'SHA256' | 'SHA512' = 'SHA256'): string {
  return hashOf(algo, `${callName}${queryString}${secret}`);
}

function hashOf(algo: 'SHA1' | 'SHA256' | 'SHA512', raw: string): string {
  const a = algo === 'SHA1' ? 'sha1' : algo === 'SHA512' ? 'sha512' : 'sha256';
  return crypto.createHash(a).update(raw).digest('hex');
}

async function bbbCall(cfg: BbbConfig, name: string, params: Record<string, string>): Promise<{ ok: boolean; xml: string; error?: string }> {
  if (!cfg.configured) return { ok: false, xml: '', error: 'سرویس کلاس مجازی پیکربندی نشده است — پنل مدیر ← پیکربندی سامانه ← کلاس مجازی' };
  const qs = new URLSearchParams(params).toString();
  const checksum = hashOf(cfg.checksumAlgo, `${name}${qs}${cfg.secret}`);
  const url = `${cfg.url}/${name}?${qs}&checksum=${checksum}`;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const xml = await res.text();
    const rc = /<returncode>([^<]+)<\/returncode>/.exec(xml)?.[1];
    if (rc !== 'SUCCESS') {
      const msg = /<message>([^<]*)<\/message>/.exec(xml)?.[1];
      return { ok: false, xml, error: msg || 'پاسخ نامعتبر از سرور بیگ‌بلوباتن' };
    }
    return { ok: true, xml };
  } catch (e) {
    return { ok: false, xml: '', error: `ارتباط با سرور بیگ‌بلوباتن برقرار نشد: ${(e as Error).message}` };
  }
}

/** ساخت جلسه در سرور BBB (اگر از قبل باشد، همان را برمی‌گرداند) */
export async function createBbbMeeting(opts: { meetingId: string; name: string; moderatorPw?: string; attendeePw?: string }): Promise<{ ok: boolean; error?: string }> {
  const cfg = await getBbbConfig();
  const r = await bbbCall(cfg, 'create', {
    meetingID: opts.meetingId,
    name: opts.name.slice(0, 255),
    moderatorPW: opts.moderatorPw || cfg.moderatorPw || `mod-${opts.meetingId}`,
    attendeePW: opts.attendeePw || cfg.attendeePw || `att-${opts.meetingId}`,
    record: cfg.autoRecord ? 'true' : 'false',
    autoStartRecording: cfg.autoRecord ? 'true' : 'false',
    allowStartStopRecording: 'true',
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** وضعیت زندهٔ جلسه: در حال برگزاری؟ و چند نفر حاضرند؟ */
export interface BbbRecording {
  recordId: string;
  meetingId: string;
  name: string;
  published: boolean;
  startTime: Date | null;
  endTime: Date | null;
  durationMinutes: number;
  sizeBytes: number;
  playbackUrl: string;
  format: string;
}

/** فهرست ضبط‌های یک جلسه از سرور بیگ‌بلوباتن */
export async function getBbbRecordings(meetingId: string): Promise<{ ok: boolean; recordings: BbbRecording[]; error?: string }> {
  const cfg = await getBbbConfig();
  const r = await bbbCall(cfg, 'getRecordings', { meetingID: meetingId });
  if (!r.ok) return { ok: false, recordings: [], error: r.error };
  const recordings: BbbRecording[] = [];
  for (const m of r.xml.matchAll(/<recording>([\s\S]*?)<\/recording>/g)) {
    const body = m[1];
    const recordId = /<recordID>([^<]+)<\/recordID>/.exec(body)?.[1]?.trim();
    if (!recordId) continue;
    const name = /<name>([^<]*)<\/name>/.exec(body)?.[1]?.trim() || meetingId;
    const published = /<published>([^<]+)<\/published>/.exec(body)?.[1]?.trim() === 'true';
    const startMs = Number(/<startTime>(\d+)<\/startTime>/.exec(body)?.[1] ?? 0);
    const endMs = Number(/<endTime>(\d+)<\/endTime>/.exec(body)?.[1] ?? 0);
    const size = Number(/<size>(\d+)<\/size>/.exec(body)?.[1] ?? 0);
    const fmt = /<format><type>([^<]+)<\/type>/.exec(body)?.[1]?.trim() || 'presentation';
    const url = /<format>[\s\S]*?<url>([^<]+)<\/url>/.exec(body)?.[1]?.trim() || '';
    const duration = endMs > startMs ? Math.round((endMs - startMs) / 60000) : 90;
    recordings.push({
      recordId,
      meetingId,
      name,
      published,
      startTime: startMs > 0 ? new Date(startMs) : null,
      endTime: endMs > 0 ? new Date(endMs) : null,
      durationMinutes: duration > 0 ? duration : 90,
      sizeBytes: Number.isFinite(size) ? size : 0,
      playbackUrl: url,
      format: fmt,
    });
  }
  return { ok: true, recordings };
}

/** وضعیت زندهٔ جلسه: در حال برگزاری؟ و چند نفر حاضرند؟ */
export async function getBbbStatus(meetingId: string): Promise<{ ok: boolean; running: boolean; participantCount: number; error?: string }> {
  const cfg = await getBbbConfig();
  const running = await bbbCall(cfg, 'isMeetingRunning', { meetingID: meetingId });
  if (!running.ok) return { ok: false, running: false, participantCount: 0, error: running.error };
  if (!/<running>true<\/running>/.test(running.xml)) return { ok: true, running: false, participantCount: 0 };
  const info = await bbbCall(cfg, 'getMeetingInfo', { meetingID: meetingId });
  const count = Number(/<participantCount>(\d+)<\/participantCount>/.exec(info.xml)?.[1] ?? 0);
  return { ok: true, running: true, participantCount: Number.isFinite(count) ? count : 0 };
}

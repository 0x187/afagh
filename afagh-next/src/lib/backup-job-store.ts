/**
 * ════════════════════════════════════════════════════════════════════════
 *  وضعیت کارهای پشتیبانگیری پسزمینه — مشترک بین replicaها (Redis + fallback)
 *
 *  چرا: دامپ پروداکشن ~۱۰۰–۱۴۰ ثانیه طول میکشد، بنابراین اکشن فقط `jobId`
 *  برمیگرداند و کلاینت پول میکند. نسخهٔ قبل وضعیت را در `Map` روی `globalThis`
 *  نگه میداشت ⇒ اگر پول روی کانتینر/پروسس دیگری میرفت، «کار یافت نشد» میگرفت.
 *
 *  طراحی:
 *    • منبع اصلی = Redis (همان `REDIS_URL`ای که بقیهٔ سامانه استفاده میکند) با
 *      TTL خودکار. نوشتن/خواندن در `try` است؛ قطعی Redis هرگز اکشن را نمیشکند.
 *    • کش محلی = `Map` روی `globalThis` (همیشه نوشته میشود). هم تأخیر پول را
 *      کم میکند، هم اگر Redis در لحظهٔ شروع/پول در دسترس نبود، همان پروسس
 *      همچنان پاسخ میدهد (رفتار تککانتینر قبلی حفظ میشود).
 *    • اعتبارسنجی ورودی: هر چیزی که از Redis آمد قبل از برگشت پارس و چک میشود؛
 *      JSON خراب یا job منقضی ⇒ null.
 *
 *  ماژول خالص و بدون `'use server'` است ⇒ با یک `BackupJobKv` قلابی تست میشود
 *  و تستها هرگز به Redis واقعی وصل نمیشوند.
 * ════════════════════════════════════════════════════════════════════════
 */
import Redis from 'ioredis';

export type DbBackupJobStatus = 'running' | 'done' | 'failed';

export interface DbBackupJob {
  id: string;
  startedAt: number;
  includeSecrets: boolean;
  status: DbBackupJobStatus;
  key?: string;
  size?: number;
  tables?: number;
  error?: string;
}

/** حداقل رابط کلید/مقداری که لازم داریم (ioredis و تست قلابی هر دو پیاده میکنند). */
export interface BackupJobKv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<unknown>;
}

export const JOB_TTL_MS = 15 * 60 * 1000;
export const JOB_KEY_PREFIX = 'afagh:backup:job:';

const JOB_ID_RE = /^[a-f0-9]{32}$/;
const STATUSES: readonly DbBackupJobStatus[] = ['running', 'done', 'failed'];

export interface BackupJobStore {
  put(job: DbBackupJob): Promise<void>;
  get(id: string): Promise<DbBackupJob | null>;
  prune(): void;
  source(): 'redis' | 'memory';
}

/** پارس دفاعی: رشتۀ Redis قابلاعتماد نیست (ممکن است دستی دستکاری شده باشد). */
export function parseBackupJob(raw: string | null | undefined): DbBackupJob | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as Partial<DbBackupJob>;
    if (!v || typeof v !== 'object') return null;
    if (typeof v.id !== 'string' || !JOB_ID_RE.test(v.id)) return null;
    if (typeof v.startedAt !== 'number' || !Number.isFinite(v.startedAt)) return null;
    if (typeof v.status !== 'string' || !STATUSES.includes(v.status as DbBackupJobStatus)) return null;
    return {
      id: v.id,
      startedAt: v.startedAt,
      includeSecrets: v.includeSecrets === true,
      status: v.status as DbBackupJobStatus,
      ...(typeof v.key === 'string' ? { key: v.key } : {}),
      ...(typeof v.size === 'number' ? { size: v.size } : {}),
      ...(typeof v.tables === 'number' ? { tables: v.tables } : {}),
      ...(typeof v.error === 'string' ? { error: v.error } : {}),
    };
  } catch {
    return null;
  }
}

export interface BackupJobStoreOptions {
  kv?: BackupJobKv | null;
  /** کش محلی؛ برای singleton روی globalThis بهاشتراک گذاشته میشود. */
  memory?: Map<string, DbBackupJob>;
  now?: () => number;
}

export function createBackupJobStore(opts: BackupJobStoreOptions = {}): BackupJobStore {
  const kv = opts.kv ?? null;
  const memory = opts.memory ?? new Map<string, DbBackupJob>();
  const now = opts.now ?? Date.now;

  const alive = (job: DbBackupJob): boolean => now() - job.startedAt <= JOB_TTL_MS;

  function prune(): void {
    for (const [id, job] of memory) if (!alive(job)) memory.delete(id);
  }

  async function put(job: DbBackupJob): Promise<void> {
    // ابتدا کش محلی: حتی اگر Redis پایین باشد، همان پروسس وضعیت را میبیند.
    memory.set(job.id, { ...job });
    if (!kv) return;
    try {
      await kv.set(JOB_KEY_PREFIX + job.id, JSON.stringify(job), JOB_TTL_MS);
    } catch { /* قطعی Redis نباید پشتیبانگیری را خراب کند */ }
  }

  async function get(id: string): Promise<DbBackupJob | null> {
    if (typeof id !== 'string' || !JOB_ID_RE.test(id)) return null;
    const local = memory.get(id);
    if (local) {
      if (alive(local)) return { ...local };
      memory.delete(id);
    }
    if (!kv) return null;
    try {
      const parsed = parseBackupJob(await kv.get(JOB_KEY_PREFIX + id));
      if (!parsed || !alive(parsed)) return null;
      memory.set(id, parsed);
      return { ...parsed };
    } catch { /* Redis در دسترس نیست ⇒ فقط کش محلی */ }
    return null;
  }

  return { put, get, prune, source: () => (kv ? 'redis' : 'memory') };
}

// ── singleton سرور ──────────────────────────────────────────────────────────
const g = globalThis as unknown as {
  __afaghBackupJobStore?: BackupJobStore;
  __afaghBackupJobMemory?: Map<string, DbBackupJob>;
  __afaghBackupJobRedis?: Redis;
};

function redisKv(): BackupJobKv | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  try {
    if (!g.__afaghBackupJobRedis) {
      const client = new Redis(url, {
        maxRetriesPerRequest: 1,
        retryStrategy: t => Math.min(t * 200, 1000),
      });
      // قطعی موقت Redis نباید Node را کرش کند (همان الگوی waitingRoom.ts).
      client.on('error', () => {});
      g.__afaghBackupJobRedis = client;
    }
    const client = g.__afaghBackupJobRedis;
    return {
      get: key => client.get(key),
      set: (key, value, ttlMs) => client.set(key, value, 'PX', ttlMs),
    };
  } catch {
    return null;
  }
}

/** همان نمونه در تمام ماژولها/ hot-reloadها — وضعیت job گم نمیشود. */
export function getBackupJobStore(): BackupJobStore {
  if (!g.__afaghBackupJobStore) {
    g.__afaghBackupJobMemory ??= new Map<string, DbBackupJob>();
    g.__afaghBackupJobStore = createBackupJobStore({
      kv: redisKv(),
      memory: g.__afaghBackupJobMemory,
    });
  }
  return g.__afaghBackupJobStore;
}

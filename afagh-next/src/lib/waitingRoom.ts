import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { academic_terms, course_offerings } from '@/db/schema';

// ═══ اتاق انتظار Redis — سند §۱۰۰۶ (گرم‌کردن ظرفیت‌ها)، §۱۰۱۴ (چک اتمیک)،
//     §۱۰۱۶ (صف پردازش)، §۶۹۰۶ (مهار هجوم ۲۰۰۰ نفره) ═══
export const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const g = globalThis as unknown as { __afaghRedis?: Redis; __afaghWrWorker?: NodeJS.Timeout };
export const redis: Redis = g.__afaghRedis ?? new Redis(REDIS_URL, { maxRetriesPerRequest: 2, retryStrategy: t => Math.min(t * 200, 2000) });
redis.on('error', () => { /* قطعی موقت Redis نباید Node را کرش کند */ });
if (process.env.NODE_ENV !== 'production') g.__afaghRedis = redis;

export const K = {
  caps: 'afagh:caps',                                   // hash: offeringId → «cap,enrolled,waitCap»
  wl: (o: number) => `afagh:offering:${o}:wl`,          // شمارندهٔ ترتیب لیست انتظار
  queue: 'afagh:wr:queue',                              // صف ثبت نهایی (FIFO)
  latest: (u: number) => `afagh:wr:latest:${u}`,        // آخرین وضعیت هر کاربر
  rl: (u: number) => `afagh:rl:submit:${u}`,            // سطل نرخ (§۲۰۷۷: حداکثر ۵/ثانیه)
};

export type WrState = 'WAITING' | 'PROCESSING' | 'DONE';
export type QueueTicket = { id: string; userId: number; studentId: number; enqueuedAt: number; acceptSameDayRisk?: boolean };

// ── §۱۰۰۶: شب قبل از انتخاب واحد، ظرفیت همهٔ کلاس‌ها از DB به Redis منتقل می‌شود ──
export async function warmupCapacities(force = false): Promise<number> {
  const exists = await redis.exists(K.caps);
  if (exists && !force) return await redis.hlen(K.caps);
  const [term] = await db.select().from(academic_terms).where(eq(academic_terms.isCurrent, 1));
  if (!term) return 0;
  const offs = await db
    .select({ id: course_offerings.id, cap: course_offerings.capacity, enr: course_offerings.enrolledCount, wl: course_offerings.waitlistCapacity })
    .from(course_offerings)
    .where(eq(course_offerings.termId, term.id));
  const pipe = redis.multi();
  pipe.del(K.caps);
  for (const o of offs) pipe.hset(K.caps, String(o.id), `${o.cap},${o.enr},${o.wl ?? 0}`);
  await pipe.exec();
  return offs.length;
}

// ── §۱۰۱۴: چک اتمیک ظرفیت — یک عملیات Lua غیرقابل‌شکست:
//     ۱ = صندلی گرفت | ۰ = تکمیل | -۲ = گرم نشده/خطا (fallback به DB) ──
const SEAT_LUA = `
local v = redis.call('HGET', KEYS[1], ARGV[1])
if not v then return -2 end
local c, e, w = string.match(v, '(%d+),(%d+),(%d+)')
e = tonumber(e); c = tonumber(c)
if e < c then
  redis.call('HSET', KEYS[1], ARGV[1], c .. ',' .. (e + 1) .. ',' .. w)
  return 1
end
return 0`;

export async function atomicSeat(offeringId: number): Promise<number> {
  try {
    return (await redis.eval(SEAT_LUA, 1, K.caps, String(offeringId))) as number;
  } catch {
    return -2; // Redis.DOWN → موتور به شمارش SQL برمی‌گردد (تداوم سرویس)
  }
}

/** آزادسازی صندلی (حذف درس) — کف صفر */
export async function releaseSeat(offeringId: number): Promise<void> {
  try {
    const v = await redis.hget(K.caps, String(offeringId));
    if (!v) return;
    const [c, e, w] = v.split(',').map(Number);
    await redis.hset(K.caps, String(offeringId), `${c},${Math.max(0, e - 1)},${w}`);
  } catch { /* fallback: گرم‌کردن مجدد جبران می‌کند */ }
}

/** اشغال مجدد صندلی پس از ارتقای لیست انتظار */
export async function takeSeat(offeringId: number): Promise<void> {
  try {
    const v = await redis.hget(K.caps, String(offeringId));
    if (!v) return;
    const [c, e, w] = v.split(',').map(Number);
    await redis.hset(K.caps, String(offeringId), `${c},${Math.min(c, e + 1)},${w}`);
  } catch { /* ignore */ }
}

export async function nextWaitlistPosition(offeringId: number): Promise<number> {
  return redis.incr(K.wl(offeringId));
}

/**
 * آیا Redis همین حالا پاسخ می‌دهد؟ (یک PING با مهلت کوتاه)
 *
 * انتخاب واحد نباید گروگانِ Redis باشد: اگر Redis پایین است، سامانه به مسیر
 * «ثبت مستقیم روی دیتابیس» برمی‌گردد. بدون این بررسی، دانشجو در اوج ثبت‌نام
 * فقط پیام «ورود به صف ناموفق بود» می‌دید و هیچ راهی برای ثبت نداشت.
 */
export async function redisAvailable(timeoutMs = 700): Promise<boolean> {
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    return pong === 'PONG';
  } catch {
    return false;
  }
}

/** نمای زندهٔ ظرفیت (§۳۴۰۳ — پیش‌نمایش سریع بدون DB) */
export async function peekCapacities(offeringIds: number[]): Promise<Record<number, { cap: number; enrolled: number; remaining: number }>> {
  const out: Record<number, { cap: number; enrolled: number; remaining: number }> = {};
  try {
    if (!offeringIds.length) return out;
    if (!(await redis.exists(K.caps))) await warmupCapacities();
    const vals = await redis.hmget(K.caps, ...offeringIds.map(String));
    offeringIds.forEach((id, i) => {
      const v = vals[i];
      if (!v) return;
      const [cap, enrolled] = v.split(',').map(Number);
      out[id] = { cap, enrolled, remaining: Math.max(0, cap - enrolled) };
    });
  } catch { /* Redis پایین → UI از مقادیر سمت سرور استفاده می‌کند */ }
  return out;
}

// ── §۱۰۱۶: صف پردازش — پاسخ فوری «درخواست شما در صف قرار گرفت» ──
// ── §۱۰۱۶: صف پردازش — پاسخ فوری «درخواست شما در صف قرار گرفت» ──
// 🎯 بازبینی/گام ۲ سند: صف از LIST به Sorted Set (ZSET) ارتقا یافت.
//   • ورود:   ZADD afagh:wr:queue <timestamp> <item>   (score = زمان دقیق ثبت)
//   • جایگاه: ZRANK → O(log N) به‌جای LPOS خطی O(N)؛ با ۵۰۰۰ دانشجوی همزمان،
//             رفرش هر ثانیه بدون درگیری تک‌نخی Redis محاسبه می‌شود.
//   • خروج:   ZPOPMIN → قدیمی‌ترین (عادلانه‌ترین) ثبت با یک دستور اتمیک.
export async function enqueueSubmit(userId: number, studentId: number, acceptSameDayRisk = false) {
  const ticket: QueueTicket = { id: randomUUID(), userId, studentId, enqueuedAt: Date.now(), acceptSameDayRisk };
  const item = JSON.stringify(ticket);
  await redis.zadd(K.queue, ticket.enqueuedAt, item);
  // ZRANK ایندیس را از ۰ برمی‌گرداند → ۱+ = شمارهٔ نوبت
  const idx = await redis.zrank(K.queue, item);
  const position = idx === null ? -1 : idx + 1;
  await redis.set(K.latest(userId), JSON.stringify({ item, state: 'WAITING' as WrState, enqueuedAt: ticket.enqueuedAt, position }), 'EX', 1800);
  return { ticket, position, item };
}

export async function queuePosition(item: string): Promise<number> {
  const idx = await redis.zrank(K.queue, item).catch(() => null);
  return idx === null ? -1 : idx + 1;
}

export async function finishTicket(userId: number, ticketId: string, result: unknown) {
  await redis.set(K.latest(userId), JSON.stringify({ id: ticketId, state: 'DONE' as WrState, result }), 'EX', 1800);
}

export async function markProcessing(userId: number, ticketId: string) {
  await redis.set(K.latest(userId), JSON.stringify({ id: ticketId, state: 'PROCESSING' as WrState }), 'EX', 1800);
}

export async function myStatus(userId: number): Promise<{ state: WrState | 'IDLE'; position?: number; result?: unknown }> {
  // قطعی Redis نباید صفحهٔ انتخاب واحد را بشکند؛ «صفی در کار نیست» امن‌ترین پاسخ است.
  const raw = await redis.get(K.latest(userId)).catch(() => null);
  if (!raw) return { state: 'IDLE' };
  const st = JSON.parse(raw) as { item?: string; state: WrState; result?: unknown; position?: number };
  if (st.state === 'DONE') return { state: 'DONE', result: st.result };
  const pos = st.item ? await queuePosition(st.item) : -1;
  return pos > 0 ? { state: 'WAITING', position: pos } : { state: 'PROCESSING' };
}

// ── §۲۰۷۷: محدودیت نرخ — حداکثر ۵ درخواست ثبت در ثانیه برای هر کاربر ──
export async function rateLimitSubmit(userId: number): Promise<boolean> {
  // اگر Redis پایین باشد، سپر نرخ «باز» می‌شود (اجازه می‌دهد) — بستنِ کاملِ
  // ثبت‌نام برای همه بسیار پرهزینه‌تر از نبودِ موقتِ محدودیت نرخ است؛ گاردهای
  // اصلی (سقف واحد، پیش‌نیاز، ظرفیت، تداخل) همگی روی دیتابیس‌اند.
  try {
    const n = await redis.incr(K.rl(userId));
    if (n === 1) await redis.expire(K.rl(userId), 1);
    return n <= 5;
  } catch {
    return true;
  }
}

// ── کارگر صف: تخلیهٔ کنترل‌شده (مثلاً ۱۰ آیتم در هر تیک = ۴۰/ثانیه) ──
const TICK_MS = 250;
const BATCH = 10;

export function ensureWorker() {
  if (g.__afaghWrWorker) return;
  g.__afaghWrWorker = setInterval(async () => {
    for (let i = 0; i < BATCH; i++) {
      let raw: string | null = null;
      try {
        // ZPOPMIN آرایهٔ [member, score] برمی‌گرداند — قدیمی‌ترین ثبت با کمترین score
        const popped = await redis.zpopmin(K.queue, 1);
        if (!popped || popped.length === 0) return;
        raw = popped[0]; // member (خود آیتم JSON)
      } catch { return; }
      if (!raw) return;
      const t = JSON.parse(raw) as QueueTicket;
      try {
        await markProcessing(t.userId, t.id);
        const { processQueuedSubmit } = await import('./enroll-engine');
        const result = await processQueuedSubmit(t.userId, t.studentId, t.acceptSameDayRisk ?? false);
        await finishTicket(t.userId, t.id, result);
      } catch (err) {
        await finishTicket(t.userId, t.id, { ok: false, registered: [], waitlisted: [], hardErrors: ['خطای داخلی صف: ' + String(err)], softErrors: [], droppedCart: [] });
      }
    }
  }, TICK_MS);
  if (g.__afaghWrWorker.unref) g.__afaghWrWorker.unref();
}

export async function waitingRoomStats() {
  /**
   * ⏱ محافظِ زمانی.
   *
   * چرا لازم است: این تابع در **صفحهٔ اولِ** کارتابل مدیریت صدا زده می‌شود و
   * پیش‌تر با `await` مستقیم اجرا می‌شد. اگر Redis خاموش یا کند بود، کلاینتِ
   * ioredis تا `connectTimeout`/`maxRetriesPerRequest` تلاش می‌کرد و در این
   * فاصله **کلِ صفحه** روی اسکلتون می‌ماند — همان «به‌شدت کند»ی که گزارش شد.
   * حالا حداکثر ۷۰۰ms صبر می‌کنیم و بعد «در دسترس نیست» برمی‌گردانیم؛ تجربهٔ
   * کاربر به سلامتِ Redis گره نمی‌خورد.
   */
  const fallback = { up: false, queueLength: 0, warmedOfferings: 0 };
  try {
    const work = (async () => {
      const [qlen, warmed, ping] = await Promise.all([redis.zcard(K.queue), redis.hlen(K.caps), redis.ping()]);
      return { up: ping === 'PONG', queueLength: qlen, warmedOfferings: warmed };
    })();
    return await Promise.race([
      work,
      new Promise<typeof fallback>((resolve) => {
        const t = setTimeout(() => resolve(fallback), 700);
        // تایمر نباید پروسه را زنده نگه دارد
        (t as unknown as { unref?: () => void }).unref?.();
      }),
    ]);
  } catch {
    return fallback;
  }
}

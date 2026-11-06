/**
 * Load-test harness — Test 1 v2 (FAITHFUL to the real enrollment path).
 *
 * The real system does NOT run 10k `processQueuedSubmit` concurrently — students
 * click ثبت, which enqueues to the Redis waiting-room (atomic, fast) and a worker
 * drains at a bounded rate. That rush-containment design is the whole point.
 * So this harness measures BOTH layers:
 *   Phase 1 (burst): 10,000 concurrent enqueueSubmit -> Redis. This is what 10k
 *                    students hitting ثبت at once actually causes. Expect fast, no hang.
 *   Phase 2 (drain): bounded-concurrency workers pop the queue and call the REAL
 *                    processQueuedSubmit. Measures DB throughput + integrity.
 *                    (Avoids the artificial lock-convoy of unbounded DB concurrency.)
 *
 * De-isolated (stubbed) for the concurrency focus: prereq, unit-cap(=24), debt, notify.
 * Capacity seat-guard is REAL (Redis atomicSeat + DB enrolledCount UPDATE).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { processQueuedSubmit } from '@/lib/enroll-engine/submit';
import { enqueueSubmit, redis, K, atomicSeat, releaseSeat, nextWaitlistPosition, warmupCapacities } from '@/lib/waitingRoom';
import fs from 'fs';

const N = 10_000, U = 1_000_000, S = 1_100_000, OFF_E = 1_400_000, OFF_E_LAST = OFF_E + 19;
const C = Number(process.env.DRAIN_CONCURRENCY ?? 12);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Math.max(C + 2, 12), statement_timeout: 120_000 });
const db = drizzle(pool, { schema });
const rls = async (userId: number, fn: any) => db.transaction(async (tx: any) => {
  await tx.execute(sql`select set_config('app.user_id', ${String(userId)}, true)`);
  return fn(tx);
});
const deps = {
  db, withUserRls: rls, atomicSeat, releaseSeat, nextWaitlistPosition,
  evaluateRegulations: async () => ({ effectiveMaxUnits: 24 }),
  buildPrereq: async () => ({ ruleByCourse: new Map(), passed: new Map(), titles: new Map(), defaultPassing: 10, unitsPassed: 0, semesterNo: 1 }),
  getDebtThreshold: async () => 0,
  notifyEnrollmentDone: async () => {},
};

function pct(a: number[], p: number): number {
  a.sort((x, y) => x - y);
  if (!a.length) return 0;
  const i = Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * a.length)));
  return Math.round(a[i] * 100) / 100;
}

async function reset() {
  await db.execute(sql`DELETE FROM enrollments WHERE "studentId" BETWEEN ${S} AND ${S + N - 1} AND "offeringId" BETWEEN ${OFF_E} AND ${OFF_E_LAST}`);
  await db.execute(sql`UPDATE course_offerings SET "enrolledCount" = 0 WHERE id BETWEEN ${OFF_E} AND ${OFF_E_LAST}`);
  await redis.del(K.queue);
  await warmupCapacities(true);
}

async function enqueuePhase() {
  await redis.del(K.queue);
  const lat: number[] = []; const errors: Record<string, number> = {};
  const t0 = Date.now();
  await Promise.all(Array.from({ length: N }, (_, i) => {
    const start = performance.now();
    return enqueueSubmit(U + i, S + i, true)
      .then(() => lat.push(performance.now() - start))
      .catch((e: any) => { lat.push(performance.now() - start); const k = String(e?.message).slice(0, 60); errors[k] = (errors[k] || 0) + 1; });
  }));
  const wall = Date.now() - t0;
  const qlen = await redis.zcard(K.queue);
  return { wallMs: wall, throughputPerSec: Math.round(N / (wall / 1000)), qlen, latP50: pct(lat, 50), latP95: pct(lat, 95), latP99: pct(lat, 99), latMax: pct(lat, 100), errors };
}

async function drainPhase() {
  const lat: number[] = []; const buckets: Record<string, number> = {};
  let ok = 0; let processed = 0; const t0 = Date.now();
  async function worker() {
    while (true) {
      const popped = await redis.zpopmin(K.queue, 1);
      if (!popped || popped.length === 0) return;
      const start = performance.now();
      try {
        const t = JSON.parse(popped[0]);
        const r = await processQueuedSubmit(t.userId, t.studentId, t.acceptSameDayRisk ?? true, deps);
        lat.push(performance.now() - start);
        if (r.ok) ok++; else for (const h of r.hardErrors || []) { const k = String(h).slice(0, 55); buckets[k] = (buckets[k] || 0) + 1; }
      } catch (e: any) {
        lat.push(performance.now() - start); const k = 'EXC:' + String(e?.message).slice(0, 55); buckets[k] = (buckets[k] || 0) + 1;
      }
      processed++;
    }
  }
  await Promise.all(Array.from({ length: C }, worker));
  const wall = Date.now() - t0;
  return { concurrency: C, wallMs: wall, throughputPerSec: Math.round(processed / (wall / 1000)), processed, ok, failCount: processed - ok, latP50: pct(lat, 50), latP95: pct(lat, 95), latP99: pct(lat, 99), latMax: pct(lat, 100), buckets };
}

async function integrity() {
  const totalR = await db.execute(sql`SELECT count(*)::int AS c FROM enrollments WHERE "studentId" BETWEEN ${S} AND ${S + N - 1} AND "offeringId" BETWEEN ${OFF_E} AND ${OFF_E_LAST} AND "status"='REGISTERED'`) as any;
  const dupR = await db.execute(sql`SELECT count(*)::int AS c FROM (SELECT "studentId","offeringId",count(*) n FROM enrollments WHERE "studentId" BETWEEN ${S} AND ${S + N - 1} AND "offeringId" BETWEEN ${OFF_E} AND ${OFF_E_LAST} GROUP BY 1,2 HAVING count(*)>1) x`) as any;
  const mismatchR = await db.execute(sql`SELECT co.id, co."enrolledCount" AS enrolled, COALESCE(e.cnt,0) AS actual FROM course_offerings co LEFT JOIN (SELECT "offeringId",count(*) cnt FROM enrollments WHERE "offeringId" BETWEEN ${OFF_E} AND ${OFF_E_LAST} AND "status"='REGISTERED' GROUP BY 1) e ON e."offeringId"=co.id WHERE co.id BETWEEN ${OFF_E} AND ${OFF_E_LAST} AND co."enrolledCount" <> COALESCE(e.cnt,0)`) as any;
  const overR = await db.execute(sql`SELECT count(*)::int AS c FROM course_offerings WHERE id BETWEEN ${OFF_E} AND ${OFF_E_LAST} AND "enrolledCount" > "capacity"`) as any;
  return {
    registeredTotal: Number(totalR.rows[0].c), duplicateRows: Number(dupR.rows[0].c),
    overCapacityOfferings: Number(overR.rows[0].c),
    enrolledCountMismatches: (mismatchR.rows || []).map((r: any) => ({ offeringId: Number(r.id), enrolled: Number(r.enrolled), actual: Number(r.actual) })),
  };
}

async function main() {
  console.error(`[lt1v2] node ${process.version}, drainC=${C}, N=${N}`);
  await reset();
  const enq = await enqueuePhase();
  console.error(`[lt1v2] enqueue done: qlen=${enq.qlen} p99=${enq.latP99}ms peak=${enq.latMax}ms`);
  const drain = await drainPhase();
  const integ = await integrity();
  const result = { tool: 'lt1-enroll-v2', N, drainConcurrency: C, enqueue: enq, drain, integrity: integ, generatedAt: new Date().toISOString() };
  fs.writeFileSync('/root/lt1v2-result.json', JSON.stringify(result, null, 2));
  console.log('SUMMARY_JSON=' + JSON.stringify(result));
  await pool.end(); await redis.quit();
}
main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e); process.exit(1); });

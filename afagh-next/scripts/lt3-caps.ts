/**
 * Focused test — per-مقطع (degree-level) enrollment-unit CAP enforcement.
 * Uses the REAL regulations engine (evaluateStudentRegulationStatus) — NO unit-cap stub.
 * Seeds 4 degree levels with distinct caps, then for each level submits:
 *   - a VALID cart   (<= cap)  -> must REGISTER
 *   - a VIOLATING cart (> cap) -> must be REJECTED with the unit-cap hard error
 * Courses are 3 units each. Verifies the matrix matches, concurrently.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { processQueuedSubmit } from '@/lib/enroll-engine/submit';
import { evaluateStudentRegulationStatus } from '@/lib/regulations-engine';
import { atomicSeat, releaseSeat, nextWaitlistPosition, warmupCapacities } from '@/lib/waitingRoom';
import fs from 'fs';

const TERM = 1_500_000, OFF_E = 1_400_000, OFF_CNT = 20;
const U = 3_000_000, S = 3_100_000;            // dedicated id space (no clash)
const V = Number(process.env.V_PER_SCENARIO ?? 60);
const C = 20;
const PW = 'a873f3e68a21e89a0a63c26967ed871c:cfa2238cba56085b77cb355799fda066a9f68490f921764d4e5b87676bc85e6f';

// minimal rulesConfig: only max_units differs per level; grading_and_gpa gate + default passing.
function cfg(maxUnits: number) {
  return JSON.stringify({ regular_term_rules: { max_units: maxUnits }, grading_and_gpa: { default_passing_grade: 10.0 } });
}
const LEVELS = [
  { id: 8000, code: '1', title: 'کاردانی', cap: 16 },
  { id: 8001, code: '2', title: 'کارشناسی', cap: 20 },
  { id: 8002, code: '3', title: 'کارشناسی ارشد', cap: 14 },
  { id: 8003, code: '4', title: 'دکتری', cap: 12 },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: C + 4, statement_timeout: 120_000 });
const db = drizzle(pool, { schema });
const rls = async (userId: number, fn: any) => db.transaction(async (tx: any) => {
  await tx.execute(sql`select set_config('app.user_id', ${String(userId)}, true)`);
  return fn(tx);
});
const deps = {
  db, withUserRls: rls, atomicSeat, releaseSeat, nextWaitlistPosition,
  buildPrereq: async () => ({ ruleByCourse: new Map(), passed: new Map(), titles: new Map(), defaultPassing: 10, unitsPassed: 0, semesterNo: 1 }),
  getDebtThreshold: async () => 0, notifyEnrollmentDone: async () => {},
  // evaluateRegulations intentionally omitted -> REAL engine applies the per-level cap
};

async function setup() {
  for (const L of LEVELS) {
    await db.execute(sql`INSERT INTO degree_level_configs ("id","title","code","defaultPassingGrade","conditionalGpaThreshold")
      VALUES (${L.id}, ${L.title}, ${L.code}, 10, 12) ON CONFLICT ("id") DO UPDATE SET "code"=EXCLUDED."code";`);
    await db.execute(sql`INSERT INTO educational_regulations ("id","title","degreeLevelId","effectiveFromYear","rulesConfig")
      VALUES (${L.id}, ${L.title + ' rules'}, ${L.id}, 1400, ${cfg(L.cap)})
      ON CONFLICT ("id") DO UPDATE SET "rulesConfig"=EXCLUDED."rulesConfig", "degreeLevelId"=EXCLUDED."degreeLevelId";`);
  }
  await warmupCapacities(true);

  let uid = U, sid = S;
  const plans: { level: any; valid: boolean; userId: number; studentId: number; courses: number }[] = [];
  for (const L of LEVELS) {
    const validN = Math.floor(L.cap / 3);            // total units <= cap
    const violN = validN + 1;                         // total units  > cap
    for (let scenario = 0; scenario < 2; scenario++) {
      const valid = scenario === 0;
      const courses = valid ? validN : violN;
      for (let i = 0; i < V; i++) {
        const u = uid++, s = sid++;
        const nc = `${5000000000 + s}`;
        plans.push({ level: L, valid, userId: u, studentId: s, courses });
        await db.execute(sql`INSERT INTO users ("id","nationalCode","firstName","lastName","passwordHash","isActive","universityId")
          VALUES (${u}, ${nc}, 'CAP', 'T', ${PW}, 1, 1) ON CONFLICT ("id") DO NOTHING;`);
        await db.execute(sql`INSERT INTO students ("id","userId","studentCode","degreeLevelId","regulationId","entryYear","status","universityId")
          VALUES (${s}, ${u}, ${'C' + s}, ${L.id}, ${L.id}, 1400, 'ACTIVE', 1) ON CONFLICT ("id") DO NOTHING;`);
        await db.execute(sql`INSERT INTO financial_clearances ("studentId","termId","isCleared","universityId")
          VALUES (${s}, ${TERM}, 1, 1) ON CONFLICT DO NOTHING;`);
        // distinct offerings for this student's cart
        const values = Array.from({ length: courses }, (_, k) => sql`(${s}, ${OFF_E + ((s + k) % OFF_CNT)}, 1)`);
        await db.execute(sql`INSERT INTO cart_items ("studentId","offeringId","universityId") VALUES ${sql.join(values, sql`, `)} ON CONFLICT DO NOTHING;`);
      }
    }
  }
  return plans;
}

async function run(plans: any[]) {
  const out: any[] = []; let idx = 0;
  async function worker() {
    while (true) { const i = idx++; if (i >= plans.length) return; const p = plans[i];
      const r = await processQueuedSubmit(p.userId, p.studentId, true, deps as any);
      out.push({ ...p, ok: r.ok, registered: r.registered.length, hard: (r.hardErrors || [])[0] || '' });
    }
  }
  await Promise.all(Array.from({ length: C }, worker));
  return out;
}

async function main() {
  const plans = await setup();
  const out = await run(plans);
  const matrix: any[] = [];
  for (const L of LEVELS) {
    const validRows = out.filter(o => o.level.id === L.id && o.valid);
    const violRows = out.filter(o => o.level.id === L.id && !o.valid);
    let sampleCap: number | null = null;
    try { sampleCap = (await evaluateStudentRegulationStatus(validRows[0].studentId)).effectiveMaxUnits; } catch (e) { sampleCap = -1; }
    const violAllRejected = violRows.length > 0 && violRows.every(o => !o.ok && /سقف مجاز/.test(o.hard));
    const validAllRegistered = validRows.length > 0 && validRows.every(o => o.ok && o.registered === validRows[0].courses);
    matrix.push({
      level: L.title, code: L.code, cap: L.cap, engineEffectiveMaxUnits: sampleCap,
      validN: validRows[0]?.courses, validCount: validRows.length, validAllRegistered,
      violN: violRows[0]?.courses, violCount: violRows.length, violAllRejected,
      sampleRejectMsg: (violRows.find(o => !o.ok)?.hard || '').slice(0, 70),
    });
  }
  const result = { tool: 'lt3-caps', levels: matrix, generatedAt: new Date().toISOString() };
  fs.writeFileSync('/root/lt3-caps-result.json', JSON.stringify(result, null, 2));
  console.log('SUMMARY_JSON=' + JSON.stringify(result));
  await pool.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e); process.exit(1); });

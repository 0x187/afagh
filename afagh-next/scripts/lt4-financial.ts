/**
 * Test 4 — financial-gate enrollment harness (COMPREHENSIVE).
 *
 * Drives the REAL `processQueuedSubmit` with the REAL financial gate (submit.ts
 * ~125-163: financial_clearances.isCleared + ledger balance vs threshold), the REAL
 * cheque cashing operation (`clearCheque`), and the REAL tuition computation
 * (`computeFormulaTuition`). No HTTP mocks.
 *
 * De-isolated so ONLY the financial gate can cause rejection: unit-cap -> 40,
 * prereq -> empty, notify -> off, debt threshold -> 0 (fail-closed, prod default).
 * atomicSeat/nextWaitlistPosition stubbed to skip Redis; capacity guard stays REAL (DB).
 *
 * Scenarios (each 400 students, reusing the seeded 10k cohort at id S..S+9999):
 *   A valid clearance (علی‌الحساب)                  -> ALLOWED
 *   A2 registered loan (وام: LOAN credit clears)    -> ALLOWED
 *   B no clearance    (بدون واریز)                -> BLOCKED "تسویه‌حساب"
 *   C voided clearance(باط‌شده, isCleared=0)       -> BLOCKED "تسویه‌حساب"
 *   D debt over limit (بدهکاری)                    -> BLOCKED "بدهکاری"
 *   E discount        (تخفیف, net=0)               -> ALLOWED
 *   F prior-term debtor(بدهکار از ترم قبل)          -> BLOCKED "بدهکاری"
 *   G insufficient deposit (علی‌الحساب ناکافی)      -> BLOCKED "بدهکاری" at submit only
 *   H cheque pending future (چک سررسید نشده)         -> BLOCKED "بدهکاری" (uncashed)
 *   H2 cheque cleared  (اعمال/وصول چک -> PAYMENT)   -> ALLOWED
 *   H3 cheque bounced  (چک برگشتی)                   -> BLOCKED "بدهکاری"
 * Plus: شهریه ثابت/متغیر for two unit-counts (fixed constant, variable scales).
 *
 * Mid-selection semantics (user requirement): the financial gate runs ONLY at the
 * final submit (processQueuedSubmit -> submit.ts ~125-163). Adding courses to the
 * cart carries no financial lock, so a student whose debt grows while selecting is
 * never locked out mid-selection — the decision happens once, at submit.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { processQueuedSubmit } from '@/lib/enroll-engine/submit';
import { clearCheque } from '@/lib/finance-engine/payments';
import { computeFormulaTuition } from '@/lib/finance-engine/formulas';
import fs from 'fs';

const S = 1_100_000, U = 1_000_000, OFF_E = 1_400_000, OFF_E_LAST = OFF_E + 19;
const TERM = 1_500_000, PRIOR_TERM = 1_499_000;
const GSZ = 400;
const COHORT = 4400; // 11 scenarios x 400 (A..H3 + A2 loan)
const C = Number(process.env.FIN_CONCURRENCY ?? 16);
const FUTURE = '2027-06-01'; // سررسید خاص/آینده برای چک

// offset ranges per scenario (studentId = S + offset)
const GROUPS: { key: string; start: number; end: number; expect: 'ALLOW' | 'BLOCK'; err: string }[] = [
  { key: 'A_valid_clearance', start: 0, end: 400, expect: 'ALLOW', err: '' },
  { key: 'B_no_clearance', start: 400, end: 800, expect: 'BLOCK', err: 'تسویه‌حساب' },
  { key: 'C_voided', start: 800, end: 1200, expect: 'BLOCK', err: 'تسویه‌حساب' },
  { key: 'D_debt', start: 1200, end: 1600, expect: 'BLOCK', err: 'بدهکاری' },
  { key: 'E_discount', start: 1600, end: 2000, expect: 'ALLOW', err: '' },
  { key: 'F_prior_term_debtor', start: 2000, end: 2400, expect: 'BLOCK', err: 'بدهکاری' },
  { key: 'G_deposit_insufficient', start: 2400, end: 2800, expect: 'BLOCK', err: 'بدهکاری' },
  { key: 'H_cheque_pending_future', start: 2800, end: 3200, expect: 'BLOCK', err: 'بدهکاری' },
  { key: 'H2_cheque_cleared', start: 3200, end: 3600, expect: 'ALLOW', err: '' },
  { key: 'H3_cheque_bounced', start: 3600, end: 4000, expect: 'BLOCK', err: 'بدهکاری' },
  { key: 'A2_loan', start: 4000, end: 4400, expect: 'ALLOW', err: '' },
];
const BLOCKED_RANGES = GROUPS.filter(g => g.expect === 'BLOCK').map(g => [S + g.start, S + g.end - 1]);
const ALLOWED_RANGES = GROUPS.filter(g => g.expect === 'ALLOW').map(g => [S + g.start, S + g.end - 1]);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: C + 4, statement_timeout: 120_000 });
const db = drizzle(pool, { schema });
const rls = async (userId: number, fn: any) => db.transaction(async (tx: any) => {
  await tx.execute(sql`select set_config('app.user_id', ${String(userId)}, true)`);
  return fn(tx);
});
const deps = {
  db, withUserRls: rls,
  atomicSeat: async () => 1,
  releaseSeat: async () => {},
  nextWaitlistPosition: async () => null,
  evaluateRegulations: async () => ({ effectiveMaxUnits: 40 }),
  buildPrereq: async () => ({ ruleByCourse: new Map(), passed: new Map(), titles: new Map(), defaultPassing: 10, unitsPassed: 0, semesterNo: 1 }),
  getDebtThreshold: async () => 0,
  notifyEnrollmentDone: async () => {},
};

async function seedTuitionRule(): Promise<{ how: string }> {
  const dlcRes = await db.execute(sql`SELECT count(*)::int AS c FROM degree_level_configs WHERE id = 900`) as any;
  const dlc900 = Number(dlcRes.rows[0].c);
  const activeRes = await db.execute(sql`SELECT count(*)::int AS c FROM tuition_rules WHERE "isActive" = 1`) as any;
  const nActive = Number(activeRes.rows[0].c);
  if (nActive > 0) return { how: `existing_active_rules=${nActive}` };
  if (dlc900 > 0) {
    await db.execute(sql`INSERT INTO tuition_rules (code,title,"degreeLevelId","fixedAmount","perUnitTheory","perUnitPractical","perUnitGeneral","isActive",priority,"universityId") VALUES ('LT-FIN','LOADTEST FIN',900,1000000,150000,200000,100000,1,100,1)`);
    return { how: 'seeded_degreeLevel900' };
  }
  await db.execute(sql`INSERT INTO tuition_rules (code,title,"fixedAmount","perUnitTheory","perUnitPractical","perUnitGeneral","isActive",priority,"universityId") VALUES ('LT-FIN-WILD','LOADTEST FIN WILDCARD',1000000,150000,200000,100000,1,100,1)`);
  return { how: 'seeded_null_scope (degree_level_configs lacks id 900)' };
}

function classify(ok: boolean, hard: string[]): string {
  if (ok) return 'REGISTERED';
  const joined = (hard || []).join(' | ');
  if (joined.includes('تسویه‌حساب')) return 'CLEARANCE_MISSING';
  if (joined.includes('بدهکاری')) return 'DEBT';
  return 'OTHER:' + joined.slice(0, 70);
}

async function main() {
  console.error(`[lt4-fin] node ${process.version}, C=${C}, cohort=${COHORT}`);
  // ── 0. prior term + reset ──────────────────────────────────────────
  await db.execute(sql`INSERT INTO academic_terms ("id","universityId","termCode","title","isCurrent","isEnrollmentOpen")
    VALUES (${PRIOR_TERM},1,'14050','PRIOR LT TERM',0,0) ON CONFLICT ("id") DO NOTHING`);
  await db.execute(sql.raw(`DELETE FROM enrollments WHERE "offeringId" BETWEEN ${OFF_E} AND ${OFF_E_LAST}`)); // full-offering clean baseline (avoid cross-test contamination on shared offerings)
  await db.execute(sql.raw(`UPDATE course_offerings SET "enrolledCount" = 0 WHERE id BETWEEN ${OFF_E} AND ${OFF_E_LAST}`));
  await db.execute(sql.raw(`DELETE FROM financial_clearances WHERE "studentId" BETWEEN ${S} AND ${S + COHORT - 1}`));
  await db.execute(sql.raw(`DELETE FROM payment_cheques WHERE "studentId" BETWEEN ${S} AND ${S + COHORT - 1}`));
  await db.execute(sql.raw(`DELETE FROM student_ledger WHERE "studentId" BETWEEN ${S} AND ${S + COHORT - 1}`));
  await db.execute(sql.raw(`DELETE FROM cart_items WHERE "studentId" BETWEEN ${S} AND ${S + COHORT - 1}`));

  // ── 1. seed financial state per scenario ──────────────────────────
  const clearVals: string[] = [];
  const ledgerVals: string[] = [];
  const chequeVals: string[] = [];
  const cartVals: string[] = [];
  for (let o = 0; o < COHORT; o++) {
    const sid = S + o;
    const g = GROUPS.find(x => o >= x.start && o < x.end)!;
    // re-seed a fresh cart so the run is self-contained (earlier tests consumed carts)
    const cnt = (o % 10) < 7 ? 6 : 10, step = cnt;
    const seen = new Set<number>();
    for (let k = 0; k < cnt; k++) { const off = OFF_E + ((o * step + k) % 20); if (!seen.has(off)) { seen.add(off); cartVals.push(`(${sid},${off},1)`); } }
    clearVals.push(`(${sid},${TERM},${g.key === 'C_voided' ? 0 : 1},1)`); // B also gets isCleared=1 row so ONLY the "no row" difference isolates B
    // NOTE: to isolate "no clearance row" (B), ensure B has NO row: overwrite after loop
    if (['D_debt'].includes(g.key)) ledgerVals.push(`(${sid},${TERM},'TUITION_CHARGE',5000000,1,'LT chg')`);
    if (['E_discount'].includes(g.key)) { ledgerVals.push(`(${sid},${TERM},'TUITION_CHARGE',5000000,1,'LT chg')`); ledgerVals.push(`(${sid},${TERM},'DISCOUNT_FIXED',5000000,1,'LT disc')`); }
    if (['F_prior_term_debtor'].includes(g.key)) { ledgerVals.push(`(${sid},${PRIOR_TERM},'TUITION_CHARGE',5000000,1,'LT prior chg')`); }
    if (['G_deposit_insufficient'].includes(g.key)) { ledgerVals.push(`(${sid},${TERM},'TUITION_CHARGE',8000000,1,'LT chg')`); ledgerVals.push(`(${sid},${TERM},'PAYMENT',5000000,1,'LT deposit')`); }
    if (['A2_loan'].includes(g.key)) { ledgerVals.push(`(${sid},${TERM},'TUITION_CHARGE',5000000,1,'LT chg')`); ledgerVals.push(`(${sid},${TERM},'LOAN',5000000,1,'LT loan')`); }
    if (['H_cheque_pending_future'].includes(g.key)) { ledgerVals.push(`(${sid},${TERM},'TUITION_CHARGE',5000000,1,'LT chg')`); chequeVals.push(`(${sid},${TERM},'CHK-S${sid}','LT-BANK','001',5000000,'${FUTURE}','PENDING',1)`); }
    if (['H2_cheque_cleared'].includes(g.key)) { ledgerVals.push(`(${sid},${TERM},'TUITION_CHARGE',5000000,1,'LT chg')`); chequeVals.push(`(${sid},${TERM},'CHK-S${sid}','LT-BANK','001',5000000,'${FUTURE}','PENDING',1)`); }
    if (['H3_cheque_bounced'].includes(g.key)) { ledgerVals.push(`(${sid},${TERM},'TUITION_CHARGE',5000000,1,'LT chg')`); chequeVals.push(`(${sid},${TERM},'CHK-S${sid}','LT-BANK','001',5000000,'${FUTURE}','BOUNCED',1)`); }
  }
  // insert clearances (B intentionally pushed isCleared=1 then removed below so the ONLY difference is "no row")
  for (let i = 0; i < clearVals.length; i += 500) {
    await db.execute(sql.raw(`INSERT INTO financial_clearances ("studentId","termId","isCleared","universityId") VALUES ${clearVals.slice(i, i + 500).join(',')}`));
  }
  await db.execute(sql.raw(`DELETE FROM financial_clearances WHERE "studentId" BETWEEN ${S + 400} AND ${S + 799}`)); // B (no clearance) must have NO row
  for (let i = 0; i < ledgerVals.length; i += 500) {
    await db.execute(sql.raw(`INSERT INTO student_ledger ("studentId","termId","transactionType","amount","universityId","description") VALUES ${ledgerVals.slice(i, i + 500).join(',')}`));
  }
  for (let i = 0; i < chequeVals.length; i += 400) {
    await db.execute(sql.raw(`INSERT INTO payment_cheques ("studentId","termId","chequeNo","bankName","branchCode","amount","dueDate","status","universityId") VALUES ${chequeVals.slice(i, i + 400).join(',')}`));
  }
  for (let i = 0; i < cartVals.length; i += 500) {
    await db.execute(sql.raw(`INSERT INTO cart_items ("studentId","offeringId","universityId") VALUES ${cartVals.slice(i, i + 500).join(',')}`));
  }

  // ── 2. اعمال/وصول cheques for H2 (writes PAYMENT to ledger + sets CLEARED) ────
  const h2 = await db.execute(sql.raw(`SELECT "id" FROM payment_cheques WHERE "studentId" BETWEEN ${S + 3200} AND ${S + 3599} ORDER BY "id"`)) as any;
  let cashOk = 0, cashFail = 0;
  for (const row of h2.rows) {
    const r = await clearCheque(Number(row.id));
    if (r.ok) cashOk++; else { cashFail++; console.error('[cash fail]', row.id, r.reason); }
  }

  // ── 3. tuition rule (for شهریه ثابت/متغير) ─────────────────────────
  const rule = await seedTuitionRule();

  // ── 4. gate run (bounded concurrency) ─────────────────────────────
  async function worker(startOff: number, endOff: number, out: any[]) {
    for (let o = startOff; o < endOff; o++) {
      const g = GROUPS.find(x => o >= x.start && o < x.end)!;
      let sig = '';
      try { const r = await processQueuedSubmit(U + o, S + o, true, deps); sig = classify(!!r.ok, r.hardErrors || []); }
      catch (e: any) { sig = 'EXC:' + String(e?.message).slice(0, 60); }
      out.push({ g: g.key, sig });
    }
  }
  const t0 = Date.now();
  const chunk = Math.ceil(COHORT / C);
  const out: any[] = [];
  await Promise.all(Array.from({ length: C }, (_, w) => worker(w * chunk, Math.min((w + 1) * chunk, COHORT), out)));
  const wallMs = Date.now() - t0;

  const perGroup: Record<string, any> = {};
  for (const g of GROUPS) {
    const rows = out.filter(r => r.g === g.key);
    const sigs: Record<string, number> = {};
    for (const r of rows) sigs[r.sig] = (sigs[r.sig] || 0) + 1;
    const wantSig = g.expect === 'ALLOW' ? 'REGISTERED' : (g.err === 'تسویه‌حساب' ? 'CLEARANCE_MISSING' : 'DEBT');
    const pass = (sigs[wantSig] || 0) === GSZ && (g.expect === 'BLOCK' ? (sigs['REGISTERED'] || 0) === 0 : true);
    perGroup[g.key] = { expect: g.expect, total: rows.length, sigs, pass };
  }
  const otherErrs = out.filter(r => r.sig.startsWith('OTHER:') || r.sig.startsWith('EXC:'));

  // ── 5. DB integrity (no leakage) ──────────────────────────────────
  async function countRegistered(a: number, b: number) {
    const r = await db.execute(sql.raw(`SELECT count(DISTINCT "studentId")::int AS c FROM enrollments WHERE "status"='REGISTERED' AND "offeringId" BETWEEN ${OFF_E} AND ${OFF_E_LAST} AND "studentId" BETWEEN ${a} AND ${b}`)) as any;
    return Number(r.rows[0].c);
  }
  let blockedLeak = 0;
  for (const [a, b] of BLOCKED_RANGES) blockedLeak += await countRegistered(a, b);
  const aRegd = await countRegistered(S + 0, S + 399);
  const a2Regd = await countRegistered(S + 4000, S + 4399);
  const eRegd = await countRegistered(S + 1600, S + 1999);
  const h2Regd = await countRegistered(S + 3200, S + 3599);
  const dupRes = await db.execute(sql.raw(`SELECT count(*)::int AS c FROM (SELECT "studentId","offeringId",count(*) n FROM enrollments WHERE "offeringId" BETWEEN ${OFF_E} AND ${OFF_E_LAST} GROUP BY 1,2 HAVING count(*)>1) x`)) as any;
  const overRes = await db.execute(sql.raw(`SELECT count(*)::int AS c FROM course_offerings WHERE id BETWEEN ${OFF_E} AND ${OFF_E_LAST} AND "enrolledCount" > "capacity"`)) as any;
  const mismatchRes = await db.execute(sql.raw(`SELECT count(*)::int AS c FROM course_offerings co WHERE co.id BETWEEN ${OFF_E} AND ${OFF_E_LAST} AND co."enrolledCount" <> (SELECT count(*) FROM enrollments e WHERE e."offeringId" = co.id AND e."status" = 'REGISTERED')`)) as any;
  const integrity = { aRegd, a2Regd, eRegd, h2Regd, blockedLeak, duplicateRows: Number(dupRes.rows[0].c), overCapacityOfferings: Number(overRes.rows[0].c), enrolledCountMismatches: Number(mismatchRes.rows[0].c) };

  // ── 6. شهریه ثابت/متغير for two unit-counts (both group A, both REGISTERED) ─
  const t1 = await computeFormulaTuition(S + 0, TERM);
  const t2 = await computeFormulaTuition(S + 9, TERM);
  const tuition = {
    rule, unitsStudent1: 18, unitsStudent2: 30,
    student1: { buckets: t1.buckets, fixed: t1.fixed, variable: t1.variable, total: t1.total, matched: !!t1.formula },
    student2: { buckets: t2.buckets, fixed: t2.fixed, variable: t2.variable, total: t2.total, matched: !!t2.formula },
    fixedConstant: t1.formula && t2.formula ? t1.fixed === t2.fixed : null,
    variableScales: t1.formula && t2.formula ? t2.variable > t1.variable : null,
    totalConsistent: (!t1.formula || t1.total === t1.fixed + t1.variable) && (!t2.formula || t2.total === t2.fixed + t2.variable),
  };

  const cashOps = { cashed: cashOk, failed: cashFail };
  const allGroupsPass = Object.values(perGroup).every((x: any) => x.pass);
  const integrityPass = integrity.blockedLeak === 0 && integrity.duplicateRows === 0 && integrity.overCapacityOfferings === 0 && integrity.enrolledCountMismatches === 0 && integrity.aRegd === 400 && integrity.a2Regd === 400 && integrity.eRegd === 400 && integrity.h2Regd === 400 && otherErrs.length === 0;
  const result = { tool: 'lt4-financial', cohort: COHORT, C, wallMs, cashOps, perGroup, otherErrors: otherErrs.length, allGroupsPass, integrity, integrityPass, tuition, generatedAt: new Date().toISOString() };
  fs.writeFileSync('/root/lt4-financial-result.json', JSON.stringify(result, null, 2));
  console.log('SUMMARY_JSON=' + JSON.stringify(result));
  await pool.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e); process.exit(1); });

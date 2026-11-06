import 'server-only';
import { sql } from 'drizzle-orm';
import type { AuditTx } from './audit-writer';

/**
 * Acquire a transaction-scoped advisory lock to serialize concurrent
 * operations on the same logical resource (e.g. termId, offeringId).
 *
 * The key is derived from `ns:a:b` using `hashtextextended` (64-bit, no overflow)
 * so that two concurrent transactions on the same resource block each other
 * until the first commits/rolls back.
 */
export async function advisoryLock(tx: AuditTx, ns: string, a: number, b = 0): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${ns}:${a}:${b}`}, 0))`);
}
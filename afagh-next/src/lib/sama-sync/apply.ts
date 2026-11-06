/**
 * اجرای امنِ یک `SyncPlan` روی پایگاه داده.
 *
 * ── قواعدِ سختِ این لایه ──
 *  ۱) **فقط افزودن و پرکردنِ خالی.** هیچ `DELETE` و هیچ `UPDATE` روی مقدارِ
 *     موجود نیست. (حذفِ واحد یا بازنویسیِ نمره تصمیمِ آموزش است، نه اسکریپت.)
 *  ۲) **idempotent.** درج با `ON CONFLICT (studentId, offeringId) DO NOTHING`
 *     و پرکردنِ نمره با شرطِ `gradeValue IS NULL` — اجرای دوبارهٔ همان پلن
 *     هیچ ردیفی را تغییر نمی‌دهد.
 *  ۳) **همه یا هیچ.** کل اجرا در یک تراکنش؛ خطا ⇒ هیچ تغییری نمی‌ماند.
 *  ۴) **ردِ حسابرسی.** یک ردیف در `audit_logs` با زنجیرهٔ هشِ موجود ثبت
 *     می‌شود تا معلوم باشد چه کسی، کِی و با چه پلنی این کار را کرد.
 *  ۵) **بدونِ جدولِ پشتیبانِ موقت.** ساختِ جدولِ `backup_*` در `public` که
 *     ستون‌های شناسهٔ شخصی دارد، گاردِ fail-closed نصب (`scripts/hardening.mjs`)
 *     را می‌شکند و اپ بالا نمی‌آید. بازگشت‌پذیری از روی شناسه‌های درج‌شده در
 *     `audit_logs` انجام می‌شود، نه از روی جدولِ کپی.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { writeAuditEntry } from '@/lib/audit-writer';
import { computeGradeStatus } from '@/lib/grade-utils';
import type { SyncPlan, SyncRunResult } from './types';

export interface ApplyOptions {
  actorUserId?: number | null;
  ipAddress?: string | null;
  /** فقط برای گزارش‌های دستی — اجرای واقعی همیشه از سمت سرور صدا زده می‌شود */
  dryRun?: boolean;
}

export async function applyPlan(plan: SyncPlan, opts: ApplyOptions = {}): Promise<SyncRunResult> {
  if (opts.dryRun) {
    return { ok: true, inserted: 0, gradesFilled: 0, error: 'dry-run: هیچ تغییری اعمال نشد' };
  }
  const inserts = plan.actions.filter((a) => a.kind === 'INSERT_ENROLLMENT');
  const fills = plan.actions.filter((a) => a.kind === 'FILL_GRADE' && a.enrollmentId && a.grade != null);
  if (inserts.length === 0 && fills.length === 0) {
    return { ok: true, inserted: 0, gradesFilled: 0 };
  }

  try {
    const result = await db.transaction(async (tx) => {
      /* ── ۱) درجِ ثبت‌نام‌های تازه ── */
      let inserted = 0;
      const insertedIds: number[] = [];
      const touchedOfferings = new Set<number>();

      for (const a of inserts) {
        const grade = a.grade ?? null;
        const rows = await tx.execute<{ id: number }>(sql`
          INSERT INTO enrollments
            ("studentId", "offeringId", status, "gradeStatus", "gradeValue",
             "originalSamaCode", "universityId", "registeredAt")
          VALUES
            (${a.studentId}, ${a.offeringId}, 'REGISTERED',
             ${computeGradeStatus(grade)}, ${grade},
             ${a.originalSamaCode ?? a.courseCode}, ${plan.universityId}, now())
          ON CONFLICT ("studentId", "offeringId") DO NOTHING
          RETURNING id`);
        if (rows.rows[0]) {
          inserted++;
          insertedIds.push(Number(rows.rows[0].id));
          touchedOfferings.add(a.offeringId);
        }
      }

      /* ── ۲) پرکردنِ نمرهٔ خالی ── */
      let gradesFilled = 0;
      for (const a of fills) {
        const upd = await tx.execute<{ id: number }>(sql`
          UPDATE enrollments
             SET "gradeValue" = ${a.grade},
                 "gradeStatus" = ${computeGradeStatus(a.grade ?? null)}
           WHERE id = ${a.enrollmentId}
             AND "gradeValue" IS NULL
          RETURNING id`);
        if (upd.rows[0]) {
          gradesFilled++;
          touchedOfferings.add(a.offeringId);
        }
      }

      /* ── ۳) هم‌ترازیِ شمارندهٔ ثبت‌نامِ ارائه‌ها ── */
      for (const offeringId of touchedOfferings) {
        await tx.execute(sql`
          UPDATE course_offerings AS o SET "enrolledCount" =
            (SELECT count(*) FROM enrollments e
              WHERE e."offeringId" = o.id AND e.status <> 'DROPPED')
          WHERE o.id = ${offeringId}`);
      }

      /* ── ۴) ردِ حسابرسی ── */
      await writeAuditEntry(tx, {
        actorUserId: opts.actorUserId ?? null,
        action: 'SAMA_SYNC_APPLY',
        entityType: 'enrollments',
        entityId: null,
        ipAddress: opts.ipAddress ?? null,
        details: JSON.stringify({
          termCode: plan.termCode,
          universityId: plan.universityId,
          inserted,
          gradesFilled,
          planActions: plan.actions.length,
          issues: plan.issues.length,
          insertedEnrollmentIds: insertedIds.slice(0, 2000),
        }),
      });

      return { inserted, gradesFilled };
    });

    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, inserted: 0, gradesFilled: 0, error: (e as Error).message };
  }
}

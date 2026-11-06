/**
 * تأیید رسمی کارنامهٔ مالی توسط کارشناس امور مالی.
 *
 * سیاست: کارنامهٔ مالیِ مشاهده‌ایِ پرتال «غیرقابل استناد» است. نسخهٔ دارای
 * رمز استعلام (QR) تنها وقتی برای دانشجو فعال می‌شود که درخواست
 * `FINANCE_STATEMENT` او در کارتابل کارشناس مالی به APPROVED رسیده باشد.
 *
 * منبع حقیقت همان موتور BPM است (student_requests + process_definitions) تا
 * تأیید/رد، تاریخ، کد رهگیری و تاریخچه در کارتابل درخواست‌ها انجام شود — بدون
 * جدول موازی.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { process_definitions, student_requests } from '@/db/schema';

export const FINANCE_STATEMENT_PROCESS_CODE = 'FINANCE_STATEMENT';

export interface FinanceStatementApproval {
  requestId: number;
  trackingCode: string | null;
  approvedAt: Date | null;
}

/**
 * آخرین درخواست تأیید کارنامهٔ مالیِ این پروندهٔ دانشجویی در وضعیت APPROVED.
 * هر پرونده (مقطع) تأیید خودش را دارد؛ multi-degree students جدا هستند.
 */
export async function getFinanceStatementApproval(studentId: number): Promise<FinanceStatementApproval | null> {
  if (!studentId) return null;
  const [row] = await db
    .select({
      requestId: student_requests.id,
      trackingCode: student_requests.trackingCode,
      updatedAt: student_requests.updatedAt,
      status: student_requests.status,
      code: process_definitions.code,
    })
    .from(student_requests)
    .innerJoin(process_definitions, eq(process_definitions.id, student_requests.processId))
    .where(
      and(
        eq(student_requests.studentId, studentId),
        eq(process_definitions.code, FINANCE_STATEMENT_PROCESS_CODE),
        eq(student_requests.status, 'APPROVED'),
      ),
    )
    .orderBy(desc(student_requests.id))
    .limit(1);

  if (!row) return null;
  return {
    requestId: row.requestId,
    trackingCode: row.trackingCode,
    approvedAt: row.updatedAt ?? null,
  };
}

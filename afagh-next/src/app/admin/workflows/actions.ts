'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import {
  advanceWorkflowStep,
  checkAndTriggerSlaTimeouts,
  clearParallelCheckpoint,
  ensureDefaultProcesses,
} from '@/lib/workflow-engine';
import { eventsForRequest, retryPendingWorkflowEvents } from '@/lib/workflow-events';
import { db } from '@/db';
import { process_definitions, process_steps, request_parallel_checkpoints, student_requests, students } from '@/db/schema';
import { and, eq, isNull, or } from 'drizzle-orm';
import { getCurrentUniversity } from '@/lib/university-scope';

/** درخواست باید متعلق به دانشگاه فعال باشد */
async function assertWorkflowRequestInUni(requestId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const uni = await getCurrentUniversity().catch(() => null);
  if (!uni) return { ok: false, error: 'دانشگاه فعال نامشخص است.' };
  const [r] = await db
    .select({ reqUni: student_requests.universityId, stuUni: students.universityId })
    .from(student_requests)
    .leftJoin(students, eq(students.id, student_requests.studentId))
    .where(eq(student_requests.id, requestId))
    .limit(1);
  if (!r) return { ok: false, error: 'درخواست یافت نشد.' };
  const owner = r.reqUni ?? r.stuUni;
  if (owner !== null && owner !== uni.id) return { ok: false, error: 'درخواست متعلق به دانشگاه دیگری است.' };
  return { ok: true };
}

export async function adminApproveWorkflowStepAction(requestId: number, note?: string) {
  const user = await requireRole(['ADMIN', 'EDU_EXPERT', 'FINANCE_EXPERT', 'FINANCE']);
  const scope = await assertWorkflowRequestInUni(requestId);
  if (!scope.ok) return { ok: false, error: scope.error };

  const res = await advanceWorkflowStep({
    requestId,
    actorStaffId: undefined,
    actorRole: user.roles[0] || 'ADMIN',
    action: 'APPROVE',
    note: note || 'تأیید شد.',
  });

  revalidatePath('/admin');
  revalidatePath('/admin/workflows');
  revalidatePath('/student/requests');
  return { ok: true, res };
}

export async function adminRejectWorkflowStepAction(requestId: number, reason: string) {
  const user = await requireRole(['ADMIN', 'EDU_EXPERT', 'FINANCE_EXPERT', 'FINANCE']);
  const scope = await assertWorkflowRequestInUni(requestId);
  if (!scope.ok) return { ok: false, error: scope.error };

  const res = await advanceWorkflowStep({
    requestId,
    actorStaffId: undefined,
    actorRole: user.roles[0] || 'ADMIN',
    action: 'REJECT',
    note: reason,
  });

  revalidatePath('/admin');
  revalidatePath('/admin/workflows');
  revalidatePath('/student/requests');
  return { ok: true, res };
}

export async function adminReturnWorkflowStepAction(requestId: number, note: string) {
  const user = await requireRole(['ADMIN', 'EDU_EXPERT', 'FINANCE_EXPERT', 'FINANCE']);
  const scope = await assertWorkflowRequestInUni(requestId);
  if (!scope.ok) return { ok: false, error: scope.error };

  const res = await advanceWorkflowStep({
    requestId,
    actorStaffId: undefined,
    actorRole: user.roles[0] || 'ADMIN',
    action: 'RETURN_FOR_REVISION',
    note,
  });

  revalidatePath('/admin');
  revalidatePath('/admin/workflows');
  revalidatePath('/student/requests');
  return { ok: true, res };
}

export async function adminEscalateWorkflowStepAction(requestId: number, note?: string) {
  const user = await requireRole(['ADMIN', 'EDU_EXPERT', 'FINANCE_EXPERT', 'FINANCE']);
  const scope = await assertWorkflowRequestInUni(requestId);
  if (!scope.ok) return { ok: false, error: scope.error };

  const res = await advanceWorkflowStep({
    requestId,
    actorStaffId: undefined,
    actorRole: user.roles[0] || 'ADMIN',
    action: 'ESCALATE',
    note: note || 'ارجاع مدیریتی به مقام بالاتر',
  });

  revalidatePath('/admin');
  revalidatePath('/admin/workflows');
  revalidatePath('/student/requests');
  return { ok: true, res };
}

export async function adminClearParallelCheckpointAction(checkpointId: number, notes?: string) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);

  // 🔒 مرز دانشگاه: چک‌پوینت به یک درخواست تعلق دارد؛ همان مرزِ سایر اکشن‌های
  //    این فایل باید اینجا هم اعمال شود (پیش‌تر با checkpointId دلخواه، تسویهٔ
  //    درخواست دانشگاه دیگر پاک می‌شد).
  const [cp] = await db
    .select({ requestId: request_parallel_checkpoints.requestId })
    .from(request_parallel_checkpoints)
    .where(eq(request_parallel_checkpoints.id, checkpointId))
    .limit(1);
  if (!cp) return { ok: false, error: 'چک‌پوینت تسویه یافت نشد.' };
  const scope = await assertWorkflowRequestInUni(cp.requestId);
  if (!scope.ok) return { ok: false, error: scope.error };

  const res = await clearParallelCheckpoint({
    checkpointId,
    notes,
  });

  revalidatePath('/admin');
  revalidatePath('/admin/workflows');
  revalidatePath('/student/requests');
  return { ok: true, res };
}

export async function adminRunSlaTimeoutCheckerAction() {
  const user = await requireRole(['ADMIN']);

  const timeoutResults = await checkAndTriggerSlaTimeouts();

  revalidatePath('/admin');
  revalidatePath('/admin/workflows');
  revalidatePath('/student/requests');
  return { ok: true, count: timeoutResults.length, items: timeoutResults };
}

export async function adminSaveProcessDefinitionAction(data: {
  id?: number;
  code: string;
  title: string;
  category: string;
  description: string;
  feeAmount: number;
  formSchema: any[];
  steps: {
    id?: number;
    stepOrder: number;
    title: string;
    stepType: 'USER' | 'AUTO_INTEGRATION' | 'PARALLEL_GATEWAY';
    roleCode: string;
    slaHours: number;
    timeoutAction: 'ESCALATE' | 'AUTO_APPROVE' | 'AUTO_REJECT' | 'NOTIFY';
    timeoutEscalateToRole?: string;
  }[];
}) {
  const user = await requireRole(['ADMIN']);

  let processId = data.id;

  const uni = await getCurrentUniversity().catch(() => null);
  if (!uni) return { ok: false as const, error: 'دانشگاه فعال نامشخص است.' };
  const uniScope = or(eq(process_definitions.universityId, uni.id), isNull(process_definitions.universityId));

  if (processId) {
    const [cur] = await db.select({ universityId: process_definitions.universityId })
      .from(process_definitions).where(eq(process_definitions.id, processId)).limit(1);
    if (!cur) return { ok: false as const, error: 'فرایند یافت نشد.' };
    if (cur.universityId !== null && cur.universityId !== uni.id) {
      return { ok: false as const, error: 'فرایند متعلق به دانشگاه دیگری است.' };
    }
    await db
      .update(process_definitions)
      .set({
        title: data.title,
        category: data.category,
        description: data.description,
        feeAmount: data.feeAmount,
        formSchema: JSON.stringify(data.formSchema),
      })
      .where(and(eq(process_definitions.id, processId), uniScope));
  } else {
    const [inserted] = await db
      .insert(process_definitions)
      .values({
        universityId: uni.id,
        code: data.code,
        title: data.title,
        category: data.category,
        description: data.description,
        feeAmount: data.feeAmount,
        formSchema: JSON.stringify(data.formSchema),
      })
      .returning();
    processId = inserted.id;
  }

  // به‌روزرسانی گام‌ها — حذف و درج دسته‌جمعی، همه در یک تراکنش
  if (processId && data.steps) {
    await db.transaction(async tx => {
      await tx.delete(process_steps).where(eq(process_steps.processId, processId as number));
      if (data.steps.length) {
        await tx.insert(process_steps).values(
          data.steps.map(s => ({
            processId: processId as number,
            stepOrder: s.stepOrder,
            title: s.title,
            stepType: s.stepType,
            roleCode: s.roleCode,
            slaHours: s.slaHours,
            timeoutAction: s.timeoutAction,
            timeoutEscalateToRole: s.timeoutEscalateToRole,
          })),
        );
      }
    });
  }

  // (بازبینی ۵) کش محلی فرآیندها حذف شد — موتور در هر فراخوانی وضعیت واقعی DB را می‌خواند؛
  // تغییر این‌جا در همهٔ نمونه‌ها بلافاصله اثر می‌کند.
  revalidatePath('/admin/workflows');
  revalidatePath('/student/requests');
  return { ok: true, processId };
}

/** رویدادهای شلیک‌شدهٔ یک پرونده (اثر تجاری هندلرها) — برای شفافیت کارتابل */
export async function adminRequestEventsAction(requestId: number) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  const scope = await assertWorkflowRequestInUni(requestId);
  if (!scope.ok) return { ok: false as const, error: scope.error };
  const rows = await eventsForRequest(requestId);
  return {
    ok: true,
    events: rows.map(e => ({
      id: e.id,
      eventCode: e.eventCode,
      handler: e.handler,
      status: e.status,
      error: e.error,
      attempts: e.attempts,
      firedAt: e.firedAt,
      processedAt: e.processedAt,
    })),
  };
}

/** اجرای دوبارهٔ رویدادهای ناموفق (اثر تجاری که وسط کار خطا داد) */
export async function adminRetryWorkflowEventsAction(limit = 50) {
  await requireRole(['ADMIN']);
  const res = await retryPendingWorkflowEvents(limit);
  revalidatePath('/admin/workflows');
  return { ...res, ok: true };
}

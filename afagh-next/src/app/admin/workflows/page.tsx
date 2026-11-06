import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, ensureDbSchemaPatches } from '@/db';
import {
  process_definitions,
  process_steps,
  request_parallel_checkpoints,
  request_step_logs,
  student_requests,
  students,
  users,
} from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { ensureDefaultProcesses } from '@/lib/workflow-engine';
import { getCurrentUniversity } from '@/lib/university-scope';
import { getWorkflowAnalytics } from '@/lib/workflow-analytics';
import { getExecutiveRealtimeOps } from '@/lib/executive-analytics';
import AdminWorkflowsClient from './AdminWorkflowsClient';

export const dynamic = 'force-dynamic';

export default async function AdminWorkflowsPage() {
  await requireRole(['ADMIN', 'EDU_EXPERT', 'FINANCE_EXPERT', 'FINANCE']);
  await ensureDbSchemaPatches();
  await ensureDefaultProcesses();

  const currentUniversity = await getCurrentUniversity();
  const currentUniversityId = currentUniversity?.id ?? null;
  const scopeOf = (c: any) => (currentUniversityId ? or(eq(c, currentUniversityId), isNull(c)) : undefined);

  const now = new Date();

  // دریافت تمام فرآیندها با محافظت در برابر خطای ستون‌های احتمالی
  let rawProcesses: any[] = [];
  let rawSteps: any[] = [];
  try {
    rawProcesses = await db
      .select()
      .from(process_definitions)
      .where(scopeOf(process_definitions.universityId))
      .orderBy(process_definitions.id);
  } catch (_) {
    try {
      const res = await db.execute(sql`SELECT id, name, category, title, code, is_active FROM process_definitions ORDER BY id`);
      rawProcesses = (res as any).rows || [];
    } catch {
      rawProcesses = [];
    }
  }

  try {
    const procIds = rawProcesses.map((p: any) => p.id).filter((v: any) => Number.isInteger(v));
    rawSteps = procIds.length
      ? await db.select().from(process_steps).where(inArray(process_steps.processId, procIds)).orderBy(process_steps.stepOrder)
      : [];
  } catch (_) {
    try {
      const res = await db.execute(sql`SELECT id, process_id as "processId", title FROM process_steps ORDER BY id`);
      rawSteps = (res as any).rows || [];
    } catch {
      rawSteps = [];
    }
  }

  const processesFormatted = rawProcesses.map(p => {
    let schema: any[] = [];
    try {
      if (p.formSchema) schema = JSON.parse(p.formSchema);
    } catch (_) {}

    const steps = rawSteps.filter(s => s.processId === p.id).map(s => ({
      id: s.id,
      stepOrder: s.stepOrder,
      title: s.title,
      stepType: (s.stepType as any) || 'USER',
      roleCode: s.roleCode || 'USER',
      slaHours: s.slaHours || 48,
      timeoutAction: (s.timeoutAction as any) || 'ESCALATE',
      timeoutEscalateToRole: s.timeoutEscalateToRole || undefined,
    }));

    return {
      id: p.id,
      code: p.code,
      title: p.title,
      category: p.category || 'عمومی',
      description: p.description || '',
      feeAmount: p.feeAmount || 0,
      formSchema: schema,
      steps,
    };
  });

  // دریافت تمام درخواست‌ها برای کارتابل
  const rawRequests = await db
    .select({
      id: student_requests.id,
      trackingCode: student_requests.trackingCode,
      status: student_requests.status,
      created: student_requests.createdAt,
      formData: student_requests.formData,
      currentStepId: student_requests.currentStepId,
      satisfactionScore: student_requests.satisfactionScore,
      // برای میان‌بر «مشاهدهٔ پروندهٔ مالی» در کارتابل (درخواست FINANCE_STATEMENT)
      studentId: student_requests.studentId,
      studentCode: students.studentCode,
      firstName: users.firstName,
      lastName: users.lastName,
      procTitle: process_definitions.title,
      procCode: process_definitions.code,
    })
    .from(student_requests)
    .innerJoin(students, eq(students.id, student_requests.studentId))
    .innerJoin(users, eq(users.id, students.userId))
    .innerJoin(process_definitions, eq(process_definitions.id, student_requests.processId))
    .where(currentUniversityId ? or(
      eq(student_requests.universityId, currentUniversityId),
      eq(students.universityId, currentUniversityId),
      and(isNull(student_requests.universityId), isNull(students.universityId)),
    ) : undefined)
    .orderBy(desc(student_requests.id))
    .limit(50);

  const reqIds = rawRequests.map(r => r.id).filter((v): v is number => Number.isInteger(v));
  const allLogs = reqIds.length
    ? await db.select().from(request_step_logs).where(inArray(request_step_logs.requestId, reqIds))
    : [];
  const allCheckpoints = reqIds.length
    ? await db.select().from(request_parallel_checkpoints).where(inArray(request_parallel_checkpoints.requestId, reqIds))
    : [];

  const inboxFormatted = rawRequests.map(r => {
    let parsedForm: any = {};
    try {
      if (r.formData) parsedForm = JSON.parse(r.formData);
    } catch (_) {}

    const step = rawSteps.find(s => s.id === r.currentStepId);
    const lastLog = allLogs
      .filter(l => l.requestId === r.id && !l.completedAt)
      .sort((a, b) => (b.id || 0) - (a.id || 0))[0];

    let hoursElapsed = 0;
    if (lastLog?.assignedAt) {
      hoursElapsed = Math.round((now.getTime() - new Date(lastLog.assignedAt).getTime()) / (1000 * 3600));
    } else if (r.created) {
      hoursElapsed = Math.round((now.getTime() - new Date(r.created).getTime()) / (1000 * 3600));
    }

    const slaHours = step?.slaHours || 48;
    const isBreached = hoursElapsed > slaHours && r.status !== 'APPROVED' && r.status !== 'REJECTED';

    const reqCheckpoints = allCheckpoints.filter(c => c.requestId === r.id).map(c => ({
      id: c.id,
      departmentCode: c.departmentCode,
      departmentTitle: c.departmentTitle,
      isCleared: c.isCleared || 0,
      notes: c.notes,
    }));

    return {
      id: r.id,
      trackingCode: r.trackingCode,
      studentName: `${r.firstName} ${r.lastName}`,
      studentCode: r.studentCode,
      studentId: r.studentId,
      processTitle: r.procTitle,
      processCode: r.procCode,
      status: r.status,
      created: r.created ? r.created.toISOString() : null,
      currentStepTitle: step?.title || undefined,
      currentRoleCode: step?.roleCode || undefined,
      slaHours,
      hoursElapsed,
      isBreached,
      formData: parsedForm,
      satisfactionScore: r.satisfactionScore,
      checkpoints: reqCheckpoints,
    };
  });

  const analytics = await getWorkflowAnalytics();
  const executiveOps = await getExecutiveRealtimeOps();

  return (
    <AdminWorkflowsClient
      processes={processesFormatted}
      inbox={inboxFormatted}
      analytics={{
        ...analytics,
        urgentCases: executiveOps.urgentCases,
        facultyReports: executiveOps.facultyReports,
      } as any}
    />
  );
}

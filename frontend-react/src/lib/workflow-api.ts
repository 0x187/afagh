// ═══ کلاینت گردش کار (فاز ۸) ═══
import { apiGet, apiPost } from './api';

export type WfStep = {
  id: number; stepOrder: number; title: string; stepType: string;
  roleCode: string; slaHours: number; timeoutAction: string; timeoutEscalateToRole?: string;
};

export type WfProcess = {
  id: number; code: string; title: string; category: string; description: string;
  feeAmount: number; formSchema: unknown[]; steps: WfStep[];
};

export type WfCheckpoint = {
  id: number; departmentCode: string; departmentTitle: string; isCleared: boolean; notes: string | null;
};

export type WfInboxItem = {
  id: number; trackingCode: string; studentName: string; studentCode: string;
  processTitle: string; processCode: string; status: string; created: string | null;
  currentStepTitle: string | null; currentRoleCode: string | null;
  slaHours: number; hoursElapsed: number; isBreached: boolean;
  formData: Record<string, unknown>; satisfactionScore: number | null;
  checkpoints: WfCheckpoint[];
};

export type WfAnalytics = {
  summary: {
    totalRequests: number; activeRequests: number; approvedRequests: number;
    rejectedRequests: number; bounceRatePercent: number; avgSatisfaction: number;
  };
  heatmap: { processId: number; processCode: string; processTitle: string; stepId: number; stepTitle: string; roleCode: string; targetSlaHours: number; avgDurationHours: number; pendingCount: number; breachCount: number; statusLevel: string }[];
  departmentQueues: { roleCode: string; roleTitleFa: string; pendingCount: number; oldestPendingHours: number; avgWaitHours: number }[];
  staffKpiList: { actorRole: string; fullName: string; totalResolved: number; avgMttrHours: number; slaAdherencePercent: number; escalationCount: number; csatScore?: number; productivityScore: number }[];
};

export type WfData = { processes: WfProcess[]; inbox: WfInboxItem[]; analytics: WfAnalytics };

export async function getWorkflows(): Promise<WfData> {
  const res = await apiGet<{ ok: boolean; data: WfData }>('/admin/workflows');
  return res.data;
}

export type WfActionResult = { result: { status: string; nextStepTitle?: string; certificateNumber?: string; targetRole?: string }; events?: { processed: number; failed: number; skipped: number } };

export async function advanceWorkflowStep(requestId: number, action: 'APPROVE' | 'REJECT' | 'RETURN_FOR_REVISION' | 'ESCALATE', note?: string): Promise<WfActionResult> {
  const res = await apiPost<{ ok: boolean; data: WfActionResult }>('/admin/workflows/step', { requestId, action, note: note ?? '' });
  return res.data;
}

export async function clearCheckpoint(checkpointId: number, notes?: string): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/workflows/checkpoint/clear', { checkpointId, notes: notes ?? '' });
}

export async function runSlaCheck(): Promise<{ count: number; items: { requestId: number; trackingCode: string; stepTitle: string; actionTaken: string }[] }> {
  const res = await apiPost<{ ok: boolean; data: { count: number; items: { requestId: number; trackingCode: string; stepTitle: string; actionTaken: string }[] } }>('/admin/workflows/sla-run', {});
  return res.data;
}

export async function saveProcess(input: { id?: number; code: string; title: string; category: string; description: string; feeAmount: number; formSchema: unknown[]; steps: Omit<WfStep, 'id'>[] }): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/workflows/process', input);
}

export type WfEventRow = { id: number; eventCode: string; handler: string; status: string; error: string | null; attempts: number; firedAt: string | null; processedAt: string | null };

export async function getWorkflowEvents(requestId: number): Promise<WfEventRow[]> {
  const res = await apiGet<{ ok: boolean; data: { events: WfEventRow[] } }>(`/admin/workflows/events?requestId=${requestId}`);
  return res.data.events;
}

export async function retryWorkflowEvents(limit = 50): Promise<{ retried: number; ok: number; failed: number }> {
  const res = await apiPost<{ ok: boolean; data: { retried: number; ok: number; failed: number } }>('/admin/workflows/events/retry', { limit });
  return res.data;
}

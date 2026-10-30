// ═══ کلاینت میز دفاع پایان‌نامه ═══
import { apiGet, apiPost } from './api';

export type DefenseJury = { chair: string | null; supervisor: string | null; internal: string | null; external: string | null };

export type DefenseBoardRow = {
  auditId: number; thesisProgressId: number; workflowStatus: string;
  proposalStatus: string | null; proposalSimilarity: number | null;
  irandocUploadStatus: string | null; irandocUploadTracking: string | null;
  defenseRequestStatus: string | null; defenseScheduledAt: string | null;
  defenseConductedAt: string | null; defenseResult: string | null; defenseNote: string | null;
  finalIrandocStatus: string | null; nextProgressReportDue: string | null; titleFa: string | null;
  supervisorId: number | null; supervisorName: string | null; supervisorUserId: number | null;
  studentId: number; studentCode: string; fullName: string; majorName: string | null; majorId: number | null;
  roomName: string | null; sessionStatus: string | null; sessionResult: string | null;
  jury: DefenseJury;
  pool: { id: number; departmentCode: string; roomName: string | null; chair: string | null; internal: string | null; external: string | null } | null;
};

export type DefensePool = {
  id: number; departmentCode: string; majorId: number | null; majorName: string | null;
  chairId: number | null; internalIds: number[]; externalIds: number[];
  roomId: number | null; roomName: string | null; isActive: boolean;
};

export type DefenseBoard = {
  groups: { status: string; rows: DefenseBoardRow[] }[];
  pools: DefensePool[];
  rooms: { id: number; name: string; capacity: number }[];
  staffOptions: { id: number; name: string; rank: string }[];
  majors: { id: number; name: string }[];
  departments: { code: string; name: string }[];
  currentUserId: number;
  canManage: boolean;
};

export async function getDefenseBoard(): Promise<DefenseBoard> {
  const res = await apiGet<{ ok: boolean; data: { board: DefenseBoard } }>('/admin/defense-scheduling');
  return res.data.board;
}

export async function approveProposal(auditId: number, irandocTrackingCode: string): Promise<DefenseBoard> {
  const res = await apiPost<{ ok: boolean; data: { board: DefenseBoard } }>('/admin/defense-scheduling/approve-proposal', { auditId, irandocTrackingCode });
  return res.data.board;
}

export async function supervisorApproveDefense(auditId: number, approved: boolean): Promise<DefenseBoard> {
  const res = await apiPost<{ ok: boolean; data: { board: DefenseBoard } }>('/admin/defense-scheduling/supervisor-approve', { auditId, approved });
  return res.data.board;
}

export async function scheduleDefense(auditId: number, scheduledAt: string): Promise<DefenseBoard> {
  const res = await apiPost<{ ok: boolean; data: { board: DefenseBoard } }>('/admin/defense-scheduling/schedule', { auditId, scheduledAt });
  return res.data.board;
}

export async function recordDefenseResult(input: { auditId: number; result: 'PASSED' | 'FAILED' | 'CONDITIONAL'; minutes?: string; conductedAt: string }): Promise<DefenseBoard> {
  const res = await apiPost<{ ok: boolean; data: { board: DefenseBoard } }>('/admin/defense-scheduling/result', input);
  return res.data.board;
}

export async function saveDefensePool(input: Record<string, unknown>): Promise<DefenseBoard> {
  const res = await apiPost<{ ok: boolean; data: { board: DefenseBoard } }>('/admin/defense-scheduling/pool/save', input);
  return res.data.board;
}

export async function toggleDefensePool(id: number, isActive: boolean): Promise<DefenseBoard> {
  const res = await apiPost<{ ok: boolean; data: { board: DefenseBoard } }>('/admin/defense-scheduling/pool/toggle', { id, isActive });
  return res.data.board;
}

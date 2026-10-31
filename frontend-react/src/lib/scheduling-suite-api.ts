// ═══ کلاینت آیین‌نامه‌ها + تخصیص کارشناس + سوئیت برنامه‌ریزی ═══
import { apiGet, apiPost } from './api';

// ── آیین‌نامه‌ها ──
export type RegulationRow = {
  id: number; title: string; degreeLevelId: number; effectiveFromYear: number;
  effectiveToYear: number | null; rulesConfig: string; universityId: number | null; isActive: boolean;
};
export const getRegulations = () => apiGet<{ ok: boolean; data: { rows: RegulationRow[] } }>('/admin/regulations').then((r) => r.data.rows);
export const getRegulationPresets = () => apiGet<{ ok: boolean; data: Record<string, unknown> }>('/admin/regulations/presets').then((r) => r.data);
export const saveRegulation = (input: Record<string, unknown>) => apiPost<{ ok: boolean; data: { id?: number } }>('/admin/regulations/save', input).then((r) => r.data);
export const deleteRegulation = (id: number) => apiPost('/admin/regulations/delete', { id });

// ── تخصیص کارشناس آموزشی ──
export type EduExpertInit = Record<string, unknown>;
export const getEduExpertInit = () => apiGet<{ ok: boolean; data: EduExpertInit }>('/admin/edu-expert-assign').then((r) => r.data);
export const eduExpertSetClassroomDept = (input: Record<string, unknown>) => apiPost('/admin/edu-expert-assign/classroom/department', input);
export const eduExpertAddClassroom = (input: Record<string, unknown>) => apiPost('/admin/edu-expert-assign/classroom/add', input);
export const eduExpertRemoveClassroom = (input: Record<string, unknown>) => apiPost('/admin/edu-expert-assign/classroom/remove', input);
export const eduExpertSetOffering = (input: Record<string, unknown>) => apiPost('/admin/edu-expert-assign/offering/set', input);
export const eduExpertRemoveOffering = (input: Record<string, unknown>) => apiPost('/admin/edu-expert-assign/offering/remove', input);
export const eduExpertBulkSetOffering = (input: Record<string, unknown>) => apiPost('/admin/edu-expert-assign/offering/bulk-set', input);
export const eduExpertClearTerm = (input: Record<string, unknown>) => apiPost('/admin/edu-expert-assign/term/clear', input);

// ── سوئیت برنامه‌ریزی ──
export type SchedDashboard = Record<string, unknown>;
export type SchedWorkspace = Record<string, unknown>;
export const getSchedDashboard = (termId?: number) =>
  apiGet<{ ok: boolean; data: SchedDashboard }>(`/admin/scheduling/dashboard${termId ? `?termId=${termId}` : ''}`).then((r) => r.data);
export const getSchedWorkspace = (termId?: number) =>
  apiGet<{ ok: boolean; data: SchedWorkspace }>(`/admin/scheduling/workspace${termId ? `?termId=${termId}` : ''}`).then((r) => r.data);
export const getSchedDemands = (termId: number, programId: number) =>
  apiGet<{ ok: boolean; data: { demands: Record<string, unknown>[] } }>(`/admin/scheduling/demands?termId=${termId}&programId=${programId}`).then((r) => r.data.demands);
export const transitionSchedPhase = (termId: number, to: string) =>
  apiPost<{ ok: boolean; data: Record<string, unknown> }>('/admin/scheduling/transition', { termId, to }).then((r) => r.data);
export const supplyGroupDrafts = (input: Record<string, unknown>) =>
  apiPost<{ ok: boolean; data: Record<string, unknown> }>('/admin/scheduling/supply-drafts', input).then((r) => r.data);
export const allocateSections = (input: { termId: number; departmentId: number; offeringIds: number[] }) =>
  apiPost<{ ok: boolean; data: { allocated: number } }>('/admin/scheduling/allocate-sections', input).then((r) => r.data);
export const allocateRoomQuotas = (termId: number) =>
  apiPost<{ ok: boolean; data: { allocated: number } }>('/admin/scheduling/allocate-room-quotas', { termId }).then((r) => r.data);
export const getSchedSmartSuggestions = (input: Record<string, unknown>) =>
  apiPost<{ ok: boolean; data: { suggestions: Record<string, unknown>[] } }>('/admin/scheduling/smart-suggestions', input).then((r) => r.data.suggestions);
export const getSchedHealth = (termId: number) =>
  apiGet<{ ok: boolean; data: Record<string, unknown> }>(`/admin/scheduling/health?termId=${termId}`).then((r) => r.data);
export const generateSchedSessions = (input: Record<string, unknown>) =>
  apiPost<{ ok: boolean; data: Record<string, unknown> }>('/admin/scheduling/generate-sessions', input).then((r) => r.data);
export const checkSchedConflicts = (termId: number) =>
  apiPost<{ ok: boolean; data: Record<string, unknown> }>('/admin/scheduling/check-conflicts', { termId }).then((r) => r.data);
export const getSchedHardConflicts = (termId: number) =>
  apiGet<{ ok: boolean; data: Record<string, unknown> }>(`/admin/scheduling/hard-conflicts?termId=${termId}`).then((r) => r.data);

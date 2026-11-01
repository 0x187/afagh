// ═══ کلاینت آیین‌نامه‌ها + تخصیص کارشناس + سوئیت برنامه‌ریزی ═══
import { apiGet, apiPost } from './api';

// ── آیین‌نامه‌ها ──
export type RegulationRules = Record<string, unknown>;
export type RegulationRow = {
  id: number; title: string; degreeLevelId: number; degreeLevelTitle?: string;
  effectiveFromYear: number; effectiveToYear: number | null;
  rulesConfig: RegulationRules; universityId?: number | null; isActive?: boolean; createdAt?: string | null;
};
export type RegulationDegreeLevel = {
  id: number; levelName: string; title: string | null;
  defaultPassingGrade: number; conditionalGpaThreshold: number; maxUnitsPerTerm: number | null;
};
export type RegulationCenterData = {
  regulations: RegulationRow[];
  degreeLevels: RegulationDegreeLevel[];
  presets: Record<string, RegulationRules>;
};
export type RegulationSaveInput = {
  id?: number;
  title: string;
  degreeLevelId: number;
  effectiveFromYear: number;
  effectiveToYear: number | null;
  rulesConfig: RegulationRules;
};

export const getRegulationCenter = () =>
  apiGet<{ ok: boolean; data: RegulationCenterData }>('/admin/regulations').then((r) => r.data);
export const getRegulations = () => getRegulationCenter().then((d) => d.regulations);
export const getRegulationPresets = () =>
  apiGet<{ ok: boolean; data: { presets: Record<string, RegulationRules> } }>('/admin/regulations/presets').then((r) => r.data.presets);
export const saveRegulation = (input: RegulationSaveInput) =>
  apiPost<{ ok: boolean; data: { id?: number } }>('/admin/regulations/save', input).then((r) => r.data);
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
export type SchedTerm = { id: number; code: string; title: string; isCurrent: boolean };
export type SchedClassroomRow = { id: number; name: string; buildingName: string; capacity: number; roomType: string };
export type SchedProfessorRow = { id: number; name: string; staffCode: string; academicRank: string; departmentName: string };
export type SchedDemandRow = {
  offeringId: number; courseId: number; courseDeptId: number | null; code: string; title: string; units: string; courseType: string;
  capacity: number; groupNumber: number; professorId: number | null; isCoTaught: boolean;
  enrolledCount: number; programId: number; programTitle: string; cohortId: string; cohortTitle: string;
  isSharedService: boolean; offeringScope: string;
};
export type SchedApprovedRow = {
  offeringId: number; code: string; title: string; units: string; courseType: string; groupNumber: number;
  professorId: number | null; professorName: string; capacity: number; enrolledCount: number;
  dayOfWeek: number | null; dayName: string; startTime: string; endTime: string;
  roomId: number | null; roomName: string; buildingName: string;
};
export type SchedMakeupRow = {
  id: number; courseCode: string; courseTitle: string; profName: string; sessionNo: number;
  sessionDate: string; sessionTime: string; replacedSessionId: number | null;
};
export type SchedSessionSummary = { total: number; makeup: number; firstDate: string };
export type SchedWorkspaceData = {
  terms: SchedTerm[]; selectedTermId: number | null;
  classrooms: SchedClassroomRow[]; allocatedRoomIds: number[];
  professors: SchedProfessorRow[]; demands: SchedDemandRow[];
  departments: { id: number; name: string }[];
  availabilities: { staffId: number; dayOfWeek: number; startTime: string; endTime: string; status: string }[];
  sessionsTotal: number; sessionsByOffering: Record<string, SchedSessionSummary>;
  hardConflictCount: number; approvedOfferings: SchedApprovedRow[]; makeupSessions: SchedMakeupRow[];
  termCalendar: { id: number; startJalali: string; endJalali: string; startDate: string } | null;
  cohorts: { entryYear: number; expectedStudents: number }[];
  phases: Record<string, string>;
};
export type SchedDashData = {
  terms: { id: number; title: string; termCode: string; isCurrent: number }[];
  activeTermId: number | null; phase: string; generatedSessionCount: number;
  offerings: Record<string, unknown>[]; rooms: Record<string, unknown>[];
  professors: Record<string, unknown>[]; schedules: Record<string, unknown>[];
};
export type SchedHealthData = {
  termId: number;
  hiddenConflicts: { kind: string; dayOfWeek: number; startTime: string; endTime: string; a: number; b: number }[];
  supplyVsDemand: { courseId: number; title: string; suppliedGroups: number; suggestedGroups: number; gap: number; eligibleStudents: number }[];
  unallocatedShared: { offeringId: number; courseId: number; groupNumber: number }[];
  roomShiftUsage: { classroomId: number; classroomName: string; facultyId: number | null; shift: string; occupiedMinutes: number; utilization: number }[];
  releasedUnused: { classroomId: number; shift: string }[];
  lines: string[];
};
export type SchedConflictItem = { Kind: string; OfferingIDs: number[]; Message: string };
export type SchedHardConflictsData = {
  count: number;
  report: { Conflicts: SchedConflictItem[]; Total: number; Truncated: boolean };
};

export const getSchedDashboard = (termId?: number) =>
  apiGet<{ ok: boolean; data: SchedDashData }>(`/admin/scheduling/dashboard${termId ? `?termId=${termId}` : ''}`).then((r) => r.data);
export const getSchedWorkspace = (termId?: number) =>
  apiGet<{ ok: boolean; data: SchedWorkspaceData }>(`/admin/scheduling/workspace${termId ? `?termId=${termId}` : ''}`).then((r) => r.data);
export const getSchedDemands = (termId: number, programId: number) =>
  apiGet<{ ok: boolean; data: { demands: SchedDemandRow[] } }>(`/admin/scheduling/demands?termId=${termId}&programId=${programId}`).then((r) => r.data.demands);
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
  apiGet<{ ok: boolean; data: SchedHealthData }>(`/admin/scheduling/health?termId=${termId}`).then((r) => r.data);
export const generateSchedSessions = (input: Record<string, unknown>) =>
  apiPost<{ ok: boolean; data: Record<string, unknown> }>('/admin/scheduling/generate-sessions', input).then((r) => r.data);
export const checkSchedConflicts = (termId: number) =>
  apiPost<{ ok: boolean; data: Record<string, unknown> }>('/admin/scheduling/check-conflicts', { termId }).then((r) => r.data);
export const getSchedHardConflicts = (termId: number) =>
  apiGet<{ ok: boolean; data: SchedHardConflictsData }>(`/admin/scheduling/hard-conflicts?termId=${termId}`).then((r) => r.data);

// ═══ Typed client for the 6 admin modules ═══
// virtual-classes · grade-objections · expert-scopes · permissions ·
// universities · sama-sync — one-to-one with the Go endpoints registered in
// AdminAPI.RegisterModule6.

import { apiGet, apiPost } from '@/lib/api';

// ── Virtual classes (BigBlueButton) ──

export type VirtualClassRow = {
  id: number;
  meetingId: string;
  name: string;
  isRunning: boolean;
  participantCount: number;
  lastSyncedAt: string | null;
  lastRunningAt: string | null;
  recordingsCount: number;
  courseCode: string | null;
  courseTitle: string;
  professorName: string;
  termTitle: string | null;
  groupNumber: number;
  enrolledCount: number;
  universityId: number | null;
};

export type VirtualClassTerm = { id: number; title: string; termCode: string };

export function getVirtualClasses(termId?: number | null) {
  const q = termId ? `?termId=${termId}` : '';
  return apiGet<{ ok: boolean; rows: VirtualClassRow[]; terms: VirtualClassTerm[] }>(`/admin/virtual-classes${q}`);
}

export function syncVirtualClassStatus(classroomId?: number | null) {
  return apiPost<{ ok: boolean; updated?: number; error?: string }>('/admin/virtual-classes/sync-status', { classroomId: classroomId ?? null });
}

export function syncVirtualClassRecordings(classroomId?: number | null) {
  return apiPost<{ ok: boolean; classrooms?: number; added?: number; error?: string }>('/admin/virtual-classes/sync-recordings', { classroomId: classroomId ?? null });
}

// ── Grade objections ──

export type GradeObjectionRow = {
  id: number;
  studentName: string;
  studentCode: string | null;
  termTitle: string | null;
  courseCode: string | null;
  courseTitle: string | null;
  gradeAtObjection: string | null;
  gradeStatus: string | null;
  requestText: string;
  status: string;
  reviewerNote: string | null;
  createdAt: string | null;
};

export function getGradeObjections(scope: 'PENDING' | 'OTHER') {
  return apiGet<{ ok: boolean; rows: GradeObjectionRow[] }>(`/admin/grade-objections?status=${scope}`);
}

export function reviewGradeObjection(id: number, decision: 'ACCEPTED' | 'REJECTED', note: string) {
  return apiPost<{ ok: boolean; error?: string }>('/admin/grade-objections/review', { id, decision, note });
}

// ── Expert scopes ──

export type ExpertScopeEntry = { type: string; id: number | null; uni?: number | null };

export type ExpertScopeCandidate = {
  userId: number;
  name: string;
  canEditGrades: boolean;
  scopes: ExpertScopeEntry[];
};

export type ExpertScopeSelect = {
  universities: { id: number; label: string }[];
  faculties: { id: number; label: string }[];
  departments: { id: number; name: string; facultyId: number }[];
  majors: { id: number; name: string; departmentId: number | null }[];
};

export function getExpertScopes() {
  return apiGet<{ ok: boolean; candidates: ExpertScopeCandidate[]; select: ExpertScopeSelect }>('/admin/expert-scopes');
}

export function saveExpertScopes(userId: number, scopes: ExpertScopeEntry[], canEditGrades: boolean) {
  return apiPost<{ ok: boolean; error?: string }>('/admin/expert-scopes/save', { userId, scopes, canEditGrades });
}

// ── Permissions (RBAC matrix) ──

export type PermissionRow = { id: number; code: string; title: string; category: string; description: string };
export type RoleRow = { id: number; code: string; title: string; isSystem: boolean; userCount: number; permissions: string[] };
export type PermissionsWorkspace = { roles: RoleRow[]; permissions: PermissionRow[]; categories: string[] };

export function getPermissionsWorkspace() {
  return apiGet<{ ok: boolean; data: PermissionsWorkspace }>('/admin/permissions');
}

export function saveRolePermissions(roleId: number, codes: string[]) {
  return apiPost<{ ok: boolean; count?: number; error?: string }>('/admin/permissions/save', { roleId, codes });
}

export function createRole(code: string, title: string) {
  return apiPost<{ ok: boolean; id?: number; error?: string }>('/admin/permissions/roles', { code, title });
}

export function deleteRole(roleId: number) {
  return apiPost<{ ok: boolean; error?: string }>('/admin/permissions/roles/delete', { roleId });
}

// ── Universities ──

export type UniversityAdminRow = {
  id: number;
  code: string;
  title: string;
  kind: string;
  status: string;
  saminCode: string | null;
  province: string | null;
  dissolvedAt: string | null;
  isActive: number;
  logoUrl: string | null;
  saminConnected: boolean;
  saminEnabled: boolean;
  lastSyncAt: string | null;
};

export function getUniversitiesAdmin() {
  return apiGet<{ ok: boolean; rows: UniversityAdminRow[] }>('/admin/universities');
}

export function upsertUniversityAdmin(input: { id?: number; code: string; title: string; kind: string; saminCode?: string }) {
  return apiPost<{ ok: boolean; error?: string }>('/admin/universities', input);
}

export function deleteUniversityAdmin(id: number) {
  return apiPost<{ ok: boolean; error?: string }>('/admin/universities/delete', { id });
}

// ── Sama weekly sync ──

export type SamaSyncRun = {
  id: number;
  at: string;
  actor: string | null;
  termCode: string | null;
  inserted: number;
  gradesFilled: number;
};

export type SamaSyncStatus = {
  available: boolean;
  universityTitle: string;
  terms: { termCode: string; title: string; isCurrent: number }[];
  currentTermCode: string | null;
  runs: SamaSyncRun[];
};

export function getSamaSyncStatus() {
  return apiGet<{ ok: boolean; data: SamaSyncStatus }>('/admin/sama-sync');
}

export function triggerSamaSync() {
  return apiPost<{ ok: boolean; error?: string }>('/admin/sama-sync/trigger');
}

// ═══ Client for merging courses and equivalent clusters ═══
import { apiGet, apiPost } from './api';

export type MergeMember = {
  offeringId: number;
  courseCode: string;
  courseTitle: string;
  groupNumber: number;
  enrolledCount: number;
  professorName: string | null;
  mergeKey: string | null;
  slots: string;
};

export type MergeGroup = {
  key: string | null;
  merged: boolean;
  source: 'manual' | 'auto' | 'split' | 'solo';
  totalEnrolled: number;
  members: MergeMember[];
};

export async function getCourseMergeGroups(termId: number): Promise<MergeGroup[]> {
  const res = await apiGet<{ ok: boolean; data: { groups: MergeGroup[] } }>(`/admin/offering-merge?termId=${termId}`);
  return res.data.groups;
}

export async function updateCourseMerge(offeringIds: number[], mode: 'merge' | 'split' | 'auto'): Promise<void> {
  await apiPost('/admin/offering-merge/update', { offeringIds, mode });
}

// ─────────────────── Equivalent clusters ───────────────────

export type EquivCluster = {
  id: number;
  clusterTitle: string;
  isGeneralService: number;
  universityId: number | null;
};

export type EquivCourse = {
  id: number;
  code: string;
  title: string;
  units: number;
  clusterId: number | null;
};

export async function getEquivalenceClusters(): Promise<{ clusters: EquivCluster[]; courses: EquivCourse[] }> {
  const res = await apiGet<{ ok: boolean; data: { clusters: EquivCluster[]; courses: EquivCourse[] } }>('/admin/equivalence-clusters');
  return res.data;
}

export async function createEquivCluster(clusterTitle: string, isGeneralService = false): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/equivalence-clusters', { clusterTitle, isGeneralService });
  return res.data.id;
}

export async function updateEquivCluster(id: number, input: { clusterTitle?: string; isGeneralService?: boolean }): Promise<void> {
  await apiPost('/admin/equivalence-clusters/update', { id, ...input });
}

export async function deleteEquivCluster(id: number): Promise<void> {
  await apiPost('/admin/equivalence-clusters/delete', { id });
}

export async function setEquivClusterMembers(clusterId: number, courseIds: number[]): Promise<void> {
  await apiPost('/admin/equivalence-clusters/members', { clusterId, courseIds });
}

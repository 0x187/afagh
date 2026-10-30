// ═══ کلاینت انتقال دانشجو بین گروه‌های یک درس ═══
import { apiGet, apiPost } from './api';

export type TransferOffering = {
  offeringId: number; groupNumber: number; enrolledCount: number; capacity: number;
  professorName: string; isActive: boolean;
};

export type TransferCourseGroup = {
  courseId: number; code: string; title: string; units: number | null;
  departmentId: number | null; departmentName: string; offerings: TransferOffering[];
};

export type GroupRosterRow = {
  enrollmentId: number; studentId: number; studentCode: string;
  firstName: string; lastName: string; status: string;
};

export type TransferRosterOffer = {
  offeringId: number; courseCode: string; courseTitle: string; groupNumber: number;
  capacity: number; enrolledCount: number; professorName: string;
};

export type TransferResult = {
  ok: boolean; error?: string; warnings?: string[]; blocks?: string[]; enrollmentId?: number;
};

export async function getTransferTargets(termId: number): Promise<TransferCourseGroup[]> {
  const res = await apiGet<{ ok: boolean; data: { courses: TransferCourseGroup[] } }>(`/admin/group-transfer/targets?termId=${termId}`);
  return res.data.courses;
}

export async function getTransferRoster(termId: number, offeringId: number): Promise<{ offer: TransferRosterOffer; roster: GroupRosterRow[] }> {
  const res = await apiGet<{ ok: boolean; data: { offer: TransferRosterOffer; roster: GroupRosterRow[] } }>(`/admin/group-transfer/roster?termId=${termId}&offeringId=${offeringId}`);
  return res.data;
}

export async function getTransferTargetGroups(termId: number, offeringId: number): Promise<{ course?: { courseId: number; code: string; title: string }; groups: TransferOffering[] }> {
  const res = await apiGet<{ ok: boolean; data: { course?: { courseId: number; code: string; title: string }; groups: TransferOffering[] } }>(`/admin/group-transfer/target-groups?termId=${termId}&offeringId=${offeringId}`);
  return res.data;
}

export async function transferStudent(input: { enrollmentId: number; toOfferingId: number; overrideReason?: string }): Promise<TransferResult> {
  const res = await apiPost<{ ok: boolean; data: TransferResult }>('/admin/group-transfer', input);
  return res.data;
}

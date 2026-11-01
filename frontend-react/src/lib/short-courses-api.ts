// ═══ Open courses client (management) ═══
import { apiGet, apiPost } from './api';

export type ShortTermLearner = {
  registrationId: number; id: number; fullName: string; fullNameEn: string; nationalId: string;
  mobile: string; courseId: number; amountPaid: number; discountCode?: string; paymentStatus: string;
  attendanceCount: number; totalSessions: number; finalGrade?: number; isPassed: boolean;
  certificateNumber?: string; certificateIssued: boolean; registeredAt: string;
};

export type ShortTermCourse = {
  id: number; code: string; title: string; titleEn: string; category: string; hours: number;
  tuitionPrice: number; capacity: number; enrolledCount: number; instructorName: string;
  passingGrade: number; maxAbsences: number; status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';
  learners: ShortTermLearner[];
};

export type ShortTermDiscount = {
  id: number; code: string; courseId: number | null; discountPercent: number;
  maxDiscountAmount: number | null; maxUsage: number; usedCount: number; isActive: boolean;
};

export type ShortCoursesData = { courses: ShortTermCourse[]; discounts: ShortTermDiscount[] };

export async function getShortCourses(): Promise<ShortCoursesData> {
  const res = await apiGet<{ ok: boolean; data: ShortCoursesData }>('/admin/short-courses');
  return res.data;
}

export async function createShortCourse(input: Record<string, unknown>): Promise<{ id: number; code: string }> {
  const res = await apiPost<{ ok: boolean; data: { id: number; code: string } }>('/admin/short-courses', input);
  return res.data;
}

export async function addShortTermLearner(input: Record<string, unknown>): Promise<{ learnerId: number; registrationId: number; trackingCode: string }> {
  const res = await apiPost<{ ok: boolean; data: { learnerId: number; registrationId: number; trackingCode: string } }>('/admin/short-courses/learner', input);
  return res.data;
}

export async function updateShortTermRegistration(input: { registrationId: number; attendanceCount?: number; finalGrade?: number | null }): Promise<{ isPassed: boolean; finalGrade: number; attendanceCount: number }> {
  const res = await apiPost<{ ok: boolean; data: { isPassed: boolean; finalGrade: number; attendanceCount: number } }>('/admin/short-courses/registration/update', input);
  return res.data;
}

export async function issueShortTermCertificate(registrationId: number): Promise<{ id: number; certificateNumber: string; verificationHash: string }> {
  const res = await apiPost<{ ok: boolean; data: { id: number; certificateNumber: string; verificationHash: string } }>('/admin/short-courses/certificate', { registrationId });
  return res.data;
}

export async function revokeShortTermCertificate(certificateNumber: string, reason?: string): Promise<void> {
  await apiPost('/admin/short-courses/certificate/revoke', { certificateNumber, reason });
}

export async function updateShortCourseStatus(courseId: number, status: string): Promise<void> {
  await apiPost('/admin/short-courses/status', { courseId, status });
}

export async function syncShortCourseCounts(): Promise<void> {
  await apiPost('/admin/short-courses/sync', {});
}

export async function listShortTermDiscounts(courseId?: number): Promise<ShortTermDiscount[]> {
  const res = await apiGet<{ ok: boolean; data: { rows: ShortTermDiscount[] } }>(`/admin/short-courses/discounts${courseId ? `?courseId=${courseId}` : ''}`);
  return res.data.rows;
}

export async function createShortTermDiscount(input: Record<string, unknown>): Promise<{ id: number; code: string }> {
  const res = await apiPost<{ ok: boolean; data: { id: number; code: string } }>('/admin/short-courses/discounts', input);
  return res.data;
}

export async function toggleShortTermDiscount(id: number, isActive: boolean): Promise<void> {
  await apiPost('/admin/short-courses/discounts/toggle', { id, isActive });
}

export async function confirmShortTermPayment(input: { registrationId: number; paymentRefId: string; amountPaid: number }): Promise<void> {
  await apiPost('/admin/short-courses/payment', input);
}

// ═══ کلاینت پنل مدیر گروه (فاز ۵) ═══
import { apiGet, apiPost } from './api';

export type GmDept = { id: number; name: string; kind: string; via: string };

export async function getGmMe(): Promise<{ dept: GmDept; depts: GmDept[]; staff: { id: number; name: string } }> {
  return apiGet('/group-manager/me');
}

export type GmCourse = {
  id: number;
  code: string;
  title: string;
  theoreticalUnits: number | null;
  practicalUnits: number | null;
  units: number | null;
  courseType: string | null;
  gradingType: string | null;
  affectsGpa: number | null;
  legacyMaliType: number | null;
};

export async function getCourses(): Promise<{ deptName: string; courses: GmCourse[] }> {
  const res = await apiGet<{ ok: boolean; data: { deptName: string; courses: GmCourse[] } }>('/group-manager/courses');
  return res.data;
}

export async function saveCourse(input: {
  id?: number;
  code: string;
  title: string;
  theory: number;
  practical: number;
  courseType: string;
  grading: string;
  affectsGpa: boolean;
  maliType?: number | null;
}): Promise<void> {
  await apiPost('/group-manager/courses', input);
}

export async function deleteCourse(id: number): Promise<void> {
  await apiPost('/group-manager/courses/delete', { id });
}

export type GmSchedule = { id: number; dayOfWeek: number | null; startTime: string; endTime: string; roomId: number | null; roomName: string | null };

export type GmOffering = {
  id: number;
  courseId: number;
  code: string;
  title: string;
  groupNumber: number;
  capacity: number;
  waitlistCapacity: number;
  enrolledCount: number;
  professorId: number | null;
  professorName: string | null;
  targetDegreeLevelId: number | null;
  targetMajorId: number | null;
  entryYearStart: number | null;
  entryYearEnd: number | null;
  schedules: GmSchedule[];
};

export type GmOfferingsData = {
  term: { id: number | null; title: string };
  deptName: string;
  courses: { id: number; code: string; title: string }[];
  offerings: GmOffering[];
  professors: { id: number; name: string }[];
  rooms: { id: number; name: string }[];
  degrees: { id: number; title: string }[];
  majors: { id: number; name: string }[];
  requireChart: boolean;
};

export async function getOfferings(): Promise<GmOfferingsData> {
  const res = await apiGet<{ ok: boolean; data: GmOfferingsData }>('/group-manager/offerings');
  return res.data;
}

export async function saveOffering(input: {
  id?: number;
  courseId: number;
  termId: number;
  group: number;
  capacity: number;
  waitCapacity: number;
  professorId: number | null;
  targetDegreeLevelId: number | null;
  targetMajorId: number | null;
  entryYearStart: number | null;
  entryYearEnd: number | null;
}): Promise<void> {
  await apiPost('/group-manager/offerings', input);
}

export async function deactivateOffering(id: number): Promise<string> {
  const res = await apiPost<{ ok: boolean; message: string }>('/group-manager/offerings/deactivate', { id });
  return res.message;
}

export async function addSchedule(input: { offeringId: number; day: number; start: string; end: string; roomId: number | null }): Promise<string> {
  const res = await apiPost<{ ok: boolean; message: string }>('/group-manager/offerings/schedule', input);
  return res.message;
}

export async function deleteSchedule(id: number): Promise<void> {
  await apiPost('/group-manager/offerings/schedule/delete', { id });
}

export type GmClassroom = {
  id: number;
  name: string;
  code: string | null;
  capacity: number;
  roomType: string | null;
  facultyId: number | null;
  facultyName: string | null;
  floor: string | null;
  rowsCount: number | null;
  colsCount: number | null;
  isActive: number;
};

export async function getClassrooms(): Promise<{ classrooms: GmClassroom[]; faculties: { id: number; name: string }[] }> {
  const res = await apiGet<{ ok: boolean; data: { classrooms: GmClassroom[]; faculties: { id: number; name: string }[] } }>('/group-manager/classrooms');
  return res.data;
}

export async function saveClassroom(input: {
  id?: number;
  name: string;
  code: string;
  capacity: number;
  roomType: string;
  facultyId: number | null;
  floor: string;
  rows?: number | null;
  cols?: number | null;
  isActive?: number;
}): Promise<void> {
  await apiPost('/group-manager/classrooms', input);
}

export async function deleteClassroom(id: number): Promise<void> {
  await apiPost('/group-manager/classrooms/delete', { id });
}

export type GmGrantData = {
  majors: { id: number; name: string }[];
  years: number[];
  majorId: number;
  year: number;
  students: { id: number; studentCode: string; entryYear: number; entryTerm: number | null; majorName: string; fullName: string }[];
  selected: { id: number; studentCode: string; entryYear: number; entryTerm: number | null; majorName: string; fullName: string } | null;
  termOrdinal: number | null;
  versionCode: string | null;
  chartResolved: boolean;
  chartRows: { courseId: number; code: string; title: string; units: number; recommendedSemester: number | null; granted: boolean; isHigher: boolean }[];
};

export async function getGrants(params: { major?: number; year?: number; student?: number }): Promise<GmGrantData> {
  const q = new URLSearchParams();
  if (params.major) q.set('major', String(params.major));
  if (params.year) q.set('year', String(params.year));
  if (params.student) q.set('student', String(params.student));
  const res = await apiGet<{ ok: boolean; data: GmGrantData }>(`/group-manager/grants?${q.toString()}`);
  return res.data;
}

export async function saveGrant(studentId: number, courseId: number, reason: string, revoke = false): Promise<void> {
  await apiPost('/group-manager/grants', { studentId, courseId, reason, revoke });
}

export type GmCompensatoryData = {
  majors: { id: number; name: string }[];
  years: number[];
  year: number;
  students: {
    id: number;
    studentCode: string;
    entryYear: number;
    fullName: string;
    majorName: string;
    compensatoryUnits: number | null;
    previousMajorCode: string | null;
    previousMajorTitle: string | null;
    previousMajorRelation: string | null;
    honorsOverride: number | null;
  }[];
};

export async function getCompensatory(year?: number): Promise<GmCompensatoryData> {
  const qs = year ? `?year=${year}` : '';
  const res = await apiGet<{ ok: boolean; data: GmCompensatoryData }>(`/group-manager/compensatory${qs}`);
  return res.data;
}

export async function saveCompensatory(input: {
  studentId: number;
  previousMajorCode: string;
  previousMajorTitle: string;
  previousMajorRelation: string;
  compensatoryUnits: number;
  honorsOverride: number | null;
}): Promise<void> {
  await apiPost('/group-manager/compensatory', input);
}

export async function bulkCompensatory(year: number, units: number): Promise<void> {
  await apiPost('/group-manager/compensatory/bulk', { year, units });
}

export type GmBypassRow = {
  id: number;
  studentId: number;
  studentCode: string;
  studentName: string;
  courseTitle: string;
  courseCode: string;
  kind: string;
  status: string;
  reasonText: string | null;
  createdAt: string | null;
};

export async function getBypass(): Promise<GmBypassRow[]> {
  const res = await apiGet<{ ok: boolean; requests: GmBypassRow[] }>('/group-manager/bypass');
  return res.requests;
}

export async function decideBypass(input: {
  requestId: number;
  approve: boolean;
  reasonCode?: string;
  reasonText?: string;
}): Promise<void> {
  await apiPost('/group-manager/bypass/decide', input);
}

export type GmEquivItem = {
  sourceTitle: string;
  sourceUnits: number | null;
  sourceGrade: number | null;
  targetCourseCode: string;
  targetCourseTitle: string;
  headComment: string;
};

export type GmEquivRequest = {
  id: number;
  trackingCode: string;
  createdAt: string;
  studentName: string;
  studentCode: string;
  previousUniversity: string;
  sourceCourseTitle: string;
  sourceGrade: number | null;
  sourceUnits: number | null;
  syllabusNote: string;
  items: GmEquivItem[];
};

export async function getEquivalence(): Promise<{ requests: GmEquivRequest[]; ourCourses: { code: string; title: string; units: number }[] }> {
  const res = await apiGet<{ ok: boolean; data: { requests: GmEquivRequest[]; ourCourses: { code: string; title: string; units: number }[] } }>('/group-manager/equivalence');
  return res.data;
}

export async function submitEquivalence(requestId: number, items: GmEquivItem[], note: string): Promise<void> {
  await apiPost('/group-manager/equivalence', { requestId, items, note });
}

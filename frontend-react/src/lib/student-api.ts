// ═══ کلاینت دادهٔ پرتال دانشجو (فاز ۳) ═══
import { apiGet } from './api';

export type StudentGridClass = {
  dayOfWeek: number | null;
  dayName: string;
  startTime: string;
  endTime: string;
  room: string;
  building: string;
  weekType: 'ALL' | 'EVEN' | 'ODD';
};

export type StudentScheduleCourse = {
  enrollmentId: number;
  offeringId: number;
  code: string;
  title: string;
  units: number;
  courseType: string;
  group: number;
  status: string;
  professor: string;
  enrolledCount: number | null;
  capacity: number | null;
  sharedScheduleGroupKey: string | null;
  classes: StudentGridClass[];
  exam: { examDate: string; startTime: string; endTime: string; room: string } | null;
};

export type StudentScheduleData = {
  student: {
    name: string;
    studentCode: string;
    majorName: string;
    degreeTitle: string;
    currentTermNo: number;
    entryYear: number;
  };
  term: { id: number | null; title: string; termCode: string };
  university: { title: string; logoUrl: string | null };
  courses: StudentScheduleCourse[];
};

export async function getStudentSchedule(termId?: number | null): Promise<StudentScheduleData> {
  const qs = termId ? `?termId=${termId}` : '';
  const res = await apiGet<{ ok: boolean; data: StudentScheduleData }>(`/student/schedule${qs}`);
  return res.data;
}

export type StudentMe = {
  id: number;
  studentCode: string;
  status: string;
  entryYear: number;
  majorId: number | null;
  degreeLevelId: number | null;
  universityId: number | null;
};

export async function getStudentMe(): Promise<StudentMe> {
  const res = await apiGet<{ ok: boolean; student: StudentMe }>('/student/me');
  return res.student;
}

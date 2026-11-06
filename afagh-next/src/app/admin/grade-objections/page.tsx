import { requireRole, getSessionUser, getStaffByUser } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { db } from '@/db';
import { and, desc, eq, ne } from 'drizzle-orm';
import {
  academic_terms,
  enrollments,
  grade_objections,
  students,
  users,
} from '@/db/schema';
import { notifyUserMultichannel } from '@/lib/messaging';
import { revalidatePath } from 'next/cache';
import GradeObjectionsClient from './GradeObjectionsClient';

export const dynamic = 'force-dynamic';

export const GRADE_OBJECTION_STATUS_FA: Record<string, string> = {
  PENDING: 'در حال بررسی',
  REVIEWED: 'بررسی شد',
  ACCEPTED: 'پذیرفته شد',
  REJECTED: 'رد شد',
};

export type GradeObjectionItem = {
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

async function loadRows(statusFilter: 'PENDING' | 'OTHER', universityId: number | null): Promise<GradeObjectionItem[]> {
  const where =
    universityId != null
      ? and(
          statusFilter === 'PENDING'
            ? eq(grade_objections.status, 'PENDING')
            : ne(grade_objections.status, 'PENDING'),
          eq(grade_objections.universityId, universityId),
        )
      : statusFilter === 'PENDING'
        ? eq(grade_objections.status, 'PENDING')
        : ne(grade_objections.status, 'PENDING');

  const rows = await db
    .select({
      id: grade_objections.id,
      studentCode: students.studentCode,
      firstName: users.firstName,
      lastName: users.lastName,
      termTitle: academic_terms.title,
      courseCode: grade_objections.courseCode,
      courseTitle: grade_objections.courseTitle,
      gradeAtObjection: grade_objections.gradeAtObjection,
      gradeStatus: enrollments.gradeStatus,
      requestText: grade_objections.requestText,
      status: grade_objections.status,
      reviewerNote: grade_objections.reviewerNote,
      createdAt: grade_objections.createdAt,
    })
    .from(grade_objections)
    .innerJoin(students, eq(students.id, grade_objections.studentId))
    .innerJoin(users, eq(users.id, students.userId))
    .leftJoin(academic_terms, eq(academic_terms.id, grade_objections.termId))
    .leftJoin(enrollments, eq(enrollments.id, grade_objections.enrollmentId))
    .where(where)
    .orderBy(desc(grade_objections.createdAt))
    .limit(statusFilter === 'PENDING' ? 100 : 200);

  return rows.map(r => ({
    id: r.id,
    studentName: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || '—',
    studentCode: r.studentCode,
    termTitle: r.termTitle,
    courseCode: r.courseCode,
    courseTitle: r.courseTitle,
    gradeAtObjection: r.gradeAtObjection != null ? String(r.gradeAtObjection) : null,
    gradeStatus: r.gradeStatus,
    requestText: r.requestText,
    status: r.status,
    reviewerNote: r.reviewerNote,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  }));
}

export default async function GradeObjectionsPage() {
  await requireRole(['ADMIN', 'EDU_EXPERT', 'VICE_EDU']);
  const uni = await getCurrentUniversity().catch(() => null);
  const universityId = uni?.id ?? null;

  const open = await loadRows('PENDING', universityId);
  const history = await loadRows('OTHER', universityId);

  async function reviewAction(
    id: number,
    decision: 'ACCEPTED' | 'REJECTED',
    reviewNote: string,
  ): Promise<{ ok: boolean; error?: string }> {
    'use server';
    try {
      await requireRole(['ADMIN', 'EDU_EXPERT', 'VICE_EDU']);
      const user = await getSessionUser();
      if (!user) return { ok: false, error: 'وارد شوید.' };
      const staff = await getStaffByUser(user.id);
      if (!staff) return { ok: false, error: 'پروندهٔ کارمندی یافت نشد.' };

      const note = (reviewNote ?? '').trim();
      if (note.length < 3) return { ok: false, error: 'یادداشت بررسی الزامی است (حداقل ۳ کاراکتر).' };

      const [ob] = await db
        .select()
        .from(grade_objections)
        .where(eq(grade_objections.id, id))
        .limit(1);
      if (!ob) return { ok: false, error: 'اعتراض یافت نشد.' };
      if (ob.status !== 'PENDING') return { ok: false, error: 'این اعتراض قبلاً بررسی شده است.' };

      await db
        .update(grade_objections)
        .set({
          status: decision,
          reviewerId: staff.id,
          reviewerNote: note,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(grade_objections.id, id));

      revalidatePath('/admin/grade-objections');

      // اطلاع‌رسانی به دانشجو (بهترین تلاش — خطای آن بر نتیجهٔ بررسی اثر ندارد)
      try {
        const [stu] = await db
          .select({ userId: students.userId })
          .from(students)
          .where(eq(students.id, ob.studentId))
          .limit(1);
        if (stu?.userId) {
          await notifyUserMultichannel({
            userId: stu.userId,
            eventCode: decision === 'ACCEPTED' ? 'GRADE_OBJECTION_ACCEPTED' : 'GRADE_OBJECTION_REJECTED',
            text:
              decision === 'ACCEPTED'
                ? `اعتراض شما به نمرهٔ ${ob.courseTitle ?? 'درس'} بررسی و پذیرفته شد.`
                : `اعتراض شما به نمرهٔ ${ob.courseTitle ?? 'درس'} بررسی و رد شد. یادداشت کارشناس: ${note}`,
          }).catch(() => null);
        }
      } catch {
        /* بی‌تأثیر */
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error)?.message || 'خطای ناشناخته' };
    }
  }

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <GradeObjectionsClient
        initialOpen={open}
        initialHistory={history}
        statusFa={GRADE_OBJECTION_STATUS_FA}
        actions={{ reviewAction }}
      />
    </div>
  );
}

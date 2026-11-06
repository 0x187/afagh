'use server';

// اکشن سروری ورود به کلاس مجازی — کلید مخفی BBB هرگز به مرورگر فرستاده نمی‌شود.
//
// 🔒 نقش و نام از سمت سرور تعیین می‌شوند، نه از payload کلاینت:
//    پیش‌تر امضای اکشن `{meetingId, fullName, role}` بود و هر کاربر واردشده
//    (حتی دانشجو) می‌توانست با فراخوانی مستقیم اکشن، `role:'MODERATOR'` بفرستد و
//    URL امضاشده با رمز مدیر اتاق بگیرد (ورود به اتاق فرمان هر کلاس + جعل نام).
//    اکنون: نام از نشست، و MODERATOR فقط برای استادِ همان ارائه (یا نقش‌های
//    آموزشی/مدیریتی پشتیبان) صادر می‌شود؛ در غیر این صورت ATTENDEE.
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { course_offerings, offering_professors, virtual_classrooms } from '@/db/schema';
import { getSessionUser, getStaffByUser } from '@/lib/auth';
import { getBigBlueButtonJoinUrl } from '@/lib/moodle-bbb';
import { createBbbMeeting } from '@/lib/bbb-api';

/** نقش‌هایی که برای پشتیبانی کلاس‌ها مجاز به ورود به‌عنوان مدیر اتاق‌اند */
const SUPPORT_ROLES = ['ADMIN', 'VICE_EDU', 'EDU_EXPERT', 'DEP_HEAD'];

export async function joinVirtualClassAction(params: {
  meetingId: string;
}): Promise<{ ok: boolean; url: string; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, url: '', error: 'ابتدا وارد سامانه شوید.' };

  const meetingId = String(params?.meetingId ?? '').trim();
  if (!meetingId) return { ok: false, url: '', error: 'شناسهٔ جلسه نامعتبر است.' };

  let role: 'MODERATOR' | 'ATTENDEE' = 'ATTENDEE';
  try {
    const staff = await getStaffByUser(user.id);
    if (staff) {
      const rooms = await db
        .select({ offeringId: virtual_classrooms.courseOfferingId })
        .from(virtual_classrooms)
        .where(eq(virtual_classrooms.bbbMeetingId, meetingId));
      const offeringIds = rooms.map(r => r.offeringId);

      if (offeringIds.length) {
        // مالکیت: استادِ اصلی یا استادِ مشترکِ هر یک از عرضه‌های همین جلسه
        const offs = await db
          .select({ id: course_offerings.id, professorId: course_offerings.professorId })
          .from(course_offerings)
          .where(inArray(course_offerings.id, offeringIds));
        if (offs.some(o => o.professorId === staff.id)) {
          role = 'MODERATOR';
        } else {
          const [co] = await db
            .select({ id: offering_professors.id })
            .from(offering_professors)
            .where(and(
              inArray(offering_professors.offeringId, offeringIds),
              eq(offering_professors.staffId, staff.id),
            ))
            .limit(1);
          if (co) role = 'MODERATOR';
        }
      }

      if (user.roles.some(r => SUPPORT_ROLES.includes(r))) role = 'MODERATOR';
    }
  } catch {
    /* در نبود تطبیق، نقش محافظه‌کارانهٔ ATTENDEE می‌ماند */
  }

  // جلسه باید در سرور BBB وجود داشته باشد؛ ساخت تکراری بی‌خطر است (idempotent).
  const [roomRow] = await db
    .select({ name: virtual_classrooms.meetingName, moderatorPw: virtual_classrooms.moderatorPw, attendeePw: virtual_classrooms.attendeePw })
    .from(virtual_classrooms)
    .where(eq(virtual_classrooms.bbbMeetingId, meetingId))
    .limit(1);
  if (!roomRow) return { ok: false, url: '', error: 'این کلاس آنلاین هنوز توسط استاد ساخته نشده است.' };
  const ensured = await createBbbMeeting({
    meetingId,
    name: roomRow.name,
    moderatorPw: roomRow.moderatorPw,
    attendeePw: roomRow.attendeePw,
  });
  if (!ensured.ok) return { ok: false, url: '', error: ensured.error };

  return getBigBlueButtonJoinUrl({
    meetingId,
    fullName: user.name,
    role,
    moderatorPw: roomRow.moderatorPw,
    attendeePw: roomRow.attendeePw,
  });
}

'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { classrooms, faculties, schedules } from '@/db/schema';
import { back, num, requireDepHead, str } from '@/lib/group-manager';
import { classroomOwnedBy, readClassroomUni } from '@/lib/offering-scheduling';

export interface SaveClassroomResult {
  ok: boolean;
  msg?: string;
  err?: string;
  /** شناسهٔ کلاسِ تازه‌ساخته‌شده (فقط برای حالت افزودن) */
  newId?: number;
}

/**
 * ذخیره/افزودن کلاس — بدون redirect تا پس از ذخیره صفحه نویگیت نشود و اسکرولِ
 * کاربر از دست نرود. نتیجه را برمی‌گرداند؛ فرمِ سمت‌کلاینت (useActionState)
 * پیام را سرجای خودش نشان می‌دهد.
 */
export async function saveClassroomAction(
  _prev: SaveClassroomResult | null,
  fd: FormData,
): Promise<SaveClassroomResult> {
  try {
    const { staff: me } = await requireDepHead();
    const id = num(fd, 'id');
    const name = str(fd, 'name'), cap = num(fd, 'cap');
    if (!name || cap <= 0) return { ok: false, err: 'نام کلاس و ظرفیت مثبت الزامی است.' };
    // کد کلاس اختیاری است (درخواست کاربر) — رشتهٔ خالی ⇒ NULL در پایگاه داده
    const code = str(fd, 'code') || null;
    const myUni = me.universityId ?? null;
    // ویرایش فقط روی کلاسِ همین دانشگاه (G3) — کلاس عام/سیستمی (universityId=NULL)
    // هم برای مدیر گروه قابل ویرایش نیست؛ آن‌ها را آموزش می‌سازد.
    if (id) {
      const room = await readClassroomUni(db, id);
      if (!room || !classroomOwnedBy(room.universityId ?? null, myUni))
        return { ok: false, err: 'این کلاس متعلق به دانشگاه شما نیست.' };
    }
    const isActiveRaw = fd.get('isActive');
    const isActive = isActiveRaw == null ? 1 : (Number(isActiveRaw) ? 1 : 0);
    const isExamHall = fd.get('isExamHall') == null ? 0 : 1;
    const examCapacity = num(fd, 'examCapacity') || null;
    // دانشکده — جای «ساختمان» (ساختمان در سامانه تعریف ندارد)؛ فقط دانشکدهٔ همین دانشگاه
    let facultyId: number | null = null;
    let facultyName: string | null = null;
    const facultyRaw = str(fd, 'facultyId');
    if (facultyRaw) {
      const fid = Number(facultyRaw);
      const owned = Number.isInteger(fid) && fid > 0 && myUni != null
        ? await db
            .select({ id: faculties.id, name: faculties.name })
            .from(faculties)
            .where(and(eq(faculties.id, fid), eq(faculties.universityId, myUni)))
            .limit(1)
        : [];
      if (!owned.length) return { ok: false, err: 'دانشکدهٔ انتخاب‌شده متعلق به دانشگاه شما نیست.' };
      facultyId = fid;
      facultyName = owned[0].name;
    }
    // نام دانشکده در ستون قدیمی `buildingName` هم نوشته می‌شود تا صفحه‌هایی که
    // هنوز «ساختمان» را نمایش می‌دهند خالی نمانند (منبع حقیقت: facultyId).
    const vals = { name, code, capacity: cap, roomType: str(fd, 'roomType') || null, facultyId, buildingName: facultyName, floor: str(fd, 'floor') || null, rowsCount: num(fd, 'rows') || null, colsCount: num(fd, 'cols') || null, isActive, isExamHall, examCapacity };
    if (id) {
      await db.update(classrooms).set(vals).where(eq(classrooms.id, id));
    } else {
      const [row] = await db.insert(classrooms).values({ ...vals, universityId: myUni }).returning({ id: classrooms.id });
      if (row) return { ok: true, msg: 'کلاس «' + name + '» افزوده شد.', newId: row.id };
    }
    revalidatePath('/group-manager/classrooms');
    revalidatePath('/group-manager/offerings');
    return { ok: true, msg: 'کلاس «' + name + '» ذخیره شد.' };
  } catch (e) {
    return { ok: false, err: (e as Error)?.message ?? 'خطا در ذخیرهٔ کلاس.' };
  }
}

export async function deleteClassroomAction(fd: FormData) {
  const { staff: me } = await requireDepHead();
  const id = num(fd, 'id');
  const myUni = me.universityId ?? null;
  const room = await readClassroomUni(db, id);
  if (!room || !classroomOwnedBy(room.universityId ?? null, myUni))
    back('/group-manager/classrooms', 'err', 'این کلاس متعلق به دانشگاه شما نیست.');
  const used = await db.select({ id: schedules.id }).from(schedules).where(eq(schedules.roomId, id)).limit(1);
  if (used.length) back('/group-manager/classrooms', 'err', 'این کلاس در برنامهٔ هفتگی استفاده می‌شود — ابتدا برنامه را حذف کنید.');
  await db.delete(classrooms).where(eq(classrooms.id, id));
  revalidatePath('/group-manager/classrooms');
  back('/group-manager/classrooms', 'msg', 'کلاس حذف شد.');
}

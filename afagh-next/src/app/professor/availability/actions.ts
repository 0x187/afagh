'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { professor_availabilities, professor_availability_notes } from '@/db/schema';
import { getStaffByUser, requireRole } from '@/lib/auth';
import { getTimeSlots } from '@/lib/schedule-config';

export interface AvailabilityCell {
  dayIndex: number; // 0..6 (شنبه..جمعه)
  slotIndex: number; // شناسهٔ زنگ در ماتریس (۱..N — از buildTimeSlots)
  status: 'PREF' | 'AVAIL' | 'UNAVAIL';
  /** ساعت شروع/پایان همان زنگ — از UI می‌آید تا با زنگ‌های دانشگاه هم‌تراز باشد */
  startTime?: string;
  endTime?: string;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** بارگذاری ماتریس از professor_availabilities (جدولی که موتور زمان‌بندی می‌خواند) */
export async function loadAvailabilityAction(termId: number): Promise<{ ok: boolean; cells?: AvailabilityCell[]; notes?: string; error?: string }> {
  try {
    const user = await requireRole(['PROFESSOR']);
    const me = await getStaffByUser(user.id);
    if (!me) return { ok: false, error: 'پروندهٔ هیئت علمی یافت نشد.' };
    const rows = await db.select().from(professor_availabilities)
      .where(and(eq(professor_availabilities.staffId, me.id), eq(professor_availabilities.termId, Number(termId))));
    const [noteRow] = await db.select().from(professor_availability_notes)
      .where(and(eq(professor_availability_notes.staffId, me.id), eq(professor_availability_notes.termId, Number(termId)))).limit(1);

    // زنگ‌ها از تنظیمات دانشگاه — نه لیست هارد‌کد (۲ ساعته/۱٫۵ ساعته، ۰۷:۰۰ تا ۲۰:۰۰ و …)
    const teaching = (await getTimeSlots()).filter(s => !s.isBreak);

    const cells: AvailabilityCell[] = [];
    for (const r of rows) {
      const dayIndex = r.dayOfWeek ?? -1;
      if (dayIndex < 0 || dayIndex > 6) continue;
      const slot = teaching.find(t => t.startTime === String(r.startTime).slice(0, 5) && t.endTime === String(r.endTime).slice(0, 5));
      if (!slot) continue;
      cells.push({
        dayIndex, slotIndex: slot.id,
        status: (r.status as 'PREF' | 'AVAIL') || 'AVAIL',
        startTime: slot.startTime, endTime: slot.endTime,
      });
    }
    // سلول‌های ذخیره‌نشده → UNAVAIL (استاد باید فعال علامت بزنند)
    for (let d = 0; d < 7; d++) {
      for (const s of teaching) {
        if (!cells.some(c => c.dayIndex === d && c.slotIndex === s.id)) {
          cells.push({ dayIndex: d, slotIndex: s.id, status: 'UNAVAIL', startTime: s.startTime, endTime: s.endTime });
        }
      }
    }
    return { ok: true, cells, notes: noteRow?.note ?? '' };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'خطا در بارگذاری.' };
  }
}

/** ذخیره — ردیف‌های PREF/AVAIL نوشته می‌شوند؛ UNAVAIL حذف/نوشته نمی‌شود (قرارداد موتور زمان‌بندی) */
export async function saveAvailabilityAction(termId: number, cells: AvailabilityCell[], notes: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requireRole(['PROFESSOR']);
    const me = await getStaffByUser(user.id);
    if (!me) return { ok: false, error: 'پروندهٔ هیئت علمی یافت نشد.' };

    const t = Number(termId);
    if (!t) return { ok: false, error: 'ترم نامعتبر است.' };

    // ساعت هر سلول: اول از خودِ UI، وگرنه از زنگ‌های تنظیمات دانشگاه
    const teaching = (await getTimeSlots()).filter(s => !s.isBreak);
    const byId = new Map(teaching.map(s => [s.id, s]));
    const timeOf = (c: AvailabilityCell): { start: string; end: string } | null => {
      const fromCell = c.startTime && c.endTime && TIME_RE.test(c.startTime) && TIME_RE.test(c.endTime)
        ? { start: c.startTime, end: c.endTime } : null;
      if (fromCell) return fromCell;
      const slot = byId.get(c.slotIndex);
      return slot ? { start: slot.startTime, end: slot.endTime } : null;
    };

    const valid = cells.filter(c =>
      Number.isInteger(c.dayIndex) && c.dayIndex >= 0 && c.dayIndex <= 6 &&
      Number.isInteger(c.slotIndex) && c.slotIndex >= 1 &&
      ['PREF', 'AVAIL', 'UNAVAIL'].includes(c.status) &&
      (c.status === 'UNAVAIL' || timeOf(c) != null),
    );
    if (valid.length !== cells.length) return { ok: false, error: 'سلول‌های نامعتبر در ماتریس.' };

    await db.transaction(async tx => {
      await tx.delete(professor_availabilities)
        .where(and(eq(professor_availabilities.staffId, me.id), eq(professor_availabilities.termId, t)));
      const toInsert = valid
        .filter(c => c.status !== 'UNAVAIL')
        .map(c => {
          const times = timeOf(c)!;
          return {
            staffId: me.id, termId: t, dayOfWeek: c.dayIndex,
            startTime: times.start, endTime: times.end,
            status: c.status,
          };
        }) as (typeof professor_availabilities.$inferInsert)[];
      if (toInsert.length) await tx.insert(professor_availabilities).values(toInsert);
      await tx.insert(professor_availability_notes).values({ staffId: me.id, termId: t, note: String(notes ?? '').slice(0, 2000) })
        .onConflictDoUpdate({
          target: [professor_availability_notes.staffId, professor_availability_notes.termId],
          set: { note: String(notes ?? '').slice(0, 2000), updatedAt: new Date() },
        });
    });

    revalidatePath('/professor/availability');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'خطا در ذخیرهٔ ماتریس.' };
  }
}

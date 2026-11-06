import { NextRequest, NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { course_offerings } from '@/db/schema';
import { requireRole, getSessionUser } from '@/lib/auth';
import { appendAudit } from '@/lib/audit';
import { createLogger } from '@/lib/logger';
import { getCurrentUniversity, isRealUniversityId } from '@/lib/university-scope';
import { groupIntoMerged, mergedGroupKey } from '@/lib/professor-calendar-layout';
import { z } from 'zod';
import { assertCsrf } from '@/lib/security';


export const dynamic = 'force-dynamic';

const log = createLogger({ mod: 'admin.course-merge' });
const ALLOWED = ['ADMIN', 'EDU_EXPERT', 'VICE_EDU'] as const;

const DAYS_FA = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

type OfferingRow = {
  offeringId: number;
  courseCode: string;
  courseTitle: string;
  groupNumber: number;
  enrolledCount: number;
  professorName: string | null;
  mergeKey: string | null;
};

type GroupSource = 'manual' | 'auto' | 'split' | 'solo';

async function guard() {
  try {
    const role = await requireRole([...ALLOWED]);
    if (role instanceof NextResponse) return role;
    return null;
  } catch (e) {
    log.warn('course-merge auth error', { err: e });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
}

export async function GET(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const termId = Number(searchParams.get('termId'));
    if (!Number.isInteger(termId) || termId <= 0) {
      return NextResponse.json({ error: 'invalid_term' }, { status: 400 });
    }
    const universityId = (await getCurrentUniversity().catch(() => null))?.id ?? null;

    const offRows = await db.execute(sql`
      select o.id as "offeringId", c.code as "courseCode", c.title as "courseTitle",
             o."groupNumber" as "groupNumber", o."enrolledCount" as "enrolledCount",
             o."sharedScheduleGroupKey" as "mergeKey",
             (u."firstName" || ' ' || u."lastName") as "professorName"
      from course_offerings o
      join courses c on c.id = o."courseId"
      left join staff s on s.id = o."professorId"
      left join users u on u.id = s."userId"
      where o."termId" = ${termId} and o."isActive" = 1
        ${isRealUniversityId(universityId) ? sql`and o."universityId" = ${universityId}` : sql`and 1 = 0`}
      order by c.title, o."groupNumber"
    `);
    const offerings = (offRows.rows ?? []) as OfferingRow[];

    const slotRows = await db.execute(sql`
      select s."offeringId" as "offeringId", s."dayOfWeek" as "dayOfWeek",
             s."startTime" as "startTime", s."endTime" as "endTime"
      from schedules s
      join course_offerings o on o.id = s."offeringId"
      where o."termId" = ${termId} and s."scheduleType" = 'CLASS'
    `);
    const slotsByOffering = new Map<number, { dayOfWeek: number | null; startTime: string | null; endTime: string | null; roomKey: null }[]>();
    for (const r of (slotRows.rows ?? []) as { offeringId: number; dayOfWeek: number | null; startTime: string | null; endTime: string | null }[]) {
      const list = slotsByOffering.get(Number(r.offeringId)) ?? [];
      list.push({ dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime, roomKey: null });
      slotsByOffering.set(Number(r.offeringId), list);
    }

    const slotText = (id: number): string => {
      const list = slotsByOffering.get(id) ?? [];
      if (list.length === 0) return '—';
      return list
        .map(s => {
          const d = s.dayOfWeek != null && s.dayOfWeek >= 0 && s.dayOfWeek < 7 ? DAYS_FA[s.dayOfWeek] : '?';
          const st = String(s.startTime ?? '').slice(0, 5);
          const en = String(s.endTime ?? '').slice(0, 5);
          return st && en ? `${d} ${st}–${en}` : d;
        })
        .join('، ');
    };

    // دقیقاً همان منطق موتور: کلید دستی وگرنه حدس خودکار از ساعت
    const groups = groupIntoMerged(
      offerings,
      o => o.offeringId,
      o => {
        const manual = String(o.mergeKey ?? '').trim();
        if (manual && !manual.startsWith('SOLO-')) return `K:${manual}`;
        if (manual.startsWith('SOLO-')) return `SOLO:${o.offeringId}`;
        return mergedGroupKey(null, slotsByOffering.get(o.offeringId) ?? []);
      },
    );

    // طبقه‌بندی منبع هر گروه (دستی / خودکار / جدا / تکی) برای فیلتر تب‌ها
    const annotated = groups.map(g => ({
      key: g.key,
      merged: g.merged,
      source: (g.key == null ? 'solo' : g.key.startsWith('K:') ? 'manual' : g.key.startsWith('SOLO:') ? 'split' : 'auto') as GroupSource,
      members: g.members,
    }));

    // scope=manual → فقط ادغام دستی (آنچه موتور نتوانست خودکار ادغام کند — تب پیش‌فرض)
    // scope=other  → بقیه (خودکار / جدا / تکی) — تب دوم
    const rawScope = (searchParams.get('scope') ?? 'all') as string;
    const effectiveScope: 'all' | 'manual' | 'other' =
      rawScope === 'manual' || rawScope === 'other' ? rawScope : 'all';

    const filtered =
      effectiveScope === 'manual'
        ? annotated.filter(g => g.source === 'manual')
        : effectiveScope === 'other'
        ? annotated.filter(g => g.source !== 'manual')
        : annotated;

    const manualCount = annotated.filter(g => g.source === 'manual').length;
    const otherCount = annotated.length - manualCount;

    return NextResponse.json({
      scope: effectiveScope,
      total: annotated.length,
      manualCount,
      otherCount,
      groups: filtered.map(g => ({
        key: g.key,
        merged: g.merged,
        source: g.source,
        totalEnrolled: g.members.reduce((s, m) => s + Number(m.enrolledCount ?? 0), 0),
        members: g.members.map(m => ({
          offeringId: m.offeringId,
          courseCode: m.courseCode,
          courseTitle: m.courseTitle,
          groupNumber: m.groupNumber,
          enrolledCount: Number(m.enrolledCount ?? 0),
          professorName: m.professorName,
          mergeKey: m.mergeKey,
          slots: slotText(m.offeringId),
        })),
      })),
    });
  } catch (e) {
    log.error('course-merge GET failed', e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

const patchSchema = z.object({
  offeringIds: z.array(z.number().int().positive()).min(1).max(100),
  mode: z.enum(['merge', 'split', 'auto']),
});

export async function PATCH(req: NextRequest) {
  // 🔒 گیت CSRF — بدون این، POST سایه‌ای از صفحهٔ مهاجم کوکی نشست را می‌فرستد
  const csrf = assertCsrf(req);
  if (csrf) return csrf;
  const denied = await guard();
  if (denied) return denied;
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
    }
    const { offeringIds, mode } = parsed.data;
    const ids = [...new Set(offeringIds)];

    const rows = await db
      .select({ id: course_offerings.id, termId: course_offerings.termId })
      .from(course_offerings)
      .where(sql`${course_offerings.id} in (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`);
    if (rows.length !== ids.length) {
      return NextResponse.json({ error: 'offering_not_found' }, { status: 404 });
    }
    const termIds = [...new Set(rows.map(r => r.termId))];
    if (termIds.length !== 1) {
      return NextResponse.json({ error: 'mixed_terms' }, { status: 400 });
    }
    const termId = termIds[0];

    // merge → یک کلید مشترک؛ split → کلید یکتای هر ارائه (هرگز ادغام نمی‌شود)؛ auto → null
    const values = new Map<number, string | null>();
    if (mode === 'merge') {
      const key = `M-${termId}-${Math.min(...ids)}`;
      for (const id of ids) values.set(id, key);
    } else if (mode === 'split') {
      for (const id of ids) values.set(id, `SOLO-${id}`);
    } else {
      for (const id of ids) values.set(id, null);
    }

    await db.transaction(async (tx) => {
      for (const [id, key] of values) {
        await tx
          .update(course_offerings)
          .set({ sharedScheduleGroupKey: key })
          .where(eq(course_offerings.id, id));
      }
      await appendAudit(tx, {
        actorUserId: user.id,
        action: 'OFFERING_MERGE_UPDATED',
        entityType: 'course_offering',
        entityId: Math.min(...ids),
        details: JSON.stringify({ mode, offeringIds: ids, termId }),
      });
    });

    return NextResponse.json({ ok: true, mode, count: ids.length });
  } catch (e) {
    log.error('course-merge PATCH failed', e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

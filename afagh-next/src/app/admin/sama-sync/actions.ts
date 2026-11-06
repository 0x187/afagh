'use server';

/**
 * کنش‌های سرورِ صفحهٔ «همگام‌سازی سما → آفاق».
 *
 * ⚠ نکتهٔ امنیتی: پلن هرگز از مرورگر پذیرفته نمی‌شود. حتی در حالت «اجرا»
 * فایل دوباره روی سرور پارس می‌شود و پلن از نو ساخته می‌شود؛ مرورگر فقط
 * می‌گوید «همین ورودی را اجرا کن». اگر مرورگر پلنِ دستکاری‌شده بفرستد،
 * هیچ اثری ندارد چون اصلاً خوانده نمی‌شود.
 */

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { decodeBuffer, parseEnrollmentTsv, parseStudentTsv } from '@/lib/sama-sync/parse';
import { buildPlan } from '@/lib/sama-sync/plan';
import { applyPlan } from '@/lib/sama-sync/apply';
import { planSummary, toMarkdown } from '@/lib/sama-sync/report';
import { loadSnapshot } from '@/lib/sama-sync/snapshot';
import type { SyncStats } from '@/lib/sama-sync/types';

export interface SamaSyncResult {
  ok: boolean;
  error?: string;
  mode?: 'preview' | 'apply';
  markdown?: string;
  summary?: string;
  stats?: SyncStats;
  inserted?: number;
  gradesFilled?: number;
}

async function readFileText(fd: FormData, field: string, enc: string): Promise<string | null> {
  const f = fd.get(field);
  if (!f || typeof f === 'string') return null;
  const buf = new Uint8Array(await (f as File).arrayBuffer());
  if (buf.byteLength === 0) return null;
  return decodeBuffer(buf, enc);
}

export async function samaSyncAction(_prev: SamaSyncResult | null, fd: FormData): Promise<SamaSyncResult> {
  const user = await requireRole(['ADMIN']);
  const uni = await getCurrentUniversity().catch(() => null);
  if (!uni || !(uni.id > 0)) return { ok: false, error: 'دانشگاه فعال مشخص نیست.' };

  const mode = String(fd.get('mode') ?? 'preview') === 'apply' ? 'apply' : 'preview';
  const enc = String(fd.get('enc') ?? 'utf-8');
  const termCode = String(fd.get('term') ?? '').trim();

  const enrollText = await readFileText(fd, 'enrollFile', enc);
  if (!enrollText) return { ok: false, error: 'فایل انتخاب واحد (TSV) انتخاب نشده است.' };

  const parsed = parseEnrollmentTsv(enrollText, { termCode: termCode || undefined });
  if (parsed.rows.length === 0) return { ok: false, error: 'فایل انتخاب واحد هیچ ردیف معتبری نداشت.' };
  const term = termCode || parsed.termCode;
  if (!term) return { ok: false, error: 'کد ترم مشخص نیست (نه در فایل بود و نه انتخاب شد).' };

  const studentsText = await readFileText(fd, 'studentsFile', enc);
  const studentsParsed = studentsText ? parseStudentTsv(studentsText) : { rows: [], warnings: [] as string[] };

  const snapshot = await loadSnapshot({ universityId: uni.id, termCode: term });
  if (!snapshot) return { ok: false, error: `ترم ${term} برای این دانشگاه در آفاق ثبت نشده است.` };

  const plan = buildPlan(
    {
      termCode: term,
      enrollments: parsed.rows,
      students: studentsParsed.rows,
      warnings: [...parsed.warnings, ...studentsParsed.warnings],
    },
    snapshot,
  );

  if (mode === 'preview') {
    return {
      ok: true,
      mode: 'preview',
      markdown: toMarkdown(plan, { source: 'آپلود از صفحهٔ همگام‌سازی' }),
      summary: planSummary(plan),
      stats: plan.stats,
    };
  }

  if (plan.actions.length === 0) {
    return {
      ok: true,
      mode: 'apply',
      inserted: 0,
      gradesFilled: 0,
      summary: 'هیچ عمل قابل اجرایی وجود نداشت — همه‌چیز از قبل همگام بود.',
      stats: plan.stats,
    };
  }

  const result = await applyPlan(plan, { actorUserId: user.id });
  if (!result.ok) return { ok: false, error: `اجرا شکست خورد و برگشت داده شد: ${result.error}`, stats: plan.stats };

  revalidatePath('/admin/sama-sync');
  revalidatePath('/admin/finance');
  return {
    ok: true,
    mode: 'apply',
    inserted: result.inserted,
    gradesFilled: result.gradesFilled,
    summary: `${result.inserted.toLocaleString('fa-IR')} ثبت‌نام افزوده و ${result.gradesFilled.toLocaleString('fa-IR')} نمره پر شد.`,
    stats: plan.stats,
  };
}

export interface SyncRunRow {
  id: number;
  at: string;
  actor: string | null;
  details: Record<string, unknown> | null;
}

/** آخرین اجراهای همگام‌سازی از زنجیرهٔ حسابرسی. */
export async function listSyncRuns(limit = 10): Promise<SyncRunRow[]> {
  await requireRole(['ADMIN']);
  const r = await db.execute<{ id: number; createdAt: string; details: string | null; actor: string | null }>(sql`
    SELECT a.id, a."createdAt", a.details, u."firstName" || ' ' || u."lastName" AS actor
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a."actorUserId"
    WHERE a.action = 'SAMA_SYNC_APPLY'
    ORDER BY a.id DESC
    LIMIT ${limit}`);
  return r.rows.map((x) => {
    // `audit_logs.details` همیشه با پوششِ `{auditFormat, data}` ذخیره می‌شود؛
    // دادهٔ واقعی رشتهٔ JSON داخلِ `data` است.
    let details: Record<string, unknown> | null = null;
    try {
      const outer = JSON.parse(x.details ?? '{}');
      const inner = typeof outer?.data === 'string' ? JSON.parse(outer.data) : outer;
      details = inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : null;
    } catch { details = null; }
    return { id: Number(x.id), at: String(x.createdAt), actor: x.actor, details };
  });
}

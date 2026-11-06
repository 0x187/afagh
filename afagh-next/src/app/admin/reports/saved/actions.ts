'use server';

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity, isRealUniversityId } from '@/lib/university-scope';
import { academic_terms, faculties, financial_terms, majors, saved_reports, users } from '@/db/schema';
import { getField, getSource, type ReportVisibility, type SavedReportConfig } from '../catalog';
import { DEPOSIT_TYPES, LEDGER_TYPES, PAYMENT_STATUSES } from '../catalog/finance';
import { exportCatalogReport, runCatalogReport, type EngineResult } from './engine';
import type { CatalogOptions, SavedReportRow } from './types';

/** نقش‌هایی که می‌توانند گزارش بسازند/ویرایش کنند */
const BUILDER_ROLES = ['ADMIN', 'EDU_EXPERT', 'FINANCE_EXPERT', 'FINANCE'];
/** نقش‌هایی که می‌توانند گزارشِ ذخیره‌شده را اجرا کنند */
const RUNNER_ROLES = [
  'ADMIN', 'EDU_EXPERT', 'ARCHIVE_EXPERT', 'MILITARY_OFFICER',
  'FINANCE_EXPERT', 'FINANCE', 'CASHIER',
];

/** دانشگاهِ فعال — fail-closed (بدونِ آن هیچ گزارشی اجرا نمی‌شود) */
async function currentUniversityId(): Promise<number> {
  const uni = await getCurrentUniversity().catch(() => null);
  if (!isRealUniversityId(uni?.id)) {
    throw new Error('دانشگاهِ فعالِ شما مشخص نیست؛ اجرای گزارش ممکن نیست.');
  }
  return uni.id;
}

type Row = typeof saved_reports.$inferSelect;

/** آیا این کاربر اجازهٔ دیدنِ گزارش را دارد؟ */
function canSee(r: Row, userId: number, roles: string[]): boolean {
  if (r.ownerUserId === userId) return true;
  if (r.visibility === 'PUBLIC') return true;
  if (r.visibility === 'ROLE') {
    const allowed = Array.isArray(r.allowedRoles) ? (r.allowedRoles as string[]) : [];
    return allowed.some(x => roles.includes(x));
  }
  return false;
}

/** آیا این کاربر اجازهٔ استفاده از منبع را دارد؟ */
function canUseSource(sourceKey: string, roles: string[]): boolean {
  const source = getSource(sourceKey);
  if (!source) return false;
  if (!source.roles) return true;
  return source.roles.some(r => roles.includes(r));
}

/** فهرست گزارش‌هایی که کاربر می‌بیند (مالکی + اشتراکی) */
export async function listSavedReports(): Promise<SavedReportRow[]> {
  const me = await requireRole(RUNNER_ROLES);
  const uniId = await currentUniversityId();

  const rows = await db
    .select({
      r: saved_reports,
      ownerName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, '—')`,
    })
    .from(saved_reports)
    .leftJoin(users, eq(users.id, saved_reports.ownerUserId))
    .where(eq(saved_reports.universityId, uniId))
    .orderBy(sql`${saved_reports.updatedAt} DESC`);

  return rows
    .filter(x => canSee(x.r, me.id, me.roles))
    .map(x => {
      const source = getSource(x.r.sourceKey);
      return {
        id: x.r.id,
        name: x.r.name,
        description: x.r.description,
        sourceKey: x.r.sourceKey,
        sourceTitle: source?.title ?? x.r.sourceKey,
        sourceIcon: source?.icon ?? '📄',
        visibility: x.r.visibility as ReportVisibility,
        allowedRoles: Array.isArray(x.r.allowedRoles) ? (x.r.allowedRoles as string[]) : [],
        ownerUserId: x.r.ownerUserId,
        ownerName: x.ownerName ?? '—',
        isOwner: x.r.ownerUserId === me.id,
        createdAt: new Date(x.r.createdAt).toISOString(),
        updatedAt: new Date(x.r.updatedAt).toISOString(),
        config: (x.r.config ?? {}) as SavedReportConfig,
      };
    });
}

/** یک گزارش بر اساس شناسه (با کنترل دسترسی) */
export async function getSavedReport(id: number): Promise<SavedReportRow | null> {
  const me = await requireRole(RUNNER_ROLES);
  const uniId = await currentUniversityId();

  const rows = await db
    .select({ r: saved_reports, ownerName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, '—')` })
    .from(saved_reports)
    .leftJoin(users, eq(users.id, saved_reports.ownerUserId))
    .where(and(eq(saved_reports.id, id), eq(saved_reports.universityId, uniId)))
    .limit(1);

  const x = rows[0];
  if (!x) return null;
  if (!canSee(x.r, me.id, me.roles)) return null;

  const source = getSource(x.r.sourceKey);
  return {
    id: x.r.id,
    name: x.r.name,
    description: x.r.description,
    sourceKey: x.r.sourceKey,
    sourceTitle: source?.title ?? x.r.sourceKey,
    sourceIcon: source?.icon ?? '📄',
    visibility: x.r.visibility as ReportVisibility,
    allowedRoles: Array.isArray(x.r.allowedRoles) ? (x.r.allowedRoles as string[]) : [],
    ownerUserId: x.r.ownerUserId,
    ownerName: x.ownerName ?? '—',
    isOwner: x.r.ownerUserId === me.id,
    createdAt: new Date(x.r.createdAt).toISOString(),
    updatedAt: new Date(x.r.updatedAt).toISOString(),
    config: (x.r.config ?? {}) as SavedReportConfig,
  };
}

/** اعتبارسنجیِ پیکربندی پیش از ذخیره — همان قواعدی که موتور اجرا هم رعایت می‌کند */
function validateConfig(sourceKey: string, config: SavedReportConfig): string | null {
  const source = getSource(sourceKey);
  if (!source) return 'منبعِ نامعتبر است.';

  const cols = config?.columns ?? [];
  if (!cols.length) return 'حداقل یک ستون انتخاب کنید.';
  if (cols.length > 60) return 'تعداد ستون‌های انتخابی بیش از حد است (سقف ۶۰).';

  for (const c of cols) {
    const f = getField(source, c.field);
    if (!f) return `ستونِ نامعتبر: ${c.field}`;
    if (c.agg) {
      // محاسبهٔ ثابت (مثل «ماندهٔ بدهی») با تجمیعِ دلخواه جمع نمی‌شود
      if (f.aggSql) return `ستونِ «${f.title}» محاسبهٔ ثابت دارد؛ تجمیع روی آن مجاز نیست.`;
      // شمارش روی هر ستونِ سطح‌ردیف مجاز است؛ بقیه فقط اگر فیلد عددی باشد
      const counting = c.agg === 'count' || c.agg === 'count_distinct';
      if (!counting && !f.agg?.includes(c.agg)) {
        return `تجمیعِ «${c.agg}» روی «${f.title}» مجاز نیست.`;
      }
    }
  }

  const filters = config?.filters ?? [];
  if (filters.length > 30) return 'تعداد شرط‌ها بیش از حد است (سقف ۳۰).';
  for (const fl of filters) {
    const f = getField(source, fl.field);
    if (!f) return `شرطِ نامعتبر: ${fl.field}`;
    if (!f.filterable) return `ستونِ «${f.title}» قابل فیلتر نیست.`;
    if (f.ops && !f.ops.includes(fl.op)) return `عملگرِ «${fl.op}» روی «${f.title}» مجاز نیست.`;
  }

  for (const g of config?.groupBy ?? []) {
    const f = getField(source, g);
    if (!f || !f.groupable) return `گروه‌بندیِ نامعتبر: ${g}`;
  }

  return null;
}

/** ساخت یا ویرایشِ گزارش */
export async function saveSavedReport(input: {
  id?: number;
  name: string;
  description?: string;
  sourceKey: string;
  config: SavedReportConfig;
  visibility: ReportVisibility;
  allowedRoles?: string[];
}): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    const me = await requireRole(BUILDER_ROLES);
    const uniId = await currentUniversityId();

    if (!canUseSource(input.sourceKey, me.roles)) {
      return { ok: false, error: 'به این منبعِ داده دسترسی ندارید.' };
    }

    const name = String(input.name ?? '').trim();
    if (!name) return { ok: false, error: 'نامِ گزارش را وارد کنید.' };
    if (name.length > 150) return { ok: false, error: 'نامِ گزارش حداکثر ۱۵۰ کاراکتر است.' };

    const invalid = validateConfig(input.sourceKey, input.config);
    if (invalid) return { ok: false, error: invalid };

    const visibility: ReportVisibility = ['PRIVATE', 'ROLE', 'PUBLIC'].includes(input.visibility)
      ? input.visibility : 'PRIVATE';
    const allowedRoles = visibility === 'ROLE'
      ? (input.allowedRoles ?? []).filter(x => typeof x === 'string')
      : [];

    const values = {
      name,
      description: String(input.description ?? '').trim() || null,
      sourceKey: input.sourceKey,
      config: input.config as unknown as Record<string, unknown>,
      visibility,
      allowedRoles: allowedRoles as unknown as Record<string, unknown>[],
      updatedAt: new Date(),
    };

    if (input.id) {
      const existing = await db
        .select({ id: saved_reports.id, ownerUserId: saved_reports.ownerUserId })
        .from(saved_reports)
        .where(and(eq(saved_reports.id, input.id), eq(saved_reports.universityId, uniId)))
        .limit(1);
      const ex = existing[0];
      if (!ex) return { ok: false, error: 'گزارش یافت نشد.' };
      if (ex.ownerUserId !== me.id) return { ok: false, error: 'فقط سازندهٔ گزارش می‌تواند آن را ویرایش کند.' };
      await db.update(saved_reports).set(values).where(eq(saved_reports.id, input.id));
      return { ok: true, id: input.id };
    }

    const [row] = await db
      .insert(saved_reports)
      .values({ ...values, universityId: uniId, ownerUserId: me.id })
      .returning({ id: saved_reports.id });
    return { ok: true, id: row?.id ?? 0 };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes('uq_saved_reports_uni_name')) {
      return { ok: false, error: 'گزارشی با این نام در همین دانشگاه از قبل وجود دارد.' };
    }
    return { ok: false, error: msg };
  }
}

/** حذفِ گزارش (فقط سازنده) */
export async function deleteSavedReport(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireRole(BUILDER_ROLES);
    const uniId = await currentUniversityId();
    const existing = await db
      .select({ id: saved_reports.id, ownerUserId: saved_reports.ownerUserId })
      .from(saved_reports)
      .where(and(eq(saved_reports.id, id), eq(saved_reports.universityId, uniId)))
      .limit(1);
    const ex = existing[0];
    if (!ex) return { ok: false, error: 'گزارش یافت نشد.' };
    if (ex.ownerUserId !== me.id) return { ok: false, error: 'فقط سازندهٔ گزارش می‌تواند آن را حذف کند.' };
    await db.delete(saved_reports).where(eq(saved_reports.id, id));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** اجرای گزارشِ ذخیره‌شده */
export async function runSavedReportAction(
  id: number,
  page = 1,
): Promise<{ ok: true; result: EngineResult } | { ok: false; error: string }> {
  try {
    const me = await requireRole(RUNNER_ROLES);
    const uniId = await currentUniversityId();

    const rows = await db
      .select()
      .from(saved_reports)
      .where(and(eq(saved_reports.id, id), eq(saved_reports.universityId, uniId)))
      .limit(1);
    const r = rows[0];
    if (!r) return { ok: false, error: 'گزارش یافت نشد.' };
    if (!canSee(r, me.id, me.roles)) return { ok: false, error: 'به این گزارش دسترسی ندارید.' };
    if (!canUseSource(r.sourceKey, me.roles)) return { ok: false, error: 'به منبعِ دادهٔ این گزارش دسترسی ندارید.' };

    const result = await runCatalogReport(
      r.sourceKey,
      (r.config ?? {}) as SavedReportConfig,
      { universityId: uniId, page, options: await catalogOptions() },
    );
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** خروجی اکسل/CSV از گزارشِ ذخیره‌شده */
export async function exportSavedReportAction(
  id: number,
): Promise<{ ok: true; header: string[]; lines: string[][] } | { ok: false; error: string }> {
  try {
    const me = await requireRole(RUNNER_ROLES);
    const uniId = await currentUniversityId();

    const rows = await db
      .select()
      .from(saved_reports)
      .where(and(eq(saved_reports.id, id), eq(saved_reports.universityId, uniId)))
      .limit(1);
    const r = rows[0];
    if (!r) return { ok: false, error: 'گزارش یافت نشد.' };
    if (!canSee(r, me.id, me.roles)) return { ok: false, error: 'به این گزارش دسترسی ندارید.' };

    const out = await exportCatalogReport(
      r.sourceKey,
      (r.config ?? {}) as SavedReportConfig,
      { universityId: uniId, options: await catalogOptions() },
    );
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * پیش‌نمایشِ گزارشِ ذخیره‌نشده — همان موتورِ اجرا، ولی بدون ذخیره.
 * (برای دکمهٔ «پیش‌نمایش» در گزارش‌ساز)
 */
export async function previewReportAction(
  sourceKey: string,
  config: SavedReportConfig,
  page = 1,
): Promise<{ ok: true; result: EngineResult } | { ok: false; error: string }> {
  try {
    const me = await requireRole(BUILDER_ROLES);
    const uniId = await currentUniversityId();
    if (!canUseSource(sourceKey, me.roles)) {
      return { ok: false, error: 'به این منبعِ داده دسترسی ندارید.' };
    }
    const invalid = validateConfig(sourceKey, config);
    if (invalid) return { ok: false, error: invalid };

    const result = await runCatalogReport(sourceKey, config, {
      universityId: uniId,
      page,
      options: await catalogOptions(),
    });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** گزینه‌های پویای فیلترها (نیمسال‌ها، انواع واریز و…) */
async function catalogOptions(): Promise<CatalogOptions> {  const [terms, finTerms, depositRows, facRows, majorRows] = await Promise.all([
    db.select({ v: academic_terms.termCode, l: academic_terms.title }).from(academic_terms).orderBy(sql`${academic_terms.termCode} DESC`).limit(60),
    db.select({ v: financial_terms.termCode, l: financial_terms.title }).from(financial_terms).orderBy(sql`${financial_terms.termCode} DESC`).limit(60),
    db.selectDistinct({ v: sql<string>`"depositType"` }).from(sql`student_ledger`).where(sql`"depositType" IS NOT NULL`).limit(40),
    db.select({ v: sql<string>`fc."id"::text`, l: sql<string>`fc."name"` }).from(sql`faculties fc`).orderBy(sql`fc."name"`).limit(80),
    db.select({ v: sql<string>`m."id"::text`, l: sql<string>`m."name"` }).from(sql`majors m`).orderBy(sql`m."name"`).limit(200),
  ]);

  const deposits = DEPOSIT_TYPES.slice();
  for (const d of depositRows) {
    const v = String(d.v ?? '').trim();
    if (v && !deposits.some(x => x.value === v)) deposits.push({ value: v, label: v });
  }

  return {
    terms: terms.map(t => ({ value: t.v, label: t.l ?? t.v })),
    financialTerms: finTerms.map(t => ({ value: t.v, label: t.l ?? t.v })),
    depositTypes: deposits,
    ledgerTypes: LEDGER_TYPES,
    paymentStatuses: PAYMENT_STATUSES,
    faculties: facRows.map(f => ({ value: f.v, label: f.l })),
    majors: majorRows.map(m => ({ value: m.v, label: m.l })),
  };
}

/** گزینه‌های پویا برای صفحهٔ گزارش‌ساز */
export async function getCatalogOptions(): Promise<CatalogOptions> {
  await requireRole(BUILDER_ROLES);
  return catalogOptions();
}

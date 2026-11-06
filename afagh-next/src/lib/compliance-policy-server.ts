// ════════════════════════════════════════════════════════════════════════════
//  لایهٔ سروری سیاستهای انطباق — خواندن دامنهدارِ اوررایدها، حل هوشمند
//  آییننامهٔ حاکم، و سازگاری با تنظیمات/پیکربندیهای قدیمی.
//
//  «هوشمندانه» یعنی:
//    • آییننامه بر اساس سال ورود + مقطع + دانشگاه + بازهٔ اثر حل میشود (مادهٔ ۵۳)،
//      نه «اولین ردیف جدول».
//    • اورراید دامنهدار است: دانشگاه → مقطع → آییننامه → سال ورود؛ خاصترین برنده است.
//    • اگر ردیف ۱۴۰۲ ارشد/دکتری در دیتابیس نباشد، پریست قانونی جایگزین میشود
//      (بدون نیاز به seed اجباری و بدون ریختن مقادیر کارشناسی روی ارشد).
//    • پیکربندی کهنهای که قانون لازمالاجرا را نقض میکند اعمال نمیشود، ولی
//      اورراید صریح و مستدل مدیر همچنان مقدم است.
//    • کش کوتاهمدت + ابطال صریح ⇒ بدون کوئری اضافی در مسیرهای داغ.
// ════════════════════════════════════════════════════════════════════════════
import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  compliance_policy_overrides,
  degree_level_configs,
  educational_regulations,
  students,
} from '@/db/schema';
import { getSetting } from '@/lib/settings';
import { maghtaGroup, REGULATION_PRESETS } from '@/lib/regulations-types';
import {
  POLICY_BY_KEY,
  normalizePolicyValue,
  resolveCompliance,
  type ComplianceContext,
  type ComplianceKey,
  type ComplianceLevel,
  type ComplianceValues,
  type ComplianceLayers,
  type FailedCoursePolicy,
  type RegulationFamily,
  type ResolvedCompliance,
} from './compliance-policy';

const OVERRIDE_TTL_MS = 5_000;
let overrideCache: { at: number; rows: OverrideRow[] } | null = null;

export interface OverrideRow {
  id: number;
  universityId: number | null;
  degreeLevelId: number | null;
  regulationId: number | null;
  entryYear: number | null;
  key: string;
  value: unknown;
  reason: string;
  updatedAt: Date | null;
}

export function invalidateComplianceCache() { overrideCache = null; }

async function allOverrides(): Promise<OverrideRow[]> {
  if (overrideCache && Date.now() - overrideCache.at < OVERRIDE_TTL_MS) return overrideCache.rows;
  let rows: OverrideRow[] = [];
  try {
    const raw = await db.select().from(compliance_policy_overrides);
    rows = raw.map(r => ({
      id: r.id,
      universityId: r.universityId ?? null,
      degreeLevelId: r.degreeLevelId ?? null,
      regulationId: r.regulationId ?? null,
      entryYear: r.entryYear ?? null,
      key: r.key,
      value: r.value,
      reason: r.reason ?? '',
      updatedAt: r.updatedAt ?? null,
    }));
  } catch {
    // جدول پیش از مهاجرت وجود ندارد ⇒ بدون اورراید، فقط پیشفرض قانونی
    rows = [];
  }
  overrideCache = { at: Date.now(), rows };
  return rows;
}

/** امتیاز دقیقبودن دامنه — هر چه خاصتر، مقدمتر */
function scopeScore(r: OverrideRow): number {
  return (r.universityId != null ? 1 : 0) +
    (r.degreeLevelId != null ? 2 : 0) +
    (r.regulationId != null ? 4 : 0) +
    (r.entryYear != null ? 8 : 0);
}

function scopeMatches(r: OverrideRow, ctx: ComplianceContext): boolean {
  if (r.universityId != null && r.universityId !== ctx.universityId) return false;
  if (r.degreeLevelId != null && r.degreeLevelId !== ctx.degreeLevelId) return false;
  if (r.regulationId != null && r.regulationId !== ctx.regulationId) return false;
  if (r.entryYear != null && r.entryYear !== ctx.entryYear) return false;
  return true;
}

function overridesFor(ctx: ComplianceContext, rows: readonly OverrideRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const best = new Map<string, number>();
  for (const r of rows) {
    if (!scopeMatches(r, ctx)) continue;
    const s = scopeScore(r);
    if ((best.get(r.key) ?? -1) <= s) { best.set(r.key, s); out[r.key] = r.value; }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
//  تشخیص مقطع و خانوادهٔ آییننامه
// ════════════════════════════════════════════════════════════════════════════

export function toComplianceLevel(codeOrTitle: string | number | null | undefined): ComplianceLevel {
  return maghtaGroup(codeOrTitle) as ComplianceLevel;
}

/** «آییننامهٔ ۱۴۰۲» با هر برچسب فارسی/لاتینی که نوشته شده باشد شناسایی میشود. */
export function toRegulationFamily(row: {
  title?: string | null;
  effectiveFromYear?: number | null;
  rulesConfig?: string | null;
}): RegulationFamily {
  const hay = `${row.title ?? ''} ${String(row.rulesConfig ?? '').slice(0, 400)}`;
  const has1402 = /۱۴۰۲|1402/.test(hay);
  const y = Number(row.effectiveFromYear ?? 0);
  return (has1402 && y >= 1402) || (!row.effectiveFromYear && has1402) ? 'REG_1402' : 'LEGACY';
}

function safeParseRules(raw: unknown): Record<string, any> {
  if (raw && typeof raw === 'object') return raw as Record<string, any>;
  try { return JSON.parse(String(raw ?? '{}')) || {}; } catch { return {}; }
}

// ════════════════════════════════════════════════════════════════════════════
//  بافت دانشجو + حل نهایی سیاستها
// ════════════════════════════════════════════════════════════════════════════

export interface StudentComplianceContext extends ComplianceContext {
  studentId: number;
  studentStatus: string | null;
  degreeTitle: string | null;
  regulationTitle: string | null;
  rulesConfig: Record<string, any>;
}

/** یک کوئری join برای ساخت بافت؛ اگر رکورد ناقص باشد بدون شکستن ادامه میدهد. */
export async function loadStudentComplianceContext(studentId: number): Promise<StudentComplianceContext | null> {
  const [row] = await db
    .select({
      studentId: students.id,
      status: students.status,
      entryYear: students.entryYear,
      universityId: students.universityId,
      degreeLevelId: students.degreeLevelId,
      degreeCode: degree_level_configs.code,
      degreeTitle: degree_level_configs.title,
      regulationId: educational_regulations.id,
      regulationTitle: educational_regulations.title,
      effectiveFromYear: educational_regulations.effectiveFromYear,
      rulesConfig: educational_regulations.rulesConfig,
    })
    .from(students)
    .leftJoin(degree_level_configs, eq(degree_level_configs.id, students.degreeLevelId))
    .leftJoin(educational_regulations, eq(educational_regulations.id, students.regulationId))
    .where(eq(students.id, studentId))
    .limit(1);
  if (!row) return null;

  const rules = safeParseRules(row.rulesConfig);
  const family = toRegulationFamily({
    title: row.regulationTitle,
    effectiveFromYear: row.effectiveFromYear,
    rulesConfig: String(row.rulesConfig ?? ''),
  });
  const legacyPolicy = (rules?.grading_and_gpa?.failed_course_gpa_policy ?? null) as FailedCoursePolicy | null;

  return {
    studentId,
    studentStatus: row.status ?? null,
    // مادهٔ ۱: «دکتری حرفهای» از شمول آییننامه خارج است ⇒ خانوادهٔ قدیمی حفظ میشود
    family: /حرفه/.test(String(row.degreeTitle ?? '')) ? 'LEGACY' : family,
    level: toComplianceLevel(row.degreeCode ?? row.degreeTitle),
    entryYear: Number(row.entryYear ?? 0),
    universityId: row.universityId ?? null,
    regulationId: row.regulationId ?? null,
    degreeLevelId: row.degreeLevelId ?? null,
    degreeTitle: row.degreeTitle ?? null,
    regulationTitle: row.regulationTitle ?? null,
    rulesConfig: rules,
    legacyFailedPolicy: legacyPolicy,
  };
}

/** بافت بدون دانشجو (برای پنل مدیر، شبیهساز و گزارشها). */
export async function makeContext(opts: {
  level?: ComplianceLevel;
  entryYear?: number;
  universityId?: number | null;
  degreeLevelId?: number | null;
  regulationId?: number | null;
  family?: RegulationFamily;
} = {}): Promise<ComplianceContext> {
  let family = opts.family;
  let level = opts.level;
  let regulationId = opts.regulationId ?? null;
  let legacyFailedPolicy: FailedCoursePolicy | null = null;
  let rules: Record<string, any> = {};

  if (regulationId && (!family || !legacyFailedPolicy)) {
    const [reg] = await db.select().from(educational_regulations)
      .where(eq(educational_regulations.id, regulationId)).limit(1);
    if (reg) {
      rules = safeParseRules(reg.rulesConfig);
      family = family ?? toRegulationFamily({
        title: reg.title, effectiveFromYear: reg.effectiveFromYear, rulesConfig: reg.rulesConfig,
      });
      legacyFailedPolicy = (rules?.grading_and_gpa?.failed_course_gpa_policy ?? null) as FailedCoursePolicy | null;
      if (!level && reg.degreeLevelId) {
        const [deg] = await db.select().from(degree_level_configs)
          .where(eq(degree_level_configs.id, reg.degreeLevelId)).limit(1);
        if (deg) level = toComplianceLevel(deg.code ?? deg.title);
      }
    }
  }
  return {
    family: family ?? 'REG_1402',
    level: level ?? 'LONG',
    entryYear: Number(opts.entryYear ?? 1405),
    universityId: opts.universityId ?? null,
    regulationId,
    degreeLevelId: opts.degreeLevelId ?? null,
    legacyFailedPolicy,
  };
}

function settingsLayer(): Partial<Record<ComplianceKey, unknown>> {
  // مقادیری که پیش از این در system_settings وجود داشتند → همان behavior حفظ میشود،
  // مگر اینکه مدیر اورراید صریح ثبت کند یا قانون لازمالاجرا جلویشان را بگیرد.
  return {} as Partial<Record<ComplianceKey, unknown>>;
}

async function settingCandidates(): Promise<Partial<Record<ComplianceKey, unknown>>> {
  const out: Record<string, unknown> = {};
  const read = async (k: string) => { try { return await getSetting(k); } catch { return ''; } };
  const grad = await read('GRAD_MIN_GPA');
  const deadline = await read('GRADE_OBJECTION_DEADLINE');
  if (grad && Number.isFinite(Number(grad))) out.grad_min_gpa = Number(grad);
  if (deadline) out.grade_objection_explicit_deadline = deadline;
  return out as Partial<Record<ComplianceKey, unknown>>;
}

/** حل نهایی — نقطهٔ واحدی که همهٔ موتورها باید صدا بزنند. */
export async function getCompliance(ctx: ComplianceContext, extraLayers?: ComplianceLayers): Promise<ResolvedCompliance> {
  const [rows, settings] = await Promise.all([allOverrides(), settingCandidates()]);
  const regulation = (extraLayers?.regulation ?? {}) as Record<string, unknown>;
  const layers: ComplianceLayers = {
    overrides: { ...overridesFor(ctx, rows), ...(extraLayers?.overrides ?? {}) },
    regulation: { ...regulation, ...(extraLayers?.regulation ?? {}) },
    settings: { ...settings, ...settingsLayer(), ...(extraLayers?.settings ?? {}) },
  };
  return resolveCompliance(ctx, layers);
}

/** میانبر: فقط مقادیر. */
export async function getComplianceValues(ctx: ComplianceContext): Promise<ComplianceValues> {
  return (await getCompliance(ctx)).values;
}

/** میانبر برای دانشجو: بافت + مقادیر، با سقوط امن به بافت پیشفرض. */
export async function getStudentCompliance(studentId: number): Promise<{
  ctx: StudentComplianceContext | null;
  values: ComplianceValues;
  resolved: ResolvedCompliance;
  studentStatus: string | null;
  exitDate: string | null;
  exitType: string | null;
  destinationConfirmed: boolean;
  qualityCoefficient: number | null;
  sourceLedToOfficialDegree: boolean;
}> {
  let ctx: StudentComplianceContext | null = null;
  try { ctx = await loadStudentComplianceContext(studentId); } catch { /* بافت پیشفرض */ }
  const regLayer = ctx?.rulesConfig?.compliance && typeof ctx.rulesConfig.compliance === 'object'
    ? ctx.rulesConfig.compliance as Record<string, unknown> : {};
  const resolved = await getCompliance(ctx ?? await makeContext(), { regulation: regLayer });

  let extra: typeof students.$inferSelect | undefined;
  try {
    const [r] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
    extra = r;
  } catch { /* ستونها پیش از مهاجرت وجود ندارند */ }

  return {
    ctx,
    values: resolved.values,
    resolved,
    studentStatus: ctx?.studentStatus ?? null,
    exitDate: (extra as any)?.withdrawalOrExpulsionDate ?? null,
    exitType: (extra as any)?.previousProgramExitType ?? null,
    destinationConfirmed: Number((extra as any)?.equivDestinationConfirmed ?? 0) === 1,
    qualityCoefficient: (extra as any)?.equivQualityCoefficient != null ? Number((extra as any).equivQualityCoefficient) : null,
    sourceLedToOfficialDegree: Number((extra as any)?.equivSourceOfficialDegree ?? 0) === 1,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  گام ۱ / مادهٔ ۵۳ — حل هوشمند آییننامهٔ حاکم هنگام پذیرش
// ════════════════════════════════════════════════════════════════════════════

export interface AdmissionResolution {
  regulationId: number;
  family: RegulationFamily;
  reason: string;
  candidates: number;
}

/**
 * انتخاب آییننامه: ابتدا ردیف منطبق با دانشگاه + مقطع + بازهٔ اثر + سال ورود،
 * سپس مقطع، سپس همخانواده، و نهایتاً همان «اولین ردیف» قدیمی بهعنوان last resort
 * تا هیچ پذیرشهای بهدلیل نبود ردیف شکست نخورد.
 */
export async function resolveRegulationIdForAdmission(opts: {
  entryYear: number;
  degreeLevelId: number;
  universityId?: number | null;
  forceMode?: 'SMART' | 'FIRST_ROW';
}): Promise<AdmissionResolution> {
  const { entryYear, degreeLevelId, universityId } = opts;
  let rows: (typeof educational_regulations.$inferSelect)[] = [];
  try { rows = await db.select().from(educational_regulations); } catch { rows = []; }

  if (opts.forceMode === 'FIRST_ROW' || !rows.length) {
    return { regulationId: rows[0]?.id ?? 1, family: 'LEGACY', reason: 'FIRST_ROW (اورراید عیبیابی)', candidates: rows.length };
  }

  const uniScope = (r: typeof rows[number]) => r.universityId == null || r.universityId === universityId || universityId == null;
  const inYear = (r: typeof rows[number]) => {
    const from = Number(r.effectiveFromYear ?? 0);
    const to = r.effectiveToYear == null ? Infinity : Number(r.effectiveToYear);
    return entryYear >= from && entryYear <= to;
  };
  const is1402 = (r: typeof rows[number]) => /۱۴۰۲|1402/.test(`${r.title ?? ''} ${String(r.rulesConfig ?? '').slice(0, 300)}`);

  const score = (r: typeof rows[number]) =>
    (uniScope(r) ? 1 : 0) +
    (r.degreeLevelId === degreeLevelId ? 16 : 0) +
    (inYear(r) ? 8 : 0) +
    (entryYear >= 1402 && is1402(r) ? 4 : 0) +
    Number(r.effectiveFromYear ?? 0) / 100000;

  const sorted = [...rows].sort((a, b) => score(b) - score(a) || Number(b.effectiveFromYear ?? 0) - Number(a.effectiveFromYear ?? 0));
  const best = sorted[0];
  return {
    regulationId: best.id,
    family: toRegulationFamily({ title: best.title, effectiveFromYear: best.effectiveFromYear, rulesConfig: best.rulesConfig }),
    reason: `SMART: degreeLevelId=${degreeLevelId} entryYear=${entryYear} universityId=${universityId ?? '—'} → «${best.title}»`,
    candidates: rows.length,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  اوررایدها و seed پریستهای قانونی (برای پنل مدیر)
// ════════════════════════════════════════════════════════════════════════════

export async function listComplianceOverrides(universityId?: number | null): Promise<OverrideRow[]> {
  const rows = await allOverrides();
  return rows
    .filter(r => universityId == null || r.universityId == null || r.universityId === universityId)
    .sort((a, b) => scopeScore(b) - scopeScore(a) || a.key.localeCompare(b.key));
}

export async function saveComplianceOverride(input: {
  key: ComplianceKey;
  value: unknown;
  reason: string;
  universityId?: number | null;
  degreeLevelId?: number | null;
  regulationId?: number | null;
  entryYear?: number | null;
  updatedBy?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const def = POLICY_BY_KEY[input.key];
  if (!def) return { ok: false, error: 'کلید سیاست ناشناخته است.' };
  const normalized = normalizePolicyValue(def, input.value);
  if (normalized === null) return { ok: false, error: 'مقدار واردشده برای این سیاست معتبر نیست.' };
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 3) return { ok: false, error: 'برای تغییر یک حکم آییننامهای ثبت دلیل الزامی است.' };

  const scope = {
    universityId: input.universityId ?? null,
    degreeLevelId: input.degreeLevelId ?? null,
    regulationId: input.regulationId ?? null,
    entryYear: input.entryYear ?? null,
  };
  try {
    const existing = await db.select().from(compliance_policy_overrides).where(
      and(
        eq(compliance_policy_overrides.key, input.key),
        scope.universityId == null ? isNull(compliance_policy_overrides.universityId) : eq(compliance_policy_overrides.universityId, scope.universityId),
        scope.degreeLevelId == null ? isNull(compliance_policy_overrides.degreeLevelId) : eq(compliance_policy_overrides.degreeLevelId, scope.degreeLevelId),
        scope.regulationId == null ? isNull(compliance_policy_overrides.regulationId) : eq(compliance_policy_overrides.regulationId, scope.regulationId),
        scope.entryYear == null ? isNull(compliance_policy_overrides.entryYear) : eq(compliance_policy_overrides.entryYear, scope.entryYear),
      ),
    ).limit(1);
    const payload = {
      value: normalized as any,
      reason,
      updatedBy: input.updatedBy ?? null,
      updatedAt: new Date(),
    };
    if (existing.length) {
      await db.update(compliance_policy_overrides).set(payload).where(eq(compliance_policy_overrides.id, existing[0].id));
    } else {
      await db.insert(compliance_policy_overrides).values({ ...scope, key: input.key, ...payload });
    }
    invalidateComplianceCache();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در ذخیرهٔ اورراید.' };
  }
}

export async function deleteComplianceOverride(id: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.delete(compliance_policy_overrides).where(eq(compliance_policy_overrides.id, id));
    invalidateComplianceCache();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در حذف اورراید.' };
  }
}

/**
 * گام ۲: ساخت ایدمپوتنت ردیفهای ۱۴۰۲ ارشد/دکتری. هر اجرا فقط ردیفهای
 * ناقص را میسازد و ردیفهای موجود را دست نمیزند ⇒ قابل اجرا چندباره.
 */
export async function seed1402GraduateRegulations(universityId: number): Promise<{
  ok: boolean; created: string[]; skipped: string[]; error?: string;
}> {
  const created: string[] = [], skipped: string[] = [];
  try {
    const degrees = await db.select().from(degree_level_configs);
    const masters = degrees.filter(d => /MS|ارشد/i.test(`${d.code ?? ''} ${d.title ?? ''}`));
    const phds = degrees.filter(d =>
      /PHD|دکتري تخصص|دکتری تخصص/i.test(`${d.code ?? ''} ${d.title ?? ''}`) &&
      !/حرفه/i.test(`${d.title ?? ''}`) // مادهٔ ۱: دکتری حرفهای خارج از شمول است
    );
    const targets: { rows: typeof degrees; preset: () => any; label: string }[] = [
      { rows: masters, preset: REGULATION_PRESETS.reg1402MasterFor, label: 'کارشناسی ارشد' },
      { rows: phds, preset: REGULATION_PRESETS.reg1402PhdFor, label: 'دکتری تخصصی' },
    ];
    for (const t of targets) {
      for (const deg of t.rows) {
        const [exists] = await db.select().from(educational_regulations).where(
          and(
            eq(educational_regulations.degreeLevelId, deg.id),
            eq(educational_regulations.effectiveFromYear, 1402),
            universityId == null ? isNull(educational_regulations.universityId) : eq(educational_regulations.universityId, universityId),
          ),
        ).limit(1);
        if (exists) { skipped.push(`${t.label} / ${deg.title}`); continue; }
        await db.insert(educational_regulations).values({
          universityId,
          title: `آیین نامه ۱۴۰۲ — ${t.label}`,
          degreeLevelId: deg.id,
          effectiveFromYear: 1402,
          effectiveToYear: null,
          rulesConfig: JSON.stringify(t.preset()),
        });
        created.push(`${t.label} / ${deg.title}`);
      }
    }
    return { ok: true, created, skipped };
  } catch (e: any) {
    return { ok: false, created, skipped, error: e?.message ?? 'خطا در ایجاد ردیفها.' };
  }
}

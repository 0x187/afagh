import 'server-only';
import crypto from 'crypto';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  academic_terms, alumni_profiles, clearance_checklist, clearance_departments,
  courses, degree_level_configs, graduation_audits,
  issued_degrees, majors, notifications, students, student_ledger,
  curriculum_versions, users,
  thesis_progress, thesis_progress_reports, defense_jury_pools, defense_sessions, irandoc_logs, staff, classrooms,
} from '@/db/schema';
import { getBool, getNumber, getSetting } from '@/lib/settings';
import { ledgerBalance } from '@/lib/ledger-balance';
import { executeIrandocCheck } from '@/lib/api-integrations';
import { ssrfFetch } from '@/lib/ssrf-guard';
import { isSafeLinkUrl } from '@/lib/safe-url';
import { createLogger } from '@/lib/logger';
import { deliveriesForUser, notifyUserMultichannel } from '@/lib/messaging';
import { getRegulationConfig } from '@/lib/regulations-engine';
import { aggregateAuditTranscript } from '@/lib/gpa-aggregation';
import { resolveStudentCurriculum, resolutionReasonMessage } from '@/lib/curriculum-apply';
import { safeRials } from '@/lib/money';
import { appendAudit } from '@/lib/audit';
import {
  loadAuditStudentRow, loadCurriculumRequirementRows, loadGradedEnrollments,
} from '@/lib/graduation/graduation-queries';

// ═══════════════════════════════════════════════════════════════════
//  موتور فارغ‌التحصیلی «رویدادمحور» (Zero-Touch Graduation)
//
//  فلسفه: دانشجو هیچ درخواستی باز نمی‌کند. با قطعی‌شدن آخرین نمره،
//  پویش خودکار سرفصل را تطبیق می‌دهد، پرونده را باز می‌کند، به کارتابل
//  مدیر گروه می‌فرستد، ایرانداک را استعلام می‌گیرد و تسویه‌حساب را
//  به‌صورت *موازی* در همهٔ دپارتمان‌ها استارت می‌زند. دانشجو فقط
//  نوار پیشرفت را می‌بیند و در گام آخر عکس و تمبر را می‌دهد.
//
//  مسیر وضعیت‌ها:
//  CATALOG_REVIEW → HEAD_APPROVAL → IRANDOC_VERIFICATION (فقط ارشد/دکتری)
//                 → CLEARANCE → SAJJAD_REQUEST (اقدام دانشجو) → FINAL_DOCS
//                 → READY_TO_ISSUE → ISSUED
// ═══════════════════════════════════════════════════════════════════

const log = createLogger({ mod: 'graduation' });

export const WORKFLOW_STEPS = [
  { code: 'CATALOG_REVIEW', title: 'تطبیق سرفصل و بررسی واحدها', actor: 'سیستم' },
  { code: 'HEAD_APPROVAL', title: 'تأیید مدیر گروه', actor: 'مدیر گروه' },
  { code: 'IRANDOC_VERIFICATION', title: 'استعلام همانندجویی ایرانداک', actor: 'سیستم' },
  { code: 'CLEARANCE', title: 'تسویه‌حساب موازی دپارتمان‌ها', actor: 'سیستم / کارشناسان' },
  { code: 'SAJJAD_REQUEST', title: 'ثبت درخواست کد صحت در سامانهٔ سجاد', actor: 'دانشجو' },
  { code: 'FINAL_DOCS', title: 'مدارک پایانی (عکس و تمبر)', actor: 'دانشجو' },
  { code: 'READY_TO_ISSUE', title: 'کارشناس صدور مدرک', actor: 'اداره آموزش' },
  { code: 'ISSUED', title: 'مدرک صادر شد', actor: '—' },
] as const;

export type WorkflowStatus = typeof WORKFLOW_STEPS[number]['code'] | 'ON_HOLD';

/**
 * مراحل واقعی هر پرونده: همانندجویی ایرانداک فقط برای مقاطع دارای پایان‌نامه
 * (ارشد/دکتری) و گام سجاد فقط وقتی در تنظیمات الزامی باشد نمایش داده می‌شود.
 */
export function stepsFor(opts: { thesisRequired: boolean; sajjadRequired: boolean }) {
  return WORKFLOW_STEPS.filter(s =>
    (s.code !== 'IRANDOC_VERIFICATION' || opts.thesisRequired) &&
    (s.code !== 'SAJJAD_REQUEST' || opts.sajjadRequired));
}

/** دپارتمان‌های پیش‌فرض تسویه — فقط بار اول ساخته می‌شوند و از پنل مدیر قابل تغییرند */
const DEFAULT_DEPARTMENTS = [
  { code: 'FINANCE', title: 'امور مالی و شهریه', autoCheck: 'FINANCE_LEDGER', sortOrder: 10, responsibleRoleCode: 'FINANCE_EXPERT', hint: 'مانده بدهی از دفتر مالی دانشجو محاسبه می‌شود.' },
  { code: 'LIBRARY', title: 'کتابخانه مرکزی', autoCheck: 'NONE', sortOrder: 20, responsibleRoleCode: 'LIBRARIAN', hint: 'در صورت وجود سرویس کتابخانه، نشانی API را در همین صفحه ثبت کنید.' },
  { code: 'DORMITORY', title: 'خوابگاه', autoCheck: 'NONE', sortOrder: 30, responsibleRoleCode: 'DORM_EXPERT', hint: '' },
  { code: 'WELFARE_FUND', title: 'صندوق رفاه دانشجویان', autoCheck: 'NONE', sortOrder: 40, responsibleRoleCode: 'FINANCE_EXPERT', hint: 'بازپرداخت وام‌های دانشجویی' },
  { code: 'LAB', title: 'آزمایشگاه و کارگاه', autoCheck: 'NONE', sortOrder: 50, responsibleRoleCode: 'EDU_EXPERT', hint: '' },
  { code: 'EDU_OFFICE', title: 'اداره آموزش (پروندهٔ تحصیلی)', autoCheck: 'NONE', sortOrder: 60, responsibleRoleCode: 'EDU_EXPERT', hint: 'کنترل نهایی پرونده و مدارک ورودی' },
  { code: 'MILITARY', title: 'نظام وظیفه', autoCheck: 'NONE', sortOrder: 70, responsibleRoleCode: 'MILITARY_OFFICER', hint: 'فقط برای مشمولان — در غیر این صورت «معاف از بررسی» بزنید.' },
];

export async function ensureClearanceDepartments() {
  const rows = await db.select({ id: clearance_departments.id }).from(clearance_departments).limit(1);
  if (rows.length) return;
  await db.insert(clearance_departments).values(
    DEFAULT_DEPARTMENTS.map(d => ({ ...d, isActive: 1 })),
  ).onConflictDoNothing();
}

export async function listDepartments(activeOnly = true) {
  await ensureClearanceDepartments();
  const rows = await db.select().from(clearance_departments).orderBy(asc(clearance_departments.sortOrder));
  return activeOnly ? rows.filter(r => r.isActive === 1) : rows;
}

// ───────────────────────── تطبیق سرفصل ─────────────────────────

export type AuditResult = {
  studentId: number;
  studentCode: string;
  fullName: string;
  majorName: string | null;
  degreeCode: string | null;
  requiredUnits: number;
  passedUnits: number;
  gpa: number | null;
  missing: { code: string; title: string; units: number }[];
  catalogOk: boolean;
  reasons: string[];
};

/**
 * تطبیق کارنامهٔ دانشجو با سرفصل مصوب رشته‌اش.
 * سرفصل بر اساس رشته و بازهٔ سال ورود انتخاب می‌شود؛ اگر سرفصلی تعریف نشده
 * باشد فقط «حداقل واحد» و معدل ملاک قرار می‌گیرد و دلیلش در گزارش می‌آید.
 */
export async function auditStudent(studentId: number): Promise<AuditResult | null> {
  const row = await loadAuditStudentRow(studentId);
  if (!row) return null;

  // کف قبولی از آیین‌نامهٔ ملاک دانشجو (مثل موتور رسمی)، وگرنه پیش‌فرض مقطع
  let passing = Number(row.passingGrade ?? 10);
  try {
    const regCfg = await getRegulationConfig(row.regulationId, row.degreeLevelId);
    const rp = Number(regCfg?.grading_and_gpa?.default_passing_grade);
    if (Number.isFinite(rp)) passing = rp;
  } catch { /* پیش‌فرض مقطع می‌ماند */ }
  const minGpa = await getNumber('GRAD_MIN_GPA', 12);

  // فقط سوابق نهایی/معاف/قبول‌بدون‌نمره — نمرات موقت (PENDING) نه «گذرانده»‌اند نه در معدل
  const taken = await loadGradedEnrollments(studentId);

  /**
   * تجمیع کارنامه در هستهٔ خالصِ `aggregateAuditTranscript` انجام می‌شود — همان
   * هسته‌ای که `calculateOfficialGPA` هم صدا می‌زند. تا پیش از این، این حلقه
   * نمرهٔ ردیف را فقط با `courses.affectsGpa` تصمیم می‌گرفت و کد سمای «قبولیِ
   * بدون احتساب» (۱۲، ۱۶، ۱۷، ۱۸، ۲۳، ۳۲، ۴۴، ۵۳) را نادیده می‌گرفت؛ در نتیجه
   * یک درس منتقل‌شده با کد درست، در «معدل رسمی» وارد نمی‌شد ولی اینجا وارد
   * می‌شد و می‌توانست دانشجو را از زیر آستانهٔ GRAD_MIN_GPA بیرون بیندازد.
   * واحدهای هر ردیفِ قبولی همچنان شمرده می‌شوند (درس منتقل‌شده واحد می‌دهد).
   */
  const core = aggregateAuditTranscript(taken, passing);
  const passedIds = core.passedIds;
  const passedUnits = core.passedUnits;
  const gpa = core.gpa;

  // ── فاز ۵: نسخهٔ مصوب از طریق Resolution (فقط PUBLISHED/ARCHIVED) ──
  // پیش از این «جدیدترین نسخهٔ دارای پنجرهٔ منطبق» بدون توجه به وضعیت انتخاب
  // می‌شد؛ اکنون Resolver خالص یک نسخهٔ قابل اعمال قطعی برمی‌گرداند.
  const resolved = await resolveStudentCurriculum(studentId);
  const syl = resolved.version;

  const reasons: string[] = [];
  const missing: { code: string; title: string; units: number }[] = [];
  let requiredUnits = Number(syl?.totalRequiredUnits ?? 0) || 0;

  if (syl) {
    const req = await loadCurriculumRequirementRows(syl.id);
    for (const r of req) {
      if (!passedIds.has(r.courseId)) missing.push({ code: r.code, title: r.title, units: Number(r.units ?? 0) });
    }
    if (!requiredUnits) requiredUnits = req.reduce((s, r) => s + Number(r.units ?? 0), 0);
  } else {
    reasons.push('برای این رشته/سال ورود، نسخهٔ برنامهٔ درسی قابل اعمالی ثبت نشده است؛ ' + resolutionReasonMessage(resolved.reason) + ' تشکیل خودکار پرونده ممکن نیست و نیازمند بررسی کارشناس آموزش است.');
  }

  if (missing.length) reasons.push(`${missing.length} درس اجباری سرفصل هنوز پاس نشده است.`);
  if (requiredUnits && passedUnits < requiredUnits) reasons.push(`واحد گذرانده (${passedUnits}) کمتر از حداقل لازم (${requiredUnits}) است.`);
  if (gpa != null && gpa < minGpa) reasons.push(`معدل کل (${gpa}) کمتر از حداقل مجاز (${minGpa}) است.`);
  if (gpa == null) reasons.push('هنوز هیچ نمرهٔ عددی قطعی‌ای ثبت نشده است.');

  // بدون سرفصل مصوب هرگز پرونده به‌صورت خودکار باز نمی‌شود
  const catalogOk = !!syl
    && missing.length === 0
    && (!requiredUnits || passedUnits >= requiredUnits)
    && gpa != null && gpa >= minGpa;

  return {
    studentId, studentCode: row.studentCode, fullName: `${row.firstName} ${row.lastName}`,
    majorName: row.majorName ?? null, degreeCode: row.degreeCode ?? null,
    requiredUnits, passedUnits, gpa, missing, catalogOk, reasons,
  };
}

// ───────────────────────── اعلان‌ها ─────────────────────────

/**
 * اعلان به دانشجو روی همهٔ کانال‌های فعال (پیام درون‌سامانه + پیامک + پیام‌رسان).
 * کانال‌ها و سرویس‌دهنده‌ها از تنظیمات خوانده می‌شوند؛ خطای ارسال بیرونی هرگز
 * فرآیند فارغ‌التحصیلی را متوقف نمی‌کند، فقط در گزارش تحویل ثبت می‌شود.
 */
async function notifyUser(userId: number, eventCode: string, text: string) {
  try {
    await notifyUserMultichannel({ userId, eventCode, text });
  } catch (e) {
    log.error('notify_failed', { eventCode, err: (e as Error).message });
    await db.insert(notifications).values({ userId, eventCode, payload: JSON.stringify({ text }) });
  }
}

async function notifyRole(roleCode: string | null, eventCode: string, text: string) {
  if (!roleCode) return;
  const rows = await db.execute(sql`
    select u.id from users u
    join user_roles ur on ur."userId" = u.id
    join roles r on r.id = ur."roleId"
    where r.code = ${roleCode} and u."isActive" = 1 limit 50`);
  for (const r of rows.rows as { id: number }[]) {
    await notifyUser(Number(r.id), eventCode, text);
  }
}

// ───────────────────── باز کردن خودکار پرونده ─────────────────────

export type ScanResult = {
  scanned: number; opened: number; alreadyOpen: number; notEligible: number;
  opinions: { studentCode: string; fullName: string; status: string; note: string }[];
};

/**
 * پویش خودکار (Job پس‌زمینه).
 * برای هر دانشجوی فعال، تطبیق سرفصل اجرا می‌شود؛ هرکس شرایط را داشته باشد
 * پرونده‌اش **بدون دخالت خودش** باز می‌شود و به کارتابل مدیر گروه می‌رود.
 */
export async function runGraduationScan(opts: { studentIds?: number[]; majorId?: number; force?: boolean } = {}): Promise<ScanResult> {
  const enabled = await getBool('GRAD_AUTO_SCAN');
  const res: ScanResult = { scanned: 0, opened: 0, alreadyOpen: 0, notEligible: 0, opinions: [] };
  if (!enabled && !opts.force) {
    res.opinions.push({ studentCode: '-', fullName: '-', status: 'DISABLED', note: 'پویش خودکار در تنظیمات غیرفعال است.' });
    return res;
  }

  const conds = [inArray(students.status, ['ACTIVE', 'PENDING_GRADUATION'])];
  if (opts.studentIds?.length) conds.push(inArray(students.id, opts.studentIds));
  if (opts.majorId) conds.push(eq(students.majorId, opts.majorId));
  const list = await db.select({ id: students.id }).from(students).where(and(...conds));

  const existing = new Map(
    (await db.select({ studentId: graduation_audits.studentId, id: graduation_audits.id, status: graduation_audits.workflowStatus })
      .from(graduation_audits)).map(a => [a.studentId, a]),
  );

  for (const s of list) {
    res.scanned++;
    const audit = await auditStudent(s.id);
    if (!audit) continue;

    const open = existing.get(s.id);
    if (open) {
      // پرونده باز است: فقط نتیجهٔ تطبیق را تازه می‌کنیم
      await db.update(graduation_audits).set({
        requiredUnits: String(audit.requiredUnits), passedUnits: String(audit.passedUnits),
        gpa: audit.gpa == null ? null : String(audit.gpa),
        missingCourses: audit.missing as never, catalogOk: audit.catalogOk ? 1 : 0,
        lastEventAt: new Date(),
      }).where(eq(graduation_audits.id, open.id));
      res.alreadyOpen++;
      continue;
    }
    if (!audit.catalogOk) {
      res.notEligible++;
      continue;
    }
    await openDossier(audit);
    res.opened++;
    res.opinions.push({ studentCode: audit.studentCode, fullName: audit.fullName, status: 'OPENED', note: 'پرونده به‌صورت خودکار باز شد.' });
  }

  log.info('graduation_scan', { scanned: res.scanned, opened: res.opened, alreadyOpen: res.alreadyOpen });
  return res;
}

/** ساخت پرونده و رفتن مستقیم به کارتابل مدیر گروه (بدون درخواست دانشجو) */
export async function openDossier(audit: AuditResult): Promise<number> {
  const thesisCodes = (await getSetting('GRAD_THESIS_DEGREE_CODES')).split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  const thesisRequired = !!audit.degreeCode && thesisCodes.includes(audit.degreeCode.toUpperCase());
  const [term] = await db.select({ id: academic_terms.id }).from(academic_terms).where(eq(academic_terms.isCurrent, 1)).limit(1);

  const [ins] = await db.insert(graduation_audits).values({
    studentId: audit.studentId, workflowStatus: 'HEAD_APPROVAL',
    requiredUnits: String(audit.requiredUnits), passedUnits: String(audit.passedUnits),
    gpa: audit.gpa == null ? null : String(audit.gpa),
    missingCourses: audit.missing as never, catalogOk: audit.catalogOk ? 1 : 0,
    thesisRequired: thesisRequired ? 1 : 0,
    irandocStatus: thesisRequired ? 'PENDING' : 'SKIPPED',
    graduationTermId: term?.id ?? null,
    stampFeeAmount: String(await getNumber('GRAD_STAMP_FEE', 0)),
  }).onConflictDoNothing().returning({ id: graduation_audits.id });

  const auditId = ins?.id
    ?? (await db.select({ id: graduation_audits.id }).from(graduation_audits).where(eq(graduation_audits.studentId, audit.studentId)).limit(1))[0]?.id;

  await db.update(students).set({ status: 'PENDING_GRADUATION' }).where(eq(students.id, audit.studentId));

  const [stu] = await db.select({ userId: students.userId }).from(students).where(eq(students.id, audit.studentId)).limit(1);
  if (stu) {
    // پیام تبریک اتمام تحصیل + دعوت به پیگیری تسویه‌حساب (پیامک/پیام‌رسان + درون‌سامانه)
    await notifyUser(stu.userId, 'GRADUATION_STARTED', [
      `${audit.fullName} عزیز، اتمام دوره تحصیلی شما را صمیمانه تبریک می‌گوییم! 🎓`,
      `بر اساس تکمیل واحدهای سرفصل${audit.gpa == null ? '' : ` (معدل کل ${audit.gpa})`}، پروندهٔ فارغ‌التحصیلی شما به‌صورت خودکار تشکیل شد و نیازی به ثبت درخواست ندارید.`,
      'مرحلهٔ بعد، تأیید مدیر گروه و سپس تسویه‌حساب با واحدهای دانشگاه است؛ لطفاً وضعیت بدهی مالی، امانت کتاب و خوابگاه خود را پیگیری کنید تا فرآیند بدون وقفه پیش برود.',
      'پیگیری لحظه‌ای مراحل: بخش «فارغ‌التحصیلی من» در سامانه.',
    ].join('\n'));
  }
  await notifyRole('EDU_EXPERT', 'GRADUATION_HEAD_APPROVAL',
    `پروندهٔ فارغ‌التحصیلی ${audit.fullName} (${audit.studentCode}) آمادهٔ بررسی و تأیید مدیر گروه است.`);

  log.info('dossier_opened', { studentId: audit.studentId, thesisRequired });
  return auditId;
}

/** فراخوان سبک پس از هر تغییر نمره — اگر شرایط جمع شد، پرونده خودش باز می‌شود */
export async function triggerGraduationCheck(studentIds: number[]): Promise<ScanResult | null> {
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (!ids.length) return null;
  try {
    return await runGraduationScan({ studentIds: ids });
  } catch (e) {
    log.error('trigger_failed', { err: e });
    return null;
  }
}

// ───────────────────── مرحله: تأیید مدیر گروه ─────────────────────

export async function approveByHead(auditId: number, userId: number, note?: string) {
  const [a] = await db.select().from(graduation_audits).where(eq(graduation_audits.id, auditId)).limit(1);
  if (!a) throw new Error('پرونده یافت نشد.');
  await db.update(graduation_audits).set({
    headApprovalStatus: 1, headApprovedBy: userId, headApprovedAt: new Date(),
    headNote: note ?? null, lastEventAt: new Date(),
  }).where(eq(graduation_audits.id, auditId));
  return advanceDossier(auditId);
}

export async function holdDossier(auditId: number, reason: string) {
  await db.update(graduation_audits).set({ workflowStatus: 'ON_HOLD', note: reason, lastEventAt: new Date() })
    .where(eq(graduation_audits.id, auditId));
  const [a] = await db.select({ studentId: graduation_audits.studentId }).from(graduation_audits).where(eq(graduation_audits.id, auditId)).limit(1);
  if (a) {
    const [stu] = await db.select({ userId: students.userId }).from(students).where(eq(students.id, a.studentId)).limit(1);
    if (stu) await notifyUser(stu.userId, 'GRADUATION_HOLD', `پروندهٔ فارغ‌التحصیلی شما متوقف شد: ${reason}`);
  }
  return { ok: true };
}

/** رفع توقف: پرونده دوباره وارد چرخهٔ خودکار می‌شود */
export async function resumeDossier(auditId: number) {
  await db.update(graduation_audits).set({ workflowStatus: 'CATALOG_REVIEW', note: null, lastEventAt: new Date() })
    .where(eq(graduation_audits.id, auditId));
  return advanceDossier(auditId);
}

// ───────────────────── مرحله: ایرانداک ─────────────────────

export async function runIrandoc(auditId: number, params?: { trackingCode?: string; thesisTitle?: string }) {
  const [a] = await db.select().from(graduation_audits).where(eq(graduation_audits.id, auditId)).limit(1);
  if (!a) throw new Error('پرونده یافت نشد.');
  if (!a.thesisRequired) {
    await db.update(graduation_audits).set({ irandocStatus: 'SKIPPED', lastEventAt: new Date() }).where(eq(graduation_audits.id, auditId));
    return { ok: true, skipped: true };
  }

  const [stu] = await db.select({
    userId: students.userId, nationalCode: users.nationalCode, studentCode: students.studentCode,
  }).from(students).innerJoin(users, eq(users.id, students.userId)).where(eq(students.id, a.studentId)).limit(1);

  const tracking = params?.trackingCode?.trim() || a.irandocTrackingCode || '';
  if (!tracking) throw new Error('کد رهگیری ثبت پایان‌نامه در ایرانداک وارد نشده است.');
  const title = params?.thesisTitle?.trim() || a.thesisTitle || 'پایان‌نامه';
  const threshold = await getNumber('GRAD_IRANDOC_MAX_SIMILARITY', 20);

  const r = await executeIrandocCheck({
    nationalCode: stu?.nationalCode ?? '', trackingCode: tracking,
    thesisTitle: title, maxAllowedThreshold: threshold,
  });

  const passed = r.decision === 'AUTO_APPROVE';
  await db.update(graduation_audits).set({
    irandocTrackingCode: tracking, thesisTitle: title,
    irandocSimilarityScore: String(r.similarityPercentage),
    irandocStatus: passed ? 'PASSED' : 'REJECTED',
    irandocCheckedAt: new Date(), lastEventAt: new Date(),
  }).where(eq(graduation_audits.id, auditId));

  if (stu) {
    await notifyUser(stu.userId, 'GRADUATION_IRANDOC',
      passed
        ? `استعلام همانندجویی پایان‌نامه انجام شد: ${r.similarityPercentage}٪ (مجاز تا ${threshold}٪).`
        : `درصد همانندجویی پایان‌نامه (${r.similarityPercentage}٪) بیش از سقف مجاز است؛ برای اصلاح با تحصیلات تکمیلی تماس بگیرید.`);
  }

  log.info('irandoc_checked', { auditId, similarity: r.similarityPercentage, passed });
  if (passed) await advanceDossier(auditId);
  return { ok: true, passed, similarity: r.similarityPercentage, message: r.message };
}

// ───────────────── مرحله: تسویه‌حساب موازی ─────────────────

/** بدهی مالی دانشجو از دفتر مالی کانونی (بدهی − اعتبار) */
export async function financeBalance(studentId: number): Promise<number> {
  // 🔒 پیش‌تر این تابع روی نوع تراکنشِ ناموجود 'DEBIT' ساخته شده بود ⇒ بدهی
  //    همیشه صفر و مانده = −Σ(CREDIT) می‌شد؛ نتیجه: دانشجوی **بدهکار** در
  //    runAutoClearance «تسویه» علامت می‌خورد و پروندهٔ فراغت جلو می‌رفت.
  //    اکنون از واژگان کانونی `ledgerBalance` استفاده می‌کند.
  const rows = await db
    .select({ transactionType: student_ledger.transactionType, amount: student_ledger.amount })
    .from(student_ledger)
    .where(eq(student_ledger.studentId, studentId));
  return Math.max(0, Math.round(ledgerBalance(rows)));
}

/** ساخت چک‌لیست و اجرای بررسی‌های خودکار — همهٔ دپارتمان‌ها هم‌زمان */
export async function startClearance(auditId: number) {
  const [a] = await db.select().from(graduation_audits).where(eq(graduation_audits.id, auditId)).limit(1);
  if (!a) throw new Error('پرونده یافت نشد.');
  const deps = await listDepartments();

  for (const d of deps) {
    await db.insert(clearance_checklist).values({
      studentId: a.studentId, auditId, department: d.code, status: 'PENDING',
    }).onConflictDoNothing();
  }
  await db.update(graduation_audits).set({ workflowStatus: 'CLEARANCE', lastEventAt: new Date() })
    .where(eq(graduation_audits.id, auditId));

  const [stu] = await db.select({ userId: students.userId }).from(students).where(eq(students.id, a.studentId)).limit(1);
  for (const d of deps) {
    await notifyRole(d.responsibleRoleCode, 'CLEARANCE_REQUEST',
      `درخواست تسویه‌حساب «${d.title}» برای یک دانش‌آموخته در انتظار بررسی است.`);
  }
  if (stu) await notifyUser(stu.userId, 'GRADUATION_CLEARANCE', 'مرحلهٔ تسویه‌حساب پروندهٔ شما به‌صورت هم‌زمان در همهٔ واحدها آغاز شد.');

  return runAutoClearance(auditId);
}

/** تأیید خودکار: هرجا سیستم بتواند خودش قضاوت کند، کارشناس درگیر نمی‌شود */
export async function runAutoClearance(auditId: number) {
  const [a] = await db.select().from(graduation_audits).where(eq(graduation_audits.id, auditId)).limit(1);
  if (!a) throw new Error('پرونده یافت نشد.');
  const deps = await listDepartments();
  const rows = await db.select().from(clearance_checklist).where(eq(clearance_checklist.auditId, auditId));

  let autoCleared = 0; let withDebt = 0;
  for (const row of rows) {
    if (row.status === 'CLEARED' || row.status === 'WAIVED') continue;
    const dep = deps.find(d => d.code === row.department);
    if (!dep) continue;

    if (dep.autoCheck === 'FINANCE_LEDGER') {
      const balance = await financeBalance(a.studentId);
      const cleared = balance <= 0;
      await db.update(clearance_checklist).set({
        status: cleared ? 'CLEARED' : 'HAS_DEBT',
        amountDue: String(Math.max(0, balance)),
        detail: cleared ? 'بدهی مالی صفر است — تأیید خودکار سیستم.' : `مانده بدهی: ${Math.max(0, balance).toLocaleString('fa-IR')} ریال`,
        autoChecked: 1, resolvedAt: cleared ? new Date() : null,
      }).where(eq(clearance_checklist.id, row.id));
      cleared ? autoCleared++ : withDebt++;
    } else if (dep.autoCheck === 'HTTP_API' && dep.apiUrl) {
      // سرویس بیرونی (کتابخانه/خوابگاه): پاسخ باید {cleared:boolean, amountDue?:number, detail?:string} باشد
      try {
        const timeout = (await getNumber('API_TIMEOUT_SECONDS', 10)) * 1000;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeout);
        // گارد SSRF: نشانی از پنل مدیر (clearance_departments.apiUrl) می‌آید —
        // فقط https + بدون userinfo + مقصد عمومی (یا میزبان مجازِ AFAGH_SSRF_ALLOW_HOSTS).
        const apiUrl = new URL(dep.apiUrl);
        apiUrl.searchParams.set('studentId', String(a.studentId));
        const resp = await ssrfFetch(apiUrl.toString(), { signal: ctrl.signal });
        clearTimeout(t);
        const j = (await resp.json()) as { cleared?: boolean; amountDue?: number; detail?: string };
        await db.update(clearance_checklist).set({
          status: j.cleared ? 'CLEARED' : 'HAS_DEBT',
          amountDue: String(Math.round(Number(j.amountDue ?? 0))),
          detail: j.detail ?? (j.cleared ? 'تأیید خودکار سرویس بیرونی.' : 'بدهی/امانت باز طبق سرویس بیرونی.'),
          autoChecked: 1, resolvedAt: j.cleared ? new Date() : null,
        }).where(eq(clearance_checklist.id, row.id));
        j.cleared ? autoCleared++ : withDebt++;
      } catch (e) {
        await db.update(clearance_checklist).set({
          detail: `سرویس «${dep.title}» پاسخ نداد؛ نیاز به بررسی کارشناس. (${(e as Error).message.slice(0, 80)})`,
        }).where(eq(clearance_checklist.id, row.id));
      }
    }
  }

  log.info('auto_clearance', { auditId, autoCleared, withDebt });

  // اگر جایی بدهی/امانت باز ماند، فهرستش را با پیامک/پیام‌رسان به دانشجو می‌گوییم
  if (withDebt > 0) {
    const fresh = await db.select().from(clearance_checklist).where(eq(clearance_checklist.auditId, auditId));
    const debts = fresh.filter(r => r.status === 'HAS_DEBT');
    const [stu] = await db.select({ userId: students.userId }).from(students).where(eq(students.id, a.studentId)).limit(1);
    if (stu && debts.length) {
      const lines = debts.map(r => {
        const title = deps.find(d => d.code === r.department)?.title ?? r.department;
        const amount = Number(r.amountDue ?? 0);
        return `• ${title}${amount > 0 ? ` — ${amount.toLocaleString('fa-IR')} ریال` : ''}`;
      });
      await notifyUser(stu.userId, 'GRADUATION_CLEARANCE_DEBT',
        ['برای ادامهٔ فرآیند فارغ‌التحصیلی، تسویه‌حساب موارد زیر باقی مانده است:', ...lines,
          'پس از تسویه، سامانه به‌صورت خودکار وضعیت را سبز می‌کند و نیازی به مراجعهٔ حضوری نیست.'].join('\n'));
    }
  }

  await advanceDossier(auditId);
  return { ok: true, autoCleared, withDebt };
}

export async function setClearance(input: {
  checklistId: number; status: 'CLEARED' | 'HAS_DEBT' | 'WAIVED' | 'PENDING';
  detail?: string; amountDue?: number; userId: number;
}) {
  const [row] = await db.select().from(clearance_checklist).where(eq(clearance_checklist.id, input.checklistId)).limit(1);
  if (!row) throw new Error('ردیف تسویه یافت نشد.');
  await db.update(clearance_checklist).set({
    status: input.status, detail: input.detail ?? row.detail,
    amountDue: String(Math.round(input.amountDue ?? Number(row.amountDue ?? 0))),
    resolvedBy: input.userId, resolvedAt: ['CLEARED', 'WAIVED'].includes(input.status) ? new Date() : null,
    autoChecked: 0,
  }).where(eq(clearance_checklist.id, input.checklistId));
  if (row.auditId) await advanceDossier(row.auditId);
  return { ok: true };
}

// ───────────────── موتور پیشروی وضعیت ─────────────────

/** آیا هنوز منتظر ثبت درخواست کد صحت توسط دانشجو هستیم؟ */
async function sajjadPending(a: { sajjadStatus: string | null; sajjadRequestCode: string | null }) {
  if (!(await getBool('GRAD_REQUIRE_SAJJAD'))) return false;
  if (a.sajjadStatus === 'SKIPPED' || a.sajjadStatus === 'CONFIRMED') return false;
  return !a.sajjadRequestCode;
}

/** با هر رویداد، وضعیت پرونده دوباره محاسبه می‌شود (بدون دخالت انسان) */
export async function advanceDossier(auditId: number): Promise<{ status: string; changed: boolean }> {
  const [a] = await db.select().from(graduation_audits).where(eq(graduation_audits.id, auditId)).limit(1);
  if (!a) throw new Error('پرونده یافت نشد.');
  if (a.workflowStatus === 'ISSUED' || a.workflowStatus === 'ON_HOLD') return { status: a.workflowStatus, changed: false };

  let next: WorkflowStatus = a.workflowStatus as WorkflowStatus;

  if (!a.headApprovalStatus) next = 'HEAD_APPROVAL';
  else if (a.thesisRequired && a.irandocStatus !== 'PASSED' && a.irandocStatus !== 'SKIPPED') next = 'IRANDOC_VERIFICATION';
  else {
    const rows = await db.select().from(clearance_checklist).where(eq(clearance_checklist.auditId, auditId));
    if (!rows.length) {
      // ورود به مرحلهٔ تسویه: چک‌لیست ساخته و خودکار بررسی می‌شود
      if (a.workflowStatus !== 'CLEARANCE') {
        await startClearance(auditId);
        return { status: 'CLEARANCE', changed: true };
      }
      next = 'CLEARANCE';
    } else if (rows.some(r => r.status !== 'CLEARED' && r.status !== 'WAIVED')) {
      next = 'CLEARANCE';
    } else if (await sajjadPending(a)) {
      // همهٔ امضاها گرفته شده؛ پیش از ارجاع به کارشناس صدور مدرک، خودِ دانشجو
      // باید در سامانهٔ سجاد درخواست کد صحت ثبت کند و کد رهگیری را وارد کند.
      next = 'SAJJAD_REQUEST';
    } else {
      const needPhoto = await getBool('GRAD_REQUIRE_PHOTO');
      const fee = Number(a.stampFeeAmount ?? 0);
      const photoOk = !needPhoto || !!a.photoDocumentId;
      const feeOk = fee <= 0 || a.stampFeePaid === 1;
      next = photoOk && feeOk ? 'READY_TO_ISSUE' : 'FINAL_DOCS';
    }
  }

  if (next === a.workflowStatus) return { status: next, changed: false };

  await db.update(graduation_audits).set({
    workflowStatus: next, lastEventAt: new Date(),
    finalDocsAt: next === 'READY_TO_ISSUE' ? new Date() : a.finalDocsAt,
  }).where(eq(graduation_audits.id, auditId));

  const [stu] = await db.select({ userId: students.userId }).from(students).where(eq(students.id, a.studentId)).limit(1);
  if (stu) {
    if (next === 'SAJJAD_REQUEST') {
      await notifyUser(stu.userId, 'GRADUATION_SAJJAD',
        'تمام تأییدیه‌ها و تسویه‌حساب‌های پروندهٔ شما کامل شد. برای ادامه، لازم است در «سامانهٔ سجاد» (portal.saorg.ir) درخواست «کد صحت مدرک» ثبت کنید و کد رهگیری آن را در بخش «فارغ‌التحصیلی من» وارد نمایید؛ پس از آن پرونده به کارشناس صدور مدرک ارجاع می‌شود.');
    } else if (next === 'FINAL_DOCS') {
      const parts = ['تمام تأییدیه‌های سیستمی پروندهٔ شما سبز شد.'];
      if (await getBool('GRAD_REQUIRE_PHOTO')) parts.push('لطفاً عکس ۴×۳ جدید خود را بارگذاری کنید');
      if (Number(a.stampFeeAmount ?? 0) > 0) parts.push(`هزینهٔ تمبر ابطال (${Number(a.stampFeeAmount).toLocaleString('fa-IR')} ریال) را پرداخت نمایید`);
      await notifyUser(stu.userId, 'GRADUATION_FINAL_DOCS', parts.join(' — ') + '.');
    } else if (next === 'READY_TO_ISSUE') {
      await notifyUser(stu.userId, 'GRADUATION_READY', 'پروندهٔ فارغ‌التحصیلی شما کامل شد و در نوبت صدور گواهینامهٔ موقت است.');
      await notifyRole('EDU_EXPERT', 'GRADUATION_READY', 'یک پرونده آمادهٔ صدور گواهینامهٔ موقت است.');
    }
  }
  log.info('dossier_advanced', { auditId, from: a.workflowStatus, to: next });
  return { status: next, changed: true };
}

// ───────────── درخواست کد صحت در سجاد (اقدام خودِ دانشجو) ─────────────

/** نشانی پورتال سجاد برای راهنمایی دانشجو (قابل تغییر از تنظیمات) */
export async function sajjadPortalUrl() {
  const v = await getSetting('SAJJAD_PORTAL_URL');
  return v && isSafeLinkUrl(v) ? v : 'https://portal.saorg.ir';
}

/** ثبت کد رهگیری درخواست کد صحت که دانشجو در سامانهٔ سجاد گرفته است */
export async function submitSajjadRequest(auditId: number, code: string) {
  const trimmed = code.trim();
  if (trimmed.length < 4) throw new Error('کد رهگیری درخواست سجاد را کامل وارد کنید.');
  const [a] = await db.select().from(graduation_audits).where(eq(graduation_audits.id, auditId)).limit(1);
  if (!a) throw new Error('پرونده یافت نشد.');

  await db.update(graduation_audits).set({
    sajjadRequestCode: trimmed, sajjadStatus: 'SUBMITTED',
    sajjadRequestedAt: new Date(), lastEventAt: new Date(),
  }).where(eq(graduation_audits.id, auditId));

  await notifyRole('EDU_EXPERT', 'GRADUATION_SAJJAD_SUBMITTED',
    `دانشجو کد رهگیری درخواست سجاد (${trimmed}) را ثبت کرد؛ پرونده آمادهٔ پیگیری کد صحت است.`);
  log.info('sajjad_submitted', { auditId });
  return advanceDossier(auditId);
}

/** معافیت/رد کردن گام سجاد توسط کارشناس (مثلاً مقاطع یا موارد خاص) */
export async function waiveSajjad(auditId: number, note?: string) {
  await db.update(graduation_audits).set({
    sajjadStatus: 'SKIPPED', headNote: note ?? undefined, lastEventAt: new Date(),
  }).where(eq(graduation_audits.id, auditId));
  return advanceDossier(auditId);
}

// ───────────────── مدارک پایانی (تنها گام دانشجو) ─────────────────

export async function setFinalPhoto(auditId: number, documentId: number) {
  await db.update(graduation_audits).set({ photoDocumentId: documentId, lastEventAt: new Date() })
    .where(eq(graduation_audits.id, auditId));
  return advanceDossier(auditId);
}

/**
 * هزینهٔ تمبر ابطال — فقط کارشناس مالی می‌تواند آن را «پرداخت‌شده» کند.
 *
 * ⛔ پیش از این، اکشن دانشجویی (`payStampAction`) همین کار را می‌کرد و بدون
 * هیچ درگاه یا رسیدی، ردیف `CREDIT` در `student_ledger` می‌نوشت؛ یعنی دانشجو
 * با یک کلیک بدهی خودش را در دفتر مالی پاک می‌کرد (forge).
 * حالا نوشتن به دفتر فقط از `settleStampFeeByFinance` انجام می‌شود: نقش مالی،
 * تراکنش اتمیک، قفل ردیف و ممیزی.
 */
export async function settleStampFeeByFinance(auditId: number, actorUserId: number) {
  return db.transaction(async (tx) => {
    // 🔒 قفل ردیف: دو کارشناس همزمان نتوانند دو بار ثبت کنند
    const rows = await tx.execute(sql`
      SELECT id, "studentId", "graduationTermId", "universityId",
             "stampFeeAmount", "stampFeePaid"
      FROM graduation_audits WHERE id = ${auditId} FOR UPDATE`);
    const a = rows.rows[0] as any;
    if (!a) throw new Error('پرونده یافت نشد.');
    if (a.stampFeePaid) throw new Error('این هزینه پیش‌تر تسویه شده است.');

    const fee = safeRials(String(a.stampFeeAmount ?? '0'));
    if (fee === null || fee <= 0) throw new Error('مبلغ هزینهٔ تمبر نامعتبر یا صفر است.');

    const [led] = await tx.insert(student_ledger).values({
      studentId: a.studentId,
      termId: a.graduationTermId ?? null,
      transactionType: 'PAYMENT',           // پرداخت واقعی، نه «اعتبار» رایگان
      amount: String(fee),
      description: 'پرداخت هزینهٔ تمبر ابطال دانشنامه (تأیید واحد مالی)',
      universityId: a.universityId ?? null,
    }).returning({ id: student_ledger.id });

    const upd = await tx.update(graduation_audits)
      .set({ stampFeePaid: 1, lastEventAt: new Date() })
      .where(sql`id = ${auditId} AND "stampFeePaid" = 0`);
    if (upd.rowCount !== 1) {
      throw new Error('وضعیت پرونده در همین لحظه تغییر کرد؛ دوباره تلاش کنید.');
    }

    await appendAudit(tx, {
      action: 'GRADUATION_STAMP_FEE_SETTLED',
      entityType: 'graduation_audits',
      entityId: auditId,
      actorUserId: actorUserId ?? null,
      details: JSON.stringify({ studentId: a.studentId, ledgerTxnId: led?.id ?? null, amount: fee }),
    });
    return { ok: true as const, ledgerTxnId: led?.id ?? null, amount: fee };
  });
}

// ───────────────────── صدور مدرک ─────────────────────

const rnd = (n: number) => crypto.randomBytes(n).toString('hex').toUpperCase().slice(0, n * 2);

/**
 * سریال‌سازی قطعی (کلیدهای مرتب) — PostgreSQL در ستون jsonb ترتیب کلیدها را
 * حفظ نمی‌کند، پس هش باید روی شکل نرمال‌شده محاسبه شود تا استعلام بعدی هم بخواند.
 */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}

function degreeHash(serialNo: string, verifyCode: string, snapshot: unknown, ministryCode: string | null) {
  return crypto.createHash('sha256')
    .update(`${serialNo}|${verifyCode}|${canonical(snapshot)}|${ministryCode ?? ''}`)
    .digest('hex');
}

export async function issueDegree(input: {
  auditId: number; degreeType: 'TEMPORARY' | 'PERMANENT' | 'TRANSCRIPT'; userId: number;
  ministryVerificationCode?: string;
}) {
  const [a] = await db.select().from(graduation_audits).where(eq(graduation_audits.id, input.auditId)).limit(1);
  if (!a) throw new Error('پرونده یافت نشد.');
  if (input.degreeType !== 'TRANSCRIPT' && a.workflowStatus !== 'READY_TO_ISSUE' && a.workflowStatus !== 'ISSUED') {
    throw new Error('پرونده هنوز آمادهٔ صدور نیست؛ مراحل تسویه و مدارک پایانی باید کامل شود.');
  }
  if (input.degreeType === 'PERMANENT' && !input.ministryVerificationCode) {
    const existingCode = (await db.select({ code: issued_degrees.ministryVerificationCode }).from(issued_degrees)
      .where(and(eq(issued_degrees.studentId, a.studentId), sql`${issued_degrees.ministryVerificationCode} is not null`)).limit(1))[0]?.code;
    if (!existingCode) throw new Error('برای دانشنامه، ابتدا «کد صحت» وزارت علوم (سجاد) باید دریافت شود.');
    // استفادهٔ مجدد از کد صحت قبلی: مقدار خام هرگز لاگ نمی‌شود (فقط ۴ رقم آخر)
    log.warn('degree_verification_code_reused', { studentId: a.studentId, codeSuffix: existingCode.slice(-4) });
    input.ministryVerificationCode = existingCode;
  }

  const [s] = await db.select({
    studentCode: students.studentCode, entryYear: students.entryYear,
    firstName: users.firstName, lastName: users.lastName, nationalCode: users.nationalCode,
    majorName: majors.name, degreeTitle: degree_level_configs.title,
  }).from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .leftJoin(majors, eq(majors.id, students.majorId))
    .leftJoin(degree_level_configs, eq(degree_level_configs.id, students.degreeLevelId))
    .where(eq(students.id, a.studentId)).limit(1);

  const prefix = (await getSetting('GRAD_SERIAL_PREFIX')) || 'AF';
  const year = new Date().getFullYear();
  // سریال بدون studentCode (عدم نشت شناسه) + بخش تصادفی؛ یکتایی در حلقه تضمین می‌شود
  let serialNo = '';
  for (let i = 0; i < 5; i++) {
    const cand = `${prefix}-${input.degreeType[0]}${year}-${rnd(4)}`;
    const [dup] = await db.select({ id: issued_degrees.id }).from(issued_degrees).where(eq(issued_degrees.serialNo, cand)).limit(1);
    if (!dup) { serialNo = cand; break; }
  }
  if (!serialNo) serialNo = `${prefix}-${input.degreeType[0]}${year}-${rnd(6)}`;
  // کد استعلام ۱۲۸ بیتی تصادفی (32 رقم hex)؛ یکتایی در حلقه تضمین می‌شود
  let verifyCode = '';
  for (let i = 0; i < 5; i++) {
    const cand = crypto.randomBytes(16).toString('hex').toUpperCase();
    const [dup] = await db.select({ id: issued_degrees.id }).from(issued_degrees).where(eq(issued_degrees.verifyCode, cand)).limit(1);
    if (!dup) { verifyCode = cand; break; }
  }
  if (!verifyCode) verifyCode = crypto.randomBytes(16).toString('hex').toUpperCase();

  const snapshot = {
    fullName: `${s.firstName} ${s.lastName}`,
    nationalCodeMasked: s.nationalCode.replace(/^(\d{3})\d{4}(\d{3})$/, '$1****$2'),
    studentCode: s.studentCode, major: s.majorName, degree: s.degreeTitle,
    gpa: a.gpa, passedUnits: a.passedUnits, entryYear: s.entryYear,
    issuedAtIso: new Date().toISOString(), degreeType: input.degreeType,
  };
  const documentHash = degreeHash(serialNo, verifyCode, snapshot, input.ministryVerificationCode ?? null);

  // ── چهار نوشتار حیاتی در یک تراکنش: اگر هر یک شکست بخورد، هیچ‌کدام اعمال
  //    نمی‌شود — مدرک صادرشده بدون «GRADUATED» شدن دانشجو باقی نمی‌ماند (و برعکس).
  let deg: typeof issued_degrees.$inferSelect | null = null;
  let studentUserId: number | null = null;

  await db.transaction(async tx => {
    const [inserted] = await tx.insert(issued_degrees).values({
      studentId: a.studentId, degreeType: input.degreeType, serialNo, verifyCode,
      ministryVerificationCode: input.ministryVerificationCode ?? null,
      documentHash, snapshot: snapshot as never, issuedByUserId: input.userId,
    }).returning();
    deg = inserted;

    if (input.degreeType !== 'TRANSCRIPT') {
      await tx.update(graduation_audits).set({
        workflowStatus: 'ISSUED', completedAt: new Date(), lastEventAt: new Date(),
      }).where(eq(graduation_audits.id, input.auditId));
      await tx.update(students).set({ status: 'GRADUATED' }).where(eq(students.id, a.studentId));
      await tx.insert(alumni_profiles).values({ studentId: a.studentId }).onConflictDoNothing();
      const [stu] = await tx.select({ userId: students.userId }).from(students).where(eq(students.id, a.studentId)).limit(1);
      studentUserId = stu?.userId ?? null;
    }
  });

  // اعلان پس از commit شدن تراکنش — تا تراکنش کوتاه بماند
  if (input.degreeType !== 'TRANSCRIPT' && studentUserId) {
    await notifyUser(studentUserId, 'DEGREE_ISSUED',
      `${input.degreeType === 'PERMANENT' ? 'دانشنامهٔ' : 'گواهینامهٔ موقت'} شما با شمارهٔ ${serialNo} صادر شد. از «پورتال دانش‌آموختگان» قابل مشاهده و استعلام است.`);
  }

  log.info('degree_issued', { studentId: a.studentId, type: input.degreeType, serialNo });
  return deg!;
}

/** دریافت «کد صحت» از سامانهٔ سجاد (وزارت علوم) — پیش‌نیاز دانشنامه */
export async function requestMinistryCode(auditId: number) {
  const [a] = await db.select().from(graduation_audits).where(eq(graduation_audits.id, auditId)).limit(1);
  if (!a) throw new Error('پرونده یافت نشد.');
  // کد صحت فقط وقتی قابل پیگیری است که خودِ دانشجو درخواستش را در سجاد ثبت کرده باشد
  if (await sajjadPending(a)) {
    throw new Error('ابتدا دانشجو باید در سامانهٔ سجاد درخواست کد صحت ثبت و کد رهگیری را در پرونده وارد کند.');
  }
  const [s] = await db.select({
    studentCode: students.studentCode, nationalCode: users.nationalCode,
    firstName: users.firstName, lastName: users.lastName,
  }).from(students).innerJoin(users, eq(users.id, students.userId)).where(eq(students.id, a.studentId)).limit(1);

  const base = (await getSetting('SAJJAD_BASE_URL')).replace(/\/+$/, '');
  let code: string;
  let online = false;
  if (base) {
    try {
      const timeout = (await getNumber('API_TIMEOUT_SECONDS', 10)) * 1000;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout);
      // گارد SSRF: SAJJAD_BASE_URL از تنظیمات می‌آید (allow-list: saorg.ir)
      const resp = await ssrfFetch(`${base}/degree-verification`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${await getSetting('IRANDOC_TOKEN')}` },
        body: JSON.stringify({
          national_id: s.nationalCode, student_code: s.studentCode,
          full_name: `${s.firstName} ${s.lastName}`, request_code: a.sajjadRequestCode ?? null,
        }),
      }, { settingKey: 'SAJJAD_BASE_URL' });
      clearTimeout(t);
      const j = (await resp.json()) as { verificationCode?: string; code?: string };
      code = String(j.verificationCode || j.code || '');
      online = !!code;
    } catch {
      code = '';
    }
  } else code = '';

  if (!code) {
    // سرویس سجاد پیکربندی نشده یا در دسترس نیست: کد محلی تصادفی با پیشوند مشخص
    // تا پرونده قفل نشود — هرگز مشتق از PII (کد ملی/شماره دانشجویی) نیست.
    code = `LOCAL-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  }

  await db.update(graduation_audits).set({
    note: `کد صحت: ${code}`, sajjadStatus: 'CONFIRMED', sajjadConfirmedAt: new Date(), lastEventAt: new Date(),
  }).where(eq(graduation_audits.id, auditId));
  return { ok: true, code, online };
}

export async function markDelivered(degreeId: number, deliveredTo: string) {
  await db.update(issued_degrees).set({ isDelivered: 1, deliveredAt: new Date(), deliveredTo })
    .where(eq(issued_degrees.id, degreeId));
  return { ok: true };
}

/** استعلام عمومی مدرک با کد QR (بدون نیاز به ورود) */
export async function verifyDegree(verifyCode: string) {
  const [d] = await db.select().from(issued_degrees).where(eq(issued_degrees.verifyCode, verifyCode.trim().toUpperCase())).limit(1);
  if (!d) return { found: false as const };
  const snap = (d.snapshot ?? {}) as Record<string, unknown>;
  const expected = degreeHash(d.serialNo, d.verifyCode, snap, d.ministryVerificationCode ?? null);
  return {
    found: true as const,
    valid: !d.revokedAt && expected === d.documentHash,
    revoked: !!d.revokedAt,
    revokeReason: d.revokeReason,
    serialNo: d.serialNo, degreeType: d.degreeType,
    ministryVerificationCode: d.ministryVerificationCode,
    issuedAt: d.issuedAt, snapshot: snap, documentHash: d.documentHash,
  };
}

// ───────────────────── نماها ─────────────────────

export type DossierView = Awaited<ReturnType<typeof getDossier>>;

export async function getDossier(auditId: number) {
  const [a] = await db.select().from(graduation_audits).where(eq(graduation_audits.id, auditId)).limit(1);
  if (!a) return null;
  const [s] = await db.select({
    studentCode: students.studentCode, firstName: users.firstName, lastName: users.lastName,
    majorName: majors.name, degreeTitle: degree_level_configs.title, status: students.status,
  }).from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .leftJoin(majors, eq(majors.id, students.majorId))
    .leftJoin(degree_level_configs, eq(degree_level_configs.id, students.degreeLevelId))
    .where(eq(students.id, a.studentId)).limit(1);
  const checklist = await db.select().from(clearance_checklist)
    .where(eq(clearance_checklist.auditId, auditId));
  const deps = await listDepartments(false);
  const degrees = await db.select().from(issued_degrees)
    .where(eq(issued_degrees.studentId, a.studentId)).orderBy(desc(issued_degrees.id));
  const [stuUser] = await db.select({ userId: students.userId }).from(students).where(eq(students.id, a.studentId)).limit(1);
  const deliveries = stuUser ? await deliveriesForUser(stuUser.userId, 12) : [];

  return {
    audit: {
      ...a,
      missingCourses: (a.missingCourses ?? []) as { code: string; title: string; units: number }[],
      startedAt: a.startedAt?.toISOString() ?? null,
      lastEventAt: a.lastEventAt?.toISOString() ?? null,
      completedAt: a.completedAt?.toISOString() ?? null,
      headApprovedAt: a.headApprovedAt?.toISOString() ?? null,
      irandocCheckedAt: a.irandocCheckedAt?.toISOString() ?? null,
      sajjadRequestedAt: a.sajjadRequestedAt?.toISOString() ?? null,
      sajjadConfirmedAt: a.sajjadConfirmedAt?.toISOString() ?? null,
      finalDocsAt: a.finalDocsAt?.toISOString() ?? null,
    },
    student: {
      studentCode: s?.studentCode ?? '', fullName: `${s?.firstName ?? ''} ${s?.lastName ?? ''}`.trim(),
      majorName: s?.majorName ?? null, degreeTitle: s?.degreeTitle ?? null, status: s?.status ?? '',
    },
    checklist: checklist.map(c => ({
      id: c.id, department: c.department,
      title: deps.find(d => d.code === c.department)?.title ?? c.department,
      status: c.status, amountDue: Number(c.amountDue ?? 0), detail: c.detail,
      autoChecked: c.autoChecked === 1,
      resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    })),
    degrees: degrees.map(d => ({
      id: d.id, degreeType: d.degreeType, serialNo: d.serialNo, verifyCode: d.verifyCode,
      ministryVerificationCode: d.ministryVerificationCode, isDelivered: d.isDelivered === 1,
      issuedAt: d.issuedAt.toISOString(), documentHash: d.documentHash,
    })),
    deliveries,
  };
}

export async function listDossiers(filter: { status?: string; q?: string; universityId?: number } = {}) {
  const conds = [];
  if (filter.status && filter.status !== 'ALL') conds.push(eq(graduation_audits.workflowStatus, filter.status));
  if (filter.universityId) conds.push(eq(students.universityId, filter.universityId));
  const rows = await db.select({
    id: graduation_audits.id, studentId: graduation_audits.studentId,
    workflowStatus: graduation_audits.workflowStatus, gpa: graduation_audits.gpa,
    passedUnits: graduation_audits.passedUnits, requiredUnits: graduation_audits.requiredUnits,
    headApprovalStatus: graduation_audits.headApprovalStatus,
    thesisRequired: graduation_audits.thesisRequired, irandocStatus: graduation_audits.irandocStatus,
    startedAt: graduation_audits.startedAt, lastEventAt: graduation_audits.lastEventAt,
    studentCode: students.studentCode, firstName: users.firstName, lastName: users.lastName,
    majorName: majors.name, degreeTitle: degree_level_configs.title,
  }).from(graduation_audits)
    .innerJoin(students, eq(students.id, graduation_audits.studentId))
    .innerJoin(users, eq(users.id, students.userId))
    .leftJoin(majors, eq(majors.id, students.majorId))
    .leftJoin(degree_level_configs, eq(degree_level_configs.id, students.degreeLevelId))
    .where(conds.length ? and(...conds) : sql`true`)
    .orderBy(desc(graduation_audits.lastEventAt)).limit(300);

  const q = filter.q?.trim();
  const out = rows.map(r => ({
    id: r.id, studentId: r.studentId, workflowStatus: r.workflowStatus,
    gpa: r.gpa == null ? null : Number(r.gpa),
    passedUnits: Number(r.passedUnits ?? 0), requiredUnits: Number(r.requiredUnits ?? 0),
    headApproved: r.headApprovalStatus === 1, thesisRequired: r.thesisRequired === 1,
    irandocStatus: r.irandocStatus, studentCode: r.studentCode,
    fullName: `${r.firstName} ${r.lastName}`, majorName: r.majorName, degreeTitle: r.degreeTitle,
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    lastEventAt: r.lastEventAt ? r.lastEventAt.toISOString() : null,
  }));
  return q ? out.filter(r => r.studentCode.includes(q) || r.fullName.includes(q)) : out;
}

export async function pipelineStats({ universityId }: { universityId?: number } = {}) {
  const whereCond = universityId ? eq(students.universityId, universityId) : undefined;
  const rows = await db.select({
    status: graduation_audits.workflowStatus, n: sql<number>`count(*)::int`,
  }).from(graduation_audits)
    .innerJoin(students, eq(students.id, graduation_audits.studentId))
    .where(whereCond)
    .groupBy(graduation_audits.workflowStatus);
  const map = new Map(rows.map(r => [r.status, Number(r.n)]));
  const [issued] = await db.select({ n: sql<number>`count(*)::int` }).from(issued_degrees);
  const [undelivered] = await db.select({ n: sql<number>`count(*)::int` }).from(issued_degrees).where(eq(issued_degrees.isDelivered, 0));
  return {
    steps: WORKFLOW_STEPS.map(s => ({ code: s.code, title: s.title, count: map.get(s.code) ?? 0 })),
    onHold: map.get('ON_HOLD') ?? 0,
    issuedDocs: Number(issued?.n ?? 0),
    undelivered: Number(undelivered?.n ?? 0),
  };
}

/** نمای دانشجو: نوار پیشرفت + تنها کاری که از خودش خواسته شده */
export async function getStudentTracker(studentId: number) {
  const [a] = await db.select().from(graduation_audits).where(eq(graduation_audits.studentId, studentId)).limit(1);
  if (!a) {
    const audit = await auditStudent(studentId);
    return { open: false as const, audit };
  }
  const full = await getDossier(a.id);
  const needPhoto = await getBool('GRAD_REQUIRE_PHOTO');
  const sajjadRequired = await getBool('GRAD_REQUIRE_SAJJAD') && a.sajjadStatus !== 'SKIPPED';
  const steps = stepsFor({ thesisRequired: a.thesisRequired === 1, sajjadRequired });
  return {
    open: true as const,
    needPhoto,
    sajjadRequired,
    needSajjad: await sajjadPending(a),
    sajjadPortal: await sajjadPortalUrl(),
    dossier: full,
    steps: steps.map(s => ({
      code: s.code, title: s.title, actor: s.actor,
      state: stepState(a.workflowStatus, s.code),
    })),
  };
}

function stepState(current: string, code: string): 'DONE' | 'CURRENT' | 'TODO' {
  const order = WORKFLOW_STEPS.map(s => s.code) as string[];
  const ci = order.indexOf(current);
  const si = order.indexOf(code);
  if (ci < 0 || si < 0) return 'TODO';
  if (si < ci) return 'DONE';
  if (si === ci) return current === 'ISSUED' ? 'DONE' : 'CURRENT';
  return 'TODO';
}

// ═══════════════════════════════════════════════════════════════════
//  Thesis Progress Tracking (پیش‌نیاز: جدول thesis_progress migration)
// ══════════════════════════════════════════════════════════════════

/** ایجاد/دریافت رکورد پیشرفت پایان‌نامه برای یک پرونده فارغ‌التحصیلی */
export async function getOrCreateThesisProgress(auditId: number) {
  
  const [existing] = await db.select().from(thesis_progress).where(eq(thesis_progress.auditId, auditId)).limit(1);
  if (existing) return existing;

  const [a] = await db.select().from(graduation_audits).where(eq(graduation_audits.id, auditId)).limit(1);
  if (!a) throw new Error('Audit not found');

  const [created] = await db.insert(thesis_progress).values({
    auditId, studentId: a.studentId,
    proposalStatus: 'NOT_STARTED',
    defenseRequestStatus: 'NOT_REQUESTED',
  }).returning();
  return created;
}

/** فاز ۱: ثبت استاد راهنما و عنوان اولیه + استعلام پیشینه ایرانداک */
export async function submitThesisTitleAndSupervisor(input: {
  auditId: number;
  supervisorId: number;
  advisorId?: number;
  titleFa: string;
  titleEn?: string;
  keywords?: string;
  abstract?: string;
}) {
  
  const tp = await getOrCreateThesisProgress(input.auditId);

  // Irandoc prior-check قبل از نوشتن پروپوزال
  let priorTracking = '', priorSim = 0, priorStatus = 'SKIPPED';
  try {
    const [stu] = await db.select({
      nationalCode: users.nationalCode,
    }).from(students).innerJoin(users, eq(users.id, students.userId))
      .where(eq(students.id, tp.studentId)).limit(1);

    if (stu?.nationalCode) {
      const r = await executeIrandocCheck({
        nationalCode: stu.nationalCode,
        trackingCode: '', // prior check doesn't need tracking code
        thesisTitle: input.titleFa,
        maxAllowedThreshold: await getNumber('GRAD_IRANDOC_MAX_SIMILARITY', 20),
      });
      priorTracking = r.trackingCode || '';
      priorSim = r.similarityPercentage;
      priorStatus = r.decision === 'AUTO_APPROVE' ? 'PASSED' : 'REJECTED';
    }
  } catch (e) {
    log.warn('irandoc_prior_check_failed', { auditId: input.auditId, err: (e as Error).message });
  }

  const [updated] = await db.update(thesis_progress)
    .set({
      supervisorId: input.supervisorId,
      advisorId: input.advisorId,
      titleFa: input.titleFa,
      titleEn: input.titleEn,
      keywords: input.keywords,
      abstract: input.abstract,
      irandocPriorTracking: priorTracking,
      irandocPriorSimilarity: String(priorSim),
      irandocPriorStatus: priorStatus,
      irandocPriorCheckedAt: new Date(),
      proposalStatus: priorStatus === 'PASSED' ? 'NOT_STARTED' : 'PRIOR_REJECTED',
      updatedAt: new Date(),
    })
    .where(eq(thesis_progress.id, tp.id))
    .returning();

  return { thesisProgress: updated, priorStatus, priorSim };
}

/** فاز ۲: آپلود پروپوزال → بررسی همانندجویی → تأیید کارشناس → آپلود ایرانداک */
export async function submitProposal(input: {
  auditId: number;
  fileId: number; // object_store reference
}) {
  
  const tp = await getOrCreateThesisProgress(input.auditId);

  if (!tp.titleFa) throw new Error('ابتدا عنوان و استاد راهنما را ثبت کنید (فاز ۱)');
  if (tp.irandocPriorStatus === 'REJECTED') throw new Error('پیشینه ایرانداک رد شده؛ ابتدا عنوان را تغییر دهید');

  // محاسبه همانندجویی پروپوزال (نیاز به متن کامل یا Fitch - فعلاً شبیه‌سازی)
  let propSim = 0;
  try {
    const [stu] = await db.select({ nationalCode: users.nationalCode })
      .from(students).innerJoin(users, eq(users.id, students.userId))
      .where(eq(students.id, tp.studentId)).limit(1);
    if (stu?.nationalCode) {
      const r = await executeIrandocCheck({
        nationalCode: stu.nationalCode,
        trackingCode: '',
        thesisTitle: tp.titleFa,
        maxAllowedThreshold: await getNumber('GRAD_IRANDOC_MAX_SIMILARITY', 20),
      });
      propSim = r.similarityPercentage;
    }
  } catch (e) {
    log.warn('proposal_similarity_failed', { auditId: input.auditId, err: (e as Error).message });
  }

  const [updated] = await db.update(thesis_progress)
    .set({
      proposalFileId: input.fileId,
      proposalSubmittedAt: new Date(),
      proposalSimilarity: String(propSim),
      proposalStatus: propSim <= 20 ? 'SIMILARITY_PASSED' : 'SIMILARITY_HIGH',
      updatedAt: new Date(),
    })
    .where(eq(thesis_progress.id, tp.id))
    .returning();

  // اگر مشابهت پایین است، مستقیماً به تأیید کارشناس می‌رود
  if (propSim <= 20) {
    // TODO: Notify EDU_EXPERT for review
  }

  return { thesisProgress: updated, similarity: propSim };
}

/** تأیید پروپوزال توسط کارشناس آموزش + آپلود به ایرانداک */
export async function approveProposalAndUploadIrandoc(input: {
  auditId: number;
  approvedBy: number;
  irandocTrackingCode: string;
}) {
  
  const tp = await getOrCreateThesisProgress(input.auditId);

  if (!['SIMILARITY_PASSED', 'EXPERT_REVIEW'].includes(tp.proposalStatus ?? '')) {
    throw new Error('پروپوزال در وضعیت قابل تأیید نیست');
  }

  const [updated] = await db.update(thesis_progress)
    .set({
      proposalStatus: 'APPROVED',
      proposalApprovedAt: new Date(),
      proposalApprovedBy: input.approvedBy,
      irandocUploadTracking: input.irandocTrackingCode,
      irandocUploadStatus: 'UPLOADED',
      irandocUploadedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(thesis_progress.id, tp.id))
    .returning();

  // TODO: Update graduation_audits.irandocStatus = 'PASSED' + advanceDossier
  await advanceDossier(input.auditId);

  return updated;
}

/** فاز ۳: درخواست دفاع + گزارش‌های پیشرفت */
export async function requestDefense(input: {
  auditId: number;
}) {
  
  const tp = await getOrCreateThesisProgress(input.auditId);

  if (tp.proposalStatus !== 'APPROVED') throw new Error('پروپوزال هنوز تأیید نشده');
  if (tp.irandocUploadStatus !== 'UPLOADED') throw new Error('پروپوزال در ایرانداک آپلود نشده');

  // محاسبه تاریخ رسیدن گزارش بعدی (۳ ماهه برای کارشناسی ارشد، ۶ ماهه برای دکتری)
  const [a] = await db.select({ degreeLevelId: students.degreeLevelId })
    .from(students).where(eq(students.id, tp.studentId)).limit(1);
  const isPhD = a?.degreeLevelId === 4; // PHD code
  const months = isPhD ? 6 : 3;
  const nextDue = new Date();
  nextDue.setMonth(nextDue.getMonth() + months);

  const [updated] = await db.update(thesis_progress)
    .set({
      defenseRequestStatus: 'SUPERVISOR_REVIEW',
      defenseRequestedAt: new Date(),
      nextProgressReportDue: nextDue,
      updatedAt: new Date(),
    })
    .where(eq(thesis_progress.id, tp.id))
    .returning();

  // TODO: Notify supervisor for approval
  return updated;
}

/** تأیید استاد راهنما برای دفاع */
export async function supervisorApproveDefense(input: {
  auditId: number;
  supervisorId: number;
  approved: boolean;
}) {
  
  const tp = await getOrCreateThesisProgress(input.auditId);

  if (tp.defenseRequestStatus !== 'SUPERVISOR_REVIEW') throw new Error('درخواست دفاع در مرحله بررسی راهنما نیست');
  if (tp.supervisorId !== input.supervisorId) throw new Error('تنها استاد راهنما می‌تواند تأیید کند');

  const newStatus = input.approved ? 'EXPERT_REVIEW' : 'SUPERVISOR_REJECTED';
  const [updated] = await db.update(thesis_progress)
    .set({
      defenseRequestStatus: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(thesis_progress.id, tp.id))
    .returning();

  if (input.approved) {
    // TODO: Notify EDU_EXPERT
  }
  return updated;
}

/** تأیید کارشناس آموزش + تعیین اتاق و هیأت داوران (اتوماتیک از jury_pools) */
export async function expertScheduleDefense(input: {
  auditId: number;
  expertId: number;
  scheduledAt: Date;
}) {
  const tp = await getOrCreateThesisProgress(input.auditId);

  if (tp.defenseRequestStatus !== 'EXPERT_REVIEW') throw new Error('درخواست دفاع در مرحله بررسی کارشناس نیست');

  // انتخاب خودکار اتاق و داوران از pool مربوط به رشته
  const [stu] = await db.select({ majorId: students.majorId })
    .from(students).where(eq(students.id, tp.studentId)).limit(1);
  const majorId = stu?.majorId ?? null;

  // استخر داور: اول pool مخصوص رشته (majorId = رشتهٔ دانشجو)، وگرنه pool عمومی (majorId = NULL)
  const poolRows = await db.select().from(defense_jury_pools)
    .where(eq(defense_jury_pools.isActive, 1))
    .orderBy(asc(defense_jury_pools.id));
  const scopedPools = majorId != null ? poolRows.filter(p => p.majorId === majorId) : [];
  const genericPools = poolRows.filter(p => p.majorId == null);
  // pool دارای اتاق بر pool بدون اتاق مقدم است
  const pickPool = (list: typeof poolRows) =>
    list.find(p => p.roomId != null) ?? list[0];
  const pool = pickPool(scopedPools) ?? pickPool(genericPools);

  // اتاق: اول roomId خودِ pool — فقط اگر واقعاً در جدول classrooms وجود داشته باشد
  let roomId: number | null = null;
  if (pool?.roomId != null) {
    const [poolRoom] = await db.select({ id: classrooms.id })
      .from(classrooms).where(eq(classrooms.id, pool.roomId)).limit(1);
    roomId = poolRoom?.id ?? null;
  }

  if (roomId == null) {
    // Fallback: اتاقِ دانشکدهٔ دانشجو، وگرنه اتاق عمومی — همیشه بزرگ‌ترین ظرفیت
    // (classrooms ستون isActive ندارد؛ فقط capacity/name/facultyId موجود است)
    const [m] = majorId != null
      ? await db.select({ facultyId: majors.facultyId })
        .from(majors).where(eq(majors.id, majorId)).limit(1)
      : [{ facultyId: null }];
    const facultyId = m.facultyId ?? null;

    const rooms = await db.select({
      id: classrooms.id, capacity: classrooms.capacity, facultyId: classrooms.facultyId,
    }).from(classrooms)
      .orderBy(desc(classrooms.capacity), asc(classrooms.name));
    roomId = (facultyId != null ? rooms.find(r => r.facultyId === facultyId)?.id : undefined)
      ?? rooms.find(r => r.facultyId == null)?.id
      ?? rooms[0]?.id
      ?? null;
  }

  if (roomId == null) {
    log.warn('defense_room_not_assigned', { auditId: input.auditId, poolId: pool?.id ?? null });
  }

  const [updated] = await db.update(thesis_progress)
    .set({
      defenseRequestStatus: 'SCHEDULED',
      defenseScheduledAt: input.scheduledAt,
      defenseRoomId: roomId,
      juryChairId: pool?.chairId,
      jurySupervisorId: tp.supervisorId,
      juryInternalId: pool?.internalIds?.[0],
      juryExternalId: pool?.externalIds?.[0],
      updatedAt: new Date(),
    })
    .where(eq(thesis_progress.id, tp.id))
    .returning();

  // Create defense_sessions record
  await db.insert(defense_sessions)
    .values({
      thesisProgressId: tp.id,
      studentId: tp.studentId,
      scheduledAt: input.scheduledAt,
      roomId,
      chairId: pool?.chairId,
      supervisorId: tp.supervisorId,
      internalId: pool?.internalIds?.[0],
      externalId: pool?.externalIds?.[0],
      status: 'SCHEDULED',
    });

  return updated;
}

/** ثبت نتیجه دفاع */
export async function recordDefenseResult(input: {
  auditId: number;
  result: 'PASSED' | 'FAILED' | 'CONDITIONAL';
  minutes?: string;
  conductedAt: Date;
}) {
  
  const tp = await getOrCreateThesisProgress(input.auditId);

  const [updated] = await db.update(thesis_progress)
    .set({
      defenseRequestStatus: input.result === 'PASSED' ? 'PASSED' : 'FAILED',
      defenseConductedAt: input.conductedAt,
      defenseResult: input.result,
      defenseNote: input.minutes,
      updatedAt: new Date(),
    })
    .where(eq(thesis_progress.id, tp.id))
    .returning();

  // Update defense_sessions
  await db.update(defense_sessions)
    .set({ status: 'CONDUCTED', result: input.result, minutes: input.minutes })
    .where(eq(defense_sessions.thesisProgressId, tp.id));

  if (input.result === 'PASSED') {
    // Advance to final thesis upload phase
    // graduation_audits workflowStatus -> FINAL_THESIS_UPLOAD
  }

  return updated;
}

/** آپلود پایان‌نامه نهایی + استعلام ایرانداک نهایی */
export async function submitFinalThesis(input: {
  auditId: number;
  fileId: number;
}) {
  
  const tp = await getOrCreateThesisProgress(input.auditId);

  if (tp.defenseRequestStatus !== 'PASSED') throw new Error('دفاع هنوز انجام نشده یا رد شده');

  const [updated] = await db.update(thesis_progress)
    .set({
      finalThesisFileId: input.fileId,
      finalThesisSubmittedAt: new Date(),
      finalIrandocStatus: 'PENDING',
      updatedAt: new Date(),
    })
    .where(eq(thesis_progress.id, tp.id))
    .returning();

  // TODO: Trigger Irandoc final check (async)
  return updated;
}

/** بررسی نهایی ایرانداک (اجرای دستی یا خودکار) */
export async function runFinalIrandocCheck(input: {
  auditId: number;
  trackingCode: string;
  title?: string;
}) {
  
  const tp = await getOrCreateThesisProgress(input.auditId);

  const [stu] = await db.select({
    nationalCode: users.nationalCode,
  }).from(students).innerJoin(users, eq(users.id, students.userId))
    .where(eq(students.id, tp.studentId)).limit(1);

  const title = input.title || tp.titleFa || '';
  const r = await executeIrandocCheck({
    nationalCode: stu?.nationalCode ?? '',
    trackingCode: input.trackingCode,
    thesisTitle: title,
    maxAllowedThreshold: await getNumber('GRAD_IRANDOC_MAX_SIMILARITY', 20),
  });

  const passed = r.decision === 'AUTO_APPROVE';
  const [updated] = await db.update(thesis_progress)
    .set({
      finalIrandocTracking: input.trackingCode,
      finalIrandocSimilarity: String(r.similarityPercentage),
      finalIrandocStatus: passed ? 'PASSED' : 'REJECTED',
      finalIrandocCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(thesis_progress.id, tp.id))
    .returning();

  if (passed) {
    // Update graduation_audits -> READY_TO_ISSUE
    await db.update(graduation_audits)
      .set({ workflowStatus: 'READY_TO_ISSUE', lastEventAt: new Date() })
      .where(eq(graduation_audits.id, input.auditId));
  }

  return { thesisProgress: updated, passed, similarity: r.similarityPercentage };
}

/** دریافت پیشرفت پایان‌نامه برای نمایش در پورتال دانشجو/استاد/ادمین */
export async function getThesisProgress(auditId: number) {
  
  const tp = await getOrCreateThesisProgress(auditId);

  const [supervisor] = tp.supervisorId ? await db.select({
    id: staff.id, name: users.firstName, family: users.lastName
  }).from(staff).innerJoin(users, eq(users.id, staff.userId)).where(eq(staff.id, tp.supervisorId)).limit(1) : [null];

  const [advisor] = tp.advisorId ? await db.select({
    id: staff.id, name: users.firstName, family: users.lastName
  }).from(staff).innerJoin(users, eq(users.id, staff.userId)).where(eq(staff.id, tp.advisorId)).limit(1) : [null];

  const [room] = tp.defenseRoomId ? await db.select({ name: classrooms.name }).from(classrooms).where(eq(classrooms.id, tp.defenseRoomId)).limit(1) : [null];

  return {
    ...tp,
    supervisor: supervisor ? `${supervisor.name} ${supervisor.family}` : null,
    advisor: advisor ? `${advisor.name} ${advisor.family}` : null,
    defenseRoom: room?.name ?? null,
  };
}

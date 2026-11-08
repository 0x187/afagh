import 'server-only';
import { createHash } from 'crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  degree_level_configs, document_categories, document_types, majors,
  request_step_logs, staff, student_documents, student_requests, students, users,
} from '@/db/schema';
import { getSetting, getPublicBaseUrl } from '@/lib/settings';
import { qrSvg } from '@/lib/qr';
import { toShamsi } from '@/lib/shamsi';
import { putArchiveObject } from '@/lib/objectStore';
import { maskNationalCode } from '@/lib/verification';
import { createLogger } from '@/lib/logger';
import { appendAudit } from '@/lib/audit';
import { effectiveEquivMinGrade } from '@/lib/compliance-integrations';

const log = createLogger({ mod: 'equivalence-form' });

/**
 * صدور «فرم رسمی ممهور معادل‌سازی» — سند رسمی با امضای مدیر گروه و مدیرکل
 * امور آموزشی. خروجی:
 *   ۱) یک نسخه در بایگانی الکترونیک (Object Storage — باکت afagh-archive)
 *   ۲) یک ردیف در پروندهٔ فارغ‌التحصیلان/دانشجو (student_documents) با هش SHA-256
 *      تا اصالت سند قابل استعلام باشد.
 */

export interface EquivalenceFormItem {
  sourceTitle: string;
  sourceUnits?: number | string | null;
  sourceGrade?: number | string | null;
  targetCourseCode?: string | null;
  targetCourseTitle?: string | null;
  headComment?: string | null;
}

export interface Signatory {
  role: string;
  roleTitle: string;
  name: string;
  signedAt: string | null;
}

const ROLE_FA: Record<string, string> = {
  DEPARTMENT_HEAD: 'مدیر گروه تخصصی',
  EDU_EXPERT: 'مدیرکل امور آموزشی و تحصیلات تکمیلی',
  VICE_EDU: 'معاون آموزشی',
  ADMIN: 'مدیر سامانه',
};

const faNum = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** نام امضاکنندگان یک درخواست از لاگ گام‌ها (مدیر گروه + مدیرکل) */
async function resolveSignatories(requestId: number): Promise<Signatory[]> {
  const rows = await db
    .select({
      actorRole: request_step_logs.actorRole,
      actorStaffId: request_step_logs.actorStaffId,
      completedAt: request_step_logs.completedAt,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(request_step_logs)
    .leftJoin(staff, eq(staff.id, request_step_logs.actorStaffId))
    .leftJoin(users, eq(users.id, staff.userId))
    .where(and(eq(request_step_logs.requestId, requestId), eq(request_step_logs.action, 'APPROVE')))
    .orderBy(asc(request_step_logs.id));

  const seen = new Set<string>();
  const out: Signatory[] = [];
  for (const r of rows) {
    const role = r.actorRole || 'EDU_EXPERT';
    if (seen.has(role)) continue;
    seen.add(role);
    const name = r.firstName ? `${r.firstName} ${r.lastName ?? ''}`.trim() : 'کارشناس امور آموزشی';
    out.push({
      role,
      roleTitle: ROLE_FA[role] ?? role,
      name,
      signedAt: r.completedAt ? toShamsi(r.completedAt.toISOString()) : null,
    });
  }
  return out;
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** ساخت HTML فرم رسمی ممهور (قابل چاپ و بایگانی)
 *
 * سیاست نمایش کد ملی (P2):
 *  - چاپ/بایگانی پیش‌فرض فقط کد ملی ماسک‌شده + کد استعلام را نشان می‌دهد.
 *  - نسخهٔ کامل فقط با `fullNationalCode` صادر می‌شود و همیشه واترمارک دارد؛
 *    فراخواننده موظف است پیش از تحویل، `logEquivalenceFormAccess(...,'FULL')`
 *    را صدا بزند (fail-closed: اگر ثبت دسترسی ناموفق بود، نسخه تحویل ندهید).
 * اعتبار سند رسمی از هش SHA-256 + QR استعلام است و با ماسک‌شدن نمایش کم نمی‌شود.
 */
export async function buildEquivalenceFormHtml(params: {
  universityName: string;
  trackingCode: string;
  studentName: string;
  nationalCode: string;
  studentCode: string;
  majorTitle: string;
  degreeTitle: string;
  previousUniversity: string;
  items: EquivalenceFormItem[];
  signatories: Signatory[];
  verifyUrl: string;
  contentHash: string;
  inquiryCode?: string | null;
  fullNationalCode?: string | null;
  /** متن پویای حداقل نمره (مادهٔ ۱۲ الف، بر اساس مقطع) */
  minGradeNote?: string | null;
}): Promise<string> {
  const { universityName, trackingCode, studentName, nationalCode, studentCode, majorTitle, degreeTitle, previousUniversity, items, signatories, verifyUrl, contentHash } = params;
  const qr = await qrSvg(verifyUrl, { errorCorrectionLevel: 'M' });
  const showFull = !!params.fullNationalCode;
  const displayedCode = showFull ? String(params.fullNationalCode) : maskNationalCode(nationalCode);
  const inquiryCode = (params.inquiryCode ?? '').trim();
  const minGradeNote = params.minGradeNote || 'حداقل نمرهٔ قابل پذیرش برای معادلسازی ۱۲ از ۲۰ است.';

  const rowsHtml = items.map((it, i) => `
    <tr>
      <td class="c">${faNum(i + 1)}</td>
      <td>${escapeHtml(it.sourceTitle)}</td>
      <td class="c">${faNum(it.sourceUnits)}</td>
      <td class="c">${faNum(it.sourceGrade)}</td>
      <td class="c">${escapeHtml(it.targetCourseCode)}</td>
      <td>${escapeHtml(it.targetCourseTitle ?? '')}</td>
    </tr>`).join('');

  const sigHtml = signatories.map(s => `
    <div class="sig">
      <div class="sig-role">${escapeHtml(s.roleTitle)}</div>
      <div class="sig-name">${escapeHtml(s.name)}</div>
      <div class="sig-date">تاریخ: ${faNum(s.signedAt ?? '—')}</div>
      <div class="sig-stamp">مهر و امضا</div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
<meta charset="UTF-8" />
<title>فرم رسمی معادل‌سازی — ${escapeHtml(trackingCode)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; font-family:'Vazirmatn','Tahoma',sans-serif; color:#0f172a; background:#fff; }
  .head { display:flex; align-items:center; justify-content:space-between; border-bottom:3px double #1e1b4b; padding-bottom:12px; }
  .head .uni { font-size:20px; font-weight:800; color:#1e1b4b; }
  .head .sub { font-size:12px; color:#475569; margin-top:4px; }
  .title { text-align:center; font-size:18px; font-weight:800; margin:18px 0 4px; }
  .doc-no { text-align:center; font-size:12px; color:#475569; margin-bottom:16px; }
  .info { width:100%; border-collapse:collapse; margin-bottom:16px; font-size:13px; }
  .info td { border:1px solid #cbd5e1; padding:8px 10px; }
  .info td.k { background:#f1f5f9; font-weight:700; width:130px; }
  table.courses { width:100%; border-collapse:collapse; font-size:12px; margin-bottom:8px; }
  table.courses th, table.courses td { border:1px solid #94a3b8; padding:7px 8px; }
  table.courses th { background:#1e1b4b; color:#fff; font-weight:700; }
  table.courses td.c { text-align:center; }
  .note { font-size:11px; color:#475569; margin:10px 0 20px; line-height:1.7; }
  .sigs { display:flex; justify-content:space-between; gap:16px; margin-top:24px; }
  .sig { flex:1; border:1px dashed #94a3b8; border-radius:10px; padding:14px; text-align:center; }
  .sig-role { font-size:12px; font-weight:800; color:#1e1b4b; }
  .sig-name { font-size:14px; font-weight:700; margin:8px 0; }
  .sig-date { font-size:11px; color:#475569; }
  .sig-stamp { margin-top:16px; font-size:11px; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:8px; }
  .foot { display:flex; justify-content:space-between; align-items:flex-end; margin-top:28px; border-top:1px solid #e2e8f0; padding-top:12px; }
  .qr { width:110px; height:110px; }
  .qr svg { width:110px; height:110px; }
  .hash { font-family:monospace; font-size:9px; color:#64748b; word-break:break-all; max-width:60%; }
  .wm { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; z-index:50; }
  .wm span { transform:rotate(-30deg); font-size:56px; font-weight:900; color:rgba(190,18,60,.13); border:4px solid rgba(190,18,60,.13); padding:10px 26px; border-radius:12px; white-space:nowrap; }
  .fullbanner { background:#fef2f2; border:1px solid #fecaca; color:#991b1b; font-size:12px; font-weight:700; border-radius:8px; padding:8px 12px; margin-bottom:14px; }
  @media print { .wm span { color:rgba(190,18,60,.18); border-color:rgba(190,18,60,.18); } }
</style>
</head>
<body>
  ${showFull ? '<div class="wm"><span>نسخهٔ کامل — محرمانه</span></div><div class="fullbanner">نسخهٔ کامل با کد ملی بدون ماسک — دسترسی به این نسخه در لاگ ممیزی ثبت می‌شود.</div>' : ''}
  <div class="head">
    <div>
      <div class="uni">${escapeHtml(universityName)}</div>
      <div class="sub">اداره کل امور آموزشی و تحصیلات تکمیلی</div>
    </div>
    <div style="text-align:left; font-size:11px; color:#475569;">
      شمارهٔ سند: <b>${escapeHtml(trackingCode)}</b><br />
      تاریخ صدور: ${faNum(toShamsi(new Date().toISOString()))}
    </div>
  </div>

  <div class="title">فرم رسمی معادل‌سازی دروس</div>
  <div class="doc-no">موضوع: معادل‌سازی دروس گذرانده‌شده در مؤسسهٔ آموزش عالی قبلی</div>

  <table class="info rt">
    <tr><td class="k">نام و نام خانوادگی</td><td>${escapeHtml(studentName)}</td><td class="k">کد ملی${showFull ? ' (کامل)' : ''}</td><td>${faNum(displayedCode)}</td></tr>
    <tr><td class="k">شمارهٔ دانشجویی</td><td>${faNum(studentCode)}</td><td class="k">رشته / مقطع</td><td>${escapeHtml(majorTitle)} — ${escapeHtml(degreeTitle)}</td></tr>
    <tr><td class="k">مؤسسهٔ مبدأ</td><td colspan="3">${escapeHtml(previousUniversity)}</td></tr>
    ${inquiryCode ? `<tr><td class="k">کد استعلام</td><td colspan="3"><b>${escapeHtml(inquiryCode)}</b> <span style="font-size:11px;color:#475569;">(برای استعلام اصالت، همین کد یا QR پایین سند کافی است — نیازی به کد ملی کامل نیست.)</span></td></tr>` : ''}
  </table>

  <table class="courses rt">
    <thead>
      <tr><th>ردیف</th><th>عنوان درس مبدأ</th><th>واحد</th><th>نمره</th><th>کد درس مقصد</th><th>عنوان درس مقصد</th></tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <p class="note">
    بدین‌وسیله گواهی می‌شود دروس فوق پس از بررسی سرفصل و انطباق علمی توسط مدیر گروه تخصصی و تأیید نهایی
    مدیرکل امور آموزشی، در چارت درسی این دانشگاه معادلسازی و در کارنامهٔ دانشجو ثبت گردید.
    ${minGradeNote} این سند صرفاً با مهر و امضای مجازهای ذیل معتبر است.
  </p>

  <div class="sigs">${sigHtml}</div>

  <div class="foot">
    <div class="hash">
      استعلام اصالت: ${escapeHtml(verifyUrl)}<br />
      SHA-256: ${escapeHtml(contentHash)}
    </div>
    <div class="qr">${qr}</div>
  </div>
</body>
</html>`;
}

/** دسته/نوع سند «معادل‌سازی» در بایگانی — find-or-create (بدون مقدار سخت‌کد) */
async function ensureDocType(): Promise<{ categoryId: number; typeId: number }> {
  const catTitle = 'اسناد آموزشی';
  let [cat] = await db.select().from(document_categories).where(eq(document_categories.title, catTitle)).limit(1);
  if (!cat) {
    const [ins] = await db.insert(document_categories).values({ title: catTitle, scope: 'STUDENT' }).returning({ id: document_categories.id });
    cat = { id: ins.id } as typeof cat;
  }
  const typeCode = 'EQUIVALENCE_FORM';
  let [typ] = await db.select().from(document_types).where(eq(document_types.code, typeCode)).limit(1);
  if (!typ) {
    const [ins] = await db.insert(document_types).values({
      categoryId: cat.id, code: typeCode, title: 'فرم رسمی معادل‌سازی',
      targetAudience: 'BOTH', isRequired: 0, needsVerification: 1,
    }).returning({ id: document_types.id });
    typ = { id: ins.id } as typeof typ;
  }
  return { categoryId: cat.id, typeId: typ.id };
}

/**
 * ثبت دسترسی به فرم معادل‌سازی در زنجیرهٔ ممیزی.
 * نسخهٔ کامل (FULL) فقط وقتی تحویل داده شود که این ثبت موفق باشد (fail-closed) —
 * یعنی فراخواننده باید await کند و روی خطا، نسخه را برنگرداند.
 */
export async function logEquivalenceFormAccess(params: {
  actorUserId: number | null;
  requestId: number;
  trackingCode: string;
  mode: 'MASKED' | 'FULL';
}): Promise<void> {
  await db.transaction(async (tx) => {
    await appendAudit(tx, {
      actorUserId: params.actorUserId,
      action: 'EQUIVALENCE_FORM_VIEW',
      entityType: 'student_request',
      entityId: params.requestId,
      details: JSON.stringify({ trackingCode: params.trackingCode, mode: params.mode }),
    });
  });
  log.info('equivalence_form_access', { requestId: params.requestId, mode: params.mode });
}

/** کد استعلام چاپی — مشتق قطعی از هش سند (بدون نیاز به ستون جدید، قابل راستی‌آزمایی با QR/هش) */
export function inquiryCodeForHash(contentHash: string): string {
  const h = String(contentHash || '').replace(/[^0-9a-f]/gi, '').toUpperCase().padEnd(8, '0');
  return `AFG-${h.slice(0, 4)}-${h.slice(4, 8)}`;
}

/**
 * صدور و بایگانی فرم رسمی معادل‌سازی برای یک درخواست تصویب‌شده.
 * اگر قبلاً برای همین درخواست صادر شده باشد، چیزی نوشته نمی‌شود (idempotent).
 * نسخهٔ بایگانی‌شده همیشه ماسک‌شده است (کد ملی کامل در HTML بایگانی نمی‌ماند)؛
 * اعتبار رسمی از هش + QR استعلام است.
 */
export async function issueEquivalenceForm(requestId: number): Promise<{ ok: boolean; key?: string; hash?: string; inquiryCode?: string; skipped?: boolean; error?: string }> {
  const [req] = await db.select().from(student_requests).where(eq(student_requests.id, requestId)).limit(1);
  if (!req) return { ok: false, error: 'درخواست یافت نشد.' };

  let formData: Record<string, any> = {};
  try { if (req.formData) formData = JSON.parse(req.formData); } catch { /* ignore */ }
  const items: EquivalenceFormItem[] = Array.isArray(formData.items) ? formData.items : [];
  if (items.length === 0) {
    return { ok: false, skipped: true, error: 'فهرست معادل‌سازی برای صدور فرم موجود نیست.' };
  }

  const [stu] = await db
    .select({
      id: students.id, userId: students.userId, studentCode: students.studentCode,
      firstName: users.firstName, lastName: users.lastName, nationalCode: users.nationalCode,
      majorTitle: majors.name, degreeTitle: degree_level_configs.title,
    })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .leftJoin(majors, eq(majors.id, students.majorId))
    .leftJoin(degree_level_configs, eq(degree_level_configs.id, students.degreeLevelId))
    .where(eq(students.id, req.studentId))
    .limit(1);
  if (!stu) return { ok: false, error: 'پروندهٔ دانشجو یافت نشد.' };

  const { categoryId, typeId } = await ensureDocType();

  // محتوای متعارف برای هش — شامل کد رهگیری، پس هر درخواست معادل‌سازی
  // امضای دیجیتال یکتای خودش را دارد و فرم‌های متعدد یک دانشجو یکدیگر را
  // «تکراری» جلوه نمی‌دهند.
  const canonical = JSON.stringify({
    trackingCode: req.trackingCode,
    studentCode: stu.studentCode,
    nationalCode: stu.nationalCode,
    previousUniversity: formData.previousUniversity ?? '',
    items: items.map(i => ({
      s: i.sourceTitle, u: i.sourceUnits ?? null, g: i.sourceGrade ?? null, t: i.targetCourseCode ?? null,
    })),
  });
  const contentHash = createHash('sha256').update(canonical).digest('hex');

  // idempotent: اگر همین سند (با همین امضا) قبلاً صادر شده، دوباره ننویس
  const [dup] = await db
    .select({ id: student_documents.id })
    .from(student_documents)
    .where(eq(student_documents.contentHash, contentHash))
    .limit(1);
  if (dup) return { ok: true, skipped: true, hash: contentHash, inquiryCode: inquiryCodeForHash(contentHash) };

  const universityName = (await getSetting('UNIVERSITY_NAME')) || 'دانشگاه آفاق';
  const signatories = await resolveSignatories(requestId);
  const verifyUrl = `${await getPublicBaseUrl()}/verify/document/${contentHash}`;
  const inquiryCode = inquiryCodeForHash(contentHash);

  const html = await buildEquivalenceFormHtml({
    universityName,
    trackingCode: req.trackingCode,
    studentName: `${stu.firstName} ${stu.lastName}`.trim(),
    nationalCode: stu.nationalCode,
    studentCode: stu.studentCode,
    majorTitle: stu.majorTitle ?? '—',
    degreeTitle: stu.degreeTitle ?? '—',
    previousUniversity: String(formData.previousUniversity ?? '—'),
    items,
    signatories,
    verifyUrl,
    contentHash,
    inquiryCode,
    minGradeNote: `حداقل نمرهٔ قابل پذیرش برای معادلسازی ${await effectiveEquivMinGrade(stu.id)} از ۲۰ است (مادهٔ ۱۲ الف، بر اساس مقطع تحصیلی).`,
  });

  const buf = Buffer.from(html, 'utf-8');
  const key = `archive/${stu.userId}/equivalence-${req.trackingCode}-${Date.now()}.html`;
  await putArchiveObject(key, buf, 'text/html; charset=utf-8');

  await db.insert(student_documents).values({
    personUserId: stu.userId,
    categoryId,
    typeId,
    fileName: `فرم معادل‌سازی ${req.trackingCode}.html`,
    fileUrl: key,
    mimeType: 'text/html',
    contentHash,
    verificationStatus: 'VERIFIED',
  });

  log.info('equivalence_form_issued', { requestId, trackingCode: req.trackingCode, inquiryCode });
  return { ok: true, key, hash: contentHash, inquiryCode };
}

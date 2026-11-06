/**
 * گزارشِ خوانا از یک `SyncPlan` (مارک‌داون) — همان چیزی که کارشناس آموزش
 * می‌خواند و همان چیزی که در صفحهٔ ادمین نشان داده می‌شود.
 *
 * عمداً هیچ کوئری و هیچ تاریخ‌گیریِ مبهمی اینجا نیست؛ همه‌چیز از `plan` می‌آید
 * تا گزارشِ «قبل از اجرا» و «بعد از اجرا» قابل مقایسه باشند.
 */

import type { SyncPlan, SyncIssueCode } from './types';

const fa = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString('fa-IR');

const CODE_LABELS: Record<SyncIssueCode, string> = {
  ADD_ENROLLMENT: 'افزودن ثبت‌نام',
  ADD_STUDENT: 'دانشجوی گم‌شده',
  FILL_GRADE: 'پرکردن نمره',
  GROUP_MISMATCH: 'اختلاف گروه',
  OFFERING_MISSING: 'ارائه ناموجود',
  EXTRA_ENROLLMENT: 'واحد اضافی',
  STUDENT_AMBIGUOUS: 'کد دانشجوی مبهم',
  DUPLICATE_OFFERING: 'ارائه تکراری',
  STATUS_MISMATCH: 'اختلاف نمره/وضعیت',
};

export const ISSUE_LABELS = CODE_LABELS;

/** خلاصهٔ کوتاه برای نمایش در کارت. */
export function planSummary(plan: SyncPlan): string {
  const s = plan.stats;
  return `ترم ${plan.termCode}: ${fa(s.matched)} تطبیق، ${fa(s.addEnrollment)} افزودن، `
    + `${fa(s.fillGrade)} نمره، ${fa(plan.issues.length)} اختلاف`;
}

export function toMarkdown(plan: SyncPlan, meta: { generatedAt?: Date; source?: string } = {}): string {
  const s = plan.stats;
  const when = (meta.generatedAt ?? new Date()).toISOString().slice(0, 19).replace('T', ' ');
  const byCode = new Map<SyncIssueCode, number>();
  for (const i of plan.issues) byCode.set(i.code, (byCode.get(i.code) ?? 0) + 1);

  const lines: string[] = [];
  lines.push(`# گزارش همگام‌سازی سما → آفاق — ترم ${plan.termCode}`);
  lines.push('');
  lines.push(`- زمان تولید گزارش: \`${when}\``);
  if (meta.source) lines.push(`- منبع فایل: \`${meta.source}\``);
  lines.push(`- دانشگاه: \`${plan.universityId}\` · ترم داخلی: \`${plan.termId}\``);
  lines.push('');
  lines.push('## خلاصه');
  lines.push('');
  lines.push('| شاخص | مقدار |');
  lines.push('|---|---|');
  lines.push(`| ردیف انتخاب واحد سما (یکتا) | ${fa(s.samaEnrollmentRows)} |`);
  lines.push(`| دانشجوی یکتای سما | ${fa(s.samaUniqueStudents)} |`);
  lines.push(`| (درس، گروه) یکتای سما | ${fa(s.samaUniqueOfferings)} |`);
  lines.push(`| ثبت‌نام موجود آفاق | ${fa(s.afaghEnrollmentRows)} |`);
  lines.push(`| **تطبیق کامل** | **${fa(s.matched)}** |`);
  lines.push(`| افزودنی (اجرا می‌شود) | ${fa(s.addEnrollment)} |`);
  lines.push(`| پرکردن نمرهٔ خالی (اجرا می‌شود) | ${fa(s.fillGrade)} |`);
  lines.push(`| اختلاف گروه (بازبینی) | ${fa(s.groupMismatch)} |`);
  lines.push(`| ارائه ناموجود (بازبینی) | ${fa(s.offeringMissing)} |`);
  lines.push(`| واحد اضافی در آفاق (بازبینی) | ${fa(s.extraEnrollment)} |`);
  lines.push(`| دانشجوی گم‌شده (بازبینی) | ${fa(s.studentMissing)} |`);
  lines.push(`| کد دانشجوی مبهم | ${fa(s.studentAmbiguous)} |`);
  lines.push(`| ارائهٔ تکراری در آفاق | ${fa(s.duplicateOffering)} |`);
  lines.push('');

  if (plan.warnings.length) {
    lines.push('## هشدارهای پارس');
    lines.push('');
    for (const w of plan.warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  lines.push('## اختلاف‌ها به تفکیک نوع');
  lines.push('');
  if (byCode.size === 0) {
    lines.push('هیچ اختلافی یافت نشد. ✅');
    lines.push('');
  } else {
    lines.push('| نوع | تعداد | تصمیم |');
    lines.push('|---|---|---|');
    for (const [code, n] of [...byCode.entries()].sort((a, b) => b[1] - a[1])) {
      const auto = code === 'ADD_ENROLLMENT' || code === 'FILL_GRADE';
      lines.push(`| ${CODE_LABELS[code]} | ${fa(n)} | ${auto ? 'خودکار (افزودنی)' : 'نیازمند بازبینی'} |`);
    }
    lines.push('');
  }

  const REVIEW_LIMIT = 60;
  for (const code of Object.keys(CODE_LABELS) as SyncIssueCode[]) {
    const list = plan.issues.filter((i) => i.code === code);
    if (!list.length) continue;
    lines.push(`### ${CODE_LABELS[code]} — ${fa(list.length)} مورد`);
    lines.push('');
    for (const i of list.slice(0, REVIEW_LIMIT)) lines.push(`- ${i.message}`);
    if (list.length > REVIEW_LIMIT) lines.push(`- … و ${fa(list.length - REVIEW_LIMIT)} مورد دیگر`);
    lines.push('');
  }

  if (plan.actions.length) {
    lines.push('## عمل‌های آمادهٔ اجرا');
    lines.push('');
    lines.push('| نوع | دانشجو | درس | گروه |');
    lines.push('|---|---|---|---|');
    for (const a of plan.actions.slice(0, 80)) {
      lines.push(`| ${a.kind === 'INSERT_ENROLLMENT' ? 'افزودن' : 'نمره'} | ${a.studentCode} | ${a.courseCode} | ${a.groupNumber} |`);
    }
    if (plan.actions.length > 80) lines.push(`| … | | | ${fa(plan.actions.length - 80)} مورد دیگر |`);
    lines.push('');
  }

  return lines.join('\n');
}

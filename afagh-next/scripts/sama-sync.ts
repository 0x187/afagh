#!/usr/bin/env -S npx tsx
/**
 * ══════════════════════════════════════════════════════════════════════
 *  همگام‌سازی هفتگی سما → آفاق (خط فرمان)
 * ══════════════════════════════════════════════════════════════════════
 *
 *  جریان: روی سرورِ سما (یا ویندوزِ آموزش) فایل TSV بیرون کشیده می‌شود،
 *  روی سرور آفاق کپی می‌شود و این اسکریپت اجرا می‌شود. **پیش‌فرض: dry-run.**
 *
 *  ── استفاده ──
 *    npx tsx scripts/sama-sync.ts --uni 1 --term 14051 --enroll /tmp/enr.tsv
 *    npx tsx scripts/sama-sync.ts --uni 1 --term 14051 --enroll /tmp/enr.tsv \
 *        --students /tmp/stu.tsv --apply
 *
 *  ── گزینه‌ها ──
 *    --uni <id>        شناسهٔ دانشگاه در آفاق (پیش‌فرض ۱ = آفاق)
 *    --term <code>     کد ترم، مثل ۱۴۰۵۱ (اگر فایل ستون ترم نداشته باشد لازم است)
 *    --enroll <path>   فایل TSV انتخاب واحد  (الزامی)
 *    --students <path> فایل TSV دانشجویان (اختیاری — برای فهرست گم‌شده‌ها)
 *    --enc <name>      انکودینگ فایل: utf-8 (پیش‌فرض) یا cp1256
 *    --apply           اجرای واقعی (بدون این سوئیچ هیچ نوشتنی رخ نمی‌دهد)
 *    --json <path>     نوشتن پلن به‌صورت JSON
 *    --md <path>       نوشتن گزارش مارک‌داون
 *    --quiet           خلاصهٔ کوتاه
 *
 *  کد خروج: ۰ = موفق (حتی با اختلاف‌ها)، ۱ = خطای اجرا، ۲ = ورودی نامعتبر.
 * ══════════════════════════════════════════════════════════════════════
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnrollmentTsv, parseStudentTsv, decodeBuffer } from '../src/lib/sama-sync/parse';
import { buildPlan } from '../src/lib/sama-sync/plan';
import { toMarkdown, planSummary } from '../src/lib/sama-sync/report';
import { loadSnapshot } from '../src/lib/sama-sync/snapshot';
import { applyPlan } from '../src/lib/sama-sync/apply';

function argOf(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}
const has = (name: string) => process.argv.includes(`--${name}`);

const fa = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString('fa-IR');

async function main(): Promise<number> {
  const enrollPath = argOf('enroll');
  if (!enrollPath || enrollPath === 'true') {
    console.error('✗ --enroll <path> الزامی است (فایل TSV انتخاب واحد سما)');
    return 2;
  }
  const uni = Number(argOf('uni') ?? 1) || 1;
  const enc = (argOf('enc') ?? 'utf-8').toLowerCase();
  const quiet = has('quiet');
  const doApply = has('apply');

  const enrollText = decodeBuffer(readFileSync(enrollPath), enc);
  const parsed = parseEnrollmentTsv(enrollText, { termCode: argOf('term') ?? undefined });
  if (!parsed.rows.length) {
    console.error('✗ هیچ ردیف معتبری در فایل انتخاب واحد پیدا نشد');
    return 2;
  }
  const termCode = argOf('term') ?? parsed.termCode;
  if (!termCode) {
    console.error('✗ کد ترم نه در فایل بود و نه با --term داده شد');
    return 2;
  }

  const studentsPath = argOf('students');
  const studentsParsed = studentsPath && studentsPath !== 'true'
    ? parseStudentTsv(decodeBuffer(readFileSync(studentsPath), enc))
    : { rows: [], warnings: [] as string[] };

  const snapshot = await loadSnapshot({ universityId: uni, termCode });
  if (!snapshot) {
    console.error(`✗ ترم ${termCode} برای دانشگاه ${uni} در آفاق پیدا نشد`);
    return 2;
  }

  const plan = buildPlan(
    {
      termCode,
      enrollments: parsed.rows,
      students: studentsParsed.rows,
      warnings: [...parsed.warnings, ...studentsParsed.warnings],
    },
    snapshot,
  );

  if (!quiet) {
    console.log('─'.repeat(64));
    console.log(planSummary(plan));
    const s = plan.stats;
    console.log(`  ردیف سما        : ${fa(s.samaEnrollmentRows)}`);
    console.log(`  ثبت‌نام آفاق     : ${fa(s.afaghEnrollmentRows)}`);
    console.log(`  تطبیق           : ${fa(s.matched)}`);
    console.log(`  افزودن          : ${fa(s.addEnrollment)}`);
    console.log(`  پرکردن نمره     : ${fa(s.fillGrade)}`);
    console.log(`  اختلاف گروه     : ${fa(s.groupMismatch)}`);
    console.log(`  ارائه ناموجود   : ${fa(s.offeringMissing)}`);
    console.log(`  واحد اضافی      : ${fa(s.extraEnrollment)}`);
    console.log(`  دانشجوی گم‌شده   : ${fa(s.studentMissing)}`);
    console.log(`  کد مبهم         : ${fa(s.studentAmbiguous)}`);
    console.log(`  ارائه تکراری    : ${fa(s.duplicateOffering)}`);
    if (plan.warnings.length) {
      console.log('─ هشدارها ─');
      for (const w of plan.warnings) console.log(`  • ${w}`);
    }
    console.log('─'.repeat(64));
  }

  const jsonPath = argOf('json');
  if (jsonPath && jsonPath !== 'true') {
    writeFileSync(jsonPath, JSON.stringify({ plan, generatedAt: new Date().toISOString() }, null, 2));
    console.log(`✓ پلن در ${jsonPath} نوشته شد`);
  }
  const mdPath = argOf('md');
  if (mdPath && mdPath !== 'true') {
    writeFileSync(mdPath, toMarkdown(plan, { source: enrollPath }), 'utf-8');
    console.log(`✓ گزارش در ${mdPath} نوشته شد`);
  }

  if (!doApply) {
    console.log('ℹ dry-run — هیچ تغییری در پایگاه داده اعمال نشد (برای اجرا --apply بدهید)');
    return 0;
  }

  const result = await applyPlan(plan, { actorUserId: null });
  if (!result.ok) {
    console.error(`✗ اجرا شکست خورد و برگشت داده شد: ${result.error}`);
    return 1;
  }
  console.log(`✓ اجرا شد: ${fa(result.inserted)} ثبت‌نام افزوده، ${fa(result.gradesFilled)} نمره پر شد`);
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => { console.error(e); process.exitCode = 1; });

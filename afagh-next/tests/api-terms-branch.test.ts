/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیتِ قرارداد `?action=terms` — جلوی «صفحهٔ خالی ادغام دروس» را میگیرد
 *
 *  ریشهٔ باگ (۱۴۰۵/۰۸/۱۳): سه کلاینت (ادغام دروس، پوشش حقالتدریس،
 *  نقشهای تدریس) از `/api/admin/enrollment-approvals?action=terms` درخواست
 *  فهرست ترمها میکردند، ولی آن route اصلاً چنین شاخهای نداشت؛ درخواست به
 *  شاخهٔ «فهرست درخواستهای ثبتنام» میافتاد و `{rows,total,page,pageSize}`
 *  برمیگرداند. نتیجه: `d.terms` همیشه `[]`، هیچ `termId`ای انتخاب نمیشد،
 *  `offering-merge` هرگز صدا زده نمیشد و صفحه پیوسته «کلاسی یافت نشد»
 *  نشان میداد — در حالی که ترم جاری صدها کلاس ادغامی داشت.
 *
 *  این تست فقط متن سورس را میخواند (بدون سرور/بدون DB) و تضمین میکند
 *  قراردادِ جواب و قفل دانشگاهی دوباره حذف نشوند.
 * ════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const read = (p: string): string => readFileSync(path.join(ROOT, p), 'utf8');

const ROUTE = read('src/app/api/admin/enrollment-approvals/route.ts');
const CLIENTS = [
  'src/app/admin/course-merge/CourseMergeClient.tsx',
  'src/app/admin/payroll/coverage/CoverageClient.tsx',
  'src/app/admin/payroll/teaching-roles/TeachingRolesClient.tsx',
];

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};

ok(ROUTE.includes("searchParams.get('action') === 'terms'"), 'شاخهٔ terms در route وجود دارد');
ok(/NextResponse\.json\(\{\s*terms:\s*rows\s*\}\)/.test(ROUTE), 'پاسخ، کلید terms دارد');
ok(/universityEq\(academic_terms\.universityId/.test(ROUTE), 'فهرست ترمها fail-closed به دانشگاه محدود است');
ok(/coalesce\(\$\{academic_terms\.isCurrent\}/.test(ROUTE) || /desc\(academic_terms\.isCurrent\)/.test(ROUTE),
   'ترم جاری در ابتدای فهرست قرار میگیرد');

for (const c of CLIENTS) {
  ok(read(c).includes('action=terms'), `${path.basename(c)} همچنان همان قرارداد را میخواند`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

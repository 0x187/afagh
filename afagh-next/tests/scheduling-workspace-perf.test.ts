/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیتِ «کارتابل برنامهریزی دوباره دوباره از سرور کشیده نشود»
 *
 *  شواهدِ HAR زنده (۱۴۰۵/۰۸/۱۳، ۱۵۷ درخواست):
 *    [59] 10:17:52.619 POST /admin/scheduling?tab=DEPT_ROOMS  1,703,481B  wait=1004ms
 *    [67] 10:17:55.519 POST /admin/scheduling                 1,703,466B  wait= 761ms
 *    هر دو `next-action=60ad5006…` و بدنهٔ `[111]` یعنی **همان اکشن، همان
 *    ترم، ۲٫۹ ثانیه فاصله**. جابهجایی تب = mount مجدد = تکرار کامل ۱٫۷MB.
 *
 *  سه اصلاحی که این تست از برگشتنشان جلوگیری میکند:
 *    ① پرسوجوهای وابسته به ترم در actions.ts در **یک** Promise.all باشند
 *       (قبلاً ۳ مرحلهٔ پشتسرهم: inspect → چهار فهرست → خلاصهٔ جلسات).
 *    ② loadERهای inspectSchedulingHardConflicts هم موازی شوند (۳ RTT → ۱).
 *    ③ کلاینت کش ۲۰ ثانیهای + dedupe درخواست همزمان داشته باشد و بعد از
 *       هر ذخیره باطل شود (وگرنه دادهٔ کهنه نشان میدهد).
 *
 *  تست فقط متن فایلها را میخواند — بدون DB/بدون سرور/بدون مرورگر.
 * ════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = path.join(ROOT, 'src');
// پروندهها روی ویندوز CRLF دارند؛ نرمالسازی میکنیم تا برش/رگولار اکسپرشن
// وابسته به `\n` روی هر دو سیستم یکسان عمل کند.
const read = (...p: string[]) => readFileSync(path.join(SRC, ...p), 'utf8').replace(/\r\n/g, '\n');

const ACTIONS = read('app', 'admin', 'scheduling', 'actions.ts');
const PROVIDER = read('app', 'admin', 'scheduling', 'PlanningProvider.tsx');
const GENERATOR = read('lib', 'class-session-generator.ts');

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};

console.log('— مرحلهٔ واحد پرسوجوهای ترم (actions.ts) —');
const parallelBlock = ACTIONS.match(
  /const \[inspect, term, approved, makeup, allocated, grants, summary\] = await Promise\.all\(\[([\s\S]*?)\n\s*\]\);/,
);
ok(!!parallelBlock, 'همهٔ خروجیهای وابسته به ترم از یک Promise.all گرفته میشوند');
if (parallelBlock) {
  const b = parallelBlock[1];
  ok(/inspectSchedulingHardConflicts\(resolvedTermId\)/.test(b), 'inspect تداخلها در همان بلوک است');
  ok(/listApprovedOfferings\(resolvedTermId, uid\)/.test(b), 'ارائههای مصوب در همان بلوک است');
  ok(/listMakeupSessions\(resolvedTermId, uid\)/.test(b), 'جلسات جبرانی در همان بلوک است');
  ok(/listAllocatedRoomIds\(resolvedTermId, uid\)/.test(b), 'سهمیههای سالن در همان بلوک است');
  ok(/listRoomGrants\(resolvedTermId, uid\)/.test(b), 'واگذاری سالن در همان بلوک است');
  ok(/getTermSessionsSummary\(resolvedTermId\)/.test(b), 'خلاصهٔ جلسات در همان بلوک است');
}
ok(!/const summary = await getTermSessionsSummary\(/.test(ACTIONS),
  'خلاصهٔ جلسات دیگر بهصورت مرحلهٔ جداگانه/سریال اجرا نمیشود');
ok(!/\[approvedOfferings, makeupSessions, allocatedRoomIds, roomGrants\] = await Promise\.all\(/.test(ACTIONS),
  'مرحلهٔ دومِ تکراری چهار فهرست حذف شده است');

console.log('\n— موازیسازی بارگذارهای تداخل hard (class-session-generator.ts) —');
// فقط بدنهٔ inspectSchedulingHardConflicts گارد میشود؛ همان بارگذارها در
// generateClassSessionsForTerm روی `tx` تکـاتصالی اجرا میشوند و عمداً دست
// نخوردهاند (موازیسازی روی یک connection تراکنش بیهوده/پرخطر است).
// امضای تابع یک `}> {` چندخطی دارد؛ برش با ایندکس مطمئنتر از regex ناپایدار است.
const inspectStart = GENERATOR.indexOf('export async function inspectSchedulingHardConflicts');
const inspectEnd = inspectStart >= 0 ? GENERATOR.indexOf('\n}\n', inspectStart) : -1;
const inspectBody = inspectEnd > inspectStart ? GENERATOR.slice(inspectStart, inspectEnd + 3) : '';
ok(inspectBody.length > 200, 'بدنهٔ inspectSchedulingHardConflicts پیدا شد');
ok(/const \[schedRows, profByOffering, roomCap\] = await Promise\.all\(\[/.test(inspectBody),
  'سه پرسوجوی مستقل تداخلها با هم اجرا میشوند');
ok(!/const schedRows = await loadTermSchedules\(/.test(inspectBody),
  'بارگذاری schedules در این تابع دیگر سریال/تکی نیست');
ok(!/const roomCap = await loadRoomCapacities\(/.test(inspectBody),
  'بارگذاری ظرفیت سالنها در این تابع دیگر سریال/تکی نیست');

console.log('\n— کش کلاینت (PlanningProvider.tsx) —');
ok(/const WORKSPACE_TTL_MS = 20_000;/.test(PROVIDER), 'اعتبار کش ۲۰ ثانیه (کوتاه، بدون دادهٔ کهنهٔ ماندگار)');
ok(/const workspaceCache = new Map<number,/.test(PROVIDER), 'کش به ازای نیمسال نگه داشته میشود');
ok(/const workspacePending = new Map<number, Promise<SchedulingWorkspaceResult>>/.test(PROVIDER),
  'درخواستهای همزمان یک ترم dedupe میشوند');
ok(/function loadWorkspace\(termId: number, force = false\)/.test(PROVIDER),
  'تابع واحد بارگذاری وجود دارد');
ok(/if \(res\.ok\) workspaceCache\.set\(termId, \{ at: Date\.now\(\), value: res \}\)/.test(PROVIDER),
  'فقط پاسخ موفق کش میشود (ok:false هرگز کش نشود)');
ok(!/^\s*getSchedulingWorkspaceAction\(selectedTermId\)/m.test(PROVIDER),
  'هیچ فراخوانی مستقیمی از اکشن بیرون از loadWorkspace نمانده است');
ok((PROVIDER.match(/loadWorkspace\(selectedTermId\)/g) ?? []).length === 2,
  'دو مسیر mount (تغییر ترم + هایدریشن partial) از کش میگذرند');
ok(/loadWorkspace\(selectedTermId, true\)/.test(PROVIDER),
  'reloadWorkspace بعد از ذخیره حتماً دادهٔ تازه میگیرد (force)');
ok(/const reloadWorkspace = \(\) => \{[\s\S]{0,200}loadWorkspace\(selectedTermId, true\)/.test(PROVIDER),
  'force دقیقاً داخل reloadWorkspace است');
ok(/const reloadRoomGrants = \(\) => \{[\s\S]{0,200}invalidateWorkspaceCache\(\)/.test(PROVIDER),
  'تغییر سهمیهٔ سالن کش را باطل میکند');
ok((PROVIDER.match(/invalidateWorkspaceCache\(\)/g) ?? []).length >= 2,
  'ابطال کش هم در مسیر force و هم بعد از تغییر سهمیهٔ سالن صدا زده میشود');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} قبول / ${fail} رد`);
if (fail > 0) process.exit(1);

/**
 * گاردهای «سهمیهٔ سالن» و سلامتِ کدِ فارسی.
 *
 * سه دسته باگ که همه در یک روز واقعاً رخ دادند و هیچ تستی نگرفتشان:
 *
 * ۱) نشتی بین‌دانشگاهی: `copyRoomQuotasFromPreviousTermAction` بدون فیلترِ
 *    دانشگاه، سهمیهٔ سالن‌های همهٔ دانشگاه‌ها را به ترم جاری کپی می‌کرد.
 *    `upsertRoomGrantAction` هم هر classroomId را بدون بررسی دامنه می‌پذیرفت.
 *    چون `universityEq` در حالت شناسهٔ نامعتبر `1 = 0` می‌دهد (fail-closed)،
 *    نبودِ این شرط یعنی «همه‌چیز مجاز» — نه «هیچ‌چیز».
 *
 * ۲) پیام خطای بلعیده‌شده: در حلقهٔ «لغو همهٔ سهمیه‌ها»، پیام خطا داخل حلقه
 *    ست می‌شد و بلافاصله بعد از حلقه با پیام موفقیت بازنویسی می‌شد؛ کاربر
 *    فکر می‌کرد همه‌چیز درست بوده. دقیقاً همان الگویی که «لغو همه» در
 *    پذیرش را خراب کرده بود.
 *
 * ۳) متن فارسیِ به‌هم‌ریخته (mojibake): کامنت‌های `schema.ts` با کدگذاری غلط
 *    کامیت شده بودند (`OOU+ UcU,O3 …`). چشم انسان این را می‌بیند، تایپ‌چک
 *    و بیلد نه — پس باید تست بگیرد.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SRC = path.join(HERE, '..', 'src');

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, hint = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${hint ? ` — ${hint}` : ''}`); }
}
const read = (rel: string) => readFileSync(path.join(HERE, '..', rel), 'utf8');

// ── ۱) دامنهٔ دانشگاه در اکشن‌های سهمیهٔ سالن ─────────────────────────────
const ACTIONS = read('src/app/admin/scheduling/actions.ts');

/** بدنهٔ یک تابع async را از روی نامش جدا می‌کند (تا سراغ تابع بعدی نرود). */
function fnBody(src: string, name: string): string {
  const at = src.indexOf(`export async function ${name}`);
  if (at < 0) return '';
  const next = src.indexOf('\nexport ', at + 10);
  return src.slice(at, next < 0 ? src.length : next);
}

const copyBody = fnBody(ACTIONS, 'copyRoomQuotasFromPreviousTermAction');
ok('copyRoomQuotas: تابع وجود دارد', copyBody.length > 0);
ok(
  'copyRoomQuotas: به سالن‌ها join می‌کند تا دامنه قابل بررسی باشد',
  /innerJoin\(classrooms, eq\(classrooms\.id, scheduling_room_grants\.classroomId\)\)/.test(copyBody),
);
ok(
  'copyRoomQuotas: فیلتر دانشگاه روی سالن اعمال می‌شود',
  /universityEq\(classrooms\.universityId, uid\)/.test(copyBody),
);
ok(
  'copyRoomQuotas: ردیف تازه universityId می‌گیرد',
  /universityId:\s*uid\s*\?\?\s*null/.test(copyBody),
);
ok(
  'copyRoomQuotas: «ترم قبل» بر پایهٔ مقایسهٔ شناسه است، نه ایندکس آرایه',
  /terms\.find\(t => t\.id < termId\)/.test(copyBody) && !/findIndex\(t => t\.id === termId\)/.test(copyBody),
);
ok(
  'copyRoomQuotas: نوع بازگشتی صریح دارد (narrowing کلاینت)',
  /Promise<\{ ok: true; copied: number \} \| \{ ok: false; error: string \}>/.test(copyBody),
);

const upsertBody = fnBody(ACTIONS, 'upsertRoomGrantAction');
ok('upsertRoomGrant: تابع وجود دارد', upsertBody.length > 0);
ok(
  'upsertRoomGrant: مالکیت سالن بررسی می‌شود',
  /universityEq\(classrooms\.universityId, uid\)/.test(upsertBody),
);
ok(
  'upsertRoomGrant: سالنِ خارج از دامنه رد می‌شود',
  /در دامنهٔ دانشگاه شما نیست/.test(upsertBody),
);
ok(
  'upsertRoomGrant: دیگر import پویا ندارد (db/schema در بالای فایل هست)',
  !/await import\('@\/db'\)/.test(upsertBody),
);
ok(
  'upsertRoomGrant: نوع بازگشتی صریح دارد',
  /Promise<\{ ok: true \} \| \{ ok: false; error: string \}>/.test(upsertBody),
);

const allocBody = fnBody(ACTIONS, 'allocateRoomQuotasAction');
ok(
  'allocateRoomQuotasAction: نوع بازگشتی discriminated است',
  /Promise<\{ ok: true; grants: number \} \| \{ ok: false; error: string \}>/.test(allocBody),
);

// موتور هم باید literal برگرداند، وگرنه اتحادِ `ok` به boolean گشاد می‌شود
// و `res.grants` در کلاینت خطای تایپ می‌دهد (که با NEXT_SKIP_TYPE_CHECK پنهان می‌ماند).
const ENGINE = read('src/lib/scheduling-engine.ts');
ok(
  'engine: allocateRoomQuotas نوع literal دارد',
  /allocateRoomQuotas\([^)]*\): Promise<\{ ok: true; grants: number \}>/.test(ENGINE),
);
ok(
  'engine: releaseRoomShift نوع literal دارد',
  /releaseRoomShift\([^)]*\): Promise<\{ ok: true \}>/s.test(ENGINE),
);
ok(
  'engine: borrowReleasedShift نوع literal دارد',
  /borrowReleasedShift\([^)]*\): Promise<\{ ok: true \}>/s.test(ENGINE),
);

// ── ۲) پیام خطا نباید با پیام موفقیت بازنویسی شود ─────────────────────────
const DEPT = read('src/app/admin/scheduling/components/DeptRoomsTab.tsx');
ok(
  'لغو همه: خطای اولین ردیفِ ناموفق نگه داشته می‌شود',
  /let firstErr: string \| null = null/.test(DEPT) && /firstErr = res\?\.error/.test(DEPT),
);
ok(
  'لغو همه: پیام نهایی هر دو حالت را پوشش می‌دهد',
  /setMsg\(firstErr\s*\?/.test(DEPT),
);
ok(
  'لغو همه: setMsg بی‌قید بعد از حلقه نمانده باشد',
  !/setMsg\(`✅ \$\{faNum\(okCount\)\} سهمیه لغو شد\.`\);/.test(DEPT),
);

// شناسهٔ ردیف نباید جای «کد گروه» جا بزند. ۴ گروه «دروس عمومی و مشترک»
// دانشگاه‌های ۲..۵ کد رسمی ندارند؛ قبلاً `(#103)` نشان داده می‌شد و کاربر
// فکر می‌کرد کد رسمی است.
ok(
  'کد گروه: fallback به شناسهٔ ردیف حذف شده',
  !/departmentCode \?\? d\.id/.test(DEPT) && !/departmentCode \?\? id/.test(DEPT),
);
ok(
  'کد گروه: وقتی کد نیست فقط نام نمایش داده می‌شود',
  /d\.departmentCode \? `\$\{d\.name\} \(\$\{d\.departmentCode\}\)` : d\.name/.test(DEPT),
);
ok(
  'کد گروه: هر دو منوی انتخاب از همان برچسب مشترک استفاده می‌کنند',
  (DEPT.match(/\{deptLabel\(d\)\}/g) ?? []).length >= 2,
);

// ── ۳) کد رشته در کارت فاز ۰ نباید خالی رندر شود ──────────────────────────
const SCOPE = read('src/app/admin/scheduling/components/ProgramScopeTab.tsx');
ok(
  'فاز ۰: کد رشته به‌صورت شرطی رندر می‌شود (پرانتز خالی نمی‌ماند)',
  /p\.code \?/.test(SCOPE) && !/<span className="text-slate-500 font-mono text-xs">\(\{p\.code\}\)<\/span>/.test(SCOPE),
);
const CORE = read('src/app/admin/scheduling/planning-core.ts');
ok(
  'فاز ۰: ماتریس رشته واقعاً code را برمی‌گرداند',
  /return \{ id: p\.id, title: p\.title, code: p\.code \?\? ''/.test(CORE),
);

// ── ۴) هیچ فایل منبعی متن فارسیِ به‌هم‌ریخته نداشته باشد ────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|sql)$/.test(name)) out.push(p);
  }
  return out;
}
// امضای mojibake فارسی: بایت‌های UTF-8 که با کدگذاری غلط خوانده شده‌اند.
const MOJIBAKE = /O�|UcU,|OOU\+|U\.O[^a-zA-Z]|O1O[UO]|U�O/;
const dirty: string[] = [];
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  if (MOJIBAKE.test(text)) dirty.push(path.relative(path.join(HERE, '..'), file));
}
ok(
  'هیچ فایل src متن فارسیِ به‌هم‌ریخته ندارد',
  dirty.length === 0,
  dirty.length ? `آلوده: ${dirty.slice(0, 5).join(', ')}` : '',
);

console.log(`\n${fail === 0 ? '✅' : '❌'} scheduling-room-grants-scope: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

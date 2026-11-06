import { cache } from 'react';
import { cookies } from 'next/headers';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { expert_scopes, staff, students, universities } from '@/db/schema';
import { getSessionUser } from '@/lib/auth';
import { UNI_THEMES, uniTheme, uniDot } from './university-theme';
export { UNI_THEMES, uniTheme, uniDot };
export type { UniTheme } from './university-theme';

/** نام کوکی دانشگاه فعال — همهٔ صفحه‌های ادمین همین را می‌خوانند */
export const UNIVERSITY_COOKIE = 'afagh_uni';

export type UniScope = { id: number; code: string; title: string; kind: string; logoUrl: string | null };

/**
 * دانشگاهی که هیچ رکوردی به آن تعلق ندارد.
 *
 * fail-closed: وقتی کاربر به هیچ دانشگاهی وابسته نیست، به‌جای برگشتِ دانشگاه
 * اول (که دادهٔ دانشگاه دیگری را لو می‌داد) شناسهٔ صفر برمی‌گردد؛ چون همهٔ
 * کوئری‌ها `WHERE universityId = 0` می‌شوند و هیچ ردیفی برنمی‌گردد.
 */
const DENY_UNI: UniScope = { id: 0, code: '', title: '—', kind: 'NONE', logoUrl: null };

/** پیش‌فرض وقتی جدول دانشگاه‌ها هنوز ساخته نشده (نصب تازه / خطای DB) */
const FALLBACK_UNI: UniScope = { id: 1, code: 'AFAGH', title: 'دانشگاه آفاق', kind: 'OWN', logoUrl: null };

/**
 * فهرستِ همهٔ دانشگاه‌ها — با کشِ درون‌درخواستی.
 *
 * ⚠ چرا cache(): این تابع هم از `getCurrentUniversity()` صدا زده می‌شود و هم از
 * `listUniversities()`، و آن دو در یک `Promise.all` داخلِ layout کنارِ هم
 * می‌نشینند. به‌علاوه خودِ `getCurrentUniversity()` هم یک بار در layout و یک بار
 * در صفحه فراخوانی می‌شود. یعنی همین یک کوئریِ ساده **سه بار در هر درخواست**
 * اجرا می‌شد. `authorizedUniversityIds` از قبل cache داشت؛ این یکی جا افتاده بود.
 *
 * `cache()` فقط در محدودهٔ همان رندر زنده است (نه بین درخواست‌ها)، پس دادهٔ
 * دانشگاه هیچ‌وقت کهنه نمی‌شود.
 */
const allUniversities = cache(async (): Promise<UniScope[]> => {
  try {
    return (await db.select({
      id: universities.id, code: universities.code,
      title: universities.title, kind: universities.kind,
      logoUrl: universities.logoUrl,
    }).from(universities).orderBy(universities.id)) as UniScope[];
  } catch {
    return [];
  }
});

/**
 * فهرست دانشگاه‌های مجاز کاربر — تنها مرز امنیتیِ چندمؤسسه‌ای.
 *
 * ⚠️ پیش از این، «دانشگاه فعال» فقط از کوکی `afagh_uni` خوانده می‌شد؛ یعنی هر
 * کاربر می‌توانست کوکی را دستکاری کند و به دادهٔ هر دانشگاه دیگری (کارنامه،
 * عکس، بایگانی، انتخاب واحد، نمره) برسد. حالا کوکی فقط «انتخاب» است، نه «مجوز».
 *
 * منبع مجوز (به‌ترتیب):
 *   ۱) `users.universityId` خودِ کاربر (دانشگاه خانگی)
 *   ۲) `expert_scopes` با `scopeType='UNIVERSITY'` (دامنهٔ کارشناس — چند دانشگاهی)
 *   ۳) ردیف `students`/`staff` کاربر اگر `users.universityId` خالی باشد
 *   ۴) `ADMIN` با `universityId = NULL` → حساب پلتفرمی: همهٔ دانشگاه‌ها مجاز
 *
 * خروجی `null` یعنی «نامحدود» (فقط حساب پلتفرمی) و `[]` یعنی deny-all (بدون نشست یا خطا).
 */
export const authorizedUniversityIds = cache(async (): Promise<number[] | null> => {
  const me = await getSessionUser().catch(() => null);
  if (!me) return [];

  const ids = new Set<number>();
  if (typeof me.universityId === 'number') ids.add(me.universityId);

  // ⚠ مدیرِ پلتفرمی باید پیش از fallbackهای زیر شناسایی شود.
  // `users.universityId` خالی یعنی «به هیچ دانشگاهی وابسته نیست» و طبق سیاست
  // بالا همهٔ دانشگاه‌ها برایش مجاز است. اگر این شرط بعد از fallbackهای
  // students/staff می‌آمد، یک ردیف کارمندی قدیمی او را به یک دانشگاه قفل
  // می‌کرد؛ آن‌وقت listUniversities() تک‌عضوی می‌شد و UniversitySwitcher
  // (که حداقل ۲ دانشگاه می‌خواهد) در سربرگ ناپدید می‌ماند.
  if (!ids.size && me.roles.includes('ADMIN')) return null;

  if (me.roles.includes('EDU_EXPERT')) {
    const rows = await db
      .select({ scopeType: expert_scopes.scopeType, scopeId: expert_scopes.scopeId, universityId: expert_scopes.universityId })
      .from(expert_scopes)
      .where(eq(expert_scopes.userId, me.id))
      .catch(() => [] as { scopeType: string; scopeId: number | null; universityId: number | null }[]);
    for (const r of rows) {
      const id = r.scopeType === 'UNIVERSITY' ? (r.scopeId ?? r.universityId) : r.universityId;
      if (typeof id === 'number') ids.add(id);
    }
  }

  // کاربری که فقط از راه رکورد دانشجو/کارمند به دانشگاه وصل است
  if (!ids.size) {
    const [st] = await db.select({ universityId: students.universityId })
      .from(students).where(eq(students.userId, me.id)).limit(1).catch(() => []);
    if (typeof st?.universityId === 'number') ids.add(st.universityId);
    const [sf] = await db.select({ universityId: staff.universityId })
      .from(staff).where(eq(staff.userId, me.id)).limit(1).catch(() => []);
    if (typeof sf?.universityId === 'number') ids.add(sf.universityId);
  }

  if (!ids.size) {
    // مدیرِ پلتفرمی (بدون دانشگاه خانگی) تنها چندحالته‌ای است که همه را می‌بیند
    return me.roles.includes('ADMIN') ? null : [];
  }
  return [...ids];
});

/**
 * دانشگاه فعال کاربر — امن: کوکی فقط درون «دانشگاه‌های مجاز» پذیرفته می‌شود.
 * کوکی دستکاری‌شده یا خارج از دامنه بی‌سروصدا به دانشگاه خانگی برمی‌گردد
 * (fail-safe) و اگر هیچ دانشگاهی مجاز نباشد، DENY_UNI برمی‌گردد (fail-closed).
 */
export async function getCurrentUniversity(): Promise<UniScope> {
  try {
    const all = await allUniversities();
    const allowed = await authorizedUniversityIds().catch((): number[] | null => []);
    if (!all.length) return allowed === null ? FALLBACK_UNI : DENY_UNI;

    const pool = allowed === null ? all : all.filter(u => allowed.includes(u.id));
    if (!pool.length) return DENY_UNI;

    const want = (await cookies()).get(UNIVERSITY_COOKIE)?.value?.trim();
    return (want ? pool.find(u => u.code === want) : undefined) ?? pool[0];
  } catch {
    // fail-closed: هر خطای غیرمنتظره → دانشگاه انکار (نه null/undefined که fail-open می‌شد)
    return DENY_UNI;
  }
}

/** همهٔ دانشگاه‌ها برای سوییچر سربرگ — فقط آنچه کاربر واقعاً مجاز است */
export async function listUniversities(): Promise<UniScope[]> {
  const all = await allUniversities();
  const allowed = await authorizedUniversityIds().catch((): number[] | null => []);
  if (!all.length) return allowed === null ? [FALLBACK_UNI] : [];
  return allowed === null ? all : all.filter(u => allowed.includes(u.id));
}

/**
 * آیا کاربر اجازهٔ کار با این دانشگاه را دارد؟ — برای مسیرهایی که دانشگاه را
 * از پارامتر می‌گیرند (مثلاً `?uni=2`) به‌جای اتکا به کوکی.
 *
 * `null` به‌معنای «نامحدود» است و باید صریحاً مدیریت شود.
 */
export async function canActOnUniversity(universityId: number | null | undefined): Promise<boolean> {
  if (universityId == null) return false;      // رکورد بدون دانشگاه: مجهول → رد
  const allowed = await authorizedUniversityIds().catch((): number[] | null => []);
  if (allowed === null) return true;           // حساب پلتفرمی
  return allowed.includes(Number(universityId));
}

/**
 * شرط SQL برای قفل‌کردن کوئری‌ها به دانشگاه جاری.
 * وقتی کاربر به هیچ دانشگاهی مجاز نیست، شرطی می‌سازد که **هیچ** ردیفی برنمی‌گرداند
 * (`1=0`) — نه حذفِ شرط، چون حذف شرط یعنی «همهٔ دانشگاه‌ها» (fail-open).
 */
export async function currentUniversitySqlCondition(column: any): Promise<any> {
  const allowed = await authorizedUniversityIds().catch((): number[] | null => []);
  if (allowed === null) return undefined;                    // نامحدود: بدون قید
  if (!allowed.length) return sql`1 = 0`;                    // deny-all (fail-closed)
  return inArray(column, allowed);
}

/**
 * 🔒 آیا این شناسه یک دانشگاهِ *واقعی* است؟
 *
 * دو حالتِ خطرناک که هر دو falsy‌اند و نباید به «حذف فیلتر» ترجمه شوند:
 *   • `0` = DENY_UNI → کاربر به هیچ دانشگاهی مجاز نیست
 *   • `null` / `undefined` = دانشگاه نامشخص (خطای DB یا نبود زمینه)
 *
 * الگوی قدیمی `universityId ? eq(col, universityId) : undefined` برای این دو
 * حالت شرط را **حذف** می‌کرد؛ یعنی نه‌فقط دسترسی باز می‌شد، بلکه دادهٔ *همهٔ*
 * دانشگاه‌ها برمی‌گشت (fail-open). این تابع آن در را می‌بندد.
 */
export function isRealUniversityId(id: number | null | undefined): id is number {
  return typeof id === 'number' && Number.isFinite(id) && id > 0;
}

/**
 * شرط «همین دانشگاه» برای کوئری‌های مبتنی بر شناسهٔ عددی — همیشه بسته:
 *   • شناسهٔ واقعی            → `column = id`
 *   • `0` / `null` / نامشخص   → `1 = 0` (هیچ ردیفی؛ نه حذف شرط)
 */
export function universityEq(column: any, universityId: number | null | undefined): any {
  return isRealUniversityId(universityId) ? eq(column, universityId) : sql`1 = 0`;
}

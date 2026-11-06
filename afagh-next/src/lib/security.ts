import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createLogger } from '@/lib/logger';

/**
 * ══════════════════════════════════════════════════════════════
 *  دفاع CSRF برای Route Handlerها (نه Server Actions)
 *
 *  Server Actions در Next.js محافظ داخلی دارند؛ اما Route Handlerهای
 *  POST/PUT/DELETE که با کوکی نشست کار می‌کنند تا قبل از این هیچ
 *  محافظ مبدأ نداشتند — با کوکی SameSite=None (HTTPS) یک حملهٔ
 *  CSRF قابل اجرا بود (C-2).
 *
 *  قواعد (مطابق الگوی رایج Django/OWASP):
 *   ۱) اگر هدر Origin موجود باشد → باید با Host درخواست هم‌مبدأ باشد
 *      (یا در لیست سفید ALLOWED_EXTRA_ORIGINS قرار گیرد).
 *   ۲) اگر Origin نبود ولی Referer بود → Referer باید هم‌مبدأ باشد.
 *   ۳) نه Origin نه Referer → کلاینت غیرمرورگری (curl/cron/server)؛
 *      CSRF واقعی نمی‌تواند بدون Origin/Referer در مرورگر رخ دهد → مجاز.
 *
 *  فقط host مقایسه می‌شود (نه scheme) تا پشت پروکسی Caddy کار کند.
 * ══════════════════════════════════════════════════════════════
 */

const log = createLogger({ mod: 'security' });

const EXTRA_ORIGINS = (process.env.ALLOWED_EXTRA_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * host یک URL یا خودِ host را برمی‌گرداند — **همیشه با حروف کوچک**.
 *
 * چرا lowercase اجباری است: `new URL('https://B.afagh.ac.ir').host` نتیجه را
 * کوچک می‌کند (`b.afagh.ac.ir`) ولی هدر خامِ `Host` همان‌طور که فرستنده نوشته
 * می‌آید. مقایسهٔ حساس به حروف یعنی اگر پروکسی/CDN هدر را با حرف بزرگ فوروارد
 * کند، همهٔ POSTهای same-origin با «CSRF blocked» رد می‌شوند — از جمله دکمهٔ
 * خروج. نام میزبان طبق RFC 3986 حساس به حروف نیست، پس هر دو طرف کوچک می‌شوند.
 */
function hostOf(urlOrHost: string): string {
  try {
    return new URL(urlOrHost).host.toLowerCase();
  } catch {
    return urlOrHost.toLowerCase();
  }
}

/**
 * گیت CSRF برای Route Handler — یک خط، بدون امکان فراموشی.
 *
 * چرا این کمکی لازم شد: `assertSameOrigin(req)` نتیجه‌اش را برمی‌گرداند و
 * چند مسیر آن را **دور می‌ریختند** (مثلاً `assertSameOrigin(req);` تنها).
 * چون کوکی نشست روی HTTPS با `SameSite=None` ست می‌شود، مرورگر همراهِ
 * درخواست cross-site را هم می‌فرستد ⇒ یک صفحهٔ مهاجم می‌توانست با POST
 * سایه‌ای، برنامهٔ درسی/آستانهٔ نمره/حقوق را تغییر دهد.
 *
 * الگوی درست و اجباری:
 * ```ts
 * const csrf = assertCsrf(req);
 * if (csrf) return csrf;
 * ```
 * این تابع فقط `return csrf` را داخل خود دارد، پس دیگر نمی‌شود
 * نتیجه را نادیده گرفت.
 */
export function assertCsrf(req: NextRequest): NextResponse | null {
  return assertSameOrigin(req);
}

/** اگر پاسخ برگرداند → باید فوراً همان پاسخ برگردانده شود؛ وگرنه null یعنی مجاز. */
export function assertSameOrigin(req: NextRequest): NextResponse | null {
  const host = (req.headers.get('host') ?? hostOf(req.url)).toLowerCase();

  const origin = req.headers.get('origin');
  if (origin) {
    const originHost = hostOf(origin);
    const ok = originHost === host || EXTRA_ORIGINS.includes(origin);
    if (!ok) {
      return NextResponse.json(
        { error: 'منشأ درخواست با سامانه هم‌خوان نیست (CSRF blocked).' },
        { status: 403 },
      );
    }
    return null;
  }

  const referer = req.headers.get('referer');
  if (referer) {
    const refHost = hostOf(referer);
    if (refHost !== host && !EXTRA_ORIGINS.some((o) => hostOf(o) === refHost)) {
      return NextResponse.json(
        { error: 'منشأ درخواست با سامانه هم‌خوان نیست (CSRF blocked).' },
        { status: 403 },
      );
    }
    return null;
  }

  // Observability-only: non-browser clients legitimately send no Origin/Referer
  // and stay allowed — but an authenticated mutating request without either
  // header is worth logging (possible misconfiguration or anomaly).
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
    const hasAuth = req.headers.has('authorization') || req.headers.has('cookie');
    if (hasAuth) {
      log.warn('csrf_no_origin_mutating', { path: req.nextUrl.pathname, method: req.method });
    }
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════
//  ب) دفاع CSRF در Server Actions (بازبینی — بند ۱۰)
//
//  Next.js Server Actions به‌طور داخلی Origin را بررسی می‌کند، اما این گارد
//  صریح برای عملیات حساس (تغییر رمز، مالی، تأیید درخواست، چک/وام/تخفیف)
//  لایهٔ دوم می‌سازد — مطابق اصل «به SameSite اکتفا نکن».
//  درخواست‌های غیرمرورگری (بدون Origin: cron، تست‌ها) مجازند.
// ════════════════════════════════════════════════════════════════════════

export async function assertServerActionOrigin(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const h = await headers();
    const host = (h.get('host') ?? '').toLowerCase();
    const origin = h.get('origin') ?? '';
    if (!origin) {
      // Observability-only: non-browser callers (curl/cron/test) stay allowed.
      const referer = h.get('referer') ?? '';
      if (!referer && (h.has('authorization') || h.has('cookie'))) {
        log.warn('csrf_no_origin_server_action', { path: h.get('next-url') ?? h.get('referer') ?? 'unknown', method: 'ServerAction' });
      }
      return { ok: true }; // curl/cron/test — CSRF مرورگری بدون Origin رخ نمی‌دهد
    }
    const originHost = hostOf(origin);
    if (originHost === host || EXTRA_ORIGINS.includes(origin) || EXTRA_ORIGINS.some((o) => hostOf(o) === originHost)) {
      return { ok: true };
    }
    return { ok: false, error: 'منشأ درخواست با سامانه هم‌خوان نیست (CSRF blocked).' };
  } catch (err) {
    // 🔒 fail-closed (بازبینی ۴ — High): اگر خودِ «بررسی منشأ» خطای غیرمنتظره بدهد،
    // نباید اجازه صادر کند؛ رد شدن اشتباه، ارزان‌تر از پذیرش یک CSRF است.
    log.error('csrf_origin_check_failed', { error: String((err as { message?: string })?.message ?? err) });
    return { ok: false, error: 'خطا در بررسی امنیتی درخواست؛ دوباره تلاش کنید.' };
  }
}

// ════════════════════════════════════════════════════════════════════════
//  ج) مجوز سطح-شیء (Object-Level Authorization — بازبینی بند ۳)
//
//  «Role Authorization» (ادمین/مالی) کافی نیست؛ باید مشخص باشد کارشناس مالی
//  روی *کدام* دانشجو مجاز است. سیاست پیش‌فرض: حوزهٔ گروه (department) —
//  fail-closed در production. با AFAGH_OBJECT_SCOPE=all می‌توان صراحتاً به
//  رفتار قدیمی «همهٔ دانشجویان» برگشت (opt-out)؛ مقدار faculty نیز پشتیبانی می‌شود.
// ════════════════════════════════════════════════════════════════════════

/**
 * 🔒 گیت مرز دانشگاه برای هر رکورد دانشجو.
 *
 * نقش («ادمین/کارشناس») برای دیدن دادهٔ یک دانشجو کافی نیست؛ باید معلوم شود
 * آن دانشجو **در دانشگاهِ مجازِ کاربر** است. پیش از این، `getTranscript` و
 * چند مسیر دیگر فقط `requireRole` داشتند و با یک `studentId` دلخواه، کارنامهٔ
 * هر دانشگاهی خوانده می‌شد.
 *
 * `null`/بدون دانشگاه در رکورد دانشجو یعنی «نامشخص» → رد (fail-closed)، نه
 * «همهٔ دانشگاه‌ها».
 */
export async function requireStudentUniversity(studentId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { db } = await import('@/db');
    const { students } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const { canActOnUniversity } = await import('@/lib/university-scope');

    const [stu] = await db
      .select({ universityId: students.universityId })
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);
    if (!stu) return { ok: false, error: 'پروندهٔ دانشجو یافت نشد.' };
    if (stu.universityId == null) {
      return { ok: false, error: 'دانشگاه این دانشجو مشخص نیست — دسترسی رد شد (fail-closed).' };
    }
    if (!(await canActOnUniversity(stu.universityId))) {
      return { ok: false, error: 'این دانشجو در دانشگاه شما نیست — دسترسی رد شد.' };
    }
    return { ok: true };
  } catch (err) {
    log.error('scope_require_student_university_failed', { error: String((err as { message?: string })?.message ?? err) });
    return { ok: false, error: 'خطا در بررسی محدودهٔ دانشگاه؛ دسترسی رد شد.' };
  }
}

export async function requireStudentScope(studentId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  // 🔒 مرز دانشگاه **همیشه** و پیش از هر چیز دیگر — حتی برای ADMIN و حتی وقتی
  //   opt-out سطح‌شیء (`AFAGH_OBJECT_SCOPE=all`) روشن است. آن opt-out فقط
  //   دربارهٔ «گروه/دانشکده» است، نه دربارهٔ مرز بین دانشگاه‌ها.
  const uniGate = await requireStudentUniversity(studentId);
  if (!uniGate.ok) return uniGate;

  const mode = (process.env.AFAGH_OBJECT_SCOPE || 'department').toLowerCase();
  if (mode !== 'department' && mode !== 'faculty') return { ok: true };

  try {
    const { getSessionUser } = await import('@/lib/auth');
    const { db } = await import('@/db');
    const { staff, students, majors } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    const me = await getSessionUser();
    if (!me) return { ok: false, error: 'unauthorized' };

    // 🔴 استثناء صریح (نه fail-open): مدیر سامانه در سطح کلان است و مشمول حوزهٔ
    // سازمانی نمی‌شود — بقیهٔ نقش‌ها کاملاً مشمول fail-closed می‌شوند.
    if (me.roles.includes('ADMIN')) return { ok: true };

    const [s] = await db
      .select({ id: staff.id, departmentId: staff.departmentId, facultyId: staff.facultyId })
      .from(staff)
      .where(eq(staff.userId, me.id))
      .limit(1);
    const [stu] = await db
      .select({ departmentId: majors.departmentId, facultyId: majors.facultyId })
      .from(students)
      .leftJoin(majors, eq(majors.id, students.majorId))
      .where(eq(students.id, studentId))
      .limit(1);

    // 🔒 FAIL-CLOSED (بازبینی — High): دادهٔ ناقص یا نبود پرونده → DENY.
    //   «بدون دادهٔ کافی → اجازه» قبلاً مسیر fail-open بود — لغو شد.
    if (!s) {
      return { ok: false, error: 'پروندهٔ سازمانی شما (staff) یافت نشد — دسترسی رد شد (fail-closed).' };
    }
    if (!stu) {
      return { ok: false, error: 'پروندهٔ دانشجو یافت نشد — دسترسی رد شد (fail-closed).' };
    }

    if (mode === 'department') {
      if (s.departmentId == null || stu.departmentId == null) {
        return { ok: false, error: 'نبودِ گروه سازمانی برای مقایسه — دسترسی رد شد (fail-closed).' };
      }
      if (stu.departmentId !== s.departmentId) {
        return { ok: false, error: 'دسترسی به پروندهٔ این دانشجو در حوزهٔ سازمانی شما نیست (Object-Level Authorization).' };
      }
    } else {
      if (s.facultyId == null || stu.facultyId == null) {
        return { ok: false, error: 'نبودِ دانشکدهٔ سازمانی برای مقایسه — دسترسی رد شد (fail-closed).' };
      }
      if (stu.facultyId !== s.facultyId) {
        return { ok: false, error: 'دسترسی به پروندهٔ این دانشجو در حوزهٔ سازمانی شما نیست (Object-Level Authorization).' };
      }
    }
    return { ok: true };
  } catch (err: any) {
    // 🔒 هر خطای غیرمنتظره → DENY + لاگ (هرگز fail-open)
    log.error('scope_check_failed_fail_closed', { error: String(err?.message ?? err) });
    return { ok: false, error: 'خطا در بررسی سطح دسترسی؛ دوباره تلاش کنید.' };
  }
}

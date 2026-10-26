// ═══ «بعد از ورود، کدام کارتابل؟» — پورت خط‌به‌خط home-route.ts ═══
//
// قاعدهٔ اولویت (به‌درخواست آموزش):
//   ۱) کارشناس/مدیریت — کاربر چندنقشی باید کارتابل کارشناسی را ببیند
//   ۲) استاد و مدیر گروه و مراقب
//   ۳) دانشجو
export function homeFor(roles: string[]): string {
  // نقشی ندارد → برگرد به ورود با پیام روشن (جلوگیری از حلقهٔ بی‌پایان ورود)
  if (roles.length === 0) return '/login?e=norole';
  const has = (r: string) => roles.includes(r);

  // ── ۱) کارتابل کارشناسی و مدیریت ──
  if (has('ADMIN') || has('EDU_EXPERT') || has('VICE_EDU')) return '/admin';
  if (has('FINANCE_EXPERT') || has('FINANCE')) return '/admin/payroll';
  if (has('VAULT_MANAGER')) return '/admin/exams';
  if (has('MILITARY_OFFICER')) return '/admin/students';
  if (has('ARCHIVE_EXPERT')) return '/admin/archive';
  if (has('GRADUATION_EXPERT')) return '/admin/defense-scheduling';

  // ── ۲) استاد، مدیر گروه، مراقب ──
  if (has('PROFESSOR')) return '/professor';
  if (has('ATTENDANCE_CONTROLLER')) return '/admin/attendance-control';
  if (has('DEP_HEAD')) return '/group-manager';
  if (has('PROCTOR')) return '/proctor';

  // ── ۳) دانشجو ──
  if (has('STUDENT')) return '/student';

  return '/admin';
}

/**
 * نقش‌ها به مسیرهای SPA (زیر /app) در فازهای بعد نگاشت می‌شوند؛ تا آن زمان
 * مسیر برگشتی homeFor مسیر سیستم فعلی است و با ناوبری کامل باز می‌شود.
 */
export function isSpaPath(homePath: string): boolean {
  return homePath.startsWith('/app') || homePath === '/' || homePath.startsWith('/login') || homePath.startsWith('/change-password');
}

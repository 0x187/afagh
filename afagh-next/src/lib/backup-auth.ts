import { getSessionUser, type SessionUser } from '@/lib/auth';
import { authorizedUniversityIds } from '@/lib/university-scope';

/**
 * احراز هویتِ بدون redirect برای اکشن‌ها و routeها.
 *
 * `requireRole`/`requirePlatformAdmin` داخل یک Server Action `redirect()` می‌زنند؛
 * وقتی یک Server Action redirect کند، نکست‌جی‌اس پاسخ را به‌عنوان RSC معتبر پارس
 * نمی‌کند و سمت کلاینت خطای «An unexpected response was received from the server.»
 * (دیالوگ «خطا در ارجاع به این صفحه») نشان می‌دهد — یعنی به‌جای پیام فارسیِ تمیز،
 * کاربر یک ارور مرموز می‌بیند. اینجا صراحتاً خطای احراز هویت را پرتاب/برمی‌گردانیم.
 */
export class BackupAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupAuthError';
  }
}

async function resolveAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new BackupAuthError('سشن منقضی شده است؛ لطفاً دوباره وارد شوید.');
  if (!user.roles.includes('ADMIN')) throw new BackupAuthError('این عملیات نیازمند نقش ادمین است.');
  return user;
}

/** برای Server Actionها — پرتاب می‌کند (تا catch پیام فارسی برگرداند). */
export async function assertPlatformAdmin(): Promise<SessionUser> {
  const user = await resolveAdmin();
  if ((await authorizedUniversityIds()) !== null) {
    throw new BackupAuthError('این عملیات فقط برای مدیر پلتفرم مجاز است.');
  }
  return user;
}

export async function assertAdmin(): Promise<SessionUser> {
  return resolveAdmin();
}

/**
 * برای routeهای HTTP — به‌جای پرتاب، کاربر را برمی‌گرداند یا null.
 * (در route نباید redirect/throw کنیم؛ باید پاسخ ۴۰۱/۴۰۳ بدهیم.)
 */
export async function getPlatformAdminUser(): Promise<SessionUser | null> {
  try {
    return await assertPlatformAdmin();
  } catch {
    return null;
  }
}

export function isBackupAuthError(e: unknown): boolean {
  return e instanceof BackupAuthError;
}

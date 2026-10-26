import { useSession } from '@/lib/session';
import { homeFor } from '@/lib/home-route';
import type { SessionUser } from '@/lib/api';

// ═══ گارد نقش — پورت قاعدهٔ requireRole (ADMIN همه‌جا مجاز؛ mustChange → تغییر رمز) ═══
export type RoleGuard = {
  user: SessionUser | null;
  loading: boolean;
  /** کاربر باید رمز را عوض کند — مسیر مجاز فقط /change-password است. */
  mustChange: boolean;
  /** دسترسی به ناحیهٔ خواسته‌شده (ADMIN ضمنی همه‌جا مجاز است). */
  allowed: boolean;
  /** مسیر پیشنهادی پس از ورود/رد دسترسی. */
  homePath: string;
};

export function roleGuard(user: SessionUser | null, allowedRoles: string[]): Omit<RoleGuard, 'loading'> {
  if (!user) {
    return { user: null, mustChange: false, allowed: false, homePath: '/login' };
  }
  const homePath = homeFor(user.roles);
  if (user.mustChangePassword) {
    return { user, mustChange: true, allowed: false, homePath: '/change-password' };
  }
  const allowed = user.roles.some((r) => r === 'ADMIN' || allowedRoles.includes(r));
  return { user, mustChange: false, allowed, homePath };
}

export function useRoleGuard(allowedRoles: string[]): RoleGuard {
  const { data, isLoading } = useSession();
  const guard = roleGuard(data?.user ?? null, allowedRoles);
  return { ...guard, loading: isLoading };
}

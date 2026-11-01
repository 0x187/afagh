import { useSession } from '@/lib/session';
import { homeFor } from '@/lib/home-route';
import type { SessionUser } from '@/lib/api';

// ═══ Role guard — port of the requireRole rule (ADMIN allowed everywhere; mustChange → password change) ═══
export type RoleGuard = {
  user: SessionUser | null;
  loading: boolean;
  /** The user must change the password — the only allowed route is /change-password. */
  mustChange: boolean;
  /** Access to the requested area (ADMIN is implicitly allowed everywhere). */
  allowed: boolean;
  /** Suggested route after login/access denial. */
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

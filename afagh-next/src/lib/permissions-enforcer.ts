/**
 * Runtime Permission Enforcement Middleware
 * Field/Form-level RBAC enforcement (not just matrix definition)
 * Usage: import { requirePermission, canAccessField, withPermissionCheck } from '@/lib/permissions-enforcer'
 */

import { redirect } from 'next/navigation';
import { db } from '@/db';
import { eq } from 'drizzle-orm';
import { roles, role_permissions, permissions, user_roles } from '@/db/schema';

export type PermissionCode = string; // e.g., 'finance:student:edit', 'grades:enter', 'enrollment:approve'
export type ResourceType = 'page' | 'api' | 'field' | 'action' | 'button';

interface PermissionCache {
  userPermissions: Map<number, Set<string>>;
  /** مجوزهایی که صرفاً از نقش‌های «سفارشی» (isSystem=0) آمده‌اند — مبنای نمایش لینک داشبورد مدیریت */
  userCustomPermissions: Map<number, Set<string>>;
  lastRefresh: number;
}

const cache: PermissionCache = { userPermissions: new Map(), userCustomPermissions: new Map(), lastRefresh: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Refresh permission cache from database.
 *
 * 🔧 Fix: custom (admin-created, non-system) roles were previously filtered out
 * with `WHERE roles.isSystem = 1`, so their permissions never reached the cache
 * and the whole RBAC matrix was inert for them. Now permissions of ALL roles
 * (system + custom) are loaded.
 */
export async function refreshPermissionCache(): Promise<void> {
  const rows = await db.select({
    userId: user_roles.userId,
    permissionCode: permissions.code,
    isSystemRole: roles.isSystem,
  })
    .from(user_roles)
    .innerJoin(roles, eq(roles.id, user_roles.roleId))
    .innerJoin(role_permissions, eq(role_permissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, role_permissions.permissionId));

  const newMap = new Map<number, Set<string>>();
  // مجوزهای آمده از نقش‌های سفارشی (isSystem=0) — تنها مبنای نمایش لینک داشبورد مدیریت.
  // نقش‌های سیستمی (ADMIN/EDU_EXPERT/…/DEP_HEAD/PROFESSOR/STUDENT) هرکدام مجوزهای
  // پیش‌فرض خود را دارند؛ اگر این‌ها هم شمرده شوند، هر «مدیر گروه» یا «استاد» لینک
  // مدیریت می‌گیرد — که باگ گزارش‌شده بود. پس فقط isSystem=0 شمرده می‌شود.
  const newCustomMap = new Map<number, Set<string>>();
  for (const row of rows) {
    if (!newMap.has(row.userId)) newMap.set(row.userId, new Set());
    newMap.get(row.userId)!.add(row.permissionCode);
    if (row.isSystemRole === 0) {
      if (!newCustomMap.has(row.userId)) newCustomMap.set(row.userId, new Set());
      newCustomMap.get(row.userId)!.add(row.permissionCode);
    }
  }
  cache.userPermissions = newMap;
  cache.userCustomPermissions = newCustomMap;
  cache.lastRefresh = Date.now();
}

/** Get permissions for a user (with caching) */
export async function getUserPermissions(userId: number): Promise<Set<string>> {
  if (Date.now() - cache.lastRefresh > CACHE_TTL_MS || cache.userPermissions.size === 0) {
    await refreshPermissionCache();
  }
  return cache.userPermissions.get(userId) ?? new Set();
}

/** Check if user has a specific permission */
export async function hasPermission(userId: number, permissionCode: PermissionCode): Promise<boolean> {
  const perms = await getUserPermissions(userId);
  return perms.has(permissionCode);
}

/** Permission codes of a user as a sorted, unique array (reuses the cache) */
export async function getUserPermissionCodes(userId: number): Promise<string[]> {
  const perms = await getUserPermissions(userId);
  return [...perms].sort();
}

/**
 * فقط مجوزهایی که از نقش‌های «سفارشی» (isSystem=0) آمده‌اند.
 *
 * چرا جدا از getUserPermissionCodes؟ چون نقش‌های سیستمی (ADMIN، EDU_EXPERT،
 * DEP_HEAD، PROFESSOR، STUDENT، …) هرکدام مجوزهای پیش‌فرض دارند و اگر آن‌ها هم
 * شمرده شوند، هر «مدیر گروه» یا «استاد» لینک «داشبورد مدیریت» می‌گیرد — همان
 * باگی که گزارش شد. نمایش لینک مدیریت باید فقط بر پایهٔ مجوزهای سفارشی باشد
 * (نقش‌هایی که ادمین خودش ساخته و مجوز داده)، نه مجوزهای ذاتیِ نقش سیستمی.
 */
export async function getUserCustomPermissionCodes(userId: number): Promise<string[]> {
  if (Date.now() - cache.lastRefresh > CACHE_TTL_MS || cache.userPermissions.size === 0) {
    await refreshPermissionCache();
  }
  return [...(cache.userCustomPermissions.get(userId) ?? new Set<string>())].sort();
}

/** نتیجهٔ گارد ترکیبی «نقش یاهمجوز» — همان شکل SessionUser + مجوزهای کاربر */
export type PermissionAuthResult = {
  id: number;
  name: string;
  roles: string[];
  mustChangePassword: boolean;
  universityId: number | null;
  permissions: string[];
};

/**
 * گارد سرور برای صفحه‌ها: دسترسی «نقش-محور» یا «مجوز-محور».
 * ADMIN همیشه عبور می‌کند؛ اگر نه نقشی در allowedRoles دارد و نه هیچ‌کدام از
 * permissionCodes را دارد → redirect('/admin'). بدون نشست → redirect('/login').
 */
export async function requireRoleOrPermission(
  allowedRoles: string[],
  permissionCodes?: string[],
): Promise<PermissionAuthResult> {
  const { getSessionUser } = await import('@/lib/auth');
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // هم‌راستا با requireRole: رمز پیش‌فرض باید پیش از ورود به کارتابل عوض شود.
  if (user.mustChangePassword) redirect('/change-password');

  const permissions = await getUserPermissionCodes(user.id);
  const hasRole = user.roles.includes('ADMIN') || user.roles.some(r => allowedRoles.includes(r));
  const hasPermission = !!permissionCodes && permissionCodes.length > 0
    && permissionCodes.some(p => permissions.includes(p));
  if (!hasRole && !hasPermission) redirect('/admin');

  return {
    id: user.id,
    name: user.name,
    roles: user.roles,
    mustChangePassword: user.mustChangePassword,
    universityId: user.universityId,
    permissions,
  };
}

/** Get current user ID from session (server-side) */
export async function getCurrentUserId(): Promise<number | null> {
  const { getSessionUser } = await import('@/lib/auth');
  const user = await getSessionUser();
  return user?.id ?? null;
}

/** Server-side permission guard for API routes */
export async function requirePermissionApi(permissionCode: PermissionCode): Promise<number> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('UNAUTHENTICATED');
  }
  const allowed = await hasPermission(userId, permissionCode);
  if (!allowed) {
    throw new Error('FORBIDDEN');
  }
  return userId;
}

/** Server-side permission guard for pages (redirects) */
export async function requirePermissionPage(permissionCode: PermissionCode, redirectTo = '/admin'): Promise<number> {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/login');
  }
  const allowed = await hasPermission(userId, permissionCode);
  if (!allowed) {
    redirect(redirectTo);
  }
  return userId;
}

/** Field-level access check */
export async function canAccessField(userId: number, resource: string, field: string, action: 'read' | 'write'): Promise<boolean> {
  // Check specific field permission: e.g., 'student:field:gpa:write'
  const fieldPerm = `${resource}:field:${field}:${action}`;
  if (await hasPermission(userId, fieldPerm)) return true;
  
  // Fallback to resource-level permission: e.g., 'student:write'
  const resourcePerm = `${resource}:${action}`;
  if (await hasPermission(userId, resourcePerm)) return true;
  
  // Fallback to wildcard
  if (await hasPermission(userId, `${resource}:*`)) return true;
  if (await hasPermission(userId, `*:${action}`)) return true;
  
  return false;
}

/** Component-level permission check (for client components via server action) */
export async function checkPermissionAction(permissionCode: PermissionCode): Promise<{ allowed: boolean }> {
  try {
    await requirePermissionApi(permissionCode);
    return { allowed: true };
  } catch {
    return { allowed: false };
  }
}

/** Higher-order function for API route handlers */
export function withPermissionCheck<T extends (...args: unknown[]) => Promise<unknown>>(
  handler: T,
  permissionCode: PermissionCode
): T {
  return (async (...args: unknown[]) => {
    await requirePermissionApi(permissionCode);
    return handler(...args);
  }) as T;
}

/** Permission codes catalog (matches permissions-catalog.json) */
export const PERMISSIONS = {
  // Finance
  FINANCE_VIEW: 'finance:view',
  FINANCE_STUDENT_VIEW: 'finance:student:view',
  FINANCE_STUDENT_EDIT: 'finance:student:edit',
  FINANCE_DISCOUNT_APPROVE: 'finance:discount:approve',
  FINANCE_SPONSORSHIP_APPROVE: 'finance:sponsorship:approve',
  FINANCE_CHEQUE_MANAGE: 'finance:cheque:manage',
  FINANCE_LOAN_MANAGE: 'finance:loan:manage',
  FINANCE_POS_SALE: 'finance:pos:sale',
  FINANCE_POS_VOID: 'finance:pos:void',
  FINANCE_REPORT_VIEW: 'finance:report:view',
  FINANCE_SETTINGS: 'finance:settings',
  
  // Tuition
  TUITION_RULE_VIEW: 'tuition:rule:view',
  TUITION_RULE_EDIT: 'tuition:rule:edit',
  TUITION_COEFFICIENT_EDIT: 'tuition:coefficient:edit',
  
  // Enrollment
  ENROLLMENT_STUDENT_VIEW: 'enrollment:student:view',
  ENROLLMENT_STUDENT_APPROVE: 'enrollment:student:approve',
  ENROLLMENT_CAPACITY_MANAGE: 'enrollment:capacity:manage',
  
  // Grades
  GRADES_VIEW: 'grades:view',
  GRADES_ENTER: 'grades:enter',
  GRADES_APPROVE: 'grades:approve',
  GRADES_APPEAL: 'grades:appeal',
  
  // Students
  STUDENT_VIEW: 'student:view',
  STUDENT_EDIT: 'student:edit',
  STUDENT_FINANCE_VIEW: 'student:finance:view',
  STUDENT_FINANCE_EDIT: 'student:finance:edit',
  
  // Reports
  REPORT_FINANCE_EXPORT: 'report:finance:export',
  REPORT_ACADEMIC_EXPORT: 'report:academic:export',
  
  // Admin
  ADMIN_USER_MANAGE: 'admin:user:manage',
  ADMIN_ROLE_MANAGE: 'admin:role:manage',
  ADMIN_PERMISSION_MANAGE: 'admin:permission:manage',
  ADMIN_SYSTEM_SETTINGS: 'admin:system:settings',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

/** Helper to check permission by key */
export async function checkPerm(userId: number, key: PermissionKey): Promise<boolean> {
  return hasPermission(userId, PERMISSIONS[key]);
}

/** Clear cache (call after role/permission changes) */
export function clearPermissionCache(): void {
  cache.userPermissions.clear();
  cache.userCustomPermissions.clear();
  cache.lastRefresh = 0;
}

/** Targeted invalidation — remove only the given users from the cache Maps */
export async function invalidatePermissionCacheFor(userIds: number[]): Promise<void> {
  for (const id of userIds) {
    cache.userPermissions.delete(id);
    cache.userCustomPermissions.delete(id);
  }
}
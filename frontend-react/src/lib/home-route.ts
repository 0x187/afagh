// ═══ "After login, which cartable?" — line-by-line port of home-route.ts ═══
//
// Priority rule (per the Education office's request):
//   1) Expert/management — a multi-role user must see the expert cartable
//   2) Professor, group manager, and proctor
//   3) Student
export function homeFor(roles: string[]): string {
  // No role → back to login with a clear message (prevents an endless login loop)
  if (roles.length === 0) return '/login?e=norole';
  const has = (r: string) => roles.includes(r);

  // ── 1) Expert and management cartable ──
  if (has('ADMIN') || has('EDU_EXPERT') || has('VICE_EDU')) return '/admin';
  if (has('FINANCE_EXPERT') || has('FINANCE')) return '/admin/payroll';
  if (has('VAULT_MANAGER')) return '/admin/exams';
  if (has('MILITARY_OFFICER')) return '/admin/students';
  if (has('ARCHIVE_EXPERT')) return '/admin/archive';
  if (has('GRADUATION_EXPERT')) return '/admin/defense-scheduling';

  // ── 2) Professor, group manager, proctor ──
  if (has('PROFESSOR')) return '/professor';
  if (has('ATTENDANCE_CONTROLLER')) return '/admin/attendance-control';
  if (has('DEP_HEAD')) return '/group-manager';
  if (has('PROCTOR')) return '/proctor';

  // ── 3) Student ──
  if (has('STUDENT')) return '/student';

  return '/admin';
}

/**
 * Roles are mapped to SPA routes (under /app) in later phases; until then
 * homeFor's fallback path is the current system's path and opens with full navigation.
 */
export function isSpaPath(homePath: string): boolean {
  return homePath.startsWith('/app') || homePath === '/' || homePath.startsWith('/login') || homePath.startsWith('/change-password');
}

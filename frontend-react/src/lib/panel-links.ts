// ═══ فهرست «کارتابل‌های من» — پورت panel-links.ts ═══
export type PanelKey = 'student' | 'professor' | 'group-manager' | 'admin' | 'proctor';

export interface PanelLink {
  key: PanelKey;
  href: string;
  label: string;
  icon: string;
  /** مسیر در SPA جدید (فاز ۱ فقط خانه)؛ نبود = ناوبری کامل به مسیر سیستم فعلی */
  spaHref?: string;
}

export const ADMIN_PANEL_ROLES = [
  'ADMIN',
  'EDU_EXPERT',
  'FINANCE_EXPERT',
  'FINANCE',
  'ARCHIVE_EXPERT',
  'MILITARY_OFFICER',
  'VAULT_MANAGER',
  'VICE_EDU',
  'GRADUATION_EXPERT',
] as const;

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'مدیر سامانه',
  EDU_EXPERT: 'کارشناس آموزش',
  FINANCE_EXPERT: 'کارشناس مالی',
  FINANCE: 'مالی',
  ARCHIVE_EXPERT: 'کارشناس بایگانی',
  MILITARY_OFFICER: 'کارشناس نظام وظیفه',
  VAULT_MANAGER: 'مدیر صندوق',
  VICE_EDU: 'معاون آموزشی',
  GRADUATION_EXPERT: 'کارشناس فارغ‌التحصیلی',
  DEP_HEAD: 'مدیر گروه',
  PROFESSOR: 'استاد',
  STUDENT: 'دانشجو',
  PROCTOR: 'مراقب آزمون',
};

const PANEL_ROLE_SETS: Record<PanelKey, readonly string[]> = {
  student: ['STUDENT'],
  professor: ['PROFESSOR'],
  'group-manager': ['DEP_HEAD'],
  admin: ADMIN_PANEL_ROLES,
  proctor: ['PROCTOR', 'VAULT_MANAGER', 'ADMIN', 'EDU_EXPERT', 'PROFESSOR'],
};

/** «دسترسی با نقش: …» — خالی اگر ناشناخته */
export function panelRoleHint(key: PanelKey, roles: readonly string[]): string {
  const wanted = PANEL_ROLE_SETS[key];
  const names = roles.filter((r) => wanted.includes(r)).map((r) => ROLE_LABELS[r]).filter(Boolean);
  const uniq = [...new Set(names)];
  return uniq.length ? `دسترسی با نقش: ${uniq.join('، ')}` : '';
}

/** پنل‌های مجاز — به همان ترتیب اولویت homeFor. */
export function availablePanels(roles: readonly string[], permissionCount = 0): PanelLink[] {
  const has = (r: string) => roles.includes(r);
  const out: PanelLink[] = [];
  if (permissionCount > 0 || ADMIN_PANEL_ROLES.some(has)) {
    out.push({ key: 'admin', href: '/admin', label: 'داشبورد مدیریت', icon: '🗂️' });
  }
  if (has('PROFESSOR')) out.push({ key: 'professor', href: '/professor', label: 'کارتابل استاد', icon: '👨‍🏫', spaHref: '/professor' });
  if (has('DEP_HEAD')) out.push({ key: 'group-manager', href: '/group-manager', label: 'پنل مدیر گروه', icon: '🏛️', spaHref: '/group-manager' });
  if (has('PROCTOR')) out.push({ key: 'proctor', href: '/proctor', label: 'پورتال مراقب', icon: '📷' });
  if (has('STUDENT')) out.push({ key: 'student', href: '/student', label: 'پنل دانشجو', icon: '🎓', spaHref: '/student' });
  return out;
}

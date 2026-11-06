// لینک‌کاشی‌های مرکز گزارش‌ها به صفحات تخصصی مستقل — بدون هیچ import سروری،
// تا کامپوننت کلاینت (ReportsClient) بتواند بی‌خطر واردش کند.
export interface ReportLinkCard {
  kind: string;
  icon: string;
  title: string;
  href: string;
}

export const LINK_CARDS: ReportLinkCard[] = [
  { kind: 'link-builder', icon: '🛠️', title: 'گزارش‌ساز (ساخت گزارش دلخواه)', href: '/admin/reports/builder' },
  { kind: 'link-saved-reports', icon: '📂', title: 'گزارش‌های ذخیره‌شده', href: '/admin/reports/saved' },
  { kind: 'link-exams', icon: '🗂️', title: 'کارتابل برنامه‌ریزی امتحانات', href: '/admin/exams' },
  { kind: 'link-scheduling', icon: '📅', title: 'برنامه‌ریزی درسی گروه‌ها', href: '/admin/scheduling' },
  { kind: 'link-defense', icon: '🛡️', title: 'میز دفاع پایان‌نامه', href: '/admin/defense-scheduling' },
  { kind: 'link-student-finance', icon: '💳', title: 'امور مالی دانشجویان', href: '/admin/student-finance' },
  { kind: 'link-student-statement', icon: '📄', title: 'صورت‌حساب مالی دانشجو', href: '/admin/finance/reports/student-statement' },
  { kind: 'link-archive', icon: '🗄️', title: 'بایگانی مدارک', href: '/admin/archive' },
  { kind: 'link-student-cards', icon: '🪪', title: 'صدور کارت دانشجویی', href: '/admin/student-cards' },
  { kind: 'link-regulation-check', icon: '🔍', title: 'بررسی آیین‌نامه (تک‌دانشجو)', href: '/admin/regulation-check' },
  { kind: 'link-migration', icon: '🔁', title: 'انتقال داده + خروجی اکسل', href: '/admin/migration' },
  { kind: 'link-admissions', icon: '📥', title: 'پذیرش / داده سنجش', href: '/admin/admissions' },
  { kind: 'link-samin', icon: '📡', title: 'هاب ثمین', href: '/admin/samin' },
  { kind: 'link-workflows', icon: '🔀', title: 'فرآیندها و درخواست‌ها', href: '/admin/workflows' },
  { kind: 'link-pos', icon: '🏧', title: 'ترمینال‌های POS', href: '/admin/finance/pos' },
  { kind: 'link-students', icon: '🎓', title: 'پرونده دانشجویان', href: '/admin/students' },
  { kind: 'link-staff', icon: '👨‍🏫', title: 'اساتید و کارکنان', href: '/admin/staff' },
  { kind: 'link-curriculum', icon: '📚', title: 'برنامه درسی', href: '/admin/curriculum' },
  { kind: 'link-short-courses', icon: '🎯', title: 'دوره‌های کوتاه‌مدت', href: '/admin/short-courses' },
];

import { describe, expect, it } from 'vitest';
import { homeFor } from './home-route';

// Buddies with home-route.ts — all branches.
describe('homeFor', () => {
  it('بدون نقش → ورود با پیام norole', () => {
    expect(homeFor([])).toBe('/login?e=norole');
  });

  it('کارشناس/مدیریت مقدم بر بقیه است', () => {
    expect(homeFor(['ADMIN'])).toBe('/admin');
    expect(homeFor(['STUDENT', 'EDU_EXPERT'])).toBe('/admin');
    expect(homeFor(['PROFESSOR', 'VICE_EDU'])).toBe('/admin');
  });

  it('مالی/صندوق/نظام وظیفه/بایگانی/فارغ‌التحصیلی', () => {
    expect(homeFor(['FINANCE_EXPERT'])).toBe('/admin/payroll');
    expect(homeFor(['FINANCE'])).toBe('/admin/payroll');
    expect(homeFor(['VAULT_MANAGER'])).toBe('/admin/exams');
    expect(homeFor(['MILITARY_OFFICER'])).toBe('/admin/students');
    expect(homeFor(['ARCHIVE_EXPERT'])).toBe('/admin/archive');
    expect(homeFor(['GRADUATION_EXPERT'])).toBe('/admin/defense-scheduling');
  });

  it('استاد و مدیر گروه و مراقب', () => {
    expect(homeFor(['PROFESSOR'])).toBe('/professor');
    expect(homeFor(['ATTENDANCE_CONTROLLER'])).toBe('/admin/attendance-control');
    expect(homeFor(['DEP_HEAD'])).toBe('/group-manager');
    expect(homeFor(['PROCTOR'])).toBe('/proctor');
  });

  it('دانشجو و پیش‌فرض ناشناخته', () => {
    expect(homeFor(['STUDENT'])).toBe('/student');
    expect(homeFor(['SOMETHING_ELSE'])).toBe('/admin');
  });

  it('اولویت کارشناسی بر دانشجو/استاد (قاعدهٔ آموزش)', () => {
    expect(homeFor(['STUDENT', 'PROFESSOR', 'FINANCE_EXPERT'])).toBe('/admin/payroll');
  });
});

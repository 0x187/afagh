'use client';

/**
 * مدیریت نسخه‌های برنامهٔ درسی (فاز ۷ — Thin Client) — نقطهٔ ورود.
 *
 * ساختار پس از جراحی این دور (فایل قبلی ۱۸۳۱ خط بود):
 *   types.ts               قرارداد داده (بدون React)
 *   curriculum-core.ts      منطق خالص: قاعدهٔ درختی، چارت ترمی، فیلترها، خلاصه‌ها — قابل Unit Test
 *   CurriculumProvider.tsx  تنها جای وضعیت: ۳۸ useState + Server Actionها + مشتقات
 *   components/*            ۵ تب + بنر/نوار تب/توست/۵ مودال/ویرایشگر سهم — هر فایل فقط رندر خودش
 *
 * قانون طلایی (توافق): هیچ دادهٔ Mock در این ماژول نیست. همهچیز از Server Actions
 * دامنه خوانده می‌شود؛ هر تغییر = یک اکشن گارددار با تراکنش و زنجیرهٔ حسابرسی.
 *
 * پیوندپذیری: `?tab=SEMESTERS` تب آغازین را انتخاب می‌کند (مقدار نامعتبر با
 * resolveTab به تب ۱ برمی‌گردد) — هم برای کاربر مفید است، هم هر تب را مستقل
 * قابل رندر/تست می‌کند.
 */
import type { CurriculumWorkspace, VersionDetail } from './types';
import { CurriculumProvider } from './CurriculumProvider';
import CurriculumShell from './components/CurriculumShell';

export default function CurriculumManagerClient({
  initial, tab, version, detail, universityTitle,
}: { initial: CurriculumWorkspace; tab?: string | null; version?: number | null; detail?: VersionDetail | null; universityTitle?: string }) {
  return (
    <CurriculumProvider initial={initial} tab={tab} version={version} detail={detail} universityTitle={universityTitle}>
      <CurriculumShell />
    </CurriculumProvider>
  );
}

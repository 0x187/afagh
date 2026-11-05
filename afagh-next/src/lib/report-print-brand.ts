import 'server-only';

import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { getFormSigners, getSetting } from '@/lib/settings';

/**
 * هویت بصری واحدِ **همهٔ اسناد چاپی گزارشها** (مراکز مالی/آموزشی،
 * گزارشساز و گزارشهای ذخیرهشده): نام دانشگاه، آرم و برچسبهای امضا.
 *
 * منبع نخست پروفایل دانشگاهِ فعال است؛ اگر دانشگاهی آرم اختصاصی نداشت،
 * ارم/نام سراسری «تنظیمات سامانه» جایگزین میشود (همان الگوی کارت دانشجویی).
 * امضاها به تفکیک «کد فرم» از تنظیمات خوانده میشوند تا عناوین سازمانی
 * بدون تغییر کد قابل ویرایش باشند.
 */
export type ReportPrintBrand = {
  universityTitle: string;
  universityLogoUrl: string;
  signers: string[];
};

export async function getReportPrintBrand(
  form = 'custom-report',
  universityId?: number | null,
): Promise<ReportPrintBrand> {
  const uid = typeof universityId === 'number' && universityId > 0 ? universityId : 0;
  const uniRow = uid
    ? (await db.execute<{ title: string; logoUrl: string | null }>(
        sql`SELECT title, "logoUrl" FROM universities WHERE id = ${uid} LIMIT 1`,
      )).rows[0]
    : undefined;
  const [globalName, globalLogo, signers] = await Promise.all([
    getSetting('UNIVERSITY_NAME').catch(() => 'سامانه جامع آفاق'),
    getSetting('UNIVERSITY_LOGO').catch(() => ''),
    getFormSigners(form).catch(() => [] as string[]),
  ]);
  return {
    universityTitle: uniRow?.title?.trim() || globalName.trim() || 'سامانه جامع آفاق',
    universityLogoUrl: uniRow?.logoUrl?.trim() || globalLogo.trim() || '',
    signers,
  };
}

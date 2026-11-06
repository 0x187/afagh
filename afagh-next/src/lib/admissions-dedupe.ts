/**
 * ════════════════════════════════════════════════════════════════════════
 *  تشخیص «پروندهٔ از قبل موجود» هنگام انتقال ردیف‌های سنجش به دانشجو
 *
 *  چرا این ماژول جدا شده:
 *    منطق قبلی فقط `students.majorId === mappedMajorId` را می‌سنجید و اگر
 *    پروندهٔ فعالی پیدا می‌شد، **خطا می‌داد**. نتیجه دو باگ بود:
 *
 *    ۱) انتقالِ دوبارهٔ همان فایل برای *همهٔ* ردیف‌ها خطا می‌داد، چون بار اول
 *       پرونده ساخته شده بود ولی `staging.studentId` پر نشده بود ⇒ سیستم
 *       نمی‌فهمید این ردیف قبلاً منتقل شده. عملیات idempotent نبود.
 *
 *    ۲) در جدول `majors` چند رکورد با **نام یکسان** ولی شناسه/کد متفاوت وجود
 *       دارد (مثلاً «حسابداری» با کد ۲۲ و ۹۲۲). مقایسهٔ شناسه‌محور آن‌ها را
 *       متفاوت می‌دید و برای دانشجوی موجود یک پروندهٔ دومِ هم‌نام می‌ساخت.
 *
 *  قرارداد این تابع: هرگز خطا نمی‌دهد و هیچ داده‌ای تغییر نمی‌دهد — فقط
 *  تصمیم می‌گیرد «این ردیف به کدام پروندهٔ موجود وصل شود». تصمیمِ ثبتِ پروندهٔ
 *  دوم فقط با `ALLOW_DUPLICATE` صریحِ ادمین ممکن است.
 * ════════════════════════════════════════════════════════════════════════
 */
import { normalizeFa } from '@/lib/sanjesh/major-suggest';

export type ProfileCandidate = {
  id: number;
  studentCode: string | null;
  majorId: number | null;
  majorName: string | null;
};

export type MatchReason = 'same-major-id' | 'same-major-name';

export type ExistingProfileMatch = {
  profile: ProfileCandidate;
  reason: MatchReason;
};

/**
 * از میان پرونده‌های فعالِ یک دانشجو (همان سال ورود)، پرونده‌ای را برمی‌گرداند
 * که همان پذیرشِ ردیف سنجش است.
 *
 * ترتیب اولویت:
 *   ۱) شناسهٔ رشته دقیقاً برابر            → same-major-id
 *   ۲) نام رشته پس از نرمال‌سازی برابر      → same-major-name
 *
 * اگر هیچ‌کدام نبود `null` برمی‌گردد ⇒ ردیف واقعاً پذیرش تازه است.
 */
export function pickExistingProfile(
  candidates: ProfileCandidate[],
  target: { majorId: number | null; majorName: string | null },
): ExistingProfileMatch | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  if (target.majorId != null) {
    const byId = candidates.find(c => c.majorId === target.majorId);
    if (byId) return { profile: byId, reason: 'same-major-id' };
  }

  const wanted = normalizeFa(target.majorName ?? '');
  if (!wanted) return null;

  const byName = candidates.find(c => normalizeFa(c.majorName ?? '') === wanted);
  return byName ? { profile: byName, reason: 'same-major-name' } : null;
}

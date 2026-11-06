/**
 * تبدیل تاریخ میلادی/ایزو به شمسی برای نمایش (با اعداد فارسی).
 * اگر ورودی از قبل شمسی باشد دست‌نخورده برمی‌گردد.
 */
import { toGregorian, toJalaliFromDate } from './calendar';

export function toShamsi(dStr: string | null | undefined): string {
  if (!dStr) return '—';
  const s = String(dStr);
  if (s.startsWith('13') || s.startsWith('14') || s.startsWith('۱۳') || s.startsWith('۱۴')) {
    return s;
  }
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return new Intl.DateTimeFormat('fa-IR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return s;
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * نرمال‌سازی «تاریخ تقویم امتحان» به شمسی 'YYYY/MM/DD' — مقاوم به هر دو قالب.
 *
 * ⚠ چرا لازم است؟ نوشتنِ تاریخ در `schedules.examDate` یکدست نیست:
 *   • مسیر رزرو شیفت (`writeScheduleRow`) میلادی می‌نویسد،
 *   • ردیف‌های ایمپورت/سید قدیمی و سما شمسی نوشته شده‌اند (`1405-10-28`).
 * پیش‌تر همه میلادی فرض می‌شد و تاریخ‌های شمسی دوباره تبدیل می‌شدند
 * (۱۴۰۵-۱۰-۲۸ → ۷۸۴/۰۸/۰۶). اینجا سالِ کمتر از ۱۶۰۰ = از قبل شمسی.
 *
 * @returns 'YYYY/MM/DD' شمسی، یا null اگر قابل تشخیص نباشد.
 */
export function normalizeExamDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const j = toJalaliFromDate(v);
    return `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    // سالِ کمتر از ۱۶۰۰ = تاریخ از قبل شمسی است (۱۴۰۵-۱۰-۲۸)
    if (y < 1600) return `${y}/${pad2(mo)}/${pad2(d)}`;
    const j = toJalaliFromDate(new Date(y, mo - 1, d));
    return `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`;
  }
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return null;
  const j = toJalaliFromDate(dt);
  return `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`;
}

/** تاریخ شمسی 'YYYY/MM/DD' → Date میلادی محلی (برای نوشتن در ستون date) */
export function examDateToGregorian(v: string): Date {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(v.trim());
  if (!m) throw new Error(`قالب تاریخ شمسی نامعتبر: «${v}»`);
  const { gy, gm, gd } = toGregorian(Number(m[1]), Number(m[2]), Number(m[3]));
  return new Date(gy, gm - 1, gd);
}

/**
 * مقدارِ آمادهٔ نوشتن در `schedules.examDate` (ستون `date`) — **همیشه شمسی**.
 *
 * قرارداد: این ستون برچسبِ شمسی را نگه می‌دارد (`1405-10-22`)، مثل
 * `class_sessions.sessionDate` و `exam_sessions.examDate`. هر ورودی
 * (شمسی/میلادی/`Date`) پذیرفته و به 'YYYY-MM-DD' شمسی تبدیل می‌شود تا هیچ
 * مسیری دوباره میلادی در آن ننویسد. نبودِ تاریخ ⇒ `null`.
 */
export function examDateColumnValue(v: unknown): string | null {
  const j = normalizeExamDate(v);
  return j ? j.replace(/\//g, '-') : null;
}

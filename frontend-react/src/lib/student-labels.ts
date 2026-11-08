/**
 * برچسب‌های فارسی وضعیت/سهمیه دانشجو — Single Source برای UI.
 * کدهای وضعیت از نگاشت واقعی «وضعيت دانشجو.txt» سما استخراج شده‌اند.
 */

/** کد سما → وضعیت داخلی */
export const SAMA_STATUS_TO_INTERNAL: Record<string, string> = {
  '1': 'ACTIVE', '5': 'ACTIVE', '10': 'ACTIVE', '23': 'ACTIVE', '26': 'ACTIVE',
  '2': 'GRADUATED', '9': 'GRADUATED', '25': 'GRADUATED',
  '41': 'GRADUATED', '42': 'GRADUATED', '43': 'GRADUATED',
  '44': 'GRADUATED', '45': 'GRADUATED', '46': 'GRADUATED',
  '16': 'EXPELLED', '34': 'EXPELLED',
  '17': 'WITHDRAWN', '18': 'WITHDRAWN', '35': 'WITHDRAWN', '12': 'WITHDRAWN',
  '22': 'SUSPENDED',
  '3': 'TRANSFERRED', '4': 'TRANSFERRED', '14': 'TRANSFERRED',
  '15': 'TRANSFERRED', '24': 'TRANSFERRED', '37': 'TRANSFERRED',
  '0': 'UNKNOWN', '11': 'UNKNOWN', '8': 'UNKNOWN',
  '21': 'NO_SHOW', '29': 'NO_SHOW', '7': 'NO_SHOW',
  '20': 'DECEASED', '6': 'DECEASED',
};

/**
 * استثنای دانشگاهی نگاشت بالا — کدهای محلی که در سمای آن دانشگاه معنای
 * دیگری دارند. زرینه: کد 43 یعنی «عدم مراجعه» نه فارغ‌التحصیلی؛
 * کدهای 39/40/41/42 همگی فارغ‌التحصیل‌اند با تفکیک مقطع زرینه
 * (39=کاردانی پیوسته، 40=کارشناسی پیوسته، 41=کاردانی ناپیوسته، 42=کارشناسی ناپیوسته).
 */
export const SAMA_STATUS_UNI_OVERRIDE: Record<string, Record<string, string>> = {
  ZARINE: { '39': 'GRADUATED', '40': 'GRADUATED', '41': 'GRADUATED', '42': 'GRADUATED', '43': 'NO_SHOW' },
};

export const SAMA_STATUS_UNI_TITLE_OVERRIDE: Record<string, Record<string, string>> = {
  ZARINE: {
    '39': 'فارغ‌التحصیل کاردانی پیوسته',
    '40': 'فارغ‌التحصیل کارشناسی پیوسته',
    '41': 'فارغ‌التحصیل کاردانی ناپیوسته',
    '42': 'فارغ‌التحصیل کارشناسی ناپیوسته',
    '43': 'عدم مراجعه',
  },
};

/** کد سما → وضعیت داخلی با اعمال استثنای دانشگاه */
export function samaStatusToInternal(code: string | null | undefined, uniCode?: string | null): string {
  const c = String(code ?? '').trim();
  if (!c) return 'UNKNOWN';
  const uni = String(uniCode ?? '').trim().toUpperCase();
  if (uni && SAMA_STATUS_UNI_OVERRIDE[uni]?.[c]) return SAMA_STATUS_UNI_OVERRIDE[uni][c];
  return SAMA_STATUS_TO_INTERNAL[c] ?? 'UNKNOWN';
}

/** عنوان دقیق سما برای هر کد وضعیت (برای نمایش جزئیات) */
export const SAMA_STATUS_TITLE: Record<string, string> = {
  '0': 'نامشخص', '1': 'در حال تحصیل', '2': 'فارغ‌التحصیل',
  '3': 'انتقالی', '4': 'انتقال توام با تغییر رشته', '5': 'میهمان به دانشگاه',
  '6': 'شهید', '7': 'عدم مراجعه تحصیلات تکمیلی', '8': 'معرفی سنجش',
  '9': 'اتمام دروس ـ تطبیق واحد', '10': 'در حال تحصیل ـ مدارک ناقص',
  '11': 'بلاتکلیف', '12': 'لغو قبولی', '14': 'تغییر رشته', '15': 'جابجایی',
  '16': 'اخراج', '17': 'انصراف', '18': 'انصراف ـ تسویه نکرده',
  '20': 'فوت', '21': 'عدم مراجعه', '22': 'محروم از تحصیل',
  '23': 'مهمان از دانشگاه', '24': 'مهمان از دانشگاه (غیرفعال)',
  '25': 'اتمام دروس ـ تسویه نکرده', '26': 'در حال تحصیل ـ آزاد',
  '29': 'عدم مراجعه', '34': 'اخراج ـ اداره ثبت‌نام',
  '35': 'انصراف حین تحصیل', '37': 'پایان دوره میهمانی',
  '41': 'فارغ‌التحصیل کاردانی ناپیوسته', '42': 'فارغ‌التحصیل کاردانی پیوسته',
  '43': 'فارغ‌التحصیل کارشناسی ناپیوسته', '44': 'فارغ‌التحصیل کارشناسی پیوسته',
  '45': 'فارغ‌التحصیل کارشناسی ارشد', '46': 'فارغ‌التحصیل کاردانی بین‌مقطعی',
};

/** وضعیت داخلی → فارسی */
export const STUDENT_STATUS_FA: Record<string, string> = {
  ACTIVE: 'در حال تحصیل',
  GRADUATED: 'فارغ‌التحصیل',
  EXPELLED: 'اخراج',
  WITHDRAWN: 'انصراف',
  SUSPENDED: 'محروم از تحصیل',
  TRANSFERRED: 'انتقالی / میهمان',
  UNKNOWN: 'نامشخص',
  NO_SHOW: 'عدم مراجعه',
  DECEASED: 'فوت',
};

export function studentStatusFa(status: string | null | undefined, samaCode?: string | null, uniCode?: string | null): string {
  const uni = String(uniCode ?? '').trim().toUpperCase();
  if (samaCode && uni && SAMA_STATUS_UNI_TITLE_OVERRIDE[uni]?.[samaCode]) {
    return SAMA_STATUS_UNI_TITLE_OVERRIDE[uni][samaCode];
  }
  if (samaCode && SAMA_STATUS_TITLE[samaCode]) return SAMA_STATUS_TITLE[samaCode];
  if (!status) return 'نامشخص';
  return STUDENT_STATUS_FA[status] ?? status;
}

/** رنگ چیپ وضعیت */
export function studentStatusChip(status: string | null | undefined): string {
  switch (status) {
    case 'ACTIVE': return 'bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
    case 'GRADUATED': return 'bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200';
    case 'EXPELLED': return 'bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200';
    case 'WITHDRAWN': return 'bg-orange-100 text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200';
    case 'SUSPENDED': return 'bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200';
    case 'TRANSFERRED': return 'bg-violet-100 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200';
    case 'NO_SHOW': return 'bg-slate-200 text-slate-600';
    case 'DECEASED': return 'bg-zinc-800 text-zinc-100';
    default: return 'bg-slate-100 text-slate-600';
  }
}

/** وضع نمرهٔ داخلی → فارسی (از mapGrade در ETL: EXEMPT/TEMPORARY/FINALIZED/…) */
export const GRADE_STATUS_FA: Record<string, string> = {
  FINALIZED: 'نهایی',
  TEMPORARY: 'موقت',
  PENDING: 'در انتظار',
  EXEMPT: 'معاف',
  PASSED_NO_GRADE: 'قبول بدون نمره',
  FAILED_NO_GRADE: 'مردود بدون نمره',
};

export function gradeStatusFa(status: string | null | undefined): string {
  if (!status) return 'نامشخص';
  return GRADE_STATUS_FA[status] ?? status;
}

/** رنگ چیپ وضع نمره */
export function gradeStatusChip(status: string | null | undefined): string {
  switch (status) {
    case 'FINALIZED': return 'bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
    case 'TEMPORARY': return 'bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200';
    case 'EXEMPT':
    case 'PASSED_NO_GRADE': return 'bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200';
    case 'FAILED_NO_GRADE': return 'bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200';
    default: return 'bg-slate-100 text-slate-600';
  }
}

/** سهمیه → فارسی */
export const QUOTA_FA: Record<string, string> = {
  NORMAL: 'عادی',
  SHAHED: 'شاهد / ایثارگر',
  STAFF: 'کارکنان',
  TOP_TALENT: 'استعداد درخشان',
};

export function quotaFa(q: string | null | undefined): string {
  if (!q) return 'عادی';
  return QUOTA_FA[q] ?? q;
}

/**
 * شیوه آموزش سما (ستون studyingMode) — از فایل «شيوه آموزش.txt».
 * در داده، گاهی کدهای «دوره» هم در همین ستون آمده، پس با همان جدول نگاشت می‌شود.
 */
export const STUDY_MODE_FA: Record<string, string> = {
  '0': 'نامشخص',
  '1': 'آموزشی',
  '2': 'آموزشی - تغییر رشته دارای مغایرت',
  '3': 'آموزشی و پژوهشی',
  '4': 'آموزشی پژوهشی',
  '8': 'آموزشی - تغییر رشته',
  '11': 'پژوهش محور',
  // کدهای دوره (فایل «دوره.txt») که گاهی در همین ستون ثبت شده‌اند
  '5': 'دانشجویان خارجی',
  '6': 'روزانه - موارد خاص',
  '7': 'پیام نور',
  '10': 'مجازی',
  '202': 'مهمانی',
};

export function studyModeFa(v: string | null | undefined): string {
  if (v == null) return '—';
  const t = v.trim();
  if (!t) return '—';
  // کدها حداکثر ۳ رقم‌اند (تا 202)؛ مقادیر بلندتر دادهٔ خراب‌اند
  if (t.length > 3) return '—';
  return STUDY_MODE_FA[t] ?? t;
}

/**
 * نوع دوره سما (ستون studyingMode که در عمل COURSTYPE است) — از فایل «دوره.txt».
 */
export const COURSE_TYPE_FA: Record<string, string> = {
  '0': 'نامشخص',
  '1': 'روزانه',
  '2': 'شبانه',
  '3': 'نیمه حضوری',
  '4': 'غیرانتفاعی',
  '5': 'دانشجویان خارجی',
  '6': 'روزانه - موارد خاص',
  '7': 'پیام نور',
  '8': 'دوره‌های آموزش عالی آزاد',
  '10': 'مجازی',
  '202': 'مهمانی',
};

export function courseTypeFa(v: string | null | undefined): string {
  if (v == null) return '—';
  const t = v.trim();
  if (!t) return '—';
  if (t.length > 3) return '—';
  return COURSE_TYPE_FA[t] ?? t;
}

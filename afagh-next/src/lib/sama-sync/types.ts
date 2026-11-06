/**
 * ═══════════════════════════════════════════════════════════════════════
 *  همگام‌سازی هفتگی سما → آفاق — قراردادِ داده
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  چرا این ماژول جدا شد: تا امروز هر بار همگام‌سازی، یک اسکریپت یک‌بارمصرف
 *  بود (SQL دست‌نویس + تحلیل پایتونی) و نتیجه‌اش هم فقط در لاگِ همان روز
 *  می‌ماند. برای تکرارِ هفتگی سه چیز لازم است که هیچ‌کدام در آن اسکریپت‌ها
 *  نبود: (۱) تفکیکِ «تطبیق» از «اجرا» تا بتوان بی‌خطر dry-run گرفت،
 *  (۲) طبقه‌بندیِ اختلاف‌ها به دسته‌هایی که تصمیمِ انسانی می‌خواهند،
 *  (۳) گزارشِ ماشین‌خوانِ تکرارپذیر.
 *
 *  این فایل فقط شکلِ داده است؛ هیچ کوئری و هیچ side-effectی ندارد.
 *
 *  ── جریانِ کاری ──
 *  سما (SQL Server، فقط روی شبکهٔ داخلی) ──export──▶ TSV ──parse──▶ SamaSnapshot
 *  آفاق (Postgres) ──load──▶ AfaghSnapshot
 *  هر دو ──plan──▶ SyncPlan (خالص، قابل تست) ──apply──▶ SyncRunResult
 */

/** یک ردیف انتخاب واحد از سما (`VW_StdCourse` / `14051.txt`). */
export interface SamaEnrollRow {
  /** کد دانشجو — همان `students.studentCode` آفاق (نه شناسهٔ عددی سما) */
  studentCode: string;
  /** کد ترم، مثل ۱۴۰۵۱ */
  termCode: string;
  /** کد درس سما (`LT7.Code`) */
  courseCode: string;
  /** شمارهٔ گروه سما — NULL یعنی فایل ستون گروه نداشته */
  groupNumber: number | null;
  /** نمرهٔ خام سما (۰–۲۰) — NULL یعنی هنوز نمره‌ای ثبت نشده */
  grade: number | null;
  /** کد وضعیت نمرهٔ سما (اختیاری؛ برای تشخیص «حذف» از «بدون نمره») */
  statusCode: string | null;
}

/** یک ردیف دانشجو از سما (`Users`/`StudentInfo`). */
export interface SamaStudentRow {
  studentCode: string;
  fullName: string | null;
  majorCode: string | null;
  /** کد وضعیت دانشجو در سما (فارغ‌التحصیل/انصراف/…) */
  statusCode: string | null;
  entryYear: number | null;
}

/** خروجی پارسِ کاملِ یک بستهٔ TSV. */
export interface SamaSnapshot {
  termCode: string;
  enrollments: SamaEnrollRow[];
  students: SamaStudentRow[];
  /** هشدارهای پارس (ردیف معیوب، ستون غایب، …) — به گزارش می‌رود */
  warnings: string[];
}

/** وضعیتِ یک ارائه در آفاق (سبک، فقط چیزی که تطبیق لازم دارد). */
export interface AfaghOfferingRow {
  id: number;
  termId: number;
  termCode: string;
  courseCode: string;
  groupNumber: number;
  isActive: number;
  /** تعداد ثبت‌نام — کلیدِ تشخیص «ارائهٔ تکراریِ خالی» از «ارائهٔ واقعی» */
  enrolledCount: number;
}

/** یک ثبت‌نام موجود در آفاق. */
export interface AfaghEnrollRow {
  id: number;
  studentId: number;
  offeringId: number;
  status: string;
  gradeValue: string | null;
}

/** دانشجوی آفاق (فقط کلیدهای تطبیق). */
export interface AfaghStudentRow {
  id: number;
  studentCode: string;
  status: string;
}

export interface AfaghSnapshot {
  universityId: number;
  termCode: string;
  termId: number;
  students: AfaghStudentRow[];
  offerings: AfaghOfferingRow[];
  enrollments: AfaghEnrollRow[];
}

/* ────────────────────────── دسته‌بندیِ اختلاف ────────────────────────── */

/**
 * هر اختلاف دقیقاً یکی از این برچسب‌ها را می‌گیرد. برچسب تعیین می‌کند که
 * `apply` مجاز است خودکار عمل کند یا نه:
 *
 *   ADD_*      → افزودنیِ محض (بی‌خطر، idempotent)
 *   FILL_*     → پرکردنِ فیلدِ خالی (بی‌خطر)
 *   REVIEW_*   → فقط گزارش؛ اجرا نیازمند تأیید صریح
 */
export type SyncIssueCode =
  | 'ADD_ENROLLMENT'        // دانشجو در سما واحد دارد، در آفاق ندارد
  | 'ADD_STUDENT'           // دانشجو در سما هست، در آفاق نیست
  | 'FILL_GRADE'            // ثبت‌نام در آفاق هست ولی نمره خالی است
  | 'GROUP_MISMATCH'        // واحد هست ولی در گروه دیگری
  | 'OFFERING_MISSING'      // درس/گروه در آفاق ارائه ندارد
  | 'EXTRA_ENROLLMENT'      // در آفاق واحد دارد، در سما ندارد (احتمال انصراف)
  | 'STUDENT_AMBIGUOUS'     // کد دانشجو در چند دانشگاه/چند رکورد
  | 'DUPLICATE_OFFERING'    // چند ارائهٔ هم‌کلید؛ انتخاب شد ولی باید دیده شود
  | 'STATUS_MISMATCH';      // وضعیت دانشجو بین دو سامانه یکی نیست

export interface SyncIssue {
  code: SyncIssueCode;
  /** متن فارسیِ آمادهٔ نمایش */
  message: string;
  studentCode?: string;
  courseCode?: string;
  groupNumber?: number | null;
  /** شناسه‌های آفاق (اگر وجود دارند) */
  studentId?: number;
  offeringId?: number;
  enrollmentId?: number;
  /** مقدار فعلی و مقدار سما — برای نمایش «از → به» */
  from?: string | number | null;
  to?: string | number | null;
}

/** یک عملِ قابل اجرا (نه فقط گزارش). */
export interface SyncAction {
  kind: 'INSERT_ENROLLMENT' | 'FILL_GRADE';
  studentId: number;
  offeringId: number;
  studentCode: string;
  courseCode: string;
  groupNumber: number;
  termCode: string;
  /** فقط برای FILL_GRADE */
  enrollmentId?: number;
  grade?: number | null;
  /** کد خام سما که در `enrollments.originalSamaCode` نگه داشته می‌شود */
  originalSamaCode?: string | null;
}

/** خروجیِ خالصِ موتور تطبیق — هیچ‌چیز در پایگاه داده تغییر نکرده است. */
export interface SyncPlan {
  universityId: number;
  termCode: string;
  termId: number;
  /** عمل‌های بی‌خطر که `apply` بدون تأیید اضافه اجرا می‌کند */
  actions: SyncAction[];
  /** اختلاف‌هایی که فقط گزارش می‌شوند */
  issues: SyncIssue[];
  stats: SyncStats;
  warnings: string[];
}

export interface SyncStats {
  samaEnrollmentRows: number;
  samaUniqueStudents: number;
  samaUniqueOfferings: number;
  afaghEnrollmentRows: number;
  matched: number;
  addEnrollment: number;
  fillGrade: number;
  groupMismatch: number;
  offeringMissing: number;
  extraEnrollment: number;
  studentMissing: number;
  studentAmbiguous: number;
  duplicateOffering: number;
}

export interface SyncRunResult {
  ok: boolean;
  inserted: number;
  gradesFilled: number;
  /** نامِ جدولِ پشتیبان که پیش از اجرا ساخته شد */
  backupTable?: string;
  error?: string;
}

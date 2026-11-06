// ════════════════════════════════════════════════════════════════════════════
//  هستهٔ خالص «سیاستهای انطباق آییننامه» (Compliance Policy Core)
//
//  هدف: رفتارِ صحیحِ قانونی **پیشفرض** باشد، ولی هر جای آن **قابل تغییر** هم
//  باشد — بدون اینکه پیکربندیِ قدیمی/ناقصِ دیتابیس بیسروصدا قانون را نقض کند.
//
//  ترتیب اولویت (از بالا به پایین):
//      ۱) اورراید صریحِ مدیر (همراه با دلیل، دامنهدار: دانشگاه/مقطع/آییننامه/ورودی)
//      ۲) rulesConfig.compliance  ← پیکربندی آییننامه از پنل «آییننامهها»
//      ۳) تنظیمات سراسری قدیمی (system_settings) ← سازگاری با قبل
//      ۴) پیشفرضهای قانونی (این فایل، بر اساس مادهٔ آییننامه + مقطع + سال ورود)
//
//  نکتهٔ «هوشمندانه»: کلیدهای BINDING (احکام لازمالاجرا مثل دادنامهٔ دیوان)
//  اجازه نمیدهند یک مقدارِ کهنهٔ دیتابیس قانون را دور بزند؛ در عوض اورراید
//  صریحِ مدیر *همچنان* میتواند آنها را تغییر دهد، ولی منبع و تعارض ثبت میشود
//  تا در پنل مدیر دیده شود. یعنی «پیشفرض قانونی + قابلیت تغییر آگاهانه».
//
//  این ماژول عمداً هیچ وابستهای به DB/React/Next ندارد تا هم در سرور، هم در
//  کلاینت و هم در تست واحد یکسان اجرا شود.
// ════════════════════════════════════════════════════════════════════════════

export type ComplianceLevel = 'SHORT' | 'LONG' | 'MS' | 'PHD';
export type RegulationFamily = 'REG_1402' | 'LEGACY';
export type FailedCoursePolicy =
  | 'EXCLUDE_ALWAYS'
  | 'EXCLUDE_IF_PASSED'
  | 'EXCLUDE_IF_PASSED_1391'
  | 'KEEP_ALWAYS';

export const FAILED_COURSE_POLICIES: readonly FailedCoursePolicy[] = [
  'EXCLUDE_ALWAYS', 'EXCLUDE_IF_PASSED', 'EXCLUDE_IF_PASSED_1391', 'KEEP_ALWAYS',
] as const;

export const FAILED_COURSE_POLICY_LABELS: Record<FailedCoursePolicy, string> = {
  EXCLUDE_ALWAYS: 'عدم احتساب نمرات مردودی در معدل کل (دادنامهٔ دیوان عدالت اداری)',
  EXCLUDE_IF_PASSED: 'حذف مردودی فقط پس از قبولی مجدد (رویهٔ قدیمی)',
  EXCLUDE_IF_PASSED_1391: 'تبصرهٔ آییننامهٔ ۱۳۹۱ (قبولی مجدد با حد نصاب)',
  KEEP_ALWAYS: 'ابقای نمرهٔ مردودی در معدل کل (پیش از ۱۳۹۱)',
};

export interface ComplianceValues {
  // ── گام ۱: معدل، فراغت، پذیرش، مشروطی ──
  failed_course_gpa_policy: FailedCoursePolicy;
  grad_min_gpa: number;
  max_total_probations: number;
  regulation_resolution: 'SMART' | 'FIRST_ROW';
  probation_gpa_threshold: number;
  default_passing_grade: number;
  // ── گام ۲: یکسانسازی منابع پیکربندی ──
  seed_1402_graduate_regulations: boolean;
  single_source_passing_grade: boolean;
  // ── گام ۳: سنوات، غیبت، اعتراض ──
  count_summer_in_tenure: boolean;
  absence_ratio_numerator: number;
  absence_ratio_denominator: number;
  absence_auto_zero: boolean;
  absence_excused_policy: 'DROP_FROM_TERM' | 'NO_EFFECT';
  grade_objection_window_days: number;
  grade_objection_explicit_deadline: string;
  // ── گام ۴: تحصیلات تکمیلی ──
  comprehensive_exam_required: boolean;
  comprehensive_exam_min_gpa: number;
  comprehensive_exam_pass_grade: number;
  comprehensive_exam_max_attempts: number;
  comprehensive_exam_language_required: boolean;
  comprehensive_exam_alternatives: string[];
  thesis_grade_mode: 'QUALITATIVE' | 'NUMERIC';
  thesis_qualitative_labels: string[];
  proposal_deadline_semester: number;
  supervisor_deadline_semester: number;
  graduation_date_source: 'DEFENSE_DATE' | 'MANUAL';
  // ── گام ۵: معادلسازی (مادهٔ ۱۲ + اصلاحیهٔ ۲/۱۵۵۶۵۵) ──
  equiv_min_grade: number;
  equiv_term_units: number;
  equiv_max_years: number;
  equiv_clock_anchor: 'EXIT_DATE' | 'COURSE_PASS_DATE';
  equiv_notification_date: string;
  equiv_transition_entry_years: number[];
  equiv_cap_percent: number;
  equiv_cap_statuses: string[];
  equiv_allow_over_max_years_if_curriculum_unchanged: boolean;
  equiv_require_destination_confirmation: boolean;
  equiv_quality_coefficient_required: boolean;
  equiv_official_degree_exclusion: boolean;
  equiv_form_templates: Record<string, string>;
}

export type ComplianceKey = keyof ComplianceValues;

export type Guard = 'BINDING' | 'CONFIGURABLE';
export type PolicyKind = 'number' | 'boolean' | 'enum' | 'text' | 'list' | 'map';

export interface PolicyDef {
  key: ComplianceKey;
  label: string;
  group: string;
  kind: PolicyKind;
  guard: Guard | ((family: RegulationFamily, ctx: ComplianceContext) => Guard);
  /** مستند قانونی — در پنل مدیر نمایش داده میشود تا تغییر، آگاهانه باشد */
  reference: string;
  help: string;
  options?: readonly string[];
  min?: number;
  max?: number;
  /** فقط برای این خانوادهٔ آییننامه «قانون لازمالاجرا» محسوب میشود */
  bindingFamilies?: readonly RegulationFamily[];
}

export const COMPLIANCE_GROUPS = [
  'گام ۱ · معدل، فراغت و پذیرش',
  'گام ۲ · یکسانسازی پیکربندی',
  'گام ۳ · سنوات، غیبت و اعتراض',
  'گام ۴ · تحصیلات تکمیلی',
  'گام ۵ · معادلسازی (مادهٔ ۱۲)',
] as const;

/** کاتالوگ سیاستها — هم اعتبارسنجی، هم رابط مدیر، هم مستند قانونی از اینجاست. */
export const POLICY_DEFS: readonly PolicyDef[] = [
  // ── گام ۱ ──
  { key: 'failed_course_gpa_policy', label: 'سیاست نمرهٔ مردودی در معدل کل', group: COMPLIANCE_GROUPS[0], kind: 'enum', guard: (family, ctx) => (family === 'REG_1402' || (ctx?.entryYear ?? 0) >= 1402 ? 'BINDING' : 'CONFIGURABLE'), options: FAILED_COURSE_POLICIES, reference: 'مادهٔ ۱۱ + بخشنامهٔ ۲/۲۱/۲۸۳۴۲۸ (۱۴۰۳/۱۰/۱۶) و دادنامهٔ ۲۱۵۶۰۳۱ هیئت عمومی دیوان عدالت اداری', help: 'نمرهٔ مردودی در ریزنمرات و میانگین نیمسال میماند، ولی در معدل کل هیچ اثری ندارد. برای ورودیهای قدیمی (مادهٔ ۵۳) سیاست آییننامهٔ خودشان حفظ میشود.' },
  { key: 'grad_min_gpa', label: 'حداقل معدل کل برای فراغت', group: COMPLIANCE_GROUPS[0], kind: 'number', guard: 'BINDING', min: 0, max: 20, reference: 'مواد ۲۴ (۱۲)، ۳۷ (۱۴) و ۴۹ (۱۶)', help: 'کاردانی/کارشناسی ۱۲ · کارشناسی ارشد ۱۴ · دکتری تخصصی ۱۶. جایگزین تنظیم سراسری GRAD_MIN_GPA.' },
  { key: 'max_total_probations', label: 'سقف مشروطی متناوب', group: COMPLIANCE_GROUPS[0], kind: 'number', guard: 'BINDING', min: 1, max: 12, reference: 'مادهٔ ۱۶ (۲ برای کاردانی/ناپیوسته، ۳ برای کارشناسی پیوسته)', help: 'پیشفرض کد قبلاً ۴ بود؛ اکنون بر اساس گروه مقطع ۲ یا ۳ است.' },
  { key: 'regulation_resolution', label: 'روش تعیین آییننامه در پذیرش', group: COMPLIANCE_GROUPS[0], kind: 'enum', guard: 'BINDING', options: ['SMART', 'FIRST_ROW'], reference: 'مادهٔ ۵۳', help: 'SMART = سال ورود + مقطع + دانشگاه + بازهٔ اثر. FIRST_ROW = رفتار قدیمی (اولین ردیف جدول)، فقط برای عیبیابی.' },
  { key: 'probation_gpa_threshold', label: 'مرز معدل مشروطی', group: COMPLIANCE_GROUPS[0], kind: 'number', guard: 'CONFIGURABLE', min: 0, max: 20, reference: 'مواد ۱۵، ۳۱، ۴۳', help: '۱۲ برای کاردانی/کارشناسی · ۱۴ ارشد · ۱۶ دکتری.' },
  { key: 'default_passing_grade', label: 'کف نمرهٔ قبولی درس', group: COMPLIANCE_GROUPS[0], kind: 'number', guard: 'CONFIGURABLE', min: 0, max: 20, reference: 'مواد ۱۰، ۲۹، ۴۰', help: '۱۰ / ۱۲ / ۱۴ بر حسب مقطع؛ مبنای پیشنیازها و تجمیع معدل.' },
  // ── گام ۲ ──
  { key: 'seed_1402_graduate_regulations', label: 'ایجاد خودکار ردیفهای ۱۴۰۲ ارشد/دکتری', group: COMPLIANCE_GROUPS[1], kind: 'boolean', guard: 'CONFIGURABLE', reference: 'مادهٔ ۵۳', help: 'اگر ردیف ۱۴۰۲ مقطعی وجود نداشته باشد، موتور از پریست قانونی استفاده میکند؛ با این گزینه ردیفها هم در دیتابیس ساخته میشوند.' },
  { key: 'single_source_passing_grade', label: 'یک منبع حقیقت برای کف قبولی', group: COMPLIANCE_GROUPS[1], kind: 'boolean', guard: 'CONFIGURABLE', reference: 'P1-۱ ممیزی', help: 'روشن = پیشنیازها کف قبولی را از سیاست انطباق میگیرند نه degree_level_configs.' },
  // ── گام ۳ ──
  { key: 'count_summer_in_tenure', label: 'شمردن نیمسال تابستان در سنوات', group: COMPLIANCE_GROUPS[2], kind: 'boolean', guard: 'BINDING', reference: 'تبصرهٔ ۵ مادهٔ ۱۷', help: 'پیشفرض خاموش: بازهٔ تابستان نیمسال محسوب نمیشود و سقف سنوات را جابهجا نمیکند.' },
  { key: 'absence_ratio_numerator', label: 'صورت کسر غیبت مجاز', group: COMPLIANCE_GROUPS[2], kind: 'number', guard: 'CONFIGURABLE', min: 0, max: 100, reference: 'مادهٔ ۷ (بند ۳/۱۶)', help: 'تعداد جلسات غیبتی که از آن پس نمره صفر میشود.' },
  { key: 'absence_ratio_denominator', label: 'مخرج کسر غیبت مجاز', group: COMPLIANCE_GROUPS[2], kind: 'number', guard: 'CONFIGURABLE', min: 1, max: 200, reference: 'مادهٔ ۷ (بند ۳/۱۶)', help: 'مبنای ۱۶ جلسه؛ قابل تغییر برای دورههای فشرده.' },
  { key: 'absence_auto_zero', label: 'اعمال خودکار نمرهٔ صفر هنگام تجاوز از حد غیبت', group: COMPLIANCE_GROUPS[2], kind: 'boolean', guard: 'BINDING', reference: 'مادهٔ ۷', help: 'هشدار ظاهری بهتنهایی کافی نیست؛ ثبت حضور، نمرهٔ نهایی درس را صفر میکند.' },
  { key: 'absence_excused_policy', label: 'رفتار غیبت موجه', group: COMPLIANCE_GROUPS[2], kind: 'enum', guard: 'CONFIGURABLE', options: ['DROP_FROM_TERM', 'NO_EFFECT'], reference: 'مادهٔ ۷ تبصره', help: 'DROP_FROM_TERM = درس از مجموع واحدهای نیمسال حذف میشود.' },
  { key: 'grade_objection_window_days', label: 'مهلت اعتراض به نمره (روز)', group: COMPLIANCE_GROUPS[2], kind: 'number', guard: 'BINDING', min: 1, max: 90, reference: 'مادهٔ ۸', help: '۱۰ روز کاردانی/کارشناسی · ۲۰ روز ارشد/دکتری، از تاریخ اعلام نمرهٔ نهایی.' },
  { key: 'grade_objection_explicit_deadline', label: 'مهلت صریح سراسری (YYYY-MM-DD)', group: COMPLIANCE_GROUPS[2], kind: 'text', guard: 'CONFIGURABLE', reference: 'مادهٔ ۸', help: 'سازگاری با تنظیم قدیمی GRADE_OBJECTION_DEADLINE؛ اگر پر باشد بر پنجرهٔ مقطعی مقدم است. خالی = محاسبهٔ خودکار.' },
  // ── گام ۴ ──
  { key: 'comprehensive_exam_required', label: 'الزام ارزیابی جامع دکتری', group: COMPLIANCE_GROUPS[3], kind: 'boolean', guard: 'BINDING', reference: 'مادهٔ ۴۱', help: 'روشن = دروازهٔ فراغت دکتری بدون ارزیابی جامع عبور نمیکند.' },
  { key: 'comprehensive_exam_min_gpa', label: 'معدل کل لازم برای ورود به جامع', group: COMPLIANCE_GROUPS[3], kind: 'number', guard: 'BINDING', min: 0, max: 20, reference: 'مادهٔ ۴۱', help: 'پیشفرض ۱۶.' },
  { key: 'comprehensive_exam_pass_grade', label: 'نمرهٔ قبولی ارزیابی جامع', group: COMPLIANCE_GROUPS[3], kind: 'number', guard: 'BINDING', min: 0, max: 20, reference: 'مادهٔ ۴۱', help: 'پیشفرض ۱۶.' },
  { key: 'comprehensive_exam_max_attempts', label: 'حداکثر دفعات شرکت در جامع', group: COMPLIANCE_GROUPS[3], kind: 'number', guard: 'BINDING', min: 1, max: 10, reference: 'مادهٔ ۴۱ (فقط یک بار تجدید)', help: 'پیشفرض ۲ (یک بار اصلی + یک تجدید).' },
  { key: 'comprehensive_exam_language_required', label: 'احراز بسندگی زبان پیش از جامع', group: COMPLIANCE_GROUPS[3], kind: 'boolean', guard: 'CONFIGURABLE', reference: 'مادهٔ ۴۱', help: 'در صورت نبود سند زبان، مجوز شرکت صادر نمیشود.' },
  { key: 'comprehensive_exam_alternatives', label: 'جایگزینهای مادهٔ ۴۴', group: COMPLIANCE_GROUPS[3], kind: 'list', guard: 'CONFIGURABLE', reference: 'مادهٔ ۴۴', help: 'فهرست کدهای جایگزین (مثلاً GPA_18، ARTICLE_ISI، PATENT) که با تأیید دانشگاه جای تجدید جامع را میگیرند. با ویرگول جدا کنید.' },
  { key: 'thesis_grade_mode', label: 'مقیاس نمرهٔ پایاننامه/رساله', group: COMPLIANCE_GROUPS[3], kind: 'enum', guard: 'BINDING', options: ['QUALITATIVE', 'NUMERIC'], reference: 'مواد ۳۶ و ۴۸', help: 'پیشفرض کیفی و خارج از معدل؛ مطابق آییننامه.' },
  { key: 'thesis_qualitative_labels', label: 'درجات کیفی پایاننامه/رساله', group: COMPLIANCE_GROUPS[3], kind: 'list', guard: 'CONFIGURABLE', reference: 'مواد ۳۶ و ۴۸', help: 'با ویرگول جدا کنید؛ ترتیب از بالاترین درجه به مردود.' },
  { key: 'proposal_deadline_semester', label: 'آخرین نیمسال تصویب پیشنهاده', group: COMPLIANCE_GROUPS[3], kind: 'number', guard: 'CONFIGURABLE', min: 1, max: 20, reference: 'مواد ۳۳ و ۴۵', help: 'شمارهٔ نیمسال تحصیلی؛ پیشفرض ۲ (ارشد) / ۴ (دکتری).' },
  { key: 'supervisor_deadline_semester', label: 'آخرین نیمسال معرفی استاد راهنما', group: COMPLIANCE_GROUPS[3], kind: 'number', guard: 'CONFIGURABLE', min: 1, max: 20, reference: 'مواد ۳۲ و ۴۵', help: 'شمارهٔ نیمسال تحصیلی.' },
  { key: 'graduation_date_source', label: 'مبنای تاریخ دانشآموختگی', group: COMPLIANCE_GROUPS[3], kind: 'enum', guard: 'BINDING', options: ['DEFENSE_DATE', 'MANUAL'], reference: 'مواد ۳۸ و ۵۰', help: 'DEFENSE_DATE = تاریخ دفاع، تاریخ دانشآموختگی است.' },
  // ── گام ۵ ──
  { key: 'equiv_min_grade', label: 'حداقل نمرهٔ قابل معادلسازی', group: COMPLIANCE_GROUPS[4], kind: 'number', guard: 'BINDING', min: 0, max: 20, reference: 'مادهٔ ۱۲ (الف) — ۱۲ / ۱۴ / ۱۶', help: 'کاردانی و کارشناسی ۱۲ · ارشد ۱۴ · دکتری تخصصی ۱۶.' },
  { key: 'equiv_term_units', label: 'واحدهای هر نیمسال معادلسازی', group: COMPLIANCE_GROUPS[4], kind: 'number', guard: 'BINDING', min: 1, max: 60, reference: 'مادهٔ ۱۲ (هر ۲۰ واحد / ارشد ۱۳ واحد)', help: 'هر ۲۰ واحد (ارشد ۱۳) یک نیمسال معادلسازی و یک ترم کسر از سنوات.' },
  { key: 'equiv_max_years', label: 'حداکثر فاصلهٔ زمانی مجاز (سال)', group: COMPLIANCE_GROUPS[4], kind: 'number', guard: 'BINDING', min: 0, max: 40, reference: 'مادهٔ ۱۲ (الف) اصلاحی — ۵ سال', help: 'قابل اعمال فقط وقتی مبدأ ثبت شده باشد.' },
  { key: 'equiv_clock_anchor', label: 'مبدأ محاسبهٔ پنج سال', group: COMPLIANCE_GROUPS[4], kind: 'enum', guard: 'BINDING', options: ['EXIT_DATE', 'COURSE_PASS_DATE'], reference: 'اصلاحیهٔ ۲/۱۵۵۶۵۵ (۱۴۰۲/۰۶/۲۷)', help: 'EXIT_DATE = «از زمان انصراف یا اخراج دانشجو در دورهٔ قبلی» (قانون جاری).' },
  { key: 'equiv_notification_date', label: 'تاریخ ابلاغ اصلاحیه (مرز گذار)', group: COMPLIANCE_GROUPS[4], kind: 'text', guard: 'BINDING', reference: 'ابلاغیهٔ ۲/۱۵۵۶۵۵ — ۱۴۰۲/۰۶/۲۷', help: 'برای ورودیهای ۱۴۰۳-۱۴۰۲ و ۱۴۰۴-۱۴۰۳ فقط دروس گذراندهنشده تا این تاریخ مشمول قاعدهٔ گذاراند.' },
  { key: 'equiv_transition_entry_years', label: 'سالهای ورود مشمول قاعدهٔ گذار', group: COMPLIANCE_GROUPS[4], kind: 'list', guard: 'BINDING', reference: 'اصلاحیهٔ مادهٔ ۱۲، بند ۲', help: 'پیشفرض ۱۴۰۲ و ۱۴۰۳ (یعنی ورودیهای ۱۴۰۳-۱۴۰۲ و ۱۴۰۴-۱۴۰۳). با ویرگول جدا کنید.' },
  { key: 'equiv_cap_percent', label: 'سقف معادلسازی برای انصرافی/اخراجی (درصد)', group: COMPLIANCE_GROUPS[4], kind: 'number', guard: 'BINDING', min: 0, max: 100, reference: 'مادهٔ ۱۲ بند ۴ — ۵۰٪', help: 'فقط برای WITHDRAWN / EXPELLED؛ تغییر رشته و انتقالی بدون سقفاند.' },
  { key: 'equiv_cap_statuses', label: 'وضعیتهای مشمول سقف ۵۰٪', group: COMPLIANCE_GROUPS[4], kind: 'list', guard: 'BINDING', reference: 'مادهٔ ۱۲ بند ۴', help: 'پیشفرض WITHDRAWN,EXPELLED.' },
  { key: 'equiv_allow_over_max_years_if_curriculum_unchanged', label: 'استثنای بیش از ۵ سال با عدم تغییر برنامهٔ درسی', group: COMPLIANCE_GROUPS[4], kind: 'boolean', guard: 'BINDING', reference: 'تبصرهٔ الحاقی اصلاحیهٔ مادهٔ ۱۲', help: 'به شرط تأیید دانشگاه مقصد و ثبت نسخهٔ چارت بدون تغییر.' },
  { key: 'equiv_require_destination_confirmation', label: 'الزام تأیید دانشگاه مقصد (عدم تغییر محتوا)', group: COMPLIANCE_GROUPS[4], kind: 'boolean', guard: 'CONFIGURABLE', reference: 'تبصرهٔ الحاقی اصلاحیهٔ مادهٔ ۱۲', help: 'فیلد ساختاریافتهای روی پروندهٔ دانشجو ثبت میشود.' },
  { key: 'equiv_quality_coefficient_required', label: 'اعمال ضریب کیفیت دانشگاه/رشته (ج)', group: COMPLIANCE_GROUPS[4], kind: 'boolean', guard: 'BINDING', reference: 'مادهٔ ۱۲ (ج)', help: 'ضریب کیفیت بهعنوان دادهٔ ساختاریافته بررسی میشود.' },
  { key: 'equiv_official_degree_exclusion', label: 'منع معادلسازی از دورهٔ منتهی به مدرک رسمی (ب)', group: COMPLIANCE_GROUPS[4], kind: 'boolean', guard: 'BINDING', reference: 'مادهٔ ۱۲ (ب)', help: 'دروسی که پیشتر مدرک رسمی با آنها صادر شده قابل معادلسازی مجدد نیستند.' },
  { key: 'equiv_form_templates', label: 'قالبهای فرمهای آموزشی', group: COMPLIANCE_GROUPS[4], kind: 'map', guard: 'CONFIGURABLE', reference: 'مواد ۲۰، ۲۱، ۲۲ و فرمهای اداری', help: 'نگاشت کد فرم → عنوان قالب: مرخصی، انصراف، تغییر رشته/انتقال، استاد مشاور. فرمت JSON.' },
] as const;

export const POLICY_BY_KEY: Readonly<Record<ComplianceKey, PolicyDef>> =
  Object.fromEntries(POLICY_DEFS.map(d => [d.key, d])) as Readonly<Record<ComplianceKey, PolicyDef>>;

// ════════════════════════════════════════════════════════════════════════════
//  پیشفرضهای قانونی
// ════════════════════════════════════════════════════════════════════════════

export interface ComplianceContext {
  family: RegulationFamily;
  level: ComplianceLevel;
  entryYear: number;
  /** سیاست قدیمی ثبتشده در rulesConfig (فقط برای آییننامههای پیش از ۱۴۰۲) */
  legacyFailedPolicy?: FailedCoursePolicy | null;
  universityId?: number | null;
  regulationId?: number | null;
  degreeLevelId?: number | null;
}

const DEFAULT_FORM_TEMPLATES: Record<string, string> = {
  LEAVE: 'فرم درخواست مرخصی تحصیلی',
  WITHDRAWAL: 'فرم انصراف از تحصیل',
  MAJOR_CHANGE: 'فرم تغییر رشته',
  TRANSFER: 'فرم انتقال / تغییر رشته توأم با انتقال',
  ADVISOR: 'فرم معرفی استاد مشاور',
};

/** مقادیری که قانون تعیین کرده — تابع مقطع، سال ورود و خانوادهٔ آییننامه. */
export function legalDefaults(ctx: ComplianceContext): ComplianceValues {
  const graduate = ctx.level === 'MS' || ctx.level === 'PHD';
  const phd = ctx.level === 'PHD';
  const short = ctx.level === 'SHORT';
  // مادهٔ ۱۱ + بخشنامهٔ ۲/۲۱/۲۸۳۴۲۸: از تاریخ تصویب، نمرات مردودی نباید در معدل کل
  // محاسبه شوند. این حکم کل «عصر آیین‌نامهٔ ۱۴۰۲» (ورودی ≥ ۱۴۰۲) را دربرمی‌گیرد،
  // نه فقط دانشجویانی که ردیف آیین‌نامهٔ ۱۴۰۲ به آن‌ها متصل است. ورودیهای پیش از
  // ۱۴۰۲ طبق مادهٔ ۵۳ سیاست آیین‌نامهٔ خودشان را حفظ می‌کنند.
  const is1402 = ctx.family === 'REG_1402' || ctx.entryYear >= 1402;

  const gradMin = ctx.level === 'SHORT' || ctx.level === 'LONG' ? 12 : ctx.level === 'MS' ? 14 : 16;
  const passing = ctx.level === 'SHORT' || ctx.level === 'LONG' ? 10 : ctx.level === 'MS' ? 12 : 14;
  const probation = ctx.level === 'SHORT' || ctx.level === 'LONG' ? 12 : ctx.level === 'MS' ? 14 : 16;

  return {
    failed_course_gpa_policy: is1402
      ? 'EXCLUDE_ALWAYS'
      : (ctx.legacyFailedPolicy ?? 'EXCLUDE_IF_PASSED'),
    grad_min_gpa: gradMin,
    max_total_probations: graduate ? 2 : short ? 2 : 3,
    regulation_resolution: 'SMART',
    probation_gpa_threshold: probation,
    default_passing_grade: passing,

    seed_1402_graduate_regulations: true,
    single_source_passing_grade: true,

    count_summer_in_tenure: false,
    absence_ratio_numerator: 3,
    absence_ratio_denominator: 16,
    absence_auto_zero: true,
    absence_excused_policy: 'DROP_FROM_TERM',
    grade_objection_window_days: graduate ? 20 : 10,
    grade_objection_explicit_deadline: '',

    comprehensive_exam_required: true,
    comprehensive_exam_min_gpa: 16,
    comprehensive_exam_pass_grade: 16,
    comprehensive_exam_max_attempts: 2,
    comprehensive_exam_language_required: true,
    comprehensive_exam_alternatives: ['GPA_18', 'ARTICLE_ISI', 'PATENT'],
    thesis_grade_mode: 'QUALITATIVE',
    thesis_qualitative_labels: ['عالی', 'خیلی خوب', 'خوب', 'قابل قبول', 'مردود'],
    proposal_deadline_semester: phd ? 4 : 2,
    supervisor_deadline_semester: phd ? 2 : 1,
    graduation_date_source: 'DEFENSE_DATE',

    equiv_min_grade: ctx.level === 'SHORT' || ctx.level === 'LONG' ? 12 : ctx.level === 'MS' ? 14 : 16,
    equiv_term_units: graduate ? 13 : 20,
    equiv_max_years: 5,
    equiv_clock_anchor: 'EXIT_DATE',
    equiv_notification_date: '1402/06/27',
    equiv_transition_entry_years: [1402, 1403],
    equiv_cap_percent: 50,
    equiv_cap_statuses: ['WITHDRAWN', 'EXPELLED'],
    equiv_allow_over_max_years_if_curriculum_unchanged: true,
    equiv_require_destination_confirmation: true,
    equiv_quality_coefficient_required: true,
    equiv_official_degree_exclusion: true,
    equiv_form_templates: { ...DEFAULT_FORM_TEMPLATES },
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  اعتبارسنجی و نرمالسازی — هیچ مقدار نامعتبری وارد موتور نمیشود
// ════════════════════════════════════════════════════════════════════════════

function asNumber(def: PolicyDef, v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (!Number.isFinite(n)) return null;
  const lo = def.min ?? -Infinity;
  const hi = def.max ?? Infinity;
  return Math.min(hi, Math.max(lo, n)); // clamp، نه رد کردن: پیکربندی ناقص نباید موتور را بشکند
}

function asList(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,،|\n\r]+/).map(s => s.trim()).filter(Boolean);
  return null;
}

function asMap(v: unknown): Record<string, string> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k) out[String(k).trim()] = String(val ?? '').trim();
    }
    return out;
  }
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    try { return asMap(JSON.parse(v)); } catch { return null; }
  }
  return null;
}

/** مقدار خامِ هر لایه را به نوعِ سیاست تبدیل میکند؛ null یعنی «این لایه معتبر نیست». */
export function normalizePolicyValue(def: PolicyDef, raw: unknown): ComplianceValues[ComplianceKey] | null {
  if (raw === undefined || raw === null || raw === '') return null;
  switch (def.kind) {
    case 'number': return asNumber(def, raw);
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const s = String(raw).trim().toLowerCase();
      if (['1', 'true', 'yes', 'on', 'بله'].includes(s)) return true;
      if (['0', 'false', 'no', 'off', 'خیر'].includes(s)) return false;
      return null;
    }
    case 'enum': {
      const s = String(raw).trim();
      return def.options?.includes(s) ? s : null;
    }
    case 'text': return String(raw).trim().slice(0, 200);
    case 'list': {
      const l = asList(raw);
      if (!l) return null;
      // فهرست سالها فقط اعداد معتبر میپذیرد
      if (def.key === 'equiv_transition_entry_years') {
        return l.map(Number).filter(n => Number.isFinite(n) && n > 1300 && n < 1500);
      }
      return l;
    }
    case 'map': return asMap(raw);
    default: return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  حلگر لایهای (Precedence + Provenance)
// ════════════════════════════════════════════════════════════════════════════

export type ComplianceSource = 'override' | 'regulation' | 'setting' | 'legal' | 'legal-guard';

export interface Provenance {
  source: ComplianceSource;
  /** مقداری که قانون میگوید (برای نمایش تعارض در پنل مدیر) */
  legal: unknown;
  /** لایهٔ ۲/۳ مقدار متفاوتی داشته ولی بهدلیل BINDING کنار گذاشته شد */
  legalConflict: boolean;
  /** مقدار خامی که کنار گذاشته شد */
  shadowed: unknown;
  /** آیا مقدار لایه نامعتبر بود و به لایهٔ بعد سقوط کردیم؟ */
  invalidLayers: ComplianceSource[];
}

export interface ComplianceLayers {
  /** اورراید صریح مدیر (همراه با دلیل، از جدول دامنهدار) */
  overrides?: Partial<Record<ComplianceKey, unknown>>;
  /** rulesConfig.compliance */
  regulation?: Partial<Record<ComplianceKey, unknown>>;
  /** system_settings قدیمی */
  settings?: Partial<Record<ComplianceKey, unknown>>;
}

export interface ResolvedCompliance {
  values: ComplianceValues;
  provenance: Readonly<Record<ComplianceKey, Provenance>>;
  context: ComplianceContext;
}

function guardOf(def: PolicyDef, ctx: ComplianceContext): Guard {
  const g = typeof def.guard === 'function' ? def.guard(ctx.family, ctx) : def.guard;
  return g;
}

/**
 * حلِ نهایی سیاستها. خالص و قطعی: همان ورودی همیشه همان خروجی میدهد.
 * وقتی هیچ اورراید/پیکربندی وجود نداشته باشد ⇒ دقیقاً پیشفرض قانونی، بدون
 * هیچ تغییر رفتاری برای آییننامههای قدیمی (مادهٔ ۵۳).
 */
export function resolveCompliance(ctx: ComplianceContext, layers: ComplianceLayers = {}): ResolvedCompliance {
  const legal = legalDefaults(ctx);
  const values = { ...legal } as ComplianceValues;
  const provenance = {} as Record<ComplianceKey, Provenance>;

  for (const def of POLICY_DEFS) {
    const key = def.key;
    const binding = guardOf(def, ctx) === 'BINDING';
    const invalidLayers: ComplianceSource[] = [];
    let shadowed: unknown = undefined;
    let conflict = false;

    const candidates: [ComplianceSource, unknown][] = binding
      ? [
          ['override', layers.overrides?.[key]],
          // لایههای ۲ و ۳ عمداً بعد از قانون میآیند تا نتوانند قانون را دور بزنند
          ['legal', legal[key]],
          ['regulation', layers.regulation?.[key]],
          ['setting', layers.settings?.[key]],
        ]
      : [
          ['override', layers.overrides?.[key]],
          ['regulation', layers.regulation?.[key]],
          ['setting', layers.settings?.[key]],
          ['legal', legal[key]],
        ];

    let chosenSource: ComplianceSource = 'legal';
    let chosen: unknown = legal[key];

    for (const [source, raw] of candidates) {
      if (source === 'legal') {
        const norm = normalizePolicyValue(def, raw) ?? legal[key];
        if (chosenSource === 'legal' && chosen === undefined) { chosen = norm; }
        continue;
      }
      if (raw === undefined || raw === null || raw === '') { continue; }
      const norm = normalizePolicyValue(def, raw);
      if (norm === null) { invalidLayers.push(source); continue; }
      if (binding && source !== 'override') {
        // پیکربندی کهنه/ناسازگار: ثبت میشود ولی اعمال نمیشود
        if (JSON.stringify(norm) !== JSON.stringify(legal[key])) {
          shadowed = norm; conflict = true;
        }
        continue;
      }
      chosen = norm;
      chosenSource = source;
      break;
    }

    (values as unknown as Record<string, unknown>)[key] = chosen;
    provenance[key] = {
      source: binding && chosenSource === 'legal' ? 'legal-guard' : chosenSource,
      legal: legal[key],
      legalConflict: conflict,
      shadowed,
      invalidLayers,
    };
  }

  return { values, provenance, context: ctx };
}

// ════════════════════════════════════════════════════════════════════════════
//  قواعد خالص derivation — موتورها فقط این توابع را صدا میزنند
// ════════════════════════════════════════════════════════════════════════════

/** آیا این کلید «قانون لازمالاجرا» است؟ (برای برچسب پنل مدیر) */
export function isBinding(def: PolicyDef, ctx: ComplianceContext): boolean {
  return guardOf(def, ctx) === 'BINDING';
}

/** تعداد نیمسالهای قابل شمارش برای سنوات (تابستان جدا میشود مگر اورراید صریح). */
export function countableSemesters(v: ComplianceValues, terms: readonly { isSummer?: boolean | null; isEquiv?: boolean | null }[]): number {
  return terms.filter(t => (t.isSummer ? v.count_summer_in_tenure : true) && !t.isEquiv).length;
}

export interface AbsenceInput {
  absences: number;
  totalSessions: number;
  excused: number;
  justifiedExcused: boolean;
}
export interface AbsenceVerdict {
  zeroGrade: boolean;
  dropFromTerm: boolean;
  threshold: number;
  reason: string;
}
/** مادهٔ ۷: نسبت ۳/۱۶ غیبت ⇒ نمرهٔ صفر؛ غیبت موجه ⇒ حذف درس از نیمسال. */
export function evaluateAbsence(v: ComplianceValues, input: AbsenceInput): AbsenceVerdict {
  const ratio = v.absence_ratio_numerator / Math.max(1, v.absence_ratio_denominator);
  const allowed = Math.floor(Math.max(1, input.totalSessions) * ratio);
  const effective = Math.max(0, input.absences - (input.justifiedExcused ? input.excused : 0));
  if (input.justifiedExcused && input.excused > 0) {
    return {
      zeroGrade: false,
      dropFromTerm: v.absence_excused_policy === 'DROP_FROM_TERM',
      threshold: allowed,
      reason: 'غیبت موجه تأیید شد → درس از مجموع واحدهای نیمسال حذف میشود (مادهٔ ۷).',
    };
  }
  const exceeded = effective > allowed;
  return {
    zeroGrade: exceeded && v.absence_auto_zero,
    dropFromTerm: false,
    threshold: allowed,
    reason: exceeded
      ? (v.absence_auto_zero ? `تجاوز از حد ${v.absence_ratio_numerator}/${v.absence_ratio_denominator} غیبت → نمرهٔ درس صفر (مادهٔ ۷).` : 'حد غیبت تجاوز شد؛ اعمال خودکار صفر خاموش است.')
      : '',
  };
}

/** مادهٔ ۸: پنجرهٔ اعتراض = تاریخ اعلام نمره + روزهای مقطعی، مگر مهلت صریح مدیر. */
export function gradeObjectionDeadline(v: ComplianceValues, gradeAnnouncedAt: Date | string | null): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v.grade_objection_explicit_deadline || '')) {
    const d = new Date(v.grade_objection_explicit_deadline + 'T23:59:59');
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (!gradeAnnouncedAt) return null;
  const base = gradeAnnouncedAt instanceof Date ? gradeAnnouncedAt : new Date(String(gradeAnnouncedAt));
  if (Number.isNaN(base.getTime())) return null;
  const d = new Date(base);
  d.setDate(d.getDate() + Math.max(1, v.grade_objection_window_days));
  d.setHours(23, 59, 59, 0);
  return d;
}

/** برچسب خوانا برای منبع یک مقدار (پنل مدیر). */
export const SOURCE_LABELS: Record<ComplianceSource, string> = {
  override: 'اورراید مدیر',
  regulation: 'پیکربندی آییننامه',
  setting: 'تنظیمات سراسری',
  legal: 'پیشفرض قانونی',
  'legal-guard': 'پیشفرض قانونی (محافظتشده)',
};

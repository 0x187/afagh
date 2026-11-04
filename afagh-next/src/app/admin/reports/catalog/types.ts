/**
 * ══════════════════════════════════════════════════════════════════════
 *  انواع کاتالوگ گزارش (Report Catalog)
 * ══════════════════════════════════════════════════════════════════════
 *  «کاتالوگ» تعیین می‌کند گزارش‌ساز چه چیزهایی را می‌تواند نشان دهد و
 *  روی چه چیزهایی می‌تواند فیلتر بگذارد. کاتالوگ در **کد** است، نه در دیتابیس.
 *
 *  🔒 چرا کاتالوگ در کد بماند؟
 *  دو دلیل، و هر دو امنیتی:
 *   ۱) عبارت‌های SQL از کاتالوگ می‌آیند و هرگز از ورودی کاربر ⇒ تزریق SQL
 *      از نظر معماری ممکن نیست (نه با escape، بلکه اصلاً راهی ندارد).
 *   ۲) اگر کاتالوگ داده بود، هر کسی که به جدول دسترسی داشت می‌توانست
 *      عبارت دلخواه تزریق کند. کاتالوگِ کدی یعنی «سطح حمله صفر».
 *
 *  مقدارِ فیلترها تنها چیزی است که کاربر تعیین می‌کند و همیشه به‌صورت
 *  bind parameter به موتور اجرا می‌رود (src/app/admin/reports/saved/engine.ts).
 */

export type ReportFieldType = 'text' | 'number' | 'money' | 'date' | 'datetime' | 'bool';

/** عملگرهای مجاز فیلتر — فهرست بسته است تا موتور اجرا بتواند روی آن‌ها تکیه کند */
export type FilterOp =
  | 'eq' | 'ne'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'like' | 'in' | 'between'
  | 'isnull' | 'notnull';

/** تجمیع‌هایی که کاربر می‌تواند روی یک ستون عددی انتخاب کند */
export type AggKind = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'count_distinct';

/**
 * منبعِ داده‌های گزارش (یک «جدولِ قابل گزارش» از نگاه گزارش‌ساز).
 * هر منبع یک FROM ثابت دارد؛ گزارش‌ساز فقط ستون‌ها و شرط‌هایش را می‌چیند.
 */
export interface ReportSource {
  /** کلید یکتا و پایدار (در saved_reports.sourceKey ذخیره می‌شود) */
  key: string;
  title: string;
  icon: string;
  description?: string;
  /** FROM + JOIN های ثابت و امن */
  baseFrom: string;
  /** نامِ ستونِ universityId برای اسکوپ fail-closed — مثلاً `sl."universityId"` */
  universityColumn: string;
  /**
   * اگر true باشد، اسکوپ دانشگاه به‌صورت «همین دانشگاه یا NULL» اعمال می‌شود
   * (برای جدول‌هایی که ستون دانشگاهشان nullable است و رکوردهای قدیمی
   * دانشگاه ندارند) — دقیقاً همان الگوی report-helpers.ts.
   */
  universityNullable?: boolean;
  /** شرطِ همیشه‌برقرار (مثلاً «فقط ردیف‌های مالی»). با AND به اسکوپ دانشگاه ترکیب می‌شود. */
  where?: string;
  fields: ReportField[];
  /**
   * کلیدهای گروه‌بندیِ طبیعیِ منبع — وقتی کاربر یک ستون تجمیعی انتخاب می‌کند،
   * این‌ها خودکار به GROUP BY اضافه می‌شوند تا هر گروه یک ردیف بدهد.
   */
  groupKeys?: string[];
  /** نقش‌هایی که این منبع را می‌بینند */
  roles?: string[];
  /** سقف سختِ تعداد ردیفِ بازگشتی (محافظِ سرور در برابر گزارش‌های سنگین) */
  maxRows?: number;
}

/** یک ستونِ قابل انتخاب در گزارش‌ساز */
export interface ReportField {
  /** کلید یکتا درونِ منبع — همان چیزی که در config ذخیره می‌شود */
  key: string;
  title: string;
  /** عبارت SQL سطح-ردیف — فقط از کاتالوگ می‌آید */
  sql: string;
  /**
   * عبارت تجمیعیِ صریح (برای مواردی مثل SUM FILTER که با SUM ساده فرق دارد).
   * اگر set باشد، این فیلد «تجمیعی» است و فقط در حالت گروه‌بندی معتبر است.
   */
  aggSql?: string;
  /** تجمیع‌هایی که کاربر می‌تواند روی این ستون انتخاب کند */
  agg?: AggKind[];
  type?: ReportFieldType;
  /** قالب نمایش (تاریخ شمسی / مبلغ / عدد) — در report-format تفسیر می‌شود */
  format?: 'DATE' | 'DATETIME' | 'MONEY' | 'NUMBER';
  /** قابل فیلتر بودن */
  filterable?: boolean;
  /** عملگرهای مجاز برای این فیلد (پیش‌فرض: بر اساس type) */
  ops?: FilterOp[];
  /** قابل گروه‌بندی بودن */
  groupable?: boolean;
  /** گزینه‌های ثابت برای فیلترِ انتخابی */
  options?: { value: string; label: string }[];
  /** گزینه‌های پویا — در صفحهٔ گزارش‌ساز از سرور پر می‌شود */
  ref?: OptionRef;
  /** راهنمای کوتاه زیر عنوان در پالت فیلدها */
  hint?: string;
}

/** منابعِ گزینه‌های پویا که صفحهٔ گزارش‌ساز از سرور می‌گیرد */
export type OptionRef =
  | 'terms'             // نیمسال‌های تحصیلی
  | 'financialTerms'    // نیمسال‌های مالی
  | 'ledgerTypes'       // ۱۷ نوع تراکنش دفتر مالی
  | 'depositTypes'      // انواع واریز
  | 'paymentStatuses'   // وضعیت پرداخت درگاه
  | 'faculties'         // دانشکده‌ها
  | 'majors';           // رشته‌ها

/** پیکربندیِ ذخیره‌شدهٔ یک گزارش */
export interface SavedReportConfig {
  /** ستون‌های انتخاب‌شده به‌همراه عنوان/قالبِ اختیاری */
  columns: { field: string; alias?: string; format?: 'DATE' | 'DATETIME' | 'MONEY' | 'NUMBER'; agg?: AggKind }[];
  /** شرط‌ها */
  filters: { field: string; op: FilterOp; value?: string | string[] }[];
  /** کلیدِ فیلدهایی که کاربر خواسته گروه‌بندی کند */
  groupBy?: string[];
  /** ترتیب نتیجه */
  orderBy?: { field: string; dir: 'asc' | 'desc' }[];
}

/** دامنهٔ دیده‌شدنِ گزارش ذخیره‌شده */
export type ReportVisibility = 'PRIVATE' | 'ROLE' | 'PUBLIC';

/**
 * شکلِ سریال‌شدهٔ یک منبع برای ارسال به کلاینت.
 * (بدون هیچ تابعی — تا به‌سادگی از مرز سرور/کلاینت عبور کند)
 */
export type SourceMeta = {
  key: string;
  title: string;
  icon: string;
  description?: string;
  fields: {
    key: string;
    title: string;
    type?: ReportFieldType;
    format?: 'DATE' | 'DATETIME' | 'MONEY' | 'NUMBER';
    filterable?: boolean;
    ops?: FilterOp[];
    groupable?: boolean;
    agg?: AggKind[];
    /**
     * true یعنی این ستون «محاسبهٔ ثابت» دارد (مثل «ماندهٔ بدهی») و خودش
     * تجمیعی است ⇒ کاربر روی آن تجمیعِ دیگری انتخاب نمی‌کند.
     */
    hasFixedAgg?: boolean;
    options?: { value: string; label: string }[];
    ref?: OptionRef;
    hint?: string;
  }[];
};

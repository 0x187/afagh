import 'server-only';
import { inArray } from 'drizzle-orm';
import { toJalaliFromDate } from '@/lib/calendar';
import { db } from '@/db';
import { system_settings } from '@/db/schema';

// ════════════════════════════════════════════════════════════════════
//  پیکربندی متمرکز سامانه — هیچ مقداری در کد هارد‌کد نیست
//
//  ترتیب اولویت خواندن هر مقدار:
//      ۱) جدول system_settings در دیتابیس   ← قابل تغییر از پنل مدیر (وب)
//      ۲) متغیر محیطی (ENV)                 ← قابل تغییر در .env / docker
//      ۳) مقدار پیش‌فرض تعریف‌شده در همین فایل
//
//  مقادیر «زیرساختی» (اتصال دیتابیس/Redis/MinIO) فقط از ENV خوانده می‌شوند،
//  چون پیش از برقراری اتصال به دیتابیس لازم‌اند.
// ════════════════════════════════════════════════════════════════════

export type SettingType = 'text' | 'textarea' | 'url' | 'number' | 'boolean' | 'secret' | 'image' | 'select';

export interface SettingDef {
  key: string;
  env: string;
  group: string;
  label: string;
  type: SettingType;
  default: string;
  help?: string;
  /** فقط از ENV خوانده می‌شود (در پنل وب فقط نمایش داده می‌شود) */
  envOnly?: boolean;
  /** گزینه‌های مجاز برای type === 'select' — مقدارِ خارج از این فهرست ذخیره نمی‌شود */
  options?: { value: string; label: string }[];
}

export const SETTING_GROUPS = [
  'عمومی و نشانی‌ها',
  'کلاس مجازی (BBB / Moodle)',
  'پیامک و ربات‌های پیام‌رسان',
  'درگاه پرداخت',
  'شهریه و امور مالی',
  'سرویس‌های استعلام دولتی',
  'فارغ‌التحصیلی و صدور مدارک',
  'گردش کار و حق‌التدریس',
  'ارزشیابی و هوش تجاری',
  'حضور و غیاب کلاس‌ها',
  'ساعت کلاس و برنامه‌ریزی',
  'امضاکنندگان فرمها و اسناد',
  'زیرساخت (فقط ENV)',
] as const;

export const SETTING_DEFS: SettingDef[] = [
  // ── عمومی ──
  { key: 'UNIVERSITY_NAME', env: 'AFAGH_UNIVERSITY_NAME', group: 'عمومی و نشانی‌ها', label: 'نام دانشگاه', type: 'text', default: 'دانشگاه آفاق' },
  { key: 'UNIVERSITY_NAME_EN', env: 'AFAGH_UNIVERSITY_NAME_EN', group: 'عمومی و نشانی‌ها', label: 'نام انگلیسی دانشگاه', type: 'text', default: '', help: 'در سربرگ گواهینامه‌ها؛ خالی = نمایش داده نمی‌شود' },
  { key: 'ENROLLMENT_WINDOW_OPEN', env: 'AFAGH_ENROLLMENT_WINDOW_OPEN', group: 'عمومی و نشانی‌ها', label: 'باز بودن پنجرهٔ انتخاب واحد', type: 'boolean', default: 'true', help: 'کلید دستی مدیر — خاموش = دانشجو نمی‌تواند انتخاب واحد/حذف و اضافه کند (مستقل از تاریخ‌های ترم)' },
  { key: 'ENROLL_REQUIRE_CURRICULUM_CHART', env: 'AFAGH_ENROLL_REQUIRE_CURRICULUM_CHART', group: 'عمومی و نشانی‌ها', label: 'الزام چارت تحصیلی مصوب در انتخاب واحد', type: 'boolean', default: 'true', help: 'روشن = دانشجو فقط دروسِ چارت مصوب رشته/مقطع/ورودی خود را می‌بیند و اگر چارتی منتشر نشده باشد کاتالوگ خالی می‌شود (ارجاع به مدیر گروه). خاموش = کاتالوگ بر اساس هدف‌گیریِ رشته و ورودیِ هر ارائه نمایش داده می‌شود و در زمان ارائه، تعیین رشته و بازهٔ ورودیِ مجاز الزامی می‌گردد.' },
  { key: 'EMERGENCY_WITHDRAW_OPEN', env: 'AFAGH_EMERGENCY_WITHDRAW_OPEN', group: 'عمومی و نشانی‌ها', label: 'فعال بودن حذف اضطراری', type: 'boolean', default: 'false', help: 'کلید دستی مدیر — فقط در بازهٔ مجاز حذف اضطراری روشن شود (پیش‌فرض خاموش تا دکمهٔ «حذف اضطراری» همیشه در دسترس نباشد و سوءاستفاده نشود)' },
  { key: 'ENROLL_EXPERT_OVERRIDE', env: 'AFAGH_ENROLL_EXPERT_OVERRIDE', group: 'عمومی و نشانی‌ها', label: 'مجاز بودن نادیده‌گرفتن آیین‌نامه توسط کارشناس', type: 'boolean', default: 'true', help: 'کارشناس آموزش هنگام ثبت‌نام به‌جای دانشجو می‌تواند پیش‌نیاز/ظرفیت/سقف واحد را نادیده بگیرد (با ثبت دلیل)؛ خاموش = فقط ثبت بدون نادیده‌گرفتن' },
  { key: 'ENFORCE_TERM_ACTIVATION', env: 'AFAGH_ENFORCE_TERM_ACTIVATION', group: 'عمومی و نشانی‌ها', label: 'اجباری بودن «فعال‌سازی ترم» برای انتخاب واحد', type: 'boolean', default: 'false', help: 'روشن = دانشجو فقط اگر در student_term_states برای همان ترم ACTIVE باشد می‌تواند انتخاب واحد کند (اول باید توسط کارشناس/مدیر فعال شود)' },
  { key: 'UNIVERSITY_LOGO', env: 'AFAGH_UNIVERSITY_LOGO', group: 'عمومی و نشانی‌ها', label: 'ارم پیش‌فرض سراسری (لوگو)', type: 'image', default: '', help: 'فقط وقتی دانشگاهی ارم اختصاصی نداشته باشد — PNG/JPG تا ۲ مگابایت' },
  { key: 'PUBLIC_BASE_URL', env: 'AFAGH_PUBLIC_BASE_URL', group: 'عمومی و نشانی‌ها', label: 'نشانی عمومی سامانه', type: 'url', default: 'http://localhost:8080', help: 'مبنای لینک‌های استعلام مدرک، QR کارت ورود به جلسه و ایمیل‌ها' },
  { key: 'SUPPORT_EMAIL', env: 'AFAGH_SUPPORT_EMAIL', group: 'عمومی و نشانی‌ها', label: 'ایمیل پشتیبانی', type: 'text', default: 'support@example.ac.ir' },
  { key: 'SUPPORT_PHONE', env: 'AFAGH_SUPPORT_PHONE', group: 'عمومی و نشانی‌ها', label: 'تلفن پشتیبانی', type: 'text', default: '' },

  // ── امضاکنندگان فرمها و اسناد ──
  // هر «فرم» جایگاه امضای خودش را دارد تا مدیر بتواند عناوین سازمانی
  // (مثلاً «معاون مالی» بهجای «مدیر مالی») را بدون تغییر کد عوض کند.
  // جداکننده: | یا ویرگول یا سطر جدید؛ خالی = بدون ردیف امضا.
  {
    key: 'SIGNERS_FINANCE_REPORTS', env: 'AFAGH_SIGNERS_FINANCE_REPORTS',
    group: 'امضاکنندگان فرمها و اسناد', label: 'امضاکنندگان گزارشهای مالی', type: 'text',
    default: 'تهیهکنندهٔ گزارش | تأیید حسابدار | مدیر مالی',
    help: 'عنوان جایگاههای امضای زیرِ برگههای گزارشهای مالی — با | یا ویرگول جدا کنید (حداکثر ۶ جایگاه)؛ خالی = بدون امضا',
  },
  {
    key: 'SIGNERS_EDU_REPORTS', env: 'AFAGH_SIGNERS_EDU_REPORTS',
    group: 'امضاکنندگان فرمها و اسناد', label: 'امضاکنندگان گزارشهای آموزشی', type: 'text',
    default: 'تهیهکنندهٔ گزارش | کارشناس آموزش | معاون آموزشی',
    help: 'عنوان جایگاههای امضای زیرِ برگههای گزارشهای آموزشی — با | یا ویرگول جدا کنید',
  },
  {
    key: 'SIGNERS_TRANSCRIPT', env: 'AFAGH_SIGNERS_TRANSCRIPT',
    group: 'امضاکنندگان فرمها و اسناد', label: 'امضاکنندگان کارنامه / ریزنمرات', type: 'text',
    default: 'مسئول ثبت نمرات | کارشناس آموزش | معاون آموزشی',
    help: 'برای کارنامهها و ریزنمرات چاپی — با | یا ویرگول جدا کنید',
  },
  {
    key: 'SIGNERS_CERTIFICATES', env: 'AFAGH_SIGNERS_CERTIFICATES',
    group: 'امضاکنندگان فرمها و اسناد', label: 'امضاکنندگان گواهیها و تاییدیهها', type: 'text',
    default: 'کارشناس صدور مدرک | مدیر امور دانشجویی',
    help: 'برای گواهی اشتغال به تحصیل، تاییدیه تحصیلی و پایان تحصیلات — با | یا ویرگول جدا کنید',
  },
  {
    key: 'SIGNERS_CUSTOM_REPORTS', env: 'AFAGH_SIGNERS_CUSTOM_REPORTS',
    group: 'امضاکنندگان فرمها و اسناد', label: 'امضاکنندگان گزارشهای ساختهای گزارشساز', type: 'text',
    default: 'تهیهکنندهٔ گزارش | تأیید کارشناس | مدیر واحد',
    help: 'برای گزارشهای دلخواه ساختهشده در «گزارشساز» و «گزارشهای ذخیرهشده» — با | یا ویرگول جدا کنید',
  },
  {
    key: 'SIGNERS_CARDS', env: 'AFAGH_SIGNERS_CARDS',
    group: 'امضاکنندگان فرمها و اسناد', label: 'امضاکنندگان کارتها و صورتجلسهها', type: 'text',
    default: 'مسئول صدور کارت | مدیر امور دانشجویی',
    help: 'برای کارت دانشجویی، کارت ورود به جلسه و صورتجلسهها — با | یا ویرگول جدا کنید',
  },

  // ── کلاس مجازی ──
  { key: 'BBB_URL', env: 'BIGBLUEBUTTON_URL', group: 'کلاس مجازی (BBB / Moodle)', label: 'نشانی API بیگ‌بلوباتن', type: 'url', default: '', help: 'مثال: https://vc.example.ac.ir/bigbluebutton/api — خالی یعنی سرویس غیرفعال' },
  { key: 'BBB_SECRET', env: 'BIGBLUEBUTTON_SECRET', group: 'کلاس مجازی (BBB / Moodle)', label: 'کلید مخفی بیگ‌بلوباتن', type: 'secret', default: '', help: 'خروجی دستور bbb-conf --secret روی سرور BBB' },
  { key: 'BBB_MODERATOR_PW', env: 'BIGBLUEBUTTON_MODERATOR_PW', group: 'کلاس مجازی (BBB / Moodle)', label: 'رمز ورود مدرس (Moderator)', type: 'secret', default: '' },
  { key: 'BBB_ATTENDEE_PW', env: 'BIGBLUEBUTTON_ATTENDEE_PW', group: 'کلاس مجازی (BBB / Moodle)', label: 'رمز ورود دانشجو (Attendee)', type: 'secret', default: '' },
  { key: 'BBB_AUTO_RECORD', env: 'BIGBLUEBUTTON_AUTO_RECORD', group: 'کلاس مجازی (BBB / Moodle)', label: 'ضبط خودکار جلسات', type: 'boolean', default: 'false' },
  {
    key: 'BBB_CHECKSUM_ALGO', env: 'BIGBLUEBUTTON_CHECKSUM_ALGO', group: 'کلاس مجازی (BBB / Moodle)',
    label: 'الگوریتم چک‌سام (checksum)', type: 'text', default: 'SHA256',
    help: 'در Moodle «BigBlueButton server checksum algorithm» را ببینید: SHA1 / SHA256 / SHA512. BBB نسخهٔ ۲.۷ به بعد SHA256 است.',
  },
  { key: 'MOODLE_URL', env: 'MOODLE_URL', group: 'کلاس مجازی (BBB / Moodle)', label: 'نشانی سامانه Moodle', type: 'url', default: '' },
  { key: 'MOODLE_TOKEN', env: 'MOODLE_TOKEN', group: 'کلاس مجازی (BBB / Moodle)', label: 'توکن وب‌سرویس Moodle', type: 'secret', default: '' },
  { key: 'MOODLE_PULL_TOKEN', env: 'MOODLE_PULL_TOKEN', group: 'کلاس مجازی (BBB / Moodle)', label: 'توکن کشش مودل (LMS pull API)', type: 'secret', default: '', help: 'کلید هدر x-lms-token برای GET /api/lms/* — خالی یعنی API بسته است. این توکن را در پلاگین مودل بگذارید تا درس‌ها، کاربران، ثبت‌نامی‌ها و برنامهٔ کلاسی را بکشد' },

  // ── پیام‌رسان‌ها ──
  { key: 'SMS_PROVIDER', env: 'SMS_PROVIDER', group: 'پیامک و ربات‌های پیام‌رسان', label: 'سرویس‌دهندهٔ پیامک', type: 'text', default: '', help: 'مثال: KAVENEGAR / FARAPAYAMAK / SMSIR' },
  { key: 'SMS_API_KEY', env: 'SMS_API_KEY', group: 'پیامک و ربات‌های پیام‌رسان', label: 'کلید API پیامک', type: 'secret', default: '' },
  { key: 'SMS_SENDER', env: 'SMS_SENDER', group: 'پیامک و ربات‌های پیام‌رسان', label: 'شمارهٔ فرستنده', type: 'text', default: '' },
  { key: 'BALE_TOKEN', env: 'BALE_BOT_TOKEN', group: 'پیامک و ربات‌های پیام‌رسان', label: 'توکن ربات بله', type: 'secret', default: '' },
  { key: 'BALE_CHANNEL', env: 'BALE_CHANNEL_ID', group: 'پیامک و ربات‌های پیام‌رسان', label: 'شناسهٔ کانال بله', type: 'text', default: '' },
  { key: 'EITAA_TOKEN', env: 'EITAA_BOT_TOKEN', group: 'پیامک و ربات‌های پیام‌رسان', label: 'توکن ربات ایتا', type: 'secret', default: '' },
  { key: 'EITAA_CHANNEL', env: 'EITAA_CHANNEL_ID', group: 'پیامک و ربات‌های پیام‌رسان', label: 'شناسهٔ کانال ایتا', type: 'text', default: '' },
  { key: 'SOROUSH_TOKEN', env: 'SOROUSH_BOT_TOKEN', group: 'پیامک و ربات‌های پیام‌رسان', label: 'توکن ربات سروش', type: 'secret', default: '' },
  { key: 'SOROUSH_CHANNEL', env: 'SOROUSH_CHANNEL_ID', group: 'پیامک و ربات‌های پیام‌رسان', label: 'شناسهٔ کانال سروش', type: 'text', default: '' },
  { key: 'IGAP_TOKEN', env: 'IGAP_BOT_TOKEN', group: 'پیامک و ربات‌های پیام‌رسان', label: 'توکن ربات ای‌گپ', type: 'secret', default: '' },
  { key: 'IGAP_CHANNEL', env: 'IGAP_CHANNEL_ID', group: 'پیامک و ربات‌های پیام‌رسان', label: 'شناسهٔ کانال ای‌گپ', type: 'text', default: '' },
  { key: 'TELEGRAM_TOKEN', env: 'TELEGRAM_BOT_TOKEN', group: 'پیامک و ربات‌های پیام‌رسان', label: 'توکن ربات تلگرام', type: 'secret', default: '' },
  { key: 'TELEGRAM_CHANNEL', env: 'TELEGRAM_CHANNEL_ID', group: 'پیامک و ربات‌های پیام‌رسان', label: 'شناسهٔ کانال تلگرام', type: 'text', default: '' },
  { key: 'TELEGRAM_BOT_USERNAME', env: 'TELEGRAM_BOT_USERNAME', group: 'پیامک و ربات‌های پیام‌رسان', label: 'نام‌کاربری بات تلگرام (بدون @)', type: 'text', default: '', help: 'برای ساخت دیپ‌لینک اتصال؛ خالی = فقط دستور متنی /start CODE' },
  { key: 'SOROUSH_BOT_USERNAME', env: 'SOROUSH_BOT_USERNAME', group: 'پیامک و ربات‌های پیام‌رسان', label: 'نام‌کاربری بات سروش (بدون @)', type: 'text', default: 'afaghbot', help: 'برای نمایش آدرس عضویت در بنر؛ خالی = فقط دستور متنی' },
  { key: 'BALE_BOT_USERNAME', env: 'BALE_BOT_USERNAME', group: 'پیامک و ربات‌های پیام‌رسان', label: 'نام‌کاربری بات بله', type: 'text', default: '', help: 'برای ساخت دیپ‌لینک اتصال؛ خالی = فقط دستور متنی /start CODE' },
  { key: 'EITAA_BOT_USERNAME', env: 'EITAA_BOT_USERNAME', group: 'پیامک و ربات‌های پیام‌رسان', label: 'نام‌کاربری بات ایتا', type: 'text', default: '', help: 'برای ساخت دیپ‌لینک اتصال؛ خالی = فقط دستور متنی /start CODE' },
  { key: 'TELEGRAM_WEBHOOK_SECRET', env: 'TELEGRAM_WEBHOOK_SECRET', group: 'پیامک و ربات‌های پیام‌رسان', label: 'کلید وب‌هوک تلگرام', type: 'secret', default: '', help: 'حالت فقط-ارسال: قطع inbound با نشست ادمین: GET /api/telegram/webhook?setup=1' },
  { key: 'TELEGRAM_BOT_ENABLED', env: 'TELEGRAM_BOT_ENABLED', group: 'پیامک و ربات‌های پیام‌رسان', label: 'دریافت پیام تلگرام (inbound)', type: 'boolean', default: 'false', help: 'پیش‌فرض خاموش (فقط-ارسال). روشن‌کردن فقط جفت‌سازی توکن /start را فعال می‌کند؛ دستور تعاملی وجود ندارد' },
  { key: 'SOROUSH_BOT_ENABLED', env: 'SOROUSH_BOT_ENABLED', group: 'پیامک و ربات‌های پیام‌رسان', label: 'دریافت پیام سروش (جفت‌سازی توکن)', type: 'boolean', default: 'false', help: 'روشن = poll worker پیام /start توکن را می‌پذیرد؛ دستور تعاملی وجود ندارد' },
  { key: 'BALE_BOT_ENABLED', env: 'BALE_BOT_ENABLED', group: 'پیامک و ربات‌های پیام‌رسان', label: 'دریافت پیام بله (جفت‌سازی توکن)', type: 'boolean', default: 'false', help: 'روشن = poll worker پیام /start توکن را می‌پذیرد؛ دستور تعاملی وجود ندارد' },
  { key: 'EITAA_BOT_ENABLED', env: 'EITAA_BOT_ENABLED', group: 'پیامک و ربات‌های پیام‌رسان', label: 'دریافت پیام ایتا (جفت‌سازی توکن)', type: 'boolean', default: 'false', help: 'روشن = poll worker پیام /start توکن را می‌پذیرد؛ دستور تعاملی وجود ندارد' },
  { key: 'IGAP_BOT_ENABLED', env: 'IGAP_BOT_ENABLED', group: 'پیامک و ربات‌های پیام‌رسان', label: 'دریافت پیام ای‌گپ (inbound)', type: 'boolean', default: 'false', help: 'خاموش نگه دارید (فقط-ارسال؛ اتصال جدید ای‌گپ فریز است)' },
  { key: 'SMS_BASE_URL', env: 'SMS_BASE_URL', group: 'پیامک و ربات‌های پیام‌رسان', label: 'نشانی سرویس پیامک', type: 'url', default: '', help: 'خالی = نشانی پیش‌فرض همان سرویس‌دهنده. برای CUSTOM از جای‌گاه‌های {to} {text} {sender} {key} استفاده کنید' },
  { key: 'TELEGRAM_API_BASE', env: 'TELEGRAM_API_BASE', group: 'پیامک و ربات‌های پیام‌رسان', label: 'نشانی API تلگرام', type: 'url', default: 'https://api.telegram.org' },
  { key: 'BALE_API_BASE', env: 'BALE_API_BASE', group: 'پیامک و ربات‌های پیام‌رسان', label: 'نشانی API بله', type: 'url', default: 'https://tapi.bale.ai' },
  { key: 'EITAA_API_BASE', env: 'EITAA_API_BASE', group: 'پیامک و ربات‌های پیام‌رسان', label: 'نشانی API ایتا', type: 'url', default: 'https://eitaayar.ir/api' },
  { key: 'SOROUSH_API_BASE', env: 'SOROUSH_API_BASE', group: 'پیامک و ربات‌های پیام‌رسان', label: 'نشانی API سروش', type: 'url', default: 'https://api.splus.ir' },
  { key: 'IGAP_API_BASE', env: 'IGAP_API_BASE', group: 'پیامک و ربات‌های پیام‌رسان', label: 'نشانی API ای‌گپ', type: 'url', default: 'https://igap.ai/api' },
  { key: 'NOTIFY_CHANNELS', env: 'NOTIFY_CHANNELS', group: 'پیامک و ربات‌های پیام‌رسان', label: 'کانال‌های اعلان به کاربر', type: 'text', default: 'INAPP,SMS', help: 'با ویرگول: INAPP، SMS، TELEGRAM، BALE، EITAA' },
  { key: 'NOTIFY_ENABLED', env: 'NOTIFY_ENABLED', group: 'پیامک و ربات‌های پیام‌رسان', label: 'ارسال اعلان بیرونی (پیامک/پیام‌رسان)', type: 'boolean', default: 'true' },
  { key: 'NOTIFY_SIGNATURE', env: 'NOTIFY_SIGNATURE', group: 'پیامک و ربات‌های پیام‌رسان', label: 'امضای انتهای پیام', type: 'text', default: 'دانشگاه آفاق' },

  // ── پرداخت ──
  { key: 'PAY_PROVIDER', env: 'PAYMENT_PROVIDER', group: 'درگاه پرداخت', label: 'درگاه پرداخت', type: 'text', default: '', help: 'مثال: BEHPARDAKHT_MELLAT / SAMAN / PARSIAN' },
  { key: 'PAY_TERMINAL_ID', env: 'PAYMENT_TERMINAL_ID', group: 'درگاه پرداخت', label: 'شناسهٔ ترمینال', type: 'text', default: '' },
  { key: 'PAY_MERCHANT_ID', env: 'PAYMENT_MERCHANT_ID', group: 'درگاه پرداخت', label: 'شناسهٔ پذیرنده', type: 'text', default: '' },
  { key: 'PAY_MERCHANT_KEY', env: 'PAYMENT_MERCHANT_KEY', group: 'درگاه پرداخت', label: 'کلید پذیرنده', type: 'secret', default: '' },
  { key: 'PAY_CALLBACK_URL', env: 'PAYMENT_CALLBACK_URL', group: 'درگاه پرداخت', label: 'نشانی بازگشت از درگاه', type: 'url', default: '', help: 'خالی = «نشانی عمومی سامانه» + /api/payment/callback' },
  { key: 'PAY_SANDBOX', env: 'PAYMENT_SANDBOX', group: 'درگاه پرداخت', label: 'حالت آزمایشی (Sandbox)', type: 'boolean', default: 'true' },
  { key: 'PAY_WAGE_PERCENT', env: 'PAYMENT_WAGE_PERCENT', group: 'درگاه پرداخت', label: 'درصد کارمزد', type: 'number', default: '0' },

  // ── شهریه و امور مالی ──
  { key: 'EQUIV_FIXED_TUITION_MODE', env: 'AFAGH_EQUIV_FIXED_TUITION_MODE', group: 'شهریه و امور مالی', label: 'نحوهٔ محاسبهٔ شهریهٔ ثابت معادل‌سازی', type: 'text', default: 'ONCE', help: 'ONCE = یک بار به ازای هر دانشجو (روی اولین نیمسال معادل‌سازی)؛ PER_TERM = به ازای هر نیمسال معادل‌سازی (۰۰EQ)؛ NONE = بدون شهریهٔ ثابت. شهریهٔ متغیر همیشه به ازای هر واحد محاسبه می‌شود' },
  { key: 'CHEQUE_REMIND_DAYS', env: 'AFAGH_CHEQUE_REMIND_DAYS', group: 'شهریه و امور مالی', label: 'یادآوری چک — چند روز پیش از سررسید', type: 'text', default: '7', help: 'چند روز پیش از سررسید چک، پیام یادآوری به دانشجو برود. چکِ گذشته از سررسید هم یک بار یادآوری می‌شود' },
  { key: 'CHEQUE_REMIND_ENABLED', env: 'AFAGH_CHEQUE_REMIND_ENABLED', group: 'شهریه و امور مالی', label: 'یادآوری خودکار چک فعال باشد', type: 'text', default: '1', help: '۱ = پویش زمان‌بندی‌شدهٔ /api/cron/cheque-reminders پیام بفرستد؛ ۰ = فقط فهرست آماده شود، پیامی نرود' },
  { key: 'FINANCE_CRON_SECRET', env: 'FINANCE_CRON_SECRET', group: 'شهریه و امور مالی', label: 'کلید پویش زمان‌بندی‌شدهٔ مالی', type: 'secret', default: '', help: 'هدر x-cron-secret برای POST /api/cron/cheque-reminders' },

  // ── سرویس‌های استعلام ──
  { key: 'IRANDOC_BASE_URL', env: 'IRANDOC_BASE_URL', group: 'سرویس‌های استعلام دولتی', label: 'نشانی API همانندجویی ایرانداک', type: 'url', default: '' },
  { key: 'IRANDOC_TOKEN', env: 'IRANDOC_TOKEN', group: 'سرویس‌های استعلام دولتی', label: 'توکن ایرانداک', type: 'secret', default: '' },
  { key: 'KYC_BASE_URL', env: 'KYC_BASE_URL', group: 'سرویس‌های استعلام دولتی', label: 'نشانی API احراز هویت (ثبت احوال/شاهکار)', type: 'url', default: '' },
  { key: 'KYC_API_KEY', env: 'KYC_API_KEY', group: 'سرویس‌های استعلام دولتی', label: 'کلید API احراز هویت', type: 'secret', default: '' },
  { key: 'SHAPARAK_BASE_URL', env: 'SHAPARAK_BASE_URL', group: 'سرویس‌های استعلام دولتی', label: 'نشانی API شاپرک', type: 'url', default: '' },
  { key: 'SAJJAD_BASE_URL', env: 'SAJJAD_BASE_URL', group: 'سرویس‌های استعلام دولتی', label: 'نشانی API سامانهٔ سجاد (وزارت علوم)', type: 'url', default: '' },
  { key: 'COMMISSION_PROCESS_CODE', env: 'COMMISSION_PROCESS_CODE', group: 'سرویس‌های استعلام دولتی', label: 'کد فرایند کمیسیون موارد خاص', type: 'text', default: 'COMMISSION_PERMIT', help: 'کد فرایند در «فرایندهای اداری» که پروندهٔ خودکار سنوات/مشروطی در آن ساخته می‌شود' },
  { key: 'SAJJAD_PORTAL_URL', env: 'SAJJAD_PORTAL_URL', group: 'سرویس‌های استعلام دولتی', label: 'نشانی پرتال سجاد (لینک کاربران)', type: 'url', default: 'https://portal.saorg.ir' },
  { key: 'API_TIMEOUT_SECONDS', env: 'API_TIMEOUT_SECONDS', group: 'سرویس‌های استعلام دولتی', label: 'مهلت پاسخ سرویس‌ها (ثانیه)', type: 'number', default: '10' },

  // ── فارغ‌التحصیلی و صدور مدارک ──
  { key: 'GRAD_AUTO_SCAN', env: 'GRAD_AUTO_SCAN', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'شروع خودکار پروندهٔ فارغ‌التحصیلی', type: 'boolean', default: 'true', help: 'با قطعی‌شدن آخرین نمره، پرونده بدون درخواست دانشجو باز می‌شود' },
  { key: 'GRAD_MIN_GPA', env: 'GRAD_MIN_GPA', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'حداقل معدل کل برای فراغت', type: 'number', default: '12' },
  { key: 'GRAD_THESIS_DEGREE_CODES', env: 'GRAD_THESIS_DEGREE_CODES', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'مقاطع دارای پایان‌نامه', type: 'text', default: 'MSC,PHD', help: 'کد مقاطعی که استعلام ایرانداک برایشان الزامی است (با ویرگول)' },
  { key: 'GRAD_IRANDOC_MAX_SIMILARITY', env: 'GRAD_IRANDOC_MAX_SIMILARITY', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'سقف مجاز همانندجویی (٪)', type: 'number', default: '20' },
  { key: 'GRAD_REQUIRE_SAJJAD', env: 'GRAD_REQUIRE_SAJJAD', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'الزام ثبت درخواست کد صحت در سجاد توسط دانشجو', type: 'boolean', default: 'true', help: 'پیش از ارجاع پرونده به کارشناس صدور مدرک، دانشجو باید در سامانهٔ سجاد درخواست کد صحت ثبت و کد رهگیری را وارد کند' },
  { key: 'GRAD_REQUIRE_PHOTO', env: 'GRAD_REQUIRE_PHOTO', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'الزام بارگذاری عکس ۴×۳', type: 'boolean', default: 'true' },
  { key: 'GRAD_STAMP_FEE', env: 'GRAD_STAMP_FEE', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'هزینهٔ تمبر ابطال (ریال)', type: 'number', default: '0', help: 'صفر یعنی این گام حذف می‌شود' },
  { key: 'GRAD_SERIAL_PREFIX', env: 'GRAD_SERIAL_PREFIX', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'پیشوند شمارهٔ سریال مدرک', type: 'text', default: 'AF' },
  { key: 'GRAD_CRON_SECRET', env: 'GRAD_CRON_SECRET', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'کلید قدیمیِ پویش فارغ‌التحصیلی (بدون مصرف)', type: 'secret', default: '', help: 'کلید مشترکِ نسل اول — هیچ مسیر /api/cron/* دیگری آن را نمی‌خواند. برای پویش فارغ‌التحصیلی از GRADUATION_SCAN_CRON_SECRET و برای رویدادهای گردش‌کار از WORKFLOW_EVENTS_CRON_SECRET استفاده کنید' },
  { key: 'GRADUATION_SCAN_CRON_SECRET', env: 'GRADUATION_SCAN_CRON_SECRET', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'کلید اختصاصی پویش فارغ‌التحصیلی', type: 'secret', default: '', help: 'هدر x-cron-secret برای POST /api/cron/graduation-scan (مستقل از GRAD_CRON_SECRET)' },
  { key: 'WORKFLOW_EVENTS_CRON_SECRET', env: 'WORKFLOW_EVENTS_CRON_SECRET', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'کلید اختصاصی رویدادهای گردش‌کار', type: 'secret', default: '', help: 'هدر x-cron-secret برای POST /api/cron/workflow-events' },
  { key: 'MSG_LINK_CRON_SECRET', env: 'MSG_LINK_CRON_SECRET', group: 'پیامک و ربات‌های پیام‌رسان', label: 'کلید اختصاصی پاک‌سازی لینک پیام‌رسان', type: 'secret', default: '', help: 'هدر x-cron-secret برای POST /api/cron/messenger-link-purge' },
  { key: 'BI_CRON_SECRET', env: 'BI_CRON_SECRET', group: 'فراغت‌التحصیلی و صدور مدارک', label: 'کلید فراخوانی تازه‌سازی BI', type: 'secret', default: '', help: 'مستقل از GRAD_CRON_SECRET (M-3): هدر x-cron-secret برای POST /api/cron/bi-refresh' },
  { key: 'GREETINGS_CRON_SECRET', env: 'GREETINGS_CRON_SECRET', group: 'پیامک و ربات‌های پیام‌رسان', label: 'کلید تبریک‌های خودکار', type: 'secret', default: '', help: 'هدر x-cron-secret برای POST /api/cron/greetings (تولد روزانه + شروع ترم)' },
  { key: 'SCHED_WARN_CRON_SECRET', env: 'SCHED_WARN_CRON_SECRET', group: 'پیامک و ربات‌های پیام‌رسان', label: 'کلید ارسال هشدارهای زمان‌بندی‌شده', type: 'secret', default: '', help: 'هدر x-cron-secret برای POST /api/cron/scheduled-warnings — ارسال خودکار از پیام‌رسان‌ها در موعد' },
  { key: 'BYPASS_CRON_SECRET', env: 'BYPASS_CRON_SECRET', group: 'پیامک و ربات‌های پیام‌رسان', label: 'کلید پویش مهلت درخواست‌های بدون رعایت محدودیت', type: 'secret', default: '', help: 'هدر x-cron-secret برای POST /api/cron/bypass-deadlines — یادآوری‌ها، ارجاع به کارشناس و رد خودکار' },
  { key: 'SCHED_WARN_CHANNELS', env: 'SCHED_WARN_CHANNELS', group: 'پیامک و ربات‌های پیام‌رسان', label: 'کانال‌های ارسال هشدار زمان‌بندی‌شده', type: 'text', default: '', help: 'با ویرگول (INAPP,SMS,TELEGRAM,BALE,EITAA,SOROUSH,IGAP)؛ خالی = همهٔ کانال‌های فعال' },
  { key: 'GREET_TERM_CHANNELS', env: 'GREET_TERM_CHANNELS', group: 'پیامک و ربات‌های پیام‌رسان', label: 'کانال‌های تبریک شروع ترم', type: 'text', default: 'INAPP', help: 'پیش‌فرض فقط داخل‌پورتال (بدون هزینهٔ پیامک برای ارسال انبوه)' },
  { key: 'GREET_BIRTHDAY_TEXT', env: 'GREET_BIRTHDAY_TEXT', group: 'پیامک و ربات‌های پیام‌رسان', label: 'متن تبریک تولد', type: 'textarea', default: '🎂 {name} عزیز، تولدت مبارک! دانشگاه آفاق برایت سالی سرشار از موفقیت آرزو می‌کند.', help: '{name} = نام کوچک؛ اگر نام ثبت نباشد «دوست عزیز» گذاشته می‌شود' },
  { key: 'GREET_TERM_TEXT', env: 'GREET_TERM_TEXT', group: 'پیامک و ربات‌های پیام‌رسان', label: 'متن تبریک شروع ترم', type: 'textarea', default: '🎓 سال تحصیلی جدید ({term}) آغاز شد! دانشگاه آفاق نیمسالی موفق برایتان آرزو می‌کند. برنامهٔ کلاسی خود را در پورتال ببینید.', help: '{term} = عنوان ترم (مثل نیمسال اول ۱۴۰۵)' },
  { key: 'ALUMNI_FEE_TRANSCRIPT', env: 'ALUMNI_FEE_TRANSCRIPT', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'هزینهٔ ریزنمرات رسمی (ریال)', type: 'number', default: '0' },
  { key: 'ALUMNI_FEE_RELEASE', env: 'ALUMNI_FEE_RELEASE', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'هزینهٔ آزادسازی مدرک (ریال)', type: 'number', default: '0' },
  { key: 'ALUMNI_FEE_TRANSLATION', env: 'ALUMNI_FEE_TRANSLATION', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'هزینهٔ تأییدیه برای دارالترجمه (ریال)', type: 'number', default: '0' },
  { key: 'ALUMNI_FEE_DUPLICATE', env: 'ALUMNI_FEE_DUPLICATE', group: 'فارغ‌التحصیلی و صدور مدارک', label: 'هزینهٔ صدور المثنی (ریال)', type: 'number', default: '0' },

  // ── گردش کار و حق‌التدریس ──
  { key: 'WORKFLOW_WEBHOOK_URL', env: 'WORKFLOW_WEBHOOK_URL', group: 'گردش کار و حق‌التدریس', label: 'وب‌هوک رویدادهای گردش کار', type: 'url', default: '', help: 'خالی = فقط هندلرهای داخلی. در صورت پر بودن، خلاصهٔ هر رویداد به این نشانی POST می‌شود' },
  { key: 'REQ_TRACKING_PREFIX', env: 'REQ_TRACKING_PREFIX', group: 'گردش کار و حق‌التدریس', label: 'پیشوند کد رهگیری درخواست‌ها', type: 'text', default: 'REQ' },
  { key: 'FA_YEAR', env: 'FA_YEAR', group: 'گردش کار و حق‌التدریس', label: 'سال مالی/تحصیلی (شمسی)', type: 'text', default: '', help: 'خالی = محاسبهٔ خودکار از تاریخ روز؛ برای سال تحصیلی خاص عدد وارد کنید (مثلاً ۱۴۰۵)' },
  // نرخ پایهٔ ساعتی قرارداد حق‌التدریس. تا امروز این کلید در فهرست تنظیمات
  // *نبود* و contract-engine آن را صدا می‌زد؛ getSetting برای کلید ناشناخته
  // پرتاب می‌کند، پس مقدار پیش‌فرضِ کنارِ فراخوان هرگز اجرا نمی‌شد و صفحهٔ
  // «قرارداد من» برای هر استاد خطای ۵۰۰ می‌داد.
  { key: 'PREVIOUS_TICKET_TOKEN_SECRET', env: 'PREVIOUS_TICKET_TOKEN_SECRET', group: 'زیرساخت (فقط ENV)', label: 'کلید پیشین امضای بلیت (چرخش کلید)', type: 'secret', default: '', envOnly: true, help: 'هنگام تعویض کلید امضا، کلید قبلی اینجا می‌ماند تا بلیت‌های صادرشده تا پایان ترم معتبر بمانند' },
  { key: 'CONTRACT_TAX_PERCENT', env: 'AFAGH_CONTRACT_TAX_PERCENT', group: 'گردش کار و حق‌التدریس', label: 'درصد کسر مالیات قرارداد', type: 'number', default: '10' },
  { key: 'CONTRACT_INSURANCE_PERCENT', env: 'AFAGH_CONTRACT_INSURANCE_PERCENT', group: 'گردش کار و حق‌التدریس', label: 'درصد کسر بیمهٔ قرارداد', type: 'number', default: '7' },
  { key: 'HOURLY_RATE_TMN', env: 'AFAGH_HOURLY_RATE_TMN', group: 'گردش کار و حق‌التدریس', label: 'نرخ پایهٔ هر ساعت تدریس (تومان)', type: 'number', default: '850000', help: 'مبنای برآورد مبلغ قرارداد حق‌التدریس، وقتی نرخ اختصاصیِ مرتبهٔ علمی در جدول نرخ‌ها ثبت نشده باشد' },
  { key: 'CONTRACT_MINUTES_PER_UNIT', env: 'AFAGH_CONTRACT_MINUTES_PER_UNIT', group: 'گردش کار و حق‌التدریس', label: 'دقیقهٔ قابل‌احتساب هر واحد در هفته', type: 'number', default: '0', help: 'صفر = همان ساعت واقعی جدول (رفتار فعلی)؛ مثلاً ۶۰ یعنی هر واحد یک ساعت کامل برای استاد حساب می‌شود حتی اگر کلاس ۴۵ دقیقه برگزار شود' },
  { key: 'PAYROLL_TERM_SESSIONS', env: 'PAYROLL_TERM_SESSIONS', group: 'گردش کار و حق‌التدریس', label: 'جلسات مبنای ترم (حق‌التدریس)', type: 'number', default: '16', help: 'مبنای تناسب کسر غیبت، وقتی برای کلاس هیچ جلسه‌ای ثبت نشده باشد' },
  { key: 'PAYROLL_MIDTERM_PERCENT', env: 'PAYROLL_MIDTERM_PERCENT', group: 'گردش کار و حق‌التدریس', label: 'درصد علی‌الحساب میان‌ترم', type: 'number', default: '40' },
  { key: 'PAYROLL_CROWDED_THRESHOLD', env: 'PAYROLL_CROWDED_THRESHOLD', group: 'گردش کار و حق‌التدریس', label: 'حدنصاب کلاس پرجمعیت (نفر)', type: 'number', default: '40' },
  { key: 'PAYROLL_CROWDED_STEP', env: 'PAYROLL_CROWDED_STEP', group: 'گردش کار و حق‌التدریس', label: 'گام پلکانی پرجمعیت (نفر)', type: 'number', default: '25', help: 'به‌ازای هر این تعداد نفر بالای حدنصاب، یک پله به ضریب اضافه می‌شود؛ مثلاً ۲۵ یعنی ۶۵ نفر = ۱ پله، ۹۰ نفر = ۲ پله' },
  { key: 'PAYROLL_CROWDED_STEP_UP', env: 'PAYROLL_CROWDED_STEP_UP', group: 'گردش کار و حق‌التدریس', label: 'افزایش ضریب هر پلهٔ پرجمعیت', type: 'number', default: '0', help: 'صفر = رفتار فعلی (یک جهش ثابت)؛ مثلاً 0.05 یعنی هر پله ۵٪ به ضریب اضافه می‌کند' },
  { key: 'PAYROLL_RATE_FRACTION', env: 'PAYROLL_RATE_FRACTION', group: 'گردش کار و حق‌التدریس', label: 'سوییچ نرخ کسری از حکم (۱/N)', type: 'boolean', default: 'false', help: 'روشن = نرخ هر واحد از تقسیم مبنای حکم قرارداد بر مقسوم می‌آید؛ خاموش = جدول نرخ ثابت مرتبهٔ علمی. استاد بدون مبنای حکم همیشه از جدول می‌خواند' },
  { key: 'PAYROLL_RATE_DIVISOR', env: 'PAYROLL_RATE_DIVISOR', group: 'گردش کار و حق‌التدریس', label: 'مقسوم نرخ کسری (N)', type: 'number', default: '50', help: 'نرخ = مبنای حکم ÷ این عدد؛ مثلاً ۵۰ یعنی یک‌پنجاهم حکم' },
  { key: 'PAYROLL_COEF_PRACTICAL', env: 'PAYROLL_COEF_PRACTICAL', group: 'گردش کار و حق‌التدریس', label: 'نام ردیف ضریب درس عملی', type: 'text', default: 'ضریب درس عملی', help: 'نام ردیف در جدول teaching_coefficients؛ مقدار از همان جدول خوانده می‌شود' },
  { key: 'PAYROLL_COEF_MS_LEVEL', env: 'PAYROLL_COEF_MS_LEVEL', group: 'گردش کار و حق‌التدریس', label: 'نام ردیف ضریب مقطع ارشد', type: 'text', default: 'ضریب مقطع ارشد' },
  { key: 'PAYROLL_COEF_CROWDED', env: 'PAYROLL_COEF_CROWDED', group: 'گردش کار و حق‌التدریس', label: 'نام ردیف ضریب کلاس جمعی', type: 'text', default: 'ضریب کلاس جمعی (>۴۰ نفر)' },
  { key: 'PAYROLL_MS_COURSE_PREFIX', env: 'PAYROLL_MS_COURSE_PREFIX', group: 'گردش کار و حق‌التدریس', label: 'پیشوند کد دروس کارشناسی ارشد', type: 'text', default: '21', help: 'کد دروسی که با این رقم شروع می‌شوند مشمول ضریب مقطع ارشد‌اند (با ویرگول)' },

  // ── سردر برنامهٔ هفتگی ──
  { key: 'WEEKLY_BOARD_PROF_TITLE', env: 'WEEKLY_BOARD_PROF_TITLE', group: 'سردر برنامهٔ هفتگی', label: 'لقب احترام استاد در سردر', type: 'boolean', default: 'true', help: 'استادیار و بالاتر «دکتر» + مهندس برای فنی' },
  { key: 'WEEKLY_BOARD_GENDER_HONORIFIC', env: 'WEEKLY_BOARD_GENDER_HONORIFIC', group: 'سردر برنامهٔ هفتگی', label: 'پیشوند «جناب آقای / سرکار خانم» در سردر', type: 'boolean', default: 'false', help: 'خاموش = فقط مرتبه علمی (دکتر / مهندس) بدون پیشوند جنسیتی تا نام استاد در چاپ کامل جا شود. روشن = افزودن جناب آقای / سرکار خانم' },
  { key: 'WEEKLY_BOARD_SHOW_FIRSTNAME', env: 'WEEKLY_BOARD_SHOW_FIRSTNAME', group: 'سردر برنامهٔ هفتگی', label: 'چاپ نام کوچک استاد در سردر', type: 'boolean', default: 'true', help: 'خاموش = فقط نام خانوادگی (با لقب). مثلاً «دکتر میکی» به‌جای «دکتر مرضیه میکی»' },
  { key: 'WEEKLY_BOARD_SHORT_HONORIFIC', env: 'WEEKLY_BOARD_SHORT_HONORIFIC', group: 'سردر برنامهٔ هفتگی', label: 'لقب کامل در سردر (سرکار/جناب)', type: 'boolean', default: 'false', help: 'پیش‌فرض خاموش است: فقط «خانم/آقای» چاپ می‌شود (کوتاه و مناسب چاپ). روشن = «سرکار خانم/جناب آقای» (طولانی)' },
  { key: 'WEEKLY_BOARD_HOUR_FROM', env: 'WEEKLY_BOARD_HOUR_FROM', group: 'سردر برنامهٔ هفتگی', label: 'ساعتِ شروعِ محور زمانِ سردر (پیش‌فرض ۸)', type: 'number', default: '8', help: 'پیش‌فرضِ بازهٔ محور زمانِ پوستر درب کلاس. در خودِ صفحهٔ «تابلوی هفتگی» با انتخاب «محور زمان از/تا» قابل تغییر است و آن انتخاب بر این تنظیم مقدم است' },
  { key: 'WEEKLY_BOARD_HOUR_TO', env: 'WEEKLY_BOARD_HOUR_TO', group: 'سردر برنامهٔ هفتگی', label: 'ساعتِ پایانِ محور زمانِ سردر (پیش‌فرض ۲۰)', type: 'number', default: '20', help: 'اگر کلاس‌های دانشگاه تا ۱۸ است، ۱۸ بگذارید تا نیمهٔ شبِ پوستر فضای خالی نباشد. حداکثر بازه ۱۸ ساعت است' },

  // ── امنیت ورود و نظارت ──
  { key: 'SESSION_LOCK_MINUTES', env: 'SESSION_LOCK_MINUTES', group: 'امنیت ورود و نظارت', label: 'قفل خودکار بیکاری (دقیقه)', type: 'number', default: '15', help: 'پس از این مدت بی‌تعاملی، صفحه قفل و رمز دوباره خواسته می‌شود. ۰ = غیرفعال' },
  { key: 'SESSION_LOCK_MINUTES_ROLES', env: 'SESSION_LOCK_MINUTES_ROLES', group: 'امنیت ورود و نظارت', label: 'سقف قفل بیکاری به تفکیک نقش (JSON)', type: 'text', default: '', help: 'مثال: {"ADMIN":30,"FINANCE_EXPERT":15,"STUDENT":0} — مقدار هر نقش جای سقف عمومی را می‌گیرد و ۰ یعنی برای آن نقش هرگز قفل نشود.' },
  { key: 'SESSION_REAUTH_MINUTES', env: 'SESSION_REAUTH_MINUTES', group: 'امنیت ورود و نظارت', label: 'ورود مجدد پس از غیبت طولانی (دقیقه)', type: 'number', default: '30', help: 'اگر بیش از این مدت از آخرین فعالیت گذشته باشد، نشستِ همین دستگاه بسته و به صفحهٔ ورود هدایت می‌شود (نه صفحهٔ قفل روی دادهٔ کهنه). مقدار مؤثر حداقل «قفل بیکاری + ۵ دقیقه» است. ۰ = غیرفعال' },
  { key: 'GRADE_EDIT_NOTIFY_BOARD', env: 'GRADE_EDIT_NOTIFY_BOARD', group: 'امنیت ورود و نظارت', label: 'اعلام تغییر نمره در کارتابل ادمین', type: 'boolean', default: 'true', help: 'نوار «فعالیت زندهٔ نمرات» (۳۰ دقیقهٔ اخیر) بالای کارتابل ادمین نمایش داده می‌شود' },
  { key: 'GRADE_EDIT_NOTIFY_MSG', env: 'GRADE_EDIT_NOTIFY_MSG', group: 'امنیت ورود و نظارت', label: 'پیام‌رسانِ تغییر نمره به مدیران', type: 'boolean', default: 'false', help: 'با هر ثبت نمره توسط کارشناس/ادمین، به مدیران دانشگاه پیام‌رسان اطلاع داده می‌شود' },
  { key: 'GRADE_CHANGE_NOTIFY_PROF', env: 'GRADE_CHANGE_NOTIFY_PROF', group: 'امنیت ورود و نظارت', label: 'اطلاع به استاد از تغییر نمره در ترم جاری', type: 'boolean', default: 'true', help: 'اگر در ترم جاری نمره‌ای از درس استادی توسط کارشناس/ادمین تغییر کرد، به خود استاد پیام‌رسان اطلاع داده می‌شود' },

  // ── ارزشیابی و هوش تجاری ──
  { key: 'EVAL_FLAG_THRESHOLD', env: 'EVAL_FLAG_THRESHOLD', group: 'ارزشیابی و هوش تجاری', label: 'آستانهٔ بحرانی نمرهٔ ارزشیابی استاد', type: 'number', default: '3.5', help: 'استاد زیر این نمره در داشبورد مدیریتی علامت می‌خورد' },
  { key: 'EVAL_FACILITY_REPAIR_THRESHOLD', env: 'EVAL_FACILITY_REPAIR_THRESHOLD', group: 'ارزشیابی و هوش تجاری', label: 'آستانهٔ ارجاع کلاس به تعمیرات', type: 'number', default: '3', help: 'اگر میانگین هر شاخص امکانات زیر این عدد باشد، کلاس نیازمند تعمیر گزارش می‌شود' },
  { key: 'EVAL_TREND_TERMS', env: 'EVAL_TREND_TERMS', group: 'ارزشیابی و هوش تجاری', label: 'تعداد دورهٔ روند ارزشیابی', type: 'number', default: '3', help: 'چند دورهٔ اخیر در نمودار روند نمایش داده شود' },
  { key: 'BI_WORDCLOUD_LIMIT', env: 'BI_WORDCLOUD_LIMIT', group: 'ارزشیابی و هوش تجاری', label: 'تعداد واژه در ابر کلمات', type: 'number', default: '18' },
  { key: 'BI_WORDCLOUD_MIN_LEN', env: 'BI_WORDCLOUD_MIN_LEN', group: 'ارزشیابی و هوش تجاری', label: 'حداقل طول واژه در ابر کلمات', type: 'number', default: '3' },
  { key: 'BI_STOPWORDS', env: 'BI_STOPWORDS', group: 'ارزشیابی و هوش تجاری', label: 'واژه‌های توقف (با ویرگول)', type: 'text', default: 'و,به,از,که,در,این,آن,با,را,برای,است,بود,شد,هم,نیز,تا,یا,اما,خیلی,بسیار,بر,دارد,می,های,یک,دو,سه,من,او,ما,شما,باید,نمی,کنم,کرد,کردم,کنند,مورد,همه,چون,اگر,روی,بی,هر,چه,می‌شود,بودن,کلاس,استاد,درس' },
  { key: 'TICKET_TOKEN_SECRET', env: 'TICKET_TOKEN_SECRET', group: 'ارزشیابی و هوش تجاری', label: 'کلید امضای توکن کارت‌های آزمون', type: 'secret', default: '', help: 'برای امضای HMAC توکن کارت ورود به جلسه؛ بدون آن توکن صادر نمی‌شود' },
  { key: 'EXAM_TICKET_TTL_MINUTES', env: 'EXAM_TICKET_TTL_MINUTES', group: 'ارزشیابی و هوش تجاری', label: 'اعتبار توکن کارت آزمون (دقیقه)', type: 'number', default: '180' },
  { key: 'ENROLL_CONFIRM_TTL_MINUTES', env: 'ENROLL_CONFIRM_TTL_MINUTES', group: 'ارزشیابی و هوش تجاری', label: 'اعتبار توکن تأییدیه انتخاب واحد (دقیقه)', type: 'number', default: '20160', help: 'مدت اعتبار QR تأییدیهٔ انتخاب واحد؛ پیش‌فرض ۲۰۱۶۰ دقیقه (۱۴ روز)' },
  { key: 'FINANCE_STMT_TTL_MINUTES', env: 'FINANCE_STMT_TTL_MINUTES', group: 'ارزشیابی و هوش تجاری', label: 'اعتبار توکن کارنامهٔ مالی (دقیقه)', type: 'number', default: '10080', help: 'مدت اعتبار QR کارنامهٔ مالی دانشجو؛ پیش‌فرض ۱۰۰۸۰ دقیقه (۷ روز)' },
  { key: 'TRANSCRIPT_TTL_MINUTES', env: 'TRANSCRIPT_TTL_MINUTES', group: 'ارزشیابی و هوش تجاری', label: 'اعتبار توکن کارنامهٔ تحصیلی (دقیقه)', type: 'number', default: '10080', help: 'مدت اعتبار QR کارنامهٔ تحصیلی دانشجو؛ پیش‌فرض ۱۰۰۸۰ دقیقه (۷ روز)' },
  { key: 'EXAM_GRADE_DEADLINE_DAYS', env: 'EXAM_GRADE_DEADLINE_DAYS', group: 'ارزشیابی و هوش تجاری', label: 'مهلت ثبت نمرهٔ امتحان (روز)', type: 'number', default: '5' },
  { key: 'GRADE_OBJECTION_DEADLINE', env: 'GRADE_OBJECTION_DEADLINE', group: 'ارزشیابی و هوش تجاری', label: 'مهلت اعتراض به نمره (YYYY-MM-DD) — خالی = پنجره بسته', type: 'text', default: '', help: 'تا پایان این روز (به وقت محلی) دانشجو می‌تواند به نمرات قطعی اعتراض کند؛ خالی بودن یعنی پنجره بسته و دکمه‌های اعتراض قفل می‌مانند.' },
  // ── قاعدهٔ اختیاری بارم امتحان ──
  // این تنظیم «راز» نیست؛ فقط پیکربندی سیاست آموزشی است و در پنل مدیر
  // (گروه ارزشیابی و هوش تجاری) قابل تغییر است. موتور امتحان در حال حاضر
  // آن را نمی‌خواند؛ پس تغییرش امروز هیچ رفتاری را عوض نمی‌کند.
  //   ۰  = بررسی خاموش است (پیش‌فرض فعلی؛ دقیقاً همان رفتار امروز)
  //   >۰ = مجموع بارم «میان‌ترم + پایان‌ترم» باید دقیقاً برابر این عدد باشد
  //        ۱۵ = مطابق DEFAULT_RUBRIC فعلی (۵+۱۰)
  //        ۲۰ = انتظار رایج «میان‌ترم + پایان‌ترم = ۲۰» (بارم پیش‌فرض فعلی
  //             را رد می‌کند و پیش از فعال‌سازی نیاز به تصمیم محصولی دارد)
  // ⚠ تغییر این مقدار در میانهٔ ترم می‌تواند بارم و نمرات درس‌های در حال
  //   اجرا را نامعتبر کند؛ فقط پیش از شروع ترم تغییر دهید.
  { key: 'EXAM_MIDTERM_FINAL_TARGET', env: 'AFAGH_EXAM_MIDTERM_FINAL_TARGET', group: 'ارزشیابی و هوش تجاری', label: 'هدف مجموع بارم میان‌ترم + پایان‌ترم (۰ = خاموش)', type: 'number', default: '0', help: '۰ = بررسی خاموش و رفتار فعلی حفظ می‌شود؛ عدد مثبت = مجموع دو جزء میان‌ترم و پایان‌ترم باید دقیقاً برابر آن باشد. ۱۵ مطابق بارم پیش‌فرض سامانه (۵+۱۰) است؛ ۲۰ انتظار رایج است ولی بارم پیش‌فرض فعلی را رد می‌کند. تغییر میان ترم می‌تواند بارم و نمرات درس‌های جاری را نامعتبر کند.' },
  { key: 'STUDENT_CARD_VALID_DAYS', env: 'STUDENT_CARD_VALID_DAYS', group: 'ارزشیابی و هوش تجاری', label: 'اعتبار کارت دانشجویی (روز)', type: 'number', default: '365' },
  { key: 'PERF_SLA_TARGET', env: 'PERF_SLA_TARGET', group: 'ارزشیابی و هوش تجاری', label: 'هدف پایبندی به ضرب‌الاجل (SLA) استاد', type: 'number', default: '90', help: 'درصد؛ مبنای نشان عملکرد و پاداش بهره‌وری' },
  { key: 'PERF_EVAL_TARGET', env: 'PERF_EVAL_TARGET', group: 'ارزشیابی و هوش تجاری', label: 'هدف نمرهٔ ارزشیابی استاد', type: 'number', default: '4', help: 'از ۵؛ مبنای نشان عملکرد و پاداش بهره‌وری' },
  { key: 'PERF_SESSION_HOLD_TARGET', env: 'PERF_SESSION_HOLD_TARGET', group: 'ارزشیابی و هوش تجاری', label: 'هدف نرخ برگزاری جلسات کلاس', type: 'number', default: '90', help: 'درصد جلسات برگزارشده از کل جلسات' },
  { key: 'PERF_INCENTIVE_PERCENT', env: 'PERF_INCENTIVE_PERCENT', group: 'ارزشیابی و هوش تجاری', label: 'ضریب تشویقی حق‌التدریس (درصد)', type: 'number', default: '10', help: 'پاداش بهره‌وری برای اساتید واجد شرایط' },
  { key: 'BI_CACHE_TTL_SECONDS', env: 'BI_CACHE_TTL_SECONDS', group: 'ارزشیابی و هوش تجاری', label: 'عمر کش گزارش‌های BI (ثانیه)', type: 'number', default: '300', help: 'صفر = همیشه محاسبهٔ تازه. داشبورد مدیریتی و ابر کلمات از این کش می‌خوانند' },

  // ── حضور و غیاب کلاس‌ها ──
  // چه کسی «تشکیل کلاس» را ثبت کند؟ استاد با اسکنِ QRِ سردر، یا کنترل‌کنندهٔ
  // حضور و غیاب، یا هر دو. مقدارها: PROFESSOR | CONTROLLER | BOTH
  { key: 'ATTENDANCE_RECORDER_MODE', env: 'AFAGH_ATTENDANCE_RECORDER_MODE', group: 'حضور و غیاب کلاس‌ها', label: 'چه کسی حضورِ کلاس را ثبت کند؟', type: 'select', default: 'BOTH', options: [
    { value: 'BOTH', label: 'هر دو — استاد و کنترل‌کنندهٔ حضور (پیش‌فرض)' },
    { value: 'PROFESSOR', label: 'فقط خودِ استاد (اسکن QR سردر)' },
    { value: 'CONTROLLER', label: 'فقط کنترل‌کنندهٔ حضور و غیاب' },
  ], help: 'تعیین می‌کند چه کسی می‌تواند «تشکیل کلاس» را ثبت کند. حالت «فقط کنترل‌کننده» برای دانشگاه‌هایی است که می‌خواهند ثبت حضور کاملاً مستقل از استاد باشد.' },
  { key: 'ATTENDANCE_CONTROLLER_ROOM_SCOPED', env: 'AFAGH_ATTENDANCE_CONTROLLER_ROOM_SCOPED', group: 'حضور و غیاب کلاس‌ها', label: 'محدود بودن کنترل‌کننده به اتاق‌های تخصیص‌یافته', type: 'boolean', default: 'true', help: 'روشن = کنترل‌کننده فقط در اتاق‌هایی که در «تخصیص کارشناس به اتاق‌ها» به او سپرده شده می‌تواند ثبت کند. خاموش = همهٔ اتاق‌های دانشگاه خودش (مناسب دانشگاه‌های کوچک)' },

  // ── ساعت کلاس و برنامه‌ریزی (زنگ‌های آموزشی) ──
  // این پنج کلید، هم ماتریس «اعلام حضور استاد» و هم ماتریس برنامه‌ریزی مدیر گروه را
  // از یک منبع تغذیه می‌کنند؛ تغییرشان هر دو صفحه را هم‌تراز می‌کند.
  { key: 'SCHEDULE_DAY_START', env: 'AFAGH_SCHEDULE_DAY_START', group: 'ساعت کلاس و برنامه‌ریزی', label: 'شروع روز آموزشی', type: 'text', default: '08:00', help: 'قالب ۲۴ ساعته مثل 07:00 یا 08:00 — اولین زنگ از این ساعت شروع می‌شود' },
  { key: 'SCHEDULE_DAY_END', env: 'AFAGH_SCHEDULE_DAY_END', group: 'ساعت کلاس و برنامه‌ریزی', label: 'پایان روز آموزشی', type: 'text', default: '19:30', help: 'آخرین زنگ حداکثر تا این ساعت تمام می‌شود (مثل 19:00 یا 20:00)' },
  { key: 'SCHEDULE_SLOT_MINUTES', env: 'AFAGH_SCHEDULE_SLOT_MINUTES', group: 'ساعت کلاس و برنامه‌ریزی', label: 'طول هر زنگ (دقیقه)', type: 'select', default: '120', options: [
    { value: '60', label: '۶۰ دقیقه (۱ ساعته)' },
    { value: '90', label: '۹۰ دقیقه (۱٫۵ ساعته)' },
    { value: '100', label: '۱۰۰ دقیقه' },
    { value: '120', label: '۱۲۰ دقیقه (۲ ساعته — پیش‌فرض)' },
    { value: '135', label: '۱۳۵ دقیقه' },
    { value: '150', label: '۱۵۰ دقیقه (۲٫۵ ساعته)' },
  ], help: 'دانشگاه‌های مختلف زنگ ۱٫۵ یا ۲ ساعته دارند؛ با این کلید کل زنگ‌ها بازتولید می‌شوند' },
  { key: 'SCHEDULE_BREAK_START', env: 'AFAGH_SCHEDULE_BREAK_START', group: 'ساعت کلاس و برنامه‌ریزی', label: 'شروع استراحت (نماز و ناهار)', type: 'text', default: '12:00', help: 'خالی بگذارید اگر دانشگاه استراحت میان‌روز ندارد' },
  { key: 'SCHEDULE_BREAK_END', env: 'AFAGH_SCHEDULE_BREAK_END', group: 'ساعت کلاس و برنامه‌ریزی', label: 'پایان استراحت (نماز و ناهار)', type: 'text', default: '13:30', help: 'در این بازه هیچ زنگی گذاشته نمی‌شود' },
  { key: 'SCHEDULE_BREAK_LABEL', env: 'AFAGH_SCHEDULE_BREAK_LABEL', group: 'ساعت کلاس و برنامه‌ریزی', label: 'عنوان ستون استراحت', type: 'text', default: 'نماز و ناهار', help: 'متن نمایشی روی ستون استراحت در ماتریس‌ها' },

  // ── زیرساخت (فقط ENV) ──
  // ⚠ هیچ پیش‌فرضی در کد نگه داشته نمی‌شود تا پنل مدیر مقدار واقعی‌نما (اعتبارنامهٔ
  //   پیش‌فرض ضعیف) نمایش ندهد؛ این مقادیر فقط از ENV (فایل .env / متغیر محیطی
  //   داکر) خوانده می‌شوند و در نبود آن‌ها خالی نمایش داده می‌شوند.
  { key: 'DATABASE_URL', env: 'DATABASE_URL', group: 'زیرساخت (فقط ENV)', label: 'اتصال PostgreSQL', type: 'secret', default: '', envOnly: true, help: 'اجباری — باید از طریق ENV تنظیم شود؛ پیش‌فرضی در کد وجود ندارد' },
  { key: 'REDIS_URL', env: 'REDIS_URL', group: 'زیرساخت (فقط ENV)', label: 'اتصال Redis', type: 'text', default: '', envOnly: true, help: 'باید از طریق ENV تنظیم شود؛ پیش‌فرضی در کد وجود ندارد' },
  { key: 'S3_ENDPOINT', env: 'S3_ENDPOINT', group: 'زیرساخت (فقط ENV)', label: 'میزبان Object Storage', type: 'text', default: '', envOnly: true, help: 'باید از طریق ENV تنظیم شود؛ پیش‌فرضی در کد وجود ندارد' },
  { key: 'S3_PORT', env: 'S3_PORT', group: 'زیرساخت (فقط ENV)', label: 'پورت Object Storage', type: 'number', default: '', envOnly: true, help: 'باید از طریق ENV تنظیم شود؛ پیش‌فرضی در کد وجود ندارد' },
  { key: 'S3_BUCKET', env: 'S3_BUCKET', group: 'زیرساخت (فقط ENV)', label: 'نام باکت بایگانی', type: 'text', default: '', envOnly: true, help: 'باید از طریق ENV تنظیم شود؛ پیش‌فرضی در کد وجود ندارد' },
  { key: 'APP_PORT', env: 'PORT', group: 'زیرساخت (فقط ENV)', label: 'پورت لیسن سرویس وب', type: 'number', default: '', envOnly: true, help: 'باید از طریق ENV (متغیر PORT) تنظیم شود؛ پیش‌فرضی در کد وجود ندارد' },
];

export const SETTING_BY_KEY: Record<string, SettingDef> = Object.fromEntries(SETTING_DEFS.map(d => [d.key, d]));

export type SettingSource = 'db' | 'env' | 'default';

// ── کش کوتاه‌مدت درون‌پردازه‌ای ──
const CACHE_TTL_MS = 15_000;
let cache: { at: number; rows: Record<string, string> } | null = null;

async function dbSettings(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  const rows: Record<string, string> = {};
  try {
    const res = await db.select().from(system_settings);
    for (const r of res) rows[r.key] = r.value;
  } catch {
    // جدول هنوز ساخته نشده (قبل از migrate) — با ENV/پیش‌فرض ادامه می‌دهیم
  }
  cache = { at: Date.now(), rows };
  return rows;
}

export function invalidateSettingsCache() {
  cache = null;
}

function envOf(def: SettingDef): string | undefined {
  const v = process.env[def.env];
  return v === undefined || v === '' ? undefined : v;
}

/** مقدار یک تنظیم با ترتیب دیتابیس ← ENV ← پیش‌فرض */
export async function getSetting(key: string): Promise<string> {
  const def = SETTING_BY_KEY[key];
  if (!def) throw new Error('تنظیم ناشناخته: ' + key);
  if (def.envOnly) return envOf(def) ?? def.default;
  const rows = await dbSettings();
  const fromDb = rows[key];
  if (fromDb !== undefined && fromDb !== '') return fromDb;
  return envOf(def) ?? def.default;
}

/** نگاشت «کد فرم» → کلید تنظیمات مربوط به جایگاههای امضای همان فرم */
const SIGNER_KEYS: Record<string, string> = {
  'finance-report': 'SIGNERS_FINANCE_REPORTS',
  'edu-report': 'SIGNERS_EDU_REPORTS',
  'custom-report': 'SIGNERS_CUSTOM_REPORTS',
  transcript: 'SIGNERS_TRANSCRIPT',
  certificate: 'SIGNERS_CERTIFICATES',
  card: 'SIGNERS_CARDS',
};

/**
 * برچسبهای امضای یک فرم، از «تنظیمات سامانه».
 * فرمهای تازه فقط کافی است یک کلید به `SIGNER_KEYS` و یک `SettingDef`
 * اضافه کنند؛ نیازی به دستکاری کامپوننت چاپ نیست.
 */
export async function getFormSigners(form: string): Promise<string[]> {
  const key = SIGNER_KEYS[form];
  if (!key) return [];
  const raw = await getSetting(key).catch(() => '');
  return raw.split(/[|\n\r,،]+/).map(s => s.trim()).filter(Boolean).slice(0, 6);
}

export async function getSettings<T extends readonly string[]>(keys: T): Promise<Record<T[number], string>> {
  const out = {} as Record<T[number], string>;
  await dbSettings();
  for (const k of keys) out[k as T[number]] = await getSetting(k);
  return out;
}

export async function getNumber(key: string, fallback = 0): Promise<number> {
  const n = Number(await getSetting(key));
  return Number.isFinite(n) ? n : fallback;
}

export async function getBool(key: string): Promise<boolean> {
  const v = (await getSetting(key)).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export interface ResolvedSetting extends SettingDef {
  value: string;
  source: SettingSource;
  envValue: string | null;
  hasEnv: boolean;
}

/** همهٔ تنظیمات به همراه منبع هر مقدار — برای پنل مدیر */
export async function resolveAllSettings(): Promise<ResolvedSetting[]> {
  const rows = await dbSettings();
  return SETTING_DEFS.map(def => {
    const env = envOf(def);
    const dbv = def.envOnly ? undefined : rows[def.key];
    const source: SettingSource = dbv !== undefined && dbv !== '' ? 'db' : env !== undefined ? 'env' : 'default';
    const value = source === 'db' ? (dbv as string) : source === 'env' ? (env as string) : def.default;
    return { ...def, value, source, envValue: env ?? null, hasEnv: env !== undefined };
  });
}

/** ذخیرهٔ گروهی تنظیمات (فقط کلیدهای شناخته‌شده و غیر envOnly) */
export async function saveSettings(entries: Record<string, string>): Promise<number> {
  let saved = 0;
  for (const [key, raw] of Object.entries(entries)) {
    const def = SETTING_BY_KEY[key];
    if (!def || def.envOnly) continue;
    let value = String(raw ?? '').trim();
    // select: فقط مقدارهای مجاز ذخیره می‌شوند (خارج از فهرست → پیش‌فرض)
    if (def.type === 'select' && def.options?.length && !def.options.some(o => o.value === value)) {
      value = def.default;
    }
    await db
      .insert(system_settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: system_settings.key, set: { value } });
    saved++;
  }
  invalidateSettingsCache();
  return saved;
}

/** حذف مقدار دیتابیسی یک کلید → بازگشت به ENV/پیش‌فرض */
export async function resetSettings(keys: string[]): Promise<void> {
  const valid = keys.filter(k => SETTING_BY_KEY[k] && !SETTING_BY_KEY[k].envOnly);
  if (!valid.length) return;
  await db.delete(system_settings).where(inArray(system_settings.key, valid));
  invalidateSettingsCache();
}

// ════════ پیکربندی‌های ترکیبی پرکاربرد ════════

export async function getPublicBaseUrl(): Promise<string> {
  return (await getSetting('PUBLIC_BASE_URL')).replace(/\/+$/, '');
}

export async function getBbbConfig() {
  const [url, secret, moderatorPw, attendeePw, algo] = await Promise.all([
    getSetting('BBB_URL'),
    getSetting('BBB_SECRET'),
    getSetting('BBB_MODERATOR_PW'),
    getSetting('BBB_ATTENDEE_PW'),
    getSetting('BBB_CHECKSUM_ALGO').catch(() => 'SHA256'),
  ]);
  const norm = String(algo || 'SHA256').trim().toUpperCase();
  return {
    url: url.replace(/\/+$/, ''),
    secret,
    moderatorPw,
    attendeePw,
    // الگوریتم امضا: BBB نسخهٔ ۲.۷+ پیش‌فرض SHA256 است (SHA1 برای نصب‌های قدیمی)
    checksumAlgo: (norm === 'SHA1' || norm === 'SHA512' ? norm : 'SHA256') as 'SHA1' | 'SHA256' | 'SHA512',
    autoRecord: await getBool('BBB_AUTO_RECORD'),
    configured: Boolean(url && secret),
  };
}

export async function getPaymentCallbackUrl(): Promise<string> {
  const explicit = await getSetting('PAY_CALLBACK_URL');
  if (explicit) return explicit;
  return (await getPublicBaseUrl()) + '/api/payment/callback';
}

// ════════ سال تحصیلی/مالی شمسی ════════

/**
 * سال تحصیلی جاری:
 *   ۱) تنظیم FA_YEAR (دیتابیس/ENV) — اختیار کامل دست مدیر
 *   ۲) در غیر این صورت محاسبهٔ خودکار از تاریخ روز (تقویم جلالی)
 */
export async function getFiscalYear(): Promise<string> {
  const v = (await getSetting('FA_YEAR')).trim();
  if (v) return v;
  return String(toJalaliFromDate(new Date()).jy);
}

-- جدول مرجع «انواع وضعیت نیمسال» (بازتولید از دیتابیس قدیمی سما — وضعیت نیمسال)
--
-- چرا؟ کارنامهٔ مالی باید وضعیتِ هر نیمسال دانشجو (در حال تحصیل، مرخصی، مهمان،
-- انصراف، معادل‌سازی، معرفی‌به‌استاد، …) را نمایش دهد؛ این جدول تعریفِ مرجعِ
-- ۶۷ وضعیتِ سما (کد ۰ تا ۶۶) را با پرچم‌های مالی/ثبت‌نامی‌اش نگه می‌دارد.
-- ردیف‌های مربوط‌به هر دانشجو در student_term_states قرار دارند و از طریق
-- کدِ وضعیت (sourceStatusCode) به این جدول ربط می‌خورند.
--
-- منبع: فایل «وضعيت نيمسال.txt» (خروجی SAMA، کدگذاری CP1256). ستون ۱۵
-- (کدينگ استاندارد وزارت / STUDENTTERMTYPEID) در خروجیِ سما برای همهٔ ردیف‌ها
-- خالی بود و مقادیرِ پیوند به نوع ترمِ دانشجو در ستون ۱۶ آمده‌اند؛ لذا
-- student_term_type_id از ستون ۱۶ پر می‌شود. این جدول دادهٔ شخصی ندارد ⇒
-- معاف از RLS (سخت‌سازی فقط جداول دارای ستون‌های هویتی را الزام می‌کند).
--
-- idempotent: CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT (code) DO NOTHING.

CREATE TABLE IF NOT EXISTS "public"."term_status_types" (
  "id" serial PRIMARY KEY,
  "code" integer NOT NULL UNIQUE,
  "title" varchar(150) NOT NULL,
  "active_in_term" boolean NOT NULL DEFAULT false,
  "count_in_years" boolean NOT NULL DEFAULT false,
  "allow_register" boolean NOT NULL DEFAULT false,
  "latin_title" varchar(150),
  "standard_code" varchar(20),
  "included_tuition" boolean NOT NULL DEFAULT false,
  "rotbeh_effect" boolean NOT NULL DEFAULT false,
  "use_rating" boolean NOT NULL DEFAULT false,
  "allow_term_status_change_term_enter" boolean NOT NULL DEFAULT false,
  "effect_financial_years" boolean NOT NULL DEFAULT false,
  "include_term_price_mab_subject" boolean NOT NULL DEFAULT false,
  "is_graduate_status" boolean NOT NULL DEFAULT false,
  "student_term_type_id" integer,
  "source" varchar(20) NOT NULL DEFAULT 'SAMA',
  "created_at" timestamp NOT NULL DEFAULT now()
);

COMMENT ON TABLE "public"."term_status_types" IS 'جدول مرجع وضعیت‌های نیمسال (بازتولید سما). کد ۰-۶۶.';

-- ۶۷ ردیفِ وضعیت از سما (idempotent: در صورت تکرار کد، نادیده گرفته می‌شود).
INSERT INTO "public"."term_status_types"
  ("code","title","active_in_term","count_in_years","allow_register","latin_title",
   "standard_code","included_tuition","rotbeh_effect","use_rating",
   "allow_term_status_change_term_enter","effect_financial_years",
   "include_term_price_mab_subject","is_graduate_status","student_term_type_id")
VALUES
  (1,'در حال تحصيل',true,true,true,NULL,'1',true,true,true,false,true,true,false,2),
  (5,'تعليق بدون احتساب سنوات',false,true,false,NULL,'0',true,true,true,false,true,true,false,4),
  (6,'ميهمان به ساير دانشگاهها',true,true,true,NULL,'6',true,true,true,false,true,true,false,5),
  (7,'حذف ترم با احتساب سنوات',false,true,false,NULL,'0',true,true,true,false,true,true,false,6),
  (8,'حذف ترم بدون احتساب سنوات',false,false,false,NULL,'0',true,true,true,false,true,true,false,22),
  (9,'ميهمان از ساير دانشگاهها',true,true,true,NULL,'6',true,true,true,false,true,true,false,7),
  (10,'اخراج',false,true,false,NULL,'5',true,true,true,false,true,true,false,8),
  (11,'انتقال',true,true,true,NULL,'0',true,true,true,false,true,true,false,9),
  (4,'تعليق با احتساب سنوات',false,true,false,NULL,'0',true,true,true,false,true,true,false,4),
  (3,'مرخصي بدون احتساب سنوات',true,false,false,NULL,'2',true,true,true,false,true,true,false,3),
  (2,'مرخصي با احتساب سنوات',true,true,false,NULL,'2',true,true,true,false,true,true,false,3),
  (0,'نامشخص',true,true,true,NULL,'0',false,true,true,false,true,true,false,1),
  (12,'فارغ التحصيل',false,false,false,NULL,'6',true,true,true,false,true,true,false,10),
  (13,'تغيير رشته',true,true,true,NULL,'0',true,true,true,false,true,true,false,11),
  (14,'انتقال توام با تغيير رشته',true,true,true,NULL,'0',true,true,true,false,true,true,false,28),
  (15,'معادل سازي',true,true,true,NULL,'0',true,true,true,false,true,true,false,12),
  (16,'کميسيون م خ',true,true,true,NULL,'0',true,true,true,false,true,true,false,2),
  (17,'معرفي به استاد',true,true,true,NULL,'0',true,true,true,false,true,true,false,2),
  (18,'عدم مراجعه',false,true,true,NULL,'3',true,true,true,false,true,true,false,17),
  (19,'انصراف',false,true,true,NULL,'4',true,true,true,false,true,true,false,13),
  (20,'محروم از تحصيل',false,true,true,NULL,'0',true,true,true,false,true,true,false,14),
  (22,'برابرسازي',true,true,true,NULL,'0',true,true,true,false,true,true,false,16),
  (21,'دروس گذرانده دردانشگاه ديگر',true,true,true,NULL,'6',true,true,true,false,true,true,false,15),
  (23,'بلاتکليف',true,true,true,NULL,'0',true,true,true,false,true,true,false,7),
  (24,'کمسيون م خ _ مهمان به س د',true,true,true,NULL,'0',true,true,true,false,true,true,false,5),
  (25,'مجوز شوراي تحصيلات تکميلي',true,true,true,NULL,'0',true,true,true,false,true,true,false,2),
  (26,'در معادل سازي پذيرفته نشده',true,true,true,NULL,'0',true,true,true,false,true,true,false,12),
  (27,'مهمان از دانشگاه غ ف',true,true,true,NULL,'6',true,true,true,false,true,true,false,7),
  (28,'اتمام دروس _ تسويه نکرده',false,true,true,NULL,'0',true,true,true,false,true,true,false,10),
  (29,'عدم مراجعه _ ح',false,false,false,NULL,'3',true,true,true,false,true,true,false,17),
  (30,'*انتقال از ترم قبل*',true,true,false,NULL,'6',true,true,true,false,true,true,false,17),
  (31,'کميسيون‌‌مواردخاص‌فارغ‌التحصيل',false,false,false,NULL,'6',true,true,true,false,true,true,false,19),
  (32,'کميسيون‌مواردخاص‌فقط‌1‌ترم‌ش',true,true,true,NULL,'0',true,true,true,false,true,true,false,2),
  (33,'شهيد',false,false,false,NULL,'0',true,true,true,false,true,true,false,1),
  (34,'اخراج - اداره ثبت نام',true,true,true,NULL,'5',true,true,true,false,true,true,false,8),
  (35,'د-گ-دوره شبانه دردانشگاه د',true,true,true,NULL,'6',true,true,true,false,true,true,false,1),
  (36,'د-گ- در دوره هاي شبانه',true,true,true,NULL,'0',true,true,true,false,true,true,false,1),
  (37,'منع‌موقت‌تحصيل‌بدون‌احتساب‌سنو',false,true,false,NULL,'0',true,true,true,false,true,true,false,17),
  (38,'معادل‌سازي _ دانشگاه‌پيام‌نور',true,false,false,NULL,'6',true,true,true,false,true,true,false,12),
  (39,'مهمان‌به‌سايردانشگاه_کميسيون',true,true,true,NULL,'6',true,true,true,false,true,true,false,5),
  (40,'مرخصي‌بااحتساب‌_کميسيون',true,true,true,NULL,'2',true,true,true,false,true,true,false,3),
  (41,'انصرافي‌حين تحصيل',true,true,true,NULL,'4',true,true,true,false,true,true,false,13),
  (42,'مرخصي‌با‌احتساب‌واخراج',false,true,false,NULL,'2',true,true,true,false,true,true,false,3),
  (43,'عدم مراجعه-ك.م.خ',true,true,true,NULL,'0',true,true,true,false,true,true,false,17),
  (44,'ک.م.خ - ترم جاري شبانه',true,true,true,NULL,'0',true,true,true,false,true,true,false,1),
  (45,'در حال تحصيل -',true,true,true,NULL,'1',true,true,true,false,true,true,false,2),
  (46,'فوت',true,true,true,NULL,'0',true,true,true,false,true,true,false,20),
  (47,'ک‌.م‌.خ‌.فقط‌1ترم‌شبانه‌.ف',true,true,true,NULL,'0',true,true,true,false,true,true,false,1),
  (48,'تمديد سنوات پروژه ياپايان نامه',true,true,true,NULL,'0',true,true,true,false,true,true,false,2),
  (49,'مهمان به س دانشگاه- فارغ التحص',false,true,false,NULL,'6',true,true,true,false,true,true,false,21),
  (50,'در حال تحصيل - جبراني',true,true,true,NULL,'1',true,true,true,false,true,true,false,2),
  (51,'کميسيون‌خاص.مهمان‌از',true,true,true,NULL,'0',true,true,true,false,true,true,false,18),
  (52,'حذف‌ترم‌با‌احتساب‌_کميسيون',true,true,true,NULL,'0',true,true,true,false,true,true,false,22),
  (53,'كميسيون م خ -بازگشت به تحصيل',true,true,true,NULL,'0',true,true,true,false,true,true,false,2),
  (54,'عدم‌مراجعه‌تحصيلات‌تکميلي',false,false,false,NULL,'3',true,true,true,false,true,true,false,17),
  (55,'ادامه پايان نامه',true,true,true,NULL,'0',true,true,true,false,true,true,false,2),
  (56,'معادلسازي-',true,false,true,NULL,'0',true,true,true,false,true,true,false,12),
  (57,'در حال تحصيل-کارورزي',true,true,true,NULL,NULL,true,true,true,false,true,true,false,2),
  (58,'اعلامي سنجش بدون احتساب سنوات',true,true,true,NULL,NULL,true,true,true,false,true,true,false,27),
  (59,'ترميم معدل',true,true,true,NULL,NULL,true,true,true,false,true,true,false,2),
  (60,'مرخصي تحصيلي بدون احتساب سنوات',true,false,true,NULL,NULL,true,true,true,false,true,true,false,3),
  (61,'ترم اخر',true,true,true,NULL,NULL,true,true,true,false,true,true,false,2),
  (62,'مرخصي پزشكي بدون احتساب سنوات',true,true,true,NULL,NULL,true,true,true,false,true,true,false,3),
  (63,'ك م خ - معرفي به استاد',true,true,true,NULL,NULL,true,true,true,false,true,true,false,2),
  (64,'مرخصي با احتساب -انتقالي',false,true,false,NULL,NULL,true,true,true,false,true,true,false,3),
  (65,'بازگشت به نحصيل',true,true,true,NULL,NULL,true,true,true,false,true,true,false,2),
  (66,'انصراف- اخذ مدرك معادل',false,true,true,NULL,NULL,true,true,true,false,true,true,false,13)

ON CONFLICT ("code") DO NOTHING;

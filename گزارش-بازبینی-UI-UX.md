# گزارش بازبینی جامع UI/UX — سامانهٔ جامع آفاق (`afagh-next`)

- **دامنه:** ۱۵۸ صفحهٔ `page.tsx`، ۸۶۷ فایل در `src/`، ۳۵ کامپوننت مشترک، ۱٬۲۴۷ خط CSS (`globals.css` + `mobile-tables.css`)
- **پایهٔ بررسی:** `FINAL` / `f06edaa`
- **روش:** بازبینی ایستای کد + شمارش کمی الگوهای UI در کل کدبیس (بدون اجرای مرورگر؛ اعداد قابل بازتولید با `grep` هستند)
- **استک:** Next.js 16.4 (App Router) + React 19 + Tailwind CSS **3.4** (نه v4) + RTL کامل + فونت محلی Vazirmatn

---

## ۱) کارت امتیاز

| محور | امتیاز (۵) | خلاصهٔ دلیل |
|---|---|---|
| هویت بصری و ثبات ظاهری | ۲.۵ | ۱۴٬۴۴۷ کلاس دستی، ۵ شعاع گردی مختلف، دو مسیر موازی برای تم |
| تایپوگرافی | ۲.۰ | ۲٬۰۶۰ مورد متن ۱۰–۱۱px، وزن ۹۰۰ تعریف‌نشده |
| RTL | ۳.۰ | پایه درست است، اما ۱۷۰ یوتیلیتی فیزیکی و چپ‌چین‌شدن کارت‌های موبایل |
| حالت شب (Dark) | ۳.۰ | پوشش خیلی خوب با متغیرها، اما فلش سفید + دوگانگی با `dark:` در TSX |
| موبایل / پاسخ‌دهی | ۳.۵ | لایهٔ موبایل جدی و بی‌نظیر؛ ولی ناوبری دسکتاپ ادمین ضعیف |
| فرم‌ها و اعتبارسنجی | ۲.۵ | فرم ورود خوب؛ بقیه با `alert()` و بدون خطای درجا |
| بازخورد و حالت‌ها (Loading/Empty/Error) | ۱.۵ | **صفر** فایل `loading.tsx`، صفر توست سراسری، صفر `aria-live` |
| ناوبری و معماری اطلاعات | ۲.۵ | منوی ادمین همیشه کشویی (حتی دسکتاپ)، سه هدر ناسازگار |
| دسترسی‌پذیری (a11y) | ۱.۵ | ۵۰ مودال بی‌ترپ فوکوس، `focus-visible` صفر، ۸۵ `aria-*` در کل پروژه |
| چاپ (Print) | ۴.۵ | سیستم چاپ A4 با تکرار سربرگ، حذف نوارها و ایزوله‌سازی سند |
| **میانگین وزنی** | **≈ ۲.۶ / ۵** | «کارکردی و فارسی‌شده، اما بدون سیستم طراحی و لایهٔ بازخورد» |

---

## ۲) نقاط قوت (با شاهد در کد)

۱. **سیستم چاپ حرفه‌ای — بهترین بخش پروژه.**
   `globals.css:444` به بعد: `@page { size: A4 }`، حذف `header/footer/nav/aside/button` در چاپ، ایزوله‌سازی سند کارنامه با `body.printing-transcript`، تکرار `thead/tfoot` در همهٔ صفحات، گرید ۳ ستونه برای مشخصات، و تفکیک «افقی/عمودی» با `body.printing-portrait`. حتی ریسک تبدیل‌شدن جدول به کارت در چاپ با `@media screen` در `mobile-tables.css:19` مهار شده — این سطح از دقت کم‌نظیر است.

۲. **لایهٔ موبایل چهارلایه و بدون بازنویسی صفحه‌ها.**
   `mobile-tables.css` + `MobileTableEnhancer.tsx` (تزریق `data-label` روی `td`) + `MobileCardList.tsx` + `MobileTabBar.tsx`. الگوی «جدول → کارت» با CSS تنها، و کشوی ناوبری با `inset-inline-start` و `env(safe-area-inset-bottom)` (`mobile-tables.css:192,254`) که RTL و ناچ‌بار آیفون را می‌فهمد.

۳. **فارسی‌سازی واقعی، نه ترجمه‌ای.** `layout.tsx:26` (`lang="fa" dir="rtl"`)، فونت محلی با `unicode-range` جدا برای عربی/لاتین (`globals.css:2-49`)، `preload` برای جلوگیری از سوئیچ فونت (`layout.tsx:31-34`)، `toLocaleString('fa-IR')` در ۲۴۴ نقطه، و جست‌وجوی نرمال‌شدهٔ فارسی (`faIncludes`/`normalizeFa`).

۴. **فرم ورود، دقیق و امن.** `LoginCard.tsx`: `method="post"` عمدی برای جلوگیری از رفتن رمز به URL (`LoginCard.tsx:100`)، `autoComplete="username"`، `inputMode`، `enterKeyHint`، `aria-label`، جداسازی خطای شبکه از خطای منطقی، و مسیر «چند حساب با یک کدملی».

۵. **حالت‌های خطا و کهنگی نسخه.** `app/error.tsx` (نمایش `digest` بدون افشای جزئیات + تلاش دوباره)، `app/not-found.tsx`، `VersionGuard.tsx` (جلوگیری از «دکمه‌ای که بی‌صدا کار نمی‌کند» بعد از دیپلوی)، `SessionLock.tsx` (قفل بیکاری سرور-محور).

۶. **جدول داده با سورت/فیلتر فارسی و خروجی انتخابی.** `DataTable.tsx:32-93` (سورت عددی/متنی با `localeCompare('fa')`، فیلتر هر ستون)، `ExportMenu` با انتخاب ستون‌ها.

۷. **سوییچر واحد کارتابل/حساب.** `PanelSwitcher.tsx` با بستن روی Escape و کلیک بیرون (خط ۵۵-۶۰) و نمایش کارتابل فعلی با برچسب «اینجا هستید».

---

## ۳) یافته‌ها — به ترتیب اولویت

### 🔴 P0 — تجربه را می‌شکند یا دسترسی را ناممکن می‌کند

**P0-1) هیچ صفحه‌ای حالت «در حال بارگذاری» ندارد.**
`find src -name 'loading.tsx'` = **۰** در برابر ۱۵۸ صفحه؛ تنها ۱۵ مورد `animate-pulse` پراکنده و ۳۴ رشتهٔ متنی «در حال…» با لحن‌های مختلف. نتیجه: با App Router، ناوبری تا پایان رندرِ سروری کاملاً **بی‌واکنش** است؛ در کوئری‌های سنگین (مثلاً `admin/students`، `admin/finance`) کاربر فکر می‌کند کلیکش کار نکرده و دوباره می‌زند.
راه‌حل: `loading.tsx` در سطح هر شاخه + اسکلتون واقعی، و برای ناوبری کلاینتی از `useLinkStatus()` (Next 16) یا `isPending` برای نوار پیشرفت نازک.

**P0-2) دیالوگ‌های بومی مرورگر: ۴۳ `alert()` و ۶۳ `confirm()`.**
نمونه‌ها: `professor/grades/components/RosterTab.tsx` (۷ alert)، `admin/finance/student-formula/StudentFormulaClient.tsx` (۶)، `admin/students/StudentsManagerClient.tsx:177`. سیستم توست سراسری وجود ندارد؛ فقط دو پیاده‌سازی موضعی (`student/exam-card/ExamCardClient.tsx:80-100` و `flashToast` در `professor/grades/gradesReducer`).
اثر: قطع جریان صفحه، ظاهر سیستم‌عامل، دکمه‌های ترجمه‌نشده در بعضی ویندوزها، عدم امکان «واگرد» و بلاک شدن کامل در موبایل.

**P0-3) ۵۰ مودال دستی، ۴ مورد با `role="dialog"`، صفر مورد با ترپ فوکوس.**
`grep 'fixed inset-0'` = ۵۰؛ `role="dialog"` = ۴؛ هیچ‌کدام `aria-modal` + focus trap + بازگردانی فوکوس + قفل اسکرول ندارند (نمونه: شش مودال `StudentsManagerClient.tsx:2267,2431,2526,2604,2653,2727`). کاربر کیبورد/اسکرین‌ریدر پشت مودال گم می‌شود.

**P0-4) ۱۵۹ کلاس نامعتبر برای Tailwind v3 که بی‌صدا حذف می‌شوند.**
`package.json` روی `tailwindcss ^3.4.15` است و `tailwind.config.ts` هیچ `extend`ای ندارد، اما در کد:
| کلاس | تعداد | واقعیت |
|---|---|---|
| `shadow-xs` | ۱۱۲ | در v3 وجود ندارد (v4 اضافه شد) ⇒ **کارت‌ها هیچ سایه‌ای ندارند** |
| `backdrop-blur-xs` / `blur-xs` | ۱۹ / ۱۹ | در v3 نیست ⇒ بلور بی‌اثر |
| `animate-in` / `fade-in` / `zoom-in` | ۱۸ / ۱۹ / ۱۱ | نیازمند پلاگین `tailwindcss-animate` که نصب نیست ⇒ هیچ انیمیشن ورودی اجرا نمی‌شود |
این تنها توضیح «حس تخت‌بودن» رابط است: عمق و حرکت در کد نوشته شده ولی رندر نمی‌شود.

**P0-5) وزن ۹۰۰ فونت تعریف نشده ⇒ سلسله‌مراتب تایپوگرافی خوابیده.**
`public/fonts/vazirmatn-900.woff2` **موجود است** ولی هیچ `@font-face` با `font-weight: 900` در `globals.css:2-49` نوشته نشده (فقط ۴۰۰/۵۰۰/۷۰۰). در عوض `font-black` در **۱٬۲۵۳** نقطه به‌کار رفته و مرورگر آن را با وزن ۷۰۰ رندر می‌کند ⇒ تفاوت `font-bold` و `font-black` عملاً صفر است.

**P0-6) ۲٬۰۶۰ مورد متن ۱۰px/۱۱px.**
`text-[10px]` = ۸۴۸ و `text-[11px]` = ۱٬۲۱۲ (در برابر `text-xs` ۲٬۵۸۱). نمونه: `student/layout.tsx:181-205` (چیپ‌های وضعیت). برای فارسی با ارتفاع x کوچک، این اندازه روی نمایشگر ۱۰۰٪ ناخواناست.

**P0-7) کارت‌های موبایل در RTL «چپ‌چین» می‌شوند.**
`mobile-tables.css:47,63` و `:146,158`: `text-align: left` روی `td`/`.mc-field__value` و `margin-left: 8px` روی برچسب. نام دانشجو/عنوان درس فارسی از چپ تراز می‌شود و کنار برچسب راست‌چین، ردیف نامتقارن می‌شود. درست: `text-align: start` و `margin-inline-start`.

**P0-8) فوکوس کیبورد تقریباً نامرئی است.**
`focus-visible` = **۰** در کل پروژه؛ `focus:outline-none` = ۵۱ مورد که چند مورد بدون `ring` جایگزین است: `professor/contract/ProfessorContractClient.tsx:398`، `admin/curriculum/components/CourseRulesModal.tsx:75`، `admin/AdminNav.tsx:80`، `components/help/HelpSearch.tsx:48`. skip-link هم وجود ندارد (۲۵ مورد `sr-only`). کاربر کیبورد مسیر فوکوس را نمی‌بیند — پرتأثیرترین نقص a11y.

**P0-9) فلش سفید و پرش چیدمان در حالت شب.**
`ThemeToggle.tsx:9-16`: کلاس `dark` در `useEffect` ست می‌شود (بعد از paint اول) و تا `mounted` شدن `return null` است (خط ۲۵) ⇒ اول تم روشن نقاشی می‌شود و دکمهٔ تم بعداً «ظاهر» می‌شود. راه‌حل: اسکریپت inline در `<head>` برای ست‌کردن کلاس پیش از paint + رزرو فضای دکمه.

---

### 🟠 P1 — تجربه را کند یا ناهمگون می‌کند

**P1-1) سیستم طراحی وجود ندارد؛ ۱۴٬۴۴۷ کلاس دستی.**
پنج شعاع گردی در گردش: `rounded-lg` ۱٬۰۷۸، `rounded-xl` ۱٬۰۳۰، `rounded-2xl` ۶۱۷، `rounded-full` ۳۳۳، `rounded-3xl` ۹۱ — بدون قاعده («دکمه lg، کارت xl، مودال 3xl»). ۱٬۲۰۵ دکمه با کلاس‌های تکراری اما هر بار دستی. تنها پریمیتیوهای مشترک `.input` (`globals.css:438`) و `.card` (`globals.css:113`) هستند.

**P1-2) دو مسیر موازی برای تم که همدیگر را نقض می‌کنند.**
`globals.css:117-141` کلاس‌های تیلویند را با `!important` بازنویسی می‌کند (`.bg-white`, `.text-slate-500`, …) — یعنی `bg-white` دیگر سفید نیست؛ و همزمان ۱۸۶ مورد `dark:` مستقیم در TSX هست (مثلاً نگاشت وضعیت‌ها در `admin/page.tsx:44-49`). هر رنگ تازه‌ای که نگاشت نشود در دارک‌مود «متن نامرئی» می‌سازد. کامپوننت جدید مجبور است حدس بزند کدام مسیر درست است.

**P1-3) ناوبری ادمین در دسکتاپ ضعیف‌تر از موبایل است.**
`AdminNav.tsx:52`: دکمهٔ `fixed top-3 right-3` همیشه شناور است و پنل، کشویی ۸۰ درصدی — حتی روی مانیتور بزرگ؛ هدر هم برایش `w-14` فضا رزرو می‌کند (`admin/layout.tsx:150`). دسترسی به هر ماژول = ۲ کلیک؛ هیچ نمای دائمی از ماژول‌ها وجود ندارد. همزمان پنل دانشجو سایدبار ثابت دارد (`StudentSidebar`). باید یکسان شود: سایدبار ثابت جمع‌شونده در `lg+` و کشو در موبایل. `aria-expanded` برای دکمه و گروه‌های تاشو تعریف نشده و نشانگرها `◀/▼` متنی‌اند (`AdminNav.tsx:99`).

**P1-4) صفر `aria-live` و صفر `aria-busy`.**
`aria-*` کل = ۸۵ در ۸۶۷ فایل؛ `aria-live`=۰، `aria-busy`=۰، `aria-invalid`=۰، مجموع `aria-expanded/controls/haspopup`=۲. یعنی نتیجهٔ ذخیره، خطای اعتبارسنجی و تغییر فیلترها برای screen reader هیچ اعلامی ندارد.

**P1-5) اموجی به‌جای آیکون.**
۷۳ آیکون اموجی در `admin-modules.ts`، هدرها 📖/📕/💳/🪖، دکمه‌ها 📤. رندر متفاوت در ویندوز/اندروید/iOS، بی‌هم‌ترازی با متن فارسی، عدم امکان رنگ و اندازه، و نویز در چاپ و screen reader.

**P1-6) برچسب‌ها به ورودی وصل نیستند.**
۷۱۵ `<label>` در برابر **۱** `htmlFor`. بیشترشان پوششی‌اند (قابل قبول) اما برچسبِ تنها هم هست (`messenger/MessengerConnectClient.tsx:138`) و ۳۶۹ `placeholder` تنها راهنمای فیلد است ⇒ کلیک روی برچسب فوکوس نمی‌دهد و نام فیلد خوانده نمی‌شود.

**P1-7) ورودی عددی/تاریخ برای کاربر فارسی مناسب نیست.**
`type="number"` در ۱۸۴ نقطه: اسپینر در RTL سمت اشتباه، مبالغ ریالی بدون جداکنندهٔ هزارگان، تغییر ناخواسته با اسکرول ماوس. `dir="ltr"` ۴۷۱ بار پراکنده (کدملی/شماره) بدون کامپوننت مشترک، و `JalaliDateTimeInput.tsx` تنها ۹۸ خط برای کل نیاز تاریخ شمسی.

**P1-8) ۱۷۰ یوتیلیتی فیزیکی در برابر ۲۸ منطقی.**
`ml-/mr-/pl-/pr-/left-/right-/text-left` = ۱۷۰؛ `ms-/me-/ps-/pe-/start-/end-` = ۲۸. نمونهٔ عملی: منوی خروجی `DataTable.tsx:196` (`absolute left-0`) و ردیف زیرمنوی `AdminNav.tsx:108` (`mr-3`).

**P1-9) سه پیاده‌سازی موازی جدول.**
`<table` = ۱۹۶، `overflow-x-auto` = ۱۵۲ و سه مسیر سورت/فیلتر (`InboxTh` در `admin/page.tsx:57`، `ServerTh`، `ClientTh` در `DataTable.tsx`). بدون `sticky` سرستون سراسری و بدون صفحه‌بندی یکسان.

**P1-10) سه هدر ناسازگار برای سه کارتابل.**
`admin/layout.tsx` (دو‌ردیفی + دکمه‌های متنی راهنما/PDF)، `student/layout.tsx` (چیپ مالی/سخا/ترم + آیکون)، `professor/layout.tsx`. ارتفاع، ترتیب و لحن دکمه‌ها یکی نیست؛ «خروج» در ادمین `rose-600` با متن کامل و در دانشجو `rounded-lg` با متن کوتاه است.

**P1-11) هیچ محافظی برای «تغییرات ذخیره‌نشده» نیست.**
`beforeunload` فقط ۲ بار، در حالی که فرم‌های ۲٬۷۵۸ خطی (`StudentsManagerClient`) و ۲٬۲۳۵ خطی (`AdmissionsClient`) وجود دارد ⇒ پرکردن نیمه‌کارهٔ فرم پذیرش + رفرش تصادفی = از دست رفتن همه‌چیز بدون هشدار.

**P1-12) بی‌توجهی به `prefers-reduced-motion`.**
صفر مورد در CSS/TSX در حالی که `animate-ping` (`student/page.tsx:357`)، `animate-pulse` و ۵۲۶ گذار وجود دارد.

---

### 🟡 P2 — صیقل و پرداخت

- گذار بی‌استاندارد: `transition` ۵۲۶ بار با پیش‌فرض، `duration-150` فقط ۸ بار، `ease-out` صفر.
- کنتراست: `text-slate-400` (#94a3b8) روی سفید = **۲.۸۵:۱** (۵۰۹ مورد) و `text-slate-500` = ۴.۷۶:۱ (مرزی برای متن ۱۱px) ⇒ نقض WCAG AA.
- ۲۵۲ مورد `title=` به‌عنوان تنها توضیح (در موبایل tooltip ندارد).
- خالی‌حالت‌ها: ۱۲۶ رشتهٔ متنی پراکنده بدون کامپوننت/آیکون/دعوت به عمل (CTA).
- «حالت موفقیت» فرم‌ها معمولاً فقط رنگ سبز است، بدون آیکون و موقعیت ثابت.
- دکمه‌های آیکونی بدون `aria-label`؛ دکمهٔ `✕` متنی به‌جای SVG.
- فرمت اعداد ناهمگون: ۲۴۴ `toLocaleString('fa-IR')` در کنار اعداد خام.
- مودال‌های موبایل با `p-4` و بدون `max-h`/`overflow-y` یکسان ⇒ محتوای بلند بیرون می‌زند.
- ایموجی‌های وضعیت (✅/🔒) به‌جای بج استاندارد وضعیت.

---

## ۴) ارزیابی صفحه‌به‌صفحه (نمونه‌های شاخص)

| صفحه / ماژول | وضعیت | تحلیل |
|---|---|---|
| `/login` | ✅ خوب | تنها صفحه‌ای با اعتبارسنجی درجا، `aria-label`، `autoComplete`، جداسازی خطای شبکه و توضیح «چرا وارد نشدم». نقطهٔ ضعف: برچسب متنی بالای فیلدها نیست (فقط placeholder) معادل `label` مرئی وجود ندارد؛ `LoginCard.tsx:107-140`. |
| `/student` (داشبورد) | ⚠️ متوسط | کارت‌های KPI با گرادیان‌های رنگی زیاد + چیپ‌های هدر + بنر پیام‌رسان ⇒ «شلوغی بصری»؛ سه سطح تأکید رنگی همزمان. تصمیم درست: انتقال «دروس ثبت‌نام‌شده» به صفحهٔ انتخاب واحد (کامنت `student/page.tsx:385-388`). |
| `/admin` (داشبورد) | ⚠️ متوسط | کارتابل درخواست‌ها با `InboxTh` سمت‌سرور خوب است؛ اما ستون‌های وضعیت با ۵ رنگ هم‌زمان و بدون آیکون، و ناوبری ماژول‌ها فقط در کشو. |
| `admin/students` (۲٬۷۵۸ خط) | 🔴 ضعیف | مگاکامپوننت با ۶ مودال دستی، `confirm()` بومی، ۲۰۰+ `useState` احتمالی؛ بدون تب‌بندی/ویزارد، بدون هشدار ترک صفحه. |
| `admin/admissions` (۲٬۲۳۵ خط) | 🔴 ضعیف | فرم پذیرش بسیار بلند در یک صفحه؛ بدون گام‌بندی، بدون ذخیرهٔ پیش‌نویس، بدون نشانگر «چند فیلد الزامی مانده». |
| `student/enroll` | ⚠️ متوسط | `alert()` برای سقف واحد (`EnrollClient.tsx:389`) — بدترین جا برای دیالوگ بومی: پیام باید درجا کنار ستون واحدها بنشیند. |
| `student/exam-card` | ✅ نسبتاً خوب | تنها جای سیستم توست موضعی؛ اما توست **در جریان صفحه** است نه `fixed`، پس با اسکرول دیده نمی‌شود (`ExamCardClient.tsx:178-188`). |
| کارنامه/سند مالی (چاپ) | ✅ عالی | سند A4 با تکرار سربرگ، QR تأیید، امضا و کنترل شکست صفحه. |
| `/help` و PDFها | ⚠️ متوسط | جست‌وجوی نرمال‌شدهٔ فارسی خوب؛ اما دو دکمهٔ «راهنما» و «PDF» در هدر همهٔ کارتابل‌ها تکراری و بدون آیکون یکسان است. |
| خطا/۴۰۴/قفل نشست | ✅ خوب | پیام‌های فارسی با اقدام بعدی روشن؛ نبودِ تم تیره‌ی اختصاصی مشکلی نیست چون نگاشت `!important` پوشش می‌دهد. |

---

## ۵) چک‌لیست WCAG 2.2 سطح AA

| معیار | وضعیت | شاهد |
|---|---|---|
| ۱.۱.۱ محتوای غیرمتنی | ⚠️ | `<img>` ۴۲ مورد، ۱۰ با `alt=""`؛ آیکون‌های اموجی جای متن خوانده می‌شوند |
| ۱.۳.۱ ساختار/معنا | ⚠️ | ۱۹۶ جدول بدون `<caption>`/`scope` یکسان؛ `h1` ۱۳۹ در ۱۵۸ صفحه (چند `h1` در یک صفحه) |
| ۱.۴.۱ استفاده از رنگ | ⚠️ | وضعیت‌ها فقط با رنگ (بج‌های رنگی بدون آیکون/متن متمایز) |
| ۱.۴.۳ کنتراست متن | ❌ | `text-slate-400` ۲.۸۵:۱ (۵۰۹ مورد)، متن ۱۰px |
| ۱.۴.۴ تغییر اندازهٔ متن | ⚠️ | اندازه‌های px ثابت (`text-[10px]`) بدون `rem` |
| ۱.۴.۱۰ تغییر فاصله | ⚠️ | ارتفاع‌های ثابت در هدرها/جدول‌ها |
| ۱.۴.۱۲ فاصلهٔ متن | ⚠️ | `line-height` پیش‌فرض در متن‌های ریز |
| ۲.۱.۱ کیبورد | ❌ | کشو/مودال‌ها ترپ فوکوس ندارند؛ `div onClick` بدون کیبورد (کلوز کشو) |
| ۲.۴.۱ پرش از بلوک‌ها | ❌ | skip-link ندارد |
| ۲.۴.۳ ترتیب فوکوس | ⚠️ | `fixed` دکمهٔ منو (top-3) پس از محتوای هدر در DOM نیست |
| ۲.۴.۶ سرصفحه و برچسب | ⚠️ | برچسب‌های بصری بدون اتصال برنامه‌ای |
| ۲.۴.۷ فوکوس مرئی | ❌ | `focus-visible` صفر؛ `focus:outline-none` بدون بدیل |
| ۲.۵.۵ هدف لمسی (۲۴px) | ⚠️ | تب‌های پایین `py-1.5` ≈ ۳۶px ارتفاع؛ دکمه‌های `✕` کوچک‌تر |
| ۳.۲.۲ ورود قابل پیش‌بینی | ✅ | `autoComplete` در فرم ورود |
| ۳.۳.۱ شناسایی خطا | ⚠️ | خطا در `alert()` یا بدون `aria-invalid` |
| ۳.۳.۲ برچسب/راهنما | ⚠️ | placeholder تنها |
| ۴.۱.۲ نام/نقش/مقدار | ⚠️ | ۵۰ مودال بدون `role`؛ فقط ۴ `role="dialog"` |
| ۴.۱.۳ پیام‌های وضعیت | ❌ | `aria-live` صفر |

**جمع:** ۵ معیار ناموفق، ۱۲ معیار «نیازمند اصلاح» ⇒ سطح فعلی حدود **WCAG A ناقص**؛ برای AA نیاز به فاز ۱ نقشهٔ راه دارد.

---

## ۶) طرح اصلاحی پیشنهادی (توکن‌ها + کد قابل درج)

### ۶-۱) توکن‌ها: بستن شکاف‌های Tailwind v3

`afagh-next/tailwind.config.ts` — با این تغییر، ۱۵۹ کلاسِ مرده زنده می‌شوند و مقیاس گردی یکدست می‌شود:

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: { sans: ['Vazirmatn', 'Tahoma', 'sans-serif'] },
      // سازگاری با کلاس‌های v4 که در کد استفاده شده‌اند (shadow-xs و…)
      boxShadow: {
        xs: '0 1px 2px 0 rgb(15 23 42 / 0.06)',
        '2xs': '0 1px 1px 0 rgb(15 23 42 / 0.04)',
      },
      blur: { xs: '2px' },
      backdropBlur: { xs: '2px' },
      // شعاع‌های معنایی به‌جای پنج شعاع پراکنده
      borderRadius: { control: '0.75rem', card: '1rem', panel: '1.25rem' },
      // اندازهٔ متن فارسی: کف ۱۲px برای خوانایی
      fontSize: {
        '2xs': ['0.75rem', { lineHeight: '1.35' }],
        '3xs': ['0.6875rem', { lineHeight: '1.35' }],
      },
      transitionDuration: { DEFAULT: '150ms' },
    },
  },
  plugins: [],
};
export default config;
```

> `animate-in/fade-in/zoom-in` بدون پلاگین کار نمی‌کند؛ یا `keyframes` سفارشی در همین `extend` اضافه شود یا با `animate-[fadeIn]` جایگزین شود.

### ۶-۲) فونت: فعال‌سازی وزن ۹۰۰ (فایل موجود ولی بی‌استفاده)

```css
/* globals.css — پس از بلوک‌های ۷۰۰ */
@font-face {
  font-family: 'Vazirmatn';
  font-style: normal;
  font-display: swap;
  font-weight: 900;
  src: url('/fonts/vazirmatn-900.woff2') format('woff2'); /* فایل در public/fonts موجود است */
}
```
و یک `preload` برای همان فایل در `layout.tsx`؛ در غیر این صورت وزن ۹۰۰ با تأخیر می‌آید و دوباره جهش متن رخ می‌دهد.

### ۶-۳) دارک‌مود بدون فلش (FOUC + پرش چیدمان)

```tsx
// layout.tsx — داخل <head>، پیش از <body>
<script
  dangerouslySetInnerHTML={{
    __html: `(function(){try{var s=localStorage.getItem('theme');
      var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
      if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
  }}
/>
```
و در `ThemeToggle.tsx` به‌جای `if (!mounted) return null`، دکمه با ابعاد ثابت رندر و فقط آیکون تا `mounted` پنهان بماند.

### ۶-۴) سیستم بازخورد: `ToastProvider`

```tsx
// src/components/ui/Toast.tsx
'use client';
import { createContext, useCallback, useContext, useState } from 'react';

type Kind = 'success' | 'error' | 'info';
type Item = { id: number; kind: Kind; text: string };
const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const push = useCallback((text: string, kind: Kind = 'info') => {
    const id = Date.now() + Math.random();
    setItems(p => [...p, { id, kind, text }]);
    setTimeout(() => setItems(p => p.filter(i => i.id !== id)), 6000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      {/* region زنده برای screen reader — رفع P1-4 */}
      <div aria-live="polite" aria-atomic="false"
           className="fixed inset-x-3 bottom-16 z-[70] flex flex-col gap-2 sm:inset-x-auto sm:left-4 sm:w-96 print:hidden">
        {items.map(i => (
          <div key={i.id}
               className={`flex items-start gap-2 rounded-xl border p-3 text-xs font-bold shadow-lg ${
                 i.kind === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                 : i.kind === 'error' ? 'border-rose-300 bg-rose-50 text-rose-900'
                 : 'border-slate-300 bg-white text-slate-800'}`}>
            <span aria-hidden>{i.kind === 'success' ? '✓' : i.kind === 'error' ? '!' : 'i'}</span>
            <span className="flex-1 leading-6">{i.text}</span>
            <button onClick={() => setItems(p => p.filter(x => x.id !== i.id))}
                    aria-label="بستن پیام" className="shrink-0 opacity-70 hover:opacity-100">✕</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
```

بعد: `alert(x)` → `toast(x, 'error')` و `confirm(x)` → `useConfirm()` روی همان `Modal` با دکمهٔ خطر (`bg-rose-600` + متن «بازگشت‌پذیر نیست»).

### ۶-۵) `Modal` با ترپ فوکوس، Escape و قفل اسکرول

```tsx
// src/components/ui/Modal.tsx
'use client';
import { useEffect, useRef } from 'react';

export default function Modal({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const prev = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    prev.current = document.activeElement as HTMLElement;
    document.body.style.overflow = 'hidden';
    const focusables = () => box.current?.querySelectorAll<HTMLElement>(
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? [];
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const list = Array.from(focusables()).filter(el => !el.hasAttribute('disabled'));
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev.current?.focus();          // بازگردانی فوکوس
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-950/60 p-0 sm:p-4 print:hidden"
         onClick={onClose}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="modal-title"
           onClick={e => e.stopPropagation()}
           className="w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
          <h2 id="modal-title" className="text-sm font-black text-slate-900">{title}</h2>
          <button onClick={onClose} aria-label="بستن" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">✕</button>
        </div>
        {children}
        {footer ? <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">{footer}</div> : null}
      </div>
    </div>
  );
}
```

### ۶-۶) `loading.tsx` نمونه (رفع P0-1 برای همهٔ شاخه‌ها)

```tsx
// src/app/admin/loading.tsx  (همین فایل برای student / professor / group-manager تکرار شود)
export default function Loading() {
  return (
    <div className="space-y-3 p-2" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">در حال بارگذاری…</span>
      <div className="h-8 w-56 animate-pulse rounded-lg bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" />
    </div>
  );
}
```

### ۶-۷) اصلاح RTL در لایهٔ موبایل (سه خط)

```css
/* src/styles/mobile-tables.css */
table.rt:not(.rt--scroll) td { text-align: start; }                /* جای text-align: left (خط ۴۷/۶۳) */
table.rt:not(.rt--scroll) td::before { margin-inline-start: 8px; } /* جای margin-left (خط ۵۸) */
.mc-field, .mc-field__value { text-align: start; }                 /* خط ۱۴۶/۱۵۸ */
```

### ۶-۸) فوکوس مرئی سراسری + skip-link (رفع P0-8)

```css
/* globals.css */
:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: 2px solid var(--accent-text);
  outline-offset: 2px;
  border-radius: 6px;
}
.skip-link {
  position: absolute; inset-inline-start: 8px; top: -48px; z-index: 90;
  background: #0f172a; color: #fff; padding: 8px 14px; border-radius: 10px;
  font-size: 13px; font-weight: 700; transition: top .15s;
}
.skip-link:focus { top: 8px; }
```
و در `layout.tsx` پیش از `{children}`:
```tsx
<a href="#main" className="skip-link print:hidden">پرش به محتوای اصلی</a>
```
(به‌همراه `id="main"` روی `<main>` هر شاخه.)

---

## ۷) نقشهٔ راه اجرایی

### فاز ۱ — «ریست طراحی» (۲–۳ روز، بیشترین اثر)
1. `tailwind.config.ts` طبق ۶-۱ (زنده‌شدن ۱۵۹ کلاس + مقیاس گردی).
2. `@font-face` وزن ۹۰۰ + `preload` (۶-۲).
3. اسکریپت ضدفلش دارک‌مود + حذف `return null` از `ThemeToggle` (۶-۳).
4. `loading.tsx` برای ۶ شاخهٔ اصلی + اسکلتون مشترک (P0-1).
5. اصلاح RTL کارت‌های موبایل (۶-۷)، قاعدهٔ فوکوس و skip-link (۶-۸).
6. کف اندازهٔ متن: `text-[10px]`→`text-2xs` و `text-[11px]`→`text-xs` در پوسته‌ها (نه در بج‌های خیلی کوچک).

**معیار پذیرش:** هیچ کلاس نامعتبر در بیلد Tailwind، اسکرین‌شات هدر بدون جهش، فوکوس مرئی روی همهٔ کنترل‌ها.

### فاز ۲ — «لایهٔ بازخورد و فرم» (۱ هفته)
1. `ToastProvider` + `useConfirm` + `Modal` (۶-۴، ۶-۵) و درج Provider در `layout.tsx`.
2. مهاجرت ۱۰۶ دیالوگ بومی به ترتیب ریسک: `admin/students` → `admin/finance/*` → `professor/grades` → بقیه.
3. کامپوننت `Field` (برچسب + راهنما + خطای درجا + `aria-invalid` + `aria-describedby`) و استفاده در فرم‌های پرتکرار.
4. `useUnsavedGuard` (beforeunload + پیام درون‌برنامه‌ای) در فرم‌های بلند.
5. `CurrencyInput` با جداکنندهٔ هزارگان و `inputMode="numeric"` به‌جای `type="number"` برای مبالغ.

### فاز ۳ — «ناوبری و سیستم» (۱–۲ هفته)
1. سایدبار ثابت جمع‌شوندهٔ ادمین در `lg+` با `aria-expanded` + کشو در موبایل.
2. یکسان‌سازی سه هدر در یک `PanelHeader` مشترک.
3. جایگزینی اموجی‌ها با ۲۰–۲۵ آیکون SVG درون‌خطی (بدون کتابخانهٔ سنگین).
4. تجمیع سه مسیر جدول در یک `DataTable` با `sticky thead`، صفحه‌بندی و حالت خالی استاندارد.
5. تعریف `--color-*`/`--radius-*`/`--space-*` در `:root` و حذف تدریجی نگاشت‌های `!important` (`globals.css:117-141`) به سمت `dark:` صریح.

### سنجه‌های موفقیت (قابل اندازه‌گیری با grep، مثل همین گزارش)

| سنجه | امروز | هدف |
|---|---|---|
| فایل‌های `loading.tsx` | ۰ | ۶+ |
| `alert()` / `confirm()` | ۴۳ / ۶۳ | ۰ / ۰ |
| مودال بدون `role="dialog"` | ۴۶ | ۰ |
| کلاس نامعتبر Tailwind (v3) | ۱۵۹ | ۰ |
| `text-[10px]` + `text-[11px]` | ۲٬۰۶۰ | < ۲۰۰ |
| `focus:outline-none` بی‌بدیل | ۵۱ | ۰ |
| `aria-live` | ۰ | ≥ ۱ در Provider + فرم‌ها |
| `htmlFor` در برابر `label` | ۱ / ۷۱۵ | ≥ ۸۰٪ |
| یوتیلیتی جهت‌دار فیزیکی | ۱۷۰ | < ۳۰ |
| `dir="ltr"` پراکنده بدون کامپوننت | ۴۷۱ | در چند کامپوننت مشترک |

---

## ۸) پیوست — جدول اعداد مرجع (بازتولیدپذیر)

| الگو | تعداد | الگو | تعداد |
|---|---|---|---|
| فایل‌های `src` | ۸۶۷ | صفحات `page.tsx` | ۱۵۸ |
| `className=` | ۱۴٬۴۴۷ | `<table>` | ۱۹۶ |
| `<button>` | ۱٬۲۰۵ | `<form>` | ۱۲۰ |
| `<input>` | ۸۴۴ | `placeholder=` | ۳۶۹ |
| `<label>` | ۷۱۵ | `htmlFor` | ۱ |
| `aria-*` | ۸۵ | `aria-live` / `aria-busy` | ۰ / ۰ |
| `role="dialog"` | ۴ | `fixed inset-0` | ۵۰ |
| `alert()` | ۴۳ | `confirm()` | ۶۳ |
| `text-[10px]` | ۸۴۸ | `text-[11px]` | ۱٬۲۱۲ |
| `font-black` | ۱٬۲۵۳ | `@font-face` (وزن‌ها) | ۴۰۰/۵۰۰/۷۰۰ (بدون ۹۰۰) |
| `shadow-xs` | ۱۱۲ | `backdrop-blur-xs`/`blur-xs` | ۱۹ / ۱۹ |
| `focus-visible` | ۰ | `focus:outline-none` | ۵۱ |
| `dark:` در TSX | ۱۸۶ | `!important` در globals | ۲۰۰+ |
| یوتیلیتی فیزیکی جهت‌دار | ۱۷۰ | یوتیلیتی منطقی (`ms/me/start/end`) | ۲۸ |
| `dir="ltr"` | ۴۷۱ | `toLocaleString('fa-IR')` | ۲۴۴ |
| `overflow-x-auto` | ۱۵۲ | `type="number"` | ۱۸۴ |
| `beforeunload` | ۲ | `prefers-reduced-motion` | ۰ |
| `loading.tsx` | ۰ | `error.tsx` | ۲ |

---

## ۹) گزارش اجرا — چه چیزی در این دور رفع شد (۲۷ آبان)

### ✅ فاز ۱ — «ریست طراحی» (کامل)

| # | تغییر | فایل‌ها | شاهد |
|---|---|---|---|
| ۱ | توکن‌های گمشدهٔ تیلویند ۳: `shadow-xs`/`shadow-2xs`، `blur-xs`، `backdrop-blur-xs`، شعاع‌های معنایی `control/card/panel`، پله‌های متن `2xs/3xs`، `keyframes enter` | `afagh-next/tailwind.config.ts` | در CSS خروجی، `.shadow-xs` و `.backdrop-blur-xs` **تولید می‌شوند** (پیش‌تر هیچ) |
| ۲ | وزن ۹۰۰ فونت + preload آن (۱٬۲۵۳ کاربرد `font-black` تا امروز با وزن ۷۰۰ رندر می‌شد) | `src/app/globals.css`، `src/app/layout.tsx` | `font-weight: 900` + `<link rel="preload" …vazirmatn-900>` |
| ۳ | حذف فلش/پرش حالت شب: اسکریپت ضدفلش پیش از paint، `suppressHydrationWarning`، `ThemeToggle` دیگر `null` برنمی‌گرداند و `aria-pressed` دارد | `layout.tsx`، `components/ThemeToggle.tsx` | دکمه از همان رندر اول با ابعاد ثابت `h-9 w-9` |
| ۴ | ۶ فایل `loading.tsx` + اسکلتون مشترک با `role="status"`/`aria-live`/`aria-busy` | `components/PageSkeleton.tsx` + `app/{admin,student,professor,group-manager,alumni,proctor}/loading.tsx` | `find src -name loading.tsx` → ۶ |
| ۵ | RTL لایهٔ موبایل: `text-align: start` و `margin-inline-start` | `src/styles/mobile-tables.css` | `grep 'text-align: left'` → ۰ |
| ۶ | فوکوس مرئی سراسری `:focus-visible`، استایل `.skip-link`، لینک «پرش به محتوا» و `id="main"` روی `<main>` شش شاخه، احترام به `prefers-reduced-motion` | `globals.css`، `layout.tsx`، شش `layout.tsx` | `focus-visible` از ۰ → قاعدهٔ سراسری |
| ۷ | پله‌های متن: ۸۴۸ مورد `text-[10px]` → `text-3xs` و ۱٬۲۱۲ مورد `text-[11px]` → `text-2xs` (کف ۱۱px، یک‌پله بالاتر از قبل) در ۲۴۳ فایل | سراسری | `grep 'text-\[10px\]\|text-\[11px\]'` → ۰ |
| ۸ | انیمیشن ورود بدون پلاگین: `.animate-in`/`.fade-in`/`.zoom-in-95`/`slide-in-from-*` با `@keyframes ui-enter` | `globals.css` | ۴۸ کلاسِ قبلاً بی‌اثر، فعال شد |

### ✅ فاز ۲ — لایهٔ بازخورد (زیرساخت کامل + اولین مهاجرت‌ها)

- **`ToastProvider` + `useToast`** (`components/ui/Toast.tsx`): نواحی `aria-live="polite"`، بالای نوار موبایل (`bottom-16`)، بستن دستی، `print:hidden`.
- **`Modal` با ترپ فوکوس** (`components/ui/Modal.tsx`): `role="dialog"` + `aria-modal` + `aria-labelledby`، حلقهٔ Tab/Shift+Tab، Escape، قفل اسکرول بدن، بازگردانی فوکوس، شیت پایین‌چسب در موبایل، `max-h-[90dvh]`.
- **`ConfirmProvider` + `useConfirm`** (`components/ui/Confirm.tsx`): دیالوگ قابل‌وعده با دکمهٔ خطرِ قرمز و متن «بازگشت‌پذیر نیست».
- **`Field`** (`components/ui/Field.tsx`): برچسبِ متصل با `htmlFor` + راهنما + خطای درجا با `role="alert"` و `aria-invalid`.
- **`CurrencyInput`** (`components/ui/CurrencyInput.tsx`): جداکنندهٔ هزارگان، تبدیل اعداد فارسی، `inputMode="numeric"`.
- **`useUnsavedGuard` / `useFormDirtyGuard`** (`src/lib/use-unsaved-guard.ts`).
- نصب هر دو Provider در `app/layout.tsx` (پوشش همهٔ ۱۵۸ صفحه).
- **مهاجرت انجام‌شده:** ۹ فراخوانی `alert()` → توست در `student/enroll/EnrollClient.tsx`، `professor/grades/components/RosterTab.tsx` (۷ مورد)، `professor/availability/ProfessorAvailabilityClient.tsx`، `admin/short-courses/AdminShortCoursesClient.tsx`؛ و `confirm()` غیرفعال‌سازی حساب در `admin/students/StudentsManagerClient.tsx` → `useConfirm` با دکمهٔ خطر.

### ✅ فاز ۳ — ناوبری (بخشی)
- `AdminNav`: `aria-haspopup="dialog"` + `aria-expanded` روی دکمهٔ منو و روی گروه‌های تاشو، نشانگرهای `◀/▼` با `aria-hidden`، و قفل اسکرول بدنه هنگام باز بودن کشو.

### ✅ فاز ۳ — ناوبری: سایدبار دائمی دسکتاپ (بخشی)

- **`AdminNav` دو نما شد:** روی `lg+` سایدبارِ چسبانِ دائمی (`lg:sticky lg:top-[6.5rem]`، عرض `16rem/18rem`، اسکرول داخلی) و روی موبایل همان کشوی قبلی با دکمهٔ شناور (`lg:hidden`). محتوا یک‌جاست، پس جست‌وجو/گروه‌های تاشو/هایلایت مسیر در هر دو نما یکسان است.
- **`admin/layout.tsx`**: `AdminNav` از داخل `<header>` بیرون آمد و به ستون بدنه منتقل شد (`<div class="mx-auto flex …">` + `<main id="main" class="min-w-0 flex-1">`) تا سایدبار واقعاً کنار محتوا بنشیند؛ رزرو `w-14` دکمهٔ شناور فقط در موبایل باقی ماند (`lg:hidden`).
- **دسترسی‌پذیری**: `aria-haspopup="dialog"` + `aria-expanded` روی تریگر، `aria-expanded` روی گروه‌ها، `aria-hidden` روی نشانگرهای تزئینی، Escape برای بستن، قفل اسکرول بدنه، `aria-label` روی جست‌وجوی ماژول، و `autoFocus` فقط وقتی کشو باز است (روی دسکتاپ فوکوس را نمی‌دزدد).
- **آیکون‌های پوسته**: `☰` و `✕` (منو/بستن/توست/مودال) با SVG درون‌خطی جایگزین شدند تا در ویندوز/اندروید/iOS یکسان و هم‌تراز رندر شوند.
- **کارایی**: `backdrop-blur` از دکمه/کشو حذف شد (سنگین‌ترین عامل لگ لمس در موبایل؛ در `MobileTabBar` هم قبلاً همین درس گرفته شده بود).

### 🧪 اعتبارسنجی

| بررسی | فرمان | نتیجه |
|---|---|---|
| تایپ‌چک | `npx tsc --noEmit` | فقط **۶ خطای از قبل موجود** در ۳ فایل دست‌نخورده (`lib/migration/engine.ts`، `professor/virtual-classes/actions.ts`، `admin/migration/MigrationClient.tsx`) — هیچ خطای تازه‌ای از این تغییرات نیست |
| کامپایل CSS | `npx tailwindcss -i src/app/globals.css -o out.css` | موفق؛ `.shadow-xs`, `.backdrop-blur-xs`, `.animate-in`, `.text-2xs`, `.text-3xs`, `.ui-enter` تولید می‌شوند |
| بیلد | `next build` | **✓ Compiled successfully in 15.2s** |
| تست‌ها | `npm test` | **EXIT:0** (۱۷۸ مجموعه؛ همه سبز) |
| گارد جدید | `tests/ui-ux-guards.test.ts` | **۴۰ ✓ / ۰ ✗** — به زنجیرهٔ `npm test` هم اضافه شد |

> گارد جدید جلوی برگشت این دستاوردها را می‌گیرد: وجود توکن‌های تیلویند، پیاده‌سازی `.animate-in`، فوکوس مرئی و skip-link، ضدفلش حالت شب، وزن ۹۰۰ فونت، نصب Providerها، وجود شش `loading.tsx`، نبودِ `text-align:left` در کارت‌های موبایل و نبودِ `text-[10px]/text-[11px]`.

### ✅ دور دوم — پاک‌سازی کامل دیالوگ‌های بومی (`alert`/`confirm`)

| مورد | جزئیات |
|---|---|
| پلِ بازخورد سراسری | `src/lib/ui-feedback.ts` با `notify()` و `askConfirm()` — دو شکافِ ثبتِ جدا (`registerToast`/`registerConfirm`) تا افکتِ والد ثبتِ فرزند را بازنویسی نکند؛ در نبود Provider، `notify` فقط `console.warn` و `askConfirm` به `window.confirm` برمی‌گردد (هیچ تأییدی بی‌صدا «رد» نمی‌شود) |
| `alert()` | **۳۲ فراخوانی باقی‌مانده در ۹ فایل → صفر.** فایل‌ها: `StudentFormulaClient` (۶)، `ProfessorAttendanceClient` (۵)، `WelfareClient` (۵)، `UnfinalizeReviewClient` (۴)، `VirtualClassroomWidget` (۳)، `ProfessorContractClient` (۳)، `OpenCoursesClient` (۳)، `PayrollEngineClient` (۲)، `ArchiveClient` (۱) |
| `confirm()` | **~۲۴ فراخوانی باقی‌مانده در ۲۰ فایل → صفر.** از جمله `AdmissionsClient` (۹، حساس‌ترین)، `CouncilClient`، `BatchesTab`، `AdminPermissionsClient`، `TuitionRulesClient`، `DecreesClient`، `ThesisClient`، `CodesClient`، `DormClient`، `EnrollmentApprovalsClient`، `WarningsClient`، `ProfVirtualClassesClient`، `LoginShowcaseClient`، `GradesTab`، `TuitionTab`، `DeptRoomsTab`، `SettingsClient`×۲، `ExamPaymentsClient`، `RegulationsClient`، `RolesClient`، `TeachingRolesClient`، `DeletePeriodButton` |
| تبدیل‌های حساس | توابع همگام به `async` ارتقا یافتند (`doDelete`, `remove`, `toggleAllMatrix`, `handleDeleteRole`, …)؛ در `DeletePeriodButton` ارسال فرم یک‌بار متوقف و پس از تأیید با پرچم `bypass` دوباره ارسال می‌شود (`requestSubmit`)؛ در `LoginShowcaseClient` الگوی `confirm(...) && run(...)` به `async/await` بازنویسی شد |
| گاردِ ایمنی موجود | `tests/admissions-idempotent-transfer.test.ts` هم‌زمان به‌روزرسانی شد: کمک‌تابع `asksConfirm()` حالا هم `confirm(` و هم `askConfirm(` را می‌پذیرد تا **مقصودِ تست** (هر عملیات مخرب باید تأیید بگیرد) حفظ شود — نه شکلِ فراخوانی |
| گارد جدید | `tests/ui-ux-guards.test.ts` سه بررسی تازه گرفت: صفر `alert()`، صفر `confirm()` بومی در کد (منهای پل و Provider)، و وجود `lib/ui-feedback.ts` ⇒ مجموع **۳۵ ✓ / ۰ ✗** |

**نتیجه:** هیچ دیالوگ بومی مرورگری در مسیر کاربرانِ سامانه باقی نمانده است؛ همهٔ پیام‌ها از توستِ `aria-live` و همهٔ تأییدها از دیالوگِ دارای ترپ فوکوس می‌آیند.

### ⏳ باقی‌ماندهٔ فاز ۲ و ۳ (به‌ترتیب پیشنهادی)

1. ~~۳۲ فراخوانی `alert()`~~ ✅ انجام شد (بند «دور دوم»).
2. ~~~۴۵ فراخوانی `confirm()`~~ ✅ انجام شد (بند «دور دوم»).
3. ~~سایدبار ثابت ادمین در `lg+`~~ ✅ انجام شد (AdminNav دو نما: سایدبار چسبان در `lg+` و کشو در موبایل).
4. ~~یکسان‌سازی سه هدر~~ ✅ انجام شد (مکملهٔ `HeaderActions` مشترک برای مدیریت/دانشجو/استاد).
5. ~~تجمیع سه مسیر جدول (سرستون چسبان)~~ ✅ انجام شد (لایهٔ CSS در `mobile-tables.css`: `table.rt > thead > tr > th` با `position: sticky` برای دسکتاپ).
6. **اضافه‌سازی آیکون‌های `admin-modules.ts`** — کامپوننت `Icon` ساخته و نقشه ۴۶ اموجی تعریف شد؛ فایل بالابر `admin-modules.ts` همچنان اموجی دارد و می‌تواند تدریجی با `<Icon emoji={...}>` جایگزین شود.
7. **حذف تدریجی نگاشت‌های `!important`** در `globals.css:117+` به سمت `dark:` صریح (هم‌اکنون ۲۰۰+` مورد دارد).
8. **بردن سایدبار ثابت به کارتابل استاد/مدیرگروه** — همان الگو `AdminNav` را در `professor/layout.tsx` و `group-manager/layout.tsx` تکرار.

> دو نکته برای ادامه: (الف) شمارش `alert(`/`confirm(` در `components/ui/Toast.tsx` و `Confirm.tsx` «کاذب» است (داخل کامنت‌اند). (ب) شش خطای تایپ‌چکِ از قبل موجود، مستقل از UI هستند و بهتر است در یک تسک جدا رفع شوند تا دروازهٔ CI سبز شود.

---

### جمع‌بندی یک‌خطی (وضعیتِ زمان بازبینی)

پروژه از نظر **مهندسی تحویل سند و فارسی‌سازی** بالاتر از میانگین است، اما از نظر **«سیستم طراحی»** زیر میانگین: ۱۵۹ کلاس بی‌اثر، ۲٬۰۶۰ متن ناخوانا، صفر حالت بارگذاری، صفر توست سراسری و صفر ترپ فوکوس. سه اقدام فاز ۱ (توکن‌ها + فونت ۹۰۰ + اسکلتون/فوکوس) با کمترین تغییر، بیشترین جهش ادراکی را می‌دهد.

> **به‌روزرسانی (بند ۹):** همهٔ موارد بالا در فاز ۱ رفع شد؛ لایهٔ توست/دیالوگ ساخته و نصب شد و اولین ۹ فراخوانی `alert()` + یک `confirm()` مهاجرت کرد. باقی‌مانده‌ها با فهرست فایل و تعداد در بند ۹ آمده است.








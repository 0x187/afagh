# گزارش Phase-4: حسابرسی وابستگی‌ها و زنجیره تأمین (Dependency & Supply-Chain Audit)

- **شاخه:** `security/phase2`
- **مسیر پروژه:** `D:\afagh\afagh-next`
- **فایل‌های بررسی‌شده:** `afagh-next/package.json`, `afagh-next/package-lock.json`
- **تاریخ:** 2026-10-19

---

## خلاصه اجرایی

- فایل قفل (`package-lock.json`) از **lockfileVersion 3** استفاده می‌کند و تمام `resolved` ها به `https://registry.npmjs.org` اشاره دارند؛ تمام ورودی‌ها دارای `integrity` هستند و وابستگی git/file/URL یافت نشد.
- یک بستهٔ صرفاً تایپ (`@types/qrcode`) به اشتباه در `dependencies` بود که به `devDependencies` منتقل شد (اصلاح انجام‌شده).
- استراتژی پین کردن نسخه‌ها (exact vs caret) نامتجانس است.
- چند بستهٔ ترانزیتی deprecated (`@esbuild-kit/*`, `prebuild-install`) و ماژول‌های native با `hasInstallScript` وجود دارند.
- هیچ CVE تأییدشدهٔ مستقیمی از روی نسخه‌ها شناسایی نشد؛ با این حال چند بستهٔ قدیمی/مینور عقب‌مانده پیشنهاد به‌روزرسانی دارند.

---

## یافته‌ها بر اساس شدت

### بحرانی (Critical)

- **هیچ مورد بحرانی یافت نشد.**

---

### بالا (High)

#### F1 — بستهٔ type-only در `dependencies` (اصلاح شد)
- **شرح:** `@types/qrcode` یک بستهٔ صرفاً تایپ است و نباید در وابستگی‌های تولید (runtime) قرار گیرد. حضور آن در `dependencies` باعث نصب غیرضروری در محیط تولید و افزایش سطح حملهٔ زنجیرهٔ تأمین می‌شود.
- **مکان (پیش از اصلاح):** `afagh-next/package.json:32` (داخل `dependencies`)
- **مکان (قفل، پیش از اصلاح):** `afagh-next/package-lock.json:11`
- **اقدام انجام‌شده:** انتقال به `devDependencies` (خط ۵۰ `package.json` و خط ۲۹ `package-lock.json`). ورودی قفل `node_modules/@types/qrcode` نیز با `"dev": true` علامت‌گذاری شد (`package-lock.json:1686`).
- **توصیهٔ تکمیلی:** اجرای `npm install` در محیط توسعه برای همگام‌سازی نهایی قفل (در این حسابرسی اجرا نشد).

---

### متوسط (Medium)

#### F2 — استراتژی پین کردن نسخه‌ها نامتجانس
- **شرح:** بخشی از وابستگی‌ها با نسخهٔ دقیق (exact) و بخشی با `^` (caret) تعریف شده‌اند. این ناهمگنی باعث buildهای غیرقابل‌تکرار و امکان slip نسخهٔ patch/minor می‌شود.
- **شواهد:**
  - `afagh-next/package.json:31-45` (`dependencies`): exact: `drizzle-orm 0.45.2`, `ioredis 6.0.0`, `minio 8.0.7`, `next 16.4.2`, `pg 8.13.1`, `react 19.2.8`, `react-dom 19.2.8`, `zod 3.23.8`؛ caret: `chart.js`, `docx`, `file-saver`, `qrcode`, `server-only`.
  - `afagh-next/package.json:46-59` (`devDependencies`): exact: `postcss 8.5.28`؛ caret: بقیه.
  - `afagh-next/package.json:60-62` (`optionalDependencies`): `better-sqlite3 ^11.6.0`.
- **توصیه:** یک سیاست واحد انتخاب شود (برای runtime ترجیحاً exact + lockfile، برای dev می‌توان caret). در صورت تغییر، فقط با شواهد و تست.

#### F3 — بسته‌های ترانزیتی deprecated
- **شرح:** قفل شامل بسته‌های منسوخ است.
- **شواهد (قفل):**
  - `@esbuild-kit/core-utils@3.3.2` (deprecated: Merged into tsx) — `afagh-next/package-lock.json` (ورودی `node_modules/@esbuild-kit/core-utils`)
  - `@esbuild-kit/esm-loader@2.6.5` (deprecated) — `afagh-next/package-lock.json`
  - `prebuild-install@7.1.3` (No longer maintained) — ترانزیتی از `better-sqlite3@11.10.0`
- **توصیه:** ارتقاء `drizzle-kit` به نسخه‌ای که از `@esbuild-kit` استفاده نمی‌کند (در صورت وجود) و بررسی جایگزین برای `prebuild-install` از طریق نگهدارندهٔ `better-sqlite3`. تغییرات فقط پس از تست.

#### F4 — ماژول‌های native و install scripts
- **شرح:** چند بستهٔ native دارای `hasInstallScript` هستند که در زمان نصب کد اجرا می‌کنند. این موارد مشروع‌اند اما باید در CI/CD کنترل شوند.
- **شواهد (قفل):**
  - `hasInstallScript: true` برای `esbuild@0.18.20`, `esbuild@0.25.12`, `esbuild@0.28.2` (dev)
  - `hasInstallScript: true` برای `better-sqlite3@11.10.0` (optional native)
  - `hasInstallScript: true` برای `fsevents@2.3.3` (dev, macOS)
  - ماژول‌های native اختیاری `sharp@0.35.5` و خانوادهٔ `@img/sharp-*` (ترانزیتی از `next@16.4.2` optionalDependencies)
- **توصیه:** در CI از `npm ci` با قفل ثابت استفاده شود؛ در صورت نیاز به `--ignore-scripts`، prebuilt binaries را از پیش تأمین کنید. بررسی دوره‌ای صحت `integrity`.

---

### پایین (Low)

#### F5 — بسته‌های قدیمی/عقب‌مانده (بدون CVE تأییدشده)
- **شرح:** چند وابستگی نسبت به نسخه‌های جدیدتر عقب‌اند؛ ارتقاء major بدون شواهد انجام نشد.
- **شواهد (`package.json`):**
  - `file-saver@^2.0.5` (خط ۳۵) — نسخهٔ قدیمی و بدون انتشار جدید؛ بررسی جایگزین (`stream-saver` یا Blob API) پیشنهاد می‌شود.
  - `zod@3.23.8` (خط ۳۸) — شاخهٔ ۴ موجود است؛ مهاجرت اختیاری.
  - `tailwindcss@^3.4.15` (خط ۵۶) — شاخهٔ ۴ موجود است؛ مهاجرت اختیاری.
  - `@types/node@^22.9.0` (خط ۴۸) — به‌روزرسانی patch/minor پیشنهاد می‌شود.
  - `@types/react@^19.0.0` / `@types/react-dom@^19.0.0` (خطوط ۵۱-۵۲) — تطبیق با نسخهٔ React 19.2.8 پیشنهاد می‌شود.

#### F6 — بسته‌های تایپ در درخت تولید
- **شرح:** `@types/node` و `@types/pg` به دلیل وابستگی‌های ترانزیتی (`docx`, `@types/qrcode` سابق، `drizzle-orm` peer) در درخت تولید ظاهر می‌شوند و در `node_modules` نصب می‌شوند. این موارد آسیب‌پذیری مستقیم نیستند اما حجم نصب تولید را افزایش می‌دهند.
- **شواهد:** `afagh-next/package-lock.json` (ورودی‌های `node_modules/@types/node`, `node_modules/@types/pg` بدون `"dev": true`).

#### F7 — عدم وجود `.npmrc`
- **شرح:** فایل `.npmrc` در `afagh-next` وجود ندارد؛ تنظیمات registry/ignore-scripts/audit به‌صورت پیش‌فرض npm است. برای سخت‌سازی زنجیرهٔ تأمین، تنظیم صریح registry و `save-exact` پیشنهاد می‌شود.
- **شواهد:** `afagh-next/.npmrc` (不存在)

---

### اطلاعاتی (Info)

#### I1 — صحت قفل (Lockfile Integrity)
- **شرح:** قفل سالم است.
- **شواهد:**
  - `afagh-next/package-lock.json:4` → `"lockfileVersion": 3`
  - تمام `resolved` ها (۳۶۶ ورودی) به `https://registry.npmjs.org` اشاره دارند؛ وابستگی git/file/URL یافت نشد.
  - تمام ورودی‌ها دارای `integrity` هستند.
  - `overrides` تعریف‌شده در `package.json:63-66` (`postcss`, `source-map-js`) در قفل اعمال شده‌اند (`postcss@8.5.28`, `source-map-js@1.2.2`).

#### I2 — بسته‌های اختیاری
- **شرح:** `better-sqlite3` به‌عنوان `optionalDependencies` تعریف شده است (`package.json:60-62`) و در قفل نسخهٔ `11.10.0` نصب شده است. در محیط‌های بدون ابزار build native ممکن است نصب نشود.

---

## اقدامات انجام‌شده (ویرایش‌ها)

1. `afagh-next/package.json`
   - حذف `"@types/qrcode": "^1.5.6"` از `dependencies` (پیش‌تر خط ۳۲).
   - افزودن `"@types/qrcode": "^1.5.6"` به `devDependencies` (خط ۵۰).
2. `afagh-next/package-lock.json`
   - حذف `"@types/qrcode": "^1.5.6"` از `packages."".dependencies` (پیش‌تر خط ۱۱).
   - افزودن `"@types/qrcode": "^1.5.6"` به `packages."".devDependencies` (خط ۲۹).
   - افزودن `"dev": true` به ورودی `node_modules/@types/qrcode` (خط ۱۶۸۶).
3. هیچ build/test یا commit/push اجرا نشد. `git diff --check` بدون خطای whitespace اجرا شد.

## توصیه‌های نهایی

- اجرای `npm ci` و `npm run typecheck` پس از همگام‌سازی قفل (خارج از محدودهٔ این حسابرسی).
- تعریف `.npmrc` با `save-exact=true` و registry صریح.
- برنامهٔ ارتقاء تدریجی برای `file-saver`, `zod`, `tailwindcss` و `drizzle-kit`.
- بازبینی دوره‌ای `hasInstallScript` و `integrity` در قفل.
- عدم ارتقاء major بدون شواهد و تست.

---
*پایان گزارش Phase-4*

# ثمین / پامتک — قرارداد وب‌سرویس (مرحلهٔ ۴)

> **ثمین ≠ سهام.** سهام (IRPHE) گزارش **اکسل** سالانه است؛ ثمین/پامتک **وب‌سرویس** سازمان امور دانشجویان است.
> سند مرجع: `APIM_Pamtek_Samin3_Student_WebServices_V2` (مرحلهٔ ۴، تاریخ ۱۴۰۵/۰۷/۱۵) و
> `MDM_PAMTEK_Samin3_dormitory_1.1` (کاتالوگ خوابگاهی، ۱۴۰۴/۰۹/۲۳).

## ۱) تغییر مهم نسبت به پیاده‌سازی فعلی

پیاده‌سازی موجود در `src/lib/samin/client.ts` بر پایهٔ **نسخهٔ قدیم** است:

| | قدیم (پیاده‌شده) | **مرحلهٔ ۴ (استاندارد جاری)** |
|---|---|---|
| بارگذاری | `POST /api/mdm/import_data/bulk_import_data/` | `POST /api/pamtek/transform_flow/bulk_import_data` |
| بدنه | `{ importdata: { data, entity_code, import_type_code } }` | `{ data: [...], meta_data: { title, transform_flow_code, import_type } }` |
| کد موجودیت | `entity_code: '1000'` | `transform_flow_code` (مثل `20011` برای «فرد») |
| نوع بارگذاری | `import_type_code: '0'` | `import_type` ∈ `INSERT` \| `UPDATE` \| `UPSERT` |
| پیگیری | `trace_bulk_import_data` | `GET /api/pamtek/transform_flow/trace_bulk_import_data?trace_id=` |

پاسخ بارگذاری: `result.trace_id`, `status` (مثل `SUCCESS`), `message`, `verbose_message`.

## ۲) سرویس‌ها (پایه: `https://<host>/api/pamtek/transform_flow/`)

| سرویس | متد | ورودی |
|---|---|---|
| `bulk_import_data` | POST | `data[]` + `meta_data{title, transform_flow_code, import_type}` |
| `trace_bulk_import_data` | GET | `trace_id` → `entire_data_count, status, insert/update/missed/ignore/delete_log_count` |
| `source_changes_log` | GET | `transform_flow_code` (اجباری) + `trace_id/from/to/pk_in_source/page/...` |
| `source_lost_log` | GET | همان‌ها → رکوردهای **اعمال‌نشده** با `reason` (مثل `EMPTY_REQUIRED_FIELDS`) |
| `transactional_import_data` | POST | `etl_process_id` + آرایهٔ تک‌رکورد (همگام) |
| `trace_transactional_import_data` | GET | `trace_id` (مثل `797-1`) |

نکته: `https://url/...` در سند، **جای‌نگهدار** است؛ آدرس واقعی و نام کاربری/توکن از **نمایندهٔ سازمان** به نمایندهٔ دانشگاه اعلام می‌شود.

## ۳) نمونهٔ بدنهٔ «فرد» (transform_flow_code=20011، import_type=UPSERT)

```json
{
  "data": [{
    "source_id": "6632889",
    "first_name": "...", "last_name": "...",
    "first_name_en": "", "last_name_en": "NULL",
    "identity_code": "1234567809", "identity_type": "1",
    "birth_date": "13480101",
    "faragir_naja_code": "NULL", "father_name": "...",
    "passport_number": "NULL",
    "iden_number": "19869", "iden_serial_number": "NULL", "iden_classified_number": "NULL",
    "iden_issue_place_title": "...", "iden_issue_place_code": "150082",
    "birth_place": "NULL", "birth_place_code": "NULL",
    "gender": "2", "nationality": "1001", "citizenship": "NULL",
    "is_alive": "NULL", "is_verified": "NULL"
  }],
  "meta_data": { "title": "بارگذاری فرد", "transform_flow_code": "20011", "import_type": "UPSERT" }
}
```

## ۴) کدگذاری‌ها (جدول ۹ سند)

- `import_type`: `1 INSERT` · `2 UPDATE` · `3 UPSERT`
- `status`: `1 TRANSACTIONAL_ETL_OVER_SIZE` · `2 FILE_NOT_ACEPTED` · `3 FINISHED` · `4 FAILED` · `5 RUNNING` · `6 QUEUED_UP` · `7 READY_TO_START` · `8 FINISHED_WITH_ERROR`
- `action`: `1 CREATED` · `2 UPDATED` · `3 IGNORED` · `4 MISSED` · `5 DELETED` · `6 SYSTEMIC_UPDATED` · `7 NOT_FINISHED`
- `reason`: `1 BUSINESS_ACCESS_CONTROL_APPLIED` · `2 EMPTY_REQUIRED_FIELDS` · `3 EMPTY_MODIFIED_REQUIRED_FIELDS` · `4 RULE_APPLIED` · `5 WITHOUT_SOURCE_PK` · `6 WRONG_IMPORT_TYPE` · `7 NO_CHANGES_BUT_UPDATE_PRIORITY` · `8 NO_CHANGES` · `9 WORNG_PRIORITY_VALUE` · `10 DATA_ALREADY_EXISTS` · `11 NOT_FOUND_IN_REFERENCE_TABLE` · `12 DUPLICATE_IDENTIFICATION_VALUE` · `13 EMPTY_MODIFIED_IDENTIFICATION_FIELDS` · `14 EMPTY_IDENTIFICATION_FIELDS` · `15 MISMATCH_REPOSITORY_RECORD` · `16 NOT_CONFIRMED_BY_STEWARD` · `17 RECORD_CHANGED_TRY_AGAIN`
- `warning_on_fields`: `1 SQL_INJECTION_VALUE_DETECTED` · `2 NOT_FOUND_IN_REFERENCE_TABLE` · `3 INVALID_STRING_VALUE` · `4 INVALID_INTEGER_VALUE` · `5 INVALID_BOOLEAN_VALUE` · `6 INVALID_FLOAT_VALUE` · `8 INVALID_DATE_VALUE` · `9 INVALID_DATETIME_VALUE` · `10 INVALID_TIME_VALUE` · `11 INVALID_NUMCHAR_VALUE` · `12 INVALID_LENGTH_VALUE`
- خطای فیلد: `dublicated_fields` (کلید تکراری) · `empty_fields` (اجباری خالی)

## ۵) موجودیت‌های خوابگاهی (کاتالوگ ۱.۱ — نام‌های دقیق فیلدها)

> ردیف ۴ در جدول موجودیت دوم **در خودِ سند سازمان هم خالی است** (شماره‌ها ۳ و ۵ آمده و ۴ نیامده) — نیازمند پرسش از نمایندهٔ فنی پامتک. ارتباط دانشجو از طریق موجودیت `student_semester` است.

**الف) `dormitory` — خوابگاه‌های دانشگاه‌ها**

| # | عنوان | نام فیلد | نوع | الزام |
|---|---|---|---|---|
| ۱ | شناسه رکورد در مرجع | `source_id` | string | اجباری |
| ۲ | شناسه خوابگاه | `code` | عددی | اجباری/**uk** |
| ۳ | نام خوابگاه | `title` | string | اجباری |
| ۴ | کد دانشگاه (مصوب وزارت علوم) | `university_code` | string | اجباری |
| ۵ | نام دانشگاه | `university_name` | string | اجباری |
| ۶ | استان خوابگاه | `provinance` | string | اجباری |
| ۷ | شهر خوابگاه | `city` | string | اجباری |
| ۸ | آدرس محل خوابگاه | `address` | string | اجباری |
| ۹ | کد پستی خوابگاه | `postal_code` | عددی | اجباری |
| ۱۰ | تلفن تماس | `phone` | عددی | اجباری |

**ب) `student_dormitory` — اطلاعات دانشجویان خوابگاه‌ها**

| # | عنوان | نام فیلد | نوع | الزام |
|---|---|---|---|---|
| ۱ | شناسه رکورد در مرجع | `source_id` | string | اجباری |
| ۲ | عنوان ترم (نمونه `14042`) | `semester` | string | اجباری/**uk** |
| ۳ | شناسه خوابگاه (کد خوابگاه) | `dormitory` | string | اجباری |
| ۴ | *(در سند سازمان خالی است)* | — | — | — |
| ۵ | وضعیت اسکان | `accommodation_status` | string/دادهٔ پایه | اجباری |
| ۶ | تاریخ شروع اسکان | `start_date` | date | اختیاری |
| ۷ | تاریخ پایان اسکان | `end_date` | date | اختیاری |
| ۸ | شناسه هویت (کد ملی/اتباع) | `identity_code` | string | اجباری/**uk** |
| ۹ | نوع هویت | `identity_type` | عددی | اجباری/**uk** |
| ۱۰ | شماره دانشجویی (≤۲۰ کاراکتر) | `student_code` | string | اجباری/**uk** |
| ۱۱ | مقطع تحصیلی | `level` | string/دادهٔ پایه | اجباری/**uk** |
| ۱۲ | دانشگاه | `university` | string/دادهٔ پایه | اجباری/**uk** |

## ۶) وضعیت فعلی برنامه

- `src/lib/samin/client.ts`: نسخهٔ قدیم (mdm/entity_code) — **نیازمند مهاجرت به `transform_flow`**.
- `samin_connections`: برای زرینه (کاربر 7025) و شمس (کاربر 7190) پیکربندی شده و **توکن گرفته می‌شود**؛
  ولی پاسخ سازمان `NOT_ALLOWED_USER` (کد ۲۴) است ⇒ **اخذ مجوز دسترسی** لازم است.
- خوابگاه: هیچ پیاده‌سازی‌ای وجود ندارد. جدول `dorm_residences` فیلدهای
  `dormName/roomNo/bedNo/academicYear/validFrom/validTo/status` را دارد ولی
  **کد خوابگاه، استان/شهر/آدرس/کدپستی/تلفن و کد دانشگاه مصوب** ندارد ⇒ نیازمند جدول «خوابگاه» (master).

## ۷) کارهای بعدی

1. مهاجرت `client.ts` به `transform_flow` (bulk + trace + changes + lost + transactional) و نگه‌داشتن
   پشتیبانی نسخهٔ قدیم به‌صورت گزینه‌ای.
2. دریافت **آدرس واقعی سرویس، `transform_flow_code` هر موجودیت، و فهرست فیلدهای کاتالوگ داده مرحلهٔ ۴** از نمایندهٔ سازمان.
3. جدول `dorms` (master) + نگاشت `dorm_residences.dormId` به آن، برای بارگذاری خوابگاهی.

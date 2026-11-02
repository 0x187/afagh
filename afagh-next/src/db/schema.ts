// ══════════════════════════════════════════════════════════════════════
//  آفاق ERP — کالبد Drizzle/PostgreSQL — نگاشت مستقیم ۱:۱ از schema.sql فاز صفر
//  تولیدشده خودکار (۷۳ جدول)؛ نام ستون‌ها عیناً حفظ شده تا مهاجرت دادهٔ
//  SQLite→PG مستقیم باشد. لایهٔ سخت‌سازی (ایندکس/پارتیشن/RLS — سند §۲۰۹۳–۲۲۴۰)
//  → src/db/pg-hardening.sql
// ══════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, timestamp, date, time, numeric, jsonb, boolean, unique, uniqueIndex, primaryKey, index, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  isSystem: integer('isSystem').default(0)
});

export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  category: varchar('category', { length: 50 }).default('عمومی'),
  description: varchar('description', { length: 255 })
});

export const role_permissions = pgTable('role_permissions', {
  roleId: integer('roleId').notNull().references(() => roles.id),
  permissionId: integer('permissionId').notNull().references(() => permissions.id)
}, (t) => ({ pk: primaryKey({ columns: [t.roleId, t.permissionId] }) }));

// ══════════════════════════════════════════════════════════════════════
//  هستهٔ هویت مستقل (Identity Core / Persons / Multi-University)
// ══════════════════════════════════════════════════════════════════════

export const persons = pgTable('persons', {
  id: serial('id').primaryKey(),
  canonicalFirstName: varchar('canonicalFirstName', { length: 100 }),
  canonicalLastName: varchar('canonicalLastName', { length: 100 }),
  canonicalFatherName: varchar('canonicalFatherName', { length: 100 }),
  canonicalNationalCode: varchar('canonicalNationalCode', { length: 10 }),
  // ── PII (کد ملی) ── نسخهٔ رمزشدهٔ AES-256-GCM + شاخص کور برای جست‌وجوی برابری
  // منبع حقیقت همچنان ستون plaintext است تا زمان cutover کامل (فاز بعد).
  canonicalNationalCodeEnc: text('canonicalNationalCodeEnc'),
  canonicalNationalCodeBlindIndex: text('canonicalNationalCodeBlindIndex'),
  canonicalBirthDate: date('canonicalBirthDate'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (t) => [
  unique('uq_persons_national_code').on(t.canonicalNationalCode),
  index('idx_persons_nc_blind').on(t.canonicalNationalCodeBlindIndex),
]);

export const person_source_identities = pgTable('person_source_identities', {
  id: serial('id').primaryKey(),
  personId: integer('personId').references(() => persons.id),
  universityId: integer('universityId').notNull().references((): AnyPgColumn => universities.id),
  studentId: integer('studentId').references((): AnyPgColumn => students.id),
  sourceStudentCode: varchar('sourceStudentCode', { length: 50 }).notNull(),
  sourceNationalCode: varchar('sourceNationalCode', { length: 10 }),
  sourceNationalCodeEnc: text('sourceNationalCodeEnc'),
  sourceNationalCodeBlindIndex: text('sourceNationalCodeBlindIndex'),
  sourceFirstName: varchar('sourceFirstName', { length: 100 }),
  sourceLastName: varchar('sourceLastName', { length: 100 }),
  sourceFatherName: varchar('sourceFatherName', { length: 100 }),
  sourceBirthDate: date('sourceBirthDate'),
  normalizedFirstName: varchar('normalizedFirstName', { length: 100 }),
  normalizedLastName: varchar('normalizedLastName', { length: 100 }),
  normalizedFatherName: varchar('normalizedFatherName', { length: 100 }),
  identityStatus: varchar('identityStatus', { length: 40 }).notNull().default('UNRESOLVED'),
  matchMethod: varchar('matchMethod', { length: 60 }),
  matchConfidence: numeric('matchConfidence', { precision: 5, scale: 4 }),
  isPrimarySource: integer('isPrimarySource').notNull().default(0),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (t) => [
  unique('uq_person_source_identity').on(t.universityId, t.sourceStudentCode),
  index('idx_person_source_identity_person').on(t.personId),
  index('idx_person_source_identity_national').on(t.sourceNationalCode),
  index('idx_psi_source_nc_blind').on(t.sourceNationalCodeBlindIndex),
  index('idx_person_source_identity_student').on(t.studentId),
]);

export const identity_resolution_reviews = pgTable('identity_resolution_reviews', {
  id: serial('id').primaryKey(),
  sourceIdentityId: integer('sourceIdentityId').notNull().references(() => person_source_identities.id, { onDelete: 'cascade' }),
  candidatePersonId: integer('candidatePersonId').references(() => persons.id),
  candidateSourceIdentityId: integer('candidateSourceIdentityId').references(() => person_source_identities.id),
  resolution: varchar('resolution', { length: 40 }).notNull(),
  matchMethod: varchar('matchMethod', { length: 60 }),
  confidence: numeric('confidence', { precision: 5, scale: 4 }),
  sourceNationalCode: varchar('sourceNationalCode', { length: 10 }),
  sourceNationalCodeEnc: text('sourceNationalCodeEnc'),
  sourceNationalCodeBlindIndex: text('sourceNationalCodeBlindIndex'),
  candidateNationalCode: varchar('candidateNationalCode', { length: 10 }),
  candidateNationalCodeEnc: text('candidateNationalCodeEnc'),
  candidateNationalCodeBlindIndex: text('candidateNationalCodeBlindIndex'),
  sourceStudentCode: varchar('sourceStudentCode', { length: 50 }),
  candidateStudentCode: varchar('candidateStudentCode', { length: 50 }),
  sourceUniversityId: integer('sourceUniversityId'),
  candidateUniversityId: integer('candidateUniversityId'),
  reason: text('reason'),
  reviewStatus: varchar('reviewStatus', { length: 30 }).notNull().default('PENDING'),
  reviewedBy: integer('reviewedBy'),
  reviewedAt: timestamp('reviewedAt'),
  createdAt: timestamp('createdAt').defaultNow(),
}, (t) => [
  index('idx_identity_reviews_source').on(t.sourceIdentityId),
  index('idx_identity_reviews_candidate').on(t.candidatePersonId),
  index('idx_identity_reviews_status').on(t.reviewStatus),
  index('idx_identity_reviews_resolution').on(t.resolution),
]);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  personId: integer('personId').references(() => persons.id),
  nationalCode: varchar('nationalCode', { length: 10 }).notNull(), // یکتا نیست: هویت = (دانشگاه + شماره دانشجویی)؛ یک شخص می‌تواند در دو دانشگاه دو حساب با یک کد ملی داشته باشد
  nationalCodeEnc: text('nationalCodeEnc'),
  nationalCodeBlindIndex: text('nationalCodeBlindIndex'),
  firstName: varchar('firstName', { length: 100 }).notNull(),
  lastName: varchar('lastName', { length: 100 }).notNull(),
  mobile: varchar('mobile', { length: 11 }),
  email: varchar('email', { length: 150 }),
  // ── اطلاعات شناسنامه‌ای (هویت ثبت‌احوال) — برای مهاجرت از سیستم قدیم و صدور اسناد رسمی ──
  birthCertNo: varchar('birthCertNo', { length: 20 }),        // شماره شناسنامه
  birthCertSeries: varchar('birthCertSeries', { length: 30 }), // سریال شناسنامه (سری/سریال)
  placeOfBirth: varchar('placeOfBirth', { length: 150 }),      // محل تولد
  placeOfIssue: varchar('placeOfIssue', { length: 150 }),      // محل صدور شناسنامه
  birthDate: timestamp('birthDate'),                           // تاریخ تولد
  fatherName: varchar('fatherName', { length: 100 }),          // نام پدر
  gender: varchar('gender', { length: 10 }),                   // جنسیت: MALE / FEMALE
  address: varchar('address', { length: 300 }),                // نشانی پستی
  // ── عکس پرسنلی/دانشجویی (مهاجرت از سیستم قدیمی + کارت دانشجویی و کارت ورود به جلسه) ──
  // خودِ فایل در Object Storage می‌ماند (سند §۲۴۳۸: «فقط کلید در دیتابیس»).
  photoKey: varchar('photoKey', { length: 500 }),        // کلید شیء در باکت
  photoMime: varchar('photoMime', { length: 100 }),      // image/jpeg …
  photoFileName: varchar('photoFileName', { length: 255 }), // نام فایل عکس در سیستم قدیمی (ستون اکسل)
  photoUpdatedAt: timestamp('photoUpdatedAt'),
  // ── توسعهٔ ثمین / چنددانشگاهی ──
  firstNameEn: varchar('firstNameEn', { length: 100 }),        // نام انگلیسی (ثمین: first_name_en)
  lastNameEn: varchar('lastNameEn', { length: 100 }),          // نام خانوادگی انگلیسی
  passportNumber: varchar('passportNumber', { length: 20 }),   // گذرنامهٔ اتباع (ثمین: passport_number)
  nationality: varchar('nationality', { length: 10 }),         // کد ملیت ثمین (ایران=120001)
  religion: varchar('religion', { length: 10 }),               // کد دین ثمین
  birthPlaceCode: varchar('birthPlaceCode', { length: 10 }),  // کد محل تولد (ثمین: birth_place)
  issuePlaceCode: varchar('issuePlaceCode', { length: 10 }),  // کد محل صدور (ثمین: iden_issue_place)
  postalCode: varchar('postalCode', { length: 10 }),          // کد پستی ۱۰ رقمی
  isAlive: integer('isAlive').notNull().default(1),            // ثمین: is_alive
  saminPersonPk: varchar('saminPersonPk', { length: 40 }),    // کلید فرد در مبدأ ثمین (person_pk_in_source)
  saminIsVerified: integer('saminIsVerified'),                 // ثمین: is_verified
  saminVerifyCheckDate: timestamp('saminVerifyCheckDate'),
  passwordHash: varchar('passwordHash', { length: 255 }).notNull(),
  isActive: integer('isActive').default(1),
  // ── فلگ «تغییر اجباری رمز در اولین ورود» (برای حساب‌های پذیرش‌شده با رمز پیش‌فرض) ──
  mustChangePassword: integer('mustChangePassword').default(0),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow()
}, (t) => ({
  // هویت حساب = (کد ملی + دانشگاه)؛ NULLها (ثبت‌نام ناقص) از یکتایی مستثنا هستند
  uqNcUni: unique('uq_users_nc_uni').on(t.nationalCode, t.universityId),
  uqNcBlind: index('idx_users_nc_blind').on(t.nationalCodeBlindIndex, t.universityId),
}));

export const user_roles = pgTable('user_roles', {
  userId: integer('userId').notNull().references(() => users.id),
  roleId: integer('roleId').notNull().references(() => roles.id),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.roleId] }) }));

export const sessions = pgTable('sessions', {
  token: varchar('token', { length: 64 }).primaryKey(),
  userId: integer('userId').notNull().references(() => users.id),
  expiresAt: timestamp('expiresAt').notNull()
}, (t) => ({
  // M-4: پاکسازی نشست‌های منقضی (WHERE expiresAt) و چرخش per-user (WHERE userId ORDER BY expiresAt)
  sessionsUserIdIdx: index('sessions_userId_idx').on(t.userId),
  sessionsExpiresAtIdx: index('sessions_expiresAt_idx').on(t.expiresAt),
}));

export const degree_level_configs = pgTable('degree_level_configs', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 100 }).notNull(),
  code: varchar('code', { length: 30 }).notNull().unique(),
  standardCode: varchar('standardCode', { length: 50 }),    // کد استاندارد وزارت علوم
  ministryCode: varchar('ministryCode', { length: 50 }),    // کد وزارت علوم
  defaultPassingGrade: numeric('defaultPassingGrade', { precision: 4, scale: 2 }).notNull().default('10.00'),
  conditionalGpaThreshold: numeric('conditionalGpaThreshold', { precision: 4, scale: 2 }).notNull().default('12.00'),
  maxUnitsPerTerm: integer('maxUnitsPerTerm').default(20),
  /** تعداد ترم تحصیل چارت این مقطع (کاردانی/ناپیوسته/ارشد: ۴ · پیوسته: ۸) — NULL = استنتاج از عنوان/کد */
  termCount: integer('termCount'),
  /** تحصیلات تکمیلی (ارشد/دکترا) یا نه — ۱/۰ (NULL هم یعنی نه؛ بدون default تا backfill با COALESCE درست کار کند) */
  isGraduate: integer('isGraduate'),
  /** دانشگاه مالک این کاربر */
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  /** حالت نمایش نمره در کارنامه: NUMERIC | QUALITATIVE | BOTH */
  transcriptDisplayMode: varchar('transcriptDisplayMode', { length: 20 }).default('NUMERIC'),
});

/** آستانه‌های نمره کیفی (عالی/خیلی خوب/خوب/مردود) بر اساس مقطع */
export const grade_thresholds = pgTable('grade_thresholds', {
  id: serial('id').primaryKey(),
  degreeLevelId: integer('degreeLevelId').notNull().references(() => degree_level_configs.id),
  label: varchar('label', { length: 50 }).notNull(),
  minValue: numeric('minValue', { precision: 4, scale: 2 }).notNull(),
  maxValue: numeric('maxValue', { precision: 4, scale: 2 }).notNull(),
  passed: integer('passed').notNull().default(1),
  sortOrder: integer('sortOrder').notNull().default(0),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const faculties = pgTable('faculties', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 150 }).notNull(),
  // ── کد دانشکده از دیتابیس قدیمی/سازمان (فایل reshtelist—ستون «کد دانشکده») ──
  facultyCode: varchar('facultyCode', { length: 10 }),
  standardCode: varchar('standardCode', { length: 50 }),    // کد استاندارد وزارت علوم
  ministryCode: varchar('ministryCode', { length: 50 }),    // کد وزارت علوم
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const departments = pgTable('departments', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 150 }).notNull(),
  facultyId: integer('facultyId').notNull().references(() => faculties.id),
  // ── کد گروه آموزشی از دیتابیس قدیمی (فایل reshtelist—ستون «گروه آموزشی») ──
  departmentCode: varchar('departmentCode', { length: 10 }),
  standardCode: varchar('standardCode', { length: 50 }),    // کد استاندارد وزارت علوم
  ministryCode: varchar('ministryCode', { length: 50 }),    // کد وزارت علوم
  /**
   * مدیر گروه — از میان پرونده‌های کارمندی/هیئت علمی انتخاب می‌شود.
   * عمداً اینجا (روی گروه) ذخیره می‌شود نه روی staff، چون مدیر گروهِ «دروس
   * عمومی و مشترک» معمولاً عضو همان گروه نیست؛ او استادی از یک گروه دیگر
   * است که سرپرستی گروه عمومی را هم دارد. یک نفر می‌تواند مدیر چند گروه باشد.
   */
  headStaffId: integer('headStaffId'),
  /**
   * نوع گروه: ACADEMIC = گروه آموزشیِ رشته‌دار · GENERAL = گروه دروس عمومی و
   * مشترک (معارف، تربیت بدنی، زبان، ریاضی عمومی…) که رشتهٔ مستقل ندارد ولی
   * دروسش برای همهٔ رشته‌ها ارائه می‌شود.
   */
  kind: varchar('kind', { length: 20 }).default('ACADEMIC'),
  isActive: integer('isActive').default(1),
  /** دانشگاه مالک این گروه */
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const majors = pgTable('majors', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 150 }).notNull(),
  degreeLevelId: integer('degreeLevelId').notNull().references(() => degree_level_configs.id),
  departmentId: integer('departmentId').references(() => departments.id),
  majorCode: varchar('majorCode', { length: 10 }).unique(),  // 🔒 کلید ON CONFLICT سیّد — باید یکتا باشد (CI در این‌جا شکست می‌خورد)
  // ── فیلدهای تکمیلی از دیتابیس قدیمی/سازمان (فایل reshtelist) ──
  facultyId: integer('facultyId').references(() => faculties.id),      // کد دانشکده
  minUnits: integer('minUnits'),                                        // حداقل واحد
  standardCode: varchar('standardCode', { length: 20 }),                // کد استاندارد رشته
  ministryCode: varchar('ministryCode', { length: 50 }),                // کد وزارت علوم
  establishedDate: varchar('establishedDate', { length: 10 }),          // تاریخ تاسیس (شمسی)
  terminatedDate: varchar('terminatedDate', { length: 10 }),            // تاریخ خاتمه (شمسی)
  isActive: integer('isActive').default(1),                             // فعال/غیرفعال
  headStaffCode: varchar('headStaffCode', { length: 20 }),              // کد استادی مدیر گروه
  headName: varchar('headName', { length: 150 }),                       // نام مدیر گروه (ستون جدای فایل قدیمی)
  expertName: varchar('expertName', { length: 150 }),                   // نام کارشناس رشته
  lastCouncilDate: varchar('lastCouncilDate', { length: 10 }),           // آخرین جلسه شورای گسترش (شمسی)
  /** رشتهٔ دارای دانشجوی شاغلِ زیاد — اولویت شیفت عصر در امتحانات (فاز ۹) */
  isWorkingClassMajority: boolean('isWorkingClassMajority').notNull().default(false),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const sanjesh_mappings = pgTable('sanjesh_mappings', {
  id: serial('id').primaryKey(),
  sanjeshCode: varchar('sanjeshCode', { length: 50 }).notNull(),
  internalMajorId: integer('internalMajorId').references(() => majors.id),
  sanjeshQuota: varchar('sanjeshQuota', { length: 50 }),
  internalQuotaCode: integer('internalQuotaCode'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  /** تهی ⇒ نگاشت سراسری؛ مقدار‌دار ⇒ override همان فایل سنجش */
  fileId: integer('fileId').references((): AnyPgColumn => sanjesh_files.id, { onDelete: 'cascade' }),
  note: varchar('note', { length: 200 }),
}, (t) => [
  index('idx_sanjesh_mappings_file').on(t.fileId),
]);

/* ════════════════════════════════════════════════════════════════════════
   ماژول «تبدیل اطلاعات سازمان سنجش» (مهاجرت 0128)
   اصل: هیچ داده‌ای از فایل سنجش دور ریخته نمی‌شود — ستون‌های نگاشت‌نشده هم
   در `dataJson` با کلید شمارهٔ ستون ذخیره می‌شوند.
   ════════════════════════════════════════════════════════════════════════ */

/** قالب ساختار فایل — **کاربر می‌تواند تعریف/ویرایش کند** (نه فقط قالب‌های کد) */
export const sanjesh_templates = pgTable('sanjesh_templates', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 60 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  examKind: varchar('examKind', { length: 20 }).notNull(),
  examYear: integer('examYear').notNull(),
  columnCount: integer('columnCount').notNull(),
  pdfRowCount: integer('pdfRowCount'),
  /** [{ colIndex, sanjeshTitle, charCount, targetField }] */
  columnsJson: jsonb('columnsJson').notNull(),
  /** { gender: [{ value, label, internalValue }], … } */
  decodeTablesJson: jsonb('decodeTablesJson').notNull().default({}),
  expandedRowsJson: jsonb('expandedRowsJson').notNull().default([]),
  notes: text('notes'),
  isBuiltin: boolean('isBuiltin').notNull().default(false),
  verifiedWithRealFile: boolean('verifiedWithRealFile').notNull().default(false),
  isActive: boolean('isActive').notNull().default(true),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdByUserId: integer('createdByUserId').references(() => users.id),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
}, (t) => [
  // کلید در دامنهٔ هر دانشگاه یکتاست؛ قالب سراسری (NULL) با COALESCE→۰
  uniqueIndex('uq_sanjesh_templates_key').on(sql`COALESCE(${t.universityId}, 0)`, t.key),
  index('idx_sanjesh_templates_kind_year').on(t.examKind, t.examYear),
  index('idx_sanjesh_templates_uni').on(t.universityId),
]);

/** یک فایل بارگذاری‌شده (یک آزمون/یک سال) */
export const sanjesh_files = pgTable('sanjesh_files', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  termId: integer('termId').references(() => academic_terms.id),
  degreeLevelId: integer('degreeLevelId').references(() => degree_level_configs.id),
  templateId: integer('templateId').references(() => sanjesh_templates.id),
  templateKey: varchar('templateKey', { length: 60 }),
  title: varchar('title', { length: 200 }).notNull(),
  examKind: varchar('examKind', { length: 20 }),
  examYear: integer('examYear'),
  fileName: varchar('fileName', { length: 255 }),
  fileSize: integer('fileSize'),
  fileHash: varchar('fileHash', { length: 64 }),
  encoding: varchar('encoding', { length: 20 }),
  columnCount: integer('columnCount').notNull().default(0),
  rowCount: integer('rowCount').notNull().default(0),
  /** DRAFT | FIELDS_READY | VALUED | STAGED | DONE */
  status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
  warningsJson: jsonb('warningsJson').notNull().default([]),
  uploadedByUserId: integer('uploadedByUserId').references(() => users.id),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
}, (t) => [
  index('idx_sanjesh_files_status').on(t.status),
  index('idx_sanjesh_files_term').on(t.termId),
  index('idx_sanjesh_files_hash').on(t.fileHash),
]);

/** تطبیق فیلدها: شمارهٔ ستون ↔ فیلد مقصد */
export const sanjesh_file_fields = pgTable('sanjesh_file_fields', {
  id: serial('id').primaryKey(),
  fileId: integer('fileId').notNull().references(() => sanjesh_files.id, { onDelete: 'cascade' }),
  /** از فایل والد به ارث می‌رسد تا دامنه‌بندی بدون JOIN ممکن باشد */
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  colIndex: integer('colIndex').notNull(),
  sanjeshTitle: varchar('sanjeshTitle', { length: 200 }).notNull(),
  charCount: integer('charCount').notNull().default(0),
  /** تهی ⇒ نگاشت‌نشده (مدیر باید تعیین کند) */
  targetField: varchar('targetField', { length: 60 }),
  sampleValue: text('sampleValue'),
  observedLength: integer('observedLength'),
  isMapped: boolean('isMapped').notNull().default(false),
}, (t) => [
  unique('uq_sanjesh_file_fields').on(t.fileId, t.colIndex),
  index('idx_sanjesh_file_fields_file').on(t.fileId),
  index('idx_sanjesh_file_fields_uni').on(t.universityId),
]);

/** دادهٔ خام هر داوطلب — کامل و بی‌کم‌وکاست */
export const sanjesh_file_rows = pgTable('sanjesh_file_rows', {
  id: serial('id').primaryKey(),
  fileId: integer('fileId').notNull().references(() => sanjesh_files.id, { onDelete: 'cascade' }),
  /** از فایل والد به ارث می‌رسد؛ این جدول PII کامل دارد */
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  rowNo: integer('rowNo').notNull(),
  /** خط اصلی فایل، بدون هیچ دستکاری */
  rawLine: text('rawLine').notNull(),
  /** { fields: {targetField: value}, columns: {"1": "…"}, meta: {…} } */
  dataJson: jsonb('dataJson').notNull(),
  nationalCode: varchar('nationalCode', { length: 10 }),
  nationalCodeEnc: text('nationalCodeEnc'),
  nationalCodeBlindIndex: text('nationalCodeBlindIndex'),
  nationalCodeValid: boolean('nationalCodeValid').notNull().default(false),
  applicantNo: varchar('applicantNo', { length: 40 }),
  uniqueId: varchar('uniqueId', { length: 40 }),
  fullName: varchar('fullName', { length: 200 }),
  rowHash: varchar('rowHash', { length: 16 }),
  studentId: integer('studentId').references((): AnyPgColumn => students.id),
  /** PENDING | MATCHED | DUPLICATE | INVALID | IGNORED */
  matchStatus: varchar('matchStatus', { length: 20 }).notNull().default('PENDING'),
  matchNote: text('matchNote'),
  matchedAt: timestamp('matchedAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
}, (t) => [
  unique('uq_sanjesh_file_rows').on(t.fileId, t.rowNo),
  index('idx_sanjesh_file_rows_file').on(t.fileId),
  index('idx_sanjesh_file_rows_nc').on(t.nationalCode),
  index('idx_sanjesh_file_rows_nc_blind').on(t.nationalCodeBlindIndex),
  index('idx_sanjesh_file_rows_status').on(t.matchStatus),
  index('idx_sanjesh_file_rows_hash').on(t.fileId, t.rowHash),
  index('idx_sanjesh_file_rows_uni').on(t.universityId),
]);

/** جدول براورد: کد سنجش ↔ عنوان/کد داخلی (fileId تهی ⇒ سراسری) */
export const sanjesh_value_maps = pgTable('sanjesh_value_maps', {
  id: serial('id').primaryKey(),
  fileId: integer('fileId').references(() => sanjesh_files.id, { onDelete: 'cascade' }),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  field: varchar('field', { length: 60 }).notNull(),
  sanjeshValue: varchar('sanjeshValue', { length: 100 }).notNull(),
  sanjeshLabel: varchar('sanjeshLabel', { length: 200 }),
  internalValue: varchar('internalValue', { length: 60 }),
  internalLabel: varchar('internalLabel', { length: 200 }),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
}, (t) => [
  unique('uq_sanjesh_value_maps').on(t.fileId, t.field, t.sanjeshValue),
  index('idx_sanjesh_value_maps_field').on(t.field),
  index('idx_sanjesh_value_maps_uni').on(t.universityId),
]);

export const admissions_staging = pgTable('admissions_staging', {
  id: serial('id').primaryKey(),
  nationalCode: varchar('nationalCode', { length: 10 }).notNull(),
  nationalCodeEnc: text('nationalCodeEnc'),
  nationalCodeBlindIndex: text('nationalCodeBlindIndex'),
  rawSanjeshData: text('rawSanjeshData'),
  mappedMajorId: integer('mappedMajorId').references(() => majors.id),
  status: varchar('status', { length: 20 }).default('pending'),
  userId: integer('userId').references(() => users.id),
  fullName: varchar('fullName', { length: 150 }),
  mobile: varchar('mobile', { length: 11 }),
  entryYear: integer('entryYear'),
  degreeLevelId: integer('degreeLevelId').references(() => degree_level_configs.id),
  quotaType: varchar('quotaType', { length: 50 }).default('NORMAL'),
  profileJson: text('profileJson'),
  paidAdvance: integer('paidAdvance').default(0),
  paidAmount: integer('paidAmount').default(0),
  onboardingStatus: varchar('onboardingStatus', { length: 30 }).default('IMPORTED'),
  studentId: integer('studentId'),
  decisionNote: text('decisionNote'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  // ── پیوند با فایل سنجش (مهاجرت 0128) ──
  fileId: integer('fileId'),
  rowNo: integer('rowNo'),
  assignedStudentCode: varchar('assignedStudentCode', { length: 14 }),
  matchedAt: timestamp('matchedAt'),
}, (t) => [
  index('idx_adm_stg_nc_blind').on(t.nationalCodeBlindIndex),
  index('idx_adm_stg_file').on(t.fileId, t.rowNo),
]);

export const student_id_formulas = pgTable('student_id_formulas', {
  id: serial('id').primaryKey(),
  degreeLevelId: integer('degreeLevelId').references(() => degree_level_configs.id),
  entryYear: integer('entryYear'),
  formula: varchar('formula', { length: 255 }).notNull(),
  currentSequence: integer('currentSequence').default(0),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({
  // جلوگیری از رقابت روی شمارنده: هر مقطع فقط یک ردیف فرمول — مبنای onConflictDoNothing
  uqDegreeLevel: unique('student_id_formulas_degreeLevelId_unique').on(t.degreeLevelId)
}));

/**
 * کتابخانهٔ «مدل‌های فرمول» (مهاجرت 0132).
 * کارشناس چند الگو می‌سازد و هنگام تعریف فرمولِ هر مقطع یکی را انتخاب می‌کند.
 * خودِ فرمولِ فعال همچنان در `student_id_formulas` می‌ماند؛ این جدول فقط الگوست.
 */
export const student_id_formula_models = pgTable('student_id_formula_models', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  title: varchar('title', { length: 150 }).notNull(),
  formula: varchar('formula', { length: 255 }).notNull(),
  note: varchar('note', { length: 200 }),
  isActive: boolean('isActive').notNull().default(true),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
}, (t) => [
  index('idx_formula_models_uni').on(t.universityId),
]);

export const educational_regulations = pgTable('educational_regulations', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 150 }).notNull(),
  degreeLevelId: integer('degreeLevelId').notNull().references(() => degree_level_configs.id),
  effectiveFromYear: integer('effectiveFromYear').notNull(),
  effectiveToYear: integer('effectiveToYear'),
  rulesConfig: text('rulesConfig').notNull(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow()
});

export const students = pgTable('students', {
  id: serial('id').primaryKey(),
  personId: integer('personId').references(() => persons.id),
  userId: integer('userId').notNull().references(() => users.id),
  studentCode: varchar('studentCode', { length: 14 }).notNull(),
  majorId: integer('majorId').references(() => majors.id),
  degreeLevelId: integer('degreeLevelId').notNull().references(() => degree_level_configs.id),
  regulationId: integer('regulationId').notNull().references(() => educational_regulations.id),
  entryYear: integer('entryYear').notNull(),
  entryTerm: integer('entryTerm').default(1),
  entryDate: date('entryDate'),
  graduateDegreeLevelId: integer('graduateDegreeLevelId').references(() => degree_level_configs.id),
  status: varchar('status', { length: 30 }).notNull().default('ACTIVE'),
  quotaType: varchar('quotaType', { length: 50 }).notNull().default('NORMAL'),
  samaStatusCode: varchar('samaStatusCode', { length: 10 }), // کد خام «وضعيت دانشجو» سما (رهگیری/بازنگاشت)
  extraAllowedSemesters: integer('extraAllowedSemesters').notNull().default(0),
  extraAllowedProbations: integer('extraAllowedProbations').notNull().default(0),
  currentTermNo: integer('currentTermNo').default(1),
  // ── دروس جبرانی (دانشجوی انتقالی/رشتهٔ نامرتبط) ──
  // واحدهای جبرانیِ تعیین‌شده توسط مدیر گروه؛ به سقف واحد همان ترم اضافه می‌شود
  // (مثلاً سقف ۲۰ + ۶ جبرانی = ۲۶) و در «کف واحد» شمرده نمی‌شود.
  compensatoryUnits: integer('compensatoryUnits').notNull().default(0),
  // ── منبع پذیرش (مهاجرت 0130): اعلام‌شده از سنجش یا ثبت متفرقه ──
  admissionSource: varchar('admissionSource', { length: 20 }).default('LEGACY'), // SANJESH | MANUAL | LEGACY
  sanjeshFileId: integer('sanjeshFileId'),
  sanjeshRowNo: integer('sanjeshRowNo'),
  manualReason: text('manualReason'),
  /** رشتهٔ قبلی (از سازمان سنجش) — برای تشخیص جبرانی در صفحهٔ مدیر گروه */
  previousMajorCode: varchar('previousMajorCode', { length: 20 }),
  previousMajorTitle: varchar('previousMajorTitle', { length: 150 }),
  /** RELATED | PARTIAL | UNRELATED — تشخیص خودکار/دستی مرتبط‌بودن رشتهٔ قبلی */
  previousMajorRelation: varchar('previousMajorRelation', { length: 20 }),
  /**
   * اورراید دستی «شاگرد ممتاز»: NULL = تشخیص خودکار از معدل ترم قبل،
   * ۱ = ممتاز (سقف honors_max_units)، ۰ = غیرممتاز. مدیر گروه می‌تواند تغییر دهد.
   */
  honorsOverride: integer('honorsOverride'),
  // ── توسعهٔ چنددانشگاهی / ثمین ──
  universityId: integer('universityId').references((): AnyPgColumn => universities.id), // دانشگاه مالک رکورد
  saminStudentPk: varchar('saminStudentPk', { length: 40 }), // کلید دانشجو در مبدأ ثمین
  senderUniversityCode: varchar('senderUniversityCode', { length: 20 }), // کد فرستنده ثمین
  nativeType: varchar('nativeType', { length: 10 }),         // بومی/غیربومی ثمین
  ethnicity: varchar('ethnicity', { length: 10 }),
  sanjeshFileNumber: varchar('sanjeshFileNumber', { length: 40 }),
  sanjeshApplicantNumber: varchar('sanjeshApplicantNumber', { length: 40 }),
  saminFieldCode: varchar('saminFieldCode', { length: 20 }), // کد متمرکز رشته ثمین
  saminLocalFieldCode: varchar('saminLocalFieldCode', { length: 20 }),
  acceptanceAllocation: varchar('acceptanceAllocation', { length: 30 }),
  acceptanceType: varchar('acceptanceType', { length: 30 }),
  studyingMode: varchar('studyingMode', { length: 20 }),
  trainingMethod: varchar('trainingMethod', { length: 20 }),
  isaarCode: varchar('isaarCode', { length: 20 }),
  totalAverage: numeric('totalAverage', { precision: 4, scale: 2 }),
  eduEndYear: integer('eduEndYear'),
  eduEndSemester: integer('eduEndSemester'),
  graduateDate: varchar('graduateDate', { length: 10 }),
  totalTakenUnits: integer('totalTakenUnits'),
  totalPassedUnits: integer('totalPassedUnits'),
  totalFailedUnits: integer('totalFailedUnits'),
  saminDescription: text('saminDescription'),
  // ── پروندهٔ تکمیلی سما (student2.txt + students1.txt): خوابگاه، ولی، مدرک، نظام وظیفه و... ──
  advisorCode: varchar('advisorCode', { length: 50 }),             // ADVISORDONCODE سما
  documentStatus: varchar('documentStatus', { length: 100 }),       // وضعیت مدارک (دستی)
  scholarshipType: varchar('scholarshipType', { length: 100 }),     // کد بورسیهٔ سما (ScholarshipRef)
  militaryStatus: varchar('militaryStatus', { length: 50 }),        // وضعیت نظام وظیفه (NEZAM/Moafiat سما)
  militaryExemptionNo: varchar('militaryExemptionNo', { length: 50 }), // شمارهٔ معافیت (MoafiatNumber/NezamNo)
  homeTell: varchar('homeTell', { length: 20 }),              // تلفن ثابت منزل (HOMETELL سما — students1 col18)
  studentCardStatus: varchar('studentCardStatus', { length: 50 }),  // وضعیت کارت دانشجویی (StCardPrinted)
  archiveNo: varchar('archiveNo', { length: 50 }),                  // کد آرشیو سما
  parvandehNo: varchar('parvandehNo', { length: 100 }),             // شمارهٔ پروندهٔ سما
  dormName: varchar('dormName', { length: 150 }),                   // نام خوابگاه (SuiteName)
  dormRoom: varchar('dormRoom', { length: 50 }),                    // شمارهٔ اتاق (RoomNumber)
  hasDorm: integer('hasDorm').default(0),                            // HasKhabgah سما (1/0)
  guardianJobTitle: varchar('guardianJobTitle', { length: 100 }),   // عنوان و شغل ولی (ValiJobTitle)
  guardianPhone: varchar('guardianPhone', { length: 30 }),          // تلفن ولی (ValiTellNo)
  guardianAddress: varchar('guardianAddress', { length: 300 }),      // نشانی ولی (ValiAddress)
  guardianEmail: varchar('guardianEmail', { length: 150 }),         // ایمیل ولی (ParentEmail)
  diplomaType: varchar('diplomaType', { length: 50 }),              // نوع دیپلم پایه (UPDiplomTypeCode خام)
  diplomaPlace: varchar('diplomaPlace', { length: 200 }),           // محل اخذ دیپلم (FoghedipPlace)
  diplomaYear: varchar('diplomaYear', { length: 10 }),              // سال اخذ دیپلم (FoghedipYear)
  diplomaGrade: varchar('diplomaGrade', { length: 20 }),            // معدل کتبی دیپلم (FoghedipMoadel)
  pishdPlace: varchar('pishdPlace', { length: 200 }),               // محل اخذ پیش‌دانشگاهی (PishdPlace)
  pishdYear: varchar('pishdYear', { length: 10 }),                  // سال پیش‌دانشگاهی (PishdYear)
  pishdGrade: varchar('pishdGrade', { length: 20 }),                // معدل پیش‌دانشگاهی (PishdMoadel)
  tuitionType: varchar('tuitionType', { length: 50 }),              // نوع دوره/شهریه (COURSTYPE خام)
  tuitionPayer: integer('tuitionPayer').default(0),                 // دانشجوی شهریه‌پرداز (دستی 1/0)
  englishExamType: varchar('englishExamType', { length: 50 }),      // نوع آزمون زبان (MSRT/IELTS/…)
  englishScore: varchar('englishScore', { length: 20 }),            // نمرهٔ آزمون زبان
  insertDate: varchar('insertDate', { length: 20 }),                // تاریخ ثبت در سما (LogInsertDate)
  insertTime: varchar('insertTime', { length: 20 }),                // ساعت ثبت در سما (LogInsertTime)
  certIssued3m: integer('certIssued3m').default(0),                 // تعداد گواهی ۳ ماههٔ صادره
  documentDeficiency: varchar('documentDeficiency', { length: 200 }), // نواقص پرونده
  unitsRemaining: integer('unitsRemaining'),                        // واحد مانده تا فارغ‌التحصیلی
  eqSemesters: integer('eqSemesters').default(0),                   // تعداد ترم معادل‌سازی
  // ── گزارش سالانهٔ «سهام» (IRPHE) — ستون‌هایی که هیچ منبع دیگری نداشت ──
  // سهام دو ستون جدا می‌خواهد که در سیستم ما قاطی شده بودند:
  //   شیوه آموزش (حضوری/نیمه حضوری/غیر حضوری) ≠ نوع تحصیل (روزانه/شبانه/…)
  teachingMode: varchar('teachingMode', { length: 50 }),      // شیوه آموزش سهام
  studyType: varchar('studyType', { length: 50 }),            // نوع تحصیل سهام (روزانه/شبانه/فراگیر)
  maritalStatus: varchar('maritalStatus', { length: 20 }),    // وضعیت تاهل: مجرد/متاهل
  birthProvince: varchar('birthProvince', { length: 100 }),    // استان محل تولد (سهام جدا می‌خواهد)
  birthCity: varchar('birthCity', { length: 100 }),            // شهر محل تولد
  residenceProvince: varchar('residenceProvince', { length: 100 }), // استان محل سکونت دائمی
  residenceCity: varchar('residenceCity', { length: 100 }),    // شهر محل سکونت دائمی
  transferGuestStatus: varchar('transferGuestStatus', { length: 100 }), // وضعیت انتقال/مهمان
  admissionMethod: varchar('admissionMethod', { length: 100 }),// روش پذیرش (متمرکز/نیمه متمرکز)
  tuitionPaymentMethod: varchar('tuitionPaymentMethod', { length: 100 }), // نحوه پرداخت شهریه
  entranceExamRank: varchar('entranceExamRank', { length: 20 }),// رتبه آزمون ورودی
  foreignStudentId: varchar('foreignStudentId', { length: 30 }),// شناسه فراگير اتباع خارجی
}, (t) => [
  // شماره دانشجویی در هر دانشگاه یکتاست (نه سراسری) — سما هر دانشگاه شماره‌گذاری جدا دارد
  unique('uq_students_uni_code').on(t.universityId, t.studentCode),
  // جست‌وجوی ردیف‌های دانشجویی هر کاربر (ورود، نقش‌ها، بنر جابه‌جایی حساب)
  index('idx_students_userid').on(t.userId),
]);

/**
 * وضعیت هر دانشجو در هر نیمسال — از «وضعيت نيمسال دانشجويان.txt» سما.
 * بالای هر نیمسال کارنامه همین نمایش داده می‌شود (نه وضعیت کلی دانشجو):
 * عنوان وضعیت (در حال تحصیل/مرخصی/میهمان/…) + مشروط/عادی از Mashroot.
 */
export const student_term_states = pgTable('student_term_states', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  termId: integer('termId').notNull().references(() => academic_terms.id),
  termCode: varchar('termCode', { length: 10 }).notNull(),
  statusCode: varchar('statusCode', { length: 10 }),
  statusTitle: varchar('statusTitle', { length: 150 }),
  isProbation: integer('isProbation'),
  termAvg: numeric('termAvg', { precision: 4, scale: 2 }),
  // ── فیلدهای تکمیلی Migration V2 جهت حفظ تفکیک داده مبدأ، نرمال‌شده و محاسبه آیین‌نامه ──
  sourceStatusCode: varchar('sourceStatusCode', { length: 20 }),
  sourceStatusTitle: varchar('sourceStatusTitle', { length: 150 }),
  sourceTermAvg: numeric('sourceTermAvg', { precision: 4, scale: 2 }),
  normalizedStatusCode: varchar('normalizedStatusCode', { length: 20 }),
  normalizedStatusTitle: varchar('normalizedStatusTitle', { length: 150 }),
  normalizedTermAvg: numeric('normalizedTermAvg', { precision: 4, scale: 2 }),
  sourceProbation: integer('sourceProbation'),
  calculatedProbation: integer('calculatedProbation'),
  sourceCompletedUnits: numeric('sourceCompletedUnits', { precision: 4, scale: 1 }),
  sourcePassedUnits: numeric('sourcePassedUnits', { precision: 4, scale: 1 }),
  sourceAttemptedUnits: numeric('sourceAttemptedUnits', { precision: 4, scale: 1 }),
  /** ردیابی فعال‌سازی ترم‌به‌ترم */
  activatedByUserId: integer('activatedByUserId').references(() => users.id),
  activatedAt: timestamp('activatedAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({ uq: unique('uq_student_term_states').on(t.studentId, t.termId) }));

/**
 * جدول مرجع «وضعیت‌های نیمسال» — بازتولید دقیق از دیتابیس قدیمی سما (فایل
 * «وضعيت نيمسال.txt»). هر ردیف، یکی از ۶۷ وضعیتِ نیمسال (کد ۰ تا ۶۶) را با
 * پرچم‌های مالی/ثبت‌نامی‌اش تعریف می‌کند (فعال در ترم، محاسبه در سنوات، شمارش
 * در سال‌های مالی، شمول شهریه، اثر در رتبه/معدل، …). ردیف‌های مربوط‌به هر
 * دانشجو در `student_term_states` قرار دارند و از طریق `sourceStatusCode`
 * (کدِ سما) به این جدول ربط می‌خورند. ستون `studentTermTypeId` پیوند به نوع
 * ترمِ دانشجو در سما است (در خروجیِ مبدأ در ستون آخر آمده بود).
 *
 * این جدول دادهٔ شخصی/مالی ندارد ⇒ معاف از سخت‌سازی RLS. مهاجرت: ۰۱۲۰.
 */
export const term_status_types = pgTable('term_status_types', {
  id: serial('id').primaryKey(),
  code: integer('code').notNull().unique(),
  title: varchar('title', { length: 150 }).notNull(),
  activeInTerm: boolean('active_in_term').notNull().default(false),
  countInYears: boolean('count_in_years').notNull().default(false),
  allowRegister: boolean('allow_register').notNull().default(false),
  latinTitle: varchar('latin_title', { length: 150 }),
  standardCode: varchar('standard_code', { length: 20 }),
  includedTuition: boolean('included_tuition').notNull().default(false),
  rotbehEffect: boolean('rotbeh_effect').notNull().default(false),
  useRating: boolean('use_rating').notNull().default(false),
  allowTermStatusChangeTermEnter: boolean('allow_term_status_change_term_enter').notNull().default(false),
  effectFinancialYears: boolean('effect_financial_years').notNull().default(false),
  includeTermPriceMabSubject: boolean('include_term_price_mab_subject').notNull().default(false),
  isGraduateStatus: boolean('is_graduate_status').notNull().default(false),
  studentTermTypeId: integer('student_term_type_id'),
  source: varchar('source', { length: 20 }).notNull().default('SAMA'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const staff = pgTable('staff', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull().unique().references(() => users.id),
  staffCode: varchar('staffCode', { length: 20 }).notNull(),
  standardCode: varchar('standardCode', { length: 50 }),    // کد استاندارد وزارت علوم
  ministryCode: varchar('ministryCode', { length: 50 }),    // کد وزارت علوم
  departmentId: integer('departmentId').references(() => departments.id),
  staffType: varchar('staffType', { length: 50 }),
  academicRank: varchar('academicRank', { length: 50 }),
  degree: varchar('degree', { length: 50 }),
  // ── فیلدهای تکمیلی از دیتابیس قدیمی/سازمان (فایل professorslist) ──
  title: varchar('title', { length: 50 }),                // لقب: آقاي/سركار خانم/دکتر/مهندس
  facultyId: integer('facultyId').references(() => faculties.id),  // دانشکده
  isActive: integer('isActive').default(1),               // فعال/غیرفعال
  cooperationType: varchar('cooperationType', { length: 50 }),      // طريقه همکاري: حق التدريس/رسمي...
  personnelNo: varchar('personnelNo', { length: 50 }),    // شماره مستخدم
  employmentType: varchar('employmentType', { length: 50 }),       // نوع استخدامي: قراردادي/رسمي...
  hireDate: varchar('hireDate', { length: 10 }),          // تاريخ استخدام (شمسی)
  lastDegreeYear: integer('lastDegreeYear'),              // سال اخذ آخرين مدرک تحصيلي
  fieldOfStudy: varchar('fieldOfStudy', { length: 200 }), // رشته و گرايش
  fieldMain: varchar('fieldMain', { length: 200 }),       // «رشته» (ستون جدا از «رشته و گرايش» در فایل قدیمی)
  maritalStatusCode: integer('maritalStatusCode'),        // کد وضعيت تاهل
  maritalStatus: varchar('maritalStatus', { length: 20 }),// وضعيت تاهل: مجرد/متاهل
  lastDegreeCountryCode: varchar('lastDegreeCountryCode', { length: 10 }), // کد کشور آخرين مدرک
  lastDegreeUniversity: varchar('lastDegreeUniversity', { length: 200 }), // دانشگاه محل اخذ آخرين مدرک
  academicBase: varchar('academicBase', { length: 20 }),  // پايه استادي
  birthProvince: varchar('birthProvince', { length: 100 }), // استان محل تولد
  birthCity: varchar('birthCity', { length: 100 }),       // شهر محل تولد
  bankAccountNo: varchar('bankAccountNo', { length: 50 }), // شماره حساب
  phone: varchar('phone', { length: 20 }),                 // تلفن ثابت
  photoUrl: text('photoUrl'),                              // عکس پرسنلی (مهاجرت 0087)
  isVeteran: integer('isVeteran').notNull().default(0),    // ایثارگر — معافیت مالیاتی (مهاجرت 0087)
  canManageServicePool: integer('canManageServicePool').default(0), // مدیر گروه خدماتی-سراسری (تربیت بدنی/زبان)
  /** دانشگاه مالک این پرونده */
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => [
  // کد استاد در هر دانشگاه یکتاست (نه سراسری)
  unique('uq_staff_uni_code').on(t.universityId, t.staffCode),
]);

/** خوشهٔ دروس هم‌ارز (مثل «ریاضی عمومی ۱» و «ریاضیات پایه» — یک محتوا، چند کد) */
export const equivalence_clusters = pgTable('equivalence_clusters', {
  id: serial('id').primaryKey(),
  clusterTitle: varchar('clusterTitle', { length: 100 }).notNull(),
  isGeneralService: integer('isGeneralService').default(0),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const courses = pgTable('courses', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 20 }).notNull(),
  standardCode: varchar('standardCode', { length: 50 }),    // کد استاندارد وزارت علوم
  ministryCode: varchar('ministryCode', { length: 50 }),    // کد وزارت علوم
  title: varchar('title', { length: 150 }).notNull(),
  // scale=2 لازم است: سما برای درس‌هایی مثل «آشنایی با صنعت کامپیوتر» تفکیک
  // ۰.۷۵/۰.۲۵ دارد و با یک رقم اعشار، مبلغ شهریه ۵۰۰ هزار ریال به‌ازای هر دانشجو خطا می‌رفت.
  theoreticalUnits: numeric('theoreticalUnits', { precision: 4, scale: 2 }).default('0'),
  practicalUnits: numeric('practicalUnits', { precision: 4, scale: 2 }).default('0'),
  units: numeric('units', { precision: 3, scale: 1 }).notNull(),
  courseType: varchar('courseType', { length: 50 }),
  departmentId: integer('departmentId').references(() => departments.id),
  // مقطعِ ارائهٔ درس (کارشناسی/ارشد/…) — NULL = مشترک بین مقاطع.
  // در مهاجرت از سیستم قدیمی از ستون «مقطع» فایل اکسل پر می‌شود.
  degreeLevelId: integer('degreeLevelId').references(() => degree_level_configs.id),
  gradingType: varchar('gradingType', { length: 20 }).default('NUMERIC'),
  affectsGpa: integer('affectsGpa').default(1),
  // ── موتور برنامه‌ریزی درسی ──
  clusterId: integer('clusterId').references(() => equivalence_clusters.id), // NULL = درس مستقل
  offeringScope: varchar('offeringScope', { length: 20 }).default('DEPARTMENTAL'), // DEPARTMENTAL | GENERAL_SERVICE (کارتابل دوگانه)
  locationType: varchar('locationType', { length: 20 }).default('IN_CAMPUS'),        // IN_CAMPUS | OUT_CAMPUS (مهارتی/ورزشی خارج دانشگاه)
  /** دانشگاه مالک این درس */
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  // ── فیلدهای سما (اطلاعات تکمیلی درس) ──
  courseNature: varchar('courseNature', { length: 50 }),            // ماهیت درس: نظری/عملی/نظری-عملی/پروژه/رساله/کارآموزی/...
  englishName: varchar('englishName', { length: 200 }),             // نام انگلیسی درس
  description: text('description'),                                  // توضیحات درس
  weeklyTheoryHours: numeric('weeklyTheoryHours', { precision: 3, scale: 1 }),  // ساعت هفتگی نظری
  weeklyPracticalHours: numeric('weeklyPracticalHours', { precision: 3, scale: 1 }), // ساعت هفتگی عملی
  isThesis: integer('isThesis').default(0),                         // آیا پایان‌نامه است (0/1)
  hasProject: integer('hasProject').default(0),                     // آیا پروژه دارد (0/1)
  internshipUnits: numeric('internshipUnits', { precision: 3, scale: 1 }).default('0'), // واحد کارآموزی
  minPassedMark: numeric('minPassedMark', { precision: 4, scale: 2 }), // حداقل نمره قبولی
  defaultAcceptMarkState: varchar('defaultAcceptMarkState', { length: 10 }), // کد وضعیت پیش‌فرض قبولی سما
  defaultRejectMarkState: varchar('defaultRejectMarkState', { length: 10 }), // کد وضعیت پیش‌فرض مردودی سما
  courseIsActive: integer('courseIsActive').default(1),                // فعال/غیرفعال
  emergencyWithdrawal: integer('emergencyWithdrawal').default(0),       // حذف اضطراری مجاز
  coRequisites: varchar('coRequisites', { length: 200 }),              // همنیاز (کدها جداشده با کاما)
  /**
   * متن خام ستون «پیش‌نیاز» از جدول دروس سیستم قدیمی.
   * چرا لازم است: قواعد پیش‌نیاز در `course_rules` **مقیّد به نسخهٔ برنامه**
   * هستند، ولی منبعِ اصلی داده «جدول دروس» است (سراسری). متن خام این‌جا
   * نگه داشته می‌شود و با «همگام‌سازی» به course_rules هر نسخه ترجمه می‌شود
   * (`src/lib/requisite-sync.ts`) — بدون این ستون، مهاجرت دوباره لازم بود.
   */
  prereqText: text('prereqText'),
  /**
   * «تعداد واحد گذراندهٔ لازم» برای اخذ این درس — از تعریف درس در سیستم قدیم.
   * در درخت قاعده به شرط `unitsPassed` ترجمه می‌شود.
   */
  prereqMinUnits: integer('prereqMinUnits'),
  /** «ترم لازم» — حداقل ترمی که این درس می‌تواند اخذ/ارائه شود (به شرط `minSemester` ترجمه می‌شود) */
  prereqMinTerm: integer('prereqMinTerm'),
  facesHours: numeric('facesHours', { precision: 3, scale: 1 }),       // ساعات چهره‌به‌چهره
  /** کدهای دروس هم‌ارز (جداشده با کاما) — مثال: '101,102,103' */
  equivalentCourseCodes: text('equivalentCourseCodes'),
  /**
   * «نوع درس مالی» سما (Mali_type) — از جدول LT7 سامانهٔ مبدأ، به‌ازای کد درس.
   * نرخ هر واحد در تعرفهٔ سما به همین نوع وابسته است (نظری × Th + عملی × OP)،
   * پس بدون آن بازتولید ریز شهریهٔ کارنامهٔ قدیم ممکن نیست.
   */
  legacyMaliType: integer('legacyMaliType'),
}, (t) => [
  // کد درس در هر دانشگاه یکتاست (نه سراسری) — سما هر دانشگاه کدگذاری جدا دارد
  unique('uq_courses_uni_code').on(t.universityId, t.code),
]);

/** گرایش‌های برنامهٔ درسی (مثلاً «هوش مصنوعی و رباتیک») — جایگزین tracks[] Mock در Client قدیم (D4) */
export const curriculum_tracks = pgTable('curriculum_tracks', {
  id: serial('id').primaryKey(),
  majorId: integer('majorId').notNull().references(() => majors.id),
  title: varchar('title', { length: 100 }).notNull(),
  code: varchar('code', { length: 20 }),              // کد سازمانی گرایش
  isActive: integer('isActive').default(1),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({
  uqTrack: unique('uq_curriculum_tracks_major_title').on(t.majorId, t.title),
}));

/**
 * نسخهٔ برنامهٔ درسی (ارتقای syllabuses — تصمیم D1).
 *
 * چرخهٔ حیات (تصمیم D1/D2 همان سند طراحی):
 *   DRAFT → REVIEW → APPROVED → PUBLISHED → ARCHIVED
 * قاعدهٔ طلایی: نسخهٔ تأییدشده هرگز Mutable نیست؛ تغییر = نسخهٔ جدید (1404-R1).
 * ویرایش فقط در DRAFT مجاز است (curriculum-types.canEditStatus).
 *
 * ⚠ قیدهای یکتاییِ محافظت‌شده در برابر trackId NULL (coalesce) و «فقط یک
 *   PUBLISHED فعال به ازای هر رشته/مقطع/گرایش» در فایل مهاجرت (drizzle/0002_*.sql)
 *   به‌صورت ایندکس جزئی اعمال می‌شوند — در schema.ts عمداً نیستند چون Drizzle
 *   روی کوئری `sql` قید جزئی (partial/expression) پشتیبانی کامل ندارد.
 */
export const curriculum_versions = pgTable('curriculum_versions', {
  id: serial('id').primaryKey(),
  majorId: integer('majorId').notNull().references(() => majors.id),
  degreeLevelId: integer('degreeLevelId').notNull().references(() => degree_level_configs.id),
  trackId: integer('trackId').references(() => curriculum_tracks.id),   // NULL = گرایش آزاد
  versionCode: varchar('versionCode', { length: 20 }).notNull(),        // «1404» یا «1404-R1»
  title: varchar('title', { length: 150 }).notNull(),                   // «برنامهٔ مهندسی نرم‌افزار ۱۴۰۴»
  status: varchar('status', { length: 20 }).notNull().default('DRAFT'), // DRAFT|REVIEW|APPROVED|PUBLISHED|ARCHIVED
  entryYearFrom: integer('entryYearFrom').notNull(),                    // بازهٔ ورودی: از
  entryYearTo: integer('entryYearTo'),                                  // بازهٔ ورودی: تا (NULL = به بعد)
  entryTermId: integer('entryTermId').references(() => financial_terms.id), // نیمسال ورودی مربوطه (۱=مهر، ۲=بهمن، ۳=تابستان)
  effectiveFrom: varchar('effectiveFrom', { length: 10 }),              // تاریخ مصوبه (شمسی)
  effectiveTo: varchar('effectiveTo', { length: 10 }),
  totalRequiredUnits: numeric('totalRequiredUnits', { precision: 5, scale: 1 }).notNull().default('0'),
  maxUnitsPerTerm: integer('maxUnitsPerTerm'),                          // override سقف واحد ترم (NULL = از degree_level_configs)
  minRoleUnits: text('minRoleUnits'),                                  // سهم واحد هر نقش، JSON مثل {"GENERAL":22,"CORE":25} (NULL = تعیین‌نشده)
  // آخرین رویداد تأیید (append-only). به‌دلیل ارجاع دوریِ (versions ↔ approvals)
  // در Drizzle عمداً بدون .references تعریف شده؛ FK واقعی در مهاجرت 0002 است.
  approvalId: integer('approvalId'),
  createdByStaffId: integer('createdByStaffId').references(() => staff.id),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow()
}, (t) => ({
  statusCheck: check('curriculum_versions_status_check', sql`${t.status} in ('DRAFT','REVIEW','APPROVED','PUBLISHED','ARCHIVED')`),
}));

/** دروسِ هر نسخهٔ برنامه (ارتقای syllabus_courses) */
export const curriculum_courses = pgTable('curriculum_courses', {
  id: serial('id').primaryKey(),
  curriculumVersionId: integer('curriculumVersionId').notNull().references(() => curriculum_versions.id),
  courseId: integer('courseId').notNull().references(() => courses.id),
  roleType: varchar('roleType', { length: 20 }).notNull().default('CORE'), // CORE|MAJOR|ELECTIVE|GENERAL|THESIS|INTERNSHIP|WORKSHOP
  units: numeric('units', { precision: 3, scale: 1 }),                   // NULL = همان courses.units
  theoryUnits: numeric('theoryUnits', { precision: 3, scale: 1 }),
  practicalUnits: numeric('practicalUnits', { precision: 3, scale: 1 }),
  isRequired: integer('isRequired').default(1),
  isElective: integer('isElective').default(0),
  isGraduationRequired: integer('isGraduationRequired').default(0),     // شرط الزامی فارغ‌التحصیلی
  recommendedSemester: integer('recommendedSemester'),                   // ۱..۸ + ۹=تابستان (NULL = آزاد/نامشخص)
  minGrade: numeric('minGrade', { precision: 4, scale: 2 }),             // کف قبولیِ خاص این درس در این نسخه
  /**
   * کد وضع نمرهٔ سما (از میز تطبیق GRADE_STATUS) که باید هنگام قبولی/مردودیِ
   * دانشجو در همین تخصیص درس ثبت شود — چون وضع نهایی به خودِ تعریف درس در
   * این کاتالوگ بستگی دارد، نه یک قاعدهٔ سراسری: مثلاً همین درس در یک کاتالوگ
   * می‌تواند «درس عادی - قبول» (کد ۱) باشد و در کاتالوگ دیگر (وقتی به‌عنوان
   * درس جبرانی/کمبود ارائه می‌شود) «جبرانی بدون احتساب در معدل - قبول»
   * (کد ۱۲)، با حد نصاب قبولی متفاوت (minGrade بالا). NULL = پیش‌فرض سیستم
   * (کد ۱ برای قبولی، کد ۲ برای مردودی).
   */
  passGradeStatusCode: varchar('passGradeStatusCode', { length: 10 }),
  failGradeStatusCode: varchar('failGradeStatusCode', { length: 10 }),
  autoCorequisiteAllowed: integer('autoCorequisiteAllowed').default(0),   // «هم‌نیاز خودکار ترم آخر» (آیین‌نامه)
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({
  uqCourse: unique('uq_curriculum_courses_version_course').on(t.curriculumVersionId, t.courseId),
  semIdx: index('curriculum_courses_semester_idx').on(t.curriculumVersionId, t.recommendedSemester),
  roleCheck: check('curriculum_courses_role_check', sql`${t.roleType} in ('CORE','MAJOR','SPECIALIZED','ELECTIVE','GENERAL','THESIS','INTERNSHIP','WORKSHOP','COMPENSATORY')`),
}));

/**
 * تخصیص صریحِ «درس ترم بالاتر» توسط مدیر گروه.
 *
 * قانون چارت در انتخاب واحد: دانشجو درسِ ترم جاری و ترم‌های پایین‌ترِ خودش را
 * می‌بیند؛ درسِ ترم‌های بالاتر فقط با تخصیصِ این جدول نمایان می‌شود (مثلاً
 * دانشجوی ترم ۵ که برای جبرانی باید درس ترم ۶ را بگیرد). درس حتماً باید عضو
 * چارتِ همان دانشجو باشد — تخصیص نمی‌تواند درسی از خارج چارت باز کند.
 */
export const student_course_grants = pgTable('student_course_grants', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id, { onDelete: 'cascade' }),
  courseId: integer('courseId').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  curriculumVersionId: integer('curriculumVersionId').references(() => curriculum_versions.id, { onDelete: 'set null' }),
  /** شمارهٔ ترمِ پیشنهادیِ همین درس در چارت (برای نمایش «چرا بالاتر است») */
  termOrdinal: integer('termOrdinal'),
  reason: text('reason'),
  grantedByStaffId: integer('grantedByStaffId').references(() => staff.id, { onDelete: 'set null' }),
  grantedByUserId: integer('grantedByUserId').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow(),
}, (t) => ({
  uqStudentCourse: unique('uq_student_course_grants_student_course').on(t.studentId, t.courseId),
  studentIdx: index('idx_scg_student').on(t.studentId),
  courseIdx: index('idx_scg_course').on(t.courseId),
}));

/**
 * چرخهٔ تأیید نسخهٔ برنامه — جدول append-only؛ هر گذارِ وضعیت دقیقاً یک ردیف.
 * (Audit دانشگاه: چه‌کسی، چه زمانی، از چه وضعیتی به کدام — با امضای الکترونیک اختیاری)
 */
export const curriculum_approvals = pgTable('curriculum_approvals', {
  id: serial('id').primaryKey(),
  curriculumVersionId: integer('curriculumVersionId').notNull().references(() => curriculum_versions.id),
  approvalType: varchar('approvalType', { length: 20 }).notNull(), // DRAFT_SUBMIT|HEAD_APPROVE|COUNCIL_APPROVE|REJECT|PUBLISH|ARCHIVE|CREATE_REVISION
  fromStatus: varchar('fromStatus', { length: 20 }),
  toStatus: varchar('toStatus', { length: 20 }).notNull(),          // CHECK در مهاجرت با مقادیر وضعیت
  approvedByStaffId: integer('approvedByStaffId').notNull().references(() => staff.id),
  approvedByUserId: integer('approvedByUserId').notNull().references(() => users.id),
  decisionNote: text('decisionNote'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  approvedAt: timestamp('approvedAt').defaultNow(),
  signatureDocumentId: integer('signatureDocumentId').references(() => electronic_documents.id)
}, (t) => ({
  versionIdx: index('curriculum_approvals_version_idx').on(t.curriculumVersionId, t.approvedAt),
}));

export const course_rules = pgTable('course_rules', {
  id: serial('id').primaryKey(),
  courseId: integer('courseId').notNull().references(() => courses.id),
  syllabusId: integer('syllabusId').references(() => curriculum_versions.id), // نام ستون حفظ شده (تصمیم D2) — مقیّدسازی قاعده به نسخهٔ برنامه
  ruleType: varchar('ruleType', { length: 20 }).notNull(), // PREREQ | COREQ | UNIT_BOUNDARY | EQUIV_OVERRIDE
  logicTree: text('logicTree').notNull(),
  customPassingGrade: numeric('customPassingGrade', { precision: 4, scale: 2 }),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const academic_terms = pgTable('academic_terms', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  termCode: varchar('termCode', { length: 10 }).notNull(),
  standardCode: varchar('standardCode', { length: 50 }),    // کد استاندارد وزارت علوم
  ministryCode: varchar('ministryCode', { length: 50 }),    // کد وزارت علوم
  title: varchar('title', { length: 100 }).notNull(),
  termType: varchar('termType', { length: 20 }).notNull().default('NORMAL'), // NORMAL | SUMMER | EQUIVALENCE | SPECIAL
  sortOrder: integer('sortOrder'), // رتبه ترتیبی زمانی دقیق (مثلاً ۱۴۰۱۵ قبل از ۱۴۰۲۱)
  academicYear: integer('academicYear'), // سال تحصیلی پایه (مثلاً ۱۴۰۱)
  isCurrent: integer('isCurrent').default(0),
  isSummer: integer('isSummer').default(0),
  isEnrollmentOpen: integer('isEnrollmentOpen').default(0),
  enrollmentStartDate: timestamp('enrollmentStartDate'),
  enrollmentEndDate: timestamp('enrollmentEndDate'),
  addDropStartDate: timestamp('addDropStartDate'), // شروع حذف و اضافه
  addDropEndDate: timestamp('addDropEndDate'),     // پایان حذف و اضافه
  startDate: timestamp('startDate'),
  endDate: timestamp('endDate'),
  // ── بازهٔ آموزشی (شروع/پایان کلاس‌ها) — جدا از شروع/پایان ترم ──
  // ثبت‌نام و شروع ترم ممکن است از تاریخی زودتر آغاز شود؛ کلاس‌ها از
  // classStartDate شروع و تا classEndDate ادامه می‌یابند. تولید جلسات
  // (class_sessions) بر پایهٔ همین بازه است (با fallback به startDate/endDate).
  classStartDate: timestamp('classStartDate'),
  classEndDate: timestamp('classEndDate'),
  gradeEntryDeadline: timestamp('gradeEntryDeadline'),
  // ── زمان‌بندی نیمسال از فایل سما (zamanbandi) ──
  singleDropStartDate: timestamp('singleDropStartDate'), // حذف تک‌درس از
  singleDropEndDate: timestamp('singleDropEndDate'),     // حذف تک‌درس تا
  examStartDate: timestamp('examStartDate'),             // امتحانات از
  examEndDate: timestamp('examEndDate'),                 // امتحانات تا
  preRegStartDate: timestamp('preRegStartDate'),         // تاریخ پیش (پیش‌ثبت‌نام) از
  preRegEndDate: timestamp('preRegEndDate'),             // تاریخ پیش (پیش‌ثبت‌نام) تا
  guestRegStartDate: timestamp('guestRegStartDate'),     // ثبت‌نام میهمانی (تابستان) از
  guestRegEndDate: timestamp('guestRegEndDate'),         // ثبت‌نام میهمانی (تابستان) تا
  appealWindowDays: integer('appealWindowDays').default(3),
  professorAppealSlaDays: integer('professorAppealSlaDays').default(5),
  // ── مهاجرت 0085: نسخه آیین‌نامه + تعداد هفته‌های آموزشی (NULL = آخرین نسخه / ۱۶) ──
  regulationVersionId: integer('regulationVersionId'),
  weeksCount: integer('weeksCount'),
  // ── درخواست اخذ درس بدون رعایت پیش‌نیاز/تداخل امتحانی (مهاجرت ۰۱۰۹) ──
  /** مهلت مدیر گروه برای تصمیم‌گیری (ساعت) — پیش‌فرض ۴۸ */
  bypassManagerHours: integer('bypassManagerHours').default(48),
  /** مهلت کارشناس آموزش رشته پس از ارجاع (ساعت) — پیش‌فرض ۱۲ */
  bypassExpertHours: integer('bypassExpertHours').default(12),
  /** چند ساعت مانده به پایان مهلت، یادآوری ارسال شود — پیش‌فرض ۱۰ */
  bypassReminderHours: integer('bypassReminderHours').default(10),
}, (t) => [
  unique('uq_terms_uni_code').on(t.universityId, t.termCode),
]);

/**
 * نیمسال‌های مالی — مجزا از ترم‌های تحصیلی برای تطبیق با سیستم‌های سنتی (سما).
 * کد ۵ رقمی (مثل ۱۴۰۱۱، ۱۴۰۲۱)، تاریخچه مضامین و اتصال به ترم تحصیلی مرجع.
 */
export const financial_terms = pgTable('financial_terms', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').notNull().references((): AnyPgColumn => universities.id),
  termCode: varchar('termCode', { length: 10 }).notNull(), // ۵ رقمی: ۱۴۰۱۱، ۱۴۰۲۱...
  title: varchar('title', { length: 100 }).notNull(),
  academicTermId: integer('academicTermId').references(() => academic_terms.id), // ترم تحصیلی مرجع
  startDate: timestamp('startDate').notNull(),
  endDate: timestamp('endDate').notNull(),
  isActive: integer('isActive').notNull().default(1),
  isCurrent: integer('isCurrent').default(0),
  sortOrder: integer('sortOrder'),
  note: text('note'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (t) => [
  unique('uq_fin_terms_uni_code').on(t.universityId, t.termCode),
  index('idx_fin_terms_academic').on(t.academicTermId),
]);

export const classrooms = pgTable('classrooms', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  // ── کد کلاس (اختیاری) — همراهِ نام، کلاس را برای تفکیکِ کلاس‌های هم‌نام مشخص می‌کند (درخواست کاربر) ──
  code: varchar('code', { length: 30 }),
  capacity: integer('capacity').notNull(),
  roomType: varchar('roomType', { length: 30 }),
  buildingName: varchar('buildingName', { length: 100 }),
  // ── طبقه (Floor) — نمایش در پوستر سردر کلاسی (درخواست کاربر R-AA) ──
  floor: varchar('floor', { length: 20 }),
  rowsCount: integer('rowsCount'),
  colsCount: integer('colsCount'),
  // ── متعلق به کدام دانشکده است (زونینگ در برنامه‌ریزی درسی) ──
  facultyId: integer('facultyId').references(() => faculties.id),
  /**
   * گروهِ مسئولِ این اتاق (مهاجرت ۰۱۱۴) — ادغامِ تخصیص اتاق با تخصیصِ کلاس به
   * مدیرگروه. مدیرگروه از `departments.headStaffId` همان گروه خوانده می‌شود.
   * NULL = تخصیص صریح نشده؛ مسئولیت مثل قبل از سانس‌های اتاق استنتاج می‌شود.
   */
  departmentId: integer('departmentId').references(() => departments.id),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  // ── وضعیت فعال بودن کلاس — فقط کلاس‌های فعال در انتخاب‌گر سردر نمایش داده می‌شوند (R-AA) ──
  isActive: integer('isActive').notNull().default(1),
});

export const course_offerings = pgTable('course_offerings', {
  id: serial('id').primaryKey(),
  termId: integer('termId').notNull().references(() => academic_terms.id),
  courseId: integer('courseId').notNull().references(() => courses.id),
  professorId: integer('professorId').references(() => staff.id),
  groupNumber: integer('groupNumber').notNull().default(1),
  capacity: integer('capacity').notNull(),
  waitlistCapacity: integer('waitlistCapacity').default(0),
  enrolledCount: integer('enrolledCount').notNull().default(0),
  genderRestriction: varchar('genderRestriction', { length: 10 }),
  sharedScheduleGroupKey: varchar('sharedScheduleGroupKey', { length: 50 }),
  offeringType: varchar('offeringType', { length: 30 }).notNull().default('NORMAL'),
  customGradeDeadline: timestamp('customGradeDeadline'),
  isActive: integer('isActive').notNull().default(1),
  gradesHash: text('gradesHash'),
  gradesTemporaryAt: timestamp('gradesTemporaryAt'),
  gradesFinalizedAt: timestamp('gradesFinalizedAt'),
  targetDegreeLevelId: integer('targetDegreeLevelId'),   // مقطع هدف (NULL = همهٔ مقاطع)
  targetMajorId: integer('targetMajorId'),               // رشتهٔ هدف (NULL = همهٔ رشته‌ها)
  entryYearStart: integer('entryYearStart'),             // بازهٔ ورودی (NULL = بدون محدودیت)
  entryYearEnd: integer('entryYearEnd'),
  // ── فاز تأمین/تخصیص درس‌های مشترک (موتور برنامه‌ریزی درسی) ──
  ownerDepartmentId: integer('ownerDepartmentId').references(() => departments.id), // گروه سازندهٔ کلاس
  isSharedService: integer('isSharedService').default(0),                            // 1 = استخر خدمات عمومی (فاز تأمین)
  equivalenceClusterId: integer('equivalenceClusterId').references(() => equivalence_clusters.id), // استخر ظرفیت مشترک
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  /** کارشناس آموزشِ «اصلیِ» همین کلاس — اولین نفرِ فهرستِ چندکارشناسه.
   *  NULL = تخصیص در سطح کلاس نشده؛ آن‌وقت از expert_scopes (نقش‌ها) پایین‌می‌آید.
   *  فهرستِ کامل در جدولِ واسطِ `course_offering_edu_experts` است (مهاجرت 0111)؛
   *  این ستون فقط برای مصرف‌کننده‌های تک‌مقداری و گزارش‌های قدیمی نگه داشته شده. */
  eduExpertUserId: integer('eduExpertUserId').references((): AnyPgColumn => users.id),
}, (t) => ({
  // H1: حداکثر یک ارائهٔ «فعال» برای هر (ترم+درس+گروه) — ارائهٔ غیرفعال‌شده
  // تاریخچه است و مانع ساخت ارائهٔ جدید نمی‌شود (مهاجرت 0103).
  uqTermCourseGroup: uniqueIndex('uq_course_offerings_term_course_group')
    .on(t.termId, t.courseId, t.groupNumber)
    .where(sql`"isActive" = 1`),
}));

/** ────────────────────────────────────────────────────────────────────────
 *  کارشناسان آموزشِ یک ارائه — رابطهٔ چند‌به‌چند (مهاجرت 0111).
 *
 *  چرا جدولِ واسط و نه ستونِ آرایه: یک کلاس می‌تواند بین دو یا چند کارشناس
 *  مشترک باشد (درسِ مشترکِ دو گروه، تقسیمِ کارِ کارشناسِ آموزش و دانشکده).
 *  با جدولِ واسط، «کلاس‌های یک کارشناس» یک ایندکس ساده است و حذفِ کاربر
 *  خودکار (ON DELETE CASCADE) پاک می‌شود.
 *  ──────────────────────────────────────────────────────────────────────── */
export const course_offering_edu_experts = pgTable('course_offering_edu_experts', {
  id: serial('id').primaryKey(),
  offeringId: integer('offeringId').notNull().references(() => course_offerings.id, { onDelete: 'cascade' }),
  userId: integer('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
}, (t) => ({
  uqOfferingUser: uniqueIndex('uq_co_edu_experts_offering_user').on(t.offeringId, t.userId),
  idxUser: index('idx_co_edu_experts_user').on(t.userId),
}));

/** ────────────────────────────────────────────────────────────────────────
 *  کارشناسان آموزشِ یک اتاق (کلاس فیزیکی) — مهاجرت ۰۱۱۲.
 *
 *  چرا اتاق و نه ارائه: کارشناس آموزش مسئولِ یک فضاست و ساعت‌به‌ساعت همان
 *  اتاق را می‌گردد؛ در ترمِ ۱۱۱، ۱۳۴۵ ارائه در ۴۹ اتاق برگزار می‌شوند. پس
 *  تخصیص در سطحِ اتاق ۲۷ برابر کم‌کارتر است و با تغییرِ برنامه خودکار
 *  به‌روز می‌ماند. تخصیصِ سطحِ درس (`course_offering_edu_experts`) به‌عنوان
 *  «استثنا» بالاتر از این می‌نشیند.
 *  ──────────────────────────────────────────────────────────────────────── */
export const classroom_edu_experts = pgTable('classroom_edu_experts', {
  id: serial('id').primaryKey(),
  classroomId: integer('classroomId').notNull().references(() => classrooms.id, { onDelete: 'cascade' }),
  userId: integer('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
}, (t) => ({
  uqRoomUser: uniqueIndex('uq_classroom_edu_experts_room_user').on(t.classroomId, t.userId),
  idxUser: index('idx_classroom_edu_experts_user').on(t.userId),
}));

/** ────────────────────────────────────────────────────────────────────────
 *  معادل‌سازی درس بین دو دانشگاه (کارنامهٔ فارغ‌التحصیلان دانشگاه مبدأ)
 *  جهت A→B است: A مبدأ (معمولاً AFAGH)، B مقصد (دانشگاه محلی).
 *  `decidedAt === NULL` یعنی پیشنهادِ ماشینی و در انتظار تأیید آدم.
 *  `rejected = 1` یعنی آدم صریحاً «نه» گفته — آن تصمیم هم ماندگار است تا
 *  ابزار هرگز دوباره همان پیشنهاد را نکند.
 *  ──────────────────────────────────────────────────────────────────────── */
export const course_equivalences = pgTable('course_equivalences', {
  id: serial('id').primaryKey(),
  universityIdA: integer('universityIdA').notNull().references(() => universities.id),
  courseIdA: integer('courseIdA').notNull().references(() => courses.id),
  universityIdB: integer('universityIdB').notNull().references(() => universities.id),
  courseIdB: integer('courseIdB').notNull().references(() => courses.id),
  /** CODE_EXACT | TITLE_EXACT | TITLE_WORD_CONTAINMENT | TITLE_FUZZY | MANUAL */
  matchMethod: varchar('matchMethod', { length: 30 }).notNull(),
  matchScore: numeric('matchScore', { precision: 5, scale: 4 }),
  confidence: numeric('confidence', { precision: 4, scale: 3 }),
  decidedBy: integer('decidedBy').references(() => users.id),
  decidedAt: timestamp('decidedAt', { withTimezone: true }),
  rejected: integer('rejected').notNull().default(0),
  decidedReason: varchar('decidedReason', { length: 200 }),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pair: unique('uq_course_equivalences_pair').on(t.universityIdA, t.courseIdA, t.universityIdB, t.courseIdB),
  idxB: index('idx_course_equivalences_b').on(t.universityIdB, t.courseIdB),
  idxPending: index('idx_course_equivalences_pending').on(t.universityIdA, t.courseIdA),
}));

export const offering_professors = pgTable('offering_professors', {
  id: serial('id').primaryKey(),
  offeringId: integer('offeringId').notNull().references(() => course_offerings.id),
  staffId: integer('staffId').notNull().references(() => staff.id),
  role: varchar('role', { length: 50 }).notNull().default('MAIN_LECTURER'),
  sharePercentage: numeric('sharePercentage', { precision: 5, scale: 2 }).default('100.00'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  /** تاریخ معرفی درس به استاد — برای تشخیص «درس دیرمعرفی‌شده» در بازهٔ ثبت نمره (ردیف‌های قدیمی NULL) */
  assignedAt: timestamp('assignedAt').defaultNow(),
});

/**
 * درخواست بازگشایی نمرات نهایی‌شده توسط استاد — تأیید ادمین/کارشناس.
 * چرخه: استاد (finalized، اشتباه) → درخواست PENDING با دلیل → بررسی‌کننده
 * APPROVED (بازگشایی به TEMPORARY + لاگ UNFINALIZE) یا REJECTED با توضیح.
 */
export const grade_unfinalize_requests = pgTable('grade_unfinalize_requests', {
  id: serial('id').primaryKey(),
  offeringId: integer('offeringId').notNull().references(() => course_offerings.id),
  requestedByUserId: integer('requestedByUserId').notNull().references(() => users.id),
  reason: text('reason').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'), // PENDING|REVIEWED|APPROVED|REJECTED
  reviewedByUserId: integer('reviewedByUserId').references(() => users.id),
  reviewNote: text('reviewNote'),
  createdAt: timestamp('createdAt').defaultNow(),
  reviewedAt: timestamp('reviewedAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({
  offeringIdx: index('idx_unfinalize_offering').on(t.offeringId),
  statusIdx: index('idx_unfinalize_status').on(t.status),
}));

export const schedules = pgTable('schedules', {
  id: serial('id').primaryKey(),
  offeringId: integer('offeringId').notNull().references(() => course_offerings.id),
  scheduleType: varchar('scheduleType', { length: 20 }).notNull(),
  dayOfWeek: integer('dayOfWeek'),
  examDate: date('examDate'),
  startTime: time('startTime').notNull(),
  endTime: time('endTime').notNull(),
  roomId: integer('roomId').references(() => classrooms.id),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const professor_availabilities = pgTable('professor_availabilities', {
  id: serial('id').primaryKey(),
  staffId: integer('staffId').notNull().references(() => staff.id),
  termId: integer('termId').references(() => academic_terms.id),
  dayOfWeek: integer('dayOfWeek'),
  startTime: time('startTime'),
  endTime: time('endTime'),
  /** وضعیت پنل استاد: PREF (اولویت) / AVAIL (قابل حضور) — UNAVAIL یعنی ردیف ذخیره نمی‌شود */
  status: varchar('status', { length: 10 }).default('AVAIL'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ═══════════════════════════════════════════════════════════════════════
// موتور برنامه‌ریزی درسی — تکهٔ دیتابیس (فاز تأمین/تخصیص، سهمیه و استخر شناور)
// ═══════════════════════════════════════════════════════════════════════

/** فازهای برنامه‌ریزی ترم: تأمین ← تخصیص ← بازبینی کارشناس ← منتشرشده */
export const term_scheduling_states = pgTable('term_scheduling_states', {
  id: serial('id').primaryKey(),
  termId: integer('termId').notNull().unique().references(() => academic_terms.id),
  phase: varchar('phase', { length: 20 }).notNull().default('SUPPLY'),
  supplyEndsAt: timestamp('supplyEndsAt'),
  allocationEndsAt: timestamp('allocationEndsAt'),
  reviewEndsAt: timestamp('reviewEndsAt'),
  publishedAt: timestamp('publishedAt'),
  publishedByStaffId: integer('publishedByStaffId').references(() => staff.id),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

/**
 * سهمیهٔ کلاس فیزیکی به تفکیک شیفت (صبح/عصر).
 * هر (سالن، شیفت) در هر ترم یک مالک دارد؛ با آزادسازی → استخر مشترک دانشکده.
 */
export const scheduling_room_grants = pgTable('scheduling_room_grants', {
  id: serial('id').primaryKey(),
  termId: integer('termId').notNull().references(() => academic_terms.id),
  classroomId: integer('classroomId').notNull().references(() => classrooms.id),
  shift: varchar('shift', { length: 10 }).notNull(), // MORNING | EVENING
  ownerDepartmentId: integer('ownerDepartmentId').notNull().references(() => departments.id),
  status: varchar('status', { length: 10 }).notNull().default('ALLOCATED'), // ALLOCATED | RELEASED
  releasedAt: timestamp('releasedAt'),
  releasedByStaffId: integer('releasedByStaffId').references(() => staff.id),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({ roomShiftUniq: unique('uq_scheduling_room_shift').on(t.termId, t.classroomId, t.shift) }));

/** اتصال «کلاس ساخته‌شده در فاز تأمین» به گروه‌های متقاضی در فاز تخصیص */
export const scheduling_allocations = pgTable('scheduling_allocations', {
  id: serial('id').primaryKey(),
  termId: integer('termId').notNull().references(() => academic_terms.id),
  offeringId: integer('offeringId').notNull().references(() => course_offerings.id),
  departmentId: integer('departmentId').notNull().references(() => departments.id),
  allocatedByStaffId: integer('allocatedByStaffId').references(() => staff.id),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow()
}, (t) => ({
  offerDeptUniq: unique('uq_scheduling_allocation').on(t.offeringId, t.departmentId),
  deptIdx: index('scheduling_allocations_dept_idx').on(t.termId, t.departmentId),
}));

export const cart_items = pgTable('cart_items', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  offeringId: integer('offeringId').notNull().references(() => course_offerings.id),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  UNIQUE: text('UNIQUE')
});

export const enrollments = pgTable('enrollments', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  offeringId: integer('offeringId').notNull().references(() => course_offerings.id),
  status: varchar('status', { length: 30 }).notNull().default('REGISTERED'),
  waitlistPosition: integer('waitlistPosition'),
  workflowRequestId: integer('workflowRequestId'),
  hasEvaluated: integer('hasEvaluated').notNull().default(0),
  gradeValue: numeric('gradeValue', { precision: 4, scale: 2 }),
  gradeStatus: varchar('gradeStatus', { length: 20 }).notNull().default('PENDING'),
  isDirectedReading: integer('isDirectedReading').default(0),
  registeredAt: timestamp('registeredAt').defaultNow(),
  absenceMarkedAt: timestamp('absenceMarkedAt'),
  /** کد وضعیت نمرهٔ سما هنگام نهایی‌سازی (از curriculum_courses.passGradeStatusCode / failGradeStatusCode) */
  samaGradeStatusCode: varchar('samaGradeStatusCode', { length: 10 }),
  /** کد اصلی اولیه سما (هنگام واردات داده) — برای مقایسه بعدی با موتور آیین‌نامه حفظ می‌شود */
  originalSamaCode: varchar('originalSamaCode', { length: 10 }),
  // ── ثبت‌نام توسط کارشناس آموزش (به‌جای دانشجو) + ردگیری ──
  // کی زده، آیا قیود آیین‌نامه (پیش‌نیاز/ظرفیت/سقف واحد) نادیده گرفته شد و چرا
  enrolledByUserId: integer('enrolledByUserId').references(() => users.id),
  enrollOverrideReason: text('enrollOverrideReason'),
  enrollOverride: integer('enrollOverride').notNull().default(0),
  /** ثبت بر اساس حکم شورا/کمیسیون (تداخل هفتگی/امتحانی) — متن حکم در enrollOverrideReason */
  councilRuling: integer('councilRuling').notNull().default(0),
  /** کدهای اخطار نادیده‌گرفته‌شده هنگام صدور مجوز (JSON array) — مشروطی/سنوات/مالی/… */
  overriddenRules: text('overriddenRules'),
  /** تأییدیهٔ دیجیتال دانشجو برای داشتن دو امتحان هم‌روز (شیفت‌های متفاوت) — فاز ۱۰ */
  hasAcceptedSameDayExam: integer('hasAcceptedSameDayExam').notNull().default(0),
  /** حذف اضطراری (پس از مهلت حذف و اضافه) — سند §۲۲۴۳ */
  emergencyWithdrawal: integer('emergencyWithdrawal').notNull().default(0),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  /** دانشگاهی که این نمره در آن گرفته شده — برای نمراتِ منتقل‌شده از دانشگاه مبدأ. NULL = همین دانشگاه. */
  sourceUniversityId: integer('sourceUniversityId').references((): AnyPgColumn => universities.id),
  /** ردیف enrollments مبدأ — کلید idempotency: هر نمرهٔ خارجی فقط یک‌بار قابل اعمال است. */
  sourceEnrollmentId: integer('sourceEnrollmentId').references((): AnyPgColumn => enrollments.id),
}, (t) => ({ uq: unique('uq_enrollments').on(t.studentId, t.offeringId) }));

/**
 * درخواست اخذ درس بدون رعایت پیش‌نیاز یا با تداخل امتحانی.
 *
 * گردش کار: PENDING_MANAGER → (مهلت مدیر) ESCALATED_EXPERT → (مهلت کارشناس) AUTO_REJECTED
 * مدیر گروه و کارشناس هر کدام زودتر تصمیم بگیرند پرونده بسته می‌شود؛ معاون آموزش
 * می‌تواند تصمیم را بازبینی کند (تأیید/رد/بازگرداندن).
 *
 * صندلی: هنگام ثبت درخواست `course_offerings.enrolledCount` یک واحد افزایش می‌یابد
 * (رزرو). تأیید = تبدیل همان رزرو به ثبت‌نام قطعی (بدون افزایش دوباره)؛
 * رد/انقضا = آزادسازی صندلی.
 */
export const enroll_bypass_requests = pgTable('enroll_bypass_requests', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id, { onDelete: 'cascade' }),
  offeringId: integer('offeringId').notNull().references(() => course_offerings.id, { onDelete: 'cascade' }),
  termId: integer('termId').notNull().references(() => academic_terms.id, { onDelete: 'cascade' }),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  /** PREREQ | EXAM_CONFLICT */
  kind: varchar('kind', { length: 20 }).notNull(),
  /** PENDING_MANAGER | ESCALATED_EXPERT | APPROVED | REJECTED | AUTO_REJECTED | CANCELLED */
  status: varchar('status', { length: 30 }).notNull().default('PENDING_MANAGER'),
  /** کد دلیل رد: LOW_GPA_PREV_TERM | GROUP_COUNCIL_DISAGREE | UNRESOLVABLE_EXAM_CONFLICT | OTHER | NO_RESPONSE */
  reasonCode: varchar('reasonCode', { length: 40 }),
  reasonText: text('reasonText'),
  /** MANAGER | EXPERT | VICE | SYSTEM */
  decidedRole: varchar('decidedRole', { length: 20 }),
  decidedByUserId: integer('decidedByUserId').references(() => users.id),
  decidedAt: timestamp('decidedAt'),
  managerDeadlineAt: timestamp('managerDeadlineAt').notNull(),
  expertDeadlineAt: timestamp('expertDeadlineAt'),
  escalatedAt: timestamp('escalatedAt'),
  managerReminderAt: timestamp('managerReminderAt'),
  expertReminderAt: timestamp('expertReminderAt'),
  studentWarnedAt: timestamp('studentWarnedAt'),
  /** ۱ = صندلی این درخواست رزرو شده است */
  seatReserved: integer('seatReserved').notNull().default(1),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (t) => [
  index('idx_bypass_student').on(t.studentId),
  index('idx_bypass_offering_status').on(t.offeringId, t.status),
  index('idx_bypass_status_deadline').on(t.status, t.managerDeadlineAt),
  index('idx_bypass_term').on(t.termId),
]);

/**
 * ثبتِ «بررسی/پذیرش» تداخل‌های واقعی برنامهٔ هفتگی (مهاجرت ۰۱۱۶).
 *
 * چرا جدول جدا؟ شمارشِ خامِ هم‌پوشانیِ اسلات‌ها در ۱۴۰۵۱ معادل ۷۱۶ مورد بود
 * ولی تداخلِ واقعی فقط ۶۹ تا — بقیه «کلاس ادغامی» بودند که قاعده‌اش در
 * `src/lib/professor-calendar-layout.ts` است. کارشناس آموزش باید بتواند
 * باقی‌مانده را یکی‌یکی بررسی و **پذیرش** کند تا هفتهٔ بعد دوباره به‌عنوان
 * خطای تازه بالا نیایند. اینجا فقط وضعیتِ بررسی ذخیره می‌شود؛ رفعِ واقعی
 * یا اصلاحِ `schedules` است یا تعیینِ `course_offerings.sharedScheduleGroupKey`.
 */
export const schedule_conflict_reviews = pgTable('schedule_conflict_reviews', {
  id: serial('id').primaryKey(),
  termId: integer('termId').notNull().references(() => academic_terms.id, { onDelete: 'cascade' }),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  /** PROFESSOR | ROOM */
  kind: varchar('kind', { length: 20 }).notNull(),
  /** staff.id برای PROFESSOR، classrooms.id برای ROOM */
  entityId: integer('entityId').notNull(),
  dayOfWeek: integer('dayOfWeek').notNull(),
  scheduleAId: integer('scheduleAId').notNull().references(() => schedules.id, { onDelete: 'cascade' }),
  scheduleBId: integer('scheduleBId').notNull().references(() => schedules.id, { onDelete: 'cascade' }),
  /** اثرانگشتِ پایدار: kind:entityId:day:min(scheduleId):max(scheduleId) */
  fingerprint: varchar('fingerprint', { length: 120 }).notNull(),
  /** REVIEWED (بررسی و پذیرفته شد) | RESOLVED (رفعِ واقعی ثبت شد) */
  status: varchar('status', { length: 20 }).notNull().default('REVIEWED'),
  /** کد دلیل: MERGED_OK | PROF_OK | ROOM_OK | WILL_FIX | OTHER */
  reasonCode: varchar('reasonCode', { length: 40 }),
  reasonText: text('reasonText'),
  reviewedByUserId: integer('reviewedByUserId').references(() => users.id),
  reviewedAt: timestamp('reviewedAt').defaultNow(),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (t) => [
  index('idx_sconflict_term').on(t.termId),
  index('idx_sconflict_entity').on(t.kind, t.entityId),
  uniqueIndex('uq_sconflict_term_fp').on(t.termId, t.fingerprint),
]);

export const grade_appeals = pgTable('grade_appeals', {
  id: serial('id').primaryKey(),
  enrollmentId: integer('enrollmentId').notNull().references(() => enrollments.id),
  studentMessage: text('studentMessage').notNull(),
  professorReply: text('professorReply'),
  oldGrade: numeric('oldGrade', { precision: 4, scale: 2 }),
  newGrade: numeric('newGrade', { precision: 4, scale: 2 }),
  status: varchar('status', { length: 20 }).default('OPEN'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow()
});

/** تاریخچهٔ تغییرات نمره — هر تغییر یک ردیف (append-only audit trail) */
export const grade_change_log = pgTable('grade_change_log', {
  id: serial('id').primaryKey(),
  enrollmentId: integer('enrollmentId').notNull().references(() => enrollments.id),
  studentId: integer('studentId').notNull().references(() => students.id),
  offeringId: integer('offeringId').notNull().references(() => course_offerings.id),
  action: varchar('action', { length: 30 }).notNull(),  // DRAFT|TEMPORARY|FINALIZED|APPEAL|ADMIN_OVERRIDE
  oldGradeValue: varchar('oldGradeValue', { length: 20 }),
  newGradeValue: varchar('newGradeValue', { length: 20 }),
  oldGradeStatus: varchar('oldGradeStatus', { length: 20 }),
  newGradeStatus: varchar('newGradeStatus', { length: 20 }),
  oldSamaStatusCode: varchar('oldSamaStatusCode', { length: 10 }),
  newSamaStatusCode: varchar('newSamaStatusCode', { length: 10 }),
  reason: text('reason'),
  actorUserId: integer('actorUserId').references(() => users.id),
  actorRole: varchar('actorRole', { length: 30 }),  // PROFESSOR|ADMIN|GRADUATEAFFAIRS
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow(),
}, (t) => ({
  enrollmentIdx: index('idx_grade_change_log_enrollment').on(t.enrollmentId),
  studentIdx: index('idx_grade_change_log_student').on(t.studentId),
  createdIdx: index('idx_grade_change_log_created').on(t.createdAt),
}));

export const grade_submission_otps = pgTable('grade_submission_otps', {
  id: serial('id').primaryKey(),
  staffId: integer('staffId').notNull().references(() => staff.id),
  offeringId: integer('offeringId').notNull().references(() => course_offerings.id),
  otpHash: text('otpHash').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  isUsed: integer('isUsed').default(0),
  attempts: integer('attempts').default(0),
  lockedAt: timestamp('lockedAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow()
});

export const transcript_snapshots = pgTable('transcript_snapshots', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  termId: integer('termId').notNull().references(() => academic_terms.id),
  snapshotJson: text('snapshotJson').notNull(),
  snapshotHash: text('snapshotHash').notNull(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow(),
  UNIQUE: text('UNIQUE')
}, (t) => ({ uq: unique('uq_transcript_snapshots').on(t.studentId, t.termId) }));

export const evaluation_periods = pgTable('evaluation_periods', {
  id: serial('id').primaryKey(),
  termId: integer('termId').references(() => academic_terms.id),
  title: varchar('title', { length: 150 }).notNull(),
  startDate: timestamp('startDate').notNull(),
  endDate: timestamp('endDate').notNull(),
  isActive: integer('isActive').default(0),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const evaluation_forms = pgTable('evaluation_forms', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 150 }).notNull(),
  targetType: varchar('targetType', { length: 50 }),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const evaluation_questions = pgTable('evaluation_questions', {
  id: serial('id').primaryKey(),
  formId: integer('formId').references(() => evaluation_forms.id),
  questionText: text('questionText').notNull(),
  questionType: varchar('questionType', { length: 20 }),
  weight: numeric('weight', { precision: 3, scale: 2 }).default('1.0'),
  orderIndex: integer('orderIndex'),
  axisLabel: varchar('axisLabel', { length: 60 })
});

export const question_options = pgTable('question_options', {
  id: serial('id').primaryKey(),
  questionId: integer('questionId').references(() => evaluation_questions.id),
  optionLabel: varchar('optionLabel', { length: 100 }).notNull(),
  scoreValue: numeric('scoreValue', { precision: 4, scale: 2 })
});

export const form_assignments = pgTable('form_assignments', {
  id: serial('id').primaryKey(),
  formId: integer('formId').notNull().references(() => evaluation_forms.id),
  departmentId: integer('departmentId').references(() => departments.id),
  courseType: varchar('courseType', { length: 50 }),
  practicalOnly: integer('practicalOnly')
});

export const evaluation_responses = pgTable('evaluation_responses', {
  id: serial('id').primaryKey(),
  periodId: integer('periodId').references(() => evaluation_periods.id),
  offeringId: integer('offeringId').references(() => course_offerings.id),
  questionId: integer('questionId').references(() => evaluation_questions.id),
  selectedOptionId: integer('selectedOptionId').references(() => question_options.id),
  textAnswer: text('textAnswer'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const integrations_config = pgTable('integrations_config', {
  id: serial('id').primaryKey(),
  serviceName: varchar('serviceName', { length: 100 }).notNull().unique(),
  baseUrl: varchar('baseUrl', { length: 255 }),
  authType: varchar('authType', { length: 30 }),
  authCredentials: text('authCredentials'),
  timeoutSeconds: integer('timeoutSeconds').default(10),
  isActive: integer('isActive').default(1)
});

export const step_api_actions = pgTable('step_api_actions', {
  id: serial('id').primaryKey(),
  stepId: integer('stepId').notNull().references(() => process_steps.id),
  integrationId: integer('integrationId').notNull().references(() => integrations_config.id),
  endpointPath: varchar('endpointPath', { length: 255 }).notNull(),
  httpMethod: varchar('httpMethod', { length: 10 }).notNull().default('POST'),
  payloadMapping: text('payloadMapping'),
  successCondition: text('successCondition'),
  fallbackAction: varchar('fallbackAction', { length: 50 }).default('MANUAL_REVIEW'),
  circuitBreakerThreshold: integer('circuitBreakerThreshold').default(3)
});

export const api_audit_logs = pgTable('api_audit_logs', {
  id: serial('id').primaryKey(),
  serviceName: varchar('serviceName', { length: 100 }).notNull(),
  requestId: integer('requestId').references(() => student_requests.id),
  stepId: integer('stepId').references(() => process_steps.id),
  requestUrl: varchar('requestUrl', { length: 500 }).notNull(),
  requestPayload: text('requestPayload'),
  responseStatus: integer('responseStatus'),
  responseBody: text('responseBody'),
  durationMs: integer('durationMs'),
  isSuccess: integer('isSuccess').default(1),
  executedAt: timestamp('executedAt').defaultNow()
});

export const process_definitions = pgTable('process_definitions', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  title: varchar('title', { length: 150 }).notNull(),
  category: varchar('category', { length: 50 }).notNull().default('عمومی'),
  description: text('description'),
  formSchema: text('formSchema'), // Dynamic JSON schema of fields
  outputTemplate: varchar('outputTemplate', { length: 50 }),
  feeAmount: integer('feeAmount').default(0),
  isActive: integer('isActive').default(1),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const process_steps = pgTable('process_steps', {
  id: serial('id').primaryKey(),
  processId: integer('processId').notNull().references(() => process_definitions.id),
  stepOrder: integer('stepOrder').notNull(),
  title: varchar('title', { length: 150 }).notNull(),
  stepType: varchar('stepType', { length: 30 }).notNull().default('USER'), // USER, AUTO_INTEGRATION, PARALLEL_GATEWAY
  roleCode: varchar('roleCode', { length: 50 }),
  assigneeStaffId: integer('assigneeStaffId').references(() => staff.id),
  slaHours: integer('slaHours').default(48), // Max duration allowed in hours
  timeoutAction: varchar('timeoutAction', { length: 30 }).default('ESCALATE'), // ESCALATE, AUTO_APPROVE, AUTO_REJECT, NOTIFY
  timeoutEscalateToRole: varchar('timeoutEscalateToRole', { length: 50 }),
  integrationId: integer('integrationId').references(() => integrations_config.id),
  apiConfig: text('apiConfig'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const process_transitions = pgTable('process_transitions', {
  id: serial('id').primaryKey(),
  stepId: integer('stepId').notNull().references(() => process_steps.id),
  action: varchar('action', { length: 30 }).notNull(), // APPROVE, REJECT, RETURN_FOR_REVISION, ESCALATE
  toStepId: integer('toStepId').references(() => process_steps.id),
  isFinal: integer('isFinal').default(0)
});

export const student_requests = pgTable('student_requests', {
  id: serial('id').primaryKey(),
  trackingCode: varchar('trackingCode', { length: 30 }).notNull().unique(),
  studentId: integer('studentId').notNull().references(() => students.id),
  processId: integer('processId').notNull().references(() => process_definitions.id),
  currentStepId: integer('currentStepId').references(() => process_steps.id),
  formData: text('formData'),
  status: varchar('status', { length: 30 }).notNull().default('SUBMITTED'), // DRAFT, SUBMITTED, IN_REVIEW, APPROVED, REJECTED, READY_TO_PRINT, CANCELLED
  autoCreated: integer('autoCreated').default(0),
  relatedEnrollmentId: integer('relatedEnrollmentId').references(() => enrollments.id),
  satisfactionScore: integer('satisfactionScore'), // 1 to 5 CSAT stars
  feedbackText: text('feedbackText'),
  digitalStampHash: varchar('digitalStampHash', { length: 64 }),
  certificateNumber: varchar('certificateNumber', { length: 50 }),
  issuedAt: timestamp('issuedAt'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ── اعتراض به نمره (دانشجو → کارشناس آموزش) ──
// دانشجو در بازهٔ زمانی اعتراض (تنظیم GRADE_OBJECTION_DEADLINE) می‌تواند به
// نمرهٔ یک درسِ قطعی اعتراض کند؛ کارشناس بررسی و نتیجه را ثبت می‌کند.
export const grade_objections = pgTable('grade_objections', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  enrollmentId: integer('enrollmentId').notNull().references(() => enrollments.id),
  termId: integer('termId').references(() => academic_terms.id),
  courseCode: varchar('courseCode', { length: 30 }),
  courseTitle: varchar('courseTitle', { length: 200 }),
  gradeAtObjection: numeric('gradeAtObjection', { precision: 6, scale: 2 }),
  requestText: text('requestText').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'), // PENDING, REVIEWED, ACCEPTED, REJECTED
  reviewerId: integer('reviewerId').references(() => staff.id),
  reviewerNote: text('reviewerNote'),
  resolvedAt: timestamp('resolvedAt'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const request_step_logs = pgTable('request_step_logs', {
  id: serial('id').primaryKey(),
  requestId: integer('requestId').notNull().references(() => student_requests.id),
  stepId: integer('stepId').notNull().references(() => process_steps.id),
  assignedAt: timestamp('assignedAt').defaultNow(),
  firstViewedAt: timestamp('firstViewedAt'),
  completedAt: timestamp('completedAt'),
  actorStaffId: integer('actorStaffId').references(() => staff.id),
  actorRole: varchar('actorRole', { length: 50 }),
  action: varchar('action', { length: 30 }), // APPROVE, REJECT, RETURN_FOR_REVISION, ESCALATE, AUTO_TIMEOUT
  note: text('note'),
  durationMinutes: integer('durationMinutes'),
  slaStatus: varchar('slaStatus', { length: 30 }), // ON_TIME, WARNING, SLA_BREACHED, ESCALATED
  satisfactionScore: integer('satisfactionScore'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const request_parallel_checkpoints = pgTable('request_parallel_checkpoints', {
  id: serial('id').primaryKey(),
  requestId: integer('requestId').notNull().references(() => student_requests.id),
  departmentCode: varchar('departmentCode', { length: 50 }).notNull(), // FINANCE, LIBRARY, WELFARE_FUND, LABORATORY, DORMITORY
  departmentTitle: varchar('departmentTitle', { length: 100 }).notNull(),
  isCleared: integer('isCleared').default(0),
  clearedByStaffId: integer('clearedByStaffId').references(() => staff.id),
  clearedAt: timestamp('clearedAt'),
  notes: text('notes')
});

export const term_financial_rules = pgTable('term_financial_rules', {
  id: serial('id').primaryKey(),
  termId: integer('termId').notNull().references(() => academic_terms.id),
  financialTermId: integer('financialTermId').references(() => financial_terms.id),
  degreeLevelId: integer('degreeLevelId').notNull().references(() => degree_level_configs.id),
  fixedTuition: numeric('fixedTuition', { precision: 12, scale: 0 }).notNull(),
  perUnitTuition: numeric('perUnitTuition', { precision: 12, scale: 0 }).default('0'),
  advancePaymentRequired: numeric('advancePaymentRequired', { precision: 12, scale: 0 }).notNull(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => [
  index('idx_term_fin_rules_fin_term').on(t.financialTermId),
]);

/**
 * قواعد شهریهٔ قابل تنظیم (بدون مقدار سخت‌کد) — موتور شهریه از اینجا می‌خواند.
 *
 * هر قاعده می‌تواند بر اساس سه کلید محدود شود:
 *   - مقطع (degreeLevelId): NULL = همهٔ مقاطع
 *   - نوع ترم (termType):   NORMAL / SUMMER / EQUIVALENCE — NULL = همه
 *   - نوع گذراندن درس (offeringType): NORMAL / TRANSFER / … — NULL = همه
 *
 * شهریهٔ ثابت (fixedTuition) یک‌بار به ازای «نوع ترم» و شهریهٔ متغیر
 * (perUnitTuition) به ازای هر واحد و بر اساس «نوع گذراندن درس» اعمال می‌شود؛
 * بنابراین معادل‌سازی می‌تواند نرخ ثابت و نرخ هر واحد کاملاً جداگانه داشته باشد.
 * هنگام انتخاب، خاص‌ترین قاعدهٔ منطبق (بر اساس تعداد کلیدهای غیرخالی) برنده است.
 */
export const tuition_fee_rules = pgTable('tuition_fee_rules', {
  id: serial('id').primaryKey(),
  degreeLevelId: integer('degreeLevelId').references(() => degree_level_configs.id), // NULL = همهٔ مقاطع
  termType: varchar('termType', { length: 20 }),        // NORMAL | SUMMER | EQUIVALENCE — NULL = همه
  offeringType: varchar('offeringType', { length: 30 }),// NORMAL | TRANSFER | … — NULL = همه
  fixedTuition: numeric('fixedTuition', { precision: 12, scale: 0 }).notNull().default('0'),
  perUnitTuition: numeric('perUnitTuition', { precision: 12, scale: 0 }).notNull().default('0'),
  effectiveFromYear: integer('effectiveFromYear'),      // NULL = بدون محدودیت ورودی
  isActive: integer('isActive').notNull().default(1),
  note: text('note'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  updatedAt: timestamp('updatedAt').defaultNow()
});

/** ۹ نوع تراکنش مالی دقیق (سازگار با سما) */
export const TransactionType = {
  TUITION_FIXED: 'TUITION_FIXED',       // شهریه ثابت
  TUITION_VARIABLE: 'TUITION_VARIABLE', // شهریه متغیر
  PAYMENT: 'PAYMENT',                   // پرداختی/فیش
  DISCOUNT_FIXED: 'DISCOUNT_FIXED',     // تخفیف شهریه ثابت
  DISCOUNT_VARIABLE: 'DISCOUNT_VARIABLE', // تخفیف شهریه متغیر
  SUBJECT_ADDITIVE: 'SUBJECT_ADDITIVE',   // مبلغ موضوعی افزایشی
  SUBJECT_DEDUCTIVE: 'SUBJECT_DEDUCTIVE', // مبلغ موضوعی کاهشی
  SPONSORSHIP: 'SPONSORSHIP',           // مساعده/پوشش بنیاد
  LOAN: 'LOAN',                         // وام
} as const;

export const student_ledger = pgTable('student_ledger', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  termId: integer('termId').references(() => academic_terms.id),
  financialTermId: integer('financialTermId').references(() => financial_terms.id),
  transactionType: varchar('transactionType', { length: 25 }).notNull(),
  amount: numeric('amount', { precision: 12, scale: 0 }).notNull(),
  description: text('description'),
  referenceId: integer('referenceId'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  // ── فیلدهای قابل گزارش/فیلتر برای بخش مالی (مهاجرت ۰۱۱۹) ──
  // نوع واریز (نقدی/آنلاین/چک/کارت‌خوان/وام...). ردیف‌های منتقل‌شده از سیستم
  // قدیمی از متنِ description پر می‌شوند (scripts/backfill-deposit-type.sql).
  depositType: varchar('depositType', { length: 50 }),
  // تاریخ واریز واقعی. در مهاجرت از سیستم قدیمی منتقل نشده → NULL می‌ماند.
  depositDate: timestamp('depositDate'),
  // ── مستندسازت پرداختِ مهاجرت‌یافته از سیستم قدیمی (سما) ──
  // پر می‌شوند توسط scripts/backfill-legacy-payment-provenance.mjs (مهاجرت ۰۱۲۱).
  // کلید اتصال: referenceId = StdPays.stdpaysId.
  // نکتهٔ RLS: جدول از پیش RLS دارد (ستون studentId)؛ افزودن این ستون‌ها
  // هیچ تغییری در سیاست نمی‌دهد و سخت‌گیری fail-closed رعایت می‌شود.
  payerName: varchar('payerName', { length: 120 }),         // VW_StdPays.NAME (پرداخت‌کننده)
  payerNationalCode: varchar('payerNationalCode', { length: 12 }), // VW_StdPays.NationalCode
  receiptNo: varchar('receiptNo', { length: 40 }),          // StdPays.Fish_no (شماره فیش)
  voucherNo: varchar('voucherNo', { length: 80 }),          // StdPays.SanadNumber (شماره سند)
  payTypeCode: integer('payTypeCode'),                      // StdPays.pay_type (کد نوع پرداخت سما)
  accountNo: varchar('accountNo', { length: 30 }),          // StdPays.Acc_No (شماره حساب وصولی دانشگاه)
  cardNo: varchar('cardNo', { length: 30 }),               // استخراج‌شده از StdPays.Rem (شماره کارت پرداخت‌کننده)
  bankName: varchar('bankName', { length: 60 }),            // StdPays.BankName
  branchName: varchar('branchName', { length: 60 }),        // StdPays.BranchName
  recorderCode: integer('recorderCode'),                    // StdPays.userCode (ثبت‌کننده)
  recorderName: varchar('recorderName', { length: 120 }),   // Users.FullName
  legacyRem: text('legacyRem'),                              // StdPays.Rem (یادداشت آزاد اصل — شامل کارت/بانک/حساب)
  createdAt: timestamp('createdAt').defaultNow()
}, (t) => [
  index('idx_student_ledger_fin_term').on(t.financialTermId),
  // فیلترِ گزارشِ تفکیک وصولی بر اساس نوع واریز (مهاجرت ۰۱۱۹).
  index('idx_student_ledger_deposit_type').on(t.depositType),
  /* هر گزارش/صفحه‌ای که «بدهی یک دانشجو» یا «گردش حساب» را می‌خواند با
     studentId فیلتر می‌کند؛ بدون این ایندکس هر چنین کوئری‌ای اسکن کامل
     ۳۴۳ هزار ردیف بود (باگ ۵۰۴ کارت دانشجویی — ۱۸ اکتبر ۲۰۲۶). */
  index('idx_student_ledger_student').on(t.studentId),
  // ۱۵ نوع معتبر — همراستا با 0073_ledger_types (منبع حقیقت: ledger-balance.ts)
  // ۱۷ نوع معتبر — همراستا با 0075_tuition_adjust (منبع حقیقت: ledger-balance.ts)
  check('ck_student_ledger_txn_type', sql`"transactionType" IN ('TUITION_FIXED','TUITION_VARIABLE','PAYMENT','POS_PAYMENT','DISCOUNT_FIXED','DISCOUNT_VARIABLE','SUBJECT_ADDITIVE','SUBJECT_DEDUCTIVE','SPONSORSHIP','LOAN','TUITION_CHARGE','CHARGE','CREDIT','POS_REFUND','TUITION_BATES','TUITION_ADJUST_DEC','TUITION_ADJUST_INC')`),
  // 🔒 شارژ شهریهٔ هر ترم یکتاست (بک‌استاپِ chargeTermTuition اتمیک): جزئی روی
  // TUITION_CHARGE تا برگشتی‌ها (همان transactionType با referenceId) نشکنند.
  uniqueIndex('uq_student_ledger_tuition_charge').on(t.studentId, t.termId, t.transactionType).where(sql`"transactionType" = 'TUITION_CHARGE'`),
]);

export const financial_clearances = pgTable('financial_clearances', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  termId: integer('termId').notNull().references(() => academic_terms.id),
  isCleared: integer('isCleared').default(0),
  clearedAt: timestamp('clearedAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  UNIQUE: text('UNIQUE')
}, (t) => ({ uq: unique('uq_financial_clearances').on(t.studentId, t.termId) }));

export const exam_halls = pgTable('exam_halls', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  totalCapacity: integer('totalCapacity').notNull(),
  rowsCount: integer('rowsCount'),
  colsCount: integer('colsCount'),
  buildingName: varchar('buildingName', { length: 100 }),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const exam_sessions = pgTable('exam_sessions', {
  id: serial('id').primaryKey(),
  termId: integer('termId').notNull().references(() => academic_terms.id),
  examDate: varchar('examDate', { length: 10 }).notNull(),
  startTime: varchar('startTime', { length: 5 }).notNull(),
  endTime: varchar('endTime', { length: 5 }).notNull(),
  UNIQUE: text('UNIQUE'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({ uq: unique('uq_exam_sessions').on(t.termId, t.examDate, t.startTime) }));

/** زون‌بندی تقویم امتحانات هر ترم (فاز ۹): ارشد = کل ۳ هفته؛ عمومی = هفتهٔ اول؛ تخصصی = هفتهٔ ۲–۳ */
export const exam_calendar_configs = pgTable('exam_calendar_configs', {
  id: serial('id').primaryKey(),
  termId: integer('termId').notNull().references(() => academic_terms.id),
  globalStart: varchar('globalStart', { length: 10 }).notNull(),
  globalEnd: varchar('globalEnd', { length: 10 }).notNull(),
  generalStart: varchar('generalStart', { length: 10 }).notNull(),
  generalEnd: varchar('generalEnd', { length: 10 }).notNull(),
  specializedStart: varchar('specializedStart', { length: 10 }).notNull(),
  specializedEnd: varchar('specializedEnd', { length: 10 }).notNull(),
  updatedByUserId: integer('updatedByUserId').references(() => users.id),
  updatedAt: timestamp('updatedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({ uq: unique('uq_exam_calendar_configs_term').on(t.termId) }));

export const seat_allocations = pgTable('seat_allocations', {
  id: serial('id').primaryKey(),
  enrollmentId: integer('enrollmentId').notNull().references(() => enrollments.id),
  sessionId: integer('sessionId').notNull().references(() => exam_sessions.id),
  hallId: integer('hallId').notNull().references(() => exam_halls.id),
  seatNumber: integer('seatNumber').notNull(),
  blockKey: varchar('blockKey', { length: 120 }),
  UNIQUE: text('UNIQUE'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({ uq: unique('uq_seat_allocations').on(t.sessionId, t.hallId, t.seatNumber) }));

export const invigilators = pgTable('invigilators', {
  id: serial('id').primaryKey(),
  staffId: integer('staffId').notNull().references(() => staff.id),
  sessionId: integer('sessionId').notNull().references(() => exam_sessions.id),
  hallId: integer('hallId').notNull().references(() => exam_halls.id),
  role: varchar('role', { length: 50 }).default('PROCTOR'),
  attendanceStatus: varchar('attendanceStatus', { length: 20 }).default('PENDING'),
  hoursWorked: numeric('hoursWorked', { precision: 4, scale: 2 }).default('2.0'),
  calculatedPayment: numeric('calculatedPayment', { precision: 12, scale: 0 }).default('0'),
  paymentStatus: varchar('paymentStatus', { length: 20 }).default('UNPAID'),
  paidAt: timestamp('paidAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const exam_remuneration_rates = pgTable('exam_remuneration_rates', {
  id: serial('id').primaryKey(),
  role: varchar('role', { length: 50 }).notNull(),
  roleTitle: varchar('roleTitle', { length: 100 }).notNull(),
  ratePerHour: numeric('ratePerHour', { precision: 12, scale: 0 }).notNull(),
  effectiveYear: integer('effectiveYear').default(1405),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const professor_exam_attendance = pgTable('professor_exam_attendance', {
  id: serial('id').primaryKey(),
  offeringId: integer('offeringId').references(() => course_offerings.id),
  sessionId: integer('sessionId').references(() => exam_sessions.id),
  staffId: integer('staffId').references(() => staff.id),
  attendanceStatus: varchar('attendanceStatus', { length: 30 }).default('PENDING'),
  penaltyApplied: integer('penaltyApplied').default(0),
  penaltyAmount: numeric('penaltyAmount', { precision: 12, scale: 0 }).default('0'),
  notes: text('notes'),
  recordedAt: timestamp('recordedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const exam_minutes = pgTable('exam_minutes', {
  id: serial('id').primaryKey(),
  sessionId: integer('sessionId').notNull().references(() => exam_sessions.id),
  hallId: integer('hallId').notNull().references(() => exam_halls.id),
  totalStudentsExpected: integer('totalStudentsExpected').default(0),
  totalStudentsPresent: integer('totalStudentsPresent').default(0),
  totalStudentsAbsent: integer('totalStudentsAbsent').default(0),
  cheatingIncidentsCount: integer('cheatingIncidentsCount').default(0),
  supervisorStaffId: integer('supervisorStaffId').references(() => staff.id),
  isSignedAndFinalized: integer('isSignedAndFinalized').default(0),
  signedAt: timestamp('signedAt'),
  notes: text('notes'),
  summaryHash: varchar('summaryHash', { length: 255 }),
  /** لحظهٔ تحویل برگه‌های این سالن به مخزن — دقیقاً یک‌بار (گلوله همان لوله) */
  vaultReceivedAt: timestamp('vaultReceivedAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const teaching_rates = pgTable('teaching_rates', {
  id: serial('id').primaryKey(),
  academicRank: varchar('academicRank', { length: 50 }),
  degree: varchar('degree', { length: 50 }),
  baseRatePerUnit: numeric('baseRatePerUnit', { precision: 12, scale: 0 }).notNull(),
  effectiveYear: integer('effectiveYear'),
  // ── مهاجرت 0090: بُعد پایه (NULL = همهٔ پایه‌ها؛ مربی پایه ۱ ≠ پایه ۲)
  academicBase: varchar('academicBase', { length: 20 }),
  versionId: integer('versionId'), // نسخه آیین‌نامه (مهاجرت 0085؛ NULL = همه نسخه‌ها)
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const teaching_coefficients = pgTable('teaching_coefficients', {
  id: serial('id').primaryKey(),
  ruleName: varchar('ruleName', { length: 100 }).notNull(),
  multiplier: numeric('multiplier', { precision: 3, scale: 2 }).notNull(),
  versionId: integer('versionId'), // نسخه آیین‌نامه (مهاجرت 0085)
  // ── مهاجرت 0086: کلاس پرجمعیت پلکانی — آستانه، گام، افزایش هر پله، سقف واحد ──
  minStudents: integer('minStudents'),       // NULL = آستانه سراسری PAYROLL_CROWDED_THRESHOLD
  stepSize: integer('stepSize'),             // هر چند نفر = یک پله (NULL = PAYROLL_CROWDED_STEP)
  stepIncrement: numeric('stepIncrement', { precision: 6, scale: 4 }), // افزایش ضریب هر پله (NULL = PAYROLL_CROWDED_STEP_UP)
  capUnits: numeric('capUnits', { precision: 6, scale: 2 }),           // سقف واحد مشمول این ضریب
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const payroll_calculation_rules = pgTable('payroll_calculation_rules', {
  id: serial('id').primaryKey(),
  offeringType: varchar('offeringType', { length: 50 }),
  professorRole: varchar('professorRole', { length: 50 }),
  academicRank: varchar('academicRank', { length: 50 }),
  // ── مهاجرت 0092: عبارت یکپارچه + ابعاد گروه/نوع/تکرار (جای ۳ ستون قدیمی) ──
  expression: text('expression'),                 // عبارت ریاضی با N/A/W/U/C/R/K/F/H (خروجی: ریال)
  departmentId: integer('departmentId'),          // گروه آموزشی (NULL = همه)
  courseType: varchar('courseType', { length: 50 }), // نوع دقیق درس (NULL = همه)
  repeatNumber: integer('repeatNumber'),          // دفعهٔ Nام تدریس (NULL = همه)
  flatBase: numeric('flatBase', { precision: 12, scale: 0 }), // مبلغ مبنا برای F (NULL = ۰)
  title: varchar('title', { length: 150 }),
  isActive: integer('isActive').default(1),
  versionId: integer('versionId'), // نسخه آیین‌نامه (مهاجرت 0085؛ NULL = همه نسخه‌ها)
  // ── مهاجرت 0086: ابعاد فرمول (مقطع، تکرار، دوری، پنجره‌ها) ──
  degreeLevelId: integer('degreeLevelId'),            // NULL = همه مقاطع
  repeatPolicy: varchar('repeatPolicy', { length: 20 }).default('ALLOW'), // ALLOW | FIRST_ONLY | HALF_AFTER
  distanceScope: varchar('distanceScope', { length: 20 }).default('ALL'), // ALL | PRESENT_ONLY | VIRTUAL_ONLY
  repeatCourseWindow: integer('repeatCourseWindow'),  // پنجره تکرار همان درس (تعداد ترم)
  termCountWindow: integer('termCountWindow'),        // پنجره شمارش تکرار (تعداد ترم)
  excludeTerms: text('excludeTerms'),                 // کد ترم‌های مستثنی (CSV)
  // ── مهاجرت 0089: بُعد وضعیت کلاس (ANY | WITH_CLASS | NO_CLASS) ──
  classMode: varchar('classMode', { length: 20 }).notNull().default('ANY'),
  // ── مهاجرت 0091: بازه دانشجو + فرمول ساعتی (الگوریتم یکپارچه؛ NULL = بدون قید) ──
  minStudents: integer('minStudents'),            // کف بازه (NULL = بدون کف)
  maxStudents: integer('maxStudents'),            // سقف بازه (NULL = بی‌نهایت)
  perStudentHours: numeric('perStudentHours', { precision: 5, scale: 2 }), // ساعت به‌ازای هر دانشجو (NULL = فرمول عادی)
  updatedAt: timestamp('updatedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const professor_term_contracts = pgTable('professor_term_contracts', {
  id: serial('id').primaryKey(),
  staffId: integer('staffId').notNull().references(() => staff.id),
  termId: integer('termId').notNull().references(() => academic_terms.id),
  contractType: varchar('contractType', { length: 50 }),
  baseDutyUnits: numeric('baseDutyUnits', { precision: 4, scale: 2 }).default('0'),
  taxRate: numeric('taxRate', { precision: 4, scale: 2 }),
  // ── مهاجرت 0056: اسنپ‌شات ترمی — هنگام ساخت قرارداد از staff مهر می‌شود؛
  // NULL = ردیف قدیمی ← موتور مقدار زنده می‌خواند (بدون backfill) ──
  rankSnapshot: varchar('rankSnapshot', { length: 50 }),
  baseSnapshot: varchar('baseSnapshot', { length: 20 }),
  rateSnapshot: numeric('rateSnapshot', { precision: 12, scale: 0 }),
  // ── مهاجرت 0087: مبنای حکم (مجموع حقوق مرتبه+پایه+فوق‌العاده) برای حالت نرخ ۱/N ──
  salaryBase: integer('salaryBase'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const payroll_statements = pgTable('payroll_statements', {
  id: serial('id').primaryKey(),
  contractId: integer('contractId').notNull().references(() => professor_term_contracts.id),
  totalEquivalentUnits: numeric('totalEquivalentUnits', { precision: 6, scale: 2 }),
  payableUnits: numeric('payableUnits', { precision: 6, scale: 2 }),
  grossAmount: numeric('grossAmount', { precision: 12, scale: 0 }),
  deductions: numeric('deductions', { precision: 12, scale: 0 }),
  netAmount: numeric('netAmount', { precision: 12, scale: 0 }),
  status: varchar('status', { length: 20 }).default('DRAFT'),
  detailJson: text('detailJson'),
  midtermPaidAmount: numeric('midtermPaidAmount', { precision: 12, scale: 0 }).default('0'),
  midtermPaidAt: timestamp('midtermPaidAt'),
  finalPaidAmount: numeric('finalPaidAmount', { precision: 12, scale: 0 }).default('0'),
  finalPaidAt: timestamp('finalPaidAt'),
  computedAt: timestamp('computedAt').defaultNow(),
  // ── مهاجرت 0056: اسنپ‌شات ترمی — هنگام compute مهر می‌شود؛ NULL = ردیف قدیمی ──
  rankSnapshot: varchar('rankSnapshot', { length: 50 }),
  baseSnapshot: varchar('baseSnapshot', { length: 20 }),
  rateSnapshot: numeric('rateSnapshot', { precision: 12, scale: 0 }),
  // ── مهاجرت 0087: اقلام تکمیلی + ابلاغیه ──
  activityPay: integer('activityPay').notNull().default(0),
  allowancePay: integer('allowancePay').notNull().default(0),
  examPay: integer('examPay').notNull().default(0),
  cashExtraPay: integer('cashExtraPay').notNull().default(0),
  decreeId: integer('decreeId'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => [
  // 🔒 وضعیت فیش فقط از ماشین حالت زنجیرهٔ تأیید (NULL قدیمی مجاز می‌ماند).
  check('ck_payroll_statements_status', sql`"status" IN ('DRAFT','MID_TERM_PAID','DEPT_HEAD_APPROVED','DEAN_APPROVED','FINAL_SETTLED','REJECTED')`),
]);

export const class_sessions = pgTable('class_sessions', {
  id: serial('id').primaryKey(),
  offeringId: integer('offeringId').notNull().references(() => course_offerings.id),
  sessionDate: varchar('sessionDate', { length: 10 }).notNull(),
  startTime: varchar('startTime', { length: 5 }).notNull(),
  endTime: varchar('endTime', { length: 5 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('SCHEDULED'),
  isMakeUpSession: integer('isMakeUpSession').default(0),
  replacedSessionId: integer('replacedSessionId').references((): AnyPgColumn => class_sessions.id),
  sessionNo: integer('sessionNo'),
  // ── کارتابل واقعی کلاس جبرانی (مهاجرت ۰۰۶۰) ──
  roomId: integer('roomId').references(() => classrooms.id),
  topic: varchar('topic', { length: 300 }),
  absenceReason: text('absenceReason'),
  rejectionReason: text('rejectionReason'),
  // ── پرچم‌ها و مهرهای زمانی جلسه (مهاجرت ۰۱۰۱) ──
  /** تعطیل: جلسه به‌خاطر تعطیلی برگزار نشد (جدا از غیبت استاد) */
  isHoliday: integer('isHoliday').notNull().default(0),
  /** فوق‌برنامه: جلسهٔ اضافه بیرون از جلسات استاندارد ترم */
  isExtraSession: integer('isExtraSession').notNull().default(0),
  /** فعال: جلسهٔ لغوشده/منقضی در فهرست عملیاتی نیاید */
  isActive: integer('isActive').notNull().default(1),
  createdAt: timestamp('createdAt').defaultNow(),
  /** آخرین باری که استاد این جلسه را در کارتابل خود دیده است */
  professorViewedAt: timestamp('professorViewedAt'),
  updatedAt: timestamp('updatedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const student_class_attendance = pgTable('student_class_attendance', {
  id: serial('id').primaryKey(),
  sessionId: integer('sessionId').notNull().references(() => class_sessions.id),
  enrollmentId: integer('enrollmentId').notNull().references(() => enrollments.id),
  status: varchar('status', { length: 10 }).notNull(),
  /** فقط برای وضعیت LATE: مدت تأخیر به دقیقه (۱..۶۰) */
  lateMinutes: integer('lateMinutes'),
  UNIQUE: text('UNIQUE'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const professor_class_attendance = pgTable('professor_class_attendance', {
  id: serial('id').primaryKey(),
  sessionId: integer('sessionId').notNull().references(() => class_sessions.id),
  staffId: integer('staffId').notNull().references(() => staff.id),
  verificationMethod: varchar('verificationMethod', { length: 30 }).notNull(),
  recordedIpAddress: varchar('recordedIpAddress', { length: 50 }),
  deviceUserAgent: text('deviceUserAgent'),
  status: varchar('status', { length: 20 }).notNull().default('VALID'),
  recordedAt: timestamp('recordedAt').defaultNow(),
  /** یادداشت تأیید دستی توسط کارشناس آموزش */
  note: varchar('note', { length: 300 }),
  /** کارشناسی که حضور را دستی تأیید کرده (ممیزی) */
  confirmedByStaffId: integer('confirmedByStaffId').references(() => staff.id),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

/**
 * حضور مراقب/استاد در جلسهٔ امتحان — جدا از حضور دانشجویان.
 * به‌ازای هر (جلسه، نفر) یک ردیف: روش ثبت (CLOCK_IN/QR_SCAN/MANUAL_BY_EXPERT)
 * و هویت تأییدکننده نگه داشته می‌شود تا زنجیرهٔ ممیزی کامل باشد.
 */
export const exam_session_staff_attendance = pgTable('exam_session_staff_attendance', {
  id: serial('id').primaryKey(),
  sessionId: integer('sessionId').notNull().references(() => exam_sessions.id),
  hallId: integer('hallId').references(() => exam_halls.id),
  staffId: integer('staffId').notNull().references(() => staff.id),
  /** PROCTOR | PROFESSOR */
  role: varchar('role', { length: 30 }).notNull(),
  isPresent: integer('isPresent').notNull().default(0),
  /** CLOCK_IN | QR_SCAN | MANUAL_BY_EXPERT */
  method: varchar('method', { length: 30 }),
  confirmedByStaffId: integer('confirmedByStaffId').references(() => staff.id),
  note: varchar('note', { length: 300 }),
  recordedAt: timestamp('recordedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({
  uq: unique('uq_exam_session_staff_attendance').on(t.sessionId, t.staffId),
}));

export const physical_access_logs = pgTable('physical_access_logs', {
  id: serial('id').primaryKey(),
  staffId: integer('staffId').notNull().references(() => staff.id),
  punchTime: timestamp('punchTime').notNull(),
  deviceLocation: varchar('deviceLocation', { length: 100 })
});

export const electronic_documents = pgTable('electronic_documents', {
  id: serial('id').primaryKey(),
  contractId: integer('contractId').references(() => professor_term_contracts.id),
  staffId: integer('staffId').notNull().references(() => staff.id),
  termId: integer('termId').notNull().references(() => academic_terms.id),
  docType: varchar('docType', { length: 50 }),
  title: varchar('title', { length: 200 }),
  documentSnapshot: text('documentSnapshot').notNull(),
  documentHash: varchar('documentHash', { length: 255 }).notNull(),
  signatureStatus: varchar('signatureStatus', { length: 20 }).default('PENDING'),
  signedAt: timestamp('signedAt'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

/** کد یکبارمصرف امضای دیجیتال اسناد (قرارداد، تأیید نمرات و…) — فقط هش ذخیره می‌شود */
export const signature_otps = pgTable('signature_otps', {
  id: serial('id').primaryKey(),
  staffId: integer('staffId').notNull().references(() => staff.id),
  purpose: varchar('purpose', { length: 50 }).notNull(), // CONTRACT_SIGN, GRADE_FINALIZE, …
  refId: integer('refId').notNull(), // شناسهٔ سند/درس هدف
  otpHash: varchar('otpHash', { length: 64 }).notNull(), // SHA-256 کد
  expiresAt: timestamp('expiresAt').notNull(),
  isUsed: integer('isUsed').default(0),
  attempts: integer('attempts').default(0),
  lockedAt: timestamp('lockedAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow()
});

/** یادداشت استاد برای مدیر گروه در هر ترم (درخواست‌های تکمیلی زمان‌بندی) */
export const professor_availability_notes = pgTable('professor_availability_notes', {
  id: serial('id').primaryKey(),
  staffId: integer('staffId').notNull().references(() => staff.id),
  termId: integer('termId').notNull().references(() => academic_terms.id),
  note: text('note').notNull(),
  updatedAt: timestamp('updatedAt').defaultNow()
}, (t) => ({ uq: unique('uq_prof_avail_note').on(t.staffId, t.termId) }));

export const document_signatures = pgTable('document_signatures', {
  id: serial('id').primaryKey(),
  documentId: integer('documentId').notNull().references(() => electronic_documents.id),
  staffId: integer('staffId').notNull().references(() => staff.id),
  signedAt: timestamp('signedAt').notNull(),
  ipAddress: varchar('ipAddress', { length: 50 }),
  userAgent: text('userAgent'),
  otpUsed: varchar('otpUsed', { length: 10 })
});

export const verification_otps = pgTable('verification_otps', {
  id: serial('id').primaryKey(),
  targetId: integer('targetId').notNull(),
  targetType: varchar('targetType', { length: 50 }).notNull(),
  otpHash: varchar('otpHash', { length: 64 }).notNull(), // فقط هش کد (HMAC نمک‌دار) — هرگز متن خام OTP
  expiresAt: timestamp('expiresAt').notNull(),
  isUsed: integer('isUsed').default(0)
});

export const military_service_records = pgTable('military_service_records', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().unique().references(() => students.id),
  status: varchar('status', { length: 50 }),
  exemptionExpiry: date('exemptionExpiry'),
  sakhaStatus: varchar('sakhaStatus', { length: 50 }),
  exemptionStartDate: date('exemptionStartDate'),
  sakhaTrackingCode: varchar('sakhaTrackingCode', { length: 50 }),
  pendingExtraSemesters: integer('pendingExtraSemesters'),
  lastSyncAt: timestamp('lastSyncAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const document_categories = pgTable('document_categories', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 100 }).notNull(),
  scope: varchar('scope', { length: 20 }).default('STUDENT'),
  accessRoles: text('accessRoles'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const document_types = pgTable('document_types', {
  id: serial('id').primaryKey(),
  categoryId: integer('categoryId').notNull().references(() => document_categories.id),
  code: varchar('code', { length: 40 }).notNull().unique(),
  title: varchar('title', { length: 100 }).notNull(),
  targetAudience: varchar('targetAudience', { length: 10 }).default('BOTH'),
  isRequired: integer('isRequired').default(1),
  needsVerification: integer('needsVerification').default(1),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const student_documents = pgTable('student_documents', {
  id: serial('id').primaryKey(),
  personUserId: integer('personUserId').notNull().references(() => users.id),
  categoryId: integer('categoryId').notNull().references(() => document_categories.id),
  typeId: integer('typeId').references(() => document_types.id),
  fileName: varchar('fileName', { length: 255 }).notNull(),
  fileUrl: varchar('fileUrl', { length: 500 }).notNull(),
  mimeType: varchar('mimeType', { length: 100 }),
  contentHash: varchar('contentHash', { length: 64 }),   // SHA-256 محتوای سند — مبنای استعلام اصالت فرم‌های ممهور
  verificationStatus: varchar('verificationStatus', { length: 20 }).default('PENDING'),
  verifiedBy: integer('verifiedBy'),
  rejectionReason: text('rejectionReason'),
  uploadedAt: timestamp('uploadedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const kyc_verifications = pgTable('kyc_verifications', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull().references(() => users.id),
  civilRegistryStatus: varchar('civilRegistryStatus', { length: 30 }).default('PENDING'),
  shahkarStatus: varchar('shahkarStatus', { length: 30 }).default('PENDING'),
  fetchedCivilData: text('fetchedCivilData'),
  livenessVideoUrl: varchar('livenessVideoUrl', { length: 500 }),
  livenessChallenge: varchar('livenessChallenge', { length: 150 }),
  faceMatchScore: numeric('faceMatchScore', { precision: 5, scale: 2 }),
  aiVerificationStatus: varchar('aiVerificationStatus', { length: 30 }).default('PENDING'),
  expertDecision: varchar('expertDecision', { length: 20 }),
  reviewedBy: integer('reviewedBy'),
  ipAddress: varchar('ipAddress', { length: 50 }),
  deviceInfo: text('deviceInfo'),
  completedAt: timestamp('completedAt'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const notification_templates = pgTable('notification_templates', {
  id: serial('id').primaryKey(),
  eventCode: varchar('eventCode', { length: 50 }).notNull().unique(),
  channel: varchar('channel', { length: 20 }),
  templateText: text('templateText').notNull(),
  isActive: integer('isActive').default(1),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  // ── ویرایشگر قالب‌های چندکاناله (مهاجرت ۰۰۶۲) ──
  title: varchar('title', { length: 150 }),
  variables: text('variables'),
  channels: varchar('channels', { length: 100 }),
  updatedAt: timestamp('updatedAt').defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull().references(() => users.id),
  eventCode: varchar('eventCode', { length: 50 }),
  payload: text('payload'),
  isRead: integer('isRead').default(0),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow()
});

export const audit_logs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  actorUserId: integer('actorUserId'),
  action: varchar('action', { length: 100 }).notNull(),
  entityType: varchar('entityType', { length: 50 }),
  entityId: integer('entityId'),
  details: text('details'),
  prevHash: varchar('prevHash', { length: 64 }),
  hash: varchar('hash', { length: 64 }).notNull(),
  ipAddress: varchar('ipAddress', { length: 50 }),
  createdAt: timestamp('createdAt').defaultNow()
});

export const system_settings = pgTable('system_settings', {
  key: varchar('key', { length: 60 }).primaryKey(),
  value: text('value').notNull(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const document_templates = pgTable('document_templates', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  title: varchar('title', { length: 150 }).notNull(),
  templateText: text('templateText').notNull(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const doc_sign_otps = pgTable('doc_sign_otps', {
  id: serial('id').primaryKey(),
  staffId: integer('staffId').notNull().references(() => staff.id),
  documentId: integer('documentId').notNull().references(() => electronic_documents.id),
  otpHash: text('otpHash').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  isUsed: integer('isUsed').default(0),
  attempts: integer('attempts').default(0),
  lockedAt: timestamp('lockedAt'),
  createdAt: timestamp('createdAt').defaultNow()
});

// ============================================================================
// ماژول آموزش‌های آزاد، بوت‌کمپ‌ها و دوره‌های کوتاه‌مدت (Continuing Education)
// ============================================================================

export const short_term_courses = pgTable('short_term_courses', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  title: varchar('title', { length: 255 }).notNull(),
  titleEn: varchar('titleEn', { length: 255 }),
  category: varchar('category', { length: 100 }).notNull().default('مهندسی و فناوری'),
  description: text('description'),
  hours: integer('hours').notNull().default(40),
  tuitionPrice: integer('tuitionPrice').notNull().default(0), // مبلغ شهریه به تومان
  capacity: integer('capacity').notNull().default(30),
  enrolledCount: integer('enrolledCount').notNull().default(0),
  instructorName: varchar('instructorName', { length: 150 }).notNull(),
  instructorBio: text('instructorBio'),
  syllabusJson: text('syllabusJson'), // سرفصل‌های دوره به‌صورت آرایه JSON
  startDate: varchar('startDate', { length: 20 }),
  endDate: varchar('endDate', { length: 20 }),
  scheduleText: varchar('scheduleText', { length: 200 }),
  passingGrade: numeric('passingGrade', { precision: 4, scale: 2 }).default('12.00'),
  maxAbsences: integer('maxAbsences').default(3),
  status: varchar('status', { length: 20 }).default('OPEN'), // OPEN, IN_PROGRESS, COMPLETED, ARCHIVED
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const short_term_learners = pgTable('short_term_learners', {
  id: serial('id').primaryKey(),
  mobile: varchar('mobile', { length: 20 }).notNull().unique(),
  nationalId: varchar('nationalId', { length: 10 }),
  fullName: varchar('fullName', { length: 150 }).notNull(),
  fullNameEn: varchar('fullNameEn', { length: 150 }),
  email: varchar('email', { length: 150 }),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const short_term_discounts = pgTable('short_term_discounts', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  courseId: integer('courseId').references(() => short_term_courses.id),
  discountPercent: integer('discountPercent').notNull().default(10),
  maxDiscountAmount: integer('maxDiscountAmount'),
  maxUsage: integer('maxUsage').default(100),
  usedCount: integer('usedCount').default(0),
  isActive: integer('isActive').default(1),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const short_term_registrations = pgTable('short_term_registrations', {
  id: serial('id').primaryKey(),
  learnerId: integer('learnerId').notNull().references(() => short_term_learners.id),
  courseId: integer('courseId').notNull().references(() => short_term_courses.id),
  trackingCode: varchar('trackingCode', { length: 50 }).notNull().unique(),
  amountPaid: integer('amountPaid').notNull().default(0),
  discountAmount: integer('discountAmount').default(0),
  discountCode: varchar('discountCode', { length: 50 }),
  paymentStatus: varchar('paymentStatus', { length: 20 }).notNull().default('PAID'), // PAID, PENDING, REFUNDED
  paymentRefId: varchar('paymentRefId', { length: 100 }),
  attendanceCount: integer('attendanceCount').default(0),
  totalSessions: integer('totalSessions').default(10),
  finalGrade: numeric('finalGrade', { precision: 4, scale: 2 }),
  isPassed: integer('isPassed').default(0),
  certificateIssued: integer('certificateIssued').default(0),
  certificateId: integer('certificateId'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const short_term_certificates = pgTable('short_term_certificates', {
  id: serial('id').primaryKey(),
  certificateNumber: varchar('certificateNumber', { length: 50 }).notNull().unique(),
  verificationHash: varchar('verificationHash', { length: 64 }).notNull(), // SHA-256
  learnerId: integer('learnerId').notNull().references(() => short_term_learners.id),
  courseId: integer('courseId').notNull().references(() => short_term_courses.id),
  registrationId: integer('registrationId').notNull().references(() => short_term_registrations.id),
  fullNameFa: varchar('fullNameFa', { length: 150 }).notNull(),
  fullNameEn: varchar('fullNameEn', { length: 150 }),
  courseTitleFa: varchar('courseTitleFa', { length: 255 }).notNull(),
  courseTitleEn: varchar('courseTitleEn', { length: 255 }),
  grade: numeric('grade', { precision: 4, scale: 2 }).notNull(),
  totalHours: integer('totalHours').notNull(),
  issueDate: varchar('issueDate', { length: 20 }).notNull(),
  isRevoked: integer('isRevoked').default(0),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ============================================================================
// کارت دانشجویی هوشمند و ره‌گیری فیزیکی (Student ID Cards)
// ============================================================================

export const student_cards = pgTable('student_cards', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  secureToken: varchar('secureToken', { length: 64 }).notNull().unique(),
  printStatus: varchar('printStatus', { length: 20 }).default('PENDING'), // PENDING, PRINTED, LOST, REVOKED
  rfidSerialNumber: varchar('rfidSerialNumber', { length: 100 }),
  issuedAt: timestamp('issuedAt'),
  expiresAt: timestamp('expiresAt'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ============================================================================
// حضور و غیاب آزمون، مراقبین و بسته‌های تحویل مخزن (Invigilators & Chain of Custody)
// ============================================================================

export const exam_attendances = pgTable('exam_attendances', {
  id: serial('id').primaryKey(),
  examId: integer('examId').notNull().references(() => exam_sessions.id),
  studentId: integer('studentId').notNull().references(() => students.id),
  isPresent: integer('isPresent').default(0),
  checkInMethod: varchar('checkInMethod', { length: 30 }).default('QR_SCAN'), // QR_SCAN, MANUAL_BY_INVIGILATOR, SYSTEM_EXCUSE
  verifiedByStaffId: integer('verifiedByStaffId').references(() => staff.id),
  hasTemporaryPermit: integer('hasTemporaryPermit').default(0), // دارای مجوز موقت / تعهد کتبی
  checkInTime: timestamp('checkInTime'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const exam_invigilators = pgTable('exam_invigilators', {
  id: serial('id').primaryKey(),
  examId: integer('examId').notNull().references(() => exam_sessions.id),
  staffId: integer('staffId').notNull().references(() => staff.id),
  role: varchar('role', { length: 50 }).notNull().default('INVIGILATOR'), // HEAD_INVIGILATOR, INVIGILATOR, TECHNICAL_SUPPORT
  clockInTime: timestamp('clockInTime'),
  clockOutTime: timestamp('clockOutTime'),
  isBilledToPayroll: integer('isBilledToPayroll').default(0),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const exam_course_packets = pgTable('exam_course_packets', {
  id: serial('id').primaryKey(),
  examId: integer('examId').notNull().references(() => exam_sessions.id),
  courseId: integer('courseId').notNull().references(() => courses.id),
  invigilatorStaffId: integer('invigilatorStaffId').references(() => staff.id),
  expectedSheetCount: integer('expectedSheetCount').notNull().default(0),
  actualDeliveredCount: integer('actualDeliveredCount'),
  handoverStatus: varchar('handoverStatus', { length: 30 }).default('NOT_STARTED'), // NOT_STARTED, AWAITING_HANDOVER, DISCREPANCY, RECEIVED_BY_VAULT
  receivedByVaultManagerId: integer('receivedByVaultManagerId').references(() => staff.id),
  handoverCompletedAt: timestamp('handoverCompletedAt'),
  discrepancyNote: text('discrepancyNote'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const notification_logs = pgTable('notification_logs', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull().references(() => users.id),
  channel: varchar('channel', { length: 20 }).notNull(), // SMS, EMAIL, PUSH
  eventType: varchar('eventType', { length: 50 }).notNull(),
  messageBody: text('messageBody').notNull(),
  deliveryStatus: varchar('deliveryStatus', { length: 20 }).default('PENDING'), // DELIVERED, FAILED, SEEN, PENDING
  providerResponse: text('providerResponse'),
  sentAt: timestamp('sentAt').defaultNow(),
  deliveredAt: timestamp('deliveredAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ============================================================================
// تجمیع سالن‌های امتحان، تحویل اوراق به استاد و چرخه بایگانی (Exam Handover & Chain)
// ============================================================================

export const course_exam_sessions = pgTable('course_exam_sessions', {
  id: serial('id').primaryKey(),
  courseOfferingId: integer('courseOfferingId').notNull(),
  totalHallsCount: integer('totalHallsCount').notNull().default(1),
  receivedHallsCount: integer('receivedHallsCount').notNull().default(0),
  totalExpectedSheets: integer('totalExpectedSheets').notNull().default(0),
  totalDeliveredSheets: integer('totalDeliveredSheets').notNull().default(0),
  isFullyCollected: integer('isFullyCollected').default(0),
  notificationSentAt: timestamp('notificationSentAt'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const instructor_deliveries = pgTable('instructor_deliveries', {
  id: serial('id').primaryKey(),
  courseOfferingId: integer('courseOfferingId').notNull(),
  instructorId: integer('instructorId').notNull().references(() => staff.id),
  sheetCount: integer('sheetCount').notNull(),
  pickupToken: varchar('pickupToken', { length: 64 }).notNull().unique(),
  deliveredAt: timestamp('deliveredAt').defaultNow(),
  vaultManagerId: integer('vaultManagerId').references(() => staff.id),
  gradeDeadline: timestamp('gradeDeadline').notNull(),
  status: varchar('status', { length: 30 }).default('PENDING_GRADING'), // PENDING_GRADING, GRADES_SUBMITTED, ARCHIVED
  papersReturnedToArchive: integer('papersReturnedToArchive').default(0),
  archiveManagerId: integer('archiveManagerId').references(() => staff.id),
  returnedAt: timestamp('returnedAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ============================================================================
// ماژول مساعده، مالیات و بیمه روزانه تامین اجتماعی اساتید (Advances & Social Security)
// ============================================================================

export const instructor_advances = pgTable('instructor_advances', {
  id: serial('id').primaryKey(),
  instructorId: integer('instructorId').notNull().references(() => staff.id),
  courseOfferingId: integer('courseOfferingId').notNull(),
  requestedAmount: integer('requestedAmount').notNull(),
  approvedAmount: integer('approvedAmount'),
  status: varchar('status', { length: 30 }).default('PENDING_APPROVAL'), // PENDING_APPROVAL, APPROVED, PAID, REJECTED
  approvedByFinanceId: integer('approvedByFinanceId').references(() => staff.id),
  paidAt: timestamp('paidAt'),
  isDeductedFromFinalPayroll: integer('isDeductedFromFinalPayroll').default(0),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const instructor_financial_profiles = pgTable('instructor_financial_profiles', {
  id: serial('id').primaryKey(),
  instructorId: integer('instructorId').notNull().references(() => staff.id).unique(),
  canRequestAdvance: integer('canRequestAdvance').default(0), // کلید کنترلی پنهان مساعده (پیش‌فرض ۰)
  isInsuranceEnabled: integer('isInsuranceEnabled').default(1), // بیمه روزانه تامین اجتماعی
  isTaxExempt: integer('isTaxExempt').default(0),
  taxRatePercent: integer('taxRatePercent').default(10), // ۱۰٪ مالیات تکلیفی
  insuranceType: varchar('insuranceType', { length: 50 }).default('TAMIN_DAILY'),
  taminBranchCode: varchar('taminBranchCode', { length: 50 }),
  updatedAt: timestamp('updatedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const instructor_attendance_days = pgTable('instructor_attendance_days', {
  id: serial('id').primaryKey(),
  instructorId: integer('instructorId').notNull().references(() => staff.id),
  attendanceDate: varchar('attendanceDate', { length: 20 }).notNull(), // تاریخ روز تدریس (مثال: ۱۴۰۵/۰۸/۱۲)
  sessionsHeldCount: integer('sessionsHeldCount').default(1),
  insuranceCalculated: integer('insuranceCalculated').default(1),
  syncedWithTamin: integer('syncedWithTamin').default(0),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ============================================================================
// مدیریت سطوح دسترسی پویا و مجوزهای ریزدانه (Dynamic RBAC Matrix)
// ============================================================================

export const staff_roles = pgTable('staff_roles', {
  id: serial('id').primaryKey(),
  staffId: integer('staffId').notNull().references(() => staff.id),
  roleId: integer('roleId').notNull().references(() => roles.id),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ============================================================================
// سامانه آموزش مجازی و اتصال به مودل و بیگ‌بلوباتن (Moodle & BigBlueButton)
// ============================================================================

export const virtual_classrooms = pgTable('virtual_classrooms', {
  id: serial('id').primaryKey(),
  courseOfferingId: integer('courseOfferingId').notNull(),
  bbbMeetingId: varchar('bbbMeetingId', { length: 100 }).notNull(),
  meetingName: varchar('meetingName', { length: 255 }).notNull(),
  moderatorPw: varchar('moderatorPw', { length: 50 }).notNull(),
  attendeePw: varchar('attendeePw', { length: 50 }).notNull(),
  isRunning: integer('isRunning').default(0),
  currentAttendanceCount: integer('currentAttendanceCount').default(0),
  /** آخرین بار که وضعیت این جلسه از سرور BBB خوانده شد */
  lastSyncedAt: timestamp('lastSyncedAt'),
  /** آخرین زمانی که جلسه «در حال برگزاری» دیده شد (برای گزارش «برگزار شده») */
  lastRunningAt: timestamp('lastRunningAt'),
  moodleCourseId: integer('moodleCourseId'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const virtual_class_recordings = pgTable('virtual_class_recordings', {
  id: serial('id').primaryKey(),
  classroomId: integer('classroomId').notNull().references(() => virtual_classrooms.id),
  sessionTitle: varchar('sessionTitle', { length: 255 }).notNull(),
  recordingUrl: varchar('recordingUrl', { length: 500 }).notNull(),
  durationMinutes: integer('durationMinutes').notNull().default(90),
  recordedAt: timestamp('recordedAt').defaultNow(),
  viewsCount: integer('viewsCount').default(0),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ═══ سامانهٔ مهاجرت داده از سیستم قدیمی (ETL) ═══
export const migration_runs = pgTable('migration_runs', {
  id: serial('id').primaryKey(),
  entity: varchar('entity', { length: 30 }).notNull(),       // student/course/term/enrollment/ledger/clearance
  fileName: varchar('fileName', { length: 255 }),
  mode: varchar('mode', { length: 10 }).notNull(),           // DRY | COMMIT
  totalRows: integer('totalRows').default(0),
  inserted: integer('inserted').default(0),
  skippedExisting: integer('skippedExisting').default(0),
  invalid: integer('invalid').default(0),
  report: text('report'),                                    // JSON کامل گزارش
  status: varchar('status', { length: 20 }).notNull(),       // OK | FAILED
  triggeredByUserId: integer('triggeredByUserId'),
  createdAt: timestamp('createdAt').defaultNow()
});

// ══════════════════════════════════════════════════════════════════════
//  مهاجرت از سرورهای قدیمی — میز کار تطبیق کد، شهریه و نمرات
//  (سند «انتقال داده‌های قدیمی»: staging جدا از دادهٔ عملیاتی تا مقایسه و
//   بازبینی ممکن باشد و هیچ‌چیز کورکورانه روی سامانهٔ جدید نوشته نشود)
// ══════════════════════════════════════════════════════════════════════

/** سرور/سامانهٔ مبدأ (گلستان، سما، اکسل واحد مالی و…) */
export const legacy_sources = pgTable('legacy_sources', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),   // LEGACY, GOLESTAN, SAMA…
  title: varchar('title', { length: 150 }).notNull(),
  kind: varchar('kind', { length: 30 }).default('OTHER'),     // GOLESTAN | SAMA | EXCEL | OTHER
  note: text('note'),
  isActive: integer('isActive').notNull().default(1),
  createdAt: timestamp('createdAt').defaultNow()
});

/** جدول تطبیق کدها: کد سیستم قدیمی → موجودیت سامانهٔ جدید */
export const legacy_code_maps = pgTable('legacy_code_maps', {
  id: serial('id').primaryKey(),
  sourceCode: varchar('sourceCode', { length: 50 }).notNull().default('LEGACY'),
  domain: varchar('domain', { length: 30 }).notNull(),        // MAJOR|DEGREE|TERM|COURSE|DEPARTMENT|STUDENT_STATUS|GRADE_STATUS|TX_TYPE|FEE_ITEM|COURSE_TYPE|QUOTA
  legacyCode: varchar('legacyCode', { length: 100 }).notNull(),
  legacyTitle: varchar('legacyTitle', { length: 250 }),
  targetId: integer('targetId'),                              // شناسهٔ رکورد متناظر در سامانهٔ جدید
  targetCode: varchar('targetCode', { length: 100 }),         // کد/مقدار متناظر (برای فهرست‌های ثابت)
  targetTitle: varchar('targetTitle', { length: 250 }),
  confidence: numeric('confidence', { precision: 5, scale: 2 }).default('0'),
  status: varchar('status', { length: 20 }).notNull().default('UNMAPPED'), // UNMAPPED|SUGGESTED|CONFIRMED|IGNORED
  note: text('note'),
  updatedByUserId: integer('updatedByUserId'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow()
}, (t) => ({ uq: unique('uq_legacy_code_maps').on(t.sourceCode, t.domain, t.legacyCode) }));

/** فرمول شهریهٔ سیستم قدیمی (قابل ارزیابی و مقایسه با دادهٔ مالی قدیمی) */
export const legacy_tuition_formulas = pgTable('legacy_tuition_formulas', {
  id: serial('id').primaryKey(),
  sourceCode: varchar('sourceCode', { length: 50 }).notNull().default('LEGACY'),
  formulaCode: varchar('formulaCode', { length: 60 }).notNull(),
  title: varchar('title', { length: 200 }),
  termCode: varchar('termCode', { length: 10 }),              // خام از سیستم قدیمی (خالی = همهٔ ترم‌ها)
  degreeCode: varchar('degreeCode', { length: 60 }),          // کد مقطع قدیمی
  majorCode: varchar('majorCode', { length: 60 }),            // کد رشتهٔ قدیمی
  entryYearFrom: integer('entryYearFrom'),
  entryYearTo: integer('entryYearTo'),
  fixedAmount: numeric('fixedAmount', { precision: 14, scale: 0 }).notNull().default('0'),
  perUnitTheory: numeric('perUnitTheory', { precision: 14, scale: 0 }).notNull().default('0'),
  perUnitPractical: numeric('perUnitPractical', { precision: 14, scale: 0 }).notNull().default('0'),
  perUnitGeneral: numeric('perUnitGeneral', { precision: 14, scale: 0 }).notNull().default('0'),
  expression: text('expression'),                             // فرمول متنی اختیاری (اولویت با آن)
  variables: text('variables'),                               // JSON متغیرهای کمکی {"ضریب":1.2}
  isActive: integer('isActive').notNull().default(1),
  note: text('note'),
  createdByUserId: integer('createdByUserId'),
  createdAt: timestamp('createdAt').defaultNow()
}, (t) => ({ uq: unique('uq_legacy_tuition_formulas').on(t.sourceCode, t.formulaCode, t.termCode) }));

/** صورت‌حساب/شهریهٔ واقعیِ ثبت‌شده در سیستم قدیمی — مبنای مقایسه */
export const legacy_financial_records = pgTable('legacy_financial_records', {
  id: serial('id').primaryKey(),
  sourceCode: varchar('sourceCode', { length: 50 }).notNull().default('LEGACY'),
  studentCode: varchar('studentCode', { length: 20 }).notNull(),
  studentName: varchar('studentName', { length: 150 }),
  termCode: varchar('termCode', { length: 10 }).notNull(),
  formulaCode: varchar('formulaCode', { length: 60 }),
  degreeCode: varchar('degreeCode', { length: 60 }),
  majorCode: varchar('majorCode', { length: 60 }),
  entryYear: integer('entryYear'),
  totalUnits: numeric('totalUnits', { precision: 6, scale: 2 }).default('0'),
  theoryUnits: numeric('theoryUnits', { precision: 6, scale: 2 }).default('0'),
  practicalUnits: numeric('practicalUnits', { precision: 6, scale: 2 }).default('0'),
  generalUnits: numeric('generalUnits', { precision: 6, scale: 2 }).default('0'),
  legacyTuition: numeric('legacyTuition', { precision: 14, scale: 0 }).notNull().default('0'),
  legacyDiscount: numeric('legacyDiscount', { precision: 14, scale: 0 }).notNull().default('0'),
  legacyPaid: numeric('legacyPaid', { precision: 14, scale: 0 }).notNull().default('0'),
  batchId: integer('batchId'),                                 // دستهٔ واردسازی (برای واگرد)
  raw: text('raw'),                                            // JSON ردیف خام برای رهگیری
  /** دانشگاه مالک این ردیف — هویت = (universityId + studentCode + termCode) */
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  importedAt: timestamp('importedAt').defaultNow()
}, (t) => ({ uq: unique('uq_legacy_financial_records').on(t.sourceCode, t.studentCode, t.termCode) }));

/** اجرای مقایسهٔ شهریه: فرمول‌های منتقل‌شده در برابر دادهٔ مالی قدیمی */
export const tuition_compare_runs = pgTable('tuition_compare_runs', {
  id: serial('id').primaryKey(),
  sourceCode: varchar('sourceCode', { length: 50 }).notNull().default('LEGACY'),
  termCode: varchar('termCode', { length: 10 }),
  tolerance: numeric('tolerance', { precision: 14, scale: 0 }).notNull().default('0'),
  totalRows: integer('totalRows').default(0),
  matched: integer('matched').default(0),
  mismatched: integer('mismatched').default(0),
  unresolved: integer('unresolved').default(0),
  sumLegacy: numeric('sumLegacy', { precision: 16, scale: 0 }).default('0'),
  sumComputed: numeric('sumComputed', { precision: 16, scale: 0 }).default('0'),
  sumDiff: numeric('sumDiff', { precision: 16, scale: 0 }).default('0'),
  createdByUserId: integer('createdByUserId'),
  createdAt: timestamp('createdAt').defaultNow()
});

export const tuition_compare_items = pgTable('tuition_compare_items', {
  id: serial('id').primaryKey(),
  runId: integer('runId').notNull().references(() => tuition_compare_runs.id),
  studentCode: varchar('studentCode', { length: 20 }).notNull(),
  studentName: varchar('studentName', { length: 150 }),
  termCode: varchar('termCode', { length: 10 }),
  formulaCode: varchar('formulaCode', { length: 60 }),
  totalUnits: numeric('totalUnits', { precision: 6, scale: 2 }).default('0'),
  legacyAmount: numeric('legacyAmount', { precision: 14, scale: 0 }).default('0'),
  computedAmount: numeric('computedAmount', { precision: 14, scale: 0 }).default('0'),
  diff: numeric('diff', { precision: 14, scale: 0 }).default('0'),
  status: varchar('status', { length: 20 }).notNull(),        // MATCH | DIFF | NO_FORMULA | ERROR
  resolutionStatus: varchar('resolutionStatus', { length: 20 }).notNull().default('UNRESOLVED'), // UNRESOLVED|MATCHED|DISCREPANCY|FORCED_LEGACY
  resolvedAt: timestamp('resolvedAt'),
  detail: text('detail')
});

/** نمرات سیستم قدیمی (staging) — قبل از اعمال، با سامانهٔ جدید مقایسه می‌شود */
export const legacy_grades = pgTable('legacy_grades', {
  id: serial('id').primaryKey(),
  sourceCode: varchar('sourceCode', { length: 50 }).notNull().default('LEGACY'),
  studentCode: varchar('studentCode', { length: 20 }).notNull(),
  studentName: varchar('studentName', { length: 150 }),
  termCode: varchar('termCode', { length: 10 }).notNull(),
  courseCode: varchar('courseCode', { length: 40 }).notNull(),
  courseTitle: varchar('courseTitle', { length: 200 }),
  units: numeric('units', { precision: 5, scale: 2 }),
  gradeRaw: varchar('gradeRaw', { length: 40 }),              // مقدار خام («۱۷.۵»، «قبول»، «الف»)
  gradeValue: numeric('gradeValue', { precision: 5, scale: 2 }),
  gradeStatus: varchar('gradeStatus', { length: 20 }).notNull().default('FINALIZED'),
  professorName: varchar('professorName', { length: 150 }),
  batchId: integer('batchId'),                                 // دستهٔ واردسازی (برای واگرد)
  compareStatus: varchar('compareStatus', { length: 20 }).default('PENDING'), // PENDING|SAME|DIFF|MISSING_IN_NEW|NO_STUDENT|NO_TERM
  compareNote: text('compareNote'),
  appliedAt: timestamp('appliedAt'),
  raw: text('raw'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  importedAt: timestamp('importedAt').defaultNow()
}, (t) => ({ uq: unique('uq_legacy_grades').on(t.sourceCode, t.studentCode, t.termCode, t.courseCode) }));

// ── دسته‌های واردسازی: هر فایل اکسل = یک batch با سطرهای خام JSON ──
// چرا خام نگه می‌داریم: اگر بعداً نگاشت کدی اصلاح شد، بدون آپلود دوبارهٔ فایل
// می‌توان فقط ردیف‌های خطادار را دوباره پردازش کرد؛ و برای «واگرد» سند داریم.
export const legacy_import_batches = pgTable('legacy_import_batches', {
  id: serial('id').primaryKey(),
  sourceCode: varchar('sourceCode', { length: 50 }).notNull().default('LEGACY'),
  importType: varchar('importType', { length: 40 }).notNull(),
  fileName: varchar('fileName', { length: 255 }),
  sheetName: varchar('sheetName', { length: 120 }),
  headers: text('headers'),                                   // JSON: سرستون‌های فایل
  columnMap: text('columnMap'),                               // JSON: نگاشت دستی ستون‌ها {فیلد: شمارهٔ ستون}
  totalRows: integer('totalRows').notNull().default(0),
  okRows: integer('okRows').notNull().default(0),
  errorRows: integer('errorRows').notNull().default(0),
  status: varchar('status', { length: 20 }).notNull().default('PARSED'), // PARSED|PROCESSED|PARTIAL|ROLLED_BACK
  note: text('note'),
  createdByUserId: integer('createdByUserId'),
  createdAt: timestamp('createdAt').defaultNow(),
  processedAt: timestamp('processedAt'),
  rolledBackAt: timestamp('rolledBackAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const legacy_import_rows = pgTable('legacy_import_rows', {
  id: serial('id').primaryKey(),
  batchId: integer('batchId').notNull().references(() => legacy_import_batches.id, { onDelete: 'cascade' }),
  rowNumber: integer('rowNumber').notNull(),                  // شمارهٔ خط در فایل (۱ = سرستون)
  rawData: jsonb('rawData').notNull(),                        // کل سطر اکسل، خام
  validationStatus: varchar('validationStatus', { length: 20 }).notNull().default('PENDING'), // PENDING|IMPORTED|ERROR|SKIPPED
  errorMessage: text('errorMessage'),
  processedAt: timestamp('processedAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ── دفتر واگرد: هر نوشتن روی جدول‌های عملیاتی اینجا سند می‌خورد ──
export const migration_audit_entries = pgTable('migration_audit_entries', {
  id: serial('id').primaryKey(),
  batchId: integer('batchId'),                                // ممکن است عملیات بدون فایل باشد (اعمال نمره/تراز)
  opGroup: varchar('opGroup', { length: 40 }).notNull(),      // apply-grades | apply-formulas | opening-balance | commit-student…
  sourceCode: varchar('sourceCode', { length: 50 }).notNull().default('LEGACY'),
  tableName: varchar('tableName', { length: 60 }).notNull(),
  rowId: integer('rowId').notNull(),
  op: varchar('op', { length: 10 }).notNull(),                // INSERT | UPDATE
  beforeData: jsonb('beforeData'),                            // مقدار پیشین برای UPDATE
  afterData: jsonb('afterData'),                              // مقداری که مهاجرت نوشت (برای تشخیص تغییرِ بعدی)
  revertedAt: timestamp('revertedAt'),
  revertNote: text('revertNote'),
  createdByUserId: integer('createdByUserId'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ═══════════════════════════════════════════════════════════════════
//  چنددانشگاهی + ثمین (سازمان امور دانشجویان)
//  هر دانشگاه منحل‌شده با کد و کلید جدا؛ آینده با افزودن یک ردیف
// ═══════════════════════════════════════════════════════════════════

export const universities = pgTable('universities', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 30 }).notNull().unique(), // ZARINE, ALLAME, SHAMS, NAZHAND, AFAGH
  title: varchar('title', { length: 150 }).notNull(),
  kind: varchar('kind', { length: 20 }).notNull().default('DISSOLVED'), // OWN | DISSOLVED | MERGED
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'), // ACTIVE | ARCHIVED
  saminCode: varchar('saminCode', { length: 20 }), // کد ثمین sender_university
  logoUrl: varchar('logoUrl', { length: 255 }), // ارم اختصاصی هر دانشگاه (کارنامه/مدارک)؛ خالی = ارم سراسری تنظیمات
  province: varchar('province', { length: 80 }),
  dissolvedAt: varchar('dissolvedAt', { length: 10 }),
  note: text('note'),
  brandJson: jsonb('brand_json'), // برندینگ اختصاصی (بازنویسیِ UNI_THEMES؛ NULL = تمِ پیش‌فرض)
  isActive: integer('isActive').notNull().default(1),
  createdAt: timestamp('createdAt').defaultNow()
});

export const samin_connections = pgTable('samin_connections', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').notNull().unique().references(() => universities.id, { onDelete: 'cascade' }),
  apiBaseUrl: varchar('apiBaseUrl', { length: 255 }).notNull().default('https://apim.saorg.ir'),
  authBaseUrl: varchar('authBaseUrl', { length: 255 }).notNull().default('https://apiauth.saorg.ir/oauth2/token'),
  clientId: varchar('clientId', { length: 200 }),
  clientSecretEnc: text('clientSecretEnc'), // AES-256-GCM
  username: varchar('username', { length: 150 }),
  passwordEnc: text('passwordEnc'),
  tokenEnc: text('tokenEnc'),
  tokenExpiresAt: timestamp('tokenExpiresAt'),
  lastSyncAt: timestamp('lastSyncAt'),
  isEnabled: integer('isEnabled').notNull().default(1),
  updatedAt: timestamp('updatedAt').defaultNow()
});

export const samin_staging = pgTable('samin_staging', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').notNull().references(() => universities.id, { onDelete: 'cascade' }),
  entityCode: varchar('entityCode', { length: 20 }).notNull(), // 2001/1000/...
  personPkInSource: varchar('personPkInSource', { length: 40 }),
  studentPkInSource: varchar('studentPkInSource', { length: 40 }),
  payload: jsonb('payload').notNull(), // JSON کامل ثمین
  status: varchar('status', { length: 20 }).notNull().default('PENDING'), // PENDING|READY|SENT|ACCEPTED|FAILED
  traceId: integer('traceId'),
  errorMessage: text('errorMessage'),
  createdAt: timestamp('createdAt').defaultNow(),
  sentAt: timestamp('sentAt')
}, (t) => ({ uq: unique('uq_samin_staging').on(t.universityId, t.entityCode, t.personPkInSource) }));

export const samin_sync_logs = pgTable('samin_sync_logs', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').notNull().references(() => universities.id, { onDelete: 'cascade' }),
  entityCode: varchar('entityCode', { length: 20 }).notNull(),
  traceId: integer('traceId'),
  status: varchar('status', { length: 20 }).notNull(), // ACCEPTED|REJECTED|PENDING...
  summaryResult: jsonb('summaryResult'),
  rawResponse: text('rawResponse'),
  createdAt: timestamp('createdAt').defaultNow()
});

// ═══════════════════════════════════════════════════════════════════
//  ماژول ۱۲: فارغ‌التحصیلی، صدور مدارک و پورتال دانش‌آموختگان
//  الگو: «رویدادمحور» — دانشجو هیچ درخواستی باز نمی‌کند؛ با قطعی‌شدن
//  آخرین نمره، سیستم خودش پرونده را باز و مراحل را جلو می‌برد.
// ═══════════════════════════════════════════════════════════════════

/** دپارتمان‌های تسویه‌حساب — قابل تعریف از پنل مدیر (هیچ فهرست ثابتی در کد نیست) */
export const clearance_departments = pgTable('clearance_departments', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 40 }).notNull().unique(),   // LIBRARY / FINANCE / DORMITORY / …
  title: varchar('title', { length: 120 }).notNull(),
  /** منبع بررسی خودکار: NONE (کارشناس) | FINANCE_LEDGER (دفتر مالی) | HTTP_API (سرویس بیرونی) */
  autoCheck: varchar('autoCheck', { length: 30 }).notNull().default('NONE'),
  apiUrl: varchar('apiUrl', { length: 500 }),                 // برای HTTP_API
  responsibleRoleCode: varchar('responsibleRoleCode', { length: 40 }),
  sortOrder: integer('sortOrder').notNull().default(100),
  isActive: integer('isActive').notNull().default(1),
  hint: text('hint'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

/** پروندهٔ فارغ‌التحصیلی هر دانشجو (یک ردیف به‌ازای هر دانشجو) */
export const graduation_audits = pgTable('graduation_audits', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  // CATALOG_REVIEW → HEAD_APPROVAL → IRANDOC_VERIFICATION → CLEARANCE → FINAL_DOCS → READY_TO_ISSUE → ISSUED
  workflowStatus: varchar('workflowStatus', { length: 40 }).notNull().default('CATALOG_REVIEW'),
  // ── نتیجهٔ تطبیق خودکار با سرفصل ──
  requiredUnits: numeric('requiredUnits', { precision: 6, scale: 2 }).default('0'),
  passedUnits: numeric('passedUnits', { precision: 6, scale: 2 }).default('0'),
  gpa: numeric('gpa', { precision: 4, scale: 2 }),
  missingCourses: jsonb('missingCourses'),                    // [{code,title,units}]
  catalogOk: integer('catalogOk').notNull().default(0),
  // ── تأیید مدیر گروه ──
  headApprovalStatus: integer('headApprovalStatus').notNull().default(0),
  headApprovedBy: integer('headApprovedBy'),
  headApprovedAt: timestamp('headApprovedAt'),
  headNote: text('headNote'),
  // ── ایرانداک (ارشد/دکتری) ──
  thesisRequired: integer('thesisRequired').notNull().default(0),
  thesisTitle: varchar('thesisTitle', { length: 300 }),
  irandocTrackingCode: varchar('irandocTrackingCode', { length: 60 }),
  irandocSimilarityScore: numeric('irandocSimilarityScore', { precision: 5, scale: 2 }),
  irandocStatus: varchar('irandocStatus', { length: 30 }).default('PENDING'), // PENDING|PASSED|REJECTED|SKIPPED
  irandocCheckedAt: timestamp('irandocCheckedAt'),
  // ── درخواست کد صحت در سامانهٔ سجاد (اقدام خودِ دانشجو، پیش از کارشناس صدور) ──
  sajjadStatus: varchar('sajjadStatus', { length: 30 }).default('PENDING'),   // PENDING|SUBMITTED|CONFIRMED|SKIPPED
  sajjadRequestCode: varchar('sajjadRequestCode', { length: 60 }),            // کد رهگیری درخواست دانشجو در سجاد
  sajjadRequestedAt: timestamp('sajjadRequestedAt'),
  sajjadConfirmedAt: timestamp('sajjadConfirmedAt'),
  // ── مدارک پایانی که فقط اینجا از دانشجو خواسته می‌شود ──
  photoDocumentId: integer('photoDocumentId'),
  stampFeePaid: integer('stampFeePaid').notNull().default(0),
  stampFeeAmount: numeric('stampFeeAmount', { precision: 12, scale: 0 }).default('0'),
  finalDocsAt: timestamp('finalDocsAt'),
  // ── عمومی ──
  graduationTermId: integer('graduationTermId').references(() => academic_terms.id),
  note: text('note'),
  startedAt: timestamp('startedAt').defaultNow(),
  lastEventAt: timestamp('lastEventAt').defaultNow(),
  completedAt: timestamp('completedAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({ uq: unique('uq_graduation_audits_student').on(t.studentId) }));

/** پیشرفت پایان‌نامه (فاز ۱ تا ۳) — برای مقاطع ارشد/دکتری */
export const thesis_progress = pgTable('thesis_progress', {
  id: serial('id').primaryKey(),
  auditId: integer('auditId').notNull().references(() => graduation_audits.id),
  studentId: integer('studentId').notNull().references(() => students.id),

  // Phase 1: Supervisor & Title
  supervisorId: integer('supervisorId').references(() => staff.id),
  advisorId: integer('advisorId').references(() => staff.id),
  titleFa: varchar('titleFa', { length: 300 }),
  titleEn: varchar('titleEn', { length: 300 }),
  keywords: text('keywords'),
  abstract: text('abstract'),

  // Irandoc prior-check
  irandocPriorTracking: varchar('irandocPriorTracking', { length: 60 }),
  irandocPriorSimilarity: numeric('irandocPriorSimilarity', { precision: 5, scale: 2 }),
  irandocPriorStatus: varchar('irandocPriorStatus', { length: 30 }).default('PENDING'), // PENDING|PASSED|REJECTED|SKIPPED
  irandocPriorCheckedAt: timestamp('irandocPriorCheckedAt'),

  // Phase 2: Proposal
  proposalFileId: integer('proposalFileId'),
  proposalSubmittedAt: timestamp('proposalSubmittedAt'),
  proposalSimilarity: numeric('proposalSimilarity', { precision: 5, scale: 2 }),
  proposalStatus: varchar('proposalStatus', { length: 30 }).default('NOT_STARTED'), // NOT_STARTED|SUBMITTED|SIMILARITY_CHECK|SIMILARITY_PASSED|SIMILARITY_HIGH|EXPERT_REVIEW|APPROVED|REJECTED|PRIOR_REJECTED
  proposalApprovedAt: timestamp('proposalApprovedAt'),
  proposalApprovedBy: integer('proposalApprovedBy').references(() => users.id),

  // Irandoc upload after approval
  irandocUploadTracking: varchar('irandocUploadTracking', { length: 60 }),
  irandocUploadStatus: varchar('irandocUploadStatus', { length: 30 }).default('PENDING'), // PENDING|UPLOADED|CERTIFICATE_ISSUED
  irandocCertificateFileId: integer('irandocCertificateFileId'),
  irandocUploadedAt: timestamp('irandocUploadedAt'),

  // Phase 3: Progress Reports
  lastProgressReportAt: timestamp('lastProgressReportAt'),
  nextProgressReportDue: timestamp('nextProgressReportDue'),
  progressReportCount: integer('progressReportCount').default(0),

  // Defense Request
  defenseRequestedAt: timestamp('defenseRequestedAt'),
  defenseRequestStatus: varchar('defenseRequestStatus', { length: 30 }).default('NOT_REQUESTED'), // NOT_REQUESTED|SUPERVISOR_REVIEW|SUPERVISOR_REJECTED|EXPERT_REVIEW|SCHEDULED|CONDUCTED|PASSED|FAILED
  defenseRoomId: integer('defenseRoomId').references(() => classrooms.id),
  defenseScheduledAt: timestamp('defenseScheduledAt'),
  defenseConductedAt: timestamp('defenseConductedAt'),
  defenseResult: varchar('defenseResult', { length: 30 }), // PASSED|FAILED|CONDITIONAL
  defenseNote: text('defenseNote'),

  // Final Thesis
  finalThesisFileId: integer('finalThesisFileId'),
  finalThesisSubmittedAt: timestamp('finalThesisSubmittedAt'),
  finalIrandocTracking: varchar('finalIrandocTracking', { length: 60 }),
  finalIrandocSimilarity: numeric('finalIrandocSimilarity', { precision: 5, scale: 2 }),
  finalIrandocStatus: varchar('finalIrandocStatus', { length: 30 }).default('PENDING'), // PENDING|PASSED|REJECTED
  finalIrandocCheckedAt: timestamp('finalIrandocCheckedAt'),

  // Jury
  juryChairId: integer('juryChairId').references(() => staff.id),
  jurySupervisorId: integer('jurySupervisorId').references(() => staff.id),
  juryInternalId: integer('juryInternalId').references(() => staff.id),
  juryExternalId: integer('juryExternalId').references(() => staff.id),

  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({
  uq: unique('uq_thesis_progress_audit').on(t.auditId),
  idxStudent: index('idx_thesis_progress_student').on(t.studentId),
  idxStatus: index('idx_thesis_progress_status').on(t.proposalStatus, t.defenseRequestStatus),
}));

/** گزارش‌های پیشرفت ۳/۶ ماهه */
export const thesis_progress_reports = pgTable('thesis_progress_reports', {
  id: serial('id').primaryKey(),
  thesisProgressId: integer('thesisProgressId').notNull().references(() => thesis_progress.id, { onDelete: 'cascade' }),
  studentId: integer('studentId').notNull().references(() => students.id),
  reportPeriodStart: date('reportPeriodStart').notNull(),
  reportPeriodEnd: date('reportPeriodEnd').notNull(),
  reportText: text('reportText').notNull(),
  supervisorConfirmed: integer('supervisorConfirmed').default(0),
  supervisorConfirmedAt: timestamp('supervisorConfirmedAt'),
  fileId: integer('fileId'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({
  uq: unique('uq_thesis_report_period').on(t.thesisProgressId, t.reportPeriodStart, t.reportPeriodEnd),
}));

/** استخر هیأت داوران دفاع (برای تخصیص خودکار) */
export const defense_jury_pools = pgTable('defense_jury_pools', {
  id: serial('id').primaryKey(),
  departmentCode: varchar('departmentCode', { length: 40 }).notNull(),
  majorId: integer('majorId').references(() => majors.id),
  chairId: integer('chairId').references(() => staff.id),
  internalIds: integer('internalIds').array().default(sql`'{}'`),
  externalIds: integer('externalIds').array().default(sql`'{}'`),
  roomId: integer('roomId').references(() => classrooms.id),
  isActive: integer('isActive').default(1),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

/** جلسات دفاع (برنامه‌ریزی شده) */
export const defense_sessions = pgTable('defense_sessions', {
  id: serial('id').primaryKey(),
  thesisProgressId: integer('thesisProgressId').notNull().references(() => thesis_progress.id),
  studentId: integer('studentId').notNull().references(() => students.id),
  scheduledAt: timestamp('scheduledAt').notNull(),
  roomId: integer('roomId').references(() => classrooms.id),
  chairId: integer('chairId').references(() => staff.id),
  supervisorId: integer('supervisorId').references(() => staff.id),
  internalId: integer('internalId').references(() => staff.id),
  externalId: integer('externalId').references(() => staff.id),
  status: varchar('status', { length: 30 }).default('SCHEDULED'), // SCHEDULED|CONDUCTED|CANCELLED|RESCHEDULED
  result: varchar('result', { length: 30 }), // PASSED|FAILED|CONDITIONAL
  minutes: text('minutes'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({
  uq: unique('uq_defense_session_progress').on(t.thesisProgressId),
}));

/** لاگ استعلام‌های ایرانداک */
export const irandoc_logs = pgTable('irandoc_logs', {
  id: serial('id').primaryKey(),
  thesisProgressId: integer('thesisProgressId').references(() => thesis_progress.id),
  studentId: integer('studentId').notNull().references(() => students.id),
  checkType: varchar('checkType', { length: 30 }).notNull(), // PRIOR|PROPOSAL|FINAL
  trackingCode: varchar('trackingCode', { length: 60 }),
  title: varchar('title', { length: 300 }),
  similarityPercentage: numeric('similarityPercentage', { precision: 5, scale: 2 }),
  decision: varchar('decision', { length: 30 }), // AUTO_APPROVE|MANUAL_REVIEW|REJECT
  rawResponse: jsonb('rawResponse'),
  checkedAt: timestamp('checkedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({
  idxStudentType: index('idx_irandoc_logs_student_type').on(t.studentId, t.checkType),
}));

/** چک‌لیست تسویه‌حساب موازی (یک ردیف به‌ازای هر دپارتمان برای هر دانشجو) */
export const clearance_checklist = pgTable('clearance_checklist', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  auditId: integer('auditId').references(() => graduation_audits.id),
  department: varchar('department', { length: 40 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'), // PENDING|CLEARED|HAS_DEBT|WAIVED
  amountDue: numeric('amountDue', { precision: 14, scale: 0 }).default('0'),
  detail: text('detail'),
  autoChecked: integer('autoChecked').notNull().default(0),
  resolvedBy: integer('resolvedBy'),
  resolvedAt: timestamp('resolvedAt'),
  notifiedAt: timestamp('notifiedAt'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({ uq: unique('uq_clearance_checklist').on(t.studentId, t.department) }));

/** مدارک صادرشده: گواهینامهٔ موقت، دانشنامه، ریزنمرات رسمی */
export const issued_degrees = pgTable('issued_degrees', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  degreeType: varchar('degreeType', { length: 30 }).notNull(), // TEMPORARY|PERMANENT|TRANSCRIPT
  serialNo: varchar('serialNo', { length: 60 }).notNull().unique(),
  verifyCode: varchar('verifyCode', { length: 40 }).notNull().unique(), // مبنای QR استعلام عمومی
  ministryVerificationCode: varchar('ministryVerificationCode', { length: 60 }), // کد صحت وزارت علوم
  documentHash: varchar('documentHash', { length: 255 }).notNull(),
  snapshot: jsonb('snapshot'),                                 // نام، رشته، معدل، تاریخ — لحظهٔ صدور
  issuedByUserId: integer('issuedByUserId'),
  issuedAt: timestamp('issuedAt').defaultNow().notNull(),
  isDelivered: integer('isDelivered').notNull().default(0),
  deliveredAt: timestamp('deliveredAt'),
  deliveredTo: varchar('deliveredTo', { length: 150 }),
  revokedAt: timestamp('revokedAt'),
  revokeReason: text('revokeReason'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}); /** پروفایل دانش‌آموخته (پورتال آلومنای) */
export const alumni_profiles = pgTable('alumni_profiles', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  employmentStatus: varchar('employmentStatus', { length: 40 }), // EMPLOYED|SEEKING|STUDYING|SELF_EMPLOYED
  organization: varchar('organization', { length: 150 }),
  jobTitle: varchar('jobTitle', { length: 150 }),
  contactEmail: varchar('contactEmail', { length: 150 }),
  contactMobile: varchar('contactMobile', { length: 11 }),
  linkedinUrl: varchar('linkedinUrl', { length: 300 }),
  allowContact: integer('allowContact').notNull().default(1),
  updatedAt: timestamp('updatedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({ uq: unique('uq_alumni_profiles_student').on(t.studentId) }));

/** درخواست‌های خدمات دانش‌آموختگان (ریزنمرات رسمی، آزادسازی مدرک، تأییدیه ترجمه) */
export const alumni_requests = pgTable('alumni_requests', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  requestType: varchar('requestType', { length: 40 }).notNull(), // OFFICIAL_TRANSCRIPT|DEGREE_RELEASE|TRANSLATION_CONFIRM|DUPLICATE_DEGREE
  trackingCode: varchar('trackingCode', { length: 30 }).notNull().unique(),
  status: varchar('status', { length: 30 }).notNull().default('AWAITING_PAYMENT'), // AWAITING_PAYMENT|PAID|IN_REVIEW|DONE|REJECTED
  fee: numeric('fee', { precision: 12, scale: 0 }).default('0'),
  paidAt: timestamp('paidAt'),
  ledgerId: integer('ledgerId'),
  destination: varchar('destination', { length: 200 }),        // دارالترجمه / سازمان مقصد
  description: text('description'),
  resultFileUrl: varchar('resultFileUrl', { length: 500 }),
  handledBy: integer('handledBy'),
  adminNote: text('adminNote'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ═══ کانال‌های اعلان بیرونی (پیامک و پیام‌رسان‌ها) ═══

/** نشانی هر کاربر در هر پیام‌رسان (شناسهٔ چت ربات) — کاربر خودش ثبت می‌کند */
export const notification_channels = pgTable('notification_channels', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull().references(() => users.id),
  channel: varchar('channel', { length: 20 }).notNull(),      // SMS|TELEGRAM|BALE|EITAA
  address: varchar('address', { length: 120 }).notNull(),     // شمارهٔ موبایل یا chat id
  isActive: integer('isActive').notNull().default(1),
  verifiedAt: timestamp('verifiedAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow()
}, (t) => ({ uq: unique('uq_notification_channels').on(t.userId, t.channel) }));

// ═══ توکن‌های اتصال پیام‌رسان (پیوند امن بدون رمز عبور در چت) ═══
//
//  جریان: کاربر وارد پورتال می‌شود → mintLinkToken (کد انسانی + دیپ‌لینک)
//  → در بات /start <token> می‌فرستد (poll worker ثبت PENDING می‌کند)
//  → کاربر در پورتال confirmLink را می‌زند → verifiedAt=now.
//  کد/توکن خام هرگز ذخیره نمی‌شود؛ فقط sha256 آن‌ها.
export const messenger_link_tokens = pgTable('messenger_link_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channel: varchar('channel', { length: 20 }).notNull(),      // TELEGRAM|BALE|EITAA (SOROUSH|IGAP فریز)
  tokenHash: varchar('tokenHash', { length: 64 }).notNull(),  // sha256 hex توکن کامل دیپ‌لینک
  codeHash: varchar('codeHash', { length: 64 }).notNull(),    // sha256 hex کد انسانی کوتاه
  pendingChatId: varchar('pendingChatId', { length: 64 }),    // chatId ثبت‌شده از پیام /start (تا تأیید نهایی)
  expiresAt: timestamp('expiresAt').notNull(),
  usedAt: timestamp('usedAt'),
  attempts: integer('attempts').notNull().default(0),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow(),
}, (t) => ({
  tokenHx: index('ix_messenger_link_tokens_token').on(t.tokenHash),
  codeHx: index('ix_messenger_link_tokens_code').on(t.codeHash),
}));

// ═══ آفست poll پیام‌رسان‌ها (getUpdates بله/ایتا) ═══
export const messenger_poll_offsets = pgTable('messenger_poll_offsets', {
  channel: varchar('channel', { length: 20 }).primaryKey(),   // BALE|EITAA
  offset: integer('offset').notNull().default(0),
  updatedAt: timestamp('updatedAt').defaultNow(),
});

// ═══ رویدادهای موتور گردش کار (Workflow Event Bus) ═══
// موتور BPM فقط وضعیت‌ها را جابه‌جا می‌کند؛ اثر تجاری هر فرایند (مثلاً ثبت درس
// تطبیق‌داده‌شده در کارنامه) در «هندلر» همان ماژول اجرا می‌شود. رویداد پیش از
// commitِ تراکنشِ گردش کار به‌صورت PENDING ثبت می‌شود تا اگر سرویس وسط کار
// خاموش شد، رد آن در دیتابیس باشد و بتوان دوباره اجرا/واگرد کرد.

/** رویدادهای شلیک‌شده توسط موتور گردش کار و نتیجهٔ پردازش هر هندلر */
export const workflow_events = pgTable('workflow_events', {
  id: serial('id').primaryKey(),
  requestId: integer('requestId').notNull().references(() => student_requests.id),
  processCode: varchar('processCode', { length: 50 }).notNull(),
  eventCode: varchar('eventCode', { length: 60 }).notNull(),   // WORKFLOW_FINAL_APPROVED | WORKFLOW_REJECTED | ...
  payload: text('payload'),                                   // JSON — دادهٔ مورد نیاز هندلرها
  handler: varchar('handler', { length: 60 }).notNull(),      // نام هندلر (مثلاً COURSE_TRANSFER)
  status: varchar('status', { length: 20 }).notNull().default('PENDING'), // PENDING|PROCESSED|FAILED|SKIPPED
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  firedAt: timestamp('firedAt').defaultNow(),
  processedAt: timestamp('processedAt')
});

// ═══ گزارش تحویل پیام‌های بیرونی ═══

/** گزارش تحویل هر پیام بیرونی — برای پیگیری و ممیزی */
export const notification_deliveries = pgTable('notification_deliveries', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull().references(() => users.id),
  notificationId: integer('notificationId'),
  eventCode: varchar('eventCode', { length: 60 }),
  channel: varchar('channel', { length: 20 }).notNull(),
  target: varchar('target', { length: 120 }),
  status: varchar('status', { length: 20 }).notNull(),        // SENT|FAILED|SKIPPED
  providerRef: varchar('providerRef', { length: 120 }),
  error: text('error'),
  body: text('body'),
  durationMs: integer('durationMs'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow()
});

// ═══ حافظهٔ گزارش‌های تحلیلی (BI Snapshot Cache) ═══
// گزارش‌های هوش تجاری (داشبورد مدیریتی، تحلیل امکانات، ابر کلمات) روی کل
// پاسخ‌های ارزشیابی محاسبه می‌شوند. در پایان ترم این حجم زیاد است، پس نتیجه
// اینجا کش می‌شود: خواندن داشبورد = یک SELECT، و محاسبهٔ سنگین فقط توسط
// job زمان‌بندی‌شده (/api/cron/bi-refresh) یا اولین درخواستِ منقضی‌شده انجام
// می‌شود. هرگز در حلقهٔ رویداد سرور وب پردازش متن اجرا نمی‌شود.

/** نتیجهٔ کش‌شدهٔ یک گزارش تحلیلی */
export const analytics_snapshots = pgTable('analytics_snapshots', {
  id: serial('id').primaryKey(),
  cacheKey: varchar('cacheKey', { length: 160 }).notNull().unique(),
  reportType: varchar('reportType', { length: 60 }).notNull(),   // MANAGEMENT_OVERVIEW | FACILITIES | WORDCLOUD | ...
  payload: text('payload').notNull(),                            // JSON نتیجه
  rowCount: integer('rowCount'),                                 // برای پایش حجم گزارش
  durationMs: integer('durationMs'),                             // هزینهٔ محاسبهٔ آخرین بار
  computedAt: timestamp('computedAt').notNull().defaultNow(),
  expiresAt: timestamp('expiresAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ══════════════════════════════════════════════════════════════════════
//  موتور مالی دانشجویان — تخفیف، حامی (بنیاد)، چک، وام و فرمول تخصیص
//
//  هیچ عنوان، درصد یا مبلغی در کد سخت‌کد نیست: انواع تخفیف، بنیادها و
//  فرمول‌ها همه ردیف دیتابیسی‌اند و از پنل کارشناس مالی مدیریت می‌شوند.
// ══════════════════════════════════════════════════════════════════════

/**
 * انواع تخفیف شهریه — فهرست قابل تنظیم توسط کارشناس مالی.
 * نمونه: رتبهٔ برتر، قهرمان ورزشی، فعال فرهنگی، خانوادهٔ چنددانشجویی.
 */
export const tuition_discount_types = pgTable('tuition_discount_types', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 40 }).notNull().unique(),
  title: varchar('title', { length: 150 }).notNull(),
  /** PERCENT = درصدی از شهریه | FIXED = مبلغ ثابت ریالی */
  kind: varchar('kind', { length: 20 }).notNull().default('PERCENT'),
  defaultPercent: numeric('defaultPercent', { precision: 5, scale: 2 }).notNull().default('0'),
  defaultAmount: numeric('defaultAmount', { precision: 12, scale: 0 }).notNull().default('0'),
  /** سقف درصد مجاز؛ NULL = بدون سقف */
  maxPercent: numeric('maxPercent', { precision: 5, scale: 2 }),
  requiresApproval: integer('requiresApproval').notNull().default(1),
  requiresDocument: integer('requiresDocument').notNull().default(0),
  isActive: integer('isActive').notNull().default(1),
  note: text('note'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow()
});

/** اطلاعیه‌های صفحه ورود — universityId خالی = سراسری (همه دانشگاه‌ها) */
export const login_notices = pgTable('login_notices', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').references(() => universities.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 150 }).notNull(),
  body: text('body').notNull().default(''),
  kind: varchar('kind', { length: 20 }).notNull().default('info'), // info | warning | important
  isActive: integer('isActive').notNull().default(1),
  sortOrder: integer('sortOrder').notNull().default(0),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (t) => [
  index('idx_login_notices_scope').on(t.universityId, t.isActive, t.sortOrder),
]);

/** اسلایدهای صفحه ورود — universityId خالی = سراسری؛ imageUrl خالی = گرادیان پیش‌فرض */
export const login_slides = pgTable('login_slides', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').references(() => universities.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 150 }).notNull(),
  subtitle: varchar('subtitle', { length: 255 }).notNull().default(''),
  imageUrl: varchar('imageUrl', { length: 500 }).notNull().default(''),
  linkUrl: varchar('linkUrl', { length: 500 }).notNull().default(''),
  isActive: integer('isActive').notNull().default(1),
  sortOrder: integer('sortOrder').notNull().default(0),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (t) => [
  index('idx_login_slides_scope').on(t.universityId, t.isActive, t.sortOrder),
]);

/** تخفیف تخصیص‌یافته به یک دانشجو (برای یک ترم، یا NULL = همهٔ ترم‌ها) */
export const student_discounts = pgTable('student_discounts', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  termId: integer('termId').references(() => academic_terms.id),
  discountTypeId: integer('discountTypeId').notNull().references(() => tuition_discount_types.id),
  kind: varchar('kind', { length: 20 }).notNull().default('PERCENT'),
  percent: numeric('percent', { precision: 5, scale: 2 }).notNull().default('0'),
  amount: numeric('amount', { precision: 12, scale: 0 }).notNull().default('0'),
  /** روی کدام بخش شهریه اثر بگذارد: FIXED | VARIABLE | BOTH */
  appliesTo: varchar('appliesTo', { length: 20 }).notNull().default('BOTH'),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'), // PENDING | APPROVED | REJECTED
  reason: text('reason'),
  documentUrl: text('documentUrl'),
  approvedBy: integer('approvedBy').references(() => users.id),
  approvedAt: timestamp('approvedAt'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

/** بنیادها و نهادهای حامی — کمیتهٔ امداد، بنیاد شهید، خیرین و … */
export const tuition_sponsors = pgTable('tuition_sponsors', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 40 }).notNull().unique(),
  title: varchar('title', { length: 150 }).notNull(),
  contactInfo: text('contactInfo'),
  /** DIRECT = پرداخت مستقیم به دانشگاه | REIMBURSE = دانشجو پرداخت و بنیاد بازپرداخت می‌کند */
  settlementMethod: varchar('settlementMethod', { length: 30 }).notNull().default('DIRECT'),
  isActive: integer('isActive').notNull().default(1),
  note: text('note'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

/** تعهد پرداخت یک بنیاد بابت شهریهٔ یک دانشجو — با بازه زمانی و تفکیک ثابت/متغیر */
export const student_sponsorships = pgTable('student_sponsorships', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  termId: integer('termId').references(() => academic_terms.id), // ترم تحصیلی مرجع (برای جستجو)
  financialTermId: integer('financialTermId').references(() => financial_terms.id), // ترم مالی مرجع
  sponsorId: integer('sponsorId').notNull().references(() => tuition_sponsors.id),
  /** بازه زمانی اثربخشی (نیمسال‌های مالی) */
  startTermId: integer('startTermId').references(() => financial_terms.id),
  endTermId: integer('endTermId').references(() => financial_terms.id),
  /** نوع پوشش: PERCENT = درصدی | FIXED = مبلغ ثابت */
  coverageKind: varchar('coverageKind', { length: 20 }).notNull().default('PERCENT'),
  /** درصد پوشش شهریه ثابت */
  fixedPercent: numeric('fixed_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  /** درصد پوشش شهریه متغیر */
  variablePercent: numeric('variable_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  /** مبلغ ثابت پوشش (اگر coverageKind = FIXED) */
  amount: numeric('amount', { precision: 12, scale: 0 }).notNull().default('0'),
  /** روی کدام بخش شهریه اثر بگذارد: FIXED | VARIABLE | BOTH */
  appliesTo: varchar('appliesTo', { length: 20 }).notNull().default('BOTH'),
  referenceNo: varchar('referenceNo', { length: 80 }),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'), // PENDING | CONFIRMED | REJECTED | PAID
  note: text('note'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => [
  index('idx_student_sponsorships_fin_term').on(t.financialTermId),
  index('idx_student_sponsorships_start_end').on(t.startTermId, t.endTermId),
]);

/** چک‌های دریافتی از دانشجو — مبنای یادآوری پیش از سررسید */
export const payment_cheques = pgTable('payment_cheques', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  termId: integer('termId').references(() => academic_terms.id),
  chequeNo: varchar('chequeNo', { length: 40 }).notNull(),
  bankName: varchar('bankName', { length: 100 }),
  branchCode: varchar('branchCode', { length: 40 }),
  amount: numeric('amount', { precision: 12, scale: 0 }).notNull(),
  dueDate: timestamp('dueDate').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'), // PENDING | CLEARED | BOUNCED | CANCELLED
  /** شناسهٔ تراکنش دفتر مالی پس از وصول */
  ledgerTxnId: integer('ledgerTxnId').references(() => student_ledger.id),
  remindedAt: timestamp('remindedAt'),
  clearedAt: timestamp('clearedAt'),
  note: text('note'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

// ══════════════════════════════════════════════════════════════════════
//  درگاه پرداخت آنلاین (POS) — پرداخت شهریه اینترنتی
// ══════════════════════════════════════════════════════════════════════

/** پیکربندی درگاه‌های پرداخت (زرین‌پال، ملت، سامان، پارسیان، پاسارگاد، ...) */
export const payment_gateways = pgTable('payment_gateways', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').notNull().references((): AnyPgColumn => universities.id),
  code: varchar('code', { length: 40 }).notNull(), // ZARINPAL, MELLAT, SAMAN, PARSIAN, PASARGAD, SADAD, ...
  title: varchar('title', { length: 100 }).notNull(),
  isActive: integer('isActive').notNull().default(1),
  isSandbox: integer('isSandbox').notNull().default(1),
  /** تنظیمات درگاه (JSON): merchantId, terminalId, callbackUrl, apiKey, pin, ... */
  config: jsonb('config').notNull().default('{}'),
  /** اولویت نمایش در لیست درگاه‌ها */
  sortOrder: integer('sortOrder').default(0),
  note: text('note'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (t) => [
  unique('uq_payment_gateway_uni_code').on(t.universityId, t.code),
]);

/** تراکنش‌های پرداخت آنلاین — ردیابی کامل از درخواست تا تایید/انصراف */
export const payment_transactions = pgTable('payment_transactions', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').notNull().references((): AnyPgColumn => universities.id),
  studentId: integer('studentId').notNull().references(() => students.id),
  termId: integer('termId').references(() => academic_terms.id),
  financialTermId: integer('financialTermId').references(() => financial_terms.id),
  gatewayId: integer('gatewayId').notNull().references(() => payment_gateways.id),
  /** مرجع یکتا برای ارجاع به درگاه (Authority/RefId/Token) */
  authority: varchar('authority', { length: 100 }).notNull(),
  /** مبلغ به ریال */
  amount: numeric('amount', { precision: 12, scale: 0 }).notNull(),
  /** توضیحات (مثال: شهریه ترم ۱۴۰۲۱) */
  description: text('description'),
  /** وضعیت تراکنش در سیستم ما */
  status: varchar('status', { length: 20 }).notNull().default('INITIATED'), // INITIATED | REDIRECTED | VERIFIED | FAILED | CANCELLED | EXPIRED
  /** وضعیت برگشتی از درگاه (کد نتیجه) */
  gatewayStatus: varchar('gateway_status', { length: 50 }),
  /** مرجع تراکنش در بانک (RRN/STAN/TransId) */
  bankRefId: varchar('bank_ref_id', { length: 50 }),
  /** کارت번호 (ماسک‌شده) */
  cardPan: varchar('card_pan', { length: 20 }),
  /** پرداخت‌کننده (دانشجو/پدر/مادر/سایر) */
  payerName: varchar('payer_name', { length: 100 }),
  /** موبایل پرداخت‌کننده برای پیامک */
  payerMobile: varchar('payer_mobile', { length: 15 }),
  /** ایمیل پرداخت‌کننده */
  payerEmail: varchar('payer_email', { length: 100 }),
  /** IP آدرس برای امنیتی */
  clientIp: varchar('client_ip', { length: 45 }),
  /** User-Agent برای لاگ */
  userAgent: text('user_agent'),
  /** زمان انقضای Authority (برای چک کردن انقضا) */
  expiresAt: timestamp('expires_at'),
  /** زمان تایید نهایی */
  verifiedAt: timestamp('verified_at'),
  /** شناسه تراکنش در دفتر مالی (student_ledger) پس از تایید */
  ledgerTxnId: integer('ledgerTxnId'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (t) => [
  unique('uq_payment_txn_authority').on(t.authority),
  index('idx_payment_txn_student').on(t.studentId),
  index('idx_payment_txn_term').on(t.termId),
  index('idx_payment_txn_fin_term').on(t.financialTermId),
  index('idx_payment_txn_status').on(t.status),
  index('idx_payment_txn_gateway').on(t.gatewayId),
]);

// ══════════════════════════════════════════════════════════════════════
//  ترمینال‌های POS حضوری (کارت‌خوان فیزیکی در دانشگاه)
// ══════════════════════════════════════════════════════════════════════

/** ترمینال‌های POS فیزیکی در واحدهای دانشگاه (صندوق، حسابداری، واحداً و...) */
export const pos_terminals = pgTable('pos_terminals', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').notNull().references((): AnyPgColumn => universities.id),
  code: varchar('code', { length: 40 }).notNull(), // کد یکتای ترمینال (مثال: POS-FIN-01)
  title: varchar('title', { length: 100 }).notNull(), // نام نمایشی (مثال: ترمینال صندوق مرکزی)
  location: varchar('location', { length: 200 }), // مکان فیزیکی (مثال: ساختمان مدیریت، طبقه ۱، اتاق ۱۰۱)
  gatewayId: integer('gatewayId').notNull().references(() => payment_gateways.id), // درگاه متصل (بانک ملت، پارسیان، ...)
  terminalId: varchar('terminal_id', { length: 50 }).notNull(), // Terminal ID (TID) صادره از بانک
  merchantId: varchar('merchant_id', { length: 50 }).notNull(), // Merchant ID (MID) صادره از بانک
  /** تنظیمات ترمینال (JSON): pinPadSerial, ipAddress, port, baudRate, ... */
  config: jsonb('config').notNull().default('{}'),
  isActive: integer('isActive').notNull().default(1),
  /** آخرین اتصال موفق (heartbeat) */
  lastHeartbeatAt: timestamp('last_heartbeat_at'),
  /** نسخه فریموررم ترمینال */
  firmwareVersion: varchar('firmware_version', { length: 50 }),
  sortOrder: integer('sortOrder').default(0),
  note: text('note'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (t) => [
  unique('uq_pos_terminal_uni_code').on(t.universityId, t.code),
  unique('uq_pos_terminal_tid').on(t.terminalId),
  index('idx_pos_terminal_gateway').on(t.gatewayId),
]);

/** تراکنش‌های POS حضوری — کارت‌خوان فیزیکی (Chip/PIN, Contactless, Magstripe) */
export const pos_transactions = pgTable('pos_transactions', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').notNull().references((): AnyPgColumn => universities.id),
  studentId: integer('studentId').notNull().references(() => students.id),
  termId: integer('termId').references(() => academic_terms.id),
  financialTermId: integer('financialTermId').references(() => financial_terms.id),
  terminalId: integer('terminalId').notNull().references(() => pos_terminals.id),
  /** مرجع یکتا ترمینال (STAN/RRN/TraceNumber) */
  stan: varchar('stan', { length: 20 }).notNull(),
  rrn: varchar('rrn', { length: 20 }),
  /** مبلغ به ریال */
  amount: numeric('amount', { precision: 12, scale: 0 }).notNull(),
  /** نوع تراکنش */
  txnType: varchar('txn_type', { length: 20 }).notNull().default('SALE'), // SALE | REFUND | VOID | SETTLEMENT
  /** روش ورود کارت */
  entryMode: varchar('entry_mode', { length: 20 }).notNull(), // CHIP | CONTACTLESS | MAGSTRIPE | FALLBACK | MANUAL
  /** وضعیت تراکنش */
  status: varchar('status', { length: 20 }).notNull().default('APPROVED'), // APPROVED | DECLINED | ERROR | VOIDED | PENDING_SETTLEMENT
  /** کد پاسخ بانک (Response Code) */
  responseCode: varchar('response_code', { length: 10 }),
  /** پیام پاسخ */
  responseMessage: varchar('response_message', { length: 200 }),
  /** کارت شماره (ماسک‌شده: 621986******1234) */
  cardPan: varchar('card_pan', { length: 20 }),
  /** نام کارت‌دار */
  cardholderName: varchar('cardholder_name', { length: 100 }),
  /** شناسه اپراتور/صندوق‌دار */
  operatorId: integer('operator_id').references(() => users.id),
  /** شناسه تراکنش در دفتر مالی (student_ledger) */
  ledgerTxnId: integer('ledgerTxnId').references(() => student_ledger.id),
  /** توضیحات */
  description: text('description'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (t) => [
  unique('uq_pos_txn_terminal_stan').on(t.terminalId, t.stan),
  index('idx_pos_txn_student').on(t.studentId),
  index('idx_pos_txn_term').on(t.termId),
  index('idx_pos_txn_fin_term').on(t.financialTermId),
  index('idx_pos_txn_status').on(t.status),
  index('idx_pos_txn_rrn').on(t.rrn),
  index('idx_pos_txn_operator').on(t.operatorId),
]);

/** وام‌های دانشجویی */
/**
 * کاتالوگ وام‌های قابل ارائه — نمونه: وام صندوق رفاه، وام ضروری،
 * ودیعهٔ مسکن. بدون این جدول، نام وام متن آزاد بود و هر کارشناس می‌توانست
 * یک جور بنویسد؛ اکنون مانند انواع تخفیف و بنیادها قابل تعریف است.
 */
export const loan_products = pgTable('loan_products', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 40 }).notNull().unique(),
  title: varchar('title', { length: 150 }).notNull(),
  /** نام نهاد پرداخت‌کننده که هنگام تخصیص پیش‌فرض می‌شود */
  lender: varchar('lender', { length: 150 }).notNull(),
  /** سقف مبلغ مجاز؛ NULL = بدون سقف */
  maxAmount: numeric('maxAmount', { precision: 12, scale: 0 }),
  defaultAmount: numeric('defaultAmount', { precision: 12, scale: 0 }).notNull().default('0'),
  defaultInstallments: integer('defaultInstallments').notNull().default(1),
  /** ۱ = کارمزد ندارد */
  isInterestFree: integer('isInterestFree').notNull().default(1),
  requiresApproval: integer('requiresApproval').notNull().default(1),
  isActive: integer('isActive').notNull().default(1),
  note: text('note'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

export const student_loans = pgTable('student_loans', {
  id: serial('id').primaryKey(),
  studentId: integer('studentId').notNull().references(() => students.id),
  termId: integer('termId').references(() => academic_terms.id),
  loanProductId: integer('loanProductId').references(() => loan_products.id),
  /** صندوق رفاه/حمایتی تأمین‌کنندهٔ وام (ماژول 0081 — FK در SQL مهاجرت) */
  welfareFundId: integer('welfareFundId'),
  lender: varchar('lender', { length: 150 }).notNull(),
  loanCode: varchar('loanCode', { length: 40 }),
  amount: numeric('amount', { precision: 12, scale: 0 }).notNull(),
  installments: integer('installments').notNull().default(1),
  firstDueDate: timestamp('firstDueDate'),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'), // ACTIVE | SETTLED | CANCELLED
  ledgerTxnId: integer('ledgerTxnId').references(() => student_ledger.id),
  note: text('note'),
  createdAt: timestamp('createdAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

/**
 * فرمول تخصیص شهریه — قابل تعریف توسط کارشناس مالی.
 * تفکیک نرخ هر واحد بر اساس نوع درس (نظری/عملی/عمومی) و بازهٔ ورودی.
 */
export const tuition_formulas = pgTable('tuition_formulas', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 40 }).notNull().unique(),
  title: varchar('title', { length: 150 }).notNull(),
  degreeLevelId: integer('degreeLevelId').references(() => degree_level_configs.id),
  majorId: integer('majorId').references(() => majors.id),
  entryYearFrom: integer('entryYearFrom'),
  entryYearTo: integer('entryYearTo'),
  fixedAmount: numeric('fixedAmount', { precision: 12, scale: 0 }).notNull().default('0'),
  perUnitTheory: numeric('perUnitTheory', { precision: 12, scale: 0 }).notNull().default('0'),
  perUnitPractical: numeric('perUnitPractical', { precision: 12, scale: 0 }).notNull().default('0'),
  perUnitGeneral: numeric('perUnitGeneral', { precision: 12, scale: 0 }).notNull().default('0'),
  /** عدد کوچک‌تر = اولویت بالاتر در انتخاب فرمول */
  priority: integer('priority').notNull().default(100),
  isActive: integer('isActive').notNull().default(1),
  note: text('note'),
  updatedAt: timestamp('updatedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

/**
 * جدول یکپارچهٔ قواعد شهریه — جایگزین `tuition_fee_rules` و `tuition_formulas`.
 *
 * هر قاعده می‌تواند بر اساس کلیدهای زیر محدود شود (تهی = همه):
 *   مقطع (degreeLevelId) ← اولویت اول، رشته (majorId) ← اولویت دوم،
 *   دانشکده (facultyId)، نوع ترم (termType)، نوع گذراندن درس (offeringType)،
 *   بازهٔ ورودی (entryYearFrom/To)، نیمسال ورود/جاری (entryTermId/currentTermId - FK به financial_terms),
 *   فاز بالینی (clinicalPhase: NORMAL | CLINICAL | INTERNSHIP).
 *
 * انتخاب قاعده با resolver یکتا در `src/lib/tuition-resolver.ts` انجام می‌شود
 * با سلسله‌مراتب: مقطع > رشته > دانشکده > نوع ترم > نوع درس > فاز بالینی > بازهٔ ورودی > نیمسال ورود/جاری,
 * و گره‌شکن‌های priority (کوچک‌تر برنده)، تازگی entryYearFrom، سپس id.
 */
export const tuition_rules = pgTable('tuition_rules', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 40 }),
  title: varchar('title', { length: 150 }),
  degreeLevelId: integer('degreeLevelId').references(() => degree_level_configs.id),
  majorId: integer('majorId').references(() => majors.id),
  facultyId: integer('facultyId').references(() => faculties.id),
  termType: varchar('termType', { length: 20 }),
  offeringType: varchar('offeringType', { length: 30 }),
  entryYearFrom: integer('entryYearFrom'),
  entryYearTo: integer('entryYearTo'),
  entryTermId: integer('entryTermId').references(() => financial_terms.id),
  currentTermId: integer('currentTermId').references(() => financial_terms.id),
  clinicalPhase: varchar('clinicalPhase', { length: 20 }).default('NORMAL'), // NORMAL | CLINICAL | INTERNSHIP
  fixedAmount: numeric('fixedAmount', { precision: 12, scale: 0 }).notNull().default('0'),
  perUnitTheory: numeric('perUnitTheory', { precision: 12, scale: 0 }).notNull().default('0'),
  perUnitPractical: numeric('perUnitPractical', { precision: 12, scale: 0 }).notNull().default('0'),
  perUnitGeneral: numeric('perUnitGeneral', { precision: 12, scale: 0 }).notNull().default('0'),
  /** حداقل واحد تابستان برای محاسبه درصد متعلقه (سما) */
  minSummerUnits: integer('minSummerUnits'),
  /** درصد متعلقه به واحد کمتر از حداقل (سما) */
  percentUnderMin: numeric('percentUnderMin', { precision: 5, scale: 2 }),
  /** عدد کوچک‌تر = اولویت بالاتر — فقط بین قواعدِ هم‌سطحِ ساختاری */
  priority: integer('priority').notNull().default(100),
  isActive: integer('isActive').notNull().default(1),
  note: text('note'),
  updatedAt: timestamp('updatedAt').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => [
  index('idx_tuition_rules_entry_term').on(t.entryTermId),
  index('idx_tuition_rules_current_term').on(t.currentTermId),
  index('idx_tuition_rules_faculty').on(t.facultyId),
  index('idx_tuition_rules_clinical').on(t.clinicalPhase),
]);

/**
 * تعرفهٔ تفصیلی نیمسال‌های گذشته (سامانهٔ سما) — «نوع درس مالی» × نیمسال × رشته × ورودی.
 *
 * چرا جدا از `tuition_rules`؟ مدل `tuition_rules` سه نرخ دارد (نظری/عملی/عمومی) و
 * به نیمسال وابسته نیست، ولی سما شهریهٔ هر درس را با نرخِ «نوع درس مالی» خودش در
 * همان نیمسال می‌سازد:
 *
 *     مبلغ درس = واحدهای نظری × thPrice + واحدهای عملی × opPrice
 *
 * برای بازتولید دقیقِ ریال‌به‌ریال کارنامهٔ مالیِ نیمسال‌های گذشته (سند رسمی
 * دانشگاه) همین تفصیل لازم است. تعرفهٔ نیمسال‌های جاری/آینده همچنان از
 * `tuition_rules` می‌آید.
 */
export const tuition_term_tariff = pgTable('tuition_term_tariff', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  /** کد نیمسال سما — مثل '14031' (نمونهٔ نمایندهٔ آن سال) */
  termCode: varchar('termCode', { length: 20 }).notNull(),
  /**
   * سالِ تعرفه (۱۴۰۳ = 1403). کدِ قیمت سما سالانه است و برای همهٔ نیمسال‌های
   * آن سال یکسان؛ پس کلید تطبیق همین است (نه کد نیمسال).
   */
  termYear: integer('termYear'),
  majorId: integer('majorId').references(() => majors.id),
  /** سالِ ورودِ گروه (نیمسالِ ورود ÷ ۱۰) */
  entryYear: integer('entryYear').notNull(),
  /** نوع درس مالی سما (Mali_type) */
  maliType: integer('maliType').notNull(),
  thPrice: numeric('thPrice', { precision: 16, scale: 2 }).notNull().default('0'),
  opPrice: numeric('opPrice', { precision: 16, scale: 2 }).notNull().default('0'),
  uPriceCode: varchar('uPriceCode', { length: 20 }),
  source: varchar('source', { length: 40 }).default('SAMA'),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (t) => [
  unique('uq_tuition_term_tariff').on(t.universityId, t.termCode, t.majorId, t.entryYear, t.maliType),
  index('idx_tuition_term_tariff_lookup').on(t.universityId, t.termCode, t.majorId, t.entryYear),
  index('idx_tuition_term_tariff_year').on(t.universityId, t.termYear, t.majorId, t.entryYear),
]);

// ══════════════════════════════════════════════════════════════════════
//  فاز ۱+۲: ضریب افزایشی نیمسال + مبالغ موضوعی (سیستم مالی مشابه سما)
// ══════════════════════════════════════════════════════════════════════

/** ضریب افزایشی شهریه به ازای هر نیمسال — مشابه سما */
export const tuition_coefficients = pgTable('tuition_coefficients', {
  id: serial('id').primaryKey(),
  termId: integer('termId').notNull().references(() => academic_terms.id),
  financialTermId: integer('financialTermId').references(() => financial_terms.id),
  variableCoefficient: numeric('variable_coefficient', { precision: 4, scale: 2 }).notNull().default('1.00'),
  fixedCoefficient: numeric('fixed_coefficient', { precision: 4, scale: 2 }).notNull().default('1.00'),
  note: text('note'),
  updatedAt: timestamp('updated_at').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => [
  unique('uq_tuition_coeff_term').on(t.termId),
  unique('uq_tuition_coeff_fin_term').on(t.financialTermId),
  index('idx_tuition_coeff_fin_term').on(t.financialTermId),
]);

/** کاتالوگ انواع مبالغ موضوعی شهریه */
export const subject_fee_types = pgTable('subject_fee_types', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 40 }).notNull().unique(),
  title: varchar('title', { length: 150 }).notNull(),
  kind: varchar('kind', { length: 20 }).notNull().default('ADDITIVE'),
  fixedAmount: numeric('fixed_amount', { precision: 12, scale: 0 }).notNull().default('0'),
  variablePercent: numeric('variable_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  appliesTo: varchar('applies_to', { length: 20 }).notNull().default('BOTH'),
  isActive: integer('is_active').notNull().default(1),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
});

/** تخصیص مبلغ موضوعی به دانشجو */
export const student_subject_fees = pgTable('student_subject_fees', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').notNull().references(() => students.id),
  termId: integer('term_id').notNull().references(() => academic_terms.id),
  financialTermId: integer('financial_term_id').references(() => financial_terms.id),
  subjectFeeTypeId: integer('subject_fee_type_id').notNull().references(() => subject_fee_types.id),
  amount: numeric('amount', { precision: 12, scale: 0 }).notNull().default('0'),
  isActive: integer('is_active').notNull().default(1),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({
  uq: unique('uq_student_subject_fees').on(t.studentId, t.termId, t.subjectFeeTypeId),
  uqFin: unique('uq_student_subject_fees_fin').on(t.studentId, t.financialTermId, t.subjectFeeTypeId),
  idxFinTerm: index('idx_student_subject_fees_fin_term').on(t.financialTermId),
}));

// ══════════════════════════════════════════════════════════════════════
//  نرخ رشد تجمعی شهریه (View) — محاسبه از tuition_coefficients
//  معادل جداول نرخ رشد در راهنمای سما (صفحات ۲۳۱-۲۵۸)
// ══════════════════════════════════════════════════════════════════════
export const tuition_growth_rates = pgTable('tuition_growth_rates', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').notNull().references((): AnyPgColumn => universities.id),
  entryTermId: integer('entryTermId').notNull().references(() => financial_terms.id),
  currentTermId: integer('currentTermId').notNull().references(() => financial_terms.id),
  variableGrowthRate: numeric('variable_growth_rate', { precision: 6, scale: 4 }).notNull(), // ضریب تجمعی متغیر
  fixedGrowthRate: numeric('fixed_growth_rate', { precision: 6, scale: 4 }).notNull(),     // ضریب تجمعی ثابت
  computedAt: timestamp('computed_at').defaultNow(),
}, (t) => [
  unique('uq_growth_rates_uni_entry_current').on(t.universityId, t.entryTermId, t.currentTermId),
  index('idx_growth_rates_entry').on(t.entryTermId),
  index('idx_growth_rates_current').on(t.currentTermId),
]);

// ══════════════════════════════════════════════════════════════════════
//  کدینگ‌های جغرافیایی پایه (کشور، استان، شهر، بخش)
// ══════════════════════════════════════════════════════════════════════

export const geo_countries = pgTable('geo_countries', {
  code: varchar('code', { length: 20 }).primaryKey(),
  title: varchar('title', { length: 150 }).notNull(),
  standardCode: varchar('standardCode', { length: 50 }),
  ministryCode: varchar('ministryCode', { length: 50 }),
  createdAt: timestamp('createdAt').defaultNow(),
});

export const geo_provinces = pgTable('geo_provinces', {
  code: varchar('code', { length: 20 }).primaryKey(),
  title: varchar('title', { length: 150 }).notNull(),
  standardCode: varchar('standardCode', { length: 50 }),
  sanjeshCode: varchar('sanjeshCode', { length: 50 }),
  ministryCode: varchar('ministryCode', { length: 50 }),
  createdAt: timestamp('createdAt').defaultNow(),
});

export const geo_cities = pgTable('geo_cities', {
  id: serial('id').primaryKey(),
  provinceCode: varchar('provinceCode', { length: 20 }).notNull().references(() => geo_provinces.code),
  code: varchar('code', { length: 20 }).notNull(),
  title: varchar('title', { length: 150 }).notNull(),
  standardCode: varchar('standardCode', { length: 50 }),
  ministryCode: varchar('ministryCode', { length: 50 }),
  createdAt: timestamp('createdAt').defaultNow(),
}, (t) => ({
  uq: unique('uq_geo_cities_province_code').on(t.provinceCode, t.code),
  idxCityCode: index('idx_geo_cities_code').on(t.code),
  idxCityProv: index('idx_geo_cities_province').on(t.provinceCode),
}));

export const geo_districts = pgTable('geo_districts', {
  id: serial('id').primaryKey(),
  provinceCode: varchar('provinceCode', { length: 20 }).notNull(),
  cityCode: varchar('cityCode', { length: 20 }).notNull(),
  code: varchar('code', { length: 20 }).notNull(),
  title: varchar('title', { length: 150 }).notNull(),
  ministryCode: varchar('ministryCode', { length: 50 }),
  createdAt: timestamp('createdAt').defaultNow(),
}, (t) => ({
  uq: unique('uq_geo_districts_hierarchy').on(t.provinceCode, t.cityCode, t.code),
  idxDistCode: index('idx_geo_districts_code').on(t.code),
}));

/**
 * کدینگ‌های مشترک وزارت (KODING سما) — مرجع سراسری دامنه‌های کوچک.
 * دامنه‌ها: GENDER | MARITAL | RELIGION | ACADEMIC_RANK | STUDENT_STATUS | DEGREE
 * سید از E:\GIT3\KODING در مهاجرت 0043؛ سراسری است (بدون universityId).
 */
export const ministry_shared_codes = pgTable('ministry_shared_codes', {
  domain: varchar('domain', { length: 30 }).notNull(),
  code: varchar('code', { length: 20 }).notNull(),
  title: varchar('title', { length: 150 }).notNull(),
  latinTitle: varchar('latinTitle', { length: 150 }),
  standardCode: varchar('standardCode', { length: 50 }),
  ministryCode: varchar('ministryCode', { length: 50 }),
  createdAt: timestamp('createdAt').defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.domain, t.code] }),
}));

// ══════════════════════════════════════════════════════════════════════
//  گزارش سالانهٔ «سهام» (IRPHE — saham.irphe.ac.ir)
// ══════════════════════════════════════════════════════════════════════

/**
 * کد ۱۲ رقمی «واحد/دانشکده» که سهام می‌خواهد. جدول از `faculties` جداست چون:
 *  · faculties.standardCode در همهٔ ردیف‌ها خالی بود؛
 *  · یک واحد می‌تواند چند «دانشکده» در سهام داشته باشد (حوزهٔ ستادی + …)؛
 *  · کد باید در اکسل حتماً Text باشد (وگرنه صفرهای اول می‌پرند و ارسال رد می‌شود).
 * مؤسسه‌های منحل هم سطر دارند؛ اگر دانشگاهی سطر فعال نداشته باشد، در
 * خروجی از کد پیش‌فرض آفاق استفاده می‌شود.
 */
export const saham_institute_codes = pgTable('saham_institute_codes', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').notNull().references((): AnyPgColumn => universities.id),
  facultyId: integer('facultyId').references((): AnyPgColumn => faculties.id),
  title: varchar('title', { length: 150 }).notNull(),
  code: varchar('code', { length: 20 }).notNull(),
  provinceCode: varchar('provinceCode', { length: 20 }),
  cityCode: varchar('cityCode', { length: 20 }),
  isDefault: integer('isDefault').default(0),
  isActive: integer('isActive').default(1),
  createdAt: timestamp('createdAt').defaultNow(),
}, (t) => [
  unique('uq_saham_inst_code').on(t.universityId, t.code),
  index('idx_saham_inst_fac').on(t.facultyId),
]);

/**
 * نگاشت «مقدار داخلی ما → متنی که سهام می‌پذیرد». سهام مقادیر را *متنی* و
 * با فهرست بسته می‌گیرد (codes.xlsx)، پس کدهای داخلی ما باید صریح نگاشت شوند.
 * از رابط کاربری قابل ویرایش است.
 */
export const saham_value_maps = pgTable('saham_value_maps', {
  id: serial('id').primaryKey(),
  field: varchar('field', { length: 40 }).notNull(),
  sourceValue: varchar('sourceValue', { length: 100 }).notNull(),
  sahamTitle: varchar('sahamTitle', { length: 150 }).notNull(),
  isActive: integer('isActive').default(1),
  createdAt: timestamp('createdAt').defaultNow(),
}, (t) => [
  unique('uq_saham_value_map').on(t.field, t.sourceValue),
  index('idx_saham_value_map_field').on(t.field),
]);

// ══════════════════════════════════════════════════════════════════════
//  ماژول اختیاری «طرح درس» (Lesson-Plan) — مهاجرت 0055
//  قرارداد منجمد: نام جدول‌ها/ستون‌ها عیناً مطابق drizzle/0055_lesson_plan.sql.
//  lesson_plan_weights بارم‌بندیِ درصدیِ همین ماژول است و ربطی به بارمِ /۲۰
//  سمت‌کاربرِ صفحهٔ نمرات استاد (RubricWeights در grades-core.ts) ندارد.
// ══════════════════════════════════════════════════════════════════════

export const lesson_plans = pgTable('lesson_plans', {
  id: serial('id').primaryKey(),
  offeringId: integer('offeringId').notNull().unique().references(() => course_offerings.id),
  courseMode: varchar('courseMode', { length: 10 }).notNull().default('THEORY'),
  totalSessions: integer('totalSessions').notNull().default(16),
  objectives: text('objectives'),
  resources: text('resources'),
  status: varchar('status', { length: 12 }).default('DRAFT'),
  submittedAt: timestamp('submittedAt'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
});

export const lesson_plan_weights = pgTable('lesson_plan_weights', {
  id: serial('id').primaryKey(),
  planId: integer('planId').notNull().references(() => lesson_plans.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 100 }).notNull(),
  percent: numeric('percent', { precision: 5, scale: 2 }).notNull(),
  sortOrder: integer('sortOrder').default(0),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({
  planIdx: index('idx_lesson_plan_weights_plan').on(t.planId),
}));

export const lesson_plan_sessions = pgTable('lesson_plan_sessions', {
  id: serial('id').primaryKey(),
  planId: integer('planId').notNull().references(() => lesson_plans.id, { onDelete: 'cascade' }),
  sessionNo: integer('sessionNo').notNull(),
  sessionKind: varchar('sessionKind', { length: 10 }).default('THEORY'),
  topic: varchar('topic', { length: 300 }),
  details: text('details'),
  weightId: integer('weightId').references(() => lesson_plan_weights.id, { onDelete: 'set null' }),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ({
  uqPlanSession: unique('uq_lesson_plan_sessions_plan_session').on(t.planId, t.sessionNo),
  planIdx: index('idx_lesson_plan_sessions_plan').on(t.planId),
}));

export const lesson_plan_settings = pgTable('lesson_plan_settings', {
  universityId: integer('universityId').primaryKey().references(() => universities.id),
  isRequired: integer('isRequired').default(0),
  notice: text('notice'),
  updatedAt: timestamp('updatedAt').defaultNow(),
});

// ══════════════════════════════════════════════════════════════════════
//  مهاجرت 0056 — موظفیِ نقش‌محور + اسنپ‌شاتِ ترمیِ مرتبه/پایه/نرخ
//  قرارداد منجمد: نام جدول‌ها/ستون‌ها عیناً مطابق drizzle/0056_payroll_role_duty.sql.
//  ستون‌های rankSnapshot/baseSnapshot/rateSnapshot روی professor_term_contracts
//  و payroll_statements NULLپذیرند: NULL = ردیف قدیمی ← موتور مقدار زنده می‌خواند.
// ══════════════════════════════════════════════════════════════════════

/** کاتالوگ باز سمت‌های موظفی (دانشگاه‌محور) — موظفی از «نقش» می‌آید نه مرتبه */
export const payroll_duty_roles = pgTable('payroll_duty_roles', {
  id: serial('id').primaryKey(),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  code: varchar('code', { length: 40 }).notNull(),
  title: varchar('title', { length: 150 }).notNull(),
  dutyUnits: numeric('dutyUnits', { precision: 4, scale: 2 }),
  reductionUnits: numeric('reductionUnits', { precision: 4, scale: 2 }).notNull().default('0'),
  isTeaching: integer('isTeaching').notNull().default(1),
  sortOrder: integer('sortOrder').notNull().default(0),
}, (t) => ([
  unique('uq_payroll_duty_roles_uni_code').on(t.universityId, t.code),
]));

/** انتساب نقش به استاد در هر ترم */
export const staff_term_roles = pgTable('staff_term_roles', {
  id: serial('id').primaryKey(),
  staffId: integer('staffId').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  termId: integer('termId').notNull().references(() => academic_terms.id, { onDelete: 'cascade' }),
  roleId: integer('roleId').notNull().references(() => payroll_duty_roles.id, { onDelete: 'cascade' }),
  isPrimary: integer('isPrimary').notNull().default(0),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
}, (t) => ([
  unique('uq_staff_term_roles').on(t.staffId, t.termId, t.roleId),
  index('idx_staff_term_roles_term').on(t.termId),
]));

/** دامنهٔ دسترسی کارشناسان آموزش — محدود به دانشگاه/دانشکده/گروه/رشته */
export const expert_scopes = pgTable('expert_scopes', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** UNIVERSITY | FACULTY | DEPARTMENT | MAJOR */
  scopeType: varchar('scopeType', { length: 20 }).notNull(),
  scopeId: integer('scopeId'),
  universityId: integer('universityId').references((): AnyPgColumn => universities.id),
  /** پرچم «ویرایش نمره» برای این کارشناس (دایره‌العمل‌ها یکسان نگه داشته می‌شوند) */
  canEditGrades: integer('canEditGrades').notNull().default(0),
  createdAt: timestamp('createdAt').defaultNow(),
}, (t) => ({
  uq: unique('uq_expert_scopes').on(t.userId, t.scopeType, t.scopeId, t.universityId),
  ux: index('idx_expert_scopes_user').on(t.userId),
}));

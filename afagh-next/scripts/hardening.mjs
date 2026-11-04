import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { checkSecret } from './lib/secret-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlFile = path.join(__dirname, '..', 'src', 'db', 'pg-hardening.sql');
const sql = readFileSync(sqlFile, 'utf8');

const PG_URL = process.env.DATABASE_URL || 'postgres://afagh:afagh@localhost:5432/afagh_db';
// ── رمز نقش RLS از محیط، نه هاردکد ──
// در production حتماً باید تعیین شود (AFAGH_APP_DB_PASSWORD)؛ در توسعه پیش‌فرض محلی مجاز است.
const isProd = process.env.NODE_ENV === 'production';
const APP_PASSWORD = process.env.AFAGH_APP_DB_PASSWORD;
if (isProd && !APP_PASSWORD) {
  console.error('❌ در production باید AFAGH_APP_DB_PASSWORD (رمز نقش afagh_app) تعیین شود.');
  process.exit(1);
}
const appPassword = APP_PASSWORD || 'afagh_app';
if (!isProd && !APP_PASSWORD) {
  console.warn('⚠ توسعه: رمز پیش‌فرض afagh_app برای نقش afagh_app استفاده می‌شود (فقط محلی).');
}

// ── P0-1: سیاست رمز — پیش از آنکه مقدار روی نقش اعمال شود بررسی می‌شود ──
// تا پیش از این، هر مقدارِ غیرخالی پذیرفته می‌شد؛ یعنی «afagh-app-pass» هم
// بهعنوان رمز نقش afagh_app روی دیتابیس نوشته می‌شد. حالا fail-closed:
// در پروداکشن مقدار نمونه/ضعیف/کوتاه کل استقرار را متوقف می‌کند.
const policy = checkSecret('AFAGH_APP_DB_PASSWORD', appPassword, {
  allowWeak: !isProd || process.env.ALLOW_WEAK_SECRETS === '1',
  failOnShort: false, // کوتاه‌اما‌غیرقابل‌حدس = هشدار؛ نمونه/ضعیف = خطا
});
if (!policy.ok) {
  console.error('❌ ' + policy.reason);
  console.error('   رمز قوی بسازید:  node scripts/lib/secret-policy.mjs --gen');
  console.error('   یا با اسکریپت نصب: ./deploy-debian.sh  (رمز تصادفی در .env می‌نویسد)');
  process.exit(1);
} else if (policy.weak || policy.short) {
  console.warn('⚠ ' + policy.reason);
} else {
  console.log(`✓ رمز نقش afagh_app با سیاست پروداکشن سازگار است (طول ${appPassword.length})`);
}

// ═══ نقش اختصاصی پشتیبان‌گیری/بازیابی (فاز ۳) ═══
// چرا نقش جدا؟ پشتیبان و بازیابی درون‌برنامه‌ای امروز روی استخرِ مالک (DATABASE_URL)
// اجرا می‌شود؛ مالک جدول‌ها را DROP/CREATE می‌کند و (چون مالک است) از RLS عبور
// می‌کند. این یعنی یک نقص در اکشن پشتیبان = دسترسی کاملِ DDL. نقش afagh_backup
// فقط داده می‌خواند/می‌نویسد، هیچ DDL ندارد و NOBYPASSRLS است.
//
// چرا نبودِ متغیر، استقرار را متوقف نمی‌کند؟ این نقش یک «گام تکمیلی» است: تا وقتی
// DATABASE_URL_BACKUP در اپ تنظیم نشده، پشتیبان با همان مالک کار می‌کند (ریسک
// باقی‌مانده، مستند در scripts/phase3/README.md). اگر نبودِ رمز کل نصب را می‌شکست،
// استقرارهای موجود و محیط توسعه بی‌دلیل قفل می‌شدند. پس: هشدار + رد کردن نقش.
const BACKUP_PASSWORD_RAW = process.env.AFAGH_BACKUP_DB_PASSWORD;
let backupPassword = null;
if (BACKUP_PASSWORD_RAW == null || BACKUP_PASSWORD_RAW.trim() === '') {
  console.warn(
    '⚠ AFAGH_BACKUP_DB_PASSWORD تعیین نشده — نقش afagh_backup ساخته/به‌روزرسانی نشد.\n' +
    '   پشتیبان/بازیابی درون‌برنامه‌ای تا تعیین این متغیر با نقش مالک اجرا می‌شود (ریسک باقی‌مانده).',
  );
} else {
  // همان سیاست و همان گزینه‌های نقش afagh_app — سیاست رمز تکرار نمی‌شود.
  const backupPolicy = checkSecret('AFAGH_BACKUP_DB_PASSWORD', BACKUP_PASSWORD_RAW, {
    allowWeak: !isProd || process.env.ALLOW_WEAK_SECRETS === '1',
    failOnShort: false,
  });
  if (!backupPolicy.ok) {
    console.error('❌ ' + backupPolicy.reason);
    console.error('   برای رد کردن نقش پشتیبان، AFAGH_BACKUP_DB_PASSWORD را بردارید.');
    console.error('   رمز قوی بسازید:  node scripts/lib/secret-policy.mjs --gen');
    process.exit(1);
  } else if (backupPolicy.weak || backupPolicy.short) {
    console.warn('⚠ ' + backupPolicy.reason);
  }
  backupPassword = BACKUP_PASSWORD_RAW;
}

/**
 * ساخت/به‌روزرسانی idempotent نقش afagh_backup + گرنت‌ها + سیاست‌های RLS.
 *
 * گرنت‌ها دقیقاً بر اساس کارهایی است که backup-actions.ts انجام می‌دهد:
 *   • SELECT  → دامپ (getUserTables / dumpTable / شمارش آمار)
 *   • INSERT  → بازگرداندن ردیف‌ها
 *   • TRUNCATE→ خالی‌کردن جدول پیش از درج (بازیابی = جایگزینی کامل)
 * UPDATE/DELETE لازم نیست: بازیابی هیچ‌گاه ردیف را وصله نمی‌کند و چیزی را
 * تک‌تک حذف نمی‌کند. DROP/CREATE هم عمداً گرنت نمی‌شود؛ هیچ GRANTای مالکیت
 * نمی‌دهد و مسیر بازیابیِ کم‌مجوز، داده‌به‌جای DDL اجرا می‌کند.
 */
async function applyBackupRole(db, dbName, password) {
  // رمز و نام دیتابیس با quote_literal/quote_ident امن می‌شوند (دستورات نقش، پارامتر نمی‌پذیرند).
  const quotedPassword = (await db.query('SELECT quote_literal($1) AS lit', [password])).rows[0].lit;
  const quotedDb = (await db.query('SELECT quote_ident($1) AS ident', [dbName])).rows[0].ident;

  await db.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afagh_backup') THEN
    CREATE ROLE afagh_backup LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quotedPassword};
  ELSE
    -- چرخش رمز هم مثل afagh_app واقعاً اعمال می‌شود؛ ویژگی‌ها هم همگرا می‌شوند.
    ALTER ROLE afagh_backup WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quotedPassword};
  END IF;
END $$;

GRANT CONNECT ON DATABASE ${quotedDb} TO afagh_backup;
GRANT USAGE ON SCHEMA public TO afagh_backup;
GRANT SELECT, INSERT, TRUNCATE ON ALL TABLES IN SCHEMA public TO afagh_backup;
-- جدول‌های مهاجرت‌های بعدی هم بدون اجرای دوبارهٔ این فایل همین گرنت را بگیرند.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, TRUNCATE ON TABLES TO afagh_backup;
-- همگرایی: اگر نقش از قبل مجوز گسترده‌تری داشت، به حداقل لازم باریک می‌شود.
REVOKE UPDATE, DELETE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM afagh_backup;

-- RLS: نقش NOBYPASSRLS است، پس بدون سیاستِ صریح هیچ ردیفی نمی‌بیند (دامپ خالی
-- می‌شد). دو سیاست کمینه و فقط برای همین نقش: خواندن برای دامپ، درج برای بازیابی.
-- سیاست‌های نقش‌های دیگر دست‌نخورده می‌مانند (سیاست‌ها با OR جمع می‌شوند و این‌ها
-- فقط TO afagh_backup هستند).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS afagh_backup_read ON %I', t.tablename);
    EXECUTE format('CREATE POLICY afagh_backup_read ON %I FOR SELECT TO afagh_backup USING (true)', t.tablename);
    EXECUTE format('DROP POLICY IF EXISTS afagh_backup_insert ON %I', t.tablename);
    EXECUTE format('CREATE POLICY afagh_backup_insert ON %I FOR INSERT TO afagh_backup WITH CHECK (true)', t.tablename);
  END LOOP;
END $$;

-- بازیابی داده روی اسکیمای زنده: ترتیب الفبایی جداول با کلیدهای خارجی سازگار
-- نیست. session_replication_role=replica در همان نشست، تریگرها/FKها را موقتاً
-- خاموش می‌کند؛ مجوزش فقط برای همین پارامتر و همین نقش است (PG15+). بدون آن،
-- بازیابیِ داده‌به‌جای DDL ممکن است وسط کار به دلیل FK شکست بخورد.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'GRANT SET ON PARAMETER session_replication_role TO afagh_backup';
  ELSE
    RAISE WARNING 'afagh_backup: PostgreSQL < 15 — بازیابی داده به ترتیب کلیدهای خارجی وابسته است.';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'afagh_backup: GRANT SET ON PARAMETER session_replication_role ممکن نشد — بازیابی داده ممکن است به دلیل FK شکست بخورد.';
END $$;
`);

  // ── اعتبارسنجی نقش: هر انحراف امنیتی استقرار را متوقف می‌کند ──
  const role = await db.query(
    `SELECT rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
     FROM pg_roles WHERE rolname = 'afagh_backup'`);
  const rb = role.rows[0];
  if (!rb) {
    console.error('❌ نقش afagh_backup ساخته نشد.');
    process.exit(1);
  }
  if (!rb.rolcanlogin || rb.rolinherit || rb.rolsuper || rb.rolbypassrls ||
      rb.rolcreaterole || rb.rolcreatedb || rb.rolreplication) {
    console.error('❌ نقش afagh_backup باید LOGIN + NOINHERIT + NOSUPERUSER + NOBYPASSRLS + بدون CREATEDB/CREATEROLE/REPLICATION باشد.');
    process.exit(1);
  }

  const over = await db.query(`
    SELECT count(*)::int AS n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND (has_table_privilege('afagh_backup', c.oid, 'UPDATE')
        OR has_table_privilege('afagh_backup', c.oid, 'DELETE'))`);
  if (over.rows[0].n > 0) {
    // هشدار نه خطا: گرنت عمومی/قدیمی نباید استقرار را بشکند، اما اپراتور باید بداند.
    console.warn(`⚠ afagh_backup روی ${over.rows[0].n} جدول UPDATE/DELETE دارد — انتظار نمی‌رفت (گرنت عمومی؟).`);
  }

  // آیا نقش واقعاً می‌تواند session_replication_role را در نشست خودش ست کند؟
  // بدون آن، بازیابیِ داده‌به‌جای‌DDL ممکن است وسط درج‌ها به دلیل FK شکست بخورد.
  // نسخهٔ سرور در JS سنجیده می‌شود چون has_parameter_privilege روی PG<15 اصلاً وجود ندارد.
  const versionRow = await db.query(`SHOW server_version_num`);
  const pgMajor = Math.floor(Number(versionRow.rows[0].server_version_num) / 10000);
  if (pgMajor >= 15) {
    const canSetRepl = await db.query(
      `SELECT has_parameter_privilege('afagh_backup', 'session_replication_role', 'SET') AS can_set`);
    if (!canSetRepl.rows[0].can_set) {
      console.warn(
        '⚠ afagh_backup نمی‌تواند session_replication_role را ست کند — بازیابیِ داده‌به‌جای‌DDL ' +
        'ممکن است به دلیل ترتیب کلیدهای خارجی شکست بخورد.',
      );
    }
  } else {
    console.warn(
      `⚠ سرور PostgreSQL ${pgMajor} است (کمتر از 15) — مجوز پارامتر session_replication_role ممکن نیست؛ ` +
      'بازیابیِ داده‌به‌جای‌DDL به ترتیب کلیدهای خارجی وابسته می‌شود.',
    );
  }

  console.log('✅ نقش afagh_backup: LOGIN/NOINHERIT/NOBYPASSRLS + SELECT/INSERT/TRUNCATE (بدون DDL).');
}

const client = new pg.Client({ connectionString: PG_URL });

try {
  await client.connect();
  console.log('در حال اعمال سخت‌سازی دیتابیس، ایندکس‌ها و نقش امنیتی afagh_app...');
  // نام دیتابیس از DATABASE_URL (پیش‌فرض: afagh_db) — تا hardening به نام دیتابیس
  // در SQL گره خورده نباشد؛ هر استقرار با نام دیگری قبلاً اینجا می‌شکست.
  let dbName = 'afagh_db';
  try { dbName = new URL(PG_URL).pathname.replace(/^\//, '') || 'afagh_db'; } catch {}
  await client.query(sql.replaceAll('__AFAGH_APP_PASSWORD__', appPassword).replaceAll('__AFAGH_DB__', dbName));
  console.log('✅ سخت‌سازی دیتابیس و نقش afagh_app با موفقیت ایجاد و اعمال شد.');

  // نقش پشتیبان بعد از ماتریس RLS اعمال می‌شود تا سیاست‌هایش روی همان جدول‌ها بنشیند.
  if (backupPassword) {
    console.log('در حال ساخت/به‌روزرسانی نقش کم‌مجوز afagh_backup...');
    await applyBackupRole(client, dbName, backupPassword);
  }

  // ═══ اعتبارسنجی پس از اعمال: کل ماتریس RLS باید فعال باشد، وگرنه استقرار ناموفق است ═══
  const RLS_TABLES = [
    'users','students','staff','sessions','enrollments','cart_items','notifications','student_requests',
    'transcript_snapshots','student_ledger','financial_clearances','seat_allocations',
    'student_class_attendance','student_documents','military_service_records','kyc_verifications',
    'grade_appeals','grade_objections','grade_submission_otps','signature_otps','doc_sign_otps','professor_term_contracts',
    'professor_class_attendance','professor_exam_attendance','electronic_documents','payroll_statements',
    'exam_minutes','physical_access_logs','request_step_logs','request_parallel_checkpoints', // ۲۸ حساس
    'professor_availability_notes','professor_availabilities',
    'grade_change_log',
    'system_settings','integrations_config','audit_logs','api_audit_logs','admissions_staging',
    'person_source_identities','sanjesh_mappings','evaluation_responses','verification_otps','step_api_actions','document_signatures',
    // ماژول سازمان سنجش (مهاجرت 0128) — دادهٔ خام داوطلبان، deny-all
    'sanjesh_templates','sanjesh_files','sanjesh_file_fields','sanjesh_file_rows','sanjesh_value_maps',
    'curriculum_approvals', // ۱۲ deny-all (چرخهٔ تأیید برنامهٔ درسی: دفتر ممیزیِ فقط-مالک)
    'thesis_progress','thesis_progress_reports','defense_sessions','irandoc_logs','defense_jury_pools',
    // ── ۲۷ جدولِ بخش ⑧ pg-hardening.sql که پیش‌تر در هیچ دروازه‌ای سنجیده نمی‌شدند ──
    // مالی/هویتیِ دانشجو (studentId → دروازهٔ پوشش هم پشتیبانشان می‌کرد، ولی مستقیم نه):
    'payment_cheques','payment_transactions','pos_transactions','student_discounts','student_sponsorships',
    'student_loans','student_cards','student_term_states','clearance_checklist','issued_degrees',
    'graduation_audits','alumni_profiles','alumni_requests',
    // امتحانات. ✓ سیاست‌های ۷ جدولِ امتحانی در pg-hardening.sql بازنویسی شدند (بند ۲٫۵):
    // app.university_id برای نقش afagh_app هرگز ست نمی‌شد (تنها ست‌کننده‌اش روی استخرِ مالکِ
    // BYPASSRLS بود و حتی فراخوانی نمی‌شد) و app.user_role هم جایی ست نمی‌شد ⇒ آن سیاست‌ها عملاً
    // همیشه FALSE بودند. اکنون همه با app.user_id نوشته شده‌اند — که withUserRls (src/db/index.ts:102)
    // در همان تراکنش می‌نویسد: نقش‌محور با user_roles JOIN roles، وگرنه سطرِ خودِ کاربر یا دانشگاهِ او.
    'exam_attendances','exam_sessions','exam_halls','exam_calendar_configs',
    'invigilators','exam_invigilators','exam_remuneration_rates',
    // کارکنان/آموزشی و اعلان‌ها (staffId / userId):
    'offering_professors','staff_roles','expert_scopes','enroll_bypass_requests',
    'notification_channels','notification_deliveries','notification_logs',
    'user_roles',            // زیرپرسمانِ سیاست‌های نقش‌محورِ پایان‌نامه — خودش هم RLS دارد
    'legacy_code_maps',      // deny-all صریح (USING(false))
    // ── ۱۴ جدول ماژول‌های الحاقی (مهاجرت 0075-0092) ──
    'discipline_cases','council_meetings','council_decisions','dorm_residences',
    'english_enrollment_approvals','scheduled_warnings','student_tuition_overrides',
    'thesis_supervisions','teaching_decrees','offering_payroll_extras',
    'staff_activity_entries','payroll_cash_extras','exam_payments','payroll_objections',
    'teaching_role_defs',
    'classroom_edu_experts',
    'course_offering_edu_experts',
    // گزارش‌ساز (مهاجرت 0134) — «تعریفِ گزارش»؛ مالک/نقش/عمومی. دادهٔ دانشجویی ندارد.
    'saved_reports',
  ];
  const checks = await client.query(
    `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY($1)
     ORDER BY c.relname`,
    [RLS_TABLES],
  );
  const missing = RLS_TABLES.filter(t => !checks.rows.find(r => r.table_name === t)?.rls_enabled);
  if (missing.length) {
    console.error(`❌ RLS روی جدول‌های ${missing.join(', ')} فعال نیست — استقرار متوقف شد.`);
    process.exit(1);
  }

  const role = await client.query(
    `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'afagh_app'`);
  const r = role.rows[0];
  if (!r) { console.error('❌ نقش afagh_app ساخته نشد.'); process.exit(1); }
  if (r.rolsuper || r.rolbypassrls) {
    console.error('❌ نقش afagh_app نباید SUPERUSER یا BYPASSRLS باشد.');
    process.exit(1);
  }

  console.log(`✅ RLS فعال است (${RLS_TABLES.length}/${RLS_TABLES.length} جدول — شامل deny-all) و نقش afagh_app امن است (NOSUPERUSER + NOBYPASSRLS).`);
  console.log('✅ گرنت ستونی: نوشتن دانشجو فقط روی enrollments("status","waitlistPosition") + cart_items(INSERT/DELETE) + notifications(INSERT).');

  // ═══ اثبات پوشش کامل (بازبینی — بند ۴): هیچ جدولی که ستون هویتی/مالی دارد،
  // بدون RLS نمی‌ماند. جدول‌های مرجع/کاتالوگ (بدون دادهٔ شخصی) مجازند.
  const coverage = await client.query(`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = c.relname
          AND col.column_name IN ('userId','studentId','staffId','personUserId','targetId',
                                  'contractId','enrollmentId','supervisorStaffId',
                                  'actorStaffId','clearedByStaffId','chairId',
                                  -- داوران/داورخوانِ دفاع (defense_sessions) و تأییدکننده‌ها:
                                  'internalId','externalId',
                                  -- curriculum_approvals (append-only، deny-all) و issued_degrees:
                                  'approvedByStaffId','approvedByUserId','issuedByUserId')
      )
    ORDER BY 1`);
  const unprotected = coverage.rows.filter(r => !r.rls_enabled).map(r => r.table_name);
  if (unprotected.length) {
    console.error(`❌ جدول‌های دادهٔ شخصی/مالی بدون RLS: ${unprotected.join(', ')} — استقرار متوقف شد.`);
    process.exit(1);
  }
  console.log(`✅ پوشش RLS کامل: ${coverage.rows.length} جدول دارای دادهٔ هویتی/مالی — همه RLS دارند.`);

} catch (err) {
  console.error('خطا در اجرای سخت‌سازی:', err.message);
  process.exit(1);
} finally {
  await client.end();
}

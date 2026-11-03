#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════════
 *  اعمال پچ‌های اسکیما در پایپ‌لاین مهاجرت (پیش از استارت اپ)
 *
 *  سیاست مهاجرت امن: ALTER/CREATE اصلی فقط این‌جا (migrator) اجرا می‌شود،
 *  نه در runtime اپ. ترتیب کامل migrator:
 *      drizzle-kit push → apply-patches → seed-base → hardening
 *
 *  متن پچ‌ها: src/db/patches.sql (همان منبعی که در توسعه به‌عنوان
 *  خودترمیمی استفاده می‌شود — یک منبع واحد، بدون تکرار SQL).
 * ══════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlFile = path.join(__dirname, '..', 'src', 'db', 'patches.sql');
const sql = readFileSync(sqlFile, 'utf8');

const PG_URL = process.env.DATABASE_URL || 'postgres://afagh:afagh@localhost:5432/afagh_db';
const client = new pg.Client({ connectionString: PG_URL });

try {
  await client.connect();
  // ── قفل مهاجرت (بازبینی مهندسی): دو نمونهٔ همزمان migrator هرگز پچ نمی‌زنند ──
  await client.query(`SELECT pg_advisory_lock(hashtext('afagh_migrator'))`);
  console.log('🔧 اعمال پچ‌های اسکیما (patches.sql)…');
  await client.query(sql);
  console.log('✅ پچ‌های اسکیما اعمال شد.');

  // 🎯 بازبینی ۵: دنبالهٔ کد رهگیری — بدون رقابت/تصادم در چند سرور (به‌جای count+حلقه)
  // پس‌زمینه‌سازی: از آخرین شمارهٔ موجود در student_requests جلوتر می‌رود تا با
  // دادهٔ فعلی برخورد نکند. idempotent است (هر بار اجرا، فقط اگر بزرگ‌تر بود setval).
  await client.query(`CREATE SEQUENCE IF NOT EXISTS tracking_code_seq`);
  await client.query(`
    DO $$
    DECLARE mx BIGINT;
    BEGIN
      SELECT COALESCE(MAX((regexp_match("trackingCode", '-([0-9]{4,12})$'))[1]::BIGINT), 0)
        INTO mx FROM student_requests;
      IF mx > (SELECT last_value FROM tracking_code_seq) THEN
        PERFORM setval('tracking_code_seq', mx, TRUE);
      END IF;
    END $$;`);

  // ═══ تأیید سلامت اسکیما (Migration Verification — بازبینی Medium) ═══
  // پیش از ادامهٔ پایپ‌لاین، جدول‌های حیاتیِ اپ باید وجود داشته باشند؛
  // اگر drizzle-kit push یا پچ‌ها ناقص مانده باشند، این‌جا (نه در runtime اپ) شکست می‌خورد.
  const REQUIRED_TABLES = [
    'users', 'students', 'staff', 'sessions', 'roles', 'user_roles',
    'enrollments', 'course_offerings', 'academic_terms', 'courses',
    'student_ledger', 'payment_cheques', 'student_discounts', 'student_sponsorships', 'student_loans',
    'system_settings', 'audit_logs', 'notifications', 'student_requests',
    'degree_level_configs', 'educational_regulations', 'majors',
  ];
  const missingTabs = [];
  for (const t of REQUIRED_TABLES) {
    const r = await client.query(`SELECT to_regclass('public."${t}"') AS t`);
    if (!r.rows[0]?.t) missingTabs.push(t);
  }
  if (missingTabs.length) {
    console.error(`❌ جدول‌های حیاتی یافت نشد: ${missingTabs.join(', ')} — مهاجرت ناقص است، استقرار متوقف شد.`);
    process.exit(1);
  }
  console.log(`✅ تأیید سلامت اسکیما: ${REQUIRED_TABLES.length} جدول حیاتی موجودند.`);

  // ═══ گزارشِ ایندکس‌های عملکردی (ضدِ رگرسیونِ خاموش) ═══
  // چرا: یک‌بار پیش آمد که ایندکس‌های جدیدِ patches.sql روی سرور ساخته نشدند و
  // هیچ‌کس متوجه نشد، چون سرویسِ migrator ایمیجِ جداگانه‌ای دارد
  // (`target: migrator`) و `docker compose build app` آن را بازسازی نمی‌کند.
  // از این پس خودِ لاگِ دیپلوی فهرستِ ایندکس‌های کلیدیِ این سه جدول را چاپ
  // می‌کند تا «ساخته شد یا نه» در همان خروجیِ استقرار قابلِ خواندن باشد.
  // عمداً fail نمی‌کند: حذفِ آگاهانهٔ یک ایندکس نباید استقرار را بخواباند.
  try {
    const idx = await client.query(`
      SELECT tablename, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('student_requests', 'offering_professors', 'course_offerings', 'enrollments', 'student_ledger')
        AND (indexname LIKE 'idx_req_%' OR indexname LIKE 'idx_op_%' OR indexname LIKE 'idx_co_%'
             OR indexname LIKE 'idx_enr_%' OR indexname LIKE 'idx_ledger_%' OR indexname LIKE 'idx_student_ledger_%')
      ORDER BY tablename, indexname`);
    const byTable = new Map();
    for (const r of idx.rows) {
      if (!byTable.has(r.tablename)) byTable.set(r.tablename, []);
      byTable.get(r.tablename).push(r.indexname);
    }
    console.log(`📇 ایندکس‌های عملکردی (${idx.rowCount} عدد):`);
    for (const [t, list] of byTable) console.log(`   ${t}: ${list.join(', ')}`);

    // ایندکس‌هایی که اگر نبودند یعنی patches.sql اجرا نشده یا ایمیج کهنه است.
    const MUST_HAVE = ['idx_op_offering_staff', 'idx_co_prof_term', 'idx_enr_pending_grade', 'idx_req_uni_created', 'idx_ledger_balance_cover', 'idx_co_active_history'];
    const present = new Set(idx.rows.map((r) => r.indexname));
    const absent = MUST_HAVE.filter((n) => !present.has(n));
    if (absent.length) {
      console.warn(`⚠️ ایندکس‌های کلیدیِ غایب: ${absent.join(', ')}`);
      console.warn('   یعنی patches.sql این نسخه در این دیتابیس اعمال نشده — معمولاً چون ایمیجِ migrator');
      console.warn('   بازسازی نشده است. با «docker compose build migrator» و اجرای مجدد رفع می‌شود.');
    } else {
      console.log('✅ همهٔ ایندکس‌های کلیدیِ عملکردی موجودند.');
    }
  } catch (e) {
    console.warn(`⚠️ گزارشِ ایندکس‌ها خوانده نشد: ${e.message}`);
  }

  await client.query(`SELECT pg_advisory_unlock(hashtext('afagh_migrator'))`);
} catch (err) {
  console.error('❌ خطا در اعمال پچ‌ها:', err.message);
  process.exit(1);
} finally {
  await client.end();
}

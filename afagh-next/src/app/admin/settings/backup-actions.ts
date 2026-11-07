'use server';

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { desc } from 'drizzle-orm';
import { Pool } from 'pg';
import { pool } from '@/db';
import { db } from '@/db';
import { audit_logs } from '@/db/schema';
import { observePoolErrors } from '@/db/pool-errors';
import { S3, ARCHIVE_BUCKET, ensureBucket } from '@/lib/objectStore';
import { getSessionUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { assertAdmin, assertPlatformAdmin, isBackupAuthError } from '@/lib/backup-auth';
import { createWriteStream, createReadStream, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createZipStream } from '@/lib/zip-stream';

const log = createLogger({ mod: 'admin.backup' });

/** تبدیل خطای اکشن به پاسخِ ساختاریافته (پیام احراز هویت حفظ می‌شود، بقیه عمومی) */
function actionError(err: unknown, fallback: string): { ok: false; error: string } {
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, error: isBackupAuthError(err) ? msg : fallback };
}

// احراز هویتِ بدون redirect از `@/lib/backup-auth` وارد می‌شود (کد خطای تخصصی
// BackupAuthError) تا پیام فارسیِ تمیز به کلاینت برسد، نه دیالوگِ مرموزِ
// «An unexpected response» ناشی از redirect درون اکشن.

// ═══ استخر اختصاصی پشتیبان/بازیابی (فاز ۳) ═══
// پیش‌فرض: همان استخر مالک (`pool` از DATABASE_URL) تا رفتار امروز دست‌نخورده بماند.
// ⚠ ریسک باقی‌مانده در حالت پیش‌فرض: این نقش مالک (و در استقرارهای فعلی سوپرکاربر)
// است؛ دستورات DDL دامپ را اجرا می‌کند و RLS را دور می‌زند. یعنی هر نقص در همین
// اکشن، دسترسی کامل به دیتابیس است. برای حذف این ریسک، DATABASE_URL_BACKUP را به
// نقش کم‌مجوز afagh_backup بدهید (scripts/hardening.mjs آن را می‌سازد).
//
// سیاست «همه یا هیچ»: اگر متغیر تنظیم شده باشد و نقش کم‌مجوز خطا بدهد، هرگز به استخر
// مالک سقوط نمی‌کنیم — چون همین سقوط، همان ریسکی است که می‌خواهیم حذف کنیم.
const BACKUP_DB_URL = process.env.DATABASE_URL_BACKUP?.trim() ?? '';
const globalForBackup = globalThis as unknown as { backupPool?: Pool };
let warnedOwnerPoolFallback = false;

/** آیا مسیر کم‌مجوز فعال است؟ (تعیین‌کنندهٔ حالت بازیابی «داده‌به‌جای DDL») */
function usesDedicatedBackupRole(): boolean {
  return BACKUP_DB_URL.length > 0;
}

/** استخر پشتیبان: اختصاصی اگر DATABASE_URL_BACKUP باشد، وگرنه استخر مالک. */
function backupPool(): Pool {
  if (!BACKUP_DB_URL) {
    if (!warnedOwnerPoolFallback) {
      warnedOwnerPoolFallback = true;
      log.warn('backup_owner_pool_fallback', {
        detail: 'DATABASE_URL_BACKUP تنظیم نشده؛ پشتیبان/بازیابی با نقش مالک اجرا می‌شود (DDL + عبور از RLS).',
      });
    }
    return pool;
  }
  if (!globalForBackup.backupPool) {
    globalForBackup.backupPool = new Pool({ connectionString: BACKUP_DB_URL, max: 2 });
    observePoolErrors(globalForBackup.backupPool);
  }
  return globalForBackup.backupPool;
}

const REDACTED = '[REDACTED]';
/** جایگزین امن برای ستون‌های jsonb (رشتهٔ [REDACTED] در jsonb نامعتبر است و restore را می‌شکند) */
const REDACTED_JSON = '{"redacted":true}';
/** کلیدهای محرمانهٔ system_settings که مقدارشان هرگز در دامپ نمی‌آید */
const SECRET_SETTING_RE = /SECRET|TOKEN|KEY|PASSWORD/i;
/** رویدادهای حامل OTP — متن تحویل آن‌ها sanitize می‌شود */
const OTP_EVENT_RE = /OTP/i;
const BACKUP_SIGNATURE_MARKER = '-- AFAGH_BACKUP_SIGNATURE=';

function backupSigningKey(): Buffer {
  const value = process.env.AFAGH_BACKUP_SIGNING_KEY?.trim() ?? '';
  const key = Buffer.from(value, 'utf8');
  if (key.length < 32 || value.startsWith('CHANGE_ME_')) {
    throw new Error('کلید امضای پشتیبان تنظیم نشده است؛ بازیابی امن غیرفعال است.');
  }
  return key;
}

function signBackup(body: string): string {
  return createHmac('sha256', backupSigningKey()).update(body, 'utf8').digest('hex');
}

function verifyBackup(signedSql: string): string {
  if (typeof signedSql !== 'string' || Buffer.byteLength(signedSql, 'utf8') > 50 * 1024 * 1024) {
    throw new Error('فایل پشتیبان نامعتبر یا بزرگ‌تر از حد مجاز است.');
  }
  const match = /\r?\n-- AFAGH_BACKUP_SIGNATURE=([a-f0-9]{64})\r?\n?$/.exec(signedSql);
  if (!match) throw new Error('پشتیبان امضای معتبر ندارد؛ بازیابی فایل‌های قدیمی و امضانشده مجاز نیست.');
  const body = signedSql.slice(0, match.index);
  const supplied = Buffer.from(match[1], 'hex');
  const expected = Buffer.from(signBackup(body), 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('امضای پشتیبان معتبر نیست؛ هیچ دستوری اجرا نشد.');
  }
  return body;
}

/**
 * حذف مقادیر محرمانه از یک ردیف پیش از دامپ (درجا روی کپی ردیف).
 *
 * قاعده: هر ستونی که «محرمانه» است حذف می‌شود، حتی اگر امروز فقط هش/نام مستعار
 * باشد — چون ردیف‌های قدیمی هنوز مقدار خام دارند و دامپ باید مستقل از سنِ
 * ردیف امن باشد. ستون غایب بی‌اثر رد می‌شود (guard با `in`).
 */
function redactRow(table: string, row: Record<string, any>): void {
  if (table === 'system_settings' && SECRET_SETTING_RE.test(String(row.key ?? ''))) {
    row.value = REDACTED;
  } else if (table === 'users') {
    if ('passwordHash' in row) row.passwordHash = REDACTED;
  } else if (table === 'notification_deliveries' && OTP_EVENT_RE.test(String(row.eventCode ?? ''))) {
    row.body = REDACTED;
  } else if (table === 'notifications' && OTP_EVENT_RE.test(String(row.eventCode ?? ''))) {
    row.payload = REDACTED;
  } else if (table === 'verification_otps') {
    if ('otpCode' in row) row.otpCode = REDACTED;
    if ('otpHash' in row) row.otpHash = REDACTED;
  } else if (table === 'instructor_deliveries') {
    // توکن برداشت اوراق توسط استاد — bearer واقعی؛ حتی پس از هش‌شدن، ردیف قدیمی
    // مقدار خام دارد و نباید هرگز وارد فایل پشتیبان شود.
    if ('pickupToken' in row) row.pickupToken = REDACTED;
  } else if (table === 'student_cards') {
    // توکن امنیتی کارت دانشجویی — گیت حراست (/id/[token]) را باز می‌کند؛
    // دامپ نباید آن را به کسی بدهد که فقط دسترسی خواندن پشتیبان دارد.
    if ('secureToken' in row) row.secureToken = REDACTED;
  } else if (table === 'integrations_config') {
    // کلیدها و توکن‌های سرویس‌های ثالث (API key/secret) به‌صورت JSON خام
    // ذخیره می‌شوند → کل ستون حذف می‌شود، نه فقط چند کلید مشخص.
    if ('authCredentials' in row) row.authCredentials = REDACTED;
  } else if (table === 'api_audit_logs') {
    // بدنهٔ خام درخواست به سرویس‌های ثالث می‌رود و می‌تواند کد ملی/شمارهٔ تماس و
    // سایر PII خام را حمل کند → کل ستون حذف می‌شود.
    if ('requestPayload' in row) row.requestPayload = REDACTED;
  } else if (table === 'grade_submission_otps' || table === 'signature_otps' || table === 'doc_sign_otps') {
    // هش OTP امضای نمره/سند/قرارداد — حتی هش‌شده هم نباید در فایل پشتیبان باشد.
    if ('otpHash' in row) row.otpHash = REDACTED;
  } else if (table === 'document_signatures') {
    // OTP خامی که امضای سند با آن انجام شده (varchar(10)) — کاملاً محرمانه.
    if ('otpUsed' in row) row.otpUsed = REDACTED;
  } else if (table === 'messenger_link_tokens') {
    // هش توکن/کد پیوند پیام‌رسان + chatId معلق؛ مبنای احراز هویت در بات هستند.
    if ('tokenHash' in row) row.tokenHash = REDACTED;
    if ('codeHash' in row) row.codeHash = REDACTED;
    if ('pendingChatId' in row) row.pendingChatId = REDACTED;
  } else if (table === 'samin_connections') {
    // اعتبارنامهٔ ثمین به‌صورت رمزنگاری‌شده (AES-GCM) ذخیره می‌شود؛ کلید رمزگشایی
    // بیرون از دامپ است، اما ciphertext هم نباید در پشتیبان پخش شود.
    if ('clientSecretEnc' in row) row.clientSecretEnc = REDACTED;
    if ('passwordEnc' in row) row.passwordEnc = REDACTED;
    if ('tokenEnc' in row) row.tokenEnc = REDACTED;
  } else if (table === 'payment_gateways') {
    // config (jsonb) شامل merchantId/terminalId/apiKey/pin است → جایگزین JSON-معتبر.
    if ('config' in row) row.config = REDACTED_JSON;
  } else if (table === 'pos_terminals') {
    // config (jsonb) شامل اطلاعات شبکهٔ کارت‌خوان (ip/port/serial) است.
    if ('config' in row) row.config = REDACTED_JSON;
  } else if (table === 'payment_transactions') {
    // authority در ایندکس یکتا (uq_payment_txn_authority) است؛ برای حفظ قابلیت
    // restore مقدار یکتای هر ردیف می‌گذاریم، نه ثابت (وگرنه درج تکراری می‌شود).
    if ('authority' in row) row.authority = `${REDACTED}#${row.id ?? ''}`;
    if ('bankRefId' in row) row.bankRefId = REDACTED;
    if ('cardPan' in row) row.cardPan = REDACTED;
    if ('payerMobile' in row) row.payerMobile = REDACTED;
    if ('payerEmail' in row) row.payerEmail = REDACTED;
  }
}

/** ثبت ممیزی ایجاد پشتیبان در زنجیرهٔ audit_logs — خطا هرگز دانلود را خراب نمی‌کند */
async function auditBackup(tables: number): Promise<void> {
  try {
    const user = await getSessionUser().catch(() => null);
    const [last] = await db.select({ hash: audit_logs.hash }).from(audit_logs).orderBy(desc(audit_logs.id)).limit(1);
    const prevHash = last?.hash ?? '';
    const now = new Date();
    const action = 'BACKUP_CREATED';
    await db.insert(audit_logs).values({
      actorUserId: user?.id ?? null, action, entityType: 'database', entityId: null,
      details: JSON.stringify({ tables, redacted: true }), prevHash,
      hash: createHash('sha256').update(prevHash + '|' + action + '|' + now.toISOString()).digest('hex'),
    });
  } catch { /* ممیزی نباید جلوی پشتیبان را بگیرد */ }
}

// ═══ پشتیبان‌گیری ═══

/** لیست جداول کاربری (بدون جداول سیستمی) */
async function getUserTables(): Promise<string[]> {
  const res = await backupPool().query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' ORDER BY tablename
  `);
  return res.rows.map(r => r.tablename);
}

/** دامپ SQL از یک جدول */
async function dumpTable(table: string): Promise<string> {
  const cols = await backupPool().query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [table]);

  if (!cols.rows.length) return '';

  const colDefs = cols.rows.map(c => {
    const nullable = c.is_nullable === 'YES' ? '' : ' NOT NULL';
    const def = c.column_default ? ` DEFAULT ${c.column_default}` : '';
    return `  "${c.column_name}" ${c.data_type}${nullable}${def}`;
  });

  let sql = `DROP TABLE IF EXISTS "${table}" CASCADE;\n`;
  sql += `CREATE TABLE "${table}" (\n${colDefs.join(',\n')}\n);\n\n`;

  const data = await backupPool().query(`SELECT * FROM "${table}"`);
  if (data.rows.length === 0) return sql;

  const colNames = cols.rows.map(c => `"${c.column_name}"`).join(', ');
  const chunks: string[] = [];
  const BATCH = 500;

  for (let i = 0; i < data.rows.length; i += BATCH) {
    const batch = data.rows.slice(i, i + BATCH);
    const values = batch.map(orig => {
      const row: Record<string, any> = { ...orig };
      redactRow(table, row);
      const vals = cols.rows.map(c => {
        const v = row[c.column_name];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number') return String(v);
        if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
        if (v instanceof Date) return `'${v.toISOString()}'`;
        if (v instanceof Buffer) return `E'\\\\x${v.toString('hex')}'`;
        const s = String(v).replace(/'/g, "''").replace(/\\/g, '\\\\');
        return `'${s}'`;
      });
      return `(${vals.join(', ')})`;
    });
    chunks.push(`INSERT INTO "${table}" (${colNames}) VALUES\n${values.join(',\n')};\n`);
  }

  return sql + chunks.join('\n');
}

/** دامپ کل دیتابیس + امضای امن (برای بازیابی از UI). */
async function generateSignedDatabaseDump(): Promise<{ sql: string; tables: number }> {
  const tables = await getUserTables();
  const parts: string[] = [
    '-- ═══ پشتیبان آفاق — ' + new Date().toISOString() + ' ═══',
    '-- بازیابی: psql -U afagh -d afagh_db -f backup.sql',
    '',
  ];
  for (const t of tables) {
    const dump = await dumpTable(t);
    if (dump) parts.push(dump);
  }
  // دامپ sanitize شده است (ردکشن رازها) — ثبت ممیزی، بدون اثر بر خروجی دانلود
  await auditBackup(tables.length);
  const body = parts.join('\n').replace(/\r?\n+$/, '');
  const signature = signBackup(body);
  return { sql: `${body}\n${BACKUP_SIGNATURE_MARKER}${signature}\n`, tables: tables.length };
}

/** دامپ کل دیتابیس (مسیر سنتی: پاسخ inline — برای سازگاری باقی ماند). */
export async function backupDatabaseAction(): Promise<{ ok: boolean; sql?: string; error?: string; tables?: number }> {
  try {
    await assertPlatformAdmin();
    const { sql, tables } = await generateSignedDatabaseDump();
    return { ok: true, sql, tables };
  } catch (err: any) {
    log.error('database_backup_failed', { error: err instanceof Error ? err.message : String(err), auth: !!err?.auth });
    return actionError(err, 'ساخت پشتیبان دیتابیس ناموفق بود.');
  }
}

// ═══ بکاپ مستقیم از UI (جریانی، بدون پاسخ RSC حجیم) ═══
// دامپ/زیپ ابتدا در MinIO (کلید afagh-backup/) ذخیره می‌شود و کلاینت سپس از
// مسیر /api/admin/backup/download آن را به‌صورت جریانی دریافت می‌کند. این کار
// پاسخِ حجیمِ سروراکشن (که لبهٔ Arvan قطع می‌کرد) را حذف می‌کند و احراز هویت نیز
// پیام فارسیِ خوانا می‌دهد (نه دیالوگِ مرموز).

const BACKUP_KEY_PREFIX = 'afagh-backup/';

function backupKey(kind: 'db' | 'minio'): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rand = createHash('sha256').update(String(Math.random()) + ts + process.pid).digest('hex').slice(0, 16);
  return `${BACKUP_KEY_PREFIX}${kind}-${ts}-${rand}.${kind === 'db' ? 'sql' : 'zip'}`;
}

/** حذف بکاپ‌های قدیمی (فراتر از keep) تا باکت پر نشود. */
async function cleanupOldBackups(keep = 10): Promise<void> {
  try {
    const keys: string[] = [];
    for await (const obj of S3.listObjectsV2(ARCHIVE_BUCKET, BACKUP_KEY_PREFIX, true)) {
      if (obj.name) keys.push(obj.name);
    }
    keys.sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - keep))) {
      await S3.removeObject(ARCHIVE_BUCKET, old).catch(() => {});
    }
  } catch { /* بکاپ‌پاکسازی نباید جلوی بکاپ جدید را بگیرد */ }
}

/** بکاپ دیتابیس → ذخیره در MinIO → بازگرداندن کلید دانلود. */
export async function startDatabaseBackupAction(): Promise<{ ok: boolean; key?: string; size?: number; tables?: number; error?: string }> {
  try {
    await assertPlatformAdmin();
    const { sql, tables } = await generateSignedDatabaseDump();
    const key = backupKey('db');
    const buf = Buffer.from(sql, 'utf8');
    await S3.putObject(ARCHIVE_BUCKET, key, buf, buf.length, { 'Content-Type': 'text/plain; charset=utf-8' });
    await cleanupOldBackups();
    return { ok: true, key, size: buf.length, tables };
  } catch (err: any) {
    log.error('database_backup_start_failed', { error: err instanceof Error ? err.message : String(err), auth: !!err?.auth });
    return actionError(err, 'ساخت پشتیبان دیتابیس ناموفق بود.');
  }
}

/** بکاپ کل فایل‌های آرشیو (MinIO) → زیپ → ذخیره در MinIO → بازگرداندن کلید. */
export async function startMinioBackupAction(): Promise<{ ok: boolean; key?: string; size?: number; objects?: number; error?: string }> {
  try {
    await assertPlatformAdmin();
    await ensureBucket();
    const objects: string[] = [];
    for await (const obj of S3.listObjectsV2(ARCHIVE_BUCKET, '', true)) {
      // خودِ بکاپ‌ها را وارد بکاپ نمی‌کنیم (جلوگیری از بازگشتی).
      if (obj.name && !obj.name.startsWith(BACKUP_KEY_PREFIX)) objects.push(obj.name);
    }
    objects.sort();

    const key = backupKey('minio');
    const tmpDir = await mkdtemp(join(tmpdir(), 'afagh-bk-'));
    const tmpFile = join(tmpDir, 'minio-backup.zip');
    const writeStream = createWriteStream(tmpFile);

    const entries: AsyncIterable<{ name: string; data: Buffer }> = (async function* () {
      for (const name of objects) {
        const chunks: Buffer[] = [];
        const objStream = await S3.getObject(ARCHIVE_BUCKET, name);
        for await (const c of objStream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        yield { name, data: Buffer.concat(chunks) };
      }
    })();

    await pipeline(createZipStream(entries), writeStream);
    const size = statSync(tmpFile).size;
    // minio-js رشته را محتوای شیء می‌داند (نه مسیر فایل) ⇒ از stream فایل استفاده می‌کنیم.
    await S3.putObject(ARCHIVE_BUCKET, key, createReadStream(tmpFile), size, { 'Content-Type': 'application/zip' });
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await cleanupOldBackups();
    return { ok: true, key, size, objects: objects.length };
  } catch (err: any) {
    log.error('minio_backup_start_failed', { error: err instanceof Error ? err.message : String(err), auth: !!err?.auth });
    return actionError(err, 'ساخت بکاپ فایل‌ها ناموفق بود.');
  }
}

// ═══ پشتیبان MinIO ═══

export async function listMinioObjectsAction(): Promise<{ ok: boolean; objects?: { key: string; size: number; lastModified: Date }[]; error?: string }> {
  try {
    await assertAdmin();
    await ensureBucket();
    const exists = await S3.bucketExists(ARCHIVE_BUCKET);
    if (!exists) return { ok: true, objects: [] };

    const objects: { key: string; size: number; lastModified: Date }[] = [];
    const stream = S3.listObjectsV2(ARCHIVE_BUCKET, '', true);
    for await (const obj of stream) {
      if (obj.name) {
        objects.push({
          key: obj.name,
          size: obj.size || 0,
          lastModified: obj.lastModified || new Date(),
        });
      }
    }
    return { ok: true, objects };
  } catch (err: any) {
    log.error('minio_list_failed', { error: err instanceof Error ? err.message : String(err), auth: !!err?.auth });
    return actionError(err, 'دریافت فهرست فایل‌ها ناموفق بود.');
  }
}

export async function downloadMinioObjectAction(key: string): Promise<{ ok: boolean; data?: string; name?: string; error?: string }> {
  // اعتبارسنجی کلید: جلوگیری از traversal، جداکنندهٔ بک‌اسلش و کلیدهای خارج از bucket آرشیو.
  if (typeof key !== 'string' || key.length === 0 || key.length > 512 ||
      key.startsWith('/') || key.includes('..') || key.includes('\\') || key.includes('\u0000') ||
      !/^archive\/[A-Za-z0-9][A-Za-z0-9._\-\/]*$/i.test(key)) {
    return { ok: false, error: 'کلید فایل برای دریافت مجاز نیست.' };
  }
  try {
    await assertPlatformAdmin();
    const stream = await S3.getObject(ARCHIVE_BUCKET, key);
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 50 * 1024 * 1024;
    for await (const chunk of stream) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += b.length;
      if (total > MAX) {
        try { stream.destroy?.(); } catch { /* ignore */ }
        return { ok: false, error: 'حجم فایل از ۵۰ مگابایت بیشتر است.' };
      }
      chunks.push(b);
    }
    const buf = Buffer.concat(chunks);
    const name = key.split('/').pop() || key;
    return { ok: true, data: buf.toString('base64'), name };
  } catch (err: any) {
    log.error('minio_download_failed', { error: err instanceof Error ? err.message : String(err), auth: !!err?.auth });
    return actionError(err, 'دریافت فایل پشتیبان ناموفق بود.');
  }
}

// ═══ بازیابی ═══

/** نقل‌قول امن شناسه برای TRUNCATE (نام‌ها از دامپِ امضاشده می‌آیند، نه ورودی کاربر). */
function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * بازیابی «داده‌به‌جای DDL» برای نقش کم‌مجوز.
 *
 * دامپ فعلی برای هر جدول `DROP TABLE ...; CREATE TABLE ...; INSERT ...` می‌سازد.
 * DROP TABLE فقط با مالکیت جدول ممکن است و هیچ GRANTای مالکیت نمی‌دهد؛ پس با نقش
 * afagh_backup بخش DDL رد می‌شود و فقط داده اجرا می‌شود: یک TRUNCATE ... CASCADE و
 * سپس INSERTها. چون ترتیب الفبایی جداول با کلیدهای خارجی سازگار نیست، در همان
 * تراکنش session_replication_role=replica ست می‌شود (مجوزش را hardening می‌دهد)؛
 * این کار تریگرهای جانبی را هم در طول بازیابی خاموش می‌کند.
 */
async function restoreDataOnly(statements: string[], tables: string[]): Promise<number> {
  const client = await backupPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    if (tables.length) {
      await client.query(`TRUNCATE TABLE ${tables.map(quoteIdent).join(', ')} CASCADE`);
    }
    let executed = 0;
    for (const stmt of statements) {
      if (!/^INSERT\s+INTO\s/i.test(stmt)) continue;
      await client.query(stmt);
      executed++;
    }
    await client.query('COMMIT');
    return executed;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* اتصال ممکن است از دست رفته باشد */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function restoreDatabaseAction(sql: string): Promise<{ ok: boolean; error?: string; statements?: number }> {
  try {
    await assertPlatformAdmin();
    // فقط دامپی که خود سرور با کلید محرمانه امضا کرده باشد قابل اجراست؛
    // فایل دلخواه SQL هرگز مستقیماً به استخر پشتیبان فرستاده نمی‌شود.
    const verifiedSql = verifyBackup(sql);
    const statements: string[] = [];
    let current = '';
    for (const line of verifiedSql.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('--') || trimmed === '') continue;
      current += line + '\n';
      if (trimmed.endsWith(';')) {
        statements.push(current.trim());
        current = '';
      }
    }
    if (current.trim()) statements.push(current.trim());

    // مسیر کم‌مجوز (DATABASE_URL_BACKUP): دامپ همان قالب DROP/CREATE را دارد، اما
    // afagh_backup مالک جدول‌ها نیست و DROP/CREATE مجاز نیست. پس فقط داده اجرا می‌شود.
    // این مسیر عمداً به استخر مالک برنمی‌گردد (بدون سقوطِ بی‌صدای دسترسی).
    if (usesDedicatedBackupRole()) {
      const tables = [...new Set(
        [...verifiedSql.matchAll(/CREATE TABLE "((?:[^"]|"")+)"/g)]
          .map(m => m[1].replace(/""/g, '"')),
      )];
      const executed = await restoreDataOnly(statements, tables);
      return { ok: true, statements: executed };
    }

    // مسیر پیش‌فرض (نقش مالک): رفتار پیشین حفظ می‌شود — DROP/CREATE/INSERT.
    let executed = 0;
    for (const stmt of statements) {
      if (!stmt || stmt.startsWith('--')) continue;
      await pool.query(stmt);
      executed++;
    }
    return { ok: true, statements: executed };
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('database_restore_failed', { error: message });
    const safeErrors = new Set([
      'کلید امضای پشتیبان تنظیم نشده است؛ بازیابی امن غیرفعال است.',
      'فایل پشتیبان نامعتبر یا بزرگ‌تر از حد مجاز است.',
      'پشتیبان امضای معتبر ندارد؛ بازیابی فایل‌های قدیمی و امضانشده مجاز نیست.',
      'امضای پشتیبان معتبر نیست؛ هیچ دستوری اجرا نشد.',
      'سشن منقضی شده است؛ لطفاً دوباره وارد شوید.',
      'این عملیات نیازمند نقش ادمین است.',
      'این عملیات فقط برای مدیر پلتفرم مجاز است.',
    ]);
    return { ok: false, error: safeErrors.has(message) ? message : 'بازیابی دیتابیس ناموفق بود.' };
  }
}

export async function restoreMinioObjectAction(key: string, dataBase64: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertPlatformAdmin();
    // بازیابی فقط به کلیدهای تولیدشدهٔ اسناد آرشیو محدود است؛ از نوشتن در کلید
    // دلخواه یا مسیرهای دیگر bucket جلوگیری می‌شود.
    if (!/^archive\/[1-9]\d{0,9}\/[1-9]\d{0,9}-\d{10,13}-[a-f0-9]{16}\.(?:pdf|png|jpe?g|webp|gif|bmp)$/i.test(key)) {
      return { ok: false, error: 'کلید فایل برای بازیابی مجاز نیست.' };
    }
    if (typeof dataBase64 !== 'string' || dataBase64.length > 28_000_000 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64)) {
      return { ok: false, error: 'محتوای فایل نامعتبر یا بزرگ‌تر از حد مجاز است.' };
    }
    await ensureBucket();
    const buf = Buffer.from(dataBase64, 'base64');
    if (buf.length > 20 * 1024 * 1024) return { ok: false, error: 'حجم فایل از ۲۰ مگابایت بیشتر است.' };
    const ext = key.split('.').pop()?.toLowerCase() || 'bin';
    const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'png' ? 'image/png'
      : ext === 'pdf' ? 'application/pdf'
      : 'application/octet-stream';
    await S3.putObject(ARCHIVE_BUCKET, key, buf, buf.length, { 'Content-Type': contentType });
    return { ok: true };
  } catch (err: any) {
    log.error('minio_restore_failed', { error: err instanceof Error ? err.message : String(err), auth: !!err?.auth });
    return actionError(err, 'بازیابی فایل ناموفق بود.');
  }
}

// ═══ آمار ═══

export async function getBackupStatsAction(): Promise<{ ok: boolean; stats?: { tables: number; totalRows: number; dbSize: string; minioObjects: number; minioSize: string }; error?: string }> {
  try {
    await assertAdmin();
    const tables = await getUserTables();
    let totalRows = 0;
    for (const t of tables) {
      const r = await backupPool().query(`SELECT COUNT(*) as n FROM "${t}"`);
      totalRows += Number(r.rows[0].n);
    }

    const dbSizeRes = await backupPool().query(`SELECT pg_size_pretty(pg_database_size(current_database())) as size`);
    const dbSize = dbSizeRes.rows[0].size;

    let minioObjects = 0;
    let minioSize = 0;
    try {
      await ensureBucket();
      const exists = await S3.bucketExists(ARCHIVE_BUCKET);
      if (exists) {
        const stream = S3.listObjectsV2(ARCHIVE_BUCKET, '', true);
        for await (const obj of stream) {
          minioObjects++;
          minioSize += obj.size || 0;
        }
      }
    } catch {}

    const formatSize = (bytes: number) => {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    return {
      ok: true,
      stats: {
        tables: tables.length,
        totalRows,
        dbSize,
        minioObjects,
        minioSize: formatSize(minioSize),
      },
    };
  } catch (err: any) {
    log.error('backup_stats_failed', { error: err instanceof Error ? err.message : String(err), auth: !!err?.auth });
    return actionError(err, 'دریافت آمار پشتیبان ناموفق بود.');
  }
}

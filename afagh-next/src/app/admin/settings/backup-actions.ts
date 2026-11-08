'use server';

import { createHash, randomBytes } from 'crypto';
import { desc } from 'drizzle-orm';
import { Pool, type PoolClient } from 'pg';
import { pool, db } from '@/db';
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
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { createZipStream } from '@/lib/zip-stream';
import {
  backupSigningKey, backupSigningKeys, SignedBodyWriter, verifySignedBackup,
  MISSING_SIGNING_KEY_ERROR, INVALID_BACKUP_SIZE_ERROR,
  MISSING_SIGNATURE_ERROR, BAD_SIGNATURE_ERROR,
} from '@/lib/backup-signing';
import {
  buildSchemaDump, BACKUP_FORMAT, DR_MODE_MARKER, EXCLUDED_SCHEMAS,
  REQUIRED_ENV_KEYS, RESTORE_COMMAND, restoreGuide, type CatalogQuery,
} from '@/lib/backup-schema';
import { buildRowLiteralSql, insertHead } from '@/lib/backup-dump';
import { getBackupJobStore, type DbBackupJob } from '@/lib/backup-job-store';

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

// قواعد ردکشن و ساخت لیترال ردیفها در `src/lib/backup-dump.ts` قرار دارند
// (بدون `'use server'` ⇒ قابل تست مستقل).
// کلید/نشانگر/تأیید امضا در `src/lib/backup-signing.ts` قرار دارد (بدون
// `'use server'` ⇒ قابل تست مستقل). امضا با کلید صریح انجام میشود، ولی تأیید
// همۀ کلیدهای معتبر (صریح + مشتق قدیمی) را امتحان میکند ⇒ گردش کلید، بکاپهای
// آرشیوشده را بیاعتبار نمیکند.
let warnedDerivedSigningKey = false;

function signingKey(): Buffer {
  const { key, source } = backupSigningKey();
  if (source === 'derived' && !warnedDerivedSigningKey) {
    warnedDerivedSigningKey = true;
    log.warn('backup_signing_key_derived', {
      detail: 'AFAGH_BACKUP_SIGNING_KEY تنظیم نشده؛ کلید امضا از AFAGH_PII_KEY مشتق شد.',
    });
  }
  return key;
}

/** تأیید امضای فایل آپلودشده با همۀ کلیدهای معتبر (سازگار با بکاپهای قدیمی). */
function verifyBackup(signedSql: string): string {
  return verifySignedBackup(signedSql, backupSigningKeys().map(c => c.key));
}

/** ثبت ممیزی ایجاد پشتیبان در زنجیرهٔ audit_logs — خطا هرگز دانلود را خراب نمی‌کند */
async function auditBackup(tables: number, includeSecrets = false): Promise<void> {
  try {
    const user = await getSessionUser().catch(() => null);
    const [last] = await db.select({ hash: audit_logs.hash }).from(audit_logs).orderBy(desc(audit_logs.id)).limit(1);
    const prevHash = last?.hash ?? '';
    const now = new Date();
    const action = 'BACKUP_CREATED';
    await db.insert(audit_logs).values({
      actorUserId: user?.id ?? null, action, entityType: 'database', entityId: null,
      details: JSON.stringify({ tables, redacted: !includeSecrets, format: BACKUP_FORMAT }), prevHash,
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

// ═══ دامپ جریانی DR-ready (بدون رشتۀ غولپیکر) ═══
// دیتابیس پروداکشن ~۱ گیگابایت است. نسخۀ پیشین تمام ردیفها را در یک رشتۀ JS
// میریخت ⇒ «Invalid string length». اینجا یک تراکنش REPEATABLE READ READ ONLY
// اسنپشات میگیرد، DDL کامل را از همان اسنپشات میخواند (lib/backup-schema.ts)،
// سپس هر جدول با CURSOR سمتسرور FETCH میشود و بایتها بلافاصله به gzip/MinIO
// میروند؛ امضا هم افزایشی روی همان بایتها حساب میشود.
// لیترال ردیفها را خود Postgres با quote_nullable میسازد (lib/backup-dump.ts)
// ⇒ jsonb/array/bytea و بکاسلشها دیگر فاسد نمیشوند.

// صفحة بزرگتر ⇒ رفتوبرگشت کمتر با Postgres در دیتابیس ۱ گیگابایتی.
const DUMP_FETCH_SIZE = 2000;

/** نقلقول امن شناسه (نامها از کاتالوگ میآیند، نه ورودی کاربر). */
function quoteIdent(name: string): string {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

/**
 * آمادهسازی جریان SQL امضاشده و کاملاً قابل بازیابی. یک اتصال اختصاصی + تراکنش
 * اسنپشات تا پایان مصرف جریان نگه داشته میشود؛ `finally` ژنراتور همیشه آزادسازی
 * اتصال را تضمین میکند (حتی اگر آپلود MinIO نیمهراه شکست بخورد).
 */
async function openSignedDumpStream(includeSecrets = false): Promise<{ stream: Readable; tables: number }> {
  const client: PoolClient = await backupPool().connect();
  let committed = false;
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    if (!committed) {
      try { await client.query('ROLLBACK'); } catch { /* اتصال ممکن است بسته شده باشد */ }
    }
    client.release();
  };

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const q: CatalogQuery = async (sql, params = []) => {
      const r = await client.query(sql, params as any[]);
      return { rows: r.rows };
    };
    // DDL و داده دقیقاً از یک اسنپشات خوانده میشوند (سازگاری کامل schema/data).
    const { pre, post, manifest, dataTables } = await buildSchemaDump(q);
    const writer = new SignedBodyWriter(signingKey());

    async function* gen(): AsyncGenerator<Buffer> {
      try {
        function* feed(text: string): Generator<Buffer> {
          const buf = writer.push(text);
          if (buf.length) yield buf;
        }

        const now = new Date().toISOString();
        const meta = {
          format: BACKUP_FORMAT,
          generatedAt: now,
          ...manifest,
          excludedSchemas: [...EXCLUDED_SCHEMAS],
          redacted: !includeSecrets,
          requiredEnv: [...REQUIRED_ENV_KEYS],
          restoreCommand: RESTORE_COMMAND,
        };
        yield* feed(`-- ═══ پشتیبان آفاق — ${now} ═══\n`);
        yield* feed(`${DR_MODE_MARKER}\n`);
        yield* feed(`-- AFAGH_BACKUP_REDACTED=${includeSecrets ? 'false' : 'true'}\n`);
        yield* feed(`-- AFAGH_BACKUP_MANIFEST=${JSON.stringify(meta)}\n`);
        for (const line of restoreGuide().split('\n')) yield* feed(`-- ${line}\n`);
        yield* feed('\n');

        yield* feed('-- ═══ بخش ۱/۳: ساختار (اسکیما، sequenceها، جدولها) ═══\n\n');
        yield* feed(pre);
        yield* feed('\n-- ═══ بخش ۲/۳: دادهها ═══\n\n');

        for (const t of dataTables) {
          const tableRef = `${quoteIdent(t.schema)}.${quoteIdent(t.name)}`;
          // لیترالها سمت سرور ساخته میشوند؛ فقط یک رشته از هر ردیف به Node میآید.
          const expr = buildRowLiteralSql(t.schema, t.name, t.insertColumns, !includeSecrets);
          const head = insertHead(t.schema, t.name, t.insertColumns, t.hasIdentityAlways);
          await client.query(
            `DECLARE afagh_bk_cursor CURSOR FOR SELECT ${expr} AS "__afagh_row_literal" FROM ${tableRef}`,
          );
          try {
            for (;;) {
              const page = await client.query(`FETCH ${DUMP_FETCH_SIZE} FROM afagh_bk_cursor`);
              if (!page.rows.length) break;
              const values = page.rows.map((r: any) => String(r.__afagh_row_literal));
              yield* feed(`${head}${values.join(',\n')};\n`);
            }
          } finally {
            await client.query('CLOSE afagh_bk_cursor').catch(() => {});
          }
        }

        yield* feed('\n-- ═══ بخش ۳/۳: قیود، ایندکسها، RLS، GRANTها، setval ═══\n\n');
        yield* feed(post);

        // دامپ sanitize شده است (ردکشن رازها) — ثبت ممیزی، بدون اثر بر خروجی.
        await auditBackup(dataTables.length, includeSecrets);
        yield writer.finish();
        await client.query('COMMIT');
        committed = true;
      } finally {
        await release();
      }
    }

    return { stream: Readable.from(gen(), { objectMode: false }), tables: dataTables.length };
  } catch (err) {
    await release();
    throw err;
  }
}

/** مسیر قدیمی inline: فقط دامپهای کوچک؛ برای پروداکشن خطای تمیز میدهد. */
const MAX_INLINE_SQL = 16 * 1024 * 1024;

async function collectSignedDump(): Promise<{ sql: string; tables: number }> {
  const { stream, tables } = await openSignedDumpStream();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += b.length;
    if (total > MAX_INLINE_SQL) {
      stream.destroy();
      throw new Error('حجم دامپ برای پاسخ inline بیش از حد است؛ از دکمهٔ دانلود پشتیبان استفاده کنید.');
    }
    chunks.push(b);
  }
  return { sql: Buffer.concat(chunks).toString('utf8'), tables };
}

export async function backupDatabaseAction(): Promise<{ ok: boolean; sql?: string; error?: string; tables?: number }> {
  try {
    await assertPlatformAdmin();
    const { sql, tables } = await collectSignedDump();
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
  return `${BACKUP_KEY_PREFIX}${kind}-${ts}-${rand}.${kind === 'db' ? 'sql.gz' : 'zip'}`;
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

/** اجرای واقعی دامپ → فایل موقت gzip → MinIO (مشترکِ مسیر همزمان و پسزمینه). */
async function performDatabaseBackup(includeSecrets = false): Promise<{ key: string; size: number; tables: number }> {
  let tmpDir: string | undefined;
  try {
    const { stream, tables } = await openSignedDumpStream(includeSecrets);
    const key = backupKey('db');
    tmpDir = await mkdtemp(join(tmpdir(), 'afagh-db-bk-'));
    const tmpFile = join(tmpDir, 'db-backup.sql.gz');
    // level 1: روی SQL تکرارپذیر همچنان فشردهسازی خوبی میدهد ولی چند برابر
    // سریعتر است — مهم است چون دامپ پروداکشن دقیقهای طول میکشد.
    await pipeline(stream, createGzip({ level: 1 }), createWriteStream(tmpFile));
    const size = statSync(tmpFile).size;
    // minio-js رشته را محتوای شیء میداند ⇒ استریم فایل + اندازة معلوم (multipart).
    await S3.putObject(ARCHIVE_BUCKET, key, createReadStream(tmpFile), size, { 'Content-Type': 'application/gzip' });
    await cleanupOldBackups();
    return { key, size, tables };
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** بکاپ دیتابیس (همزمان) → جریانی به فایل موقت (gzip) → MinIO → کلید دانلود. */
export async function startDatabaseBackupAction(): Promise<{ ok: boolean; key?: string; size?: number; tables?: number; error?: string }> {
  try {
    await assertPlatformAdmin();
    const r = await performDatabaseBackup();
    return { ok: true, ...r };
  } catch (err: any) {
    log.error('database_backup_start_failed', { error: err instanceof Error ? err.message : String(err), auth: !!err?.auth });
    return actionError(err, 'ساخت پشتیبان دیتابیس ناموفق بود.');
  }
}

// ═══ اجرای پسزمینه (جلوگیری از تایماوت لبهٔ CDN) ═══
// دامپ پروداکشن حدود ۱۰۰–۱۴۰ ثانیه طول میکشد. نگهداشتنِ درخواست اکشن تا پایان،
// لبهٔ CDN را به ۵۰۴ و دیالوگ مرموز «An unexpected response» میکشاند. اکشن
// فقط یک jobId برمیگرداند و کار سنگین بهصورت Promise شناور ادامه مییابد؛
// کلاینت هر ۲ ثانیه وضعیت را پول میکند و بعد دانلود را آغاز مینماید.
// وضعیت در Redis (با TTL) مشترک بین replicaهاست + کش محلی بهعنوان fallback
// ⇒ پول روی هر کانتینری برود جواب میگیرد (lib/backup-job-store.ts).

async function runDatabaseBackupJob(id: string, startedAt: number, includeSecrets: boolean): Promise<void> {
  const t0 = Date.now();
  const store = getBackupJobStore();
  try {
    const r = await performDatabaseBackup(includeSecrets);
    const job: DbBackupJob = {
      id, startedAt, includeSecrets, status: 'done',
      key: r.key, size: r.size, tables: r.tables,
    };
    await store.put(job);
    log.info('database_backup_job_done', { tables: r.tables, size: r.size, ms: Date.now() - t0, store: store.source() });
  } catch (err: any) {
    const error = err instanceof Error ? err.message : String(err);
    await store.put({ id, startedAt, includeSecrets, status: 'failed', error });
    log.error('database_backup_job_failed', { error, ms: Date.now() - t0 });
  }
}

/** آغاز پشتیبانگیری در پسزمینه — پاسخ فوری، بدون انتظار ۲ دقیهای. */
export async function startDatabaseBackupJobAction(includeSecrets = false): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  try {
    await assertPlatformAdmin();
    // ورودی سروراکشن غیرقابلاعتماد است: فقط true بولی دقیقاً حالت «کامل» را فعال میکند.
    const full = includeSecrets === true;
    const store = getBackupJobStore();
    store.prune();
    const id = randomBytes(16).toString('hex');
    const startedAt = Date.now();
    await store.put({ id, startedAt, includeSecrets: full, status: 'running' });
    void runDatabaseBackupJob(id, startedAt, full).catch((e) => {
      log.error('database_backup_job_unhandled', { error: e instanceof Error ? e.message : String(e) });
    });
    return { ok: true, jobId: id };
  } catch (err: any) {
    return actionError(err, 'آغاز پشتیبانگیری ناموفق بود.');
  }
}

/** پولینگ وضعیت کار — فقط ادمین پلتفرم، و فقط شناسهٔ ۳۲ هکزی معتبر. */
export async function getDatabaseBackupJobAction(jobId: string): Promise<{ ok: boolean; status?: 'running' | 'done' | 'failed'; key?: string; size?: number; tables?: number; error?: string }> {
  try {
    await assertPlatformAdmin();
    if (typeof jobId !== 'string' || !/^[a-f0-9]{32}$/.test(jobId)) {
      return { ok: false, error: 'شناسهٔ کار نامعتبر است.' };
    }
    const job = await getBackupJobStore().get(jobId);
    if (!job) return { ok: false, error: 'کار پشتیبانگیری یافت نشد یا منقضی شده است؛ دوباره تلاش کنید.' };
    return { ok: true, status: job.status, key: job.key, size: job.size, tables: job.tables, error: job.error };
  } catch (err: any) {
    return actionError(err, 'دریافت وضعیت پشتیبانگیری ناموفق بود.');
  }
}

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

    // کلید پشتیبانهای دیتابیس موجود (برای پیوند دادن بستۀ فایلها به دامپ SQL).
    const dbKeys: string[] = [];
    try {
      for await (const obj of S3.listObjectsV2(ARCHIVE_BUCKET, BACKUP_KEY_PREFIX, true)) {
        if (obj.name && /^afagh-backup\/db-.*\.sql\.gz$/.test(obj.name)) dbKeys.push(obj.name);
      }
    } catch { /* نبود فهرست نباید بستۀ فایلها را خراب کند */ }
    dbKeys.sort();

    // بستۀ پیکربندی: فقط «نام» متغیرها و اینکه تنظیم شدهاند یا نه. هیچ مقدار
    // محرمانهای (رمز DB، PII_KEY، کلید MinIO) وارد فایل قابلدانلود نمیشود.
    const envManifest = REQUIRED_ENV_KEYS.map(name => ({ name, set: !!process.env[name]?.trim() }));
    const bundle = {
      format: BACKUP_FORMAT,
      generatedAt: new Date().toISOString(),
      archiveObjects: objects.length,
      dbBackupKeys: dbKeys.slice(-5),
      excludedSchemas: [...EXCLUDED_SCHEMAS],
      requiredEnv: envManifest,
      secretsPolicy: 'مقادیر env عمداً در بسته نیستند؛ از خزانهٔ اسرار سازمان بازگردانید.',
      restoreCommand: RESTORE_COMMAND,
    };

    const key = backupKey('minio');
    const tmpDir = await mkdtemp(join(tmpdir(), 'afagh-bk-'));
    const tmpFile = join(tmpDir, 'minio-backup.zip');
    const writeStream = createWriteStream(tmpFile);

    const entries: AsyncIterable<{ name: string; data: Buffer }> = (async function* () {
      yield { name: 'MANIFEST.json', data: Buffer.from(JSON.stringify(bundle, null, 2), 'utf8') };
      yield { name: 'RESTORE.md', data: Buffer.from(restoreGuide(), 'utf8') };
      yield { name: 'env/required-env.json', data: Buffer.from(JSON.stringify(envManifest, null, 2), 'utf8') };
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
    // دامپ DR ساختار کامل دارد (DROP SCHEMA + DO$$ + CREATE POLICY + GRANT) و
    // پارسِر سادۀ خطبهخط این اکشن برایش طراحی نشده؛ اجرای آن از روی UI میتواند
    // دیتابیس زنده را نیمهکاره رها کند. مسیر رسمیِ آن psql خط فرمان است.
    if (verifiedSql.includes(DR_MODE_MARKER)) {
      return {
        ok: false,
        error: `این پشتیبانِ کاملِ ساختاری است؛ بازیابی آن فقط از خط فرمان مجاز است: ${RESTORE_COMMAND}`,
      };
    }
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
      MISSING_SIGNING_KEY_ERROR,
      INVALID_BACKUP_SIZE_ERROR,
      MISSING_SIGNATURE_ERROR,
      BAD_SIGNATURE_ERROR,
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

/**
 * گارد وضعیت کارهای پشتیبانگیری پسزمینه (Redis + fallback محلی).
 * هدف اصلی: پولینگ روی یک replica/پروسس *دیگر* نباید «کار یافت نشد» بدهد.
 * هیچ اتصال واقعی به Redis برقرار نمیشود — فقط یک KV قلابی تزریق میگردد.
 */
import {
  createBackupJobStore, parseBackupJob, JOB_TTL_MS,
  type BackupJobKv, type DbBackupJob,
} from '../src/lib/backup-job-store';

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};

const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function fakeKv(): BackupJobKv & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(k) { return data.get(k) ?? null; },
    async set(k, v) { data.set(k, v); },
  };
}

function job(over: Partial<DbBackupJob> = {}): DbBackupJob {
  return { id: ID, startedAt: 1_000, includeSecrets: false, status: 'running', ...over };
}

async function main(): Promise<void> {
  console.log('— پارس دفاعی رکورد Redis —');
  ok(parseBackupJob(null) === null, 'رکورد خالی ⇒ null');
  ok(parseBackupJob('not-json') === null, 'JSON خراب ⇒ null');
  ok(parseBackupJob(JSON.stringify({ id: 'bad', startedAt: 1, status: 'done' })) === null, 'شناسهٔ نامعتبر ⇒ null');
  ok(parseBackupJob(JSON.stringify({ id: ID, startedAt: 1, status: 'weird' })) === null, 'وضعیت ناشناخته ⇒ null');
  const parsed = parseBackupJob(JSON.stringify({ id: ID, startedAt: 1, status: 'done', key: 'k', includeSecrets: true, junk: 1 }));
  ok(parsed?.status === 'done' && parsed.key === 'k' && parsed.includeSecrets === true, 'رکورد معتبر پاکسازی و پارس شد');
  ok(parsed !== null && !('junk' in parsed), 'فیلدهای اضافی به اکشن برنمیگردند');

  console.log('\n— حافظهٔ محلی (بدون Redis) —');
  let clock = 10_000;
  const mem = createBackupJobStore({ now: () => clock });
  ok(mem.source() === 'memory', 'بدون KV ⇒ منبع memory گزارش شد');
  await mem.put(job());
  ok((await mem.get(ID))?.status === 'running', 'job در حال اجرا خوانده شد');
  await mem.put(job({ status: 'done', key: 'afagh-backup/db-x.sql.gz', size: 123, tables: 258 }));
  const done = await mem.get(ID);
  ok(done?.status === 'done' && !!done.key?.endsWith('.sql.gz') && done.tables === 258, 'پولینگ نتیجهٔ نهایی را میبیند');
  ok((await mem.get('z'.repeat(32))) === null, 'شناسهٔ ناموجود ⇒ null');
  ok((await mem.get('../etc')) === null, 'شناسهٔ مخرب ⇒ null');
  clock += JOB_TTL_MS + 1;
  ok((await mem.get(ID)) === null, 'job پس از TTL منقضی میشود');
  mem.prune();
  clock = 10_000;
  ok((await mem.get(ID)) === null, 'prune رکورد منقضی را پاک کرده است');

  console.log('\n— مشترک بین دو replica —');
  const kv = fakeKv();
  const a = createBackupJobStore({ kv, now: () => 10_000 });
  const b = createBackupJobStore({ kv, now: () => 10_000 });  // کش محلی جدا
  ok(a.source() === 'redis' && b.source() === 'redis', 'هر دو store از Redis استفاده میکنند');
  await a.put(job({ startedAt: 10_000, status: 'failed', error: 'قطع MinIO' }));
  const seen = await b.get(ID);
  ok(seen?.status === 'failed' && seen.error === 'قطع MinIO', 'پول روی پروسس دیگر وضعیت را از Redis خواند');
  ok(kv.data.size === 1, 'یک کلید با پیشوند afagh:backup:job ساخته شد');

  console.log('\n— قطعی Redis (fail-open امن) —');
  const broken: BackupJobKv = {
    async get() { throw new Error('ECONNREFUSED'); },
    async set() { throw new Error('ECONNREFUSED'); },
  };
  const resilient = createBackupJobStore({ kv: broken, now: () => 20_000 });
  await resilient.put(job({ startedAt: 20_000 }));
  ok((await resilient.get(ID))?.status === 'running', 'خطای Redis در نوشتن/خواندن اکشن را نمیشکند (کش محلی)');

  const corrupt = fakeKv();
  corrupt.data.set('afagh:backup:job:' + ID, '{oops');
  const isolated = createBackupJobStore({ kv: corrupt, now: () => 30_000 });
  ok((await isolated.get(ID)) === null, 'رکورد خراب Redis ⇒ null (نه استثناء)');

  console.log(`\n${pass} قبول / ${fail} رد`);
  if (fail) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });

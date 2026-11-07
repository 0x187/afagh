/**
 * گارد `scripts/restore-db-backup.mjs` — فقط «دروازهها» تست میشوند، هیچ psql
 * واقعی و هیچ دیتابیسی در کار نیست (همۀ حالتها قبل از اجرای SQL متوقف میشوند).
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { SignedBodyWriter, backupSigningKey } from '../src/lib/backup-signing';

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};

const PII = 'r'.repeat(64);
const script = join(process.cwd(), 'scripts/restore-db-backup.mjs');
const dir = mkdtempSync(join(tmpdir(), 'afagh-restore-'));

function signed(marker: boolean): Buffer {
  const { key } = backupSigningKey({ AFAGH_PII_KEY: PII });
  const w = new SignedBodyWriter(key);
  const parts: Buffer[] = [];
  for (const text of [
    '-- AFAGH_BACKUP_MANIFEST=' + JSON.stringify({ format: 'afagh-dr/1', redacted: true }) + '\n',
    marker ? '-- AFAGH_BACKUP_MODE=dr-schema\n' : '-- old data-only dump\n',
    'INSERT INTO public.users (id) VALUES (1);\n',
  ]) {
    const b = w.push(text);
    if (b.length) parts.push(b);
  }
  parts.push(w.finish());
  return Buffer.concat(parts);
}

function run(args: string[], extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AFAGH_BACKUP_SIGNING_KEY: '',
      AFAGH_PII_KEY: PII,
      DATABASE_URL: '',
      ...extra,
    },
  });
}

try {
  const good = join(dir, 'dr.sql.gz');
  writeFileSync(good, gzipSync(signed(true)));

  const help = run(['--help']);
  ok(help.status === 0 && help.stdout.includes('--dry-run'), '--help بدون نیاز به فایل کار میکند');
  ok(run([]).status === 2, 'نبود فایل ⇒ کد ۲ (استفاده)');
  ok(run([join(dir, 'missing.sql.gz')]).status === 3, 'فایل ناموجود ⇒ کد ۳');

  const noConfirm = run([good]);
  ok(noConfirm.status === 6, 'بدون --yes هیچ بازیابی انجام نمیشود (کد ۶)');

  const dry = run([good, '--dry-run']);
  ok(dry.status === 0 && dry.stdout.includes('DRY_RUN_OK=yes'), 'dry-run تأیید امضا/قالب را کامل میکند');
  ok(dry.stdout.includes('SIGNATURE_MATCH=true') && dry.stdout.includes('REDACTED=true'), 'dry-run نتیجهٔ امضا و manifest را چاپ میکند');

  const tampered = Buffer.from(signed(true));
  const at = tampered.indexOf(Buffer.from('(1)'));
  if (at >= 0) tampered[at + 1] = tampered[at + 1] ^ 0x01;
  const bad = join(dir, 'bad.sql.gz');
  writeFileSync(bad, gzipSync(tampered));
  const badRun = run([bad, '--yes']);
  ok(badRun.status === 5 && /هیچ دستور SQL/.test(badRun.stderr ?? ''), 'امضای نامعتبر ⇒ کد ۵، پیش از هر SQL');

  const legacy = join(dir, 'legacy.sql.gz');
  writeFileSync(legacy, gzipSync(signed(false)));
  ok(run([legacy, '--dry-run']).status === 4, 'دامپ قدیمی data-only ⇒ کد ۴ (رد قبل از امضا)');

  const noUrl = run([good, '--yes']);
  ok(noUrl.status === 7, 'نبود DATABASE_URL ⇒ کد ۷');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} قبول / ${fail} رد`);
if (fail) process.exit(1);

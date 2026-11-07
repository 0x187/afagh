/**
 * ════════════════════════════════════════════════════════════════════════
 *  گاردِ ساختار ZIP‑سازِ streaming (store) — src/lib/zip-stream.ts
 *
 *  چرا وجود دارد:
 *    بکاپِ فایل‌های آرشیو (MinIO) درون یک ZIP (بدون فشرده‌سازی) بسته‌بندی و از
 *    مسیر /api/admin/backup/download جریانی سرو می‌شود. اگر نویسندهٔ ZIP اشتباه
 *    باشد (سیگنچر/اندازه/CRC)، فایلِ بکاپ برای ابزارهای استاندارد غیرقابل استخراج
 *    می‌شود و بکاپْ بی‌ارزش می‌گردد. این تست ساختار خروجی را بدون وابستگی به یک
 *    کتابخونهٔ unzip خارجی تأیید می‌کند.
 * ════════════════════════════════════════════════════════════════════════
 */
import { Readable } from 'node:stream';
import { createZipStream, type ZipEntry } from '../src/lib/zip-stream';

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};

function collect(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: unknown) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function countSig(buf: Buffer, sig: number): number {
  const b = Buffer.alloc(4); b.writeUInt32LE(sig, 0);
  let n = 0;
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === b[0] && buf[i + 1] === b[1] && buf[i + 2] === b[2] && buf[i + 3] === b[3]) n++;
  }
  return n;
}

async function main() {
  const entries: ZipEntry[] = [
    { name: 'a.txt', data: Buffer.from('hello') },
    { name: 'dir/b.txt', data: Buffer.from('world!!') },
  ];
  const buf = await collect(createZipStream((async function* () {
    for (const e of entries) yield e;
  })()));

  console.log('— ساختار ZIP (store) —');
  ok(buf.slice(0, 4).toString('hex') === '504b0304', 'با سیگنچر local file header (PK\\x03\\x04) شروع می‌شود');
  ok(countSig(buf, 0x04034b50) === entries.length, `local header برابر تعداد ورودی‌ها (${entries.length})`);
  ok(countSig(buf, 0x02014b50) === entries.length, 'central directory header برابر تعداد ورودی‌ها');
  ok(countSig(buf, 0x06054b50) === 1, 'دقیقاً یک End-Of-Central-Directory');
  ok(countSig(buf, 0x08074b50) === entries.length, 'data descriptor برای هر ورودی (flag 0x0008)');
  ok(buf.includes(Buffer.from('hello')), 'دادهٔ a.txt به‌صورت store حضور دارد');
  ok(buf.includes(Buffer.from('world!!')), 'دادهٔ dir/b.txt به‌صورت store حضور دارد');

  console.log(`\n${pass} قبول / ${fail} رد`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

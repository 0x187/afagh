import { Readable } from 'node:stream';

/**
 * ZIP writer بسیار سبک — فقط حالت store (بدون فشرده‌سازی).
 *
 * برای بکاپِ فایل‌های آرشیو (MinIO) به‌کار می‌رود؛ چون اکثر فایل‌ها (PDF/JPG/PNG)
 * خودشان قبلاً فشرده شده‌اند، حذف فشرده‌سازی اشکالی ندارد و پیاده‌سازی را ساده و
 * قابل‌اعتماد نگه می‌دارد. خروجی یک Node Readable است که می‌توان آن را مستقیماً
 * به فایل یا پاسخ HTTP pipe کرد (جریانی → حافظهٔ کم).
 *
 * از data descriptor (flag 0x0008) استفاده می‌کند تا اندازه/CRC پیش از نوشتن
 * داده مشخص نشود و بتوان هم‌زمان جریانی تولید کرد.
 */

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): [number, number] {
  const time =
    ((d.getUTCHours() & 0x1f) << 11) |
    ((d.getUTCMinutes() & 0x3f) << 5) |
    ((Math.floor(d.getUTCSeconds() / 2)) & 0x1f);
  const date =
    (((d.getUTCFullYear() - 1980) & 0x7f) << 9) |
    (((d.getUTCMonth() + 1) & 0xf) << 5) |
    (d.getUTCDate() & 0x1f);
  return [time, date];
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function createZipStream(entries: AsyncIterable<ZipEntry>): Readable {
  const gen = (async function* () {
    const [time, date] = dosDateTime(new Date());
    const central: Buffer[] = [];
    let offset = 0;
    let count = 0;

    for await (const e of entries) {
      const nameBuf = Buffer.from(e.name, 'utf8');
      const crc = crc32(e.data);
      const size = e.data.length;

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); // local file header signature
      local.writeUInt16LE(20, 4); // version needed
      local.writeUInt16LE(0x0008, 6); // flags: data descriptor present
      local.writeUInt16LE(0, 8); // compression: store
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(0, 14); // crc32 (deferred)
      local.writeUInt32LE(0, 18); // compressed size (deferred)
      local.writeUInt32LE(0, 22); // uncompressed size (deferred)
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28); // extra field length
      yield local;
      yield nameBuf;
      yield e.data;

      const dd = Buffer.alloc(16);
      dd.writeUInt32LE(0x08074b50, 0); // data descriptor signature
      dd.writeUInt32LE(crc, 4);
      dd.writeUInt32LE(size, 8);
      dd.writeUInt32LE(size, 12);
      yield dd;

      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0); // central directory header signature
      cd.writeUInt16LE(20, 4); // version made by
      cd.writeUInt16LE(20, 6); // version needed
      cd.writeUInt16LE(0x0008, 8); // flags
      cd.writeUInt16LE(0, 10); // compression: store
      cd.writeUInt16LE(time, 12);
      cd.writeUInt16LE(date, 14);
      cd.writeUInt32LE(crc, 16);
      cd.writeUInt32LE(size, 20);
      cd.writeUInt32LE(size, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt16LE(0, 30); // extra
      cd.writeUInt16LE(0, 32); // comment
      cd.writeUInt16LE(0, 34); // disk number start
      cd.writeUInt16LE(0, 36); // internal attrs
      cd.writeUInt32LE(0, 38); // external attrs
      cd.writeUInt32LE(offset, 42); // relative offset of local header
      central.push(cd, nameBuf);

      offset += local.length + nameBuf.length + e.data.length + dd.length;
      count++;
      void date; // (date ثابت است؛ برای خوانایی نگه داشته شد)
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const piece of central) {
      yield piece;
      cdSize += piece.length;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
    eocd.writeUInt16LE(0, 4); // disk number
    eocd.writeUInt16LE(0, 6); // disk with central dir
    eocd.writeUInt16LE(count, 8); // entries on this disk
    eocd.writeUInt16LE(count, 10); // total entries
    eocd.writeUInt32LE(cdSize, 12); // central dir size
    eocd.writeUInt32LE(cdStart, 16); // central dir offset
    eocd.writeUInt16LE(0, 20); // comment length
    yield eocd;
  })();

  return Readable.from(gen);
}

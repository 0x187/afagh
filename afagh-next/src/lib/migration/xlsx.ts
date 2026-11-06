// ═══ خواندن/نوشتن فایل اکسل (xlsx) بدون هیچ وابستگی بیرونی ═══
// xlsx در واقع یک آرشیو ZIP از چند فایل XML است. اینجا هم ZIP و هم XML لازم را
// خودمان می‌خوانیم/می‌سازیم تا:
//   • حجم ایمیج داکر و مصرف حافظهٔ بیلد بالا نرود (رفع OOM قبلی)
//   • وابستگی به کتابخانه‌های دارای CVE (نسخه‌های قدیمی SheetJS روی npm) نداشته باشیم
//   • کنترل کامل روی متن فارسی، راست‌به‌چپ و تاریخ داشته باشیم
import { deflateRawSync, inflateRawSync } from 'zlib';

// ────────────────────────────── ZIP ──────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const TOO_BIG = 'فایل اکسل بیش از حد بزرگ است (احتمال فشرده‌سازی مخرب).';

/** استخراج همهٔ عضوهای یک آرشیو ZIP (روش‌های store و deflate) */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let total = 0;
  // «پایان دایرکتوری مرکزی» را از انتها پیدا می‌کنیم (ممکن است کامنت داشته باشد)
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('فایل اکسل معتبر نیست (ساختار ZIP یافت نشد).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    if (buf.readUInt32LE(p + 24) > MAX_ENTRY_BYTES) throw new Error(TOO_BIG);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (!name.endsWith('/')) {
      let data: Buffer;
      try {
        data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
      } catch (e) {
        if (e instanceof RangeError) throw new Error(TOO_BIG);
        throw new Error('فایل اکسل فشرده‌سازی معتبر ندارد.');
      }
      total += data.length;
      if (total > MAX_TOTAL_BYTES) throw new Error(TOO_BIG);
      out.set(name, data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** ساخت آرشیو ZIP از فهرست فایل‌ها (همه با deflate) */
export function zip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const comp = deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);            // نسخهٔ لازم
    lh.writeUInt16LE(0x0800, 6);        // پرچم UTF-8 برای نام فایل
    lh.writeUInt16LE(8, 8);             // روش: deflate
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x2821, 12); // زمان/تاریخ ثابت (بیلد تکرارپذیر)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x2821, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);

    offset += 30 + nameBuf.length + comp.length;
  }

  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

// ────────────────────────────── XML ──────────────────────────────
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

export function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // کاراکترهای کنترلی غیرمجاز در XML 1.0 را دور می‌ریزیم
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : '';
}

/** A1 → 0 ، B1 → 1 ، AA1 → 26 */
function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '').toUpperCase();
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

/** 0 → A ، 26 → AA */
export function colName(idx: number): string {
  let s = '';
  let n = idx + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ──────────────────────── خواندن (Reader) ────────────────────────
export type XlsxSheet = { name: string; rows: string[][] };

/** شمارهٔ سریال تاریخ اکسل → ISO (مبنای 1900 با باگ تاریخی خود اکسل) */
function serialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return String(serial);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** استایل‌های تاریخ‌دار را می‌شناسیم تا سلول‌های تاریخ به‌جای عدد خام، ISO برگردند */
function dateStyleSet(stylesXml: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const customDate = new Set<number>();
  for (const m of stylesXml.matchAll(/<numFmt[^>]*\/>/g)) {
    const id = Number(attr(m[0], 'numFmtId'));
    const code = unescapeXml(attr(m[0], 'formatCode'));
    if (/[dmyh]/i.test(code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''))) customDate.add(id);
  }
  const xfsBlock = stylesXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] ?? '';
  let i = 0;
  for (const m of xfsBlock.matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(attr(m[0], 'numFmtId') || '0');
    if (BUILTIN_DATE_FMT.has(id) || customDate.has(id)) out.add(i);
    i++;
  }
  return out;
}

/** خواندن همهٔ شیت‌های یک فایل xlsx → جدول رشته‌ای (سلول خالی = '') */
export function readXlsx(buf: Buffer): XlsxSheet[] {
  const files = unzip(buf);
  const dec = (n: string) => files.get(n)?.toString('utf8');

  // رشته‌های مشترک
  const shared: string[] = [];
  const ss = dec('xl/sharedStrings.xml');
  if (ss) {
    for (const si of ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      let text = '';
      for (const t of si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += unescapeXml(t[1]);
      shared.push(text);
    }
  }
  const dateStyles = dateStyleSet(dec('xl/styles.xml'));

  // نگاشت rId → مسیر شیت
  const rels = dec('xl/_rels/workbook.xml.rels') ?? '';
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const target = attr(m[0], 'Target').replace(/^\/?xl\//, '').replace(/^\.\//, '');
    relMap.set(attr(m[0], 'Id'), 'xl/' + target);
  }

  const wb = dec('xl/workbook.xml') ?? '';
  const sheetTags = [...wb.matchAll(/<sheet\b[^>]*\/>/g)].map(m => m[0]);
  const sheets: XlsxSheet[] = [];

  sheetTags.forEach((tag, i) => {
    const name = unescapeXml(attr(tag, 'name')) || `Sheet${i + 1}`;
    const rid = attr(tag, 'r:id') || attr(tag, 'id');
    const path = relMap.get(rid) ?? `xl/worksheets/sheet${i + 1}.xml`;
    const xml = dec(path);
    if (!xml) return;

    const rows: string[][] = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rowNo = Number(attr('<row ' + rm[1] + '>', 'r') || rows.length + 1);
      const cells: string[] = [];
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const cTag = '<c ' + cm[1] + '>';
        const ref = attr(cTag, 'r');
        const type = attr(cTag, 't');
        const styleIdx = Number(attr(cTag, 's') || '-1');
        const body = cm[2] ?? '';
        let value = '';
        if (type === 'inlineStr') {
          for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) value += unescapeXml(t[1]);
        } else {
          const v = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '';
          const raw = unescapeXml(v);
          if (type === 's') value = shared[Number(raw)] ?? '';
          else if (type === 'b') value = raw === '1' ? 'true' : 'false';
          else if (type === 'e') value = '';
          else if (raw !== '' && dateStyles.has(styleIdx) && Number.isFinite(Number(raw))) value = serialToIso(Number(raw));
          // اکسل عدد صحیح را گاهی «84.0» ذخیره می‌کند (خروجی pandas/openpyxl).
          // اگر همین‌طور بماند، کد رشتهٔ «84.0» با «84» سامانه تطبیق نمی‌خورد.
          else value = raw.replace(/^(-?\d+)\.0+$/, '$1');
        }
        const idx = ref ? colIndex(ref) : cells.length;
        while (cells.length < idx) cells.push('');
        cells[idx] = value.trim();
      }
      while (rows.length < rowNo - 1) rows.push([]);
      rows[rowNo - 1] = cells;
    }
    sheets.push({ name, rows: rows.map(r => r ?? []) });
  });

  return sheets;
}

// ──────────────────────── نوشتن (Writer) ────────────────────────
export type CellValue = string | number | boolean | null | undefined;
export type SheetSpec = { name: string; rows: CellValue[][]; widths?: number[] };

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
__SHEETS__</Types>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF312E81"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * ساخت فایل xlsx از چند شیت. ردیف اول هر شیت به‌عنوان سرستون استایل می‌گیرد.
 * شیت‌ها راست‌به‌چپ تنظیم می‌شوند (مناسب فارسی).
 */
export function writeXlsx(sheets: SheetSpec[]): Buffer {
  const safeName = (n: string, i: number) => (n || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, '_').slice(0, 31);
  const used = new Set<string>();
  const names = sheets.map((s, i) => {
    let n = safeName(s.name, i);
    while (used.has(n.toLowerCase())) n = n.slice(0, 28) + '_' + (i + 1);
    used.add(n.toLowerCase());
    return n;
  });

  const files: { name: string; data: Buffer }[] = [];

  files.push({
    name: '[Content_Types].xml',
    data: Buffer.from(CT.replace('__SHEETS__', sheets.map((_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n') + '\n'), 'utf8'),
  });

  files.push({
    name: '_rels/.rels',
    data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, 'utf8'),
  });

  files.push({
    name: 'xl/workbook.xml',
    data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`, 'utf8'),
  });

  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, 'utf8'),
  });

  files.push({ name: 'xl/styles.xml', data: Buffer.from(STYLES, 'utf8') });

  sheets.forEach((sh, si) => {
    const cols = sh.widths?.length
      ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';
    const body = sh.rows.map((row, r) => {
      const cells = row.map((v, c) => {
        const ref = `${colName(c)}${r + 1}`;
        const s = r === 0 ? ' s="1"' : '';
        if (v === null || v === undefined || v === '') return `<c r="${ref}"${s}/>`;
        if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
        if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
        return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(v))}</t></is></c>`;
      }).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    }).join('');

    files.push({
      name: `xl/worksheets/sheet${si + 1}.xml`,
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
${cols}<sheetData>${body}</sheetData></worksheet>`, 'utf8'),
    });
  });

  return zip(files);
}

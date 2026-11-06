/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیت «پارس فایل‌های سازمان سنجش»
 *
 *  چرا این تست وجود دارد:
 *    طراحی اولیه بر پایهٔ مدل قدیمی `SanjeshFields` (StartFrom/CharacterCount)
 *    یعنی «فایل ثابت‌عرض بدون جداکننده» بود. سه فایل واقعی این فرض را رد
 *    کردند: فایل **UTF-16LE با BOM** است و فیلدها با **`$`** جدا می‌شوند و هر
 *    فیلد تا طول اعلامی با فاصله پر شده. اگر پارسر روی آفست نوشته می‌شد،
 *    همهٔ ۱٬۲۳۸ ردیف واقعی خراب می‌شد.
 *
 *    ضمناً قاعدهٔ «بسط ستون» هم اینجا قفل می‌شود: ردیفی از ساختار PDF که N
 *    زیرفیلد دارد، در فایل N ستون اشغال می‌کند (۵۷ / ۷۴ / ۸۵ ستون).
 *
 *  دادهٔ تست: نمونه‌های واقعی، بریده‌شده به ۵ ردیف (tests/fixtures/sanjesh).
 * ════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSanjeshFile, guessNationalCodeColumn, rowFingerprint, buildRowPayload } from '../src/lib/sanjesh/parse';
import {
  isValidNationalCode,
  parseSanjeshBirthDate,
  parseMultiYear,
  parseRawInt,
  decodeSanjeshBuffer,
  normalizePersian,
  repairNationalCode,
} from '../src/lib/sanjesh/decode';
import { SANJESH_TEMPLATES, SANJESH_TEMPLATE_MAP, decodeSanjeshValue, detectTemplateByColumnCount } from '../src/lib/sanjesh/templates';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'sanjesh');
const read = (f: string) => new Uint8Array(readFileSync(path.join(FIX, f)));

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};

console.log('\n▶ ساختار قالب‌ها');

// ── تعداد ستون بسط‌یافته با ساختار رسمی می‌خواند ──
const expectedCols: Record<string, number> = {
  FANI_1405: 57,
  ARSHAD_1405: 74,
  K2K_1405: 69,
  SARASARI_1404: 85,
};
for (const t of SANJESH_TEMPLATES) {
  ok(t.columnCount === expectedCols[t.key], `${t.key}: ${t.columnCount} ستون (انتظار ${expectedCols[t.key]})`);
  ok(t.columns.length === t.columnCount, `${t.key}: تعداد ستون‌های آرایه با columnCount می‌خواند`);
  ok(
    t.columns.every((c, i) => c.colIndex === i + 1),
    `${t.key}: colIndex از ۱ پیوسته است`,
  );
}

// ── قاعدهٔ سخت: targetField در هر قالب یکتاست ──
for (const t of SANJESH_TEMPLATES) {
  const seen = new Set<string>();
  let dup: string | null = null;
  for (const c of t.columns) {
    if (seen.has(c.targetField)) dup = c.targetField;
    seen.add(c.targetField);
  }
  ok(dup === null, `${t.key}: هیچ فیلد مقصدی تکراری نیست${dup ? ` (تکراری: ${dup})` : ''}`);
}

// ── بسط ستون: ردیف N زیرفیلدی باید N ستون بدهد ──
for (const t of SANJESH_TEMPLATES) {
  const expanded = t.expandedRows.reduce((s, r) => s + (r.columns - 1), 0);
  ok(
    t.pdfRowCount + expanded === t.columnCount,
    `${t.key}: ${t.pdfRowCount} ردیف PDF + ${expanded} ستون بسط = ${t.columnCount}`,
  );
}

console.log('\n▶ کاردانی فنی ۱۴۰۵ (فایل واقعی)');
{
  const t = SANJESH_TEMPLATE_MAP.FANI_1405;
  const r = parseSanjeshFile(read('fani-1405.txt'), t);
  ok(r.encoding === 'utf-16le', 'کدگذاری UTF-16LE تشخیص داده شد');
  ok(r.hadBom === true, 'BOM شناسایی شد');
  ok(r.colCount === 57, `۵۷ ستون از خود فایل (${r.colCount})`);
  ok(r.rowCount === 5, `۵ ردیف (${r.rowCount})`);
  ok(r.extraColumns.length === 0, 'ستون نگاشت‌نشده ندارد');
  ok(r.missingColumns.length === 0, 'ستون غایب ندارد');
  ok(r.warnings.length === 0, `بدون هشدار${r.warnings.length ? ': ' + r.warnings.join(' | ') : ''}`);

  const row = r.rows[0];
  ok(row.nationalCode === '2742238689', `کد ملی: ${row.nationalCode}`);
  ok(row.nationalCodeValid, 'کد ملی معتبر است');
  ok(row.normalized.birthDate === '1383-06-18', `تاریخ تولد ۶ رقمی → ${row.normalized.birthDate}`);
  ok(row.normalized.gender === '2', `جنس کد است: ${row.normalized.gender}`);
  ok(row.fields.firstName === 'مهدي', `نام: ${row.fields.firstName}`);
  ok(row.fields.lastName === 'برزگردين اباد', `نام خانوادگی: ${row.fields.lastName}`);
  ok(row.normalized.universityCode === '7025', `کد دانشگاه: ${row.normalized.universityCode}`);
  ok(Object.keys(row.fields).length === 57, 'همهٔ ۵۷ فیلد نگاشت شد');
  ok(Object.keys(row.columns).length === 57, 'همهٔ ۵۷ ستون خام حفظ شد');
  ok(row.rawLine.includes('$'), 'خط خام اصلی نگه داشته شد');
  ok(r.rows.every((x) => x.nationalCodeValid), 'همهٔ ۵ کد ملی معتبرند');
}

console.log('\n▶ کارشناسی ارشد ۱۴۰۵ (فایل واقعی)');
{
  const t = SANJESH_TEMPLATE_MAP.ARSHAD_1405;
  const r = parseSanjeshFile(read('arshad-1405.txt'), t);
  ok(r.colCount === 74, `۷۴ ستون (${r.colCount})`);
  ok(r.rowCount === 5, `۵ ردیف (${r.rowCount})`);
  ok(r.extraColumns.length === 0 && r.missingColumns.length === 0, 'تطبیق کامل با قالب');

  const row = r.rows[0];
  ok(row.normalized.gender === 'مرد', `جنسیت عنوان است نه کد: ${row.normalized.gender}`);
  ok(row.normalized.birthDate === '1374-12-14', `تاریخ تولد ۸ رقمی → ${row.normalized.birthDate}`);
  ok(row.normalized.associateGpa === 1391, `معدل فوق دیپلم خام: ${row.normalized.associateGpa}`);
  ok(row.normalized.bachelorGpa === 1384, `معدل لیسانس خام: ${row.normalized.bachelorGpa}`);
  ok(row.normalized.totalScore === 1986, `نمره کل: ${row.normalized.totalScore}`);
  ok(row.normalized.nationalRank === 897, `رتبه کشوری: ${row.normalized.nationalRank}`);

  // ۲۱ ستون نمرهٔ خام
  const scoreKeys = Object.keys(row.fields).filter((k) => k.startsWith('rawScore'));
  ok(scoreKeys.length === 21, `۲۱ ستون نمرهٔ خام (${scoreKeys.length})`);
  ok(row.normalized.rawScore1 === 0, 'نمرهٔ خام صفر حفظ شد (نه null)');
  ok(row.normalized.rawScore2 === 167, `نمرهٔ خام ۲ = ${row.normalized.rawScore2}`);
}

console.log('\n▶ سراسری ۱۴۰۴ (فایل واقعی)');
{
  const t = SANJESH_TEMPLATE_MAP.SARASARI_1404;
  const r = parseSanjeshFile(read('sarasari-1404.txt'), t);
  ok(r.colCount === 85, `۸۵ ستون (${r.colCount})`);
  ok(r.rowCount === 5, `۵ ردیف (${r.rowCount})`);
  ok(r.extraColumns.length === 0 && r.missingColumns.length === 0, 'تطبیق کامل با قالب');

  const row = r.rows[0];
  ok(row.uniqueId === '0002742377621', `شناسه یکتا ۱۳ رقمی: ${row.uniqueId}`);
  ok(row.nationalCode === '2742377621', `کد ملی: ${row.nationalCode}`);
  ok(row.normalized.birthDate === '1384-07-08', `تاریخ تولد → ${row.normalized.birthDate}`);
  ok(row.normalized.gender === '1', `جنس کد: ${row.normalized.gender}`);

  // سال اخذ دیپلم چندمقداری
  ok(row.fields.diplomaYear === '1404,0000,0000', `سال اخذ دیپلم خام: ${row.fields.diplomaYear}`);
  ok(row.normalized.diplomaYear === 1404, `اولین سال معتبر: ${row.normalized.diplomaYear}`);

  // نمرات خالی در این نمونه
  const scoreKeys = Object.keys(row.fields).filter((k) => k.startsWith('rawScore'));
  ok(scoreKeys.length === 9, `۹ ستون نمرهٔ خام (${scoreKeys.length})`);
  ok(row.normalized.rawScore1 === null, 'نمرهٔ خام خالی → null');
  ok(row.fields.academicRecordRef === 'mkgjk3qi-njdwei43-0v7jbafz', 'کد پیگیری سوابق تحصیلی حفظ شد');
}

console.log('\n▶ ناپیوستهٔ کاردانی به کارشناسی ۱۴۰۵ (فایل واقعی)');
{
  const t = SANJESH_TEMPLATE_MAP.K2K_1405;
  const r = parseSanjeshFile(read('k2k-1405.txt'), t);
  ok(r.colCount === 69, `۶۹ ستون (${r.colCount})`);
  ok(r.rowCount === 5, `۵ ردیف (${r.rowCount})`);
  ok(r.extraColumns.length === 0 && r.missingColumns.length === 0, 'تطبیق کامل با قالب');
  ok(r.rows.every((x) => x.lengthIssues.length === 0), 'هیچ ردیفی تخلف طول ندارد');
  ok(r.rows.every((x) => x.nationalCodeValid), 'کد ملی همهٔ ردیف‌ها معتبر است');
  ok(r.rows.every((x) => !!x.fullName), 'نام کامل همهٔ ردیف‌ها استخراج شد');

  // هیچ ستونی نگاشت‌نشده نماند — قالب کل ۶۹ ستون را پوشش می‌دهد
  const extras = r.rows[0].fields;
  ok(!Object.keys(extras).some((k) => k.startsWith('extra_')), 'ستون نگاشت‌نشده وجود ندارد');

  const row = r.rows[0];
  ok(row.nationalCode === '2742005021', `کد ملی: ${row.nationalCode}`);
  ok(row.fullName === 'محمد اسمعيلي بند', `نام: ${row.fullName}`);
  ok(row.applicantNo === '438706', `شمارهٔ داوطلبی: ${row.applicantNo}`);
  ok(row.normalized.birthDate === '1381-09-23', `تاریخ تولد → ${row.normalized.birthDate}`);
  // کلید نگاشت پذیرش: کد رشتهٔ محل قبولی
  ok(row.fields.fieldPlaceCode === '1526', `کد رشته محل قبولی: ${row.fields.fieldPlaceCode}`);
  ok(row.fields.fieldCode === '204', `کد رشتهٔ امتحانی: ${row.fields.fieldCode}`);
}

console.log('\n▶ تغییر تعداد ستون‌ها (سال‌های آینده) شکست نمی‌آورد');
{
  const t = SANJESH_TEMPLATE_MAP.FANI_1405;
  // یک ستون اضافه به انتهای هر خط
  const text = readFileSync(path.join(FIX, 'fani-1405.txt')).toString('utf16le').replace(/^\uFEFF/, '');
  const grown = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l + '        $EXTRA')
    .join('\r\n');
  const r = parseSanjeshFile(grown, t);
  ok(r.colCount === 58, `۵۸ ستون تشخیص داده شد (${r.colCount})`);
  ok(r.extraColumns.length === 1 && r.extraColumns[0] === 58, 'ستون ۵۸ «نگاشت‌نشده» علامت خورد');
  ok(r.rows[0].fields['extra_58'] === 'EXTRA', 'مقدار ستون نگاشت‌نشده در dataJson حفظ شد');
  ok(r.warnings.length > 0, 'هشدار اختلاف ستون صادر شد');
  ok(r.rows[0].nationalCode === '2742238689', 'پارس ردیف‌های موجود سالم ماند');

  // بدون قالب هم باید پارس شود
  const noTpl = parseSanjeshFile(read('fani-1405.txt'), null);
  ok(noTpl.colCount === 57, 'بدون قالب هم تعداد ستون درست است');
  ok(noTpl.rows.length === 5, 'بدون قالب هم همهٔ ردیف‌ها خوانده می‌شوند');
  ok(noTpl.rows[0].columns['1'] === '260541', 'بدون قالب، ستون خام در دسترس است');
}

console.log('\n▶ تشخیص خودکار ستون کد ملی (بدون قالب)');
{
  const r = parseSanjeshFile(read('fani-1405.txt'), null);
  const guess = guessNationalCodeColumn(r);
  // در این نمونه «شماره شناسنامه» و «کد ملی» مقدار یکسان دارند، پس هر دو
  // کاندید معتبرند. قرارداد: این تابع فقط «کاندید» می‌دهد و مدیر در صفحهٔ
  // تطبیق فیلدها آن را تأیید می‌کند — نباید ادعای قطعیت کرد.
  ok(guess !== null && [7, 9].includes(guess), `ستون کد ملی کاندید: ${guess}`);
  ok(
    guess !== null && r.rows.every((x) => isValidNationalCode(x.columns[String(guess)])),
    'همهٔ مقادیر ستون کاندید، کد ملی معتبرند',
  );
  // ستون نام خانوادگی نباید کاندید شود
  ok(guess !== 3, 'ستون نام خانوادگی کاندید نمی‌شود');
}

console.log('\n▶ کدگذاری‌ها');
{
  const d = decodeSanjeshBuffer(read('fani-1405.txt'));
  ok(d.encoding === 'utf-16le' && d.hadBom, 'UTF-16LE + BOM');
  // UTF-8 با BOM
  const utf8 = new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a$b$c', 'utf8')]));
  ok(decodeSanjeshBuffer(utf8).encoding === 'utf-8', 'UTF-8 با BOM');
  // بدون BOM و بدون بایت صفر → windows-1256
  const legacy = new Uint8Array(Buffer.from('سلام$دنیا', 'latin1'));
  ok(decodeSanjeshBuffer(legacy).encoding === 'windows-1256', 'بدون BOM → windows-1256');
}

console.log('\n▶ نرمال‌سازی مقادیر');
{
  ok(parseSanjeshBirthDate('830618') === '1383-06-18', '۶ رقمی');
  ok(parseSanjeshBirthDate('13741214') === '1374-12-14', '۸ رقمی');
  ok(parseSanjeshBirthDate('------') === null, 'خط تیره → null');
  ok(parseSanjeshBirthDate('999999') === null, 'تاریخ نامعتبر → null');

  ok(parseMultiYear('1404,0000,0000') === 1404, 'سال اخذ دیپلم چندمقداری');
  ok(parseMultiYear('0000,1393,1400') === 1393, 'مقدار صفر نادیده گرفته می‌شود');
  ok(parseMultiYear('') === null, 'خالی → null');

  ok(parseRawInt('------') === null, 'نمرهٔ غایب → null نه صفر');
  ok(parseRawInt('1250') === 1250, 'نمرهٔ خام بدون تغییر مقیاس');
  ok(parseRawInt('-266') === -266, 'نمرهٔ خام منفی');

  ok(isValidNationalCode('2742238689'), 'کد ملی معتبر');
  ok(!isValidNationalCode('1111111111'), 'کد ملی تکراری نامعتبر');
  ok(!isValidNationalCode('1234567890'), 'رقم کنترلی غلط');
  ok(!isValidNationalCode('123'), 'طول نادرست');

  ok(normalizePersian('علي  كريمي') === 'علی کریمی', 'ي/ك عربی و فاصلهٔ اضافه نرمال شد');
}

console.log('\n▶ صفرِ اولِ کد ملی (سما عدد را بدون صفر ذخیره می‌کند)');
{
  // نمونهٔ واقعی: ردیف ۶ فایل کاردانی — در فایل « 250812045» (۹ رقم با فاصلهٔ ابتدایی)
  const fixed = repairNationalCode(' 250812045');
  ok(fixed.value === '0250812045', `صفرِ اول بازگردانده شد: ${fixed.value}`);
  ok(fixed.repaired === true, 'پرچم «اصلاح شد» ست است');
  ok(isValidNationalCode(fixed.value), 'کد ۱۰ رقمیِ حاصل معتبر است');
  ok(!isValidNationalCode('250812045'), 'کد ۹ رقمی خام نامعتبر است (شاهد)');

  // کدی که از قبل ۱۰ رقم است نباید دست بخورد
  const asIs = repairNationalCode('2742238689');
  ok(asIs.value === '2742238689' && asIs.repaired === false, 'کد ۱۰ رقمی دست‌نخورده می‌ماند');

  // عدد ۹ رقمی که با صفرگذاری هم معتبر نمی‌شود ⇒ نباید «تعمیر» شود
  // (۰۱۱۱۱۱۱۱۱۱ رقم کنترلی‌اش ۰ است ولی رقم آخر ۱ است)
  const bogus = repairNationalCode('111111111');
  ok(bogus.value === '111111111' && bogus.repaired === false, 'کد ناقصِ نامعتبر تعمیر نمی‌شود');
}

console.log('\n▶ براورد (decode) هم کد و هم عنوان را می‌پذیرد');
{
  const fani = SANJESH_TEMPLATE_MAP.FANI_1405;
  const arshad = SANJESH_TEMPLATE_MAP.ARSHAD_1405;
  ok(decodeSanjeshValue(fani, 'gender', '2')?.label === 'مرد', 'کاردانی: جنس=2 → مرد');
  ok(decodeSanjeshValue(fani, 'gender', '1')?.label === 'زن', 'کاردانی: جنس=1 → زن');
  ok(decodeSanjeshValue(arshad, 'gender', 'مرد')?.label === 'مرد', 'ارشد: جنسیت=مرد → مرد');
  ok(decodeSanjeshValue(arshad, 'gender', 'زن')?.label === 'زن', 'ارشد: جنسیت=زن → زن');
  ok(decodeSanjeshValue(arshad, 'languageTitle', 'انگليسي')?.label === 'انگلیسی', 'ارشد: زبان با املای عربی');
  ok(decodeSanjeshValue(fani, 'religionCode', '1')?.label === 'اسلام', 'دین=1 → اسلام');
  ok(decodeSanjeshValue(fani, 'gender', '9') === null, 'کد ناشناخته → null');
  ok(decodeSanjeshValue(fani, 'noSuchField', '1') === null, 'فیلد بدون جدول → null');
}

console.log('\n▶ دادهٔ کامل برای ذخیره');
{
  const t = SANJESH_TEMPLATE_MAP.ARSHAD_1405;
  const r = parseSanjeshFile(read('arshad-1405.txt'), t);
  const payload = buildRowPayload(r.rows[0], t.key, r.colCount);
  ok(Object.keys(payload.fields).length === 74, 'fields: همهٔ ۷۴ فیلد');
  ok(Object.keys(payload.columns).length === 74, 'columns: همهٔ ۷۴ ستون خام');
  ok(payload.meta.templateKey === 'ARSHAD_1405', 'کلید قالب در متادیتا');
  ok(payload.meta.colCount === 74, 'تعداد ستون در متادیتا');
  ok(payload.meta.nationalCodeValid, 'اعتبار کد ملی در متادیتا');

  // اثر انگشت برای تشخیص تکرار
  const fp1 = rowFingerprint(r.rows[0]);
  const fp2 = rowFingerprint(r.rows[1]);
  ok(fp1.length === 8 && fp1 !== fp2, `اثر انگشت یکتا (${fp1} ≠ ${fp2})`);
  ok(fp1 === rowFingerprint(r.rows[0]), 'اثر انگشت پایدار است');
}

console.log('\n▶ تشخیص قالب از تعداد ستون');
{
  ok(detectTemplateByColumnCount(57)?.key === 'FANI_1405', '۵۷ → کاردانی فنی');
  ok(detectTemplateByColumnCount(74)?.key === 'ARSHAD_1405', '۷۴ → ارشد');
  ok(detectTemplateByColumnCount(85)?.key === 'SARASARI_1404', '۸۵ → سراسری');
  ok(detectTemplateByColumnCount(69)?.key === 'K2K_1405', '۶۹ → ناپیوسته');
  ok(detectTemplateByColumnCount(60) === null, 'تعداد ناشناخته → null');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} sanjesh-parse: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

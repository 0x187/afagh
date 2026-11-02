/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیت «تابلوی برنامه‌ریزی تاریخ آزمون را دوباره تبدیل نکند»
 *
 *  چرا این تست وجود دارد:
 *    `schedules."examDate"` ستون `date` است ولی در این پروژه **برچسب جلالی**
 *    نگه می‌دارد. دادهٔ واقعی (بررسی‌شده روی پایگاه‌دادهٔ زنده):
 *      SELECT DISTINCT "examDate" FROM schedules  →  1405-11-03
 *
 *    تابلوی برنامه‌ریزی این مقدار را با `new Date('1405-11-03T00:00:00')`
 *    پارس می‌کرد. جاوااسکریپت سالِ ۱۴۰۵ را **میلادی** می‌فهمد و تبدیل به
 *    جلالی نتیجه را به ۷۸۴ می‌برد — همان باگی که کاربر دید:
 *      «۱۴۰۵ می‌شد ۷۸۴».
 *
 *    کامیت `d2a5f60` قصدش درست بود ولی رگکسش فقط `/` را می‌پذیرفت، در حالی
 *    که داده با `-` ذخیره شده است ⇒ شرط هرگز match نمی‌شد و باگ سر جایش بود.
 *
 *  helper و رفتارش جداگانه در `tests/exam-date-normalize.test.ts` پوشش داده
 *  شده؛ اینجا فقط **مسیر واقعی** قفل می‌شود که از همان helper استفاده کند.
 * ════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeExamDate } from '../src/lib/shamsi';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ACTIONS = path.join(HERE, '..', 'src', 'app', 'admin', 'scheduling', 'actions.ts');
const ACTIONS_SRC = readFileSync(ACTIONS, 'utf8');

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log(`  ✓ ${m}`); }
  else { fail++; console.error(`  ✗ ${m}`); }
};

console.log('\n▶ گارد منبع: تابلوی برنامه‌ریزی از helper مشترک می‌خواند');
{
  ok(
    ACTIONS_SRC.includes('normalizeExamDate(examRaw)'),
    'تاریخ آزمون از normalizeExamDate خوانده می‌شود',
  );
  ok(
    ACTIONS_SRC.includes("from '@/lib/shamsi'"),
    'helper از ماژول shamsi وارد شده است',
  );
  ok(
    !ACTIONS_SRC.includes('jalaliDateOf(new Date(`${examRaw}T00:00:00`))'),
    'تبدیلِ خطرناک با new Date حذف شده است',
  );
  // رگکسی که فقط اسلش را می‌پذیرفت و دادهٔ واقعی (خط تیره) را از دست می‌داد.
  ok(
    !ACTIONS_SRC.includes('\\d{4}\\/\\d{1,2}\\/\\d{1,2}'),
    'رگکس اسلش‌محورِ ناکارآمد حذف شده است',
  );
  ok(
    !/new Date\(\s*`\$\{s\}T00:00:00`\s*\)/.test(ACTIONS_SRC),
    'هیچ پارسِ رشته‌ایِ تاریخ با new Date در فایل نمانده',
  );
}

console.log('\n▶ گارد رفتار: دادهٔ واقعیِ ستون به ۷۸۴ نمی‌رود');
{
  // دقیقاً همان مقادیری که در پایگاه‌دادهٔ زنده هست
  for (const raw of ['1405-11-03', '1405-08-16', '1405-08-20']) {
    const out = normalizeExamDate(raw);
    ok(out?.startsWith('1405/') === true, `${raw} → ${out} (سال جلالی حفظ شد)`);
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} exam-date-jalali: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

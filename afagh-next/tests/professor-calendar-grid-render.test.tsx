/**
 * تست رندر جدول هفتگی استاد/دانشجو — `ProfessorCalendarGrid` با مدل «روز در سطر»
 *
 * اجرا: npm test
 *
 * چرا این تست لازم شد؟ باگ واقعیِ گزارش‌شده («برنامه هفتگی در کارتابل استاد و
 * دانشجو درست نمایش داده نمی‌شود») هیچ خطای اجرایی نداشت: جدول رندر می‌شد،
 * عنوان و شمارش هم درست بود، ولی **همهٔ کارت‌ها و خطوط ساعت در نواری باریک
 * کنارِ ستون روز فشرده می‌شدند**.
 *
 * ریشه: گریدِ هر سطر `1 + HOUR_ROWS` ستون دارد (برچسب روز + یک ستون برای هر
 * ساعت)، ولی سلولِ محتوا فرزندِ دوم است و بدون `grid-column` فقط یک ستون
 * (عرضِ یک ساعت) را می‌گرفت. تست‌های ریاضیِ چیدمان (`layoutProfessorCalendarDay`)
 * این را نمی‌بینند چون درصدها درست‌اند؛ خطا در خودِ CSS grid است.
 *
 * پس اینجا روی HTML رندرشده سنجیده می‌شود که سلولِ محتوا واقعاً همهٔ ستون‌های
 * ساعت را بپوشاند.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import ProfessorCalendarGrid from '../src/app/professor/professor-calendar-grid.tsx';
import { PROFESSOR_GRID_DAYS } from '../src/lib/professor-week-grid.ts';
import {
  PROFESSOR_CALENDAR_END_MINUTES,
  PROFESSOR_CALENDAR_START_MINUTES,
} from '../src/lib/professor-calendar-layout.ts';

let pass = 0;
let fail = 0;
function t(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name); }
}

const HOUR_ROWS = (PROFESSOR_CALENDAR_END_MINUTES - PROFESSOR_CALENDAR_START_MINUTES) / 60;

const entry = (over: Record<string, unknown> = {}) => ({
  key: 'k1', id: 1, code: '53103', title: 'رياضيات گسسته', groupNumber: 1,
  dayOfWeek: 0, startTime: '08:00', endTime: '09:30',
  roomName: 'کلاس ۱۰۱', buildingName: 'ساختمان اصلی',
  weekType: 'ALL' as const, ...over,
});

const html = renderToStaticMarkup(
  <ProfessorCalendarGrid
    entries={[entry(), entry({ key: 'k2', id: 2, dayOfWeek: 4, startTime: '10:00', endTime: '12:00', title: 'آمار' })]}
    orientation="days-rows"
  />,
);

console.log('— مدل «روز در سطر»: سلول محتوا باید همهٔ ستون‌های ساعت را بپوشاند —');
t(`تعداد ستون‌های ساعت ${HOUR_ROWS} است`, HOUR_ROWS === 13);
t(
  `سلول محتوا با grid-column تمام ${HOUR_ROWS} ستون ساعت را span می‌کند`,
  html.includes(`grid-column:2 / span ${HOUR_ROWS}`) || html.includes(`grid-column:2/span ${HOUR_ROWS}`),
);
// رگرسیونِ باگ: اگر span حذف شود، این رشته وجود ندارد و کارت‌ها به نوار باریک می‌چسبند
t('هیچ سلول روزی بدون span باقی نمانده', !/grid-template-columns:88px[^"]*"[^>]*><div class="relative border-l border-t[^"]*" style="height:[^"]*"/.test(html));

console.log('— محتوا واقعاً رندر می‌شود —');
t('عنوان درس اول در HTML هست', html.includes('رياضيات گسسته'));
t('عنوان درس دوم در HTML هست', html.includes('آمار'));
t('نام سالن نمایش داده می‌شود', html.includes('کلاس ۱۰۱'));
t('ساعت جلسه با ارقام فارسی هست', html.includes('۰۸:۰۰'));
t('هر ۷ روز هفته سطر دارند', PROFESSOR_GRID_DAYS.length === 7 && PROFESSOR_GRID_DAYS.every(d => html.includes(d)));
t('جدول حداقل عرض دارد (اسکرول افقی موبایل)', html.includes('min-w-[1100px]'));
t('عرض هر ستون ساعت کافی است (۱۳ ساعت در ≥۱۰۱۲px ⇒ ≥۷۷px)', (1100 - 88) / HOUR_ROWS >= 77);

console.log('— روزهای خالی نشانهٔ «—» دارند —');
t('برای روزهای بدون کلاس، «—» رندر می‌شود', html.includes('>—<'));

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} موفق، ${fail} ناموفق`);
if (fail > 0) process.exit(1);

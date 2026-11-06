/**
 * تست واحد موتور زنگ‌های آموزشی — بدون React و بدون DB.
 *
 * چرا: تا امروز ساعت‌های «اعلام حضور استاد» و ماتریس برنامه‌ریزی، هر دو
 * هارد‌کد و مستقل بودند (۶ زنگ ۲ ساعته ۰۸:۰۰–۱۹:۳۰) و دانشگاهی با زنگ
 * ۱٫۵ ساعته یا روز ۰۷:۰۰–۲۰:۰۰ نمی‌توانست استفاده کند. حالا هر دو از
 * buildTimeSlots(config) می‌خوانند و این تست قرارداد آن را قفل می‌کند.
 */
import {
  buildTimeSlots, DEFAULT_SLOT_CONFIG, minutesToTime, parseTimeToMinutes,
  slotConfigFromSettings, slotLabel, teachingSlotsOf, validateSlotConfig,
} from '../src/lib/time-slots.ts';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n      انتظار: ${JSON.stringify(want)}\n      دریافت: ${JSON.stringify(got)}`); }
}

console.log('— موتور زنگ‌های آموزشی —');

console.log('\n۱) ابزارهای ساعت');
eq('۰۸:۳۰ = ۵۱۰ دقیقه', parseTimeToMinutes('08:30'), 510);
eq('قالب نامعتبر → null', parseTimeToMinutes('8.30'), null);
eq('ساعت ۲۴ نامعتبر است', parseTimeToMinutes('24:00'), null);
eq('۵۱۰ → 08:30', minutesToTime(510), '08:30');
eq('۷۵ → 01:15', minutesToTime(75), '01:15');
eq('برچسب فارسی', slotLabel('08:00', '10:00'), '۰۸:۰۰ الی ۱۰:۰۰');

console.log('\n۲) الگوی پیش‌فرض = رفتار قبلی (رگرسیون)');
const def = buildTimeSlots(DEFAULT_SLOT_CONFIG);
eq('۶ زنگ ۲ ساعته', def.filter(s => !s.isBreak).length, 5);
eq('یک ردیف استراحت', def.filter(s => s.isBreak).length, 1);
eq('اولین زنگ ۰۸:۰۰', def[0].startTime, '08:00');
eq('آخرین زنگ تا ۱۹:۳۰', def[def.length - 1].endTime, '19:30');
eq('شماره‌گذاری پیوسته از ۱', def.map(s => s.id), [1, 2, 3, 4, 5, 6]);
eq('زنگ‌های آموزشی بدون استراحت', teachingSlotsOf(def).length, 5);

console.log('\n۳) زنگ ۱٫۵ ساعته (دانشگاه دیگر)');
const s90 = buildTimeSlots({ dayStart: '08:00', dayEnd: '19:00', slotMinutes: 90, breakStart: '13:00', breakEnd: '13:45' });
const t90 = teachingSlotsOf(s90);
eq('زنگ‌ها ۹۰ دقیقه‌ای‌اند', t90[0].endTime, '09:30');
eq('شروع روز ۰۸:۰۰', t90[0].startTime, '08:00');
eq('پایان روز ≤ ۱۹:۰۰', t90[t90.length - 1].endTime <= '19:00', true);
eq('زنگی روی استراحت نمی‌افتد', t90.some(s => s.startTime < '13:45' && s.endTime > '13:00'), false);
eq('ردیف استراحت ۱۳:۰۰–۱۳:۴۵ هست', s90.some(s => s.isBreak && s.startTime === '13:00' && s.endTime === '13:45'), true);

console.log('\n۴) روز ۰۷:۰۰ تا ۲۰:۰۰ بدون استراحت');
const early = buildTimeSlots({ dayStart: '07:00', dayEnd: '20:00', slotMinutes: 120, breakStart: null, breakEnd: null });
eq('شروع ۰۷:۰۰', early[0].startTime, '07:00');
eq('بدون ردیف استراحت', early.some(s => s.isBreak), false);
// زنگ آخر به انتهای روز بریده می‌شود (۱۹:۰۰–۲۰:۰۰) — بقیه دقیقاً ۱۲۰ دقیقه‌اند
eq('همهٔ زنگ‌ها به‌جز آخری ۱۲۰ دقیقه‌اند',
  early.slice(0, -1).every(s => parseTimeToMinutes(s.endTime)! - parseTimeToMinutes(s.startTime)! === 120), true);
eq('زنگ آخر تا ۲۰:۰۰ تمام می‌شود', early[early.length - 1].endTime, '20:00');

console.log('\n۵) پیکربندی نامعتبر → پیش‌فرض (هیچ صفحه‌ای خالی نمی‌ماند)');
eq('ساعت خراب → پیش‌فرض', buildTimeSlots({ dayStart: 'xx', dayEnd: 'yy' })[0].startTime, '08:00');
eq('طول زنگ نامعقول → پیش‌فرض', buildTimeSlots({ slotMinutes: 5 })[0].startTime, '08:00');
eq('null → پیش‌فرض', buildTimeSlots(null).length, def.length);

console.log('\n۶) اعتبارسنجی');
eq('پیکربندی سالم → بدون خطا', validateSlotConfig(DEFAULT_SLOT_CONFIG), []);
eq('پایان قبل از شروع → خطا', validateSlotConfig({ dayStart: '18:00', dayEnd: '08:00' }).length > 0, true);
eq('استراحت بیرون روز → خطا', validateSlotConfig({ breakStart: '06:00', breakEnd: '07:00' }).length > 0, true);
eq('استراحت معکوس → خطا', validateSlotConfig({ breakStart: '13:00', breakEnd: '12:00' }).length > 0, true);

console.log('\n۷) خواندن از تنظیمات');
const cfg = slotConfigFromSettings({
  SCHEDULE_DAY_START: '07:30', SCHEDULE_DAY_END: '20:00',
  SCHEDULE_SLOT_MINUTES: '90', SCHEDULE_BREAK_START: '', SCHEDULE_BREAK_END: '',
});
eq('شروع از تنظیمات', cfg.dayStart, '07:30');
eq('طول زنگ از تنظیمات', cfg.slotMinutes, 90);
eq('استراحت خالی → null', cfg.breakStart, null);
eq('کلید غایب → پیش‌فرض', slotConfigFromSettings({}).dayEnd, DEFAULT_SLOT_CONFIG.dayEnd);

console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
process.exit(fail === 0 ? 0 : 1);

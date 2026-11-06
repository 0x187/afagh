// ════════════════════════════════════════════════════════════════════════
//  تولید «زنگ‌های کلاس» از پیکربندی دانشگاه — بدون React، بدون DB.
//
//  مشکل قبلی: هم صفحهٔ «اعلام حضور استاد» و هم ماتریس برنامه‌ریزی، ساعت‌ها را
//  هارد‌کد داشتند (۰۸:۰۰–۱۹:۳۰ با شش زنگ ۲ ساعته). دانشگاهی که زنگ ۱٫۵ ساعته
//  دارد یا کلاسش ۰۷:۰۰ شروع و ۲۰:۰۰ تمام می‌شود، نمی‌توانست استفاده کند و
//  دو صفحه هم می‌توانستند زنگ‌های متفاوت نشان دهند.
//
//  حالا هر دو صفحه از همین تابع و یک پیکربندی واحد (system_settings) می‌خوانند:
//      SCHEDULE_DAY_START / SCHEDULE_DAY_END
//      SCHEDULE_SLOT_MINUTES (۶۰ | ۹۰ | ۱۰۰ | ۱۲۰ | ۱۳۵ | ۱۵۰)
//      SCHEDULE_BREAK_START / SCHEDULE_BREAK_END  (خالی = بدون استراحت)
// ════════════════════════════════════════════════════════════════════════

export interface TimeSlot {
  id: number;
  label: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
}

export interface SlotConfig {
  /** شروع روز آموزشی، مثل «08:00» */
  dayStart: string;
  /** پایان روز آموزشی، مثل «19:30» */
  dayEnd: string;
  /** طول هر زنگ به دقیقه */
  slotMinutes: number;
  /** شروع بازهٔ ناهار/نماز — null یا خالی یعنی بدون استراحت */
  breakStart: string | null;
  /** پایان بازهٔ ناهار/نماز */
  breakEnd: string | null;
  /** متن ستون استراحت */
  breakLabel?: string;
}

/** الگوی پیش‌فرض — همان چیزی که تا امروز در UI دیده می‌شد (۶ زنگ ۲ ساعته) */
export const DEFAULT_SLOT_CONFIG: SlotConfig = {
  dayStart: '08:00',
  dayEnd: '19:30',
  slotMinutes: 120,
  breakStart: '12:00',
  breakEnd: '13:30',
  breakLabel: 'نماز و ناهار',
};

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const fa = (s: string) => s.replace(/\d/g, d => FA_DIGITS[Number(d)]);

/** «08:30» → ۵۱۰ دقیقه؛ ورودی نامعتبر → null */
export function parseTimeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** ۵۱۰ → «08:30» (همیشه دو رقمی) */
export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** برچسب فارسی یک بازه، مثل «۰۸:۰۰ الی ۱۰:۰۰» */
export function slotLabel(startTime: string, endTime: string): string {
  return `${fa(startTime)} الی ${fa(endTime)}`;
}

/**
 * ساخت زنگ‌ها از پیکربندی.
 * قواعد:
 *  • زنگ‌ها از dayStart پشت‌سرهم تا dayEnd ساخته می‌شوند.
 *  • اگر بازهٔ استراحت داخل روز بیفتد، یک ردیف isBreak هم اضافه می‌شود و
 *    ساعت‌ها بعد از استراحت ادامه پیدا می‌کنند (نه اینکه روی آن بیفتند).
 *  • زنگی که به استراحت می‌خورد، کوتاه می‌شود تا دقیقاً به شروع استراحت برسد.
 *  • باقیماندهٔ کمتر از ۳۰ دقیقه در انتهای روز نادیده گرفته می‌شود.
 * پیکربندی نامعتبر → الگوی پیش‌فرض (تا هیچ صفحه‌ای خالی/خراب نشود).
 */
export function buildTimeSlots(cfg: Partial<SlotConfig> | null | undefined): TimeSlot[] {
  const c: SlotConfig = { ...DEFAULT_SLOT_CONFIG, ...(cfg ?? {}) };
  const start = parseTimeToMinutes(c.dayStart);
  const end = parseTimeToMinutes(c.dayEnd);
  let dur = Math.round(Number(c.slotMinutes));
  if (!Number.isFinite(dur) || dur < 30 || dur > 300) dur = DEFAULT_SLOT_CONFIG.slotMinutes;
  if (start == null || end == null || end - start < 30) return buildTimeSlots(DEFAULT_SLOT_CONFIG);

  let bStart = parseTimeToMinutes(c.breakStart);
  let bEnd = parseTimeToMinutes(c.breakEnd);
  // بازهٔ استراحت فقط وقتی معتبر است که کامل داخل روز باشد
  if (bStart == null || bEnd == null || bEnd <= bStart || bStart < start || bEnd > end) {
    bStart = null; bEnd = null;
  }

  const slots: TimeSlot[] = [];
  let cursor = start;
  let breakEmitted = false;
  let guard = 0;

  while (cursor + 30 <= end && guard++ < 40) {
    if (bStart != null && bEnd != null && cursor >= bStart && cursor < bEnd) {
      if (!breakEmitted) {
        slots.push({
          id: slots.length + 1,
          label: `${slotLabel(minutesToTime(bStart), minutesToTime(bEnd))} (${c.breakLabel || 'نماز و ناهار'})`,
          startTime: minutesToTime(bStart),
          endTime: minutesToTime(bEnd),
          isBreak: true,
        });
        breakEmitted = true;
      }
      cursor = bEnd;
      continue;
    }

    let slotEnd = Math.min(cursor + dur, end);
    // اگر استراحت وسط این زنگ شروع می‌شود، زنگ را همان‌جا قطع کن
    if (bStart != null && cursor < bStart && slotEnd > bStart) slotEnd = bStart;
    if (slotEnd - cursor < 30) break;

    slots.push({
      id: slots.length + 1,
      label: slotLabel(minutesToTime(cursor), minutesToTime(slotEnd)),
      startTime: minutesToTime(cursor),
      endTime: minutesToTime(slotEnd),
      isBreak: false,
    });
    cursor = slotEnd;

    if (bStart != null && bEnd != null && !breakEmitted && cursor >= bStart) {
      slots.push({
        id: slots.length + 1,
        label: `${slotLabel(minutesToTime(bStart), minutesToTime(bEnd))} (${c.breakLabel || 'نماز و ناهار'})`,
        startTime: minutesToTime(bStart),
        endTime: minutesToTime(bEnd),
        isBreak: true,
      });
      breakEmitted = true;
      cursor = bEnd;
    }
  }

  return slots.length > 0 ? slots : buildTimeSlots(DEFAULT_SLOT_CONFIG);
}

/** فقط زنگ‌های آموزشی (بدون ردیف استراحت) — برای ماتریس برنامه و انتخاب واحد */
export function teachingSlotsOf(slots: TimeSlot[]): TimeSlot[] {
  return (slots ?? []).filter(s => !s.isBreak);
}

/** اعتبارسنجی پیکربندی — پیام خطای فارسی؛ آرایهٔ خالی یعنی سالم */
export function validateSlotConfig(cfg: Partial<SlotConfig> | null | undefined): string[] {
  const errors: string[] = [];
  const c: SlotConfig = { ...DEFAULT_SLOT_CONFIG, ...(cfg ?? {}) };
  const start = parseTimeToMinutes(c.dayStart);
  const end = parseTimeToMinutes(c.dayEnd);
  if (start == null) errors.push('ساعت شروع روز آموزشی نامعتبر است (قالب درست: 08:00).');
  if (end == null) errors.push('ساعت پایان روز آموزشی نامعتبر است (قالب درست: 19:30).');
  if (start != null && end != null && end - start < 30) errors.push('پایان روز آموزشی باید دست‌کم ۳۰ دقیقه بعد از شروع آن باشد.');
  const dur = Math.round(Number(c.slotMinutes));
  if (!Number.isFinite(dur) || dur < 30 || dur > 300) errors.push('طول هر زنگ باید بین ۳۰ تا ۳۰۰ دقیقه باشد.');

  const hasAnyBreak = Boolean((c.breakStart ?? '').trim() || (c.breakEnd ?? '').trim());
  if (hasAnyBreak) {
    const bs = parseTimeToMinutes(c.breakStart);
    const be = parseTimeToMinutes(c.breakEnd);
    if (bs == null) errors.push('ساعت شروع استراحت نامعتبر است.');
    if (be == null) errors.push('ساعت پایان استراحت نامعتبر است.');
    if (bs != null && be != null) {
      if (be <= bs) errors.push('پایان استراحت باید بعد از شروع آن باشد.');
      if (start != null && end != null && (bs < start || be > end)) errors.push('بازهٔ استراحت باید داخل روز آموزشی باشد.');
    }
  }
  return errors;
}

/** خواندن پیکربندی از رکورد تنظیمات (کلید → رشته) */
export function slotConfigFromSettings(s: Record<string, string | undefined> | null | undefined): SlotConfig {
  const pick = (k: string, fallback: string) => (s?.[k] ?? '').trim() || fallback;
  const n = Number((s?.SCHEDULE_SLOT_MINUTES ?? '').trim());
  return {
    dayStart: pick('SCHEDULE_DAY_START', DEFAULT_SLOT_CONFIG.dayStart),
    dayEnd: pick('SCHEDULE_DAY_END', DEFAULT_SLOT_CONFIG.dayEnd),
    slotMinutes: Number.isFinite(n) && n >= 30 && n <= 300 ? n : DEFAULT_SLOT_CONFIG.slotMinutes,
    breakStart: (s?.SCHEDULE_BREAK_START ?? '').trim() || null,
    breakEnd: (s?.SCHEDULE_BREAK_END ?? '').trim() || null,
    breakLabel: (s?.SCHEDULE_BREAK_LABEL ?? '').trim() || DEFAULT_SLOT_CONFIG.breakLabel,
  };
}

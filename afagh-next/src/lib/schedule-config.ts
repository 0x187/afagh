import 'server-only';
import { getSettings } from './settings';
import { buildTimeSlots, slotConfigFromSettings, type SlotConfig, type TimeSlot } from './time-slots';

/** کلیدهای تنظیماتِ زنگ‌های آموزشی — تنها منبع، هم برای پنل مدیر و هم دو ماتریس */
export const SLOT_SETTING_KEYS = [
  'SCHEDULE_DAY_START',
  'SCHEDULE_DAY_END',
  'SCHEDULE_SLOT_MINUTES',
  'SCHEDULE_BREAK_START',
  'SCHEDULE_BREAK_END',
  'SCHEDULE_BREAK_LABEL',
] as const;

/** پیکربندی زنگ‌ها از system_settings (با پیش‌فرض امن در صورت خطای خواندن) */
export async function getSlotConfig(): Promise<SlotConfig> {
  try {
    const s = await getSettings(SLOT_SETTING_KEYS);
    return slotConfigFromSettings(s as unknown as Record<string, string>);
  } catch {
    return slotConfigFromSettings(null);
  }
}

/** زنگ‌های آمادهٔ نمایش (شامل ردیف استراحت) */
export async function getTimeSlots(): Promise<TimeSlot[]> {
  return buildTimeSlots(await getSlotConfig());
}

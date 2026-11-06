export const ENTRY_METHODS = [
  { value: 'قبولی کنکور سراسری', label: 'قبولی کنکور سراسری' },
  { value: 'کنکور سراسری', label: 'کنکور سراسری' },
  { value: 'بدون آزمون - سوابق تحصیلی', label: 'بدون آزمون (سوابق تحصیلی)' },
  { value: 'انتقالی', label: 'انتقالی' },
  { value: 'اتباع خارجی', label: 'اتباع خارجی' },
  { value: 'دوره آزاد', label: 'دوره آزاد' },
] as const;

export type EntryMethod = (typeof ENTRY_METHODS)[number]['value'];

export function isEntryMethod(v: unknown): v is EntryMethod {
  return ENTRY_METHODS.some(m => m.value === v);
}

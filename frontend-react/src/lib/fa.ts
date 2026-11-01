// ═══ Persian digits — minimal port from afagh-next/src/lib/persian-search.ts ═══
// (The full version with letter normalization is ported in phase 2; here only the digits
//  needed for displaying and entering codes.)

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** Convert Latin digits to Persian — for display */
export function faDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

/** Convert Persian/Arabic digits to Latin — for inputs (same as toEnDigits) */
export function toEnDigits(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Number with thousands separator + Persian digits */
export function faNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return faDigits(Math.round(value).toLocaleString('en-US'));
}

/** Readable Rial amount: "3,000,000 Rials" */
export function faRial(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${faNumber(value)} ریال`;
}

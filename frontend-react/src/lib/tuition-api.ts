// ═══ کلاینت موتور شهریه و تعرفهٔ سالانه ═══
import { apiGet, apiPost } from './api';

export const MALI_TYPE_LABELS: Record<number, string> = {
  0: 'بدون شهریه (نوع صفر)', 1: 'عمومی', 2: 'پایه', 3: 'تخصصی', 4: 'اصلی',
  5: 'نظری-عملی', 6: 'پروژه', 9: 'اردو', 10: 'اختیاری', 11: 'کارورزی',
  12: 'عمومی عملی', 13: 'پیش‌دانشگاهی', 14: 'نظری-عملی کارگاهی',
  15: 'نظری-عملی با پروژه', 20: 'جبرانی', 22: 'عملی آز/کارگاه ۲س', 23: 'عملی آز/کارگاه ۳س',
};

export function maliLabel(v: number | null | undefined): string {
  if (v == null) return 'تعیین‌نشده';
  return MALI_TYPE_LABELS[Number(v)] ?? `نوع ${v}`;
}

export type TuitionRuleRow = {
  id: number;
  degreeLevelId: number | null;
  termType: string | null;
  offeringType: string | null;
  fixedTuition: number;
  perUnitTuition: number;
  effectiveFromYear: number | null;
  isActive: boolean;
  note: string | null;
};

export type TuitionRulesData = {
  rules: TuitionRuleRow[];
  degrees: { id: number; title: string }[];
  equivFixedMode: string;
};

export async function getTuitionRules(): Promise<TuitionRulesData> {
  const res = await apiGet<{ ok: boolean; data: TuitionRulesData }>('/admin/tuition-rules');
  return res.data;
}

export async function saveTuitionRule(input: Record<string, unknown>): Promise<void> {
  await apiPost('/admin/tuition-rules', input);
}

export async function deleteTuitionRule(id: number): Promise<void> {
  await apiPost('/admin/tuition-rules/delete', { id });
}

export async function importLegacyFeeRules(): Promise<{ created: number; skipped: number }> {
  const res = await apiPost<{ ok: boolean; data: { created: number; skipped: number } }>('/admin/tuition-rules/import-legacy', {});
  return res.data;
}

export async function setEquivFixedMode(mode: string): Promise<string> {
  const res = await apiPost<{ ok: boolean; data: { saved: string } }>('/admin/tuition-rules/equiv-mode', { mode });
  return res.data.saved;
}

export type TariffRate = { maliType: number; th: number; op: number };
export type TariffMajor = { code: string; title: string; faculty: string; entryYears: number[] };
export type TariffGroup = { uPriceCode: string; source: string; rates: TariffRate[]; majors: TariffMajor[] };
export type TariffData = { universityTitle: string; years: number[]; year: number; groups: TariffGroup[] };

export async function getTariff(year?: number): Promise<TariffData> {
  const res = await apiGet<{ ok: boolean; data: TariffData }>(`/admin/tuition-tariff${year ? `?year=${year}` : ''}`);
  return res.data;
}

export async function saveTariffGroup(year: number, uPriceCode: string, rates: TariffRate[]): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { updated: number } }>('/admin/tuition-tariff/save', { year, uPriceCode, rates });
  return res.data.updated;
}

export async function copyTariffYear(fromYear: number, toYear: number, overwrite: boolean): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { inserted: number } }>('/admin/tuition-tariff/copy', { fromYear, toYear, overwrite });
  return res.data.inserted;
}

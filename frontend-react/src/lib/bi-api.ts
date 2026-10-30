// ═══ کلاینت هوش تجاری ارزشیابی (BI) ═══
import { apiGet, apiPost } from './api';

export type TrendPoint = { period: string; term: string; termId: number | null; score: number | null };
export type ManagementRow = {
  staffId: number; name: string; rank: string | null; department: string | null;
  score: number; prevScore: number | null; delta: number | null;
  respondents: number; offerings: number; flagged: boolean; trend: TrendPoint[];
};
export type ManagementOverview = {
  term: string; period: string | null; threshold: number; flaggedCount: number;
  avgScore: number | null; totalRespondents: number; list: ManagementRow[];
  cachedAt: string | null; cacheAgeSeconds: number | null;
};
export type FacilityAxis = { label: string; score: number; responses: number };
export type FacilityRow = {
  roomId: number; room: string; building: string | null; type: string | null;
  axes: FacilityAxis[]; worstAxis: string; worstScore: number; needsRepair: boolean;
  courses: string[]; responses: number;
};
export type FacilitiesReport = {
  term: string; period: string | null; repairThreshold: number; needsRepairCount: number;
  rooms: FacilityRow[]; cachedAt: string | null; cacheAgeSeconds: number | null;
};
export type BiCacheEntry = {
  key: string; type: string; rows: number | null; durationMs: number | null;
  computedAt: string; ageSeconds: number; fresh: boolean;
};
export type BiDashboard = { overview: ManagementOverview; facilities: FacilitiesReport; cache: BiCacheEntry[] };

export type RadarAxis = { label: string; mine: number | null; dept: number | null; responses: number };
export type WordItem = { w: string; c: number };
export type ProfessorPanel = {
  staffId: number; name: string; rank: string | null; department: string | null;
  term: string; period: string | null; axes: RadarAxis[]; trend: TrendPoint[];
  words: WordItem[]; score: number | null; deptAvg: number | null;
  respondents: number; threshold: number; flagged: boolean;
};

export async function getBiDashboard(): Promise<BiDashboard> {
  const res = await apiGet<{ ok: boolean; data: BiDashboard }>('/admin/bi');
  return res.data;
}

export async function refreshBiDashboards(): Promise<{ staff: number; rooms: number }> {
  const res = await apiPost<{ ok: boolean; data: { staff: number; rooms: number } }>('/admin/bi/refresh-dashboards', {});
  return res.data;
}

export async function refreshAllBi(): Promise<{ staff: number; rooms: number; wordClouds: number; durationMs: number }> {
  const res = await apiPost<{ ok: boolean; data: { staff: number; rooms: number; wordClouds: number; durationMs: number } }>('/admin/bi/refresh', {});
  return res.data;
}

export async function invalidateBi(prefix?: string): Promise<void> {
  await apiPost('/admin/bi/invalidate', { prefix: prefix ?? '' });
}

export async function getProfessorPanel(staffId: number): Promise<ProfessorPanel> {
  const res = await apiPost<{ ok: boolean; data: ProfessorPanel }>('/admin/bi/professor-panel', { staffId });
  return res.data;
}

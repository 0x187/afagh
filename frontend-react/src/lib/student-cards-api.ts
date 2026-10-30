// ═══ کلاینت کارت دانشجویی ═══
import { apiGet, apiPost } from './api';

export type StudentCardInfo = {
  id: number;
  token: string;
  printStatus: string;
  rfidSerialNumber: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
};

export type StudentCardRow = {
  studentId: number;
  studentCode: string;
  fullName: string;
  nationalCode: string | null;
  status: string;
  entryYear: number | null;
  majorName: string | null;
  degreeLevel: string | null;
  card: StudentCardInfo | null;
  debt: number;
};

export type StudentCardsData = {
  rows: StudentCardRow[];
  total: number;
  page: number;
  totalPages: number;
  perPage: number;
  stats: { total: number; issued: number; blocked: number; expired: number };
  validDays: number;
  secretSet: boolean;
};

export async function listStudentCards(q: string, page: number): Promise<StudentCardsData> {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (page > 1) params.set('page', String(page));
  const res = await apiGet<{ ok: boolean; data: StudentCardsData }>(`/admin/student-cards${params.toString() ? `?${params}` : ''}`);
  return res.data;
}

export async function issueStudentCard(studentId: number, force: boolean): Promise<{ token: string; renewed: boolean }> {
  const res = await apiPost<{ ok: boolean; data: { token: string; renewed: boolean } }>('/admin/student-cards/issue', { studentId, force });
  return res.data;
}

export async function revokeStudentCard(studentId: number, status: 'REVOKED' | 'LOST'): Promise<void> {
  await apiPost('/admin/student-cards/revoke', { studentId, status });
}

export type StudentCardPrint = {
  studentId: number;
  userId: number;
  studentCode: string;
  fullName: string;
  nationalCode: string | null;
  entryYear: number;
  status: string;
  majorName: string | null;
  degreeTitle: string | null;
  universityTitle: string;
  logoUrl: string | null;
  hasPhoto: boolean;
  cardToken: string | null;
  cardStatus: string | null;
  validUntil: string | null;
  verifyUrl: string;
  qrSvg: string;
};

export async function getStudentCardPrint(studentId: number): Promise<StudentCardPrint> {
  const res = await apiGet<{ ok: boolean; data: StudentCardPrint }>(`/admin/student-cards/print?studentId=${studentId}`);
  return res.data;
}

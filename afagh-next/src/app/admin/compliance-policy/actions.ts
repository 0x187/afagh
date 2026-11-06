'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import {
  deleteComplianceOverride,
  saveComplianceOverride,
  seed1402GraduateRegulations,
} from '@/lib/compliance-policy-server';
import type { ComplianceKey } from '@/lib/compliance-policy';

const PATH = '/admin/compliance-policy';

export async function saveCompliancePolicyOverrideAction(input: {
  key: ComplianceKey;
  value: unknown;
  reason: string;
  degreeLevelId?: number | null;
  regulationId?: number | null;
  entryYear?: number | null;
  overrideId?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireRole(['ADMIN', 'EDU_EXPERT']);
  const uni = await getCurrentUniversity().catch(() => null);
  const res = await saveComplianceOverride({
    key: input.key,
    value: input.value,
    reason: input.reason,
    universityId: uni?.id ?? null,
    degreeLevelId: input.degreeLevelId ?? null,
    regulationId: input.regulationId ?? null,
    entryYear: input.entryYear ?? null,
    updatedBy: user?.id ?? null,
  });
  if (res.ok) revalidatePath(PATH);
  return res;
}

export async function resetCompliancePolicyOverrideAction(id: number): Promise<{ ok: boolean; error?: string }> {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  const res = await deleteComplianceOverride(id);
  if (res.ok) revalidatePath(PATH);
  return res;
}

export async function seed1402GraduateRegulationsAction(): Promise<{
  ok: boolean; created: string[]; skipped: string[]; error?: string;
}> {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  const uni = await getCurrentUniversity().catch(() => null);
  const res = await seed1402GraduateRegulations(uni?.id ?? 1);
  revalidatePath(PATH);
  return res;
}

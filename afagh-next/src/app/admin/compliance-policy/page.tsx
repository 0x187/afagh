import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { getCompliance, listComplianceOverrides, makeContext } from '@/lib/compliance-policy-server';
import {
  COMPLIANCE_GROUPS,
  POLICY_DEFS,
  SOURCE_LABELS,
  isBinding,
  type ComplianceKey,
} from '@/lib/compliance-policy';
import CompliancePolicyClient, { type PolicyRow } from './CompliancePolicyClient';

export const dynamic = 'force-dynamic';

export default async function CompliancePolicyPage() {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  const uni = await getCurrentUniversity().catch(() => null);
  const ctx = await makeContext({
    universityId: uni?.id ?? null,
    entryYear: 1405,
    family: 'REG_1402',
    level: 'LONG',
  });
  const resolved = await getCompliance(ctx);
  const overrides = await listComplianceOverrides(uni?.id ?? null);

  const rows: PolicyRow[] = POLICY_DEFS.map(def => {
    const p = resolved.provenance[def.key as ComplianceKey];
    const ov = overrides.find(o => o.key === def.key);
    return {
      key: def.key,
      label: def.label,
      group: def.group,
      kind: def.kind,
      reference: def.reference,
      help: def.help,
      options: def.options ? [...def.options] : undefined,
      min: def.min,
      max: def.max,
      binding: isBinding(def, ctx),
      value: (resolved.values as unknown as Record<string, unknown>)[def.key],
      legal: p.legal,
      source: p.source,
      sourceLabel: SOURCE_LABELS[p.source],
      legalConflict: p.legalConflict,
      shadowed: p.shadowed ?? null,
      overrideId: ov?.id ?? null,
      overrideReason: ov?.reason ?? '',
    };
  });

  return (
    <CompliancePolicyClient
      rows={rows}
      groups={[...COMPLIANCE_GROUPS]}
      context={{
        family: ctx.family,
        level: ctx.level,
        entryYear: ctx.entryYear,
        universityId: ctx.universityId ?? null,
      }}
      overrideCount={overrides.length}
    />
  );
}

import { asc, eq, isNull, or } from 'drizzle-orm';
import { db } from '@/db';
import { degree_level_configs, tuition_rules } from '@/db/schema';
import { getCurrentUniversity } from '@/lib/university-scope';
import { requireRole } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { normalizeEquivFixedMode } from '@/lib/tuition-rules';
import TuitionRulesClient from './TuitionRulesClient';

export const dynamic = 'force-dynamic';

export default async function TuitionRulesPage() {
  await requireRole(['ADMIN', 'FINANCE_EXPERT', 'FINANCE']);

  const uni = await getCurrentUniversity().catch(() => null);
  const [rules, degrees, equivModeRaw] = await Promise.all([
    db.select().from(tuition_rules).where(uni ? eq(tuition_rules.universityId, uni.id) : undefined).orderBy(asc(tuition_rules.id)),
    db.select().from(degree_level_configs)
      .where(uni ? or(eq(degree_level_configs.universityId, uni.id), isNull(degree_level_configs.universityId)) : undefined)
      .orderBy(asc(degree_level_configs.id)),
    getSetting('EQUIV_FIXED_TUITION_MODE'),
  ]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-300 bg-sky-50/70 px-3 py-2" dir="rtl">
        <a
          href="/admin/tuition/tariff"
          className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-black text-white transition hover:bg-sky-800"
        >
          📐 تعریف تعرفهٔ سالانهٔ شهریهٔ متغیر (نرخ هر نوع درس)
        </a>
        <span className="text-2xs text-sky-900">
          نرخ شهریهٔ متغیر سالانه است و به «نوع درس مالی» گره خورده؛ سال‌های بعد را از همان صفحه با «کپی از سال قبل» تعریف کنید.
        </span>
      </div>
      <TuitionRulesClient
      rules={rules.map(r => ({
        id: r.id,
        degreeLevelId: r.degreeLevelId,
        termType: r.termType,
        offeringType: r.offeringType,
        fixedTuition: Number(r.fixedAmount),
        perUnitTuition: Number(r.perUnitTheory),
        effectiveFromYear: r.entryYearFrom,
        isActive: r.isActive === 1,
        note: r.note,
      }))}
      degrees={degrees.map(d => ({ id: d.id, title: d.title }))}
      equivFixedMode={normalizeEquivFixedMode(equivModeRaw)}
      />
    </div>
  );
}

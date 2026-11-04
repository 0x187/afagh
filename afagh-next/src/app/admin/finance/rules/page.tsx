import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { db } from '@/db';
import { asc, eq, isNull, or } from 'drizzle-orm';
import {
  academic_terms, degree_level_configs, loan_products, majors, subject_fee_types,
  tuition_coefficients, tuition_discount_types, tuition_rules, tuition_sponsors,
} from '@/db/schema';
import { getCurrentUniversity } from '@/lib/university-scope';
import RulesClient from './RulesClient';

export const dynamic = 'force-dynamic';

const FINANCE = ['ADMIN', 'FINANCE_EXPERT', 'FINANCE'];

export default async function FinanceRulesPage() {
  await requireRole(FINANCE);
  const uniId = (await getCurrentUniversity()).id;

  const [discountTypes, sponsors, formulas, degreeRows, loanRows, majorRows, coeffRows, subjectFeeRows, termRows] = await Promise.all([
    db.select().from(tuition_discount_types)
      .where(or(eq(tuition_discount_types.universityId, uniId), isNull(tuition_discount_types.universityId)))
      .orderBy(asc(tuition_discount_types.title)),
    db.select().from(tuition_sponsors)
      .where(or(eq(tuition_sponsors.universityId, uniId), isNull(tuition_sponsors.universityId)))
      .orderBy(asc(tuition_sponsors.title)),
    db.select().from(tuition_rules)
      .where(or(eq(tuition_rules.universityId, uniId), isNull(tuition_rules.universityId)))
      .orderBy(asc(tuition_rules.priority), asc(tuition_rules.id)),
    db.select({ id: degree_level_configs.id, title: degree_level_configs.title })
      .from(degree_level_configs)
      .where(or(eq(degree_level_configs.universityId, uniId), isNull(degree_level_configs.universityId)))
      .orderBy(asc(degree_level_configs.title)),
    db.select().from(loan_products)
      .where(or(eq(loan_products.universityId, uniId), isNull(loan_products.universityId)))
      .orderBy(asc(loan_products.title)),
    db.select({ id: majors.id, title: majors.name }).from(majors)
      .where(or(eq(majors.universityId, uniId), isNull(majors.universityId)))
      .orderBy(asc(majors.name)),
    db.select({
      id: tuition_coefficients.id,
      termId: tuition_coefficients.termId,
      variableCoefficient: tuition_coefficients.variableCoefficient,
      fixedCoefficient: tuition_coefficients.fixedCoefficient,
      note: tuition_coefficients.note,
      updatedAt: tuition_coefficients.updatedAt,
      termTitle: academic_terms.title,
      termCode: academic_terms.termCode,
    }).from(tuition_coefficients)
      .leftJoin(academic_terms, eq(academic_terms.id, tuition_coefficients.termId))
      .where(or(eq(tuition_coefficients.universityId, uniId), isNull(tuition_coefficients.universityId)))
      .orderBy(tuition_coefficients.id),
    db.select().from(subject_fee_types)
      .where(or(eq(subject_fee_types.universityId, uniId), isNull(subject_fee_types.universityId)))
      .orderBy(asc(subject_fee_types.code)),
    db.select({
      id: academic_terms.id,
      termCode: academic_terms.termCode,
      termTitle: academic_terms.title,
    }).from(academic_terms)
      .where(or(eq(academic_terms.universityId, uniId), isNull(academic_terms.universityId)))
      .orderBy(asc(academic_terms.termCode)),
  ]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── سربرگ premium ── */}
      <div className="overflow-hidden rounded-2xl border border-emerald-900/20 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 p-4 text-white shadow-lg print:hidden sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black sm:text-xl">⚙️ تعاریف موتور مالی</h1>
            <p className="mt-1 text-xs text-emerald-50/90">
              انواع تخفیف شهریه، بنیادهای حامی، فرمول‌ها، ضریب افزایشی نیمسال و مبالغ موضوعی
            </p>
          </div>
          <Link prefetch={false}
            href="/admin/finance"
            className="rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20"
          >
            ↩️ بازگشت به کارتابل
          </Link>
        </div>
      </div>

      <RulesClient
        discountTypes={discountTypes.map((d) => ({
          id: d.id, code: d.code, title: d.title, kind: d.kind,
          defaultPercent: Number(d.defaultPercent), defaultAmount: Number(d.defaultAmount),
          maxPercent: d.maxPercent === null ? null : Number(d.maxPercent),
          requiresApproval: d.requiresApproval === 1, requiresDocument: d.requiresDocument === 1,
          isActive: d.isActive === 1, note: d.note,
        }))}
        sponsors={sponsors.map((s) => ({
          id: s.id, code: s.code, title: s.title, contactInfo: s.contactInfo,
          settlementMethod: s.settlementMethod, isActive: s.isActive === 1, note: s.note,
        }))}
        formulas={formulas.map((f) => ({
          id: f.id, code: f.code ?? '', title: f.title ?? '',
          degreeLevelId: f.degreeLevelId, majorId: f.majorId,
          entryYearFrom: f.entryYearFrom, entryYearTo: f.entryYearTo,
          fixedAmount: Number(f.fixedAmount), perUnitTheory: Number(f.perUnitTheory),
          perUnitPractical: Number(f.perUnitPractical), perUnitGeneral: Number(f.perUnitGeneral),
          priority: f.priority, isActive: f.isActive === 1, note: f.note,
        }))}
        loanProducts={loanRows.map((l) => ({
          id: l.id, code: l.code, title: l.title, lender: l.lender,
          maxAmount: l.maxAmount === null ? null : Number(l.maxAmount),
          defaultAmount: Number(l.defaultAmount),
          defaultInstallments: l.defaultInstallments,
          isInterestFree: l.isInterestFree === 1,
          requiresApproval: l.requiresApproval === 1,
          isActive: l.isActive === 1, note: l.note,
        }))}
        degrees={degreeRows}
        majorsOptions={majorRows}
        coefficients={coeffRows.map((c) => ({
          id: c.id, termId: c.termId,
          variableCoefficient: Number(c.variableCoefficient),
          fixedCoefficient: Number(c.fixedCoefficient),
          note: c.note, termTitle: c.termTitle, termCode: c.termCode,
        }))}
        subjectFeeTypes={subjectFeeRows.map((s) => ({
          id: s.id, code: s.code, title: s.title, kind: s.kind,
          fixedAmount: Number(s.fixedAmount), variablePercent: Number(s.variablePercent),
          appliesTo: s.appliesTo, isActive: s.isActive === 1, note: s.note,
        }))}
        terms={termRows}
      />
    </div>
  );
}

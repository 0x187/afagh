import 'server-only';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  academic_terms, degree_level_configs, faculties, financial_clearances, loan_products, majors, payment_cheques,
  student_discounts, student_ledger, student_loans, student_sponsorships, student_term_states, students,
  tuition_discount_types, tuition_sponsors, users,
} from '@/db/schema';
import {
  buildTranscript, computeTermAdjustments, toNum, transcriptTotals,
  type ChequeRow, type LoanRow, type TermCharge, type TermStatement,
} from '../finance-rules';
import { DEBT_LEDGER_TYPES } from '../ledger-balance';

const DEBT_TYPE_SET: ReadonlySet<string> = new Set(DEBT_LEDGER_TYPES);

// ══════════════════════════════════════════════════════════════════════
//  تخفیف، بنیاد، چک و وام یک دانشجو
// ══════════════════════════════════════════════════════════════════════

export interface StudentFinanceDetail {
  student: {
    studentId: number;
    userId: number;
    studentCode: string | null;
    fullName: string;
    nationalCode: string | null;
    majorTitle: string | null;
    degreeTitle: string | null;
    entryYear: number | null;
    status: string | null;
    // ── فیلدهای سربرگ کارنامه (انعکاس سیستم قدیمی) ──
    facultyTitle: string | null;
    quotaType: string | null;
    courseType: string | null;
    admissionMethod: string | null;
    entryDate: string | null;
    entryTerm: number | null;
    settlementDate: Date | null;
    // ── شناسنامه‌ای برای سربرگ کارنامهٔ مالی (کارنامهٔ رسمی عکس و شناسنامه دارد) ──
    birthCertNo: string | null;
    birthDate: Date | null;
    /** مسیر عکس — فقط اگر photoKey داشته باشد (‎/api/photo/{userId}‎؛ RBAC داخلِ خودِ route) */
    photoUrl: string | null;
  };
  terms: { id: number; termCode: string; termTitle: string; isCurrent: number | null }[];
  discounts: (typeof student_discounts.$inferSelect & { typeTitle: string | null; typeCode: string | null })[];
  sponsorships: (typeof student_sponsorships.$inferSelect & { sponsorTitle: string | null })[];
  cheques: (typeof payment_cheques.$inferSelect)[];
  loans: (typeof student_loans.$inferSelect & { productTitle: string | null })[];
  discountTypes: (typeof tuition_discount_types.$inferSelect)[];
  sponsors: (typeof tuition_sponsors.$inferSelect)[];
  loanProducts: (typeof loan_products.$inferSelect)[];
  transcript: TermStatement[];
  totals: ReturnType<typeof transcriptTotals>;
}

/** همهٔ اقلام مالی یک دانشجو + کارنامهٔ ترم‌به‌ترم
 *  universityId: محدودکردن نتیجه به دانشگاه جاری (صفحات ادمین) — رکوردهای
 *  legacy با universityId = NULL هم دیده می‌شوند (قرارداد بقیهٔ صفحات ادمین). */
export async function getStudentFinance(
  studentId: number,
  opts: { universityId?: number } = {},
): Promise<StudentFinanceDetail | null> {
  const [studentRow] = await db.select({
    studentId: students.id,
    userId: students.userId,
    studentCode: students.studentCode,
    firstName: users.firstName,
    lastName: users.lastName,
    nationalCode: users.nationalCode,
    majorTitle: majors.name,
    degreeTitle: degree_level_configs.title,
    entryYear: students.entryYear,
    status: students.status,
    quotaType: students.quotaType,
    courseType: students.tuitionType,
    admissionMethod: students.admissionMethod,
    entryDate: students.entryDate,
    entryTerm: students.entryTerm,
    facultyTitle: faculties.name,
    birthCertNo: users.birthCertNo,
    birthDate: users.birthDate,
    photoKey: users.photoKey,
  }).from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .leftJoin(majors, eq(majors.id, students.majorId))
    .leftJoin(faculties, eq(faculties.id, majors.facultyId))
    .leftJoin(degree_level_configs, eq(degree_level_configs.id, students.degreeLevelId))
    .where(
      opts.universityId === undefined
        ? eq(students.id, studentId)
        : and(
            eq(students.id, studentId),
            or(eq(students.universityId, opts.universityId), isNull(students.universityId)),
          ),
    )
    .limit(1);

  if (!studentRow) return null;

  // تاریخ تسویه: آخرین نیمسالِ تسویه‌شده (financial_clearances)
  const [settlement] = await db.select({ clearedAt: financial_clearances.clearedAt })
    .from(financial_clearances)
    .where(and(eq(financial_clearances.studentId, studentId), eq(financial_clearances.isCleared, 1)))
    .orderBy(desc(financial_clearances.clearedAt))
    .limit(1);

  const [terms, ledger, discounts, sponsorships, cheques, loans, discountTypes, sponsors, loanProductRows] =
    await Promise.all([
      db.select({
        id: academic_terms.id,
        termCode: academic_terms.termCode,
        termTitle: academic_terms.title,
        isCurrent: academic_terms.isCurrent,
      }).from(academic_terms).orderBy(desc(academic_terms.id)),

      db.select().from(student_ledger)
        .where(eq(student_ledger.studentId, studentId))
        // ترتیب زمانی واقعی: تاریخ واریز، و اگر نبود تاریخ ثبت.
        // رکوردهای مهاجرتی همه createdAt یکسان (روز ایمپورت) دارند.
        .orderBy(sql`COALESCE(${student_ledger.depositDate}, ${student_ledger.createdAt})`, asc(student_ledger.id)),

      db.select({
        row: student_discounts,
        typeTitle: tuition_discount_types.title,
        typeCode: tuition_discount_types.code,
      }).from(student_discounts)
        .leftJoin(tuition_discount_types, eq(tuition_discount_types.id, student_discounts.discountTypeId))
        .where(eq(student_discounts.studentId, studentId))
        .orderBy(desc(student_discounts.id)),

      db.select({
        row: student_sponsorships,
        sponsorTitle: tuition_sponsors.title,
      }).from(student_sponsorships)
        .leftJoin(tuition_sponsors, eq(tuition_sponsors.id, student_sponsorships.sponsorId))
        .where(eq(student_sponsorships.studentId, studentId))
        .orderBy(desc(student_sponsorships.id)),

      db.select().from(payment_cheques)
        .where(eq(payment_cheques.studentId, studentId))
        .orderBy(desc(payment_cheques.dueDate)),

      db.select({
        row: student_loans,
        productTitle: loan_products.title,
      }).from(student_loans)
        .leftJoin(loan_products, eq(loan_products.id, student_loans.loanProductId))
        .where(eq(student_loans.studentId, studentId))
        .orderBy(desc(student_loans.id)),

      db.select().from(tuition_discount_types)
        .where(eq(tuition_discount_types.isActive, 1))
        .orderBy(asc(tuition_discount_types.title)),

      db.select().from(tuition_sponsors)
        .where(eq(tuition_sponsors.isActive, 1))
        .orderBy(asc(tuition_sponsors.title)),

      db.select().from(loan_products)
        .where(eq(loan_products.isActive, 1))
        .orderBy(asc(loan_products.title)),
    ]);

  // وضعیتِ هر نیمسال دانشجو (از student_term_states) — برای نمایش در کارنامهٔ
  // مالی. اولویت: statusTitle → normalizedStatusTitle → sourceStatusTitle.
  const termStates = await db.select({
    termId: student_term_states.termId,
    statusTitle: student_term_states.statusTitle,
    normalizedStatusTitle: student_term_states.normalizedStatusTitle,
    sourceStatusTitle: student_term_states.sourceStatusTitle,
  }).from(student_term_states)
    .where(eq(student_term_states.studentId, studentId));
  const termStatuses: Record<string, string | null> = {};
  for (const s of termStates) {
    const title = s.statusTitle || s.normalizedStatusTitle || s.sourceStatusTitle || null;
    if (title) termStatuses[String(s.termId)] = title;
  }

  const termTitles: Record<string, string> = {};
  const termCodes: Record<string, string> = {};
  for (const t of terms) {
    termTitles[String(t.id)] = t.termTitle || t.termCode;
    termCodes[String(t.id)] = t.termCode;
  }

  // تخفیف‌ها و پوشش بنیادها از computeTermAdjustments می‌آیند — همان تابعی
  // که کارتابل هم صدایش می‌زند. دو پیاده‌سازی جدا یعنی دو عدد متفاوت برای
  // یک دانشجو؛ این اشتراک، سازگاری را ساختاری تضمین می‌کند.
  const NO_TERM = 0;

  const ledgerByTerm = new Map<number, typeof ledger>();
  for (const txn of ledger) {
    const key = txn.termId ?? NO_TERM;
    const arr = ledgerByTerm.get(key) || [];
    arr.push(txn);
    ledgerByTerm.set(key, arr);
  }

  const termCharges: TermCharge[] = [];
  for (const [termId, termLedger] of ledgerByTerm.entries()) {
    // مبنای بدهی هر ترم از واژگان کانونی (شامل انواع قدیمی TUITION_FIXED/VARIABLE)
    const charges = termLedger
      .filter((t) => DEBT_TYPE_SET.has(String(t.transactionType).toUpperCase()))
      .reduce((a, t) => a + toNum(t.amount), 0);
    termCharges.push({ termId, charges });
  }

  const adjustments = computeTermAdjustments({
    termCharges,
    discounts: discounts
      .filter((d) => d.row.status === 'APPROVED')
      .map((d) => ({
        id: d.row.id, termId: d.row.termId, kind: d.row.kind,
        percent: d.row.percent, amount: d.row.amount, title: d.typeTitle,
      })),
    sponsorships: sponsorships
      .filter((sp) => ['CONFIRMED', 'PAID'].includes(sp.row.status))
      .map((sp) => ({
        id: sp.row.id, termId: sp.row.termId, coverageKind: sp.row.coverageKind,
        percent: Math.max(toNum(sp.row.fixedPercent), toNum(sp.row.variablePercent)),
        amount: sp.row.amount, title: sp.sponsorTitle,
      })),
  });

  const discountApplied = adjustments.flatMap((a) =>
    a.discountLines.map((l) => ({ ...l, termId: a.termId })));
  const sponsorApplied = adjustments.flatMap((a) =>
    a.sponsorLines.map((l) => ({ ...l, termId: a.termId })));

  const transcript = buildTranscript({
    ledger: ledger.map((t) => ({
      id: t.id,
      termId: t.termId,
      transactionType: t.transactionType,
      amount: t.amount,
      description: t.description,
      createdAt: t.createdAt,
      // تاریخ/نوع واقعی واریز — کارنامه باید تاریخ فیش بانکی را نشان دهد،
      // نه createdAt را که برای رکوردهای مهاجرتی همان روز ایمپورت است.
      depositDate: t.depositDate,
      depositType: t.depositType,
      // مستندسازت مهاجرت‌یافته از سیستم قدیمی (سما، مهاجرت ۰۱۲۱) — برای
      // نمایش در کارنامهٔ مالی (مخصوصاً نمای کارشناس مالی).
      payerName: t.payerName ?? null,
      payerNationalCode: t.payerNationalCode ?? null,
      receiptNo: t.receiptNo ?? null,
      voucherNo: t.voucherNo ?? null,
      payTypeCode: t.payTypeCode ?? null,
      accountNo: t.accountNo ?? null,
      cardNo: t.cardNo ?? null,
      bankName: t.bankName ?? null,
      branchName: t.branchName ?? null,
      recorderCode: t.recorderCode ?? null,
      recorderName: t.recorderName ?? null,
      legacyRem: t.legacyRem ?? null,
    })),
    discounts: discountApplied,
    sponsorships: sponsorApplied,
    cheques: cheques as ChequeRow[],
    loans: loans.map((l) => l.row) as LoanRow[],
    termTitles,
    termCodes,
    termStatuses,
  });

  return {
    student: {
      studentId: studentRow.studentId,
      userId: studentRow.userId,
      studentCode: studentRow.studentCode,
      fullName: `${studentRow.firstName || ''} ${studentRow.lastName || ''}`.trim(),
      nationalCode: studentRow.nationalCode,
      majorTitle: studentRow.majorTitle,
      degreeTitle: studentRow.degreeTitle,
      entryYear: studentRow.entryYear,
      status: studentRow.status,
      facultyTitle: studentRow.facultyTitle,
      quotaType: studentRow.quotaType,
      courseType: studentRow.courseType,
      admissionMethod: studentRow.admissionMethod,
      entryDate: studentRow.entryDate,
      entryTerm: studentRow.entryTerm,
      settlementDate: settlement?.clearedAt ?? null,
      birthCertNo: studentRow.birthCertNo,
      birthDate: studentRow.birthDate,
      photoUrl: studentRow.photoKey ? `/api/photo/${studentRow.userId}` : null,
    },
    terms,
    discounts: discounts.map((d) => ({ ...d.row, typeTitle: d.typeTitle, typeCode: d.typeCode })),
    sponsorships: sponsorships.map((s) => ({ ...s.row, sponsorTitle: s.sponsorTitle })),
    cheques,
    loans: loans.map((l) => ({ ...l.row, productTitle: l.productTitle })),
    discountTypes,
    sponsors,
    loanProducts: loanProductRows,
    transcript,
    totals: transcriptTotals(transcript),
  };
}

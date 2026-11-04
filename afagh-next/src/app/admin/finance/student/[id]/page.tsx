import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getStudentFinance, computeFormulaTuition } from '@/lib/finance-engine';
import { computeTermTuition } from '@/lib/tuition-engine';
import { buildTranscriptCourses } from '@/lib/transcript-courses';
import { toJalaliFromDate, faDigits } from '@/lib/calendar';
import PrintTranscriptButton from '@/components/PrintTranscriptButton';
import FinancialTranscript from '@/components/FinancialTranscript';
import FinancialTranscriptFlat from '@/components/FinancialTranscriptFlat';
import FinanceVerifyBlock from '@/components/FinanceVerifyBlock';
import { getFinanceStatementApproval } from '@/lib/finance-approval';
import StatementLinkButton from './StatementLinkButton';
import FinanceStudentClient from './FinanceStudentClient';
import { db } from '@/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { student_subject_fees, subject_fee_types, students } from '@/db/schema';
import { welfare_funds } from '@/db/schema-welfare';
import { getCurrentUniversity } from '@/lib/university-scope';
import { getSetting } from '@/lib/settings';
import { buildFinanceStatementVerify as buildFinanceVerify } from '@/lib/finance-verify';

export const dynamic = 'force-dynamic';

const FINANCE = ['ADMIN', 'FINANCE_EXPERT', 'FINANCE'];

const fa = (n: number) => Number(n || 0).toLocaleString('fa-IR');

/** تاریخ شمسی خوانا؛ تهی → خط تیره */
function jdate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const { jy, jm, jd } = toJalaliFromDate(date);
  return faDigits(`${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`);
}

export default async function StudentFinancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ format?: string }> }) {
  await requireRole(FINANCE);

  const { id } = await params;
  const studentId = Number(id);
  if (!Number.isFinite(studentId)) notFound();

  // قالب سند: «نوع الف» = کارتی (پیش‌فرض) · «نوع ب» = تخت و فشرده
  const sp = await searchParams;
  const flatView = sp?.format === 'flat';

  const currentUniversity = await getCurrentUniversity();
const fin = await getStudentFinance(studentId, {
    universityId: currentUniversity?.id,
  });
  if (!fin) notFound();

  // فرمول تخصیص منطبق — برای هر ترم، تا کارشناس بداند مبنای محاسبه چیست
  const currentTerm = fin.terms.find((t) => t.isCurrent === 1) || fin.terms[0] || null;
  const formulaCalc = currentTerm
    ? await computeFormulaTuition(studentId, currentTerm.id)
    : null;

  // محاسبه شهریه با ضریب و مبالغ موضوعی برای ترم جاری
  const enhancedTuition = currentTerm
    ? await computeTermTuition(studentId, currentTerm.id)
    : null;

  // صندوق‌های فعال رفاه (سلکت فرم ثبت وام)
  const activeFunds = await db
    .select({ id: welfare_funds.id, title: welfare_funds.title })
    .from(welfare_funds)
    .where(
      and(
        eq(welfare_funds.isActive, 1),
        currentUniversity ? or(eq(welfare_funds.universityId, currentUniversity.id), isNull(welfare_funds.universityId)) : undefined,
      ),
    );

  // خواندن مبالغ موضوعی ترم جاری
  const uni = currentUniversity ?? await getCurrentUniversity().catch(() => null);
  const subjectFees = currentTerm ? await db
    .select({
      typeTitle: subject_fee_types.title,
      typeKind: subject_fee_types.kind,
      amount: student_subject_fees.amount,
    })
    .from(student_subject_fees)
    .innerJoin(subject_fee_types, eq(subject_fee_types.id, student_subject_fees.subjectFeeTypeId))
    .where(and(
      eq(student_subject_fees.studentId, studentId),
      uni ? or(eq(student_subject_fees.universityId, uni.id), isNull(student_subject_fees.universityId)) : undefined,
    )) : [];

  const [stuRow] = await db.select({ userId: students.userId, studentCode: students.studentCode, universityId: students.universityId, entryTerm: students.entryTerm }).from(students).where(eq(students.id, studentId)).limit(1);
  const financeVerify = stuRow?.userId
    ? await buildFinanceVerify(stuRow.userId, { id: studentId, code: stuRow.studentCode, universityId: stuRow.universityId })
    : null;
  const logoUrl = uni?.logoUrl || (await getSetting('UNIVERSITY_LOGO').catch(() => '')) || null;
  // عنوان دانشگاه: دانشگاه جاری → تنظیمات سراسری (UNIVERSITY_NAME)
  const uniTitle = currentUniversity?.title || (await getSetting('UNIVERSITY_NAME').catch(() => '')) || null;

  const { student, totals, transcript } = fin;

  // وضعیت تأیید کارنامهٔ مالی برای چاپ معتبر (درخواست FINANCE_STATEMENT)
  const approval = await getFinanceStatementApproval(studentId);

  // ریز شهریهٔ متغیر دروس برای همهٔ ترم‌های کارنامه (مسیر یکتای buildTranscriptCourses:
  // وزن از تعرفهٔ رسمی همان سال، جمع قفل‌شده به «شهریهٔ متغیر» دفتر کل)
  const courseMap = await buildTranscriptCourses(studentId, transcript.map((t) => t.termId));
  const transcriptWithCourses = transcript.map((t) => ({
    ...t,
    courses: courseMap[t.termId]?.lines ?? [],
    coursesBasis: courseMap[t.termId]?.basis,
  }));

  // نوع الف = کارتی · نوع ب = تخت — هر دو دقیقاً یک قرارداد پراپ دارند
  const TranscriptDoc = flatView ? FinancialTranscriptFlat : FinancialTranscript;

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── سربرگ premium (بدون دکمه‌های عملیاتی؛ آنها زیر سربرگ با استایل خودشان) ── */}
      <div className="print:hidden">
        <div className="overflow-hidden rounded-2xl border border-emerald-900/20 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 p-4 text-white shadow-lg sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-black sm:text-xl">📄 کارنامهٔ مالی دانشجو</h1>
              <p className="mt-1 text-xs text-emerald-50/90">
                {student.fullName} — {student.studentCode || 'بدون شمارهٔ دانشجویی'}
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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PrintTranscriptButton orientation="portrait" />
          <StatementLinkButton studentId={studentId} />
          {/* نوع سند: الف = کارتی · ب = تخت و فشرده */}
          <div className="flex overflow-hidden rounded-lg border border-white/30 bg-white/10 text-xs font-bold text-white backdrop-blur">
            <Link prefetch={false}
              href={`/admin/finance/student/${studentId}`}
              className={!flatView ? 'bg-white px-3 py-1.5 text-slate-900' : 'px-3 py-1.5 text-white/85 hover:bg-white/10'}
            >
              نوع الف
            </Link>
            <Link prefetch={false}
              href={`/admin/finance/student/${studentId}?format=flat`}
              className={flatView ? 'border-r border-white/30 bg-white px-3 py-1.5 text-slate-900' : 'border-r border-white/30 px-3 py-1.5 text-white/85 hover:bg-white/10'}
            >
              نوع ب
            </Link>
          </div>
          {/* وضعیت تأیید برای چاپ معتبر */}
          <span className={`rounded-lg border px-2.5 py-1.5 text-2xs font-bold ${approval ? 'border-emerald-400/50 bg-emerald-400/20 text-emerald-100' : 'border-amber-400/50 bg-amber-400/20 text-amber-100'}`}>
            {approval
              ? `✅ تأییدشده برای چاپ معتبر${approval.trackingCode ? ` — ${approval.trackingCode}` : ''}`
              : '⏳ بدون تأیید کارشناس مالی (QR برای دانشجو غیرفعال)'}
          </span>
        </div>
      </div>

      {/* ═══ بخش چاپ‌شدنی ═══ */}
      <div className="print-area space-y-4">
        <TranscriptDoc
          student={{ ...student, entryTerm: stuRow?.entryTerm ?? null }}
          terms={transcriptWithCourses}
          totals={totals}
          universityTitle={uniTitle}
          logoUrl={logoUrl}
          issuedAt={jdate(new Date())}
          viewerRole="FINANCE"
          verifyBlock={financeVerify ? <FinanceVerifyBlock url={financeVerify.url} qr={financeVerify.qr} expiresAt={financeVerify.expiresAt} /> : undefined}
          cheques={fin.cheques.map((c) => ({
            id: c.id, chequeNo: c.chequeNo, bankName: c.bankName,
            amount: Number(c.amount), dueDate: c.dueDate, status: c.status,
          }))}
          loans={fin.loans.map((l) => ({
            id: l.id, productTitle: l.productTitle, lender: l.lender,
            amount: Number(l.amount), installments: l.installments, status: l.status,
          }))}
          leadBlock={
            enhancedTuition && (enhancedTuition.fixedCoefficient !== 1 || enhancedTuition.variableCoefficient !== 1 || enhancedTuition.subjectFeesTotal !== 0 || enhancedTuition.overrideId !== null) ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <h4 className="mb-2 text-xs font-bold text-amber-800">
                  شهریهٔ ترم جاری با ضریب افزایشی
                  {enhancedTuition.overrideId !== null && (
                    <span className="mr-2 rounded-full bg-violet-100 px-2 py-0.5 text-3xs text-violet-800">
                      🎯 فرمول ویژه
                    </span>
                  )}
                </h4>
                <div className="grid grid-cols-2 gap-2 text-2xs sm:grid-cols-4">
                  <div><span className="text-slate-500">شهریه خام: </span><span className="font-medium">{fa(enhancedTuition.fixedTuition + enhancedTuition.variableTuition)}</span></div>
                  {enhancedTuition.fixedCoefficient !== 1 && (
                    <div><span className="text-slate-500">ضریب ثابت: </span><span className="font-medium text-amber-700">×{enhancedTuition.fixedCoefficient}</span></div>
                  )}
                  {enhancedTuition.variableCoefficient !== 1 && (
                    <div><span className="text-slate-500">ضریب متغیر: </span><span className="font-medium text-amber-700">×{enhancedTuition.variableCoefficient}</span></div>
                  )}
                  {enhancedTuition.subjectFeesTotal !== 0 && (
                    <div><span className="text-slate-500">مبالغ موضوعی: </span><span className={`font-medium ${enhancedTuition.subjectFeesTotal > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{enhancedTuition.subjectFeesTotal > 0 ? '+' : ''}{fa(enhancedTuition.subjectFeesTotal)}</span></div>
                  )}
                </div>
                {enhancedTuition.overrideId !== null && enhancedTuition.overrideReason && (
                  <p className="mt-2 text-2xs text-violet-700">
                    دلیل فرمول ویژه: {enhancedTuition.overrideReason}
                  </p>
                )}
                {enhancedTuition.subjectFees.length > 0 && (
                  <div className="mt-2 border-t border-amber-200 pt-2">
                    <p className="mb-1 text-3xs font-bold text-amber-700">اقلام موضوعی:</p>
                    <div className="flex flex-wrap gap-2">
                      {enhancedTuition.subjectFees.map((sf, i) => (
                        <span key={i} className={`rounded px-1.5 py-0.5 text-3xs ${sf.kind === 'ADDITIVE' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>
                          {sf.title}: {sf.amount > 0 ? '+' : ''}{fa(sf.amount)} ریال
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <p className="mt-2 text-2xs text-amber-700">
                  شهریه نهایی ترم جاری: <span className="font-bold">{fa(enhancedTuition.totalTuition)} ریال</span>
                </p>
              </div>
            ) : null
          }
        />
      </div>

      {/* ═══ بخش مدیریتی — چاپ نمی‌شود ═══ */}
      <FinanceStudentClient
        studentId={studentId}
        terms={fin.terms}
        discountTypes={fin.discountTypes.map((d) => ({
          id: d.id, title: d.title, kind: d.kind,
          defaultPercent: Number(d.defaultPercent), defaultAmount: Number(d.defaultAmount),
          maxPercent: d.maxPercent === null ? null : Number(d.maxPercent),
        }))}
        sponsors={fin.sponsors.map((s) => ({ id: s.id, title: s.title }))}
        discounts={fin.discounts.map((d) => ({
          id: d.id, typeTitle: d.typeTitle, kind: d.kind,
          percent: Number(d.percent), amount: Number(d.amount),
          status: d.status, termId: d.termId, reason: d.reason,
        }))}
        sponsorships={fin.sponsorships.map((s) => ({
          id: s.id, sponsorTitle: s.sponsorTitle, coverageKind: s.coverageKind,
          percent: Math.max(Number(s.fixedPercent), Number(s.variablePercent)), amount: Number(s.amount),
          status: s.status, termId: s.termId, referenceNo: s.referenceNo,
        }))}
        cheques={fin.cheques.map((c) => ({
          id: c.id, chequeNo: c.chequeNo, bankName: c.bankName,
          amount: Number(c.amount), status: c.status,
          dueDate: c.dueDate ? new Date(c.dueDate).toISOString().slice(0, 10) : null,
          remindedAt: c.remindedAt ? new Date(c.remindedAt).toISOString().slice(0, 10) : null,
        }))}
        loans={fin.loans.map((l) => ({
          id: l.id, lender: l.lender, loanCode: l.loanCode,
          amount: Number(l.amount), installments: l.installments, status: l.status,
          productTitle: l.productTitle,
        }))}
        loanProducts={fin.loanProducts.map((l) => ({
          id: l.id, code: l.code, title: l.title, lender: l.lender,
          maxAmount: l.maxAmount === null ? null : Number(l.maxAmount),
          defaultAmount: Number(l.defaultAmount),
          defaultInstallments: l.defaultInstallments,
        }))}
        welfareFunds={activeFunds}
        formula={formulaCalc ? {
          termTitle: currentTerm?.termTitle || '',
          formulaTitle: formulaCalc.formula?.title || null,
          buckets: formulaCalc.buckets,
          fixed: formulaCalc.fixed,
          variable: formulaCalc.variable,
          total: formulaCalc.total,
          termId: currentTerm?.id ?? null,
        } : null}
        enhancedTuition={enhancedTuition ? {
          fixedTuition: enhancedTuition.fixedTuition,
          variableTuition: enhancedTuition.variableTuition,
          fixedCoefficient: enhancedTuition.fixedCoefficient,
          variableCoefficient: enhancedTuition.variableCoefficient,
          fixedTuitionAfterCoeff: enhancedTuition.fixedTuitionAfterCoeff,
          variableTuitionAfterCoeff: enhancedTuition.variableTuitionAfterCoeff,
          subjectFees: enhancedTuition.subjectFees,
          subjectFeesTotal: enhancedTuition.subjectFeesTotal,
          totalTuition: enhancedTuition.totalTuition,
          overrideId: enhancedTuition.overrideId,
          overrideReason: enhancedTuition.overrideReason,
        } : null}
      />
    </div>
  );
}

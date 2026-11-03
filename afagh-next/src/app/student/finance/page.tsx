import { desc, eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { degree_level_configs, notifications, students, universities } from '@/db/schema';
import FinancialTranscript from '@/components/FinancialTranscript';
import { getStudentByUser, requireRole } from '@/lib/auth';
import { getStudentFinance } from '@/lib/finance-engine';
import { getFinanceStatementApproval } from '@/lib/finance-approval';
import FinancialTranscriptFlat from '@/components/FinancialTranscriptFlat';
import { computeTermTuition } from '@/lib/tuition-engine';
import { buildTranscriptCourses } from '@/lib/transcript-courses';
import { toNum, transcriptTotals } from '@/lib/finance-rules';
import { getTermScope } from '@/lib/term-scope';
import { isDemoStudentUser } from '@/lib/demo-accounts';
import { getPublicBaseUrl, getSetting } from '@/lib/settings';
import { issueFinanceStatementToken } from '@/lib/verification';
import { qrSvg } from '@/lib/qr';
import { toJalaliFromDate, faDigits } from '@/lib/calendar';
import PrintTranscriptButton from '@/components/PrintTranscriptButton';
import FinanceVerifyBlock from '@/components/FinanceVerifyBlock';
import { DemoFinance } from '../demo-sections';

export const dynamic = 'force-dynamic';

const fa = (n: number) => Number(n || 0).toLocaleString('fa-IR');

/** تاریخ شمسی خوانا؛ تهی → خط تیره */
function jdate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const { jy, jm, jd } = toJalaliFromDate(date);
  return faDigits(`${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`);
}

/**
 * رویدادهای مالی که برای دانشجو نمایش داده می‌شوند.
 *
 * تنها FINANCE_CHEQUE_DUE در سامانه تولید می‌شود (توسط پویش یادآوری چک).
 * اگر رویداد مالی تازه‌ای اضافه شد، باید اینجا هم ثبت شود.
 */
const STUDENT_EVENTS = ['FINANCE_CHEQUE_DUE'];

export default async function StudentFinancePage({ searchParams }: { searchParams: Promise<{ record?: string; format?: string }> }) {
  const user = await requireRole(['STUDENT']);
  const picked = await getStudentByUser(user.id);
  if (!picked) return <p className="card p-6 text-center text-slate-500">پروندهٔ دانشجویی یافت نشد.</p>;

  // ── دانش‌آموخته/دانشجوی چندمقطعی: هر پروندهٔ دانشجویی کارنامهٔ مالی خودش را
  //    دارد (دفتر مالی به studentId گره خورده است)، پس مقطع باید قابل انتخاب باشد
  //    و QR هر کارنامه هم همان پرونده را در خود نهفته دارد.
  const myRecords = await db
    .select({
      id: students.id,
      studentCode: students.studentCode,
      status: students.status,
      degreeTitle: degree_level_configs.title,
      entryYear: students.entryYear,
    })
    .from(students)
    .leftJoin(degree_level_configs, eq(degree_level_configs.id, students.degreeLevelId))
    .where(eq(students.userId, user.id))
    .orderBy(desc(students.entryYear), desc(students.id));

  const sp = await searchParams;
  const wantedRecordId = Number(sp?.record ?? 0) || 0;
  // قالب سند: «نوع الف» = کارتی (پیش‌فرض) · «نوع ب» = تخت و فشرده
  const flatView = sp?.format === 'flat';
  let active = picked;
  if (wantedRecordId && wantedRecordId !== picked.id && myRecords.some(r => r.id === wantedRecordId)) {
    const [alt] = await db
      .select()
      .from(students)
      .where(and(eq(students.id, wantedRecordId), eq(students.userId, user.id)))
      .limit(1);
    if (alt) active = alt;
  }
  const me = active;

  const demo = await isDemoStudentUser(user.id);
  if (demo) {
    const demoScope = await getTermScope(me.universityId);
    const demoTerm = demoScope.selectedId
      ? demoScope.terms.find(t => t.id === demoScope.selectedId) ?? null
      : null;
    return <DemoFinance filteredTermTitle={demoTerm?.title ?? null} />;
  }

  const [fin, notifyRows, remindDaysRaw, scope] = await Promise.all([
    getStudentFinance(me.id),
    db.select().from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.id))
      .limit(30),
    getSetting('CHEQUE_REMIND_DAYS'),
    getTermScope(me.universityId),
  ]);

  if (!fin) return <p className="card p-6 text-center text-slate-500">اطلاعات مالی یافت نشد.</p>;

  const [uniRow] = me.universityId
    ? await db.select({ title: universities.title, logoUrl: universities.logoUrl }).from(universities).where(eq(universities.id, me.universityId)).limit(1)
    : [];
  // عنوان دانشگاه: دانشگاه دانشجو → تنظیمات سراسری (UNIVERSITY_NAME) → عنوان پیش‌فرض کامپوننت
  const uniTitle = uniRow?.title || (await getSetting('UNIVERSITY_NAME').catch(() => '')) || null;
  const universityLogo = uniRow?.logoUrl || (await getSetting('UNIVERSITY_LOGO').catch(() => '')) || null;

  const { student, cheques, loans } = fin;
  const selectedTerm = scope.selectedId
    ? scope.terms.find(t => t.id === scope.selectedId) ?? null
    : null;

  const transcript = selectedTerm
    ? fin.transcript.filter(t => t.termId === selectedTerm.id)
    : fin.transcript;
  const totals = selectedTerm ? transcriptTotals(transcript) : fin.totals;
  const visibleCheques = selectedTerm
    ? cheques.filter(c => c.termId === selectedTerm.id)
    : cheques;
  const visibleLoans = selectedTerm
    ? loans.filter(l => l.termId === selectedTerm.id)
    : loans;

  // ریز شهریهٔ متغیر دروس ترم‌های نمایشی (مسیر یکتای buildTranscriptCourses)
  const courseMap = await buildTranscriptCourses(me.id, transcript.map((t) => t.termId));
  const transcriptWithCourses = transcript.map((t) => ({
    ...t,
    courses: courseMap[t.termId]?.lines ?? [],
    coursesBasis: courseMap[t.termId]?.basis,
  }));

  const remindDays = Math.max(0, Math.round(toNum(remindDaysRaw) || 0));
  const nowMs = Date.now();

  // چک‌های نزدیک به سررسید یا گذشته از آن — همان چیزی که پیام یادآوری برایش می‌رود
  const dueSoon = cheques
    .filter((c) => c.status === 'PENDING')
    .map((c) => {
      const due = c.dueDate ? new Date(c.dueDate).getTime() : NaN;
      const daysLeft = Number.isFinite(due) ? Math.ceil((due - nowMs) / 86_400_000) : null;
      return { ...c, daysLeft };
    })
    .filter((c) => c.daysLeft !== null && c.daysLeft <= remindDays)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

  // eventCode در اسکیما nullable است، پس تهی را صریح پوشش می‌دهیم
  const financeNotifications = notifyRows.filter((n) => !!n.eventCode && STUDENT_EVENTS.includes(n.eventCode));

  // توکن امضاشدهٔ کارنامهٔ مالی + QR استعلام برخط (بلوک مهر در بخش چاپی)
  // نسخهٔ معتبر (QR) فقط پس از تأیید کارشناس مالی — درخواست FINANCE_STATEMENT
  // در کارتابل درخواست‌ها تأیید می‌شود؛ تا آن زمان سند «غیرقابل استناد» است.
  const approval = await getFinanceStatementApproval(me.id);
  const publicBaseUrl = await getPublicBaseUrl();
  let stmtVerifyUrl: string | null = null;
  let stmtQr = '';
  let stmtExpiresAt: string | null = null;
  if (approval) {
    try {
      const issued = await issueFinanceStatementToken(user.id, { id: me.id, code: me.studentCode, universityId: me.universityId });
      stmtVerifyUrl = `${publicBaseUrl}/verify-finance/${encodeURIComponent(issued.token)}`;
      stmtExpiresAt = issued.expiresAt;
      try {
        stmtQr = await qrSvg(stmtVerifyUrl, { errorCorrectionLevel: 'M' });
      } catch (err) {
        console.error('[student-finance] qr failed', err);
      }
    } catch (err) {
      console.error('[student-finance] statement token failed', err);
    }
  }

  // پراپ‌های مشترکِ هر دو قالب (نوع الف/ب) — فقط چیدمان فرق دارد، داده یکی است
  const transcriptProps = {
    student: { ...student, entryTerm: me.entryTerm ?? null },
    terms: transcriptWithCourses,
    totals,
    universityTitle: uniTitle,
    logoUrl: universityLogo,
    issuedAt: jdate(new Date()),
    scopeLabel: selectedTerm ? `جمع نیمسال ${selectedTerm.title}` : undefined,
    official: !!approval,
    cheques: visibleCheques.map((c) => ({
      id: c.id, chequeNo: c.chequeNo, bankName: c.bankName,
      amount: toNum(c.amount), dueDate: c.dueDate, status: c.status,
    })),
    loans: visibleLoans.map((l) => ({
      id: l.id, productTitle: l.productTitle, lender: l.lender,
      amount: toNum(l.amount), installments: l.installments, status: l.status,
    })),
    verifyBlock: stmtVerifyUrl ? (
      <FinanceVerifyBlock url={stmtVerifyUrl} qr={stmtQr} expiresAt={stmtExpiresAt} />
    ) : undefined,
  };

  return (
    <div className="space-y-4" dir="rtl">
      {myRecords.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm print:hidden">
          <span className="font-bold text-slate-600">پروندهٔ مالی (مقطع):</span>
          {myRecords.map(r => (
            <a
              key={r.id}
              href={`/student/finance?record=${r.id}${flatView ? '&format=flat' : ''}`}
              className={`rounded-lg border px-2.5 py-1 font-bold ${r.id === me.id
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              {r.degreeTitle ?? 'مقطع نامشخص'} · <span className="font-mono" dir="ltr">{r.studentCode}</span>
            </a>
          ))}
          <span className="text-3xs text-slate-400">مانده و ریز ترم‌به‌ترم هر مقطع جداست.</span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="font-extrabold text-slate-800 text-base sm:text-lg">💳 امور مالی من</h1>
          <p className="text-xs text-slate-500 mt-1">کارنامهٔ مالی ترم‌به‌ترم، چک‌ها و وام‌ها</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* نوع سند: الف = کارتی · ب = تخت و فشرده */}
          <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs font-bold">
            <a
              href={`/student/finance?${new URLSearchParams({ ...(wantedRecordId ? { record: String(wantedRecordId) } : {}) }).toString()}`}
              className={!flatView ? 'bg-slate-800 px-3 py-1.5 text-white' : 'bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50'}
            >
              نوع الف
            </a>
            <a
              href={`/student/finance?${new URLSearchParams({ ...(wantedRecordId ? { record: String(wantedRecordId) } : {}), format: 'flat' }).toString()}`}
              className={flatView ? 'border-r border-slate-300 bg-slate-800 px-3 py-1.5 text-white' : 'border-r border-slate-300 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50'}
            >
              نوع ب
            </a>
          </div>
          <PrintTranscriptButton orientation="portrait" />
        </div>
      </div>

      {/* وضعیت اعتبار سند + مسیر تأیید کارشناس مالی */}
      <div className={`print:hidden rounded-xl border p-3 text-xs ${approval ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
        {approval ? (
          <p className="font-bold leading-6">
            ✅ این کارنامه <b>تأیید کارشناس امور مالی</b> را دارد و نسخهٔ دارای رمز استعلام (QR) در چاپ شما درج می‌شود.
            {approval.trackingCode ? <span className="font-mono text-2xs"> (کد رهگیری: {approval.trackingCode})</span> : null}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold leading-6">
              ⚠️ این نسخه <b>غیرقابل استناد</b> است. برای چاپ معتبر با رمز استعلام (QR)، درخواست تأیید کارنامهٔ مالی ثبت کنید تا کارشناس امور مالی آن را تأیید کند.
            </p>
            <a
              href="/student/requests?process=FINANCE_STATEMENT"
              className="shrink-0 rounded-lg bg-amber-700 px-3 py-1.5 text-2xs font-bold text-white transition hover:bg-amber-800"
            >
              ثبت درخواست تأیید
            </a>
          </div>
        )}
      </div>

      {/* ═══ هشهاد سررسید چک — بیرون از بخش چاپی تا همیشه دیده شود ═══ */}
      {dueSoon.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 print:hidden">
          <p className="text-sm font-bold text-amber-900">⚠️ چک در شرف سررسید</p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-900">
            {dueSoon.map((c) => (
              <li key={c.id}>
                چک شمارهٔ {faDigits(c.chequeNo || '—')}
                {c.bankName ? ` بانک ${c.bankName}` : ''} به مبلغ {fa(toNum(c.amount))} ریال —{' '}
                {c.daysLeft !== null && c.daysLeft < 0
                  ? <span className="font-bold text-rose-700">از سررسید گذشته است</span>
                  : c.daysLeft === 0
                    ? <span className="font-bold">امروز سررسید می‌شود</span>
                    : <span>{faDigits(String(c.daysLeft))} روز تا سررسید</span>}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-2xs text-amber-800">
            لطفاً پیش از سررسید نسبت به تأمین موجودی اقدام کنید تا چک برگشت نخورد.
          </p>
        </div>
      )}

      {/* ═══ پیام‌های مالی ═══ */}
      {financeNotifications.length > 0 && (
        <div className="card print:hidden">
          <h2 className="mb-2 border-b border-slate-100 pb-2 font-bold text-slate-800">پیام‌های مالی</h2>
          <ul className="space-y-2">
            {financeNotifications.map((n) => {
              let text = '';
              try { text = JSON.parse(n.payload || '{}').text || ''; } catch { text = ''; }
              return (
                <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 text-xs">
                  <span className="text-slate-700">{text || n.eventCode}</span>
                  <span className="text-2xs text-slate-400">{jdate(n.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ═══ بخش چاپ‌شدنی: کارنامهٔ مالی (نوع الف یا ب) ═══ */}
      <div className="print-area space-y-4">
        {flatView ? (
          <FinancialTranscriptFlat {...transcriptProps} />
        ) : (
          <FinancialTranscript {...transcriptProps} />
        )}
      </div>
    </div>
  );
}

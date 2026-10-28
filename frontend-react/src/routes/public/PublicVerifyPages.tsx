import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, GraduationCap, Printer, ShieldAlert, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { verifyPublicToken, type PublicVerifyResult } from '@/lib/public-api';

// ═══ صفحات استعلام عمومی (خارج از شل/نشست) — پورت verify-* ═══

function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-gradient-to-b from-slate-100 to-slate-200 p-4 dark:from-slate-950 dark:to-slate-900" dir="rtl">
      <div className="mt-6 w-full max-w-3xl space-y-3">{children}</div>
    </div>
  );
}

function InvalidCard({ res }: { res: PublicVerifyResult }) {
  const expired = res.reason === 'EXPIRED';
  const title = expired ? 'این سند منقضی شده است' : res.reason === 'NOT_FOUND' ? 'سندی یافت نشد' : res.reason === 'EMPTY' ? 'سند خالی است' : 'توکن نامعتبر است';
  return (
    <PublicShell>
      <div className="rounded-3xl border-2 border-rose-300 bg-white p-6 text-center shadow-xl dark:border-rose-800 dark:bg-slate-900">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950">
          <XCircle className="size-8" aria-hidden />
        </div>
        <h1 className="mt-3 text-lg font-black text-rose-700 dark:text-rose-300">{title}</h1>
        <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-muted-foreground">{res.message ?? 'سند موردنظر معتبر نیست.'}</p>
      </div>
    </PublicShell>
  );
}

function VerifiedHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-white px-4 py-3 shadow-sm dark:border-emerald-800 dark:bg-slate-900 print:shadow-none">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950">
          <CheckCircle2 className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-sm font-black">{title}</h1>
          {subtitle ? <p className="text-[11px] text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">استعلام برخط سامانهٔ آفاق</span>
        <button type="button" onClick={() => window.print()} className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold print:hidden">
          <Printer className="ml-1 inline size-3.5" aria-hidden /> چاپ
        </button>
      </div>
    </div>
  );
}

/** معدل با یک رقم اعشار (faNumber برای پول/صحیح گرد می‌کند). */
function fmtGpa(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return faDigits(v.toFixed(1)).replace('.', '٫');
}

function Field({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] font-bold text-muted-foreground">{k}</div>
      <div className={`mt-0.5 text-xs font-black ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : undefined}>{v}</div>
    </div>
  );
}

function useVerify() {
  const { token } = useParams();
  return useQuery({
    queryKey: ['public-verify', token],
    queryFn: () => verifyPublicToken(token ?? ''),
    enabled: !!token,
    staleTime: 60_000,
  });
}

function LoadingOrInvalid({ data, title, children }: { data?: PublicVerifyResult; title: string; children: ReactNode }) {
  if (!data) return <Skeleton className="h-64 w-full" />;
  if (!data.ok) return <InvalidCard res={data} />;
  return (
    <PublicShell>
      <VerifiedHeader title={title} />
      {children}
    </PublicShell>
  );
}

// ─────────────────── کارنامهٔ تحصیلی ───────────────────

type TranscriptDoc = {
  student: { name: string; studentCode: string; majorName: string; degreeTitle: string; entryYear: number };
  nationalIdMasked: string;
  statusLabel: string;
  totals: { enrolledUnits: number; passedUnits: number; gradedUnits: number; gpa: number | null };
  academicYears: { displayYear: string; isEquivalent: boolean; terms: { title: string; displayTitle: string; units: number; passedUnits: number; gpa: number | null; isProbation: boolean; rows: { code: string; title: string; units: number; grade: number | null; result: string; isDescriptive: boolean }[] }[] }[];
};

export function VerifyTranscriptPage() {
  const { data, isLoading } = useVerify();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <LoadingOrInvalid data={data} title="کارنامهٔ تحصیلی معتبر است">
      {data?.kind !== 'TRANSCRIPT' ? <InvalidCard res={{ ok: false, reason: 'BAD_TOKEN', message: 'نوع توکن با کارنامه هم‌خوانی ندارد.' }} /> : <TranscriptBody doc={data.doc as TranscriptDoc} />}
    </LoadingOrInvalid>
  );
}

function TranscriptBody({ doc }: { doc: TranscriptDoc }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-white p-4 shadow-sm dark:bg-slate-900">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Field k="نام و نام خانوادگی" v={doc.student?.name || '—'} />
          <Field k="شمارهٔ دانشجویی" v={faDigits(doc.student?.studentCode ?? '—')} mono />
          <Field k="کد ملی" v={doc.nationalIdMasked || '—'} mono />
          <Field k="رشته" v={doc.student?.majorName || '—'} />
          <Field k="مقطع" v={doc.student?.degreeTitle || '—'} />
          <Field k="سال ورود" v={doc.student?.entryYear ? faDigits(doc.student.entryYear) : '—'} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field k="معدل کل" v={fmtGpa(doc.totals?.gpa)} mono />
          <Field k="واحد گذرانده" v={faNumber(doc.totals?.passedUnits)} mono />
          <Field k="واحد محاسبه‌شده" v={faNumber(doc.totals?.gradedUnits)} mono />
          <Field k="وضعیت تحصیلی" v={doc.statusLabel || '—'} />
        </div>
      </div>
      {(doc.academicYears ?? []).map((y) => (
        <div key={y.displayYear} className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm dark:bg-slate-900">
          <div className="border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-black">
            {y.displayYear} {y.isEquivalent ? '— معادل‌سازی' : ''}
          </div>
          {y.terms.map((t) => (
            <div key={t.title} className="border-b border-border/50 px-3 py-2 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                <span className="font-bold">{t.displayTitle}</span>
                <span className="text-muted-foreground">
                  واحد: {faNumber(t.units)} · گذرانده: {faNumber(t.passedUnits)} · معدل: {fmtGpa(t.gpa)}
                  {t.isProbation ? <span className="font-bold text-rose-600 dark:text-rose-300"> · مشروط</span> : null}
                </span>
              </div>
              <table className="mt-1 w-full border-collapse text-right text-[11px]">
                <thead><tr className="text-muted-foreground"><th className="p-1">کد</th><th className="p-1">درس</th><th className="p-1 text-center">واحد</th><th className="p-1 text-center">نمره</th><th className="p-1 text-center">نتیجه</th></tr></thead>
                <tbody>
                  {t.rows.map((r, i) => (
                    <tr key={`${r.code}-${i}`} className="border-t border-border/30">
                      <td className="p-1 font-mono text-[10px]" dir="ltr">{r.code}</td>
                      <td className="p-1">{r.title}</td>
                      <td className="p-1 text-center font-mono">{faNumber(r.units)}</td>
                      <td className="p-1 text-center font-mono">{r.isDescriptive ? 'کیفی' : r.grade == null ? '—' : faNumber(r.grade)}</td>
                      <td className="p-1 text-center">{r.result === 'PASSED' ? 'قبول' : r.result === 'FAILED' ? 'مردود' : r.result === 'EQUIV' ? 'معادل' : r.result === 'PENDING' ? 'در انتظار' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─────────────────── کارنامهٔ مالی ───────────────────

type FinanceDoc = {
  student: { fullName: string; studentCode: string; nationalCode: string | null; majorTitle: string | null; degreeTitle: string | null };
  terms: { termTitle: string; charges: number; discounts: number; sponsorships: number; payments: number; chequesCleared: number; loans: number; balance: number }[];
  totals: { charges: number; discounts: number; sponsorships: number; payments: number; chequesCleared: number; chequesPending: number; loans: number; balance: number };
  issuedAt: string;
};

export function VerifyFinancePage() {
  const { data, isLoading } = useVerify();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (data?.ok && data.kind !== 'FINANCE_STMT') {
    return <PublicShell><InvalidCard res={{ ok: false, reason: 'BAD_TOKEN', message: 'نوع توکن با کارنامهٔ مالی هم‌خوانی ندارد.' }} /></PublicShell>;
  }
  const doc = (data?.doc ?? {}) as FinanceDoc;
  return (
    <LoadingOrInvalid data={data} title="کارنامهٔ مالی معتبر است">
      <div className="rounded-2xl border border-border bg-white p-4 shadow-sm dark:bg-slate-900">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Field k="نام" v={doc.student?.fullName || '—'} />
          <Field k="شمارهٔ دانشجویی" v={faDigits(doc.student?.studentCode ?? '—')} mono />
          <Field k="کد ملی" v={doc.student?.nationalCode ?? '—'} mono />
          <Field k="رشته" v={doc.student?.majorTitle || '—'} />
          <Field k="مقطع" v={doc.student?.degreeTitle || '—'} />
          <Field k="تاریخ صدور" v={doc.issuedAt ? faDigits(doc.issuedAt) : '—'} mono />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            ['شهریه', doc.totals?.charges],
            ['تخفیف', doc.totals?.discounts],
            ['پرداخت', doc.totals?.payments],
            ['مانده', doc.totals?.balance],
          ] as const).map(([k, v]) => (
            <Field key={k} k={`${k} (ریال)`} v={faNumber(v)} mono />
          ))}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-right text-[11px]">
            <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">نیمسال</th><th className="p-1.5 text-left">شهریه</th><th className="p-1.5 text-left">تخفیف</th><th className="p-1.5 text-left">پرداخت</th><th className="p-1.5 text-left">مانده</th></tr></thead>
            <tbody>
              {(doc.terms ?? []).length === 0 ? <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">ترمی ثبت نشده است.</td></tr> : (doc.terms ?? []).map((t) => (
                <tr key={t.termTitle} className="border-b border-border/40 last:border-0">
                  <td className="p-1.5">{t.termTitle}</td>
                  <td className="p-1.5 text-left font-mono">{faNumber(t.charges)}</td>
                  <td className="p-1.5 text-left font-mono">{faNumber(t.discounts)}</td>
                  <td className="p-1.5 text-left font-mono">{faNumber(t.payments)}</td>
                  <td className={`p-1.5 text-left font-mono font-bold ${t.balance > 0 ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'}`}>{faNumber(t.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LoadingOrInvalid>
  );
}

// ─────────────────── تأییدیهٔ انتخاب واحد ───────────────────

type EnrollDoc = {
  blocked?: string | null;
  emptyMessage?: string | null;
  data: {
    studentName: string; studentCode: string; nationalIdMasked: string; majorName: string | null;
    termTitle: string; totalUnits: number; checkedAt: string;
    courses: { courseCode: string; courseTitle: string; units: number; professorName: string | null; groupNumber: number | null }[];
  } | null;
};

export function VerifyEnrollmentPage() {
  const { data, isLoading } = useVerify();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (data?.ok && data.kind !== 'ENROLL_CONFIRM') {
    return <PublicShell><InvalidCard res={{ ok: false, reason: 'BAD_TOKEN', message: 'نوع توکن با تأییدیهٔ انتخاب واحد هم‌خوانی ندارد.' }} /></PublicShell>;
  }
  const doc = (data?.doc ?? {}) as EnrollDoc;
  if (data?.ok && !doc.data) {
    return <PublicShell><InvalidCard res={{ ok: false, reason: 'NOT_FOUND', message: doc.blocked || doc.emptyMessage || 'داده‌ای برای این تأییدیه موجود نیست.' }} /></PublicShell>;
  }
  const d = doc.data;
  return (
    <LoadingOrInvalid data={data} title="تأییدیهٔ انتخاب واحد معتبر است">
      {d ? (
        <div className="rounded-2xl border border-border bg-white p-4 shadow-sm dark:bg-slate-900">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field k="نام" v={d.studentName} />
            <Field k="شمارهٔ دانشجویی" v={faDigits(d.studentCode)} mono />
            <Field k="کد ملی" v={d.nationalIdMasked || '—'} mono />
            <Field k="رشته" v={d.majorName || '—'} />
            <Field k="نیمسال" v={d.termTitle} />
            <Field k="جمع واحد" v={faNumber(d.totalUnits)} mono />
          </div>
          <table className="mt-3 w-full border-collapse text-right text-[11px]">
            <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">کد</th><th className="p-1.5">درس</th><th className="p-1.5">استاد</th><th className="p-1.5 text-center">گروه</th><th className="p-1.5 text-center">واحد</th></tr></thead>
            <tbody>
              {d.courses.map((c, i) => (
                <tr key={i} className="border-b border-border/40 last:border-0">
                  <td className="p-1.5 font-mono text-[10px]" dir="ltr">{c.courseCode}</td>
                  <td className="p-1.5">{c.courseTitle}</td>
                  <td className="p-1.5">{c.professorName ?? '—'}</td>
                  <td className="p-1.5 text-center font-mono">{c.groupNumber == null ? '—' : faNumber(c.groupNumber)}</td>
                  <td className="p-1.5 text-center font-mono">{faNumber(c.units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-muted-foreground">زمان تأیید: {d.checkedAt ? faDigits(d.checkedAt) : '—'}</p>
        </div>
      ) : null}
    </LoadingOrInvalid>
  );
}

// ─────────────────── کارت ورود به جلسه ───────────────────

type ExamDoc = {
  card: {
    fullName: string; studentCode: string; nationalIdMasked: string; majorName: string | null;
    termTitle: string; isFinancialCleared: boolean; debtRials: number;
    courses: { courseCode: string; courseTitle: string; units: number; examDate: string; examTime: string; examHall: string | null; seatNumber: number | null }[];
  } | null;
};

export function ExamTicketPage() {
  const { data, isLoading } = useVerify();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (data?.ok && data.kind !== 'EXAM') {
    return <PublicShell><InvalidCard res={{ ok: false, reason: 'BAD_TOKEN', message: 'نوع توکن با کارت آزمون هم‌خوانی ندارد.' }} /></PublicShell>;
  }
  const doc = (data?.doc ?? {}) as ExamDoc;
  const card = doc.card;
  return (
    <LoadingOrInvalid data={data} title="کارت ورود به جلسه معتبر است">
      <div className="rounded-2xl border border-border bg-white p-4 shadow-sm dark:bg-slate-900">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Field k="نام" v={card?.fullName || '—'} />
          <Field k="شمارهٔ دانشجویی" v={faDigits(card?.studentCode ?? '—')} mono />
          <Field k="کد ملی" v={card?.nationalIdMasked || '—'} mono />
          <Field k="رشته" v={card?.majorName || '—'} />
          <Field k="نیمسال" v={card?.termTitle || '—'} />
          <Field k="وضعیت مالی" v={card?.isFinancialCleared ? 'تسویه' : `بدهی ${faNumber(card?.debtRials ?? 0)} ریال`} />
        </div>
        {(card?.courses ?? []).length === 0 ? (
          <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <ShieldAlert className="ml-1 inline size-4" aria-hidden /> جلسهٔ امتحانی برای این دانشجو ثبت نشده است.
          </p>
        ) : (
          <table className="mt-3 w-full border-collapse text-right text-[11px]">
            <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">درس</th><th className="p-1.5 text-center">تاریخ</th><th className="p-1.5 text-center">ساعت</th><th className="p-1.5">سالن</th><th className="p-1.5 text-center">صندلی</th></tr></thead>
            <tbody>
              {(card?.courses ?? []).map((c, i) => (
                <tr key={i} className="border-b border-border/40 last:border-0">
                  <td className="p-1.5">{c.courseTitle} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{c.courseCode}</span></td>
                  <td className="p-1.5 text-center font-mono">{faDigits(c.examDate)}</td>
                  <td className="p-1.5 text-center font-mono">{faDigits(c.examTime)}</td>
                  <td className="p-1.5">{c.examHall ?? '—'}</td>
                  <td className="p-1.5 text-center font-mono">{c.seatNumber == null ? '—' : faNumber(c.seatNumber)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
          <GraduationCap className="size-3.5" aria-hidden /> حمل این کارت به‌همراه کارت شناسایی در جلسهٔ امتحان الزامی است.
        </p>
      </div>
    </LoadingOrInvalid>
  );
}

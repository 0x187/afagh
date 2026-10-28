import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, IdCard, QrCode, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet } from '@/lib/api';
import { faDigits, faNumber } from '@/lib/fa';

// ═══ استعلام کارت دانشجویی / مدرک / گواهینامهٔ دورهٔ آزاد ═══

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-gradient-to-b from-slate-100 to-slate-200 p-4 dark:from-slate-950 dark:to-slate-900" dir="rtl">
      <div className="mt-6 w-full max-w-2xl space-y-3">{children}</div>
    </div>
  );
}

function VerdictCard({ ok, title, subtitle }: { ok: boolean; title: string; subtitle?: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-2xl border px-4 py-3 shadow-sm ${ok ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40' : 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40'}`}>
      <span className={`flex size-9 items-center justify-center rounded-full ${ok ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900' : 'bg-rose-100 text-rose-600 dark:bg-rose-900'}`}>
        {ok ? <ShieldCheck className="size-5" aria-hidden /> : <ShieldAlert className="size-5" aria-hidden />}
      </span>
      <div>
        <h1 className={`text-sm font-black ${ok ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200'}`}>{title}</h1>
        {subtitle ? <p className="text-[11px] text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  );
}

/** ISO میلادی → تاریخ شمسی (Intl با تقویم فارسی). */
function fmtJalali(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return faDigits(iso);
    return new Intl.DateTimeFormat('fa-IR', { calendar: 'persian', timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return faDigits(iso);
  }
}

function Field({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] font-bold text-muted-foreground">{k}</div>
      <div className={`mt-0.5 text-xs font-black ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : undefined}>{v}</div>
    </div>
  );
}

// ─────────────────── کارت دانشجویی (گیت حراست) ───────────────────

type CardData = {
  verdict: string; allowed: boolean; reason: string; studentCode: string; fullName: string;
  nationalIdMasked: string; statusLabel: string; majorName: string | null; degreeLevel: string | null;
  entranceYear: number | null; debt: number; rfidSerialNumber: string | null; printStatus: string | null;
  issuedAt: string | null; expiresAt: string | null;
};

const STATUS_FA: Record<string, string> = {
  ACTIVE: 'فعال', GRADUATED: 'فارغ‌التحصیل', DROPPED: 'انصراف', SUSPENDED: 'تعلیق', NO_SHOW: 'عدم مراجعه',
};

export function StudentIdCardPage() {
  const { token } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ['public-id', token],
    queryFn: () => apiGet<{ ok: boolean; data: CardData }>(`/public/id/${encodeURIComponent(token ?? '')}`).then((r) => r.data),
    enabled: !!token,
    staleTime: 30_000,
  });
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return null;
  if (data.verdict === 'NOT_FOUND') {
    return (
      <Shell>
        <VerdictCard ok={false} title="کارت ناشناخته است" subtitle="کارتی با این شناسه در سامانه ثبت نشده است." />
      </Shell>
    );
  }
  return (
    <Shell>
      <VerdictCard ok={data.allowed} title={data.allowed ? 'کارت معتبر است — ورود مجاز' : 'ورود مجاز نیست'} subtitle={data.reason} />
      <Card>
        <CardContent className="grid grid-cols-2 gap-2 pt-4 sm:grid-cols-3">
          <Field k="نام و نام خانوادگی" v={data.fullName || '—'} />
          <Field k="شمارهٔ دانشجویی" v={faDigits(data.studentCode)} mono />
          <Field k="کد ملی" v={data.nationalIdMasked} mono />
          <Field k="رشته" v={data.majorName ?? '—'} />
          <Field k="مقطع" v={data.degreeLevel ?? '—'} />
          <Field k="وضعیت تحصیلی" v={STATUS_FA[data.statusLabel] ?? data.statusLabel} />
          <Field k="بدهی (ریال)" v={data.debt > 0 ? faNumber(data.debt) : 'تسویه'} />
          <Field k="کارت صادرشده" v={fmtJalali(data.issuedAt)} mono />
          <Field k="انقضا" v={fmtJalali(data.expiresAt)} mono />
        </CardContent>
      </Card>
      <p className="text-center text-[10px] text-muted-foreground">
        <IdCard className="ml-1 inline size-3.5" aria-hidden /> استعلام برخط کارت دانشجویی — سامانهٔ جامع آفاق
      </p>
    </Shell>
  );
}

// ─────────────────── مدرک (verify-degree) ───────────────────

type DegreeData = {
  found: boolean; valid: boolean; revoked: boolean; revokeReason: string | null;
  serialNo: string; degreeType: string; ministryVerificationCode: string | null;
  issuedAt: string | null; snapshot: Record<string, unknown> | null;
};

export function VerifyDegreePage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(code ?? '');
  const { data, isLoading } = useQuery({
    queryKey: ['public-degree', code],
    queryFn: () => apiGet<{ ok: boolean; data: DegreeData }>(`/public/degree/${encodeURIComponent(code ?? '')}`).then((r) => r.data),
    enabled: !!code,
    staleTime: 60_000,
  });
  const snap = (data?.snapshot ?? {}) as Record<string, unknown>;
  const sval = (k: string) => (snap[k] == null ? '—' : String(snap[k]));

  return (
    <Shell>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-4">
          <div className="min-w-48 flex-1">
            <label className="text-[11px] font-bold">کد استعلام مدرک</label>
            <Input value={input} onChange={(e) => setInput(e.target.value)} className="mt-1 h-9 font-mono" dir="ltr" placeholder="AF-…" onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) navigate(`/verify-degree/${encodeURIComponent(input.trim())}`); }} />
          </div>
          <Button size="sm" disabled={!input.trim()} onClick={() => navigate(`/verify-degree/${encodeURIComponent(input.trim())}`)}>
            <QrCode className="size-4" aria-hidden /> استعلام
          </Button>
        </CardContent>
      </Card>

      {code ? (
        isLoading ? <Skeleton className="h-48 w-full" /> : !data?.found ? (
          <VerdictCard ok={false} title="مدرکی با این کد یافت نشد" subtitle="کد استعلام را بررسی کنید یا با اداره کل آموزش تماس بگیرید." />
        ) : (
          <>
            <VerdictCard ok={data.valid} title={data.valid ? 'مدرک معتبر است' : data.revoked ? 'مدرک باطل شده است' : 'اعتبار مدرک تأیید نشد'} subtitle={data.revoked ? (data.revokeReason ?? '') : data.valid ? 'اثر انگشت سند با محتوای آن هم‌خوان است.' : 'هش سند با محتوای آن هم‌خوان نیست.'} />
            <Card>
              <CardContent className="grid grid-cols-2 gap-2 pt-4 sm:grid-cols-3">
                <Field k="شمارهٔ سری" v={data.serialNo} mono />
                <Field k="نوع مدرک" v={data.degreeType === 'PERMANENT' ? 'دانشنامه' : data.degreeType === 'TEMPORARY' ? 'گواهی موقت' : data.degreeType} />
                <Field k="کد صحت وزارت" v={data.ministryVerificationCode ?? '—'} mono />
                <Field k="تاریخ صدور" v={fmtJalali(data.issuedAt)} mono />
                <Field k="نام" v={sval('fullName') !== '—' ? sval('fullName') : sval('studentName')} />
                <Field k="شمارهٔ دانشجویی" v={sval('studentCode') !== '—' ? faDigits(sval('studentCode')) : '—'} mono />
                <Field k="رشته" v={sval('majorName')} />
                <Field k="مقطع" v={sval('degreeTitle') ?? sval('degreeLevel')} />
                <Field k="معدل" v={sval('gpa') !== '—' ? faDigits(Number(sval('gpa')).toFixed(2)).replace('.', '٫') : '—'} mono />
              </CardContent>
            </Card>
          </>
        )
      ) : (
        <p className="text-center text-[11px] text-muted-foreground">کد استعلام درج‌شده روی مدرک/گواهی را وارد کنید.</p>
      )}
    </Shell>
  );
}

// ─────────────────── گواهینامهٔ دورهٔ آزاد ───────────────────

type CertData = {
  verdict: string; certificateNumber: string; fullNameFa: string | null; fullNameEn: string | null;
  courseTitleFa: string | null; courseTitleEn: string | null; instructorName: string | null;
  courseHours: number | null; grade: number; gradeStatus: string; issueDate: string | null;
  nationalIdMasked: string; message: string;
};

export function VerifyCertificatePage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(code ?? '');
  const { data, isLoading } = useQuery({
    queryKey: ['public-cert', code],
    queryFn: () => apiGet<{ ok: boolean; data: CertData }>(`/public/certificate/${encodeURIComponent(code ?? '')}`).then((r) => r.data),
    enabled: !!code,
    staleTime: 60_000,
  });

  return (
    <Shell>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-4">
          <div className="min-w-48 flex-1">
            <label className="text-[11px] font-bold">شمارهٔ گواهینامه</label>
            <Input value={input} onChange={(e) => setInput(e.target.value)} className="mt-1 h-9 font-mono" dir="ltr" onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) navigate(`/verify-certificate/${encodeURIComponent(input.trim())}`); }} />
          </div>
          <Button size="sm" disabled={!input.trim()} onClick={() => navigate(`/verify-certificate/${encodeURIComponent(input.trim())}`)}>
            <BadgeCheck className="size-4" aria-hidden /> استعلام
          </Button>
        </CardContent>
      </Card>

      {code ? (
        isLoading ? <Skeleton className="h-44 w-full" /> : !data ? null : data.verdict === 'NOT_FOUND' ? (
          <VerdictCard ok={false} title="گواهینامه‌ای یافت نشد" subtitle={data.message} />
        ) : (
          <>
            <VerdictCard ok={data.verdict === 'VALID'} title={data.verdict === 'VALID' ? 'گواهینامه معتبر است' : data.verdict === 'REVOKED' ? 'گواهینامه باطل شده است' : 'اعتبار گواهینامه تأیید نشد'} subtitle={data.message} />
            <Card>
              <CardContent className="grid grid-cols-2 gap-2 pt-4 sm:grid-cols-3">
                <Field k="شمارهٔ گواهینامه" v={data.certificateNumber} mono />
                <Field k="نام" v={data.fullNameFa ?? '—'} />
                <Field k="Name (EN)" v={data.fullNameEn ?? '—'} mono />
                <Field k="دوره" v={data.courseTitleFa ?? '—'} />
                <Field k="مدرس" v={data.instructorName ?? '—'} />
                <Field k="ساعت آموزشی" v={data.courseHours == null ? '—' : faNumber(data.courseHours)} mono />
                <Field k="نمره" v={`${faDigits(data.grade.toFixed(2)).replace('.', '٫')} (${data.gradeStatus})`} mono />
                <Field k="تاریخ صدور" v={data.issueDate ? faDigits(data.issueDate) : '—'} mono />
                <Field k="کد ملی" v={data.nationalIdMasked} mono />
              </CardContent>
            </Card>
          </>
        )
      ) : (
        <p className="text-center text-[11px] text-muted-foreground">شمارهٔ گواهینامه را وارد کنید تا اصالت آن بررسی شود.</p>
      )}
    </Shell>
  );
}

// نگه‌داشتن آیکن XCircle برای حالت‌های آینده
export const _icons = { XCircle };

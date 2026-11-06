import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Eye,
  LogOut,
  Printer,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { faDigits, faNumber } from '@/lib/fa';
import {
  getAlumniSummary,
  getProctorSessions,
  getPublicRoom,
  getRoomCheckinState,
  payAlumniRequest,
  proctorClockIn,
  proctorScanTicket,
  proctorVerifyAttendance,
  recordRoomCheckin,
  saveAlumniProfile,
  submitAlumniRequest,
  verifyPublicDocument,
} from '@/lib/public-extra-api';
import type {
  AlumniDegree,
  AlumniProfile,
  AlumniRequest,
  AlumniService,
  ProctorSessionData,
  RoomCheckinState,
} from '@/lib/public-extra-api';
import { useSession } from '@/lib/session';

// ═══ Public pages / outside the shell — port of the remaining Next pages ═══
//   verify/[code] (legacy inquiry) · verify/search · verify/document/[hash]
//   verify-degree/search · help · manual · alumni · proctor · p/[code]
// All are rendered without AppShell (like the other verify pages in App.tsx).

// ─────────────────── Shared utilities ───────────────────

/** Safe href link — port of isSafeLinkUrl (relative path or https:// only). */
function isSafeLinkUrl(s: string): boolean {
  if (typeof s !== 'string') return false;
  if (/[\u0000-\u001f\u007f\\]/.test(s)) return false;
  return /^\/(?!\/)/.test(s) || /^https:\/\/[^\s/?#]/i.test(s);
}

/** ISO Gregorian → Jalali date (Intl with the Persian calendar). */
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

function money(n: number): string {
  return faNumber(Number(n || 0)) + ' ریال';
}

function Field({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] font-bold text-muted-foreground">{k}</div>
      <div className={`mt-0.5 text-xs font-black ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : undefined}>{v}</div>
    </div>
  );
}

function PublicShell({ children, maxW = 'max-w-2xl' }: { children: ReactNode; maxW?: string }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-gradient-to-b from-slate-100 to-slate-200 p-4 dark:from-slate-950 dark:to-slate-900" dir="rtl">
      <div className={`mt-6 w-full ${maxW} space-y-3`}>{children}</div>
    </div>
  );
}

/** Official university header — shared between the inquiry pages. */
function UniversityHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full border-2 border-amber-400 bg-gradient-to-tr from-indigo-950 to-indigo-800 text-xl font-black text-white shadow-lg">
        آ
      </div>
      <h1 className="text-lg font-black text-slate-900 sm:text-xl">سامانه اصالت‌سنجی مدارک رسمی</h1>
      <p className="mt-1 text-xs font-bold text-slate-500">{subtitle}</p>
    </div>
  );
}

// ═══════════════════ 1) Legacy inquiry by tracking code — port of verify/[code] ═══════════════════

type CertificateVerdict = {
  verdict: string; // VALID | REVOKED | TAMPERED | NOT_FOUND
  certificateNumber: string;
  fullNameFa: string | null;
  fullNameEn: string | null;
  courseTitleFa: string | null;
  courseTitleEn: string | null;
  instructorName: string | null;
  courseHours: number | null;
  grade: number;
  gradeStatus: string;
  issueDate: string | null;
  nationalIdMasked: string;
  message: string;
};

export function VerifyCodePage() {
  const { code: rawCode } = useParams();
  const code = decodeURIComponent(rawCode ?? '').trim().toUpperCase();
  const [input, setInput] = useState(code);
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['legacy-verify', code],
    queryFn: async () => {
      const res = await apiGet<{ ok: boolean; data: CertificateVerdict }>(`/public/certificate/${encodeURIComponent(code)}`);
      return res.data;
    },
    enabled: !!code,
    retry: false,
  });

  const rateLimited = error instanceof ApiError && error.status === 429;

  return (
    <PublicShell maxW="max-w-lg">
      <UniversityHeader subtitle="دانشگاه غیرانتفاعی آفاق ارومیه · مرکز آموزش‌های آزاد" />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-4">
          <div className="min-w-48 flex-1">
            <label className="text-[11px] font-bold">کد استعلام (مثال: AFG-984A-23X9)</label>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="mt-1 h-9 text-center font-mono font-bold"
              dir="ltr"
              onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) navigate(`/verify/${encodeURIComponent(input.trim())}`); }}
            />
          </div>
          <Button size="sm" disabled={!input.trim()} onClick={() => navigate(`/verify/${encodeURIComponent(input.trim())}`)}>
            <Search className="size-4" aria-hidden /> استعلام اصالت گواهینامه
          </Button>
        </CardContent>
      </Card>

      {code ? (
        isLoading ? <Skeleton className="h-56 w-full" /> :
        rateLimited ? (
          <div className="rounded-3xl border-t-4 border-amber-500 bg-white p-8 text-center shadow-xl">
            <p className="text-3xl">⏳</p>
            <h2 className="mt-2 text-lg font-black text-slate-900">تعداد استعلام‌ها بیش از حد مجاز شد</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">چند دقیقهٔ دیگر دوباره تلاش کنید.</p>
          </div>
        ) : !data || data.verdict === 'NOT_FOUND' ? (
          <div className="rounded-3xl border-t-4 border-rose-500 bg-white p-8 text-center shadow-xl">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-rose-100 text-rose-600 shadow-inner">
              <XCircle className="size-8" aria-hidden />
            </div>
            <h2 className="mt-3 text-lg font-black text-slate-900">گواهینامه‌ای با این کد یافت نشد</h2>
            <p className="mt-2 text-xs leading-6 text-slate-600">
              کد رهگیری <span className="font-mono text-sm font-black tracking-widest text-rose-600" dir="ltr">{code}</span> در پایگاه دادهٔ دانشگاه آفاق یافت نشد. این سند فاقد هرگونه اعتبار قانونی است.
              {error instanceof ApiError && error.status !== 429 ? <span className="mt-1 block text-[11px] font-bold text-amber-700">{error.message}</span> : null}
            </p>
            <div className="flex flex-col justify-center gap-2 pt-3 sm:flex-row">
              <Link to="/open-courses" className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800">
                کاتالوگ دوره‌های معتبر
              </Link>
              <Link to="/verify-certificate" className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-2.5 text-xs font-bold text-rose-800 transition hover:bg-rose-100">
                🔎 استعلام با شمارهٔ سریال رسمی
              </Link>
            </div>
          </div>
        ) : data.verdict === 'TAMPERED' || data.verdict === 'REVOKED' ? (
          <div className="rounded-3xl border-t-4 border-amber-500 bg-white p-8 text-center shadow-xl">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-amber-100 text-3xl text-amber-600 shadow-inner">
              {data.verdict === 'REVOKED' ? '⛔' : '⚠️'}
            </div>
            <h2 className="mt-3 text-lg font-black text-slate-900">
              {data.verdict === 'REVOKED' ? 'این گواهینامه باطل شده است' : 'هشدار: اثر انگشت دیجیتال ناهمخوان است'}
            </h2>
            <p className="mt-1 text-xs leading-6 text-slate-600">{data.message}</p>
            <div className="mt-3 grid grid-cols-2 gap-2.5 text-[11px] font-bold">
              <Field k="شمارهٔ گواهینامه" v={data.certificateNumber} mono />
              <Field k="نام فراگیر" v={data.fullNameFa ?? '—'} />
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
            <div className="space-y-2 bg-gradient-to-r from-emerald-600 to-teal-700 p-6 text-center text-white">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-white text-emerald-600 shadow-md">
                <CheckCircle2 className="size-7" aria-hidden />
              </div>
              <h2 className="text-lg font-black">اصالت گواهینامه رسماً تأیید شد</h2>
              <p className="font-mono text-xs font-bold tracking-widest text-emerald-100" dir="ltr">کد رهگیری: {data.certificateNumber}</p>
            </div>
            <div className="space-y-5 p-6 text-xs">
              <div>
                <h3 className="mb-2 border-b border-slate-100 pb-2 text-[11px] font-black uppercase tracking-wider text-slate-400">👤 مشخصات هویتی فراگیر</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[11px] font-bold text-slate-500">نام و نام خانوادگی:</p>
                    <p className="mt-0.5 text-sm font-black text-slate-900">{data.fullNameFa ?? '—'}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400" dir="ltr">{data.fullNameEn ?? '—'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[11px] font-bold text-slate-500">کد ملی (ماسک‌شده):</p>
                    <p className="mt-0.5 font-mono text-sm font-black tracking-widest text-slate-900" dir="ltr">{data.nationalIdMasked}</p>
                  </div>
                </div>
              </div>
              <div>
                <h3 className="mb-2 border-b border-slate-100 pb-2 text-[11px] font-black uppercase tracking-wider text-slate-400">🎓 مشخصات دوره و ارزیابی</h3>
                <div className="space-y-2.5">
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3">
                    <p className="text-[11px] font-bold text-indigo-950">عنوان دورهٔ تخصصی:</p>
                    <p className="mt-0.5 text-sm font-black text-indigo-950">{data.courseTitleFa ?? '—'}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-2.5">
                      <p className="text-[10px] font-bold text-slate-500">استاد و ارزیاب دوره:</p>
                      <p className="mt-0.5 text-xs font-bold text-slate-800">{data.instructorName ?? '—'}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-2.5">
                      <p className="text-[10px] font-bold text-slate-500">طول مدت دوره:</p>
                      <p className="mt-0.5 font-mono text-xs font-bold text-slate-800">{data.courseHours == null ? '—' : faDigits(data.courseHours)} ساعت</p>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-2.5">
                      <p className="text-[10px] font-bold text-slate-500">تاریخ صدور رسمی:</p>
                      <p className="mt-0.5 font-mono text-xs font-bold text-slate-800">{data.issueDate ? faDigits(data.issueDate) : '—'}</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-2.5">
                      <p className="text-[10px] font-bold text-emerald-800">نمرهٔ نهایی فراگیر:</p>
                      <p className="mt-0.5 font-mono text-sm font-black text-emerald-800">{faDigits(data.grade.toFixed(2).replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m)))} از ۲۰</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-1 border-t border-slate-200 bg-slate-50 p-4 text-center text-[11px] font-bold text-slate-500">
              <p>🔒 استعلام به‌صورت برخط و مستقیماً از پایگاه دادهٔ امن دانشگاه آفاق صادر شده است.</p>
              <p className="text-[10px]">وضعیت ارزیابی: {data.gradeStatus}</p>
            </div>
          </div>
        )
      ) : (
        <p className="text-center text-[11px] text-muted-foreground">کد رهگیری درج‌شده روی گواهینامه را وارد کنید.</p>
      )}

      <div className="text-center">
        <Link to="/open-courses" className="text-xs font-bold text-indigo-900 hover:underline">← بازگشت به صفحهٔ اصلی دوره‌های آموزشی</Link>
      </div>
    </PublicShell>
  );
}

// ═══════════════════ 2) /verify → /verify/search form — port of verify/page + verify/search ═══════════════════

export function VerifySearchPage() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  useEffect(() => {
    const c = (sp.get('code') ?? '').trim();
    if (c) navigate(`/verify/${encodeURIComponent(c)}`, { replace: true });
  }, [sp, navigate]);

  return (
    <PublicShell maxW="max-w-md">
      <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full border-2 border-amber-400 bg-gradient-to-tr from-indigo-950 to-indigo-800 text-2xl font-black text-white shadow-lg">
          آ
        </div>
        <div>
          <h1 className="text-lg font-black text-slate-900 sm:text-xl">سامانه استعلام مدارک و گواهینامه‌ها</h1>
          <p className="mt-1 text-xs font-bold text-slate-500">دانشگاه غیرانتفاعی آفاق ارومیه</p>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) navigate(`/verify/${encodeURIComponent(code.trim())}`);
          }}
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="کد استعلام (مثال: AFG-984A-23X9)"
            className="rounded-2xl p-3 text-center font-mono text-sm font-bold"
            dir="ltr"
            required
          />
          <Button type="submit" className="w-full rounded-2xl py-3 text-xs font-black">
            🔍 استعلام اصالت گواهینامه
          </Button>
        </form>
        <div className="space-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
          <p className="font-bold">کد استعلام روی کاغذِ گواهینامه/مدرک درج شده است. استعلام فقط از پایگاه دادهٔ رسمی دانشگاه انجام می‌شود.</p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <Link to="/verify-degree" className="text-indigo-600 hover:underline">استعلام دانشنامه/گواهینامهٔ تحصیلی</Link>
            <span className="text-slate-300">·</span>
            <Link to="/verify-certificate" className="text-indigo-600 hover:underline">استعلام گواهینامهٔ دورهٔ آزاد</Link>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}

// ═══════════════════ 3) Sealed document inquiry — port of verify/document/[hash] ═══════════════════

export function VerifyDocumentPage() {
  const { hash: rawHash } = useParams();
  const hash = decodeURIComponent(rawHash ?? '').trim();
  const { data, isLoading } = useQuery({
    queryKey: ['public-document', hash],
    queryFn: () => verifyPublicDocument(hash),
    enabled: !!hash,
    staleTime: 60_000,
  });
  const doc = data?.doc;

  return (
    <PublicShell maxW="max-w-xl">
      <Card className="space-y-4">
        <CardContent className="space-y-4 pt-4 text-center">
          <div>
            <div className="text-2xl font-black text-slate-900">استعلام اصالت سند</div>
            <div className="mt-1 text-xs text-slate-500">دانشگاه آفاق — سامانهٔ جامع آموزشی</div>
          </div>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !data?.found ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-5">
              <div className="text-4xl">⛔</div>
              <div className="mt-2 font-black text-rose-700">سند یافت نشد</div>
              <p className="mt-1 text-xs text-rose-600">
                هیچ سندی با این امضای دیجیتال در سامانه ثبت نشده است. این سند معتبر نیست.
                {data?.error ? <span className="mt-1 block text-[11px] font-bold text-amber-700">{data.error}</span> : null}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="text-4xl">✅</div>
              <div className="mt-2 font-black text-emerald-700">سند معتبر است</div>
              <p className="mt-1 text-xs text-emerald-600">این سند در بایگانی الکترونیک دانشگاه ثبت و تأیید شده است.</p>
            </div>
          )}
        </CardContent>
        {doc ? (
          <CardContent className="pt-0">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {([
                  ['نوع سند', doc.typeTitle || '—'],
                  ['نام سند', doc.fileName || '—'],
                  ['صاحب سند', doc.ownerName || '—'],
                  ['شمارهٔ دانشجویی', doc.studentCode ? faDigits(doc.studentCode) : '—'],
                  ['وضعیت تأیید', doc.verificationStatus === 'VERIFIED' ? 'تأییدشده' : doc.verificationStatus || '—'],
                  ['تاریخ ثبت', doc.uploadedAtShamsi ? faDigits(doc.uploadedAtShamsi) : '—'],
                ] as const).map(([k, v]) => (
                  <tr key={k} className="border-b border-slate-100">
                    <td className="py-2 pl-3 font-bold whitespace-nowrap text-slate-500">{k}</td>
                    <td className="py-2 text-slate-800">{v}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2 pl-3 align-top font-bold text-slate-500">امضای دیجیتال</td>
                  <td className="py-2 font-mono text-[10px] break-all text-slate-500" dir="ltr">{doc.contentHash}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        ) : null}
      </Card>
    </PublicShell>
  );
}

// ═══════════════════ 4) /verify-degree/search — port of verify-degree/search ═══════════════════

export function VerifyDegreeSearchPage() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => {
    const c = (sp.get('code') ?? '').trim();
    navigate(c ? `/verify-degree/${encodeURIComponent(c)}` : '/verify-degree', { replace: true });
  }, [sp, navigate]);
  return null;
}

// ═══════════════════ 5) Help center — port of help/page + full help content ═══════════════════

type HelpTopicMeta = { slug: string; title: string; summary: string; keywords: string[]; path: string };
type HelpSectionMeta = { key: string; title: string; icon: string; blurb: string; topics: HelpTopicMeta[] };
type HelpQuickTask = { title: string; hint: string; href: string; role: string; topicSlug?: string };
type HelpGuideMeta = {
  role: string;
  title: string;
  icon: string;
  audience: string;
  roles: string[];
  quickTasks: HelpQuickTask[];
  sections: HelpSectionMeta[];
};

/** Help content — full port of the help/content metadata (titles, summaries, common tasks, and keywords). */
const HELP_GUIDES: HelpGuideMeta[] = [
  {
    role: 'student',
    title: 'راهنمای دانشجو',
    icon: '🎓',
    audience: 'دانشجویان همهٔ مقاطع و رشته‌ها',
    roles: ['STUDENT'],
    quickTasks: [
      { title: 'انتخاب واحد ترم', hint: 'سبد، تداخل، لیست انتظار', href: '/student/enroll', role: 'student', topicSlug: 'enroll' },
      { title: 'دیدن کارنامه', hint: 'ریز نمرات و معدل', href: '/student/transcript', role: 'student', topicSlug: 'transcript' },
      { title: 'کارت آزمون', hint: 'چاپ کارت ورود به جلسه', href: '/student/exam-card', role: 'student', topicSlug: 'exam-card' },
      { title: 'پرداخت شهریه', hint: 'صورتحساب و تسویه', href: '/student/finance', role: 'student', topicSlug: 'finance' },
      { title: 'ثبت درخواست', hint: 'گواهی، مرخصی، کمیسیون', href: '/student/requests', role: 'student', topicSlug: 'requests' },
      { title: 'برنامه هفتگی', hint: 'ساعت کلاس‌ها و امتحان‌ها', href: '/student/schedule', role: 'student', topicSlug: 'schedule' },
    ],
    sections: [
      {
        key: 'start',
        title: 'شروع کار و آشنایی با پورتال',
        icon: '🧭',
        blurb: 'چیدمان صفحه‌ها، فیلتر نیمسال و امنیت حساب.',
        topics: [
          { slug: 'dashboard', title: 'داشبورد هوشمند', summary: 'نمای یک‌نگاهی به وضعیت مالی، معدل، واحدها، برنامهٔ هفتگی و کلاس‌های آنلاین امروز.', keywords: ['داشبورد', 'وضعیت', 'معدل', 'کلاس آنلاین'], path: '/student' },
          { slug: 'term-filter', title: 'فیلتر نیمسال در هدر', summary: 'انتخاب نیمسال از هدر بالای صفحه و اثر آن بر همهٔ کارنامه‌ها، کارت‌ها و فهرست‌های همان صفحه.', keywords: ['نیمسال', 'فیلتر', 'هدر', 'ترم'], path: '/student' },
          { slug: 'account-switch', title: 'حساب کاربری، تغییر رمز و جابه‌جایی بین حساب‌ها', summary: 'رمز عبور، اجبار به تغییر رمز در اولین ورود و بنر جابه‌جایی بین حساب‌های هم‌شخص.', keywords: ['رمز', 'گذرواژه', 'جابه‌جایی', 'حساب', 'خروج'], path: '/change-password' },
        ],
      },
      {
        key: 'records',
        title: 'کارنامه، چارت و برنامه درسی',
        icon: '📜',
        blurb: 'ریز نمرات ترم‌به‌ترم، چارت مصوب رشته و برنامهٔ هفتگی کلاس‌ها و امتحان‌ها.',
        topics: [
          { slug: 'chart', title: 'چارت تحصیلی و کاتالوگ سرفصل', summary: 'دروس مصوب رشتهٔ شما ترم‌به‌ترم، وضعیت اخذ هر درس و برجسته شدن بلوک نیمسال انتخابی.', keywords: ['چارت', 'سرفصل', 'کاتالوگ', 'رشته'], path: '/student/chart' },
          { slug: 'transcript', title: 'کارنامه کل تحصیلی', summary: 'ریز نمرات همهٔ نیمسال‌ها، معدل ترمی و کل، و برچسب «معادل‌سازی» برای دروس تطبیقی.', keywords: ['کارنامه', 'نمرات', 'معدل', 'معادل‌سازی'], path: '/student/transcript' },
        ],
      },
      {
        key: 'enroll',
        title: 'انتخاب واحد و برنامهٔ امتحان',
        icon: '🛒',
        blurb: 'سبد انتخاب واحد، کنترل تداخل و پیش‌نیاز، لیست انتظار، برنامهٔ هفتگی و کارت آزمون.',
        topics: [
          { slug: 'enroll', title: 'انتخاب واحد', summary: 'افزودن دروس ارائه‌شده به سبد، کنترل خودکار تداخل و پیش‌نیاز، و ثبت نهایی با صف نوبت‌دهی.', keywords: ['انتخاب واحد', 'سبد', 'تداخل', 'پیش‌نیاز', 'لیست انتظار'], path: '/student/enroll' },
          { slug: 'schedule', title: 'برنامه هفتگی و امتحان‌ها', summary: 'جدول ساعت کلاس‌های هفته و زمان‌بندی امتحان‌های پایان‌ترم در یک نما.', keywords: ['برنامه هفتگی', 'کلاس', 'امتحان', 'زمان‌بندی'], path: '/student/schedule' },
          { slug: 'exam-card', title: 'کارت آزمون و شماره صندلی', summary: 'دریافت کارت ورود به جلسه با شماره صندلی، سالن و کد امنیتی؛ شرایط صدور و چاپ.', keywords: ['کارت آزمون', 'صندلی', 'سالن', 'ورود به جلسه'], path: '/student/exam-card' },
        ],
      },
      {
        key: 'services',
        title: 'مالی، مدارک و میز خدمات',
        icon: '💳',
        blurb: 'شهریه و پرداخت‌ها، مدارک هویتی و بایگانی، ثبت و پیگیری درخواست‌ها.',
        topics: [
          { slug: 'finance', title: 'امور مالی و شهریه', summary: 'صورتحساب شهریه، ریز تراکنش‌ها ترم‌به‌ترم، چک‌ها، وام‌ها و وضعیت بدهی.', keywords: ['شهریه', 'مالی', 'پرداخت', 'بدهی', 'چک', 'وام'], path: '/student/finance' },
          { slug: 'documents', title: 'مدارک و بایگانی', summary: 'بارگذاری مدارک هویتی و تحصیلی، نسخه‌های صادرشده و وضعیت نظام وظیفه.', keywords: ['مدارک', 'بایگانی', 'نظام وظیفه', 'بارگذاری'], path: '/student/documents' },
          { slug: 'requests', title: 'میز خدمات و درخواست‌ها', summary: 'ثبت درخواست اداری (گواهی اشتغال، مرخصی، کمیسیون موارد خاص) و پیگیری وضعیت آن.', keywords: ['درخواست', 'گواهی', 'مرخصی', 'کمیسیون', 'میز خدمات'], path: '/student/requests' },
        ],
      },
      {
        key: 'finish',
        title: 'پایان‌نامه و فارغ‌التحصیلی',
        icon: '🎓',
        blurb: 'چرخهٔ سه‌فازی پایان‌نامه، کلاس‌های آنلاین و تسویه‌حساب فارغ‌التحصیلی.',
        topics: [
          { slug: 'thesis-proposal', title: 'پایان‌نامه و پروپوزال', summary: 'ثبت عنوان و استاد راهنما، بارگذاری پروپوزال با تأیید همانندجویی، و درخواست دفاع.', keywords: ['پایان‌نامه', 'پروپوزال', 'دفاع', 'همانندجویی', 'استاد راهنما'], path: '/student/thesis-proposal' },
          { slug: 'virtual-classes', title: 'کلاس‌های آنلاین', summary: 'ورود یک‌کلیکه به کلاس مجازی (بیگ‌بلوباتن) و سامانهٔ یادگیری بدون ورود مجدد.', keywords: ['کلاس آنلاین', 'مجازی', 'بیگ‌بلوباتن', 'یادگیری'], path: '/student/virtual-classes' },
          { slug: 'graduation', title: 'فارغ‌التحصیلی', summary: 'درخواست فراغت، تسویه‌حساب پنج‌گانه و دریافت مدرک؛ انتقال به پورتال دانش‌آموختگان.', keywords: ['فارغ‌التحصیلی', 'فراغت', 'تسویه', 'مدرک'], path: '/student/graduation' },
        ],
      },
    ],
  },
  {
    role: 'professor',
    title: 'راهنمای استاد',
    icon: '👨‍🏫',
    audience: 'اعضای هیئت علمی و اساتید حق‌التدریس',
    roles: ['PROFESSOR'],
    quickTasks: [
      { title: 'ثبت حضور و غیاب', hint: 'برگهٔ حضور جلسه', href: '/professor/attendance', role: 'professor', topicSlug: 'attendance' },
      { title: 'ثبت نمرات', hint: 'بارم‌بندی و قفل نهایی', href: '/professor/grades', role: 'professor', topicSlug: 'grades' },
      { title: 'برنامه هفتگی', hint: 'کلاس‌های ترم', href: '/professor/schedule', role: 'professor', topicSlug: 'schedule' },
      { title: 'اعلام ساعات حضور', hint: 'ساعات حضور ترم', href: '/professor/availability', role: 'professor', topicSlug: 'availability' },
      { title: 'قرارداد حق‌التدریس', hint: 'تکمیل و امضا', href: '/professor/contract', role: 'professor', topicSlug: 'contract' },
      { title: 'اسناد و امضا', hint: 'امضای الکترونیک', href: '/professor/documents', role: 'professor', topicSlug: 'documents' },
    ],
    sections: [
      {
        key: 'start',
        title: 'شروع کار و داشبورد',
        icon: '🧭',
        blurb: 'فهرست کلاس‌ها، فیلتر نیمسال، قرارداد و میانبر بخش‌ها.',
        topics: [
          { slug: 'dashboard', title: 'داشبورد و فهرست کلاس‌ها', summary: 'کلاس‌های ترم با روز و ساعت و سالن، وضعیت قرارداد، میانبر نمرات و اسناد در انتظار امضا.', keywords: ['داشبورد', 'کلاس‌ها', 'قرارداد', 'امضا'], path: '/professor' },
          { slug: 'term-filter', title: 'فیلتر نیمسال در هدر', summary: 'انتخاب نیمسال از هدر کارتابل و اثر آن روی کلاس‌ها، نمرات و قرارداد همان صفحه.', keywords: ['نیمسال', 'فیلتر', 'ترم'], path: '/professor' },
        ],
      },
      {
        key: 'teach',
        title: 'تدریس، حضور و نمرات',
        icon: '📝',
        blurb: 'برنامهٔ هفتگی، برگهٔ حضور هر جلسه، بارم‌بندی و قفل نهایی نمرات.',
        topics: [
          { slug: 'schedule', title: 'برنامه هفتگی تدریس', summary: 'جدول هفتگی کلاس‌ها از شنبه تا جمعه و بلوک «کلاس‌های بدون ساعت‌بندی ثبت‌شده».', keywords: ['برنامه هفتگی', 'کلاس', 'ساعت'], path: '/professor/schedule' },
          { slug: 'attendance', title: 'ثبت حضور و غیاب', summary: 'انتخاب کلاس و جلسه، ثبت وضعیت هر دانشجو و تأیید حضور خود استاد.', keywords: ['حضور و غیاب', 'جلسه', 'غیبت'], path: '/professor/attendance' },
          { slug: 'grades', title: 'بارم‌بندی و ثبت نمرات', summary: 'تعریف سهم اجزای نمره با جمع ۲۰، ورود نمرات، قفل نهایی با رمز یکبارمصرف و رسیدگی به اعتراض.', keywords: ['نمره', 'بارم', 'قفل نهایی', 'رمز یکبارمصرف', 'اعتراض'], path: '/professor/grades' },
        ],
      },
      {
        key: 'career',
        title: 'حضور، عملکرد و قرارداد',
        icon: '📊',
        blurb: 'اعلام ساعات حضور، کارنامهٔ عملکرد و ارزشیابی، قرارداد و اسناد.',
        topics: [
          { slug: 'availability', title: 'اعلام ساعات حضور ترم', summary: 'ثبت روزها و ساعت‌هایی که در دانشگاه حضور دارید برای استفاده در برنامه‌ریزی.', keywords: ['ساعات حضور', 'برنامه‌ریزی'], path: '/professor/availability' },
          { slug: 'performance', title: 'کارنامه عملکرد', summary: 'حجم اقدامات آموزشی شما، میانگین زمان پاسخ و رتبه در میان همکاران.', keywords: ['عملکرد', 'آمار', 'رتبه'], path: '/professor/performance' },
          { slug: 'evaluation', title: 'کارنامه ارزشیابی دانشجویان', summary: 'نتیجهٔ پرسش‌نامه‌های ارزشیابی تدریس شما: نمرات و نظرهای تشریحی دانشجویان.', keywords: ['ارزشیابی', 'پرسش‌نامه', 'نظرسنجی'], path: '/professor/evaluation' },
          { slug: 'contract', title: 'فرم قرارداد حق‌التدریس', summary: 'تکمیل قرارداد تدریس ترم و امضای دیجیتال با رمز یکبارمصرف؛ شرایط پرداخت ۵۰/۵۰.', keywords: ['قرارداد', 'حق‌التدریس', 'امضا', 'پرداخت'], path: '/professor/contract' },
          { slug: 'documents', title: 'اسناد و امضا', summary: 'اسناد الکترونیکی نیازمند امضای شما با رمز یکبارمصرف پنج‌رقمی و قفل پس از ۵ تلاش ناموفق.', keywords: ['سند', 'امضای الکترونیک', 'رمز یکبارمصرف'], path: '/professor/documents' },
        ],
      },
    ],
  },
  {
    role: 'group-manager',
    title: 'راهنمای مدیر گروه',
    icon: '🏛️',
    audience: 'مدیران گروه‌های آموزشی',
    roles: ['DEP_HEAD'],
    quickTasks: [
      { title: 'تخصیص استاد', hint: 'ارائه‌های ترم', href: '/group-manager/offerings', role: 'group-manager', topicSlug: 'offerings' },
      { title: 'دروس گروه', hint: 'سرفصل و پیش‌نیاز', href: '/group-manager/courses', role: 'group-manager', topicSlug: 'courses' },
      { title: 'کلاس‌ها', hint: 'فضاهای آموزشی', href: '/group-manager/classrooms', role: 'group-manager', topicSlug: 'classrooms' },
      { title: 'معادل‌سازی', hint: 'تطبیق سرفصل', href: '/group-manager/equivalence', role: 'group-manager', topicSlug: 'equivalence' },
    ],
    sections: [
      {
        key: 'manage',
        title: 'مدیریت گروه',
        icon: '🏛️',
        blurb: 'ارائه‌های ترم، دروس، فضاهای آموزشی و معادل‌سازی.',
        topics: [
          { slug: 'offerings', title: 'ارائه‌های ترم گروه', summary: 'فهرست ارائه‌های ترم جاری گروه: تخصیص و جابه‌جایی استاد و اصلاح ظرفیت کلاس‌ها.', keywords: ['ارائه', 'تخصیص استاد', 'ظرفیت'], path: '/group-manager/offerings' },
          { slug: 'courses', title: 'دروس گروه', summary: 'فهرست دروس تحت پوشش گروه، سرفصل‌ها و پیش‌نیازها.', keywords: ['درس', 'سرفصل', 'پیش‌نیاز'], path: '/group-manager/courses' },
          { slug: 'classrooms', title: 'کلاس‌ها و فضاهای آموزشی', summary: 'فضاهای آموزشی تخصیص‌یافته به گروه و برنامهٔ استفاده از آن‌ها.', keywords: ['کلاس', 'فضا', 'سالن', 'تداخل'], path: '/group-manager/classrooms' },
          { slug: 'equivalence', title: 'معادل‌سازی دروس', summary: 'بررسی و تأیید انطباق سرفصل دروس مهمان و انتقالی؛ درج نمره در کارنامه پس از تأیید.', keywords: ['معادل‌سازی', 'مهمان', 'انتقالی', 'سرفصل'], path: '/group-manager/equivalence' },
        ],
      },
    ],
  },
  {
    role: 'admin',
    title: 'راهنمای مدیر و کارشناس',
    icon: '🛡️',
    audience: 'مدیران سامانه و کارشناسان آموزش، مالی، بایگانی و نظام وظیفه',
    roles: ['ADMIN', 'EDU_EXPERT', 'VICE_EDU', 'FINANCE_EXPERT', 'MILITARY_OFFICER', 'ARCHIVE_EXPERT', 'PROCTOR', 'VAULT_MANAGER', 'DEP_HEAD'],
    quickTasks: [
      { title: 'فعال‌سازی نیمسال', hint: 'مدیریت نیمسال‌ها', href: '/admin/terms', role: 'admin', topicSlug: 'terms' },
      { title: 'کاتالوگ و سرفصل', hint: 'چارت رشته‌ها', href: '/admin/curriculum', role: 'admin', topicSlug: 'curriculum' },
      { title: 'صف ارسال ثمین', hint: 'هاب ثمین', href: '/admin/samin', role: 'admin', topicSlug: 'samin' },
      { title: 'مالی دانشجویان', hint: 'شهریه و تسویه', href: '/admin/student-finance', role: 'admin', topicSlug: 'finance' },
      { title: 'پرونده جامع', hint: 'جست‌وجوی دانشجو/پرسنل', href: '/admin/students', role: 'admin', topicSlug: 'staff' },
      { title: 'مدیریت دانشگاه‌ها', hint: 'تغییر دانشگاه فعال', href: '/admin/universities', role: 'admin', topicSlug: 'universities' },
      { title: 'حقوق و دستمزد', hint: 'محاسبه و پرداخت حق‌التدریس', href: '/admin/payroll', role: 'admin', topicSlug: 'payroll' },
      { title: 'گزارش‌های مالی', hint: 'مرکز گزارش و صورتحساب', href: '/admin/finance/reports', role: 'admin', topicSlug: 'finance-reports' },
      { title: 'برد برنامه هفتگی', hint: 'تابلوها و چاپ برنامه', href: '/admin/weekly-board', role: 'admin', topicSlug: 'weekly-board' },
      { title: 'ثبت‌نام به‌جای دانشجو', hint: 'ثبت‌نام دستی/دسته‌جمعی', href: '/admin/manual-enroll', role: 'admin', topicSlug: 'manual-enroll' },
      { title: 'انتقال از سیستم قدیم', hint: 'مهاجرت داده و چارت رشته', href: '/admin/migration', role: 'admin', topicSlug: 'migration' },
    ],
    sections: [
      {
        key: 'base',
        title: 'زیرساخت آموزشی',
        icon: '🏗️',
        blurb: 'نیمسال‌ها، کاتالوگ رشته‌ها و انتخاب دانشگاه فعال.',
        topics: [
          { slug: 'terms', title: 'مدیریت نیمسال‌ها', summary: 'تعریف نیمسال، فعال‌سازی تکی و گروهی چند دانشگاهی، و قاعدهٔ «هر دانشگاه یک نیمسال فعال».', keywords: ['نیمسال', 'فعال‌سازی', 'ترم'], path: '/admin' },
          { slug: 'curriculum', title: 'کاتالوگ و سرفصل رشته‌ها', summary: 'نسخه‌های برنامهٔ درسی هر رشته، انتشار نسخهٔ سال ورود و مجوز حذف اضطراری دروس.', keywords: ['کاتالوگ', 'چارت', 'سرفصل', 'انتشار'], path: '/admin/curriculum' },
          { slug: 'universities', title: 'مدیریت دانشگاه‌ها و انتخاب دانشگاه فعال', summary: 'محیط چند دانشگاهی: جابه‌جایی دانشگاه فعال و اثر آن روی همهٔ ماژول‌ها.', keywords: ['دانشگاه', 'چند دانشگاهی', 'فعال'], path: '/admin' },
        ],
      },
      {
        key: 'ops',
        title: 'عملیات روزانه',
        icon: '⚙️',
        blurb: 'صف ثمین، مالی و شهریه، پروندهٔ دانشجویان و کارکنان.',
        topics: [
          { slug: 'samin', title: 'صف ارسال ثمین', summary: 'آماده‌سازی دانشجویان تأییدشده در صف، ارسال ۵۰تایی به سازمان و پیگیری وضعیت با trace.', keywords: ['ثمین', 'صف', 'ارسال', 'سازمان'], path: '/admin' },
          { slug: 'finance', title: 'مالی، شهریه و حقوق', summary: 'صورتحساب دانشجویان، موتور محاسبهٔ شهریه، ترمینال POS و حق‌التدریس اساتید.', keywords: ['مالی', 'شهریه', 'POS', 'حق‌التدریس'], path: '/admin/finance' },
          { slug: 'staff', title: 'پرونده جامع دانشجویان و پرسنل', summary: 'جست‌وجو و ویرایش پرونده، فعال/غیرفعال‌سازی، ریست گذرواژه، تخصیص نقش و استاد راهنما.', keywords: ['پرونده', 'دانشجو', 'پرسنل', 'ریست گذرواژه', 'نقش'], path: '/admin/students' },
          { slug: 'manual-enroll', title: 'ثبت‌نام به‌جای دانشجو', summary: 'ثبت‌نام تکی و دسته‌جمعی دروس برای دانشجو با کاتالوگ چارت، مدیریت درس‌های ثبت‌شده و نادیده‌گرفتن آیین‌نامه با دلیل.', keywords: ['ثبت‌نام دستی', 'دسته‌جمعی', 'کاتالوگ', 'آیین‌نامه'], path: '/admin/manual-enroll' },
          { slug: 'migration', title: 'انتقال اطلاعات از سیستم قدیم', summary: 'مهاجرت دانشکده، گروه، رشته، درس، چارت درسی، دانشجو، ترم، ثبت‌نام و مالی از فایل اکسل با آزمایشی و بازگشت‌پذیر.', keywords: ['مهاجرت', 'اکسل', 'انتقال', 'dry-run'], path: '/admin' },
        ],
      },
      {
        key: 'payroll',
        title: 'حقوق، گزارش‌های مالی و برنامه هفتگی',
        icon: '💰',
        blurb: 'محاسبه و پرداخت حق‌التدریس اساتید، گزارش‌های مالی و برد برنامهٔ هفتگی.',
        topics: [
          { slug: 'payroll', title: 'داشبورد حقوق و شبیه‌ساز', summary: 'محاسبهٔ زندهٔ حق‌التدریس، تأیید و پرداخت، به‌علاوهٔ شبیه‌ساز سناریو.', keywords: ['حقوق', 'حق‌التدریس', 'شبیه‌ساز', 'پرداخت'], path: '/admin/payroll' },
          { slug: 'payroll-coverage', title: 'پوشش فرمول‌ها', summary: 'کدام ارائه‌ها فرمول دارند، کدام ندارند و دقیقاً چرا.', keywords: ['فرمول', 'پوشش', 'ارائه'], path: '/admin/payroll/coverage' },
          { slug: 'payroll-roles', title: 'سمت‌های موظفی و انتساب ترمی', summary: 'تعریف سمت‌های موظفی (واحد موظف و کسر موظف) و انتساب ترمی آن‌ها به اساتید.', keywords: ['سمت موظفی', 'کسر موظف', 'انتساب'], path: '/admin/payroll/roles' },
          { slug: 'payroll-teaching-roles', title: 'نقش تدریس در درس‌ها', summary: 'تعریف نقش‌های تدریس (مثل کمک‌استاد و خودخوان) و بازنویسی نقش هر ارائه.', keywords: ['نقش تدریس', 'کمک‌استاد', 'خودخوان'], path: '/admin/payroll/teaching-roles' },
          { slug: 'payroll-objections', title: 'اعتراض‌های اساتید به فیش', summary: 'بررسی اعتراض استاد به فیش حقوقی و ثبت نتیجهٔ رسیدگی.', keywords: ['اعتراض', 'فیش', 'رسیدگی'], path: '/admin/payroll/regs-objections' },
          { slug: 'payroll-regulations', title: 'نسخه‌های آیین‌نامهٔ حق‌التدریس', summary: 'نسخهٔ سال جدید آیین‌نامه، نرخ مرتبه و پایهٔ استادی.', keywords: ['آیین‌نامه', 'نرخ', 'مرتبه', 'پایه'], path: '/admin/payroll' },
          { slug: 'payroll-exam', title: 'پرداخت‌های امتحانی ترم', summary: 'محاسبه و پرداخت حق‌الزحمهٔ عوامل امتحانی هر نیمسال.', keywords: ['امتحان', 'عوامل', 'حق‌الزحمه'], path: '/admin/payroll' },
          { slug: 'payroll-decrees', title: 'ابلاغ‌های آموزشی', summary: 'صدور ابلاغ تدریس، مشاهدهٔ مدرن و نهایی‌سازی آن.', keywords: ['ابلاغ', 'تدریس', 'صدور'], path: '/admin/payroll/decrees' },
          { slug: 'payroll-thesis', title: 'دفتر واحد باقی‌ماندهٔ پایان‌نامه', summary: 'رهگیری واحدهای راهنمایی و مشاورهٔ پایان‌نامهٔ هر استاد.', keywords: ['پایان‌نامه', 'واحد', 'راهنمایی', 'مشاوره'], path: '/admin/payroll' },
          { slug: 'finance-reports', title: 'مرکز گزارش‌های مالی', summary: 'گزارش‌های تجمیعی مالی: درآمد، بدهی، تسویه و مغایرت‌ها.', keywords: ['گزارش مالی', 'درآمد', 'بدهی', 'مغایرت'], path: '/admin/finance/reports' },
          { slug: 'finance-statement', title: 'صورتحساب دانشجو', summary: 'ریز ترم‌به‌ترم شهریه، پرداخت‌ها و ماندهٔ یک دانشجو.', keywords: ['صورتحساب', 'دانشجو', 'پرداخت', 'مانده'], path: '/admin/finance' },
          { slug: 'weekly-board', title: 'برد برنامهٔ هفتگی', summary: 'تابلوی هفتگی کلاس‌ها و اساتید با چاپ پوستر و گزارش.', keywords: ['برد', 'برنامه هفتگی', 'پوستر', 'چاپ'], path: '/admin/weekly-board' },
        ],
      },
    ],
  },
  {
    role: 'shared',
    title: 'راهنمای عمومی',
    icon: '📖',
    audience: 'همهٔ کاربران سامانه',
    roles: [],
    quickTasks: [
      { title: 'ورود به سامانه', hint: 'صفحه ورود', href: '/login', role: 'shared', topicSlug: 'login' },
      { title: 'تغییر گذرواژه', hint: 'امنیت حساب', href: '/change-password', role: 'shared', topicSlug: 'password' },
    ],
    sections: [
      {
        key: 'general',
        title: 'ورود، امنیت و استفاده از راهنما',
        icon: '🔑',
        blurb: 'شناسهٔ ورود، گذرواژه، جابه‌جایی حساب و جست‌وجو در راهنما.',
        topics: [
          { slug: 'login', title: 'ورود به سامانه', summary: 'ورود با کد سازمانی، رمز اولیه و انتخاب حساب در صورت چند حسابه بودن.', keywords: ['ورود', 'شناسه', 'کد ملی', 'کد سازمانی', 'گذرواژه', 'انتخاب حساب', 'اولین ورود'], path: '/login' },
          { slug: 'password', title: 'تغییر گذرواژه و امنیت', summary: 'قواعد رمز، اثر تغییر رمز روی نشست‌ها و خروج امن از دستگاه مشترک.', keywords: ['گذرواژه', 'رمز', 'امنیت', 'نشست', 'خروج', 'تغییر رمز'], path: '/change-password' },
          { slug: 'account-switch', title: 'جابه‌جایی بین حساب‌ها', summary: 'بنر جابه‌جایی سریع بین حساب‌های هم‌کد ملی بدون خروج و ورود مجدد.', keywords: ['جابه‌جایی', 'حساب', 'هم‌شخص', 'بنر', 'چند حسابه', 'انتخاب حساب'], path: '/login' },
          { slug: 'using-help', title: 'استفاده از همین مرکز راهنما', summary: 'جست‌وجو با کلید / ، فهرست نقش‌ها، کارهای پرتکرار و نسخهٔ چاپی.', keywords: ['راهنما', 'جست‌وجو', 'میانبر', 'چاپ', 'PDF', 'فهرست'], path: '/help' },
        ],
      },
    ],
  },
];

function helpCanView(sessionRoles: string[], role: string): boolean {
  if (sessionRoles.includes('ADMIN')) return true;
  if (role === 'shared') return true;
  const guide = HELP_GUIDES.find((g) => g.role === role);
  return !!guide && guide.roles.some((r) => sessionRoles.includes(r));
}

function helpVisibleGuides(sessionRoles: string[]): HelpGuideMeta[] {
  return HELP_GUIDES.filter((g) => helpCanView(sessionRoles, g.role));
}

function helpDefaultGuide(sessionRoles: string[]): string {
  if (sessionRoles.includes('ADMIN')) return 'admin';
  if (sessionRoles.includes('DEP_HEAD')) return 'group-manager';
  if (sessionRoles.includes('PROFESSOR')) return 'professor';
  if (sessionRoles.includes('STUDENT')) return 'student';
  return 'shared';
}

/** Search text normalization — Arabic yeh/kaf, ZWNJ, and Persian digits. */
function helpNormalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

const GUIDE_CARD: Record<string, string> = {
  student: 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/60',
  professor: 'border-indigo-300 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/60',
  'group-manager': 'border-teal-300 bg-teal-50/60 dark:border-teal-800 dark:bg-teal-950/60',
  admin: 'border-slate-400 bg-slate-100/70 dark:border-slate-600 dark:bg-slate-800/70',
  shared: 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/60',
};

export function HelpPage() {
  const { data: session, isLoading: sessionLoading } = useSession();
  const roles = session?.user?.roles ?? [];
  const guides = useMemo(() => helpVisibleGuides(roles), [roles]);
  const def = useMemo(() => helpDefaultGuide(roles), [roles]);
  const [query, setQuery] = useState('');
  const [openTopic, setOpenTopic] = useState<string | null>(null);

  const index = useMemo(
    () =>
      guides.flatMap((g) =>
        g.sections.flatMap((s) => s.topics.map((t) => ({ role: g.role, roleLabel: g.title, roleIcon: g.icon, section: s.title, topic: t }))),
      ),
    [guides],
  );
  const quick = useMemo(() => guides.flatMap((g) => g.quickTasks.map((q) => ({ ...q, guideIcon: g.icon, guideTitle: g.title }))).slice(0, 8), [guides]);
  const q = helpNormalize(query.trim());
  const results = q
    ? index.filter((e) =>
        [e.topic.title, e.topic.summary, e.section, e.roleLabel, ...e.topic.keywords].some((t) => helpNormalize(t).includes(q)),
      )
    : [];
  const resultsByGuide = useMemo(() => {
    const map = new Map<string, typeof index>();
    for (const e of results) {
      const list = map.get(e.role) ?? [];
      list.push(e);
      map.set(e.role, list);
    }
    return map;
  }, [results]);

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-slate-100 p-4 text-slate-900 sm:p-8" dir="rtl">
        <div className="mx-auto max-w-5xl space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-slate-900 sm:p-8" dir="rtl">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
              <BookOpen className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-sm font-black">مرکز راهنمای سامانه آفاق</h1>
              <p className="text-[11px] text-muted-foreground">
                نقش پیشنهادی شما: {HELP_GUIDES.find((g) => g.role === def)?.title}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => window.print()} className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold print:hidden">
            <Printer className="ml-1 inline size-3.5" aria-hidden /> نسخهٔ چاپی
          </button>
        </div>

        <div className="flex flex-col gap-4 rounded-3xl border border-indigo-700/50 bg-gradient-to-l from-indigo-950 via-slate-900 to-indigo-900 p-6 text-white shadow-xl sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-slate-950">مرکز راهنمای سامانه دانشگاهی آفاق</span>
            <h2 className="mt-2 text-xl font-black sm:text-3xl">📖 راهنمای قدم‌به‌قدم، مخصوص نقش شما</h2>
            <p className="mt-1 text-xs text-indigo-200 sm:text-sm">
              {session?.user ? `واردشده به‌نام ${session.user.name}` : 'راهنمای عمومی (بدون ورود)'}
            </p>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجو در راهنما…"
              className="h-10 bg-white/95 pr-9 text-slate-900"
              aria-label="جست‌وجو در راهنما"
            />
            <Search className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          </div>
        </div>

        {q ? (
          <section aria-label="نتایج جست‌وجو" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-black text-slate-800">نتایج جست‌وجو ({faDigits(results.length)} موضوع)</h2>
            {results.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">چیزی پیدا نشد؛ واژهٔ دیگری را امتحان کنید (مثلاً «کارت آزمون» یا «بارم»).</p>
            ) : (
              <div className="mt-3 space-y-3">
                {[...resultsByGuide.entries()].map(([role, list]) => {
                  const g = HELP_GUIDES.find((x) => x.role === role);
                  return (
                    <div key={role}>
                      <div className="text-[11px] font-black text-slate-500">{g?.icon} {g?.title}</div>
                      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                        {list.map((e) => (
                          <button
                            key={`${e.role}:${e.topic.slug}`}
                            type="button"
                            onClick={() => setOpenTopic(openTopic === `${e.role}:${e.topic.slug}` ? null : `${e.role}:${e.topic.slug}`)}
                            className="rounded-xl border border-slate-100 px-3 py-2 text-right hover:border-indigo-300 hover:bg-indigo-50/50"
                          >
                            <span className="block text-[13px] font-bold text-indigo-800">{e.topic.title}</span>
                            <span className="block text-[11px] text-slate-500">{e.section}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        <section aria-label="انتخاب نقش">
          <h2 className="mb-2 text-sm font-black text-slate-700">نقش خودتان را انتخاب کنید</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {guides.map((g) => (
              <button
                key={g.role}
                type="button"
                onClick={() => {
                  setQuery('');
                  setOpenTopic(`${g.role}:${g.sections[0]?.topics[0]?.slug ?? ''}`);
                  document.getElementById(`help-guide-${g.role}`)?.scrollIntoView({ behavior: 'smooth' });
                }}
                className={`block rounded-2xl border-2 p-4 text-right shadow-sm transition hover:shadow ${GUIDE_CARD[g.role] ?? 'border-slate-300 bg-white'}`}
              >
                <div className="text-2xl">{g.icon}</div>
                <h3 className="mt-1 text-sm font-black text-slate-900">{g.title}</h3>
                <p className="mt-0.5 text-[11px] text-slate-600">{g.audience}</p>
              </button>
            ))}
          </div>
        </section>

        <section aria-label="کارهای پرتکرار" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-sm font-black text-slate-800">⚡ کارهای پرتکرار</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {quick.map((qt) => (
              <button
                key={`${qt.role}:${qt.topicSlug ?? qt.href}`}
                type="button"
                onClick={() => setOpenTopic(openTopic === `${qt.role}:${qt.topicSlug ?? ''}` ? null : `${qt.role}:${qt.topicSlug ?? ''}`)}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-right hover:border-indigo-300 hover:bg-indigo-50/50"
              >
                <span>
                  <span className="block text-[13px] font-bold text-slate-800">{qt.guideIcon} {qt.title}</span>
                  <span className="block text-[11px] text-slate-500">{qt.hint} · {qt.guideTitle}</span>
                </span>
                <span className="shrink-0 text-slate-300">←</span>
              </button>
            ))}
          </div>
        </section>

        <section aria-label="فهرست موضوعات" className="space-y-4">
          {guides.map((g) => (
            <div key={g.role} id={`help-guide-${g.role}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-black text-slate-900">{g.icon} {g.title}</h2>
                <span className="rounded-xl bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-600">{g.audience}</span>
              </div>
              {g.sections.map((s) => (
                <div key={s.key} className="mt-3">
                  <h3 className="text-xs font-black text-slate-600">{s.icon} {s.title}</h3>
                  <p className="text-[11px] text-slate-500">{s.blurb}</p>
                  <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    {s.topics.map((t) => {
                      const key = `${g.role}:${t.slug}`;
                      const open = openTopic === key;
                      return (
                        <li key={t.slug}>
                          <button
                            type="button"
                            onClick={() => setOpenTopic(open ? null : key)}
                            aria-expanded={open}
                            className={`block w-full rounded-xl border px-3 py-2 text-right transition ${open ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-100 hover:border-indigo-300 hover:bg-indigo-50/50'}`}
                          >
                            <span className="block text-[13px] font-bold text-indigo-800">{t.title}</span>
                            <span className="block text-[11px] leading-5 font-normal text-slate-500">{t.summary.slice(0, 70)}…</span>
                            {open ? (
                              <span className="mt-2 block rounded-lg border border-indigo-100 bg-white px-2.5 py-2">
                                <span className="block text-[11px] leading-5 text-slate-700">{t.summary}</span>
                                <span className="mt-1.5 flex flex-wrap gap-1">
                                  {t.keywords.map((kw) => (
                                    <span key={kw} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{kw}</span>
                                  ))}
                                </span>
                                <span className="mt-1.5 block font-mono text-[10px] text-slate-400" dir="ltr">{t.path}</span>
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </section>

        <p className="pb-4 text-center text-[11px] text-slate-500">
          تعداد موضوعات نمایه‌شده: {faDigits(index.length)} · برای نسخهٔ چاپی، دکمهٔ «نسخهٔ چاپی» بالای صفحه را بزنید.
        </p>
      </div>
    </div>
  );
}

// ═══════════════════ 6) Legacy manual → help route ═══════════════════

export function ManualPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/help', { replace: true });
  }, [navigate]);
  return null;
}

// ═══════════════════ 7) Alumni portal — port of alumni ═══════════════════

const ALUMNI_STATUS_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: 'در انتظار پرداخت', PAID: 'پرداخت‌شده', IN_REVIEW: 'در حال بررسی',
  DONE: 'انجام شد', REJECTED: 'رد شد',
};
const ALUMNI_STATUS_STYLE: Record<string, string> = {
  AWAITING_PAYMENT: 'bg-amber-100 text-amber-800', PAID: 'bg-sky-100 text-sky-800',
  IN_REVIEW: 'bg-indigo-100 text-indigo-800', DONE: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
};
const ALUMNI_DEGREE_LABEL: Record<string, string> = {
  TEMPORARY: 'گواهینامهٔ موقت', PERMANENT: 'دانشنامهٔ اصلی', TRANSCRIPT: 'ریزنمرات رسمی',
};
const ALUMNI_EMPLOYMENT = ['شاغل', 'جویای کار', 'ادامهٔ تحصیل', 'کارآفرین', 'سایر'];

export function AlumniPage() {
  const { data: session, isLoading: sessionLoading } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [selected, setSelected] = useState<AlumniService | null>(null);
  const [destination, setDestination] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['alumni-summary'],
    queryFn: () => getAlumniSummary(),
    enabled: !!session?.user,
    retry: false,
  });

  const [profile, setProfile] = useState<AlumniProfile | null>(null);
  useEffect(() => {
    if (data?.profile) setProfile(data.profile);
  }, [data?.profile]);

  const requests = data?.requests ?? [];
  const services = data?.services ?? [];
  const degrees = data?.degrees ?? [];
  const me = data?.me;

  useEffect(() => {
    if (session?.user && data && !data.me) navigate('/student', { replace: true });
  }, [session, data, navigate]);

  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'خطای نامشخص' });
    } finally {
      setPending(false);
    }
  };

  const logout = async () => {
    try {
      await apiPost('/auth/logout');
    } finally {
      navigate('/login', { replace: true });
    }
  };

  if (sessionLoading || (session?.user && isLoading)) {
    return (
      <div className="min-h-screen bg-slate-100 p-4" dir="rtl">
        <div className="mx-auto max-w-6xl space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }
  if (!session?.user) {
    return (
      <PublicShell maxW="max-w-md">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
          <ShieldAlert className="mx-auto size-10 text-amber-600" aria-hidden />
          <h1 className="mt-2 text-base font-black text-slate-900">پورتال دانش‌آموختگان</h1>
          <p className="mt-1 text-xs text-slate-500">برای دسترسی باید با حساب دانش‌آموخته وارد شوید.</p>
          <Link to="/login" className="mt-3 inline-block rounded-xl bg-indigo-900 px-5 py-2.5 text-xs font-black text-white">ورود به سامانه</Link>
        </div>
      </PublicShell>
    );
  }
  if (error) {
    return (
      <PublicShell maxW="max-w-md">
        <div className="rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-xl">
          <h1 className="text-base font-black text-rose-700">{error instanceof ApiError ? error.message : 'خطا در دریافت اطلاعات'}</h1>
        </div>
      </PublicShell>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100" dir="rtl">
      <header className="sticky top-0 z-40 bg-indigo-900 text-white shadow-md print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 p-3.5 px-4">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-700 text-base font-bold shadow-inner">آ</div>
            <div>
              <p className="text-sm font-extrabold tracking-wide">پورتال دانش‌آموختگان دانشگاه آفاق</p>
              <p className="text-xs text-indigo-200">{me?.fullName} — {me?.majorName ?? '—'} / {me?.degreeTitle ?? '—'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {session.user.roles.includes('PROFESSOR') && (
              <Link
                to="/professor"
                className="rounded-lg border border-amber-300 bg-amber-400 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-300"
                title="این حساب هم پروندهٔ استادی دارد — بدون ورود مجدد به کارتابل استاد بروید"
              >
                👨‍🏫 پنل استاد
              </Link>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-indigo-700/60 bg-indigo-950/90 px-3 py-1.5 text-xs font-medium text-indigo-100 hover:bg-black"
            >
              <LogOut className="ml-1 inline size-3.5" aria-hidden /> خروج از حساب
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 p-4">
        <div className="rounded-xl border bg-gradient-to-l from-indigo-800 to-violet-900 p-4 text-white">
          <h1 className="text-base font-black sm:text-lg">{me?.fullName} عزیز، به جمع دانش‌آموختگان خوش آمدید 🎓</h1>
          <p className="mt-1 text-[11px] leading-6 text-indigo-100">
            شمارهٔ دانشجویی {me ? faDigits(me.studentCode) : '—'} — {me?.majorName ?? '—'} / {me?.degreeTitle ?? '—'}
            {me?.entryYear ? ` — ورودی ${faDigits(me.entryYear)}` : ''}
          </p>
        </div>

        {msg && (
          <div className={`rounded-xl border p-3 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
            {msg.text}
            <button className="float-left text-slate-400" onClick={() => setMsg(null)}>✕</button>
          </div>
        )}

        {/* Documents */}
        <div className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-black text-slate-800">مدارک تحصیلی من</h2>
          {!degrees.length && <p className="text-xs font-bold text-slate-500">هنوز مدرکی صادر نشده است.</p>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {degrees.map((g: AlumniDegree) => (
              <div key={g.id} className="space-y-1 rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs font-black text-slate-800">{ALUMNI_DEGREE_LABEL[g.degreeType] ?? g.degreeType}</div>
                <div className="font-mono text-[10px] text-slate-500">سریال: {g.serialNo}</div>
                {g.ministryVerificationCode && <div className="font-mono text-[10px] text-slate-500">کد صحت وزارت: {g.ministryVerificationCode}</div>}
                <div className="text-[10px] text-slate-500">تاریخ صدور: {fmtJalali(g.issuedAt)} — {g.isDelivered ? 'تحویل شده ✅' : 'در انتظار تحویل'}</div>
                <Link
                  to={`/verify-degree/${encodeURIComponent(g.verifyCode)}`}
                  target="_blank"
                  className="inline-block rounded-lg bg-indigo-100 px-2 py-1 text-[10px] font-black text-indigo-800"
                >
                  صفحهٔ استعلام و QR
                </Link>
              </div>
            ))}
          </div>
        </div>

        {/* Service desk */}
        <div className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-black text-slate-800">خدمات آنلاین دانش‌آموختگان</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {services.map((s: AlumniService) => (
              <button
                key={s.code}
                type="button"
                onClick={() => setSelected(s)}
                className={`rounded-xl border bg-white p-3 text-right transition hover:border-indigo-400 ${selected?.code === s.code ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-slate-200'}`}
              >
                <div className="text-xs font-black text-slate-800">{s.title}</div>
                <div className="mt-1 text-[10px] leading-4 text-slate-500">{s.hint}</div>
                <div className="mt-1 text-[11px] font-black text-indigo-700">{s.fee > 0 ? money(s.fee) : 'رایگان'}</div>
              </button>
            ))}
          </div>

          {selected && (
            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <h3 className="text-xs font-black text-slate-800">ثبت درخواست: {selected.title}</h3>
              {selected.needsDestination && (
                <Input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="نام دارالترجمه یا سازمان مقصد"
                  className="h-9 text-xs"
                />
              )}
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="توضیح تکمیلی (اختیاری)"
                className="w-full rounded-lg border border-input bg-card px-3 py-2 text-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      if (!selected) return;
                      const r = await submitAlumniRequest({ requestType: selected.code, destination, description });
                      await queryClient.invalidateQueries({ queryKey: ['alumni-summary'] });
                      setSelected(null);
                      setDestination('');
                      setDescription('');
                      setMsg({ kind: 'ok', text: 'درخواست شما ثبت شد. کد رهگیری در جدول زیر است.' });
                      void r;
                    })
                  }
                >
                  ثبت درخواست {selected.fee > 0 ? `و پرداخت ${money(selected.fee)}` : ''}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setSelected(null)}>انصراف</Button>
              </div>
            </div>
          )}
        </div>

        {/* My requests */}
        <div className="overflow-x-auto rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-black text-slate-800">پیگیری درخواست‌های من</h2>
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                {['کد رهگیری', 'خدمت', 'مقصد', 'هزینه', 'وضعیت', 'تاریخ', 'اقدام'].map((h) => (
                  <th key={h} className="p-2 text-right font-black">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((r: AlumniRequest) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-2 font-mono">{r.trackingCode}</td>
                  <td className="p-2 font-bold">{services.find((s) => s.code === r.requestType)?.title ?? r.requestType}</td>
                  <td className="p-2">{r.destination ?? '—'}</td>
                  <td className="p-2 font-mono">{r.fee ? money(r.fee) : 'رایگان'}</td>
                  <td className="p-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-black ${ALUMNI_STATUS_STYLE[r.status] ?? 'bg-slate-100'}`}>
                      {ALUMNI_STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    {r.adminNote && <div className="mt-0.5 text-[10px] text-slate-500">{r.adminNote}</div>}
                  </td>
                  <td className="p-2 text-[10px]">{fmtJalali(r.createdAt)}</td>
                  <td className="p-2">
                    {r.status === 'AWAITING_PAYMENT' && (
                      <button
                        type="button"
                        disabled={pending}
                        title="مبلغ را به واحد مالی پرداخت کنید؛ پس از تأیید کارشناس، درخواست به کارتابل اداره آموزش می‌رود."
                        onClick={() =>
                          void run(async () => {
                            try {
                              await payAlumniRequest(r.id);
                              await queryClient.invalidateQueries({ queryKey: ['alumni-summary'] });
                            } catch (e) {
                              setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'خطای نامشخص' });
                              return;
                            }
                            setMsg({ kind: 'ok', text: 'پرداخت ثبت شد و درخواست به کارتابل اداره آموزش رفت.' });
                          })
                        }
                        className="rounded-lg bg-slate-600 px-2 py-1 text-[10px] font-black text-white disabled:opacity-50"
                      >
                        راهنمای پرداخت
                      </button>
                    )}
                    {r.resultFileUrl && isSafeLinkUrl(r.resultFileUrl) && (
                      <a href={r.resultFileUrl} className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-black">دریافت فایل</a>
                    )}
                  </td>
                </tr>
              ))}
              {!requests.length && (
                <tr><td colSpan={7} className="p-6 text-center font-bold text-slate-400">هنوز درخواستی ثبت نکرده‌اید.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Alumni dossier */}
        {profile && (
          <div className="space-y-2 rounded-xl border bg-card p-4">
            <h2 className="text-sm font-black text-slate-800">اطلاعات شغلی و ارتباطی من</h2>
            <p className="text-[11px] text-slate-500">این اطلاعات برای شبکهٔ دانش‌آموختگان و دعوت به رویدادهای دانشگاه استفاده می‌شود.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className="text-[10px] font-bold text-slate-500">وضعیت اشتغال</span>
                <select
                  value={profile.employmentStatus}
                  onChange={(e) => setProfile({ ...profile, employmentStatus: e.target.value })}
                  className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                >
                  <option value="">—</option>
                  {ALUMNI_EMPLOYMENT.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
              {([['organization', 'سازمان/شرکت'], ['jobTitle', 'عنوان شغلی'], ['contactEmail', 'رایانامه'], ['contactMobile', 'تلفن همراه'], ['linkedinUrl', 'نشانی لینکدین']] as const).map(([k, l]) => (
                <label key={k} className="block">
                  <span className="text-[10px] font-bold text-slate-500">{l}</span>
                  <Input value={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} className="mt-0.5 h-8 text-xs" />
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs font-bold">
              <input
                type="checkbox"
                checked={profile.allowContact}
                onChange={(e) => setProfile({ ...profile, allowContact: e.target.checked })}
              />
              دانشگاه می‌تواند برای فرصت‌های شغلی و رویدادها با من تماس بگیرد.
            </label>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  if (!profile) return;
                  await saveAlumniProfile(profile);
                  await queryClient.invalidateQueries({ queryKey: ['alumni-summary'] });
                  setMsg({ kind: 'ok', text: 'اطلاعات شما به‌روزرسانی شد.' });
                })
              }
            >
              ذخیرهٔ اطلاعات
            </Button>
          </div>
        )}
      </main>
      <footer className="py-4 text-center text-[11px] text-slate-400">
        ارتباط شما با دانشگاه پس از فراغت از تحصیل قطع نمی‌شود.
      </footer>
    </div>
  );
}

// ═══════════════════ 8) Proctor panel — port of proctor ═══════════════════

export function ProctorPage() {
  const { data: session, isLoading: sessionLoading } = useSession();
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [marked, setMarked] = useState<Record<string, { present: boolean; permit: boolean; method?: 'QR_SCAN' | 'MANUAL_BY_INVIGILATOR' }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [scanValue, setScanValue] = useState('');
  const [scanResult, setScanResult] = useState<{ name: string; code: string; ok: boolean } | null>(null);

  const proctorRoles = ['PROCTOR', 'ADMIN', 'EDU_EXPERT'];
  const allowed = !!session?.user && session.user.roles.some((r) => proctorRoles.includes(r));

  const { data, isLoading } = useQuery({
    queryKey: ['proctor-sessions'],
    queryFn: () => getProctorSessions(),
    enabled: allowed,
    retry: false,
  });

  const sessions = data?.sessions ?? [];
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null,
    [sessions, activeSessionId],
  );

  const showMsg = (text: string, error = false) => {
    setMsg({ text, error });
    setTimeout(() => setMsg(null), 6000);
  };

  const toggleMark = (sessionId: number, studentId: number, patch: Partial<{ present: boolean; permit: boolean; method: 'QR_SCAN' | 'MANUAL_BY_INVIGILATOR' }>) => {
    const key = `${sessionId}-${studentId}`;
    setMarked((prev) => {
      const before = prev[key] ?? { present: false, permit: false };
      const next = { ...before, ...patch };
      if (patch.present === true && !patch.method && before.method !== 'QR_SCAN') {
        next.method = 'MANUAL_BY_INVIGILATOR';
      }
      return { ...prev, [key]: next };
    });
  };

  const methodFor = (sessionId: number, r: { studentId: number; isPresent: boolean; checkInMethod: string | null }): 'QR_SCAN' | 'MANUAL_BY_INVIGILATOR' | 'SYSTEM_EXCUSE' => {
    const m = marked[`${sessionId}-${r.studentId}`];
    const present = m ? m.present : r.isPresent;
    if (!present) return 'SYSTEM_EXCUSE';
    if (m?.method) return m.method;
    if (r.checkInMethod === 'QR_SCAN' || r.checkInMethod === 'MANUAL_BY_INVIGILATOR') return r.checkInMethod;
    return 'MANUAL_BY_INVIGILATOR';
  };

  const handleClockIn = async () => {
    if (!activeSession) return;
    setBusy(true);
    try {
      await proctorClockIn(activeSession.id);
      showMsg('✅ ورود شما ثبت شد.');
      await queryClient.invalidateQueries({ queryKey: ['proctor-sessions'] });
    } catch (e) {
      showMsg(e instanceof ApiError ? e.message : 'خطا در ثبت ورود — از مدیر امتحانات پیگیری کنید.', true);
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    if (!activeSession) return;
    const roster = activeSession.roster;
    const checkIns = roster
      .filter((r) => r.studentId)
      .map((r) => {
        const m = marked[`${activeSession.id}-${r.studentId}`];
        const present = m ? m.present : r.isPresent;
        const permit = m ? m.permit : r.hasTemporaryPermit;
        return {
          studentId: r.studentId,
          isPresent: (present ? 1 : 0) as 0 | 1,
          method: methodFor(activeSession.id, r),
          hasTemporaryPermit: (permit ? 1 : 0) as 0 | 1,
        };
      });
    if (checkIns.every((c) => c.isPresent === 0)) {
      showMsg('هیچ دانشجویی به‌عنوان حاضر علامت‌گذاری نشده است.', true);
      return;
    }
    setBusy(true);
    try {
      const res = await proctorVerifyAttendance({ sessionId: activeSession.id, hallId: activeSession.hallId, checkIns });
      showMsg(`✅ حضور و غیاب سالن با موفقیت ثبت شد (${faDigits(res.verified)} ردیف).`);
      await queryClient.invalidateQueries({ queryKey: ['proctor-sessions'] });
    } catch (e) {
      showMsg('خطا در ثبت حضور: ' + (e instanceof ApiError ? e.message : 'نامشخص'), true);
    } finally {
      setBusy(false);
    }
  };

  const handleScan = async () => {
    if (!activeSession) return;
    const raw = scanValue.trim();
    if (!raw) return;
    setBusy(true);
    try {
      const r = await proctorScanTicket({ sessionId: activeSession.id, hallId: activeSession.hallId, raw });
      toggleMark(activeSession.id, r.studentId, { present: true, method: 'QR_SCAN' });
      setScanResult({ name: r.studentName, code: r.studentCode, ok: true });
      showMsg(`✅ حضور ${r.studentName} (${r.studentCode}) ثبت شد.`);
    } catch (e) {
      setScanResult(null);
      showMsg('⛔ ' + (e instanceof ApiError ? e.message : 'کارت خوانده نشد'), true);
    } finally {
      setBusy(false);
      setScanValue('');
    }
  };

  if (sessionLoading) {
    return <div className="min-h-screen bg-slate-100 p-6" dir="rtl"><Skeleton className="h-64 w-full" /></div>;
  }
  if (!session?.user) {
    return (
      <PublicShell maxW="max-w-md">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
          <Eye className="mx-auto size-10 text-teal-700" aria-hidden />
          <h1 className="mt-2 text-base font-black text-slate-900">پنل مراقب امتحان</h1>
          <p className="mt-1 text-xs text-slate-500">برای دسترسی باید با حساب مراقب وارد شوید.</p>
          <Link to="/login" className="mt-3 inline-block rounded-xl bg-teal-800 px-5 py-2.5 text-xs font-black text-white">ورود به سامانه</Link>
        </div>
      </PublicShell>
    );
  }
  if (!allowed) {
    return (
      <PublicShell maxW="max-w-md">
        <div className="rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-xl">
          <ShieldAlert className="mx-auto size-10 text-rose-600" aria-hidden />
          <h1 className="mt-2 text-base font-black text-slate-900">دسترسی غیرمجاز</h1>
          <p className="mt-1 text-xs text-slate-500">این پنل مخصوص مراقبان امتحان و کارشناسان آموزش است.</p>
        </div>
      </PublicShell>
    );
  }

  const roster = activeSession?.roster ?? [];
  const presentCount = roster.filter((r) => (marked[`${activeSession?.id}-${r.studentId}`]?.present ?? r.isPresent)).length;
  const pendingCount = roster.filter((r) => !(marked[`${activeSession?.id}-${r.studentId}`]?.present ?? r.isPresent)).length;

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-6" dir="rtl">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="rounded-3xl bg-gradient-to-l from-teal-950 via-teal-900 to-slate-900 p-5 text-white shadow-lg">
          <h1 className="text-lg font-black">👁️ پنل مراقب امتحان — {data?.staffName ?? session.user.name}</h1>
          <p className="mt-1 text-xs text-teal-100">
            {sessions.length} سالن تخصیصی · حضور و غیاب مستقیماً در سامانهٔ امتحانات ثبت می‌شود (زنجیرهٔ تحویل + ممیزی).
          </p>
        </div>

        {msg && (
          <div className={`rounded-xl border p-3 text-center text-xs font-black shadow ${msg.error ? 'border-rose-300 bg-rose-100 text-rose-800' : 'border-emerald-300 bg-emerald-100 text-emerald-900'}`}>
            {msg.text}
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : sessions.length === 0 ? (
          <div className="rounded-xl border bg-card p-10 text-center">
            <div className="mb-2 text-4xl">🗓️</div>
            <p className="font-black text-slate-800">{data?.noStaff ? 'پروندهٔ پرسنلی یافت نشد.' : 'جلسهٔ امتحانی برای شما ثبت نشده است'}</p>
            {!data?.noStaff && <p className="mt-2 text-xs text-slate-500">با رسیدن نوبت مراقبت، تخصیص شما از کارتابل امتحانات به همین پنل اضافه می‌شود.</p>}
          </div>
        ) : (
          <>
            {sessions.length > 1 && (
              <div className="flex gap-2 overflow-x-auto">
                {sessions.map((s: ProctorSessionData) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveSessionId(s.id)}
                    className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-black transition ${s.id === activeSession?.id ? 'bg-teal-800 text-white shadow' : 'border border-teal-200 bg-white text-teal-900'}`}
                  >
                    {s.hallName} — {faDigits(s.examDate)}
                  </button>
                ))}
              </div>
            )}

            {activeSession && (
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 p-4">
                  <div className="space-y-1">
                    <p className="font-black text-slate-900">{activeSession.hallName} <span className="text-xs font-bold text-slate-400">({activeSession.buildingName})</span></p>
                    <p className="text-xs font-bold text-slate-500">
                      تاریخ امتحان: {faDigits(activeSession.examDate)} · ساعت {faDigits(activeSession.startTime)} تا {faDigits(activeSession.endTime)} · ظرفیت سالن: {faDigits(activeSession.hallCapacity)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-xl px-3 py-1.5 text-[11px] font-black ${activeSession.clockInStatus === 'PRESENT' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                      {activeSession.clockInStatus === 'PRESENT' ? '✓ حضور ثبت شده' : '⏳ ورود ثبت نشده'}
                    </span>
                    <Button size="sm" onClick={() => void handleClockIn()} disabled={busy}>
                      <Clock className="size-3.5" aria-hidden /> ثبت ورود مراقب
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 border-b border-slate-100 p-4 text-center">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-[10px] font-bold text-emerald-700">حاضر</p>
                    <p className="text-xl font-black text-emerald-900">{faDigits(presentCount)}</p>
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-[10px] font-bold text-amber-700">در انتظار بررسی</p>
                    <p className="text-xl font-black text-amber-900">{faDigits(pendingCount)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[10px] font-bold text-slate-500">کل صندلی‌ها</p>
                    <p className="text-xl font-black text-slate-900">{faDigits(roster.length)}</p>
                  </div>
                </div>

                <div className="border-b border-slate-100 bg-teal-50/50 p-4">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-[240px] flex-1">
                      <span className="mb-1 block text-[11px] font-black text-teal-900">📷 اسکن QR کارت ورود به جلسه (یا چسباندن کد)</span>
                      <Input
                        value={scanValue}
                        onChange={(e) => setScanValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleScan(); } }}
                        placeholder="اسکنر را روی QR کارت بگیرید…"
                        dir="ltr"
                        className="border-teal-300 bg-white font-mono text-xs"
                      />
                    </label>
                    <Button size="sm" onClick={() => void handleScan()} disabled={busy || !scanValue.trim()}>
                      ثبت حضور با اسکن
                    </Button>
                  </div>
                  {scanResult && (
                    <p className={`mt-2 text-[11px] font-black ${scanResult.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {scanResult.ok
                        ? `✓ ${scanResult.name}${scanResult.code ? ` — ${scanResult.code}` : ''} به‌عنوان حاضر ثبت شد.`
                        : `⛔ ${scanResult.name} در این جلسه/سالن نیست.`}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-teal-800/80">
                    توکن کارت با امضای سامانه بررسی می‌شود؛ حضور فقط برای دانشجوی همین سالن ثبت می‌گردد و در زنجیرهٔ ممیزی می‌ماند.
                    دانشجویی که کارت نیاورده را از ستون «حاضر» تیک بزنید — به‌صورت خودکار با روش «ثبت دستی مراقب» و در صورتجلسه ثبت می‌شود.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-900 text-center text-[11px] text-white">
                        <th className="p-2.5">صندلی</th>
                        <th className="p-2.5">دانشجو</th>
                        <th className="p-2.5">شمارهٔ دانشجویی</th>
                        <th className="p-2.5">کد ملی</th>
                        <th className="p-2.5">رشته</th>
                        <th className="p-2.5">درس</th>
                        <th className="p-2.5">حاضر</th>
                        <th className="p-2.5">مجوز تعهد</th>
                        <th className="p-2.5">وضعیت</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roster.map((r) => {
                        const key = `${activeSession.id}-${r.studentId}`;
                        const present = marked[key]?.present ?? r.isPresent;
                        const permit = marked[key]?.permit ?? r.hasTemporaryPermit;
                        return (
                          <tr key={key} className={`border-b border-slate-100 ${present ? 'bg-emerald-50/40' : ''}`}>
                            <td className="p-2.5 text-center font-mono font-black text-teal-900">{faDigits(r.seatNumber)}</td>
                            <td className="p-2.5 font-black text-slate-900">{r.studentName}</td>
                            <td className="p-2.5 font-mono text-slate-600" dir="ltr">{r.studentCode ? faDigits(r.studentCode) : '—'}</td>
                            <td className="p-2.5 font-mono text-slate-500" dir="ltr">{r.nationalCodeMasked}</td>
                            <td className="p-2.5 font-bold text-slate-600">{r.majorTitle}</td>
                            <td className="p-2.5">
                              <span className="font-black text-indigo-950">{r.courseCode}</span>
                              <span className="block text-[10px] text-slate-500">{r.courseTitle}</span>
                            </td>
                            <td className="p-2.5 text-center">
                              <input type="checkbox" checked={present} onChange={(e) => toggleMark(activeSession.id, r.studentId, { present: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
                            </td>
                            <td className="p-2.5 text-center">
                              <input type="checkbox" checked={permit} onChange={(e) => toggleMark(activeSession.id, r.studentId, { permit: e.target.checked })} className="h-4 w-4 accent-amber-500" />
                            </td>
                            <td className="p-2.5 text-center">
                              {present ? (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800">
                                  ✓ حاضر {r.checkInTime ? `(${faDigits(r.checkInTime)})` : ''}
                                </span>
                              ) : (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">—</span>
                              )}
                              {present && (
                                <span className={`mt-1 block text-[9px] font-black ${methodFor(activeSession.id, r) === 'QR_SCAN' ? 'text-teal-700' : 'text-amber-700'}`}>
                                  {methodFor(activeSession.id, r) === 'QR_SCAN' ? '🔳 اسکن کارت' : '✋ کارت نیاورده (ثبت دستی مراقب)'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-bold text-slate-500">
                    ثبت نهایی، حضور را در جدول «حضور و غیاب آزمون» (exam_attendances) با امضای مراقب ثبت می‌کند — قابل استعلام در زنجیرهٔ تحویل.
                  </p>
                  <Button onClick={() => void handleVerify()} disabled={busy} className="font-black">
                    📋 ثبت حضور و غیاب سالن ({faDigits(presentCount)} حاضر)
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════ 9) Professor attendance via door QR — port of p/[code] ═══════════════════

const ROOM_MSG: Record<string, string> = {
  ok: 'حضور شما با موفقیت ثبت شد.',
  okctrl: 'حضور استاد برای این جلسه ثبت شد.',
  okmerged: 'این کلاس ادغامی بود؛ حضور روی همهٔ کلاس‌های ادغامی ثبت شد.',
  okctrlmerged: 'این کلاس ادغامی بود؛ حضور استاد روی همهٔ کلاس‌های ادغامی ثبت شد.',
  already: 'حضور برای این جلسه قبلاً ثبت شده است.',
};

const ROOM_DAY_NAMES = ['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

function hmToMinutesRoom(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return -1;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return -1;
  return h * 60 + mi;
}

function checkinStateRoom(startTime: string, endTime: string, nowMinutes: number): 'BEFORE' | 'OPEN' | 'CLOSED' {
  const start = hmToMinutesRoom(startTime);
  const end = hmToMinutesRoom(endTime);
  if (start < 0 || end < 0) return 'CLOSED';
  if (nowMinutes < start - 30) return 'BEFORE';
  if (nowMinutes > end + 20) return 'CLOSED';
  return 'OPEN';
}

function tehranMinutesRoom(): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return h * 60 + m;
  } catch {
    const d = new Date(Date.now() + 3.5 * 3600_000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

function roomShell(children: ReactNode, maxW = 'max-w-md') {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 py-8 px-4 font-sans" dir="rtl">
      <div className={`w-full ${maxW} space-y-3`}>{children}</div>
    </div>
  );
}

function roomCard(children: ReactNode) {
  return <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">{children}</div>;
}

function RoomNotice({ kind, text }: { kind: 'ok' | 'err' | 'info'; text: string }) {
  const tone =
    kind === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : kind === 'err'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : 'border-amber-200 bg-amber-50 text-amber-800';
  return <div className={`rounded-2xl border px-4 py-3 text-xs leading-6 font-bold ${tone}`}>{text}</div>;
}

function mergeBadgeText(memberCount: number): string {
  const n = Math.max(0, Math.floor(memberCount));
  return n === 1 ? 'یک کلاس' : `${faDigits(n)} کلاس ادغامی`;
}

export function PublicProfilePage() {
  const { code = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const [nowMin, setNowMin] = useState(() => tehranMinutesRoom());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNowMin(tehranMinutesRoom()), 60_000);
    return () => clearInterval(t);
  }, []);

  const roomQ = useQuery({
    queryKey: ['public-room', code],
    queryFn: () => getPublicRoom(code),
    enabled: !!code,
    staleTime: 60_000,
  });

  const stateQ = useQuery({
    queryKey: ['room-checkin', code],
    queryFn: () => getRoomCheckinState(code),
    enabled: !!code && !!session?.user,
    retry: false,
  });

  const state = stateQ.data as RoomCheckinState | undefined;

  const record = async (sessionId: number) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await recordRoomCheckin(code, sessionId);
      await queryClient.invalidateQueries({ queryKey: ['room-checkin', code] });
      setMsg({ kind: 'ok', text: ROOM_MSG[res.message] ?? 'ثبت شد.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'خطای نامشخص رخ داد.' });
    } finally {
      setBusy(false);
    }
  };

  if (!code || roomQ.data?.found === false) {
    const badroom = roomQ.data?.reason === 'badroom' || /^room-0+$/.test(code) || !/^room-\d{1,9}$/.test(code.trim());
    return roomShell(
      roomCard(
        <>
          <h1 className="text-center text-lg font-black text-slate-900">{badroom ? 'QR نامعتبر' : 'اتاق یافت نشد'}</h1>
          <RoomNotice
            kind="err"
            text={badroom ? 'کد این QR معتبر نیست. لطفاً QR سردر کلاس را دوباره اسکن کنید.' : 'این اتاق در سامانه ثبت نشده است. با ادارهٔ آموزش تماس بگیرید.'}
          />
        </>,
      ),
    );
  }

  const room = roomQ.data?.room;
  const uniTitle = roomQ.data?.uniTitle ?? null;
  const roomLine = [room?.buildingName, room?.floor].filter(Boolean).join(' · ');
  const header = (
    <div className="space-y-1 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border-2 border-amber-400 bg-gradient-to-tr from-indigo-950 to-indigo-800 text-xl font-black text-white shadow-lg">آ</div>
      <div className="text-[11px] font-bold text-slate-500">{uniTitle ?? 'سامانه جامع آفاق'}</div>
      <h1 className="text-xl font-black text-slate-900">ثبت حضور استاد</h1>
      <div className="text-xs font-bold text-slate-600">
        اتاق {room ? faDigits(room.name) : '—'}
        {roomLine ? <span className="text-slate-400"> — {faDigits(roomLine)}</span> : null}
      </div>
      {room && room.isActive === 0 ? <div className="text-[10px] font-bold text-amber-700">این اتاق در سامانه غیرفعال است.</div> : null}
    </div>
  );

  if (!session?.user) {
    return roomShell(
      roomCard(
        <>
          {header}
          <RoomNotice kind="info" text="برای ثبت حضور باید با حساب استاد وارد سامانه شوید." />
          <Link
            to={`/login?next=${encodeURIComponent(`/${code}`)}`}
            className="block w-full rounded-2xl bg-indigo-900 py-3 text-center text-xs font-black text-white shadow-md transition hover:bg-indigo-950"
          >
            ورود به سامانه
          </Link>
        </>,
      ),
    );
  }

  if (stateQ.isLoading) return roomShell(roomCard(<>{header}<Skeleton className="h-48 w-full" /></>));
  if (stateQ.error) {
    return roomShell(roomCard(<>{header}<RoomNotice kind="err" text={stateQ.error instanceof ApiError ? stateQ.error.message : 'خطا در دریافت وضعیت جلسات.'} /></>));
  }
  if (state?.badroom) {
    return roomShell(roomCard(<><h1 className="text-center text-lg font-black text-slate-900">QR نامعتبر</h1><RoomNotice kind="err" text="کد این QR معتبر نیست. لطفاً QR سردر کلاس را دوباره اسکن کنید." /></>));
  }
  if (state?.notfound) {
    return roomShell(roomCard(<><h1 className="text-center text-lg font-black text-slate-900">اتاق یافت نشد</h1><RoomNotice kind="err" text="این اتاق در سامانه ثبت نشده است. با ادارهٔ آموزش تماس بگیرید." /></>));
  }
  if (state?.wronguni || !state) {
    return roomShell(roomCard(<>{header}<RoomNotice kind="err" text="این اتاق به دانشگاه دیگری تعلق دارد و در دسترس حساب شما نیست." /></>));
  }

  const ctrlCan = state.control.allowed && state.policy.controllerAllowed;
  const focus = state.focus;
  const weekly = state.weekly;
  const myShared = new Set(state.mySharedOfferings);
  const isMySlot = (w: { professorId: number | null; offeringId: number }) =>
    w.professorId === state.me.staffId || myShared.has(w.offeringId);

  const byDay = new Map<number, typeof weekly>();
  for (const w of weekly) {
    const list = byDay.get(w.dayOfWeek) ?? [];
    list.push(w);
    byDay.set(w.dayOfWeek, list);
  }
  const todayDow = state.todayDow;
  const weekDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => byDay.has(d) || d === todayDow);

  const ctrlDone = state.ctrlGroups.filter((g) => g.recordedAt != null).length;

  const focusGroupMemberTitles = focus?.merged ? (focus.memberTitles ?? '') : '';
  const upcoming = state.upcoming;

  return roomShell(
    <>
      {roomCard(
        <>
          {header}

          {msg ? <RoomNotice kind={msg.kind} text={msg.text} /> : null}

          {!focus ? (
            <>
              {!ctrlCan ? <RoomNotice kind="info" text="امروز برای شما در این اتاق کلاسی ثبت نشده است." /> : null}
              {upcoming.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-black text-slate-700">جلسات بعدی شما در این اتاق</div>
                  {upcoming.map((u) => (
                    <div key={u.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-xs font-black text-slate-800">{u.courseTitle}</div>
                      <div className="mt-0.5 text-[10px] font-bold text-slate-500" dir="ltr">
                        {faDigits(u.courseCode)} · {faDigits(u.sessionDate)} · {faDigits(u.startTime)} تا {faDigits(u.endTime)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="space-y-1 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-black text-slate-900">{focus.courseTitle}</span>
                  {focus.merged ? (
                    <span
                      title={`این کلاس از ${focus.memberCount} عرضه تشکیل شده: ${focusGroupMemberTitles}`}
                      className="shrink-0 rounded-full border border-violet-200 bg-violet-100 px-1.5 py-0.5 text-[9px] font-black text-violet-800"
                    >
                      🔗 {mergeBadgeText(focus.memberCount ?? 1)}
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] font-bold text-slate-500" dir="ltr">
                  {faDigits(focus.courseCode)} · گروه {faDigits(focus.groupNumber)}
                </div>
                <div className="text-[11px] font-bold text-slate-600">{faDigits(focus.startTime)} تا {faDigits(focus.endTime)}</div>
                {focus.merged && focusGroupMemberTitles ? (
                  <div className="text-[10px] font-bold text-violet-700/80" title={focusGroupMemberTitles}>
                    کلاس ادغامی: {focusGroupMemberTitles}
                  </div>
                ) : null}
              </div>

              {focus.recorded ? (
                <div className="space-y-1 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-center">
                  <div className="text-2xl">✅</div>
                  <div className="text-xs font-black text-emerald-800">حضور شما ثبت شده است</div>
                  {focus.recordedAt ? <div className="text-[10px] font-bold text-emerald-700">زمان ثبت: {faDigits(focus.recordedAt)}</div> : null}
                </div>
              ) : focus.state === 'OPEN' && state.policy.professorAllowed ? (
                <div className="space-y-2">
                  <Button
                    className="w-full rounded-2xl bg-emerald-600 py-4 text-sm font-black shadow-md hover:bg-emerald-700"
                    disabled={busy}
                    onClick={() => void record(focus.id)}
                  >
                    ثبت حضور من
                  </Button>
                  {focus.window ? (
                    <div className="text-center text-[10px] font-bold text-slate-500">
                      بازهٔ مجاز ثبت: {faDigits(focus.window.from)} تا {faDigits(focus.window.to)}
                    </div>
                  ) : null}
                </div>
              ) : focus.state === 'OPEN' ? (
                <RoomNotice kind="info" text="بر اساس تنظیم سامانه، ثبت حضور در این دانشگاه فقط توسط کنترل‌کنندهٔ حضور و غیاب انجام می‌شود." />
              ) : focus.state === 'BEFORE' ? (
                <RoomNotice
                  kind="info"
                  text={focus.window ? `پنجرهٔ ثبت حضور از ساعت ${faDigits(focus.window.from)} باز می‌شود.` : 'پنجرهٔ ثبت حضور هنوز باز نشده است.'}
                />
              ) : (
                <RoomNotice kind="err" text="زمان مجاز ثبت حضور این جلسه گذشته است. در صورت نیاز با ادارهٔ آموزش تماس بگیرید." />
              )}
            </>
          )}

          <div className="border-t border-slate-100 pt-2 text-center text-[10px] font-bold text-slate-400">
            {faDigits(state.todayJalali)} · این صفحه فقط برای ثبت حضورِ کلاس است
            {ctrlCan ? ' (شما به‌عنوان کنترل‌کنندهٔ حضور این اتاق شناخته شدید).' : ' (استاد یا کنترل‌کنندهٔ حضور).'}
          </div>
        </>,
      )}

      {/* Controller cartable */}
      {ctrlCan ? (
        roomCard(
          <details open>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
              <span className="text-sm font-black text-slate-900">کنترل حضور و غیاب این اتاق</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${state.ctrlGroups.length > 0 && ctrlDone === state.ctrlGroups.length ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {faDigits(ctrlDone)} از {faDigits(state.ctrlGroups.length)} کلاس
              </span>
            </summary>
            {state.ctrlGroups.length === 0 ? (
              <div className="mt-3"><RoomNotice kind="info" text="امروز جلسه‌ای در این اتاق برگزار نمی‌شود." /></div>
            ) : (
              <div className="mt-3 space-y-1.5">
                {state.ctrlGroups.map((g) => {
                  const st = checkinStateRoom(g.startTime, g.endTime, nowMin);
                  return (
                    <div key={g.sessionId} className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${g.recordedAt ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'}`}>
                      <div className="w-12 shrink-0 text-[10px] leading-4 font-bold text-slate-500" dir="ltr">
                        {faDigits(g.startTime)}
                        <br />
                        {faDigits(g.endTime)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[11px] font-black text-slate-800">{g.courseTitle}</span>
                          {g.merged ? (
                            <span
                              title={`این کلاس از ${g.memberCount} عرضه تشکیل شده: ${g.memberTitles}`}
                              className="shrink-0 rounded-full border border-violet-200 bg-violet-100 px-1.5 py-0.5 text-[9px] font-black text-violet-800"
                            >
                              🔗 {mergeBadgeText(g.memberCount)}
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-[10px] font-bold text-slate-500">گروه {faDigits(g.groupNumber)}</div>
                        {g.merged && g.memberTitles ? (
                          <div className="truncate text-[9px] font-bold text-violet-700/80" title={g.memberTitles}>{g.memberTitles}</div>
                        ) : null}
                      </div>
                      {g.recordedAt ? (
                        <span className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-100 px-2 py-1 text-[9px] font-black text-emerald-800">ثبت شد</span>
                      ) : st === 'OPEN' ? (
                        <Button size="sm" variant="default" className="shrink-0 rounded-lg bg-indigo-700 px-2.5 py-1.5 text-[9px] font-black hover:bg-indigo-800" disabled={busy} onClick={() => void record(g.sessionId)}>
                          ثبت حضور
                        </Button>
                      ) : st === 'BEFORE' ? (
                        <span className="shrink-0 text-[9px] font-bold text-slate-400">هنوز باز نشده</span>
                      ) : (
                        <span className="shrink-0 text-[9px] font-bold text-slate-400">گذشته</span>
                      )}
                    </div>
                  );
                })}
                <div className="pt-1 text-[9px] font-bold text-slate-400">
                  ثبت به نامِ استادِ هر جلسه انجام می‌شود و نام شما به‌عنوان ثبت‌کننده در سابقه می‌ماند.
                  کلاس‌های ادغامی با یک ثبت روی همهٔ عرضه‌ها اعمال می‌شوند.
                </div>
              </div>
            )}
          </details>,
        )
      ) : null}

      {/* Room weekly schedule */}
      {roomCard(
        <details open>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
            <span className="text-sm font-black text-slate-900">برنامهٔ هفتگی این اتاق</span>
            <span className="text-[10px] font-bold text-slate-500">{faDigits(weekly.length)} سانس در هفته</span>
          </summary>
          {weekly.length === 0 ? (
            <div className="mt-3 space-y-2">
              <RoomNotice kind="info" text="برای این اتاق در ترم جاری برنامه‌ای ثبت نشده است." />
              {state.twinRooms.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-black text-slate-700">این نام برای چند اتاق ثبت شده؛ این اتاق‌های هم‌نام برنامه دارند:</div>
                  {state.twinRooms.map((t) => (
                    <Link key={t.id} to={`/p/room-${t.id}`} className="flex items-center justify-between rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                      <span className="text-[11px] font-black text-indigo-900">اتاق {room ? faDigits(room.name) : ''} — رکورد #{faDigits(t.id)}</span>
                      <span className="text-[10px] font-bold text-indigo-700">{faDigits(t.slots)} سانس ←</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              {weekDays.map((d) => {
                const slots = byDay.get(d) ?? [];
                const isToday = d === todayDow;
                return (
                  <div key={d}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className={`text-[11px] font-black ${isToday ? 'text-indigo-800' : 'text-slate-700'}`}>{ROOM_DAY_NAMES[d]}</span>
                      {isToday ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[9px] font-black text-indigo-800">امروز</span> : null}
                      <span className="h-px flex-1 bg-slate-100" />
                    </div>
                    {slots.length === 0 ? (
                      <div className="py-1 text-[10px] font-bold text-slate-400">کلاسی نیست</div>
                    ) : (
                      <div className="space-y-1.5">
                        {slots.map((s) => {
                          const mine = isMySlot(s);
                          const slotKey = `${s.offeringId}|${s.startTime}`;
                          const rec = isToday ? state.todayBySlot[slotKey] : undefined;
                          const st = isToday ? checkinStateRoom(s.startTime, s.endTime, nowMin) : null;
                          const canRecord = (state.policy.professorAllowed && mine) || ctrlCan;
                          const recorded = mine ? !!rec?.recordedMine : !!rec?.recordedAny;
                          const recordSessionId = rec?.sessionId ?? 0;
                          return (
                            <div
                              key={s.scheduleId}
                              className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${
                                isToday && mine ? 'border-indigo-300 bg-indigo-50/60' : mine ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'
                              }`}
                            >
                              <div className="w-12 shrink-0 text-[10px] leading-4 font-bold text-slate-500" dir="ltr">
                                {faDigits(s.startTime)}
                                <br />
                                {faDigits(s.endTime)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[11px] font-black text-slate-800">{s.courseTitle}</div>
                                <div className="truncate text-[10px] font-bold text-slate-500">{s.professorName} · گروه {faDigits(s.groupNumber)}</div>
                              </div>
                              {isToday && canRecord ? (
                                recorded ? (
                                  <span className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-100 px-2 py-1 text-[9px] font-black text-emerald-800">ثبت شد</span>
                                ) : recordSessionId > 0 && st === 'OPEN' ? (
                                  <Button
                                    size="sm"
                                    variant="success"
                                    className="shrink-0 rounded-lg px-2.5 py-1.5 text-[9px] font-black"
                                    disabled={busy}
                                    onClick={() => void record(recordSessionId)}
                                  >
                                    ثبت حضور
                                  </Button>
                                ) : st === 'BEFORE' ? (
                                  <span className="shrink-0 text-[9px] font-bold text-slate-400">هنوز باز نشده</span>
                                ) : st === 'CLOSED' ? (
                                  <span className="shrink-0 text-[9px] font-bold text-slate-400">گذشته</span>
                                ) : (
                                  <span className="shrink-0 text-[9px] font-bold text-amber-700">جلسه ثبت نشده</span>
                                )
                              ) : mine ? (
                                <span className="shrink-0 text-[9px] font-bold text-slate-400">در روز جلسه</span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </details>,
      )}
    </>,
  );
}

import { Suspense } from 'react';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { course_offerings, courses, grade_change_log, process_definitions, student_requests, students, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getBool } from '@/lib/settings';
import { getCurrentUniversity } from '@/lib/university-scope';
import { groupedModules } from '@/lib/admin-modules';
import { ensureWorker, waitingRoomStats, warmupCapacities } from '@/lib/waitingRoom';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import RequestActionButtons from './RequestActionButtons';
import AdminMakeupRequestsCard from './AdminMakeupRequestsCard';
import PanelHero, { HeroStatsRow, HeroStatsSkeleton } from '@/components/PanelHero';

async function warmupAction() {
  'use server';
  const u = await requireRole(['ADMIN']);
  if (!u.roles.includes('ADMIN')) return;
  ensureWorker();
  await warmupCapacities(true); // §۱۰۰۶: انتقال ظرفیت‌ها از DB به Redis
  revalidatePath('/admin');
}

export const dynamic = 'force-dynamic';

const ALL_ADMIN_ROLES = [
  'ADMIN',
  'EDU_EXPERT',
  'ARCHIVE_EXPERT',
  'FINANCE_EXPERT',
  'FINANCE',
  'MILITARY_OFFICER',
  'VAULT_MANAGER',
  'DEP_HEAD',
  'VICE_EDU',
];

const stFa: Record<string, string> = {
  SUBMITTED: 'ثبت‌شده',
  IN_REVIEW: 'در بررسی',
  APPROVED: 'تاییدشده',
  REJECTED: 'ردشده',
  RETURNED: 'بازگشتی',
};

const stColor: Record<string, string> = {
  SUBMITTED: 'bg-amber-100 text-amber-800 border border-amber-300 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  IN_REVIEW: 'bg-sky-100 text-sky-800 border border-sky-300 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200',
  APPROVED: 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  REJECTED: 'bg-red-100 text-red-700 border border-red-300 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
  RETURNED: 'bg-purple-100 text-purple-800 border border-purple-300 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-200',
};

/** سرستون کارتابل: کلیک = nav با ?sort=col&dir=asc|desc (سورت سمت سرور) */
function InboxTh({
  label, col, sortKey, sortDir, href,
}: {
  label: string;
  col: string;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  href: (col: string) => string;
}) {
  const active = sortKey === col;
  return (
    <th className="p-2.5">
      <Link
        href={href(col)}
        title="مرتب‌سازی"
        className={`font-bold hover:text-indigo-700 whitespace-nowrap ${active ? 'text-indigo-700' : ''}`}
      >
        {label}{' '}
        <span className="inline-block w-4 text-center">
          {active ? (sortDir === 'asc' ? '▲' : '▼') : <span className="opacity-30">↕</span>}
        </span>
      </Link>
    </th>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   اسکلتون‌های استریم — هم‌اندازه با محتوای واقعی تا هنگام پر شدنِ کارت‌ها
   چیدمان نپرد (بدون CLS).
   ───────────────────────────────────────────────────────────────────────────── */
function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="card">
      <div className="h-4 w-48 animate-pulse rounded bg-slate-200" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="mt-2 h-3 w-full animate-pulse rounded bg-slate-100" />
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="card !p-0">
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="h-4 w-64 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-3 w-40 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 w-full animate-pulse rounded bg-slate-100" />
        ))}
      </div>
    </div>
  );
}

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireRole(ALL_ADMIN_ROLES);
  const isEdu = user.roles.includes('ADMIN') || user.roles.includes('EDU_EXPERT');
  const { getUserPermissionCodes } = await import('@/lib/permissions-enforcer');
  const permissionCodes = await getUserPermissionCodes(user.id).catch(() => []);
  const groups = groupedModules(user.roles, permissionCodes);
  const moduleCount = groups.reduce((s, g) => s + g.modules.length, 0);

  // ── مرتب‌سازی ستونی کارتابل از URL (?sort=col&dir=asc|desc — پیش‌فرض: جدیدترین) ──
  const SORTABLE: Record<string, 'track' | 'name' | 'status' | 'created' | 'proc'> = {
    track: 'track', name: 'name', status: 'status', created: 'created', proc: 'proc',
  };
  const sortKey = SORTABLE[(sp.sort || '').trim()] ?? null;
  const sortDir: 'asc' | 'desc' = sp.dir === 'desc' ? 'desc' : 'asc';
  const sortHref = (col: string) => {
    if (sortKey !== col) return `/admin?sort=${col}&dir=asc`;
    if (sortDir === 'asc') return `/admin?sort=${col}&dir=desc`;
    return '/admin';
  };

  /* ⚡ معماریِ این صفحه — «رندرِ تدریجی» (Streaming):
     پیش‌تر همهٔ کوئری‌ها (آمار، کارتابل، نمراتِ زنده، Redis، کلاس جبرانی) با
     `await` پشتِ هم اجرا می‌شدند و تا پایانِ آخرین کوئری **هیچ چیز** رندر
     نمی‌شد؛ کاربر فقط اسکلتون می‌دید و صفحه «به‌شدت کند» حس می‌شد.
     حالا فقط بخشِ سبک (ویترین + کاشی‌های دسته) قبل از اولین flush محاسبه
     می‌شود و هر کارتِ سنگین داخل `<Suspense>` جدا استریم می‌شود: صفحه بلافاصله
     می‌آید و کارت‌ها یکی‌یکی پر می‌شوند. */
  return (
    <div className="space-y-5">
      {/* ═══ ویترینِ صفحهٔ اول ═══ */}
      <PanelHero
        tone="indigo"
        icon="🧭"
        eyebrow="کارتابل مدیریت"
        title="داشبورد مدیریت جامع"
        subtitle={`${moduleCount.toLocaleString('fa-IR')} ماژول در دسترسِ نقش شما — برای ورود به هر حوزه، دستهٔ مربوط را انتخاب کنید.`}
        statsSlot={
          isEdu ? (
            <Suspense fallback={<HeroStatsSkeleton count={5} />}>
              <HeroStatsSection />
            </Suspense>
          ) : undefined
        }
      />

      {/* ═══ دسته‌های کلی — کلیک = صفحهٔ کاشی‌های همان دسته ═══ */}
      <section>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
          {groups.map(g => (
            <Link
              key={g.group.key}
              href={`/admin/c/${g.group.key}`}
              className="group relative flex h-full items-start gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg sm:p-4"
            >
              {/* نوارِ رنگیِ بالای کارت — فقط در hover ظاهر می‌شود؛ نشانهٔ «قابل کلیک» */}
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-0.5 origin-right scale-x-0 bg-gradient-to-l from-indigo-500 via-violet-500 to-fuchsia-500 transition-transform duration-200 group-hover:scale-x-100"
              />
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm transition-transform group-hover:scale-105 [&>svg]:h-5 [&>svg]:w-5">
                {g.group.icon}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[12px] font-extrabold leading-tight text-slate-800 sm:text-sm">{g.group.title}</h3>
                {/* توضیح دسته فقط از sm به بالا — در موبایل کارت را بی‌دلیل بلند می‌کرد */}
                <p className="mt-1 hidden text-2xs leading-5 text-slate-500 sm:block">{g.group.desc}</p>
                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-3xs font-black text-indigo-700">
                  {g.modules.length.toLocaleString('fa-IR')} ماژول
                  <span aria-hidden className="transition-transform group-hover:-translate-x-0.5">←</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {isEdu && (
        <>
          {/* کارتابل درخواست‌های کلاس جبرانی اساتید (کوئریِ سنگین — مستقل استریم می‌شود) */}
          <Suspense fallback={<CardSkeleton lines={3} />}>
            <AdminMakeupRequestsCard />
          </Suspense>

          {/* 🔴 فعالیت زندهٔ نمرات — چه کسی هم‌اکنون/اخیراً نمره تغییر داده است */}
          <Suspense fallback={null}>
            <GradeLiveSection roles={user.roles} />
          </Suspense>

          {/* وضعیت موتور صف Redis */}
          <Suspense fallback={<CardSkeleton lines={1} />}>
            <RedisSection />
          </Suspense>

          {/* جدول کارتابل گردش کار و اقدامات دانشجویی */}
          <Suspense fallback={<TableSkeleton />}>
            <InboxSection sortKey={sortKey} sortDir={sortDir} sortHref={sortHref} />
          </Suspense>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   بخش‌های استریم‌شده — هر کدام مستقل، تا کندیِ یکی بقیه را معطل نکند.
   ───────────────────────────────────────────────────────────────────────────── */

/** آمارِ درخواست‌ها — داخل ویترین، با اسکلتونِ هم‌اندازه. */
async function HeroStatsSection() {
  const uniId = (await getCurrentUniversity()).id;
  const uniScope = or(eq(student_requests.universityId, uniId), isNull(student_requests.universityId));
  const counts = await db
    .select({ status: student_requests.status, n: sql<number>`count(*)::int` })
    .from(student_requests)
    .where(uniScope)
    .groupBy(student_requests.status)
    .catch(() => [] as { status: string; n: number }[]);
  const total = counts.reduce((s, c) => s + c.n, 0);

  return (
    <HeroStatsRow
      stats={[
        { label: 'کل درخواست‌ها', value: total.toLocaleString('fa-IR'), tone: 'text-indigo-700', title: 'همهٔ درخواست‌های ثبت‌شدهٔ این دانشگاه' },
        ...(['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'] as const).map(k => ({
          label: stFa[k],
          value: (counts.find(c => c.status === k)?.n ?? 0).toLocaleString('fa-IR'),
          title: `درخواست‌های ${stFa[k]}`,
        })),
      ]}
    />
  );
}

/** فعالیت زندهٔ نمرات — اگر از تنظیمات خاموش باشد یا نقش اجازه نداشته باشد، هیچ چیز رندر نمی‌شود. */
async function GradeLiveSection({ roles }: { roles: string[] }) {
  const canSee = roles.some(r => ['ADMIN', 'EDU_EXPERT', 'VICE_EDU'].includes(r));
  if (!canSee) return null;
  const show = await getBool('GRADE_EDIT_NOTIFY_BOARD').catch(() => true);
  if (!show) return null;

  const uniId = (await getCurrentUniversity()).id;
  const rows = await db
    .select({
      actorFirst: users.firstName,
      actorLast: users.lastName,
      actorRole: grade_change_log.actorRole,
      studentCode: students.studentCode,
      courseTitle: courses.title,
      courseCode: courses.code,
      grade: grade_change_log.newGradeValue,
      at: grade_change_log.createdAt,
    })
    .from(grade_change_log)
    .leftJoin(users, eq(users.id, grade_change_log.actorUserId))
    .leftJoin(students, eq(students.id, grade_change_log.studentId))
    .leftJoin(course_offerings, eq(course_offerings.id, grade_change_log.offeringId))
    .leftJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(
      sql`${grade_change_log.createdAt} > now() - interval '30 minutes'`,
      or(eq(students.universityId, uniId), isNull(students.universityId)),
    ))
    .orderBy(desc(grade_change_log.id))
    .limit(10)
    .catch(() => []);

  const gradeLive = rows.map(r => ({
    actor: `${r.actorFirst || ''} ${r.actorLast || ''}`.trim() || '—',
    role: r.actorRole,
    studentCode: r.studentCode || '—',
    course: r.courseTitle || r.courseCode || '—',
    grade: r.grade,
    at: r.at,
  }));

  return (
    <div className="card border-red-300">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <h2 className="text-sm font-extrabold text-slate-900">🔴 فعالیت زندهٔ نمرات</h2>
        <span className="ui-chip !border-red-200 !bg-red-50 !text-red-700 dark:!border-red-900 dark:!bg-red-950 dark:!text-red-200">
          {gradeLive.length} تغییر در ۳۰ دقیقهٔ اخیر
        </span>
      </div>
      {gradeLive.length === 0 ? (
        <p className="text-xs text-slate-400">در ۳۰ دقیقهٔ اخیر تغییری در نمرات ثبت نشده است.</p>
      ) : (
        <ul className="text-xs space-y-1.5">
          {gradeLive.map((g, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-2 border-b border-slate-100 pb-1.5">
              <b>{g.actor}</b>
              {g.role && <span className="text-slate-500">({g.role})</span>}
              <span>دانشجو <span className="font-mono" dir="ltr">{g.studentCode}</span></span>
              <span className="text-slate-600">{g.course}</span>
              <span>→ <b className="font-mono">{g.grade ?? '—'}</b></span>
              <span className="text-slate-400 mr-auto">
                {g.at ? new Date(g.at).toLocaleString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** وضعیت موتور صف Redis — با محافظِ زمانی در `waitingRoomStats` تا Redisِ خاموش صفحه را نخواباند. */
async function RedisSection() {
  ensureWorker();
  const wr = await waitingRoomStats();
  return (
    <div className={'card flex flex-wrap items-center justify-between gap-3 ' + (wr.up ? 'border-emerald-300' : 'border-red-300')}>
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden
          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${wr.up ? 'bg-emerald-500' : 'bg-red-500'}`}
          style={wr.up ? { boxShadow: '0 0 0 4px rgba(16,185,129,.15)' } : { boxShadow: '0 0 0 4px rgba(239,68,68,.15)' }}
        />
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-slate-900">اتاق انتظار Redis (§۶۹۰۶)</h2>
          <p className="mt-0.5 text-2xs font-bold text-slate-500">
            {wr.up
              ? `فعال — ${wr.warmedOfferings} کلاس گرم‌شده · صف ثبت نهایی: ${wr.queueLength} درخواست`
              : 'Redis در دسترس نیست — موتور به شمارش SQL برمی‌گردد (حالت تداوم)'}
          </p>
        </div>
      </div>
      <form action={warmupAction}>
        <button className="btn-primary !py-1.5 text-xs">گرم‌کردن مجدد ظرفیت‌ها (شب قبل §۱۰۰۶)</button>
      </form>
    </div>
  );
}

/** کارتابلِ رسیدگی — سنگین‌ترین بخش (۳ join + سورتِ سمت سرور). */
async function InboxSection({
  sortKey,
  sortDir,
  sortHref,
}: {
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  sortHref: (col: string) => string;
}) {
  const uniId = (await getCurrentUniversity()).id;
  const uniScope = or(eq(student_requests.universityId, uniId), isNull(student_requests.universityId));

  const orderBy = !sortKey
    ? [desc(student_requests.id)]
    : sortKey === 'track'
      ? (sortDir === 'asc' ? [student_requests.trackingCode] : [desc(student_requests.trackingCode)])
      : sortKey === 'name'
        ? (sortDir === 'asc' ? [users.lastName, users.firstName] : [desc(users.lastName), desc(users.firstName)])
        : sortKey === 'status'
          ? (sortDir === 'asc' ? [student_requests.status] : [desc(student_requests.status)])
          : sortKey === 'created'
            ? (sortDir === 'asc' ? [student_requests.createdAt] : [desc(student_requests.createdAt)])
            : (sortDir === 'asc' ? [process_definitions.title] : [desc(process_definitions.title)]);

  const inbox = await db
    .select({
      id: student_requests.id,
      track: student_requests.trackingCode,
      status: student_requests.status,
      created: student_requests.createdAt,
      formData: student_requests.formData,
      name: users.firstName,
      family: users.lastName,
      code: students.studentCode,
      procTitle: process_definitions.title,
    })
    .from(student_requests)
    .innerJoin(students, eq(students.id, student_requests.studentId))
    .innerJoin(users, eq(users.id, students.userId))
    .leftJoin(process_definitions, eq(process_definitions.id, student_requests.processId))
    .where(uniScope)
    .orderBy(...(orderBy as never[]))
    .limit(20)
    .catch(() => [] as any[]);

  return (
    <div className="card !p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-slate-900">کارتابل رسیدگی به درخواست‌های دانشجویی</h2>
          <p className="mt-0.5 text-2xs font-bold text-slate-500">شورای آموزشی · {inbox.length} پروندهٔ اخیر</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-right text-sm rt">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-200">
              <InboxTh label="کد رهگیری" col="track" sortKey={sortKey} sortDir={sortDir} href={sortHref} />
              <InboxTh label="دانشجو" col="name" sortKey={sortKey} sortDir={sortDir} href={sortHref} />
              <InboxTh label="موضوع / درس" col="proc" sortKey={sortKey} sortDir={sortDir} href={sortHref} />
              <InboxTh label="وضعیت" col="status" sortKey={sortKey} sortDir={sortDir} href={sortHref} />
              <InboxTh label="زمان" col="created" sortKey={sortKey} sortDir={sortDir} href={sortHref} />
              <th className="p-2.5 text-left">اقدام شورا</th>
            </tr>
          </thead>
          <tbody>
            {inbox.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <p className="text-2xl" aria-hidden>🗂️</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">درخواستی در کارتابل موجود نیست.</p>
                  <p className="mt-0.5 text-3xs font-bold text-slate-400">درخواست‌های تازه پس از ثبت دانشجو همین‌جا دیده می‌شوند.</p>
                </td>
              </tr>
            )}
            {inbox.map(r => {
              let extra: any = {};
              try {
                if (r.formData) extra = JSON.parse(r.formData);
              } catch (_) {}

              return (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/70 transition-colors">
                  <td className="p-2.5 font-mono text-xs font-bold text-slate-700" dir="ltr">
                    {r.track}
                  </td>
                  <td className="p-2.5">
                    <p className="font-semibold text-slate-800">{r.name} {r.family}</p>
                    <p className="text-2xs font-mono text-slate-400" dir="ltr">{r.code}</p>
                  </td>
                  <td className="p-2.5">
                    <p className="text-xs font-medium text-slate-700">
                      {extra.offeringTitle ? `اخذ درس ${extra.offeringTitle}` : (r.procTitle || 'کمیسیون موارد خاص')}
                    </p>
                    {extra.reasons && (
                      <p className="text-3xs text-amber-700 mt-0.5 truncate max-w-[200px]" title={extra.reasons.join('، ')}>
                        {extra.reasons.join('، ')}
                      </p>
                    )}
                  </td>
                  <td className="p-2.5">
                    <span className={'inline-block text-2xs px-2 py-0.5 rounded-full font-medium ' + (stColor[r.status] ?? '')}>
                      {stFa[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="p-2.5 text-xs text-slate-500">
                    {r.created ? new Date(r.created).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                  <td className="p-2.5 text-left">
                    <RequestActionButtons requestId={r.id} status={r.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

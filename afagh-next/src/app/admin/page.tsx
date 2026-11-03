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

  let total = 0;
  let counts: { status: string; n: number }[] = [];
  let inbox: any[] = [];
  let wr: Awaited<ReturnType<typeof waitingRoomStats>> | null = null;
  // 🔴 فعالیت زندهٔ نمرات (۳۰ دقیقهٔ اخیر) — قابل خاموش/روشن از تنظیمات مدیر
  let gradeLive: { actor: string; role: string | null; studentCode: string; course: string; grade: string | null; at: Date | null }[] = [];
  let showGradeLive = false;

  if (isEdu) {
    ensureWorker();
    wr = await waitingRoomStats();
    // دانشگاه فعال — فقط درخواست‌های همین دانشگاه + رکوردهای سراسری (universityId=null)
    const uniId = (await getCurrentUniversity()).id;
    const uniScope = or(eq(student_requests.universityId, uniId), isNull(student_requests.universityId));
    counts = await db
      .select({ status: student_requests.status, n: sql<number>`count(*)::int` })
      .from(student_requests)
      .where(uniScope)
      .groupBy(student_requests.status);
    total = counts.reduce((s, c) => s + c.n, 0);

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

    inbox = await db
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
      .limit(20);

    showGradeLive = (user.roles.includes('ADMIN') || user.roles.includes('EDU_EXPERT') || user.roles.includes('VICE_EDU'))
      && await getBool('GRADE_EDIT_NOTIFY_BOARD').catch(() => true);
    if (showGradeLive) {
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
      gradeLive = rows.map(r => ({
        actor: `${r.actorFirst || ''} ${r.actorLast || ''}`.trim() || '—',
        role: r.actorRole,
        studentCode: r.studentCode || '—',
        course: r.courseTitle || r.courseCode || '—',
        grade: r.grade,
        at: r.at,
      }));
    }
  }

  return (
    <div className="space-y-5">
      {/* ═══ دسته‌های کلی — کلیک = صفحهٔ کاشی‌های همان دسته ═══ */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-extrabold text-slate-800 text-base sm:text-lg">دسته‌بندی سامانه</h1>
          <span className="text-xs text-slate-500">{groups.reduce((s, g) => s + g.modules.length, 0)} ماژول در دسترس نقش شما</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
          {groups.map(g => (
            <Link
              key={g.group.key}
              href={`/admin/c/${g.group.key}`}
              className="group h-full p-3 sm:p-4 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all flex items-start gap-2.5 sm:gap-3"
            >
              <div className="w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-xl sm:text-2xl group-hover:scale-110 transition-transform">
                {g.group.icon}
              </div>
              <div className="min-w-0">
                <h3 className="font-extrabold text-[12px] sm:text-sm leading-tight text-slate-800">{g.group.title}</h3>
                {/* توضیح دسته فقط از sm به بالا — در موبایل کارت را بی‌دلیل بلند می‌کرد */}
                <p className="hidden sm:block text-2xs text-slate-500 mt-1 leading-5">{g.group.desc}</p>
                <p className="text-3xs text-indigo-600 mt-1 font-bold">{g.modules.length} ماژول ←</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {isEdu && (
        <>
          {/* کارت‌های خلاصه وضعیت کل سیستم */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="card text-center">
              <p className="text-2xl font-bold text-indigo-700">{total}</p>
              <p className="text-xs text-slate-500">کل درخواست‌ها</p>
            </div>
            {['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'].map(k => {
              const n = counts.find(c => c.status === k)?.n ?? 0;
              return (
                <div key={k} className="card text-center">
                  <p className="text-2xl font-bold text-slate-700">{n}</p>
                  <p className="text-xs text-slate-500">{stFa[k]}</p>
                </div>
              );
            })}
          </div>

          {/* کارتابل درخواست‌های کلاس جبرانی اساتید */}
          <AdminMakeupRequestsCard />

          {/* 🔴 فعالیت زندهٔ نمرات — چه کسی هم‌اکنون/اخیراً نمره تغییر داده است */}
          {showGradeLive && (
            <div className="card border-red-300">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-bold text-slate-800">🔴 فعالیت زندهٔ نمرات (۳۰ دقیقهٔ اخیر)</h2>
                <span className="text-xs text-slate-500">{gradeLive.length} تغییر</span>
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
          )}

          {/* وضعیت موتور صف Redis */}
          {wr && (
            <div className={'card flex flex-wrap items-center justify-between gap-3 ' + (wr.up ? 'border-emerald-300' : 'border-red-300')}>
              <div>
                <h2 className="font-bold">اتاق انتظار Redis (§۶۹۰۶)</h2>
                <p className="text-xs text-slate-500">
                  {wr.up
                    ? 'فعال — ' + wr.warmedOfferings + ' کلاس گرم‌شده · صف ثبت نهایی: ' + wr.queueLength + ' درخواست'
                    : 'Redis در دسترس نیست — موتور به شمارش SQL برمی‌گردد (حالت تداوم)'}
                </p>
              </div>
              <form action={warmupAction}>
                <button className="btn-primary !py-1.5 text-xs">گرم‌کردن مجدد ظرفیت‌ها (شب قبل §۱۰۰۶)</button>
              </form>
            </div>
          )}

          {/* جدول کارتابل گردش کار و اقدامات دانشجویی */}
          <div className="card">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
              <h2 className="font-bold text-slate-800">کارتابل رسیدگی به درخواست‌های دانشجویی (شورای آموزشی)</h2>
              <span className="text-xs text-slate-500">{inbox.length} پرونده اخیر</span>
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
                      <td colSpan={6} className="p-6 text-center text-slate-400">
                        درخواستی در کارتابل موجود نیست.
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
        </>
      )}
    </div>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import HelpSearch from '@/components/help/HelpSearch';
import { HelpTopBar } from '@/components/help/HelpNav';
import { allRoleGuides, buildHelpIndex, defaultGuideForRoles, isHelpRoleKey, visibleGuides } from './content/index';

export const metadata = { title: 'مرکز راهنمای سامانه آفاق' };

const GUIDE_CARD: Record<string, string> = {
  student: 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/60',
  professor: 'border-indigo-300 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/60',
  'group-manager': 'border-teal-300 bg-teal-50/60 dark:border-teal-800 dark:bg-teal-950/60',
  admin: 'border-slate-400 bg-slate-100/70 dark:border-slate-600 dark:bg-slate-800/70',
  shared: 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/60',
};

export default async function HelpLandingPage(props: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getSessionUser().catch(() => null);
  // مهمان (مثلاً از دکمه راهنمای صفحه ورود) مستقیم به راهنمای عمومی می‌رود
  if (!user) redirect('/help/shared');
  const sp = await props.searchParams;
  if (sp.tab && isHelpRoleKey(sp.tab)) redirect(`/help/${sp.tab}`);

  const roles = user.roles ?? [];
  const guides = visibleGuides(roles);
  const def = defaultGuideForRoles(roles);
  const index = buildHelpIndex(guides);
  const quick = guides.flatMap(g => g.quickTasks.map(q => ({ ...q, guideIcon: g.icon, guideTitle: g.title }))).slice(0, 8);

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-slate-900 sm:p-8" dir="rtl">
      <div className="mx-auto max-w-5xl space-y-6">
        <HelpTopBar role={def} title="مرکز راهنمای سامانه آفاق" />
        <div className="flex flex-col gap-4 rounded-3xl border border-indigo-700/50 bg-gradient-to-l from-indigo-950 via-slate-900 to-indigo-900 p-6 text-white shadow-xl sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-slate-950">مرکز راهنمای سامانه دانشگاهی آفاق</span>
            <h1 className="mt-2 text-xl font-black sm:text-3xl">📖 راهنمای قدم‌به‌قدم، مخصوص نقش شما</h1>
            <p className="mt-1 text-xs text-indigo-200 sm:text-sm">واردشده به‌نام {user.name} · نقش پیشنهادی شما: {allRoleGuides().find(g => g.role === def)?.title}</p>
          </div>
          <HelpSearch index={index} />
        </div>

        <section aria-label="انتخاب نقش">
          <h2 className="mb-2 text-sm font-black text-slate-700">نقش خودتان را انتخاب کنید</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {guides.map(g => (
              <Link prefetch={false} key={g.role} href={`/help/${g.role}`} className={`block rounded-2xl border-2 p-4 shadow-sm transition hover:shadow ${GUIDE_CARD[g.role] ?? 'border-slate-300 bg-white'}`}>
                <div className="text-2xl">{g.icon}</div>
                <h3 className="mt-1 text-sm font-black text-slate-900">{g.title}</h3>
                <p className="mt-0.5 text-2xs text-slate-600">{g.audience}</p>
              </Link>
            ))}
          </div>
        </section>

        <section aria-label="کارهای پرتکرار" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-sm font-black text-slate-800">⚡ کارهای پرتکرار</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {quick.map(q => (
              <Link prefetch={false} key={`${q.role}:${q.topicSlug ?? q.href}`} href={`/help/${q.role}/${q.topicSlug ?? ''}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5 hover:border-indigo-300 hover:bg-indigo-50/50">
                <span>
                  <span className="block text-[13px] font-bold text-slate-800">{q.guideIcon} {q.title}</span>
                  <span className="block text-2xs text-slate-500">{q.hint} · {q.guideTitle}</span>
                </span>
                <span className="shrink-0 text-slate-300">←</span>
              </Link>
            ))}
          </div>
        </section>

        <section aria-label="فهرست موضوعات" className="space-y-4">
          {guides.map(g => (
            <div key={g.role} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-black text-slate-900">{g.icon} {g.title}</h2>
                <Link prefetch={false} href={`/help/${g.role}`} className="rounded-xl bg-slate-800 px-3 py-1.5 text-2xs font-bold text-white hover:bg-slate-700">ورود به راهنما ←</Link>
              </div>
              {g.sections.map(s => (
                <div key={s.key} className="mt-3">
                  <h3 className="text-xs font-black text-slate-600">{s.icon} {s.title}</h3>
                  <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    {s.topics.map(t => (
                      <li key={t.slug}>
                        <Link prefetch={false} href={`/help/${g.role}/${t.slug}`} className="block rounded-xl border border-slate-100 px-3 py-2 text-[13px] font-bold text-indigo-800 hover:border-indigo-300 hover:bg-indigo-50/50">
                          {t.title}
                          <span className="block text-2xs font-normal text-slate-500">{t.summary.slice(0, 70)}…</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </section>

        <p className="pb-4 text-center text-2xs text-slate-500">تعداد موضوعات نمایه‌شده: {index.length.toLocaleString('fa-IR')} · برای نسخهٔ چاپی هر نقش، وارد همان نقش شوید.</p>
      </div>
    </div>
  );
}

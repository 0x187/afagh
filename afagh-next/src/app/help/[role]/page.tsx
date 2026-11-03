import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import HelpSearch from '@/components/help/HelpSearch';
import { HelpBreadcrumbs, HelpTopBar } from '@/components/help/HelpNav';
import { buildHelpIndex, canViewGuide, getRoleGuide, isHelpRoleKey } from '../content/index';

export async function generateMetadata(props: { params: Promise<{ role: string }> }) {
  const { role } = await props.params;
  if (!isHelpRoleKey(role)) return { title: 'راهنما' };
  const g = getRoleGuide(role);
  return { title: `${g.title} — مرکز راهنما` };
}

export default async function HelpRolePage(props: { params: Promise<{ role: string }> }) {
  const { role } = await props.params;
  if (!isHelpRoleKey(role)) notFound();
  // راهنمای عمومی (ورود/گذرواژه/جابه‌جایی حساب) باید بدون ورود هم باز شود —
  // وگرنه دکمه «راهنمای ورود» در صفحه لاگین به خودش برمی‌گردد.
  const user = await getSessionUser().catch(() => null);
  if (!user && role !== 'shared') redirect('/login');
  if (!canViewGuide(user?.roles ?? [], role)) notFound();
  const g = getRoleGuide(role);
  const index = buildHelpIndex([g]);

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-slate-900 sm:p-8" dir="rtl">
      <div className="mx-auto max-w-4xl space-y-5">
        <HelpTopBar role={g.role} title={g.title} />
        <HelpBreadcrumbs trail={[{ label: 'مرکز راهنما', href: '/help' }, { label: g.title }]} />
        <div className="rounded-3xl bg-slate-900 p-6 text-white shadow-xl sm:p-8">
          <div className="text-3xl">{g.icon}</div>
          <h1 className="mt-1 text-xl font-black sm:text-2xl">{g.title}</h1>
          <p className="mt-1 text-xs text-slate-300 sm:text-sm">مخاطب: {g.audience}</p>
          {g.landing.map((p, i) => (
            <p key={i} className="mt-2 text-xs leading-relaxed text-slate-200 sm:text-sm">{p}</p>
          ))}
          <div className="mt-4">
            <HelpSearch index={index} role={g.role} placeholder={`جست‌وجو در ${g.title}… ( / یا Ctrl+K)`} id={`help-search-${g.role}`} />
          </div>
        </div>

        <section aria-label="کارهای پرتکرار" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black">⚡ کارهای پرتکرار</h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {g.quickTasks.map(q => (
              <Link key={q.topicSlug ?? q.href} href={`/help/${q.role}/${q.topicSlug}`} className="rounded-xl border border-slate-200 px-3 py-2.5 hover:border-indigo-300 hover:bg-indigo-50/50">
                <span className="block text-[13px] font-bold text-slate-800">{q.title}</span>
                <span className="block text-2xs text-slate-500">{q.hint}</span>
              </Link>
            ))}
          </div>
        </section>

        {g.sections.map(s => (
          <section key={s.key} aria-label={s.title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-black text-slate-900">{s.icon} {s.title}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{s.blurb}</p>
            <ul className="mt-3 space-y-2">
              {s.topics.map(t => (
                <li key={t.slug}>
                  <Link href={`/help/${g.role}/${t.slug}`} className="block rounded-xl border border-slate-100 p-3 hover:border-indigo-300 hover:bg-indigo-50/40">
                    <span className="block text-[13px] font-black text-indigo-800">{t.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">{t.summary}</span>
                    <span className="mt-1 block text-2xs text-slate-400">{t.path} · {t.steps.length.toLocaleString('fa-IR')} مرحله</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <Link href="/help" className="block rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center text-xs font-black text-slate-600 hover:border-slate-400">بازگشت به فهرست</Link>
      </div>
    </div>
  );
}

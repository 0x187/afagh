import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import HelpScreenshot from '@/components/help/HelpScreenshot';
import { HelpBreadcrumbs, HelpPrevNext, HelpTopBar } from '@/components/help/HelpNav';
import { canViewGuide, findTopic, getRoleGuide, isHelpRoleKey, topicPrevNext } from '../../content/index';

export async function generateMetadata(props: { params: Promise<{ role: string; slug: string }> }) {
  const { role, slug } = await props.params;
  if (!isHelpRoleKey(role)) return { title: 'راهنما' };
  const found = findTopic(role, slug);
  const g = getRoleGuide(role);
  return { title: found ? `${found.topic.title} — ${g.title}` : g.title };
}

const NOTE_STYLE: Record<string, string> = {
  info: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200',
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  danger: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200',
};

export default async function HelpTopicPage(props: { params: Promise<{ role: string; slug: string }> }) {
  const { role, slug } = await props.params;
  if (!isHelpRoleKey(role)) notFound();
  // موضوع‌های عمومی بدون ورود هم باز می‌شوند (لینک راهنما در صفحه لاگین).
  const user = await getSessionUser().catch(() => null);
  if (!user && role !== 'shared') redirect('/login');
  if (!canViewGuide(user?.roles ?? [], role)) notFound();
  const found = findTopic(role, slug);
  if (!found) notFound();
  const g = getRoleGuide(role);
  const { topic: t, sectionTitle } = found;
  const { prev, next } = topicPrevNext(role, slug);

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-slate-900 sm:p-8" dir="rtl">
      <article className="mx-auto max-w-3xl space-y-5">
        <HelpTopBar role={g.role} title={t.title} />
        <HelpBreadcrumbs trail={[{ label: 'مرکز راهنما', href: '/help' }, { label: g.title, href: `/help/${g.role}` }, { label: t.title }]} />

        <header className="rounded-3xl bg-slate-900 p-6 text-white shadow-xl sm:p-8">
          <p className="text-2xs text-slate-300">{g.icon} {g.title} · {sectionTitle}</p>
          <h1 className="mt-1 text-xl font-black sm:text-2xl">{t.title}</h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-200 sm:text-sm">{t.summary}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href={t.path} className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400">ورود به صفحه ←</Link>
            <span className="rounded-xl bg-white/10 px-3 py-2 font-mono text-2xs text-slate-200" dir="ltr">{t.path}</span>
          </div>
          <p className="mt-3 text-2xs text-slate-400">آخرین به‌روزرسانی: {t.updated}</p>
        </header>

        <section aria-label="در این صفحه چه می‌بینید" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-sm font-black text-slate-900">👁️ در این صفحه چه می‌بینید</h2>
          {t.intro.map((p, i) => (
            <p key={i} className="mt-2 text-[13px] leading-loose text-slate-700">{p}</p>
          ))}
        </section>

        <section aria-label="مراحل انجام کار" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-sm font-black text-slate-900">🧭 مراحل انجام کار</h2>
          <ol className="mt-3 space-y-4">
            {t.steps.map((s, i) => (
              <li key={i} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <h3 className="text-[13px] font-black text-indigo-900">
                  <span className="ml-1.5 inline-flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-700 text-2xs font-black text-white">{(i + 1).toLocaleString('fa-IR')}</span>
                  {s.title}
                </h3>
                {s.body.map((b, j) => (
                  <p key={j} className="mt-1.5 pr-8 text-xs leading-loose text-slate-700">{b}</p>
                ))}
              </li>
            ))}
          </ol>
        </section>

        {t.tables?.map((tb, i) => (
          <section key={i} aria-label={tb.caption ?? 'جدول راهنما'} className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            {tb.caption && <h2 className="mb-2 text-sm font-black text-slate-900">📊 {tb.caption}</h2>}
            <table className="w-full min-w-96 border-collapse text-xs rt">
              <thead>
                <tr className="bg-slate-100">
                  {tb.head.map((h, j) => (
                    <th key={j} className="border border-slate-200 px-2 py-1.5 text-right font-black text-slate-700">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tb.rows.map((r, j) => (
                  <tr key={j} className="odd:bg-white even:bg-slate-50/60">
                    {r.map((c, k) => (
                      <td key={k} className="border border-slate-200 px-2 py-1.5 leading-relaxed text-slate-700">{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        {t.notes?.map((n, i) => (
          <div key={i} className={`rounded-2xl border p-4 text-xs leading-loose shadow-sm ${NOTE_STYLE[n.tone] ?? NOTE_STYLE.info}`}>
            <p className="font-black">{n.title}</p>
            <p className="mt-1">{n.body}</p>
          </div>
        ))}

        {(t.shots ?? []).length > 0 && (
          <section aria-label="تصاویر راهنما" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="text-sm font-black text-slate-900">🖼️ تصاویر راهنما</h2>
            {(t.shots ?? []).map(sh => (
              <HelpScreenshot key={sh.n} role={g.role} slug={t.slug} n={sh.n} caption={sh.caption} alt={sh.alt} />
            ))}
          </section>
        )}

        <section aria-label="اگر مشکل داشتید" className="rounded-2xl border border-amber-300 bg-amber-50/60 p-4 shadow-sm sm:p-6 dark:border-amber-800 dark:bg-amber-950/60">
          <h2 className="text-sm font-black text-amber-900 dark:text-amber-200">🛟 اگر مشکل داشتید</h2>
          <ul className="mt-2 space-y-1.5">
            {t.troubleshooting.map((x, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-loose text-amber-950 dark:text-amber-200">
                <span aria-hidden="true" className="mt-0.5 shrink-0">•</span>
                <span>{x}</span>
              </li>
            ))}
          </ul>
        </section>

        {(t.related ?? []).length > 0 && (
          <section aria-label="پیوندهای مرتبط" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="text-sm font-black text-slate-900">🔗 صفحات مرتبط</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {(t.related ?? []).map(r => (
                <Link key={r.href} href={r.href} className="rounded-xl bg-indigo-700 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-600" title={r.note}>{r.title} ←</Link>
              ))}
            </div>
          </section>
        )}

        <HelpPrevNext prev={prev} next={next} listHref={`/help/${g.role}`} listLabel="بازگشت به فهرست" />
      </article>
    </div>
  );
}

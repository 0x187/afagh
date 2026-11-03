import Link from 'next/link';

export type Crumb = { label: string; href?: string };

/** خانهٔ کارتابل هر نقش — مقصد دکمهٔ «بازگشت به کارتابل» در صفحات راهنما */
export const HELP_PANEL_HOME: Record<string, { href: string; label: string }> = {
  student: { href: '/student', label: 'کارتابل دانشجو' },
  professor: { href: '/professor', label: 'کارتابل استاد' },
  'group-manager': { href: '/group-manager', label: 'کارتابل مدیر گروه' },
  admin: { href: '/admin', label: 'کارتابل مدیر' },
};

/**
 * نوار بالای صفحات راهنما.
 *
 * مشکل: صفحات /help هدر سامانه را ندارند (عمداً سبک‌اند و بدون ورود هم برای
 * نقش shared باز می‌شوند)، پس کاربرِ آمده از کارتابل هیچ راه برگشتی به
 * پنل خودش نداشت — فقط لینک‌های داخلی راهنما. این نوار در هر سه صفحهٔ
 * راهنما (فهرست، نقش، موضوع) همان بالا می‌نشیند.
 */
export function HelpTopBar({ role, title }: { role?: string; title?: string }) {
  const home = role ? HELP_PANEL_HOME[role] : undefined;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
      <span className="flex items-center gap-2 text-xs font-black text-slate-700">
        <span aria-hidden="true" className="text-base">📖</span>
        {title ?? 'مرکز راهنما'}
      </span>
      <span className="flex items-center gap-2">
        <Link
          href="/help"
          className="rounded-xl border border-slate-200 px-3 py-1.5 text-2xs font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
        >
          مرکز راهنما
        </Link>
        {home && (
          <Link
            href={home.href}
            className="rounded-xl bg-emerald-600 px-3 py-1.5 text-2xs font-black text-white hover:bg-emerald-500"
          >
            → بازگشت به {home.label}
          </Link>
        )}
      </span>
    </div>
  );
}

export function HelpBreadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="مسیر راهنما" className="flex flex-wrap items-center gap-1.5 text-2xs text-slate-500">
      {trail.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-slate-300">‹</span>}
          {c.href ? (
            <Link href={c.href} className="rounded px-1 py-0.5 font-bold text-indigo-700 hover:bg-indigo-50 hover:underline">
              {c.label}
            </Link>
          ) : (
            <span className="px-1 py-0.5 font-bold text-slate-700">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export type PrevNextTopic = { role: string; slug: string; title: string } | null;

export function HelpPrevNext({ prev, next, listHref, listLabel }: { prev: PrevNextTopic; next: PrevNextTopic; listHref: string; listLabel: string }) {
  return (
    <div className="mt-8 grid gap-2 sm:grid-cols-3">
      <div>
        {next && (
          <Link
            href={`/help/${next.role}/${next.slug}`}
            className="block rounded-2xl border border-slate-200 bg-white p-3 text-xs hover:border-indigo-300 hover:bg-indigo-50/50"
          >
            <span className="block text-3xs text-slate-400">موضوع بعدی</span>
            <span className="mt-0.5 block font-black text-slate-800">→ {next.title}</span>
          </Link>
        )}
      </div>
      <Link
        href={listHref}
        className="block rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center text-xs font-black text-slate-600 hover:border-slate-400"
      >
        <span className="block text-lg">📚</span>
        {listLabel}
      </Link>
      <div>
        {prev && (
          <Link
            href={`/help/${prev.role}/${prev.slug}`}
            className="block rounded-2xl border border-slate-200 bg-white p-3 text-left text-xs hover:border-indigo-300 hover:bg-indigo-50/50"
          >
            <span className="block text-3xs text-slate-400">موضوع قبلی</span>
            <span className="mt-0.5 block font-black text-slate-800">{prev.title} ←</span>
          </Link>
        )}
      </div>
    </div>
  );
}

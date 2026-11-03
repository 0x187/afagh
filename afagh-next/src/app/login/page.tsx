import Link from 'next/link';
import LoginCard from './LoginCard';
import ThemeToggle from '@/components/ThemeToggle';
import ShowcaseSlider from './ShowcaseSlider';
import UniversitySwitcher from './UniversitySwitcher';
import { getLoginShowcase, type ShowcaseNotice } from '@/lib/login-showcase';

export const metadata = { title: 'ورود | سامانه جامع آفاق' };
export const dynamic = 'force-dynamic';

const NOTICE_STYLE: Record<string, string> = {
  important: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
  warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  info: 'border-sky-200 bg-white/95 text-slate-700 dark:border-sky-800 dark:bg-slate-900 dark:text-slate-200',
};
const NOTICE_ICON: Record<string, string> = { important: '📢', warning: '⚠️', info: 'ℹ️' };

function NoticeCard({ n }: { n: ShowcaseNotice }) {
  return (
    <div className={`rounded-2xl border p-3.5 shadow-sm ${NOTICE_STYLE[n.kind] ?? NOTICE_STYLE.info}`}>
      <p className="text-[13px] font-black flex items-center gap-1.5">
        <span>{NOTICE_ICON[n.kind] ?? 'ℹ️'}</span>
        <span>{n.title}</span>
      </p>
      {n.body ? <p className="mt-1 text-xs leading-6 opacity-90">{n.body}</p> : null}
    </div>
  );
}

export default async function LoginPage(props: { searchParams: Promise<{ u?: string; expired?: string }> }) {
  const sp = await props.searchParams;
  const show = await getLoginShowcase(sp.u);
  const important = show.notices.filter(n => n.kind === 'important');
  const rest = show.notices.filter(n => n.kind !== 'important');
  const uni = show.university;

  return (
    <main dir="rtl" className="min-h-screen bg-gradient-to-bl from-emerald-950 via-slate-900 to-teal-950 p-4 sm:p-8 flex items-start sm:items-center justify-center">
      <div className="w-full max-w-6xl grid gap-6 lg:grid-cols-5 items-start">
        {/* ── پنل معرفی / اسلایدر ── */}
        <div className="order-2 space-y-4 lg:order-1 lg:col-span-3">
          <div className="flex items-center gap-4">
            {uni.logoUrl ? (
              <img src={uni.logoUrl} alt={uni.title} className="h-16 w-16 sm:h-20 sm:w-20 object-contain rounded-3xl bg-white p-2 shadow-2xl" />
            ) : (
              <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-3xl bg-emerald-500 flex items-center justify-center font-black text-3xl text-emerald-950 shadow-2xl">
                آ
              </div>
            )}
            <div>
              <h1 className="text-white font-black text-lg sm:text-2xl leading-9">{uni.title}</h1>
              <p className="text-emerald-200/80 text-xs sm:text-sm mt-0.5">سامانه جامع آموزشی، مالی و پژوهشی</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <UniversitySwitcher universities={show.universities} currentCode={uni.code} />
            <ThemeToggle />
          </div>

          <ShowcaseSlider slides={show.slides} />

          {rest.length > 0 && (
            <div className="space-y-2.5">
              {rest.map(n => (
                <NoticeCard key={n.id} n={n} />
              ))}
            </div>
          )}
        </div>

        {/* ── ستون ورود ── */}
        <div className="order-1 space-y-4 lg:order-2 lg:col-span-2 lg:sticky lg:top-6">
          {sp.expired === '1' && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-xs font-bold leading-6 text-amber-900 shadow-sm">
              ⏰ به دلیل عدم فعالیت طولانی، نشست شما در این دستگاه بسته شد. لطفاً دوباره وارد شوید.
            </div>
          )}
          {important.length > 0 && (
            <div className="space-y-2.5">
              {important.map(n => (
                <NoticeCard key={n.id} n={n} />
              ))}
            </div>
          )}
          <LoginCard />
          <p className="text-center text-2xs text-emerald-200/60">
            <Link href="/help?tab=shared" className="hover:underline">📖 راهنمای ورود و حساب‌ها</Link>
          </p>
        </div>
      </div>
    </main>
  );
}

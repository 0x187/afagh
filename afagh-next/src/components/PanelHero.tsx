import type { ReactNode } from 'react';

/**
 * سربرگِ ویترینیِ داشبوردِ هر کارتابل — یک منبعِ حقیقت برای «صفحهٔ اول».
 *
 * چرا کامپوننتِ مشترک: چهار کارتابل (مدیریت/استاد/دانشجو/مدیر گروه) هرکدام
 * سربرگِ خودشان را دستی نوشته بودند؛ نتیجه اینکه صفحهٔ اولِ هر پنل زبانِ بصریِ
 * متفاوتی داشت — یکی تیترِ ساده، یکی نوارِ آمارِ تخت، یکی هیچ. اینجا یک الگوی
 * واحد ساخته می‌شود: نشانِ برند + عنوان + زیرعنوان + چیپ‌ها + نوارِ آمار.
 *
 * 🎨 چرا «سطحِ خنثی + هالهٔ رنگی» و نه گرادیانِ پررنگ:
 *   رنگِ سربرگِ بالای صفحه به دانشگاهِ فعال وابسته است (نیلی/نارنجی/زمردی/
 *   صورتی/فیروزه‌ای). اگر خودِ ویترین هم گرادیانِ رنگیِ ثابت داشت، با بعضی
 *   دانشگاه‌ها ناسازگار می‌شد. پس سطح خنثی است و فقط یک هالهٔ نرمِ رنگِ برند
 *   در گوشه می‌نشیند؛ هم در روشن و هم در تیره خوانا می‌ماند.
 *
 * Server Component است (بدون state) تا در چهار صفحه بدون هزینهٔ کلاینت استفاده شود.
 */

export type HeroTone = 'indigo' | 'emerald' | 'teal' | 'slate';

const TONES: Record<HeroTone, { glow: string; badge: string; dot: string }> = {
  indigo: {
    glow: 'radial-gradient(720px 260px at 88% -30%, rgba(99,102,241,.30), transparent 68%), radial-gradient(420px 200px at 6% 120%, rgba(139,92,246,.16), transparent 70%)',
    badge: 'border-indigo-100 bg-indigo-50 text-indigo-700 dark:border-indigo-800/60 dark:bg-indigo-950/60 dark:text-indigo-200',
    dot: 'bg-indigo-500',
  },
  emerald: {
    glow: 'radial-gradient(720px 260px at 88% -30%, rgba(16,185,129,.28), transparent 68%), radial-gradient(420px 200px at 6% 120%, rgba(20,184,166,.16), transparent 70%)',
    badge: 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-200',
    dot: 'bg-emerald-500',
  },
  teal: {
    glow: 'radial-gradient(720px 260px at 88% -30%, rgba(13,148,136,.28), transparent 68%), radial-gradient(420px 200px at 6% 120%, rgba(56,189,248,.14), transparent 70%)',
    badge: 'border-teal-100 bg-teal-50 text-teal-700 dark:border-teal-800/60 dark:bg-teal-950/60 dark:text-teal-200',
    dot: 'bg-teal-500',
  },
  slate: {
    glow: 'radial-gradient(720px 260px at 88% -30%, rgba(100,116,139,.22), transparent 68%), radial-gradient(420px 200px at 6% 120%, rgba(99,102,241,.12), transparent 70%)',
    badge: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
    dot: 'bg-slate-400',
  },
};

export interface HeroStat {
  label: string;
  value: string;
  /** رنگِ عدد — کلاسِ متن (پیش‌فرض: رنگِ متنِ اصلی) */
  tone?: string;
  /** عنوانِ کامل برای tooltip */
  title?: string;
}

export default function PanelHero({
  tone = 'indigo',
  eyebrow,
  title,
  subtitle,
  icon,
  chips,
  stats,
  statsSlot,
  children,
}: {
  tone?: HeroTone;
  /** برچسبِ کوچکِ بالای عنوان */
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  /** آیکونِ نشان (اموجی یا عنصر) */
  icon?: ReactNode;
  /** چیپ‌های وضعیت زیرِ زیرعنوان */
  chips?: ReactNode;
  /** نوارِ آمارِ کنارِ عنوان (روی موبایل زیرِ آن) */
  stats?: HeroStat[];
  /**
   * جایگزینِ `stats` برای آمارِ «کند».
   *
   * چرا: اگر آمار با `await` گرفته شود، کل ویترین — و در نتیجه کل صفحه — تا
   * پایانِ کوئری معطل می‌ماند. با این اسلات، پوستهٔ ویترین فوراً رندر می‌شود و
   * آمار داخل یک `<Suspense>` استریم می‌شود (اسکلتون هم‌اندازه، بدون پرشِ چیدمان).
   */
  statsSlot?: ReactNode;
  /** محتوای دلخواه در گوشهٔ مقابل */
  children?: ReactNode;
}) {
  const t = TONES[tone] ?? TONES.indigo;

  return (
    <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm print:hidden sm:p-5">
      {/* هالهٔ نرمِ برند — تزئینی و بدون تأثیر بر چیدمان */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: t.glow }} />

      <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        {/* هویت و عنوان */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2.5">
            {icon ? (
              <span
                aria-hidden
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border text-lg shadow-sm sm:h-11 sm:w-11 sm:text-xl ${t.badge}`}
              >
                {icon}
              </span>
            ) : null}
            <div className="min-w-0">
              {eyebrow ? (
                <p className="text-3xs font-black uppercase tracking-widest text-slate-400">{eyebrow}</p>
              ) : null}
              <h1 className="truncate text-base font-black tracking-tight text-slate-900 sm:text-xl">{title}</h1>
            </div>
          </div>

          {subtitle ? (
            <p className="mt-2 text-2xs font-bold leading-6 text-slate-500 sm:text-xs">{subtitle}</p>
          ) : null}

          {chips ? <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{chips}</div> : null}
        </div>

        {/* نوارِ آمار: ستون‌های جداشده با خطِ مویی در دسکتاپ، شبکهٔ دوتایی در موبایل */}
        {statsSlot ? (
          <div className="w-full sm:w-auto">{statsSlot}</div>
        ) : stats && stats.length > 0 ? (
          <HeroStatsRow stats={stats} />
        ) : null}

        {children ? <div className="shrink-0">{children}</div> : null}
      </div>
    </section>
  );
}

/**
 * ردیفِ آمارِ ویترین — جدا شده تا هم داخل `PanelHero` و هم داخل یک
 * `<Suspense>` (که آمار را دیرتر استریم می‌کند) عیناً یک شکل داشته باشد.
 */
export function HeroStatsRow({ stats }: { stats: HeroStat[] }) {
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-none sm:auto-cols-fr sm:grid-flow-col sm:gap-0 sm:[&>*+*]:border-r sm:[&>*+*]:border-slate-200">
      {stats.map(s => (
        <div
          key={s.label}
          title={s.title}
          className="rounded-xl bg-slate-50/80 px-3 py-2 text-center sm:rounded-none sm:bg-transparent sm:px-4"
        >
          <p className={`truncate text-base font-black tabular-nums leading-tight sm:text-lg ${s.tone ?? 'text-slate-900'}`}>
            {s.value}
          </p>
          <p className="mt-0.5 truncate text-3xs font-bold text-slate-500">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

/** اسکلتونِ هم‌اندازهٔ ردیفِ آمار — جلوگیری از پرشِ چیدمان هنگام استریم */
export function HeroStatsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-flow-col sm:gap-0">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="px-3 py-2 sm:px-4">
          <div className="mx-auto h-5 w-10 animate-pulse rounded bg-slate-200/80 sm:h-6" />
          <div className="mx-auto mt-1.5 h-2.5 w-14 animate-pulse rounded bg-slate-200/60" />
        </div>
      ))}
    </div>
  );
}

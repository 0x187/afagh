import type { ReactNode } from 'react';

/**
 * Showcase hero for every panel dashboard — port of components/PanelHero.tsx.
 * One visual language for the first screen of all panels: brand badge + title
 * + subtitle + chips + a stats row on a neutral surface with a soft brand glow
 * (the header carries the university color; the hero stays readable on both
 * themes).
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
  /** Value color class (default: main text color). */
  tone?: string;
  /** Full text for the tooltip. */
  title?: string;
}

export function HeroStatsRow({ stats }: { stats: HeroStat[] }) {
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none sm:gap-0 sm:[&>*+*]:border-r sm:[&>*+*]:border-slate-200 dark:sm:[&>*+*]:border-slate-700">
      {stats.map(s => (
        <div
          key={s.label}
          title={s.title}
          className="rounded-xl bg-slate-50/80 px-3 py-2 text-center dark:bg-slate-800/70 sm:rounded-none sm:bg-transparent sm:px-4 dark:sm:bg-transparent"
        >
          <p className={`truncate text-base font-black leading-tight tabular-nums sm:text-lg ${s.tone ?? 'text-slate-900'}`}>
            {s.value}
          </p>
          <p className="mt-0.5 truncate text-[10px] font-bold text-slate-500 dark:text-slate-400">{s.label}</p>
        </div>
      ))}
    </div>
  );
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
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  chips?: ReactNode;
  stats?: HeroStat[];
  /** Slot for "slow" stats rendered by the caller (streams later). */
  statsSlot?: ReactNode;
  children?: ReactNode;
}) {
  const t = TONES[tone] ?? TONES.indigo;
  return (
    <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm print:hidden dark:border-slate-700 dark:bg-slate-800 sm:p-5">
      {/* Soft brand glow — decorative only; dialed down in dark so cards stay readable */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 dark:opacity-50"
        style={{ background: t.glow }}
      />

      <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
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
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  {eyebrow}
                </p>
              ) : null}
              <h1 className="truncate text-base font-black tracking-tight text-slate-900 dark:text-slate-50 sm:text-xl">
                {title}
              </h1>
            </div>
          </div>
          {subtitle ? (
            <p className="mt-2 text-[11px] font-bold leading-6 text-slate-500 dark:text-slate-400 sm:text-xs">
              {subtitle}
            </p>
          ) : null}
          {chips ? <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{chips}</div> : null}
        </div>
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

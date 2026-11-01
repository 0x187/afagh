import { useMemo } from 'react';

import {
  CALENDAR_DAY_COUNT,
  hourLabels,
  layoutCalendarWeek,
  type CalendarSchedulable,
} from '@/lib/calendar-layout';
import { cn } from '@/lib/utils';

// ═══ Weekly calendar grid — shared between the student and professor portals ═══
// Pure layout is in calendar-layout.ts; this component only renders.

const DAY_NAMES = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

export type WeekGridEntry = CalendarSchedulable & {
  code: string;
  title: string;
  groupNumber?: number;
  roomName?: string | null;
  buildingName?: string | null;
  professorName?: string | null;
  courseType?: string | null;
  sharedScheduleGroupKey?: string | null;
  merged?: boolean;
};

const TYPE_STYLE: Record<string, string> = {
  عمومی: 'bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-100',
  پایه: 'bg-sky-50 border-sky-300 text-sky-900 dark:bg-sky-950 dark:border-sky-700 dark:text-sky-100',
  تخصصی: 'bg-indigo-50 border-indigo-300 text-indigo-900 dark:bg-indigo-950 dark:border-indigo-700 dark:text-indigo-100',
  اختیاری: 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-100',
  جبرانی: 'bg-rose-50 border-rose-300 text-rose-900 dark:bg-rose-950 dark:border-rose-700 dark:text-rose-100',
};

function weekBadge(weekType: string): string {
  if (weekType === 'EVEN') return 'زوج';
  if (weekType === 'ODD') return 'فرد';
  if (weekType === 'BOTH') return 'زوج/فرد';
  return 'هر هفته';
}

export function WeekGrid({ entries }: { entries: WeekGridEntry[] }) {
  const placements = useMemo(() => layoutCalendarWeek(entries), [entries]);
  const labels = useMemo(() => hourLabels(), []);
  const hours = labels.map((l) => Number(l.slice(0, 2)));

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <div className="min-w-[760px]">
        {/* Day headers */}
        <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-border bg-muted/50">
          <div />
          {Array.from({ length: CALENDAR_DAY_COUNT }, (_, d) => (
            <div key={d} className="px-1 py-2 text-center text-[11px] font-bold">
              {DAY_NAMES[d]}
            </div>
          ))}
        </div>
        {/* Body */}
        <div className="grid grid-cols-[3.5rem_repeat(7,1fr)]">
          {/* Hour column */}
          <div className="relative border-l border-border">
            {hours.slice(0, -1).map((h) => (
              <div key={h} className="h-10 border-b border-border/60 pr-1 text-left text-[10px] text-muted-foreground">
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {Array.from({ length: CALENDAR_DAY_COUNT }, (_, d) => {
            const list = placements.get(d) ?? [];
            return (
              <div key={d} className="relative border-l border-border/60" style={{ height: `${(hours.length - 1) * 40}px` }}>
                {/* Hour lines */}
                {hours.slice(0, -1).map((h, i) => (
                  <div key={h} className="absolute right-0 left-0 border-b border-border/40" style={{ top: `${(i + 1) * 40}px` }} />
                ))}
                {list.map((p) => {
                  const e = p.entry;
                  const style = TYPE_STYLE[e.courseType ?? ''] ?? TYPE_STYLE['تخصصی'];
                  return (
                    <div
                      key={p.key}
                      className={cn('absolute overflow-hidden rounded-md border p-1 text-[10px] leading-4 shadow-sm', style)}
                      style={{
                        top: `${p.topPercent}%`,
                        height: `${p.heightPercent}%`,
                        right: `${p.leftPercent}%`,
                        width: `${p.widthPercent}%`,
                      }}
                      title={`${e.code} — ${e.title}${e.professorName ? ` — ${e.professorName}` : ''}`}
                    >
                      <div className="flex items-center gap-1 font-bold">
                        {e.merged && <span aria-hidden>🔗</span>}
                        <span className="truncate">{e.code}</span>
                        <span className="mr-auto shrink-0 rounded bg-black/10 px-1 text-[9px] dark:bg-white/10">
                          {weekBadge(e.weekType)}
                        </span>
                      </div>
                      <div className="truncate">{e.title}</div>
                      <div className="truncate opacity-80">
                        {e.startTime.slice(0, 5)}–{e.endTime.slice(0, 5)}
                        {e.roomName ? ` · ${e.roomName}` : ''}
                      </div>
                      {e.professorName ? <div className="truncate opacity-70">{e.professorName}</div> : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══ چیدمان تقویم هفتگی — پورت professor-calendar-layout.ts ═══
// منطق خالص چیدمان (بدون React): بازهٔ ساعت، فیلتر هفته، ادغام و جای‌گذاری.
export const CALENDAR_START_MINUTES = 7 * 60;
export const CALENDAR_END_MINUTES = 20 * 60;
export const CALENDAR_DAY_COUNT = 7;
export const CALENDAR_MIN_ENTRY_MINUTES = 30;

export interface CalendarRange {
  startMinutes: number;
  endMinutes: number;
}

export const DEFAULT_CALENDAR_RANGE: CalendarRange = {
  startMinutes: CALENDAR_START_MINUTES,
  endMinutes: CALENDAR_END_MINUTES,
};

export function normalizeCalendarRange(range?: Partial<CalendarRange> | null): CalendarRange {
  const s = Number(range?.startMinutes);
  const e = Number(range?.endMinutes);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return DEFAULT_CALENDAR_RANGE;
  return { startMinutes: s, endMinutes: e };
}

export type CalendarWeekType = 'ALL' | 'EVEN' | 'ODD' | 'BOTH';
export type CalendarWeekFilter = 'ALL' | 'EVEN' | 'ODD';

export interface CalendarSchedulable {
  id: number;
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  weekType: CalendarWeekType;
}

export function timeToMinutes(value: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function dayIndex(dayOfWeek: number | null | undefined): number | null {
  if (dayOfWeek == null) return null;
  const d = Number(dayOfWeek);
  if (!Number.isInteger(d) || d < 0 || d >= CALENDAR_DAY_COUNT) return null;
  return d;
}

export function entryKey(row: CalendarSchedulable): string {
  const s = String(row.startTime ?? '').slice(0, 5);
  const e = String(row.endTime ?? '').slice(0, 5);
  return `${row.id}|${row.weekType}|${row.dayOfWeek}|${s}|${e}`;
}

export function filterByWeek<T extends CalendarSchedulable>(rows: T[], filter: CalendarWeekFilter): T[] {
  if (filter === 'EVEN') return rows.filter((r) => r.weekType === 'ALL' || r.weekType === 'EVEN' || r.weekType === 'BOTH');
  if (filter === 'ODD') return rows.filter((r) => r.weekType === 'ALL' || r.weekType === 'ODD' || r.weekType === 'BOTH');
  return rows.slice();
}

export interface CollapseRow {
  id: number;
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  weekType: CalendarWeekType;
  code?: string;
  title?: string;
  groupNumber?: number;
  units?: number;
  enrolledCount?: number | null;
  capacity?: number | null;
  roomName?: string | null;
  buildingName?: string | null;
  roomKey?: string | number | null;
  sharedScheduleGroupKey?: string | null;
  merged?: boolean;
}

export function collapseCalendarEntries<T extends CollapseRow>(rows: T[]): T[] {
  const groups: { key: string | null; members: T[] }[] = [];
  const byKey = new Map<string, { key: string | null; members: T[] }>();
  for (const r of rows) {
    const shared = String(r.sharedScheduleGroupKey ?? '').trim();
    const slot = `${r.dayOfWeek}|${r.startTime.slice(0, 5)}|${r.endTime.slice(0, 5)}|${r.roomKey ?? r.roomName ?? '-'}`;
    const key = shared && !shared.startsWith('SOLO-') ? `K:${shared}` : `S:${slot}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, members: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.members.push(r);
  }
  const out: T[] = [];
  for (const g of groups) {
    if (g.members.length <= 1) {
      out.push(g.members[0]);
      continue;
    }
    const codes = [...new Set(g.members.map((m) => String(m.code ?? '').trim()).filter(Boolean))];
    // هر سانس متمایز (روز+ساعت) یک بلوک؛ زوج/فرد هم‌سانس ادغام می‌شوند → BOTH
    const bySlot = new Map<string, T[]>();
    for (const m of g.members) {
      const sk = `${m.dayOfWeek}|${m.startTime}|${m.endTime}`;
      bySlot.set(sk, [...(bySlot.get(sk) ?? []), m]);
    }
    for (const slotMembers of bySlot.values()) {
      const primary = slotMembers[0];
      const weekSet = new Set(slotMembers.map((m) => String(m.weekType)));
      const weekType: CalendarWeekType = weekSet.size === 1 ? primary.weekType : 'BOTH';
      out.push({
        ...primary,
        code: (codes.length > 0 ? codes.join(' / ') : primary.code) as T['code'],
        weekType,
        merged: true,
        enrolledCount: slotMembers.reduce((s, m) => s + (m.enrolledCount ?? 0), 0) || primary.enrolledCount,
        capacity: Math.max(...slotMembers.map((m) => m.capacity ?? 0)) || primary.capacity,
        units: Math.max(...slotMembers.map((m) => m.units ?? 0)) || primary.units,
      });
    }
  }
  return out;
}

export function hourLabels(range?: Partial<CalendarRange> | null): string[] {
  const { startMinutes, endMinutes } = normalizeCalendarRange(range);
  const out: string[] = [];
  for (let h = startMinutes / 60; h <= endMinutes / 60; h += 1) {
    out.push(`${String(h).padStart(2, '0')}:00`);
  }
  return out;
}

export interface Placement<T> {
  entry: T;
  key: string;
  topPercent: number;
  heightPercent: number;
  leftPercent: number;
  widthPercent: number;
  column: number;
  columnCount: number;
  clipped: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function layoutCalendarDay<T extends CalendarSchedulable>(
  dayEntries: T[],
  range?: Partial<CalendarRange> | null,
): Placement<T>[] {
  const { startMinutes: start0, endMinutes: end0 } = normalizeCalendarRange(range);
  const total = end0 - start0;
  const items = dayEntries
    .map((entry) => ({
      entry,
      start: timeToMinutes(entry.startTime),
      end: timeToMinutes(entry.endTime),
    }))
    .filter((x): x is { entry: T; start: number; end: number } => x.start != null && x.end != null && x.end > x.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: Placement<T>[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const colEnd: number[] = [];
    const assigned = cluster.map((item) => {
      let c = colEnd.findIndex((e) => e <= item.start);
      if (c === -1) {
        c = colEnd.length;
        colEnd.push(item.end);
      } else {
        colEnd[c] = item.end;
      }
      return { item, col: c };
    });
    const n = colEnd.length;
    for (const { item, col } of assigned) {
      const cs = Math.min(Math.max(item.start, start0), end0);
      const ce = Math.min(Math.max(item.end, start0), end0);
      let top = ((cs - start0) / total) * 100;
      const height = (Math.max(ce - cs, CALENDAR_MIN_ENTRY_MINUTES) / total) * 100;
      if (top + height > 100) top = Math.max(0, 100 - height);
      out.push({
        entry: item.entry,
        key: entryKey(item.entry),
        topPercent: round2(top),
        heightPercent: round2(height),
        leftPercent: round2((col / n) * 100),
        widthPercent: round2(100 / n),
        column: col,
        columnCount: n,
        clipped: item.start < start0 || item.end > end0,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const it of items) {
    if (cluster.length > 0 && it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

export function layoutCalendarWeek<T extends CalendarSchedulable>(
  rows: T[],
  range?: Partial<CalendarRange> | null,
): Map<number, Placement<T>[]> {
  const byDay = new Map<number, T[]>();
  for (let d = 0; d < CALENDAR_DAY_COUNT; d += 1) byDay.set(d, []);
  for (const r of rows) {
    const d = dayIndex(r.dayOfWeek);
    if (d == null) continue;
    byDay.get(d)!.push(r);
  }
  const out = new Map<number, Placement<T>[]>();
  for (const [d, list] of byDay) out.set(d, layoutCalendarDay(list, range));
  return out;
}

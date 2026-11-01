import { describe, expect, it } from 'vitest';
import {
  collapseCalendarEntries,
  dayIndex,
  filterByWeek,
  layoutCalendarDay,
  timeToMinutes,
  type CollapseRow,
} from './calendar-layout';

describe('calendar-layout', () => {
  it('timeToMinutes/dayIndex', () => {
    expect(timeToMinutes('08:30')).toBe(510);
    expect(timeToMinutes('8:05')).toBe(485);
    expect(timeToMinutes('25:00')).toBeNull();
    expect(timeToMinutes('')).toBeNull();
    expect(dayIndex(0)).toBe(0);
    expect(dayIndex(6)).toBe(6);
    expect(dayIndex(7)).toBeNull();
    expect(dayIndex(null)).toBeNull();
  });

  it('filterByWeek', () => {
    const rows = [
      { id: 1, dayOfWeek: 0, startTime: '08:00', endTime: '09:00', weekType: 'ALL' as const },
      { id: 2, dayOfWeek: 1, startTime: '08:00', endTime: '09:00', weekType: 'EVEN' as const },
      { id: 3, dayOfWeek: 2, startTime: '08:00', endTime: '09:00', weekType: 'ODD' as const },
      { id: 4, dayOfWeek: 3, startTime: '08:00', endTime: '09:00', weekType: 'BOTH' as const },
    ];
    expect(filterByWeek(rows, 'EVEN').map((r) => r.id)).toEqual([1, 2, 4]);
    expect(filterByWeek(rows, 'ODD').map((r) => r.id)).toEqual([1, 3, 4]);
    expect(filterByWeek(rows, 'ALL').length).toBe(4);
  });

  it('collapse: ادغام دستی و SOLO', () => {
    const base = {
      dayOfWeek: 2,
      startTime: '08:00',
      endTime: '10:00',
      weekType: 'ALL' as const,
      roomKey: '10',
    };
    const rows: CollapseRow[] = [
      { ...base, id: 1, code: 'A', sharedScheduleGroupKey: 'G1' },
      { ...base, id: 2, code: 'B', sharedScheduleGroupKey: 'G1' },
    ];
    const merged = collapseCalendarEntries(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].code).toBe('A / B');
    expect(merged[0].merged).toBe(true);

    const solo = collapseCalendarEntries([
      { ...base, id: 1, code: 'A', sharedScheduleGroupKey: 'SOLO-1' },
      { ...base, id: 2, code: 'B', sharedScheduleGroupKey: 'G1' },
    ]);
    expect(solo).toHaveLength(2);

    // Even/odd same-session → BOTH
    const both = collapseCalendarEntries([
      { ...base, id: 1, code: 'A', sharedScheduleGroupKey: 'G1', weekType: 'EVEN' as const },
      { ...base, id: 2, code: 'A2', sharedScheduleGroupKey: 'G1', weekType: 'ODD' as const },
    ]);
    expect(both).toHaveLength(1);
    expect(both[0].weekType).toBe('BOTH');
  });

  it('layout: جای‌گذاری و ستون‌بندی تداخل', () => {
    const placements = layoutCalendarDay([
      { id: 1, dayOfWeek: 0, startTime: '08:00', endTime: '10:00', weekType: 'ALL' },
      { id: 2, dayOfWeek: 0, startTime: '09:00', endTime: '11:00', weekType: 'ALL' },
      { id: 3, dayOfWeek: 0, startTime: '12:00', endTime: '13:00', weekType: 'ALL' },
    ]);
    // 7:00 to 20:00 = 780 minutes; start 8:00 → (60/780)*100 = 7.69
    expect(placements.find((p) => p.entry.id === 1)?.topPercent).toBeCloseTo(7.69, 1);
    const one = placements.find((p) => p.entry.id === 1)!;
    const two = placements.find((p) => p.entry.id === 2)!;
    expect(one.widthPercent).toBe(50); // Two columns in an overlapping cluster
    expect(two.column).toBe(1);
    const three = placements.find((p) => p.entry.id === 3)!;
    expect(three.widthPercent).toBe(100); // Single column
    expect(three.heightPercent).toBeCloseTo(7.69, 1);
  });
});

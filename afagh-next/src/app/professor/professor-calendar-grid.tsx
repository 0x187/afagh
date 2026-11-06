'use client';

import type { CSSProperties } from 'react';
import { PROFESSOR_GRID_DAYS } from '@/lib/professor-week-grid';
import {
  layoutProfessorCalendarDay,
  professorCalendarDayIndex,
  professorCalendarHourLabels,
  PROFESSOR_CALENDAR_END_MINUTES,
  PROFESSOR_CALENDAR_START_MINUTES,
  type ProfessorCalendarWeekType,
} from '@/lib/professor-calendar-layout';

export interface ProfessorCalendarEntry {
  key: string;
  id: number;
  code: string;
  title: string;
  groupNumber: number;
  /** برچسب گروه نمایشی (مثل «۱، ۲» برای بلوک‌های ادغامی چندگروهی) — اگر خالی باشد groupNumber نمایش داده می‌شود */
  groupLabel?: string | null;
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  roomName: string;
  buildingName: string;
  weekType: ProfessorCalendarWeekType;
  courseType?: string;
  isCoTaught?: boolean;
  coRole?: 'THEORY' | 'LAB';
  coPartnerName?: string;
  enrolledCount?: number | null;
  capacity?: number | null;
  merged?: boolean;
  professorName?: string;
}

const faNum = (n: any) => (n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

const HOUR_LABELS = professorCalendarHourLabels();
const TOTAL_MINUTES = PROFESSOR_CALENDAR_END_MINUTES - PROFESSOR_CALENDAR_START_MINUTES;
const HOUR_ROWS = TOTAL_MINUTES / 60;

/**
 * چیدمان جدول هفتگی:
 *  • `days-columns` — مدل الف (پیش‌فرض): ستون‌ها روز، سطرها ساعت (ساعت محورِ عمودی).
 *  • `days-rows` — مدل ب: ستون‌ها ساعت، سطرها روز (ساعت محورِ افقی). در کارتابل
 *    دانشجو و استاد استفاده می‌شود تا مثل «مدل ب» تابلوی هفتگیِ ادمین باشد.
 */
export type ProfessorCalendarOrientation = 'days-columns' | 'days-rows';

function WeekBadge({ weekType }: { weekType: ProfessorCalendarWeekType }) {
  if (weekType === 'BOTH') {
    return (
      <span className="prof-week-badge px-1.5 py-0.5 rounded bg-violet-100 text-violet-900 font-bold border border-violet-300 whitespace-nowrap">🔷🔶 زوج و فرد</span>
    );
  }
  if (weekType === 'EVEN') {
    return (
      <span className="prof-week-badge px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-900 font-bold border border-cyan-300 whitespace-nowrap">🔷 هفته زوج</span>
    );
  }
  if (weekType === 'ODD') {
    return (
      <span className="prof-week-badge px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold border border-amber-300 whitespace-nowrap">🔶 هفته فرد</span>
    );
  }
  return (
    <span className="prof-week-badge px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 font-bold whitespace-nowrap">هر هفته</span>
  );
}

export function professorCalendarEntryTime(e: Pick<ProfessorCalendarEntry, 'startTime' | 'endTime'>) {
  return `${faNum(String(e.startTime).slice(0, 5))} الی ${faNum(String(e.endTime).slice(0, 5))}`;
}

export function professorCalendarEntryGroup(e: Pick<ProfessorCalendarEntry, 'groupNumber' | 'groupLabel'>) {
  const label = String(e.groupLabel ?? '').trim();
  return label ? faNum(label) : faNum(e.groupNumber);
}

/**
 * `room` (پیش‌فرض، کارتابل استاد/دانشجو): سطر چهارم کارت = نام کلاس + ساختمان.
 * `professor` (سردر کلاس‌ها): چون پوستر برای یک کلاسِ ثابت چاپ می‌شود و نام کلاس
 * در هر بلوک تکراری و بی‌فایده است، سطر چهارم = نام استاد (مثلاً «آقای دکتر محمدی»)
 * و برچسب جداگانهٔ «استاد:» دیگر نشان داده نمی‌شود تا تکرار نشود.
 */
export type ProfessorCalendarPlaceMode = 'room' | 'professor';

/** بدنهٔ کارتِ کلاس — بین مدل الف و مدل ب مشترک است (فقط پوستهٔ موقعیت‌دهی فرق می‌کند). */
function ProfessorCalendarCard({
  e,
  showCode,
  doorPrint,
  printCount,
  placeMode,
  title,
}: {
  e: ProfessorCalendarEntry;
  showCode: boolean;
  doorPrint: boolean;
  printCount: boolean;
  placeMode: ProfessorCalendarPlaceMode;
  title: string;
}) {
  const byPlace = placeMode === 'professor'
    ? (e.professorName ? `👤 ${e.professorName}` : '👤 استاد ثبت نشده')
    : (e.roomName ? `🏛️ ${e.roomName}` : '🏛️ سالن ثبت نشده');
  const placeTitle = placeMode === 'professor'
    ? (e.professorName ? `استاد: ${e.professorName}` : 'استاد ثبت نشده')
    : (e.roomName ? `${e.roomName}${e.buildingName ? ` · ${e.buildingName}` : ''}` : 'سالن ثبت نشده');
  const hideProfessorPill = placeMode === 'professor';
  return (
    <div
      title={title}
      className={`prof-week-card h-full overflow-hidden p-1.5 rounded-lg border text-right shadow-xs leading-4 ${
        e.courseType === 'عملی'
          ? 'bg-amber-50 border-amber-300 text-amber-950'
          : 'bg-indigo-50 border-indigo-200 text-indigo-950'
      }`}
    >
      <div className="prof-print-inner hidden print:flex print:flex-col print:justify-center print:h-full text-[6.8pt] font-bold leading-[1.25] text-black">
          {doorPrint ? (
            <>
              <div className="prof-door-title">
                <span className="prof-door-name">{e.title}{e.merged ? ' 🔗' : ''}</span>
                {e.weekType === 'EVEN' ? <span className="prof-door-wk">زوج</span> : null}
                {e.weekType === 'ODD' ? <span className="prof-door-wk">فرد</span> : null}
                {e.weekType === 'BOTH' ? <span className="prof-door-wk">فرد و زوج</span> : null}
              </div>
              <div className="prof-door-prof">{e.professorName || '—'}</div>
              <div className="prof-door-time"><span dir="ltr">{professorCalendarEntryTime(e)}</span></div>
              {printCount && e.enrolledCount != null ? (
                <div className="prof-door-count">👥 {faNum(e.enrolledCount)}{e.capacity != null ? `/${faNum(e.capacity)}` : ''}</div>
              ) : null}
            </>
          ) : (
            <>
              <div className="prof-print-title text-[8.5pt] font-black leading-[1.15] truncate">{e.title}{e.merged ? ' 🔗' : ''}</div>
              <div className="prof-print-meta text-[5.8pt] leading-[1.15] truncate">
                {showCode ? `${e.code} · ` : ''}گروه {professorCalendarEntryGroup(e)}{printCount && e.enrolledCount != null ? ` · 👥 ${faNum(e.enrolledCount)}${e.capacity != null ? `/${faNum(e.capacity)}` : ''}` : ''}
              </div>
              <div className="prof-print-meta text-[5.8pt] leading-[1.15] truncate">{professorCalendarEntryTime(e)} · {placeTitle}{e.weekType === 'EVEN' ? ' · هفته زوج' : e.weekType === 'ODD' ? ' · هفته فرد' : e.weekType === 'BOTH' ? ' · زوج و فرد' : ''}</div>
              {e.professorName && !hideProfessorPill ? <div className="prof-print-teacher text-[5.8pt] font-bold leading-[1.15] text-black truncate">استاد: {e.professorName}</div> : null}
            </>
          )}
        </div>
        <div className="prof-week-title print:hidden font-extrabold text-2xs text-slate-900 leading-5 truncate" title={e.title}>
          {e.title}
        </div>
        <div className="prof-week-code print:hidden font-mono text-3xs font-bold text-indigo-900 whitespace-nowrap truncate" title={showCode ? `${e.code} · گروه ${professorCalendarEntryGroup(e)}` : `گروه ${professorCalendarEntryGroup(e)}`}>
          {showCode ? `${e.code} · ` : ''}گروه {professorCalendarEntryGroup(e)}{e.enrolledCount != null ? ` · 👥 ${faNum(e.enrolledCount)}${e.capacity != null ? `/${faNum(e.capacity)}` : ''}` : ''}
        </div>
        <div className="prof-week-essential print:hidden text-3xs font-mono font-bold text-slate-600 whitespace-nowrap">
          {professorCalendarEntryTime(e)}
        </div>
        <div
          className="prof-week-essential print:hidden text-3xs font-bold text-slate-700 whitespace-nowrap truncate"
          title={placeTitle}
        >
          {byPlace}{placeMode === 'room' && e.buildingName ? <span className="prof-week-detail"> · {e.buildingName}</span> : null}
        </div>
        {e.merged && (
          <div className="prof-week-badge print:hidden mt-0.5 inline-block px-1.5 py-0.5 rounded bg-teal-100 text-teal-950 font-bold border border-teal-300 text-3xs whitespace-nowrap">
            🔗 کلاس ادغامی
          </div>
        )}
        {e.professorName && !hideProfessorPill ? (
          <div
            className="prof-week-detail print:hidden mt-0.5 px-1 py-0.5 rounded bg-slate-100 text-slate-800 text-3xs font-bold border border-slate-200 leading-4 truncate"
            title={`استاد: ${e.professorName}`}
          >
            استاد: {e.professorName}
          </div>
        ) : null}
        {e.isCoTaught && (
          <div className="prof-week-detail print:hidden mt-0.5 px-1 py-0.5 rounded bg-purple-100 text-purple-900 text-3xs font-bold border border-purple-200 leading-4 truncate" title={e.coPartnerName ? `مشترک · ${e.coPartnerName}` : 'مشترک'}>
            👥 مشترک{e.coPartnerName ? ` · ${e.coPartnerName}` : ''}
          </div>
        )}
        <div className="print:hidden flex items-center justify-between gap-1 text-3xs pt-0.5 mt-0.5 border-t border-slate-200/60">
          <span className="prof-week-detail font-bold text-slate-600 whitespace-nowrap">
            {e.enrolledCount != null ? `👥 ${faNum(e.enrolledCount)}/${faNum(e.capacity)}` : '👥'}
          </span>
          <WeekBadge weekType={e.weekType} />
        </div>
    </div>
  );
}

export default function ProfessorCalendarGrid({ entries, placeMode = 'room', showCode = true, doorPrint = false, printCount = false, orientation = 'days-columns' }: {
  entries: ProfessorCalendarEntry[];
  placeMode?: ProfessorCalendarPlaceMode;
  /** چاپ/نمایش کد درس — برای سردر کلاس‌ها پیش‌فرض خاموش است تا خوانایی بالا برود */
  showCode?: boolean;
  /** چاپ پوستری درب کلاس (مثل تابلوی قدیم): عنوان / «گروه + ساعت» / «استاد: نام» — بدون تعداد نفرات */
  doorPrint?: boolean;
  /** نمایش تعداد دانشجو در چاپ (انتخابی کاربر؛ پیش‌فرض خاموش تا چاپ شلوغ نشود) */
  printCount?: boolean;
  /** مدل الف (روز در ستون) یا مدل ب (روز در سطر) */
  orientation?: ProfessorCalendarOrientation;
}) {
  const placeTitle = (e: ProfessorCalendarEntry) =>
    placeMode === 'professor'
      ? (e.professorName ? `استاد: ${e.professorName}` : 'استاد ثبت نشده')
      : (e.roomName ? `${e.roomName}${e.buildingName ? ` · ${e.buildingName}` : ''}` : 'سالن ثبت نشده');
  const cardTitle = (e: ProfessorCalendarEntry) =>
    `${e.title} — ${e.code} · ${professorCalendarEntryTime(e)} · ${placeTitle(e)}`;
  const byDay: ProfessorCalendarEntry[][] = Array.from({ length: PROFESSOR_GRID_DAYS.length }, () => []);
  for (const e of entries) {
    const d = professorCalendarDayIndex(e.dayOfWeek);
    if (d == null) continue;
    byDay[d].push(e);
  }
  const placed = byDay.map(list => layoutProfessorCalendarDay(list));
  const hasEven = entries.some(e => e.weekType === 'EVEN');
  const hasOdd = entries.some(e => e.weekType === 'ODD');
  const hasBoth = entries.some(e => e.weekType === 'BOTH');
  const hasAll = entries.some(e => e.weekType === 'ALL');

  const card = (e: ProfessorCalendarEntry) => (
    <ProfessorCalendarCard
      e={e}
      showCode={showCode}
      doorPrint={doorPrint}
      printCount={printCount}
      placeMode={placeMode}
      title={cardTitle(e)}
    />
  );

  /**
   * مدل ب: ساعت روی محور افقی (راست→چپ در RTL) و هر روز یک سطر.
   * اسپنِ زمانی همان `topPercent/heightPercent`ِ layoutProfessorCalendarDay است
   * که این‌جا افقی می‌شود و اسپنِ هم‌پوشانی (`leftPercent/widthPercent`) عمودی.
   * اگر چند کلاس هم‌زمان در یک روز باشد، همهٔ سطرها به اندازهٔ بیشترین تعداد
   * هم‌پوشانی بلند می‌شوند تا کارت‌ها روی هم نیفتند.
   */
  const rowUnits = Math.max(
    1,
    ...placed.map(list => list.reduce((m, p) => Math.max(m, p.columnCount), 0)),
  );
  const bTemplate = `88px repeat(${HOUR_ROWS}, minmax(0, 1fr))`;
  const hourHeader = Array.from({ length: HOUR_ROWS }, (_, h) => `${String(h + PROFESSOR_CALENDAR_START_MINUTES / 60).padStart(2, '0')}:00`);

  const weekLegend = (hasEven || hasOdd || hasBoth) && (
    <div className="prof-week-legend flex flex-wrap items-center gap-1.5 text-3xs font-bold">
      <span className="text-slate-500">راهنمای هفته‌ها:</span>
      {hasAll && <span className="prof-week-badge px-2 py-0.5 rounded-lg bg-slate-200 text-slate-800">هر هفته — همه هفته‌ها</span>}
      {hasEven && <span className="prof-week-badge px-2 py-0.5 rounded-lg bg-cyan-100 text-cyan-900 border border-cyan-300">🔷 هفته زوج — فقط هفته‌های زوج</span>}
      {hasOdd && <span className="prof-week-badge px-2 py-0.5 rounded-lg bg-amber-100 text-amber-900 border border-amber-300">🔶 هفته فرد — فقط هفته‌های فرد</span>}
      {hasBoth && <span className="prof-week-badge px-2 py-0.5 rounded-lg bg-violet-100 text-violet-900 border border-violet-300">🔷🔶 زوج و فرد — همه هفته‌ها</span>}
    </div>
  );

  return (
    <div className="space-y-3">
      <style>{'.prof-week-card{container-type:inline-size}.prof-week-card .prof-week-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}[data-narrow="true"] .prof-week-card{padding:4px !important;line-height:1.3 !important}[data-narrow="true"] .prof-week-title{font-size:10px !important}[data-narrow="true"] .prof-week-code{font-size:9px !important}[data-narrow="true"] .prof-week-essential{font-size:9px !important}[data-narrow="true"] .prof-week-detail{display:none !important}@container (max-width:150px){.prof-week-detail{display:none}.prof-week-title{font-size:10px}.prof-week-code{font-size:9px}.prof-week-essential{font-size:9px}}'}</style>
      {weekLegend}

      <div className="prof-week-scroll overflow-x-auto rounded-2xl border border-slate-200">
        {orientation === 'days-rows' ? (
          /* ─── مدل ب: سطرها روز، ستون‌ها ساعت ─── */
          <div className="prof-cal-b min-w-[1100px]" dir="rtl" style={{ '--cal-row': '76px' } as CSSProperties}>
            <div className="grid sticky top-0 z-20 bg-slate-900 text-white text-center" style={{ gridTemplateColumns: bTemplate }}>
              <div className="p-2 border border-slate-800 font-extrabold bg-slate-900 text-2xs">روز / ساعت</div>
              {hourHeader.map(h => (
                <div key={h} className="p-2 border border-slate-800 font-extrabold text-2xs whitespace-nowrap">
                  {faNum(h)}
                </div>
              ))}
            </div>

            {PROFESSOR_GRID_DAYS.map((day, dayIdx) => (
              <div key={day} className="grid" style={{ gridTemplateColumns: bTemplate }}>
                <div className="sticky right-0 z-10 bg-slate-50 border-l border-t border-slate-200 p-2 text-center font-extrabold text-xs text-slate-800 flex items-center justify-center">
                  {day}
                </div>
                {/*
                  ⚠ `gridColumn` اجباری است: این گرید `1 + HOUR_ROWS` ستون دارد
                  (برچسب روز + یک ستون برای هر ساعت)، ولی این سلول فرزندِ دوم
                  است و به‌طور پیش‌فرض فقط **یک** ستون (عرضِ یک ساعت ≈۶۲px) را
                  می‌گرفت. نتیجه: همهٔ کارت‌ها و خطوط ساعت در نواری باریک در
                  کنارِ ستون روز فشرده می‌شدند و برنامه عملاً خالی دیده می‌شد
                  (باگ گزارش‌شده در کارتابل استاد/دانشجو و چاپ آن).
                  با span، سلول تمامِ ستون‌های ساعت را می‌پوشاند.
                */}
                <div
                  className="relative border-l border-t border-slate-200 bg-white"
                  style={{
                    height: `calc(var(--cal-row) * ${rowUnits})`,
                    gridColumn: `2 / span ${HOUR_ROWS}`,
                  }}
                >
                  {/* خطوط ساعت (عمودی) + نیم‌ساعت خط‌چین */}
                  {Array.from({ length: HOUR_ROWS + 1 }, (_, i) => (
                    <div
                      key={`h-${i}`}
                      className="absolute inset-y-0 border-s border-slate-300"
                      style={{ insetInlineStart: `${(i / HOUR_ROWS) * 100}%` }}
                    />
                  ))}
                  {Array.from({ length: HOUR_ROWS }, (_, i) => (
                    <div
                      key={`half-${i}`}
                      className="absolute inset-y-0 border-s border-dashed border-slate-100"
                      style={{ insetInlineStart: `${((i + 0.5) / HOUR_ROWS) * 100}%` }}
                    />
                  ))}

                  {placed[dayIdx].length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-slate-200 text-lg font-black select-none">—</div>
                  )}

                  {placed[dayIdx].map((p, i) => {
                    const e = p.entry as ProfessorCalendarEntry;
                    // کارتِ کوتاه (کمتر از ~۱.۵ ساعت) یا هم‌پوشان → جزئیات کمتر
                    const narrowB = p.columnCount > 1 || p.heightPercent < 11.5;
                    return (
                      <div
                        key={`${p.key}#${i}`}
                        className="absolute p-[2px]"
                        data-narrow={narrowB ? 'true' : 'false'}
                        data-cols={p.columnCount}
                        style={{
                          top: `${p.leftPercent}%`,
                          height: `${p.widthPercent}%`,
                          insetInlineStart: `${p.topPercent}%`,
                          width: `${p.heightPercent}%`,
                          minHeight: '36px',
                        }}
                      >
                        {card(e)}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ─── مدل الف (پیش‌فرض): ستون‌ها روز، سطرها ساعت ─── */
          <div className="prof-cal min-w-[960px]" dir="rtl" style={{ '--cal-hour': '56px' } as CSSProperties}>
            <div className="prof-cal-head grid sticky top-0 z-20 bg-slate-900 text-white text-center" style={{ gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }}>
              <div className="prof-cal-sticky prof-cal-gutter-head sticky right-0 z-30 p-2 border border-slate-800 font-extrabold bg-slate-900 text-2xs">ساعت</div>
              {PROFESSOR_GRID_DAYS.map(day => (
                <div key={day} className="prof-cal-day-head p-2 border border-slate-800 font-extrabold text-xs whitespace-nowrap bg-slate-900">
                  {day}
                </div>
              ))}
            </div>

            <div className="prof-cal-body grid" style={{ gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }}>
              <div className="prof-cal-sticky prof-cal-gutter sticky right-0 z-10 bg-white border-l border-slate-200">
                <div className="relative w-full" style={{ height: `calc(var(--cal-hour) * ${HOUR_ROWS})` }}>
                  {HOUR_LABELS.map((label, i) => (
                    <div
                      key={label}
                      className="prof-cal-gutter-label absolute inset-x-0 text-center text-3xs font-bold text-slate-500 whitespace-nowrap"
                      style={{ top: `${(i / HOUR_ROWS) * 100}%`, transform: i === 0 ? 'translateY(0)' : i === HOUR_ROWS ? 'translateY(-100%)' : 'translateY(-50%)' }}
                    >
                      {faNum(label)}
                    </div>
                  ))}
                </div>
              </div>

              {PROFESSOR_GRID_DAYS.map((day, dayIdx) => (
                <div key={day} className="prof-cal-day border-l border-slate-200 last:border-l-0 bg-white">
                    <div className="relative w-full" style={{ height: `calc(var(--cal-hour) * ${HOUR_ROWS})` }}>
                    {Array.from({ length: HOUR_ROWS }, (_, h) => (
                      <div key={`h-${h}`}>
                        <div
                          className="prof-cal-hour-line absolute inset-x-0 border-t border-slate-300"
                          style={{ top: `${((h * 60) / TOTAL_MINUTES) * 100}%` }}
                        />
                        <div
                          className="prof-cal-half-line absolute inset-x-0 border-t border-dashed border-slate-100"
                          style={{ top: `${(((h * 60) + 30) / TOTAL_MINUTES) * 100}%` }}
                        />
                      </div>
                    ))}
                    <div className="prof-cal-hour-line absolute inset-x-0 border-t border-slate-300" style={{ top: '100%' }} />

                    {placed[dayIdx].length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center text-slate-200 text-lg font-black select-none">—</div>
                    )}

                    {placed[dayIdx].map((p, i) => {
                      const e = p.entry as ProfessorCalendarEntry;
                      return (
                        <div
                          key={`${p.key}#${i}`}
                          className="absolute p-[2px]"
                          data-narrow={p.columnCount > 1 ? 'true' : 'false'}
                          data-cols={p.columnCount}
                          style={{
                            top: `${p.topPercent}%`,
                            height: `${p.heightPercent}%`,
                            left: `${p.leftPercent}%`,
                            width: `${p.widthPercent}%`,
                            minHeight: '40px',
                          }}
                        >
                          {card(e)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

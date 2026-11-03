'use client';

import { professorUniqueOfferings, type ProfessorScheduleRow } from '@/lib/professor-week-grid';
import { collapseCalendarEntries, professorCalendarEntryKey } from '@/lib/professor-calendar-layout';
import ProfessorCalendarGrid, { type ProfessorCalendarEntry } from './professor-calendar-grid';

const faNum = (n: any) => (n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

type Props = {
  termTitle: string;
  selectedTermTitle: string | null;
  rows: ProfessorScheduleRow[];
  professorName?: string;
  staffCode?: string | number | null;
  universityTitle?: string | null;
  universityLogoUrl?: string | null;
};

export default function ProfessorWeekTable({ termTitle, selectedTermTitle, rows, professorName, staffCode, universityTitle, universityLogoUrl }: Props) {
  const scopeLabel = selectedTermTitle ? `نیمسال «${selectedTermTitle}»` : `نیمسال ${termTitle || 'جاری'}`;
  const offerings = professorUniqueOfferings(rows);
  const scheduled = rows.filter(r => r.hasSchedule);
  const unscheduled = rows.filter(r => !r.hasSchedule);
  const printDate = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  if (offerings.length === 0) {
    return (
      <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200">
        <h2 className="font-extrabold text-slate-900 text-base">
          جدول نیمسالی تکلیف کارتابل جاری {termTitle ? `— ${termTitle}` : ''}
        </h2>
        <div className="mt-4 text-center p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-xs font-bold text-slate-500">
          در {scopeLabel} هیچ کلاسی برای شما تخصیص نیافته است. پس از تخصیص درس توسط مدیر گروه،
          برنامهٔ هفتگی به‌صورت خودکار از جدول زمان‌بندی همین‌جا نمایش داده می‌شود.
        </div>
      </div>
    );
  }

  const entries: ProfessorCalendarEntry[] = collapseCalendarEntries(scheduled).map(r => ({
    key: professorCalendarEntryKey(r),
    id: r.id,
    code: r.code,
    title: r.title,
    groupNumber: r.groupNumber,
    dayOfWeek: r.dayOfWeek,
    startTime: r.startTime,
    endTime: r.endTime,
    roomName: r.roomName,
    buildingName: r.buildingName,
    weekType: r.weekType,
    courseType: r.courseType,
    isCoTaught: r.isCoTaught,
    coRole: r.coRole,
    coPartnerName: r.coPartnerName,
    enrolledCount: r.enrolledCount,
    capacity: r.capacity,
    merged: r.merged ?? false,
  }));

  return (
    <div className="print-area prof-week-print bg-white rounded-3xl p-5 shadow-sm border border-slate-200 space-y-4">
      <style>{'@media print { @page { size: A4 landscape; margin: 8mm 7mm; } }'}</style>
      <div className="prof-week-print-head hidden print:block">
        <div style={{ display: 'flex', alignItems: 'center', gap: '4mm' }}>
          {universityLogoUrl ? (
            <img src={universityLogoUrl} alt="" width={53} height={53} style={{ height: '14mm', width: 'auto', display: 'block' }} />
          ) : null}
          <div>
            <div className="font-extrabold">{universityTitle ? `${universityTitle} — ` : ''}برنامه هفتگی تدریس{professorName ? ` — ${professorName}` : ''}{staffCode ? ` (کد پرسنلی ${faNum(staffCode)})` : ''}</div>
            <div><bdi>{termTitle || 'نیمسال جاری'}</bdi> · همه جلسات (زوج و فرد) · تاریخ چاپ: <span suppressHydrationWarning>{printDate}</span></div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-200 print:hidden">
        <div>
          <h2 className="font-extrabold text-slate-900 text-base">
            جدول نیمسالی تکلیف کارتابل جاری {termTitle ? `— ${termTitle}` : ''}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            فقط کلاس‌هایی که ساعت ثبت‌شده دارند در جدول دیده می‌شوند؛ بقیه در فهرست پایین همین کارت آمده‌اند.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500 whitespace-nowrap">
            {faNum(offerings.length)} کلاس · {faNum(scheduled.length)} جلسهٔ زمان‌بندی‌شده
          </span>
          <button
            onClick={() => window.print()}
            className="print:hidden px-3 py-1.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs shadow transition whitespace-nowrap"
          >
            🖨 چاپ برنامه
          </button>
        </div>
      </div>

      {scheduled.length === 0 ? (
        <div className="text-center p-6 bg-amber-50 rounded-2xl border border-dashed border-amber-300 text-xs font-bold text-amber-900 leading-6">
          {faNum(offerings.length)} کلاس در {scopeLabel} به شما تخصیص یافته است، اما هیچ‌کدام ساعت و روزی
          در جدول زمان‌بندی ندارند؛ بنابراین جدول هفتگی خالی است. فهرست دقیق کلاس‌ها در پایین همین کارت آمده است.
        </div>
      ) : (
        <ProfessorCalendarGrid entries={entries} orientation="days-rows" />
      )}

      {unscheduled.length > 0 && (
        <div className="print:hidden rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <h3 className="text-xs font-extrabold text-amber-900">
            کلاس‌های بدون ساعت‌بندی ثبت‌شده ({faNum(new Set(unscheduled.map(r => r.id)).size)} کلاس)
          </h3>
          <p className="text-2xs text-amber-800 leading-5">
            این کلاس‌ها در {scopeLabel} به شما تخصیص یافته‌اند ولی هنوز روز و ساعتی در جدول زمان‌بندی
            برایشان ثبت نشده است؛ به همین دلیل در جدول بالا دیده نمی‌شوند.
          </p>
          <ul className="space-y-1 text-2xs font-bold text-amber-900">
            {unscheduled.map(r => (
              <li key={`${r.id}-${r.weekType}-${r.code}-unscheduled`}>
                {r.code} · {r.title} · گروه {faNum(r.groupNumber)} · {faNum(r.units)} واحد · {scopeLabel}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

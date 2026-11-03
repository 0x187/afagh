'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import ProfessorCalendarGrid, { type ProfessorCalendarEntry } from '../../professor/professor-calendar-grid';
import {
  collapseCalendarEntries,
  filterProfessorCalendarByWeek,
  professorCalendarDayIndex,
  professorCalendarEntryKey,
} from '@/lib/professor-calendar-layout';

export type StudentGridWeekType = 'ALL' | 'EVEN' | 'ODD';

export interface StudentGridClass {
  dayOfWeek: number | null;
  dayName: string;
  startTime: string;
  endTime: string;
  room: string;
  building: string;
  weekType: StudentGridWeekType;
}

export interface StudentScheduleCourse {
  enrollmentId: number;
  offeringId: number;
  code: string;
  title: string;
  units: number;
  courseType: string;
  group: number;
  status: string;
  professor: string;
  enrolledCount: number | null;
  capacity: number | null;
  sharedScheduleGroupKey: string | null;
  classes: StudentGridClass[];
  exam: {
    examDate: string;
    startTime: string;
    endTime: string;
    room?: string;
  } | null;
}

export type StudentCalendarEntry = ProfessorCalendarEntry & {
  sharedScheduleGroupKey: string | null;
  roomKey: string;
};

export function studentWeekLabel(weekType: StudentGridWeekType): string {
  if (weekType === 'EVEN') return 'هفته زوج';
  if (weekType === 'ODD') return 'هفته فرد';
  return 'هر هفته';
}

export function studentStatusLabel(status: string | null | undefined): string {
  const v = String(status ?? '').toUpperCase();
  if (v === 'WAITLISTED') return 'ذخیره';
  if (v === 'PENDING_COUNCIL') return 'در انتظار شورا';
  return 'ثبت نهایی';
}

export function buildStudentCalendarEntries(courses: StudentScheduleCourse[]): StudentCalendarEntry[] {
  const out: StudentCalendarEntry[] = [];
  for (const c of courses) {
    for (const cls of c.classes) {
      if (professorCalendarDayIndex(cls.dayOfWeek) == null) continue;
      const startTime = String(cls.startTime ?? '').slice(0, 5);
      const endTime = String(cls.endTime ?? '').slice(0, 5);
      if (!startTime || !endTime) continue;
      const row = {
        id: c.offeringId,
        dayOfWeek: cls.dayOfWeek,
        startTime,
        endTime,
        weekType: cls.weekType,
      };
      out.push({
        key: professorCalendarEntryKey(row),
        id: c.offeringId,
        code: c.code,
        title: c.title,
        groupNumber: c.group,
        dayOfWeek: cls.dayOfWeek,
        startTime,
        endTime,
        roomName: cls.room || '',
        buildingName: cls.building || '',
        weekType: cls.weekType,
        courseType: c.courseType,
        professorName: c.professor,
        enrolledCount: c.enrolledCount,
        capacity: c.capacity,
        sharedScheduleGroupKey: c.sharedScheduleGroupKey,
        roomKey: cls.room || '',
      });
    }
  }
  return out;
}

const faNum = (n: any) => (n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

function toShamsi(dStr: string | null | undefined): string {
  if (!dStr) return '—';
  if (dStr.startsWith('13') || dStr.startsWith('14') || dStr.startsWith('۱۴') || dStr.startsWith('۱۳')) {
    return faNum(dStr);
  }
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return faNum(dStr);
    return new Intl.DateTimeFormat('fa-IR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return faNum(dStr);
  }
}

export default function ScheduleClient({
  student,
  term,
  university,
  courses,
}: {
  student: {
    name: string;
    studentCode: string;
    majorName: string;
    degreeTitle: string;
    currentTermNo: number;
    entryYear: number;
  };
  term: {
    title: string;
    termCode: string;
  };
  university: {
    title: string;
    logoUrl: string | null;
  };
  courses: StudentScheduleCourse[];
}) {
  const [weekFilter, setWeekFilter] = useState<'ALL' | 'EVEN' | 'ODD'>('ALL');

  const totalUnits = useMemo(() => courses.reduce((sum, c) => sum + c.units, 0), [courses]);
  const entries = useMemo(() => buildStudentCalendarEntries(courses), [courses]);
  const collapsed = useMemo(() => collapseCalendarEntries(entries), [entries]);
  const visibleEntries = useMemo(
    () => filterProfessorCalendarByWeek(collapsed, weekFilter),
    [collapsed, weekFilter]
  );
  const unscheduled = useMemo(() => courses.filter(c => c.classes.length === 0), [courses]);

  const sortedExams = useMemo(() => {
    return courses
      .filter(c => c.exam != null)
      .map(c => ({
        code: c.code,
        title: c.title,
        group: c.group,
        units: c.units,
        professor: c.professor,
        examDate: c.exam!.examDate,
        startTime: c.exam!.startTime,
        endTime: c.exam!.endTime,
        room: c.exam!.room || '',
      }))
      .sort((a, b) => a.examDate.localeCompare(b.examDate));
  }, [courses]);

  const weekFilterLabel = weekFilter === 'EVEN' ? 'فقط هفته‌های زوج' : weekFilter === 'ODD' ? 'فقط هفته‌های فرد' : 'همه جلسات (زوج و فرد)';
  const printDate = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  return (
    <div className="print-area prof-week-print space-y-5 text-slate-800 font-sans" dir="rtl">
      <style>{'@media print { @page { size: A4 landscape; margin: 8mm 7mm; } }'}</style>

      <div className="prof-week-print-head hidden print:block">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8pt' }}>
          {university.logoUrl ? (
            <img src={university.logoUrl} alt="" style={{ height: '28pt', width: '28pt', objectFit: 'contain' }} />
          ) : null}
          <div>
            <div className="font-extrabold">{university.title}</div>
            <div>برنامه هفتگی — {student.name} (شماره دانشجویی <span dir="ltr">{faNum(student.studentCode)}</span> · {student.majorName} · {student.degreeTitle} ترم {faNum(student.currentTermNo)})</div>
          </div>
        </div>
        <div>
          <span>نیمسال: <bdi>{term.title}</bdi> (کد نیمسال: {faNum(term.termCode)})</span>
          <span> · {weekFilterLabel} · تاریخ چاپ: <span suppressHydrationWarning>{printDate}</span></span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm print:hidden">
        <div className="flex items-center gap-2">
          <Link
            href="/student/enroll"
            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-xl font-bold transition-colors flex items-center gap-1"
          >
            <span>بازگشت به انتخاب واحد</span>
          </Link>
          <span className="text-xs text-slate-400">|</span>
          <span className="text-xs text-slate-600 font-bold">
            برنامه هفتگی — <bdi>{term.title}</bdi>
          </span>
        </div>

        <button
          onClick={() => window.print()}
          className="text-xs bg-indigo-700 hover:bg-indigo-800 text-white px-4 py-2 rounded-xl font-extrabold transition-all shadow-md active:scale-95 flex items-center gap-1.5"
        >
          <span>چاپ برنامه هفتگی</span>
        </button>
      </div>

      <div className="print:hidden grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 text-xs shadow-sm">
        <div>
          <span className="text-slate-500 block text-2xs">نام و نام خانوادگی:</span>
          <span className="font-extrabold text-slate-900 text-sm">{student.name}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-2xs">شماره دانشجویی:</span>
          <span className="font-extrabold text-slate-900 text-sm" dir="ltr">
            {faNum(student.studentCode)}
          </span>
        </div>
        <div>
          <span className="text-slate-500 block text-2xs">رشته تحصیلی:</span>
          <span className="font-extrabold text-slate-900">{student.majorName}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-2xs">مقطع و ترم تحصیلی:</span>
          <span className="font-extrabold text-slate-900">
            {student.degreeTitle} (ترم {faNum(student.currentTermNo)})
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-slate-200 shadow-sm print:hidden">
        <div className="flex items-center gap-2 tabstrip">
          <span className="text-xs font-bold text-slate-600">فیلتر نمایش هفته:</span>
          <button
            onClick={() => setWeekFilter('ALL')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
              weekFilter === 'ALL' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            همه جلسات (زوج و فرد)
          </button>
          <button
            onClick={() => setWeekFilter('EVEN')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
              weekFilter === 'EVEN' ? 'bg-cyan-700 text-white' : 'bg-cyan-50 text-cyan-800 hover:bg-cyan-100'
            }`}
          >
            فقط هفته‌های زوج
          </button>
          <button
            onClick={() => setWeekFilter('ODD')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
              weekFilter === 'ODD' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            فقط هفته‌های فرد
          </button>
        </div>
        <span className="text-xs bg-indigo-50 text-indigo-900 border border-indigo-200 px-2.5 py-0.5 rounded-lg font-bold">
          مجموع: {faNum(totalUnits)} واحد ({faNum(courses.length)} درس)
        </span>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div>
            <h3 className="font-extrabold text-slate-900 text-base">
              جدول هفتگی تشکیل کلاس‌ها
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              شامل استاد، شماره کلاس فیزیکی و ساختمان هر گروه درسی
            </p>
          </div>
        </div>

        {courses.length === 0 ? (
          <div className="text-center p-8 text-xs text-slate-500 font-bold leading-6">
            درسی برای نمایش در برنامه هفتگی وجود ندارد.
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center p-6 bg-amber-50 rounded-2xl border border-dashed border-amber-300 text-xs font-bold text-amber-900 leading-6">
            {faNum(courses.length)} درس در این نیمسال ثبت شده است، اما هیچ‌کدام روز و ساعتی در جدول زمان‌بندی ندارند؛ بنابراین جدول هفتگی خالی است. فهرست دروس در پایین همین صفحه آمده است.
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="text-center p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-xs font-bold text-slate-600 leading-6">
            با فیلتر «{weekFilterLabel}» کلاسی برای نمایش وجود ندارد.
          </div>
        ) : (
          <ProfessorCalendarGrid entries={visibleEntries} orientation="days-rows" />
        )}

        {unscheduled.length > 0 && (
          <div className="print:hidden mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2">
            <h4 className="text-xs font-extrabold text-amber-900">
              دروس بدون ساعت‌بندی ثبت‌شده ({faNum(unscheduled.length)} درس)
            </h4>
            <ul className="space-y-1 text-2xs font-bold text-amber-900">
              {unscheduled.map(o => (
                <li key={o.offeringId}>
                  {o.code} · {o.title} (گروه {faNum(o.group)} · {faNum(o.units)} واحد)
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="print:hidden bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
        <h3 className="font-extrabold text-slate-900 text-sm">
          فهرست دروس ثبت‌نام‌شده:
        </h3>

        <div className="overflow-x-auto rounded-xl border border-slate-300">
          <table className="w-full text-right text-xs border-collapse rt">
            <thead className="bg-slate-100 text-slate-800 border-b border-slate-300">
              <tr>
                <th className="p-2 border-l border-slate-300 text-center w-12">ردیف</th>
                <th className="p-2 border-l border-slate-300 text-center w-20">کد درس</th>
                <th className="p-2 border-l border-slate-300">نام درس</th>
                <th className="p-2 border-l border-slate-300 text-center w-16">گروه</th>
                <th className="p-2 border-l border-slate-300 text-center w-14">واحد</th>
                <th className="p-2 border-l border-slate-300">نوع درس</th>
                <th className="p-2 border-l border-slate-300">استاد درس</th>
                <th className="p-2 border-l border-slate-300">محل و زمان کلاس</th>
                <th className="p-2 border-l border-slate-300 text-center">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {courses.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-4 text-center text-slate-400">
                    درسی ثبت نشده است.
                  </td>
                </tr>
              ) : (
                courses.map((c, idx) => (
                  <tr key={c.offeringId} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="p-2 border-l border-slate-200 text-center font-bold">{faNum(idx + 1)}</td>
                    <td className="p-2 border-l border-slate-200 text-center font-mono" dir="ltr">
                      {c.code}
                    </td>
                    <td className="p-2 border-l border-slate-200 font-extrabold text-slate-900">
                      {c.title}
                      <div className="mt-1">
                        <Link
                          href={`/student/lesson-plan/${c.offeringId}`}
                          className="inline-block px-2 py-0.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-bold text-3xs transition"
                        >
                          📋 مشاهده طرح درس
                        </Link>
                      </div>
                    </td>
                    <td className="p-2 border-l border-slate-200 text-center font-bold">
                      گروه {faNum(c.group)}
                    </td>
                    <td className="p-2 border-l border-slate-200 text-center font-bold font-mono">
                      {faNum(c.units)}
                    </td>
                    <td className="p-2 border-l border-slate-200 text-slate-600">{c.courseType}</td>
                    <td className="p-2 border-l border-slate-200 font-medium">{c.professor}</td>
                    <td className="p-2 border-l border-slate-200 text-slate-700">
                      {c.classes.length === 0 ? (
                        <span className="text-2xs text-slate-400">زمان‌بندی ثبت نشده</span>
                      ) : (
                        c.classes.map((cls, i) => (
                          <div key={i} className="text-2xs">
                            • {cls.dayName} ساعت {faNum(cls.startTime)} تا {faNum(cls.endTime)} — <b>{cls.room || 'کلاس تئوری'}</b>
                            {cls.weekType !== 'ALL' ? ` (${studentWeekLabel(cls.weekType)})` : ''}
                          </div>
                        ))
                      )}
                    </td>
                    <td className="p-2 border-l border-slate-200 text-center">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-3xs">
                        {studentStatusLabel(c.status)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="print:hidden bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
        <h3 className="font-extrabold text-slate-900 text-sm">
          برنامهٔ امتحانات پایان‌نیمسال:
        </h3>

        <div className="overflow-x-auto rounded-xl border border-slate-300">
          <table className="w-full text-right text-xs border-collapse rt">
            <thead className="bg-slate-100 text-slate-800 border-b border-slate-300">
              <tr>
                <th className="p-2 border-l border-slate-300 text-center w-12">ردیف</th>
                <th className="p-2 border-l border-slate-300 text-center w-28">تاریخ امتحان</th>
                <th className="p-2 border-l border-slate-300 text-center w-28">ساعت آزمون</th>
                <th className="p-2 border-l border-slate-300">عنوان درس</th>
                <th className="p-2 border-l border-slate-300 text-center w-16">گروه</th>
                <th className="p-2 border-l border-slate-300">استاد درس</th>
                <th className="p-2 border-l border-slate-300">سالن آزمون</th>
              </tr>
            </thead>
            <tbody>
              {sortedExams.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-slate-400">
                    برنامه امتحانی برای دروس این ترم ثبت نشده است.
                  </td>
                </tr>
              ) : (
                sortedExams.map((ex, idx) => (
                  <tr key={idx} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="p-2 border-l border-slate-200 text-center font-bold">{faNum(idx + 1)}</td>
                    <td className="p-2 border-l border-slate-200 text-center font-bold text-indigo-950 font-mono">
                      {toShamsi(ex.examDate)}
                    </td>
                    <td className="p-2 border-l border-slate-200 text-center font-bold text-slate-800 font-mono">
                      {faNum(ex.startTime)} الی {faNum(ex.endTime)}
                    </td>
                    <td className="p-2 border-l border-slate-200 font-extrabold text-slate-900">{ex.title}</td>
                    <td className="p-2 border-l border-slate-200 text-center font-bold">
                      گروه {faNum(ex.group)}
                    </td>
                    <td className="p-2 border-l border-slate-200">{ex.professor}</td>
                    <td className="p-2 border-l border-slate-200 font-bold text-emerald-800">
                      {ex.room || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

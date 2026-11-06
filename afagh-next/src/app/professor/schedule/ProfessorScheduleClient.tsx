'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { hasProfessorSchedule } from '@/lib/professor-week-grid';
import { collapseCalendarEntries, filterProfessorCalendarByWeek, professorCalendarEntryKey } from '@/lib/professor-calendar-layout';
import ProfessorCalendarGrid, { type ProfessorCalendarEntry } from '../professor-calendar-grid';

export interface ProfessorScheduleOffering {
  id: number;
  code: string;
  title: string;
  units: number;
  courseType: 'پایه' | 'اصلی' | 'تخصصی' | 'عمومی' | 'عملی';
  groupNumber: number;
  enrolledCount: number;
  capacity: number;
  dayOfWeek: number | null; // 0: شنبه ... 6: جمعه · null = زمان‌بندی ثبت نشده
  dayName: string;
  startTime: string;
  endTime: string;
  roomName: string;
  buildingName: string;
  weekType: 'ALL' | 'EVEN' | 'ODD' | 'BOTH';
  isCoTaught?: boolean;
  coRole?: 'THEORY' | 'LAB';
  coPartnerName?: string;
  hasSchedule?: boolean;
  outsideStandardSlots?: boolean;
  merged?: boolean;
  sharedScheduleGroupKey?: string | null;
}

interface Props {
  professor: {
    id: number;
    name: string;
    staffCode: string;
    academicRank: string;
    contractType: string;
    departmentName: string;
    universityTitle: string;
    universityLogoUrl?: string | null;
  };
  termTitle: string;
  initialOfferings: ProfessorScheduleOffering[];
}

const faNum = (n: any) => (n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

const uniqueIds = (rows: ProfessorScheduleOffering[]) =>
  new Set(rows.map(r => r.id)).size;

export default function ProfessorScheduleClient({ professor, termTitle, initialOfferings }: Props) {
  const [offerings] = useState<ProfessorScheduleOffering[]>(initialOfferings);
  const [selectedWeekFilter, setSelectedWeekFilter] = useState<'ALL' | 'EVEN' | 'ODD'>('ALL');

  const isScheduled = (o: ProfessorScheduleOffering) =>
    o.hasSchedule ?? hasProfessorSchedule({ dayOfWeek: o.dayOfWeek, startTime: o.startTime, endTime: o.endTime });

  const uniqueOfferings = offerings.filter(
    (o, idx) => offerings.findIndex(x => x.id === o.id) === idx,
  );

  const totalUnits = uniqueOfferings.reduce((s, o) => s + Number(o.units || 0), 0);
  const totalStudents = uniqueOfferings.reduce((s, o) => s + Number(o.enrolledCount || 0), 0);
  const totalClasses = uniqueOfferings.length;
  const scheduledRows = offerings.filter(isScheduled);
  const daysWithClass = new Set(scheduledRows.map(o => o.dayOfWeek as number)).size;
  const unscheduled = offerings.filter(o => !isScheduled(o));
  const sessionsOf = (offeringId: number) => scheduledRows.filter(o => o.id === offeringId).length;
  const filteredScheduled = filterProfessorCalendarByWeek(collapseCalendarEntries(scheduledRows), selectedWeekFilter);
  const calendarEntries: ProfessorCalendarEntry[] = filteredScheduled.map(o => ({
    key: professorCalendarEntryKey(o),
    id: o.id,
    code: o.code,
    title: o.title,
    groupNumber: o.groupNumber,
    dayOfWeek: o.dayOfWeek,
    startTime: o.startTime,
    endTime: o.endTime,
    roomName: o.roomName,
    buildingName: o.buildingName,
    weekType: o.weekType,
    courseType: o.courseType,
    isCoTaught: o.isCoTaught,
    coRole: o.coRole,
    coPartnerName: o.coPartnerName,
    enrolledCount: o.enrolledCount,
    capacity: o.capacity,
    merged: o.merged ?? false,
  }));
  const weekFilterLabel = selectedWeekFilter === 'EVEN' ? 'فقط هفته‌های زوج' : selectedWeekFilter === 'ODD' ? 'فقط هفته‌های فرد' : 'همه جلسات (زوج و فرد)';
  const printDate = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="print-area prof-week-print space-y-5" dir="rtl">
      <style>{'@media print { @page { size: A4 landscape; margin: 8mm 7mm; } }'}</style>
      <div className="prof-week-print-head hidden print:block">
        <div style={{ display: 'flex', alignItems: 'center', gap: '4mm' }}>
          {professor.universityLogoUrl ? (
            <img src={professor.universityLogoUrl} alt="" width={53} height={53} style={{ height: '14mm', width: 'auto', display: 'block' }} />
          ) : null}
          <div>
            <div className="font-extrabold">{professor.universityTitle ? `${professor.universityTitle} — ` : ''}برنامه هفتگی تدریس — {professor.name} (کد پرسنلی {faNum(professor.staffCode)}{professor.academicRank ? ` · ${professor.academicRank}` : ''})</div>
            <div><bdi>{termTitle || 'نیمسال جاری'}</bdi> · {weekFilterLabel} · تاریخ چاپ: <span suppressHydrationWarning>{printDate}</span></div>
          </div>
        </div>
      </div>
      {/* Header Bar */}
      <div className="print:hidden bg-gradient-to-l from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-5 shadow-lg border border-indigo-700/50 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold bg-emerald-400 text-slate-950 print:border print:border-black">
                برنامه آموزشی مصوب
              </span>
              <span className="text-xs text-indigo-200 print:text-slate-700">
                {termTitle || 'نیمسال تحصیلی جاری برای دانشگاه شما تعیین نشده است'}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
              🗓️ برنامه هفتگی تدریس و زمان‌بندی کلاس‌ها
            </h1>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={handlePrint}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/20 transition flex items-center gap-1.5"
            >
              <span>🖨️ چاپ برنامه هفتگی</span>
            </button>
            <Link prefetch={false}
              href="/professor/attendance"
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow transition"
            >
              📋 ثبت حضور و غیاب
            </Link>
            <Link prefetch={false}
              href="/professor/grades"
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow transition"
            >
              📝 بارم‌بندی و ثبت نمرات
            </Link>
          </div>
        </div>

        {/* Professor & Term Info Cards */}
        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/15 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs print:bg-slate-50 print:border-slate-300 print:text-black">
          <div>
            <span className="text-indigo-200 print:text-slate-600 block mb-0.5">نام استاد:</span>
            <span className="font-extrabold text-white print:text-black">{professor.name}</span>
          </div>
          <div>
            <span className="text-indigo-200 print:text-slate-600 block mb-0.5">کد پرسنلی / مرتبه:</span>
            <span className="font-extrabold text-white print:text-black">{faNum(professor.staffCode)} · {professor.academicRank}</span>
          </div>
          <div>
            <span className="text-indigo-200 print:text-slate-600 block mb-0.5">نوع همکاری / گروه:</span>
            <span className="font-extrabold text-white print:text-black">{professor.contractType} · {professor.departmentName}</span>
          </div>
          <div>
            <span className="text-indigo-200 print:text-slate-600 block mb-0.5">مجموع ساعات و واحدها:</span>
            <span className="font-extrabold text-amber-300 print:text-indigo-900">{faNum(totalUnits)} واحد ({faNum(totalClasses)} گروه درسی)</span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:hidden">
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-extrabold text-lg">
            📚
          </div>
          <div>
            <div className="text-xs text-slate-500 font-bold">تعداد کلاس‌های ترم</div>
            <div className="text-lg font-black text-slate-900">{faNum(totalClasses)} گروه درسی</div>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-extrabold text-lg">
            ⚡
          </div>
          <div>
            <div className="text-xs text-slate-500 font-bold">مجموع واحدهای تدریس</div>
            <div className="text-lg font-black text-slate-900">{faNum(totalUnits)} واحد</div>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-extrabold text-lg">
            👥
          </div>
          <div>
            <div className="text-xs text-slate-500 font-bold">تعداد کل دانشجویان</div>
            <div className="text-lg font-black text-slate-900">{faNum(totalStudents)} دانشجو</div>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-extrabold text-lg">
            📅
          </div>
          <div>
            <div className="text-xs text-slate-500 font-bold">روزهای حضور در هفته</div>
            <div className="text-lg font-black text-slate-900">{faNum(daysWithClass)} روز در هفته</div>
          </div>
        </div>
      </div>

      {/* Filter by Week Type */}
      <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-slate-200 shadow-xs print:hidden">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-600">فیلتر نمایش هفته:</span>
          <button
            onClick={() => setSelectedWeekFilter('ALL')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
              selectedWeekFilter === 'ALL' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            همه جلسات (زوج و فرد)
          </button>
          <button
            onClick={() => setSelectedWeekFilter('EVEN')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
              selectedWeekFilter === 'EVEN' ? 'bg-cyan-700 text-white' : 'bg-cyan-50 text-cyan-800 hover:bg-cyan-100'
            }`}
          >
            🔷 فقط هفته‌های زوج
          </button>
          <button
            onClick={() => setSelectedWeekFilter('ODD')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
              selectedWeekFilter === 'ODD' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            🔶 فقط هفته‌های فرد
          </button>
        </div>

        <div className="text-xs text-slate-500 font-medium hidden sm:block">
          🏛️ محل برگزاری هر کلاس از جدول کلاس‌های دانشگاه خوانده می‌شود.
        </div>
      </div>

      {totalClasses === 0 ? (
        <div className="card text-center p-10 space-y-2">
          <div className="text-4xl">📅</div>
          <h2 className="font-extrabold text-slate-800 text-lg">
            {termTitle ? `در نیمسال «${termTitle}» کلاسی برای شما ثبت نشده است` : 'هنوز داده‌ای ثبت نشده است'}
          </h2>
          <p className="text-xs text-slate-500 leading-6">
            در {termTitle ? `نیمسال «${termTitle}»` : 'نیمسال جاری دانشگاه شما'} هیچ درسی به شما تخصیص نیافته است.
            پس از تخصیص درس توسط مدیر گروه، برنامهٔ هفتگی به‌صورت خودکار از جدول زمان‌بندی همین‌جا نمایش داده می‌شود.
          </p>
        </div>
      ) : (
      <>

      {/* Weekly Schedule Grid */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div>
            <h3 className="font-extrabold text-slate-900 text-base">
              جدول هفتگی تشکیل کلاس‌های درسی
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              شامل شماره کلاس فیزیکی، ساختمان و تعداد دانشجویان ثبت‌نامی هر گروه
            </p>
          </div>
        </div>

        {scheduledRows.length === 0 && (
          <div className="text-center p-6 bg-amber-50 rounded-2xl border border-dashed border-amber-300 text-xs font-bold text-amber-900 leading-6">
            {faNum(totalClasses)} کلاس در {termTitle ? `نیمسال «${termTitle}»` : 'نیمسال جاری'} به شما تخصیص یافته است،
            اما هیچ‌کدام ساعت و روزی در جدول زمان‌بندی ندارند؛ بنابراین جدول هفتگی خالی است.
            فهرست دقیق کلاس‌ها در پایین همین صفحه آمده است.
          </div>
        )}

        {scheduledRows.length > 0 && (
          <ProfessorCalendarGrid entries={calendarEntries} orientation="days-rows" />
        )}

        {unscheduled.length > 0 && (
          <div className="print:hidden mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2">
            <h4 className="text-xs font-extrabold text-amber-900">
              کلاس‌های بدون ساعت‌بندی ثبت‌شده ({faNum(uniqueIds(unscheduled))} کلاس)
            </h4>
            <p className="text-2xs text-amber-800 leading-5">
              این کلاس‌ها در نیمسال جاری به شما تخصیص یافته‌اند، اما هنوز روز و ساعتی برایشان
              در جدول زمان‌بندی ثبت نشده است؛ به همین دلیل در جدول بالا دیده نمی‌شوند.
            </p>
            <ul className="space-y-1 text-2xs font-bold text-amber-900">
              {unscheduled.map(o => (
                <li key={`${o.id}-${o.weekType}-unscheduled`}>
                  {o.code} · {o.title} (گروه {faNum(o.groupNumber)} · {faNum(o.units)} واحد)
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>

      {/* Course Offerings List & Quick Links */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4 print:hidden">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <h3 className="font-extrabold text-slate-900 text-base">
            فهرست تفکیکی دروس تخصیص‌یافته به استاد در این نیمسال
          </h3>
          <span className="text-xs text-slate-500 font-bold">
            مجموع {faNum(totalClasses)} کلاس · {faNum(scheduledRows.length)} جلسهٔ زمان‌بندی‌شده
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs rt">
            <thead>
              <tr className="bg-slate-900 text-white text-center">
                <th className="p-2.5 border border-slate-800 w-12">ردیف</th>
                <th className="p-2.5 border border-slate-800">کد درس</th>
                <th className="p-2.5 border border-slate-800">عنوان درس</th>
                <th className="p-2.5 border border-slate-800">گروه</th>
                <th className="p-2.5 border border-slate-800">واحد</th>
                <th className="p-2.5 border border-slate-800">نوع درس</th>
                <th className="p-2.5 border border-slate-800">روز و ساعت</th>
                <th className="p-2.5 border border-slate-800">محل برگزاری (کلاس)</th>
                <th className="p-2.5 border border-slate-800">ثبت‌نامی</th>
                <th className="p-2.5 border border-slate-800">عملیات آموزشی</th>
              </tr>
            </thead>
            <tbody>
              {uniqueOfferings.map((item, idx) => (
                <tr key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="p-2 border border-slate-200 text-center font-bold text-slate-500">{faNum(idx + 1)}</td>
                  <td className="p-2 border border-slate-200 font-mono text-center font-bold text-indigo-900">{item.code}</td>
                  <td className="p-2 border border-slate-200 font-extrabold text-slate-900">
                    <div>{item.title}</div>
                    {item.isCoTaught && (
                      <div className="text-3xs text-purple-700 font-bold">
                        👥 درس مشترک با {item.coPartnerName} ({item.coRole === 'THEORY' ? 'بخش تئوری' : 'بخش عملی'})
                      </div>
                    )}
                  </td>
                  <td className="p-2 border border-slate-200 text-center font-bold">گروه {faNum(item.groupNumber)}</td>
                  <td className="p-2 border border-slate-200 text-center font-bold">{faNum(item.units)}</td>
                  <td className="p-2 border border-slate-200 text-center">
                    <span className={`px-2 py-0.5 rounded font-bold text-3xs ${item.courseType === 'عملی' ? 'bg-amber-100 text-amber-900' : 'bg-blue-100 text-blue-900'}`}>
                      {item.courseType}
                    </span>
                  </td>
                  <td className="p-2 border border-slate-200 font-bold text-slate-800">
                    {item.dayName ? `${item.dayName} ${faNum(item.startTime)} الی ${faNum(item.endTime)}` : 'زمان‌بندی ثبت نشده'}
                    {sessionsOf(item.id) > 1 && (
                      <div className="text-3xs font-normal text-slate-500">
                        {faNum(sessionsOf(item.id))} جلسه در هفته
                      </div>
                    )}
                  </td>
                  <td className="p-2 border border-slate-200 font-extrabold text-emerald-900">
                    {item.roomName ? `🏛️ ${item.roomName}${item.buildingName ? ` (${item.buildingName})` : ''}` : 'ثبت نشده'}
                  </td>
                  <td className="p-2 border border-slate-200 text-center font-bold">
                    {faNum(item.enrolledCount)} / {faNum(item.capacity)}
                  </td>
                  <td className="p-2 border border-slate-200 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <Link prefetch={false}
                        href={`/professor/attendance?offeringId=${item.id}`}
                        className="px-2 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-bold text-3xs transition"
                      >
                        📋 حضور و غیاب
                      </Link>
                      <Link prefetch={false}
                        href={`/professor/grades?offeringId=${item.id}`}
                        className="px-2 py-1 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-900 font-bold text-3xs transition"
                      >
                        📝 ثبت نمره
                      </Link>
                      <Link prefetch={false}
                        href={`/professor/lesson-plan/${item.id}`}
                        className="px-2 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-3xs transition"
                      >
                        📋 طرح درس
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

    </div>
  );
}

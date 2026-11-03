'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadAvailabilityAction, saveAvailabilityAction, type AvailabilityCell } from './actions';
import { DEMO_AVAILABILITY_SUMMARY } from '@/lib/demo-professor-data';
import { buildTimeSlots, DEFAULT_SLOT_CONFIG, type TimeSlot } from '@/lib/time-slots';
import { useToast } from '@/components/ui/Toast';

export type SlotStatus = 'PREF' | 'AVAIL' | 'UNAVAIL';

interface Props {
  demo?: boolean;
  professor: {
    id: number;
    name: string;
    staffCode: string;
    academicRank: string;
    contractType: string;
    departmentName: string;
    maxWeeklyUnits: number;
  };
  terms: {
    id: number;
    code: string;
    title: string;
    isCurrent: boolean;
  }[];
  initialTermId?: number | null;
  /** زنگ‌های آموزشی دانشگاه (از تنظیمات) — اگر نیاید، الگوی پیش‌فرض ۲ ساعته */
  timeSlots?: TimeSlot[];
}

const faNum = (n: any) => (n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

const DAY_NAMES = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

/** فقط برای زمانی که تنظیمات دانشگاه در دسترس نیست — همان الگوی پیش‌فرض سامانه */
const FALLBACK_SLOTS: TimeSlot[] = buildTimeSlots(DEFAULT_SLOT_CONFIG);

export default function ProfessorAvailabilityClient({ demo = false, professor, terms, initialTermId, timeSlots }: Props) {
  /* پیام‌ها از توستِ سراسری (نه alert بومی) تا صفحهٔ ماتریس قفل نشود. */
  const toast = useToast();
  // زنگ‌ها از تنظیمات دانشگاه می‌آیند (۲ ساعته/۱٫۵ ساعته، ۰۷:۰۰ تا ۲۰:۰۰ و …)
  const slots: TimeSlot[] = timeSlots && timeSlots.length > 0 ? timeSlots : FALLBACK_SLOTS;
  const teachingSlots = slots.filter(s => !s.isBreak);
  const slotIds = teachingSlots.map(s => s.id);
  const morningCut = Math.ceil(teachingSlots.length / 2);
  const slotById = new Map(slots.map(s => [s.id, s]));

  const [selectedTermId, setSelectedTermId] = useState<number>(
    initialTermId && terms.some(t => t.id === initialTermId) ? initialTermId : terms[0]?.id || 0,
  );
  const [notes, setNotes] = useState<string>('');
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [loadingAvail, setLoadingAvail] = useState<boolean>(true);
  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ماتریس از پایگاه داده (professor_availability) — هرگز پیش‌فرض UI نیست
  const [availability, setAvailability] = useState<{ [d: number]: { [s: number]: SlotStatus } }>(() => {
    const initial: { [d: number]: { [s: number]: SlotStatus } } = {};
    for (let d = 0; d < 7; d++) {
      initial[d] = {};
      for (const s of slotIds) initial[d][s] = 'AVAIL';
    }
    return initial;
  });

  useEffect(() => {
    if (!selectedTermId) return;
    let cancelled = false;
    setLoadingAvail(true);
    loadAvailabilityAction(selectedTermId).then(res => {
      if (cancelled) return;
      if (res.ok && res.cells) {
        const grid: { [d: number]: { [s: number]: SlotStatus } } = {};
        for (let d = 0; d < 7; d++) {
          grid[d] = {};
          for (const s of slotIds) grid[d][s] = 'AVAIL';
        }
        for (const c of res.cells) {
          if (grid[c.dayIndex]) grid[c.dayIndex][c.slotIndex] = c.status;
        }
        setAvailability(grid);
        setNotes(res.notes ?? '');
        setIsSubmitted(true);
      }
    }).finally(() => { if (!cancelled) setLoadingAvail(false); });
    return () => { cancelled = true; };
  }, [selectedTermId]);

  const toggleSlot = (d: number, s: number) => {
    setAvailability(prev => {
      const current = prev[d]?.[s] || 'AVAIL';
      const next: SlotStatus = current === 'PREF' ? 'AVAIL' : current === 'AVAIL' ? 'UNAVAIL' : 'PREF';
      return {
        ...prev,
        [d]: {
          ...prev[d],
          [s]: next,
        },
      };
    });
  };

  const applyPreset = (preset: 'ALL_PREF' | 'MORNING_ONLY' | 'AFTERNOON_ONLY' | 'EVEN_DAYS' | 'ODD_DAYS' | 'CLEAR') => {
    const updated: { [d: number]: { [s: number]: SlotStatus } } = {};
    for (let d = 0; d < 7; d++) {
      updated[d] = {};
      teachingSlots.forEach((slot, idx) => {
        const s = slot.id;
        if (preset === 'ALL_PREF') updated[d][s] = 'PREF';
        else if (preset === 'CLEAR') updated[d][s] = 'UNAVAIL';
        // «صبح» = نیمهٔ اول زنگ‌های روز، «بعدازظهر» = نیمهٔ دوم (مستقل از تعداد زنگ‌ها)
        else if (preset === 'MORNING_ONLY') updated[d][s] = idx < morningCut ? 'PREF' : 'UNAVAIL';
        else if (preset === 'AFTERNOON_ONLY') updated[d][s] = idx >= morningCut ? 'PREF' : 'UNAVAIL';
        else if (preset === 'EVEN_DAYS') updated[d][s] = (d % 2 === 0) ? 'PREF' : 'UNAVAIL';
        else if (preset === 'ODD_DAYS') updated[d][s] = (d % 2 === 1) ? 'PREF' : 'UNAVAIL';
      });
    }
    setAvailability(updated);
  };

  const handleSubmit = async () => {
    if (!selectedTermId) return;
    setSaving(true);
    const cells: AvailabilityCell[] = [];
    for (let d = 0; d < 7; d++) {
      for (const s of slotIds) {
        const slot = slotById.get(s);
        cells.push({
          dayIndex: d,
          slotIndex: s,
          status: availability[d][s],
          startTime: slot?.startTime,
          endTime: slot?.endTime,
        });
      }
    }
    try {
      const res = await saveAvailabilityAction(selectedTermId, cells, notes);
      if (!res.ok) {
        toast(res.error || 'خطا در ذخیرهٔ ماتریس.', 'error');
        return;
      }
      setIsSubmitted(true);
      setShowSuccessModal(true);
      setToastMessage('✅ ماتریس ساعات حضور شما در پایگاه داده ثبت شد و مبنای زمان‌بندی گروه است.');
      setTimeout(() => setToastMessage(null), 6000);
    } catch {
      toast('خطا در ارتباط با سرور.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const currentTerm = terms.find(t => t.id === selectedTermId) || terms[0];

  if (terms.length === 0) {
    return (
      <div className="space-y-5" dir="rtl">
        <div className="card p-10 text-center space-y-2">
          <div className="text-4xl">🗓️</div>
          <h2 className="text-lg font-bold">هنوز داده‌ای ثبت نشده است</h2>
          <p className="text-sm text-gray-500 leading-7">
            برای دانشگاه شما هیچ نیمسالی تعریف نشده است. پس از ثبت نیمسال‌ها توسط اداره آموزش،
            فرم اعلام ساعات حضور برای همان نیمسال فعال می‌شود.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="p-4 bg-emerald-900 text-emerald-100 rounded-2xl shadow-xl border border-emerald-700 font-bold text-sm flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-3">
            <span className="text-xl">✅</span>
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-white/60 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* اطلاع‌رسانی صادقانه (بدون ادعای نهایی‌سازی ساختگی) */}
      <div className="p-4 bg-gradient-to-r from-sky-900 via-indigo-900 to-blue-900 text-white rounded-2xl shadow-lg border border-sky-600/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full bg-emerald-400 text-slate-950 font-extrabold text-2xs">
              زمان‌بندی کلاس‌ها
            </span>
            <span className="text-xs font-bold text-sky-200">مبنای برنامهٔ هفتگی ترم</span>
          </div>
          <p className="font-extrabold text-sm sm:text-base">
            این ماتریس در پایگاه داده ثبت می‌شود و مدیر گروه هنگام زمان‌بندی دروس به آن استناد می‌کند.
          </p>
          <p className="text-xs text-sky-200">
            برنامهٔ هفتگی نهایی را پس از تأیید گروه از کارتابل خود پیگیری کنید.
          </p>
        </div>
        <Link prefetch={false}
          href="/professor/schedule"
          className="px-4 py-2 rounded-xl bg-white text-indigo-950 font-extrabold text-xs shadow hover:bg-sky-50 transition shrink-0 flex items-center gap-1.5"
        >
          <span>🗓️ برنامه هفتگی تدریس</span>
          <span>←</span>
        </Link>
      </div>

      {/* Header Profile Card */}
      <div className="bg-gradient-to-l from-indigo-950 via-indigo-900 to-slate-900 text-white rounded-2xl p-5 shadow-lg border border-indigo-700/50 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold bg-amber-400 text-slate-950">
                کارتابل اعضای هیئت علمی و اساتید
              </span>
              <span className="text-xs text-indigo-200">فرم اعلام آمادگی تدریس</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
              🗓️ فرم اعلام ساعات حضور، اولویت‌ها و زمان‌بندی تدریس
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <Link prefetch={false} href="/professor/schedule" className="px-3.5 py-2 rounded-xl bg-indigo-700/80 hover:bg-indigo-600 text-white font-bold text-xs border border-indigo-500/50 transition">
              🗓️ برنامه هفتگی من
            </Link>
          </div>
        </div>

        {/* Selected Term & Profile Summary */}
        <div className="bg-white/10 backdrop-blur-md p-3.5 rounded-xl border border-white/15 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="text-indigo-200 font-bold block mb-1">نیمسال تحصیلی مقصد:</label>
            <select
              value={selectedTermId}
              onChange={e => setSelectedTermId(Number(e.target.value))}
              className="w-full bg-slate-900/90 text-white border border-indigo-400/50 rounded-lg px-3 py-1.5 font-bold"
            >
              {terms.map(t => (
                <option key={t.id} value={t.id}>{t.title} {t.isCurrent ? '(نیمسال جاری)' : ''}</option>
              ))}
            </select>
          </div>

          <div>
            <span className="text-indigo-200 font-bold block mb-1">مشخصات استاد:</span>
            <div className="font-extrabold text-white">
              {professor.name}
              {professor.academicRank || professor.contractType || professor.departmentName
                ? ` (${[professor.academicRank, professor.contractType].filter(Boolean).join(' — ')})`
                : ''}
            </div>
            {professor.departmentName && (
              <div className="text-2xs text-indigo-200 mt-0.5">گروه آموزشی: {professor.departmentName}</div>
            )}
          </div>

          <div>
            <span className="text-indigo-200 font-bold block mb-1">سقف موظفی تدریس در ترم:</span>
            <div className="font-extrabold text-amber-300">
              {professor.maxWeeklyUnits > 0
                ? `سقف موظفی: ${faNum(professor.maxWeeklyUnits)} واحد در هفته`
                : 'در قرارداد این ترم ثبت نشده'}
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Availability Matrix */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
          <div>
            <h3 className="font-extrabold text-slate-900 text-base">
              ماتریس اعلام ساعات حضور هفتگی برای {currentTerm?.title}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              روی هر خانه کلیک کنید تا وضعیت آن بین <b>🟩 اولویت اصلی (سبز)</b>، <b>🟨 در صورت نیاز (زرد)</b> و <b>🟥 عدم امکان حضور (قرمز)</b> تغییر کند.
            </p>
          </div>

          {/* Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => applyPreset('ALL_PREF')} className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-900 font-bold text-2xs hover:bg-emerald-200 transition">🟢 حضور کامل</button>
            <button onClick={() => applyPreset('MORNING_ONLY')} className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 font-bold text-2xs hover:bg-amber-200 transition">☀️ فقط صبح‌ها</button>
            <button onClick={() => applyPreset('AFTERNOON_ONLY')} className="px-2.5 py-1 rounded-lg bg-blue-100 text-blue-900 font-bold text-2xs hover:bg-blue-200 transition">🌆 فقط بعدازظهرها</button>
            <button onClick={() => applyPreset('EVEN_DAYS')} className="px-2.5 py-1 rounded-lg bg-purple-100 text-purple-900 font-bold text-2xs hover:bg-purple-200 transition">📅 روزهای زوج</button>
            <button onClick={() => applyPreset('CLEAR')} className="px-2.5 py-1 rounded-lg bg-rose-100 text-rose-900 font-bold text-2xs hover:bg-rose-200 transition">🔴 مسدودسازی</button>
          </div>
        </div>

        {/* Matrix Grid */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs rt">
            <thead>
              <tr className="bg-slate-900 text-white text-center">
                <th className="p-3 border border-slate-800 w-28 font-extrabold">روز هفته</th>
                {slots.map(slot => (
                  <th key={slot.id} className="p-3 border border-slate-800 font-extrabold">
                    <div>{slot.label}</div>
                    <div className="text-3xs text-slate-300 font-normal mt-0.5">{slot.startTime} الی {slot.endTime}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAY_NAMES.map((dayName, dayIdx) => (
                <tr key={dayIdx} className={dayIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="p-3 border border-slate-200 font-extrabold text-center bg-slate-100 text-slate-900">
                    {dayName}
                  </td>
                  {slots.map(slot => {
                    if (slot.isBreak) {
                      return (
                        <td key={slot.id} className="p-2 border border-slate-200 bg-slate-100 text-slate-400 text-center font-bold text-3xs">
                          نماز و استراحت
                        </td>
                      );
                    }

                    const status = availability[dayIdx]?.[slot.id] || 'AVAIL';

                    return (
                      <td
                        key={slot.id}
                        onClick={() => toggleSlot(dayIdx, slot.id)}
                        className="p-2 border border-slate-200 cursor-pointer select-none transition hover:opacity-90"
                      >
                        <div className={`p-3 rounded-xl text-center font-extrabold text-xs transition border flex flex-col items-center justify-center gap-0.5 shadow-xs ${
                          status === 'PREF'
                            ? 'bg-emerald-600 text-white border-emerald-700 shadow-emerald-200'
                            : status === 'AVAIL'
                            ? 'bg-amber-100 text-amber-900 border-amber-300'
                            : 'bg-rose-100 text-rose-900 border-rose-300'
                        }`}>
                          <span>{status === 'PREF' ? '🟩 اولویت اصلی' : status === 'AVAIL' ? '🟨 در صورت لزوم' : '🟥 عدم حضور'}</span>
                          <span className="text-[9px] opacity-80">
                            {status === 'PREF' ? 'اولویت تدریس' : status === 'AVAIL' ? 'ساعت آزاد' : 'خارج از دانشگاه'}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Remarks & Notes */}
        <div className="space-y-2 pt-3 border-t border-slate-200">
          <label className="font-bold text-slate-700 text-xs block">
            توضیحات و درخواست‌های تکمیلی خطاب به مدیر گروه آموزشی:
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="مثال: روزهای سه‌شنبه به علت طرح پژوهشی خارج از دانشگاه هستم؛ کلاس‌های عملی بعدازظهر باشند..."
            className="w-full border border-slate-300 rounded-xl p-3 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Submit Bar */}
        <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          {loadingAvail && <span className="text-2xs text-slate-400 font-bold">در حال بارگذاری ماتریس از سرور…</span>}
          <div className="flex items-center gap-3 text-xs text-slate-600 font-bold">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-600"></span> اولویت اصلی</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-200 border border-amber-400"></span> قابل حضور</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-200 border border-rose-400"></span> عدم امکان حضور</span>
          </div>

          <button
            onClick={handleSubmit}
            disabled={saving || loadingAvail || !selectedTermId}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-800 hover:to-emerald-900 text-white font-extrabold text-xs shadow-lg flex items-center gap-2 transition disabled:opacity-50"
          >
            <span>{saving ? 'در حال ذخیره…' : '🚀 ثبت ماتریس ساعات حضور (پایگاه داده)'}</span>
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 animate-scaleUp text-slate-900">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-800 rounded-2xl flex items-center justify-center text-3xl mx-auto">
              ✓
            </div>
            <div className="text-center space-y-1">
              <h3 className="font-extrabold text-lg text-slate-900">
                فرم حضور شما با موفقیت ثبت شد
              </h3>
              <p className="text-xs text-slate-600 leading-5">
                ساعات اولویت و عدم حضور شما برای <b>{currentTerm?.title}</b> در دیتابیس ثبت و جهت زمان‌بندی هوشمند دروس به کارتابل مدیر گروه آموزشی ارسال گردید.
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-1.5">
              {demo ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{DEMO_AVAILABILITY_SUMMARY.trackingCodeLabel}</span>
                    <span className="font-mono font-bold text-slate-800">{DEMO_AVAILABILITY_SUMMARY.trackingCode}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{DEMO_AVAILABILITY_SUMMARY.processStatusLabel}</span>
                    <span className="font-bold text-emerald-700">{DEMO_AVAILABILITY_SUMMARY.processStatus}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{DEMO_AVAILABILITY_SUMMARY.nextNoticeLabel}</span>
                    <span className="font-bold text-indigo-700">{DEMO_AVAILABILITY_SUMMARY.nextNotice}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">نیمسال ثبت‌شده:</span>
                    <span className="font-bold text-slate-800">{currentTerm?.title}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">بازه‌های ثبت‌شده:</span>
                    <span className="font-bold text-emerald-700">
                      {faNum(Object.values(availability).reduce((s, row) => s + Object.values(row).filter(v => v !== 'UNAVAIL').length, 0))}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Link prefetch={false}
                href="/professor/schedule"
                className="flex-1 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs text-center transition"
              >
                مشاهده برنامه هفتگی من
              </Link>
              <button
                onClick={() => setShowSuccessModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs transition"
              >
                بستن و بازگشت
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

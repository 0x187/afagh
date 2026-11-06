'use client';

// ════════════════════════════════════════════════════════════════════════
// فاز ۸ (گام ۵ نقشهٔ ۱۰ گامی) — Thin Client صفحهٔ اداری امتحانات
// ────────────────────────────────────────────────────────────────────────
// هیچ دادهٔ Mock نیست: سشن‌ها (exam_sessions)، دروس امتحانی (schedules
// با type=EXAM)، سالن‌ها (exam_halls)، مراقبین (invigilators) و بسته‌های
// اوراق (course_exam_sessions) همگی از Server Action خوانده می‌شوند و
// عملیات (صدور حضور و غیاب/صورت‌جلسه/تحویل) از موتور exam-engine است.
// ════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback } from 'react';
import {
  getExamWorkspaceAction, issueExamAttendanceAction,
  getExamPlanningAction, upsertExamZoningAction, scheduleExamSlotAction,
  scheduleUnifiedClusterAction, suggestExamSlotsAction, generateSeatAllocationsAction,
} from './actions';
import { examProctorClockInAction, examChainOverviewAction } from '@/lib/exam-actions';
import { jalaliDateOf, parseJalaliDate } from '@/lib/scheduling-core';
import MobileCardList, { type CardColumn } from '@/components/MobileCardList';

const faNum = (n: any) => (n === null || n === undefined || n === '' ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

export interface ExamWorkspace {
  terms: { id: number; code: string; title: string; isCurrent: boolean }[];
  selectedTermId: number | null;
  sessions: {
    id: number; examDate: string; startTime: string; endTime: string;
    proctors: { staffId: number; name: string; hallId: number; role: string; attendanceStatus: string }[];
    attendance: { present: number; total: number };
  }[];
  courses: {
    offeringId: number; courseCode: string; courseTitle: string; units: string;
    groupNumber: number; professorId: number | null; professorName: string;
    examDate: string | null; startTime: string; endTime: string;
    roomName: string; buildingName: string;
    expectedSheets: number; deliveredSheets: number; isFullyCollected: boolean;
  }[];
  halls: { id: number; name: string; buildingName: string | null; totalCapacity: number; rowsCount: number | null; colsCount: number | null }[];
  concurrentCount: number;
  orphanSessionCount: number;
}

const ROLE_LABELS: Record<string, string> = {
  HEAD_INVIGILATOR: 'مراقب ارشد', INVIGILATOR: 'مراقب', TECHNICAL_SUPPORT: 'پشتیبانی فنی',
  PROCTOR: 'مراقب', HALL_SUPERVISOR: 'ناظر سالن', EXAM_LIAISON: 'هماهنگ‌کننده', PRINTING_OFFICER: 'مسئول چاپ',
};

const ATT_LABELS: Record<string, { label: string; cls: string }> = {
  PRESENT: { label: 'حاضر', cls: 'bg-emerald-100 text-emerald-800' },
  ABSENT: { label: 'غایب', cls: 'bg-rose-100 text-rose-800' },
  LATE: { label: 'تأخیر', cls: 'bg-amber-100 text-amber-800' },
  PENDING: { label: 'در انتظار', cls: 'bg-slate-100 text-slate-600' },
};

type ExamCourse = ExamWorkspace['courses'][number];

const examCourseColumns: CardColumn<ExamCourse>[] = [
  { key: 'courseTitle', label: 'عنوان', title: true },
  { key: 'courseCode', label: 'کد درس', subtitle: true },
  { key: 'groupNumber', label: 'گروه', render: (c) => faNum(c.groupNumber) },
  { key: 'professorName', label: 'استاد', render: (c) => c.professorName || '—' },
  {
    key: 'examDate',
    label: 'تاریخ / ساعت',
    render: (c) =>
      c.examDate ? `${faNum(c.examDate)} — ${faNum(c.startTime)} تا ${faNum(c.endTime)}` : '—',
  },
  {
    key: 'room',
    label: 'سالن',
    render: (c) => `${c.roomName}${c.buildingName ? ` (${c.buildingName})` : ''}`,
  },
  {
    key: 'sheets',
    label: 'بستهٔ اوراق',
    bare: true,
    render: (c) =>
      c.expectedSheets === 0 && c.deliveredSheets === 0 ? (
        <span className="text-slate-400 font-bold">بسته ثبت نشده</span>
      ) : (
        <span
          className={`px-2 py-0.5 rounded-full text-3xs font-black ${
            c.isFullyCollected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {faNum(c.deliveredSheets)} از {faNum(c.expectedSheets)} برگه{' '}
          {c.isFullyCollected ? '✓ جمع‌آوری کامل' : 'در جریان'}
        </span>
      ),
  },
];

type ExamTab = 'SCHEDULE_TABLE' | 'EXAM_COURSES' | 'EXAM_HALLS' | 'PROCTORS' | 'CONFLICT_CHECKER' | 'PLANNING';

function addHours(start: string): string {
  const [h, m] = start.split(':').map(Number);
  const tot = (h ?? 8) * 60 + (m ?? 0) + 120;
  return `${String(Math.floor(tot / 60) % 24).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' میلادی → 'YYYY/MM/DD' شمسی (ورودی date input) */
function isoToJalali(v: string): string {
  if (!v) return '';
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return '';
  return jalaliDateOf(new Date(y, m - 1, d));
}

/** 'YYYY/MM/DD' شمسی → 'YYYY-MM-DD' میلادی (برای نمایش در date input) */
function jalaliToIso(v: string): string {
  if (!v) return '';
  try {
    const d = parseJalaliDate(v);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export default function ExamPlanningClient({ initial, universityId }: { initial: ExamWorkspace; universityId?: number }) {
  const [terms, setTerms] = useState(initial.terms);
  const [selectedTermId, setSelectedTermId] = useState<number>(initial.selectedTermId ?? 0);
  const [sessions, setSessions] = useState(initial.sessions);
  const [courses, setCourses] = useState(initial.courses);
  const [halls, setHalls] = useState(initial.halls);
  const [concurrentCount, setConcurrentCount] = useState(initial.concurrentCount);
  const [activeTab, setActiveTab] = useState<ExamTab>('SCHEDULE_TABLE');
  const [isLoading, setIsLoading] = useState(false);
  const [busySessionId, setBusySessionId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // ── فاز ۹: کارتابل برنامه‌ریزی امتحانات ──
  const [planning, setPlanning] = useState<{
    zoning: { globalStart: string; globalEnd: string; generalStart: string; generalEnd: string; specializedStart: string; specializedEnd: string } | null;
    radar: { examDate: string; startTime: string; endTime: string; booked: number; available: number; status: string; usagePercent: number; splitOptions: { label: string }[] }[];
    clusters: { clusterId: number; clusterTitle: string; courseCount: number; demand: number; scheduledSlot: { examDate: string; startTime: string; endTime: string } | null }[];
    totalCapacity: number;
  } | null>(null);
  const [zoneForm, setZoneForm] = useState<{ globalStart: string; globalEnd: string; generalStart: string; generalEnd: string; specializedStart: string; specializedEnd: string }>({
    globalStart: '', globalEnd: '', generalStart: '', generalEnd: '', specializedStart: '', specializedEnd: '',
  });
  const [slotDraft, setSlotDraft] = useState<Record<number, { date: string; start: string }>>({});
  const [suggestions, setSuggestions] = useState<Record<number, { examDate: string; startTime: string; endTime: string; score: number; reasons: string[] }[]>>({});
  const [clusterDraft, setClusterDraft] = useState<Record<number, { date: string; start: string }>>({});
  const [busyPlanning, setBusyPlanning] = useState(false);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4200);
  };

  const currentTerm = terms.find(t => t.id === selectedTermId) ?? terms[0];

  const reload = useCallback(async (termId: number) => {
    setIsLoading(true);
    try {
      const w = await getExamWorkspaceAction(termId, universityId);
      if (!w.ok) { showToast(w.error, 'error'); return; }
      setTerms(w.data.terms);
      setSessions(w.data.sessions);
      setCourses(w.data.courses);
      setHalls(w.data.halls);
      setConcurrentCount(w.data.concurrentCount);
    } finally {
      setIsLoading(false);
    }
  }, [universityId]);

  const reloadPlanning = useCallback(async (termId: number) => {
    const w = await getExamPlanningAction(termId, universityId);
    if (!w.ok) { showToast(w.error, 'error'); return; }
    setPlanning(w.data);
    if (w.data.zoning) {
      const z = w.data.zoning;
      setZoneForm({
        globalStart: jalaliToIso(z.globalStart), globalEnd: jalaliToIso(z.globalEnd),
        generalStart: jalaliToIso(z.generalStart), generalEnd: jalaliToIso(z.generalEnd),
        specializedStart: jalaliToIso(z.specializedStart), specializedEnd: jalaliToIso(z.specializedEnd),
      });
    }
  }, [showToast]);

  // بارگذاری اولیهٔ کارتابل برنامه‌ریزی (فاز ۹)
  useEffect(() => {
    reloadPlanning(initial.selectedTermId ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // تغییر نیمسال → بارگذاری مجدد واقعی
  useEffect(() => {
    if (selectedTermId === (initial.selectedTermId ?? 0)) return;
    reload(selectedTermId);
    reloadPlanning(selectedTermId);
  }, [selectedTermId, initial.selectedTermId, reload, reloadPlanning]);

  /** صدور حضور و غیاب واقعی یک سشن از موتور */
  const handleIssueAttendance = async (sessionId: number) => {
    setBusySessionId(sessionId);
    try {
      const r = await issueExamAttendanceAction(sessionId);
      if (!r.ok) { showToast(r.error, 'error'); return; }
      showToast(`حضور و غیاب سشن ${faNum(sessionId)} صادر شد (${faNum(r.issued)} نفر).`, 'success');
      reload(selectedTermId);
    } finally {
      setBusySessionId(null);
    }
  };

  const sessionsWithConflict = useCallback(() => {
    const byKey = new Map<string, typeof courses>();
    for (const c of courses) {
      if (!c.examDate || !c.startTime) continue;
      const k = `${c.examDate}|${c.startTime}`;
      byKey.set(k, [...(byKey.get(k) ?? []), c]);
    }
    return Array.from(byKey.entries()).filter(([, v]) => v.length > 1);
  }, [courses]);

  // ── فاز ۹ هندلرها ──
  const handleSaveZoning = async () => {
    setBusyPlanning(true);
    try {
      const zJalali = {
        globalStart: isoToJalali(zoneForm.globalStart), globalEnd: isoToJalali(zoneForm.globalEnd),
        generalStart: isoToJalali(zoneForm.generalStart), generalEnd: isoToJalali(zoneForm.generalEnd),
        specializedStart: isoToJalali(zoneForm.specializedStart), specializedEnd: isoToJalali(zoneForm.specializedEnd),
      };
      const r = await upsertExamZoningAction(selectedTermId, zJalali, universityId);
      showToast(r.ok ? r.message : r.error ?? 'خطا', r.ok ? 'success' : 'error');
      if (r.ok) reloadPlanning(selectedTermId);
    } finally { setBusyPlanning(false); }
  };

  const handleSuggestSlots = async (offeringId: number) => {
    const r = await suggestExamSlotsAction(selectedTermId, offeringId, universityId);
    if (!r.ok) { showToast(r.error, 'error'); return; }
    setSuggestions(prev => ({ ...prev, [offeringId]: r.data }));
  };

  const handleScheduleSlot = async (offeringId: number, code: string) => {
    const d = slotDraft[offeringId];
    if (!d?.date || !d?.start) { showToast('تاریخ و ساعت شروع را وارد کنید.', 'error'); return; }
    const end = addHours(d.start);
    setBusyPlanning(true);
    try {
      const r = await scheduleExamSlotAction({ termId: selectedTermId, offeringId, examDate: isoToJalali(d.date), startTime: d.start, endTime: end, universityId });
      showToast(r.ok ? r.message : r.error, r.ok ? 'success' : 'error');
      if (!r.ok && r.status === 'OVERFLOW' && r.splitOptions?.length) {
        showToast(`💡 ${r.splitOptions.map(o => o.label).join(' یا ')}`, 'error');
      }
      if (r.ok) { reload(selectedTermId); reloadPlanning(selectedTermId); }
    } finally { setBusyPlanning(false); }
    void code;
  };

  const handleUnifiedCluster = async (clusterId: number, title: string) => {
    const d = clusterDraft[clusterId];
    if (!d?.date || !d?.start) { showToast('تاریخ و ساعت شروع امتحان تجمیعی را وارد کنید.', 'error'); return; }
    setBusyPlanning(true);
    try {
      const r = await scheduleUnifiedClusterAction({ termId: selectedTermId, clusterId, examDate: isoToJalali(d.date), startTime: d.start, endTime: addHours(d.start), universityId });
      showToast(r.ok ? r.message : r.error, r.ok ? 'success' : 'error');
      if (r.ok) { reload(selectedTermId); reloadPlanning(selectedTermId); }
    } finally { setBusyPlanning(false); }
    void title;
  };

  const handleGenerateSeats = async () => {
    setBusyPlanning(true);
    try {
      const r = await generateSeatAllocationsAction(selectedTermId, universityId);
      showToast(r.ok ? r.message : r.error ?? 'خطا', r.ok ? 'success' : 'error');
      if (r.ok) reload(selectedTermId);
    } finally { setBusyPlanning(false); }
  };

  const handleProctorClockIn = async (sessionId: number) => {
    const r = await examProctorClockInAction(sessionId);
    showToast(r.ok ? 'مراقبین سشن وارد شدند.' : r.error ?? 'خطا', r.ok ? 'success' : 'error');
    if (r.ok) reload(selectedTermId);
  };

  const handleChainOverview = async (sessionId: number) => {
    const r = await examChainOverviewAction({ sessionId });
    if (!r.ok) { showToast(r.error ?? 'خطا', 'error'); return; }
    // نتیجهٔ کامل زنجیره (حضور/صورت‌جلسه/بسته‌ها/تحویل/اعتراض) — بدون کلید اضافی
    showToast('زنجیرهٔ تحویل: ' + JSON.stringify(r), 'success');
  };

  const tabs: { id: ExamTab; label: string; badge: string }[] = [
    { id: 'SCHEDULE_TABLE', label: '📅 جدول سشن‌های امتحان', badge: `${faNum(sessions.length)} سشن` },
    { id: 'EXAM_COURSES', label: '📖 دروس امتحانی و بستهٔ اوراق', badge: `${faNum(courses.length)} درس` },
    { id: 'EXAM_HALLS', label: '🏛️ سالن‌های امتحان', badge: `${faNum(halls.length)} سالن` },
    { id: 'PROCTORS', label: '🧑‍🏫 مراقبین جلسات', badge: `${faNum(sessions.reduce((s, x) => s + x.proctors.length, 0))} نفر` },
    { id: 'CONFLICT_CHECKER', label: '⚠️ بررسی سشن‌های هم‌زمان', badge: concurrentCount > 0 ? `${faNum(concurrentCount)} گروه` : 'پاک' },
    { id: 'PLANNING', label: '🗓️ برنامه‌ریزی امتحانات', badge: planning?.radar.length ? `${faNum(planning.radar.length)} شیفت` : '—' },
  ];

  return (
    <div className="min-h-screen bg-sky-50/70 text-slate-800 p-3 sm:p-6 space-y-5" dir="rtl">
      {toast && (
        <div className={`fixed top-4 left-4 right-4 sm:right-auto sm:left-6 z-50 p-4 rounded-xl shadow-2xl border text-sm font-bold ${
          toast.type === 'success' ? 'bg-emerald-900 text-emerald-100 border-emerald-700' : 'bg-rose-900 text-rose-100 border-rose-700'
        }`}>
          {toast.type === 'success' ? '✅' : '⚠️'} {toast.text}
        </div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-l from-indigo-950 via-indigo-900 to-slate-900 text-white rounded-2xl p-5 shadow-lg border border-indigo-700/50 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold bg-amber-400 text-slate-950">ماژول امتحانات — اداره آموزش</span>
              <span className="text-xs text-indigo-200">{currentTerm?.title}{isLoading ? ' — در حال بارگذاری…' : ''}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">📝 کارتابل یکپارچهٔ مدیریت و تخصیص امتحانات</h1>
          </div>
          <label className="text-xs font-bold text-indigo-200 block">
            نیمسال تحصیلی:
            <select
              value={selectedTermId}
              onChange={e => setSelectedTermId(Number(e.target.value))}
              className="mt-1 w-full sm:w-64 bg-slate-900/90 text-white border border-indigo-400/50 rounded-lg px-2.5 py-2 font-bold"
            >
              {terms.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>
        </div>
        <p className="text-2xs text-indigo-200 leading-relaxed bg-white/5 rounded-xl p-3 border border-white/10">
          منبع داده: جدول‌های واقعی <b>exam_sessions</b> (سشن‌های ترم)، <b>schedules</b> با نوع EXAM (درس‌های امتحانی)،
          <b> exam_halls</b> و <b>invigilators</b>؛ عملیات صدور حضور/صورت‌جلسه/تحویل از موتور exam-engine با زنجیرهٔ حسابرسی.
        </p>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-2 flex flex-wrap gap-2">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition ${
              activeTab === t.id ? 'bg-indigo-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>{t.label}</span>
            <span className={`px-1.5 py-0.5 rounded-full text-3xs font-bold ${
              activeTab === t.id ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-700'
            }`}>{t.badge}</span>
          </button>
        ))}
      </div>

      {/* ── تب ۱: جدول سشن‌ها ── */}
      {activeTab === 'SCHEDULE_TABLE' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
          <h3 className="font-extrabold text-slate-900 text-sm">📅 سشن‌های امتحان این نیمسال</h3>
          {sessions.length === 0 && (
            <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs font-bold text-slate-500">
              برای این نیمسال هیچ سشن امتحانی در exam_sessions ثبت نشده است.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs rt">
              <thead>
                <tr className="bg-slate-900 text-white text-center">
                  <th className="p-2.5 border border-slate-800">سشن</th>
                  <th className="p-2.5 border border-slate-800">تاریخ</th>
                  <th className="p-2.5 border border-slate-800">ساعت</th>
                  <th className="p-2.5 border border-slate-800">مراقبین</th>
                  <th className="p-2.5 border border-slate-800">حضور و غیاب ثبت‌شده</th>
                  <th className="p-2.5 border border-slate-800">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s, idx) => (
                  <tr key={s.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                    <td className="p-2.5 border border-slate-200 text-center font-black text-indigo-900">{faNum(idx + 1)}</td>
                    <td className="p-2.5 border border-slate-200 text-center font-bold">{faNum(s.examDate)}</td>
                    <td className="p-2.5 border border-slate-200 text-center font-mono font-bold">{faNum(s.startTime)} تا {faNum(s.endTime)}</td>
                    <td className="p-2.5 border border-slate-200">
                      {s.proctors.length === 0 ? (
                        <span className="text-slate-400 font-bold">تخصیص داده نشده</span>
                      ) : (
                        <div className="space-y-0.5">
                          {s.proctors.map((p, i) => (
                            <div key={i} className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-800">{p.name}</span>
                              <span className="text-3xs text-slate-500">{(ATT_LABELS[p.attendanceStatus] ?? ATT_LABELS.PENDING).label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="p-2.5 border border-slate-200 text-center font-extrabold">
                      {s.attendance.total > 0 ? `${faNum(s.attendance.present)} حاضر از ${faNum(s.attendance.total)}` : 'هنوز صادر نشده'}
                    </td>
                    <td className="p-2.5 border border-slate-200 text-center">
                      <button
                        onClick={() => handleIssueAttendance(s.id)}
                        disabled={busySessionId === s.id}
                        className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-2xs disabled:opacity-50"
                      >
                        {busySessionId === s.id ? '⏳…' : '📤 صدور حضور و غیاب'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── تب ۲: دروس امتحانی ── */}
      {activeTab === 'EXAM_COURSES' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
          <h3 className="font-extrabold text-slate-900 text-sm">📖 دروس دارای برنامهٔ امتحان (schedules نوع EXAM)</h3>
          {courses.length === 0 && (
            <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs font-bold text-slate-500">
              هیچ درس امتحانی در این نیمسال ثبت نشده است.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="hidden md:table w-full border-collapse text-xs rt">
              <thead>
                <tr className="bg-slate-900 text-white text-center">
                  <th className="p-2.5 border border-slate-800">کد درس</th>
                  <th className="p-2.5 border border-slate-800">عنوان</th>
                  <th className="p-2.5 border border-slate-800">گروه</th>
                  <th className="p-2.5 border border-slate-800">استاد</th>
                  <th className="p-2.5 border border-slate-800">تاریخ / ساعت</th>
                  <th className="p-2.5 border border-slate-800">سالن</th>
                  <th className="p-2.5 border border-slate-800">بستهٔ اوراق</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((c, idx) => (
                  <tr key={c.offeringId} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                    <td className="p-2.5 border border-slate-200 font-mono text-center font-bold text-indigo-900">{c.courseCode}</td>
                    <td className="p-2.5 border border-slate-200 font-extrabold text-right">{c.courseTitle}</td>
                    <td className="p-2.5 border border-slate-200 text-center font-bold">{faNum(c.groupNumber)}</td>
                    <td className="p-2.5 border border-slate-200 font-bold">{c.professorName}</td>
                    <td className="p-2.5 border border-slate-200 text-center font-mono font-bold">
                      {c.examDate ? `${faNum(c.examDate)} — ${faNum(c.startTime)} تا ${faNum(c.endTime)}` : '—'}
                    </td>
                    <td className="p-2.5 border border-slate-200 text-center font-bold">{c.roomName} <span className="text-3xs text-slate-400">({c.buildingName})</span></td>
                    <td className="p-2.5 border border-slate-200 text-center">
                      {c.expectedSheets === 0 && c.deliveredSheets === 0 ? (
                        <span className="text-slate-400 font-bold">بسته ثبت نشده</span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-3xs font-black ${
                          c.isFullyCollected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {faNum(c.deliveredSheets)} از {faNum(c.expectedSheets)} برگه {c.isFullyCollected ? '✓ جمع‌آوری کامل' : 'در جریان'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <MobileCardList
              rows={courses}
              columns={examCourseColumns}
              getKey={(c) => c.offeringId}
              empty={<div>موردی یافت نشد.</div>}
            />
          </div>
        </div>
      )}

      {/* ── تب ۳: سالن‌ها ── */}
      {activeTab === 'EXAM_HALLS' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
          <h3 className="font-extrabold text-slate-900 text-sm">🏛️ سالن‌های امتحان دانشگاه (exam_halls)</h3>
          {halls.length === 0 && (
            <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs font-bold text-slate-500">
              هیچ سالن امتحانی ثبت نشده است.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {halls.map(h => (
              <div key={h.id} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 space-y-1.5">
                <div className="flex items-center justify-between">
                  <h4 className="font-extrabold text-slate-900 text-sm">{h.name}</h4>
                  <span className="text-3xs font-black px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900">
                    ظرفیت {faNum(h.totalCapacity)}
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-bold">{h.buildingName ?? '—'}</p>
                {h.rowsCount && h.colsCount && (
                  <p className="text-2xs text-slate-600 font-bold">چیدمان: {faNum(h.rowsCount)} ردیف × {faNum(h.colsCount)} ستون</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── تب ۴: مراقبین ── */}
      {activeTab === 'PROCTORS' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
          <h3 className="font-extrabold text-slate-900 text-sm">🧑‍🏫 تخصیص مراقبین به سشن‌ها (invigilators)</h3>
          {sessions.every(s => s.proctors.length === 0) && (
            <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs font-bold text-slate-500">
              هیچ مراقبی به سشن‌های این نیمسال تخصیص نیافته است.
            </div>
          )}
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} className="p-3.5 rounded-xl border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-black text-slate-900 text-xs">سشن {faNum(s.id)} — {faNum(s.examDate)} ({faNum(s.startTime)} تا {faNum(s.endTime)})</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-3xs font-bold text-slate-500">{faNum(s.proctors.length)} مراقب</span>
                    <button
                      onClick={() => handleProctorClockIn(s.id)}
                      disabled={busySessionId === s.id}
                      className="px-2.5 py-1 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-3xs disabled:opacity-50"
                    >
                      🕐 ورود مراقبین
                    </button>
                    <button
                      onClick={() => handleChainOverview(s.id)}
                      disabled={busySessionId === s.id}
                      className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-800 text-white font-extrabold text-3xs disabled:opacity-50"
                    >
                      🔗 زنجیرهٔ تحویل
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {s.proctors.map((p, i) => (
                    <span key={i} className={`px-2.5 py-1 rounded-full text-3xs font-bold ${(ATT_LABELS[p.attendanceStatus] ?? ATT_LABELS.PENDING).cls}`}>
                      {p.name} — {ROLE_LABELS[p.role] ?? p.role}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── تب ۵: سشن‌های هم‌زمان ── */}
      {activeTab === 'CONFLICT_CHECKER' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
          <h3 className="font-extrabold text-slate-900 text-sm">⚠️ بررسی سشن‌های هم‌زمان (تداخل زمانی)</h3>
          {(() => {
            const groups = sessionsWithConflict();
            if (groups.length === 0) {
              return (
                <div className="p-6 rounded-xl bg-emerald-50 border border-emerald-200 text-center text-xs font-bold text-emerald-800">
                  هیچ دو درسی در یک تاریخ و ساعت شروع واحد نیستند. ✓
                </div>
              );
            }
            return (
              <div className="space-y-2">
                {groups.map(([key, list]) => (
                  <div key={key} className="p-3.5 rounded-xl border border-amber-300 bg-amber-50/60 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-amber-900 text-xs">⏱️ {faNum(list[0].examDate)} ساعت {faNum(list[0].startTime)}</span>
                      <span className="text-3xs font-bold text-amber-700">{faNum(list.length)} درس هم‌زمان</span>
                    </div>
                    {list.map(c => (
                      <div key={c.offeringId} className="text-2xs font-bold text-slate-700">
                        {c.courseCode} — {c.courseTitle} (گروه {faNum(c.groupNumber)}) · {c.professorName}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── تب ۶: برنامه‌ریزی امتحانات (فاز ۹) + تخصیص صندلی (فاز ۱۰) ── */}
      {activeTab === 'PLANNING' && (
        <div className="space-y-5">
          {/* زون‌بندی */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-extrabold text-slate-900 text-sm">📆 زون‌بندی تقویم امتحانات (قانون ۱–۳: ارشد = کل ۳ هفته؛ عمومی = هفتهٔ اول؛ تخصصی = هفتهٔ ۲ و ۳)</h3>
              <button
                onClick={handleGenerateSeats}
                disabled={busyPlanning}
                className="px-3 py-2 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-extrabold text-2xs disabled:opacity-50"
              >
                🪑 تخصیص صندلی همهٔ سشن‌ها (فاز ۱۰)
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              {([['globalStart', 'شروع کل (۳ هفته)'], ['globalEnd', 'پایان کل'], ['generalStart', 'شروع هفتهٔ اول (عمومی)'], ['generalEnd', 'پایان هفتهٔ اول'], ['specializedStart', 'شروع هفتهٔ دوم (تخصصی)'], ['specializedEnd', 'پایان هفتهٔ سوم']] as const).map(([k, label]) => (
                <label key={k} className="block font-bold text-slate-700">
                  {label}:
                  <input
                    type="date"
                    value={zoneForm[k]}
                    onChange={e => setZoneForm({ ...zoneForm, [k]: e.target.value })}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold text-left"
                    dir="ltr"
                  />
                </label>
              ))}
              <div className="flex items-end">
                <button
                  onClick={handleSaveZoning}
                  disabled={busyPlanning}
                  className="w-full px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs disabled:opacity-50"
                >
                  💾 ذخیرهٔ بازه‌ها
                </button>
              </div>
            </div>
          </div>

          {/* رادار ظرفیت */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
            <h3 className="font-extrabold text-slate-900 text-sm">📡 رادار ظرفیت امتحانی — تقاضا در برابر {faNum(planning?.totalCapacity ?? 0)} صندلی سالن‌ها</h3>
            {!planning || planning.radar.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs font-bold text-slate-500">
                هنوز شیفت امتحانی رزرو نشده است.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs rt">
                  <thead>
                    <tr className="bg-slate-900 text-white text-center">
                      <th className="p-2.5 border border-slate-800">تاریخ</th>
                      <th className="p-2.5 border border-slate-800">شیفت</th>
                      <th className="p-2.5 border border-slate-800">تقاضا</th>
                      <th className="p-2.5 border border-slate-800">ظرفیت خالی</th>
                      <th className="p-2.5 border border-slate-800">اشغال</th>
                      <th className="p-2.5 border border-slate-800">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planning.radar.map((r, i) => (
                      <tr key={i} className={r.status === 'OVERFLOW' ? 'bg-rose-50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                        <td className="p-2.5 border border-slate-200 text-center font-black">{faNum(r.examDate)}</td>
                        <td className="p-2.5 border border-slate-200 text-center font-mono font-bold">{faNum(r.startTime)} تا {faNum(r.endTime)}</td>
                        <td className="p-2.5 border border-slate-200 text-center font-extrabold">{faNum(r.booked)}</td>
                        <td className="p-2.5 border border-slate-200 text-center font-bold">{faNum(Math.max(r.available - r.booked, 0))}</td>
                        <td className="p-2.5 border border-slate-200 text-center">
                          <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                            <div className={`h-full ${r.status === 'OVERFLOW' ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(r.usagePercent, 100)}%` }} />
                          </div>
                          <span className="text-3xs font-bold text-slate-500">{faNum(r.usagePercent)}٪</span>
                        </td>
                        <td className="p-2.5 border border-slate-200 text-center">
                          {r.status === 'OVERFLOW' ? (
                            <span className="text-3xs font-black text-rose-700">
                              🔴 سرریز — {r.splitOptions.length > 0 ? r.splitOptions.map(o => o.label).join(' / ') : 'شیفت‌بندی دستی لازم است'}
                            </span>
                          ) : (
                            <span className="text-3xs font-black text-emerald-700">🟢 ظرفیت کافی</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* رزرو شیفت دروس + پیشنهاد هوشمند */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
            <h3 className="font-extrabold text-slate-900 text-sm">🎯 رزرو شیفت امتحان دروس (گیت زون‌بندی + قفل ظرفیت + پیشنهاد ۴تایی طلایی)</h3>
            {courses.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs font-bold text-slate-500">
                ابتدا درس‌های امتحانی (schedules نوع EXAM) ثبت شوند.
              </div>
            ) : (
              <div className="space-y-2">
                {courses.map(c => (
                  <div key={c.offeringId} className="p-3 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-black text-slate-900 text-xs">
                        {c.courseCode} — {c.courseTitle} <span className="text-slate-400">(گروه {faNum(c.groupNumber)})</span>
                        {c.examDate && <span className="mr-2 text-3xs text-indigo-700">رزرو: {faNum(c.examDate)} {faNum(c.startTime)}</span>}
                      </span>
                      <button
                        onClick={() => handleSuggestSlots(c.offeringId)}
                        disabled={busyPlanning}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-3xs disabled:opacity-50"
                      >
                        💡 ۴ پیشنهاد طلایی
                      </button>
                    </div>
                    {suggestions[c.offeringId] && (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                        {suggestions[c.offeringId].map((sug, i) => (
                          <button
                            key={i}
                            onClick={() => setSlotDraft(prev => ({ ...prev, [c.offeringId]: { date: jalaliToIso(sug.examDate), start: sug.startTime } }))}
                            className="p-2.5 rounded-xl border-2 border-indigo-200 hover:border-indigo-500 text-right space-y-1"
                          >
                            <div className="font-black text-slate-900 text-xs">{faNum(sug.examDate)} — {faNum(sug.startTime)}</div>
                            <div className="flex flex-wrap gap-1">
                              {sug.reasons.map((r, j) => (
                                <span key={j} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{r}</span>
                              ))}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-end gap-2 flex-wrap">
                      <label className="text-2xs font-bold text-slate-600">
                        تاریخ:
                        <input
                          type="date"
                          value={slotDraft[c.offeringId]?.date ?? ''}
                          onChange={e => setSlotDraft(prev => ({ ...prev, [c.offeringId]: { date: e.target.value, start: prev[c.offeringId]?.start ?? '08:00' } }))}
                          className="ms-1.5 border border-slate-300 rounded-lg px-2 py-1.5 font-bold text-left"
                          dir="ltr"
                        />
                      </label>
                      <label className="text-2xs font-bold text-slate-600">
                        ساعت شروع:
                        <select
                          value={slotDraft[c.offeringId]?.start ?? '08:00'}
                          onChange={e => setSlotDraft(prev => ({ ...prev, [c.offeringId]: { date: prev[c.offeringId]?.date ?? '', start: e.target.value } }))}
                          className="ms-1.5 border border-slate-300 rounded-lg px-2 py-1.5 font-bold bg-white"
                        >
                          {['08:00', '10:30', '14:00', '16:30'].map(t => <option key={t} value={t}>{faNum(t)}</option>)}
                        </select>
                      </label>
                      <button
                        onClick={() => handleScheduleSlot(c.offeringId, c.courseCode)}
                        disabled={busyPlanning}
                        className="px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-2xs disabled:opacity-50"
                      >
                        📌 رزرو شیفت
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* امتحان تجمیعی خوشه‌های هم‌ارز */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
            <h3 className="font-extrabold text-slate-900 text-sm">🧩 امتحان تجمیعی خوشه‌های هم‌ارز (یک آزمون واحد برای دروس هم‌محتوا)</h3>
            {!planning || planning.clusters.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs font-bold text-slate-500">
                هیچ خوشهٔ هم‌ارزی با ارائهٔ فعال در این ترم نیست.
              </div>
            ) : (
              <div className="space-y-2">
                {planning.clusters.map(cl => (
                  <div key={cl.clusterId} className="p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <span className="font-black text-slate-900 text-xs">{cl.clusterTitle}</span>
                      <span className="ms-2 text-3xs font-bold text-slate-500">
                        {faNum(cl.courseCount)} درس هم‌ارز · {faNum(cl.demand)} دانشجو
                        {cl.scheduledSlot && <span className="text-indigo-700"> · رزرو: {faNum(cl.scheduledSlot.examDate)} {faNum(cl.scheduledSlot.startTime)}</span>}
                      </span>
                    </div>
                    <div className="flex items-end gap-2 flex-wrap">
                      <input
                        type="date"
                        value={clusterDraft[cl.clusterId]?.date ?? ''}
                        onChange={e => setClusterDraft(prev => ({ ...prev, [cl.clusterId]: { date: e.target.value, start: prev[cl.clusterId]?.start ?? '08:00' } }))}
                        className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold text-left"
                        dir="ltr"
                      />
                      <select
                        value={clusterDraft[cl.clusterId]?.start ?? '08:00'}
                        onChange={e => setClusterDraft(prev => ({ ...prev, [cl.clusterId]: { date: prev[cl.clusterId]?.date ?? '', start: e.target.value } }))}
                        className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold bg-white"
                      >
                        {['08:00', '10:30', '14:00', '16:30'].map(t => <option key={t} value={t}>{faNum(t)}</option>)}
                      </select>
                      <button
                        onClick={() => handleUnifiedCluster(cl.clusterId, cl.clusterTitle)}
                        disabled={busyPlanning}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-2xs disabled:opacity-50"
                      >
                        🧩 ثبت امتحان تجمیعی
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
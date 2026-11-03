'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { generateOfferingSessionsAction, saveSessionAttendanceAction, scheduleMakeupSessionAction } from './actions';
import { mergeRefreshedOfferings } from '@/lib/professor-attendance-display';
import AttendanceMatrixSheet from './AttendanceMatrixSheet';
import PrintTranscriptButton from '@/components/PrintTranscriptButton';
import {
  DEMO_ATTENDANCE_DEFAULT_OFFERING_ID,
  DEMO_ATTENDANCE_DEFAULT_ROOM_ID,
  DEMO_ATTENDANCE_DEFAULT_SESSION_NO,
  DEMO_ATTENDANCE_PROFESSOR_FALLBACK_NAME,
  DEMO_BIOMETRIC_BANNER,
  DEMO_MAKEUP_FALLBACK_END_TIME,
  DEMO_MAKEUP_FALLBACK_START_TIME,
  DEMO_MAKEUP_FORM_DEFAULTS,
  demoMakeupSessionNo,
} from '@/lib/demo-professor-data';
import { notify } from '@/lib/ui-feedback';

export interface StudentInfo {
  id: number;
  studentCode: string;
  fullName: string;
}

export interface StudentSessionAttendance {
  status: 'PRESENT' | 'ABSENT' | 'EXCUSED' | 'LATE';
  lateMinutes?: number;
  note?: string;
}

export interface ClassSessionItem {
  id: number;
  sessionNo: number;
  sessionDate: string; // e.g. '۱۴۰۵/۰۷/۰۵'
  startTime: string;   // e.g. '۰۸:۰۰'
  endTime: string;     // e.g. '۱۰:۰۰'
  roomName: string;    // e.g. 'کلاس ۳۰۱ (سمعی و بصری)'
  topic: string;
  isHeld: boolean;
  isMakeUp: boolean;
  replacedSessionNo?: number;
  professorStatus: 'VERIFIED_PRESENT' | 'ABSENT' | 'UPCOMING' | 'APPROVED_MAKEUP';
  verificationDetail: string;
  professorCheck?: { verificationMethod: string; ipAddress: string | null; recordedAt: string | null } | null;
  studentStatuses: { [studentId: number]: StudentSessionAttendance };
}

export interface AttendanceCourseOffering {
  id: number;
  code: string;
  title: string;
  groupNumber: number;
  units: number;
  roomName: string;
  scheduleTime: string;
  hasSchedules?: boolean;
  canGenerate?: boolean;
  /** این کلاس ادغامی است — چند عرضه در یک جلسهٔ فیزیکی */
  merged?: boolean;
  /** چند عرضه در این کلاس ادغام شده‌اند */
  memberCount?: number;
  students: StudentInfo[];
  sessions: ClassSessionItem[];
}

export interface MakeupSessionRecord {
  id: number;
  offeringId: number;
  courseTitle: string;
  groupNumber: number;
  professorName: string;
  replacedSessionNo: number | null;
  sessionDate: string;
  sessionTime: string;
  roomName: string;
  topic: string;
  reason: string;
  status: 'APPROVED_DIRECT' | 'PENDING_EDUCATION' | 'APPROVED_BY_EDUCATION' | 'REJECTED';
  allocatedAt: string;
}

interface Props {
  demo?: boolean;
  professor: {
    id: number;
    name: string;
    staffCode: string;
    academicRank?: string;
  };
  termTitle: string;
  initialOfferings: AttendanceCourseOffering[];
  defaultOfferingId?: number;
  linkedOfferingNotice?: { offeringId: number; title: string; termTitle: string; selectedTermTitle: string } | null;
  initialMakeupHistory: MakeupSessionRecord[];
  todayJalali: string;
  rooms: { id: number; name: string; capacity: number; type: string }[];
}

const faNum = (n: any) => (n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'EXCUSED' | 'LATE';
export type RosterStatusFilter = 'ALL' | AttendanceStatus | 'UNMARKED';
export type RosterSortKey = 'ROW' | 'NAME' | 'CODE' | 'STATUS';
export type RosterSortDir = 'ASC' | 'DESC';

export function normalizeRosterText(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ٰٖ]/g, '')
    .replace(/‌/g, ' ')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function rosterMatchesQuery(student: StudentInfo, query: string | null | undefined): boolean {
  const q = normalizeRosterText(query);
  if (!q) return true;
  const compact = q.replace(/\s+/g, '');
  const name = normalizeRosterText(student.fullName);
  const code = normalizeRosterText(student.studentCode);
  return (
    name.includes(q) ||
    code.includes(q) ||
    name.replace(/\s+/g, '').includes(compact) ||
    code.replace(/\s+/g, '').includes(compact)
  );
}

export function filterRoster(
  students: StudentInfo[],
  statuses: { [studentId: number]: StudentSessionAttendance },
  query: string | null | undefined,
  statusFilter: RosterStatusFilter,
): StudentInfo[] {
  return students.filter(st => {
    const rec = statuses[st.id];
    if (statusFilter === 'UNMARKED') {
      if (rec) return false;
    } else if (statusFilter !== 'ALL' && rec?.status !== statusFilter) {
      return false;
    }
    return rosterMatchesQuery(st, query);
  });
}

const ROSTER_STATUS_RANK: { [k: string]: number } = { PRESENT: 0, LATE: 1, EXCUSED: 2, ABSENT: 3 };

export function sortRoster(
  students: StudentInfo[],
  statuses: { [studentId: number]: StudentSessionAttendance },
  sortKey: RosterSortKey,
  sortDir: RosterSortDir,
  baseOrder?: Map<number, number>,
): StudentInfo[] {
  const order = baseOrder ?? new Map(students.map((s, i): [number, number] => [s.id, i]));
  const dir = sortDir === 'DESC' ? -1 : 1;
  const ranked = (id: number) => {
    const st = statuses[id]?.status;
    return st === undefined ? 4 : (ROSTER_STATUS_RANK[st] ?? 4);
  };
  return [...students].sort((a, b) => {
    let c = 0;
    if (sortKey === 'NAME') c = normalizeRosterText(a.fullName).localeCompare(normalizeRosterText(b.fullName), 'fa');
    else if (sortKey === 'CODE') c = normalizeRosterText(a.studentCode).localeCompare(normalizeRosterText(b.studentCode), 'fa', { numeric: true });
    else if (sortKey === 'STATUS') c = ranked(a.id) - ranked(b.id);
    else c = (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    if (c !== 0) return c * dir;
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  });
}

export function buildBulkStatuses(
  students: StudentInfo[],
  prev: { [studentId: number]: StudentSessionAttendance },
  status: AttendanceStatus,
): { [studentId: number]: StudentSessionAttendance } {
  const next: { [studentId: number]: StudentSessionAttendance } = {};
  students.forEach(st => {
    next[st.id] = {
      status,
      lateMinutes: status === 'LATE' ? prev[st.id]?.lateMinutes || 15 : undefined,
      note: prev[st.id]?.note,
    };
  });
  return next;
}

export const GENERATE_SESSIONS_FALLBACK_ERROR = 'خطای غیرمنتظره در تولید جلسات؛ لطفاً دوباره تلاش کنید و در صورت تکرار به آموزش اطلاع دهید.';

export function sanitizeGenerateError(message: unknown): string {
  const text = String(message ?? '').slice(0, 300);
  if (/failed query|insert into|\$\d|syntax error|violates |relation "|column "/i.test(text)) return GENERATE_SESSIONS_FALLBACK_ERROR;
  return text || GENERATE_SESSIONS_FALLBACK_ERROR;
}

const MAKEUP_TIME_OPTIONS = ['۰۸:۰۰ الی ۱۰:۰۰', '۱۰:۰۰ الی ۱۲:۰۰', '۱۲:۳۰ الی ۱۴:۰۰', '۱۳:۳۰ الی ۱۵:۳۰', '۱۵:۳۰ الی ۱۷:۳۰', '۱۷:۳۰ الی ۱۹:۳۰'];



export default function ProfessorAttendanceClient({
  demo = false,
  professor,
  termTitle,
  initialOfferings,
  defaultOfferingId,
  linkedOfferingNotice = null,
  initialMakeupHistory,
  todayJalali,
  rooms: realRooms,
}: Props) {
  const router = useRouter();
  const profDisplayName = professor?.name?.trim()
    || (demo ? DEMO_ATTENDANCE_PROFESSOR_FALLBACK_NAME : 'استاد محترم');

  const [offerings, setOfferings] = useState<AttendanceCourseOffering[]>(initialOfferings);
  const [selectedOfferingId, setSelectedOfferingId] = useState<number>(
    defaultOfferingId && initialOfferings.some(o => o.id === defaultOfferingId)
      ? defaultOfferingId
      : demo
        ? initialOfferings[0]?.id || DEMO_ATTENDANCE_DEFAULT_OFFERING_ID
        : initialOfferings[0]?.id ?? 0
  );

  const [selectedSessionNo, setSelectedSessionNo] = useState<number>(
    demo
      ? DEMO_ATTENDANCE_DEFAULT_SESSION_NO
      : initialOfferings.find(o => o.id === (defaultOfferingId ?? initialOfferings[0]?.id))?.sessions[0]?.sessionNo
        ?? initialOfferings[0]?.sessions[0]?.sessionNo
        ?? 0
  );
  // ── نمای «همهٔ جلسات»: یک فهرست تخت از جلساتِ همهٔ درس‌ها، با کلیک وارد جلسه می‌شود ──
  const [viewMode, setViewMode] = useState<'course' | 'all'>('course');

  // لیست تخت همهٔ جلسات (درس + جلسه) مرتب‌شده بر اساس تاریخ شمسی
  const allSessionsFlat = useMemo(() => {
    const items: { offeringId: number; title: string; code: string; groupNumber: number; sessionNo: number; sessionDate: string; startTime: string; endTime: string; isHeld: boolean; isMakeUp: boolean; roomName: string; scheduleTime: string }[] = [];
    for (const o of offerings) {
      for (const s of o.sessions) {
        if (!s.sessionDate) continue;
        items.push({
          offeringId: o.id, title: o.title, code: o.code, groupNumber: o.groupNumber,
          sessionNo: s.sessionNo, sessionDate: s.sessionDate,
          startTime: s.startTime, endTime: s.endTime,
          isHeld: s.isHeld ?? false, isMakeUp: s.isMakeUp ?? false,
          roomName: s.roomName || o.roomName, scheduleTime: o.scheduleTime,
        });
      }
    }
    // مرتب‌سازی عددی بر اساس YYYY/MM/DD شمسی
    const num = (d: string) => { const p = d.split('/').map(Number); return (p[0] ?? 0) * 10000 + (p[1] ?? 0) * 100 + (p[2] ?? 0); };
    items.sort((a, b) => num(a.sessionDate) - num(b.sessionDate) || a.offeringId - b.offeringId || a.sessionNo - b.sessionNo);
    return items;
  }, [offerings]);

  const openAllSession = (offeringId: number, sessionNo: number) => {
    setSelectedOfferingId(offeringId);
    setSelectedSessionNo(sessionNo);
    setViewMode('course');
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* ignore */ }
  };

  const allSessionsCount = allSessionsFlat.length;
  // ── آکاردئون «همهٔ جلسات»: باز/بسته بودن هر درس (پیش‌فرض: همه باز) ──
  const [openCourses, setOpenCourses] = useState<Set<number>>(
    () => new Set(offerings.map(o => o.id)),
  );
  const toggleCourse = (offeringId: number) => {
    setOpenCourses(prev => {
      const next = new Set(prev);
      if (next.has(offeringId)) next.delete(offeringId);
      else next.add(offeringId);
      return next;
    });
  };
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastKind, setToastKind] = useState<'success' | 'error'>('success');
  const [rosterQuery, setRosterQuery] = useState('');
  const [rosterStatusFilter, setRosterStatusFilter] = useState<RosterStatusFilter>('ALL');
  const [rosterSortKey, setRosterSortKey] = useState<RosterSortKey>('ROW');
  const [rosterSortDir, setRosterSortDir] = useState<RosterSortDir>('ASC');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (text: string, ms = 5000, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    setToastKind(kind);
    setToastMessage(text);
    if (ms > 0) {
      toastTimer.current = setTimeout(() => {
        setToastMessage(null);
        toastTimer.current = null;
      }, ms);
    }
  };
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Make-up Session Creation Modal State
  const [showMakeupModal, setShowMakeupModal] = useState<boolean>(false);
  const [savingSession, setSavingSession] = useState(false);
  const [savingMakeup, setSavingMakeup] = useState(false);
  const [selectedRoomOptionId, setSelectedRoomOptionId] = useState<number>(
    demo ? DEMO_ATTENDANCE_DEFAULT_ROOM_ID : 0
  );
  const [makeupForm, setMakeupForm] = useState(demo
    ? { ...DEMO_MAKEUP_FORM_DEFAULTS }
    : {
        replacedSessionNo: 0,
        sessionDate: '',
        sessionTime: '',
        topic: '',
        reason: '',
      });

  // Log of make-up sessions requested / scheduled (واقعی از class_sessions)
  const [makeupHistory, setMakeupHistory] = useState<MakeupSessionRecord[]>(initialMakeupHistory);
  const [generatingSessions, setGeneratingSessions] = useState(false);
  const [generateResult, setGenerateResult] = useState<string | null>(null);
  const [generateConflicts, setGenerateConflicts] = useState<{ message: string }[]>([]);

  // Current offering & session
  // ⚠ حالت خالی: استادی که هنوز هیچ درسی به او تخصیص نیافته، offerings خالی دارد.
  //   پیش از این «currentOffering.sessions» روی undefined صدا زده می‌شد و کل صفحه
  //   با TypeError کرش می‌کرد (۵۰۰). حالا خروجی می‌تواند null باشد و پایین‌تر
  //   یک حالت خالی تمیز رندر می‌شود.
  const currentOffering = useMemo(() => {
    return offerings.find(o => o.id === selectedOfferingId) ?? offerings[0] ?? null;
  }, [offerings, selectedOfferingId]);

  const currentSession = useMemo(() => {
    const sessions = currentOffering?.sessions ?? [];
    return sessions.find(s => s.sessionNo === selectedSessionNo) ?? sessions[0] ?? null;
  }, [currentOffering, selectedSessionNo]);

  const rosterBaseOrder = useMemo(
    () => new Map<number, number>(((currentOffering?.students) ?? []).map((s, idx): [number, number] => [s.id, idx])),
    [currentOffering],
  );
  const visibleStudents = useMemo(() => {
    const list = currentOffering?.students ?? [];
    const statuses = currentSession?.studentStatuses ?? {};
    return sortRoster(filterRoster(list, statuses, rosterQuery, rosterStatusFilter), statuses, rosterSortKey, rosterSortDir, rosterBaseOrder);
  }, [currentOffering, currentSession, rosterQuery, rosterStatusFilter, rosterSortKey, rosterSortDir, rosterBaseOrder]);
  const rosterFilterActive = rosterQuery.trim() !== '' || rosterStatusFilter !== 'ALL';

  useEffect(() => {
    setOfferings(prev => {
      const merged = mergeRefreshedOfferings(prev, initialOfferings);
      return merged.length === prev.length && merged.every((o, i) => o === prev[i]) ? prev : merged;
    });
  }, [initialOfferings]);

  useEffect(() => {
    const cur = offerings.find(o => o.id === selectedOfferingId) ?? offerings[0];
    if (cur && cur.sessions.length > 0 && selectedSessionNo === 0) {
      setSelectedSessionNo(cur.sessions[0].sessionNo);
    }
  }, [offerings, selectedOfferingId, selectedSessionNo]);

  const handleGenerateSessions = async () => {
    if (!currentOffering || generatingSessions) return;
    setGeneratingSessions(true);
    setGenerateResult(null);
    setGenerateConflicts([]);
    try {
      const res = await generateOfferingSessionsAction(currentOffering.id);
      if (!res.ok) {
        setGenerateResult(sanitizeGenerateError(res.error));
        setGenerateConflicts((res.conflicts ?? []).map(c => ({ message: c.message })));
        return;
      }
      if (res.already) {
        setGenerateResult('برای این درس جلسه‌ای از قبل ثبت شده است؛ نیازی به تولید مجدد نیست.');
        router.refresh();
        return;
      }
      const parts = [`${faNum(res.perOffering ?? 0)} جلسه برای این درس تولید شد.`];
      if ((res.skipped ?? 0) > 0) parts.push(`${faNum(res.skipped)} جلسه تکراری رد شد.`);
      setGenerateResult(parts.join(' '));
      setGenerateConflicts((res.conflicts ?? []).map(c => ({ message: c.message })));
      router.refresh();
    } catch {
      setGenerateResult(GENERATE_SESSIONS_FALLBACK_ERROR);
    } finally {
      setGeneratingSessions(false);
    }
  };

  // Compute total prior absences for each student across all completed sessions
  const studentPriorAbsentsMap = useMemo(() => {
    const map: { [studentId: number]: number } = {};
    if (!currentOffering) return map;
    currentOffering.students.forEach(st => { map[st.id] = 0; });

    currentOffering.sessions.forEach(sess => {
      if (sess.isHeld && sess.sessionNo !== selectedSessionNo) {
        currentOffering.students.forEach(st => {
          const rec = sess.studentStatuses[st.id];
          if (rec?.status === 'ABSENT') {
            map[st.id] = (map[st.id] || 0) + 1;
          }
        });
      }
    });

    return map;
  }, [currentOffering, selectedSessionNo]);

  // Update session topic
  const handleUpdateTopic = (topic: string) => {
    setOfferings(prev =>
      prev.map(off => {
        if (off.id !== selectedOfferingId) return off;
        return {
          ...off,
          sessions: off.sessions.map(sess => {
            if (sess.sessionNo !== selectedSessionNo) return sess;
            return { ...sess, topic };
          }),
        };
      })
    );
  };

  // Update session date
  const handleUpdateDate = (date: string) => {
    setOfferings(prev =>
      prev.map(off => {
        if (off.id !== selectedOfferingId) return off;
        return {
          ...off,
          sessions: off.sessions.map(sess => {
            if (sess.sessionNo !== selectedSessionNo) return sess;
            return { ...sess, sessionDate: date };
          }),
        };
      })
    );
  };

  // Set student status in current session
  const setStudentStatus = (studentId: number, status: 'PRESENT' | 'ABSENT' | 'EXCUSED' | 'LATE') => {
    setOfferings(prev =>
      prev.map(off => {
        if (off.id !== selectedOfferingId) return off;
        return {
          ...off,
          sessions: off.sessions.map(sess => {
            if (sess.sessionNo !== selectedSessionNo) return sess;
            const current = sess.studentStatuses[studentId] || { status: 'PRESENT' };
            return {
              ...sess,
              studentStatuses: {
                ...sess.studentStatuses,
                [studentId]: {
                  ...current,
                  status,
                  lateMinutes: status === 'LATE' ? (current.lateMinutes || 15) : undefined,
                },
              },
            };
          }),
        };
      })
    );
  };

  // Set student late minutes
  const setStudentLateMinutes = (studentId: number, mins: number) => {
    setOfferings(prev =>
      prev.map(off => {
        if (off.id !== selectedOfferingId) return off;
        return {
          ...off,
          sessions: off.sessions.map(sess => {
            if (sess.sessionNo !== selectedSessionNo) return sess;
            const current = sess.studentStatuses[studentId] || { status: 'LATE' };
            return {
              ...sess,
              studentStatuses: {
                ...sess.studentStatuses,
                [studentId]: {
                  ...current,
                  lateMinutes: mins,
                },
              },
            };
          }),
        };
      })
    );
  };

  // Set student note
  const setStudentNote = (studentId: number, note: string) => {
    setOfferings(prev =>
      prev.map(off => {
        if (off.id !== selectedOfferingId) return off;
        return {
          ...off,
          sessions: off.sessions.map(sess => {
            if (sess.sessionNo !== selectedSessionNo) return sess;
            const current = sess.studentStatuses[studentId] || { status: 'PRESENT' };
            return {
              ...sess,
              studentStatuses: {
                ...sess.studentStatuses,
                [studentId]: {
                  ...current,
                  note,
                },
              },
            };
          }),
        };
      })
    );
  };

  // Bulk status update
  const markAll = (status: AttendanceStatus) => {
    const count = offerings.find(o => o.id === selectedOfferingId)?.students.length ?? 0;
    setOfferings(prev =>
      prev.map(off => {
        if (off.id !== selectedOfferingId) return off;
        return {
          ...off,
          sessions: off.sessions.map(sess => {
            if (sess.sessionNo !== selectedSessionNo) return sess;
            return { ...sess, studentStatuses: buildBulkStatuses(off.students, sess.studentStatuses, status) };
          }),
        };
      })
    );
    if (status === 'PRESENT') showToast('تمامی دانشجویان این جلسه حاضر ثبت شدند.', 4000);
    else if (status === 'ABSENT') showToast('وضعیت دانشجویان بازنشانی گردید.', 4000);
    else {
      const label = status === 'LATE' ? 'دارای تأخیر' : 'موجه';
      showToast(`وضعیت همهٔ ${faNum(count)} دانشجو «${label}» ثبت شد؛ در صورت نیاز سطرها را جداگانه اصلاح کنید.`, 4000);
    }
  };

  // Save current session — ذخیرهٔ واقعی در student_class_attendance (سرور)
  const handleSaveSession = async () => {
    if (!currentSession || currentSession.id <= 0) {
      showToast('جلسهٔ انتخابی هنوز در سرور ثبت نشده است.', 0, 'error');
      return;
    }
    if (savingSession) return;
    const sessionNoLabel = faNum(currentSession.sessionNo);
    const sessionDateLabel = faNum(currentSession.sessionDate);
    setSavingSession(true);
    try {
      const entries = Object.entries(currentSession.studentStatuses).map(([studentId, st]) => ({
        studentId: Number(studentId),
        status: st.status,
        lateMinutes: st.lateMinutes,
      }));
      const res = await saveSessionAttendanceAction(currentSession.id, entries);
      if (!res.ok) {
        showToast(res.error || 'خطا در ذخیرهٔ حضور و غیاب.', 0, 'error');
        return;
      }
      setOfferings(prev =>
        prev.map(off => {
          if (off.id !== selectedOfferingId) return off;
          return {
            ...off,
            sessions: off.sessions.map(sess => {
              if (sess.id !== currentSession.id) return sess;
              return { ...sess, isHeld: true };
            }),
          };
        })
      );
      showToast(`حضور و غیاب جلسه ${sessionNoLabel} (مورخ ${sessionDateLabel}) در پایگاه داده ثبت شد (${faNum(res.savedCount ?? entries.length)} ردیف).`, 6000);
    } catch {
      showToast('خطا در ارتباط با سرور.', 0, 'error');
    } finally {
      setSavingSession(false);
    }
  };

  // Professor Creates Make-up Session
  const handleCreateMakeupSession = async () => {
    if (!makeupForm.sessionDate.trim() || !makeupForm.sessionTime.trim()) {
      notify('تاریخ و ساعت برگزاری جلسهٔ جبرانی را وارد کنید.', 'error');
      return;
    }
    if (!makeupForm.topic.trim()) {
      notify('سرفصل جلسهٔ جبرانی را وارد کنید.', 'error');
      return;
    }
    if (makeupForm.sessionDate < todayJalali) {
      notify(`خطا: تاریخ جلسه جبرانی نمی‌تواند قبل از تاریخ جاری سامانه (${todayJalali}) باشد.`, 'error');
      return;
    }

    const isDirect = selectedRoomOptionId !== 0;
    const selectedRoom = realRooms.find(r => r.id === selectedRoomOptionId);
    if (isDirect && !selectedRoom) {
      notify('کلاس انتخابی معتبر نیست.', 'error');
      return;
    }
    const roomName = isDirect ? selectedRoom!.name : 'در انتظار تخصیص کلاس توسط آموزش';

    const maxSessionNo = currentOffering.sessions.reduce((m, s) => Math.max(m, s.sessionNo), 0);
    const newSessionNo = demo
      ? demoMakeupSessionNo(makeupForm.replacedSessionNo)
      : maxSessionNo + 1;

    // 1. If direct room selected, add session directly to active sessions
    if (isDirect) {
      const newSession: ClassSessionItem = {
        id: Date.now(),
        sessionNo: newSessionNo,
        sessionDate: makeupForm.sessionDate,
        startTime: makeupForm.sessionTime.split('الی')[0]?.trim()
          || (demo ? DEMO_MAKEUP_FALLBACK_START_TIME : ''),
        endTime: makeupForm.sessionTime.split('الی')[1]?.trim()
          || (demo ? DEMO_MAKEUP_FALLBACK_END_TIME : ''),
        roomName: selectedRoom!.name,
        topic: makeupForm.topic,
        isHeld: false,
        isMakeUp: true,
        replacedSessionNo: makeupForm.replacedSessionNo || undefined,
        professorStatus: 'APPROVED_MAKEUP',
        verificationDetail: `تخصیص مستقیم کلاس ${selectedRoom!.name} توسط استاد در ${todayJalali}`,
        studentStatuses: {},
      };

      setOfferings(prev =>
        prev.map(off => {
          if (off.id !== selectedOfferingId) return off;
          return {
            ...off,
            sessions: [...off.sessions, newSession],
          };
        })
      );

      setSelectedSessionNo(newSessionNo);
    }

    // 2. Add to makeup history
    const record: MakeupSessionRecord = {
      id: Date.now(),
      offeringId: selectedOfferingId,
      courseTitle: currentOffering.title,
      groupNumber: currentOffering.groupNumber,
      professorName: profDisplayName,
      replacedSessionNo: makeupForm.replacedSessionNo,
      sessionDate: makeupForm.sessionDate,
      sessionTime: makeupForm.sessionTime,
      roomName: roomName,
      topic: makeupForm.topic,
      reason: makeupForm.reason,
      status: isDirect ? 'APPROVED_DIRECT' : 'PENDING_EDUCATION',
      allocatedAt: `${todayJalali} ساعت ${new Date().getHours()}:${String(new Date().getMinutes()).padStart(2, '0')}`,
    };

    // ذخیرهٔ واقعی در class_sessions (isMakeUpSession=1) — سپس به‌روزرسانی UI
    const replacedSession = currentOffering.sessions.find(x => x.sessionNo === makeupForm.replacedSessionNo);
    const sTimes = makeupForm.sessionTime.split('الی').map(x => x.trim());
    const toAscii = (x: string) => x.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    const startTime = toAscii(sTimes[0] ?? '').match(/\d{1,2}:\d{2}/)?.[0]?.padStart(5, '0') ?? '';
    const endTime = toAscii(sTimes[1] ?? '').match(/\d{1,2}:\d{2}/)?.[0]?.padStart(5, '0') ?? '';
    if (!startTime || !endTime) {
      notify('ساعت برگزاری را به شکل «HH:MM الی HH:MM» وارد کنید.', 'error');
      return;
    }
    setSavingMakeup(true);
    try {
      const res = await scheduleMakeupSessionAction({
        offeringId: selectedOfferingId,
        replacedSessionId: replacedSession?.id,
        sessionDate: toAscii(makeupForm.sessionDate),
        startTime,
        endTime,
        roomName: isDirect ? roomName : '',
        isDirect,
        topic: makeupForm.topic,
        absenceReason: makeupForm.reason,
      });
      if (!res.ok) {
        showToast(res.error || 'ثبت جلسهٔ جبرانی ناموفق بود.', 0, 'error');
        return;
      }
      setMakeupHistory(prev => [{ ...record, id: res.sessionId ?? record.id }, ...prev]);
      setShowMakeupModal(false);
      if (isDirect) {
        showToast(`🎉 جلسه جبرانی در «${selectedRoom!.name}» برای تاریخ ${faNum(makeupForm.sessionDate)} ثبت شد و در فهرست جلسات درس قرار گرفت.`, 8000);
      } else {
        showToast(`📩 درخواست جلسه جبرانی ثبت شد و در انتظار تأیید/تخصیص کلاس توسط ادارهٔ آموزش است.`, 8000);
      }
    } catch {
      showToast('خطا در ارتباط با سرور.', 0, 'error');
    } finally {
      setSavingMakeup(false);
    }
  };

  // Statistics for the active session
  // ── حالت خالی (بدون درس تخصیص‌یافته یا بدون جلسهٔ تولیدشده) ──
  // همهٔ هوک‌ها بالاتر اجرا شده‌اند، پس این return زودهنگام قانون ترتیب هوک‌ها را نمی‌شکند.
  if (!currentOffering || !currentSession) {
    const emptyOffering = currentOffering;
    const showLinkedNotice = !!linkedOfferingNotice && emptyOffering?.id === linkedOfferingNotice.offeringId;
    return (
      <div className="space-y-5" dir="rtl">
        {showLinkedNotice && (
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-bold leading-6">
            این درس ({linkedOfferingNotice.title}) مربوط به {linkedOfferingNotice.termTitle} است و فیلتر نیمسال روی {linkedOfferingNotice.selectedTermTitle} قرار دارد؛ انتخاب شما حفظ شده است.
          </div>
        )}
        <div className="card p-8 text-center space-y-3">
          <div className="text-4xl">📋</div>
          <h2 className="text-lg font-bold">درسی برای حضوروغیاب یافت نشد</h2>
          {offerings.length === 0 ? (
            <p className="text-sm text-gray-400 leading-7">
              {`جناب ${profDisplayName}، در نیمسال جاری هیچ درسی به شما تخصیص نیافته است. پس از تخصیص درس توسط مدیر گروه، کارتابل حضوروغیاب همین‌جا فعال می‌شود.`}
            </p>
          ) : emptyOffering ? (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="font-extrabold text-slate-900 text-sm">
                  {emptyOffering.title} (گروه {faNum(emptyOffering.groupNumber)} — کد {emptyOffering.code})
                </div>
                <div className="text-xs text-slate-600 font-bold">
                  {emptyOffering.scheduleTime}
                  {emptyOffering.roomName ? ` · 🏛️ ${emptyOffering.roomName}` : ''}
                </div>
                {offerings.length > 1 && (
                  <select
                    value={selectedOfferingId}
                    onChange={e => {
                      const newOffId = Number(e.target.value);
                      setSelectedOfferingId(newOffId);
                      setGenerateResult(null);
                      setGenerateConflicts([]);
                      const firstSess = offerings.find(o => o.id === newOffId)?.sessions[0]?.sessionNo ?? 0;
                      setSelectedSessionNo(firstSess);
                    }}
                    className="mt-2 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900"
                  >
                    {offerings.map(o => (
                      <option key={o.id} value={o.id}>
                        {o.title} (گروه {faNum(o.groupNumber)} — کد {o.code})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {!demo && emptyOffering.sessions.length === 0 && !emptyOffering.hasSchedules && (
                <p className="text-sm text-gray-400 leading-7">
                  برای این درس هنوز هیچ زمان‌بندی هفتگی ثبت نشده است؛ جلسات فقط از روی برنامهٔ هفتگی ساخته می‌شوند. برای تعیین برنامهٔ هفتگی با ادارهٔ آموزش هماهنگ کنید.
                </p>
              )}
              {!demo && emptyOffering.sessions.length === 0 && emptyOffering.hasSchedules && !emptyOffering.canGenerate && (
                <p className="text-sm text-gray-400 leading-7">
                  برای این درس زمان‌بندی ثبت شده اما جلسهٔ هفتگی قابل تولیدی ندارد؛ لطفاً با ادارهٔ آموزش هماهنگ کنید تا برنامهٔ هفتگی (CLASS) کامل شود.
                </p>
              )}
              {!demo && emptyOffering.sessions.length === 0 && emptyOffering.canGenerate && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-400 leading-7">
                    برای این درس زمان‌بندی هفتگی ثبت شده ولی جلساتش هنوز ساخته نشده است. با دکمهٔ زیر جلسات این درس را از روی برنامهٔ هفتگی تولید کنید.
                  </p>
                  <button
                    onClick={handleGenerateSessions}
                    disabled={generatingSessions}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-extrabold text-xs shadow transition"
                  >
                    {generatingSessions ? 'در حال تولید جلسات…' : 'تولید جلسات این درس'}
                  </button>
                  {generateResult && (
                    <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold leading-6">
                      {generateResult}
                    </div>
                  )}
                  {generateConflicts.length > 0 && (
                    <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-bold leading-6 text-right space-y-1">
                      {generateConflicts.map((c, i) => (
                        <div key={i}>• {c.message}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const students = currentOffering.students;
  const totalStudents = students.length;
  const recordedCount = students.filter(s => currentSession.studentStatuses[s.id]).length;
  const presentCount = students.filter(s => {
    const st = currentSession.studentStatuses[s.id]?.status;
    return st === 'PRESENT' || st === 'LATE';
  }).length;
  const absentCount = students.filter(s => currentSession.studentStatuses[s.id]?.status === 'ABSENT').length;
  const excusedCount = students.filter(s => currentSession.studentStatuses[s.id]?.status === 'EXCUSED').length;
  const attendanceRate = recordedCount > 0 ? Math.round((presentCount / recordedCount) * 100) : null;

  return (
    <div className="space-y-5" dir="rtl">
      
      {/* ── نوار حالت نمایش: «جلسات یک درس» / «همهٔ جلسات» ── */}
      <div className="print:hidden flex flex-wrap items-center gap-2">
        <button
          onClick={() => setViewMode('course')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition ${
            viewMode === 'course' && allSessionsFlat.length > 0
              ? 'bg-indigo-700 text-white shadow'
              : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
          }`}
        >
          🗂️ جلسات این درس
        </button>
        <button
          onClick={() => setViewMode('all')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition ${
            viewMode === 'all'
              ? 'bg-indigo-700 text-white shadow'
              : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
          }`}
        >
          📅 همهٔ جلسات {allSessionsFlat.length > 0 && `(${faNum(allSessionsFlat.length)})`}
        </button>
        {viewMode === 'all' && allSessionsFlat.length === 0 && (
          <span className="text-xs text-slate-500 font-bold">هنوز جلسه‌ای تولید نشده است.</span>
        )}
      </div>

      {/* ── نمای «همهٔ جلسات»: به تفکیک هر درس (گروه‌بندی شده) ── */}
      {viewMode === 'all' && allSessionsFlat.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="p-3 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-900">📅 همهٔ جلسات کلاس‌های شما — به تفکیک درس</h3>
            <span className="text-2xs text-slate-500 font-bold">برای ورود به هر جلسه، روی ردیف کلیک کنید</span>
          </div>
          <div className="max-h-[30rem] overflow-y-auto divide-y divide-slate-200">
            {offerings
              .filter(o => o.sessions.some(s => s.sessionDate))
              .map(o => {
                const rows = allSessionsFlat.filter(r => r.offeringId === o.id);
                if (!rows.length) return null;
                return (
                  <section key={o.id} className="p-2">
                    <button
                      onClick={() => toggleCourse(o.id)}
                      className="w-full flex flex-wrap items-center gap-2 px-2 py-1.5 rounded-xl bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition"
                    >
                      <span className="font-black text-slate-900 text-xs">{o.title}</span>
                      {o.merged ? (
                        <span
                          title={`این کلاس از ${faNum(o.memberCount ?? 2)} عرضه تشکیل شده؛ ثبت حضور روی همهٔ آن‌ها اعمال می‌شود.`}
                          className="text-3xs rounded-full px-2 py-0.5 font-black bg-violet-100 text-violet-800 border border-violet-200"
                        >
                          🔗 {faNum(o.memberCount ?? 2)} عرضه
                        </span>
                      ) : null}
                      <span className="text-3xs font-mono text-slate-500">({o.code})</span>
                      <span className="text-3xs rounded-full px-2 py-0.5 font-black bg-white text-slate-600 border border-slate-200">گروه {faNum(o.groupNumber)}</span>
                      <span className="text-3xs rounded-full px-2 py-0.5 font-black bg-white text-indigo-700 border border-indigo-200">
                        {faNum(rows.length)} جلسه
                      </span>
                      <span className="text-3xs text-slate-500 font-bold">{o.scheduleTime || ''}</span>
                      <span className="mr-auto text-slate-500 font-black text-xs">{openCourses.has(o.id) ? '▾ بستن' : '▴ باز'}</span>
                    </button>
                    {openCourses.has(o.id) && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs rt">
                        <thead className="bg-white text-slate-500">
                          <tr>
                            <th className="p-1.5 text-right font-black w-24">تاریخ</th>
                            <th className="p-1.5 text-center font-black w-14">جلسه</th>
                            <th className="p-1.5 text-center font-black">ساعت</th>
                            <th className="p-1.5 text-right font-black">سالن</th>
                            <th className="p-1.5 text-center font-black w-20">وضعیت</th>
                            <th className="p-1.5 text-center font-black w-16">ورود</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(r => (
                            <tr
                              key={`${r.offeringId}-${r.sessionNo}-${r.sessionDate}`}
                              onClick={() => openAllSession(r.offeringId, r.sessionNo)}
                              className={`cursor-pointer border-t border-slate-100 hover:bg-indigo-50 transition ${r.isMakeUp ? 'bg-amber-50/60' : ''}`}
                            >
                              <td className="p-1.5 font-bold whitespace-nowrap text-indigo-900" dir="ltr">{faNum(r.sessionDate)}</td>
                              <td className="p-1.5 text-center font-black">{faNum(r.sessionNo)}{r.isMakeUp ? ' 🔷' : ''}</td>
                              <td className="p-1.5 text-center whitespace-nowrap" dir="ltr">{faNum(r.startTime)}–{faNum(r.endTime)}</td>
                              <td className="p-1.5 text-slate-600">{r.roomName || '—'}</td>
                              <td className="p-1.5 text-center">
                                {r.isMakeUp
                                  ? <span className="px-2 py-0.5 rounded-full text-3xs font-black bg-amber-200 text-amber-900">جبرانی</span>
                                  : r.isHeld
                                    ? <span className="px-2 py-0.5 rounded-full text-3xs font-black bg-emerald-200 text-emerald-900">برگزار شده</span>
                                    : <span className="px-2 py-0.5 rounded-full text-3xs font-black bg-slate-200 text-slate-600">//</span>}
                              </td>
                              <td className="p-1.5 text-center">
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-700 text-white text-3xs font-black hover:bg-indigo-800">ورود ←</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    )}
                  </section>
                );
              })}
          </div>
        </div>
      )}
      {/* Toast */}
      {toastMessage && (
        <div role="status" className={toastKind === 'error'
          ? 'p-4 bg-rose-900 text-rose-100 rounded-2xl shadow-xl border border-rose-700 font-bold text-sm flex items-center justify-between animate-fadeIn'
          : 'p-4 bg-emerald-900 text-emerald-100 rounded-2xl shadow-xl border border-emerald-700 font-bold text-sm flex items-center justify-between animate-fadeIn'}>
          <div className="flex items-center gap-2">
            <span>{toastKind === 'error' ? '⛔' : '✅'}</span>
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => { if (toastTimer.current) { clearTimeout(toastTimer.current); toastTimer.current = null; } setToastMessage(null); }} className="text-white/60 hover:text-white text-xs shrink-0">✕ بستن</button>
        </div>
      )}

      {/* Header Bar */}
      <div className="bg-gradient-to-l from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-5 shadow-lg border border-indigo-700/50 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold bg-amber-400 text-slate-950">
                سامانه هوشمند حضور و غیاب و اثر انگشت
              </span>
              <span className="text-xs text-indigo-200">
                  {termTitle || 'نیمسال تعیین نشده'} · استاد: {profDisplayName}
                </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
              📋 ثبت حضور و غیاب کلاسی و مدیریت جلسات جبرانی
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMakeupModal(true)}
              className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs shadow transition flex items-center gap-1.5"
            >
              <span>➕ ایجاد جلسه جدید جبرانی</span>
            </button>
            <Link
              href="/professor/schedule"
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/20 transition"
            >
              🗓️ برنامه هفتگی
            </Link>
            <PrintTranscriptButton
              orientation="landscape"
              label="چاپ برگهٔ حضور کل جلسات"
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/20 transition print:hidden"
            />
          </div>
        </div>

        {/* Controls: Select Course, Select Session & Auto-Loaded Date */}
        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/15 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="text-indigo-200 font-bold block mb-1">۱. انتخاب کلاس و درس:</label>
            <select
              value={selectedOfferingId}
              onChange={e => {
                const newOffId = Number(e.target.value);
                setSelectedOfferingId(newOffId);
                const firstSess = offerings.find(o => o.id === newOffId)?.sessions[0]?.sessionNo ?? 0;
                setSelectedSessionNo(firstSess);
              }}
              className="w-full bg-slate-900/90 text-white border border-indigo-400/50 rounded-lg px-3 py-2 font-bold"
            >
              {offerings.map(o => (
                <option key={o.id} value={o.id}>
                  {o.title} (گروه {faNum(o.groupNumber)} — کد {o.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-indigo-200 font-bold block mb-1">
              ۲. انتخاب جلسه آموزشی ({faNum(currentOffering.sessions.length)} جلسه ثبت‌شده):
            </label>
            <select
              value={selectedSessionNo}
              onChange={e => setSelectedSessionNo(Number(e.target.value))}
              className="w-full bg-slate-900/90 text-white border-2 border-amber-400 rounded-lg px-3 py-2 font-extrabold"
            >
              {currentOffering.sessions.map(sess => (
                <option key={sess.sessionNo} value={sess.sessionNo}>
                  {sess.isMakeUp ? `🔷 جلسه جبرانی (جبران جلسه ${faNum(sess.replacedSessionNo)})` : `جلسه شماره ${faNum(sess.sessionNo)}`} — تاریخ {sess.sessionDate} {sess.isHeld ? '✓ برگزار شده' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-indigo-200 font-bold block mb-1">۳. تاریخ برگزاری این جلسه:</label>
            <input
              type="text"
              value={currentSession.sessionDate}
              onChange={e => handleUpdateDate(e.target.value)}
              className="w-full bg-slate-900/90 text-white border border-indigo-400/50 rounded-lg px-3 py-2 font-bold font-mono"
            />
          </div>
        </div>
      </div>

      {/* Professor Attendance Verification Banner (Fingerprint, Chain Matching & Status) */}
      <div className="space-y-3">
        {/* Biometric & Chain Matching Information Card */}
        <div className="p-3.5 bg-slate-900 text-white rounded-2xl border border-indigo-500/40 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-700/80 border border-indigo-400/40 flex items-center justify-center text-lg shrink-0">
              🧬
            </div>
            <div className="space-y-0.5">
              {demo ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-white text-xs">{DEMO_BIOMETRIC_BANNER.title}</span>
                    <span className="px-2 py-0.5 rounded-full text-3xs font-black bg-emerald-500 text-white">
                      {DEMO_BIOMETRIC_BANNER.statusLabel}
                    </span>
                  </div>
                  <p className="text-indigo-200 text-2xs leading-4">{DEMO_BIOMETRIC_BANNER.detail}</p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-white text-xs">تأیید حضور استاد در این جلسه:</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-3xs font-black ${
                        currentSession.professorCheck ? 'bg-emerald-500 text-white' : 'bg-slate-600 text-slate-200'
                      }`}
                    >
                      {currentSession.professorCheck ? '✓ ثبت شده' : 'ثبت نشده'}
                    </span>
                  </div>
                  <p className="text-indigo-200 text-2xs leading-4">
                    {currentSession.professorCheck
                      ? `روش تأیید: ${currentSession.professorCheck.verificationMethod} · زمان ثبت: ${
                          currentSession.professorCheck.recordedAt ?? 'ثبت نشده'
                        }`
                      : 'برای این جلسه رکورد تأیید حضور استاد در پایگاه داده ثبت نشده است. پس از ثبت برگهٔ حضور، اطلاعات اینجا از سامانه نمایش داده می‌شود.'}
                  </p>
                </>
              )}
            </div>
          </div>

          {demo ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="px-2.5 py-1 rounded-lg bg-white/10 text-emerald-300 font-mono text-2xs border border-white/10">
                {DEMO_BIOMETRIC_BANNER.ipLabel}
              </span>
            </div>
          ) : currentSession.professorCheck?.ipAddress ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="px-2.5 py-1 rounded-lg bg-white/10 text-emerald-300 font-mono text-2xs border border-white/10" dir="ltr">
                IP: {currentSession.professorCheck.ipAddress}
              </span>
            </div>
          ) : null}
        </div>

        {/* Status Alert */}
        <div className={`p-4 rounded-2xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-3 ${
          currentSession.professorStatus === 'VERIFIED_PRESENT'
            ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
            : currentSession.professorStatus === 'ABSENT'
            ? 'bg-rose-50 border-rose-300 text-rose-950'
            : currentSession.professorStatus === 'APPROVED_MAKEUP'
            ? 'bg-purple-50 border-purple-300 text-purple-950'
            : 'bg-slate-50 border-slate-300 text-slate-800'
        }`}>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-black ${
                currentSession.professorStatus === 'VERIFIED_PRESENT'
                  ? 'bg-emerald-700 text-white'
                  : currentSession.professorStatus === 'ABSENT'
                  ? 'bg-rose-700 text-white animate-pulse'
                  : currentSession.professorStatus === 'APPROVED_MAKEUP'
                  ? 'bg-purple-700 text-white'
                  : 'bg-slate-300 text-slate-800'
              }`}>
                {currentSession.professorStatus === 'VERIFIED_PRESENT' && '🟢 حضور استاد تایید شده'}
                {currentSession.professorStatus === 'ABSENT' && '🔴 غیبت استاد در جلسه'}
                {currentSession.professorStatus === 'APPROVED_MAKEUP' && '🔷 جلسه جبرانی مصوب'}
                {currentSession.professorStatus === 'UPCOMING' && '⏳ در انتظار تشکیل'}
              </span>
              <span className="text-xs font-bold text-slate-600">
                {currentSession.verificationDetail}
              </span>
            </div>

            {currentSession.professorStatus === 'ABSENT' && (
              <p className="text-xs text-rose-800 font-extrabold leading-5">
                ⚠️ اخطار آموزش: عدم حضور استاد در این جلسه از روی عدم ثبت اثر انگشت در گیت ورود تایید شده است. طبق ماده ۱۰ آیین‌نامه، ملزم به تعریف و برگزاری جلسه جبرانی می‌باشید.
              </p>
            )}

            {currentSession.professorStatus === 'VERIFIED_PRESENT' && (
              <p className="text-xs text-emerald-800 font-bold leading-5">
                {demo
                  ? `✓ حضور شما در این جلسه آموزشی از طریق سیستم گیت تردد و منطق پیوستگی ثبت گردیده و ${DEMO_BIOMETRIC_BANNER.payrollNote}`
                  : '✓ حضور شما در این جلسه آموزشی در پایگاه داده ثبت شده است.'}
              </p>
            )}
          </div>

          {currentSession.professorStatus === 'ABSENT' && (
            <button
              onClick={() => {
                setMakeupForm(prev => ({ ...prev, replacedSessionNo: currentSession.sessionNo }));
                setShowMakeupModal(true);
              }}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow transition shrink-0 flex items-center gap-1.5"
            >
              <span>➕ ثبت جلسه جبرانی برای این غیبت</span>
            </button>
          )}
        </div>
      </div>

      {/* Session Details & Topic Card */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-950 font-extrabold text-xs">
              🏛️ {currentSession.roomName}
            </span>
            <span className="text-xs text-slate-600 font-bold">
              ⏰ ساعت {currentSession.startTime} الی {currentSession.endTime}
            </span>
            <span className="text-xs text-slate-600 font-bold">
              📚 {faNum(currentOffering.units)} واحد
            </span>
          </div>

          {/* Quick Bulk Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => markAll('PRESENT')}
              className="px-3 py-1.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-bold text-xs transition flex items-center gap-1"
            >
              <span>🟢 حضور همه در جلسه {faNum(currentSession.sessionNo)}</span>
            </button>
            <button
              onClick={() => markAll('ABSENT')}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
            >
              بازنشانی
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            موضوع و سرفصل تدریس شده در جلسه شماره {faNum(currentSession.sessionNo)}:
          </label>
          <input
            type="text"
            value={currentSession.topic}
            onChange={e => handleUpdateTopic(e.target.value)}
            placeholder="ثبت سرفصل تدریس شده..."
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Real-time Session Statistics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-extrabold text-lg">
            👥
          </div>
          <div>
            <div className="text-xs text-slate-500 font-bold">کل دانشجویان کلاس</div>
            <div className="text-lg font-black text-slate-900">{faNum(totalStudents)} نفر</div>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-extrabold text-lg">
            ✓
          </div>
          <div>
            <div className="text-xs text-slate-500 font-bold">حاضرین این جلسه</div>
            <div className="text-lg font-black text-emerald-700">
              {faNum(presentCount)} نفر {attendanceRate != null ? `(${faNum(attendanceRate)}٪)` : ''}
            </div>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center font-extrabold text-lg">
            ✕
          </div>
          <div>
            <div className="text-xs text-slate-500 font-bold">غایبین جلسه {faNum(currentSession.sessionNo)}</div>
            <div className="text-lg font-black text-rose-700">{faNum(absentCount)} نفر</div>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-extrabold text-lg">
            ⏳
          </div>
          <div>
            <div className="text-xs text-slate-500 font-bold">غیبت‌های موجه</div>
            <div className="text-lg font-black text-amber-700">{faNum(excusedCount)} نفر</div>
          </div>
        </div>
      </div>

      {/* Student Attendance Roster for Selected Session */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
          <div>
            <h3 className="font-extrabold text-slate-900 text-base">
              لیست دانشجویان و وضعیت حضور در جلسه شماره {faNum(currentSession.sessionNo)} (مورخ {currentSession.sessionDate})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              با تغییر جلسه در بالای صفحه، اطلاعات و وضعیت‌های همان جلسه نمایش داده می‌شود.
              {!demo && recordedCount < totalStudents
                ? ` تا این لحظه برای ${faNum(recordedCount)} نفر از ${faNum(totalStudents)} دانشجو وضعیتی ثبت نشده است.`
                : ''}
            </p>
          </div>

          <button
            onClick={handleSaveSession}
            disabled={savingSession}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 disabled:from-slate-400 disabled:to-slate-500 disabled:cursor-wait text-white font-extrabold text-xs shadow transition flex items-center gap-1.5"
          >
            <span>{savingSession ? '⏳ در حال ذخیره…' : `💾 ثبت و تایید نهایی جلسه ${faNum(currentSession.sessionNo)}`}</span>
          </button>
        </div>

        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-3">
          <input
            type="text"
            value={rosterQuery}
            onChange={e => setRosterQuery(e.target.value)}
            placeholder="جست‌وجوی نام یا شماره دانشجویی…"
            className="flex-1 min-w-[200px] border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
          />
          <select
            value={rosterStatusFilter}
            onChange={e => setRosterStatusFilter(e.target.value as RosterStatusFilter)}
            className="border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900"
          >
            <option value="ALL">همه وضعیت‌ها</option>
            <option value="PRESENT">حاضر</option>
            <option value="ABSENT">غایب</option>
            <option value="LATE">تأخیر</option>
            <option value="EXCUSED">موجه</option>
            <option value="UNMARKED">ثبت‌نشده</option>
          </select>
          <select
            value={rosterSortKey}
            onChange={e => setRosterSortKey(e.target.value as RosterSortKey)}
            className="border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900"
          >
            <option value="ROW">مرتب‌سازی: ردیف</option>
            <option value="NAME">مرتب‌سازی: نام</option>
            <option value="CODE">مرتب‌سازی: شماره دانشجویی</option>
            <option value="STATUS">مرتب‌سازی: وضعیت</option>
          </select>
          <button
            type="button"
            onClick={() => setRosterSortDir(d => (d === 'ASC' ? 'DESC' : 'ASC'))}
            title={rosterSortDir === 'ASC' ? 'صعودی — برای نزولی کلیک کنید' : 'نزولی — برای صعودی کلیک کنید'}
            className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-xs font-bold transition"
          >
            {rosterSortDir === 'ASC' ? '▲ صعودی' : '▼ نزولی'}
          </button>
          {rosterFilterActive && (
            <button
              type="button"
              onClick={() => { setRosterQuery(''); setRosterStatusFilter('ALL'); }}
              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
            >
              پاک‌کردن فیلتر ({faNum(visibleStudents.length)} از {faNum(totalStudents)})
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs rt">
            <thead>
              <tr className="bg-slate-900 text-white text-center">
                <th className="p-3 border border-slate-800 w-12 font-extrabold">ردیف</th>
                <th className="p-3 border border-slate-800 font-extrabold">شماره دانشجویی</th>
                <th className="p-3 border border-slate-800 font-extrabold">نام و نام خانوادگی دانشجو</th>
                <th className="p-3 border border-slate-800 font-extrabold">جمع غیبت در سایر جلسات</th>
                <th className="p-3 border border-slate-800 font-extrabold min-w-[280px]">
                  <div className="flex flex-col items-center gap-1.5">
                    <span>وضعیت حضور در این جلسه</span>
                    <span className="flex items-center justify-center gap-1">
                      <button type="button" title="ثبت «حاضر» برای همهٔ دانشجویان" onClick={() => markAll('PRESENT')} className="px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-3xs font-bold transition">همه حاضر</button>
                      <button type="button" title="ثبت «غایب» برای همهٔ دانشجویان" onClick={() => markAll('ABSENT')} className="px-2 py-0.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-3xs font-bold transition">همه غایب</button>
                      <button type="button" title="ثبت «موجه» برای همهٔ دانشجویان" onClick={() => markAll('EXCUSED')} className="px-2 py-0.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-3xs font-bold transition">همه موجه</button>
                      <button type="button" title="ثبت «تأخیر» برای همهٔ دانشجویان" onClick={() => markAll('LATE')} className="px-2 py-0.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-3xs font-bold transition">همه تأخیر</button>
                    </span>
                  </div>
                </th>
                <th className="p-3 border border-slate-800 font-extrabold">توضیح کلاسی</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map(st => {
                const idx = rosterBaseOrder.get(st.id) ?? 0;
                const recorded = currentSession.studentStatuses[st.id];
                const sessionAtt = recorded || { status: 'PRESENT' as const };
                const priorAbsents = studentPriorAbsentsMap[st.id] || 0;
                const totalAbsentsWithCurrent = priorAbsents + (recorded?.status === 'ABSENT' ? 1 : 0);
                const is3AbsencesWarning = totalAbsentsWithCurrent >= 3;

                return (
                  <tr key={st.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="p-3 border border-slate-200 text-center font-bold text-slate-500">
                      {faNum(idx + 1)}
                    </td>
                    <td className="p-3 border border-slate-200 font-mono text-center font-bold text-indigo-950">
                      {faNum(st.studentCode)}
                    </td>
                    <td className="p-3 border border-slate-200 font-extrabold text-slate-900">
                      <div className="flex items-center justify-between gap-2">
                        <span>{st.fullName}</span>
                        {is3AbsencesWarning && (
                          <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-3xs border border-rose-300">
                            ⚠️ ماده ۳/۱۶ (غیبت: {faNum(totalAbsentsWithCurrent)})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 border border-slate-200 text-center font-bold">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${priorAbsents > 2 ? 'bg-rose-100 text-rose-900 font-extrabold' : 'bg-slate-100 text-slate-800'}`}>
                        {faNum(priorAbsents)} جلسه
                      </span>
                    </td>
                    <td className="p-2 border border-slate-200">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setStudentStatus(st.id, 'PRESENT')}
                          className={`px-2.5 py-1.5 rounded-xl font-bold text-2xs transition ${
                            recorded?.status === 'PRESENT'
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          🟢 حاضر
                        </button>
                        <button
                          type="button"
                          onClick={() => setStudentStatus(st.id, 'ABSENT')}
                          className={`px-2.5 py-1.5 rounded-xl font-bold text-2xs transition ${
                            recorded?.status === 'ABSENT'
                              ? 'bg-rose-600 text-white shadow-xs'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          🔴 غایب
                        </button>
                        <button
                          type="button"
                          onClick={() => setStudentStatus(st.id, 'EXCUSED')}
                          className={`px-2.5 py-1.5 rounded-xl font-bold text-2xs transition ${
                            recorded?.status === 'EXCUSED'
                              ? 'bg-amber-500 text-slate-950 shadow-xs'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          🟡 موجه
                        </button>
                        <button
                          type="button"
                          onClick={() => setStudentStatus(st.id, 'LATE')}
                          className={`px-2.5 py-1.5 rounded-xl font-bold text-2xs transition ${
                            recorded?.status === 'LATE'
                              ? 'bg-sky-600 text-white shadow-xs'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          🔵 تاخیر
                        </button>

                        {recorded?.status === 'LATE' && (
                          <div className="flex items-center gap-1 mr-1">
                            <input
                              type="number"
                              min={1}
                              max={60}
                              value={sessionAtt.lateMinutes || 15}
                              onChange={e => setStudentLateMinutes(st.id, Number(e.target.value))}
                              className="w-12 border border-slate-300 rounded-lg p-1 text-center font-bold text-xs"
                            />
                            <span className="text-3xs text-slate-500">دقیقه</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="p-2 border border-slate-200">
                      <input
                        type="text"
                        value={sessionAtt.note || ''}
                        onChange={e => setStudentNote(st.id, e.target.value)}
                        placeholder="ثبت توضیح..."
                        className="w-full border border-slate-300 rounded-lg p-1.5 text-xs text-slate-800"
                      />
                    </td>
                  </tr>
                );
              })}
              {visibleStudents.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 border border-slate-200 text-center text-slate-500 font-bold">
                    دانشجویی با این جست‌وجو/فیلتر یافت نشد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Make-up Sessions Status Tracker for Professor */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div>
            <h3 className="font-extrabold text-slate-900 text-base">
              📑 وضعیت و تاریخچه جلسات جبرانی ثبت‌شده
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              جلساتی که مستقیماً در کلاس خالی ثبت شده یا جهت تعیین سالن ویژه به آموزش ارجاع داده شده‌اند.
            </p>
          </div>
        </div>

        {makeupHistory.length === 0 ? (
          <div className="text-center p-6 bg-slate-50 rounded-2xl text-xs font-bold text-slate-500">
            هیچ جلسه جبرانی برای این درس ثبت نشده است.
          </div>
        ) : (
          <div className="space-y-3">
            {makeupHistory.map(req => (
              <div key={req.id} className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-slate-900 text-sm">{req.courseTitle} (گروه {faNum(req.groupNumber)})</span>
                    <span className="text-xs text-slate-600 font-bold">مدرس: {req.professorName}</span>
                    <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-bold text-3xs">
                      جبران جلسه {faNum(req.replacedSessionNo)}
                    </span>
                  </div>

                  <div>
                    {req.status === 'REJECTED' ? (
                      <span className="px-3 py-1 rounded-full bg-rose-100 text-rose-900 font-black text-xs border border-rose-300">
                        ✕ رد شده توسط آموزش
                      </span>
                    ) : req.status === 'APPROVED_DIRECT' || req.status === 'APPROVED_BY_EDUCATION' ? (
                      <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 font-black text-xs border border-emerald-300">
                        ✓ تایید و ابلاغ شد (مکان: {req.roomName})
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-900 font-black text-xs border border-amber-300 animate-pulse">
                        ⏳ در انتظار تخصیص کلاس توسط آموزش
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500 block">زمان برگزاری:</span>
                    <span className="font-bold text-slate-900">{req.sessionDate} — ساعت {req.sessionTime}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">محل تشکیل:</span>
                    <span className="font-extrabold text-indigo-950">🏛️ {req.roomName}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">سرفصل تدریس:</span>
                    <span className="font-bold text-slate-700">{req.topic}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MODAL: Professor Creates Make-up Session & Selects Free Classrooms Directly */}
      {showMakeupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 animate-scaleUp text-slate-900">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h3 className="font-extrabold text-base text-slate-900">
                ➕ ایجاد و تخصیص کلاس جلسه جبرانی
              </h3>
              <button onClick={() => setShowMakeupModal(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>

            <p className="text-xs text-slate-600 leading-5">
              استاد گرامی، در این فرم می‌توانید از میان <b>کلاس‌های خالی و در دسترس دانشگاه در تاریخ و ساعت انتخابی</b>، مستقیماً کلاس مورد نظر را انتخاب و نهایی فرمایید. در صورت عدم وجود کلاس مناسب، درخواست جهت تخصیص سالن ویژه به آموزش ارسال خواهد شد.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">جلسه غیبت مورد نظر جهت جبران:</label>
                <select
                  value={makeupForm.replacedSessionNo}
                  onChange={e => setMakeupForm({ ...makeupForm, replacedSessionNo: Number(e.target.value) })}
                  className="w-full border border-slate-300 rounded-xl p-2.5 font-bold"
                >
                  {currentOffering.sessions.filter(s => s.professorStatus === 'ABSENT' || s.isHeld).map(s => (
                    <option key={s.sessionNo} value={s.sessionNo}>
                      جلسه {faNum(s.sessionNo)} (مورخ {s.sessionDate}) {s.professorStatus === 'ABSENT' ? '🔴 غیبت استاد' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    تاریخ برگزاری (باید بعد از {todayJalali} باشد):
                  </label>
                  <input
                    type="text"
                    value={makeupForm.sessionDate}
                    onChange={e => setMakeupForm({ ...makeupForm, sessionDate: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl p-2.5 font-bold font-mono"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">ساعت تشکیل:</label>
<select
                  value={makeupForm.sessionTime}
                  onChange={e => setMakeupForm({ ...makeupForm, sessionTime: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2.5 font-bold"
                >
                  <option value="">انتخاب بازهٔ ساعتی…</option>
                  {MAKEUP_TIME_OPTIONS.map(t => (
                    <option key={t} value={t}>{t.replace('الی', 'الی')}</option>
                  ))}
                </select>
                </div>
              </div>

              {/* Free Classrooms Selector */}
              <div>
                <label className="font-extrabold text-slate-900 block mb-1">
                  🏛️ انتخاب کلاس (لیست واقعی کلاس‌های دانشگاه — هماهنگی نهایی با آموزش):
                </label>
                <select
                  value={selectedRoomOptionId}
                  onChange={e => setSelectedRoomOptionId(Number(e.target.value))}
                  className="w-full border-2 border-indigo-500 rounded-xl p-2.5 font-extrabold bg-indigo-50/50 text-indigo-950"
                >
                  {realRooms.length === 0 && (
                    <option value={0}>🏢 بدون کلاس — درخواست تخصیص از ادارهٔ آموزش</option>
                  )}
                  {realRooms.map(room => (
                    <option key={room.id} value={room.id}>
                      🏫 {room.name} (ظرفیت {faNum(room.capacity)} نفر)
                    </option>
                  ))}
                  {realRooms.length > 0 && (
                    <option value={0}>🏢 سایر / درخواست تخصیص از ادارهٔ آموزش</option>
                  )}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">سرفصل و مبحث تدریس جلسه جبرانی:</label>
                <input
                  type="text"
                  value={makeupForm.topic}
                  onChange={e => setMakeupForm({ ...makeupForm, topic: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2.5 font-bold"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">دلیل برگزاری جلسه جبرانی:</label>
                <input
                  type="text"
                  value={makeupForm.reason}
                  onChange={e => setMakeupForm({ ...makeupForm, reason: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2.5 font-bold"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-200">
              <button
                onClick={handleCreateMakeupSession}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-800 text-white font-extrabold text-xs transition shadow-md"
              >
                {selectedRoomOptionId !== 0 ? '✓ ثبت و تخصیص مستقیم کلاس جبرانی' : '🚀 ارسال به آموزش جهت تخصیص سالن'}
              </button>
              <button
                onClick={() => setShowMakeupModal(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── برگهٔ چاپی: کل جلسات درس در یک برگهٔ افقی (ماتریس دانشجو × جلسه) ── */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <h3 className="text-sm font-black text-slate-900">
            🖨️ برگهٔ حضور کل جلسات — همهٔ جلسات در یک برگه (افقی)
          </h3>
          <PrintTranscriptButton orientation="landscape" label="چاپ / ذخیره PDF" />
        </div>
        <AttendanceMatrixSheet
          professor={{ name: profDisplayName, staffCode: professor.staffCode, academicRank: professor.academicRank }}
          termTitle={termTitle}
          offering={currentOffering}
          todayJalali={todayJalali}
        />
      </div>

    </div>
  );
}

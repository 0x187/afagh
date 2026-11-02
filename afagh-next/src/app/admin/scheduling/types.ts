// ═══════════════════════════════════════════════════════════════════════
//  قرارداد دادهٔ کارتابل برنامه‌ریزی درسی — فقط type/interface (بدون React).
//  SchedulingWorkspace دقیقاً خروجی getSchedulingWorkspaceAction است.
// ═══════════════════════════════════════════════════════════════════════

export type WeekRecurrence = 'ALL' | 'EVEN' | 'ODD';
export type ProgramShiftType = 'MORNING' | 'AFTERNOON_WORKING' | 'FLEXIBLE';

export interface TimeSlot {
  id: number;
  label: string;
  startTime: string; // e.g. "07:30" or "08:00"
  endTime: string;   // e.g. "09:00" or "09:30"
  isBreak: boolean;  // prayer/lunch or class
}

export interface AcademicTerm {
  id: number;
  code: string;
  title: string;
  isCurrent: boolean;
}

export interface AcademicProgram {
  id: number;
  code: string;
  title: string;
  facultyName: string;
  degreeLevel: string;
  preferredShift: ProgramShiftType;
}

export interface CohortOption {
  id: string;
  entryYear: string;
  semesterNo: number;
  title: string;
  expectedStudents: number;
  majorId?: number | null;
  isEmployedAudience?: boolean;
}

export interface ClassroomOption {
  id: number;
  name: string;
  buildingName: string;
  capacity: number;
  roomType: 'THEORY' | 'LAB' | 'GYM' | 'EXAM';
  equipment: string[];
  isActive: boolean;
  isAllocatedToDept: boolean;
}

export interface ProfessorOption {
  id: number;
  name: string;
  staffCode: string;
  academicRank: string;
  contractType: 'تمام‌وقت' | 'نیمه‌وقت' | 'مدعو';
  /** گروه آموزشی استاد — کشویی هر درس فقط استادان همین گروه را نشان می‌دهد */
  departmentId: number | null;
  departmentName: string;
  maxWeeklyUnits: number;
  maxDailyHours: number;
  hasSubmittedAvailability: boolean;
}
export type SlotStatus = 'PREF' | 'AVAIL' | 'UNAVAIL';

// [profId][dayIndex (0..6)][slotId] = SlotStatus
export interface ProfessorAvailabilityMap {
  [profId: number]: {
    [dayOfWeek: number]: {
      [slotId: number]: SlotStatus;
    };
  };
}

export interface CourseDemand {
  id: number;
  courseId: number;
  courseDeptId: number | null;
  programId: number;
  programTitle: string;
  /** رشته‌هایی که این درس به آن‌ها تعلق دارد؛ خالی = درس مشترک بین رشته‌ها */
  programIds?: number[];
  /** شمارهٔ ترم پیشنهادی چارت؛ null = تعیین‌نشده */
  semesterNo?: number | null;
  cohortId: string;
  cohortTitle: string;
  /** ادغام مهر+بهمن برای این ارائه فعال است */
  cohortMerged?: boolean;
  code: string;
  title: string;
  units: number;
  groupNumber: number;
  /** نوع درس واقعی از courses.courseType — دامنهٔ مقادیر باز است (پایه/اصلی/تخصصی/عمومی/اختیاری/نظری-عملی/کارورزی/پروژه/…)، پس رشته است نه اتحادیهٔ بسته. */
  courseType: string;
  /** رتبهٔ نوع درس برای مرتب‌سازی: عمومی و مشترک اول، سپس پایه، سپس تخصصی/اختصاصی */
  courseTypeRank?: number;
  preferredProfId: number;
  groupProfessors?: { [groupNo: number]: number };
  isCoTaught?: boolean;
  coProfId?: number;
  theoryWeightRatio?: number; // e.g. 0.70 (14 marks out of 20)
  labWeightRatio?: number;    // e.g. 0.30 (6 marks out of 20)
  requiredRoomType: 'THEORY' | 'LAB' | 'GYM';
  capacity: number;
  /** تعداد ثبت‌نام‌شدهٔ واقعی — مبنای پیشنهاد خودکار تعداد گروه */
  enrolledCount: number;
  groupsCount: number;
  weekRecurrence: WeekRecurrence;
  sessionsCountPerWeek: number;
  examDate: string;
  examSchedulingMode?: 'AUTO_MATRIX' | 'MANUAL';
  isSharedService?: boolean;
  offeringScope?: string;
}

export interface DepartmentOffering {
  id: number;
  termId: number;
  programId: number;
  programTitle: string;
  cohortId: string;
  cohortTitle: string;
  courseId: number;
  code: string;
  title: string;
  units: number;
  courseType: string;
  groupNumber: number;
  professorId: number | null;
  professorName: string;
  isCoTaught?: boolean;
  coProfId?: number | null;
  coProfName?: string;
  theoryWeightRatio?: number;
  labWeightRatio?: number;
  capacity: number;
  enrolledCount: number;
  waitlistCapacity: number;
  classSchedules: {
    dayOfWeek: number;
    dayName: string;
    slotId: number;
    startTime: string;
    endTime: string;
    roomId: number;
    roomName: string;
    buildingName: string;
    weekType: WeekRecurrence;
  }[];
  examSchedule: {
    examDate: string;
    startTime: string;
    endTime: string;
    roomName: string;
  } | null;
  courseDeptId?: number | null;
  offeringId?: number;
  genderRestriction?: 'MIXED' | 'MALE' | 'FEMALE';
  classroomId?: number | null;
  dayOfWeek?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  programIds?: number[];
  semesterNo?: number | null;
  cohortMerged?: boolean;
  examDate?: string | null;
  examMode?: 'WRITTEN' | 'ORAL' | 'PROJECT' | 'ONLINE';
  examTime?: string | null;
  examRoomId?: number | null;
  isSharedService?: boolean;
  offeringScope?: string;
}

export interface AutoScheduleScenario {
  id: 'COMPACT' | 'BALANCED' | 'PROF_PREF' | 'AFTERNOON_WORKING';
  title: string;
  subtitle: string;
  description: string;
  badgeColor: string;
  accentBorder: string;
  bgGradient: string;
  kpi: {
    daysPerWeek: string;
    profSatisfaction: string;
    conflictsRate: string;
    roomEfficiency: string;
    studentComfort: string;
    commuteScore: string;
  };
  offerings: DepartmentOffering[];
}
export interface SchedulingWorkspace {
  terms: { id: number; code: string; title: string; isCurrent: boolean }[];
  selectedTermId: number | null;
  programs: { id: number; code: string; title: string; facultyName: string; degreeLevel: string; facultyId: number | null }[];
  cohorts: { majorId: number | null; entryYear: number; entryTerm: number; expectedStudents: number }[];
  classrooms: { id: number; name: string; buildingName: string; capacity: number; roomType: string }[];
  allocatedRoomIds: number[];
  roomGrants: { id: number; classroomId: number; shift: string; ownerDepartmentId: number; status: string }[];
  professors: { id: number; name: string; staffCode: string | null; academicRank: string | null; departmentId: number | null; departmentName: string | null }[];
  demands: {
    offeringId: number; courseId: number; courseDeptId: number | null;
    code: string; title: string; units: string; courseType: string;
    capacity: number; groupNumber: number; professorId: number | null; isCoTaught: boolean;
    coProfId: number | null;
    enrolledCount: number; programId: number; programTitle: string;
    /** رشته‌هایی که این درس به آن‌ها تعلق دارد (چارت درسی). خالی = مشترک/نامشخص */
    programIds: number[];
    /** شمارهٔ ترم پیشنهادی چارت (فاز ۰: رشته × ترم) — null = در چارت تعیین نشده */
    semesterNo: number | null;
    cohortId: string; cohortTitle: string;
    /** ادغام صریح مهر+بهمن روی همین ارائه ثبت شده است */
    cohortMerged: boolean;
    /** تاریخ امتحان واقعی از schedules(scheduleType='EXAM') — خالی یعنی هنوز تعیین نشده */
    examDate: string;
    isSharedService: boolean;
    offeringScope: string;
  }[];
  departments: { id: number; name: string }[];
  availabilities: { staffId: number; dayOfWeek: number | null; startTime: string | null; endTime: string | null; status: string | null }[];
  phases: Record<number, string>;
  termCalendar: {
    id: number;
    startJalali: string | null; endJalali: string | null; startDate: string | null;
    /** تعریف ترم = منبع حقیقت تقویم برنامه‌ریزی (نه اعداد پیش‌فرض UI) */
    weeksCount: number | null;
    classStartJalali: string | null; classEndJalali: string | null;
    examStartJalali: string | null; examEndJalali: string | null;
  } | null;
  sessionsTotal: number;
  sessionsByOffering: Record<number, { total: number; makeup: number; firstDate: string | null }>;
  hardConflictCount: number;
  approvedOfferings: {
    offeringId: number; code: string; title: string; units: string; courseType: string;
    groupNumber: number; professorId: number | null; professorName: string; capacity: number;
    enrolledCount: number; dayOfWeek: number | null; dayName: string; startTime: string;
    endTime: string; roomId: number | null; roomName: string; buildingName: string;
  }[];
  makeupSessions: {
    id: number; courseCode: string; courseTitle: string; profName: string;
    sessionNo: number; sessionDate: string; sessionTime: string; replacedSessionId: number | null;
  }[];
}

/** تب‌های اصلی کارتابل (کلید رندر در Shell) */
export type PlanningTab =
  | 'PROGRAM_SCOPE'
  | 'CURRICULUM_ASSIGN' | 'PROF_QUOTAS' | 'DEPT_ROOMS' | 'SCENARIOS'
  | 'PROFESSOR_SCHEDULE' | 'APPROVED' | 'TERM_CALENDAR';

/** فیلتر نمای هفته — «کلیه» حالت نمایشی است، نه نوع تکرار */
export type WeekView = WeekRecurrence | 'ALL_VIEW';

export type ToastKind = 'success' | 'info' | 'warning';
export type ToastMsg = { text: string; type: ToastKind };

/** تنظیمات تقویم نیمسال (گام ۷) */
export type TermCalendarConfig = {
  classStartDate: string;
  classEndDate: string;
  examStartDate: string;
  examEndDate: string;
  holidays: string;
  sessionsCount: number;
};

/** نمای جلسهٔ تولیدشده برای هر ارائه */
export type SessionsByOffering = Record<number, { total: number; makeup: number; firstDate: string | null }>;

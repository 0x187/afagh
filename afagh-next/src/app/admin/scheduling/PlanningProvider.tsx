'use client';

// ═══════════════════════════════════════════════════════════════════════
//  تنها صاحب «وضعیت» کارتابل: ۴۰ useState + Server Actionها + مشتقات useMemo.
//  تب‌ها هیچ state خودی ندارند و فقط از usePlanning() می‌خوانند؛ محاسبات هم
//  در planning-core.ts است (تابع خالص، قابل Unit Test).
// ═══════════════════════════════════════════════════════════════════════

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { faNum, parseJalaliDates, PHASE_LABELS, TIME_SLOT_PRESETS, DEMAND_PAGE, NO_PROFESSOR, MAX_GROUPS_PER_COURSE, clampGroupsCount, mapDemands, mapClassrooms, mapProfessors, mapCohorts, mapOfferings, buildRealScenario, computeProfUnits, slotAvailStatus, filterScenarioOfferings, filterContextDemands, inspectorSummary, nextGroupNumber, coTeachingWeights, resolveTab, programSemesterMatrix, cohortSemesterNo } from './planning-core';
import type { PlanningTab, WeekRecurrence, ProgramShiftType, TimeSlot, CohortOption, ClassroomOption, ProfessorOption, CourseDemand, DepartmentOffering, AutoScheduleScenario, SchedulingWorkspace } from './types';
import { getSchedulingWorkspaceAction, getRoomGrantsAction, generateClassSessionsAction, supplyGroupDraftsAction, getSmartSuggestionsAction, getSchedulingHealthAction, transitionSchedulingPhaseAction, getCurriculumDemandsAction, setOfferingCohortMergeAction } from './actions';
import type { SmartSlot, SchedulingHealthReport, SchedulingWorkspaceResult, CurriculumDemandsResult } from './actions';

/**
 * scope = 'admin'  → کارتابل دانشگاهی (مدیر آموزش / کارشناس): گذار فاز، تولید جلسات ترم،
 *                     پیوند به ماژول امتحانات و چارت کلی دانشگاه.
 * scope = 'dept'   → همان کارتابل برای مدیر گروه: دادهٔ محدود به دپارتمان‌های تحت مدیریت،
 *                     و عملیات دانشگاهی (گذار فاز / تولید جلسات) قفل و پنهان است.
 */
export type PlanningScope = 'admin' | 'dept';

function useDepartmentPlanning(initial: SchedulingWorkspace, initialTab?: string | null, timeSlotsInit?: TimeSlot[], scope: PlanningScope = 'admin') {
  // Global Planning Context — همه از دادهٔ واقعی سرور (getSchedulingWorkspaceAction)
  const [selectedTermId, setSelectedTermId] = useState<number>(initial.selectedTermId ?? 0);
  const [selectedProgramId, setSelectedProgramId] = useState<number>(initial.programs[0]?.id ?? 0);
  const [selectedCohortId, setSelectedCohortId] = useState<string>('ALL');
  // فاز ۰: ترمِ چارتِ رشته. 'ALL' = همهٔ ترم‌ها، 'NONE' = دروس بدون ترمِ تعیین‌شده
  const [selectedSemester, setSelectedSemester] = useState<number | 'ALL' | 'NONE'>('ALL');
  const [targetShiftPreference, setTargetShiftPreference] = useState<ProgramShiftType>('AFTERNOON_WORKING');

  // فعال‌های واقعی
  const [terms, setTerms] = useState(initial.terms);
  const [programs, setPrograms] = useState(initial.programs);
  const [cohorts, setCohorts] = useState<CohortOption[]>(() => mapCohorts(initial.cohorts));
  const [currentPhase, setCurrentPhase] = useState<string>(initial.phases[initial.selectedTermId ?? 0] ?? 'SUPPLY');
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);

  // Time Slots / Bell Schedule State
  const [activeSlotPresetKey, setActiveSlotPresetKey] = useState<'STANDARD_120' | 'STANDARD_90' | 'STANDARD_60'>('STANDARD_120');
  // زنگ‌ها از تنظیمات دانشگاه می‌آیند (اگر نرسد، الگوی ۲ ساعتهٔ پیش‌فرض)
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(() => (timeSlotsInit && timeSlotsInit.length ? timeSlotsInit : TIME_SLOT_PRESETS.STANDARD_120.slots));

  // Timetable View Mode: ALL (تمام جلسات), EVEN (هفته زوج), ODD (هفته فرد)
  const [selectedWeekFilter, setSelectedWeekFilter] = useState<WeekRecurrence | 'ALL_VIEW'>('ALL_VIEW');

  // Main Tabs — تب آغازین از ?tab= می‌آید (پیوندپذیری + تست مستقل هر تب)
  const [activeMainTab, setActiveMainTab] = useState<PlanningTab>(resolveTab(initialTab));

  // Academic Term Calendar Configuration — کاملاً از ردیف واقعی academic_terms
  // (weeksCount + تاریخ‌های کلاس و امتحان). قبلاً هفته‌ها همیشه ۱۶ و تاریخ‌ها خالی بود.
  const [calendarConfig, setCalendarConfig] = useState({
    classStartDate: initial.termCalendar?.classStartJalali ?? '',
    classEndDate: initial.termCalendar?.classEndJalali ?? '',
    examStartDate: initial.termCalendar?.examStartJalali ?? '',
    examEndDate: initial.termCalendar?.examEndJalali ?? '',
    holidays: '',
    sessionsCount: initial.termCalendar?.weeksCount ?? 16,
  });

  const [generatedTermSessionsCount, setGeneratedTermSessionsCount] = useState<number>(initial.sessionsTotal);
  const [sessionsByOffering, setSessionsByOffering] = useState<Record<number, { total: number; makeup: number; firstDate: string | null }>>(initial.sessionsByOffering);
  const [makeupSessions, setMakeupSessions] = useState(initial.makeupSessions);
  const [hardConflictCount, setHardConflictCount] = useState<number>(initial.hardConflictCount);
  const [isGeneratingSessions, setIsGeneratingSessions] = useState(false);

  // Core Data — آرایه‌های واقعی (بدون Mock)
  const [classrooms, setClassrooms] = useState<ClassroomOption[]>(() => mapClassrooms(initial.classrooms, initial.allocatedRoomIds));
  const [roomGrants, setRoomGrants] = useState(initial.roomGrants ?? []);
  const [professors, setProfessors] = useState<ProfessorOption[]>(() => mapProfessors(initial.professors, initial.availabilities));
  const [realAvailRows, setRealAvailRows] = useState<SchedulingWorkspace['availabilities']>(initial.availabilities);
  const [courseDemands, setCourseDemands] = useState<CourseDemand[]>(() => mapDemands((initial as any).demands));

  // Inspector
  const [inspectorProfId, setInspectorProfId] = useState<number>(initial.professors[0]?.id ?? 1);
  // برنامهٔ مصوب واقعی از جدول schedules — تنها منبع جدول‌های نمایشی
  const [approvedOfferings, setApprovedOfferings] = useState<DepartmentOffering[]>(() => mapOfferings(initial.approvedOfferings));
  const [currentRealScenario, setCurrentRealScenario] = useState<AutoScheduleScenario>(() =>
    buildRealScenario(mapOfferings(initial.approvedOfferings), initial.hardConflictCount, initial.sessionsTotal, initial.allocatedRoomIds.length)
  );

  // فاز ۱۲ — پیشنهاد هوشمند موتور (سرور) + تأمین گروه‌ها + سلامت برنامه
  const [suggestedDemandId, setSuggestedDemandId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<SmartSlot[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [supplying, setSupplying] = useState(false);
  const [phaseBusy, setPhaseBusy] = useState(false);
  const [health, setHealth] = useState<SchedulingHealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [ownedDeptId, setOwnedDeptId] = useState<number>(initial.departments[0]?.id ?? 0);

  // Curriculum-based demands (filtered by selected program)
  const [curriculumDemands, setCurriculumDemands] = useState<CourseDemand[]>([]);
  const [isLoadingCurriculumDemands, setIsLoadingCurriculumDemands] = useState(false);
  // بازهٔ ورودیِ چارتِ واقعاً استفاده‌شده («چارت معتبر برای ورودی ۱۴۰۱ تا ۱۴۰۴»)
  const [chartRange, setChartRange] = useState<{ from: number; to: number | null } | null>(null);

  // Modal: مشاهدهٔ فرم واقعی درٔ دسترس بودن استاد (ثبت‌شده توسط خودِ استاد)
  const [isProfAvailabilityModalOpen, setIsProfAvailabilityModalOpen] = useState<boolean>(false);
  const [editingProfId, setEditingProfId] = useState<number>(initial.professors[0]?.id ?? 1);

  // Modals / Toasts
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'warning' } | null>(null);


  const showToast = (text: string, type: 'success' | 'info' | 'warning' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4500);
  };

  /** اعمال کامل یک کارتابل واقعی (استفاده در بارگذاری اولیه، تغییر ترم و بعد از هر تغییر) */
  const applyWorkspace = (w: Extract<SchedulingWorkspaceResult, { ok: true }>) => {
    const ww: any = w;
    setTerms(ww.terms);
    setPrograms(ww.programs);
    setCohorts(mapCohorts((ww.cohorts || []).map((c: any) => ({ ...c, entryTerm: c.entryTerm ?? 1 }))));
    setCurrentPhase(ww.phases[selectedTermId] ?? 'SUPPLY');
    setClassrooms(mapClassrooms(ww.classrooms, ww.allocatedRoomIds));
    setRoomGrants(ww.roomGrants ?? []);
    setProfessors(mapProfessors(ww.professors as any, ww.availabilities));
    setRealAvailRows(ww.availabilities);
    setCourseDemands(mapDemands(ww.demands as any));
    setApprovedOfferings(mapOfferings(ww.approvedOfferings as any));
    setCurrentRealScenario(buildRealScenario(mapOfferings(ww.approvedOfferings as any), ww.hardConflictCount, ww.sessionsTotal, ww.allocatedRoomIds.length));
    setGeneratedTermSessionsCount(ww.sessionsTotal);
    setSessionsByOffering(ww.sessionsByOffering);
    setMakeupSessions(ww.makeupSessions);
    setHardConflictCount(ww.hardConflictCount);
    setSuggestions([]);
    setHealth(null);
    setCalendarConfig(cfg => ({
      ...cfg,
      classStartDate: ww.termCalendar?.classStartJalali ?? ww.termCalendar?.startJalali ?? '',
      classEndDate: ww.termCalendar?.classEndJalali ?? ww.termCalendar?.endJalali ?? '',
      examStartDate: ww.termCalendar?.examStartJalali ?? '',
      examEndDate: ww.termCalendar?.examEndJalali ?? '',
      sessionsCount: ww.termCalendar?.weeksCount ?? cfg.sessionsCount,
    }));
  };

  /** تغییر نیمسال → بارگذاری مجدد واقعی از Server Action */
  useEffect(() => {
    const baseId = initial.selectedTermId ?? 0;
    if (selectedTermId === baseId) return;
    let cancelled = false;
    setIsLoadingWorkspace(true);
    getSchedulingWorkspaceAction(selectedTermId)
      .then(w => {
        if (cancelled || !w.ok) return;
        applyWorkspace(w);
      })
      .catch(() => showToast('⚠️ بارگذاری دادهٔ نیمسال از سرور ناموفق بود.', 'warning'))
      .finally(() => { if (!cancelled) setIsLoadingWorkspace(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTermId]);

  /** بازخوانی کارتابل از سرور (بعد از تأمین/تخصیص/گذار فاز) */
  const reloadWorkspace = () => {
    if (!selectedTermId) return;
    setIsLoadingWorkspace(true);
    getSchedulingWorkspaceAction(selectedTermId)
      .then(w => {
        if (!w.ok) { showToast(w.error, 'warning'); return; }
        applyWorkspace(w);
      })
      .catch(() => showToast('⚠️ بازخوانی کارتابل ناموفق بود.', 'warning'))
      .finally(() => setIsLoadingWorkspace(false));
  };

  /** بازخوانی سبک فقط سهمیه‌های سالن (بعد از تخصیص/لغو/واگذاری) — بدون بارگذاری سنگین کل کارتابل */
  const reloadRoomGrants = () => {
    if (!selectedTermId) return;
    getRoomGrantsAction(selectedTermId)
      .then(res => {
        if (!res.ok) { showToast(res.error, 'warning'); return; }
        setRoomGrants(res.roomGrants ?? []);
        setClassrooms(prev => prev.map(c => ({ ...c, isAllocatedToDept: (res.allocatedRoomIds ?? []).includes(c.id) })));
      })
      .catch(() => showToast('⚠️ بازخوانی سهمیه‌های سالن ناموفق بود.', 'warning'));
  };

  /** بارگذاری دروس چارت درسی برای رشته انتخاب‌شده */
  const loadCurriculumDemands = async () => {
    if (!selectedTermId || !selectedProgramId) return;
    setIsLoadingCurriculumDemands(true);
    try {
      // سال ورودیِ دانشجو تعیین می‌کند کدام نسخهٔ چارت معتبر است
      const entryYear = selectedCohortId === 'ALL' ? null : Number(selectedCohortId.split('-')[0]) || null;
      const res = await getCurriculumDemandsAction(selectedTermId, selectedProgramId, entryYear);
      if (!res.ok) { showToast(res.error, 'warning'); setCurriculumDemands([]); return; }
      setChartRange(res.chartRange ?? null);
      setCurriculumDemands(mapDemands((res as any).demands || []) as any);
    } catch {
      showToast('⚠️ بارگذاری دروس چارت ناموفق بود.', 'warning');
      setCurriculumDemands([]);
    } finally {
      setIsLoadingCurriculumDemands(false);
    }
  };

  // بارگذاری دروس چارت عند تغییر رشته یا ترم
  useEffect(() => {
    loadCurriculumDemands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTermId, selectedProgramId, selectedCohortId]);

  /** پیشنهاد هوشمند موتور برای یک درس (درٔ دسترس بودن واقعی استاد + اشغال سالن‌ها + زونینگ) */
  const handleSuggestForDemand = async (demandId: number) => {
    const d = courseDemands.find(x => x.id === demandId);
    if (!d || !selectedTermId) return;
    if (!d.preferredProfId) {
      showToast('برای این درس هنوز استادی تعیین نشده است — ابتدا استاد را در گام ۱ انتساب دهید.', 'warning');
      return;
    }
    setSuggestedDemandId(demandId);
    setSuggestLoading(true);
    try {
      const program = programs.find(p => p.id === d.programId);
      const res = await getSmartSuggestionsAction({
        termId: selectedTermId,
        professorId: d.preferredProfId,
        capacity: d.capacity,
        targetFacultyId: program?.facultyId ?? null,
      });
      if (!res.ok) { showToast(res.error, 'warning'); setSuggestions([]); return; }
      setSuggestions(res.suggestions);
      if (!res.suggestions.length) {
        showToast('هیچ اسلات آزادی نیست — احتمالاً استاد هنوز درٔ دسترس بودن خود را برای این ترم اعلام نکرده است (پنل استاد).', 'info');
      }
    } finally {
      setSuggestLoading(false);
    }
  };

  /** ثبت واقعی گروه از پیشنهاد موتور: درج offering + schedule + offering_professors (موتور سرور) */
  const handleSupplyFromSuggestion = async (d: CourseDemand, slot: SmartSlot) => {
    if (!selectedTermId) return;
    const groupNumber = nextGroupNumber(approvedOfferings.filter(o => o.code === d.code).map(o => o.groupNumber));
    setSupplying(true);
    try {
      const res = await supplyGroupDraftsAction({
        termId: selectedTermId,
        courseId: d.courseId,
        ownerDepartmentId: d.courseDeptId ?? ownedDeptId,
        isSharedService: false,
        drafts: [{
          groupNumber, capacity: d.capacity, gender: 'MIXED' as const,
          professorId: d.preferredProfId, classroomId: slot.classroomId,
          dayOfWeek: slot.dayOfWeek, startTime: slot.startTime, endTime: slot.endTime,
        }],
      });
      if (!res.ok) { showToast(res.error ?? 'تأمین گروه ناموفق بود.', 'warning'); return; }
      showToast(`✅ گروه ${faNum(groupNumber)} درس «${d.title}» عرضه و در schedules ثبت شد (شناسهٔ ارائه: ${faNum(res.offeringIds[0] ?? 0)}).`, 'success');
      reloadWorkspace();
    } catch {
      showToast('خطا در ارتباط با سرور.', 'warning');
    } finally {
      setSupplying(false);
    }
  };

  /** گذار فاز برنامه‌ریزی (گیت «انتشار بدون تداخل سخت» در سرور) */
  const handlePhaseTransition = async (to: 'ALLOCATION' | 'REVIEW' | 'PUBLISHED') => {
    if (!selectedTermId) return;
    setPhaseBusy(true);
    try {
      const res = await transitionSchedulingPhaseAction(selectedTermId, to);
      if (!res.ok) { showToast(res.error ?? 'گذار فاز ناموفق بود.', 'warning'); return; }
      setCurrentPhase(res.phase ?? to);
      showToast(`فاز برنامه‌ریزی به «${PHASE_LABELS[to] ?? to}» تغییر کرد.`, 'success');
      reloadWorkspace();
    } finally {
      setPhaseBusy(false);
    }
  };

  /**
   * ادغام/جداکردن نیمسال ورود یک ارائه (مهر + بهمن با هم).
   * ورودی بهمنِ کم‌جمعیت نباید کلاس جدا داشته باشد.
   */
  const handleToggleCohortMerge = async (offeringId: number, merge: boolean) => {
    try {
      const res = await setOfferingCohortMergeAction({ offeringId, merge });
      if (!res.ok) { showToast(res.error, 'warning'); return; }
      setCourseDemands(prev => prev.map(d => d.id === offeringId
        ? {
            ...d,
            cohortMerged: merge,
            cohortTitle: merge
              ? `نیمسال‌های ورود ${res.entryYearStart ?? ''}–${res.entryYearEnd ?? ''} (ادغام‌شده)`
              : d.cohortTitle,
          }
        : d));
      showToast(merge ? '✅ این ارائه برای هر دو نیمسال ورود (مهر و بهمن) اعلام شد.' : 'ارائه به حالت تک‌نیمسال برگشت.', 'success');
      reloadWorkspace();
    } catch {
      showToast('خطا در ارتباط با سرور.', 'warning');
    }
  };

  /** عارضه‌یابی خودکار برنامه (عرضه در برابر تقاضا / تداخل پنهان / بهره‌وری سالن‌ها) */
  const handleRunHealth = async () => {
    if (!selectedTermId) return;
    setHealthLoading(true);
    try {
      const res = await getSchedulingHealthAction(selectedTermId);
      if (!res.ok) { showToast(res.error, 'warning'); return; }
      setHealth(res.health);
      showToast('گزارش سلامت برنامه با دادهٔ واقعی محاسبه شد.', 'success');
    } finally {
      setHealthLoading(false);
    }
  };

  /** تولید/بازتولید جلسات واقعی از schedules — Server Action با گیت قیود سخت */
  const handleGenerateSessions = async () => {
    if (!selectedTermId) return;
    setIsGeneratingSessions(true);
    try {
      const res = await generateClassSessionsAction({
        termId: selectedTermId,
        sessionsCount: calendarConfig.sessionsCount,
        holidays: parseJalaliDates(calendarConfig.holidays),
      });
      if (!res.ok) {
        showToast(`⚠️ ${res.error ?? 'خطا در تولید جلسات.'}`, 'warning');
        return;
      }
      setGeneratedTermSessionsCount(res.generated);
      setSessionsByOffering(Object.fromEntries(
        Object.entries(res.sessionsPerOffering).map(([offeringId, total]) => [
          Number(offeringId), { total, makeup: 0, firstDate: null },
        ])
      ));
      setHardConflictCount(res.hardConflicts.length);
      showToast(`⚡ ${faNum(res.generated)} جلسهٔ ترم برای ${faNum(res.offerings)} درس تولید و در تقویم ثبت شد.`, 'success');
    } finally {
      setIsGeneratingSessions(false);
    }
  };

  // Change professor assigned to a course in the chart
  const handleAssignProfessorToCourse = (demandId: number, profId: number) => {
    setCourseDemands(prev => prev.map(d => d.id === demandId ? { ...d, preferredProfId: profId } : d));
    const targetProf = professors.find(p => p.id === profId);
    showToast(`استاد «${targetProf?.name}» به عنوان مدرس این درس تعیین شد.`, 'info');
  };

  // Change professor assigned to a specific group of a course
  const handleAssignProfessorToGroup = (demandId: number, groupNo: number, profId: number) => {
    setCourseDemands(prev =>
      prev.map(d => {
        if (d.id !== demandId) return d;
        return {
          ...d,
          groupProfessors: {
            ...(d.groupProfessors || {}),
            [groupNo]: profId,
          },
        };
      })
    );
    const targetProf = professors.find(p => p.id === profId);
    showToast(`استاد «${targetProf?.name}» برای گروه ${groupNo} تعیین شد.`, 'info');
  };

  // Toggle Co-Teaching for a course
  const handleToggleCoTeaching = (demandId: number) => {
    setCourseDemands(prev =>
      prev.map(d => {
        if (d.id !== demandId) return d;
        const nextState = !d.isCoTaught;
        return {
          ...d,
          isCoTaught: nextState,
          coProfId: nextState ? (d.coProfId || professors.find(p => p.id !== d.preferredProfId)?.id) : undefined,
          theoryWeightRatio: nextState ? (d.theoryWeightRatio || 0.70) : undefined,
          labWeightRatio: nextState ? (d.labWeightRatio || 0.30) : undefined,
        };
      })
    );
    showToast('وضعیت تخصیص دو استاد (مشترک تئوری و عملی) تغییر یافت.', 'info');
  };

  // Assign Second / Lab Professor
  const handleAssignCoProfessor = (demandId: number, coProfId: number) => {
    setCourseDemands(prev => prev.map(d => (d.id === demandId ? { ...d, coProfId } : d)));
    const targetProf = professors.find(p => p.id === coProfId);
    showToast(`استاد همکار «${targetProf?.name}» جهت بخش عملی تعیین شد.`, 'info');
  };

  // Update Co-Teaching Weights (e.g. 70% theory, 30% lab)
  const handleUpdateCoWeights = (demandId: number, theoryPercent: number) => {
    const { theory, lab } = coTeachingWeights(theoryPercent);
    setCourseDemands(prev =>
      prev.map(d => (d.id === demandId ? { ...d, theoryWeightRatio: theory, labWeightRatio: lab } : d))
    );
  };

  // Change groups count for a course
  const handleUpdateCourseGroupsCount = (demandId: number, groups: number) => {
    const g = clampGroupsCount(groups);
    setCourseDemands(prev => prev.map(d => d.id === demandId ? { ...d, groupsCount: g } : d));
    showToast(`تعداد گروه‌های ارائه‌شونده به ${faNum(g)} گروه تغییر یافت.`, 'info');
  };

  // Toggle Exam Scheduling Mode (Auto vs Manual) for a course
  const handleToggleDemandExamMode = (demandId: number) => {
    setCourseDemands(prev =>
      prev.map(d =>
        d.id === demandId
          ? {
              ...d,
              examSchedulingMode: d.examSchedulingMode === 'MANUAL' ? 'AUTO_MATRIX' : 'MANUAL',
            }
          : d
      )
    );
    showToast('حالت زمان‌بندی تاریخ و ساعت امتحان این درس تغییر یافت.', 'info');
  };

  // Update Exam Date manually for a course
  const handleUpdateDemandExamDate = (demandId: number, date: string) => {
    setCourseDemands(prev =>
      prev.map(d => (d.id === demandId ? { ...d, examDate: date, examSchedulingMode: 'MANUAL' } : d))
    );
  };

  // Change max units cap for a professor
  const handleUpdateProfMaxUnits = (profId: number, maxUnits: number) => {
    setProfessors(prev => prev.map(p => p.id === profId ? { ...p, maxWeeklyUnits: maxUnits } : p));
    showToast('سقف پیش‌فرض محلی به‌روزرسانی شد — ستون دیتابیسی سقف در فاز بعدی (Migrations) اضافه می‌شود.', 'info');
  };



  // مشاهدهٔ فرم واقعی درٔ دسترس بودن استاد (خواندنی — ثبت فقط از پنل خودِ استاد)
  const handleOpenEditProfAvailability = (profId: number) => {
    setEditingProfId(profId);
    setIsProfAvailabilityModalOpen(true);
  };

  /** وضعیت واقعی اعلام درٔ دسترس بودن در یک اسلات (هستهٔ خالص) */
  const realAvailStatus = (profId: number, dayIdx: number, slot: TimeSlot) =>
    slotAvailStatus(realAvailRows, profId, dayIdx, slot);

  // بار واحد هر استاد (با تقسیم سهم تئوری/عملی در درس مشترک) — هستهٔ خالص
  // بر اساس «منبع تقاضای فعلی» (چارت رشته در صورت انتخاب، وگرنه همهٔ تقاضاهای ترم)
  // تا واحدهای نمایش‌داده‌شده با فیلتر رشته/ورودی هم‌خوان باشند.
  const profAssignedUnitsMap = useMemo(
    () => computeProfUnits(curriculumDemands.length > 0 ? curriculumDemands : courseDemands, professors),
    [courseDemands, curriculumDemands, professors],
  );

  // Computed state — تنها سناریوی مشروع: برنامهٔ مصوب (واقعی از DB)
  const currentScenario = useMemo(() => currentRealScenario, [currentRealScenario]);

  const currentProgram = useMemo(() => {
    return programs.find(p => p.id === selectedProgramId) || programs[0];
  }, [programs, selectedProgramId]);

  const currentTerm = useMemo(() => {
    return terms.find(t => t.id === selectedTermId) || terms[0];
  }, [terms, selectedTermId]);

  const displayedScenarioOfferings = useMemo(
    () => currentScenario
      ? filterScenarioOfferings(currentScenario.offerings, {
          programId: selectedProgramId, cohortId: selectedCohortId, weekFilter: selectedWeekFilter,
        })
      : [],
    [currentScenario, selectedProgramId, selectedCohortId, selectedWeekFilter],
  );

  // استفاده از دروس چارت درسی در صورت وجود، وگرنه تمام تقاضاها
  const demandsSource = useMemo(() => curriculumDemands.length > 0 ? curriculumDemands : courseDemands, [curriculumDemands, courseDemands]);

  // «نیمسال ورود» → شمارهٔ ترمِ همان ورودی در نیمسال جاری. با انتخاب ورودی،
  // چارت به همان یک ترم محدود می‌شود (نه ترم ۱ و ۲ یک‌جا).
  const cohortOrdinal = useMemo(() => {
    if (selectedCohortId === 'ALL') return null;
    const [y, t] = selectedCohortId.split('-');
    const selectedTerm = terms.find(x => x.id === selectedTermId) ?? terms[0];
    return cohortSemesterNo(Number(y), Number(t), selectedTerm?.code ?? null);
  }, [selectedCohortId, terms, selectedTermId]);

  const effectiveSemester = cohortOrdinal ?? selectedSemester;

  const filteredDemands = useMemo(
    () => filterContextDemands(demandsSource, { programId: selectedProgramId, cohortId: selectedCohortId, semester: effectiveSemester }),
    [demandsSource, selectedProgramId, selectedCohortId, effectiveSemester],
  );

  // فاز ۰: ماتریس رشته × ترم با وضعیت کامل/ناقص — «برنامه این رشته کامله»
  const programMatrix = useMemo(
    () => programSemesterMatrix(courseDemands, approvedOfferings, programs),
    [courseDemands, approvedOfferings, programs],
  );

  /** انتخاب دامنه در فاز ۰ و رفتن به گام ۱ */
  const applyScope = (programId: number, semester: number | 'ALL' | 'NONE') => {
    setSelectedProgramId(programId);
    setSelectedSemester(semester);
    setActiveMainTab('CURRICULUM_ASSIGN');
  };

  // یک ترم واقعی چند هزار ارائهٔ درس دارد و هر ردیف این جدول سنگین است؛
  // همه را یک‌جا رندر نمی‌کنیم تا مرورگر (و رندر سمت سرور) از پا نیفتد.
  const [demandLimit, setDemandLimit] = useState(DEMAND_PAGE);
  useEffect(() => { setDemandLimit(DEMAND_PAGE); }, [selectedProgramId, selectedCohortId, selectedTermId]);
  const displayedDemands = useMemo(() => filteredDemands.slice(0, demandLimit), [filteredDemands, demandLimit]);

  const inspectorProf = useMemo(() => {
    return professors.find(p => p.id === inspectorProfId) || professors[0] || NO_PROFESSOR;
  }, [professors, inspectorProfId]);

  const editingProf = useMemo(() => {
    return professors.find(p => p.id === editingProfId) || professors[0] || NO_PROFESSOR;
  }, [professors, editingProfId]);

  const inspectorOfferings = useMemo(() => {
    const source = currentScenario ? currentScenario.offerings : approvedOfferings;
    let list = source.filter(o => o.professorId === inspectorProfId);
    if (selectedWeekFilter !== 'ALL_VIEW') {
      list = list.filter(o => o.classSchedules.some(cs => cs.weekType === 'ALL' || cs.weekType === selectedWeekFilter));
    }
    return list;
  }, [currentScenario, approvedOfferings, inspectorProfId, selectedWeekFilter]);

  const inspectorStats = useMemo(
    () => inspectorSummary(inspectorOfferings, inspectorProf.maxWeeklyUnits),
    [inspectorOfferings, inspectorProf],
  );

  const teachingSlots = useMemo(() => timeSlots.filter(s => !s.isBreak), [timeSlots]);

  return {
    initial,
    scope,
    isDeptScope: scope === 'dept',
    activeMainTab,
    activeSlotPresetKey,
    applyWorkspace,
    approvedOfferings,
    calendarConfig,
    classrooms,
    cohorts,
    courseDemands,
    currentPhase,
    currentProgram,
    currentRealScenario,
    currentScenario,
    currentTerm,
    demandLimit,
    displayedDemands,
    displayedScenarioOfferings,
    editingProf,
    editingProfId,
    filteredDemands,
    generatedTermSessionsCount,
    handleAssignCoProfessor,
    handleAssignProfessorToCourse,
    handleAssignProfessorToGroup,
    handleGenerateSessions,
    handleOpenEditProfAvailability,
    handlePhaseTransition,
    handleToggleCohortMerge,
    handleRunHealth,
    handleSuggestForDemand,
    handleSupplyFromSuggestion,
    handleToggleCoTeaching,
    handleToggleDemandExamMode,
    handleUpdateCoWeights,
    handleUpdateCourseGroupsCount,
    handleUpdateDemandExamDate,
    handleUpdateProfMaxUnits,
    hardConflictCount,
    health,
    healthLoading,
    inspectorOfferings,
    inspectorProf,
    inspectorProfId,
    inspectorStats,
    isGeneratingSessions,
    isLoadingCurriculumDemands,
    isLoadingWorkspace,
    isProfAvailabilityModalOpen,
    loadCurriculumDemands,
    makeupSessions,
    ownedDeptId,
    phaseBusy,
    profAssignedUnitsMap,
    programMatrix,
    applyScope,
    chartRange,
    cohortOrdinal,
    effectiveSemester,
    professors,
    programs,
    realAvailRows,
    realAvailStatus,
    reloadWorkspace,
    reloadRoomGrants,
    roomGrants,
    selectedCohortId,
    selectedProgramId,
    selectedSemester,
    selectedTermId,
    selectedWeekFilter,
    sessionsByOffering,
    setActiveMainTab,
    setActiveSlotPresetKey,
    setApprovedOfferings,
    setCalendarConfig,
    setClassrooms,
    setCohorts,
    setCourseDemands,
    setCurrentPhase,
    setCurrentRealScenario,
    setDemandLimit,
    setEditingProfId,
    setGeneratedTermSessionsCount,
    setHardConflictCount,
    setHealth,
    setHealthLoading,
    setInspectorProfId,
    setIsGeneratingSessions,
    setIsLoadingWorkspace,
    setIsProfAvailabilityModalOpen,
    setMakeupSessions,
    setOwnedDeptId,
    setPhaseBusy,
    setProfessors,
    setPrograms,
    setRealAvailRows,
    setSelectedCohortId,
    setSelectedProgramId,
    setSelectedSemester,
    setSelectedTermId,
    setSelectedWeekFilter,
    setSessionsByOffering,
    setSuggestLoading,
    setSuggestedDemandId,
    setSuggestions,
    setSupplying,
    setTargetShiftPreference,
    setTerms,
    setTimeSlots,
    setToastMessage,
    showToast,
    suggestLoading,
    suggestedDemandId,
    suggestions,
    supplying,
    targetShiftPreference,
    teachingSlots,
    terms,
    timeSlots,
    toastMessage,
  };
}

type PlanningValue = ReturnType<typeof useDepartmentPlanning>;

const PlanningCtx = createContext<PlanningValue | null>(null);

export function PlanningProvider({ initial, tab, timeSlots, scope, children }: { initial: SchedulingWorkspace; tab?: string | null; timeSlots?: TimeSlot[]; scope?: PlanningScope; children: ReactNode }) {
  const value = useDepartmentPlanning(initial, tab, timeSlots, scope ?? 'admin');
  return <PlanningCtx.Provider value={value}>{children}</PlanningCtx.Provider>;
}

/** مصرف تب‌ها: هر تب فقط نام‌هایی را می‌گیرد که لازم دارد */
export function usePlanning(): PlanningValue {
  const ctx = useContext(PlanningCtx);
  if (!ctx) throw new Error('usePlanning باید داخل <PlanningProvider> صدا زده شود.');
  return ctx;
}

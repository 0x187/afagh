'use client';

// ════════════════════════════════════════════════════════════════════════
//  تنها صاحب وضعیت ماژول برنامهٔ درسی: ۳۸ useState + Server Actionها + مشتقات.
//  تب‌ها و مودال‌ها state خودی ندارند و فقط از useCurriculum() می‌خوانند؛
//  محاسبات خالص هم در curriculum-core.ts است (قابل Unit Test).
// ════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CurriculumCtx } from './curriculum-context';
import { allBankSelected, buildRuleTree, nonCourseConditionsOf, semesterUnitTotal, dependencyWarningsMap, departmentNames, facultyNames, filterBankCourses, filterMajorsByTree, groupBySemester, isOverflowSemester, leafCourseCodesOf, resolveTab, termGrid, typeSummaryRows, unitsByRoleMap, countsByRoleMap, validateMinGrade, visibleBank, overflowSemesters } from './curriculum-core';
import type { BankCourse, CurriculumTab, CurriculumWorkspace, MajorItem, VersionDetail, VersionRow } from './types';
import { getCurriculumOverviewAction, getCurriculumVersionDetailAction, listCourseBankAction, listDepartmentsAction } from './actions/read';
import { createCurriculumRevisionAction, createCurriculumVersionAction, updateCurriculumMetaAction } from './actions/versions';
import { addCourseToCurriculumAction, assignCourseToSemesterAction, bulkAddCoursesAction, createCourseBankAction, markGraduationRequiredBulkAction, removeCourseFromCurriculumAction, syncRolesFromBankAction, updateCourseInCurriculumAction } from './actions/courses';
import { setCourseCorequisiteAction, setCourseGradeStatusCodesAction, setCoursePassingGradeAction, setCoursePrerequisiteAction, syncRequisiteRulesAction } from './actions/rules';
import { approveCurriculumAction, archiveCurriculumAction, publishCurriculumAction, rejectCurriculumAction, submitCurriculumForApprovalAction, validateCurriculumAction } from './actions/lifecycle';
import { describeLogicNode } from '@/lib/curriculum-types';
import { parseRoleUnitTargets } from '@/lib/curriculum-validator';
import { roleFromBankType } from '@/lib/bank-roles';
import { planSemesters, termCountForDegree } from '@/lib/term-plan';

function useCurriculumWorkspace(
  initial: CurriculumWorkspace,
  initialTab?: string | null,
  initialVersionId?: number | null,
  initialDetail?: VersionDetail | null,
  universityTitle?: string,
) {
  const [majors, setMajors] = useState<MajorItem[]>(initial.majors);
  const [versions, setVersions] = useState<VersionRow[]>(initial.versions);
  const [tracks] = useState(initial.tracks);
  const [terms, setTerms] = useState(initial.terms ?? []);
  const [selectedMajorId, setSelectedMajorId] = useState<number>(
    initial.versions.find(v => v.id === (initialVersionId ?? -1))?.majorId ?? initial.majors[0]?.id ?? 0
  );
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(initialVersionId ?? null);
  const [detail, setDetail] = useState<VersionDetail | null>(initialDetail ?? null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [bank, setBank] = useState<BankCourse[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankQuery, setBankQuery] = useState('');
  const [codePrefix, setCodePrefix] = useState('');
  const [bankSelected, setBankSelected] = useState<Set<number>>(new Set());
  /** نمایش همهٔ نتایج بانک (نه فقط ۶۰ مورد اول) */
  const [bankShowAll, setBankShowAll] = useState(false);
  /** تعداد کلِ دروسِ هم‌خوان با جست‌وجو (برای برچسبِ «X از Y») */
  const [bankTotal, setBankTotal] = useState(0);
  /** غیرت: هر بار که تغییر کند، بانک دوباره از سرور خوانده می‌شود (دکمهٔ «به‌روزرسانی») */
  const [bankNonce, setBankNonce] = useState(0);
  const [bankRoles, setBankRoles] = useState<Record<number, string>>({});
  const [bulkRoleType, setBulkRoleType] = useState('CORE');

  const [modal, setModal] = useState<null | 'NEW_VERSION' | 'EDIT_VERSION' | 'ADD_COURSE' | 'NEW_COURSE' | 'RULES' | 'REJECT'>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // فرم‌ها
  const [newVersionForm, setNewVersionForm] = useState({
    versionCode: '', title: '', entryYearFrom: 1405, entryYearTo: '', totalRequiredUnits: 140, maxUnitsPerTerm: 20, cloneFromId: '',
  });
  // فرم ویرایش مشخصات نسخه (فقط DRAFT — اکشن خودش گیت می‌زند)
  const [editVersionId, setEditVersionId] = useState<number | null>(null);
  const [editVersionForm, setEditVersionForm] = useState({
    versionCode: '', title: '', entryYearFrom: 1405, entryYearTo: '', totalRequiredUnits: 140, maxUnitsPerTerm: 20,
  });
  const [addCourseForm, setAddCourseForm] = useState({ courseId: '', roleType: 'CORE', recommendedSemester: '' });
  const [rejectNote, setRejectNote] = useState('');
  const [newCourseForm, setNewCourseForm] = useState({
    code: '', title: '', theo: 3, prac: 0, courseType: 'تخصصی', grading: 'NUMERIC', gpa: true, departmentId: '',
  });
  const [depts, setDepts] = useState<{ id: number; name: string }[]>([]);
  const [deptsLoading, setDeptsLoading] = useState(false);
  const [ruleCourseId, setRuleCourseId] = useState<number | null>(null);
  const [ruleForm, setRuleForm] = useState({ pre: [] as string[], preOp: 'AND' as 'AND' | 'OR', co: [] as string[], coOp: 'AND' as 'AND' | 'OR', minGrade: '', passGradeStatusCode: '', failGradeStatusCode: '', minUnits: '', minTerm: '' });
  const [activeTab, setActiveTab] = useState<CurriculumTab>(resolveTab(initialTab));
  const [transferMajorId, setTransferMajorId] = useState(0);
  /** نیم‌سال ورودیِ نسخهٔ مقصد در «انتقال کاتالوگ» (0 = تعیین‌نشده) */
  const [transferEntryTermId, setTransferEntryTermId] = useState(0);
  const [dragCourseId, setDragCourseId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | 'pool' | null>(null);
  const [facultyFilter, setFacultyFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');

  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4200);
  }, []);

  const selectedVersion = versions.find(v => v.id === selectedVersionId) ?? null;
  const majorVersions = versions.filter(v => v.majorId === selectedMajorId);

  const reloadOverview = useCallback(async () => {
    const w = await getCurriculumOverviewAction();
    if (!w.ok) { showToast(w.error, 'error'); return; }
    setMajors(w.data.majors.map(m => ({ ...m, code: m.code ?? String(m.id) })));
    setVersions(w.data.versions);
    setTerms(w.data.terms ?? []);
  }, []);

  const reloadDetail = useCallback(async (versionId: number) => {
    setDetailLoading(true);
    try {
      const r = await getCurriculumVersionDetailAction(versionId);
      if (!r.ok) { showToast(r.error, 'error'); return; }
      setDetail(r.data as unknown as VersionDetail);
    } finally {
      setDetailLoading(false);
    }
  }, [showToast]);

  // پاک‌سازی انتخاب بانک هنگام بستن مودال
  const closeAddCourse = () => {
    setModal(null);
    setBankQuery('');
    setCodePrefix('');
    setBankSelected(new Set());
    setBankRoles({});
  };

  // بارگذاری جزئیات با تغییر نسخهٔ انتخابی
  useEffect(() => {
    if (selectedVersionId == null) { setDetail(null); return; }
    reloadDetail(selectedVersionId);
  }, [selectedVersionId, reloadDetail]);

  // بانک دروس — جست‌وجوی سمتِ سرور (کد یا عنوان درس) + سقف ردیف.
  // پیش‌تر *همه* دروس دانشگاه بی‌سقف می‌آمد و این‌جا فیلتر می‌شد؛ حالا سرور
  // فیلتر می‌کند و فقط ۱۰۰ ردیف برمی‌گرداند. هر بار که مودال باز شود یا
  // کاربر جست‌وجو کند (debounce) یا روی «به‌روزرسانی» بزند (bankNonce)، بانک
  // دوباره خوانده می‌شود.
  useEffect(() => {
    if (modal !== 'ADD_COURSE' && modal !== 'EDIT_VERSION') return;
    let alive = true;
    setBankLoading(true);
    const t = setTimeout(() => {
      listCourseBankAction(bankQuery.trim(), 100).then(r => {
        if (!alive) return;
        setBankLoading(false);
        if (r.ok) { setBank(r.data); setBankTotal(r.total); }
        else showToast(r.error, 'error');
      }).catch(() => { if (alive) setBankLoading(false); });
    }, bankQuery ? 350 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [modal, bankQuery, bankNonce, showToast]);

  /** دکمهٔ «به‌روزرسانی» مودال‌ها: بانک را دوباره از سرور می‌خواند */
  const refreshBank = () => setBankNonce(n => n + 1);

  // گروه‌های آموزشی (هنگام نیاز برای تعریف درس جدید)
  useEffect(() => {
    if (modal !== 'NEW_COURSE' || depts.length > 0 || deptsLoading) return;
    setDeptsLoading(true);
    listDepartmentsAction().then(r => {
      setDeptsLoading(false);
      if (r.ok) setDepts(r.data);
      else showToast(r.error, 'error');
    });
  }, [modal, depts.length, deptsLoading, showToast]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = async (fn: () => Promise<any>, okText?: string) => {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) { showToast(res.error ?? 'عملیات ناموفق بود.', 'error'); return false; }
      showToast(okText ?? res.message ?? 'انجام شد.', 'success');
      return true;
    } finally {
      setBusy(false);
    }
  };

  // ── چرخهٔ حیات ──
  const handleValidate = async () => {
    if (selectedVersionId == null) return;
    setBusy(true);
    try {
      const r = await validateCurriculumAction(selectedVersionId);
      if (!r.ok) { showToast(r.error, 'error'); return; }
      showToast(`اعتبارسنجی کامل شد: ${r.data.checks.length} یافته (${r.data.checks.filter(c => c.severity === 'ERROR').length} مانع جدی).`, 'success');
    } finally {
      setBusy(false);
    }
    reloadDetail(selectedVersionId);
  };

  const handleSubmit = async (note: string) => {
    if (selectedVersionId == null) return;
    const ok = await run(() => submitCurriculumForApprovalAction(selectedVersionId, note));
    if (ok) { reloadOverview(); reloadDetail(selectedVersionId); }
  };

  const handleApprove = async (note: string) => {
    if (selectedVersionId == null) return;
    const ok = await run(() => approveCurriculumAction(selectedVersionId, note));
    if (ok) { reloadOverview(); reloadDetail(selectedVersionId); }
  };

  const handleReject = async (note: string) => {
    if (selectedVersionId == null) return;
    const ok = await run(() => rejectCurriculumAction(selectedVersionId, note));
    if (ok) { setModal(null); reloadOverview(); reloadDetail(selectedVersionId); }
  };

  const handlePublish = async () => {
    if (selectedVersionId == null) return;
    const ok = await run(() => publishCurriculumAction(selectedVersionId));
    if (ok) { reloadOverview(); reloadDetail(selectedVersionId); }
  };

  const handleArchive = async () => {
    if (selectedVersionId == null) return;
    const ok = await run(() => archiveCurriculumAction(selectedVersionId));
    if (ok) { reloadOverview(); reloadDetail(selectedVersionId); }
  };

  const handleCreateRevision = async () => {
    if (selectedVersionId == null) return;
    const ok = await run(() => createCurriculumRevisionAction(selectedVersionId).then(r =>
      r.ok ? { ok: true, message: `نسخهٔ جدید (${r.data.versionCode}) ساخته شد.` } : r
    ));
    if (ok) reloadOverview();
  };

  const handleCreateVersion = async () => {
    const f = newVersionForm;
    if (!f.versionCode.trim() || !f.entryYearFrom) { showToast('کد نسخه و سال ورودی الزامی است.', 'error'); return; }
    const ok = await run(() => createCurriculumVersionAction({
      majorId: selectedMajorId,
      versionCode: f.versionCode.trim(),
      title: f.title.trim() || `برنامهٔ ${majors.find(m => m.id === selectedMajorId)?.name ?? ''} ${f.versionCode.trim()}`,
      entryYearFrom: f.entryYearFrom,
      // خالی = «به بعد» (کاتالوگی که سال‌ها بدون تغییر می‌ماند)
      entryYearTo: f.entryYearTo ? Number(f.entryYearTo) : null,
      totalRequiredUnits: f.totalRequiredUnits,
      maxUnitsPerTerm: f.maxUnitsPerTerm || null,
      cloneFromId: f.cloneFromId ? Number(f.cloneFromId) : undefined,
    }));
    if (ok) { setModal(null); setNewVersionForm({ versionCode: '', title: '', entryYearFrom: 1405, entryYearTo: '', totalRequiredUnits: 140, maxUnitsPerTerm: 20, cloneFromId: '' }); reloadOverview(); }
  };

  // ── ویرایش مشخصات نسخه (فقط DRAFT؛ اکشن خودش گیت می‌زند) ──
  const openEditVersion = (v: { id: number; versionCode: string; title: string; entryYearFrom: number; entryYearTo: number | null; totalRequiredUnits: string }) => {
    setEditVersionId(v.id);
    setSelectedVersionId(v.id);
    setEditVersionForm({
      versionCode: v.versionCode,
      title: v.title,
      entryYearFrom: v.entryYearFrom,
      entryYearTo: v.entryYearTo != null ? String(v.entryYearTo) : '',
      totalRequiredUnits: Number(v.totalRequiredUnits) || 0,
      maxUnitsPerTerm: (detail?.version.id === v.id ? detail.version.maxUnitsPerTerm : null) ?? 20,
    });
    setModal('EDIT_VERSION');
  };

  const handleUpdateVersion = async () => {
    if (editVersionId == null) return;
    const f = editVersionForm;
    if (!f.versionCode.trim() || !f.entryYearFrom) { showToast('کد نسخه و سال ورودی الزامی است.', 'error'); return; }
    // نسخهٔ منتشرشده: فقط پنجرهٔ ورودی فرستاده می‌شود (اکشن سرور هم بقیه را رد می‌کند)
    const editing = versions.find(v => v.id === editVersionId);
    const entryOnly = editing ? editing.status !== 'DRAFT' : !isDraft;
    if (entryOnly && f.entryYearTo.trim() && Number(f.entryYearTo) < f.entryYearFrom) {
      showToast('«ورودی تا» نمی‌تواند کوچک‌تر از «ورودی از» باشد.', 'error'); return;
    }
    const ok = await run(() => updateCurriculumMetaAction(editVersionId, entryOnly ? {
      entryYearFrom: f.entryYearFrom,
      entryYearTo: f.entryYearTo.trim() ? Number(f.entryYearTo) : null,
    } : {
      versionCode: f.versionCode.trim(),
      title: f.title.trim(),
      entryYearFrom: f.entryYearFrom,
      entryYearTo: f.entryYearTo.trim() ? Number(f.entryYearTo) : null,
      totalRequiredUnits: f.totalRequiredUnits,
      maxUnitsPerTerm: f.maxUnitsPerTerm || null,
    }));
    if (ok) { setModal(null); setEditVersionId(null); reloadOverview(); reloadDetail(editVersionId); }
  };

  // ── افزودن گروهی درس بدون بستن مودال (برای مودال ویرایش نسخه) ──
  const handleBulkAddCoursesKeepOpen = async () => {
    if (selectedVersionId == null || bankSelected.size === 0) return;
    const items = [...bankSelected].map(courseId => {
      const b = bank.find(x => x.id === courseId);
      return {
        courseId,
        roleType: b ? roleForBank(b) : addCourseForm.roleType,
        recommendedSemester: null,
      };
    });
    const ok = await run(() => bulkAddCoursesAction(selectedVersionId, items));
    if (ok) { setBankSelected(new Set()); setBankRoles({}); await reloadDetail(selectedVersionId); }
  };

  const handleTransferToMajor = async () => {
    if (selectedVersionId == null) return;
    const src = versions.find(v => v.id === selectedVersionId);
    if (!src) return;
    const targetMajor = majors.find(m => m.id === (transferMajorId || selectedMajorId));
    if (!targetMajor) return;
    // گارد انتخاب اشتباه مقصد: نام رشتهٔ مبدأ/مقصد + تعداد دروس قبل از کپی عمیق پرسیده شود
    const courseCount = detail?.courses.length ?? 0;
    if (!window.confirm(
      `کپی عمیق چارت «${src.versionCode}» (${courseCount} درس) به رشتهٔ مقصد «${targetMajor.name}» انجام شود؟\n`
      + `یک نسخهٔ DRAFT جدید در رشتهٔ مقصد ساخته می‌شود و دروس + پیش‌نیازها + ترم‌بندی کامل کپی می‌شوند.`
    )) return;
    // کد یکتا برای رشتهٔ مقصد: اگر «{سال}-T1» از قبل هست، به T2، T3، … برس
    // (وگرنه انتقال دوم به همان رشته با خطای «کد تکراری» شکست می‌خورد)
    const base = `${src.entryYearFrom}-T`;
    let n = 1;
    while (versions.some(v => v.majorId === targetMajor.id && v.versionCode === `${base}${n}`)) n += 1;
    const newCode = `${base}${n}`;
    setBusy(true);
    try {
      const r = await createCurriculumVersionAction({
        majorId: targetMajor.id,
        versionCode: newCode,
        title: `${targetMajor.name} — کپی از نسخهٔ ${src.versionCode} (${src.title})`,
        entryYearFrom: src.entryYearFrom,
        entryTermId: transferEntryTermId || null,
        totalRequiredUnits: Number(src.totalRequiredUnits) || 140,
        maxUnitsPerTerm: detail?.version.maxUnitsPerTerm ?? 20,
        cloneFromId: src.id,
      });
      if (!r.ok) { showToast(r.error, 'error'); return; }
      await reloadOverview();
      // پرش به رشته و نسخهٔ مقصد (تب دروس) تا کاربر فوراً دروس کپی‌شده را ببیند
      setSelectedMajorId(targetMajor.id);
      setSelectedVersionId(r.data.id);
      setActiveTab('COURSES');
      showToast(`کپی عمیق انجام شد: ${courseCount} درس به رشتهٔ «${targetMajor.name}» منتقل شد (نسخهٔ ${newCode}).`, 'success');
    } finally {
      setBusy(false);
    }
  };

  // ── ویرایش دروس (فقط DRAFT؛ اکشن خودش گیت می‌زند) ──
  const handleAddCourse = async () => {
    if (selectedVersionId == null || !addCourseForm.courseId) return;
    const picked = bank.find(b => b.id === Number(addCourseForm.courseId));
    const ok = await run(() => addCourseToCurriculumAction(selectedVersionId, {
      courseId: Number(addCourseForm.courseId),
      roleType: picked ? roleForBank(picked) : addCourseForm.roleType,
      recommendedSemester: addCourseForm.recommendedSemester ? Number(addCourseForm.recommendedSemester) : null,
    }));
    if (ok) { setModal(null); setAddCourseForm({ courseId: '', roleType: 'CORE', recommendedSemester: '' }); reloadDetail(selectedVersionId); }
  };

  const handleBulkAddCourses = async () => {
    if (selectedVersionId == null || bankSelected.size === 0) return;
    const items = [...bankSelected].map(courseId => {
      const b = bank.find(x => x.id === courseId);
      return {
        courseId,
        roleType: b ? roleForBank(b) : addCourseForm.roleType,
        recommendedSemester: null,
      };
    });
    const ok = await run(() => bulkAddCoursesAction(selectedVersionId, items));
    if (ok) { closeAddCourse(); await reloadDetail(selectedVersionId); setActiveTab('SEMESTERS'); }
  };

  const handleSyncRoles = async () => {
    if (selectedVersionId == null) return;
    if (!window.confirm('نقش همهٔ دروس این نسخه از روی «نوع درس» بانک بازخوانی می‌شود و تغییرات دستی نقش‌ها از بین می‌رود. ادامه می‌دهید؟')) return;
    const ok = await run(() => syncRolesFromBankAction(selectedVersionId));
    if (ok) reloadDetail(selectedVersionId);
  };

  /**
   * «پیش‌نیاز / هم‌نیاز» را از **جدول دروس** می‌خواند و در قواعد همین نسخه
   * ثبت می‌کند. قواعد دستیِ موجود دست نمی‌خورند (overwrite=false).
   */
  const handleSyncRequisites = async (overwrite = false) => {
    if (selectedVersionId == null) { showToast('اول یک نسخه را انتخاب کنید.', 'error'); return; }
    if (overwrite && !window.confirm('قواعد پیش‌نیاز/هم‌نیازِ موجود این نسخه با متن «جدول دروس» بازنویسی می‌شود. ادامه می‌دهید؟')) return;
    const ok = await run(() => syncRequisiteRulesAction(selectedVersionId, overwrite));
    if (ok) await reloadDetail(selectedVersionId);
  };

  const handleMarkGradReq = async () => {
    if (selectedVersionId == null) return;
    const ok = await run(() => markGraduationRequiredBulkAction(selectedVersionId));
    if (ok) reloadDetail(selectedVersionId);
  };

  const handleCreateBankCourse = async () => {
    const f = newCourseForm;
    if (!f.code.trim() || !f.title.trim()) { showToast('کد درس و نام درس الزامی است.', 'error'); return; }
    const theo = Number(f.theo) || 0;
    const prac = Number(f.prac) || 0;
    if (theo < 0 || prac < 0 || theo + prac <= 0) { showToast('واحد نظری/عملی نامعتبر است.', 'error'); return; }
    setBusy(true);
    try {
      const r = await createCourseBankAction({
        code: f.code.trim(),
        title: f.title.trim(),
        theoreticalUnits: theo,
        practicalUnits: prac,
        courseType: f.courseType,
        gradingType: f.grading === 'PASS_FAIL' ? 'PASS_FAIL' : 'NUMERIC',
        affectsGpa: f.gpa ? 1 : 0,
        departmentId: f.departmentId ? Number(f.departmentId) : null,
      });
      if (!r.ok) { showToast(r.error, 'error'); return; }
      showToast(r.message, 'success');
      const newId = r.data.id;
      const entry = { id: newId, code: f.code.trim(), title: f.title.trim(), units: String(theo + prac), courseType: f.courseType };
      setBank(b => (b.some(x => x.id === newId) ? b : [...b, entry]));
      setAddCourseForm(af => ({ ...af, courseId: String(newId) }));
      setBankSelected(new Set([newId]));
      setModal(null);
      setNewCourseForm({ code: '', title: '', theo: 3, prac: 0, courseType: 'تخصصی', grading: 'NUMERIC', gpa: true, departmentId: '' });
    } finally {
      setBusy(false);
    }
  };

  // ── ویرایش پیش‌نیاز/هم‌نیاز (فقط DRAFT؛ اکشن‌ها گیت می‌زنند + audit) ──
  // درخت فقط از کدهای دروس همین نسخه ساخته می‌شود → کد نامعتبر و خودارجاعی از ریشه غیرممکن است.
  const openRules = (courseId: number) => {
    const pre = detail?.rules.find(r => r.courseId === courseId && r.ruleType === 'PREREQ');
    const co = detail?.rules.find(r => r.courseId === courseId && r.ruleType === 'COREQ');
    const course = detail?.courses.find(c => c.courseId === courseId);
    // شرط‌های غیردرسی («۴۷ واحد پاس‌کرده» / «حداقل ترم ۷») از همان درخت خوانده می‌شوند
    const extra = nonCourseConditionsOf(pre?.logicTree);
    setRuleForm({
      pre: leafCourseCodesOf(pre?.logicTree), preOp: pre?.logicTree.operator ?? 'AND',
      co: leafCourseCodesOf(co?.logicTree), coOp: co?.logicTree.operator ?? 'AND',
      minGrade: course?.minGrade != null ? String(course.minGrade) : '',
      passGradeStatusCode: course?.passGradeStatusCode ?? '',
      failGradeStatusCode: course?.failGradeStatusCode ?? '',
      minUnits: extra.unitsPassed.length > 0 ? String(extra.unitsPassed[0]) : (course?.prereqMinUnits != null ? String(course.prereqMinUnits) : ''),
      minTerm: extra.minSemester.length > 0 ? String(extra.minSemester[0]) : (course?.prereqMinTerm != null ? String(course.prereqMinTerm) : ''),
    });
    setRuleCourseId(courseId);
    setModal('RULES');
  };

  const toggleRuleCode = (group: 'pre' | 'co', code: string) => {
    setRuleForm(f => {
      const arr = group === 'pre' ? f.pre : f.co;
      const next = arr.includes(code) ? arr.filter(x => x !== code) : [...arr, code];
      return group === 'pre' ? { ...f, pre: next } : { ...f, co: next };
    });
  };

  const handleSaveRules = async () => {
    if (selectedVersionId == null || ruleCourseId == null) return;
    // شرط‌های غیردرسی هم داخل همان درخت PREREQ ذخیره می‌شوند (AND با شرط‌های درسی)
    const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
    const okPre = await run(() => setCoursePrerequisiteAction(
      selectedVersionId, ruleCourseId,
      buildRuleTree(ruleForm.pre, ruleForm.preOp, { unitsPassed: numOrNull(ruleForm.minUnits), minSemester: numOrNull(ruleForm.minTerm) }),
    ));
    if (!okPre) return;
    const okCo = await run(() => setCourseCorequisiteAction(selectedVersionId, ruleCourseId, buildRuleTree(ruleForm.co, ruleForm.coOp)));
    if (!okCo) return;
    const chk = validateMinGrade(ruleForm.minGrade, ruleCourse?.minGrade != null ? String(ruleCourse.minGrade) : '');
    if (chk.error) { showToast(chk.error, 'error'); return; }
    if (chk.changed) {
      const okMin = await run(() => setCoursePassingGradeAction(selectedVersionId, ruleCourseId, chk.value));
      if (!okMin) return;
    }
    const statusChanged = (ruleForm.passGradeStatusCode || null) !== (ruleCourse?.passGradeStatusCode ?? null)
      || (ruleForm.failGradeStatusCode || null) !== (ruleCourse?.failGradeStatusCode ?? null);
    if (statusChanged) {
      const okStatus = await run(() => setCourseGradeStatusCodesAction(
        selectedVersionId, ruleCourseId,
        ruleForm.passGradeStatusCode || null,
        ruleForm.failGradeStatusCode || null,
      ));
      if (!okStatus) return;
    }
    setModal(null);
    setRuleCourseId(null);
    reloadDetail(selectedVersionId);
  };

  const ruleText = (courseId: number, type: string): string | null => {
    const r = detail?.rules.find(x => x.courseId === courseId && x.ruleType === type);
    if (!r || (r.logicTree.conditions ?? []).length === 0) return null;
    // عنوان از چارت، و اگر کد در چارت نبود از بانک (extraTitles) — بعد کد خام
    const titleOf = (code: string) => detail?.courses.find(x => x.code === code)?.title ?? detail?.extraTitles?.[code] ?? code;
    // sortByCode: دروس بر اساس کد مرتب شوند (نه ترتیب ذخیره‌شده و نه الفبای عنوان)
    return describeLogicNode(r.logicTree, titleOf, { sortByCode: true });
  };

  const ruleCourse = ruleCourseId != null ? detail?.courses.find(c => c.courseId === ruleCourseId) ?? null : null;

  const handleRemoveCourse = async (courseId: number) => {
    if (selectedVersionId == null) return;
    const ok = await run(() => removeCourseFromCurriculumAction(selectedVersionId, courseId));
    if (ok) reloadDetail(selectedVersionId);
  };

  const handleAssignSemester = async (courseId: number, semesterNo: number | null) => {
    if (selectedVersionId == null) return;
    await run(() => assignCourseToSemesterAction(selectedVersionId, courseId, semesterNo));
    reloadDetail(selectedVersionId);
  };

  // ── درگ‌اندراپ ترم‌بندی (بومی، بدون کتابخانه) ──
  const onCourseDragStart = (e: React.DragEvent, courseId: number) => {
    if (!isDraft) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', String(courseId));
    e.dataTransfer.effectAllowed = 'move';
    setDragCourseId(courseId);
  };
  const onCourseDragEnd = () => { setDragCourseId(null); setDropTarget(null); };
  const onDropToSemester = (e: React.DragEvent, sem: number | null) => {
    e.preventDefault();
    setDropTarget(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    setDragCourseId(null);
    if (!id || selectedVersionId == null || !isDraft) return;
    const cur = detail?.courses.find(c => c.courseId === id)?.recommendedSemester ?? null;
    if (cur === sem) return;
    handleAssignSemester(id, sem);
  };

  const handleUpdateMaxUnits = async (value: number) => {
    if (selectedVersionId == null) return;
    await run(() => updateCurriculumMetaAction(selectedVersionId, { maxUnitsPerTerm: value || null }));
    reloadDetail(selectedVersionId);
  };

  const handleUpdateRequired = async (courseId: number, isRequired: number) => {
    if (selectedVersionId == null) return;
    await run(() => updateCourseInCurriculumAction(selectedVersionId, courseId, { isRequired }));
    reloadDetail(selectedVersionId);
  };

  const handleUpdateRole = async (courseId: number, roleType: string) => {
    if (selectedVersionId == null) return;
    await run(() => updateCourseInCurriculumAction(selectedVersionId, courseId, { roleType }));
    reloadDetail(selectedVersionId);
  };

  const handleUpdateGradReq = async (courseId: number, isGraduationRequired: number) => {
    if (selectedVersionId == null) return;
    await run(() => updateCourseInCurriculumAction(selectedVersionId, courseId, { isGraduationRequired }));
    reloadDetail(selectedVersionId);
  };

  const handleUpdateGradeStatusCodes = async (courseId: number, passCode: string | null, failCode: string | null) => {
    if (selectedVersionId == null) return;
    await run(() => setCourseGradeStatusCodesAction(selectedVersionId, courseId, passCode, failCode));
    reloadDetail(selectedVersionId);
  };

  // ── فیلتر درختی رشته: دانشکده → گروه → رشته ──
  const faculties = useMemo(() => facultyNames(majors), [majors]);
  const departments = useMemo(() => departmentNames(majors, facultyFilter), [majors, facultyFilter]);
  const filteredMajors = useMemo(() => filterMajorsByTree(majors, facultyFilter, deptFilter), [majors, facultyFilter, deptFilter]);

  useEffect(() => {
    // اگر رشتهٔ انتخابی بعد از فیلتر مخفی شد، به اولین رشتهٔ قابل‌نمایش سوییچ کن
    if (filteredMajors.length > 0 && !filteredMajors.some(m => m.id === selectedMajorId)) {
      setSelectedMajorId(filteredMajors[0].id);
      setSelectedVersionId(null);
      setDetail(null);
    }
  }, [filteredMajors, selectedMajorId]);

  // ── رندر ──
  const courseCodeOf = new Map((detail?.courses ?? []).map(c => [c.courseId, c.code]));
  const isDraft = (detail?.version.status ?? selectedVersion?.status) === 'DRAFT';
  const { bySemester: semesterCourses, unassigned: unassignedCourses } = useMemo(() => groupBySemester(detail?.courses), [detail?.courses]);
  const totalPlannedUnits = semesterUnitTotal(detail?.courses);
  // هشدار پوشش/ترتیب پیش‌نیاز و هم‌نیاز (نمایش هنگام چیدمان)
  const depWarnings = useMemo(() => dependencyWarningsMap(detail?.courses, detail?.rules), [detail?.courses, detail?.rules]);

  // ── چارت ترمی بر اساس مقطع: تعداد ترم از DB، وگرنه استنتاج ──
  const degreeMajor = majors.find(m => m.id === (selectedVersion?.majorId ?? selectedMajorId));
  const chartTermCount = termCountForDegree({
    termCount: degreeMajor?.degreeTermCount,
    code: degreeMajor?.degreeCode,
    title: degreeMajor?.degreeTitle,
  });
  const planTerms = planSemesters(chartTermCount);
  const overflowTerms = overflowSemesters(semesterCourses.keys(), planTerms);
  const gridTerms = termGrid(planTerms, semesterCourses.keys());
  const isOverflowTerm = (sem: number) => isOverflowSemester(sem, planTerms);

  // ── فیلتر بانک: جستجو + پیشوند کد رشته ──
  // دروسی که همین حالا در چارتِ این نسخه هستند از فهرست بانک حذف می‌شوند؛
  // این‌طور بعد از افزودن ۶۰ درسِ اول، ۶۰ درسِ بعدی خودشان دیده می‌شوند.
  const inChartIds = useMemo(() => new Set((detail?.courses ?? []).map(c => c.courseId)), [detail?.courses]);
  const bankFiltered = useMemo(
    () => filterBankCourses(bank, bankQuery, codePrefix).filter(b => !inChartIds.has(b.id)),
    [bank, bankQuery, codePrefix, inChartIds],
  );
  const bankVisible = bankShowAll ? bankFiltered : visibleBank(bankFiltered);
  const allFilteredSelected = allBankSelected(bankVisible, bankSelected);
  const roleForBank = (b: { id: number; courseType: string }) => bankRoles[b.id] ?? roleFromBankType(b.courseType);
  const toggleSelectAllBank = () => {
    const ids = bankVisible.map(b => b.id);
    if (allFilteredSelected) {
      setBankSelected(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next; });
      setBankRoles(prev => { const next = { ...prev }; ids.forEach(id => { delete next[id]; }); return next; });
    } else {
      setBankSelected(prev => new Set([...prev, ...ids]));
      setBankRoles(prev => { const next = { ...prev }; bankVisible.forEach(b => { if (!(b.id in next)) next[b.id] = roleFromBankType(b.courseType); }); return next; });
      const last = bankVisible[bankVisible.length - 1];
      if (last) setAddCourseForm(f => ({ ...f, courseId: String(last.id) }));
    }
  };

  // ── جمع‌بندی نوع درس نسخه (معادل «نمایش اطلاعات نوع درس» مدل قدیم: جمع ۲) ──
  const typeSummary = useMemo(() => typeSummaryRows(detail?.courses), [detail?.courses]);
  // ── سهم واحد مقرر هر نقش (ستون minRoleUnits نسخه) + واحد موجود هر نقش ──
  const roleTargets = useMemo(
    () => parseRoleUnitTargets((detail?.version as { minRoleUnits?: unknown } | undefined)?.minRoleUnits),
    [detail?.version]
  );
  const unitsByRole = useMemo(() => unitsByRoleMap(detail?.courses), [detail?.courses]);
  const countsByRole = useMemo(() => countsByRoleMap(detail?.courses), [detail?.courses]);
  const roleTargetsKey = `${detail?.version.id ?? 0}:${JSON.stringify(roleTargets)}`;

  const handleSaveRoleTargets = async (targets: Record<string, number>) => {
    if (selectedVersionId == null) return;
    const ok = await run(() => updateCurriculumMetaAction(selectedVersionId, { minRoleUnits: targets }));
    if (ok) handleValidate();
  };

  return {
    activeTab,
    addCourseForm,
    universityTitle: universityTitle ?? '',
    allFilteredSelected,
    bank,
    bankFiltered,
    bankLoading,
    bankQuery,
    bankRoles,
    bankSelected,
    bankVisible,
    bankShowAll,
    bankTotal,
    refreshBank,
    showMoreBank: () => setBankShowAll(true),
    bulkRoleType,
    busy,
    chartTermCount,
    closeAddCourse,
    codePrefix,
    courseCodeOf,
    degreeMajor,
    departments,
    deptFilter,
    depts,
    deptsLoading,
    detail,
    detailLoading,
    depWarnings,
    dragCourseId,
    dropTarget,
    editVersionForm,
    editVersionId,
    faculties,
    facultyFilter,
    filteredMajors,
    gridTerms,
    handleAddCourse,
    handleApprove,
    handleArchive,
    handleAssignSemester,
    handleBulkAddCourses,
    handleBulkAddCoursesKeepOpen,
    handleCreateBankCourse,
    handleCreateRevision,
    handleCreateVersion,
    handleMarkGradReq,
    handlePublish,
    handleReject,
    handleRemoveCourse,
    handleSaveRoleTargets,
    handleSaveRules,
    handleSubmit,
    handleSyncRequisites,
    handleSyncRoles,
    handleTransferToMajor,
    handleUpdateGradReq,
    handleUpdateVersion,
    handleUpdateGradeStatusCodes,
    handleUpdateMaxUnits,
    handleUpdateRequired,
    handleUpdateRole,
    handleValidate,
    isDraft,
    isOverflowTerm,
    majorVersions,
    majors,
    modal,
    newCourseForm,
    newVersionForm,
    onCourseDragEnd,
    onCourseDragStart,
    onDropToSemester,
    openEditVersion,
    openRules,
    overflowTerms,
    planTerms,
    rejectNote,
    reloadDetail,
    reloadOverview,
    roleForBank,
    roleTargets,
    roleTargetsKey,
    ruleCourse,
    ruleCourseId,
    ruleForm,
    ruleText,
    run,
    selectedMajorId,
    selectedVersion,
    selectedVersionId,
    semesterCourses,
    setActiveTab,
    setAddCourseForm,
    setBank,
    setBankLoading,
    setBankQuery,
    setBankRoles,
    setBankSelected,
    setBulkRoleType,
    setBusy,
    setCodePrefix,
    setDeptFilter,
    setDepts,
    setDeptsLoading,
    setDetail,
    setDetailLoading,
    setDragCourseId,
    setDropTarget,
    setEditVersionForm,
    setFacultyFilter,
    setMajors,
    setModal,
    setNewCourseForm,
    setNewVersionForm,
    setRejectNote,
    setRuleCourseId,
    setRuleForm,
    setSelectedMajorId,
    setSelectedVersionId,
    setToast,
    setTransferMajorId,
    setVersions,
    showToast,
    toast,
    toggleRuleCode,
    toggleSelectAllBank,
    totalPlannedUnits,
    tracks,
    transferMajorId,
    transferEntryTermId,
    setTransferEntryTermId,
    terms,
    typeSummary,
    unassignedCourses,
    unitsByRole,
    countsByRole,
    versions,
  };
}

export type CurriculumValue = ReturnType<typeof useCurriculumWorkspace>;

export function CurriculumProvider({ initial, tab, version, detail, universityTitle, children }: {
  initial: CurriculumWorkspace; tab?: string | null; version?: number | null; detail?: VersionDetail | null; universityTitle?: string; children: ReactNode;
}) {
  const value = useCurriculumWorkspace(initial, tab, version, detail, universityTitle);
  return <CurriculumCtx.Provider value={value}>{children}</CurriculumCtx.Provider>;
}

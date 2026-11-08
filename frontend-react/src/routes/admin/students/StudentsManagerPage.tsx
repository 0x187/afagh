// ═══ Comprehensive student dossier manager — port of StudentsManagerClient.tsx ═══
//
// Three main views (Sama-style): students form, professors form, quick tiles.
// Students: list (server search/sort/filters/pagination), combined info
// (identity + supplementary + other + extra/alumni), official transcript with
// grade editing + audit trail. Professors: lazy staff list + combined dossier
// form. All data flows through the Go endpoints in students-dossier-api.ts.
//
// Privacy note: the national-code column filter never enters the SPA URL
// (reference kept it in an HttpOnly cookie); here it lives in component state
// and travels only to the same-origin API call.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import { doPrintTranscript } from '@/lib/print';
import {
  QUOTA_FA, STUDENT_STATUS_FA, gradeStatusChip, gradeStatusFa, studentStatusChip, studentStatusFa,
} from '@/lib/student-labels';
import {
  getDossierList, getDossierMeta, getDossierTranscript, getDossierTranscriptRegulation,
  getDossierCohortStats, getGradeAuditLog, loadStaffList, resolveSamaCodeForGrade,
  setDossierGrade, setStudentRegulation, updateStudentProfile, updateStaffProfile,
  setUserActive, resetUserPassword, bulkResetRandomPasswords, bulkResetPasswords,
  bulkForcePasswordChange, backfillRoles, createStaffExpert, saveUserRoles,
  requestStepUp,
} from '@/lib/students-dossier-api';
import type {
  StaffItem, TranscriptRow, RegulationConfig, CohortStats, GradeAuditRow,
  StudentProfilePatch, StaffProfilePatch,
} from '@/lib/students-dossier-api';
import PersonPhoto from './PersonPhoto';
import OfficialTranscriptView from './OfficialTranscriptView';
import { DEFAULT_PRINT_OPTIONS } from './print-options';
import type { TranscriptPrintOptions, OriginUniversity } from './print-options';
import { faDigit, faNum, groupTranscript, dateToJalali, regThresholds } from './transcript-utils';
import {
  ConfirmProvider, useConfirm, GradeEditModal, AuditLogModal, BulkResetModal,
  RolesModal, CreateStaffModal, PasswordModal,
} from './dossier-modals';
import type { GradeEditState, BulkModalState, CreateStaffFields } from './dossier-modals';

// ── Sama lookups: raw code → Persian title (دوره.txt / شيوه آموزش.txt / نحوه ورود.txt) ──
const COURSE_TYPE_FA: Record<string, string> = {
  '0': 'نامشخص', '1': 'روزانه', '2': 'شبانه', '3': 'نیمه حضوری', '4': 'غیرانتفاعی',
  '5': 'دانشجویان خارجی', '6': 'روزانه - موارد خاص', '7': 'پیام نور',
  '8': 'دوره‌های آموزش عالی آزاد', '10': 'مجازی', '202': 'مهمانی',
};
const TRAINING_METHOD_FA: Record<string, string> = {
  '0': 'نامشخص', '1': 'آموزشی', '2': 'آموزشی - تغییر رشته دارای مغایرت', '3': 'آموزشی و پژوهشی',
  '4': 'آموزشی پژوهشی', '8': 'آموزشی - تغییر رشته', '11': 'پژوهش محور',
};
// Accept types (codes 0..17) — titles normalized
const ACCEPT_TYPE_FA: [string, string][] = [
  ['0', 'نامشخص'], ['1', 'قبولی کنکور سراسری'], ['2', 'دانشجوی علامه خویی'], ['3', 'دانشجوی زرینه خوی'],
  ['4', 'دانشجوی شمس خوی'], ['5', 'بدون آزمون - سوابق تحصیلی'], ['6', 'کنکور سراسری'], ['7', 'دانشجوی نژند'],
  ['8', 'انتقال از خارج'], ['9', 'استعداد درخشان'], ['10', 'ممتاز'], ['11', 'نفر اول دوره قبلی'],
  ['12', 'مهمان از دانشگاه دیگر'], ['13', 'انتقالی'], ['14', 'کنکور فنی و حرفه‌ای'],
  ['15', 'کنکور کاردانی به کارشناسی ناپیوسته'], ['16', 'آموزش عالی آزاد'],
  ['17', 'صرفاً بر اساس سوابق تحصیلی (کاردانی به کارشناسی)'],
];

/** Persian letter normalization + substring match (client-side port of faIncludes) */
const FA_NORMALIZER: Record<string, string> = { 'ي': 'ی', 'ك': 'ک', 'ة': 'ه', 'ؤ': 'و', 'ئ': 'ی', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ـ': '' };
function normalizeFa(s: string): string {
  let out = '';
  for (const ch of s) out += FA_NORMALIZER[ch] ?? ch;
  return out.replace(/\s+/g, ' ').trim();
}
function faIncludes(haystack: string, needle: string): boolean {
  const n = normalizeFa(needle).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  if (!n) return true;
  return normalizeFa(haystack).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).includes(n);
}

const acceptTypeTitle = (raw?: string | null) => {
  const n = normalizeFa(raw || '');
  if (!n) return '';
  return ACCEPT_TYPE_FA.find(([, t]) => normalizeFa(t) === n)?.[1] || raw || '';
};

export function StudentsManagerPage() {
  return (
    <ConfirmProvider>
      <StudentsManagerInner />
    </ConfirmProvider>
  );
}

function StudentsManagerInner() {
  const qc = useQueryClient();
  const confirmDialog = useConfirm();
  const [params, setParams] = useSearchParams();

  // ── URL-driven list state (f_nc deliberately stays out of the URL) ──
  const urlQ = params.get('q') ?? '';
  const urlStatus = (params.get('status') ?? 'ALL').toUpperCase();
  const urlDegree = Number(params.get('degree') ?? '0') || 0;
  const urlPage = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const urlSort = params.get('sort') ?? '';
  const [fNC, setFNC] = useState(params.get('f_nc') ?? '');
  const fCode = params.get('f_code') ?? '';
  const fName = params.get('f_name') ?? '';
  const fMajor = params.get('f_major') ?? '';
  const fYear = params.get('f_year') ?? '';

  // ── main view selection ──
  const [mainView, setMainView] = useState<'students' | 'professors' | 'quick_menu'>('students');
  const [stuTab, setStuTab] = useState<'list' | 'info_combined' | 'transcript'>('list');
  const [stuSubTab, setStuSubTab] = useState<'extra' | 'alumni'>('extra');
  const [profTab, setProfTab] = useState<'list' | 'info_combined'>('list');
  const [selectedStuIdx, setSelectedStuIdx] = useState(0);
  const [selectedProfIdx, setSelectedProfIdx] = useState(0);
  const [toastMsg, setToastMsg] = useState('');
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  };

  // ── lookups (meta) ──
  const metaQuery = useQuery({ queryKey: ['students-dossier-meta'], queryFn: getDossierMeta, staleTime: 60_000 });
  const meta = metaQuery.data;
  const canEditGrades = meta?.canEditGrades ?? false;

  // ── students list (server-side filters/sort/pagination) ──
  const listQuery = useQuery({
    queryKey: ['students-dossier-list', urlQ, urlStatus, urlDegree, urlPage, urlSort, fCode, fName, fMajor, fYear, fNC],
    queryFn: () => getDossierList({
      q: urlQ, status: urlStatus, degree: urlDegree, page: urlPage, sort: urlSort,
      f_code: fCode, f_name: fName, f_major: fMajor, f_year: fYear, f_nc: fNC,
    }),
    staleTime: 15_000,
  });
  const students = listQuery.data?.rows ?? [];
  const pg = listQuery.data;

  const refreshList = () => qc.invalidateQueries({ queryKey: ['students-dossier-list'] });

  const nav = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next);
  };

  // ── lazy staff list (server search, debounced) — state before selection ──
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [staffRoleIds, setStaffRoleIds] = useState<Record<number, number[]>>({});
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffLoadError, setStaffLoadError] = useState('');
  const [staffQuery, setStaffQuery] = useState('');
  const [staffTotal, setStaffTotal] = useState<number | null>(null);
  const [staffVisible, setStaffVisible] = useState(100);
  const [staffTypeFilter, setStaffTypeFilter] = useState('ALL');

  // ── navigation and selection ──
  const currentStudent = students[selectedStuIdx] || students[0];
  const currentStaff = staffList[selectedProfIdx] || staffList[0];
  useEffect(() => {
    if (mainView !== 'professors') return;
    let alive = true;
    setStaffLoading(true);
    setStaffLoadError('');
    const t = setTimeout(() => {
      loadStaffList(staffQuery)
        .then((res) => {
          if (!alive) return;
          if (res.ok && res.staffList) {
            setStaffList(res.staffList);
            setStaffRoleIds(res.userRoleIds ?? {});
            setStaffTotal(typeof res.total === 'number' ? res.total : null);
          } else {
            setStaffLoadError(res.error || 'فهرست استادان بارگذاری نشد.');
          }
        })
        .catch(() => {
          if (!alive) return;
          setStaffLoadError('ارتباط برقرار نشد. دوباره تلاش کنید.');
        })
        .finally(() => { if (alive) setStaffLoading(false); });
    }, staffQuery ? 350 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [mainView, staffQuery]);

  // ── transcript state ──
  const [transcript, setTranscript] = useState<TranscriptRow[] | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [regConfig, setRegConfig] = useState<RegulationConfig | null>(null);
  const [transcriptView, setTranscriptView] = useState<'official' | 'simple'>('official');
  const [printOptions, setPrintOptions] = useState<TranscriptPrintOptions>(DEFAULT_PRINT_OPTIONS);
  const [rankScope, setRankScope] = useState<'year' | 'term'>('year');
  const [cohortStats, setCohortStats] = useState<CohortStats | null>(null);
  const [cohortLoading, setCohortLoading] = useState(false);
  const [cohortError, setCohortError] = useState(false);

  useEffect(() => {
    if (stuTab !== 'transcript' || !currentStudent) return;
    setTranscriptLoading(true);
    setTranscript(null);
    setRegConfig(null);
    getDossierTranscript(currentStudent.id)
      .then((r) => setTranscript(r))
      .catch(() => setTranscript([]))
      .finally(() => setTranscriptLoading(false));
    getDossierTranscriptRegulation(currentStudent.id)
      .then((r) => setRegConfig(r?.config ?? null))
      .catch(() => setRegConfig(null));
  }, [stuTab, currentStudent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cohort rank stats only when the rank tick is on (heavy computation)
  useEffect(() => {
    if (!printOptions.showRank || !currentStudent) { setCohortStats(null); setCohortError(false); return; }
    let active = true;
    setCohortLoading(true);
    setCohortError(false);
    setCohortStats(null);
    getDossierCohortStats(currentStudent.id, rankScope)
      .then((r) => { if (active) { setCohortStats(r); if (!r) setCohortError(true); } })
      .catch(() => { if (active) { setCohortStats(null); setCohortError(true); } })
      .finally(() => { if (active) setCohortLoading(false); });
    return () => { active = false; };
  }, [printOptions.showRank, rankScope, currentStudent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── grade edit modal ──
  const [gradeEdit, setGradeEdit] = useState<GradeEditState>({
    open: false, target: null, student: null, transcript: [], valueInput: '', reasonInput: '',
    samaCode: 'AUTO', autoSama: { code: null, title: 'در حال محاسبه...' },
    needsStepUp: false, stepUpPw: '', saving: false, stepUpBusy: false,
  });
  const patchGradeEdit = (patch: Partial<GradeEditState>) => setGradeEdit((s) => ({ ...s, ...patch }));

  const openEditGrade = (row: TranscriptRow) => {
    setGradeEdit({
      open: true, target: row, student: currentStudent ?? null, transcript: transcript ?? [],
      valueInput: row.gradeValue ?? '', reasonInput: '', samaCode: 'AUTO',
      autoSama: { code: null, title: 'در حال محاسبه...' },
      needsStepUp: false, stepUpPw: '', saving: false, stepUpBusy: false,
    });
  };

  // Auto-resolve the Sama code preview for the modal
  useEffect(() => {
    if (!gradeEdit.open || !currentStudent || !gradeEdit.target?.offeringId) return;
    const num = gradeEdit.valueInput.trim() === '' ? null : Number(gradeEdit.valueInput.trim());
    if (num !== null && (isNaN(num) || num < 0 || num > 20)) return;
    let active = true;
    resolveSamaCodeForGrade(currentStudent.id, gradeEdit.target.offeringId, num)
      .then((res) => { if (active) patchGradeEdit({ autoSama: res }); })
      .catch(() => { if (active) patchGradeEdit({ autoSama: { code: null, title: 'خطا در محاسبه' } }); });
    return () => { active = false; };
  }, [gradeEdit.open, gradeEdit.target?.offeringId, gradeEdit.valueInput, currentStudent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadTranscript = () => {
    if (!currentStudent) return;
    setTranscriptLoading(true);
    getDossierTranscript(currentStudent.id)
      .then((r) => setTranscript(r))
      .catch(() => setTranscript([]))
      .finally(() => setTranscriptLoading(false));
  };

  const doSaveGrade = async () => {
    if (!currentStudent || !gradeEdit.target) return;
    const num = gradeEdit.valueInput.trim() === '' ? null : Number(gradeEdit.valueInput.trim());
    if (num !== null && (isNaN(num) || num < 0 || num > 20)) {
      showToast('نمره باید بین ۰ تا ۲۰ باشد.');
      return;
    }
    if (!gradeEdit.reasonInput.trim()) {
      showToast('لطفاً دلیل تغییر را وارد کنید.');
      return;
    }
    patchGradeEdit({ saving: true });
    try {
      const res = await setDossierGrade({
        enrollmentId: gradeEdit.target.enrollmentId ?? null,
        offeringId: gradeEdit.target.offeringId ?? null,
        studentId: currentStudent.id,
        studentCode: currentStudent.studentCode,
        termCode: gradeEdit.target.termCode,
        courseCode: gradeEdit.target.courseCode,
        gradeValue: num,
        customSamaStatusCode: gradeEdit.samaCode === 'AUTO' ? null : gradeEdit.samaCode,
        reason: gradeEdit.reasonInput.trim(),
      });
      if (res.ok) {
        showToast(res.message || 'نمره با موفقیت ثبت شد.');
        patchGradeEdit({ open: false });
        reloadTranscript();
        refreshList();
      } else if (res.error && res.error.startsWith('STEPUP_REQUIRED:')) {
        patchGradeEdit({ needsStepUp: true });
        showToast('🔐 برای ثبت نمره، ابتدا رمز عبور خود را تأیید کنید.');
      } else {
        showToast(res.error || 'خطا در ثبت نمره.');
      }
    } catch (e) {
      showToast((e as Error).message || 'خطا در ارتباط با سرور.');
    } finally {
      patchGradeEdit({ saving: false });
    }
  };

  /** Two-step verification confirm + retry the grade save */
  const handleStepUpConfirm = async () => {
    if (!gradeEdit.stepUpPw) { showToast('رمز عبور را وارد کنید.'); return; }
    patchGradeEdit({ stepUpBusy: true });
    try {
      const r = await requestStepUp('grades:edit', gradeEdit.stepUpPw).catch(() => ({ ok: false, error: 'خطا در ارتباط با سرور.' }));
      if (!r.ok) { showToast(r.error || 'تأیید نشد.'); return; }
      patchGradeEdit({ needsStepUp: false, stepUpPw: '' });
      showToast('✅ تأیید شد — در حال ثبت نمره…');
      await doSaveGrade();
    } finally {
      patchGradeEdit({ stepUpBusy: false });
    }
  };

  const handleSaveGrade = (e: FormEvent) => {
    e.preventDefault();
    void doSaveGrade();
  };

  // ── grade audit modal ──
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<GradeAuditRow[]>([]);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);
  const openAuditLogs = async () => {
    if (!currentStudent) return;
    setAuditOpen(true);
    setAuditLogsLoading(true);
    try {
      const logs = await getGradeAuditLog(currentStudent.id);
      setAuditLogs(logs);
    } catch {
      setAuditLogs([]);
    } finally {
      setAuditLogsLoading(false);
    }
  };

  // ── student profile form (identity + sama supplementary) ──
  const [profile, setProfile] = useState<Record<string, string | number | null>>({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [entryCode, setEntryCode] = useState('');
  const [entrySaving, setEntrySaving] = useState(false);
  const pf = (k: string, v: string | number) => setProfile((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    const s = currentStudent;
    if (!s) return;
    setProfile({
      fatherName: s.fatherName || '', birthCertNo: s.birthCertNo || '',
      placeOfBirth: s.placeOfBirth || '', placeOfIssue: s.placeOfIssue || '',
      gender: s.gender || '', mobile: s.mobile || '', email: s.email || '',
      postalCode: s.postalCode || '', address: s.address || '',
      passportNumber: s.passportNumber || '',
      advisorCode: s.advisorCode || '', documentStatus: s.documentStatus || '',
      scholarshipType: s.scholarshipType || '', militaryStatus: s.militaryStatus || '',
      militaryExemptionNo: s.militaryExemptionNo || '', homeTell: s.homeTell || '',
      studentCardStatus: s.studentCardStatus || '',
      archiveNo: s.archiveNo || '', parvandehNo: s.parvandehNo || '',
      dormName: s.dormName || '', dormRoom: s.dormRoom || '', hasDorm: s.hasDorm ?? 0,
      guardianJobTitle: s.guardianJobTitle || '', guardianPhone: s.guardianPhone || '',
      guardianAddress: s.guardianAddress || '', guardianEmail: s.guardianEmail || '',
      diplomaType: s.diplomaType || '', diplomaPlace: s.diplomaPlace || '',
      diplomaYear: s.diplomaYear || '', diplomaGrade: s.diplomaGrade || '',
      pishdPlace: s.pishdPlace || '', pishdYear: s.pishdYear || '', pishdGrade: s.pishdGrade || '',
      tuitionType: s.tuitionType || '', tuitionPayer: s.tuitionPayer ?? 0,
      englishExamType: s.englishExamType || '', englishScore: s.englishScore || '',
      certIssued3m: s.certIssued3m ?? 0, documentDeficiency: s.documentDeficiency || '',
      unitsRemaining: s.unitsRemaining ?? '', eqSemesters: s.eqSemesters ?? 0,
      nationality: s.nationality || '120001',
    });
    setEntryCode(`${s.entryYear}${s.entryTerm}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStudent?.id]);

  const saveProfile = async (keys: string[]) => {
    if (!currentStudent) return;
    setProfileSaving(true);
    try {
      const patch: StudentProfilePatch = {};
      for (const k of keys) if (profile[k] !== undefined) patch[k] = profile[k] ?? '';
      const r = await updateStudentProfile(currentStudent.id, patch);
      showToast(r.ok ? '✅ پروندهٔ دانشجو ذخیره شد.' : (r.error || 'انجام نشد.'));
      if (r.ok) refreshList();
    } catch (e) {
      showToast((e as Error).message || 'خطا در ارتباط با سرور.');
    } finally {
      setProfileSaving(false);
    }
  };

  const saveEntry = async () => {
    if (!currentStudent) return;
    const code = entryCode.trim();
    if (!/^\d{5}$/.test(code)) { showToast('کد ورود باید ۵ رقم باشد (مثل 14032).'); return; }
    const entryYear = Number(code.slice(0, 4));
    const entryTerm = Number(code.slice(4));
    if (entryYear < 1300 || entryYear > 1500) { showToast('سال ورود باید بین ۱۳۰۰ تا ۱۵۰۰ باشد.'); return; }
    if (entryTerm < 1 || entryTerm > 3) { showToast('ترم ورود باید ۱ (مهر)، ۲ (بهمن) یا ۳ (تابستان) باشد.'); return; }
    setEntrySaving(true);
    try {
      const r = await updateStudentProfile(currentStudent.id, { entryYear, entryTerm });
      showToast(r.ok ? '✅ سال/ترم ورود ذخیره شد.' : (r.error || 'انجام نشد.'));
      if (r.ok) refreshList();
    } catch (e) {
      showToast((e as Error).message || 'خطا در ارتباط با سرور.');
    } finally {
      setEntrySaving(false);
    }
  };
  // Term start from the typed entry code (term 2 → 11/01, else 07/01)
  const entryStartDate = (() => {
    const code = entryCode.trim();
    if (!/^\d{5}$/.test(code)) return null;
    const y = Number(code.slice(0, 4));
    const t = Number(code.slice(4));
    if (y < 1300 || y > 1500 || t < 1 || t > 3) return null;
    return `${faDigit(y)}/${t === 2 ? '۱۱' : '۰۷'}/۰۱`;
  })();

  // Geo options for birth/issue places (values are the stored titles)
  const geoPlaceOptions: string[] = useMemo(() => (meta?.geoPlaces ?? []).map((g) => g.title).filter(Boolean), [meta]);
  const geoPlaceSet = useMemo(() => new Set(geoPlaceOptions.map((t) => normalizeFa(t))), [geoPlaceOptions]);
  const geoValue = (v: string | number | null | undefined) => {
    const s = String(v ?? '');
    if (!s) return '';
    return geoPlaceSet.has(normalizeFa(s)) ? (geoPlaceOptions.find((t) => normalizeFa(t) === normalizeFa(s)) ?? s) : s;
  };
  const geoExtraOption = (v: string | number | null | undefined) => {
    const s = String(v ?? '');
    return !!s && !geoPlaceSet.has(normalizeFa(s));
  };
  const uniCodeOf = (id: number | null | undefined) =>
    meta?.universities?.find((u) => u.id === id)?.code ?? null;

  /** University of origin for the transcript header (highlighted when dissolved) */
  const originUniversity: OriginUniversity | null = (() => {
    const st = currentStudent;
    const list = meta?.universities ?? [];
    if (!st) return null;
    const mine = st.universityId != null ? list.find((u) => u.id === st.universityId) : undefined;
    if (mine && mine.kind === 'DISSOLVED') return { title: mine.title, dissolved: true };
    const sender = (st.senderUniversityCode || '').trim();
    if (sender) {
      const hit = list.find((u) => u.saminCode === sender || u.code === sender);
      if (hit && hit.code !== (meta?.currentUniversityCode ?? 'AFAGH')) {
        return { title: hit.title, dissolved: hit.kind === 'DISSOLVED' };
      }
    }
    return null;
  })();

  // ── column sort (server-side): key → asc → desc → no sort ──
  const [stuSortKey, stuSortDir] = (pg?.sort ?? '').split(':') as [string, string?];
  const toggleStuSort = (key: string) => {
    if (stuSortKey !== key) nav({ sort: `${key}:asc` });
    else if (stuSortDir === 'asc') nav({ sort: `${key}:desc` });
    else nav({ sort: '' });
  };
  // ── column filters (local + apply with Enter) ──
  const [stuFilters, setStuFilters] = useState({ f_code: fCode, f_name: fName, f_nc: fNC, f_major: fMajor, f_year: fYear });
  useEffect(() => {
    setStuFilters({ f_code: fCode, f_name: fName, f_nc: fNC, f_major: fMajor, f_year: fYear });
  }, [fCode, fName, fMajor, fYear, fNC]);
  const [searchQuery, setSearchQuery] = useState(urlQ);
  const applyStuFilters = () => {
    setFNC(stuFilters.f_nc.trim());
    nav({ f_code: stuFilters.f_code.trim(), f_name: stuFilters.f_name.trim(), f_major: stuFilters.f_major.trim(), f_year: stuFilters.f_year.trim(), page: '1' });
  };
  const clearStuFilters = () => {
    setSearchQuery('');
    setFNC('');
    setStuFilters({ f_code: '', f_name: '', f_nc: '', f_major: '', f_year: '' });
    nav({ q: '', status: 'ALL', degree: '0', sort: '', f_code: '', f_name: '', f_major: '', f_year: '', page: '1' });
  };

  // ── staff table (client-side sort + filter) ──
  const STAFF_COLS: { key: string; label: string; get: (s: StaffItem) => string }[] = [
    { key: 'staffCode', label: 'کد استاد', get: (s) => s.staffCode ?? '' },
    { key: 'name', label: 'نام و نام خانوادگی', get: (s) => `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() },
    { key: 'nationalCode', label: 'کد ملی', get: (s) => s.nationalCode ?? '' },
    { key: 'department', label: 'گروه آموزشی', get: (s) => s.departmentName && s.departmentName !== '—' ? s.departmentName : '' },
    { key: 'rank', label: 'مرتبه علمی', get: (s) => s.academicRank ?? '' },
    { key: 'degree', label: 'مدرک', get: (s) => s.degree ?? '' },
    { key: 'coop', label: 'نوع همکاری', get: (s) => s.staffType ?? '' },
  ];
  const [staffSort, setStaffSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [staffColFilters, setStaffColFilters] = useState<Record<string, string>>({});
  const staffQueryFiltered = staffList.filter((s) =>
    (!staffQuery ||
      faIncludes(s.staffCode ?? '', staffQuery) ||
      faIncludes(s.nationalCode ?? '', staffQuery) ||
      faIncludes(`${s.firstName ?? ''} ${s.lastName ?? ''}`, staffQuery)) &&
    (staffTypeFilter === 'ALL' || (staffTypeFilter === 'EDU' && (s.staffType ?? '').includes('هیئت')) || (staffTypeFilter === 'ADMIN' && (s.staffType ?? '').includes('اداری')) || (staffTypeFilter === 'OTHER' && !!s.staffType && !(s.staffType as string).includes('هیئت') && !(s.staffType as string).includes('اداری')))
  );
  const filteredStaff = useMemo(() => {
    let rows = staffQueryFiltered.filter((s) =>
      Object.entries(staffColFilters).every(([k, v]) => !v || faIncludes(STAFF_COLS.find((c) => c.key === k)?.get(s) ?? '', v)));
    if (staffSort) {
      const col = STAFF_COLS.find((c) => c.key === staffSort.key);
      if (col) {
        rows = [...rows].sort((a, b) => {
          const cmp = col.get(a).localeCompare(col.get(b), 'fa');
          return staffSort.dir === 'asc' ? cmp : -cmp;
        });
      }
    }
    return rows;
  }, [staffQueryFiltered, staffColFilters, staffSort]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── staff form save (F2) — reads the data-f inputs of the form ──
  const staffFormRef = useRef<HTMLDivElement>(null);
  const [staffSaving, setStaffSaving] = useState(false);
  const staffIsAdmin = (st: StaffItem) => (st.staffType ?? '').includes('اداری') || (st.staffType ?? '').includes('کارشناس');
  const staffIsEdu = (st: StaffItem) => (st.staffType ?? '').includes('هیئت') || (st.staffType ?? '').includes('مربی') || (st.staffType ?? '').includes('استاد');
  const staffEngageLabel = (st: StaffItem) => {
    if (staffIsAdmin(st) && staffIsEdu(st)) return 'فعال / اشتغال به تدریس و کار اداری';
    if (staffIsAdmin(st)) return 'فعال / اشتغال به کار اداری';
    return 'فعال / اشتغال به تدریس';
  };
  const handleSaveStaff = async () => {
    const root = staffFormRef.current;
    if (!currentStaff) { showToast('پروندهٔ استادی انتخاب نشده است.'); return; }
    if (!root) { showToast('فرم ویرایش باز نیست.'); return; }
    const get = (f: string) => (root.querySelector(`[data-f="${f}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    const patch: StaffProfilePatch = {};
    const put = (k: string, v: string) => {
      const s = (v ?? '').trim();
      if (s !== '' && s !== '—') patch[k] = s;
    };
    // Name: «نام خانوادگی - نام»
    const full = get('fullname');
    if (full.trim() !== '' && full.trim() !== '—') {
      const parts = full.split('-').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) { patch.lastName = parts[0]; patch.firstName = parts.slice(1).join(' '); }
    }
    for (const k of ['nationalCode', 'mobile', 'email', 'address', 'birthDate', 'academicRank', 'degree', 'cooperationType', 'staffType', 'personnelNo', 'hireDate', 'bankAccountNo', 'academicBase', 'fieldOfStudy', 'lastDegreeUniversity', 'lastDegreeCountryCode', 'phone']) {
      put(k, get(k));
    }
    const marriedEl = root.querySelector('input[name="prof_married"]:checked') as HTMLInputElement | null;
    if (marriedEl) {
      const label = marriedEl.parentElement?.textContent || '';
      patch.maritalStatus = label.includes('متأهل') ? 'متأهل' : 'مجرد';
    }
    const st = get('status');
    if (st === 'فعال') patch.isActive = 1;
    else if (st === 'غیرفعال') patch.isActive = 0;
    if (!Object.keys(patch).length) { showToast('تغییری برای ذخیره نیست.'); return; }
    setStaffSaving(true);
    try {
      const r = await updateStaffProfile(currentStaff.id, patch);
      showToast(r.ok ? '✅ اطلاعات استاد با موفقیت ذخیره شد.' : (r.error || 'انجام نشد.'));
      if (r.ok) void loadStaffList(staffQuery).then((res) => { if (res.ok && res.staffList) setStaffList(res.staffList); });
    } catch (e) {
      showToast((e as Error).message || 'خطا در ارتباط با سرور.');
    } finally {
      setStaffSaving(false);
    }
  };

  // ── web account management (active/inactive + password — ADMIN only) ──
  const [pwModalFor, setPwModalFor] = useState<{ userId: number; name: string } | null>(null);
  const [pwInput, setPwInput] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [roleModalFor, setRoleModalFor] = useState<{ userId: number; name: string } | null>(null);
  const [roleSel, setRoleSel] = useState<Set<number>>(new Set());
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleMsg, setRoleMsg] = useState('');
  const [bulk, setBulk] = useState<BulkModalState>({ open: false, scope: 'student', pass: '', saving: false, backfill: false, mode: 'password' });
  const patchBulk = (patch: Partial<BulkModalState>) => setBulk((s) => ({ ...s, ...patch }));
  const roleTitle = (r: { id: number; code: string; title: string }) => (r.title && r.title.trim()) || r.code;

  const handleToggleActive = async (userId: number | null | undefined, next: boolean, name: string) => {
    if (!userId) { showToast('شناسه کاربری این پرونده یافت نشد.'); return; }
    const ok = await confirmDialog({
      title: next ? 'فعال‌سازی حساب کامل' : 'غیرفعال‌سازی حساب کامل',
      body: `حساب «${name}» ${next ? 'فعال' : 'غیرفعال'} شود؟ شامل ورود، کارتابل، برنامه‌ریزی، نشست‌ها و OTPها.`,
      confirmText: next ? 'فعال کن' : 'غیرفعال کن',
      danger: !next,
    });
    if (!ok) return;
    const r = await setUserActive(userId, next).catch(() => ({ ok: false, error: 'خطا در ارتباط با سرور.' }));
    showToast(r.ok ? (next ? '✅ حساب کامل فعال شد.' : '⛔ حساب کامل غیرفعال شد (ورود/کارتابل/برنامه‌ریزی/نشست‌ها قطع شدند).') : (r.error || 'انجام نشد.'));
    if (r.ok) refreshList();
  };
  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!pwModalFor) return;
    setPwSaving(true);
    try {
      const r = await resetUserPassword(pwModalFor.userId, pwInput);
      showToast(r.ok ? `✅ رمز «${pwModalFor.name}» تغییر کرد (در اولین ورود باید عوض شود).` : (r.error || 'انجام نشد.'));
      if (r.ok) { setPwModalFor(null); setPwInput(''); refreshList(); }
    } finally {
      setPwSaving(false);
    }
  };
  const handleBulkReset = async (e: FormEvent) => {
    e.preventDefault();
    patchBulk({ saving: true });
    try {
      let extra = '';
      if (bulk.mode === 'national_code') {
        const r = await bulkResetRandomPasswords(bulk.scope);
        if (!r.ok) { showToast(r.error || 'انجام نشد.'); return; }
        extra = ` | رمزهای یک‌بارمصرف: ${(r.count ?? 0).toLocaleString('fa-IR')} حساب`;
      } else if (bulk.mode === 'force_change') {
        const r = await bulkForcePasswordChange(bulk.scope);
        if (!r.ok) { showToast(r.error || 'انجام نشد.'); return; }
        showToast(`✅ ${(r.count ?? 0).toLocaleString('fa-IR')} حساب ${bulk.scope === 'student' ? 'دانشجویی' : 'استادی'} ملزم به تغییر رمز در ورود بعدی شدند (رمز فعلی دست نخورد).`);
        patchBulk({ open: false });
        refreshList();
        return;
      } else {
        const r = await bulkResetPasswords(bulk.scope, bulk.pass);
        if (!r.ok) { showToast(r.error || 'انجام نشد.'); return; }
        extra = '';
      }
      if (bulk.backfill) {
        const b = await backfillRoles();
        extra += b.ok ? ` | نقش‌ها: +${(b.inserted ?? 0).toLocaleString('fa-IR')}` : ` | نقش‌ها: ${b.error || 'خطا'}`;
      }
      showToast(`✅ رمز ${bulk.mode === 'national_code' ? 'یک‌بارمصرف' : 'جدید'} برای حساب‌های ${bulk.scope === 'student' ? 'دانشجویی' : 'استادی'} اعمال شد (ورود اول اجباری به تغییر).${extra}`);
      patchBulk({ open: false, pass: '' });
      refreshList();
    } catch (err) {
      showToast((err as Error).message || 'خطا در ارتباط با سرور.');
    } finally {
      patchBulk({ saving: false });
    }
  };
  const handleSaveRoles = async (e: FormEvent) => {
    e.preventDefault();
    if (!roleModalFor) return;
    setRoleSaving(true);
    setRoleMsg('');
    try {
      const r = await saveUserRoles(roleModalFor.userId, [...roleSel]);
      if (!r.ok) { setRoleMsg(`⚠ ${r.error || 'ذخیره نشد.'}`); return; }
      setRoleMsg(`✅ ${(r.added ?? 0).toLocaleString('fa-IR')} نقش اضافه، ${(r.removed ?? 0).toLocaleString('fa-IR')} نقش حذف شد.`);
      setRoleModalFor(null);
      showToast(`نقش‌های «${roleModalFor.name}» ذخیره شد.`);
      void loadStaffList(staffQuery).then((res) => { if (res.ok && res.staffList) { setStaffList(res.staffList); setStaffRoleIds(res.userRoleIds ?? {}); } });
    } catch (err) {
      setRoleMsg(`⚠ ${(err as Error).message || 'خطا در ارتباط با سرور.'}`);
    } finally {
      setRoleSaving(false);
    }
  };
  const openRoleModalFor = (st: StaffItem) => {
    if (!st.userId) { showToast('شناسه کاربری این پرونده یافت نشد.'); return; }
    setRoleMsg('');
    setRoleSel(new Set(staffRoleIds?.[st.userId] ?? []));
    setRoleModalFor({ userId: st.userId, name: `${st.firstName} ${st.lastName}` });
  };

  // ── new staff/expert registration modal ──
  const [createStaffOpen, setCreateStaffOpen] = useState(false);
  const [createStaffBusy, setCreateStaffBusy] = useState(false);
  const [createStaffMsg, setCreateStaffMsg] = useState('');
  const [csf, setCsf] = useState<CreateStaffFields>({ nc: '', fn: '', ln: '', father: '', bcn: '', gender: '', mobile: '', email: '', code: '', type: '' });
  const openCreateStaff = () => {
    setCsf({ nc: '', fn: '', ln: '', father: '', bcn: '', gender: '', mobile: '', email: '', code: '', type: '' });
    setCreateStaffMsg('');
    setCreateStaffOpen(true);
  };
  const handleCreateStaff = async (e: FormEvent) => {
    e.preventDefault();
    setCreateStaffBusy(true);
    setCreateStaffMsg('');
    try {
      const r = await createStaffExpert({
        nationalCode: csf.nc, firstName: csf.fn, lastName: csf.ln,
        fatherName: csf.father, birthCertNo: csf.bcn, gender: csf.gender || undefined,
        mobile: csf.mobile, email: csf.email, staffCode: csf.code, staffType: csf.type,
      });
      if (!r.ok) { setCreateStaffMsg(`⚠ ${r.error || 'ثبت نشد.'}`); return; }
      setCreateStaffMsg('✅ حساب ساخته شد؛ نقش‌های کارشناس را می‌توانید از ستون «نقش‌ها» بدهید.');
      setCsf({ nc: '', fn: '', ln: '', father: '', bcn: '', gender: '', mobile: '', email: '', code: '', type: '' });
      setCreateStaffOpen(false);
      refreshList();
    } catch (err) {
      setCreateStaffMsg(`⚠ ${(err as Error).message || 'خطا در ارتباط با سرور.'}`);
    } finally {
      setCreateStaffBusy(false);
    }
  };

  const regTh = regThresholds(regConfig);
  const staffLoadRetry = () => {
    setMainView('students');
    setTimeout(() => setMainView('professors'), 0);
  };

  // ── loading / error shells ──
  if (metaQuery.isLoading || listQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (metaQuery.isError || !meta) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          بارگذاری اطلاعات پایه ناموفق بود. {(metaQuery.error as Error)?.message}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 text-xs text-slate-900">
      {/* ─── view switch: students / professors / quick actions ─── */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-800 text-white p-2.5 px-4 rounded-xl shadow-md border border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-300">
            {meta.universities?.find((u) => u.code === (meta.currentUniversityCode ?? 'AFAGH'))?.title ?? ''}
          </span>
          <button
            onClick={() => setMainView('students')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              mainView === 'students' ? 'bg-emerald-600 text-white shadow' : 'bg-slate-700/80 hover:bg-slate-700 text-slate-200'
            }`}
          >
            <span>👨‍🎓</span>
            <span>فرم پرونده و ثبت‌نام دانشجو</span>
          </button>
          <button
            onClick={() => setMainView('professors')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              mainView === 'professors' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-700/80 hover:bg-slate-700 text-slate-200'
            }`}
          >
            <span>👨‍🏫</span>
            <span>معرفی و پرونده اساتید</span>
          </button>
          <button
            onClick={() => setMainView('quick_menu')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              mainView === 'quick_menu' ? 'bg-amber-600 text-white shadow' : 'bg-slate-700/80 hover:bg-slate-700 text-slate-200'
            }`}
          >
            <span>⚡</span>
            <span>کاشی‌ها و عملیات سریع</span>
          </button>
        </div>
        <div className="text-2xs text-slate-300 font-mono">
          {mainView === 'students' ? `دانشجو: ${currentStudent?.studentCode || '—'}` : `استاد: ${currentStaff?.staffCode || '—'}`}
        </div>
      </div>

      {toastMsg && (
        <div className="p-3 bg-emerald-100 text-emerald-900 font-bold border border-emerald-300 rounded-xl shadow-sm text-center dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          {toastMsg}
        </div>
      )}

      {/* ═══════════════ ۱. student dossier form ═══════════════ */}
      {mainView === 'students' && (
        <div className="bg-slate-200 p-2 sm:p-4 rounded-xl border border-slate-400 shadow-xl space-y-2">

          <div className="flex flex-wrap items-center gap-1 border-b border-slate-400 pb-1 text-slate-800">
            <button
              onClick={() => setStuTab('list')}
              className={`px-3 py-1.5 font-bold rounded-t-md border-t border-x transition-colors ${
                stuTab === 'list' ? 'bg-white border-slate-400 text-indigo-950 shadow-sm' : 'bg-slate-300 border-transparent hover:bg-slate-100'
              }`}
            >
              📋 لیست دانشجویان
            </button>
            <button
              onClick={() => setStuTab('info_combined')}
              className={`px-3 py-1.5 font-bold rounded-t-md border-t border-x transition-colors ${
                stuTab === 'info_combined' ? 'bg-white border-slate-400 text-indigo-950 shadow-sm' : 'bg-slate-300 border-transparent hover:bg-slate-100'
              }`}
            >
              📄 اطلاعات دانشجو (اصلی + تکمیلی + سایر + اضافی)
            </button>
            <button
              onClick={() => setStuTab('transcript')}
              className={`px-3 py-1.5 font-bold rounded-t-md border-t border-x transition-colors ${
                stuTab === 'transcript' ? 'bg-white border-slate-400 text-indigo-950 shadow-sm' : 'bg-emerald-50 border-transparent hover:bg-emerald-100 text-emerald-900'
              }`}
            >
              📊 کارنامه و نمرات
            </button>
          </div>

          {/* record header + navigation */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-100 p-2 border border-slate-300 rounded">
            <div className="flex items-center gap-1">
              <button
                onClick={() => selectedStuIdx > 0 && setSelectedStuIdx(selectedStuIdx - 1)}
                disabled={selectedStuIdx === 0}
                className="px-2 py-1 bg-white border border-slate-400 rounded hover:bg-slate-50 disabled:opacity-40"
              >
                قبلی ▶
              </button>
              <button
                onClick={() => selectedStuIdx < students.length - 1 && setSelectedStuIdx(selectedStuIdx + 1)}
                disabled={selectedStuIdx === students.length - 1}
                className="px-2 py-1 bg-white border border-slate-400 rounded hover:bg-slate-50 disabled:opacity-40"
              >
                ◀ بعدی
              </button>
              <span className="text-2xs text-slate-500 mr-2 font-mono">
                پرونده {(selectedStuIdx + 1).toLocaleString('fa-IR')} از {students.length.toLocaleString('fa-IR')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-red-700">* شماره دانشجویی:</span>
              <input
                type="text"
                value={currentStudent?.studentCode || ''}
                readOnly
                className="bg-yellow-300 text-slate-950 font-mono font-bold text-sm px-3 py-1 border border-slate-500 rounded text-center w-36 tracking-wider shadow-inner"
              />
              <span className="text-2xs text-slate-600 mr-2">نام و نام خانوادگی:</span>
              <b className="text-slate-900 bg-white px-3 py-1 border border-slate-300 rounded font-bold">
                {currentStudent ? `${currentStudent.lastName} - ${currentStudent.firstName}` : '—'}
              </b>
            </div>
          </div>

          {/* ── combined info tab — section 1: identity ── */}
          {stuTab === 'info_combined' && currentStudent && (
            <div key={`stu-a-${currentStudent.id}`} className="bg-white p-3 sm:p-5 border border-slate-400 rounded-b-md space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* column 1 */}
                <div className="space-y-1.5 border border-slate-300 p-2.5 rounded bg-slate-50/50">
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-red-700 font-bold">* کد ترم ورود:</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={entryCode}
                        onChange={(e) => setEntryCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                        placeholder="مثل 14032"
                        disabled={entrySaving}
                        className="bg-white border border-slate-300 px-2 py-1 rounded font-mono w-28 text-center tracking-wider placeholder:text-slate-300 disabled:opacity-50"
                        title="سال ورود (۴ رقم) + ترم ورود (۱ رقم) — مثل 14032 یعنی سال 1403 ترم 2"
                      />
                      <button
                        onClick={saveEntry}
                        disabled={entrySaving}
                        className="px-2 py-1 rounded bg-blue-700 text-white font-bold text-2xs hover:bg-blue-800 disabled:opacity-50"
                        title="ذخیرهٔ سال/ترم ورود (فقط مدیر سیستم)"
                      >
                        {entrySaving ? 'در حال ذخیره…' : '💾 ذخیرهٔ ورود'}
                      </button>
                    </div>
                    <span className="text-slate-500 text-3xs">
                      {entryStartDate ? `* شروع: ${entryStartDate}` : null}
                      {currentStudent.entryDate ? ` — تاریخ ورود: ${dateToJalali(currentStudent.entryDate)}` : null}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-red-700 font-bold">* نام خانوادگی و نام:</span>
                    <input type="text" defaultValue={`${currentStudent.lastName} - ${currentStudent.firstName}`} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-bold" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>نام پدر:</span>
                    <input type="text" value={profile.fatherName ?? ''} onChange={(e) => pf('fatherName', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded" />
                    <div className="flex items-center gap-1">
                      <span>جنس:</span>
                      <select value={profile.gender ?? ''} onChange={(e) => pf('gender', e.target.value)} className="bg-white border border-slate-300 px-1 py-1 rounded">
                        <option value="">—</option>
                        <option value="MALE">مرد</option>
                        <option value="FEMALE">زن</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-red-700 font-bold">* تاریخ تولد:</span>
                    <input type="text" defaultValue={dateToJalali(currentStudent.birthDate)} className="bg-white border border-slate-300 px-2 py-1 rounded font-mono" title={currentStudent.birthDate ? `میلادی: ${currentStudent.birthDate}` : undefined} />
                    <div className="flex items-center gap-1">
                      <span>ش. شناسنامه:</span>
                      <input type="text" value={profile.birthCertNo ?? ''} onChange={(e) => pf('birthCertNo', e.target.value)} className="bg-white border border-slate-300 px-1 py-1 rounded font-mono w-full" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-red-700 font-bold">* کد ملی:</span>
                    <input type="text" defaultValue={currentStudent.nationalCode} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono font-bold" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>محل صدور:</span>
                    <select value={geoValue(profile.placeOfIssue)} onChange={(e) => pf('placeOfIssue', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded" title="از فهرست geo — کد وزارت خودکار ثبت می‌شود">
                      <option value="">—</option>
                      {geoPlaceOptions.map((t) => <option key={`i-${t}`} value={t}>{t}</option>)}
                      {geoExtraOption(profile.placeOfIssue) && <option value={profile.placeOfIssue ?? ''}>{profile.placeOfIssue} (قدیمی)</option>}
                    </select>
                    <div className="flex items-center gap-1">
                      <span>محل تولد:</span>
                      <select value={geoValue(profile.placeOfBirth)} onChange={(e) => pf('placeOfBirth', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" title="از فهرست geo — کد وزارت خودکار ثبت می‌شود">
                        <option value="">—</option>
                        {geoPlaceOptions.map((t) => <option key={`b-${t}`} value={t}>{t}</option>)}
                        {geoExtraOption(profile.placeOfBirth) && <option value={profile.placeOfBirth ?? ''}>{profile.placeOfBirth} (قدیمی)</option>}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>وضعیت تحصیلی:</span>
                    <select key={currentStudent.id} defaultValue={currentStudent.status} className="col-span-2 bg-emerald-50 text-emerald-900 border border-emerald-300 px-2 py-1 rounded font-bold">
                      {Object.entries(STUDENT_STATUS_FA).map(([v, fa]) => (
                        <option key={v} value={v}>{fa}</option>
                      ))}
                    </select>
                  </div>
                  {currentStudent.samaStatusCode && (
                    <div className="grid grid-cols-3 gap-2 items-center text-2xs text-slate-500">
                      <span>وضعیت در سما:</span>
                      <span className="col-span-2">کد {currentStudent.samaStatusCode} — {studentStatusFa(currentStudent.status, currentStudent.samaStatusCode, uniCodeOf(currentStudent.universityId))}</span>
                    </div>
                  )}
                </div>

                {/* column 2 */}
                <div className="space-y-1.5 border border-slate-300 p-2.5 rounded bg-slate-50/50">
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-red-700 font-bold">* نوع دوره:</span>
                    <select key={currentStudent.id + '-sm'} defaultValue={currentStudent.studyingMode || ''} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-semibold">
                      <option value="">—</option>
                      {Object.entries(COURSE_TYPE_FA).map(([v, fa]) => <option key={v} value={v}>{fa}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>شیوه آموزشی:</span>
                    <span className="col-span-2 bg-slate-100 border border-slate-200 px-2 py-1 rounded font-semibold text-slate-700">
                      {TRAINING_METHOD_FA[currentStudent.trainingMethod || ''] || currentStudent.trainingMethod || '—'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-red-700 font-bold">* مقطع:</span>
                    <select key={currentStudent.id + '-dl'} defaultValue={currentStudent.degreeLevelId} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-semibold">
                      {(meta.degrees ?? []).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-red-700 font-bold">* کد و نام رشته:</span>
                    <input type="text" defaultValue={`${currentStudent.majorCode} — ${currentStudent.majorName}`} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-bold" readOnly />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>دانشکده:</span>
                    <input type="text" defaultValue={currentStudent.facultyName || '—'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded" readOnly />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-red-700 font-bold">* سهمیه نهایی:</span>
                    <select key={currentStudent.id + '-q'} defaultValue={currentStudent.quotaType} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded">
                      {Object.entries(QUOTA_FA).map(([v, fa]) => (
                        <option key={v} value={v}>{fa}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-red-700 font-bold">* نحوه ورود:</span>
                    <select key={currentStudent.id + '-at'} defaultValue={acceptTypeTitle(currentStudent.acceptanceType)} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded">
                      <option value="">—</option>
                      {ACCEPT_TYPE_FA.map(([c, fa]) => fa !== 'نامشخص' && <option key={c} value={fa}>{fa}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>شماره همراه:</span>
                    <input type="text" value={profile.mobile ?? ''} onChange={(e) => pf('mobile', e.target.value)} placeholder="—" className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>شماره ثابت منزل:</span>
                    <input type="text" value={profile.homeTell ?? ''} onChange={(e) => pf('homeTell', e.target.value)} placeholder="—" className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>آیین‌نامه ملاک:</span>
                    <div className="col-span-2 flex gap-1.5">
                      <select
                        value={currentStudent.regulationId ?? 0}
                        onChange={(e) => {
                          const rid = Number(e.target.value);
                          if (!rid || !currentStudent) return;
                          showToast('⏳ در حال تغییر آیین‌نامه و بازمحاسبه کدهای نمرات...');
                          setStudentRegulation(currentStudent.id, rid).then((r) => {
                            showToast(r.ok ? `آیین‌نامه تغییر کرد — ${faNum(r.scanned ?? 0, 0)} نمره بررسی، ${faNum(r.updated ?? 0, 0)} کد اصلاح شد.` : (r.error || 'انجام نشد.'));
                            if (r.ok) refreshList();
                          }).catch(() => showToast('انجام نشد.'));
                        }}
                        className="flex-1 bg-white border border-slate-300 px-2 py-1 rounded font-semibold text-indigo-950"
                      >
                        <option value={0} disabled>{currentStudent.regulationTitle}</option>
                        {(meta.regulations ?? []).map((r) => (
                          <option key={r.id} value={r.id}>{r.title}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {/* ── web account: active/inactive + password (ADMIN) ── */}
                  <div className="grid grid-cols-3 gap-2 items-center border-t border-slate-200 pt-2 mt-2">
                    <span className="font-bold">🔐 حساب وب:</span>
                    <span className={`text-2xs font-bold px-2 py-0.5 rounded-full text-center ${currentStudent.isActive === 0 ? 'bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'}`}>
                      {currentStudent.isActive === 0 ? '⛔ غیرفعال' : '✅ فعال'}
                    </span>
                    <div className="flex gap-1.5 justify-end">
                      <button
                        onClick={() => handleToggleActive(currentStudent.userId, currentStudent.isActive === 0, `${currentStudent.firstName} ${currentStudent.lastName}`)}
                        className={`px-2.5 py-1 rounded text-2xs font-bold border ${currentStudent.isActive === 0 ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'bg-red-50 text-red-800 border-red-300 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900'}`}
                        title="فعال/غیرفعال‌سازی کامل حساب (ورود، کارتابل، برنامه‌ریزی، نشست‌ها، OTPها) — فقط مدیر سیستم"
                      >
                        {currentStudent.isActive === 0 ? 'فعال‌سازی کامل' : 'غیرفعال‌سازی کامل'}
                      </button>
                      <button
                        onClick={() => { setPwModalFor({ userId: currentStudent.userId ?? 0, name: `${currentStudent.firstName} ${currentStudent.lastName}` }); setPwInput(''); }}
                        className="px-2.5 py-1 rounded text-2xs font-bold bg-slate-700 text-white hover:bg-slate-800"
                        title="تغییر رمز عبور دانشجو (فقط مدیر سیستم)"
                      >
                        🔑 تغییر رمز
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-300 flex items-center gap-2">
                <button
                  onClick={() => saveProfile(['fatherName', 'birthCertNo', 'placeOfBirth', 'placeOfIssue', 'gender', 'mobile', 'homeTell', 'nationality'])}
                  disabled={profileSaving}
                  className="px-3 py-1.5 rounded bg-emerald-700 text-white font-bold text-xs hover:bg-emerald-800 disabled:opacity-50"
                  title="ذخیرهٔ تغییرات هویت این دانشجو (فقط مدیر سیستم)"
                >
                  💾 ذخیرهٔ اطلاعات هویت
                </button>
                {profileSaving && <span className="text-slate-500">در حال ذخیره…</span>}
              </div>
            </div>
          )}

          {/* ── section 2: supplementary info ── */}
          {stuTab === 'info_combined' && currentStudent && (
            <div key={`stu-b-${currentStudent.id}`} className="bg-white p-3 sm:p-5 border border-slate-400 rounded-b-md space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* personnel photo — secure /api/v2/photo/:userId route */}
                <div className="border border-slate-300 p-3 rounded bg-slate-50 flex flex-col items-center justify-center space-y-2">
                  <PersonPhoto userId={currentStudent.userId} hasPhoto={!!currentStudent.photoKey} className="w-28 h-36" icon="👤" label="عکس پرسنلی" />
                  <div className="flex flex-col gap-1 w-full max-w-[140px]">
                    <button onClick={() => showToast('📁 کادر انتخاب تصویر باز شد')} className="px-2 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100 font-bold text-2xs">فایل تصویر</button>
                    <button onClick={() => showToast('تصویر حذف گردید')} className="px-2 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100 text-red-700 text-2xs">حذف تصویر</button>
                    <button onClick={() => showToast('کپی تصویر انجام شد')} className="px-2 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100 text-2xs">کپی تصویر به فایل</button>
                  </div>
                </div>

                {/* supplementary fields */}
                <div className="md:col-span-2 space-y-2 border border-slate-300 p-3 rounded bg-slate-50">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-24">استاد راهنما:</span>
                      <input type="text" value={profile.advisorCode ?? ''} onChange={(e) => pf('advisorCode', e.target.value)} className="bg-yellow-100 border border-slate-300 px-2 py-1 rounded w-full font-bold dark:text-slate-900" placeholder="کد/نام استاد راهنما —" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-24">وضعیت نظام وظیفه:</span>
                      <select value={profile.militaryStatus ?? ''} onChange={(e) => pf('militaryStatus', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full">
                        <option value="">—</option>
                        <option value="خانم است و وضعیت نظام وظیفه ندارد">خانم است و وضعیت نظام وظیفه ندارد</option>
                        <option value="مشمول است و دفترچه دارد">مشمول است و دفترچه دارد</option>
                        <option value="مشمول است ولی دفترچه ندارد">مشمول است ولی دفترچه ندارد</option>
                        <option value="معافیت پزشکی یا کفالت">معافیت پزشکی یا کفالت</option>
                        <option value="کارت پایان خدمت">کارت پایان خدمت</option>
                        <option value="سرباز ترخیصی">سرباز ترخیصی</option>
                        <option value="معافیت تحصیلی فعال">معافیت تحصیلی فعال</option>
                        <option value="معافیت دائم">معافیت دائم</option>
                        <option value="کارمند آموزش و پرورش">کارمند آموزش و پرورش</option>
                        <option value="کارمند">کارمند</option>
                        <option value="دانشجوی سال آخر مقطع قبل">دانشجوی سال آخر مقطع قبل</option>
                        <option value="فارغ‌التحصیل بدون غیبت">فارغ‌التحصیل بدون غیبت</option>
                        <option value="دانشجوی انصرافی">دانشجوی انصرافی</option>
                        <option value="متولد ماقبل ۱۳۵۲">متولد ماقبل ۱۳۵۲</option>
                        <option value="کارکنان متعهد خدمت ارگان‌ها">کارکنان متعهد خدمت ارگان‌ها</option>
                        <option value="مشمول نیست">مشمول نیست</option>
                        <option value="فاقد معافیت">فاقد معافیت</option>
                        <option value="در حال تحصیل (معافیت موقت)">در حال تحصیل (معافیت موقت)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-24">وضعیت مدارک:</span>
                      <select value={profile.documentStatus ?? ''} onChange={(e) => pf('documentStatus', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full">
                        <option value="">—</option>
                        <option value="تکمیل و تأییدشده ✓">تکمیل و تأییدشده ✓</option>
                        <option value="دارای نقص مدرک">دارای نقص مدرک</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-24">نوع بورسیه:</span>
                      <input type="text" value={profile.scholarshipType ?? ''} onChange={(e) => pf('scholarshipType', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="—" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-24">Full Name:</span>
                      <input type="text" defaultValue={[currentStudent.firstNameEn, currentStudent.lastNameEn].filter(Boolean).join(' ') || '—'} className="bg-white border border-slate-300 px-2 py-1 rounded w-full font-mono text-left" dir="ltr" readOnly />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-24">Father Name:</span>
                      <input type="text" defaultValue={currentStudent.fatherName || '—'} className="bg-white border border-slate-300 px-2 py-1 rounded w-full font-mono text-left" dir="ltr" readOnly />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-24">شماره پاسپورت:</span>
                      <input type="text" defaultValue={currentStudent.passportNumber || '—'} className="bg-white border border-slate-300 px-2 py-1 rounded w-full font-mono" readOnly />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-24">تاریخ فارغ‌التحصیلی:</span>
                      <input type="text" defaultValue={currentStudent.graduateDate || '—'} className="bg-white border border-slate-300 px-2 py-1 rounded w-full font-mono" readOnly />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-1 border-t border-slate-200">
                    <label className="flex items-center gap-1.5 cursor-pointer font-bold">
                      <input
                        type="checkbox"
                        checked={profile.nationality === '120001'}
                        onChange={(e) => pf('nationality', e.target.checked ? '120001' : '')}
                        className="w-4 h-4 text-emerald-600 rounded"
                      />
                      <span>تابعیت ایرانی دارد</span>
                    </label>
                    <span className="text-slate-500">سال‌های استفاده از آموزش رایگان:</span>
                    <input type="number" defaultValue="۰" className="w-16 bg-white border border-slate-300 px-2 py-0.5 rounded font-mono text-center" />
                  </div>
                </div>
              </div>

              {/* English exam box */}
              <div className="border border-slate-300 p-2.5 rounded bg-slate-50 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-slate-800">وضعیت نمره آزمون زبان انگلیسی:</span>
                  <span>نوع آزمون:</span>
                  <select value={profile.englishExamType ?? ''} onChange={(e) => pf('englishExamType', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded">
                    <option value="">—</option>
                    <option value="MSRT">MSRT</option>
                    <option value="Tolimo">Tolimo</option>
                    <option value="IELTS">IELTS</option>
                    <option value="TOEFL">TOEFL</option>
                  </select>
                  <span>نمره آزمون:</span>
                  <input type="text" value={profile.englishScore ?? ''} onChange={(e) => pf('englishScore', e.target.value)} className="w-20 bg-white border border-slate-300 px-2 py-1 rounded font-mono text-center font-bold" placeholder="—" />
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200 text-2xs text-slate-600">
                  <div className="bg-white p-1.5 border border-slate-200 rounded">
                    <span>اولین ثبت‌کننده: </span>
                    <b className="text-slate-800">{(profile.insertDate || profile.insertTime) ? 'سما' : '—'}</b>
                    {(profile.insertDate || profile.insertTime) && (
                      <span> | ساعت: {profile.insertTime || '—'} | تاریخ: {profile.insertDate || '—'}</span>
                    )}
                  </div>
                  <div className="bg-white p-1.5 border border-slate-200 rounded">
                    <span>آخرین تغییرات: </span>
                    <b className="text-slate-800">—</b>
                  </div>
                </div>
                <div className="pt-1 border-t border-slate-200 flex items-center gap-2">
                  <button
                    onClick={() => saveProfile(['advisorCode', 'militaryStatus', 'documentStatus', 'scholarshipType', 'englishExamType', 'englishScore'])}
                    disabled={profileSaving}
                    className="px-3 py-1 rounded bg-emerald-700 text-white font-bold text-xs hover:bg-emerald-800 disabled:opacity-50"
                    title="ذخیرهٔ اطلاعات تکمیلی این دانشجو (فقط مدیر سیستم)"
                  >
                    💾 ذخیرهٔ اطلاعات تکمیلی
                  </button>
                  {profileSaving && <span className="text-slate-500">در حال ذخیره…</span>}
                </div>
              </div>
            </div>
          )}

          {/* ── section 3: other info ── */}
          {stuTab === 'info_combined' && currentStudent && (
            <div key={`stu-c-${currentStudent.id}`} className="bg-white p-3 sm:p-5 border border-slate-400 rounded-b-md space-y-3">
              <div className="border border-slate-300 p-2.5 rounded bg-slate-50 space-y-1.5">
                <div className="grid grid-cols-3 gap-2 items-center">
                  <span>نام خوابگاه و شماره اتاق:</span>
                  <input type="text" value={profile.dormName ?? ''} onChange={(e) => pf('dormName', e.target.value)} className="bg-yellow-100 border border-slate-300 px-2 py-1 rounded font-bold dark:text-slate-900" placeholder="—" />
                  <input type="text" value={profile.dormRoom ?? ''} onChange={(e) => pf('dormRoom', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded text-center" placeholder="—" />
                </div>
                <div className="grid grid-cols-3 gap-2 items-center">
                  <span>عنوان و شغل ولی/قیم:</span>
                  <input type="text" value={profile.guardianJobTitle ?? ''} onChange={(e) => pf('guardianJobTitle', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded" placeholder="—" />
                  <div className="flex items-center gap-1">
                    <span>تلفن ولی:</span>
                    <input type="text" value={profile.guardianPhone ?? ''} onChange={(e) => pf('guardianPhone', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded font-mono w-full" placeholder="—" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 items-center">
                  <span>کد پستی و ایمیل:</span>
                  <input type="text" value={profile.postalCode ?? ''} onChange={(e) => pf('postalCode', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded font-mono" placeholder="—" />
                  <input type="email" value={profile.email ?? ''} onChange={(e) => pf('email', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded font-mono text-left" dir="ltr" placeholder="ایمیل دانشجو" />
                </div>
              </div>

              {/* previous-level records matrix */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="border border-slate-300 p-2.5 rounded bg-slate-50 space-y-1">
                  <h4 className="font-bold text-slate-800 border-b pb-1">سوابق دوره پیش‌دانشگاهی / دیپلم:</h4>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">محل اخذ دیپلم:</span>
                    <input type="text" value={profile.diplomaPlace ?? ''} onChange={(e) => pf('diplomaPlace', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded flex-1" placeholder="—" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">سال اخذ:</span>
                    <input type="text" value={profile.diplomaYear ?? ''} onChange={(e) => pf('diplomaYear', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded w-16 font-mono" placeholder="—" />
                    <span className="text-slate-500">معدل کتبی دیپلم:</span>
                    <b className="text-emerald-800">{profile.diplomaGrade || '—'}</b>
                    <input type="text" value={profile.diplomaGrade ?? ''} onChange={(e) => pf('diplomaGrade', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded w-14 font-mono" placeholder="—" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">پیش‌دانشگاهی:</span>
                    <input type="text" value={profile.pishdPlace ?? ''} onChange={(e) => pf('pishdPlace', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded flex-1" placeholder="محل —" />
                    <input type="text" value={profile.pishdYear ?? ''} onChange={(e) => pf('pishdYear', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded w-16 font-mono" placeholder="سال" />
                    <input type="text" value={profile.pishdGrade ?? ''} onChange={(e) => pf('pishdGrade', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded w-14 font-mono" placeholder="معدل" />
                  </div>
                </div>
                <div className="border border-slate-300 p-2.5 rounded bg-slate-50 space-y-1">
                  <h4 className="font-bold text-slate-800 border-b pb-1">اطلاعات وضعیت شهریه‌پرداز:</h4>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">نوع دوره:</span>
                    <input type="text" value={profile.tuitionType ?? ''} onChange={(e) => pf('tuitionType', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded flex-1" placeholder="روزانه (آموزش رایگان دولتی) —" />
                  </div>
                  <label className="flex items-center gap-1.5 font-bold mt-1">
                    <input
                      type="checkbox"
                      checked={(profile.tuitionPayer ?? 0) === 1}
                      onChange={(e) => pf('tuitionPayer', e.target.checked ? 1 : 0)}
                      className="w-4 h-4 text-emerald-600 rounded"
                    />
                    <span>دانشجوی شهریه‌پرداز است (نوبت دوم/پردیس)</span>
                  </label>
                </div>
              </div>
              <div className="pt-1 border-t border-slate-300 flex items-center gap-2">
                <button
                  onClick={() => saveProfile(['dormName', 'dormRoom', 'guardianJobTitle', 'guardianPhone', 'postalCode', 'email', 'diplomaPlace', 'diplomaYear', 'diplomaGrade', 'pishdPlace', 'pishdYear', 'pishdGrade', 'tuitionType', 'tuitionPayer'])}
                  disabled={profileSaving}
                  className="px-3 py-1.5 rounded bg-emerald-700 text-white font-bold text-xs hover:bg-emerald-800 disabled:opacity-50"
                  title="ذخیرهٔ سایر اطلاعات این دانشجو (فقط مدیر سیستم)"
                >
                  💾 ذخیرهٔ سایر اطلاعات
                </button>
                {profileSaving && <span className="text-slate-500">در حال ذخیره…</span>}
              </div>
            </div>
          )}

          {/* ── section 4: extra info + alumni ── */}
          {stuTab === 'info_combined' && currentStudent && (
            <div key={`stu-d-${currentStudent.id}`} className="bg-white p-3 sm:p-5 border border-slate-400 rounded-b-md space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-300 pb-2">
                <button
                  onClick={() => setStuSubTab('extra')}
                  className={`px-3 py-1 rounded font-bold ${
                    stuSubTab === 'extra' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  📄 اطلاعات اضافی و پرونده
                </button>
                <button
                  onClick={() => setStuSubTab('alumni')}
                  className={`px-3 py-1 rounded font-bold ${
                    stuSubTab === 'alumni' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  🎓 اطلاعات دانش‌آموختگان و تسویه‌ها
                </button>
              </div>

              {stuSubTab === 'extra' && (
                <div className="space-y-2 border border-slate-300 p-3 rounded bg-slate-50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">نوع دیپلم پایه:</span>
                        <input type="text" value={profile.diplomaType ?? ''} onChange={(e) => pf('diplomaType', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="—" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">کد صحت مدارک / آرشیو:</span>
                        <input type="text" value={profile.archiveNo ?? ''} onChange={(e) => pf('archiveNo', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="—" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">ابطال نظام وظیفه:</span>
                        <input type="text" value={profile.militaryStatus ?? ''} onChange={(e) => pf('militaryStatus', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="در حال تحصیل (معافیت موقت)" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">شمارهٔ معافیت:</span>
                        <input type="text" value={profile.militaryExemptionNo ?? ''} onChange={(e) => pf('militaryExemptionNo', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="—" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">تعداد صدور گواهی ۳ ماهه:</span>
                        <input type="number" value={profile.certIssued3m ?? 0} onChange={(e) => pf('certIssued3m', Number(e.target.value) || 0)} className="bg-white border border-slate-300 px-2 py-1 rounded w-20 font-mono" />
                        <span>فقره</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">شمارهٔ پرونده:</span>
                        <input type="text" value={profile.parvandehNo ?? ''} onChange={(e) => pf('parvandehNo', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="—" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">تعداد ترم معادل‌سازی:</span>
                        <input type="number" value={profile.eqSemesters ?? 0} onChange={(e) => pf('eqSemesters', Number(e.target.value) || 0)} className="bg-white border border-slate-300 px-2 py-1 rounded w-20 font-mono" />
                        <span>ترم</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">وضعیت صدور کارت دانشجویی:</span>
                        <input type="text" value={profile.studentCardStatus ?? ''} onChange={(e) => pf('studentCardStatus', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="صادر و تحویل شده" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">نواقص پرونده:</span>
                        <input type="text" value={profile.documentDeficiency ?? ''} onChange={(e) => pf('documentDeficiency', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="فاقد نقص پرونده" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">واحد مانده تا فارغ‌التحصیلی:</span>
                        <input type="number" value={profile.unitsRemaining ?? ''} onChange={(e) => pf('unitsRemaining', e.target.value === '' ? '' : Number(e.target.value) || 0)} className="bg-white border border-slate-300 px-2 py-1 rounded w-20 font-mono" />
                        <span>واحد</span>
                      </div>
                    </div>
                  </div>
                  <div className="pt-1 border-t border-slate-200 flex items-center gap-2">
                    <button
                      onClick={() => saveProfile(['diplomaType', 'archiveNo', 'militaryStatus', 'militaryExemptionNo', 'certIssued3m', 'parvandehNo', 'eqSemesters', 'studentCardStatus', 'documentDeficiency', 'unitsRemaining'])}
                      disabled={profileSaving}
                      className="px-3 py-1.5 rounded bg-emerald-700 text-white font-bold text-xs hover:bg-emerald-800 disabled:opacity-50"
                      title="ذخیرهٔ اطلاعات اضافی این دانشجو (فقط مدیر سیستم)"
                    >
                      💾 ذخیرهٔ اطلاعات اضافی
                    </button>
                    {profileSaving && <span className="text-slate-500">در حال ذخیره…</span>}
                  </div>
                </div>
              )}

              {stuSubTab === 'alumni' && (
                <div className="space-y-3 border border-slate-300 p-3 rounded bg-slate-50">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="border border-slate-200 p-2 rounded bg-white">
                      <p className="font-bold text-slate-800">📜 دانشنامه رسمی</p>
                      <p className="text-2xs text-slate-500 mt-1">تاریخ صدور: —</p>
                      <p className="text-2xs text-slate-500">شماره دبیرخانه: —</p>
                    </div>
                    <div className="border border-slate-200 p-2 rounded bg-white">
                      <p className="font-bold text-slate-800">📑 ریزنمرات رسمی</p>
                      <p className="text-2xs text-slate-500 mt-1">تاریخ صدور: —</p>
                      <p className="text-2xs text-slate-500">شماره دبیرخانه: —</p>
                    </div>
                    <div className="border border-slate-200 p-2 rounded bg-white">
                      <p className="font-bold text-slate-800">📄 گواهی موقت پایان تحصیلات</p>
                      <p className="text-2xs text-slate-500 mt-1">تاریخ صدور: —</p>
                      <p className="text-2xs text-slate-500">شماره دبیرخانه: —</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-around bg-slate-100 p-2 rounded border border-slate-200 font-semibold text-2xs">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 text-emerald-600 rounded" />
                      <span>تسویه حساب داخلی دانشکده</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 text-emerald-600 rounded" />
                      <span>نامه لغو تعهد آموزش رایگان</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 text-emerald-600 rounded" />
                      <span>نامه عدم بدهی صندوق رفاه دانشجویان</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 text-emerald-600 rounded" />
                      <span>تأیید اصالت و صدور QRCode دانشنامه</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── transcript tab ── */}
          {stuTab === 'transcript' && currentStudent && (
            <div key={`stu-tr-${currentStudent.id}`} className="transcript-print-area bg-white p-3 sm:p-4 border border-slate-400 rounded-b-md space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
                <h3 className="font-extrabold text-slate-900">📊 کارنامهٔ {currentStudent.lastName} - {currentStudent.firstName} ({currentStudent.studentCode})</h3>
                <div className="flex items-center gap-1.5">
                  <span className="text-2xs text-slate-500 ml-1">{transcript ? `${faNumber(transcript.length)} درس` : ''}</span>
                  <button
                    onClick={() => setTranscriptView('official')}
                    className={`px-2.5 py-1 rounded-lg text-2xs font-bold border ${transcriptView === 'official' ? 'bg-indigo-700 text-white border-indigo-700' : 'bg-slate-50 border-slate-300 hover:bg-slate-100'}`}
                  >
                    🧾 کارنامه رسمی
                  </button>
                  <button
                    onClick={() => setTranscriptView('simple')}
                    className={`px-2.5 py-1 rounded-lg text-2xs font-bold border ${transcriptView === 'simple' ? 'bg-indigo-700 text-white border-indigo-700' : 'bg-slate-50 border-slate-300 hover:bg-slate-100'}`}
                  >
                    📋 جدول نمرات
                  </button>
                  {canEditGrades && (
                    <>
                      <button
                        onClick={() => {
                          if (transcript && transcript.length > 0) {
                            openEditGrade(transcript[0]);
                          } else {
                            openEditGrade({
                              termCode: '', termTitle: null, courseCode: '', courseTitle: '', units: null,
                              courseType: null, gradeValue: null, gradeStatus: 'PENDING', gradeStatusTitle: null,
                              gradeStatusCode: null, offeringType: null, termStatusTitle: null, termProbation: null,
                            });
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg text-2xs font-bold bg-amber-600 text-white hover:bg-amber-700"
                        title="ثبت یا اصلاح نمره توسط آموزش / فارغ‌التحصیلان"
                      >
                        ✏️ ثبت / تغییر نمره
                      </button>
                      <button
                        onClick={openAuditLogs}
                        className="px-2.5 py-1 rounded-lg text-2xs font-bold bg-slate-700 text-white hover:bg-slate-800"
                        title="مشاهده لاگ ممیزی و تاریخچه تغییرات نمرات دانشجو"
                      >
                        📜 لاگ ممیزی نمرات
                      </button>
                    </>
                  )}
                  {transcript && transcript.length > 0 && (
                    <button
                      onClick={() => doPrintTranscript('landscape')}
                      className="px-2.5 py-1 rounded-lg text-2xs font-bold bg-emerald-700 text-white hover:bg-emerald-800"
                      title="چاپ کارنامه در کاغذ افقی (فرمت سما: ۳ نیمسال کنار هم)"
                    >
                      🖨️ چاپ افقی
                    </button>
                  )}
                  {transcript && transcript.length > 0 && (
                    <button
                      onClick={() => doPrintTranscript('portrait')}
                      className="px-2.5 py-1 rounded-lg text-2xs font-bold bg-teal-700 text-white hover:bg-teal-800"
                      title="چاپ کارنامه در کاغذ عمودی (نیمسال‌ها زیر هم)"
                    >
                      🖨️ چاپ عمودی
                    </button>
                  )}
                </div>
                {transcript && transcript.length > 0 && (
                  <p className="text-3xs text-slate-500">
                    ⚖️ مبنای محاسبه: <b>{currentStudent.regulationTitle}</b>
                    {(() => { const th = regTh; return ` (قبولی ${faNum(th.pass, 0)} — مشروطی زیر ${faNum(th.prob, 0)}${th.minUnits > 0 ? ` — حدنصاب واحد ترم ${faNum(th.minUnits, 0)}` : ''}${th.exclFailed ? ' — حذف مردودی قبول‌شده از معدل کل' : ''})`; })()}
                  </p>
                )}
                {/* ── print settings (Sama ticks) — not printed ── */}
                {transcript && transcript.length > 0 && transcriptView === 'official' && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-2 print:hidden">
                    <span className="text-2xs font-bold text-slate-500">⚙️ تنظیمات چاپ:</span>
                    {([
                      ['showLegend', 'توضیح وضع نمرات'],
                      ['showBreakdown', 'جدول وضعیت دروس'],
                      ['showRank', 'رتبه هم‌رشته‌ای'],
                      ['showNationality', 'ملیت'],
                      ['showPhoto', 'عکس'],
                      ['showLogo', 'آرم دانشگاه'],
                      ['showAcceptance', 'نحوه ورود'],
                      ['showStudyMode', 'شیوه آموزشی'],
                      ['thesisQualitative', 'پایان‌نامه کیفی'],
                    ] as [keyof TranscriptPrintOptions, string][]).map(([k, label]) => (
                      <label
                        key={k}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-2xs font-bold border cursor-pointer ${printOptions[k] ? 'bg-indigo-50 border-indigo-300 text-indigo-900' : 'bg-slate-50 border-slate-300 text-slate-500'}`}
                      >
                        <input
                          type="checkbox"
                          checked={printOptions[k]}
                          onChange={(e) => setPrintOptions((o) => ({ ...o, [k]: e.target.checked }))}
                          className="w-3.5 h-3.5 accent-indigo-700"
                        />
                        {label}
                      </label>
                    ))}
                    {printOptions.showRank && (
                      <select
                        value={rankScope}
                        onChange={(e) => setRankScope(e.target.value as 'year' | 'term')}
                        className="px-2 py-0.5 rounded-lg text-2xs font-bold border border-indigo-300 bg-indigo-50 text-indigo-900"
                        title="بازهٔ رتبه: هم‌ورودی‌های یک سال یا یک ترم"
                      >
                        <option value="year">هم‌ورودی سال</option>
                        <option value="term">هم‌ورودی ترم</option>
                      </select>
                    )}
                    {cohortLoading && <span className="text-2xs text-indigo-700">⏳ محاسبه رتبه…</span>}
                    {cohortError && !cohortLoading && <span className="text-2xs text-red-700 font-bold">⚠ رتبه محاسبه نشد — تیک را بردارید و دوباره بزنید</span>}
                  </div>
                )}
              </div>
              {transcriptLoading ? (
                <p className="text-center text-slate-500 py-6">در حال بارگذاری کارنامه…</p>
              ) : !transcript || transcript.length === 0 ? (
                <p className="text-center text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">کارنامه‌ای برای این دانشجو یافت نشد (ممکن است نمرات در مرحلهٔ انتقال باشد).</p>
              ) : transcriptView === 'simple' ? (
                <div className="overflow-x-auto border border-slate-300 rounded">
                  <table className="w-full text-right text-2xs">
                    <thead className="bg-slate-100 border-b border-slate-300 font-bold">
                      <tr>
                        <th className="p-1.5">ترم</th>
                        <th className="p-1.5">کد درس</th>
                        <th className="p-1.5">عنوان درس</th>
                        <th className="p-1.5 text-center">واحد</th>
                        <th className="p-1.5 text-center">نمره</th>
                        <th className="p-1.5 text-center">وضعیت</th>
                        {canEditGrades && <th className="p-1.5 text-center">عملیات</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {transcript.map((r, i) => (
                        <tr key={i} className="border-b border-slate-200 hover:bg-slate-50">
                          <td className="p-1.5 font-mono" dir="ltr">{r.termCode}</td>
                          <td className="p-1.5 font-mono" dir="ltr">{r.courseCode}</td>
                          <td className="p-1.5">{r.courseTitle}</td>
                          <td className="p-1.5 text-center font-mono">{r.units ?? '—'}</td>
                          <td className="p-1.5 text-center font-mono font-bold">{r.gradeValue ?? '—'}</td>
                          <td className="p-1.5 text-center">
                            {r.gradeStatusTitle && <span className="ml-1 font-bold">{r.gradeStatusTitle}</span>}
                            <span className={`px-2 py-0.5 rounded-full text-3xs font-bold ${gradeStatusChip(r.gradeStatus)}`}>
                              {gradeStatusFa(r.gradeStatus)}
                            </span>
                          </td>
                          {canEditGrades && (
                            <td className="p-1.5 text-center">
                              <button
                                onClick={() => openEditGrade(r)}
                                className="px-2 py-0.5 rounded text-3xs font-bold bg-amber-100 text-amber-900 hover:bg-amber-200 border border-amber-300 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
                                title="ویرایش یا اصلاح نمره"
                              >
                                ✏️ ویرایش
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <OfficialTranscriptView
                  student={currentStudent}
                  summary={groupTranscript(transcript, regConfig)}
                  logoUrl={meta.logoUrl}
                  codeLabels={meta.codeLabels}
                  canEditGrades={canEditGrades}
                  onEditGrade={openEditGrade}
                  printOptions={printOptions}
                  originUniversity={originUniversity}
                  universityCode={uniCodeOf(currentStudent.universityId)}
                  cohortStats={printOptions.showRank ? cohortStats : null}
                  cohortLoading={cohortLoading && printOptions.showRank}
                />
              )}
            </div>
          )}

          {/* ── list tab (server search/pagination) ── */}
          {stuTab === 'list' && (
            <div className="bg-white p-4 border border-slate-400 rounded-b-md space-y-3">
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => { e.preventDefault(); setSelectedStuIdx(0); nav({ q: searchQuery, page: '1' }); }}
              >
                <input
                  type="text"
                  placeholder="🔍 جستجو: شماره دانشجویی، کد ملی یا نام..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full max-w-md bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-xs"
                />
                <button type="submit" className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold rounded">جستجو</button>
                {(urlQ || urlStatus !== 'ALL' || urlDegree > 0 || urlSort || fCode || fName || fNC || fMajor || fYear) && (
                  <button type="button" onClick={clearStuFilters} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs rounded">✖ پاک‌سازی فیلتر</button>
                )}
                <span className="text-xs text-slate-500 mr-auto">{faNumber(pg?.total ?? students.length)} پرونده</span>
              </form>

              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200">
                <button
                  onClick={() => { setBulk((s) => ({ ...s, open: true, scope: 'student', pass: '' })); }}
                  className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold"
                  title="تعیین یک رمز واحد برای همهٔ دانشجویان/اساتید فعال وب (فقط مدیر سیستم)"
                >
                  🔑 بازنشانی گروهی رمز
                </button>
                <span className="text-3xs text-slate-500">در اولین ورود، اجباری به تغییر رمز — به‌همراه ساخت خودکار نقش‌های جاافتاده</span>
              </div>

              {/* status chips */}
              <div className="flex flex-wrap items-center gap-1.5 text-2xs">
                <button onClick={() => nav({ status: 'ALL', page: '1' })} className={`px-2.5 py-1 rounded-full border font-bold ${urlStatus === 'ALL' ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 border-slate-300 hover:bg-slate-100'}`}>
                  همه ({faNumber((meta.statusCounts ?? []).reduce((a, c) => a + c.n, 0))})
                </button>
                {(meta.statusCounts ?? []).map((c) => (
                  <button key={c.status} onClick={() => nav({ status: c.status, page: '1' })} title={c.status}
                    className={`px-2.5 py-1 rounded-full border font-bold ${urlStatus === c.status ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 border-slate-300 hover:bg-slate-100'}`}>
                    {studentStatusFa(c.status)} <span className="opacity-70">({faNumber(c.n)})</span>
                  </button>
                ))}
                <select
                  value={urlDegree || 0}
                  onChange={(e) => nav({ degree: e.target.value, page: '1' })}
                  className="mr-auto bg-slate-50 border border-slate-300 rounded px-2 py-1 text-2xs"
                >
                  <option value={0}>همه مقاطع</option>
                  {(meta.degrees ?? []).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              </div>

              <div className="overflow-x-auto border border-slate-300 rounded hidden md:block">
                <table className="w-full min-w-[860px] table-fixed text-right text-xs">
                  <colgroup>
                    <col style={{ width: 150 }} />
                    <col style={{ width: 140 }} />
                    <col />
                    <col style={{ width: 120 }} />
                    <col />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 120 }} />
                  </colgroup>
                  <thead className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold">
                    <tr>
                      <th className="p-2 text-right whitespace-nowrap">عملیات</th>
                      <DossierTh label="شماره دانشجویی" sortKey="studentCode" activeKey={stuSortKey} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('studentCode')} filter={stuFilters.f_code} onFilter={(v) => setStuFilters((f) => ({ ...f, f_code: v }))} onApply={applyStuFilters} />
                      <DossierTh label="نام و نام خانوادگی" sortKey="name" activeKey={stuSortKey} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('name')} filter={stuFilters.f_name} onFilter={(v) => setStuFilters((f) => ({ ...f, f_name: v }))} onApply={applyStuFilters} />
                      <DossierTh label="کد ملی" sortKey="nc" activeKey={stuSortKey} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('nc')} filter={stuFilters.f_nc} onFilter={(v) => setStuFilters((f) => ({ ...f, f_nc: v }))} onApply={applyStuFilters} />
                      <DossierTh label="رشته" sortKey="major" activeKey={stuSortKey} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('major')} filter={stuFilters.f_major} onFilter={(v) => setStuFilters((f) => ({ ...f, f_major: v }))} onApply={applyStuFilters} />
                      <DossierTh label="مقطع" sortKey="degree" activeKey={stuSortKey} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('degree')} />
                      <DossierTh label="سال ورود" sortKey="year" activeKey={stuSortKey} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('year')} filter={stuFilters.f_year} onFilter={(v) => setStuFilters((f) => ({ ...f, f_year: v }))} onApply={applyStuFilters} />
                      <DossierTh label="وضعیت" sortKey="status" activeKey={stuSortKey} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('status')} />
                    </tr>
                    <tr>
                      <td colSpan={8} className="p-1.5 bg-slate-50">
                        <button
                          onClick={applyStuFilters}
                          className="px-3 py-1 bg-indigo-700 hover:bg-indigo-800 text-white text-2xs font-bold rounded"
                        >
                          اعمال فیلتر ستون‌ها (Enter)
                        </button>
                        <span className="mr-2 text-3xs text-slate-400">فیلتر هر ستون را بنویسید و Enter بزنید</span>
                      </td>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.id} className="border-b border-slate-200 hover:bg-slate-50">
                        <td className="p-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => {
                              const realIdx = students.findIndex((x) => x.id === s.id);
                              setSelectedStuIdx(realIdx >= 0 ? realIdx : 0);
                              setStuTab('info_combined');
                            }}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-2xs px-2.5 py-1 rounded font-bold whitespace-nowrap"
                          >
                            مشاهده پرونده 🔍
                          </button>
                        </td>
                        <td className="p-2 font-mono font-bold text-indigo-950 whitespace-nowrap" dir="ltr">{s.studentCode}</td>
                        <td className="p-2 font-bold break-words">{s.firstName} {s.lastName}</td>
                        <td className="p-2 font-mono whitespace-nowrap" dir="ltr">{s.nationalCode}</td>
                        <td className="p-2">{s.majorName}</td>
                        <td className="p-2 whitespace-nowrap">{s.degreeLevel}</td>
                        <td className="p-2 font-mono whitespace-nowrap">{s.entryYear}</td>
                        <td className="p-2 whitespace-nowrap">
                          <span title={s.samaStatusCode ? `کد سما: ${s.samaStatusCode}` : s.status} className={`${studentStatusChip(s.status)} text-3xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap`}>
                            {studentStatusFa(s.status, s.samaStatusCode, uniCodeOf(s.universityId))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* mobile cards */}
              <div className="md:hidden space-y-2">
                {students.length === 0 && <div className="p-6 text-center text-xs text-slate-400">موردی یافت نشد.</div>}
                {students.map((s) => (
                  <div key={s.id} className="rounded-lg border border-slate-300 bg-slate-50 p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-sm text-slate-900">{`${s.firstName} ${s.lastName}`.trim() || '—'}</p>
                      <span className={`text-3xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${studentStatusChip(s.status)}`}>
                        {studentStatusFa(s.status, s.samaStatusCode, uniCodeOf(s.universityId))}
                      </span>
                    </div>
                    <p className="text-2xs font-mono text-slate-600" dir="ltr">{s.studentCode}</p>
                    <div className="grid grid-cols-2 gap-1 text-2xs text-slate-600">
                      <span>کد ملی: <span className="font-mono" dir="ltr">{s.nationalCode}</span></span>
                      <span>رشته: {s.majorName}</span>
                      <span>مقطع: {s.degreeLevel}</span>
                      <span>سال ورود: {s.entryYear}</span>
                    </div>
                    <button
                      onClick={() => {
                        const realIdx = students.findIndex((x) => x.id === s.id);
                        setSelectedStuIdx(realIdx >= 0 ? realIdx : 0);
                        setStuTab('info_combined');
                      }}
                      className="bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-2xs px-2.5 py-1 rounded font-bold"
                    >
                      مشاهده پرونده 🔍
                    </button>
                  </div>
                ))}
              </div>

              {/* pagination */}
              {pg && pg.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 text-xs">
                  <button disabled={pg.page <= 1} onClick={() => nav({ page: String(pg.page - 1) })} className="px-3 py-1.5 bg-white border border-slate-300 rounded font-bold disabled:opacity-40 hover:bg-slate-50">قبلی ▶</button>
                  <span className="font-bold text-slate-700">صفحه {faNumber(pg.page)} از {faNumber(pg.totalPages)}</span>
                  <button disabled={pg.page >= pg.totalPages} onClick={() => nav({ page: String(pg.page + 1) })} className="px-3 py-1.5 bg-white border border-slate-300 rounded font-bold disabled:opacity-40 hover:bg-slate-50">◀ بعدی</button>
                </div>
              )}
              <p className="text-3xs text-slate-400 text-center">ناوبری پرونده (قبلی/بعدی) در محدوده همین صفحه (۵۰ رکورد) است — برای پرونده خاص، جست‌وجو کنید.</p>
            </div>
          )}

          {/* standard bottom action buttons of the student form */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-300">
            <div className="flex items-center gap-2">
              <button onClick={() => showToast('✅ اطلاعات پرونده دانشجو با موفقیت ذخیره شد (F2)')} className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded shadow flex items-center gap-1">
                <span>✔️</span> <span>F2 ذخیره</span>
              </button>
              <button onClick={() => showToast('حالت ویرایش فعال گردید (F4)')} className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-400 font-bold rounded flex items-center gap-1">
                <span>✏️</span> <span>F4 ویرایش</span>
              </button>
              <button onClick={() => setToastMsg('')} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-400 rounded flex items-center gap-1 text-slate-700">
                <span>❌</span> <span>انصراف (Ctrl+Z)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ ۲. professors form ═══════════════ */}
      {mainView === 'professors' && (
        <div className="bg-slate-200 p-2 sm:p-4 rounded-xl border border-slate-400 shadow-xl space-y-2">

          <div className="flex flex-wrap items-center gap-1 border-b border-slate-400 pb-1 text-slate-800">
            <button
              onClick={() => setProfTab('list')}
              className={`px-3 py-1.5 font-bold rounded-t-md border-t border-x transition-colors ${
                profTab === 'list' ? 'bg-white border-slate-400 text-indigo-950 shadow-sm' : 'bg-slate-300 border-transparent hover:bg-slate-100'
              }`}
            >
              📋 لیست اطلاعات اساتید
            </button>
            <button
              onClick={() => setProfTab('info_combined')}
              className={`px-3 py-1.5 font-bold rounded-t-md border-t border-x transition-colors ${
                profTab === 'info_combined' ? 'bg-white border-slate-400 text-indigo-950 shadow-sm' : 'bg-slate-300 border-transparent hover:bg-slate-100'
              }`}
            >
              📄 اطلاعات استاد (آموزشی + استخدامی + فردی)
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-100 p-2 border border-slate-300 rounded">
            <div className="flex items-center gap-2">
              <span className="font-bold text-red-700">* کد استاد:</span>
              <input
                type="text"
                value={currentStaff?.staffCode || ''}
                readOnly
                className="bg-yellow-300 text-slate-950 font-mono font-bold text-sm px-3 py-1 border border-slate-500 rounded text-center w-28 shadow-inner"
              />
              <span className="text-2xs text-slate-500 mr-2">(برای جستجو کد استاد را وارد کنید)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xs text-slate-600">نام و نام خانوادگی استاد:</span>
              <b className="text-slate-900 bg-white px-3 py-1 border border-slate-300 rounded font-bold">
                {currentStaff ? `${currentStaff.firstName} ${currentStaff.lastName}` : '—'}
              </b>
              {currentStaff && currentStaff.userId ? (
                <button
                  onClick={() => openRoleModalFor(currentStaff)}
                  className="px-3 py-1.5 rounded bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold whitespace-nowrap"
                  title={`نقش‌های «${currentStaff.firstName} ${currentStaff.lastName}»: ${((staffRoleIds?.[currentStaff.userId ?? 0] ?? []).map((id) => roleTitle(meta.rolesAll?.find((r) => r.id === id) ?? { id, code: '؟', title: '' }))).join('، ') || 'هیچ'}`}
                >
                  {((staffRoleIds?.[currentStaff.userId ?? 0] ?? []).length > 0)
                    ? `⚙ ${faNumber((staffRoleIds?.[currentStaff.userId ?? 0] ?? []).length)} نقش`
                    : '⚙ نقش‌ها'}
                </button>
              ) : null}
              <button
                onClick={openCreateStaff}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold"
                title="ثبت حساب کاربری استاد یا کارکن جدید (کارشناس/همکار اداری) — فقط مدیر سیستم"
              >
                ＋ استاد / کارمند جدید
              </button>
            </div>
          </div>

          {/* ── staff section 1: educational info ── */}
          {profTab === 'info_combined' && !currentStaff && (
            <div className="rounded-b-md border border-slate-400 bg-white p-6 text-center text-xs font-bold text-slate-600">
              {staffLoading ? 'در حال بارگذاری دوسیهٔ استاد…' : 'استادی برای نمایش انتخاب نشده است.'}
            </div>
          )}
          {profTab === 'info_combined' && currentStaff && (
            <div ref={staffFormRef}>
              <div key={`prof-a-${currentStaff.id}`} className="bg-white p-3 sm:p-5 border border-slate-400 rounded-b-md space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* photo + e-signature boxes */}
                  <div className="space-y-3">
                    <div className="border border-slate-300 p-2.5 rounded bg-slate-50 flex flex-col items-center space-y-1.5">
                      <PersonPhoto userId={currentStaff.userId} hasPhoto={!!currentStaff.photoKey} className="w-24 h-28" icon="👨‍🏫" label="تصویر پرسنلی" />
                      <div className="flex gap-1">
                        <button onClick={() => showToast('فایل تصویر پرسنلی استاد انتخاب شد')} className="px-2 py-0.5 bg-white border border-slate-300 rounded text-3xs">فایل تصویر</button>
                        <button onClick={() => showToast('تصویر حذف شد')} className="px-2 py-0.5 bg-white border border-slate-300 rounded text-red-700 text-3xs">حذف</button>
                      </div>
                    </div>
                    <div className="border border-slate-300 p-2.5 rounded bg-slate-50 flex flex-col items-center space-y-1.5">
                      <span className="font-bold text-red-700 text-2xs">تصویر امضای الکترونیک استاد:</span>
                      <div className="w-full h-16 bg-white border border-dashed border-slate-400 rounded flex items-center justify-center font-mono text-slate-400 text-3xs">
                        [نمونه امضای دیجیتال]
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => showToast('فایل امضای الکترونیک بارگذاری شد')} className="px-2 py-0.5 bg-white border border-slate-300 rounded text-3xs">بارگذاری امضا</button>
                        <button onClick={() => showToast('امضا حذف شد')} className="px-2 py-0.5 bg-white border border-slate-300 rounded text-red-700 text-3xs">حذف</button>
                      </div>
                    </div>
                  </div>

                  {/* educational matrix */}
                  <div className="md:col-span-2 space-y-2 border border-slate-300 p-3 rounded bg-slate-50">
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span className="text-red-700 font-bold">* نام خانوادگی و نام:</span>
                      <input type="text" data-f="fullname" defaultValue={`${currentStaff.lastName} - ${currentStaff.firstName}`} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-bold" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span className="text-slate-600">Full Name:</span>
                      <input type="text" defaultValue={`${currentStaff.firstName} ${currentStaff.lastName}`} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono text-left" dir="ltr" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span className="text-red-700 font-bold">* دانشکده:</span>
                      <input type="text" defaultValue={currentStaff.facultyName && currentStaff.facultyName !== '—' ? `${currentStaff.facultyName}${currentStaff.facultyCode ? ` (کد ${currentStaff.facultyCode})` : ''}` : '—'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-semibold" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span className="text-red-700 font-bold">* گروه آموزشی:</span>
                      <input type="text" defaultValue={currentStaff.departmentName && currentStaff.departmentName !== '—' ? `${currentStaff.departmentName}${currentStaff.departmentCode ? ` (کد ${currentStaff.departmentCode})` : ''}` : '—'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span className="text-red-700 font-bold">* وضعیت کلی:</span>
                      <select data-f="status" defaultValue={currentStaff.isActive === 0 ? 'غیرفعال' : 'فعال'} className="col-span-2 bg-emerald-50 text-emerald-900 border border-emerald-300 px-2 py-1 rounded font-bold">
                        <option value="فعال">{staffEngageLabel(currentStaff)}</option>
                        <option value="غیرفعال">غیرفعال</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span>رشته و گرایش تخصصی:</span>
                      <input type="text" data-f="fieldOfStudy" defaultValue={currentStaff.fieldOfStudy || currentStaff.fieldMain || '—'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span>آخرین دانشگاه دانش‌آموختگی:</span>
                      <input type="text" data-f="lastDegreeUniversity" defaultValue={currentStaff.lastDegreeUniversity || '—'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span>کشور اخذ آخرین مدرک:</span>
                      <input type="text" data-f="lastDegreeCountryCode" defaultValue={currentStaff.lastDegreeCountryCode || '—'} className="bg-white border border-slate-300 px-2 py-1 rounded" />
                      <span>رشته: <b>{currentStaff.fieldMain || '—'}</b></span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── staff section 2: employment ── */}
              <div key={`prof-b-${currentStaff.id}`} className="bg-white p-3 sm:p-5 border border-slate-400 rounded-b-md space-y-3">
                <div className="space-y-2 border border-slate-300 p-3 rounded bg-slate-50 max-w-2xl mx-auto">
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="font-bold">مدرک تحصیلی:</span>
                    <input type="text" data-f="degree" defaultValue={currentStaff.degree || 'دکتری تخصصی (Ph.D)'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-bold" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="font-bold">نوع همکاری:</span>
                    <input type="text" data-f="cooperationType" defaultValue={currentStaff.cooperationType || currentStaff.staffType || '—'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-semibold" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="font-bold">مرتبه علمی:</span>
                    <input type="text" data-f="academicRank" defaultValue={currentStaff.academicRank || 'استادیار'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-bold text-indigo-950" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>شماره مستخدم:</span>
                    <input type="text" data-f="personnelNo" defaultValue={currentStaff.personnelNo || '—'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>تاریخ استخدام:</span>
                    <input type="text" data-f="hireDate" defaultValue={currentStaff.hireDate || '—'} className="bg-white border border-slate-300 px-2 py-1 rounded font-mono" />
                    <span>پایه: <b className="font-mono">{currentStaff.academicBase || '—'}</b></span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>سمت اجرایی:</span>
                    <input type="text" data-f="staffType" defaultValue={currentStaff.staffType && currentStaff.staffType !== '—' ? currentStaff.staffType : '—'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>شماره حساب بانکی:</span>
                    <input type="text" data-f="bankAccountNo" defaultValue={currentStaff.bankAccountNo || '—'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono text-left" dir="ltr" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>پایه استادی:</span>
                    <input type="text" data-f="academicBase" defaultValue={currentStaff.academicBase || '—'} className="w-24 bg-white border border-slate-300 px-2 py-1 rounded font-mono font-bold text-center" />
                    <span>وضعیت: <b>{currentStaff.isActive === 0 ? 'غیرفعال' : 'فعال'}</b></span>
                  </div>
                </div>
              </div>

              {/* ── staff section 3: personal info ── */}
              <div key={`prof-c-${currentStaff.id}`} className="bg-white p-3 sm:p-5 border border-slate-400 rounded-b-md space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 border border-slate-300 p-2.5 rounded bg-slate-50">
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span>کد ملی:</span>
                      <input type="text" data-f="nationalCode" defaultValue={currentStaff.nationalCode} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono font-bold" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span>تاریخ تولد:</span>
                      <input type="text" data-f="birthDate" defaultValue={dateToJalali(currentStaff.birthDate)} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span>تلفن همراه:</span>
                      <input type="text" data-f="mobile" defaultValue={currentStaff.mobile && currentStaff.mobile !== '—' ? currentStaff.mobile : '—'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span>تلفن دفتر / ثابت:</span>
                      <input type="text" data-f="phone" defaultValue={currentStaff.phone || '—'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono" />
                    </div>
                  </div>

                  <div className="space-y-1.5 border border-slate-300 p-2.5 rounded bg-slate-50">
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span>پست الکترونیکی:</span>
                      <input type="email" data-f="email" defaultValue={currentStaff.email || '—'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono text-left" dir="ltr" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span>وضعیت تأهل:</span>
                      <div className="col-span-2 flex items-center gap-4">
                        <label className="flex items-center gap-1 cursor-pointer"><input type="radio" name="prof_married" defaultChecked={currentStaff.maritalStatus !== 'مجرد'} /> متأهل</label>
                        <label className="flex items-center gap-1 cursor-pointer"><input type="radio" name="prof_married" defaultChecked={currentStaff.maritalStatus === 'مجرد'} /> مجرد</label>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <span>آدرس محل سکونت:</span>
                      <input type="text" data-f="address" defaultValue={currentStaff.address || '—'} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded" />
                    </div>
                    {/* ── staff web account ── */}
                    <div className="grid grid-cols-3 gap-2 items-center border-t border-slate-200 pt-2 mt-1">
                      <span className="font-bold">🔐 حساب وب:</span>
                      <span className={`text-2xs font-bold px-2 py-0.5 rounded-full text-center ${(currentStaff.userIsActive ?? 1) === 0 ? 'bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'}`}>
                        {(currentStaff.userIsActive ?? 1) === 0 ? '⛔ غیرفعال' : '✅ فعال'}
                      </span>
                      <div className="flex gap-1.5 justify-end">
                        <button
                          onClick={() => handleToggleActive(currentStaff.userId, (currentStaff.userIsActive ?? 1) === 0, `${currentStaff.firstName} ${currentStaff.lastName}`)}
                          className="px-2 py-1 rounded text-2xs font-bold bg-white border border-slate-300 hover:bg-slate-100"
                          title="فعال/غیرفعال‌سازی کامل حساب (ورود، کارتابل، برنامه‌ریزی، نشست‌ها، OTPها) — فقط مدیر سیستم"
                        >
                          {(currentStaff.userIsActive ?? 1) === 0 ? 'فعال‌سازی کامل' : 'غیرفعال‌سازی کامل'}
                        </button>
                        <button
                          onClick={() => { setPwModalFor({ userId: currentStaff.userId ?? 0, name: `${currentStaff.firstName} ${currentStaff.lastName}` }); setPwInput(''); }}
                          className="px-2 py-1 rounded text-2xs font-bold bg-slate-700 text-white hover:bg-slate-800"
                          title="تغییر رمز عبور استاد (فقط مدیر سیستم)"
                        >
                          🔑 تغییر رمز
                        </button>
                        {currentStaff.userId ? (
                          <button
                            onClick={() => {
                              const uid = currentStaff.userId;
                              if (!uid) { showToast('شناسه کاربری یافت نشد.'); return; }
                              setRoleMsg('');
                              setRoleSel(new Set(staffRoleIds?.[uid] ?? []));
                              setRoleModalFor({ userId: uid, name: `${currentStaff.firstName} ${currentStaff.lastName}` });
                            }}
                            className="px-2 py-1 rounded text-2xs font-bold bg-indigo-700 text-white hover:bg-indigo-800"
                            title={`نقش‌های فعلی: ${((staffRoleIds?.[currentStaff.userId] ?? []).map((id) => roleTitle(meta.rolesAll?.find((r) => r.id === id) ?? { id, code: '؟', title: '' }))).join('، ') || 'هیچ'}`}
                          >
                            {(staffRoleIds?.[currentStaff.userId] ?? []).length > 0 ? `⚙ ${faNumber((staffRoleIds?.[currentStaff.userId] ?? []).length)} نقش` : '⚙ نقش‌ها'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── staff list tab ── */}
          {profTab === 'list' && (
            <div className="bg-white p-4 border border-slate-400 rounded-b-md space-y-3">
              {staffLoading && (
                <div className="flex items-center gap-2 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-900">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                  در حال بارگذاری فهرست استادان و کارکنان…
                </div>
              )}
              {staffLoadError && !staffLoading && (
                <div className="flex items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950">
                  <span>⚠ {staffLoadError}</span>
                  <button
                    onClick={staffLoadRetry}
                    className="shrink-0 rounded border border-amber-700 bg-white px-2 py-0.5 font-bold"
                  >
                    تلاش دوباره
                  </button>
                </div>
              )}
              {!staffLoading && !staffLoadError && staffTotal != null && staffList.length < staffTotal && (
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
                  نمایش {faNumber(staffList.length)} نفر از {faNumber(staffTotal)} نتیجه — برای رسیدن به فرد موردنظر در کادر جست‌وجو تایپ کنید (کد پرسنلی، کد ملی یا نام).
                </div>
              )}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <input
                  type="text"
                  placeholder="🔍 جستجو بر اساس کد پرسنلی، کد ملی یا نام استاد..."
                  value={staffQuery}
                  onChange={(e) => { setStaffQuery(e.target.value); setStaffVisible(100); }}
                  className="w-full max-w-md bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-xs"
                />
                <div className="flex items-center gap-2">
                  <select value={staffTypeFilter} onChange={(e) => { setStaffTypeFilter(e.target.value); setStaffVisible(100); }} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs">
                    <option value="ALL">همهٔ سمت‌ها</option>
                    <option value="EDU">استاد / هیئت علمی</option>
                    <option value="ADMIN">کارشناس / اداری</option>
                    <option value="OTHER">سایر سمت‌ها</option>
                  </select>
                  <button
                    onClick={openCreateStaff}
                    className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold whitespace-nowrap"
                  >
                    ＋ استاد / کارمند جدید
                  </button>
                  <span className="text-xs text-slate-500">{faNumber(filteredStaff.length)} استاد و کارکن</span>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-300 rounded">
                <table className="w-full min-w-[900px] table-fixed text-right text-xs">
                  <colgroup>
                    <col style={{ width: 150 }} />
                    <col style={{ width: 90 }} />
                    <col />
                    <col style={{ width: 120 }} />
                    <col />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 110 }} />
                  </colgroup>
                  <thead className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold">
                    <tr>
                      <th className="p-2 text-right whitespace-nowrap">عملیات</th>
                      {STAFF_COLS.map((c) => (
                        <StaffTh
                          key={c.key}
                          label={c.label}
                          sortDir={staffSort?.key === c.key ? staffSort.dir : null}
                          onSort={() => setStaffSort((s) => (s?.key === c.key ? (s.dir === 'asc' ? { key: c.key, dir: 'desc' } : null) : { key: c.key, dir: 'asc' }))}
                          filter={staffColFilters[c.key] ?? ''}
                          onFilter={(v) => { setStaffColFilters((f) => ({ ...f, [c.key]: v })); setStaffVisible(100); }}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStaff.slice(0, staffVisible).map((st) => (
                      <tr key={st.id} className="border-b border-slate-200 hover:bg-slate-50">
                        <td className="p-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => {
                              const realIdx = staffList.findIndex((x) => x.id === st.id);
                              setSelectedProfIdx(realIdx >= 0 ? realIdx : 0);
                              setProfTab('info_combined');
                            }}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-2xs px-2.5 py-1 rounded font-bold whitespace-nowrap"
                          >
                            مشاهده پرونده 🔍
                          </button>
                        </td>
                        <td className="p-2 font-mono font-bold text-slate-900 whitespace-nowrap" dir="ltr">{st.staffCode}</td>
                        <td className="p-2 font-bold break-words">{st.firstName} {st.lastName}</td>
                        <td className="p-2 font-mono whitespace-nowrap" dir="ltr">{st.nationalCode}</td>
                        <td className="p-2">{st.departmentName && st.departmentName !== '—' ? st.departmentName : '—'}</td>
                        <td className="p-2 font-semibold text-indigo-950 whitespace-nowrap">{st.academicRank}</td>
                        <td className="p-2 whitespace-nowrap">{st.degree}</td>
                        <td className="p-2 whitespace-nowrap">{st.staffType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredStaff.length > staffVisible && (
                <div className="text-center">
                  <button onClick={() => setStaffVisible((v) => v + 200)} className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded text-xs font-bold">
                    نمایش {faNumber(Math.min(200, filteredStaff.length - staffVisible))} نفر بعدی ({faNumber(filteredStaff.length - staffVisible)} باقی‌مانده)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* standard bottom action buttons of the staff form */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-300">
            <div className="flex items-center gap-2">
              <button onClick={openCreateStaff} className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white font-bold rounded shadow flex items-center gap-1">
                <span>➕</span> <span>اضافه (Ins)</span>
              </button>
              <button onClick={handleSaveStaff} disabled={staffSaving} className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-bold rounded shadow flex items-center gap-1">
                <span>✔️</span> <span>{staffSaving ? 'در حال ذخیره…' : 'F2 ذخیره'}</span>
              </button>
              <button onClick={() => showToast('حالت ویرایش فعال شد (F4)')} className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-400 font-bold rounded flex items-center gap-1">
                <span>✏️</span> <span>F4 ویرایش</span>
              </button>
              <button onClick={() => showToast('حذف رکورد انجام شد')} className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-300 rounded flex items-center gap-1 dark:border-red-800 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900">
                <span>🗑️</span> <span>حذف</span>
              </button>
            </div>
            <button onClick={() => setProfTab('list')} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-400 rounded">
              <span>📋 لیست اساتید</span>
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ ۳. quick tiles ═══════════════ */}
      {mainView === 'quick_menu' && (
        <div className="bg-slate-200 p-5 sm:p-8 rounded-xl border border-slate-400 shadow-xl space-y-4">
          <div className="bg-white p-3 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm">
            ⚡ کاشی‌ها و منوی میانبرهای امور اساتید و آموزش
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            <button
              onClick={() => {
                setMainView('professors');
                setProfTab('info_combined');
                openCreateStaff();
              }}
              className="p-4 bg-gradient-to-b from-white to-slate-100 border-2 border-dashed border-indigo-400 hover:border-indigo-600 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-3 text-right group"
            >
              <div className="w-12 h-12 rounded-lg bg-indigo-100 text-indigo-800 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                👥
              </div>
              <div>
                <p className="font-extrabold text-sm text-indigo-950">معرفی استاد جدید</p>
                <p className="text-2xs text-slate-500 mt-0.5">ثبت مشخصات، استخدام و امضای الکترونیک</p>
              </div>
            </button>

            <button
              onClick={() => showToast('پنجره تغییر کلمه عبور جاری باز شد')}
              className="p-4 bg-gradient-to-b from-white to-slate-100 border-2 border-slate-300 hover:border-slate-500 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-3 text-right group"
            >
              <div className="w-12 h-12 rounded-lg bg-yellow-100 text-yellow-800 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                🔑
              </div>
              <div>
                <p className="font-extrabold text-sm text-slate-900">تغییر کلمه عبور جاری</p>
                <p className="text-2xs text-slate-500 mt-0.5">تغییر رمز ورود و تنظیمات امنیتی</p>
              </div>
            </button>

            <button
              onClick={() => showToast('فرآیند تخصیص استاد راهنمای جمعی دانشجویان فعال گردید')}
              className="p-4 bg-gradient-to-b from-white to-slate-100 border-2 border-slate-300 hover:border-slate-500 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-3 text-right group"
            >
              <div className="w-12 h-12 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                👨‍💼
              </div>
              <div>
                <p className="font-extrabold text-sm text-slate-900">تخصیص استاد راهنمای جمعی</p>
                <p className="text-2xs text-slate-500 mt-0.5">انتساب گروهی دانشجویان به اساتید راهنما</p>
              </div>
            </button>

            <button
              onClick={() => showToast('سامانه ارسال پیامک گروهی به کلاس آماده است')}
              className="p-4 bg-gradient-to-b from-white to-slate-100 border-2 border-slate-300 hover:border-slate-500 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-3 text-right group"
            >
              <div className="w-12 h-12 rounded-lg bg-sky-100 text-sky-800 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                📱
              </div>
              <div>
                <p className="font-extrabold text-sm text-slate-900">ارسال پیامک به دانشجویان کلاس</p>
                <p className="text-2xs text-slate-500 mt-0.5">ارسال اطلاعیه، لغو یا تغییر زمان جلسه</p>
              </div>
            </button>

            <Link
              to="/admin/class-sessions"
              className="p-4 bg-gradient-to-b from-white to-slate-100 border-2 border-slate-300 hover:border-slate-500 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-3 text-right group"
            >
              <div className="w-12 h-12 rounded-lg bg-purple-100 text-purple-800 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                🎓
              </div>
              <div>
                <p className="font-extrabold text-sm text-slate-900">مدیریت جلسات درس (حضور و غیاب و جبرانی)</p>
                <p className="text-2xs text-slate-500 mt-0.5">جدول جلسات درس با پرچم‌های تعطیل/فوق‌برنامه/فعال، ممیزی زمانی و لیست دانشجویان</p>
              </div>
            </Link>

            <Link
              to="/admin/curriculum"
              className="p-4 bg-gradient-to-b from-white to-slate-100 border-2 border-indigo-300 hover:border-indigo-500 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-3 text-right group"
            >
              <div className="w-12 h-12 rounded-lg bg-indigo-100 text-indigo-800 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                📚
              </div>
              <div>
                <p className="font-extrabold text-sm text-indigo-950">کاتالوگ و سرفصل رشته‌ها</p>
                <p className="text-2xs text-slate-500 mt-0.5">مدیریت چارت، انتقال کاتالوگ و سقف واحدها</p>
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* ── grade edit modal ── */}
      <GradeEditModal
        st={gradeEdit}
        onClose={() => patchGradeEdit({ open: false })}
        onField={patchGradeEdit}
        onSubmit={handleSaveGrade}
        onStepUpConfirm={() => void handleStepUpConfirm()}
      />

      {/* ── audit log modal ── */}
      <AuditLogModal
        open={auditOpen}
        student={currentStudent ?? null}
        logs={auditLogs}
        loading={auditLogsLoading}
        onClose={() => setAuditOpen(false)}
      />

      {/* ── bulk reset modal ── */}
      <BulkResetModal st={bulk} onClose={() => patchBulk({ open: false })} onField={patchBulk} onSubmit={handleBulkReset} />

      {/* ── roles modal ── */}
      <RolesModal
        target={roleModalFor}
        rolesAll={meta.rolesAll ?? []}
        selected={roleSel}
        saving={roleSaving}
        msg={roleMsg}
        onClose={() => setRoleModalFor(null)}
        onToggle={(id, checked) => {
          const next = new Set(roleSel);
          if (checked) next.add(id); else next.delete(id);
          setRoleSel(next);
        }}
        onSubmit={handleSaveRoles}
      />

      {/* ── create staff modal ── */}
      <CreateStaffModal
        open={createStaffOpen}
        fields={csf}
        busy={createStaffBusy}
        msg={createStaffMsg}
        onClose={() => setCreateStaffOpen(false)}
        onField={(patch) => setCsf((f) => ({ ...f, ...patch }))}
        onSubmit={handleCreateStaff}
      />

      {/* ── password modal ── */}
      <PasswordModal
        target={pwModalFor}
        input={pwInput}
        saving={pwSaving}
        onClose={() => setPwModalFor(null)}
        onInput={setPwInput}
        onSubmit={handleResetPassword}
      />
    </div>
  );
}

// ── server-backed table header: sort + column filter (ServerTh port) ──
function DossierTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  filter,
  onFilter,
  onApply,
}: {
  label: string;
  sortKey: string;
  activeKey: string | null;
  dir?: 'asc' | 'desc';
  onSort: () => void;
  filter?: string;
  onFilter?: (v: string) => void;
  onApply?: () => void;
}) {
  const active = activeKey === sortKey;
  return (
    <th className="p-1 align-top">
      <button
        onClick={onSort}
        className={`w-full text-right px-1.5 py-1 rounded font-bold whitespace-nowrap ${active ? 'bg-indigo-100 text-indigo-900' : 'hover:bg-slate-200/60'}`}
        title="سورت ستونی"
      >
        {label}
        {active ? <span className="mr-1">{dir === 'desc' ? '▼' : '▲'}</span> : <span className="mr-1 text-slate-400">↕</span>}
      </button>
      {onFilter && (
        <input
          value={filter ?? ''}
          onChange={(e) => onFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && onApply) onApply(); }}
          placeholder="فیلتر…"
          className="mt-1 w-full bg-white border border-slate-300 rounded px-1.5 py-0.5 text-3xs font-normal"
        />
      )}
    </th>
  );
}

// ── client-side staff table header: sort + column filter ──
function StaffTh({
  label,
  sortDir,
  onSort,
  filter,
  onFilter,
}: {
  label: string;
  sortDir: 'asc' | 'desc' | null;
  onSort: () => void;
  filter: string;
  onFilter: (v: string) => void;
}) {
  return (
    <th className="p-1 align-top">
      <button
        onClick={onSort}
        className={`w-full text-right px-1.5 py-1 rounded font-bold whitespace-nowrap ${sortDir ? 'bg-indigo-100 text-indigo-900' : 'hover:bg-slate-200/60'}`}
      >
        {label}
        {sortDir ? <span className="mr-1">{sortDir === 'desc' ? '▼' : '▲'}</span> : <span className="mr-1 text-slate-400">↕</span>}
      </button>
      <input
        value={filter}
        onChange={(e) => onFilter(e.target.value)}
        placeholder="فیلتر…"
        className="mt-1 w-full bg-white border border-slate-300 rounded px-1.5 py-0.5 text-3xs font-normal"
      />
    </th>
  );
}

export default StudentsManagerPage;

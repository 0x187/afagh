'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { backfillRolesAction, bulkForcePasswordChangeAction, bulkResetPasswordsAction, bulkResetToNationalCodeAction, createStaffExpertAction, getCohortStats, getTranscript, getTranscriptRegulation, loadStaffListAction, resetUserPasswordAction, saveUserRolesAction, setStudentRegulationAction, setUserActiveAction, updateStaffProfileAction, updateStudentProfileAction, type TranscriptRow, type StudentProfilePatch } from './actions';
import { requestStepUpAction } from '@/lib/step-up-actions';
import type { RegulationConfig } from '@/lib/regulations-engine';
import { ClientTh, ServerTh, useClientTable, type ColumnDef } from '@/components/DataTable';
import { QUOTA_FA, STUDENT_STATUS_FA, gradeStatusChip, gradeStatusFa, studentStatusChip, studentStatusFa} from '@/lib/student-labels';
import MobileCardList from '@/components/MobileCardList';
import { useConfirm } from '@/components/ui/Confirm';

// ── هستهٔ خالص و قرارداد داده از ماژول‌های جدا (ریفکتور دور ۱۱) ──
import type { StudentItem, RegulationPick, Pagination, StaffItem, CodeLabels, TranscriptPrintOptions, OriginUniversity, CohortStats} from './types';
import { DEFAULT_PRINT_OPTIONS } from './types';
import PersonPhoto from './components/PersonPhoto';
import { regThresholds, groupTranscript, faNum, dateToJalali} from './transcript-utils';
import OfficialTranscriptView from './components/OfficialTranscriptView';
import { adminSetGradeAction, getStudentGradeAuditLog, resolveSamaCodeForGradeAction } from '@/app/admin/grades/actions';
import { GRADE_STATUS_CODES } from '@/lib/grade-status-codes';
import { normalizeFa, faIncludes } from '@/lib/persian-search';

// ── لوک‌آپ‌های سما: کد خام ← عنوان فارسی (فایل‌های «دوره.txt»، «شيوه آموزش.txt»، «نحوه ورود به دانشگاه.txt») ──
const COURSE_TYPE_FA: Record<string, string> = {
  '0': 'نامشخص', '1': 'روزانه', '2': 'شبانه', '3': 'نیمه حضوری', '4': 'غیرانتفاعی',
  '5': 'دانشجویان خارجی', '6': 'روزانه - موارد خاص', '7': 'پیام نور',
  '8': 'دوره‌های آموزش عالی آزاد', '10': 'مجازی', '202': 'مهمانی',
};
const TRAINING_METHOD_FA: Record<string, string> = {
  '0': 'نامشخص', '1': 'آموزشی', '2': 'آموزشی - تغییر رشته دارای مغایرت', '3': 'آموزشی و پژوهشی',
  '4': 'آموزشی پژوهشی', '8': 'آموزشی - تغییر رشته', '11': 'پژوهش محور',
};
// نحوهٔ ورود (فایل «نحوه ورود به دانشگاه.txt» کد ۰..۱۷ — عنوان‌ها نرمال‌شده با normalizeFa)
const ACCEPT_TYPE_FA: [string, string][] = [
  ['0', 'نامشخص'], ['1', 'قبولی کنکور سراسری'], ['2', 'دانشجوی علامه خویی'], ['3', 'دانشجوی زرینه خوی'],
  ['4', 'دانشجوی شمس خوی'], ['5', 'بدون آزمون - سوابق تحصیلی'], ['6', 'کنکور سراسری'], ['7', 'دانشجوی نژند'],
  ['8', 'انتقال از خارج'], ['9', 'استعداد درخشان'], ['10', 'ممتاز'], ['11', 'نفر اول دوره قبلی'],
  ['12', 'مهمان از دانشگاه دیگر'], ['13', 'انتقالی'], ['14', 'کنکور فنی و حرفه‌ای'],
  ['15', 'کنکور کاردانی به کارشناسی ناپیوسته'], ['16', 'آموزش عالی آزاد'],
  ['17', 'صرفاً بر اساس سوابق تحصیلی (کاردانی به کارشناسی)'],
];
/** عنوان نرمال‌شدهٔ نحوهٔ ورود — مقدار DB را هم نرمال می‌کند تا گزینهٔ متناظر پیدا شود */
const acceptTypeTitle = (raw?: string | null) => {
  const n = normalizeFa(raw || '');
  if (!n) return '';
  return ACCEPT_TYPE_FA.find(([, t]) => normalizeFa(t) === n)?.[1] || raw || '';
};

import { doPrintTranscript } from '@/components/print-transcript';

export { doPrintTranscript };

/**
 * چاپ مستقیم همان نمای روی صفحه (WYSIWYG) — پیاده‌سازی در
 * `@/components/print-transcript` است تا کارنامهٔ مالی هم همان رفتار را داشته باشد.
 */

export default function StudentsManagerClient(props: {
  /** اکشن سروری: فیلتر کد ملی را در کوکی HttpOnly ذخیره می‌کند (نه در URL) */
  setNationalCodeFilter: (code: string) => Promise<void>;
  logoUrl?: string | null;
  codeLabels?: CodeLabels | null;
  regulations?: RegulationPick[];
  students: StudentItem[];
  /**
   * فهرست استادان دیگر در رندر اولیه ارسال نمی‌شود (۱.۶۶MB → ~۱۲۰KB).
   * با باز شدن تب «استادان» از اکشن `loadStaffListAction` واکشی می‌شود.
   * این پراپ فقط برای سازگاری/تست باقی مانده است.
   */
  staffList?: StaffItem[];
  pagination?: Pagination;
  degrees?: { id: number; title: string }[];
  /** گزینه‌های محل تولد/صدور از geo (سراسری) — کد وزارت در سرور resolve می‌شود */
  geoPlaces?: { title: string; ministryCode: string | null }[];
  statusCounts?: { status: string; n: number }[];
  canEditGrades?: boolean;
  rolesAll?: { id: number; code: string; title: string; isSystem: number | boolean | null }[];
  userRoleIds?: Record<number, number[]>;
  universities?: { id: number; code: string; title: string; kind: string; saminCode?: string | null }[];
  currentUniversityCode?: string;
}) {
  // انتخاب بخش اصلی (دانشجویان / اساتید / عملیات سریع)
  const [mainView, setMainView] = useState<'students' | 'professors' | 'quick_menu'>('students');

  // تب‌های فرم دانشجو — لیست اول است و ۴ تب اطلاعات در یک تب ادغام شده‌اند
  const [stuTab, setStuTab] = useState<'list' | 'info_combined' | 'transcript'>('list');
  const [stuSubTab, setStuSubTab] = useState<'extra' | 'alumni'>('extra');

  // تب‌های فرم استاد — لیست اول است و ۳ تب اطلاعات در یک تب ادغام شده‌اند
  const [profTab, setProfTab] = useState<'list' | 'info_combined'>('list');

  // ناوبری و انتخاب
  const [selectedStuIdx, setSelectedStuIdx] = useState<number>(0);
  const [selectedProfIdx, setSelectedProfIdx] = useState<number>(0);

  /**
   * فهرست استادان — **واکشی تنبل**.
   * چرا؟ قبلاً ~۱۴۰۰ ردیف × ۳۵ فیلد در رندر اولیه به مرورگر می‌آمد
   * (HTML ۱.۶۶MB / ۱۷۰KB gzip و رندر ۶۷۳ms). حالا فقط با باز کردن تب
   * «استادان» یک‌بار واکشی و در همین state کش می‌شود.
   */
  const [staffList, setStaffList] = useState<StaffItem[]>(props.staffList ?? []);
  const [staffRoleIds, setStaffRoleIds] = useState<Record<number, number[]>>(props.userRoleIds ?? {});
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffLoadError, setStaffLoadError] = useState<string>('');
  const staffRequestedRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState<string>(props.pagination?.q ?? '');
  const [toastMsg, setToastMsg] = useState<string>('');
  /* دیالوگ تأییدِ استایل‌دار به‌جای `window.confirm` بومی — برای عملیات
     برگشت‌پذیرنشدنی (غیرفعال‌کردن حساب کامل) پیام هشدار و دکمهٔ قرمز دارد. */
  const confirmDialog = useConfirm();
  const [quickActionModal, setQuickActionModal] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptRow[] | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  // پیکربندی اجرایی آیین‌نامه ملاک دانشجو (مبنای قبولی/مشروطی کارنامه)
  const [regConfig, setRegConfig] = useState<RegulationConfig | null>(null);
  // نمای کارنامه: رسمی (پیش‌فرض) یا جدول سادهٔ نمرات
  const [transcriptView, setTranscriptView] = useState<'official' | 'simple'>('official');
  // گزینه‌های چاپ کارنامه (تیک‌های تنظیمات چاپ سما) + آمار رتبهٔ هم‌رشته‌ای
  const [printOptions, setPrintOptions] = useState<TranscriptPrintOptions>(DEFAULT_PRINT_OPTIONS);
  const [rankScope, setRankScope] = useState<'year' | 'term'>('year');
  const [cohortStats, setCohortStats] = useState<CohortStats | null>(null);
  const [cohortLoading, setCohortLoading] = useState(false);
  const [cohortError, setCohortError] = useState(false);

  // مودال ثبت / اصلاح نمره
  const [gradeEditTarget, setGradeEditTarget] = useState<TranscriptRow | null>(null);
  const [gradeEditModalOpen, setGradeEditModalOpen] = useState(false);
  const [gradeValueInput, setGradeValueInput] = useState<string>('');
  const [gradeReasonInput, setGradeReasonInput] = useState<string>('');
  const [gradeSaving, setGradeSaving] = useState(false);
  // تأیید دومرحله‌ای ثبت نمره (رمز عبور — ۱۰ دقیقه معتبر)
  const [gradeNeedsStepUp, setGradeNeedsStepUp] = useState(false);
  const [gradeStepUpPw, setGradeStepUpPw] = useState('');
  const [gradeStepUpBusy, setGradeStepUpBusy] = useState(false);
  const [autoSamaCode, setAutoSamaCode] = useState<{ code: string | null; title: string }>({ code: null, title: 'در حال محاسبه...' });
  const [selectedSamaCode, setSelectedSamaCode] = useState<string>('AUTO');

  // مودال تاریخچه لاگ تغییرات نمره
  const [auditLogModalOpen, setAuditLogModalOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);

  // ── مدیریت حساب وب کاربر (فعال/غیرفعال + تغییر رمز — فقط ADMIN) ──
  const [pwModalFor, setPwModalFor] = useState<{ userId: number; name: string } | null>(null);
  const [pwInput, setPwInput] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkScope, setBulkScope] = useState<'student' | 'professor'>('student');
  const [bulkPass, setBulkPass] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkBackfill, setBulkBackfill] = useState(false);
  const [bulkMode, setBulkMode] = useState<'password' | 'national_code' | 'force_change'>('password');
  // ── ثبت استاد/کارکن جدید (مودال) ──
  const [createStaffOpen, setCreateStaffOpen] = useState(false);
  const [createStaffBusy, setCreateStaffBusy] = useState(false);
  const [createStaffMsg, setCreateStaffMsg] = useState('');
  const [csf, setCsf] = useState({ nc: '', fn: '', ln: '', father: '', bcn: '', gender: '', mobile: '', email: '', code: '', type: '' });
  const [pwSaving, setPwSaving] = useState(false);
  // ── تخصیص نقش (کارشناس/استاد/… — فقط ADMIN) ──
  const [roleModalFor, setRoleModalFor] = useState<{ userId: number; name: string } | null>(null);
  const [roleSel, setRoleSel] = useState<Set<number>>(new Set());
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleMsg, setRoleMsg] = useState('');
  const roleTitle = (r: { id: number; code: string; title: string }) => (r.title && r.title.trim()) || r.code;
  const staffIsAdmin = (st: StaffItem) => (st.staffType ?? '').includes('اداری') || (st.staffType ?? '').includes('کارشناس');
  const staffIsEdu = (st: StaffItem) => (st.staffType ?? '').includes('هیئت') || (st.staffType ?? '').includes('مربی') || (st.staffType ?? '').includes('استاد');
  const staffEngageLabel = (st: StaffItem) => {
    if (staffIsAdmin(st) && staffIsEdu(st)) return 'فعال / اشتغال به تدریس و کار اداری';
    if (staffIsAdmin(st)) return 'فعال / اشتغال به کار اداری';
    return 'فعال / اشتغال به تدریس';
  };
  const openRoleModalFor = (st: StaffItem) => {
    if (!st.userId) { showToast('شناسه کاربری این پرونده یافت نشد.'); return; }
    setRoleMsg('');
    setRoleSel(new Set(staffRoleIds?.[st.userId] ?? []));
    setRoleModalFor({ userId: st.userId, name: `${st.firstName} ${st.lastName}` });
  };
  const handleToggleActive = async (userId: number | null | undefined, next: boolean, name: string) => {
    if (!userId) { showToast('شناسه کاربری این پرونده یافت نشد.'); return; }
    const ok = await confirmDialog({
      title: next ? 'فعال‌سازی حساب کامل' : 'غیرفعال‌سازی حساب کامل',
      body: `حساب «${name}» ${next ? 'فعال' : 'غیرفعال'} شود؟ شامل ورود، کارتابل، برنامه‌ریزی، نشست‌ها و OTPها.`,
      confirmText: next ? 'فعال کن' : 'غیرفعال کن',
      danger: !next,
    });
    if (!ok) return;
    const r = await setUserActiveAction(userId, next).catch(() => ({ ok: false, error: 'خطا در ارتباط با سرور.' }));
    showToast(r.ok ? (next ? '✅ حساب کامل فعال شد.' : '⛔ حساب کامل غیرفعال شد (ورود/کارتابل/برنامه‌ریزی/نشست‌ها قطع شدند).') : (r.error || 'انجام نشد.'));
    if (r.ok) router.refresh();
  };
  // ── ذخیرهٔ واقعی ویرایش پروندهٔ استاد (F2) — خواندن ورودی‌های data-f و ارسال به سرور ──
  const staffFormRef = useRef<HTMLDivElement>(null);
  const [staffSaving, setStaffSaving] = useState(false);
  const handleSaveStaff = async () => {
    const root = staffFormRef.current;
    if (!currentStaff) { showToast('پروندهٔ استادی انتخاب نشده است.'); return; }
    if (!root) { showToast('فرم ویرایش باز نیست.'); return; }
    const get = (f: string) => (root.querySelector(`[data-f="${f}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    const patch: Record<string, unknown> = {};
    const put = (k: string, v: string) => {
      const s = (v ?? '').trim();
      if (s !== '' && s !== '—') patch[k] = s;
    };
    // نام: «نام خانوادگی - نام»
    const full = get('fullname');
    if (full.trim() !== '' && full.trim() !== '—') {
      const parts = full.split('-').map(s => s.trim()).filter(Boolean);
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
      const r = await updateStaffProfileAction(currentStaff.id, patch as Parameters<typeof updateStaffProfileAction>[1]);
      showToast(r.ok ? '✅ اطلاعات استاد با موفقیت ذخیره شد.' : (r.error || 'انجام نشد.'));
      if (r.ok) router.refresh();
    } catch {
      showToast('خطا در ارتباط با سرور.');
    } finally {
      setStaffSaving(false);
    }
  };
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwModalFor) return;
    setPwSaving(true);
    try {
      const r = await resetUserPasswordAction(pwModalFor.userId, pwInput);
      showToast(r.ok ? `✅ رمز «${pwModalFor.name}» تغییر کرد (در اولین ورود باید عوض شود).` : (r.error || 'انجام نشد.'));
      if (r.ok) { setPwModalFor(null); setPwInput(''); router.refresh(); }
    } finally {
      setPwSaving(false);
    }
  };

  const handleBulkReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkSaving(true);
    try {
      let r;
      if (bulkMode === 'national_code') {
        r = await bulkResetToNationalCodeAction(bulkScope);
      } else if (bulkMode === 'force_change') {
        r = await bulkForcePasswordChangeAction(bulkScope);
        if (!r.ok) { showToast(r.error || 'انجام نشد.'); return; }
        showToast(`✅ ${(r.count ?? 0).toLocaleString('fa-IR')} حساب ${bulkScope === 'student' ? 'دانشجویی' : 'استادی'} ملزم به تغییر رمز در ورود بعدی شدند (رمز فعلی دست نخورد).`);
        setBulkOpen(false);
        router.refresh();
        return;
      } else {
        r = await bulkResetPasswordsAction(bulkScope, bulkPass);
      }
      if (!r.ok) { showToast(r.error || 'انجام نشد.'); return; }
      let extra = '';
      if (bulkBackfill) {
        const b = await backfillRolesAction();
        extra = b.ok ? ` | نقش‌ها: +${(b.inserted ?? 0).toLocaleString('fa-IR')}` : ` | نقش‌ها: ${b.error || 'خطا'}`;
      }
      const modeLabel = bulkMode === 'national_code' ? 'به کد ملی' : 'جدید';
      showToast(`✅ رمز ${modeLabel} ${(r.count ?? 0).toLocaleString('fa-IR')} حساب ${bulkScope === 'student' ? 'دانشجویی' : 'استادی'} بازنشانی شد (ورود اول اجباری به تغییر).${extra}`);
      setBulkOpen(false);
      setBulkPass('');
      router.refresh();
    } catch (err: any) {
      showToast(err?.message || 'خطا در ارتباط با سرور.');
    } finally {
      setBulkSaving(false);
    }
  };

  const handleSaveRoles = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleModalFor) return;
    setRoleSaving(true);
    setRoleMsg('');
    try {
      const r = await saveUserRolesAction(roleModalFor.userId, [...roleSel]);
      if (!r.ok) { setRoleMsg(`⚠ ${r.error || 'ذخیره نشد.'}`); return; }
      setRoleMsg(`✅ ${(r.added ?? 0).toLocaleString('fa-IR')} نقش اضافه، ${(r.removed ?? 0).toLocaleString('fa-IR')} نقش حذف شد.`);
      setRoleModalFor(null);
      showToast(`نقش‌های «${roleModalFor.name}» ذخیره شد.`);
      router.refresh();
    } catch (err: any) {
      setRoleMsg(`⚠ ${err?.message || 'خطا در ارتباط با سرور.'}`);
    } finally {
      setRoleSaving(false);
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateStaffBusy(true);
    setCreateStaffMsg('');
    try {
      const r = await createStaffExpertAction({
        nationalCode: csf.nc, firstName: csf.fn, lastName: csf.ln,
        fatherName: csf.father, birthCertNo: csf.bcn, gender: csf.gender || undefined,
        mobile: csf.mobile, email: csf.email, staffCode: csf.code, staffType: csf.type,
      });
      if (!r.ok) { setCreateStaffMsg(`⚠ ${r.error || 'ثبت نشد.'}`); return; }
      setCreateStaffMsg('✅ حساب ساخته شد؛ نقش‌های کارشناس را می‌توانید از ستون «نقش‌ها» بدهید.');
      setCsf({ nc: '', fn: '', ln: '', father: '', bcn: '', gender: '', mobile: '', email: '', code: '', type: '' });
      setCreateStaffOpen(false);
      router.refresh();
    } catch (err: any) {
      setCreateStaffMsg(`⚠ ${err?.message || 'خطا در ارتباط با سرور.'}`);
    } finally {
      setCreateStaffBusy(false);
    }
  };

  const openEditGrade = (row: TranscriptRow) => {
    setGradeEditTarget(row);
    setGradeValueInput(row.gradeValue ?? '');
    setGradeReasonInput('');
    setSelectedSamaCode('AUTO');
    setGradeNeedsStepUp(false);
    setGradeStepUpPw('');
    setGradeEditModalOpen(true);
  };

  const handleSaveGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    await doSaveGrade();
  };

  const doSaveGrade = async () => {
    if (!currentStudent || !gradeEditTarget) return;    const num = gradeValueInput.trim() === '' ? null : Number(gradeValueInput.trim());
    if (num !== null && (isNaN(num) || num < 0 || num > 20)) {
      showToast('نمره باید بین ۰ تا ۲۰ باشد.');
      return;
    }
    if (!gradeReasonInput.trim()) {
      showToast('لطفاً دلیل تغییر را وارد کنید.');
      return;
    }
    setGradeSaving(true);
    try {
      const res = await adminSetGradeAction({ ok: false }, {
        enrollmentId: gradeEditTarget.enrollmentId,
        offeringId: gradeEditTarget.offeringId,
        studentId: currentStudent.id,
        studentCode: currentStudent.studentCode,
        termCode: gradeEditTarget.termCode,
        courseCode: gradeEditTarget.courseCode,
        gradeValue: num,
        customSamaStatusCode: selectedSamaCode === 'AUTO' ? null : selectedSamaCode,
        reason: gradeReasonInput.trim(),
      });
      if (res.ok) {
        showToast(res.message || 'نمره با موفقیت ثبت شد.');
        setGradeEditModalOpen(false);
        setTranscriptLoading(true);
getTranscript(currentStudent.id).then(r => { setTranscript(r); }).catch(e => { console.error('[transcript] ERROR', e); setTranscript([]); }).finally(() => setTranscriptLoading(false));
      } else if (res.error && res.error.startsWith('STEPUP_REQUIRED:')) {
        // تأیید دومرحله‌ای لازم است — مودال باز می‌ماند و باکس رمز نشان داده می‌شود
        setGradeNeedsStepUp(true);
        showToast('🔐 برای ثبت نمره، ابتدا رمز عبور خود را تأیید کنید.');
      } else {
        showToast(res.error || 'خطا در ثبت نمره.');
      }
    } catch (err: any) {
      showToast(err?.message || 'خطا در ارتباط با سرور.');
    } finally {
      setGradeSaving(false);
    }
  };

  /** تأیید رمز دومرحله‌ای و تلاش مجدد ثبت نمره */
  const handleStepUpConfirm = async () => {
    if (!gradeStepUpPw) { showToast('رمز عبور را وارد کنید.'); return; }
    setGradeStepUpBusy(true);
    try {
      const r = await requestStepUpAction('grades:edit', gradeStepUpPw).catch(() => ({ ok: false as const, error: 'خطا در ارتباط با سرور.' }));
      if (!r.ok) { showToast(r.error || 'تأیید نشد.'); return; }
      setGradeNeedsStepUp(false);
      setGradeStepUpPw('');
      showToast('✅ تأیید شد — در حال ثبت نمره…');
      await doSaveGrade();
    } finally {
      setGradeStepUpBusy(false);
    }
  };

  const openAuditLogs = async () => {
    if (!currentStudent) return;
    setAuditLogModalOpen(true);
    setAuditLogsLoading(true);
    try {
      const logs = await getStudentGradeAuditLog(currentStudent.id);
      setAuditLogs(logs);
    } catch {
      setAuditLogs([]);
    } finally {
      setAuditLogsLoading(false);
    }
  };

  /**
   * واکشی تنبل فهرست استادان: فقط یک‌بار، آن هم وقتی تب «استادان» باز شود.
   * اگر پراپ اولیه وجود داشته باشد (تست/مسیر قدیمی) هیچ درخواستی نمی‌فرستد.
   */
  useEffect(() => {
    if (mainView !== 'professors') return;
    if (staffRequestedRef.current) return;
    if ((props.staffList?.length ?? 0) > 0) return;
    staffRequestedRef.current = true;
    let alive = true;
    setStaffLoading(true);
    setStaffLoadError('');
    loadStaffListAction()
      .then(res => {
        if (!alive) return;
        if (res.ok && res.staffList) {
          setStaffList(res.staffList);
          setStaffRoleIds(res.userRoleIds ?? {});
        } else {
          setStaffLoadError(res.error || 'فهرست استادان بارگذاری نشد.');
          staffRequestedRef.current = false; // اجازهٔ تلاش دوباره
        }
      })
      .catch(() => {
        if (!alive) return;
        setStaffLoadError('ارتباط برقرار نشد. دوباره تلاش کنید.');
        staffRequestedRef.current = false;
      })
      .finally(() => { if (alive) setStaffLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainView]);

  const currentStudent = props.students[selectedStuIdx] || props.students[0];
  const currentStaff = staffList[selectedProfIdx] || staffList[0];

  /** دانشگاه مبدا دانشجو برای درج در کارنامه (برجسته اگر منحله باشد) */
  const originUniversity: OriginUniversity | null = (() => {
    const st = currentStudent;
    const list = props.universities ?? [];
    if (!st) return null;
    const byId = new Map(list.map(u => [u.id, u]));
    const mine = st.universityId != null ? byId.get(st.universityId) : undefined;
    if (mine && mine.kind === 'DISSOLVED') return { title: mine.title, dissolved: true };
    const sender = (st.senderUniversityCode || '').trim();
    if (sender) {
      const hit = list.find(u => u.saminCode === sender || u.code === sender);
      if (hit && hit.code !== (props.currentUniversityCode ?? 'AFAGH')) {
        return { title: hit.title, dissolved: hit.kind === 'DISSOLVED' };
      }
    }
    return null;
  })();

  // آمار رتبهٔ هم‌رشته‌ای فقط وقتی تیک «رتبه» روشن است (محاسبهٔ سنگین، کش به‌ازای دانشجو+بازه)
  useEffect(() => {
    if (!printOptions.showRank || !currentStudent) { setCohortStats(null); setCohortError(false); return; }
    let active = true;
    setCohortLoading(true);
    setCohortError(false);
    setCohortStats(null);
    getCohortStats(currentStudent.id, rankScope)
      .then(r => { if (active) { setCohortStats(r); if (!r) setCohortError(true); } })
      .catch(() => { if (active) { setCohortStats(null); setCohortError(true); } })
      .finally(() => { if (active) setCohortLoading(false); });
    return () => { active = false; };
  }, [printOptions.showRank, rankScope, currentStudent?.id]);

  useEffect(() => {
    if (!gradeEditModalOpen || !currentStudent || !gradeEditTarget?.offeringId) return;
    const num = gradeValueInput.trim() === '' ? null : Number(gradeValueInput.trim());
    if (num !== null && (isNaN(num) || num < 0 || num > 20)) return;
    let active = true;
    resolveSamaCodeForGradeAction(currentStudent.id, gradeEditTarget.offeringId, num)
      .then(res => {
        if (active) setAutoSamaCode(res);
      })
      .catch(() => {
        if (active) setAutoSamaCode({ code: null, title: 'خطا در محاسبه' });
      });
    return () => { active = false; };
  }, [gradeEditModalOpen, currentStudent?.id, gradeEditTarget?.offeringId, gradeValueInput]);

  useEffect(() => {
    if (stuTab !== 'transcript' || !currentStudent) return;
    setTranscriptLoading(true);
    setTranscript(null);
    setRegConfig(null);
    getTranscript(currentStudent.id).then(r => { setTranscript(r); }).catch(e => { console.error('[transcript] ERROR', e); setTranscript([]); }).finally(() => setTranscriptLoading(false));
    getTranscriptRegulation(currentStudent.id).then(r => setRegConfig(r?.config ?? null)).catch(() => setRegConfig(null));
  }, [stuTab, currentStudent?.id]);

  // ── فرم ویرایش پروندهٔ دانشجو (هویت + تکمیلی سما) — فقط ADMIN ──
  const [profile, setProfile] = useState<Record<string, string | number | null>>({});
  const [profileSaving, setProfileSaving] = useState(false);
  // کد ورود ۵ رقمی (سال ۴رقمی + ترم ۱رقمی) — ویرایش مستقل از فرم هویت
  const [entryCode, setEntryCode] = useState('');
  const [entrySaving, setEntrySaving] = useState(false);
  const syncProfile = (s: StudentItem) => {
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
    });
  };
  useEffect(() => {
    if (currentStudent) {
      syncProfile(currentStudent);
      setEntryCode(`${currentStudent.entryYear}${currentStudent.entryTerm}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStudent?.id]);
  const pf = (k: string, v: string | number) => setProfile(p => ({ ...p, [k]: v }));
  // گزینه‌های محل تولد/صدور از geo — مقدار ذخیره‌شده همان عنوان است
  const geoPlaceOptions: string[] = (props.geoPlaces ?? []).map(g => g.title).filter(Boolean);
  const geoPlaceSet = new Set(geoPlaceOptions.map(t => normalizeFa(t)));
  const geoValue = (v: string | number | null | undefined) => {
    const s = String(v ?? '');
    if (!s) return '';
    return geoPlaceSet.has(normalizeFa(s)) ? (geoPlaceOptions.find(t => normalizeFa(t) === normalizeFa(s)) ?? s) : s;
  };
  const geoExtraOption = (v: string | number | null | undefined) => {
    const s = String(v ?? '');
    return !!s && !geoPlaceSet.has(normalizeFa(s));
  };
  // کد دانشگاه از روی شناسه — برای استثناهای دانشگاهی نگاشت وضعیت سما
  const uniCodeOf = (id: number | null | undefined) =>
    props.universities?.find(u => u.id === id)?.code ?? null;
  const saveProfile = async (keys: string[]) => {
    if (!currentStudent) return;
    setProfileSaving(true);
    try {
      const patch: Record<string, string | number | null> = {};
      for (const k of keys) if (profile[k] !== undefined) patch[k] = profile[k] ?? '';
      const r = await updateStudentProfileAction(currentStudent.id, patch as StudentProfilePatch);
      showToast(r.ok ? '✅ پروندهٔ دانشجو ذخیره شد.' : (r.error || 'انجام نشد.'));
      if (r.ok) router.refresh();
    } catch (err: any) {
      showToast(err?.message || 'خطا در ارتباط با سرور.');
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
      const r = await updateStudentProfileAction(currentStudent.id, { entryYear, entryTerm });
      showToast(r.ok ? '✅ سال/ترم ورود ذخیره شد.' : (r.error || 'انجام نشد.'));
      if (r.ok) router.refresh();
    } catch (err: any) {
      showToast(err?.message || 'خطا در ارتباط با سرور.');
    } finally {
      setEntrySaving(false);
    }
  };
  // تاریخ شروع بر اساس کد ورود تایپ‌شده (ترم ۲ → ۱۱/۰۱، بقیه → ۰۷/۰۱)
  const entryStartDate = (() => {
    const code = entryCode.trim();
    if (!/^\d{5}$/.test(code)) return null;
    const y = Number(code.slice(0, 4));
    const t = Number(code.slice(4));
    if (y < 1300 || y > 1500 || t < 1 || t > 3) return null;
    return `${faNum(y, 0)}/${t === 2 ? '۱۱' : '۰۷'}/۰۱`;
  })();

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  };

  const router = useRouter();
  const pathname = usePathname();
  const pg = props.pagination;
  // جست‌وجوی دانشجو سمت سرور است (props.students فقط یک صفحه است)؛ جست‌وجوی استاد محلی
  const [staffQuery, setStaffQuery] = useState('');
  const [staffVisible, setStaffVisible] = useState(100);
  const [staffTypeFilter, setStaffTypeFilter] = useState('ALL');
  // ── ساخت URL فقط با فیلترهای غیرحساس ──
  // کد ملی عمداً در URL قرار نمی‌گیرد (لاگ دسترسی وب‌سرور، تاریخچه و Referer)؛
  // مقدار آن در کوکی HttpOnlyِ نشست روی سرور نگه‌داری می‌شود.
  const buildUrl = (patch: Record<string, string>) => {
    const cur = {
      q: pg?.q ?? '', status: pg?.status ?? 'ALL', degree: String(pg?.degree ?? 0), page: '1',
      sort: pg?.sort ?? '', f_code: pg?.f_code ?? '', f_name: pg?.f_name ?? '',
      f_major: pg?.f_major ?? '', f_year: pg?.f_year ?? '',
      ...patch,
    };
    const p = new URLSearchParams();
    if (cur.q) p.set('q', cur.q);
    if (cur.status && cur.status !== 'ALL') p.set('status', cur.status);
    if (cur.degree && cur.degree !== '0') p.set('degree', cur.degree);
    if (cur.page && cur.page !== '1') p.set('page', cur.page);
    if (cur.sort) p.set('sort', cur.sort);
    if (cur.f_code) p.set('f_code', cur.f_code);
    if (cur.f_name) p.set('f_name', cur.f_name);
    if (cur.f_major) p.set('f_major', cur.f_major);
    if (cur.f_year) p.set('f_year', cur.f_year);
    const qs = p.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const nav = (patch: Record<string, string>) => { router.push(buildUrl(patch)); };
  // سورت ستونی دانشجویان (سروری): key -> asc -> desc -> بدون سورت
  const [stuSortKey, stuSortDir] = (pg?.sort ?? '').split(':') as [string, string?];
  const toggleStuSort = (key: string) => {
    if (stuSortKey !== key) nav({ sort: `${key}:asc` });
    else if (stuSortDir === 'asc') nav({ sort: `${key}:desc` });
    else nav({ sort: '' });
  };
  // فیلترهای ستونی (لوکال + اعمال با Enter)
  const [stuFilters, setStuFilters] = useState({ f_code: pg?.f_code ?? '', f_name: pg?.f_name ?? '', f_nc: pg?.f_nc ?? '', f_major: pg?.f_major ?? '', f_year: pg?.f_year ?? '' });

  // کد ملی با اکشن سروری در کوکی HttpOnly ذخیره می‌شود و بقیهٔ فیلترها
  // مثل قبل در URL می‌مانند. اگر فقط کد ملی تغییر کرده باشد URL عوض
  // نمی‌شود، پس برای خوانده‌شدن کوکی صریحاً رفرش می‌کنیم تا فیلتر
  // بعد از رفرش/بازگشت به‌طور گیج‌کننده از دست نرود.
  const applyStuFilters = async () => {
    const nc = stuFilters.f_nc.trim();
    try {
      await props.setNationalCodeFilter(nc);
    } catch {
      showToast('خطا در اعمال فیلتر کد ملی.');
      return;
    }
    const target = buildUrl({
      f_code: stuFilters.f_code.trim(), f_name: stuFilters.f_name.trim(),
      f_major: stuFilters.f_major.trim(), f_year: stuFilters.f_year.trim(), page: '1',
    });
    if (target === `${pathname}${window.location.search}`) router.refresh();
    else router.push(target);
  };

  // پاک‌سازی همهٔ فیلترها؛ کوکی کد ملی هم باید پاک شود
  const clearStuFilters = async () => {
    setSearchQuery('');
    setStuFilters({ f_code: '', f_name: '', f_nc: '', f_major: '', f_year: '' });
    try {
      await props.setNationalCodeFilter('');
    } catch {
      // پاک‌شدن بقیهٔ فیلترها نباید به خطای کوکی وابسته باشد
    }
    const target = buildUrl({ q: '', status: 'ALL', degree: '0', sort: '', f_code: '', f_name: '', f_major: '', f_year: '', page: '1' });
    if (target === `${pathname}${window.location.search}`) router.refresh();
    else router.push(target);
  };

  const staffQueryFiltered = staffList.filter(s =>
    (!staffQuery ||
    faIncludes(s.staffCode ?? '', staffQuery) ||
    faIncludes(s.nationalCode ?? '', staffQuery) ||
    faIncludes(`${s.firstName ?? ''} ${s.lastName ?? ''}`, staffQuery)) &&
    (staffTypeFilter === 'ALL' || (staffTypeFilter === 'EDU' && (s.staffType ?? '').includes('هیئت')) || (staffTypeFilter === 'ADMIN' && (s.staffType ?? '').includes('اداری')) || (staffTypeFilter === 'OTHER' && s.staffType && !(s.staffType as string).includes('هیئت') && !(s.staffType as string).includes('اداری')))
  );

  // جدول اساتید: سورت + فیلتر هر ستون (کلاینتی — کل لیست دست مرورگر است)
  const STAFF_COLS: ColumnDef<StaffItem>[] = [
    { key: 'staffCode', label: 'کد استاد', get: s => s.staffCode ?? '' },
    { key: 'name', label: 'نام و نام خانوادگی', get: s => `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() },
    { key: 'nationalCode', label: 'کد ملی', get: s => s.nationalCode ?? '' },
    { key: 'department', label: 'گروه آموزشی', get: s => s.departmentName && s.departmentName !== '—' ? s.departmentName : '' },
    { key: 'rank', label: 'مرتبه علمی', get: s => s.academicRank },
    { key: 'degree', label: 'مدرک', get: s => s.degree },
    { key: 'coop', label: 'نوع همکاری', get: s => s.staffType },
  ];
  const staffTable = useClientTable(staffQueryFiltered, STAFF_COLS);
  const filteredStaff = staffTable.visible;

  return (
    <div className="space-y-4 font-sans text-xs text-slate-900">
      
      {/* ─── نوار سوئیچ بین بخش دانشجویان، اساتید و منوی عملیات سریع ─── */}
      {/* سوییچر دانشگاه فقط در سربرگ سراسری است (UniversitySwitcher) — اینجا تکراری بود و حذف شد */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-800 text-white p-2.5 px-4 rounded-xl shadow-md border border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-300">
            {props.universities?.find(u => u.code === (props.currentUniversityCode ?? 'AFAGH'))?.title ?? ''}
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
        <div className="p-3 bg-emerald-100 text-emerald-900 font-bold border border-emerald-300 rounded-xl shadow-sm text-center animate-fade dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          {toastMsg}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ۱. فرم پرونده و ثبت‌نام دانشجو (مطابق تصاویر ۱ تا ۴)             */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {mainView === 'students' && (
        <div className="bg-slate-200 p-2 sm:p-4 rounded-xl border border-slate-400 shadow-xl space-y-2">
          
          {/* تب‌های اصلی بالای فرم ثبت‌نام دانشجو — لیست اول + اطلاعات ادغام‌شده */}
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

          {/* نوار سربرگ شماره دانشجویی و ناوبری رکورد */}
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
                onClick={() => selectedStuIdx < props.students.length - 1 && setSelectedStuIdx(selectedStuIdx + 1)}
                disabled={selectedStuIdx === props.students.length - 1}
                className="px-2 py-1 bg-white border border-slate-400 rounded hover:bg-slate-50 disabled:opacity-40"
              >
                ◀ بعدی
              </button>
              <span className="text-2xs text-slate-500 mr-2 font-mono">
                پرونده {selectedStuIdx + 1} از {props.students.length}
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

          {/* ── تب ادغام‌شده: اطلاعات دانشجو (۴ بخش) — بخش ۱: اطلاعات دانشجویان ── */}
          {stuTab === 'info_combined' && currentStudent && (
            <div key={`stu-a-${currentStudent.id}`} className="bg-white p-3 sm:p-5 border border-slate-400 rounded-b-md space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* ستون ۱ */}
                <div className="space-y-1.5 border border-slate-300 p-2.5 rounded bg-slate-50/50">
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-red-700 font-bold">* کد ترم ورود:</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={entryCode}
                        onChange={e => setEntryCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
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
                    <input type="text" value={profile.fatherName ?? ''} onChange={e => pf('fatherName', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded" />
                    <div className="flex items-center gap-1">
                      <span>جنس:</span>
                      <select
                        value={profile.gender ?? ''}
                        onChange={e => pf('gender', e.target.value)}
                        className="bg-white border border-slate-300 px-1 py-1 rounded"
                      >
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
                      <input type="text" value={profile.birthCertNo ?? ''} onChange={e => pf('birthCertNo', e.target.value)} className="bg-white border border-slate-300 px-1 py-1 rounded font-mono w-full" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-red-700 font-bold">* کد ملی:</span>
                    <input type="text" defaultValue={currentStudent.nationalCode} className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono font-bold" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>محل صدور:</span>
                    <select value={geoValue(profile.placeOfIssue)} onChange={e => pf('placeOfIssue', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded" title="از فهرست geo — کد وزارت خودکار ثبت می‌شود">
                      <option value="">—</option>
                      {geoPlaceOptions.map(t => <option key={`i-${t}`} value={t}>{t}</option>)}
                      {geoExtraOption(profile.placeOfIssue) && <option value={profile.placeOfIssue ?? ''}>{profile.placeOfIssue} (قدیمی)</option>}
                    </select>
                    <div className="flex items-center gap-1">
                      <span>محل تولد:</span>
                      <select value={geoValue(profile.placeOfBirth)} onChange={e => pf('placeOfBirth', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" title="از فهرست geo — کد وزارت خودکار ثبت می‌شود">
                        <option value="">—</option>
                        {geoPlaceOptions.map(t => <option key={`b-${t}`} value={t}>{t}</option>)}
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

                {/* ستون ۲ */}
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
                      {(props.degrees ?? []).map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
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
                    <input type="text" value={profile.mobile ?? ''} onChange={e => pf('mobile', e.target.value)} placeholder="—" className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>شماره ثابت منزل:</span>
                    <input type="text" value={profile.homeTell ?? ''} onChange={e => pf('homeTell', e.target.value)} placeholder="—" className="col-span-2 bg-white border border-slate-300 px-2 py-1 rounded font-mono" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <span>آیین‌نامه ملاک:</span>
                    <div className="col-span-2 flex gap-1.5">
                      <select
                        value={currentStudent.regulationId ?? 0}
                        onChange={e => {
                          const rid = Number(e.target.value);
                          if (!rid || !currentStudent) return;
                          showToast('⏳ در حال تغییر آیین‌نامه و بازمحاسبه کدهای نمرات...');
                          setStudentRegulationAction(currentStudent.id, rid).then(r => {
                            showToast(r.ok ? `آیین‌نامه تغییر کرد — ${r.scanned ?? 0} نمره بررسی، ${r.updated ?? 0} کد اصلاح شد.` : (r.error || 'انجام نشد.'));
                            if (r.ok) router.refresh();
                          }).catch(() => showToast('انجام نشد.'));
                        }}
                        className="flex-1 bg-white border border-slate-300 px-2 py-1 rounded font-semibold text-indigo-950"
                      >
                        <option value={0} disabled>{currentStudent.regulationTitle}</option>
                        {(props.regulations ?? []).map(r => (
                          <option key={r.id} value={r.id}>{r.title}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {/* ── حساب وب دانشجو: فعال/غیرفعال + تغییر رمز (فقط ADMIN) ── */}
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

          {/* ── بخش ۲: اطلاعات تکمیلی دانشجو ── */}
          {stuTab === 'info_combined' && currentStudent && (
            <div key={`stu-b-${currentStudent.id}`} className="bg-white p-3 sm:p-5 border border-slate-400 rounded-b-md space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* کادر عکس پرسنلی — از مسیر امن /api/photo/[userId]؛ بدون عکس همان جای‌نگهدار */}
                <div className="border border-slate-300 p-3 rounded bg-slate-50 flex flex-col items-center justify-center space-y-2">
                  <PersonPhoto userId={currentStudent.userId} hasPhoto={!!currentStudent.photoKey} className="w-28 h-36" icon="👤" label="عکس پرسنلی" />
                  <div className="flex flex-col gap-1 w-full max-w-[140px]">
                    <button onClick={() => showToast('📁 کادر انتخاب تصویر باز شد')} className="px-2 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100 font-bold text-2xs">فایل تصویر</button>
                    <button onClick={() => showToast('تصویر حذف گردید')} className="px-2 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100 text-red-700 text-2xs">حذف تصویر</button>
                    <button onClick={() => showToast('کپی تصویر انجام شد')} className="px-2 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100 text-2xs">کپی تصویر به فایل</button>
                  </div>
                </div>

                {/* فیلدهای تکمیلی */}
                <div className="md:col-span-2 space-y-2 border border-slate-300 p-3 rounded bg-slate-50">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-24">استاد راهنما:</span>
                      <input type="text" value={profile.advisorCode ?? ''} onChange={e => pf('advisorCode', e.target.value)} className="bg-yellow-100 border border-slate-300 px-2 py-1 rounded w-full font-bold dark:text-slate-900" placeholder="کد/نام استاد راهنما —" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-24">وضعیت نظام وظیفه:</span>
                      <select value={profile.militaryStatus ?? ''} onChange={e => pf('militaryStatus', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full">
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
                      <select value={profile.documentStatus ?? ''} onChange={e => pf('documentStatus', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full">
                        <option value="">—</option>
                        <option value="تکمیل و تأییدشده ✓">تکمیل و تأییدشده ✓</option>
                        <option value="دارای نقص مدرک">دارای نقص مدرک</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-24">نوع بورسیه:</span>
                      <input type="text" value={profile.scholarshipType ?? ''} onChange={e => pf('scholarshipType', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="—" />
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
                        onChange={e => pf('nationality', e.target.checked ? '120001' : '')}
                        className="w-4 h-4 text-emerald-600 rounded"
                      />
                      <span>تابعیت ایرانی دارد</span>
                    </label>
                    <span className="text-slate-500">سال‌های استفاده از آموزش رایگان:</span>
                    <input type="number" defaultValue="۰" className="w-16 bg-white border border-slate-300 px-2 py-0.5 rounded font-mono text-center" />
                  </div>
                </div>
              </div>

              {/* کادر نمره آزمون زبان و ممیزی ثبت‌کننده */}
              <div className="border border-slate-300 p-2.5 rounded bg-slate-50 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-slate-800">وضعیت نمره آزمون زبان انگلیسی:</span>
                  <span>نوع آزمون:</span>
                  <select value={profile.englishExamType ?? ''} onChange={e => pf('englishExamType', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded">
                    <option value="">—</option>
                    <option value="MSRT">MSRT</option>
                    <option value="Tolimo">Tolimo</option>
                    <option value="IELTS">IELTS</option>
                    <option value="TOEFL">TOEFL</option>
                  </select>
                  <span>نمره آزمون:</span>
                  <input type="text" value={profile.englishScore ?? ''} onChange={e => pf('englishScore', e.target.value)} className="w-20 bg-white border border-slate-300 px-2 py-1 rounded font-mono text-center font-bold" placeholder="—" />
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

          {/* ── بخش ۳: سایر اطلاعات ── */}
          {stuTab === 'info_combined' && currentStudent && (
            <div key={`stu-c-${currentStudent.id}`} className="bg-white p-3 sm:p-5 border border-slate-400 rounded-b-md space-y-3">
              {/* بخش خوابگاه و آدرس */}
              <div className="border border-slate-300 p-2.5 rounded bg-slate-50 space-y-1.5">
                <div className="grid grid-cols-3 gap-2 items-center">
                  <span>نام خوابگاه و شماره اتاق:</span>
                  <input type="text" value={profile.dormName ?? ''} onChange={e => pf('dormName', e.target.value)} className="bg-yellow-100 border border-slate-300 px-2 py-1 rounded font-bold dark:text-slate-900" placeholder="—" />
                  <input type="text" value={profile.dormRoom ?? ''} onChange={e => pf('dormRoom', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded text-center" placeholder="—" />
                </div>
                <div className="grid grid-cols-3 gap-2 items-center">
                  <span>عنوان و شغل ولی/قیم:</span>
                  <input type="text" value={profile.guardianJobTitle ?? ''} onChange={e => pf('guardianJobTitle', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded" placeholder="—" />
                  <div className="flex items-center gap-1">
                    <span>تلفن ولی:</span>
                    <input type="text" value={profile.guardianPhone ?? ''} onChange={e => pf('guardianPhone', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded font-mono w-full" placeholder="—" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 items-center">
                  <span>کد پستی و ایمیل:</span>
                  <input type="text" value={profile.postalCode ?? ''} onChange={e => pf('postalCode', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded font-mono" placeholder="—" />
                  <input type="email" value={profile.email ?? ''} onChange={e => pf('email', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded font-mono text-left" dir="ltr" placeholder="ایمیل دانشجو" />
                </div>
              </div>

              {/* ماتریس سوابق مقاطع قبلی */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="border border-slate-300 p-2.5 rounded bg-slate-50 space-y-1">
                  <h4 className="font-bold text-slate-800 border-b pb-1">سوابق دوره پیش‌دانشگاهی / دیپلم:</h4>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">محل اخذ دیپلم:</span>
                    <input type="text" value={profile.diplomaPlace ?? ''} onChange={e => pf('diplomaPlace', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded flex-1" placeholder="—" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">سال اخذ:</span>
                    <input type="text" value={profile.diplomaYear ?? ''} onChange={e => pf('diplomaYear', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded w-16 font-mono" placeholder="—" />
                    <span className="text-slate-500">معدل کتبی دیپلم:</span>
                    <b className="text-emerald-800">{profile.diplomaGrade || '—'}</b>
                    <input type="text" value={profile.diplomaGrade ?? ''} onChange={e => pf('diplomaGrade', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded w-14 font-mono" placeholder="—" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">پیش‌دانشگاهی:</span>
                    <input type="text" value={profile.pishdPlace ?? ''} onChange={e => pf('pishdPlace', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded flex-1" placeholder="محل —" />
                    <input type="text" value={profile.pishdYear ?? ''} onChange={e => pf('pishdYear', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded w-16 font-mono" placeholder="سال" />
                    <input type="text" value={profile.pishdGrade ?? ''} onChange={e => pf('pishdGrade', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded w-14 font-mono" placeholder="معدل" />
                  </div>
                </div>
                <div className="border border-slate-300 p-2.5 rounded bg-slate-50 space-y-1">
                  <h4 className="font-bold text-slate-800 border-b pb-1">اطلاعات وضعیت شهریه‌پرداز:</h4>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">نوع دوره:</span>
                    <input type="text" value={profile.tuitionType ?? ''} onChange={e => pf('tuitionType', e.target.value)} className="bg-white border border-slate-300 px-2 py-0.5 rounded flex-1" placeholder="روزانه (آموزش رایگان دولتی) —" />
                  </div>
                  <label className="flex items-center gap-1.5 font-bold mt-1">
                    <input
                      type="checkbox"
                      checked={(profile.tuitionPayer ?? 0) === 1}
                      onChange={e => pf('tuitionPayer', e.target.checked ? 1 : 0)}
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

          {/* ── بخش ۴: اطلاعات اضافی و دانش‌آموختگان ── */}
          {stuTab === 'info_combined' && currentStudent && (
            <div key={`stu-d-${currentStudent.id}`} className="bg-white p-3 sm:p-5 border border-slate-400 rounded-b-md space-y-3">
              {/* زیرتب‌ها */}
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
                        <input type="text" value={profile.diplomaType ?? ''} onChange={e => pf('diplomaType', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="—" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">کد صحت مدارک / آرشیو:</span>
                        <input type="text" value={profile.archiveNo ?? ''} onChange={e => pf('archiveNo', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="—" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">ابطال نظام وظیفه:</span>
                        <input type="text" value={profile.militaryStatus ?? ''} onChange={e => pf('militaryStatus', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="در حال تحصیل (معافیت موقت)" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">شمارهٔ معافیت:</span>
                        <input type="text" value={profile.militaryExemptionNo ?? ''} onChange={e => pf('militaryExemptionNo', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="—" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">تعداد صدور گواهی ۳ ماهه:</span>
                        <input type="number" value={profile.certIssued3m ?? 0} onChange={e => pf('certIssued3m', Number(e.target.value) || 0)} className="bg-white border border-slate-300 px-2 py-1 rounded w-20 font-mono" />
                        <span>فقره</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">شمارهٔ پرونده:</span>
                        <input type="text" value={profile.parvandehNo ?? ''} onChange={e => pf('parvandehNo', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="—" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">تعداد ترم معادل‌سازی:</span>
                        <input type="number" value={profile.eqSemesters ?? 0} onChange={e => pf('eqSemesters', Number(e.target.value) || 0)} className="bg-white border border-slate-300 px-2 py-1 rounded w-20 font-mono" />
                        <span>ترم</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">وضعیت صدور کارت دانشجویی:</span>
                        <input type="text" value={profile.studentCardStatus ?? ''} onChange={e => pf('studentCardStatus', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="صادر و تحویل شده" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">نواقص پرونده:</span>
                        <input type="text" value={profile.documentDeficiency ?? ''} onChange={e => pf('documentDeficiency', e.target.value)} className="bg-white border border-slate-300 px-2 py-1 rounded w-full" placeholder="فاقد نقص پرونده" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-40">واحد مانده تا فارغ‌التحصیلی:</span>
                        <input type="number" value={profile.unitsRemaining ?? ''} onChange={e => pf('unitsRemaining', e.target.value === '' ? '' : Number(e.target.value) || 0)} className="bg-white border border-slate-300 px-2 py-1 rounded w-20 font-mono" />
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

          {/* ── تب ۵: کارنامهٔ رسمی + جدول نمرات ── */}
          {stuTab === 'transcript' && currentStudent && (
            <div key={`stu-tr-${currentStudent.id}`} className="transcript-print-area bg-white p-3 sm:p-4 border border-slate-400 rounded-b-md space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
                <h3 className="font-extrabold text-slate-900">📊 کارنامهٔ {currentStudent.lastName} - {currentStudent.firstName} ({currentStudent.studentCode})</h3>
                <div className="flex items-center gap-1.5">
                  <span className="text-2xs text-slate-500 ml-1">{transcript ? `${transcript.length} درس` : ''}</span>
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
                  {props.canEditGrades && (
                    <>
                      <button
                        onClick={() => {
                          if (transcript && transcript.length > 0) {
                            openEditGrade(transcript[0]);
                          } else {
                            setGradeEditTarget({
                              termCode: '',
                              termTitle: null,
                              courseCode: '',
                              courseTitle: '',
                              units: null,
                              courseType: null,
                              gradeValue: null,
                              gradeStatus: 'PENDING',
                              gradeStatusTitle: null,
                              gradeStatusCode: null,
                              offeringType: null,
                              termStatusTitle: null,
                              termProbation: null,
                            });
                            setGradeValueInput('');
                            setGradeReasonInput('');
                            setGradeEditModalOpen(true);
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
                    {(() => { const th = regThresholds(regConfig); return ` (قبولی ${faNum(th.pass, 0)} — مشروطی زیر ${faNum(th.prob, 0)}${th.minUnits > 0 ? ` — حدنصاب واحد ترم ${faNum(th.minUnits, 0)}` : ''}${th.exclFailed ? ' — حذف مردودی قبول‌شده از معدل کل' : ''})`; })()}
                  </p>
                )}
                {/* ── تنظیمات چاپ کارنامه (تیک‌های سما) — در چاپ نمی‌آید ── */}
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
                          onChange={e => setPrintOptions(o => ({ ...o, [k]: e.target.checked }))}
                          className="w-3.5 h-3.5 accent-indigo-700"
                        />
                        {label}
                      </label>
                    ))}
                    {printOptions.showRank && (
                      <select
                        value={rankScope}
                        onChange={e => setRankScope(e.target.value as 'year' | 'term')}
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
                  <table className="w-full text-right text-2xs rt">
                    <thead className="bg-slate-100 border-b border-slate-300 font-bold">
                      <tr>
                        <th className="p-1.5">ترم</th>
                        <th className="p-1.5">کد درس</th>
                        <th className="p-1.5">عنوان درس</th>
                        <th className="p-1.5 text-center">واحد</th>
                        <th className="p-1.5 text-center">نمره</th>
                        <th className="p-1.5 text-center">وضعیت</th>
                        {props.canEditGrades && <th className="p-1.5 text-center">عملیات</th>}
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
                  {props.canEditGrades && (
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
                  logoUrl={props.logoUrl}
                  codeLabels={props.codeLabels}
                  canEditGrades={props.canEditGrades}
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

          {/* ── تب ۶: لیست و جستجوی سریع دانشجویان (صفحه‌بندی سمت سرور) ── */}
          {stuTab === 'list' && (
            <div className="bg-white p-4 border border-slate-400 rounded-b-md space-y-3">
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={e => { e.preventDefault(); setSelectedStuIdx(0); nav({ q: searchQuery }); }}
              >
                <input
                  type="text"
                  placeholder="🔍 جستجو: شماره دانشجویی، کد ملی یا نام..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full max-w-md bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-xs"
                />
                <button type="submit" className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold rounded">جستجو</button>
                {(pg?.q || pg?.status !== 'ALL' || (pg?.degree ?? 0) > 0 || pg?.sort || pg?.f_code || pg?.f_name || pg?.f_nc || pg?.f_major || pg?.f_year) && (
                  <button type="button" onClick={clearStuFilters} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs rounded">✖ پاک‌سازی فیلتر</button>
                )}
                <span className="text-xs text-slate-500 mr-auto">{(pg?.total ?? props.students.length).toLocaleString('fa-IR')} پرونده</span>
              </form>

              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200">
                <button
                  onClick={() => { setBulkOpen(true); setBulkScope('student'); setBulkPass(''); }}
                  className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold"
                  title="تعیین یک رمز واحد برای همهٔ دانشجویان/اساتید فعال وب (فقط مدیر سیستم)"
                >
                  🔑 بازنشانی گروهی رمز
                </button>
                <span className="text-3xs text-slate-500">در اولین ورود، اجباری به تغییر رمز — به‌همراه ساخت خودکار نقش‌های جاافتاده</span>
              </div>

              {/* چیپ‌های وضعیت */}
              <div className="flex flex-wrap items-center gap-1.5 text-2xs">
                <button onClick={() => nav({ status: 'ALL' })} className={`px-2.5 py-1 rounded-full border font-bold ${(!pg || pg.status === 'ALL') ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 border-slate-300 hover:bg-slate-100'}`}>
                  همه ({(props.statusCounts ?? []).reduce((a, c) => a + c.n, 0).toLocaleString('fa-IR')})
                </button>
                {(props.statusCounts ?? []).map(c => (
                  <button key={c.status} onClick={() => nav({ status: c.status })} title={c.status}
                    className={`px-2.5 py-1 rounded-full border font-bold ${pg?.status === c.status ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 border-slate-300 hover:bg-slate-100'}`}>
                    {studentStatusFa(c.status)} <span className="opacity-70">({c.n.toLocaleString('fa-IR')})</span>
                  </button>
                ))}
                <select
                  value={pg?.degree ?? 0}
                  onChange={e => nav({ degree: e.target.value })}
                  className="mr-auto bg-slate-50 border border-slate-300 rounded px-2 py-1 text-2xs"
                >
                  <option value={0}>همه مقاطع</option>
                  {(props.degrees ?? []).map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              </div>

              <div className="overflow-x-auto border border-slate-300 rounded hidden md:block">
                <table className="w-full min-w-[860px] table-fixed text-right text-xs rt rt--scroll">
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
                      <ServerTh label="شماره دانشجویی" sortKey="studentCode" activeKey={stuSortKey || null} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('studentCode')} filter={stuFilters.f_code} onFilter={v => setStuFilters(f => ({ ...f, f_code: v }))} onApply={applyStuFilters} />
                      <ServerTh label="نام و نام خانوادگی" sortKey="name" activeKey={stuSortKey || null} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('name')} filter={stuFilters.f_name} onFilter={v => setStuFilters(f => ({ ...f, f_name: v }))} onApply={applyStuFilters} />
                      <ServerTh label="کد ملی" sortKey="nc" activeKey={stuSortKey || null} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('nc')} filter={stuFilters.f_nc} onFilter={v => setStuFilters(f => ({ ...f, f_nc: v }))} onApply={applyStuFilters} />
                      <ServerTh label="رشته" sortKey="major" activeKey={stuSortKey || null} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('major')} filter={stuFilters.f_major} onFilter={v => setStuFilters(f => ({ ...f, f_major: v }))} onApply={applyStuFilters} />
                      <ServerTh label="مقطع" sortKey="degree" activeKey={stuSortKey || null} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('degree')} />
                      <ServerTh label="سال ورود" sortKey="year" activeKey={stuSortKey || null} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('year')} filter={stuFilters.f_year} onFilter={v => setStuFilters(f => ({ ...f, f_year: v }))} onApply={applyStuFilters} />
                      <ServerTh label="وضعیت" sortKey="status" activeKey={stuSortKey || null} dir={(stuSortDir as 'asc' | 'desc') ?? 'asc'} onSort={() => toggleStuSort('status')} />
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
                    {props.students.map((s) => (
                      <tr key={s.id} className="border-b border-slate-200 hover:bg-slate-50">
                        <td className="p-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => {
                              const realIdx = props.students.findIndex(x => x.id === s.id);
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
                            {studentStatusFa(s.status, s.samaStatusCode, uniCodeOf((s as { universityId?: number | null }).universityId))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <MobileCardList<StudentItem>
                rows={props.students}
                columns={[
                  { key: 'name', label: 'نام', title: true, render: (s) => `${s.firstName} ${s.lastName}`.trim() || '—' },
                  { key: 'studentCode', label: 'شماره دانشجویی', subtitle: true },
                  { key: 'nationalCode', label: 'کد ملی', render: (s) => <span dir="ltr">{s.nationalCode}</span> },
                  { key: 'majorName', label: 'رشته' },
                  { key: 'degreeLevel', label: 'مقطع' },
                  { key: 'entryYear', label: 'سال ورود', render: (s) => s.entryYear },
                  { key: 'status', label: 'وضعیت', bare: true, render: (s) => (
                    <span
                      title={s.samaStatusCode ? `کد سما: ${s.samaStatusCode}` : s.status}
                      className={`${studentStatusChip(s.status)} text-3xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap`}
                    >
                      {studentStatusFa(s.status, s.samaStatusCode, uniCodeOf((s as { universityId?: number | null }).universityId))}
                    </span>
                  ) },
                ]}
                getKey={(s) => s.id}
                renderActions={(s) => (
                  <button
                    onClick={() => {
                      const realIdx = props.students.findIndex(x => x.id === s.id);
                      setSelectedStuIdx(realIdx >= 0 ? realIdx : 0);
                      setStuTab('info_combined');
                    }}
                    className="bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-2xs px-2.5 py-1 rounded font-bold whitespace-nowrap"
                  >
                    مشاهده پرونده 🔍
                  </button>
                )}
                empty={<div className="p-6 text-center text-xs text-slate-400">موردی یافت نشد.</div>}
              />

              {/* صفحه‌بندی */}
              {pg && pg.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 text-xs">
                  <button disabled={pg.page <= 1} onClick={() => nav({ page: String(pg.page - 1) })} className="px-3 py-1.5 bg-white border border-slate-300 rounded font-bold disabled:opacity-40 hover:bg-slate-50">قبلی ▶</button>
                  <span className="font-bold text-slate-700">صفحه {pg.page.toLocaleString('fa-IR')} از {pg.totalPages.toLocaleString('fa-IR')}</span>
                  <button disabled={pg.page >= pg.totalPages} onClick={() => nav({ page: String(pg.page + 1) })} className="px-3 py-1.5 bg-white border border-slate-300 rounded font-bold disabled:opacity-40 hover:bg-slate-50">◀ بعدی</button>
                </div>
              )}
              <p className="text-3xs text-slate-400 text-center">ناوبری پرونده (قبلی/بعدی) در محدوده همین صفحه (۵۰ رکورد) است — برای پرونده خاص، جست‌وجو کنید.</p>
            </div>
          )}

          {/* دکمه‌های عملیاتی پایین فرم ثبت‌نام دانشجو (F2 ذخیره / F4 ویرایش / انصراف / خروج) */}
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

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ۲. فرم معرفی و پرونده استاد (مطابق تصاویر ۵ تا ۷)                */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {mainView === 'professors' && (
        <div className="bg-slate-200 p-2 sm:p-4 rounded-xl border border-slate-400 shadow-xl space-y-2">
          
          {/* تب‌های بالای فرم معرفی استاد — لیست اول + اطلاعات ادغام‌شده */}
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

          {/* نوار سربرگ کد استاد و جستجو */}
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
              <span className="mr-auto"></span>
              {currentStaff && currentStaff.userId ? (
                <button
                  onClick={() => openRoleModalFor(currentStaff)}
                  className="px-3 py-1.5 rounded bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold whitespace-nowrap"
                  title={(`نقش‌های «${currentStaff.firstName} ${currentStaff.lastName}»: ${((staffRoleIds?.[currentStaff.userId ?? 0] ?? []).map(id => roleTitle(props.rolesAll?.find(r => r.id === id) ?? { id, code: '؟', title: '' }))).join('، ') || 'هیچ'}`)}
                >
                  {((staffRoleIds?.[currentStaff.userId ?? 0] ?? []).length > 0)
                    ? `⚙ ${(staffRoleIds?.[currentStaff.userId ?? 0] ?? []).length} نقش`
                    : '⚙ نقش‌ها'}
                </button>
              ) : null}
              <button
                onClick={() => { setCsf({ nc: '', fn: '', ln: '', father: '', bcn: '', gender: '', mobile: '', email: '', code: '', type: '' }); setCreateStaffMsg(''); setCreateStaffOpen(true); }}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold"
                title="ثبت حساب کاربری استاد یا کارکن جدید (کارشناس/همکار اداری) — فقط مدیر سیستم"
              >
                ＋ استاد / کارمند جدید
              </button>
            </div>
          </div>

          {/* ── بخش ۱ استاد: اطلاعات آموزشی (ادغام‌شده) ── */}
          {profTab === 'info_combined' && !currentStaff && (
            <div className="rounded-b-md border border-slate-400 bg-white p-6 text-center text-xs font-bold text-slate-600">
              {staffLoading ? 'در حال بارگذاری دوسیهٔ استاد…' : 'استادی برای نمایش انتخاب نشده است.'}
            </div>
          )}
          {profTab === 'info_combined' && currentStaff && (
            <div ref={staffFormRef}>
            <div key={`prof-a-${currentStaff.id}`} className="bg-white p-3 sm:p-5 border border-slate-400 rounded-b-md space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* کادرهای عکس و امضای الکترونیک استاد */}
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

                {/* ماتریس مشخصات آموزشی استاد */}
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

          {/* ── بخش ۲ استاد: اطلاعات استخدامی ── */}
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

          {/* ── بخش ۳ استاد: اطلاعات فردی ── */}
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
                  {/* ── حساب وب استاد: فعال/غیرفعال + تغییر رمز (فقط ADMIN) ── */}
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
                          title={(`نقش‌های فعلی: ${(((staffRoleIds?.[currentStaff.userId] ?? [])).map(id => roleTitle(props.rolesAll?.find(r => r.id === id) ?? { id, code: '؟', title: '' }))).join('، ') || 'هیچ'}`)}
                        >
                          {(staffRoleIds?.[currentStaff.userId] ?? []).length > 0 ? `⚙ ${(staffRoleIds?.[currentStaff.userId] ?? []).length} نقش` : '⚙ نقش‌ها'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>
          )}

          {/* ── تب ۴ استاد: لیست اساتید ── */}
          {profTab === 'list' && (
            <div className="bg-white p-4 border border-slate-400 rounded-b-md space-y-3">
              {/* فهرست استادان تنبل واکشی می‌شود — حالت بارگذاری/خطا */}
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
                    onClick={() => { staffRequestedRef.current = false; setMainView('students'); setTimeout(() => setMainView('professors'), 0); }}
                    className="shrink-0 rounded border border-amber-700 bg-white px-2 py-0.5 font-bold"
                  >
                    تلاش دوباره
                  </button>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <input
                  type="text"
                  placeholder="🔍 جستجو بر اساس کد پرسنلی، کد ملی یا نام استاد..."
                  value={staffQuery}
                  onChange={e => { setStaffQuery(e.target.value); setStaffVisible(100); }}
                  className="w-full max-w-md bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-xs"
                />
                <div className="flex items-center gap-2">
                  <select value={staffTypeFilter} onChange={e => { setStaffTypeFilter(e.target.value); setStaffVisible(100); }} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs">
                    <option value="ALL">همهٔ سمت‌ها</option>
                    <option value="EDU">استاد / هیئت علمی</option>
                    <option value="ADMIN">کارشناس / اداری</option>
                    <option value="OTHER">سایر سمت‌ها</option>
                  </select>
                  <button
                    onClick={() => { setCsf({ nc: '', fn: '', ln: '', father: '', bcn: '', gender: '', mobile: '', email: '', code: '', type: '' }); setCreateStaffMsg(''); setCreateStaffOpen(true); }}
                    className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold whitespace-nowrap"
                  >
                    ＋ استاد / کارمند جدید
                  </button>
                  <span className="text-xs text-slate-500">{filteredStaff.length} استاد و کارکن</span>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-300 rounded">
                <table className="w-full min-w-[900px] table-fixed text-right text-xs rt rt--scroll">
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
                      {STAFF_COLS.map(c => (
                        <ClientTh
                          key={c.key}
                          col={c}
                          sortKey={staffTable.sortKey}
                          sortDir={staffTable.sortDir}
                          filter={staffTable.filters[c.key] ?? ''}
                          onSort={() => staffTable.toggleSort(c.key)}
                          onFilter={v => { staffTable.setFilter(c.key, v); setStaffVisible(100); }}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStaff.slice(0, staffVisible).map((st, idx) => (
                      <tr key={st.id} className="border-b border-slate-200 hover:bg-slate-50">
                        <td className="p-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => {
                              const realIdx = staffList.findIndex(x => x.id === st.id);
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
                  <button onClick={() => setStaffVisible(v => v + 200)} className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded text-xs font-bold">
                    نمایش {Math.min(200, filteredStaff.length - staffVisible).toLocaleString('fa-IR')} نفر بعدی ({(filteredStaff.length - staffVisible).toLocaleString('fa-IR')} باقی‌مانده)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* دکمه‌های استاندارد پایین فرم استاد (Ins اضافه / F2 ذخیره / F4 ویرایش / حذف / انصراف / خروج) */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-300">
            <div className="flex items-center gap-2">
              <button onClick={() => { setCsf({ nc: '', fn: '', ln: '', father: '', bcn: '', gender: '', mobile: '', email: '', code: '', type: '' }); setCreateStaffMsg(''); setCreateStaffOpen(true); }} className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white font-bold rounded shadow flex items-center gap-1">
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

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ۳. کاشی‌ها و منوی عملیات سریع اساتید و آموزش (مطابق تصویر ۸)     */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {mainView === 'quick_menu' && (
        <div className="bg-slate-200 p-5 sm:p-8 rounded-xl border border-slate-400 shadow-xl space-y-4">
          <div className="bg-white p-3 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm">
            ⚡ کاشی‌ها و منوی میانبرهای امور اساتید و آموزش
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {/* کاشی ۱: معرفی استاد جدید */}
            <button
              onClick={() => {
                setMainView('professors');
                setProfTab('info_combined');
                setCsf({ nc: '', fn: '', ln: '', father: '', bcn: '', gender: '', mobile: '', email: '', code: '', type: '' });
                setCreateStaffMsg('');
                setCreateStaffOpen(true);
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

            {/* کاشی ۲: تغییر کلمه عبور جاری */}
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

            {/* کاشی ۳: تخصیص استاد راهنمای جمعی */}
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

            {/* کاشی ۴: ارسال پیامک به دانشجویان کلاس */}
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

            {/* کاشی ۵: مدیریت جلسات درس */}
            <Link
              href="/admin/class-sessions"
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

            {/* کاشی ۶: کاتالوگ و سرفصل رشته‌ها */}
            <Link
              href="/admin/curriculum"
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

      {/* ── مودال ثبت / اصلاح نمره (ادمین و کارشناس فارغ‌التحصیلان) ── */}
      {gradeEditModalOpen && currentStudent && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-300 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-amber-700 text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-extrabold text-sm flex items-center gap-2">
                <span>✏️</span> ثبت و اصلاح نمره (آموزش / فارغ‌التحصیلان)
              </h3>
              <button
                type="button"
                onClick={() => setGradeEditModalOpen(false)}
                className="text-amber-100 hover:text-white text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveGrade} className="p-5 space-y-4 text-xs">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1 text-slate-800">
                <p><b>دانشجو:</b> {currentStudent.firstName} {currentStudent.lastName} ({currentStudent.studentCode})</p>
                <p><b>رشته:</b> {currentStudent.majorName} — <b>مقطع:</b> {currentStudent.degreeLevel}</p>
                {gradeEditTarget?.courseTitle ? (
                  <p><b>درس:</b> {gradeEditTarget.courseTitle} (<span className="font-mono">{gradeEditTarget.courseCode}</span>) — <b>ترم:</b> <span className="font-mono">{gradeEditTarget.termCode}</span></p>
                ) : transcript && transcript.length > 0 ? (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">انتخاب درس از کارنامه:</label>
                    <select
                      className="w-full bg-white border border-slate-300 rounded p-1.5 text-xs font-mono"
                      value={gradeEditTarget?.courseCode ? `${gradeEditTarget.termCode}|${gradeEditTarget.courseCode}` : ''}
                      onChange={e => {
                        const [tCode, cCode] = e.target.value.split('|');
                        const found = transcript.find(r => r.termCode === tCode && r.courseCode === cCode);
                        if (found) {
                          setGradeEditTarget(found);
                          setGradeValueInput(found.gradeValue ?? '');
                        }
                      }}
                    >
                      {transcript.map((r, i) => (
                        <option key={i} value={`${r.termCode}|${r.courseCode}`}>
                          {r.termCode} — {r.courseCode} ({r.courseTitle}) — نمره: {r.gradeValue ?? '—'}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <p><b>نمره فعلی:</b> <span className="font-mono font-bold text-indigo-700">{gradeEditTarget?.gradeValue ?? 'ثبت نشده'}</span> ({gradeEditTarget?.gradeStatusTitle || (gradeEditTarget?.gradeStatus ? gradeStatusFa(gradeEditTarget.gradeStatus) : '—')})</p>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  نمره جدید (۰ تا ۲۰):
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="20"
                  required
                  placeholder="مثال: ۱۶.۵۰"
                  value={gradeValueInput}
                  onChange={e => setGradeValueInput(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block font-bold text-slate-700 text-xs">کد وضعیت نمره سما:</label>
                  <span className="text-2xs text-slate-500 font-mono">
                    کد فعلی: {gradeEditTarget?.gradeStatusCode || '—'} {gradeEditTarget?.gradeStatusTitle ? `(${gradeEditTarget.gradeStatusTitle})` : ''}
                  </span>
                </div>
                <select
                  value={selectedSamaCode}
                  onChange={e => setSelectedSamaCode(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                >
                  <option value="AUTO">
                    {`⚡ خودکار طبق تعریف درس و آیین‌نامه: [کد ${autoSamaCode.code || '—'}] ${autoSamaCode.title}`}
                  </option>
                  <optgroup label="انتخاب دستی کد وضعیت سما">
                    {GRADE_STATUS_CODES.map(c => (
                      <option key={c.code} value={c.code}>
                        [{c.code}] {c.title} {!c.affectsGpa ? '(بدون احتساب در معدل)' : ''}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <p className="text-3xs text-slate-500">
                  {selectedSamaCode === 'AUTO'
                    ? '💡 کد به‌صورت هوشمند ابتدا از جدول دروس (courses) و سپس طبق آیین‌نامهٔ آموزشی دانشجو حل می‌شود.'
                    : '⚠️ شما به‌صورت دستی کد وضعیت این نمره را تعیین کرده‌اید.'}
                </p>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  دلیل تغییر و مستند قانونی (الزامی):
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="مثال: حکم کمیسیون موارد خاص به شماره ۱۲۳۴ یا اصلاح نمره طبق صورتجلسه شورای آموزشی"
                  value={gradeReasonInput}
                  onChange={e => setGradeReasonInput(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              {gradeNeedsStepUp && (
                <div className="bg-indigo-50 border-2 border-indigo-400 rounded-lg p-3 space-y-2">
                  <p className="font-bold text-indigo-900">🔐 تأیید دومرحله‌ای: رمز عبور خود را وارد کنید (۱۰ دقیقه معتبر می‌ماند).</p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={gradeStepUpPw}
                      onChange={e => setGradeStepUpPw(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleStepUpConfirm(); } }}
                      placeholder="رمز عبور شما"
                      className="flex-1 bg-white border border-indigo-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      disabled={gradeStepUpBusy}
                      onClick={() => void handleStepUpConfirm()}
                      className="px-4 py-2 bg-indigo-700 hover:bg-indigo-800 disabled:bg-indigo-400 text-white font-bold rounded-lg"
                    >
                      {gradeStepUpBusy ? '…' : 'تأیید و ثبت'}
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-slate-50 border border-slate-200 rounded p-2.5 text-2xs text-slate-600 space-y-1">
                <p>🔒 <b>قوانین ممیزی:</b></p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>این عملیات مستقیماً در لاگ ممیزی نمرات (<span className="font-mono">grade_change_log</span>) با نام کاربری، نقش و زمان دقیق ثبت می‌شود.</li>
                  <li>کد وضعیت سما (<span className="font-mono">samaGradeStatusCode</span>) متناسب با حدنصاب قبولی رشته به‌طور خودکار محاسبه و درج می‌گردد.</li>
                  <li>نمره به‌صورت قطعی (<span className="font-mono">FINALIZED</span>) منظور می‌شود.</li>
                </ul>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setGradeEditModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={gradeSaving}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-bold rounded-lg transition-colors flex items-center gap-1.5"
                >
                  {gradeSaving ? 'در حال ثبت…' : '💾 ثبت نمره و لاگ ممیزی'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── مودال لاگ ممیزی تغییرات نمره (Audit Trail) ── */}
      {auditLogModalOpen && currentStudent && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full border border-slate-300 overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-slate-800 text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-extrabold text-sm flex items-center gap-2">
                <span>📜</span> تاریخچه و لاگ ممیزی نمرات (Audit Trail)
              </h3>
              <button
                type="button"
                onClick={() => setAuditLogModalOpen(false)}
                className="text-slate-300 hover:text-white text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="p-4 border-b border-slate-200 bg-slate-50 text-xs flex flex-wrap items-center justify-between gap-2">
              <p><b>دانشجو:</b> {currentStudent.firstName} {currentStudent.lastName} — <b>شماره دانشجویی:</b> <span className="font-mono">{currentStudent.studentCode}</span></p>
              <span className="text-2xs text-slate-500 font-mono">{auditLogs.length} رکورد ثبت‌شده</span>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-xs">
              {auditLogsLoading ? (
                <p className="text-center text-slate-500 py-8">در حال بارگذاری سوابق ممیزی…</p>
              ) : auditLogs.length === 0 ? (
                <p className="text-center text-slate-500 py-8 bg-slate-50 rounded-lg border border-slate-200">هیچ لاگ تغییری برای نمرات این دانشجو در سامانه ثبت نشده است.</p>
              ) : (
                <div className="border border-slate-300 rounded-lg overflow-x-auto">
                  <table className="w-full text-right text-2xs rt">
                    <thead className="bg-slate-100 border-b border-slate-300 font-bold">
                      <tr>
                        <th className="p-2">#</th>
                        <th className="p-2">تاریخ و زمان</th>
                        <th className="p-2">اقدام‌کننده</th>
                        <th className="p-2">عملیات</th>
                        <th className="p-2">درس</th>
                        <th className="p-2 text-center">نمره قبلی → جدید</th>
                        <th className="p-2 text-center">کد وضعیت سما</th>
                        <th className="p-2">دلیل ثبت‌شده</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log, idx) => (
                        <tr key={log.id || idx} className="border-b border-slate-200 hover:bg-slate-50">
                          <td className="p-2 font-mono text-slate-500">{idx + 1}</td>
                          <td className="p-2 font-mono text-slate-700" dir="ltr">
                            {log.createdAt ? new Date(log.createdAt).toLocaleString('fa-IR') : '—'}
                          </td>
                          <td className="p-2">
                            <span className="font-bold">{log.actorFirstName || log.actorLastName ? `${log.actorFirstName ?? ''} ${log.actorLastName ?? ''}`.trim() : `کاربر #${log.actorUserId ?? 'سیستم'}`}</span>
                            <span className="block text-3xs text-slate-500 font-mono">[{log.actorRole || 'SYSTEM'}]</span>
                          </td>
                          <td className="p-2">
                            <span className="px-2 py-0.5 rounded font-mono text-3xs font-bold bg-slate-200 text-slate-800">
                              {log.action}
                            </span>
                          </td>
                          <td className="p-2">
                            <span className="font-mono font-bold">{log.courseCode ?? '—'}</span>
                            <span className="block text-3xs text-slate-600 truncate max-w-[160px]" title={log.courseTitle ?? undefined}>{log.courseTitle ?? (log.termCode ? `ترم ${log.termCode}` : '—')}</span>
                            {log.termCode && <span className="block text-3xs text-slate-400 font-mono">{log.termCode}{log.termTitle ? ` — ${log.termTitle}` : ''}</span>}
                          </td>
                          <td className="p-2 text-center font-mono font-bold">
                            <span className="text-slate-500">{log.oldGradeValue ?? '—'}</span>
                            <span className="mx-1 text-slate-400">←</span>
                            <span className="text-indigo-700">{log.newGradeValue ?? '—'}</span>
                          </td>
                          <td className="p-2 text-center font-mono">
                            <span className="text-slate-500">{log.oldSamaStatusCode ?? '—'}</span>
                            <span className="mx-1 text-slate-400">←</span>
                            <span className="text-emerald-700 font-bold">{log.newSamaStatusCode ?? '—'}</span>
                          </td>
                          <td className="p-2 text-slate-700 max-w-xs truncate" title={log.reason ?? undefined}>
                            {log.reason ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <a href="/admin/grades/audit" className="text-xs font-bold text-indigo-700 hover:text-indigo-900 underline">📋 مشاهدهٔ همهٔ لاگ‌های نمرات (سراسری)</a>
              <button
                type="button"
                onClick={() => setAuditLogModalOpen(false)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition-colors"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── مودال تغییر رمز کاربر (فقط ADMIN) ── */}
      {bulkOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-300 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-slate-800 text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-extrabold text-sm">🔑 بازنشانی گروهی رمز</h3>
              <button type="button" onClick={() => setBulkOpen(false)} className="text-slate-300 hover:text-white text-lg leading-none">✕</button>
            </div>
            <form onSubmit={handleBulkReset} className="p-5 space-y-3 text-xs">
              <div className="flex items-center gap-3">
                <label className="text-slate-600 font-bold">گروه:</label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" name="bulkScope" checked={bulkScope === 'student'} onChange={() => setBulkScope('student')} className="accent-slate-800" />
                  دانشجویان (فعال وب)
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" name="bulkScope" checked={bulkScope === 'professor'} onChange={() => setBulkScope('professor')} className="accent-slate-800" />
                  اساتید (فعال وب)
                </label>
              </div>
              <div className="space-y-1.5">
                <label className="text-slate-600 font-bold block mb-1">نوع بازنشانی:</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="bulkMode" checked={bulkMode === 'national_code'} onChange={() => setBulkMode('national_code')} className="accent-red-600" />
                    <span className="font-bold text-red-700">🔄 بازنشانی به کد ملی</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="bulkMode" checked={bulkMode === 'password'} onChange={() => setBulkMode('password')} className="accent-slate-800" />
                    <span>رمز دلخواه</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="bulkMode" checked={bulkMode === 'force_change'} onChange={() => setBulkMode('force_change')} className="accent-indigo-600" />
                    <span className="font-bold text-indigo-700">🔐 فقط اجبار به تغییر رمز (بدون تغییر رمز فعلی)</span>
                  </label>
                </div>
              </div>
              {bulkMode === 'force_change' ? (
                <div className="rounded-lg bg-indigo-50 border border-indigo-300 p-3 text-indigo-800 leading-relaxed">
                  <b>🔐 اجبار به تغییر رمز</b>
                  <p className="text-3xs mt-1">رمز هیچ حسابی عوض نمی‌شود؛ همهٔ حساب‌های فعال این گروه در ورود بعدی ملزم به تعیین رمز جدید خواهند بود.</p>
                </div>
              ) : bulkMode === 'password' ? (
                <div>
                  <label className="text-slate-600 font-bold block mb-1">رمز جدید (۱۰ تا ۱۲۸ کاراکتر):</label>
                  <input
                    type="text"
                    required
                    minLength={10}
                    maxLength={128}
                    dir="ltr"
                    placeholder="رمز جدید همهٔ این گروه"
                    value={bulkPass}
                    onChange={e => setBulkPass(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-slate-500 focus:outline-none"
                  />
                </div>
              ) : (
                <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-amber-800 leading-relaxed">
                  <b>⚠ بازنشانی به کد ملی</b>
                  <p className="text-3xs mt-1">رمز همهٔ حساب‌های این گروه به <b>کد ملی</b> خودشان تغییر می‌کند. در اولین ورود ملزم به تغییر رمز خواهند بود.</p>
                </div>
              )}
              <label className="flex items-center gap-1.5 cursor-pointer pt-1">
                <input type="checkbox" checked={bulkBackfill} onChange={e => setBulkBackfill(e.target.checked)} className="w-4 h-4 accent-slate-800 rounded" />
                <span>همچنین نقش‌های جاافتادهٔ همهٔ حساب‌ها را بساز (ترمیم norole)</span>
              </label>
              <p className="text-3xs text-slate-500">این عملیات بی‌بازگشت است؛ رمز جاری همهٔ حساب‌های این گروه باطل می‌شود.</p>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button type="button" onClick={() => setBulkOpen(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg">انصراف</button>
                <button type="submit" disabled={bulkSaving} className="px-5 py-2 bg-red-700 hover:bg-red-800 disabled:bg-slate-400 text-white font-bold rounded-lg">
                  {bulkSaving ? 'در حال اجرا…' : '⚠ اعمال به همه'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {roleModalFor && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-300 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-slate-800 text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-extrabold text-sm">⚙ نقش‌های «{roleModalFor.name}»</h3>
              <button type="button" onClick={() => setRoleModalFor(null)} className="text-slate-300 hover:text-white text-lg leading-none">✕</button>
            </div>
            <form onSubmit={handleSaveRoles} className="p-5 space-y-3 text-xs">
              <p className="text-[10.5px] text-slate-500 leading-relaxed">
                نقش‌های تعریف‌شده را تیک بزنید/بردارید (کارشناس مالی، کارشناس آموزش، مدیر گروه، …). برای تعریف نقش جدید به صفحهٔ{' '}
                <a href="/admin/permissions" className="font-bold text-indigo-700 underline">مدیریت سطوح دسترسی و نقش‌ها</a> بروید.
              </p>
              {props.rolesAll && props.rolesAll.length > 0 ? (
                <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {props.rolesAll.map(r => (
                    <label key={r.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={roleSel.has(r.id)}
                        onChange={e => {
                          const next = new Set(roleSel);
                          if (e.target.checked) next.add(r.id); else next.delete(r.id);
                          setRoleSel(next);
                        }}
                        className="accent-indigo-600"
                      />
                      <span className="font-bold flex-1">{roleTitle(r)}</span>
                      <span className="font-mono text-3xs text-slate-400" dir="ltr">{r.code}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-amber-800 leading-relaxed">
                  هنوز نقشی تعریف نشده است. ابتدا در{' '}
                  <a href="/admin/permissions" className="font-bold underline">مدیریت سطوح دسترسی و نقش‌ها</a> نقش‌های موردنیاز مثل «کارشناس مالی» و «کارشناس آموزش» را بسازید، بعد همین‌جا تخصیص دهید.
                </div>
              )}
              {roleMsg && <p className="text-xs font-bold break-words">{roleMsg}</p>}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button type="button" onClick={() => setRoleModalFor(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg">انصراف</button>
                <button type="submit" disabled={roleSaving} className="px-5 py-2 bg-indigo-700 hover:bg-indigo-800 disabled:bg-slate-400 text-white font-bold rounded-lg">
                  {roleSaving ? 'در حال ثبت…' : '💾 ثبت نقش‌ها'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {createStaffOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-300 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-slate-800 text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-extrabold text-sm">＋ ثبت استاد / کارمند جدید</h3>
              <button type="button" onClick={() => setCreateStaffOpen(false)} className="text-slate-300 hover:text-white text-lg leading-none">✕</button>
            </div>
            <form onSubmit={handleCreateStaff} className="p-5 space-y-3 text-xs">
              <p className="text-[10.5px] text-slate-500 leading-relaxed">
                حساب کاربری ساخته می‌شود (ورود اولیه با <b>کد ملی</b> + تغییر اجباری رمز). پس از ثبت، از <b>ستون «نقش‌ها»</b> در همین صفحه یا صفحهٔ استاد و کارکنان، تخصص هر کارشناس را تعیین کنید.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-red-700 font-bold">* کد ملی</span>
                  <input dir="ltr" value={csf.nc} onChange={e => setCsf({ ...csf, nc: e.target.value })} required className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono focus:ring-2 focus:ring-slate-500 focus:outline-none" placeholder="۱۰ رقم" />
                </label>
                <label className="block">
                  <span className="text-indigo-900 font-bold">* نام</span>
                  <input value={csf.fn} onChange={e => setCsf({ ...csf, fn: e.target.value })} required className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-500 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="text-indigo-900 font-bold">* نام خانوادگی</span>
                  <input value={csf.ln} onChange={e => setCsf({ ...csf, ln: e.target.value })} required className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-500 focus:outline-none" />
                </label>
                <label className="block">
                  <span>نام پدر</span>
                  <input value={csf.father} onChange={e => setCsf({ ...csf, father: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-500 focus:outline-none" />
                </label>
                <label className="block">
                  <span>شماره شناسنامه</span>
                  <input value={csf.bcn} onChange={e => setCsf({ ...csf, bcn: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-500 focus:outline-none" />
                </label>
                <label className="block">
                  <span>جنسیت</span>
                  <select value={csf.gender} onChange={e => setCsf({ ...csf, gender: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-500 focus:outline-none">
                    <option value="">—</option>
                    <option>مرد</option>
                    <option>زن</option>
                  </select>
                </label>
                <label className="block">
                  <span>موبایل</span>
                  <input dir="ltr" value={csf.mobile} onChange={e => setCsf({ ...csf, mobile: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono focus:ring-2 focus:ring-slate-500 focus:outline-none" />
                </label>
                <label className="block">
                  <span>ایمیل</span>
                  <input dir="ltr" value={csf.email} onChange={e => setCsf({ ...csf, email: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono focus:ring-2 focus:ring-slate-500 focus:outline-none" />
                </label>
                <label className="block">
                  <span>کد پرسنلی</span>
                  <input dir="ltr" value={csf.code} onChange={e => setCsf({ ...csf, code: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono focus:ring-2 focus:ring-slate-500 focus:outline-none" placeholder="پیش‌فرض: کد ملی" />
                </label>
                <label className="block">
                  <span>نوع سمت</span>
                  <select value={csf.type} onChange={e => setCsf({ ...csf, type: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-500 focus:outline-none">
                    <option value="اداری">اداری / کارشناس</option>
                    <option value="هیئت علمی">استاد / هیئت علمی</option>
                    <option value="هیئت علمی-اداری">استاد و کارمند اداری (هیئت علمی + اداری)</option>
                    <option value="مربی">مربی</option>
                  </select>
                </label>
              </div>
              {createStaffMsg && <p className="text-xs font-bold leading-relaxed break-words">{createStaffMsg}</p>}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button type="button" onClick={() => setCreateStaffOpen(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg">انصراف</button>
                <button type="submit" disabled={createStaffBusy} className="px-5 py-2 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-lg">
                  {createStaffBusy ? 'در حال ثبت…' : '＋ ثبت حساب جدید'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pwModalFor && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-300 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-slate-800 text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-extrabold text-sm">🔑 تغییر رمز «{pwModalFor.name}»</h3>
              <button type="button" onClick={() => setPwModalFor(null)} className="text-slate-300 hover:text-white text-lg leading-none">✕</button>
            </div>
            <form onSubmit={handleResetPassword} className="p-5 space-y-3 text-xs">
              <p className="text-slate-600">رمز جدید را وارد کنید (۱۰ تا ۱۲۸ کاراکتر). کاربر در اولین ورود ملزم به تغییر رمز می‌شود.</p>
              <input
                type="text"
                required
                minLength={10}
                maxLength={128}
                dir="ltr"
                placeholder="رمز جدید"
                value={pwInput}
                onChange={e => setPwInput(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-slate-500 focus:outline-none"
              />
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button type="button" onClick={() => setPwModalFor(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg">انصراف</button>
                <button type="submit" disabled={pwSaving} className="px-5 py-2 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-lg">
                  {pwSaving ? 'در حال ثبت…' : '💾 ثبت رمز جدید'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
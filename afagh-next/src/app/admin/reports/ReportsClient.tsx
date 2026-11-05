'use client';

import { useEffect, useState } from 'react';
import { exportReport, runReport, type FilterOptions, type ReportResult } from './actions';
import { LINK_CARDS } from './report-links';
import { faIncludes } from '@/lib/persian-search';
import { faNum, formatReportCell as fmtCell } from '@/lib/report-format';
import ReportPrint from '@/components/ui/ReportPrint';

/** ارقام لاتین → فارسی (بدون تبدیل عدد) */
type ReportCat = 'students' | 'probation' | 'program' | 'exams' | 'classes' | 'finance' | 'research';

type Card = { kind: string; icon: string; title: string; cat: ReportCat; needsTerm?: boolean; soon?: boolean; customs?: { key: string; title: string }[] };

const CATEGORIES: { key: ReportCat; label: string }[] = [
  { key: 'students', label: '🧑‍🎓 دانشجویی و فهرست' },
  { key: 'probation', label: '⚠️ مشروطی و آیین‌نامه' },
  { key: 'program', label: '🗓️ برنامه و نمره' },
  { key: 'exams', label: '📝 امتحانات' },
  { key: 'classes', label: '🏫 کلاس‌ها' },
  { key: 'finance', label: '💰 مالی' },
  { key: 'research', label: '🎓 پژوهش و مکاتبات' },
];

const CARDS: Card[] = [
  { kind: 'active-term', cat: 'students', icon: '🧑‍🎓', title: 'گزارش دانشجویان فعال ترم', needsTerm: true },
  { kind: 'status-summary', cat: 'students', icon: '📊', title: 'گزارش خلاصه وضعیت تحصیلی' },
  { kind: 'by-faculty', cat: 'students', icon: '🏛️', title: 'گزارش به تفکیک دانشکده' },
  { kind: 'by-major', cat: 'students', icon: '📚', title: 'گزارش دانشجویان هر رشته' },
  { kind: 'grade-status', cat: 'students', icon: '📝', title: 'دانشجویان برحسب وضعیت نمره', needsTerm: true },
  { kind: 'probation', cat: 'probation', icon: '⚠️', title: 'مشروطی‌های ترم', needsTerm: true },
  { kind: 'top', cat: 'program', icon: '🏆', title: 'گزارش نمرات برتر هر رشته' },
  { kind: 'incomplete', cat: 'students', icon: '📋', title: 'تکمیلی دانشجویان (پرونده ناقص)' },
  { kind: 'graduates', cat: 'research', icon: '🎓', title: 'دانش‌آموختگان' },
  { kind: 'entries', cat: 'students', icon: '📥', title: 'ورودی‌های جدید' },
  { kind: 'noshow', cat: 'students', icon: '🚫', title: 'عدم مراجعه‌ها' },
  { kind: 'transfers', cat: 'students', icon: '🔀', title: 'میهمان / انتقالی' },
  { kind: 'tuition', cat: 'finance', icon: '💰', title: 'گزارش شهریه / تراکنش مالی', needsTerm: true },
  { kind: 'payesh', cat: 'research', icon: '🗂️', title: 'گزارش پاسخ‌های طرح پایش' },
  { kind: 'jame', cat: 'research', icon: '🧮', title: 'دانشجویان واجد شرایط آزمون جامع' },
  { kind: 'docs', cat: 'research', icon: '📎', title: 'مدارک دانشجویان' },

  // ── موج ۲: ۵۰ گزارش خانواده‌ها (منطق در r-*.ts) ──
  // آموزشی/مشروطی
  { kind: 'probation-violations', cat: 'probation', icon: '⚠️', title: 'تخلفات مشروطی', needsTerm: true },
  { kind: 'probation-chains', cat: 'probation', icon: '🔗', title: 'مشروطی متناوب و متوالی', needsTerm: true },
  { kind: 'unit-cap-violations', cat: 'probation', icon: '📏', title: 'عدم رعایت سقف و کف واحد', needsTerm: true },
  { kind: 'repeated-courses', cat: 'probation', icon: '🔁', title: 'دروس چندبار اخذشده' },
  // آموزشی/برنامه و نمره
  { kind: 'student-weekly-conflicts', cat: 'program', icon: '🗓', title: 'تداخل برنامه هفتگی دانشجویان', needsTerm: true },
  { kind: 'student-exam-conflicts', cat: 'program', icon: '📝', title: 'تداخل برنامه امتحانی', needsTerm: true },
  { kind: 'prereq-violations', cat: 'probation', icon: '⛓', title: 'عدم رعایت پیش‌نیاز/هم‌نیاز', needsTerm: true },
  { kind: 'course-grade-status', cat: 'probation', icon: '📋', title: 'وضعیت درس و نمره', needsTerm: true, customs: [{ key: 'gradeStatus', title: 'وضع نمره' }, { key: 'samaCode', title: 'کد سما' }] },
  { kind: 'enrollment-pick', cat: 'program', icon: '🧾', title: 'انتخاب واحد دانشجویان', needsTerm: true },
  // آموزشی/فهرست
  { kind: 'offered-course-roster', cat: 'program', icon: '👥', title: 'دانشجویان درس ارائه‌شده', needsTerm: true },
  { kind: 'top-students', cat: 'program', icon: '🏆', title: 'نفرات برتر (معدل کل)' },
  { kind: 'no-photo', cat: 'students', icon: '📷', title: 'دانشجویان فاقد عکس' },
  { kind: 'graduates-info', cat: 'research', icon: '🎓', title: 'اطلاعات دانش‌آموختگان' },
  // وضعیت و عملیات
  { kind: 'status-report', cat: 'students', icon: '📊', title: 'وضعیت دانشجویان' },
  { kind: 'major-change-report', cat: 'students', icon: '🔀', title: 'تغییر رشته' },
  { kind: 'status-change-report', cat: 'students', icon: '🔄', title: 'تغییر وضعیت' },
  { kind: 'gpa-refresh-preview', cat: 'program', icon: '🧮', title: 'به‌روزرسانی معدل نیمسال' },
  { kind: 'profile-refresh', cat: 'program', icon: '👤', title: 'به‌روزرسانی نیمرخ تحصیلی' },
  { kind: 'portal-export', cat: 'program', icon: '📡', title: 'ارسال به پرتال' },
  // امتحانات
  { kind: 'exam-session-sheet', cat: 'exams', icon: '📄', title: 'صورت‌جلسه امتحان', needsTerm: true },
  { kind: 'seat-numbers', cat: 'exams', icon: '💺', title: 'شماره صندلی', needsTerm: true },
  { kind: 'final-exam-schedule', cat: 'exams', icon: '🗓', title: 'برنامه امتحانات پایان ترم', needsTerm: true },
  { kind: 'grade-entry-report', cat: 'exams', icon: '✍️', title: 'ثبت نمره استادان', needsTerm: true },
  { kind: 'grade-deadline', cat: 'exams', icon: '⏰', title: 'زمان‌بندی ثبت نمرات', needsTerm: true },
  // کلاس‌ها
  { kind: 'empty-rooms', cat: 'classes', icon: '🏚', title: 'کلاس‌های خالی', needsTerm: true },
  { kind: 'weekly-timetable', cat: 'classes', icon: '🗓', title: 'برنامه هفتگی کلاس‌ها', needsTerm: true },
  { kind: 'room-conflicts', cat: 'classes', icon: '⚠️', title: 'تداخل برنامه کلاس‌ها', needsTerm: true },
  { kind: 'low-enrollment', cat: 'classes', icon: '📉', title: 'ظرفیت به حدنصاب نرسیده', needsTerm: true },
  { kind: 'makeup-courses', cat: 'classes', icon: '🩹', title: 'دروس جبرانی/پیش‌دانشگاهی' },
  // اساتید
  { kind: 'staff-list', cat: 'classes', icon: '👨‍🏫', title: 'اساتید', needsTerm: true },
  { kind: 'staff-courses', cat: 'classes', icon: '📚', title: 'استادان مدرس دروس', needsTerm: true },
  { kind: 'staff-timetable', cat: 'classes', icon: '🗓', title: 'برنامه هفتگی اساتید', needsTerm: true },
  // تشکیل کلاس استادان — معیار: ثبتِ حضور استاد برای جلسه (professor_class_attendance)
  { kind: 'prof-formation-summary', cat: 'classes', icon: '📊', title: 'تشکیل کلاس استادان (خلاصه)', needsTerm: true },
  { kind: 'prof-formation-detail', cat: 'classes', icon: '📚', title: 'تشکیل کلاس استادان (به تفکیک درس)', needsTerm: true },
  { kind: 'prof-formation-none', cat: 'classes', icon: '🚫', title: 'استادان بدون جلسهٔ تشکیل‌شده', needsTerm: true },
  { kind: 'prof-sessions-unformed', cat: 'classes', icon: '⏳', title: 'جلسات تشکیل‌نشده', needsTerm: true, customs: [{ key: 'dateFrom', title: 'از تاریخ' }, { key: 'dateTo', title: 'تا تاریخ' }] },
  { kind: 'attendance-list', cat: 'classes', icon: '📝', title: 'حضور و غیاب', needsTerm: true },
  // مالی
  { kind: 'tuition-tariff', cat: 'finance', icon: '💰', title: 'تعرفه تحصیلی', needsTerm: true },
  { kind: 'tuition-statement', cat: 'finance', icon: '🧾', title: 'صورت‌حساب شهریه', needsTerm: true },
  // ── گزارش‌های پرداختی (هم‌ریخت با اسناد رسمی سما) ──
  { kind: 'total-payments', cat: 'finance', icon: '📊', title: 'گزارش کل پرداختی دانشجویان' },
  { kind: 'student-payments', cat: 'finance', icon: '🧾', title: 'گزارش پرداختی دانشجویان (تفصیلی)', needsTerm: true },
  { kind: 'term-payments', cat: 'finance', icon: '💳', title: 'گزارش مبلغ پرداختی نیمسال', needsTerm: true },
  { kind: 'accounting-voucher', cat: 'finance', icon: '📑', title: 'سند حسابداری (دفتر روزنامه)', needsTerm: true, customs: [{ key: 'voucherNo', title: 'شماره سند' }] },
  { kind: 'term-financial', cat: 'finance', icon: '📈', title: 'گزارش مالی نیمسال (تجمیعی)', needsTerm: true },
  { kind: 'tuition-overview', cat: 'finance', icon: '🧮', title: 'مدیریت کلان وضعیت شهریه (هر دانشجو)', needsTerm: true },
  { kind: 'tuition-faculty-detail', cat: 'finance', icon: '🏛️', title: 'تفصیلی مالی (دانشکده × مقطع)', needsTerm: true },
  { kind: 'faculty-financial', cat: 'finance', icon: '🏢', title: 'گزارش مالی دانشکده‌ها', needsTerm: true },
  { kind: 'major-financial', cat: 'finance', icon: '📚', title: 'گزارش مالی نیمسال (مقطع × رشته)', needsTerm: true },
  // پژوهش
  { kind: 'proposal-cap', cat: 'research', icon: '🎓', title: 'ظرفیت پروپوزال استادان', soon: true },
  { kind: 'pending-requests', cat: 'research', icon: '⏳', title: 'درخواست‌های درانتظار' },
  { kind: 'defenses', cat: 'research', icon: '🎤', title: 'لیست دفاعیات' },
  { kind: 'proposals', cat: 'research', icon: '📄', title: 'پروپوزال' },
  { kind: 'seminars', cat: 'research', icon: '💬', title: 'سمینار', soon: true },
  // شورا و مکاتبات
  { kind: 'council-edu', cat: 'research', icon: '🏛', title: 'شورای آموزشی', needsTerm: true },
  { kind: 'discipline', cat: 'research', icon: '⚖', title: 'کمیته انضباطی', soon: true },
  { kind: 'letter-templates', cat: 'research', icon: '📄', title: 'قالب‌های مکاتبات' },
  { kind: 'transcript-card', cat: 'exams', icon: '🎓', title: 'کارنامه دانشجویان' },
  { kind: 'exam-entry-card', cat: 'exams', icon: '🎟', title: 'کارت ورود به جلسه', needsTerm: true },
  { kind: 'student-card', cat: 'research', icon: '🪪', title: 'کارت دانشجویی' },
  { kind: 'study-cert', cat: 'research', icon: '📜', title: 'گواهی اشتغال به تحصیل' },
  { kind: 'edu-confirm', cat: 'research', icon: '✅', title: 'تاییدیه تحصیلی' },
  { kind: 'grad-cert', cat: 'research', icon: '🎓', title: 'گواهی پایان تحصیلات' },
  { kind: 'military-defer', cat: 'research', icon: '🎖', title: 'معافیت تحصیلی' },
  { kind: 'finance-worklist', cat: 'finance', icon: '🗂️', title: 'کارتابل مالی (مانده دانشجویان)', customs: [{ key: 'onlyDebtors', title: 'فقط بدهکار (1)' }] },
  { kind: 'payroll-overview', cat: 'finance', icon: '💵', title: 'حق‌التدریس اساتید', needsTerm: true },
  { kind: 'bi-teaching-quality', cat: 'finance', icon: '🎯', title: 'کیفیت تدریس اساتید (BI)' },
  { kind: 'bi-facilities', cat: 'finance', icon: '🏫', title: 'امکانات کلاس‌ها (BI)' },
  { kind: 'graduation-dossiers', cat: 'research', icon: '🎓', title: 'پرونده‌های فراغت‌التحصیل', customs: [{ key: 'dossierStatus', title: 'وضعیت (کد)' }] },
  { kind: 'grade-audit-log', cat: 'program', icon: '📜', title: 'لاگ تغییرات نمرات', needsTerm: true },
  { kind: 'third-attempt', cat: 'probation', icon: '🔁', title: 'دروس بار سوم (مردودی دو بار)', needsTerm: true },
];

const NEW_KINDS = new Set(['finance-worklist', 'payroll-overview', 'bi-teaching-quality', 'bi-facilities', 'graduation-dossiers', 'grade-audit-log', 'probation-violations', 'probation-chains', 'unit-cap-violations', 'repeated-courses', 'student-weekly-conflicts', 'student-exam-conflicts', 'prereq-violations', 'course-grade-status', 'enrollment-pick', 'offered-course-roster', 'top-students', 'no-photo', 'graduates-info', 'status-report', 'major-change-report', 'status-change-report', 'gpa-refresh-preview', 'profile-refresh', 'portal-export', 'exam-session-sheet', 'seat-numbers', 'final-exam-schedule', 'grade-entry-report', 'grade-deadline', 'empty-rooms', 'weekly-timetable', 'room-conflicts', 'low-enrollment', 'makeup-courses', 'staff-list', 'staff-courses', 'staff-timetable', 'attendance-list', 'tuition-tariff', 'tuition-statement', 'pending-requests', 'defenses', 'proposals', 'council-edu', 'letter-templates', 'transcript-card', 'exam-entry-card', 'student-card', 'study-cert', 'edu-confirm', 'grad-cert', 'military-defer']);

export default function ReportsClient({ opts, initialUniversityId, allowedKinds, scope = 'all', initialKind, initialTerm, initialExtra }: { opts: FilterOptions; initialUniversityId?: number; allowedKinds?: string[] | null; scope?: 'all' | 'edu' | 'finance'; initialKind?: string; initialTerm?: string; initialExtra?: Record<string, string> }) {
  const [kind, setKind] = useState<string>(initialKind ?? 'active-term');
  const [cat, setCat] = useState<ReportCat | undefined>(undefined);
  const [search, setSearch] = useState('');
  const initialTermCodes = (initialTerm ?? '').split(/[,،\s]+/).map(s => s.trim()).filter(Boolean);
  const [term, setTerm] = useState(initialTermCodes[0] || opts.latestTerm);
  /** حالت فیلتر ترم: یک ترم / چند ترم / همهٔ ترمها (بدون فیلتر) */
  const [termMode, setTermMode] = useState<'one' | 'many' | 'all'>(initialTermCodes.length > 1 ? 'many' : 'one');
  const [manyTerms, setManyTerms] = useState<string[]>(initialTermCodes.length > 1 ? initialTermCodes : []);
  const [degreeId, setDegreeId] = useState(0);
  const [facultyId, setFacultyId] = useState(0);
  const [departmentId, setDepartmentId] = useState(0);
  const [majorId, setMajorId] = useState(0);
  const [entryYear, setEntryYear] = useState(0);
  const [q, setQ] = useState('');
  const [nationalCode, setNationalCode] = useState('');
  const [miss, setMiss] = useState('national');
  /** وضعیت تحصیلی: ALL = همه، وگرنه کد دقیق (ACTIVE/GRADUATED/…) */
  const [status, setStatus] = useState('ALL');
  /** دامنه: all = کل دوره، term = فقط نیمسالِ انتخاب‌شده */
  const [scopeMode, setScopeMode] = useState<'all' | 'term'>('all');
  const [universityId, setUniversityId] = useState(initialUniversityId ?? 0);
  const [extra, setExtra] = useState<Record<string, string>>(initialExtra ?? {});
  const [res, setRes] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState('');
  const [showLinks, setShowLinks] = useState(false);

  // ── محدودسازی بر اساس مرکز (scope) + مجوزها ──
  const scopeFiltered = CARDS.filter(c =>
    scope === 'finance' ? c.cat === 'finance' : scope === 'edu' ? c.cat !== 'finance' : true,
  );
  const visibleCards = allowedKinds ? scopeFiltered.filter(c => allowedKinds.includes(c.kind)) : scopeFiltered;
  const tabKeys = CATEGORIES.map(c => c.key).filter(k => visibleCards.some(c => c.cat === k));
  const activeCat = cat && tabKeys.includes(cat) ? cat : tabKeys[0];
  const searchedCards = search.trim() ? visibleCards.filter(c => faIncludes(c.title, search) || faIncludes(c.kind, search)) : visibleCards;
  const gridCards = activeCat ? searchedCards.filter(c => c.cat === activeCat) : searchedCards;

  const card = visibleCards.find(c => c.kind === kind);
  /**
   * گزارش‌های سطح درس/سالن/استاد: فیلترهای دانشجویی (مقطع/دانشکده/گروه/رشته/ورودی/کدملی)
   * برایشان معنا ندارد؛ پس در UI هم نمایش داده نمی‌شوند تا کاربر فیلتری نزند که
   * بی‌اثر است (به‌جای نشان‌دادن و نادیده‌گرفتن).
   */
  const COURSE_LEVEL_KINDS = new Set([
    'weekly-timetable', 'room-conflicts', 'empty-rooms', 'low-enrollment', 'makeup-courses',
    'staff-list', 'staff-courses', 'staff-timetable', 'payesh',
    'prof-formation-summary', 'prof-formation-detail', 'prof-formation-none', 'prof-sessions-unformed',
    'tuition-tariff', 'letter-templates', 'payroll-overview', 'bi-teaching-quality',
    'bi-facilities', 'graduation-dossiers', 'grade-audit-log',
  ]);
  const showStudentFilters = !COURSE_LEVEL_KINDS.has(kind);
  useEffect(() => {
    if (!visibleCards.some(c => c.kind === kind)) setKind(visibleCards[0]?.kind ?? 'active-term');
    if (cat && !visibleCards.some(c => c.cat === cat)) setCat(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedKinds, scope]);
  // «همهٔ ترمها» = term خالی (همهٔ ماژولهای r-*.ts آن را «بدون فیلتر» میگیرند)؛
  // «چند ترم» = فهرست کدها در f.terms، سرور آنها را جدا اجرا و ادغام میکند.
  const effectiveTerm = termMode === 'all' ? '' : termMode === 'many' ? (manyTerms[0] ?? '') : term;
  const multiTerms = termMode === 'many' ? manyTerms.join(',') : undefined;
  const filters = { term: effectiveTerm, terms: multiTerms, degreeId, facultyId, departmentId, majorId, entryYear, q: q.trim(), nationalCode: nationalCode.trim(), miss, page: 1, universityId, status, scope: scopeMode, ...extra };

  const run = async (page = 1, kindOverride?: string) => {
    const k = kindOverride ?? kind;
    if (termMode === 'many' && manyTerms.length === 0 && page === 1) {
      setErr('دستکم یک ترم انتخاب کنید، یا حالت «همهٔ ترمها» را بزنید.');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      setRes(await runReport(k, { ...filters, page }));
      setTimeout(() => {
        document.getElementById('report-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'خطای نامشخص در اجرای گزارش');
    } finally {
      setLoading(false);
    }
  };

  /**
   * انتخاب کارت گزارش = **فقط انتخاب**؛ هیچ درخواستی به سرور نمی‌رود.
   *
   * چرا: کاربر باید پیش از اجرا بتواند ترم/مقطع/دانشکده/رشته/وضعیت/دامنه و
   * جست‌وجو را تنظیم کند. نسخهٔ قبل با `void run(1, k)` بلافاصله شروع به
   * لود می‌کرد (و هنگام ورود با `?kind=...` یک `useEffect` هم اجرای خودکار
   * داشت)، یعنی فیلترها عملاً بعد از اجرا تعریف می‌شدند و نتیجهٔ اول بیهوده
   * بود. اجرا فقط با دکمهٔ صریح «▶ اجرای گزارش» (یا Enter در جست‌وجو)
   * انجام می‌شود.
   */
  const pick = (k: string) => {
    setKind(k);
    setRes(null);
    setErr('');
  };

  const doExport = async () => {
    setExporting(true);
    setErr('');
    try {
      const { header, lines } = await exportReport(kind, { ...filters, page: 1 });
      // گارد تزریق فرمول CSV: مقادیر شروع‌شونده با = + - @ | تب/CR با ' خنثی می‌شوند
      const esc = (v: string) => {
        const s = /^[=+\-@|\t\r]/.test(v.trimStart()) ? `'${v}` : v;
        return `"${s.replace(/"/g, '""')}"`;
      };
      // خروجی در سرور با همان `format` ستون‌ها قالب‌بندی شده است (تاریخ شمسی/مبلغ)
      const csv = '﻿' + [header.map(esc).join(','), ...lines.map(l => l.map(esc).join(','))].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `report-${kind}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'خطای نامشخص در خروجی');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* زیرعنوان مرکز مالی */}
      {scope === 'finance' && (
        <p className="text-xs font-extrabold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">مرکز گزارش‌های مالی</p>
      )}

      {/* نوار دسته‌بندی (تب‌ها) */}
      {tabKeys.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORIES
            .filter(c => (scope === 'finance' ? c.key === 'finance' : scope === 'edu' ? c.key !== 'finance' : true) && tabKeys.includes(c.key))
            .map(c => (
              <button
                key={c.key}
                onClick={() => setCat(c.key)}
                className={`px-3 py-1.5 rounded-full border-2 text-xs font-bold transition-all shadow-sm
                  ${activeCat === c.key
                    ? 'bg-indigo-600 border-indigo-700 text-white shadow-md'
                    : 'bg-white border-slate-300 text-slate-600 hover:border-indigo-300 hover:shadow'}`}
              >
                {c.label}
              </button>
            ))}
        </div>
      )}

      {/* جست‌وجوی گزارش‌ها */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={`🔍 جست‌وجو در گزارش‌ها (نام یا کد)… (${visibleCards.length} گزارش)`}
        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
      />

      {/* کارت‌های گزارش دستهٔ فعال */}
      {gridCards.length === 0 ? (
        <p className="p-6 text-center text-slate-500 text-sm bg-white border border-slate-300 rounded-xl shadow-sm">گزارشی با این عبارت یا در این دسته یافت نشد.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {gridCards.map(c => (
            <button
              key={c.kind}
              disabled={c.soon}
              onClick={() => pick(c.kind)}
              className={`flex items-center gap-2 p-3 rounded-lg border-2 text-right font-bold text-[13px] transition-all shadow-sm
                ${c.soon
                  ? 'bg-stone-100 border-stone-200 text-stone-400 cursor-not-allowed'
                  : kind === c.kind
                    ? 'bg-indigo-50 border-indigo-500 text-indigo-950 shadow-md'
                    : 'bg-gradient-to-b from-white to-slate-100 border-slate-300 text-slate-700 hover:border-indigo-300 hover:shadow'}`}
            >
              <span className="text-2xl">{c.icon}</span>
              <span>{c.title}{c.soon && <span className="block text-3xs font-normal">به‌زودی</span>}</span>
            </button>
          ))}
        </div>
      )}

      {/* نوار فیلتر */}
      {!card?.soon && (
        <div className="bg-white border border-slate-300 rounded-xl p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {opts.universities.length > 1 && (
              <label className="flex items-center gap-1">
                <span className="font-bold text-slate-600">دانشگاه:</span>
                <select value={universityId} onChange={e => setUniversityId(Number(e.target.value))} className="bg-indigo-50 border border-indigo-300 rounded px-2 py-1.5 font-bold">
                  <option value={0}>همه</option>
                  {opts.universities.map(u => <option key={u.id} value={u.id}>{u.title}{u.kind === 'DISSOLVED' ? ' (منحله)' : ''}</option>)}
                </select>
              </label>
            )}
            {card?.needsTerm && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-bold text-slate-600">ترم:</span>
                <select
                  value={termMode}
                  onChange={e => setTermMode(e.target.value === 'many' ? 'many' : e.target.value === 'all' ? 'all' : 'one')}
                  className="bg-indigo-50 border border-indigo-300 rounded px-2 py-1.5 font-bold"
                  title="یک ترم، چند ترم بهصورت همزمان، یا همهٔ ترمها بدون فیلتر"
                >
                  <option value="one">یک ترم</option>
                  <option value="many">چند ترم…</option>
                  <option value="all">همهٔ ترمها</option>
                </select>
                {termMode === 'one' && (
                  <select value={term} onChange={e => setTerm(e.target.value)} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 font-mono" dir="ltr">
                    {opts.terms.map(t => <option key={t.code} value={t.code}>{t.code}</option>)}
                  </select>
                )}
                {termMode === 'many' && (
                  <div className="w-full flex flex-wrap items-center gap-1.5 rounded border border-slate-200 bg-slate-50 p-2 max-h-28 overflow-y-auto">
                    <button type="button" onClick={() => setManyTerms(opts.terms.map(t => t.code))} className="px-2 py-1 bg-white border border-slate-300 rounded font-bold text-2xs">انتخاب همه</button>
                    <button type="button" onClick={() => setManyTerms([])} className="px-2 py-1 bg-white border border-slate-300 rounded font-bold text-2xs">پاک کردن</button>
                    {opts.terms.map(t => (
                      <label key={t.code} className="flex items-center gap-1 px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-2xs" dir="ltr">
                        <input
                          type="checkbox"
                          checked={manyTerms.includes(t.code)}
                          onChange={e => setManyTerms(prev => e.target.checked ? [...prev, t.code] : prev.filter(x => x !== t.code))}
                        />
                        {t.title || t.code} ({t.code})
                      </label>
                    ))}
                    <span className="font-extrabold text-indigo-700 text-2xs">{faNum(manyTerms.length)} ترم انتخاب شد</span>
                  </div>
                )}
              </div>
            )}
            <label className="flex items-center gap-1">
              <span className="font-bold text-slate-600">مقطع:</span>
              <select value={degreeId} onChange={e => setDegreeId(Number(e.target.value))} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 max-w-44">
                <option value={0}>همه</option>
                {opts.degrees.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </label>
            {showStudentFilters && (
              <label className="flex items-center gap-1">
                <span className="font-bold text-slate-600">دانشکده:</span>
                <select value={facultyId} onChange={e => setFacultyId(Number(e.target.value))} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 max-w-44">
                  <option value={0}>همه</option>
                  {opts.faculties.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            )}
            {showStudentFilters && (
              <label className="flex items-center gap-1">
                <span className="font-bold text-slate-600">گروه آموزشی:</span>
                <select value={departmentId} onChange={e => setDepartmentId(Number(e.target.value))} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 max-w-44">
                  <option value={0}>همه</option>
                  {opts.departments.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            )}
            {showStudentFilters && (
              <label className="flex items-center gap-1">
                <span className="font-bold text-slate-600">رشته:</span>
                <select value={majorId} onChange={e => setMajorId(Number(e.target.value))} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 max-w-52">
                  <option value={0}>همه</option>
                  {opts.majors.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            )}
            {showStudentFilters && (
              <label className="flex items-center gap-1">
                <span className="font-bold text-slate-600">ورودی:</span>
                <select value={entryYear} onChange={e => setEntryYear(Number(e.target.value))} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 font-mono" dir="ltr">
                  <option value={0}>همه</option>
                  {opts.entryYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            )}
            {kind === 'top-students' && (
              <>
                <label className="flex items-center gap-1">
                  <span className="font-bold text-slate-600">ملاک معدل:</span>
                  <select value={extra.gpaMode ?? 'OVERALL'} onChange={e => setExtra({ ...extra, gpaMode: e.target.value })} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 max-w-56">
                    <option value="OVERALL">معدل کل</option>
                    <option value="TERM">معدل یک نیمسال مشخص</option>
                    <option value="CUMULATIVE">معدل کل تا یک نیمسال</option>
                  </select>
                </label>
                {extra.gpaMode === 'TERM' && (
                  <label className="flex items-center gap-1">
                    <span className="font-bold text-slate-600">نیمسال ملاک:</span>
                    <select value={extra.gpaTerm ?? ''} onChange={e => setExtra({ ...extra, gpaTerm: e.target.value })} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 max-w-56">
                      <option value="">انتخاب کنید…</option>
                      {opts.terms.map(t => <option key={t.code} value={t.code}>{t.title || t.code}</option>)}
                    </select>
                  </label>
                )}
                {extra.gpaMode === 'CUMULATIVE' && (
                  <>
                    <label className="flex items-center gap-1">
                      <span className="font-bold text-slate-600">از نیمسال:</span>
                      <select value={extra.gpaTermFrom ?? ''} onChange={e => setExtra({ ...extra, gpaTermFrom: e.target.value })} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 max-w-52">
                        <option value="">از ابتدا</option>
                        {opts.terms.map(t => <option key={t.code} value={t.code}>{t.title || t.code}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1">
                      <span className="font-bold text-slate-600">تا پایان نیمسال:</span>
                      <select value={extra.gpaTerm ?? ''} onChange={e => setExtra({ ...extra, gpaTerm: e.target.value })} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 max-w-52">
                        <option value="">انتخاب کنید…</option>
                        {opts.terms.map(t => <option key={t.code} value={t.code}>{t.title || t.code}</option>)}
                      </select>
                    </label>
                  </>
                )}
                <label className="flex items-center gap-1">
                  <span className="font-bold text-slate-600">تعداد نفرات برتر:</span>
                  <input value={extra.topN ?? ''} onChange={e => setExtra({ ...extra, topN: e.target.value })} type="number" min="0" max="500" placeholder="همه" className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 w-20" dir="ltr" />
                </label>
                <label className="flex items-center gap-1">
                  <span className="font-bold text-slate-600">نیمسال ورود:</span>
                  <select value={extra.entryTerm ?? ''} onChange={e => setExtra({ ...extra, entryTerm: e.target.value })} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5">
                    <option value="">همه</option>
                    <option value="1">نیمسال اول</option>
                    <option value="2">نیمسال دوم</option>
                    <option value="3">تابستان</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <span className="font-bold text-slate-600">بازهٔ ورودی:</span>
                  <input value={extra.entryYearFrom ?? ''} onChange={e => setExtra({ ...extra, entryYearFrom: e.target.value })} type="number" placeholder="از" className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 w-20" dir="ltr" />
                  <input value={extra.entryYearTo ?? ''} onChange={e => setExtra({ ...extra, entryYearTo: e.target.value })} type="number" placeholder="تا" className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 w-20" dir="ltr" />
                </label>
                <label className="flex items-center gap-1">
                  <span className="font-bold text-slate-600">جنسیت:</span>
                  <select value={extra.gender ?? ''} onChange={e => setExtra({ ...extra, gender: e.target.value })} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5">
                    <option value="">همه</option>
                    <option value="MALE">مرد</option>
                    <option value="FEMALE">زن</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <span className="font-bold text-slate-600">دانشجویان:</span>
                  <select value={extra.statusScope ?? 'ALL'} onChange={e => setExtra({ ...extra, statusScope: e.target.value })} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5">
                    <option value="ALL">همه</option>
                    <option value="ACTIVE">فعال</option>
                    <option value="INACTIVE">غیرفعال</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <span className="font-bold text-slate-600">سهمیه:</span>
                  <select value={extra.quotaType ?? ''} onChange={e => setExtra({ ...extra, quotaType: e.target.value })} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5">
                    <option value="">همه</option>
                    <option value="NORMAL">عادی</option>
                    <option value="SHAHED">شاهد / ایثارگر</option>
                    <option value="STAFF">کارکنان</option>
                    <option value="TOP_TALENT">استعداد درخشان</option>
                  </select>
                </label>
              </>
            )}
            {kind === 'attendance-list' && (
              <>
                <label className="flex items-center gap-1">
                  <span className="font-bold text-slate-600">کد درس:</span>
                  <input value={extra.courseCode ?? ''} onChange={e => setExtra({ ...extra, courseCode: e.target.value })} placeholder="مثلاً 53012" className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 w-28" dir="ltr" />
                </label>
                <label className="flex items-center gap-1">
                  <span className="font-bold text-slate-600">کد استاد:</span>
                  <input value={extra.professorCode ?? ''} onChange={e => setExtra({ ...extra, professorCode: e.target.value })} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 w-28" dir="ltr" />
                </label>
                <label className="flex items-center gap-1">
                  <span className="font-bold text-slate-600">ترتیب اسامی:</span>
                  <select value={extra.orderBy ?? 'NAME'} onChange={e => setExtra({ ...extra, orderBy: e.target.value })} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5">
                    <option value="NAME">نام و نام خانوادگی</option>
                    <option value="CODE">شمارهٔ دانشجویی</option>
                    <option value="PROF">کد استاد و ساعت درس</option>
                  </select>
                </label>
                <label className="flex items-center gap-1 pb-2 text-2xs font-bold text-slate-700">
                  <input type="checkbox" checked={extra.showFinance === '1'} onChange={e => setExtra({ ...extra, showFinance: e.target.checked ? '1' : '' })} />
                  نمایش وضعیت مالی
                </label>
              </>
            )}
            {showStudentFilters && (
              <label className="flex items-center gap-1">
                <span className="font-bold text-slate-600">کد ملی:</span>
                <input
                  value={nationalCode} onChange={e => setNationalCode(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && run(1)}
                  placeholder="کد ملی..."
                  className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 w-36 font-mono" dir="ltr"
                />
              </label>
            )}
            {/* ── وضعیت تحصیلی + دامنهٔ گزارش (همهٔ گزارش‌ها) ── */}
            {showStudentFilters && (
              <label className="flex items-center gap-1">
                <span className="font-bold text-slate-600">وضعیت تحصیلی:</span>
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                  className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5"
                >
                  <option value="ALL">همهٔ وضعیت‌ها</option>
                  <option value="ACTIVE">در حال تحصیل</option>
                  <option value="GRADUATED">فارغ‌التحصیل</option>
                  <option value="SUSPENDED">محروم از تحصیل</option>
                  <option value="WITHDRAWN">انصراف</option>
                  <option value="EXPELLED">اخراج</option>
                  <option value="TRANSFERRED">انتقالی / میهمان</option>
                  <option value="NO_SHOW">عدم مراجعه</option>
                  <option value="DECEASED">فوت</option>
                  <option value="UNKNOWN">نامشخص</option>
                </select>
              </label>
            )}
            {showStudentFilters && (
              <label className="flex items-center gap-1">
                <span className="font-bold text-slate-600">دامنه:</span>
                <select
                  value={scopeMode}
                  onChange={e => setScopeMode(e.target.value === 'term' ? 'term' : 'all')}
                  className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5"
                  title="کل دوره = همهٔ دانشجویان؛ نیمسال = فقط دانشجویانِ فعال در ترم انتخاب‌شده"
                >
                  <option value="all">کل دوره</option>
                  <option value="term">فقط همین نیمسال</option>
                </select>
              </label>
            )}
            {kind === 'incomplete' && (
              <label className="flex items-center gap-1">
                <span className="font-bold text-slate-600">نقص:</span>
                <select value={miss} onChange={e => setMiss(e.target.value)} className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5">
                  <option value="national">کد ملی نامعتبر/خالی</option>
                  <option value="mobile">موبایل خالی</option>
                  <option value="major">بدون رشته</option>
                </select>
              </label>
            )}
            {(card?.customs ?? []).map(c => (
              <label key={c.key} className="flex items-center gap-1">
                <span className="font-bold text-slate-600">{c.title}:</span>
                <input
                  value={extra[c.key] ?? ''}
                  onChange={e => setExtra({ ...extra, [c.key]: e.target.value })}
                  className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 w-28"
                />
              </label>
            ))}
            <input
              value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && run(1)}
              placeholder="🔍 شماره/نام/کد ملی..."
              className="bg-slate-50 border border-slate-300 rounded px-2 py-1.5 w-48"
            />
            <button onClick={() => run(1)} disabled={loading} className="px-4 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white font-bold rounded disabled:opacity-50">
              {loading ? '⏳ در حال اجرا...' : '▶ اجرای گزارش'}
            </button>
            {res && res.rows.length > 0 && (
              <>
                <button onClick={doExport} disabled={exporting} className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded disabled:opacity-50 mr-auto">
                  {exporting ? '⏳...' : '📥 خروجی Excel (CSV)'}
                </button>
                <ReportPrint
                  title={card?.title ?? 'گزارش'}
                  subtitle={[
                    card?.needsTerm
                      ? termMode === 'all'
                        ? 'همهٔ ترمها'
                        : termMode === 'many'
                          ? `ترمهای ${manyTerms.map(faNum).join('، ')}`
                          : `ترم ${faNum(term)}`
                      : null,
                    scopeMode === 'term' ? 'فقط همین نیمسال' : 'کل دوره',
                    `${faNum(res.total)} رکورد`,
                  ].filter(Boolean).join('  •  ')}
                  columns={res.columns}
                  rows={res.rows}
                  summary={res.summary}
                  universityTitle={opts.universityTitle}
                  universityLogoUrl={opts.universityLogoUrl}
                  signers={opts.signers}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* پیوند به صفحات تخصصی — جمع‌شونده در انتها تا مسیر اجرا→نتیجه تمیز بماند */}
      {/* نتیجه */}
      <div id="report-result" className="bg-white border border-slate-300 rounded-xl shadow-sm overflow-hidden scroll-mt-4 print:hidden">
        {err ? (
          <p className="p-8 text-center text-rose-700 bg-rose-50 text-sm font-bold">خطا: {err}</p>
        ) : loading ? (
          <p className="p-8 text-center text-slate-600 text-sm font-bold" role="status" aria-live="polite">
            ⏳ در حال اجرای گزارش «{card?.title}»…
          </p>
        ) : !res ? (
          <p className="p-8 text-center text-slate-500 text-sm">
            گزارش «{card?.title}» انتخاب شد. ابتدا فیلترهای بالا (ترم، مقطع، دانشکده، وضعیت، دامنه …) را تنظیم کنید، سپس «▶ اجرای گزارش» را بزنید.
          </p>
        ) : res.rows.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm font-bold text-amber-700">رکوردی با این فیلترها یافت نشد.</p>
            {/* پیام تشخیصی سرور (مثل «نخست ترم را انتخاب کنید») در حالت خالی هم باید دیده شود */}
            {res.summary && <p className="mt-2 text-xs leading-6 text-slate-600">{res.summary}</p>}
          </div>
        ) : (
          <>
            {res.summary && <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">{res.summary}</div>}
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs rt">
                <thead className="bg-slate-100 border-b border-slate-300 font-bold text-slate-700 sticky top-0">
                  <tr>
                    {res.columns.map(c => <th key={c.key} className="p-2 print:whitespace-normal">{c.title}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {res.rows.map((r, i) => (
                    <tr key={i} className="border-b border-slate-200 hover:bg-slate-50">
                      {res.columns.map(c => (
                        <td key={c.key} className="p-2 font-mono print:whitespace-normal print:break-words" dir={/^[0-9]/.test(String(r[c.key] ?? '')) ? 'ltr' : 'auto'}>
                          {fmtCell(r[c.key], c.format)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {res.totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 p-3 text-xs border-t border-slate-200">
                <button disabled={res.page <= 1} onClick={() => runReport(kind, { ...filters, page: res.page - 1 }).then(setRes)} className="px-3 py-1.5 bg-white border border-slate-300 rounded font-bold disabled:opacity-40">قبلی ▶</button>
                <span className="font-bold">صفحه {res.page.toLocaleString('fa-IR')} از {res.totalPages.toLocaleString('fa-IR')} ({res.total.toLocaleString('fa-IR')} رکورد)</span>
                <button disabled={res.page >= res.totalPages} onClick={() => runReport(kind, { ...filters, page: res.page + 1 }).then(setRes)} className="px-3 py-1.5 bg-white border border-slate-300 rounded font-bold disabled:opacity-40">◀ بعدی</button>
              </div>
            )}
          </>
        )}
      </div>
      {/* پیوند به صفحات تخصصی — جمع‌شونده در انتهای صفحه */}
      <div className="bg-white border border-slate-300 rounded-xl shadow-sm overflow-hidden print:hidden">
        <button
          onClick={() => setShowLinks(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50"
        >
          <span>🔗 پیوندهای سریع به میزهای تخصصی ({LINK_CARDS.length})</span>
          <span>{showLinks ? '▲ بستن' : '▼ نمایش'}</span>
        </button>
        {showLinks && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 p-3 pt-0">
            {LINK_CARDS.map(l => (
              <a key={l.kind} href={l.href} className="flex items-center gap-2 p-3 rounded-lg border-2 text-right font-bold text-[13px] bg-white border-slate-300 hover:border-indigo-300 hover:shadow">
                <span className="text-2xl">{l.icon}</span><span>{l.title}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
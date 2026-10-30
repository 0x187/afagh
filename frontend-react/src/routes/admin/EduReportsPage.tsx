import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, toEnDigits } from '@/lib/fa';
import {
  exportEduReport, getEduReportOptions, runEduReport,
  type ReportFilters, type ReportResult,
} from '@/lib/reports-api';

// ═══ مرکز گزارش‌های آموزشی — پورت admin/reports ═══

type ReportCat = 'students' | 'program' | 'finance' | 'research';
type CardDef = {
  kind: string; icon: string; title: string; cat: ReportCat; needsTerm?: boolean;
  customs?: { key: string; title: string; type?: 'text' | 'number' | 'select'; options?: { value: string; label: string }[] }[];
};

const CATEGORIES: { key: ReportCat; label: string }[] = [
  { key: 'students', label: '🧑‍🎓 دانشجویی و فهرست' },
  { key: 'program', label: '🗓️ برنامه و نمره' },
  { key: 'finance', label: '💰 مالی' },
  { key: 'research', label: '🎓 پژوهش و فارغ‌التحصیلی' },
];

// فقط گزارش‌هایی که منطقشان به Go منتقل شده است؛ بقیه در برش‌های بعد اضافه می‌شوند.
const CARDS: CardDef[] = [
  { kind: 'active-term', cat: 'students', icon: '🧑‍🎓', title: 'گزارش دانشجویان فعال ترم', needsTerm: true },
  { kind: 'status-summary', cat: 'students', icon: '📊', title: 'گزارش خلاصه وضعیت تحصیلی' },
  { kind: 'by-faculty', cat: 'students', icon: '🏛️', title: 'گزارش به تفکیک دانشکده' },
  { kind: 'by-major', cat: 'students', icon: '📚', title: 'گزارش دانشجویان هر رشته' },
  { kind: 'grade-status', cat: 'students', icon: '📝', title: 'دانشجویان برحسب وضعیت نمره', needsTerm: true },
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
  { kind: 'third-attempt', cat: 'program', icon: '🔁', title: 'دروس بار سوم (مردودی دو بار)', needsTerm: true },
  { kind: 'empty-rooms', cat: 'program', icon: '🏚', title: 'کلاس‌های خالی', needsTerm: true },
  { kind: 'weekly-timetable', cat: 'program', icon: '🗓', title: 'برنامه هفتگی کلاس‌ها', needsTerm: true },
  { kind: 'room-conflicts', cat: 'program', icon: '⚠️', title: 'تداخل برنامه کلاس‌ها', needsTerm: true },
  { kind: 'low-enrollment', cat: 'program', icon: '📉', title: 'ظرفیت به حدنصاب نرسیده', needsTerm: true },
  { kind: 'makeup-courses', cat: 'program', icon: '🩹', title: 'دروس جبرانی/پیش‌دانشگاهی' },
  { kind: 'offered-course-roster', cat: 'students', icon: '👥', title: 'دانشجویان درس ارائه‌شده', needsTerm: true },
  { kind: 'no-photo', cat: 'students', icon: '📷', title: 'دانشجویان فاقد عکس' },
  { kind: 'graduates-info', cat: 'research', icon: '🎓', title: 'اطلاعات دانش‌آموختگان' },
  { kind: 'exam-session-sheet', cat: 'program', icon: '📄', title: 'صورت‌جلسه امتحان', needsTerm: true },
  { kind: 'seat-numbers', cat: 'program', icon: '💺', title: 'شماره صندلی', needsTerm: true },
  { kind: 'final-exam-schedule', cat: 'program', icon: '🗓', title: 'برنامه امتحانات پایان ترم', needsTerm: true },
  { kind: 'grade-entry-report', cat: 'program', icon: '✍️', title: 'ثبت نمره استادان', needsTerm: true },
  { kind: 'grade-deadline', cat: 'program', icon: '⏰', title: 'زمان‌بندی ثبت نمرات', needsTerm: true },
  { kind: 'staff-list', cat: 'program', icon: '👨‍🏫', title: 'اساتید', needsTerm: true },
  { kind: 'staff-courses', cat: 'program', icon: '📚', title: 'استادان مدرس دروس', needsTerm: true },
  { kind: 'staff-timetable', cat: 'program', icon: '🗓', title: 'برنامه هفتگی اساتید', needsTerm: true },
  { kind: 'attendance-list', cat: 'program', icon: '📝', title: 'حضور و غیاب', needsTerm: true },
  { kind: 'status-report', cat: 'students', icon: '📊', title: 'وضعیت دانشجویان' },
  { kind: 'major-change-report', cat: 'students', icon: '🔀', title: 'تغییر رشته' },
  { kind: 'status-change-report', cat: 'students', icon: '🔄', title: 'تغییر وضعیت' },
  { kind: 'gpa-refresh-preview', cat: 'program', icon: '🧮', title: 'به‌روزرسانی معدل نیمسال', needsTerm: true },
  { kind: 'profile-refresh', cat: 'program', icon: '👤', title: 'به‌روزرسانی نیمرخ تحصیلی' },
  { kind: 'portal-export', cat: 'research', icon: '📡', title: 'ارسال به پرتال دانش‌آموختگان' },
  { kind: 'proposals', cat: 'research', icon: '📄', title: 'پروپوزال' },
  { kind: 'defenses', cat: 'research', icon: '🎤', title: 'لیست دفاعیات' },
  { kind: 'pending-requests', cat: 'research', icon: '⏳', title: 'درخواست‌های درانتظار' },
  { kind: 'council-edu', cat: 'research', icon: '🏛', title: 'شورای آموزشی' },
  { kind: 'letter-templates', cat: 'research', icon: '📝', title: 'قالب‌های مکاتبات' },
  { kind: 'transcript-card', cat: 'research', icon: '📋', title: 'کارنامه دانشجویان' },
  { kind: 'exam-entry-card', cat: 'program', icon: '🎫', title: 'کارت ورود به جلسه', needsTerm: true },
  { kind: 'student-card', cat: 'research', icon: '🪪', title: 'کارت دانشجویی' },
  { kind: 'study-cert', cat: 'research', icon: '📜', title: 'گواهی اشتغال به تحصیل' },
  { kind: 'edu-confirm', cat: 'research', icon: '✅', title: 'تاییدیه تحصیلی' },
  { kind: 'grad-cert', cat: 'research', icon: '🎓', title: 'گواهی پایان تحصیلات' },
  { kind: 'military-defer', cat: 'research', icon: '🎖', title: 'معافیت تحصیلی' },
  { kind: 'student-weekly-conflicts', cat: 'program', icon: '🗓', title: 'تداخل برنامه هفتگی دانشجویان', needsTerm: true },
  { kind: 'student-exam-conflicts', cat: 'program', icon: '📝', title: 'تداخل برنامه امتحانی', needsTerm: true },
  { kind: 'prereq-violations', cat: 'program', icon: '⛓', title: 'عدم رعایت پیش‌نیاز/هم‌نیاز', needsTerm: true },
  { kind: 'course-grade-status', cat: 'program', icon: '📋', title: 'وضعیت درس و نمره', needsTerm: true,
    customs: [{ key: 'gradeStatus', title: 'وضعیت نمره' }, { key: 'samaCode', title: 'کد سما' }] },
  { kind: 'enrollment-pick', cat: 'program', icon: '🧾', title: 'انتخاب واحد دانشجویان', needsTerm: true },
  { kind: 'probation-violations', cat: 'program', icon: '⚠️', title: 'تخلفات مشروطی' },
  { kind: 'probation-chains', cat: 'program', icon: '🔗', title: 'مشروطی متناوب و متوالی' },
  { kind: 'unit-cap-violations', cat: 'program', icon: '📏', title: 'عدم رعایت سقف و کف واحد', needsTerm: true },
  { kind: 'repeated-courses', cat: 'program', icon: '🔁', title: 'دروس چندبار اخذشده' },
  { kind: 'top-students', cat: 'program', icon: '🏆', title: 'نفرات برتر (سه ملاک معدل)', customs: [
      { key: 'gpaMode', title: 'ملاک', type: 'select', options: [
        { value: 'OVERALL', label: 'معدل کل' }, { value: 'TERM', label: 'معدل نیمسال' }, { value: 'CUMULATIVE', label: 'معدل تا پایان ترم' }] },
      { key: 'gpaTerm', title: 'ترم ملاک' }, { key: 'gpaTermFrom', title: 'از ترم (اختیاری)' },
      { key: 'topN', title: 'تعداد نفرات (۰=همه)', type: 'number' }] },
  { kind: 'probation', cat: 'program', icon: '⚠️', title: 'مشروطی‌های ترم (موتور رسمی)', needsTerm: true },
  { kind: 'graduation-dossiers', cat: 'research', icon: '🎓', title: 'پرونده‌های فراغت', customs: [{ key: 'dossierStatus', title: 'وضعیت (کد یا ALL)' }] },
  { kind: 'grade-audit-log', cat: 'program', icon: '📜', title: 'لاگ تغییرات نمرات', needsTerm: true },
];

const COURSE_LEVEL_KINDS = new Set([
  'payesh', 'tuition', 'empty-rooms', 'weekly-timetable', 'room-conflicts', 'low-enrollment', 'makeup-courses',
  'staff-list', 'staff-courses', 'staff-timetable', 'letter-templates',
]);

const faNum = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

function jalaliSmart(value: unknown, withTime = false): string {
  if (value === null || value === undefined || value === '') return '—';
  const raw = String(value).trim();
  if (/^1[34]\d{2}[/-]\d{1,2}[/-]\d{1,2}/.test(raw)) return faDigits(raw.replace(/-/g, '/'));
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return faDigits(raw);
  try {
    const date = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    if (!withTime) return date;
    return `${date} ${faDigits(String(d.getHours()).padStart(2, '0'))}:${faDigits(String(d.getMinutes()).padStart(2, '0'))}`;
  } catch {
    return faDigits(raw);
  }
}

function fmtCell(value: unknown, format?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (format) {
    case 'DATE': return jalaliSmart(value);
    case 'DATETIME': return jalaliSmart(value, true);
    case 'MONEY': return `${faNum(Math.round(Number(value) || 0).toLocaleString('en-US'))} ریال`;
    case 'NUMBER': return faNum(Number(value).toLocaleString('en-US'));
    default: return String(value);
  }
}

export function AdminEduReportsPage() {
  const { data: opts, isLoading } = useQuery({ queryKey: ['edu-report-options'], queryFn: getEduReportOptions, staleTime: 60_000 });

  const [kind, setKind] = useState('active-term');
  const [cat, setCat] = useState<ReportCat>('students');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [degreeId, setDegreeId] = useState(0);
  const [facultyId, setFacultyId] = useState(0);
  const [departmentId, setDepartmentId] = useState(0);
  const [majorId, setMajorId] = useState(0);
  const [entryYear, setEntryYear] = useState(0);
  const [q, setQ] = useState('');
  const [nationalCode, setNationalCode] = useState('');
  const [miss, setMiss] = useState('national');
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [res, setRes] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState('');

  const card = CARDS.find((c) => c.kind === kind);
  const showStudentFilters = !COURSE_LEVEL_KINDS.has(kind);
  const termValue = term || opts?.latestTerm || '';

  const visibleCards = useMemo(() => {
    const needle = toEnDigits(search.trim().toLowerCase());
    if (!needle) return CARDS;
    return CARDS.filter((c) => toEnDigits(c.title.toLowerCase()).includes(needle) || c.kind.includes(needle));
  }, [search]);
  const tabKeys = CATEGORIES.map((c) => c.key).filter((k) => visibleCards.some((c) => c.cat === k));
  const activeCat = tabKeys.includes(cat) ? cat : tabKeys[0];
  const grid = visibleCards.filter((c) => c.cat === activeCat);

  const filters: ReportFilters = {
    term: card?.needsTerm ? termValue : '',
    degreeId, facultyId, departmentId, majorId, entryYear,
    q: q.trim(), nationalCode: nationalCode.trim(), miss, page: 1,
    ...extra,
  } as ReportFilters;

  async function run(page = 1) {
    setLoading(true);
    setErr('');
    try {
      setRes(await runEduReport(kind, { ...filters, page }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطای نامشخص در اجرای گزارش');
    } finally {
      setLoading(false);
    }
  }

  async function doExport() {
    setExporting(true);
    setErr('');
    try {
      const { header, lines } = await exportEduReport(kind, { ...filters, page: 1 });
      const esc = (v: string) => {
        const s = /^[=+\-@|\t\r]/.test(v.trimStart()) ? `'${v}` : v;
        return `"${s.replace(/"/g, '""')}"`;
      };
      const csv = '\ufeff' + [header.map(esc).join(','), ...lines.map((l) => l.map(esc).join(','))].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `report-${kind}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطای نامشخص در خروجی');
    } finally {
      setExporting(false);
    }
  }

  function pick(k: string) {
    setKind(k);
    setRes(null);
    setErr('');
    setExtra({});
  }

  if (isLoading || !opts) return <Skeleton className="h-72 w-full" />;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-sky-800 via-indigo-900 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-start justify-between gap-3 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-black"><FileText className="size-5" aria-hidden /> مرکز گزارش‌های آموزشی</h1>
            <p className="mt-1 text-xs text-sky-100/80">دانشجویان، وضعیت، نمرات، ورودی‌ها، فارغ‌التحصیلان و پژوهش — صفحه‌بندی‌شده با خروجی CSV</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="bg-white text-slate-900 hover:bg-white/90" disabled={loading} onClick={() => void run(1)}>{loading ? 'در حال اجرا…' : '▶ اجرای گزارش'}</Button>
            <Button size="sm" variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20" disabled={exporting} onClick={() => void doExport()}>{exporting ? '⏳…' : '📥 خروجی CSV'}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجوی گزارش…" className="h-8 max-w-xs text-[11px]" />
            {tabKeys.map((k) => (
              <button key={k} type="button" onClick={() => setCat(k)} className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${activeCat === k ? 'bg-indigo-700 text-white' : 'border border-border bg-card text-muted-foreground hover:bg-muted/50'}`}>{CATEGORIES.find((c) => c.key === k)?.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {grid.map((c) => (
              <button key={c.kind} type="button" onClick={() => pick(c.kind)} className={`flex items-center gap-2 rounded-xl border p-2 text-right text-[11px] font-bold transition ${kind === c.kind ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200' : 'border-border bg-card hover:border-indigo-300'}`}>
                <span className="text-base">{c.icon}</span><span className="line-clamp-2">{c.title}</span>
              </button>
            ))}
            {grid.length === 0 ? <p className="col-span-full py-4 text-center text-xs text-muted-foreground">گزارشی یافت نشد.</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {card?.needsTerm ? (
              <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>ترم</span>
                <select value={termValue} onChange={(e) => setTerm(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-1.5 text-[11px] font-bold"><option value="">—</option>{opts.terms.map((t) => <option key={t.code} value={t.code}>{t.code} {t.title ? `— ${t.title}` : ''}</option>)}</select>
              </label>
            ) : null}
            {showStudentFilters ? (
              <>
                <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>مقطع</span><select value={degreeId} onChange={(e) => setDegreeId(Number(e.target.value))} className="h-8 w-full rounded-lg border border-input bg-card px-1.5 text-[11px] font-bold"><option value={0}>همه</option>{opts.degrees.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
                <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>دانشکده</span><select value={facultyId} onChange={(e) => setFacultyId(Number(e.target.value))} className="h-8 w-full rounded-lg border border-input bg-card px-1.5 text-[11px] font-bold"><option value={0}>همه</option>{opts.faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
                <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>گروه</span><select value={departmentId} onChange={(e) => setDepartmentId(Number(e.target.value))} className="h-8 w-full rounded-lg border border-input bg-card px-1.5 text-[11px] font-bold"><option value={0}>همه</option>{opts.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>رشته</span><select value={majorId} onChange={(e) => setMajorId(Number(e.target.value))} className="h-8 w-full rounded-lg border border-input bg-card px-1.5 text-[11px] font-bold"><option value={0}>همه</option>{opts.majors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>ورودی</span><select value={entryYear} onChange={(e) => setEntryYear(Number(e.target.value))} className="h-8 w-full rounded-lg border border-input bg-card px-1.5 text-[11px] font-bold"><option value={0}>همه</option>{opts.entryYears.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
                <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>جستجو (کد/نام/کدملی)</span><Input value={q} onChange={(e) => setQ(e.target.value)} className="h-8 text-[11px]" /></label>
                <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>کد ملی</span><Input value={nationalCode} onChange={(e) => setNationalCode(e.target.value)} className="h-8 font-mono text-[11px]" dir="ltr" /></label>
                {kind === 'incomplete' ? (
                  <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>کمبود</span><select value={miss} onChange={(e) => setMiss(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-1.5 text-[11px] font-bold"><option value="national">کد ملی</option><option value="mobile">موبایل</option><option value="major">رشته</option></select></label>
                ) : null}
              </>
            ) : null}
          </div>
          {card?.customs?.length ? (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {card.customs.map((cu) => (
                <label key={cu.key} className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>{cu.title}</span>
                  {cu.type === 'select' ? (
                    <select value={extra[cu.key] ?? ''} onChange={(e) => setExtra({ ...extra, [cu.key]: e.target.value })} className="h-8 w-full rounded-lg border border-input bg-card px-1.5 text-[11px] font-bold">
                      <option value="">{cu.key === 'gpaMode' ? 'معدل کل' : '—'}</option>
                      {(cu.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <Input type={cu.type === 'number' ? 'number' : 'text'} value={extra[cu.key] ?? ''} onChange={(e) => setExtra({ ...extra, [cu.key]: e.target.value })} className="h-8 text-[11px]" />
                  )}
                </label>
              ))}
            </div>
          ) : null}
          <div className="flex justify-end"><Button size="sm" disabled={loading} onClick={() => void run(1)}>{loading ? 'در حال اجرا…' : 'اجرا'}</Button></div>
        </CardContent>
      </Card>

      {err ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">{err}</p> : null}

      {res ? (
        <Card id="report-result">
          <CardContent className="space-y-2 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-black">{card?.title}</h2>
              <span className="text-[11px] text-muted-foreground">{faNum(res.total)} ردیف — صفحهٔ {faNum(res.page)} از {faNum(res.totalPages)}</span>
            </div>
            {res.summary ? <p className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300">{res.summary}</p> : null}
            {res.rows.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">داده‌ای برای این گزارش یافت نشد.</p> : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-[11px]">
                    <thead className="bg-muted/60 text-muted-foreground"><tr>{res.columns.map((c) => <th key={c.key} className="whitespace-nowrap p-2 text-right font-black">{c.title}</th>)}</tr></thead>
                    <tbody>
                      {res.rows.map((row, i) => (
                        <tr key={i} className="border-t border-border/50">
                          {res.columns.map((c) => <td key={c.key} className="whitespace-nowrap p-2">{fmtCell(row[c.key], c.format)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={res.page <= 1 || loading} onClick={() => void run(res.page - 1)}>قبلی</Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={res.page >= res.totalPages || loading} onClick={() => void run(res.page + 1)}>بعدی</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

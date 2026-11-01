import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CalendarRange, GraduationCap, Pencil, Plus, Search, Tag, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber, toEnDigits } from '@/lib/fa';
import {
  createBankCourse, getBankCourses, getGradeClusters, getGradeCurriculumCourses, getGradeDegreeLevels,
  getGradeDepartments, getGradeMajors, getGradeStatusCodeOptions, getGradeThresholds, getGradeVersions,
  getOfferedCourses, saveGradeThresholds, updateBankCourse, updateCurriculumGradeCodes,
  type BankCourse, type GradeStatusCodeItem, type OfferedCourse, type Threshold,
} from '@/lib/grade-codes-api';

// ═══ Course and grade status code management — port of admin/grade-status-codes ═══

const COURSE_TYPES = ['عمومی', 'پایه', 'اصلی', 'تخصصی', 'اختیاری'];
const COURSE_NATURES = ['نظری', 'عملی', 'نظری-عملی', 'کارگاهی', 'کارآموزی', 'پروژه', 'پایان‌نامه', 'رساله', 'معرفی به استاد', 'خودخوان'];
const OFFERING_SCOPES = [
  { value: 'DEPARTMENTAL', label: 'گروهی (DEPARTMENTAL)' },
  { value: 'GENERAL_SERVICE', label: 'خدماتی (GENERAL_SERVICE)' },
  { value: 'UNIVERSITY_WIDE', label: 'سراسری (UNIVERSITY_WIDE)' },
];
const LOCATION_TYPES = [
  { value: 'IN_CAMPUS', label: 'داخل دانشگاه' },
  { value: 'OUT_CAMPUS', label: 'خارج دانشگاه' },
  { value: 'ONLINE', label: 'مجازی' },
  { value: 'HYBRID', label: 'ترکیبی' },
];
const DISPLAY_MODES = [
  { value: 'NUMERIC', label: 'فقط عدد (مثلاً ۱۸.۵)' },
  { value: 'QUALITATIVE', label: 'فقط کیفی (مثلاً عالی)' },
  { value: 'BOTH', label: 'هر دو (مثلاً عالی ۱۸.۵)' },
];

type Tab = 'bank' | 'grade' | 'qual' | 'offered';

export function AdminGradeCodesPage() {
  const [tab, setTab] = useState<Tab>('bank');
  const [toast, setToast] = useState<string | null>(null);
  const codesQuery = useQuery({ queryKey: ['grade-code-options'], queryFn: getGradeStatusCodeOptions, staleTime: Infinity });
  const departments = useQuery({ queryKey: ['grade-departments'], queryFn: getGradeDepartments, staleTime: 60_000 });
  const degreeLevels = useQuery({ queryKey: ['grade-degree-levels'], queryFn: getGradeDegreeLevels, staleTime: 60_000 });
  const clusters = useQuery({ queryKey: ['grade-clusters'], queryFn: getGradeClusters, staleTime: 60_000 });
  const majors = useQuery({ queryKey: ['grade-majors'], queryFn: getGradeMajors, staleTime: 60_000 });

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 2500);
  }

  const tabs: { key: Tab; label: string; icon: typeof BookOpen }[] = [
    { key: 'bank', label: 'بانک دروس', icon: BookOpen },
    { key: 'grade', label: 'کدهای وضعیت نمره در چارت', icon: Tag },
    { key: 'qual', label: 'نمره کیفی (عالی/خوب/مردود)', icon: GraduationCap },
    { key: 'offered', label: 'دروس ارائه‌شده در نیمسال', icon: CalendarRange },
  ];

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-amber-900 to-orange-900 text-white">
        <CardContent className="flex flex-wrap items-center gap-3 p-5">
          <Tag className="size-8" aria-hidden />
          <div>
            <h1 className="text-lg font-black">مدیریت دروس و کدهای وضعیت نمره</h1>
            <p className="mt-0.5 text-xs text-amber-200">تعریف، ویرایش و کدگذاری وضعیت نمره دروس بانک و چارت</p>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap border-b border-border">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-3 text-xs font-black transition-colors ${tab === t.key ? 'border-b-2 border-amber-600 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200' : 'text-muted-foreground hover:bg-muted/50'}`}>
                <Icon className="size-4" aria-hidden /> {t.label}
              </button>
            );
          })}
        </div>
        <CardContent className="p-4">
          {tab === 'bank' ? (
            <BankTab codes={codesQuery.data ?? []} departments={departments.data ?? []} degreeLevels={degreeLevels.data ?? []}
              clusters={clusters.data ?? []} onToast={showToast} />
          ) : null}
          {tab === 'grade' ? (
            <ChartCodesTab codes={codesQuery.data ?? []} majors={majors.data ?? []} onToast={showToast} />
          ) : null}
          {tab === 'qual' ? (
            <QualitativeTab degreeLevels={degreeLevels.data ?? []} onToast={showToast} />
          ) : null}
          {tab === 'offered' ? (
            <OfferedTab majors={majors.data ?? []} degreeLevels={degreeLevels.data ?? []} />
          ) : null}
        </CardContent>
      </Card>

      {toast ? <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white shadow-xl">{toast}</div> : null}
    </div>
  );
}

// ─── Course bank tab ───

function BankTab({ codes, departments, degreeLevels, clusters, onToast }: {
  codes: GradeStatusCodeItem[];
  departments: { id: number; name: string }[];
  degreeLevels: { id: number; name: string }[];
  clusters: { id: number; name: string }[];
  onToast: (text: string) => void;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<BankCourse | 'new' | null>(null);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(toEnDigits(q.trim())), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  const bank = useQuery({ queryKey: ['bank', debounced, page], queryFn: () => getBankCourses(debounced, page) });
  const pages = bank.data ? Math.max(1, Math.ceil(bank.data.total / bank.data.limit)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1 space-y-1 text-[10px] font-bold text-muted-foreground">
          <span>جستجوی درس</span>
          <div className="relative"><Search className="absolute start-2 top-2 size-3.5 text-muted-foreground" aria-hidden /><Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="کد یا عنوان درس…" className="h-8 ps-7 text-[11px]" /></div>
        </label>
        <Button size="sm" onClick={() => setModal('new')}><Plus className="size-4" aria-hidden /> تعریف درس جدید</Button>
      </div>

      {bank.isLoading ? <Skeleton className="h-48 w-full" /> : null}
      {bank.isError ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">دریافت بانک دروس ناموفق بود.</p> : null}

      {bank.data ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-[11px]">
              <thead className="bg-slate-900 text-white"><tr>{['#', 'کد', 'عنوان', 'واحد', 'نظری', 'عملی', 'ماهیت', 'نوع', 'گروه', 'مقطع', 'کد قبولی', 'کد مردودی', 'عملیات'].map((h) => <th key={h} className="whitespace-nowrap p-2 text-center font-black">{h}</th>)}</tr></thead>
              <tbody>
                {bank.data.courses.map((c, i) => (
                  <tr key={c.id} className={i % 2 ? 'bg-muted/30' : ''}>
                    <td className="p-1.5 text-center text-muted-foreground">{faNumber((page - 1) * bank.data!.limit + i + 1)}</td>
                    <td className="p-1.5 text-center font-mono font-bold text-indigo-800 dark:text-indigo-300">{c.code}</td>
                    <td className="p-1.5 font-black">{c.title}</td>
                    <td className="p-1.5 text-center font-black">{faNumber(Number(c.units))}</td>
                    <td className="p-1.5 text-center">{c.theoreticalUnits == null ? '—' : faNumber(Number(c.theoreticalUnits))}</td>
                    <td className="p-1.5 text-center">{c.practicalUnits == null ? '—' : faNumber(Number(c.practicalUnits))}</td>
                    <td className="p-1.5 text-center text-[10px]">{c.courseNature || '—'}</td>
                    <td className="p-1.5 text-center text-[10px]">{c.courseType || '—'}</td>
                    <td className="p-1.5 text-center text-[10px]">{c.departmentName || '—'}</td>
                    <td className="p-1.5 text-center text-[10px]">{c.degreeLevelTitle || '—'}</td>
                    <td className="p-1.5 text-center">{c.defaultAcceptMarkState ? <Badge variant="success" className="text-[10px]">{c.defaultAcceptMarkState}</Badge> : '—'}</td>
                    <td className="p-1.5 text-center">{c.defaultRejectMarkState ? <Badge variant="destructive" className="text-[10px]">{c.defaultRejectMarkState}</Badge> : '—'}</td>
                    <td className="p-1.5 text-center"><button type="button" className="text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => setModal(c)}><Pencil className="inline size-3" aria-hidden /> ویرایش</button></td>
                  </tr>
                ))}
                {bank.data.courses.length === 0 ? <tr><td colSpan={13} className="p-6 text-center text-muted-foreground">درسی یافت نشد.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">{faNumber(bank.data.total)} درس — صفحهٔ {faNumber(page)} از {faNumber(pages)}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>بعدی</Button>
            </div>
          </div>
        </>
      ) : null}

      {modal ? (
        <CourseModal course={modal === 'new' ? null : modal} codes={codes} departments={departments} degreeLevels={degreeLevels} clusters={clusters}
          onClose={() => setModal(null)}
          onSaved={async (text) => { setModal(null); onToast(text); await qc.invalidateQueries({ queryKey: ['bank'] }); }}
          onError={onToast} />
      ) : null}
    </div>
  );
}

// ─── Chart codes tab ───

function ChartCodesTab({ codes, majors, onToast }: {
  codes: GradeStatusCodeItem[];
  majors: { id: number; code: string; name: string }[];
  onToast: (text: string) => void;
}) {
  const qc = useQueryClient();
  const [majorId, setMajorId] = useState<number | null>(null);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const versions = useQuery({ queryKey: ['grade-versions', majorId], queryFn: () => getGradeVersions(majorId as number), enabled: !!majorId });
  const courses = useQuery({ queryKey: ['grade-chart-courses', versionId], queryFn: () => getGradeCurriculumCourses(versionId as number), enabled: !!versionId });
  const mutation = useMutation({
    mutationFn: (v: { courseId: number; pass: string | null; fail: string | null }) =>
      updateCurriculumGradeCodes(versionId as number, v.courseId, v.pass, v.fail),
    onSuccess: async () => { onToast('ذخیره شد'); await qc.invalidateQueries({ queryKey: ['grade-chart-courses', versionId] }); },
    onError: (e: Error) => onToast(e.message),
  });
  const filtered = (courses.data ?? []).filter((c) => {
    const t = toEnDigits(q.trim());
    return !t || c.code.includes(t) || c.title.includes(t);
  });
  const passOptions = codes.filter((c) => c.passed);
  const failOptions = codes.filter((c) => !c.passed);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>رشته / گروه آموزشی</span>
          <select value={majorId ?? ''} onChange={(e) => { setMajorId(Number(e.target.value) || null); setVersionId(null); }} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
            <option value="">انتخاب رشته…</option>
            {majors.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>نسخهٔ برنامهٔ درسی</span>
          <select value={versionId ?? ''} onChange={(e) => setVersionId(Number(e.target.value) || null)} disabled={!majorId} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold disabled:opacity-50">
            <option value="">انتخاب نسخه…</option>
            {(versions.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.versionCode} — {v.title} ({v.status})</option>)}
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>جستجوی درس</span>
          <Input value={q} onChange={(e) => setQ(e.target.value)} disabled={!versionId} placeholder="کد یا عنوان درس…" className="h-8 text-[11px]" />
        </label>
      </div>

      {!versionId ? <p className="py-8 text-center text-xs text-muted-foreground">برای مشاهدهٔ کدهای وضعیت، رشته و نسخهٔ چارت را انتخاب کنید.</p> : null}
      {versionId && courses.isLoading ? <Skeleton className="h-40 w-full" /> : null}
      {versionId && courses.data ? (
        <div className="overflow-x-auto">
          <p className="mb-1 text-[11px] font-bold">{faNumber(filtered.length)} درس</p>
          <table className="w-full border-collapse text-right text-[11px]">
            <thead className="bg-slate-900 text-white"><tr>{['#', 'کد درس', 'عنوان', 'واحد', 'ترم', 'کد قبولی', 'کد مردودی'].map((h) => <th key={h} className="p-2 text-center font-black">{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.courseId} className={i % 2 ? 'bg-muted/30' : ''}>
                  <td className="p-2 text-center text-muted-foreground">{faNumber(i + 1)}</td>
                  <td className="p-2 text-center font-mono font-bold">{c.code}</td>
                  <td className="p-2 font-black">{c.title}</td>
                  <td className="p-2 text-center">{c.units == null ? '—' : faNumber(Number(c.units))}</td>
                  <td className="p-2 text-center">{c.recommendedSemester == null ? '—' : faNumber(c.recommendedSemester)}</td>
                  <td className="p-2 text-center">
                    <select value={c.passGradeStatusCode ?? ''} disabled={mutation.isPending}
                      onChange={(e) => mutation.mutate({ courseId: c.courseId, pass: e.target.value || null, fail: c.failGradeStatusCode ?? null })}
                      className="max-w-44 rounded-md border border-input bg-card px-1.5 py-1 text-[10px] font-bold">
                      <option value="">پیش‌فرض (1)</option>
                      {passOptions.map((g) => <option key={g.code} value={g.code}>{g.code} — {g.title}</option>)}
                    </select>
                  </td>
                  <td className="p-2 text-center">
                    <select value={c.failGradeStatusCode ?? ''} disabled={mutation.isPending}
                      onChange={(e) => mutation.mutate({ courseId: c.courseId, pass: c.passGradeStatusCode ?? null, fail: e.target.value || null })}
                      className="max-w-44 rounded-md border border-input bg-card px-1.5 py-1 text-[10px] font-bold">
                      <option value="">پیش‌فرض (2)</option>
                      {failOptions.map((g) => <option key={g.code} value={g.code}>{g.code} — {g.title}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">درسی یافت نشد.</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><b>راهنما:</b> کد قبولی و مردودی هر درس را از لیست کشویی انتخاب کنید. تغییرات فوراً ذخیره می‌شوند.</p>
    </div>
  );
}

// ─── Qualitative grade tab ───

function QualitativeTab({ degreeLevels, onToast }: {
  degreeLevels: { id: number; name: string }[];
  onToast: (text: string) => void;
}) {
  const [degreeId, setDegreeId] = useState<number | null>(null);
  const [rows, setRows] = useState<Threshold[]>([]);
  const [mode, setMode] = useState('NUMERIC');
  const query = useQuery({ queryKey: ['grade-thresholds', degreeId], queryFn: () => getGradeThresholds(degreeId as number), enabled: !!degreeId });
  useEffect(() => {
    if (!query.data) return;
    setRows(query.data.thresholds);
    setMode(query.data.displayMode);
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => saveGradeThresholds(degreeId as number, mode, rows),
    onSuccess: () => onToast('آستانه‌ها ذخیره شد'),
    onError: (e: Error) => onToast(e.message),
  });

  function update(idx: number, patch: Partial<Threshold>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>مقطع تحصیلی</span>
          <select value={degreeId ?? ''} onChange={(e) => setDegreeId(Number(e.target.value) || null)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
            <option value="">انتخاب مقطع…</option>
            {degreeLevels.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>حالت نمایش در کارنامه</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
            {DISPLAY_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
      </div>

      {!degreeId ? <p className="py-8 text-center text-xs text-muted-foreground">برای تعریف آستانه‌ها، مقطع را انتخاب کنید.</p> : null}
      {degreeId && query.isLoading ? <Skeleton className="h-32 w-full" /> : null}
      {degreeId && query.data ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black">آستانه‌های نمرهٔ کیفی</h3>
            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setRows([...rows, { label: '', minValue: '0', maxValue: '20', passed: true }])}><Plus className="size-3" aria-hidden /> افزودن ردیف</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-[11px]">
              <thead className="bg-muted/60 text-muted-foreground"><tr>{['#', 'برچسب', 'حداقل', 'حداکثر', 'قبول؟', ''].map((h) => <th key={h} className="p-2 text-center font-black">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((t, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="p-1.5 text-center text-muted-foreground">{faNumber(i + 1)}</td>
                    <td className="p-1.5"><Input value={t.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="مثلاً عالی" className="h-7 text-[11px]" /></td>
                    <td className="p-1.5"><Input type="number" step="0.25" min="0" max="20" value={t.minValue} onChange={(e) => update(i, { minValue: e.target.value })} className="h-7 text-center text-[11px]" dir="ltr" /></td>
                    <td className="p-1.5"><Input type="number" step="0.25" min="0" max="20" value={t.maxValue} onChange={(e) => update(i, { maxValue: e.target.value })} className="h-7 text-center text-[11px]" dir="ltr" /></td>
                    <td className="p-1.5 text-center"><input type="checkbox" className="size-4 accent-emerald-600" checked={t.passed} onChange={(e) => update(i, { passed: e.target.checked })} /></td>
                    <td className="p-1.5 text-center"><button type="button" className="text-rose-600 hover:underline" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}><Trash2 className="size-3.5" aria-hidden /></button></td>
                  </tr>
                ))}
                {rows.length === 0 ? <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">آستانه‌ای تعریف نشده است.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <Button size="sm" disabled={save.isPending || rows.length === 0} onClick={() => save.mutate()}>{save.isPending ? 'در حال ذخیره…' : 'ذخیرهٔ آستانه‌ها'}</Button>
          <p className="rounded-xl border border-sky-200 bg-sky-50/80 p-3 text-[11px] text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200"><b>راهنما:</b> نمرات عددی بر اساس این آستانه‌ها به درجهٔ کیفی تبدیل می‌شوند. مثال: عالی ۱۸-۲۰، خیلی خوب ۱۶-۱۷٫۹۹، خوب ۱۴-۱۵٫۹۹، مردود ۰-۱۳٫۹۹</p>
        </div>
      ) : null}
    </div>
  );
}

// ─── Offered courses tab ───

function OfferedTab({ majors, degreeLevels }: {
  majors: { id: number; code: string; name: string }[];
  degreeLevels: { id: number; name: string }[];
}) {
  const [q, setQ] = useState('');
  const [majorId, setMajorId] = useState<number | null>(null);
  const [degreeId, setDegreeId] = useState<number | null>(null);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(toEnDigits(q.trim())), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  const offered = useQuery({ queryKey: ['grade-offered', debounced, majorId, degreeId], queryFn: () => getOfferedCourses({ q: debounced, majorId, degreeLevelId: degreeId }) });

  const groups = useMemo(() => {
    const map = new Map<string, { title: string; courses: OfferedCourse[] }>();
    for (const c of offered.data ?? []) {
      const key = `${c.majorName} — ${c.versionCode}`;
      if (!map.has(key)) map.set(key, { title: `${c.majorName} (${c.versionCode}) — ${c.degreeLevelTitle ?? '?'} — ورودی ${c.entryYearFrom ?? '?'}${c.entryYearTo ? `-${c.entryYearTo}` : ''}`, courses: [] });
      map.get(key)!.courses.push(c);
    }
    return [...map.values()];
  }, [offered.data]);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>جستجو (کد/عنوان درس)</span><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثلاً ۱۰۰۰۱ یا ریاضی" className="h-8 text-[11px]" /></label>
        <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>رشته</span>
          <select value={majorId ?? ''} onChange={(e) => setMajorId(Number(e.target.value) || null)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold"><option value="">همهٔ رشته‌ها</option>{majors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        </label>
        <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>مقطع</span>
          <select value={degreeId ?? ''} onChange={(e) => setDegreeId(Number(e.target.value) || null)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold"><option value="">همهٔ مقاطع</option>{degreeLevels.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </label>
        <div className="flex items-end text-[11px] font-bold text-muted-foreground">{offered.isFetching ? 'در حال بارگذاری…' : `${faNumber(offered.data?.length ?? 0)} درس یافت شد`}</div>
      </div>

      {offered.isLoading ? <Skeleton className="h-40 w-full" /> : null}
      {offered.data && offered.data.length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">درس ارائه‌شده‌ای یافت نشد.</p> : null}

      {groups.map((g) => (
        <div key={g.title} className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between bg-slate-900 px-3 py-2 text-[11px] font-black text-white"><span>{g.title}</span><span className="rounded-full bg-amber-500/25 px-2 py-0.5 text-[10px] text-amber-200">{faNumber(g.courses.length)} درس</span></div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-[11px]">
              <thead className="bg-muted/60 text-muted-foreground"><tr>{['نیمسال', 'کد', 'عنوان درس', 'واحد', 'نوع', 'الزامی', 'کف نمره', 'وضعیت قبولی', 'وضعیت مردودی'].map((h) => <th key={h} className="p-1.5 text-center font-black">{h}</th>)}</tr></thead>
              <tbody>
                {g.courses.map((c, i) => (
                  <tr key={c.id} className={i % 2 ? 'bg-muted/30' : ''}>
                    <td className="p-1.5 text-center font-bold text-amber-700 dark:text-amber-300">{c.recommendedSemester == null ? '—' : faNumber(c.recommendedSemester)}</td>
                    <td className="p-1.5 text-center font-mono">{c.courseCode}</td>
                    <td className="p-1.5 font-bold">{c.courseTitle}</td>
                    <td className="p-1.5 text-center">{c.units == null ? '—' : faNumber(Number(c.units))}</td>
                    <td className="p-1.5 text-center"><Badge variant="secondary" className="text-[9px]">{c.roleType}</Badge></td>
                    <td className="p-1.5 text-center">{c.isRequired ? '✓' : ''}</td>
                    <td className="p-1.5 text-center font-bold">{c.minGrade ?? 'پیش‌فرض'}</td>
                    <td className="p-1.5 text-center">{c.passGradeStatusCode ? <Badge variant="success" className="text-[9px]">{c.passGradeStatusCode}</Badge> : '—'}</td>
                    <td className="p-1.5 text-center">{c.failGradeStatusCode ? <Badge variant="destructive" className="text-[9px]">{c.failGradeStatusCode}</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Course define/edit modal ───

type FormState = {
  code: string; title: string; theoreticalUnits: string; practicalUnits: string;
  weeklyTheoryHours: string; weeklyPracticalHours: string; courseType: string; courseNature: string;
  departmentId: string; degreeLevelId: string; offeringScope: string; locationType: string;
  clusterId: string; gradingType: string; defaultAcceptMarkState: string; defaultRejectMarkState: string;
  minPassedMark: string; englishName: string; internshipUnits: string; coRequisites: string;
  facesHours: string; equivalentCourseCodes: string; description: string;
  affectsGpa: boolean; isThesis: boolean; hasProject: boolean; emergencyWithdrawal: boolean; courseIsActive: boolean;
};

type StringFormKeys = { [K in keyof FormState]: FormState[K] extends string ? K : never }[keyof FormState];

function emptyForm(): FormState {
  return {
    code: '', title: '', theoreticalUnits: '0', practicalUnits: '0', weeklyTheoryHours: '', weeklyPracticalHours: '',
    courseType: 'تخصصی', courseNature: '', departmentId: '', degreeLevelId: '', offeringScope: 'DEPARTMENTAL',
    locationType: 'IN_CAMPUS', clusterId: '', gradingType: 'NUMERIC', defaultAcceptMarkState: '',
    defaultRejectMarkState: '', minPassedMark: '', englishName: '', internshipUnits: '0', coRequisites: '',
    facesHours: '', equivalentCourseCodes: '', description: '',
    affectsGpa: true, isThesis: false, hasProject: false, emergencyWithdrawal: false, courseIsActive: true,
  };
}

function formFromCourse(c: BankCourse): FormState {
  const s = (v: unknown) => (v == null ? '' : String(v));
  return {
    code: c.code, title: c.title, theoreticalUnits: s(c.theoreticalUnits), practicalUnits: s(c.practicalUnits),
    weeklyTheoryHours: s(c.weeklyTheoryHours), weeklyPracticalHours: s(c.weeklyPracticalHours),
    courseType: c.courseType || 'تخصصی', courseNature: c.courseNature || '',
    departmentId: s(c.departmentId), degreeLevelId: s(c.degreeLevelId), offeringScope: c.offeringScope || 'DEPARTMENTAL',
    locationType: c.locationType || 'IN_CAMPUS', clusterId: s(c.clusterId), gradingType: c.gradingType || 'NUMERIC',
    defaultAcceptMarkState: s(c.defaultAcceptMarkState), defaultRejectMarkState: s(c.defaultRejectMarkState),
    minPassedMark: s(c.minPassedMark), englishName: s(c.englishName), internshipUnits: s(c.internshipUnits),
    coRequisites: s(c.coRequisites), facesHours: s(c.facesHours), equivalentCourseCodes: s(c.equivalentCourseCodes),
    description: s(c.description), affectsGpa: c.affectsGpa !== 0, isThesis: c.isThesis === 1,
    hasProject: c.hasProject === 1, emergencyWithdrawal: c.emergencyWithdrawal === 1, courseIsActive: c.courseIsActive !== 0,
  };
}

function CourseModal({ course, codes, departments, degreeLevels, clusters, onClose, onSaved, onError }: {
  course: BankCourse | null;
  codes: GradeStatusCodeItem[];
  departments: { id: number; name: string }[];
  degreeLevels: { id: number; name: string }[];
  clusters: { id: number; name: string }[];
  onClose: () => void;
  onSaved: (text: string) => Promise<void>;
  onError: (text: string) => void;
}) {
  const [form, setForm] = useState<FormState>(course ? formFromCourse(course) : emptyForm());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const passCodes = codes.filter((c) => c.passed);
  const failCodes = codes.filter((c) => !c.passed);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

  async function save() {
    setErr('');
    if (!form.code.trim() || !form.title.trim()) {
      setErr('کد و عنوان درس الزامی است.');
      return;
    }
    if ((Number(form.theoreticalUnits) || 0) + (Number(form.practicalUnits) || 0) <= 0) {
      setErr('مجموع واحد نظری و عملی باید بیشتر از صفر باشد.');
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        code: form.code.trim(),
        title: form.title.trim(),
        theoreticalUnits: Number(form.theoreticalUnits) || 0,
        practicalUnits: Number(form.practicalUnits) || 0,
        weeklyTheoryHours: numOrNull(form.weeklyTheoryHours),
        weeklyPracticalHours: numOrNull(form.weeklyPracticalHours),
        courseType: form.courseType,
        courseNature: form.courseNature || null,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        degreeLevelId: form.degreeLevelId ? Number(form.degreeLevelId) : null,
        offeringScope: form.offeringScope,
        locationType: form.locationType,
        clusterId: form.clusterId ? Number(form.clusterId) : null,
        gradingType: form.gradingType,
        defaultAcceptMarkState: form.defaultAcceptMarkState || null,
        defaultRejectMarkState: form.defaultRejectMarkState || null,
        minPassedMark: numOrNull(form.minPassedMark),
        englishName: form.englishName || null,
        internshipUnits: Number(form.internshipUnits) || 0,
        coRequisites: form.coRequisites || null,
        facesHours: numOrNull(form.facesHours),
        equivalentCourseCodes: form.equivalentCourseCodes || null,
        description: form.description || null,
        affectsGpa: form.affectsGpa ? 1 : 0,
        isThesis: form.isThesis ? 1 : 0,
        hasProject: form.hasProject ? 1 : 0,
        emergencyWithdrawal: form.emergencyWithdrawal ? 1 : 0,
        courseIsActive: form.courseIsActive ? 1 : 0,
      };
      if (course) {
        await updateBankCourse(course.id, payload);
        await onSaved('ویرایش شد');
      } else {
        await createBankCourse(payload);
        await onSaved(`درس «${payload.title}» تعریف شد`);
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : 'خطا در ذخیره';
      setErr(text);
      onError(text);
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, node: ReactNode, cls = '') => (
    <label className={`space-y-1 text-[10px] font-bold text-muted-foreground ${cls}`}><span>{label}</span>{node}</label>
  );
  const input = (k: StringFormKeys, dir: 'ltr' | 'auto' = 'auto') => (
    <Input value={form[k]} onChange={(e) => set(k, e.target.value)} className="h-8 text-[11px]" dir={dir} />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} dir="rtl">
      <div className="max-h-[92vh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black">{course ? `ویرایش درس: ${course.code}` : 'تعریف درس جدید'}</h2>
          <button type="button" onClick={onClose}><X className="size-4" aria-hidden /><span className="sr-only">بستن</span></button>
        </div>
        {err ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{err}</div> : null}

        <div className="grid gap-2 sm:grid-cols-4">
          {field('کد درس *', <Input value={form.code} onChange={(e) => set('code', toEnDigits(e.target.value))} disabled={!!course} className="h-8 font-mono text-[11px]" dir="ltr" />)}
          {field('عنوان درس *', input('title'), 'sm:col-span-3')}
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          {field('واحد نظری *', input('theoreticalUnits', 'ltr'))}
          {field('واحد عملی', input('practicalUnits', 'ltr'))}
          {field('ساعت هفتگی نظری', input('weeklyTheoryHours', 'ltr'))}
          {field('ساعت هفتگی عملی', input('weeklyPracticalHours', 'ltr'))}
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          {field('نوع درس', <select value={form.courseType} onChange={(e) => set('courseType', e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold">{COURSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>)}
          {field('ماهیت درس', <select value={form.courseNature} onChange={(e) => set('courseNature', e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold"><option value="">انتخاب…</option>{COURSE_NATURES.map((n) => <option key={n} value={n}>{n}</option>)}</select>)}
          {field('گروه آموزشی', <select value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold"><option value="">بدون گروه</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>)}
          {field('مقطع', <select value={form.degreeLevelId} onChange={(e) => set('degreeLevelId', e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold"><option value="">همهٔ مقاطع</option>{degreeLevels.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>)}
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          {field('نحوهٔ ارائه', <select value={form.offeringScope} onChange={(e) => set('offeringScope', e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold">{OFFERING_SCOPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>)}
          {field('محل ارائه', <select value={form.locationType} onChange={(e) => set('locationType', e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold">{LOCATION_TYPES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select>)}
          {field('خوشهٔ هم‌ارزی', <select value={form.clusterId} onChange={(e) => set('clusterId', e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold"><option value="">بدون خوشه</option>{clusters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)}
          {field('وضعیت نمره', <select value={form.gradingType} onChange={(e) => set('gradingType', e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold"><option value="NUMERIC">نمره‌ای (NUMERIC)</option><option value="PASS_FAIL">قبول/مردود (PASS_FAIL)</option></select>)}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {field('کد وضعیت قبولی (سما)', <select value={form.defaultAcceptMarkState} onChange={(e) => set('defaultAcceptMarkState', e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold"><option value="">پیش‌فرض (1)</option>{passCodes.map((g) => <option key={g.code} value={g.code}>{g.code} — {g.title}</option>)}</select>)}
          {field('کد وضعیت مردودی (سما)', <select value={form.defaultRejectMarkState} onChange={(e) => set('defaultRejectMarkState', e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold"><option value="">پیش‌فرض (2)</option>{failCodes.map((g) => <option key={g.code} value={g.code}>{g.code} — {g.title}</option>)}</select>)}
          {field('حداقل نمرهٔ قبولی', input('minPassedMark', 'ltr'))}
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          {field('نام انگلیسی درس', input('englishName'), 'sm:col-span-2')}
          {field('واحد کارآموزی', input('internshipUnits', 'ltr'))}
          <div className="flex flex-wrap items-end gap-3 pb-1 text-[10px] font-bold text-muted-foreground">
            {([['affectsGpa', 'تأثیر در معدل'], ['isThesis', 'پایان‌نامه'], ['hasProject', 'پروژه'], ['emergencyWithdrawal', 'حذف اضطراری'], ['courseIsActive', 'فعال']] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-1"><input type="checkbox" className="size-3.5 accent-amber-600" checked={form[k]} onChange={(e) => set(k, e.target.checked)} />{l}</label>
            ))}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {field('هم‌نیاز (کدها با کاما)', input('coRequisites', 'ltr'))}
          {field('ساعات چهره‌به‌چهره', input('facesHours', 'ltr'))}
        </div>
        {field('دروس هم‌ارز (کدها با کاما)', input('equivalentCourseCodes', 'ltr'))}
        <label className="block space-y-1 text-[10px] font-bold text-muted-foreground"><span>توضیحات درس</span><textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-[11px]" /></label>
        <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
          <Button size="sm" variant="outline" onClick={onClose}>انصراف</Button>
          <Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? 'در حال ذخیره…' : course ? 'ذخیرهٔ تغییرات' : 'ذخیرهٔ درس'}</Button>
        </div>
      </div>
    </div>
  );
}

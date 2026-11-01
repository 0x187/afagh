import { useQuery } from '@tanstack/react-query';
import { BookOpenCheck, History, Layers, Search, UserCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, toEnDigits } from '@/lib/fa';
import { getAdminDepartments, getAdminOfferings } from '@/lib/admin-api';
import { getConfirmationTerms } from '@/lib/enrollment-api';
import {
  activateTermForFilter,
  bulkDrop,
  bulkEnroll,
  countBulkStudents,
  dropManualEnrollment,
  getManualWarnings,
  getStudentCatalog,
  listManualOfferings,
  manualEnroll,
  manualEnrollHistory,
  searchManualStudents,
  type BulkFilter,
  type CatalogOffering,
  type CatalogResult,
  type ManualOffering,
  type ManualStudentHit,
  type StudentWarning,
} from '@/lib/manual-enroll-api';

// ═══ Enrolling on behalf of a student (education expert) — port of admin/manual-enroll ═══

type Tab = 'single' | 'bulk' | 'activate' | 'history';

export function AdminManualEnrollPage() {
  const [tab, setTab] = useState<Tab>('single');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const { data: terms = [] } = useQuery({ queryKey: ['confirmation-terms'], queryFn: getConfirmationTerms, staleTime: 60_000 });

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-indigo-900 to-indigo-700 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black"><UserCheck className="size-5" aria-hidden /> ثبت‌نام به‌جای دانشجو (کارشناس آموزش)</h1>
          <p className="mt-1 text-xs text-indigo-100">کاتالوگ چارت دانشجو، گیت‌های آیین‌نامه، ثبت/حذف تک‌نفره و دسته‌جمعی با ثبت دلیل تخطی</p>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="text-muted-foreground"><X className="size-3.5" aria-hidden /><span className="sr-only">بستن</span></button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {([
          ['single', '📝 تک‌نفره + کاتالوگ', BookOpenCheck],
          ['bulk', '👥 دسته‌جمعی', Layers],
          ['activate', '⚡ فعال‌سازی ترم', UserCheck],
          ['history', '🕘 تاریخچه', History],
        ] as const).map(([k, l, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-black ${tab === k ? 'border-indigo-800 bg-indigo-700 text-white' : 'border-border bg-card text-muted-foreground'}`}>
            <Icon className="size-3.5" aria-hidden /> {l}
          </button>
        ))}
      </div>

      {tab === 'single' ? <SingleTab terms={terms} onMsg={setMsg} /> : null}
      {tab === 'bulk' ? <BulkTab terms={terms} mode="bulk" onMsg={setMsg} /> : null}
      {tab === 'activate' ? <BulkTab terms={terms} mode="activate" onMsg={setMsg} /> : null}
      {tab === 'history' ? <HistoryTab /> : null}
    </div>
  );
}

function ManualControls({ override, setOverride, reason, setReason }: {
  override: boolean; setOverride: (v: boolean) => void; reason: string; setReason: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-2 text-[11px] dark:border-amber-800 dark:bg-amber-950/30">
      <label className="flex items-center gap-1.5 font-bold"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> نادیده‌گرفتن آیین‌نامه (با دلیل)</label>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="دلیل تخطی (حداقل ۵ نویسه)…" className="h-7 min-w-48 flex-1 text-[11px]" disabled={!override} />
    </div>
  );
}

function SingleTab({ terms, onMsg }: {
  terms: { id: number; title: string; isCurrent: number }[];
  onMsg: (m: { kind: 'ok' | 'err'; text: string }) => void;
}) {
  const [studentQ, setStudentQ] = useState('');
  const [hits, setHits] = useState<ManualStudentHit[]>([]);
  const [student, setStudent] = useState<ManualStudentHit | null>(null);
  const [termId, setTermId] = useState<number>(0);
  const [catalog, setCatalog] = useState<CatalogResult | null>(null);
  const [warnings, setWarnings] = useState<StudentWarning[]>([]);
  const [cart, setCart] = useState<CatalogOffering[]>([]);
  const [scope, setScope] = useState<'mine' | 'chart' | 'common' | 'other'>('mine');
  const [override, setOverride] = useState(true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!termId && terms.length) {
      const cur = terms.find((t) => t.isCurrent === 1);
      setTermId(cur ? cur.id : terms[0].id);
    }
  }, [terms, termId]);

  useEffect(() => {
    if (student) return;
    const q = studentQ.trim();
    if (q.length < 2) { setHits([]); return; }
    const t = setTimeout(() => { searchManualStudents(q).then(setHits).catch(() => setHits([])); }, 300);
    return () => clearTimeout(t);
  }, [studentQ, student]);

  async function loadCatalog(sid: number, tid: number) {
    setLoading(true);
    try {
      const [cat, warns] = await Promise.all([getStudentCatalog(sid, tid), getManualWarnings(sid, tid)]);
      setCatalog(cat);
      setWarnings(warns);
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا در کاتالوگ' });
    } finally {
      setLoading(false);
    }
  }

  function pick(s: ManualStudentHit) {
    setStudent(s);
    setHits([]);
    setStudentQ(s.name);
    setCart([]);
    if (termId) void loadCatalog(s.studentId, termId);
  }

  const visible = useMemo(() => {
    if (!catalog) return [];
    const items = catalog.items;
    if (scope === 'mine') return items.filter((i) => i.scope === 'chart' || i.scope === 'common');
    return items.filter((i) => i.scope === scope);
  }, [catalog, scope]);

  const inCart = (id: number) => cart.some((c) => c.offeringId === id);

  async function doCart() {
    if (!student || !termId || cart.length === 0) return;
    setBusy(true);
    try {
      for (const item of cart) {
        await manualEnroll({ studentId: student.studentId, offeringId: item.offeringId, override, reason });
      }
      onMsg({ kind: 'ok', text: `${faNumber(cart.length)} درس برای دانشجو ثبت شد.` });
      setCart([]);
      await loadCatalog(student.studentId, termId);
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا در ثبت' });
    } finally {
      setBusy(false);
    }
  }

  async function drop(enrollmentId: number) {
    const reason = window.prompt('دلیل حذف (اختیاری):');
    if (reason === null) return;
    setBusy(true);
    try {
      await dropManualEnrollment(enrollmentId, reason);
      onMsg({ kind: 'ok', text: 'ثبت‌نام حذف شد.' });
      if (student && termId) await loadCatalog(student.studentId, termId);
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا در حذف' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 p-3">
          <label className="space-y-1 text-[10px] text-muted-foreground"><span>نیمسال</span>
            <select value={termId} onChange={(e) => { const v = Number(e.target.value); setTermId(v); setCart([]); if (student) void loadCatalog(student.studentId, v); }} className="h-8 rounded-lg border border-input bg-card px-2 text-xs">
              {terms.map((t) => <option key={t.id} value={t.id}>{t.title}{t.isCurrent === 1 ? ' (جاری)' : ''}</option>)}
            </select>
          </label>
          <label className="min-w-48 flex-1 space-y-1 text-[10px] text-muted-foreground"><span>دانشجو</span>
            <div className="relative">
              <Search className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={student ? `${student.name} (${student.studentCode})` : studentQ} onChange={(e) => { setStudentQ(toEnDigits(e.target.value)); setStudent(null); setCatalog(null); setCart([]); }} placeholder="نام یا شماره دانشجو…" className="h-8 pr-8 text-xs" />
            </div>
          </label>
          {student ? <Button size="sm" variant="outline" onClick={() => { setStudent(null); setCatalog(null); setStudentQ(''); setCart([]); }}>تغییر دانشجو</Button> : null}
        </CardContent>
        {hits.length > 0 && !student ? (
          <div className="mx-3 mb-3 max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {hits.map((h) => (
              <button key={h.studentId} type="button" onClick={() => pick(h)} className="w-full px-3 py-2 text-right text-xs hover:bg-accent">
                {h.name} <span className="font-mono text-[10px] text-muted-foreground">{h.studentCode}</span>
                {h.entryYear ? <span className="text-[10px] text-muted-foreground"> — ورود {faDigits(String(h.entryYear))}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </Card>

      {loading ? <Skeleton className="h-64 w-full" /> : null}

      {catalog && student ? (
        <>
          <Card>
            <CardContent className="space-y-2 pt-4">
              <h3 className="text-xs font-black">📚 چارت و کاتالوگ {student.name}{catalog.chart.versionCode ? ` — نسخه ${catalog.chart.versionCode}` : ''}</h3>
              <div className="flex flex-wrap gap-2 text-[11px]">
                <Badge variant="accent">چارت: {faNumber(catalog.chart.chartCount)}</Badge>
                <Badge variant="secondary">مشترک: {faNumber(catalog.chart.commonCount)}</Badge>
                <Badge variant="outline">سایر: {faNumber(catalog.chart.otherCount)}</Badge>
                <Badge variant="warning">واحد ثبت‌شده: {faNumber(catalog.chart.currentUnits)} از {catalog.chart.effectiveMaxUnits == null ? '—' : faNumber(catalog.chart.effectiveMaxUnits)}</Badge>
                <Badge variant="secondary">کل چارت: {faNumber(catalog.chartTotalCount)} ({faNumber(catalog.chartOfferedCount)} ارائه‌شده)</Badge>
              </div>
              {catalog.chart.message ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{catalog.chart.message}</p> : null}
              {warnings.length > 0 ? (
                <div className="space-y-1">
                  {warnings.map((w) => (
                    <div key={w.code} className={`rounded-lg border p-2 text-[11px] ${w.level === 'block' ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200' : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>
                      <b>{w.title}:</b> {w.detail}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="border-t border-border/60 pt-2">
                <h4 className="mb-1 text-[11px] font-black">درس‌های ثبت‌شده در این ترم ({faNumber(catalog.enrolled.length)})</h4>
                {catalog.enrolled.length === 0 ? <p className="text-[11px] text-muted-foreground">درسی ثبت نشده است.</p> : (
                  <table className="w-full border-collapse text-right text-[11px]">
                    <thead className="bg-muted/60 text-muted-foreground"><tr>{['درس', 'گروه', 'واحد', 'استاد', 'وضعیت', ''].map((h) => <th key={h} className="p-1.5 text-right font-black">{h}</th>)}</tr></thead>
                    <tbody>
                      {catalog.enrolled.map((e) => (
                        <tr key={e.enrollmentId} className="border-t border-border/50">
                          <td className="p-1.5">{e.title} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{e.code}</span></td>
                          <td className="p-1.5">{faNumber(e.groupNumber)}</td>
                          <td className="p-1.5">{e.units == null ? '—' : faNumber(e.units)}</td>
                          <td className="p-1.5">{e.professorName}</td>
                          <td className="p-1.5"><Badge variant={e.override ? 'warning' : 'secondary'} className="text-[9px]">{e.status}{e.override ? ' — تخطی' : ''}</Badge></td>
                          <td className="p-1.5"><Button size="sm" variant="destructive" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => void drop(e.enrollmentId)}>حذف</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-4">
              <div className="flex flex-wrap items-center gap-1.5">
                {([['mine', 'چارت + مشترک'], ['chart', 'چارت'], ['common', 'مشترک'], ['other', 'سایر']] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setScope(k)} className={`rounded-lg border px-2 py-1 text-[10px] font-black ${scope === k ? 'border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200' : 'border-border text-muted-foreground'}`}>{l}</button>
                ))}
                {cart.length > 0 ? (
                  <>
                    <span className="ms-auto text-[11px] font-bold text-emerald-700 dark:text-emerald-300">{faNumber(cart.length)} درس در سبد</span>
                    <Button size="sm" className="h-7 text-[10px]" disabled={busy} onClick={() => void doCart()}>ثبت سبد برای دانشجو</Button>
                    <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setCart([])}>خالی‌کردن</Button>
                  </>
                ) : null}
              </div>
              <ManualControls override={override} setOverride={setOverride} reason={reason} setReason={setReason} />
              <div className="grid max-h-[55vh] gap-1 overflow-y-auto sm:grid-cols-2">
                {visible.map((c) => (
                  <div key={`${c.offeringId}-${c.courseId}`} className={`rounded-lg border p-2 text-[11px] ${!c.offered ? 'opacity-60' : ''} ${inCart(c.offeringId) ? 'border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30' : 'border-border'}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold">{c.title} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{c.code}</span></div>
                        <div className="text-[10px] text-muted-foreground">{c.offered ? `گروه ${c.groupNumber} · ${c.professorName} · ${faNumber(c.enrolledCount)}/${faNumber(c.capacity)}` : 'در این ترم ارائه نشده'} · {c.units == null ? '—' : `${faNumber(c.units)} واحد`}</div>
                        {c.prereq ? <div className="text-[10px] text-sky-700 dark:text-sky-300">پیش‌نیاز: {c.prereq}</div> : null}
                        {c.prereqMissing ? <div className="text-[10px] font-bold text-rose-600 dark:text-rose-300">ناقص: {c.prereqMissing}</div> : null}
                        {c.conflicts.length > 0 ? <div className="text-[10px] text-amber-700 dark:text-amber-300">⚠ {c.conflicts[0]}</div> : null}
                        {c.alreadyEnrolled ? <Badge variant="success" className="mt-0.5 text-[9px]">ثبت‌شده</Badge> : null}
                      </div>
                      {c.offered && !c.alreadyEnrolled ? (
                        <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[10px]" disabled={busy} onClick={() => setCart((prev) => inCart(c.offeringId) ? prev.filter((x) => x.offeringId !== c.offeringId) : [...prev, c])}>
                          {inCart(c.offeringId) ? 'حذف' : 'افزودن'}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
                {visible.length === 0 ? <p className="col-span-full p-4 text-center text-xs text-muted-foreground">درسی در این دسته یافت نشد.</p> : null}
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function BulkTab({ terms, mode, onMsg }: {
  terms: { id: number; title: string; isCurrent: number }[];
  mode: 'bulk' | 'activate';
  onMsg: (m: { kind: 'ok' | 'err'; text: string }) => void;
}) {
  const { data: depts } = useQuery({ queryKey: ['admin-departments'], queryFn: getAdminDepartments, staleTime: 120_000 });
  const { data: adminOfferings } = useQuery({ queryKey: ['admin-offerings'], queryFn: getAdminOfferings, staleTime: 120_000 });
  const [termId, setTermId] = useState<number>(0);
  const [entryYear, setEntryYear] = useState('');
  const [entryTerm, setEntryTerm] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [majorId, setMajorId] = useState('');
  const [students, setStudents] = useState<ManualStudentHit[]>([]);
  const [studentQ, setStudentQ] = useState('');
  const [hits, setHits] = useState<ManualStudentHit[]>([]);
  const [offerings, setOfferings] = useState<ManualOffering[]>([]);
  const [chosen, setChosen] = useState<number[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [override, setOverride] = useState(true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!termId && terms.length) {
      const cur = terms.find((t) => t.isCurrent === 1);
      setTermId(cur ? cur.id : terms[0].id);
    }
  }, [terms, termId]);

  useEffect(() => {
    if (!termId) return;
    listManualOfferings(termId).then(setOfferings).catch(() => setOfferings([]));
    setChosen([]);
    setCount(null);
  }, [termId]);

  useEffect(() => {
    const q = studentQ.trim();
    if (q.length < 2) { setHits([]); return; }
    const t = setTimeout(() => { searchManualStudents(q).then(setHits).catch(() => setHits([])); }, 300);
    return () => clearTimeout(t);
  }, [studentQ]);

  const filter: BulkFilter = {
    termId,
    entryYear: entryYear ? Number(entryYear) : null,
    entryTerm: entryTerm ? Number(entryTerm) : null,
    majorId: majorId ? Number(majorId) : null,
    departmentId: departmentId ? Number(departmentId) : null,
    facultyId: facultyId ? Number(facultyId) : null,
    studentIds: students.map((s) => s.studentId),
  };

  async function doCount() {
    setBusy(true);
    try {
      setCount(await countBulkStudents(filter));
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    } finally {
      setBusy(false);
    }
  }

  async function doBulk(kind: 'enroll' | 'drop') {
    if (chosen.length === 0) { onMsg({ kind: 'err', text: 'حداقل یک کلاس انتخاب کنید.' }); return; }
    setBusy(true);
    try {
      if (kind === 'enroll') {
        const r = await bulkEnroll(filter, chosen, override, reason);
        onMsg({ kind: 'ok', text: `${faNumber(r.inserted)} ثبت‌نام، ${faNumber(r.skipped)} ردشده از ${faNumber(r.total)} دانشجو.` });
      } else {
        const r = await bulkDrop(filter, chosen, reason);
        onMsg({ kind: 'ok', text: `${faNumber(r.dropped)} ثبت‌نام حذف شد.` });
      }
      await doCount();
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    } finally {
      setBusy(false);
    }
  }

  async function doActivate(active: boolean) {
    setBusy(true);
    try {
      const n = await activateTermForFilter(filter, active);
      onMsg({ kind: 'ok', text: `${faNumber(n)} دانشجو ${active ? 'فعال' : 'غیرفعال'} شد.` });
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-2 pt-4">
          <h3 className="text-xs font-black">۱) گروه مخاطب</h3>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>نیمسال</span>
              <select value={termId} onChange={(e) => setTermId(Number(e.target.value))} className="h-8 w-full rounded-lg border border-input bg-card px-1.5 text-[11px]">
                {terms.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>سال ورود</span><Input value={entryYear} onChange={(e) => setEntryYear(toEnDigits(e.target.value))} className="h-8 font-mono text-[11px]" dir="ltr" /></label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>نیمسال ورود</span>
              <select value={entryTerm} onChange={(e) => setEntryTerm(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-1.5 text-[11px]">
                <option value="">همه</option><option value="1">اول</option><option value="2">دوم</option><option value="3">تابستان</option>
              </select>
            </label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>دانشکده</span>
              <select value={facultyId} onChange={(e) => { setFacultyId(e.target.value); setDepartmentId(''); }} className="h-8 w-full rounded-lg border border-input bg-card px-1.5 text-[11px]">
                <option value="">همه</option>
                {depts?.faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>گروه</span>
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-1.5 text-[11px]">
                <option value="">همه</option>
                {depts?.departments.filter((d) => !facultyId || d.facultyId === Number(facultyId)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[10px] text-muted-foreground"><span>رشته</span>
              <select value={majorId} onChange={(e) => setMajorId(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-1.5 text-[11px]">
                <option value="">همه</option>
                {adminOfferings?.majors.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </label>
          </div>

          <div className="space-y-1 border-t border-border/60 pt-2">
            <label className="text-[10px] text-muted-foreground">افزودن دانشجوی صریح (مقدم بر فیلتر)</label>
            <div className="flex flex-wrap gap-1.5">
              {students.map((s) => (
                <span key={s.studentId} className="inline-flex items-center gap-1 rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">
                  {s.name} <span className="font-mono">{s.studentCode}</span>
                  <button type="button" onClick={() => setStudents((prev) => prev.filter((x) => x.studentId !== s.studentId))}><X className="size-3" aria-hidden /></button>
                </span>
              ))}
            </div>
            <Input value={studentQ} onChange={(e) => setStudentQ(toEnDigits(e.target.value))} placeholder="جست‌وجوی دانشجو…" className="h-8 max-w-sm text-[11px]" />
            {hits.length > 0 ? (
              <div className="max-h-32 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {hits.map((h) => (
                  <button key={h.studentId} type="button" onClick={() => { setStudents((prev) => prev.some((x) => x.studentId === h.studentId) ? prev : [...prev, h]); setHits([]); setStudentQ(''); }} className="w-full px-2 py-1.5 text-right text-[11px] hover:bg-accent">
                    {h.name} <span className="font-mono text-[10px] text-muted-foreground">{h.studentCode}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void doCount()} disabled={busy}>🔍 شمارش گروه</Button>
            {count != null ? <Badge variant="accent">{faNumber(count)} دانشجو</Badge> : null}
          </div>
        </CardContent>
      </Card>

      {mode === 'bulk' ? (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-xs font-black">۲) کلاس‌ها</h3>
            <div className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {offerings.map((o) => (
                <label key={o.offeringId} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-[11px] ${chosen.includes(o.offeringId) ? 'border-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/30' : 'border-border'}`}>
                  <input type="checkbox" checked={chosen.includes(o.offeringId)} onChange={() => setChosen((prev) => prev.includes(o.offeringId) ? prev.filter((x) => x !== o.offeringId) : [...prev, o.offeringId])} className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{o.title} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{o.code}</span> · گروه {o.groupNumber}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{faNumber(o.enrolledCount)}/{faNumber(o.capacity)}</span>
                </label>
              ))}
              {offerings.length === 0 ? <p className="col-span-full p-4 text-center text-xs text-muted-foreground">کلاسی یافت نشد.</p> : null}
            </div>
            <ManualControls override={override} setOverride={setOverride} reason={reason} setReason={setReason} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="flex-1" disabled={busy} onClick={() => void doBulk('enroll')}>➕ ثبت‌نام دسته‌جمعی</Button>
              <Button size="sm" variant="destructive" className="flex-1" disabled={busy} onClick={() => void doBulk('drop')}>➖ حذف دسته‌جمعی</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-xs font-black">۲) فعال‌سازی ترم برای گروه</h3>
            <p className="text-[11px] text-muted-foreground">وضعیت «فعال در ترم» برای دانشجویان گروه مخاطب ثبت می‌شود (student_term_states).</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void doActivate(true)}>فعال‌سازی</Button>
              <Button size="sm" variant="warning" disabled={busy} onClick={() => void doActivate(false)}>غیرفعال‌سازی</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HistoryTab() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['manual-enroll-history'], queryFn: () => manualEnrollHistory(100), staleTime: 20_000 });
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت تاریخچه ناموفق بود.</CardContent></Card>;
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full border-collapse text-right text-[11px]">
        <thead className="bg-muted/60 text-muted-foreground"><tr>{['دانشجو', 'درس', 'ترم', 'توسط', 'زمان', 'وضعیت'].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id} className="border-t border-border/50">
              <td className="p-2">{r.studentName}<div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{faDigits(r.studentCode)}</div></td>
              <td className="p-2">{r.courseTitle} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{r.courseCode}</span> · گروه {faNumber(r.groupNumber)}</td>
              <td className="p-2">{r.termTitle}</td>
              <td className="p-2">{r.who}</td>
              <td className="p-2 text-[10px]">{r.when ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(r.when)) : '—'}</td>
              <td className="p-2">{r.override ? <Badge variant="warning">با تخطی</Badge> : <Badge variant="secondary">عادی</Badge>}{r.reason ? <div className="mt-0.5 text-[10px] text-muted-foreground">{r.reason}</div> : null}</td>
            </tr>
          ))}
          {data.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">تاریخچه‌ای ثبت نشده است.</td></tr> : null}
        </tbody>
      </table>
    </Card>
  );
}

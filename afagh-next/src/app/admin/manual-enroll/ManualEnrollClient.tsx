'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  activateTermForFilter, bulkDropAction, bulkEnrollAction, countBulkStudents, dropEnrollAction, getStudentCatalog, getStudentWarnings,
  listOfferingsForManualEnroll, manualEnrollAction, manualEnrollHistory,
  searchStudentsForManualEnroll, type BulkFilter, type ManualEnrollOffering, type CatalogOffering, type StudentTermEnrollment, type StudentWarning,
} from './actions';

export interface EnrollFilters {
  terms: { id: number; title: string; isCurrent: boolean }[];
  majors: { id: number; name: string; departmentId: number | null }[];
  departments: { id: number; name: string; facultyId: number }[];
  faculties: { id: number; name: string }[];
  entryYears: number[];
  /** نیمسال‌های ورود به‌صورت «مهر 1404» / «بهمن 1403» — فیلتر یکپارچهٔ سال+نیمسال */
  entryCohorts: { key: string; entryYear: number; entryTerm: number; label: string }[];
}

const sel = 'w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white';

export default function ManualEnrollClient({ filters }: { filters: EnrollFilters }) {
  const [tab, setTab] = useState<'single' | 'bulk' | 'history' | 'activate'>('single');
  // single
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ studentId: number; studentCode: string; name: string; entryYear: number | null }[]>([]);
  const [selStudent, setSelStudent] = useState<{ studentId: number; studentCode: string; name: string } | null>(null);
  const [searched, setSearched] = useState(false);
  const [singleTerm, setSingleTerm] = useState(() => filters.terms.find(t => t.isCurrent)?.id ?? filters.terms[0]?.id ?? 0);
  const [offerings, setOfferings] = useState<ManualEnrollOffering[]>([]);
  const [selOffering, setSelOffering] = useState('');
  // کاتالوگِ همان دانشجو (راهنمای مانند انتخاب واحد)
  const [catalog, setCatalog] = useState<CatalogOffering[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [cart, setCart] = useState<CatalogOffering[]>([]);
  // درس‌های ثبت‌شدهٔ فعلی دانشجو + خلاصهٔ چارت/سقف واحد
  const [enrolled, setEnrolled] = useState<StudentTermEnrollment[]>([]);
  const [chartInfo, setChartInfo] = useState<{ versionCode: string | null; title: string | null; chartCount: number; commonCount: number; otherCount: number; message?: string; effectiveMaxUnits: number | null; currentUnits: number; chartTotalCount?: number; chartOfferedCount?: number } | null>(null);
  const [catalogErr, setCatalogErr] = useState<string | null>(null);
  // فیلتر دامنه: پیش‌فرض فقط چارت+مشترک (درس‌های خودِ دانشجو). «خارج» با کلیک آگاهانه باز می‌شود.
const [scopeFilter, setScopeFilter] = useState<'mine' | 'chart' | 'common' | 'other'>('mine');
  // انتخاب صریح دانشجو در تب دسته‌جمعی
  const [bulkStudents, setBulkStudents] = useState<{ studentId: number; studentCode: string; name: string }[]>([]);
  const [bulkStudentQ, setBulkStudentQ] = useState('');
  const [bulkStudentHits, setBulkStudentHits] = useState<{ studentId: number; studentCode: string; name: string }[]>([]);
  // اخطارهای آیین‌نامه برای کارشناس
  const [warnings, setWarnings] = useState<StudentWarning[]>([]);
  // bulk
  const [bulkTerm, setBulkTerm] = useState(singleTerm);
  const [party, setParty] = useState('');
  const [major, setMajor] = useState('');
  const [dept, setDept] = useState('');
  const [fac, setFac] = useState('');
  const [year, setYear] = useState('');
  const [cohort, setCohort] = useState('');
  const [bulkOfferings, setBulkOfferings] = useState<ManualEnrollOffering[]>([]);
  const [chosen, setChosen] = useState<number[]>([]);
  const [bulkCount, setBulkCount] = useState<number | null>(null);
  // override
  const [override, setOverride] = useState(true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [historyL, setHistoryL] = useState<NonNullable<Awaited<ReturnType<typeof manualEnrollHistory>>['items']>>([]);

  const loadOfferings = async (termId: number) => {
    if (!termId) { setOfferings([]); setBulkOfferings([]); return; }
    const rows = await listOfferingsForManualEnroll(termId);
    setOfferings(rows); setBulkOfferings(rows);
  };
  useEffect(() => { loadOfferings(singleTerm); }, [singleTerm]);
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    const h = await manualEnrollHistory(50).catch(() => ({ items: [] as typeof historyL } as const));
    setHistoryL(h.items ?? []);
  };

  const search = async () => {
    if (!q.trim()) return;
    const r = await searchStudentsForManualEnroll(q.trim()).catch(() => ({ ok: false as const, error: 'خطا' }));
    if (r.ok) {
      setResults(r.items ?? []);
      setSearched(true);
      if (r.items?.length === 1) {
        const s = r.items[0];
        const sel = { studentId: s.studentId, studentCode: s.studentCode, name: s.name };
        setSelStudent(sel);
        if (selStudent?.studentId !== s.studentId) await loadCatalog(s.studentId);
      }
    }
  };

  const loadCatalog = async (studentId: number) => {
    setCatalogLoading(true); setCart([]); setWarnings([]); setCatalogErr(null);
    setEnrolled([]); setChartInfo(null);
    const r = await getStudentCatalog(studentId, singleTerm).catch((e: unknown) => ({ ok: false as const, error: (e as Error)?.message || 'خطا در برقراری ارتباط با سرور' }));
    if (r.ok) {
      setCatalog((r as any).items ?? []);
      setEnrolled((r as any).enrolled ?? []);
      const ch = (r as any).chart ?? null;
      setChartInfo(ch ? { ...ch, chartTotalCount: (r as any).chartTotalCount ?? ch.chartCount, chartOfferedCount: (r as any).chartOfferedCount ?? ch.chartCount } : null);
    } else {
      setCatalog([]); setCatalogErr((r as any).error || 'خطای ناشناخته');
    }
    setCatalogLoading(false);
    const w = await getStudentWarnings(studentId, singleTerm).catch(() => ({ ok: false as const, items: [] as StudentWarning[] }));
    setWarnings(w.ok ? (w.items ?? []) : []);
  };

  const dropEnrolled = async (e: StudentTermEnrollment) => {
    if (!window.confirm(`حذف «${e.code} ${e.title} (گ${e.groupNumber})» از ثبت‌نام ${selStudent?.name ?? ''}؟`)) return;
    setBusy(true); setMsg(null);
    const r = await dropEnrollAction(e.enrollmentId, 'حذف توسط کارشناس از صفحهٔ ثبت‌نام تکی').catch(() => ({ ok: false as const, error: 'خطا' }));
    setMsg(r.ok ? { kind: 'ok', text: `✅ «${e.code}» حذف شد.` } : { kind: 'err', text: (r as any).error ?? 'ناموفق' });
    setBusy(false);
    if (selStudent) await loadCatalog(selStudent.studentId);
    refresh();
  };

  const doSingle = async () => {
    if (!selStudent || !selOffering) { setMsg({ kind: 'err', text: 'دانشجو و کلاس را انتخاب کنید.' }); return; }
    setBusy(true); setMsg(null);
    const r = await manualEnrollAction({ studentId: selStudent.studentId, offeringId: Number(selOffering), override, reason }).catch(() => ({ ok: false as const, error: 'خطا' }));
    setMsg(r.ok ? { kind: 'ok', text: `✅ ثبت شد برای ${selStudent.name} (اختصاص ثبت: شما)` } : { kind: 'err', text: r.error ?? 'ناموفق' });
    setBusy(false); refresh();
  };

  const doCart = async () => {
    if (!selStudent || !cart.length) { setMsg({ kind: 'err', text: 'دانشجو و حداقل یک درس از کاتالوگ را انتخاب کنید.' }); return; }
    if (!window.confirm(`ثبت ${cart.length} درس از کاتالوگ برای ${selStudent.name}؟`)) return;
    setBusy(true); setMsg(null); let okN = 0, errN: string[] = [];
    for (const o of cart) {
      const r = await manualEnrollAction({ studentId: selStudent.studentId, offeringId: o.offeringId, override, reason }).catch(() => ({ ok: false as const, error: 'خطا' }));
      if (r.ok) okN++; else errN.push(`${o.code}: ${r.error ?? ''}`);
    }
    setMsg({ kind: okN > 0 ? 'ok' : 'err', text: okN > 0 ? `✅ ${okN} درس ثبت شد${errN.length ? `؛ ردشدهها: ${errN.join(' | ')}` : ''}` : `⛔ ${errN.join(' | ')}` });
    setCart([]); setBusy(false); setCatalogLoading(true);
    await loadCatalog(selStudent.studentId); setCatalogLoading(false);
    refresh();
  };

  // ── فیلتر دامنه ──
// پیش‌فرض «mine» = فقط درس‌های خودِ دانشجو (چارت رشته + مشترک/عمومی).
// «other» (خارج از چارت = رشته/مقطع دیگر) پنهان است و فقط با کلیک آگاهانه باز می‌شود.
const filteredCatalog = useMemo(() => {
    const qq = catalogQuery.trim().toLowerCase();
    return catalog.filter(c => {
      if (scopeFilter === 'mine') {
        if (c.scope === 'other') return false;
      } else if (c.scope !== scopeFilter) return false;
      if (qq) {
        const hay = `${c.code} ${c.title}`.toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [catalog, catalogQuery, scopeFilter]);
  const inCart = (id: number) => cart.some(c => c.offeringId === id);

  /** راهنمای متناسبِ پایینِ کاتالوگ — بر اساس فیلتر فعال */
  const scopeHint = scopeFilter === 'other'
    ? '⚠ این درس‌ها در چارت رشتهٔ دانشجو نیستند (از رشته یا مقطع دیگر). ثبتشان یک تخطی آیین‌نامه‌ای است: تیک «نادیده‌گرفتن آیین‌نامه» را با دلیل روشن بزن — هر مورد با نام کاربر و دلیل در تاریخچه ثبت می‌شود.'
    : scopeFilter === 'common'
      ? 'فقط دروس مشترک/عمومی: این‌ها برای همهٔ دانشجویان قابل انتخاب‌اند و در چارت رشته نمی‌آیند. برای دیدن درس‌های رشتهٔ خود دانشجو به «چارت + مشترک» یا «فقط چارت» برگرد.'
      : scopeFilter === 'chart'
        ? 'فقط درس‌های چارت رشتهٔ دانشجو — کل چارت، نه فقط ارائه‌شده‌های این ترم. درس‌هایی که در این ترم ارائه نشده‌اند با برچسب «ارائه نشده» می‌آیند و قابل انتخاب نیستند تا استاد/ارائه‌شونده ثبت کند.'
        : 'پیش‌فرض فقط درس‌های خودِ دانشجو نشان داده می‌شود: 🗂 چارت رشته + 🌐 مشترک/عمومی. درس‌های خارج از چارت پنهان‌اند؛ اگر واقعاً لازم شد، دکمهٔ «⚠ خارج از چارت» را بزن و با نادیده‌گرفتن آیین‌نامه + دلیل ثبت کن.';

  const bulkFilter = (): BulkFilter => {
    const c = filters.entryCohorts.find(x => x.key === cohort);
    return {
      termId: Number(bulkTerm),
      entryYear: c ? c.entryYear : (year ? Number(year) : null),
      entryTerm: c ? c.entryTerm : null,
      majorId: major ? Number(major) : null, departmentId: dept ? Number(dept) : null, facultyId: fac ? Number(fac) : null,
      studentIds: bulkStudents.length ? bulkStudents.map(s => s.studentId) : null,
    };
  };

  const activateFilter = (): BulkFilter => {
    const c = filters.entryCohorts.find(x => x.key === cohort);
    return { ...bulkFilter(), entryYear: c ? c.entryYear : null, entryTerm: c ? c.entryTerm : null };
  };

  const countBulk = async (filter: BulkFilter = bulkFilter()) => {
    setBusy(true); setMsg(null);
    const r = await countBulkStudents(filter).catch(() => ({ ok: false as const, error: 'خطا' }));
    if (r.ok) setBulkCount(r.count ?? 0); else setMsg({ kind: 'err', text: r.error ?? '' });
    setBusy(false);
  };

  const doBulk = async (op: 'enroll' | 'drop') => {
    const title = op === 'enroll' ? 'ثبت‌نام دسته‌جمعی' : 'حذف دسته‌جمعی';
    const n = bulkCount ?? 0;
    if (!chosen.length) { setMsg({ kind: 'err', text: 'حداقل یک کلاس انتخاب کنید.' }); return; }
    if (!window.confirm(`${title} برای ${n} دانشجو در ${chosen.length} کلاس؟ از جمله بیشنور.`)) return;
    setBusy(true); setMsg(null);
    const r = op === 'enroll'
      ? await bulkEnrollAction(bulkFilter(), chosen, override, reason).catch(() => ({ ok: false as const, error: 'خطا' }))
      : await bulkDropAction(bulkFilter(), chosen, reason).catch(() => ({ ok: false as const, error: 'خطا' }));
    setMsg(r.ok
      ? { kind: 'ok', text: `✅ ${title}: ${op === 'enroll' ? `ثبت ${(r as any).inserted ?? 0} / رد ${(r as any).skipped ?? 0}` : `حذف ${(r as any).dropped ?? 0}`}` }
      : { kind: 'err', text: r.error ?? 'ناموفق' });
    setBusy(false); refresh();
  };

  const bulkFilteredMajors = useMemo(() => filters.majors.filter(m => !dept || m.departmentId === Number(dept)), [filters.majors, dept]);

  const searchBulkStudents = async () => {
    if (!bulkStudentQ.trim()) return;
    const r = await searchStudentsForManualEnroll(bulkStudentQ.trim()).catch(() => ({ ok: false as const, error: 'خطا' }));
    setBulkStudentHits(r.ok ? (r.items ?? []) : []);
  };
  const addBulkStudent = (s: { studentId: number; studentCode: string; name: string }) => {
    setBulkStudents(p => p.some(x => x.studentId === s.studentId) ? p : [...p, s]);
    setBulkStudentQ(''); setBulkStudentHits([]);
  };
  const removeBulkStudent = (id: number) => setBulkStudents(p => p.filter(x => x.studentId !== id));

  const offerHelp = <span className="text-3xs text-slate-400">ترم را عوض کن تا کلاس‌ها بیاید (تا ۴۰۰۰).</span>;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="card">
        <h1 className="font-black text-base">📝 ثبت‌نام به‌جای دانشجو (کارشناس آموزش)</h1>
        <p className="text-xs text-slate-500 mt-1">تک‌ثبت‌نام، ثبت‌نام/حذف دسته‌جمعی با امکان نادیده‌گرفتن آیین‌نامه (با دلیل) — همه با ردگیری «چه کسی، چه زمانی، چرا».</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {([['single', '✍️ ثبت‌نام تکی'], ['bulk', '👥 دسته‌جمعی'], ['activate', '🔋 فعال‌سازی ترم'], ['history', '🗂️ تاریخچه (پیگیری)']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-xl text-xs font-black transition ${tab === k ? 'bg-indigo-700 text-white' : 'bg-white text-slate-600 border border-slate-300'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'single' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-xs font-bold text-slate-600">جست‌وجوی دانشجو (شماره دانشجویی)
              <div className="flex gap-1.5 mt-1">
                <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="4031253607" className={sel} />
                <button onClick={search} className="shrink-0 px-3 rounded-xl bg-slate-800 text-white text-xs font-black">جست‌وجو</button>
              </div>
            </label>
            {searched && results.length > 0 && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-2 mt-2 max-h-48 overflow-y-auto">
                {results.map(r => (
                  <button key={r.studentId} onClick={() => { setSelStudent({ studentId: r.studentId, studentCode: r.studentCode, name: r.name }); setSelOffering(''); loadCatalog(r.studentId); }} className="w-full text-right px-2 py-1 text-2xs hover:bg-indigo-50 flex items-center justify-between">
                    <span className="font-bold">{r.studentCode} · {r.name}</span>
                    <span className="text-indigo-700 font-black">✓ انتخاب</span>
                  </button>
                ))}
              </div>
            )}
            {searched && results.length === 0 && (
              <p className="text-xs text-slate-500 mt-1 text-center">دانشجویی با این عبارت یافت نشد.</p>
            )}
            <label className="text-xs font-bold text-slate-600">دانشجو
              <select value={selStudent ? String(selStudent.studentId) : ''} onChange={e => { const it = results.find(x => String(x.studentId) === e.target.value); const s = it ? { studentId: it.studentId, studentCode: it.studentCode, name: it.name } : null; setSelStudent(s); setSelOffering(''); if (s) loadCatalog(s.studentId); else setCatalog([]); }} className={sel + ' mt-1'}>
                <option value="">— انتخاب —</option>
                {results.map(r => <option key={r.studentId} value={r.studentId}>{r.studentCode} · {r.name}</option>)}
              </select>
            </label>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-xs font-bold text-slate-600">ترم
              <select value={singleTerm} onChange={e => { setSingleTerm(Number(e.target.value)); setSelOffering(''); if (selStudent) loadCatalog(selStudent.studentId); }} className={sel + ' mt-1'}>
                {filters.terms.map(t => <option key={t.id} value={t.id}>{t.title}{t.isCurrent ? ' (جاری)' : ''}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">کلاس {offerHelp}
              <select value={selOffering} onChange={e => setSelOffering(e.target.value)} className={sel + ' mt-1'}>
                <option value="">— انتخاب —</option>
                {offerings.map(o => <option key={o.offeringId} value={o.offeringId}>{o.code} {o.title} — گ{o.groupNumber} ({o.enrolledCount}/{o.capacity}) · {o.professorName}</option>)}
              </select>
            </label>
          </div>
          <ManualControls override={override} setOverride={setOverride} reason={reason} setReason={setReason} />

          {/* ── پنل اخطارهای آیین‌نامه (مشروطی/سنوات/مالی) برای صدور مجوز ── */}
          {selStudent && warnings.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-3 space-y-1">
              <p className="text-xs font-black text-amber-900">⚠️ اخطارهای آیین‌نامهٔ این دانشجو:</p>
              {warnings.map((w, i) => (
                <p key={i} className={'text-2xs font-bold ' + (w.level === 'block' ? 'text-red-700' : 'text-amber-800')}>
                  {w.level === 'block' ? '❌' : '⚠'} {w.title}: {w.detail}
                </p>
              ))}
              <p className="text-3xs text-amber-800">برای صدور مجوز با وجود اخطار، تیک «نادیده‌گرفتن» را فعال و دلیل را بنویس — اخطارهای نادیده‌گرفته‌شده در تاریخچه ثبت می‌شوند.</p>
            </div>
          )}

          {/* ── کاتالوگِ همان دانشجو (راهنمای کارشناس) ── */}
          {(selStudent || selOffering) && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-black text-indigo-900">📚 چارت و کاتالوگِ {selStudent?.name || 'دانشجو'} — درس‌های خودِ دانشجو در ترم {catalogLoading && '(در حال بارگذاری…)'}</h3>
                <input value={catalogQuery} onChange={e => setCatalogQuery(e.target.value)} placeholder="جست‌وجوی کد/نام درس…" className="w-48 border border-slate-300 rounded-lg px-2 py-1 text-xs" />
              </div>

              {catalogErr && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-2xs font-black text-rose-800">
                  ⚠ خطا در بارگذاری کاتالوگ: {catalogErr}
                </div>
              )}

              {/* ── خلاصهٔ چارت + سقف واحد ── */}
              {chartInfo && (
                <div className="rounded-lg bg-white border border-indigo-200 p-2 text-2xs space-y-1">
                  <p className="font-black text-indigo-900">
                    {chartInfo.versionCode ? `چارت ${chartInfo.versionCode}${chartInfo.title ? ` «${chartInfo.title}»` : ''}` : 'چارت رشته'}
                    {' — '}🗂 کل چارت: {(chartInfo.chartTotalCount ?? chartInfo.chartCount).toLocaleString('fa-IR')}
                    {' '}درس (در این ترم ارائه: {(chartInfo.chartOfferedCount ?? chartInfo.chartCount).toLocaleString('fa-IR')})
                    {' · '}🌐 مشترک: {chartInfo.commonCount.toLocaleString('fa-IR')}
                    {' · '}📦 خارج از چارت: {chartInfo.otherCount.toLocaleString('fa-IR')} <span className="text-slate-400">(پنهان)</span>
                  </p>
                  {chartInfo.effectiveMaxUnits != null && (
                    <p className={'font-black ' + (chartInfo.currentUnits >= chartInfo.effectiveMaxUnits ? 'text-rose-700' : 'text-slate-700')}>
                      سقف واحد: {chartInfo.currentUnits}/{chartInfo.effectiveMaxUnits}
                      {chartInfo.currentUnits >= chartInfo.effectiveMaxUnits && ' — ⚠ به سقف رسیده؛ افزودن نیازمند نادیده‌گرفتن با دلیل است.'}
                    </p>
                  )}
                  {chartInfo.message && <p className="text-amber-700 font-bold">⚠ {chartInfo.message}</p>}
                </div>
              )}

              {/* ── درس‌های ثبت‌شدهٔ فعلی دانشجو (قابل حذف/اصلاح) ── */}
              {enrolled.length > 0 && (
                <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-2 space-y-1">
                  <p className="text-2xs font-black text-rose-900">✅ درس‌های ثبت‌شدهٔ این ترم ({enrolled.length}) — برای اصلاح/حذف:</p>
                  {enrolled.map(e => (
                    <div key={e.enrollmentId} className="flex flex-wrap items-center gap-2 text-2xs">
                      <span className="font-bold text-slate-800">{e.code} {e.title} <span className="text-slate-500">(گ{e.groupNumber})</span></span>
                      <span className="text-slate-500">{e.units ?? ''} واحد · {e.professorName}</span>
                      <span className={'px-1.5 py-0.5 rounded-full text-3xs font-black ' + (e.status === 'REGISTERED' ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-200 text-amber-900')}>{e.status === 'REGISTERED' ? 'ثبت' : e.status === 'WAITLISTED' ? 'صف' : e.status}</span>
                      {e.override && <span className="px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900 text-3xs font-black">با مجوز</span>}
                      <button onClick={() => dropEnrolled(e)} disabled={busy} className="mr-auto rounded-lg bg-rose-600 px-2 py-0.5 text-white font-black text-3xs disabled:opacity-50">حذف</button>
                    </div>
                  ))}
                </div>
              )}

              {/* ── فیلتر دامنهٔ درس: پیش‌فرض «چارت + مشترک» (درس‌های خودِ دانشجو) ── */}
              <div className="flex flex-wrap gap-1.5">
                {([['mine', '📚 چارت + مشترک'], ['chart', '🗂 فقط چارت'], ['common', '🌐 فقط مشترک/عمومی']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setScopeFilter(k)}
                    className={`px-2.5 py-1 rounded-lg text-2xs font-black transition ${scopeFilter === k ? 'bg-indigo-700 text-white' : 'bg-white text-slate-600 border border-slate-300'}`}>
                    {l}
                  </button>
                ))}
                <span className="text-3xs text-slate-400 self-center">|</span>
                <button onClick={() => setScopeFilter(scopeFilter === 'other' ? 'mine' : 'other')}
                  title="درس‌های خارج از چارتِ رشتهٔ دانشجو (رشته/مقطع دیگر) — ثبتشان نیازمند نادیده‌گرفتن آیین‌نامه با دلیل است"
                  className={`px-2.5 py-1 rounded-lg text-2xs font-black transition border ${scopeFilter === 'other' ? 'bg-rose-600 text-white border-rose-600' : 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100'}`}>
                  ⚠ خارج از چارت {chartInfo?.otherCount ? `(${chartInfo.otherCount.toLocaleString('fa-IR')})` : ''}
                </button>
              </div>

              {scopeFilter === 'other' && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-2xs font-black text-rose-800 space-y-1">
                  <p>⛔ حالت «خارج از چارت» روشن است: این درس‌ها در برنامهٔ درسی رشتهٔ این دانشجو نیستند.</p>
                  <p className="font-bold">برای ثبتشان باید تیک «نادیده‌گرفتن آیین‌نامه» را با دلیل روشن بزنید؛ نام کاربر، دلیل و درس در تاریخچه ثبت می‌شود. برای برگشتن، دوباره همین دکمه را بزن.</p>
                </div>
              )}

              {cart.length > 0 && (
                <div className="rounded-lg bg-white border border-indigo-300 p-2 text-xs flex flex-wrap items-center gap-2">
                  <span className="font-black text-indigo-900">سبد: {cart.length} درس</span>
                  <span className="text-slate-500">{cart.map(c => `${c.code}(گ${c.groupNumber})`).join('، ')}</span>
                  <button onClick={doCart} disabled={busy} className="mr-auto rounded-lg bg-emerald-700 px-3 py-1 text-white font-black">ثبت این سبد برای دانشجو</button>
                </div>
              )}
              <div className="max-h-80 overflow-y-auto rounded-lg border border-indigo-100 bg-white divide-y divide-slate-100">
                {filteredCatalog.map(c => (
                  <div key={`${c.courseId}-${c.offeringId}`} className={'flex flex-wrap items-center gap-2 p-2 ' + (c.alreadyEnrolled ? 'opacity-60' : '') + (c.offered ? '' : ' bg-slate-50/70')}>
                    <button
                      disabled={!c.offered || inCart(c.offeringId) || c.alreadyEnrolled}
                      onClick={() => setCart(p => inCart(c.offeringId) ? p.filter(x => x.offeringId !== c.offeringId) : [...p, c])}
                      title={c.offered ? '' : 'این درس در ترمِ انتخابی ارائه نشده است — تا ارائه شدن قابل ثبت نیست'}
                      className={'px-2.5 py-1 rounded-lg text-2xs font-black ' + (!c.offered ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : inCart(c.offeringId) ? 'bg-indigo-800 text-white' : c.alreadyEnrolled ? 'bg-slate-200 text-slate-500' : 'bg-indigo-100 text-indigo-900 hover:bg-indigo-200')}>
                      {!c.offered ? 'ارائه نشده' : c.alreadyEnrolled ? 'ثبت است' : inCart(c.offeringId) ? '✓ در سبد' : '＋'}
                    </button>
                    <span className={'font-bold ' + (c.offered ? 'text-slate-800' : 'text-slate-500')}>
                      {c.code} {c.title}
                      {c.offered ? <span className="text-slate-500"> (گ{c.groupNumber})</span> : <span className="text-slate-400"> — در این ترم ارائه نشده</span>}
                    </span>
                    {c.offered
                      ? <span className="text-3xs text-slate-500">{c.units ?? ''} واحد · {c.enrolledCount}/{c.capacity} · {c.professorName}</span>
                      : <span className="text-3xs text-slate-400">{c.units ?? ''} واحد · {c.professorName === '—' ? 'بدون ارائه‌دهنده' : c.professorName}</span>}
                    <span className={'px-1.5 py-0.5 rounded-full text-3xs font-black ' + (c.scope === 'chart' ? 'bg-indigo-100 text-indigo-800' : c.scope === 'common' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700')}>
                      {c.scope === 'chart' ? 'چارت' : c.scope === 'common' ? 'مشترک' : 'خارج'}
                    </span>
                    {c.prereq && !c.prereqMissing && <span className="text-3xs text-amber-700 font-bold">پیش‌نیاز: {c.prereq}</span>}
                    {c.prereqMissing && <span className="text-3xs font-black text-rose-700 rounded-full bg-rose-100 px-2 py-0.5">⛔ پیش‌نیاز ناقص: {c.prereqMissing}</span>}
                    {c.conflicts && c.conflicts.length > 0 && (
                      <span className="text-3xs font-black text-rose-700 rounded-full bg-rose-100 px-2 py-0.5">تداخل: {c.conflicts[0]}</span>
                    )}
                  </div>
                ))}
                {!catalogLoading && !filteredCatalog.length && (
                  <p className="p-3 text-xs text-slate-400">
                    {scopeFilter === 'other'
                      ? 'درسی خارج از چارت در این ترم ارائه نشده است.'
                      : 'در این فیلتر چیزی نیست — «فقط چارت» یا «⚠ خارج از چارت» را امتحان کنید.'}
                  </p>
                )}
              </div>
              <p className={'text-3xs leading-5 ' + (scopeFilter === 'other' ? 'text-rose-700 font-bold' : 'text-indigo-700')}>{scopeHint}</p>
              <p className="text-3xs text-slate-500">نادیده‌گرفتن آیین‌نامه (سقف واحد/پیش‌نیاز/ظرفیت/تداخل) اگر نیاز باشد از تیک بالا استفاده کن (با دلیل).</p>
            </div>
          )}

          <button onClick={doSingle} disabled={busy} className="w-full py-2.5 rounded-xl bg-indigo-700 text-white font-black text-xs disabled:opacity-50">
            {busy ? '…' : 'ثبت‌نام تکی به‌جای دانشجو'}
          </button>
        </div>
      )}

      {tab === 'bulk' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <label className="text-xs font-bold text-slate-600">ترم
              <select value={bulkTerm} onChange={e => { setBulkTerm(Number(e.target.value)); setChosen([]); }} className={sel + ' mt-1'}>
                {filters.terms.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">دانشکده
              <select value={fac} onChange={e => { setFac(e.target.value); setDept(''); }} className={sel + ' mt-1'}>
                <option value="">همه</option>
                {filters.faculties.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">گروه
              <select value={dept} onChange={e => { setDept(e.target.value); setMajor(''); }} className={sel + ' mt-1'}>
                <option value="">همه</option>
                {filters.departments.filter(d => !fac || d.facultyId === Number(fac)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">رشته
              <select value={major} onChange={e => setMajor(e.target.value)} className={sel + ' mt-1'}>
                <option value="">همه</option>
                {bulkFilteredMajors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          </div>

          {/* ── انتخاب صریح دانشجو (اختیاری — مقدم بر فیلتر گروهی) ── */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-2 space-y-1.5">
            <p className="text-2xs font-black text-indigo-900">🎯 انتخاب دانشجو (اختیاری): اگر دانشجویی اضافه کنی، فقط همان‌ها در عملیات لحاظ می‌شوند و فیلترهای بالا نادیده گرفته می‌شود.</p>
            <div className="flex gap-1.5">
              <input value={bulkStudentQ} onChange={e => setBulkStudentQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchBulkStudents()} placeholder="شماره دانشجویی یا نام…" className={sel + ' flex-1'} />
              <button onClick={searchBulkStudents} className="shrink-0 px-3 rounded-xl bg-slate-800 text-white text-xs font-black">جست‌وجو</button>
            </div>
            {bulkStudentHits.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded-lg border border-indigo-100 bg-white divide-y divide-slate-100">
                {bulkStudentHits.map(h => (
                  <button key={h.studentId} onClick={() => addBulkStudent(h)} className="w-full text-right px-2 py-1 text-2xs hover:bg-indigo-50 flex items-center justify-between">
                    <span className="font-bold">{h.studentCode} · {h.name}</span>
                    <span className="text-indigo-700 font-black">＋ افزودن</span>
                  </button>
                ))}
              </div>
            )}
            {bulkStudents.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {bulkStudents.map(s => (
                  <span key={s.studentId} className="inline-flex items-center gap-1 rounded-full bg-indigo-700 text-white px-2.5 py-0.5 text-2xs font-black">
                    {s.studentCode} · {s.name}
                    <button onClick={() => removeBulkStudent(s.studentId)} className="text-white/80 hover:text-white">✕</button>
                  </span>
                ))}
                <button onClick={() => setBulkStudents([])} className="rounded-full bg-slate-200 text-slate-600 px-2.5 py-0.5 text-2xs font-black">پاک‌سازی</button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-bold text-slate-600">ورودی
              <select value={year} onChange={e => setYear(e.target.value)} className={sel + ' mt-1'}>
                <option value="">همه</option>
                {filters.entryYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">نیمسال ورود
              <select value={cohort} onChange={e => setCohort(e.target.value)} className={sel + ' mt-1'}>
                <option value="">همه</option>
                {filters.entryCohorts.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
            <button onClick={() => countBulk()} disabled={busy} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-black text-white disabled:opacity-50">🔍 شمارش</button>
            {bulkCount !== null && <span className="text-xs font-black text-indigo-800">{bulkCount.toLocaleString('fa-IR')} دانشجو</span>}
          </div>
          <div className="rounded-xl border border-slate-200 p-2 max-h-64 overflow-y-auto space-y-1">
            <p className="text-2xs font-bold text-slate-500">کلاس‌های ترم (چندتا را تیک بزن):</p>
            {bulkOfferings.slice(0, 4000).map(o => (
              <label key={o.offeringId} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={chosen.includes(o.offeringId)} onChange={() => setChosen(p => p.includes(o.offeringId) ? p.filter(x => x !== o.offeringId) : [...p, o.offeringId])} className="w-4 h-4" />
                <span>{o.code} {o.title} — گ{o.groupNumber} ({o.enrolledCount}/{o.capacity}) · {o.professorName}</span>
              </label>
            ))}
          </div>
          <ManualControls override={override} setOverride={setOverride} reason={reason} setReason={setReason} />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => doBulk('enroll')} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-emerald-700 text-white font-black text-xs disabled:opacity-50">➕ ثبت‌نام دسته‌جمعی</button>
            <button onClick={() => doBulk('drop')} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-rose-700 text-white font-black text-xs disabled:opacity-50">➖ حذف دسته‌جمعی</button>
          </div>
        </div>
      )}

      {tab === 'activate' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <p className="text-xs font-bold text-slate-600">دانشجویانِ فیلتر را برای ترمِ انتخابی فعال/غیرفعال کن — با گیتِ «فعال‌سازی ترم» در انتخاب‌واحد (تنظیم ENFORCE_TERM_ACTIVATION).</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <label className="text-xs font-bold text-slate-600">ترم
              <select value={bulkTerm} onChange={e => setBulkTerm(Number(e.target.value))} className={sel + ' mt-1'}>
                {filters.terms.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">دانشکده
              <select value={fac} onChange={e => { setFac(e.target.value); setDept(''); }} className={sel + ' mt-1'}>
                <option value="">همه</option>
                {filters.faculties.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">گروه
              <select value={dept} onChange={e => { setDept(e.target.value); setMajor(''); }} className={sel + ' mt-1'}>
                <option value="">همه</option>
                {filters.departments.filter(d => !fac || d.facultyId === Number(fac)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">نیمسال ورود
              <select value={cohort} onChange={e => setCohort(e.target.value)} className={sel + ' mt-1'}>
                <option value="">همه</option>
                {filters.entryCohorts.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => countBulk(activateFilter())} disabled={busy} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-black text-white disabled:opacity-50">🔍 شمارش</button>
            {bulkCount !== null && <span className="text-xs font-black text-indigo-800">{bulkCount.toLocaleString('fa-IR')} دانشجو</span>}
            <button disabled={busy} className="rounded-xl bg-emerald-700 px-5 py-2 text-white font-black text-xs disabled:opacity-50"
              onClick={async () => {
                if (!window.confirm(`فعال‌سازی ${bulkCount ?? '?'} دانشجو در ترم؟`)) return;
                setBusy(true); setMsg(null);
                const a = activateTermForFilter(activateFilter(), true).catch(() => ({ ok: false as const, error: 'خطا' }));
                const r = await a;
                setMsg(r.ok ? { kind: 'ok', text: `✅ فعال‌سازی ترم: ${r.updated} دانشجو` } : { kind: 'err', text: r.error ?? '' });
                setBusy(false);
              }}>🔋 فعال‌سازی در ترم</button>
            <button disabled={busy} className="rounded-xl bg-rose-700 px-5 py-2 text-white font-black text-xs disabled:opacity-50"
              onClick={async () => {
                if (!window.confirm(`غیرفعال‌سازی ${bulkCount ?? '?'} دانشجو در ترم؟`)) return;
                setBusy(true); setMsg(null);
                const r = await activateTermForFilter(activateFilter(), false).catch(() => ({ ok: false as const, error: 'خطا' }));
                setMsg(r.ok ? { kind: 'ok', text: `✅ غیرفعال‌سازی: ${r.updated} دانشجو` } : { kind: 'err', text: r.error ?? '' });
                setBusy(false);
              }}>➖ غیرفعال‌سازی در ترم</button>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="p-3 border-b bg-slate-50 font-black text-sm">🗂️ ثبت‌نام‌های انجام‌شده توسط کارشناس (آخرین ۵۰)</div>
          <div className="max-h-[30rem] overflow-y-auto">
            <table className="w-full text-xs rt">
              <thead className="sticky top-0 bg-slate-100 text-slate-600"><tr>
                <th className="p-2 text-right">دانشجو</th><th className="p-2 text-right">درس</th><th className="p-2 text-right">ترم</th>
                <th className="p-2 text-right">توسط</th><th className="p-2 text-right">زمان</th><th className="p-2 text-center">نادیده</th><th className="p-2 text-right">دلیل</th>
              </tr></thead>
              <tbody>
                {historyL.map(h => (
                  <tr key={h.id} className="border-t border-slate-100">
                    <td className="p-2 font-bold">{h.studentCode} {h.studentName}</td>
                    <td className="p-2">{h.courseCode} {h.courseTitle} (گ{h.groupNumber})</td>
                    <td className="p-2">{h.termTitle}</td>
                    <td className="p-2">{h.who}</td>
                    <td className="p-2">{h.when ? new Date(h.when).toLocaleString('fa-IR') : '—'}</td>
                    <td className="p-2 text-center">{h.override ? <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 font-black text-3xs">بله</span> : '—'}</td>
                    <td className="p-2 text-slate-600">{h.reason || '—'}</td>
                  </tr>
                ))}
                {!historyL.length && <tr><td colSpan={7} className="p-4 text-center text-slate-400">هنوز ثبت‌نام دستی‌ای انجام نشده.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {msg && <div className={`rounded-2xl border p-3 text-xs font-black leading-6 ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{msg.text}</div>}
    </div>
  );
}

function ManualControls({ override, setOverride, reason, setReason }: {
  override: boolean; setOverride: (v: boolean) => void; reason: string; setReason: (v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
        <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} className="w-4 h-4" />
        نادیده‌گرفتن آیین‌نامه (پیش‌نیاز/ظرفیت/سقف واحد)
      </label>
      {override && (
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="دلیل نادیده‌گرفتن (الزامی — ثبت می‌شود)…" className={sel} />
      )}
    </div>
  );
}
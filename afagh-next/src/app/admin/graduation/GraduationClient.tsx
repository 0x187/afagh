'use client';

import React, { useMemo, useState, useTransition } from 'react';
import {
  advanceAction, alumniRequestsAction, autoClearanceAction, deleteDepartmentAction, deliverAction,
  dossierAction, headApproveAction, holdAction, irandocAction, issueAction, ministryCodeAction,
  refreshListAction, resolveAlumniRequestAction, resumeAction, saveDepartmentAction, scanAction,
  setClearanceAction, startClearanceAction, waiveSajjadAction,
} from './actions';
import { normalizeFa, faIncludes } from '@/lib/persian-search';

// ═══ میز کار فارغ‌التحصیلی و صدور مدارک ═══

export type Row = {
  id: number; studentId: number; workflowStatus: string; gpa: number | null;
  passedUnits: number; requiredUnits: number; headApproved: boolean; thesisRequired: boolean;
  irandocStatus: string | null; studentCode: string; fullName: string;
  majorName: string | null; degreeTitle: string | null;
  startedAt: string | null; lastEventAt: string | null;
};
export type Stats = {
  steps: { code: string; title: string; count: number }[];
  onHold: number; issuedDocs: number; undelivered: number;
};
export type Dept = {
  id: number; code: string; title: string; autoCheck: string; apiUrl: string | null;
  responsibleRoleCode: string | null; sortOrder: number; isActive: boolean; hint: string | null;
};
export type AlumniRow = {
  id: number; requestType: string; trackingCode: string; status: string; fee: number;
  destination: string | null; description: string | null; adminNote: string | null;
  studentId: number; studentCode: string; fullName: string; createdAt: string | null;
};
export type Service = { code: string; title: string; hint: string; needsDestination: boolean; fee: number };
type Dossier = NonNullable<Awaited<ReturnType<typeof dossierAction>>['dossier']>;

const faNum = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const money = (n: number) => faNum(Number(n || 0).toLocaleString('en-US')) + ' ریال';
const dt = (s: string | null) => (s ? faNum(new Date(s).toLocaleDateString('fa-IR')) : '—');

const STATUS_STYLE: Record<string, string> = {
  CATALOG_REVIEW: 'bg-slate-100 text-slate-700 border-slate-300',
  HEAD_APPROVAL: 'bg-amber-100 text-amber-800 border-amber-300',
  IRANDOC_VERIFICATION: 'bg-violet-100 text-violet-800 border-violet-300',
  CLEARANCE: 'bg-sky-100 text-sky-800 border-sky-300',
  SAJJAD_REQUEST: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  FINAL_DOCS: 'bg-orange-100 text-orange-800 border-orange-300',
  READY_TO_ISSUE: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  ISSUED: 'bg-emerald-700 text-white border-emerald-800',
  ON_HOLD: 'bg-rose-100 text-rose-800 border-rose-300',
};
const CLEAR_STYLE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600 border-slate-300',
  CLEARED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  HAS_DEBT: 'bg-rose-100 text-rose-800 border-rose-300',
  WAIVED: 'bg-indigo-100 text-indigo-800 border-indigo-300',
};
const CLEAR_LABEL: Record<string, string> = {
  PENDING: 'در انتظار', CLEARED: 'تسویه شد', HAS_DEBT: 'بدهی دارد', WAIVED: 'معاف',
};
const ALUMNI_STATUS: Record<string, string> = {
  AWAITING_PAYMENT: 'در انتظار پرداخت', PAID: 'پرداخت‌شده', IN_REVIEW: 'در حال بررسی',
  DONE: 'انجام شد', REJECTED: 'رد شد',
};
const DEGREE_LABEL: Record<string, string> = {
  TEMPORARY: 'گواهینامهٔ موقت', PERMANENT: 'دانشنامه (اصل)', TRANSCRIPT: 'ریزنمرات رسمی',
};

export default function GraduationClient({
  initialRows, initialStats, initialDepartments, initialAlumniRequests, services, steps,
}: {
  initialRows: Row[]; initialStats: Stats; initialDepartments: Dept[];
  initialAlumniRequests: AlumniRow[]; services: Service[];
  steps: { code: string; title: string; actor: string }[];
}) {
  const [tab, setTab] = useState<'PIPELINE' | 'DEPTS' | 'ALUMNI'>('PIPELINE');
  const [rows, setRows] = useState(initialRows);
  const [stats, setStats] = useState(initialStats);
  const [depts, setDepts] = useState(initialDepartments);
  const [alumni, setAlumni] = useState(initialAlumniRequests);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [filter, setFilter] = useState('ALL');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, okText?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) { setMsg({ kind: 'err', text: r.error || 'خطا در انجام عملیات.' }); return; }
      if (r.dossier) setDossier(r.dossier as Dossier);
      if (Array.isArray(r.rows)) setAlumni(r.rows as AlumniRow[]);
      if (Array.isArray(r.departments)) {
        setDepts((r.departments as Record<string, unknown>[]).map(d => ({
          id: Number(d.id), code: String(d.code), title: String(d.title),
          autoCheck: String(d.autoCheck ?? 'NONE'), apiUrl: (d.apiUrl as string) ?? null,
          responsibleRoleCode: (d.responsibleRoleCode as string) ?? null,
          sortOrder: Number(d.sortOrder ?? 100), isActive: Number(d.isActive) === 1,
          hint: (d.hint as string) ?? null,
        })));
      }
      if (okText) setMsg({ kind: 'ok', text: okText });
      await reload();
    });

  const reload = async () => {
    const r = await refreshListAction({ status: filter, q });
    if (r.ok) { setRows(r.rows); setStats(r.stats); }
  };

  const filtered = useMemo(() => {
    const t = normalizeFa(q);
    return rows.filter(r =>
      (filter === 'ALL' || r.workflowStatus === filter) &&
      (!t || r.studentCode.includes(t) || faIncludes(r.fullName, t)));
  }, [rows, filter, q]);

  const open = (id: number) => start(async () => {
    const r = await dossierAction(id);
    if (r.ok) setDossier(r.dossier); else setMsg({ kind: 'err', text: r.error });
  });

  return (
    <div className="space-y-4" dir="rtl">
      <header className="card p-4 sm:p-5 bg-gradient-to-l from-emerald-800 to-teal-900 text-white">
        <h1 className="text-lg sm:text-xl font-black">فارغ‌التحصیلی، تسویه‌حساب و صدور مدارک</h1>
        <p className="text-2xs sm:text-xs text-emerald-100 mt-1 leading-6">
          سامانه رویدادمحور است: با قطعی‌شدن آخرین نمره، پروندهٔ دانشجو خودکار باز می‌شود، به کارتابل مدیر گروه می‌رود،
          استعلام ایرانداک گرفته می‌شود و تسویه‌حساب همهٔ دپارتمان‌ها هم‌زمان شروع می‌شود. دانشجو فقط نوار پیشرفت را می‌بیند.
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={() => run(() => scanAction(true), 'پویش انجام شد.')}
            disabled={pending}
            className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 border border-white/25 text-xs font-black disabled:opacity-50"
          >
            🔄 اجرای پویش خودکار فارغ‌التحصیلی
          </button>
          <span className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-2xs font-bold">
            مدارک صادرشده: {faNum(stats.issuedDocs)} — تحویل‌نشده: {faNum(stats.undelivered)}
          </span>
        </div>
      </header>

      {msg && (
        <div className={`card p-3 text-xs font-bold ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {msg.text}
          <button className="float-left text-slate-400" onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {/* خط لوله */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        {stats.steps.map(s => (
          <button
            key={s.code}
            onClick={() => setFilter(s.code)}
            className={`card p-3 text-right border-2 transition ${filter === s.code ? 'border-emerald-600' : 'border-transparent'}`}
          >
            <div className="text-3xs font-bold text-slate-500 leading-4">{s.title}</div>
            <div className="text-lg font-black text-slate-900">{faNum(s.count)}</div>
          </button>
        ))}
        <button onClick={() => setFilter('ON_HOLD')} className={`card p-3 text-right border-2 ${filter === 'ON_HOLD' ? 'border-rose-600' : 'border-transparent'}`}>
          <div className="text-3xs font-bold text-rose-600 leading-4">متوقف‌شده</div>
          <div className="text-lg font-black text-rose-700">{faNum(stats.onHold)}</div>
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {([['PIPELINE', '🎓 پرونده‌ها'], ['DEPTS', '🏛️ دپارتمان‌های تسویه'], ['ALUMNI', '💼 خدمات دانش‌آموختگان']] as const).map(([k, l]) => (
          <button
            key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-xl text-xs font-black border ${tab === k ? 'bg-emerald-700 text-white border-emerald-800' : 'bg-white text-slate-600 border-slate-200'}`}
          >{l}</button>
        ))}
      </div>

      {tab === 'PIPELINE' && (
        <div className="card p-3 sm:p-4">
          <div className="flex flex-wrap gap-2 items-center mb-3">
            <input
              value={q} onChange={e => setQ(e.target.value)} placeholder="جست‌وجوی نام یا شمارهٔ دانشجویی…"
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs w-64"
            />
            <select value={filter} onChange={e => setFilter(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold">
              <option value="ALL">همهٔ وضعیت‌ها</option>
              {steps.map(s => <option key={s.code} value={s.code}>{s.title}</option>)}
              <option value="ON_HOLD">متوقف‌شده</option>
            </select>
            <button onClick={() => start(reload)} className="px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-bold">به‌روزرسانی</button>
            <span className="text-2xs text-slate-500 font-bold">{faNum(filtered.length)} پرونده</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-2xs sm:text-xs rt">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {['دانشجو', 'رشته / مقطع', 'واحد', 'معدل', 'مدیر گروه', 'ایرانداک', 'وضعیت', 'آخرین رویداد', ''].map(h => (
                    <th key={h} className="p-2 text-right font-black whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="p-2">
                      <div className="font-black text-slate-800">{r.fullName}</div>
                      <div className="font-mono text-3xs text-slate-500">{faNum(r.studentCode)}</div>
                    </td>
                    <td className="p-2">{r.majorName ?? '—'}<div className="text-3xs text-slate-500">{r.degreeTitle ?? ''}</div></td>
                    <td className="p-2 font-mono">{faNum(r.passedUnits)}/{faNum(r.requiredUnits)}</td>
                    <td className="p-2 font-mono">{r.gpa == null ? '—' : faNum(r.gpa)}</td>
                    <td className="p-2">{r.headApproved ? '✅' : '⏳'}</td>
                    <td className="p-2">{!r.thesisRequired ? '—' : r.irandocStatus === 'PASSED' ? '✅' : r.irandocStatus === 'REJECTED' ? '⛔' : '⏳'}</td>
                    <td className="p-2">
                      <span className={`px-2 py-0.5 rounded-lg border text-3xs font-black ${STATUS_STYLE[r.workflowStatus] ?? 'bg-slate-100'}`}>
                        {steps.find(s => s.code === r.workflowStatus)?.title ?? r.workflowStatus}
                      </span>
                    </td>
                    <td className="p-2 text-3xs text-slate-500">{dt(r.lastEventAt)}</td>
                    <td className="p-2">
                      <button onClick={() => open(r.id)} className="px-2 py-1 rounded-lg bg-emerald-700 text-white text-3xs font-black">پرونده</button>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td colSpan={9} className="p-6 text-center text-slate-400 font-bold">پرونده‌ای با این فیلتر نیست. برای باز شدن خودکار پرونده‌ها «اجرای پویش» را بزنید.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'DEPTS' && <DeptsTab depts={depts} onSave={(d, okText) => run(() => saveDepartmentAction(d), okText)} onDelete={id => run(() => deleteDepartmentAction(id), 'دپارتمان غیرفعال شد.')} pending={pending} />}

      {tab === 'ALUMNI' && (
        <AlumniTab
          rows={alumni} services={services} pending={pending}
          onFilter={s => start(async () => { const r = await alumniRequestsAction(s); if (r.ok) setAlumni(r.rows); })}
          onResolve={(input, okText) => run(() => resolveAlumniRequestAction(input), okText)}
        />
      )}

      {dossier && (
        <DossierDrawer
          d={dossier} steps={steps} pending={pending}
          onClose={() => setDossier(null)}
          run={run}
        />
      )}
    </div>
  );
}

// ───────────────── پروندهٔ یک دانشجو ─────────────────

function DossierDrawer({ d, steps, pending, onClose, run }: {
  d: Dossier; steps: { code: string; title: string; actor: string }[]; pending: boolean;
  onClose: () => void;
  run: (fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, okText?: string) => void;
}) {
  const a = d.audit;
  const [note, setNote] = useState('');
  const [tracking, setTracking] = useState(a.irandocTrackingCode ?? '');
  const [title, setTitle] = useState(a.thesisTitle ?? '');
  const [holdReason, setHoldReason] = useState('');
  const [deliverTo, setDeliverTo] = useState('');
  const stepIdx = steps.findIndex(s => s.code === a.workflowStatus);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-start" dir="rtl" onClick={onClose}>
      <div className="bg-slate-50 w-full max-w-3xl h-full overflow-y-auto p-4 space-y-3 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900">{d.student.fullName}</h2>
            <p className="text-2xs text-slate-500 font-mono">{faNum(d.student.studentCode)} — {d.student.majorName ?? '—'} / {d.student.degreeTitle ?? '—'}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 text-xl font-black">✕</button>
        </div>

        {/* نوار مراحل */}
        <div className="card p-3">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {steps.map((s, i) => (
              <React.Fragment key={s.code}>
                <div className={`shrink-0 px-2 py-1 rounded-lg text-3xs font-black border ${
                  i < stepIdx ? 'bg-emerald-600 text-white border-emerald-700'
                    : i === stepIdx ? 'bg-amber-400 text-amber-950 border-amber-500'
                      : 'bg-white text-slate-400 border-slate-200'}`}>
                  {s.title}
                </div>
                {i < steps.length - 1 && <span className="text-slate-300">‹</span>}
              </React.Fragment>
            ))}
          </div>
          {a.workflowStatus === 'ON_HOLD' && (
            <div className="mt-2 text-2xs font-black text-rose-700">⛔ پرونده متوقف است: {a.note}</div>
          )}
        </div>

        {/* تطبیق سرفصل */}
        <div className="card p-3 space-y-2">
          <h3 className="text-xs font-black text-slate-800">۱) تطبیق سرفصل (خودکار)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-2xs">
            <Info label="واحد گذرانده" value={faNum(Number(a.passedUnits ?? 0))} />
            <Info label="حداقل واحد" value={faNum(Number(a.requiredUnits ?? 0))} />
            <Info label="معدل کل" value={a.gpa == null ? '—' : faNum(a.gpa)} />
            <Info label="کامل بودن سرفصل" value={a.catalogOk ? '✅ کامل' : '⛔ ناقص'} />
          </div>
          {!!a.missingCourses.length && (
            <div className="text-2xs bg-rose-50 border border-rose-200 rounded-lg p-2">
              <b className="text-rose-800">دروس باقی‌مانده:</b>{' '}
              {a.missingCourses.map(c => `${c.title} (${c.code})`).join('، ')}
            </div>
          )}
        </div>

        {/* مدیر گروه */}
        <div className="card p-3 space-y-2">
          <h3 className="text-xs font-black text-slate-800">۲) تأیید مدیر گروه</h3>
          {a.headApprovalStatus ? (
            <p className="text-2xs text-emerald-700 font-bold">✅ تأیید شد در {dt(a.headApprovedAt)} {a.headNote ? `— ${a.headNote}` : ''}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="یادداشت مدیر گروه (اختیاری)"
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-2xs flex-1 min-w-48" />
              <button disabled={pending} onClick={() => run(() => headApproveAction(a.id, note), 'تأیید مدیر گروه ثبت شد؛ مراحل بعد خودکار آغاز شد.')}
                className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-2xs font-black disabled:opacity-50">تأیید و ارجاع خودکار</button>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
            <input value={holdReason} onChange={e => setHoldReason(e.target.value)} placeholder="دلیل توقف پرونده"
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-2xs flex-1 min-w-48" />
            <button disabled={pending} onClick={() => run(() => holdAction(a.id, holdReason), 'پرونده متوقف شد.')}
              className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-2xs font-black disabled:opacity-50">توقف</button>
            <button disabled={pending} onClick={() => run(() => resumeAction(a.id), 'پرونده از سر گرفته شد.')}
              className="px-3 py-1.5 rounded-lg bg-slate-200 text-2xs font-black disabled:opacity-50">رفع توقف</button>
          </div>
        </div>

        {/* ایرانداک */}
        <div className="card p-3 space-y-2">
          <h3 className="text-xs font-black text-slate-800">۳) همانندجویی ایرانداک {a.thesisRequired ? '(الزامی برای این مقطع)' : '(این مقطع پایان‌نامه ندارد)'}</h3>
          {a.thesisRequired && (
            <>
              <div className="grid sm:grid-cols-2 gap-2">
                <input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="کد رهگیری ثبت پایان‌نامه"
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-2xs" />
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="عنوان پایان‌نامه"
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-2xs" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button disabled={pending} onClick={() => run(() => irandocAction(a.id, tracking, title), 'استعلام ایرانداک انجام شد.')}
                  className="px-3 py-1.5 rounded-lg bg-violet-700 text-white text-2xs font-black disabled:opacity-50">استعلام خودکار ایرانداک</button>
                <span className="text-2xs font-bold text-slate-600">
                  وضعیت: {a.irandocStatus ?? '—'} — درصد همانندی: {a.irandocSimilarityScore == null ? '—' : faNum(a.irandocSimilarityScore)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* تسویه موازی */}
        <div className="card p-3 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-xs font-black text-slate-800">۴) تسویه‌حساب موازی</h3>
            <div className="flex gap-2">
              <button disabled={pending} onClick={() => run(() => startClearanceAction(a.id), 'تسویه‌حساب برای همهٔ دپارتمان‌ها آغاز شد.')}
                className="px-2 py-1 rounded-lg bg-sky-700 text-white text-3xs font-black disabled:opacity-50">آغاز/تکمیل چک‌لیست</button>
              <button disabled={pending} onClick={() => run(() => autoClearanceAction(a.id), 'بررسی خودکار انجام شد.')}
                className="px-2 py-1 rounded-lg bg-emerald-700 text-white text-3xs font-black disabled:opacity-50">بررسی خودکار مجدد</button>
            </div>
          </div>
          {!d.checklist.length && <p className="text-2xs text-slate-400 font-bold">هنوز چک‌لیستی ساخته نشده است.</p>}
          <div className="grid sm:grid-cols-2 gap-2">
            {d.checklist.map(c => (
              <div key={c.id} className="border border-slate-200 rounded-xl p-2 bg-white space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-2xs font-black text-slate-800">{c.title}</span>
                  <span className={`px-2 py-0.5 rounded border text-3xs font-black ${CLEAR_STYLE[c.status] ?? ''}`}>
                    {CLEAR_LABEL[c.status] ?? c.status}{c.autoChecked ? ' (خودکار)' : ''}
                  </span>
                </div>
                {!!c.amountDue && <div className="text-3xs text-rose-700 font-bold">بدهی: {money(c.amountDue)}</div>}
                {c.detail && <div className="text-3xs text-slate-500 leading-4">{c.detail}</div>}
                <div className="flex gap-1 flex-wrap">
                  {(['CLEARED', 'HAS_DEBT', 'WAIVED'] as const).map(s => (
                    <button key={s} disabled={pending}
                      onClick={() => run(() => setClearanceAction({ checklistId: c.id, auditId: a.id, status: s, detail: `ثبت دستی کارشناس (${CLEAR_LABEL[s]})` }))}
                      className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-3xs font-bold">{CLEAR_LABEL[s]}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* گام سجاد */}
        <div className="card p-3 space-y-2">
          <h3 className="text-xs font-black text-slate-800">۵) درخواست کد صحت در سجاد (اقدام دانشجو)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-2xs">
            <Info label="وضعیت" value={
              a.sajjadStatus === 'CONFIRMED' ? '✅ کد صحت دریافت شد'
                : a.sajjadStatus === 'SKIPPED' ? '➖ معاف'
                  : a.sajjadRequestCode ? '⏳ ثبت‌شده توسط دانشجو' : '⏳ در انتظار اقدام دانشجو'} />
            <Info label="کد رهگیری سجاد" value={a.sajjadRequestCode ?? '—'} />
            <Info label="تاریخ ثبت" value={dt(a.sajjadRequestedAt)} />
          </div>
          <p className="text-3xs text-slate-500 leading-5">
            تا وقتی دانشجو کد رهگیری درخواست سجاد را ثبت نکند، پرونده به کارشناس صدور مدرک ارجاع
            نمی‌شود و «دریافت کد صحت» نیز مسدود است.
          </p>
          <button disabled={pending} onClick={() => run(() => waiveSajjadAction(a.id, 'معافیت از گام سجاد توسط کارشناس'), 'گام سجاد معاف شد.')}
            className="px-3 py-1.5 rounded-lg bg-slate-200 text-2xs font-black disabled:opacity-50">معاف‌کردن از گام سجاد</button>
        </div>

        {/* مدارک پایانی و صدور */}
        <div className="card p-3 space-y-2">
          <h3 className="text-xs font-black text-slate-800">۶) مدارک پایانی و صدور</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-2xs">
            <Info label="عکس ۴×۳" value={a.photoDocumentId ? '✅ بارگذاری شد' : '⏳ در انتظار دانشجو'} />
            <Info label="تمبر ابطال" value={Number(a.stampFeeAmount ?? 0) <= 0 ? 'غیرفعال' : a.stampFeePaid ? '✅ پرداخت شد' : `⏳ ${money(Number(a.stampFeeAmount))}`} />
            <Info label="کد صحت وزارت" value={a.note?.startsWith('کد صحت') ? a.note.replace('کد صحت: ', '') : '—'} />
            <Info label="وضعیت" value={steps.find(s => s.code === a.workflowStatus)?.title ?? a.workflowStatus} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={pending} onClick={() => run(() => advanceAction(a.id), 'وضعیت پرونده بازمحاسبه شد.')}
              className="px-3 py-1.5 rounded-lg bg-slate-200 text-2xs font-black disabled:opacity-50">بازمحاسبهٔ وضعیت</button>
            <button disabled={pending} onClick={() => run(() => issueAction({ auditId: a.id, degreeType: 'TEMPORARY' }), 'گواهینامهٔ موقت صادر شد.')}
              className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-2xs font-black disabled:opacity-50">صدور گواهینامهٔ موقت</button>
            <button disabled={pending} onClick={() => run(() => ministryCodeAction(a.id), 'کد صحت دریافت شد.')}
              className="px-3 py-1.5 rounded-lg bg-indigo-700 text-white text-2xs font-black disabled:opacity-50">دریافت کد صحت (سجاد)</button>
            <button disabled={pending} onClick={() => run(() => issueAction({
              auditId: a.id, degreeType: 'PERMANENT',
              ministryVerificationCode: a.note?.startsWith('کد صحت') ? a.note.replace('کد صحت: ', '') : undefined,
            }), 'دانشنامه صادر و به چاپخانه ارسال شد.')}
              className="px-3 py-1.5 rounded-lg bg-indigo-900 text-white text-2xs font-black disabled:opacity-50">صدور دانشنامهٔ اصلی</button>
            <button disabled={pending} onClick={() => run(() => issueAction({ auditId: a.id, degreeType: 'TRANSCRIPT' }), 'ریزنمرات رسمی صادر شد.')}
              className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-2xs font-black disabled:opacity-50">صدور ریزنمرات رسمی</button>
          </div>

          {!!d.degrees.length && (
            <table className="w-full text-3xs mt-2 rt">
              <thead className="bg-slate-50 text-slate-500"><tr>
                {['نوع', 'سریال', 'کد استعلام', 'کد صحت', 'تاریخ', 'تحویل'].map(h => <th key={h} className="p-1 text-right font-black">{h}</th>)}
              </tr></thead>
              <tbody>
                {d.degrees.map(g => (
                  <tr key={g.id} className="border-t border-slate-100">
                    <td className="p-1 font-bold">{DEGREE_LABEL[g.degreeType] ?? g.degreeType}</td>
                    <td className="p-1 font-mono">{g.serialNo}</td>
                    <td className="p-1 font-mono">
                      <a className="text-emerald-700 underline" href={`/verify-degree/${g.verifyCode}`} target="_blank" rel="noreferrer">{g.verifyCode}</a>
                    </td>
                    <td className="p-1 font-mono">{g.ministryVerificationCode ?? '—'}</td>
                    <td className="p-1">{dt(g.issuedAt)}</td>
                    <td className="p-1">
                      {g.isDelivered ? '✅' : (
                        <span className="flex gap-1">
                          <input value={deliverTo} onChange={e => setDeliverTo(e.target.value)} placeholder="تحویل به"
                            className="border border-slate-200 rounded px-1 py-0.5 w-24" />
                          <button disabled={pending} onClick={() => run(() => deliverAction(g.id, a.id, deliverTo), 'تحویل ثبت شد.')}
                            className="px-1.5 py-0.5 rounded bg-slate-200 font-black">ثبت</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {/* گزارش ارسال پیام‌ها */}
        <div className="card p-3 space-y-2">
          <h3 className="text-xs font-black text-slate-800">۷) پیام‌های ارسال‌شده به دانشجو</h3>
          {!d.deliveries.length && (
            <p className="text-2xs text-slate-400 font-bold">
              هنوز پیام بیرونی‌ای ارسال نشده است. کانال‌ها و سرویس پیامک در «تنظیمات ← پیامک و ربات‌های پیام‌رسان» پیکربندی می‌شوند.
            </p>
          )}
          {!!d.deliveries.length && (
            <table className="w-full text-3xs rt">
              <thead className="bg-slate-50 text-slate-500"><tr>
                {['رویداد', 'کانال', 'گیرنده', 'نتیجه', 'زمان'].map(h => <th key={h} className="p-1 text-right font-black">{h}</th>)}
              </tr></thead>
              <tbody>
                {d.deliveries.map(v => (
                  <tr key={v.id} className="border-t border-slate-100">
                    <td className="p-1 font-mono">{v.eventCode}</td>
                    <td className="p-1 font-bold">{v.channelLabel}</td>
                    <td className="p-1 font-mono">{v.target ?? '—'}</td>
                    <td className="p-1">
                      <span className={`px-1.5 py-0.5 rounded font-black ${
                        v.status === 'SENT' ? 'bg-emerald-100 text-emerald-800'
                          : v.status === 'FAILED' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'}`}>
                        {v.status === 'SENT' ? 'ارسال شد' : v.status === 'FAILED' ? 'ناموفق' : 'ارسال نشد'}
                      </span>
                      {v.error && <div className="text-[9px] text-slate-500 mt-0.5">{v.error}</div>}
                    </td>
                    <td className="p-1">{dt(v.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2">
      <div className="text-3xs text-slate-500 font-bold">{label}</div>
      <div className="text-2xs font-black text-slate-800">{value}</div>
    </div>
  );
}

// ───────────────── دپارتمان‌های تسویه ─────────────────

function DeptsTab({ depts, onSave, onDelete, pending }: {
  depts: Dept[]; pending: boolean;
  onSave: (d: { id?: number; code: string; title: string; autoCheck: string; apiUrl?: string; responsibleRoleCode?: string; sortOrder?: number; isActive?: boolean; hint?: string }, okText?: string) => void;
  onDelete: (id: number) => void;
}) {
  const empty = { code: '', title: '', autoCheck: 'NONE', apiUrl: '', responsibleRoleCode: '', sortOrder: 100, isActive: true, hint: '' };
  const [form, setForm] = useState<typeof empty & { id?: number }>(empty);

  return (
    <div className="grid lg:grid-cols-3 gap-3">
      <div className="card p-3 lg:col-span-2 overflow-x-auto">
        <h3 className="text-xs font-black text-slate-800 mb-2">دپارتمان‌های تسویه‌حساب (کاملاً قابل پیکربندی)</h3>
        <table className="w-full text-2xs rt">
          <thead className="bg-slate-50 text-slate-500"><tr>
            {['کد', 'عنوان', 'بررسی خودکار', 'نقش مسئول', 'ترتیب', 'فعال', ''].map(h => <th key={h} className="p-2 text-right font-black">{h}</th>)}
          </tr></thead>
          <tbody>
            {depts.sort((a, b) => a.sortOrder - b.sortOrder).map(d => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="p-2 font-mono">{d.code}</td>
                <td className="p-2 font-bold">{d.title}</td>
                <td className="p-2">{d.autoCheck === 'FINANCE_LEDGER' ? 'از دفتر مالی' : d.autoCheck === 'HTTP_API' ? 'سرویس بیرونی' : 'دستی'}</td>
                <td className="p-2 font-mono text-3xs">{d.responsibleRoleCode ?? '—'}</td>
                <td className="p-2">{faNum(d.sortOrder)}</td>
                <td className="p-2">{d.isActive ? '✅' : '⛔'}</td>
                <td className="p-2 flex gap-1">
                  <button onClick={() => setForm({ ...d, apiUrl: d.apiUrl ?? '', responsibleRoleCode: d.responsibleRoleCode ?? '', hint: d.hint ?? '' })}
                    className="px-2 py-0.5 rounded bg-slate-100 font-bold">ویرایش</button>
                  <button onClick={() => onDelete(d.id)} className="px-2 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">غیرفعال</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-3xs text-slate-500 mt-2 leading-5">
          «از دفتر مالی» یعنی سیستم خودش مانده بدهی را حساب می‌کند و اگر صفر بود بدون دخالت کارشناس سبز می‌شود.
          «سرویس بیرونی» برای کتابخانه/خوابگاه است: نشانی API باید پاسخ JSON با کلیدهای cleared و amountDue بدهد.
        </p>
      </div>

      <div className="card p-3 space-y-2">
        <h3 className="text-xs font-black text-slate-800">{form.id ? 'ویرایش دپارتمان' : 'دپارتمان جدید'}</h3>
        {([['code', 'کد لاتین'], ['title', 'عنوان فارسی'], ['responsibleRoleCode', 'کد نقش مسئول'], ['apiUrl', 'نشانی سرویس استعلام'], ['hint', 'راهنما']] as const).map(([k, l]) => (
          <label key={k} className="block">
            <span className="text-3xs font-bold text-slate-500">{l}</span>
            <input value={String(form[k] ?? '')} onChange={e => setForm({ ...form, [k]: e.target.value })}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-2xs" />
          </label>
        ))}
        <label className="block">
          <span className="text-3xs font-bold text-slate-500">نوع بررسی</span>
          <select value={form.autoCheck} onChange={e => setForm({ ...form, autoCheck: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-2xs font-bold">
            <option value="NONE">دستی (کارشناس)</option>
            <option value="FINANCE_LEDGER">خودکار از دفتر مالی</option>
            <option value="HTTP_API">خودکار از سرویس بیرونی</option>
          </select>
        </label>
        <label className="block">
          <span className="text-3xs font-bold text-slate-500">ترتیب نمایش</span>
          <input type="number" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-2xs" />
        </label>
        <label className="flex items-center gap-2 text-2xs font-bold">
          <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} /> فعال
        </label>
        <div className="flex gap-2">
          <button disabled={pending} onClick={() => onSave(form, 'ذخیره شد.')}
            className="flex-1 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-2xs font-black disabled:opacity-50">ذخیره</button>
          <button onClick={() => setForm(empty)} className="px-3 py-1.5 rounded-lg bg-slate-100 text-2xs font-black">جدید</button>
        </div>
      </div>
    </div>
  );
}

// ───────────────── خدمات دانش‌آموختگان ─────────────────

function AlumniTab({ rows, services, pending, onFilter, onResolve }: {
  rows: AlumniRow[]; services: Service[]; pending: boolean;
  onFilter: (s: string) => void;
  onResolve: (input: { requestId: number; status: 'IN_REVIEW' | 'DONE' | 'REJECTED'; note?: string }, okText?: string) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="space-y-3">
      <div className="card p-3">
        <h3 className="text-xs font-black text-slate-800 mb-2">تعرفهٔ خدمات (از تنظیمات سامانه خوانده می‌شود)</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {services.map(s => (
            <div key={s.code} className="border border-slate-200 rounded-xl p-2 bg-white">
              <div className="text-2xs font-black text-slate-800">{s.title}</div>
              <div className="text-3xs text-slate-500">{s.hint}</div>
              <div className="text-2xs font-black text-emerald-700 mt-1">{s.fee > 0 ? money(s.fee) : 'رایگان'}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-3 overflow-x-auto">
        <div className="flex gap-2 mb-2 flex-wrap">
          {['ALL', 'AWAITING_PAYMENT', 'IN_REVIEW', 'DONE', 'REJECTED'].map(s => (
            <button key={s} onClick={() => onFilter(s)} className="px-2 py-1 rounded-lg bg-slate-100 text-3xs font-black">
              {s === 'ALL' ? 'همه' : ALUMNI_STATUS[s]}
            </button>
          ))}
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="یادداشت کارشناس برای اقدام بعدی"
            className="border border-slate-200 rounded-lg px-2 py-1 text-3xs flex-1 min-w-48" />
        </div>
        <table className="w-full text-2xs rt">
          <thead className="bg-slate-50 text-slate-500"><tr>
            {['کد رهگیری', 'دانش‌آموخته', 'خدمت', 'مقصد', 'هزینه', 'وضعیت', 'تاریخ', 'اقدام'].map(h => <th key={h} className="p-2 text-right font-black">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-2 font-mono">{r.trackingCode}</td>
                <td className="p-2 font-bold">{r.fullName}<div className="font-mono text-3xs text-slate-500">{faNum(r.studentCode)}</div></td>
                <td className="p-2">{services.find(s => s.code === r.requestType)?.title ?? r.requestType}</td>
                <td className="p-2">{r.destination ?? '—'}</td>
                <td className="p-2 font-mono">{r.fee ? money(r.fee) : 'رایگان'}</td>
                <td className="p-2 font-bold">{ALUMNI_STATUS[r.status] ?? r.status}</td>
                <td className="p-2 text-3xs">{dt(r.createdAt)}</td>
                <td className="p-2 flex gap-1">
                  <button disabled={pending} onClick={() => onResolve({ requestId: r.id, status: 'DONE', note }, 'انجام شد.')}
                    className="px-2 py-0.5 rounded bg-emerald-700 text-white font-black">انجام شد</button>
                  <button disabled={pending} onClick={() => onResolve({ requestId: r.id, status: 'REJECTED', note }, 'رد شد.')}
                    className="px-2 py-0.5 rounded bg-rose-600 text-white font-black">رد</button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="p-6 text-center text-slate-400 font-bold">درخواستی ثبت نشده است.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

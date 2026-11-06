'use client';

import { useState, useTransition } from 'react';
import { THESIS_ROLE_FA, THESIS_STATUS_FA } from '@/lib/thesis-labels';
import { askConfirm } from '@/lib/ui-feedback';

type Supervision = {
  id: number; staffId: number; staffName: string;
  studentId: number | null; studentName: string; title: string;
  totalUnits: number; drawnUnits: number; remainingUnits: number;
  role: string; status: string; startTermTitle: string | null; createdAt: string | null;
};

type Draw = {
  id: number; termId: number; termTitle: string | null;
  units: number; note: string | null; createdAt: string | null;
};

type Term = { id: number; title: string; isCurrent: boolean };

const faNum = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export default function ThesisClient(props: {
  initial: Supervision[];
  terms: Term[];
  currentTermId: number | null;
  actions: {
    searchStaffAction: (q: string) => Promise<{ ok: boolean; error?: string; list?: { id: number; staffCode: string | null; name: string }[] }>;
    createAction: (input: { staffId: number; studentId: number | null; studentNameManual: string | null; title: string; totalUnits: number; role: string; startTermId: number | null }) => Promise<{ ok: boolean; error?: string; id?: number }>;
    statusAction: (id: number, status: string) => Promise<{ ok: boolean; error?: string }>;
    deleteAction: (id: number) => Promise<{ ok: boolean; error?: string }>;
    drawsAction: (supervisionId: number) => Promise<{ ok: boolean; draws?: Draw[] }>;
    addDrawAction: (supervisionId: number, termId: number, units: number, note: string | null) => Promise<{ ok: boolean; error?: string; id?: number }>;
    deleteDrawAction: (id: number) => Promise<{ ok: boolean; error?: string }>;
  };
}) {
  const { terms, actions } = props;
  const [rows, setRows] = useState<Supervision[]>(props.initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // انتخاب استاد
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: number; staffCode: string | null; name: string }[]>([]);
  const [staffId, setStaffId] = useState<number | null>(null);
  const [staffName, setStaffName] = useState('');
  const [studentName, setStudentName] = useState('');
  const [title, setTitle] = useState('');
  const [totalUnits, setTotalUnits] = useState('6');
  const [role, setRole] = useState('SUPERVISOR');
  const [startTermId, setStartTermId] = useState<number | ''>('');

  // برداشت‌ها
  const [openId, setOpenId] = useState<number | null>(null);
  const [draws, setDraws] = useState<Draw[]>([]);
  const [drawTerm, setDrawTerm] = useState<number | ''>('');
  const [drawUnits, setDrawUnits] = useState('');
  const [drawNote, setDrawNote] = useState('');

  const inputCls = 'w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm';

  function reload() {
    window.location.reload();
  }

  function doSearch() {
    start(async () => {
      const res = await actions.searchStaffAction(q);
      if (!res.ok) { setMsg(res.error ?? 'خطا در جست‌وجو.'); return; }
      setFound(res.list ?? []);
    });
  }

  function doCreate() {
    if (staffId == null) return;
    setMsg(null);
    start(async () => {
      const res = await actions.createAction({
        staffId,
        studentId: null,
        studentNameManual: studentName.trim() || null,
        title,
        totalUnits: Number(totalUnits) || 0,
        role,
        startTermId: startTermId === '' ? null : startTermId,
      });
      if (!res.ok) { setMsg(res.error ?? 'خطا در ثبت.'); return; }
      setMsg('سرجمع ثبت شد.');
      reload();
    });
  }

  function doStatus(id: number, status: string) {
    start(async () => {
      const res = await actions.statusAction(id, status);
      if (!res.ok) { setMsg(res.error ?? 'خطا.'); return; }
      setRows(rs => rs.map(r => (r.id === id ? { ...r, status } : r)));
    });
  }

  async function doDelete(id: number) {
    if (!(await askConfirm({ title: 'تأیید عملیات', body: 'این سرجمع حذف شود؟', confirmText: 'تأیید', cancelText: 'انصراف', danger: true }))) return;
    start(async () => {
      const res = await actions.deleteAction(id);
      if (!res.ok) { setMsg(res.error ?? 'خطا در حذف.'); return; }
      setRows(rs => rs.filter(r => r.id !== id));
    });
  }

  function openDraws(id: number) {
    setOpenId(id);
    setDraws([]);
    start(async () => {
      const res = await actions.drawsAction(id);
      if (res.ok) setDraws(res.draws ?? []);
    });
  }

  function doAddDraw(sup: Supervision) {
    if (drawTerm === '' || !drawUnits) return;
    start(async () => {
      const res = await actions.addDrawAction(sup.id, drawTerm, Number(drawUnits), drawNote.trim() || null);
      if (!res.ok) { setMsg(res.error ?? 'خطا در ثبت برداشت.'); return; }
      setMsg('برداشت ثبت شد.');
      setDrawUnits(''); setDrawNote('');
      reload();
    });
  }

  async function doDeleteDraw(id: number) {
    if (!(await askConfirm({ title: 'تأیید عملیات', body: 'این برداشت حذف شود؟', confirmText: 'تأیید', cancelText: 'انصراف', danger: true }))) return;
    start(async () => {
      const res = await actions.deleteDrawAction(id);
      if (!res.ok) { setMsg(res.error ?? 'خطا.'); return; }
      setDraws(ds => ds.filter(d => d.id !== id));
      reload();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-black text-slate-900">دفتر واحد باقی‌ماندهٔ پایان‌نامه</h1>
        <a href="/admin/payroll" className="text-sm text-slate-600 underline">بازگشت به میز حق‌التدریس</a>
      </div>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        هر پایان‌نامه یک «سرجمع» واحد دارد (مثلاً ۶ واحد ارشد)؛ در هر ترم فقط تا سقف باقی‌مانده می‌توان برداشت کرد. برداشتِ بیش از سقف با خطا رد می‌شود.
      </div>

      {msg ? <div className="rounded-xl border border-slate-300 bg-slate-50 p-2.5 text-sm text-slate-800">{msg}</div> : null}

      {/* ── سرجمع جدید ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="font-black text-slate-900 text-sm">ثبت سرجمع جدید</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="flex gap-2">
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doSearch(); }} className={inputCls} placeholder="جست‌وجوی استاد…" />
            <button onClick={doSearch} disabled={pending} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">جست‌وجو</button>
          </div>
          <div className="text-sm text-slate-700 flex items-center">
            {staffId != null ? <>استاد: <b className="mx-1">{staffName}</b></> : 'استادی انتخاب نشده است.'}
          </div>
          <input value={studentName} onChange={e => setStudentName(e.target.value)} className={inputCls} placeholder="نام دانشجو (دستی)" />
        </div>
        {found.length > 0 ? (
          <div className="rounded-xl border border-slate-200 divide-y text-sm">
            {found.map(s => (
              <button key={s.id} onClick={() => { setStaffId(s.id); setStaffName(s.name); setFound([]); }} className="w-full flex items-center justify-between p-2 hover:bg-slate-50">
                <span className="font-bold">{s.name}</span>
                <span className="text-xs text-slate-500 font-mono" dir="ltr">{s.staffCode}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          <div className="col-span-2">
            <label className="text-xs text-slate-500">عنوان پایان‌نامه</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-slate-500">سقف واحد</label>
            <input value={totalUnits} onChange={e => setTotalUnits(e.target.value)} className={inputCls} type="number" min="0.5" max="12" step="0.5" dir="ltr" />
          </div>
          <div>
            <label className="text-xs text-slate-500">نقش</label>
            <select value={role} onChange={e => setRole(e.target.value)} className={inputCls}>
              {Object.entries(THESIS_ROLE_FA).map(([v, fa]) => <option key={v} value={v}>{fa}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">ترم شروع</label>
            <select value={startTermId} onChange={e => setStartTermId(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls}>
              <option value="">—</option>
              {terms.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>
        </div>
        <button onClick={doCreate} disabled={pending || staffId == null || !title.trim()} className="rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 text-sm text-white disabled:opacity-50">
          ثبت سرجمع
        </button>
      </section>

      {/* ── فهرست سرجمع‌ها ── */}
      <section className="space-y-3">
        {rows.map(s => (
          <div key={s.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-slate-900 text-sm">{s.title}</div>
                <div className="text-2xs text-slate-500 mt-0.5">
                  {s.staffName} · {THESIS_ROLE_FA[s.role] ?? s.role} · دانشجو: {s.studentName}
                  {s.startTermTitle ? ` · شروع: ${s.startTermTitle}` : ''}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="w-40 h-2 rounded-full bg-slate-100 overflow-hidden" title={`برداشت‌شده ${s.drawnUnits} از ${s.totalUnits}`}>
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${s.totalUnits > 0 ? Math.min(100, (s.drawnUnits / s.totalUnits) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="text-2xs text-slate-600">
                    باقی‌مانده: <b>{faNum(s.remainingUnits)}</b> از {faNum(s.totalUnits)} واحد
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-3xs font-black ${s.status === 'ONGOING' ? 'bg-emerald-100 text-emerald-900' : s.status === 'COMPLETED' ? 'bg-indigo-100 text-indigo-900' : 'bg-slate-200 text-slate-600'}`}>
                    {THESIS_STATUS_FA[s.status] ?? s.status}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => (openId === s.id ? setOpenId(null) : openDraws(s.id))} className="px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded text-2xs font-bold">
                  {openId === s.id ? 'بستن ✕' : '📥 برداشت‌ها'}
                </button>
                {s.status === 'ONGOING' ? (
                  <button onClick={() => doStatus(s.id, 'COMPLETED')} disabled={pending} className="px-2 py-1 text-emerald-600 hover:bg-emerald-50 rounded text-2xs font-bold">تکمیل</button>
                ) : null}
                {s.status !== 'CANCELLED' ? (
                  <button onClick={() => doStatus(s.id, 'CANCELLED')} disabled={pending} className="px-2 py-1 text-amber-600 hover:bg-amber-50 rounded text-2xs font-bold">لغو</button>
                ) : null}
                <button onClick={() => doDelete(s.id)} disabled={pending} className="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded text-2xs font-bold">🗑️</button>
              </div>
            </div>

            {openId === s.id ? (
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div className="flex flex-wrap gap-2 items-end">
                  <select value={drawTerm} onChange={e => setDrawTerm(e.target.value === '' ? '' : Number(e.target.value))} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs">
                    <option value="">ترم برداشت…</option>
                    {terms.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </select>
                  <input value={drawUnits} onChange={e => setDrawUnits(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs w-24" type="number" min="0.5" max="12" step="0.5" placeholder="واحد" dir="ltr" />
                  <input value={drawNote} onChange={e => setDrawNote(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs flex-1 min-w-40" placeholder="یادداشت (اختیاری)" />
                  <button onClick={() => doAddDraw(s)} disabled={pending || drawTerm === '' || !drawUnits} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:opacity-50">
                    ثبت برداشت
                  </button>
                </div>
                {draws.length === 0 ? (
                  <div className="text-2xs text-slate-400">برداشتی ثبت نشده است.</div>
                ) : (
                  <div className="divide-y divide-slate-100 text-xs">
                    {draws.map(d => (
                      <div key={d.id} className="flex items-center justify-between py-1.5">
                        <span className="text-slate-700">{d.termTitle ?? '—'} · <b>{faNum(d.units)} واحد</b>{d.note ? ` · ${d.note}` : ''}</span>
                        <button onClick={() => doDeleteDraw(d.id)} disabled={pending} className="text-rose-600 text-2xs">حذف</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ))}
        {rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">سرجمعی ثبت نشده است.</div>
        ) : null}
      </section>
    </div>
  );
}

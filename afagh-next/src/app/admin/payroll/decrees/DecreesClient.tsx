'use client';

import { useState, useTransition } from 'react';
import { DECREE_SECTION_FA } from '@/lib/decree-labels';
import { askConfirm } from '@/lib/ui-feedback';

type Decree = {
  id: number; staffId: number; staffName: string; staffCode: string | null;
  termId: number; termTitle: string | null; secretariatNo: number;
  status: string; issuedAt: string | null; createdAt: string | null;
};

type DecreeDetail = Decree & {
  signers: { title: string; name: string }[];
  issuedByName: string | null;
  items: { id: number; section: string; title: string; units: number | null; amount: number | null }[];
};

type Term = { id: number; title: string; isCurrent: boolean };

const faNum = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const money = (n: number | null) =>
  n === null ? '—' : faNum(Math.round(Number(n || 0)).toLocaleString('en-US')) + ' ریال';

export default function DecreesClient(props: {
  initial: Decree[];
  terms: Term[];
  currentTermId: number | null;
  statusFa: Record<string, string>;
  actions: {
    searchStaffAction: (q: string) => Promise<{ ok: boolean; error?: string; list?: { id: number; staffCode: string | null; name: string }[] }>;
    listAction: (termId: number) => Promise<{ ok: boolean; list?: Decree[] }>;
    issueAction: (staffId: number, termId: number, signers: { title: string; name: string }[]) => Promise<{ ok: boolean; error?: string; id?: number }>;
    detailAction: (id: number) => Promise<{ ok: boolean; error?: string; decree?: DecreeDetail }>;
    finalizeAction: (id: number) => Promise<{ ok: boolean; error?: string }>;
    deleteAction: (id: number) => Promise<{ ok: boolean; error?: string }>;
  };
}) {
  const { terms, statusFa, actions } = props;
  const [rows, setRows] = useState<Decree[]>(props.initial);
  const [termId, setTermId] = useState<number | null>(props.currentTermId);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: number; staffCode: string | null; name: string }[]>([]);
  const [staffId, setStaffId] = useState<number | null>(null);
  const [staffName, setStaffName] = useState('');
  const [signers, setSigners] = useState<{ title: string; name: string }[]>([
    { title: '', name: '' }, { title: '', name: '' },
  ]);

  const [detail, setDetail] = useState<DecreeDetail | null>(null);

  const inputCls = 'w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm';

  function changeTerm(tid: number) {
    setTermId(tid);
    setDetail(null);
    start(async () => {
      const res = await actions.listAction(tid);
      if (res.ok) setRows(res.list ?? []);
    });
  }

  function doSearch() {
    start(async () => {
      const res = await actions.searchStaffAction(q);
      if (!res.ok) { setMsg(res.error ?? 'خطا در جست‌وجو.'); return; }
      setFound(res.list ?? []);
    });
  }

  function doIssue() {
    if (staffId == null || termId == null) return;
    setMsg(null);
    start(async () => {
      const res = await actions.issueAction(staffId, termId, signers);
      if (!res.ok) { setMsg(res.error ?? 'خطا در صدور.'); return; }
      setMsg(`پیش‌نویس ابلاغ صادر شد.`);
      setStaffId(null); setStaffName('');
      const r = await actions.listAction(termId);
      if (r.ok) setRows(r.list ?? []);
    });
  }

  function openDetail(id: number) {
    start(async () => {
      const res = await actions.detailAction(id);
      if (!res.ok) { setMsg(res.error ?? 'خطا.'); return; }
      setDetail(res.decree ?? null);
    });
  }

  async function doFinalize(id: number) {
    if (!(await askConfirm({ title: 'تأیید عملیات', body: 'ابلاغ نهایی و صادر شود؟ پس از صدور قابل حذف نیست.', confirmText: 'تأیید', cancelText: 'انصراف', danger: true }))) return;
    start(async () => {
      const res = await actions.finalizeAction(id);
      if (!res.ok) { setMsg(res.error ?? 'خطا.'); return; }
      setMsg('ابلاغ صادر شد.');
      setDetail(d => (d ? { ...d, status: 'ISSUED' } : d));
      if (termId != null) {
        const r = await actions.listAction(termId);
        if (r.ok) setRows(r.list ?? []);
      }
    });
  }

  async function doDelete(id: number) {
    if (!(await askConfirm({ title: 'تأیید عملیات', body: 'پیش‌نویس ابلاغ حذف شود؟', confirmText: 'تأیید', cancelText: 'انصراف', danger: true }))) return;
    start(async () => {
      const res = await actions.deleteAction(id);
      if (!res.ok) { setMsg(res.error ?? 'خطا.'); return; }
      setRows(rs => rs.filter(r => r.id !== id));
      setDetail(null);
    });
  }

  const grouped = detail
    ? Object.entries(
        detail.items.reduce<Record<string, typeof detail.items>>((m, it) => {
          (m[it.section] = m[it.section] ?? []).push(it);
          return m;
        }, {}),
      )
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black text-slate-900">ابلاغ‌های آموزشی</h1>
        <div className="flex items-center gap-2">
          <select value={termId ?? ''} onChange={e => changeTerm(Number(e.target.value))} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            {terms.map(t => <option key={t.id} value={t.id}>{t.title}{t.isCurrent ? ' (جاری)' : ''}</option>)}
          </select>
          <a href="/admin/payroll" className="text-sm text-slate-600 underline">بازگشت</a>
        </div>
      </div>

      {msg ? <div className="rounded-xl border border-slate-300 bg-slate-50 p-2.5 text-sm text-slate-800">{msg}</div> : null}

      {/* ── صدور ابلاغ ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="font-black text-slate-900 text-sm">صدور ابلاغ جدید (شمارهٔ دبیرخانهٔ خودکار)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="flex gap-2">
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doSearch(); }} className={inputCls} placeholder="جست‌وجوی استاد…" />
            <button onClick={doSearch} disabled={pending} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">جست‌وجو</button>
          </div>
          <div className="text-sm text-slate-700 flex items-center">
            {staffId != null ? <>استاد: <b className="mx-1">{staffName}</b></> : 'استادی انتخاب نشده است.'}
          </div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {signers.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input value={s.title} onChange={e => setSigners(sg => sg.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className={inputCls} placeholder={`سمت امضاکنندهٔ ${faNum(i + 1)}`} />
              <input value={s.name} onChange={e => setSigners(sg => sg.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={inputCls} placeholder="نام امضاکننده" />
            </div>
          ))}
        </div>
        <button onClick={doIssue} disabled={pending || staffId == null || termId == null} className="rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 text-sm text-white disabled:opacity-50">
          صدور پیش‌نویس ابلاغ
        </button>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* ── فهرست ── */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="font-black text-slate-900 text-sm">فهرست ابلاغ‌ها</h2>
          <div className="space-y-2">
            {rows.map(r => (
              <button
                key={r.id}
                onClick={() => openDetail(r.id)}
                className={`w-full text-right rounded-2xl border p-3 hover:bg-slate-50 ${detail?.id === r.id ? 'border-indigo-400 bg-indigo-50/40' : 'border-slate-200'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm text-slate-900">{r.staffName}</span>
                  <span className={`px-2 py-0.5 rounded-full text-3xs font-black ${r.status === 'ISSUED' ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-900'}`}>
                    {statusFa[r.status] ?? r.status}
                  </span>
                </div>
                <div className="text-2xs text-slate-500 mt-1">
                  شماره دبیرخانه: <b className="font-mono" dir="ltr">#{faNum(r.secretariatNo)}</b> · {r.termTitle ?? '—'}
                </div>
              </button>
            ))}
            {rows.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">ابلاغی در این ترم ثبت نشده است.</div>
            ) : null}
          </div>
        </section>

        {/* ── جزئیات ── */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 lg:sticky lg:top-4">
          {!detail ? (
            <div className="p-6 text-center text-xs text-slate-400">یک ابلاغ را انتخاب کنید.</div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                <div>
                  <div className="font-black text-slate-900 text-sm">
                    ابلاغ #{faNum(detail.secretariatNo)} — {detail.staffName}
                  </div>
                  <div className="text-2xs text-slate-500 mt-0.5">
                    {detail.termTitle ?? '—'}
                    {detail.issuedByName ? ` · صادرکننده: ${detail.issuedByName}` : ''}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {detail.status === 'DRAFT' ? (
                    <>
                      <button onClick={() => doFinalize(detail.id)} disabled={pending} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-2 py-1 text-xs text-white disabled:opacity-50">نهایی‌سازی</button>
                      <button onClick={() => doDelete(detail.id)} disabled={pending} className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-50">حذف پیش‌نویس</button>
                    </>
                  ) : null}
                </div>
              </div>
              {grouped.map(([section, items]) => (
                <div key={section}>
                  <h3 className="text-xs font-black text-slate-700 mb-1">{DECREE_SECTION_FA[section] ?? section}</h3>
                  <div className="divide-y divide-slate-100 text-xs border border-slate-100 rounded-xl overflow-hidden">
                    {items.map(it => (
                      <div key={it.id} className="flex items-center justify-between gap-2 p-2">
                        <span className="text-slate-700">{it.title}</span>
                        <span className="text-slate-500 whitespace-nowrap text-2xs">
                          {it.units != null ? `${faNum(it.units)} واحد · ` : ''}{money(it.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {detail.signers.length > 0 ? (
                <div>
                  <h3 className="text-xs font-black text-slate-700 mb-1">امضاکنندگان</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {detail.signers.map((s, i) => (
                      <div key={i} className="border border-slate-200 rounded-xl p-2 text-center text-xs">
                        <div className="text-slate-500">{s.title || '—'}</div>
                        <div className="font-bold text-slate-800 mt-3">{s.name || '—'}</div>
                        <div className="text-slate-300 text-3xs mt-1">امضا و مهر</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import {
  approveProposalAction,
  boardAction,
  recordDefenseResultAction,
  saveJuryPoolAction,
  scheduleDefenseAction,
  supervisorApproveDefenseAction,
  toggleJuryPoolAction,
} from './actions';

type Board = Extract<Awaited<ReturnType<typeof boardAction>>, { ok: true }>['board'];
type BoardRow = Board['groups'][number]['rows'][number];
type PoolRow = Board['pools'][number];
type ActionResult = { ok: true; board: Board } | { ok: false; error: string };

const faNum = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const faDate = (v: string | Date | null | undefined) =>
  !v ? '—' : new Date(v).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const PROPOSAL_FA: Record<string, string> = {
  NOT_STARTED: 'شروع نشده',
  SUBMITTED: 'ارسال‌شده',
  SIMILARITY_CHECK: 'در حال بررسی همانندجویی',
  SIMILARITY_PASSED: 'همانندجویی تأیید شد — آمادهٔ تأیید کارشناس',
  SIMILARITY_HIGH: 'همانندجویی بالا — نیازمند اصلاح',
  EXPERT_REVIEW: 'در دست بررسی کارشناس',
  APPROVED: 'تأیید‌شده و بارگذاری‌شده در ایرانداک',
  REJECTED: 'ردشده',
  PRIOR_REJECTED: 'پیشینهٔ عنوان ردشده',
};
const DEFENSE_FA: Record<string, string> = {
  NOT_REQUESTED: 'درخواست دفاع ثبت نشده',
  SUPERVISOR_REVIEW: 'در انتظار تأیید استاد راهنما',
  SUPERVISOR_REJECTED: 'ردشده توسط استاد راهنما',
  EXPERT_REVIEW: 'در انتظار تعیین وقت توسط کارشناس',
  SCHEDULED: 'زمان‌بندی شده',
  CONDUCTED: 'برگزار شده',
  PASSED: 'دفاع قبول ✅',
  FAILED: 'دفاع مردود ❌',
};
const RESULT_FA: Record<string, string> = { PASSED: 'قبول', FAILED: 'مردود', CONDITIONAL: 'قبول مشروط' };
const FINAL_IRANDOC_FA: Record<string, string> = { PENDING: 'در انتظار استعلام', PASSED: 'قبول ✅', REJECTED: 'رد ❌' };

type Draft = { tracking: string; scheduledAt: string; conductedAt: string; result: string; minutes: string };
const emptyDraft = (r?: Partial<BoardRow>): Draft => ({
  tracking: r?.irandocUploadTracking ?? '',
  scheduledAt: toLocalInput(r?.defenseScheduledAt ?? null),
  conductedAt: toLocalInput(r?.defenseConductedAt ?? null),
  result: r?.defenseResult ?? 'PASSED',
  minutes: r?.defenseNote ?? '',
});

const emptyPoolForm = () => ({
  departmentCode: '', majorId: '', chairId: '', internalIds: [] as string[],
  externalIds: [] as string[], roomId: '', isActive: true,
});

export default function DefenseSchedulingClient({ initial }: { initial: Board }) {
  const [board, setBoard] = useState<Board>(initial);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [tab, setTab] = useState<'BOARD' | 'POOLS'>('BOARD');
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [pending, start] = useTransition();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [poolForm, setPoolForm] = useState(emptyPoolForm());

  const draftOf = (r: BoardRow) => drafts[r.auditId] ?? emptyDraft(r);
  const setDraft = (auditId: number, patch: Partial<Draft>) =>
    setDrafts(prev => ({ ...prev, [auditId]: { ...(prev[auditId] ?? emptyDraft()), ...patch } }));

  const run = (fn: () => Promise<ActionResult>, okText: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { setBoard(r.board); setMsg({ kind: 'ok', text: okText }); }
      else setMsg({ kind: 'err', text: r.error });
    });

  const refresh = () => run(async () => boardAction(), 'فهرست به‌روزرسانی شد.');

  const openPool = (p: PoolRow | null) => {
    setEditingId(p ? p.id : 0);
    setPoolForm(p
      ? {
          departmentCode: p.departmentCode,
          majorId: p.majorId != null ? String(p.majorId) : '',
          chairId: p.chairId != null ? String(p.chairId) : '',
          internalIds: p.internalIds.map(String),
          externalIds: p.externalIds.map(String),
          roomId: p.roomId != null ? String(p.roomId) : '',
          isActive: p.isActive,
        }
      : emptyPoolForm());
  };

  const submitPool = () => run(async () =>
    saveJuryPoolAction({
      id: editingId ?? undefined,
      departmentCode: poolForm.departmentCode,
      majorId: poolForm.majorId ? Number(poolForm.majorId) : null,
      chairId: poolForm.chairId ? Number(poolForm.chairId) : null,
      internalIds: poolForm.internalIds.join(','),
      externalIds: poolForm.externalIds.join(','),
      roomId: poolForm.roomId ? Number(poolForm.roomId) : null,
      isActive: poolForm.isActive,
    }), 'استخر هیأت داوران ذخیره شد.');

  const total = board.groups.reduce((s, g) => s + g.rows.length, 0);
  // فقط کارشناسان (board.canManage) ابزار مدیریت میز را می‌بینند؛ استاد راهنما و
  // مدیر گروه نه زبانهٔ «استخر هیأت داوران» را می‌بینند نه پنل‌های کارشناسیِ هر ردیف.
  // زبانهٔ فعال هم مشتق از همین پرچم است تا با نبودِ زبانهٔ استخر، شماره/ترتیبِ زبانه‌ها به‌هم نریزد.
  const activeTab = board.canManage ? tab : 'BOARD';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-slate-300 overflow-hidden text-xs font-black">
          <button onClick={() => setTab('BOARD')}
            className={`px-3 py-2 ${activeTab === 'BOARD' ? 'bg-indigo-700 text-white' : 'bg-white text-slate-600'}`}>
            میز کار دفاع ({faNum(total)})
          </button>
          {board.canManage && (
            <button onClick={() => setTab('POOLS')}
              className={`px-3 py-2 ${activeTab === 'POOLS' ? 'bg-indigo-700 text-white' : 'bg-white text-slate-600'}`}>
              استخر هیأت داوران ({faNum(board.pools.length)})
            </button>
          )}
        </div>
        <button onClick={refresh} disabled={pending}
          className="px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-black disabled:opacity-50">به‌روزرسانی فهرست</button>
      </div>

      {msg && (
        <div className={`card p-3 text-xs font-bold ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {msg.text} <button className="float-left text-slate-400" onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {activeTab === 'BOARD' && (
        <div className="space-y-4">
          {total === 0 && (
            <div className="card p-5 text-xs text-slate-500 text-center">
              هیچ پروندهٔ پایان‌نامه‌ای در این فهرست نیست. پرونده‌ها پس از ثبت عنوان توسط دانشجو اینجا ظاهر می‌شوند.
            </div>
          )}
          {board.groups.map(g => (
            <section key={g.status} className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-800">{PROPOSAL_FA[g.status] ?? g.status}</h2>
                <span className="badge bg-slate-100 text-slate-700 font-mono">{g.status}</span>
              </div>
              {g.rows.map(r => (
                <Row key={r.thesisProgressId} r={r} d={draftOf(r)} pending={pending}
                  canManage={board.canManage}
                  isSupervisor={r.supervisorUserId != null && r.supervisorUserId === board.currentUserId}
                  onPatch={patch => setDraft(r.auditId, patch)}
                  onApprove={() => run(() => approveProposalAction({ auditId: r.auditId, irandocTrackingCode: draftOf(r).tracking }),
                    'پروپوزال تأیید و کد رهگیری ایرانداک ثبت شد.')}
                  onSupervisor={approved => run(() => supervisorApproveDefenseAction({ auditId: r.auditId, approved }),
                    approved ? 'درخواست دفاع تأیید شد.' : 'درخواست دفاع به دانشجو بازگردانده شد.')}
                  onSchedule={() => run(() => scheduleDefenseAction({ auditId: r.auditId, scheduledAt: draftOf(r).scheduledAt }),
                    'وقت دفاع و هیأت داوران تعیین شد.')}
                  onResult={() => run(() => recordDefenseResultAction({
                    auditId: r.auditId,
                    result: draftOf(r).result as 'PASSED' | 'FAILED' | 'CONDITIONAL',
                    minutes: draftOf(r).minutes,
                    conductedAt: draftOf(r).conductedAt,
                  }), 'نتیجهٔ دفاع ثبت شد.')} />
              ))}
            </section>
          ))}
        </div>
      )}

      {activeTab === 'POOLS' && (
        <div className="space-y-3">
          <div className="card p-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xs text-slate-600 leading-5">
              هنگام تعیین وقت دفاع، اتاق و اعضای هیأت داوران خودکار از استخرِ همین رشته (و در صورت نبود، استخر عمومی) انتخاب می‌شود.
            </p>
            <button onClick={() => openPool(null)}
              className="px-3 py-1.5 rounded-lg bg-indigo-700 text-white text-xs font-black">افزودن استخر جدید</button>
          </div>

          {board.pools.length === 0 && (
            <div className="card p-5 text-xs text-slate-500 text-center">
              استخری ثبت نشده است؛ بدون استخر، موتور برنامه‌ریزی اتاق دفاع را از بزرگ‌ترین سالن دانشکده انتخاب می‌کند.
            </div>
          )}

          {board.pools.map(p => (
            <div key={p.id} className={`card p-3 space-y-1 ${p.isActive ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-black text-slate-800">
                  {p.departmentCode} — {p.majorName ?? 'همهٔ رشته‌ها'}
                  <span className={`badge ms-2 ${p.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                    {p.isActive ? 'فعال' : 'غیرفعال'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openPool(p)}
                    className="px-2 py-1 rounded-lg bg-slate-100 text-2xs font-black">ویرایش</button>
                  <button onClick={() => run(() => toggleJuryPoolAction(p.id, !p.isActive), 'وضعیت استخر تغییر کرد.')}
                    className="px-2 py-1 rounded-lg bg-slate-200 text-2xs font-black">
                    {p.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                  </button>
                </div>
              </div>
              <div className="text-2xs text-slate-600">
                اتاق: {p.roomName ?? '—'} · رئیس هیأت: {board.staffOptions.find(s => s.id === p.chairId)?.name ?? '—'} ·
                داخلی: {faNum(p.internalIds.length)} نفر · خارجی: {faNum(p.externalIds.length)} نفر
              </div>
            </div>
          ))}

          {editingId !== null && (
            <div className="card p-4 border-2 border-indigo-300 space-y-3">
              <h3 className="text-sm font-black text-indigo-900">{editingId === 0 ? 'استخر جدید' : 'ویرایش استخر'}</h3>
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-2xs font-bold text-slate-700">دپارتمان / گروه آموزشی</span>
                  <select value={poolForm.departmentCode} onChange={e => setPoolForm(f => ({ ...f, departmentCode: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white">
                    <option value="">انتخاب کنید</option>
                    {board.departments.map(d => <option key={d.code} value={d.code}>{d.name} ({d.code})</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-2xs font-bold text-slate-700">رشته (خالی = همهٔ رشته‌ها)</span>
                  <select value={poolForm.majorId} onChange={e => setPoolForm(f => ({ ...f, majorId: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white">
                    <option value="">عمومی</option>
                    {board.majors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-2xs font-bold text-slate-700">رئیس هیأت داوران</span>
                  <select value={poolForm.chairId} onChange={e => setPoolForm(f => ({ ...f, chairId: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white">
                    <option value="">—</option>
                    {board.staffOptions.map(s => <option key={s.id} value={s.id}>{s.name}{s.rank ? ` — ${s.rank}` : ''}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-2xs font-bold text-slate-700">اتاق دفاع</span>
                  <select value={poolForm.roomId} onChange={e => setPoolForm(f => ({ ...f, roomId: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white">
                    <option value="">—</option>
                    {board.rooms.map(r => <option key={r.id} value={r.id}>{r.name} (ظرفیت {faNum(r.capacity)})</option>)}
                  </select>
                </label>
              </div>
              <MultiSelect label="داوران داخلی (چند انتخاب)" options={board.staffOptions} value={poolForm.internalIds}
                onChange={v => setPoolForm(f => ({ ...f, internalIds: v }))} />
              <MultiSelect label="داوران خارجی (چند انتخاب)" options={board.staffOptions} value={poolForm.externalIds}
                onChange={v => setPoolForm(f => ({ ...f, externalIds: v }))} />
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={poolForm.isActive}
                  onChange={e => setPoolForm(f => ({ ...f, isActive: e.target.checked }))} />
                استخر فعال باشد
              </label>
              <div className="flex gap-2">
                <button onClick={submitPool} disabled={pending}
                  className="px-3 py-2 rounded-lg bg-indigo-700 text-white text-xs font-black disabled:opacity-50">ذخیرهٔ استخر</button>
                <button onClick={() => setEditingId(null)}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-xs font-black">انصراف</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  r, d, pending, canManage, isSupervisor, onPatch, onApprove, onSupervisor, onSchedule, onResult,
}: {
  r: BoardRow;
  d: Draft;
  pending: boolean;
  canManage: boolean;
  isSupervisor: boolean;
  onPatch: (patch: Partial<Draft>) => void;
  onApprove: () => void;
  onSupervisor: (approved: boolean) => void;
  onSchedule: () => void;
  onResult: () => void;
}) {
  const proposalOpen = r.proposalStatus === 'SIMILARITY_PASSED' || r.proposalStatus === 'EXPERT_REVIEW';
  const defense = r.defenseRequestStatus ?? 'NOT_REQUESTED';

  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-black text-slate-800">
            {r.fullName} <span className="font-mono text-3xs text-slate-500">({r.studentCode})</span>
          </div>
          <div className="text-3xs text-slate-500">{r.majorName ?? '—'} · راهنما: {r.supervisorName ?? '—'}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="badge bg-slate-100 text-slate-700">{DEFENSE_FA[defense] ?? defense}</span>
          {r.sessionStatus && <span className="badge bg-sky-100 text-sky-800">جلسه: {r.sessionStatus}</span>}
          {r.finalIrandocStatus && (
            <span className={`badge ${r.finalIrandocStatus === 'REJECTED' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'}`}>
              ایرانداک نهایی: {FINAL_IRANDOC_FA[r.finalIrandocStatus] ?? r.finalIrandocStatus}
            </span>
          )}
        </div>
      </div>

      <div className="text-2xs text-slate-600 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-1">
        <span>عنوان: {r.titleFa ?? '—'}</span>
        <span>همانندجویی پروپوزال: {faNum(r.proposalSimilarity)}٪</span>
        <span>کد ایرانداک: <span className="font-mono">{r.irandocUploadTracking ?? '—'}</span></span>
        <span>زمان دفاع: {faDate(r.defenseScheduledAt)}</span>
        <span>اتاق: {r.roomName ?? '—'}</span>
        <span>گزارش بعدی: {faDate(r.nextProgressReportDue)}</span>
        {(r.jury.chair || r.jury.supervisor || r.jury.internal || r.jury.external) && (
          <span className="sm:col-span-2 lg:col-span-3">
            هیأت داوران — رئیس: {r.jury.chair ?? '—'} · راهنما: {r.jury.supervisor ?? '—'} · داخلی: {r.jury.internal ?? '—'} · خارجی: {r.jury.external ?? '—'}
          </span>
        )}
      </div>

      {canManage && proposalOpen && (
        <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/60 p-2.5 space-y-2">
          <div className="text-2xs font-black text-emerald-900">تأیید پروپوزال + ثبت کد رهگیری بارگذاری در ایرانداک</div>
          <div className="flex flex-wrap gap-2 items-center">
            <input value={d.tracking} onChange={e => onPatch({ tracking: e.target.value })} dir="ltr"
              placeholder="کد رهگیری ایرانداک"
              className="border border-emerald-200 rounded-lg px-3 py-1.5 text-xs font-mono min-w-52" />
            <button onClick={onApprove} disabled={pending}
              className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-black disabled:opacity-50">
              تأیید پروپوزال
            </button>
          </div>
        </div>
      )}

      {defense === 'SUPERVISOR_REVIEW' && (
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50/60 p-2.5 space-y-2">
          <div className="text-2xs font-black text-amber-900">
            {isSupervisor
              ? 'شما استاد راهنمای این پرونده هستید؛ تصمیم شما ثبت می‌شود.'
              : `در انتظار تأیید استاد راهنما (${r.supervisorName ?? '—'}) — این دکمه فقط برای همان استاد فعال است.`}
          </div>
          <div className="flex gap-2">
            <button onClick={() => onSupervisor(true)} disabled={pending || !isSupervisor}
              className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-black disabled:opacity-40">تأیید درخواست دفاع</button>
            <button onClick={() => onSupervisor(false)} disabled={pending || !isSupervisor}
              className="px-3 py-1.5 rounded-lg bg-rose-700 text-white text-xs font-black disabled:opacity-40">رد درخواست</button>
          </div>
        </div>
      )}

      {canManage && defense === 'EXPERT_REVIEW' && (
        <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/60 p-2.5 space-y-2">
          <div className="text-2xs font-black text-indigo-900">تعیین وقت دفاع</div>
          {r.pool && (
            <div className="text-3xs text-indigo-900 leading-5">
              استخر داوری انتخابی: <b>{r.pool.departmentCode}</b> — اتاق: <b>{r.pool.roomName ?? 'اتاق خودکار دانشکده'}</b> ·
              رئیس: <b>{r.pool.chair ?? '—'}</b> · داخلی: <b>{r.pool.internal ?? '—'}</b> · خارجی: <b>{r.pool.external ?? '—'}</b>
            </div>
          )}
          <div className="flex flex-wrap gap-2 items-center">
            <input type="datetime-local" value={d.scheduledAt} onChange={e => onPatch({ scheduledAt: e.target.value })}
              className="border border-indigo-200 rounded-lg px-3 py-1.5 text-xs" />
            <button onClick={onSchedule} disabled={pending}
              className="px-3 py-1.5 rounded-lg bg-indigo-700 text-white text-xs font-black disabled:opacity-50">ثبت وقت دفاع</button>
          </div>
        </div>
      )}

      {canManage && defense === 'SCHEDULED' && (
        <div className="rounded-xl border-2 border-sky-200 bg-sky-50/60 p-2.5 space-y-2">
          <div className="text-2xs font-black text-sky-900">ثبت نتیجهٔ دفاع و صورت‌جلسه</div>
          <div className="flex flex-wrap gap-2 items-center">
            <input type="datetime-local" value={d.conductedAt} onChange={e => onPatch({ conductedAt: e.target.value })}
              className="border border-sky-200 rounded-lg px-3 py-1.5 text-xs" />
            <select value={d.result} onChange={e => onPatch({ result: e.target.value })}
              className="border border-sky-200 rounded-lg px-3 py-1.5 text-xs bg-white">
              {Object.entries(RESULT_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button onClick={onResult} disabled={pending}
              className="px-3 py-1.5 rounded-lg bg-sky-800 text-white text-xs font-black disabled:opacity-50">ثبت نتیجهٔ دفاع</button>
          </div>
          <textarea value={d.minutes} onChange={e => onPatch({ minutes: e.target.value })} rows={2}
            placeholder="صورت‌جلسهٔ دفاع (خلاصهٔ رأی هیأت، نکات اصلاحی و …)"
            className="w-full border border-sky-200 rounded-lg px-3 py-2 text-xs" />
        </div>
      )}
    </div>
  );
}

function MultiSelect({
  label, options, value, onChange,
}: {
  label: string;
  options: { id: number; name: string; rank: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <label className="block">
      <span className="text-2xs font-bold text-slate-700">{label}</span>
      <select multiple value={value} size={4}
        onChange={e => onChange(Array.from(e.target.selectedOptions).map(o => o.value))}
        className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white">
        {options.map(o => <option key={o.id} value={o.id}>{o.name}{o.rank ? ` — ${o.rank}` : ''}</option>)}
      </select>
    </label>
  );
}
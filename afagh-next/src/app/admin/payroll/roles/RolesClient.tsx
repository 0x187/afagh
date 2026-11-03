'use client';

import { useState, useTransition } from 'react';
import { askConfirm } from '@/lib/ui-feedback';

type Role = {
  id: number; code: string; title: string;
  dutyUnits: number | null; reductionUnits: number;
  isTeaching: boolean; sortOrder: number;
};

type Term = { id: number; title: string; termCode: string; isCurrent: boolean };

type Assigned = {
  assignmentId: number; roleId: number; code: string; title: string;
  dutyUnits: number | null; reductionUnits: number;
  isTeaching: boolean; sortOrder: number; isPrimary: boolean;
};

type Actions = {
  searchStaffAction: (q: string) => Promise<{ ok: boolean; error?: string; list?: { id: number; staffCode: string | null; name: string; rank: string | null }[] }>;
  assignmentsAction: (staffId: number, termId: number) => Promise<{ ok: boolean; assigned?: Assigned[]; effectiveDuty?: number | null; fallbackDuty?: number }>;
  createRoleAction: (input: { code: string; title: string; dutyUnits: number | null; reductionUnits: number; isTeaching: boolean; sortOrder: number }) => Promise<{ ok: boolean; error?: string; role?: Role }>;
  updateRoleAction: (id: number, patch: { title: string; dutyUnits: number | null; reductionUnits: number; isTeaching: boolean; sortOrder: number }) => Promise<{ ok: boolean; error?: string }>;
  deleteRoleAction: (id: number) => Promise<{ ok: boolean; error?: string }>;
  assignRoleAction: (staffId: number, termId: number, roleId: number, isPrimary: boolean) => Promise<{ ok: boolean; error?: string }>;
  unassignRoleAction: (assignmentId: number) => Promise<{ ok: boolean; error?: string }>;
};

const inputCls = 'w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm';
const btnPrimary = 'rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50';
const btnDanger = 'rounded-lg border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-50';

export default function RolesClient(props: {
  initialRoles: Role[]; terms: Term[]; currentTermId: number | null; actions: Actions;
}) {
  const { terms, currentTermId, actions } = props;
  const [roles, setRoles] = useState<Role[]>(props.initialRoles);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // ── فرم سمت جدید ──
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [duty, setDuty] = useState('');
  const [reduction, setReduction] = useState('0');
  const [isTeaching, setIsTeaching] = useState(true);
  const [sort, setSort] = useState('0');

  // ── ویرایش سطری ──
  const [editingId, setEditingId] = useState<number | null>(null);
  const [edit, setEdit] = useState({ title: '', duty: '', reduction: '0', isTeaching: true, sort: '0' });

  // ── انتساب ترمی ──
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: number; staffCode: string | null; name: string; rank: string | null }[]>([]);
  const [staffId, setStaffId] = useState<number | null>(null);
  const [staffName, setStaffName] = useState('');
  const [termId, setTermId] = useState<number | null>(currentTermId);
  const [assigned, setAssigned] = useState<Assigned[]>([]);
  const [effective, setEffective] = useState<number | null>(null);
  const [fallback, setFallback] = useState(0);
  const [rolePick, setRolePick] = useState<number | ''>('');
  const [primaryPick, setPrimaryPick] = useState(false);

  const numOrNull = (v: string): number | null => {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  function refreshAssignments(sid: number, tid: number) {
    start(async () => {
      const res = await actions.assignmentsAction(sid, tid);
      if (res.ok) {
        setAssigned(res.assigned ?? []);
        setEffective(res.effectiveDuty ?? null);
        setFallback(res.fallbackDuty ?? 0);
      }
    });
  }

  function doCreate() {
    setMsg(null);
    start(async () => {
      const res = await actions.createRoleAction({
        code, title,
        dutyUnits: numOrNull(duty),
        reductionUnits: Number(reduction) || 0,
        isTeaching, sortOrder: Number(sort) || 0,
      });
      if (!res.ok || !res.role) { setMsg(res.error ?? 'خطا در ساخت سمت.'); return; }
      setRoles(r => [...r, res.role as Role].sort((a, b) => a.sortOrder - b.sortOrder));
      setCode(''); setTitle(''); setDuty(''); setReduction('0'); setIsTeaching(true); setSort('0');
      setMsg('سمت ساخته شد.');
    });
  }

  function doUpdate(id: number) {
    setMsg(null);
    start(async () => {
      const res = await actions.updateRoleAction(id, {
        title: edit.title,
        dutyUnits: numOrNull(edit.duty),
        reductionUnits: Number(edit.reduction) || 0,
        isTeaching: edit.isTeaching,
        sortOrder: Number(edit.sort) || 0,
      });
      if (!res.ok) { setMsg(res.error ?? 'خطا در ویرایش.'); return; }
      setRoles(rs => rs.map(r => r.id === id
        ? { ...r, title: edit.title.trim(), dutyUnits: numOrNull(edit.duty), reductionUnits: Number(edit.reduction) || 0, isTeaching: edit.isTeaching, sortOrder: Number(edit.sort) || 0 }
        : r).sort((a, b) => a.sortOrder - b.sortOrder));
      setEditingId(null);
      setMsg('ویرایش ذخیره شد.');
    });
  }

  async function doDelete(id: number) {
    const ok = await askConfirm({ title: 'حذف سمت', body: 'این سمت حذف شود؟ انتساب‌های ترمی آن هم پاک می‌شود.', confirmText: 'حذف کن', danger: true });
    if (!ok) return;
    start(async () => {
      const res = await actions.deleteRoleAction(id);
      if (!res.ok) { setMsg(res.error ?? 'خطا در حذف.'); return; }
      setRoles(rs => rs.filter(r => r.id !== id));
      setMsg('سمت حذف شد.');
    });
  }

  function doSearch() {
    start(async () => {
      const res = await actions.searchStaffAction(q);
      if (!res.ok) { setMsg(res.error ?? 'خطا در جست‌وجو.'); return; }
      setFound(res.list ?? []);
    });
  }

  function pickStaff(s: { id: number; name: string }) {
    setStaffId(s.id);
    setStaffName(s.name);
    setFound([]);
    if (termId) refreshAssignments(s.id, termId);
  }

  function doAssign() {
    if (staffId == null || termId == null || rolePick === '') return;
    start(async () => {
      const res = await actions.assignRoleAction(staffId, termId, rolePick as number, primaryPick);
      if (!res.ok) { setMsg(res.error ?? 'خطا در انتساب.'); return; }
      setRolePick('');
      setPrimaryPick(false);
      refreshAssignments(staffId, termId);
    });
  }

  function doUnassign(assignmentId: number) {
    start(async () => {
      const res = await actions.unassignRoleAction(assignmentId);
      if (!res.ok) { setMsg(res.error ?? 'خطا در حذف انتساب.'); return; }
      if (staffId != null && termId != null) refreshAssignments(staffId, termId);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-black text-slate-900">سمت‌های موظفی و انتساب ترمی</h1>
        <a href="/admin/payroll" className="text-sm text-slate-600 underline">بازگشت به میز حق‌التدریس</a>
      </div>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        موظفی هر استاد از «نقش» او می‌آید نه مرتبهٔ علمی. موظفی مؤثر = موظفیِ نقش تدریسی اصلی (کمترین ترتیب) منهای مجموع کسرِ همهٔ نقش‌ها (کفِ صفر)؛
        بدون نقش تدریسی، موظفی قدیمی قرارداد مبناست.
        اعداد پیش‌فرض سید قطعی نیستند — با تأیید مالی دانشگاه اصلاحشان کنید.
      </div>

      {msg ? <div className="rounded-xl border border-slate-300 bg-slate-50 p-2.5 text-sm text-slate-800">{msg}</div> : null}

      {/* ── کاتالوگ سمت‌ها ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="font-black text-slate-900 text-sm">کاتالوگ سمت‌ها (باز — مدیر تعریف می‌کند)</h2>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <div>
            <label className="text-xs text-slate-500">کد لاتین</label>
            <input value={code} onChange={e => setCode(e.target.value)} className={`${inputCls} font-mono`} placeholder="EDU_DEPUTY" dir="ltr" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-500">عنوان</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="معاون آموزشی" />
          </div>
          <div>
            <label className="text-xs text-slate-500">موظفی (خالی = ندارد)</label>
            <input value={duty} onChange={e => setDuty(e.target.value)} className={inputCls} type="number" min="0" max="40" dir="ltr" />
          </div>
          <div>
            <label className="text-xs text-slate-500">کسر موظفی</label>
            <input value={reduction} onChange={e => setReduction(e.target.value)} className={inputCls} type="number" min="0" max="40" dir="ltr" />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-600 flex items-center gap-1">
              <input type="checkbox" checked={isTeaching} onChange={e => setIsTeaching(e.target.checked)} />
              تدریسی
            </label>
            <input value={sort} onChange={e => setSort(e.target.value)} className={`${inputCls} w-16`} type="number" title="ترتیب" dir="ltr" />
            <button onClick={doCreate} disabled={pending} className={btnPrimary}>افزودن</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm rt">
            <thead>
              <tr className="text-xs text-slate-500 border-b">
                <th className="p-2 text-right">کد</th>
                <th className="p-2 text-right">عنوان</th>
                <th className="p-2">موظفی</th>
                <th className="p-2">کسر</th>
                <th className="p-2">تدریسی</th>
                <th className="p-2">ترتیب</th>
                <th className="p-2">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {roles.map(r => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="p-2 font-mono text-xs" dir="ltr">{r.code}</td>
                  <td className="p-2 font-bold">
                    {editingId === r.id
                      ? <input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} className={inputCls} />
                      : r.title}
                  </td>
                  <td className="p-2 text-center">
                    {editingId === r.id
                      ? <input value={edit.duty} onChange={e => setEdit({ ...edit, duty: e.target.value })} className={`${inputCls} w-20`} type="number" dir="ltr" />
                      : (r.dutyUnits == null ? '—' : r.dutyUnits)}
                  </td>
                  <td className="p-2 text-center">
                    {editingId === r.id
                      ? <input value={edit.reduction} onChange={e => setEdit({ ...edit, reduction: e.target.value })} className={`${inputCls} w-20`} type="number" dir="ltr" />
                      : r.reductionUnits}
                  </td>
                  <td className="p-2 text-center">
                    {editingId === r.id
                      ? <input type="checkbox" checked={edit.isTeaching} onChange={e => setEdit({ ...edit, isTeaching: e.target.checked })} />
                      : (r.isTeaching ? 'بله' : 'خیر')}
                  </td>
                  <td className="p-2 text-center">
                    {editingId === r.id
                      ? <input value={edit.sort} onChange={e => setEdit({ ...edit, sort: e.target.value })} className={`${inputCls} w-16`} type="number" dir="ltr" />
                      : r.sortOrder}
                  </td>
                  <td className="p-2 text-center whitespace-nowrap">
                    {editingId === r.id ? (
                      <>
                        <button onClick={() => doUpdate(r.id)} disabled={pending} className={btnPrimary}>ذخیره</button>{' '}
                        <button onClick={() => setEditingId(null)} className="text-xs text-slate-500">انصراف</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingId(r.id);
                            setEdit({
                              title: r.title,
                              duty: r.dutyUnits == null ? '' : String(r.dutyUnits),
                              reduction: String(r.reductionUnits),
                              isTeaching: r.isTeaching,
                              sort: String(r.sortOrder),
                            });
                          }}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                        >
                          ویرایش
                        </button>{' '}
                        <button onClick={() => doDelete(r.id)} disabled={pending} className={btnDanger}>حذف</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {roles.length === 0 ? (
                <tr><td colSpan={7} className="p-4 text-center text-xs text-slate-500">سمتی تعریف نشده است.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── انتساب ترمی ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="font-black text-slate-900 text-sm">انتساب سمت به استاد در ترم</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="flex gap-2">
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') doSearch(); }}
              className={inputCls}
              placeholder="جست‌وجوی استاد (کد/نام)…"
            />
            <button onClick={doSearch} disabled={pending} className={btnPrimary}>جست‌وجو</button>
          </div>
          <div>
            <select
              value={termId ?? ''}
              onChange={e => {
                const tid = Number(e.target.value) || null;
                setTermId(tid);
                if (staffId != null && tid != null) refreshAssignments(staffId, tid);
              }}
              className={inputCls}
            >
              <option value="">انتخاب ترم…</option>
              {terms.map(t => (
                <option key={t.id} value={t.id}>
                  {t.title}{t.isCurrent ? ' (جاری)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="text-sm text-slate-700 flex items-center">
            {staffId != null ? <>استاد انتخاب‌شده: <b className="mx-1">{staffName}</b></> : 'استادی انتخاب نشده است.'}
          </div>
        </div>

        {found.length > 0 ? (
          <div className="rounded-xl border border-slate-200 divide-y text-sm">
            {found.map(s => (
              <button
                key={s.id}
                onClick={() => pickStaff({ id: s.id, name: s.name })}
                className="w-full flex items-center justify-between p-2 hover:bg-slate-50"
              >
                <span className="font-bold">{s.name}</span>
                <span className="text-xs text-slate-500 font-mono" dir="ltr">{s.staffCode} · {s.rank ?? ''}</span>
              </button>
            ))}
          </div>
        ) : null}

        {staffId != null && termId != null ? (
          <div className="space-y-2">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 text-sm">
              {effective != null ? (
                <>موظفی مؤثر نقش‌محور: <b>{effective}</b> واحد</>
              ) : (
                <>بدون نقش تدریسی — مبنا موظفی قدیمی قرارداد است: <b>{fallback}</b> واحد</>
              )}
            </div>

            <div className="flex flex-wrap gap-2 items-end">
              <div className="min-w-52">
                <label className="text-xs text-slate-500">سمت</label>
                <select value={rolePick} onChange={e => setRolePick(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls}>
                  <option value="">انتخاب سمت…</option>
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.title} ({r.code}){r.dutyUnits != null ? ` — موظفی ${r.dutyUnits}` : ''}{r.reductionUnits ? ` — کسر ${r.reductionUnits}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <label className="text-xs text-slate-600 flex items-center gap-1 pb-2">
                <input type="checkbox" checked={primaryPick} onChange={e => setPrimaryPick(e.target.checked)} />
                نقش اصلی
              </label>
              <button onClick={doAssign} disabled={pending || rolePick === ''} className={`${btnPrimary} mb-0.5`}>انتساب</button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm rt">
                <thead>
                  <tr className="text-xs text-slate-500 border-b">
                    <th className="p-2 text-right">سمت</th>
                    <th className="p-2">موظفی</th>
                    <th className="p-2">کسر</th>
                    <th className="p-2">تدریسی</th>
                    <th className="p-2">اصلی</th>
                    <th className="p-2">حذف</th>
                  </tr>
                </thead>
                <tbody>
                  {assigned.map(a => (
                    <tr key={a.assignmentId} className="border-b border-slate-100">
                      <td className="p-2 font-bold">{a.title} <span className="font-mono text-xs text-slate-500" dir="ltr">({a.code})</span></td>
                      <td className="p-2 text-center">{a.dutyUnits == null ? '—' : a.dutyUnits}</td>
                      <td className="p-2 text-center">{a.reductionUnits}</td>
                      <td className="p-2 text-center">{a.isTeaching ? 'بله' : 'خیر'}</td>
                      <td className="p-2 text-center">{a.isPrimary ? 'بله' : 'خیر'}</td>
                      <td className="p-2 text-center">
                        <button onClick={() => doUnassign(a.assignmentId)} disabled={pending} className={btnDanger}>حذف انتساب</button>
                      </td>
                    </tr>
                  ))}
                  {assigned.length === 0 ? (
                    <tr><td colSpan={6} className="p-4 text-center text-xs text-slate-500">در این ترم سمتی برای استاد ثبت نشده است.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

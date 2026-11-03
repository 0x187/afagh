'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { faIncludes } from '@/lib/persian-search';
import {
  createEquivalenceClusterAction,
  deleteEquivalenceClusterAction,
  setClusterMembersAction,
  updateEquivalenceClusterAction,
} from './actions';

type Cluster = { id: number; clusterTitle: string; isGeneralService: number; universityId: number | null };
type Course = { id: number; code: string; title: string; units: number; clusterId: number | null };

const faNum = (n: number) => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export default function EquivalenceClustersClient({ clusters, courses }: { clusters: Cluster[]; courses: Course[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(clusters[0]?.id ?? null);
  const [title, setTitle] = useState(clusters[0]?.clusterTitle ?? '');
  const [general, setGeneral] = useState(clusters[0]?.isGeneralService === 1);
  const [newTitle, setNewTitle] = useState('');
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = clusters.find(c => c.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId != null && !clusters.some(c => c.id === selectedId)) {
      setSelectedId(clusters[0]?.id ?? null);
    }
  }, [clusters, selectedId]);

  useEffect(() => {
    const cluster = clusters.find(c => c.id === selectedId) ?? null;
    setTitle(cluster?.clusterTitle ?? '');
    setGeneral(cluster?.isGeneralService === 1);
    setMemberIds(courses.filter(c => selectedId != null && c.clusterId === selectedId).map(c => c.id));
  }, [clusters, courses, selectedId]);

  const clusterName = useMemo(() => new Map(clusters.map(c => [c.id, c.clusterTitle])), [clusters]);
  const memberIdSet = useMemo(() => new Set(memberIds), [memberIds]);
  const members = useMemo(() => courses.filter(c => memberIdSet.has(c.id)), [courses, memberIdSet]);

  const filteredCourses = useMemo(() => {
    const q = query.trim();
    const list = q ? courses.filter(c => faIncludes(`${c.code} ${c.title}`, q)) : courses;
    return list.slice(0, 80);
  }, [courses, query]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, message: string) => {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setMsg({ text: r.error ?? 'عملیات ناموفق بود.', type: 'err' });
        return;
      }
      setMsg({ text: message, type: 'ok' });
      router.refresh();
    });
  };

  const create = () => {
    const clusterTitle = newTitle.trim();
    if (!clusterTitle) {
      setMsg({ text: 'عنوان خوشه را وارد کنید.', type: 'err' });
      return;
    }
    startTransition(async () => {
      const r = await createEquivalenceClusterAction({ clusterTitle });
      if (!r.ok) {
        setMsg({ text: r.error, type: 'err' });
        return;
      }
      setNewTitle('');
      setSelectedId(r.data.id);
      setMsg({ text: 'خوشهٔ جدید ساخته شد.', type: 'ok' });
      router.refresh();
    });
  };

  const saveMeta = () => {
    if (!selected) return;
    const clusterTitle = title.trim();
    if (!clusterTitle) {
      setMsg({ text: 'عنوان خوشه را وارد کنید.', type: 'err' });
      return;
    }
    run(
      () => updateEquivalenceClusterAction(selected.id, { clusterTitle, isGeneralService: general }),
      'مشخصات خوشه ذخیره شد.',
    );
  };

  const removeCluster = () => {
    if (!selected) return;
    if (!window.confirm(`خوشهٔ «${selected.clusterTitle}» حذف شود؟ دروس عضو از خوشه جدا می‌شوند.`)) return;
    startTransition(async () => {
      const r = await deleteEquivalenceClusterAction(selected.id);
      if (!r.ok) {
        setMsg({ text: r.error, type: 'err' });
        return;
      }
      setSelectedId(null);
      setMsg({ text: `خوشه حذف شد (${faNum(r.data.detached)} درس جدا شد).`, type: 'ok' });
      router.refresh();
    });
  };

  const persistMembers = (ids: number[]) => {
    if (!selected) return;
    setMemberIds(ids);
    run(() => setClusterMembersAction(selected.id, ids), 'اعضای خوشه ذخیره شد.');
  };

  const toggleMember = (id: number) => {
    persistMembers(memberIdSet.has(id) ? memberIds.filter(x => x !== id) : [...memberIds, id]);
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`rounded-xl border px-4 py-3 text-xs font-bold ${msg.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {msg.text}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-2xs font-bold text-slate-600 mb-1">خوشهٔ جدید</label>
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') create(); }}
              placeholder="مثال: ریاضی عمومی ۱ / ریاضیات پایه"
              maxLength={100}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
          </div>
          <button
            type="button"
            onClick={create}
            disabled={pending}
            className="rounded-xl bg-teal-700 text-white px-4 py-2 text-xs font-black hover:bg-teal-800 disabled:opacity-50"
          >
            + ساخت خوشه
          </button>
          {pending && <span className="text-2xs text-slate-500">در حال ذخیره…</span>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr] items-start">
        <aside className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between px-1 pb-2">
            <h2 className="text-xs font-extrabold text-slate-800">خوشه‌ها</h2>
            <span className="text-3xs text-slate-500">{faNum(clusters.length)} مورد</span>
          </div>
          <div className="space-y-1.5 max-h-[70vh] overflow-y-auto">
            {clusters.length === 0 && (
              <p className="text-2xs text-slate-500 px-1 py-3">هنوز خوشه‌ای تعریف نشده است.</p>
            )}
            {clusters.map(cluster => {
              const count = courses.filter(c => c.clusterId === cluster.id).length;
              const active = cluster.id === selectedId;
              return (
                <button
                  key={cluster.id}
                  type="button"
                  onClick={() => setSelectedId(cluster.id)}
                  className={`w-full text-right rounded-xl border px-3 py-2 transition ${active ? 'bg-teal-50 border-teal-300' : 'bg-slate-50 border-slate-200 hover:bg-teal-50/50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-800 truncate">{cluster.clusterTitle}</span>
                    <span className="shrink-0 text-3xs rounded-full bg-white border border-slate-200 px-1.5 py-0.5 text-slate-600">{faNum(count)} درس</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    {cluster.isGeneralService === 1 && (
                      <span className="text-[9px] font-bold text-indigo-700 bg-indigo-100 rounded px-1.5 py-0.5">درس عمومی</span>
                    )}
                    {cluster.universityId == null && (
                      <span className="text-[9px] font-bold text-slate-600 bg-slate-200 rounded px-1.5 py-0.5">سراسری</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-4">
          {!selected ? (
            <p className="text-xs text-slate-500 py-8 text-center">یک خوشه از فهرست انتخاب کنید یا خوشهٔ جدید بسازید.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2 pb-3 border-b border-slate-100">
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-2xs font-bold text-slate-600 mb-1">عنوان خوشه</label>
                  <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    maxLength={100}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                  />
                </div>
                <label className="inline-flex items-center gap-1.5 text-2xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 cursor-pointer select-none">
                  <input type="checkbox" checked={general} onChange={e => setGeneral(e.target.checked)} className="accent-teal-700" />
                  درس عمومی
                </label>
                <button
                  type="button"
                  onClick={saveMeta}
                  disabled={pending}
                  className="rounded-xl bg-indigo-700 text-white px-3 py-2 text-xs font-black hover:bg-indigo-800 disabled:opacity-50"
                >
                  ذخیره
                </button>
                <button
                  type="button"
                  onClick={removeCluster}
                  disabled={pending}
                  className="rounded-xl bg-white border border-rose-300 text-rose-700 px-3 py-2 text-xs font-black hover:bg-rose-50 disabled:opacity-50"
                >
                  حذف خوشه
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-extrabold text-slate-800">اعضای خوشه ({faNum(members.length)})</h3>
                  <span className="text-3xs text-slate-500">با حذف هر درس، از خوشه جدا می‌شود.</span>
                </div>
                {members.length === 0 ? (
                  <p className="text-2xs text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-xl px-3 py-4 text-center">
                    هنوز درسی به این خوشه اضافه نشده است.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {members.map(course => (
                      <span key={course.id} className="inline-flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-2xs">
                        <span className="font-mono font-bold text-teal-900" dir="ltr">{course.code}</span>
                        <span className="text-slate-700 max-w-[240px] truncate">{course.title}</span>
                        <span className="text-[9px] text-slate-500">{faNum(course.units)}و</span>
                        <button
                          type="button"
                          onClick={() => toggleMember(course.id)}
                          disabled={pending}
                          title="حذف از خوشه"
                          className="text-rose-600 hover:text-rose-800 font-black disabled:opacity-40"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h3 className="text-xs font-extrabold text-slate-800">افزودن درس</h3>
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="جستجوی کد یا نام درس…"
                    className="flex-1 min-w-[200px] rounded-xl border border-slate-300 px-3 py-1.5 text-2xs focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                  />
                </div>
                <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {filteredCourses.length === 0 && (
                    <p className="text-2xs text-slate-500 px-3 py-4 text-center">درسی یافت نشد.</p>
                  )}
                  {filteredCourses.map(course => {
                    const isMember = memberIdSet.has(course.id);
                    const otherCluster = course.clusterId != null && course.clusterId !== selected.id
                      ? clusterName.get(course.clusterId) ?? 'خوشهٔ دیگر'
                      : null;
                    return (
                      <div key={course.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
                        <span className="font-mono text-2xs font-bold text-indigo-900 w-24 shrink-0" dir="ltr">{course.code}</span>
                        <span className="flex-1 text-2xs text-slate-700 truncate">{course.title}</span>
                        <span className="text-[9px] text-slate-500 shrink-0">{faNum(course.units)} واحد</span>
                        {otherCluster && (
                          <span className="text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0 max-w-[160px] truncate">
                            در «{otherCluster}»
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleMember(course.id)}
                          disabled={pending}
                          className={`shrink-0 rounded-lg px-2.5 py-1 text-3xs font-black border disabled:opacity-40 ${isMember ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100' : 'bg-teal-700 text-white border-teal-700 hover:bg-teal-800'}`}
                        >
                          {isMember ? 'حذف' : 'افزودن'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

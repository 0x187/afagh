'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

type Member = {
  offeringId: number;
  courseCode: string;
  courseTitle: string;
  groupNumber: number;
  enrolledCount: number;
  professorName: string | null;
  mergeKey: string | null;
  slots: string;
};

type Group = {
  key: string | null;
  merged: boolean;
  source: 'manual' | 'auto' | 'split' | 'solo';
  totalEnrolled: number;
  members: Member[];
};

type Term = { id: number; title: string };

const SOURCE_BADGE: Record<Group['source'], { label: string; cls: string }> = {
  manual: { label: 'ادغام دستی', cls: 'bg-violet-700/30 text-violet-200 border-violet-500/40' },
  auto: { label: 'خودکار', cls: 'bg-sky-700/30 text-sky-200 border-sky-500/40' },
  split: { label: 'جدا شده دستی', cls: 'bg-amber-700/30 text-amber-200 border-amber-500/40' },
  solo: { label: 'تکی', cls: 'bg-slate-700/30 text-slate-300 border-slate-500/40' },
};

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'خطا');
  return data;
}

export default function CourseMergeClient() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [termId, setTermId] = useState<number | null>(null);
  const [tab, setTab] = useState<'manual' | 'other'>('manual');
  const [groups, setGroups] = useState<Group[]>([]);
  const [meta, setMeta] = useState<{ total: number; manualCount: number; otherCount: number } | null>(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api('/api/admin/enrollment-approvals?action=terms')
      .then(d => {
        setTerms(d.terms ?? []);
        if (d.terms?.length) setTermId(d.terms[0].id);
      })
      .catch(() => setMsg('خطا در بارگذاری ترم‌ها'));
  }, []);

  const load = useCallback((tid: number, scope: 'manual' | 'other' = 'manual') => {
    setMsg(null);
    api(`/api/admin/offering-merge?termId=${tid}&scope=${scope}`)
      .then(d => {
        setGroups(d.groups ?? []);
        setSelected(new Set());
        setMeta({ total: d.total, manualCount: d.manualCount, otherCount: d.otherCount });
      })
      .catch(() => setMsg('خطا در بارگذاری کلاس‌ها'));
  }, []);

  const switchTab = (next: 'manual' | 'other') => {
    if (next === tab) return;
    setTab(next);
    if (termId) load(termId, next);
  };

  useEffect(() => {
    if (termId) {
      setTab('manual');
      load(termId, 'manual');
    }
  }, [termId, load]);

  const mutate = (offeringIds: number[], mode: 'merge' | 'split' | 'auto', confirmText?: string) => {
    if (offeringIds.length === 0) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setMsg(null);
    startTransition(async () => {
      try {
        await api('/api/admin/offering-merge', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offeringIds, mode }),
        });
        setMsg('ذخیره شد.');
        if (termId) load(termId, tab);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'خطا');
      }
    });
  };

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const needle = q.trim();
  const visible = groups
    .map(g => ({
      ...g,
      members: g.members.filter(
        m => !needle || m.courseTitle.includes(needle) || m.courseCode.includes(needle) || (m.professorName ?? '').includes(needle),
      ),
    }))
    .filter(g => g.members.length > 0);

  const mergedCount = groups.filter(g => g.merged).length;

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">ادغام دروس</h1>
        <span className="text-xs text-slate-400">
          {groups.length} گروه • {mergedCount} ادغامی
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => switchTab('manual')}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              tab === 'manual'
                ? 'border-violet-500 bg-violet-600 text-white'
                : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            ادغام دستی ({meta?.manualCount ?? '…'})
          </button>
          <button
            type="button"
            onClick={() => switchTab('other')}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              tab === 'other'
                ? 'border-sky-500 bg-sky-600 text-white'
                : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            سایر ({meta?.otherCount ?? '…'})
          </button>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <select
            value={termId ?? ''}
            onChange={e => setTermId(Number(e.target.value))}
            className="border rounded px-2 py-1.5 text-sm bg-white dark:bg-slate-800"
          >
            {terms.map(t => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="جستجو درس / استاد…"
            className="border rounded px-2 py-1.5 text-sm w-48 bg-white dark:bg-slate-800"
          />
        </div>
      </div>

      {msg && <div className="text-sm text-amber-600 dark:text-amber-300">{msg}</div>}

      {selected.size >= 2 && (
        <div className="sticky top-2 z-10 flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-950/90 p-2 text-sm text-violet-100 shadow">
          <span>{selected.size} کلاس انتخاب شده</span>
          <button
            disabled={busy}
            onClick={() => mutate([...selected], 'merge', `${selected.size} کلاس در یک گروه ادغام دستی شود؟`)}
            className="rounded bg-violet-600 px-3 py-1.5 hover:bg-violet-500 disabled:opacity-50"
          >
            ادغام انتخاب‌شده‌ها
          </button>
          <button
            disabled={busy}
            onClick={() => setSelected(new Set())}
            className="rounded border border-violet-400/40 px-3 py-1.5 hover:bg-violet-800"
          >
            لغو انتخاب
          </button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((g, gi) => {
          const badge = SOURCE_BADGE[g.source];
          return (
            <div
              key={g.key ?? `solo-${gi}`}
              className={`rounded-xl border p-3 space-y-2 ${g.merged ? 'border-violet-500/40 bg-violet-950/20' : 'border-slate-200 dark:border-slate-700'}`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-2xs border rounded-full px-2 py-0.5 ${badge.cls}`}>{badge.label}</span>
                {g.merged && (
                  <span className="text-xs text-slate-500">
                    {g.members.length} کلاس • {g.totalEnrolled} دانشجو
                  </span>
                )}
                <div className="ms-auto flex gap-1">
                  {g.merged && (
                    <button
                      disabled={busy}
                      onClick={() => mutate(g.members.map(m => m.offeringId), 'auto', 'به تشخیص خودکار برگردد؟')}
                      className="text-2xs rounded border px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      خودکار
                    </button>
                  )}
                </div>
              </div>
              <ul className="space-y-1.5">
                {g.members.map(m => (
                  <li
                    key={m.offeringId}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${selected.has(m.offeringId) ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/40' : 'border-slate-200 dark:border-slate-700'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(m.offeringId)}
                      onChange={() => toggle(m.offeringId)}
                      className="h-4 w-4"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {m.courseTitle} <span className="text-slate-500">({m.courseCode} • گروه {m.groupNumber})</span>
                      </div>
                      <div className="text-2xs text-slate-500">
                        {m.professorName ?? '—'} • {m.enrolledCount} نفر • {m.slots}
                      </div>
                    </div>
                    <button
                      disabled={busy}
                      title="جدا کردن این کلاس از ادغام"
                      onClick={() => mutate([m.offeringId], 'split')}
                      className="text-2xs rounded border px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      جدا
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {visible.length === 0 && <div className="text-sm text-slate-500">کلاسی یافت نشد.</div>}

      <p className="text-2xs text-slate-500">
        منطق موتور بدون تغییر مانده: کلید دستی بر حدس خودکار (روز/ساعت) اولویت دارد. «جدا» یعنی این کلاس هرگز با کلاس دیگر ادغام نمی‌شود؛ «خودکار» یعنی تشخیص از روی برنامهٔ هفتگی.
      </p>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber, toEnDigits } from '@/lib/fa';
import { getConfirmationTerms, type AdminTerm } from '@/lib/enrollment-api';
import { getCourseMergeGroups, updateCourseMerge, type MergeGroup } from '@/lib/merge-api';

// ═══ ادغام دروس — پورت admin/course-merge ═══

const SOURCE_LABEL: Record<MergeGroup['source'], string> = {
  manual: 'ادغام دستی', auto: 'خودکار', split: 'جدا شده دستی', solo: 'تکی',
};

function sourceTone(s: MergeGroup['source']) {
  if (s === 'manual') return 'border-transparent bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200';
  if (s === 'auto') return 'border-transparent bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200';
  if (s === 'split') return 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
  return 'border-transparent bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

export function AdminCourseMergePage() {
  const qc = useQueryClient();
  const [termId, setTermId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  const { data: terms = [] } = useQuery({ queryKey: ['confirmation-terms'], queryFn: getConfirmationTerms, staleTime: 60_000 });
  useEffect(() => {
    if (!termId && terms.length) setTermId(terms[0].id);
  }, [terms, termId]);

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['course-merge', termId],
    queryFn: () => getCourseMergeGroups(termId as number),
    enabled: !!termId,
  });

  const mut = useMutation({
    mutationFn: ({ ids, mode }: { ids: number[]; mode: 'merge' | 'split' | 'auto' }) => updateCourseMerge(ids, mode),
    onSuccess: async () => {
      setMsg('ذخیره شد.');
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ['course-merge', termId] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const needle = toEnDigits(q.trim());
  const visible = groups
    .map((g) => ({ ...g, members: g.members.filter((m) => !needle || toEnDigits(m.courseTitle).includes(needle) || m.courseCode.includes(needle) || (m.professorName ?? '').includes(q.trim())) }))
    .filter((g) => g.members.length > 0);
  const mergedCount = groups.filter((g) => g.merged).length;
  const manualCount = groups.filter((g) => g.source === 'manual').length;

  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-violet-800 via-purple-800 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black"><Layers className="size-5" aria-hidden /> ادغام دروس</h1>
          <p className="mt-1 text-xs text-violet-100">
            کلید دستی بر حدس خودکار (روز/ساعت) اولویت دارد. «جدا» یعنی این کلاس هرگز با کلاس دیگر ادغام نمی‌شود؛ «خودکار» یعنی تشخیص از روی برنامهٔ هفتگی.
          </p>
          <p className="mt-2 text-[11px] font-bold text-violet-200">{faNumber(groups.length)} گروه • {faNumber(mergedCount)} ادغامی • {faNumber(manualCount)} دستی</p>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{msg}</div> : null}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <select
            value={termId ?? ''}
            onChange={(e) => { setTermId(Number(e.target.value)); setSelected(new Set()); }}
            className="h-9 rounded-lg border border-input bg-card px-2 text-xs font-bold"
          >
            {terms.map((t: AdminTerm) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو درس / استاد…" className="pr-9" />
          </div>
        </CardContent>
      </Card>

      {selected.size >= 2 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-violet-300 bg-violet-50 p-2 text-xs font-bold text-violet-900 shadow-sm dark:border-violet-800 dark:bg-violet-950/70 dark:text-violet-100">
          <span>{faNumber(selected.size)} کلاس انتخاب شده</span>
          <Button size="sm" disabled={mut.isPending} onClick={() => { if (confirm(`${selected.size} کلاس در یک گروه ادغام دستی شود؟`)) mut.mutate({ ids: [...selected], mode: 'merge' }); }}>ادغام انتخاب‌شده‌ها</Button>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>لغو انتخاب</Button>
        </div>
      ) : null}

      {isLoading ? <Skeleton className="h-64 w-full" /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((g, gi) => (
            <Card key={g.key ?? `solo-${gi}`} className={g.merged ? 'border-violet-300 dark:border-violet-800' : ''}>
              <CardContent className="space-y-2 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={sourceTone(g.source)}>{SOURCE_LABEL[g.source]}</Badge>
                  {g.merged ? <span className="text-xs text-muted-foreground">{faNumber(g.members.length)} کلاس • {faNumber(g.totalEnrolled)} دانشجو</span> : null}
                  <div className="ms-auto">
                    {g.merged ? (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={mut.isPending} onClick={() => { if (confirm('به تشخیص خودکار برگردد؟')) mut.mutate({ ids: g.members.map((m) => m.offeringId), mode: 'auto' }); }}>خودکار</Button>
                    ) : null}
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {g.members.map((m) => (
                    <li key={m.offeringId} className={`flex items-center gap-2 rounded-lg border p-2 text-xs ${selected.has(m.offeringId) ? 'border-violet-400 bg-violet-50/60 dark:bg-violet-950/40' : 'border-border'}`}>
                      <input type="checkbox" checked={selected.has(m.offeringId)} onChange={() => toggle(m.offeringId)} className="size-4" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold">{m.courseTitle} <span className="font-normal text-muted-foreground">({m.courseCode} • گروه {m.groupNumber})</span></div>
                        <div className="text-[11px] text-muted-foreground">{m.professorName ?? '—'} • {faNumber(m.enrolledCount)} نفر • {m.slots}</div>
                      </div>
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={mut.isPending} onClick={() => mut.mutate({ ids: [m.offeringId], mode: 'split' })}>جدا</Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
          {visible.length === 0 ? <p className="col-span-full rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">کلاسی یافت نشد.</p> : null}
        </div>
      )}
    </div>
  );
}

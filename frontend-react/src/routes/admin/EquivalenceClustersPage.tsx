import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber, toEnDigits } from '@/lib/fa';
import {
  createEquivCluster,
  deleteEquivCluster,
  getEquivalenceClusters,
  setEquivClusterMembers,
  updateEquivCluster,
  type EquivCluster,
} from '@/lib/merge-api';

// ═══ Equivalent course clusters — port of admin/equivalence-clusters ═══

export function AdminEquivalenceClustersPage() {
  const qc = useQueryClient();
  const [selectedID, setSelectedID] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [title, setTitle] = useState('');
  const [general, setGeneral] = useState(false);
  const [q, setQ] = useState('');
  const [members, setMembers] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const { data, isLoading, isError } = useQuery({ queryKey: ['equivalence-clusters'], queryFn: getEquivalenceClusters, staleTime: 20_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['equivalence-clusters'] });

  const selected: EquivCluster | undefined = data?.clusters.find((c) => c.id === selectedID);
  useEffect(() => {
    if (selected) {
      setTitle(selected.clusterTitle);
      setGeneral(selected.isGeneralService === 1);
    }
  }, [selectedID, selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data) return;
    if (selectedID == null && data.clusters.length) {
      setSelectedID(data.clusters[0].id);
    }
    const inCluster = new Set(data.courses.filter((c) => c.clusterId === selectedID).map((c) => c.id));
    setMembers(inCluster);
  }, [data, selectedID]);

  const createMut = useMutation({
    mutationFn: () => createEquivCluster(newTitle, false),
    onSuccess: async (id) => {
      setMsg({ kind: 'ok', text: 'خوشه ساخته شد.' });
      setNewTitle('');
      setSelectedID(id);
      await refresh();
    },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });
  const saveMut = useMutation({
    mutationFn: () => updateEquivCluster(selectedID as number, { clusterTitle: title, isGeneralService: general }),
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'خوشه به‌روزرسانی شد.' }); await refresh(); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });
  const deleteMut = useMutation({
    mutationFn: () => deleteEquivCluster(selectedID as number),
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'خوشه حذف شد و دروس جدا شدند.' }); setSelectedID(null); await refresh(); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });
  const membersMut = useMutation({
    mutationFn: () => setEquivClusterMembers(selectedID as number, [...members]),
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'اعضای خوشه ذخیره شد.' }); await refresh(); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت خوشه‌ها ناموفق بود.</CardContent></Card>;

  const needle = toEnDigits(q.trim());
  const courses = data.courses.filter((c) => !needle || toEnDigits(c.title).includes(needle) || c.code.includes(needle));

  const toggle = (id: number) => setMembers((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-sky-800 via-cyan-800 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black"><Boxes className="size-5" aria-hidden /> خوشه‌های دروس هم‌ارز</h1>
          <p className="mt-1 text-xs leading-6 text-sky-100">
            دروسی که یک محتوا با کدهای متفاوت دارند در یک خوشه قرار می‌گیرند؛ گذراندن هر عضو، پیش‌نیازهای اعضای دیگر را هم برآورده می‌کند و ظرفیت و امتحان آن‌ها مشترک می‌شود.
          </p>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>{msg.text}</div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-xs font-black">خوشه‌ها ({faNumber(data.clusters.length)})</h3>
            <div className="flex gap-2">
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="عنوان خوشهٔ جدید…" className="h-8 text-xs" />
              <Button size="sm" disabled={!newTitle.trim() || createMut.isPending} onClick={() => createMut.mutate()}><Plus className="size-3.5" aria-hidden /></Button>
            </div>
            <ul className="space-y-1">
              {data.clusters.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setSelectedID(c.id)} className={`w-full rounded-lg border px-2 py-1.5 text-right text-xs ${selectedID === c.id ? 'border-sky-500 bg-sky-50 font-black dark:bg-sky-950/40' : 'border-border hover:bg-muted/50'}`}>
                    {c.clusterTitle}
                    {c.isGeneralService === 1 ? <Badge variant="accent" className="ms-1 text-[9px]">خدماتی</Badge> : null}
                  </button>
                </li>
              ))}
              {data.clusters.length === 0 ? <li className="p-2 text-center text-xs text-muted-foreground">خوشه‌ای ثبت نشده است.</li> : null}
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="space-y-2 pt-4">
            {selected ? (
              <>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-48 flex-1 space-y-1 text-[10px] text-muted-foreground"><span>عنوان خوشه</span><Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-xs" /></label>
                  <label className="flex items-center gap-1.5 pb-1.5 text-[11px] font-bold"><input type="checkbox" checked={general} onChange={(e) => setGeneral(e.target.checked)} /> خدمات عمومی</label>
                  <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>ذخیره</Button>
                  <Button size="sm" variant="destructive" disabled={deleteMut.isPending} onClick={() => { if (confirm(`خوشهٔ «${selected.clusterTitle}» حذف شود؟`)) deleteMut.mutate(); }}>حذف</Button>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                  <div className="relative min-w-48 flex-1">
                    <Search className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی درس…" className="h-8 pr-8 text-xs" />
                  </div>
                  <span className="text-[11px] font-bold text-muted-foreground">{faNumber(members.size)} عضو</span>
                  <Button size="sm" disabled={membersMut.isPending} onClick={() => membersMut.mutate()}>ذخیرهٔ اعضا</Button>
                </div>

                <div className="grid max-h-[55vh] gap-1 overflow-y-auto sm:grid-cols-2">
                  {courses.map((c) => (
                    <label key={c.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs ${members.has(c.id) ? 'border-sky-400 bg-sky-50/60 dark:bg-sky-950/40' : 'border-border'}`}>
                      <input type="checkbox" checked={members.has(c.id)} onChange={() => toggle(c.id)} className="size-4" />
                      <span className="min-w-0 flex-1 truncate"><b>{c.title}</b> <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{c.code}</span></span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{faNumber(c.units)} واحد</span>
                    </label>
                  ))}
                  {courses.length === 0 ? <p className="col-span-full p-4 text-center text-xs text-muted-foreground">درسی یافت نشد.</p> : null}
                </div>
              </>
            ) : <p className="p-6 text-center text-xs text-muted-foreground">یک خوشه انتخاب کنید یا خوشهٔ جدید بسازید.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

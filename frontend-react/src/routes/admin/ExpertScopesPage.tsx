import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getExpertScopes, saveExpertScopes, type ExpertScopeCandidate, type ExpertScopeEntry, type ExpertScopeSelect } from '@/lib/admin-modules6-api';

// ═══ دامنهٔ دسترسی کارشناسان آموزش — port of admin/expert-scopes ═══

const TYPE_FA: Record<string, string> = {
  UNIVERSITY: '🏛️ دانشگاه',
  FACULTY: '🎓 دانشکده',
  DEPARTMENT: '🏫 گروه',
  MAJOR: '📚 رشته',
  CONFIG: '⚙️ تنظیمات',
};

export function ExpertScopesPage() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [scopes, setScopes] = useState<ExpertScopeEntry[]>([]);
  const [gradeFlag, setGradeFlag] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({ queryKey: ['admin-expert-scopes'], queryFn: getExpertScopes });
  const cands: ExpertScopeCandidate[] = q.data?.candidates ?? [];
  const sel: ExpertScopeSelect | null = q.data?.select ?? null;

  const openEdit = (c: ExpertScopeCandidate) => {
    setEditingId(c.userId);
    setScopes(c.scopes.filter((s) => s.type !== 'CONFIG').map((s) => ({ type: s.type, id: s.id, uni: s.uni ?? null })));
    setGradeFlag(c.canEditGrades);
    setMsg(null);
  };

  const addScope = (type: string, id: number) => {
    if (scopes.some((s) => s.type === type && s.id === id)) return;
    setScopes((p) => [...p, { type, id, uni: null }]);
  };

  const removeScope = (i: number) => setScopes((p) => p.filter((_, x) => x !== i));

  const save = async () => {
    if (editingId == null) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveExpertScopes(editingId, scopes, gradeFlag);
      setMsg(r.ok ? '✅ ذخیره شد.' : `⛔ ${r.error ?? ''}`);
      if (r.ok) void qc.invalidateQueries({ queryKey: ['admin-expert-scopes'] });
    } catch (e) {
      setMsg(`⛔ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const editing = cands.find((x) => x.userId === editingId);

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-indigo-900 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="text-base font-black">🔐 دامنهٔ دسترسی کارشناسان آموزش</h1>
          <p className="mt-1 text-xs text-indigo-100">برای هر کارشناس (EDU_EXPERT): دانشگاه/دانشکده/گروه/رشتهٔ مجاز. خالی = کل دانشگاه.</p>
        </CardContent>
      </Card>

      {q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت فهرست کارشناسان ناموفق بود.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="space-y-2">
            {cands.map((c) => (
              <div key={c.userId} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
                <span className="text-sm font-black">{c.name}</span>
                {c.canEditGrades ? <Badge variant="secondary">ویرایش نمره</Badge> : null}
                <span className="text-[10px] text-muted-foreground">
                  {c.scopes.length
                    ? c.scopes.map((s) => `${TYPE_FA[s.type] ?? s.type}(${s.id})`).join(' · ')
                    : 'کل دانشگاه'}
                </span>
                <Button size="sm" className="mr-auto" onClick={() => openEdit(c)}>
                  {editingId === c.userId ? 'ویرایش…' : 'ویرایش'}
                </Button>
              </div>
            ))}
            {!cands.length && <p className="py-6 text-center text-xs text-muted-foreground">کارشناسی یافت نشد.</p>}
          </CardContent>
        </Card>
      )}

      {editingId != null && sel && (
        <Card className="border-indigo-300">
          <CardContent className="space-y-3">
            <h3 className="text-sm font-black text-indigo-700 dark:text-indigo-300">ویرایش دامنهٔ {editing?.name}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-bold text-muted-foreground">
                دانشگاه
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs" value="" onChange={(e) => e.target.value && addScope('UNIVERSITY', Number(e.target.value))}>
                  <option value="">+ افزودن دانشگاه…</option>
                  {sel.universities.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-muted-foreground">
                دانشکده
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs" value="" onChange={(e) => e.target.value && addScope('FACULTY', Number(e.target.value))}>
                  <option value="">+ افزودن دانشکده…</option>
                  {sel.faculties.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-muted-foreground">
                گروه
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs" value="" onChange={(e) => e.target.value && addScope('DEPARTMENT', Number(e.target.value))}>
                  <option value="">+ افزودن گروه…</option>
                  {sel.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-muted-foreground">
                رشته
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs" value="" onChange={(e) => e.target.value && addScope('MAJOR', Number(e.target.value))}>
                  <option value="">+ افزودن رشته…</option>
                  {sel.majors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {scopes.map((s, i) => (
                <span key={`${s.type}-${s.id}`} className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-background px-2 py-1 text-[10px] font-bold">
                  {TYPE_FA[s.type] ?? s.type}: {s.id}
                  <button type="button" onClick={() => removeScope(i)} className="font-black text-red-600">✕</button>
                </span>
              ))}
              {!scopes.length && <span className="text-[10px] font-bold text-muted-foreground">(بدون محدودیت → کل دانشگاه)</span>}
            </div>

            <label className="flex items-center gap-2 text-xs font-bold">
              <input type="checkbox" checked={gradeFlag} onChange={(e) => setGradeFlag(e.target.checked)} className="size-4" />
              دسترسی «ویرایش نمره» برای این کارشناس (فقط کارشناسِ خاص)
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy} onClick={() => void save()}>ذخیره</Button>
              <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>بستن</Button>
              {msg && <span className="text-xs font-black">{msg}</span>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

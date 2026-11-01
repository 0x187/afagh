import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, CheckCircle2, GitBranch, Layers, Send, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import {
  addCurriculumCourse, assignCurriculumSemester, createCurriculumVersion, curriculumAction,
  getCurriculumDetail, getCurriculumOverview, markCurriculumGrad, removeCurriculumCourse,
  setCurriculumRule, syncCurriculumRoles, updateCurriculumCourse, type CurriculumCheck, type CurriculumDetail,
} from '@/lib/curriculum-api';

// ═══ Syllabus/curriculum — port of admin/curriculum ═══

const STATUS_FA: Record<string, string> = {
  DRAFT: 'پیش‌نویس', REVIEW: 'در بازبینی', APPROVED: 'تأییدشده', PUBLISHED: 'منتشرشده', ARCHIVED: 'بایگانی',
};
const STATUS_TONE: Record<string, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  DRAFT: 'secondary', REVIEW: 'warning', APPROVED: 'success', PUBLISHED: 'success', ARCHIVED: 'destructive',
};
const ROLE_FA: Record<string, string> = {
  CORE: 'پایه', MAJOR: 'تخصصی', ELECTIVE: 'اختیاری', GENERAL: 'عمومی', THESIS: 'پایان‌نامه', INTERNSHIP: 'کارآموزی', WORKSHOP: 'کارگاه',
};

export function AdminCurriculumPage() {
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['curriculum-overview'], queryFn: getCurriculumOverview, staleTime: 15_000 });
  const [selected, setSelected] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['curriculum-overview'] });
    if (selected) await qc.invalidateQueries({ queryKey: ['curriculum-detail', selected] });
  };

  const detail = useQuery({ queryKey: ['curriculum-detail', selected], queryFn: () => getCurriculumDetail(selected as number), enabled: !!selected });

  const act = useMutation({
    mutationFn: async ({ action, note }: { action: string; note?: string }) => {
      if (!selected) throw new Error('نسخه‌ای انتخاب نشده است.');
      const res = await curriculumAction(selected, action, note ?? '');
      if (!res.ok) throw new Error(res.error || 'خطا');
      return res;
    },
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'انجام شد.' }); await refresh(); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  if (overview.isLoading) return <Skeleton className="h-80 w-full" />;
  if (overview.isError || !overview.data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت برنامه‌های درسی ناموفق بود.</CardContent></Card>;

  const majors = overview.data.majors;
  const majorName = (id: number) => majors.find((m) => m.id === id)?.name ?? `#${id}`;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-emerald-900 via-teal-900 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-black"><BookMarked className="size-5" aria-hidden /> کاتالوگ و سرفصل رشته‌ها</h1>
            <p className="mt-1 text-xs text-emerald-100/80">نسخه‌های برنامهٔ درسی با چرخهٔ حیات مصوب: DRAFT → REVIEW → APPROVED → PUBLISHED → ARCHIVED</p>
          </div>
          <Button size="sm" className="bg-white text-slate-900 hover:bg-white/90" onClick={() => setShowCreate(true)}>+ نسخهٔ جدید</Button>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>{msg.text}</div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-1 pt-4">
            <h2 className="text-sm font-black">نسخه‌ها</h2>
            {overview.data.versions.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">نسخه‌ای ثبت نشده است.</p> : null}
            {overview.data.versions.map((v) => (
              <button key={v.id} type="button" onClick={() => setSelected(v.id)}
                className={`flex w-full flex-wrap items-center gap-2 rounded-xl border p-2.5 text-right text-[11px] transition ${selected === v.id ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30' : 'border-border hover:border-teal-300'}`}>
                <span className="font-black">{v.title}</span>
                <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{v.versionCode}</span>
                <Badge variant={STATUS_TONE[v.status] ?? 'secondary'} className="text-[9px]">{STATUS_FA[v.status] ?? v.status}</Badge>
                <span className="ms-auto text-[10px] text-muted-foreground">{majorName(v.majorId)} · ورودی {faNumber(v.entryYearFrom)}{v.entryYearTo ? `-${faNumber(v.entryYearTo)}` : ''} · {faNumber(v.courseCount)} درس · لازم {faNumber(Number(v.totalRequiredUnits))}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        {selected && detail.data ? <VersionDetail d={detail.data} onMsg={setMsg} onRefresh={refresh} act={act} /> : (
          <Card><CardContent className="py-16 text-center text-xs text-muted-foreground">یک نسخه را از فهرست انتخاب کنید.</CardContent></Card>
        )}
      </div>

      {showCreate ? (
        <CreateModal majors={majors} onClose={() => setShowCreate(false)} onSaved={async (text) => { setMsg({ kind: 'ok', text }); setShowCreate(false); await refresh(); }} />
      ) : null}
    </div>
  );
}

function VersionDetail({ d, onMsg, onRefresh, act }: {
  d: CurriculumDetail;
  onMsg: (m: { kind: 'ok' | 'err'; text: string }) => void;
  onRefresh: () => Promise<void>;
  act: { mutate: (v: { action: string; note?: string }) => void; isPending: boolean };
}) {
  const [note, setNote] = useState('');
  const [newCourseId, setNewCourseId] = useState('');
  const v = d.version;
  const canEdit = v.status === 'DRAFT';
  const rulesByCourse = new Map<number, string[]>();
  for (const r of d.rules) {
    const list = rulesByCourse.get(r.courseId) ?? [];
    const texts = r.logicTree.conditions.map((c) => c.course ? (c.minGrade ? `${c.course}≥${c.minGrade}` : c.course) : `${c.unitsPassed}واحد`).join(` ${r.logicTree.operator} `);
    list.push(`${r.ruleType === 'PREREQ' ? 'پیش‌نیاز' : 'هم‌نیاز'}: ${texts || '—'}`);
    rulesByCourse.set(r.courseId, list);
  }

  async function addCourse() {
    const courseId = Number(newCourseId);
    if (!courseId) return;
    try {
      const r = await addCurriculumCourse(v.id, { courseId, roleType: 'CORE', isRequired: 1 });
      onMsg({ kind: 'ok', text: r.message });
      setNewCourseId('');
      await onRefresh();
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    }
  }

  async function remove(courseId: number) {
    try {
      const r = await removeCurriculumCourse(v.id, courseId);
      onMsg({ kind: 'ok', text: r.message });
      await onRefresh();
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    }
  }

  async function setSem(courseId: number, value: string) {
    try {
      const r = await assignCurriculumSemester(v.id, courseId, value === '' ? null : Number(value));
      onMsg({ kind: 'ok', text: r.message });
      await onRefresh();
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    }
  }

  async function toggleGrad(courseId: number, current: number) {
    try {
      await updateCurriculumCourse(v.id, courseId, { isGraduationRequired: current === 1 ? 0 : 1 });
      await onRefresh();
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    }
  }

  async function clearRule(courseId: number, kind: 'prereq' | 'coreq') {
    try {
      const r = await setCurriculumRule(v.id, kind, courseId, null, false);
      onMsg({ kind: 'ok', text: r.message });
      await onRefresh();
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-black">{v.title} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{v.versionCode}</span></h2>
          <Badge variant={STATUS_TONE[v.status] ?? 'secondary'} className="text-[9px]">{STATUS_FA[v.status] ?? v.status}</Badge>
          {canEdit ? <Badge variant="secondary" className="text-[9px]">قابل ویرایش</Badge> : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {v.status === 'DRAFT' ? (
            <Button size="sm" className="h-7 text-[10px]" disabled={act.isPending} onClick={() => act.mutate({ action: 'submit', note })}><Send className="size-3" aria-hidden /> ارجاع به بازبینی</Button>
          ) : null}
          {v.status === 'REVIEW' ? (
            <>
              <Button size="sm" variant="success" className="h-7 text-[10px]" disabled={act.isPending} onClick={() => act.mutate({ action: 'approve', note })}><CheckCircle2 className="size-3" aria-hidden /> تأیید</Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={act.isPending} onClick={() => act.mutate({ action: 'reject', note })}><X className="size-3" aria-hidden /> بازگشت به پیش‌نویس</Button>
            </>
          ) : null}
          {v.status === 'APPROVED' ? (
            <Button size="sm" className="h-7 text-[10px]" disabled={act.isPending} onClick={() => act.mutate({ action: 'publish', note })}><Layers className="size-3" aria-hidden /> انتشار</Button>
          ) : null}
          {v.status === 'PUBLISHED' ? (
            <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={act.isPending} onClick={() => act.mutate({ action: 'archive', note })}>بایگانی</Button>
          ) : null}
          {v.status === 'APPROVED' || v.status === 'PUBLISHED' ? (
            <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={act.isPending} onClick={() => act.mutate({ action: 'revision' })}><GitBranch className="size-3" aria-hidden /> ساخت ویرایش R+1</Button>
          ) : null}
          {canEdit ? (
            <>
              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={async () => {
                try { const r = await markCurriculumGrad(v.id); onMsg({ kind: 'ok', text: r.message }); await onRefresh(); } catch (e) { onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' }); }
              }}>علامت گروهی فارغ‌التحصیلی</Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={async () => {
                try { const r = await syncCurriculumRoles(v.id); onMsg({ kind: 'ok', text: r.message }); await onRefresh(); } catch (e) { onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' }); }
              }}>همگام‌سازی نقش‌ها</Button>
            </>
          ) : null}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت تصمیم (اختیاری)" className="h-7 max-w-48 text-[10px]" />
        </div>

        <div>
          <h3 className="mb-1 text-[11px] font-black">اعتبارسنجی ({faNumber(d.checks.length)} چک{d.blocked ? ' — مانع جدی' : ''})</h3>
          {d.checks.length === 0 ? <p className="text-[10px] text-emerald-700 dark:text-emerald-300">همهٔ چک‌ها سبز است.</p> : null}
          <div className="space-y-1">
            {d.checks.map((c, i) => <CheckRow key={i} c={c} />)}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-[11px] font-black">دروس نسخه ({faNumber(d.courses.length)})</h3>
            {canEdit ? (
              <div className="flex items-center gap-1">
                <Input value={newCourseId} onChange={(e) => setNewCourseId(e.target.value)} placeholder="شناسهٔ درس از بانک" className="h-6 w-40 font-mono text-[10px]" dir="ltr" />
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void addCourse()}>افزودن</Button>
              </div>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-[11px]">
              <thead className="bg-muted/60 text-muted-foreground"><tr>{['کد', 'درس', 'واحد', 'نقش', 'ترم', 'فارغ‌التحصیلی', 'قواعد', ''].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
              <tbody>
                {d.courses.map((c) => (
                  <tr key={c.courseId} className="border-t border-border/50">
                    <td className="p-2 font-mono">{c.code}</td>
                    <td className="p-2 font-bold">{c.title}</td>
                    <td className="p-2 font-mono">{faNumber(c.units)}</td>
                    <td className="p-2">{ROLE_FA[c.roleType] ?? c.roleType}{c.isRequired ? ' · الزامی' : ''}</td>
                    <td className="p-2">
                      {canEdit ? (
                        <select value={c.recommendedSemester ?? ''} onChange={(e) => void setSem(c.courseId, e.target.value)} className="h-6 rounded-md border border-input bg-card px-1 text-[10px]">
                          <option value="">—</option>
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n === 9 ? 'تابستان' : n}</option>)}
                        </select>
                      ) : c.recommendedSemester == null ? '—' : faNumber(c.recommendedSemester)}
                    </td>
                    <td className="p-2">
                      {canEdit ? (
                        <input type="checkbox" className="size-3.5 accent-emerald-600" checked={c.isGraduationRequired === 1} onChange={() => void toggleGrad(c.courseId, c.isGraduationRequired)} />
                      ) : c.isGraduationRequired ? '✓' : '—'}
                    </td>
                    <td className="p-2 text-[10px] text-muted-foreground">
                      {(rulesByCourse.get(c.courseId) ?? []).join(' | ') || '—'}
                      {canEdit && (rulesByCourse.get(c.courseId) ?? []).length > 0 ? (
                        <button type="button" className="ms-1 text-rose-600 hover:underline" onClick={() => void clearRule(c.courseId, 'prereq')}>حذف پیش‌نیاز</button>
                      ) : null}
                    </td>
                    <td className="p-2">
                      {canEdit ? <button type="button" className="text-rose-600 hover:underline" onClick={() => void remove(c.courseId)}><Trash2 className="inline size-3.5" aria-hidden /></button> : null}
                    </td>
                  </tr>
                ))}
                {d.courses.length === 0 ? <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">درسی به نسخه افزوده نشده است.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        {d.approvals.length > 0 ? (
          <div>
            <h3 className="mb-1 text-[11px] font-black">تاریخچهٔ تصمیم‌ها</h3>
            <div className="space-y-1">
              {d.approvals.map((a) => (
                <div key={a.id} className="rounded-lg border border-border/60 p-2 text-[10px]">
                  <b>{a.approvalType}</b> · {a.fromStatus} → {a.toStatus} · {a.approvedBy} · {a.approvedAt?.slice(0, 16).replace('T', ' ')}
                  {a.decisionNote ? <span className="text-muted-foreground"> — {a.decisionNote}</span> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CheckRow({ c }: { c: CurriculumCheck }) {
  const err = c.severity === 'ERROR';
  return (
    <div className={`rounded-lg border p-2 text-[10px] ${err ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200' : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'}`}>
      <b>{c.check}</b> — {c.message}
      {c.affected.length ? <span className="text-muted-foreground"> ({c.affected.slice(0, 8).join('، ')})</span> : null}
    </div>
  );
}

function CreateModal({ majors, onClose, onSaved }: {
  majors: { id: number; name: string; degreeLevelId: number }[];
  onClose: () => void;
  onSaved: (text: string) => Promise<void>;
}) {
  void majors;
  const [form, setForm] = useState({ majorId: '', versionCode: '', title: '', entryYearFrom: '1406', entryYearTo: '', totalRequiredUnits: '', cloneFromId: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setErr('');
    try {
      const r = await createCurriculumVersion({
        majorId: Number(form.majorId),
        versionCode: form.versionCode.trim(),
        title: form.title.trim() || undefined,
        entryYearFrom: Number(form.entryYearFrom) || new Date().getFullYear(),
        entryYearTo: form.entryYearTo ? Number(form.entryYearTo) : null,
        totalRequiredUnits: form.totalRequiredUnits ? Number(form.totalRequiredUnits) : null,
        cloneFromId: form.cloneFromId ? Number(form.cloneFromId) : null,
      });
      await onSaved(r.message);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطا');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} dir="rtl">
      <div className="w-full max-w-md space-y-2 rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="font-bold">نسخهٔ برنامهٔ درسی جدید</h2><button type="button" onClick={onClose}><X className="size-5" aria-hidden /></button></div>
        {err ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div> : null}
        {([
          ['majorId', 'رشته *'],
          ['versionCode', 'کد نسخه * (مثلاً 1406 یا 1406-R2)'],
          ['title', 'عنوان'],
          ['entryYearFrom', 'ورودی از *'],
          ['entryYearTo', 'ورودی تا'],
          ['totalRequiredUnits', 'کل واحدهای لازم'],
          ['cloneFromId', 'شناسهٔ نسخه برای کپی (اختیاری)'],
        ] as const).map(([k, l]) => (
          <label key={k} className="block space-y-1 text-[10px] text-muted-foreground"><span>{l}</span><Input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="h-8 text-[11px]" dir={k === 'versionCode' ? 'ltr' : 'auto'} /></label>
        ))}
        <div className="flex justify-end gap-2 pt-1"><Button size="sm" variant="outline" onClick={onClose}>انصراف</Button><Button size="sm" disabled={busy || !form.majorId || !form.versionCode.trim()} onClick={() => void save()}>ذخیره</Button></div>
      </div>
    </div>
  );
}

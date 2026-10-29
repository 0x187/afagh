import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Plus, Save, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  assignStaffTermRole, createDutyRole, createRoleDef, deleteDutyRole, deleteRoleDef,
  getAssignments, getDutyRoles, getPayrollTerms, getRoleDefs, getRuleCoverage,
  searchPayrollStaff, unassignStaffTermRole, updateDutyRole, updateRoleDef,
} from '@/lib/payroll-api';

// ═══ سمتهای موظفی + انتساب ترمی + نقشهای تدریس — پورت payroll/roles و teaching-roles ═══

const emptyRole = { code: '', title: '', dutyUnits: '', reductionUnits: 0, isTeaching: false, sortOrder: 0 };

export function PayrollRolesPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [roleForm, setRoleForm] = useState({ ...emptyRole });
  const [editRoleId, setEditRoleId] = useState(0);
  const [staffQuery, setStaffQuery] = useState('');
  const [staffId, setStaffId] = useState(0);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [termId, setTermId] = useState(0);
  const [assignRoleId, setAssignRoleId] = useState(0);
  const [isPrimary, setIsPrimary] = useState(false);

  const roles = useQuery({ queryKey: ['duty-roles'], queryFn: getDutyRoles, staleTime: 30_000 });
  const terms = useQuery({ queryKey: ['payroll-terms'], queryFn: getPayrollTerms, staleTime: 60_000 });
  const hits = useQuery({
    queryKey: ['payroll-staff', staffQuery],
    queryFn: () => searchPayrollStaff(staffQuery),
    enabled: staffQuery.trim().length >= 2,
  });
  const assignments = useQuery({
    queryKey: ['payroll-assignments', staffId, termId],
    queryFn: () => getAssignments(staffId, termId),
    enabled: staffId > 0 && termId > 0,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['duty-roles'] });
    void qc.invalidateQueries({ queryKey: ['payroll-assignments', staffId, termId] });
  };

  const saveRoleMut = useMutation({
    mutationFn: async () => {
      const input = { ...roleForm, dutyUnits: roleForm.dutyUnits === '' ? null : Number(roleForm.dutyUnits) };
      if (editRoleId) await updateDutyRole(editRoleId, input);
      else await createDutyRole(input);
    },
    onSuccess: () => {
      setMsg(editRoleId ? 'سمت ویرایش شد.' : 'سمت ساخته شد.');
      setRoleForm({ ...emptyRole });
      setEditRoleId(0);
      refresh();
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const delRoleMut = useMutation({
    mutationFn: deleteDutyRole,
    onSuccess: () => { setMsg('سمت حذف شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const assignMut = useMutation({
    mutationFn: () => assignStaffTermRole(staffId, termId, assignRoleId, isPrimary),
    onSuccess: () => { setMsg('انتساب ثبت شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const unassignMut = useMutation({
    mutationFn: unassignStaffTermRole,
    onSuccess: () => { setMsg('انتساب حذف شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });

  if (roles.isLoading || terms.isLoading) return <Skeleton className="h-72 w-full" />;

  const termOptions = terms.data ?? [];
  const currentTerm = termOptions.find((t) => t.isCurrent) ?? termOptions[0];
  const effectiveTerm = termId || (currentTerm?.id ?? 0);

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-sky-900 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-base font-black"><UserRound className="size-5" aria-hidden /> سمتهای موظفی و انتساب ترمی</h1>
          <p className="mt-0.5 text-xs text-sky-100">ماهیت: موظفی از «نقش تدریسی» استاد میآید نه مرتبهٔ علمی — بدون نقش، بازگشت به موظفی قرارداد.</p>
          <div className="mt-2">
            <Label className="text-[11px] text-sky-100">ترم</Label>
            <select value={effectiveTerm} onChange={(e) => setTermId(Number(e.target.value))} className="mt-1 h-8 rounded-lg border border-white/30 bg-transparent px-2 text-xs text-white">
              {termOptions.map((t) => <option key={t.id} value={t.id} className="text-foreground">{t.title}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      {/* انتساب ترمی */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">انتساب سمت به استاد در ترم</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-[11px]">جستوجوی استاد</Label>
              <Input value={staffQuery} onChange={(e) => setStaffQuery(e.target.value)} className="mt-1 h-8" placeholder="کد پرسنلی یا نام…" />
              {(hits.data ?? []).length > 0 ? (
                <div className="mt-1 space-y-0.5">
                  {(hits.data ?? []).map((h) => (
                    <button key={h.id} type="button" onClick={() => { setStaffId(h.id); setSelectedStaff(`${h.name} — ${h.staffCode ? faDigits(h.staffCode) : ''}`); setStaffQuery(''); }}
                      className={`block w-full rounded border px-2 py-0.5 text-right text-[11px] ${staffId === h.id ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950' : 'border-border'}`}>
                      {h.name} {h.rank ? `· ${h.rank}` : ''} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{h.staffCode}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {selectedStaff ? <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">انتخاب: {selectedStaff}</p> : null}
            </div>
            <div><Label className="text-[11px]">سمت</Label>
              <select value={assignRoleId} onChange={(e) => setAssignRoleId(Number(e.target.value))} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                <option value="0">—</option>
                {(roles.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.title} ({r.code})</option>)}
              </select>
              <label className="mt-1 flex items-center gap-1 text-[11px]"><input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> نقش اصلی تدریس</label>
            </div>
            <div className="flex items-end">
              <Button size="sm" disabled={assignMut.isPending || !staffId || !effectiveTerm || !assignRoleId} onClick={() => assignMut.mutate()}>
                <Plus className="size-4" aria-hidden /> افزودن انتساب
              </Button>
            </div>
          </div>

          {assignments.data ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 text-[11px]">
                <Badge variant="outline">
                  موظفی مؤثر: {assignments.data.effectiveDuty == null ? '— (fallback قرارداد)' : `${faNumber(assignments.data.effectiveDuty)} واحد`}
                </Badge>
                <Badge variant="outline">پایهٔ قرارداد: {faNumber(assignments.data.fallbackDuty)} واحد</Badge>
              </div>
              <table className="w-full border-collapse text-right text-xs">
                <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">سمت</th><th className="p-1.5">کد</th><th className="p-1.5 text-center">موظفی</th><th className="p-1.5 text-center">کسر</th><th className="p-1.5 text-center">تدریس</th><th className="p-1.5 text-center">اصلی</th><th className="p-1.5"></th></tr></thead>
                <tbody>
                  {assignments.data.assigned.length === 0 ? (
                    <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">انتسابی ثبت نشده است.</td></tr>
                  ) : assignments.data.assigned.map((a) => (
                    <tr key={a.assignmentId} className="border-b border-border/40 last:border-0">
                      <td className="p-1.5 font-semibold">{a.title}</td>
                      <td className="p-1.5 font-mono text-[10px]" dir="ltr">{a.code}</td>
                      <td className="p-1.5 text-center font-mono">{a.dutyUnits == null ? '—' : faNumber(a.dutyUnits)}</td>
                      <td className="p-1.5 text-center font-mono">{faNumber(a.reductionUnits)}</td>
                      <td className="p-1.5 text-center">{a.isTeaching ? '✓' : '—'}</td>
                      <td className="p-1.5 text-center">{a.isPrimary ? '★' : '—'}</td>
                      <td className="p-1.5">
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={unassignMut.isPending} onClick={() => unassignMut.mutate(a.assignmentId)}><Trash2 className="size-3.5" aria-hidden /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* کاتالوگ سمت‌ها */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">کاتالوگ سمت‌های موظفی</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-6">
            <div><Label className="text-[11px]">کد</Label><Input value={roleForm.code} disabled={editRoleId > 0} onChange={(e) => setRoleForm({ ...roleForm, code: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
            <div className="lg:col-span-2"><Label className="text-[11px]">عنوان</Label><Input value={roleForm.title} onChange={(e) => setRoleForm({ ...roleForm, title: e.target.value })} className="mt-1 h-8" /></div>
            <div><Label className="text-[11px]">موظفی (خالی = تعییننشده)</Label><Input type="number" value={roleForm.dutyUnits} onChange={(e) => setRoleForm({ ...roleForm, dutyUnits: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" placeholder="—" /></div>
            <div><Label className="text-[11px]">کسر موظفی</Label><Input type="number" value={roleForm.reductionUnits} onChange={(e) => setRoleForm({ ...roleForm, reductionUnits: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
            <div className="flex items-end gap-3 text-[11px]">
              <label className="flex items-center gap-1"><input type="checkbox" checked={roleForm.isTeaching} onChange={(e) => setRoleForm({ ...roleForm, isTeaching: e.target.checked })} /> نقش تدریسی</label>
              <label className="flex items-center gap-1"><input type="number" min={0} value={roleForm.sortOrder} onChange={(e) => setRoleForm({ ...roleForm, sortOrder: Number(e.target.value) })} className="h-8 w-14 rounded-lg border border-input bg-transparent px-1 text-center font-mono" dir="ltr" title="ترتیب" /></label>
            </div>
            <div className="flex items-end gap-2 lg:col-span-2">
              <Button size="sm" disabled={saveRoleMut.isPending || !roleForm.code || !roleForm.title} onClick={() => saveRoleMut.mutate()}>
                {editRoleId ? <Save className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />} {editRoleId ? 'ذخیرهٔ ویرایش' : 'ساخت سمت'}
              </Button>
              {editRoleId ? <Button size="sm" variant="ghost" onClick={() => { setEditRoleId(0); setRoleForm({ ...emptyRole }); }}>انصراف</Button> : null}
            </div>
          </div>
          <table className="w-full border-collapse text-right text-xs">
            <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2 text-center">موظفی</th><th className="p-2 text-center">کسر</th><th className="p-2 text-center">تدریس</th><th className="p-2 text-center">ترتیب</th><th className="p-2"></th></tr></thead>
            <tbody>
              {(roles.data ?? []).length === 0 ? (
                <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">سمتی ثبت نشده است.</td></tr>
              ) : (roles.data ?? []).map((r) => (
                <tr key={r.id} className="border-b border-border/40 last:border-0">
                  <td className="p-2 font-mono text-[10px]" dir="ltr">{r.code}</td>
                  <td className="p-2 font-semibold">{r.title}</td>
                  <td className="p-2 text-center font-mono">{r.dutyUnits == null ? '—' : faNumber(r.dutyUnits)}</td>
                  <td className="p-2 text-center font-mono">{faNumber(r.reductionUnits)}</td>
                  <td className="p-2 text-center">{r.isTeaching ? '✓' : '—'}</td>
                  <td className="p-2 text-center font-mono">{faNumber(r.sortOrder)}</td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => { setEditRoleId(r.id); setRoleForm({ code: r.code, title: r.title, dutyUnits: r.dutyUnits == null ? '' : String(r.dutyUnits), reductionUnits: r.reductionUnits, isTeaching: r.isTeaching, sortOrder: r.sortOrder }); }}><Save className="size-3.5" aria-hidden /></Button>
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delRoleMut.isPending} onClick={() => { if (confirm(`حذف سمت «${r.title}»؟ انتسابهایش هم حذف میشود.`)) delRoleMut.mutate(r.id); }}><Trash2 className="size-3.5" aria-hidden /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══ نقش‌های تدریس قابل‌تعریف ═══

const emptyDef = { code: '', title: '', description: '', isActive: true };

export function TeachingRolesPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyDef });
  const [editId, setEditId] = useState(0);

  const defs = useQuery({ queryKey: ['role-defs'], queryFn: getRoleDefs, staleTime: 30_000 });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['role-defs'] });

  const saveMut = useMutation({
    mutationFn: async () => {
      const input = { code: form.code, title: form.title, description: form.description || undefined, isActive: form.isActive };
      if (editId) await updateRoleDef(editId, input);
      else await createRoleDef(input);
    },
    onSuccess: () => { setMsg('نقش ذخیره شد.'); setForm({ ...emptyDef }); setEditId(0); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const delMut = useMutation({
    mutationFn: deleteRoleDef,
    onSuccess: () => { setMsg('نقش حذف شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });

  if (defs.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-indigo-800 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-base font-black"><BadgeCheck className="size-5" aria-hidden /> کاتالوگ نقش‌های تدریس</h1>
          <p className="mt-0.5 text-xs text-indigo-100">این نقش‌ها در موتور حقالتدریس و «نقش دستی ارائه» استفاده میشوند — کد یکتای لاتین.</p>
        </CardContent>
      </Card>
      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-5">
            <div><Label className="text-[11px]">کد</Label><Input value={form.code} disabled={editId > 0} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" placeholder="SUPERVISOR" /></div>
            <div className="lg:col-span-2"><Label className="text-[11px]">عنوان</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 h-8" /></div>
            <div className="lg:col-span-1"><Label className="text-[11px]">توضیح</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 h-8" /></div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> فعال</label>
              <Button size="sm" disabled={saveMut.isPending || !form.code || !form.title} onClick={() => saveMut.mutate()}>
                {editId ? <Save className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />} {editId ? 'ذخیره' : 'افزودن'}
              </Button>
              {editId ? <Button size="sm" variant="ghost" onClick={() => { setEditId(0); setForm({ ...emptyDef }); }}>انصراف</Button> : null}
            </div>
          </div>
          <table className="w-full border-collapse text-right text-xs">
            <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2">توضیح</th><th className="p-2 text-center">فعال</th><th className="p-2"></th></tr></thead>
            <tbody>
              {(defs.data ?? []).length === 0 ? (
                <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">نقشی ثبت نشده است.</td></tr>
              ) : (defs.data ?? []).map((d) => (
                <tr key={d.id} className="border-b border-border/40 last:border-0">
                  <td className="p-2 font-mono text-[10px]" dir="ltr">{d.code}</td>
                  <td className="p-2 font-semibold">{d.title}</td>
                  <td className="p-2 text-muted-foreground">{d.description ?? '—'}</td>
                  <td className="p-2 text-center"><Badge variant={d.isActive ? 'default' : 'outline'} className="text-[10px]">{d.isActive ? 'فعال' : 'غیرفعال'}</Badge></td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => { setEditId(d.id); setForm({ code: d.code, title: d.title, description: d.description ?? '', isActive: d.isActive }); }}><Save className="size-3.5" aria-hidden /></Button>
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delMut.isPending} onClick={() => { if (confirm(`حذف نقش «${d.title}»؟`)) delMut.mutate(d.id); }}><Trash2 className="size-3.5" aria-hidden /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══ پوشش فرمول‌ها ═══

const MISS_DIM_FA: Record<string, string> = {
  none: 'قانونی ثبت نشده', offeringType: 'نوع درس', professorRole: 'نقش استاد',
  academicRank: 'مرتبهٔ علمی', classMode: 'وضعیت کلاس', studentRange: 'تعداد دانشجو',
  department: 'گروه آموزشی', courseType: 'نوع درس کاتالوگ', repeat: 'نوبت تکرار', unknown: 'نامشخص',
};

export function PayrollCoveragePage() {
  const terms = useQuery({ queryKey: ['payroll-terms'], queryFn: getPayrollTerms, staleTime: 60_000 });
  const [termId, setTermId] = useState(0);
  const current = (terms.data ?? []).find((t) => t.isCurrent) ?? (terms.data ?? [])[0];
  const effectiveTerm = termId || (current?.id ?? 0);
  const rows = useQuery({
    queryKey: ['payroll-coverage', effectiveTerm],
    queryFn: () => getRuleCoverage(effectiveTerm),
    enabled: effectiveTerm > 0,
  });

  if (terms.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-teal-900 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-5">
          <div>
            <h1 className="text-base font-black">پوشش فرمول‌های حقالتدریس</h1>
            <p className="mt-0.5 text-xs text-teal-100">هر ارائهٔ هر استاد چه فرمولی دارد یا چرا ندارد — علت‌یابی پلکانی</p>
          </div>
          <select value={effectiveTerm} onChange={(e) => setTermId(Number(e.target.value))} className="h-8 rounded-lg border border-white/30 bg-transparent px-2 text-xs text-white">
            {(terms.data ?? []).map((t) => <option key={t.id} value={t.id} className="text-foreground">{t.title}</option>)}
          </select>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="overflow-x-auto pt-4">
          {rows.isLoading ? <Skeleton className="h-48 w-full" /> : (
            <table className="w-full border-collapse text-right text-[11px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                  <th className="p-2">استاد</th><th className="p-2">درس</th><th className="p-2">نوع/نقش</th>
                  <th className="p-2 text-center">دانشجو</th><th className="p-2 text-center">نوبت</th>
                  <th className="p-2">فرمول/علت نبود</th>
                </tr>
              </thead>
              <tbody>
                {(rows.data ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">ارائه‌ای برای پوشش یافت نشد.</td></tr>
                ) : (rows.data ?? []).map((r) => (
                  <tr key={r.offeringId} className={`border-b border-border/40 last:border-0 ${r.ruleId == null ? 'bg-rose-50/40 dark:bg-rose-950/20' : ''}`}>
                    <td className="p-2">{r.staffName}</td>
                    <td className="p-2">
                      <div className="font-semibold">{r.courseTitle}</div>
                      <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{r.courseCode}{r.groupNumber != null ? ` · G${r.groupNumber}` : ''}</div>
                    </td>
                    <td className="p-2">
                      <div>{r.offeringTypeFa} · {r.roleFa}</div>
                      {r.overrideCode ? <div className="text-[10px] text-amber-700 dark:text-amber-300">نقش دستی: {r.overrideCode}</div> : null}
                      {r.merged ? <div className="text-[10px] text-muted-foreground">کلاس ادغامی ({faNumber(r.memberCount)})</div> : null}
                    </td>
                    <td className="p-2 text-center font-mono">{faNumber(r.enrolled)}</td>
                    <td className="p-2 text-center font-mono">{faDigits(r.nth)}</td>
                    <td className="p-2">
                      {r.ruleId != null ? (
                        <>
                          <span className="font-bold text-emerald-700 dark:text-emerald-300">{r.ruleTitle ?? 'فرمول'}</span>
                          <span className="font-mono text-[10px] text-muted-foreground" dir="ltr"> {r.expression ?? ''}</span>
                        </>
                      ) : (
                        <>
                          <span className="font-bold text-rose-700 dark:text-rose-300">بدون فرمول — {MISS_DIM_FA[r.missDim ?? 'unknown'] ?? r.missDim}</span>
                          <div className="text-[10px] text-muted-foreground">{r.missReason}</div>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

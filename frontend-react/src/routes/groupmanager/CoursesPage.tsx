import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookPlus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import { deleteCourse, getCourses, saveCourse, type GmCourse } from '@/lib/groupmanager-api';
import { GmLayout } from './GmLayout';

// ═══ دروس گروه — پورت group-manager/courses ═══

const TYPES = ['عمومی', 'پایه', 'اصلی', 'تخصصی', 'اختیاری'];

function CourseRow({ course }: { course: GmCourse }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    code: course.code,
    title: course.title,
    theory: Number(course.theoreticalUnits ?? 0),
    practical: Number(course.practicalUnits ?? 0),
    courseType: course.courseType ?? 'تخصصی',
    grading: course.gradingType ?? 'NUMERIC',
    affectsGpa: !!course.affectsGpa,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const saveMut = useMutation({
    mutationFn: () => saveCourse({ id: course.id, ...form }),
    onSuccess: async () => {
      setMsg('ذخیره شد.');
      await qc.invalidateQueries({ queryKey: ['gm-courses'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const delMut = useMutation({
    mutationFn: () => deleteCourse(course.id),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ['gm-courses'] }),
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="h-7 w-24 font-mono text-[11px]" dir="ltr" />
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="h-7 min-w-40 flex-1 text-[11px]" />
          <Input type="number" min={0} step="0.25" value={form.theory} onChange={(e) => setForm({ ...form, theory: Number(e.target.value) })} className="h-7 w-16 text-center text-[11px]" title="تئوری" />
          <Input type="number" min={0} step="0.25" value={form.practical} onChange={(e) => setForm({ ...form, practical: Number(e.target.value) })} className="h-7 w-16 text-center text-[11px]" title="عملی" />
          <select value={form.courseType} onChange={(e) => setForm({ ...form, courseType: e.target.value })} className="h-7 rounded border border-input bg-transparent px-1 text-[11px]">
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select value={form.grading} onChange={(e) => setForm({ ...form, grading: e.target.value })} className="h-7 rounded border border-input bg-transparent px-1 text-[11px]">
            <option value="NUMERIC">عددی</option>
            <option value="PASS_FAIL">قبول/رد</option>
          </select>
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
            معدل <input type="checkbox" checked={form.affectsGpa} onChange={(e) => setForm({ ...form, affectsGpa: e.target.checked })} />
          </label>
          <Button size="sm" variant="outline" className="h-7 px-2" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
            <Save className="size-3.5" aria-hidden />
          </Button>
          <BadgeMali type={course.legacyMaliType} />
          <Button size="sm" variant="ghost" className="h-7 px-1.5 text-rose-600" disabled={delMut.isPending} onClick={() => delMut.mutate()}>
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </div>
        {msg ? <p className="mt-1 text-[10px] text-muted-foreground">{msg}</p> : null}
      </td>
    </tr>
  );
}

function BadgeMali({ type }: { type: number | null }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${type == null ? 'bg-rose-100 font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-200' : 'bg-secondary text-secondary-foreground'}`}>
      {type == null ? 'نوع مالی: تعیین‌نشده' : `نوع مالی: ${faNumber(type)}`}
    </span>
  );
}

export function GmCoursesPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['gm-courses'], queryFn: getCourses, staleTime: 30_000 });
  const [form, setForm] = useState({ code: '', title: '', theory: 3, practical: 0, courseType: 'تخصصی', grading: 'NUMERIC', affectsGpa: true, maliType: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const createMut = useMutation({
    mutationFn: () =>
      saveCourse({
        code: form.code,
        title: form.title,
        theory: form.theory,
        practical: form.practical,
        courseType: form.courseType,
        grading: form.grading,
        affectsGpa: form.affectsGpa,
        maliType: form.maliType === '' ? null : Number(form.maliType),
      }),
    onSuccess: async () => {
      setMsg('درس تعریف شد.');
      setForm({ code: '', title: '', theory: 3, practical: 0, courseType: 'تخصصی', grading: 'NUMERIC', affectsGpa: true, maliType: '' });
      await qc.invalidateQueries({ queryKey: ['gm-courses'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <GmLayout>
      {isLoading ? <Skeleton className="h-64 w-full" /> : isError || !data ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت دروس ناموفق بود.</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><BookPlus className="size-4 text-emerald-600" aria-hidden /> تعریف درس جدید — {data.deptName}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <div><Label>کد</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} dir="ltr" className="mt-1" placeholder="5122305" /></div>
                <div className="sm:col-span-2"><Label>عنوان</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1" placeholder="یادگیری ماشین" /></div>
                <div><Label>تئوری</Label><Input type="number" min={0} step="0.25" value={form.theory} onChange={(e) => setForm({ ...form, theory: Number(e.target.value) })} className="mt-1" /></div>
                <div><Label>عملی</Label><Input type="number" min={0} step="0.25" value={form.practical} onChange={(e) => setForm({ ...form, practical: Number(e.target.value) })} className="mt-1" /></div>
                <div>
                  <Label>نوع</Label>
                  <select value={form.courseType} onChange={(e) => setForm({ ...form, courseType: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm">
                    {TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div><Label>نوع درس مالی</Label><Input type="number" value={form.maliType} onChange={(e) => setForm({ ...form, maliType: e.target.value })} className="mt-1" placeholder="مثلاً 1" dir="ltr" /></div>
                <div>
                  <Label>نمره‌دهی</Label>
                  <select value={form.grading} onChange={(e) => setForm({ ...form, grading: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm">
                    <option value="NUMERIC">عددی</option>
                    <option value="PASS_FAIL">قبول/رد</option>
                  </select>
                </div>
                <label className="flex items-end gap-2 pb-2 text-xs font-bold">
                  <input type="checkbox" checked={form.affectsGpa} onChange={(e) => setForm({ ...form, affectsGpa: e.target.checked })} />
                  مؤثر بر معدل
                </label>
                <div className="flex items-end">
                  <Button size="sm" disabled={createMut.isPending || !form.code || !form.title} onClick={() => createMut.mutate()}>افزودن درس</Button>
                </div>
              </div>
              {msg ? <p className="text-[11px] text-muted-foreground">{msg}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">دروس گروه ({faNumber(data.courses.length)})</CardTitle></CardHeader>
            <CardContent>
              {data.courses.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">درسی تعریف نشده است.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2">کد / عنوان / واحد / نوع / عملیات</th></tr></thead>
                    <tbody>{data.courses.map((c) => <CourseRow key={c.id} course={c} />)}</tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </GmLayout>
  );
}

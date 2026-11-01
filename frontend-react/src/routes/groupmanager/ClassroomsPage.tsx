import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, PlusCircle, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import { deleteClassroom, getClassrooms, saveClassroom, type GmClassroom } from '@/lib/groupmanager-api';
import { GmLayout } from './GmLayout';

// ═══ Classrooms — port of group-manager/classrooms ═══

function ClassroomRow({ room, faculties }: { room: GmClassroom; faculties: { id: number; name: string }[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: room.name,
    code: room.code ?? '',
    capacity: room.capacity,
    roomType: room.roomType ?? 'THEORY',
    facultyId: room.facultyId ? String(room.facultyId) : '',
    floor: room.floor ?? '',
    rows: room.rowsCount != null ? String(room.rowsCount) : '',
    cols: room.colsCount != null ? String(room.colsCount) : '',
    isActive: room.isActive,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const saveMut = useMutation({
    mutationFn: () =>
      saveClassroom({
        id: room.id,
        name: form.name,
        code: form.code,
        capacity: form.capacity,
        roomType: form.roomType,
        facultyId: form.facultyId ? Number(form.facultyId) : null,
        floor: form.floor,
        rows: form.rows ? Number(form.rows) : null,
        cols: form.cols ? Number(form.cols) : null,
        isActive: form.isActive,
      }),
    onSuccess: async () => {
      setMsg('ذخیره شد.');
      await qc.invalidateQueries({ queryKey: ['gm-classrooms'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const delMut = useMutation({
    mutationFn: () => deleteClassroom(room.id),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ['gm-classrooms'] }),
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="p-2">
        <div className="flex flex-wrap items-end gap-1.5 text-[11px]">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-7 w-32" placeholder="نام کلاس" />
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="h-7 w-20 font-mono" dir="ltr" placeholder="کد" />
          <Input type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} className="h-7 w-16 text-center" title="ظرفیت" />
          <select value={form.roomType} onChange={(e) => setForm({ ...form, roomType: e.target.value })} className="h-7 rounded border border-input bg-transparent px-1">
            <option value="THEORY">نظری</option>
            <option value="LAB">آزمایشگاه</option>
            <option value="WORKSHOP">کارگاه</option>
          </select>
          <select value={form.facultyId} onChange={(e) => setForm({ ...form, facultyId: e.target.value })} className="h-7 rounded border border-input bg-transparent px-1">
            <option value="">دانشکده…</option>
            {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <Input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} className="h-7 w-16" placeholder="طبقه" />
          <Input type="number" value={form.rows} onChange={(e) => setForm({ ...form, rows: e.target.value })} className="h-7 w-14 text-center" title="ردیف" />
          <span className="text-muted-foreground">×</span>
          <Input type="number" value={form.cols} onChange={(e) => setForm({ ...form, cols: e.target.value })} className="h-7 w-14 text-center" title="ستون" />
          <Button size="sm" variant="outline" className="h-7 px-2" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}><Save className="size-3.5" aria-hidden /></Button>
          <Button size="sm" variant="ghost" className="h-7 px-1.5 text-rose-600" disabled={delMut.isPending} onClick={() => delMut.mutate()}><Trash2 className="size-3.5" aria-hidden /></Button>
        </div>
        {msg ? <p className="mt-1 text-[10px] text-muted-foreground">{msg}</p> : null}
      </td>
    </tr>
  );
}

export function GmClassroomsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['gm-classrooms'], queryFn: getClassrooms, staleTime: 30_000 });
  const [form, setForm] = useState({ name: '', code: '', capacity: 30, roomType: 'THEORY', facultyId: '', floor: '', rows: '', cols: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const createMut = useMutation({
    mutationFn: () =>
      saveClassroom({
        name: form.name,
        code: form.code,
        capacity: form.capacity,
        roomType: form.roomType,
        facultyId: form.facultyId ? Number(form.facultyId) : null,
        floor: form.floor,
        rows: form.rows ? Number(form.rows) : null,
        cols: form.cols ? Number(form.cols) : null,
      }),
    onSuccess: async () => {
      setMsg('کلاس افزوده شد.');
      setForm({ name: '', code: '', capacity: 30, roomType: 'THEORY', facultyId: '', floor: '', rows: '', cols: '' });
      await qc.invalidateQueries({ queryKey: ['gm-classrooms'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <GmLayout>
      {isLoading ? <Skeleton className="h-64 w-full" /> : isError || !data ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت کلاس‌ها ناموفق بود.</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><DoorOpen className="size-4 text-emerald-600" aria-hidden /> تعریف کلاس جدید</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap items-end gap-2 text-[11px]">
                <div className="w-36"><Label>نام</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 h-8" /></div>
                <div className="w-24"><Label>کد</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
                <div className="w-20"><Label>ظرفیت</Label><Input type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} className="mt-1 h-8" /></div>
                <div className="w-28"><Label>نوع</Label>
                  <select value={form.roomType} onChange={(e) => setForm({ ...form, roomType: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2">
                    <option value="THEORY">نظری</option>
                    <option value="LAB">آزمایشگاه</option>
                    <option value="WORKSHOP">کارگاه</option>
                  </select>
                </div>
                <div className="w-40"><Label>دانشکده</Label>
                  <select value={form.facultyId} onChange={(e) => setForm({ ...form, facultyId: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2">
                    <option value="">—</option>
                    {data.faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div className="w-20"><Label>طبقه</Label><Input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} className="mt-1 h-8" /></div>
                <div className="w-16"><Label>ردیف</Label><Input type="number" value={form.rows} onChange={(e) => setForm({ ...form, rows: e.target.value })} className="mt-1 h-8" /></div>
                <div className="w-16"><Label>ستون</Label><Input type="number" value={form.cols} onChange={(e) => setForm({ ...form, cols: e.target.value })} className="mt-1 h-8" /></div>
                <Button size="sm" disabled={createMut.isPending || !form.name} onClick={() => createMut.mutate()}><PlusCircle className="size-4" aria-hidden /> افزودن</Button>
              </div>
              {msg ? <p className="text-[11px] text-muted-foreground">{msg}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">کلاس‌ها ({faNumber(data.classrooms.length)})</CardTitle></CardHeader>
            <CardContent>
              {data.classrooms.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">کلاسی تعریف نشده است.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <tbody>{data.classrooms.map((r) => <ClassroomRow key={r.id} room={r} faculties={data.faculties} />)}</tbody>
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

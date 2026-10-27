import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import { bulkCompensatory, getCompensatory, saveCompensatory, type GmCompensatoryData } from '@/lib/groupmanager-api';
import { GmLayout } from './GmLayout';

// ═══ دانشجویان جبرانی — پورت group-manager/compensatory ═══

function StudentRow({ student }: { student: GmCompensatoryData['students'][number] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    previousMajorCode: student.previousMajorCode ?? '',
    previousMajorTitle: student.previousMajorTitle ?? '',
    previousMajorRelation: student.previousMajorRelation ?? '',
    compensatoryUnits: student.compensatoryUnits ?? 0,
    honorsOverride: student.honorsOverride == null ? '' : String(student.honorsOverride),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const saveMut = useMutation({
    mutationFn: () =>
      saveCompensatory({
        studentId: student.id,
        previousMajorCode: form.previousMajorCode,
        previousMajorTitle: form.previousMajorTitle,
        previousMajorRelation: form.previousMajorRelation,
        compensatoryUnits: form.compensatoryUnits,
        honorsOverride: form.honorsOverride === '' ? null : Number(form.honorsOverride),
      }),
    onSuccess: async () => {
      setMsg('ذخیره شد.');
      await qc.invalidateQueries({ queryKey: ['gm-compensatory'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <p className="text-xs font-black">{student.fullName} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{student.studentCode}</span></p>
          <p className="text-[10px] text-muted-foreground">{student.majorName}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-[11px]">
          <div className="w-28"><Label>کد رشتهٔ قبلی</Label><Input value={form.previousMajorCode} onChange={(e) => setForm({ ...form, previousMajorCode: e.target.value })} className="mt-1 h-7 font-mono" /></div>
          <div className="min-w-40 flex-1"><Label>عنوان رشتهٔ قبلی</Label><Input value={form.previousMajorTitle} onChange={(e) => setForm({ ...form, previousMajorTitle: e.target.value })} className="mt-1 h-7" /></div>
          <div className="w-28"><Label>نسبت</Label>
            <select value={form.previousMajorRelation} onChange={(e) => setForm({ ...form, previousMajorRelation: e.target.value })} className="mt-1 h-7 w-full rounded border border-input bg-transparent px-1">
              <option value="">—</option><option value="RELATED">مرتبط</option><option value="PARTIAL">نیمه‌مرتبط</option><option value="UNRELATED">نامرتبط</option>
            </select>
          </div>
          <div className="w-20"><Label>واحد جبرانی</Label><Input type="number" min={0} value={form.compensatoryUnits} onChange={(e) => setForm({ ...form, compensatoryUnits: Number(e.target.value) })} className="mt-1 h-7" /></div>
          <div className="w-24"><Label>ممتاز</Label>
            <select value={form.honorsOverride} onChange={(e) => setForm({ ...form, honorsOverride: e.target.value })} className="mt-1 h-7 w-full rounded border border-input bg-transparent px-1">
              <option value="">خودکار</option><option value="1">ممتاز</option><option value="0">غیرممتاز</option>
            </select>
          </div>
          <Button size="sm" variant="outline" className="h-7" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}><Save className="size-3.5" aria-hidden /> ذخیره</Button>
        </div>
        {msg ? <p className="text-[10px] text-muted-foreground">{msg}</p> : null}
      </CardContent>
    </Card>
  );
}

export function GmCompensatoryPage() {
  const qc = useQueryClient();
  const [year, setYear] = useState<number | undefined>(undefined);
  const { data, isLoading, isError } = useQuery({ queryKey: ['gm-compensatory', year], queryFn: () => getCompensatory(year), staleTime: 20_000 });
  const [units, setUnits] = useState(6);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (data && year == null) setYear(data.year);
  }, [data, year]);
  const bulkMut = useMutation({
    mutationFn: () => bulkCompensatory(data!.year, units),
    onSuccess: async () => {
      setMsg('واحد جبرانی برای دانشجویان نامرتبط اعمال شد.');
      await qc.invalidateQueries({ queryKey: ['gm-compensatory'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const unrelated = (data?.students ?? []).filter((s) => s.previousMajorRelation === 'UNRELATED').length;

  return (
    <GmLayout>
      {isLoading ? <Skeleton className="h-64 w-full" /> : isError || !data ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت دانشجویان جبرانی ناموفق بود.</CardContent></Card>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-3 text-xs leading-6 text-muted-foreground shadow-xs">
            برای هر دانشجوی ورودی، رشتهٔ قبلی، نسبت آن با رشتهٔ جدید، واحد جبرانی و وضعیت ممتاز را تعیین کنید.
            دروس جبرانی باید در ترم ۱ (و در صورت ضرورت ترم ۲) قرار گیرند.
          </div>
          {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

          <Card>
            <CardContent className="flex flex-wrap items-end gap-2 p-3">
              <div>
                <Label>سال ورودی</Label>
                <select value={data.year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 h-8 rounded-lg border border-input bg-transparent px-2 text-xs">
                  {data.years.length === 0 ? <option value={data.year}>{data.year}</option> : data.years.map((y) => <option key={y} value={y}>{faNumber(y)}</option>)}
                </select>
              </div>
              <div className="ms-2 flex items-end gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2 dark:border-amber-800 dark:bg-amber-950/30">
                <div className="w-24"><Label>اعمال به نامرتبط‌ها ({faNumber(unrelated)})</Label><Input type="number" min={0} value={units} onChange={(e) => setUnits(Number(e.target.value))} className="mt-1 h-7 font-mono" /></div>
                <Button size="sm" className="h-7" disabled={bulkMut.isPending || unrelated === 0} onClick={() => bulkMut.mutate()}><Users className="size-3.5" aria-hidden /> اعمال</Button>
              </div>
            </CardContent>
          </Card>

          {data.students.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دانشجویی برای این ورودی در دامنهٔ شما یافت نشد.</CardContent></Card>
          ) : (
            <div className="space-y-2">{data.students.map((s) => <StudentRow key={s.id} student={s} />)}</div>
          )}
        </>
      )}
    </GmLayout>
  );
}

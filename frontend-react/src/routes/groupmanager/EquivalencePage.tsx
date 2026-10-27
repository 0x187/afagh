import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Send } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getEquivalence, submitEquivalence, type GmEquivItem, type GmEquivRequest } from '@/lib/groupmanager-api';
import { GmLayout } from './GmLayout';

// ═══ معادل‌سازی — پورت group-manager/equivalence ═══

function RequestCard({ req, ourCourses }: { req: GmEquivRequest; ourCourses: { code: string; title: string; units: number }[] }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<GmEquivItem[]>(() =>
    req.items.length > 0
      ? req.items
      : [{ sourceTitle: req.sourceCourseTitle, sourceUnits: req.sourceUnits, sourceGrade: req.sourceGrade, targetCourseCode: '', targetCourseTitle: '', headComment: '' }],
  );
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const submitMut = useMutation({
    mutationFn: () => submitEquivalence(req.id, items, note),
    onSuccess: async () => {
      setMsg('نگاشت ذخیره و گام مدیر گروه تأیید شد.');
      await qc.invalidateQueries({ queryKey: ['gm-equivalence'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex flex-wrap items-center gap-2 text-sm font-black">
              <GitBranch className="size-4 text-teal-600" aria-hidden />
              {req.studentName}
              <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{faDigits(req.studentCode)}</span>
              <Badge variant="secondary" className="text-[10px]" dir="ltr">{req.trackingCode}</Badge>
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {req.previousUniversity || 'دانشگاه مبدأ نامشخص'} · {faDigits(req.createdAt.slice(0, 10))}
            </p>
          </div>
          <Badge variant="outline" className="text-[10px]">در انتظار بررسی مدیر گروه</Badge>
        </div>

        {req.syllabusNote ? <p className="rounded-lg bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">{req.syllabusNote}</p> : null}

        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="grid gap-1.5 rounded-xl border border-border bg-muted/20 p-2 sm:grid-cols-5">
              <div className="sm:col-span-2">
                <label className="text-[10px] font-bold text-muted-foreground">درس مبدأ</label>
                <Input value={item.sourceTitle} onChange={(e) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, sourceTitle: e.target.value } : x)))} className="mt-0.5 h-7 text-[11px]" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted-foreground">نمره</label>
                <Input type="number" min={0} max={20} step="0.25" value={item.sourceGrade ?? ''} onChange={(e) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, sourceGrade: e.target.value === '' ? null : Number(e.target.value) } : x)))} className="mt-0.5 h-7 text-center text-[11px]" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] font-bold text-muted-foreground">کد درس مقصد</label>
                <select
                  value={item.targetCourseCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    const course = ourCourses.find((c) => c.code === code);
                    setItems((prev) => prev.map((x, j) => (j === i ? { ...x, targetCourseCode: code, targetCourseTitle: course?.title ?? '' } : x)));
                  }}
                  className="mt-0.5 h-7 w-full rounded border border-input bg-transparent px-1 text-[11px]"
                >
                  <option value="">— انتخاب —</option>
                  {ourCourses.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.title} ({faNumber(c.units)} واحد)</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت تأیید (اختیاری)" className="h-7 max-w-80 text-[11px]" />
          <Button size="sm" disabled={submitMut.isPending} onClick={() => submitMut.mutate()}><Send className="size-3.5" aria-hidden /> تأیید علمی و ادامه</Button>
          <span className="text-[10px] text-muted-foreground">حداقل نمرهٔ قابل معادل‌سازی: ۱۲</span>
        </div>
        {msg ? <p className="text-[11px] text-muted-foreground">{msg}</p> : null}
      </CardContent>
    </Card>
  );
}

export function GmEquivalencePage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['gm-equivalence'], queryFn: getEquivalence, staleTime: 20_000 });

  return (
    <GmLayout>
      {isLoading ? <Skeleton className="h-64 w-full" /> : isError || !data ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت درخواست‌های معادل‌سازی ناموفق بود.</CardContent></Card>
      ) : data.requests.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">درخواست معادل‌سازی در انتظار بررسی مدیر گروه نیست.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {data.requests.map((r) => <RequestCard key={r.id} req={r} ourCourses={data.ourCourses} />)}
        </div>
      )}
    </GmLayout>
  );
}

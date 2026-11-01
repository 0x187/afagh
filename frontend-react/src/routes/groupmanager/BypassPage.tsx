import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ShieldQuestion, XCircle } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits } from '@/lib/fa';
import { decideBypass, getBypass } from '@/lib/groupmanager-api';
import { GmLayout } from './GmLayout';

// ═══ Prerequisite/conflict bypass requests — port of group-manager/bypass ═══

const REASONS = [
  { code: 'LOW_GPA_PREV_TERM', label: 'معدل ترم قبل پایین است' },
  { code: 'GROUP_COUNCIL_DISAGREE', label: 'نظر مخالف شورای گروه' },
  { code: 'UNRESOLVABLE_EXAM_CONFLICT', label: 'تداخل امتحانی غیرقابل رفع' },
  { code: 'OTHER', label: 'سایر' },
];

export function GmBypassPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['gm-bypass'], queryFn: getBypass, staleTime: 15_000 });
  const [draft, setDraft] = useState<Record<number, { code: string; text: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const decideMut = useMutation({
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) => {
      const d = draft[id] ?? { code: '', text: '' };
      return decideBypass({ requestId: id, approve, reasonCode: approve ? undefined : d.code, reasonText: approve ? undefined : d.text });
    },
    onSuccess: async () => {
      setMsg('تصمیم ثبت شد.');
      await qc.invalidateQueries({ queryKey: ['gm-bypass'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <GmLayout>
      <div className="rounded-xl border border-border bg-card p-4 text-xs leading-6 text-muted-foreground shadow-xs">
        تا تصمیم شما، صندلی درس برای دانشجو رزرو می‌ماند. با تأیید، درس به‌صورت خودکار در انتخاب واحد دانشجو ثبت می‌شود؛
        با رد، صندلی آزاد و دلیل برای دانشجو ارسال می‌شود.
      </div>
      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      {isLoading ? <Skeleton className="h-48 w-full" /> : isError || !data ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت درخواست‌ها ناموفق بود.</CardContent></Card>
      ) : data.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">درخواست بازِ بدون پیش‌نیاز/تداخلی وجود ندارد.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {data.map((r) => {
            const d = draft[r.id] ?? { code: '', text: '' };
            return (
              <Card key={r.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="flex flex-wrap items-center gap-2 text-sm font-black">
                        <ShieldQuestion className="size-4 text-amber-500" aria-hidden />
                        {r.courseTitle}
                        <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{r.courseCode}</span>
                        <Badge className="border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                          {r.kind === 'PREREQ' ? 'بدون پیش‌نیاز' : 'تداخل امتحانی'}
                        </Badge>
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {r.studentName} · <span className="font-mono" dir="ltr">{faDigits(r.studentCode)}</span>
                        {r.createdAt ? ` · ${faDigits(r.createdAt.slice(0, 10))}` : ''}
                      </p>
                      {r.reasonText ? <p className="mt-1 text-[11px] text-muted-foreground">{r.reasonText}</p> : null}
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {r.status === 'PENDING_MANAGER' ? 'در انتظار مدیر گروه' : 'ارجاع به کارشناس'}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-2">
                    <select value={d.code} onChange={(e) => setDraft((prev) => ({ ...prev, [r.id]: { ...d, code: e.target.value } }))} className="h-7 rounded border border-input bg-transparent px-1 text-[11px]">
                      <option value="">دلیل رد…</option>
                      {REASONS.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
                    </select>
                    <Input value={d.text} onChange={(e) => setDraft((prev) => ({ ...prev, [r.id]: { ...d, text: e.target.value } }))} placeholder="توضیح تکمیلی (برای «سایر» الزامی)" className="h-7 max-w-72 text-[11px]" />
                    <Button size="sm" className="h-7" disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: r.id, approve: true })}>
                      <CheckCircle2 className="size-3.5" aria-hidden /> تأیید
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-rose-600" disabled={decideMut.isPending || !d.code || (d.code === 'OTHER' && !d.text.trim())} onClick={() => decideMut.mutate({ id: r.id, approve: false })}>
                      <XCircle className="size-3.5" aria-hidden /> رد
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </GmLayout>
  );
}

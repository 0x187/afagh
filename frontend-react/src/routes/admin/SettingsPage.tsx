import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { getAdminSettings, resetAdminSetting, saveAdminSetting } from '@/lib/admin-api';

// ═══ تنظیمات سامانه — پورت admin/settings (کلیدهای ثبت‌شده در نسخهٔ جدید) ═══

function groupOf(key: string): string {
  if (key.startsWith('BBB_')) return 'کلاس مجازی';
  if (key.startsWith('CONTRACT_') || key.startsWith('HOURLY_')) return 'قرارداد و حق‌التدریس';
  if (key.startsWith('EVAL_') || key.startsWith('PERF_') || key.startsWith('BI_')) return 'ارزشیابی و عملکرد';
  if (key.startsWith('GRAD_') || key === 'SAJJAD_PORTAL_URL') return 'فارغ‌التحصیلی';
  if (key.startsWith('NOTIFY_')) return 'اعلان‌ها';
  if (key.startsWith('ENROLL')) return 'انتخاب واحد';
  if (key.startsWith('TICKET') || key.endsWith('TTL_MINUTES') || key === 'PUBLIC_BASE_URL') return 'توکن‌ها و استعلام';
  return 'عمومی';
}

export function AdminSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-settings'], queryFn: getAdminSettings, staleTime: 30_000 });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    setDrafts(Object.fromEntries(data.map((s) => [s.key, s.value])));
  }, [data]);
  const saveMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => saveAdminSetting(key, value),
    onSuccess: async () => {
      setMsg('ذخیره شد.');
      await qc.invalidateQueries({ queryKey: ['admin-settings'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const resetMut = useMutation({
    mutationFn: (key: string) => resetAdminSetting(key),
    onSuccess: async () => {
      setMsg('بازگشت به پیش‌فرض.');
      await qc.invalidateQueries({ queryKey: ['admin-settings'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>>();
    for (const s of data ?? []) {
      const g = groupOf(s.key);
      const list = map.get(g) ?? [];
      map.set(g, [...list, s]);
    }
    return [...map.entries()] as [string, NonNullable<typeof data>][];
  }, [data]);

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت تنظیمات ناموفق بود (فقط مدیر سامانه).</CardContent></Card>;

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-zinc-800 to-slate-700 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-base font-black"><SettingsIcon className="size-5" aria-hidden /> تنظیمات سامانه</h1>
          <p className="mt-0.5 text-xs text-zinc-200">کلیدهای پیکربندی‌شده در نسخهٔ Go — مقادیر در دیتابیس ذخیره و کش ۱۵ ثانیه‌ای باطل می‌شود.</p>
        </CardContent>
      </Card>
      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      {grouped.map(([group, list]) => (
        <Card key={group}>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{group}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {list.map((s) => (
              <div key={s.key} className="flex flex-wrap items-center gap-2">
                <div className="min-w-52 flex-1">
                  <p className="font-mono text-[11px] font-bold" dir="ltr">{s.key}</p>
                  <p className="text-[10px] text-muted-foreground">
                    پیش‌فرض: <span dir="ltr" className="font-mono">{s.default === '' ? '—' : s.default}</span>
                    {' · منبع: '}
                    <Badge variant="outline" className="text-[9px]">{s.source}</Badge>
                  </p>
                </div>
                <Input
                  value={drafts[s.key] ?? ''}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [s.key]: e.target.value }))}
                  className="h-8 max-w-72 font-mono text-[11px]"
                  dir="ltr"
                  placeholder={s.isSecret ? '••••••••' : ''}
                  type={s.isSecret ? 'password' : 'text'}
                />
                <Button size="sm" variant="outline" className="h-7" disabled={saveMut.isPending} onClick={() => saveMut.mutate({ key: s.key, value: drafts[s.key] ?? '' })}>
                  <Save className="size-3.5" aria-hidden /> ذخیره
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-1.5 text-rose-600" disabled={resetMut.isPending} onClick={() => resetMut.mutate(s.key)} title="بازگشت به پیش‌فرض">
                  <RotateCcw className="size-3.5" aria-hidden />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

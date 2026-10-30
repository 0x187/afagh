import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getBiDashboard, invalidateBi, refreshAllBi, refreshBiDashboards, type TrendPoint } from '@/lib/bi-api';
import { faDigits, faNumber } from '@/lib/fa';

// ═══ داشبورد هوش تجاری ارزشیابی — پورت admin/bi ═══

const scoreText = (v: number | null | undefined) => (v == null ? '—' : faDigits(String(v)));
const ageText = (s: number | null) => (s == null ? '—' : s < 60 ? `${faNumber(s)} ثانیه` : `${faNumber(Math.round(s / 60))} دقیقه`);

export function AdminBiPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-bi'], queryFn: getBiDashboard, staleTime: 30_000 });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const dashMut = useMutation({
    mutationFn: refreshBiDashboards,
    onSuccess: async (r) => { setMsg({ kind: 'ok', text: `داشبورد و امکانات بازسازی شد (${faNumber(r.staff)} استاد، ${faNumber(r.rooms)} کلاس)` }); await qc.invalidateQueries({ queryKey: ['admin-bi'] }); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });
  const allMut = useMutation({
    mutationFn: refreshAllBi,
    onSuccess: async (r) => { setMsg({ kind: 'ok', text: `بازسازی کامل انجام شد (${faNumber(r.staff)} استاد، ${faNumber(r.rooms)} کلاس، ${faNumber(r.wordClouds)} ابر واژه، ${faNumber(r.durationMs)} میلی‌ثانیه)` }); await qc.invalidateQueries({ queryKey: ['admin-bi'] }); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });
  const clearMut = useMutation({
    mutationFn: () => invalidateBi(),
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'همهٔ کش‌ها پاک شد؛ درخواست بعدی محاسبهٔ تازه می‌گیرد.' }); await qc.invalidateQueries({ queryKey: ['admin-bi'] }); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت داشبورد BI ناموفق بود.</CardContent></Card>;
  const { overview, facilities, cache } = data;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-indigo-950 via-slate-900 to-indigo-900 text-white">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-black"><BarChart3 className="size-5" aria-hidden /> هوش تجاری ارزشیابی (BI)</h1>
              <p className="mt-1 text-xs text-indigo-200">ترم {overview.term}{overview.period ? ` — دورهٔ ارزشیابی: ${overview.period}` : ' — دورهٔ فعالی ثبت نشده است'}</p>
              <p className="mt-1 text-[10px] text-indigo-300/80">آستانهٔ بحرانی: {scoreText(overview.threshold)} · آستانهٔ تعمیرات: {scoreText(facilities.repairThreshold)}{overview.cachedAt ? ` · آخرین محاسبه: ${ageText(overview.cacheAgeSeconds)} پیش` : ''}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="bg-indigo-700 text-white hover:bg-indigo-600" disabled={dashMut.isPending} onClick={() => dashMut.mutate()}><RefreshCw className="size-4" aria-hidden /> محاسبهٔ دوبارهٔ داشبوردها</Button>
              <Button size="sm" variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20" disabled={allMut.isPending} onClick={() => allMut.mutate()}><RefreshCw className="size-4" aria-hidden /> بازسازی کامل (job)</Button>
              <Button size="sm" variant="destructive" disabled={clearMut.isPending} onClick={() => clearMut.mutate()}><Trash2 className="size-4" aria-hidden /> پاک کردن کش</Button>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="میانگین نمرهٔ اساتید" value={scoreText(overview.avgScore)} tone="text-emerald-300" />
            <Stat label="استاد علامت‌خورده" value={faNumber(overview.flaggedCount)} tone={overview.flaggedCount ? 'text-rose-300' : 'text-emerald-300'} />
            <Stat label="پاسخ‌های ثبت‌شده" value={faNumber(overview.totalRespondents)} tone="text-indigo-200" />
            <Stat label="کلاس ارزیابی‌شده" value={faNumber(facilities.rooms.length)} tone="text-indigo-200" />
            <Stat label="کلاس نیازمند تعمیر" value={faNumber(facilities.needsRepairCount)} tone={facilities.needsRepairCount ? 'text-amber-300' : 'text-emerald-300'} />
          </div>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>{msg.text}</div>
      ) : null}

      <Card>
        <CardContent className="space-y-2 pt-4">
          <h2 className="text-sm font-black">کیفیت تدریس اساتید (بدترین رکورد اول)</h2>
          {overview.list.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">پاسخ ارزشیابی‌ای برای این ترم ثبت نشده است.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-[11px]">
                <thead className="bg-muted/60 text-muted-foreground"><tr>{['استاد', 'رتبه / گروه', 'نمرهٔ جاری', 'روند', 'تغییر', 'پاسخ‌دهنده', 'کلاس', 'وضعیت'].map((h) => <th key={h} className="whitespace-nowrap p-2 text-right font-black">{h}</th>)}</tr></thead>
                <tbody>
                  {overview.list.map((s) => (
                    <tr key={s.staffId} className="border-t border-border/50 hover:bg-muted/30">
                      <td className="p-2 font-bold">{s.name}</td>
                      <td className="p-2 text-muted-foreground">{s.rank || '—'} / {s.department || '—'}</td>
                      <td className={`p-2 font-black ${s.flagged ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{scoreText(s.score)}</td>
                      <td className="p-2"><Sparkline points={s.trend} threshold={overview.threshold} /></td>
                      <td className="p-2">{s.delta == null ? <span className="text-muted-foreground">—</span> : <span className={s.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{s.delta >= 0 ? '▲' : '▼'} {scoreText(Math.abs(s.delta))}</span>}</td>
                      <td className="p-2 font-mono">{faNumber(s.respondents)}</td>
                      <td className="p-2 font-mono">{faNumber(s.offerings)}</td>
                      <td className="p-2">{s.flagged ? <Badge variant="destructive" className="text-[9px]">نیازمند بررسی</Badge> : <Badge variant="success" className="text-[9px]">عادی</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <h2 className="text-sm font-black">تحلیل امکانات کلاس‌ها</h2>
          {facilities.rooms.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">ارزشیابی امکاناتی ثبت نشده است.</p> : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {facilities.rooms.map((r) => (
                <div key={r.roomId} className={`rounded-xl border p-3 ${r.needsRepair ? 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20' : 'border-border bg-muted/20'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div><div className="text-xs font-black">{r.room}</div><div className="text-[10px] text-muted-foreground">{r.building || '—'} · {r.type || '—'}</div></div>
                    {r.needsRepair ? <Badge variant="warning" className="text-[9px]">نیازمند تعمیر</Badge> : null}
                  </div>
                  <div className="mt-2 space-y-1">
                    {r.axes.map((a) => (
                      <div key={a.label} className="flex items-center gap-2 text-[10px]">
                        <span className="w-24 shrink-0 text-muted-foreground">{a.label}</span>
                        <div className="h-1.5 flex-1 rounded-full bg-muted"><div className={`h-1.5 rounded-full ${a.score < facilities.repairThreshold ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${Math.max(4, Math.min(100, (a.score / 5) * 100))}%` }} /></div>
                        <span className="w-6 text-left font-mono">{scoreText(a.score)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">ضعیف‌ترین شاخص: {r.worstAxis} ({scoreText(r.worstScore)}) · {faNumber(r.responses)} پاسخ · دروس: {r.courses.join('، ') || '—'}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <h2 className="text-sm font-black">کش گزارش‌ها</h2>
          <p className="text-[11px] text-muted-foreground">داشبورد از این کش می‌خواند تا محاسبهٔ سنگین در زمان درخواست کاربر اجرا نشود. کرون <code className="rounded bg-muted px-1">bi-refresh</code> آن را شبانه تازه می‌کند.</p>
          {cache.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">هنوز گزارشی کش نشده است.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-[11px]">
                <thead className="bg-muted/60 text-muted-foreground"><tr>{['کلید', 'نوع', 'ردیف', 'زمان محاسبه', 'عمر', 'وضعیت'].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
                <tbody>
                  {cache.map((c) => (
                    <tr key={c.key} className="border-t border-border/50">
                      <td className="p-2 font-mono text-[10px]" dir="ltr">{c.key}</td>
                      <td className="p-2 text-muted-foreground">{c.type}</td>
                      <td className="p-2 font-mono">{c.rows == null ? '—' : faNumber(c.rows)}</td>
                      <td className="p-2 font-mono">{c.durationMs == null ? '—' : `${faNumber(c.durationMs)} ms`}</td>
                      <td className="p-2">{ageText(c.ageSeconds)}</td>
                      <td className="p-2">{c.fresh ? <Badge variant="success" className="text-[9px]">تازه</Badge> : <Badge variant="warning" className="text-[9px]">منقضی</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-[10px] text-indigo-200/80">{label}</div>
      <div className={`mt-1 text-xl font-black ${tone}`}>{value}</div>
    </div>
  );
}

function Sparkline({ points, threshold }: { points: TrendPoint[]; threshold: number }) {
  const valid = points.filter((p): p is TrendPoint & { score: number } => p.score != null);
  if (valid.length === 0) return <span className="text-muted-foreground">—</span>;
  const w = 96, h = 26, pad = 3;
  const vals = valid.map((p) => p.score);
  const min = Math.min(...vals, threshold) - 0.25;
  const max = Math.max(...vals, threshold) + 0.25;
  const x = (i: number) => (valid.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (valid.length - 1));
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  const d = valid.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const last = valid[valid.length - 1];
  return (
    <svg width={w} height={h} className="inline-block" role="img" aria-label={valid.map((p) => `${p.term} — ${p.period}: ${p.score}`).join(' / ')}>
      <title>{valid.map((p) => `${p.term} — ${p.period}: ${p.score}`).join('\n')}</title>
      <line x1={0} y1={y(threshold)} x2={w} y2={y(threshold)} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3,3" />
      <path d={d} fill="none" stroke="#6366f1" strokeWidth={2} />
      <circle cx={x(valid.length - 1)} cy={y(last.score)} r={2.6} fill={last.score < threshold ? '#f43f5e' : '#10b981'} />
    </svg>
  );
}

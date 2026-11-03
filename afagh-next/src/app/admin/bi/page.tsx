import { requireRole } from '@/lib/auth';
import { cacheStatus, facilitiesReport, managementOverview } from '@/lib/bi-engine';
import { getCurrentUniversity } from '@/lib/university-scope';
import BiRefreshButtons from './BiRefreshButtons';

export const dynamic = 'force-dynamic';

/** نمودار خطی کوچک روند — SVG درون‌خطی، بدون وابستگی جدید به کتابخانهٔ نمودار */
function Sparkline({ points, threshold }: { points: { period: string; term: string; score: number }[]; threshold: number }) {
  if (!points.length) return <span className="text-slate-500">—</span>;
  const w = 96, h = 26, pad = 3;
  const vals = points.map(p => p.score);
  const min = Math.min(...vals, threshold) - 0.25;
  const max = Math.max(...vals, threshold) + 0.25;
  const x = (i: number) => (points.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (points.length - 1));
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg width={w} height={h} className="inline-block" role="img" aria-label={points.map(p => `${p.term} — ${p.period}: ${p.score}`).join(' / ')}>
      <title>{points.map(p => `${p.term} — ${p.period}: ${p.score}`).join('\n')}</title>
      <line x1={0} y1={y(threshold)} x2={w} y2={y(threshold)} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3,3" />
      <path d={d} fill="none" stroke="#6366f1" strokeWidth={2} />
      <circle cx={x(points.length - 1)} cy={y(last.score)} r={2.6} fill={last.score < threshold ? '#f43f5e' : '#10b981'} />
    </svg>
  );
}

const fmtAge = (s: number | null) => (s == null ? '—' : s < 60 ? `${s} ثانیه` : `${Math.round(s / 60)} دقیقه`);

/**
 * داشبورد هوش تجاری ارزشیابی.
 * همهٔ اعداد از موتور `bi-engine` می‌آیند (کوئری‌های تجمیعی روی PostgreSQL و
 * کش در `analytics_snapshots`)؛ هیچ دادهٔ نمونه‌ای در این صفحه نیست.
 */
export default async function AdminBiPage() {
  await requireRole(['ADMIN']);

  const currentUniversity = await getCurrentUniversity();
  const currentUniversityId = currentUniversity?.id ?? null;
  /* TODO: filter by universityId */

  const [overview, facilities, cache] = await Promise.all([managementOverview(), facilitiesReport(), cacheStatus()]);

  return (
    <div className="space-y-5 p-4" dir="rtl">
      {/* سربرگ */}
      <div className="rounded-3xl border border-indigo-700/50 bg-gradient-to-l from-indigo-950 via-slate-900 to-indigo-900 p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-extrabold">📊 هوش تجاری ارزشیابی (BI)</h1>
            <p className="mt-1 text-sm text-indigo-200">
              ترم {overview.term}
              {overview.period ? ` — دورهٔ ارزشیابی: ${overview.period}` : ' — دورهٔ فعالی ثبت نشده است'}
            </p>
            <p className="mt-1 text-xs text-indigo-300/80">
              آستانهٔ بحرانی: {overview.threshold} · آستانهٔ تعمیرات: {facilities.repairThreshold}
              {overview.cachedAt ? ` · آخرین محاسبه: ${fmtAge(overview.cacheAgeSeconds)} پیش` : ''}
            </p>
          </div>
          <BiRefreshButtons />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: 'میانگین نمرهٔ اساتید', value: overview.avgScore ?? '—', tone: 'text-emerald-300' },
            { label: 'استاد علامت‌خورده', value: overview.flaggedCount, tone: overview.flaggedCount ? 'text-rose-300' : 'text-emerald-300' },
            { label: 'پاسخ‌های ثبت‌شده', value: overview.totalRespondents, tone: 'text-indigo-200' },
            { label: 'کلاس ارزیابی‌شده', value: facilities.rooms.length, tone: 'text-indigo-200' },
            { label: 'کلاس نیازمند تعمیر', value: facilities.needsRepairCount, tone: facilities.needsRepairCount ? 'text-amber-300' : 'text-emerald-300' },
          ].map(c => (
            <div key={c.label} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-2xs text-indigo-200/80">{c.label}</div>
              <div className={`mt-1 text-2xl font-extrabold ${c.tone}`}>{c.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* اساتید — بدترین رکورد اول */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
        <h2 className="mb-3 font-bold text-white">🎯 کیفیت تدریس اساتید (بدترین رکورد اول)</h2>
        {overview.list.length === 0 ? (
          <p className="text-sm text-slate-400">پاسخ ارزشیابی‌ای برای این ترم ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm rt">
              <thead className="text-xs text-slate-400">
                <tr className="border-b border-slate-700">
                  <th className="p-2">استاد</th>
                  <th className="p-2">رتبه / گروه</th>
                  <th className="p-2">نمرهٔ جاری</th>
                  <th className="p-2">روند</th>
                  <th className="p-2">تغییر</th>
                  <th className="p-2">پاسخ‌دهنده</th>
                  <th className="p-2">کلاس</th>
                  <th className="p-2">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {overview.list.map(s => (
                  <tr key={s.staffId} className="border-b border-slate-800 hover:bg-slate-800/40">
                    <td className="p-2 font-bold text-slate-100">{s.name}</td>
                    <td className="p-2 text-slate-400">{s.rank || '—'} / {s.department || '—'}</td>
                    <td className={`p-2 font-extrabold ${s.flagged ? 'text-rose-400' : 'text-emerald-400'}`}>{s.score}</td>
                    <td className="p-2"><Sparkline points={s.trend} threshold={overview.threshold} /></td>
                    <td className="p-2">
                      {s.delta == null ? <span className="text-slate-500">—</span> : (
                        <span className={s.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {s.delta >= 0 ? '▲' : '▼'} {Math.abs(s.delta)}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-slate-300">{s.respondents}</td>
                    <td className="p-2 text-slate-300">{s.offerings}</td>
                    <td className="p-2">
                      {s.flagged
                        ? <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-300">⚠ نیازمند بررسی</span>
                        : <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">عادی</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* امکانات کلاس‌ها */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
        <h2 className="mb-3 font-bold text-white">🏫 تحلیل امکانات کلاس‌ها</h2>
        {facilities.rooms.length === 0 ? (
          <p className="text-sm text-slate-400">ارزشیابی امکاناتی ثبت نشده است.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {facilities.rooms.map(r => (
              <div key={r.roomId} className={`rounded-2xl border p-3 ${r.needsRepair ? 'border-amber-500/40 bg-amber-950/20' : 'border-slate-700 bg-slate-800/30'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-100">{r.room}</div>
                    <div className="text-xs text-slate-400">{r.building || '—'} · {r.type || '—'}</div>
                  </div>
                  {r.needsRepair && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-2xs font-bold text-amber-300">🔧 نیازمند تعمیر</span>}
                </div>
                <div className="mt-2 space-y-1">
                  {r.axes.map(a => (
                    <div key={a.label} className="flex items-center gap-2 text-xs">
                      <span className="w-28 shrink-0 text-slate-400">{a.label}</span>
                      <div className="h-2 flex-1 rounded-full bg-slate-700/60">
                        <div
                          className={`h-2 rounded-full ${a.score < facilities.repairThreshold ? 'bg-amber-400' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.max(4, Math.min(100, (a.score / 5) * 100))}%` }}
                        />
                      </div>
                      <span className="w-8 text-left text-slate-300">{a.score}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-2xs text-slate-500">
                  ضعیف‌ترین شاخص: {r.worstAxis} ({r.worstScore}) · {r.responses} پاسخ · دروس: {r.courses.join('، ') || '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* وضعیت کش */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
        <h2 className="mb-2 font-bold text-white">🗃️ کش گزارش‌ها</h2>
        <p className="mb-3 text-xs text-slate-400">
          داشبورد از این کش می‌خواند تا محاسبهٔ سنگین در زمان درخواست کاربر اجرا نشود. job زمان‌بندی‌شدهٔ
          <code className="mx-1 rounded bg-slate-800 px-1">/api/cron/bi-refresh</code> آن را شبانه تازه می‌کند.
        </p>
        {cache.length === 0 ? (
          <p className="text-sm text-slate-400">هنوز گزارشی کش نشده است.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs rt">
              <thead className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <th className="p-1.5">کلید</th><th className="p-1.5">نوع</th><th className="p-1.5">ردیف</th>
                  <th className="p-1.5">زمان محاسبه</th><th className="p-1.5">عمر</th><th className="p-1.5">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {cache.map(c => (
                  <tr key={c.key} className="border-b border-slate-800">
                    <td className="p-1.5 font-mono text-slate-300">{c.key}</td>
                    <td className="p-1.5 text-slate-400">{c.type}</td>
                    <td className="p-1.5 text-slate-400">{c.rows ?? '—'}</td>
                    <td className="p-1.5 text-slate-400">{c.durationMs} ms</td>
                    <td className="p-1.5 text-slate-400">{fmtAge(c.ageSeconds)}</td>
                    <td className="p-1.5">{c.fresh ? <span className="text-emerald-400">تازه</span> : <span className="text-amber-400">منقضی</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

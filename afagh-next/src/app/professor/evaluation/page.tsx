import { getStaffByUser, requireRole } from '@/lib/auth';
import { professorPanel } from '@/lib/bi-engine';
import { currentTermFor } from '@/lib/terms';

export const dynamic = 'force-dynamic';

/** نمودار راداری شاخص‌ها — SVG درون‌خطی (مقایسهٔ «من» با میانگین گروه آموزشی) */
function Radar({ axes }: { axes: { label: string; mine: number | null; dept: number | null }[] }) {
  if (axes.length < 3) return <p className="text-sm text-slate-400">برای رسم رادار حداقل سه شاخص لازم است.</p>;
  const size = 300, cx = size / 2, cy = size / 2, R = size / 2 - 56;
  const max = 5;
  const pt = (i: number, v: number) => {
    const ang = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    const r = (Math.max(0, Math.min(max, v)) / max) * R;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)] as const;
  };
  const poly = (key: 'mine' | 'dept') =>
    axes.map((a, i) => pt(i, a[key] ?? 0).map(n => n.toFixed(1)).join(',')).join(' ');

  return (
    <svg width={size} height={size} className="mx-auto">
      {[0.25, 0.5, 0.75, 1].map(k => (
        <polygon
          key={k}
          points={axes.map((_, i) => pt(i, max * k).map(n => n.toFixed(1)).join(',')).join(' ')}
          fill="none" stroke="#334155" strokeWidth={1}
        />
      ))}
      {axes.map((a, i) => {
        const [x, y] = pt(i, max);
        const [lx, ly] = pt(i, max * 1.22);
        return (
          <g key={a.label}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="#334155" strokeWidth={1} />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="#94a3b8">{a.label}</text>
          </g>
        );
      })}
      <polygon points={poly('dept')} fill="rgba(148,163,184,0.15)" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4,3" />
      <polygon points={poly('mine')} fill="rgba(99,102,241,0.28)" stroke="#6366f1" strokeWidth={2} />
      {axes.map((a, i) => {
        const [x, y] = pt(i, a.mine ?? 0);
        return <circle key={a.label} cx={x} cy={y} r={3} fill="#818cf8" />;
      })}
    </svg>
  );
}

/** پنل ارزشیابی استاد — دادهٔ زنده از موتور BI */
export default async function ProfessorEvaluationPage() {
  const user = await requireRole(['PROFESSOR']);
  const me = await getStaffByUser(user.id);
  if (!me) {
    return <div className="p-6 text-rose-300" dir="rtl">پروندهٔ پرسنلی شما یافت نشد؛ با اداره کارگزینی تماس بگیرید.</div>;
  }

  const universityId = me.universityId ?? user.universityId ?? null;
  const myTerm = await currentTermFor(universityId);
  if (!myTerm) {
    return (
      <div className="p-6 text-center space-y-2" dir="rtl">
        <p className="text-rose-300 font-bold">نیمسال تحصیلی جاری برای دانشگاه شما تعیین نشده است.</p>
        <p className="text-xs text-slate-400">کارنامهٔ ارزشیابی پس از تعیین نیمسال جاری در دسترس قرار می‌گیرد.</p>
      </div>
    );
  }

  let panel;
  try {
    panel = await professorPanel(me.id);
  } catch (err) {
    return <div className="p-6 text-rose-300" dir="rtl">{(err as Error).message}</div>;
  }

  const crossUniversity = panel.term !== myTerm.title;
  const hasAnyData = panel.axes.length > 0 || panel.trend.length > 0 || panel.words.length > 0 || panel.respondents > 0;

  const maxWord = panel.words.reduce((m, w) => Math.max(m, w.c), 1);

  return (
    <div className="space-y-5 p-4" dir="rtl">
      {crossUniversity && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
          ⚠ موتار ارزشیابی برای این صفحه ترم «{panel.term}» را نگه داشته است، در حالی که نیمسال جاری دانشگاه شما
          «{myTerm.title}» است. پس از همگام‌سازی ترم موتور، داده‌های نیمسال جاری نمایش داده می‌شود.
        </div>
      )}

      {!hasAnyData && (
        <div className="card p-10 text-center space-y-2">
          <div className="text-4xl">📈</div>
          <h2 className="text-lg font-bold">هنوز داده‌ای ثبت نشده است</h2>
          <p className="text-sm text-gray-500 leading-7">
            تا این لحظه هیچ پرسش‌نامهٔ ارزشیابی تدریس برای شما اجرا نشده و هیچ پاسخی از دانشجویان ثبت نشده است.
            پس از اجرای دورهٔ ارزشیابی توسط اداره آموزش، نمره و شاخص‌ها همین‌جا نمایش داده می‌شود.
          </p>
        </div>
      )}

      <div className="rounded-3xl border border-indigo-700/50 bg-gradient-to-l from-indigo-950 via-slate-900 to-indigo-900 p-6 text-white shadow-xl">
        <h1 className="text-xl font-extrabold">📈 کارنامهٔ ارزشیابی من</h1>
        <p className="mt-1 text-sm text-indigo-200">
          {panel.name}{panel.rank ? ` — ${panel.rank}` : ''}{panel.department ? ` · ${panel.department}` : ''} · ترم {panel.term}
          {panel.period ? ` · دوره: ${panel.period}` : ''}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'نمرهٔ من', value: panel.score ?? '—', tone: panel.flagged ? 'text-rose-300' : 'text-emerald-300' },
            { label: 'میانگین گروه', value: panel.deptAvg ?? '—', tone: 'text-slate-200' },
            { label: 'پاسخ‌دهنده', value: panel.respondents, tone: 'text-indigo-200' },
            { label: 'آستانهٔ بحرانی', value: panel.threshold, tone: 'text-amber-300' },
          ].map(c => (
            <div key={c.label} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-2xs text-indigo-200/80">{c.label}</div>
              <div className={`mt-1 text-2xl font-extrabold ${c.tone}`}>{c.value}</div>
            </div>
          ))}
        </div>
        {panel.flagged && (
          <p className="mt-3 rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
            ⚠ نمرهٔ شما زیر آستانهٔ {panel.threshold} است؛ کارگروه کیفیت تدریس برای دورهٔ بعد برنامهٔ پشتیبانی تعیین می‌کند.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
          <h2 className="mb-2 font-bold text-white">🎯 شاخص‌های تدریس (من در برابر گروه آموزشی)</h2>
          <Radar axes={panel.axes} />
          <div className="mt-2 space-y-1 text-xs">
            {panel.axes.map(a => (
              <div key={a.label} className="flex justify-between border-b border-slate-800 py-1">
                <span className="text-slate-300">{a.label}</span>
                <span className="text-slate-400">
                  من <b className="text-indigo-300">{a.mine ?? '—'}</b> · گروه <b className="text-slate-300">{a.dept ?? '—'}</b> · {a.responses} پاسخ
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <h2 className="mb-3 font-bold text-white">📉 روند دوره‌ای</h2>
            {panel.trend.length === 0 ? (
              <p className="text-sm text-slate-400">هنوز داده‌ای ثبت نشده است — سابقهٔ ارزشیابی برای شما وجود ندارد.</p>
            ) : (
              <div className="space-y-2">
                {panel.trend.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="w-32 shrink-0 text-slate-400">{t.term} — {t.period}</span>
                    <div className="h-3 flex-1 rounded-full bg-slate-700/50">
                      <div
                        className={`h-3 rounded-full ${t.score < panel.threshold ? 'bg-rose-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.max(4, Math.min(100, (t.score / 5) * 100))}%` }}
                      />
                    </div>
                    <span className="w-10 text-left font-bold text-slate-100">{t.score}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <h2 className="mb-2 font-bold text-white">💬 ابر کلمات نظرات دانشجویان</h2>
            <p className="mb-3 text-2xs text-slate-500">
              واژه‌ها داخل خود PostgreSQL استخراج می‌شوند (بدون نام دانشجو) و نتیجه کش می‌شود.
            </p>
            {panel.words.length === 0 ? (
              <p className="text-sm text-slate-400">هنوز داده‌ای ثبت نشده است — نظر تشریحی‌ای از دانشجویان ثبت نشده است.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {panel.words.map(w => (
                  <span
                    key={w.w}
                    title={`${w.c} بار`}
                    className="rounded-full bg-indigo-500/10 px-2 py-1 text-indigo-200"
                    style={{ fontSize: `${Math.max(11, Math.round(11 + (w.c / maxWord) * 13))}px` }}
                  >
                    {w.w}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

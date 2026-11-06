import { getStaffByUser, requireRole } from '@/lib/auth';
import { getProfessorPerformance } from '@/lib/professor-performance';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const fa = (n: number | null) => (n == null ? '—' : n.toLocaleString('fa-IR'));

/** نوار مقایسهٔ «من» با «میانگین همکاران» — هر دو عدد از پایگاه داده می‌آیند */
function CompareBar({ label, mine, peers, unit, max }: { label: string; mine: number | null; peers: number | null; unit: string; max: number }) {
  const w = (v: number | null) => `${Math.max(2, Math.min(100, ((v ?? 0) / max) * 100))}%`;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-bold text-indigo-700">{fa(mine)}{unit} (شما) · {fa(peers)}{unit} (میانگین همکاران)</span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-3 rounded-full bg-indigo-600" style={{ width: w(mine) }} />
        {peers != null && (
          <div className="absolute top-0 h-3 w-0.5 bg-slate-700" style={{ insetInlineStart: w(peers) }} title={`میانگین همکاران: ${peers}${unit}`} />
        )}
      </div>
    </div>
  );
}

function Kpi({ icon, value, title, sub, tone = 'text-indigo-950' }: { icon: string; value: string; title: string; sub?: string; tone?: string }) {
  return (
    <div className="card space-y-1 rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
      <span className="text-2xl">{icon}</span>
      <p className={`font-mono text-2xl font-black ${tone}`}>{value}</p>
      <p className="text-xs font-bold text-slate-700">{title}</p>
      {sub && <p className="text-2xs text-slate-500">{sub}</p>}
    </div>
  );
}

/**
 * کارنامهٔ عملکرد استاد — کاملاً زنده.
 * همهٔ اعداد از `getProfessorPerformance` (کوئری‌های تجمیعی روی PostgreSQL و
 * کش گزارش BI) می‌آیند؛ مقایسه‌ها با «میانگین واقعی همکاران» در همان ترم است،
 * نه با عدد ثابت.
 */
export default async function ProfessorPerformancePage() {
  const user = await requireRole(['PROFESSOR']);
  const me = await getStaffByUser(user.id);
  if (!me) {
    return <div className="p-6 text-rose-400" dir="rtl">پروندهٔ پرسنلی شما یافت نشد؛ با اداره کارگزینی تماس بگیرید.</div>;
  }

  let perf;
  try {
    perf = await getProfessorPerformance(me.id);
  } catch (err) {
    return <div className="p-6 text-rose-400" dir="rtl">{(err as Error).message}</div>;
  }

  const badgeTone = {
    DIAMOND: 'bg-cyan-300 text-slate-950',
    GOLD: 'bg-amber-400 text-slate-950',
    SILVER: 'bg-slate-300 text-slate-900',
    BRONZE: 'bg-orange-300 text-slate-950',
  }[perf.badge.level];

  return (
    <div className="space-y-6 p-4" dir="rtl">
      {/* سربرگ */}
      <div className="flex flex-col items-start justify-between gap-6 rounded-3xl border border-indigo-700/50 bg-gradient-to-l from-indigo-950 via-slate-900 to-indigo-900 p-6 text-white shadow-xl sm:flex-row sm:items-center sm:p-8">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">کارنامهٔ عملکرد و شفافیت تدریس</span>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${badgeTone}`}>{perf.badge.title}</span>
          </div>
          <h1 className="mt-1 text-xl font-black sm:text-2xl">{perf.fullName}</h1>
          <p className="text-xs text-indigo-200">
            کد پرسنلی: <b className="font-mono text-white">{perf.staffCode}</b>
            {perf.academicRank ? ` · مرتبهٔ علمی: ${perf.academicRank}` : ''}
            {perf.departmentName ? ` · ${perf.departmentName}` : ''}
          </p>
          <p className="text-xs text-indigo-300">ترم {perf.term}{perf.period ? ` · دورهٔ ارزشیابی: ${perf.period}` : ''}</p>
        </div>

        <div className="space-y-1 rounded-2xl border border-white/20 bg-white/10 p-4 text-left backdrop-blur-md">
          <span className="block text-2xs text-indigo-200">رتبهٔ ارزشیابی در میان اساتید دارای کلاس:</span>
          <p className="text-2xl font-black text-amber-300">
            {perf.peers.evalRank ? `مقام ${fa(perf.peers.evalRank)} از ${fa(perf.peers.count)}` : 'هنوز ارزشیابی نشده‌اید'}
          </p>
          <p className="text-3xs text-emerald-300">
            {perf.peers.responseRank
              ? `سرعت پاسخگویی به پرونده‌ها: مقام ${fa(perf.peers.responseRank)} از ${fa(perf.peers.responders)}`
              : 'پروندهٔ مختومه‌ای برای سنجش سرعت پاسخگویی ندارید'}
          </p>
        </div>
      </div>

      {/* KPIها */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi
          icon="⚡" value={fa(perf.desk.mttrHours) + ' ساعت'} title="میانگین زمان رسیدگی (MTTR)"
          sub={perf.peers.avgMttrHours != null ? `میانگین همکاران: ${fa(perf.peers.avgMttrHours)} ساعت` : 'دادهٔ مقایسه‌ای نداریم'}
        />
        <Kpi
          icon="⏱️" value={`${fa(perf.desk.slaOnTimePercent)}٪`} title="پایبندی به ضرب‌الاجل (SLA)"
          sub={perf.desk.slaBreached > 0 ? `${fa(perf.desk.slaBreached)} مورد نقض/ارجاع` : 'بدون نقض مهلت'}
          tone={perf.desk.slaOnTimePercent != null && perf.desk.slaOnTimePercent >= perf.desk.slaTarget ? 'text-emerald-700' : 'text-rose-700'}
        />
        <Kpi
          icon="📦" value={`${fa(perf.desk.resolvedThisMonth)} پرونده`} title="مختومه‌شدهٔ این ماه"
          sub={perf.desk.growthPercent != null
            ? `${perf.desk.growthPercent >= 0 ? '↑' : '↓'} ${fa(Math.abs(perf.desk.growthPercent))}٪ نسبت به ماه قبل (${fa(perf.desk.resolvedPrevMonth)})`
            : `ماه قبل: ${fa(perf.desk.resolvedPrevMonth)}`}
        />
        <Kpi
          icon="⭐" value={`★ ${fa(perf.desk.csat)}`} title="رضایت ارباب رجوع (CSAT)"
          sub={perf.desk.reviews > 0 ? `بر پایهٔ ${fa(perf.desk.reviews)} نظر ثبت‌شده` : 'نظری ثبت نشده است'}
          tone="text-amber-500"
        />
      </div>

      {/* تدریس، جلسات، نمرات */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="card space-y-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-black text-slate-900">📚 بار تدریس ترم</h2>
          <div className="flex justify-between text-xs text-slate-600"><span>کلاس ارائه‌شده</span><b className="font-mono">{fa(perf.teaching.offerings)}</b></div>
          <div className="flex justify-between text-xs text-slate-600"><span>دانشجو</span><b className="font-mono">{fa(perf.teaching.students)}</b></div>
          <div className="flex justify-between text-xs text-slate-600"><span>کدها</span><b className="font-mono text-left">{perf.teaching.courses.join('، ') || '—'}</b></div>
        </div>

        <div className="card space-y-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-black text-slate-900">🗓️ جلسات کلاس</h2>
          <div className="flex justify-between text-xs text-slate-600"><span>برگزارشده</span><b className="font-mono text-emerald-700">{fa(perf.sessions.held)}</b></div>
          <div className="flex justify-between text-xs text-slate-600"><span>برگزارنشده</span><b className="font-mono text-rose-600">{fa(perf.sessions.absent)}</b></div>
          <div className="flex justify-between text-xs text-slate-600"><span>جبرانی</span><b className="font-mono">{fa(perf.sessions.makeUp)}</b></div>
          <div className="flex justify-between text-xs text-slate-600">
            <span>نرخ برگزاری</span>
            <b className={`font-mono ${perf.sessions.heldRate != null && perf.sessions.heldRate >= perf.sessions.holdTarget ? 'text-emerald-700' : 'text-amber-600'}`}>
              {fa(perf.sessions.heldRate)}٪ / هدف {fa(perf.sessions.holdTarget)}٪
            </b>
          </div>
        </div>

        <div className="card space-y-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-black text-slate-900">📝 وضعیت نمرات</h2>
          <div className="flex justify-between text-xs text-slate-600"><span>ثبت‌شده</span><b className="font-mono text-emerald-700">{fa(perf.grades.entered)}</b></div>
          <div className="flex justify-between text-xs text-slate-600"><span>در انتظار</span><b className="font-mono text-rose-600">{fa(perf.grades.pending)}</b></div>
          <div className="flex justify-between text-xs text-slate-600"><span>اعتراض باز</span><b className="font-mono">{fa(perf.grades.appealsOpen)}</b></div>
          <div className="flex justify-between text-xs text-slate-600"><span>مهلت ثبت</span><b className="font-mono">{perf.grades.deadline ?? '—'}</b></div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div className={`h-2 rounded-full ${perf.grades.pending === 0 && perf.grades.total > 0 ? 'bg-emerald-600' : 'bg-amber-500'}`}
              style={{ width: `${Math.max(2, perf.grades.completionPercent ?? 0)}%` }} />
          </div>
        </div>
      </div>

      {/* مقایسه با همکاران + ارزشیابی */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="card space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-black text-slate-900">📈 مقایسهٔ شما با میانگین همکاران (ترم جاری)</h2>
          <div className="space-y-3">
            <CompareBar label="پایبندی به ضرب‌الاجل (SLA)" mine={perf.desk.slaOnTimePercent} peers={perf.peers.avgSlaOnTimePercent} unit="٪" max={100} />
            <CompareBar label="نمرهٔ ارزشیابی دانشجویان" mine={perf.evaluation.score} peers={perf.peers.avgEvalScore} unit="" max={5} />
            <CompareBar label="نرخ برگزاری جلسات" mine={perf.sessions.heldRate} peers={perf.sessions.holdTarget} unit="٪" max={100} />
          </div>
          <p className="text-2xs leading-relaxed text-slate-500">
            خط عمودی تیره روی هر نوار، میانگین واقعی {fa(perf.peers.count)} استاد دارای کلاس در همین ترم است.
            {perf.evaluation.respondents > 0 ? ` نمرهٔ ارزشیابی شما از ${fa(perf.evaluation.respondents)} پاسخ دانشجویی محاسبه شده است.` : ''}
          </p>
          <Link prefetch={false} href="/professor/evaluation" className="inline-block rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
            📈 کارنامهٔ تفصیلی ارزشیابی
          </Link>
        </div>

        {/* پاداش بهره‌وری */}
        <div className="card space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-white shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-black text-amber-400">🏆 مشوق بهره‌وری آموزشی</h2>
          <p className="text-xs leading-relaxed text-slate-300">
            طبق تنظیمات سامانه، اساتیدی که هم‌زمان پایبندی SLA بالای {fa(perf.desk.slaTarget)}٪، نمرهٔ ارزشیابی
            بالای {fa(perf.evaluation.evalTarget)}، نرخ برگزاری جلسات بالای {fa(perf.sessions.holdTarget)}٪ و
            نمرهٔ ثبت‌نشدهٔ صفر داشته باشند، مشمول {fa(perf.incentive.percent)}٪ ضریب ترجیحی در حق‌الزحمهٔ پایان‌ترم می‌شوند.
          </p>
          <ul className="space-y-1 text-xs">
            {(perf.incentive.eligible ? ['همهٔ شاخص‌ها در محدودهٔ هدف هستند'] : perf.incentive.reasons).map(r => (
              <li key={r} className={perf.incentive.eligible ? 'text-emerald-400' : 'text-amber-300'}>
                {perf.incentive.eligible ? '✓' : '•'} {r}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-slate-800 pt-2">
            <span className={`text-xs font-bold ${perf.incentive.eligible ? 'text-emerald-400' : 'text-slate-400'}`}>
              {perf.incentive.eligible ? `✓ واجد دریافت ${fa(perf.incentive.percent)}٪ ضریب ترجیحی` : '✗ فعلاً واجد شرایط نیستید'}
            </span>
            <Link prefetch={false} href="/professor/contract" className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-extrabold text-white shadow hover:bg-indigo-700">
              💼 قرارداد و امور پرسنلی
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

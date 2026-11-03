import Link from 'next/link';
import { and, count, eq } from 'drizzle-orm';
import { isDemoProfessorUser } from '@/lib/demo-accounts';
import {
  DEMO_DASHBOARD_CLASSES,
  DEMO_DASHBOARD_CONTRACT,
  DEMO_DASHBOARD_SUMMARY,
  DEMO_LIVE_SESSIONS,
  DEMO_TERM_TITLE,
} from '@/lib/demo-professor-data';
import { DEMO_RECORDINGS } from '@/lib/demo-student-data';
import { db } from '@/db';
import {
  electronic_documents,
  professor_availabilities,
  professor_term_contracts, payroll_statements,
  universities,
} from '@/db/schema';
import { getSetting } from '@/lib/settings';
import { getStaffByUser, requireRole } from '@/lib/auth';
import VirtualClassroomWidget from '@/components/VirtualClassroomWidget';
import MessengerOnboardBanner from '@/components/MessengerOnboardBanner';
import PanelHero from '@/components/PanelHero';
import { getTodayLiveClasses, hasVirtualClassroomSetup } from '@/lib/moodle-bbb';
import { professorTermFilter } from '@/lib/professor-term-filter';
import {
  getProfessorMergedClasses,
  mergedDisplayTitle,
  type ProfessorScheduleRow,
} from '@/lib/professor-data';
import ProfessorWeekTable from './week-table';

export const dynamic = 'force-dynamic';

const faNum = (n: any) => (n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

const faDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('fa-IR') : null;

export default async function ProfessorHome() {
  const user = await requireRole(['PROFESSOR']);
  const [me, demo] = await Promise.all([getStaffByUser(user.id), isDemoProfessorUser(user.id)]);
  if (!me) return <p className="card">پروندهٔ هیئت علمی یافت نشد.</p>;

  const universityId = me.universityId ?? user.universityId ?? null;

  const [termFilter, liveSessions, vcConfigured, uniRows] = await Promise.all([
    professorTermFilter(universityId),
    getTodayLiveClasses({ universityId, staffId: me.id, viewerUserId: user.id }),
    // آیا اصلاً کلاس مجازی (Moodle/BBB) در سامانه راه‌اندازی شده؟ اگر نه،
    // ویجت «کلاس‌های آنلاین امروز» به‌کل نمایش داده نمی‌شود.
    hasVirtualClassroomSetup({ universityId, staffId: me.id, viewerUserId: user.id }).catch(() => false),
    universityId
      ? db.select({ title: universities.title, logoUrl: universities.logoUrl }).from(universities).where(eq(universities.id, universityId)).limit(1)
      : Promise.resolve([]),
  ]);
  const { term, selectedTerm } = termFilter;
  const [uniRow] = uniRows;
  const needLogoFallback = !uniRow?.logoUrl;

  const [mergedClasses, contractRows, pays, logoFallback, availabilityRows] = await Promise.all([
    term ? getProfessorMergedClasses(me.id, term.id, universityId) : Promise.resolve(null),
    term
      ? db.select({ id: professor_term_contracts.id, contractType: professor_term_contracts.contractType, baseDutyUnits: professor_term_contracts.baseDutyUnits })
          .from(professor_term_contracts)
          .where(and(eq(professor_term_contracts.staffId, me.id), eq(professor_term_contracts.termId, term.id)))
          .limit(1)
      : Promise.resolve([]),
    term
      ? db
          .select({ id: payroll_statements.id, net: payroll_statements.netAmount, status: payroll_statements.status, midterm: payroll_statements.midtermPaidAmount })
          .from(payroll_statements)
          .innerJoin(professor_term_contracts, eq(professor_term_contracts.id, payroll_statements.contractId))
          .where(and(eq(professor_term_contracts.staffId, me.id), eq(professor_term_contracts.termId, term.id)))
      : Promise.resolve([]),
    needLogoFallback ? getSetting('UNIVERSITY_LOGO').catch(() => '') : Promise.resolve(''),
    // تعداد بازه‌های «اعلام ساعات حضور» این ترم — برای نوار وضعیت داشبورد
    term
      ? db.select({ n: count() }).from(professor_availabilities)
          .where(and(eq(professor_availabilities.staffId, me.id), eq(professor_availabilities.termId, term.id)))
      : Promise.resolve([]),
  ]);
  const availabilityCount = Number(availabilityRows?.[0]?.n ?? 0);
  const universityLogoUrl = uniRow?.logoUrl || logoFallback || null;

  const contract = contractRows[0] ?? null;

  const scheduleRows = mergedClasses?.scheduleRows ?? [];
  const mergeSharedKeys = mergedClasses?.mergeSharedKeys ?? new Map<number, string>();
  const mergedClassGroups = mergedClasses?.mergedClassGroups ?? [];

  // وضعیت امضای اسناد این ترم — برای بخش قرارداد پایین صفحه
  const termDocs = term && me
    ? await db
        .select({ signatureStatus: electronic_documents.signatureStatus })
        .from(electronic_documents)
        .where(and(eq(electronic_documents.staffId, me.id), eq(electronic_documents.termId, term.id)))
    : [];
  const signatureStatus = termDocs.some(d => d.signatureStatus === 'SIGNED')
    ? 'SIGNED'
    : termDocs.length > 0
      ? 'PENDING'
      : 'NONE';

  const termTitle = demo ? DEMO_TERM_TITLE : term?.title ?? '';

  const classCards = demo
    ? DEMO_DASHBOARD_CLASSES.map(c => ({
        key: `${c.id}-${c.roomLabel}-${c.timeLabel}`,
        offeringId: c.id,
        title: c.title,
        code: c.code,
        group: c.groupNumber,
        units: c.units,
        roomLine: `🏛️ ${c.roomLabel}`,
        timeLine: c.timeLabel,
        enrolled: c.enrolled,
        capacity: c.capacity,
        isCoTaught: c.isCoTaught,
        coTeacherName: c.coTeacherName,
        isMerged: false,
        mergedCodes: [] as string[],
      }))
    : mergedClassGroups.map(g => {
        const primary = g.members.find(m => m.id === g.primaryId) ?? g.members[0];
        const codes = [...new Set(g.members.map(m => m.code))];
        return {
          key: g.merged ? `merged-${g.key}` : `${primary.id}`,
          offeringId: primary.id,
          title: g.merged ? mergedDisplayTitle(primary.title, codes) : primary.title,
          code: codes.join(' / '),
          group: primary.groupNumber,
          units: Math.max(...g.members.map(m => m.units)),
          roomLine: primary.roomName ? `🏛️ ${primary.roomName}` : 'سالن ثبت نشده',
          timeLine: primary.hasSchedule ? `${primary.dayName} ${primary.startTime} الی ${primary.endTime}` : 'ساعت‌بندی ثبت نشده',
          enrolled: g.members.reduce((s, m) => s + m.enrolledCount, 0),
          capacity: Math.max(...g.members.map(m => m.capacity)),
          isCoTaught: primary.isCoTaught,
          coTeacherName: primary.coPartnerName,
          isMerged: g.merged,
          mergedCodes: codes,
        };
      });

  const weekTableRows = scheduleRows.map(r => ({ ...r, sharedScheduleGroupKey: mergeSharedKeys.get(r.id) ?? null }));

  // ── نوار وضعیت چهارگانه ────────────────────────────────────────────────
  // پیش‌تر این چهار عدد در «سربرگ» و به شکل چهار کادر بزرگ بودند و در موبایل
  // دو ردیف کامل از ارتفاع را می‌بلعیدند. حالا یک نوار باریک‌اند: آیکن + مقدار
  // + برچسب کوتاه، چهار ستون در یک ردیف (حتی در ۳۶۰px هم جا می‌شود).
  const gradeDeadline = term?.gradeEntryDeadline ?? null;
  const stats: { icon: string; label: string; value: string; tone: string; title: string }[] = [
    {
      icon: '📚',
      label: 'کلاس‌ها',
      value: demo ? `${faNum(DEMO_DASHBOARD_SUMMARY.classCount)} گروه` : `${faNum(classCards.length)} گروه`,
      tone: 'text-indigo-700',
      title: 'تعداد گروه‌های درسی این نیمسال',
    },
    {
      icon: '⏰',
      label: 'ساعات حضور',
      value: demo
        ? '✓ تایید شده'
        : availabilityCount > 0
          ? `${faNum(availabilityCount)} بازه`
          : 'ثبت نشده',
      tone: demo || availabilityCount > 0 ? 'text-emerald-700' : 'text-slate-500',
      title: 'بازه‌های اعلام ساعات حضور ثبت‌شده در این نیمسال',
    },
    {
      icon: '📑',
      label: 'قرارداد',
      value: demo
        ? 'آماده امضا'
        : signatureStatus === 'SIGNED'
          ? 'امضا شده'
          : signatureStatus === 'PENDING'
            ? 'در انتظار'
            : 'ثبت نشده',
      tone: demo || signatureStatus === 'SIGNED' ? 'text-emerald-700' : signatureStatus === 'PENDING' ? 'text-amber-700' : 'text-slate-500',
      title: 'وضعیت امضای الکترونیک قرارداد حق‌التدریس',
    },
    {
      icon: '🗓️',
      label: 'مهلت نمرات',
      value: demo
        ? '۴۸ ساعت'
        : gradeDeadline
          ? faDate(gradeDeadline) ?? 'تعیین نشده'
          : 'تعیین نشده',
      tone: gradeDeadline ? 'text-rose-700' : 'text-slate-500',
      title: 'آخرین مهلت ثبت و نهایی‌سازی نمرات این نیمسال',
    },
  ];

  return (
    <div className="space-y-6" dir="rtl">

      {/* ویجت کلاس مجازی فقط وقتی رندر می‌شود که در سامانه برای این استاد
          اتاق کلاس آنلاین تعریف شده باشد. اگر Moodle/BBB راه‌اندازی نشده
          باشد، این بلوک به‌کل از داشبورد حذف می‌شود (نه با پیام «خالی»). */}
      {(demo || vcConfigured) && (
        <VirtualClassroomWidget
          user={{ id: user.id, name: user.name, role: 'PROFESSOR' }}
          initialSessions={demo ? DEMO_LIVE_SESSIONS : liveSessions}
          recordings={demo ? DEMO_RECORDINGS : undefined}
        />
      )}

      {/* ── ویترینِ صفحهٔ اول ────────────────────────────────────────────────
          پیش‌تر یک نوارِ چهارکاشیِ تخت بود که هم بی‌عنوان شروع می‌شد و هم از
          سربرگ جدا افتاده بود؛ حالا عنوان/نیمسال و همان چهار عدد در یک بلوکِ
          واحد و هم‌تراز با ویترینِ سه کارتابل دیگر. */}
      <PanelHero
        tone="indigo"
        icon="🎓"
        eyebrow="کارتابل استاد"
        title="میز کار استاد"
        subtitle={
          term?.title
            ? `نیمسال جاری: ${term.title} — خلاصهٔ تدریس، حضور، قرارداد و مهلت نمرات شما`
            : 'نیمسال جاری برای شما تعیین نشده است؛ در صورت نیاز با آموزش تماس بگیرید.'
        }
        stats={stats.map(s => ({ label: s.label, value: s.value, tone: s.tone, title: s.title }))}
      />

      {/* عنوانِ بخشِ دسترسی سریع — پیش‌تر شبکهٔ کاشی‌ها بدون سرفصل شروع می‌شد
          و در موبایل معلوم نبود این کاشی‌ها «میان‌بر»اند یا محتوای صفحه. */}
      <div className="print:hidden flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5">
        <h2 className="text-xs font-extrabold text-slate-900 sm:text-sm">دسترسی سریع</h2>
        <span className="text-3xs font-bold text-slate-400">۱۱ میان‌بر</span>
      </div>

      <div className="print:hidden grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-4">
        <Link
          href="/professor/schedule"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-indigo-400 hover:shadow-md transition space-y-2 group"
        >
          <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition">
            🗓️
          </div>
          <div>
            <h3 className="font-extrabold text-2xs sm:text-sm text-slate-900 leading-tight">برنامه هفتگی</h3>
            <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 leading-4">
              مشاهده روزها، ساعات تشکیل، شماره کلاس فیزیکی و تواتر زوج/فرد
            </p>
          </div>
        </Link>

        <Link
          href="/professor/virtual-classes"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-sky-400 hover:shadow-md transition space-y-2 group"
        >
          <div className="w-10 h-10 rounded-2xl bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition">
            📡
          </div>
          <div>
            <h3 className="font-extrabold text-2xs sm:text-sm text-slate-900 leading-tight">کلاس آنلاین</h3>
            <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 leading-4">
              تعریف جلسهٔ BigBlueButton برای هر کلاس و ورود به اتاق
            </p>
          </div>
        </Link>

        <Link
          href="/professor/attendance"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-emerald-400 hover:shadow-md transition space-y-2 group"
        >          <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition">
            📋
          </div>
          <div>
            <h3 className="font-extrabold text-2xs sm:text-sm text-slate-900 leading-tight">حضور و غیاب</h3>
            <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 leading-4">
              ثبت وضعیت هر جلسه، تاخیر، غیبت موجه و هشدار ماده ۳/۱۶
            </p>
          </div>
        </Link>

        <Link
          href="/professor/grades"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-purple-400 hover:shadow-md transition space-y-2 group"
        >
          <div className="w-10 h-10 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition">
            📝
          </div>
          <div>
            <h3 className="font-extrabold text-2xs sm:text-sm text-slate-900 leading-tight">ثبت نمرات</h3>
            <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 leading-4">
              تعیین سهم میان‌ترم و پایان‌ترم (جمع ۲۰)، نمرات مشترک و رسیدگی به اعتراضات
            </p>
          </div>
        </Link>

        <Link
          href="/professor/contract"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-amber-400 hover:shadow-md transition space-y-2 group"
        >
          <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition">
            📑
          </div>
          <div>
            <h3 className="font-extrabold text-2xs sm:text-sm text-slate-900 leading-tight">قرارداد و مالی</h3>
            <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 leading-4">
              مشاهده فرم رسمی، جزئیات مالی، نرخ هر ساعت و امضای دیجیتال
            </p>
          </div>
        </Link>

        <Link
          href="/professor/availability"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-teal-400 hover:shadow-md transition space-y-2 group"
        >
          <div className="w-10 h-10 rounded-2xl bg-teal-100 text-teal-700 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition">
            ⏰
          </div>
          <div>
            <h3 className="font-extrabold text-2xs sm:text-sm text-slate-900 leading-tight">ساعات حضور</h3>
            <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 leading-4">
              اعلام بازه‌های زمانی حضور در ترم
            </p>
          </div>
        </Link>

        <Link
          href="/professor/performance"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-sky-400 hover:shadow-md transition space-y-2 group"
        >
          <div className="w-10 h-10 rounded-2xl bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition">
            📊
          </div>
          <div>
            <h3 className="font-extrabold text-2xs sm:text-sm text-slate-900 leading-tight">عملکرد</h3>
            <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 leading-4">
              کارنامه عملکرد تدریس و ارزیابی‌ها
            </p>
          </div>
        </Link>

        <Link
          href="/professor/evaluation"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-rose-400 hover:shadow-md transition space-y-2 group"
        >
          <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition">
            📈
          </div>
          <div>
            <h3 className="font-extrabold text-2xs sm:text-sm text-slate-900 leading-tight">ارزشیابی</h3>
            <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 leading-4">
              ارزشیابی دانشجویان هر کلاس
            </p>
          </div>
        </Link>

        <Link
          href="/professor/broadcast"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-indigo-400 hover:shadow-md transition space-y-2 group"
        >
          <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition">
            📣
          </div>
          <div>
            <h3 className="font-extrabold text-2xs sm:text-sm text-slate-900 leading-tight">پیام به کلاس</h3>
            <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 leading-4">
              ارسال پیام به دانشجویان کلاس‌های شما
            </p>
          </div>
        </Link>

        <Link
          href="/professor/documents"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-slate-400 hover:shadow-md transition space-y-2 group"
        >
          <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition">
            📄
          </div>
          <div>
            <h3 className="font-extrabold text-2xs sm:text-sm text-slate-900 leading-tight">اسناد و امضا</h3>
            <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 leading-4">
              اسناد الکترونیک و امضای دیجیتال
            </p>
          </div>
        </Link>

        <Link
          href="/help/professor"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-emerald-400 hover:shadow-md transition space-y-2 group"
        >
          <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition">
            📖
          </div>
          <div>
            <h3 className="font-extrabold text-2xs sm:text-sm text-slate-900 leading-tight">راهنما</h3>
            <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 leading-4">
              راهنمای استفاده و PDF
            </p>
          </div>
        </Link>
      </div>

      {!demo && (
        <ProfessorWeekTable
          termTitle={termTitle}
          selectedTermTitle={selectedTerm?.title ?? null}
          rows={weekTableRows}
          professorName={user.name}
          staffCode={me.staffCode}
          universityTitle={uniRow?.title ?? null}
          universityLogoUrl={universityLogoUrl}
        />
      )}

      <div className="print:hidden grid gap-6 md:grid-cols-3">

        <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200 md:col-span-2 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h2 className="font-extrabold text-slate-900 text-base">
                کلاس‌های آموزشی {termTitle}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">فهرست دروس تخصیص‌یافته به همراه عملیات سریع</p>
            </div>
            <Link href="/professor/schedule" className="text-xs font-bold text-indigo-700 hover:underline">
              مشاهده تقویم هفتگی ←
            </Link>
          </div>

          <div className="space-y-3">
            {classCards.length === 0 ? (
              <div className="text-center p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-xs font-bold text-slate-500">
                {demo
                  ? 'در این نیمسال هیچ درسی به شما تخصیص نیافته است.'
                  : selectedTerm
                    ? `در نیمسال «${selectedTerm.title}» کلاسی برای شما ثبت نشده است.`
                    : `در ${termTitle || 'نیمسال جاری'} کلاسی برای شما ثبت نشده است.`}
              </div>
            ) : classCards.map(c => (
              <div
                key={c.key}
                className={`flex flex-col sm:flex-row items-start sm:items-center justify-between rounded-2xl p-3.5 border gap-3 ${
                  c.isCoTaught ? 'bg-purple-50/50 border-purple-200' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className={`font-extrabold text-sm ${c.isCoTaught ? 'text-purple-950' : 'text-slate-900'}`}>{c.title}</p>
                    {c.isMerged ? (
                      <span className="px-2 py-0.5 rounded bg-teal-200 text-teal-950 font-bold text-3xs">🔗 کلاس ادغامی</span>
                    ) : c.isCoTaught ? (
                      <span className="px-2 py-0.5 rounded bg-purple-200 text-purple-950 font-bold text-3xs">👥 درس مشترک</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-bold text-3xs">گروه {faNum(c.group)}</span>
                    )}
                  </div>
                  <p className={`text-xs mt-0.5 font-bold ${c.isCoTaught ? 'text-purple-800' : 'text-slate-500'}`}>
                    {c.code} · {faNum(c.units)} واحد · {c.roomLine}
                    {c.timeLine ? ` · ${c.timeLine}` : ''}
                    {c.isCoTaught && c.coTeacherName ? ` · با ${c.coTeacherName}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge font-bold text-xs ${c.isCoTaught ? 'bg-purple-100 text-purple-900' : 'bg-sky-100 text-sky-800'}`}>{faNum(c.enrolled)}/{faNum(c.capacity)} دانشجو</span>
                  <Link href={`/professor/attendance?offeringId=${c.offeringId}`} className="px-2.5 py-1 rounded-xl bg-emerald-100 text-emerald-900 font-bold text-xs hover:bg-emerald-200 transition">
                    حضور و غیاب
                  </Link>
                  <Link href={`/professor/grades?offeringId=${c.offeringId}`} className="px-2.5 py-1 rounded-xl bg-indigo-100 text-indigo-900 font-bold text-xs hover:bg-indigo-200 transition">
                    ثبت نمره
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200 space-y-4">
          <div className="pb-3 border-b border-slate-200">
            <h2 className="font-extrabold text-slate-900 text-base">قرارداد و وضعیت مالی</h2>
            <p className="text-xs text-slate-500 mt-0.5">محاسبه حق‌التدریس بر اساس احکام مصوب</p>
          </div>

          {demo ? (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">شماره قرارداد:</span>
                <span className="font-mono font-bold text-slate-900">{DEMO_DASHBOARD_CONTRACT.contractNo}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">وضعیت امضا:</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-3xs">
                  {DEMO_DASHBOARD_CONTRACT.signatureStatus}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <span className="text-slate-500">ساعات تدریس مصوب:</span>
                <span className="font-bold text-indigo-950">{DEMO_DASHBOARD_CONTRACT.approvedHoursLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">مبلغ ناخالص:</span>
                <span className="font-bold text-slate-900">
                  {faNum(DEMO_DASHBOARD_CONTRACT.grossAmount.toLocaleString('fa-IR'))} {DEMO_DASHBOARD_CONTRACT.currency}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">خالص پرداختی پیش‌بینی:</span>
                <span className="font-extrabold text-emerald-700 text-sm">
                  {faNum(DEMO_DASHBOARD_CONTRACT.netAmount.toLocaleString('fa-IR'))} {DEMO_DASHBOARD_CONTRACT.currency}
                </span>
              </div>

              <div className="pt-2">
                <Link
                  href="/professor/contract"
                  className="w-full block text-center py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs shadow transition"
                >
                  مشاهده فرم کامل و امضای دیجیتال ←
                </Link>
              </div>
            </div>
          ) : contract ? (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">نوع قرارداد:</span>
                <span className="font-bold text-slate-900">{contract.contractType ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">وضعیت سند:</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-3xs">
                  {signatureStatus === 'SIGNED' ? 'امضا شده' : signatureStatus === 'PENDING' ? 'در انتظار امضای دیجیتال' : 'ثبت نشده'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">سقف موظفی ترم:</span>
                <span className="font-bold text-indigo-950">{Number(contract.baseDutyUnits ?? 0) > 0 ? `${faNum(contract.baseDutyUnits)} واحد` : 'ثبت نشده'}</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <span className="text-slate-500">فیش‌های مالی ثبت‌شده:</span>
                <span className="font-extrabold text-emerald-700 text-sm">{faNum(pays.length)} فیش</span>
              </div>

              <div className="pt-2">
                <Link
                  href="/professor/contract"
                  className="w-full block text-center py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs shadow transition"
                >
                  مشاهده فرم کامل و امضای دیجیتال ←
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-center p-5 bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-xs font-bold text-slate-500">
                {selectedTerm
                  ? `برای نیمسال «${selectedTerm.title}» قرارداد حق‌التدریسی ثبت نشده است.`
                  : 'برای نیمسال جاری دانشگاه شما قرارداد حق‌التدریسی ثبت نشده است.'}
              </div>
              <Link
                href="/professor/documents"
                className="w-full block text-center py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs transition"
              >
                مشاهده اسناد الکترونیک من ←
              </Link>
            </div>
          )}
        </div>

      </div>

      {/* بنر اتصال پیام‌رسان — انتهای صفحه (پیش‌تر بالای کارتابل بود و
          محتوای اصلی را پایین می‌راند) */}
      <MessengerOnboardBanner />

    </div>
  );
}
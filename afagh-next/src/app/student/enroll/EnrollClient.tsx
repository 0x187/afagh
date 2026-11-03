'use client';

// انتخاب واحد Optimistic UI + اتاق انتظار Redis — سند §۱۰۱۶/§۳۷۵۹/§۶۹۰۶
// «ثبت نهایی» بی‌درنگ پاسخ می‌گیرد؛ نتیجه از صف با polling می‌رسد.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  addToCartAction,
  autoFillCartFromChartAction,
  cancelBypassAction,
  clearCartAction,
  removeFromCartAction,
  referCouncilAction,
  requestBypassAction,
  submitCartAction,
  previewExamConflictsAction,
} from './actions';
import type { SubmitResult } from '@/lib/enroll-engine';
import { isSafeLinkUrl } from '@/lib/safe-url';
import { useToast } from '@/components/ui/Toast';
import { BYPASS_KIND_LABEL, BYPASS_STATUS_LABEL, type BypassRequestRow } from '@/lib/bypass-labels';
import { askConfirm } from '@/lib/ui-feedback';

export type ClassScheduleItem = {
  dayOfWeek: number;
  dayName: string;
  startTime: string;
  endTime: string;
  room?: string;
};

export type ExamScheduleItem = {
  examDate: string;
  startTime: string;
  endTime: string;
};

export type OfferingItem = {
  id: number;
  courseId: number;
  code: string;
  title: string;
  units: number;
  capacity: number;
  enrolled: number;
  group: number;
  professor: string;
  prereq?: string | null;
  /** آیا پیش‌نیازهای این درس پاس شده است؟ (false = نیازمند درخواست بایپس) */
  prereqMet?: boolean;
  classSchedules: ClassScheduleItem[];
  examSchedule: ExamScheduleItem | null;
  tuitionFixed: number;
  tuitionVariable: number;
  tuitionPerUnit: number;
  tuitionTotal: number;
};

export type CartItem = {
  id: number;
  courseId: number;
  code: string;
  title: string;
  units: number;
  group: number;
  classSchedules: ClassScheduleItem[];
  examSchedule: ExamScheduleItem | null;
};

type Live = Record<number, { cap: number; enrolled: number; remaining: number }>;

// تبدیل اعداد به فارسی جهت جلوگیری از به‌هم‌ریختگی و ادغام در متن راست‌به‌چپ (Bidi)
const faNum = (n: any) => (n === null || n === undefined) ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

function checkTimeOverlap(s1: string, e1: string, s2: string, e2: string) {
  return s1.slice(0, 5) < e2.slice(0, 5) && s2.slice(0, 5) < e1.slice(0, 5);
}


// ────────────────────────────────────────────────────────────────────────────
// برنامه هفتگی موقت سبد — چیدمان زندهٔ جلسات دروس داخل سبد تا دانشجو پیش از
// ثبت نهایی ببیند تایم‌ها چگونه پر می‌شوند؛ تداخل‌ها قرمز مشخص می‌شوند.
// ────────────────────────────────────────────────────────────────────────────
function TempWeeklySchedule({ cart }: { cart: CartItem[] }) {
  const days = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

  const byDay = useMemo(() => {
    const all: { day: number; start: string; end: string; title: string; room?: string; conflict: boolean }[] = [];
    for (const c of cart)
      for (const cs of c.classSchedules)
        all.push({ day: cs.dayOfWeek, start: cs.startTime, end: cs.endTime, title: c.title, room: cs.room, conflict: false });
    for (const a of all)
      for (const b of all)
        if (a !== b && a.day === b.day && checkTimeOverlap(a.start, a.end, b.start, b.end)) a.conflict = true;
    const map: Record<number, typeof all> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (const e of all) if (map[e.day]) map[e.day].push(e);
    for (const k of Object.keys(map)) map[Number(k)].sort((x, y) => x.start.localeCompare(y.start));
    return map;
  }, [cart]);

  if (cart.length === 0) return null;
  const anyConflict = Object.values(byDay).some(list => list.some(e => e.conflict));

  return (
    <div className="card !p-4 bg-white border border-slate-200 shadow-sm rounded-2xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <h2 className="font-extrabold text-sm sm:text-base text-slate-900">🗓️ برنامه هفتگی موقت سبد شما</h2>
        <span className={`text-2xs font-bold px-2.5 py-1 rounded-lg ${anyConflict ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
          {anyConflict ? '⚠️ دارای تداخل زمانی' : '✓ بدون تداخل زمانی'}
        </span>
      </div>
      <p className="text-2xs text-slate-500">
        این چیدمان بر اساس دروس فعلی سبد است و با هر افزودن/حذف به‌روز می‌شود تا پیش از ثبت نهایی ببینید تایم‌ها چگونه پر می‌شوند.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
        {days.map((dn, di) => (
          <div key={dn} className="rounded-xl border border-slate-200 bg-slate-50 p-2 space-y-1.5 min-h-[110px]">
            <p className="text-2xs font-black text-slate-700 text-center border-b border-slate-200 pb-1">{dn}</p>
            {byDay[di].length === 0 && <p className="text-3xs text-slate-400 text-center pt-3">—</p>}
            {byDay[di].map((e, i) => (
              <div
                key={i}
                className={`rounded-lg p-1.5 text-3xs font-bold border ${
                  e.conflict ? 'bg-rose-50 border-rose-300 text-rose-900' : 'bg-indigo-50 border-indigo-200 text-indigo-950'
                }`}
              >
                <p className="font-mono" dir="ltr">
                  {faNum(e.start)}–{faNum(e.end)}
                </p>
                <p className="leading-4 mt-0.5">{e.title}</p>
                {e.room && <p className="text-[9px] text-slate-500 mt-0.5">🏛️ {e.room}</p>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EnrollClient(props: {
  sajjadPortalUrl: string;
  /** عنوان مقطع تحصیلی دانشجو (مثلاً «کارشناسی‌ارشد») — برای نوار وضعیت آیین‌نامه */
  degreeLevelTitle?: string;
  /** آیا کاتالوگ بر اساس چارت تحصیلی مصوب فیلتر شده است؟ */
  curriculumScoped?: boolean;
  /** آیا چارت تحصیلی در انتخاب واحد الزامی است؟ (تنظیم پنل مدیر) — تعیین‌کنندهٔ پیامِ خالی‌بودن کاتالوگ */
  curriculumRequired?: boolean;
  /** علتِ حل‌نشدن چارت (هنگامی که curriculumScoped=false) — برای پیام صریح به دانشجو */
  curriculumReason?: string | null;
  /** کد نسخهٔ برنامه (مثلاً «۱۴۰۴») — برای نمایش در بنر چارت */
  curriculumVersionLabel?: string | null;
  /** شمارهٔ ترم جاریِ تحصیلیِ دانشجو (برای نمایش در بنر چارت) */
  studentTermOrdinal?: number | null;
  student: { id: number; status: string };
  term: { id: number | null; title: string; open: boolean; isSummer?: boolean };
  offerings: OfferingItem[];
  cart: CartItem[];
  cartStartedAt: number | null;
  regulationStatus?: {
    totalRequiredUnits: number;
    passedUnits: number;
    remainingUnits: number;
    isGraduating: boolean;
    lastTermGpa: number | null;
    isProbatedLastTerm: boolean;
    totalProbations: number;
    completedSemesters: number;
    status: string;
    effectiveMaxUnits: number;
    minAllowedUnits: number;
    isSummer: boolean;
    quotaType: string;
    /** شاگرد ممتاز (خودکار یا اورراید مدیر گروه) */
    isHonors?: boolean;
    /** واحدهای جبرانی که به سقف اضافه شده‌اند */
    compensatoryUnits?: number;
  } | null;
  /** درخواست‌های باز «بدون رعایت پیش‌نیاز / تداخل امتحانی» */
  bypassRequests?: BypassRequestRow[];
}) {
  const router = useRouter();
  const sajjadHref = isSafeLinkUrl(props.sajjadPortalUrl) ? props.sajjadPortalUrl : 'https://portal.saorg.ir';
  const [busy, setBusy] = useState(false);
  /* پیام‌های عملیاتی از توستِ سراسری می‌آیند (نه alert بومی): دیالوگ بومی
     جریان انتخاب واحد را قطع می‌کرد، در موبایل کل صفحه را بلاک می‌کرد و
     امکان نمایش چند خطای هم‌زمان (سقف واحد + تداخل + ظرفیت) را نمی‌داد. */
  const toast = useToast();
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [queuePos, setQueuePos] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [live, setLive] = useState<Live>({});
  const [remain, setRemain] = useState(15 * 60);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const effectiveMaxUnits = props.regulationStatus?.effectiveMaxUnits ?? (props.term.isSummer ? 6 : 20);
  const isBlockedCommission = props.student.status === 'BLOCKED_COMMISSION';

  // ⏱ مهلت ۱۵ دقیقه‌ای سبد (§۲۲۴۳)
  useEffect(() => {
    if (!props.cartStartedAt) {
      setRemain(15 * 60);
      return;
    }
    const calc = () => {
      const elapsed = Math.floor((Date.now() - props.cartStartedAt!) / 1000);
      const left = Math.max(0, 15 * 60 - elapsed);
      setRemain(left);
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [props.cartStartedAt]);

  // ظرفیت زنده از Redis (§۳۴۰۳) — بدون فشار به PostgreSQL
  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const r = await fetch('/api/enroll/live-capacity');
        if (!r.ok) return;
        const j = (await r.json()) as Live;
        if (!stop) setLive(j);
      } catch {
        /* ساکت */
      }
    };
    pull();
    const t = setInterval(pull, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  // نظرسنجی وضعیت صف
  useEffect(() => {
    if (queuePos === null) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch('/api/waiting-room/status');
        const j = (await r.json()) as { state: string; position?: number; result?: SubmitResult };
        if (j.state === 'WAITING' && j.position) setQueuePos(j.position);
        else if (j.state === 'PROCESSING') {
          setQueuePos(null);
          setProcessing(true);
        } else if (j.state === 'DONE' && j.result) {
          setQueuePos(null);
          setProcessing(false);
          setResult(j.result);
          if (pollRef.current) clearInterval(pollRef.current);
          router.refresh();
        }
      } catch {
        /* تلاش بعدی */
      }
    }, 1500);
    pollRef.current = t;
    return () => clearInterval(t);
  }, [queuePos, router]);

  const expired = props.cart.length > 0 && remain <= 0;
  const totalUnits = props.cart.reduce((s, c) => s + c.units, 0);
  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(remain % 60).padStart(2, '0');

  // بررسی تداخل‌های زمانی درون سبد انتخاب واحد دانشجو
  const cartConflicts = useMemo(() => {
    const conflicts: Record<number, { classConflicts: string[]; examConflicts: string[]; alternateGroup?: OfferingItem }> = {};

    for (let i = 0; i < props.cart.length; i++) {
      const itemA = props.cart[i];
      const classConf: string[] = [];
      const examConf: string[] = [];

      for (let j = 0; j < props.cart.length; j++) {
        if (i === j) continue;
        const itemB = props.cart[j];

        // تداخل کلاسی
        for (const cA of itemA.classSchedules) {
          for (const cB of itemB.classSchedules) {
            if (cA.dayOfWeek === cB.dayOfWeek && checkTimeOverlap(cA.startTime, cA.endTime, cB.startTime, cB.endTime)) {
              classConf.push(`تداخل کلاس در روز ${cA.dayName} (${faNum(cA.startTime)} الی ${faNum(cA.endTime)}) با درس «${itemB.title}»`);
            }
          }
        }

        // تداخل امتحانی
        if (itemA.examSchedule && itemB.examSchedule && itemA.examSchedule.examDate === itemB.examSchedule.examDate) {
          if (checkTimeOverlap(itemA.examSchedule.startTime, itemA.examSchedule.endTime, itemB.examSchedule.startTime, itemB.examSchedule.endTime)) {
            examConf.push(`تداخل ساعت امتحان در تاریخ ${faNum(itemA.examSchedule.examDate)} با درس «${itemB.title}»`);
          }
        }
      }

      // جستجوی گروه جایگزینِ بدون تداخل برای همین درس
      let alternateGroup: OfferingItem | undefined;
      if (classConf.length > 0 || examConf.length > 0) {
        const otherGroups = props.offerings.filter(o => o.courseId === itemA.courseId && o.id !== itemA.id);
        alternateGroup = otherGroups.find(alt => {
          for (const other of props.cart) {
            if (other.id === itemA.id) continue;
            for (const ca of alt.classSchedules) {
              for (const cb of other.classSchedules) {
                if (ca.dayOfWeek === cb.dayOfWeek && checkTimeOverlap(ca.startTime, ca.endTime, cb.startTime, cb.endTime)) return false;
              }
            }
            if (alt.examSchedule && other.examSchedule && alt.examSchedule.examDate === other.examSchedule.examDate) {
              if (checkTimeOverlap(alt.examSchedule.startTime, alt.examSchedule.endTime, other.examSchedule.startTime, other.examSchedule.endTime)) return false;
            }
          }
          return true;
        });
      }

      conflicts[itemA.id] = { classConflicts: classConf, examConflicts: examConf, alternateGroup };
    }

    return conflicts;
  }, [props.cart, props.offerings]);

  const hasAnyConflict = useMemo(() => {
    return Object.values(cartConflicts).some(c => c.classConflicts.length > 0 || c.examConflicts.length > 0);
  }, [cartConflicts]);

  async function add(id: number) {
    setBusy(true);
    setMsg('');
    await addToCartAction(id);
    router.refresh();
    setBusy(false);
  }

  async function remove(id: number) {
    setBusy(true);
    setMsg('');
    await removeFromCartAction(id);
    router.refresh();
    setBusy(false);
  }

  async function requestBypass(id: number, kind: 'PREREQ' | 'EXAM_CONFLICT') {
    setBusy(true);
    setMsg('در حال ثبت درخواست…');
    const res = await requestBypassAction(id, kind);
    setBusy(false);
    setMsg(res.ok
      ? '✅ درخواست ثبت شد؛ صندلی درس تا تصمیم مدیر گروه / کارشناس آموزش برای شما رزرو می‌ماند.'
      : `⛔ ${res.error || 'ثبت درخواست ناموفق بود.'}`);
    router.refresh();
  }

  async function cancelBypass(id: number) {
    if (!(await askConfirm({ title: 'تأیید عملیات', body: 'درخواست لغو شود؟ صندلی رزروشده آزاد می‌شود.', confirmText: 'تأیید', cancelText: 'انصراف', danger: false }))) return;
    setBusy(true);
    setMsg('');
    const res = await cancelBypassAction(id);
    setBusy(false);
    setMsg(res.ok ? 'درخواست لغو شد.' : `⛔ ${res.error || 'لغو درخواست ناموفق بود.'}`);
    router.refresh();
  }

  async function switchGroup(newOfferingId: number) {
    setBusy(true);
    setMsg('در حال جابجایی به گروه بدون تداخل...');
    await addToCartAction(newOfferingId);
    router.refresh();
    setBusy(false);
    setMsg('✅ درس به گروه بدون تداخل جابجا گردید.');
  }

  async function clearAll() {
    if (!(await askConfirm({ title: 'تأیید عملیات', body: 'آیا از خالی کردن تمام دروس موجود در سبد انتخاب واحد مطمئن هستید؟', confirmText: 'تأیید', cancelText: 'انصراف', danger: true }))) return;
    setBusy(true);
    setMsg('');
    await clearCartAction();
    router.refresh();
    setBusy(false);
    setMsg('سبد انتخاب واحد کاملاً خالی گردید.');
  }

  // ── فاز ۱۰: گارد تداخل امتحان (HARD مسدود / SOFT با تأییدیهٔ دیجیتال) ──
  const [conflictModal, setConflictModal] = useState<null | {
    hard: { courseCode: string; title: string; examDate: string; startTime: string; withCourse: string }[];
    soft: { courseCode: string; title: string; examDate: string; startTime: string; withCourse: string }[];
  }>(null);
  const [acceptRisk, setAcceptRisk] = useState(false);
  const [submittingRisk, setSubmittingRisk] = useState(false);

  async function submit() {
    if (totalUnits > effectiveMaxUnits) {
      toast(`مجموع واحدهای انتخابی (${totalUnits} واحد) از سقف مجاز آیین‌نامه برای شما (${effectiveMaxUnits} واحد) بیشتر است.`, 'error');
      return;
    }
    setBusy(true);
    setMsg('');
    setResult(null);

    // فاز ۱۰: پیش‌بینی تداخل امتحانی سبد (همان روز + هم‌ساعت → قطعی؛ هم‌روز + ساعت متفاوت → نرم)
    try {
      const prev = await previewExamConflictsAction();
      if (prev.hard.length > 0 || prev.soft.length > 0) {
        setConflictModal({ hard: prev.hard, soft: prev.soft });
        setBusy(false);
        return;
      }
    } catch {
      // اگر پیش‌بینی شکست خورد، گارد سمت سرور (کارگر صف) همچنان محکم است.
    }

    const res = await submitCartAction();
    setBusy(false);
    if (res.limited) {
      setMsg('سرعت درخواست‌ها بیش از حد مجاز است — چند لحظه صبر کنید (سپر نرخ).');
      return;
    }
    // اتاق انتظار در دسترس نبود و ثبت مستقیم انجام شد → همین نتیجه را نشان بده
    if (res.direct && res.result) {
      setResult(res.result);
      router.refresh();
      return;
    }
    if (!res.queued) {
      setMsg('ورود به صف ناموفق بود.');
      return;
    }
    setQueuePos(res.position); // پاسخ فوری §۱۰۱۶
  }

  async function submitWithRisk() {
    setSubmittingRisk(true);
    setConflictModal(null);
    setBusy(true);
    setMsg('');
    setResult(null);
    const res = await submitCartAction(true);
    setBusy(false);
    setSubmittingRisk(false);
    if (res.limited) { setMsg('سرعت درخواست‌ها بیش از حد مجاز است — چند لحظه صبر کنید (سپر نرخ).'); return; }
    if (res.direct && res.result) { setResult(res.result); router.refresh(); return; }
    if (!res.queued) { setMsg('ورود به صف ناموفق بود.'); return; }
    setQueuePos(res.position);
  }

  async function refer(id: number, reason?: string) {
    setBusy(true);
    const res = await referCouncilAction(id, reason);
    setMsg(res.ok ? 'ارجاع به کمیسیون ثبت شد؛ نتیجه از کارتابل پیگیری می‌شود.' : res.error || 'خطا');
    setBusy(false);
    router.refresh();
  }

  async function autoFill() {
    setBusy(true);
    setMsg('در حال چیدمان هوشمند و خودکار دروس ترم با کنترل ظرفیت و عدم تداخل...');
    const res = await autoFillCartFromChartAction();
    if (res.ok) {
      setMsg(`✅ ${res.message}`);
    } else {
      setMsg('خطا در چیدمان دروس چارت.');
    }
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="space-y-4 text-slate-800 font-sans" dir="rtl">
      {/* اخطار وضعیت مسدود کمیسیون موارد خاص و راهنمای سامانه سجاد */}
      {isBlockedCommission && (
        <div className="p-5 bg-rose-50 border-2 border-rose-500 rounded-2xl text-rose-950 space-y-3 shadow-md animate-pulse">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⛔</span>
            <div>
              <h3 className="font-black text-base text-rose-900">
                وضعیت تحصیلی شما مسدود است (ارجاع به کمیسیون موارد خاص)
              </h3>
              <p className="text-xs text-rose-800 mt-0.5">
                به دلیل مشروطی بیش از حد یا اتمام سقف سنوات قانونی، ادامه تحصیل و انتخاب واحد شما منوط به تایید کمیسیون موارد خاص دانشگاه در <b>سامانه سجاد وزارت علوم</b> است.
              </p>
            </div>
          </div>
          <div className="bg-white/80 p-3.5 rounded-xl border border-rose-200 text-xs space-y-1.5">
            <p className="font-bold text-rose-950">📌 مراحل رفع مسدودی:</p>
            <ol className="list-decimal list-inside space-y-1 text-slate-700 leading-relaxed">
              <li>
                ورود به <b>سامانه ملی سجاد</b> به نشانی{' '}
                <a href={sajjadHref} target="_blank" rel="noreferrer" className="text-blue-700 font-bold underline">
                  {sajjadHref.replace(/^https?:\/\//, '')}
                </a>{' '}
                و ثبت دادخواست در بخش کمیسیون بررسی موارد خاص دانشگاه آفاق.
              </li>
              <li>دریافت کد رهگیری و نامه ابلاغ رای کمیسیون موارد خاص.</li>
              <li>
                ثبت کد رهگیری و آپلود تصویر نامه رای در میز خدمات الکترونیک پورتال آفاق جهت بررسی کارشناس آموزش.
              </li>
            </ol>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Link
              href="/student/requests"
              className="bg-rose-700 hover:bg-rose-800 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all shadow"
            >
              📝 ارسال رای کمیسیون و پیگیری در میز خدمات
            </Link>
            <a
              href={sajjadHref}
              target="_blank"
              rel="noreferrer"
              className="bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all shadow"
            >
              🌐 ورود مستقیم به سامانهٔ سجاد
            </a>
          </div>
        </div>
      )}

      {/* بنر اعمال چارت تحصیلی (فیلتر کاتالوگ بر اساس سرفصل و ترم دانشجو) */}
      {props.curriculumScoped ? (
        <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium flex items-start gap-2">
          <span className="text-base leading-none">🗺️</span>
          <span>
            کاتالوگ بر اساس <b>چارت تحصیلی مصوب</b> شما
            {props.curriculumVersionLabel ? ` (نسخهٔ ${faNum(props.curriculumVersionLabel)})` : ''}
            {props.studentTermOrdinal ? ` و ترم ${faNum(props.studentTermOrdinal)}` : ''}
            فیلتر شده است؛ دروس چارت مصوبِ ترم جاری و ترم‌های پایین‌تر نمایش داده می‌شود (دروس ترم‌های بالاتر با تخصیص مدیرگروه قابل‌مشاهده‌اند).
          </span>
        </div>
      ) : props.curriculumRequired ? (
        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-medium flex items-start gap-2">
          <span className="text-base leading-none">⚠️</span>
          <span>
            <b>دانشجوی گرامی جهت تخصیص چارت دروس به مدیرگروه مراجعه کنید.</b> تا زمان انتشار چارت تحصیلی مصوب،
            لیست دروس انتخاب واحد خالی نمایش داده می‌شود.
          </span>
        </div>
      ) : (
        <div className="p-3 rounded-2xl bg-sky-50 border border-sky-200 text-sky-900 text-xs font-medium flex items-start gap-2">
          <span className="text-base leading-none">ℹ️</span>
          <span>
            چارت تحصیلی در انتخاب واحد الزامی نیست؛ کاتالوگ بر اساس <b>هدف‌گیریِ رشته و ورودیِ هر ارائه</b> نمایش داده می‌شود.
          </span>
        </div>
      )}

      {/* نوار وضعیت آیین‌نامه تحصیلی و سقف واحد */}
      {props.regulationStatus && (
        <div className="p-4 bg-slate-900 text-white rounded-2xl shadow space-y-3">
          {/* نوار وضعیت آیین‌نامه — هم‌راستا در قالب کارت‌های یک‌دست */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-slate-800/70 border border-slate-700 px-3 py-2">
              <p className="text-3xs text-indigo-300 font-bold mb-1">📜 مقطع تحصیلی</p>
              <p className="text-sm font-black text-white">{props.degreeLevelTitle || '—'}</p>
            </div>
            <div className="rounded-xl bg-slate-800/70 border border-slate-700 px-3 py-2">
              <p className="text-3xs text-indigo-300 font-bold mb-1">🎯 سقف مجاز انتخاب واحد</p>
              <p className="text-sm font-black text-emerald-300">{faNum(effectiveMaxUnits)} واحد</p>
            </div>
            {props.regulationStatus.minAllowedUnits > 0 && (
              <div className="rounded-xl bg-slate-800/70 border border-slate-700 px-3 py-2">
                <p className="text-3xs text-indigo-300 font-bold mb-1">⬇️ حداقل واحد این ترم</p>
                <p className="text-sm font-black text-white">{faNum(props.regulationStatus.minAllowedUnits)} واحد</p>
              </div>
            )}
            <div className="rounded-xl bg-slate-800/70 border border-slate-700 px-3 py-2">
              <p className="text-3xs text-indigo-300 font-bold mb-1">📊 پیشرفت تحصیلی</p>
              <p className="text-xs font-bold text-slate-200 font-mono leading-relaxed">
                {faNum(props.regulationStatus.passedUnits)}/{faNum(props.regulationStatus.totalRequiredUnits)} واحد
                <span className="text-slate-400"> · {faNum(props.regulationStatus.remainingUnits)} باقی</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {props.regulationStatus.isGraduating && (
              <span className="bg-amber-500 text-slate-950 font-black px-2.5 py-1 rounded-lg">
                🎓 دانشجوی ترم آخر
              </span>
            )}
            {props.regulationStatus.isProbatedLastTerm && (
              <span className="bg-rose-600 text-white font-bold px-2.5 py-1 rounded-lg">
                ⚠️ وضعیت مشروط
              </span>
            )}
            {props.regulationStatus.isHonors && !props.regulationStatus.isProbatedLastTerm && (
              <span className="bg-yellow-400 text-slate-950 font-black px-2.5 py-1 rounded-lg">
                ⭐ شاگرد ممتاز
              </span>
            )}
            {props.term.isSummer && (
              <span className="bg-orange-600 text-white font-bold px-2.5 py-1 rounded-lg">
                ☀️ ترم تابستان
              </span>
            )}
            {(props.regulationStatus.compensatoryUnits ?? 0) > 0 && (
              <span className="text-3xs text-emerald-400/90">شامل {faNum(props.regulationStatus.compensatoryUnits ?? 0)} واحد جبرانی در سقف مجاز</span>
            )}
          </div>
        </div>
      )}

      {/* درخواست‌های در انتظار تصمیم (بدون رعایت پیش‌نیاز / تداخل امتحانی) */}
      {props.bypassRequests && props.bypassRequests.length > 0 && (
        <div className="card !p-4 rounded-2xl border border-amber-300 bg-amber-50 space-y-2">
          <h3 className="font-extrabold text-amber-950 text-sm flex items-center gap-2">
            <span>⏳</span>
            <span>درخواست‌های در انتظار تصمیم</span>
          </h3>
          <p className="text-2xs text-amber-800">
            ظرفیت این دروس تا زمان تصمیم مدیر گروه / کارشناس آموزش برای شما رزرو شده است.
          </p>
          <div className="space-y-2">
            {props.bypassRequests.map(r => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-xl border border-amber-200 px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-900">{r.courseTitle}</span>
                  <span className="font-mono text-3xs text-slate-500" dir="ltr">{r.courseCode}</span>
                  <span className="bg-amber-100 text-amber-900 font-bold rounded px-1.5 py-0.5">
                    بدون رعایت {BYPASS_KIND_LABEL[r.kind]}
                  </span>
                  <span className="bg-slate-100 text-slate-700 rounded px-1.5 py-0.5">
                    {BYPASS_STATUS_LABEL[r.status]}
                  </span>
                  <span className="text-slate-500">
                    مهلت: {new Date(r.managerDeadlineAt).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
                <button
                  onClick={() => cancelBypass(r.id)}
                  disabled={busy}
                  className="text-2xs font-bold text-rose-700 border border-rose-300 rounded-lg px-2 py-1 hover:bg-rose-50 disabled:opacity-50"
                >
                  لغو درخواست
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* کلاس آنلاین — همیشه در دسترس (حتی خارج از زمان انتخاب واحد) */}
      <Link
        href="/student/virtual-classes"
        className="card !p-4 bg-gradient-to-r from-sky-900 via-blue-900 to-slate-900 text-white rounded-2xl border-0 shadow-lg flex flex-wrap items-center justify-between gap-3 no-underline"
      >
        <div>
          <h3 className="font-extrabold text-white text-sm sm:text-base flex items-center gap-2">
            <span>💻</span>
            <span>کلاس آنلاین و جلسات وبینار LMS</span>
          </h3>
          <p className="text-xs text-sky-200 mt-0.5">
            ورود مستقیم به کلاس‌های مجازی BigBlueButton و پیگیری جلسات امروزِ دروس شما
          </p>
        </div>
        <span className="bg-sky-500 hover:bg-sky-400 text-sky-950 font-black text-xs px-4 py-2.5 rounded-xl transition-all shadow-md active:scale-95 inline-flex items-center gap-1.5">
          <span>🚪</span>
          <span>ورود به کلاس آنلاین</span>
        </span>
      </Link>

      {/* دکمه انتخاب هوشمند و سریع از روی چارت — فقط در زمان باز‌بودن پنجرهٔ انتخاب واحد */}
      {props.term.open && (
        <div className="card !p-4 bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 text-white rounded-2xl border-0 shadow-lg flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-extrabold text-white text-sm sm:text-base flex items-center gap-2">
              <span>🤖</span>
              <span>انتخاب واحد هوشمند بر اساس چارت سرفصل و کنترل تداخل</span>
            </h3>
            <p className="text-xs text-emerald-200 mt-0.5">
              سیستم با بررسی تمام گروه‌های درسی، بهترین گروه‌های دارای ظرفیت و <b>فاقد تداخل کلاسی و امتحانی</b> را در سبد شما می‌چیند.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={autoFill}
              disabled={busy || isBlockedCommission}
              className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black text-xs px-4 py-2.5 rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <span>⚡</span>
              <span>چیدمان خودکار دروس ترم (بدون تداخل)</span>
            </button>
          </div>
        </div>
      )}

      {!props.term.open && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 border border-amber-200">
          پنجرهٔ انتخاب واحد برای «{props.term.title || '—'}» بسته است.
        </p>
      )}

      {/* مهلت تکمیل سبد */}
      {props.cart.length > 0 && (
        <div
          className={`card !p-3 flex items-center justify-between rounded-xl border ${
            expired
              ? 'bg-rose-50 border-rose-300 text-rose-800'
              : remain < 180
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-indigo-50 border-indigo-200 text-indigo-900'
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-bold">
            <span>⏱️</span>
            <span>مهلت نهایی‌سازی و رزرو صندلی در سبد:</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-base font-extrabold tracking-wider" dir="ltr">
              {expired ? 'منقضی شده' : `${faNum(mm)}:${faNum(ss)}`}
            </span>
            {expired && (
              <button
                onClick={() => {
                  setRemain(15 * 60);
                }}
                className="text-2xs bg-rose-600 hover:bg-rose-700 text-white font-bold px-3 py-1 rounded-lg"
              >
                🔄 تمدید مهلت
              </button>
            )}
          </div>
        </div>
      )}

      {/* هشدار تداخل زمانی کلی */}
      {hasAnyConflict && (
        <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl text-xs text-amber-900 space-y-1 shadow-sm">
          <div className="font-extrabold text-sm text-amber-950 flex items-center gap-2">
            <span>⚠️</span>
            <span>هشدار تداخل زمانی در سبد انتخاب واحد:</span>
          </div>
          <p>
            بین زمان برگزاری کلاس‌ها یا تاریخ امتحانات برخی دروس سبد تداخل وجود دارد. می‌توانید با زدن دکمهٔ «انتقال به گروه دیگر»، گروه بدون تداخل را جایگزین نمایید.
          </p>
        </div>
      )}

      {/* اتاق انتظار — پاسخ فوری §۱۰۱۶ */}
      {(queuePos !== null || processing) && (
        <div className="card flex items-center gap-3 border-emerald-300 bg-emerald-50 p-4 rounded-xl shadow-sm">
          <span className="h-3.5 w-3.5 animate-pulse rounded-full bg-emerald-600"></span>
          <div>
            <p className="text-sm font-bold text-emerald-900">درخواست شما در صف پردازش انتخاب واحد قرار گرفت</p>
            <p className="text-xs text-emerald-700">
              {processing ? 'در حال اعتبارسنجی و ثبت قطعی در پایگاه داده…' : `نوبت شما در اتاق انتظار: ${faNum(queuePos ?? '—')}`}
            </p>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* سبد انتخاب واحد دانشجو با نمایش تفکیکی و تمیز گروه‌ها و واحدها     */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="card !p-4 bg-white border border-slate-200 shadow-sm rounded-2xl space-y-3">
        <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3 gap-2">
          <div className="flex items-center gap-3">
            <h2 className="font-extrabold text-base text-slate-900">🛒 سبد انتخاب واحد</h2>
            <span
              className={`text-xs px-3 py-1 rounded-full font-bold inline-flex items-center gap-1.5 ${
                totalUnits > 20
                  ? 'bg-rose-100 text-rose-800'
                  : totalUnits >= 12
                  ? 'bg-emerald-100 text-emerald-900'
                  : 'bg-amber-100 text-amber-900'
              }`}
            >
              <span>{faNum(totalUnits)} واحد</span>
              <span>({faNum(props.cart.length)} درس)</span>
              <span>— سقف مجاز: {faNum(20)} واحد</span>
            </span>
          </div>

          {props.cart.length > 0 && (
            <button
              onClick={clearAll}
              disabled={busy}
              className="text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-3 py-1.5 rounded-xl font-bold transition-colors flex items-center gap-1"
            >
              <span>🗑️</span>
              <span>حذف همه (خالی کردن سبد)</span>
            </button>
          )}
        </div>

        {props.cart.length === 0 ? (
          <div className="text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-300 space-y-1">
            <p className="text-sm font-bold text-slate-600">سبد انتخاب واحد شما خالی است.</p>
            <p className="text-xs text-slate-400">
              می‌توانید با دکمهٔ «چیدمان خودکار» دروس ترم را بدون تداخل بچینید یا از فهرست زیر گروه مورد نظر را اضافه کنید.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {props.cart.map((c, idx) => {
              const conf = cartConflicts[c.id];
              const isConflicted = conf && (conf.classConflicts.length > 0 || conf.examConflicts.length > 0);

              return (
                <div
                  key={c.id || idx}
                  className={`rounded-xl border p-3 text-sm transition-all space-y-2 ${
                    isConflicted
                      ? 'bg-amber-50/80 border-amber-300 shadow-sm'
                      : 'bg-emerald-50/70 border-emerald-200/80'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-emerald-200 text-emerald-900 flex items-center justify-center font-bold text-xs">
                        {faNum(idx + 1)}
                      </span>
                      <span className="font-extrabold text-slate-900 text-sm">{c.title}</span>
                      <span className="text-xs text-slate-500 font-mono" dir="ltr">
                        ({c.code})
                      </span>

                      {/* نشان گروه به صورت تفکیک‌شده و با عدد فارسی */}
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold mr-1">
                        گروه {faNum(c.group)}
                      </span>

                      {/* نشان تعداد واحد به صورت تفکیک‌شده و با عدد فارسی */}
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-white text-emerald-800 border border-emerald-300 text-xs font-bold mr-1">
                        {faNum(c.units)} واحد
                      </span>
                      {(() => {
                        const off = props.offerings.find(o => o.id === c.id);
                        const lv = live[c.id];
                        const isFull = off ? (lv ? lv.remaining <= 0 : off.enrolled >= off.capacity) : false;
                        return isFull ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold mr-1">
                            ⏳ اتاق انتظار — ظرفیت تکمیل
                          </span>
                        ) : null;
                      })()}
                    </div>

                    <div className="flex items-center gap-2">
                      {conf?.alternateGroup && (
                        <button
                          onClick={() => switchGroup(conf.alternateGroup!.id)}
                          disabled={busy}
                          className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-xl font-bold shadow-sm transition-all flex items-center gap-1"
                        >
                          <span>🔄</span>
                          <span>انتقال به گروه {faNum(conf.alternateGroup.group)} (بدون تداخل)</span>
                        </button>
                      )}

                      <button
                        className="text-xs bg-white hover:bg-rose-600 hover:text-white text-rose-600 border border-rose-300 px-3 py-1.5 rounded-xl font-bold transition-all shadow-sm active:scale-95 flex items-center gap-1"
                        disabled={busy}
                        onClick={() => remove(c.id)}
                      >
                        <span>✕</span>
                        <span>حذف از سبد</span>
                      </button>
                    </div>
                  </div>

                  {/* جزئیات زمان‌بندی کلاس و امتحان در کارت سبد با برچسب‌های تفکیک‌شده و اعداد فارسی */}
                  <div className="text-xs text-slate-700 flex flex-wrap items-center gap-x-4 gap-y-1 bg-white/80 p-2.5 rounded-lg border border-slate-200">
                    <div className="flex items-center gap-1">
                      <span>📅</span>
                      <span className="font-bold">جلسات هفتگی:</span>
                      <span className="text-slate-600 font-medium">
                        {c.classSchedules.length > 0
                          ? c.classSchedules.map(cs => `${cs.dayName} ساعت ${faNum(cs.startTime)} الی ${faNum(cs.endTime)}`).join(' و ')
                          : 'اعلام خواهد شد'}
                      </span>
                    </div>
                    {c.classSchedules.some(cs => cs.room) && (
                      <div className="flex items-center gap-1 border-r border-slate-200 pr-3 mr-1 font-bold text-indigo-950">
                        <span>🏛️</span>
                        <span>محل کلاس:</span>
                        <span className="bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                          {c.classSchedules.map(cs => cs.room).filter(Boolean).join('، ')}
                        </span>
                      </div>
                    )}
                    {c.examSchedule && (
                      <div className="flex items-center gap-1 border-r border-slate-200 pr-3 mr-1">
                        <span>📝</span>
                        <span className="font-bold">امتحان پایان‌ترم:</span>
                        <span className="text-slate-600 font-medium">
                          تاریخ {faNum(c.examSchedule.examDate)} ساعت {faNum(c.examSchedule.startTime)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* هشدارهای تداخل */}
                  {isConflicted && (
                    <div className="space-y-1 text-xs text-rose-800 bg-rose-50 p-2.5 rounded-lg border border-rose-200 font-medium">
                      {conf.classConflicts.map((cc, i) => (
                        <p key={i}>⚠️ {cc}</p>
                      ))}
                      {conf.examConflicts.map((ec, i) => (
                        <p key={i}>⚠️ {ec}</p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {totalUnits > 20 && (
          <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-xs text-rose-800 font-bold flex items-center gap-2">
            <span>⛔</span>
            <span>تعداد واحدهای سبد ({faNum(totalUnits)} واحد) بیش از سقف مجاز ترمیک ({faNum(20)} واحد) است. لطفاً حداقل {faNum(totalUnits - 20)} واحد را حذف کنید.</span>
          </div>
        )}

        {props.cart.length > 0 && (
          <button
            className="btn-primary mt-3 w-full py-3 text-sm font-extrabold shadow-lg rounded-xl"
            disabled={busy || totalUnits > 20 || queuePos !== null || processing}
            onClick={submit}
          >
            {busy ? 'در حال ارسال و رزرو…' : `ثبت نهایی و اخذ قطعی (${faNum(totalUnits)} واحد)`}
          </button>
        )}
      </div>

      <TempWeeklySchedule cart={props.cart} />

      {conflictModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-5 space-y-4">
            <h3 className="font-extrabold text-slate-900 text-sm">⚠️ تداخل امتحانی در سبد شما شناسایی شد</h3>
            {conflictModal.hard.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-black text-rose-700">⛔ تداخل قطعی (همان روز و همان ساعت) — امکان اخذ این درس‌ها وجود ندارد:</p>
                {conflictModal.hard.map((c, i) => (
                  <div key={i} className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-2xs font-bold text-rose-900">
                    {c.courseCode} — {c.title} در {c.examDate} ساعت {c.startTime} هم‌زمان با {c.withCourse}
                  </div>
                ))}
              </div>
            )}
            {conflictModal.soft.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-black text-amber-700">🌗 تداخل نرم (همان روز، ساعت‌های متفاوت) — با تأییدیهٔ دیجیتال قابل ثبت است:</p>
                {conflictModal.soft.map((c, i) => (
                  <div key={i} className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-2xs font-bold text-amber-900">
                    {c.courseCode} — {c.title} در {c.examDate} ساعت {c.startTime} (با {c.withCourse} هم‌روز است)
                  </div>
                ))}
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 pt-1">
                  <input type="checkbox" checked={acceptRisk} onChange={e => setAcceptRisk(e.target.checked)} className="accent-amber-600 w-4 h-4" />
                  تأیید می‌کنم این دو امتحان در یک روز (شیفت‌های متفاوت) برگزار می‌شود و عواقب آن را می‌پذیرم. این تأییدیه به‌صورت امضای دیجیتال در پروندهٔ من ثبت می‌شود.
                </label>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setConflictModal(null)} className="px-4 py-2 rounded-lg bg-slate-200 text-slate-700 font-bold text-xs">انصراف</button>
              {conflictModal.soft.length > 0 && (
                <button
                  onClick={submitWithRisk}
                  disabled={!acceptRisk || submittingRisk}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs disabled:opacity-50"
                >
                  {submittingRisk ? '…' : 'تأیید عواقب و ادامهٔ ثبت'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {msg && (
        <div className="rounded-xl bg-slate-900 text-white p-3 text-center text-xs font-bold animate-fade-in shadow-md">
          {msg}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          {result.ok && result.registered.length > 0 && (
            <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 border border-emerald-300 font-bold space-y-2 shadow-sm">
              <div className="flex items-center justify-between">
                <span>🎉 ثبت قطعی شد: {result.registered.join('، ')}</span>
                <Link
                  href="/student/schedule"
                  className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black px-4 py-2 rounded-xl shadow transition-all inline-flex items-center gap-1.5"
                >
                  <span>📄</span>
                  <span>مشاهده و چاپ تاییدیه انتخاب واحد و برنامه هفتگی</span>
                </Link>
              </div>
            </div>
          )}
          {result.waitlisted.length > 0 && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 border border-amber-200">
              اتاق انتظار (ظرفیت تکمیل): {result.waitlisted.join('، ')} — با آزادشدن ظرفیت، به‌طور خودکار ثبت می‌شوید و اعلان می‌گیرید.
            </p>
          )}
          {result.droppedCart && result.droppedCart.length > 0 && (
            <div className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900 border border-sky-200 space-y-1">
              <p className="font-bold">
                این ردیف‌ها به‌طور خودکار از سبد حذف شدند و در این ثبت نیامدند (بقیهٔ سبد ثبت شد):
              </p>
              {result.droppedCart.map((d, i) => (
                <p key={i}>• «{d.title}» — {d.reason}</p>
              ))}
            </div>
          )}
          {result.hardErrors.map((e, i) => (
            <p key={i} className="rounded-xl bg-red-50 p-3 text-sm text-red-800 border border-red-200 font-bold">
              ⛔ {e}
            </p>
          ))}
          {result.softErrors.map((e, i) => (
            <div key={i} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 border border-amber-200 flex items-center justify-between">
              <span>⚠️ {e.msg}</span>
              <div className="flex flex-wrap items-center gap-1.5 mr-2">
                {e.msg.startsWith('تداخل نرم امتحان') && (
                  <button
                    className="bg-white hover:bg-amber-100 text-amber-800 border border-amber-400 rounded-lg !py-1 !px-2 text-xs font-bold disabled:opacity-50"
                    disabled={busy}
                    onClick={() => requestBypass(e.offeringId, 'EXAM_CONFLICT')}
                  >
                    درخواست بدون رعایت تداخل امتحانی
                  </button>
                )}
                <button
                  className="btn-ghost !py-1 !px-2 text-xs"
                  disabled={busy}
                  onClick={() => refer(e.offeringId, e.msg)}
                >
                  ارجاع به کمیسیون موارد خاص
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* فهرست دروس ارائه‌شده با تفکیک دقیق گروه‌ها، ظرفیت و زمان‌بندی     */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="card !p-4 bg-white border border-slate-200 shadow-sm rounded-2xl space-y-3">
        <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-2">
          <div>
            <h2 className="font-extrabold text-sm sm:text-base text-slate-900">
              📚 دروس و گروه‌های ارائه‌شده در نیمسال جاری — {props.term.title}
            </h2>
            <p className="text-2xs text-slate-500 mt-0.5">
              نمایش گروه‌های درسی موازی با زمان‌بندی کلاس، تاریخ امتحان و کنترل زندهٔ ظرفیت.
            </p>
          </div>
          <span className="text-xs text-slate-500 font-bold">تعداد کل گروه‌ها: {faNum(props.offerings.length)}</span>
        </div>

        <div className="space-y-2.5">
          {props.offerings.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 px-4 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60">
              <div className="text-4xl mb-3">🗂️</div>
              {props.curriculumRequired ? (
                <>
                  <p className="font-extrabold text-slate-700 text-sm">فهرست دروس انتخاب واحد خالی است</p>
                  <p className="text-xs text-slate-500 mt-2 max-w-md leading-relaxed">
                    دانشجوی گرامی جهت تخصیص چارت دروس به مدیرگروه مراجعه کنید.
                    تا زمان انتشار چارت تحصیلی مصوب، هیچ درسی برای انتخاب نمایش داده نمی‌شود.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-extrabold text-slate-700 text-sm">ارائه‌ای متناظر با هدف‌گیری شما یافت نشد</p>
                  <p className="text-xs text-slate-500 mt-2 max-w-md leading-relaxed">
                    چارت تحصیلی در انتخاب واحد الزامی نیست؛ نمایش دروس بر اساس هدف‌گیریِ رشته و ورودیِ هر ارائه است.
                    در حال حاضر ارائه‌ای با رشته/ورودیِ شما مطابقت ندارد.
                  </p>
                </>
              )}
            </div>
          ) : props.offerings.map(o => {
            const inCart = props.cart.some(c => c.id === o.id);
            const lv = live[o.id];
            const remainingSeats = lv ? lv.remaining : o.capacity - o.enrolled;
            const full = remainingSeats <= 0;

            // آیا گروه دیگری از همین درس در سبد هست؟
            const otherGroupInCart = props.cart.find(c => c.courseId === o.courseId && c.id !== o.id);

            // درخواست باز بدون رعایت پیش‌نیاز برای همین گروه
            const openPrereqRequest = (props.bypassRequests ?? []).some(
              r => r.offeringId === o.id && r.kind === 'PREREQ'
            );

            return (
              <div
                key={o.id}
                className={`flex flex-wrap items-center justify-between rounded-xl p-3.5 text-sm border transition-all ${
                  inCart
                    ? 'bg-emerald-50/70 border-emerald-300 ring-2 ring-emerald-200 shadow-sm'
                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100/80'
                }`}
              >
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-extrabold text-slate-900 text-sm">{o.title}</p>
                    <span className="text-xs text-slate-500 font-mono" dir="ltr">
                      ({o.code})
                    </span>

                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold">
                      گروه {faNum(o.group)}
                    </span>

                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-300 text-xs font-medium">
                      استاد: {o.professor}
                    </span>

                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 border border-emerald-200 text-xs font-bold">
                      {faNum(o.units)} واحد
                    </span>

                    {/* شهریه */}
                    {o.tuitionTotal > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold">
                        💰 {faNum(o.tuitionTotal)} ریال
                      </span>
                    )}
                  </div>

                  {/* زمان‌بندی کلاس و امتحان و شماره کلاس */}
                  <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>
                      🕒 <b>جلسات هفتگی:</b>{' '}
                      {o.classSchedules.length > 0
                        ? o.classSchedules.map(cs => `${cs.dayName} ساعت ${faNum(cs.startTime)} الی ${faNum(cs.endTime)}`).join(' و ')
                        : 'اعلام نشده'}
                    </span>
                    {o.classSchedules.some(cs => cs.room) && (
                      <span className="font-bold text-indigo-950 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 inline-flex items-center gap-1">
                        🏛️ <b>محل و شماره کلاس:</b> {o.classSchedules.map(cs => cs.room).filter(Boolean).join('، ')}
                      </span>
                    )}
                    {o.examSchedule && (
                      <span>
                        📝 <b>امتحان پایان‌ترم:</b> تاریخ {faNum(o.examSchedule.examDate)} ساعت {faNum(o.examSchedule.startTime)}
                      </span>
                    )}
                  </div>

                  {/* ظرفیت کلاس */}
                  <div className="text-xs">
                    {full ? (
                      <span className="text-rose-600 font-bold">
                        ⛔ ظرفیت تکمیل ({faNum(o.enrolled)}/{faNum(o.capacity)}) — ورود به اتاق انتظار در صورت اخذ
                      </span>
                    ) : (
                      <span className="text-emerald-700 font-bold">
                        ✅ ظرفیت باقی‌مانده: {faNum(remainingSeats)} از {faNum(o.capacity)} صندلی
                      </span>
                    )}
                  </div>

                  {o.prereq && <p className="text-xs text-amber-700 font-medium">پیش‌نیاز: {o.prereq}</p>}
                </div>

                {/* دکمه‌های افزودن / حذف / تعویض گروه */}
                <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-0">
                  {inCart ? (
                    <button
                      className="bg-rose-50 hover:bg-rose-600 hover:text-white text-rose-700 border border-rose-300 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95"
                      disabled={busy}
                      onClick={() => remove(o.id)}
                    >
                      <span>✕</span>
                      <span>حذف از سبد</span>
                    </button>
                  ) : otherGroupInCart ? (
                    <button
                      className="bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                      disabled={busy || !props.term.open}
                      onClick={() => add(o.id)}
                    >
                      <span>🔄</span>
                      <span>تغییر به گروه {faNum(o.group)}</span>
                    </button>
                  ) : full ? (
                    <button
                      className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                      disabled={busy || !props.term.open}
                      onClick={() => add(o.id)}
                      title="ظرفیت این گروه تکمیل است؛ با افزودن، در اتاق انتظار قرار می‌گیرید و به محض آزادشدن صندلی، خودکار ثبت و اعلان می‌شوید"
                    >
                      <span>⏳</span>
                      <span>ورود به اتاق انتظار</span>
                    </button>
                  ) : (
                    <button
                      className="bg-indigo-700 hover:bg-indigo-800 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                      disabled={busy || !props.term.open}
                      onClick={() => add(o.id)}
                    >
                      <span>➕</span>
                      <span>افزودن به سبد</span>
                    </button>
                  )}

                  {o.prereqMet === false && !inCart && !openPrereqRequest && (
                    <button
                      className="bg-white hover:bg-amber-100 text-amber-800 border border-amber-400 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                      disabled={busy || !props.term.open}
                      onClick={() => requestBypass(o.id, 'PREREQ')}
                      title="درخواست ثبت این درس بدون رعایت پیش‌نیاز؛ ظرفیت برای شما رزرو و به مدیر گروه ارجاع می‌شود"
                    >
                      <span>📝</span>
                      <span>درخواست بدون رعایت پیش‌نیاز</span>
                    </button>
                  )}

                  {openPrereqRequest && (
                    <span className="text-2xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                      ⏳ در انتظار تصمیم
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

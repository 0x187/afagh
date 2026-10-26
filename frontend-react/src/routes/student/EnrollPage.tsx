import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  CreditCard,
  ListChecks,
  Loader2,
  MapPin,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
  Users,
  Wand2,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  addToCart,
  autoFillCart,
  cancelBypass,
  clearCart,
  getEnrollPage,
  getEnrollStatus,
  getLiveCapacity,
  previewExamConflicts,
  referCouncil,
  removeFromCart,
  requestBypass,
  submitCart,
  type EnrollOffering,
  type ExamConflict,
  type SubmitResult,
} from '@/lib/enroll-api';
import { faDigits, faNumber, faRial } from '@/lib/fa';

// ═══ انتخاب واحد — پورت student/enroll (EnrollClient + actions) ═══

const CART_TTL_SECONDS = 15 * 60;

function overlaps(s1: string, e1: string, s2: string, e2: string): boolean {
  return s1.slice(0, 5) < e2.slice(0, 5) && s2.slice(0, 5) < e1.slice(0, 5);
}

function timeLabel(t: string): string {
  return faDigits(t.slice(0, 5));
}

function conflictWith(off: EnrollOffering, cart: { classSchedules: EnrollOffering['classSchedules']; examSchedule: EnrollOffering['examSchedule']; title: string; code: string }[]): string | null {
  for (const c of cart) {
    for (const a of off.classSchedules) {
      for (const b of c.classSchedules) {
        if (a.dayOfWeek != null && a.dayOfWeek === b.dayOfWeek && overlaps(a.startTime, a.endTime, b.startTime, b.endTime)) {
          return `${c.code} — ${c.title}`;
        }
      }
    }
    if (off.examSchedule && c.examSchedule && off.examSchedule.examDate === c.examSchedule.examDate) {
      if (overlaps(off.examSchedule.startTime, off.examSchedule.endTime, c.examSchedule.startTime, c.examSchedule.endTime)) {
        return `${c.code} — ${c.title}`;
      }
    }
  }
  return null;
}

export function StudentEnrollPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-enroll'],
    queryFn: getEnrollPage,
    staleTime: 20_000,
  });

  const [search, setSearch] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [onlyNoPrereqIssue, setOnlyNoPrereqIssue] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [queuePos, setQueuePos] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [acceptRisk, setAcceptRisk] = useState(false);
  const [conflicts, setConflicts] = useState<{ hard: ExamConflict[]; soft: ExamConflict[] } | null>(null);
  const [remain, setRemain] = useState(CART_TTL_SECONDS);

  const offeringIds = useMemo(() => (data?.offerings ?? []).map((o) => o.id), [data]);
  const liveQuery = useQuery({
    queryKey: ['enroll-live', offeringIds.join(',')],
    queryFn: () => getLiveCapacity(offeringIds),
    enabled: offeringIds.length > 0,
    refetchInterval: 4000,
    staleTime: 3000,
  });

  // مهلت ۱۵ دقیقه‌ای سبد (سند §۲۲۴۳)
  useEffect(() => {
    const started = data?.cartStartedAt ?? null;
    if (!started) {
      setRemain(CART_TTL_SECONDS);
      return;
    }
    const calc = () => setRemain(Math.max(0, CART_TTL_SECONDS - Math.floor((Date.now() - started) / 1000)));
    calc();
    const t = window.setInterval(calc, 1000);
    return () => window.clearInterval(t);
  }, [data?.cartStartedAt]);

  // نظرسنجی وضعیت صف
  useEffect(() => {
    if (queuePos === null) return;
    const t = window.setInterval(async () => {
      try {
        const st = await getEnrollStatus();
        if (st.state === 'WAITING' && st.position) setQueuePos(st.position);
        else if (st.state === 'PROCESSING') {
          setQueuePos(null);
          setProcessing(true);
        } else if (st.state === 'DONE' && st.result) {
          setQueuePos(null);
          setProcessing(false);
          setResult(st.result);
          await qc.invalidateQueries({ queryKey: ['student-enroll'] });
        }
      } catch {
        /* تلاش بعدی */
      }
    }, 1500);
    return () => window.clearInterval(t);
  }, [queuePos, qc]);

  const addMut = useMutation({
    mutationFn: addToCart,
    onSuccess: async () => {
      setMsg(null);
      await qc.invalidateQueries({ queryKey: ['student-enroll'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const removeMut = useMutation({
    mutationFn: removeFromCart,
    onSuccess: async () => {
      setMsg(null);
      await qc.invalidateQueries({ queryKey: ['student-enroll'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const clearMut = useMutation({
    mutationFn: clearCart,
    onSuccess: async () => {
      setMsg(null);
      setResult(null);
      await qc.invalidateQueries({ queryKey: ['student-enroll'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const autoMut = useMutation({
    mutationFn: autoFillCart,
    onSuccess: async (r) => {
      setMsg(r.message);
      await qc.invalidateQueries({ queryKey: ['student-enroll'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const bypassMut = useMutation({
    mutationFn: ({ id, kind }: { id: number; kind: 'PREREQ' | 'EXAM_CONFLICT' }) => requestBypass(id, kind),
    onSuccess: async () => {
      setMsg('درخواست بدون رعایت محدودیت ثبت شد و ظرفیت کلاس برای شما رزرو شد.');
      await qc.invalidateQueries({ queryKey: ['student-enroll'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const cancelBypassMut = useMutation({
    mutationFn: cancelBypass,
    onSuccess: async () => {
      setMsg('درخواست لغو شد.');
      await qc.invalidateQueries({ queryKey: ['student-enroll'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const referMut = useMutation({
    mutationFn: ({ id }: { id: number }) => referCouncil(id, 'خطای نرم انتخاب واحد'),
    onSuccess: async () => {
      setMsg('ارجاع به کمیسیون ثبت شد؛ نتیجه از کارتابل پیگیری می‌شود.');
      await qc.invalidateQueries({ queryKey: ['student-enroll'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const busy = addMut.isPending || removeMut.isPending || clearMut.isPending || autoMut.isPending || referMut.isPending || bypassMut.isPending;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Skeleton className="h-[60vh] w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت صفحهٔ انتخاب واحد ناموفق بود.</CardContent>
      </Card>
    );
  }

  const maxUnits = data.regulationStatus?.effectiveMaxUnits ?? (data.term.isSummer ? 6 : 20);
  const totalUnits = data.cart.reduce((s, c) => s + c.units, 0);
  const expired = data.cart.length > 0 && remain <= 0;
  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(remain % 60).padStart(2, '0');
  const cartIds = new Set(data.cart.map((c) => c.id));
  const enrolledIds = new Set(data.enrolledOfferingIds ?? []);
  const cartCourseIds = new Set(data.cart.map((c) => c.courseId));
  const isBlocked = data.student.status === 'BLOCKED_COMMISSION';
  const live = liveQuery.data ?? {};

  const filtered = data.offerings.filter((o) => {
    const q = search.trim();
    if (q && !`${o.code} ${o.title} ${o.professor}`.includes(q)) return false;
    const rem = live[String(o.id)]?.remaining ?? o.capacity - o.enrolled;
    if (onlyAvailable && rem <= 0 && o.waitlistCapacity <= 0) return false;
    if (onlyNoPrereqIssue && !o.prereqMet) return false;
    return true;
  });

  async function doSubmit(withRisk: boolean) {
    setMsg(null);
    setResult(null);
    setConflicts(null);
    setProcessing(false);
    if (totalUnits > maxUnits) {
      setMsg(`مجموع واحدهای انتخابی (${faNumber(totalUnits)} واحد) از سقف مجاز (${faNumber(maxUnits)} واحد) بیشتر است.`);
      return;
    }
    if (!withRisk) {
      try {
        const prev = await previewExamConflicts();
        if (prev.hard.length > 0 || prev.soft.length > 0) {
          setConflicts({ hard: prev.hard, soft: prev.soft });
          setAcceptRisk(false);
          return;
        }
      } catch {
        /* گارد سمت سرور همچنان محکم است */
      }
    }
    try {
      const tick = await submitCart(withRisk);
      if (tick.limited) {
        setMsg('سرعت درخواست‌ها بیش از حد مجاز است — چند لحظه صبر کنید.');
        return;
      }
      if (tick.direct && tick.result) {
        setResult(tick.result);
        await qc.invalidateQueries({ queryKey: ['student-enroll'] });
        return;
      }
      if (!tick.queued) {
        setMsg(tick.error || 'ورود به صف نامعتبر بود.');
        return;
      }
      setQueuePos(tick.position);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'خطا در ثبت');
    }
  }

  return (
    <div className="space-y-4">
      {isBlocked ? (
        <div className="space-y-2 rounded-2xl border-2 border-rose-500 bg-rose-50 p-4 text-xs text-rose-950 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">
          <p className="flex items-center gap-2 text-sm font-black">
            <AlertTriangle className="size-5" aria-hidden />
            وضعیت تحصیلی شما مسدود است (ارجاع به کمیسیون موارد خاص)
          </p>
          <p>
            ادامهٔ تحصیل و انتخاب واحد شما منوط به تأیید کمیسیون موارد خاص دانشگاه در سامانهٔ سجاد وزارت علوم است.
            پس از دریافت رأی، تصویر آن را در میز خدمات بارگذاری کنید.
          </p>
          <div className="flex flex-wrap gap-2">
            <a className="rounded-xl bg-rose-700 px-3 py-1.5 font-bold text-white" href={data.sajjadPortalUrl || 'https://portal.saorg.ir'} target="_blank" rel="noreferrer">
              ورود به سامانهٔ سجاد
            </a>
            <a className="rounded-xl bg-slate-800 px-3 py-1.5 font-bold text-white" href="/app/student/requests">
              ارسال رأی در میز خدمات
            </a>
          </div>
        </div>
      ) : null}

      {/* بنر چارت */}
      {data.curriculumScoped ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          🗺️ کاتالوگ بر اساس <b>چارت تحصیلی مصوب</b> شما
          {data.curriculumVersionLabel ? ` (نسخهٔ ${faDigits(data.curriculumVersionLabel)})` : ''}
          {data.studentTermOrdinal ? ` و ترم ${faDigits(data.studentTermOrdinal)}` : ''} فیلتر شده است؛ دروس ترم جاری و
          ترم‌های پایین‌تر نمایش داده می‌شود.
        </div>
      ) : data.curriculumRequired ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          ⚠️ <b>دانشجوی گرامی جهت تخصیص چارت دروس به مدیر گروه مراجعه کنید.</b> تا زمان انتشار چارت مصوب، فهرست
          دروس خالی است.
        </div>
      ) : (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
          ℹ️ چارت در انتخاب واحد الزامی نیست؛ کاتالوگ بر اساس هدف‌گیری رشته/ورودی هر ارائه نمایش داده می‌شود.
        </div>
      )}

      {/* نوار آیین‌نامه */}
      {data.regulationStatus ? (
        <div className="space-y-3 rounded-2xl bg-slate-900 p-4 text-white shadow">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-2">
              <p className="mb-1 text-[10px] font-bold text-indigo-300">📜 مقطع تحصیلی</p>
              <p className="text-sm font-black">{data.degreeLevelTitle || '—'}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-2">
              <p className="mb-1 text-[10px] font-bold text-indigo-300">🎯 سقف مجاز انتخاب واحد</p>
              <p className="text-sm font-black text-emerald-300">{faNumber(maxUnits)} واحد</p>
            </div>
            {data.regulationStatus.minAllowedUnits > 0 ? (
              <div className="rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-2">
                <p className="mb-1 text-[10px] font-bold text-indigo-300">⬇️ حداقل واحد این ترم</p>
                <p className="text-sm font-black">{faNumber(data.regulationStatus.minAllowedUnits)} واحد</p>
              </div>
            ) : null}
            <div className="rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-2">
              <p className="mb-1 text-[10px] font-bold text-indigo-300">📊 پیشرفت تحصیلی</p>
              <p className="font-mono text-xs font-bold text-slate-200">
                {faNumber(data.regulationStatus.passedUnits)} واحد گذرانده
                <span className="text-slate-400"> · {faNumber(data.regulationStatus.remainingUnits)} باقی</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {data.regulationStatus.isGraduating ? <Badge className="border-transparent bg-amber-500 text-slate-950">🎓 ترم آخر</Badge> : null}
            {data.regulationStatus.isProbatedLastTerm ? <Badge className="border-transparent bg-rose-600 text-white">⚠️ مشروط</Badge> : null}
            {data.regulationStatus.isHonors && !data.regulationStatus.isProbatedLastTerm ? (
              <Badge className="border-transparent bg-yellow-400 text-slate-950">⭐ شاگرد ممتاز</Badge>
            ) : null}
            {data.term.isSummer ? <Badge className="border-transparent bg-orange-600 text-white">☀️ ترم تابستان</Badge> : null}
            <Badge className={data.enrollmentOpen ? 'border-transparent bg-emerald-600 text-white' : 'border-transparent bg-rose-600 text-white'}>
              {data.enrollmentOpen ? 'پنجرهٔ انتخاب واحد باز است' : 'پنجرهٔ انتخاب واحد بسته است'}
            </Badge>
          </div>
        </div>
      ) : null}

      {/* درخواست‌های باز */}
      {data.bypassRequests.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
          <CardContent className="space-y-2 p-4">
            <p className="flex items-center gap-2 text-sm font-extrabold text-amber-950 dark:text-amber-100">
              <Clock3 className="size-4" aria-hidden /> درخواست‌های در انتظار تصمیم
            </p>
            <p className="text-[11px] text-amber-800 dark:text-amber-200">
              ظرفیت این دروس تا زمان تصمیم مدیر گروه / کارشناس آموزش برای شما رزرو شده است.
            </p>
            <div className="space-y-2">
              {data.bypassRequests.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs dark:border-amber-800 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{r.courseTitle}</b>
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                      {r.kind === 'PREREQ' ? 'بدون پیش‌نیاز' : 'تداخل امتحانی'}
                    </span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                      {r.status === 'PENDING_MANAGER' ? 'در انتظار مدیر گروه' : r.status === 'ESCALATED_EXPERT' ? 'ارجاع به کارشناس' : r.status === 'APPROVED' ? 'تأییدشده' : 'ردشده'}
                    </span>
                  </div>
                  {r.status === 'PENDING_MANAGER' || r.status === 'ESCALATED_EXPERT' ? (
                    <button type="button" className="text-[11px] font-bold text-rose-700 hover:underline" onClick={() => cancelBypassMut.mutate(r.id)}>
                      لغو درخواست
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {msg ? (
        <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground shadow-xs">{msg}</div>
      ) : null}

      {result ? (
        <Card className={result.ok ? 'border-emerald-300 dark:border-emerald-800' : 'border-rose-300 dark:border-rose-800'}>
          <CardContent className="space-y-1.5 p-4 text-xs">
            <p className="flex items-center gap-2 text-sm font-black">
              {result.ok ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> : <XCircle className="size-4 text-rose-600" aria-hidden />}
              {result.ok ? 'نتیجهٔ ثبت انتخاب واحد' : 'ثبت انتخاب واحد با خطا مواجه شد'}
            </p>
            {result.registered.length > 0 ? <p className="text-emerald-700 dark:text-emerald-300">✅ ثبت‌شده: {result.registered.join('، ')}</p> : null}
            {result.waitlisted.length > 0 ? <p className="text-amber-700 dark:text-amber-300">⏳ لیست انتظار: {result.waitlisted.join('، ')}</p> : null}
            {result.hardErrors.map((m, i) => <p key={`h${i}`} className="text-rose-700 dark:text-rose-300">⛔ {m}</p>)}
            {result.softErrors.map((s, i) => <p key={`s${i}`} className="text-amber-700 dark:text-amber-300">⚠️ {s.msg}</p>)}
            {result.droppedCart.map((d, i) => <p key={`d${i}`} className="text-muted-foreground">🗑 {d.title}: {d.reason}</p>)}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        {/* کاتالوگ */}
        <div className="space-y-3">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 p-3">
              <div className="relative min-w-48 flex-1">
                <Search className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="جست‌وجوی کد درس، نام درس یا استاد…"
                  className="pr-9"
                />
              </div>
              <button
                type="button"
                onClick={() => setOnlyAvailable((v) => !v)}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${onlyAvailable ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-border text-muted-foreground'}`}
              >
                فقط دارای ظرفیت
              </button>
              <button
                type="button"
                onClick={() => setOnlyNoPrereqIssue((v) => !v)}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${onlyNoPrereqIssue ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-border text-muted-foreground'}`}
              >
                پیش‌نیاز کامل
              </button>
              <Button size="sm" variant="outline" onClick={() => autoMut.mutate()} disabled={busy || !data.enrollmentOpen}>
                <Wand2 className="size-4" aria-hidden /> چیدمان هوشمند
              </Button>
            </CardContent>
          </Card>

          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                درسی با این فیلتر پیدا نشد.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((o) => {
                const inCart = cartIds.has(o.id);
                const isEnrolled = enrolledIds.has(o.id);
                const sameCourseInCart = cartCourseIds.has(o.courseId);
                const cap = live[String(o.id)];
                const remaining = cap?.remaining ?? o.capacity - o.enrolled;
                const full = remaining <= 0;
                const conflict = conflictWith(o, data.cart.filter((c) => c.courseId !== o.courseId));
                return (
                  <Card key={o.id} className={`overflow-hidden ${conflict ? 'border-amber-300 dark:border-amber-800' : ''}`}>
                    <CardContent className="space-y-2.5 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-bold text-secondary-foreground" dir="ltr">
                              {o.code}
                            </span>
                            <Badge variant="outline" className="text-[10px]">گروه {faDigits(o.group)}</Badge>
                            <Badge variant="outline" className="text-[10px]">{faDigits(o.units)} واحد</Badge>
                            {o.offeringType !== 'NORMAL' ? <Badge className="border-transparent bg-violet-100 text-violet-800 text-[10px]">{o.offeringType}</Badge> : null}
                          </div>
                          <h3 className="mt-1 truncate text-sm font-black">{o.title}</h3>
                          <p className="text-[11px] text-muted-foreground">استاد: {o.professor}</p>
                        </div>
                        <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${full ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'}`}>
                          <Users className="size-4" aria-hidden />
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {o.classSchedules.map((c, i) => (
                          <span key={i} className="flex items-center gap-1">
                            <MapPin className="size-3" aria-hidden />
                            {c.dayName} {timeLabel(c.startTime)}–{timeLabel(c.endTime)}
                            {c.room ? ` · ${c.room}` : ''}
                          </span>
                        ))}
                        {o.examSchedule ? (
                          <span className="flex items-center gap-1">
                            <BookOpenCheck className="size-3" aria-hidden />
                            امتحان: {faDigits(o.examSchedule.examDate.replace(/-/g, '/'))} {timeLabel(o.examSchedule.startTime)}
                          </span>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2 text-[11px]">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={`h-full rounded-full ${full ? 'bg-rose-500' : remaining / Math.max(1, cap?.cap ?? o.capacity) < 0.2 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, Math.round((((cap?.enrolled ?? o.enrolled) || 0) / Math.max(1, cap?.cap ?? o.capacity)) * 100))}%` }}
                          />
                        </div>
                        <span className={full ? 'font-bold text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}>
                          {full
                            ? o.waitlistCapacity > 0
                              ? `تکمیل — لیست انتظار (${faDigits(o.waitlistCapacity)} نفر)`
                              : 'ظرفیت تکمیل'
                            : `${faNumber(remaining)} از ${faNumber(cap?.cap ?? o.capacity)} جای خالی`}
                        </span>
                      </div>

                      {o.prereq ? (
                        <p className={`flex items-start gap-1 text-[11px] ${o.prereqMet ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                          {o.prereqMet ? <CheckCircle2 className="mt-0.5 size-3 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />}
                          پیش‌نیاز: {o.prereq}
                        </p>
                      ) : null}

                      {conflict ? (
                        <p className="flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="size-3" aria-hidden /> تداخل زمانی با {conflict}
                        </p>
                      ) : null}

                      {o.tuitionTotal > 0 ? (
                        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CreditCard className="size-3" aria-hidden /> شهریهٔ برآوردی: {faRial(o.tuitionTotal)}
                        </p>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          className="flex-1"
                          variant={inCart || isEnrolled ? 'secondary' : 'default'}
                          disabled={busy || !data.enrollmentOpen || inCart || isEnrolled}
                          onClick={() => addMut.mutate(o.id)}
                        >
                          {isEnrolled ? 'ثبت‌شده ✓' : inCart ? 'در سبد' : sameCourseInCart ? 'تغییر گروه' : 'افزودن به سبد'}
                        </Button>
                        {!o.prereqMet ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || !data.enrollmentOpen}
                            onClick={() => bypassMut.mutate({ id: o.id, kind: 'PREREQ' })}
                          >
                            درخواست بدون پیش‌نیاز
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* سبد */}
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader className="flex-row items-center justify-between border-b border-border/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShoppingCart className="size-4 text-primary" aria-hidden />
                سبد انتخاب واحد
                <Badge variant="secondary">{faDigits(data.cart.length)}</Badge>
              </CardTitle>
              <span className={`font-mono text-xs font-bold ${expired ? 'text-rose-600' : 'text-muted-foreground'}`} dir="ltr">
                {faDigits(mm)}:{faDigits(ss)}
              </span>
            </CardHeader>
            <CardContent className="space-y-3 pt-3">
              {data.cart.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">سبد خالی است. از کاتالوگ درس اضافه کنید.</p>
              ) : (
                <ul className="space-y-2">
                  {data.cart.map((c) => (
                    <li key={c.id} className="rounded-xl border border-border bg-muted/40 p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold">{c.title}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {c.code} · گروه {faDigits(c.group)} · {faDigits(c.units)} واحد
                          </p>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {c.classSchedules.map((s) => `${s.dayName} ${timeLabel(s.startTime)}`).join('، ') || 'بدون زمان‌بندی'}
                          </p>
                        </div>
                        <button
                          type="button"
                          title="حذف از سبد"
                          aria-label={`حذف ${c.title}`}
                          disabled={removeMut.isPending}
                          onClick={() => removeMut.mutate(c.id)}
                          className="rounded-md p-1 text-muted-foreground transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2 text-xs font-bold">
                <span>مجموع واحدها</span>
                <span className={totalUnits > maxUnits ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-300'}>
                  {faNumber(totalUnits)} / {faNumber(maxUnits)}
                </span>
              </div>

              {queuePos !== null || processing ? (
                <div className="flex items-center gap-2 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-[11px] text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {processing ? 'در حال پردازش ثبت نهایی…' : `در صف پردازش — نوبت شما: ${faNumber(queuePos ?? 0)}`}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" disabled={busy || data.cart.length === 0} onClick={() => clearMut.mutate()}>
                  <Trash2 className="size-4" aria-hidden /> خالی کردن
                </Button>
                <Button size="sm" variant="outline" disabled={busy || !data.enrollmentOpen} onClick={() => autoMut.mutate()}>
                  <Sparkles className="size-4" aria-hidden /> چیدمان
                </Button>
              </div>
              <Button
                className="w-full"
                disabled={busy || data.cart.length === 0 || !data.enrollmentOpen || totalUnits > maxUnits || expired || queuePos !== null || processing}
                onClick={() => doSubmit(false)}
              >
                <ListChecks className="size-4" aria-hidden />
                ثبت نهایی انتخاب واحد
              </Button>
              {expired ? <p className="text-center text-[10px] text-rose-600">مهلت ۱۵ دقیقه‌ای سبد پایان یافته — سبد را دوباره بچینید.</p> : null}
              {!data.enrollmentOpen ? <p className="text-center text-[10px] text-rose-600">پنجرهٔ انتخاب واحد بسته است.</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* مودال تداخل امتحانی */}
      {conflicts ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg space-y-3 rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <h3 className="flex items-center gap-2 text-sm font-black">
              <AlertTriangle className="size-5 text-amber-500" aria-hidden />
              تداخل امتحانی سبد شما
            </h3>
            {conflicts.hard.length > 0 ? (
              <div className="space-y-1 rounded-xl border border-rose-300 bg-rose-50 p-3 text-[11px] text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100">
                <p className="font-bold">تداخل قطعی (همان روز و همان ساعت) — ثبت این دروس ممکن نیست:</p>
                {conflicts.hard.map((c, i) => (
                  <p key={i}>{c.title} ({c.courseCode}) با {c.withCourse} در {faDigits(c.examDate.replace(/-/g, '/'))} ساعت {timeLabel(c.startTime)}</p>
                ))}
                <div className="flex flex-wrap gap-2 pt-1">
                  {conflicts.hard.map((c, i) => (
                    <Button key={i} size="sm" variant="outline" onClick={() => referMut.mutate({ id: c.offeringId })} disabled={referMut.isPending}>
                      ارجاع {c.courseCode} به کمیسیون
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            {conflicts.soft.length > 0 ? (
              <div className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                <p className="font-bold">تداخل نرم (همان روز، ساعت متفاوت) — با تأیید عواقب قابل ثبت است:</p>
                {conflicts.soft.map((c, i) => (
                  <p key={i}>{c.title} ({c.courseCode}) با {c.withCourse} در {faDigits(c.examDate.replace(/-/g, '/'))} ساعت {timeLabel(c.startTime)}</p>
                ))}
                <label className="mt-1 flex items-center gap-2 font-bold">
                  <input type="checkbox" checked={acceptRisk} onChange={(e) => setAcceptRisk(e.target.checked)} />
                  عواقب ناشی از تداخل امتحانی را می‌پذیرم.
                </label>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setConflicts(null)}>بستن</Button>
              {conflicts.hard.length === 0 && conflicts.soft.length > 0 ? (
                <Button size="sm" disabled={!acceptRisk} onClick={() => doSubmit(true)}>
                  ثبت با پذیرش عواقب
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

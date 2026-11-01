import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, GraduationCap, Send, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber, faRial } from '@/lib/fa';
import {
  getChannels,
  getTracker,
  saveChannel,
  submitSajjad,
  uploadGraduationPhoto,
} from '@/lib/student-api';

// ═══ Student graduation tracker — port of student/graduation ═══

const STEP_STATE = {
  DONE: { icon: '✅', cls: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800' },
  CURRENT: { icon: '⏳', cls: 'bg-amber-50 border-amber-300 dark:bg-amber-950/40 dark:border-amber-800' },
  TODO: { icon: '⚪', cls: 'bg-card border-border' },
} as const;

const CLEAR_LABEL: Record<string, string> = {
  PENDING: 'در انتظار بررسی',
  CLEARED: 'تسویه شد',
  HAS_DEBT: 'بدهی/امانت باز',
  WAIVED: 'معاف',
};

const CLEAR_ICON: Record<string, string> = { PENDING: '⏳', CLEARED: '✅', HAS_DEBT: '⛔', WAIVED: '➖' };

const DEGREE_LABEL: Record<string, string> = {
  TEMPORARY: 'گواهینامهٔ موقت',
  PERMANENT: 'دانشنامهٔ اصلی',
  TRANSCRIPT: 'ریزنمرات رسمی',
};

const CHANNEL_LABEL: Record<string, string> = {
  INAPP: 'پیام درون‌سامانه',
  SMS: 'پیامک',
  TELEGRAM: 'تلگرام',
  BALE: 'بله',
  EITAA: 'ایتا',
};

function ChannelsCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['student-channels'], queryFn: getChannels, staleTime: 60_000 });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const saveMut = useMutation({
    mutationFn: ({ channel, address }: { channel: string; address: string }) => saveChannel(channel, address),
    onSuccess: async () => {
      setNote('نشانی ذخیره شد.');
      await qc.invalidateQueries({ queryKey: ['student-channels'] });
    },
    onError: (e: Error) => setNote(e.message),
  });

  useEffect(() => {
    if (!data) return;
    setDraft(Object.fromEntries(data.mine.map((m) => [m.channel, m.address])));
  }, [data]);

  const externals = (data?.active ?? []).filter((c) => c !== 'INAPP');
  if (externals.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <h2 className="text-sm font-black">اطلاع‌رسانی مراحل فارغ‌التحصیلی</h2>
        <p className="text-[11px] text-muted-foreground">
          رویدادهای پرونده علاوه بر پیام درون‌سامانه‌ای از این کانال‌ها هم ارسال می‌شود.
        </p>
        {externals.map((ch) => (
          <div key={ch} className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-[11px] font-black">{CHANNEL_LABEL[ch] ?? ch}</span>
            <Input
              value={draft[ch] ?? ''}
              onChange={(e) => setDraft((prev) => ({ ...prev, [ch]: e.target.value }))}
              placeholder={ch === 'SMS' ? '۰۹xxxxxxxxx' : 'نشانی'}
              className="h-8 max-w-64 text-xs"
            />
            <Button size="sm" variant="outline" disabled={saveMut.isPending} onClick={() => saveMut.mutate({ channel: ch, address: draft[ch] ?? '' })}>
              ذخیره
            </Button>
          </div>
        ))}
        {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border-0 bg-gradient-to-l from-indigo-700 to-sky-700 p-5 text-white shadow-md">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15">
        <GraduationCap className="size-5" aria-hidden />
      </span>
      <div>
        <h1 className="text-base font-black">فارغ‌التحصیلی من</h1>
        <p className="mt-0.5 text-xs text-white/80">پیگیری خودکار پرونده، تسویه‌حساب و صدور مدرک</p>
      </div>
    </div>
  );
}

export function StudentGraduationPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['student-tracker'], queryFn: getTracker, staleTime: 30_000 });
  const [msg, setMsg] = useState<string | null>(null);
  const [sajjadCode, setSajjadCode] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const sajjadMut = useMutation({
    mutationFn: ({ auditId, code }: { auditId: number; code: string }) => submitSajjad(auditId, code),
    onSuccess: async () => {
      setMsg('کد رهگیری سجاد ثبت شد؛ پرونده به مرحلهٔ بعد رفت.');
      setSajjadCode('');
      await qc.invalidateQueries({ queryKey: ['student-tracker'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const photoMut = useMutation({
    mutationFn: ({ auditId, file }: { auditId: number; file: File }) => uploadGraduationPhoto(auditId, file),
    onSuccess: async () => {
      setMsg('عکس شما ثبت شد.');
      await qc.invalidateQueries({ queryKey: ['student-tracker'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت وضعیت فارغ‌التحصیلی ناموفق بود.</CardContent></Card>;
  }

  if (!data.open) {
    const a = data.audit;
    return (
      <div className="space-y-4">
        <Header />
        <Card>
          <CardContent className="space-y-3 p-5">
            <h2 className="text-sm font-black">وضعیت فعلی شما: در حال تحصیل</h2>
            <p className="text-xs leading-6 text-muted-foreground">
              نیازی به ثبت درخواست نیست. به‌محض قطعی‌شدن آخرین نمره، سامانه سرفصل را با کارنامه تطبیق می‌دهد و در صورت
              تکمیل، پروندهٔ فارغ‌التحصیلی خودکار باز می‌شود.
            </p>
            {a ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ['واحد گذرانده', faNumber(a.passedUnits)],
                    ['حداقل واحد لازم', faNumber(a.requiredUnits)],
                    ['معدل کل', a.gpa == null ? '—' : faNumber(a.gpa)],
                    ['تطبیق سرفصل', a.catalogOk ? 'کامل ✅' : 'ناقص ⏳'],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-border bg-muted/40 p-2.5">
                      <div className="text-[10px] font-bold text-muted-foreground">{k}</div>
                      <div className="mt-0.5 font-mono text-sm font-black">{v}</div>
                    </div>
                  ))}
                </div>
                {a.missing.length > 0 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/40">
                    <b className="text-amber-800 dark:text-amber-200">دروس باقی‌مانده تا فراغت:</b>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-900 dark:text-amber-100">
                      {a.missing.map((c) => (
                        <li key={c.code}>{c.title} — {faNumber(c.units)} واحد ({c.code})</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {a.reasons.length > 0 ? (
                  <ul className="list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                    {a.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
        <ChannelsCard />
      </div>
    );
  }

  const d = data.dossier!;
  const audit = d.audit;
  const steps = data.steps ?? [];
  const doneCount = steps.filter((s) => s.state === 'DONE').length;
  const percent = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;
  const needPhoto = data.needPhoto && audit.photoDocumentId == null;
  const needFee = audit.stampFeeAmount > 0 && audit.stampFeePaid === 0;

  return (
    <div className="space-y-4">
      <Header />
      {msg ? (
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs shadow-xs">{msg}</div>
      ) : null}

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black">پیشرفت پروندهٔ شما</h2>
            <span className="text-xs font-black text-emerald-700 dark:text-emerald-300">{faNumber(percent)}٪</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-gradient-to-l from-emerald-500 to-teal-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <ol className="space-y-2">
            {steps.map((s) => {
              const st = STEP_STATE[s.state] ?? STEP_STATE.TODO;
              return (
                <li key={s.code} className={`flex items-start gap-3 rounded-xl border p-2 ${st.cls}`}>
                  <span>{st.icon}</span>
                  <div>
                    <div className="text-xs font-black">{s.title}</div>
                    <div className="text-[10px] text-muted-foreground">مسئول این مرحله: {s.actor}</div>
                  </div>
                </li>
              );
            })}
          </ol>
          {audit.workflowStatus === 'ON_HOLD' ? (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-black text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
              <TriangleAlert className="size-4" aria-hidden /> پروندهٔ شما موقتاً متوقف شده است: {audit.note ?? '—'}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {d.checklist.length > 0 ? (
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-black">تسویه‌حساب واحدها (هم‌زمان)</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {d.checklist.map((c) => (
                <div key={c.id} className="rounded-xl border border-border bg-card p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black">{c.title}</span>
                    <span>{CLEAR_ICON[c.status] ?? '⏳'}</span>
                  </div>
                  <div className="text-[10px] font-bold text-muted-foreground">
                    {CLEAR_LABEL[c.status] ?? c.status}{c.autoChecked ? ' — بررسی خودکار سیستم' : ''}
                  </div>
                  {c.amountDue > 0 ? <div className="text-[10px] font-black text-rose-700 dark:text-rose-300">بدهی: {faRial(c.amountDue)}</div> : null}
                  {c.detail ? <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{c.detail}</div> : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {data.needSajjad ? (
        <Card className="border-2 border-indigo-300 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/30">
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-black text-indigo-900 dark:text-indigo-100">اقدام لازم: ثبت درخواست «کد صحت» در سامانهٔ سجاد</h2>
            <p className="text-xs leading-6 text-indigo-900 dark:text-indigo-100">
              همهٔ امضاها و تسویه‌حساب‌ها کامل شد. پیش از ارجاع پرونده به کارشناس صدور مدرک، در سامانهٔ سجاد درخواست
              «تأیید مدرک / کد صحت» ثبت کنید و کد رهگیری را اینجا وارد نمایید.
            </p>
            <a href={data.sajjadPortal} target="_blank" rel="noreferrer" className="inline-block rounded-lg bg-indigo-800 px-3 py-1.5 text-xs font-black text-white">
              ورود به سامانهٔ سجاد ↗
            </a>
            <div className="flex flex-wrap items-center gap-2">
              <Input value={sajjadCode} onChange={(e) => setSajjadCode(e.target.value)} placeholder="کد رهگیری درخواست سجاد" className="h-8 max-w-64 text-xs" />
              <Button size="sm" disabled={sajjadMut.isPending || sajjadCode.trim().length < 4} onClick={() => sajjadMut.mutate({ auditId: audit.id, code: sajjadCode })}>
                <Send className="size-4" aria-hidden /> ثبت و ادامه
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {audit.sajjadRequestCode ? (
        <p className="rounded-xl border border-border bg-card px-3 py-2 text-[11px] font-bold text-muted-foreground">
          کد رهگیری سجاد ثبت‌شده: <span className="font-mono text-foreground">{audit.sajjadRequestCode}</span>
          {audit.sajjadStatus === 'CONFIRMED' ? ' — کد صحت از وزارت علوم دریافت شد ✅' : ' — در انتظار دریافت کد صحت'}
        </p>
      ) : null}

      {needPhoto || needFee ? (
        <Card className="border-2 border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-black text-amber-900 dark:text-amber-100">اقدام لازم از سوی شما</h2>
            {needPhoto ? (
              <div className="space-y-2">
                <p className="text-xs font-bold text-amber-900 dark:text-amber-100">بارگذاری عکس ۴×۳ جدید (پس‌زمینهٔ روشن، JPG یا PNG)</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={fileRef} type="file" accept="image/*" className="text-[11px]" />
                  <Button
                    size="sm"
                    disabled={photoMut.isPending}
                    onClick={() => {
                      const f = fileRef.current?.files?.[0];
                      if (!f) {
                        setMsg('ابتدا فایل عکس را انتخاب کنید.');
                        return;
                      }
                      photoMut.mutate({ auditId: audit.id, file: f });
                    }}
                  >
                    <Camera className="size-4" aria-hidden /> بارگذاری عکس
                  </Button>
                </div>
              </div>
            ) : null}
            {needFee ? (
              <div className="space-y-1">
                <p className="text-xs font-bold text-amber-900 dark:text-amber-100">پرداخت هزینهٔ تمبر ابطال: {faRial(audit.stampFeeAmount)}</p>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  مبلغ را به واحد مالی پرداخت کنید؛ پس از تأیید کارشناس مالی، وضعیت این بند خودکار «تسویه‌شده» می‌شود.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <ChannelsCard />

      {d.degrees.length > 0 ? (
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-black">مدارک صادرشده</h2>
            <div className="space-y-2">
              {d.degrees.map((g) => (
                <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-2.5">
                  <div>
                    <div className="text-xs font-black">{DEGREE_LABEL[g.degreeType] ?? g.degreeType}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">سریال: {g.serialNo}</div>
                  </div>
                  <a href={`/verify-degree/${g.verifyCode}`} target="_blank" rel="noreferrer" className="rounded-lg bg-secondary px-3 py-1.5 text-[11px] font-black">
                    استعلام/مشاهده
                  </a>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              پس از صدور مدرک، حساب شما به پورتال دانش‌آموختگان منتقل می‌شود.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {doneCount === steps.length && steps.length > 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          <CheckCircle2 className="size-4" aria-hidden /> همهٔ مراحل پرونده تکمیل شده است.
        </div>
      ) : null}
    </div>
  );
}

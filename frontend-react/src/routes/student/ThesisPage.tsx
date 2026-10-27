import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, GraduationCap, Send, Timer } from 'lucide-react';
import { useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  getThesis,
  requestThesisDefense,
  submitThesisTitle,
  uploadThesisFile,
} from '@/lib/student-api';

// ═══ پایان‌نامه و پروپوزال دانشجو — پورت student/thesis-proposal ═══

const PROPOSAL_FA: Record<string, string> = {
  NOT_STARTED: 'شروع نشده',
  PRIOR_REJECTED: 'رد پیشینهٔ ایرانداک',
  SIMILARITY_PASSED: 'در انتظار تأیید کارشناس',
  SIMILARITY_HIGH: 'همانندجویی بالا',
  EXPERT_REVIEW: 'در حال بررسی کارشناس',
  APPROVED: 'تأییدشده',
  REJECTED: 'ردشده',
};

const DEFENSE_FA: Record<string, string> = {
  NOT_REQUESTED: 'درخواست نشده',
  SUPERVISOR_REVIEW: 'در انتظار تأیید استاد راهنما',
  SUPERVISOR_REJECTED: 'ردشده توسط راهنما',
  SCHEDULED: 'زمان‌بندی‌شده',
  PASSED: 'دفاع موفق',
  FAILED: 'دفاع ناموفق',
};

const FINAL_FA: Record<string, string> = {
  PENDING: 'در انتظار بررسی نهایی',
  PASSED: 'تأیید نهایی',
  REJECTED: 'رد نهایی',
};

function faDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  } catch {
    return faDigits(value.slice(0, 10));
  }
}

export function StudentThesisPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['student-thesis'], queryFn: getThesis, staleTime: 30_000 });
  const [msg, setMsg] = useState<string | null>(null);
  const [supervisorID, setSupervisorID] = useState('');
  const [titleFa, setTitleFa] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [keywords, setKeywords] = useState('');
  const [abstract, setAbstract] = useState('');
  const [loaded, setLoaded] = useState(false);
  const proposalRef = useRef<HTMLInputElement>(null);
  const finalRef = useRef<HTMLInputElement>(null);

  if (data && !loaded) {
    setLoaded(true);
    setTitleFa(data.progress?.titleFa ?? '');
    setTitleEn(data.progress?.titleEn ?? '');
    setKeywords(data.progress?.keywords ?? '');
    setAbstract(data.progress?.abstract ?? '');
    setSupervisorID(data.progress?.supervisorId ? String(data.progress.supervisorId) : '');
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['student-thesis'] });

  const titleMut = useMutation({
    mutationFn: () =>
      submitThesisTitle({
        auditId: data!.auditId!,
        supervisorId: Number(supervisorID),
        titleFa,
        titleEn,
        keywords,
        abstract,
      }),
    onSuccess: async () => {
      setMsg('عنوان و استاد راهنما ثبت شد.');
      await invalidate();
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const uploadMut = useMutation({
    mutationFn: ({ kind, file }: { kind: 'proposal' | 'final'; file: File }) => uploadThesisFile(kind, data!.auditId!, file),
    onSuccess: async (_r, vars) => {
      setMsg(vars.kind === 'proposal' ? 'پروپوزال بارگذاری شد.' : 'پایان‌نامهٔ نهایی بارگذاری شد.');
      await invalidate();
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const defenseMut = useMutation({
    mutationFn: () => requestThesisDefense(data!.auditId!),
    onSuccess: async () => {
      setMsg('درخواست دفاع ثبت و برای استاد راهنما ارسال شد.');
      await invalidate();
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت اطلاعات پایان‌نامه ناموفق بود.</CardContent></Card>;
  }

  const header = (
    <div className="flex items-center gap-3 rounded-2xl border-0 bg-gradient-to-l from-emerald-700 to-teal-800 p-5 text-white shadow-md">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15">
        <GraduationCap className="size-5" aria-hidden />
      </span>
      <div>
        <h1 className="text-base font-black">پایان‌نامه و پروپوزال من</h1>
        <p className="mt-0.5 text-xs text-emerald-100">
          مقطع: {data.degreeTitle ?? '—'} · دانشجو: {data.student.name} ({faDigits(data.student.studentCode)})
        </p>
      </div>
    </div>
  );

  if (!data.inTrack) {
    return (
      <div className="space-y-3">
        {header}
        <Card>
          <CardContent className="space-y-2 p-5 text-xs leading-6 text-muted-foreground">
            <p>
              در مقطع تحصیلی شما (<b>{data.degreeTitle ?? '—'}</b>) پایان‌نامه و پروپوزال وجود ندارد؛ بنابراین چرخهٔ
              عنوان، پروپوزال و دفاع برای شما فعال نیست.
            </p>
            <p>پیگیری وضعیت تحصیلی و تسویه‌حساب از بخش «فارغ‌التحصیلی من» انجام می‌شود.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data.open) {
    const a = data.audit;
    const ratio = a && a.requiredUnits > 0 ? Math.min(100, Math.round((a.passedUnits / a.requiredUnits) * 100)) : 0;
    return (
      <div className="space-y-3">
        {header}
        <Card>
          <CardContent className="space-y-3 p-5 text-xs leading-6">
            <p>
              شما در مقطع <b>{data.degreeTitle ?? 'تحصیلات تکمیلی'}</b> تحصیل می‌کنید و پایان‌نامه برای شما الزامی است.
              چرخهٔ پایان‌نامه از زمانی فعال می‌شود که پروندهٔ فارغ‌التحصیلی شما باز شود.
            </p>
            {a ? (
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold">پیشرفت سرفصل</span>
                  <span className="font-mono">{faNumber(a.passedUnits)} از {faNumber(a.requiredUnits)} واحد</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-emerald-600" style={{ width: `${ratio}%` }} />
                </div>
              </div>
            ) : null}
            <p className="text-[11px] text-muted-foreground">پیگیری لحظه‌ای وضعیت فارغ‌التحصیلی از بخش «فارغ‌التحصیلی من».</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const p = data.progress;
  const hasTitle = !!p?.titleFa;
  const hasProposal = !!p?.proposalFileId;
  const proposalApproved = p?.proposalStatus === 'APPROVED';
  const irandocUploaded = p?.irandocUploadStatus === 'UPLOADED';
  const canRequestDefense = proposalApproved && irandocUploaded &&
    (p?.defenseRequestStatus === 'NOT_REQUESTED' || p?.defenseRequestStatus === 'SUPERVISOR_REJECTED');
  const defensePassed = p?.defenseRequestStatus === 'PASSED';

  return (
    <div className="space-y-4">
      {header}
      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs shadow-xs">{msg}</div> : null}

      <div className="grid gap-2 sm:grid-cols-3">
        {[
          ['وضعیت پروپوزال', p?.proposalStatus ? PROPOSAL_FA[p.proposalStatus] ?? p.proposalStatus : 'شروع نشده'],
          ['وضعیت دفاع', p?.defenseRequestStatus ? DEFENSE_FA[p.defenseRequestStatus] ?? p.defenseRequestStatus : 'درخواست نشده'],
          ['بررسی نهایی', p?.finalIrandocStatus ? FINAL_FA[p.finalIrandocStatus] ?? p.finalIrandocStatus : '—'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border bg-card p-3">
            <div className="text-[10px] font-bold text-muted-foreground">{k}</div>
            <div className="mt-0.5 text-xs font-black">{v}</div>
          </div>
        ))}
      </div>

      {!hasTitle || p?.proposalStatus === 'PRIOR_REJECTED' ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-black">فاز ۱ — ثبت عنوان و استاد راهنما</h2>
            {p?.proposalStatus === 'PRIOR_REJECTED' ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                پیشینهٔ ایرانداک رد شده است؛ عنوان را اصلاح و دوباره ثبت کنید.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="supervisor">استاد راهنما</Label>
                <select
                  id="supervisor"
                  value={supervisorID}
                  onChange={(e) => setSupervisorID(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                >
                  <option value="">— انتخاب کنید —</option>
                  {data.staffList.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}{s.rank ? ` (${s.rank})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="titleEn">عنوان انگلیسی (اختیاری)</Label>
                <Input id="titleEn" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className="mt-1" dir="ltr" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="titleFa">عنوان فارسی پایان‌نامه</Label>
                <Input id="titleFa" value={titleFa} onChange={(e) => setTitleFa(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="keywords">کلیدواژه‌ها</Label>
                <Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} className="mt-1" placeholder="با ویرگول جدا کنید" />
              </div>
              <div>
                <Label htmlFor="abstract">چکیده (اختیاری)</Label>
                <Input id="abstract" value={abstract} onChange={(e) => setAbstract(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" disabled={titleMut.isPending || !supervisorID || titleFa.trim().length < 3} onClick={() => titleMut.mutate()}>
                <Send className="size-4" aria-hidden /> ثبت عنوان
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-1.5 p-4 text-xs">
            <p><b>عنوان ثبت‌شده:</b> {p?.titleFa}</p>
            {p?.titleEn ? <p className="font-mono text-[11px] text-muted-foreground" dir="ltr">{p.titleEn}</p> : null}
            {p?.keywords ? <p className="text-[11px] text-muted-foreground">کلیدواژه‌ها: {p.keywords}</p> : null}
            {p?.supervisorId ? (
              <p className="text-[11px] text-muted-foreground">
                استاد راهنما: {data.staffList.find((s) => s.id === p.supervisorId)?.name ?? `#${p.supervisorId}`}
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      {hasTitle ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="flex items-center gap-2 text-sm font-black"><FileUp className="size-4" aria-hidden /> فاز ۲ — بارگذاری پروپوزال</h2>
            {hasProposal ? (
              <div className="space-y-1 text-xs">
                <p className="text-emerald-700 dark:text-emerald-300">✓ پروپوزال بارگذاری شده است ({faDate(p?.proposalSubmittedAt ?? null)}).</p>
                <p>وضعیت: <Badge variant="secondary">{p?.proposalStatus ? PROPOSAL_FA[p.proposalStatus] ?? p.proposalStatus : '—'}</Badge></p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input ref={proposalRef} type="file" accept="application/pdf,image/*" className="text-[11px]" />
                <Button
                  size="sm"
                  disabled={uploadMut.isPending}
                  onClick={() => {
                    const f = proposalRef.current?.files?.[0];
                    if (!f) {
                      setMsg('ابتدا فایل پروپوزال را انتخاب کنید.');
                      return;
                    }
                    uploadMut.mutate({ kind: 'proposal', file: f });
                  }}
                >
                  <FileUp className="size-4" aria-hidden /> بارگذاری پروپوزال
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-sm font-black"><Timer className="size-4" aria-hidden /> فاز ۳ — دفاع</h2>
          {canRequestDefense ? (
            <Button size="sm" disabled={defenseMut.isPending} onClick={() => defenseMut.mutate()}>
              <Send className="size-4" aria-hidden /> ثبت درخواست دفاع
            </Button>
          ) : defensePassed ? (
            <div className="space-y-2">
              <p className="text-xs text-emerald-700 dark:text-emerald-300">✓ دفاع با موفقیت انجام شده است.</p>
              {p?.finalThesisFileId ? (
                <p className="text-xs">پایان‌نامهٔ نهایی بارگذاری شده است ({faDate(p.finalThesisSubmittedAt ?? null)}).</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={finalRef} type="file" accept="application/pdf,image/*" className="text-[11px]" />
                  <Button
                    size="sm"
                    disabled={uploadMut.isPending}
                    onClick={() => {
                      const f = finalRef.current?.files?.[0];
                      if (!f) {
                        setMsg('ابتدا فایل پایان‌نامه را انتخاب کنید.');
                        return;
                      }
                      uploadMut.mutate({ kind: 'final', file: f });
                    }}
                  >
                    <FileUp className="size-4" aria-hidden /> بارگذاری پایان‌نامهٔ نهایی
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] leading-5 text-muted-foreground">
              درخواست دفاع پس از تأیید پروپوزال توسط کارشناس آموزش و آپلود آن در ایرانداک فعال می‌شود. وضعیت فعلی:{' '}
              <b>{p?.defenseRequestStatus ? DEFENSE_FA[p.defenseRequestStatus] ?? p.defenseRequestStatus : 'درخواست نشده'}</b>
            </p>
          )}
          {p?.defenseScheduledAt ? (
            <p className="text-[11px] text-muted-foreground">زمان دفاع: {faDate(p.defenseScheduledAt)}</p>
          ) : null}
          {p?.defenseResult ? <p className="text-[11px] text-muted-foreground">نتیجه: {p.defenseResult}</p> : null}
        </CardContent>
      </Card>

      {data.logs.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <h2 className="text-sm font-black">سوابق همانندجویی</h2>
            <table className="w-full border-collapse text-right text-[11px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="p-1.5">نوع</th>
                  <th className="p-1.5">کد رهگیری</th>
                  <th className="p-1.5 text-center">مشابهت</th>
                  <th className="p-1.5">تصمیم</th>
                  <th className="p-1.5 text-center">تاریخ</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((l) => (
                  <tr key={l.id} className="border-b border-border/50 last:border-0">
                    <td className="p-1.5">{l.checkType}</td>
                    <td className="p-1.5 font-mono text-[10px]" dir="ltr">{l.trackingCode ?? '—'}</td>
                    <td className="p-1.5 text-center">{l.similarityPercentage == null ? '—' : `${faNumber(l.similarityPercentage)}٪`}</td>
                    <td className="p-1.5">{l.decision ?? '—'}</td>
                    <td className="p-1.5 text-center">{faDate(l.checkedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

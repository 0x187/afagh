import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Lock, LockOpen, Save, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  finalizeGrades,
  getGrades,
  requestGradeFinalizeOTP,
  requestUnfinalize,
  resolveAppeal,
  saveGrade,
  submitGradesTemporary,
  type GradeOffering,
  type GradeStudent,
} from '@/lib/professor-api';

// ═══ دفترچهٔ نمرات استاد — پورت professor/grades ═══

const STATUS_FA: Record<string, string> = {
  PENDING: 'بدون نمره',
  DRAFT: 'پیش‌نویس',
  TEMPORARY: 'موقت',
  FINALIZED: 'نهایی',
  APPEALED: 'اعتراض',
};

const FIELDS = [
  { key: 'midterm', label: 'میان‌ترم', rubric: 'midterm' },
  { key: 'homework', label: 'تکالیف', rubric: 'homework' },
  { key: 'participation', label: 'فعالیت', rubric: 'participation' },
  { key: 'practical', label: 'عملی', rubric: 'practical' },
  { key: 'finalExam', label: 'پایان‌ترم', rubric: 'finalExam' },
] as const;

type Components = Record<string, number | undefined>;

function storageKey(offeringId: number, studentId: number) {
  return `afagh.grades.${offeringId}.${studentId}`;
}

function loadComponents(offeringId: number, studentId: number): Components {
  try {
    const raw = localStorage.getItem(storageKey(offeringId, studentId));
    return raw ? (JSON.parse(raw) as Components) : {};
  } catch {
    return {};
  }
}

function StudentRow({
  offering,
  student,
  disabled,
  onSave,
}: {
  offering: GradeOffering;
  student: GradeStudent;
  disabled: boolean;
  onSave: (value: number | null) => void;
}) {
  const [value, setValue] = useState(student.gradeValue == null ? '' : String(student.gradeValue));
  const [open, setOpen] = useState(false);
  const [components, setComponents] = useState<Components>(() => loadComponents(offering.id, student.studentId));

  useEffect(() => {
    setValue(student.gradeValue == null ? '' : String(student.gradeValue));
  }, [student.gradeValue]);

  const total = useMemo(() => {
    let sum = 0;
    let seen = false;
    for (const f of FIELDS) {
      const v = components[f.key];
      if (v === undefined || Number.isNaN(v)) continue;
      const cap = (offering.rubric as unknown as Record<string, number>)[f.rubric] ?? 20;
      sum += Math.min(Math.max(0, v), cap);
      seen = true;
    }
    return seen ? Math.min(20, Math.round(sum * 100) / 100) : null;
  }, [components, offering.rubric]);

  function commit() {
    const raw = value.trim();
    if (raw === '') {
      onSave(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 20) return;
    onSave(Math.round(n * 100) / 100);
  }

  return (
    <>
      <tr className="border-b border-border/50 last:border-0">
        <td className="p-2 font-mono text-[10px] text-muted-foreground" dir="ltr">{student.studentCode}</td>
        <td className="p-2 font-semibold">{student.fullName}</td>
        <td className="p-2 text-center">
          <Input
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            className="mx-auto h-8 w-20 text-center font-mono"
            placeholder="—"
            inputMode="decimal"
          />
        </td>
        <td className="p-2 text-center">
          <Badge variant={student.status === 'FINALIZED' ? 'default' : 'secondary'} className="text-[10px]">
            {STATUS_FA[student.status] ?? student.status}
          </Badge>
        </td>
        <td className="p-2 text-center">
          <button type="button" className="text-[11px] font-bold text-primary hover:underline" onClick={() => setOpen((v) => !v)}>
            {open ? 'بستن ریزبارم' : 'ریزبارم'}
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-border/50 bg-muted/30">
          <td colSpan={5} className="p-2">
            <div className="flex flex-wrap items-end gap-2">
              {FIELDS.map((f) => {
                const cap = (offering.rubric as unknown as Record<string, number>)[f.rubric] ?? 0;
                return (
                  <div key={f.key} className="w-20">
                    <label className="block text-[10px] font-bold text-muted-foreground">{f.label} (از {faNumber(cap)})</label>
                    <Input
                      type="number"
                      min={0}
                      max={cap}
                      step="0.25"
                      value={components[f.key] ?? ''}
                      onChange={(e) => {
                        const next = { ...components, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) };
                        setComponents(next);
                        try {
                          localStorage.setItem(storageKey(offering.id, student.studentId), JSON.stringify(next));
                        } catch {
                          /* حافظهٔ محلی در دسترس نیست */
                        }
                      }}
                      className="mt-1 h-7 text-center text-xs"
                    />
                  </div>
                );
              })}
              <div className="ms-auto flex items-end gap-2">
                <span className="rounded-lg bg-secondary px-2.5 py-1.5 font-mono text-xs font-black">
                  جمع: {total == null ? '—' : faNumber(total)}
                </span>
                <Button size="sm" variant="outline" disabled={disabled || total == null} onClick={() => {
                  if (total == null) return;
                  setValue(String(total));
                  onSave(total);
                }}>
                  اعمال به نمره
                </Button>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function ProfessorGradesPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['professor-grades'], queryFn: getGrades, staleTime: 20_000 });
  const [offeringID, setOfferingID] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [unfinalizeOpen, setUnfinalizeOpen] = useState(false);
  const [unfinalizeReason, setUnfinalizeReason] = useState('');
  const [appealDraft, setAppealDraft] = useState<Record<number, { grade: string; reply: string }>>({});

  useEffect(() => {
    if (data && offeringID == null) setOfferingID(data.offerings[0]?.id ?? null);
  }, [data, offeringID]);

  const offering = data?.offerings.find((o) => o.id === offeringID) ?? data?.offerings[0];
  const refresh = () => qc.invalidateQueries({ queryKey: ['professor-grades'] });

  const saveMut = useMutation({
    mutationFn: ({ studentId, value }: { studentId: number; value: number | null }) => saveGrade(offering!.id, studentId, value),
    onSuccess: async () => {
      setMsg('نمره ذخیره شد.');
      await refresh();
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const tempMut = useMutation({
    mutationFn: () => submitGradesTemporary(offering!.id),
    onSuccess: async () => {
      setMsg('نمرات به‌صورت موقت ثبت شد و برای دانشجویان قابل مشاهده است.');
      await refresh();
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const otpMut = useMutation({
    mutationFn: () => requestGradeFinalizeOTP(offering!.id),
    onSuccess: (r) => {
      setDevOtp(r.devOtp ?? null);
      setFinalizeOpen(true);
      setMsg('کد تأیید صادر شد.');
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const finalizeMut = useMutation({
    mutationFn: () => finalizeGrades(offering!.id, otp),
    onSuccess: async () => {
      setMsg('نمرات نهایی شد.');
      setFinalizeOpen(false);
      setOtp('');
      setDevOtp(null);
      await refresh();
      await qc.invalidateQueries({ queryKey: ['professor-dashboard'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const unfinalizeMut = useMutation({
    mutationFn: () => requestUnfinalize(offering!.id, unfinalizeReason),
    onSuccess: async () => {
      setMsg('درخواست بازگشایی ثبت شد و در انتظار تصمیم مدیر است.');
      setUnfinalizeOpen(false);
      setUnfinalizeReason('');
      await refresh();
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const appealMut = useMutation({
    mutationFn: ({ appealId, decision }: { appealId: number; decision: 'ACCEPTED' | 'REJECTED' }) => {
      const draft = appealDraft[appealId] ?? { grade: '', reply: '' };
      return resolveAppeal({
        appealId,
        decision,
        newGrade: decision === 'ACCEPTED' && draft.grade.trim() !== '' ? Number(draft.grade) : null,
        reply: draft.reply,
      });
    },
    onSuccess: async () => {
      setMsg('نتیجهٔ اعتراض ثبت شد.');
      await refresh();
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت دفترچهٔ نمرات ناموفق بود.</CardContent></Card>;
  }
  if (data.offerings.length === 0) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">در نیمسال انتخاب‌شده درسی به شما تخصیص نیافته است.</CardContent></Card>;
  }

  const locked = offering?.isFinalized ?? false;
  const appealsOpen = offering?.appeals.filter((a) => a.status === 'OPEN') ?? [];

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-indigo-700 to-violet-700 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15">
              <ClipboardCheck className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-base font-black">دفترچهٔ نمرات</h1>
              <p className="mt-0.5 text-xs text-white/85">
                {data.professor.name} · {data.term.title || '—'}
                {offering?.gradeDeadline ? ` · مهلت ثبت: ${faDigits(offering.gradeDeadline.slice(0, 10))}` : ''}
              </p>
            </div>
          </div>
          <div className="text-xs text-white/85">
            {faNumber(offering?.students.length ?? 0)} دانشجو · {offering?.isFinalized ? 'نهایی‌شده' : 'قابل ویرایش'}
          </div>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      <div className="flex flex-wrap gap-2">
        {data.offerings.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              setOfferingID(o.id);
              setMsg(null);
            }}
            className={`rounded-xl border px-3 py-2 text-right text-xs shadow-xs transition ${offering?.id === o.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40'}`}
          >
            <span className="flex items-center gap-1.5 font-black">
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]" dir="ltr">{o.code}</span>
              {o.title}
              {o.isFinalized ? <Lock className="size-3 text-emerald-600" aria-hidden /> : null}
            </span>
            <span className="mt-1 block text-[10px] text-muted-foreground">
              گروه {faNumber(o.groupNumber)} · {faNumber(o.students.length)} دانشجو
            </span>
          </button>
        ))}
      </div>

      {offering ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={locked || tempMut.isPending} onClick={() => tempMut.mutate()}>
              <Save className="size-4" aria-hidden /> ثبت موقت نمرات
            </Button>
            <Button size="sm" disabled={locked || otpMut.isPending} onClick={() => otpMut.mutate()}>
              <ShieldCheck className="size-4" aria-hidden /> نهایی‌سازی با کد تأیید
            </Button>
            {locked ? (
              <Button size="sm" variant="outline" onClick={() => setUnfinalizeOpen(true)}>
                <LockOpen className="size-4" aria-hidden /> درخواست بازگشایی
              </Button>
            ) : null}
            {offering.isCoTaught ? (
              <Badge variant="outline" className="text-[10px]">
                درس مشترک — نقش شما: {offering.coTaughtRole === 'LAB' ? 'عملی' : 'تئوری'}
                {offering.coPartnerName ? ` · همکار: ${offering.coPartnerName}` : ''}
              </Badge>
            ) : null}
          </div>

          {locked ? (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
              <Lock className="size-4" aria-hidden />
              نمرات این درس نهایی شده است{offering.finalizedAt ? ` (${faDigits(offering.finalizedAt.slice(0, 10))})` : ''}. تغییر فقط پس از تأیید بازگشایی توسط مدیر.
            </div>
          ) : null}

          {finalizeOpen ? (
            <Card className="border-2 border-indigo-300 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/30">
              <CardContent className="flex flex-wrap items-center gap-2 p-4">
                <p className="text-xs font-bold">کد ۶ رقمی ارسال‌شده را وارد کنید:</p>
                <Input value={otp} onChange={(e) => setOtp(e.target.value)} className="h-8 max-w-36 text-center font-mono" inputMode="numeric" />
                <Button size="sm" disabled={finalizeMut.isPending || otp.trim().length < 4} onClick={() => finalizeMut.mutate()}>قفل نهایی</Button>
                <Button size="sm" variant="outline" onClick={() => setFinalizeOpen(false)}>انصراف</Button>
                {devOtp ? <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">کد توسعه: <b className="font-mono" dir="ltr">{devOtp}</b></span> : null}
              </CardContent>
            </Card>
          ) : null}

          {unfinalizeOpen ? (
            <Card className="border-2 border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
              <CardContent className="flex flex-wrap items-center gap-2 p-4">
                <p className="text-xs font-bold">دلیل بازگشایی:</p>
                <Input value={unfinalizeReason} onChange={(e) => setUnfinalizeReason(e.target.value)} className="h-8 max-w-80 text-xs" placeholder="مثلاً اشتباه در ثبت نمرهٔ یک دانشجو" />
                <Button size="sm" disabled={unfinalizeMut.isPending || unfinalizeReason.trim().length < 5} onClick={() => unfinalizeMut.mutate()}>ثبت درخواست</Button>
                <Button size="sm" variant="outline" onClick={() => setUnfinalizeOpen(false)}>انصراف</Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">فهرست دانشجویان</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                    <th className="p-2">شمارهٔ دانشجویی</th>
                    <th className="p-2">نام</th>
                    <th className="p-2 text-center">نمره (از ۲۰)</th>
                    <th className="p-2 text-center">وضعیت</th>
                    <th className="p-2 text-center">ریزبارم</th>
                  </tr>
                </thead>
                <tbody>
                  {offering.students.map((st) => (
                    <StudentRow
                      key={st.studentId}
                      offering={offering}
                      student={st}
                      disabled={locked || saveMut.isPending}
                      onSave={(value) => saveMut.mutate({ studentId: st.studentId, value })}
                    />
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {appealsOpen.length > 0 ? (
            <Card className="border-amber-300 dark:border-amber-800">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <TriangleAlert className="size-4 text-amber-500" aria-hidden /> اعتراض‌های باز ({faNumber(appealsOpen.length)})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {appealsOpen.map((a) => {
                  const draft = appealDraft[a.id] ?? { grade: a.currentGrade == null ? '' : String(a.currentGrade), reply: '' };
                  return (
                    <div key={a.id} className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/20">
                      <p className="font-bold">
                        {a.fullName} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{a.studentCode}</span>
                        {a.currentGrade != null ? ` — نمرهٔ فعلی: ${faNumber(a.currentGrade)}` : ''}
                      </p>
                      <p className="text-muted-foreground">{a.studentMessage || '—'}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={draft.grade}
                          onChange={(e) => setAppealDraft((prev) => ({ ...prev, [a.id]: { ...draft, grade: e.target.value } }))}
                          placeholder="نمرهٔ جدید"
                          className="h-7 max-w-28 text-center text-xs"
                          inputMode="decimal"
                        />
                        <Input
                          value={draft.reply}
                          onChange={(e) => setAppealDraft((prev) => ({ ...prev, [a.id]: { ...draft, reply: e.target.value } }))}
                          placeholder="پاسخ به دانشجو"
                          className="h-7 max-w-80 text-xs"
                        />
                        <Button size="sm" onClick={() => appealMut.mutate({ appealId: a.id, decision: 'ACCEPTED' })}>پذیرش</Button>
                        <Button size="sm" variant="outline" onClick={() => appealMut.mutate({ appealId: a.id, decision: 'REJECTED' })}>رد</Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

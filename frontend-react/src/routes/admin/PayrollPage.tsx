import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Calculator, Download, FileCheck, Loader2, ShieldCheck, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, faRial } from '@/lib/fa';
import { toEnDigits } from '@/lib/fa';
import {
  computePayroll,
  exportPayrollCSV,
  getApprovalHistory,
  getPayrollConfig,
  getPayrollOverview,
  getPayrollPayslip,
  payMidterm,
  payrollApprovalOp,
  settlePayroll,
  type ApprovalHistoryRow,
  type OverviewItem,
} from '@/lib/payroll-api';

// ═══ Teaching pay desk — port of admin/payroll (real calculation) ═══

const STATUS_FA: Record<string, string> = {
  NOT_COMPUTED: 'محاسبه‌نشده',
  DRAFT: 'پیش‌نویس',
  MID_TERM_PAID: 'میان‌ترم پرداخت‌شده',
  DEPT_HEAD_APPROVED: 'تأیید مدیر گروه',
  DEAN_APPROVED: 'تأیید معاونت آموزشی',
  REJECTED: 'ردّ نهایی',
  FINAL_SETTLED: 'تسویهٔ نهایی',
};

const STATUS_BADGE: Record<string, string> = {
  DEPT_HEAD_APPROVED: 'bg-indigo-600 text-white',
  DEAN_APPROVED: 'bg-blue-600 text-white',
  REJECTED: 'bg-rose-600 text-white',
  MID_TERM_PAID: 'bg-amber-200 text-amber-900',
  FINAL_SETTLED: 'bg-emerald-600 text-white',
};

const RATE_SOURCE_FA: Record<string, string> = {
  BASE: 'سطر پایه‌دار جدول',
  TABLE: 'سطر عمومی جدول',
  SNAPSHOT: 'اسنپ‌شات قرارداد',
  FRACTION: 'نسبت حکم (۱/N)',
};

const ROLE_FA: Record<string, string> = {
  MAIN_LECTURER: 'مدرس اصلی', SUPERVISOR: 'استاد راهنما', ADVISOR: 'استاد مشاور',
  REVIEWER: 'داور', EXAMINER: 'ممتحن', ASSISTANT: 'کمک‌استاد', SELF_STUDY: 'استاد خودخوان',
};

const STAGE_FA: Record<string, string> = { DEPT_HEAD: 'مدیر گروه', DEAN: 'معاونت آموزشی', FINANCE: 'مالی' };
const ACTION_FA: Record<string, string> = { APPROVE: 'تأیید', REJECT: 'ردّ', RETURN: 'بازگشت' };

export function AdminPayrollPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [openStaff, setOpenStaff] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['payroll-overview'],
    queryFn: getPayrollOverview,
    staleTime: 10_000,
  });
  const { data: config } = useQuery({ queryKey: ['payroll-config'], queryFn: getPayrollConfig, staleTime: 60_000 });

  const computeMut = useMutation({
    mutationFn: computePayroll,
    onSuccess: async (r) => {
      setMsg(`محاسبهٔ ترم «${r.termTitle}»: ${faNumber(r.computed)} فیش محاسبه شد (بدون قرارداد: ${faNumber(r.skippedNoContract)}، تسویه‌شده: ${faNumber(r.skippedSettled)}، قفل: ${faNumber(r.skippedLocked)}).`);
      await qc.invalidateQueries({ queryKey: ['payroll-overview'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const exportMut = useMutation({
    mutationFn: exportPayrollCSV,
    onSuccess: (csv) => {
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'payroll-batch.csv';
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const list = useMemo(() => {
    if (!data) return [];
    const q = toEnDigits(search.trim());
    if (!q) return data.overview.list;
    return data.overview.list.filter((x) =>
      (x.name ?? '').includes(q) ||
      (x.staffCode ?? '').includes(q) ||
      (x.rank ?? '').includes(q),
    );
  }, [data, search]);

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت میز کار حق‌التدریس ناموفق بود.</CardContent></Card>;

  const t = data.overview.totals;
  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-indigo-800 to-slate-900 text-white">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="flex items-center gap-2 text-base font-black"><Wallet className="size-5" aria-hidden /> میز کار حق‌التدریس — {data.overview.term}</h1>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="bg-white/15 hover:bg-white/25 text-white" disabled={computeMut.isPending} onClick={() => computeMut.mutate()}>
                {computeMut.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Calculator className="size-4" aria-hidden />}
                محاسبهٔ کل ترم
              </Button>
              <Button size="sm" className="bg-white/15 hover:bg-white/25 text-white" disabled={exportMut.isPending} onClick={() => exportMut.mutate()}>
                <Download className="size-4" aria-hidden /> خروجی بانکی CSV
              </Button>
            </div>
          </div>
          {data.scoped ? <p className="mt-1 text-[11px] text-indigo-100">🔒 نمای دامنه‌دار مدیر گروه — فقط اساتید گروه‌های زیر نظر شما.</p> : null}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['اساتید', faNumber(t.staffCount)],
              ['بودجهٔ خالص (ریال)', faNumber(t.budget)],
              ['پرداخت‌شده (ریال)', faNumber(t.paid)],
              ['باقی‌مانده (ریال)', faNumber(t.remaining)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/10 px-3 py-2">
                <div className="text-[10px] text-indigo-50/80">{k}</div>
                <div className="mt-0.5 font-mono text-sm font-black">{v}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جست‌وجو (نام، کد پرسنلی، مرتبه)…" className="min-w-56 flex-1" />
          <span className="text-xs text-muted-foreground">{faNumber(list.length)} استاد</span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                <th className="p-2">استاد</th><th className="p-2">نرخ منبع</th><th className="p-2 text-center">واحد مؤثر</th>
                <th className="p-2 text-left">ناخالص</th><th className="p-2 text-left">کسر غیبت</th><th className="p-2 text-left">مالیات</th>
                <th className="p-2 text-left">خالص</th><th className="p-2">وضعیت</th><th className="p-2">گلوگاه</th><th className="p-2">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">استادی یافت نشد.</td></tr>
              ) : list.map((x) => (
                <PayrollRowItem key={x.id} x={x} open={openStaff === x.id} onToggle={() => setOpenStaff(openStaff === x.id ? null : x.id)} onMsg={setMsg} />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {config ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4" aria-hidden /> پیکربندی شفاف موتور — سال مالی {faDigits(config.year)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">ضریب عملی: {faNumber(config.coefs.practical)}</Badge>
              <Badge variant="outline">ضریب ارشد: {faNumber(config.coefs.msLevel)}</Badge>
              <Badge variant="outline">ضریب جمعی: {faNumber(config.coefs.crowded)}</Badge>
              <Badge variant="outline">حدنصاب جمعی: {faNumber(config.crowded)} نفر</Badge>
              <Badge variant="outline">جلسات مبنای ترم: {faNumber(config.sessions)}</Badge>
              <Badge variant="outline">درصد علی‌الحساب: {faNumber(config.midterm)}٪</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-[11px]">
                <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">مرتبه</th><th className="p-1.5">مدرک</th><th className="p-1.5">پایه</th><th className="p-1.5 text-left">نرخ هر واحد (ریال)</th><th className="p-1.5 text-center">سال مؤثر</th></tr></thead>
                <tbody>
                  {config.rates.map((r, i) => (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="p-1.5">{r.academicRank}</td>
                      <td className="p-1.5">{r.degree}</td>
                      <td className="p-1.5">{r.academicBase ?? 'همه'}</td>
                      <td className="p-1.5 text-left font-mono">{faNumber(r.baseRatePerUnit)}</td>
                      <td className="p-1.5 text-center">{faDigits(r.effectiveYear)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {config.rules.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-[11px]">
                  <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">عنوان</th><th className="p-1.5">نوع</th><th className="p-1.5">نقش</th><th className="p-1.5">فرمول</th></tr></thead>
                  <tbody>
                    {config.rules.map((r) => (
                      <tr key={r.id} className="border-b border-border/40 last:border-0">
                        <td className="p-1.5">{r.title ?? '—'}</td>
                        <td className="p-1.5">{r.offeringType ?? '—'}</td>
                        <td className="p-1.5">{r.professorRole ?? '—'}</td>
                        <td className="p-1.5 font-mono" dir="ltr">{r.expression ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PayrollRowItem({ x, open, onToggle, onMsg }: {
  x: OverviewItem;
  open: boolean;
  onToggle: () => void;
  onMsg: (m: string) => void;
}) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['payroll-overview'] });
    void qc.invalidateQueries({ queryKey: ['payslip', x.id] });
  };
  const midtermMut = useMutation({
    mutationFn: () => payMidterm(x.id),
    onSuccess: () => { onMsg('علی‌الحساب میان‌ترم پرداخت شد.'); invalidate(); },
    onError: (e: Error) => onMsg(e.message),
  });
  const settleMut = useMutation({
    mutationFn: () => settlePayroll(x.id),
    onSuccess: () => { onMsg('تسویهٔ نهایی انجام شد.'); invalidate(); },
    onError: (e: Error) => onMsg(e.message),
  });

  return (
    <>
      <tr className={`border-b border-border/50 last:border-0 ${open ? 'bg-muted/40' : 'hover:bg-muted/40'}`}>
        <td className="p-2">
          <button type="button" onClick={onToggle} className="text-right font-bold underline decoration-dotted underline-offset-4">
            {x.name}
          </button>
          <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{x.staffCode ? faDigits(x.staffCode) : '—'}</div>
          <div className="text-[10px] text-muted-foreground">{x.rank ?? '—'} · {x.contractType === 'ADJUNCT' ? 'مدعو' : 'هیئت علمی'}</div>
        </td>
        <td className="p-2">
          <div className="font-mono">{faNumber(x.rate)}</div>
          <div className="text-[10px] text-muted-foreground">{RATE_SOURCE_FA[x.rateSource] ?? x.rateSource}</div>
        </td>
        <td className="p-2 text-center">
          <div className="font-mono">{faNumber(x.totalEffectiveUnits)}</div>
          <div className="text-[10px] text-muted-foreground">مؤثر / {faNumber(x.totalEquivalentUnits)} معادل</div>
        </td>
        <td className="p-2 text-left font-mono">{faNumber(x.gross)}</td>
        <td className="p-2 text-left font-mono text-amber-700 dark:text-amber-300">{faNumber(x.absenceDeductionRial)}</td>
        <td className="p-2 text-left font-mono text-rose-700 dark:text-rose-300">{faNumber(x.tax)}</td>
        <td className="p-2 text-left font-mono font-black">{faNumber(x.net)}</td>
        <td className="p-2">
          <Badge className={STATUS_BADGE[x.status] ?? 'border-transparent bg-muted text-muted-foreground'}>
            {STATUS_FA[x.status] ?? x.status}
          </Badge>
          {x.status !== 'NOT_COMPUTED' && x.status !== 'FINAL_SETTLED' ? (
            <div className="mt-0.5 text-[10px] text-muted-foreground">مانده: {faRial(x.remaining)}</div>
          ) : null}
        </td>
        <td className="p-2">
          <div className="flex flex-col gap-0.5 text-[10px]">
            <span className={x.gates.gradesFinalized ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>
              {x.gates.gradesFinalized ? '✓ نمرات قطعی' : `${faNumber(x.gates.pendingGrades)} نمرهٔ ناقص`}
            </span>
            <span className={x.gates.docsSigned ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>
              {x.gates.docsSigned ? '✓ اسناد امضاشده' : `${faNumber(x.gates.unsignedDocs)} سندِ امضانشده`}
            </span>
          </div>
        </td>
        <td className="p-2">
          <div className="flex flex-wrap gap-1">
            {x.status === 'DRAFT' ? (
              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={midtermMut.isPending} onClick={() => midtermMut.mutate()}>
                <Banknote className="size-3.5" aria-hidden /> علی‌الحساب
              </Button>
            ) : null}
            {x.status === 'DEAN_APPROVED' ? (
              <Button size="sm" className="h-7 bg-emerald-700 text-[11px] text-white hover:bg-emerald-800" disabled={settleMut.isPending} onClick={() => settleMut.mutate()}>
                <FileCheck className="size-3.5" aria-hidden /> تسویه
              </Button>
            ) : null}
          </div>
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-border/50">
          <td colSpan={10} className="p-3">
            <PayslipPanel staffId={x.id} statementId={x.statementId} onMsg={onMsg} onChanged={invalidate} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function PayslipPanel({ staffId, statementId, onMsg, onChanged }: {
  staffId: number;
  statementId: number | null;
  onMsg: (m: string) => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['payslip', staffId],
    queryFn: () => getPayrollPayslip(staffId),
  });
  const { data: history } = useQuery({
    queryKey: ['payroll-history', statementId],
    queryFn: () => (statementId ? getApprovalHistory(statementId) : Promise.resolve([] as ApprovalHistoryRow[])),
    enabled: !!statementId,
  });
  const [note, setNote] = useState('');
  const opMut = useMutation({
    mutationFn: ({ op }: { op: 'approve-dept' | 'approve-dean' | 'return' | 'reject' }) =>
      payrollApprovalOp(op, statementId ?? 0, note || undefined),
    onSuccess: async (_r, v) => {
      onMsg(v.op === 'return' || v.op === 'reject' ? 'انجام شد.' : 'فیش تأیید شد.');
      setNote('');
      onChanged();
      await qc.invalidateQueries({ queryKey: ['payroll-history', statementId] });
    },
    onError: (e: Error) => onMsg(e.message),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError || !data) return <p className="text-xs text-muted-foreground">دریافت فیش ناموفق بود.</p>;

  const c = data.calc;
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/60 p-3">
      <div className="flex flex-wrap gap-2 text-[11px]">
        <Badge variant="outline">نرخ: {faRial(c.rate)} /واحد</Badge>
        <Badge variant="outline">موظفی: {faNumber(c.dutyUnits)} واحد</Badge>
        <Badge variant="outline">قابل‌پرداخت: {faNumber(c.payableUnits)} واحد</Badge>
        <Badge variant="outline">مالیات: {faNumber(c.taxRate)}٪</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-right text-[11px]">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="p-1.5">درس</th><th className="p-1.5">نقش</th><th className="p-1.5 text-center">جلسات</th>
              <th className="p-1.5">ضرایب/فرمول</th><th className="p-1.5 text-center">معادل</th><th className="p-1.5 text-center">مؤثر</th><th className="p-1.5 text-left">ناخالص</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.offeringId} className="border-b border-border/40 last:border-0">
                <td className="p-1.5">{r.courseTitle} <span className="font-mono text-[9px] text-muted-foreground" dir="ltr">{r.courseCode}</span></td>
                <td className="p-1.5">{ROLE_FA[r.payRole] ?? r.payRole}</td>
                <td className="p-1.5 text-center font-mono">
                  {faNumber(r.sessions.held)}{r.sessions.netAbsences > 0 ? <span className="text-rose-600"> −{faNumber(r.sessions.netAbsences)}</span> : null}
                </td>
                <td className="p-1.5">{r.coefficients}</td>
                <td className="p-1.5 text-center font-mono">{faNumber(r.equivalentUnits)}</td>
                <td className="p-1.5 text-center font-mono">{faNumber(r.effectiveUnits)}</td>
                <td className="p-1.5 text-left font-mono">{faNumber(r.grossRial)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {statementId ? (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-2">
          <p className="text-[11px] font-bold">تاریخچهٔ تأیید</p>
          {(history ?? []).map((h) => (
            <p key={h.id} className="text-[11px] text-muted-foreground">
              {STAGE_FA[h.stage] ?? h.stage} — {ACTION_FA[h.action] ?? h.action} ({h.actorRole ?? '—'})
              {h.note ? ` — «${h.note}»` : ''}
              {h.createdAt ? ` — ${faDigits(h.createdAt.slice(0, 10))}` : ''}
            </p>
          ))}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت (برای بازگشت/ردّ الزامی)" className="h-7 min-w-56 flex-1 text-[11px]" />
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={opMut.isPending} onClick={() => opMut.mutate({ op: 'approve-dept' })}>تأیید مدیر گروه</Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={opMut.isPending} onClick={() => opMut.mutate({ op: 'approve-dean' })}>تأیید معاونت</Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px] text-amber-700" disabled={opMut.isPending || !note} onClick={() => opMut.mutate({ op: 'return' })}>بازگشت</Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px] text-rose-700" disabled={opMut.isPending || !note} onClick={() => opMut.mutate({ op: 'reject' })}>ردّ نهایی</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

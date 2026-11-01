import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Search, Save, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, faRial } from '@/lib/fa';
import {
  adjustLedger,
  getCourseFinance,
  getFinanceStudents,
  getStudentFinanceDetail,
  setCourseFinanceType,
} from '@/lib/admin-api';

// ═══ Finance inbox — port of admin/finance ═══

export function AdminFinancePage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [onlyDebtors, setOnlyDebtors] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-finance', query, onlyDebtors],
    queryFn: () => getFinanceStudents({ q: query, onlyDebtors }),
    staleTime: 20_000,
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت کارتابل مالی ناموفق بود.</CardContent></Card>;

  const t = data.totals;
  const collected = t.payments + t.chequesCleared + t.loans;
  const netDebtBase = t.charges - t.discounts - t.sponsorships;
  const collectionRate = netDebtBase > 0 ? Math.min(100, Math.round((collected / netDebtBase) * 100)) : collected > 0 ? 100 : 0;
  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-base font-black"><Wallet className="size-5" aria-hidden /> کارتابل کارشناس مالی</h1>
          <p className="mt-0.5 text-xs text-emerald-100">فهرست دانشجویان با ماندهٔ مالی — ورود مستقیم به کارنامهٔ مالی هر دانشجو</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['دانشجوی فهرست‌شده', faNumber(data.students.length), `${faNumber(t.debtorCount)} بدهکار`],
              ['جمع شهریه (ریال)', faNumber(t.charges), undefined],
              ['جمع تخفیف (ریال)', faNumber(t.discounts), `بنیاد: ${faNumber(t.sponsorships)}`],
              ['ماندهٔ خالص (ریال)', faNumber(Math.abs(t.balance)), t.balance > 0 ? 'بدهکار' : t.balance < 0 ? 'بستانکار' : 'تسویه'],
            ].map(([k, v, sub]) => (
              <div key={k} className="rounded-xl bg-white/10 px-3 py-2">
                <div className="text-[10px] text-emerald-50/80">{k}</div>
                <div className="mt-0.5 font-mono text-sm font-black">{v}</div>
                {sub ? <div className="text-[10px] text-emerald-50/70">{sub}</div> : null}
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl bg-white/10 px-3 py-2">
            <div className="flex items-center justify-between text-[11px] font-bold">
              <span>📈 نرخ وصول شهریه (پرداخت + چک وصولی + وام)</span>
              <span>{faNumber(collectionRate)}٪</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-gradient-to-l from-emerald-400 to-teal-300" style={{ width: `${collectionRate}%` }} />
            </div>
            <div className="mt-1 flex flex-wrap justify-between gap-2 text-[10px] text-emerald-50/80">
              <span>جمع وصولی: <b className="font-mono">{faNumber(collected)}</b> ریال</span>
              <span>خالص قابل‌وصول: <b className="font-mono">{faNumber(Math.max(0, netDebtBase))}</b> ریال</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="کد دانشجویی یا نام…" className="pr-9" onKeyDown={(e) => { if (e.key === 'Enter') setQuery(search); }} />
          </div>
          <label className="flex items-center gap-1.5 text-xs font-bold">
            <input type="checkbox" checked={onlyDebtors} onChange={(e) => setOnlyDebtors(e.target.checked)} /> فقط بدهکاران
          </label>
          <Button size="sm" onClick={() => setQuery(search)}>نمایش</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                <th className="p-2">دانشجو</th><th className="p-2">بدهی</th><th className="p-2">تخفیف</th>
                <th className="p-2">پرداخت</th><th className="p-2">چک وصولی</th><th className="p-2">وام</th><th className="p-2">مانده</th>
              </tr>
            </thead>
            <tbody>
              {data.students.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">ردیفی یافت نشد.</td></tr>
              ) : data.students.map((r) => (
                <tr key={r.studentId} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                  <td className="p-2 font-bold">
                    <Link to={`/admin/finance/student/${r.studentId}`} className="underline decoration-dotted underline-offset-4 hover:text-emerald-700 dark:hover:text-emerald-300">
                      {r.fullName}
                    </Link>{' '}
                    <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{faDigits(r.studentCode)}</span>
                  </td>
                  <td className="p-2 font-mono">{faNumber(r.charges)}</td>
                  <td className="p-2 font-mono text-emerald-700 dark:text-emerald-300">{faNumber(r.discounts)}</td>
                  <td className="p-2 font-mono">{faNumber(r.payments)}</td>
                  <td className="p-2 font-mono">{faNumber(r.chequesCleared)}</td>
                  <td className="p-2 font-mono">{faNumber(r.loans)}</td>
                  <td className="p-2">
                    {r.balance > 0 ? (
                      <Badge className="border-transparent bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">{faRial(r.balance)}</Badge>
                    ) : (
                      <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">تسویه</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

export function AdminStudentFinanceRoute() {
  const { id } = useParams();
  const studentId = Number(id ?? 0);
  if (!studentId) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">شناسهٔ دانشجو نامعتبر است.</CardContent></Card>;
  return <AdminStudentFinancePage studentId={studentId} />;
}

export function AdminStudentFinancePage({ studentId }: { studentId: number }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-student-finance', studentId],
    queryFn: () => getStudentFinanceDetail(studentId),
  });
  const [adjust, setAdjust] = useState({ type: 'CHARGE', amount: '', description: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const adjustMut = useMutation({
    mutationFn: () => adjustLedger({ studentId, transactionType: adjust.type, amount: Number(adjust.amount), description: adjust.description }),
    onSuccess: async () => {
      setMsg('تعدیل ثبت شد.');
      setAdjust({ ...adjust, amount: '', description: '' });
      await qc.invalidateQueries({ queryKey: ['admin-student-finance', studentId] });
      await qc.invalidateQueries({ queryKey: ['admin-finance'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت کارنامهٔ مالی ناموفق بود.</CardContent></Card>;

  const { finance, txns } = data;
  const t = finance.totals;
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              کارنامهٔ مالی — {finance.student.fullName}{' '}
              <span className="font-mono text-xs text-muted-foreground" dir="ltr">{faDigits(finance.student.studentCode)}</span>
            </span>
            <Badge className={t.balance > 0 ? 'border-transparent bg-rose-100 text-rose-800' : 'border-transparent bg-emerald-100 text-emerald-800'}>
              {t.balance > 0 ? `بدهکار: ${faRial(t.balance)}` : t.balance < 0 ? `بستانکار: ${faRial(-t.balance)}` : 'تسویه'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Grand total */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ['شهریه', t.charges, 'text-rose-700 dark:text-rose-300'],
              ['تخفیف', t.discounts, 'text-violet-700 dark:text-violet-300'],
              ['پوشش بنیاد', t.sponsorships, 'text-indigo-700 dark:text-indigo-300'],
              ['پرداخت نقدی', t.payments, 'text-emerald-700 dark:text-emerald-300'],
              ['چک وصولی', t.chequesCleared, 'text-emerald-700 dark:text-emerald-300'],
              ['چک در انتظار', t.chequesPending, 'text-amber-700 dark:text-amber-300'],
              ['وام', t.loans, 'text-sky-700 dark:text-sky-300'],
              ['مانده', t.balance, t.balance > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'],
            ] as const).map(([k, v, cls]) => (
              <div key={k} className="rounded-xl border border-border bg-muted/40 px-3 py-2">
                <div className="text-[10px] text-muted-foreground">{k} (ریال)</div>
                <div className={`mt-0.5 font-mono text-sm font-black ${cls}`}>{faNumber(v)}</div>
              </div>
            ))}
          </div>

          {/* Term-by-term statement — same engine as the student financial statement */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-right text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                  <th className="p-2">نیمسال</th><th className="p-2">شهریه</th><th className="p-2">تخفیف</th>
                  <th className="p-2">بنیاد</th><th className="p-2">پرداخت</th><th className="p-2">مانده</th>
                </tr>
              </thead>
              <tbody>
                {finance.terms.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">ترمی ثبت نشده است.</td></tr>
                ) : finance.terms.map((tr) => (
                  <tr key={tr.termId} className="border-b border-border/50 last:border-0">
                    <td className="p-2 font-bold">{tr.termTitle}</td>
                    <td className="p-2 font-mono">{faNumber(tr.charges)}</td>
                    <td className="p-2 font-mono">{faNumber(tr.discounts)}</td>
                    <td className="p-2 font-mono">{faNumber(tr.sponsorships)}</td>
                    <td className="p-2 font-mono">{faNumber(tr.payments)}</td>
                    <td className={`p-2 font-mono font-black ${tr.balance > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{faNumber(tr.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Manual ledger adjustment form */}
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-[11px] dark:border-amber-800 dark:bg-amber-950/30">
            <div className="w-44"><Label>نوع تراکنش</Label>
              <select value={adjust.type} onChange={(e) => setAdjust({ ...adjust, type: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2">
                <option value="CHARGE">شارژ بدهی</option>
                <option value="CREDIT">اعتبار (بستانکاری)</option>
                <option value="PAYMENT">پرداخت نقدی</option>
                <option value="POS_PAYMENT">پرداخت POS</option>
                <option value="TUITION_ADJUST_DEC">تعدیل بدهی (legacy DEC)</option>
                <option value="TUITION_ADJUST_INC">تعدیل اعتباری (legacy INC)</option>
              </select>
            </div>
            <div className="w-36"><Label>مبلغ (ریال)</Label><Input type="number" min={0} value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} className="mt-1 h-8 font-mono" /></div>
            <div className="min-w-44 flex-1"><Label>توضیح</Label><Input value={adjust.description} onChange={(e) => setAdjust({ ...adjust, description: e.target.value })} className="mt-1 h-8" /></div>
            <Button size="sm" disabled={adjustMut.isPending || !adjust.amount} onClick={() => adjustMut.mutate()}><Save className="size-4" aria-hidden /> ثبت تعدیل</Button>
          </div>
          {msg ? <p className="text-[11px] text-muted-foreground">{msg}</p> : null}

          {/* Ledger details */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-xs">
              <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2">نوع</th><th className="p-2 text-left">مبلغ</th><th className="p-2">توضیح</th><th className="p-2">تاریخ</th></tr></thead>
              <tbody>
                {txns.length === 0 ? (
                  <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">تراکنشی ثبت نشده است.</td></tr>
                ) : txns.map((tr) => (
                  <tr key={tr.id} className="border-b border-border/50 last:border-0">
                    <td className="p-2 font-mono text-[10px]" dir="ltr">{tr.transactionType}</td>
                    <td className={`p-2 text-left font-mono ${tr.amount < 0 ? 'text-amber-700 dark:text-amber-300' : ''}`}>{faNumber(tr.amount)}</td>
                    <td className="p-2">{tr.description ?? '—'}</td>
                    <td className="p-2 font-mono text-[10px]" dir="ltr">{tr.createdAt ? faDigits(tr.createdAt.slice(0, 10)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function AdminCourseFinancePage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-course-finance', query], queryFn: () => getCourseFinance(query), staleTime: 30_000 });
  const saveMut = useMutation({
    mutationFn: ({ courseId, maliType }: { courseId: number; maliType: number }) => setCourseFinanceType(courseId, maliType),
    onSuccess: async () => {
      setMsg('نوع درس مالی ذخیره شد.');
      await qc.invalidateQueries({ queryKey: ['admin-course-finance'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-emerald-800 to-teal-700 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-base font-black"><CreditCard className="size-5" aria-hidden /> نوع درس مالی</h1>
          <p className="mt-0.5 text-xs text-emerald-100">درسِ بدون نوع مالی در موتور شهریه صفر حساب می‌شود — این کارتابل نباید «تعیین‌نشده» داشته باشد.</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="کد یا عنوان درس…" className="pr-9" onKeyDown={(e) => { if (e.key === 'Enter') setQuery(search); }} />
          </div>
          <Button size="sm" onClick={() => setQuery(search)}>جست‌وجو</Button>
        </CardContent>
      </Card>
      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}
      {isLoading ? <Skeleton className="h-64 w-full" /> : isError || !data ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت دروس ناموفق بود.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-xs">
              <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2 text-center">واحد</th><th className="p-2 text-center">نوع مالی</th></tr></thead>
              <tbody>
                {data.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">درسی یافت نشد.</td></tr> : data.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 last:border-0">
                    <td className="p-2 font-mono text-[10px]" dir="ltr">{c.code}</td>
                    <td className="p-2 font-semibold">{c.title}</td>
                    <td className="p-2 text-center">{c.units == null ? '—' : faNumber(c.units)}</td>
                    <td className="p-2">
                      <div className="flex items-center justify-center gap-1.5">
                        <Input
                          type="number"
                          min={0}
                          max={99}
                          value={types[c.id] ?? (c.legacyMaliType == null ? '' : String(c.legacyMaliType))}
                          onChange={(e) => setTypes((prev) => ({ ...prev, [c.id]: e.target.value }))}
                          className={`h-7 w-16 text-center font-mono ${c.legacyMaliType == null ? 'border-rose-300' : ''}`}
                          dir="ltr"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={saveMut.isPending || (types[c.id] ?? '') === '' || (types[c.id] ?? '') === (c.legacyMaliType == null ? '' : String(c.legacyMaliType))}
                          onClick={() => saveMut.mutate({ courseId: c.id, maliType: Number(types[c.id]) })}
                        >
                          ذخیره
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, BadgePercent, BookOpen, Plus, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, faRial, toEnDigits } from '@/lib/fa';
import {
  addShortTermLearner,
  confirmShortTermPayment,
  createShortCourse,
  createShortTermDiscount,
  getShortCourses,
  issueShortTermCertificate,
  revokeShortTermCertificate,
  syncShortCourseCounts,
  toggleShortTermDiscount,
  updateShortCourseStatus,
  updateShortTermRegistration,
  type ShortTermCourse,
  type ShortTermLearner,
} from '@/lib/short-courses-api';

// ═══ مدیریت دوره‌های آزاد — پورت admin/short-courses ═══

const COURSE_STATUS: Record<string, string> = { OPEN: 'پذیرش باز', IN_PROGRESS: 'در حال برگزاری', COMPLETED: 'پایان‌یافته' };
const PAYMENT_STATUS: Record<string, string> = { PENDING: 'در انتظار', PAID: 'پرداخت‌شده', REFUNDED: 'برگشت‌خورده' };

export function AdminShortCoursesPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['short-courses'], queryFn: getShortCourses, staleTime: 15_000 });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [learnerOf, setLearnerOf] = useState<ShortTermCourse | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['short-courses'] });

  const syncMut = useMutation({
    mutationFn: syncShortCourseCounts,
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'شمار ثبت‌نام‌شده‌ها همگام شد.' }); await refresh(); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت دوره‌ها ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-amber-700 via-orange-700 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-black"><BookOpen className="size-5" aria-hidden /> دوره‌های آزاد (کوتاه‌مدت)</h1>
            <p className="mt-1 text-xs text-amber-100">تعریف دوره، ثبت شرکت‌کننده، تأیید واریز، ثبت حضور/نمره، صدور و ابطال گواهینامه با استعلام عمومی</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="border-white/25 bg-white/15 text-white hover:bg-white/25" disabled={syncMut.isPending} onClick={() => syncMut.mutate()}><RefreshCw className="size-4" aria-hidden /> همگام‌سازی شمارش</Button>
            <Button size="sm" className="bg-white text-slate-900 hover:bg-white/90" onClick={() => setShowCourseForm(true)}><Plus className="size-4" aria-hidden /> دورهٔ جدید</Button>
          </div>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="text-muted-foreground"><X className="size-3.5" aria-hidden /><span className="sr-only">بستن</span></button>
        </div>
      ) : null}

      {data.courses.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دوره‌ای تعریف نشده است.</CardContent></Card> : null}

      <div className="space-y-3">
        {data.courses.map((c) => (
          <CourseCard key={c.id} c={c} onMsg={setMsg} onRefresh={refresh} onAddLearner={() => setLearnerOf(c)} />
        ))}
      </div>

      <DiscountsCard discounts={data.discounts} courses={data.courses} onMsg={setMsg} onRefresh={refresh} />

      {showCourseForm ? <CourseForm onClose={() => setShowCourseForm(false)} onSaved={async (text) => { setMsg({ kind: 'ok', text }); setShowCourseForm(false); await refresh(); }} /> : null}
      {learnerOf ? <LearnerForm course={learnerOf} onClose={() => setLearnerOf(null)} onSaved={async (text) => { setMsg({ kind: 'ok', text }); setLearnerOf(null); await refresh(); }} /> : null}
    </div>
  );
}

function CourseCard({ c, onMsg, onRefresh, onAddLearner }: {
  c: ShortTermCourse;
  onMsg: (m: { kind: 'ok' | 'err'; text: string }) => void;
  onRefresh: () => Promise<unknown>;
  onAddLearner: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<number, { att: string; grade: string }>>({});

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    try {
      await fn();
      onMsg({ kind: 'ok', text: okText });
      await onRefresh();
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    } finally {
      setBusy(false);
    }
  }

  async function saveRow(l: ShortTermLearner) {
    const e = edits[l.registrationId];
    await run(() => updateShortTermRegistration({
      registrationId: l.registrationId,
      attendanceCount: e?.att === '' || e?.att == null ? undefined : Number(e.att),
      finalGrade: e?.grade === '' || e?.grade == null ? null : Number(e.grade),
    }), 'حضور/نمره ذخیره شد.');
  }

  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <p className="text-sm font-black">{c.title} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{c.code}</span></p>
            <p className="text-[10px] text-muted-foreground">{c.category} · {c.instructorName} · {faNumber(c.hours)} ساعت · شهریه {faRial(c.tuitionPrice)} · ظرفیت {faNumber(c.enrolledCount)}/{faNumber(c.capacity)}</p>
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-1">
            <select value={c.status} onChange={(e) => void run(() => updateShortCourseStatus(c.id, e.target.value), 'وضعیت دوره تغییر کرد.')} className="h-7 rounded-lg border border-input bg-card px-1.5 text-[10px] font-bold">
              {Object.entries(COURSE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={busy} onClick={onAddLearner}><Plus className="size-3" aria-hidden /> شرکت‌کننده</Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-[11px]">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>{['شرکت‌کننده', 'موبایل', 'پرداخت', 'حضور', 'نمره', 'قبولی', 'گواهینامه', 'عملیات'].map((h) => <th key={h} className="whitespace-nowrap p-2 text-right font-black">{h}</th>)}</tr>
            </thead>
            <tbody>
              {c.learners.map((l) => {
                const e = edits[l.registrationId] ?? { att: String(l.attendanceCount), grade: l.finalGrade == null ? '' : String(l.finalGrade) };
                return (
                  <tr key={l.registrationId} className="border-t border-border/50">
                    <td className="p-2">
                      <div className="font-bold">{l.fullName}</div>
                      <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{l.nationalId ? faDigits(l.nationalId) : '—'} · {l.registeredAt}</div>
                    </td>
                    <td className="p-2 font-mono" dir="ltr">{l.mobile}</td>
                    <td className="p-2">
                      <Badge variant={l.paymentStatus === 'PAID' ? 'success' : l.paymentStatus === 'REFUNDED' ? 'secondary' : 'warning'} className="text-[9px]">{PAYMENT_STATUS[l.paymentStatus] ?? l.paymentStatus}</Badge>
                      {l.paymentStatus !== 'PAID' ? (
                        <button type="button" className="ms-1 text-[10px] text-indigo-600 hover:underline dark:text-indigo-300" disabled={busy} onClick={() => {
                          const ref = window.prompt('شمارهٔ پیگیری واریز:');
                          if (!ref) return;
                          const amount = window.prompt('مبلغ واریز (ریال):', String(c.tuitionPrice));
                          if (amount === null) return;
                          void run(() => confirmShortTermPayment({ registrationId: l.registrationId, paymentRefId: ref, amountPaid: Number(amount) || 0 }), 'پرداخت تأیید شد.');
                        }}>تأیید واریز</button>
                      ) : null}
                    </td>
                    <td className="p-2"><Input value={e.att} onChange={(ev) => setEdits({ ...edits, [l.registrationId]: { ...e, att: toEnDigits(ev.target.value) } })} className="h-6 w-14 text-center font-mono text-[10px]" dir="ltr" /><span className="text-[9px] text-muted-foreground">از {faNumber(l.totalSessions)}</span></td>
                    <td className="p-2"><Input value={e.grade} onChange={(ev) => setEdits({ ...edits, [l.registrationId]: { ...e, grade: toEnDigits(ev.target.value) } })} className="h-6 w-14 text-center font-mono text-[10px]" dir="ltr" /></td>
                    <td className="p-2">{l.isPassed ? <Badge variant="success" className="text-[9px]">قبول</Badge> : <Badge variant="secondary" className="text-[9px]">—</Badge>}</td>
                    <td className="p-2 font-mono text-[10px]" dir="ltr">{l.certificateNumber ?? '—'}</td>
                    <td className="whitespace-nowrap p-2">
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => void saveRow(l)}>ذخیره</Button>
                      {l.certificateIssued ? (
                        <Button size="sm" variant="destructive" className="ms-1 h-6 px-2 text-[10px]" disabled={busy} onClick={() => {
                          const why = window.prompt('دلیل ابطال:') ?? '';
                          if (l.certificateNumber) void run(() => revokeShortTermCertificate(l.certificateNumber as string, why), 'گواهینامه باطل شد.');
                        }}>ابطال</Button>
                      ) : (
                        <Button size="sm" className="ms-1 h-6 px-2 text-[10px]" disabled={busy || !l.isPassed} onClick={() => void run(async () => {
                          const r = await issueShortTermCertificate(l.registrationId);
                          onMsg({ kind: 'ok', text: `گواهینامه ${r.certificateNumber} صادر شد.` });
                        }, 'گواهینامه صادر شد.')}><Award className="size-3" aria-hidden /> گواهینامه</Button>
                      )}
                      {l.discountCode ? <div className="mt-0.5 text-[9px] text-muted-foreground">تخفیف: {l.discountCode}</div> : null}
                    </td>
                  </tr>
                );
              })}
              {c.learners.length === 0 ? <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">شرکت‌کننده‌ای ثبت نشده است.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function CourseForm({ onClose, onSaved }: { onClose: () => void; onSaved: (text: string) => Promise<void> }) {
  const [form, setForm] = useState({ code: '', title: '', titleEn: '', category: 'مهندسی و فناوری', hours: '30', tuitionPrice: '5000000', capacity: '30', instructorName: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setErr('');
    try {
      await createShortCourse({ ...form, hours: Number(form.hours), tuitionPrice: Number(form.tuitionPrice), capacity: Number(form.capacity) });
      await onSaved('دورهٔ جدید ایجاد شد.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطا');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} dir="rtl">
      <div className="max-h-[90vh] w-full max-w-lg space-y-2 overflow-y-auto rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="font-bold">دورهٔ آزاد جدید</h2><button type="button" onClick={onClose}><X className="size-5" aria-hidden /></button></div>
        {err ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div> : null}
        <div className="grid grid-cols-2 gap-2">
          {([['code', 'کد دوره'], ['title', 'عنوان فارسی'], ['titleEn', 'عنوان انگلیسی'], ['category', 'دسته'], ['hours', 'ساعت'], ['tuitionPrice', 'شهریه (ریال)'], ['capacity', 'ظرفیت'], ['instructorName', 'مدرس']] as const).map(([k, l]) => (
            <label key={k} className="space-y-1 text-[10px] text-muted-foreground"><span>{l}</span><Input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="h-8 text-[11px]" dir={k === 'hours' || k === 'tuitionPrice' || k === 'capacity' || k === 'code' ? 'ltr' : 'auto'} /></label>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2"><Button size="sm" variant="outline" onClick={onClose}>انصراف</Button><Button size="sm" disabled={busy} onClick={() => void save()}>ذخیره</Button></div>
      </div>
    </div>
  );
}

function LearnerForm({ course, onClose, onSaved }: { course: ShortTermCourse; onClose: () => void; onSaved: (text: string) => Promise<void> }) {
  const [form, setForm] = useState({ fullName: '', fullNameEn: '', nationalId: '', mobile: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setErr('');
    try {
      const r = await addShortTermLearner({ courseId: course.id, ...form });
      await onSaved(`شرکت‌کننده ثبت شد — کد رهگیری ${r.trackingCode}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطا');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} dir="rtl">
      <div className="w-full max-w-md space-y-2 rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="font-bold">ثبت شرکت‌کننده — {course.title}</h2><button type="button" onClick={onClose}><X className="size-5" aria-hidden /></button></div>
        {err ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div> : null}
        {([['fullName', 'نام و نام خانوادگی'], ['fullNameEn', 'نام انگلیسی'], ['nationalId', 'کد ملی'], ['mobile', 'موبایل']] as const).map(([k, l]) => (
          <label key={k} className="block space-y-1 text-[10px] text-muted-foreground"><span>{l}</span><Input value={form[k]} onChange={(e) => setForm({ ...form, [k]: toEnDigits(e.target.value) })} className="h-8 text-[11px]" /></label>
        ))}
        <div className="flex justify-end gap-2 pt-1"><Button size="sm" variant="outline" onClick={onClose}>انصراف</Button><Button size="sm" disabled={busy || !form.fullName.trim() || !form.mobile.trim()} onClick={() => void save()}>ثبت</Button></div>
      </div>
    </div>
  );
}

function DiscountsCard({ discounts, courses, onMsg, onRefresh }: {
  discounts: { id: number; code: string; courseId: number | null; discountPercent: number; maxDiscountAmount: number | null; maxUsage: number; usedCount: number; isActive: boolean }[];
  courses: ShortTermCourse[];
  onMsg: (m: { kind: 'ok' | 'err'; text: string }) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [form, setForm] = useState({ code: '', courseId: '', discountPercent: '20', maxDiscountAmount: '', maxUsage: '100' });
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      await createShortTermDiscount({
        code: form.code, courseId: form.courseId ? Number(form.courseId) : null,
        discountPercent: Number(form.discountPercent),
        maxDiscountAmount: form.maxDiscountAmount ? Number(form.maxDiscountAmount) : null,
        maxUsage: form.maxUsage ? Number(form.maxUsage) : null,
      });
      onMsg({ kind: 'ok', text: 'کد تخفیف ساخته شد.' });
      setForm({ ...form, code: '' });
      await onRefresh();
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        <h3 className="flex items-center gap-1 text-xs font-black"><BadgePercent className="size-4" aria-hidden /> کدهای تخفیف دوره‌های آزاد</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-[10px] text-muted-foreground"><span>کد</span><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="h-8 w-32 font-mono" dir="ltr" /></label>
          <label className="space-y-1 text-[10px] text-muted-foreground"><span>دوره (خالی = همه)</span>
            <select value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })} className="h-8 max-w-56 rounded-lg border border-input bg-card px-1.5 text-[11px]">
              <option value="">همهٔ دوره‌ها</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-[10px] text-muted-foreground"><span>درصد</span><Input type="number" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: e.target.value })} className="h-8 w-20 font-mono" dir="ltr" /></label>
          <label className="space-y-1 text-[10px] text-muted-foreground"><span>سقف مبلغ</span><Input type="number" value={form.maxDiscountAmount} onChange={(e) => setForm({ ...form, maxDiscountAmount: e.target.value })} className="h-8 w-28 font-mono" dir="ltr" /></label>
          <label className="space-y-1 text-[10px] text-muted-foreground"><span>سهمیه</span><Input type="number" value={form.maxUsage} onChange={(e) => setForm({ ...form, maxUsage: e.target.value })} className="h-8 w-20 font-mono" dir="ltr" /></label>
          <Button size="sm" disabled={busy || !form.code.trim()} onClick={() => void create()}>ساخت</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-[11px]">
            <thead className="bg-muted/60 text-muted-foreground"><tr>{['کد', 'دوره', 'درصد', 'سقف مبلغ', 'مصرف', 'فعال', ''].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id} className="border-t border-border/50">
                  <td className="p-2 font-mono font-bold" dir="ltr">{d.code}</td>
                  <td className="p-2">{d.courseId ? courses.find((c) => c.id === d.courseId)?.title ?? `#${d.courseId}` : 'همه'}</td>
                  <td className="p-2 font-mono">{faNumber(d.discountPercent)}٪</td>
                  <td className="p-2 font-mono">{d.maxDiscountAmount == null ? '—' : faNumber(d.maxDiscountAmount)}</td>
                  <td className="p-2 font-mono">{faNumber(d.usedCount)}/{faNumber(d.maxUsage)}</td>
                  <td className="p-2">{d.isActive ? '✅' : '⛔'}</td>
                  <td className="p-2"><Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={async () => {
                    try { await toggleShortTermDiscount(d.id, !d.isActive); await onRefresh(); } catch (e) { onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' }); }
                  }}>{d.isActive ? 'غیرفعال' : 'فعال'}</Button></td>
                </tr>
              ))}
              {discounts.length === 0 ? <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">کد تخفیفی ثبت نشده است.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

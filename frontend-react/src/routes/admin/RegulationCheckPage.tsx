import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, ScanSearch, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { faDigits, faNumber } from '@/lib/fa';
import {
  applySamaFixes,
  requestStepUp,
  scanGraduatedWithoutGrades,
  scanSamaMismatches,
  type SamaMismatchRow,
  type StatusMismatchRow,
} from '@/lib/regulation-api';

// ═══ Sama grade status code check + graduation discrepancy — port of regulation-check ═══

export function AdminRegulationCheckPage() {
  const [rows, setRows] = useState<SamaMismatchRow[]>([]);
  const [scanned, setScanned] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [pendingIds, setPendingIds] = useState<number[]>([]);

  const [statusRows, setStatusRows] = useState<StatusMismatchRow[]>([]);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const scanMut = useMutation({
    mutationFn: scanSamaMismatches,
    onSuccess: (res) => {
      setRows(res.rows);
      setScanned(res.scanned);
      setTruncated(res.truncated);
      setSelected(new Set());
      setMsg({
        kind: 'ok',
        text: res.rows.length === 0
          ? `مغایرتی در ${faNumber(res.scanned)} نمرهٔ بررسی‌شده نیست.`
          : `${faNumber(res.rows.length)} نمره با کد نادرست پیدا شد (از ${faNumber(res.scanned)} بررسی‌شده${res.truncated ? ' — اسکن محدود به ۲۰۰۰ ردیف اول است' : ''}).`,
      });
    },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  const applyMut = useMutation({
    mutationFn: applySamaFixes,
    onSuccess: (res) => {
      setMsg({ kind: 'ok', text: `${faNumber(res.applied)} نمره اصلاح شد.` });
      setStepUpOpen(false);
      setStepUpPassword('');
      scanMut.mutate();
    },
    onError: (e: Error) => {
      if (e.message.startsWith('STEPUP_REQUIRED:')) {
        setMsg({ kind: 'err', text: e.message.replace('STEPUP_REQUIRED:', '') });
        setStepUpOpen(true);
        return;
      }
      setMsg({ kind: 'err', text: e.message });
    },
  });

  const stepUpMut = useMutation({
    mutationFn: async () => {
      await requestStepUp('grades:edit', stepUpPassword);
      return applySamaFixes(pendingIds);
    },
    onSuccess: (res) => {
      setMsg({ kind: 'ok', text: `${faNumber(res.applied)} نمره اصلاح شد.` });
      setStepUpOpen(false);
      setStepUpPassword('');
      scanMut.mutate();
    },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  const statusMut = useMutation({
    mutationFn: () => scanGraduatedWithoutGrades(200),
    onSuccess: (res) => {
      setStatusRows(res.rows);
      setStatusMsg({ kind: 'ok', text: res.rows.length === 0 ? 'مغایرتی یافت نشد.' : `${faNumber(res.rows.length)} فارغ‌التحصیل بدون سابقهٔ نمره پیدا شد.` });
    },
    onError: (e: Error) => setStatusMsg({ kind: 'err', text: e.message }),
  });

  const filtered = rows.filter((r) => !filter || r.studentCode.includes(filter) || r.courseCode.includes(filter) || r.studentName.includes(filter));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((r) => r.enrollmentId)));
    }
  }

  function startApply(ids: number[]) {
    if (ids.length === 0) {
      setMsg({ kind: 'err', text: 'ابتدا نمراتی را انتخاب کنید.' });
      return;
    }
    setPendingIds(ids);
    applyMut.mutate(ids);
  }

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-900 via-indigo-950 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black"><ShieldCheck className="size-5" aria-hidden /> بررسی کدهای وضعیت نمرهٔ سما (آیین‌نامه)</h1>
          <p className="mt-1 text-xs text-indigo-200">همهٔ نمرات تثبیت‌شده با محاسبهٔ مجدد آیین‌نامه مقایسه می‌شود؛ کدهای قدیمی کپی‌شده از سما ممکن است نادرست باشند.</p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={scanMut.isPending} onClick={() => scanMut.mutate()}><ScanSearch className="size-4" aria-hidden /> {scanMut.isPending ? 'در حال بررسی…' : 'اسکن همهٔ نمرات'}</Button>
        {rows.length > 0 ? (
          <>
            <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300" disabled={applyMut.isPending || selected.size === 0} onClick={() => startApply([...selected])}>
              اصلاح انتخاب‌شده ({faNumber(selected.size)})
            </Button>
            <Button size="sm" variant="destructive" disabled={applyMut.isPending} onClick={() => startApply(rows.map((r) => r.enrollmentId))}>
              اصلاح همه ({faNumber(rows.length)})
            </Button>
          </>
        ) : null}
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="جستجوی کد دانشجویی / کد درس / نام…" className="h-8 max-w-xs text-[11px]" />
      </div>

      {msg ? <Alert kind={msg.kind} text={msg.text} /> : null}

      {rows.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">نمایش {faNumber(filtered.length)} از {faNumber(rows.length)} نمرهٔ نادرست{scanned != null ? ` — ${faNumber(scanned)} نمره بررسی شد` : ''}{truncated ? ' (اسکن محدود)' : ''}</p>
      ) : null}

      {rows.length > 0 ? (
        <Card>
          <CardContent className="overflow-x-auto pt-4">
            <table className="w-full border-collapse text-right text-[11px]">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="p-2"><input type="checkbox" className="size-3.5 accent-indigo-600" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} aria-label="انتخاب همه" /></th>
                  {['کد دانشجویی', 'نام', 'ترم', 'کد درس', 'نام درس', 'نمره', 'کد اصلی سما', 'کد فعلی', 'کد صحیح', 'عنوان صحیح', 'آیین‌نامه'].map((h) => (
                    <th key={h} className="whitespace-nowrap p-2 text-right font-black">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.enrollmentId} className={`cursor-pointer border-t border-border/50 ${selected.has(r.enrollmentId) ? 'bg-indigo-50 dark:bg-indigo-950/30' : ''}`} onClick={() => toggle(r.enrollmentId)}>
                    <td className="p-2"><input type="checkbox" className="size-3.5 accent-indigo-600" checked={selected.has(r.enrollmentId)} onChange={() => toggle(r.enrollmentId)} onClick={(e) => e.stopPropagation()} aria-label={`انتخاب ${r.studentCode}`} /></td>
                    <td className="p-2 font-mono">{r.studentCode}</td>
                    <td className="p-2">{r.studentName}</td>
                    <td className="p-2 font-mono">{r.termCode}</td>
                    <td className="p-2 font-mono">{r.courseCode}</td>
                    <td className="p-2">{r.courseTitle}</td>
                    <td className="p-2 text-center font-mono font-bold">{r.gradeValue == null ? '—' : faDigits(r.gradeValue.toFixed(2)).replace('.', '٫')}</td>
                    <td className="p-2 text-center font-mono"><Badge variant="secondary" className="text-[10px]">{r.originalCode || '—'}</Badge></td>
                    <td className="p-2 text-center font-mono"><Badge variant="destructive" className="text-[10px]">{r.currentCode || '—'}</Badge></td>
                    <td className="p-2 text-center font-mono"><Badge variant="success" className="text-[10px]">{r.correctCode || '—'}</Badge></td>
                    <td className="p-2 text-[10px]">{r.correctTitle}</td>
                    <td className="p-2 text-[10px] text-muted-foreground">{r.regulationTitle || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        !scanMut.isPending && !msg ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">دکمهٔ «اسکن همهٔ نمرات» را بزنید تا کدهای وضعیت بررسی شوند.</CardContent></Card> : null
      )}

      <Card className="border-t-4 border-t-slate-700">
        <CardContent className="space-y-3 pt-4">
          <h2 className="text-sm font-black">مغایرت وضعیت فارغ‌التحصیلی</h2>
          <p className="text-[11px] text-muted-foreground">وضعیت فارغ‌التحصیلی از دادهٔ ثبتی می‌آید؛ اگر نه نمرهٔ نهایی و نه سابقهٔ legacy ثبت شده باشد، جزئیات نمراتش در اکسپورت سما جا مانده است.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={statusMut.isPending} onClick={() => statusMut.mutate()}>{statusMut.isPending ? 'در حال بررسی…' : 'اسکن فارغ‌التحصیلان بدون نمره'}</Button>
            {statusMsg ? <Alert kind={statusMsg.kind} text={statusMsg.text} /> : null}
          </div>
          {statusRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-[11px]">
                <thead className="bg-muted/60 text-muted-foreground"><tr>{['کد دانشجویی', 'نام', 'تاریخ فراغت', 'آیین‌نامه'].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
                <tbody>
                  {statusRows.map((r) => (
                    <tr key={r.studentId} className="border-t border-border/50">
                      <td className="p-2 font-mono">{r.studentCode}</td>
                      <td className="p-2">{r.studentName}</td>
                      <td className="p-2 font-mono">{r.graduateDate || '—'}</td>
                      <td className="p-2 text-[10px] text-muted-foreground">{r.regulationTitle || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {stepUpOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setStepUpOpen(false)} dir="rtl">
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1 text-sm font-black"><KeyRound className="size-4" aria-hidden /> تأیید دومرحله‌ای</h2>
              <button type="button" onClick={() => setStepUpOpen(false)}><X className="size-4" aria-hidden /><span className="sr-only">بستن</span></button>
            </div>
            <p className="text-[11px] text-muted-foreground">برای اعمال اصلاحات کد سما، رمز عبور خود را تأیید کنید. اعتبار تأیید ۱۰ دقیقه است.</p>
            <Input type="password" value={stepUpPassword} onChange={(e) => setStepUpPassword(e.target.value)} placeholder="رمز عبور" className="h-9" autoFocus />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setStepUpOpen(false)}>انصراف</Button>
              <Button size="sm" disabled={stepUpMut.isPending || !stepUpPassword} onClick={() => stepUpMut.mutate()}>تأیید و اصلاح</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Alert({ kind, text }: { kind: 'ok' | 'err'; text: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>
      {kind === 'err' ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : null}
      <span>{text}</span>
    </div>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, RefreshCw, Users } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  approveProposal,
  getDefenseBoard,
  recordDefenseResult,
  saveDefensePool,
  scheduleDefense,
  supervisorApproveDefense,
  toggleDefensePool,
  type DefenseBoard,
  type DefenseBoardRow,
} from '@/lib/defense-api';

// ═══ میز برنامه‌ریزی و ثبت نتیجهٔ دفاع — پورت admin/defense-scheduling ═══

const PROPOSAL_LABEL: Record<string, string> = {
  NOT_STARTED: 'شروع نشده', SUBMITTED: 'ارسال‌شده', SIMILARITY_CHECK: 'بررسی همانندی',
  SIMILARITY_PASSED: 'همانندی مجاز', SIMILARITY_HIGH: 'همانندی بالا', EXPERT_REVIEW: 'بررسی کارشناس',
  APPROVED: 'تأییدشده', REJECTED: 'ردشده', PRIOR_REJECTED: 'رد پیشینه',
};
const DEFENSE_LABEL: Record<string, string> = {
  NOT_REQUESTED: 'درخواست نشده', SUPERVISOR_REVIEW: 'بررسی راهنما', SUPERVISOR_REJECTED: 'رد راهنما',
  EXPERT_REVIEW: 'بررسی کارشناس', SCHEDULED: 'زمان‌بندی‌شده', CONDUCTED: 'برگزارشده',
  PASSED: 'قبول', FAILED: 'مردود',
};

function jdt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
  } catch {
    return '—';
  }
}
const inputDateTime = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function AdminDefenseSchedulingPage() {
  const qc = useQueryClient();
  const { data: board, isLoading, isError } = useQuery({ queryKey: ['defense-board'], queryFn: getDefenseBoard, staleTime: 15_000 });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tracking, setTracking] = useState<Record<number, string>>({});
  const [scheduled, setScheduled] = useState<Record<number, string>>({});
  const [resultAt, setResultAt] = useState<Record<number, string>>({});
  const [resultOf, setResultOf] = useState<Record<number, 'PASSED' | 'FAILED' | 'CONDITIONAL'>>({});
  const [minutesOf, setMinutesOf] = useState<Record<number, string>>({});

  async function run(fn: () => Promise<DefenseBoard>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const next = await fn();
      qc.setQueryData(['defense-board'], next);
      setMsg({ kind: 'ok', text: okText });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !board) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت میز دفاع ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-fuchsia-800 via-violet-800 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-black"><Gavel className="size-5" aria-hidden /> برنامه‌ریزی و ثبت نتیجهٔ دفاع پایان‌نامه</h1>
            <p className="mt-1 text-xs text-violet-100">
              {board.canManage
                ? 'تأیید پروپوزال/ایرانداک، تعیین وقت دفاع با انتخاب خودکار اتاق و هیأت داوران، ثبت نتیجه و مدیریت استخر داوران.'
                : 'پرونده‌های راهنمایی شما؛ تأیید/رد درخواست دفاع.'}
            </p>
          </div>
          <Button size="sm" variant="outline" className="border-white/25 bg-white/15 text-white hover:bg-white/25" disabled={busy} onClick={() => void run(getDefenseBoard, 'میز به‌روزرسانی شد.')}>
            <RefreshCw className="size-4" aria-hidden /> به‌روزرسانی
          </Button>
        </CardContent>
      </Card>

      {msg ? <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>{msg.text}</div> : null}

      {board.groups.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">پروندهٔ دفاعی در جریان نیست.</CardContent></Card> : null}

      {board.groups.map((g) => (
        <div key={g.status} className="space-y-2">
          <h2 className="text-xs font-black text-muted-foreground">{PROPOSAL_LABEL[g.status] ?? g.status} ({faNumber(g.rows.length)})</h2>
          <div className="grid gap-2 lg:grid-cols-2">
            {g.rows.map((r: DefenseBoardRow) => (
              <Card key={r.auditId}>
                <CardContent className="space-y-2 pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[12px] font-black">{r.fullName} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{faDigits(r.studentCode)}</span></p>
                      <p className="text-[10px] text-muted-foreground">{r.majorName ?? '—'} · {r.titleFa ?? 'بدون عنوان پایان‌نامه'}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary" className="text-[9px]">{PROPOSAL_LABEL[r.proposalStatus ?? ''] ?? r.proposalStatus ?? '—'}</Badge>
                      {r.proposalSimilarity != null ? <Badge variant="outline" className="text-[9px]">همانندی {faNumber(r.proposalSimilarity)}٪</Badge> : null}
                      <Badge variant={r.defenseResult === 'PASSED' ? 'success' : r.defenseResult === 'FAILED' ? 'destructive' : 'accent'} className="text-[9px]">{DEFENSE_LABEL[r.defenseRequestStatus ?? ''] ?? r.defenseRequestStatus ?? '—'}</Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                    <span>استاد راهنما: {r.supervisorName ?? '—'}</span>
                    <span>ایرانداک: {r.irandocUploadStatus ?? '—'} {r.irandocUploadTracking ? `(${r.irandocUploadTracking})` : ''}</span>
                    <span>زمان دفاع: {jdt(r.defenseScheduledAt)}</span>
                    <span>اتاق: {r.roomName ?? '—'}</span>
                    {r.pool ? <span className="col-span-2">هیأت داور پیش‌بینی‌شده: {r.pool.chair ?? '—'} / {r.pool.internal ?? '—'} / {r.pool.external ?? '—'} (استخر {r.pool.departmentCode})</span> : null}
                    {r.defenseNote ? <span className="col-span-2">صورت‌جلسه: {r.defenseNote}</span> : null}
                  </div>

                  {board.canManage ? (
                    <div className="space-y-1.5 border-t border-border/60 pt-2">
                      {(r.proposalStatus === 'SIMILARITY_PASSED' || r.proposalStatus === 'EXPERT_REVIEW') ? (
                        <div className="flex flex-wrap gap-1">
                          <Input value={tracking[r.auditId] ?? ''} onChange={(e) => setTracking({ ...tracking, [r.auditId]: e.target.value })} placeholder="کد رهگیری بارگذاری ایرانداک…" className="h-7 min-w-40 flex-1 text-[10px]" dir="ltr" />
                          <Button size="sm" className="h-7 text-[10px]" disabled={busy} onClick={() => void run(() => approveProposal(r.auditId, tracking[r.auditId] ?? ''), 'پروپوزال تأیید شد.')}>تأیید پروپوزال</Button>
                        </div>
                      ) : null}
                      {r.defenseRequestStatus === 'EXPERT_REVIEW' ? (
                        <div className="flex flex-wrap gap-1">
                          <Input type="datetime-local" value={scheduled[r.auditId] ?? inputDateTime(new Date(Date.now() + 7 * 86400_000))} onChange={(e) => setScheduled({ ...scheduled, [r.auditId]: e.target.value })} className="h-7 w-48 text-[10px]" />
                          <Button size="sm" className="h-7 text-[10px]" disabled={busy} onClick={() => void run(() => scheduleDefense(r.auditId, new Date(scheduled[r.auditId] ?? inputDateTime(new Date(Date.now() + 7 * 86400_000))).toISOString()), 'زمان دفاع ثبت شد.')}>تعیین وقت دفاع</Button>
                        </div>
                      ) : null}
                      {(r.defenseRequestStatus === 'SCHEDULED' || r.defenseRequestStatus === 'CONDUCTED' || r.defenseRequestStatus === 'PASSED' || r.defenseRequestStatus === 'FAILED') ? (
                        <div className="flex flex-wrap gap-1">
                          <select value={resultOf[r.auditId] ?? 'PASSED'} onChange={(e) => setResultOf({ ...resultOf, [r.auditId]: e.target.value as 'PASSED' })} className="h-7 rounded-lg border border-input bg-card px-1.5 text-[10px]">
                            <option value="PASSED">قبول</option><option value="CONDITIONAL">قبول مشروط</option><option value="FAILED">مردود</option>
                          </select>
                          <Input type="datetime-local" value={resultAt[r.auditId] ?? inputDateTime(new Date())} onChange={(e) => setResultAt({ ...resultAt, [r.auditId]: e.target.value })} className="h-7 w-44 text-[10px]" />
                          <Input value={minutesOf[r.auditId] ?? ''} onChange={(e) => setMinutesOf({ ...minutesOf, [r.auditId]: e.target.value })} placeholder="صورت‌جلسه…" className="h-7 min-w-32 flex-1 text-[10px]" />
                          <Button size="sm" className="h-7 text-[10px]" disabled={busy} onClick={() => void run(() => recordDefenseResult({
                            auditId: r.auditId,
                            result: resultOf[r.auditId] ?? 'PASSED',
                            minutes: minutesOf[r.auditId] || undefined,
                            conductedAt: new Date(resultAt[r.auditId] ?? inputDateTime(new Date())).toISOString(),
                          }), 'نتیجهٔ دفاع ثبت شد.')}>ثبت نتیجه</Button>
                        </div>
                      ) : null}
                    </div>
                  ) : r.defenseRequestStatus === 'SUPERVISOR_REVIEW' ? (
                    <div className="flex gap-2 border-t border-border/60 pt-2">
                      <Button size="sm" className="h-7 text-[10px]" disabled={busy} onClick={() => void run(() => supervisorApproveDefense(r.auditId, true), 'درخواست دفاع تأیید شد.')}>تأیید درخواست دفاع</Button>
                      <Button size="sm" variant="destructive" className="h-7 text-[10px]" disabled={busy} onClick={() => void run(() => supervisorApproveDefense(r.auditId, false), 'درخواست دفاع رد شد.')}>رد</Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {board.canManage ? <PoolSection board={board} onBoard={(b) => qc.setQueryData(['defense-board'], b)} onMsg={setMsg} /> : null}
    </div>
  );
}

function PoolSection({ board, onBoard, onMsg }: { board: DefenseBoard; onBoard: (b: DefenseBoard) => void; onMsg: (m: { kind: 'ok' | 'err'; text: string }) => void }) {
  const empty = { id: undefined as number | undefined, departmentCode: '', majorId: '', chairId: '', internalIds: '', externalIds: '', roomId: '', isActive: true };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const b = await saveDefensePool({
        id: form.id,
        departmentCode: form.departmentCode,
        majorId: form.majorId ? Number(form.majorId) : null,
        chairId: form.chairId ? Number(form.chairId) : null,
        internalIds: form.internalIds,
        externalIds: form.externalIds,
        roomId: form.roomId ? Number(form.roomId) : null,
        isActive: form.isActive,
      });
      onBoard(b);
      onMsg({ kind: 'ok', text: 'استخر داوران ذخیره شد.' });
      setForm(empty);
    } catch (e) {
      onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardContent className="overflow-x-auto pt-4">
          <h3 className="mb-2 flex items-center gap-1 text-xs font-black"><Users className="size-4" aria-hidden /> استخر هیأت داوران ({faNumber(board.pools.length)})</h3>
          <table className="w-full border-collapse text-right text-[11px]">
            <thead className="bg-muted/60 text-muted-foreground"><tr>{['کد دپارتمان', 'رشته', 'رئیس', 'داخلی', 'خارجی', 'اتاق', 'فعال', ''].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
            <tbody>
              {board.pools.map((p) => (
                <tr key={p.id} className="border-t border-border/50">
                  <td className="p-2 font-mono" dir="ltr">{p.departmentCode}</td>
                  <td className="p-2">{p.majorName ?? 'عمومی'}</td>
                  <td className="p-2">{p.chairId ? board.staffOptions.find((s) => s.id === p.chairId)?.name ?? `#${p.chairId}` : '—'}</td>
                  <td className="p-2 font-mono text-[10px]" dir="ltr">{p.internalIds.join(', ') || '—'}</td>
                  <td className="p-2 font-mono text-[10px]" dir="ltr">{p.externalIds.join(', ') || '—'}</td>
                  <td className="p-2">{p.roomName ?? '—'}</td>
                  <td className="p-2">{p.isActive ? '✅' : '⛔'}</td>
                  <td className="flex gap-1 p-2">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setForm({
                      id: p.id, departmentCode: p.departmentCode,
                      majorId: p.majorId == null ? '' : String(p.majorId),
                      chairId: p.chairId == null ? '' : String(p.chairId),
                      internalIds: p.internalIds.join(','), externalIds: p.externalIds.join(','),
                      roomId: p.roomId == null ? '' : String(p.roomId), isActive: p.isActive,
                    })}>ویرایش</Button>
                    <Button size="sm" variant="secondary" className="h-6 px-2 text-[10px]" disabled={busy} onClick={async () => {
                      try { onBoard(await toggleDefensePool(p.id, !p.isActive)); } catch (e) { onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' }); }
                    }}>{p.isActive ? 'غیرفعال' : 'فعال'}</Button>
                  </td>
                </tr>
              ))}
              {board.pools.length === 0 ? <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">استخری ثبت نشده است.</td></tr> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <h3 className="text-xs font-black">{form.id ? 'ویرایش استخر' : 'استخر جدید'}</h3>
          <label className="block space-y-1 text-[10px] text-muted-foreground"><span>کد دپارتمان</span><Input value={form.departmentCode} onChange={(e) => setForm({ ...form, departmentCode: e.target.value.toUpperCase() })} className="h-7 font-mono text-[11px]" dir="ltr" list="dept-codes" /></label>
          <datalist id="dept-codes">{board.departments.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}</datalist>
          <label className="block space-y-1 text-[10px] text-muted-foreground"><span>رشته (خالی = عمومی)</span>
            <select value={form.majorId} onChange={(e) => setForm({ ...form, majorId: e.target.value })} className="h-7 w-full rounded-lg border border-input bg-card px-1.5 text-[10px]">
              <option value="">عمومی</option>
              {board.majors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-[10px] text-muted-foreground"><span>رئیس هیأت</span>
            <select value={form.chairId} onChange={(e) => setForm({ ...form, chairId: e.target.value })} className="h-7 w-full rounded-lg border border-input bg-card px-1.5 text-[10px]">
              <option value="">—</option>
              {board.staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name} {s.rank ? `(${s.rank})` : ''}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-[10px] text-muted-foreground"><span>شناسهٔ داوران داخلی (با کاما)</span><Input value={form.internalIds} onChange={(e) => setForm({ ...form, internalIds: e.target.value })} className="h-7 font-mono text-[11px]" dir="ltr" /></label>
          <label className="block space-y-1 text-[10px] text-muted-foreground"><span>شناسهٔ داوران خارجی (با کاما)</span><Input value={form.externalIds} onChange={(e) => setForm({ ...form, externalIds: e.target.value })} className="h-7 font-mono text-[11px]" dir="ltr" /></label>
          <label className="block space-y-1 text-[10px] text-muted-foreground"><span>اتاق</span>
            <select value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })} className="h-7 w-full rounded-lg border border-input bg-card px-1.5 text-[10px]">
              <option value="">—</option>
              {board.rooms.map((r) => <option key={r.id} value={r.id}>{r.name} ({faNumber(r.capacity)})</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] font-bold"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> فعال</label>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" disabled={busy || !form.departmentCode.trim()} onClick={() => void save()}>ذخیره</Button>
            <Button size="sm" variant="outline" onClick={() => setForm(empty)}>جدید</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Radio, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, toEnDigits } from '@/lib/fa';
import {
  addOfferingExpert, bypassApprove, bypassReject, bypassReturn, bypassSaveSettings,
  finalizeExamHandover, getBypassBoard, getBroadcastFilters, getBroadcastHistory,
  getBroadcastOfferings, getClassSessionsBoard, getConflictTerms, getExamHandoverBoard,
  getExamHandoverQr, getOfferingEditorMeta, getOfferingEditorRows, getOfferingEditorTerms,
  loadScheduleConflicts, markConflictGroupReviewed, markOfferingsMerged, markOfferingsMergedBulk,
  previewBroadcastCount, removeOfferingExpert, saveOfferingEditor, sendBroadcast,
  toggleClassSessionFlag, undoConflictGroup,
  type BroadcastAudience, type BroadcastChannel, type BroadcastRecord, type BroadcastReport,
  type BroadcastTermOffering, type ClassSessionItem, type ConflictGroup, type LPTerm,
  type OfferingEditorRow, type ScheduleConflictReport,
} from '@/lib/last-pages-api';

// ═══ Six remaining admin pages — port of afagh-next/src/app/admin/{broadcast,
// bypass,class-sessions,exams/handover,offering-editor,schedule-conflicts} ═══

type Msg = { kind: 'ok' | 'err'; text: string } | null;

function Msg({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>{msg.text}</div>
  );
}

const faNum = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '—' : faDigits(String(v)));
const faDateTime = (v: string | null | undefined) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return faDigits(d.toLocaleDateString('fa-IR')) + ' ' + faDigits(d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }));
};
const minutesToHm = (v: number) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;

// ─── Jalali date conversion (for the exam date field in the offering editor) ───

const div = (a: number, b: number) => Math.floor(a / b);

function jalaliToGregorian(jyIn: number, jm: number, jd: number): [number, number, number] {
  const jy = jyIn + 1595;
  let days = -355668 + 365 * jy + div(jy, 33) * 8 + div((jy % 33) + 3, 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * div(days, 146097);
  days %= 146097;
  if (days > 36524) {
    days -= 1;
    gy += 100 * div(days, 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    days -= 1;
    gy += div(days, 365);
    days %= 365;
  }
  const gd = days + 1;
  const monthDays = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  let rem = gd;
  for (gm = 1; gm <= 12; gm++) {
    if (rem <= monthDays[gm]) break;
    rem -= monthDays[gm];
  }
  return [gy, gm, rem];
}

function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  const gy2 = gy <= 1600 ? gy - 621 : gy - 1600;
  const gy3 = gm > 2 ? gy2 + 1 : gy2;
  let days = 365 * gy2 + div(gy3 + 3, 4) - div(gy3 + 99, 100) + div(gy3 + 399, 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

/** 'YYYY-MM-DD' Gregorian → 'YYYY/MM/DD' Jalali for display in the form */
function gregToJalaliInput(iso: string | null | undefined): string {
  const v = String(iso ?? '').trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return '';
  const [jy, jm, jd] = gregorianToJalali(Number(m[1]), Number(m[2]), Number(m[3]));
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

/** 'YYYY/MM/DD' Jalali (Persian digits also accepted) → 'YYYY-MM-DD' Gregorian, otherwise null */
function jalaliInputToGreg(value: string): string | null {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(toEnDigits(value).trim());
  if (!m) return null;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}

const DAY_NAMES = ['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

// ═══════════════════════════ 1) Broadcast message ═══════════════════════════

const BROADCAST_CHANNELS: { key: BroadcastChannel; label: string }[] = [
  { key: 'INAPP', label: '📥 داخل پورتال' },
  { key: 'SMS', label: '📲 پیامک' },
  { key: 'SOROUSH', label: '🟣 سروش' },
  { key: 'BALE', label: '🟢 بله' },
  { key: 'EITAA', label: '🟠 ایتا' },
];

const ROLE_FA: Record<string, string> = { student: 'دانشجویان', staff: 'اساتید و کارکنان', both: 'دانشجویان + اساتید' };

export function AdminBroadcastPage() {
  const filters = useQuery({ queryKey: ['lp-broadcast-filters'], queryFn: getBroadcastFilters });
  const history = useQuery({ queryKey: ['lp-broadcast-history'], queryFn: getBroadcastHistory });
  const qc = useQueryClient();
  const [role, setRole] = useState<'student' | 'staff' | 'both'>('student');
  const [facultyId, setFacultyId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [majorId, setMajorId] = useState('');
  const [entryYear, setEntryYear] = useState('');
  const [termId, setTermId] = useState('');
  const [offeringId, setOfferingId] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [channels, setChannels] = useState<BroadcastChannel[]>(['INAPP']);
  const [text, setText] = useState('');
  const [count, setCount] = useState<{ count: number; capped: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BroadcastReport | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const f = filters.data;
  useEffect(() => {
    const cur = f?.terms.find((t) => t.isCurrent === 1);
    if (cur) setTermId(String(cur.id));
  }, [f]);

  const [offerings, setOfferings] = useState<BroadcastTermOffering[]>([]);
  const [classQuery, setClassQuery] = useState('');
  const [loadingOfferings, setLoadingOfferings] = useState(false);

  const loadOfferings = async (tid: string) => {
    setOfferingId('');
    setClassQuery('');
    setOfferings([]);
    if (!tid) return;
    setLoadingOfferings(true);
    try {
      setOfferings(await getBroadcastOfferings(Number(tid)));
    } catch {
      setOfferings([]);
    } finally {
      setLoadingOfferings(false);
    }
  };
  useEffect(() => {
    if (termId) void loadOfferings(termId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termId]);

  const fa2en = (s: string) => toEnDigits(s);
  const classMatches = useMemo(() => {
    const q = fa2en(classQuery.trim()).toLowerCase();
    if (!q) return offerings.slice(0, 60);
    const toks = q.split(/\s+/);
    return offerings.filter((o) => {
      const hay = fa2en(o.label).toLowerCase();
      return toks.every((t) => hay.includes(t));
    }).slice(0, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerings, classQuery]);

  const departments = useMemo(() => (f?.departments ?? []).filter((d) => !facultyId || d.facultyId === Number(facultyId)), [f, facultyId]);
  const majors = useMemo(() => (f?.majors ?? []).filter((m) => !departmentId || m.departmentId === Number(departmentId)), [f, departmentId]);
  const selectedOffering = offeringId ? offerings.find((o) => o.id === Number(offeringId)) : undefined;

  const audience = (): BroadcastAudience => ({
    role,
    facultyId: facultyId ? Number(facultyId) : null,
    departmentId: departmentId ? Number(departmentId) : null,
    majorId: majorId ? Number(majorId) : null,
    entryYear: entryYear ? Number(entryYear) : null,
    termId: termId ? Number(termId) : null,
    offeringId: offeringId ? Number(offeringId) : null,
    activeOnly,
  });

  const preview = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setCount(await previewBroadcastCount(audience()));
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا در ارتباط با سرور.' });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!text.trim()) {
      setMsg({ kind: 'err', text: '⛔ اول متن پیام را بنویسید.' });
      return;
    }
    const ok = window.confirm(`پیام به ${count ? faNumber(count.count) + ' نفر' : 'مخاطبان فیلترشده'} ارسال شود؟ این عمل قابل بازگشت نیست.`);
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    setReport(null);
    try {
      const r = await sendBroadcast(audience(), channels, text.trim());
      setReport(r);
      await qc.invalidateQueries({ queryKey: ['lp-broadcast-history'] });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : '⛔ خطا در ارتباط با سرور.' });
    } finally {
      setBusy(false);
    }
  };

  const toggleChannel = (c: BroadcastChannel) =>
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const sel = 'mt-1 w-full rounded-xl border border-input bg-card px-2 py-1.5 text-xs';
  const records = history.data ?? [];

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-indigo-900 to-indigo-700 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black"><Megaphone className="size-5" aria-hidden /> ارسال پیام همگانی</h1>
          <p className="mt-1 text-xs text-indigo-100">به دانشجویان یا اساتید یک رشته، گروه، دانشکده یا ورودی خاص پیام بفرستید. هر ارسال با کد رهگیری یکتا لاگ می‌شود و سقف ۵٬۰۰۰ نفر دارد.</p>
        </CardContent>
      </Card>

      <Msg msg={msg} />

      {/* ── Audiences ── */}
      <Card><CardContent className="space-y-3 pt-4">
        <h2 className="text-sm font-black">۱️⃣ مخاطبان</h2>
        <div className="flex flex-wrap gap-2">
          {(['student', 'staff', 'both'] as const).map((r) => (
            <button key={r} type="button" onClick={() => { setRole(r); setCount(null); }}
              className={`rounded-xl px-4 py-2 text-xs font-black transition ${role === r ? 'bg-indigo-700 text-white shadow' : 'bg-muted text-muted-foreground'}`}>
              {ROLE_FA[r]}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-[11px] font-bold text-muted-foreground">دانشکده
            <select value={facultyId} onChange={(e) => { setFacultyId(e.target.value); setDepartmentId(''); setMajorId(''); setCount(null); }} className={sel}>
              <option value="">همهٔ دانشکده‌ها</option>
              {(f?.faculties ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          {(role === 'student' || role === 'both') && (
            <>
              <label className="text-[11px] font-bold text-muted-foreground">گروه آموزشی
                <select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setMajorId(''); setCount(null); }} className={sel}>
                  <option value="">همهٔ گروه‌ها</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="text-[11px] font-bold text-muted-foreground">رشته
                <select value={majorId} onChange={(e) => { setMajorId(e.target.value); setCount(null); }} className={sel}>
                  <option value="">همهٔ رشته‌ها</option>
                  {majors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label className="text-[11px] font-bold text-muted-foreground">ورودی
                <select value={entryYear} onChange={(e) => { setEntryYear(e.target.value); setCount(null); }} className={sel}>
                  <option value="">همهٔ ورودی‌ها</option>
                  {(f?.entryYears ?? []).map((y) => <option key={y} value={y}>{faDigits(y)}</option>)}
                </select>
              </label>
            </>
          )}
          {role === 'staff' && (
            <label className="text-[11px] font-bold text-muted-foreground">گروه آموزشی (استاد)
              <select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setCount(null); }} className={sel}>
                <option value="">همهٔ گروه‌ها</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="flex items-center gap-2 text-[11px] font-bold">
          <input type="checkbox" checked={activeOnly} onChange={(e) => { setActiveOnly(e.target.checked); setCount(null); }} className="size-4" />
          فقط فعال‌ها (دانشجوی در حال تحصیل / پروندهٔ پرسنلی فعال)
        </label>
        {/* ── Course class filter for the term ── */}
        <div className="grid gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/40 p-2.5 sm:grid-cols-2 dark:border-indigo-800 dark:bg-indigo-950/20">
          <label className="text-[11px] font-bold text-muted-foreground">🎓 ترم (برای انتخاب کلاس)
            <select value={termId} onChange={(e) => { setTermId(e.target.value); setCount(null); }} className={sel}>
              <option value="">— بدون فیلتر ترم —</option>
              {(f?.terms ?? []).map((t: LPTerm) => (
                <option key={t.id} value={t.id}>{t.title}{t.isCurrent === 1 ? ' (جاری)' : ''}</option>
              ))}
            </select>
          </label>
          <div className="relative">
            <span className="text-[11px] font-bold text-muted-foreground">
              🏫 کلاس درس {offeringId ? '(فقط ثبت‌نام‌شدگان همین کلاس)' : '(کد درس یا گروه را تایپ کنید)'}
            </span>
            <input
              value={selectedOffering && !classQuery ? selectedOffering.label : classQuery}
              disabled={!termId || loadingOfferings}
              onChange={(e) => { setClassQuery(e.target.value); if (offeringId) { setOfferingId(''); setCount(null); } }}
              placeholder={loadingOfferings ? 'در حال بارگذاری کلاس‌ها…' : `جست‌وجو در ${faNumber(offerings.length)} کلاس`}
              className={sel + ' w-full'}
            />
            {classQuery && !selectedOffering && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
                {classMatches.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">کلاسی پیدا نشد.</p>
                ) : (
                  <>
                    <button type="button" onClick={() => { setOfferingId(''); setClassQuery(''); setCount(null); }}
                      className="block w-full p-2.5 text-right text-xs font-black text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/40">
                      همهٔ کلاس‌ها ({faNumber(offerings.length)})
                    </button>
                    {classMatches.map((o) => (
                      <button type="button" key={o.id} onClick={() => { setOfferingId(String(o.id)); setClassQuery(''); setCount(null); }}
                        className="block w-full border-t border-border/60 p-2.5 text-right text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950/40">
                        <span className="font-bold">{o.label}</span>
                        <span className="ms-2 text-[11px] text-muted-foreground">({faNumber(o.enrolled)} نفر)</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={preview}>🔍 شمارش مخاطبان</Button>
          {count && (
            <span className="text-xs font-black text-indigo-700 dark:text-indigo-300">
              {faNumber(count.count)} نفر{count.capped ? ' (سقف ۵٬۰۰۰ — فیلتر را محدودتر کنید)' : ''}
            </span>
          )}
        </div>
      </CardContent></Card>

      {/* ── Channel + text ── */}
      <Card><CardContent className="space-y-3 pt-4">
        <h2 className="text-sm font-black">۲️⃣ کانال و متن پیام</h2>
        <div className="flex flex-wrap gap-2">
          {BROADCAST_CHANNELS.map((c) => (
            <button key={c.key} type="button" onClick={() => toggleChannel(c.key)}
              className={`rounded-xl border px-3 py-1.5 text-xs font-black transition ${channels.includes(c.key) ? 'border-indigo-700 bg-indigo-700 text-white' : 'border-border bg-card text-muted-foreground'}`}>
              {c.label}
            </button>
          ))}
        </div>
        {channels.includes('SMS') && <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400">⚠️ پیامک هزینه دارد — تعداد مخاطبان را حتماً اول بشمارید.</p>}
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000}
          placeholder="متن پیام همگانی… (حداکثر ۲۰۰۰ نویسه)"
          className="w-full rounded-2xl border border-input bg-card p-3 text-sm leading-7" />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{faDigits(text.length)} / ۲۰۰۰ نویسه</span>
          <Button size="sm" disabled={busy} onClick={send}>{busy ? 'در حال ارسال…' : '🚀 ارسال همگانی'}</Button>
        </div>
      </CardContent></Card>

      {report && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50/70 p-4 text-xs leading-7 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          <p className="font-black">✅ ارسال تمام شد — {faNumber(report.total)} مخاطب:</p>
          <ul className="mt-1 list-disc ps-5">
            <li>📥 صندوق داخل پورتال: <strong>{faNumber(report.inbox)} نفر</strong> (همه این را می‌بینند)</li>
            {report.channels.map((c) => (
              <li key={c.channel}>
                {c.channel}: <strong>{faNumber(c.sent)} ارسال شد</strong>
                {c.skipped > 0 && <span> · {faNumber(c.skipped)} نفر عضو این کانال نیستند</span>}
                {c.failed > 0 && <span className="text-red-700 dark:text-red-400"> · {faNumber(c.failed)} خطا</span>}
              </li>
            ))}
            {report.failedRequests > 0 && <li className="text-red-700 dark:text-red-400">{faNumber(report.failedRequests)} درخواست کلاً به خطا خورد.</li>}
          </ul>
        </div>
      )}

      {/* ── Send history ── */}
      <Card>
        <button type="button" onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center justify-between p-4 text-sm font-black">
          <span>🗂️ چه پیام‌هایی قبلاً به کجاها ارسال شده ({faNumber(records.length)})</span>
          <span>{historyOpen ? '▴' : '▾'}</span>
        </button>
        {historyOpen && (
          <div className="space-y-2 border-t border-border/60 p-4">
            {records.length === 0 ? (
              <p className="text-xs text-muted-foreground">هنوز ارسال همگانی ثبت نشده است.</p>
            ) : records.map((h: BroadcastRecord) => (
              <div key={h.eventCode} className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs leading-6">
                <p className="font-bold">{h.body || '—'}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  👤 {h.sender} · 🕐 {faDateTime(h.sentAt)} · 👥 {faNumber(h.total)} نفر · 📥 صندوق: {faNumber(h.inbox)}
                </p>
                {h.channels.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {h.channels.map((c) => `${c.channel}: ${faNumber(c.sent)} ارسال / ${faNumber(c.skipped)} بدون اتصال / ${faNumber(c.failed)} خطا`).join(' · ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════ 2) Bypass approval ═══════════════════════════

const BYPASS_KIND_LABEL: Record<string, string> = { PREREQ: 'پیش‌نیاز', EXAM_CONFLICT: 'تداخل امتحانی' };
const BYPASS_REASON_LABEL: Record<string, string> = {
  LOW_GPA_PREV_TERM: 'معدل پایین ترم قبل',
  GROUP_COUNCIL_DISAGREE: 'مخالفت شورای گروه',
  UNRESOLVABLE_EXAM_CONFLICT: 'تداخل امتحانی غیرقابل رفع',
  OTHER: 'سایر (توضیح تکمیلی)',
  NO_RESPONSE: 'بدون پاسخ در مهلت تعیین‌شده',
};
const BYPASS_STATUS_LABEL: Record<string, string> = {
  PENDING_MANAGER: 'در انتظار مدیر گروه',
  ESCALATED_EXPERT: 'ارجاع به کارشناس آموزش',
  APPROVED: 'تأیید و ثبت شد',
  REJECTED: 'رد شد',
  AUTO_REJECTED: 'رد خودکار (بدون پاسخ)',
  CANCELLED: 'لغو شد',
};
const BYPASS_STATUS_STYLE: Record<string, string> = {
  PENDING_MANAGER: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200',
  ESCALATED_EXPERT: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  APPROVED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200',
  REJECTED: 'bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200',
  AUTO_REJECTED: 'bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300',
};
const MANUAL_REASONS = ['LOW_GPA_PREV_TERM', 'GROUP_COUNCIL_DISAGREE', 'UNRESOLVABLE_EXAM_CONFLICT', 'OTHER'] as const;
type ManualReason = (typeof MANUAL_REASONS)[number];

function BypassCard({ r, canAct, canReturn, busy, onApprove, onReject, onReturn }: {
  r: { id: number; courseTitle: string; courseCode: string; studentName: string; studentCode: string; majorName: string | null; kind: string; status: string; units: number; reasonCode: string | null; reasonText: string | null; managerDeadlineAt: string | null; expertDeadlineAt: string | null; createdAt: string | null };
  canAct: boolean; canReturn: boolean; busy: boolean;
  onApprove: () => void;
  onReject: (code: ManualReason, text: string) => void;
  onReturn: (target: 'MANAGER' | 'EXPERT') => void;
}) {
  const [openReject, setOpenReject] = useState(false);
  const [reasonCode, setReasonCode] = useState<ManualReason>('LOW_GPA_PREV_TERM');
  const [reasonText, setReasonText] = useState('');
  const deadline = r.status === 'ESCALATED_EXPERT' ? r.expertDeadlineAt : r.managerDeadlineAt;
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="text-sm font-black">{r.courseTitle} <span className="font-mono text-xs text-muted-foreground">({r.courseCode})</span></p>
          <p className="text-xs text-muted-foreground">{r.studentName} · شمارهٔ دانشجویی {faNum(r.studentCode)} {r.majorName ? `· ${r.majorName}` : ''}</p>
          <p className="text-xs text-muted-foreground">نوع: <span className="font-bold">{BYPASS_KIND_LABEL[r.kind] ?? r.kind}</span> · واحد: {faNum(r.units)}</p>
        </div>
        <div className="space-y-1 text-left text-xs">
          <Badge className={BYPASS_STATUS_STYLE[r.status] ?? ''}>{BYPASS_STATUS_LABEL[r.status] ?? r.status}</Badge>
          {canAct ? <p className="text-muted-foreground">مهلت تصمیم: {faDateTime(deadline)}</p> : <p className="text-muted-foreground">ثبت: {faDateTime(r.createdAt)}</p>}
        </div>
      </div>
      {!canAct && r.reasonCode && (
        <p className="rounded-xl bg-muted/40 p-2 text-xs">
          دلیل: <span className="font-bold">{BYPASS_REASON_LABEL[r.reasonCode] ?? r.reasonCode}</span>{r.reasonText ? ` — ${r.reasonText}` : ''}
        </p>
      )}
      {canAct && (openReject ? (
        <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900 dark:bg-rose-950/20">
          <label className="block text-xs font-bold text-rose-900 dark:text-rose-300">دلیل رد (الزامی)</label>
          <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as ManualReason)}
            className="w-full rounded-lg border border-rose-300 bg-card p-2 text-xs">
            {MANUAL_REASONS.map((code) => <option key={code} value={code}>{BYPASS_REASON_LABEL[code]}</option>)}
          </select>
          <textarea value={reasonText} onChange={(e) => setReasonText(e.target.value)} rows={2}
            placeholder={reasonCode === 'OTHER' ? 'توضیح تکمیلی (الزامی)' : 'توضیح تکمیلی (اختیاری)'}
            className="w-full rounded-lg border border-rose-300 bg-card p-2 text-xs" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" disabled={busy || (reasonCode === 'OTHER' && !reasonText.trim())}
              onClick={() => onReject(reasonCode, reasonText)}>ثبت رد</Button>
            <Button size="sm" variant="outline" onClick={() => { setOpenReject(false); setReasonText(''); }}>انصراف</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={onApprove}>✅ تأیید و ثبت درس</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpenReject(true)}>❌ رد درخواست</Button>
          {canReturn && (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onReturn('MANAGER')}>↩︎ بازگرداندن به مدیر گروه</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onReturn('EXPERT')}>↩︎ ارجاع دوباره به کارشناس</Button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function AdminBypassPage() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['lp-bypass-board'], queryFn: getBypassBoard });
  const [msg, setMsg] = useState<Msg>(null);
  const [tab, setTab] = useState<'INBOX' | 'VICE'>('VICE');
  const [viceFilter, setViceFilter] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const [busyId, setBusyId] = useState<number | null>(null);

  const d = data.data;
  useEffect(() => {
    if (d) setTab(d.isExpert && d.expertRows.length > 0 ? 'INBOX' : 'VICE');
  }, [d]);

  const refresh = async () => { await qc.invalidateQueries({ queryKey: ['lp-bypass-board'] }); };

  const run = async (id: number, fn: () => Promise<unknown>) => {
    setMsg(null);
    setBusyId(id);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'عملیات ناموفق بود.' });
    } finally {
      setBusyId(null);
    }
  };

  if (data.isLoading) return <Skeleton className="h-72 w-full" />;
  if (data.isError || !d) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت کارتابل bypass ناموفق بود.</CardContent></Card>;

  const openVice = d.viceRows.filter((r) => r.status === 'PENDING_MANAGER' || r.status === 'ESCALATED_EXPERT');
  const closedVice = d.viceRows.filter((r) => r.status !== 'PENDING_MANAGER' && r.status !== 'ESCALATED_EXPERT');
  const list = tab === 'INBOX' ? d.expertRows : viceFilter === 'OPEN' ? openVice : closedVice;

  return (
    <div className="space-y-4">
      <Card><CardContent className="pt-4">
        <h1 className="flex items-center gap-2 text-lg font-black"><ShieldCheck className="size-5" aria-hidden /> درخواست‌های بدون رعایت پیش‌نیاز / تداخل امتحانی</h1>
        <p className="mt-1 text-xs leading-6 text-muted-foreground">
          صندلی درس تا زمان تصمیم برای دانشجو رزرو می‌ماند؛ اگر تا پایان مهلت تصمیمی ثبت نشود، درخواست به‌صورت خودکار رد و صندلی آزاد می‌شود.
          معاون آموزش می‌تواند تصمیم بگیرد یا درخواست را به مدیر گروه / کارشناس برگرداند.
        </p>
      </CardContent></Card>

      {d.isAdmin && d.currentTerms.length > 0 && (
        <Card className="border-indigo-200 bg-indigo-50/50 dark:border-indigo-900 dark:bg-indigo-950/20"><CardContent className="space-y-3 pt-4">
          <h2 className="text-sm font-black">⏱️ مهلت‌های تصمیم‌گیری (تنظیمات نیمسال جاری)</h2>
          {d.currentTerms.map((t) => (
            <SettingsForm key={t.id} t={t} onSave={bypassSaveSettings} onSaved={async () => { setMsg({ kind: 'ok', text: 'مهلت‌ها ذخیره شد.' }); await refresh(); }} onError={(text) => setMsg({ kind: 'err', text })} />
          ))}
        </CardContent></Card>
      )}

      <Msg msg={msg} />

      <div className="flex flex-wrap gap-2">
        {d.isExpert && (
          <button type="button" onClick={() => setTab('INBOX')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold ${tab === 'INBOX' ? 'bg-indigo-900 text-white' : 'border border-border bg-card'}`}>
            کارتابل من ({faNumber(d.expertRows.length)})
          </button>
        )}
        {d.isVice && (
          <button type="button" onClick={() => setTab('VICE')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold ${tab === 'VICE' ? 'bg-indigo-900 text-white' : 'border border-border bg-card'}`}>
            نمای معاون آموزش ({faNumber(d.viceRows.length)})
          </button>
        )}
        {tab === 'VICE' && (
          <>
            <button type="button" onClick={() => setViceFilter('OPEN')}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold ${viceFilter === 'OPEN' ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900' : 'border border-border bg-card'}`}>
              در جریان ({faNumber(openVice.length)})
            </button>
            <button type="button" onClick={() => setViceFilter('CLOSED')}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold ${viceFilter === 'CLOSED' ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900' : 'border border-border bg-card'}`}>
              بسته‌شده / رد خودکار ({faNumber(closedVice.length)})
            </button>
          </>
        )}
      </div>

      {list.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">موردی برای نمایش نیست.</CardContent></Card>
      ) : list.map((r) => {
        const open = r.status === 'PENDING_MANAGER' || r.status === 'ESCALATED_EXPERT';
        return (
          <BypassCard key={r.id} r={r} canAct={open} canReturn={d.isVice && tab === 'VICE' && open} busy={busyId === r.id}
            onApprove={() => void run(r.id, () => bypassApprove(r.id))}
            onReject={(code, text) => void run(r.id, () => bypassReject(r.id, code, text))}
            onReturn={(target) => void run(r.id, () => bypassReturn(r.id, target))} />
        );
      })}
    </div>
  );
}

function SettingsForm({ t, onSave, onSaved, onError }: {
  t: { id: number; title: string; termCode: string; bypassManagerHours: number | null; bypassExpertHours: number | null; bypassReminderHours: number | null };
  onSave: (input: { termId: number; bypassManagerHours: number; bypassExpertHours: number; bypassReminderHours: number }) => Promise<unknown>;
  onSaved: () => void | Promise<void>;
  onError: (text: string) => void;
}) {
  const [manager, setManager] = useState(String(t.bypassManagerHours ?? 48));
  const [expert, setExpert] = useState(String(t.bypassExpertHours ?? 12));
  const [reminder, setReminder] = useState(String(t.bypassReminderHours ?? 10));
  const [busy, setBusy] = useState(false);
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-xl border border-indigo-200 bg-card p-3 dark:border-indigo-900"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave({ termId: t.id, bypassManagerHours: Number(toEnDigits(manager)), bypassExpertHours: Number(toEnDigits(expert)), bypassReminderHours: Number(toEnDigits(reminder)) });
          await onSaved();
        } catch (er) {
          onError(er instanceof Error ? er.message : 'ذخیره ناموفق بود.');
        } finally {
          setBusy(false);
        }
      }}>
      <div className="min-w-40 text-xs font-bold">
        {t.title}
        <span className="block font-mono text-[10px] text-muted-foreground" dir="ltr">{t.termCode}</span>
      </div>
      <label className="space-y-1 text-[11px] font-bold">مهلت مدیر گروه (ساعت)
        <Input value={manager} onChange={(e) => setManager(e.target.value)} type="number" min={1} max={720} className="h-7 w-28 font-mono text-xs" />
      </label>
      <label className="space-y-1 text-[11px] font-bold">مهلت کارشناس (ساعت)
        <Input value={expert} onChange={(e) => setExpert(e.target.value)} type="number" min={1} max={720} className="h-7 w-28 font-mono text-xs" />
      </label>
      <label className="space-y-1 text-[11px] font-bold">یادآوری قبل از مهلت (ساعت)
        <Input value={reminder} onChange={(e) => setReminder(e.target.value)} type="number" min={1} max={720} className="h-7 w-28 font-mono text-xs" />
      </label>
      <Button size="sm" type="submit" disabled={busy}>ذخیره</Button>
    </form>
  );
}

// ═══════════════════════════ 3) Class session management ═══════════════════════════

const SESSION_STATUS_FA: Record<string, string> = {
  SCHEDULED: 'برنامه‌ریزی‌شده', HELD: 'برگزار‌شده', ABSENT: 'غیبت استاد', CANCELLED: 'لغو‌شده',
};

export function AdminClassSessionsPage() {
  const [termId, setTermId] = useState(0);
  const [offeringId, setOfferingId] = useState(0);
  const [q, setQ] = useState('');
  const board = useQuery({
    queryKey: ['lp-class-sessions', termId, offeringId, q],
    queryFn: () => getClassSessionsBoard({ termId: termId || undefined, offeringId: offeringId || undefined, q: q.trim() || undefined }),
  });
  const qc = useQueryClient();
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    if (board.data && termId === 0) setTermId(board.data.termId);
  }, [board.data, termId]);

  const toggle = async (s: ClassSessionItem, flag: 'isHoliday' | 'isExtraSession' | 'isActive') => {
    setMsg(null);
    try {
      const res = await toggleClassSessionFlag(s.id, flag);
      const label = flag === 'isHoliday' ? 'تعطیل' : flag === 'isExtraSession' ? 'فوق‌برنامه' : 'فعال';
      setMsg({ kind: 'ok', text: `جلسهٔ ${faNum(s.sessionNo)} — «${label}» ${res.value === 1 ? 'فعال' : 'غیرفعال'} شد.` });
      await qc.invalidateQueries({ queryKey: ['lp-class-sessions'] });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'تغییر پرچم ممکن نشد.' });
    }
  };

  const d = board.data;
  const selected = d?.offerings.find((o) => o.id === d.selectedOfferingId) ?? null;

  const Chip = ({ on, label, tone, onClick }: { on: boolean; label: string; tone: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[10px] font-black transition ${on ? tone : 'border-border bg-card text-muted-foreground'}`}>
      {on ? '✓' : '○'} {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-900 via-slate-800 to-indigo-900 text-white">
        <CardContent className="p-5">
          <h1 className="text-lg font-black">📅 مدیریت جلسات درس</h1>
          <p className="mt-1 text-xs text-slate-200/90">انتخاب نیمسال و درس → جدول کامل جلسات با پرچم‌های «تعطیل / فوق‌برنامه / فعال» و مهرهای زمانی ممیزی.</p>
        </CardContent>
      </Card>

      <Card><CardContent className="flex flex-wrap items-end gap-2 pt-4">
        <label className="text-[11px] font-bold">نیمسال
          <select value={d?.termId ?? 0} onChange={(e) => { setTermId(Number(e.target.value)); setOfferingId(0); }}
            className="mt-1 block w-56 rounded-lg border border-input bg-card px-2 py-1.5 text-xs">
            {(d?.terms ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.title} {t.isCurrent === 1 ? '— نیمسال فعال' : ''}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-bold">جست‌وجو (کد/نام درس یا استاد)
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setOfferingId(0); }} className="mt-1 h-7 w-56 text-xs" />
        </label>
        <Button size="sm" variant="secondary" onClick={() => setOfferingId(0)}>جست‌وجو</Button>
        <label className="text-[11px] font-bold">درس
          <select value={d?.selectedOfferingId ?? 0} onChange={(e) => setOfferingId(Number(e.target.value))}
            className="mt-1 block w-72 rounded-lg border border-input bg-card px-2 py-1.5 text-xs">
            {(d?.offerings ?? []).length === 0 && <option value="">درسی یافت نشد</option>}
            {(d?.offerings ?? []).map((o) => (
              <option key={o.id} value={o.id}>{o.code} — {o.title} (گروه {faNum(o.groupNumber)}) · {o.professorName ?? 'بدون استاد'} · {faNum(o.sessionCount)} جلسه</option>
            ))}
          </select>
        </label>
        <span className="ms-auto text-[11px] text-muted-foreground">{faNum(d?.offerings.length ?? 0)} درس · {d?.termTitle ?? '—'}</span>
      </CardContent></Card>

      <Msg msg={msg} />

      {selected && (
        <Card><CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4 text-xs">
          <div className="font-bold">
            {selected.code} — {selected.title}
            <span className="ms-2 font-normal text-muted-foreground">
              گروه {faNum(selected.groupNumber)} · استاد {selected.professorName ?? '—'}{selected.staffCode ? ` (${selected.staffCode})` : ''} · {faNum(selected.sessionCount)} جلسه{selected.holidayCount > 0 ? ` · ${faNum(selected.holidayCount)} تعطیل` : ''}
            </span>
          </div>
        </CardContent></Card>
      )}

      <Card><CardContent className="overflow-x-auto pt-4">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="bg-muted/60 text-[11px] text-muted-foreground">
              {['جلسه', 'تاریخ', 'ساعت', 'محل تشکیل', 'وضعیت', 'جبرانی', 'تعطیل', 'فوق‌برنامه', 'فعال', 'تاریخ ایجاد', 'مشاهدهٔ استاد', 'آخرین تغییر'].map((h) => (
                <th key={h} className="p-2.5 text-center font-black">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(d?.sessions ?? []).map((s) => (
              <tr key={s.id} className={`border-t border-border/50 ${s.isActive !== 1 ? 'bg-muted/30 text-muted-foreground' : ''}`}>
                <td className="p-2.5 text-center font-mono font-black">{faNum(s.sessionNo)}</td>
                <td className="p-2.5 text-center font-mono">{faNum(s.sessionDate)}</td>
                <td className="p-2.5 text-center font-mono text-[10px] text-muted-foreground" dir="ltr">{s.startTime}–{s.endTime}</td>
                <td className="p-2.5 text-center">{s.roomName ?? '—'}</td>
                <td className="p-2.5 text-center"><Badge variant="secondary" className="text-[10px]">{SESSION_STATUS_FA[s.status] ?? s.status}</Badge></td>
                <td className="p-2.5 text-center">{Number(s.isMakeUp ?? 0) === 1 ? <Badge className="bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">جبرانی</Badge> : '—'}</td>
                <td className="p-2.5 text-center"><Chip on={s.isHoliday === 1} label="تعطیل" tone="border-rose-300 bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300" onClick={() => void toggle(s, 'isHoliday')} /></td>
                <td className="p-2.5 text-center"><Chip on={s.isExtraSession === 1} label="فوق‌برنامه" tone="border-violet-300 bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300" onClick={() => void toggle(s, 'isExtraSession')} /></td>
                <td className="p-2.5 text-center"><Chip on={s.isActive === 1} label="فعال" tone="border-emerald-300 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" onClick={() => void toggle(s, 'isActive')} /></td>
                <td className="p-2.5 text-center text-[10px] text-muted-foreground">{faDateTime(s.createdAt)}</td>
                <td className="p-2.5 text-center text-[10px] text-muted-foreground">{faDateTime(s.professorViewedAt)}</td>
                <td className="p-2.5 text-center text-[10px] text-muted-foreground">{faDateTime(s.updatedAt)}</td>
              </tr>
            ))}
            {(d?.sessions ?? []).length === 0 && (
              <tr><td colSpan={12} className="p-6 text-center text-muted-foreground">برای این درس جلسه‌ای ثبت نشده است؛ ابتدا از «برنامه‌ریزی درسی ← تقویم ترم» جلسات ترم را تولید کنید.</td></tr>
            )}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}

// ═══════════════════════════ 4) Exam paper delivery chain ═══════════════════════════

export function AdminExamHandoverPage() {
  const [termId, setTermId] = useState(0);
  const board = useQuery({
    queryKey: ['lp-handover', termId],
    queryFn: () => getExamHandoverBoard(termId || undefined),
  });
  const [msg, setMsg] = useState<Msg>(null);
  const [qr, setQr] = useState<{ url: string; qr: string; expiresAt: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (board.data && termId === 0) setTermId(board.data.termId);
  }, [board.data, termId]);

  const makeQr = async (label: string, params: { step: string; sessionId?: number; hallId?: number; offeringId?: number }) => {
    setQr(null);
    setBusy(true);
    try {
      const d = await getExamHandoverQr(params);
      setQr({ url: d.url, qr: d.qr, expiresAt: d.expiresAt, label });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'ساخت QR تحویل ممکن نشد.' });
    } finally {
      setBusy(false);
    }
  };

  const finalize = async (s: { sessionId: number }) => {
    setMsg(null);
    setBusy(true);
    try {
      await finalizeExamHandover(s.sessionId);
      setMsg({ kind: 'ok', text: `نهایی‌سازی جلسهٔ ${faNum(s.sessionId)} انجام شد (بسته‌های اوراق ساخته شد).` });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'نهایی‌سازی ممکن نشد.' });
    } finally {
      setBusy(false);
    }
  };

  const d = board.data;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-900 via-slate-800 to-indigo-900 text-white">
        <CardContent className="p-5">
          <h1 className="text-lg font-black">🧾 زنجیرهٔ تحویل اوراق امتحان</h1>
          <p className="mt-1 text-xs text-slate-200/90">
            مراقب → مخزن (QR) · نهایی‌سازی مخزن · مخزن → استاد (QR) · استاد → بایگانی (QR، شرط پرداخت حق‌الزحمهٔ تصحیح).
            هر QR کوتاه‌مدت است و تحویل‌گیرنده با هویت خودش آن را تأیید می‌کند.
          </p>
        </CardContent>
      </Card>

      <Card><CardContent className="flex flex-wrap items-center gap-2 pt-4">
        <label className="text-[11px] font-bold">نیمسال
          <select value={d?.termId ?? 0} onChange={(e) => setTermId(Number(e.target.value))}
            className="mt-1 block w-56 rounded-lg border border-input bg-card px-2 py-1.5 text-xs">
            {(d?.terms ?? []).map((t) => <option key={t.id} value={t.id}>{t.title} {t.isCurrent === 1 ? '— فعال' : ''}</option>)}
          </select>
        </label>
        <span className="ms-auto text-[11px] text-muted-foreground">{faNum(d?.sessions.length ?? 0)} جلسه · {faNum(d?.deliveries.length ?? 0)} تحویل — {d?.termTitle ?? '—'}</span>
      </CardContent></Card>

      <Msg msg={msg} />

      {qr && (
        <Card className="border-indigo-300 dark:border-indigo-800"><CardContent className="space-y-2 pt-4">
          <p className="text-sm font-black">{qr.label}</p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-xl border border-border bg-white p-2" dangerouslySetInnerHTML={{ __html: qr.qr }} />
            <div className="min-w-0 space-y-1 text-xs">
              <p className="break-all font-mono" dir="ltr">{qr.url}</p>
              <p className="text-[11px] text-muted-foreground">اعتبار تا {faDateTime(qr.expiresAt)} — تحویل‌گیرنده این کد را اسکن می‌کند و در صفحهٔ تحویل، دریافت را با هویت خودش تأیید می‌کند.</p>
            </div>
          </div>
        </CardContent></Card>
      )}

      <Card><CardContent className="overflow-x-auto pt-4">
        <h2 className="mb-2 text-xs font-black">جلسه‌های امتحان</h2>
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="bg-muted/60 text-[11px] text-muted-foreground">
              {['جلسه', 'تاریخ / ساعت', 'سالن', 'حضور', 'صورتجلسه', 'دریافت مخزن', 'بسته‌ها', 'اقدام'].map((h) => <th key={h} className="p-2.5 text-center font-black">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {(d?.sessions ?? []).map((s) => (
              <tr key={s.sessionId} className="border-t border-border/50">
                <td className="p-2.5 text-center font-mono font-black">{faNum(s.sessionId)}</td>
                <td className="p-2.5 text-center">
                  <span className="block font-mono">{faNum(s.examDate)}</span>
                  <span className="block text-[10px] text-muted-foreground" dir="ltr">{s.time}</span>
                </td>
                <td className="p-2.5 text-center font-bold">{s.hallName}</td>
                <td className="p-2.5 text-center font-mono">{faNum(s.present)}/{faNum(s.total)}</td>
                <td className="p-2.5 text-center">{s.minutesSigned ? '✓' : '—'}</td>
                <td className="p-2.5 text-center">{s.vaultReceived ? '✓' : '—'}</td>
                <td className="p-2.5 text-center font-mono">{faNum(s.packets)}</td>
                <td className="p-2.5 text-center">
                  <Button size="sm" className="h-6 px-2 text-[10px]" disabled={busy || !s.hallId}
                    onClick={() => void makeQr(`تحویل اوراق سالن ${s.hallName} به مخزن`, { step: 'VAULT', sessionId: s.sessionId, hallId: s.hallId ?? 0 })}>
                    QR تحویل به مخزن
                  </Button>
                  <Button size="sm" variant="outline" className="mx-1 h-6 px-2 text-[10px]" disabled={busy}
                    onClick={() => void makeQr(`نهایی‌سازی تحویل جلسه ${s.sessionId}`, { step: 'FINALIZE', sessionId: s.sessionId })}>
                    QR نهایی‌سازی
                  </Button>
                  <Button size="sm" variant="secondary" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => void finalize(s)}>
                    نهایی‌سازی
                  </Button>
                </td>
              </tr>
            ))}
            {(d?.sessions ?? []).length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">جلسه‌ای برای این نیمسال ثبت نشده است.</td></tr>}
          </tbody>
        </table>
      </CardContent></Card>

      <Card><CardContent className="overflow-x-auto pt-4">
        <h2 className="mb-2 text-xs font-black">تحویل اوراق به استاد و بازگشت به بایگانی</h2>
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="bg-muted/60 text-[11px] text-muted-foreground">
              {['درس', 'استاد', 'وضعیت تحویل', 'اوراق', 'بایگانی', 'اقدام'].map((h) => <th key={h} className="p-2.5 text-center font-black">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {(d?.deliveries ?? []).map((dl) => (
              <tr key={dl.deliveryId} className="border-t border-border/50">
                <td className="p-2.5">
                  <span className="font-black">{dl.courseCode}</span>
                  <span className="block text-[10px] text-muted-foreground">{dl.courseTitle}</span>
                </td>
                <td className="p-2.5 font-bold">{dl.professorName}</td>
                <td className="p-2.5 text-center"><Badge variant="secondary" className="text-[10px]">{dl.status}</Badge></td>
                <td className="p-2.5 text-center font-mono">{faNum(dl.sheetCount)}</td>
                <td className="p-2.5 text-center">
                  {dl.returnedToArchive
                    ? <Badge className="bg-emerald-100 text-[10px] text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">✓ تحویل بایگانی</Badge>
                    : <Badge className="bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">در انتظار (شرط پرداخت)</Badge>}
                </td>
                <td className="p-2.5 text-center">
                  {!dl.returnedToArchive && (
                    <Button size="sm" className="h-6 px-2 text-[10px]" disabled={busy}
                      onClick={() => void makeQr(`بازگشت اوراق ${dl.courseCode} به بایگانی`, { step: 'ARCHIVE', offeringId: dl.offeringId })}>
                      QR تحویل به بایگانی
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="mx-1 h-6 px-2 text-[10px]" disabled={busy}
                    onClick={() => void makeQr(`تحویل اوراق ${dl.courseCode} به استاد`, { step: 'INSTRUCTOR', offeringId: dl.offeringId })}>
                    QR تحویل به استاد
                  </Button>
                </td>
              </tr>
            ))}
            {(d?.deliveries ?? []).length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">هنوز تحویلی برای این نیمسال ثبت نشده است (ابتدا جلسه را نهایی کنید).</td></tr>}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}

// ═══════════════════════════ 5) Offering editor ═══════════════════════════

export function AdminOfferingEditorPage() {
  const qc = useQueryClient();
  const terms = useQuery({ queryKey: ['lp-editor-terms'], queryFn: getOfferingEditorTerms });
  const meta = useQuery({ queryKey: ['lp-editor-meta'], queryFn: getOfferingEditorMeta });
  const [termId, setTermId] = useState(0);
  const [q, setQ] = useState('');
  const rows = useQuery({
    queryKey: ['lp-editor-rows', termId],
    queryFn: () => getOfferingEditorRows(termId),
    enabled: termId > 0,
  });
  useEffect(() => {
    const list = terms.data ?? [];
    if (!termId && list.length) {
      setTermId((list.find((t) => t.isCurrent === 1) ?? list[0]).id);
    }
  }, [terms.data, termId]);

  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState<OfferingEditorRow | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const list = rows.data ?? [];
    const t = q.trim().toLowerCase();
    return t ? list.filter((r) => (r.code + ' ' + r.title).toLowerCase().includes(t)) : list;
  }, [rows.data, q]);

  const edit = (r: OfferingEditorRow) => {
    setOpen(r.offeringId);
    setDraft(JSON.parse(JSON.stringify(r)) as OfferingEditorRow);
    setReason('');
    setMsg(null);
  };

  const reload = async () => {
    await qc.invalidateQueries({ queryKey: ['lp-editor-rows'] });
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    try {
      await saveOfferingEditor({
        offeringId: draft.offeringId,
        capacity: draft.capacity,
        classRows: draft.classRows.map((c) => ({ id: c.id, day: c.day ?? 0, start: c.start ?? '', end: c.end ?? '', roomId: c.roomId })),
        exam: draft.exam
          ? {
              id: draft.exam.id,
              date: draft.exam.date ? (jalaliInputToGreg(draft.exam.date) ?? '') : '',
              start: draft.exam.start ?? '',
              end: draft.exam.end ?? '',
            }
          : null,
        overrideReason: reason,
      });
      setMsg({ kind: 'ok', text: '✅ ذخیره شد.' });
      await reload();
      setOpen(null);
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    } finally {
      setBusy(false);
    }
  };

  const changeExpert = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'ok', text: okText });
      await reload();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    } finally {
      setBusy(false);
    }
  };

  const experts = meta.data?.experts ?? [];
  const rooms = meta.data?.rooms ?? [];

  return (
    <div className="space-y-4">
      <Card><CardContent className="pt-4">
        <h1 className="text-lg font-black">🛠️ تعریف / اصلاح درس در ترم</h1>
        <p className="mt-1 text-xs text-muted-foreground">ظرفیت، زمان کلاس، سالن و امتحان — با گارد تداخل (برای حوادث، دلیل/حکم لازم است). کارشناس فقط دامنهٔ خودش را می‌بیند.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={termId} onChange={(e) => setTermId(Number(e.target.value))} className="rounded-lg border border-input bg-card px-2 py-1.5 text-xs">
            {(terms.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی کد/نام…" className="h-7 w-48 text-xs" />
          <Button size="sm" variant="secondary" onClick={() => { setOpen(null); void reload(); }}>تازه</Button>
        </div>
      </CardContent></Card>

      <Msg msg={msg} />

      <Card><CardContent className="overflow-x-auto pt-4">
        <table className="w-full text-right text-xs">
          <thead className="bg-muted/60 text-muted-foreground"><tr>
            {['درس', 'گروه', 'ظرفیت', 'پر شدگی', 'زمان کلاس', 'امتحان', 'عملیات'].map((h) => (
              <th key={h} className={`p-2 font-black ${h === 'درس' || h === 'زمان کلاس' ? 'text-right' : 'text-center'}`}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.offeringId} className="border-t border-border/50">
                <td className="p-2"><b>{r.code}</b> {r.title}<div className="text-[10px] text-muted-foreground">{r.professorName}</div></td>
                <td className="p-2 text-center">{faNum(r.groupNumber)}</td>
                <td className="p-2 text-center">{faNum(r.capacity)}</td>
                <td className="p-2 text-center">{faNum(r.enrolledCount)}</td>
                <td className="p-2 text-muted-foreground">{r.classRows.map((c) => `${DAY_NAMES[c.day ?? 0] ?? c.day} ${c.start}–${c.end}`).join('، ') || '—'}</td>
                <td className="p-2 text-muted-foreground">{r.exam ? `${gregToJalaliInput(r.exam.date) || '—'} ${r.exam.start ?? ''}` : '—'}</td>
                <td className="p-2 text-center"><Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => edit(r)}>✏️ ویرایش</Button></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">ارائه‌ای نیست.</td></tr>}
          </tbody>
        </table>
        {rows.isLoading && <Skeleton className="mt-2 h-24 w-full" />}
      </CardContent></Card>

      {open != null && draft && (
        <div className="space-y-3 rounded-2xl border-2 border-indigo-500 bg-indigo-50/50 p-4 dark:bg-indigo-950/20">
          <h3 className="text-sm font-black">✏️ {draft.code} {draft.title} (گروه {faNum(draft.groupNumber)})</h3>

          {/* Education experts of this class — separate from the main store */}
          <div className="space-y-2 rounded-xl border border-indigo-200 bg-card p-3 dark:border-indigo-900">
            <p className="text-xs font-black text-indigo-800 dark:text-indigo-300">👤 کارشناسان آموزشِ این کلاس</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.eduExpertUserIds.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
                  {experts.find((x) => x.userId === id)?.name ?? `#${id}`}
                  <button type="button" onClick={() => void changeExpert(() => removeOfferingExpert(draft.offeringId, id), '✅ کارشناس حذف شد.')} disabled={busy} className="font-black text-rose-600">×</button>
                </span>
              ))}
              {draft.eduExpertUserIds.length === 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {draft.roomExpertUserIds.length ? 'بدون تخصیصِ صریح — کارشناس از اتاقِ سانس‌های همین درس می‌آید:' : 'خالی = کارشناس از دامنهٔ نقش‌های او پایین می‌آید.'}
                </span>
              )}
              {draft.roomExpertUserIds.filter((id) => !draft.eduExpertUserIds.includes(id)).map((id) => (
                <span key={`room-${id}`} className="inline-flex items-center gap-1 rounded-full border border-teal-300 bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-900 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300"
                  title="از تخصیصِ اتاق به ارث رسیده — برای تغییر، در صفحهٔ «تخصیص کارشناس به اتاق‌ها» عوض کنید">
                  {experts.find((x) => x.userId === id)?.name ?? `#${id}`}
                  <span className="text-[9px] font-black opacity-70">اتاق</span>
                </span>
              ))}
              <select value="" disabled={busy}
                onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) void changeExpert(() => addOfferingExpert(draft.offeringId, Number(v)), '✅ کارشناس اضافه شد.'); }}
                className="w-44 rounded-lg border border-input bg-card px-1.5 py-1 text-xs" title="افزودن کارشناس">
                <option value="">＋ افزودن کارشناس…</option>
                {experts.filter((x) => !draft.eduExpertUserIds.includes(x.userId)).map((x) => <option key={x.userId} value={x.userId}>{x.name}</option>)}
              </select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {draft.eduExpertUserIds.length
                ? `تخصیص صریح این کلاس (${faNum(draft.eduExpertUserIds.length)} کارشناس) — بر تخصیص اتاق و نقش‌ها اولویت دارد.`
                : draft.roomExpertUserIds.length
                  ? 'تخصیص از روی اتاقِ سانس‌های همین درس اعمال می‌شود (بدون نیاز به تخصیص صریح).'
                  : 'تخصیص صریحی برای این کلاس ثبت نشده و اتاقِ سانس‌ها هم کارشناس ندارد.'}
            </p>
            {!experts.length && <p className="text-[11px] text-amber-700 dark:text-amber-400">هیچ کارشناس آموزشی با نقش EDU_EXPERT ثبت نشده — ابتدا در «تخصیص نقش‌ها» اضافه کنید.</p>}
          </div>

          <label className="block text-xs font-bold">ظرفیت
            <Input type="number" value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: Number(e.target.value) })} className="h-7 w-24 text-xs" />
          </label>
          <div className="space-y-2">
            <p className="text-xs font-bold">جلسات کلاس (روز / از / تا / سالن)</p>
            {draft.classRows.map((c, i) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2">
                <select value={c.day ?? 0} onChange={(e) => setDraft({ ...draft, classRows: draft.classRows.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)) })} className="rounded-lg border border-input bg-card px-1.5 py-1 text-xs">
                  {DAY_NAMES.map((n, v) => <option key={v} value={v}>{n}</option>)}
                </select>
                <input type="time" value={c.start ?? ''} onChange={(e) => setDraft({ ...draft, classRows: draft.classRows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} className="rounded-lg border border-input bg-card px-1.5 py-1 text-xs" />
                <input type="time" value={c.end ?? ''} onChange={(e) => setDraft({ ...draft, classRows: draft.classRows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} className="rounded-lg border border-input bg-card px-1.5 py-1 text-xs" />
                <select value={c.roomId ?? ''} onChange={(e) => setDraft({ ...draft, classRows: draft.classRows.map((x, j) => (j === i ? { ...x, roomId: e.target.value ? Number(e.target.value) : null } : x)) })} className="rounded-lg border border-input bg-card px-1.5 py-1 text-xs">
                  <option value="">— سالن —</option>
                  {rooms.map((r2) => <option key={r2.id} value={r2.id}>{r2.name}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-bold">امتحان:</p>
            <input type="text" dir="ltr" value={draft.exam?.date ?? ''}
              onChange={(e) => setDraft({ ...draft, exam: draft.exam ? { ...draft.exam, date: e.target.value } : { id: 0, date: e.target.value, start: '', end: '' } })}
              placeholder="۱۴۰۵/۱۱/۱۰" title="تاریخ شمسی — مثلاً ۱۴۰۵/۱۱/۱۰"
              className={`w-32 rounded-lg border bg-card px-1.5 py-1 text-xs ${draft.exam?.date && !jalaliInputToGreg(draft.exam.date) ? 'border-rose-400 bg-rose-50' : 'border-input'}`} />
            <span className="text-[10px] font-bold text-muted-foreground">شمسی</span>
            <input type="time" value={draft.exam?.start ?? ''} onChange={(e) => setDraft({ ...draft, exam: draft.exam ? { ...draft.exam, start: e.target.value } : { id: 0, date: '', start: e.target.value, end: '' } })} className="rounded-lg border border-input bg-card px-1.5 py-1 text-xs" />
            <input type="time" value={draft.exam?.end ?? ''} onChange={(e) => setDraft({ ...draft, exam: draft.exam ? { ...draft.exam, end: e.target.value } : { id: 0, date: '', start: '', end: e.target.value } })} className="rounded-lg border border-input bg-card px-1.5 py-1 text-xs" />
            {draft.exam && draft.exam.date && (
              <Button size="sm" variant="ghost" className="h-6 text-[11px] text-rose-600" onClick={() => setDraft({ ...draft, exam: null })}>حذف امتحان</Button>
            )}
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="دلیل در صورت تداخل (حکم/مجوز) — در غیر این صورت خالی…" className="h-7 text-xs" />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => void save()} className="bg-emerald-700 hover:bg-emerald-800">ذخیره</Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(null)}>انصراف</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════ 6) Weekly schedule conflict resolution ═══════════════════════════

const CONFLICT_REASON_LABELS: Record<string, string> = {
  MERGED_OK: 'کلاس ادغامی است (یک جلسهٔ واقعی)',
  PROF_OK: 'استاد هماهنگ است (حضور نوبتی/تفکیک جلسه)',
  ROOM_OK: 'سالن اشتراکی/بزرگ — اشکالی ندارد',
  WILL_FIX: 'نیاز به اصلاح برنامه (فعلاً پذیرفته شده)',
  OTHER: 'سایر موارد',
};
const CONFLICT_REASON_CODES = Object.keys(CONFLICT_REASON_LABELS);
const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  PROFESSOR: { label: 'استاد', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300' },
  ROOM: { label: 'سالن', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' },
  MIXED: { label: 'استاد+سالن', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300' },
};

export function AdminScheduleConflictsPage() {
  const qc = useQueryClient();
  const terms = useQuery({ queryKey: ['lp-conflicts-terms'], queryFn: getConflictTerms });
  const [termId, setTermId] = useState(0);
  const report = useQuery({
    queryKey: ['lp-conflicts', termId],
    queryFn: () => loadScheduleConflicts(termId),
    enabled: termId > 0,
  });
  useEffect(() => {
    const list = terms.data ?? [];
    if (!termId && list.length) setTermId(list[0].id);
  }, [terms.data, termId]);

  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'ALL' | 'PROFESSOR' | 'ROOM'>('ALL');
  const [showReviewed, setShowReviewed] = useState(false);
  const [q, setQ] = useState('');

  const d: ScheduleConflictReport | undefined = report.data;

  const visible = useMemo(() => {
    if (!d) return [] as ConflictGroup[];
    const src = d.groups.filter((g) => (showReviewed ? g.reviewed : !g.reviewed));
    const byKind = kind === 'ALL' ? src : src.filter((g) => g.kinds.includes(kind));
    const needle = q.trim().toLowerCase();
    if (!needle) return byKind;
    return byKind.filter((g) =>
      [g.entityName, g.dayName, ...g.slots.map((s) => `${s.courseCode} ${s.courseTitle} ${s.roomName ?? ''}`)].join(' ').toLowerCase().includes(needle));
  }, [d, kind, showReviewed, q]);

  const reload = async () => { await qc.invalidateQueries({ queryKey: ['lp-conflicts'] }); };

  const onMergeGroup = async (g: ConflictGroup) => {
    if (!termId) return;
    const ids = g.slots.map((s) => s.offeringId);
    if (ids.length < 2) return;
    if (!window.confirm(`${faNumber(ids.length)} کلاس به‌عنوان یک جلسهٔ ادغامی ثبت شوند؟\n\n` +
      g.slots.map((s) => `• ${s.courseCode} ${s.courseTitle} (گروه ${s.groupNumber})`).join('\n') +
      `\n\nدر تقویم استاد با برچسب «کلاس ادغامی» نمایش داده می‌شوند و از این گزارش حذف می‌شوند.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await markOfferingsMerged(termId, ids);
      setMsg({ kind: 'ok', text: r.message });
      await reload();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'ادغام ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  };

  const onAcceptGroup = async (g: ConflictGroup, reasonCode: string) => {
    if (!termId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await markConflictGroupReviewed({
        termId, reasonCode,
        items: g.pairs.map((p) => ({ fingerprint: p.fingerprint, kind: p.kind, entityId: p.entityId, dayOfWeek: p.dayOfWeek, scheduleAId: p.a.scheduleId, scheduleBId: p.b.scheduleId })),
      });
      setMsg({ kind: 'ok', text: r.message });
      await reload();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'ثبت بررسی ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  };

  const onMergeAllLikely = async () => {
    if (!termId || !d) return;
    const targets = d.groups.filter((g) => !g.reviewed && g.likelyMerged && g.slots.length >= 2);
    if (!targets.length) return;
    const total = targets.reduce((n, g) => n + g.slots.length, 0);
    if (!window.confirm(`${faNumber(targets.length)} مسئله که «احتمالاً یک جلسه» هستند ادغام شوند؟ (${faNumber(total)} کلاس)\n\n` +
      `شرط: همان استاد، همان سالن، اختلافِ ساعت کمتر از ۲۰ دقیقه.\nمواردی که سالن یا استادشان متفاوت است دست‌نخورده می‌مانند.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await markOfferingsMergedBulk(termId, targets.map((g) => g.slots.map((s) => s.offeringId)));
      setMsg({ kind: 'ok', text: r.message });
      await reload();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'ادغام گروهی ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  };

  const onUndoGroup = async (g: ConflictGroup) => {
    if (!termId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await undoConflictGroup(termId, g.pairs.map((p) => p.fingerprint));
      setMsg({ kind: 'ok', text: r.message });
      await reload();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'بازگردانی ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  };

  const reasonOf = (g: ConflictGroup) => {
    if (!d) return null;
    for (const p of g.pairs) {
      const r = d.reviewed[p.fingerprint];
      if (r) return r;
    }
    return null;
  };

  const SlotLine = ({ s }: { s: ConflictGroup['slots'][number] }) => (
    <div className="leading-5">
      <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">{s.courseCode}</span>{' '}
      <span className="text-[12px]">{s.courseTitle}</span>
      <span className="text-[11px] text-muted-foreground"> • گروه {faNumber(s.groupNumber)} • {faNumber(s.enrolledCount)} نفر{s.roomName ? ` • ${s.roomName}` : ''}</span>
    </div>
  );

  const groupActions = (g: ConflictGroup) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" className="h-6 bg-violet-600 px-2 text-[11px] hover:bg-violet-500" disabled={busy || g.slots.length < 2} onClick={() => void onMergeGroup(g)}
        title="همهٔ دروسِ این بازه به‌عنوان یک جلسهٔ ادغامی ثبت می‌شوند">
        ادغام {g.slots.length > 2 ? `(${faNumber(g.slots.length)} درس)` : ''}
      </Button>
      <select defaultValue="" onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) void onAcceptGroup(g, v); }}
        className="rounded border border-input bg-card px-1.5 py-1 text-[11px]" title="پذیرش کلِ این مسئله با ذکر دلیل">
        <option value="">پذیرش…</option>
        {CONFLICT_REASON_CODES.map((c) => <option key={c} value={c}>{CONFLICT_REASON_LABELS[c]}</option>)}
      </select>
      <a href="/admin/offering-editor" className="rounded border border-border px-2 py-1 text-[11px]">اصلاح</a>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold"><Radio className="size-5" aria-hidden /> گزارش تداخل‌های واقعی برنامهٔ هفتگی</h1>
        <span className="text-xs text-muted-foreground">کارشناس آموزش — بررسی و رفع</span>
        <select value={termId} onChange={(e) => setTermId(Number(e.target.value))}
          className="ms-auto rounded border border-input bg-card px-2 py-1.5 text-sm" aria-label="ترم">
          {(terms.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <Msg msg={msg} />
      {report.isError && <div className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{report.error instanceof Error ? report.error.message : 'خطا در بارگذاری گزارش.'}</div>}

      {d && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="مسئلهٔ باز" value={faNumber(d.openIssues)} tone="rose" />
            <Stat label="احتمالاً یک جلسه (یک‌کلیکی)" value={faNumber(d.likelyMergedIssues)} tone="amber" />
            <Stat label="جفتِ تداخلِ باز" value={faNumber(d.pairs.length - d.reviewedCount)} />
            <Stat label="ادغامی (حذف‌شده)" value={faNumber(d.mergedSkipped)} tone="ok" />
            <Stat label="استاد / سالن درگیر" value={`${faNumber(d.summary.professorEntities)} / ${faNumber(d.summary.roomEntities)}`} />
          </div>

          {d.likelyMergedIssues > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/20">
              <span className="text-xs leading-6 text-amber-900 dark:text-amber-300">
                {faNumber(d.likelyMergedIssues)} مسئله «احتمالاً یک جلسه» است: همان استاد، همان سالن و اختلافِ ساعت کمتر از ۲۰ دقیقه. با یک کلیک همه ادغام می‌شوند.
              </span>
              <Button size="sm" className="ms-auto bg-amber-600 hover:bg-amber-500" disabled={busy} onClick={() => void onMergeAllLikely()}>ادغام همهٔ مواردِ قطعی</Button>
            </div>
          )}
        </>
      )}

      <Card><CardContent className="flex flex-wrap items-end gap-2 pt-4">
        <div className="flex rounded-lg border border-input p-0.5 text-xs">
          {(['ALL', 'PROFESSOR', 'ROOM'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`rounded px-2.5 py-1 ${kind === k ? 'bg-indigo-600 text-white' : 'text-muted-foreground'}`}>
              {k === 'ALL' ? 'همه' : k === 'PROFESSOR' ? 'استاد' : 'سالن'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showReviewed} onChange={(e) => setShowReviewed(e.target.checked)} className="size-4" />
          نمایش بررسی‌شده‌ها ({faNumber(d ? d.totalIssues - d.openIssues : 0)})
        </label>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو درس / استاد / سالن…" className="ms-auto h-7 w-full text-xs sm:w-64" />
      </CardContent></Card>

      {report.isLoading && <div className="text-sm text-muted-foreground">در حال بارگذاری…</div>}

      {!report.isLoading && d && (
        <Card><CardContent className="overflow-x-auto pt-4">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-muted/60 text-muted-foreground">
                {['موجودیتِ درگیر', 'روز', 'بازه', 'دروس درگیر', 'دانشجو', 'عملیات'].map((h) => <th key={h} className="p-2 font-black">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {visible.map((g) => {
                const rev = reasonOf(g);
                return (
                  <tr key={g.key} className="border-t border-border/50 align-top">
                    <td className="p-2 font-medium">
                      <div className="space-y-0.5">
                        {g.entities.map((e) => (
                          <div key={`${e.kind}:${e.id}`} className="flex items-center gap-1">
                            <Badge className={`text-[10px] ${KIND_BADGE[e.kind]?.cls ?? ''}`}>{KIND_BADGE[e.kind]?.label ?? e.kind}</Badge>
                            <span>{e.name}</span>
                          </div>
                        ))}
                      </div>
                      {g.likelyMerged && <Badge className="mt-1 bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">احتمالاً یک جلسه</Badge>}
                    </td>
                    <td className="p-2 whitespace-nowrap">{g.dayName}</td>
                    <td className="whitespace-nowrap p-2 font-mono" dir="ltr">
                      {minutesToHm(g.windowFrom)}–{minutesToHm(g.windowTo)}
                      <div className="text-[10px] text-muted-foreground">هم‌پوشانی {minutesToHm(g.overlapFrom)}–{minutesToHm(g.overlapTo)}</div>
                    </td>
                    <td className="p-2">
                      <div className="space-y-0.5">{g.slots.map((s) => <SlotLine key={s.offeringId} s={s} />)}</div>
                      {g.slots.length > 2 && <div className="mt-1 text-[10px] text-muted-foreground">{faNumber(g.slots.length)} درس در یک بازه — یک مسئله، نه {faNumber(g.pairs.length)} مسئله.</div>}
                    </td>
                    <td className="p-2 font-mono" dir="ltr">{faNumber(g.students)}</td>
                    <td className="p-2">
                      {rev ? (
                        <div className="space-y-1">
                          <Badge className="bg-emerald-100 text-[10px] text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">{CONFLICT_REASON_LABELS[rev.reasonCode ?? 'OTHER'] ?? rev.reasonCode}</Badge>
                          <div className="text-[10px] text-muted-foreground">{rev.reviewedByName ?? ''} {rev.reviewedAt ?? ''}</div>
                          <Button size="sm" variant="outline" className="h-5 px-2 text-[10px]" disabled={busy} onClick={() => void onUndoGroup(g)}>بازگردانی</Button>
                        </div>
                      ) : groupActions(g)}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">{showReviewed ? 'موردی بررسی‌شده یافت نشد.' : 'تداخلِ واقعیِ باز یافت نشد. 🎉'}</td></tr>
              )}
            </tbody>
          </table>
        </CardContent></Card>
      )}

      <p className="text-[11px] leading-6 text-muted-foreground">
        هر ردیف یک <b>مسئله</b> است، نه یک جفت: اگر استاد در یک بازه پنج درس داشته باشد، همه در یک ردیف فهرست می‌شوند.
        برچسبِ «احتمالاً یک جلسه» یعنی همان استاد، همان سالن و اختلافِ ساعت کمتر از ۲۰ دقیقه — با یک کلیک «ادغام» کلِ آن بازه یک جلسهٔ ادغامی می‌شود.
        {d ? <> این ترم {faNumber(d.slotsScanned)} ردیف برنامه بررسی شد{d.duplicateSlots > 0 ? ` (${faNumber(d.duplicateSlots)} ردیفِ تکراری یک‌بار شمرده شد)` : ''}.</> : null}
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'rose' | 'ok' | 'amber' }) {
  const cls = tone === 'rose'
    ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300'
    : tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
        : 'border-border bg-muted/40';
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`}>
      <p className="text-[10px] opacity-80">{label}</p>
      <p className="font-mono text-base font-bold" dir="ltr">{value}</p>
    </div>
  );
}

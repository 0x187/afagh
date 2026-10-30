import { useQuery } from '@tanstack/react-query';
import { Database, Download, FileSpreadsheet, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import {
  applyMigrationGrades, confirmMigrationSuggestions, deleteMigrationBatch,
  exportSaham, getGradeCompare, getMigrationBatches, getMigrationCodeMap, getSahamData,
  getSahamSettings, getSaminOverview, getMigrationSources, importMigrationFile, saminEnqueue,
  saminSend, saminSendSample, saminTrace, saveSahamInstituteCode, deleteSahamInstituteCode,
  type MigReport, type SahamExportResult,
} from '@/lib/migration-api';

// ═══ مهاجرت داده / سهام / ثمین — پورت admin/{migration,saham,samin} ═══

function Msg({ msg }: { msg: { kind: 'ok' | 'err'; text: string } | null }) {
  if (!msg) return null;
  return <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>{msg.text}</div>;
}

function downloadCsv(name: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── مهاجرت داده ───

const MIG_KINDS = [
  { value: 'students', label: 'دانشجویان' },
  { value: 'grades', label: 'نمرات' },
  { value: 'codes', label: 'کدها (ترم/دانشکده/گروه/رشته)' },
  { value: 'tuition-formula', label: 'فرمول‌های شهریه' },
  { value: 'legacy-financial', label: 'دفتر مالی قدیمی' },
];

export function AdminMigrationPage() {
  const sources = useQuery({ queryKey: ['mig-sources'], queryFn: getMigrationSources });
  const [src, setSrc] = useState('');
  const batches = useQuery({ queryKey: ['mig-batches', src], queryFn: () => getMigrationBatches(src), enabled: !!src });
  const [kind, setKind] = useState('students');
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [report, setReport] = useState<MigReport | null>(null);
  const [termCode, setTermCode] = useState('');
  const [domain, setDomain] = useState('major');
  const codeMap = useQuery({ queryKey: ['mig-codemap', src, domain], queryFn: () => getMigrationCodeMap(src, domain), enabled: !!src });
  const compare = useQuery({ queryKey: ['mig-compare', src, termCode], queryFn: () => getGradeCompare(src, termCode), enabled: !!src && !!termCode });

  async function runImport() {
    if (!file || !src) return;
    try {
      const rep = await importMigrationFile(kind, src, file);
      setReport(rep);
      setMsg({ kind: 'ok', text: `درون‌ریزی انجام شد: ${faNumber(rep.inserted)} افزوده، ${faNumber(rep.updated)} به‌روزرسانی، ${faNumber(rep.invalid)} نامعتبر` });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-cyan-900 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-black"><Database className="size-5" aria-hidden /> مرکز مهاجرت داده</h1>
            <p className="mt-1 text-xs text-cyan-100/80">درون‌ریزی از سیستم قدیمی (CSV/اکسل)، نگاشت کدها، مقایسهٔ نمرات و فرمول‌ها، بازخوانی و بازگردانی</p>
          </div>
          <select value={src} onChange={(e) => setSrc(e.target.value)} className="h-9 rounded-lg border border-white/25 bg-white/10 px-2 text-xs font-bold text-white">
            <option value="">انتخاب مبدأ…</option>
            {(sources.data ?? []).map((s) => <option key={s.code} value={s.code}>{s.title} ({s.code})</option>)}
          </select>
        </CardContent>
      </Card>

      <Msg msg={msg} />

      {!src ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">برای شروع، یک مبدأ داده انتخاب یا ثبت کنید.</CardContent></Card> : (
        <>
          <Card>
            <CardContent className="space-y-3 pt-4">
              <h2 className="text-sm font-black"><FileSpreadsheet className="inline size-4" aria-hidden /> درون‌ریزی فایل</h2>
              <div className="flex flex-wrap items-center gap-2">
                <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
                  {MIG_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <input type="file" accept=".csv,.xlsx,.xls,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
                <Button size="sm" disabled={!file} onClick={() => void runImport()}>درون‌ریزی</Button>
              </div>
              {report ? (
                <div className="rounded-xl border border-border bg-muted/20 p-3 text-[11px]">
                  مجموع {faNumber(report.total)} — افزوده {faNumber(report.inserted)} — به‌روزرسانی {faNumber(report.updated)} — نامعتبر {faNumber(report.invalid)}
                  {report.errors?.length ? (
                    <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-rose-700 dark:text-rose-300">
                      {report.errors.slice(0, 30).map((e, i) => <div key={i}>ردیف {faNumber(e.row)}: {e.msg}</div>)}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-4">
              <h2 className="text-sm font-black">دسته‌های درون‌ریزی</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-[11px]">
                  <thead className="bg-muted/60 text-muted-foreground"><tr>{['شناسه', 'نوع', 'مبدأ', 'فایل', 'مجموع', 'موفق', 'خطا', 'زمان', ''].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
                  <tbody>
                    {(batches.data ?? []).map((b) => (
                      <tr key={String(b['id'])} className="border-t border-border/50">
                        <td className="p-2 font-mono">{String(b['id'] ?? '—')}</td>
                        <td className="p-2">{String(b['importType'] ?? '—')}</td>
                        <td className="p-2 font-mono">{String(b['sourceCode'] ?? '—')}</td>
                        <td className="p-2">{String(b['fileName'] ?? '—')}</td>
                        <td className="p-2 font-mono">{faNumber(Number(b['totalRows'] ?? 0))}</td>
                        <td className="p-2 font-mono text-emerald-700 dark:text-emerald-300">{faNumber(Number(b['okRows'] ?? 0))}</td>
                        <td className="p-2 font-mono text-rose-700 dark:text-rose-300">{faNumber(Number(b['errorRows'] ?? 0))}</td>
                        <td className="p-2 text-[10px]">{String(b['createdAt'] ?? '—')?.slice(0, 16).replace('T', ' ')}</td>
                        <td className="p-2"><Button size="sm" variant="destructive" className="h-6 px-2 text-[10px]" onClick={async () => {
                          if (!window.confirm('حذف این دسته؟')) return;
                          try { await deleteMigrationBatch(Number(b['id'])); await batches.refetch(); } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' }); }
                        }}><Trash2 className="size-3" aria-hidden /></Button></td>
                      </tr>
                    ))}
                    {(batches.data ?? []).length === 0 ? <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">دسته‌ای ثبت نشده است.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-4">
              <h2 className="text-sm font-black">مقایسه و اعمال نمرات</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Input value={termCode} onChange={(e) => setTermCode(e.target.value)} placeholder="کد ترم (مثلاً 14031)" className="h-8 max-w-40 font-mono text-[11px]" dir="ltr" />
                <Button size="sm" disabled={!termCode} onClick={() => compare.refetch()}><RefreshCw className="size-4" aria-hidden /> مقایسه</Button>
                <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300" onClick={async () => {
                  try {
                    const r = await applyMigrationGrades({ sourceCode: src, termCode, statuses: ['SAME', 'DIFF_GRADE'], overwrite: false });
                    setMsg({ kind: 'ok', text: `اعمال شد: ${faNumber(Number((r as { applied?: number }).applied ?? 0))} نمره` });
                  } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' }); }
                }}>اعمال نمرات</Button>
              </div>
              {compare.data ? <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/20 p-2 text-[10px]" dir="ltr">{JSON.stringify(compare.data, null, 1).slice(0, 2000)}</pre> : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-4">
              <h2 className="text-sm font-black">نگاشت کدها</h2>
              <div className="flex flex-wrap items-center gap-2">
                <select value={domain} onChange={(e) => setDomain(e.target.value)} className="h-8 rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
                  {[['major', 'رشته'], ['faculty', 'دانشکده'], ['department', 'گروه'], ['term', 'ترم']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <Button size="sm" variant="outline" onClick={async () => {
                  try { const r = await confirmMigrationSuggestions(src, domain); setMsg({ kind: 'ok', text: `${faNumber(r.confirmed)} نگاشت تأیید شد.` }); await codeMap.refetch(); } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' }); }
                }}>تأیید خودکار پیشنهادها (≥۸۰)</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-[11px]">
                  <thead className="bg-muted/60 text-muted-foreground"><tr>{['کد قدیمی', 'عنوان قدیمی', 'تعداد', 'نگاشت', ''].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
                  <tbody>
                    {((codeMap.data?.['maps'] ?? []) as Record<string, unknown>[]).slice(0, 100).map((m, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="p-2 font-mono">{String(m['legacyCode'] ?? '—')}</td>
                        <td className="p-2">{String(m['legacyTitle'] ?? '—')}</td>
                        <td className="p-2 font-mono">{faNumber(Number(m['usageCount'] ?? 0))}</td>
                        <td className="p-2">{String((m['target'] as { name?: string })?.name ?? m['targetCode'] ?? '— نگاشته نشده —')}</td>
                        <td className="p-2">{String(m['status'] ?? '')}</td>
                      </tr>
                    ))}
                    {((codeMap.data?.['maps'] ?? []) as unknown[]).length === 0 ? <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">نگاشتی ثبت نشده است.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── سهام ───

export function AdminSahamPage() {
  const data = useQuery({ queryKey: ['saham'], queryFn: getSahamData });
  const settings = useQuery({ queryKey: ['saham-settings'], queryFn: getSahamSettings });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [kind, setKind] = useState('students');
  const [uniId, setUniId] = useState(0);
  const [status, setStatus] = useState('');
  const [majorId, setMajorId] = useState(0);
  const [termId, setTermId] = useState(0);
  const [exporting, setExporting] = useState(false);

  async function runExport() {
    setExporting(true);
    try {
      const r: SahamExportResult = await exportSaham({ kind, universityId: uniId, all: uniId === 0, status, majorId, termId });
      downloadCsv(r.fileName || `saham-${kind}.csv`, r.csv);
      setMsg({ kind: 'ok', text: `خروجی ${faNumber(r.count)} ردیف از ${faNumber(r.total)} ساخته شد${r.hasMore ? ' (سقف ۵۰۰۰ — فیلتر کنید)' : ''}.` });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' });
    } finally {
      setExporting(false);
    }
  }

  if (data.isLoading) return <Skeleton className="h-72 w-full" />;
  if (data.isError || !data.data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت آمار سهام ناموفق بود.</CardContent></Card>;
  const d = data.data;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-sky-800 via-blue-900 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black"><FileSpreadsheet className="size-5" aria-hidden /> گزارش سالانهٔ سهام</h1>
          <p className="mt-1 text-xs text-sky-100/80">خروجی CSV با کد ۱۲ رقمی مؤسسه و مقادیر متنی — سقف هر فایل ۵٬۰۰۰ ردیف</p>
        </CardContent>
      </Card>

      <Msg msg={msg} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="دانشجو (همهٔ وضعیت‌ها)" value={faNumber(d.totals.students)} />
        <StatCard label="دانش‌آموخته" value={faNumber(d.totals.graduates)} />
        <StatCard label="استاد (کل)" value={faNumber(d.totals.instructors)} />
        <StatCard label="دانشگاه دارای کد سهام" value={faNumber(d.totals.withCode)} />
      </div>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <h2 className="text-sm font-black">خروجی</h2>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>گزارش</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
                <option value="students">دانشجویان</option><option value="graduates">دانش‌آموختگان</option><option value="instructors">آموزشگران</option>
              </select>
            </label>
            <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>دانشگاه (خالی=مجازها)</span>
              <select value={uniId} onChange={(e) => setUniId(Number(e.target.value))} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
                <option value={0}>همه (با ماتریس دسترسی)</option>
                {d.stats.map((s) => <option key={s.universityId} value={s.universityId}>{s.title}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>رشته</span>
              <select value={majorId} onChange={(e) => setMajorId(Number(e.target.value))} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
                <option value={0}>همه</option>
                {d.lookups.majors.map((m) => <option key={`${m.universityId}-${m.id}`} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>وضعیت</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
                <option value="">همه</option>
                {d.lookups.statuses.map((s, i) => <option key={i} value={s.status}>{s.status}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>ترم (آموزشگر)</span>
              <select value={termId} onChange={(e) => setTermId(Number(e.target.value))} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
                <option value={0}>—</option>
                {d.lookups.terms.map((t, i) => <option key={i} value={t.id}>{t.termCode} {t.title}</option>)}
              </select>
            </label>
          </div>
          <Button size="sm" disabled={exporting} onClick={() => void runExport()}><Download className="size-4" aria-hidden /> {exporting ? 'در حال ساخت…' : 'ساخت و دانلود CSV'}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <h2 className="text-sm font-black">کدهای مؤسسه (تنظیمات)</h2>
          <SahamSettings settings={settings} onMsg={setMsg} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <h2 className="text-sm font-black">پُری ستون‌های سهام به‌تفکیک دانشگاه</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-[11px]">
              <thead className="bg-muted/60 text-muted-foreground"><tr>{['دانشگاه', 'دانشجو', 'فارغ‌التحصیل', 'استاد', 'کد سهام', 'نوع تحصیل', 'شیوهٔ تدریس', 'تأهل', 'استان تولد', 'استان اقامت'].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
              <tbody>
                {d.stats.map((s) => (
                  <tr key={s.universityId} className="border-t border-border/50">
                    <td className="p-2 font-bold">{s.title}{s.isDissolved ? ' (منحل)' : ''}</td>
                    <td className="p-2 font-mono">{faNumber(s.students)}</td>
                    <td className="p-2 font-mono">{faNumber(s.graduates)}</td>
                    <td className="p-2 font-mono">{faNumber(s.instructors)}</td>
                    <td className="p-2 font-mono">{faNumber(s.sahamCodeCount)}</td>
                    {[s.fill.studyType, s.fill.teachingMode, s.fill.maritalStatus, s.fill.birthProvince, s.fill.residenceProvince].map((v, i) => (
                      <td key={i} className="p-2 font-mono">{s.students > 0 ? `${faNumber(Math.round((v / s.students) * 100))}٪` : '—'}</td>
                    ))}
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 text-center">
      <div className="text-2xl font-black">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function SahamSettings({ settings, onMsg }: {
  settings: { data?: Record<string, unknown>; isLoading: boolean; refetch: () => Promise<unknown> };
  onMsg: (m: { kind: 'ok' | 'err'; text: string }) => void;
}) {
  type SahamSettingsRow = { id: number; universityId: number; facultyId: number | null; title: string; code: string; provinceCode: string };
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [uniId, setUniId] = useState(0);
  const rows = (settings.data?.['codes'] ?? []) as SahamSettingsRow[];
  const unis = (settings.data?.['universities'] ?? []) as { id: number; title: string }[];
  async function save() {
    try {
      await saveSahamInstituteCode({ universityId: uniId, title, code });
      onMsg({ kind: 'ok', text: 'کد مؤسسه ذخیره شد.' });
      setCode(''); setTitle('');
      await settings.refetch();
    } catch (e) { onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' }); }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>دانشگاه</span>
          <select value={uniId} onChange={(e) => setUniId(Number(e.target.value))} className="h-8 rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
            <option value={0}>—</option>{unis.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>عنوان</span><Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 max-w-48 text-[11px]" /></label>
        <label className="space-y-1 text-[10px] font-bold text-muted-foreground"><span>کد ۱۲ رقمی</span><Input value={code} onChange={(e) => setCode(e.target.value)} className="h-8 max-w-40 font-mono text-[11px]" dir="ltr" /></label>
        <Button size="sm" disabled={!uniId || !code.trim()} onClick={() => void save()}>ذخیره</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-right text-[11px]">
          <thead className="bg-muted/60 text-muted-foreground"><tr>{['دانشگاه', 'عنوان', 'کد', ''].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border/50">
                <td className="p-2">{unis.find((u) => u.id === r.universityId)?.title ?? r.universityId}</td>
                <td className="p-2">{r.title}</td>
                <td className="p-2 font-mono" dir="ltr">{r.code}</td>
                <td className="p-2"><Button size="sm" variant="destructive" className="h-6 px-2 text-[10px]" onClick={async () => {
                  try { await deleteSahamInstituteCode(r.id); await settings.refetch(); } catch (e) { onMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' }); }
                }}><Trash2 className="size-3" aria-hidden /></Button></td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">کدی ثبت نشده است.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── ثمین ───

export function AdminSaminPage() {
  const [uni, setUni] = useState('');
  const data = useQuery({ queryKey: ['samin', uni], queryFn: () => getSaminOverview(uni) });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [traceId, setTraceId] = useState('');
  const [traceRes, setTraceRes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const d = data.data;
  const uniId = d?.university.id ?? 0;

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try { setMsg({ kind: 'ok', text: await fn() }); await data.refetch(); } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' }); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-indigo-950 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black"><Send className="size-5" aria-hidden /> هاب ثمین — ارسال به سازمان امور دانشجویان</h1>
          <p className="mt-1 text-xs text-indigo-200">هر دانشگاه با کلید خودش ارسال می‌شود؛ entity_code=1000 (دانشجو)، رهگیری با trace_id</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {(d?.universities ?? []).map((u) => (
              <button key={u.id} type="button" onClick={() => setUni(u.code)} className={`rounded border px-3 py-1 text-xs font-bold ${u.code === d?.university.code ? 'border-indigo-400 bg-indigo-600 text-white' : 'border-border bg-card'}`}>
                {u.title} ({u.code}) <span className="tabular-nums">{faNumber(d?.queueByUni?.[String(u.id)] ?? 0)}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Msg msg={msg} />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card><CardContent className="space-y-2 pt-4">
          <h2 className="text-xs font-black">۱) آماده‌سازی صف</h2>
          <p className="text-[10px] text-muted-foreground">کل صف: {faNumber(d?.totalStaging ?? 0)}</p>
          <Button size="sm" disabled={busy || !uniId} onClick={() => void run(async () => {
            const r = await saminEnqueue(uniId);
            return `صف ثمین: ${faNumber(r.inserted)} افزوده، ${faNumber(r.skipped)} تکراری`;
          })}>آماده‌سازی صف (از students)</Button>
        </CardContent></Card>
        <Card><CardContent className="space-y-2 pt-4">
          <h2 className="text-xs font-black">۲) ارسال ۵۰تایی</h2>
          <Button size="sm" disabled={busy || !uniId} onClick={() => void run(async () => {
            const r = await saminSend(uniId);
            return `ارسال شد: trace_id=${String(r['trace_id'] ?? r['traceId'] ?? '—')}`;
          })}>ارسال (bulk_import_data)</Button>
        </CardContent></Card>
        <Card><CardContent className="space-y-2 pt-4">
          <h2 className="text-xs font-black">۳) نمونهٔ فارغ‌التحصیل</h2>
          <div className="flex flex-wrap gap-1">
            {[2, 5].map((n) => (
              <Button key={n} size="sm" variant="outline" className="h-7 text-[10px]" disabled={busy || !uniId} onClick={() => void run(async () => {
                const r = await saminSendSample(uniId, n);
                return `نمونه ارسال شد: ${JSON.stringify(r).slice(0, 180)}`;
              })}>{faNumber(n)} فارغ‌التحصیل</Button>
            ))}
          </div>
        </CardContent></Card>
      </div>

      <Card><CardContent className="space-y-2 pt-4">
        <h2 className="text-xs font-black">۴) رهگیری ارسال</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={traceId} onChange={(e) => setTraceId(e.target.value)} placeholder="trace_id" className="h-8 max-w-40 font-mono text-[11px]" dir="ltr" />
          <Button size="sm" variant="outline" disabled={busy || !traceId} onClick={() => void run(async () => {
            const r = await saminTrace(uniId, Number(traceId));
            setTraceRes(JSON.stringify(r, null, 1));
            return 'پاسخ سازمان دریافت شد.';
          })}>استعلام</Button>
        </div>
        {traceRes ? <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/20 p-2 text-[10px]" dir="ltr">{traceRes.slice(0, 2000)}</pre> : null}
      </CardContent></Card>

      <Card><CardContent className="space-y-2 pt-4">
        <h2 className="text-xs font-black">صف ثمین (۵۰ اخیر)</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-[11px]">
            <thead className="bg-muted/60 text-muted-foreground"><tr>{['person_pk', 'وضعیت', 'trace', 'زمان'].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
            <tbody>
              {(d?.staging ?? []).map((s) => (
                <tr key={s.id} className="border-t border-border/50">
                  <td className="p-2 font-mono" dir="ltr">{s.personPkInSource ?? '—'}</td>
                  <td className="p-2"><Badge variant={s.status === 'SENT' ? 'success' : 'warning'} className="text-[9px]">{s.status}</Badge></td>
                  <td className="p-2 font-mono" dir="ltr">{s.traceId ?? '—'}</td>
                  <td className="p-2 text-[10px]">{s.createdAt?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                </tr>
              ))}
              {(d?.staging ?? []).length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">صف خالی است.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </CardContent></Card>

      <Card><CardContent className="space-y-2 pt-4">
        <h2 className="text-xs font-black">لاگ همگام‌سازی (۲۰ اخیر)</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-[11px]">
            <thead className="bg-muted/60 text-muted-foreground"><tr>{['trace', 'وضعیت', 'نتیجه', 'زمان'].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
            <tbody>
              {(d?.logs ?? []).map((l) => (
                <tr key={l.id} className="border-t border-border/50">
                  <td className="p-2 font-mono" dir="ltr">{l.traceId ?? '—'}</td>
                  <td className="p-2">{l.status}</td>
                  <td className="p-2 max-w-96 truncate font-mono text-[10px]" dir="ltr">{JSON.stringify(l.summaryResult)?.slice(0, 200)}</td>
                  <td className="p-2 text-[10px]">{l.createdAt?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                </tr>
              ))}
              {(d?.logs ?? []).length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">لاگی ثبت نشده است.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { SahamStat, SahamFilterLookups } from './page';

const FILL_ROWS: { key: keyof SahamStat['fill']; label: string; hint: string }[] = [
  { key: 'teachingMode', label: 'شیوه آموزش', hint: 'بک‌فیل از فایل قدیمی' },
  { key: 'studyType', label: 'نوع تحصیل', hint: 'از فایل قدیمی (COURSTYPE)' },
  { key: 'maritalStatus', label: 'وضعیت تاهل', hint: 'از فایل قدیمی (MARRIED)' },
  { key: 'birthProvince', label: 'استان محل تولد', hint: 'از placeOfBirth + جدول شهر' },
  { key: 'residenceProvince', label: 'استان محل سکونت', hint: 'از آدرس + جدول شهر' },
];

type Kind = 'students' | 'graduates' | 'instructors';

const KIND_TABS: { key: Kind; label: string; hint: string }[] = [
  { key: 'students', label: '🎓 دانشجویان (۵۲ ستون)', hint: 'همهٔ وضعیت‌ها؛ با شیت نظام وظیفه' },
  { key: 'graduates', label: '🎓 دانش‌آموختگان (۴۳ ستون)', hint: 'بازهٔ تاریخ فراغت + شیت نظام وظیفه' },
  { key: 'instructors', label: '👨‍🏫 آموزشگران (۳۷ ستون)', hint: 'اساتید دارای ارائه در نیمسال' },
];

const STATUS_FA: Record<string, string> = {
  ACTIVE: 'فعال', GRADUATED: 'دانش‌آموخته', WITHDRAWN: 'انصرافی', NO_SHOW: 'عدم مراجعه',
  TRANSFERRED: 'انتقالی', SUSPENDED: 'معلق', EXPELLED: 'اخراجی', UNKNOWN: 'نامشخص', DECEASED: 'فوت‌شده',
};

function qs(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export default function SahamClient({ stats, lookups }: { stats: SahamStat[]; lookups: SahamFilterLookups }) {
  const [kind, setKind] = useState<Kind>('students');
  /** چند انتخاب دانشگاه — «چند مؤسسه در یک فایل» */
  const [selected, setSelected] = useState<number[]>(() => stats.map((s) => s.universityId));
  const [status, setStatus] = useState('');
  const [majorId, setMajorId] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [entryFrom, setEntryFrom] = useState('');
  const [entryTo, setEntryTo] = useState('');
  const [gradFrom, setGradFrom] = useState('');
  const [gradTo, setGradTo] = useState('');
  const [termId, setTermId] = useState('');
  const [limit, setLimit] = useState('5000');
  const [applied, setApplied] = useState<{ sig: string; counts: Record<number, number>; total: number } | null>(null);
  const [counting, setCounting] = useState(false);
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState('');

  const rows = stats.filter((s) => selected.includes(s.universityId));
  const majors = lookups.majors.filter((m) => selected.includes(m.universityId));
  const faculties = lookups.faculties.filter((f) => selected.includes(f.universityId));
  const terms = lookups.terms.filter((t) => selected.includes(t.universityId));
  const needTerm = kind === 'instructors' && !termId;

  /** هر تغییر فیلتر، عدد محاسبه‌شدهٔ قبلی را باطل می‌کند (عدد کهنه گمراه‌کننده است) */
  const reset = () => { setApplied(null); setErr(''); setWarn(''); setProgress(''); };
  const sig = JSON.stringify({ kind, selected, status, majorId, facultyId, entryFrom, entryTo, gradFrom, gradTo, termId, limit });
  const fresh = applied !== null && applied.sig === sig;

  const params = (opts: { id?: number; all?: boolean } = {}) => ({
    universityId: opts.all ? selected.join(',') : opts.id,
    kind,
    status: kind === 'students' ? (status || undefined) : undefined,
    majorId: majorId || undefined,
    facultyId: facultyId || undefined,
    entryFrom: entryFrom || undefined,
    entryTo: entryTo || undefined,
    gradFrom: kind === 'graduates' ? (gradFrom || undefined) : undefined,
    gradTo: kind === 'graduates' ? (gradTo || undefined) : undefined,
    termId: kind === 'instructors' ? (termId || undefined) : undefined,
    limit: limit || undefined,
  });

  /** دکمهٔ اصلی: شمارش رکوردهای همهٔ مؤسسه‌های انتخاب‌شده با فیلترهای فعلی */
  const apply = async () => {
    if (needTerm) { setErr('برای گزارش آموزشگران اول نیمسال را انتخاب کنید.'); return; }
    if (!rows.length) { setErr('هیچ مؤسسه‌ای انتخاب نشده است.'); return; }
    setCounting(true); reset();
    const counts: Record<number, number> = {};
    let total = 0;
    try {
      let i = 0;
      for (const s of rows) {
        i++;
        setProgress(`محاسبهٔ ${i.toLocaleString('fa-IR')} از ${rows.length.toLocaleString('fa-IR')} — ${s.title}`);
        const res = await fetch(`/api/admin/saham/students?${qs({ ...params({ id: s.universityId }), preview: 1 })}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'محاسبهٔ تعداد ناموفق بود.');
        const n = Number(body.total) || 0;
        counts[s.universityId] = n;
        total += n;
      }
      setApplied({ sig, counts, total });
      setProgress('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطای نامشخص');
      setProgress('');
    } finally {
      setCounting(false);
    }
  };

  const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** دانلود یک مؤسسه، یا یک فایل تجمیعی برای همهٔ انتخاب‌شده‌ها */
  const download = async (target: number | 'all') => {
    if (needTerm) { setErr('برای گزارش آموزشگران اول نیمسال را انتخاب کنید.'); return; }
    setBusy(target); setErr(''); setWarn('');
    try {
      const url = `/api/admin/saham/students?${qs(target === 'all' ? params({ all: true }) : params({ id: target }))}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'خطای نامشخص' }));
        throw new Error(body.error || 'ساخت فایل ناموفق بود.');
      }
      if (res.headers.get('x-has-more') === '1') {
        setWarn(`⚠️ خروجی به ${Number(res.headers.get('x-row-count')).toLocaleString('fa-IR')} ردیف محدود شد از مجموع ${Number(res.headers.get('x-row-total')).toLocaleString('fa-IR')} — فیلتر را تنگ‌تر کنید یا در چند نوبت بگیرید.`);
      }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      saveBlob(blob, m ? decodeURIComponent(m[1]) : `SAHAM-${target === 'all' ? 'all' : target}.xlsx`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطای نامشخص');
    } finally {
      setBusy(null);
    }
  };

  const kindCount = (s: SahamStat) => kind === 'graduates' ? s.graduates : kind === 'instructors' ? s.instructors : s.students;
  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const fa = (n: number) => n.toLocaleString('fa-IR');

  return (
    <div className="space-y-3">
      {err && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50/70 p-3 text-xs font-bold text-red-800">
          ❌ {err.length > 500 ? err.slice(0, 500) + '…' : err}
        </div>
      )}
      {warn && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-3 text-xs font-bold text-amber-800">{warn}</div>
      )}

      {/* تب نوع گزارش */}
      <div className="card !p-3">
        <div className="flex flex-wrap gap-2">
          {KIND_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setKind(t.key); reset(); }}
              title={t.hint}
              className={`rounded-xl px-4 py-2 text-xs font-black transition ${kind === t.key ? 'bg-indigo-700 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* فیلترها */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {kind === 'students' && (
            <label className="text-2xs text-slate-600">وضعیت تحصیلی
              <select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} className="mt-1 w-full rounded border px-2 py-1.5 text-xs">
                <option value="">همهٔ وضعیت‌ها</option>
                {[...new Set(lookups.statuses.map((s) => s.status))].map((st) => (
                  <option key={st} value={st}>{STATUS_FA[st] ?? st}</option>
                ))}
              </select>
            </label>
          )}
          {kind !== 'instructors' && (
            <>
              <label className="text-2xs text-slate-600">رشته
                <select value={majorId} onChange={(e) => { setMajorId(e.target.value); reset(); }} className="mt-1 w-full rounded border px-2 py-1.5 text-xs">
                  <option value="">همهٔ رشته‌ها</option>
                  {majors.slice(0, 500).map((mj) => <option key={mj.id} value={mj.id}>{mj.name}</option>)}
                </select>
              </label>
              <label className="text-2xs text-slate-600">دانشکده
                <select value={facultyId} onChange={(e) => { setFacultyId(e.target.value); reset(); }} className="mt-1 w-full rounded border px-2 py-1.5 text-xs">
                  <option value="">همهٔ دانشکده‌ها</option>
                  {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              <label className="text-2xs text-slate-600">ورودی از (سال)
                <input value={entryFrom} onChange={(e) => { setEntryFrom(e.target.value); reset(); }} placeholder="1400" inputMode="numeric" className="mt-1 w-full rounded border px-2 py-1.5 text-xs" />
              </label>
              <label className="text-2xs text-slate-600">ورودی تا (سال)
                <input value={entryTo} onChange={(e) => { setEntryTo(e.target.value); reset(); }} placeholder="1404" inputMode="numeric" className="mt-1 w-full rounded border px-2 py-1.5 text-xs" />
              </label>
            </>
          )}
          {kind === 'graduates' && (
            <>
              <label className="text-2xs text-slate-600">فراغت از (۱۴۰۳/۰۱/۰۱)
                <input value={gradFrom} onChange={(e) => { setGradFrom(e.target.value); reset(); }} placeholder="1403/01/01" className="mt-1 w-full rounded border px-2 py-1.5 text-xs font-mono" dir="ltr" />
              </label>
              <label className="text-2xs text-slate-600">فراغت تا (۱۴۰۴/۱۲/۲۹)
                <input value={gradTo} onChange={(e) => { setGradTo(e.target.value); reset(); }} placeholder="1404/12/29" className="mt-1 w-full rounded border px-2 py-1.5 text-xs font-mono" dir="ltr" />
              </label>
            </>
          )}
          {kind === 'instructors' && (
            <label className="text-2xs text-slate-600 col-span-2">نیمسال (فقط اساتید دارای ارائه) — اجباری
              <select value={termId} onChange={(e) => { setTermId(e.target.value); reset(); }} className="mt-1 w-full rounded border px-2 py-1.5 text-xs">
                <option value="">— انتخاب نیمسال —</option>
                {terms.map((t) => <option key={t.id} value={t.id}>{t.title}{t.isCurrent ? ' (جاری)' : ''}</option>)}
              </select>
            </label>
          )}
          <label className="text-2xs text-slate-600">سقف ردیف (هر فایل)
            <select value={limit} onChange={(e) => { setLimit(e.target.value); reset(); }} className="mt-1 w-full rounded border px-2 py-1.5 text-xs font-mono" dir="ltr">
              <option value="1000">1,000</option>
              <option value="5000">5,000</option>
              <option value="10000">10,000</option>
              <option value="20000">20,000</option>
            </select>
          </label>
        </div>

        {/* دکمه‌های عمل */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
          <button
            onClick={apply}
            disabled={counting || needTerm || !rows.length}
            className="rounded-xl bg-indigo-700 px-4 py-2 text-xs font-black text-white shadow hover:bg-indigo-800 disabled:opacity-40"
          >
            {counting ? '⏳ در حال محاسبه…' : '🔎 اعمال فیلتر و محاسبهٔ تعداد'}
          </button>
          <button
            onClick={() => download('all')}
            disabled={busy !== null || needTerm || !rows.length}
            title="یک فایل اکسل برای همهٔ مؤسسه‌های انتخاب‌شده"
            className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black text-white shadow hover:bg-emerald-800 disabled:opacity-40"
          >
            {busy === 'all' ? '⏳ در حال ساخت…' : `⬇️ دانلود اکسل یک‌فایلی (${fa(rows.length)} مؤسسه)`}
          </button>
          <button onClick={reset} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100">
            ↺ پاک‌کردن فیلترها
          </button>
          {progress && <span className="text-2xs font-bold text-slate-500">{progress}</span>}
        </div>

        {/* خلاصهٔ وضعیت محاسبه */}
        {applied && (
          fresh ? (
            <div className="mt-2 rounded-xl border border-emerald-300 bg-emerald-50/70 p-2 text-2xs font-bold text-emerald-800">
              ✅ فیلتر اعمال شد — جمع: {fa(applied.total)} رکورد در {fa(rows.length)} مؤسسه
            </div>
          ) : (
            <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50/70 p-2 text-2xs font-bold text-amber-800">
              ⚠️ فیلترها تغییر کرده‌اند؛ برای اعداد به‌روز دوباره «اعمال فیلتر و محاسبهٔ تعداد» را بزنید.
            </div>
          )
        )}

        {/* انتخاب چندگانهٔ مؤسسه‌ها */}
        <div className="mt-3 rounded-xl border border-slate-200 p-2">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-2xs font-bold text-slate-600">مؤسسه‌ها (چندتایی انتخاب کنید — یک فایل می‌گیرید):</span>
            <button onClick={() => { setSelected(stats.map((s) => s.universityId)); reset(); }} className="text-2xs font-bold text-indigo-700 underline">همه</button>
            <button onClick={() => { setSelected([]); reset(); }} className="text-2xs font-bold text-slate-500 underline">هیچ‌کدام</button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {stats.map((s) => (
              <label key={s.universityId} className="flex items-center gap-1.5 text-2xs text-slate-700">
                <input type="checkbox" checked={selected.includes(s.universityId)} onChange={() => { toggle(s.universityId); reset(); }} className="h-3.5 w-3.5 accent-indigo-700" />
                <span className={s.sahamCodeCount === 0 ? 'text-amber-700' : ''}>{s.title}</span>
                {s.isDissolved && <span className="rounded bg-slate-200 px-1 text-[9px]">منحل</span>}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-right text-xs rt">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="p-2.5">دانشگاه / مؤسسه</th>
              <th className="p-2.5">کد سهام</th>
              <th className="p-2.5">تعداد ({kind === 'graduates' ? 'آموخته' : kind === 'instructors' ? 'آموزشگر' : 'دانشجو'})</th>
              {FILL_ROWS.map((f) => <th key={f.key} className="p-2.5 whitespace-nowrap">{f.label}</th>)}
              <th className="p-2.5">خروجی</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const noCode = s.sahamCodeCount === 0;
              const filtered = fresh ? applied!.counts[s.universityId] : undefined;
              return (
                <tr key={s.universityId} className="border-t border-slate-200">
                  <td className="p-2.5">
                    <div className="font-bold text-[13px]">{s.title}</div>
                    <div className="text-3xs text-slate-500">
                      {s.code}
                      {s.isDissolved && <span className="mr-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[9px]">منحل</span>}
                    </div>
                  </td>
                  <td className="p-2.5">
                    {noCode
                      ? <span className="rounded bg-amber-100 px-2 py-0.5 text-3xs font-bold text-amber-800">بدون کد</span>
                      : <span className="font-mono text-2xs">{fa(s.sahamCodeCount)} واحد</span>}
                  </td>
                  <td className="p-2.5">
                    {filtered != null ? (
                      <div className="font-black text-emerald-700">{fa(filtered)}</div>
                    ) : (
                      <div className="font-bold text-slate-700">
                        {fa(kindCount(s))}
                        <span className="mr-1 text-3xs font-normal text-slate-400">(کل)</span>
                      </div>
                    )}
                  </td>
                  {FILL_ROWS.map((f) => {
                    const n = s.fill[f.key];
                    const pct = s.students ? Math.round((n / s.students) * 100) : 0;
                    return (
                      <td key={f.key} className="p-2.5" title={f.hint}>
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-12 overflow-hidden rounded bg-slate-200">
                            <div
                              className={`h-full ${pct >= 90 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-400'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="font-mono text-3xs text-slate-600">{fa(pct)}٪</span>
                        </div>
                      </td>
                    );
                  })}
                  <td className="p-2.5">
                    <button
                      onClick={() => download(s.universityId)}
                      disabled={busy !== null || needTerm}
                      title={needTerm ? 'اول نیمسال را انتخاب کنید' : 'خروجی این مؤسسه'}
                      className="rounded bg-indigo-700 px-3 py-1.5 text-2xs font-bold text-white hover:bg-indigo-800 disabled:opacity-40"
                    >
                      {busy === s.universityId ? '⏳…' : '⬇️ اکسل'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card !p-3 text-2xs leading-6 text-slate-600">
        <b>قبل از ارسال به سهام این‌ها را چک کنید:</b>
        <ul className="mr-4 mt-1 list-disc space-y-0.5">
          <li>ستون «کد دانشکده/واحد» ۱۲ رقمی و با فرمت <span className="font-mono">Text</span> باشد — صفرهای اول نباید حذف شود.</li>
          <li>ستون‌های متنی نباید عدد باشند؛ سهام مقدار را با فهرست بستهٔ خودش مقایسه می‌کند («نام مطابقت نداشت»).</li>
          <li>شمارهٔ ملی تکراری یا خالی = حذف کل رکورد در سامانهٔ سهام.</li>
          <li>برای فایل بزرگ‌تر، فیلتر را تنگ‌تر کنید (وضعیت/رشته/ورودی) یا چند نوبت بگیرید.</li>
        </ul>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link prefetch={false} href="/admin/saham/settings" className="font-bold text-indigo-700 underline">⚙️ تنظیمات کدهای مؤسسه (استان/شهر استقرار)</Link>
          <Link prefetch={false} href="/admin/migration" className="font-bold text-indigo-700 underline">تکمیل کدها و نگاشت‌ها</Link>
          <Link prefetch={false} href="/admin/students" className="font-bold text-indigo-700 underline">پروندهٔ دانشجویان</Link>
        </div>
      </div>
    </div>
  );
}

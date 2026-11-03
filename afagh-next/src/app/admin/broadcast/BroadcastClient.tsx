'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getTermOfferings,
  listBroadcastHistory,
  previewBroadcastCount,
  sendBroadcast,
  type BroadcastAudience,
  type BroadcastFilters,
  type BroadcastRecord,
  type BroadcastReport,
  type TermOffering,
} from './actions';
import type { Channel } from '@/lib/messaging';

const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'INAPP', label: '📥 داخل پورتال' },
  { key: 'SMS', label: '📲 پیامک' },
  { key: 'SOROUSH', label: '🟣 سروش' },
  { key: 'BALE', label: '🟢 بله' },
  { key: 'EITAA', label: '🟠 ایتا' },
];

const ROLE_FA = { student: 'دانشجویان', staff: 'اساتید و کارکنان' } as const;

export default function BroadcastClient({ filters }: { filters: BroadcastFilters }) {
  const [role, setRole] = useState<'student' | 'staff' | 'both'>('student');
  const [facultyId, setFacultyId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [majorId, setMajorId] = useState('');
  const [entryYear, setEntryYear] = useState('');
  const [termId, setTermId] = useState(() => filters.terms.find(t => t.isCurrent === 1)?.id?.toString() ?? '');
  const [offeringId, setOfferingId] = useState('');
  const [offerings, setOfferings] = useState<TermOffering[]>([]);
  const [loadingOfferings, setLoadingOfferings] = useState(false);
  // ── جست‌وجوی کلاس: تایپ کد درس/گروه/نام استاد به‌جای اسکرول ۱۵۰۰ گزینه ──
  const [classQuery, setClassQuery] = useState('');
  const [classOpen, setClassOpen] = useState(false);

  /** ارقام فارسی/عربی → لاتین تا «۱۲۳» هم کد «123» را پیدا کند */
  const fa2en = (s: string) =>
    s.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

  const classMatches = useMemo(() => {
    const q = fa2en(classQuery.trim()).toLowerCase();
    if (!q) return offerings.slice(0, 60);
    const toks = q.split(/\s+/);
    return offerings
      .filter(o => {
        const hay = fa2en(o.label).toLowerCase();
        return toks.every(t => hay.includes(t));
      })
      .slice(0, 60);
  }, [offerings, classQuery]);

  const selectedOffering = offeringId ? offerings.find(o => o.id === Number(offeringId)) : undefined;
  const [activeOnly, setActiveOnly] = useState(true);
  const [channels, setChannels] = useState<Channel[]>(['INAPP']);
  const [text, setText] = useState('');
  const [count, setCount] = useState<{ count: number; capped: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BroadcastReport | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [history, setHistory] = useState<BroadcastRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const departments = useMemo(
    () => filters.departments.filter(d => !facultyId || d.facultyId === Number(facultyId)),
    [filters.departments, facultyId],
  );
  const majors = useMemo(
    () => filters.majors.filter(m => !departmentId || m.departmentId === Number(departmentId)),
    [filters.majors, departmentId],
  );

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

  const loadOfferings = async (tid: string) => {
    setOfferingId('');
    setClassQuery('');
    setClassOpen(false);
    setOfferings([]);
    if (!tid) return;
    setLoadingOfferings(true);
    try {
      setOfferings(await getTermOfferings(Number(tid)));
    } catch {
      setOfferings([]);
    } finally {
      setLoadingOfferings(false);
    }
  };

  // ترم جاری از اول انتخاب است — پس کلاس‌هایش را همان اول بارگذاری کن.
  // (بدون این، فهرست تا «تغییر دستی ترم» همیشه خالی می‌ماند و «۰ کلاس» نشان می‌دهد.)
  useEffect(() => {
    if (termId) loadOfferings(termId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preview = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await previewBroadcastCount(audience());
      if (r.ok) setCount({ count: r.count, capped: r.capped });
      else setResult(`⛔ ${r.error}`);
    } catch {
      setResult('⛔ خطا در ارتباط با سرور.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!text.trim()) {
      setResult('⛔ اول متن پیام را بنویسید.');
      return;
    }
    const ok = window.confirm(
      `پیام به ${count ? count.count.toLocaleString('fa-IR') + ' نفر' : 'مخاطبان فیلترشده'} ارسال شود؟ این عمل قابل بازگشت نیست.`,
    );
    if (!ok) return;
    setBusy(true);
    setResult(null);
    setReport(null);
    try {
      const r = await sendBroadcast(audience(), channels, text.trim());
      if (r.ok) {
        setReport(r.report);
        refreshHistory();
      } else {
        setResult(`⛔ ${r.error}`);
      }
    } catch {
      setResult('⛔ خطا در ارتباط با سرور.');
    } finally {
      setBusy(false);
    }
  };

  const refreshHistory = async () => {
    try {
      const r = await listBroadcastHistory(20);
      if (r.ok) setHistory(r.records);
    } catch {
      /* تاریخچه اختیاری است — خطایش مزاحم ارسال نمی‌شود */
    }
  };

  useEffect(() => {
    refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleChannel = (c: Channel) =>
    setChannels(prev => (prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]));

  const sel = 'w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white';

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── مخاطب ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="font-black text-sm text-slate-900">۱️⃣ مخاطبان</h3>
        <div className="flex flex-wrap gap-2">
          {(['student', 'staff', 'both'] as const).map(r => (
            <button
              key={r}
              onClick={() => { setRole(r); setCount(null); }}
              className={`px-4 py-2 rounded-xl text-sm font-black transition ${
                role === r ? 'bg-indigo-700 text-white shadow' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {r === 'both' ? 'دانشجویان + اساتید' : ROLE_FA[r]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="text-xs font-bold text-slate-600">دانشکده
            <select value={facultyId} onChange={e => { setFacultyId(e.target.value); setDepartmentId(''); setMajorId(''); setCount(null); }} className={sel + ' mt-1'}>
              <option value="">همهٔ دانشکده‌ها</option>
              {filters.faculties.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          {(role === 'student' || role === 'both') && (
            <>
              <label className="text-xs font-bold text-slate-600">گروه آموزشی
                <select value={departmentId} onChange={e => { setDepartmentId(e.target.value); setMajorId(''); setCount(null); }} className={sel + ' mt-1'}>
                  <option value="">همهٔ گروه‌ها</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-600">رشته
                <select value={majorId} onChange={e => { setMajorId(e.target.value); setCount(null); }} className={sel + ' mt-1'}>
                  <option value="">همهٔ رشته‌ها</option>
                  {majors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-600">ورودی
                <select value={entryYear} onChange={e => { setEntryYear(e.target.value); setCount(null); }} className={sel + ' mt-1'}>
                  <option value="">همهٔ ورودی‌ها</option>
                  {filters.entryYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </>
          )}
          {role === 'staff' && (
            <label className="text-xs font-bold text-slate-600">گروه آموزشی (استاد)
              <select value={departmentId} onChange={e => { setDepartmentId(e.target.value); setCount(null); }} className={sel + ' mt-1'}>
                <option value="">همهٔ گروه‌ها</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <input type="checkbox" checked={activeOnly} onChange={e => { setActiveOnly(e.target.checked); setCount(null); }} className="w-4 h-4" />
          فقط فعال‌ها (دانشجوی در حال تحصیل / پروندهٔ پرسنلی فعال)
        </label>
        {/* ── فیلتر کلاس درس در ترم ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 p-2.5">
          <label className="text-xs font-bold text-slate-600">🎓 ترم (برای انتخاب کلاس)
            <select
              value={termId}
              onChange={e => { setTermId(e.target.value); setCount(null); loadOfferings(e.target.value); }}
              className={sel + ' mt-1'}
            >
              <option value="">— بدون فیلتر ترم —</option>
              {filters.terms.map(t => (
                <option key={t.id} value={t.id}>{t.title}{t.isCurrent === 1 ? ' (جاری)' : ''}</option>
              ))}
            </select>
          </label>
          <div className="relative">
            <span className="text-xs font-bold text-slate-600">
              🏫 کلاس درس {offeringId ? `(فقط ثبت‌نام‌شدگان${role !== 'student' ? ' و استاد' : ''} همین کلاس)` : '(کد درس یا گروه را تایپ کنید)'}
            </span>
            <div className="mt-1 flex gap-1.5">
              <input
                value={selectedOffering && !classOpen ? selectedOffering.label : classQuery}
                disabled={!termId || loadingOfferings}
                onChange={e => {
                  setClassQuery(e.target.value);
                  setClassOpen(true);
                  if (offeringId) { setOfferingId(''); setCount(null); }
                }}
                onFocus={() => setClassOpen(true)}
                onBlur={() => setTimeout(() => setClassOpen(false), 200)}
                placeholder={loadingOfferings ? 'در حال بارگذاری کلاس‌ها…' : `جست‌وجو در ${offerings.length.toLocaleString('fa-IR')} کلاس — مثلاً «ریاضی گروه ۲» یا کد درس`}
                className={sel + ' mt-1'}
              />
              {offeringId && (
                <button
                  onClick={() => { setOfferingId(''); setClassQuery(''); setCount(null); }}
                  className="mt-1 shrink-0 rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-500 hover:bg-slate-50"
                  title="حذف انتخاب کلاس"
                >
                  ✕
                </button>
              )}
            </div>
            {classOpen && termId && !loadingOfferings && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-300 bg-white shadow-xl">
                {classMatches.length === 0 ? (
                  <p className="p-3 text-xs text-slate-500">کلاسی پیدا نشد — کد درس یا گروه دیگری را امتحان کنید.</p>
                ) : (
                  <>
                    <button
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { setOfferingId(''); setClassQuery(''); setClassOpen(false); setCount(null); }}
                      className="block w-full p-2.5 text-right text-xs font-black text-indigo-700 hover:bg-indigo-50"
                    >
                      همهٔ کلاس‌ها ({offerings.length.toLocaleString('fa-IR')})
                    </button>
                    {classMatches.map(o => (
                      <button
                        key={o.id}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          setOfferingId(String(o.id));
                          setClassQuery('');
                          setClassOpen(false);
                          setCount(null);
                        }}
                        className="block w-full border-t border-slate-100 p-2.5 text-right text-xs hover:bg-indigo-50"
                      >
                        <span className="font-bold text-slate-800">{o.label}</span>
                        <span className="mr-2 text-2xs text-slate-500">({o.enrolled.toLocaleString('fa-IR')} نفر)</span>
                      </button>
                    ))}
                    {classQuery.trim() && (
                      <p className="border-t border-slate-100 p-2 text-2xs text-slate-400">
                        {classMatches.length} مورد اول نمایش داده شد — دقیق‌تر تایپ کنید.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={preview} disabled={busy} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-black text-white hover:bg-slate-900 disabled:opacity-60">
            {busy ? '…' : '🔍 شمارش مخاطبان'}
          </button>
          {count && (
            <span className="text-xs font-black text-indigo-800">
              {count.count.toLocaleString('fa-IR')} نفر
              {count.capped ? ' (سقف ۵٬۰۰۰ — فیلتر را محدودتر کنید)' : ''}
            </span>
          )}
        </div>
      </div>

      {/* ── کانال + متن ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="font-black text-sm text-slate-900">۲️⃣ کانال و متن پیام</h3>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map(c => (
            <button
              key={c.key}
              onClick={() => toggleChannel(c.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition border ${
                channels.includes(c.key)
                  ? 'bg-indigo-700 text-white border-indigo-700'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {channels.includes('SMS') && (
          <p className="text-2xs font-bold text-amber-700">⚠️ پیامک هزینه دارد — تعداد مخاطبان را حتماً اول بشمارید.</p>
        )}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="متن پیام همگانی… (حداکثر ۲۰۰۰ نویسه)"
          className="w-full border border-slate-300 rounded-2xl p-3 text-sm leading-7 focus:border-indigo-600"
        />
        <div className="flex items-center justify-between">
          <span className="text-2xs text-slate-500">{text.length.toLocaleString('fa-IR')} / ۲۰۰۰ نویسه</span>
          <button onClick={send} disabled={busy} className="rounded-xl bg-indigo-700 px-6 py-2.5 text-sm font-black text-white hover:bg-indigo-800 disabled:opacity-60">
            {busy ? 'در حال ارسال…' : '🚀 ارسال همگانی'}
          </button>
        </div>
      </div>

      {report && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50/70 p-4 text-xs leading-7">
          <p className="font-black text-emerald-900">
            ✅ ارسال تمام شد — {report.total.toLocaleString('fa-IR')} مخاطب:
          </p>
          <ul className="mt-1 list-disc pr-5 text-emerald-900">
            <li>📥 صندوق داخل پورتال: <strong>{report.inbox.toLocaleString('fa-IR')} نفر</strong> (همه این را می‌بینند)</li>
            {report.channels.map(c => (
              <li key={c.channel}>
                {c.channel === 'SMS' ? '📲 پیامک' : c.channel === 'SOROUSH' ? '🟣 سروش' : c.channel === 'BALE' ? '🟢 بله' : c.channel === 'EITAA' ? '🟠 ایتا' : c.channel}:
                {' '}<strong>{c.sent.toLocaleString('fa-IR')} ارسال شد</strong>
                {c.skipped > 0 && <span> · {c.skipped.toLocaleString('fa-IR')} نفر عضو این کانال نیستند</span>}
                {c.failed > 0 && <span className="text-red-700"> · {c.failed.toLocaleString('fa-IR')} خطا</span>}
              </li>
            ))}
            {report.failedRequests > 0 && (
              <li className="text-red-700">{report.failedRequests.toLocaleString('fa-IR')} درخواست کلاً به خطا خورد.</li>
            )}
          </ul>
        </div>
      )}

      {result && (
        <div className="rounded-2xl border p-4 text-xs font-black leading-7 bg-slate-50 border-slate-200 text-slate-800">
          {result}
        </div>
      )}

      {/* ── تاریخچهٔ ارسال‌ها ── */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <button
          onClick={() => setHistoryOpen(v => !v)}
          className="flex w-full items-center justify-between p-4 text-sm font-black text-slate-900"
        >
          <span>🗂️ چه پیام‌هایی قبلاً به کجاها ارسال شده ({history.length.toLocaleString('fa-IR')})</span>
          <span>{historyOpen ? '▴' : '▾'}</span>
        </button>
        {historyOpen && (
          <div className="space-y-2 border-t border-slate-100 p-4">
            {history.length === 0 ? (
              <p className="text-xs text-slate-500">هنوز ارسال همگانی ثبت نشده است.</p>
            ) : (
              history.map(h => (
                <div key={h.eventCode} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs leading-6">
                  <p className="font-bold text-slate-800">{h.body || '—'}</p>
                  <p className="mt-1 text-2xs text-slate-500">
                    👤 {h.sender} · 🕐 {h.sentAt ? new Date(h.sentAt).toLocaleString('fa-IR') : '—'} · 👥 {h.total.toLocaleString('fa-IR')} نفر · 📥 صندوق: {h.inbox.toLocaleString('fa-IR')}
                  </p>
                  {h.channels.length > 0 && (
                    <p className="text-2xs text-slate-600">
                      {h.channels.map(c => `${c.channel}: ${c.sent.toLocaleString('fa-IR')} ارسال / ${c.skipped.toLocaleString('fa-IR')} بدون اتصال / ${c.failed.toLocaleString('fa-IR')} خطا`).join(' · ')}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

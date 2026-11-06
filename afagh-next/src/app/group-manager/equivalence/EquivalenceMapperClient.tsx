'use client';

import { useState } from 'react';
import { submitEquivalenceMappingAction, type MappingItem } from './actions';

type Req = {
  id: number;
  trackingCode: string;
  createdAt: string;
  studentName: string;
  studentCode: string;
  previousUniversity: string;
  transcriptAttachment: { key: string; name: string } | null;
  sourceCourseTitle: string;
  sourceGrade: number | null;
  sourceUnits: number | null;
  syllabusNote: string;
};
type OurCourse = { code: string; title: string; units: number };

const faNum = (n: any) => (n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

export default function EquivalenceMapperClient({ requests, ourCourses }: { requests: Req[]; ourCourses: OurCourse[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(requests[0]?.id ?? null);
  const [items, setItems] = useState<MappingItem[]>(() => initFrom(requests[0]));
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function initFrom(r?: Req): MappingItem[] {
    if (!r) return [emptyRow()];
    return [
      {
        sourceTitle: r.sourceCourseTitle || '',
        sourceUnits: r.sourceUnits,
        sourceGrade: r.sourceGrade,
        targetCourseCode: '',
        targetCourseTitle: '',
        headComment: '',
      },
    ];
  }
  function emptyRow(): MappingItem {
    return { sourceTitle: '', sourceUnits: null, sourceGrade: null, targetCourseCode: '', targetCourseTitle: '', headComment: '' };
  }

  const selected = requests.find(r => r.id === selectedId) ?? null;

  const pickRequest = (id: number) => {
    setSelectedId(id);
    setItems(initFrom(requests.find(r => r.id === id)));
    setMsg(null);
  };

  const setItem = (i: number, patch: Partial<MappingItem>) => {
    setItems(prev => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };

  const pickCourse = (i: number, code: string) => {
    const c = ourCourses.find(o => o.code === code);
    setItem(i, { targetCourseCode: code, targetCourseTitle: c?.title ?? '', sourceUnits: c ? c.units : items[i].sourceUnits });
  };

  const filteredCourses = ourCourses.filter(
    c => !search.trim() || c.title.includes(search.trim()) || c.code.toLowerCase().includes(search.trim().toLowerCase())
  );

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setMsg(null);
    const res = await submitEquivalenceMappingAction(selected.id, items, 'تأیید علمی مدیر گروه');
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: 'نگاشت معادل‌سازی تأیید و به گام بعد (مدیرکل آموزش) ارسال شد.' } : { ok: false, text: res.error || 'خطا' });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h1 className="font-extrabold text-slate-900 text-base sm:text-lg"> فرم هوشمند معادل‌سازی دروس (مدیر گروه)</h1>
        <p className="text-xs text-slate-500 mt-1">
          در یک سمت دروس رشتهٔ دانشگاه آفاق قابل جستجو و انتخاب است و در سمت دیگر نمرات و نظر مدیر گروه درج می‌شود؛ پس از تأیید مدیرکل آموزش، نمرات به‌صورت خودکار در کارنامه ثبت می‌شود.
        </p>
      </div>

      {requests.length === 0 && (
        <p className="card p-6 text-center text-slate-500 text-sm">درخواست معادل‌سازی در انتظار بررسی مدیر گروه وجود ندارد.</p>
      )}

      {requests.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* فهرست درخواست‌ها */}
          <div className="card !p-3 bg-white border border-slate-200 rounded-2xl space-y-2">
            <h2 className="font-bold text-xs text-slate-700 border-b border-slate-100 pb-2">درخواست‌های در انتظار ({faNum(requests.length)})</h2>
            {requests.map(r => (
              <button
                key={r.id}
                onClick={() => pickRequest(r.id)}
                className={`w-full text-right p-2.5 rounded-xl border text-xs transition ${
                  r.id === selectedId ? 'bg-indigo-50 border-indigo-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <p className="font-bold text-slate-800">{r.studentName}</p>
                <p className="text-3xs text-slate-500 font-mono" dir="ltr">{r.studentCode}</p>
                <p className="text-3xs text-slate-500 mt-0.5">{r.previousUniversity || 'دانشگاه قبلی نامشخص'}</p>
              </button>
            ))}
          </div>

          {/* فرم نگاشت دومنظه */}
          <div className="lg:col-span-2 card !p-4 bg-white border border-slate-200 rounded-2xl space-y-3">
            {selected && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <p className="font-bold text-slate-800">{selected.studentName} — {selected.trackingCode}</p>
                    {selected.transcriptAttachment ? (
                      <p className="text-emerald-700 text-2xs mt-0.5">✓ کارنامه ممهور پیوست شده: {selected.transcriptAttachment.name}</p>
                    ) : (
                      <p className="text-rose-600 text-2xs mt-0.5">⚠️ کارنامه ممهور پیوست نشده است</p>
                    )}
                  </div>
                </div>

                {/* جستجوی دروس آفاق */}
                <div className="space-y-1">
                  <label className="text-2xs font-bold text-slate-600">جستجوی درس مقصد در چارت آفاق:</label>
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="نام یا کد درس…"
                    className="w-full p-2 text-xs rounded-xl border border-slate-300 bg-slate-50"
                  />
                  <div className="max-h-28 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {filteredCourses.slice(0, 30).map(c => (
                      <div key={c.code} className="flex items-center justify-between p-1.5 text-2xs">
                        <span className="text-slate-700">{c.title} <span className="font-mono text-slate-400" dir="ltr">({c.code})</span></span>
                        <span className="text-slate-500">{faNum(c.units)} واحد</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ردیف‌های نگاشت */}
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50">
                    <div className="space-y-1">
                      <label className="text-3xs font-bold text-slate-500">درس قبلی (دانشگاه مبدأ)</label>
                      <input value={it.sourceTitle} onChange={e => setItem(i, { sourceTitle: e.target.value })} placeholder="عنوان درس قبلی" className="w-full p-2 text-xs rounded-lg border border-slate-300" />
                      <div className="flex gap-2">
                        <input type="number" step="0.25" value={it.sourceGrade ?? ''} onChange={e => setItem(i, { sourceGrade: e.target.value === '' ? null : Number(e.target.value) })} placeholder="نمره (≥۱۲)" className="w-1/2 p-2 text-xs rounded-lg border border-slate-300" />
                        <input type="number" step="0.5" value={it.sourceUnits ?? ''} onChange={e => setItem(i, { sourceUnits: e.target.value === '' ? null : Number(e.target.value) })} placeholder="واحد" className="w-1/2 p-2 text-xs rounded-lg border border-slate-300" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-3xs font-bold text-slate-500">درس معادل در آفاق</label>
                      <select value={it.targetCourseCode} onChange={e => pickCourse(i, e.target.value)} className="w-full p-2 text-xs rounded-lg border border-slate-300 bg-white">
                        <option value="">-- انتخاب درس مقصد --</option>
                        {filteredCourses.map(c => (
                          <option key={c.code} value={c.code}>{c.title} ({c.code})</option>
                        ))}
                      </select>
                      <input value={it.headComment ?? ''} onChange={e => setItem(i, { headComment: e.target.value })} placeholder="نظر مدیر گروه و میزان انطباق سرفصل…" className="w-full p-2 text-xs rounded-lg border border-slate-300" />
                    </div>
                  </div>
                ))}

                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setItems(p => [...p, emptyRow()])} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-bold">+ افزودن درس</button>
                  <button onClick={submit} disabled={busy} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold disabled:opacity-50">
                    {busy ? 'در حال ثبت…' : '✓ تأیید علمی و ارسال به مدیرکل آموزش'}
                  </button>
                </div>

                {msg && (
                  <p className={`text-xs rounded-xl p-2.5 border ${msg.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-rose-50 text-rose-700 border-rose-300'}`}>{msg.text}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

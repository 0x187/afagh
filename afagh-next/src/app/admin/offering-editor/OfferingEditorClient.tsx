'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toGregorian, toJalaliFromDate } from '@/lib/calendar';
import { normalizeExamDate } from '@/lib/shamsi';
import {
  listOfferingsForEditor, saveOfferingEditorAction, getRoomsForEditor,
  listEduExpertsForEditor, addEduExpertToOfferingAction, removeEduExpertFromOfferingAction,
  type OfferingEditRow,
} from './actions';

/* ── تاریخِ امتحان: `schedules.examDate` (ستون date) برچسبِ **شمسی** نگه می‌دارد
   (`1405-10-22`)، نه میلادی. پس در فرم همان را نشان می‌دهیم و هنگام ذخیره هم
   همان قالب را می‌نویسیم.
   ⚠ پیش‌تر خواندن با فرض میلادی بود (`gregToJalaliInput`) و برای ردیف‌های
   شمسی تاریخِ بی‌معنا می‌ساخت (۱۴۰۵ میلادی → ۷۸۴ شمسی)؛ و نوشتن هم میلادی
   می‌شد که ستون را دوقالبه می‌کرد. هر دو با `normalizeExamDate` یکدست شد. */
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const latinize = (v: string) =>
  String(v ?? '').replace(/[۰-۹]/g, (c) => String(FA_DIGITS.indexOf(c))).replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));

/** مقدار ذخیره‌شدهٔ ستون → 'YYYY/MM/DD' شمسی برای فرم (مقاوم به هر دو قالب) */
function storedToJalaliInput(v: string | null | undefined): string {
  return normalizeExamDate(v) ?? '';
}

/** 'YYYY/MM/DD' شمسی (ارقام فارسی هم قبول است) → 'YYYY-MM-DD' شمسی برای ستون، وگرنه null */
function jalaliInputToStored(value: string): string | null {
  const m = latinize(value).trim().match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) return null;
  const jy = Number(m[1]), jm = Number(m[2]), jd = Number(m[3]);
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  // اعتبارسنجی تقویمی با تبدیل رفت‌وبرگشت (۳۱ اسفند نامعتبر است و…)
  const g = toGregorian(jy, jm, jd);
  const back = toJalaliFromDate(new Date(g.gy, g.gm - 1, g.gd));
  if (back.jy !== jy || back.jm !== jm || back.jd !== jd) return null;
  return `${jy}-${String(jm).padStart(2, '0')}-${String(jd).padStart(2, '0')}`;
}

const DAYS = [{ v: 0, n: 'شنبه' }, { v: 1, n: 'یک‌شنبه' }, { v: 2, n: 'دوشنبه' }, { v: 3, n: 'سه‌شنبه' }, { v: 4, n: 'چهارشنبه' }, { v: 5, n: 'پنج‌شنبه' }, { v: 6, n: 'جمعه' }];
const sel = 'border border-slate-300 rounded-lg px-1.5 py-1 text-xs bg-white';

export default function OfferingEditorClient({ terms }: { terms: { id: number; title: string; isCurrent: boolean }[] }) {
  const [termId, setTermId] = useState(() => terms.find(t => t.isCurrent)?.id ?? terms[0]?.id ?? 0);
  const [rows, setRows] = useState<OfferingEditRow[]>([]);
  const [rooms, setRooms] = useState<{ id: number; name: string }[]>([]);
  const [experts, setExperts] = useState<{ userId: number; name: string }[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState<OfferingEditRow | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termId]);
  useEffect(() => {
    if (open != null) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [open ]);
  const load = async () => {
    setRows(await listOfferingsForEditor(termId).catch(() => []));
    setRooms(await getRoomsForEditor().catch(() => []));
    setExperts(await listEduExpertsForEditor().catch(() => []));
  };
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter(r => (r.code + ' ' + r.title).toLowerCase().includes(t)) : rows;
  }, [rows, q]);

  const edit = (r: OfferingEditRow) => {
    setOpen(r.offeringId);
    const copy: OfferingEditRow = JSON.parse(JSON.stringify(r));
    // تاریخِ امتحان در فرم شمسی است
    if (copy.exam?.date) copy.exam.date = storedToJalaliInput(copy.exam.date);
    setDraft(copy);
    setReason('');
    setMsg(null);
  };
  const save = async () => {
    if (!draft) return;    setBusy(true); setMsg(null);
    const r = await saveOfferingEditorAction({
      offeringId: draft.offeringId, capacity: draft.capacity,
      classRows: draft.classRows.map(c => ({ id: c.id, day: c.day ?? 0, start: c.start ?? '', end: c.end ?? '', roomId: c.roomId })),
      exam: draft.exam
        ? {
            id: draft.exam.id,
            // فرم شمسی است؛ ستون دیتابیس میلادی — تبدیل این‌جا انجام می‌شود.
            date: draft.exam.date ? (jalaliInputToStored(draft.exam.date) ?? '') : '',
            start: draft.exam.start ?? '',
            end: draft.exam.end ?? '',
          }
        : null,
      overrideReason: reason,
    }).catch(() => ({ ok: false as const, error: 'خطا' }));
    if (r.ok) { setMsg({ kind: 'ok', text: '✅ ذخیره شد.' }); await load(); setOpen(null); }
    else setMsg({ kind: 'err', text: r.error ?? '' });
    setBusy(false);
  };

  /** تخصیص کارشناس آموزش — جدا از ذخیرهٔ اصلی تا کاربر بخواهد فقط همین را عوض کند.
   *  یک کلاس می‌تواند چند کارشناس داشته باشد، پس «افزودن» و «حذف» جدا هستند. */
  const addExpert = async (offeringId: number, userId: number) => {
    setBusy(true); setMsg(null);
    const r = await addEduExpertToOfferingAction(offeringId, userId).catch(() => ({ ok: false as const, error: 'خطا' }));
    if (r.ok) { setMsg({ kind: 'ok', text: '✅ کارشناس اضافه شد.' }); await load(); }
    else setMsg({ kind: 'err', text: r.error ?? '' });
    setBusy(false);
  };
  const removeExpert = async (offeringId: number, userId: number) => {
    setBusy(true); setMsg(null);
    const r = await removeEduExpertFromOfferingAction(offeringId, userId).catch(() => ({ ok: false as const, error: 'خطا' }));
    if (r.ok) { setMsg({ kind: 'ok', text: '✅ کارشناس حذف شد.' }); await load(); }
    else setMsg({ kind: 'err', text: r.error ?? '' });
    setBusy(false);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="card">
        <h1 className="font-black">🛠️ تعریف / اصلاح درس در ترم</h1>
        <p className="text-xs text-slate-500 mt-1">ظرفیت، زمان کلاس، سالن و امتحان — با گارد تداخل (برای حوادث، دلیل/حکم لازم است). کارشناس فقط دامنهٔ خودش را می‌بیند.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={termId} onChange={e => setTermId(Number(e.target.value))} className={sel}>
            {terms.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="جست‌وجوی کد/نام…" className={sel + ' w-48'} />
          <button onClick={() => { setOpen(null); load(); }} className="rounded-lg bg-slate-800 px-3 py-1.5 text-white text-xs font-bold">تازه</button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-xs rt">
          <thead className="bg-slate-100 text-slate-600"><tr>
            <th className="p-2 text-right">درس</th><th className="p-2 text-center">گروه</th><th className="p-2 text-center">ظرفیت</th>
            <th className="p-2 text-center">پر شدگی</th><th className="p-2 text-right">زمان کلاس</th><th className="p-2 text-center">امتحان</th><th className="p-2 text-center">عملیات</th>
          </tr></thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.offeringId} className="border-t border-slate-100">
                <td className="p-2"><b>{r.code}</b> {r.title}<div className="text-3xs text-slate-500">{r.professorName}</div></td>
                <td className="p-2 text-center">{r.groupNumber}</td>
                <td className="p-2 text-center">{r.capacity}</td>
                <td className="p-2 text-center">{r.enrolledCount}</td>
                <td className="p-2 text-slate-600">{r.classRows.map(c => `${DAYS.find(d => d.v === c.day)?.n ?? c.day} ${c.start}–${c.end}`).join('، ') || '—'}</td>
                <td className="p-2 text-slate-600">{r.exam ? `${storedToJalaliInput(r.exam.date) || '—'} ${r.exam.start ?? ''}` : '—'}</td>
                <td className="p-2 text-center"><button onClick={() => edit(r)} className="rounded-lg bg-indigo-700 px-3 py-1 text-white font-bold">✏️ ویرایش</button></td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={7} className="p-4 text-center text-slate-400">ارائه‌ای نیست.</td></tr>}
          </tbody>
        </table>
      </div>

      {open != null && draft && (
        <div ref={panelRef} className="rounded-2xl border-2 border-indigo-500 bg-indigo-50/60 p-4 space-y-3 scroll-mt-24 shadow-lg">
          <h3 className="text-sm font-black">✏️ {draft.code} {draft.title} (گروه {draft.groupNumber})</h3>

          {/* کارشناسانِ آموزشِ همین کلاس. جدا از بقیهٔ فرم ذخیره می‌شوند
              چون ممکن است مدیر فقط بخواهد همین را عوض کند وگرنه تداخل زمان
              کلاس دوباره بررسی می‌شود. یک کلاس می‌تواند چند کارشناس داشته باشد. */}
          <div className="rounded-xl border border-indigo-200 bg-white p-3 space-y-2">
            <p className="text-xs font-black text-indigo-800">👤 کارشناسان آموزشِ این کلاس</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.eduExpertUserIds.map(id => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-2xs font-bold text-indigo-800">
                  {experts.find(x => x.userId === id)?.name ?? `#${id}`}
                  <button
                    type="button"
                    onClick={() => removeExpert(draft.offeringId, id)}
                    disabled={busy}
                    className="text-rose-600 hover:text-rose-800 font-black"
                    title="حذف این کارشناس"
                  >×</button>
                </span>
              ))}
              {!draft.eduExpertUserIds.length && (
                <span className="text-2xs text-slate-500">
                  {draft.roomExpertUserIds?.length
                    ? 'بدون تخصیصِ صریح برای این درس — کارشناس از اتاقِ سانس‌های همین درس می‌آید:'
                    : 'خالی = کارشناس از دامنهٔ نقش‌های او پایین می‌آید.'}
                </span>
              )}
              {/* کارشناسِ ارثی از اتاق: مدیر ممکن است کارشناس را به «اتاق» سپرده باشد
                  (صفحهٔ تخصیص کارشناس به اتاق‌ها) و انتظار داشته باشد همین‌جا هم دیده شود. */}
              {(draft.roomExpertUserIds ?? [])
                .filter(id => !draft.eduExpertUserIds.includes(id))
                .map(id => (
                  <span
                    key={`room-${id}`}
                    className="inline-flex items-center gap-1 rounded-full bg-teal-100 border border-teal-300 px-2 py-0.5 text-2xs font-bold text-teal-900"
                    title="از تخصیصِ اتاق به ارث رسیده — برای تغییر، در صفحهٔ «تخصیص کارشناس به اتاق‌ها» عوض کنید"
                  >
                    {experts.find(x => x.userId === id)?.name ?? `#${id}`}
                    <span className="text-[9px] font-black opacity-70">اتاق</span>
                  </span>
                ))}
              <select
                value=""
                disabled={busy}
                onChange={e => {
                  const v = e.target.value;
                  e.target.value = '';
                  if (v) addExpert(draft.offeringId, Number(v));
                }}
                className={sel + ' w-44'}
                title="افزودن کارشناس"
              >
                <option value="">＋ افزودن کارشناس…</option>
                {experts.filter(x => !draft.eduExpertUserIds.includes(x.userId))
                  .map(x => <option key={x.userId} value={x.userId}>{x.name}</option>)}
              </select>
            </div>
            <p className="text-2xs text-slate-500">
              {draft.eduExpertUserIds.length
                ? `تخصیص صریح این کلاس (${draft.eduExpertUserIds.length} کارشناس) — بر تخصیص اتاق و نقش‌ها اولویت دارد.`
                : draft.roomExpertUserIds?.length
                  ? 'تخصیص از روی اتاقِ سانس‌های همین درس اعمال می‌شود (بدون نیاز به تخصیص صریح).'
                  : 'تخصیص صریحی برای این کلاس ثبت نشده و اتاقِ سانس‌ها هم کارشناس ندارد.'}
            </p>
            {!experts.length && (
              <p className="text-2xs text-amber-700">
                هیچ کارشناس آموزشی با نقش EDU_EXPERT ثبت نشده — ابتدا در «تخصیص نقش‌ها» اضافه کنید.
              </p>
            )}
            <a href="/admin/edu-expert-assign" className="inline-block text-2xs font-bold text-indigo-700 underline">
              📋 تخصیص گروهی برای همهٔ کلاس‌های ترم →
            </a>
          </div>

          <label className="block text-xs font-bold text-slate-600">ظرفیت
            <input type="number" value={draft.capacity} onChange={e => setDraft({ ...draft, capacity: Number(e.target.value) })} className={sel + ' w-24'} />
          </label>
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-600">جلسات کلاس (روز / از / تا / سالن)</p>
            {draft.classRows.map((c, i) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2">
                <select value={c.day ?? 0} onChange={e => setDraft({ ...draft, classRows: draft.classRows.map((x, j) => j === i ? { ...x, day: Number(e.target.value) } : x) })} className={sel}>
                  {DAYS.map(d => <option key={d.v} value={d.v}>{d.n}</option>)}
                </select>
                <input type="time" value={c.start ?? ''} onChange={e => setDraft({ ...draft, classRows: draft.classRows.map((x, j) => j === i ? { ...x, start: e.target.value } : x) })} className={sel} />
                <input type="time" value={c.end ?? ''} onChange={e => setDraft({ ...draft, classRows: draft.classRows.map((x, j) => j === i ? { ...x, end: e.target.value } : x) })} className={sel} />
                <select value={c.roomId ?? ''} onChange={e => setDraft({ ...draft, classRows: draft.classRows.map((x, j) => j === i ? { ...x, roomId: e.target.value ? Number(e.target.value) : null } : x) })} className={sel}>
                  <option value="">— سالن —</option>
                  {rooms.map(r2 => <option key={r2.id} value={r2.id}>{r2.name}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-bold text-slate-600">امتحان:</p>
            <input
              type="text"
              dir="ltr"
              value={draft.exam?.date ?? ''}
              onChange={e => setDraft({ ...draft, exam: draft.exam ? { ...draft.exam, date: e.target.value } : { id: null, date: e.target.value, start: '', end: '' } })}
              placeholder="۱۴۰۵/۱۱/۱۰"
              title="تاریخ شمسی — مثلاً ۱۴۰۵/۱۱/۱۰"
              className={sel + ' w-32 ' + (draft.exam?.date && !jalaliInputToStored(draft.exam.date) ? 'border-rose-400 bg-rose-50' : '')}
            />
            <span className="text-3xs font-bold text-slate-500">شمسی</span>
            <input type="time" value={draft.exam?.start ?? ''} onChange={e => setDraft({ ...draft, exam: draft.exam ? { ...draft.exam, start: e.target.value } : { id: null, date: '', start: e.target.value, end: '' } })} className={sel} />
            <input type="time" value={draft.exam?.end ?? ''} onChange={e => setDraft({ ...draft, exam: draft.exam ? { ...draft.exam, end: e.target.value } : { id: null, date: '', start: '', end: e.target.value } })} className={sel} />
            {draft.exam && draft.exam.date && (
              <button onClick={() => setDraft({ ...draft, exam: null })} className="text-2xs text-rose-600 font-bold">حذف امتحان</button>
            )}
          </div>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="دلیل در صورت تداخل (حکم/مجوز) — در غیر این صورت خالی…" className={sel + ' w-full'} />
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy} className="rounded-xl bg-emerald-700 px-5 py-2 text-white font-black text-xs disabled:opacity-50">ذخیره</button>
            <button onClick={() => setOpen(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold">انصراف</button>
            {msg && <span className={'text-xs font-black ' + (msg.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700')}>{msg.text}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
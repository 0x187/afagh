'use client';

import React, { useRef, useState, useTransition } from 'react';
import {
  attachPhotoAction, myChannelsAction, payStampAction, photoCategoryAction, saveChannelAction,
  submitSajjadAction, testChannelAction, trackerAction,
} from './actions';

// ═══ ردیاب فارغ‌التحصیلی دانشجو ═══
// دانشجو هیچ درخواستی ثبت نمی‌کند؛ فقط پیشرفت را می‌بیند و در گام آخر
// عکس ۴×۳ را بارگذاری و تمبر ابطال را پرداخت می‌کند.

type Tracker = Awaited<ReturnType<typeof trackerAction>>['tracker'];

const faNum = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const money = (n: number) => faNum(Number(n || 0).toLocaleString('en-US')) + ' ریال';

const CLEAR_LABEL: Record<string, string> = {
  PENDING: 'در انتظار بررسی', CLEARED: 'تسویه شد', HAS_DEBT: 'بدهی/امانت باز', WAIVED: 'معاف',
};
const CLEAR_ICON: Record<string, string> = { PENDING: '⏳', CLEARED: '✅', HAS_DEBT: '⛔', WAIVED: '➖' };
const DEGREE_LABEL: Record<string, string> = {
  TEMPORARY: 'گواهینامهٔ موقت', PERMANENT: 'دانشنامهٔ اصلی', TRANSCRIPT: 'ریزنمرات رسمی',
};

export default function TrackerClient({ initial, userId }: { initial: Tracker; userId: number }) {
  const [t, setT] = useState<Tracker>(initial);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [sajjadCode, setSajjadCode] = useState('');
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  if (!t.open) {
    const a = t.audit;
    return (
      <div className="space-y-4" dir="rtl">
        <Header />
        <div className="card p-5 space-y-3">
          <h2 className="text-sm font-black text-slate-800">وضعیت فعلی شما: در حال تحصیل</h2>
          <p className="text-xs text-slate-600 leading-6">
            نیازی به ثبت هیچ درخواستی نیست. به‌محض قطعی‌شدن آخرین نمرهٔ شما، سامانه به‌صورت خودکار سرفصل رشته را با
            کارنامه‌تان تطبیق می‌دهد و در صورت تکمیل، پروندهٔ فارغ‌التحصیلی شما بدون مراجعه باز می‌شود.
          </p>
          {a && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Cell label="واحد گذرانده" value={faNum(a.passedUnits)} />
                <Cell label="حداقل واحد لازم" value={faNum(a.requiredUnits)} />
                <Cell label="معدل کل" value={a.gpa == null ? '—' : faNum(a.gpa)} />
                <Cell label="تطبیق سرفصل" value={a.catalogOk ? 'کامل ✅' : 'ناقص ⏳'} />
              </div>
              {!!a.missing.length && (
                <div className="text-xs bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <b className="text-amber-800">دروس باقی‌مانده تا فراغت:</b>
                  <ul className="list-disc pr-5 mt-1 space-y-0.5 text-amber-900">
                    {a.missing.map(c => <li key={c.code}>{c.title} — {faNum(c.units)} واحد ({c.code})</li>)}
                  </ul>
                </div>
              )}
              {!!a.reasons.length && (
                <ul className="text-2xs text-slate-500 list-disc pr-5 space-y-0.5">
                  {a.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
        <ChannelsCard />
      </div>
    );
  }

  const d = t.dossier!;
  const a = d.audit;
  const doneCount = t.steps.filter(s => s.state === 'DONE').length;
  const percent = Math.round((doneCount / t.steps.length) * 100);

  const refresh = (okText?: string) => start(async () => {
    const r = await trackerAction();
    if (r.ok) setT(r.tracker);
    if (okText) setMsg({ kind: 'ok', text: okText });
  });

  const uploadPhoto = () => start(async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) { setMsg({ kind: 'err', text: 'ابتدا فایل عکس را انتخاب کنید.' }); return; }
    const cat = await photoCategoryAction();
    const fd = new FormData();
    fd.append('file', f);
    fd.append('studentUserId', String(userId));
    fd.append('categoryId', String(cat.categoryId));
    const resp = await fetch('/api/admin/archive/upload', { method: 'POST', body: fd });
    const j = (await resp.json()) as { ok?: boolean; docId?: number; error?: string };
    if (!j.ok || !j.docId) { setMsg({ kind: 'err', text: j.error || 'بارگذاری ناموفق بود.' }); return; }
    const r = await attachPhotoAction(a.id, j.docId);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setT(r.tracker);
    setMsg({ kind: 'ok', text: 'عکس شما ثبت شد.' });
  });

  const pay = () => start(async () => {
    const r = await payStampAction(a.id);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: 'پرداخت تمبر ابطال ثبت شد.' });
  });
  const needPhoto = t.needPhoto && !a.photoDocumentId;
  const needFee = Number(a.stampFeeAmount ?? 0) > 0 && !a.stampFeePaid;
  const needSajjad = t.needSajjad;

  const submitSajjad = () => start(async () => {
    const r = await submitSajjadAction(a.id, sajjadCode);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setT(r.tracker); setSajjadCode('');
    setMsg({ kind: 'ok', text: 'کد رهگیری درخواست سجاد ثبت شد؛ پرونده به کارشناس صدور مدرک ارجاع می‌شود.' });
  });

  return (
    <div className="space-y-4" dir="rtl">
      <Header />

      {msg && (
        <div className={`card p-3 text-xs font-bold ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {msg.text} <button className="float-left text-slate-400" onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {/* نوار پیشرفت */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-800">پیشرفت پروندهٔ شما</h2>
          <span className="text-xs font-black text-emerald-700">{faNum(percent)}٪</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-l from-emerald-500 to-teal-600 transition-all" style={{ width: `${percent}%` }} />
        </div>
        <ol className="space-y-2">
          {t.steps.map(s => (
            <li key={s.code} className={`flex items-start gap-3 p-2 rounded-xl border ${
              s.state === 'DONE' ? 'bg-emerald-50 border-emerald-200'
                : s.state === 'CURRENT' ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'}`}>
              <span className="text-base">{s.state === 'DONE' ? '✅' : s.state === 'CURRENT' ? '⏳' : '⚪'}</span>
              <div>
                <div className="text-xs font-black text-slate-800">{s.title}</div>
                <div className="text-3xs text-slate-500">مسئول این مرحله: {s.actor}</div>
              </div>
            </li>
          ))}
        </ol>
        {a.workflowStatus === 'ON_HOLD' && (
          <div className="text-xs font-black text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
            ⛔ پروندهٔ شما موقتاً متوقف شده است: {a.note}
          </div>
        )}
        <button onClick={() => refresh('وضعیت به‌روزرسانی شد.')} disabled={pending}
          className="px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-black disabled:opacity-50">به‌روزرسانی وضعیت</button>
      </div>

      {/* تسویه‌حساب */}
      {!!d.checklist.length && (
        <div className="card p-4">
          <h2 className="text-sm font-black text-slate-800 mb-2">تسویه‌حساب واحدها (هم‌زمان)</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {d.checklist.map(c => (
              <div key={c.id} className="border border-slate-200 rounded-xl p-2 bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-800">{c.title}</span>
                  <span className="text-sm">{CLEAR_ICON[c.status] ?? '⏳'}</span>
                </div>
                <div className="text-3xs font-bold text-slate-500">{CLEAR_LABEL[c.status] ?? c.status}{c.autoChecked ? ' — بررسی خودکار سیستم' : ''}</div>
                {!!c.amountDue && <div className="text-3xs font-black text-rose-700">بدهی: {money(c.amountDue)}</div>}
                {c.detail && <div className="text-3xs text-slate-500 mt-0.5 leading-4">{c.detail}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* گام سجاد: اقدام خودِ دانشجو پیش از کارشناس صدور مدرک */}
      {needSajjad && (
        <div className="card p-4 border-2 border-indigo-300 bg-indigo-50/60 space-y-3">
          <h2 className="text-sm font-black text-indigo-900">اقدام لازم: ثبت درخواست «کد صحت» در سامانهٔ سجاد</h2>
          <p className="text-xs text-indigo-900 leading-6">
            همهٔ امضاها و تسویه‌حساب‌های شما کامل شد. طبق مقررات وزارت علوم، پیش از ارجاع پرونده به
            کارشناس صدور مدرک، باید خودتان در سامانهٔ سجاد درخواست «تأیید مدرک / کد صحت» را ثبت کنید و
            کد رهگیری آن را اینجا وارد نمایید.
          </p>
          <a href={t.sajjadPortal} target="_blank" rel="noreferrer"
            className="inline-block px-3 py-1.5 rounded-lg bg-indigo-800 text-white text-xs font-black">
            ورود به سامانهٔ سجاد ↗
          </a>
          <div className="flex flex-wrap gap-2 items-center">
            <input value={sajjadCode} onChange={e => setSajjadCode(e.target.value)}
              placeholder="کد رهگیری درخواست سجاد"
              className="border border-indigo-200 rounded-lg px-3 py-2 text-xs min-w-56" />
            <button onClick={submitSajjad} disabled={pending}
              className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs font-black disabled:opacity-50">
              ثبت کد رهگیری و ادامهٔ فرآیند
            </button>
          </div>
        </div>
      )}

      {a.sajjadRequestCode && (
        <div className="card p-3 text-2xs font-bold text-slate-600">
          کد رهگیری سجاد ثبت‌شدهٔ شما: <span className="font-mono text-slate-900">{a.sajjadRequestCode}</span>
          {a.sajjadStatus === 'CONFIRMED' ? ' — کد صحت از وزارت علوم دریافت شد ✅' : ' — در انتظار دریافت کد صحت'}
        </div>
      )}

      {/* گام پایانی دانشجو */}
      {(needPhoto || needFee) && (
        <div className="card p-4 border-2 border-amber-300 bg-amber-50/60 space-y-3">
          <h2 className="text-sm font-black text-amber-900">اقدام لازم از سوی شما</h2>
          {needPhoto && (
            <div className="space-y-2">
              <p className="text-xs text-amber-900 font-bold">بارگذاری عکس ۴×۳ جدید (پشت‌زمینهٔ روشن، فرمت JPG یا PNG)</p>
              <div className="flex gap-2 flex-wrap items-center">
                <input ref={fileRef} type="file" accept="image/*" className="text-2xs" />
                <button onClick={uploadPhoto} disabled={pending}
                  className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-black disabled:opacity-50">بارگذاری عکس</button>
              </div>
            </div>
          )}
          {needFee && (
            <div className="space-y-2">
              <p className="text-xs text-amber-900 font-bold">پرداخت هزینهٔ تمبر ابطال: {money(Number(a.stampFeeAmount))}</p>
              {/* ⛔ ثبت پرداخت از سمت دانشجو حذف شد (جعل اعتبار در دفتر مالی).
                  تسویه فقط با تأیید واحد مالی انجام می‌شود. */}
              <p className="text-2xs text-slate-600 leading-5">
                مبلغ را به واحد مالی پرداخت کنید؛ پس از تأیید کارشناس مالی، وضعیت این بند خودکار به «تسویه‌شده» تغییر می‌کند.
              </p>
              <button onClick={pay} disabled={pending}
                className="px-3 py-1.5 rounded-lg bg-slate-600 text-white text-xs font-black disabled:opacity-50">راهنمای پرداخت</button>
            </div>
          )}
        </div>
      )}

      <ChannelsCard />

      {/* مدارک صادرشده */}
      {!!d.degrees.length && (
        <div className="card p-4">
          <h2 className="text-sm font-black text-slate-800 mb-2">مدارک صادرشده</h2>
          <div className="space-y-2">
            {d.degrees.map(g => (
              <div key={g.id} className="border border-slate-200 rounded-xl p-2 flex flex-wrap items-center gap-2 justify-between">
                <div>
                  <div className="text-xs font-black text-slate-800">{DEGREE_LABEL[g.degreeType] ?? g.degreeType}</div>
                  <div className="text-3xs font-mono text-slate-500">سریال: {g.serialNo}</div>
                </div>
                <a href={`/verify-degree/${g.verifyCode}`} target="_blank" rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-slate-100 text-2xs font-black">استعلام/مشاهده</a>
              </div>
            ))}
          </div>
          <p className="text-2xs text-slate-500 mt-2 leading-5">
            پس از صدور مدرک، حساب شما به «پورتال دانش‌آموختگان» منتقل می‌شود و خدمات پس از فراغت از آنجا قابل درخواست است.
          </p>
        </div>
      )}
    </div>
  );
}

const CHANNEL_LABEL: Record<string, string> = {
  INAPP: 'پیام درون‌سامانه', SMS: 'پیامک', TELEGRAM: 'تلگرام', BALE: 'بله', EITAA: 'ایتا',
};

/** ثبت نشانی دانشجو در کانال‌های اطلاع‌رسانی فعال دانشگاه */
function ChannelsCard() {
  const [state, setState] = useState<{ active: string[]; mine: { channel: string; address: string }[] } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();

  const load = () => start(async () => {
    const r = await myChannelsAction();
    if (r.ok) {
      setState({ active: r.active, mine: r.mine });
      setDraft(Object.fromEntries(r.mine.map(m => [m.channel, m.address])));
    }
  });

  React.useEffect(load, []);
  if (!state) return null;
  const externals = state.active.filter(c => c !== 'INAPP');
  if (!externals.length) return null;

  return (
    <div className="card p-4 space-y-2">
      <h2 className="text-sm font-black text-slate-800">اطلاع‌رسانی مراحل فارغ‌التحصیلی</h2>
      <p className="text-2xs text-slate-500 leading-5">
        همهٔ رویدادهای پرونده (تبریک شروع فرآیند، تسویه‌حساب، درخواست سجاد و صدور مدرک) علاوه بر
        پیام درون‌سامانه‌ای، از این کانال‌ها هم برای شما ارسال می‌شود.
      </p>
      {externals.map(ch => (
        <div key={ch} className="flex flex-wrap items-center gap-2">
          <span className="text-2xs font-black text-slate-700 w-20">{CHANNEL_LABEL[ch] ?? ch}</span>
          <input
            value={draft[ch] ?? ''} onChange={e => setDraft({ ...draft, [ch]: e.target.value })}
            placeholder={ch === 'SMS' ? 'شمارهٔ موبایل (۰۹…)' : 'شناسهٔ چت شما در ربات دانشگاه'}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-2xs flex-1 min-w-48"
          />
          <button disabled={pending} onClick={() => start(async () => {
            const r = await saveChannelAction(ch, draft[ch] ?? '');
            setNote(r.ok ? 'ذخیره شد.' : r.error);
            if (r.ok) setState(s => (s ? { ...s, mine: r.mine } : s));
          })} className="px-2 py-1 rounded-lg bg-slate-200 text-2xs font-black disabled:opacity-50">ذخیره</button>
          <button disabled={pending} onClick={() => start(async () => {
            const r = await testChannelAction(ch);
            setNote(!r.ok ? r.error : r.status === 'SENT' ? 'پیام آزمایشی ارسال شد.' : `ارسال نشد: ${r.error ?? r.status}`);
          })} className="px-2 py-1 rounded-lg bg-emerald-700 text-white text-2xs font-black disabled:opacity-50">ارسال آزمایشی</button>
        </div>
      ))}
      {note && <div className="text-2xs font-bold text-slate-600">{note}</div>}
    </div>
  );
}

function Header() {
  return (
    <header className="card p-4 bg-gradient-to-l from-emerald-700 to-teal-800 text-white">
      <h1 className="text-base sm:text-lg font-black">فارغ‌التحصیلی من</h1>
      <p className="text-2xs text-emerald-100 mt-1 leading-6">
        این فرآیند کاملاً خودکار است؛ لازم نیست درخواستی ثبت کنید یا بین دفاتر مراجعه کنید.
        هر تغییری در پرونده، همین‌جا و با اعلان به شما نمایش داده می‌شود.
      </p>
    </header>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-2">
      <div className="text-3xs text-slate-500 font-bold">{label}</div>
      <div className="text-sm font-black text-slate-800">{value}</div>
    </div>
  );
}

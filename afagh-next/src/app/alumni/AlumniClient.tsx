'use client';

import React, { useState, useTransition } from 'react';
import { payRequestAction, saveProfileAction, submitRequestAction } from './actions';
import { isSafeLinkUrl } from '@/lib/safe-url';

// ═══ پورتال دانش‌آموختگان: خدمات آنلاین پس از فراغت ═══

type Service = { code: string; title: string; hint: string; needsDestination: boolean; fee: number };
type Req = {
  id: number; requestType: string; trackingCode: string; status: string; fee: number;
  destination: string | null; description: string | null; resultFileUrl: string | null;
  adminNote: string | null; createdAt: string | null; paidAt: string | null;
};
type Degree = {
  id: number; degreeType: string; serialNo: string; verifyCode: string;
  ministryVerificationCode: string | null; isDelivered: boolean; issuedAt: string;
};
type Profile = {
  employmentStatus: string; organization: string; jobTitle: string;
  contactEmail: string; contactMobile: string; linkedinUrl: string; allowContact: boolean;
};

const faNum = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const money = (n: number) => faNum(Number(n || 0).toLocaleString('en-US')) + ' ریال';
const dt = (s: string | null) => (s ? faNum(new Date(s).toLocaleDateString('fa-IR')) : '—');

const STATUS_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: 'در انتظار پرداخت', PAID: 'پرداخت‌شده', IN_REVIEW: 'در حال بررسی',
  DONE: 'انجام شد', REJECTED: 'رد شد',
};
const STATUS_STYLE: Record<string, string> = {
  AWAITING_PAYMENT: 'bg-amber-100 text-amber-800', PAID: 'bg-sky-100 text-sky-800',
  IN_REVIEW: 'bg-indigo-100 text-indigo-800', DONE: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
};
const DEGREE_LABEL: Record<string, string> = {
  TEMPORARY: 'گواهینامهٔ موقت', PERMANENT: 'دانشنامهٔ اصلی', TRANSCRIPT: 'ریزنمرات رسمی',
};
const EMPLOYMENT = ['شاغل', 'جویای کار', 'ادامهٔ تحصیل', 'کارآفرین', 'سایر'];

export default function AlumniClient({ me, services, initialRequests, degrees, initialProfile }: {
  me: { fullName: string; studentCode: string; majorName: string | null; degreeTitle: string | null; entryYear: number | null };
  services: Service[]; initialRequests: Req[]; degrees: Degree[]; initialProfile: Profile;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [profile, setProfile] = useState(initialProfile);
  const [selected, setSelected] = useState<Service | null>(null);
  const [destination, setDestination] = useState('');
  const [description, setDescription] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const submit = () => start(async () => {
    if (!selected) return;
    const r = await submitRequestAction({ requestType: selected.code, destination, description });
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setRequests(r.requests);
    setSelected(null); setDestination(''); setDescription('');
    setMsg({ kind: 'ok', text: 'درخواست شما ثبت شد. کد رهگیری در جدول زیر است.' });
  });

  const pay = (id: number) => start(async () => {
    const r = await payRequestAction(id);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setRequests(r.requests);
    setMsg({ kind: 'ok', text: 'پرداخت ثبت شد و درخواست به کارتابل اداره آموزش رفت.' });
  });

  const saveProf = () => start(async () => {
    const r = await saveProfileAction(profile);
    setMsg(r.ok ? { kind: 'ok', text: 'اطلاعات شما به‌روزرسانی شد.' } : { kind: 'err', text: r.error });
  });

  return (
    <div className="space-y-4">
      <div className="card p-4 bg-gradient-to-l from-indigo-800 to-violet-900 text-white">
        <h1 className="text-base sm:text-lg font-black">{me.fullName} عزیز، به جمع دانش‌آموختگان خوش آمدید 🎓</h1>
        <p className="text-2xs text-indigo-100 mt-1 leading-6">
          شمارهٔ دانشجویی {faNum(me.studentCode)} — {me.majorName ?? '—'} / {me.degreeTitle ?? '—'}
          {me.entryYear ? ` — ورودی ${faNum(me.entryYear)}` : ''}
        </p>
      </div>

      {msg && (
        <div className={`card p-3 text-xs font-bold ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {msg.text} <button className="float-left text-slate-400" onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {/* مدارک */}
      <div className="card p-4">
        <h2 className="text-sm font-black text-slate-800 mb-2">مدارک تحصیلی من</h2>
        {!degrees.length && <p className="text-xs text-slate-500 font-bold">هنوز مدرکی صادر نشده است.</p>}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {degrees.map(g => (
            <div key={g.id} className="border border-slate-200 rounded-xl p-3 bg-white space-y-1">
              <div className="text-xs font-black text-slate-800">{DEGREE_LABEL[g.degreeType] ?? g.degreeType}</div>
              <div className="text-3xs font-mono text-slate-500">سریال: {g.serialNo}</div>
              {g.ministryVerificationCode && <div className="text-3xs font-mono text-slate-500">کد صحت وزارت: {g.ministryVerificationCode}</div>}
              <div className="text-3xs text-slate-500">تاریخ صدور: {dt(g.issuedAt)} — {g.isDelivered ? 'تحویل شده ✅' : 'در انتظار تحویل'}</div>
              <a href={`/verify-degree/${g.verifyCode}`} target="_blank" rel="noreferrer"
                className="inline-block px-2 py-1 rounded-lg bg-indigo-100 text-indigo-800 text-3xs font-black">صفحهٔ استعلام و QR</a>
            </div>
          ))}
        </div>
      </div>

      {/* خدمات */}
      <div className="card p-4">
        <h2 className="text-sm font-black text-slate-800 mb-2">خدمات آنلاین دانش‌آموختگان</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {services.map(s => (
            <button key={s.code} onClick={() => setSelected(s)}
              className={`text-right border rounded-xl p-3 bg-white hover:border-indigo-400 transition ${selected?.code === s.code ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-slate-200'}`}>
              <div className="text-xs font-black text-slate-800">{s.title}</div>
              <div className="text-3xs text-slate-500 leading-4 mt-1">{s.hint}</div>
              <div className="text-2xs font-black text-indigo-700 mt-1">{s.fee > 0 ? money(s.fee) : 'رایگان'}</div>
            </button>
          ))}
        </div>

        {selected && (
          <div className="mt-3 border-t border-slate-100 pt-3 space-y-2">
            <h3 className="text-xs font-black text-slate-800">ثبت درخواست: {selected.title}</h3>
            {selected.needsDestination && (
              <input value={destination} onChange={e => setDestination(e.target.value)}
                placeholder="نام دارالترجمه یا سازمان مقصد"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs" />
            )}
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              placeholder="توضیح تکمیلی (اختیاری)"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs" />
            <div className="flex gap-2">
              <button onClick={submit} disabled={pending}
                className="px-4 py-2 rounded-lg bg-indigo-800 text-white text-xs font-black disabled:opacity-50">
                ثبت درخواست {selected.fee > 0 ? `و پرداخت ${money(selected.fee)}` : ''}
              </button>
              <button onClick={() => setSelected(null)} className="px-3 py-2 rounded-lg bg-slate-100 text-xs font-black">انصراف</button>
            </div>
          </div>
        )}
      </div>

      {/* درخواست‌های من */}
      <div className="card p-4 overflow-x-auto">
        <h2 className="text-sm font-black text-slate-800 mb-2">پیگیری درخواست‌های من</h2>
        <table className="w-full text-2xs rt">
          <thead className="bg-slate-50 text-slate-500"><tr>
            {['کد رهگیری', 'خدمت', 'مقصد', 'هزینه', 'وضعیت', 'تاریخ', 'اقدام'].map(h => <th key={h} className="p-2 text-right font-black">{h}</th>)}
          </tr></thead>
          <tbody>
            {requests.map(r => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-2 font-mono">{r.trackingCode}</td>
                <td className="p-2 font-bold">{services.find(s => s.code === r.requestType)?.title ?? r.requestType}</td>
                <td className="p-2">{r.destination ?? '—'}</td>
                <td className="p-2 font-mono">{r.fee ? money(r.fee) : 'رایگان'}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded font-black text-3xs ${STATUS_STYLE[r.status] ?? 'bg-slate-100'}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  {r.adminNote && <div className="text-3xs text-slate-500 mt-0.5">{r.adminNote}</div>}
                </td>
                <td className="p-2 text-3xs">{dt(r.createdAt)}</td>
                <td className="p-2">
                  {r.status === 'AWAITING_PAYMENT' && (
                    <>
                      {/* ⛔ ثبت پرداخت از سمت دانش‌آموخته حذف شد — تسویه با تأیید واحد مالی */}
                      <button onClick={() => pay(r.id)} disabled={pending}
                        title="مبلغ را به واحد مالی پرداخت کنید؛ پس از تأیید کارشناس، درخواست به کارتابل اداره آموزش می‌رود."
                        className="px-2 py-1 rounded-lg bg-slate-600 text-white text-3xs font-black disabled:opacity-50">راهنمای پرداخت</button>
                    </>
                  )}
                  {r.resultFileUrl && isSafeLinkUrl(r.resultFileUrl) && (
                    <a href={r.resultFileUrl} className="px-2 py-1 rounded-lg bg-slate-100 text-3xs font-black">دریافت فایل</a>
                  )}
                </td>
              </tr>
            ))}
            {!requests.length && <tr><td colSpan={7} className="p-6 text-center text-slate-400 font-bold">هنوز درخواستی ثبت نکرده‌اید.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* پروندهٔ دانش‌آموخته */}
      <div className="card p-4 space-y-2">
        <h2 className="text-sm font-black text-slate-800">اطلاعات شغلی و ارتباطی من</h2>
        <p className="text-2xs text-slate-500">این اطلاعات برای شبکهٔ دانش‌آموختگان و دعوت به رویدادهای دانشگاه استفاده می‌شود.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <label className="block">
            <span className="text-3xs font-bold text-slate-500">وضعیت اشتغال</span>
            <select value={profile.employmentStatus} onChange={e => setProfile({ ...profile, employmentStatus: e.target.value })}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs">
              <option value="">—</option>
              {EMPLOYMENT.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          {([['organization', 'سازمان/شرکت'], ['jobTitle', 'عنوان شغلی'], ['contactEmail', 'رایانامه'], ['contactMobile', 'تلفن همراه'], ['linkedinUrl', 'نشانی لینکدین']] as const).map(([k, l]) => (
            <label key={k} className="block">
              <span className="text-3xs font-bold text-slate-500">{l}</span>
              <input value={profile[k]} onChange={e => setProfile({ ...profile, [k]: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" />
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs font-bold">
          <input type="checkbox" checked={profile.allowContact} onChange={e => setProfile({ ...profile, allowContact: e.target.checked })} />
          دانشگاه می‌تواند برای فرصت‌های شغلی و رویدادها با من تماس بگیرد.
        </label>
        <button onClick={saveProf} disabled={pending}
          className="px-4 py-2 rounded-lg bg-indigo-800 text-white text-xs font-black disabled:opacity-50">ذخیرهٔ اطلاعات</button>
      </div>
    </div>
  );
}

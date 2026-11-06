'use client';

import { useRef, useState } from 'react';
import { Msg, fmt } from './ui';

// ═══ سربرگ «عکس افراد» — واردسازی دسته‌ای عکس‌ها از یک آرشیو ZIP ═══
// عکس‌ها در سیستم قدیمی فایل‌های جدا هستند و در جدول اشخاص فقط نامشان آمده.
// اینجا کاربر ZIP را می‌دهد و سامانه می‌گوید هر عکس به چه کسی می‌خورد،
// پیش از آنکه چیزی ذخیره شود.

type PhotoReport = {
  fileName: string; mode: 'DRY' | 'COMMIT';
  totalEntries: number; matched: number; stored: number; replaced: number;
  orphans: { path: string; reason: string }[];
  skipped: { path: string; reason: string }[];
  missingCount: number;
  missingSample: { fullName: string; expected: string | null }[];
  errors: string[];
  sample: { path: string; person: string; by: string; replaces: boolean }[];
  error?: string;
};

const SCOPES = [
  { id: 'all', title: 'همه (استاد، دانشجو، کارکنان)' },
  { id: 'professor', title: 'فقط استادان' },
  { id: 'student', title: 'فقط دانشجویان' },
  { id: 'staff', title: 'کارکنان و استادان' },
];

export default function PhotosTab() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState('all');
  const [busy, setBusy] = useState('');
  const [name, setName] = useState('');
  const [report, setReport] = useState<PhotoReport | null>(null);

  async function run(commit: boolean) {
    const f = fileRef.current?.files?.[0];
    if (!f) { setReport({ error: 'اول فایل ZIP عکس‌ها را انتخاب کنید.' } as PhotoReport); return; }
    setBusy(commit ? 'commit' : 'dry');
    try {
      const fd = new FormData();
      fd.set('file', f);
      fd.set('scope', scope);
      fd.set('commit', commit ? '1' : '0');
      const r = await fetch('/api/admin/migration/photos', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({ error: 'پاسخ نامعتبر از سرور' }));
      setReport(r.ok ? j : { ...j, error: j.error || `HTTP ${r.status}` });
    } catch (e) {
      setReport({ error: (e as Error).message } as PhotoReport);
    } finally { setBusy(''); }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <h3 className="font-bold">🖼 عکس افراد (استادان، دانشجویان، کارکنان)</h3>
          <p className="mt-1 text-xs leading-6 text-slate-500">
            همهٔ عکس‌ها را در یک فایل <b>ZIP</b> بگذارید و اینجا بدهید. سامانه هر عکس را با این
            ترتیب به صاحبش وصل می‌کند:
            <b> ۱)</b> ستون «نام فایل عکس» که هنگام انتقال استادان/دانشجویان از اکسل خوانده شده،
            <b> ۲)</b> کد ملی، <b>۳)</b> شمارهٔ دانشجویی یا کد استادی.
            یعنی نام فایل می‌تواند <span dir="ltr">1024.jpg</span> یا <span dir="ltr">0011111111.jpg</span> باشد.
          </p>
          <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1.5 text-2xs leading-6 text-amber-800">
            اول <b>اشخاص</b> را وارد کنید بعد عکس‌ها را؛ عکسی که صاحبش هنوز در سامانه نیست ذخیره نمی‌شود.
            اگر یک نام فایل به دو نفر بخورد، آن عکس عمداً به هیچ‌کس وصل نمی‌شود.
            فرمت‌های مجاز: JPG، PNG، WEBP، GIF، BMP — حداکثر ۵ مگابایت برای هر عکس.
          </p>
        </div>

        <div className="grid gap-2 md:grid-cols-12 md:items-center">
          <select className="input md:col-span-3" value={scope} onChange={e => setScope(e.target.value)}>
            {SCOPES.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <input
            ref={fileRef} type="file" accept=".zip,application/zip" className="input md:col-span-5"
            onChange={e => { setName(e.target.files?.[0]?.name ?? ''); setReport(null); }}
          />
          <div className="md:col-span-4 flex gap-2">
            <button className="btn-ghost flex-1 whitespace-nowrap" disabled={!!busy} onClick={() => run(false)}>
              {busy === 'dry' ? '…' : 'تحلیل اولیه'}
            </button>
            <button className="btn-primary flex-1 whitespace-nowrap" disabled={!!busy} onClick={() => run(true)}>
              {busy === 'commit' ? '…' : 'ثبت نهایی عکس‌ها'}
            </button>
          </div>
          {name && <p className="md:col-span-12 text-2xs text-slate-400" dir="ltr">{name}</p>}
        </div>
      </div>

      {report?.error && <div className="card"><Msg kind="err">{report.error}</Msg></div>}

      {report && !report.error && (
        <div className="card space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Box n={report.totalEntries} t="فایل در آرشیو" />
            <Box n={report.matched} t="تطبیق‌یافته" cls="text-emerald-600" />
            <Box n={report.mode === 'COMMIT' ? report.stored : 0} t="ذخیره‌شده" cls="text-indigo-600" />
            <Box n={report.orphans.length} t="بی‌صاحب" cls="text-red-600" />
            <Box n={report.missingCount} t="افراد بدون عکس" cls="text-amber-500" />
          </div>

          {report.mode === 'DRY' && report.matched > 0 && (
            <Msg kind="info">
              چیزی ذخیره نشد. {fmt(report.matched)} عکس آمادهٔ ثبت است
              {report.replaced > 0 ? ` (${fmt(report.replaced)} مورد جایگزین عکس فعلی می‌شود)` : ''}.
              برای نوشتن روی سامانه، «ثبت نهایی عکس‌ها» را بزنید.
            </Msg>
          )}
          {report.mode === 'COMMIT' && (
            <Msg kind="ok">{fmt(report.stored)} عکس ذخیره شد{report.replaced > 0 ? ` (${fmt(report.replaced)} عکس قبلی جایگزین شد)` : ''}.</Msg>
          )}

          {report.errors.length > 0 && (
            <Msg kind="err">
              <p className="mb-1 font-bold">خطاها:</p>
              {report.errors.slice(0, 8).map((e, i) => <p key={i}>{e}</p>)}
            </Msg>
          )}

          {report.sample.length > 0 && (
            <div className="overflow-x-auto">
              <p className="mb-1 text-xs font-bold text-slate-600">نمونهٔ تطبیق‌ها</p>
              <table className="w-full text-right text-2xs rt">
                <thead><tr className="text-slate-500"><th className="p-1">فایل</th><th className="p-1">شخص</th><th className="p-1">تطبیق بر پایهٔ</th><th className="p-1">وضعیت</th></tr></thead>
                <tbody>
                  {report.sample.map((s, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="p-1 font-mono text-slate-600" dir="ltr">{s.path}</td>
                      <td className="p-1">{s.person}</td>
                      <td className="p-1 text-slate-500">{s.by}</td>
                      <td className="p-1">{s.replaces ? <span className="badge bg-amber-100 text-amber-800">جایگزینی</span> : <span className="badge bg-emerald-100 text-emerald-700">جدید</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.orphans.length > 0 && (
            <Msg kind="warn">
              <p className="mb-1 font-bold">عکس‌های بی‌صاحب (ذخیره نشدند):</p>
              {report.orphans.slice(0, 10).map((o, i) => <p key={i} dir="ltr" className="text-right">{o.path} — {o.reason}</p>)}
              {report.orphans.length > 10 && <p>… و {fmt(report.orphans.length - 10)} مورد دیگر</p>}
            </Msg>
          )}

          {report.skipped.length > 0 && (
            <Msg kind="info">
              <p className="mb-1 font-bold">نادیده‌گرفته‌شده‌ها:</p>
              {report.skipped.slice(0, 6).map((o, i) => <p key={i} dir="ltr" className="text-right">{o.path} — {o.reason}</p>)}
            </Msg>
          )}

          {report.missingSample.length > 0 && (
            <Msg kind="warn">
              <p className="mb-1 font-bold">افرادی که هنوز عکس ندارند:</p>
              <p>{report.missingSample.map(m => m.fullName + (m.expected ? ` (منتظر فایل ${m.expected})` : '')).join(' · ')}</p>
              {report.missingCount > report.missingSample.length && <p>… و {fmt(report.missingCount - report.missingSample.length)} نفر دیگر</p>}
            </Msg>
          )}
        </div>
      )}
    </div>
  );
}

function Box({ n, t, cls = 'text-slate-700' }: { n: number; t: string; cls?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-2 text-center">
      <p className={'text-xl font-bold ' + cls}>{fmt(n)}</p>
      <p className="text-2xs text-slate-500">{t}</p>
    </div>
  );
}

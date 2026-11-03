'use client';

import { useRouter } from 'next/navigation';
import { askConfirm } from '@/lib/ui-feedback';
import { useState } from 'react';
import {
  deleteNoticeAction, deleteShowcaseLogoAction, deleteSlideAction,
  saveNoticeAction, saveSlideAction, uploadShowcaseLogoAction, uploadSlideImageAction,
} from './actions';

type Uni = { id: number; code: string; title: string; logoUrl: string | null };
type Notice = { id: number; universityId: number | null; title: string; body: string; kind: string; isActive: boolean; sortOrder: number };
type Slide = { id: number; universityId: number | null; title: string; subtitle: string; imageUrl: string; linkUrl: string; isActive: boolean; sortOrder: number };

const KINDS: Record<string, { label: string; cls: string }> = {
  info: { label: 'ℹ️ معمولی', cls: 'bg-sky-100 text-sky-900' },
  warning: { label: '⚠️ هشدار', cls: 'bg-amber-100 text-amber-900' },
  important: { label: '📢 مهم', cls: 'bg-red-100 text-red-900' },
};

function uniName(unis: Uni[], id: number | null): string {
  if (!id) return 'سراسری (همه)';
  return unis.find(u => u.id === id)?.title ?? `دانشگاه ${id}`;
}

export default function LoginShowcaseClient({ universities, notices, slides }: { universities: Uni[]; notices: Notice[]; slides: Slide[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<'notices' | 'slides' | 'brands'>('notices');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [editN, setEditN] = useState<Partial<Notice> | null>(null);
  const [editS, setEditS] = useState<Partial<Slide> | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg('');
    try { await fn(); setMsg(`✅ ${ok}`); setEditN(null); setEditS(null); router.refresh(); }
    catch (e: any) { setMsg(`⛔ ${e?.message || 'خطا'}`); }
    finally { setBusy(false); }
  }

  async function uploadSlideImage(file: File, apply: (url: string) => void) {
    const fd = new FormData();
    fd.append('image', file);
    setBusy(true); setMsg('');
    try {
      const { url } = await uploadSlideImageAction(fd);
      apply(url); setMsg('✅ تصویر بارگذاری شد.');
    } catch (e: any) { setMsg(`⛔ ${e?.message || 'خطا'}`); }
    finally { setBusy(false); }
  }

  const inputCls = 'input w-full text-sm';
  const labelCls = 'block text-xs font-bold text-slate-600 mb-1';

  return (
    <div className="space-y-4">
      {msg && <p className="card text-sm font-bold text-slate-800">{msg}</p>}

      <div className="flex gap-2">
        {([['notices', '📢 اطلاعیه‌ها'], ['slides', '🖼️ اسلایدها'], ['brands', '🏛️ ارم و نام دانشگاه‌ها']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-xl text-xs font-black border transition ${tab === k ? 'bg-indigo-700 text-white border-transparent shadow' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── اطلاعیه‌ها ── */}
      {tab === 'notices' && (
        <div className="space-y-3">
          <button disabled={busy} onClick={() => setEditN({ title: '', body: '', kind: 'info', universityId: null, isActive: true, sortOrder: notices.length })} className="btn-primary text-xs">
            ＋ اطلاعیه جدید
          </button>
          {editN && (
            <div className="card space-y-3 border-indigo-300">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>عنوان</label>
                  <input className={inputCls} value={editN.title ?? ''} onChange={e => setEditN({ ...editN, title: e.target.value })} placeholder="مثلاً: شروع انتخاب واحد ترم بهار" />
                </div>
                <div>
                  <label className={labelCls}>نوع</label>
                  <select className={inputCls} value={editN.kind ?? 'info'} onChange={e => setEditN({ ...editN, kind: e.target.value })}>
                    <option value="info">ℹ️ معمولی</option>
                    <option value="warning">⚠️ هشدار</option>
                    <option value="important">📢 مهم (بالای فرم ورود)</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>دانشگاه</label>
                  <select className={inputCls} value={editN.universityId ?? ''} onChange={e => setEditN({ ...editN, universityId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">سراسری (همه دانشگاه‌ها)</option>
                    {universities.map(u => <option key={u.id} value={u.id}>{u.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>ترتیب نمایش</label>
                  <input type="number" className={inputCls} value={editN.sortOrder ?? 0} onChange={e => setEditN({ ...editN, sortOrder: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className={labelCls}>متن</label>
                <textarea className={`${inputCls} min-h-20`} value={editN.body ?? ''} onChange={e => setEditN({ ...editN, body: e.target.value })} placeholder="متن اطلاعیه…" />
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={editN.isActive ?? true} onChange={e => setEditN({ ...editN, isActive: e.target.checked })} />
                فعال و قابل نمایش در صفحه ورود
              </label>
              <div className="flex gap-2">
                <button disabled={busy} className="btn-primary text-xs" onClick={() => run(() => saveNoticeAction(editN as any), 'اطلاعیه ذخیره شد.')}>💾 ذخیره</button>
                <button disabled={busy} className="px-3 py-2 rounded-xl text-xs font-bold text-slate-500 hover:underline" onClick={() => setEditN(null)}>انصراف</button>
              </div>
            </div>
          )}
          {notices.map(n => (
            <div key={n.id} className="card flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-slate-900 flex flex-wrap items-center gap-2">
                  {n.title}
                  <span className={`text-3xs px-2 py-0.5 rounded-full font-black ${KINDS[n.kind]?.cls ?? KINDS.info.cls}`}>{KINDS[n.kind]?.label ?? n.kind}</span>
                  {!n.isActive && <span className="text-3xs px-2 py-0.5 rounded-full font-black bg-slate-200 text-slate-600">غیرفعال</span>}
                </p>
                <p className="text-xs text-slate-500 mt-1 leading-6">{n.body || '—'}</p>
                <p className="text-2xs text-slate-400 mt-1">{uniName(universities, n.universityId)} · ترتیب {n.sortOrder}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button disabled={busy} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold" onClick={() => setEditN({ ...n })}>ویرایش</button>
                <button disabled={busy} className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold" onClick={async () => {
                  if (await askConfirm({ title: 'حذف اطلاعیه', body: 'این اطلاعیه حذف شود؟', confirmText: 'حذف کن', danger: true })) {
                    await run(() => deleteNoticeAction(n.id), 'حذف شد.');
                  }
                }}>حذف</button>
              </div>
            </div>
          ))}
          {!notices.length && <p className="card text-xs text-slate-500">هنوز اطلاعیه‌ای ثبت نشده است.</p>}
        </div>
      )}

      {/* ── اسلایدها ── */}
      {tab === 'slides' && (
        <div className="space-y-3">
          <button disabled={busy} onClick={() => setEditS({ title: '', subtitle: '', imageUrl: '', linkUrl: '', universityId: null, isActive: true, sortOrder: slides.length })} className="btn-primary text-xs">
            ＋ اسلاید جدید
          </button>
          {editS && (
            <div className="card space-y-3 border-indigo-300">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>عنوان</label>
                  <input className={inputCls} value={editS.title ?? ''} onChange={e => setEditS({ ...editS, title: e.target.value })} placeholder="مثلاً: انتخاب واحد ترم بهار" />
                </div>
                <div>
                  <label className={labelCls}>زیرعنوان</label>
                  <input className={inputCls} value={editS.subtitle ?? ''} onChange={e => setEditS({ ...editS, subtitle: e.target.value })} placeholder="توضیح کوتاه…" />
                </div>
                <div>
                  <label className={labelCls}>دانشگاه</label>
                  <select className={inputCls} value={editS.universityId ?? ''} onChange={e => setEditS({ ...editS, universityId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">سراسری (همه دانشگاه‌ها)</option>
                    {universities.map(u => <option key={u.id} value={u.id}>{u.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>ترتیب نمایش</label>
                  <input type="number" className={inputCls} value={editS.sortOrder ?? 0} onChange={e => setEditS({ ...editS, sortOrder: Number(e.target.value) })} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>تصویر (آپلود یا نشانی اینترنتی — خالی = پس‌زمینه گرادیانی)</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input className={`${inputCls} flex-1 min-w-52`} dir="ltr" value={editS.imageUrl ?? ''} onChange={e => setEditS({ ...editS, imageUrl: e.target.value })} placeholder="https://… یا /uploads/…" />
                    <label className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold cursor-pointer">
                      📤 آپلود تصویر
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={busy}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadSlideImage(f, url => setEditS(s => ({ ...(s ?? {}), imageUrl: url }))); e.target.value = ''; }} />
                    </label>
                  </div>
                  {editS.imageUrl ? <img src={editS.imageUrl} alt="" className="mt-2 h-28 w-full object-cover rounded-xl border" /> : null}
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>پیوند کلیک (اختیاری — مثلاً /help?tab=student)</label>
                  <input className={`${inputCls} text-left`} dir="ltr" value={editS.linkUrl ?? ''} onChange={e => setEditS({ ...editS, linkUrl: e.target.value })} placeholder="/help?tab=student" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={editS.isActive ?? true} onChange={e => setEditS({ ...editS, isActive: e.target.checked })} />
                فعال و قابل نمایش در صفحه ورود
              </label>
              <div className="flex gap-2">
                <button disabled={busy} className="btn-primary text-xs" onClick={() => run(() => saveSlideAction(editS as any), 'اسلاید ذخیره شد.')}>💾 ذخیره</button>
                <button disabled={busy} className="px-3 py-2 rounded-xl text-xs font-bold text-slate-500 hover:underline" onClick={() => setEditS(null)}>انصراف</button>
              </div>
            </div>
          )}
          {slides.map(s => (
            <div key={s.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {s.imageUrl
                  ? <img src={s.imageUrl} alt="" className="h-14 w-24 object-cover rounded-lg border shrink-0" />
                  : <div className="h-14 w-24 rounded-lg bg-gradient-to-l from-emerald-700 to-teal-900 flex items-center justify-center text-white text-lg shrink-0">🖼️</div>}
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-slate-900 truncate">{s.title}</p>
                  <p className="text-xs text-slate-500 truncate">{s.subtitle || '—'}</p>
                  <p className="text-2xs text-slate-400 mt-0.5">{uniName(universities, s.universityId)} · ترتیب {s.sortOrder} {!s.isActive && '· غیرفعال'}</p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button disabled={busy} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold" onClick={() => setEditS({ ...s })}>ویرایش</button>
                <button disabled={busy} className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold" onClick={async () => {
                  if (await askConfirm({ title: 'حذف اسلاید', body: 'این اسلاید حذف شود؟', confirmText: 'حذف کن', danger: true })) {
                    await run(() => deleteSlideAction(s.id), 'حذف شد.');
                  }
                }}>حذف</button>
              </div>
            </div>
          ))}
          {!slides.length && <p className="card text-xs text-slate-500">هنوز اسلایدی ثبت نشده است.</p>}
        </div>
      )}

      {/* ── ارم و نام دانشگاه‌ها ── */}
      {tab === 'brands' && (
        <div className="space-y-3">
          <p className="card text-xs leading-6 text-slate-500">
            نام و ارم هر دانشگاه در بالای صفحه ورود نمایش داده می‌شود. ارم را همین‌جا بارگذاری کنید؛
            اگر دانشگاهی ارم اختصاصی نداشته باشد، ارم سراسری تنظیمات (UNIVERSITY_LOGO) نشان داده می‌شود.
            تغییر ساختاری نام/کد از <a href="/admin/universities" className="text-indigo-700 font-bold hover:underline">مدیریت دانشگاه‌ها</a> انجام می‌شود.
          </p>
          {universities.map(u => (
            <div key={u.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {u.logoUrl
                  ? <img src={u.logoUrl} alt="" className="h-12 w-12 object-contain rounded-xl border bg-white p-1" />
                  : <div className="h-12 w-12 rounded-xl bg-emerald-700 text-white flex items-center justify-center font-black text-lg">آ</div>}
                <div>
                  <p className="text-sm font-extrabold text-slate-900">{u.title}</p>
                  <p className="text-2xs text-slate-400 font-mono" dir="ltr">{u.code}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {u.logoUrl && (
                  <button disabled={busy} className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold"
                    onClick={async () => {
                      if (await askConfirm({ title: 'حذف ارم', body: 'ارم این دانشگاه حذف شود؟', confirmText: 'حذف کن', danger: true })) {
                        await run(() => deleteShowcaseLogoAction(u.id), 'ارم حذف شد.');
                      }
                    }}>حذف ارم</button>
                )}
                <form action={async fd => { await run(async () => { await uploadShowcaseLogoAction(fd); }, `ارم ${u.code} ذخیره شد.`); }} className="flex items-center gap-2">
                  <input type="hidden" name="universityId" value={u.id} />
                  <label className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold cursor-pointer">
                    📤 {u.logoUrl ? 'تعویض ارم' : 'آپلود ارم'}
                    <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" className="hidden"
                      onChange={e => (e.target.form as HTMLFormElement | null)?.requestSubmit()} />
                  </label>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

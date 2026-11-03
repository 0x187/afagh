'use client';

import { useRef, useState } from 'react';
import { upsertUniversity, saveSaminConnection, deleteUniversity, uploadUniversityLogoAction, deleteUniversityLogoAction, saveUniversityBrandAction } from './actions';
import { UNI_THEMES, type UniTheme } from '@/lib/university-theme';

type Uni = { id: number; code: string; title: string; kind: string; status: string; saminCode: string | null; province: string | null; dissolvedAt: string | null; isActive: number; logoUrl: string | null; brand: UniTheme };
type Conn = { universityId: number; apiBaseUrl: string; authBaseUrl: string; clientId: string | null; username: string | null; isEnabled: number; lastSyncAt: string | null; hasSecret: boolean };

const BRAND_FIELDS: { key: keyof UniTheme; label: string }[] = [
  { key: 'header', label: 'هدر (header)' },
  { key: 'badge', label: 'نشان (badge)' },
  { key: 'ring', label: 'حاشیه (ring)' },
  { key: 'soft', label: 'نرم (soft)' },
  { key: 'navPanel', label: 'پنل ناوبری (navPanel)' },
  { key: 'navBorder', label: 'مرز ناوبری (navBorder)' },
  { key: 'navHover', label: 'هاور ناوبری (navHover)' },
  { key: 'navActive', label: 'فعال ناوبری (navActive)' },
  { key: 'navMuted', label: 'کمرنگ ناوبری (navMuted)' },
  { key: 'navInput', label: 'ورودی ناوبری (navInput)' },
];

export default function UniversitiesClient({ universities, connections }: { universities: Uni[]; connections: Conn[] }) {
  const [editing, setEditing] = useState<Uni | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [brandOpen, setBrandOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const addCodeRef = useRef<HTMLInputElement>(null);
  const openAdd = () => { setEditing(null); setShowAdd(true); setTimeout(() => addCodeRef.current?.focus(), 0); };

  const connMap = new Map(connections.map(c => [c.universityId, c]));

  return (
    <div className="space-y-4">
      {msg && <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-2 rounded">{msg}</div>}

      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between px-1 py-0.5">
          <span className="text-xs text-slate-500">{universities.length} دانشگاه</span>
          <button onClick={() => { if (editing) setEditing(null); setShowAdd(s => !s); if (!showAdd) setTimeout(() => addCodeRef.current?.focus(), 0); }} className="bg-indigo-700 hover:bg-indigo-800 text-white px-3 py-1.5 rounded shadow text-xs font-bold">
            ➕ {showAdd ? 'بستن فرم افزودن' : 'افزودن دانشگاه جدید'}
          </button>
        </div>
        <table className="w-full text-xs rt">
          <thead>
            <tr className="bg-slate-50 border-b text-slate-600">
              <th className="px-2 py-2 text-right">کد</th>
              <th className="px-2 py-2 text-right">عنوان</th>
              <th className="px-2 py-2 text-right">ارم</th>
              <th className="px-2 py-2 text-right">نوع</th>
              <th className="px-2 py-2 text-right">کد ثمین</th>
              <th className="px-2 py-2 text-right">اتصال ثمین</th>
              <th className="px-2 py-2 text-right">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {universities.map(u => {
              const c = connMap.get(u.id);
              return (
                <tr key={u.id} className="border-b hover:bg-slate-50">
                  <td className="px-2 py-2 font-mono font-bold">{u.code}</td>
                  <td className="px-2 py-2">{u.title}</td>
                  <td className="px-2 py-2"><LogoCell uni={u} onMsg={setMsg} /></td>
                  <td className="px-2 py-2">{u.kind === 'OWN' ? 'خودمان' : 'منحل‌شده'}</td>
                  <td className="px-2 py-2 font-mono text-2xs">{u.saminCode || '—'}</td>
                  <td className="px-2 py-2">
                    {c ? (
                      <span className={c.hasSecret ? 'text-emerald-600' : 'text-amber-600'}>
                        {c.hasSecret ? '✓ متصل' : 'ناقص'}{c.lastSyncAt ? ` · ${new Date(c.lastSyncAt).toLocaleDateString('fa-IR')}` : ''}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 flex gap-1">
                    <button onClick={() => setEditing(u)} className="text-indigo-600 hover:underline">ویرایش</button>
                    <button onClick={() => setBrandOpen(u.id)} className="text-fuchsia-600 hover:underline">برندینگ</button>
                    <ConnButton uni={u} conn={c} onMsg={setMsg} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(showAdd || editing) && (
        <div className="card space-y-3 border-indigo-300">
          <h3 className="font-bold text-sm">{editing ? `ویرایش دانشگاه ${editing.title}` : 'افزودن دانشگاه جدید'}</h3>
          <form action={async (fd) => { try { await upsertUniversity(fd); setEditing(null); setShowAdd(false); setMsg('ذخیره شد'); } catch (e: any) { setMsg(e.message); } }} className="grid grid-cols-2 gap-2 text-xs">
            <input type="hidden" name="id" value={editing?.id || ''} />
            <input ref={addCodeRef} name="code" placeholder="کد (ZARINE)" defaultValue={editing?.code || ''} className="border rounded px-2 py-1.5" required />
            <input name="title" placeholder="عنوان" defaultValue={editing?.title || ''} className="border rounded px-2 py-1.5" required />
            <select name="kind" defaultValue={editing?.kind || 'DISSOLVED'} className="border rounded px-2 py-1.5">
              <option value="OWN">خودمان</option>
              <option value="DISSOLVED">منحل‌شده</option>
              <option value="MERGED">ادغامی</option>
            </select>
            <input name="saminCode" placeholder="کد ثمین sender_university" defaultValue={editing?.saminCode || ''} className="border rounded px-2 py-1.5" />
            <div className="col-span-2 flex gap-2">
              <button type="submit" className="bg-indigo-600 text-white px-4 py-1.5 rounded text-xs">ذخیره</button>
              <button type="button" onClick={() => { setEditing(null); setShowAdd(false); }} className="border px-3 py-1.5 rounded text-xs">انصراف</button>
            </div>
          </form>
        </div>
      )}

      {brandOpen != null && (() => {
        const u = universities.find(x => x.id === brandOpen);
        return u ? <BrandEditor key={u.id} uni={u} onClose={() => setBrandOpen(null)} onMsg={setMsg} /> : null;
      })()}
    </div>
  );
}

function BrandEditor({ uni, onClose, onMsg }: { uni: Uni; onClose: () => void; onMsg: (s: string) => void }) {
  const [draft, setDraft] = useState<UniTheme>(uni.brand);
  return (
    <div className="card space-y-3 border-fuchsia-300">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm">برندینگ {uni.title} ({uni.code})</h3>
        <button onClick={onClose} className="border px-2 py-0.5 rounded text-xs">×</button>
      </div>
      <p className="text-2xs leading-5 text-slate-500">
        تم‌های دانشگاه از پیش‌فرضِ سخت‌کد شروع می‌شوند. برای تغییر، یک تم را انتخاب کنید یا مقادیر کلاس‌های Tailwind را مستقیماً ویرایش کنید.
        مقدار خالی → استفاده از پیش‌فرض.
      </p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(UNI_THEMES).map(([code, th]) => (
          <button key={code} type="button" onClick={() => setDraft(th)} className={`text-2xs px-2 py-1 rounded border ${th.badge}`}>{code}</button>
        ))}
      </div>
      <div className={`rounded-xl p-3 ${draft.header}`}>
        <p className="text-white text-xs">پیش‌نمایش هدر (header)</p>
        <p className={`mt-1 text-2xs ${draft.soft}`}>متن نرم (soft)</p>
      </div>
      <form action={async (fd) => {
        fd.set('universityId', String(uni.id));
        BRAND_FIELDS.forEach(f => fd.set(f.key, draft[f.key]));
        try { await saveUniversityBrandAction(fd); onMsg(`برندینگ ${uni.code} ذخیره شد`); onClose(); }
        catch (e: any) { onMsg(e.message); }
      }} className="grid grid-cols-1 gap-2 text-xs">
        {BRAND_FIELDS.map(f => (
          <label key={f.key} className="flex items-center gap-2">
            <span className="w-44 shrink-0 text-slate-600">{f.label}</span>
            <input value={draft[f.key]} onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))} className="border rounded px-2 py-1 flex-1 font-mono text-2xs" />
          </label>
        ))}
        <div className="flex gap-2">
          <button type="submit" className="bg-fuchsia-600 text-white px-4 py-1.5 rounded text-xs">ذخیره برندینگ</button>
          <button type="button" onClick={onClose} className="border px-3 py-1.5 rounded text-xs">انصراف</button>
        </div>
      </form>
    </div>
  );
}

function LogoCell({ uni, onMsg }: { uni: Uni; onMsg: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <span className="flex items-center gap-1">
        {uni.logoUrl
          ? <img src={uni.logoUrl} alt={`ارم ${uni.code}`} className="max-w-10 max-h-10 object-contain border rounded bg-white" />
          : <span className="text-slate-400">—</span>}
        <button onClick={() => setOpen(true)} className="text-indigo-600 hover:underline">{uni.logoUrl ? 'تعویض' : 'بارگذاری'}</button>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1 items-center">
      <form action={async (fd) => { try { await uploadUniversityLogoAction(fd); onMsg(`ارم ${uni.code} ذخیره شد`); setOpen(false); } catch (e: any) { onMsg(e.message); } }} className="flex gap-1 items-center">
        <input type="hidden" name="universityId" value={uni.id} />
        <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" className="text-2xs max-w-40" required />
        <button type="submit" className="bg-indigo-600 text-white px-2 py-0.5 rounded text-2xs">ذخیره</button>
      </form>
      {uni.logoUrl && (
        <button onClick={async () => { try { await deleteUniversityLogoAction(uni.id); onMsg(`ارم ${uni.code} حذف شد (بازگشت به ارم سراسری)`); } catch (e: any) { onMsg(e.message); } }} className="text-red-600 hover:underline text-2xs">حذف</button>
      )}
      <button type="button" onClick={() => setOpen(false)} className="border px-2 py-0.5 rounded text-2xs">×</button>
    </span>
  );
}

function ConnButton({ uni, conn, onMsg }: { uni: Uni; conn: Conn | undefined; onMsg: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)} className="text-emerald-600 hover:underline">اتصال ثمین</button>;
  return (
    <form action={async (fd) => { try { await saveSaminConnection(fd); onMsg('اتصال ذخیره شد (رمزها رمزنگاری شد)'); setOpen(false); } catch (e: any) { onMsg(e.message); } }} className="flex flex-wrap gap-1 items-center">
      <input type="hidden" name="universityId" value={uni.id} />
      <input name="clientId" placeholder="client_id" defaultValue={conn?.clientId || ''} className="border rounded px-1 py-0.5 w-24" />
      <input name="clientSecret" placeholder="client_secret (خالی=بدون تغییر)" type="password" className="border rounded px-1 py-0.5 w-24" />
      <input name="username" placeholder="username" defaultValue={conn?.username || ''} className="border rounded px-1 py-0.5 w-20" />
      <input name="password" placeholder="password (خالی=بدون تغییر)" type="password" className="border rounded px-1 py-0.5 w-24" />
      <button type="submit" className="bg-emerald-600 text-white px-2 py-0.5 rounded text-2xs">ذخیره</button>
      <button type="button" onClick={() => setOpen(false)} className="border px-2 py-0.5 rounded text-2xs">×</button>
    </form>
  );
}

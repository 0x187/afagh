'use client';

import React, { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createRoleAction,
  deleteRoleAction,
  saveRolePermissionsAction,
  type PermissionsWorkspace,
} from './actions';
import { askConfirm } from '@/lib/ui-feedback';

const faNum = (n: any) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** مجوزی که هرگز نباید از مدیر ارشد گرفته شود (هم‌راستا با گارد سمت سرور) */
const ADMIN_LOCKED_CODE = 'system:manage_roles';

type Draft = Record<number, string[]>;

export default function AdminPermissionsClient({ initial }: { initial: PermissionsWorkspace }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const { roles, permissions, categories } = initial;

  // ── وضعیت پیش‌نویس: تیک‌ها تا زدن «تأیید» فقط اینجا می‌نشینند ──
  const baseline = useMemo<Draft>(() => {
    const m: Draft = {};
    for (const r of roles) m[r.id] = [...r.permissions].sort();
    return m;
  }, [roles]);

  const [draft, setDraft] = useState<Draft>(baseline);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [isCreatingRole, setIsCreatingRole] = useState(false);
  const [newRoleTitle, setNewRoleTitle] = useState('');
  const [newRoleCode, setNewRoleCode] = useState('');

  // هر بار داده از سرور تازه شد (router.refresh)، پیش‌نویس هم هم‌تراز می‌شود
  useEffect(() => setDraft(baseline), [baseline]);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 6000);
  };

  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

  const dirtyRoleIds = useMemo(
    () => roles.filter(r => !same(draft[r.id] ?? [], baseline[r.id] ?? [])).map(r => r.id),
    [roles, draft, baseline],
  );
  const isDirty = dirtyRoleIds.length > 0;

  // هشدار مرورگر هنگام خروج با تغییرِ ذخیره‌نشده
  useEffect(() => {
    if (!isDirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [isDirty]);

  const togglePermission = (roleId: number, code: string, roleCode: string) => {
    if (roleCode === 'ADMIN' && code === ADMIN_LOCKED_CODE) return;
    setDraft(prev => {
      const cur = prev[roleId] ?? [];
      const next = cur.includes(code) ? cur.filter(c => c !== code) : [...cur, code].sort();
      return { ...prev, [roleId]: next };
    });
  };

  /** تیک/برداشتن کل یک ستون (نقش) برای مجوزهای دیدهٔ فعلی */
  const toggleColumn = (roleId: number, roleCode: string, on: boolean) => {
    const codes = filteredPermissions.map(p => p.code);
    setDraft(prev => {
      const cur = new Set(prev[roleId] ?? []);
      for (const c of codes) {
        if (roleCode === 'ADMIN' && c === ADMIN_LOCKED_CODE) continue;
        if (on) cur.add(c);
        else cur.delete(c);
      }
      return { ...prev, [roleId]: [...cur].sort() };
    });
  };

  /** تیک/برداشتن کلِ ماتریس برای یک نقش (مستقل از فیلتر بخش) — همان «همهٔ دسترسی‌ها» */
  const toggleAllMatrix = async (role: { id: number; code: string; title: string }, on: boolean) => {
    const okAll = await askConfirm(
      on
        ? {
            title: 'دادن همهٔ مجوزها',
            body: `همهٔ ${faNum(permissions.length)} مجوز ماتریس به نقش «${role.title}» داده شود؟`,
            confirmText: 'بده',
          }
        : {
            title: 'برداشتن همهٔ مجوزها',
            body: `تمامی مجوزهای نقش «${role.title}» برداشته شود؟ (شامل مجوزهای سیستمی — ممکن است همین صفحه هم برای این نقش غیرفعال شود)`,
            confirmText: 'بردار',
            danger: true,
          },
    );
    if (!okAll) return;
    setDraft(prev => {
      const cur = new Set(prev[role.id] ?? []);
      for (const p of permissions) {
        if (role.code === 'ADMIN' && p.code === ADMIN_LOCKED_CODE) continue;
        if (on) cur.add(p.code);
        else cur.delete(p.code);
      }
      return { ...prev, [role.id]: [...cur].sort() };
    });
  };

  const roleAllOn = (roleId: number) => permissions.every(p => draft[roleId]?.includes(p.code));
  const roleHasAny = (roleId: number) => (draft[roleId] ?? []).length > 0;

  const filteredPermissions = useMemo(
    () => permissions.filter(p => selectedCategory === 'ALL' || p.category === selectedCategory),
    [permissions, selectedCategory],
  );

  // ── undo آخرین ذخیره ──
  // اگر دسترسی اشتباهی داده شد، باید راه برگشتی باشد که *پس از* ذخیره هم کار
  // کند (دکمهٔ «انصراف» فقط پیش‌نویسِ ذخیره‌نشده را دور می‌ریزد). عکسِ وضعیتِ
  // قبل از ذخیره نگه داشته می‌شود و «بازگردانی» همان را دوباره می‌نویسد.
  const [lastSave, setLastSave] = useState<{ roleIds: number[]; prev: Draft } | null>(null);

  // ── تأیید تغییرات: فقط نقش‌های تغییرکرده به سرور می‌روند ──
  const handleSave = () => {
    startTransition(async () => {
      const roleIds = [...dirtyRoleIds];
      // عکسِ «قبل از ذخیره» — مبنای بازگردانی
      const prev: Draft = {};
      for (const id of roleIds) prev[id] = [...(baseline[id] ?? [])];

      const failures: string[] = [];
      for (const roleId of roleIds) {
        const role = roles.find(r => r.id === roleId);
        const res = await saveRolePermissionsAction({ roleId, codes: draft[roleId] ?? [] });
        if (!res.ok) failures.push(`${role?.title ?? roleId}: ${res.error}`);
      }
      if (failures.length) {
        showToast('err', `ذخیرهٔ برخی نقش‌ها ناموفق بود — ${failures.join(' | ')}`);
      } else {
        setLastSave({ roleIds, prev });
        showToast('ok', `تغییر دسترسی ${faNum(roleIds.length)} نقش با موفقیت ثبت و در دفتر ممیزی درج شد.`);
      }
      router.refresh();
    });
  };

  /** بازگردانیِ آخرین ذخیره — همان نقش‌ها با مقادیرِ قبل از ذخیره بازنویسی می‌شوند */
  const handleUndoLastSave = () => {
    if (!lastSave) return;
    const { roleIds, prev } = lastSave;
    startTransition(async () => {
      const failures: string[] = [];
      for (const roleId of roleIds) {
        const role = roles.find(r => r.id === roleId);
        const res = await saveRolePermissionsAction({ roleId, codes: prev[roleId] ?? [] });
        if (!res.ok) failures.push(`${role?.title ?? roleId}: ${res.error}`);
      }
      if (failures.length) {
        showToast('err', `بازگردانی ناقص ماند — ${failures.join(' | ')}`);
        return;
      }
      setLastSave(null);
      showToast('ok', `آخرین ذخیره بازگردانده شد — دسترسی ${faNum(roleIds.length)} نقش به حالت قبل برگشت.`);
      router.refresh();
    });
  };

  const handleDiscard = () => {
    setDraft(baseline);
    showToast('ok', 'تغییرات ذخیره‌نشده لغو شد و ماتریس به آخرین وضعیت ثبت‌شده برگشت.');
  };

  const handleCreateRole = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await createRoleAction({ code: newRoleCode, title: newRoleTitle });
      if (!res.ok) return showToast('err', res.error);
      setNewRoleTitle('');
      setNewRoleCode('');
      setIsCreatingRole(false);
      showToast('ok', `نقش «${res.data.title}» ساخته شد؛ اکنون مجوزهایش را تیک بزنید و «تأیید تغییرات» را بزنید.`);
      router.refresh();
    });
  };

  const handleDeleteRole = async (roleId: number, title: string) => {
    if (!(await askConfirm({ title: 'تأیید عملیات', body: `نقش «${title}» حذف شود؟ این کار برگشت‌پذیر نیست.`, confirmText: 'تأیید', cancelText: 'انصراف', danger: true }))) return;
    startTransition(async () => {
      const res = await deleteRoleAction({ roleId });
      if (!res.ok) return showToast('err', res.error);
      showToast('ok', `نقش «${title}» حذف شد.`);
      router.refresh();
    });
  };

  const totalGrants = useMemo(
    () => Object.values(draft).reduce((s, list) => s + list.length, 0),
    [draft],
  );

  return (
    // pb-28 = جای نوارِ ذخیرهٔ fixed پایین صفحه، تا آخرین ردیف ماتریس زیرش نماند
    <div className="space-y-6 pb-28" dir="rtl">
      {/* Toast */}
      {toast && (
        <div
          className={`p-4 rounded-2xl shadow-xl border font-bold text-sm flex items-center justify-between animate-fadeIn ${
            toast.type === 'ok'
              ? 'bg-emerald-950 text-emerald-100 border-emerald-600'
              : 'bg-rose-950 text-rose-100 border-rose-600'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{toast.type === 'ok' ? '✅' : '⛔'}</span>
            <span>{toast.text}</span>
          </div>
          <button onClick={() => setToast(null)} className="text-white/60 hover:text-white text-xs">
            ✕
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-gradient-to-l from-indigo-950 via-slate-900 to-indigo-900 text-white rounded-3xl p-6 shadow-xl border border-indigo-800/50 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-2xs font-black bg-amber-400 text-slate-950">
              امنیت و کنترل دسترسی (Dynamic RBAC)
            </span>
            <span className="text-xs text-indigo-300">
              {faNum(roles.length)} نقش واقعی · {faNum(permissions.length)} مجوز · {faNum(totalGrants)} تخصیص
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black">
            🛡️ ماتریس پویا و مدیریت سطوح دسترسی کاربران و کارشناسان
          </h1>
          <p className="text-xs text-indigo-200 mt-1">
            داده‌ها از جدول‌های واقعی <span className="font-mono" dir="ltr">roles / permissions / role_permissions</span> خوانده می‌شود؛
            هر تغییر پس از تأیید در زنجیرهٔ ممیزی ثبت می‌گردد.
          </p>
        </div>

        <button
          onClick={() => setIsCreatingRole(!isCreatingRole)}
          className="px-4 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs shadow-lg transition flex items-center gap-1.5"
        >
          <span>+ تعریف نقش سازمانی جدید</span>
        </button>
      </div>

      {/*
        نوار «ذخیره» — همیشه در دسترس (`fixed` پایین صفحه).

        پیش‌تر `sticky top-2 z-20` بود و هدرِ چسبانِ شاخهٔ مدیریت
        (`sticky top-0 z-40` در admin/layout.tsx) رویش می‌افتاد؛ با اسکرول،
        دکمهٔ «تأیید و ذخیره» کامل پنهان می‌شد. `fixed` مستقل از ارتفاع هدر و
        موقعیت اسکرول است، پس دکمه هیچ‌وقت گم نمی‌شود.

        ⚠ هیچ‌چیز خودکار ذخیره نمی‌شود: تیک زدن فقط `draft` محلی را عوض می‌کند
        و تا زدن همین دکمه هیچ نوشتنی در دیتابیس رخ نمی‌دهد. پس از ذخیره هم
        «بازگردانی» (undo) در همین نوار می‌آید تا تخصیص اشتباه برگشت‌پذیر باشد.
      */}
      <div
        className={`fixed bottom-3 left-1/2 z-50 w-[min(1180px,calc(100vw-1.5rem))] -translate-x-1/2 rounded-2xl border-2 px-3 py-2.5 shadow-2xl backdrop-blur flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 transition ${
          isDirty ? 'bg-amber-50/95 border-amber-400' : 'bg-white/95 border-slate-200'
        }`}
      >
        <div className="min-w-0 text-xs font-bold">
          {isDirty ? (
            <>
              <div className="text-amber-900">
                ✏️ {faNum(dirtyRoleIds.length)} نقش تغییر <u>ذخیره‌نشده</u> دارد:{' '}
                <span className="font-black">
                  {dirtyRoleIds.map(id => roles.find(r => r.id === id)?.title).filter(Boolean).join('، ')}
                </span>
              </div>
              <div className="text-2xs font-normal text-amber-800">
                تیک زدن به‌تنهایی ذخیره نمی‌شود — برای ثبت در دیتابیس دکمهٔ «ذخیره» را بزنید.
              </div>
            </>
          ) : lastSave ? (
            <div className="text-slate-600">
              ✅ ذخیره شد. اگر اشتباه بود، «بازگردانی» دسترسی {faNum(lastSave.roleIds.length)} نقش را به حالت قبل برمی‌گرداند.
            </div>
          ) : (
            <span className="text-slate-500">✅ ماتریس با آخرین وضعیت ثبت‌شده در دیتابیس یکسان است.</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {lastSave && (
            <button
              onClick={handleUndoLastSave}
              disabled={pending}
              title="بازگردانی آخرین ذخیره — دسترسی نقش‌های همان ذخیره به حالت قبل برمی‌گردد"
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs shadow disabled:opacity-40"
            >
              ↩️ بازگردانی (Undo)
            </button>
          )}
          <button
            onClick={handleDiscard}
            disabled={!isDirty || pending}
            className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs disabled:opacity-40"
          >
            انصراف از تغییرات
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty || pending}
            className="px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs shadow disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? '⏳ در حال ثبت…' : '✅ ذخیرهٔ تغییر دسترسی‌ها'}
          </button>
        </div>
      </div>

      {/* Segregation of Duties Info Box */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center gap-2 text-indigo-900 font-black">
            <span>🎓</span>
            <span>تفکیک وظایف (Segregation of Duties):</span>
          </div>
          <p className="text-slate-600 leading-5">
            نقش‌های آموزشی و مالی نباید هم‌پوشانی داشته باشند؛ ستون‌های ماتریس را طوری تنظیم کنید که هیچ نقشی هم‌زمان
            «ثبت نمره» و «تسویهٔ مالی» نگیرد.
          </p>
        </div>

        <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center gap-2 text-emerald-900 font-black">
            <span>🧾</span>
            <span>ردپای ممیزی:</span>
          </div>
          <p className="text-slate-600 leading-5">
            هر بار «تأیید تغییر دسترسی» یک رکورد زنجیره‌ای در <span className="font-mono" dir="ltr">audit_logs</span> می‌سازد
            که وضعیت قبل و بعد را نگه می‌دارد.
          </p>
        </div>

        <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center gap-2 text-amber-900 font-black">
            <span>🔒</span>
            <span>گارد قفل‌شدن سامانه:</span>
          </div>
          <p className="text-slate-600 leading-5">
            مجوز «مدیریت نقش و دسترسی» روی نقش مدیر ارشد قفل است تا هیچ‌وقت دسترسی به همین صفحه از دست نرود.
          </p>
        </div>
      </div>

      {/* New Role Drawer */}
      {isCreatingRole && (
        <form
          onSubmit={handleCreateRole}
          className="p-5 bg-white rounded-3xl border-2 border-indigo-500/60 shadow-lg space-y-4 animate-scaleUp"
        >
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="font-black text-slate-900 text-sm">تعریف نقش سازمانی سفارشی جدید (Custom Role)</h3>
            <button type="button" onClick={() => setIsCreatingRole(false)} className="text-slate-400 hover:text-slate-700 text-xs">
              ✕
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-700 font-bold mb-1">عنوان فارسی نقش سازمانی *</label>
              <input
                type="text"
                required
                placeholder="مثال: کارشناس امور فرهنگی و دانشجویی"
                value={newRoleTitle}
                onChange={e => setNewRoleTitle(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-slate-900 focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-bold mb-1">کد سیستمی نقش (لاتین بزرگ) *</label>
              <input
                type="text"
                required
                placeholder="CULTURAL_OFFICER"
                value={newRoleCode}
                onChange={e => setNewRoleCode(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 font-mono text-slate-900 focus:ring-2 focus:ring-indigo-500"
                dir="ltr"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={() => setIsCreatingRole(false)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs">
              انصراف
            </button>
            <button type="submit" disabled={pending} className="px-6 py-2 rounded-xl bg-indigo-900 hover:bg-indigo-950 text-white font-black text-xs shadow-xs disabled:opacity-40">
              + ثبت نقش در دیتابیس
            </button>
          </div>
        </form>
      )}

      {/* Permission Matrix */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 space-y-4">
        {/* Category Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-100">
          <span className="text-xs font-bold text-slate-500 shrink-0">فیلتر بخش‌ها:</span>
          {['ALL', ...categories].map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                selectedCategory === cat ? 'bg-indigo-900 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat === 'ALL' ? 'همه بخش‌ها' : cat}
            </button>
          ))}
        </div>

        {/*
          اسکرول داخل خودِ پنل (نه صفحه) + هدر و ستون اولِ چسبان.
          چرا: ماتریس ۱۱ نقش × ده‌ها مجوز است؛ با اسکرول، سرصفحهٔ نقش‌ها از دید
          خارج می‌شد و کاربر نمی‌دانست ستونِ تیک‌خورده مربوط به کدام نقش/کاربر
          است. برای چسبیدنِ `th` باید جدول یک اسکرول‌کانتینر با ارتفاع محدود
          داشته باشد؛ `overflow-x-auto` تنها این کار را نمی‌کند چون بدون
          max-height ارتفاع می‌گیرد و اسکرول عمودی به صفحه منتقل می‌شود.
          نکتهٔ RTL: ستون اول در لبهٔ **راست** است ⇒ `right-0` (نه left-0).
          نکتهٔ `border-collapse`: مرزِ سلول‌های sticky در حالت collapse
          ناپدید می‌شود، پس جداکننده با box-shadow ساخته شده است.
        */}
        <div className="max-h-[72vh] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-right text-xs border-collapse rt">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="sticky top-0 right-0 z-40 w-64 min-w-64 max-w-64 bg-slate-900 p-3 shadow-[-2px_0_0_0_#334155]">عنوان مجوز و شرح دسترسی</th>
                <th className="sticky top-0 z-30 bg-slate-900 p-3">دسته‌بندی</th>
                {roles.map(r => {
                  const list = draft[r.id] ?? [];
                  const changed = dirtyRoleIds.includes(r.id);
                  const allOn = filteredPermissions.length > 0 && filteredPermissions.every(p => list.includes(p.code));
                  return (
                    <th key={r.id} className={`sticky top-0 z-30 p-3 text-center min-w-[120px] ${changed ? 'bg-amber-700' : 'bg-slate-900'}`}>
                      <div className="font-black">{r.title}</div>
                      <div className="text-3xs text-indigo-300 font-mono" dir="ltr">
                        {r.code}
                      </div>
                      <div className="text-3xs text-indigo-200 mt-0.5">
                        👤 {faNum(r.userCount)} کاربر
                        {r.isSystem ? <span className="ms-1 text-amber-300">· سیستمی</span> : null}
                      </div>
                      {/*
                        ⚠ این دو دکمه شبیه هم‌اند ولی یکی نیستند — و وقتی
                        فیلتر بخش‌ها روی «همه بخش‌ها» است، دقیقاً یک کار
                        می‌کنند. برای همین:
                          • دکمهٔ «این بخش» فقط وقتی فیلتر فعال است نشان داده
                            می‌شود (وگرنه تکرارِ محض است)،
                          • هر دو شمارشِ خودشان را روی دکمه دارند تا تفاوت
                            بدون ابهام باشد.
                      */}
                      {selectedCategory !== 'ALL' && (
                        <button
                          onClick={() => toggleColumn(r.id, r.code, !allOn)}
                          title={`فقط مجوزهای فیلترِ «${selectedCategory}» — نه کل ماتریس`}
                          className="mt-1 block w-full text-3xs underline text-indigo-200 hover:text-white"
                        >
                          {allOn ? 'برداشتن' : 'انتخاب'} {faNum(filteredPermissions.length)} مجوزِ «{selectedCategory}»
                        </button>
                      )}
                      <button
                        onClick={() => toggleAllMatrix(r, !roleAllOn(r.id))}
                        title={`همهٔ ${faNum(permissions.length)} مجوزِ کل ماتریس، مستقل از فیلتر بخش‌ها`}
                        className={`mt-1 block w-full border rounded px-1 text-3xs font-bold ${roleAllOn(r.id) ? 'bg-amber-400 text-slate-950 hover:bg-amber-300' : 'bg-transparent text-amber-300 border-amber-400/60 hover:bg-amber-400/20'}`}
                      >
                        {roleAllOn(r.id) ? `✔ همهٔ ${faNum(permissions.length)} مجوز (گرفتن!)` : `☑ همهٔ ${faNum(permissions.length)} مجوز`}
                      </button>
                      {!r.isSystem && r.userCount === 0 && (
                        <button
                          onClick={() => handleDeleteRole(r.id, r.title)}
                          className="block w-full mt-1 text-3xs text-rose-300 hover:text-rose-100"
                        >
                          حذف نقش
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredPermissions.map((perm, idx) => (
                <tr
                  key={perm.id}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
                >
                  {/* `bg-inherit` تا ستونِ چسبان با رنگ همان سطر (و رنگ hover) بیاید */}
                  <td className="sticky right-0 z-20 bg-inherit p-3 shadow-[-2px_0_0_0_#e2e8f0]">
                    <div className="font-black text-slate-900">{perm.title}</div>
                    <div className="text-slate-500 leading-4">{perm.description}</div>
                    <div className="font-mono text-3xs text-slate-400" dir="ltr">
                      {perm.code}
                    </div>
                  </td>

                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded text-3xs font-bold bg-slate-100 text-slate-700">{perm.category}</span>
                  </td>

                  {roles.map(role => {
                    const list = draft[role.id] ?? [];
                    const isAllowed = list.includes(perm.code);
                    const wasAllowed = (baseline[role.id] ?? []).includes(perm.code);
                    const changed = isAllowed !== wasAllowed;
                    const locked = role.code === 'ADMIN' && perm.code === ADMIN_LOCKED_CODE;

                    return (
                      <td key={role.id} className={`p-3 text-center ${changed ? 'bg-amber-100' : ''}`}>
                        <label className="inline-flex items-center justify-center cursor-pointer" title={locked ? 'این مجوز روی مدیر ارشد قفل است' : ''}>
                          <input
                            type="checkbox"
                            checked={isAllowed}
                            disabled={locked || pending}
                            onChange={() => togglePermission(role.id, perm.code, role.code)}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-70"
                          />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {filteredPermissions.length === 0 && (
                <tr>
                  <td colSpan={2 + roles.length} className="p-8 text-center text-slate-500 font-bold">
                    برای این دسته مجوزی تعریف نشده است.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-2xs text-slate-500 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <span>
            خانه‌های زردرنگ = تغییر ذخیره‌نشده. تیک زدن <b>خودکار ذخیره نمی‌شود</b>؛ تا زدن دکمهٔ «ذخیره»
            (نوار پایین صفحه) هیچ چیزی در دیتابیس نوشته نمی‌شود. پس از ذخیره، دکمهٔ «بازگردانی» برای
            برگشتِ تخصیصِ اشتباه در همان نوار هست.
          </span>
          <span className="font-bold text-indigo-900">
            نمایش {faNum(filteredPermissions.length)} از {faNum(permissions.length)} مجوز
          </span>
        </div>
      </div>
    </div>
  );
}

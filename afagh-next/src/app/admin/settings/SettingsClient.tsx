'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { resetSettingAction, saveSettingsAction, uploadLogoAction } from '@/lib/settings-actions';
import { backupDatabaseAction, listMinioObjectsAction, downloadMinioObjectAction, restoreDatabaseAction, restoreMinioObjectAction, getBackupStatsAction, startDatabaseBackupAction, startMinioBackupAction } from './backup-actions';
import { SECRET_MASK, type SettingView } from '@/lib/settings-shared';
import { askConfirm } from '@/lib/ui-feedback';

interface Props {
  settings: SettingView[];
  groups: string[];
  /**
   * پنل «داده‌های پایه» (مدیریت کلاس‌ها و…) به‌صورت گرهٔ آماده از سرور.
   *
   * ⚠ پیش‌تر این پنل در `page.tsx` زیرِ کل صفحه با `<details open>` رندر
   * می‌شد؛ نتیجه اینکه با کلیک روی **هر** تبِ پیکربندی، فرم مدیریت کلاس‌ها هم
   * انتهای صفحه باز بود و کاربر فکر می‌کرد دکمه‌ها درست کار نمی‌کنند. حالا
   * تبِ مستقل خودش را دارد و فقط با انتخاب همان دکمه دیده می‌شود.
   */
  baseData?: React.ReactNode;
}

function BackupRestorePanel({ flash }: { flash: (ok: boolean, text: string) => void }) {
  const [busy, startTransition] = useTransition();
  const [stats, setStats] = useState<{ tables: number; totalRows: number; dbSize: string; minioObjects: number; minioSize: string } | null>(null);
  const [minioList, setMinioList] = useState<{ key: string; size: number }[] | null>(null);

  const loadStats = () => {
    startTransition(async () => {
      const r = await getBackupStatsAction();
      if (r.ok && r.stats) setStats(r.stats);
      else flash(false, r.error || 'خطا');
    });
  };

  const handleBackupDb = () => {
    startTransition(async () => {
      const r = await startDatabaseBackupAction();
      if (!r.ok) return flash(false, r.error || 'خطا');
      // دانلود از مسیر جریانی (با کلید) — بار/حجم بزرگ از پاسخ سروراکشن خارج شد.
      window.location.href = `/api/admin/backup/download?key=${encodeURIComponent(r.key!)}`;
      flash(true, `پشتیبان دیتابیس آماده شد (${r.tables} جدول) — دانلود آغاز می‌شود.`);
    });
  };

  const handleBackupMinio = () => {
    startTransition(async () => {
      const r = await startMinioBackupAction();
      if (!r.ok) return flash(false, r.error || 'خطا');
      window.location.href = `/api/admin/backup/download?key=${encodeURIComponent(r.key!)}`;
      flash(true, `بکاپ فایل‌ها آماده شد (${r.objects} فایل) — دانلود آغاز می‌شود.`);
    });
  };

  const handleListMinio = () => {
    startTransition(async () => {
      const r = await listMinioObjectsAction();
      if (r.ok) setMinioList(r.objects || []);
      else flash(false, r.error || 'خطا');
    });
  };

  const handleDownloadMinioFile = (key: string) => {
    startTransition(async () => {
      const r = await downloadMinioObjectAction(key);
      if (!r.ok) return flash(false, r.error || 'خطا');
      const binary = atob(r.data || '');
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.name || key.split('/').pop() || 'file';
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const handleRestoreDb = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sql,.txt';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const ok = await askConfirm({ title: 'بازیابی دیتابیس', body: 'آیا از بازیابی دیتابیس مطمئنید؟ تمام داده‌های فعلی جایگزین می‌شوند.', confirmText: 'بازیابی کن', danger: true });
      if (!ok) return;
      startTransition(async () => {
        const r = await restoreDatabaseAction(text);
        if (r.ok) flash(true, `بازیابی انجام شد (${r.statements} دستور اجرا شد)`);
        else flash(false, r.error || 'خطای بازیابی');
      });
    };
    input.click();
  };

  return (
    <div className="space-y-5">
      {/* آمار */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-black text-slate-800">آمار سیستم</h3>
          <button onClick={loadStats} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50">
            {busy ? 'در حال بارگذاری…' : 'بروزرسانی آمار'}
          </button>
        </div>
        {stats ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
            {[
              { label: 'جداول', value: stats.tables },
              { label: 'کل ردیف‌ها', value: stats.totalRows.toLocaleString('fa-IR') },
              { label: 'حجم دیتابیس', value: stats.dbSize },
              { label: 'فایل‌های آرشیو', value: stats.minioObjects },
              { label: 'حجم آرشیو', value: stats.minioSize },
            ].map(s => (
              <div key={s.label} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                <div className="text-lg font-black text-indigo-700">{s.value}</div>
                <div className="text-2xs text-slate-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">برای مشاهده آمار، «بروزرسانی آمار» را بزنید.</p>
        )}
      </div>

      {/* پشتیبان‌گیری دیتابیس */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-black text-slate-800 mb-3">پشتیبان‌گیری دیتابیس</h3>
        <p className="text-sm text-slate-600 mb-4">
          یک فایل SQL حاوی تمام جداول و داده‌ها دانلود می‌شود. برای بازیابی:
          <code className="mx-1 text-xs bg-slate-100 px-1 rounded">psql -U afagh -d afagh_db -f backup.sql</code>
        </p>
        <button onClick={handleBackupDb} disabled={busy} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'در حال پشتیبان‌گیری…' : 'دانلود پشتیبان دیتابیس (SQL)'}
        </button>
      </div>

      {/* پشتیبان‌گیری فایل‌های آرشیو (MinIO) */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-black text-slate-800 mb-3">پشتیبان‌گیری فایل‌ها (آرشیو)</h3>
        <p className="text-sm text-slate-600 mb-4">
          تمام فایل‌های آپلودی (عکس، اسناد، PDF) در یک فایل ZIP بسته‌بندی و دانلود می‌شود.
        </p>
        <button onClick={handleBackupMinio} disabled={busy} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'در حال بسته‌بندی…' : 'دانلود بکاپ فایل‌ها (ZIP)'}
        </button>
      </div>

      {/* بازیابی دیتابیس */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-black text-slate-800 mb-3">بازیابی دیتابیس</h3>
        <p className="text-sm text-rose-600 mb-4">
          ⚠️ بازیابی تمام داده‌های فعلی را جایگزین می‌کند. ابتدا پشتیبان بگیرید.
        </p>
        <button onClick={handleRestoreDb} disabled={busy} className="px-5 py-2.5 rounded-xl bg-rose-600 text-white font-bold text-sm hover:bg-rose-700 disabled:opacity-50">
          انتخاب فایل SQL و بازیابی
        </button>
      </div>

      {/* فایل‌های آرشیو */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-black text-slate-800">فایل‌های آرشیو (MinIO)</h3>
          <button onClick={handleListMinio} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50">
            {busy ? 'در حال بارگذاری…' : 'نمایش فایل‌ها'}
          </button>
        </div>
        {minioList && (
          <div className="max-h-64 overflow-y-auto">
            {minioList.length === 0 ? (
              <p className="text-sm text-slate-400">فایلی وجود ندارد.</p>
            ) : (
              <table className="w-full text-xs rt">
                <thead><tr className="border-b border-slate-200">
                  <th className="text-right py-2 px-2 font-bold">کلید</th>
                  <th className="text-left py-2 px-2 font-bold">حجم</th>
                  <th className="py-2 px-2"></th>
                </tr></thead>
                <tbody>
                  {minioList.map(o => (
                    <tr key={o.key} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-1.5 px-2 font-mono text-slate-700 truncate max-w-[300px]" title={o.key}>{o.key}</td>
                      <td className="py-1.5 px-2 text-left text-slate-500">{o.size < 1024 ? o.size + ' B' : o.size < 1048576 ? (o.size / 1024).toFixed(1) + ' KB' : (o.size / 1048576).toFixed(1) + ' MB'}</td>
                      <td className="py-1.5 px-2">
                        <button onClick={() => handleDownloadMinioFile(o.key)} className="text-indigo-600 hover:underline">دانلود</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const SOURCE_BADGE: Record<string, { text: string; cls: string }> = {
  db: { text: 'تنظیم‌شده در پنل', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  env: { text: 'از ENV', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
  default: { text: 'پیش‌فرض', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
};

/** بارگذار ارم دانشگاه با پیش‌نمایش */
function LogoUploader({ current, pending, flash }: { current: string; pending: boolean; flash: (ok: boolean, text: string) => void }) {
  const [busy, start] = useTransition();
  return (
    <div className="flex items-center gap-3 w-full">
      <div className="w-16 h-16 shrink-0 rounded-lg border border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden">
        {current ? <img src={current} alt="ارم فعلی" className="max-w-full max-h-full object-contain" /> : <span className="text-3xs text-slate-400">بدون ارم</span>}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          if (!fd.get('logo') || (fd.get('logo') as File).size === 0) return flash(false, 'فایلی انتخاب نشده است.');
          start(async () => {
            const res = await uploadLogoAction(fd);
            flash(res.ok, res.message);
            if (res.ok) window.location.reload();
          });
        }}
      >
        <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" disabled={pending || busy} className="text-xs" />
        <button disabled={pending || busy} className="shrink-0 text-xs px-3 py-2 rounded-lg bg-indigo-700 text-white font-bold disabled:opacity-50">
          {busy ? 'در حال بارگذاری…' : 'بارگذاری ارم'}
        </button>
      </form>
    </div>
  );
}

export default function SettingsClient({ settings, groups, baseData }: Props) {
  const [activeGroup, setActiveGroup] = useState<string>(groups[0]);
  /**
   * تب فعال — سه حالت:
   *   • 'settings' → تنظیمات گروه انتخاب‌شده (`activeGroup`)
   *   • 'base'     → داده‌های پایه (مدیریت کلاس‌ها)
   *   • 'backup'   → پشتیبان‌گیری و بازیابی
   * پیش‌تر دو بولی جدا (`showBackup`) و یک `<details open>` بیرون از این
   * کامپوننت بود؛ نتیجه اینکه داده‌های پایه همیشه انتهای صفحه باز می‌ماند و
   * تفکیک تب‌ها به‌هم می‌ریخت.
   */
  const [tab, setTab] = useState<'settings' | 'base' | 'backup'>('settings');
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(settings.map(s => [s.key, s.value])),
  );
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const byGroup = useMemo(
    () => settings.filter(s => s.group === activeGroup),
    [settings, activeGroup],
  );
  const dirtyCount = Object.values(dirty).filter(Boolean).length;

  const setValue = (key: string, v: string) => {
    setValues(prev => ({ ...prev, [key]: v }));
    setDirty(prev => ({ ...prev, [key]: true }));
  };

  const flash = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 5000);
  };

  const handleSaveGroup = () => {
    const payload: Record<string, string> = {};
    for (const s of byGroup) {
      if (s.envOnly) continue;
      if (!dirty[s.key]) continue;
      payload[s.key] = values[s.key] ?? '';
    }
    if (!Object.keys(payload).length) return flash(false, 'تغییری برای ذخیره وجود ندارد.');
    startTransition(async () => {
      const res = await saveSettingsAction(payload);
      flash(res.ok, res.message);
      if (res.ok) setDirty(prev => {
        const next = { ...prev };
        for (const k of Object.keys(payload)) next[k] = false;
        return next;
      });
    });
  };

  const handleReset = (key: string) => {
    startTransition(async () => {
      const res = await resetSettingAction(key);
      flash(res.ok, res.message);
    });
  };

  return (
    <div className="space-y-5" dir="rtl">
      <header className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h1 className="text-xl font-black text-slate-800">پیکربندی سامانه</h1>
        <p className="text-sm text-slate-600 mt-2 leading-7">
          هیچ نشانی، کلید یا توکنی در کد سامانه ثابت نیست. هر مقدار ابتدا از این پنل خوانده می‌شود؛
          اگر اینجا تنظیم نشده باشد از <b>متغیر محیطی (ENV)</b> و در نهایت از مقدار پیش‌فرض استفاده می‌شود.
          مقادیر محرمانه هرگز به مرورگر ارسال نمی‌شوند و به شکل <span className="font-mono">{SECRET_MASK}</span> نمایش داده می‌شوند.
        </p>
      </header>

      {toast && (
        <div
          className={`rounded-xl px-4 py-3 text-sm font-bold border ${
            toast.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-rose-50 text-rose-800 border-rose-300'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {groups.map(g => {
          const count = settings.filter(s => s.group === g).length;
          return (
            <button
              key={g}
              onClick={() => { setActiveGroup(g); setTab('settings'); }}
              className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
                activeGroup === g && tab === 'settings'
                  ? 'bg-indigo-700 text-white border-indigo-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {g} <span className="opacity-70">({count})</span>
            </button>
          );
        })}
        {baseData && (
          <button
            onClick={() => setTab('base')}
            className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
              tab === 'base'
                ? 'bg-sky-700 text-white border-sky-700'
                : 'bg-white text-sky-700 border-sky-200 hover:bg-sky-50'
            }`}
          >
            🏫 داده‌های پایه (کلاس‌ها)
          </button>
        )}
        <button
          onClick={() => setTab('backup')}
          className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
            tab === 'backup'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
          }`}
        >
          پشتیبان‌گیری و بازیابی
        </button>
      </div>

      {tab === 'backup' ? (
        <BackupRestorePanel flash={flash} />
      ) : tab === 'base' ? (
        baseData
      ) : (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="divide-y divide-slate-100">
          {byGroup.map(s => {
            const badge = SOURCE_BADGE[s.source];
            return (
              <div key={s.key} className="p-4 md:flex md:items-start md:gap-6">
                <div className="md:w-1/3 mb-2 md:mb-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-800">{s.label}</span>
                    <span className={`text-2xs px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.text}</span>
                    {s.envOnly && (
                      <span className="text-2xs px-2 py-0.5 rounded-full border bg-amber-100 text-amber-800 border-amber-300">
                        فقط ENV
                      </span>
                    )}
                  </div>
                  <div className="text-2xs text-slate-500 font-mono mt-1 ltr:text-left" dir="ltr">
                    {s.key} · ENV: {s.env}
                  </div>
                  {s.help && <p className="text-xs text-slate-500 mt-1 leading-6">{s.help}</p>}
                </div>

                <div className="md:flex-1 flex items-center gap-2">
                  {s.type === 'image' ? (
                    <LogoUploader current={values[s.key] ?? ''} pending={pending} flash={flash} />
                  ) : s.type === 'boolean' ? (
                    <select
                      disabled={s.envOnly || pending}
                      value={values[s.key] ?? 'false'}
                      onChange={e => setValue(s.key, e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-100"
                    >
                      <option value="true">فعال</option>
                      <option value="false">غیرفعال</option>
                    </select>
                  ) : s.type === 'select' ? (
                    <select
                      dir="rtl"
                      disabled={s.envOnly || pending}
                      value={values[s.key] ?? s.default}
                      onChange={e => setValue(s.key, e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-100 font-bold"
                    >
                      {(s.options ?? []).map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : s.type === 'textarea' ? (
                    <textarea
                      dir="rtl"
                      disabled={s.envOnly || pending}
                      value={values[s.key] ?? ''}
                      placeholder={s.envOnly ? 'در فایل .env تنظیم می‌شود' : 'خالی = استفاده از ENV/پیش‌فرض'}
                      onChange={e => setValue(s.key, e.target.value)}
                      rows={3}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-100 leading-7"
                    />
                  ) : (
                    <input
                      dir="ltr"
                      type={s.type === 'secret' ? 'password' : s.type === 'number' ? 'number' : 'text'}
                      disabled={s.envOnly || pending}
                      value={values[s.key] ?? ''}
                      placeholder={s.envOnly ? 'در فایل .env تنظیم می‌شود' : 'خالی = استفاده از ENV/پیش‌فرض'}
                      onChange={e => setValue(s.key, e.target.value)}
                      onFocus={e => {
                        if (s.type === 'secret' && e.target.value === SECRET_MASK) setValue(s.key, '');
                      }}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono disabled:bg-slate-100"
                    />
                  )}

                  {!s.envOnly && s.source === 'db' && (
                    <button
                      onClick={() => handleReset(s.key)}
                      disabled={pending}
                      title="حذف مقدار پنل و بازگشت به ENV/پیش‌فرض"
                      className="shrink-0 text-xs px-3 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
                    >
                      بازنشانی
                    </button>
                  )}
                  {dirty[s.key] && <span className="shrink-0 text-amber-600 text-lg leading-none" title="ذخیره نشده">●</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-slate-50 border-t border-slate-200 p-4 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {dirtyCount > 0 ? `${dirtyCount} تغییر ذخیره‌نشده` : 'همهٔ تغییرات ذخیره شده‌اند'}
          </span>
          <button
            onClick={handleSaveGroup}
            disabled={pending || !byGroup.some(s => dirty[s.key])}
            className="px-6 py-2.5 rounded-xl bg-indigo-700 text-white font-bold text-sm hover:bg-indigo-800 disabled:opacity-40"
          >
            {pending ? 'در حال ذخیره…' : 'ذخیرهٔ این بخش'}
          </button>
        </div>
      </div>
      )}

      <p className="text-xs text-slate-500 leading-6">
        نکته: مقادیر گروه «زیرساخت» پیش از اتصال به دیتابیس لازم‌اند، بنابراین فقط از طریق فایل
        <span className="font-mono mx-1">.env</span> یا متغیرهای محیطی داکر قابل تغییرند.
      </p>
    </div>
  );
}

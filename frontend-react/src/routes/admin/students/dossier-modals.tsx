// ═══ Modals of the students dossier manager ═══
//
// Port of the modal blocks of StudentsManagerClient.tsx + a promise-based
// confirm dialog (replacement for window.confirm — danger styling + focus).
// Split into this module so the page file stays navigable.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { GRADE_STATUS_CODES } from './grade-status-codes';
import { gradeStatusFa } from '@/lib/student-labels';
import type { GradeAuditRow, StaffItem, RoleRow, StudentItem, TranscriptRow, BulkScope } from '@/lib/students-dossier-api';
import { Button } from '@/components/ui/button';

// ── Promise-based confirm (port of ui/Confirm) ──

type ConfirmOptions = {
  title: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type PendingConfirm = { opts: ConfirmOptions; resolve: (v: boolean) => void };

const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ opts, resolve })),
    [],
  );
  const answer = useCallback((v: boolean) => {
    setPending((p) => {
      p?.resolve(v);
      return null;
    });
  }, []);
  const value = useMemo(() => confirm, [confirm]);
  return (
    <ConfirmCtx.Provider value={value}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full border border-slate-300 overflow-hidden">
            <div className={`px-5 py-3.5 text-white font-extrabold text-sm ${pending.opts.danger ? 'bg-rose-700' : 'bg-slate-800'}`}>
              {pending.opts.title}
            </div>
            <div className="p-5 space-y-4 text-xs">
              {pending.opts.body && <p className="text-slate-700 leading-relaxed">{pending.opts.body}</p>}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <Button type="button" variant="outline" size="sm" onClick={() => answer(false)} autoFocus>
                  {pending.opts.cancelText ?? 'انصراف'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className={pending.opts.danger ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-emerald-700 hover:bg-emerald-600 text-white'}
                  onClick={() => answer(true)}
                >
                  {pending.opts.confirmText ?? 'تأیید'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmCtx);
}

// ── shared modal chrome ──

function ModalChrome({
  title,
  accent,
  onClose,
  maxW,
  children,
}: {
  title: string;
  accent: string;
  onClose: () => void;
  maxW: string;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
      <div className={`bg-white rounded-xl shadow-2xl ${maxW} w-full border border-slate-300 overflow-hidden max-h-[90vh] flex flex-col`}>
        <div className={`${accent} text-white px-5 py-3.5 flex items-center justify-between`}>
          <h3 className="font-extrabold text-sm">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-200 hover:text-white text-lg leading-none">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Grade edit modal (admin / graduate affairs) ──

export type GradeEditState = {
  open: boolean;
  target: TranscriptRow | null;
  student: StudentItem | null;
  transcript: TranscriptRow[];
  valueInput: string;
  reasonInput: string;
  samaCode: string;
  autoSama: { code: string | null; title: string };
  needsStepUp: boolean;
  stepUpPw: string;
  saving: boolean;
  stepUpBusy: boolean;
};

export function GradeEditModal({
  st,
  onClose,
  onField,
  onSubmit,
  onStepUpConfirm,
}: {
  st: GradeEditState;
  onClose: () => void;
  onField: (patch: Partial<GradeEditState>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onStepUpConfirm: () => void;
}) {
  const { target, student } = st;
  if (!st.open || !student) return null;
  return (
    <ModalChrome title="✏️ ثبت و اصلاح نمره (آموزش / فارغ‌التحصیلان)" accent="bg-amber-700" onClose={onClose} maxW="max-w-lg">
      <form onSubmit={onSubmit} className="p-5 space-y-4 text-xs overflow-y-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1 text-slate-800">
          <p><b>دانشجو:</b> {student.firstName} {student.lastName} ({student.studentCode})</p>
          <p><b>رشته:</b> {student.majorName} — <b>مقطع:</b> {student.degreeLevel}</p>
          {target?.courseTitle ? (
            <p><b>درس:</b> {target.courseTitle} (<span className="font-mono">{target.courseCode}</span>) — <b>ترم:</b> <span className="font-mono">{target.termCode}</span></p>
          ) : st.transcript.length > 0 ? (
            <div>
              <label className="block font-bold text-slate-700 mb-1">انتخاب درس از کارنامه:</label>
              <select
                className="w-full bg-white border border-slate-300 rounded p-1.5 text-xs font-mono"
                value={target?.courseCode ? `${target.termCode}|${target.courseCode}` : ''}
                onChange={(e) => {
                  const [tCode, cCode] = e.target.value.split('|');
                  const found = st.transcript.find((r) => r.termCode === tCode && r.courseCode === cCode);
                  if (found) onField({ target: found, valueInput: found.gradeValue ?? '' });
                }}
              >
                {st.transcript.map((r, i) => (
                  <option key={i} value={`${r.termCode}|${r.courseCode}`}>
                    {r.termCode} — {r.courseCode} ({r.courseTitle}) — نمره: {r.gradeValue ?? '—'}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <p><b>نمره فعلی:</b> <span className="font-mono font-bold text-indigo-700">{target?.gradeValue ?? 'ثبت نشده'}</span> ({target?.gradeStatusTitle || (target?.gradeStatus ? gradeStatusFa(target.gradeStatus) : '—')})</p>
        </div>

        <div>
          <label className="block font-bold text-slate-700 mb-1">نمره جدید (۰ تا ۲۰):</label>
          <input
            type="number"
            step="0.01"
            min={0}
            max={20}
            required
            placeholder="مثال: ۱۶.۵۰"
            value={st.valueInput}
            onChange={(e) => onField({ valueInput: e.target.value })}
            className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none"
          />
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="block font-bold text-slate-700 text-xs">کد وضعیت نمره سما:</label>
            <span className="text-2xs text-slate-500 font-mono">
              کد فعلی: {target?.gradeStatusCode || '—'} {target?.gradeStatusTitle ? `(${target.gradeStatusTitle})` : ''}
            </span>
          </div>
          <select
            value={st.samaCode}
            onChange={(e) => onField({ samaCode: e.target.value })}
            className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
          >
            <option value="AUTO">
              {`⚡ خودکار طبق تعریف درس و آیین‌نامه: [کد ${st.autoSama.code || '—'}] ${st.autoSama.title}`}
            </option>
            <optgroup label="انتخاب دستی کد وضعیت سما">
              {GRADE_STATUS_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  [{c.code}] {c.title} {!c.affectsGpa ? '(بدون احتساب در معدل)' : ''}
                </option>
              ))}
            </optgroup>
          </select>
          <p className="text-3xs text-slate-500">
            {st.samaCode === 'AUTO'
              ? '💡 کد به‌صورت هوشمند ابتدا از جدول دروس (courses) و سپس طبق آیین‌نامهٔ آموزشی دانشجو حل می‌شود.'
              : '⚠️ شما به‌صورت دستی کد وضعیت این نمره را تعیین کرده‌اید.'}
          </p>
        </div>

        <div>
          <label className="block font-bold text-slate-700 mb-1">دلیل تغییر و مستند قانونی (الزامی):</label>
          <textarea
            required
            rows={3}
            placeholder="مثال: حکم کمیسیون موارد خاص به شماره ۱۲۳۴ یا اصلاح نمره طبق صورتجلسه شورای آموزشی"
            value={st.reasonInput}
            onChange={(e) => onField({ reasonInput: e.target.value })}
            className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
          />
        </div>

        {st.needsStepUp && (
          <div className="bg-indigo-50 border-2 border-indigo-400 rounded-lg p-3 space-y-2">
            <p className="font-bold text-indigo-900">🔐 تأیید دومرحله‌ای: رمز عبور خود را وارد کنید (۱۰ دقیقه معتبر می‌ماند).</p>
            <div className="flex gap-2">
              <input
                type="password"
                value={st.stepUpPw}
                onChange={(e) => onField({ stepUpPw: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onStepUpConfirm(); } }}
                placeholder="رمز عبور شما"
                className="flex-1 bg-white border border-indigo-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                dir="ltr"
              />
              <button
                type="button"
                disabled={st.stepUpBusy}
                onClick={onStepUpConfirm}
                className="px-4 py-2 bg-indigo-700 hover:bg-indigo-800 disabled:bg-indigo-400 text-white font-bold rounded-lg"
              >
                {st.stepUpBusy ? '…' : 'تأیید و ثبت'}
              </button>
            </div>
          </div>
        )}

        <div className="bg-slate-50 border border-slate-200 rounded p-2.5 text-2xs text-slate-600 space-y-1">
          <p>🔒 <b>قوانین ممیزی:</b></p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>این عملیات مستقیماً در لاگ ممیزی نمرات (<span className="font-mono">grade_change_log</span>) با نام کاربری، نقش و زمان دقیق ثبت می‌شود.</li>
            <li>کد وضعیت سما (<span className="font-mono">samaGradeStatusCode</span>) متناسب با حدنصاب قبولی رشته به‌طور خودکار محاسبه و درج می‌گردد.</li>
            <li>نمره به‌صورت قطعی (<span className="font-mono">FINALIZED</span>) منظور می‌شود.</li>
          </ul>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            انصراف
          </button>
          <button
            type="submit"
            disabled={st.saving}
            className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-bold rounded-lg transition-colors flex items-center gap-1.5"
          >
            {st.saving ? 'در حال ثبت…' : '💾 ثبت نمره و لاگ ممیزی'}
          </button>
        </div>
      </form>
    </ModalChrome>
  );
}

// ── Grade audit log modal ──

export function AuditLogModal({
  open,
  student,
  logs,
  loading,
  onClose,
}: {
  open: boolean;
  student: StudentItem | null;
  logs: GradeAuditRow[];
  loading: boolean;
  onClose: () => void;
}) {
  if (!open || !student) return null;
  return (
    <ModalChrome title="📜 تاریخچه و لاگ ممیزی نمرات (Audit Trail)" accent="bg-slate-800" onClose={onClose} maxW="max-w-5xl">
      <div className="p-4 border-b border-slate-200 bg-slate-50 text-xs flex flex-wrap items-center justify-between gap-2">
        <p><b>دانشجو:</b> {student.firstName} {student.lastName} — <b>شماره دانشجویی:</b> <span className="font-mono">{student.studentCode}</span></p>
        <span className="text-2xs text-slate-500 font-mono">{logs.length.toLocaleString('fa-IR')} رکورد ثبت‌شده</span>
      </div>
      <div className="p-4 overflow-y-auto flex-1 text-xs">
        {loading ? (
          <p className="text-center text-slate-500 py-8">در حال بارگذاری سوابق ممیزی…</p>
        ) : logs.length === 0 ? (
          <p className="text-center text-slate-500 py-8 bg-slate-50 rounded-lg border border-slate-200">هیچ لاگ تغییری برای نمرات این دانشجو در سامانه ثبت نشده است.</p>
        ) : (
          <div className="border border-slate-300 rounded-lg overflow-x-auto">
            <table className="w-full text-right text-2xs">
              <thead className="bg-slate-100 border-b border-slate-300 font-bold">
                <tr>
                  <th className="p-2">#</th>
                  <th className="p-2">تاریخ و زمان</th>
                  <th className="p-2">اقدام‌کننده</th>
                  <th className="p-2">عملیات</th>
                  <th className="p-2">درس</th>
                  <th className="p-2 text-center">نمره قبلی ← جدید</th>
                  <th className="p-2 text-center">کد وضعیت سما</th>
                  <th className="p-2">دلیل ثبت‌شده</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, idx) => (
                  <tr key={log.id || idx} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="p-2 font-mono text-slate-500">{(idx + 1).toLocaleString('fa-IR')}</td>
                    <td className="p-2 font-mono text-slate-700" dir="ltr">
                      {log.createdAt ? new Date(log.createdAt).toLocaleString('fa-IR') : '—'}
                    </td>
                    <td className="p-2">
                      <span className="font-bold">{log.actorName || `کاربر #${log.actorUserId ?? 'سیستم'}`}</span>
                      <span className="block text-3xs text-slate-500 font-mono">[{log.actorRole || 'SYSTEM'}]</span>
                    </td>
                    <td className="p-2">
                      <span className="px-2 py-0.5 rounded font-mono text-3xs font-bold bg-slate-200 text-slate-800">
                        {log.action}
                      </span>
                    </td>
                    <td className="p-2">
                      <span className="font-mono font-bold">{log.courseCode ?? '—'}</span>
                      <span className="block text-3xs text-slate-600 truncate max-w-[160px]" title={log.courseTitle ?? undefined}>{log.courseTitle ?? (log.termCode ? `ترم ${log.termCode}` : '—')}</span>
                      {log.termCode && <span className="block text-3xs text-slate-400 font-mono">{log.termCode}{log.termTitle ? ` — ${log.termTitle}` : ''}</span>}
                    </td>
                    <td className="p-2 text-center font-mono font-bold">
                      <span className="text-slate-500">{log.oldGradeValue ?? '—'}</span>
                      <span className="mx-1 text-slate-400">←</span>
                      <span className="text-indigo-700">{log.newGradeValue ?? '—'}</span>
                    </td>
                    <td className="p-2 text-center font-mono">
                      <span className="text-slate-500">{log.oldSamaStatusCode ?? '—'}</span>
                      <span className="mx-1 text-slate-400">←</span>
                      <span className="text-emerald-700 font-bold">{log.newSamaStatusCode ?? '—'}</span>
                    </td>
                    <td className="p-2 text-slate-700 max-w-xs truncate" title={log.reason ?? undefined}>
                      {log.reason ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
        <span className="text-2xs text-slate-400">لاگ سراسری نمرات در مسیر اختصاصی خود ارائه می‌شود.</span>
        <button type="button" onClick={onClose} className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition-colors">
          بستن
        </button>
      </div>
    </ModalChrome>
  );
}

// ── Bulk password reset modal ──

export type BulkModalState = {
  open: boolean;
  scope: BulkScope;
  pass: string;
  saving: boolean;
  backfill: boolean;
  mode: 'password' | 'national_code' | 'force_change';
};

export function BulkResetModal({
  st,
  onClose,
  onField,
  onSubmit,
}: {
  st: BulkModalState;
  onClose: () => void;
  onField: (patch: Partial<BulkModalState>) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!st.open) return null;
  return (
    <ModalChrome title="🔑 بازنشانی گروهی رمز" accent="bg-slate-800" onClose={onClose} maxW="max-w-md">
      <form onSubmit={onSubmit} className="p-5 space-y-3 text-xs overflow-y-auto">
        <div className="flex items-center gap-3">
          <label className="text-slate-600 font-bold">گروه:</label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="bulkScope" checked={st.scope === 'student'} onChange={() => onField({ scope: 'student' })} className="accent-slate-800" />
            دانشجویان (فعال وب)
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="bulkScope" checked={st.scope === 'professor'} onChange={() => onField({ scope: 'professor' })} className="accent-slate-800" />
            اساتید (فعال وب)
          </label>
        </div>
        <div className="space-y-1.5">
          <label className="text-slate-600 font-bold block mb-1">نوع بازنشانی:</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="bulkMode" checked={st.mode === 'national_code'} onChange={() => onField({ mode: 'national_code' })} className="accent-red-600" />
              <span className="font-bold text-red-700">🔄 بازنشانی یک‌بارمصرف تصادفی</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="bulkMode" checked={st.mode === 'password'} onChange={() => onField({ mode: 'password' })} className="accent-slate-800" />
              <span>رمز دلخواه</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="bulkMode" checked={st.mode === 'force_change'} onChange={() => onField({ mode: 'force_change' })} className="accent-indigo-600" />
              <span className="font-bold text-indigo-700">🔐 فقط اجبار به تغییر رمز (بدون تغییر رمز فعلی)</span>
            </label>
          </div>
        </div>
        {st.mode === 'force_change' ? (
          <div className="rounded-lg bg-indigo-50 border border-indigo-300 p-3 text-indigo-800 leading-relaxed">
            <b>🔐 اجبار به تغییر رمز</b>
            <p className="text-3xs mt-1">رمز هیچ حسابی عوض نمی‌شود؛ همهٔ حساب‌های فعال این گروه در ورود بعدی ملزم به تعیین رمز جدید خواهند بود.</p>
          </div>
        ) : st.mode === 'password' ? (
          <div>
            <label className="text-slate-600 font-bold block mb-1">رمز جدید (۱۰ تا ۱۲۸ کاراکتر):</label>
            <input
              type="text"
              required
              minLength={10}
              maxLength={128}
              dir="ltr"
              placeholder="رمز جدید همهٔ این گروه"
              value={st.pass}
              onChange={(e) => onField({ pass: e.target.value })}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-slate-500 focus:outline-none"
            />
          </div>
        ) : (
          <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-amber-800 leading-relaxed">
            <b>⚠ بازنشانی یک‌بارمصرف</b>
            <p className="text-3xs mt-1">رمز تصادفیِ یک‌بارمصرف برای هر حساب ساخته می‌شود (هرگز از کد ملی مشتق نمی‌شود). در اولین ورود ملزم به تغییر رمز خواهند بود.</p>
          </div>
        )}
        <label className="flex items-center gap-1.5 cursor-pointer pt-1">
          <input type="checkbox" checked={st.backfill} onChange={(e) => onField({ backfill: e.target.checked })} className="w-4 h-4 accent-slate-800 rounded" />
          <span>همچنین نقش‌های جاافتادهٔ همهٔ حساب‌ها را بساز (ترمیم norole)</span>
        </label>
        <p className="text-3xs text-slate-500">این عملیات بی‌بازگشت است؛ رمز جاری همهٔ حساب‌های این گروه باطل می‌شود.</p>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg">انصراف</button>
          <button type="submit" disabled={st.saving} className="px-5 py-2 bg-red-700 hover:bg-red-800 disabled:bg-slate-400 text-white font-bold rounded-lg">
            {st.saving ? 'در حال اجرا…' : '⚠ اعمال به همه'}
          </button>
        </div>
      </form>
    </ModalChrome>
  );
}

// ── Roles modal ──

export function RolesModal({
  target,
  rolesAll,
  selected,
  saving,
  msg,
  onClose,
  onToggle,
  onSubmit,
}: {
  target: { userId: number; name: string } | null;
  rolesAll: RoleRow[];
  selected: Set<number>;
  saving: boolean;
  msg: string;
  onClose: () => void;
  onToggle: (id: number, checked: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!target) return null;
  const roleTitle = (r: { id: number; code: string; title: string }) => (r.title && r.title.trim()) || r.code;
  return (
    <ModalChrome title={`⚙ نقش‌های «${target.name}»`} accent="bg-slate-800" onClose={onClose} maxW="max-w-md">
      <form onSubmit={onSubmit} className="p-5 space-y-3 text-xs overflow-y-auto">
        <p className="text-[10.5px] text-slate-500 leading-relaxed">
          نقش‌های تعریف‌شده را تیک بزنید/بردارید (کارشناس مالی، کارشناس آموزش، مدیر گروه، …). برای تعریف نقش جدید به صفحهٔ{' '}
          <a href="/admin/permissions" className="font-bold text-indigo-700 underline">مدیریت سطوح دسترسی و نقش‌ها</a> بروید.
        </p>
        {rolesAll.length > 0 ? (
          <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {rolesAll.map((r) => (
              <label key={r.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={(e) => onToggle(r.id, e.target.checked)}
                  className="accent-indigo-600"
                />
                <span className="font-bold flex-1">{roleTitle(r)}</span>
                <span className="font-mono text-3xs text-slate-400" dir="ltr">{r.code}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-amber-800 leading-relaxed">
            هنوز نقشی تعریف نشده است. ابتدا در{' '}
            <a href="/admin/permissions" className="font-bold underline">مدیریت سطوح دسترسی و نقش‌ها</a> نقش‌های موردنیاز مثل «کارشناس مالی» و «کارشناس آموزش» را بسازید، بعد همین‌جا تخصیص دهید.
          </div>
        )}
        {msg && <p className="text-xs font-bold break-words">{msg}</p>}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg">انصراف</button>
          <button type="submit" disabled={saving} className="px-5 py-2 bg-indigo-700 hover:bg-indigo-800 disabled:bg-slate-400 text-white font-bold rounded-lg">
            {saving ? 'در حال ثبت…' : '💾 ثبت نقش‌ها'}
          </button>
        </div>
      </form>
    </ModalChrome>
  );
}

// ── Create staff modal ──

export type CreateStaffFields = {
  nc: string; fn: string; ln: string; father: string; bcn: string;
  gender: string; mobile: string; email: string; code: string; type: string;
};

export function CreateStaffModal({
  open,
  fields,
  busy,
  msg,
  onClose,
  onField,
  onSubmit,
}: {
  open: boolean;
  fields: CreateStaffFields;
  busy: boolean;
  msg: string;
  onClose: () => void;
  onField: (patch: Partial<CreateStaffFields>) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!open) return null;
  return (
    <ModalChrome title="＋ ثبت استاد / کارمند جدید" accent="bg-slate-800" onClose={onClose} maxW="max-w-md">
      <form onSubmit={onSubmit} className="p-5 space-y-3 text-xs overflow-y-auto">
        <p className="text-[10.5px] text-slate-500 leading-relaxed">
          حساب کاربری ساخته می‌شود (ورود اولیه با <b>کد ملی</b> + تغییر اجباری رمز). پس از ثبت، از <b>ستون «نقش‌ها»</b> در همین صفحه یا صفحهٔ استاد و کارکنان، تخصص هر کارشناس را تعیین کنید.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-red-700 font-bold">* کد ملی</span>
            <input dir="ltr" value={fields.nc} onChange={(e) => onField({ nc: e.target.value })} required className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono focus:ring-2 focus:ring-slate-500 focus:outline-none" placeholder="۱۰ رقم" />
          </label>
          <label className="block">
            <span className="text-indigo-900 font-bold">* نام</span>
            <input value={fields.fn} onChange={(e) => onField({ fn: e.target.value })} required className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-500 focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-indigo-900 font-bold">* نام خانوادگی</span>
            <input value={fields.ln} onChange={(e) => onField({ ln: e.target.value })} required className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-500 focus:outline-none" />
          </label>
          <label className="block">
            <span>نام پدر</span>
            <input value={fields.father} onChange={(e) => onField({ father: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-500 focus:outline-none" />
          </label>
          <label className="block">
            <span>شماره شناسنامه</span>
            <input value={fields.bcn} onChange={(e) => onField({ bcn: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-500 focus:outline-none" />
          </label>
          <label className="block">
            <span>جنسیت</span>
            <select value={fields.gender} onChange={(e) => onField({ gender: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-500 focus:outline-none">
              <option value="">—</option>
              <option>مرد</option>
              <option>زن</option>
            </select>
          </label>
          <label className="block">
            <span>موبایل</span>
            <input dir="ltr" value={fields.mobile} onChange={(e) => onField({ mobile: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono focus:ring-2 focus:ring-slate-500 focus:outline-none" />
          </label>
          <label className="block">
            <span>ایمیل</span>
            <input dir="ltr" value={fields.email} onChange={(e) => onField({ email: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono focus:ring-2 focus:ring-slate-500 focus:outline-none" />
          </label>
          <label className="block">
            <span>کد پرسنلی</span>
            <input dir="ltr" value={fields.code} onChange={(e) => onField({ code: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono focus:ring-2 focus:ring-slate-500 focus:outline-none" placeholder="پیش‌فرض: کد ملی" />
          </label>
          <label className="block">
            <span>نوع سمت</span>
            <select value={fields.type} onChange={(e) => onField({ type: e.target.value })} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-500 focus:outline-none">
              <option value="اداری">اداری / کارشناس</option>
              <option value="هیئت علمی">استاد / هیئت علمی</option>
              <option value="هیئت علمی-اداری">استاد و کارمند اداری (هیئت علمی + اداری)</option>
              <option value="مربی">مربی</option>
            </select>
          </label>
        </div>
        {msg && <p className="text-xs font-bold leading-relaxed break-words">{msg}</p>}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg">انصراف</button>
          <button type="submit" disabled={busy} className="px-5 py-2 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-lg">
            {busy ? 'در حال ثبت…' : '＋ ثبت حساب جدید'}
          </button>
        </div>
      </form>
    </ModalChrome>
  );
}

// ── Password change modal (single user) ──

export function PasswordModal({
  target,
  input,
  saving,
  onClose,
  onInput,
  onSubmit,
}: {
  target: { userId: number; name: string } | null;
  input: string;
  saving: boolean;
  onClose: () => void;
  onInput: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!target) return null;
  return (
    <ModalChrome title={`🔑 تغییر رمز «${target.name}»`} accent="bg-slate-800" onClose={onClose} maxW="max-w-md">
      <form onSubmit={onSubmit} className="p-5 space-y-3 text-xs">
        <p className="text-slate-600">رمز جدید را وارد کنید (۱۰ تا ۱۲۸ کاراکتر). کاربر در اولین ورود ملزم به تغییر رمز می‌شود.</p>
        <input
          type="text"
          required
          minLength={10}
          maxLength={128}
          dir="ltr"
          placeholder="رمز جدید"
          value={input}
          onChange={(e) => onInput(e.target.value)}
          className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-slate-500 focus:outline-none"
        />
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg">انصراف</button>
          <button type="submit" disabled={saving} className="px-5 py-2 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-lg">
            {saving ? 'در حال ثبت…' : '💾 ثبت رمز جدید'}
          </button>
        </div>
      </form>
    </ModalChrome>
  );
}

/** Empty staff record check used by the page when opening the roles modal. */
export function staffHasUserId(st: StaffItem | null): boolean {
  return !!st?.userId;
}

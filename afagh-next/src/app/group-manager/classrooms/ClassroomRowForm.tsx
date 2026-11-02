'use client';

import { useEffect, useRef, useState, useActionState } from 'react';
import { saveClassroomAction, type SaveClassroomResult } from './actions';

interface FacultyOption {
  id: number;
  name: string;
}

interface Props {
  /** برای حالت ویرایش مقدار دارد؛ برای افزودن حذف شود */
  id?: number;
  name?: string;
  code?: string | null;
  cap?: number;
  roomType?: string | null;
  isExamHall?: number;
  examCapacity?: number | null;
  facultyId?: number | null;
  floor?: string | null;
  rows?: number | null;
  cols?: number | null;
  isActive?: number;
  faculties: FacultyOption[];
  /** چیدمان فشرده (سطر جدول) یا فرم بالای صفحه */
  variant?: 'row' | 'new';
}

const INITIAL: SaveClassroomResult = { ok: false };

/**
 * فرمِ یکپارچهٔ افزودن/ویرایش کلاس — با useActionState تا پس از ذخیره صفحه
 * نویگیت نشود و اسکرولِ کاربر (مخصوصاً برای کلاس‌های پایینِ لیست) حفظ گردد.
 */
export default function ClassroomRowForm(props: Props) {
  const { id, name, code, cap, roomType, isExamHall = 0, examCapacity, facultyId, floor, rows, cols, isActive = 1, faculties, variant = 'row' } = props;
  const [state, action, pending] = useActionState(saveClassroomAction, INITIAL);

  // پس از ذخیرهٔ موفق، کلید فرم را می‌زنیم تا با مقادیرِ تازهِٔ (پس از revalidate)
  // ری‌ماونت شود — در غیر این صورت React ۱۹ فرم را به‌صورتِ پیش‌فرض ریست می‌کرد
  // و مقدارِ قدیمی نمایش داده می‌شد.
  const lastStateRef = useRef<SaveClassroomResult | null>(null);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    if (state !== lastStateRef.current && state.ok) {
      lastStateRef.current = state;
      setResetKey(k => k + 1);
    }
  }, [state]);

  const wrapCls = variant === 'new'
    ? 'flex flex-wrap items-end gap-2 text-xs'
    : 'flex flex-wrap items-center gap-2';

  return (
    <form key={resetKey} action={action} className={wrapCls}>
      {id != null && <input type="hidden" name="id" value={id} />}
      <label className="text-slate-500">نام<input name="name" required defaultValue={name ?? ''} className="input mt-1 !py-1 !px-2 w-32" /></label>
      <label className="text-slate-500">کد<input name="code" defaultValue={code ?? ''} className="input mt-1 !py-1 !px-2 w-24" dir="ltr" placeholder="اختیاری" /></label>
      <label className="text-slate-500">ظرفیت<input name="cap" type="number" min={1} required defaultValue={cap ?? ''} className="input mt-1 !py-1 !px-2 w-16" dir="ltr" /></label>
      {variant === 'new' ? (
        <label className="text-slate-500">نوع
          <select name="roomType" className="input mt-1 !py-1 !px-2">
            <option value="">—</option><option>کلاس درس</option><option>آزمایشگاه</option><option>سالن</option><option>ورزشی</option>
          </select>
        </label>
      ) : (
        <input name="roomType" defaultValue={roomType ?? ''} className="input mt-1 !py-1 !px-2 w-24" />
      )}
      <label className="text-slate-500">دانشکده
        <select name="facultyId" defaultValue={String(facultyId ?? '')} className="input mt-1 !py-1 !px-2 w-40">
          <option value="">— بدون دانشکده —</option>
          {faculties.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      {variant === 'new' ? (
        <>
          <label className="text-slate-500">طبقه<input name="floor" defaultValue={floor ?? ''} className="input mt-1 !py-1 !px-2 w-14" dir="ltr" placeholder="مثلاً ۲" /></label>
          <label className="text-slate-500">ردیف‌ها (نیمکت)<input name="rows" type="number" defaultValue={rows ?? ''} className="input mt-1 !py-1 !px-2 w-14" dir="ltr" /></label>
          <label className="text-slate-500">ستون‌ها<input name="cols" type="number" defaultValue={cols ?? ''} className="input mt-1 !py-1 !px-2 w-14" dir="ltr" /></label>
          <label className="flex items-center gap-1 text-slate-500"><input type="checkbox" name="isActive" value="1" defaultChecked={isActive === 1} className="w-4 h-4" /> فعال (قابل برنامه‌ریزی)</label>
        </>
      ) : (
        <>
          <input name="floor" defaultValue={floor ?? ''} className="input mt-1 !py-1 !px-2 w-14" dir="ltr" />
          <input name="rows" type="number" defaultValue={rows ?? ''} className="input mt-1 !py-1 !px-2 w-14" dir="ltr" />
          <input name="cols" type="number" defaultValue={cols ?? ''} className="input mt-1 !py-1 !px-2 w-14" dir="ltr" />
          <select name="isActive" defaultValue={String(isActive)} className="input mt-1 !py-1 !px-2 w-20">
            <option value="1">فعال</option>
            <option value="0">غیرفعال</option>
          </select>
        </>
      )}
      <label className="flex items-center gap-1 text-slate-500">
        <input type="checkbox" name="isExamHall" value="1" defaultChecked={isExamHall === 1} className="w-4 h-4" />
        قابل استفاده به عنوان سالن امتحان
      </label>
      <label className="text-slate-500">
        ظرفیت امتحان
        <input name="examCapacity" type="number" min={1} defaultValue={examCapacity ?? ''} className="input mt-1 !py-1 !px-2 w-20" dir="ltr" />
      </label>
      <button className={variant === 'new' ? 'btn-primary !py-1 !px-3' : 'btn-ghost !py-1 !px-2'} disabled={pending}>
        {pending ? 'در حال ذخیره…' : variant === 'new' ? 'افزودن کلاس' : 'ذخیره'}
      </button>
      {state.err && <span className="text-[11px] font-bold text-rose-600">{state.err}</span>}
      {state.msg && <span className="text-[11px] font-bold text-emerald-700">{state.msg}</span>}
    </form>
  );
}

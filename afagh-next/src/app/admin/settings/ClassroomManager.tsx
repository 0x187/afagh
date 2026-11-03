'use client';

import { useEffect, useMemo, useRef, useState, useActionState, type ReactNode } from 'react';
import { adminSaveClassroomAction, adminBulkClassroomAction, type SaveClassroomResult } from './actions';

interface FacultyOption {
  id: number;
  name: string;
}

/** گزینهٔ «گروه مسئول» — برای سالن‌هایی که مالِ یک گروه مشخص‌اند (مثل باشگاه‌ها). */
interface DeptOption {
  id: number;
  name: string;
  code: string | null;
}

interface RoomData {
  id: number;
  name: string;
  code: string | null;
  capacity: number;
  roomType: string | null;
  facultyId: number | null;
  departmentId: number | null;
  floor: string | null;
  rowsCount: number | null;
  colsCount: number | null;
  isActive: number | null;
  isExamHall: number | null;
  examCapacity: number | null;
}

/** برچسب گروه: «نام (کد)» و اگر کد نبود فقط «نام» — شناسهٔ ردیف جای کد نمی‌نشیند. */
const deptLabel = (d: DeptOption) => (d.code ? `${d.name} (${d.code})` : d.name);

const ROOM_TYPES = ['کلاس درس', 'آزمایشگاه', 'سالن', 'ورزشی', 'کارگاه', 'اداری'];

const INITIAL: SaveClassroomResult = { ok: false };

/**
 * قالبِ ستون‌ها — یک منبعِ واحد برای سرسطر و ردیف‌ها.
 *
 * چرا ثابتِ مشترک؟ قبلاً سرسطر ۷ عنوان داشت ولی هر ردیف یک `<td colSpan={7}>`
 * با فرمِ flex-wrap بود؛ یعنی عنوان‌ها هیچ‌وقت روی کادرها نمی‌افتادند و معلوم
 * نبود هر کادر مال کدام عنوان است. حالا سرسطر و هر ردیف همان template را
 * می‌گیرند، پس ستون‌ها دقیقاً زیر هم می‌نشینند.
 *
 * ترتیب RTL: اولین فرزند = راست‌ترین ستون ⇒ ستون تیک، بعد «کد» به‌عنوان اولین ستونِ داده.
 */
const COLS =
  'grid-cols-2 sm:grid-cols-3 ' +
  // ۱۳ ستون = تعداد واقعیِ خانه‌های RowForm. اگر خانه‌ای اضافه/حذف شد،
  // این الگو و HEADERS باید هم‌زمان به‌روز شوند، وگرنه ردیف می‌شکند و
  // ستون «عملیات» به سطر دوم می‌افتد (باگ سالن امتحان).
  'md:grid-cols-[2rem_4.5rem_minmax(7rem,1.2fr)_4.5rem_6.5rem_minmax(6.5rem,1fr)_minmax(7rem,1fr)_3.25rem_5.75rem_5.5rem_4.5rem_5rem_5.75rem]';

const INP =
  'w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[13px] text-slate-800 ' +
  'outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

/** یک خانه: برچسب فقط در موبایل بالای کادر دیده می‌شود (سرسطر در موبایل مخفی است). */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-0.5 block text-[10px] font-bold text-slate-400 md:hidden">{label}</span>
      {children}
    </div>
  );
}

/** کلیدهای مرتب‌سازی — همان ستون‌هایی که سرسطرِ کلیک‌پذیر دارند. */
type SortKey = 'code' | 'name' | 'capacity' | 'roomType' | 'faculty' | 'floor' | 'seats' | 'status' | 'examHall';

const HEADERS: Array<{ label: string; hint: string; key: SortKey | null }> = [
  { label: '✓', hint: 'انتخاب ردیف برای عملیات گروهی', key: null },
  { label: 'کد', hint: 'کد کلاس در سما (LT4.Code) — همان کدی که برنامهٔ هفتگی و سالن امتحان با آن کار می‌کند', key: 'code' },
  { label: 'نام کلاس', hint: 'نامی که در انتخاب‌گر کلاس و برنامهٔ هفتگی دیده می‌شود', key: 'name' },
  { label: 'ظرفیت', hint: 'ظرفیت اسمی اتاق (نفر)', key: 'capacity' },
  { label: 'نوع', hint: 'کلاس درس / آزمایشگاه / سالن / ورزشی / کارگاه', key: 'roomType' },
  { label: 'دانشکده', hint: 'دانشکدهٔ مالکِ اتاق — در سوییچ دانشگاه هم‌تراز می‌ماند', key: 'faculty' },
  { label: 'گروه مسئول', hint: 'اگر اتاق مالِ یک گروه مشخص است (مثل باشگاه‌ها که مال «گروه مشترک تربیت بدنی» هستند) همین‌جا انتخابش کن. تخصیص خودکار سهمیه، هر دو شیفت را مستقیم به همین گروه می‌دهد و در توزیع ظرفیت‌محور دانشکده شرکت نمی‌کند. خالی = مثل قبل', key: null },
  { label: 'طبقه', hint: 'شمارهٔ طبقه', key: 'floor' },
  { label: 'نیمکت (ردیف × ستون)', hint: 'چیدمان نیمکت‌ها برای نقشهٔ حضور و غیاب — ابتدا تعداد ردیف، بعد تعداد ستون', key: 'seats' },
  { label: 'وضعیت', hint: 'کلاس غیرفعال در انتخاب‌گر سردر کلاس نمایش داده نمی‌شود', key: 'status' },
  { label: 'سالن امتحان', hint: 'اگر «بله» باشد، این کلاس در سهمیه‌بندی و برنامه‌ریزی آزمون‌ها به‌عنوان حوزهٔ امتحان هم قابل استفاده است', key: 'examHall' },
  { label: 'ظرفیت امتحان', hint: 'ظرفیت مخصوص آزمون — اگر خالی بماند از ظرفیت عادی کلاس استفاده می‌شود (مثلاً نیمکت‌ها برداشته می‌شوند)', key: null },
  { label: 'عملیات', hint: 'ذخیره یا حذف همین ردیف', key: null },
];

/** رقم‌های فارسی/عربی → لاتین، تا جستجوی «۲۰۷» و «207» یکی باشد. */
function normalizeDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** فرم افزودن کلاس جدید — «کد» اولین فیلد است تا با ستون اول جدول هم‌نام باشد. */
function AddForm({ faculties, departments }: { faculties: FacultyOption[]; departments: DeptOption[] }) {
  const [state, action, pending] = useActionState(adminSaveClassroomAction, INITIAL);
  const LBL = 'flex min-w-0 flex-col gap-1 text-[11px] font-bold text-slate-500';
  return (
    <form
      action={action}
      className="grid grid-cols-2 items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-4 lg:grid-cols-5"
    >
      <label className={LBL}>کد کلاس
        <input name="code" className={`${INP} text-center font-mono`} dir="ltr" placeholder="مثلاً 201" />
      </label>
      <label className={`${LBL} col-span-2 sm:col-span-1`}>نام
        <input name="name" required className={INP} placeholder="مثلاً کلاس ۳۰۵" />
      </label>
      <label className={LBL}>ظرفیت
        <input name="cap" type="number" min={1} required className={INP} dir="ltr" placeholder="۴۰" />
      </label>
      <label className={LBL}>نوع
        <select name="roomType" className={INP}>
          <option value="">—</option>
          {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label className={`${LBL} col-span-2`}>دانشکده
        <select name="facultyId" className={INP}>
          <option value="">— بدون دانشکده —</option>
          {faculties.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <label className={`${LBL} col-span-2`}>گروه مسئول (اختیاری)
        <select name="departmentId" className={INP}>
          <option value="">— کل دانشکده —</option>
          {departments.map(d => <option key={d.id} value={d.id}>{deptLabel(d)}</option>)}
        </select>
      </label>
      <label className={LBL}>طبقه
        <input name="floor" className={INP} dir="ltr" placeholder="۲" />
      </label>
      <label className={LBL}>ردیف
        <input name="rows" type="number" min={0} className={INP} dir="ltr" placeholder="۵" />
      </label>
      <label className={LBL}>ستون
        <input name="cols" type="number" min={0} className={INP} dir="ltr" placeholder="۸" />
      </label>
      <label className="flex items-center gap-1.5 pb-2 text-xs font-bold text-slate-600">
        <input type="checkbox" name="isActive" value="1" defaultChecked className="h-4 w-4" /> فعال
      </label>
      <label className="flex items-center gap-1.5 pb-2 text-xs font-bold text-slate-600">
        <input type="checkbox" name="isExamHall" value="1" className="h-4 w-4" /> قابل استفاده به عنوان سالن امتحان
      </label>
      <label className={LBL}>ظرفیت امتحان
        <input name="examCapacity" type="number" min={1} className={INP} dir="ltr" placeholder="—" />
      </label>
      <button className="rounded-xl bg-indigo-700 px-5 py-2 text-sm font-black text-white disabled:opacity-60" disabled={pending}>
        {pending ? 'در حال افزودن…' : 'افزودن کلاس'}
      </button>
      {state.err && <p className="col-span-full text-[11px] font-bold text-rose-600">⛔ {state.err}</p>}
      {state.msg && <p className="col-span-full text-[11px] font-bold text-emerald-700">✓ {state.msg}</p>}
    </form>
  );
}

/** یک ردیف کامل = یک فرم؛ حذف هم با `intent=delete` از همین فرم می‌رود. */
function RowForm({
  room, faculties, departments, selected, onToggle,
}: {
  room: RoomData;
  faculties: FacultyOption[];
  departments: DeptOption[];
  selected: boolean;
  onToggle: (id: number, next: boolean) => void;
}) {
  const [state, action, pending] = useActionState(adminSaveClassroomAction, INITIAL);
  const [confirmDel, setConfirmDel] = useState(false);

  // پس از ذخیرهٔ موفق، فرم را ری‌مانت می‌کنیم تا مقادیرِ تازه (پس از revalidate)
  // جای مقدار قدیمی را بگیرند؛ وگرنه React فرم را ریست می‌کرد و مقدار قبلی می‌ماند.
  const lastStateRef = useRef<SaveClassroomResult | null>(null);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    if (state !== lastStateRef.current && state.ok) {
      lastStateRef.current = state;
      setResetKey(k => k + 1);
      setConfirmDel(false);
    }
  }, [state]);

  const isActive = room.isActive ?? 1;
  const noCode = !room.code;

  return (
    <form
      key={resetKey}
      action={action}
      className={`grid ${COLS} items-start gap-2 rounded-xl border bg-white p-2.5 md:items-center md:gap-1.5 md:rounded-none md:border-0 md:border-t md:p-1.5 ${
        selected
          ? 'border-indigo-300 ring-1 ring-indigo-200 md:border-indigo-200 md:bg-indigo-50/50'
          : 'border-slate-200 md:border-slate-100'
      }`}
    >
      <input type="hidden" name="id" value={room.id} />

      {/* تیکِ انتخاب — بدون `name` است تا همراهِ فرمِ ردیف ارسال نشود. */}
      <Cell label="انتخاب">
        <input
          type="checkbox"
          checked={selected}
          onChange={e => onToggle(room.id, e.target.checked)}
          aria-label={`انتخاب کلاس ${room.name}`}
          className="h-4 w-4 cursor-pointer accent-indigo-600"
        />
      </Cell>

      <Cell label="کد">
        <input
          name="code"
          defaultValue={room.code ?? ''}
          placeholder="بدون کد"
          title={noCode ? 'این اتاق در سما کد ندارد' : `کد سما: ${room.code}`}
          dir="ltr"
          className={`${INP} text-center font-mono ${noCode ? 'border-amber-300 bg-amber-50 placeholder:text-[10px] placeholder:font-sans placeholder:text-amber-600' : ''}`}
        />
      </Cell>

      <Cell label="نام کلاس">
        <input name="name" defaultValue={room.name} className={`${INP} font-bold`} />
      </Cell>

      <Cell label="ظرفیت">
        <input name="cap" type="number" min={1} defaultValue={room.capacity} dir="ltr" className={`${INP} text-center`} />
      </Cell>

      <Cell label="نوع">
        <input name="roomType" list="room-type-list" defaultValue={room.roomType ?? ''} placeholder="—" className={INP} />
      </Cell>

      <Cell label="دانشکده">
        <select name="facultyId" defaultValue={String(room.facultyId ?? '')} className={INP}>
          <option value="">— بدون دانشکده —</option>
          {faculties.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </Cell>

      <Cell label="گروه مسئول">
        <select name="departmentId" defaultValue={String(room.departmentId ?? '')} className={INP}>
          <option value="">— کل دانشکده —</option>
          {departments.map(d => <option key={d.id} value={d.id}>{deptLabel(d)}</option>)}
        </select>
      </Cell>

      <Cell label="طبقه">
        <input name="floor" defaultValue={room.floor ?? ''} dir="ltr" placeholder="—" className={`${INP} text-center`} />
      </Cell>

      <Cell label="نیمکت (ردیف × ستون)">
        <div className="flex items-center gap-1" dir="ltr">
          <input name="rows" type="number" min={0} defaultValue={room.rowsCount ?? ''} placeholder="—" title="تعداد ردیف" className={`${INP} px-1 text-center`} />
          <span className="shrink-0 text-slate-400">×</span>
          <input name="cols" type="number" min={0} defaultValue={room.colsCount ?? ''} placeholder="—" title="تعداد ستون" className={`${INP} px-1 text-center`} />
        </div>
      </Cell>

      <Cell label="وضعیت">
        <select name="isActive" defaultValue={String(isActive)} className={INP}>
          <option value="1">فعال</option>
          <option value="0">غیرفعال</option>
        </select>
      </Cell>

      <Cell label="سالن امتحان">
        <select name="isExamHall" defaultValue={String(room.isExamHall ?? 0)} className={INP}>
          <option value="0">خیر</option>
          <option value="1">بله</option>
        </select>
      </Cell>

      <Cell label="ظرفیت امتحان">
        <input name="examCapacity" type="number" min={1} defaultValue={room.examCapacity ?? ''} dir="ltr" placeholder="—" className={INP} />
      </Cell>

      <Cell label="عملیات">
        <div className="flex flex-wrap items-center gap-1">
          <button
            className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-60"
            disabled={pending}
          >
            {pending ? '…' : 'ذخیره'}
          </button>
          {confirmDel ? (
            <>
              <button
                name="intent"
                value="delete"
                className="rounded-lg bg-rose-600 px-2 py-1.5 text-[11px] font-bold text-white"
                disabled={pending}
              >
                حذف؟
              </button>
              <button type="button" onClick={() => setConfirmDel(false)} className="rounded-lg border border-slate-300 px-1.5 py-1.5 text-[11px] text-slate-600">
                ✕
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDel(true)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50"
            >
              حذف
            </button>
          )}
        </div>
      </Cell>

      {state.err && (
        <p className="col-span-full text-[11px] font-bold text-rose-600">⛔ {state.err}</p>
      )}
      {state.msg && (
        <p className="col-span-full text-[11px] font-bold text-emerald-700">✓ {state.msg}</p>
      )}
    </form>
  );
}

const LBL_TB = 'flex min-w-0 flex-col gap-1 text-[11px] font-bold text-slate-500';

/** گزینه‌های «مرتب‌سازی» — برای موبایل که سرسطر کلیک‌پذیر ندارد. */
const SORT_OPTIONS: Array<[string, string]> = [
  ['code:asc', 'کد کلاس ↑'],
  ['code:desc', 'کد کلاس ↓'],
  ['name:asc', 'نام کلاس (الفبا)'],
  ['name:desc', 'نام کلاس (برعکس)'],
  ['capacity:desc', 'ظرفیت (بیشترین)'],
  ['capacity:asc', 'ظرفیت (کمترین)'],
  ['faculty:asc', 'دانشکده (الفبا)'],
  ['faculty:desc', 'دانشکده (برعکس)'],
  ['roomType:asc', 'نوع (الفبا)'],
  ['roomType:desc', 'نوع (برعکس)'],
  ['floor:asc', 'طبقه ↑'],
  ['floor:desc', 'طبقه ↓'],
  ['seats:desc', 'تعداد نیمکت (بیشترین)'],
  ['seats:asc', 'تعداد نیمکت (کمترین)'],
  ['examHall:desc', 'سالن امتحان (اول)'],
  ['examHall:asc', 'سالن امتحان (آخر)'],
  ['status:asc', 'وضعیت (فعال اول)'],
  ['status:desc', 'وضعیت (غیرفعال اول)'],
];

export default function ClassroomManager({ rooms, faculties, departments }: { rooms: RoomData[]; faculties: FacultyOption[]; departments: DeptOption[] }) {
  const [query, setQuery] = useState('');
  const [facFilter, setFacFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [codeFilter, setCodeFilter] = useState<'' | 'with' | 'without'>('');
  const [sortKey, setSortKey] = useState<SortKey>('code');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // ── انتخاب چندگانه + عملیات گروهی ──
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkState, bulkAction, bulkPending] = useActionState(adminBulkClassroomAction, INITIAL);
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);
  const allRef = useRef<HTMLInputElement>(null);
  const lastBulk = useRef<SaveClassroomResult | null>(null);
  const [hideBulkMsg, setHideBulkMsg] = useState(false);
  useEffect(() => {
    if (bulkState !== lastBulk.current && bulkState.ok) {
      lastBulk.current = bulkState;
      setSelected(new Set());
      setConfirmBulkDel(false);
    }
  }, [bulkState]);
  // پیامِ نتیجه با هر عملیات گروهیِ تازه از نو نمایش داده می‌شود.
  useEffect(() => { setHideBulkMsg(false); }, [bulkState]);

  const toggleOne = (id: number, next: boolean) => {
    setSelected(prev => {
      const s = new Set(prev);
      if (next) s.add(id); else s.delete(id);
      return s;
    });
    setConfirmBulkDel(false);
  };

  // شناسه‌های حذف‌شده را از انتخاب بیرون بیاور (پس از revalidate، rooms عوض می‌شود).
  useEffect(() => {
    setSelected(prev => {
      if (!prev.size) return prev;
      const alive = new Set(rooms.map(r => r.id));
      const next = new Set<number>();
      let changed = false;
      for (const id of prev) { if (alive.has(id)) next.add(id); else changed = true; }
      return changed ? next : prev;
    });
  }, [rooms]);

  const withCode = rooms.filter(r => r.code).length;
  const missing = rooms.length - withCode;

  const facName = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of faculties) m.set(f.id, f.name);
    return (id: number | null) => (id == null ? '' : (m.get(id) ?? ''));
  }, [faculties]);

  /** گزینه‌های فیلتر «نوع» = مقادیرِ واقعیِ موجود در داده + انواع استاندارد. */
  const typeOptions = useMemo(() => {
    const set = new Set<string>(ROOM_TYPES);
    for (const r of rooms) if (r.roomType) set.add(r.roomType);
    return [...set];
  }, [rooms]);

  const filtered = useMemo(() => {
    const q = normalizeDigits(query.trim().toLowerCase());
    const list = rooms.filter(r => {
      if (facFilter !== '' && String(r.facultyId ?? '') !== facFilter) return false;
      if (typeFilter !== '' && (r.roomType ?? '') !== typeFilter) return false;
      if (statusFilter !== '' && String(r.isActive ?? 1) !== statusFilter) return false;
      if (codeFilter === 'with' && !r.code) return false;
      if (codeFilter === 'without' && r.code) return false;
      if (q) {
        const hay = normalizeDigits(`${r.name} ${r.code ?? ''} ${facName(r.facultyId)}`.toLowerCase());
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (r: RoomData): string | number => {
      switch (sortKey) {
        case 'code': return r.code ? Number(r.code) : -1;
        case 'name': return r.name;
        case 'capacity': return r.capacity;
        case 'roomType': return r.roomType ?? '';
        case 'faculty': return facName(r.facultyId);
        case 'floor': return (r.floor ?? '').padStart(4, '0');
        case 'seats': return (r.rowsCount ?? 0) * (r.colsCount ?? 0);
        case 'status': return r.isActive ?? 1;
        case 'examHall': return r.isExamHall ?? 0;
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'fa') * dir;
    });
  }, [rooms, query, facFilter, typeFilter, statusFilter, codeFilter, sortKey, sortDir, facName]);

  const dirty = query !== '' || facFilter !== '' || typeFilter !== '' || statusFilter !== '' || codeFilter !== '';

  // «انتخاب همه» فقط روی ردیف‌های قابل‌مشاهده (پس از فیلتر) عمل می‌کند.
  const visibleIds = useMemo(() => filtered.map(r => r.id), [filtered]);
  const allChecked = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const someChecked = visibleIds.some(id => selected.has(id));
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someChecked && !allChecked;
  }, [someChecked, allChecked]);

  const toggleAll = () => {
    setSelected(prev => {
      const s = new Set(prev);
      if (allChecked) visibleIds.forEach(id => s.delete(id));
      else visibleIds.forEach(id => s.add(id));
      return s;
    });
    setConfirmBulkDel(false);
  };

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    // برای این سه ستون، «بیشترین/بله» اولویت اول کاربر است.
    else { setSortKey(k); setSortDir(k === 'capacity' || k === 'seats' || k === 'examHall' ? 'desc' : 'asc'); }
  };

  const resetFilters = () => {
    setQuery(''); setFacFilter(''); setTypeFilter(''); setStatusFilter(''); setCodeFilter('');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-slate-800">کلاس‌ها (اتاق‌های درس قابل برنامه‌ریزی)</h3>
        <p className="text-[11px] text-slate-500">
          <span className="font-bold text-slate-700">{rooms.length.toLocaleString('fa-IR')}</span> اتاق ·{' '}
          <span className="font-bold text-emerald-700">{withCode.toLocaleString('fa-IR')}</span> دارای کد
          {missing > 0 && (
            <>
              {' '}· <span className="font-bold text-amber-600">{missing.toLocaleString('fa-IR')}</span> بدون کد
            </>
          )}
        </p>
      </div>

      <datalist id="room-type-list">
        {ROOM_TYPES.map(t => <option key={t} value={t} />)}
      </datalist>

      <AddForm faculties={faculties} departments={departments} />

      <p className="text-[11px] text-slate-400">
        «کد کلاس» همان <span className="font-mono">LT4.Code</span> در سامانهٔ سماست؛ برنامهٔ هفتگی و سالن امتحان
        اتاق‌ها را با همین کد می‌شناسند. ردیف/ستون فقط برای چیدمانِ نقشهٔ حضور و غیاب است.
      </p>

      {/* ── نوار فیلتر و مرتب‌سازی ── */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <label className={`${LBL_TB} col-span-2 sm:col-span-1`}>جستجو (کد یا نام)
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="مثلاً ۲۰۷ یا انسانی"
            className={INP}
          />
        </label>
        <label className={LBL_TB}>دانشکده
          <select value={facFilter} onChange={e => setFacFilter(e.target.value)} className={INP}>
            <option value="">همه</option>
            {faculties.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className={LBL_TB}>نوع
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={INP}>
            <option value="">همه</option>
            {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className={LBL_TB}>وضعیت
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={INP}>
            <option value="">همه</option>
            <option value="1">فعال</option>
            <option value="0">غیرفعال</option>
          </select>
        </label>
        <label className={LBL_TB}>کد کلاس
          <select value={codeFilter} onChange={e => setCodeFilter(e.target.value as '' | 'with' | 'without')} className={INP}>
            <option value="">همه</option>
            <option value="with">دارای کد</option>
            <option value="without">بدون کد</option>
          </select>
        </label>
        <label className={LBL_TB}>مرتب‌سازی
          <select
            value={`${sortKey}:${sortDir}`}
            onChange={e => {
              const [k, d] = e.target.value.split(':');
              setSortKey(k as SortKey);
              setSortDir(d as 'asc' | 'desc');
            }}
            className={INP}
          >
            {SORT_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="text-slate-500">
          نمایش <b className="text-slate-800">{filtered.length.toLocaleString('fa-IR')}</b> از{' '}
          <b className="text-slate-800">{rooms.length.toLocaleString('fa-IR')}</b> اتاق
        </span>
        <div className="flex items-center gap-2">
          {/* در موبایل سرسطر مخفی است، پس «انتخاب همه» اینجا می‌نشیند. */}
          <button
            type="button"
            onClick={toggleAll}
            className="rounded-lg border border-slate-300 px-2.5 py-1 font-bold text-slate-600 hover:bg-slate-50 md:hidden"
          >
            {allChecked ? 'برداشتن انتخاب همه' : `انتخاب همه (${filtered.length.toLocaleString('fa-IR')})`}
          </button>
          {dirty && (
            <button type="button" onClick={resetFilters} className="rounded-lg border border-slate-300 px-2.5 py-1 font-bold text-slate-600 hover:bg-slate-50">
              ✕ پاک کردن فیلترها
            </button>
          )}
        </div>
      </div>

      {/* نتیجهٔ عملیات گروهی — جدا از نوار انتخاب تا پس از پاک‌شدن انتخاب هم دیده شود. */}
      {(bulkState.msg || bulkState.err) && !hideBulkMsg && (
        <div className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-[11px] font-bold ${
          bulkState.err ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}>
          <span>{bulkState.err ? `⛔ ${bulkState.err}` : `✓ ${bulkState.msg}`}</span>
          <button type="button" onClick={() => setHideBulkMsg(true)} aria-label="بستن" className="shrink-0 opacity-60 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {/* ── نوار عملیات گروهی ── */}
      {selected.size > 0 && (
        <form
          action={bulkAction}
          className="sticky top-2 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 shadow-md"
        >
          <input type="hidden" name="ids" value={[...selected].join(',')} />
          <span className="text-xs font-black text-indigo-900">
            {selected.size.toLocaleString('fa-IR')} کلاس انتخاب شده
          </span>
          <button
            name="op" value="activate" disabled={bulkPending}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
          >
            فعال کردن
          </button>
          <button
            name="op" value="deactivate" disabled={bulkPending}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
          >
            غیرفعال کردن
          </button>
          {confirmBulkDel ? (
            <>
              <button
                name="op" value="delete" disabled={bulkPending}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
              >
                حذف قطعی {selected.size.toLocaleString('fa-IR')} کلاس
              </button>
              <button
                type="button" onClick={() => setConfirmBulkDel(false)}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] text-slate-600"
              >
                ✕
              </button>
            </>
          ) : (
            <button
              type="button" onClick={() => setConfirmBulkDel(true)}
              className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50"
            >
              حذف
            </button>
          )}
          <button
            type="button" onClick={() => { setSelected(new Set()); setConfirmBulkDel(false); }}
            className="ms-auto text-[11px] font-bold text-slate-600 hover:underline"
          >
            پاک کردن انتخاب
          </button>
          {bulkPending && <span className="text-[11px] text-indigo-700">در حال اعمال…</span>}
        </form>
      )}

      <div className="overflow-x-auto">
        <div className="md:min-w-[73rem]">
          {/* سرسطر — فقط از دسکتاپ؛ کلیک روی هر عنوان = مرتب‌سازی همان ستون. */}
          <div className={`hidden md:grid ${COLS} items-center gap-1.5 px-1.5 pb-1.5`}>
            {HEADERS.map((h, i) => (
              <div key={h.label} className="min-w-0 border-b-2 border-slate-200 pb-1">
                {i === 0 ? (
                  <input
                    ref={allRef}
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    title="انتخاب همهٔ ردیف‌های قابل‌مشاهده"
                    aria-label="انتخاب همه"
                    className="h-4 w-4 cursor-pointer accent-indigo-600"
                  />
                ) : h.key ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(h.key as SortKey)}
                    title={`${h.hint}\n(کلیک = مرتب‌سازی)`}
                    className={`flex w-full min-w-0 items-center gap-1 text-[11px] font-black transition hover:text-indigo-700 ${
                      sortKey === h.key ? 'text-indigo-700' : 'text-slate-600'
                    }`}
                  >
                    <span className="truncate">{h.label}</span>
                    <span className={`shrink-0 text-[9px] leading-none ${sortKey === h.key ? 'opacity-100' : 'opacity-30'}`}>
                      {sortKey === h.key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </button>
                ) : (
                  <span title={h.hint} className="block truncate text-[11px] font-black text-slate-600">{h.label}</span>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-2 md:space-y-0">
            {filtered.map(r => (
              <RowForm
                key={r.id}
                room={r}
                faculties={faculties}
                departments={departments}
                selected={selected.has(r.id)}
                onToggle={toggleOne}
              />
            ))}
          </div>

          {filtered.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
              هیچ اتاقی با این فیلترها پیدا نشد.
              <button type="button" onClick={resetFilters} className="ms-2 font-bold text-indigo-700 hover:underline">
                پاک کردن فیلترها
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

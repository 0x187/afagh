import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  bulkAdminClassrooms,
  deleteAdminClassroom,
  getAdminClassrooms,
  saveAdminClassroom,
  type AdminClassroom,
} from '@/lib/admin-api';
import { faNumber, toEnDigits } from '@/lib/fa';
import { cn } from '@/lib/utils';

// Admin classroom manager, ported from admin/settings/ClassroomManager.
// Supports the LT4 class code, sorting/filtering, multi-select, and bulk actions.

const ROOM_TYPES = ['کلاس درس', 'آزمایشگاه', 'سالن', 'ورزشی', 'کارگاه', 'اداری'];

const COLS =
  'grid-cols-2 sm:grid-cols-3 ' +
  'md:grid-cols-[2rem_4.5rem_minmax(7rem,1.2fr)_4.5rem_6.5rem_minmax(6.5rem,1fr)_3.25rem_5.75rem_5.5rem_5.75rem]';

const INP =
  'w-full min-w-0 rounded-lg border border-input bg-card px-2 py-1.5 text-[13px] text-foreground ' +
  'outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30';

type SortKey = 'code' | 'name' | 'capacity' | 'roomType' | 'faculty' | 'floor' | 'seats' | 'status';

const HEADERS: Array<{ label: string; hint: string; key: SortKey | null }> = [
  { label: '✓', hint: 'انتخاب ردیف برای عملیات گروهی', key: null },
  { label: 'کد', hint: 'کد کلاس در سما (LT4.Code) — همان کدی که برنامهٔ هفتگی و سالن امتحان با آن کار می‌کند', key: 'code' },
  { label: 'نام کلاس', hint: 'نامی که در انتخاب‌گر کلاس و برنامهٔ هفتگی دیده می‌شود', key: 'name' },
  { label: 'ظرفیت', hint: 'ظرفیت اسمی اتاق (نفر)', key: 'capacity' },
  { label: 'نوع', hint: 'کلاس درس / آزمایشگاه / سالن / ورزشی / کارگاه', key: 'roomType' },
  { label: 'دانشکده', hint: 'دانشکدهٔ مالکِ اتاق — در سوییچ دانشگاه هم‌تراز می‌ماند', key: 'faculty' },
  { label: 'طبقه', hint: 'شمارهٔ طبقه', key: 'floor' },
  { label: 'نیمکت (ردیف × ستون)', hint: 'چیدمان نیمکت‌ها برای نقشهٔ حضور و غیاب', key: 'seats' },
  { label: 'وضعیت', hint: 'کلاس غیرفعال در انتخاب‌گر سردر کلاس نمایش داده نمی‌شود', key: 'status' },
  { label: 'عملیات', hint: 'ذخیره یا حذف همین ردیف', key: null },
];

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
  ['status:asc', 'وضعیت (فعال اول)'],
  ['status:desc', 'وضعیت (غیرفعال اول)'],
];

type RowForm = {
  code: string;
  name: string;
  capacity: string;
  roomType: string;
  facultyId: string;
  floor: string;
  rows: string;
  cols: string;
  isActive: string;
};

function blankForm(): RowForm {
  return { code: '', name: '', capacity: '', roomType: '', facultyId: '', floor: '', rows: '', cols: '', isActive: '1' };
}

function fromRoom(room: AdminClassroom): RowForm {
  return {
    code: room.code ?? '',
    name: room.name,
    capacity: String(room.capacity),
    roomType: room.roomType ?? '',
    facultyId: room.facultyId == null ? '' : String(room.facultyId),
    floor: room.floor ?? '',
    rows: room.rowsCount == null ? '' : String(room.rowsCount),
    cols: room.colsCount == null ? '' : String(room.colsCount),
    isActive: String(room.isActive ?? 1),
  };
}

function payloadOf(form: RowForm, id?: number) {
  const rows = form.rows.trim() === '' ? null : Number(toEnDigits(form.rows));
  const cols = form.cols.trim() === '' ? null : Number(toEnDigits(form.cols));
  return {
    ...(id ? { id } : {}),
    code: form.code.trim(),
    name: form.name.trim(),
    capacity: Number(toEnDigits(form.capacity)) || 0,
    roomType: form.roomType.trim(),
    facultyId: form.facultyId === '' ? null : Number(form.facultyId),
    floor: form.floor.trim(),
    rows: rows != null && Number.isFinite(rows) ? rows : null,
    cols: cols != null && Number.isFinite(cols) ? cols : null,
    isActive: form.isActive === '0' ? 0 : 1,
  };
}

function normalizeDigits(s: string): string {
  return toEnDigits(s);
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-0.5 block text-[10px] font-bold text-muted-foreground md:hidden">{label}</span>
      {children}
    </div>
  );
}

function Feedback({ err, msg }: { err: string | null; msg: string | null }) {
  return (
    <>
      {err ? <p className="col-span-full text-[11px] font-bold text-destructive">⛔ {err}</p> : null}
      {msg ? <p className="col-span-full text-[11px] font-bold text-success">✓ {msg}</p> : null}
    </>
  );
}

function AddForm({ faculties }: { faculties: { id: number; name: string }[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<RowForm>(blankForm);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => saveAdminClassroom(payloadOf(form)),
    onSuccess: async (res) => {
      setMsg(res.message);
      setErr(null);
      setForm(blankForm());
      await qc.invalidateQueries({ queryKey: ['admin-classrooms'] });
    },
    onError: (e: Error) => {
      setErr(e.message);
      setMsg(null);
    },
  });
  const set = (k: keyof RowForm, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const lbl = 'flex min-w-0 flex-col gap-1 text-[11px] font-bold text-muted-foreground';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        setMsg(null);
        mut.mutate();
      }}
      className="grid grid-cols-2 items-end gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-4 lg:grid-cols-5"
    >
      <label className={lbl}>
        کد کلاس
        <Input value={form.code} onChange={(e) => set('code', e.target.value)} className={cn(INP, 'text-center font-mono')} dir="ltr" placeholder="مثلاً 201" />
      </label>
      <label className={cn(lbl, 'col-span-2 sm:col-span-1')}>
        نام
        <Input value={form.name} onChange={(e) => set('name', e.target.value)} required className={INP} placeholder="مثلاً کلاس ۳۰۵" />
      </label>
      <label className={lbl}>
        ظرفیت
        <Input value={form.capacity} onChange={(e) => set('capacity', e.target.value)} type="number" min={1} required className={INP} dir="ltr" placeholder="۴۰" />
      </label>
      <label className={lbl}>
        نوع
        <select value={form.roomType} onChange={(e) => set('roomType', e.target.value)} className={INP}>
          <option value="">—</option>
          {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label className={cn(lbl, 'col-span-2')}>
        دانشکده
        <select value={form.facultyId} onChange={(e) => set('facultyId', e.target.value)} className={INP}>
          <option value="">— بدون دانشکده —</option>
          {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <label className={lbl}>
        طبقه
        <Input value={form.floor} onChange={(e) => set('floor', e.target.value)} className={INP} dir="ltr" placeholder="۲" />
      </label>
      <label className={lbl}>
        ردیف
        <Input value={form.rows} onChange={(e) => set('rows', e.target.value)} type="number" min={0} className={INP} dir="ltr" placeholder="۵" />
      </label>
      <label className={lbl}>
        ستون
        <Input value={form.cols} onChange={(e) => set('cols', e.target.value)} type="number" min={0} className={INP} dir="ltr" placeholder="۸" />
      </label>
      <label className="flex items-center gap-1.5 pb-2 text-xs font-bold text-muted-foreground">
        <input type="checkbox" checked={form.isActive !== '0'} onChange={(e) => set('isActive', e.target.checked ? '1' : '0')} className="size-4" /> فعال
      </label>
      <Button type="submit" size="sm" className="h-9" disabled={mut.isPending}>
        <Plus className="size-4" aria-hidden /> {mut.isPending ? 'در حال افزودن…' : 'افزودن کلاس'}
      </Button>
      <Feedback err={err} msg={msg} />
    </form>
  );
}

function ClassroomRow({
  room,
  faculties,
  selected,
  onToggle,
}: {
  room: AdminClassroom;
  faculties: { id: number; name: string }[];
  selected: boolean;
  onToggle: (id: number, next: boolean) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<RowForm>(() => fromRoom(room));
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const saveMut = useMutation({
    mutationFn: () => saveAdminClassroom(payloadOf(form, room.id)),
    onSuccess: async (res) => {
      setMsg(res.message);
      setErr(null);
      await qc.invalidateQueries({ queryKey: ['admin-classrooms'] });
    },
    onError: (e: Error) => {
      setErr(e.message);
      setMsg(null);
    },
  });
  const delMut = useMutation({
    mutationFn: () => deleteAdminClassroom(room.id),
    onSuccess: async (res) => {
      setMsg(res.message);
      setErr(null);
      setConfirmDel(false);
      await qc.invalidateQueries({ queryKey: ['admin-classrooms'] });
    },
    onError: (e: Error) => {
      setErr(e.message);
      setMsg(null);
    },
  });
  const set = (k: keyof RowForm, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const noCode = !room.code;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        setMsg(null);
        saveMut.mutate();
      }}
      className={cn(
        'grid items-start gap-2 rounded-xl border bg-card p-2.5 md:items-center md:gap-1.5 md:rounded-none md:border-0 md:border-t md:p-1.5',
        COLS,
        selected ? 'border-primary/40 ring-1 ring-primary/20 md:border-primary/20 md:bg-primary/5' : 'border-border md:border-border/60',
      )}
    >
      <Cell label="انتخاب">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggle(room.id, e.target.checked)}
          aria-label={`انتخاب کلاس ${room.name}`}
          className="size-4 cursor-pointer"
        />
      </Cell>

      <Cell label="کد">
        <Input
          value={form.code}
          onChange={(e) => set('code', e.target.value)}
          placeholder="بدون کد"
          title={noCode ? 'این اتاق در سما کد ندارد' : `کد سما: ${room.code}`}
          dir="ltr"
          className={cn(INP, 'text-center font-mono', noCode && 'border-warning bg-warning/10 placeholder:text-[10px] placeholder:font-sans placeholder:text-warning')}
        />
      </Cell>

      <Cell label="نام کلاس">
        <Input value={form.name} onChange={(e) => set('name', e.target.value)} className={cn(INP, 'font-bold')} />
      </Cell>

      <Cell label="ظرفیت">
        <Input value={form.capacity} onChange={(e) => set('capacity', e.target.value)} type="number" min={1} dir="ltr" className={cn(INP, 'text-center')} />
      </Cell>

      <Cell label="نوع">
        <Input value={form.roomType} onChange={(e) => set('roomType', e.target.value)} list="admin-room-type-list" placeholder="—" className={INP} />
      </Cell>

      <Cell label="دانشکده">
        <select value={form.facultyId} onChange={(e) => set('facultyId', e.target.value)} className={INP}>
          <option value="">— بدون دانشکده —</option>
          {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </Cell>

      <Cell label="طبقه">
        <Input value={form.floor} onChange={(e) => set('floor', e.target.value)} dir="ltr" placeholder="—" className={cn(INP, 'text-center')} />
      </Cell>

      <Cell label="نیمکت (ردیف × ستون)">
        <div className="flex items-center gap-1" dir="ltr">
          <Input value={form.rows} onChange={(e) => set('rows', e.target.value)} type="number" min={0} placeholder="—" title="تعداد ردیف" className={cn(INP, 'px-1 text-center')} />
          <span className="shrink-0 text-muted-foreground">×</span>
          <Input value={form.cols} onChange={(e) => set('cols', e.target.value)} type="number" min={0} placeholder="—" title="تعداد ستون" className={cn(INP, 'px-1 text-center')} />
        </div>
      </Cell>

      <Cell label="وضعیت">
        <select value={form.isActive} onChange={(e) => set('isActive', e.target.value)} className={INP}>
          <option value="1">فعال</option>
          <option value="0">غیرفعال</option>
        </select>
      </Cell>

      <Cell label="عملیات">
        <div className="flex flex-wrap items-center gap-1">
          <Button type="submit" size="sm" className="h-7 px-2 text-[11px]" disabled={saveMut.isPending}>
            {saveMut.isPending ? '…' : 'ذخیره'}
          </Button>
          {confirmDel ? (
            <>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={delMut.isPending}
                onClick={() => delMut.mutate()}
              >
                حذف؟
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => setConfirmDel(false)} aria-label="انصراف">
                <X className="size-3" aria-hidden />
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px] text-destructive" onClick={() => setConfirmDel(true)}>
              حذف
            </Button>
          )}
        </div>
      </Cell>

      <Feedback err={err} msg={msg} />
    </form>
  );
}

/** Admin room manager: add/edit/delete rows, sort/filter, and bulk actions. */
export function ClassroomManager() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-classrooms'], queryFn: getAdminClassrooms, staleTime: 30_000 });

  const [query, setQuery] = useState('');
  const [facFilter, setFacFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [codeFilter, setCodeFilter] = useState<'' | 'with' | 'without'>('');
  const [sortKey, setSortKey] = useState<SortKey>('code');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);
  const allRef = useRef<HTMLInputElement>(null);

  const rooms = data?.classrooms ?? [];
  const faculties = data?.faculties ?? [];

  const bulkMut = useMutation({
    mutationFn: (op: 'activate' | 'deactivate' | 'delete') => bulkAdminClassrooms(op, [...selected]),
    onSuccess: async (res) => {
      setBulkMsg(res.message);
      setBulkErr(null);
      setSelected(new Set());
      setConfirmBulkDel(false);
      await qc.invalidateQueries({ queryKey: ['admin-classrooms'] });
    },
    onError: (e: Error) => {
      setBulkErr(e.message);
      setBulkMsg(null);
    },
  });

  const facName = useMemo(() => {
    const map = new Map<number, string>();
    for (const f of faculties) map.set(f.id, f.name);
    return (id: number | null) => (id == null ? '' : (map.get(id) ?? ''));
  }, [faculties]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>(ROOM_TYPES);
    for (const r of rooms) if (r.roomType) set.add(r.roomType);
    return [...set];
  }, [rooms]);

  const filtered = useMemo(() => {
    const q = normalizeDigits(query.trim().toLowerCase());
    const list = rooms.filter((r) => {
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
    const val = (r: AdminClassroom): string | number => {
      switch (sortKey) {
        case 'code': return r.code ? Number(r.code) : -1;
        case 'name': return r.name;
        case 'capacity': return r.capacity;
        case 'roomType': return r.roomType ?? '';
        case 'faculty': return facName(r.facultyId);
        case 'floor': return (r.floor ?? '').padStart(4, '0');
        case 'seats': return (r.rowsCount ?? 0) * (r.colsCount ?? 0);
        case 'status': return r.isActive ?? 1;
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'fa') * dir;
    });
  }, [rooms, query, facFilter, typeFilter, statusFilter, codeFilter, sortKey, sortDir, facName]);

  const visibleIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someChecked = visibleIds.some((id) => selected.has(id));

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someChecked && !allChecked;
  }, [someChecked, allChecked]);

  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const alive = new Set(rooms.map((r) => r.id));
      const next = new Set<number>();
      let changed = false;
      for (const id of prev) {
        if (alive.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rooms]);

  const withCode = rooms.filter((r) => r.code).length;
  const missing = rooms.length - withCode;
  const dirty = query !== '' || facFilter !== '' || typeFilter !== '' || statusFilter !== '' || codeFilter !== '';

  const toggleOne = (id: number, next: boolean) => {
    setSelected((prev) => {
      const s = new Set(prev);
      if (next) s.add(id);
      else s.delete(id);
      return s;
    });
    setConfirmBulkDel(false);
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const s = new Set(prev);
      if (allChecked) visibleIds.forEach((id) => s.delete(id));
      else visibleIds.forEach((id) => s.add(id));
      return s;
    });
    setConfirmBulkDel(false);
  };

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir(k === 'capacity' || k === 'seats' ? 'desc' : 'asc');
    }
  };

  const resetFilters = () => {
    setQuery('');
    setFacFilter('');
    setTypeFilter('');
    setStatusFilter('');
    setCodeFilter('');
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">دریافت فهرست کلاس‌ها ناموفق بود (فقط مدیر سامانه/کارشناس آموزش).</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <datalist id="admin-room-type-list">
        {ROOM_TYPES.map((t) => <option key={t} value={t} />)}
      </datalist>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-black">کلاس‌ها (اتاق‌های درس قابل برنامه‌ریزی)</h3>
        <p className="text-[11px] text-muted-foreground">
          <span className="font-bold text-foreground">{faNumber(rooms.length)}</span> اتاق ·{' '}
          <span className="font-bold text-success">{faNumber(withCode)}</span> دارای کد
          {missing > 0 ? (
            <>
              {' '}· <span className="font-bold text-warning">{faNumber(missing)}</span> بدون کد
            </>
          ) : null}
        </p>
      </div>

      <AddForm faculties={faculties} />

      <p className="text-[11px] text-muted-foreground">
        «کد کلاس» همان <span className="font-mono">LT4.Code</span> در سامانهٔ سماست؛ برنامهٔ هفتگی و سالن امتحان اتاق‌ها را با همین کد می‌شناسند. ردیف/ستون فقط برای چیدمانِ نقشهٔ حضور و غیاب است.
      </p>

      <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <label className="col-span-2 flex min-w-0 flex-col gap-1 text-[11px] font-bold text-muted-foreground sm:col-span-1">
          جستجو (کد یا نام)
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="مثلاً ۲۰۷ یا انسانی" className={INP} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[11px] font-bold text-muted-foreground">
          دانشکده
          <select value={facFilter} onChange={(e) => setFacFilter(e.target.value)} className={INP}>
            <option value="">همه</option>
            {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[11px] font-bold text-muted-foreground">
          نوع
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={INP}>
            <option value="">همه</option>
            {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[11px] font-bold text-muted-foreground">
          وضعیت
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={INP}>
            <option value="">همه</option>
            <option value="1">فعال</option>
            <option value="0">غیرفعال</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[11px] font-bold text-muted-foreground">
          کد کلاس
          <select value={codeFilter} onChange={(e) => setCodeFilter(e.target.value as '' | 'with' | 'without')} className={INP}>
            <option value="">همه</option>
            <option value="with">دارای کد</option>
            <option value="without">بدون کد</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[11px] font-bold text-muted-foreground">
          مرتب‌سازی
          <select
            value={`${sortKey}:${sortDir}`}
            onChange={(e) => {
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
        <span className="text-muted-foreground">
          نمایش <b className="text-foreground">{faNumber(filtered.length)}</b> از <b className="text-foreground">{faNumber(rooms.length)}</b> اتاق
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-7 text-[11px] md:hidden" onClick={toggleAll}>
            {allChecked ? 'برداشتن انتخاب همه' : `انتخاب همه (${faNumber(filtered.length)})`}
          </Button>
          {dirty ? (
            <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={resetFilters}>
              <RotateCcw className="size-3" aria-hidden /> پاک کردن فیلترها
            </Button>
          ) : null}
        </div>
      </div>

      {bulkMsg || bulkErr ? (
        <div
          className={cn(
            'flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-[11px] font-bold',
            bulkErr ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-success/30 bg-success/10 text-success',
          )}
        >
          <span>{bulkErr ? `⛔ ${bulkErr}` : `✓ ${bulkMsg}`}</span>
          <button type="button" onClick={() => { setBulkMsg(null); setBulkErr(null); }} aria-label="بستن" className="shrink-0 opacity-60 hover:opacity-100">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="sticky top-2 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 shadow-md">
          <span className="text-xs font-black text-foreground">{faNumber(selected.size)} کلاس انتخاب شده</span>
          <Button type="button" variant="success" size="sm" className="h-7 text-[11px]" disabled={bulkMut.isPending} onClick={() => bulkMut.mutate('activate')}>
            فعال کردن
          </Button>
          <Button type="button" variant="secondary" size="sm" className="h-7 text-[11px]" disabled={bulkMut.isPending} onClick={() => bulkMut.mutate('deactivate')}>
            غیرفعال کردن
          </Button>
          {confirmBulkDel ? (
            <>
              <Button type="button" variant="destructive" size="sm" className="h-7 text-[11px]" disabled={bulkMut.isPending} onClick={() => bulkMut.mutate('delete')}>
                حذف قطعی {faNumber(selected.size)} کلاس
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => setConfirmBulkDel(false)} aria-label="انصراف">
                <X className="size-3.5" aria-hidden />
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" className="h-7 text-[11px] text-destructive" onClick={() => setConfirmBulkDel(true)}>
              <Trash2 className="size-3" aria-hidden /> حذف
            </Button>
          )}
          <button type="button" onClick={() => { setSelected(new Set()); setConfirmBulkDel(false); }} className="ms-auto text-[11px] font-bold text-muted-foreground hover:underline">
            پاک کردن انتخاب
          </button>
          {bulkMut.isPending ? <span className="text-[11px] text-primary">در حال اعمال…</span> : null}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <div className="md:min-w-[56rem]">
          <div className={cn('hidden items-center gap-1.5 px-1.5 pb-1.5 md:grid', COLS)}>
            {HEADERS.map((h, i) => (
              <div key={h.label} className="min-w-0 border-b-2 border-border pb-1">
                {i === 0 ? (
                  <input
                    ref={allRef}
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    title="انتخاب همهٔ ردیف‌های قابل‌مشاهده"
                    aria-label="انتخاب همه"
                    className="size-4 cursor-pointer"
                  />
                ) : h.key ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(h.key as SortKey)}
                    title={`${h.hint}\n(کلیک = مرتب‌سازی)`}
                    className={cn(
                      'flex w-full min-w-0 items-center gap-1 text-[11px] font-black transition hover:text-primary',
                      sortKey === h.key ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    <span className="truncate">{h.label}</span>
                    <span className={cn('shrink-0 text-[9px] leading-none', sortKey === h.key ? 'opacity-100' : 'opacity-30')}>
                      {sortKey === h.key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </button>
                ) : (
                  <span title={h.hint} className="block truncate text-[11px] font-black text-muted-foreground">{h.label}</span>
                )}
              </div>
            ))}
          </div>

          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                {rooms.length === 0 ? 'هنوز کلاسی تعریف نشده است.' : 'با این فیلترها کلاسی پیدا نشد.'}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2 md:space-y-0">
              {filtered.map((room) => (
                <ClassroomRow
                  key={room.id}
                  room={room}
                  faculties={faculties}
                  selected={selected.has(room.id)}
                  onToggle={toggleOne}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground">
        {faNumber(rooms.length)} اتاق · {faNumber(withCode)} دارای کد · {faNumber(missing)} بدون کد — کلاس دارای برنامهٔ هفتگی قابل حذف نیست.
      </p>
    </div>
  );
}

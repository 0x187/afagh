'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

/** سطر فهرست مالی — هم‌شکل FinanceStudentRow (ساختاری؛ بدون وابستگی سرور) */
export interface PickerStudent {
  studentId: number;
  studentCode: string | null;
  firstName: string | null;
  lastName: string | null;
  nationalCode: string | null;
  majorTitle: string | null;
  degreeTitle: string | null;
  entryYear: number | null;
  status: string | null;
  balance: number;
  pendingCheques: number;
}

/** ارقام فارسی/عربی → انگلیسی برای جستجوی بی‌تفاوت به صفحه‌کلید */
const toEnDigits = (s: string) =>
  s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

const fa = (n: number) => n.toLocaleString('fa-IR');

/** پالت آواتار — رنگ پایدار بر اساس شناسه تا رندر ثابت بماند */
const AVATAR_TONES = [
  'from-emerald-500 to-teal-600',
  'from-indigo-500 to-blue-600',
  'from-violet-500 to-purple-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-sky-500 to-cyan-600',
];

type SortKey = 'code' | 'balance' | 'name';

export default function StudentPicker({
  students,
  universityTitle,
}: {
  students: PickerStudent[];
  universityTitle: string;
}) {
  const [query, setQuery] = useState('');
  const [onlyDebtors, setOnlyDebtors] = useState(false);
  const [sort, setSort] = useState<SortKey>('code');

  // آمار سراسری (مستقل از فیلتر — تصویر کلی دفتر مالی)
  const stats = useMemo(() => {
    let debtors = 0;
    let receivable = 0;
    let chequesWaiting = 0;
    for (const s of students) {
      if (s.balance > 0) {
        debtors++;
        receivable += s.balance;
      }
      chequesWaiting += s.pendingCheques || 0;
    }
    return { total: students.length, debtors, receivable, chequesWaiting };
  }, [students]);

  const rows = useMemo(() => {
    const q = toEnDigits(query.trim().toLowerCase());
    const out = students.filter((s) => {
      if (onlyDebtors && s.balance <= 0) return false;
      if (!q) return true;
      const hay = toEnDigits(
        [
          s.firstName ?? '',
          s.lastName ?? '',
          s.studentCode ?? '',
          s.nationalCode ?? '',
          s.majorTitle ?? '',
          s.degreeTitle ?? '',
        ]
          .join(' ')
          .toLowerCase()
      );
      return hay.includes(q);
    });
    out.sort((a, b) => {
      if (sort === 'balance') return b.balance - a.balance;
      if (sort === 'name')
        return `${a.lastName ?? ''} ${a.firstName ?? ''}`.localeCompare(
          `${b.lastName ?? ''} ${b.firstName ?? ''}`,
          'fa'
        );
      return (a.studentCode ?? '').localeCompare(b.studentCode ?? '', 'fa', { numeric: true });
    });
    return out;
  }, [students, query, onlyDebtors, sort]);

  const KPIS = [
    { icon: '👥', label: 'کل دانشجویان', value: fa(stats.total), tone: 'from-slate-500/15 to-slate-50/60 border-slate-300', valueTone: 'text-slate-800' },
    { icon: '⚠️', label: 'بدهکاران', value: fa(stats.debtors), tone: 'from-rose-500/15 to-rose-50/60 border-rose-300', valueTone: 'text-rose-700' },
    { icon: '💰', label: 'جمع دریافتنی', value: `${fa(stats.receivable)} ریال`, tone: 'from-emerald-500/15 to-emerald-50/60 border-emerald-300', valueTone: 'text-emerald-700' },
    { icon: '🧾', label: 'چک در انتظار', value: `${fa(stats.chequesWaiting)} ریال`, tone: 'from-amber-500/15 to-amber-50/60 border-amber-300', valueTone: 'text-amber-700' },
  ];

  return (
    <div className="space-y-4 print:hidden" dir="rtl">
      {/* ── سربرگ premium ── */}
      <div className="overflow-hidden rounded-2xl border border-emerald-900/20 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 p-5 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-black sm:text-xl">📄 صورت‌حساب / کارنامهٔ مالی دانشجو</h1>
            <p className="mt-1 text-xs text-emerald-50/90">
              دانشجو را جستجو کنید؛ سند رسمی ترم‌به‌ترم با امکان چاپ A4 باز می‌شود
            </p>
            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-2xs font-bold">
              🏛️ {universityTitle}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/finance/reports"
              className="rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20"
            >
              ↩️ مرکز گزارش‌ها
            </Link>
            <Link
              href="/admin/finance"
              className="rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20"
            >
              🗂️ کارتابل مالی
            </Link>
          </div>
        </div>
      </div>

      {/* ── KPI ── */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {KPIS.map((k) => (
          <div key={k.label} className={`rounded-xl border bg-gradient-to-b p-3 shadow-sm ${k.tone}`}>
            <div className="flex items-center gap-1.5 text-2xs font-bold text-slate-500">
              <span>{k.icon}</span>
              {k.label}
            </div>
            <div className={`mt-1 text-sm font-black ${k.valueTone}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── نوار ابزار ── */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[220px] flex-1">
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجو بر اساس نام، کد دانشجویی، کد ملی یا رشته…"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-9 pl-3 text-xs text-slate-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlyDebtors((v) => !v)}
          className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
            onlyDebtors
              ? 'border-rose-400 bg-rose-50 text-rose-700'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
          }`}
        >
          ⚠️ فقط بدهکاران
        </button>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-600 outline-none transition hover:border-slate-300"
        >
          <option value="code">مرتب‌سازی: کد دانشجویی</option>
          <option value="balance">مرتب‌سازی: بیشترین بدهی</option>
          <option value="name">مرتب‌سازی: نام خانوادگی</option>
        </select>
        <span className="rounded-lg bg-slate-100 px-2.5 py-2 text-2xs font-bold text-slate-600">
          {fa(rows.length)} از {fa(students.length)} نفر
        </span>
      </div>

      {/* ── جدول ── */}
      <div className="card overflow-hidden p-0">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-right text-xs rt">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-slate-200 bg-slate-50/95 text-slate-600 backdrop-blur">
                <th className="p-2.5 font-black">دانشجو</th>
                <th className="p-2.5 font-black">رشته / مقطع</th>
                <th className="p-2.5 font-black">ورودی</th>
                <th className="p-2.5 font-black">مانده کل</th>
                <th className="p-2.5 font-black">چک در انتظار</th>
                <th className="p-2.5 font-black print:hidden">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const tone = AVATAR_TONES[s.studentId % AVATAR_TONES.length];
                const name = `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || 'بدون نام';
                return (
                  <tr key={s.studentId} className="border-b border-slate-50 transition hover:bg-emerald-50/40">
                    <td className="p-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-2xs font-black text-white ${tone}`}
                        >
                          {(s.firstName?.[0] ?? '') + (s.lastName?.[0] ?? '') || '؟'}
                        </span>
                        <span>
                          <span className="block font-bold text-slate-800">{name}</span>
                          <span className="block font-mono text-3xs text-slate-500">
                            {s.studentCode ?? '—'}
                            {s.nationalCode ? ` · ملی ${s.nationalCode}` : ''}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="p-2.5 text-slate-600">
                      <span className="block">{s.majorTitle ?? '—'}</span>
                      <span className="block text-3xs text-slate-400">{s.degreeTitle ?? ''}</span>
                    </td>
                    <td className="p-2.5 text-slate-600">{s.entryYear ? fa(s.entryYear) : '—'}</td>
                    <td className="p-2.5">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-2xs font-black ${
                          s.balance > 0
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {fa(s.balance)} ریال
                      </span>
                    </td>
                    <td className="p-2.5 text-xs text-amber-700">{s.pendingCheques ? `${fa(s.pendingCheques)} ریال` : '—'}</td>
                    <td className="p-2.5 print:hidden">
                      <Link
                        href={`/admin/finance/reports/student-statement?studentId=${s.studentId}`}
                        className="inline-block rounded-lg bg-gradient-to-l from-emerald-600 to-teal-700 px-3 py-1.5 text-2xs font-black text-white shadow-sm transition hover:from-emerald-700 hover:to-teal-800"
                      >
                        📄 صورت حساب
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-slate-400">
                    <div className="text-3xl">🔎</div>
                    <div className="mt-2 text-xs font-bold">دانشجویی با این جستجو یافت نشد</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-2xs text-slate-400">
        سند صادرشده، همان کارنامهٔ مالی رسمی سما است — با سربرگ دانشگاه، جمع‌کل، جدول ترم‌ها و محل امضای کارشناس
      </p>
    </div>
  );
}

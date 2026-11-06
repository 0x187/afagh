'use client';

import Link from 'next/link';
import { ClientTh, useClientTable, type ColumnDef } from '@/components/DataTable';
import MobileCardList from '@/components/MobileCardList';

export type FinanceStudent = {
  studentId: number;
  firstName: string | null;
  lastName: string | null;
  nationalCode: string | null;
  studentCode: string | null;
  majorTitle: string | null;
  degreeTitle: string | null;
  entryYear: number | null;
  charges: number;
  discounts: number;
  sponsorships: number;
  payments: number;
  chequesCleared: number;
  loans: number;
  pendingCheques: number;
  balance: number;
};

const fa = (n: number) => Number(n || 0).toLocaleString('fa-IR');
const faYear = (y: number | null) => (y ? fa(y) : '—');
const money = (n: number) => (n > 0 ? fa(n) : '—');

export default function FinanceTable({ students }: { students: FinanceStudent[] }) {
  const COLS: ColumnDef<FinanceStudent>[] = [
    { key: 'name', label: 'دانشجو', get: s => `${s.firstName || ''} ${s.lastName || ''} ${s.nationalCode || ''}`.trim() },
    { key: 'code', label: 'شمارهٔ دانشجویی', get: s => s.studentCode ?? '' },
    { key: 'major', label: 'رشته', get: s => s.majorTitle ?? '' },
    { key: 'degree', label: 'مقطع', get: s => s.degreeTitle ?? '' },
    { key: 'year', label: 'ورودی', get: s => s.entryYear, numeric: true },
    { key: 'charges', label: 'شهریه', get: s => s.charges, numeric: true },
    { key: 'discounts', label: 'تخفیف', get: s => s.discounts, numeric: true },
    { key: 'sponsorships', label: 'پوشش بنیاد', get: s => s.sponsorships, numeric: true },
    { key: 'payments', label: 'پرداخت', get: s => s.payments, numeric: true },
    { key: 'cheques', label: 'چک وصولی', get: s => s.chequesCleared, numeric: true },
    { key: 'loans', label: 'وام', get: s => s.loans, numeric: true },
    { key: 'pending', label: 'چک در انتظار', get: s => s.pendingCheques, numeric: true },
    { key: 'balance', label: 'مانده', get: s => s.balance, numeric: true },
  ];
  const t = useClientTable(students, COLS);
  const sum = (f: (s: FinanceStudent) => number) => t.visible.reduce((a, s) => a + f(s), 0);

  const initial = (s: FinanceStudent) =>
    ((s.firstName || '').trim()[0] ?? '') + ((s.lastName || '').trim()[0] ?? '');

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 hidden md:block">
      <table className="w-full table-fixed text-right text-sm rt">
        <colgroup>
          <col style={{ width: 205 }} />
          <col style={{ width: 108 }} />
          <col />
          <col style={{ width: 95 }} />
          <col style={{ width: 68 }} />
          <col style={{ width: 100 }} />
          <col style={{ width: 98 }} />
          <col style={{ width: 104 }} />
          <col style={{ width: 104 }} />
          <col style={{ width: 104 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 104 }} />
          <col style={{ width: 112 }} />
        </colgroup>
        <thead>
          {/* ⚡ `backdrop-blur` حذف شد: سرستون چسبان روی ۵۰ ردیف، هنگام اسکرول
              مدام تمام صفحه را دوباره رنگآمیزی میکرد. پسزمینهٔ کدر ساده
              (`bg-slate-100`) همان خوانایی را میدهد بیآنکه لایهٔ blur بسازد. */}
          <tr className="sticky top-0 z-10 border-b-2 border-slate-300 bg-slate-100 text-2xs text-slate-600">
            {COLS.map(c => (
              <ClientTh
                key={c.key}
                col={c}
                sortKey={t.sortKey}
                sortDir={t.sortDir}
                filter={t.filters[c.key] ?? ''}
                onSort={() => t.toggleSort(c.key)}
                onFilter={v => t.setFilter(c.key, v)}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {t.visible.map((s, i) => (
            <tr
              key={s.studentId}
              className={`border-b border-slate-100 transition-colors last:border-0 hover:bg-emerald-50/60 ${
                i % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'
              }`}
            >
              <td className="p-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-2xs font-black text-white shadow-sm ${
                      s.balance > 0 ? 'bg-gradient-to-br from-rose-500 to-rose-700' : 'bg-gradient-to-br from-emerald-500 to-teal-600'
                    }`}
                  >
                    {initial(s) || '؟'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link prefetch={false} href={`/admin/finance/student/${s.studentId}`} className="block truncate font-bold text-slate-800 hover:text-emerald-700">
                      {`${s.firstName || ''} ${s.lastName || ''}`.trim() || '—'}
                    </Link>
                    <span className="mt-0.5 flex items-center justify-between gap-1">
                      <span className="truncate text-3xs text-slate-400" dir="ltr">{s.nationalCode || '—'}</span>
                      <Link prefetch={false}
                        href={`/admin/finance/student/${s.studentId}`}
                        title="کارنامهٔ مالی دانشجو"
                        className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-px text-3xs font-black text-emerald-700 transition hover:bg-emerald-100 print:hidden"
                      >
                        📄 کارنامهٔ مالی
                      </Link>
                    </span>
                  </span>
                </div>
              </td>
              <td className="p-2 font-mono text-xs text-slate-600" dir="ltr">{s.studentCode || '—'}</td>
              <td className="p-2 text-xs text-slate-600">{s.majorTitle || '—'}</td>
              <td className="p-2 text-xs text-slate-600">{s.degreeTitle || '—'}</td>
              <td className="p-2 text-xs text-slate-600">{faYear(s.entryYear)}</td>
              <td className="p-2 text-xs text-slate-700">{fa(s.charges)}</td>
              <td className="p-2 text-xs text-violet-700">{money(s.discounts)}</td>
              <td className="p-2 text-xs text-indigo-700">{money(s.sponsorships)}</td>
              <td className="p-2 text-xs text-emerald-700">{fa(s.payments)}</td>
              <td className="p-2 text-xs text-emerald-700">{money(s.chequesCleared)}</td>
              <td className="p-2 text-xs text-sky-700">{money(s.loans)}</td>
              <td className="p-2 text-xs text-amber-700">{money(s.pendingCheques)}</td>
              <td className="p-2">
                <span
                  className={`inline-block min-w-[86px] rounded-full border px-2 py-0.5 text-center text-2xs font-black ${
                    s.balance > 0
                      ? 'border-rose-200 bg-rose-50 text-rose-700'
                      : s.balance < 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-100 text-slate-600'
                  }`}
                >
                  {fa(s.balance)}
                </span>
              </td>
            </tr>
          ))}
          {t.visible.length === 0 && (
            <tr><td colSpan={13} className="p-8 text-center text-xs text-slate-500">دانشجویی با این فیلترها یافت نشد.</td></tr>
          )}
        </tbody>
        <tfoot>
          <tr className="bg-slate-800 text-xs font-black text-white">
            <td className="p-2" colSpan={5}>جمع ({fa(t.visible.length)} نفر)</td>
            <td className="p-2">{fa(sum(s => s.charges))}</td>
            <td className="p-2 text-violet-300">{fa(sum(s => s.discounts))}</td>
            <td className="p-2 text-indigo-300">{fa(sum(s => s.sponsorships))}</td>
            <td className="p-2 text-emerald-300">{fa(sum(s => s.payments))}</td>
            <td className="p-2 text-emerald-300">{fa(sum(s => s.chequesCleared))}</td>
            <td className="p-2 text-sky-300">{fa(sum(s => s.loans))}</td>
            <td className="p-2 text-amber-300">{fa(sum(s => s.pendingCheques))}</td>
            <td className="p-2">
              <span className={`rounded-full px-2 py-0.5 ${sum(s => s.balance) > 0 ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                {fa(sum(s => s.balance))}
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <MobileCardList<FinanceStudent>
      rows={t.visible}
      columns={[
        { key: 'name', label: 'دانشجو', title: true, render: (s) => `${s.firstName || ''} ${s.lastName || ''}`.trim() || '—' },
        { key: 'studentCode', label: 'شمارهٔ دانشجویی', subtitle: true, render: (s) => s.studentCode ?? '—' },
        { key: 'majorTitle', label: 'رشته', render: (s) => s.majorTitle ?? '—' },
        { key: 'degreeTitle', label: 'مقطع', render: (s) => s.degreeTitle ?? '—' },
        { key: 'entryYear', label: 'ورودی', render: (s) => faYear(s.entryYear) },
        { key: 'charges', label: 'شهریه', render: (s) => fa(s.charges) },
        { key: 'discounts', label: 'تخفیف', render: (s) => money(s.discounts) },
        { key: 'sponsorships', label: 'پوشش بنیاد', render: (s) => money(s.sponsorships) },
        { key: 'payments', label: 'پرداخت', render: (s) => fa(s.payments) },
        { key: 'chequesCleared', label: 'چک وصولی', render: (s) => money(s.chequesCleared) },
        { key: 'loans', label: 'وام', render: (s) => money(s.loans) },
        { key: 'pendingCheques', label: 'چک در انتظار', render: (s) => money(s.pendingCheques) },
        { key: 'balance', label: 'مانده', bare: true, render: (s) => (
          <span className={`inline-block min-w-[86px] rounded-full border px-2 py-0.5 text-center text-2xs font-black ${s.balance > 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : s.balance < 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
            {fa(s.balance)}
          </span>
        ) },
      ]}
      getKey={(s) => s.studentId}
      renderActions={(s) => (
        <Link prefetch={false} href={`/admin/finance/student/${s.studentId}`} title="کارنامهٔ مالی دانشجو" className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-px text-3xs font-black text-emerald-700 transition hover:bg-emerald-100">
          📄 کارنامهٔ مالی
        </Link>
      )}
      empty={<div className="p-8 text-center text-xs text-slate-500">دانشجویی با این فیلترها یافت نشد.</div>}
    />
    </>
  );
}

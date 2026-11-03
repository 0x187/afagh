import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getPosTerminals, getPosTransactions } from '@/lib/pos-actions';
import { getCurrentUniversity } from '@/lib/university-scope';
import PosTerminalClient from './PosTerminalClient';

const POS_ROLES = ['ADMIN', 'FINANCE_EXPERT', 'FINANCE', 'CASHIER'] as never[];

export default async function PosPage() {
  await requireRole(POS_ROLES);
  const currentUniversity = await getCurrentUniversity();
  if (!currentUniversity) return <div className="card p-6 text-center text-slate-500">دانشگاه فعال یافت نشد</div>;

  const [terminals, recentTxns] = await Promise.all([
    getPosTerminals(),
    getPosTransactions({ limit: 50 }),
  ]);

  const fa = (n: number) => Number(n || 0).toLocaleString('fa-IR');

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── سربرگ premium ── */}
      <div className="overflow-hidden rounded-2xl border border-emerald-900/20 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 p-4 text-white shadow-lg print:hidden sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black sm:text-xl">🏧 مدیریت ترمینال‌های POS (پرداخت حضوری)</h1>
            <p className="mt-1 text-xs text-emerald-50/90">ثبت پرداخت کارت‌خوان فیزیکی، ویدی تراکنش، گزارش‌های روزانه</p>
          </div>
          <Link
            href="/admin/finance"
            className="rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20"
          >
            ↩️ بازگشت به کارتابل
          </Link>
        </div>
      </div>

      {/* Terminals Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 print:hidden">
        {terminals.map((t) => (
          <PosTerminalClient key={t.id} terminal={t} universityId={currentUniversity.id} />
        ))}
        {terminals.length === 0 && (
          <div className="col-span-full card p-6 text-center text-slate-500 border-dashed border-slate-300">
            <p className="font-medium text-slate-700">هیچ ترمینال POS فعالی تعریف نشده</p>
            <p className="text-xs text-slate-500 mt-1">از منوی «⚙️ انواع تخفیف، بنیادها و فرمول‌ها» → تب درگاه‌ها، ترمینال اضافه کنید</p>
          </div>
        )}
      </div>

      {/* Recent Transactions */}
      <div className="card">
        <h2 className="mb-3 border-b border-slate-100 pb-2 font-bold text-slate-800">آخرین تراکنش‌های POS</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs rt">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="pb-2">STAN</th>
                <th className="pb-2">RRN</th>
                <th className="pb-2">مبلغ</th>
                <th className="pb-2">نوع</th>
                <th className="pb-2">روش کارت</th>
                <th className="pb-2">وضعیت</th>
                <th className="pb-2">ترمینال</th>
                <th className="pb-2">دانشجو</th>
                <th className="pb-2">زمان</th>
              </tr>
            </thead>
            <tbody>
              {recentTxns.map((tx) => (
                <tr key={tx.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-mono text-slate-700">{tx.stan}</td>
                  <td className="py-2 font-mono text-slate-600">{tx.rrn ?? '—'}</td>
                  <td className="py-2 font-bold text-slate-800">{fa(Number(tx.amount))} ریال</td>
                  <td className="py-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-3xs font-medium ${
                      tx.txnType === 'SALE' ? 'bg-emerald-50 text-emerald-700' :
                      tx.txnType === 'REFUND' ? 'bg-amber-50 text-amber-700' :
                      'bg-rose-50 text-rose-700'
                    }`}>{tx.txnType}</span>
                  </td>
                  <td className="py-2 text-slate-600">{tx.entryMode}</td>
                  <td className="py-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-3xs font-medium ${
                      tx.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' :
                      tx.status === 'VOIDED' ? 'bg-rose-50 text-rose-700' :
                      'bg-slate-50 text-slate-700'
                    }`}>{tx.status}</span>
                  </td>
                  <td className="py-2 text-slate-600">{tx.terminalTitle} ({tx.terminalCode})</td>
                  <td className="py-2 text-slate-600">{tx.studentCode} - {tx.studentName}</td>
                  <td className="py-2 text-2xs text-slate-500">{new Date(tx.createdAt ?? 0).toLocaleString('fa-IR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
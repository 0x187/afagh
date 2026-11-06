'use client';

import { useState } from 'react';
import { recordPosSale, voidPosTransaction, getPosTransactions } from '@/lib/pos-actions';

type Terminal = {
  id: number;
  code: string;
  title: string;
  location: string | null;
  gatewayId: number;
  terminalId: string;
  merchantId: string;
  config: unknown;
  lastHeartbeatAt: Date | string | null;
  firmwareVersion: string | null;
};

const fa = (n: number) => Number(n || 0).toLocaleString('fa-IR');

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500';
const labelCls = 'flex flex-col gap-1 text-2xs font-medium text-slate-600';
const btnCls = 'rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50';
const dangerBtn = 'rounded-lg bg-rose-600 hover:bg-rose-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50';

interface Props {
  terminal: Terminal;
  universityId: number;
}

export default function PosTerminalClient({ terminal, universityId }: Props) {
  const [tab, setTab] = useState<'sale' | 'void' | 'history'>('sale');
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<unknown[]>([]);

  const [saleForm, setSaleForm] = useState({
    studentCode: '',
    amount: '',
    stan: '',
    rrn: '',
    authorizationRef: '',
    entryMode: 'CHIP' as const,
    cardPan: '',
    cardholderName: '',
    description: '',
  });
  const [voidStan, setVoidStan] = useState('');
  const [voidReason, setVoidReason] = useState('');

  async function loadHistory() {
    const txns = await getPosTransactions({ terminalCode: terminal.code, limit: 20 });
    setHistory(txns);
  }

  async function handleSale(e: React.FormEvent) {
    e.preventDefault();
    if (!saleForm.studentCode || !saleForm.amount || !saleForm.stan || !saleForm.cardPan) {
      setMsg({ ok: false, text: 'تمام فیلدهای ستاره‌دار الزامی هستند' });
      return;
    }
    setPending(true);
    setMsg(null);
    try {
      const r = await recordPosSale({
        terminalCode: terminal.code,
        studentCode: saleForm.studentCode.trim(),
        amount: Number(saleForm.amount),
        stan: saleForm.stan.trim(),
        rrn: saleForm.rrn.trim() || undefined,
        authorizationRef: saleForm.authorizationRef.trim(),
        entryMode: saleForm.entryMode,
        cardPan: saleForm.cardPan.replace(/\D/g, ''),
        cardholderName: saleForm.cardholderName.trim() || undefined,
        description: saleForm.description.trim() || undefined,
      });
      if (r.ok) {
        setMsg({ ok: true, text: `✅ پرداخت ${fa(Number(saleForm.amount))} ریال با موفقیت ثبت شد` });
        setSaleForm({ ...saleForm, studentCode: '', amount: '', stan: '', rrn: '', authorizationRef: '', cardPan: '', cardholderName: '', description: '' });
        loadHistory();
      } else {
        setMsg({ ok: false, text: 'خطا در ثبت پرداخت' });
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'خطای ناشناخته' });
    } finally {
      setPending(false);
    }
  }

  async function handleVoid() {
    if (!voidStan || !voidReason) {
      setMsg({ ok: false, text: 'STAN و دلیل ویدی الزامی هستند' });
      return;
    }
    setPending(true);
    setMsg(null);
    try {
      const r = await voidPosTransaction(terminal.code, voidStan.trim(), voidReason.trim());
      if (r.ok) {
        setMsg({ ok: true, text: `✅ تراکنش ${voidStan} با موفقیت وید شد` });
        setVoidStan('');
        setVoidReason('');
        loadHistory();
      } else {
        setMsg({ ok: false, text: 'خطا در ویدی تراکنش' });
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'خطای ناشناخته' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-slate-100 pb-2">
        {(['sale', 'void', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); if (t === 'history') loadHistory(); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {t === 'sale' && '💳 فروش'}, {t === 'void' && '↩️ ویدی'}, {t === 'history' && '📋 تاریخچه'}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span className="font-medium text-slate-700">{terminal.title}</span>
        <span className={terminal.lastHeartbeatAt ? 'text-emerald-600' : 'text-rose-600'}>
          {terminal.lastHeartbeatAt ? `🟢 آنلاین (${new Date(terminal.lastHeartbeatAt).toLocaleString('fa-IR')})` : '🔴 آفلاین'}
        </span>
      </div>
      <p className="text-2xs text-slate-500">مکان: {terminal.location ?? 'تعیین نشده'} | TID: {terminal.terminalId} | MID: {terminal.merchantId}</p>

      {msg && (
        <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {msg.text}
        </p>
      )}

      {/* ═══ فروش ═══ */}
      {tab === 'sale' && (
        <form onSubmit={handleSale} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={labelCls}>
              شماره دانشجویی *
              <input name="studentCode" value={saleForm.studentCode} onChange={e => setSaleForm({ ...saleForm, studentCode: e.target.value })} placeholder="مثال: 4021050123" className={inputCls} />
            </label>
            <label className={labelCls}>
              مبلغ (ریال) *
              <input name="amount" type="number" min={1000} value={saleForm.amount} onChange={e => setSaleForm({ ...saleForm, amount: e.target.value })} placeholder="مثال: 5000000" className={inputCls} />
            </label>
            <label className={labelCls}>
              STAN (شماره پیگیری ترمینال) *
              <input name="stan" value={saleForm.stan} onChange={e => setSaleForm({ ...saleForm, stan: e.target.value })} placeholder="مثال: 123456" className={inputCls} />
            </label>
            <label className={labelCls}>
              RRN (شماره مرجع بانک)
              <input name="rrn" value={saleForm.rrn} onChange={e => setSaleForm({ ...saleForm, rrn: e.target.value })} placeholder="اختیاری" className={inputCls} />
            </label>
            <label className={labelCls}>
              کد تأیید بانک (Authorization) *
              <input name="authorizationRef" value={saleForm.authorizationRef} onChange={e => setSaleForm({ ...saleForm, authorizationRef: e.target.value })} placeholder="۶ تا ۴۰ کاراکتر" className={inputCls} />
            </label>
            <label className={labelCls}>
              روش ورود کارت *
              <select value={saleForm.entryMode} onChange={e => setSaleForm({ ...saleForm, entryMode: e.target.value as any })} className={inputCls}>
                <option value="CHIP">🔑 تراشه (Chip/PIN)</option>
                <option value="CONTACTLESS">📶 بی‌تماس (Contactless)</option>
                <option value="MAGSTRIPE">🧲 نوار مغناطیسی</option>
                <option value="FALLBACK">⚠️ فِل‌بک (Chip خراب)</option>
                <option value="MANUAL">⌨️ دستی (Manual Entry)</option>
              </select>
            </label>
            <label className={labelCls}>
              شماره کارت (ماسک می‌شود) *
              <input name="cardPan" value={saleForm.cardPan} onChange={e => setSaleForm({ ...saleForm, cardPan: e.target.value })} placeholder="6219861234567890" className={inputCls} />
            </label>
            <label className={`${labelCls} sm:col-span-2`}>
              نام کارت‌دار
              <input name="cardholderName" value={saleForm.cardholderName} onChange={e => setSaleForm({ ...saleForm, cardholderName: e.target.value })} placeholder="اختیاری" className={inputCls} />
            </label>
            <label className={`${labelCls} sm:col-span-2`}>
              توضیحات
              <input name="description" value={saleForm.description} onChange={e => setSaleForm({ ...saleForm, description: e.target.value })} placeholder="مثال: شهریه ترم ۱۴۰۲۱" className={inputCls} />
            </label>
          </div>
          <button type="submit" disabled={pending} className={`${btnCls} w-full sm:w-auto`}>
            {pending ? '⏳ در حال ثبت...' : '✅ ثبت پرداخت'}
          </button>
        </form>
      )}

      {/* ═══ ویدی ═══ */}
      {tab === 'void' && (
        <form onSubmit={e => { e.preventDefault(); handleVoid(); }} className="space-y-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-800 mb-3">⚠️ ویدی تراکنش: مبلغ از حساب دانشجو کسر و تراکنش اصلی باطل می‌شود. فقط در همان روز و با مجوز مدیر صندوق انجام دهید.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={labelCls}>
                STAN تراکنش اصلی *
                <input name="voidStan" value={voidStan} onChange={e => setVoidStan(e.target.value)} placeholder="STAN تراکنش قبلی" className={inputCls} />
              </label>
              <label className={labelCls}>
                دلیل ویدی *
                <input name="voidReason" value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="مثال: خطای مبلغ، انصراف دانشجو" className={inputCls} />
              </label>
            </div>
            <button type="submit" disabled={pending} className={`${dangerBtn} w-full sm:w-auto`}>
              {pending ? '⏳ در حال ویدی...' : '↩️ ویدی تراکنش'}
            </button>
          </div>
        </form>
      )}

      {/* ═══ تاریخچه ═══ */}
      {tab === 'history' && (
        <div className="space-y-3">
          <button onClick={loadHistory} disabled={pending} className="rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">
            {pending ? '⏳ بارگذاری...' : '🔄 بارگذاری مجدد'}
          </button>
          {history.length === 0 ? (
            <p className="text-center text-slate-500 py-4 text-xs">تراکنشی یافت نشد</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-2xs rt">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <th className="pb-1">STAN</th>
                    <th className="pb-1">مبلغ</th>
                    <th className="pb-1">نوع</th>
                    <th className="pb-1">روش</th>
                    <th className="pb-1">وضعیت</th>
                    <th className="pb-1">دانشجو</th>
                    <th className="pb-1">زمان</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((tx: any) => (
                    <tr key={tx.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-1 font-mono text-slate-700">{tx.stan}</td>
                      <td className="py-1 font-bold text-slate-800">{fa(Number(tx.amount))}</td>
                      <td className="py-1">
                        <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-medium ${
                          tx.txnType === 'SALE' ? 'bg-emerald-50 text-emerald-700' :
                          tx.txnType === 'REFUND' ? 'bg-amber-50 text-amber-700' :
                          'bg-rose-50 text-rose-700'
                        }`}>{tx.txnType}</span>
                      </td>
                      <td className="py-1 text-slate-600">{tx.entryMode}</td>
                      <td className="py-1">
                        <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-medium ${
                          tx.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' :
                          'bg-rose-50 text-rose-700'
                        }`}>{tx.status}</span>
                      </td>
                      <td className="py-1 text-slate-600">{tx.studentCode}</td>
                      <td className="py-1 text-slate-500">{new Date(tx.createdAt).toLocaleTimeString('fa-IR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
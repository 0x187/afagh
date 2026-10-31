import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenCheck, ImageIcon, KeyRound, Link2, Megaphone, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet, apiPost } from '@/lib/api';
import { faNumber } from '@/lib/fa';

// ═══ صفحات کوچک باقیمانده: code-hub، student-finance، login-showcase ═══

// ─── code-hub: لانچر دو مرکز کد ───

export function AdminCodeHubPage() {
  const links = [
    { href: '/admin/codes', icon: KeyRound, title: 'مرکز کدها', desc: 'تعریف و بازبینی کد دانشکده، گروه، رشته، مقطع و درس', tone: 'from-amber-950 to-slate-950 border-amber-700/50' },
    { href: '/admin/grade-status-codes', icon: BookOpenCheck, title: 'مدیریت دروس و کدهای وضعیت نمره', desc: 'تعریف، ویرایش و کدگذاری وضعیت نمره دروس بانک و چارت', tone: 'from-orange-950 to-slate-950 border-orange-700/50' },
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-black">🔑 مرکز کدها</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {links.map((l) => {
          const Icon = l.icon;
          return (
            <Link key={l.href} to={l.href} className={`rounded-2xl border bg-gradient-to-br p-5 text-white transition hover:-translate-y-0.5 hover:shadow-lg ${l.tone}`}>
              <Icon className="mb-2 size-8" aria-hidden />
              <h2 className="text-sm font-black">{l.title}</h2>
              <p className="mt-1 text-[11px] text-white/70">{l.desc}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─── student-finance: دفتر مالی دانشگاه ───

type LedgerRow = {
  id: number; studentCode: string; studentName: string; transactionType: string;
  amount: number; description: string | null; termCode: string | null; createdAt: string | null;
};

const TX_FA: Record<string, string> = {
  TUITION_CHARGE: 'شارژ شهریه', CHARGE: 'بدهی', PAYMENT: 'پرداخت', CREDIT: 'بستانکاری',
  TUITION_FIXED: 'شهریه ثابت', TUITION_VARIABLE: 'شهریه متغیر', SUBJECT_ADDITIVE: 'افزودنی موضوعی',
  SUBJECT_DEDUCTIVE: 'کاهنده موضوعی', POS_PAYMENT: 'پرداخت POS', SPONSORSHIP: 'حامی مالی',
  LOAN: 'وام', TUITION_ADJUST_INC: 'تعدیل افزایشی', TUITION_ADJUST_DEC: 'تعدیل کاهشی',
  POS_REFUND: 'برگشت POS', TUITION_BATES: 'بخشیدن', DISCOUNT_FIXED: 'تخفیف ثابت',
  DISCOUNT_VARIABLE: 'تخفیف متغیر',
};

export function AdminStudentFinancePage() {
  const q = useQuery({
    queryKey: ['student-finance'], staleTime: 20_000,
    queryFn: () => apiGet<{ ok: boolean; data: { rows: LedgerRow[] } }>('/admin/student-finance/ledger').then((r) => r.data),
  });
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت دفتر مالی ناموفق بود.</CardContent></Card>;
  const rows = q.data.rows ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-black">💳 امور مالی دانشجویان (دفتر کل)</h1>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-right text-[11px]">
          <thead className="bg-muted/60 text-muted-foreground"><tr>{['دانشجو', 'نوع تراکنش', 'مبلغ (ریال)', 'شرح', 'ترم', 'زمان'].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border/50">
                <td className="p-2"><b className="font-mono">{r.studentCode}</b> {r.studentName}</td>
                <td className="p-2">{TX_FA[r.transactionType] ?? r.transactionType}</td>
                <td className="p-2 font-mono">{faNumber(Math.round(r.amount))}</td>
                <td className="p-2 text-muted-foreground">{r.description ?? '—'}</td>
                <td className="p-2 font-mono">{r.termCode ?? '—'}</td>
                <td className="p-2 text-[10px]">{r.createdAt?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">تراکنشی یافت نشد.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── login-showcase: ویترین صفحه ورود ───

type LoginNotice = { id: number; title: string; body: string; kind: string; isActive: number; sortOrder: number };
type LoginSlide = { id: number; title: string; subtitle: string; imageUrl: string; linkUrl: string | null; isActive: number; sortOrder: number };

export function AdminLoginShowcasePage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['login-showcase'], staleTime: 15_000,
    queryFn: () => apiGet<{ ok: boolean; data: { notices: LoginNotice[]; slides: LoginSlide[] } }>('/admin/login-showcase').then((r) => r.data),
  });
  const [noticeText, setNoticeText] = useState('');
  const [slide, setSlide] = useState({ title: '', imageUrl: '', linkUrl: '' });
  const [msg, setMsg] = useState('');

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); setMsg(ok); await qc.invalidateQueries({ queryKey: ['login-showcase'] }); } catch (e) { setMsg(e instanceof Error ? e.message : 'خطا'); }
  }

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت ویترین ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-lg font-black"><ImageIcon className="size-5" aria-hidden /> ویترین صفحه ورود</h1>
      {msg ? <p className="rounded-lg border border-border bg-muted/30 p-2 text-xs font-bold">{msg}</p> : null}

      <Card><CardContent className="space-y-2 pt-4">
        <h2 className="text-sm font-black"><Megaphone className="inline size-4" aria-hidden /> اطلاعیه‌ها</h2>
        <div className="flex gap-2">
          <Input value={noticeText} onChange={(e) => setNoticeText(e.target.value)} placeholder="متن اطلاعیه…" className="h-8 flex-1 text-[11px]" />
          <Button size="sm" disabled={!noticeText.trim()} onClick={() => void run(async () => {
            await apiPost('/admin/login-showcase/notice', { text: noticeText.trim() });
            setNoticeText('');
          }, 'اطلاعیه اضافه شد.')}><Plus className="size-4" aria-hidden /></Button>
        </div>
        {(q.data.notices ?? []).map((n) => (
          <div key={n.id} className="flex items-center gap-2 rounded-lg border border-border/60 p-2 text-[11px]">
            <Badge variant={n.isActive ? 'success' : 'secondary'} className="text-[9px]">{n.isActive ? 'فعال' : 'خاموش'}</Badge>
            <span className="flex-1"><b>{n.title}</b> {n.body}</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => void run(() => apiPost('/admin/login-showcase/notice/toggle', { id: n.id, isActive: !n.isActive }), 'وضعیت تغییر کرد.')}>{n.isActive ? 'خاموش' : 'فعال'}</Button>
            <Button size="sm" variant="destructive" className="h-6 px-2" onClick={() => void run(() => apiPost('/admin/login-showcase/notice/delete', { id: n.id }), 'حذف شد.')}><Trash2 className="size-3" aria-hidden /></Button>
          </div>
        ))}
      </CardContent></Card>

      <Card><CardContent className="space-y-2 pt-4">
        <h2 className="text-sm font-black"><ImageIcon className="inline size-4" aria-hidden /> اسلایدها</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <Input value={slide.title} onChange={(e) => setSlide({ ...slide, title: e.target.value })} placeholder="عنوان" className="h-8 text-[11px]" />
          <Input value={slide.imageUrl} onChange={(e) => setSlide({ ...slide, imageUrl: e.target.value })} placeholder="نشانی تصویر" className="h-8 text-[11px]" dir="ltr" />
          <Input value={slide.linkUrl} onChange={(e) => setSlide({ ...slide, linkUrl: e.target.value })} placeholder="لینک (اختیاری)" className="h-8 text-[11px]" dir="ltr" />
          <Button size="sm" disabled={!slide.title.trim() || !slide.imageUrl.trim()} onClick={() => void run(async () => {
            await apiPost('/admin/login-showcase/slide', slide);
            setSlide({ title: '', imageUrl: '', linkUrl: '' });
          }, 'اسلاید اضافه شد.')}><Plus className="size-4" aria-hidden /></Button>
        </div>
        {(q.data.slides ?? []).map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-lg border border-border/60 p-2 text-[11px]">
            <Badge variant={s.isActive ? 'success' : 'secondary'} className="text-[9px]">{s.isActive ? 'فعال' : 'خاموش'}</Badge>
            <span className="flex-1 font-bold">{s.title}</span>
            <Link2 className="size-3 text-muted-foreground" aria-hidden />
            <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{s.imageUrl}</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => void run(() => apiPost('/admin/login-showcase/slide/toggle', { id: s.id, isActive: !s.isActive }), 'وضعیت تغییر کرد.')}>{s.isActive ? 'خاموش' : 'فعال'}</Button>
            <Button size="sm" variant="destructive" className="h-6 px-2" onClick={() => void run(() => apiPost('/admin/login-showcase/slide/delete', { id: s.id }), 'حذف شد.')}><Trash2 className="size-3" aria-hidden /></Button>
          </div>
        ))}
      </CardContent></Card>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive as ArchiveIcon, Check, Download, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  archiveFileUrl, getArchiveDocuments, uploadArchiveDocument, verifyArchiveDoc,
} from '@/lib/admin-api';

// ═══ بایگانی الکترونیک مدارک — پورت admin/archive ═══

const ST_FA: Record<string, string> = { PENDING: 'در انتظار', VERIFIED: 'تأییدشده', REJECTED: 'ردشده' };
const ST_CLS: Record<string, string> = {
  PENDING: 'border-transparent bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  VERIFIED: 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  REJECTED: 'border-transparent bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
};

export function AdminArchivePage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState({ studentUserId: '', categoryId: '', typeId: '' });
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-archive'], queryFn: getArchiveDocuments, staleTime: 15_000 });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-archive'] });
  const uploadMut = useMutation({
    mutationFn: () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error('فایل انتخاب نشده است.');
      return uploadArchiveDocument({
        file,
        studentUserId: Number(form.studentUserId),
        categoryId: Number(form.categoryId),
        typeId: form.typeId ? Number(form.typeId) : undefined,
      });
    },
    onSuccess: (id) => {
      setMsg(`سند #${faNumber(id)} در بایگانی ذخیره شد.`);
      if (fileRef.current) fileRef.current.value = '';
      refresh();
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const verifyMut = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: 'VERIFIED' | 'REJECTED' }) => {
      let reason: string | undefined;
      if (decision === 'REJECTED') reason = window.prompt('دلیل رد سند:') ?? undefined;
      return verifyArchiveDoc(id, decision, reason);
    },
    onSuccess: () => { setMsg('وضعیت سند ثبت شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت بایگانی ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-indigo-900 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-base font-black"><ArchiveIcon className="size-5" aria-hidden /> بایگانی الکترونیک مدارک</h1>
          <p className="mt-0.5 text-xs text-indigo-100">فایل‌ها در MinIO نگهداری می‌شوند؛ دیتابیس فقط کلید و نوع را دارد — مشاهده با هدر واترمارک و نوع محتوای ایمن.</p>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Upload className="size-4" aria-hidden /> بارگذاری سند جدید</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div><Label className="text-[11px]">شناسهٔ کاربر</Label><Input value={form.studentUserId} onChange={(e) => setForm({ ...form, studentUserId: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" placeholder="userId" /></div>
          <div><Label className="text-[11px]">دسته</Label>
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
              <option value="">—</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <div><Label className="text-[11px]">نوع</Label>
            <select value={form.typeId} onChange={(e) => setForm({ ...form, typeId: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
              <option value="">—</option>
              {data.types.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>
          <div><Label className="text-[11px]">فایل (حداکثر ۱۰MB)</Label><input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="mt-1 block h-8 w-full text-[11px]" /></div>
          <div className="flex items-end">
            <Button size="sm" disabled={uploadMut.isPending || !form.studentUserId || !form.categoryId} onClick={() => uploadMut.mutate()}>
              <Upload className="size-4" aria-hidden /> بارگذاری
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto pt-4">
          <table className="w-full border-collapse text-right text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                <th className="p-2">فایل</th><th className="p-2">دانشجو</th><th className="p-2">دسته/نوع</th>
                <th className="p-2">وضعیت</th><th className="p-2">بارگذاری</th><th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">سندی در بایگانی نیست.</td></tr>
              ) : data.rows.map((r) => (
                <tr key={r.id} className="border-b border-border/40 last:border-0">
                  <td className="p-2">
                    <a href={archiveFileUrl(r.id)} target="_blank" rel="noreferrer" className="font-bold text-indigo-700 underline underline-offset-4 dark:text-indigo-300">{r.fileName}</a>
                    <div className="text-[10px] text-muted-foreground" dir="ltr">{r.mimeType ?? '—'}</div>
                  </td>
                  <td className="p-2">{r.student}<div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{r.nationalCode ? faDigits(r.nationalCode) : '—'}</div></td>
                  <td className="p-2">{r.category}{r.type !== '—' ? <div className="text-[10px] text-muted-foreground">{r.type}</div> : null}</td>
                  <td className="p-2">
                    <Badge className={ST_CLS[r.status] ?? ''}>{ST_FA[r.status] ?? r.status}</Badge>
                    {r.reason ? <div className="text-[10px] text-rose-600 dark:text-rose-300">{r.reason}</div> : null}
                  </td>
                  <td className="p-2 font-mono text-[10px]" dir="ltr">{r.uploadedAt ? faDigits(r.uploadedAt.slice(0, 10)) : '—'}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" className="h-6 px-1.5" onClick={() => window.open(archiveFileUrl(r.id), '_blank', 'noopener,noreferrer')}><Download className="size-3" aria-hidden /></Button>
                      {r.status !== 'VERIFIED' ? <Button size="sm" className="h-6 bg-emerald-700 px-1.5 text-white hover:bg-emerald-800" disabled={verifyMut.isPending} onClick={() => verifyMut.mutate({ id: r.id, decision: 'VERIFIED' })}><Check className="size-3" aria-hidden /></Button> : null}
                      {r.status !== 'REJECTED' ? <Button size="sm" variant="outline" className="h-6 px-1.5 text-rose-700" disabled={verifyMut.isPending} onClick={() => verifyMut.mutate({ id: r.id, decision: 'REJECTED' })}><X className="size-3" aria-hidden /></Button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

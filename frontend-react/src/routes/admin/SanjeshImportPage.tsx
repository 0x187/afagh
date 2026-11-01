import { useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { faNumber } from '@/lib/fa';
import { commitSanjesh, previewSanjesh, type SanjeshCommitResult, type SanjeshPreview } from '@/lib/sanjesh-api';

// ═══ Import of previous majors from the Sanjesh fixed-width file — port of admin/sanjesh-import ═══

const DEFAULT_STRUCTURE = JSON.stringify([
  { name: 'nationalCode', start: 0, length: 10, target: 'nationalCode' },
  { name: 'studentCode', start: 10, length: 14, target: 'studentCode' },
  { name: 'previousMajorCode', start: 120, length: 6, target: 'previousMajorCode' },
  { name: 'previousMajorTitle', start: 126, length: 40, target: 'previousMajorTitle' },
], null, 2);

export function AdminSanjeshImportPage() {
  const [structure, setStructure] = useState(DEFAULT_STRUCTURE);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SanjeshPreview | null>(null);
  const [result, setResult] = useState<SanjeshCommitResult | null>(null);
  const [error, setError] = useState('');
  const [fileKey, setFileKey] = useState(0);

  const previewMut = useMutation({
    mutationFn: () => previewSanjesh(structure, file as File),
    onMutate: () => { setError(''); setResult(null); },
    onSuccess: (r) => setPreview(r),
    onError: (e: Error) => setError(e.message),
  });
  const commitMut = useMutation({
    mutationFn: () => commitSanjesh(structure, file as File),
    onMutate: () => { setError(''); setPreview(null); },
    onSuccess: (r) => setResult(r),
    onError: (e: Error) => setError(e.message),
  });

  function runCommit() {
    if (!window.confirm('آیا از ثبت اطلاعات رشتهٔ قبلی برای دانشجویان اطمینان دارید؟')) return;
    commitMut.mutate();
  }

  const pending = previewMut.isPending || commitMut.isPending;
  const headers = preview?.sample.length ? Object.keys(preview.sample[0]) : [];

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-900 via-sky-950 to-slate-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black"><FileSpreadsheet className="size-5" aria-hidden /> درون‌ریزی رشتهٔ قبلی از فایل سنجش</h1>
          <p className="mt-2 text-xs leading-6 text-sky-100/80">ساختار ستون‌های فایل سنجش (JSON) را وارد کنید و فایل ثابت‌عرض را بارگذاری کنید. سیستم بر اساس کد ملی یا شمارهٔ دانشجویی، دانشجو را پیدا کرده و رشتهٔ قبلی، عنوان و نسبت آن را ثبت می‌کند. نسبت خودکار پیشنهاد می‌شود و در صفحهٔ «دانشجویان جبرانی» قابل اصلاح است.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <label className="block space-y-1 text-[10px] font-bold text-muted-foreground">
            <span>ساختار ستون‌ها (JSON)</span>
            <textarea value={structure} onChange={(e) => setStructure(e.target.value)} rows={12} dir="ltr" className="w-full rounded-lg border border-input bg-card px-2 py-1.5 font-mono text-[11px]" />
          </label>
          <label className="block space-y-1 text-[10px] font-bold text-muted-foreground">
            <span>فایل داده (ثابت‌عرض)</span>
            <input key={fileKey} type="file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); }} className="text-xs" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || !file} onClick={() => previewMut.mutate()}><Upload className="size-4" aria-hidden /> {previewMut.isPending ? 'در حال پیش‌نمایش…' : 'پیش‌نمایش'}</Button>
            <Button size="sm" variant="outline" disabled={pending || !file} onClick={runCommit}>{commitMut.isPending ? 'در حال ثبت…' : 'ثبت در سیستم'}</Button>
            {file ? <button type="button" className="text-[10px] text-muted-foreground hover:underline" onClick={() => { setFile(null); setFileKey((k) => k + 1); setPreview(null); setResult(null); }}>حذف فایل</button> : null}
          </div>
        </CardContent>
      </Card>

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">{error}</p> : null}

      {preview ? (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-sm font-black">پیش‌نمایش ({faNumber(preview.count)} رکورد)</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-[10px]">
                <thead className="bg-muted/60 text-muted-foreground"><tr>{headers.map((h) => <th key={h} className="p-1 font-black">{h}</th>)}</tr></thead>
                <tbody>
                  {preview.sample.map((r, i) => (
                    <tr key={i} className="border-t border-border/50">{headers.map((h) => <td key={h} className="p-1 font-mono" dir="ltr">{r[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          {faNumber(result.updated)} دانشجو به‌روزرسانی شد، {faNumber(result.notFound)} یافت نشد (از {faNumber(result.total)} رکورد).
        </div>
      ) : null}
    </div>
  );
}

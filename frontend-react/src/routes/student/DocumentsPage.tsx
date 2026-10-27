import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText, FolderOpen } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits } from '@/lib/fa';
import { getStudentDocuments } from '@/lib/student-api';

// ═══ مدارک من — پورت student/documents ═══
const STATUS_FA: Record<string, string> = {
  PENDING: 'در انتظار بررسی',
  VERIFIED: 'تأییدشده',
  REJECTED: 'ردشده',
};

const STATUS_CLASS: Record<string, string> = {
  PENDING: 'border-transparent bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  VERIFIED: 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  REJECTED: 'border-transparent bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200',
};

function faDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  } catch {
    return faDigits(value.slice(0, 10));
  }
}

export function StudentDocumentsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-documents'],
    queryFn: getStudentDocuments,
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 shadow-xs">
        <span className="flex size-9 items-center justify-center rounded-xl bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <FolderOpen className="size-4" aria-hidden />
        </span>
        <div>
          <h1 className="text-sm font-bold">مدارک من</h1>
          <p className="text-[11px] text-muted-foreground">مشاهدهٔ فایل از طریق لینک امضاشدهٔ موقت؛ خود فایل در Object Storage نگهداری می‌شود.</p>
        </div>
      </div>

      {isError ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت مدارک ناموفق بود.</CardContent></Card>
      ) : (data ?? []).length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">مدرکی بارگذاری نکرده‌اید.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {(data ?? []).map((d) => (
            <Card key={d.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <FileText className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{d.type ?? d.category ?? 'مدرک'}</p>
                    <p className="text-[11px] text-muted-foreground">{faDate(d.uploadedAt)}</p>
                    {d.status === 'REJECTED' && d.reason ? (
                      <p className="text-[11px] text-red-600 dark:text-red-400">دلیل رد: {d.reason}</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_CLASS[d.status] ?? STATUS_CLASS.PENDING}>{STATUS_FA[d.status] ?? d.status}</Badge>
                  <a
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-bold text-foreground transition hover:bg-muted"
                    href={`/api/archive/${d.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    مشاهده <ExternalLink className="size-3" aria-hidden />
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

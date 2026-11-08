import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, Download, FolderArchive, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  backupDownloadUrl,
  backupStatusLabels,
  formatBackupSize,
  listBackupJobs,
  startBackupJob,
  verifyBackupJob,
  type BackupJob,
} from '@/lib/backup-api';

// Backup/DR desk — port of the backup tab of the Next admin settings page.
// ADMIN only (enforced server-side); jobs poll every 2s while something runs.

const statusVariant: Record<BackupJob['status'], 'secondary' | 'success' | 'destructive'> = {
  running: 'secondary',
  done: 'success',
  failed: 'destructive',
};

function progressLine(j: BackupJob): string {
  if (j.status !== 'running') return '';
  if (j.kind === 'files') {
    return j.objects ? ` — شیء ${j.objectsDone ?? 0} از ${j.objects}` : ' — در حال فهرستبرداری…';
  }
  return j.tables ? ` — جدول ${j.tablesDone ?? 0} از ${j.tables}` : ' — در حال آمادهسازی…';
}

export function AdminBackupPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [verifies, setVerifies] = useState<Record<string, { valid: boolean; error?: string }>>({});

  const { data: jobs, isLoading } = useQuery({
    queryKey: ['admin-backup-jobs'],
    queryFn: listBackupJobs,
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'running') ? 2000 : 15000),
  });

  const startMut = useMutation({
    mutationFn: startBackupJob,
    onSuccess: () => {
      setMsg('پشتیبانگیری آغاز شد؛ در پایان میتوانید دانلود کنید.');
      void qc.invalidateQueries({ queryKey: ['admin-backup-jobs'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const verifyMut = useMutation({
    mutationFn: (jobId: string) => verifyBackupJob(jobId).then((r) => ({ jobId, ...r })),
    onSuccess: (r) => setVerifies((v) => ({ ...v, [r.jobId]: { valid: r.valid, error: r.error } })),
  });

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-zinc-800 to-slate-700 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-base font-black">
            <DatabaseBackup className="size-5" aria-hidden /> پشتیبان‌گیری و بازیابی (DR)
          </h1>
          <p className="mt-0.5 text-xs text-zinc-200">
            دامپ SQL جریانی با ساختار کامل و امضای HMAC — بازیابی با
            <code className="mx-1 rounded bg-white/10 px-1 text-xs" dir="ltr">gunzip -c file.sql.gz | psql -U afagh -d afagh_db</code>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={startMut.isPending} onClick={() => startMut.mutate({ includeFiles: false })}>
              پشتیبان دیتابیس
            </Button>
            <Button size="sm" variant="secondary" disabled={startMut.isPending} onClick={() => startMut.mutate({ includeFiles: true })}>
              <FolderArchive className="size-4" aria-hidden /> دیتابیس + بکاپ فایل‌ها (MinIO)
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={startMut.isPending}
              onClick={() => startMut.mutate({ includeFiles: false, includeSecrets: true })}
            >
              پشتیبان کامل (با رازها)
            </Button>
          </div>
          {msg && <p className="mt-2 text-xs text-zinc-100">{msg}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">کارهای پشتیبانگیری</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>}
          {!isLoading && !jobs?.length && (
            <p className="text-sm text-muted-foreground">هنوز پشتیبانی ساخته نشده است.</p>
          )}
          {jobs?.map((j) => (
            <div key={j.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-xs">
              <Badge variant={statusVariant[j.status]}>{backupStatusLabels[j.status]}</Badge>
              <span className="font-medium">{j.kind === 'files' ? 'فایل‌ها (MinIO)' : 'دیتابیس'}</span>
              <span dir="ltr" className="text-muted-foreground">{new Date(j.startedAt).toLocaleString('fa-IR')}</span>
              <span className="text-muted-foreground">
                {formatBackupSize(j.size)}
                {progressLine(j)}
              </span>
              {j.includeSecrets && <Badge variant="warning">کامل (بدون ردکشن)</Badge>}
              {j.error && <span className="text-destructive">{j.error}</span>}
              <span className="ms-auto flex gap-1.5">
                {j.status === 'done' && (
                  <>
                    <Button size="sm" variant="outline" asChild>
                      <a href={backupDownloadUrl(j.id)} download>
                        <Download className="size-4" aria-hidden /> دانلود
                      </a>
                    </Button>
                    <Button size="sm" variant="outline" disabled={verifyMut.isPending} onClick={() => verifyMut.mutate(j.id)}>
                      <ShieldCheck className="size-4" aria-hidden /> تأیید امضا
                    </Button>
                  </>
                )}
              </span>
              {verifies[j.id] && (
                <span className={verifies[j.id].valid ? 'text-success' : 'text-destructive'}>
                  {verifies[j.id].valid ? 'امضا معتبر است.' : verifies[j.id].error || 'امضا معتبر نیست.'}
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

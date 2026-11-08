// ═══ Backup/DR client — Go backend (port of the Next backup actions) ═══
import { apiGet, apiPost } from './api';

export type BackupJobStatus = 'running' | 'done' | 'failed';
export type BackupJobKind = 'db' | 'files';

export type BackupJob = {
  id: string;
  kind: BackupJobKind;
  startedAt: string;
  includeSecrets: boolean;
  status: BackupJobStatus;
  tables?: number;
  tablesDone?: number;
  objects?: number;
  objectsDone?: number;
  size?: number;
  sha256?: string;
  error?: string;
};

export type StartBackupOptions = {
  /** also bundle the MinIO archive bucket into a .tar.gz job */
  includeFiles?: boolean;
  /** full backup: skip secret redaction (admin only) */
  includeSecrets?: boolean;
};

export async function startBackupJob(opts: StartBackupOptions): Promise<{ jobId: string; filesJobId?: string }> {
  const res = await apiPost<{ ok: boolean; jobId: string; filesJobId?: string }>('/admin/backup/start', opts);
  return { jobId: res.jobId, filesJobId: res.filesJobId };
}

export async function getBackupJob(jobId: string): Promise<BackupJob> {
  const res = await apiGet<{ ok: boolean; job: BackupJob }>(`/admin/backup/status/${jobId}`);
  return res.job;
}

export async function listBackupJobs(): Promise<BackupJob[]> {
  const res = await apiGet<{ ok: boolean; jobs: BackupJob[] }>('/admin/backup/list');
  return res.jobs ?? [];
}

/** Direct browser download of the gzip artifact (session cookie travels along). */
export function backupDownloadUrl(jobId: string): string {
  return `/api/v2/admin/backup/download/${jobId}`;
}

export async function verifyBackupJob(jobId: string): Promise<{ valid: boolean; error?: string }> {
  return apiPost<{ ok: boolean; valid: boolean; error?: string }>(`/admin/backup/verify/${jobId}`);
}

export function formatBackupSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const backupStatusLabels: Record<BackupJobStatus, string> = {
  running: 'در حال اجرا',
  done: 'آماده',
  failed: 'ناموفق',
};

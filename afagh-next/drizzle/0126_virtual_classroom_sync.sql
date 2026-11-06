-- ────────────────────────────────────────────────────────────────────────
--  همگام‌سازی کلاس‌های آنلاین با بیگ‌بلوباتن.
--  lastSyncedAt: آخرین خواندن وضعیت از سرور BBB
--  lastRunningAt: آخرین زمانی که جلسه «در حال برگزاری» دیده شد
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "virtual_classrooms" ADD COLUMN IF NOT EXISTS "lastSyncedAt" timestamp;
--> statement-breakpoint
ALTER TABLE "virtual_classrooms" ADD COLUMN IF NOT EXISTS "lastRunningAt" timestamp;

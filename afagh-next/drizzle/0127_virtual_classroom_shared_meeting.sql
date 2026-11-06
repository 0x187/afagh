-- ────────────────────────────────────────────────────────────────────────
--  کلاس آنلاین «ادغامی»: یک جلسهٔ فیزیکی/مجازی، چند عرضه.
--
--  پیش‌تر bbbMeetingId یکتا بود، پس نمی‌شد یک جلسهٔ BBB را به چند عرضه
--  (کلاس ادغامی) وصل کرد و استاد مجبور بود هر گروه را جدا تعریف کند.
--  با حذف این قید، هر عضوِ گروه ادغامی ردیف خودش را دارد ولی همه به همان
--  meetingId اشاره می‌کنند؛ دانشجوی هر عرضه کلاس را می‌بیند و یک اتاق است.
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "virtual_classrooms" DROP CONSTRAINT IF EXISTS "virtual_classrooms_bbbMeetingId_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "virtual_classrooms_bbbMeetingId_unique";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "virtual_classrooms_meeting_idx" ON "virtual_classrooms" ("bbbMeetingId");

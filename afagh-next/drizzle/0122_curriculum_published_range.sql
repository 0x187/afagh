-- ────────────────────────────────────────────────────────────────────────
--  چارت باید «از ورودی تا ورودی» باشد، نه یکی برای همیشه.
--
--  قید قدیمی فقط یک نسخهٔ PUBLISHED به ازای (رشته، مقطع، گرایش) اجازه می‌داد؛
--  پس اگر سرفصل بعد از دو سال عوض می‌شد، نسخهٔ دومِ همان رشته با خطای
--  «duplicate key value violates unique constraint uq_curriculum_versions_published»
--  رد می‌شد — و همین، علتِ خطای انتقال چارت بود.
--
--  قید جدید بازهٔ ورودی را هم داخل کلید می‌آورد:
--    (majorId, degreeLevelId, trackId, entryYearFrom, entryYearTo)
--  «تا ورودی» خالی = به‌بعد؛ با 9999 معادل‌سازی می‌شود تا NULL کلید را نشکند.
-- ────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "uq_curriculum_versions_published";
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_curriculum_versions_published_range"
  ON "curriculum_versions" USING btree (
    "majorId", "degreeLevelId", coalesce("trackId", 0),
    "entryYearFrom", coalesce("entryYearTo", 9999)
  )
  WHERE "status" = 'PUBLISHED';

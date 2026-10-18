-- 媒體分組清單：分組與媒體的整數版本（樂觀鎖）。只加欄位，不改既有資料；可重複執行。
-- 既有分組的成員（body.mediaIds）、名稱、ID 全部保留。
--
-- 回復：ALTER TABLE media_library_items DROP COLUMN IF EXISTS row_version;
ALTER TABLE media_library_items ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

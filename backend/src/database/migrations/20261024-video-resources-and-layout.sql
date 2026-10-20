-- 影像資源管理與即時影像監控重整（依 document/影像監控標籤頁與歷史錄影_Claude_Code實作指示.md）
--
-- 1. 錄影改以來源為準：video_sources.recording_enabled（新來源預設 true）。
--    既有來源依舊格子算出原本的保存意圖回填：有效格子中任一 recording_requested AND enabled → true，
--    沒有任何有效格子 → false。避免升級後突然替從未要求錄影的來源開錄；之後由使用者在來源對話框勾選。
--    enabled=false 的來源同樣保留算出的意圖，實際是否錄影仍受 enabled 控制。
-- 2. 來源分類標籤：video_sources.tags（字串陣列，最多 10 個）；既有來源設為 []。
-- 3. 一鍵複製的冪等鍵：video_sources.request_id（同一個請求重送不會建立兩份）。
-- 4. 監控版面：每頁保存 canvas_aspect_ratio（初值 16:9）與 layout_schema_version；
--    每格保存 0–10000 正規化整數 x/y/w/h。既有格子依舊 gridColumns 的寬版欄數回填，
--    保留 tileId、sourceId、頁序與頁名。格數範圍外、從未顯示的殘留格子刪除（不影響任何來源或錄影）。
-- 5. 格子位置唯一改為 DEFERRABLE，版面保存可在同一交易內交換位置。
-- 6. video_monitor_tiles.recording_requested／enabled 保留（deprecated），不再影響錄影；確認無呼叫者後另行移除。
--
-- 可重跑：欄位、約束皆以 IF NOT EXISTS／檢查 pg_constraint 處理，回填只處理尚未回填的列。

ALTER TABLE video_sources ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE video_sources ADD COLUMN IF NOT EXISTS recording_enabled boolean;
ALTER TABLE video_sources ADD COLUMN IF NOT EXISTS request_id varchar(80);

UPDATE video_sources s
   SET recording_enabled = COALESCE((
         SELECT bool_or(t.recording_requested AND t.enabled)
           FROM video_monitor_tiles t
           JOIN video_monitor_tabs tb ON tb.id = t.tab_id AND tb.deleted_at IS NULL
          WHERE t.source_id = s.id AND t.position < tb.tile_count
       ), false)
 WHERE s.recording_enabled IS NULL;

ALTER TABLE video_sources ALTER COLUMN recording_enabled SET DEFAULT true;
ALTER TABLE video_sources ALTER COLUMN recording_enabled SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_VIDEO_SOURCE_TAGS') THEN
    ALTER TABLE video_sources ADD CONSTRAINT "CHK_VIDEO_SOURCE_TAGS" CHECK (jsonb_typeof(tags) = 'array' AND jsonb_array_length(tags) <= 10);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_VIDEO_SOURCE_REQUEST" ON video_sources (request_id) WHERE request_id IS NOT NULL;

-- ── 監控版面 ─────────────────────────────────────────────
ALTER TABLE video_monitor_tabs ADD COLUMN IF NOT EXISTS layout_schema_version integer NOT NULL DEFAULT 1;
ALTER TABLE video_monitor_tabs ADD COLUMN IF NOT EXISTS canvas_aspect_ratio numeric(6,4) NOT NULL DEFAULT 1.7778;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_VIDEO_TAB_ASPECT') THEN
    ALTER TABLE video_monitor_tabs ADD CONSTRAINT "CHK_VIDEO_TAB_ASPECT" CHECK (canvas_aspect_ratio BETWEEN 0.25 AND 4);
  END IF;
END $$;

ALTER TABLE video_monitor_tiles ADD COLUMN IF NOT EXISTS x integer;
ALTER TABLE video_monitor_tiles ADD COLUMN IF NOT EXISTS y integer;
ALTER TABLE video_monitor_tiles ADD COLUMN IF NOT EXISTS w integer;
ALTER TABLE video_monitor_tiles ADD COLUMN IF NOT EXISTS h integer;

-- 格數範圍外的殘留格子從未顯示，回填前先清掉
DELETE FROM video_monitor_tiles t USING video_monitor_tabs tb WHERE tb.id = t.tab_id AND t.position >= tb.tile_count;

-- 舊固定欄數：1 格 1 欄、2–4 格 2 欄、5–9 格 3 欄、10–12 格 4 欄（舊版寬螢幕的排法）
WITH grid AS (
  SELECT t.id, t.position,
         CASE WHEN tb.tile_count <= 1 THEN 1 WHEN tb.tile_count <= 4 THEN 2 WHEN tb.tile_count <= 9 THEN 3 ELSE 4 END AS cols,
         tb.tile_count
    FROM video_monitor_tiles t JOIN video_monitor_tabs tb ON tb.id = t.tab_id
   WHERE t.x IS NULL
), cell AS (
  SELECT id, cols, ceil(tile_count::numeric / cols)::int AS rows_n, position % cols AS col, position / cols AS row_i FROM grid
)
UPDATE video_monitor_tiles t
   SET x = floor(c.col * 10000.0 / c.cols)::int,
       w = floor((c.col + 1) * 10000.0 / c.cols)::int - floor(c.col * 10000.0 / c.cols)::int,
       y = floor(c.row_i * 10000.0 / c.rows_n)::int,
       h = floor((c.row_i + 1) * 10000.0 / c.rows_n)::int - floor(c.row_i * 10000.0 / c.rows_n)::int
  FROM cell c
 WHERE c.id = t.id;

ALTER TABLE video_monitor_tiles ALTER COLUMN x SET NOT NULL;
ALTER TABLE video_monitor_tiles ALTER COLUMN y SET NOT NULL;
ALTER TABLE video_monitor_tiles ALTER COLUMN w SET NOT NULL;
ALTER TABLE video_monitor_tiles ALTER COLUMN h SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_VIDEO_TILE_RECT') THEN
    ALTER TABLE video_monitor_tiles ADD CONSTRAINT "CHK_VIDEO_TILE_RECT"
      CHECK (x >= 0 AND y >= 0 AND w >= 500 AND h >= 500 AND x + w <= 10000 AND y + h <= 10000);
  END IF;
  -- 版面保存會在同一交易內調整位置：唯一性改在交易結束時檢查
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_VIDEO_TILE_POSITION' AND NOT condeferrable) THEN
    ALTER TABLE video_monitor_tiles DROP CONSTRAINT "UQ_VIDEO_TILE_POSITION";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_VIDEO_TILE_POSITION') THEN
    ALTER TABLE video_monitor_tiles ADD CONSTRAINT "UQ_VIDEO_TILE_POSITION" UNIQUE (tab_id, position) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

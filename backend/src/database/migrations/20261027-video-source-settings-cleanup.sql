-- 全域影像來源預設與使用者可修改 allowlist 已移除。
-- 逐筆來源、revision、監控版面、錄影與 video_settings 配額均保留。
DROP TABLE IF EXISTS video_source_defaults;

ALTER TABLE IF EXISTS video_settings
  DROP COLUMN IF EXISTS allowed_networks;

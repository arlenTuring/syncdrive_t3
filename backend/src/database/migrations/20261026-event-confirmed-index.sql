-- 舊 IDX_EVENT_ACK_TIME 在部分環境只包含 acknowledged_at 非空列，會漏掉歷史已確認資料。
-- 使用新名稱建立完整的已確認集合索引；不修改已發布 Migration 的 checksum，也不刪舊索引。
CREATE INDEX IF NOT EXISTS "IDX_EVENT_CONFIRMED_TIME"
  ON security_event_logs (acknowledged_at DESC NULLS LAST, id DESC)
  WHERE is_acknowledged = true;

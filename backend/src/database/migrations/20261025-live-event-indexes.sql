-- 事件管理清單：待確認與已確認是兩個獨立、無 24 小時截斷的工作集合。
-- 兩個部分索引分別服務「待確認依嚴重度／發生時間」與「已確認依確認時間」的有界游標查詢；
-- 不改既有欄位或資料，可重跑。
CREATE INDEX IF NOT EXISTS "IDX_EVENT_PENDING_TIME"
  ON security_event_logs (created_at DESC, id DESC)
  WHERE is_acknowledged = false;
CREATE INDEX IF NOT EXISTS "IDX_EVENT_ACK_TIME"
  ON security_event_logs (acknowledged_at DESC, id DESC)
  WHERE is_acknowledged = true;

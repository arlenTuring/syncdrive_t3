# SyncDrive T3 Partner API v4.0 — 2026-09-18

本版含不相容變更：訂單進度只接受大寫；舊圖 station_*／xo_* 改為 T3 現行識別碼。請依本版清單更新車端，勿沿用舊圖座標。

- PMS99：獨立聯測車，不參加正式排班。用原帳密向 auth/token 申請 `vehicle_codes:["PMS99"]`，一次取得 REST 金鑰及 MQTT 憑證。現行共同帳號可申請登錄車號，金鑰本身限制於本次申請的車號；請勿借用其他車號。
- 中心端在本機模擬器「PMS99 發送訂單」選路線／站序、行駛時間、預計開始時間後送出。建立立即可查，預定時間是執行時間。測試車不由模擬器接管。
- 車端先訂閱 `v1/vtms/PMS99/operation/assign`，再查 `GET /order/active?vehicle_code=PMS99`。依 id 去重，必要時用 queryById 取最新內容。
- `PUT /order/updateOrderProgress/{id}?status=PROCESSING`；完成回 END，無法接單可直接 PENDING → FAULTED。相同狀態可重試；不能回到 PENDING。
- order/active 解決不知道訂單 ID 時的漏通知問題。MQTT 維持 QoS 1、非 Retain、應用層不重送，REST 維持真實資料來源。
- 換證不主動撤銷舊憑據或斷線，新舊在各自效期內可重疊使用；重連與換證後立即對帳。
- 班表無對外發布推播，計畫值建議 60 秒輪詢；即時 ETA 依原 15 秒規範。班表異動不直接覆寫已建立／執行中的訂單。
- 新金鑰限申請車號；舊無範圍欄位的金鑰相容 PMS01～PMS11，PMS99 必須重新申請。

完整 HTTP 400／401／403／404 的逐端點原因見 [訂單 API 錯誤與對帳](../訂單API錯誤與對帳.md)。站點座標與全部 14 條路線見 [T3 地圖清單](../T3地圖站點與路線清單.md)，機器可讀資料為 [T3-map-catalog.json](T3-map-catalog.json ':ignore')。

[下載文件 ZIP](SyncDrive-T3-Partner-API-v4.0.zip ':ignore')。ZIP 只含對外介接文件與點位資料，不含帳密、金鑰或私鑰。T3.xodr 沿用已交付的原始圖檔，SHA-256 見清單。

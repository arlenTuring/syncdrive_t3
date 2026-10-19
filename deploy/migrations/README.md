# Migration 依賴表

`order.txt` 是唯一部署順序；下表記錄固定版本實際使用的前置與產物。基礎主檔由舊版
schema 提供，部署前由 `migrate.sh --plan` 唯讀檢查。

| Migration | 前置物件 | 主要產物／變更 | 交易 |
|---|---|---|---|
| `20261008-required-extensions` | 可安裝 extension 的部署資料庫角色 | `uuid-ossp`（可重跑） | runner 單一交易 |
| `20261009-create-degraded-operation-plans` | 無 | 降級計畫、執行、草稿、事件及索引 | runner 單一交易 |
| `20261010-create-degraded-replay` | 前一份的 `degraded_operation_executions` | 回放 session、map、frame、執行時間索引 | runner 單一交易 |
| `20261010-vehicle-model-management` | `vehicle_definitions`、回放 session | 後軸比例、回放模型快照欄位 | runner 單一交易 |
| `20261011-access-control` | `accounts`、`roles`、`permissions`、兩張關聯表；PostgreSQL 內建 `gen_random_uuid()` | session、登入鎖定欄位、FK與索引 | runner 單一交易 |
| `20261012-role-permissions` | 前一份完成型別/FK；角色與權限主檔 | 名稱與關聯唯一索引 | runner 單一交易 |
| `20261013-vehicle-realtime-snapshot` | `vehicle_monitor_demo` | MQTT快照欄位與時間索引 | runner 單一交易 |
| `20261014-vehicle-registration` | `vehicles`；操作稽核 enum 可選 | 里程、服務設定、版本、約束與索引 | SQL 自管交易 |
| `20261015-vehicle-identity-removal` | `vehicles`、註冊欄位；稽核 enum 可選 | 車號長度64、大小寫唯一、移除動作 | SQL 自管交易 |
| `20260917-partner-vehicle-scope` | `partner_api_keys`、`vehicles`；PostgreSQL 內建 `gen_random_uuid()` | 車輛授權範圍與保留聯測身分 | runner 單一交易 |
| `20261015-vehicle-run-history` | 回放 session、`operation_orders`、`order_action_states`及其欄位 | history frame/segment/gap/key、訂單快照函式與觸發器 | runner 單一交易 |
| `20261015-data-retention-management` | 前一份的 `vehicle_history_gaps`、`telemetry_logs` | 保留政策、清理計畫/工作、可信接收時間索引 | runner 單一交易 |
| `20261017-media-group-version` | `media_library_items` | 樂觀鎖版本欄位 | runner 單一交易 |
| `20261018-media-play-schedules` | 前述 `uuid-ossp` | 播放排程、項目、批次、投遞及索引 | runner 單一交易 |
| `20261019-virtual-fence-site-permissions` | `permissions`、`role_permissions` 及其唯一索引（`20261012-role-permissions`） | 虛擬圍籬權限代碼 `operations.virtual-fence.*` 改為 `site.virtual-fence.*`，保留角色授權（可重跑） | runner 單一交易 |
| `20261020-event-and-log-management` | `security_event_logs`、`operator_action_logs`、`permission_change_logs`、`login_logs` | 事件來源／確認欄位、操作紀錄分類與快照（action_type 改 varchar）、權限異動相關帳號角色、查詢索引（可重跑） | runner 單一交易 |

runner 單一交易表示 SQL 與 ledger 成功紀錄一起提交；SQL 自管交易則保留已發布檔案的
`BEGIN/COMMIT`，成功後才另記 ledger，失敗不記錄。

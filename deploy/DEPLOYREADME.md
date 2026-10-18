# GCP 完整同步操作

唯一的使用者入口是 `deploy/sync.sh`。預設目標沿用腳本內的 GCP instance、zone、project，
也可用既有環境變數覆寫；不要再分別執行程式同步與資料同步。

```bash
./deploy/sync.sh                 # 完整同步
./deploy/sync.sh --dry-run       # 只檢查並顯示計畫
./deploy/sync.sh status          # 遠端版本、成功批次與容器狀態
./deploy/sync.sh logs backend    # 後端最近日誌
./deploy/sync.sh health          # 完整健康檢查
./deploy/sync.sh rollback        # 回到上次完整同步前的資料與版本
./deploy/sync.sh --help
```

在 `deploy` 目錄內可使用 `./sync.sh`。`vm.sh` 僅是相容轉接，不再有另一份流程。

## 完整同步順序

1. 檢查本機 Git、遠端連線、容器、磁碟與備份空間，取得遠端部署鎖。
2. 固定 GitHub `main` commit 與本機設定快照，校驗地圖和媒體檔案。
3. 從固定 commit 的乾淨目錄建置映像，不把遠端未追蹤檔帶入映像。
4. 備份 PostgreSQL、`/app/data`、部署設定、Git SHA 與映像標籤。
5. 停止會寫入的 backend/web，以獨立程序執行有順序及 checksum 的 Migration。
6. 以 upsert 同步允許的設定資料，再同步已引用地圖和正式媒體檔。
7. 固定 `DB_SYNCHRONIZE=false` 與成功映像標籤，等待 backend/web 就緒後完整驗收。

建置或資料包驗證失敗時不停止現行服務。進入維護階段後失敗，會保存日誌並從本次
備份恢復資料庫、整個 backend 資料目錄、部署設定與舊映像，再等待並驗收舊版本。

## Migration 與資料邊界

Migration 順序在 `deploy/migrations/order.txt`。`deploy/migrate.sh` 將 migration ID、
SHA-256 與執行時間寫入 `syncdrive_schema_migrations`；重跑會略過相同版本，已執行 SQL
若遭修改則停止。正式環境不使用 TypeORM 自動同步。

同步資料包含儀表板／模組／資料來源、班表／時間模板／整備任務、路線／站點動作／
格位、車輛註冊／模型、速限、媒體內容／分組／播放排程、地圖和適合跨環境的系統設定。
同 ID 更新、新 ID 新增，本機空表略過；不鏡像刪除遠端獨有資料。

以下永不由資料包覆蓋：訂單、遙測、運行歷史、事件／稽核、帳號、角色綁定、Session、
API Key、憑證、最新車況、營運時鐘、執行中每日計畫、調度開關與清理工作狀態。

## 第一次使用

先提交並推送所有影響部署的程式、Migration 與資料表變更，然後執行：

```bash
./deploy/sync.sh --dry-run
./deploy/sync.sh
```

首次升級會在啟動新版前擴充 `vehicles.vehicle_code`、建立註冊欄位（含
`initial_mileage_km`）並完成其餘 ordered migrations，因此不會再把新版資料匯入舊 schema。
若 dry-run 報告本機版本未推送、相關工作目錄未提交、媒體缺檔、checksum 衝突或空間不足，
需先依錯誤修正；腳本不會自動提交、推送或忽略衝突。

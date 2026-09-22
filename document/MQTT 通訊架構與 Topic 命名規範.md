## ## MQTT 通訊架構與 Topic 命名規範

> 目前版：2026-09-22（新增中心端取消訂單：operation/cancel、cancel_requested_at）。站點以 [T3 地圖清單](T3地圖站點與路線清單.md) 為準；訂單新規格見 [錯誤與對帳](訂單API錯誤與對帳.md)。

### 零、 術語與系統定義 (Definitions)
為確保開發邊界對齊，特此定義本系統之縮寫與權責：
* **VTMS (Vehicle & Traffic Management System)**：整體交通管理系統。
* **VTMS Host**：中心管理主機 (ICL 側)，同時為 MQTT Broker 之所在地。
* **SyncDrive（SyncDrive-T3）**：台灣智慧駕駛 (Turing Drive) 開發之**中心端車輛監控系統**，即車輛行車管理（含車輛監控系統），執行於 VTMS Host。
* **Agent**：**安裝於車上**之通訊代理，由車端廠商提供，代表該車與 Broker 通訊，其身分（憑證 CN）即 `vehicle_code`。
* **Scope (規範範疇)**：本協議僅定義 **車端 Agent ↔ VTMS Host** 之通訊。凡資料 Publish 至 Host Broker 後，其內部往 SCADA 等其他子系統之路由由 ICL 端處理。

### 一、 核心 Topic 命名結構

本系統採用 RESTful-like 階層式 Topic 命名結構，以支援通配符 (Wildcard) 訂閱與權限控管 (ACL)：
`{version}/{domain}/{vehicle_code}/{channel}/{action}`

**階層定義與允許值：**
1.  **`{version}` (版本號)**：當前固定為 `v1`。
2.  **`{domain}` (領域/場域)**：當前固定為 `vtms`。
3.  **`{vehicle_code}` (車輛實體)**：
    * **特定車輛**：格式為 `PMS01` ~ `PMS11`（無分隔符號，兩碼數字補零）。
    * **廣播代碼 (Magic Value)**：固定為 `all`。用於中心端對全車隊下發指令。
4.  **`{channel}` (通訊通道)**：對應系統的四大核心協議。
    * `telemetry`：第一類 車輛動態協議
    * `operation`：第二類 營運任務狀態協議
    * `health`：第三類 設備健康與異常告警協議
    * `command`：第四類 動態控制指令 (中心至車端)
    * `event`：第四類 特殊事件上報 (車端至中心)
5.  **`{action}` (行為動作)**：定義該 Topic 的具體操作性質。
    * `update`：持續性的狀態推播
    * `heartbeat`：週期性的健康心跳
    * `execute`：執行指令
    * `ack`：指令確認回覆
    * `report`：突發事件上報
    * `assign`：中心端發車與優先權宣告（搭配 `operation` channel，中心 ➔ 車端，retain: false）
    * `cancel`：中心端取消一張已下發訂單（搭配 `operation` channel，中心 ➔ 車端，retain: false）

---

### 二、 四大協議 Topic 映射對照表

| 協議類別 | 傳輸方向 | 具體 Topic 路徑範例 (以 PMS05 為例) | Retain 設定 |
| :--- | :--- | :--- | :--- |
| **第一類：車輛動態** | 車端 ➔ 中心 | `v1/vtms/PMS05/telemetry/update` | `false` |
| **第二類：營運任務** | 車端 ➔ 中心 | `v1/vtms/PMS05/operation/update` | **`true`** |
| **第三類：設備健康** | 車端 ➔ 中心 | `v1/vtms/PMS05/health/heartbeat` | **`true`** |
| **第二類：訂單取消** | 中心 ➔ 車端 | `v1/vtms/PMS05/operation/cancel` | `false` |
| **第四類：動態控制** | 中心 ➔ 車端 | `v1/vtms/PMS05/command/execute` | `false` |
| **第四類：廣播指令** | 中心 ➔ 車隊 | `v1/vtms/all/command/execute` | `false` |
| **第四類：指令確認** | 車端 ➔ 中心 | `v1/vtms/PMS05/command/ack` | `false` |
| **第四類：特殊事件** | 車端 ➔ 中心 | `v1/vtms/PMS05/event/report` | `false` |

> **Retain 實作規範**：標示為 `true` 者，由 **發布端 (Publisher)** 於發送時設定 `retain=true` 標誌。Broker 會保留最後一筆訊息，確保訂閱者在中斷重連後能立即取得最新狀態。

---

### 三、 實作開發與 ACL 權限規範

1.  **車端 Agent 雙重訂閱責任 (Double Subscription)**：
    為確保全域廣播指令之送達，車端 Agent 實作時必須同時訂閱以下兩個路徑：
    * 自身 ID 路徑：`v1/vtms/{vehicle_code}/#`
    * 全域廣播路徑：`v1/vtms/all/#`
2.  **中心端 (VTMS Host) 訂閱與 Wildcard 應用**：
    * **全車隊聚合 (橫向)**：如 `v1/vtms/+/telemetry/update`，用於 GIS 圖台總覽。
    * **單車全頻道監控 (縱向)**：如 **`v1/vtms/{vehicle_code}/+/+`**，用於單一車輛之遠端診斷與詳細狀態同步渲染。
3.  **連線認證（車端一律 8883 TLS 雙向驗證）**：
    broker 開兩個 listener，認證方式不同，權責分開：

    | listener | 對象 | 開放範圍 | 認證方式 |
    |---|---|---|---|
    | **8883** | **車端** | 對外 | **TLS ＋ 客戶端憑證（雙向驗證）** |
    | 1883 | 中心端後端 | 僅 docker 內部網路，不對主機發布 | 帳密 |

    **車端只走 8883。**broker 設 `require_certificate true`，沒有客戶端憑證的連線
    在 TLS 交握階段就被拒，不是發布時才失敗。1883 那個 listener 外面連不到，
    車端不會、也不該用到。

    憑證即身分：broker 設 `use_identity_as_username true`，把客戶端憑證的 CN 當成
    username，ACL 直接拿它比對（見下一點）。所以**憑證的 CN 必須等於該車的
    `vehicle_code`**（例 `PMS05`）——這一段不是密碼，是 CA 簽出來的，換不了也借不了。

    車端憑證由 `POST /syncdrive-api/auth/token` 取得，續簽機制見
    [MQTT 憑證體系與自動續簽](MQTT憑證體系與自動續簽.md)。

    連線字串格式：

    ```
    mqtts://<broker 位址>:8883
    ```

    加上客戶端憑證與私鑰（`ca-chain.crt` / `<vehicle_code>.crt` / `<vehicle_code>.key`）。
    URL 內**不帶帳密**——身分完全由憑證決定。

    中心端<strong>沒有</strong>「代替全部車輛發話」的身分。以前有一個
    `vtms-simulator` 給示範模擬器用，已移除——模擬器是外部單位，
    以各車自己的憑證連線，與真車走完全一樣的路徑。

4.  **存取控制 (ACL) 隔離原則**：
    * **車端權限**：車端 Agent 僅具備發布至自身 ID Topic 的權限，並限制訂閱自身 ID 與 `all` 路徑。
      實作上以憑證 CN 導出的 username 做比對：`pattern write v1/vtms/%u/#`、`pattern read v1/vtms/%u/#`
      與 `pattern read v1/vtms/all/#`。
    * **中心端權限**：VTMS Host 具備全域 Topic 之發布與訂閱權限。
    * **違反 ACL 的發布會被 broker 靜默丟棄**，不會回錯誤。車端若發現中心端收不到
      訊息，第一個要確認的是客戶端憑證的 CN 與 topic 中的 `vehicle_code` 是否一致。

---

### 四、 Payload 共通資料格式規範 (硬性約束)

所有 MQTT 傳輸的 Payload 內容必須為 JSON 格式，並嚴格遵守以下防漂移 (Anti-drift) 約束：

1.  **根目錄標識 (Root Level Identifiers)**：
    每個 JSON 的最外層 (Root) 必須包含 `vehicle_code` 與 `timestamp` 兩個屬性。**嚴禁包裹於 `params`、`data` 或任何子物件中**。
    ```json
    {
      "vehicle_code": "PMS05",
      "timestamp": 1713868200000,
      ...
    }
    ```
2.  **時間戳記格式 (Timestamp)**：
    全系統統一採用 **13 位 Unix Epoch (ms)** 格式 (Long)。**屏除 ISO 8601 字串**。
3.  **字串命名約定 (Naming Convention)**：
    JSON 內所有的系統狀態碼、事件代碼 (Event Codes)、錯誤代碼 (Error Codes) 及指令動作 (Actions)，一律強制使用 **`SCREAMING_SNAKE_CASE`** (全大寫蛇形命名法)。

---

### 五、 協議治理規範 (Governance)
本協議之通訊頻道 (`channel`) 與動作 (`action`) 定義採閉鎖式管理。**嚴禁任何單方面之架構擴張**。未來若有新增、刪除或修訂需求，必須由 **工研院 (ICL)**、**台灣智慧駕駛 (Turing Drive)** 與車端廠商之技術代表共同審閱通過後方可實施。

---

### 六、 中心端／場域擴充頻道 (Center & Facility Extensions)

> 下列 Topic 屬 **車端 Agent ↔ 中心 (VTMS Host)** 核心協議之**外圍**，由中心端與場域設施使用，不在第一～四類閉鎖集合內。**現況實作中已存在，特此補錄以對齊文件與程式碼**；後續若調整仍適用 §五 治理流程。

| Topic 範例 | 用途 | 方向 |
| :--- | :--- | :--- |
| `v1/vtms/{vehicle_code}/operation/assign` | 中心端發車與優先權宣告 | 中心 ➔ 車端 |
| `v1/vtms/{slot_id}/slot/status` | 月台/廠區格位佔用狀態 | 設施 ➔ 中心 |
| `v1/vtms/{vehicle_code}/status/{type}` | 通用狀態轉發（前端 widget 訂閱） | 設施/車端 ➔ 中心 |
| `v1/vtms/dashboard/capacity/live` | 儀表板運能即時資料 | 中心內部 |
| `syncdrive/#` | 場域設施（月台門 PSD、號誌等）原生 Topic | 設施 ➔ 中心 |
| `v1/vtms/{vehicle_code}/door/update` | 車門開度與六態 `display_state`（見 [月台門與車門協議](月台門與車門協議.md)） | 車端 ➔ 中心 |
| `v1/vtms/{psd_id}/psd/update` | 月台門開度與六態 `display_state`（同上） | 設施 ➔ 中心 |
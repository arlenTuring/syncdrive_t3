# 車輛即時 ETA API 規格書

**即將進站／預計到達／異常狀況**
車輛監控系統經 SCADA 以 HTTP GET 輪詢取得全線即時 ETA 與異常狀態。

| 項目 | 內容 |
|------|------|
| 文件狀態 | `DRAFT v0.1` — 待雙方確認後定版 |
| 更新日期 | 2026-08-16 |
| 提供方 | 台智駕 SyncDrive T3 |
| 使用方 | 車輛監控系統（經 SCADA） |
| Base URL | `http://127.0.0.1:3000`（正式環境待配） |
| 通訊方式 | HTTP GET，唯讀 |
| 取用模式 | **固定頻率輪詢（pull-only）**。中心端不主動推播、不做新資料通知 |
| 建議輪詢頻率 | ETA `60` 秒／異常與饋送狀態 `30` 秒（見第十一章） |

> **一句話**
> 車端以 MQTT 1Hz 回報位置與任務進度，SyncDrive 聚合成「站別／車別即時 ETA」快照；監控系統經 SCADA 以**固定頻率**每 30–60 秒 GET 一次，取得**即將進站**、**預計到達**與**異常狀況**。雙方談定為**純取用（pull-only）**：中心端不主動推播，也不在有新資料時通知。

---

## 目錄

1. [這份文件與既有文件的分工](#一這份文件與既有文件的分工)
2. [API 路徑分層與命名依據](#二api-路徑分層與命名依據)
3. [系統架構與資料流](#三系統架構與資料流)
4. [命名與代碼規範](#四命名與代碼規範)
5. [端點總覽](#五端點總覽)
6. [端點 1：依站即時 ETA](#六端點-1依站即時-eta)
7. [端點 2：依車即時 ETA](#七端點-2依車即時-eta)
8. [端點 3：異常狀況](#八端點-3異常狀況)
9. [端點 4：資料饋送狀態](#九端點-4資料饋送狀態)
10. [欄位字典](#十欄位字典)
11. [輪詢建議值、快取與傳輸](#十一輪詢建議值快取與傳輸)
12. [錯誤處理](#十二錯誤處理)
13. [典型串接情境（完整走一遍）](#十三典型串接情境完整走一遍)
14. [JSON Schema](#十四json-schema端點-1供程式驗證)
15. [待確認事項](#十五待確認事項提供給對方一併回覆)
16. [實作狀態](#十六實作狀態)

---

## 一、這份文件與既有文件的分工

| 文件 | 回答什麼 | 資料性質 |
|------|---------|---------|
| 班表 Timetable API | 「**按表**幾點到？」 | **計畫值**。由已發布班表推算，`vehicle_id` 恆為 `null`，不含車輛實際位置 |
| **本文件** | 「**現在實際**幾點到？有沒有異常？」 | **即時值**。以車端回報推算，含車輛識別、誤差與異常 |
| 車輛動態協議 | 車輛位置／速度／姿態 | MQTT 上行，1Hz，本 API 的輸入之一 |
| 營運任務狀態協議 | 任務進度、`current_leg.eta_seconds` | MQTT 上行，1Hz，**本 API 的 ETA 主要來源** |
| 設備健康與異常告警協議 | 硬體子系統異常 | MQTT 上行，本 API `alerts` 的來源之一 |

**本 API 不重新發明 ETA**：車端自駕系統已在 `current_leg.eta_seconds` 提供到下一站的推估，本 API 以它為主要真值，再往後續站點外推。

**範例對照**：同一台車、同一站，兩份資料長這樣。

計畫值（班表 Timetable API）：

```json
{
  "station_id": "station_4",
  "eta_arrive": "09:00:10",
  "trip_code": "ST0007",
  "vehicle_id": null
}
```

即時值（本 API）：

```json
{
  "station_id": "station_4",
  "vehicle_code": "PMS-05",
  "arrival_state": "APPROACHING",
  "eta_clock": "09:00:25",
  "plan": { "planned_arrival_clock": "09:00:10", "delay_seconds": 15 }
}
```

差別：即時值知道**是哪一台車**、**現在到哪了**、**跟計畫差多少**。

---

## 二、API 路徑分層與命名依據

本 API 的路徑**不是新開一組**，而是掛在既有的 `vehicles` 領域之下。以下是依據。

### 2.1 既有 API 路徑盤點

SyncDrive T3 後端目前的頂層領域（`@Controller` 前綴）：

| 頂層 | 領域 | 代表端點 |
|------|------|---------|
| `syncdrive-api/map` | 地圖與拓撲 | `GET /library`、`GET /:mapId/stations/:stationId` |
| `syncdrive-api/time-template` | 時間模板 | `GET /list`、`GET /detail/:id` |
| `syncdrive-api/maintenance-task` | 整備任務 | `GET /list`、`GET /detail/:id` |
| `syncdrive-api/operation-shift` | 班表 | `GET /list`、`GET /timetable/trips`、`GET /timetable/station-etas` |
| `syncdrive-api/order` | 營運訂單 | `POST /save`、`PUT /updateOrderProgress/:id` |
| **`syncdrive-api/vehicles`** | **車輛即時狀態** | **`GET /snapshot`** |
| `syncdrive-api/command` | 控制指令下發 | `POST /execute` |
| `syncdrive-api/datasource` | 資料源查詢 | `GET /tables`、`POST /query` |
| `syncdrive-api/media-library` | 媒體庫 | `GET /list` |

**觀察到的兩條命名規則**：

1. **頂層一律是「業務領域名詞」**，不是形容詞、不是資料特性。沒有 `realtime`、`cache`、`v2` 這種前綴。
2. **第二層是資源或動作**：`/list`、`/detail/:id`、`/snapshot`、`/timetable/trips`。多視圖時用第二層區分（`timetable/trips` 對 `timetable/station-etas`）。

### 2.2 本 API 的歸屬判斷

即時 ETA 是**由車輛回報推導出來的**，不論索引方式是依站還是依車 —— 索引是查詢方式，不是領域歸屬。因此全部掛在 `vehicles` 之下，與既有的 `GET /vehicles/snapshot` 平行：

```
syncdrive-api/vehicles/
├── snapshot            （既有）車輛原始狀態快照：telemetry / health / operation
├── eta/
│   ├── by-station      （新）即時 ETA，依站索引  ← 站顯、SCADA 告警看板
│   └── by-vehicle      （新）即時 ETA，依車索引  ← 車輛追蹤畫面
├── alerts              （新）異常彙整
└── feed-status         （新）資料饋送新鮮度與可用性
```

`eta/by-station` 與 `eta/by-vehicle` 的雙視圖，形狀刻意對齊既有的
`operation-shift/timetable/trips`（依班次）與 `timetable/station-etas`（依站）。

### 2.3 與計畫 ETA 的對稱關係

同一件事有計畫與即時兩個版本，各自掛在自己的領域下：

| 視角 | 計畫值（班表衍生） | 即時值（車輛衍生） |
|------|------------------|------------------|
| 依站 | `operation-shift/timetable/station-etas` | `vehicles/eta/by-station` |
| 依班次／車 | `operation-shift/timetable/trips` | `vehicles/eta/by-vehicle` |

**兩者不合併**：計畫值來自班表文件、即時值來自車輛回報，生命週期與可用性完全不同（班表沒發布時計畫值仍在，車輛失聯時即時值消失）。合併會讓使用方分不清拿到的是哪一種。本 API 以 `plan` 子物件內嵌計畫值，方便對照，但真值來源仍分離。

### 2.4 為什麼不叫 `realtime`

本文件初稿曾使用 `syncdrive-api/realtime/...`。**那是錯的**：`realtime` 描述的是資料新鮮度（形容詞），不是業務領域（名詞），與既有九個頂層領域的命名規則衝突。若照此開，之後每加一種即時資料就得決定「放 realtime 還是放它自己的領域」，界線會逐漸失守。

---

## 三、系統架構與資料流

### 3.1 既有實作（已上線）

**MQTT 接收、快取、推播三層都已存在**，本 API 是接在它們後面的讀取層：

```
                      ┌─────────────────── SyncDrive T3 後端 ───────────────────┐
┌──────────┐  MQTT    │                                                          │
│ 車輛     │ ────────▶│ MqttController                                           │
│ PMS-01   │  1Hz     │   v1/vtms/+/telemetry/update  ─┐                         │
│ ~ PMS-11 │          │   v1/vtms/+/health/heartbeat  ─┼─▶ RedisService          │
└──────────┘          │   v1/vtms/+/operation/update  ─┘   vtms:telemetry:{code} │
                      │   v1/vtms/+/event/report       ─┐  vtms:health:{code}    │
                      │   v1/vtms/+/command/ack        ─┤  vtms:operation:{code} │
                      │   v1/vtms/+/slot/status        ─┘                        │
                      │            │                          │                  │
                      │            ▼                          ▼                  │
                      │      EventsGateway            VehicleController          │
                      │      （WebSocket 廣播）        GET /vehicles/snapshot     │
                      │            │                                             │
                      └────────────┼─────────────────────────────────────────────┘
                                   │                          │
                                   ▼                          ▼
                            前端地圖即時渲染          ★ 本 API（新增）
                                                     GET /vehicles/eta/by-station
                                                     GET /vehicles/eta/by-vehicle
                                                     GET /vehicles/alerts
                                                     GET /vehicles/feed-status
                                                              │
                                                              ▼
                                                    SCADA ──▶ 車輛監控系統
                                                    （30~60 秒輪詢）
```

**Redis 快取鍵**（既有，本 API 的主要讀取來源）：

| 鍵 | 內容 | 寫入來源 |
|----|------|---------|
| `vtms:telemetry:{vehicle_code}` | 位置、速度、姿態 | `v1/vtms/+/telemetry/update` |
| `vtms:health:{vehicle_code}` | `overall_health` + 四大子系統 | `v1/vtms/+/health/heartbeat` |
| `vtms:operation:{vehicle_code}` | `vehicle_phase`、`current_leg`、任務進度 | `v1/vtms/+/operation/update` |

**既有的資料驗證**（`RedisService`，本 API 直接受益）：

- `telemetry` 缺 `timestamp` / `global_pose` / `kinematics` 或經緯度為空 → **丟棄不寫入**
- `health` 的 `overall_health` 必須是 `OK` / `WARNING` / `ERROR` / `OFFLINE`
- `health` 四大子系統（`COMPUTING` / `SENSING` / `COMMUNICATION` / `CHASSIS`）缺一 → 丟棄
- 交叉驗算：任一子系統為 `ERROR` 但 `overall_health` 不是 `ERROR` → **強制修正為 `ERROR`**（以子系統為準）
- 與前一筆比較，偵測狀態劣化（`degraded`）

也就是說，本 API 的 `alerts` 不需要自己重做健康資料的驗證與劣化判定，那一層已經在了。

### 3.2 本 API 新增的部分

只有三件事：

1. **ETA 外推** — 車端 `current_leg.eta_seconds` 只給到**下一站**；往後續站點外推需要用班表的站間旅行時間。
2. **依站索引** — 既有的 `/snapshot` 是依車的字典；站顯需要「這一站接下來有誰要來」。
3. **告警彙整與去重** — 既有的健康劣化是逐筆事件，本 API 需要維持「同車同 code 只有一筆 `alert_id`」的生命週期。

### 3.3 資料如何變成 ETA — 實際走一遍

```
車端 MQTT（1Hz）→ Redis vtms:operation:PMS-05：
  { "vehicle_code": "PMS-05",
    "current_leg": { "target_station_id": "T3", "distance_to_target_m": 120.0, "eta_seconds": 25 } }
                          │
                          ▼
本 API：距離 120m ≤ 200m 門檻  →  arrival_state = "APPROACHING"
        收到時間 09:00:00 + 25 秒  →  eta_at = 09:00:25
        班表計畫 09:00:10          →  delay_seconds = +15（晚 15 秒）→ delay_state = "ON_TIME"
                          │
                          ▼
API 回應（SCADA 每 30~60 秒取一次）
```

### 3.4 權責邊界

- 車端是 `vehicle_phase`、`overall_health`、`current_leg` 的**唯一真值源**（沿用營運任務狀態協議第一章的 SSOT 聲明）。
- 中心端只做**聚合、外推、與計畫值比對**，不覆寫車端狀態。
- 本 API 為**唯讀**。控制指令走既有的 `POST /syncdrive-api/command/execute`。

### 3.5 本 API 是純取用（pull-only）

**雙方談定的取用方式為固定頻率輪詢，中心端不主動推播、不在有新資料時通知。**
使用方按自己的排程來取，每次拿到的都是**當下的完整快照**，不需要處理增量或訊息順序。

這對雙方的意義：

| | 說明 |
|---|---|
| 使用方 | 不必維護長連線、不必處理斷線重連與補漏。固定週期打，拿到什麼就是什麼 |
| 提供方 | 不需維護訂閱者名冊與投遞保證。無狀態，可水平擴充 |
| 資料完整性 | 每次回應都是完整快照，**漏掉一輪不會累積落後**，下一輪自動補上 |

系統內部另有 `EventsGateway`（Socket.IO）供**前端地圖**以 1Hz 平滑渲染，
**那是內部通道，不在本份對外契約範圍內**，本文件不提供其規格。

| 通道 | 對象 | 方式 | 是否屬本契約 |
|------|------|------|-------------|
| WebSocket（既有） | 前端地圖 | 1Hz 推播 | ✗ 內部使用 |
| **本 API** | SCADA／車輛監控系統 | **30~60 秒輪詢** | ✓ |

---

## 四、命名與代碼規範

沿用既有協議，不另立規則：

| 項目 | 格式 | 範例 |
|------|------|------|
| 車輛代號 `vehicle_code` | `PMS-` + 兩碼數字 | `PMS-05` |
| 班次代碼 `trip_code` | 路線代號 + `HHMM` | `ST0007`、`TN1102` |
| 實體訂單 `order_id` | `[YYMMDD]-[trip_code]` | `260422-U1030` |
| 站點 `station_id` | 地圖編輯器停靠點 id | `station_4` |
| 列舉值 | `SCREAMING_SNAKE_CASE` | `APPROACHING` |
| 時間戳 | Unix Epoch **毫秒** (Long) | `1716536357000` |
| 時刻字串 | `HH:MM:SS`（營運日內，可跨 24 時） | `25:10:30` |

**跨午夜範例**：營運日 `2026-08-16` 的末班車在實際時間 `2026-08-17 01:10:30` 到站，回應會是：

```json
{
  "service_date": "2026-08-16",
  "eta_clock": "25:10:30",
  "eta_at": 1716606630000
}
```

`eta_clock` 超過 `24:00:00` 表示跨日；不想處理這個的話，**直接用 `eta_at`（絕對毫秒）即可**，不需自行換算。

---

## 五、端點總覽

| # | 端點 | 用途 | 建議輪詢 |
|---|------|------|---------|
| 1 | `GET /syncdrive-api/vehicles/eta/by-station` | **依站**：每站接下來會到的車 | 30–60s |
| 2 | `GET /syncdrive-api/vehicles/eta/by-vehicle` | **依車**：每台車接下來會到的站 | 30–60s |
| 3 | `GET /syncdrive-api/vehicles/alerts` | 異常狀況清單 | 30s |
| 4 | `GET /syncdrive-api/vehicles/feed-status` | 資料新鮮度與系統可用性 | 30s |

**給 SCADA 的建議**：端點 1 與 3 即可滿足站顯與告警看板；端點 2 供車輛追蹤畫面；端點 4 用來判斷「資料是不是還活著」，避免把過期資料當成現況顯示。

---

## 六、端點 1：依站即時 ETA

```
GET /syncdrive-api/vehicles/eta/by-station
```

| Query | 必填 | 預設 | 說明 |
|-------|------|------|------|
| `station_id` | 否 | 全部 | 只取單一站；可重複帶多個 |
| `limit_per_station` | 否 | `3` | 每站回傳幾筆最近的到站預測 |
| `include_plan` | 否 | `true` | 是否附上計畫值與誤差 |

### 呼叫範例

全線所有站，每站 3 筆：

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-station" \
  -H "X-API-Key: <YOUR_KEY>" | jq .
```

只看 T3 上行一站：

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-station?station_id=station_4" \
  -H "X-API-Key: <YOUR_KEY>" | jq .
```

同時看兩站、每站只要最近 1 筆、不需要計畫值（站顯精簡模式）：

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-station\
?station_id=station_4&station_id=station_2&limit_per_station=1&include_plan=false" \
  -H "X-API-Key: <YOUR_KEY>" | jq .
```

### 回應範例 A — 正常（一台即將進站、一台行駛中）

```json
{
  "meta": {
    "generated_at": 1716536400000,
    "generated_at_iso": "2026-08-16T09:00:00.000Z",
    "service_date": "2026-08-16",
    "shift_id": "OS-DRAFT-MSEEXIN9",
    "source": "published",
    "data_quality": "OK"
  },
  "station_count": 2,
  "stations": [
    {
      "station_id": "station_4",
      "station_name": "T3上行",
      "station_alias": "T3",
      "etas": [
        {
          "vehicle_code": "PMS-05",
          "order_id": "260816-ST0007",
          "trip_code": "ST0007",
          "route_code": "ST",
          "route_name": "S2W上行 > T3上行",
          "arrival_state": "APPROACHING",
          "eta_seconds": 25,
          "eta_at": 1716536425000,
          "eta_clock": "09:00:25",
          "distance_to_station_m": 120.0,
          "confidence": "HIGH",
          "vehicle_phase": "TRANSITING",
          "plan": {
            "planned_arrival_clock": "09:00:10",
            "planned_arrival_at": 1716536410000,
            "delay_seconds": 15,
            "delay_state": "ON_TIME"
          },
          "has_alert": false,
          "observed_at": 1716536398000,
          "data_age_seconds": 2
        },
        {
          "vehicle_code": "PMS-02",
          "order_id": "260816-ST0013",
          "trip_code": "ST0013",
          "route_code": "ST",
          "route_name": "S2W上行 > T3上行",
          "arrival_state": "EN_ROUTE",
          "eta_seconds": 415,
          "eta_at": 1716536815000,
          "eta_clock": "09:06:55",
          "distance_to_station_m": 1840.0,
          "confidence": "MEDIUM",
          "vehicle_phase": "TRANSITING",
          "plan": {
            "planned_arrival_clock": "09:06:10",
            "planned_arrival_at": 1716536770000,
            "delay_seconds": 45,
            "delay_state": "ON_TIME"
          },
          "has_alert": false,
          "observed_at": 1716536397000,
          "data_age_seconds": 3
        }
      ]
    },
    {
      "station_id": "station_2",
      "station_name": "N2W下行出發",
      "station_alias": "N2W",
      "etas": []
    }
  ]
}
```

**空陣列不是錯誤**：`station_2` 當下沒有駛近的車，`etas` 為 `[]`。回應仍會列出**地圖上全部停靠點**，方便站顯固定頁籤。

### 回應範例 B — 停靠中（顯示預計發車）

```json
{
  "vehicle_code": "PMS-03",
  "trip_code": "TN0902",
  "arrival_state": "AT_STATION",
  "eta_seconds": 0,
  "eta_at": 1716536380000,
  "eta_clock": "08:59:40",
  "distance_to_station_m": 0.0,
  "confidence": "HIGH",
  "vehicle_phase": "AT_STATION",
  "plan": {
    "planned_arrival_clock": "08:59:30",
    "planned_departure_clock": "09:00:20",
    "delay_seconds": 10,
    "delay_state": "ON_TIME"
  },
  "has_alert": false,
  "observed_at": 1716536399000,
  "data_age_seconds": 1
}
```

### 回應範例 C — 誤點且有異常（監控端應標示不可信）

```json
{
  "vehicle_code": "PMS-02",
  "trip_code": "ST0013",
  "arrival_state": "EN_ROUTE",
  "eta_seconds": 660,
  "eta_at": 1716537060000,
  "eta_clock": "09:11:00",
  "distance_to_station_m": 1840.0,
  "confidence": "LOW",
  "vehicle_phase": "TRANSITING",
  "plan": {
    "planned_arrival_clock": "09:06:10",
    "planned_arrival_at": 1716536770000,
    "delay_seconds": 290,
    "delay_state": "MAJOR_DELAY"
  },
  "has_alert": true,
  "observed_at": 1716536380000,
  "data_age_seconds": 20
}
```

搭配端點 3 可查到對應的 `SCHEDULE_DEVIATION` 告警。

### 回應範例 D — 車輛失聯（**不得顯示 ETA**）

```json
{
  "vehicle_code": "PMS-08",
  "trip_code": "TN0905",
  "arrival_state": "UNKNOWN",
  "eta_seconds": null,
  "eta_at": null,
  "eta_clock": null,
  "distance_to_station_m": null,
  "confidence": "STALE",
  "vehicle_phase": null,
  "plan": {
    "planned_arrival_clock": "09:05:00",
    "planned_arrival_at": 1716536700000,
    "delay_seconds": null,
    "delay_state": "NO_PLAN"
  },
  "has_alert": true,
  "observed_at": 1716536308000,
  "data_age_seconds": 92
}
```

**監控端處理**：`arrival_state` 為 `UNKNOWN` 且 `confidence` 為 `STALE` 時，該列顯示「資料中斷」，**不可沿用上一次的 ETA**。

---

## 七、端點 2：依車即時 ETA

```
GET /syncdrive-api/vehicles/eta/by-vehicle
```

| Query | 必填 | 預設 | 說明 |
|-------|------|------|------|
| `vehicle_code` | 否 | 全部 | 只取單一車；可重複帶多個 |
| `next_stops` | 否 | `3` | 每台車往後推幾站 |

### 呼叫範例

全部車：

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-vehicle" \
  -H "X-API-Key: <YOUR_KEY>" | jq .
```

追蹤單一車、往後看 5 站：

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-vehicle?vehicle_code=PMS-05&next_stops=5" \
  -H "X-API-Key: <YOUR_KEY>" | jq .
```

### 回應範例

```json
{
  "meta": {
    "generated_at": 1716536400000,
    "service_date": "2026-08-16",
    "data_quality": "OK"
  },
  "vehicle_count": 1,
  "vehicles": [
    {
      "vehicle_code": "PMS-05",
      "vehicle_phase": "TRANSITING",
      "overall_health": "OK",
      "order_id": "260816-ST0007",
      "trip_code": "ST0007",
      "route_code": "ST",
      "route_name": "S2W上行 > T3上行",
      "position": {
        "latitude": 25.077612,
        "longitude": 121.232545,
        "heading": 1.49,
        "velocity_kph": 10.5
      },
      "next_stops": [
        {
          "sequence": 1,
          "station_id": "station_4",
          "station_name": "T3上行",
          "arrival_state": "APPROACHING",
          "eta_seconds": 25,
          "eta_at": 1716536425000,
          "eta_clock": "09:00:25",
          "confidence": "HIGH",
          "plan": {
            "planned_arrival_clock": "09:00:10",
            "delay_seconds": 15,
            "delay_state": "ON_TIME"
          }
        },
        {
          "sequence": 2,
          "station_id": "station_9",
          "station_name": "N2W上行停靠",
          "arrival_state": "EN_ROUTE",
          "eta_seconds": 268,
          "eta_at": 1716536668000,
          "eta_clock": "09:04:28",
          "confidence": "MEDIUM",
          "plan": {
            "planned_arrival_clock": "09:04:00",
            "delay_seconds": 28,
            "delay_state": "ON_TIME"
          }
        },
        {
          "sequence": 3,
          "station_id": "station_2",
          "station_name": "N2W下行出發",
          "arrival_state": "EN_ROUTE",
          "eta_seconds": 495,
          "eta_at": 1716536895000,
          "eta_clock": "09:08:15",
          "confidence": "LOW",
          "plan": {
            "planned_arrival_clock": "09:07:40",
            "delay_seconds": 35,
            "delay_state": "ON_TIME"
          }
        }
      ],
      "observed_at": 1716536398000,
      "data_age_seconds": 2
    }
  ]
}
```

**注意 `confidence` 隨站序遞減**：第 1 站 `HIGH`（車端直接給的）、第 2 站 `MEDIUM`（用班表旅行時間外推）、第 3 站 `LOW`（誤差累積）。監控畫面可據此決定要不要顯示秒數或只顯示分鐘。

---

## 八、端點 3：異常狀況

```
GET /syncdrive-api/vehicles/alerts
```

| Query | 必填 | 預設 | 說明 |
|-------|------|------|------|
| `severity` | 否 | 全部 | `WARNING` / `ERROR` / `CRITICAL` |
| `vehicle_code` | 否 | 全部 | 只取單一車 |
| `active_only` | 否 | `true` | 只取尚未解除的異常 |

### 呼叫範例

全部未解除的異常：

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/alerts" \
  -H "X-API-Key: <YOUR_KEY>" | jq .
```

只看嚴重等級（告警看板紅燈區）：

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/alerts?severity=CRITICAL" \
  -H "X-API-Key: <YOUR_KEY>" | jq .
```

查某台車今日全部異常（含已解除）：

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/alerts?vehicle_code=PMS-05&active_only=false" \
  -H "X-API-Key: <YOUR_KEY>" | jq .
```

### 回應範例（涵蓋三種分類）

```json
{
  "meta": {
    "generated_at": 1716536400000,
    "service_date": "2026-08-16",
    "data_quality": "OK"
  },
  "alert_count": 3,
  "alerts": [
    {
      "alert_id": "AL-20260816-000117",
      "category": "VEHICLE_HEALTH",
      "code": "LIDAR_FRONT_BLIND",
      "severity": "ERROR",
      "vehicle_code": "PMS-05",
      "subsystem": "SENSING",
      "message": "前光達視野受阻",
      "station_id": null,
      "trip_code": "ST0007",
      "started_at": 1716536350000,
      "updated_at": 1716536398000,
      "resolved_at": null,
      "active": true,
      "eta_impact": "ETA_UNRELIABLE"
    },
    {
      "alert_id": "AL-20260816-000118",
      "category": "SCHEDULE_DEVIATION",
      "code": "MAJOR_DELAY",
      "severity": "WARNING",
      "vehicle_code": "PMS-02",
      "subsystem": null,
      "message": "較計畫誤點 245 秒",
      "station_id": "station_4",
      "trip_code": "ST0013",
      "started_at": 1716536200000,
      "updated_at": 1716536398000,
      "resolved_at": null,
      "active": true,
      "eta_impact": "ETA_DEGRADED"
    },
    {
      "alert_id": "AL-20260816-000119",
      "category": "COMMUNICATION",
      "code": "VEHICLE_SIGNAL_LOST",
      "severity": "CRITICAL",
      "vehicle_code": "PMS-08",
      "subsystem": "COMMUNICATION",
      "message": "已 92 秒未收到車端回報",
      "station_id": null,
      "trip_code": "TN0905",
      "started_at": 1716536306000,
      "updated_at": 1716536398000,
      "resolved_at": null,
      "active": true,
      "eta_impact": "ETA_UNAVAILABLE"
    }
  ]
}
```

### 異常解除的表示方式

同一個 `alert_id` 在解除後會帶 `resolved_at` 且 `active` 轉為 `false`。以 `active_only=false` 查詢即可看到：

```json
{
  "alert_id": "AL-20260816-000117",
  "code": "LIDAR_FRONT_BLIND",
  "severity": "ERROR",
  "vehicle_code": "PMS-05",
  "started_at": 1716536350000,
  "updated_at": 1716536520000,
  "resolved_at": 1716536520000,
  "active": false,
  "eta_impact": "NONE"
}
```

**去重承諾**：同一車、同一 `code` 持續存在期間**只會有一筆** `alert_id`，不會每次輪詢都產生新的一筆。監控端可用 `alert_id` 當主鍵做增量更新。

---

## 九、端點 4：資料饋送狀態

```
GET /syncdrive-api/vehicles/feed-status
```

供 SCADA 判斷「這份資料還能不能用」。**建議監控系統在顯示 ETA 前先確認此端點**。

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/feed-status" -H "X-API-Key: <YOUR_KEY>" | jq .
```

### 回應範例 A — 一切正常

```json
{
  "generated_at": 1716536400000,
  "status": "OK",
  "mqtt_broker_connected": true,
  "timetable_loaded": true,
  "shift_id": "OS-DRAFT-MSEEXIN9",
  "service_date": "2026-08-16",
  "vehicles_expected": 11,
  "vehicles_reporting": 11,
  "vehicles_stale": [],
  "oldest_data_age_seconds": 3,
  "degraded_reasons": []
}
```

### 回應範例 B — 部分降級（一台失聯）

```json
{
  "generated_at": 1716536400000,
  "status": "DEGRADED",
  "mqtt_broker_connected": true,
  "timetable_loaded": true,
  "shift_id": "OS-DRAFT-MSEEXIN9",
  "service_date": "2026-08-16",
  "vehicles_expected": 11,
  "vehicles_reporting": 10,
  "vehicles_stale": [
    { "vehicle_code": "PMS-08", "data_age_seconds": 92 }
  ],
  "oldest_data_age_seconds": 92,
  "degraded_reasons": ["VEHICLE_SIGNAL_LOST"]
}
```

### 回應範例 C — 全線中斷（**不得顯示任何 ETA**）

```json
{
  "generated_at": 1716536400000,
  "status": "DOWN",
  "mqtt_broker_connected": false,
  "timetable_loaded": true,
  "shift_id": "OS-DRAFT-MSEEXIN9",
  "service_date": "2026-08-16",
  "vehicles_expected": 11,
  "vehicles_reporting": 0,
  "vehicles_stale": [],
  "oldest_data_age_seconds": null,
  "degraded_reasons": ["MQTT_BROKER_DISCONNECTED"]
}
```

| `status` | 意義 | 監控系統建議行為 |
|----------|------|-----------------|
| `OK` | 全部車輛回報正常 | 正常顯示 |
| `DEGRADED` | 部分車輛逾時或班表未載入 | 顯示但標示不確定 |
| `DOWN` | MQTT 中斷或無班表 | **不得顯示 ETA**，改顯示「資料中斷」 |

---

## 十、欄位字典

### 10.1 到站狀態 `arrival_state`

**這就是需求裡的「即將進站／預計到達」**。以車端 `current_leg.distance_to_target_m` 與 `eta_seconds` 判定：

| 值 | 中文 | 判定條件（建議，門檻待確認） | 監控畫面用途 |
|----|------|--------------------------------|------------|
| `EN_ROUTE` | 行駛中 | 尚未進入接近門檻 | **預計到達**：顯示 ETA 分鐘數 |
| `APPROACHING` | **即將進站** | `eta_seconds ≤ 60` **或** `distance_to_station_m ≤ 200` | **即將進站**：閃爍／進站提示 |
| `DOCKING` | 進站對位中 | `PLATFORM_DOCKING` 任務為 `IN_PROGRESS` | 進站中 |
| `AT_STATION` | 停靠中 | 車速為 0 且已完成 `PLATFORM_DOCKING` | 停靠中，顯示預計發車 |
| `DEPARTED` | 已離站 | `STATION_DEPARTURE` 已 `COMPLETED` | 自清單移除 |
| `UNKNOWN` | 無法判定 | 車端資料逾時或缺欄位 | 顯示「—」，不可顯示舊 ETA |

**判定範例**（門檻取 60 秒 / 200 公尺）：

| 車端回報 | 判定結果 | 理由 |
|---------|---------|------|
| `eta_seconds=25`, `distance=120m` | `APPROACHING` | 兩個條件都成立 |
| `eta_seconds=45`, `distance=350m` | `APPROACHING` | 時間成立即可（塞車時距離還遠但很快到） |
| `eta_seconds=90`, `distance=180m` | `APPROACHING` | 距離成立即可（低速接近） |
| `eta_seconds=415`, `distance=1840m` | `EN_ROUTE` | 兩個都不成立 |
| 90 秒未回報 | `UNKNOWN` | 逾時，不論上次值為何 |

### 10.2 誤點狀態 `delay_state`

計畫值取自已發布班表。`delay_seconds` 為**正**表示**晚於**計畫。

| 值 | 條件（建議） | 說明 |
|----|-------------|------|
| `EARLY` | `delay_seconds < -30` | 早到 |
| `ON_TIME` | `-30 ≤ delay_seconds ≤ 60` | 準點 |
| `MINOR_DELAY` | `60 < delay_seconds ≤ 180` | 輕微誤點 |
| `MAJOR_DELAY` | `delay_seconds > 180` | 顯著誤點，同時產生 `SCHEDULE_DEVIATION` 告警 |
| `NO_PLAN` | 無對應計畫班次 | 加班車／調度車，不判定誤點 |

**計算範例**：

| 計畫到站 | 預計實際到站 | `delay_seconds` | `delay_state` |
|---------|------------|----------------|--------------|
| 09:00:10 | 09:00:25 | `+15` | `ON_TIME` |
| 09:00:10 | 08:59:20 | `-50` | `EARLY` |
| 09:06:10 | 09:08:20 | `+130` | `MINOR_DELAY` |
| 09:06:10 | 09:11:00 | `+290` | `MAJOR_DELAY` |
| （加班車，無計畫） | 09:11:00 | `null` | `NO_PLAN` |

### 10.3 可信度 `confidence`

ETA 越往後推越不準，必須讓監控端知道。

| 值 | 條件 | 說明 |
|----|------|------|
| `HIGH` | 下一站，且 `data_age_seconds ≤ 5` | 直接採用車端 `current_leg.eta_seconds` |
| `MEDIUM` | 往後第 2–3 站，或 `data_age_seconds ≤ 30` | 以班表站間旅行時間外推 |
| `LOW` | 更遠的站，或 `data_age_seconds > 30` | 僅供參考 |
| `STALE` | `data_age_seconds > 90` | **不應顯示**，應改判 `UNKNOWN` |

**建議顯示方式**：

| `confidence` | 站顯建議 |
|-------------|---------|
| `HIGH` | `即將進站` 或 `2 分鐘` |
| `MEDIUM` | `約 5 分鐘` |
| `LOW` | `約 8 分鐘` + 灰階／淡化 |
| `STALE` | `—` 或 `資料中斷` |

### 10.4 異常分類 `category`

| 值 | 來源 | 說明 |
|----|------|------|
| `VEHICLE_HEALTH` | 設備健康與異常告警協議的 `subsystems` | 硬體子系統異常，`code` 直接沿用該協議的 `error_codes` |
| `SCHEDULE_DEVIATION` | 本系統計算 | 誤點超過門檻 |
| `COMMUNICATION` | 本系統偵測 | 車端回報逾時／失聯 |
| `OPERATION` | 營運任務狀態協議 | 任務 `FAILED`、卡在 `IN_PROGRESS` 過久 |
| `SAFETY` | 車端 | MRM（最低風險操作）觸發、強制召回 |

**`code` 範例**（非窮盡）：

| `category` | `code` 範例 |
|-----------|------------|
| `VEHICLE_HEALTH` | `LIDAR_FRONT_BLIND`、`RADAR_1_DISCONNECTED`、`NETWORK_5G_LATENCY_HIGH` |
| `SCHEDULE_DEVIATION` | `MINOR_DELAY`、`MAJOR_DELAY` |
| `COMMUNICATION` | `VEHICLE_SIGNAL_LOST`、`MQTT_BROKER_DISCONNECTED` |
| `OPERATION` | `TASK_FAILED`、`INTERLOCK_TIMEOUT`、`DOCKING_TIMEOUT` |
| `SAFETY` | `MRM_TRIGGERED`、`FORCED_RECALL` |

### 10.5 異常對 ETA 的影響 `eta_impact`

**這一欄是給監控系統做顯示決策用的**，不必自行解讀各種 `code`：

| 值 | 監控系統應如何處理該車的 ETA |
|----|---------------------------|
| `NONE` | 照常顯示 |
| `ETA_DEGRADED` | 顯示但標示「可能延誤」 |
| `ETA_UNRELIABLE` | 顯示但明確標示不可信 |
| `ETA_UNAVAILABLE` | **不得顯示 ETA** |

**對應範例**：

| 異常 | `eta_impact` | 站顯呈現 |
|------|-------------|---------|
| `MINOR_DELAY` | `ETA_DEGRADED` | `約 5 分鐘（誤點）` |
| `LIDAR_FRONT_BLIND` | `ETA_UNRELIABLE` | `約 5 分鐘（資訊不確定）` |
| `VEHICLE_SIGNAL_LOST` | `ETA_UNAVAILABLE` | `資料中斷` |
| `MRM_TRIGGERED` | `ETA_UNAVAILABLE` | `車輛異常停止` |

### 10.6 共用欄位

| 欄位 | 型別 | 說明 |
|------|------|------|
| `observed_at` | Long | 這筆推估所依據的**車端回報時間**（Epoch ms） |
| `data_age_seconds` | Int | `generated_at - observed_at`，資料有多舊 |
| `generated_at` | Long | 中心端產生本快照的時間 |
| `service_date` | String | 營運日 `YYYY-MM-DD`，跨午夜班次仍屬前一營運日 |
| `source` | String | `published`（已發布班表）／`draft_fallback`（未發布，計畫值僅供參考） |

---

## 十一、輪詢建議值、快取與傳輸

本 API 為**固定頻率取用**，中心端不推播。以下為建議值。

### 11.1 建議輪詢頻率（各端點）

| 端點 | **建議間隔** | 可接受範圍 | 理由 |
|------|------------|-----------|------|
| `GET /vehicles/eta/by-station` | **60 秒** | 30–60 秒 | 站顯主力。班距最短 180 秒，60 秒可在每個班距內更新約 3 次，足夠反映進站狀態變化 |
| `GET /vehicles/eta/by-vehicle` | **60 秒** | 30–120 秒 | 車輛追蹤畫面，非安全關鍵；與依站同步取即可 |
| `GET /vehicles/alerts` | **30 秒** | 15–60 秒 | 異常要比 ETA 早知道。30 秒可在失聯判定（90 秒）成立後兩輪內呈現 |
| `GET /vehicles/feed-status` | **30 秒** | 15–60 秒 | 與 alerts 同步取。它決定其他三支的資料能不能顯示，不應比它們慢 |

**一組建議的排程**（最省事、也是我方預設假設的用法）：

```
每 30 秒：GET /vehicles/feed-status
         GET /vehicles/alerts
每 60 秒：GET /vehicles/eta/by-station     ← 與上面的第 2、4、6… 輪對齊
（依需要）GET /vehicles/eta/by-vehicle
```

即**以 30 秒為基本節拍，ETA 每兩拍取一次**。這樣 SCADA 端只需一個排程器。

### 11.2 為什麼不建議更快或更慢

| | 影響 |
|---|---|
| **快於 15 秒** | 車端本身 1Hz 上行、Redis 快取秒級更新，但**班表計畫值是靜態的**，ETA 的實質變化來自車輛移動；15 秒內的變化量小於顯示精度（分鐘級），多打只是浪費頻寬 |
| **快於 10 秒** | 中心端回 `429 Too Many Requests`（見 11.3） |
| **慢於 60 秒（ETA）** | 「即將進站」門檻為 60 秒，輪詢慢於此會**整段錯過** APPROACHING 狀態，站顯永遠不會亮進站提示 |
| **慢於 90 秒（alerts）** | 失聯判定為 90 秒，輪詢慢於此會讓異常延遲超過兩個判定週期才被看到 |

> **關鍵**：`eta/by-station` 的間隔**不應超過 60 秒**，否則會漏掉 `APPROACHING`。這是這份建議值裡唯一的硬性上限。

### 11.3 傳輸規範

| 項目 | 規範 |
|------|------|
| 最小間隔 | **10 秒**。低於此值中心端回 `429 Too Many Requests`，附 `Retry-After` |
| 條件式請求 | 支援 `ETag` / `If-None-Match`；資料未變回 `304 Not Modified`（無 body） |
| 快取標頭 | `Cache-Control: no-cache, max-age=0` |
| 壓縮 | 支援 `Accept-Encoding: gzip`；**建議開啟** |
| 連線 | 建議 `Connection: keep-alive`，避免每輪重建 TCP／TLS |
| 逾時建議 | SCADA 端設 **5 秒**；逾時視同 `DOWN`，沿用上一份並標示過期 |
| 重試 | 逾時或 `5xx` 時**不要立即重試**，等下一個排程週期即可（快照式資料補一輪就好） |
| 時鐘 | 雙方需 NTP 同步。所有 Epoch 為 UTC 毫秒；`*_clock` 為營運現地時間 |

### 11.4 頻寬估算（供網段規劃參考）

以 11 台車、10 個停靠點、每站 3 筆估算：

| 端點 | 未壓縮 | gzip 後 | 依建議頻率的日流量 |
|------|-------|--------|------------------|
| `eta/by-station` | 約 18 KB | 約 3 KB | 60 秒一次 → 約 4.3 MB／日 |
| `eta/by-vehicle` | 約 14 KB | 約 2.5 KB | 60 秒一次 → 約 3.6 MB／日 |
| `alerts` | 約 2 KB | 約 0.6 KB | 30 秒一次 → 約 1.7 MB／日 |
| `feed-status` | 約 0.5 KB | 約 0.3 KB | 30 秒一次 → 約 0.9 MB／日 |
| **合計** | | | **約 10.5 MB／日** |

實際帶上 `If-None-Match` 之後，資料未變的輪次回 `304`（無 body），流量會再低於此估算。

### ETag 使用範例

第一次請求：

```bash
curl -i -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-station" -H "X-API-Key: <KEY>"
```

```
HTTP/1.1 200 OK
ETag: "a1b2c3d4"
Cache-Control: no-cache, max-age=0
Content-Type: application/json

{ "meta": { ... }, "stations": [ ... ] }
```

30 秒後帶上 ETag 再請求：

```bash
curl -i -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-station" \
  -H "X-API-Key: <KEY>" -H 'If-None-Match: "a1b2c3d4"'
```

資料沒變：

```
HTTP/1.1 304 Not Modified
ETag: "a1b2c3d4"
```

**無 body，省下整包 JSON 的頻寬。** 監控端沿用上一份資料即可。

### ⚠ 重要：不要把 `eta_seconds` 當倒數起點

本 API 為 30–60 秒輪詢，與車端 1Hz 是不同數量級。ETA 在兩次輪詢之間會繼續變化。

**錯誤做法**：

```
09:00:00 收到 eta_seconds = 25
09:00:20 畫面顯示「還有 5 秒」   ← 用 25 - 20 算的，可能早就到了或還沒到
```

**正確做法**：

```
09:00:00 收到 eta_at = 1716536425000（= 09:00:25）
09:00:20 畫面顯示「還有 5 秒」   ← 用 eta_at - 現在時間 算的
```

請一律以 `eta_at`（絕對時間）為準自行倒數。

---

## 十二、錯誤處理

| HTTP | 情況 | 回應 |
|------|------|------|
| `200` | 正常（含 `etas: []`） | 見上 |
| `304` | 帶 `If-None-Match` 且資料未變 | 無 body |
| `400` | 參數格式錯誤 | 見下 |
| `404` | 指定的 `vehicle_code` / `station_id` 不存在 | 見下 |
| `429` | 輪詢過於頻繁 | 附 `Retry-After` 標頭 |
| `503` | MQTT 中斷或無可用班表 | 見下 |

### 錯誤回應範例

`400` — 參數格式錯誤：

```json
{
  "error": "INVALID_PARAM",
  "detail": "limit_per_station 必須為 1~10 的整數，收到 \"abc\""
}
```

`404` — 找不到指定對象：

```json
{
  "error": "NOT_FOUND",
  "detail": "vehicle_code \"PMS-99\" 不存在"
}
```

`429` — 輪詢過於頻繁：

```
HTTP/1.1 429 Too Many Requests
Retry-After: 7
```

```json
{
  "error": "RATE_LIMITED",
  "detail": "最小輪詢間隔為 10 秒，請於 7 秒後重試"
}
```

`503` — 服務降級：

```json
{
  "error": "SERVICE_DEGRADED",
  "detail": "MQTT broker 連線中斷，無法提供即時 ETA",
  "status": "DOWN"
}
```

**降級原則**：中心端**寧可回 `503` 或把該車標成 `UNKNOWN`，也不回舊資料當現況**。監控系統據此顯示「資料中斷」而非錯誤的 ETA。

---

## 十三、典型串接情境（完整走一遍）

以下是 SCADA 端每一輪應執行的邏輯。

### 步驟 1：確認資料還活著

```bash
curl -s ".../vehicles/feed-status" -H "X-API-Key: <KEY>"
```

```json
{ "status": "OK", "oldest_data_age_seconds": 3 }
```

- `status = "DOWN"` → **停止**，全畫面顯示「資料中斷」，本輪結束。
- `status = "DEGRADED"` → 繼續，但畫面加上「部分資料異常」提示。
- `status = "OK"` → 繼續。

### 步驟 2：取站別 ETA

```bash
curl -s ".../vehicles/eta/by-station?station_id=station_4" \
  -H "X-API-Key: <KEY>" -H 'If-None-Match: "<上次的 ETag>"'
```

- 回 `304` → 沿用上一份資料，跳到步驟 4。
- 回 `200` → 用新資料更新畫面。

### 步驟 3：逐筆決定怎麼顯示

```
for each eta in stations[].etas:
    if eta.confidence == "STALE" or eta.arrival_state == "UNKNOWN":
        顯示「—」                                  ← 不可用舊值
    elif eta.has_alert and 該車的 eta_impact == "ETA_UNAVAILABLE":
        顯示「資料中斷」
    elif eta.arrival_state == "APPROACHING":
        顯示「即將進站」（閃爍）
    elif eta.arrival_state == "AT_STATION":
        顯示「停靠中」
    else:
        剩餘秒數 = eta.eta_at - 現在時間              ← 用絕對時間，不是 eta_seconds
        顯示「約 N 分鐘」
        if eta.plan.delay_state in ("MINOR_DELAY", "MAJOR_DELAY"):
            加註「誤點」
```

### 步驟 4：取異常清單更新告警看板

```bash
curl -s ".../vehicles/alerts?active_only=true" -H "X-API-Key: <KEY>"
```

以 `alert_id` 為主鍵做增量更新：新的 `alert_id` 新增一列；已存在的更新 `updated_at`；不在本次回應中的視為已解除，自看板移除。

### 步驟 5：等待下一輪

以 **30 秒為基本節拍**：每拍取 `feed-status` 與 `alerts`，每兩拍取一次 `eta/by-station`。

- **不要低於 10 秒** — 會收到 `429`。
- **`eta/by-station` 不要慢於 60 秒** — 會漏掉「即將進站」（門檻就是 60 秒）。

詳見第 11.1 節建議值。

---

## 十四、JSON Schema（端點 1，供程式驗證）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "RealtimeStationEtaResponse",
  "type": "object",
  "required": ["meta", "station_count", "stations"],
  "properties": {
    "meta": {
      "type": "object",
      "required": ["generated_at", "service_date", "data_quality"],
      "properties": {
        "generated_at": { "type": "integer", "description": "Epoch ms" },
        "generated_at_iso": { "type": "string", "format": "date-time" },
        "service_date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
        "shift_id": { "type": ["string", "null"] },
        "source": { "enum": ["published", "draft_fallback", "none"] },
        "data_quality": { "enum": ["OK", "DEGRADED", "DOWN"] }
      }
    },
    "station_count": { "type": "integer", "minimum": 0 },
    "stations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["station_id", "station_name", "etas"],
        "properties": {
          "station_id": { "type": "string" },
          "station_name": { "type": "string" },
          "station_alias": { "type": ["string", "null"] },
          "etas": { "type": "array", "items": { "$ref": "#/$defs/EtaEntry" } }
        }
      }
    }
  },
  "$defs": {
    "EtaEntry": {
      "type": "object",
      "required": [
        "vehicle_code", "arrival_state", "eta_seconds", "eta_at",
        "confidence", "observed_at", "data_age_seconds"
      ],
      "properties": {
        "vehicle_code": { "type": "string", "pattern": "^PMS-\\d{2}$" },
        "order_id": { "type": ["string", "null"] },
        "trip_code": { "type": ["string", "null"] },
        "route_code": { "type": ["string", "null"] },
        "route_name": { "type": ["string", "null"] },
        "arrival_state": {
          "enum": ["EN_ROUTE", "APPROACHING", "DOCKING", "AT_STATION", "DEPARTED", "UNKNOWN"]
        },
        "eta_seconds": {
          "type": ["integer", "null"],
          "minimum": 0,
          "description": "距到站秒數；arrival_state 為 UNKNOWN 時為 null"
        },
        "eta_at": { "type": ["integer", "null"], "description": "預計到站絕對時間 Epoch ms" },
        "eta_clock": { "type": ["string", "null"], "pattern": "^\\d{2}:\\d{2}:\\d{2}$" },
        "distance_to_station_m": { "type": ["number", "null"], "minimum": 0 },
        "confidence": { "enum": ["HIGH", "MEDIUM", "LOW", "STALE"] },
        "vehicle_phase": { "type": ["string", "null"] },
        "plan": {
          "type": ["object", "null"],
          "properties": {
            "planned_arrival_clock": { "type": ["string", "null"] },
            "planned_arrival_at": { "type": ["integer", "null"] },
            "planned_departure_clock": { "type": ["string", "null"] },
            "delay_seconds": { "type": ["integer", "null"] },
            "delay_state": {
              "enum": ["EARLY", "ON_TIME", "MINOR_DELAY", "MAJOR_DELAY", "NO_PLAN"]
            }
          }
        },
        "has_alert": { "type": "boolean" },
        "observed_at": { "type": "integer" },
        "data_age_seconds": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

---

## 十五、待確認事項（提供給對方一併回覆）

這些是**我方無法單方面決定**、需要與監控系統／SCADA 端一起敲定的：

| # | 項目 | 我方建議 | 需對方確認 |
|---|------|---------|-----------|
| 1 | `APPROACHING` 門檻 | 60 秒 或 200 公尺 | 監控畫面希望提前多久提示？ |
| 2 | 誤點門檻 | 輕微 60s／顯著 180s | 是否符合營運定義？ |
| 3 | 失聯判定 | 連續 90 秒未收到車端回報 | SCADA 端可接受的判定時間？ |
| 4 | 每站回傳筆數 | 3 | 站顯要顯示幾班？ |
| 5 | 傳輸安全 | HTTPS + API Key（`X-API-Key` 標頭） | 或改用 mTLS？SCADA 支援哪一種？ |
| 6 | 網段與埠 | 待配 | 正式環境 IP／埠／防火牆規則 |
| 7 | `vehicle_phase` 完整列舉 | 目前協議僅出現 `TRANSITING`、`FAULTED` | **需車端補齊完整列舉** |
| 8 | 站點命名 | 沿用地圖編輯器 `station_id` | 監控系統是否已有自己的站碼？需要對照表嗎？ |
| 9 | 歷史查詢 | 本版不含 | 是否需要「過去 N 分鐘」的 ETA 軌跡？ |
| 10 | **輪詢頻率** | ETA 60 秒／異常與饋送狀態 30 秒（見 11.1） | 是否採用此排程？`eta/by-station` 不可慢於 60 秒，否則會漏掉「即將進站」 |

> **取用方式已談定，不在待確認之列**：本 API 為**固定頻率取用（pull-only）**，
> 中心端不推播、不做新資料通知。本表第 10 項只確認**頻率**，不重開推播與否的討論。

---

## 十六、實作狀態

### 已上線（本 API 直接沿用，不需重做）

| 項目 | 位置 |
|------|------|
| MQTT 訂閱六支 topic（telemetry／health／operation／event／command ack／slot） | `backend/src/mqtt/mqtt.controller.ts` |
| 車輛最新狀態快取（Redis） | `backend/src/redis/redis.service.ts` |
| 資料驗證與健康劣化偵測 | 同上（見 3.1） |
| 車輛狀態快照 API | `GET /syncdrive-api/vehicles/snapshot` |
| WebSocket 即時廣播 | `backend/src/events/events.gateway.ts` |
| 計畫 ETA（`plan` 區塊資料源） | `GET /syncdrive-api/operation-shift/timetable/station-etas` |
| 地圖站點與拓撲 | `GET /syncdrive-api/map/:mapId/stations/:stationId` |

### 本文件新增（待實作）

| 端點 | 狀態 | 主要工作 |
|------|------|---------|
| `GET /vehicles/eta/by-station` | **未實作** | 依站索引 + ETA 外推 + 併計畫值 |
| `GET /vehicles/eta/by-vehicle` | **未實作** | ETA 外推 + 併計畫值 |
| `GET /vehicles/alerts` | **未實作** | 告警彙整、去重、生命週期（`alert_id` 穩定） |
| `GET /vehicles/feed-status` | **未實作** | 逾時判定與 `status` 彙總 |

**評估**：三層基礎（MQTT 接收、Redis 快取、資料驗證）都已就緒，本 API 屬於在既有快取之上的**讀取與換算層**，不涉及新的資料通道或儲存。

---

## 相關文件

- 班表 Timetable API — 計畫 ETA
- 車輛動態協議 — 位置／速度來源
- 營運任務狀態協議 — `current_leg.eta_seconds` 來源
- 設備健康與異常告警協議 — 異常來源
- MQTT 通訊架構與 Topic 命名規範
- 點位拓撲規格

# 車輛即時 ETA API 規格書

<div class="doc-hero">
  <p class="doc-eyebrow">SYNCDRIVE T3 · REALTIME ETA API</p>
  <h2>即將進站／預計到達／異常狀況</h2>
  <p>車輛監控系統經 SCADA 以 HTTP GET 輪詢取得全線即時 ETA 與異常狀態。</p>
</div>

> **一句話**
> 車端以 MQTT 1Hz 回報位置與任務進度，SyncDrive 聚合成「站別／車別即時 ETA」快照；監控系統經 SCADA 每 30–60 秒 GET 一次，取得**即將進站**、**預計到達**與**異常狀況**。

**文件狀態**：`DRAFT v0.1` — 待雙方確認後定版
**更新日期**：2026-08-16
**Base URL**：`http://127.0.0.1:3000`（正式環境待配）
**Swagger**：`http://127.0.0.1:3000/api/docs`

---

## 〇、這份文件與既有文件的分工

| 文件 | 回答什麼 | 資料性質 |
|------|---------|---------|
| [班表 Timetable API](班表Timetable-API.md) | 「**按表**幾點到？」 | **計畫值**。由已發布班表推算，`vehicle_id` 恆為 `null`，不含車輛實際位置 |
| **本文件** | 「**現在實際**幾點到？有沒有異常？」 | **即時值**。以車端回報推算，含車輛識別、誤差與異常 |
| [車輛動態協議](車輛動態協議.md) | 車輛位置／速度／姿態 | MQTT 上行，1Hz，本 API 的輸入之一 |
| [營運任務狀態協議](營運任務狀態協議.md) | 任務進度、`current_leg.eta_seconds` | MQTT 上行，1Hz，**本 API 的 ETA 主要來源** |
| [設備健康與異常告警協議](設備健康與異常告警協議.md) | 硬體子系統異常 | MQTT 上行，本 API `alerts` 的來源之一 |

**本 API 不重新發明 ETA**：車端自駕系統已在 `current_leg.eta_seconds` 提供到下一站的推估，本 API 以它為主要真值，再往後續站點外推。

---

## 一、系統架構與資料流

```
┌────────────┐   MQTT 1Hz                ┌──────────────┐   HTTP GET      ┌───────┐      ┌──────────────┐
│  車輛      │ ─ telemetry/update ─────▶ │              │  30~60s 輪詢    │       │      │   車輛監控    │
│  PMS-01    │ ─ operation/update ─────▶ │  SyncDrive   │ ◀────────────── │ SCADA │ ◀──▶ │   系統        │
│  ~ PMS-11  │ ─ health/heartbeat ─────▶ │  T3 中心端   │ ──────────────▶ │       │      │              │
└────────────┘                           └──────────────┘   JSON 快照     └───────┘      └──────────────┘
                                                │
                                                │ 對照
                                                ▼
                                        已發布班表（計畫 ETA）
                                        → 算出誤差 delay_seconds
```

**權責邊界**（沿用[營運任務狀態協議](營運任務狀態協議.md)第一章）：
- 車端是 `vehicle_phase`、`overall_health`、`current_leg` 的**唯一真值源**。
- 中心端只做**聚合、外推、與計畫值比對**，不覆寫車端狀態。
- 本 API 為**唯讀**，不提供任何寫入或控制端點。控制指令走[動態控制與特殊事件協議](動態控制與特殊事件協議.md)。

---

## 二、命名與代碼規範

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

> **跨午夜**：營運日以 `service_date` 標記；`HH:MM:SS` 允許超過 `24:00:00` 表示跨日班次（與班表 API 一致）。絕對時間一律另附 Epoch 毫秒欄位，不需自行換算。

---

## 三、端點總覽

| # | 端點 | 用途 | 建議輪詢 |
|---|------|------|---------|
| 1 | `GET /syncdrive-api/realtime/eta/stations` | **依站**：每站接下來會到的車 | 30–60s |
| 2 | `GET /syncdrive-api/realtime/eta/vehicles` | **依車**：每台車接下來會到的站 | 30–60s |
| 3 | `GET /syncdrive-api/realtime/alerts` | 異常狀況清單 | 30s |
| 4 | `GET /syncdrive-api/realtime/health` | 資料新鮮度與系統可用性 | 30s |

> **給 SCADA 的建議**：端點 1 與 3 即可滿足站顯與告警看板；端點 2 供車輛追蹤畫面；端點 4 用來判斷「資料是不是還活著」，避免把過期資料當成現況顯示。

---

## 四、端點 1：依站即時 ETA

### `GET /syncdrive-api/realtime/eta/stations`

| Query | 必填 | 預設 | 說明 |
|-------|------|------|------|
| `station_id` | 否 | 全部 | 只取單一站；可重複帶多個 |
| `limit_per_station` | 否 | `3` | 每站回傳幾筆最近的到站預測 |
| `include_plan` | 否 | `true` | 是否附上計畫值與誤差 |

### 回應範例

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
            "delay_state": "MINOR_DELAY"
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

> **空陣列不是錯誤**：該站當下沒有駛近的車，`etas` 為 `[]`。回應仍會列出**地圖上全部停靠點**，方便站顯固定頁籤（與班表 ETA API 行為一致）。

---

## 五、端點 2：依車即時 ETA

### `GET /syncdrive-api/realtime/eta/vehicles`

| Query | 必填 | 預設 | 說明 |
|-------|------|------|------|
| `vehicle_code` | 否 | 全部 | 只取單一車；可重複帶多個 |
| `next_stops` | 否 | `3` | 每台車往後推幾站 |

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
        }
      ],
      "observed_at": 1716536398000,
      "data_age_seconds": 2
    }
  ]
}
```

---

## 六、端點 3：異常狀況

### `GET /syncdrive-api/realtime/alerts`

| Query | 必填 | 預設 | 說明 |
|-------|------|------|------|
| `severity` | 否 | 全部 | `WARNING` / `ERROR` / `CRITICAL` |
| `vehicle_code` | 否 | 全部 | 只取單一車 |
| `active_only` | 否 | `true` | 只取尚未解除的異常 |

### 回應範例

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

---

## 七、端點 4：資料新鮮度與可用性

### `GET /syncdrive-api/realtime/health`

供 SCADA 判斷「這份資料還能不能用」。**建議監控系統在顯示 ETA 前先確認此端點**，避免把過期資料當成現況。

```json
{
  "generated_at": 1716536400000,
  "status": "OK",
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

| `status` | 意義 | 監控系統建議行為 |
|----------|------|-----------------|
| `OK` | 全部車輛回報正常 | 正常顯示 |
| `DEGRADED` | 部分車輛逾時或班表未載入 | 顯示但標示不確定 |
| `DOWN` | MQTT 中斷或無班表 | **不得顯示 ETA**，改顯示「資料中斷」 |

---

## 八、欄位字典

### 8.1 到站狀態 `arrival_state`

**這就是需求裡的「即將進站／預計到達」**。以車端 `current_leg.distance_to_target_m` 與 `eta_seconds` 判定：

| 值 | 中文 | 判定條件（建議，門檻待雙方確認） | 監控畫面用途 |
|----|------|--------------------------------|------------|
| `EN_ROUTE` | 行駛中 | 尚未進入接近門檻 | **預計到達**：顯示 ETA 分鐘數 |
| `APPROACHING` | **即將進站** | `eta_seconds ≤ 60` 或 `distance_to_station_m ≤ 200` | **即將進站**：閃爍／進站提示 |
| `DOCKING` | 進站對位中 | `PLATFORM_DOCKING` 任務為 `IN_PROGRESS` | 進站中 |
| `AT_STATION` | 停靠中 | 車速為 0 且已完成 `PLATFORM_DOCKING` | 停靠中，顯示預計發車 |
| `DEPARTED` | 已離站 | `STATION_DEPARTURE` 已 `COMPLETED` | 自清單移除 |
| `UNKNOWN` | 無法判定 | 車端資料逾時或缺欄位 | 顯示「—」，不可顯示舊 ETA |

> `APPROACHING` 的兩個門檻（60 秒／200 公尺）是**建議值**，需依實際站體幾何與監控系統的提示時機調整。這是**待確認事項**，見第十二章。

### 8.2 誤點狀態 `delay_state`

計畫值取自已發布班表（[班表 Timetable API](班表Timetable-API.md) 的 `station-etas`）。

| 值 | 條件（建議） | 說明 |
|----|-------------|------|
| `EARLY` | `delay_seconds < -30` | 早到 |
| `ON_TIME` | `-30 ≤ delay_seconds ≤ 60` | 準點 |
| `MINOR_DELAY` | `60 < delay_seconds ≤ 180` | 輕微誤點 |
| `MAJOR_DELAY` | `delay_seconds > 180` | 顯著誤點，同時產生 `SCHEDULE_DEVIATION` 告警 |
| `NO_PLAN` | 無對應計畫班次 | 加班車／調度車，不判定誤點 |

`delay_seconds` 為正表示**晚於**計畫。

### 8.3 可信度 `confidence`

ETA 越往後推越不準，必須讓監控端知道。

| 值 | 條件 | 說明 |
|----|------|------|
| `HIGH` | 下一站，且 `data_age_seconds ≤ 5` | 直接採用車端 `current_leg.eta_seconds` |
| `MEDIUM` | 往後第 2–3 站，或 `data_age_seconds ≤ 30` | 以班表站間旅行時間外推 |
| `LOW` | 更遠的站，或 `data_age_seconds > 30` | 僅供參考 |
| `STALE` | `data_age_seconds > 90` | **不應顯示**，應改判 `UNKNOWN` |

### 8.4 異常分類 `category`

| 值 | 來源 | 說明 |
|----|------|------|
| `VEHICLE_HEALTH` | [設備健康與異常告警協議](設備健康與異常告警協議.md) 的 `subsystems` | 硬體子系統異常，`code` 直接沿用該協議的 `error_codes` |
| `SCHEDULE_DEVIATION` | 本系統計算 | 誤點超過門檻 |
| `COMMUNICATION` | 本系統偵測 | 車端回報逾時／失聯 |
| `OPERATION` | [營運任務狀態協議](營運任務狀態協議.md) | 任務 `FAILED`、卡在 `IN_PROGRESS` 過久 |
| `SAFETY` | 車端 | MRM（最低風險操作）觸發、強制召回 |

### 8.5 異常對 ETA 的影響 `eta_impact`

**這一欄是給監控系統做顯示決策用的**，不必自行解讀各種 `code`：

| 值 | 監控系統應如何處理該車的 ETA |
|----|---------------------------|
| `NONE` | 照常顯示 |
| `ETA_DEGRADED` | 顯示但標示「可能延誤」 |
| `ETA_UNRELIABLE` | 顯示但明確標示不可信 |
| `ETA_UNAVAILABLE` | **不得顯示 ETA** |

### 8.6 共用欄位

| 欄位 | 型別 | 說明 |
|------|------|------|
| `observed_at` | Long | 這筆推估所依據的**車端回報時間**（Epoch ms） |
| `data_age_seconds` | Int | `generated_at - observed_at`，資料有多舊 |
| `generated_at` | Long | 中心端產生本快照的時間 |
| `service_date` | String | 營運日 `YYYY-MM-DD`，跨午夜班次仍屬前一營運日 |
| `source` | String | `published`（已發布班表）／`draft_fallback`（未發布，計畫值僅供參考） |

---

## 九、輪詢、快取與傳輸

需求所述頻率為 **30 秒 ~ 1 分鐘**。

| 項目 | 規範 |
|------|------|
| 建議間隔 | 30s（告警）／60s（ETA） |
| 最小間隔 | 10s。低於此值中心端回 `429 Too Many Requests` |
| 條件式請求 | 支援 `ETag` / `If-None-Match`；資料未變回 `304 Not Modified`，減少頻寬 |
| 快取標頭 | `Cache-Control: no-cache, max-age=0`（永遠回中心端驗證，但可用 304） |
| 壓縮 | 支援 `Accept-Encoding: gzip` |
| 逾時建議 | SCADA 端設 5 秒；逾時視同 `DOWN`，沿用上一筆並標示過期 |
| 時鐘 | 雙方需 NTP 同步。所有 Epoch 為 UTC 毫秒；`*_clock` 為營運現地時間 |

> **重要**：本 API 為 30–60 秒輪詢，與車端 1Hz 的 MQTT 是不同數量級。ETA 在兩次輪詢之間會繼續變化，監控系統**不應**把 `eta_seconds` 當成從收到那一刻起算的倒數；請以 `eta_at`（絕對時間）為準自行倒數。

---

## 十、錯誤處理

| HTTP | 情況 | 回應 |
|------|------|------|
| `200` | 正常（含 `etas: []`） | 見上 |
| `304` | 帶 `If-None-Match` 且資料未變 | 無 body |
| `400` | 參數格式錯誤 | `{ "error": "INVALID_PARAM", "detail": "..." }` |
| `404` | 指定的 `vehicle_code` / `station_id` 不存在 | `{ "error": "NOT_FOUND", "detail": "..." }` |
| `429` | 輪詢過於頻繁 | 附 `Retry-After` 標頭 |
| `503` | MQTT 中斷或無可用班表 | `{ "error": "SERVICE_DEGRADED", "detail": "...", "status": "DOWN" }` |

**降級原則**：中心端**寧可回 `503` 或把該車標成 `UNKNOWN`，也不回舊資料當現況**。監控系統據此顯示「資料中斷」而非錯誤的 ETA。

---

## 十一、JSON Schema（端點 1，供程式驗證）

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
          "etas": {
            "type": "array",
            "items": { "$ref": "#/$defs/EtaEntry" }
          }
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

## 十二、待確認事項（提供給對方一併回覆）

這些是**我方無法單方面決定**、需要與監控系統／SCADA 端一起敲定的：

| # | 項目 | 我方建議 | 需對方確認 |
|---|------|---------|-----------|
| 1 | `APPROACHING` 門檻 | 60 秒 或 200 公尺 | 監控畫面希望提前多久提示？ |
| 2 | 誤點門檻 | 輕微 60s／顯著 180s | 是否符合營運定義？ |
| 3 | 失聯判定 | 連續 90 秒未收到車端回報 | SCADA 端可接受的判定時間？ |
| 4 | 每站回傳筆數 | 3 | 站顯要顯示幾班？ |
| 5 | 傳輸安全 | HTTPS + API Key（`X-API-Key` 標頭） | 或改用 mTLS？SCADA 支援哪一種？ |
| 6 | 網段與埠 | 待配 | 正式環境 IP／埠／防火牆規則 |
| 7 | `vehicle_phase` 完整列舉 | 目前協議僅出現 `TRANSITING`、`FAULTED` | **需車端補齊完整列舉**，本 API 才能定義對應 |
| 8 | 站點命名 | 沿用地圖編輯器 `station_id` | 監控系統是否已有自己的站碼？需要對照表嗎？ |
| 9 | 歷史查詢 | 本版不含 | 是否需要「過去 N 分鐘」的 ETA 軌跡？ |
| 10 | 推播 | 本版僅輪詢 | 異常是否需要即時推播（WebSocket／MQTT bridge）而非等下次輪詢？ |

---

## 十三、實作狀態

| 端點 | 狀態 |
|------|------|
| 1 `eta/stations` | **未實作** — 本文件為規格草案 |
| 2 `eta/vehicles` | **未實作** |
| 3 `alerts` | **未實作** |
| 4 `health` | **未實作** |

**已具備的基礎**：
- 車端 MQTT 三支協議已定義（動態／營運／健康）
- 已發布班表的計畫 ETA 已實作（`/timetable/station-etas`），可直接作為 `plan` 區塊的資料源
- 地圖站點與拓撲已具備（[點位拓撲規格](點位拓撲規格.md)）

**尚缺**：MQTT 訂閱與車輛狀態聚合層、即時 ETA 外推、告警彙整與去重。

---

## 十四、相關文件

- [班表 Timetable API](班表Timetable-API.md) — 計畫 ETA
- [車輛動態協議](車輛動態協議.md) — 位置／速度來源
- [營運任務狀態協議](營運任務狀態協議.md) — `current_leg.eta_seconds` 來源
- [設備健康與異常告警協議](設備健康與異常告警協議.md) — 異常來源
- [MQTT 通訊架構與 Topic 命名規範](MQTT%20通訊架構與%20Topic%20命名規範.md)
- [點位拓撲規格](點位拓撲規格.md)

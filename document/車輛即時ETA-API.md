# 車輛即時 ETA API 規格書

| 項目 | 內容 |
|------|------|
| 版本 | v1.0 |
| 發布日期 | 2026-08-16 |
| 提供方 | 台智駕 SyncDrive T3 |
| 使用方 | 車輛監控系統（經 SCADA） |
| 通訊方式 | HTTP / JSON，GET，唯讀 |
| 取用模式 | 固定頻率輪詢（pull-only） |
| Base URL | `http://127.0.0.1:3000`（正式環境依部署配置） |
| API 文件 | `http://127.0.0.1:3000/api/docs`（Swagger） |

本規格定義車輛監控系統取得**即將進站**、**預計到達**與**異常狀況**的介面。使用方以固定頻率輪詢取得全線即時快照；本介面不主動推播，亦不在資料更新時發出通知。

本文中的「必須」表示強制要求，「應」表示強烈建議，「可」表示選用。

---

## 目錄

1. [服務範圍](#一服務範圍)
2. [系統架構](#二系統架構)
3. [通訊規範](#三通訊規範)
4. [共用約定](#四共用約定)
5. [端點總覽](#五端點總覽)
6. [端點 1：依站即時 ETA](#六端點-1依站即時-eta)
7. [端點 2：依車即時 ETA](#七端點-2依車即時-eta)
8. [端點 3：異常狀況](#八端點-3異常狀況)
9. [端點 4：資料饋送狀態](#九端點-4資料饋送狀態)
10. [資料模型](#十資料模型)
11. [輪詢規範](#十一輪詢規範)
12. [錯誤處理](#十二錯誤處理)
13. [整合指引](#十三整合指引)
14. [JSON Schema](#十四json-schema)
15. [部署配置參數](#十五部署配置參數)
16. [附錄：與計畫 ETA 的關係](#十六附錄與計畫-eta-的關係)

---

## 一、服務範圍

### 1.1 提供的資料

| 類別 | 內容 | 對應端點 |
|------|------|---------|
| 即將進站 | 車輛已進入到站門檻，站端應顯示進站提示 | 端點 1、2 |
| 預計到達 | 車輛預計抵達各站的時刻與剩餘秒數 | 端點 1、2 |
| 異常狀況 | 車輛健康、營運誤點、通訊中斷、安全事件 | 端點 3 |
| 資料可用性 | 本介面資料的新鮮度與服務狀態 | 端點 4 |

### 1.2 不在範圍內

- 車輛控制指令下發
- 歷史資料查詢與軌跡回放
- 事件推播與訂閱

---

## 二、系統架構

### 2.1 資料鏈路

```
┌──────────┐   MQTT 1Hz    ┌────────────────────┐   HTTP GET     ┌───────┐     ┌──────────────┐
│ 車輛     │──────────────▶│                    │  固定頻率輪詢   │       │     │  車輛監控     │
│ PMS-01   │  telemetry    │   SyncDrive T3     │◀───────────────│ SCADA │◀───▶│  系統         │
│ ~ PMS-11 │  health       │   中心端           │───────────────▶│       │     │              │
│          │  operation    │                    │   JSON 快照     └───────┘     └──────────────┘
└──────────┘               └────────────────────┘
                                     │
                                     ▼
                              已發布班表（計畫值）
                              用於計算誤差 delay_seconds
```

### 2.2 資料來源

| 資料 | 來源 | 更新頻率 |
|------|------|---------|
| 車輛位置、速度 | 車端 MQTT `telemetry/update` | 1 Hz |
| 到站推估、任務進度 | 車端 MQTT `operation/update` | 1 Hz |
| 子系統健康狀態 | 車端 MQTT `health/heartbeat` | 1 Hz 及狀態變更時 |
| 計畫到站時刻 | 已發布班表 | 班表發布時 |

車端為 `vehicle_phase`、`overall_health`、`current_leg` 的唯一真值源。中心端執行聚合、外推與計畫值比對，不覆寫車端狀態。

### 2.3 快照語意

每次回應為當下的完整快照，非增量更新。使用方無需處理訊息順序或補漏；未取得的輪次不會造成資料落後，下一輪即補齊。

---

## 三、通訊規範

| 項目 | 規範 |
|------|------|
| 協定 | HTTP/1.1 以上 |
| 方法 | `GET` |
| 回應格式 | `application/json; charset=utf-8` |
| 認證 | `X-API-Key` 請求標頭 |
| 壓縮 | 支援 `Accept-Encoding: gzip`，應啟用 |
| 連線 | 應使用 `Connection: keep-alive` |
| 條件式請求 | 支援 `ETag` / `If-None-Match` |
| 請求逾時 | 使用方應設定 5 秒 |
| 時鐘同步 | 雙方必須以 NTP 同步 |

### 3.1 請求標頭

```http
GET /syncdrive-api/vehicles/eta/by-station HTTP/1.1
Host: 127.0.0.1:3000
X-API-Key: <API_KEY>
Accept: application/json
Accept-Encoding: gzip
If-None-Match: "a1b2c3d4"
```

### 3.2 回應標頭

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Encoding: gzip
ETag: "e5f6a7b8"
Cache-Control: no-cache, max-age=0
```

---

## 四、共用約定

### 4.1 識別碼格式

| 欄位 | 格式 | 範例 |
|------|------|------|
| `vehicle_code` | `PMS-` + 兩碼數字 | `PMS-05` |
| `trip_code` | 路線代號 + `HHMM` | `ST0007` |
| `order_id` | `[YYMMDD]-[trip_code]` | `260816-ST0007` |
| `station_id` | 地圖停靠點識別碼 | `station_4` |
| `alert_id` | `AL-[YYYYMMDD]-[六碼序號]` | `AL-20260816-000117` |

### 4.2 時間表示

| 欄位型式 | 型別 | 說明 |
|---------|------|------|
| `*_at` | Long | Unix Epoch 毫秒（UTC） |
| `*_clock` | String | `HH:MM:SS`，營運日內時刻 |
| `service_date` | String | `YYYY-MM-DD`，營運日 |

跨午夜班次的 `*_clock` 允許超過 `24:00:00`，`service_date` 維持發車當日。

```json
{
  "service_date": "2026-08-16",
  "eta_clock": "25:10:30",
  "eta_at": 1716606630000
}
```

上例為營運日 2026-08-16 的班次，實際到站時間為 2026-08-17 01:10:30。使用方應以 `*_at` 進行運算，`*_clock` 僅供顯示。

### 4.3 列舉值

所有列舉值使用 `SCREAMING_SNAKE_CASE`。使用方應忽略未知列舉值並套用預設處理：`arrival_state` 未知時視為 `UNKNOWN`，`eta_impact` 未知時視為 `ETA_UNRELIABLE`。

### 4.4 空值語意

| 情形 | 表示 |
|------|------|
| 該站當下無車駛近 | `etas: []` |
| 無法推估到站時刻 | `eta_seconds`、`eta_at`、`eta_clock` 皆為 `null` |
| 無對應計畫班次 | `plan.delay_seconds` 為 `null`，`plan.delay_state` 為 `NO_PLAN` |

回應中列出地圖上全部停靠點，包含當下無車駛近者，以利站端固定顯示版面。

---

## 五、端點總覽

| # | 端點 | 用途 | 建議輪詢間隔 |
|---|------|------|------------|
| 1 | `GET /syncdrive-api/vehicles/eta/by-station` | 依站索引的即時 ETA | 60 秒 |
| 2 | `GET /syncdrive-api/vehicles/eta/by-vehicle` | 依車索引的即時 ETA | 60 秒 |
| 3 | `GET /syncdrive-api/vehicles/alerts` | 異常狀況清單 | 30 秒 |
| 4 | `GET /syncdrive-api/vehicles/feed-status` | 資料饋送狀態 | 30 秒 |

---

## 六、端點 1：依站即時 ETA

```
GET /syncdrive-api/vehicles/eta/by-station
```

回傳各停靠點接下來將抵達的車輛預測。

### 6.1 查詢參數

| 參數 | 型別 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `station_id` | String | 否 | 全部 | 指定停靠點，可重複指定多個 |
| `limit_per_station` | Int | 否 | `3` | 每站回傳筆數，值域 1–10 |
| `include_plan` | Boolean | 否 | `true` | 是否附帶計畫值與誤差 |

### 6.2 請求範例

全線各站，每站 3 筆：

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-station" \
  -H "X-API-Key: <API_KEY>"
```

指定單一停靠點：

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-station?station_id=station_4" \
  -H "X-API-Key: <API_KEY>"
```

指定多站、每站 1 筆、不含計畫值：

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-station\
?station_id=station_4&station_id=station_2&limit_per_station=1&include_plan=false" \
  -H "X-API-Key: <API_KEY>"
```

### 6.3 回應：一般情形

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

### 6.4 回應：車輛停靠中

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

`arrival_state` 為 `AT_STATION` 時，`plan.planned_departure_clock` 提供預計發車時刻。

### 6.5 回應：顯著誤點且伴隨異常

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

`has_alert` 為 `true` 時，對應告警可於端點 3 以 `vehicle_code` 查得。

### 6.6 回應：車輛資料逾時

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

`arrival_state` 為 `UNKNOWN` 時，使用方必須顯示資料中斷，不得沿用先前取得的 ETA。

---

## 七、端點 2：依車即時 ETA

```
GET /syncdrive-api/vehicles/eta/by-vehicle
```

回傳各車輛接下來將抵達的停靠點預測。

### 7.1 查詢參數

| 參數 | 型別 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `vehicle_code` | String | 否 | 全部 | 指定車輛，可重複指定多個 |
| `next_stops` | Int | 否 | `3` | 每車往後推算站數，值域 1–10 |

### 7.2 請求範例

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-vehicle" \
  -H "X-API-Key: <API_KEY>"
```

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-vehicle?vehicle_code=PMS-05&next_stops=5" \
  -H "X-API-Key: <API_KEY>"
```

### 7.3 回應

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

`confidence` 隨 `sequence` 遞減：第 1 站採用車端直接推估，第 2 站以後由中心端依班表站間旅行時間外推。

---

## 八、端點 3：異常狀況

```
GET /syncdrive-api/vehicles/alerts
```

### 8.1 查詢參數

| 參數 | 型別 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `severity` | String | 否 | 全部 | `WARNING` / `ERROR` / `CRITICAL` |
| `vehicle_code` | String | 否 | 全部 | 指定車輛 |
| `active_only` | Boolean | 否 | `true` | `true` 僅回傳未解除者 |

### 8.2 請求範例

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/alerts" \
  -H "X-API-Key: <API_KEY>"
```

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/alerts?severity=CRITICAL" \
  -H "X-API-Key: <API_KEY>"
```

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/alerts?vehicle_code=PMS-05&active_only=false" \
  -H "X-API-Key: <API_KEY>"
```

### 8.3 回應

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

### 8.4 告警生命週期

同一車輛的同一 `code` 在持續期間內僅對應一筆 `alert_id`，不隨輪詢重複產生。使用方應以 `alert_id` 為主鍵維護看板狀態。

告警解除時，`resolved_at` 填入解除時刻，`active` 轉為 `false`，`eta_impact` 轉為 `NONE`。以 `active_only=false` 查詢可取得已解除者：

```json
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
  "updated_at": 1716536520000,
  "resolved_at": 1716536520000,
  "active": false,
  "eta_impact": "NONE"
}
```

---

## 九、端點 4：資料饋送狀態

```
GET /syncdrive-api/vehicles/feed-status
```

回報本介面資料的新鮮度與服務可用性。使用方應於顯示 ETA 前先取得本端點。

### 9.1 請求範例

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/feed-status" \
  -H "X-API-Key: <API_KEY>"
```

### 9.2 回應：正常

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

### 9.3 回應：部分降級

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

### 9.4 回應：服務中斷

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

### 9.5 狀態處理

| `status` | 意義 | 使用方處理 |
|----------|------|-----------|
| `OK` | 全部車輛回報正常 | 正常顯示 |
| `DEGRADED` | 部分車輛逾時或班表未載入 | 顯示並標示不確定範圍 |
| `DOWN` | MQTT 中斷或無可用班表 | 必須停止顯示 ETA，改顯示資料中斷 |

`degraded_reasons` 值域：`VEHICLE_SIGNAL_LOST`、`MQTT_BROKER_DISCONNECTED`、`TIMETABLE_NOT_LOADED`。

---

## 十、資料模型

### 10.1 `arrival_state`（到站狀態）

| 值 | 意義 | 判定條件 |
|----|------|---------|
| `EN_ROUTE` | 行駛中 | 未達到站門檻 |
| `APPROACHING` | 即將進站 | `eta_seconds ≤ 60` 或 `distance_to_station_m ≤ 200` |
| `DOCKING` | 進站對位中 | 車端 `PLATFORM_DOCKING` 任務為 `IN_PROGRESS` |
| `AT_STATION` | 停靠中 | 車速為 0 且 `PLATFORM_DOCKING` 已完成 |
| `DEPARTED` | 已離站 | 車端 `STATION_DEPARTURE` 已完成 |
| `UNKNOWN` | 無法判定 | 車端資料逾時 |

門檻值可於部署時配置，見第十五章。

判定範例：

| 車端回報 | 判定 | 依據 |
|---------|------|------|
| `eta_seconds=25`、`distance=120m` | `APPROACHING` | 時間與距離門檻均成立 |
| `eta_seconds=45`、`distance=350m` | `APPROACHING` | 時間門檻成立 |
| `eta_seconds=90`、`distance=180m` | `APPROACHING` | 距離門檻成立 |
| `eta_seconds=415`、`distance=1840m` | `EN_ROUTE` | 兩項門檻均未成立 |
| 逾 90 秒未回報 | `UNKNOWN` | 資料逾時 |

### 10.2 `delay_state`（誤點狀態）

`delay_seconds` 為正值表示晚於計畫。

| 值 | 條件 |
|----|------|
| `EARLY` | `delay_seconds < -30` |
| `ON_TIME` | `-30 ≤ delay_seconds ≤ 60` |
| `MINOR_DELAY` | `60 < delay_seconds ≤ 180` |
| `MAJOR_DELAY` | `delay_seconds > 180` |
| `NO_PLAN` | 無對應計畫班次 |

`MAJOR_DELAY` 同時於端點 3 產生 `SCHEDULE_DEVIATION` 告警。

計算範例：

| 計畫到站 | 預計到站 | `delay_seconds` | `delay_state` |
|---------|---------|----------------|--------------|
| 09:00:10 | 09:00:25 | `15` | `ON_TIME` |
| 09:00:10 | 08:59:20 | `-50` | `EARLY` |
| 09:06:10 | 09:08:20 | `130` | `MINOR_DELAY` |
| 09:06:10 | 09:11:00 | `290` | `MAJOR_DELAY` |
| 無 | 09:11:00 | `null` | `NO_PLAN` |

### 10.3 `confidence`（推估可信度）

| 值 | 條件 | 推估方式 |
|----|------|---------|
| `HIGH` | 下一站且 `data_age_seconds ≤ 5` | 採用車端推估值 |
| `MEDIUM` | 第 2–3 站，或 `data_age_seconds ≤ 30` | 依班表站間旅行時間外推 |
| `LOW` | 更遠站點，或 `data_age_seconds > 30` | 同上，誤差累積較大 |
| `STALE` | `data_age_seconds > 90` | 不提供推估，`arrival_state` 轉為 `UNKNOWN` |

建議顯示方式：

| `confidence` | 顯示 |
|-------------|------|
| `HIGH` | 精確至秒，或「即將進站」 |
| `MEDIUM` | 「約 N 分鐘」 |
| `LOW` | 「約 N 分鐘」並降低視覺權重 |
| `STALE` | 「資料中斷」 |

### 10.4 `category`（異常分類）

| 值 | 說明 | `code` 範例 |
|----|------|------------|
| `VEHICLE_HEALTH` | 車輛子系統異常 | `LIDAR_FRONT_BLIND`、`RADAR_1_DISCONNECTED`、`NETWORK_5G_LATENCY_HIGH` |
| `SCHEDULE_DEVIATION` | 誤點超過門檻 | `MINOR_DELAY`、`MAJOR_DELAY` |
| `COMMUNICATION` | 通訊逾時或中斷 | `VEHICLE_SIGNAL_LOST`、`MQTT_BROKER_DISCONNECTED` |
| `OPERATION` | 營運任務異常 | `TASK_FAILED`、`INTERLOCK_TIMEOUT`、`DOCKING_TIMEOUT` |
| `SAFETY` | 安全事件 | `MRM_TRIGGERED`、`FORCED_RECALL` |

`subsystem` 僅於 `VEHICLE_HEALTH` 與 `COMMUNICATION` 分類時有值，值域為 `COMPUTING`、`SENSING`、`COMMUNICATION`、`CHASSIS`。

### 10.5 `eta_impact`（異常對 ETA 的影響）

供使用方直接決定顯示方式，無需解析個別 `code`。

| 值 | 使用方處理 | 建議顯示 |
|----|-----------|---------|
| `NONE` | 正常顯示 | 「約 5 分鐘」 |
| `ETA_DEGRADED` | 顯示並標示延誤 | 「約 5 分鐘（誤點）」 |
| `ETA_UNRELIABLE` | 顯示並標示不確定 | 「約 5 分鐘（資訊不確定）」 |
| `ETA_UNAVAILABLE` | 必須停止顯示 ETA | 「資料中斷」 |

### 10.6 `severity`（嚴重度）

| 值 | 意義 |
|----|------|
| `WARNING` | 營運品質受影響，服務持續 |
| `ERROR` | 車輛功能受限 |
| `CRITICAL` | 服務中斷或安全相關，需立即處置 |

### 10.7 共用欄位

| 欄位 | 型別 | 說明 |
|------|------|------|
| `generated_at` | Long | 本次快照產生時刻 |
| `observed_at` | Long | 推估所依據的車端回報時刻 |
| `data_age_seconds` | Int | `generated_at - observed_at`，單位秒 |
| `service_date` | String | 營運日 |
| `source` | String | `published`：讀取已發布班表；`draft_fallback`：讀取未發布草稿，計畫值僅供參考；`none`：無可用班表 |
| `data_quality` | String | 同端點 4 的 `status` |
| `has_alert` | Boolean | 該車是否存在未解除告警 |

---

## 十一、輪詢規範

### 11.1 建議輪詢間隔

| 端點 | 建議間隔 | 可接受範圍 | 依據 |
|------|---------|-----------|------|
| `eta/by-station` | **60 秒** | 30–60 秒 | 最短班距 180 秒，60 秒可於每一班距內更新約 3 次 |
| `eta/by-vehicle` | **60 秒** | 30–120 秒 | 車輛追蹤用途，非安全關鍵 |
| `alerts` | **30 秒** | 15–60 秒 | 失聯判定為 90 秒，30 秒可於判定成立後兩輪內呈現 |
| `feed-status` | **30 秒** | 15–60 秒 | 決定其他端點資料是否可顯示，不應慢於其他端點 |

建議排程：以 30 秒為基本節拍，`eta/by-station` 每兩拍取一次。

```
T+0s    feed-status, alerts, eta/by-station
T+30s   feed-status, alerts
T+60s   feed-status, alerts, eta/by-station
T+90s   feed-status, alerts
```

### 11.2 間隔上下限

| 限制 | 值 | 說明 |
|------|----|------|
| 最小間隔 | 10 秒 | 低於此值回應 `429 Too Many Requests` |
| `eta/by-station` 最大間隔 | **60 秒** | `APPROACHING` 門檻為 60 秒，間隔大於此值將無法觀測到即將進站狀態 |
| `alerts` 最大間隔 | 90 秒 | 失聯判定為 90 秒，間隔大於此值將延遲逾兩個判定週期 |

低於 15 秒的輪詢不提升顯示精度：ETA 的實質變化來自車輛移動，顯示精度為分鐘級。

### 11.3 重試與逾時

| 情形 | 處理 |
|------|------|
| 請求逾時（5 秒） | 沿用前一份資料並標示過期，等待下一排程週期 |
| `5xx` 回應 | 同上，不應立即重試 |
| `429` 回應 | 依 `Retry-After` 標頭延後 |
| `304` 回應 | 沿用前一份資料，視為成功 |

快照式資料無累積落差，補一輪即恢復。

### 11.4 ETag 使用

首次請求：

```http
GET /syncdrive-api/vehicles/eta/by-station HTTP/1.1
X-API-Key: <API_KEY>
```

```http
HTTP/1.1 200 OK
ETag: "a1b2c3d4"

{ "meta": { ... }, "stations": [ ... ] }
```

後續請求帶入 `If-None-Match`：

```http
GET /syncdrive-api/vehicles/eta/by-station HTTP/1.1
X-API-Key: <API_KEY>
If-None-Match: "a1b2c3d4"
```

資料未變更時：

```http
HTTP/1.1 304 Not Modified
ETag: "a1b2c3d4"
```

### 11.5 倒數計時實作要求

使用方必須以 `eta_at`（絕對時刻）計算剩餘時間，不得以 `eta_seconds` 自輪詢時刻起算倒數。

`eta_seconds` 為快照產生當下的值；兩次輪詢之間車輛持續移動，以該值倒數將累積誤差。

```
剩餘秒數 = (eta_at - 使用方當前時間) / 1000
```

### 11.6 頻寬估算

以 11 台車、10 個停靠點、每站 3 筆計算：

| 端點 | 未壓縮 | gzip | 依建議間隔之日流量 |
|------|-------|------|------------------|
| `eta/by-station` | 約 18 KB | 約 3 KB | 約 4.3 MB |
| `eta/by-vehicle` | 約 14 KB | 約 2.5 KB | 約 3.6 MB |
| `alerts` | 約 2 KB | 約 0.6 KB | 約 1.7 MB |
| `feed-status` | 約 0.5 KB | 約 0.3 KB | 約 0.9 MB |
| 合計 | — | — | **約 10.5 MB／日** |

啟用 `If-None-Match` 後，未變更輪次回應 `304`，實際流量低於上表。

---

## 十二、錯誤處理

| 狀態碼 | 情形 |
|-------|------|
| `200` | 成功，包含 `etas: []` 的空結果 |
| `304` | 資料未變更 |
| `400` | 參數格式錯誤 |
| `401` | 認證失敗 |
| `404` | 指定的 `vehicle_code` 或 `station_id` 不存在 |
| `429` | 超過輪詢頻率限制 |
| `503` | 服務降級，無法提供即時資料 |

### 12.1 錯誤回應格式

```json
{
  "error": "INVALID_PARAM",
  "detail": "limit_per_station 必須為 1 至 10 的整數"
}
```

| `error` | 對應狀態碼 |
|---------|-----------|
| `INVALID_PARAM` | `400` |
| `UNAUTHORIZED` | `401` |
| `NOT_FOUND` | `404` |
| `RATE_LIMITED` | `429` |
| `SERVICE_DEGRADED` | `503` |

### 12.2 範例

`404`：

```json
{
  "error": "NOT_FOUND",
  "detail": "vehicle_code \"PMS-99\" 不存在"
}
```

`429`，附 `Retry-After: 7` 標頭：

```json
{
  "error": "RATE_LIMITED",
  "detail": "最小輪詢間隔為 10 秒"
}
```

`503`：

```json
{
  "error": "SERVICE_DEGRADED",
  "detail": "MQTT broker 連線中斷",
  "status": "DOWN"
}
```

### 12.3 降級原則

服務降級時回應 `503`，或將個別車輛標示為 `UNKNOWN`，不回傳過期資料。使用方據此顯示資料中斷。

---

## 十三、整合指引

每一輪詢週期的處理流程。

### 步驟 1：確認服務狀態

```
GET /syncdrive-api/vehicles/feed-status
```

| `status` | 處理 |
|----------|------|
| `DOWN` | 全畫面顯示資料中斷，結束本輪 |
| `DEGRADED` | 繼續，畫面標示部分資料異常 |
| `OK` | 繼續 |

### 步驟 2：取得 ETA

```
GET /syncdrive-api/vehicles/eta/by-station
If-None-Match: "<前次 ETag>"
```

| 回應 | 處理 |
|------|------|
| `304` | 沿用前次資料，跳至步驟 4 |
| `200` | 以新資料更新畫面 |

### 步驟 3：決定顯示內容

```
對每一筆 eta：

  若 confidence == "STALE" 或 arrival_state == "UNKNOWN"：
      顯示「資料中斷」

  否則若 has_alert 且該車 eta_impact == "ETA_UNAVAILABLE"：
      顯示「資料中斷」

  否則若 arrival_state == "APPROACHING"：
      顯示「即將進站」

  否則若 arrival_state == "AT_STATION"：
      顯示「停靠中」

  否則：
      剩餘秒數 = (eta_at - 當前時間) / 1000
      顯示「約 N 分鐘」
      若 delay_state 為 MINOR_DELAY 或 MAJOR_DELAY：
          加註「誤點」
```

### 步驟 4：更新告警看板

```
GET /syncdrive-api/vehicles/alerts?active_only=true
```

以 `alert_id` 為主鍵：新增未出現過者，更新既有者，本次未出現者視為已解除並移除。

### 步驟 5：等待下一週期

依 11.1 建議間隔排程。

---

## 十四、JSON Schema

端點 1 回應之結構定義。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "VehicleEtaByStationResponse",
  "type": "object",
  "required": ["meta", "station_count", "stations"],
  "properties": {
    "meta": {
      "type": "object",
      "required": ["generated_at", "service_date", "data_quality"],
      "properties": {
        "generated_at": { "type": "integer" },
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
        "confidence", "has_alert", "observed_at", "data_age_seconds"
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
        "eta_seconds": { "type": ["integer", "null"], "minimum": 0 },
        "eta_at": { "type": ["integer", "null"] },
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

## 十五、部署配置參數

下列參數於部署時設定，本規格提供預設值。

| 參數 | 預設值 | 影響 |
|------|-------|------|
| `APPROACHING_ETA_THRESHOLD_SECONDS` | `60` | `arrival_state` 轉為 `APPROACHING` 的時間門檻 |
| `APPROACHING_DISTANCE_THRESHOLD_M` | `200` | `arrival_state` 轉為 `APPROACHING` 的距離門檻 |
| `EARLY_THRESHOLD_SECONDS` | `-30` | `delay_state` 轉為 `EARLY` 的門檻 |
| `MINOR_DELAY_THRESHOLD_SECONDS` | `60` | `delay_state` 轉為 `MINOR_DELAY` 的門檻 |
| `MAJOR_DELAY_THRESHOLD_SECONDS` | `180` | `delay_state` 轉為 `MAJOR_DELAY` 的門檻 |
| `SIGNAL_LOST_THRESHOLD_SECONDS` | `90` | 判定 `VEHICLE_SIGNAL_LOST`，且 `confidence` 轉為 `STALE` |
| `DEFAULT_LIMIT_PER_STATION` | `3` | 端點 1 每站預設回傳筆數 |
| `DEFAULT_NEXT_STOPS` | `3` | 端點 2 每車預設推算站數 |
| `MIN_POLL_INTERVAL_SECONDS` | `10` | 低於此間隔回應 `429` |

`APPROACHING_ETA_THRESHOLD_SECONDS` 與 `eta/by-station` 的輪詢間隔連動：輪詢間隔應小於或等於此門檻值。

---

## 十六、附錄：與計畫 ETA 的關係

系統另提供班表計畫 ETA 介面，兩者資料來源與生命週期不同，不互相取代。

| 視角 | 計畫值 | 即時值 |
|------|-------|-------|
| 依站 | `GET /syncdrive-api/operation-shift/timetable/station-etas` | `GET /syncdrive-api/vehicles/eta/by-station` |
| 依班次／車 | `GET /syncdrive-api/operation-shift/timetable/trips` | `GET /syncdrive-api/vehicles/eta/by-vehicle` |

| | 計畫值 | 即時值 |
|---|-------|-------|
| 資料來源 | 已發布班表 | 車端回報 |
| 車輛識別 | 無 | 有（`vehicle_code`） |
| 可用條件 | 班表已發布 | 車輛正在回報 |
| 用途 | 時刻表公告、營運規劃 | 現場顯示、監控 |

本 API 於 `plan` 子物件內嵌對應的計畫值，供直接比對，無需另行呼叫計畫 ETA 介面。

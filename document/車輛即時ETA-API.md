# 車輛即時 ETA API 規格書

| 項目 | 內容 |
|------|------|
| 版本 | v1.1 |
| 發布日期 | 2026-08-17 |
| 提供方 | 台智駕 SyncDrive T3 車輛監控系統 |
| 使用方 | 取用本介面之外部系統 |
| 通訊方式 | HTTP / JSON，GET，唯讀 |
| 取用模式 | 固定頻率輪詢（pull-only） |
| Base URL | `http://127.0.0.1:3000`（正式環境依部署配置） |
| API 文件 | `http://127.0.0.1:3000/api/docs`（Swagger） |

本規格定義 SyncDrive T3 車輛監控系統對外提供**即將進站**與**預計到達**的介面。本介面為單一對外契約，對所有取用方一致。使用方以固定頻率輪詢取得全線即時快照；本介面不主動推播。

**所有回應欄位的意義、型別與值域，統一定義於[第七章 資料模型](#七資料模型)。** 各 API 章節僅列出請求方式與完整回應範例。

本文中的「必須」表示強制要求，「應」表示強烈建議，「可」表示選用。

---

## 目錄

1. [服務範圍](#一服務範圍)
2. [通訊規範](#二通訊規範)
3. [共用約定](#三共用約定)
4. [API 總覽](#四api-總覽)
5. [GET /vehicles/eta/by-station](#五get-vehiclesetaby-station)
6. [GET /vehicles/eta/by-vehicle](#六get-vehiclesetaby-vehicle)
7. [資料模型](#七資料模型)
8. [輪詢規範](#八輪詢規範)
9. [錯誤處理](#九錯誤處理)
10. [整合指引](#十整合指引)
11. [JSON Schema](#十一json-schema)
12. [部署配置參數](#十二部署配置參數)
13. [實作狀態與交付](#十三實作狀態與交付)
14. [附錄：與計畫 ETA 的關係](#十四附錄與計畫-eta-的關係)

---

## 一、服務範圍

| 類別 | 內容 | 提供的 API |
|------|------|-----------|
| 即將進站 | 車輛已進入到站門檻，站端可顯示進站提示 | `GET /syncdrive-api/vehicles/eta/by-station`<br>`GET /syncdrive-api/vehicles/eta/by-vehicle` |
| 預計到達 | 車輛預計抵達各停靠點的時刻與剩餘秒數 | 同上 |

兩支 API 提供**同一份資料的兩種索引方式**：`by-station` 以停靠點為主鍵，供站端顯示；`by-vehicle` 以車輛為主鍵，供車輛追蹤畫面。

---

## 二、通訊規範

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

### 2.1 請求標頭

```http
GET /syncdrive-api/vehicles/eta/by-station HTTP/1.1
Host: 127.0.0.1:3000
X-API-Key: <API_KEY>
Accept: application/json
Accept-Encoding: gzip
If-None-Match: "a1b2c3d4"
```

### 2.2 回應標頭

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Encoding: gzip
ETag: "e5f6a7b8"
Cache-Control: no-cache, max-age=0
```

---

## 三、共用約定

### 3.1 識別碼格式

| 欄位 | 格式 | 範例 |
|------|------|------|
| `vehicle_code` | `PMS-` + 兩碼數字 | `PMS-05` |
| `station_id` | 停靠點識別碼 | `station_4` |
| `trip_code` | 路線代號 + `HHMM` | `ST0007` |
| `order_id` | `[YYMMDD]-[trip_code]` | `260816-ST0007` |

### 3.2 時間表示

| 欄位型式 | 型別 | 說明 |
|---------|------|------|
| `*_at` | Long | Unix Epoch **毫秒**（UTC）。運算一律以此欄位為準 |
| `*_clock` | String | `HH:MM:SS`，當地時刻，24 小時制，值域 `00:00:00`–`23:59:59`。僅供顯示 |

跨午夜的班次直接以次日時刻表示。例：車輛於當地時間 8 月 17 日 01:10:30 抵達，

```json
{
  "eta_at": 1755364230000,
  "eta_clock": "01:10:30"
}
```

`eta_clock` 為 `01:10:30`，日期由 `eta_at` 判定。本介面不使用超過 `24:00:00` 的時刻表示法。

### 3.3 列舉值

所有列舉值使用 `SCREAMING_SNAKE_CASE`。使用方應忽略未知列舉值並套用預設處理：`arrival_state` 未知時視為 `UNKNOWN`。

各列舉值的完整值域見[第七章 資料模型](#七資料模型)。

### 3.4 停靠點清單

系統共 10 個停靠點。回應中一律列出全部停靠點，包含當下無車駛近者（該站 `etas` 為空陣列），以利站端固定顯示版面。

| `station_id` | `station_name` |
|-------------|----------------|
| `station_1` | [備用]N2W上行停靠 |
| `station_2` | N2W下行出發 |
| `station_3` | T3下行 |
| `station_4` | T3上行 |
| `station_5` | S2W下行停靠 |
| `station_6` | [備用]S2W上行出發 |
| `station_7` | S2W上行出發 |
| `station_8` | [備用]S2W下行停靠 |
| `station_9` | N2W上行停靠 |
| `station_10` | [備用]N2W下行出發 |

### 3.5 PIDS 站體側別對應

供旅客資訊顯示系統（PIDS）將停靠點歸併至站體側別。本介面回應**不含**側別欄位，使用方依下表自行對應。

| PIDS 側別 | `station_id` | `station_name` |
|-----------|-------------|----------------|
| **N2W 北側** | `station_9` | N2W上行停靠 |
| **N2W 北側** | `station_2` | N2W下行出發 |
| **N2W 南側** | `station_1` | [備用]N2W上行停靠 |
| **N2W 南側** | `station_10` | [備用]N2W下行出發 |
| **S2W 北側** | `station_8` | [備用]S2W下行停靠 |
| **S2W 北側** | `station_6` | [備用]S2W上行出發 |
| **S2W 南側** | `station_5` | S2W下行停靠 |
| **S2W 南側** | `station_7` | S2W上行出發 |
| **T3 西側** | `station_3` | T3下行 |
| **T3 東側** | `station_4` | T3上行 |

每個 PIDS 側別對應一至二個停靠點。使用方如需以側別顯示，應將該側別下各停靠點的 `etas` 合併後依 `eta_at` 排序。

---

## 四、API 總覽

| API | 用途 | 建議輪詢間隔 |
|-----|------|------------|
| `GET /syncdrive-api/vehicles/eta/by-station` | 各停靠點接下來將抵達的車輛 | 60 秒 |
| `GET /syncdrive-api/vehicles/eta/by-vehicle` | 各車輛接下來將抵達的停靠點 | 60 秒 |

輪詢間隔的上下限與依據見[第八章 輪詢規範](#八輪詢規範)。

---

## 五、GET /vehicles/eta/by-station

```
GET /syncdrive-api/vehicles/eta/by-station
```

回傳各停靠點接下來將抵達的車輛預測。

**回應欄位意義見[第七章 資料模型](#七資料模型)。**

### 5.1 查詢參數

| 參數 | 型別 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `station_id` | String | 否 | 全部 | 指定停靠點，可重複指定多個 |
| `limit_per_station` | Int | 否 | `3` | 每站回傳筆數，值域 1–10 |

### 5.2 請求範例

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

指定多站、每站 1 筆：

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-station\
?station_id=station_4&station_id=station_2&limit_per_station=1" \
  -H "X-API-Key: <API_KEY>"
```

### 5.3 完整回應：一般情形

請求：`?station_id=station_4&limit_per_station=3`

```json
{
  "meta": {
    "generated_at": 1755327600000,
    "shift_id": "OS-DRAFT-MSEEXIN9",
    "source": "published",
    "data_quality": "OK"
  },
  "station_count": 1,
  "stations": [
    {
      "station_id": "station_4",
      "station_name": "T3上行",
      "etas": [
        {
          "vehicle_code": "PMS-05",
          "order_id": "260816-ST0007",
          "trip_code": "ST0007",
          "route_code": "ST",
          "route_name": "S2W上行 > T3上行",
          "vehicle_phase": "TRANSITING",
          "arrival_state": "APPROACHING",
          "eta_seconds": 25,
          "eta_at": 1755327625000,
          "eta_clock": "09:00:25",
          "distance_to_station_m": 120.0,
          "plan": {
            "planned_arrival_at": 1755327610000,
            "planned_arrival_clock": "09:00:10",
            "planned_departure_at": null,
            "planned_departure_clock": null,
            "delay_seconds": 15,
            "delay_state": "ON_TIME"
          },
          "observed_at": 1755327598000,
          "data_age_seconds": 2
        },
        {
          "vehicle_code": "PMS-02",
          "order_id": "260816-ST0013",
          "trip_code": "ST0013",
          "route_code": "ST",
          "route_name": "S2W上行 > T3上行",
          "vehicle_phase": "TRANSITING",
          "arrival_state": "EN_ROUTE",
          "eta_seconds": 415,
          "eta_at": 1755328015000,
          "eta_clock": "09:06:55",
          "distance_to_station_m": 1840.0,
          "plan": {
            "planned_arrival_at": 1755327970000,
            "planned_arrival_clock": "09:06:10",
            "planned_departure_at": null,
            "planned_departure_clock": null,
            "delay_seconds": 45,
            "delay_state": "ON_TIME"
          },
          "observed_at": 1755327597000,
          "data_age_seconds": 3
        },
        {
          "vehicle_code": "PMS-09",
          "order_id": "260816-ST0019",
          "trip_code": "ST0019",
          "route_code": "ST",
          "route_name": "S2W上行 > T3上行",
          "vehicle_phase": "TRANSITING",
          "arrival_state": "EN_ROUTE",
          "eta_seconds": 790,
          "eta_at": 1755328390000,
          "eta_clock": "09:13:10",
          "distance_to_station_m": 3520.0,
          "plan": {
            "planned_arrival_at": 1755328330000,
            "planned_arrival_clock": "09:12:10",
            "planned_departure_at": null,
            "planned_departure_clock": null,
            "delay_seconds": 60,
            "delay_state": "ON_TIME"
          },
          "observed_at": 1755327596000,
          "data_age_seconds": 4
        }
      ]
    }
  ]
}
```

### 5.4 完整回應：停靠中、資料逾時、無車駛近

請求：`?station_id=station_2&station_id=station_9&station_id=station_1&limit_per_station=1`

```json
{
  "meta": {
    "generated_at": 1755327600000,
    "shift_id": "OS-DRAFT-MSEEXIN9",
    "source": "published",
    "data_quality": "DEGRADED"
  },
  "station_count": 3,
  "stations": [
    {
      "station_id": "station_2",
      "station_name": "N2W下行出發",
      "etas": [
        {
          "vehicle_code": "PMS-03",
          "order_id": "260816-NT0900",
          "trip_code": "NT0900",
          "route_code": "NT",
          "route_name": "N2W下行出發 > T3下行",
          "vehicle_phase": "TRANSITING",
          "arrival_state": "AT_STATION",
          "eta_seconds": 0,
          "eta_at": 1755327580000,
          "eta_clock": "08:59:40",
          "distance_to_station_m": 0.0,
          "plan": {
            "planned_arrival_at": 1755327570000,
            "planned_arrival_clock": "08:59:30",
            "planned_departure_at": 1755327620000,
            "planned_departure_clock": "09:00:20",
            "delay_seconds": 10,
            "delay_state": "ON_TIME"
          },
          "observed_at": 1755327599000,
          "data_age_seconds": 1
        }
      ]
    },
    {
      "station_id": "station_9",
      "station_name": "N2W上行停靠",
      "etas": [
        {
          "vehicle_code": "PMS-08",
          "order_id": "260816-TN0905",
          "trip_code": "TN0905",
          "route_code": "TN",
          "route_name": "T3上行 > N2W上行",
          "vehicle_phase": null,
          "arrival_state": "UNKNOWN",
          "eta_seconds": null,
          "eta_at": null,
          "eta_clock": null,
          "distance_to_station_m": null,
          "plan": {
            "planned_arrival_at": 1755327900000,
            "planned_arrival_clock": "09:05:00",
            "planned_departure_at": null,
            "planned_departure_clock": null,
            "delay_seconds": null,
            "delay_state": "NO_PLAN"
          },
          "observed_at": 1755327508000,
          "data_age_seconds": 92
        }
      ]
    },
    {
      "station_id": "station_1",
      "station_name": "[備用]N2W上行停靠",
      "etas": []
    }
  ]
}
```

本例包含三種情形：

- `station_2`：車輛停靠中（`arrival_state` 為 `AT_STATION`），`plan.planned_departure_*` 提供預計發車時刻。
- `station_9`：車端資料逾時（`data_age_seconds` 為 92，超過 90 秒門檻），`arrival_state` 為 `UNKNOWN`，所有即時推估欄位為 `null`。使用方必須顯示資料中斷，不得沿用先前取得的 ETA。
- `station_1`：當下無車駛近，`etas` 為空陣列。

因存在逾時車輛，`meta.data_quality` 為 `DEGRADED`。

---

## 六、GET /vehicles/eta/by-vehicle

```
GET /syncdrive-api/vehicles/eta/by-vehicle
```

回傳各車輛接下來將抵達的停靠點預測。

**回應欄位意義見[第七章 資料模型](#七資料模型)。**

### 6.1 查詢參數

| 參數 | 型別 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `vehicle_code` | String | 否 | 全部 | 指定車輛，可重複指定多個 |
| `next_stops` | Int | 否 | `3` | 每車往後推算站數，值域 1–10 |

### 6.2 請求範例

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-vehicle" \
  -H "X-API-Key: <API_KEY>"
```

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/vehicles/eta/by-vehicle?vehicle_code=PMS-05&next_stops=3" \
  -H "X-API-Key: <API_KEY>"
```

### 6.3 完整回應：正常行駛中

請求：`?vehicle_code=PMS-05&next_stops=3`

```json
{
  "meta": {
    "generated_at": 1755327600000,
    "shift_id": "OS-DRAFT-MSEEXIN9",
    "source": "published",
    "data_quality": "OK"
  },
  "vehicle_count": 1,
  "vehicles": [
    {
      "vehicle_code": "PMS-05",
      "vehicle_phase": "TRANSITING",
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
          "eta_at": 1755327625000,
          "eta_clock": "09:00:25",
          "distance_to_station_m": 120.0,
          "plan": {
            "planned_arrival_at": 1755327610000,
            "planned_arrival_clock": "09:00:10",
            "planned_departure_at": null,
            "planned_departure_clock": null,
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
          "eta_at": 1755327868000,
          "eta_clock": "09:04:28",
          "distance_to_station_m": null,
          "plan": {
            "planned_arrival_at": 1755327840000,
            "planned_arrival_clock": "09:04:00",
            "planned_departure_at": null,
            "planned_departure_clock": null,
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
          "eta_at": 1755328095000,
          "eta_clock": "09:08:15",
          "distance_to_station_m": null,
          "plan": {
            "planned_arrival_at": 1755328060000,
            "planned_arrival_clock": "09:07:40",
            "planned_departure_at": null,
            "planned_departure_clock": null,
            "delay_seconds": 35,
            "delay_state": "ON_TIME"
          }
        }
      ],
      "observed_at": 1755327598000,
      "data_age_seconds": 2
    }
  ]
}
```

`distance_to_station_m` 僅於 `sequence` 為 `1`（車輛當前行駛中的目標站）時有值，後續站點為 `null`。

### 6.4 完整回應：車輛資料逾時

請求：`?vehicle_code=PMS-08&next_stops=3`

```json
{
  "meta": {
    "generated_at": 1755327600000,
    "shift_id": "OS-DRAFT-MSEEXIN9",
    "source": "published",
    "data_quality": "DEGRADED"
  },
  "vehicle_count": 1,
  "vehicles": [
    {
      "vehicle_code": "PMS-08",
      "vehicle_phase": null,
      "order_id": "260816-TN0905",
      "trip_code": "TN0905",
      "route_code": "TN",
      "route_name": "T3上行 > N2W上行",
      "position": null,
      "next_stops": [
        {
          "sequence": 1,
          "station_id": "station_9",
          "station_name": "N2W上行停靠",
          "arrival_state": "UNKNOWN",
          "eta_seconds": null,
          "eta_at": null,
          "eta_clock": null,
          "distance_to_station_m": null,
          "plan": {
            "planned_arrival_at": 1755327900000,
            "planned_arrival_clock": "09:05:00",
            "planned_departure_at": null,
            "planned_departure_clock": null,
            "delay_seconds": null,
            "delay_state": "NO_PLAN"
          }
        }
      ],
      "observed_at": 1755327508000,
      "data_age_seconds": 92
    }
  ]
}
```

車端資料逾時時，`position` 與所有即時推估欄位為 `null`，且僅回傳 `sequence` 為 `1` 的站點（無法外推後續站點）。

---

## 七、資料模型

本章定義兩支 API 回應中每一個欄位的意義、型別與值域。

### 7.1 `meta`（回應層級資訊）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `generated_at` | Long | 中心端產生本次快照的時刻，Unix Epoch 毫秒。可據此判斷回應是否為新資料 |
| `shift_id` | String \| null | 本次計畫值所依據的班表識別碼。無可用班表時為 `null` |
| `source` | String | 計畫值來源，見 7.2 |
| `data_quality` | String | 本次快照的整體資料品質，見 7.3 |

### 7.2 `source`（計畫值來源）

`plan` 子物件的資料取自哪一份班表。

| 值 | 意義 | 使用方處理 |
|----|------|-----------|
| `published` | 已發布班表 | 計畫值有效 |
| `draft_fallback` | 尚未發布的草稿班表 | 計畫值僅供參考，不應對外顯示為正式時刻 |
| `none` | 無可用班表 | `plan` 全部欄位為 `null`，`delay_state` 為 `NO_PLAN` |

### 7.3 `data_quality`（資料品質）

依全車隊的回報狀況彙總。

| 值 | 意義 | 使用方處理 |
|----|------|-----------|
| `OK` | 全部車輛回報正常 | 正常顯示 |
| `DEGRADED` | 部分車輛資料逾時，或班表未載入 | 顯示，並對 `arrival_state` 為 `UNKNOWN` 者標示資料中斷 |
| `DOWN` | 無法取得任何車輛資料 | **必須**停止顯示 ETA，改顯示資料中斷 |

判定基礎：中心端已知車隊應有的車輛清單（`PMS-01` 至 `PMS-11`），逐車比對其最新資料的 `data_age_seconds`。任一車超過逾時門檻即為 `DEGRADED`；全部車輛皆無資料或皆逾時則為 `DOWN`。

### 7.4 計數欄位

| 欄位 | 型別 | 說明 |
|------|------|------|
| `station_count` | Int | 本次回應包含的停靠點數量，等於 `stations` 陣列長度。未指定 `station_id` 時為 `10` |
| `vehicle_count` | Int | 本次回應包含的車輛數量，等於 `vehicles` 陣列長度 |

兩者用途為讓使用方在解析前即可得知資料筆數，並可與陣列長度交叉檢查傳輸是否完整。

### 7.5 車輛與班次識別

| 欄位 | 型別 | 說明 |
|------|------|------|
| `vehicle_code` | String | 車輛代號，格式 `PMS-` + 兩碼數字 |
| `order_id` | String \| null | 該車當前執行的營運訂單識別碼。未執行任務時為 `null` |
| `trip_code` | String \| null | 班次代碼，格式為路線代號 + 發車時刻 `HHMM`。例 `ST0007` 表示 ST 路線 00:07 發車的班次 |
| `route_code` | String \| null | 路線代號 |
| `route_name` | String \| null | 路線全名，格式為「起站 > 迄站」 |
| `station_id` | String | 停靠點識別碼，值域見 3.4 |
| `station_name` | String | 停靠點名稱 |

### 7.6 `vehicle_phase`（車輛營運階段）

車端於營運任務狀態協議回報之營運階段，本介面**原值透傳**，不改寫、不擴充。

| 值 | 意義 |
|----|------|
| `TRANSITING` | 執行任務行駛中 |
| `FAULTED` | 故障或受困，需人工介入 |

值域由營運任務狀態協議定義，上表為該協議目前明列者。車端未提供或資料逾時時為 `null`。

本欄位與 `arrival_state` 為兩組獨立欄位：`vehicle_phase` 描述車輛整體營運狀態，`arrival_state` 描述該車相對於**某一個**停靠點的到站進度。同一台車對不同停靠點會有不同的 `arrival_state`，但 `vehicle_phase` 只有一個。

### 7.7 `arrival_state`（到站狀態）

**本欄為本介面依車端回報值計算之衍生欄位**，非 MQTT 協議定義之狀態。這是「即將進站」與「預計到達」的判斷依據。

| 值 | 意義 | 判定條件 |
|----|------|---------|
| `EN_ROUTE` | 行駛中，尚未接近。**此即「預計到達」** | `eta_seconds` 與 `distance_to_station_m` 均未達門檻 |
| `APPROACHING` | 即將進站。**此即「即將進站」** | `eta_seconds ≤ 60` 或 `distance_to_station_m ≤ 200` |
| `DOCKING` | 進站對位中 | 車端 `PLATFORM_DOCKING` 任務為 `IN_PROGRESS` |
| `AT_STATION` | 停靠中 | 車端 `OPEN_DOORS` 任務已完成，且尚未觸發 `CLOSE_DOORS` |
| `DEPARTED` | 已離站 | 車端 `STATION_DEPARTURE` 任務已完成 |
| `UNKNOWN` | 無法判定 | 車端資料逾時（`data_age_seconds` 超過門檻），或缺少目標站資訊 |

`PLATFORM_DOCKING`、`OPEN_DOORS`、`CLOSE_DOORS`、`STATION_DEPARTURE` 為營運任務狀態協議定義之任務名稱。門檻值見[第十二章 部署配置參數](#十二部署配置參數)。

判定範例：

| 車端回報 | 判定 | 依據 |
|---------|------|------|
| `eta_seconds=25`、`distance=120` | `APPROACHING` | 時間與距離門檻均成立 |
| `eta_seconds=45`、`distance=350` | `APPROACHING` | 時間門檻成立 |
| `eta_seconds=90`、`distance=180` | `APPROACHING` | 距離門檻成立 |
| `eta_seconds=415`、`distance=1840` | `EN_ROUTE` | 兩項門檻均未成立 |
| 逾 90 秒未回報 | `UNKNOWN` | 資料逾時 |

### 7.8 到站時刻欄位

| 欄位 | 型別 | 說明 |
|------|------|------|
| `eta_seconds` | Int \| null | 距離抵達該停靠點還有幾秒。**以 `observed_at`（車端回報時刻）為基準**，非以使用方收到回應的時刻為基準。第 1 站直接採用車端上行之推估值；車端未提供時，該筆 `arrival_state` 為 `UNKNOWN` |
| `eta_at` | Long \| null | 預計抵達該停靠點的**絕對時刻**，Unix Epoch 毫秒。使用方計算倒數必須使用本欄位 |
| `eta_clock` | String \| null | `eta_at` 的當地時刻表示，格式 `HH:MM:SS`，24 小時制。僅供顯示 |
| `distance_to_station_m` | Double \| null | 車輛距該停靠點的路徑距離，單位公尺 |

三個 ETA 欄位表達同一件事的三種形式：

```json
{
  "observed_at": 1755327598000,
  "eta_seconds": 25,
  "eta_at": 1755327625000,
  "eta_clock": "09:00:25"
}
```

讀法為：**該車輛預計於當地時間 09:00:25 抵達此停靠點。** 車端最後回報時刻為 09:00:00（`observed_at`），自該時刻起算尚有 25 秒（`eta_seconds`），故絕對抵達時刻為 09:00:25（`eta_at`／`eta_clock`）。

`arrival_state` 為 `UNKNOWN` 時，此三個欄位皆為 `null`。

### 7.9 `plan`（班表計畫值）

該班次依已發布班表原訂的時刻，以及即時值與其之差。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `planned_arrival_at` | Long \| null | 計畫抵達時刻，Unix Epoch 毫秒 |
| `planned_arrival_clock` | String \| null | 計畫抵達時刻的當地時刻表示 |
| `planned_departure_at` | Long \| null | 計畫發車時刻。僅於該停靠點為該班次起站，或 `arrival_state` 為 `AT_STATION` 時有值，其餘為 `null` |
| `planned_departure_clock` | String \| null | 計畫發車時刻的當地時刻表示 |
| `delay_seconds` | Int \| null | `eta_at` 減 `planned_arrival_at`，單位秒。**正值表示晚於計畫**，負值表示早於計畫 |
| `delay_state` | String | 誤點狀態，**暫定定義**，見 7.10。現階段應以 `delay_seconds` 為準 |

### 7.10 `delay_state`（誤點狀態）— 暫定

> **本欄位為暫定定義。** 門檻值與狀態分級尚未經營運確認，將於試營運後依實際營運需求調整。
> **現階段使用方應以 `delay_seconds`（數值）為準**，自行決定顯示門檻；`delay_state` 僅供參考，不應作為判斷邏輯的唯一依據。

`delay_seconds` 為 `eta_at` 減 `planned_arrival_at`，單位秒，正值表示晚於計畫。此為客觀數值，不受門檻調整影響。

暫定分級如下：

| 值 | 暫定條件 | 意義 |
|----|---------|------|
| `EARLY` | `delay_seconds < -30` | 早到 |
| `ON_TIME` | `-30 ≤ delay_seconds ≤ 60` | 準點 |
| `MINOR_DELAY` | `60 < delay_seconds ≤ 180` | 輕微誤點 |
| `MAJOR_DELAY` | `delay_seconds > 180` | 顯著誤點 |
| `NO_PLAN` | 無對應計畫班次 | 不判定誤點。加班車、調度車，或班表未載入時屬此類 |

門檻值見[第十二章 部署配置參數](#十二部署配置參數)，可於部署時調整。

`delay_seconds` 計算範例：

| 計畫抵達 | 預計抵達 | `delay_seconds` |
|---------|---------|----------------|
| 09:00:10 | 09:00:25 | `15` |
| 09:00:10 | 08:59:20 | `-50` |
| 09:06:10 | 09:08:20 | `130` |
| 09:06:10 | 09:11:00 | `290` |
| 無 | 09:11:00 | `null` |

### 7.11 資料新鮮度欄位

| 欄位 | 型別 | 說明 |
|------|------|------|
| `observed_at` | Long | 本筆推估所依據的**車端回報時刻**，Unix Epoch 毫秒。取自車端上行封包根層的時間戳；車端未提供時，改以中心端收訊時刻替代 |
| `data_age_seconds` | Int | `generated_at` 減 `observed_at`，單位秒。表示這筆資料有多舊 |

`data_age_seconds` 超過門檻（預設 90 秒）時，`arrival_state` 轉為 `UNKNOWN`。

#### 更新基礎

車端以 1 Hz 上行，中心端逐筆覆寫該車的最新狀態，**不設過期清除**。因此：

- 車輛正常回報時，`data_age_seconds` 通常為 0–2 秒。
- 車輛停止回報時，中心端仍保有其最後一筆資料，`data_age_seconds` 將持續累加。**失聯是以「資料變舊」呈現，不是以「資料消失」呈現**，使用方必須檢查 `data_age_seconds` 或 `arrival_state`，不可僅以欄位是否存在判斷。

### 7.12 `position`（車輛位置）

僅 `by-vehicle` 提供。車端資料逾時時為 `null`。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `latitude` | Double | 緯度（WGS84） |
| `longitude` | Double | 經度（WGS84） |
| `heading` | Double | 車頭朝向角，單位弳度（rad） |
| `velocity_kph` | Double | 當下行駛速度，單位公里／小時 |

### 7.13 `sequence`（站序）

僅 `by-vehicle` 之 `next_stops` 提供。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `sequence` | Int | 該停靠點為此車接下來的第幾站，自 `1` 起算 |

`sequence` 為 `1` 者為車輛當前行駛中的目標站，其 `eta_seconds` 直接採用車端回報值；`sequence` 為 `2` 以後者由中心端依班表站間旅行時間外推，誤差隨站序累積。

---

## 八、輪詢規範

### 8.1 建議輪詢間隔

**兩支 API 使用相同的輪詢間隔。**

| 項目 | 值 |
|------|----|
| 建議間隔 | **60 秒** |
| 可接受範圍 | 30–60 秒 |
| 最小間隔 | 10 秒 |
| 最大間隔 | 60 秒 |

### 8.2 間隔上下限的依據

| 限制 | 值 | 依據 |
|------|----|------|
| 最小間隔 | 10 秒 | 低於此值回應 `429 Too Many Requests` |
| 最大間隔 | 60 秒 | `APPROACHING` 門檻為 60 秒。輪詢間隔大於此值時，車輛可能在兩次輪詢之間完成整段接近過程，使用方將觀測不到即將進站狀態 |

低於 15 秒的輪詢不提升顯示精度：ETA 的實質變化來自車輛移動，顯示精度為分鐘級。

### 8.3 倒數計時實作要求

使用方必須以 `eta_at`（絕對時刻）計算剩餘時間，不得以 `eta_seconds` 自輪詢時刻起算倒數。

`eta_seconds` 是以 `observed_at` 為基準的值。使用方收到回應時，該值已經過 `data_age_seconds` 秒加上網路傳輸時間；兩次輪詢之間車輛持續移動，以該值倒數將累積誤差。

```
剩餘秒數 = (eta_at - 使用方當前時間) / 1000
```

### 8.4 重試與逾時

| 情形 | 處理 |
|------|------|
| 請求逾時（5 秒） | 沿用前一份資料並標示過期，等待下一排程週期 |
| `5xx` 回應 | 同上，不應立即重試 |
| `429` 回應 | 依 `Retry-After` 標頭延後 |
| `304` 回應 | 沿用前一份資料，視為成功 |

每次回應均為完整快照，漏取一輪不會造成資料累積落後，下一輪即補齊，故不需要立即重試機制。

### 8.5 ETag 使用

首次請求：

```http
GET /syncdrive-api/vehicles/eta/by-station HTTP/1.1
X-API-Key: <API_KEY>
```

```http
HTTP/1.1 200 OK
ETag: "a1b2c3d4"

{ "meta": { ... }, "station_count": 10, "stations": [ ... ] }
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

### 8.6 頻寬估算

以 11 台車、10 個停靠點、每站 3 筆計算：

| API | 未壓縮 | gzip | 依建議間隔之日流量 |
|-----|-------|------|------------------|
| `eta/by-station` | 約 18 KB | 約 3 KB | 約 4.3 MB |
| `eta/by-vehicle` | 約 14 KB | 約 2.5 KB | 約 3.6 MB |
| 合計 | — | — | **約 7.9 MB／日** |

啟用 `If-None-Match` 後，未變更輪次回應 `304`，實際流量低於上表。

---

## 九、錯誤處理

| 狀態碼 | 情形 |
|-------|------|
| `200` | 成功，包含 `etas: []` 的空結果 |
| `304` | 資料未變更 |
| `400` | 參數格式錯誤 |
| `401` | 認證失敗 |
| `404` | 指定的 `vehicle_code` 或 `station_id` 不存在 |
| `429` | 超過輪詢頻率限制 |
| `503` | 服務降級，無法提供即時資料 |

### 9.1 錯誤回應格式

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

### 9.2 範例

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
  "detail": "無法取得車輛即時資料",
  "data_quality": "DOWN"
}
```

### 9.3 降級原則

服務降級時回應 `503`，或將個別車輛之 `arrival_state` 標示為 `UNKNOWN`，不回傳過期資料。使用方據此顯示資料中斷。

---

## 十、整合指引

每一輪詢週期的處理流程。

### 步驟 1：取得 ETA

```
GET /syncdrive-api/vehicles/eta/by-station
If-None-Match: "<前次 ETag>"
```

| 回應 | 處理 |
|------|------|
| `304` | 沿用前次資料，結束本輪 |
| `503` | 全畫面顯示資料中斷，結束本輪 |
| `200` | 繼續 |

### 步驟 2：檢查資料品質

| `meta.data_quality` | 處理 |
|--------------------|------|
| `DOWN` | 全畫面顯示資料中斷，結束本輪 |
| `DEGRADED` | 繼續，個別車輛依 `arrival_state` 判斷 |
| `OK` | 繼續 |

### 步驟 3：決定顯示內容

```
對每一筆 eta：

  若 arrival_state == "UNKNOWN"：
      顯示「資料中斷」

  否則若 arrival_state == "APPROACHING" 或 "DOCKING"：
      顯示「即將進站」

  否則若 arrival_state == "AT_STATION"：
      顯示「停靠中」
      若 plan.planned_departure_clock 有值：
          加註預計發車時刻

  否則若 arrival_state == "DEPARTED"：
      自清單移除

  否則（EN_ROUTE）：
      剩餘秒數 = (eta_at - 當前時間) / 1000
      顯示「約 N 分鐘」
      若 delay_state 為 MINOR_DELAY 或 MAJOR_DELAY：
          加註「誤點」
```

### 步驟 4：等待下一週期

依 8.1 建議間隔排程。

---

## 十一、JSON Schema

`GET /syncdrive-api/vehicles/eta/by-station` 回應之結構定義。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "VehicleEtaByStationResponse",
  "type": "object",
  "required": ["meta", "station_count", "stations"],
  "properties": {
    "meta": {
      "type": "object",
      "required": ["generated_at", "source", "data_quality"],
      "properties": {
        "generated_at": { "type": "integer", "description": "13 位 Unix Epoch 毫秒" },
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
        "observed_at", "data_age_seconds"
      ],
      "properties": {
        "vehicle_code": { "type": "string", "pattern": "^PMS-\\d{2}$" },
        "order_id": { "type": ["string", "null"] },
        "trip_code": { "type": ["string", "null"] },
        "route_code": { "type": ["string", "null"] },
        "route_name": { "type": ["string", "null"] },
        "vehicle_phase": {
          "type": ["string", "null"],
          "description": "營運任務狀態協議之 vehicle_phase 原值透傳"
        },
        "arrival_state": {
          "enum": ["EN_ROUTE", "APPROACHING", "DOCKING", "AT_STATION", "DEPARTED", "UNKNOWN"]
        },
        "eta_seconds": { "type": ["integer", "null"], "minimum": 0 },
        "eta_at": { "type": ["integer", "null"] },
        "eta_clock": {
          "type": ["string", "null"],
          "pattern": "^([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d$"
        },
        "distance_to_station_m": { "type": ["number", "null"], "minimum": 0 },
        "plan": {
          "type": ["object", "null"],
          "properties": {
            "planned_arrival_at": { "type": ["integer", "null"] },
            "planned_arrival_clock": { "type": ["string", "null"] },
            "planned_departure_at": { "type": ["integer", "null"] },
            "planned_departure_clock": { "type": ["string", "null"] },
            "delay_seconds": { "type": ["integer", "null"] },
            "delay_state": {
              "enum": ["EARLY", "ON_TIME", "MINOR_DELAY", "MAJOR_DELAY", "NO_PLAN"]
            }
          }
        },
        "observed_at": { "type": "integer" },
        "data_age_seconds": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

---

## 十二、部署配置參數

下列參數於部署時設定，本規格提供預設值。

| 參數 | 預設值 | 影響 |
|------|-------|------|
| `APPROACHING_ETA_THRESHOLD_SECONDS` | `60` | `arrival_state` 轉為 `APPROACHING` 的時間門檻 |
| `APPROACHING_DISTANCE_THRESHOLD_M` | `200` | `arrival_state` 轉為 `APPROACHING` 的距離門檻 |
| `EARLY_THRESHOLD_SECONDS` | `-30` | `delay_state` 轉為 `EARLY` 的門檻 |
| `MINOR_DELAY_THRESHOLD_SECONDS` | `60` | `delay_state` 轉為 `MINOR_DELAY` 的門檻 |
| `MAJOR_DELAY_THRESHOLD_SECONDS` | `180` | `delay_state` 轉為 `MAJOR_DELAY` 的門檻 |
| `DATA_STALE_THRESHOLD_SECONDS` | `90` | `arrival_state` 轉為 `UNKNOWN` 的資料逾時門檻 |
| `DEFAULT_LIMIT_PER_STATION` | `3` | `by-station` 每站預設回傳筆數 |
| `DEFAULT_NEXT_STOPS` | `3` | `by-vehicle` 每車預設推算站數 |
| `MIN_POLL_INTERVAL_SECONDS` | `10` | 低於此間隔回應 `429` |

`APPROACHING_ETA_THRESHOLD_SECONDS` 與 `eta/by-station` 的輪詢間隔連動：輪詢間隔應小於或等於此門檻值。

---

## 十三、實作狀態與交付

| API | 狀態 |
|-----|------|
| `GET /syncdrive-api/vehicles/eta/by-station` | 開發中 |
| `GET /syncdrive-api/vehicles/eta/by-vehicle` | 開發中 |

本規格為介面契約，兩支 API 尚未開放連線測試。使用方可先依本規格進行資料模型與畫面開發，開放時間另行通知。

已具備之基礎能力：

| 能力 | 狀態 |
|------|------|
| 車端 MQTT 資料接收（telemetry／operation／health） | 已上線 |
| 車輛最新狀態快取 | 已上線 |
| 班表計畫 ETA 查詢 | 已上線（見第十四章） |
| 即時 ETA 外推、依站索引 | 開發中 |

### 13.1 後續版本

異常狀況（Event）相關介面待 SCADA 之統一 Event Code 定義完成後另行提供，不在本版範圍。

---

## 十四、附錄：與計畫 ETA 的關係

系統另提供班表計畫 ETA 介面，兩者資料來源不同，不互相取代。

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

本介面於 `plan` 子物件內嵌對應的計畫值，供直接比對，無需另行呼叫計畫 ETA 介面。

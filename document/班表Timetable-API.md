# 班表 Timetable API

<div class="doc-hero">
  <p class="doc-eyebrow">SYNCDRIVE T3 · TIMETABLE API</p>
  <h2>班次與站點 ETA 讀取介面</h2>
  <p>站顯／外部系統用 HTTP 取得已發布班表的逐班次站點時刻，以及各站計畫抵達／離站事件。</p>
</div>

> **一句話**  
> 班次卡起迄是引擎真相；API 用與畫面上相同的推算（首站只給**出發**＝卡開始；末站給**抵達**＋**靠站完成**＝卡結束）展開後回傳。讀取最新已發布班表（若無則最新有 plan 的草稿）。

更新日期：2026-08-04  
Base URL：`http://127.0.0.1:3000`  
Swagger：[`http://127.0.0.1:3000/api/docs`](http://127.0.0.1:3000/api/docs)

### 立刻可開的網址

| 用途 | 網址 |
|------|------|
| **班次（HTML 欄位框）** | [http://localhost:4000/班表班次檢視.html](http://localhost:4000/班表班次檢視.html) |
| **站點 ETA（HTML 欄位框）** | [http://localhost:4000/班表ETA取用範例.html](http://localhost:4000/班表ETA取用範例.html) |
| 本篇 API 說明（Wiki） | [http://localhost:4000/#/班表Timetable-API](http://localhost:4000/#/班表Timetable-API) |
| 發布班表 | `POST http://127.0.0.1:3000/syncdrive-api/operation-shift/detail/<SHIFT_ID>/publish` |

> 請開上面兩支 **HTML** 頁來看資料（欄位框＋摺疊原始 JSON），不要直接開後端 `/trips`、`/station-etas`——瀏覽器會噴一整坨純 JSON 很難讀。  
> 需文件站（`npm run docs` → 4000）與後端（3000）同時開著。

---

## 0. 準備：先有一份班表

1. 在前端 Wizard 產生班表並**儲存**（`body.scheduleOutput.plan` 必須存在）。
2. （建議）發布，讓 timetable 預設讀這份：

```bash
curl -s -X POST \
  "http://127.0.0.1:3000/syncdrive-api/operation-shift/detail/OS-DRAFT-XXXXXXXX/publish"
```

未發布時，下列兩支 GET 仍可打，但 `meta.source` 會是 `"draft_fallback"`。

---

## 1. 取得全部班次（含各站時刻）

### `GET /syncdrive-api/operation-shift/timetable/trips`

| Query | 必填 | 說明 |
|-------|------|------|
| `from` | 否 | 時間下限，`HH:MM:SS` 或秒數。預設 `00:00:00` |
| `to` | 否 | 時間上限。預設 `24:00:00` |

**過濾規則**：班次**卡時間**與 `[from, to]` 有重疊即納入（非整段必須落在區間內）。

### 互動取用（建議）

開 [http://localhost:4000/班表班次檢視.html](http://localhost:4000/班表班次檢視.html) → 以**時間列**分頁籤；點 **「欄位」／「班次欄位」** 看框框排版（可再摺疊原始 JSON）。

### 全取範例（curl／程式用）

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/operation-shift/timetable/trips" | jq .
```

### 只取早晨部分

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/operation-shift/timetable/trips?from=00:07:00&to=00:16:00" | jq .
```

### 回應結構（精簡真實範例）

以下為依目前推算模型、對應畫面上「ST0007 → TN0011 貼齊」的形狀（實際筆數依你庫內班表而定；`trip_code`＝路線代號＋開始時刻的 `HHMM`）：

```json
{
  "meta": {
    "shift_id": "OS-DRAFT-XXXXXXXX",
    "name": "尖峰示範班表",
    "publish_status": "published",
    "source": "published",
    "generated_at": "2026-08-04T03:00:00.000Z",
    "updated_at": "1722744000000"
  },
  "filter": {
    "from": "00:00:00",
    "to": "24:00:00",
    "from_second": 0,
    "to_second": 86400
  },
  "trip_count": 2,
  "trips": [
    {
      "trip_code": "ST0007",
      "block_id": "b-st",
      "timeline_row": 1,
      "task_type": "passenger",
      "source": "template_bar",
      "route_id": "st",
      "route_code": "ST",
      "route_name": "S2W上行 > T3上行",
      "card_start": "00:07:40",
      "card_end": "00:11:30",
      "card_start_second": 460,
      "card_end_second": 690,
      "stations": [
        {
          "order": 1,
          "station_id": "s2w",
          "station_name": "S2W",
          "role": "origin",
          "arrival": null,
          "departure": "00:07:40",
          "dwell_complete": null,
          "base_dwell_seconds": 0,
          "dwell_seconds": 0,
          "travel_to_next_seconds": 100
        },
        {
          "order": 2,
          "station_id": "t3",
          "station_name": "T3上行",
          "role": "terminal",
          "arrival": "00:10:40",
          "departure": null,
          "dwell_complete": "00:11:30",
          "base_dwell_seconds": 40,
          "dwell_seconds": 50,
          "travel_to_next_seconds": null
        }
      ]
    },
    {
      "trip_code": "TN0011",
      "block_id": "b-tn",
      "timeline_row": 1,
      "task_type": "passenger",
      "source": "template_bar",
      "route_id": "tn",
      "route_code": "TN",
      "route_name": "T3上行 > N2W上行",
      "card_start": "00:11:30",
      "card_end": "00:15:10",
      "card_start_second": 690,
      "card_end_second": 910,
      "stations": [
        {
          "order": 1,
          "station_id": "t3",
          "station_name": "T3上行",
          "role": "origin",
          "arrival": null,
          "departure": "00:11:30",
          "dwell_complete": null,
          "base_dwell_seconds": 0,
          "dwell_seconds": 0,
          "travel_to_next_seconds": 100
        },
        {
          "order": 2,
          "station_id": "n2w",
          "station_name": "N2W",
          "role": "terminal",
          "arrival": "00:13:10",
          "departure": null,
          "dwell_complete": "00:15:10",
          "base_dwell_seconds": 40,
          "dwell_seconds": 120,
          "travel_to_next_seconds": null
        }
      ]
    }
  ]
}
```

### 欄位語意（站點）

| `role` | 怎麼讀 |
|--------|--------|
| `origin` | **只看 `departure`**（＝本卡開始）。`arrival` 固定 `null`（抵達屬上一卡末站） |
| `intermediate` | `arrival` + `departure` |
| `terminal` | `arrival` + **`dwell_complete`**（＝卡結束；完成靠站／緩衝，不稱出發） |

**保證**：`stations[0].departure === card_start`（對齊 10 秒格後）；末站 `dwell_complete === card_end`。兩卡同站貼齊時，上一卡 `dwell_complete` 會等於下一卡 `departure`。

---

## 2. 取得各站點計畫 ETA

### `GET /syncdrive-api/operation-shift/timetable/station-etas`

把所有正線班次拆成「站點事件」時間線，方便站顯只訂閱某一站。

| Query | 必填 | 說明 |
|-------|------|------|
| `from` / `to` | 否 | 事件時刻（抵達或離站）落在區間內才回傳 |
| `station_id` | 否 | 只取單一站 |

每筆事件含：**停靠點別名** `station_alias`（地圖）、**到站** `eta_arrive`、**離站／靠站完成** `eta_depart`、**靠站**／**緩衝**／**有效停靠**、`non_stop`（到站＝離站時為 true）、`role`。  
預設**排除虛擬渡線**（`xo_*`）；回應的 `stations[]` 會列出**地圖上全部停靠點別名**（含 ETA 為 0），方便站顯固定頁籤。  
`vehicle_id` **目前一律 `null`**。

### 互動取用（建議）

開 [http://localhost:4000/班表ETA取用範例.html](http://localhost:4000/班表ETA取用範例.html) → 依站別名頁籤看表格；點 **「欄位」** 用框框看每個 API 欄位（可再摺疊原始 JSON）。

### 全站、全時段（curl／程式用）

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/operation-shift/timetable/station-etas" | jq .
```

### 只看 T3、早晨窗口

```bash
curl -s "http://127.0.0.1:3000/syncdrive-api/operation-shift/timetable/station-etas?station_id=station_4&from=00:10:00&to=00:12:00" | jq .
```

### 回應精簡範例

```json
{
  "meta": {
    "shift_id": "OS-DRAFT-XXXXXXXX",
    "name": "尖峰示範班表",
    "publish_status": "published",
    "source": "published",
    "generated_at": "2026-08-04T03:00:00.000Z",
    "updated_at": "1722744000000"
  },
  "filter": {
    "from": "00:10:00",
    "to": "00:12:00",
    "from_second": 600,
    "to_second": 720,
    "station_id": "station_4"
  },
  "eta_count": 2,
  "etas": [
    {
      "station_id": "station_4",
      "station_name": "T3上行",
      "role": "terminal",
      "eta_arrive": "00:10:40",
      "eta_depart": "00:11:30",
      "eta_arrive_second": 640,
      "eta_depart_second": 690,
      "base_dwell_seconds": 36,
      "dwell_seconds": 50,
      "buffer_seconds": 14,
      "trip_code": "ST0007",
      "block_id": "b-st",
      "timeline_row": 1,
      "route_code": "ST",
      "route_name": "S2W上行 > T3上行",
      "vehicle_id": null
    },
    {
      "station_id": "station_4",
      "station_name": "T3上行",
      "role": "origin",
      "eta_arrive": null,
      "eta_depart": "00:11:30",
      "eta_arrive_second": null,
      "eta_depart_second": 690,
      "base_dwell_seconds": 0,
      "dwell_seconds": 0,
      "buffer_seconds": 0,
      "trip_code": "TN0011",
      "block_id": "b-tn",
      "timeline_row": 1,
      "route_code": "TN",
      "route_name": "T3上行 > N2W上行",
      "vehicle_id": null
    }
  ]
}
```

關節站讀法：ST 的 `eta_depart`（靠站完成）與 TN 的 `eta_depart`（本卡出發）應為**同一秒**。

---

## 3. 與班次卡的對齊承諾

| 問題 | 答案 |
|------|------|
| 首站出發是不是畫面上抄上一卡？ | **否**。`departure`＝本卡 `card_start`。 |
| 為何會跟上卡末站一樣？ | 引擎同站折返間隔為 0 → 兩卡貼齊，各自算出同一個時刻。 |
| 中間有恢復空檔？ | 下一卡 `card_start` 較晚；ETA／首站出發跟著卡走，不會倒貼回上一卡結束。 |
| 引擎是否持久化逐站？ | 目前存卡起迄＋路線；API **當場展開**（與前端 hover 同模型）。 |

實作位置：`backend/src/operation-shift/timetable/`、`operation-shift.controller.ts`。

---

## 4. 錯誤情形

| HTTP | 情況 |
|------|------|
| 404 | 庫內沒有任何含 `scheduleOutput.plan` 的班表 |
| 400 | 發布時沒有 plan |

---

## 5. 相關文件

- [現行策略 · 同站折返關節](排班引擎現行策略.md)
- [排班引擎規格](排班引擎規格.md)

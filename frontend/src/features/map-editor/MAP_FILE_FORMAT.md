# Map File Format（現行 schemaVersion **2**）

地圖清單「導出／匯入」與編輯器儲存使用的 JSON 契約。  
匯出前請先在編輯器**儲存地圖**（導出的是圖書館內最後一次存檔的 `mapDocument`）。

## Top-level shape（V2）

```json
{
  "schemaVersion": 2,
  "mapId": "my-map-id",
  "displayName": "顯示名稱",
  "description": "optional",
  "version": "v0.0.1",
  "createdAt": "optional ISO",
  "updatedAt": "optional ISO",
  "pixelSize": { "width": 1920, "height": 1080 },
  "pixelOrigin": { "x": 0, "y": 0 },
  "creationMode": "blank",
  "areas": [],
  "routeGroups": [],
  "routes": [],
  "visibleRouteIds": ["route-1"],
  "pointTopology": { "version": 1, "nodes": [], "edges": [] }
}
```

- `creationMode`：`blank`（空白圖台）或 `trackGen`（進場即鋪滿高精地圖元件）。省略視為 `blank`（舊檔相容）
- `areas[]`：各 Area 及其 `facilities[]`（含 `TrackCrossover`、`Facility.facilityDockingPoint` 等）
- `routes`／`routeGroups`：營運路線與群組（可省略若為空）
- `visibleRouteIds`：地圖上要顯示的路線 id（眼睛開關）。省略或 `[]`＝全部隱藏；**載入／匯入依此還原，不強制全開**
- `pointTopology`：路網拓撲（節點＋有向邊；可省略若為空）。細節見 `document/點位拓撲規格.md`
- 場域公尺座標：原點**左下**，x 向右、y 向上（與編輯器場域座標一致）

### 會完整 round-trip 的新元件／資料

| 資料 | JSON 位置 |
|---|---|
| 虛擬渡線 `TrackCrossover` | `areas[].facilities[]`，`parameters.trackCrossoverPortals`（`a`／`b`：`xM`/`yM`/`attachedTrackId`/`waypointCode`/`alias`） |
| 設施停靠點 | `Facility.parameters.facilityDockingPoint`：`{ xM, yM, alias? }` |
| 路網拓撲 | 頂層 `pointTopology`（含 `facility-docking`、`crossover-waypoint` 等 kind） |
| 路線／群組 | 頂層 `routes`、`routeGroups` |
| 路線可視 | 頂層 `visibleRouteIds`（眼睛開關） |

### 不會寫入地圖 JSON

- 編修紀錄（IndexedDB）

---

## Legacy：Map File V1（匯入時自動升級為 V2）

舊檔仍可匯入：

```json
{
  "schemaVersion": 1,
  "mapId": "vtms-main-loop",
  "displayName": "VTMS 主迴路圖台",
  "description": "optional",
  "coordinateSystem": {
    "extentMeters": { "width": 960, "height": 420 },
    "description": "optional"
  },
  "mapCenterMeters": { "x": 937, "y": 251 },
  "facilities": []
}
```

- V1 使用單一 `facilities[]`（無 `areas`）；匯入後升級為 V2 Area 結構。

## Facility entry fields

Common fields for every facility:

- `id`, `type`, `name`, `customName`
- `positionMeters: { x, y }`
- `rotationDeg`
- optional `areaSizePx: { w, h }` (for Area-local display size)
- optional `parameters`

State fields:

- `Slot` uses `slotOccupancy` + `slotEquipmentState`
- Non-slot uses `currentState`

## Supported facility types

### 分類（暫定）

- **設備（equipment）**：`Signal` 紅綠燈、`Pole` 智慧桿、`PSD` 月台門 — 元件庫拖入對應類型；**不可**用 `Facility.purpose` 文字代替。
- **設施（facility area）**：`Facility`（`name`: `FacilityArea`）大型區塊 — 充電格／停車格／維修格等，用途寫在 `parameters.purpose`。
- **分區入口／分區**：`Facility`（`name`: `ZoneEntrance` | `ZonePartition`）— 入口為虛線方塊、可連結多個分區；分區場域範圍由入口綁定，可容納子設施。
- 其他：`Geofence`、`Track`、`DockingPoint`、`Waypoint`、`RoadLine`、`Slot`（legacy）

### 類型清單

- `Slot` (`name`: `Parking | Charging | Wash | Repair`) — legacy
- `Facility` (`name`: `FacilityArea`) — 大型設施區塊
- `Facility` (`name`: `ZoneEntrance`) — 分區入口（虛線方塊；車輛進入可傳送到連結分區）
- `Facility` (`name`: `ZonePartition`) — 分區（場域範圍跟隨入口連結；可容納設施）
- `Geofence` (`name`: `Geofence`)
- `PSD` (`name`: `Gate`) — 設備／月台門
- `Signal` (`name`: `Light`) — 設備／紅綠燈
- `Track` (`name`: `Rail`)
- `Pole` (`name`: `SmartPole`) — 設備／智慧桿
- `DockingPoint` (`name`: `DockingPoint`) — 地圖停靠點／營運節點參照
- `Waypoint` (`name`: `Waypoint`) — 途經點；自駕車必經點位（預設綠色圓點）
- `RoadLine` (`name`: `RoadLine`)
- `TrackCrossover` (`name`: `TrackCrossover`) — 虛擬渡線；端點 A／B 為途經點，可入路線與拓撲
## Parameters by component

### Shared/common

- `labelStyle`: text style config (`visible`, `fontSizePx`, `color`, `fontWeight`, `fontStyle`, `labelPlacement`, `labelOffsetPx`, `labelRotationDeg`)
- `mqttInstanceId`: override MQTT tail ID
- `mqttEntityId`: legacy full entityId override

### 場域座標／範圍（Ref Field）

座標系：場域公尺，原點左下，橫向 x、縱向 y。未設定時欄位可為 `null`。

**單點**（`Signal` / `Pole` 智慧桿 / `PSD` 月台門）：

- `refFieldXM`: number | null
- `refFieldYM`: number | null

**範圍**（`Track` / `Facility` / `Geofence`，與軌道相同 min/max）：

- `refFieldXMinM`: number | null
- `refFieldXMaxM`: number | null
- `refFieldYMinM`: number | null
- `refFieldYMaxM`: number | null

**斜接四角點**（`Track` 且 `name: RailTaper`；優先語意）：

- `refFieldCornersM`: `[{ "xM": number, "yM": number }, …]` 共四點，順序 A→B→C→D（A＝A 端起、B＝A 端迄、C＝B 端迄、D＝B 端起）。編輯器選取時在圖上四角標 A–D，並依四點同步寫入上方 min/max，供定位／導通沿用。

### Zone / Facility / DockingPoint

- `purpose` — **僅大型設施區塊（`type: Facility` 且 `name: FacilityArea`）**：充電格、停車格、維修格等用途文字（選填；清單描述會顯示於 Area 名稱之後）。**不可**用來把設施標成紅綠燈／智慧桿／月台門。
- `remarks` — 滑鼠懸停提示（選填；不應作為用途或類型判斷依據）
- `defaultFillColor`
- `colorRules: [{ "fieldPath": "status", "operator": "eq", "compareValue": "occupied", "color": "#0e7490" }]`
- `iconDisplay`: `none` | `builtin` | `custom`
- `customIconUrl`: image URL when `iconDisplay` is `custom`
- `facilityDockingPoint`: `{ "xM": number, "yM": number, "alias"?: string }` — **設施停靠點**（選填）。場域絕對公尺座標，必須落在本設施 `refFieldXMinM`–`XMaxM` / `YMinM`–`YMaxM` 範圍內。`alias` 為顯示別名（選填）；未設定時預設為「設施名稱＋停靠點」。圖上以綠色圓點顯示於設施內，可拖曳但不可超出設施外框；亦會出現在點位清單「設施停靠點」分類，並可在路網拓撲以 `kind: "facility-docking"`、`id: "fdock:<facilityId>"` 載入。

#### ZoneEntrance（分區入口）

- `zoneEntranceLinks`: 陣列，每項：
  - `id` — 連結穩定 id
  - `name` — 分區顯示名稱
  - `xMinM` / `xMaxM` / `yMinM` / `yMaxM` — 此分區代表的**絕對場域範圍**（公尺）
  - `zoneFacilityId` — 已連結的 `ZonePartition` 設施 id
- 編輯器從**場上既有分區**選擇連結；已被任一入口連結的分區不會重複出現。
- 入口圖台位置與尺寸**不**決定分區場域範圍；改連結表會同步寫入對應分區的 `refField*`。
- 車輛進入入口後傳送到連結分區（模擬／運行層之後接）。
- **軌道接合**：一般軌道／圓角／斜接／分岔／交叉的端面可吸附並接合到分區入口外框四邊（編輯器幾何；路網圖仍僅含 `Track`）。

#### ZonePartition（分區）

- `zonePartitionEntranceId` / `zonePartitionLinkId` — 綁定所屬入口與連結
- `refFieldXMinM`…`YMaxM` — **由入口連結同步**，與分區在圖台上的放置無關
- 子設施以 `parentZoneId` 隸屬此分區；拖曳時寫入 `zoneLocalField: { u, v }`（相對分區圖台 0–1），再線性映射到分區場域範圍得到真實場域座標

#### 子設施隸屬分區

- **僅** `type: Facility` + `name: FacilityArea`（資產列「設施」）可隸屬；軌道、停靠點、號誌、分區／入口等皆不可
- `parentZoneId` — 所屬 `ZonePartition` 的設施 id
- `zoneLocalField`: `{ "u": number, "v": number }` — 相對分區（0–1，原點左下）
- `zoneEntranceLinks` 僅寫在 `ZoneEntrance`；`zonePartitionEntranceId`／`zonePartitionLinkId` 僅寫在 `ZonePartition`

#### DockingPoint（停靠點）

- `stationId` — **站點唯一識別**（使用者可編輯；預設 `station_1`、`station_2`…；圖台內不可重複）。對應營運協議 `task_params.station_id` 與 MQTT `current_leg.target_station_id`。
- ~~`stationName`~~ — **已廢止**；顯示名稱改用設施的 `customName`（載入時會把舊 `stationName` 遷入 `customName` 後移除）
- ~~`dockingLeg`~~ — **已廢止**（舊上下行標記）；載入時剝除。路線預覽僅依座標吸附最近軌道，不依賴此欄位
- `refFieldXM` / `refFieldYM` — 場域座標（單點，與 Signal 相同）
- `iconMode`: `dot` | `builtin` | `custom`（預設 `dot`）
- `customIconUrl`: 自訂圖示 URL（`iconMode` 為 `custom` 時）

#### Waypoint（途經點）

- `waypointCode` — **途經點唯一代號**（使用者可編輯；預設 `waypoint_1`、`waypoint_2`…；全圖不可重複）。圖台以綠色圓點顯示。
- ~~`waypointName`~~ — **已廢止**；顯示名稱改用 `customName`（載入時遷移後移除）
- `refFieldXM` / `refFieldYM` — 場域座標（單點，與 DockingPoint 相同）

> **已廢止（載入時自動剝除）**：`dockingStation`、`dockingLeg`、`operationNodeId`、`nodeRole`

範例：

```json
{
  "id": "42",
  "type": "DockingPoint",
  "name": "DockingPoint",
  "customName": "T3下行",
  "positionMeters": { "x": 120, "y": 80 },
  "parameters": {
    "stationId": "station_3",
    "refFieldXM": 937.5,
    "refFieldYM": 251.2,
    "iconMode": "builtin"
  }
}
```

### Signal

- `mountDirection`: `up` | `down` | `left` | `right`（對應 traffic-signals 圖示安裝方向）
- `defaultLamp`: `green` | `red` | `offline`（無規則命中時）
- `iconRules`: `[{ "fieldPath": "signal", "operator": "eq", "compareValue": "green", "lamp": "green" }]`

圖示路徑：`/map-editor-icons/traffic-signals/{lamp}_{mountDirection}.png`

### PSD

- `openPercent` (0-100)
- `alarm` (boolean)
- `mqttOpenPercentKey`
- `sqlOpenPercentField`

### Track

- `trackCornerRadiusMeters`:

```json
{
  "tl": 2.0,
  "tr": 1.5,
  "br": 0,
  "bl": 3.0
}
```

### TrackCrossover（虛擬渡線）

- `trackCrossoverColor` / `trackCrossoverColorOpacity`
- `trackCrossoverStrokePx` / `trackCrossoverCenterGapPct`
- `trackCrossoverBgColor` / `trackCrossoverBgOpacity`
- `trackCrossoverPortals`:

```json
{
  "a": {
    "xM": 40,
    "yM": 20,
    "attachedTrackId": "151",
    "waypointCode": "xo_3_a",
    "alias": "終點別名"
  },
  "b": {
    "xM": 40,
    "yM": 40,
    "attachedTrackId": "063",
    "waypointCode": "xo_3_b",
    "alias": "起點別名"
  }
}
```

### Geofence

Geometry and style are fully stored in `parameters`:

- `verticesMeters: [{ "x": 500, "y": 200 }, ...]` (minimum 3 vertices)
- `strokeStyle: "solid" | "dashed" | "dotted"`
- `strokeWidthPx`
- `strokeColor`
- `fillEnabled`
- `fillColor`（底色 `#rrggbb`；舊版地圖亦支援 `rgba(...)`）
- `fillOpacity`（0～1；未指定時由 `fillColor` 的 alpha 或預設 0.12 推算）
- `labels`: text widgets inside the polygon

Geofence label object:

```json
{
  "id": "gf-lbl-1",
  "text": "A 區",
  "x": 520,
  "y": 215,
  "rotationDeg": 0,
  "fontSizePx": 18,
  "fontWeight": "bold"
}
```

## Geofence sample facility

```json
{
  "id": "124",
  "type": "Geofence",
  "name": "Geofence",
  "customName": "禁行區-A",
  "positionMeters": { "x": 720, "y": 420 },
  "rotationDeg": 0,
  "areaSizePx": { "w": 120, "h": 80 },
  "currentState": "Normal",
  "parameters": {
    "verticesMeters": [
      { "x": 720, "y": 420 },
      { "x": 840, "y": 420 },
      { "x": 840, "y": 500 },
      { "x": 760, "y": 540 },
      { "x": 700, "y": 500 }
    ],
    "strokeStyle": "dashed",
    "strokeWidthPx": 3,
    "strokeColor": "#22d3ee",
    "fillEnabled": true,
    "fillColor": "rgba(34,211,238,0.12)",
    "labels": [
      {
        "id": "gf-lbl-1",
        "text": "A 區",
        "x": 758,
        "y": 470,
        "rotationDeg": 0,
        "fontSizePx": 18,
        "fontWeight": "bold"
      }
    ]
  }
}
```

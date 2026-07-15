# Map File V1 Format

This document describes the JSON contract used by the map editor.

## Top-level shape

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

- `coordinateSystem.extentMeters` defines the editable field size (width × height in meters). Any positive values within editor limits are allowed (default for new maps: `960 x 420`).
- Coordinates are absolute meters with origin at top-left; `x` grows right, `y` grows down.

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

- `Slot` (`name`: `Parking | Charging | Wash | Repair`)
- `Zone` (`name`: `ZoneArea`)
- `Geofence` (`name`: `Geofence`)
- `PSD` (`name`: `Gate`)
- `Signal` (`name`: `Light`)
- `Track` (`name`: `Rail`)
- `Pole` (`name`: `SmartPole`)
- `DockingPoint` (`name`: `DockingPoint`) — 地圖停靠點／營運節點參照
- `Waypoint` (`name`: `Waypoint`) — 途經點；自駕車必經點位（預設綠色圓點）

## Parameters by component

### Shared/common

- `labelStyle`: text style config (`visible`, `fontSizePx`, `color`, `fontWeight`, `fontStyle`, `labelPlacement`, `labelOffsetPx`, `labelRotationDeg`)
- `mqttInstanceId`: override MQTT tail ID
- `mqttEntityId`: legacy full entityId override

### 參照場域（Ref Field）

座標系：場域公尺，原點左下，橫向 x、縱向 y。未設定時欄位可為 `null`。

**單點**（`Signal` / `Pole` 智慧桿 / `PSD` 月台門）：

- `refFieldXM`: number | null
- `refFieldYM`: number | null

**範圍**（`Track` / `Facility` / `Geofence`，與軌道相同 min/max）：

- `refFieldXMinM`: number | null
- `refFieldXMaxM`: number | null
- `refFieldYMinM`: number | null
- `refFieldYMaxM`: number | null

### Zone / Facility / DockingPoint

- `purpose` — 使用者填寫的元件用途（選填；清單描述會顯示於 Area 名稱之後）
- `remarks` — 滑鼠懸停提示（選填；不應作為用途或類型判斷依據）
- `defaultFillColor`
- `colorRules: [{ "fieldPath": "status", "operator": "eq", "compareValue": "occupied", "color": "#0e7490" }]`
- `iconDisplay`: `none` | `builtin` | `custom`
- `customIconUrl`: image URL when `iconDisplay` is `custom`

#### DockingPoint（停靠點）

- `stationId` — **站點唯一識別**（使用者可編輯；預設 `station_1`、`station_2`…；圖台內不可重複）。對應營運協議 `task_params.station_id` 與 MQTT `current_leg.target_station_id`。
- `stationName` — 站點別名（例 `N2W下行`）；同一圖台內不可重複
- `dockingLeg` — 軌道方向（`down` | `up`）；對應 `ROUTE-MAINLINE-DOWN` / `ROUTE-MAINLINE-UP`
- `refFieldXM` / `refFieldYM` — 參照場域座標（單點，與 Signal 相同）
- `iconMode`: `dot` | `builtin` | `custom`（預設 `dot`）
- `customIconUrl`: 自訂圖示 URL（`iconMode` 為 `custom` 時）

#### Waypoint（途經點）

- `waypointCode` — **途經點唯一代號**（使用者可編輯；預設 `waypoint_1`、`waypoint_2`…；全圖不可重複）。圖台以綠色圓點顯示，不顯示名稱。
- `refFieldXM` / `refFieldYM` — 參照場域座標（單點，與 DockingPoint 相同）

> **已廢止（載入時自動剝除）**：`dockingStation`、`operationNodeId`、`nodeRole`

範例：

```json
{
  "id": "42",
  "type": "DockingPoint",
  "name": "DockingPoint",
  "customName": "",
  "positionMeters": { "x": 120, "y": 80 },
  "parameters": {
    "stationId": "station_3",
    "stationName": "T3下行",
    "dockingLeg": "down",
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

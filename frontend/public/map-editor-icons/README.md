# 地圖編輯器圖示庫（Map Editor Icons）

放置 **具代表性的圖示／識別圖**，供 Map Editor 圖台與資產列使用。路徑以網站根目錄為準，例如 `/map-editor-icons/facility/parking.png`。

## 目錄結構

```
map-editor-icons/
  traffic-signals/    交通號誌（紅綠燈、號誌狀態燈等）
  facility/           設施（駐車、充電、洗車、維修、月台門、智慧桿等）
  zones/              區域識別（T3、N2W、S2W、虛線框區域標示等）
  roads/              道路（軌道段、轉角、終端匯流、支線等）
```

## 建議檔名範例

### traffic-signals／交通號誌
- `signal-normal.png`、`signal-warning.png`、`signal-fault.png`
- `sensor-r.png`、`sensor-s.png`（若與號誌同一視覺系統可放此類）

### facility／設施
- `parking.png`、`charging.png`、`wash.png`、`repair.png`
- `smart-pole.png`
- **月台門（PSD）**：圖台以程式元件 `PlatformDoorGraphic` 繪製，開度由 MQTT／SQL 的 **0–100%** 線性控制，不需門片圖檔

### zones／區域識別
- `zone-t3.png`、`zone-n2w.png`、`zone-s2w.png`
- `zone-dashed-frame.png`（通用虛線區域框）

### roads／道路
- `track-segment.png`、`track-corner.png`
- `terminal-p1.png`、`terminal-p2.png`
- `branch-line.png`

副檔名建議 `.png`（透明底）或 `.svg`。

## 與程式碼對應

- 資產列預設仍使用 Lucide：`src/features/map-editor/utils/facilityIcons.tsx`
- 圖台設施底圖：`src/features/map-editor/constants/facilityImages.ts`  
  套用時將路徑改為 `/map-editor-icons/<分類>/<檔名>`

## 新增圖示

1. 依用途放入上列四個資料夾之一
2. 在 `facilityImages.ts` 或後續圖示登記表更新路徑
3. 重新整理 Map Editor／儀表板圖台

與儀表板 UI 圖示分開：`/dashboard-icons/` 為大屏元件，`/map-editor-icons/` 為場域圖台專用。

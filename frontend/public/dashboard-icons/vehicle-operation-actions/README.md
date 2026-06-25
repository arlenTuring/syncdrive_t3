# 車輛作動行為圖示（行駛途中）

自動駕駛車輛在**行駛途中**可能執行的作動行為圖示，顯示於路線進度元件的巴士圖示上方。

**請將圖檔放在：**

```
frontend/public/vehicle-operation-actions/icons/
```

瀏覽器路徑：`/vehicle-operation-actions/icons/檔名.png`

## 設計稿對照（4. 作動行為）

| 建議檔名 | 行為 | 說明 |
|----------|------|------|
| `music.png` | 音樂 | 車內廣播／音樂 |
| `door-open.png` | 開門 | 車門開啟 |
| `door-close.png` | 關門 | 車門關閉 |
| `signal.png` | 號誌 | 號誌／路權 |
| `alert.png` | 告警 | 警示 |
| `dispatch.png` | 調度 | 調度指令 |
| `charging.png` | 充電 | 充電作業 |
| `wash.png` | 洗車 | 洗車 |
| `maintenance.png` | 保養 | 保養 |
| `repair.png` | 維修 | 維修 |
| `parking.png` | 臨停 | 臨時停靠 |
| `vehicle.svg` | 車體 | 路線進度預設；圓角底依載具狀態染色（藍／橘／紅） |

支援 `.png`、`.svg`、`.webp`。

路線進度元件 → **車輛圖示** 填 `vehicle.svg`；底色由 `icon_bg_color` 或 `overall_health` 決定。

## 與路線進度的關係

- **路線進度**（`route-progress` 元件）：軌道、站點、車輛在路線上的位置  
- **作動行為圖示**（本資料夾）：依資料觸發，疊加在巴士圖示上方  

設定方式：編輯器 → 路線進度 → **作動執行對應表**（變數條件 + 圖示檔名）。

程式目錄：`frontend/src/features/dashboard/vehicle-operation-actions/`  
通用圖示庫：`frontend/public/dashboard-icons/`（見 `constants/iconLibrary.ts`）

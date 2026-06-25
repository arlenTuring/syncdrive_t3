# 路線進度（Route Progress）模組

路線軌道、站點、車輛位置。**作動行為圖示**另見 `../vehicle-operation-actions/`。

## 資料夾

| 路徑 | 用途 |
|------|------|
| `route-progress/*.ts` | 站點解析、車輛位置、軌道 UI |
| `../vehicle-operation-actions/` | 設計稿 11 種作動行為與圖示 URL |
| `public/vehicle-operation-actions/icons/` | 作動行為圖示靜態檔 |
| `RouteProgressSettings.tsx` | 屬性面板（含作動行為對應） |

## 站點模式（`stationSource`）

- **manual**：屬性面板手動新增站點
- **json**：從變數／SQL 欄位讀取 JSON 陣列（`stationsJsonVarKey`）
- **legacy-columns**：`dynamicStationFields` 三欄位站名

## 車輛位置

1. **區段模式**：`segment_index` + `segment_remain_pct`
2. **總進度 fallback**：`valueField` / `route_progress`（0–100）
3. **JSON 站點 `remain_pct`**

## 作動行為圖示（`actionIconRules`）

變數符合條件時，在巴士圖示上方顯示 `public/vehicle-operation-actions/icons/` 內檔案。建議變數 `operation_action` 對應設計稿代碼（如 `charging`、`door_open`）。

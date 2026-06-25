# 車輛作動行為（Vehicle Operation Actions）

行駛途中自動駕駛車輛的**作動行為圖示**，與「路線進度」軌道邏輯分開：

| 目錄 | 用途 |
|------|------|
| `public/vehicle-operation-actions/icons/` | 圖示靜態檔（你放圖的地方） |
| `actionCatalog.ts` | 設計稿 11 種行為代碼與建議檔名 |
| `defaultActionRules.ts` | 路線進度「作動行為對應」範例 |
| `resolveVehicleIcon.ts` | 車輛圖示：vehicle.png 或 Lucide |

路線進度元件本體仍在 `../route-progress/`（站點、區段、軌道渲染）。

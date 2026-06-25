# 儀表板圖示庫（Dashboard Icons）

平台泛用預設圖示，供各類儀表板元件選用。分類依**用途類型**命名，不綁特定業務情境。

## 目錄結構

```
dashboard-icons/
  navigation/     導航、定位
  time/           時鐘、時段、下一段
  transport/      載具、調度、臨停
  metrics/        列表、KPI、指標摘要
  charts/         圖表、趨勢
  alerts/         警示、事件
  vehicles/       車輛狀態、分布
  facility/       場站設施（充電、洗車、維修…）
  schedule/       班表、排程
```

**作動行為**（行駛中車輛動作）圖示仍在：

```
vehicle-operation-actions/icons/
```

## 編輯器使用

1. 元件屬性 → **圖片圖示** → 選「預設圖示」
2. 先選**分類**（導航／時間／交通…）
3. 再點縮圖套用
4. 或切換「自訂 URL」貼上已上傳的圖片網址

## 新增預設圖示

1. 將 PNG/SVG 放入對應泛用分類資料夾
2. 在 `frontend/src/features/dashboard/constants/iconLibrary.ts` 的 `PRESET_DASHBOARD_ICONS` 登記 `{ path, label, categoryId }`
3. 重新整理編輯器即可在選擇器中看到

瀏覽器路徑範例：`/dashboard-icons/navigation/nav.png`

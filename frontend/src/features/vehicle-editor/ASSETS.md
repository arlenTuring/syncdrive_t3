# 載具圖檔放哪裡？

**預設 PNG/SVG 請放在 `public/`，不是這個 `src/` 資料夾。**

```
frontend/public/vehicle-editor/
├── body/        ← 車體圖
├── lights/      ← 車燈圖
└── behaviors/   ← 行為圖示 PNG
```

登記新圖：`constants/assetLibrary.ts` → `VEHICLE_PRESET_ASSETS`

# T3 UI Kit｜Navigation 樣式規範

設計來源：[Figma Navigation 指定區塊](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=1889-2549)。

Navigation 以 Ant Design Vue Menu 為基底，再套用以下 Figma 尺寸、色票與文字變數。本版提供樣式與行為規範。

## 色票與文字

| 項目 | 套用變數／規範 |
| --- | --- |
| Navigation 基底色 | `var(--surface-sub-background)` |
| Navigation 底色漸層 | 左下角橘色放射漸層，整層不透明度 20%；參數見下方 |
| Menu／Submenu 文字樣式 | `.text-body-m` |
| 一般文字／基礎單色圖示 | `var(--text-secondary)` |
| 所在群組文字／基礎單色圖示 | `var(--text-theme)` |
| 非所在群組 Pressed 文字／基礎單色圖示 | `var(--text-primary)` |
| 所在群組 Pressed 文字／基礎單色圖示 | `var(--text-theme-light)` |
| 已選取項目文字／基礎單色圖示 | `var(--text-primary)` |
| 分隔線 | `var(--border-quaternary)` |
| 收合／展開側欄圖示 | `var(--text-tertiary)` |

品牌使用 Figma 原始 VTMS Logo（24 × 24px），展開版另顯示 VTMS 字樣（Poppins Medium、16px、#C4CAC4）。各模組使用 Figma 原始單色圖示，以原始 SVG 作為 CSS mask，保留尺寸與幾何，依下列狀態矩陣套用 `currentColor`。

## Navigation 底色漸層

漸層套在整個 Navigation 容器，展開與收合共用，固定於容器左下角；Menu 捲動時漸層不跟著移動。基底色沿用 `var(--surface-sub-background)`，其上疊放 20% 不透明度的橘色到黑色放射漸層。

| 參數 | Figma 值 |
| --- | --- |
| 類型 | Radial／橢圓放射漸層 |
| 中心 | 左下角，X = 0%、Y = 100% |
| X 半徑 | 容器寬度的 80.7142857%（280px 時約 226px；80px 時約 64.57px） |
| Y 半徑 | 容器高度的 43.4970703%（1024px 時約 445.41px） |
| 起點 0% | RGB(243.693372, 101.538904, 0)，約 #F46600；未綁定色票 |
| 終點 100% | #000000，Figma 綁定與基底相同的色票 |
| 整層不透明度 | 20% |

```css
.t3-navigation {
  background-color: var(--surface-sub-background);
  background-image: radial-gradient(
    ellipse 80.7142857% 43.4970703% at 0% 100%,
    rgba(243.693372, 101.538904, 0, 0.2) 0%,
    rgba(0, 0, 0, 0.2) 100%
  );
}
```

橘色色值為此 Navigation 的局部設計值，不覆寫全站 Color System。20% 只作用於漸層，不能設定整個 Navigation 的 `opacity`，以免文字與圖示一併變淡。

## Menu 狀態色票

每格依序為「背景／文字及基礎單色主圖示」。透明表示無填色，顯示 Navigation 背景。

| Figma Active | 說明 | Default | Hover | Pressed |
| --- | --- | --- | --- | --- |
| Off-Close | 非所在群組，子選單收合 | 透明／`var(--text-secondary)` | `var(--link-standard)`／`var(--text-secondary)` | `var(--link-standard-hover)`／`var(--text-primary)` |
| On-Close | 所在群組，子選單收合 | 透明／`var(--text-theme)` | `var(--link-standard)`／`var(--text-theme)` | `var(--link-standard-hover)`／`var(--text-theme-light)` |
| Off-Open | 非所在群組，子選單展開 | 透明／`var(--text-secondary)` | `var(--link-standard)`／`var(--text-secondary)` | `var(--link-standard-hover)`／`var(--text-primary)` |
| On-Open | 所在群組，子選單展開 | 透明／`var(--text-theme)` | `var(--link-standard)`／`var(--text-theme)` | `var(--link-standard-hover)`／`var(--text-theme-light)` |
| On | 目前選取項目 | `var(--link-tonal)`／`var(--text-primary)` | `var(--link-tonal-hover)`／`var(--text-primary)` | `var(--link-tonal-pressed)`／`var(--text-primary)` |

所在群組與目前選取項目分開處理：父群組使用 On-Close／On-Open，實際選取的頁面項目使用 On。

### 展開箭頭

| 類型 | Default | Hover | Pressed |
| --- | --- | --- | --- |
| Off-Close | `var(--text-tertiary)` | `var(--text-secondary)` | `var(--text-primary)` |
| Off-Open | `var(--text-tertiary)` | `var(--text-tertiary)` | `var(--text-primary)` |
| On-Close／On-Open | `var(--text-theme)` | `var(--text-theme)` | `var(--text-theme-light)` |

Close 使用向下箭頭，Open 使用向上箭頭。沒有子選單的項目不顯示展開箭頭。

## 尺寸與間距

| 項目 | 規範 |
| --- | --- |
| Navigation 展開寬度 | 280px |
| Navigation 收合寬度 | 80px |
| Navigation 高度 | 依可用容器高度伸展；Figma 展示高度為 1024px |
| Navigation 底部 Padding | 12px |
| Topbar 高度 | 展開 74px；收合 106px |
| Topbar Padding | 上 24px、下 6px；外層左右 16px，展開版 Logo 列內側再左右 12px |
| Topbar Logo 列高度 | 44px；收合操作按鈕高度 32px |
| 收合／展開側欄圖示尺寸 | 24 × 24px |
| 品牌 Logo | 展開／收合皆 24 × 24px；展開版品牌在左、收合按鈕在右，收合版按鈕在上、品牌在下 |
| 展開版 Menu 容器 Padding | 左右 16px |
| 收合版 Menu 容器 | 左右 Padding 16px；項目寬 48px、圖示置中 |
| Menu／Submenu 高度 | 48px |
| Menu Padding | 上下 0、左右 12px |
| Submenu Padding | 上下 0、左 40px、右 12px |
| Menu／Submenu 內部 Gap | 8px |
| Menu／Submenu 圓角 | 12px |
| 主圖示容器 | 20 × 20px |
| 展開箭頭容器 | 24 × 24px |
| 選單列表、分隔線、幫助中心之間的 Gap | 8px |
| 分隔線高度 | 1px |

選單寬度依所在容器填滿；單個元件 200px、組合範例 264px 為展示寬度，不作為所有 Menu 的固定寬度。Gap 為同一項目內圖示、文字與箭頭之間的間距。

## 選單結構

| 第一層項目 | 子選單（依 Figma 順序） |
| --- | --- |
| 數據監控模組 | 無 |
| 營運管理模組 | 班表部署管理、降級運轉管理、派遣調度管理、車門月台控制 |
| 班表管理模組 | 班次運行紀錄、時間模板管理、班表清單管理、整備任務管理 |
| 事件管理模組 | 即時事件清單、歷史事件紀錄、即時影像監控、歷史影像紀錄、影像來源管理 |
| 載具管理模組 | 即時資訊清單、運行管理日誌、載具註冊管理 |
| 場域管理模組 | 圖資資料管理、虛擬圍籬管理 |
| 服務管理模組 | 路線任務規劃、排程訂單管理、訂單記錄清單 |
| 媒體管理模組 | 媒體內容清單、媒體分組清單、媒體排程設定 |
| 權限管理模組 | 帳號管理中心、角色管理設定 |
| 日誌管理模組 | 無 |
| 幫助中心 | 獨立放在底部；收合版上方顯示分隔線 |

## 工程行為

- 展開版顯示圖示、文字及適用的展開箭頭；收合版顯示置中的圖示，使用 Ant Design Vue Menu 的收合模式處理選單存取。
- 點擊有子選單的父項目切換展開／收合；點擊實際頁面項目更新選取狀態。父群組的展開狀態與頁面選取狀態分開保存。
- 使用受控 `selectedKeys`／`openKeys` 管理所在頁面與展開群組；以 `inlineCollapsed` 切換側欄模式。收合側欄時保留目前選取頁面。
- 文字單行顯示，超出可用寬度以省略號呈現，圖示與箭頭維持固定尺寸。
- 工程整合時，選單內容超出可用高度，僅 Menu 區域支援垂直捲動；Topbar 與底部幫助中心維持各自位置。
- Scrollbar 顯示／隱藏不得改變側欄、Menu 項目寬度及 icon／文字位置。展開時側欄寬 280px、Menu 項目寬 248px；收合時側欄寬 80px、Menu 項目寬 48px。
- 捲動容器向右延伸 16px，讓 scrollbar 使用既有的右側留白；Menu 本身維持上述寬度，不以捲動容器扣除 scrollbar 後的可用寬度重新計算。原生 scrollbar 使用 thin／8px，不擠壓 Menu，也不覆蓋文字或箭頭。
- Typography、Color System 及品牌素材沿用既有定稿內容。互動由 Ant Design Vue Menu 處理，不另訂動畫時間。

### Scrollbar 與 Menu 寬度

```css
.nav-menu-area {
  padding: 0 16px;
  min-height: 0;
}
.nav-menu-scroll {
  flex: 1;
  min-height: 0;
  width: calc(100% + 16px);
  align-self: flex-start;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
}
```

Ant Design Vue Menu 的寬度由側欄展開狀態帶入 `style`：展開為 `248px`、收合為 `48px`。捲動容器的寬度包含 scrollbar 區域，不能將其中的 Menu 設為 `width: 100%`。

# T3 UI Kit｜Slider 工程規範

設計來源：[Figma Slider](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=240-23093)。

以 Ant Design Vue Slider 為互動基底，套用本 UI Kit 的 Style／State 與色票。包含 Basic Slider、Range Slider，以及 Handle-Track／Range-Handle-Track／Bottom-Track 子元件。

本文件建立共用 Slider 本身的規範；日後頁面引用時只需標示 Slider 類型、Style、State、值域與必要的變數覆寫，不重複列出元件內部規格。

## 一、類型與 Style

| 元件 | Style | 說明 |
| --- | --- | --- |
| Basic Slider | `Discrete` | 單值選取，顯示刻度 |
| Basic Slider | `Continuous` | 單值選取，不顯示刻度 |
| Range Slider | `Discrete` | 範圍選取，顯示刻度 |
| Range Slider | `Continuous` | 範圍選取，不顯示刻度 |
| Slider/Handle-Track | `Filled`／`Icon` | 單端點與已選取軌道的子元件 |
| Slider/Range-Handle-Track | `Filled` | 左、右端點及中間已選取軌道 |
| Slider/Bottom-Track | `dot`／`line` | 底軌與刻度；`Tick` 可開啟／關閉 |

Basic Slider 在 Figma 展示 0%、25%、50%、75%、100% 位置。Range Slider 的 `Value` 變體是位置示例，不直接當作 API 的 min／max：

| Figma Value | 左端位置 | 右端位置 | Show Left |
| --- | --- | --- | --- |
| `+-25` | 25% | 75% | 開啟 |
| `+25` | 約 50% | 約 75% | 開啟 |
| `0` | — | 約 50% | 關閉；視覺上只顯示一個端點 |

示意 HTML 使用 0～100 的測試值域；Basic 初始 50、Range 初始 `[25, 75]`。實際 min／max／step 由使用情境帶入，不將 Figma 展示的「0」寫死為實際顯示值。

## 二、State

| 元件 | State | 呈現 |
| --- | --- | --- |
| Basic Slider | `Default` | 一般軌道、端點及數值標籤 |
| Basic Slider | `Pressed` | 操作中的端點顯示 Pressed 外觀與數值氣泡 |
| Basic Slider | `Disabled` | 軌道、端點與數值使用停用樣式；不可操作 |
| Range Slider | `Default`／`Disabled` | 左右端點共用對應狀態 |
| Range-Handle-Track | `Pressed-Left` | 只有左端點顯示 Pressed 外觀，右端點維持 Default |
| Range-Handle-Track | `Pressed-Right` | 只有右端點顯示 Pressed 外觀，左端點維持 Default |

Figma 主範例的欄序為 Disabled／Pressed／Default；Range 的 `Value: 0` 範例在 Pressed 欄仍呈現單一一般端點，靜態展示依該範例保留外觀。

未另定 Hover 色票或動畫時間。僅提供 Default、Pressed、Disabled 視覺狀態；聚焦本身不改變樣式，也不顯示外框。水滴數值只在 Pressed 時顯示，停止操作後立即恢復 Default。

## 三、色票與文字變數

| 部位／狀態 | Color 變數 |
| --- | --- |
| Bottom Track：Default／Pressed／Disabled | `var(--border-tertiary)` |
| 已選取 Track：Default／Pressed | `var(--link-theme-filled)` |
| 已選取 Track：Disabled | `var(--text-disabled)` |
| 端點主色：Default／Pressed | `var(--link-theme-filled)` |
| 端點主色：Disabled | `var(--text-disabled)` |
| 一般數值標籤 | `var(--text-theme)` |
| Disabled 數值標籤 | `var(--text-disabled)` |
| Pressed 數值氣泡底色 | `var(--link-theme-filled)` |
| Pressed 數值氣泡文字 | `var(--color-white-100)` |
| dot 刻度 | `var(--border-primary)`；引用原始圓點 SVG |
| line 刻度 | `var(--border-tertiary)`；引用原始線形 SVG |
| Icon Handle 的圖示 | `var(--color-white-100)`；Icon Style 引用原始圖示 |

Disabled 的 Bottom Track 仍完整顯示 `var(--border-tertiary)`，不可透明或隱藏，也不額外降低透明度。若環境不支援色票中的相對色彩語法，使用等值 `rgba(212, 212, 212, 0.25)` 作為相容值；已選取 Track 仍使用 `var(--text-disabled)`。

數值標籤與氣泡文字使用 `.text-body-xs`；字級、字重及行高由 Typography 類別管理，不在此重複定義文字數值。

Handle 的外圈、Pressed 外觀與 Icon 組合引用 Figma 原始素材，不以額外的全站色票覆寫。

## 四、元件尺寸與位置

| 部位 | 規範 |
| --- | --- |
| Basic／Range 展示尺寸 | 260 × 24px；工程寬度可依父容器配置 |
| 外層 Padding | 四邊 10px |
| 軌道可用寬度 | 元件寬度扣除左右 Padding，共 20px；260px 時為 240px |
| Track 高度 | 4px |
| Track 圓角 | Active 為 128px，Bottom Track 為 400px；呈現圓頭 |
| Handle 邏輯容器 | 20 × 20px，中心對齊 Track 中線 |
| 一般標籤與 Handle | 垂直 Gap 4px；標籤容器寬 24px |
| Pressed 標籤容器 | 24 × 32px；與 Handle 邏輯容器 Gap 4px |
| Pressed 水滴向量 | 42 × 42px，底部對齊標籤容器；實作背景區域須至少 42 × 42px，避免以 24px 文字容器裁切；原始 SVG 可見範圍約 29.6985 × 35.8492px，不裁切超出範圍 |
| Pressed 數值位置 | 標籤容器頂端向下 2px，水平置中 |
| Range 端點 | 分別定位於選取範圍兩端；Active Track 只填滿兩端之間 |
| Bottom-Track 子元件展示寬度 | 200px；非所有 Slider 的固定寬度 |
| Handle-Track 子元件展示寬度 | 60px；非實際已選取區段的固定寬度 |

Handle 素材的可見範圍可超出 20px 邏輯容器，例如 Basic Filled Pressed 素材為 24 × 24px，Range Pressed 素材更新為 24 × 24px（超出邏輯容器四邊各 2px）。不可把素材強制縮成 20 × 20px，也不能裁掉氣泡或陰影。Range Default／Disabled 的原始素材為 20 × 20px；Pressed 非操作端點沿用 Figma 的配對 Default 素材。

上方氣泡超出 24px 元件本體。頁面配置需保留上方顯示空間，父容器不可用 `overflow: hidden` 裁切氣泡。

## 五、工程帶入格式

建議封裝一個共用 `T3Slider`，統一轉接 Ant Design Vue 的受控值、range、disabled、min／max／step 與事件。

```vue
<!-- 單值：Discrete -->
<T3Slider
  v-model="value"
  variant="Discrete"
  :min="0"
  :max="100"
  :step="12.5"
  thumb-style="Filled"
  tick-style="dot"
/>

<!-- 範圍：Continuous -->
<T3Slider
  v-model="rangeValue"
  range
  variant="Continuous"
  :min="0"
  :max="100"
  :step="1"
  :disabled="false"
  @after-change="handleCommit"
/>
```

`T3Slider` 為建議的工程共用封裝名稱。封裝內使用 Ant Design Vue Slider：`value`／`change` 對接 `v-model`，`afterChange` 表示本次操作完成；`tooltipOpen` 關閉，改由 UI Kit 的固定標籤及 Pressed 氣泡呈現。

| 輸入設定 | 型別／說明 |
| --- | --- |
| `modelValue` | Basic 為 number；Range 為 `[lower, upper]` |
| `variant` | `Discrete`／`Continuous` |
| `range` | 是否為範圍選取 |
| `disabled` | 停用整個元件 |
| `min`／`max`／`step` | 值域及合法步距，由使用情境決定 |
| `thumbStyle` | Basic 可用 `Filled`／`Icon`；本 Figma Range 為 `Filled` |
| `tickStyle` | `dot`／`line`；Continuous 不顯示刻度 |
| `showLabel` | 是否顯示數值標籤，對應 LabelText |

Discrete 示意使用 `step=12.5`，在 0～100 間形成九個刻度。此數值是展示設定，可依情境調整；Continuous 示意以 step=1 測試，不代表所有情境只能使用整數。

## 六、互動與 Disabled

- 可拖曳 Handle 或點擊 Track 更新值；Range 可分別操作左右端點。
- 聚焦後可用方向鍵逐步調整，Home／End 到達兩端；鍵盤與指標操作沿用 Ant Design Vue。
- 顯示數值來自實際 modelValue；端點位置依 `(value - min) / (max - min)` 計算。
- Range 保持 `lower <= upper`。兩值相等時端點可視覺重疊，但資料仍為兩個值。
- Disabled 不更新數值、不接受拖曳或鍵盤調整，也不出現 Pressed 氣泡。
- Pressed 僅作用於正在操作的端點，放開滑鼠、觸控或鍵盤按鍵後立即恢復 Default，數值改回一般標籤；即使端點仍聚焦，也不保留水滴。

## 七、素材引用

本元件沒有內容圖片。Handle、刻度與氣泡皆為 UI Kit 內部的原始 SVG 素材；工程文件不附圖，HTML 示意內嵌素材以便離線比對。Icon Handle 的圖示可由既有 Icon 元件帶入，file-name 參考為 `01c17.svg`，不在頁面端重畫。

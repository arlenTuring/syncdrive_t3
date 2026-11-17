# T3 UI Kit｜Button 工程開發文件

[Button Component Set](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2151) · [Figma Button 頁](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=23-6766) · [T3 Design Tokens](https://chatgpt.com/library?file_id=libfile_202bb92aeecc8191bf26b85338556396&account_id=personal)

## 1. 元件介面

此文件適用於含文字標籤的 `Button`（Figma `83:2151`）。母檔共有 **3 個 Hierarchy × 5 個 Style × 4 個 State，合計 60 個 Variant**。

| 輸入／事件 | 可用值與預設 | DOM 對應 |
| --- | --- | --- |
| `label` | 必填文字 | 使用 `.text-body-s-bold`。 |
| `hierarchy` | `superior`、`subordinate`、`danger`。預設 `superior`。 | `data-hierarchy`。Figma 屬性原名為 `Hierachy`。 |
| `variant` | `filled`、`tonal`、`outlined`、`standard`、`text`。預設 `filled`。 | `data-style`。 |
| `leadingIcon`、`trailingIcon` | 選填，各自可傳入 SVG。 | 有提供才渲染插槽。Figma 母件的兩個 icon 屬性預設開啟。 |
| `disabled` | 預設 `false`。 | `true` 時加上原生 `disabled` 屬性。 |
| `type` | `button`、`submit`、`reset`。預設 `button`。 | 原生 `type`。表單操作可明確指定 `submit` 或 `reset`。 |
| `onPress` | 啟用時通知一次。 | 綁定原生 `click`，共用滑鼠與鍵盤路徑。 |

## 2. 版面與文字

| Style | 寬高模式 | Padding（上下／左右） | Gap | 圓角 | 單行樣本高 |
| --- | --- | --- | --- | --- | --- |
| Filled、Tonal、Outlined、Standard | Hug × Hug | 8px／14px | 6px | 8px | 34px |
| Text | Hug × Hug | 0／4px | 4px | 0 | 18px |

- 文字使用 Figma `Body/Body S Blod`，對應定稿的 `.text-body-s-bold`。字型 `Noto Sans TC`、字級 14px、字重 500、行高 18px、字距 0.5px。
- 左右圖示插槽各 **14 × 18px**，與文字垂直置中。圖示沿用該狀態的文字色，以 `currentColor` 傳給單色 SVG。圖示為裝飾，設 `aria-hidden="true"`。
- 依狀態矩陣顯示 **1px 內描邊**，樣式切換時外框尺寸不受描邊影響。寬度由文字、插槽及間距決定。

## 3. 狀態規則

| Figma State | 瀏覽器條件 | 行為 |
| --- | --- | --- |
| Default | 初始與其他狀態解除時 | 顯示所選 Style 的預設配色。 |
| Hover | `:hover`，僅用在支援滑入的裝置 | 指標移出後回到 Default。 |
| Pressed | `:active` | 僅在按壓期間顯示，放開後按指標位置恢復 Hover 或 Default。 |
| Disabled | `:disabled` | 優先套用停用配色，不會收到滑鼠或鍵盤啟用。 |

工程以 `Disabled > Pressed > Hover > Default` 決定外觀。Focus 是鍵盤可及性補充，採 `:focus-visible` 顯示外框。Figma 的 State 屬性維持表中四種。

## 4. 狀態色矩陣

每格依序為 **背景／內描邊／文字與圖示色**。格內保留 Figma Variable Name，「—」對應透明。每格連到母檔對應 Variant。

| Hierarchy／Style | Default | Hover | Pressed | Disabled |
| --- | --- | --- | --- | --- |
| Superior／Filled | `link/theme-filled`／—／`White/100%` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2150) | `link/theme-filled-hover`／—／`White/100%` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2147) | `link/theme-filled-pressed`／—／`White/100%` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2143) | `surface/disabled`／—／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2138) |
| Superior／Tonal | `link/tonal`／—／`text/theme` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2094) | `link/tonal-hover`／—／`text/theme` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2142) | `link/tonal-pressed`／—／`text/theme` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2149) | `surface/disabled`／—／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2140) |
| Superior／Outlined | —／`border/theme-light`／`text/theme` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2139) | `link/tonal-hover`／`border/theme-light`／`text/theme` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2135) | `link/tonal-pressed`／`border/theme-light`／`text/theme` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2133) | —／`border/disabled`／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2130) |
| Superior／Standard | —／—／`text/theme` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2127) | `link/tonal-hover`／—／`text/theme` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2128) | `link/tonal-pressed`／—／`text/theme` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2125) | —／—／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2120) |
| Superior／Text | —／—／`link/theme-filled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2108) | —／—／`link/theme-filled-hover` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2129) | —／—／`link/theme-filled-pressed` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2119) | —／—／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2118) |
| Subordinate／Filled | `link/black-filled`／—／`White/100%` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2115) | `link/black-filled-hover`／—／`White/100%` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2112) | `link/black-filled-pressed`／—／`White/100%` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2111) | `surface/disabled`／—／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2124) |
| Subordinate／Tonal | `link/standard`／—／`text/secondary` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2107) | `link/standard-hover`／—／`text/secondary` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2106) | `link/standard-pressed`／—／`text/secondary` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2114) | `surface/disabled`／—／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2103) |
| Subordinate／Outlined | —／`border/tertiary`／`text/secondary` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2122) | `link/standard-hover`／`border/tertiary`／`text/secondary` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2102) | `link/standard-pressed`／`border/tertiary`／`text/secondary` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2101) | —／`border/disabled`／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2100) |
| Subordinate／Standard | —／—／`text/secondary` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2099) | `link/standard-hover`／—／`text/secondary` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2098) | `link/standard-pressed`／—／`text/secondary` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2097) | —／—／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2096) |
| Subordinate／Text | —／—／`text/secondary` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2095) | —／—／`link/theme-filled-hover` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2109) | —／—／`link/theme-filled-pressed` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2093) | —／—／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2092) |
| Danger／Filled | `link/danger-filled`／—／`White/100%` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2091) | `link/danger-filled-hover`／—／`White/100%` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=611-32701) | `link/danger-filled-pressed`／—／`White/100%` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2090) | `surface/disabled`／—／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2141) |
| Danger／Tonal | `link/danger-tonal`／—／`status/error-emphasis` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2089) | `link/danger-tonal-hover`／—／`status/error-emphasis` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2148) | `link/danger-tonal-pressed`／—／`status/error-emphasis` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2088) | —／—／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2126) |
| Danger／Outlined | —／`border/danger-light`／`status/error-emphasis` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=611-33106) | `link/danger-tonal-hover`／`border/danger-light`／`status/error-emphasis` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=611-33112) | `link/danger-tonal-pressed`／`border/danger-light`／`status/error-emphasis` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=611-33118) | —／`border/disabled`／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=611-33130) |
| Danger／Standard | —／—／`status/error-emphasis` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=611-32660) | `link/danger-tonal-hover`／—／`status/error-emphasis` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=611-32666) | `link/danger-tonal-pressed`／—／`status/error-emphasis` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=611-32672) | —／—／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=611-32684) |
| Danger／Text | —／—／`status/error-emphasis` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2086) | —／—／`status/error` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2123) | —／—／`status/error-emphasis` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2134) | —／—／`text/disabled` [Figma](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2132) |

### Figma Variable Name 與 CSS 對應

| Figma Variable Name | CSS |
| --- | --- |
| `White/100%` | `var(--color-white-100)` |
| `border/danger-light` | `var(--border-danger-light)` |
| `border/disabled` | `var(--border-disabled)` |
| `border/tertiary` | `var(--border-tertiary)` |
| `border/theme-light` | `var(--border-theme-light)` |
| `link/black-filled` | `var(--link-black-filled)` |
| `link/black-filled-hover` | `var(--link-black-filled-hover)` |
| `link/black-filled-pressed` | `var(--link-black-filled-pressed)` |
| `link/danger-filled` | `var(--link-danger-filled)` |
| `link/danger-filled-hover` | `var(--link-danger-filled-hover)` |
| `link/danger-filled-pressed` | `var(--link-danger-filled-pressed)` |
| `link/danger-tonal` | `var(--link-danger-tonal)` |
| `link/danger-tonal-hover` | `var(--link-danger-tonal-hover)` |
| `link/danger-tonal-pressed` | `var(--link-danger-tonal-pressed)` |
| `link/standard` | `var(--link-standard)` |
| `link/standard-hover` | `var(--link-standard-hover)` |
| `link/standard-pressed` | `var(--link-standard-pressed)` |
| `link/theme-filled` | `var(--link-theme-filled)` |
| `link/theme-filled-hover` | `var(--link-theme-filled-hover)` |
| `link/theme-filled-pressed` | `var(--link-theme-filled-pressed)` |
| `link/tonal` | `var(--link-tonal)` |
| `link/tonal-hover` | `var(--link-tonal-hover)` |
| `link/tonal-pressed` | `var(--link-tonal-pressed)` |
| `status/error` | `var(--status-error)` |
| `status/error-emphasis` | `var(--status-error-emphasis)` |
| `surface/disabled` | `var(--surface-disabled)` |
| `text/disabled` | `var(--text-disabled)` |
| `text/secondary` | `var(--text-secondary)` |
| `text/theme` | `var(--text-theme)` |

## 5. 參考實作

先載入 [T3 Design Tokens](https://chatgpt.com/library?file_id=libfile_202bb92aeecc8191bf26b85338556396&account_id=personal)，再加入下列元件樣式。程式採原生 HTML 與 CSS，框架元件可直接輸出相同的屬性。Hover、Pressed、Disabled 由瀏覽器選擇器處理。

```html
<button type="button" class="t3-button"
        data-hierarchy="superior" data-style="filled">
  <span class="text-body-s-bold">查詢</span>
</button>

<button type="button" class="t3-button"
        data-hierarchy="superior" data-style="outlined" disabled>
  <span class="text-body-s-bold">確認</span>
</button>
```

有圖示時，在標籤前或後加入 `<span class="t3-button__icon" aria-hidden="true">…</span>` 並置入 SVG。此版參考 CSS 以 `t3-button`、`data-hierarchy`、`data-style` 為接線介面。

```css
.t3-button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 14px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  background-color: var(--button-bg, transparent);
  box-shadow: inset 0 0 0 1px var(--button-stroke, transparent);
  color: var(--button-fg, inherit);
}
.t3-button[data-style="text"] {
  padding: 0 4px;
  gap: 4px;
  border-radius: 0;
}
.t3-button__icon {
  display: inline-grid;
  flex: none;
  place-items: center;
  inline-size: 14px;
  block-size: 18px;
}
.t3-button__icon > svg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
}
.t3-button:focus-visible {
  outline: 2px solid var(--border-theme);
  outline-offset: 2px;
}

/* Default */
.t3-button[data-hierarchy="superior"][data-style="filled"] {
  --button-bg: var(--link-theme-filled);
  --button-stroke: transparent;
  --button-fg: var(--color-white-100);
}
.t3-button[data-hierarchy="superior"][data-style="tonal"] {
  --button-bg: var(--link-tonal);
  --button-stroke: transparent;
  --button-fg: var(--text-theme);
}
.t3-button[data-hierarchy="superior"][data-style="outlined"] {
  --button-bg: transparent;
  --button-stroke: var(--border-theme-light);
  --button-fg: var(--text-theme);
}
.t3-button[data-hierarchy="superior"][data-style="standard"] {
  --button-bg: transparent;
  --button-stroke: transparent;
  --button-fg: var(--text-theme);
}
.t3-button[data-hierarchy="superior"][data-style="text"] {
  --button-bg: transparent;
  --button-stroke: transparent;
  --button-fg: var(--link-theme-filled);
}
.t3-button[data-hierarchy="subordinate"][data-style="filled"] {
  --button-bg: var(--link-black-filled);
  --button-stroke: transparent;
  --button-fg: var(--color-white-100);
}
.t3-button[data-hierarchy="subordinate"][data-style="tonal"] {
  --button-bg: var(--link-standard);
  --button-stroke: transparent;
  --button-fg: var(--text-secondary);
}
.t3-button[data-hierarchy="subordinate"][data-style="outlined"] {
  --button-bg: transparent;
  --button-stroke: var(--border-tertiary);
  --button-fg: var(--text-secondary);
}
.t3-button[data-hierarchy="subordinate"][data-style="standard"],
.t3-button[data-hierarchy="subordinate"][data-style="text"] {
  --button-bg: transparent;
  --button-stroke: transparent;
  --button-fg: var(--text-secondary);
}
.t3-button[data-hierarchy="danger"][data-style="filled"] {
  --button-bg: var(--link-danger-filled);
  --button-stroke: transparent;
  --button-fg: var(--color-white-100);
}
.t3-button[data-hierarchy="danger"][data-style="tonal"] {
  --button-bg: var(--link-danger-tonal);
  --button-stroke: transparent;
  --button-fg: var(--status-error-emphasis);
}
.t3-button[data-hierarchy="danger"][data-style="outlined"] {
  --button-bg: transparent;
  --button-stroke: var(--border-danger-light);
  --button-fg: var(--status-error-emphasis);
}
.t3-button[data-hierarchy="danger"][data-style="standard"],
.t3-button[data-hierarchy="danger"][data-style="text"] {
  --button-bg: transparent;
  --button-stroke: transparent;
  --button-fg: var(--status-error-emphasis);
}

/* Hover */
@media (hover: hover) {
  .t3-button[data-hierarchy="superior"][data-style="filled"]:where(:hover:not(:disabled)) {
    --button-bg: var(--link-theme-filled-hover);
    --button-stroke: transparent;
    --button-fg: var(--color-white-100);
  }
  .t3-button[data-hierarchy="superior"][data-style="tonal"]:where(:hover:not(:disabled)),
  .t3-button[data-hierarchy="superior"][data-style="standard"]:where(:hover:not(:disabled)) {
    --button-bg: var(--link-tonal-hover);
    --button-stroke: transparent;
    --button-fg: var(--text-theme);
  }
  .t3-button[data-hierarchy="superior"][data-style="outlined"]:where(:hover:not(:disabled)) {
    --button-bg: var(--link-tonal-hover);
    --button-stroke: var(--border-theme-light);
    --button-fg: var(--text-theme);
  }
  .t3-button[data-hierarchy="superior"][data-style="text"]:where(:hover:not(:disabled)),
  .t3-button[data-hierarchy="subordinate"][data-style="text"]:where(:hover:not(:disabled)) {
    --button-bg: transparent;
    --button-stroke: transparent;
    --button-fg: var(--link-theme-filled-hover);
  }
  .t3-button[data-hierarchy="subordinate"][data-style="filled"]:where(:hover:not(:disabled)) {
    --button-bg: var(--link-black-filled-hover);
    --button-stroke: transparent;
    --button-fg: var(--color-white-100);
  }
  .t3-button[data-hierarchy="subordinate"][data-style="tonal"]:where(:hover:not(:disabled)),
  .t3-button[data-hierarchy="subordinate"][data-style="standard"]:where(:hover:not(:disabled)) {
    --button-bg: var(--link-standard-hover);
    --button-stroke: transparent;
    --button-fg: var(--text-secondary);
  }
  .t3-button[data-hierarchy="subordinate"][data-style="outlined"]:where(:hover:not(:disabled)) {
    --button-bg: var(--link-standard-hover);
    --button-stroke: var(--border-tertiary);
    --button-fg: var(--text-secondary);
  }
  .t3-button[data-hierarchy="danger"][data-style="filled"]:where(:hover:not(:disabled)) {
    --button-bg: var(--link-danger-filled-hover);
    --button-stroke: transparent;
    --button-fg: var(--color-white-100);
  }
  .t3-button[data-hierarchy="danger"][data-style="tonal"]:where(:hover:not(:disabled)),
  .t3-button[data-hierarchy="danger"][data-style="standard"]:where(:hover:not(:disabled)) {
    --button-bg: var(--link-danger-tonal-hover);
    --button-stroke: transparent;
    --button-fg: var(--status-error-emphasis);
  }
  .t3-button[data-hierarchy="danger"][data-style="outlined"]:where(:hover:not(:disabled)) {
    --button-bg: var(--link-danger-tonal-hover);
    --button-stroke: var(--border-danger-light);
    --button-fg: var(--status-error-emphasis);
  }
  .t3-button[data-hierarchy="danger"][data-style="text"]:where(:hover:not(:disabled)) {
    --button-bg: transparent;
    --button-stroke: transparent;
    --button-fg: var(--status-error);
  }
}

/* Pressed */
.t3-button[data-hierarchy="superior"][data-style="filled"]:where(:active:not(:disabled)) {
  --button-bg: var(--link-theme-filled-pressed);
  --button-stroke: transparent;
  --button-fg: var(--color-white-100);
}
.t3-button[data-hierarchy="superior"][data-style="tonal"]:where(:active:not(:disabled)),
.t3-button[data-hierarchy="superior"][data-style="standard"]:where(:active:not(:disabled)) {
  --button-bg: var(--link-tonal-pressed);
  --button-stroke: transparent;
  --button-fg: var(--text-theme);
}
.t3-button[data-hierarchy="superior"][data-style="outlined"]:where(:active:not(:disabled)) {
  --button-bg: var(--link-tonal-pressed);
  --button-stroke: var(--border-theme-light);
  --button-fg: var(--text-theme);
}
.t3-button[data-hierarchy="superior"][data-style="text"]:where(:active:not(:disabled)),
.t3-button[data-hierarchy="subordinate"][data-style="text"]:where(:active:not(:disabled)) {
  --button-bg: transparent;
  --button-stroke: transparent;
  --button-fg: var(--link-theme-filled-pressed);
}
.t3-button[data-hierarchy="subordinate"][data-style="filled"]:where(:active:not(:disabled)) {
  --button-bg: var(--link-black-filled-pressed);
  --button-stroke: transparent;
  --button-fg: var(--color-white-100);
}
.t3-button[data-hierarchy="subordinate"][data-style="tonal"]:where(:active:not(:disabled)),
.t3-button[data-hierarchy="subordinate"][data-style="standard"]:where(:active:not(:disabled)) {
  --button-bg: var(--link-standard-pressed);
  --button-stroke: transparent;
  --button-fg: var(--text-secondary);
}
.t3-button[data-hierarchy="subordinate"][data-style="outlined"]:where(:active:not(:disabled)) {
  --button-bg: var(--link-standard-pressed);
  --button-stroke: var(--border-tertiary);
  --button-fg: var(--text-secondary);
}
.t3-button[data-hierarchy="danger"][data-style="filled"]:where(:active:not(:disabled)) {
  --button-bg: var(--link-danger-filled-pressed);
  --button-stroke: transparent;
  --button-fg: var(--color-white-100);
}
.t3-button[data-hierarchy="danger"][data-style="tonal"]:where(:active:not(:disabled)),
.t3-button[data-hierarchy="danger"][data-style="standard"]:where(:active:not(:disabled)) {
  --button-bg: var(--link-danger-tonal-pressed);
  --button-stroke: transparent;
  --button-fg: var(--status-error-emphasis);
}
.t3-button[data-hierarchy="danger"][data-style="outlined"]:where(:active:not(:disabled)) {
  --button-bg: var(--link-danger-tonal-pressed);
  --button-stroke: var(--border-danger-light);
  --button-fg: var(--status-error-emphasis);
}
.t3-button[data-hierarchy="danger"][data-style="text"]:where(:active:not(:disabled)) {
  --button-bg: transparent;
  --button-stroke: transparent;
  --button-fg: var(--status-error-emphasis);
}

/* Disabled */
.t3-button[data-hierarchy="superior"][data-style="filled"]:where(:disabled),
.t3-button[data-hierarchy="superior"][data-style="tonal"]:where(:disabled),
.t3-button[data-hierarchy="subordinate"][data-style="filled"]:where(:disabled),
.t3-button[data-hierarchy="subordinate"][data-style="tonal"]:where(:disabled),
.t3-button[data-hierarchy="danger"][data-style="filled"]:where(:disabled) {
  --button-bg: var(--surface-disabled);
  --button-stroke: transparent;
  --button-fg: var(--text-disabled);
}
.t3-button[data-hierarchy="superior"][data-style="outlined"]:where(:disabled),
.t3-button[data-hierarchy="subordinate"][data-style="outlined"]:where(:disabled),
.t3-button[data-hierarchy="danger"][data-style="outlined"]:where(:disabled) {
  --button-bg: transparent;
  --button-stroke: var(--border-disabled);
  --button-fg: var(--text-disabled);
}
.t3-button[data-hierarchy="superior"][data-style="standard"]:where(:disabled),
.t3-button[data-hierarchy="superior"][data-style="text"]:where(:disabled),
.t3-button[data-hierarchy="subordinate"][data-style="standard"]:where(:disabled),
.t3-button[data-hierarchy="subordinate"][data-style="text"]:where(:disabled),
.t3-button[data-hierarchy="danger"][data-style="tonal"]:where(:disabled),
.t3-button[data-hierarchy="danger"][data-style="standard"]:where(:disabled),
.t3-button[data-hierarchy="danger"][data-style="text"]:where(:disabled) {
  --button-bg: transparent;
  --button-stroke: transparent;
  --button-fg: var(--text-disabled);
}

```

## 6. 驗收

| 案例 | 預期結果 |
| --- | --- |
| 對照 Figma 的 15 組 Hierarchy／Style | 各組的 Default、Hover、Pressed、Disabled 與矩陣一致。 |
| Superior／Outlined／Disabled（Figma `83:2130`） | 透明背景。內描邊用 `--border-disabled`，文字與圖示用 `--text-disabled`。按鈕停用。 |
| Filled 切成 Text | 單行樣本高從 34px 變為 18px。左右 padding 從 14px 變為 4px，圓角從 8px 變為 0。 |
| 左、右圖示各自加入或移除 | 只有存在的插槽占寬並產生 gap，圖示和文字同色。 |
| 滑入、按下、放開、移出 | 配色依序為 Hover、Pressed、Hover、Default。 |
| 鍵盤與停用 | Tab 到可用按鈕時顯示焦點。Enter 或 Space 啟用一次。Disabled 無法以鍵盤或點擊啟用。 |

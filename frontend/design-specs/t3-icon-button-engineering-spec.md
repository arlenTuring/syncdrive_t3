# T3 UI Kit｜IconButton 工程開發文件

[Figma IconButton Component Set](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2781) · [T3 Design Tokens](https://chatgpt.com/library?file_id=libfile_202bb92aeecc8191bf26b85338556396&account_id=personal)

## 1. 元件介面

IconButton 是只顯示圖示的操作按鈕。Figma 母檔有 **2 種 Size × 3 種 Hierarchy × 5 種 Style × 5 種 State，共 150 個 Variant**。

| 輸入／事件 | 可用值與預設 | DOM 對應 |
| --- | --- | --- |
| `icon` | 必填圖示，支援替換。 | SVG 放入 `.t3-icon-button__icon`，以 `currentColor` 套用狀態色。 |
| `label` | 必填可及名稱，例如「重新整理」。 | 原生 `aria-label`，圖示本身設為 `aria-hidden="true"`。 |
| `size` | `medium`、`small`。預設 `medium`。 | `data-size`。 |
| `hierarchy` | `superior`、`subordinate`、`danger`。預設 `superior`。 | `data-hierarchy`。Figma 原名為 `Hierachy`。 |
| `variant` | `filled`、`tonal`、`outlined`、`standard`、`icon`。預設 `filled`。 | `data-style`。 |
| `pressed` | 選填布林值，供可切換的按鈕使用，由呼叫端保存。 | 有提供時輸出 `aria-pressed="true/false"`；單次操作不加此屬性。 |
| `disabled` | 預設 `false`。 | `true` 時加上原生 `disabled`。 |
| `type` | `button`、`submit`、`reset`。預設 `button`。 | 原生 `type`。 |
| `onPress` | 啟用時觸發一次，切換按鈕由呼叫端更新 `pressed`。 | 綁定原生 `click`。滑鼠和鍵盤共用。 |

## 2. 尺寸與圖示

| Size | 按鈕外框（固定） | Padding | 圓角 | 圖示框 |
| --- | --- | --- | --- | --- |
| Medium | 34 × 34px | 四邊 2px | 8px | 24 × 24px |
| Small | 34 × 34px | 四邊 2px | 8px | 18 × 18px |

- 圖示水平及垂直置中。有描邊時使用 1px 內描邊，按鈕外框仍為 34 × 34px。
- 兩種尺寸的背景、描邊與圖示色相同。單色 SVG 依素材使用 `fill="currentColor"` 或 `stroke="currentColor"`。
- T3 Header 若採用 34 × 36px 的下拉按鈕，將高度覆寫放在該畫面。母檔 Medium 與 Small 的預設都為 34 × 34px。

## 3. 狀態規則

| State | 套用條件 | 解除後 |
| --- | --- | --- |
| Default | 可用且無其他狀態 | 保持預設配色。 |
| Hover | `:hover` 且主要輸入裝置支援滑入 | 指標移出後回到 Active 或 Default。 |
| Pressed | 原生 `:active` | 放開後重新按 Hover、Active、Default 優先序套用。 |
| Active | 可切換的按鈕已開啟，`aria-pressed="true"` | 由呼叫端更新值後解除。 |
| Disabled | 原生 `:disabled` | 停用期間不觸發 `onPress`。 |

外觀優先序為 **Disabled → Pressed → Hover → Active → Default**。用 `:focus-visible` 補上鍵盤焦點外框。開啟選單時依實際選單介面設定 `aria-expanded`，此屬性由選單整合端管理。

## 4. 狀態色矩陣

每格依序為 **背景／內描邊／圖示色**。「—」表示母檔該屬性沒有可見色彩，CSS 使用透明。每格的 M、S 分別連到 Medium、Small 的 Figma Variant。

### Superior

| Style | Default | Hover | Pressed | Active | Disabled |
| --- | --- | --- | --- | --- | --- |
| Filled | `link/theme-filled`／—／`White/100%` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2780) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30385) | `link/theme-filled-hover`／—／`White/100%` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2777) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30387) | `link/theme-filled-pressed`／—／`White/100%` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2778) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30389) | `link/theme-filled`／—／`White/100%` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2776) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30391) | `surface/disabled`／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2775) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30393) |
| Tonal | `link/tonal`／—／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2774) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30395) | `link/tonal-hover`／—／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2771) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30397) | `link/tonal-pressed`／—／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2779) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30399) | `link/tonal`／—／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2770) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30401) | `surface/disabled`／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2769) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30403) |
| Outlined | —／`border/theme-light`／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2768) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30405) | `link/tonal-hover`／`border/theme-light`／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2767) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30407) | `link/tonal-pressed`／`border/theme-light`／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2766) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30409) | `link/tonal`／`border/theme-light`／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2765) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30411) | —／`border/disabled`／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2762) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30413) |
| Standard | —／—／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20206) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30415) | `link/tonal-hover`／—／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20208) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30417) | `link/tonal-pressed`／—／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20210) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30419) | `link/tonal`／—／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20212) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30421) | `surface/disabled`／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20214) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30423) |
| Icon | —／—／`link/theme-filled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2758) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30425) | —／—／`link/theme-filled-hover` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2757) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30427) | —／—／`link/theme-filled-pressed` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2756) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30429) | —／—／`link/theme-filled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2755) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30431) | —／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2754) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30433) |

### Subordinate

| Style | Default | Hover | Pressed | Active | Disabled |
| --- | --- | --- | --- | --- | --- |
| Filled | `link/black-filled`／—／`White/100%` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20221) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30435) | `link/black-filled-hover`／—／`White/100%` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20223) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30437) | `link/black-filled-pressed`／—／`White/100%` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20225) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30439) | `link/black-filled`／—／`White/100%` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20227) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30441) | —／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20229) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30443) |
| Tonal | `link/standard`／—／`text/secondary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20236) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30445) | `link/standard-hover`／—／`text/secondary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20238) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30447) | `link/standard-pressed`／—／`text/secondary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20240) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30449) | `link/standard`／—／`text/secondary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20242) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30451) | —／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20244) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30453) |
| Outlined | —／`border/tertiary`／`text/secondary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2761) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30455) | `link/standard-hover`／`border/tertiary`／`text/secondary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2760) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30457) | `link/standard-pressed`／`border/tertiary`／`text/secondary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2759) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30459) | `link/standard`／`border/tertiary`／`text/secondary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2764) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30461) | —／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2772) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30463) |
| Standard | —／—／`text/secondary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20251) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30465) | `link/standard-hover`／—／`text/secondary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20253) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30467) | `link/standard-pressed`／—／`text/secondary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20255) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30469) | `link/standard`／—／`text/secondary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20257) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30471) | —／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=613-20259) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30473) |
| Icon | —／—／`text/secondary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=635-20571) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=635-20586) | —／—／`link/theme-filled-hover` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=635-20573) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=635-20588) | —／—／`link/theme-filled-pressed` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=635-20575) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=635-20590) | `link/standard`／—／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=635-20577) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=635-20592) | —／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=635-20579) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=635-20594) |

### Danger

| Style | Default | Hover | Pressed | Active | Disabled |
| --- | --- | --- | --- | --- | --- |
| Filled | `link/danger-filled`／—／`White/100%` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30325) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30475) | `link/danger-filled-hover`／—／`White/100%` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30327) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30477) | `link/danger-filled-pressed`／—／`White/100%` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30329) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30479) | `link/danger-filled`／—／`White/100%` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30331) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30481) | —／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30333) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30483) |
| Tonal | `link/danger-tonal`／—／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30340) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30485) | `link/danger-tonal-hover`／—／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30342) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30487) | `link/danger-tonal-pressed`／—／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30344) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30489) | `link/danger-tonal`／—／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30346) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30491) | —／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30348) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30493) |
| Outlined | —／`border/danger-light`／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30355) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30495) | `link/danger-tonal-hover`／`border/danger-light`／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30357) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30497) | `link/danger-tonal-pressed`／`border/danger-light`／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30359) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30499) | `link/danger-tonal`／`border/danger-light`／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30361) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30501) | —／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30363) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30503) |
| Standard | —／—／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30370) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30505) | `link/danger-tonal-hover`／—／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30372) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30507) | `link/danger-tonal-pressed`／—／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30374) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30509) | `link/danger-tonal`／—／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30376) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30511) | —／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30378) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30513) |
| Icon | —／—／`status/error` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2753) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30515) | —／—／`status/error` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2752) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30517) | —／—／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2751) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30519) | —／—／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2750) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30521) | —／—／`text/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=83-2749) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=614-30523) |

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

先載入 T3 Design Tokens，再加入以下 CSS。切換範例中的 `aria-pressed` 由呼叫端在 `onPress` 後更新。圖示路徑可替換為對應的 Material Symbols。

```html
<button type="button" class="t3-icon-button"
        data-size="medium" data-hierarchy="superior" data-style="filled"
        aria-label="重新整理">
  <span class="t3-icon-button__icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         focusable="false">
      <path d="M20 11a8 8 0 1 0-2 6M20 5v6h-6"/>
    </svg>
  </span>
</button>

<button type="button" class="t3-icon-button"
        data-size="small" data-hierarchy="subordinate" data-style="icon"
        aria-label="固定項目" aria-pressed="true">
  <span class="t3-icon-button__icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         focusable="false">
      <path d="M9 5h6l-1 6 3 3H7l3-3-1-6ZM12 14v6"/>
    </svg>
  </span>
</button>
```

```css
.t3-icon-button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 34px;
  block-size: 34px;
  flex: none;
  padding: 2px;
  border: 0;
  border-radius: 8px;
  background-color: var(--icon-button-bg, transparent);
  box-shadow: inset 0 0 0 1px var(--icon-button-stroke, transparent);
  color: var(--icon-button-fg, inherit);
}
.t3-icon-button__icon {
  display: inline-grid;
  place-items: center;
  flex: none;
  inline-size: 24px;
  block-size: 24px;
}
.t3-icon-button[data-size="small"] .t3-icon-button__icon {
  inline-size: 18px;
  block-size: 18px;
}
.t3-icon-button__icon > svg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
}
.t3-icon-button:focus-visible {
  outline: 2px solid var(--border-theme); /* border/theme */
  outline-offset: 2px;
}

/* Default */
.t3-icon-button[data-hierarchy="superior"][data-style="filled"] {
  --icon-button-bg: var(--link-theme-filled);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--color-white-100);
}
.t3-icon-button[data-hierarchy="superior"][data-style="tonal"] {
  --icon-button-bg: var(--link-tonal);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--text-theme);
}
.t3-icon-button[data-hierarchy="superior"][data-style="outlined"] {
  --icon-button-bg: transparent;
  --icon-button-stroke: var(--border-theme-light);
  --icon-button-fg: var(--text-theme);
}
.t3-icon-button[data-hierarchy="superior"][data-style="standard"] {
  --icon-button-bg: transparent;
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--text-theme);
}
.t3-icon-button[data-hierarchy="superior"][data-style="icon"] {
  --icon-button-bg: transparent;
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--link-theme-filled);
}
.t3-icon-button[data-hierarchy="subordinate"][data-style="filled"] {
  --icon-button-bg: var(--link-black-filled);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--color-white-100);
}
.t3-icon-button[data-hierarchy="subordinate"][data-style="tonal"] {
  --icon-button-bg: var(--link-standard);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--text-secondary);
}
.t3-icon-button[data-hierarchy="subordinate"][data-style="outlined"] {
  --icon-button-bg: transparent;
  --icon-button-stroke: var(--border-tertiary);
  --icon-button-fg: var(--text-secondary);
}
.t3-icon-button[data-hierarchy="subordinate"][data-style="standard"],
.t3-icon-button[data-hierarchy="subordinate"][data-style="icon"] {
  --icon-button-bg: transparent;
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--text-secondary);
}
.t3-icon-button[data-hierarchy="danger"][data-style="filled"] {
  --icon-button-bg: var(--link-danger-filled);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--color-white-100);
}
.t3-icon-button[data-hierarchy="danger"][data-style="tonal"] {
  --icon-button-bg: var(--link-danger-tonal);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--status-error-emphasis);
}
.t3-icon-button[data-hierarchy="danger"][data-style="outlined"] {
  --icon-button-bg: transparent;
  --icon-button-stroke: var(--border-danger-light);
  --icon-button-fg: var(--status-error-emphasis);
}
.t3-icon-button[data-hierarchy="danger"][data-style="standard"] {
  --icon-button-bg: transparent;
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--status-error-emphasis);
}
.t3-icon-button[data-hierarchy="danger"][data-style="icon"] {
  --icon-button-bg: transparent;
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--status-error);
}

/* Active */
.t3-icon-button[data-hierarchy="superior"][data-style="filled"]:where([aria-pressed="true"]:not(:disabled)) {
  --icon-button-bg: var(--link-theme-filled);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--color-white-100);
}
.t3-icon-button[data-hierarchy="superior"][data-style="tonal"]:where([aria-pressed="true"]:not(:disabled)),
.t3-icon-button[data-hierarchy="superior"][data-style="standard"]:where([aria-pressed="true"]:not(:disabled)) {
  --icon-button-bg: var(--link-tonal);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--text-theme);
}
.t3-icon-button[data-hierarchy="superior"][data-style="outlined"]:where([aria-pressed="true"]:not(:disabled)) {
  --icon-button-bg: var(--link-tonal);
  --icon-button-stroke: var(--border-theme-light);
  --icon-button-fg: var(--text-theme);
}
.t3-icon-button[data-hierarchy="superior"][data-style="icon"]:where([aria-pressed="true"]:not(:disabled)) {
  --icon-button-bg: transparent;
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--link-theme-filled);
}
.t3-icon-button[data-hierarchy="subordinate"][data-style="filled"]:where([aria-pressed="true"]:not(:disabled)) {
  --icon-button-bg: var(--link-black-filled);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--color-white-100);
}
.t3-icon-button[data-hierarchy="subordinate"][data-style="tonal"]:where([aria-pressed="true"]:not(:disabled)),
.t3-icon-button[data-hierarchy="subordinate"][data-style="standard"]:where([aria-pressed="true"]:not(:disabled)) {
  --icon-button-bg: var(--link-standard);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--text-secondary);
}
.t3-icon-button[data-hierarchy="subordinate"][data-style="outlined"]:where([aria-pressed="true"]:not(:disabled)) {
  --icon-button-bg: var(--link-standard);
  --icon-button-stroke: var(--border-tertiary);
  --icon-button-fg: var(--text-secondary);
}
.t3-icon-button[data-hierarchy="subordinate"][data-style="icon"]:where([aria-pressed="true"]:not(:disabled)) {
  --icon-button-bg: var(--link-standard);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--text-theme);
}
.t3-icon-button[data-hierarchy="danger"][data-style="filled"]:where([aria-pressed="true"]:not(:disabled)) {
  --icon-button-bg: var(--link-danger-filled);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--color-white-100);
}
.t3-icon-button[data-hierarchy="danger"][data-style="tonal"]:where([aria-pressed="true"]:not(:disabled)),
.t3-icon-button[data-hierarchy="danger"][data-style="standard"]:where([aria-pressed="true"]:not(:disabled)) {
  --icon-button-bg: var(--link-danger-tonal);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--status-error-emphasis);
}
.t3-icon-button[data-hierarchy="danger"][data-style="outlined"]:where([aria-pressed="true"]:not(:disabled)) {
  --icon-button-bg: var(--link-danger-tonal);
  --icon-button-stroke: var(--border-danger-light);
  --icon-button-fg: var(--status-error-emphasis);
}
.t3-icon-button[data-hierarchy="danger"][data-style="icon"]:where([aria-pressed="true"]:not(:disabled)) {
  --icon-button-bg: transparent;
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--status-error-emphasis);
}

/* Hover */
@media (hover: hover) {
  .t3-icon-button[data-hierarchy="superior"][data-style="filled"]:where(:hover:not(:disabled)) {
    --icon-button-bg: var(--link-theme-filled-hover);
    --icon-button-stroke: transparent;
    --icon-button-fg: var(--color-white-100);
  }
  .t3-icon-button[data-hierarchy="superior"][data-style="tonal"]:where(:hover:not(:disabled)),
  .t3-icon-button[data-hierarchy="superior"][data-style="standard"]:where(:hover:not(:disabled)) {
    --icon-button-bg: var(--link-tonal-hover);
    --icon-button-stroke: transparent;
    --icon-button-fg: var(--text-theme);
  }
  .t3-icon-button[data-hierarchy="superior"][data-style="outlined"]:where(:hover:not(:disabled)) {
    --icon-button-bg: var(--link-tonal-hover);
    --icon-button-stroke: var(--border-theme-light);
    --icon-button-fg: var(--text-theme);
  }
  .t3-icon-button[data-hierarchy="superior"][data-style="icon"]:where(:hover:not(:disabled)),
  .t3-icon-button[data-hierarchy="subordinate"][data-style="icon"]:where(:hover:not(:disabled)) {
    --icon-button-bg: transparent;
    --icon-button-stroke: transparent;
    --icon-button-fg: var(--link-theme-filled-hover);
  }
  .t3-icon-button[data-hierarchy="subordinate"][data-style="filled"]:where(:hover:not(:disabled)) {
    --icon-button-bg: var(--link-black-filled-hover);
    --icon-button-stroke: transparent;
    --icon-button-fg: var(--color-white-100);
  }
  .t3-icon-button[data-hierarchy="subordinate"][data-style="tonal"]:where(:hover:not(:disabled)),
  .t3-icon-button[data-hierarchy="subordinate"][data-style="standard"]:where(:hover:not(:disabled)) {
    --icon-button-bg: var(--link-standard-hover);
    --icon-button-stroke: transparent;
    --icon-button-fg: var(--text-secondary);
  }
  .t3-icon-button[data-hierarchy="subordinate"][data-style="outlined"]:where(:hover:not(:disabled)) {
    --icon-button-bg: var(--link-standard-hover);
    --icon-button-stroke: var(--border-tertiary);
    --icon-button-fg: var(--text-secondary);
  }
  .t3-icon-button[data-hierarchy="danger"][data-style="filled"]:where(:hover:not(:disabled)) {
    --icon-button-bg: var(--link-danger-filled-hover);
    --icon-button-stroke: transparent;
    --icon-button-fg: var(--color-white-100);
  }
  .t3-icon-button[data-hierarchy="danger"][data-style="tonal"]:where(:hover:not(:disabled)),
  .t3-icon-button[data-hierarchy="danger"][data-style="standard"]:where(:hover:not(:disabled)) {
    --icon-button-bg: var(--link-danger-tonal-hover);
    --icon-button-stroke: transparent;
    --icon-button-fg: var(--status-error-emphasis);
  }
  .t3-icon-button[data-hierarchy="danger"][data-style="outlined"]:where(:hover:not(:disabled)) {
    --icon-button-bg: var(--link-danger-tonal-hover);
    --icon-button-stroke: var(--border-danger-light);
    --icon-button-fg: var(--status-error-emphasis);
  }
  .t3-icon-button[data-hierarchy="danger"][data-style="icon"]:where(:hover:not(:disabled)) {
    --icon-button-bg: transparent;
    --icon-button-stroke: transparent;
    --icon-button-fg: var(--status-error);
  }
}

/* Pressed */
.t3-icon-button[data-hierarchy="superior"][data-style="filled"]:where(:active:not(:disabled)) {
  --icon-button-bg: var(--link-theme-filled-pressed);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--color-white-100);
}
.t3-icon-button[data-hierarchy="superior"][data-style="tonal"]:where(:active:not(:disabled)),
.t3-icon-button[data-hierarchy="superior"][data-style="standard"]:where(:active:not(:disabled)) {
  --icon-button-bg: var(--link-tonal-pressed);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--text-theme);
}
.t3-icon-button[data-hierarchy="superior"][data-style="outlined"]:where(:active:not(:disabled)) {
  --icon-button-bg: var(--link-tonal-pressed);
  --icon-button-stroke: var(--border-theme-light);
  --icon-button-fg: var(--text-theme);
}
.t3-icon-button[data-hierarchy="superior"][data-style="icon"]:where(:active:not(:disabled)),
.t3-icon-button[data-hierarchy="subordinate"][data-style="icon"]:where(:active:not(:disabled)) {
  --icon-button-bg: transparent;
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--link-theme-filled-pressed);
}
.t3-icon-button[data-hierarchy="subordinate"][data-style="filled"]:where(:active:not(:disabled)) {
  --icon-button-bg: var(--link-black-filled-pressed);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--color-white-100);
}
.t3-icon-button[data-hierarchy="subordinate"][data-style="tonal"]:where(:active:not(:disabled)),
.t3-icon-button[data-hierarchy="subordinate"][data-style="standard"]:where(:active:not(:disabled)) {
  --icon-button-bg: var(--link-standard-pressed);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--text-secondary);
}
.t3-icon-button[data-hierarchy="subordinate"][data-style="outlined"]:where(:active:not(:disabled)) {
  --icon-button-bg: var(--link-standard-pressed);
  --icon-button-stroke: var(--border-tertiary);
  --icon-button-fg: var(--text-secondary);
}
.t3-icon-button[data-hierarchy="danger"][data-style="filled"]:where(:active:not(:disabled)) {
  --icon-button-bg: var(--link-danger-filled-pressed);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--color-white-100);
}
.t3-icon-button[data-hierarchy="danger"][data-style="tonal"]:where(:active:not(:disabled)),
.t3-icon-button[data-hierarchy="danger"][data-style="standard"]:where(:active:not(:disabled)) {
  --icon-button-bg: var(--link-danger-tonal-pressed);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--status-error-emphasis);
}
.t3-icon-button[data-hierarchy="danger"][data-style="outlined"]:where(:active:not(:disabled)) {
  --icon-button-bg: var(--link-danger-tonal-pressed);
  --icon-button-stroke: var(--border-danger-light);
  --icon-button-fg: var(--status-error-emphasis);
}
.t3-icon-button[data-hierarchy="danger"][data-style="icon"]:where(:active:not(:disabled)) {
  --icon-button-bg: transparent;
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--status-error-emphasis);
}

/* Disabled */
.t3-icon-button[data-hierarchy="superior"][data-style="filled"]:where(:disabled),
.t3-icon-button[data-hierarchy="superior"][data-style="tonal"]:where(:disabled),
.t3-icon-button[data-hierarchy="superior"][data-style="standard"]:where(:disabled) {
  --icon-button-bg: var(--surface-disabled);
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--text-disabled);
}
.t3-icon-button[data-hierarchy="superior"][data-style="outlined"]:where(:disabled) {
  --icon-button-bg: transparent;
  --icon-button-stroke: var(--border-disabled);
  --icon-button-fg: var(--text-disabled);
}
.t3-icon-button[data-hierarchy="superior"][data-style="icon"]:where(:disabled),
.t3-icon-button[data-hierarchy="subordinate"][data-style="filled"]:where(:disabled),
.t3-icon-button[data-hierarchy="subordinate"][data-style="tonal"]:where(:disabled),
.t3-icon-button[data-hierarchy="subordinate"][data-style="outlined"]:where(:disabled),
.t3-icon-button[data-hierarchy="subordinate"][data-style="standard"]:where(:disabled),
.t3-icon-button[data-hierarchy="subordinate"][data-style="icon"]:where(:disabled),
.t3-icon-button[data-hierarchy="danger"][data-style="filled"]:where(:disabled),
.t3-icon-button[data-hierarchy="danger"][data-style="tonal"]:where(:disabled),
.t3-icon-button[data-hierarchy="danger"][data-style="outlined"]:where(:disabled),
.t3-icon-button[data-hierarchy="danger"][data-style="standard"]:where(:disabled),
.t3-icon-button[data-hierarchy="danger"][data-style="icon"]:where(:disabled) {
  --icon-button-bg: transparent;
  --icon-button-stroke: transparent;
  --icon-button-fg: var(--text-disabled);
}

```

## 6. 驗收

| 操作 | 預期結果 |
| --- | --- |
| Medium 切為 Small | 外框維持 34 × 34px，圖示框由 24 × 24px 改為 18 × 18px，色彩一致。 |
| 對照三種 Hierarchy、五種 Style | 兩種 Size 的五個 State 皆符合矩陣及對應 Figma 節點。 |
| 切換 Subordinate／Icon 的 `aria-pressed` | 開啟時背景用 `link/standard`、圖示用 `text/theme`。關閉後回到透明背景及 `text/secondary`。 |
| 已開啟後，滑入、按下、放開、移出 | 外觀依序為 Hover、Pressed、Hover、Active。 |
| 已開啟後設定 Disabled | 使用矩陣停用色，點擊和鍵盤均無回呼。 |
| 用 Tab、Enter、Space 操作可用按鈕 | 焦點可見，讀取名稱與切換狀態正確。Enter 或 Space 每次啟用一次。 |

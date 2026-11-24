# T3 UI Kit｜Table 樣式規範

Table 以 Ant Design Vue 為基底。本版只定義尺寸、色票、文字與列狀態，其餘功能暫不測試。

## 色票與文字

| 項目 | 套用變數／規範 |
| --- | --- |
| 表格背景 | `var(--surface-background)` |
| Header 文字顏色 | `var(--text-tertiary)` |
| Data 文字顏色 | `var(--text-primary)` |
| Header／Data 文字樣式 | `.text-body-s` |
| 未勾選列 Hover 背景 | `var(--surface-gray-light)` |
| Checkbox 勾選後整列 Highlight | `var(--surface-theme-light)` |
| 已勾選列 Hover 背景 | `var(--surface-theme)` |
| 取消勾選 | 解除 Highlight，回到一般列狀態；Hover 時套用未勾選列 Hover 背景 |

## 尺寸與間距

| 項目 | Header | Data |
| --- | --- | --- |
| 高度 | 48px | 52px |
| Padding | 上下 2px、左右 12px（`2px 12px`） | 上下 2px、左右 12px（`2px 12px`） |
| Gap | 4px | 4px |

高度包含 Padding。Gap 為同一儲存格內文字與元件之間的間距。

Checkbox 本身直接引用已完成的 Checkbox 元件樣式，Table 不另外定義 Checkbox 色票。

Typography 與 Color System 沿用既有定稿變數。

## Center 捲動規則

當欄位總寬度超出 Table 可用寬度時，中間 Center 區域須支援水平捲動，保留各欄設定的寬度。

- 左右已設定的固定欄位維持原位，只有 Center 內容隨水平捲動移動。
- Center 的 Header 與 Data 同步水平捲動，保持欄位對齊。
- 水平 Scrollbar 僅出現在 Center 可捲動範圍內；內容未超出時不顯示。

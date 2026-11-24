# T3 UI Kit｜Dialog 工程規範

設計來源：[Figma Dialog](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=240-23642)。

本文件包含 Basic Usage 的 Info／Success／Error／Warning，以及 Overlay 的有操作列／無操作列兩種容器。互動以 Ant Design Vue Modal 為基底，外觀套用 UI Kit。HTML 示意使用相同 Vue 元件組合，並內嵌樣式及原始圖示，可離線開啟。

## 色票與文字

| 部位 | 變數／元件 |
| --- | --- |
| Dialog 底色 | `var(--surface-popup)` |
| 標題文字 | `.text-body-m-bold`、`var(--text-primary)` |
| 內容文字 | `.text-body-s`、`var(--text-tertiary)` |
| 按鈕文字 | `.text-body-s-bold`；引用既有 Button |
| 關閉圖示 | `var(--text-secondary)`；引用既有 IconButton Standard／Subordinate／Medium 外觀 |
| 操作列頂部分隔線 | `var(--border-quaternary)` |
| Info 主圖示 | `var(--text-tertiary)` |
| Success 主圖示 | `var(--status-success)` |
| Error 主圖示 | `var(--status-error)` |
| Warning 主圖示 | `var(--status-warning-emphasis)` |

Info 在此使用 Figma 的提示鈴鐺圖示與 `--text-tertiary`，不另改為 `--status-info`。四種主圖示皆引用 Figma 原始 SVG，保留原始 28 × 28px 尺寸與色彩。

## Basic Usage｜Dialog_Event

| 項目 | 規範 |
| --- | --- |
| 寬度 | 360px；小視窗受可用寬度限制 |
| 高度 | 依內容撐開；Figma 三行預設內容的展示高度為 244px |
| 容器圓角 | 16px |
| Content Padding | 上 24px、下 8px、左右 20px |
| Content Gap | 16px；主圖示、標題、內容區塊依序垂直排列 |
| 內容文字外層 Padding | 下 12px |
| 內容文字外層 Gap | 16px；同一段內的連續三行不額外加段距 |
| 主圖示 | 28 × 28px |
| Close 定位 | 容器右 20px、上 20px |
| Close 操作範圍 | 34 × 34px，圓角 8px；內部圖示 24 × 24px |
| Actions Padding | 上 12px、下 20px、左右 20px |
| Actions Gap | 12px，整列靠右 |
| Actions 頂部分隔線 | 1px，畫在操作列內側，不額外增加高度 |
| 預設 Actions 高度 | 66px，含 34px 按鈕及上下 Padding |

標題與內容依實際文字換行，高度隨內容增加，不鎖死為展示高度。超出視窗可用高度時，只有內文區域（`.dialog-copy-wrap`）可以垂直捲動；主圖示、標題、Close 與 Actions 都固定，不納入捲動範圍。

### 內文捲動範圍

Info／Success／Error／Warning 共用相同結構：

- 固定標題區（`.dialog-event-header`）：主圖示及標題，`flex: none`。
- 內文捲動區（`.dialog-copy-wrap`）：只有文字內容，`flex: 1 1 auto; min-height: 0; overflow-y: auto`。
- 操作列（`.dialog-actions`）：位於內文捲動區之外，`flex: none`。

外層 `.dialog-event-content` 使用 `overflow: hidden`，不可設定為 `overflow-y: auto`。標題區與內文之間維持 16px Gap；Scrollbar 從標題下方的內文開始，不能延伸到主圖示或標題旁邊。

### 各類型的操作元件

| 類型 | 取消 | 確定 |
| --- | --- | --- |
| Info | Button／Superior／Standard | Button／Superior／Filled |
| Success | Button／Superior／Standard | Button／Superior／Filled |
| Error | Button／Subordinate／Standard | Button／Danger／Filled |
| Warning | Button／Superior／Standard | Button／Superior／Filled |

| 操作色票 | 變數 |
| --- | --- |
| Superior Standard 文字 | `var(--text-theme)` |
| Subordinate Standard 文字 | `var(--text-secondary)` |
| Superior Filled 背景 | `var(--link-theme-filled)` |
| Danger Filled 背景 | `var(--link-danger-filled)` |
| Filled 文字 | `var(--color-white-100)` |

Hover、Pressed、Focus 與 Disabled 沿用既有 Button／IconButton 規範，不在 Dialog 中建立另一套按鈕樣式。Standard 取消按鈕仍保留 Button 的上下 8px、左右 14px Padding；不使用 Text Button 的緊縮尺寸。

## Overlay｜Dialog_Container

| 項目 | 規範 |
| --- | --- |
| 寬度 | 350px；小視窗受可用寬度限制 |
| Figma 展示高度 | 1024px；工程須依視窗可用高度縮限 |
| 容器圓角 | 16px |
| 容器 Padding | 上 20px，其餘 0 |
| Header Padding | 上下 0、左右 20px |
| Header Gap | 8px；標題填滿剩餘空間，Close 靠右 |
| 預設 Header 高度 | 34px |
| Header 標題 | `.text-body-m-bold` |
| Close | 34 × 34px 操作範圍、24 × 24px 圖示 |
| Content Padding | 上下 12px、左右 20px |
| Content Gap | 12px |
| Content 高度 | 填滿 Header 與 Actions 之外的剩餘空間，`flex: 1; min-height: 0` |
| Content 溢位 | 僅 Content 垂直捲動，Header 與 Actions 保持位置 |
| Actions | 可顯示或不顯示；顯示時套用上述操作列尺寸 |
| Actions 內容 | 右側一個 Button／Superior／Filled「確定」 |

無 Actions 時直接移除操作列與其分隔線，Content 使用釋出的空間。Overlay 內容由工程透過 slot 帶入；Figma 空白區是內容容器，不另加入表單或清單。

## 陰影

兩種容器使用相同的 Figma 四層陰影；這是元件局部樣式，不覆寫全站色票。

```css
.t3-dialog-surface {
  background: var(--surface-popup);
  border-radius: 16px;
  box-shadow:
    4px 4px 6px 0 rgba(10, 37, 75, 0.04),
    -1px 1px 32px 0 rgba(10, 37, 75, 0.04),
    -4px 4px 6px 0 rgba(16, 43, 80, 0.04),
    -32px 32px 40px 0 rgba(8, 34, 69, 0.04);
}
```

## 工程組合與行為

Ant Design Vue Modal 負責開啟／關閉、遮罩、焦點管理、Escape 與關閉後焦點返回；內部 Header／Content／Actions 引用本文件元件。移除 Modal 預設 close、footer 及內容 Padding，避免和 UI Kit 的結構重複。Modal 的原生標題保留給可存取名稱使用，Header 以視覺隱藏方式處理；畫面上只呈現 UI Kit 標題。

```vue
<a-modal
  v-model:open="open"
  :width="360"
  centered
  title="Dialog Title"
  :footer="null"
  :closable="false"
  :mask-closable="false"
  :keyboard="true"
  :destroy-on-close="true"
  wrap-class-name="t3-dialog-modal"
>
  <T3DialogEvent type="Error" title="Dialog Title" @cancel="open = false">
    <template #content>
      <p class="text-body-s">Some contents...</p>
    </template>
    <template #actions>
      <T3Button hierarchy="subordinate" variant="standard" label="取消" @press="open = false" />
      <T3Button hierarchy="danger" variant="filled" label="確定" @press="handleConfirm" />
    </template>
  </T3DialogEvent>
</a-modal>
```

`T3DialogEvent`／`T3DialogContainer` 是工程端建議的共用封裝；Button／IconButton 使用既有元件的 props 與事件格式。範例的 `handleConfirm` 由業務層實作。HTML 示意的「確定」只更新操作結果，未串接資料寫入。

- 取消、Close、Escape 都能關閉示意視窗；「確定」交由業務層決定何時關閉。
- 示意的 Modal 不使用點擊遮罩關閉，避免測試時誤觸；遮罩外觀與焦點互動沿用 Ant Design Vue。指定 Figma 區塊未提供獨立遮罩色票，不另建立全站遮罩變數。
- HTML 示意保留視窗四邊至少 24px 空間，Dialog 最大寬度為 `calc(100vw - 48px)`、最大高度為 `calc(100dvh - 48px)`；此為展示的視窗縮限設定。
- 標題需與對話框的可存取名稱關聯；關閉鈕提供「關閉對話框」名稱。保留鍵盤操作、焦點圈與關閉後回到觸發按鈕的行為。
- 不另訂動畫時長；互動由 Ant Design Vue 與既有共用元件處理。

原生 Header 的視覺隱藏樣式保留螢幕閱讀器可讀性，不能使用 `display: none`：

```css
.t3-dialog-modal .ant-modal-header {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

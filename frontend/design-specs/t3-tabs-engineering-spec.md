# T3 UI Kit｜Tabs 工程規範

設計來源：[Figma 指定區塊](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=251-75822)  
基準：2026-11-20 再次比對的元件、變體、隱藏屬性與色票。單一主題，沿用定稿 Typography／Color System。

## 1. 範圍與命名

指定區塊包含 7 種 Tabs 組合、各自的含 Icon／純文字版本，共 14 個可操作範例；另有 7 種 Tab-Unit 的 Active On／Off × Default／Hover，共 28 個固定外觀樣本。狀態對照依主元件的四種變體建立；Left 展示實例有重複的 Off／Default，缺少的 On／Hover 直接引用主元件 `381:9408`。

- **Component 的 Tab=On／Off**：代表含 Icon／純文字組合，並非是否選取。
- **Tab-Unit 的 Active=On／Off**：代表目前選取狀態。
- **State=Default／Hover**：Figma 有定義的互動外觀。沒有 Pressed、Disabled 或動畫變體，本次不新增。
- Tab-Unit 隱藏屬性包含 **Leading Icon、Badge、More**。Leading Icon 預設開；Badge／More 預設關；文字可修改，Icon 可在工程中替換 SVG。示範使用原始 table_chart／more_horiz SVG。

| 樣式 | 組合實例：Icon／純文字 | Tab-Unit 元件集 |
| --- | --- | --- |
| Top | `253:24054`／`253:24055` | `253:21556` |
| Bottom | `253:24079`／`253:24080` | `253:21562` |
| Tonal | `253:24110`／`253:24111` | `253:21618` |
| Fill-H | `1518:2752`／`1518:2753` | `1518:2589` |
| Fill-V | `1526:6178`／`1526:6179` | `1526:6102` |
| Left | `381:9557`／`381:9558` | `381:9403` |
| Right | `381:9670`／`381:9671` | `381:9457` |

## 2. 尺寸與排版

| 樣式 | 組合外框 | 組合內的 Tab-Unit | 獨立 Tab-Unit 樣本 | 選取標記 |
| --- | --- | --- | --- | --- |
| Top | 252 × 32px；gap 0 | 84 × 32px | 84 × 32px | 上緣 2px |
| Bottom | 252 × 32px；gap 0 | 84 × 32px | 84 × 32px | 下緣 2px |
| Tonal | Icon 200 × 40px；純文字 140 × 40px；padding 4px、gap 4px | 高 32px、左右 padding 8px | 高 28px、左右 padding 8px | 以底色區分 |
| Fill-H | Icon 204 × 40px；純文字 144 × 44px；padding 6px、gap 4px | Icon 高 28px；純文字高 32px；左右 padding 8px | 高 28px | 以 Filled 底色區分 |
| Fill-V | Icon 40 × 284px；純文字 40 × 230px；padding 6px、gap 4px | 寬 28px，Icon 高 88px、純文字高 70px | 寬 28px、高 88px（含 Icon） | 以 Filled 底色區分 |
| Left | Icon 96 × 96px；純文字 68 × 96px；gap 12px | 高 24px、寬填滿組合；左右 padding 20px | 高 24px，預設 On 寬 86px／Off 寬 85px | 左緣 2px |
| Right | Icon 96 × 96px；純文字 68 × 96px；gap 12px | 同 Left | 同 Left | 右緣 2px |

Tonal 的獨立 Tab-Unit 與組合內有高度覆寫差異；Fill-H 獨立 Tab-Unit 本次已更新為 28px，與含 Icon 組合一致，純文字組合仍覆寫為 32px。示範以 `context:unit` 保留獨立樣本高度；工程依實際使用情境採對應數值，不將兩種來源混成單一高度。

- 全部文字使用 `--font-primary`（Noto Sans TC）；14／18px、字距 0.5px。Active On 字重 500，Off 字重 400。字重改變可能使 HUG 寬度相差 1px。
- Leading Icon 為 16 × 16px；Icon 與文字及其他配件 gap 4px。
- Top／Bottom 無整顆圓角或預設底色。Bottom 的內層 Wrapper 左右及上下 padding 4px、radius 8px，高 26px；Hover 底色只套在 Wrapper，不填滿 84 × 32px。
- Tonal／Fill-H／Fill-V 組合 radius 12px；單位 radius 8px。
- Tonal 組合底色 `--surface-popup`，無描邊；Fill-H／Fill-V 同底色，使用 1px `--border-quaternary` 內描邊，不額外增加外框尺寸。
- Fill-V 的 Tab-Unit padding 8px 6px，內容直向排列、gap 2px；文字寬 16px，預設 `TAB` 以三個直立字元呈現，文字高 54px。使用 grapheme 拆分為逐字直立排列，不旋轉字母；自訂文字會依長度增高。
- Badge 高 16px、最小寬 16px、左右 padding 4px、radius 1000px；10／14px、字重 500、字距 0.5px。預設文字為 1；開關與數字各自獨立，開啟時 0 也可顯示。
- More 的 IconButton 為 16 × 16px、padding 2px、radius 8px；內部 Icon 18px，依 Figma 原配置允許圖示溢出。Top／Left 的 Off 變體 More 位於文字之前，On 位於文字／Badge 之後；其他樣式在文字／Badge 後。
- Top／Bottom 的固定寬度及 Left／Right 的填滿寬度保留；自訂長文字單行省略，完整內容提供於可存取名稱。Fill-V 為逐字排列，不省略。
- 示範的內容面板與外層文件卡片用於確認切換結果，不屬於 Figma Tabs 元件的背景、邊框或內距規範。

## 3. 色票與狀態

| 樣式 | Active Off／Default | Active Off／Hover | Active On／Default | Active On／Hover |
| --- | --- | --- | --- | --- |
| Top | 透明底、`--text-quaternary` | 透明底、`--text-tertiary` | 透明底、`--text-theme`；標記 `--text-theme` | 透明底、`--text-theme-light`；標記 `--text-theme-light` |
| Left | 透明底、`--text-quaternary` | 透明底、`--text-tertiary` | 透明底、`--text-theme`；標記 `--link-theme-filled` | 透明底、`--text-theme-light`；標記 `--link-theme-filled-hover` |
| Right | 透明底、`--text-quaternary` | 透明底、`--text-tertiary` | 透明底、`--text-theme`；標記 `--text-theme` | 透明底、`--text-theme-light`；標記 `--text-theme-light` |
| Bottom | 透明底、`--text-quaternary` | Wrapper 底 `--link-standard`、文字／Icon `--text-tertiary` | 透明底、`--text-theme`；標記 `--text-theme` | Wrapper 底 `--link-standard`、文字／Icon `--text-theme-light`；標記 `--text-theme-light` |
| Tonal | 透明底、`--text-quaternary` | 底 `--link-standard`、`--text-tertiary` | 底 `--link-standard`、`--text-theme` | 底 `--link-standard`、`--text-theme-light` |
| Fill-H／Fill-V | 透明底、`--text-quaternary` | 底 `--link-standard`、文字／Icon `--text-tertiary` | 底 `--link-theme-filled`、文字／Icon白色 | 底 `--link-theme-filled-hover`、文字／Icon白色 |

Top／Bottom／Right 的選取指示線與文字綁定同一組色票：Default 使用 `--text-theme`、Hover 使用 `--text-theme-light`；Left 仍依其 link 色票。`text/theme` 與 `text/theme-light` 是不同 Token；所有樣式的未選取 Hover 文字／Leading Icon 都使用 `--text-tertiary`；其 Badge 維持自己的色票。

| Badge 所在樣式 | 背景 | 數字 |
| --- | --- | --- |
| Top／Bottom On | `--text-theme` | 白色 |
| Top／Bottom Off | `--text-quaternary` | 白色 |
| Tonal／Left／Right On／Off | `--text-theme` | `--text-invert` |
| Fill-H／Fill-V On | 白色 20% | `--text-invert` |
| Fill-H／Fill-V Off | `--surface-theme` | `--text-theme` |

Badge 不跟隨整顆 Tab 的 Hover 文字變色。More 圖示使用 `--text-secondary`；其獨立按鈕 Hover／Pressed 沿用 IconButton 的 `--link-standard`／`--link-standard-hover`，不新增整顆 Tab 的 Pressed 變體。

## 4. 操作與程式介面

### 頁籤切換

每組預設 3 個頁籤，第 1 個選取；點擊只選取一個，並顯示對應內容。切換樣式、Leading Icon、Badge、More 或修改標題時保留目前頁籤。14 個組合範例資料獨立，28 個固定狀態對照不受實際滑鼠 Hover 改變。

- Top／Bottom／Tonal／Fill-H：左右鍵前後切換；Fill-V／Left／Right：上下鍵前後切換。兩端循環，Home／End 到第一／最後一項。
- 方向鍵採自動啟用，適用示範中的即時本地面板；若產品需要遠端載入資料，工程可另行定義手動啟用模式。
- 只有目前選取的 tab 進入主要 Tab 順序（roving tabindex）。使用真實 button，Enter／Space 由原生點擊機制支援；輸入法組字期間不處理方向鍵。
- 使用 tablist／tab／tabpanel、aria-orientation、aria-selected、aria-controls、aria-labelledby，生成每組唯一的 ID。鍵盤焦點使用額外可見 outline，與 Active 指示線分開。
- More 是獨立的同層 button，沒有在 tab button 裡巢狀另一個 button。點擊 More 僅發出更多操作事件，不改變選取值；示範未自行定義業務選單。
- 主頁籤按鈕覆蓋單位點擊範圍；可視內容層不攔截指標，More 單獨接收點擊。這是工程 DOM 結構補充，用於保留配件排列與正確點擊範圍。

### API

`createT3Tabs(host, options)` 回傳 `select(id)`、`update(patch)`、`getState()`、`destroy()`。

| 選項 | 預設 | 說明 |
| --- | --- | --- |
| style | top | top／bottom／tonal／fill-h／fill-v／left／right |
| items | 3 個 id 不同的項目 | 每個項目有 id、選填 label、content、badge |
| value | 第一個 id | 目前選取 id |
| showIcon | true | Leading Icon 顯示 |
| showBadge／showMore | false | 顯示 Badge／More |
| badge | 1 | 共用 Badge 文字，單項 badge 可覆寫 |
| showPanels | true | 互動測試顯示面板；Figma 組合範例僅展示頁籤 |

省略 label 時，Fill-V 顯示 TAB，其他樣式顯示 Tab；自訂 label 在切換樣式時保留，不強制轉換大小寫。文字使用 textContent 寫入，不解析 HTML。

`select` 遇到不存在的 id 回傳 false；選同一項不發出重複 change。`update` 合併設定，保留選取 id；若更新 items 移除了目前 id，回到第一項。空 items 顯示「沒有頁籤」且選取值為 null。項目 id 必須是唯一的非空字串；不合法設定在修改畫面前拒絕。`getState` 回傳項目的淺複本，避免外部直接改動內部資料。

| 事件 | detail |
| --- | --- |
| t3-tabs-change | `{value,label,style}`，選取值變更時發出 |
| t3-tabs-more | `{value,label,style}`，點擊該項 More 時發出 |

`makeTabUnit(options)` 用於固定樣本，可設定 active、hover、preview、context。`preview:true` 時為帶描述的靜態視覺對照，不建立互動 tab 或業務面板。

## 5. 驗收與驗證

1. 7 種樣式的 Icon／純文字組合均可操作，與 Figma 14 個範例對照。
2. 28 個固定狀態的字重、色票、指示線及底色正確；固定 Default 不受滑鼠 Hover 影響。
3. Badge／More 預設關閉，可獨立開啟；關閉 Icon 不重設目前頁籤或自訂文字。
4. 鍵盤方向符合視覺方向，循環及 Home／End 正確，只有一個 tab 處於 aria-selected=true。
5. 點擊 More 不觸發切換；每組 ID 唯一，tabpanel 關聯正確。
6. Figma 未定義 Disabled／Pressed／動畫時，不自行新增。

驗證包含 JavaScript 語法、選取／鍵盤／事件邏輯、選項切換後保留資料、空項目與 id 驗證、42 個範例建立、Token 引用及文件／示範頁共用程式碼一致性。瀏覽器視覺驗證尚未完成。

## 6. 參考 CSS

先載入定稿 Typography／Color System；以下與示範頁共用。

```css
.t3-tabs { display:inline-flex; max-width:100%; flex-direction:column; gap:24px; font-family:var(--font-primary); }
.t3-tabs[data-axis="vertical"] { flex-direction:row; align-items:flex-start; }
.t3-tabs * { box-sizing:border-box; }
.t3-tabs__list { display:flex; align-items:stretch; flex:none; width:max-content; gap:0; }
.t3-tabs__list[data-axis="vertical"] { flex-direction:column; }
.t3-tabs__list[data-style="tonal"] { gap:4px; padding:4px; border-radius:12px; background:var(--surface-popup); }
.t3-tabs__list:is([data-style="fill-h"],[data-style="fill-v"]) { gap:4px; padding:6px; border-radius:12px; background:var(--surface-popup); box-shadow:inset 0 0 0 1px var(--border-quaternary); }
.t3-tabs__list:is([data-style="left"],[data-style="right"]) { gap:12px; width:96px; }
.t3-tabs__list:is([data-style="left"],[data-style="right"])[data-icons="false"] { width:68px; }
.t3-tab { --tab-text:var(--text-quaternary); --tab-bg:transparent; --tab-line:var(--link-theme-filled); position:relative; display:flex; align-items:center; justify-content:center; flex:none; gap:4px; padding:0; border:0; border-radius:0; color:var(--tab-text); background:var(--tab-bg); font:400 14px/18px var(--font-primary); letter-spacing:.5px; }
.t3-tab[data-active="true"] { --tab-text:var(--text-theme); font-weight:500; }
.t3-tab:is([data-style="top"],[data-style="bottom"]) { width:84px; height:32px; }
.t3-tab:is([data-style="left"],[data-style="right"]) { min-width:0; height:24px; padding:0 20px; }
.t3-tabs__list:is([data-style="left"],[data-style="right"])>.t3-tab { width:100%; }
.t3-tab[data-context="unit"]:is([data-style="left"],[data-style="right"]) { width:max-content; }
.t3-tab[data-style="tonal"] { height:32px; padding:0 8px; border-radius:8px; }
.t3-tab[data-style="tonal"][data-context="unit"] { height:28px; }
.t3-tab[data-style="tonal"][data-active="true"] { --tab-bg:var(--link-standard); }
.t3-tab[data-style="fill-h"] { height:28px; padding:0 8px; border-radius:8px; }
.t3-tabs__list[data-style="fill-h"][data-icons="false"]>.t3-tab { height:32px; }
.t3-tab[data-style="fill-h"][data-context="unit"] { height:28px; }
.t3-tab[data-style="fill-v"] { flex-direction:column; width:28px; padding:8px 6px; gap:2px; border-radius:8px; }
.t3-tab:is([data-style="fill-h"],[data-style="fill-v"])[data-active="true"] { --tab-bg:var(--link-theme-filled); --tab-text:#fff; }
.t3-tab__content { position:relative; z-index:1; display:flex; align-items:center; justify-content:center; gap:4px; min-width:0; max-width:100%; pointer-events:none; }
.t3-tab[data-style="bottom"]>.t3-tab__content { padding:4px; border-radius:8px; }
.t3-tab[data-style="fill-v"]>.t3-tab__content { flex-direction:column; gap:2px; max-width:none; }
.t3-tab__icon { display:flex; align-items:center; justify-content:center; flex:none; width:16px; height:16px; }
.t3-tab__icon svg { width:16px; height:16px; }
.t3-tab__label { min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.t3-tab[data-style="fill-v"] .t3-tab__label { width:16px; white-space:normal; word-break:break-all; text-align:center; overflow:visible; }
.t3-tab__trigger { position:absolute; z-index:0; inset:0; width:100%; height:100%; padding:0; margin:0; border:0; border-radius:inherit; background:transparent; cursor:pointer; }
.t3-tab__trigger:focus-visible,.t3-tab__more:focus-visible { outline:2px solid var(--border-theme); outline-offset:2px; }
.t3-tab__badge { display:flex; align-items:center; justify-content:center; flex:none; min-width:16px; height:16px; padding:0 4px; border-radius:1000px; background:var(--text-theme); color:var(--text-invert); font:500 10px/14px var(--font-primary); letter-spacing:.5px; }
.t3-tab:is([data-style="top"],[data-style="bottom"]) .t3-tab__badge { color:#fff; }
.t3-tab:is([data-style="top"],[data-style="bottom"])[data-active="false"] .t3-tab__badge { background:var(--text-quaternary); }
.t3-tab:is([data-style="fill-h"],[data-style="fill-v"]) .t3-tab__badge { background:var(--surface-theme); color:var(--text-theme); }
.t3-tab:is([data-style="fill-h"],[data-style="fill-v"])[data-active="true"] .t3-tab__badge { background:rgb(255 255 255 / 20%); color:var(--text-invert); }
.t3-tab__more { position:relative; z-index:2; display:flex; align-items:center; justify-content:center; flex:none; width:16px; height:16px; margin:0; padding:2px; border:0; border-radius:8px; background:transparent; color:var(--text-secondary); pointer-events:auto; cursor:pointer; }
.t3-tab__more svg { flex:none; width:18px; height:18px; }
.t3-tab__more:hover { background:var(--link-standard); }
.t3-tab__more:active { background:var(--link-standard-hover); }
.t3-tab:is([data-style="top"],[data-style="bottom"],[data-style="left"],[data-style="right"])[data-active="true"]::after { content:""; position:absolute; background:var(--tab-line); pointer-events:none; }
.t3-tab[data-style="top"]::after { left:0; right:0; top:0; height:2px; }
.t3-tab[data-style="bottom"]::after { left:0; right:0; bottom:0; height:2px; }
.t3-tab[data-style="left"]::after { left:0; top:0; bottom:0; width:2px; }
.t3-tab[data-style="right"]::after { right:0; top:0; bottom:0; width:2px; }
/* Only Default and Hover are specified by Figma; no extra Pressed or animation is added. */
.t3-tab:is([data-style="top"],[data-style="bottom"],[data-style="tonal"],[data-style="left"],[data-style="right"]):is([data-hover="true"],:not([data-preview="true"]):hover) { --tab-text:var(--text-theme-light); --tab-line:var(--link-theme-filled-hover); }
.t3-tab[data-style="bottom"]:is([data-hover="true"],:not([data-preview="true"]):hover)>.t3-tab__content { background:var(--link-standard); }
.t3-tab[data-style="tonal"]:is([data-hover="true"],:not([data-preview="true"]):hover) { --tab-bg:var(--link-standard); }
.t3-tab:is([data-style="fill-h"],[data-style="fill-v"])[data-active="true"]:is([data-hover="true"],:not([data-preview="true"]):hover) { --tab-bg:var(--link-theme-filled-hover); }
.t3-tab:is([data-style="fill-h"],[data-style="fill-v"])[data-active="false"]:is([data-hover="true"],:not([data-preview="true"]):hover) { --tab-bg:var(--link-standard); }
.t3-tabs__panel { min-width:200px; min-height:90px; padding:16px; border:1px solid var(--border-quaternary); border-radius:8px; color:var(--text-secondary); font:400 14px/20px var(--font-primary); }
.t3-tabs__panel[hidden] { display:none; }
.t3-tab__char { display:block; height:18px; line-height:18px; text-align:center; }

/* Top indicator follows its text tokens in the revised Figma. */
.t3-tab[data-style="top"][data-active="true"] { --tab-line:var(--text-theme); }
.t3-tab[data-style="top"][data-active="true"]:is([data-hover="true"],:not([data-preview="true"]):hover) { --tab-line:var(--text-theme-light); }

/* Revised unselected Hover applies to both the label and leading SVG through currentColor. */
.t3-tab[data-style][data-active="false"]:is([data-hover="true"],:not([data-preview="true"]):hover) { --tab-text:var(--text-tertiary); }
.t3-tab[data-style="right"][data-active="true"] { --tab-line:var(--text-theme); }
.t3-tab[data-style="right"][data-active="true"]:is([data-hover="true"],:not([data-preview="true"]):hover) { --tab-line:var(--text-theme-light); }

/* Bottom indicator now follows the same text tokens as its label. */
.t3-tab[data-style="bottom"][data-active="true"] { --tab-line:var(--text-theme); }
.t3-tab[data-style="bottom"][data-active="true"]:is([data-hover="true"],:not([data-preview="true"]):hover) { --tab-line:var(--text-theme-light); }
```

## 7. 參考 JavaScript

`TABS_ICONS` 為示範頁內嵌的 Figma 原始 table、more SVG；保留 viewBox，單色路徑以 currentColor 呈現。

```js
const TAB_STYLES=['top','bottom','tonal','fill-h','fill-v','left','right'];
let tabsSequence=0;
const tabAxis=style=>['fill-v','left','right'].includes(style)?'vertical':'horizontal';
const tabLabel=(item,style)=>item.label??(style==='fill-v'?'TAB':'Tab');
function makeTabUnit(options={}) {
  const o={style:'top',active:false,hover:false,showIcon:true,showBadge:false,showMore:false,badge:'1',context:'group',preview:false,...options};
  const label=o.label??(o.style==='fill-v'?'TAB':'Tab');
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
  const root=el('div','t3-tab'),content=el('div','t3-tab__content');
  Object.assign(root.dataset,{style:o.style,active:String(o.active),hover:String(o.hover),context:o.context,preview:String(o.preview)});
  const icon=el('span','t3-tab__icon');icon.innerHTML=TABS_ICONS.table;icon.setAttribute('aria-hidden','true');
  const text=el('span','t3-tab__label',label);text.setAttribute('aria-hidden','true');if(o.style==='fill-v'){text.replaceChildren();const chars=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('zh-Hant',{granularity:'grapheme'}).segment(label)].map(x=>x.segment):Array.from(label);for(const char of chars)text.append(el('span','t3-tab__char',char));}
  const badge=el('span','t3-tab__badge',String(o.badge));badge.setAttribute('aria-hidden','true');
  let trigger=null,more=null;
  if(!o.preview){root.setAttribute('role','presentation');trigger=el('button','t3-tab__trigger');trigger.type='button';trigger.setAttribute('aria-label',label+(o.showBadge?'，'+o.badge:''));root.append(trigger);}else{root.setAttribute('role','img');root.setAttribute('aria-label',o.style+'，Active '+(o.active?'On':'Off')+'，'+(o.hover?'Hover':'Default'));}
  if(o.showMore){more=el(o.preview?'span':'button','t3-tab__more');more.innerHTML=TABS_ICONS.more;if(!o.preview){more.type='button';more.setAttribute('aria-label',label+'：更多操作');more.addEventListener('click',e=>{e.stopPropagation();o.onMore?.();});}else more.setAttribute('aria-hidden','true');}
  if(o.showIcon)content.append(icon);
  const moreBefore=!o.active&&['top','left'].includes(o.style);
  if(moreBefore&&more)content.append(more);
  content.append(text);if(o.showBadge)content.append(badge);if(!moreBefore&&more)content.append(more);
  root.append(content);return {root,trigger,more};
}
function createT3Tabs(host,options={}) {
  const state={style:'top',showIcon:true,showBadge:false,showMore:false,badge:'1',showPanels:true,items:[{id:'tab-1'},{id:'tab-2'},{id:'tab-3'}],...options};
  state.items=state.items.map(x=>({...x}));
  function validate(s){if(!TAB_STYLES.includes(s.style))throw new RangeError('Unknown Tabs style');const ids=s.items.map(x=>x.id);if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)throw new TypeError('Tabs require unique nonempty string ids');}
  validate(state);state.value=options.value??state.items[0]?.id??null;if(state.value!==null&&!state.items.some(x=>x.id===state.value))throw new RangeError('Unknown Tab id');
  const prefix='t3-tabs-'+(++tabsSequence);let buttons=[];
  const emit=(action,item)=>host.dispatchEvent(new CustomEvent('t3-tabs-'+action,{bubbles:true,detail:{value:item.id,label:tabLabel(item,state.style),style:state.style}}));
  function select(id,focus=false){const index=state.items.findIndex(x=>x.id===id);if(index<0)return false;const changed=state.value!==id;state.value=id;render();if(focus){buttons[index].focus();buttons[index].scrollIntoView?.({block:'nearest',inline:'nearest'});}if(changed)emit('change',state.items[index]);return true;}
  function render(){const root=document.createElement('div'),list=document.createElement('div');root.className='t3-tabs';root.dataset.axis=tabAxis(state.style);list.className='t3-tabs__list';Object.assign(list.dataset,{style:state.style,axis:tabAxis(state.style),icons:String(state.showIcon)});list.setAttribute('role','tablist');list.setAttribute('aria-label','頁籤');list.setAttribute('aria-orientation',tabAxis(state.style));root.append(list);host.replaceChildren(root);buttons=[];
    state.items.forEach((item,i)=>{const active=item.id===state.value,label=tabLabel(item,state.style),unit=makeTabUnit({...state,active,label,badge:item.badge??state.badge,onMore:()=>emit('more',item)}),button=unit.trigger;
      button.id=prefix+'-tab-'+i;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;button.addEventListener('click',()=>select(item.id,true));
      button.addEventListener('keydown',e=>{if(e.isComposing)return;const forward=tabAxis(state.style)==='horizontal'?'ArrowRight':'ArrowDown',back=tabAxis(state.style)==='horizontal'?'ArrowLeft':'ArrowUp';let next;if(e.key===forward)next=(i+1)%state.items.length;else if(e.key===back)next=(i+state.items.length-1)%state.items.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=state.items.length-1;else return;e.preventDefault();select(state.items[next].id,true);});
      buttons.push(button);list.append(unit.root);
      if(state.showPanels){const panel=document.createElement('div');panel.className='t3-tabs__panel';panel.id=prefix+'-panel-'+i;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);panel.tabIndex=0;panel.hidden=!active;panel.textContent=item.content??('目前頁籤：'+label+'（'+(i+1)+'）');button.setAttribute('aria-controls',panel.id);root.append(panel);}
    });
    if(!state.items.length){const empty=document.createElement('p');empty.className='t3-tabs__panel';empty.textContent='沒有頁籤';root.append(empty);}
  }
  render();return {select:id=>select(id),update(patch){const next={...state,...patch,items:(patch.items??state.items).map(x=>({...x}))};validate(next);if(!next.items.some(x=>x.id===next.value))next.value=next.items[0]?.id??null;Object.assign(state,next);render();},getState(){return {...state,items:state.items.map(x=>({...x}))};},destroy(){host.replaceChildren();}};
}
```

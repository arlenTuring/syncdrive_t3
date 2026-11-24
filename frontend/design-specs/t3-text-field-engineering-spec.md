# T3 UI Kit｜TextField 與表單欄位工程規範

設計來源：[UI Kit 欄位區塊 240:23277](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=240-23277)。Typography 與 Color System 沿用[定稿變數](https://chatgpt.com/library?file_id=libfile_202bb92aeecc8191bf26b85338556396&account_id=personal)。本文以指定展示區的變體與配色為準。

## 1. 元件範圍

| 元件 | Figma 來源 | 變體與展示樣本 |
| --- | --- | --- |
| TextField | [171:4691](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=171-4691) | 3 Styles × 6 States＝18 變體；有／無 Label 展示共 36 個。 |
| TextArea | [1365:6118](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=1365-6118) | 3 Styles × 3 States＝9 變體；有／無 Label 展示共 18 個。 |
| SelectField | [183:1681](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=183-1681) | 9 種 Configuration，為 Label＋內容插槽的組合容器。 |

Styles 為 Tonal-Theme、Tonal-Gray、Outlined。未提供動態規格，因此不新增動畫。Checkbox、Radio、Switch 與 Chip 在正式專案沿用既有 UI Kit 元件；示範頁以獨立可操作的原生控制呈現組合方式。

## 2. TextField 尺寸與組成

| 部位 | 規格 |
| --- | --- |
| 寬度 | Figma 樣本 240px；實際依父容器伸縮，內文區需 `min-width: 0`。 |
| Label | 18px 高，左右 padding 8px，下方 gap 4px。`.text-body-s-bold`：Noto Sans TC、500、14px／18px、字距 0.5px。文字 `--text-tertiary`，星號 `--status-error-emphasis`。隱藏 Label 時一併隱藏星號，仍需提供可存取名稱。 |
| 輸入框 | 高 34px、圓角 8px，padding 上下 6px／左右 12px。描邊為 0.5px 內描邊，不改變尺寸。Label＋欄位共 56px；無 Label 為 34px。 |
| 輸入文字 | `.text-body-s`：400、14px／18px、字距 0.5px。內層上下各 2px，佔 22px。Default 提示文字 `--text-tertiary`；Focus、Active、Error、Error-Focus 文字 `--text-primary`；Disabled 用 `--text-disabled`。 |
| Leading Icon | Search 為 20 × 20px，外層 24 × 20px，右留 4px。圖示 `--text-tertiary`，停用為 `--text-disabled`。 |
| View／Clear | 各 20 × 20px。View 用於密碼顯示切換；Clear 清除輸入值。Error 的尾端位置顯示 Error 圖示，Error-Focus 回到 Clear。 |
| Trailing unit | 例如 `%`，`.text-body-s`、`--text-tertiary`，停用為 `--text-disabled`。與可輸入值分開，不寫入 value。 |
| Supporting Text | 獨立於欄位主體，下方保留至少 24px（padding 上下 4px／左右 12px＋16px 文字行高）。`.text-body-xs`：400、12px／16px、字距 0px。一般 `--text-tertiary`，錯誤 `--status-error`。長文字換行後自然增高。 |

Figma 公開屬性含 Label、RequiredMark、Supporting Text、Leading Icon（布林名稱拼為 `LeagingIcon`）、View、Clear、Trailing unit text，以及對應文字屬性。`Hover-Info` 在指定展示樣本中皆關閉，本次維持關閉。工程 API 使用 `leading`、`password`、`clear`、`unit` 等語意名稱。

## 3. TextField Style × State

各格為「背景／描邊」；透明描邊仍保留相同欄位尺寸。

| Style | Default／Active | Focus | Error／Error-Focus | Disabled |
| --- | --- | --- | --- | --- |
| Tonal-Theme | `--surface-theme`／透明 | `--surface-theme`／`--border-theme` | `--surface-theme`／`--status-error` | `--surface-disabled`／透明 |
| Tonal-Gray | `--surface-secondary`／透明 | `--surface-secondary`／`--link-standard` | `--surface-secondary`／`--status-error` | 透明／透明 |
| Outlined | 透明／`--border-primary` | `--link-standard`／`--border-theme` | 透明／`--status-error` | 透明／`--border-primary` |

`--link-standard` 使用定稿 12% 灰色。Focus 的提示文字也使用 `--text-primary`（#F3F4F6）；欄位單位、Label 與 Supporting Text 不隨 Focus 變白。

| State | 工程判斷與行為 |
| --- | --- |
| Default | 未取得焦點且沒有值，顯示 placeholder。 |
| Focus | 輸入框取得焦點，不論是否已有值。選項選完後，只要輸入框仍有焦點便維持 Focus。 |
| Active | 已有值且焦點離開欄位。 |
| Error | 驗證錯誤且焦點離開，紅色描邊、Supporting Text 與錯誤圖示。 |
| Error-Focus | 驗證錯誤且欄位取得焦點，保留紅色描邊及 Supporting Text，尾端顯示 Clear。 |
| Disabled | 優先於其他狀態。原生 `disabled`，禁止輸入、清除、選項與密碼切換；不參與 Tab 順序。 |

Error-Focus 的 I 型文字游標使用 `--status-error-emphasis`（#FF6467）；一般 Focus 游標使用 `--border-theme`。

錯誤由外部驗證結果決定；元件不自行制定字數或必填檢核時機。示範頁使用 Error 開關模擬驗證結果。`required` 傳給原生輸入框，星號只作視覺提示。

### Clear 與 Focus 行為

測試頁的 Clear 固定啟用，不提供開關；TextField 與 TextArea 有輸入內容時才顯示清除按鈕，沒有輸入內容時隱藏。點擊會清空實際輸入值並保留焦點，清空後按鈕自動隱藏。Error（未取得焦點）仍以 Error 圖示取代清除按鈕；Error-Focus 在有值時顯示 Clear。Disabled 不顯示清除按鈕，禁止清除操作。

測試設定切換密碼模式、Style 等選項時保留目前輸入內容，避免重建欄位將值清空。按下「重設」或切換元件種類才清空值。

Focus 僅代表輸入框取得焦點；互動測試與固定對照格皆不顯示 Menu。輸入與中文組字也不展開選單。TextField 使用原生 input，無 combobox／listbox 語意。

密碼模式以 View 按鈕切換原生 `password`／`text`，不改變值。密碼隱藏時使用 `visibility_off`；顯示時換成 `visibility`，再次點擊還原，圖示與按鈕名稱同步切換。

測試設定將 Supporting Text 統一標為「輔助文字」，移除「輸入建議」與「Hierarchy」控制。

## 4. TextArea

| 項目 | 規格 |
| --- | --- |
| 尺寸 | 寬 240px，輸入框最小高 68px；空值時有 Label 共 90px，無 Label 為 68px。輸入後依內容自動增高，顯示全部文字，不設定最大高度或捲軸。 |
| 內距 | 外框 padding 6px 12px、內層上下各 2px。實作合併為 textarea 外側上下各 8px，內容高 52px。 |
| 狀態 | Default、Focus、Active。Default 提示文字 `--text-tertiary`；Focus 與 Active 用 `--text-primary`。 |
| Style | 與 TextField 的一般／Focus 描邊規則相同；Outlined Focus 維持透明背景。 |
| Supporting Text | 顯示目前字數／上限，預設 `0/100`，字數上限 100。輸入、貼上、清除與程式回填皆更新；清空回到 `0/100`。使用 `.text-body-xs`、`--text-tertiary`，上下 padding 4px／左右 12px，共 24px。 |
| 輸入 | 原生 textarea，Enter 換行；高度依實際內容與欄寬自動調整。使用 `resize: none`、`overflow: hidden`，不顯示水平或垂直 Scroll bar；刪除或清空時縮回所需高度，最低 68px。有內容時顯示 Clear，無內容或清空後隱藏；所有 Style、有／無標題皆適用。Clear 固定在右上角（top 8px、right 12px），文字區右側預留 24px，避免長文字覆蓋按鈕。無 Leading／View／單位或建議選單。 |

字數以可見字元（Unicode grapheme）計算，換行亦計 1 字；輸入與貼上超過 100 字時保留前 100 字。中文組字完成後套用上限，避免截斷組字過程。`maxLength` 可由使用位置設定，本次固定為 100。欄寬改變或原本收合的對照區展開時，重新計算高度。

此節點未提供 TextArea 的 Error／Disabled 視覺變體；固定對照不新增這些狀態。若業務需要停用，示範頁保留原生 disabled 行為及停用文字色作工程補充，並非新增 Figma 變體。

## 5. SelectField

SelectField 為寬 240px 的 Label＋4px gap＋Slot。Label 沿用前述規範，空間不足時允許內容換行與自然增高；不能將 Slot 的所有組合都限制為單一固定高度。下表高度為原稿樣本的內容區高度。

| Configuration | Slot 高度 | Padding（上下／左右） | Gap | 內容 |
| --- | --- | --- | --- | --- |
| Text | 34px | 8px／8px | 6px | 文字展示；可附單位，單位 `.text-body-xs`、`--text-secondary`。 |
| Color | 34px | 8px／8px | 6px | 18 × 18px 色彩選項；需提供色名、可存取選取狀態。 |
| Input-Chip | 34px | 4px／0px | 8px | 26px 高 Chip；移除只影響該值。 |
| Toggle | 34px | 4px／8px | 0px | 44 × 26px Switch，整個元件可點擊。 |
| Checkbox List | 34px | 5px／8px | 8px | 橫向 Checkbox，多選。 |
| Radio | 34px | 1px／8px | 8px | 橫向 Radio，同群互斥。 |
| Checkbox Column | 66px | 5px／8px | 8px | 垂直 Checkbox，多選。 |
| Radio Column | 74px | 1px／8px | 8px | 垂直 Radio，同群互斥。 |
| Empty | 34px | 5px／8px | 12px | 空插槽，供放入自訂內容。 |

SelectField 的 Input-Chip、色彩、Checkbox、Radio 等互動資料由父層維護。群組用 fieldset／legend 提供名稱。示範頁的 Color 名稱使用編號；實際專案應改用產品定義色名。Checkbox 群組需依業務決定是否必填，不可僅靠星號推導「每一個都必須勾選」。

## 6. 工程介面與驗收

參考實作 `createT3Field(host, options)` 支援 `kind`（text／textarea）、`style`、`label`、`labelVisible`、`required`、`help`、`placeholder`、`value`、`disabled`、`error`、`errorText`、`leading`、`clear`、`password`、`unit`、`maxLength`（TextArea 預設 100）。`previewState` 與 `viewIcon` 僅供固定樣本展示。回傳 `root`、`input`、`getValue()`、`setValue(value)`、`setError(error, text)`、`setDisabled(disabled)`、`destroy()`。值改變發出冒泡的 `t3-change`，內容為 `{ value, state }`。

驗收重點：三種 Style 的空值 Focus 顏色、失焦後 Active、Error 與 Error-Focus 的圖示差異、Disabled 阻止所有操作、View 切換不改值、Clear 保留焦點、Focus 與輸入不顯示 Menu、切換設定保留原值、Label 隱藏時仍有名稱、長說明換行、TextArea Enter 換行、100 字上限及即時字數計數、內容自動增高且無 Scroll bar、Radio 群組互斥。示範頁固定樣本不作為表單輸入。

## 7. 參考 CSS

此段與示範頁共用同一份元件 CSS。需先載入定稿 Typography／Color System，外層套用 `box-sizing: border-box`。

```css
.t3-field { width:240px; max-width:100%; color:var(--text-primary); position:relative; font-family:var(--font-primary); }
.t3-field [hidden] { display:none!important; }
.t3-field__label { display:block; padding:0 8px; margin:0 0 4px; font:500 14px/18px var(--font-primary); letter-spacing:.5px; color:var(--text-tertiary); }
.t3-field__label b { color:var(--status-error-emphasis); font-weight:500; }
.t3-field__box { --field-bg:var(--surface-theme); --field-border:transparent; display:flex; align-items:center; position:relative; width:100%; min-height:34px; padding:6px 12px; border-radius:8px; background:var(--field-bg); box-shadow:inset 0 0 0 .5px var(--field-border); }
.t3-field[data-style="tonal-gray"] .t3-field__box { --field-bg:var(--surface-secondary); }
.t3-field[data-style="outlined"] .t3-field__box { --field-bg:transparent; --field-border:var(--border-primary); }
.t3-field[data-state="focus"] .t3-field__box { --field-border:var(--border-theme); }
.t3-field[data-style="tonal-gray"][data-state="focus"] .t3-field__box { --field-border:var(--link-standard); }
.t3-field[data-kind="text"][data-style="outlined"][data-state="focus"] .t3-field__box { --field-bg:var(--link-standard); }
.t3-field[data-state="error"] .t3-field__box,.t3-field[data-state="error-focus"] .t3-field__box { --field-border:var(--status-error); }
.t3-field[data-kind="text"][data-style="tonal-theme"][data-state="disabled"] .t3-field__box { --field-bg:var(--surface-disabled); }
.t3-field[data-kind="text"][data-style="tonal-gray"][data-state="disabled"] .t3-field__box { --field-bg:transparent; }
.t3-field__input { display:block; min-width:0; width:100%; flex:1; height:22px; padding:2px 0; margin:0; border:0; border-radius:0; outline:0; background:transparent; color:var(--text-primary); caret-color:var(--border-theme); font:400 14px/18px var(--font-primary); letter-spacing:.5px; }
.t3-field__input::placeholder { color:var(--text-tertiary); opacity:1; }
.t3-field[data-state="error-focus"] .t3-field__input { caret-color:var(--status-error-emphasis); }
.t3-field[data-state="focus"] .t3-field__input::placeholder,.t3-field[data-state="error"] .t3-field__input::placeholder,.t3-field[data-state="error-focus"] .t3-field__input::placeholder { color:var(--text-primary); }
.t3-field[data-state="disabled"] .t3-field__input,.t3-field[data-state="disabled"] .t3-field__input::placeholder { color:var(--text-disabled); -webkit-text-fill-color:var(--text-disabled); cursor:not-allowed; opacity:1; }
.t3-field__leading { display:flex; flex:0 0 24px; padding-right:4px; color:var(--text-tertiary); }
.t3-field svg { display:block; width:20px; height:20px; flex-shrink:0; }
.t3-field__action { display:flex; align-items:center; justify-content:center; flex:0 0 20px; width:20px; height:20px; padding:0; border:0; background:transparent; color:var(--text-tertiary); cursor:pointer; }
.t3-field__action:hover { color:var(--text-primary); }
.t3-field__action:disabled { color:var(--text-disabled); cursor:not-allowed; }
.t3-field__error { color:var(--status-error); }
.t3-field__unit { color:var(--text-tertiary); font:400 14px/18px var(--font-primary); letter-spacing:.5px; padding-left:4px; }
.t3-field[data-state="disabled"] .t3-field__leading,.t3-field[data-state="disabled"] .t3-field__unit { color:var(--text-disabled); }
.t3-field__help { position:relative; margin:0; padding:4px 12px; color:var(--text-tertiary); font:400 12px/16px var(--font-primary); overflow-wrap:anywhere; }
.t3-field[data-state^="error"] .t3-field__help { color:var(--status-error); }
.t3-field[data-kind="textarea"] .t3-field__box { padding:8px 12px; align-items:stretch; }
.t3-field[data-kind="textarea"] .t3-field__input { height:52px; min-height:52px; padding:0 24px 0 0; resize:none; overflow:hidden; overflow-wrap:anywhere; }
.t3-field__action:focus-visible,.t3-select input:focus-visible,.t3-select button:focus-visible { outline:2px solid var(--border-theme); outline-offset:2px; }
.t3-select input[type="checkbox"],.t3-select input[type="radio"] { appearance:none; display:grid; place-items:center; flex:0 0 auto; width:18px; height:18px; margin:3px; border:1px solid var(--border-secondary); border-radius:4px; background:transparent; cursor:pointer; }
.t3-select input[type="checkbox"]:checked { border-color:var(--link-theme-filled); background:var(--link-theme-filled); }
.t3-select input[type="checkbox"]:checked::after { content:""; width:8px; height:4px; border-left:2px solid var(--text-primary); border-bottom:2px solid var(--text-primary); transform:rotate(-45deg) translateY(-1px); }
.t3-select { width:240px; max-width:100%; margin:0; padding:0; border:0; min-width:0; color:var(--text-primary); font:400 14px/18px var(--font-primary); letter-spacing:.5px; }
.t3-select legend { width:100%; padding:0 8px; margin-bottom:4px; color:var(--text-tertiary); font-weight:500; }
.t3-select legend b { color:var(--status-error-emphasis); font-weight:500; }
.t3-select__slot { display:flex; align-items:center; flex-wrap:wrap; gap:8px; min-height:34px; border-radius:8px; }
.t3-select[data-config="text"] .t3-select__slot,.t3-select[data-config="color"] .t3-select__slot { padding:8px; gap:6px; }
.t3-select[data-config="input-chip"] .t3-select__slot { padding:4px 0; }
.t3-select[data-config="toggle"] .t3-select__slot { padding:4px 8px; gap:0; }
.t3-select[data-config="checkbox-list"] .t3-select__slot { padding:5px 8px; }
.t3-select[data-config="radio"] .t3-select__slot { padding:1px 8px; }
.t3-select[data-config="checkbox-column"] .t3-select__slot { flex-direction:column; align-items:flex-start; padding:5px 8px; min-height:66px; }
.t3-select[data-config="radio-column"] .t3-select__slot { flex-direction:column; align-items:flex-start; padding:1px 8px; min-height:74px; }
.t3-select[data-config="empty"] .t3-select__slot { padding:5px 8px; gap:12px; }
.t3-select__option { display:inline-flex; align-items:center; min-height:24px; gap:4px; cursor:pointer; }
.t3-select[data-config^="radio"] .t3-select__option { min-height:32px; }
.t3-select input[type="radio"] { border-radius:50%; }
.t3-select input[type="radio"]:checked { border-color:var(--link-theme-filled); }
.t3-select input[type="radio"]:checked::after { content:""; width:10px; height:10px; border-radius:50%; background:var(--link-theme-filled); }
.t3-select__color { width:18px; height:18px; padding:0; border:2px solid transparent; border-radius:2px; cursor:pointer; background:var(--swatch); }
.t3-select__color[aria-pressed="true"] { border-color:var(--text-primary); outline:1px solid var(--swatch); }
.t3-select__chip { display:flex; align-items:center; gap:8px; border:1px solid var(--border-secondary); border-radius:8px; height:26px; padding:0 8px 0 16px; background:transparent; color:var(--text-primary); font:500 14px/18px var(--font-primary); }
.t3-select__chip button { padding:0; border:0; background:transparent; color:var(--text-tertiary); width:18px; height:18px; cursor:pointer; }
.t3-select__chip svg { width:18px; height:18px; }
.t3-select__toggle { width:44px; height:26px; padding:3px; border:0; border-radius:20px; background:var(--text-quaternary); cursor:pointer; }
.t3-select__toggle::after { content:""; display:block; width:20px; height:20px; border-radius:50%; background:var(--text-primary); }
.t3-select__toggle[aria-checked="true"] { background:var(--link-theme-filled); }
.t3-select__toggle[aria-checked="true"]::after { margin-left:18px; }

.t3-field[data-kind="textarea"] .t3-field__action { position:absolute; top:8px; right:12px; }
```

## 8. 參考 JavaScript

`T3_ICONS` 為示範頁內嵌的 Figma 原始 SVG；工程可換成相同 Search、View、Clear、Error 圖示元件。

```js
let t3FieldSequence=0;
function createT3Field(host,options={}) {
  const settings={kind:'text',style:'tonal-theme',label:'標題',labelVisible:true,required:true,help:'輔助文字',placeholder:'請輸入',value:'',disabled:false,error:false,errorText:'請確認輸入內容',leading:true,clear:true,password:false,viewIcon:false,unit:'',maxLength:100,previewState:null,...options};
  const id='t3-field-'+(++t3FieldSequence), root=document.createElement('div');
  root.className='t3-field';root.dataset.kind=settings.kind;root.dataset.style=settings.style;
  const label=document.createElement('label');label.className='t3-field__label';label.htmlFor=id;
  const mark=document.createElement('b');mark.textContent='*';mark.setAttribute('aria-hidden','true');mark.hidden=!settings.required;
  label.append(mark,document.createTextNode(settings.label));label.hidden=!settings.labelVisible;
  const box=document.createElement('div');box.className='t3-field__box';
  const input=document.createElement(settings.kind==='textarea'?'textarea':'input');input.id=id;input.className='t3-field__input';
  if(settings.kind!=='textarea')input.type=settings.password?'password':'text';
  input.value=settings.value;input.placeholder=settings.placeholder;input.disabled=settings.disabled;input.required=settings.required;
  input.setAttribute('aria-label',settings.label);input.autocomplete='off';
  const leading=document.createElement('span');leading.className='t3-field__leading';leading.innerHTML=T3_ICONS.search;leading.setAttribute('aria-hidden','true');leading.hidden=!settings.leading||settings.kind==='textarea';
  const view=document.createElement('button');view.type='button';view.className='t3-field__action';view.innerHTML=T3_ICONS.view;view.setAttribute('aria-label','顯示密碼');view.setAttribute('aria-pressed','false');
  const clear=document.createElement('button');clear.type='button';clear.className='t3-field__action';clear.innerHTML=T3_ICONS.clear;clear.setAttribute('aria-label','清除內容');
  const errorIcon=document.createElement('span');errorIcon.className='t3-field__error';errorIcon.innerHTML=T3_ICONS.error;errorIcon.setAttribute('aria-hidden','true');
  const unit=document.createElement('span');unit.className='t3-field__unit';unit.textContent=settings.unit;
  const help=document.createElement('p');help.className='t3-field__help';help.id=id+'-help';
  box.append(leading,input,unit,view,clear,errorIcon);root.append(label,box,help);host.append(root);
  let focused=false,composing=false;
  const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh-Hant',{granularity:'grapheme'}):null;
  const characters=value=>segmenter?Array.from(segmenter.segment(value),part=>part.segment):Array.from(value);
  function resizeTextarea(){
    if(settings.kind!=='textarea'||input.clientWidth===0)return;
    input.style.height='auto';
    input.style.height=Math.max(52,input.scrollHeight||52)+'px';
  }
  function notify(){root.dispatchEvent(new CustomEvent('t3-change',{bubbles:true,detail:{value:input.value,state:root.dataset.state}}));}
  function refresh(){
    const state=settings.previewState||(settings.disabled?'disabled':settings.error?(focused?'error-focus':'error'):focused?'focus':input.value?'active':'default');
    root.dataset.state=state;input.disabled=settings.disabled;input.setAttribute('aria-invalid',String(settings.error&&!settings.disabled));
    if(settings.kind==='textarea'){
      if(!composing)input.value=characters(input.value).slice(0,settings.maxLength).join('');
      help.textContent=characters(input.value).length+'/'+settings.maxLength;
      help.hidden=!settings.help;
      resizeTextarea();
    }else{
      help.textContent=settings.error&&!settings.disabled?settings.errorText:settings.help;help.hidden=!help.textContent;
    }
    if(!help.hidden)input.setAttribute('aria-describedby',help.id);else input.removeAttribute('aria-describedby');
    const textOnly=settings.kind==='text';view.hidden=!textOnly||!(settings.password||settings.viewIcon);view.disabled=settings.disabled;
    errorIcon.hidden=!textOnly||state!=='error';
    clear.hidden=!settings.clear||!input.value||state==='error'||state==='disabled';
    unit.hidden=!settings.unit||settings.kind!=='text';
  }
  input.addEventListener('focus',()=>{focused=true;refresh();});
  root.addEventListener('focusout',()=>queueMicrotask(()=>{if(!root.contains(document.activeElement)){focused=false;refresh();}}));
  input.addEventListener('input',()=>{refresh();if(!composing)notify();});
  input.addEventListener('compositionstart',()=>{composing=true;});
  input.addEventListener('compositionend',()=>{composing=false;refresh();notify();});
  clear.addEventListener('pointerdown',e=>e.preventDefault());
  clear.addEventListener('click',()=>{if(settings.disabled||settings.previewState)return;input.value='';input.focus();refresh();notify();});
  view.addEventListener('pointerdown',e=>e.preventDefault());
  view.addEventListener('click',()=>{if(settings.disabled||settings.previewState)return;const visible=input.type==='password';input.type=visible?'text':'password';view.setAttribute('aria-pressed',String(visible));view.setAttribute('aria-label',visible?'隱藏密碼':'顯示密碼');view.innerHTML=visible?T3_ICONS.visibility:T3_ICONS.view;input.focus();});
  box.addEventListener('click',e=>{if(e.target===box)input.focus();});
  if(settings.previewState){input.readOnly=true;input.tabIndex=-1;for(const b of [clear,view])b.tabIndex=-1;}
  refresh();
  let observedWidth=-1;
  const resizeObserver=settings.kind==='textarea'&&typeof ResizeObserver!=='undefined'?new ResizeObserver(entries=>{
    const width=entries[0].contentRect.width;
    if(width!==observedWidth){observedWidth=width;resizeTextarea();}
  }):null;
  resizeObserver?.observe(input);
  return {root,input,getValue:()=>input.value,setValue(value){input.value=String(value);refresh();notify();},setError(error,text=settings.errorText){settings.error=error;settings.errorText=text;refresh();},setDisabled(disabled){settings.disabled=disabled;if(disabled){focused=false;}refresh();},destroy(){resizeObserver?.disconnect();root.remove();}};
}
```

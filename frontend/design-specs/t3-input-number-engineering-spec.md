# T3 UI Kit｜InputNumber 工程規範

設計來源：[InputNumber 區塊 1384:8333](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=1384-8333)。字體與配色沿用[定稿 Typography／Color System](https://chatgpt.com/library?file_id=libfile_202bb92aeecc8191bf26b85338556396&account_id=personal)。本文採用指定展示區的色彩模式，元件不另設主題切換。

互動基底採用 [Ant Design Vue InputNumber 的 Formatter 範例](https://antdv.com/components/input-number#components-input-number-demo-formatter)。正式工程使用 `formatter`／`parser` 處理顯示與數值解析；本示範頁使用獨立程式呈現對照行為，外觀以 Figma 為準。

## 1. 元件範圍

| 元件 | Figma 來源 | 變體 |
| --- | --- | --- |
| InputNumber／Formatter | [1385:8560](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=1385-8560) | 3 Styles × 3 States，共 9 個。 |
| Handler-wrap | [1385:29216](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=1385-29216) | 3 Styles × 6 States，共 18 個。 |

Style 為 Tonal-Theme、Tonal-Gray、Outlined。InputNumber 的 State 為 Default、Hover、Disabled；Handler 為 Default、Up hover、Up pressed、Down hover、Down pressed、Disabled。工程資料值與視覺 State 分開處理，不額外建立 Active、Error 等 Figma 未提供的變體。未提供動態規格，因此不新增動畫。

## 2. 尺寸、字體與組成

| 部位 | 規格 |
| --- | --- |
| 欄位寬度 | 樣本 240px；實際依使用位置調整，最大不超過父容器。 |
| 有標題 | Label 高 18px＋gap 4px＋輸入框高 34px，共 56px。 |
| 無標題 | 輸入框高 34px。標題與必填星號一併隱藏，仍保留輸入框的可存取名稱。 |
| Label | 左右 padding 8px，`.text-body-s-bold`：Noto Sans TC、500、14px／18px、字距 0.5px。一般 `--text-tertiary`，Disabled 為 `--text-disabled`。必填星號維持 `--status-error-emphasis`。 |
| 輸入框 | 圓角 8px，padding 上下 6px／左 12px／右 30px。右側預留 Handler 空間，隱藏 Handler 時也不改變文字區寬度。 |
| 文字區 | 內層高 22px（文字高 18px＋上下各 2px），數值與單位 gap 2px。文字區可縮，超長數字在單行輸入框中水平移動查看，不換行。 |
| 輸入文字 | `.text-body-s`：400、14px／18px、字距 0.5px。預設顯示 `0`，數值及空值提示 `0` 皆為 `--text-primary`；Disabled 用 `--text-disabled`。 |
| Unit | 樣本為 `%`，緊接數值後方，`.text-body-s`、`--text-secondary`。Disabled 為 `--text-disabled`。可隱藏，單位不寫入數值。 |
| Handler-wrap | 22 × 34px，放在輸入框右側。嵌入欄位時裁切右上／右下角以配合 8px 圓角；獨立展示的 Handler 為直角。 |
| 上下箭頭 | 各 16 × 16px，使用原稿向量圖示；Default／Hover 為 `--text-tertiary`，Pressed 的作用方向為 `--text-theme`，Disabled 為 `--text-disabled`。 |

本元件不加入 Clear、Menu 或輔助文字。測試設定的 Label、RequiredMark 分別標為「標題」「必填」，與前一份文件保持一致。

## 3. Style × State

### Formatter

| Style | Default／Hover 背景與描邊 | Disabled 背景與描邊 |
| --- | --- | --- |
| Tonal-Theme | `--surface-theme`／無描邊 | `--surface-disabled`／無描邊 |
| Tonal-Gray | `--surface-secondary`／無描邊 | `--surface-disabled`／無描邊 |
| Outlined | 透明／0.5px 內描邊 `--border-primary` | `--surface-disabled`／0.5px 內描邊 `--border-disabled` |

Default 隱藏 Handler；Hover 顯示 Handler。Disabled 樣本仍顯示停用 Handler。為支援鍵盤，工程在欄位內有焦點時也顯示 Handler，Tab 可依序進入輸入框與可操作的增減按鈕；觸控裝置直接顯示 Handler。點擊欄位或上下按鈕時，不新增最外層 border、outline 或 focus shadow，維持該 Style 原有外觀；Outlined 原本的 0.5px 描邊保留。滑鼠操作引發的程式回焦也不顯示額外外框。只有鍵盤操作才提供 2px `--border-theme` 焦點提示，不當作新增 Figma State。

### Handler-wrap

Outlined 的上下按鈕中間必須貼齊，gap 為 0；一般與停用狀態各高 17px，Hover／Pressed 為 22px＋12px，總高維持 34px。

| 狀態 | Tonal 高度（上／下） | Outlined 高度（上／下，gap＝0） | 圖示 |
| --- | --- | --- | --- |
| Default／Disabled | 17px／17px | 17px／17px | 兩者皆使用對應一般／停用文字色。 |
| Up hover | 22px／12px | 22px／12px | 兩者 `--text-tertiary`。 |
| Up pressed | 22px／12px | 22px／12px | 上方 `--text-theme`，下方 `--text-tertiary`。 |
| Down hover | 12px／22px | 12px／22px | 兩者 `--text-tertiary`。 |
| Down pressed | 12px／22px | 12px／22px | 下方 `--text-theme`，上方 `--text-tertiary`。 |

| Style | 一般／Hover／Pressed 底色與邊線 | Disabled |
| --- | --- | --- |
| Tonal-Theme | Figma 未綁定變數的藍色，RGB 約 185.31654／215.18087／255、12% 透明度；無描邊。 | 透明，不另疊加背景。 |
| Tonal-Gray | Figma 未綁定變數的灰色，RGB 約 203.87358／203.87358／203.87358、12% 透明度；無描邊。 | 透明。 |
| Outlined | 透明，單個按鈕 0.5px 內描邊 `--text-quaternary`。 | 透明，0.5px `--border-disabled`。 |

這兩個未綁定的 Handler 底色以元件內變數 `--number-handler-theme`／`--number-handler-gray` 保存原稿數值，未改動全站色票，亦未以相近的其他語意色替代。Pressed 的底色與 Hover 相同，只改變作用方向的箭頭顏色。

## 4. 數值與互動

以下為示範頁的工程行為；上下限與步進由產品使用位置設定，並非從靜態 Figma 樣本推導出的業務限制。

| 項目 | 行為 |
| --- | --- |
| 預設設定 | 預設實際值為 0，min＝0、max＝100、step＝1，顯示 `%`。所有 Style 與對照樣本統一顯示 `0`。清空後以 `0` 作為提示，空值回傳 null，與實際數值 0 分開。 |
| 直接輸入 | 編輯期間保留輸入草稿，允許暫時存在 `-`、小數點等未完成內容。按 Enter 或輸入框失焦時套用；不合法輸入還原為上次已套用值。Escape 取消草稿。 |
| 上下限 | 套用超出範圍的有效數字時，收斂至 min／max。到達上限停用增加按鈕，到達下限停用減少按鈕。Disabled 阻止輸入與所有增減操作。 |
| 步進 | 點擊一次增加或減少 step；↑／↓ 執行相同操作，保留輸入焦點。未指定長按連續增減。 |
| 空值增減 | 以 0 為起點加減一次 step，結果再收斂至上下限。 |
| 小數 | 精度取 min、max、step 的最大小數位；最多六位。用整數倍數計算步進，避免 0.1＋0.2 的顯示誤差。套用時依此精度四捨五入。 |
| 格式化 | 一般數字或千分位。失焦時可顯示 `1,234.5`，取得焦點時改為未分組數字，便於編輯。可貼上正確的千分位格式，不接受科學記號或非數字文字。 |
| 單位 | `%` 是顯示後綴；輸入 25 代表數值 25，不自動換算成 0.25。 |
| 欄位設定 | 切換 Style、標題、必填、單位等設定保留已套用值；改變上下限或步進會重新收斂／取整。重設回到 0；清空內容回到 null，顯示 `0` 提示。 |

目前示範頁可選 step 1／0.1／0.01、min 0／-100／-10000、max 100／1000／10000。示範填入按鈕使用 25。正式工程需驗證 min ≤ max、step > 0；縮放後整數需在 JavaScript 安全整數範圍內。不用未提供的錯誤視覺樣式承載業務驗證。

中文組字期間不攔截 ↑／↓／Enter，待組字結束後照一般草稿處理。格式顯示使用 en-US 分組及小數符號，不將顯示字串當作資料儲存。

## 5. 工程介面與驗收

`createT3Number(host, options)` 支援 `style`、`label`、`labelVisible`、`required`、`unit`、`disabled`、`grouped`、`placeholder`、`value`、`min`、`max`、`step`。`previewState` 僅供固定對照格使用。回傳 `root`、`input`、`handler`、`getValue()`、`setValue(value)`、`setDisabled(disabled)`、`destroy()`。變更時發出冒泡的 `t3-number-change`，內容為 `{ value, draft }`，其中 value 是已套用數值，draft 是目前編輯文字。

輸入框使用 `role=spinbutton`、`inputmode=decimal`、`aria-valuemin`、`aria-valuemax`，有值時設定 `aria-valuenow` 與含單位的 `aria-valuetext`。隱藏標題時仍有 `aria-label`。上下按鈕分別命名「增加數值」「減少數值」，使用原生 disabled。必填使用原生 required，由表單決定驗證時機。

驗收重點：9 個 Formatter 與 18 個 Handler 樣本、三種 Style 的停用差異、作用方向的高度與 Pressed 顏色、增減按鈕／鍵盤步進、空值與 0 區別、上下限、小數精度、千分位編輯切換、Enter／失焦套用、Escape 還原，以及 Disabled 阻止操作。

## 6. 參考 CSS

先載入定稿 Typography／Color System；全域套用 `box-sizing: border-box`。下列 CSS 與示範頁共用。

```css
.t3-number { width:240px; max-width:100%; color:var(--text-primary); font:400 14px/18px var(--font-primary); letter-spacing:.5px; }
.t3-number [hidden] { display:none!important; }
.t3-number__label { display:block; margin:0 0 4px; padding:0 8px; color:var(--text-tertiary); font:500 14px/18px var(--font-primary); letter-spacing:.5px; }
.t3-number__label b { color:var(--status-error-emphasis); font-weight:500; }
.t3-number__box { position:relative; display:flex; align-items:center; min-width:0; height:34px; padding:6px 30px 6px 12px; border-radius:8px; background:var(--surface-theme); }
.t3-number[data-style="tonal-gray"] .t3-number__box { background:var(--surface-secondary); }
.t3-number[data-style="outlined"] .t3-number__box { background:transparent; box-shadow:inset 0 0 0 .5px var(--border-primary); }
.t3-number__content { display:flex; align-items:center; min-width:0; max-width:100%; gap:2px; overflow:hidden; }
.t3-number__editor { position:relative; display:inline-flex; flex:0 1 auto; min-width:1ch; overflow:hidden; height:22px; }
.t3-number__measure { visibility:hidden; white-space:pre; font:inherit; letter-spacing:inherit; padding:2px 0; }
.t3-number__input { position:absolute; inset:0; display:block; width:100%; min-width:0; height:22px; padding:2px 0; border:0; outline:0; background:transparent; color:var(--text-primary); caret-color:var(--border-theme); font:inherit; letter-spacing:inherit; border-radius:0; }
.t3-number__input::placeholder { color:var(--text-primary); opacity:1; }
.t3-number__unit { color:var(--text-secondary); white-space:nowrap; flex-shrink:0; }
.t3-number:not([data-focus-origin="pointer"]) .t3-number__box:has(.t3-number__input:focus-visible) { outline:2px solid var(--border-theme); outline-offset:2px; }
.t3-number__box>.t3-handler { position:absolute; top:0; right:0; opacity:0; visibility:hidden; pointer-events:none; border-radius:0 8px 8px 0; overflow:hidden; }
.t3-number[data-state="hover"] .t3-number__box>.t3-handler,.t3-number:focus-within .t3-number__box>.t3-handler,.t3-number[data-state="disabled"] .t3-number__box>.t3-handler { opacity:1; visibility:visible; pointer-events:auto; }
.t3-number[data-state="disabled"] .t3-number__label { color:var(--text-disabled); }
.t3-number[data-state="disabled"] .t3-number__input,.t3-number[data-state="disabled"] .t3-number__input::placeholder { color:var(--text-disabled); -webkit-text-fill-color:var(--text-disabled); opacity:1; cursor:not-allowed; }
.t3-number[data-state="disabled"] .t3-number__unit { color:var(--text-disabled); }
.t3-number[data-style="tonal-theme"][data-state="disabled"] .t3-number__box { background:var(--surface-disabled); }
.t3-number[data-style="tonal-gray"][data-state="disabled"] .t3-number__box { background:var(--surface-disabled); }
.t3-number[data-style="outlined"][data-state="disabled"] .t3-number__box { background:var(--surface-disabled); box-shadow:inset 0 0 0 .5px var(--border-disabled); }
.t3-handler { --number-handler-theme:rgb(185.31654 215.18087 255 / 12%); --number-handler-gray:rgb(203.87358 203.87358 203.87358 / 12%); display:flex; flex-direction:column; width:22px; height:34px; gap:0; flex-shrink:0; }
.t3-handler__button { display:flex; flex:none; align-items:center; justify-content:center; width:22px; height:17px; min-height:0; padding:0; border:0; border-radius:0; color:var(--text-tertiary); background:var(--number-handler-theme); cursor:pointer; overflow:hidden; }
.t3-handler[data-style="tonal-gray"] .t3-handler__button { background:var(--number-handler-gray); }
.t3-handler svg { display:block; width:16px; height:16px; flex-shrink:0; }
.t3-handler[data-state^="up-"] .t3-handler__button[data-direction="up"],.t3-handler[data-state^="down-"] .t3-handler__button[data-direction="down"] { height:22px; }
.t3-handler[data-state^="up-"] .t3-handler__button[data-direction="down"],.t3-handler[data-state^="down-"] .t3-handler__button[data-direction="up"] { height:12px; }
.t3-handler[data-state="up-pressed"] .t3-handler__button[data-direction="up"],.t3-handler[data-state="down-pressed"] .t3-handler__button[data-direction="down"] { color:var(--text-theme); }
.t3-handler[data-style="outlined"] { gap:0; }
.t3-handler[data-style="outlined"] .t3-handler__button { height:17px; background:transparent; box-shadow:inset 0 0 0 .5px var(--text-quaternary); }
.t3-handler[data-style="outlined"][data-state^="up-"] .t3-handler__button[data-direction="up"],.t3-handler[data-style="outlined"][data-state^="down-"] .t3-handler__button[data-direction="down"] { height:22px; }
.t3-handler[data-style="outlined"][data-state^="up-"] .t3-handler__button[data-direction="down"],.t3-handler[data-style="outlined"][data-state^="down-"] .t3-handler__button[data-direction="up"] { height:12px; }
.t3-handler__button:disabled { color:var(--text-disabled); cursor:not-allowed; }
.t3-handler[data-state="disabled"][data-style="tonal-theme"] .t3-handler__button { background:transparent; }
.t3-handler[data-state="disabled"][data-style="tonal-gray"] .t3-handler__button { background:transparent; }
.t3-handler[data-state="disabled"][data-style="outlined"] .t3-handler__button { box-shadow:inset 0 0 0 .5px var(--border-disabled); }
.t3-handler__button:focus-visible { outline:2px solid var(--border-theme); outline-offset:-2px; }
@media(hover:none) { .t3-number .t3-number__box>.t3-handler { opacity:1; visibility:visible; pointer-events:auto; } }
```

## 7. 參考 JavaScript

`NUMBER_ICONS.up`／`down` 為示範頁內嵌的 Figma 原始向量，可換為相同 UI Kit 圖示。

```js
function createNumberModel(options={}){
  const settings={min:0,max:100,step:1,...options};
  const decimals=n=>{const [a,b='0']=String(n).toLowerCase().split('e');return Math.max(0,(a.split('.')[1]?.length||0)-Number(b));};
  if(![settings.min,settings.max,settings.step].every(Number.isFinite)||settings.min>settings.max||settings.step<=0)throw new RangeError('請設定有效的上下限與正數步進。');
  const precision=Math.max(...[settings.min,settings.max,settings.step].map(decimals)),scale=10**precision;
  if(precision>6||[settings.min,settings.max,settings.step].some(n=>!Number.isSafeInteger(Math.round(n*scale))))throw new RangeError('數值需在安全精度內，小數最多六位。');
  const normalize=n=>Math.min(settings.max,Math.max(settings.min,Math.round(n*scale)/scale));
  function parse(raw){
    const s=String(raw).trim().normalize('NFKC');if(!s)return null;
    if(!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)$/.test(s))return undefined;
    const n=Number(s.replaceAll(',',''));return Number.isFinite(n)?n:undefined;
  }
  let value=null;
  function set(next){if(next===null||next===''){value=null;return value;}const n=typeof next==='number'?next:parse(next);if(n===undefined||n===null||!Number.isFinite(n))return value;value=normalize(n);return value;}
  set(options.value??null);
  return {settings,precision,getValue:()=>value,parse,set,
    commit(raw){const n=parse(raw);if(n!==undefined)set(n);return value;},
    stepBy(direction,raw=value===null?'':String(value)){
      const parsed=parse(raw),base=parsed===null?0:parsed===undefined?(value??0):parsed;
      return set((Math.round((parsed===null?0:normalize(base))*scale)+direction*Math.round(settings.step*scale))/scale);
    },
    format(grouped=false){return value===null?'':new Intl.NumberFormat('en-US',{useGrouping:grouped,maximumFractionDigits:precision}).format(value);}
  };
}
function createNumberHandler(host,options={}){
  const settings={style:'tonal-theme',disabled:false,previewState:null,onStep:()=>{},...options};
  const root=document.createElement('div');root.className='t3-handler';root.dataset.style=settings.style;
  const buttons={};
  for(const [direction,amount] of [['up',1],['down',-1]]){
    const b=document.createElement('button');b.type='button';b.className='t3-handler__button';b.dataset.direction=direction;b.innerHTML=NUMBER_ICONS[direction];b.setAttribute('aria-label',direction==='up'?'增加數值':'減少數值');buttons[direction]=b;
    b.addEventListener('pointerenter',()=>{if(!b.disabled&&!settings.previewState)root.dataset.state=direction+'-hover';});
    b.addEventListener('pointerdown',e=>{if(!b.disabled&&!settings.previewState){e.preventDefault();root.dataset.state=direction+'-pressed';}});
    b.addEventListener('pointerup',()=>{if(!b.disabled&&!settings.previewState)root.dataset.state=direction+'-hover';});
    b.addEventListener('pointercancel',()=>{if(!settings.previewState)root.dataset.state=settings.disabled?'disabled':'default';});
    b.addEventListener('click',()=>{if(!b.disabled&&!settings.previewState)settings.onStep(amount);});
    if(settings.previewState)b.tabIndex=-1;
    root.append(b);
  }
  root.addEventListener('pointerleave',()=>{if(!settings.previewState)root.dataset.state=settings.disabled?'disabled':'default';});host.append(root);
  function update(disabled,upDisabled=false,downDisabled=false){settings.disabled=disabled;buttons.up.disabled=disabled||upDisabled;buttons.down.disabled=disabled||downDisabled;root.dataset.state=settings.previewState||(disabled?'disabled':'default');}
  update(settings.disabled);
  return {root,...buttons,update};
}
let numberSequence=0;
function createT3Number(host,options={}){
  const settings={style:'tonal-theme',label:'標題',labelVisible:true,required:true,unit:'%',disabled:false,grouped:false,value:0,placeholder:'0',previewState:null,...options};
  const model=createNumberModel(settings),id='t3-number-'+(++numberSequence);
  const root=document.createElement('div');root.className='t3-number';root.dataset.style=settings.style;
  const label=document.createElement('label');label.className='t3-number__label';label.htmlFor=id;label.hidden=!settings.labelVisible;
  const mark=document.createElement('b');mark.textContent='*';mark.hidden=!settings.required;mark.setAttribute('aria-hidden','true');label.append(mark,document.createTextNode(settings.label));
  const box=document.createElement('div');box.className='t3-number__box';const content=document.createElement('div');content.className='t3-number__content';
  const editor=document.createElement('span');editor.className='t3-number__editor';const measure=document.createElement('span');measure.className='t3-number__measure';measure.setAttribute('aria-hidden','true');
  const input=document.createElement('input');input.id=id;input.type='text';input.inputMode='decimal';input.className='t3-number__input';input.placeholder=settings.placeholder;input.autocomplete='off';input.required=settings.required;input.setAttribute('role','spinbutton');input.setAttribute('aria-label',settings.label);input.setAttribute('aria-valuemin',String(model.settings.min));input.setAttribute('aria-valuemax',String(model.settings.max));
  const unit=document.createElement('span');unit.className='t3-number__unit';unit.textContent=settings.unit;unit.hidden=!settings.unit;
  editor.append(measure,input);content.append(editor,unit);box.append(content);root.append(label,box);host.append(root);
  let focused=false,hovered=false,composing=false;
  const handler=createNumberHandler(box,{style:settings.style,disabled:settings.disabled,previewState:settings.previewState?(settings.disabled?'disabled':'default'):null,onStep:direction=>{model.stepBy(direction,input.value);input.focus();refresh(true);notify();}});
  function notify(){root.dispatchEvent(new CustomEvent('t3-number-change',{bubbles:true,detail:{value:model.getValue(),draft:input.value}}));}
  function refresh(replace=false){
    root.dataset.state=settings.previewState||(settings.disabled?'disabled':hovered||focused?'hover':'default');input.disabled=settings.disabled;
    if(replace)input.value=focused?String(model.getValue()??''):model.format(settings.grouped);
    measure.textContent=input.value||settings.placeholder;
    const current=model.parse(input.value);
    handler.update(settings.disabled,current!==undefined&&current!==null&&current>=model.settings.max,current!==undefined&&current!==null&&current<=model.settings.min);
    if(model.getValue()===null){input.removeAttribute('aria-valuenow');input.removeAttribute('aria-valuetext');}
    else{input.setAttribute('aria-valuenow',String(model.getValue()));input.setAttribute('aria-valuetext',model.format(settings.grouped)+(settings.unit?' '+settings.unit:''));}
  }
  function commit(){if(composing)return;model.commit(input.value);refresh(true);notify();}
  input.addEventListener('focus',()=>{focused=true;refresh(true);});
  input.addEventListener('blur',()=>{focused=false;commit();});
  input.addEventListener('input',()=>{refresh();if(!composing)notify();});
  input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;refresh();notify();});
  input.addEventListener('keydown',e=>{
    if(e.isComposing||composing||settings.disabled||settings.previewState)return;
    if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();model.stepBy(e.key==='ArrowUp'?1:-1,input.value);refresh(true);notify();}
    if(e.key==='Enter'){e.preventDefault();commit();}
    if(e.key==='Escape'){e.preventDefault();refresh(true);notify();}
  });
  root.addEventListener('pointerdown',()=>{root.dataset.focusOrigin='pointer';});
  root.addEventListener('keydown',()=>{root.dataset.focusOrigin='keyboard';});
  root.addEventListener('pointerenter',()=>{hovered=true;refresh();});root.addEventListener('pointerleave',()=>{hovered=false;refresh();});
  root.addEventListener('focusout',()=>queueMicrotask(()=>{if(!root.contains(document.activeElement)){focused=false;delete root.dataset.focusOrigin;refresh();}}));
  if(settings.previewState){input.readOnly=true;input.tabIndex=-1;handler.up.tabIndex=-1;handler.down.tabIndex=-1;handler.up.addEventListener('click',e=>e.preventDefault());handler.down.addEventListener('click',e=>e.preventDefault());}
  refresh(true);
  return {root,input,handler,getValue:model.getValue,setValue(value){model.set(value);refresh(true);notify();},setDisabled(disabled){settings.disabled=disabled;refresh();},destroy(){root.remove();}};
}
```

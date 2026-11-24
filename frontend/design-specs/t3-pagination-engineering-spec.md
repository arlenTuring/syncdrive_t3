# T3 UI Kit｜Pagination 工程規範

設計來源：[Pagination 區塊 240:23346](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=240-23346)。Typography 與 Color System 沿用[定稿變數](https://chatgpt.com/library?file_id=libfile_202bb92aeecc8191bf26b85338556396&account_id=personal)。外觀以指定 Figma 展示區為準，未提供動態規格，不額外加入動畫。

## 1. 元件範圍

| 元件 | Figma 來源 | 內容 |
| --- | --- | --- |
| Pagination | [186:5089](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=186-5089) | `Options` 布林屬性控制每頁筆數與快速跳頁；完整與精簡共 2 個展示樣本。 |
| Page-Button | [185:1124](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=185-1124) | Style＝Off／On；State＝Default／Hover／Pressed，共 6 個變體。Number 為文字屬性。 |
| Page-Arrow-Button | [1002:43770](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=1002-43770) | Type＝Left／Right；State＝Default／Hover／Pressed，共 6 個變體。來源元件名稱仍為 Component/Page-Button。 |
| Page-Jump | [185:1827](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=185-1827) | Type＝Jump Back／Jump Forward；State＝Default／Hover，共 4 個變體。 |

Page-Button 的 On 表示目前頁，與 Hover／Pressed 分開。切換頁面後只有一個按鈕為 On。Page-Jump 為可操作的省略跳頁按鈕，不是純文字省略號。

## 2. 尺寸與布局

| 部位 | 規格 |
| --- | --- |
| 完整分頁 | Figma 根節點仍為 650 × 34px，更新後頁碼組為 352 × 32px。工程按實際內容自適應寬度，後接選項區。 |
| 精簡分頁 | Figma 樣本 272 × 32px，只顯示上一頁、1～5、下一頁。 |
| 頁碼組 | 按鈕間 gap 8px；數量依頁碼與省略規則調整，不寫死整組寬度。 |
| Page-Button | 32 × 32px、圓角 8px，無 padding；文字置中。超過兩位數時可增寬、左右 padding 4px，避免大頁碼被裁切。 |
| 上一頁／下一頁 | 外框沿用 32 × 32px Page-Button，內部箭頭 24 × 24px。Default 圖示 `--text-secondary`，Hover／Pressed 改為 `--text-primary`。 |
| Page-Jump | 32 × 32px，無底色、無描邊、無圓角；Default 與 Hover 的圖示槽皆為 28 × 28px，置中，四周各留 2px。 |
| 每頁筆數 | 120 × 34px，圓角 8px，左右 padding 12px，底色 `--surface-theme`。文字「10 條/頁」，右側向下箭頭 20 × 20px、`--text-tertiary`。 |
| 快速跳頁 | 「跳至」＋12px gap＋120 × 34px 輸入框＋12px gap＋「頁」，樣本總寬 187px。輸入框圓角 8px，padding 上下 8px／左右 12px，底色 `--surface-theme`，初始空白。 |
| 區塊間距 | 工程保留頁碼組與選項區 gap 31px，每頁筆數與快速跳頁 gap 32px。新版 Figma 頁碼組放大後，650px 固定根寬使選項區只剩 298px，Dropdown 在選項區內 x＝-41px，已與頁碼組重疊。工程不複製負間距，內容自然寬至少 352＋31＋120＋32＋187＝722px，空間不足則換行。 |

文字統一使用 `.text-body-s`：Noto Sans TC、400、14px／18px、字距 0.5px。一般頁碼、選項文字及「跳至／頁」用 `--text-primary`。狹窄容器允許區塊與頁碼組換行，不以固定寬度造成整頁水平捲動；尺寸與間距維持上述基準。

## 3. State 色票

### Page-Button

| Style | State | 背景 | 文字 | 描邊 |
| --- | --- | --- | --- | --- |
| Off | Default | 透明 | `--text-primary` | 無 |
| Off | Hover | `--link-standard` | `--text-primary` | 無 |
| Off | Pressed | `--link-standard-hover` | `--text-primary` | 無 |
| On | Default | 透明 | `--text-theme` | 1px 內描邊 `--link-theme-filled-hover` |
| On | Hover | 透明 | `--text-theme-light` | 1px 內描邊 `--text-theme-light` |
| On | Pressed | 透明 | `--text-theme-light` | 1px 內描邊 `--text-theme-light` |

On 的 Hover／Pressed 均保持透明底色，不套用 Off 的灰底。Previous／Next 使用相同的 Hover／Pressed 背景；箭頭在 Default 用 `--text-secondary`，Hover／Pressed 改為 `--text-primary`。

### Page-Jump 與選項

Default 顯示 `--text-quaternary` 省略符號；Hover 以 `--text-theme` 的雙箭頭取代，Jump Back 向左、Jump Forward 向右，底色皆透明。鍵盤焦點同樣顯示對應雙箭頭，並提供 2px `--border-theme` 焦點框。

每頁筆數沿用 Dropdown 行為，展開後欄位增加 0.5px `--border-theme` 內描邊，箭頭朝上。選單與欄位距離 7px，圓角 8px，底色 `--surface-background`、上下 padding 4px、選項高 40px、左右 padding 20px。Hover／鍵盤選項背景用 `--link-standard`；Pressed 按壓期間用 `--link-standard-hover`。一般選項文字 `--text-primary`，已選取項目的文字 `--text-theme`，在 Hover／Pressed 時也維持主題色。Figma Menu item 提供 Default／Hover 與 Select On／Off，Pressed 背景依目前分頁操作的按壓色票補齊。

快速跳頁輸入框取得焦點時增加 0.5px `--border-theme` 內描邊。Page-Button 與 Dropdown 觸發按鈕的鍵盤焦點另以 2px `--border-theme` 外框提示。

原稿未提供 Page-Button 的 Disabled 變體。工程在第一頁停用上一頁、最後一頁停用下一頁；箭頭使用 `--text-disabled`，且不進入 Hover／Pressed。全域 Disabled 與無資料狀態為工程補充：停用所有操作，文字改為 `--text-disabled`，目前頁框線改為 `--border-disabled`；選項欄位背景用 `--surface-disabled`。

## 4. 頁碼與資料行為

以下為參考實作的資料規則，與元件靜態外觀分開；實際資料載入由父層負責。

| 項目 | 規則 |
| --- | --- |
| 預設 | total＝250、pageSize＝10、current＝1，共 25 頁，Options 顯示。頁碼從 1 起算。 |
| 總頁數 | `max(1, ceil(total / pageSize))`。total 必須是非負整數，pageSize 為正整數。 |
| 頁碼列 | 7 頁以下全部顯示。更多頁時固定保留第一頁、最後一頁；靠近開頭顯示 1～5，靠近結尾顯示最後 5 頁，中段顯示目前頁及前後各 2 頁。只略過 1 頁時直接補上該頁，略過更多頁時顯示 Page-Jump。 |
| 省略跳頁 | Jump Back／Forward 分別跳 current－5／current＋5，並收斂至 1～totalPages。 |
| 上一頁／下一頁 | 每次改變 1 頁；到達邊界時停用對應箭頭。點選目前頁不改變頁碼。 |
| 每頁筆數 | 示範提供 10／20／50／100。切換後盡量保留原頁第一筆資料所在的新頁，公式為 `floor((舊 current－1) × 舊 pageSize / 新 pageSize)＋1`，再收斂到合法頁碼。 |
| 快速跳頁 | 輸入整數後按 Enter 套用；超過範圍時收斂到首／末頁。空值不操作，非整數不切頁，Escape 清空輸入。中文組字時不攔截 Enter。 |
| 資料減少 | total 改變時若目前頁超出範圍，移至新的最後一頁。 |
| 無資料 | total＝0，保留第 1 頁作為布局位置，上一頁、頁碼、下一頁及選項皆停用。顯示範圍為 0～0。 |
| Options | 僅控制每頁筆數及快速跳頁的顯示，隱藏後 current／pageSize／total 不變。精簡來源範例另採 total＝50、pageSize＝10，以對照 5 頁樣本。 |

完整與精簡範例各自擁有獨立資料，互動區的設定不會同步改變來源範例。實際使用時每次變更由父層收到 current／pageSize 後讀取對應資料；不在此元件內加入載入中或請求失敗狀態。

## 5. 工程介面與可存取性

`createT3Pagination(host, options)` 支援 `current`、`total`、`pageSize`、`pageSizes`、`showOptions`、`disabled`、`label`。回傳 `root`、`input`、`trigger`、`menu`、`model`，以及 `setCurrent(page)`、`setTotal(total)`、`setPageSize(size)`、`setDisabled(disabled)`、`destroy()`。以冒泡的 `t3-pagination-change` 回傳 `{ current, pageSize, total, totalPages, from, to }`。

使用具名稱的 nav；目前頁加 `aria-current=page`。上一頁、下一頁與省略跳頁都提供明確名稱，不能僅以圖示作為可存取名稱。頁碼重繪後保留原操作位置的焦點，若該位置已消失，移至目前頁。

Dropdown 使用 `aria-haspopup=listbox`、`aria-expanded`、`aria-controls`；選單使用 listbox／option 與 `aria-selected`。↑／↓、Home／End 移動選項；Enter／Space 透過原生按鈕套用；Escape 關閉並回到觸發按鈕，外部點擊或焦點離開分頁元件也關閉。快速跳頁有「跳至頁碼」名稱，無效輸入設定 `aria-invalid`，由隱藏狀態區說明；有效 Enter 清空輸入並保留輸入焦點。

驗收重點：2 個 Pagination 來源組合、6 個 Page-Button 狀態、6 個 Page-Arrow-Button 狀態、4 個 Page-Jump 狀態；頁碼單一選取、首末頁邊界、5 頁跳轉、每頁筆數調整、指定頁碼 Enter、空值與無效輸入、資料總數減少、無資料、Options 顯示切換、Disabled，以及鍵盤操作後焦點保留。

## 6. 參考 CSS

需先載入定稿 Typography／Color System，全域使用 `box-sizing: border-box`。此段與示範頁共用。

```css
.t3-pagination { display:flex; align-items:center; flex-wrap:wrap; gap:16px 31px; width:max-content; max-width:100%; font:400 14px/18px var(--font-primary); letter-spacing:.5px; color:var(--text-primary); }
.t3-pagination [hidden] { display:none!important; }
.t3-pagination__pages { display:flex; align-items:center; flex-wrap:wrap; gap:8px; min-width:0; max-width:100%; }
.t3-page { display:flex; align-items:center; justify-content:center; width:32px; min-width:32px; height:32px; padding:0; border:0; border-radius:8px; background:transparent; color:var(--text-primary); font:400 14px/18px var(--font-primary); letter-spacing:.5px; cursor:pointer; }
.t3-page[data-wide="true"] { width:auto; padding:0 4px; }
.t3-page:not(:disabled):hover,.t3-page[data-preview="hover"] { background:var(--link-standard); }
.t3-page:not(:disabled):active,.t3-page[data-preview="pressed"] { background:var(--link-standard-hover); }
.t3-page[aria-current="page"] { color:var(--text-theme); background:transparent; box-shadow:inset 0 0 0 1px var(--link-theme-filled-hover); }
.t3-page[aria-current="page"]:not(:disabled):hover,.t3-page[aria-current="page"]:not(:disabled):active,.t3-page[aria-current="page"][data-preview="hover"],.t3-page[aria-current="page"][data-preview="pressed"] { color:var(--text-theme-light); background:transparent; box-shadow:inset 0 0 0 1px var(--text-theme-light); }
.t3-page[data-arrow] { color:var(--text-secondary); }
.t3-page[data-arrow]:not(:disabled):hover,.t3-page[data-arrow]:not(:disabled):active,.t3-page[data-arrow][data-preview="hover"],.t3-page[data-arrow][data-preview="pressed"] { color:var(--text-primary); }
.t3-page[data-arrow] svg { width:24px; height:24px; }
.t3-page:disabled { color:var(--text-disabled); cursor:not-allowed; }
.t3-page:disabled[aria-current="page"] { box-shadow:inset 0 0 0 1px var(--border-disabled); }
.t3-page-jump { display:flex; align-items:center; justify-content:center; width:32px; height:32px; border:0; padding:0; border-radius:0; background:transparent; color:var(--text-quaternary); cursor:pointer; flex-shrink:0; }
.t3-page-jump svg { display:block; width:28px; height:28px; }
.t3-page-jump__arrow { display:none; color:var(--text-theme); }
.t3-page-jump:not(:disabled):hover .t3-page-jump__dots,.t3-page-jump:focus-visible .t3-page-jump__dots,.t3-page-jump[data-preview="hover"] .t3-page-jump__dots { display:none; }
.t3-page-jump:not(:disabled):hover .t3-page-jump__arrow,.t3-page-jump:focus-visible .t3-page-jump__arrow,.t3-page-jump[data-preview="hover"] .t3-page-jump__arrow { display:block; }
.t3-page-jump:disabled { color:var(--text-disabled); cursor:not-allowed; }
.t3-pagination__options { display:flex; align-items:center; flex-wrap:wrap; gap:16px 32px; }
.t3-pagination__size { position:relative; width:120px; flex-shrink:0; }
.t3-pagination__size-trigger { display:flex; align-items:center; justify-content:space-between; width:120px; height:34px; padding:2px 12px; border:0; border-radius:8px; background:var(--surface-theme); color:var(--text-primary); font:inherit; letter-spacing:inherit; cursor:pointer; }
.t3-pagination__size-trigger svg { width:20px; height:20px; color:var(--text-tertiary); flex-shrink:0; }
.t3-pagination__size-trigger[aria-expanded="true"] { box-shadow:inset 0 0 0 .5px var(--border-theme); }
.t3-pagination__size-trigger[aria-expanded="true"] svg { transform:rotate(180deg); }
.t3-pagination__menu { position:absolute; z-index:10; top:calc(100% + 7px); left:0; width:120px; max-height:312px; padding:4px 0; border-radius:8px; overflow:auto; background:var(--surface-background); }
.t3-pagination__size-option { display:block; width:100%; height:40px; padding:0 20px; border:0; background:transparent; color:var(--text-primary); text-align:left; white-space:nowrap; font:inherit; letter-spacing:inherit; cursor:pointer; }
.t3-pagination__size-option:hover,.t3-pagination__size-option:focus-visible { background:var(--link-standard); outline:0; }
.t3-pagination__size-option[aria-selected="true"] { color:var(--text-theme); }
.t3-pagination__size-option:active { background:var(--link-standard-hover); }
.t3-pagination__quick { display:flex; align-items:center; gap:12px; white-space:nowrap; }
.t3-pagination__input { width:120px; height:34px; padding:8px 12px; border:0; border-radius:8px; outline:0; background:var(--surface-theme); color:var(--text-primary); caret-color:var(--border-theme); font:inherit; letter-spacing:inherit; }
.t3-pagination__input:focus { box-shadow:inset 0 0 0 .5px var(--border-theme); }
.t3-pagination__input:disabled,.t3-pagination__size-trigger:disabled { background:var(--surface-disabled); color:var(--text-disabled); cursor:not-allowed; }
.t3-page:focus-visible,.t3-page-jump:focus-visible,.t3-pagination__size-trigger:focus-visible { outline:2px solid var(--border-theme); outline-offset:2px; }
.t3-pagination__status { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0; }
```

## 7. 參考 JavaScript

`PAGINATION_ICONS` 為示範頁內嵌的 Figma 原始 SVG，包含 prev、next、dots、back、forward、down。

```js
function createPaginationModel(options={}){
  let total=250,size=10,current=1;
  const positive=n=>Number.isSafeInteger(Number(n))&&Number(n)>0;
  function pages(){return Math.max(1,Math.ceil(total/size));}
  function setPage(value){if(Number.isFinite(Number(value)))current=Math.max(1,Math.min(pages(),Math.trunc(Number(value))));return current;}
  function setTotal(value){if(!Number.isSafeInteger(Number(value))||Number(value)<0)throw new RangeError('總筆數需為非負整數。');total=Number(value);setPage(current);}
  function setSize(value){if(!positive(value))throw new RangeError('每頁筆數需為正整數。');const first=(current-1)*size;size=Number(value);setPage(Math.floor(first/size)+1);}
  setTotal(options.total??250);setSize(options.pageSize??10);setPage(options.current??1);
  function items(){
    const last=pages();if(last<=7)return Array.from({length:last},(_,i)=>i+1);
    let start,end;if(current<=4){start=2;end=5;}else if(current>=last-3){start=last-4;end=last-1;}else{start=current-2;end=current+2;}
    const selected=[1,...Array.from({length:end-start+1},(_,i)=>start+i),last],out=[];
    for(const page of selected){const previous=out.filter(v=>typeof v==='number').at(-1);if(previous&&page-previous===2)out.push(previous+1);else if(previous&&page-previous>2)out.push(page<current?'back':'forward');out.push(page);}return out;
  }
  return {get total(){return total;},get pageSize(){return size;},get current(){return current;},get totalPages(){return pages();},get from(){return total===0?0:(current-1)*size+1;},get to(){return Math.min(total,current*size);},items,setPage,setTotal,setSize};
}
function makePageButton(text,options={}){
  const b=document.createElement('button');b.type='button';b.className='t3-page';b.textContent=String(text);b.dataset.wide=String(String(text).length>2);b.setAttribute('aria-label','第 '+text+' 頁');if(options.selected)b.setAttribute('aria-current','page');if(options.preview)b.dataset.preview=options.preview;return b;
}
function makePageArrow(direction,preview=null){
  const b=makePageButton('');b.dataset.arrow=direction;b.innerHTML=PAGINATION_ICONS[direction];b.setAttribute('aria-label',direction==='prev'?'上一頁':'下一頁');if(preview)b.dataset.preview=preview;return b;
}
function makePageJump(direction,preview=null){
  const b=document.createElement('button');b.type='button';b.className='t3-page-jump';b.setAttribute('aria-label',direction==='back'?'向前跳 5 頁':'向後跳 5 頁');if(preview)b.dataset.preview=preview;
  const dots=document.createElement('span');dots.className='t3-page-jump__dots';dots.innerHTML=PAGINATION_ICONS.dots;
  const arrow=document.createElement('span');arrow.className='t3-page-jump__arrow';arrow.innerHTML=PAGINATION_ICONS[direction];b.append(dots,arrow);return b;
}
let paginationSequence=0;
function createT3Pagination(host,options={}){
  const settings={showOptions:true,disabled:false,pageSizes:[10,20,50,100],label:'分頁',...options};
  const model=createPaginationModel(settings),id='t3-pagination-'+(++paginationSequence);
  const root=document.createElement('nav');root.className='t3-pagination';root.setAttribute('aria-label',settings.label);
  const pages=document.createElement('div');pages.className='t3-pagination__pages';
  const controls=document.createElement('div');controls.className='t3-pagination__options';controls.hidden=!settings.showOptions;
  const sizeWrap=document.createElement('div');sizeWrap.className='t3-pagination__size';
  const trigger=document.createElement('button');trigger.type='button';trigger.className='t3-pagination__size-trigger';trigger.setAttribute('aria-label','每頁筆數');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-controls',id+'-sizes');
  const sizeText=document.createElement('span');const chevron=document.createElement('span');chevron.innerHTML=PAGINATION_ICONS.down;trigger.append(sizeText,chevron);
  const menu=document.createElement('div');menu.className='t3-pagination__menu';menu.id=id+'-sizes';menu.setAttribute('role','listbox');menu.setAttribute('aria-label','每頁筆數');menu.hidden=true;
  const quick=document.createElement('label');quick.className='t3-pagination__quick';const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.className='t3-pagination__input';input.setAttribute('aria-label','跳至頁碼');input.autocomplete='off';
  quick.append(document.createTextNode('跳至'),input,document.createTextNode('頁'));
  const status=document.createElement('span');status.className='t3-pagination__status';status.setAttribute('aria-live','polite');status.setAttribute('role','status');
  sizeWrap.append(trigger,menu);controls.append(sizeWrap,quick);root.append(pages,controls,status);host.append(root);
  let open=false,composing=false;
  const focusKey=key=>(Array.from(pages.querySelectorAll('button')).find(b=>b.dataset.key===key)||Array.from(pages.querySelectorAll('button')).find(b=>b.getAttribute('aria-current')==='page'))?.focus();
  function notify(){root.dispatchEvent(new CustomEvent('t3-pagination-change',{bubbles:true,detail:{current:model.current,pageSize:model.pageSize,total:model.total,totalPages:model.totalPages,from:model.from,to:model.to}}));}
  function selectPage(page,key){if(settings.disabled||model.total===0)return;model.setPage(page);render();if(key)focusKey(key);notify();}
  function setOpen(next,focusOption=false){if(settings.disabled)return;open=next;menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));if(open&&focusOption){const list=Array.from(menu.querySelectorAll('button'));(list.find(b=>b.getAttribute('aria-selected')==='true')||list[0])?.focus();}}
  function renderSizes(){
    menu.replaceChildren();const sizes=Array.from(new Set([...settings.pageSizes,model.pageSize])).filter(v=>Number.isSafeInteger(v)&&v>0).sort((a,b)=>a-b);
    for(const size of sizes){const b=document.createElement('button');b.type='button';b.className='t3-pagination__size-option';b.textContent=size+' 條/頁';b.setAttribute('role','option');b.setAttribute('aria-selected',String(size===model.pageSize));b.addEventListener('click',()=>{if(settings.disabled)return;model.setSize(size);setOpen(false);render();trigger.focus();notify();});menu.append(b);}
  }
  function render(){
    pages.replaceChildren();const empty=model.total===0,disabled=settings.disabled||empty;
    function addArrow(direction){const b=makePageArrow(direction);b.dataset.key=direction;b.disabled=disabled||(direction==='prev'?model.current===1:model.current===model.totalPages);b.addEventListener('click',()=>selectPage(model.current+(direction==='prev'?-1:1),direction));pages.append(b);}
    addArrow('prev');
    for(const item of model.items()){
      const b=typeof item==='number'?makePageButton(item,{selected:item===model.current}):makePageJump(item);b.dataset.key=String(item);b.disabled=disabled;
      b.addEventListener('click',()=>selectPage(typeof item==='number'?item:model.current+(item==='back'?-5:5),String(item)));pages.append(b);
    }
    addArrow('next');
    sizeText.textContent=model.pageSize+' 條/頁';trigger.disabled=disabled;input.disabled=disabled;trigger.setAttribute('aria-expanded',String(open));
    if(disabled){open=false;menu.hidden=true;trigger.setAttribute('aria-expanded','false');}
    renderSizes();status.textContent='目前第 '+model.current+' 頁，共 '+model.totalPages+' 頁；顯示 '+model.from+' 至 '+model.to+' 筆，共 '+model.total+' 筆。';
  }
  trigger.addEventListener('click',()=>setOpen(!open));
  trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setOpen(true,true);}if(e.key==='Escape'){setOpen(false);}});
  menu.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();setOpen(false);trigger.focus();return;}
    const list=Array.from(menu.querySelectorAll('button')),index=list.indexOf(document.activeElement);let next=null;
    if(e.key==='ArrowDown')next=(index+1)%list.length;if(e.key==='ArrowUp')next=(index-1+list.length)%list.length;if(e.key==='Home')next=0;if(e.key==='End')next=list.length-1;
    if(next!==null){e.preventDefault();list[next]?.focus();}
  });
  function outside(e){if(open&&!root.contains(e.target))setOpen(false);}
  document.addEventListener('pointerdown',outside);
  root.addEventListener('focusout',()=>queueMicrotask(()=>{if(!root.contains(document.activeElement)&&open)setOpen(false);}));
  input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});
  input.addEventListener('keydown',e=>{if(e.isComposing||composing||settings.disabled||model.total===0)return;
    if(e.key==='Escape'){input.value='';input.removeAttribute('aria-invalid');}
    if(e.key==='Enter'){e.preventDefault();const value=input.value.trim();if(!value)return;if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))){input.setAttribute('aria-invalid','true');status.textContent='請輸入整數頁碼。';return;}input.removeAttribute('aria-invalid');selectPage(Number(value));input.value='';input.focus();}
  });
  render();
  return {root,input,trigger,menu,model,setCurrent(page){model.setPage(page);render();notify();},setTotal(total){model.setTotal(total);render();notify();},setPageSize(size){model.setSize(size);render();notify();},setDisabled(disabled){settings.disabled=disabled;render();},destroy(){document.removeEventListener('pointerdown',outside);root.remove();}};
}
```

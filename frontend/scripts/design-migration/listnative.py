"""列出還留著的原生 <button>，依類型分組，輸出 Markdown（SKIPPED.md）。
用法：python3 scripts/design-migration/listnative.py > scripts/design-migration/SKIPPED.md
分類是啟發式；每類寫明「為什麼沒換」與「需要什麼規格／決定」。"""
import re,sys,os,glob,collections
sys.path.insert(0,os.path.dirname(__file__))
from swap import _ranges,_open_end

CATS=[
 ('selectable','可選取的文字／圖示小鈕（選中／未選中）',
  '文字按鈕規格的 Pressed 只是按住當下，沒有「選中後保持」的狀態；能歸成多選一的已改 SegmentedControl、純圖示的已改 IconButton pressed，剩下的是可複選標籤、預設尺寸、色票、步驟、時間格等。',
  '需要「可選取標籤（Chip）」規格（可複選、可移除），或確認哪些可以用 SegmentedControl。'),
 ('row','清單列／卡片（整塊可點）',
  '整列、整張卡片可點，用 `<button>` 是為了鍵盤可及；套按鈕外觀會錯。',
  '需要「清單列／可選卡片」的選中、滑過、焦點樣式規格。'),
 ('handle','拖曳把手／畫布控制點',
  '拖曳、指標事件、畫布座標定位，外觀依畫布元件。',
  '多半不需要按鈕規格；可另訂「拖曳把手」小規格。'),
 ('menu','選單／下拉選項',
  '已用共用的 menuItemClass／MENU 樣式，但仍是原生 `<button role="option／menuitem">`。',
  '需要「選單項目」規格（含勾選、危險項、停用）。'),
 ('inline-style','畫布元件內用 inline style 的按鈕',
  '儀表板畫布元件的顏色、尺寸來自元件設定（使用者可調），不能套固定 token。',
  '需要決定：畫布元件是否跟隨設計系統，或維持可自訂外觀。'),
 ('trigger','下拉／日期／欄位觸發框',
  '外觀是輸入欄位（已套 fieldClass），不是按鈕。',
  '屬於欄位規格；目前 fieldClass 已統一。'),
 ('tab','頁籤（特殊版型）',
  '直式頁籤、帶計數、可雙擊改名的頁籤，共用 Tabs 不支援。',
  '需要頁籤規格（直式、徽章、可編輯）。'),
 ('other','其他',
  '逐一判斷後保留：Logo、表頭排序、上傳拖放區、手風琴標題、數字微調 ▴▾、色票觸發、帶徽章的通知鈴、時間輪選項等。',
  '各自不同，最後整理時逐項決定。'),
]
def categorize(tag,ch):
    txt=re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',ch)).strip()
    if re.search(r'role=["{]?\W?(menuitem|option)',tag) or 'menuItemClass' in tag or 'menuOptionClass' in tag: return 'menu'
    if re.search(r'role=["{]?\W?tab\b',tag): return 'tab'
    if 'fieldClass' in tag or 'aria-haspopup' in tag or ('aria-expanded' in tag and 'Chevron' in ch): return 'trigger'
    if 'draggable' in tag or 'onPointerDown' in tag or 'onMouseDown' in tag or 'Grip' in ch: return 'handle'
    if ch.count('<span')+ch.count('<div')+ch.count('<p')>=2 or ('text-left' in tag and len(txt)>12): return 'row'
    if re.search(r'(active|selected|checked|isActive|current|===)\s*\??',tag) and 'className={' in tag: return 'selectable'
    if 'style=' in tag: return 'inline-style'
    return 'other'
rows=collections.defaultdict(list)
for f in sorted(glob.glob('src/**/*.tsx',recursive=True)):
    if '/components/ui/' in f or f.endswith('.spec.tsx'): continue
    s=open(f,encoding='utf-8').read()
    for st,en in sorted(_ranges(s,'button')):
        seg=s[st:en]; oe=_open_end(seg,0); tag=seg[:oe+1]; ch=seg[oe+1:-len('</button>')]
        txt=re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',ch)).strip()
        txt=re.sub(r'\{t\(\'([^\']+)\'[^}]*\)\}',r'\1',txt)[:36].replace('|','｜')
        icons=','.join(re.findall(r'<([A-Z]\w+)',ch)[:2])
        rows[categorize(tag,ch)].append((f[4:],s[:st].count('\n')+1,txt,icons))
total=sum(len(v) for v in rows.values())
print('# 保留的原生 <button>（待最後整理）\n')
print(f'由 `scripts/design-migration/listnative.py` 產生；目前共 **{total}** 個。分類是啟發式，個別可能歸錯類。\n')
print('| 類型 | 數量 | 為什麼沒換 | 需要什麼 |\n|---|---:|---|---|')
for key,name,why,need in CATS:
    if rows[key]: print(f'| {name} | {len(rows[key])} | {why} | {need} |')
for key,name,why,need in CATS:
    if not rows[key]: continue
    print(f'\n## {name}（{len(rows[key])}）\n')
    print('| 位置 | 內容 | 圖示 |\n|---|---|---|')
    for f,l,txt,icons in rows[key]: print(f'| `{f}:{l}` | {txt or "—"} | {icons or "—"} |')

"""把「只靠 className 三元式切換停用外觀」的按鈕改成靜態 class，交給 convbtn.py 轉成 Button / IconButton。
條件：有 disabled 屬性；className={`基底 ${條件 ? A : B}`} 其中一支含 cursor-not-allowed 或 opacity-；
內容是單一圖示或純文字。停用外觀改由元件的 disabled 樣式負責，保留可用狀態那一支。
用法：python3 flatdisabled.py files...  之後再跑 convbtn.py。"""
import re,sys,os
sys.path.insert(0,os.path.dirname(__file__))
from swap import _ranges,_open_end
from convbtn import ICON
DIS=re.compile(r'cursor-not-allowed|(?<![\w-])opacity-\d')
def branch(lit):
    return lit.strip()[1:-1]
def flatten(path):
    s=open(path,encoding='utf-8').read(); n=0
    for st,en in sorted(_ranges(s,'button'),reverse=True):
        seg=s[st:en]; oe=_open_end(seg,0); tag=seg[:oe+1]; ch=seg[oe+1:-len('</button>')].strip()
        if not re.search(r'\bdisabled=',tag): continue
        if not (re.fullmatch(ICON,ch) or re.fullmatch(r'[^<>{}]+|\{t\([^{}]*\)\}',ch)): continue
        m=re.search(r'className=\{`([^`$]*)\$\{\s*([^?{}]+?)\s*\?\s*(\'[^\']*\'|"[^"]*")\s*:\s*(\'[^\']*\'|"[^"]*")\s*\}([^`$]*)`\}',tag,re.S)
        if not m: continue
        a,b=branch(m.group(3)),branch(m.group(4))
        if DIS.search(a) and not DIS.search(b): keep=b
        elif DIS.search(b) and not DIS.search(a): keep=a
        else: continue
        cls=re.sub(r'\s+',' ',(m.group(1)+' '+keep+' '+m.group(5))).strip()
        newtag=tag[:m.start()]+f'className="{cls}"'+tag[m.end():]
        s=s[:st]+newtag+seg[oe+1:]+s[en:]; n+=1
    if n: open(path,'w',encoding='utf-8').write(s)
    return n
if __name__=='__main__':
    tot=0
    for p in sys.argv[1:]:
        k=flatten(p); tot+=k
        if k: print(f'{p}: {k}')
    print('合計',tot)

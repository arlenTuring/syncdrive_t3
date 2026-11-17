"""逐一指定轉換：把某檔某行開始的 <button> 換成 Button / IconButton（規則判斷不了、要人工決定外觀時用）。
在 Python 裡呼叫：conv(path, line, comp='Button', h='subordinate', v='outlined', lead='<Plus />', label=None, cls='', extra='')
- 原本的屬性都保留（onClick→onPress、type="button" 省略、className 丟掉改用 cls 指定的版面 class）
- label 不給：用原本內容去掉圖示與單層 <span> 包裝
- IconButton：icon 必填，label 不給就用原本的 aria-label / title"""
import re,sys,os
sys.path.insert(0,os.path.dirname(__file__))
from swap import _ranges,_open_end,ensure_import
from convbtn import parse_attrs,ICON,CICON
def _find(s,line):
    for st,en in _ranges(s,'button'):
        if s[:st].count('\n')+1==line: return st,en
    raise SystemExit(f'找不到第 {line} 行的 <button>')
def conv(path,line,comp='Button',h='superior',v='filled',lead=None,trail=None,icon=None,label=None,cls='',extra='',size=None,ui=None):
    s=open(path,encoding='utf-8').read()
    st,en=_find(s,line); seg=s[st:en]; oe=_open_end(seg,0); tag=seg[:oe+1]; ch=seg[oe+1:-len('</button>')]
    attrs=parse_attrs(tag)
    if attrs is None:
        # 有 {...spread}：parse_attrs 不支援，手動切
        attrs=[]; body=tag[len('<button'):-1]
        for m in re.finditer(r'\{\.\.\.[^{}]+\}|[\w:-]+(?:=(?:"[^"]*"|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}))?',body):
            t=m.group(0)
            if t.startswith('{...'): attrs.append((t,None))
            else:
                k,_,val=t.partition('='); attrs.append((k,val or None))
    parts=[]
    d=dict(attrs)
    for k,val in attrs:
        if k=='className': continue
        if k=='type' and val=='"button"': continue
        if k=='onClick': parts.append(f'onPress={val}'); continue
        if comp=='IconButton' and k=='aria-label': continue
        parts.append(k if val is None else f'{k}={val}')
    if 'type' not in d and 'type="submit"' not in parts: parts.append('type="submit"')
    hv=[]
    if size: hv.append(f'size="{size}"')
    if h!='superior': hv.append(f'hierarchy="{h}"')
    if v!='filled': hv.append(f'variant="{v}"')
    if cls: hv.append(f'className="{cls}"')
    if comp=='IconButton':
        lab=label or d.get('aria-label') or d.get('title')
        assert lab, (path,line,'IconButton 需要名稱')
        if not lab.startswith(('{','"')): lab=f'"{lab}"'
        new=f'<IconButton {" ".join(hv+parts)} label={lab} icon={{{icon}}}{(" "+extra) if extra else ""} />'
    else:
        if label is None:
            lab=re.sub(CICON,'',ch); lab=re.sub(ICON,'',lab)
            lab=re.sub(r'\{[^{}]*(?:\?\?|&&)\s*\}','',lab).strip()  # 拿掉圖示後留下的 {x ?? } / {x && }
            lab=re.sub(r'\{[^{}<>]*\?\s*\(\s*\)\s*:\s*\(\s*\)\s*\}\s*','',lab).strip()  # {x ? ( ) : ( )}
            m=re.fullmatch(r'<span(?:\s+className="[^"]*")?>(.*)</span>',lab,re.S)
            if m: lab=m.group(1).strip()
        else: lab=label
        if lead: hv.append(f'leadingIcon={{{lead}}}')
        if trail: hv.append(f'trailingIcon={{{trail}}}')
        new=f'<Button {" ".join(hv+parts)}{(" "+extra) if extra else ""}>{lab}</Button>'
    s=s[:st]+new+s[en:]
    open(path,'w',encoding='utf-8').write(s)
    if ui is None:
        root=os.path.abspath('src'); rel=os.path.relpath(os.path.join(root,'components/ui'),os.path.dirname(os.path.abspath(path)))
        ui=rel if rel.startswith('.') else './'+rel
    ensure_import(path,[comp],ui)

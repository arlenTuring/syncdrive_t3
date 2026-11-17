"""規則化轉換原生 <button> 成 components/ui 的 Button / IconButton（判斷不了的跳過）。
用法：python3 convbtn.py <ui-import-path-resolver> files...（import 路徑依檔案位置自動算）"""
import re,sys,os
sys.path.insert(0,os.path.dirname(__file__))
from swap import _ranges, _open_end, ensure_import
LAYOUT=re.compile(r'^(?:(?:sm|md|lg|xl|2xl):)?(?:-?m[trblxy]?-\S+|ml-auto|mr-auto|mx-auto|w-\S+|min-w-\S+|max-w-\S+|flex-1|flex-none|grow|shrink-0|self-\S+|justify-self-\S+|col-span-\S+|row-span-\S+|order-\S+|absolute|relative|fixed|sticky|inset-\S+|-?top-\S+|-?right-\S+|-?bottom-\S+|-?left-\S+|-?translate-[xy]-\S+|z-\S+|hidden|block|inline-flex|flex)$')
SKIP_ATTR=re.compile(r'\bstyle=|\bref=\{(?!\w+Ref\b)|\brole=|aria-pressed|aria-selected|aria-checked|draggable|onPointer|onMouse|onDrag|onKey|\{\.\.\.|data-captures')
def parse_attrs(tag):
    # tag = '<button ...>' ; returns list of (name, raw_value or None)
    body=tag[len('<button'):-1].rstrip('/').strip()
    out=[];i=0
    while i<len(body):
        while i<len(body) and body[i].isspace(): i+=1
        if i>=len(body): break
        m=re.match(r'[\w:-]+',body[i:])
        if not m: return None
        name=m.group(0); i+=len(name)
        if i<len(body) and body[i]=='=':
            i+=1
            if body[i]=='"':
                j=body.index('"',i+1); val=body[i:j+1]; i=j+1
            elif body[i]=='{':
                d=0;j=i
                while True:
                    if body[j]=='{':d+=1
                    elif body[j]=='}':
                        d-=1
                        if d==0:break
                    j+=1
                val=body[i:j+1]; i=j+1
            else: return None
        else: val=None
        out.append((name,val))
    return out
ICON=r'<([A-Z]\w*)(?:\s+className=(?:"[^"]*"|\{[^{}]*\}))?\s*/>'
def classify(cls,children,is_icon):
    c=' '+cls+' '
    filled_blue=any(k in c for k in [' bg-link-theme-filled ',' bg-blue-6',' bg-blue-5',' bg-sky-6',' bg-sky-5',' bg-cta '])
    filled_red=any(k in c for k in [' bg-link-danger-filled ',' bg-red-6',' bg-red-5',' bg-rose-6',' bg-rose-7',' bg-status-error '])
    danger_text='text-status-error' in c or 'hover:text-status-error' in c
    border=re.search(r'(?<![\w:-])border(?:-\d)?(?![\w-])',cls) is not None
    theme_text='text-text-theme' in c and not filled_blue
    tonal_bg=re.search(r'(?<![\w:-])bg-(?:surface-secondary|link-standard|link-standard-hover|link-black-filled)(?![\w-])',cls) is not None
    theme_bg=re.search(r'(?<![\w:-])bg-(?:link-tonal|surface-theme)(?![\w-])',cls) is not None
    if filled_red: return ('danger','filled')
    if filled_blue: return ('superior','filled')
    if is_icon:
        h='danger' if danger_text else 'subordinate'
        return (h,'tonal' if (tonal_bg and h=='subordinate') else 'standard')
    if border:
        if danger_text: return ('danger','outlined')
        if theme_text: return ('superior','outlined')
        return ('subordinate','outlined')
    if theme_bg: return ('superior','tonal')
    if tonal_bg: return ('subordinate','tonal')
    if danger_text: return ('danger','text')
    if theme_text: return ('superior','text')
    txt=re.sub(r'<[^>]*>','',children).strip()
    if txt in ('取消','關閉','返回') or re.search(r"common\.(cancel|close)",children): return ('subordinate','tonal')
    if re.search(r'(?<![\w:-])p[xy]?-\d',cls): return ('subordinate','standard')
    return ('subordinate','text')
def convert_file(path, ui):
    s=open(path,encoding='utf-8').read()
    done=skipped=0; need=set()
    for st,en in sorted(_ranges(s,'button'),reverse=True):
        seg=s[st:en]; oe=_open_end(seg,0); tag=seg[:oe+1]
        if seg.endswith('/>') and not seg.endswith('</button>'): skipped+=1; continue
        children=seg[oe+1:-len('</button>')]
        if SKIP_ATTR.search(tag) or '<button' in children or '<div' in children or '<span' in children and children.count('<span')>1: skipped+=1; continue
        attrs=parse_attrs(tag)
        if attrs is None: skipped+=1; continue
        d=dict(attrs)
        cls_raw=d.get('className')
        if cls_raw is None: cls=''
        elif cls_raw.startswith('"'): cls=cls_raw[1:-1]
        else: skipped+=1; continue  # 動態 class：人工
        ch=children.strip()
        mi=re.fullmatch(ICON,ch)
        # {條件 ? <IconA /> : <IconB />}：只有圖示、依狀態換圖示
        mc=re.fullmatch(r'\{([^{}?]+?)\s*\?\s*('+ICON+r')\s*:\s*('+ICON+r')\s*\}',ch)
        is_icon=bool(mi or mc)
        if is_icon and 'aria-label' not in d and 'title' not in d: skipped+=1; continue
        lead=trail=None; label=ch
        if not is_icon:
            m=re.match(r'^'+ICON+r'\s*(.+)$',ch,re.S)
            if m and '<' not in m.group(2).replace('{','').split('}')[0][:0]:
                lead=m.group(1); label=m.group(2).strip()
            else:
                m2=re.match(r'^(.+?)\s*'+ICON+r'$',ch,re.S)
                if m2: trail=m2.group(2); label=m2.group(1).strip()
            if re.search(r'<(?!/?(?:b|strong|kbd)\b)[a-zA-Z]',label): skipped+=1; continue
        h,v=classify(cls,children,is_icon)
        keep=[c for c in cls.split() if LAYOUT.match(c) and c not in ('flex','inline-flex','block')]
        parts=[]
        for name,val in attrs:
            if name=='className': continue
            if name=='onClick': parts.append(f'onPress={val}'); continue
            if name=='type' and val=='"button"': continue
            if is_icon and name=='aria-label': parts.append(f'label={val}'); continue
            parts.append(name if val is None else f'{name}={val}')
        if 'type' not in d: parts.append('type="submit"')
        if is_icon and 'aria-label' not in d: parts.append(f'label={d["title"]}')
        hv=[]
        if h!='superior': hv.append(f'hierarchy="{h}"')
        if v!='filled': hv.append(f'variant="{v}"')
        if keep: hv.append(f'className="{" ".join(keep)}"')
        if is_icon:
            small=' size="small"' if re.search(r'size-(?:3|3\.5|4)\b',ch) else ''
            icon_expr=f'<{mi.group(1)} />' if mi else f'{mc.group(1).strip()} ? <{mc.group(3)} /> : <{mc.group(5)} />'
            new=f'<IconButton{small} {" ".join(hv+parts)} icon={{{icon_expr}}} />'.replace('  ',' ')
            need.add('IconButton')
        else:
            if lead: hv.append(f'leadingIcon={{<{lead} />}}')
            if trail: hv.append(f'trailingIcon={{<{trail} />}}')
            new=f'<Button {" ".join(hv+parts)}>{label}</Button>'
            need.add('Button')
        s=s[:st]+new+s[en:]; done+=1
    if done:
        open(path,'w',encoding='utf-8').write(s)
        ensure_import(path,sorted(need),ui)
    return done,skipped
if __name__=='__main__':
    root=os.path.abspath(sys.argv[1])  # frontend/src
    tot=[0,0]
    for p in sys.argv[2:]:
        rel=os.path.relpath(os.path.join(root,'components/ui'),os.path.dirname(os.path.abspath(p)))
        if not rel.startswith('.'): rel='./'+rel
        d,k=convert_file(p,rel); tot[0]+=d; tot[1]+=k
        if d or k: print(f'{p}: 轉換 {d}、跳過 {k}')
    print('合計 轉換',tot[0],'跳過',tot[1])

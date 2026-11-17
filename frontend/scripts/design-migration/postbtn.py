import re,sys,os
sys.path.insert(0,os.path.dirname(__file__))
from swap import _ranges,_open_end,ensure_import
ICON=r'<([A-Z]\w*)(?:\s+[^<>]*?)?\s*/>'
def fix(path,ui):
    s=open(path,encoding='utf-8').read(); n=0; need=set()
    for st,en in sorted(_ranges(s,'Button'),reverse=True):
        seg=s[st:en]
        if not seg.startswith('<Button ') or seg.endswith('/>') and not seg.endswith('</Button>'): continue
        oe=_open_end(seg,0); tag=seg[:oe+1]; ch=seg[oe+1:-len('</Button>')].strip()
        if 'leadingIcon=' in tag or 'trailingIcon=' in tag: continue
        m=re.fullmatch(ICON,ch,re.S)
        if m:
            lab=re.search(r'aria-label=(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")',tag) or re.search(r'\btitle=(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")',tag)
            if not lab: continue
            attrs=tag[len('<Button'):-1]
            attrs=re.sub(r'\s*aria-label=(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")','',attrs) if 'aria-label' in tag else attrs
            attrs=re.sub(r'variant="(text|outlined)"','variant="standard"',attrs) if 'variant="text"' in attrs else attrs
            if 'variant=' not in attrs: attrs+=' variant="filled"'
            s=s[:st]+f'<IconButton{attrs} label={lab.group(1)} icon={{<{m.group(1)} />}} />'+s[en:]; n+=1; need.add('IconButton'); continue
        m=re.match(r'^'+ICON+r'\s*(.*)$',ch,re.S)
        if m and m.group(2).strip() and not re.search(r'<[A-Za-z]',m.group(2)):
            s=s[:st]+tag[:-1]+f' leadingIcon={{<{m.group(1)} />}}>'+m.group(2).strip()+'</Button>'+s[en:]; n+=1
    if n:
        open(path,'w',encoding='utf-8').write(s)
        if need: ensure_import(path,sorted(need),ui)
    return n
root=os.path.abspath(sys.argv[1]); tot=0
for p in sys.argv[2:]:
    rel=os.path.relpath(os.path.join(root,'components/ui'),os.path.dirname(os.path.abspath(p)))
    if not rel.startswith('.'): rel='./'+rel
    tot+=fix(p,rel)
print('整理',tot)

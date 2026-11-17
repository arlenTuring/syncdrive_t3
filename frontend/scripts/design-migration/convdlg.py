"""把置中的自製對話框外框（fixed inset-0 遮罩＋面板 div）換成 <Dialog headerless padded={false}>。"""
import re,sys,os
sys.path.insert(0,os.path.dirname(__file__))
from swap import _open_end, ensure_import
def div_range(s,st):
    # balanced <div ...> ... </div>
    depth=0;i=st
    while i<len(s):
        if s.startswith('<div',i) and re.match(r'<div\b',s[i:]):
            oe=_open_end(s,i)
            if s[oe-1]!='/': depth+=1
            i=oe+1; continue
        if s.startswith('</div>',i):
            depth-=1; i+=6
            if depth==0: return i
            continue
        i+=1
    raise Exception('unbalanced')
def convert(path, ui, close_expr=None):
    s=open(path,encoding='utf-8').read(); n=0
    while True:
        m=re.search(r'<div\b[^>]*?className="[^"]*\bfixed inset-0\b[^"]*\bitems-center\b[^"]*"',s)
        if not m: break
        st=m.start(); oe=_open_end(s,st); outer=s[st:oe+1]
        en=div_range(s,st)
        inner=s[oe+1:en-6].strip()
        pm=re.match(r'<(div|section|form)\b',inner)
        if not pm: print(path,'no panel'); break
        tagname=pm.group(1)
        poe=_open_end(inner,0); ptag=inner[:poe+1]
        if tagname=='form': print(path,'panel is form, skip'); break
        close_tag=f'</{tagname}>'
        if not inner.endswith(close_tag): print(path,'panel not sole child'); break
        body=inner[poe+1:-len(close_tag)]
        pcls=re.search(r'className=(?:"([^"]*)"|\{`([^`]*)`\})',ptag)
        pc=(pcls.group(1) or pcls.group(2)) if pcls else ''
        width=' '.join(t for t in pc.split() if re.match(r'^(?:max-w-|w-\[|w-\d|w-full)',t)) or 'max-w-md'
        height=' '.join(t for t in pc.split() if re.match(r'^(?:h-\[|h-\d|max-h-)',t))
        # close handler: outer onMouseDown/onClick 裡呼叫的函式，或指定
        ce=close_expr
        if not ce:
            cm=re.search(r'on(?:MouseDown|Click)=\{[^}]*?(\w+(?:\?\.)?\([^()]*\))',outer)
            ce='() => '+cm.group(1) if cm else None
        if not ce:
            cm=re.search(r'\b(onClose|onCancel)\b',s)
            ce=cm.group(1) if cm else '() => {}'
        tm=re.search(r'<h[1-4][^>]*>(.*?)</h[1-4]>',body,re.S)
        title=tm.group(1).strip() if tm else '對話框'
        if not title.startswith('{'): title='{'+repr(title).replace("'",'"')+'}' if '<' not in title else '"對話框"'
        aria=re.search(r'aria-label=(\{[^}]*\}|"[^"]*")',ptag)
        if aria: title=aria.group(1)
        attrs=f'headerless padded={{false}} title={title} onClose={{{ce}}} widthClassName="{width}"'
        if height: attrs+=f' heightClassName="{height}"'
        layout=' '.join(t for t in pc.split() if re.match(r'^(?:p[xytblr]?-|gap-|space-y-|text-body|text-text)',t))
        if layout: body=f'\n<div className="{layout} flex min-h-0 flex-1 flex-col overflow-auto">{body}</div>\n'
        s=s[:st]+f'<Dialog {attrs}>{body}</Dialog>'+s[en:]; n+=1
    if n:
        open(path,'w',encoding='utf-8').write(s); ensure_import(path,['Dialog'],ui)
    return n
root=os.path.abspath(sys.argv[1])
for p in sys.argv[2:]:
    rel=os.path.relpath(os.path.join(root,'components/ui'),os.path.dirname(os.path.abspath(p)))
    if not rel.startswith('.'): rel='./'+rel
    print(p, convert(p,rel))

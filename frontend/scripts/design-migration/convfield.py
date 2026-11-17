import re,sys,os
sys.path.insert(0,os.path.dirname(__file__))
from swap import _ranges
from convbtn import LAYOUT
def conv(path):
    s=open(path,encoding='utf-8').read(); n=0
    for tag in ('SiteSelect','SiteDateTimeInput'):
        for st,en in sorted(_ranges(s,tag),reverse=True):
            seg=s[st:en]
            # 只動開頭標籤
            from swap import _open_end
            oe=_open_end(seg,0); open_tag=seg[:oe+1]
            if re.search(r'\bsize=',open_tag): continue
            m=re.search(r'className="([^"]*)"',open_tag)
            if not m: continue
            cls=m.group(1).split()
            if not any(re.match(r'^(?:bg-|border|rounded|h-\d|px-|py-|text-body)',c) for c in cls): continue
            size='sm' if any(c in ('h-8','h-7','py-1','py-0.5','text-body-xs') for c in cls) else 'md'
            keep=[c for c in cls if LAYOUT.match(c) and c not in ('flex','inline-flex','block')]
            keep=[c for c in keep if not re.match(r'^(?:h-|min-h-)',c)]
            if 'font-mono' in cls: keep.append('font-mono')
            new_tag=open_tag.replace(m.group(0),f'size="{size}"'+(f' className="{" ".join(keep)}"' if keep else ''))
            s=s[:st]+new_tag+seg[oe+1:]+s[en:]; n+=1
    if n: open(path,'w',encoding='utf-8').write(s)
    return n
tot=0
for p in sys.argv[1:]: tot+=conv(p)
print('欄位',tot)

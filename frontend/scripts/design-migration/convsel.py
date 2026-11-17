import re,sys,os
sys.path.insert(0,os.path.dirname(__file__))
from swap import _ranges, ensure_import
from convbtn import parse_attrs
def conv(path,ui):
    s=open(path,encoding='utf-8').read(); n=0; need=set(); skip=0
    for st,en in sorted(_ranges(s,'input'),reverse=True):
        tag=s[st:en]
        if 'type="checkbox"' not in tag and 'type="radio"' not in tag: continue
        attrs=parse_attrs(tag.replace('<input','<button',1).rstrip('/>')+'>') if False else None
        body='<button'+tag[len('<input'):]
        if body.endswith('/>'): body=body[:-2]+'>'
        attrs=parse_attrs(body)
        if attrs is None or any(k in ('ref','role','indeterminate') for k,_ in attrs) or '{...' in tag: skip+=1; continue
        radio='type="radio"' in tag
        parts=[]
        for k,v in attrs:
            if k in ('type','className'): continue
            if k=='onChange' and not radio:
                m=re.fullmatch(r'\{\s*\(?(\w+)\)?\s*=>\s*(.*)\}',v,re.S)
                if m and f'{m.group(1)}.target.checked' in m.group(2) and len(re.findall(r'\b'+m.group(1)+r'\b',m.group(2)))==m.group(2).count(f'{m.group(1)}.target.checked'):
                    v='{(checked) => '+m.group(2).replace(f'{m.group(1)}.target.checked','checked')+'}'
                elif m and re.search(r'\b'+m.group(1)+r'\b',m.group(2)):
                    skip+=1; parts=None; break
                parts.append(f'onCheckedChange={v}'); continue
            parts.append(k if v is None else f'{k}={v}')
        if parts is None: continue
        if not radio and not any(p.startswith('checked') for p in parts): skip+=1; continue
        comp='Radio' if radio else 'Checkbox'
        need.add(comp)
        s=s[:st]+f'<{comp} '+' '.join(parts)+' />'+s[en:]; n+=1
    if n: open(path,'w',encoding='utf-8').write(s); ensure_import(path,sorted(need),ui)
    return n,skip
root=os.path.abspath(sys.argv[1])
for p in sys.argv[2:]:
    rel=os.path.relpath(os.path.join(root,'components/ui'),os.path.dirname(os.path.abspath(p)))
    if not rel.startswith('.'): rel='./'+rel
    r=conv(p,rel)
    if r!=(0,0): print(p,r)

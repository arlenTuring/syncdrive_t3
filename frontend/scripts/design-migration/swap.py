"""swap(path, marker, new): 把「包含 marker 的那一個」<button ...>...</button>（或自閉合標籤）整段換成 new。
找法：列出每個 <tag 起點，算出它自己的範圍（開頭標籤以大括號深度判斷結尾；非自閉合再找第一個 </tag>），
只換範圍內含有 marker、且範圍最小的那一個。找不到或有歧義就丟例外，不會亂換。"""
import re
def _open_end(s,i):
    depth=0;j=i
    while j<len(s):
        c=s[j]
        if c=='{':depth+=1
        elif c=='}':depth-=1
        elif depth==0 and c=='>':return j
        j+=1
    raise Exception('no tag end')
def _ranges(s,tag):
    out=[]
    for m in re.finditer('<'+tag+r'\b',s):
        st=m.start(); oe=_open_end(s,st)
        if s[oe-1]=='/': en=oe+1
        else:
            c=s.find('</'+tag+'>',oe)
            nxt=s.find('<'+tag,oe)
            if c<0 or (0<=nxt<c and re.match('<'+tag+r'\b',s[nxt:])): continue  # 巢狀，略過
            en=c+len('</'+tag+'>')
        out.append((st,en))
    return out
def swap(path, marker, new, tag='button'):
    s=open(path,encoding='utf-8').read()
    hits=[(st,en) for st,en in _ranges(s,tag) if marker in s[st:en]]
    assert hits,(path,marker)
    st,en=min(hits,key=lambda r:r[1]-r[0])
    s=s[:st]+new+s[en:]
    open(path,'w',encoding='utf-8').write(s)
    return True
def ensure_import(path, names, src):
    s=open(path,encoding='utf-8').read()
    m=re.search(r"import \{([^}]*)\} from '"+re.escape(src)+"';",s)
    if m:
        have=[x.strip() for x in m.group(1).split(',') if x.strip()]
        allnames=sorted(set(have)|set(names), key=lambda x:x.replace('type ','').lower())
        s=s.replace(m.group(0),"import { "+", ".join(allnames)+" } from '"+src+"';")
    else:
        lines=s.split('\n'); idx=max(i for i,l in enumerate(lines[:60]) if l.startswith('import '))
        while not lines[idx].rstrip().endswith(';') and not lines[idx].rstrip().endswith("'"): idx+=1
        lines.insert(idx+1,"import { "+", ".join(sorted(names))+" } from '"+src+"';"); s='\n'.join(lines)
    open(path,'w',encoding='utf-8').write(s)

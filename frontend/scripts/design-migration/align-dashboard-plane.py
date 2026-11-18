"""把一份儀表板版面（dashboard_planes 的一列）轉成「字型、字級、字重、顏色對齊設計規格」的複本。
用法：python3 align-dashboard-plane.py <原版 row_to_json.json> <輸出.json> <新 planeId> [新名稱]
  原版取得：psql -Atc "SELECT row_to_json(p) FROM dashboard_planes p WHERE plane_id='…'" > orig.json
  輸出是 PUT /syncdrive-api/dashboard/planes/<planeId> 的 body（只存這一份，不動其他版面）。
規則：
- fontFamily → 規格字型 Noto Sans TC；字級對齊字級表（8,10,12,14,16,18,20,24,28,32,36,46,57，平手取大）
- 字重：normal→400；bold→依字級的粗體字重（≤20px 500、24/28/36px 600、其餘 700）
- 顏色：本來就是設計稿色票→不動；與語意色 CIEDE2000 ≤4→語意色；其餘→最接近的設計稿色票（保留透明度）
只改版面資料；元件程式裡寫死的字型、顏色不在這裡。"""
import json,re,sys,math,collections,uuid
import os
TOK=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','src','styles','design-tokens.css'),encoding='utf-8').read()
pal={m.group(1):m.group(2).lower() for m in re.finditer(r'--color-([a-z]+-\d+|white-100|black-100):\s*(#[0-9A-Fa-f]{6})',TOK)}
def hex2rgb(h): h=h.lstrip('#'); h=''.join(c*2 for c in h) if len(h)==3 else h; return tuple(int(h[i:i+2],16) for i in (0,2,4))
# semantic tokens resolved (solid ones and alpha ones)
sem={}
for m in re.finditer(r'^\s*--([a-z-]+):\s*(.+?);',TOK.split(':root {')[1].split('}')[0],re.M):
    name,val=m.group(1),m.group(2)
    a=re.match(r'var\(--color-([a-z]+-\d+|white-100|black-100)\)',val)
    b=re.match(r'rgb\(from var\(--color-([a-z]+-\d+)\) r g b / (\d+)%\)',val)
    c=re.match(r'(#[0-9A-Fa-f]{6})',val)
    if a and a.group(1) in pal: sem[name]=(hex2rgb(pal[a.group(1)]),1.0)
    elif b and b.group(1) in pal: sem[name]=(hex2rgb(pal[b.group(1)]),int(b.group(2))/100)
    elif c: sem[name]=(hex2rgb(c.group(1)),1.0)
def lab(rgb):
    def f(c):
        c/=255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
    r,g,b=map(f,rgb); x=(0.4124*r+0.3576*g+0.1805*b)/0.95047; y=0.2126*r+0.7152*g+0.0722*b; z=(0.0193*r+0.1192*g+0.9505*b)/1.08883
    g_=lambda t:t**(1/3) if t>0.008856 else 7.787*t+16/116
    return (116*g_(y)-16,500*(g_(x)-g_(y)),200*(g_(y)-g_(z)))
def dE(a,b):
    # CIEDE2000
    L1,a1,b1=lab(a); L2,a2,b2=lab(b)
    C1=math.hypot(a1,b1); C2=math.hypot(a2,b2); Cb=(C1+C2)/2
    G=0.5*(1-math.sqrt(Cb**7/(Cb**7+25**7)))
    a1p,a2p=(1+G)*a1,(1+G)*a2; C1p,C2p=math.hypot(a1p,b1),math.hypot(a2p,b2)
    h1p=math.degrees(math.atan2(b1,a1p))%360; h2p=math.degrees(math.atan2(b2,a2p))%360
    dLp=L2-L1; dCp=C2p-C1p
    dhp=0 if C1p*C2p==0 else (h2p-h1p if abs(h2p-h1p)<=180 else (h2p-h1p-360 if h2p>h1p else h2p-h1p+360))
    dHp=2*math.sqrt(C1p*C2p)*math.sin(math.radians(dhp/2))
    Lbp=(L1+L2)/2; Cbp=(C1p+C2p)/2
    hbp=h1p+h2p if C1p*C2p==0 else ((h1p+h2p)/2 if abs(h1p-h2p)<=180 else ((h1p+h2p+360)/2 if h1p+h2p<360 else (h1p+h2p-360)/2))
    T=1-0.17*math.cos(math.radians(hbp-30))+0.24*math.cos(math.radians(2*hbp))+0.32*math.cos(math.radians(3*hbp+6))-0.20*math.cos(math.radians(4*hbp-63))
    dth=30*math.exp(-((hbp-275)/25)**2); RC=2*math.sqrt(Cbp**7/(Cbp**7+25**7))
    SL=1+0.015*(Lbp-50)**2/math.sqrt(20+(Lbp-50)**2); SC=1+0.045*Cbp; SH=1+0.015*Cbp*T; RT=-math.sin(math.radians(2*dth))*RC
    return math.sqrt((dLp/SL)**2+(dCp/SC)**2+(dHp/SH)**2+RT*(dCp/SC)*(dHp/SH))
solid_sem=[(n,rgb) for n,(rgb,al) in sem.items() if al==1.0]
palette=[(n,hex2rgb(h)) for n,h in pal.items()]
def snap(rgb,alpha):
    # 1) 語意色（完全不透明且輸入也不透明） 2) 設計稿色票
    best=None
    exact=[(n,c) for n,c in palette if c==tuple(rgb)]
    if exact: return ('pal(原色):'+exact[0][0],exact[0][1])
    if alpha>=0.999:
        n,c=min(solid_sem,key=lambda t:dE(t[1],rgb))
        if dE(c,rgb)<=4: best=('sem:'+n,c)
    if not best:
        n,c=min(palette,key=lambda t:dE(t[1],rgb)); best=('pal:'+n,c)
    return best
def fmt(c,alpha,orig):
    if alpha>=0.999 and not orig.startswith('rgb'): return '#%02X%02X%02X'%c
    if alpha>=0.999: return 'rgb(%d, %d, %d)'%c
    return 'rgba(%d, %d, %d, %s)'%(c[0],c[1],c[2],('%g'%round(alpha,3)))
changes=collections.Counter()
COLOR=re.compile(r'#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)')
def recolor(s):
    def rep(m):
        t=m.group(0)
        if t.startswith('#'): rgb=hex2rgb(t); al=1.0
        else:
            nums=[float(x) for x in re.findall(r'[\d.]+',t)]; rgb=tuple(int(v) for v in nums[:3]); al=nums[3] if len(nums)>3 else 1.0
        name,c=snap(rgb,al); new=fmt(c,al,t)
        if new.lower().replace(' ','')!=t.lower().replace(' ',''): changes[f'{t} → {new} ({name})']+=1
        return new
    return COLOR.sub(rep,s)
SCALE=[8,10,12,14,16,18,20,24,28,32,36,46,57]
def snap_size(v):
    return min(SCALE,key=lambda s:(abs(s-v),-s))
def bold_weight(size):
    return 500 if size<=20 else 600 if size in (24,28,36) else 700
FONT="'Noto Sans TC Variable', 'Noto Sans TC', sans-serif"
fontch=collections.Counter()
def walk(x,parent=None):
    if isinstance(x,dict):
        size=None
        for k,v in list(x.items()):
            if isinstance(v,(int,float)) and not isinstance(v,bool) and re.search(r'fontsize$',k.lower()):
                ns=snap_size(v)
                if ns!=v: fontch[f'{k} {v}→{ns}']+=1; x[k]=ns
        for k,v in list(x.items()):
            if isinstance(v,str):
                if k.lower().endswith('fontfamily') or k=='fontFamily':
                    if v!=FONT: fontch[f'{k}: {v[:30]} → 規格字型']+=1; x[k]=FONT
                elif k.lower().endswith('fontweight') or k=='fontWeight':
                    sizek=k[:-len('FontWeight')]+'FontSize' if k!='fontWeight' else 'fontSize'
                    sz=x.get(sizek, x.get('fontSize',16)) if isinstance(x.get(sizek, x.get('fontSize',16)),(int,float)) else 16
                    w={'normal':400,'bold':bold_weight(sz),'lighter':400,'bolder':bold_weight(sz)}.get(v)
                    if w is None and v.isdigit(): w=int(v); w=400 if w<450 else (500 if w<550 else (600 if w<650 else 700))
                    if w is not None and str(w)!=v: fontch[f'{k}: {v} → {w}']+=1; x[k]=str(w)
                else:
                    x[k]=recolor(v)
            else: walk(v,x)
    elif isinstance(x,list):
        for i,v in enumerate(x):
            if isinstance(v,str): x[i]=recolor(v)
            else: walk(v,x)
src=json.load(open(sys.argv[1]))
els=src['elements']; walk(els)
out={'planeId':sys.argv[3],'name':sys.argv[4] if len(sys.argv)>4 else src['name']+'-規格對齊','width':src['width'],'height':src['height'],'viewportMode':src['viewport_mode'],'elements':els,'dataSettings':src.get('data_settings') or {'sourceMap':{}}}
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False)
print('colour changes',sum(changes.values()),'distinct',len(changes))
for k,v in changes.most_common(60): print(' ',v,k)
print('font changes',sum(fontch.values()))
for k,v in fontch.most_common(30): print(' ',v,k)

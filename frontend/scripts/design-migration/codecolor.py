"""把程式裡寫死的顏色換成設計稿顏色（規則見 speccolor.py）。
用法：python3 codecolor.py [--dry] <檔案…>
只動字串裡的顏色；不要用在資料遷移檔（utils/migrate*）——它們拿顏色比對已存的資料。"""
import sys,os,re
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import speccolor
dry='--dry' in sys.argv
total=0
for p in [a for a in sys.argv[1:] if not a.startswith('--')]:
    s=open(p,encoding='utf-8').read()
    before=sum(speccolor.changes.values())
    # 只處理字串常值（'…'、"…"、`…`）裡的顏色，避免碰到註解以外的程式碼
    out=re.sub(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`(?:[^`\\]|\\.)*`", lambda m: speccolor.recolor(m.group(0)), s)
    n=sum(speccolor.changes.values())-before
    if n:
        total+=n; print(p,n)
        if not dry: open(p,'w',encoding='utf-8').write(out)
print('合計',total)

"""把程式裡寫死的字型（system-ui、-apple-system、monospace、ui-monospace…）換成規格字型常數 FONT_FAMILY_PRIMARY。
用法：python3 specfont.py <檔案…>；會自動補 import（src/styles/tokens）。"""
import re,sys,os
STACK=r"(?P<q>['\"])(?:system-ui|-apple-system|ui-monospace|monospace|SFMono-Regular|Menlo)(?:(?!(?P=q))[^\n])*(?P=q)"
def rel_import(path):
    root=os.path.abspath('src'); r=os.path.relpath(os.path.join(root,'styles','tokens'),os.path.dirname(os.path.abspath(path)))
    return r if r.startswith('.') else './'+r
def convert(path):
    s=open(path,encoding='utf-8').read(); o=s
    s=re.sub(r'fontFamily=\{?'+STACK+r'\}?', 'fontFamily={FONT_FAMILY_PRIMARY}', s)
    s=re.sub(r'(fontFamily\s*:\s*)'+STACK, r'\1FONT_FAMILY_PRIMARY', s)
    s=re.sub(r'(const\s+FONT\w*\s*=\s*)'+STACK, r'\1FONT_FAMILY_PRIMARY', s)
    s=re.sub(r'(\?\?\s*|\|\|\s*|\?\s*|:\s*)'+STACK, r'\1FONT_FAMILY_PRIMARY', s)
    if s==o: return 0
    if 'FONT_FAMILY_PRIMARY' not in o:
        imp=f"import {{ FONT_FAMILY_PRIMARY }} from '{rel_import(path)}';\n"
        # 插在最後一個頂層 import 敘述之後（import 可能跨多行，以「from '…';」或「';」結尾）
        pos=0
        for m in re.finditer(r"^import\b[\s\S]*?from\s+['\"][^'\"]+['\"];?[ \t]*\n|^import\s+['\"][^'\"]+['\"];?[ \t]*\n",s,re.M):
            if m.start()>pos+2000: break
            pos=m.end()
        s=s[:pos]+imp+s[pos:]
    open(path,'w',encoding='utf-8').write(s)
    return len(re.findall('FONT_FAMILY_PRIMARY',s))-len(re.findall('FONT_FAMILY_PRIMARY',o))
if __name__=='__main__':
    t=0
    for p in sys.argv[1:]:
        n=convert(p); t+=n
        if n: print(p,n)
    print('合計',t)

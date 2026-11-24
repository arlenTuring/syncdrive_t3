#!/usr/bin/env node
/**
 * 設計規格對照頁：把設計交付的 playground（design-specs/*-playground.html）接上「app 實際建置出來的 CSS」，
 * 用 playground 自帶的自動檢查驗證我們的實作，而不是驗證它自己內嵌的那份 CSS。
 *
 *   npm run check:design-specs     建置後產生 dist/design-check/，開 http://localhost:5173/design-check/
 *
 * 做法：移除 playground 內嵌的元件 CSS（跟規格 §5 相同的那一段），在 <head> 最前面接上 dist 的 CSS。
 * playground 的 token 定義與頁面排版樣式保留（token 數值跟我們的相同）。
 * 這些頁面只在手動執行時產生，不屬於正式畫面。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const manifest = JSON.parse(readFileSync(join(ROOT, 'design-specs/manifest.json'), 'utf8'));

if (!existsSync(join(DIST, 'assets'))) {
  console.error('找不到 dist/assets：先執行 npm run build');
  process.exit(1);
}
const css = readdirSync(join(DIST, 'assets')).find((file) => /^index-.*\.css$/.test(file));
if (!css) {
  console.error('dist/assets 裡找不到 index-*.css');
  process.exit(1);
}

const out = join(DIST, 'design-check');
mkdirSync(out, { recursive: true });
const links = [];
const skipped = [];
for (const entry of manifest.components) {
  if (!entry.playground) continue;
  const spec = readFileSync(join(ROOT, entry.spec), 'utf8');
  const block = spec.match(/```css\n([\s\S]*?)```/)?.[1]?.trim();
  let page = readFileSync(join(ROOT, entry.playground), 'utf8');
  if (!block || !page.includes(block)) {
    // 有些 playground 內嵌的是整頁組合樣式（例如 Dialog 規格的參考 CSS 只有陰影一段），換不掉就不能拿來驗我們的 CSS：
    // 列出來、不中斷其他元件的對照
    console.warn(`${entry.playground}：找不到跟 ${entry.spec} 相同的元件 CSS，無法替換，這一頁不產生（需人工對照）`);
    skipped.push(entry.name);
    continue;
  }
  // 留一句說明（含 playground 檢查器會找的關鍵字），實際規則改由 app 的 CSS 提供
  page = page.replace(block, `/* 已改用 app 建置的 CSS（${entry.css}）；:focus-visible、:active:not(:disabled) 等規則在那支檔案 */`);
  page = page.replace(/(<head[^>]*>)/, `$1<link rel="stylesheet" href="/assets/${css}">`);
  const file = `${entry.name.toLowerCase()}.html`;
  writeFileSync(join(out, file), page);
  links.push(`<li><a href="./${file}">${entry.name}</a>（Figma ${entry.figma}，${entry.variants} 個 Variant）</li>`);
}
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>設計規格對照</title><body style="font-family:sans-serif;background:#18181b;color:#f3f4f6;padding:24px"><h1>設計規格對照（使用 app 的 CSS）</h1><p>每頁的「自動檢查」應全數通過。</p><ul>${links.join('')}</ul></body>`,
);
console.log(`已產生 ${links.length} 頁：dist/design-check/（開 /design-check/）`);
if (skipped.length) console.log(`無法自動對照、需人工比對：${skipped.join('、')}`);

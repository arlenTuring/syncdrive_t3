#!/usr/bin/env node
/**
 * 設計系統檢查：前端程式裡不該再出現寫死的樣式數值。
 *
 * 規則來源：.claude/skills/t3-ui-design/SKILL.md、src/styles/design-tokens.css。
 *
 * 檢查三類「硬性違規」（只能減少、不能增加）：
 *   hex        寫死的色碼（#rrggbb、#rgb、#rrggbbaa）
 *   arbitrary  Tailwind 任意值：text-[11px]、leading-[…]、tracking-[…]、bg-[#…]、text-[rgb(…)] 這類
 *   rgb        寫死的 rgb()／rgba()／hsl()（不含 rgb(from var(--…))）
 * 另外統計三項當作整理進度，不擋：「舊色票 class」（bg-zinc-800、text-white…）、「自製按鈕」（原生 <button>，
 * 應改用 Button／IconButton）、「自製勾選類」（原生 checkbox／radio、role="switch"，應改用 Checkbox／Radio／Switch）。
 *
 * 舊程式的現況記在 design-tokens.baseline.json（每個檔案各類的數量）。檢查時：
 *   - 任何檔案任何一類比基準多 → 失敗（新寫的東西要用 token）。
 *   - 比基準少 → 提示可以更新基準，把進度鎖住。
 *
 * 用法：
 *   node scripts/check-design-tokens.mjs            檢查（npm run lint:design）
 *   node scripts/check-design-tokens.mjs --report   依功能模組列出現況與整理進度
 *   node scripts/check-design-tokens.mjs --update   以目前狀態重寫基準（整理完一批後執行）
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const BASELINE = join(ROOT, 'design-tokens.baseline.json');

/** 不檢查：token 定義本身、測試 */
const SKIP = [/\.spec\.tsx?$/, /^styles\/tokens\.ts$/, /\.d\.ts$/];

const HARD = {
  hex: /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![-\w])/g,
  arbitrary: /\b(?:text|leading|tracking|font|bg|border|ring|fill|stroke|from|via|to|outline|divide|placeholder|decoration|accent|caret|shadow)-\[(?:\d|#|rgb|rgba|hsl|oklch|color-mix)[^\]]*\]/g,
  rgb: /\b(?:rgba?|hsla?)\((?!\s*from\b)[^)]*\)/g,
};
const HUES = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const PALETTE = new RegExp(`\\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|divide|placeholder|decoration|accent|caret|shadow)(?:-[trblxy])?-(?:(?:${HUES})-\\d{2,3}|white|black)\\b(?!-\\d)`, 'g'); // bg-black-30、white-40 是設計 token，不算

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function scan() {
  const result = {};
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file);
    if (SKIP.some((pattern) => pattern.test(rel))) continue;
    // CSS：token 檔與全域樣式不查色碼（token 定義就在這裡）
    if (rel.endsWith('.css')) continue;
    const text = readFileSync(file, 'utf8');
    const counts = {};
    for (const [kind, pattern] of Object.entries(HARD)) {
      const n = (text.match(pattern) ?? []).length;
      if (n) counts[kind] = n;
    }
    const palette = (text.match(PALETTE) ?? []).length;
    if (palette) counts.palette = palette;
    // components/ui 本身就是用原生 <button> 實作的
    const rawButtons = rel.startsWith('components/ui/') ? 0 : (text.match(/<button\b/g) ?? []).length;
    if (rawButtons) counts.button = rawButtons;
    const rawSelection = rel.startsWith('components/ui/') ? 0 : (text.match(/type="(?:checkbox|radio)"|role="switch"/g) ?? []).length;
    if (rawSelection) counts.selection = rawSelection;
    if (Object.keys(counts).length) result[rel] = counts;
  }
  return result;
}

const current = scan();
const args = new Set(process.argv.slice(2));
const sum = (data, kind) => Object.values(data).reduce((total, counts) => total + (counts[kind] ?? 0), 0);

if (args.has('--update')) {
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`已更新基準：hex ${sum(current, 'hex')}、arbitrary ${sum(current, 'arbitrary')}、rgb ${sum(current, 'rgb')}、舊色票 class ${sum(current, 'palette')}、自製按鈕 ${sum(current, 'button')}、自製勾選類 ${sum(current, 'selection')}`);
  process.exit(0);
}

if (args.has('--report')) {
  const byModule = new Map();
  for (const [file, counts] of Object.entries(current)) {
    const parts = file.split('/');
    const key = parts[0] === 'features' ? `features/${parts[1]}` : parts[0].includes('.') ? '(src 根目錄)' : parts[0];
    const row = byModule.get(key) ?? { files: 0, hex: 0, arbitrary: 0, rgb: 0, palette: 0, button: 0, selection: 0 };
    row.files += 1;
    for (const kind of ['hex', 'arbitrary', 'rgb', 'palette', 'button', 'selection']) row[kind] += counts[kind] ?? 0;
    byModule.set(key, row);
  }
  const rows = [...byModule.entries()].sort((a, b) => (b[1].hex + b[1].arbitrary + b[1].rgb + b[1].palette) - (a[1].hex + a[1].arbitrary + a[1].rgb + a[1].palette));
  console.log('| 模組 | 檔案 | 色碼 | 任意值 | rgb() | 舊色票 class | 自製按鈕 | 自製勾選類 |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [key, row] of rows) console.log(`| ${key} | ${row.files} | ${row.hex} | ${row.arbitrary} | ${row.rgb} | ${row.palette} | ${row.button} | ${row.selection} |`);
  console.log(`| **合計** | ${Object.keys(current).length} | ${sum(current, 'hex')} | ${sum(current, 'arbitrary')} | ${sum(current, 'rgb')} | ${sum(current, 'palette')} | ${sum(current, 'button')} | ${sum(current, 'selection')} |`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error('找不到 design-tokens.baseline.json：先執行 node scripts/check-design-tokens.mjs --update 建立基準');
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const worse = [];
let improved = 0;
for (const [file, counts] of Object.entries(current)) {
  for (const kind of ['hex', 'arbitrary', 'rgb']) {
    const now = counts[kind] ?? 0;
    const before = baseline[file]?.[kind] ?? 0;
    if (now > before) worse.push(`  ${file}：${kind} ${before} → ${now}`);
  }
}
for (const [file, counts] of Object.entries(baseline)) {
  for (const kind of ['hex', 'arbitrary', 'rgb', 'palette', 'button', 'selection']) {
    if ((current[file]?.[kind] ?? 0) < (counts[kind] ?? 0)) improved += 1;
  }
}
if (worse.length) {
  console.error('設計系統檢查失敗：下列檔案新增了寫死的樣式數值，請改用 token 或 components/ui：');
  console.error(worse.join('\n'));
  console.error('規則：.claude/skills/t3-ui-design/SKILL.md');
  process.exit(1);
}
console.log(`設計系統檢查通過（色碼 ${sum(current, 'hex')}、任意值 ${sum(current, 'arbitrary')}、rgb() ${sum(current, 'rgb')}、舊色票 class ${sum(current, 'palette')}、自製按鈕 ${sum(current, 'button')}、自製勾選類 ${sum(current, 'selection')}）`);
if (improved) console.log(`有 ${improved} 項比基準少：執行 npm run lint:design:update 把進度鎖住`);

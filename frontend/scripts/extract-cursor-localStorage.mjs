#!/usr/bin/env node
/**
 * 從 Cursor 內建瀏覽器 LevelDB 擷取 syncdrive_dashboard_planes
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ldbDir = resolve(
  homedir(),
  'Library/Application Support/Cursor/Partitions/cursor-browser/Local Storage/leveldb',
);
const outPath = resolve(__dirname, '../src/features/dashboard/constants/demoPlane.snapshot.json');

const KEY = 'syncdrive_dashboard_planes';
let blob = '';
for (const name of readdirSync(ldbDir)) {
  if (!name.endsWith('.ldb') && !name.endsWith('.log')) continue;
  try {
    blob += readFileSync(resolve(ldbDir, name), 'latin1');
  } catch {
    /* skip */
  }
}

const marker = KEY;
const idx = blob.indexOf(marker);
if (idx === -1) {
  console.error(`找不到 ${KEY}`);
  process.exit(1);
}

// Chromium localStorage value 通常緊接在 key 之後為 JSON 陣列
const after = blob.slice(idx + marker.length);
const start = after.indexOf('[');
if (start === -1) {
  console.error('找不到 JSON 陣列起始');
  process.exit(1);
}

let depth = 0;
let end = -1;
for (let i = start; i < after.length; i++) {
  const ch = after[i];
  if (ch === '[') depth++;
  else if (ch === ']') {
    depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}

if (end === -1) {
  console.error('JSON 陣列未完整');
  process.exit(1);
}

const raw = after.slice(start, end);
let planes;
try {
  planes = JSON.parse(raw);
} catch (e) {
  console.error('JSON 解析失敗', e.message);
  process.exit(1);
}

const demo = planes.find((p) => p.id === 'demo-plane') ?? planes[0];
writeFileSync(outPath, JSON.stringify(demo, null, 2), 'utf8');
console.log(`Wrote ${outPath}`);
console.log(`  elements: ${demo.elements?.length ?? 0}, version: ${demo.demoLayoutVersion ?? '?'}`);

#!/usr/bin/env node
/**
 * 將匯出的載具 JSON 寫入種子檔（納入版控、新環境自動載入）。
 *
 * 用法：
 *   node frontend/scripts/import-vehicle-seed.mjs ~/Downloads/syncdrive-vehicles-2026-06-02.json
 *   node frontend/scripts/import-vehicle-seed.mjs ./my-vehicle.json --merge
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(__dirname, '../public/vehicle-editor/seed/vehicles.json');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const merge = process.argv.includes('--merge');
const inputPath = args[0];

if (!inputPath) {
  console.error('請指定匯出的 JSON 檔案路徑');
  process.exit(1);
}

function parseList(raw) {
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : [data];
}

const incoming = parseList(readFileSync(resolve(inputPath), 'utf8'));
let output = incoming;

if (merge) {
  try {
    const existing = parseList(readFileSync(SEED_PATH, 'utf8'));
    const ids = new Set(existing.map((v) => v.id));
    const toAdd = incoming.filter((v) => v?.id && !ids.has(v.id));
    output = [...existing, ...toAdd];
  } catch {
    output = incoming;
  }
}

writeFileSync(SEED_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`已寫入 ${output.length} 份載具 → ${SEED_PATH}`);

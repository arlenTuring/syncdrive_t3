/**
 * 非 D/U 軌道、設施、圍籬：參照場域範圍設為 0；D/U 軌道與號誌不變。
 *
 * 執行：node frontend/scripts/zero-non-du-ref-fields.mjs [map.json]
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultMapPath = join(__dirname, '../public/maps/t3-main-version.json');
const mapPath = process.argv[2] ? join(process.cwd(), process.argv[2]) : defaultMapPath;
const MAP_SEED_PATH = join(__dirname, '../public/maps-seed/完成版本.json');

const ZERO_BOUNDS = {
  refFieldXMinM: 0,
  refFieldXMaxM: 0,
  refFieldYMinM: 0,
  refFieldYMaxM: 0,
};

function normalizeDu(name) {
  if (!name || typeof name !== 'string') return null;
  const t = name.trim().toUpperCase();
  const d = /^D(\d{1,2})$/.exec(t);
  if (d) return `D${String(Number(d[1])).padStart(2, '0')}`;
  const u = /^U(\d{1,2})$/.exec(t);
  if (u) return `U${String(Number(u[1])).padStart(2, '0')}`;
  return null;
}

function isDuTrack(f) {
  if (f.type !== 'Track') return false;
  return !!(
    normalizeDu(f.customName) ||
    normalizeDu(f.parameters?.segmentId)
  );
}

function shouldZeroBounds(f) {
  if (f.type === 'Signal') return false;
  if (isDuTrack(f)) return false;
  if (f.type === 'Track' || f.type === 'Facility' || f.type === 'Geofence') return true;
  return false;
}

const map = JSON.parse(readFileSync(mapPath, 'utf8'));
let changed = 0;

for (const area of map.areas ?? []) {
  for (const f of area.facilities ?? []) {
    if (!shouldZeroBounds(f)) continue;
    f.parameters = { ...(f.parameters ?? {}), ...ZERO_BOUNDS };
    changed++;
  }
}

writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n');
try {
  writeFileSync(MAP_SEED_PATH, readFileSync(mapPath, 'utf8'));
} catch {
  /* seed optional */
}

console.log(`Map: ${mapPath}`);
console.log(`Zeroed refField bounds on ${changed} facilities (kept D/U tracks + Signals).`);

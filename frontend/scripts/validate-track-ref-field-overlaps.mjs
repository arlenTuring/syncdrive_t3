/**
 * 稽核地圖 Track refField 是否有內部重疊（重疊視為地圖資料錯）。
 *
 * 執行：node frontend/scripts/validate-track-ref-field-overlaps.mjs [map.json]
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultMapPath = join(__dirname, '../public/maps/t3-main-version.json');
const mapPath = process.argv[2] ? join(process.cwd(), process.argv[2]) : defaultMapPath;

const REF_KEYS = ['refFieldXMinM', 'refFieldXMaxM', 'refFieldYMinM', 'refFieldYMaxM'];

function readBounds(params) {
  const vals = REF_KEYS.map((k) => params?.[k]);
  if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const [xMinM, xMaxM, yMinM, yMaxM] = vals;
  if (xMaxM <= xMinM || yMaxM <= yMinM) return null;
  return { xMinM, xMaxM, yMinM, yMaxM };
}

function trackLabel(track) {
  return track.customName || track.parameters?.segmentId || track.id;
}

function overlapLength(aMin, aMax, bMin, bMax) {
  const lo = Math.max(aMin, bMin);
  const hi = Math.min(aMax, bMax);
  return Math.max(0, hi - lo);
}

function overlapArea(a, b) {
  const w = overlapLength(a.xMinM, a.xMaxM, b.xMinM, b.xMaxM);
  const h = overlapLength(a.yMinM, a.yMaxM, b.yMinM, b.yMaxM);
  return w * h;
}

function collectSegments(map) {
  const segments = [];
  for (const area of map.areas ?? []) {
    for (const track of area.facilities ?? []) {
      if (track.type !== 'Track') continue;
      const bounds = readBounds(track.parameters);
      if (!bounds) continue;
      segments.push({
        areaId: area.id,
        trackId: track.id,
        label: trackLabel(track),
        bounds,
      });
    }
  }
  return segments;
}

const raw = JSON.parse(readFileSync(mapPath, 'utf8'));
const segments = collectSegments(raw);
const overlaps = [];

for (let i = 0; i < segments.length; i++) {
  for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i];
    const b = segments[j];
    const area = overlapArea(a.bounds, b.bounds);
    if (area > 1e-6) {
      overlaps.push({
        a: `${a.label} (${a.trackId})`,
        b: `${b.label} (${b.trackId})`,
        areaM2: area,
      });
    }
  }
}

console.log(`Map: ${mapPath}`);
console.log(`Track segments with refField: ${segments.length}`);
console.log(`Overlaps (area > 1e-6 m²): ${overlaps.length}`);

if (overlaps.length > 0) {
  for (const o of overlaps.slice(0, 20)) {
    console.log(`  ${o.a} ∩ ${o.b} = ${o.areaM2.toFixed(4)} m²`);
  }
  if (overlaps.length > 20) {
    console.log(`  ... and ${overlaps.length - 20} more`);
  }
  process.exit(1);
}

console.log('OK — no refField interior overlaps detected.');
process.exit(0);

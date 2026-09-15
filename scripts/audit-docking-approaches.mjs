#!/usr/bin/env node
/** 掃描所有停靠點前是否「超過 refField 再倒車」 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const m = require('../backend/scripts/t3-v0-0-5-track-motion.js');

const STATIONS = ['N2W下行', 'T3下行', 'S2W下行', 'S2W上行', 'T3上行', 'N2W上行'];

function axisApproach(dock, samples) {
  const h = Math.abs(Math.cos(dock.heading)) > 0.5;
  if (h) {
    const east = Math.cos(dock.heading) > 0;
    return {
      axis: 'x',
      coord: (p) => p.x,
      overshoot: (v) => (east ? v > dock.x + 0.05 : v < dock.x - 0.05),
      target: dock.x,
    };
  }
  const south = Math.sin(dock.heading) > 0;
  return {
    axis: 'y',
    coord: (p) => p.y,
    overshoot: (v) => (south ? v > dock.y + 0.05 : v < dock.y - 0.05),
    target: dock.y,
  };
}

function scanStation(label, tStart, tEnd) {
  const { stop: dock } = m.resolveDockStop(label);
  if (!dock) return { label, error: 'no dock' };

  const approach = axisApproach(dock, []);
  let maxOvershoot = 0;
  let sawOvershoot = false;
  let sawBackup = false;
  let dwellT = null;
  let prev = null;

  for (let t = tStart; t < tEnd; t += 50) {
    const v = m.getVehiclePublishMotion('PMS01', t, 0, { managed: 0 });
    if (!v) continue;

    if (v.dwelling && v.station === label) {
      dwellT = t;
      break;
    }

    const c = approach.coord(v);
    if (approach.overshoot(c)) {
      sawOvershoot = true;
      maxOvershoot = Math.max(maxOvershoot, Math.abs(c - approach.target));
    }
    if (sawOvershoot && prev != null && Math.abs(c - approach.target) < Math.abs(prev - approach.target)) {
      sawBackup = true;
    }
    prev = c;
  }

  return {
    label,
    dock: { x: dock.x, y: dock.y },
    dwellT,
    sawOvershoot,
    maxOvershoot: Math.round(maxOvershoot * 100) / 100,
    sawBackup,
    ok: dwellT != null && !sawBackup,
  };
}

// PMS01 offset 0: down leg ~0–360s, up leg ~360–720s
const windows = {
  'N2W下行': [0, 30_000],
  'T3下行': [150_000, 210_000],
  'S2W下行': [300_000, 330_000],
  'S2W上行': [360_000, 390_000],
  'T3上行': [500_000, 560_000],
  'N2W上行': [660_000, 690_000],
};

console.log('=== 停靠點進站路徑審查 ===\n');
m.printDockingStopsAudit();
console.log('');

let bad = 0;
for (const label of STATIONS) {
  const w = windows[label];
  const r = scanStation(label, w[0], w[1]);
  if (r.error) {
    console.log(`? ${label}: ${r.error}`);
    bad++;
    continue;
  }
  const status = r.ok ? 'OK' : 'FAIL';
  console.log(
    `${status} ${label} @ (${r.dock.x}, ${r.dock.y})` +
      `  overshoot=${r.sawOvershoot ? r.maxOvershoot + 'm' : 'none'}` +
      `  backup=${r.sawBackup}` +
      (r.dwellT ? `  dwell@${r.dwellT}ms` : '  (no dwell found)'),
  );
  if (!r.ok) bad++;
}

// Rule2: S2W→N2W 段心 vs N2W dock
const u03 = { x: null };
for (let n = 3; n <= 16; n++) {
  // noop - use motion internals via sample
}
console.log('\n--- 段心 vs 終點停靠 ---');
const s2w = m.resolveDockStop('S2W下行').stop;
const d33 = { x: 100 + (33 - 20) * 50 + 25, y: 305.25 };
const d34 = { x: 100 + (34 - 20) * 50 + 25, y: 305.25 };
console.log(`S2W下行 dock x=${s2w.x}  D33 center x=${d33.x}  D34 center x=${d34.x}  (進站前勿至 D34)`);

const n2w = m.resolveDockStop('N2W上行').stop;
console.log(`N2W上行 dock x=${n2w.x}`);

process.exit(bad > 0 ? 1 : 0);

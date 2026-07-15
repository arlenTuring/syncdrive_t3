#!/usr/bin/env node
/**
 * 驗證規則1 終點 S2W下行、規則2 終點 N2W上行：精確停在地圖 refField 停靠點。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const motion = require('../backend/scripts/t3-v0-0-5-track-motion.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../.dev/verify');
fs.mkdirSync(OUT, { recursive: true });

const EXPECT = {
  'S2W下行': { x: 810, y: 305.25 },
  'N2W上行': { x: 810, y: 105.25 },
};

function findDwell(stationLabel) {
  for (let t = 0; t < 800_000; t += 100) {
    const v = motion.getVehiclePublishMotion('PMS-01', t, 0, { managed: 0 });
    if (!v?.dwelling || v.station !== stationLabel) continue;
    return { t, v };
  }
  return null;
}

console.log('=== 停靠點驗證（站點名稱） ===\n');
motion.printDockingStopsAudit();

const report = { at: new Date().toISOString(), checks: [] };

function pass(name, detail) {
  report.checks.push({ name, ok: true, detail });
  console.log(`✓ ${name}: ${detail}`);
}
function fail(name, detail) {
  report.checks.push({ name, ok: false, detail });
  console.error(`✗ ${name}: ${detail}`);
}

for (const [label, exp] of Object.entries(EXPECT)) {
  const resolved = motion.resolveDockStop?.(label)?.stop;
  if (!resolved) {
    fail(`${label}_loaded`, '無法讀取停靠點');
    continue;
  }
  const dx = Math.abs(resolved.x - exp.x);
  const dy = Math.abs(resolved.y - exp.y);
  if (dx < 0.01 && dy < 0.01) {
    pass(`${label}_coords`, `(${resolved.x}, ${resolved.y})`);
  } else {
    fail(`${label}_coords`, `期望 (${exp.x}, ${exp.y}) 實際 (${resolved.x}, ${resolved.y})`);
  }

  const hit = findDwell(label);
  if (!hit) {
    fail(`${label}_dwell`, '模擬未進入 dwelling');
    continue;
  }
  const { v } = hit;
  if (Math.abs(v.x - exp.x) < 0.01 && Math.abs(v.y - exp.y) < 0.01) {
    pass(`${label}_motion`, `t=${hit.t}ms (${v.x}, ${v.y})`);
  } else {
    fail(`${label}_motion`, `t=${hit.t}ms (${v.x}, ${v.y}) 偏離 refField`);
  }
}

const reportPath = path.join(OUT, 's2w-docking-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\n報告: ${reportPath}`);
process.exit(report.checks.some((c) => !c.ok) ? 1 : 0);

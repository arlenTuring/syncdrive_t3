/**
 * 診斷 U17-U19 導通掃描重複原因
 * node frontend/scripts/diagnose-connectivity-u17.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(readFileSync(join(__dirname, '../public/maps/t3-main-version.json'), 'utf8'));

const ENDPOINT_EPS_M = 0.06;
const SAMPLE_STEP_M = 0.8;

function isZero(p) {
  const v = [p?.refFieldXMinM, p?.refFieldXMaxM, p?.refFieldYMinM, p?.refFieldYMaxM];
  return v.every((x) => x === 0);
}

function getBounds(f) {
  const p = f.parameters ?? {};
  return {
    xMinM: p.refFieldXMinM,
    xMaxM: p.refFieldXMaxM,
    yMinM: p.refFieldYMinM,
    yMaxM: p.refFieldYMaxM,
  };
}

function span(bounds) {
  const w = bounds.xMaxM - bounds.xMinM;
  const h = bounds.yMaxM - bounds.yMinM;
  return { w, h, horizontal: w >= h };
}

function segmentEndpoints(seg) {
  const b = seg.bounds;
  if (seg.horizontal) {
    const yM = (b.yMinM + b.yMaxM) / 2;
    return [
      { xM: b.xMinM, yM, end: 'min' },
      { xM: b.xMaxM, yM, end: 'max' },
    ];
  }
  const xM = (b.xMinM + b.xMaxM) / 2;
  return [
    { xM, yM: b.yMinM, end: 'min' },
    { xM, yM: b.yMaxM, end: 'max' },
  ];
}

function endpointsTouch(a, b) {
  return Math.hypot(a.xM - b.xM, a.yM - b.yM) <= ENDPOINT_EPS_M;
}

const segments = [];
for (const area of map.areas ?? []) {
  for (const f of area.facilities ?? []) {
    if (f.type !== 'Track' || isZero(f.parameters)) continue;
    const bounds = getBounds(f);
    const s = span(bounds);
    if (!(s.w > 0 && s.h > 0)) continue;
    const code = (f.customName || f.parameters?.segmentId || f.id).toUpperCase();
    segments.push({
      trackId: f.id,
      trackCode: code,
      bounds,
      horizontal: s.horizontal,
    });
  }
}

const adj = new Map();
for (const s of segments) adj.set(s.trackId, new Set());
for (let i = 0; i < segments.length; i++) {
  for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i];
    const b = segments[j];
    const aEnds = segmentEndpoints(a);
    const bEnds = segmentEndpoints(b);
    let linked = false;
    for (const ae of aEnds) {
      for (const be of bEnds) {
        if (endpointsTouch(ae, be)) {
          linked = true;
          break;
        }
      }
      if (linked) break;
    }
    if (linked) {
      adj.get(a.trackId).add(b.trackId);
      adj.get(b.trackId).add(a.trackId);
    }
  }
}

const targets = new Set(['U17', 'U18', 'U19']);
const byCode = new Map(segments.map((s) => [s.trackCode, s]));

console.log('=== U17-U19 bounds & neighbors ===');
for (const code of ['U16', 'U17', 'U18', 'U19', 'D17']) {
  const s = byCode.get(code);
  if (!s) continue;
  const neighbors = [...adj.get(s.trackId)].map((id) => segments.find((x) => x.trackId === id)?.trackCode);
  console.log(code, s.bounds, 'neighbors:', neighbors.join(', '));
}

// connected component with U17
const start = byCode.get('U17')?.trackId;
const visited = new Set();
const stack = [start];
const comp = [];
while (stack.length) {
  const id = stack.pop();
  if (visited.has(id)) continue;
  visited.add(id);
  const seg = segments.find((s) => s.trackId === id);
  comp.push(seg.trackCode);
  for (const n of adj.get(id) ?? []) {
    if (!visited.has(n)) stack.push(n);
  }
}
console.log('\n=== Component containing U17 (' + comp.length + ' segments) ===');
console.log(comp.sort().join(', '));

function orderChainSegments(segmentIds) {
  if (segmentIds.length <= 1) return segmentIds;
  const idSet = new Set(segmentIds);
  const byId = new Map(segments.map((s) => [s.trackId, s]));
  const degree = (id) => [...adj.get(id)].filter((n) => idSet.has(n)).length;
  let startId = segmentIds.find((id) => degree(id) <= 1) ?? segmentIds[0];
  const ordered = [startId];
  const used = new Set([startId]);
  while (ordered.length < segmentIds.length) {
    const neighbors = [...adj.get(startId)].filter((n) => idSet.has(n) && !used.has(n));
    if (neighbors.length === 0) break;
    const next = neighbors[0];
    ordered.push(next);
    used.add(next);
    startId = next;
  }
  for (const id of segmentIds) {
    if (!used.has(id)) ordered.push(id);
  }
  return ordered.map((id) => byId.get(id)?.trackCode ?? id);
}

const compIds = comp.map((code) => byCode.get(code)?.trackId).filter(Boolean);
const ordered = orderChainSegments(compIds);
console.log('\n=== Ordered chain (greedy) ===');
console.log(ordered.join(' -> '));

// count U17-U19 occurrences in ordered list
for (const code of ['U17', 'U18', 'U19']) {
  console.log(code, 'appears', ordered.filter((c) => c === code).length, 'times in order');
}

function sampleSegmentPath(seg) {
  const b = seg.bounds;
  const points = [];
  const push = (xM, yM) => points.push({ xM, yM, trackId: seg.trackId, code: seg.trackCode });
  if (seg.horizontal) {
    const yM = (b.yMinM + b.yMaxM) / 2;
    const spanLen = b.xMaxM - b.xMinM;
    const steps = Math.max(1, Math.ceil(spanLen / SAMPLE_STEP_M));
    for (let i = 0; i <= steps; i++) push(b.xMinM + (spanLen * i) / steps, yM);
  } else {
    const xM = (b.xMinM + b.xMaxM) / 2;
    const spanLen = b.yMaxM - b.yMinM;
    const steps = Math.max(1, Math.ceil(spanLen / SAMPLE_STEP_M));
    for (let i = 0; i <= steps; i++) push(xM, b.yMinM + (spanLen * i) / steps);
  }
  return points;
}

const byId = new Map(segments.map((s) => [s.trackId, s]));
const path = [];
for (const code of ordered) {
  const seg = byCode.get(code);
  if (!seg) continue;
  const segPath = sampleSegmentPath(seg);
  if (path.length && segPath.length) {
    const last = path[path.length - 1];
    const first = segPath[0];
    if (Math.hypot(last.xM - first.xM, last.yM - first.yM) < ENDPOINT_EPS_M) {
      path.push(...segPath.slice(1));
    } else {
      path.push(...segPath);
    }
  } else {
    path.push(...segPath);
  }
}

const counts = {};
for (const p of path) counts[p.code] = (counts[p.code] || 0) + 1;
console.log('\n=== Path point counts (U17-U19 region) ===');
for (const code of ['U16', 'U17', 'U18', 'U19', 'U15']) {
  if (counts[code]) console.log(code, counts[code], 'points');
}

// detect back-and-forth: track code sequence transitions
let u17u19Runs = 0;
let inRun = false;
let lastCode = null;
const transitions = [];
for (const p of path) {
  const inZone = targets.has(p.code) || p.code === 'U16';
  if (inZone && p.code !== lastCode) transitions.push(p.code);
  lastCode = p.code;
}
console.log('\n=== Zone transition sequence (U16+U17-U19) ===');
console.log(transitions.join(' -> '));

// Count contiguous runs through U17-U18-U19
const runPattern = /U17.*U18.*U19|U19.*U18.*U17/g;
const pathCodes = path.map((p) => p.code).join(',');
for (const code of ['U17', 'U18', 'U19']) {
  const n = (pathCodes.match(new RegExp(code, 'g')) || []).length;
  console.log('total', code, 'points in path:', n);
}

// overlaps involving U17-U19
function overlapArea(a, b) {
  const w = Math.max(0, Math.min(a.xMaxM, b.xMaxM) - Math.max(a.xMinM, b.xMinM));
  const h = Math.max(0, Math.min(a.yMaxM, b.yMaxM) - Math.max(a.yMinM, b.yMinM));
  return w * h;
}

function connectedComponentsAll() {
  const visited = new Set();
  const components = [];
  for (const seg of segments) {
    if (visited.has(seg.trackId)) continue;
    const stack = [seg.trackId];
    const comp = [];
    visited.add(seg.trackId);
    while (stack.length) {
      const id = stack.pop();
      comp.push(segments.find((s) => s.trackId === id));
      for (const n of adj.get(id) ?? []) {
        if (!visited.has(n)) {
          visited.add(n);
          stack.push(n);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

console.log('\n=== All chains with U17-U19 or nearby ===');
const components = connectedComponentsAll();
let chainIdx = 0;
const uChains = [];
for (const comp of components) {
  const ids = comp.map((s) => s.trackId);
  const orderedCodes = orderChainSegments(ids);
  const hasU = orderedCodes.some((c) => targets.has(c));
  if (hasU || orderedCodes.some((c) => c === 'U16' || c === 'U15')) {
    console.log(
      'chain',
      chainIdx,
      orderedCodes.length,
      'segs,',
      orderedCodes[0],
      '->',
      orderedCodes[orderedCodes.length - 1],
      hasU ? '** HAS U17-U19 **' : '',
    );
    if (hasU) uChains.push(chainIdx);
  }
  chainIdx++;
}
console.log('U17-U19 chain indices:', uChains.join(', '), 'total components:', components.length);

let visitCount = { U17: 0, U18: 0, U19: 0 };
let zonePasses = 0;
let inZone = false;
for (const comp of components) {
  const ids = comp.map((s) => s.trackId);
  const orderedCodes = orderChainSegments(ids);
  const chainPath = [];
  for (const code of orderedCodes) {
    const seg = byCode.get(code);
    if (!seg) continue;
    const segPath = sampleSegmentPath(seg);
    if (chainPath.length && segPath.length) {
      const last = chainPath[chainPath.length - 1];
      const first = segPath[0];
      if (Math.hypot(last.xM - first.xM, last.yM - first.yM) < ENDPOINT_EPS_M) {
        chainPath.push(...segPath.slice(1));
      } else {
        chainPath.push(...segPath);
      }
    } else {
      chainPath.push(...segPath);
    }
  }
  let wasInZone = false;
  for (const p of chainPath) {
    if (targets.has(p.code)) {
      visitCount[p.code]++;
      if (!inZone) {
        zonePasses++;
        inZone = true;
      }
      wasInZone = true;
    }
  }
  if (wasInZone) inZone = false;
}
console.log('\n=== Simulated full scan: zone passes & point visits ===');
console.log('zonePasses (enter U17-U19 region):', zonePasses);
console.log('visitCount:', visitCount);

const zoneBox = { xMinM: 103.5, xMaxM: 107, yMinM: 107, yMaxM: 300 };
console.log('\n=== Components with path through zone bbox ===');
chainIdx = 0;
for (const comp of components) {
  const ids = comp.map((s) => s.trackId);
  const orderedCodes = orderChainSegments(ids);
  const chainPath = [];
  for (const code of orderedCodes) {
    const seg = byCode.get(code);
    if (!seg) continue;
    const segPath = sampleSegmentPath(seg);
    if (chainPath.length && segPath.length) {
      const last = chainPath[chainPath.length - 1];
      const first = segPath[0];
      if (Math.hypot(last.xM - first.xM, last.yM - first.yM) < ENDPOINT_EPS_M) {
        chainPath.push(...segPath.slice(1));
      } else {
        chainPath.push(...segPath);
      }
    } else {
      chainPath.push(...segPath);
    }
  }
  const inBox = chainPath.filter(
    (p) =>
      p.xM >= zoneBox.xMinM &&
      p.xM <= zoneBox.xMaxM &&
      p.yM >= zoneBox.yMinM &&
      p.yM <= zoneBox.yMaxM,
  );
  if (inBox.length) {
    const codes = [...new Set(inBox.map((p) => p.code))];
    console.log(
      'chain',
      chainIdx,
      orderedCodes[0],
      '...',
      orderedCodes[orderedCodes.length - 1],
      'points in box:',
      inBox.length,
      'tracks:',
      codes.join(','),
    );
  }
  chainIdx++;
}

console.log('\n=== Interior overlaps (>0) with U17-U19 ===');
for (const s of segments) {
  if (!targets.has(s.trackCode)) continue;
  for (const t of segments) {
    if (s.trackId >= t.trackId) continue;
    const area = overlapArea(s.bounds, t.bounds);
    if (area > 1e-6) console.log(s.trackCode, t.trackCode, area.toFixed(4), 'm²');
  }
}

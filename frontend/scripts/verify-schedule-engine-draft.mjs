/**
 * 以本機草稿「模擬正線」跑排班引擎並舉證約束。
 * 用法：node --import tsx scripts/verify-schedule-engine-draft.mjs
 */
import fs from 'node:fs';
import { generateShiftSchedule } from '../src/features/shift-list/utils/schedule-engine/generate.ts';
import { buildShiftScheduleDraftFromStored } from '../src/features/shift-list/types/create.ts';
import {
  resolveInterTripGapSeconds,
  sumStationDwellSecondsWithSlack,
  snapUpToClockAlignSeconds,
} from '../src/features/shift-list/utils/schedule-engine/physics.ts';
import { resolveHeadwaySecondsAtMinute } from '../src/features/shift-list/utils/schedule-engine/validate.ts';

const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';
const SHIFT_ID = process.env.SHIFT_ID ?? 'OS-DRAFT-MRDW9ZKY';

function fmt(minute) {
  const s = Math.round(minute * 60);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const detail = await fetchJson(
  `${BACKEND}/syncdrive-api/operation-shift/detail/${encodeURIComponent(SHIFT_ID)}`,
);
const draft = buildShiftScheduleDraftFromStored(detail.name, detail.body);
const template = await fetchJson(
  `${BACKEND}/syncdrive-api/time-template/detail/${encodeURIComponent(draft.timeTemplate.templateId)}`,
);

let maintenanceBody = null;
if (!draft.maintenanceTask.skipped && draft.maintenanceTask.taskId) {
  const m = await fetchJson(
    `${BACKEND}/syncdrive-api/maintenance-task/detail/${encodeURIComponent(draft.maintenanceTask.taskId)}`,
  );
  maintenanceBody = m.body ?? null;
}

const result = generateShiftSchedule({
  draft,
  templateBody: template.body ?? {},
  maintenanceTaskBody: maintenanceBody,
  passengerTimetableMode: 'template',
});

const routes = draft.routeGroups.selectedRoutes;
const recovery = draft.routeGroups.minimumRecoveryTimeSeconds ?? 30;
const down = routes.find((r) => r.routeName.includes('下行')) ?? routes[0];
const dwell = sumStationDwellSecondsWithSlack(down.stationDwells, down.dwellSlackSeconds);
const occ = snapUpToClockAlignSeconds((down.avgTravelTimeSeconds ?? 0) + (dwell ?? 0));
const gap = resolveInterTripGapSeconds({
  minimumRecoveryTimeSeconds: recovery,
  previousRouteSwitchBufferSeconds: down.switchBufferAfterSeconds,
  isRouteSwitch: true,
});

const row6 = result.plan?.timelines.find((t) => t.row === 6);
const early = (row6?.blocks ?? [])
  .filter((b) => b.source === 'template_bar' && b.taskType === 'passenger' && b.plannedStartMinute < 40)
  .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute)
  .map((b) => ({
    route: b.routeName,
    startHms: fmt(b.plannedStartMinute),
    endHms: fmt(b.plannedEndMinute),
    travel: b.travelSeconds,
    dwell: b.dwellSeconds,
  }));

let gapOk = null;
if (early.length >= 2) {
  const actual = Math.round(
    (row6.blocks
      .filter((b) => b.source === 'template_bar' && b.taskType === 'passenger' && b.plannedStartMinute < 40)
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute)[1].plannedStartMinute
      - row6.blocks
        .filter((b) => b.source === 'template_bar' && b.taskType === 'passenger' && b.plannedStartMinute < 40)
        .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute)[0].plannedEndMinute) * 60,
  );
  gapOk = { actualGapSeconds: actual, requiredGapSeconds: gap, pass: actual >= gap };
}

const cycleCheck = (result.plan?.timelines ?? []).map((t) => {
  const pax = t.blocks.filter((b) => b.source === 'template_bar' && b.taskType === 'passenger');
  return {
    row: t.row,
    paxCount: pax.length,
    completeCycles: pax.length % Math.max(1, routes.length) === 0,
  };
});

let switchChecked = 0;
let switchViolations = 0;
for (const t of result.plan?.timelines ?? []) {
  const pax = t.blocks
    .filter((b) => b.source === 'template_bar' && b.taskType === 'passenger')
    .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
  for (let i = 0; i < pax.length - 1; i += 1) {
    const cur = pax[i];
    const next = pax[i + 1];
    if (!cur.routeId || !next.routeId || cur.routeId === next.routeId) continue;
    const route = routes.find((r) => r.routeId === cur.routeId);
    const need = resolveInterTripGapSeconds({
      minimumRecoveryTimeSeconds: recovery,
      previousRouteSwitchBufferSeconds: route?.switchBufferAfterSeconds,
      isRouteSwitch: true,
    });
    const actual = Math.round((next.plannedStartMinute - cur.plannedEndMinute) * 60);
    switchChecked += 1;
    if (actual < need) switchViolations += 1;
  }
}

// 同方向（同路線）全車隊班距檢查：任兩班相鄰同方向發車 ≥ 時段班距目標
const intervals = template.body?.intervals ?? [];
const attributes = template.body?.attributes ?? [];
const headwayViolations = [];
const earlyUpDepartures = [];
for (const route of routes) {
  const departures = (result.plan?.timelines ?? [])
    .flatMap((t) => t.blocks)
    .filter((b) => b.taskType === 'passenger' && b.routeId === route.routeId)
    .map((b) => ({ row: b.timelineRow, startMinute: b.plannedStartMinute }))
    .sort((a, b) => a.startMinute - b.startMinute);
  if (route.routeName.includes('上行')) {
    for (const d of departures.filter((x) => x.startMinute < 45)) {
      earlyUpDepartures.push({ row: d.row, startHms: fmt(d.startMinute) });
    }
  }
  for (let i = 1; i < departures.length; i += 1) {
    const prev = departures[i - 1];
    const cur = departures[i];
    const target = resolveHeadwaySecondsAtMinute(prev.startMinute, intervals, attributes);
    if (target == null || target <= 0) continue;
    const actual = Math.round((cur.startMinute - prev.startMinute) * 60);
    if (actual < target) {
      headwayViolations.push({
        route: route.routeName,
        prev: `${fmt(prev.startMinute)}(列${prev.row})`,
        next: `${fmt(cur.startMinute)}(列${cur.row})`,
        actualSeconds: actual,
        targetSeconds: target,
      });
    }
  }
}

const report = {
  shiftId: SHIFT_ID,
  name: detail.name,
  ok: result.report.ok,
  errorCount: result.report.errors.length,
  warningCount: result.report.warnings.length,
  sampleErrors: result.report.errors.slice(0, 5),
  physics: {
    avgTravel: down.avgTravelTimeSeconds,
    dwellWithSlack: dwell,
    occupancySeconds: occ,
    recovery,
    switchBuffer: down.switchBufferAfterSeconds,
    requiredGapDownToUp: gap,
    formula: `下一趟 = 前趟結束 + 恢復 ${recovery}s + 換線 ${down.switchBufferAfterSeconds}s`,
    physicalEarliestUStartIfDAt0010: fmt(10 + occ / 60 + gap / 60),
    note: '回程實際發車另需對齊同方向班距（正線優先於整備視窗）',
  },
  row6EarlyPassenger: early,
  row6GapCheck: gapOk,
  cycleCheckAllComplete: cycleCheck.every((c) => c.completeCycles || c.paxCount === 0),
  switchChecked,
  switchViolations,
  earlyUpDepartures,
  sameDirectionHeadwayViolations: headwayViolations,
};

const outPath = new URL('../.dev/verify-schedule-engine-report.json', import.meta.url);
fs.mkdirSync(new URL('../.dev/', import.meta.url), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nWrote ${outPath.pathname}`);

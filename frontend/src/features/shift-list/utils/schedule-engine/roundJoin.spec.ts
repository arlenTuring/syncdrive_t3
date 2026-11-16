import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PointTopology } from '../../../map-editor/types/pointTopology';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import { joinRoundLaterInCopy } from './resolveResidualConflicts';
import { applyRoundJoinAtYardExit, listOnlineBoundaries } from './roundJoin';
import type { FeasibilityIssue, GeneratedScheduleBlock, GeneratedSchedulePlan } from './types';
import { validateRotationCyclesComplete } from './validate';

/**
 * 車上線時從一輪的中途加入（試驗功能）。
 *
 * 路網是一個四站的環：A → B → C → D → A，一輪四段。整備區 Y 靠近 B 站（Y → B 50 秒），
 * 要到循環起點 A 得繞 B → C → D → A；整備區 X 靠近 A 站。站名、路線名都是測試自己取的，
 * 程式裡不認任何站名。
 */

const STATIONS = ['a', 'b', 'c', 'd'] as const;

const topology = {
  version: 1,
  nodes: [
    ...STATIONS.map((id) => ({ id: `n-${id}`, kind: 'docking', label: id.toUpperCase(), stationId: id })),
    { id: 'yard-x', kind: 'facility', label: 'X1' },
    { id: 'yard-y', kind: 'facility', label: 'Y1' },
  ],
  edges: [
    ...STATIONS.map((id, index) => ({
      id: `e-${id}`,
      fromNodeId: `n-${id}`,
      toNodeId: `n-${STATIONS[(index + 1) % STATIONS.length]}`,
      minTravelTimeSeconds: 100,
      avgTravelTimeSeconds: 120,
      distanceMeters: null,
    })),
    { id: 'e-x', fromNodeId: 'yard-x', toNodeId: 'n-a', minTravelTimeSeconds: 50, avgTravelTimeSeconds: 50, distanceMeters: null },
    { id: 'e-y', fromNodeId: 'yard-y', toNodeId: 'n-b', minTravelTimeSeconds: 50, avgTravelTimeSeconds: 50, distanceMeters: null },
  ],
} as unknown as PointTopology;

const routes = STATIONS.map((id, index) => ({
  instanceId: `r-${id}`,
  routeId: `route-${id}`,
  routeName: `${id.toUpperCase()}>${STATIONS[(index + 1) % STATIONS.length]!.toUpperCase()}`,
  routeCode: id.toUpperCase(),
  stationIds: [id, STATIONS[(index + 1) % STATIONS.length]!],
})) as unknown as ShiftScheduleSelectedRoute[];

function yard(row: number, id: string, nodeId: string, start: number, end: number): GeneratedScheduleBlock {
  return {
    id,
    timelineRow: row,
    taskType: 'standby',
    label: '待命',
    source: 'template_bar',
    travelSeconds: 0,
    dwellSeconds: 0,
    anchorStartMinute: start,
    plannedStartMinute: start,
    plannedEndMinute: end,
    yardFacilityNodeId: nodeId,
  } as GeneratedScheduleBlock;
}

/** 從 start 分鐘起排 roundCount 輪，每段 3 分鐘、段與段相接 */
function rounds(row: number, start: number, roundCount: number): GeneratedScheduleBlock[] {
  const out: GeneratedScheduleBlock[] = [];
  for (let round = 0; round < roundCount; round += 1) {
    STATIONS.forEach((id, leg) => {
      const begin = start + (round * STATIONS.length + leg) * 3;
      out.push({
        id: `trip-${row}-${round}-${id}`,
        timelineRow: row,
        taskType: 'passenger',
        label: '正線',
        source: 'template_bar',
        routeInstanceId: `r-${id}`,
        routeId: `route-${id}`,
        routeName: routes[leg]!.routeName,
        routeCode: id.toUpperCase(),
        cycleChainId: `cycle-${row}-${round}`,
        travelSeconds: 140,
        dwellSeconds: 40,
        anchorStartMinute: begin,
        plannedStartMinute: begin,
        plannedEndMinute: begin + 3,
      } as GeneratedScheduleBlock);
    });
  }
  return out;
}

function plan(): GeneratedSchedulePlan['timelines'] {
  return [
    { row: 1, blocks: [yard(1, 'yard-1', 'yard-y', 0, 60), ...rounds(1, 60, 2)] },
    { row: 2, blocks: [yard(2, 'yard-2', 'yard-x', 0, 90), ...rounds(2, 90, 1)] },
  ];
}

const tripIds = (timelines: GeneratedSchedulePlan['timelines'], row: number) =>
  timelines.find((timeline) => timeline.row === row)!.blocks
    .filter((block) => block.taskType === 'passenger')
    .map((block) => block.id);

describe('車上線時從一輪的中途加入', () => {
  it('候選依少掉的段數由少到多，留下來的各段時刻不動', () => {
    const before = plan();
    const candidates = joinRoundLaterInCopy(before, 'trip-1-0-a');
    assert.deepEqual(candidates.map((item) => item.dropped.length), [1, 2, 3]);

    const first = candidates[0]!;
    assert.equal(first.joinBlockId, 'trip-1-0-b');
    assert.deepEqual(first.dropped.map((block) => block.id), ['trip-1-0-a']);
    const kept = first.timelines.find((timeline) => timeline.row === 1)!.blocks;
    assert.equal(kept.find((block) => block.id === 'trip-1-0-a'), undefined);
    const join = kept.find((block) => block.id === 'trip-1-0-b')!;
    assert.equal(join.roundJoinSkippedLegs, 1);
    assert.equal(join.plannedStartMinute, 63, '加入的那一段發車時刻不變');
    // 第二輪完全不受影響
    assert.equal(kept.filter((block) => block.cycleChainId === 'cycle-1-1').length, 4);
    // 原本的班表沒被改到
    assert.equal(tripIds(before, 1).length, 8);
  });

  it('不是整備之後的第一班就不處理', () => {
    assert.deepEqual(joinRoundLaterInCopy(plan(), 'trip-1-0-b'), []);
    assert.deepEqual(joinRoundLaterInCopy(plan(), 'trip-1-1-a'), []);
  });

  it('整備位置離後面的站比較近才從那一站加入；離循環起點近的不動', () => {
    const warnings: FeasibilityIssue[] = [];
    const result = applyRoundJoinAtYardExit({
      timelines: plan(),
      topology,
      selectedRoutes: routes,
      warnings,
    });
    // 時間線 1 停在 Y（到 B 站 50 秒，到 A 站要繞三段）：少開第一段，從 B 站加入
    assert.deepEqual(tripIds(result, 1).slice(0, 3), ['trip-1-0-b', 'trip-1-0-c', 'trip-1-0-d']);
    assert.equal(tripIds(result, 1).length, 7);
    // 時間線 2 停在 X（就在 A 站旁邊）：不動
    assert.equal(tripIds(result, 2).length, 4);

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]!.code, 'ROUND_JOINED_MIDWAY');
    const detail = warnings[0]!.detail as { timelineRow: number; droppedTripCount: number };
    assert.equal(detail.timelineRow, 1);
    assert.equal(detail.droppedTripCount, 1);
  });

  it('「一輪要跑完」的檢查把沒開的那幾段算進來', () => {
    const result = applyRoundJoinAtYardExit({
      timelines: plan(),
      topology,
      selectedRoutes: routes,
      warnings: [],
    });
    const errors: FeasibilityIssue[] = [];
    validateRotationCyclesComplete(result, STATIONS.length, errors);
    assert.deepEqual(errors, []);

    // 沒有標記、單純少一班的班表，照樣要被抓到
    const broken = plan();
    broken[0]!.blocks = broken[0]!.blocks.filter((block) => block.id !== 'trip-1-0-a');
    validateRotationCyclesComplete(broken, STATIONS.length, errors);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.code, 'ROTATION_CYCLE_INCOMPLETE');
  });

  it('列出每一次上線（整備卡、第一班）', () => {
    const boundaries = listOnlineBoundaries(plan());
    assert.deepEqual(
      boundaries.map((item) => [item.row, item.yard.id, item.first.id]),
      [[1, 'yard-1', 'trip-1-0-a'], [2, 'yard-2', 'trip-2-0-a']],
    );
  });
});

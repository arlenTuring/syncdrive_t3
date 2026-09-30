import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import { insertMaintenanceTransferCards } from './insertMaintenanceTransferCards';
import type { GeneratedScheduleBlock, GeneratedScheduleTimeline } from './schedule-engine/types';

/**
 * 重現：必要轉場被別列車的移動佔住轉折點（基準班表時間線 4 的模式）。
 *
 * 時刻、名稱都只是這個測試的資料，演算法裡沒有任何一個。
 *
 * 路網：站 N ──30s── 轉折點 G ──30s── E1／E2／E3；N ──30s── G2 ──30s── E5。
 * - 時間線 1：充電 E1 做到 430 分，接著待命 E2（E1 → G → E2）。
 * - 時間線 2：載客到 N，行檢入廠 N → G → E3，430:00 經過 G。
 * - 時間線 3：載客到 N，保養入廠 N → G → E1，431:00 經過 G、431:30 進 E1。
 *
 * 時間線 1 的充電是作業，不能提早走；又得在時間線 3 進 E1 前 60 秒讓出 E1，
 * 所以只能在 430:00～430:30 之間離開、430:30～431:00 經過 G——兩邊都跟別列車差不到 60 秒。
 */
const edge = (from: string, to: string) => ({
  id: `${from}>${to}`, fromNodeId: from, toNodeId: to, avgTravelTimeSeconds: 30, minTravelTimeSeconds: 30, distanceMeters: 50,
});
const node = (id: string, kind: 'facility' | 'docking' | 'waypoint', stationId?: string) =>
  ({ id, kind, label: id, x: 0, y: 0, color: '#111', ...(stationId ? { stationId } : {}) });
const topology: PointTopology = {
  version: 1,
  nodes: [
    node('N', 'docking', 'st_n'), node('G', 'waypoint'), node('G2', 'waypoint'),
    node('E1', 'facility'), node('E2', 'facility'), node('E3', 'facility'), node('E5', 'facility'),
  ],
  edges: [
    edge('N', 'G'), edge('G', 'N'), edge('N', 'G2'), edge('G2', 'N'),
    ...['E1', 'E2', 'E3'].flatMap((facility) => [edge('G', facility), edge(facility, 'G')]),
    edge('G2', 'E5'), edge('E5', 'G2'),
  ],
} as PointTopology;
const facilities = (...codes: string[]) => ({ stepEnabled: true, equipmentRows: codes.map((mapCode, index) => ({ id: `${mapCode}-${index}`, mapCode })) });
const BODY = {
  charging: facilities('E1'),
  mobile: facilities('E2'),
  preTrip: facilities('E3'),
  maintenance: facilities('E1', 'E5'),
};
const ROUTES = [{
  routeId: 'an', routeCode: 'AN', routeName: 'A>N', stationIds: ['st_a', 'st_n'], stationDwells: [],
  minTravelTimeSeconds: 300, avgTravelTimeSeconds: 300, dwellSlackSeconds: 0, switchBufferAfterSeconds: 0,
}] as unknown as Parameters<typeof insertMaintenanceTransferCards>[0]['selectedRoutes'];

function block(row: number, id: string, taskType: GeneratedScheduleBlock['taskType'], start: number, end: number): GeneratedScheduleBlock {
  return {
    id, timelineRow: row, taskType, label: id, anchorStartMinute: start, plannedStartMinute: start, plannedEndMinute: end,
    travelSeconds: taskType === 'passenger' ? (end - start) * 60 : 0, dwellSeconds: 0, source: 'template_bar',
    ...(taskType === 'passenger' ? { routeId: 'an', routeCode: 'AN', routeName: 'A>N' } : {}),
  } as GeneratedScheduleBlock;
}

function timelines(): GeneratedScheduleTimeline[] {
  return [
    { row: 1, blocks: [block(1, 'charge-1', 'charging', 300, 430), block(1, 'standby-1', 'standby', 430, 520)] },
    { row: 2, blocks: [block(2, 'trip-2', 'passenger', 424.5, 429.5), block(2, 'inspect-2', 'inspection', 430, 480)] },
    { row: 3, blocks: [block(3, 'trip-3', 'passenger', 425.5, 430.5), block(3, 'service-3', 'servicing', 431.5, 500)] },
  ];
}

function run(avoidYardSpots: Array<{ blockId: string; nodeId: string }> = []) {
  const plan = timelines();
  const result = insertMaintenanceTransferCards({
    timelines: plan,
    topology,
    areas: [],
    maintenanceBody: BODY,
    selectedRoutes: ROUTES,
    minimumRecoveryTimeSeconds: 0,
    collisionProtectionSeconds: 30,
    sectionCodes: { charging: 'E', carWash: 'W', maintenance: 'M', preTrip: 'P', mobile: 'S' },
    avoidYardSpots,
  });
  const skip = result.skipped.find((item) => item.blockId === 'standby-1' && item.fromTaskType === 'charging');
  return { plan, result, skip };
}

describe('必要轉場被別列車的移動佔住轉折點：回報是誰擋的，請它換位置就排得出來', () => {
  it('排不出時，擋路的兩筆移動各自回報成 junction 擋路者（哪張卡、停哪個設施、撞在哪個轉折點）', () => {
    const { skip } = run();
    assert.ok(skip, '時間線 1 的充電 → 待命應該排不出');
    const junction = (skip.blockers ?? []).filter((item) => item.kind === 'junction');
    assert.deepEqual(
      junction.map((item) => [item.blockingRow, item.blockingBlockId, item.nodeId, item.junctionNodeId]).sort(),
      [[2, 'inspect-2', 'E3', 'G'], [3, 'service-3', 'E1', 'G']],
    );
  });

  it('請時間線 3 的保養不要停 E1（改走 G2 去 E5）：G 與 E1 都讓出來，時間線 1 的轉場排得出來', () => {
    const { plan, skip } = run([{ blockId: 'service-3', nodeId: 'E1' }]);
    assert.equal(skip, undefined, skip?.reason);
    const row1 = plan.find((timeline) => timeline.row === 1)!.blocks;
    const out = row1.find((item) => item.source === 'yard_exit_move')!;
    assert.ok(out, '時間線 1 有出廠卡');
    assert.ok(out.plannedStartMinute >= 430 - 1e-9, '充電做滿，不提早離開');
    const service = plan.find((timeline) => timeline.row === 3)!.blocks.find((item) => item.id === 'service-3')!;
    assert.equal(service.yardFacilityNodeId, 'E5');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { buildBlockStationDepartures } from './buildBlockStationDepartures';
import { insertMaintenanceEntryServiceTrips } from './insertMaintenanceEntryServiceTrips';
import { buildJoinedRouteSegment, isJoinedRouteSegment, routeForJoinedBlock } from './joinedRouteSegment';
import { buildMaintenanceFirstTripOriginsFromTopology } from './maintenanceFirstTripOrigins';
import type { MaintenanceSectionCodeBySection } from './maintenanceSectionCode';
import type { FeasibilityIssue, GeneratedScheduleBlock, GeneratedScheduleTimeline } from './schedule-engine/types';

/**
 * 第四批：從路線中途加入的調度載客（白皮書 DISPATCH-01～05）
 *
 * 路網：整備設施 F 只接到 B 站。路線 ABC（A → B → C）中途經過 B；首班是 CD（C → D）。
 * 車做完整備停在 B，應該「自 B 加入」ABC，只跑 B → C，接上 C 站發車的首班。
 */

function route(
  routeId: string,
  stations: Array<{ id: string; dwell: number }>,
  legs: Array<{ from: string; to: string; avg: number; min: number }>,
): ShiftScheduleSelectedRoute {
  const avg = legs.reduce((sum, leg) => sum + leg.avg, 0);
  const min = legs.reduce((sum, leg) => sum + leg.min, 0);
  return {
    instanceId: routeId,
    routeId,
    routeName: routeId,
    routeCode: routeId,
    groupId: 'g1',
    groupName: 'g1',
    stationIds: stations.map((station) => station.id),
    stationDwells: stations.map((station, index) => ({
      stationId: station.id,
      stationName: `${station.id}站`,
      dwellSeconds: index === 0 ? 0 : station.dwell,
      dwellRequired: index !== 0,
    })),
    stationDwellsConfirmed: true,
    stationLegTravels: legs.map((leg) => ({
      fromStationId: leg.from,
      toStationId: leg.to,
      avgTravelTimeSeconds: leg.avg,
      minTravelTimeSeconds: leg.min,
    })),
    avgTravelTimeSeconds: avg,
    minTravelTimeSeconds: min,
    executionOrder: 1,
    switchBufferAfterSeconds: 0,
    dwellSlackSeconds: 0,
  } as ShiftScheduleSelectedRoute;
}

const routeAbc = route(
  'ABC',
  [{ id: 'A', dwell: 0 }, { id: 'B', dwell: 30 }, { id: 'C', dwell: 30 }],
  [{ from: 'A', to: 'B', avg: 200, min: 180 }, { from: 'B', to: 'C', avg: 200, min: 180 }],
);
const routeCd = route(
  'CD',
  [{ id: 'C', dwell: 0 }, { id: 'D', dwell: 30 }],
  [{ from: 'C', to: 'D', avg: 300, min: 270 }],
);

describe('buildJoinedRouteSegment：從加入站截短的那一段', () => {
  it('站序、停靠、站間行駛都從加入站起算，行駛時間取各段加總', () => {
    const segment = buildJoinedRouteSegment(routeAbc, 1)!;
    assert.deepEqual(segment.stationIds, ['B', 'C']);
    assert.equal(segment.stationLegTravels.length, 1);
    assert.equal(segment.avgTravelTimeSeconds, 200);
    assert.equal(segment.minTravelTimeSeconds, 180);
    assert.equal(segment.routeId, 'ABC', '班表上仍掛原路線');
    assert.equal(segment.stationDwells[0]!.dwellSeconds, 0, '加入站是首站，不算停靠');
    assert.equal(segment.stationDwells[0]!.dwellRequired, false);
    assert.equal(segment.stationDwells[1]!.dwellSeconds, 30, '之後的站照原停靠');
    assert.ok(isJoinedRouteSegment(segment));
    assert.equal(buildJoinedRouteSegment(routeAbc, 1), segment, '同一段重複取得是同一份');
  });

  it('起點（index 0）、終點、超出範圍都不是中途加入', () => {
    assert.equal(buildJoinedRouteSegment(routeAbc, 0), null);
    assert.equal(buildJoinedRouteSegment(routeAbc, 2), null);
    assert.equal(buildJoinedRouteSegment(routeAbc, 5), null);
  });

  it('缺任何一段站間行駛時間就不算（不猜、不均分）', () => {
    const noLeg = { ...routeAbc, stationLegTravels: routeAbc.stationLegTravels.slice(0, 1) };
    assert.equal(buildJoinedRouteSegment(noLeg, 1), null);
    const zeroLeg = {
      ...routeAbc,
      stationLegTravels: [routeAbc.stationLegTravels[0]!, { ...routeAbc.stationLegTravels[1]!, avgTravelTimeSeconds: 0, minTravelTimeSeconds: 0 }],
    };
    assert.equal(buildJoinedRouteSegment(zeroLeg, 1), null);
  });
});

describe('routeForJoinedBlock：全引擎換成截短那一段的共用入口', () => {
  it('卡上有加入站就換成那一段；已經是截短的原樣回傳（呼叫幾次都一樣）', () => {
    const block = { entryJoinedAtStationId: 'B' };
    const once = routeForJoinedBlock(block, routeAbc);
    assert.deepEqual(once.stationIds, ['B', 'C']);
    assert.equal(routeForJoinedBlock(block, once), once);
  });

  it('沒有加入站、加入站是起點、或路線沒經過加入站：整條原路線', () => {
    assert.equal(routeForJoinedBlock({}, routeAbc), routeAbc);
    assert.equal(routeForJoinedBlock({ entryJoinedAtStationId: 'A' }, routeAbc), routeAbc);
    assert.equal(routeForJoinedBlock({ entryJoinedAtStationId: 'Z' }, routeAbc), routeAbc);
  });

  it('逐站時刻只列加入站之後：不虛構已服務前面的站（DISPATCH-03）', () => {
    const block = {
      id: 'entry-1',
      timelineRow: 1,
      taskType: 'passenger',
      label: '進場載客',
      routeId: 'ABC',
      anchorStartMinute: 600,
      plannedStartMinute: 600,
      plannedEndMinute: 600 + 230 / 60,
      travelSeconds: 230,
      dwellSeconds: 0,
      source: 'entry_service',
      entryJoinedAtStationId: 'B',
    } as GeneratedScheduleBlock;
    const stops = buildBlockStationDepartures(block, routeAbc);
    assert.deepEqual(stops.map((stop) => stop.stationId), ['B', 'C']);
    assert.equal(stops[0]!.departureMinute, 600, '從加入站 B 準時發車');
  });
});

describe('insertMaintenanceEntryServiceTrips：中途加入（整合）', () => {
  const topology: PointTopology = {
    version: 1,
    nodes: [
      { id: 'fac-f', kind: 'facility', label: 'F', x: 0, y: 0, color: '#4a9e6e' },
      { id: 'dock-a', kind: 'docking', label: 'A站', stationId: 'A', x: 100, y: 0, color: '#5b5fc7' },
      { id: 'dock-b', kind: 'docking', label: 'B站', stationId: 'B', x: 200, y: 0, color: '#5b5fc7' },
      { id: 'dock-c', kind: 'docking', label: 'C站', stationId: 'C', x: 300, y: 0, color: '#5b5fc7' },
    ],
    edges: [
      { id: 'e-fb', fromNodeId: 'fac-f', toNodeId: 'dock-b', minTravelTimeSeconds: 30, avgTravelTimeSeconds: 30, distanceMeters: 50 },
    ],
  } as PointTopology;
  const sectionCodes: MaintenanceSectionCodeBySection = {
    charging: 'E', carWash: '', maintenance: 'M', preTrip: '', mobile: 'S',
  };
  // 每一類整備都設在同一個設施 F：位置相同，只有名稱不同
  const facilityF = { stepEnabled: true, equipmentRows: [{ mapCode: 'F' }] };
  const maintenanceBody = { charging: facilityF, maintenance: facilityF, mobile: facilityF, preTrip: facilityF };

  function timelines(yardTaskType: GeneratedScheduleBlock['taskType']): GeneratedScheduleTimeline[] {
    return [{
      row: 1,
      blocks: [
        {
          id: 'yard', timelineRow: 1, taskType: yardTaskType, label: '整備',
          anchorStartMinute: 480, plannedStartMinute: 480, plannedEndMinute: 570,
          travelSeconds: 0, dwellSeconds: 0, source: 'template_bar',
        },
        {
          id: 'first', timelineRow: 1, taskType: 'passenger', label: '正線',
          routeId: 'CD', routeCode: 'CD', routeName: 'CD',
          anchorStartMinute: 600, plannedStartMinute: 600, plannedEndMinute: 600 + 330 / 60,
          travelSeconds: 300, dwellSeconds: 30, source: 'template_bar',
        },
      ] as GeneratedScheduleBlock[],
    }];
  }

  function run(yardTaskType: GeneratedScheduleBlock['taskType']) {
    const warnings: FeasibilityIssue[] = [];
    const next = insertMaintenanceEntryServiceTrips({
      timelines: timelines(yardTaskType),
      selectedRoutes: [routeAbc, routeCd],
      firstTripOrigins: buildMaintenanceFirstTripOriginsFromTopology(topology),
      maintenanceBody,
      sectionCodes,
      minimumRecoveryTimeSeconds: 0,
      warnings,
    });
    const entries = next[0]!.blocks.filter((block) => block.source === 'entry_service');
    return { entries, warnings };
  }

  it('車停在 B：自 B 加入 ABC，只跑 B → C，接上首班（不必先繞回 A）', () => {
    const { entries, warnings } = run('servicing');
    assert.equal(entries.length, 1);
    const entry = entries[0]!;
    assert.equal(entry.routeId, 'ABC', '掛原路線');
    assert.equal(entry.entryJoinedAtStationId, 'B');
    assert.match(entry.label, /自 B站 加入/);
    assert.equal(entry.plannedEndMinute, 600, '到 C 剛好接上首班');
    assert.ok(entry.plannedStartMinute >= 570 - 1e-9, '整備做完才發車，不吃整備尾巴');
    // 只有 B → C 那一段的時間（200 秒行駛＋C 站 30 秒停靠），不是整條 ABC
    assert.equal(Math.round((entry.plannedEndMinute - entry.plannedStartMinute) * 60), 230);
    const report = warnings.find((issue) => issue.code === 'ENTRY_SERVICE_INSERTED');
    assert.ok(report, '報告要揭露這一串（DISPATCH-05）');
  });

  it('不依整備任務名稱決定（DISPATCH-04）：同一個設施，充電、待命、保養、行檢出來結果相同', () => {
    const shape = (entries: GeneratedScheduleBlock[]) =>
      entries.map((entry) => [entry.routeId, entry.entryJoinedAtStationId, entry.plannedStartMinute, entry.plannedEndMinute]);
    const servicing = shape(run('servicing').entries);
    assert.deepEqual(shape(run('charging').entries), servicing);
    assert.deepEqual(shape(run('standby').entries), servicing);
    assert.deepEqual(shape(run('inspection').entries), servicing);
  });

  it('整串全插或全不插：首班前的空檔放不下，就一段都不插（退回不載客的出場移動）', () => {
    const tight = timelines('servicing');
    // 整備做到 09:58，只剩 2 分鐘，B → C 要 230 秒
    tight[0]!.blocks[0]!.plannedEndMinute = 598;
    const next = insertMaintenanceEntryServiceTrips({
      timelines: tight,
      selectedRoutes: [routeAbc, routeCd],
      firstTripOrigins: buildMaintenanceFirstTripOriginsFromTopology(topology),
      maintenanceBody,
      sectionCodes,
      minimumRecoveryTimeSeconds: 0,
      warnings: [],
    });
    assert.equal(next[0]!.blocks.filter((block) => block.source === 'entry_service').length, 0);
    assert.equal(next[0]!.blocks.find((block) => block.id === 'yard')!.plannedEndMinute, 598, '整備尾巴不被截短');
  });

  /**
   * 撞站位時要不要硬插，看位置不看名稱：另一台車 10:00 同時到 C，這一趟一定撞。
   * 路網上設施開得到 C（有不載客的退路）就不插；開不到（不插車就憑空出現在 C）才照插，
   * 衝突交給最終驗證擋發布。
   */
  function conflictRun(withDeadheadPath: boolean) {
    const conflicted = timelines('inspection');
    conflicted.push({
      row: 2,
      blocks: [{
        id: 'other', timelineRow: 2, taskType: 'passenger', label: '正線',
        routeId: 'ABC', routeCode: 'ABC', routeName: 'ABC',
        anchorStartMinute: 600 - 460 / 60, plannedStartMinute: 600 - 460 / 60, plannedEndMinute: 600,
        travelSeconds: 400, dwellSeconds: 60, source: 'template_bar',
      }] as GeneratedScheduleBlock[],
    });
    const withPath: PointTopology = {
      ...topology,
      edges: [
        ...topology.edges,
        ...(withDeadheadPath
          ? [{ id: 'e-bc', fromNodeId: 'dock-b', toNodeId: 'dock-c', minTravelTimeSeconds: 200, avgTravelTimeSeconds: 200, distanceMeters: 300 }]
          : []),
      ],
    } as PointTopology;
    const next = insertMaintenanceEntryServiceTrips({
      timelines: conflicted,
      selectedRoutes: [routeAbc, routeCd],
      firstTripOrigins: buildMaintenanceFirstTripOriginsFromTopology(topology),
      maintenanceBody,
      sectionCodes,
      minimumRecoveryTimeSeconds: 0,
      collisionProtectionSeconds: 30,
      pointTopology: withPath,
      warnings: [],
    });
    return next[0]!.blocks.filter((block) => block.source === 'entry_service');
  }

  it('會撞站位、但設施開得到首班起點（有退路）：不硬插', () => {
    assert.equal(conflictRun(true).length, 0);
  });

  it('會撞站位、而且設施開不到首班起點（沒有退路）：照插，不讓車憑空出現在起點', () => {
    const entries = conflictRun(false);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.entryJoinedAtStationId, 'B');
  });
});

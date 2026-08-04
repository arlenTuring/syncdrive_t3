import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyPointTopology } from '../../map-editor/types/pointTopology';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import {
  buildMaintenanceFirstTripOriginsFromTopology,
  preferFirstTripOriginForRow,
} from './maintenanceFirstTripOrigins';
import { insertMaintenanceEntryServiceTrips } from './insertMaintenanceEntryServiceTrips';
import type { GeneratedScheduleTimeline } from './schedule-engine/types';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { MaintenanceSectionCodeBySection } from './maintenanceSectionCode';

function topologyFixture(): PointTopology {
  return {
    version: 1,
    nodes: [
      { id: 'fac-w1', kind: 'facility', label: 'W1', x: 0, y: 0, color: '#4a9e6e' },
      { id: 'fac-p1', kind: 'facility', label: 'P1', x: 0, y: 40, color: '#4a9e6e' },
      {
        id: 'dock-t3',
        kind: 'docking',
        label: 'T3下行',
        stationId: 'T3-D',
        x: 120,
        y: 0,
        color: '#5b5fc7',
      },
      {
        id: 'dock-s2w',
        kind: 'docking',
        label: 'S2W上行',
        stationId: 'S2W-U',
        x: 120,
        y: 80,
        color: '#5b5fc7',
      },
    ],
    edges: [
      {
        id: 'e1',
        fromNodeId: 'fac-w1',
        toNodeId: 'dock-t3',
        minTravelTimeSeconds: 90,
        avgTravelTimeSeconds: 120,
        distanceMeters: 200,
      },
      {
        id: 'e2',
        fromNodeId: 'fac-p1',
        toNodeId: 'dock-t3',
        minTravelTimeSeconds: 60,
        avgTravelTimeSeconds: 80,
        distanceMeters: 100,
      },
      {
        id: 'e3',
        fromNodeId: 'fac-w1',
        toNodeId: 'dock-s2w',
        minTravelTimeSeconds: 100,
        avgTravelTimeSeconds: 150,
        distanceMeters: 250,
      },
    ],
  };
}

describe('buildMaintenanceFirstTripOriginsFromTopology', () => {
  it('returns empty for blank topology', () => {
    assert.deepEqual(buildMaintenanceFirstTripOriginsFromTopology(emptyPointTopology()), []);
  });

  it('groups facility→docking edges by station and takes worst deadhead', () => {
    const origins = buildMaintenanceFirstTripOriginsFromTopology(topologyFixture());
    assert.equal(origins.length, 2);

    const t3 = origins.find((item) => item.stationId === 'T3-D');
    assert.ok(t3);
    // W1→T3 120s 比 P1→T3 80s 長，取最壞
    assert.equal(t3!.deadheadSeconds, 120);
    assert.equal(t3!.facilityNodeIds.length, 2);
    assert.ok(t3!.facilityLabels.length >= 1);

    const s2w = origins.find((item) => item.stationId === 'S2W-U');
    assert.ok(s2w);
    assert.equal(s2w!.deadheadSeconds, 150);
  });

  it('round-robins preferred origin by row', () => {
    const origins = buildMaintenanceFirstTripOriginsFromTopology(topologyFixture());
    const a = preferFirstTripOriginForRow(origins, 1);
    const b = preferFirstTripOriginForRow(origins, 2);
    assert.ok(a && b);
    assert.notEqual(a!.stationId, b!.stationId);
  });
});

describe('resolveInspectionExitStationId', () => {
  it('maps preTrip facility mapCode to topology exit station', async () => {
    const {
      resolveInspectionExitStationId,
      resolveRotationOffsetForExitStation,
    } = await import('./maintenanceFirstTripOrigins');
    const origins = buildMaintenanceFirstTripOriginsFromTopology(topologyFixture());
    const exit = resolveInspectionExitStationId(origins, {
      preTrip: {
        stepEnabled: true,
        equipmentRows: [{ id: '1', mapCode: 'W1', waypointCode: '' }],
      },
    });
    // W1 → T3 and S2W in fixture; both match W1 — pick by hit count / sort
    assert.ok(exit === 'T3-D' || exit === 'S2W-U');
    const routes = [
      { stationIds: ['N2W-D', 'T3-D'] },
      { stationIds: ['T3-D', 'N2W-D'] },
    ];
    const offset = resolveRotationOffsetForExitStation(routes, 'T3-D');
    assert.equal(offset, 1);
  });
});

describe('insertMaintenanceEntryServiceTrips', () => {
  function makeRoute(
    over: Partial<ShiftScheduleSelectedRoute> & Pick<ShiftScheduleSelectedRoute, 'routeId' | 'stationIds'>,
  ): ShiftScheduleSelectedRoute {
    return {
      routeName: over.routeId,
      routeCode: null,
      groupId: 'g1',
      groupName: 'grp',
      stationDwells: [],
      stationDwellsConfirmed: true,
      stationLegTravels: [],
      avgTravelTimeSeconds: 600,
      minTravelTimeSeconds: 500,
      executionOrder: 1,
      switchBufferAfterSeconds: 0,
      dwellSlackSeconds: 0,
      ...over,
    } as ShiftScheduleSelectedRoute;
  }

  // 首班正線 NT：起點 N2W-D（非出場站）。出場站＝T3-D、S2W-U（拓樸）。
  const routeNt = makeRoute({
    routeId: 'route-nt',
    routeCode: 'NT',
    routeName: 'N2W→T3',
    stationIds: ['N2W-D', 'T3-D'],
    executionOrder: 1,
    avgTravelTimeSeconds: 600,
  });
  const routeTn = makeRoute({
    routeId: 'route-tn',
    routeCode: 'TN',
    routeName: 'T3→N2W',
    stationIds: ['T3-D', 'N2W-D'],
    executionOrder: 2,
    avgTravelTimeSeconds: 600,
  });
  const routeSt = makeRoute({
    routeId: 'route-st',
    routeCode: 'ST',
    routeName: 'S2W→T3',
    stationIds: ['S2W-U', 'T3-D'],
    executionOrder: 3,
    avgTravelTimeSeconds: 300,
  });
  const selectedRoutes = [routeNt, routeTn, routeSt];

  const sectionCodes: MaintenanceSectionCodeBySection = {
    charging: '',
    carWash: '',
    maintenance: 'M',
    preTrip: '',
    mobile: '',
  };

  function scenarioTimelines(): GeneratedScheduleTimeline[] {
    return [
      {
        row: 1,
        blocks: [
          {
            id: 'svc',
            timelineRow: 1,
            taskType: 'servicing',
            label: '保養',
            anchorStartMinute: 8 * 60,
            plannedStartMinute: 8 * 60,
            plannedEndMinute: 10 * 60,
            travelSeconds: 0,
            dwellSeconds: 0,
            source: 'template_bar',
          },
          {
            id: 'pax',
            timelineRow: 1,
            taskType: 'passenger',
            label: '正線',
            routeId: 'route-nt',
            routeCode: 'NT',
            routeName: 'N2W→T3',
            anchorStartMinute: 10 * 60,
            plannedStartMinute: 10 * 60,
            plannedEndMinute: 10 * 60 + 10,
            travelSeconds: 600,
            dwellSeconds: 0,
            source: 'template_bar',
          },
        ],
      },
    ];
  }

  it('builds the worst-case load-bearing chain (S2W→T3→N2W) ending at first trip', () => {
    const origins = buildMaintenanceFirstTripOriginsFromTopology(topologyFixture());
    const warnings: Array<{ code: string }> = [];
    const next = insertMaintenanceEntryServiceTrips({
      timelines: scenarioTimelines(),
      selectedRoutes,
      firstTripOrigins: origins,
      sectionCodes,
      minimumRecoveryTimeSeconds: 0,
      warnings: warnings as never,
    });

    const entries = next[0]!.blocks
      .filter((block) => block.source === 'entry_service')
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    assert.equal(entries.length, 2, '最壞情況＝兩段載客');
    assert.deepEqual(
      entries.map((b) => b.routeId),
      ['route-st', 'route-tn'],
      '順序：出場站 S2W → T3 → 首班起點 N2W',
    );
    // 末段緊接首班發車
    assert.equal(entries[1]!.plannedEndMinute, 10 * 60);
    // 皆載客（passenger）且不早於保養開始
    for (const entry of entries) {
      assert.equal(entry.taskType, 'passenger');
      assert.ok(entry.plannedStartMinute >= 8 * 60 - 1e-9);
    }
    // 偷保養尾巴：最早一段起點早於保養結束
    assert.ok(entries[0]!.plannedStartMinute < 10 * 60);
    assert.equal(entries[0]!.entryServiceSectionCode, 'M');
  });

  it('still builds worst-case chain when first-trip origin is itself an exit station', () => {
    // 首班 TN 起點 T3 也是出場站；仍應從較遠出場 S2W 長 ST 進場載客
    const timelines = scenarioTimelines();
    timelines[0]!.blocks[1]!.routeId = 'route-tn';
    timelines[0]!.blocks[1]!.routeCode = 'TN';
    timelines[0]!.blocks[1]!.routeName = 'T3→N2W';
    const origins = buildMaintenanceFirstTripOriginsFromTopology(topologyFixture());
    assert.ok(origins.some((o) => o.stationId === 'T3-D'), 'T3 應為出場站');
    const warnings: Array<{ code: string }> = [];
    const next = insertMaintenanceEntryServiceTrips({
      timelines,
      selectedRoutes,
      firstTripOrigins: origins,
      sectionCodes,
      minimumRecoveryTimeSeconds: 0,
      warnings: warnings as never,
    });
    const entries = next[0]!.blocks
      .filter((b) => b.source === 'entry_service')
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.routeId, 'route-st');
    assert.equal(entries[0]!.plannedEndMinute, 10 * 60);
  });

  it('builds chain to N2W even when N2W is also listed as an exit', () => {
    // 對應實務截圖：首班 NT（N2W 起點），N2W／T3／S2W 皆為出場 → 仍應長最壞交路
    const origins = [
      ...buildMaintenanceFirstTripOriginsFromTopology(topologyFixture()),
      {
        stationId: 'N2W-D',
        label: 'N2W下行',
        deadheadSeconds: 0,
        facilityNodeIds: ['fac-p3'],
        facilityLabels: ['P3'],
      },
    ];
    const warnings: Array<{ code: string }> = [];
    const next = insertMaintenanceEntryServiceTrips({
      timelines: scenarioTimelines(),
      selectedRoutes,
      firstTripOrigins: origins,
      sectionCodes,
      minimumRecoveryTimeSeconds: 0,
      warnings: warnings as never,
    });
    const entries = next[0]!.blocks
      .filter((b) => b.source === 'entry_service')
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    assert.ok(entries.length >= 1, 'N2W 雖為出場仍應插入進場載客');
    assert.deepEqual(
      entries.map((b) => b.routeId),
      ['route-st', 'route-tn'],
    );
  });

  it('drops earliest hops that cannot fit before maintenance start', () => {
    const timelines = scenarioTimelines();
    // 保養只有 9:57–10:00，僅容得下末段（TN 10 分鐘也放不下 → 全砍）；改成 9:50 起容 TN
    timelines[0]!.blocks[0]!.plannedStartMinute = 9 * 60 + 50;
    timelines[0]!.blocks[0]!.anchorStartMinute = 9 * 60 + 50;
    const origins = buildMaintenanceFirstTripOriginsFromTopology(topologyFixture());
    const warnings: Array<{ code: string }> = [];
    const next = insertMaintenanceEntryServiceTrips({
      timelines,
      selectedRoutes,
      firstTripOrigins: origins,
      sectionCodes,
      minimumRecoveryTimeSeconds: 0,
      warnings: warnings as never,
    });
    const entries = next[0]!.blocks.filter((b) => b.source === 'entry_service');
    // TN 需 10 分鐘（9:50–10:00），ST 起點 9:45 早於保養開始 9:50 → 砍掉
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.routeId, 'route-tn');
  });

  it('falls back to shorter safe chain when longest would chase previous train', () => {
    // 另車已在 ST 09:45 發車；最長鏈亦要在 ST@09:45 插入會追撞 → 改落地僅 TN（T3 亦為出場站）
    const timelines = scenarioTimelines();
    timelines.push({
      row: 2,
      blocks: [
        {
          id: 'other-st',
          timelineRow: 2,
          taskType: 'passenger',
          label: '正線 ST',
          routeId: 'route-st',
          routeCode: 'ST',
          routeName: 'S2W→T3',
          anchorStartMinute: 9 * 60 + 45,
          plannedStartMinute: 9 * 60 + 45,
          plannedEndMinute: 9 * 60 + 50,
          travelSeconds: 300,
          dwellSeconds: 0,
          source: 'template_bar',
        },
      ],
    });
    const origins = buildMaintenanceFirstTripOriginsFromTopology(topologyFixture());
    const warnings: Array<{ code: string }> = [];
    const next = insertMaintenanceEntryServiceTrips({
      timelines,
      selectedRoutes,
      firstTripOrigins: origins,
      sectionCodes,
      minimumRecoveryTimeSeconds: 0,
      warnings: warnings as never,
    });
    const entries = next[0]!.blocks
      .filter((b) => b.source === 'entry_service')
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    assert.equal(entries.length, 1, '最長不安全時改插較短安全交路');
    assert.equal(entries[0]!.routeId, 'route-tn');
    assert.equal(entries[0]!.plannedEndMinute, 10 * 60);
  });
});

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
    parkIn: '',
    parkOut: '',
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
    // 2026-08-07 更正：調度營運班次不得佔用保養尾巴，整條串必須在保養結束之後
    // 才發車（文件 §10）。留 30 分鐘保養→首班空檔，足夠塞下 15 分鐘的兩段鏈。
    const timelines = scenarioTimelines();
    timelines[0]!.blocks[0]!.plannedEndMinute = 9 * 60 + 30;
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
    // 皆載客（passenger）且不早於保養<strong>結束</strong>——不准佔用保養尾巴
    for (const entry of entries) {
      assert.equal(entry.taskType, 'passenger');
      assert.ok(
        entry.plannedStartMinute >= 9 * 60 + 30 - 1e-9,
        '調度營運班次不得早於保養結束時刻發車',
      );
    }
    assert.equal(entries[0]!.entryServiceSectionCode, 'M');
  });

  it('still builds worst-case chain when first-trip origin is itself an exit station', () => {
    // 首班 TN 起點 T3 也是出場站；仍應從較遠出場 S2W 長 ST 進場載客
    const timelines = scenarioTimelines();
    timelines[0]!.blocks[0]!.plannedEndMinute = 9 * 60 + 30;
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
    assert.ok(entries[0]!.plannedStartMinute >= 9 * 60 + 30 - 1e-9);
  });

  it('builds chain to N2W even when N2W is also listed as an exit', () => {
    // 對應實務截圖：首班 NT（N2W 起點），N2W／T3／S2W 皆為出場 → 仍應長最壞交路
    const timelines = scenarioTimelines();
    timelines[0]!.blocks[0]!.plannedEndMinute = 9 * 60 + 30;
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
    assert.ok(entries.length >= 1, 'N2W 雖為出場仍應插入進場載客');
    assert.deepEqual(
      entries.map((b) => b.routeId),
      ['route-st', 'route-tn'],
    );
  });

  it('drops the longer candidate that cannot fit before first trip, keeps the shorter one', () => {
    // 2026-08-07 更正：邊界不再是「保養開始」（不准偷尾巴，那條界線已作廢），
    // 而是「保養結束→首班」中間的空檔夠不夠長。
    // 空檔 12 分鐘：兩段鏈需 15 分鐘（ST 5 + TN 10）放不下 → 改落地僅 TN（10 分鐘剛好）。
    const timelines = scenarioTimelines();
    timelines[0]!.blocks[0]!.plannedEndMinute = 9 * 60 + 48;
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
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.routeId, 'route-tn');
    assert.ok(entries[0]!.plannedStartMinute >= 9 * 60 + 48 - 1e-9);
  });

  it('falls back to shorter chain when the longer one would arrive while another vehicle is still idling at the shared station', () => {
    // 2026-08-07 更正：舊測試用「車隊物理班距」擋插入，那個機制已移除
    // （調度班次不受班距約束）。改測真正會擋住它的東西——站位淨空：
    // 另一列（row2）跑完一趟後在 T3-D 閒置了一段時間才排下一個任務，
    // 這段閒置期間 T3-D 仍算被它佔著。兩段鏈的 ST 那一段需要在這段閒置期
    // 中途抵達 T3-D，抵達不了 → 改退回只走 TN（TN 只碰 N2W-D，不受影響）。
    //
    // 用專用路線（帶 stationDwells）而非共用的 routeNt：
    // buildBlockStationDepartures 靠 route.stationDwells 才能算出站點窗口，
    // 共用夾具的 routeNt/routeTn/routeSt 全都是空陣列（其他測試從不需要
    // 對它們算窗口，只拿來當鏈接錨點），這裡是唯一需要真正算出窗口的測試。
    const routeNtWithDwell = makeRoute({
      routeId: 'route-nt-dwell',
      routeCode: 'NT',
      routeName: 'N2W→T3',
      stationIds: ['N2W-D', 'T3-D'],
      executionOrder: 1,
      avgTravelTimeSeconds: 600,
      stationDwells: [
        { stationId: 'N2W-D', stationName: 'N2W-D', dwellSeconds: 0, dwellRequired: false },
        { stationId: 'T3-D', stationName: 'T3-D', dwellSeconds: 20, dwellRequired: true },
      ],
    });
    const timelines = scenarioTimelines();
    timelines[0]!.blocks[0]!.plannedEndMinute = 9 * 60 + 30;
    timelines.push({
      row: 2,
      blocks: [
        {
          id: 'other-arrive-t3',
          timelineRow: 2,
          taskType: 'passenger',
          label: '正線 NT',
          routeId: 'route-nt-dwell',
          routeCode: 'NT',
          routeName: 'N2W→T3',
          anchorStartMinute: 9 * 60 + 30,
          plannedStartMinute: 9 * 60 + 30,
          plannedEndMinute: 9 * 60 + 40,
          travelSeconds: 600,
          dwellSeconds: 0,
          source: 'template_bar',
        },
        {
          // row2 的下一個任務要等到 9:55 才開始——9:40 到 9:55 這段，
          // 這台車其實還停在 T3-D（閒置超過門檻，算佔用）。
          // 故意用 route-tn（stationDwells 是空陣列）：這個區塊本身不會產生
          // 任何站位窗（buildBlockStationDepartures 因缺停靠資料回傳空站點），
          // 只用它的 plannedStartMinute 標記「row2 下一個任務何時開始」，
          // 確保這則測試量到的是閒置延伸邏輯本身，不是被第二個窗口意外擋住。
          id: 'other-next-task',
          timelineRow: 2,
          taskType: 'passenger',
          label: '正線 TN',
          routeId: 'route-tn',
          routeCode: 'TN',
          routeName: 'T3→N2W',
          anchorStartMinute: 9 * 60 + 55,
          plannedStartMinute: 9 * 60 + 55,
          plannedEndMinute: 10 * 60 + 5,
          travelSeconds: 600,
          dwellSeconds: 0,
          source: 'template_bar',
        },
      ],
    });
    const origins = buildMaintenanceFirstTripOriginsFromTopology(topologyFixture());
    const warnings: Array<{ code: string }> = [];
    const next = insertMaintenanceEntryServiceTrips({
      timelines,
      selectedRoutes: [...selectedRoutes, routeNtWithDwell],
      firstTripOrigins: origins,
      sectionCodes,
      minimumRecoveryTimeSeconds: 0,
      // 「別的車還停在原地」這件事屬於防碰撞判定的一部分，
      // 碰撞保護時間填 0 就整組關閉；這裡要測的正是它，所以要打開。
      // 給 1 秒（實際加 2 秒）是為了讓保護時間本身幾乎不影響時刻，
      // 單獨驗證「末站滯留也算佔用」這一條。
      collisionProtectionSeconds: 1,
      warnings: warnings as never,
    });
    const entries = next[0]!.blocks
      .filter((b) => b.source === 'entry_service')
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    assert.equal(entries.length, 1, '兩段鏈的 T3-D 站位被別的車佔著，應退回較短鏈');
    assert.equal(entries[0]!.routeId, 'route-tn');
    assert.equal(entries[0]!.plannedEndMinute, 10 * 60);
  });
});

/**
 * 連續整備串（例 充電→行前）要在<strong>串尾</strong>處理外掛班次。
 *
 * 2026-08-08 踩過：舊版處理「串首」。串首是充電時 allowEntryService=false，
 * 第一道檢查就靜默跳掉；串尾的行前又因為「前面是整備」被跳掉——兩邊互推，
 * 整列完全沒有外掛也沒有任何警告。車其實是從串尾出來的，出場站也該由串尾決定。
 */
describe('連續整備串的外掛班次', () => {
  function chainRoute(routeId: string, code: string, stationIds: string[]) {
    return {
      instanceId: routeId,
      routeId,
      routeName: code,
      routeCode: code,
      groupId: 'g',
      groupName: 'g',
      executionOrder: 1,
      avgTravelTimeSeconds: 200,
      minTravelTimeSeconds: 180,
      switchBufferAfterSeconds: 0,
      dwellSlackSeconds: 0,
      stationIds,
      stationDwells: stationIds.map((stationId, index) => ({
        stationId,
        stationName: stationId,
        dwellSeconds: index === 0 ? 0 : 20,
      })),
      stationLegTravels: [],
      stationDwellsConfirmed: true,
      backupForInstanceId: null,
      backupForRouteId: null,
    } as never;
  }
  const NT = chainRoute('nt', 'NT', ['N2W', 'T3D']);
  const TN = chainRoute('tn', 'TN', ['T3U', 'N2W']);
  const chainRoutes = [NT, TN];

  function chainBlock(
    id: string,
    startMinute: number,
    endMinute: number,
    taskType: string,
    label: string,
    routeId?: string,
  ) {
    return {
      id,
      timelineRow: 1,
      taskType,
      label,
      source: 'template_bar',
      travelSeconds: 200,
      dwellSeconds: 20,
      anchorStartMinute: startMinute,
      plannedStartMinute: startMinute,
      plannedEndMinute: endMinute,
      ...(routeId
        ? { routeId, routeCode: 'NT', routeName: 'NT', routeInstanceId: routeId }
        : {}),
    } as never;
  }

  function runChain(blocks: never[]) {
    const warnings: never[] = [];
    const out = insertMaintenanceEntryServiceTrips({
      timelines: [{ row: 1, blocks }] as never,
      selectedRoutes: chainRoutes as never,
      firstTripOrigins: [{
        stationId: 'T3U',
        label: 'T3U',
        deadheadSeconds: 0,
        facilityNodeIds: ['fac-h1', 'fac-c1'],
        facilityLabels: ['H1', 'C1'],
      }] as never,
      maintenanceBody: {
        preTrip: { stepEnabled: true, equipmentRows: [{ id: 'fac-h1', mapCode: 'H1' }] },
        charging: { stepEnabled: true, equipmentRows: [{ id: 'fac-c1', mapCode: 'C1' }] },
      },
      sectionCodes: null,
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
      warnings: warnings as never,
    });
    return out[0]!.blocks.filter((block) => block.source === 'entry_service');
  }

  /** 行前 09:30–10:00（出場站 T3U），10:24 起第一班正線 NT（起點 N2W） */
  const inspection = chainBlock('insp', 570, 600, 'inspection', '行前');
  const afterMainline = chainBlock('after', 624, 627.5, 'passenger', '正線', 'nt');

  it('行前單獨時插入外掛把車從 T3U 送到 N2W', () => {
    const entries = runChain([inspection, afterMainline] as never);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.routeId, 'tn');
  });

  it('充電→行前 串：仍要插外掛（車是從串尾的行前出來的）', () => {
    const charging = chainBlock('chg', 480, 570, 'charging', '充電');
    const entries = runChain([charging, inspection, afterMainline] as never);
    assert.equal(
      entries.length,
      1,
      '串首是充電（不產生外掛）不代表整串都不用；車從串尾的行前出來，仍需外掛',
    );
    assert.equal(entries[0]!.routeId, 'tn');
  });

  it('保養→行前 串：同樣只在串尾插一次', () => {
    const servicing = chainBlock('mnt', 480, 570, 'servicing', '保養');
    const entries = runChain([servicing, inspection, afterMainline] as never);
    assert.equal(entries.length, 1, '整串只插一次，不可保養與行前各插一次');
    assert.equal(entries[0]!.routeId, 'tn');
  });
});

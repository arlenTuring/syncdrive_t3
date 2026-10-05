import {
  assessSimulationReadiness,
  contentDigest,
  readShiftMapReference,
} from './dispatch.simulation-plan';
import type { PlannedDispatch } from './dispatch.plan';

const mapDocument = {
  pointTopology: {
    nodes: [
      { id: '1', stationId: 'st-1' },
      { id: '2', stationId: 'st-2' },
      { id: '3' },
    ],
  },
  routes: [{ routeId: 'route-a', stationIds: ['st-1', 'st-2'] }],
};

function planned(overrides: Partial<PlannedDispatch> = {}): PlannedDispatch {
  return {
    kind: 'passenger',
    maintenance: null,
    orderId: 'o',
    tripCode: 'D0900',
    vehicleCode: 'PMS01',
    timelineRow: 1,
    taskType: 'passenger',
    cardLabel: '',
    routeCode: 'A',
    routeName: 'A',
    departAt: 0,
    arriveAt: 1,
    origin: {
      id: 'st-1',
      name: '起站',
      kind: 'station',
      arriveAt: null,
      departAt: 0,
    },
    destination: {
      id: 'st-2',
      name: '終站',
      kind: 'station',
      arriveAt: 1,
      departAt: null,
    },
    stations: [],
    ...overrides,
  };
}

const base = {
  hasSchedulePlan: true,
  publishBlockReason: null,
  mapId: 'map-B',
  mapDocument,
  mapLookupError: null,
  selectedRouteIds: ['route-a'],
  planned: [planned()],
  skipped: [],
  resolveFacility: (id: string) => id === 'E1',
  generatedAt: '2026-10-01T00:00:00.000Z',
  mapUpdatedAt: '2026-09-30T00:00:00.000Z',
};

describe('模擬計畫的可執行檢查', () => {
  it('資料齊全：可以模擬，並照實說明無法保證歷史地圖版本', () => {
    const result = assessSimulationReadiness(base);
    expect(result.simulatable).toBe(true);
    expect(result.warnings.join()).toContain('沒有記錄製作當時的地圖版本');
  });

  it('班表沒記地圖：不能模擬，也不改用目前啟用的地圖', () => {
    const result = assessSimulationReadiness({
      ...base,
      mapId: null,
      mapDocument: null,
    });
    expect(result.simulatable).toBe(false);
    expect(result.blockingReasons.join()).toContain('不會改用目前啟用的地圖');
  });

  it('引用的地圖不存在：不能模擬', () => {
    const result = assessSimulationReadiness({
      ...base,
      mapDocument: null,
      mapLookupError: 'Published map not found: map-B',
    });
    expect(result.simulatable).toBe(false);
    expect(result.blockingReasons.join()).toContain('找不到');
  });

  it('站點、設施、路線解析不到：逐一列出，不能模擬', () => {
    const result = assessSimulationReadiness({
      ...base,
      selectedRouteIds: ['route-a', 'route-x'],
      planned: [
        planned({
          destination: {
            id: 'st-9',
            name: '?',
            kind: 'station',
            arriveAt: 1,
            departAt: null,
          },
        }),
        planned({
          kind: 'maintenance',
          origin: {
            id: 'Z9',
            name: 'Z9',
            kind: 'facility',
            arriveAt: null,
            departAt: 0,
          },
        }),
      ],
    });
    expect(result.simulatable).toBe(false);
    expect(result.unresolvedStations).toEqual(['st-9']);
    expect(result.unresolvedFacilities).toEqual(['Z9']);
    expect(result.missingRoutes).toEqual(['route-x']);
  });

  it('區域元件（停靠點、途經點、格位設施）跟車端一樣以地圖檔解析，不誤判', () => {
    const result = assessSimulationReadiness({
      ...base,
      mapDocument: {
        ...mapDocument,
        areas: [
          {
            facilities: [
              { id: '096', type: 'DockingPoint' },
              { id: '149', type: 'Facility', customName: 'E3' },
              { id: '170', type: 'Waypoint', parameters: { waypointCode: '161' } },
              { id: '072', type: 'TrackCrossover', parameters: { trackCrossoverPortals: { a: { waypointCode: 'xo_1_a' } } } },
            ],
          },
        ],
      },
      planned: [
        planned({
          kind: 'movement',
          destination: { id: '096', name: '停靠點', kind: 'facility', arriveAt: 1, departAt: null },
          stations: [
            { stationId: '161' },
            { stationId: '149' },
            { stationId: 'E3' },
            { stationId: 'xo_1_a' },
          ] as PlannedDispatch['stations'],
        }),
      ],
    });
    expect(result.unresolvedStations).toEqual([]);
    expect(result.unresolvedFacilities).toEqual([]);
    expect(result.simulatable).toBe(true);
  });

  it('有任務被略過：不能宣稱完整載入', () => {
    const result = assessSimulationReadiness({
      ...base,
      skipped: [{ tripCode: 'D0901', reason: '時間線第 3 列沒有對應車輛' }],
    });
    expect(result.simulatable).toBe(false);
    expect(result.blockingReasons.join()).toContain('D0901');
  });

  it('沒有排班結果、或有發布阻擋：不能模擬', () => {
    expect(
      assessSimulationReadiness({
        ...base,
        hasSchedulePlan: false,
        planned: [],
      }).simulatable,
    ).toBe(false);
    expect(
      assessSimulationReadiness({
        ...base,
        publishBlockReason: '有未解決的衝突',
      }).simulatable,
    ).toBe(false);
  });

  it('地圖在班表製作之後被改過：提出警告', () => {
    const result = assessSimulationReadiness({
      ...base,
      mapUpdatedAt: '2026-10-02T00:00:00.000Z',
    });
    expect(result.warnings.join()).toContain('被修改過');
  });
});

describe('班表引用與版本摘要', () => {
  it('地圖引用只讀班表自己存的 routeGroupsRef', () => {
    expect(
      readShiftMapReference({
        scheduleOutput: {
          routeGroupsRef: { mapId: 'map-B', selectedRouteIds: ['r1'] },
        },
      }),
    ).toEqual({ mapId: 'map-B', selectedRouteIds: ['r1'] });
    expect(readShiftMapReference({})).toEqual({
      mapId: null,
      selectedRouteIds: [],
    });
  });

  it('摘要與鍵順序無關、內容一變就不同', () => {
    expect(contentDigest({ a: 1, b: [1, 2] })).toBe(
      contentDigest({ b: [1, 2], a: 1 }),
    );
    expect(contentDigest({ a: 1 })).not.toBe(contentDigest({ a: 2 }));
  });
});

import { checkMapActivation, mapDocumentRoutes } from './map-activation';

const shiftBody = {
  selectedRoutes: [
    {
      routeId: 'route_1',
      routeName: 'N2W下行>T3下行',
      stationIds: ['n2w_d_start', 't3_d'],
    },
    { routeId: 'route_2', routeCode: 'TS', stationIds: ['t3_d', 's2w_d_end'] },
  ],
};

const deployed = { shiftId: 'OS-1', shiftName: '模擬正線', body: shiftBody };

function candidate(
  routes: Array<{ routeId: string; stationIds: string[] }>,
  stations: string[],
) {
  return {
    mapId: 'map-b',
    displayName: 'B',
    routes,
    stationIds: new Set(stations),
  };
}

describe('checkMapActivation', () => {
  const current = { mapId: 'map-a', displayName: 'A' };

  it('部署中的班表路線與站點都在：可以切換', () => {
    const result = checkMapActivation({
      candidate: candidate(
        [
          { routeId: 'route_1', stationIds: ['n2w_d_start', 't3_d'] },
          { routeId: 'route_2', stationIds: ['t3_d', 's2w_d_end'] },
        ],
        ['n2w_d_start', 't3_d', 's2w_d_end'],
      ),
      currentActive: current,
      deployedShift: deployed,
    });
    expect(result.canActivate).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.alreadyActive).toBe(false);
  });

  it('少了部署班表用到的路線與站點：擋下', () => {
    const result = checkMapActivation({
      candidate: candidate(
        [{ routeId: 'route_1', stationIds: ['n2w_d_start', 't3_d'] }],
        ['n2w_d_start', 't3_d'],
      ),
      currentActive: current,
      deployedShift: deployed,
    });
    expect(result.canActivate).toBe(false);
    expect(result.blockers.map((issue) => issue.code)).toEqual([
      'ROUTE_MISSING',
      'STATION_MISSING',
    ]);
    expect(result.blockers[0].message).toContain('TS（route_2）');
    expect(result.blockers[1].message).toContain('s2w_d_end');
  });

  it('路線在但站序不同：只提醒', () => {
    const result = checkMapActivation({
      candidate: candidate(
        [
          { routeId: 'route_1', stationIds: ['n2w_d_start', 't3_d'] },
          { routeId: 'route_2', stationIds: ['t3_d', 'x', 's2w_d_end'] },
        ],
        ['n2w_d_start', 't3_d', 's2w_d_end', 'x'],
      ),
      currentActive: current,
      deployedShift: deployed,
    });
    expect(result.canActivate).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toEqual([
      'ROUTE_STATIONS_CHANGED',
    ]);
  });

  it('沒有部署班表：只看地圖本身；沒站點擋下、沒路線提醒', () => {
    const empty = checkMapActivation({
      candidate: candidate([], []),
      currentActive: current,
      deployedShift: null,
    });
    expect(empty.blockers.map((issue) => issue.code)).toEqual(['NO_STATIONS']);
    expect(empty.warnings.map((issue) => issue.code)).toEqual(['NO_ROUTES']);

    const ok = checkMapActivation({
      candidate: candidate([], ['a']),
      currentActive: { mapId: 'map-b', displayName: 'B' },
      deployedShift: null,
    });
    expect(ok.canActivate).toBe(true);
    expect(ok.alreadyActive).toBe(true);
  });
});

describe('mapDocumentRoutes', () => {
  it('讀 mapDocument.routes，略過沒有 routeId 的', () => {
    expect(
      mapDocumentRoutes({
        routes: [
          { routeId: 'r1', displayName: 'R1', stationIds: ['a', 'b'] },
          { displayName: 'x' },
        ],
      }),
    ).toEqual([{ routeId: 'r1', displayName: 'R1', stationIds: ['a', 'b'] }]);
    expect(mapDocumentRoutes(undefined)).toEqual([]);
  });
});

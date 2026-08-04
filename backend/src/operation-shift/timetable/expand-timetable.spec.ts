import {
  expandStationEtas,
  expandTimetableTrips,
  groupStationEtasIncludingMapAliases,
  parseTimeRangeQuery,
} from './expand-timetable';
import { buildTimetableStationStops } from './build-station-stops';
import { parseClockToSecond, formatSecondToHms } from './clock';

describe('timetable clock', () => {
  it('parses HH:MM:SS', () => {
    expect(parseClockToSecond('00:11:30')).toBe(11 * 60 + 30);
    expect(formatSecondToHms(11 * 60 + 30)).toBe('00:11:30');
  });

  it('defaults full-day range', () => {
    expect(parseTimeRangeQuery({})).toEqual({
      fromSecond: 0,
      toSecond: 24 * 3600,
    });
  });
});

describe('expandTimetableTrips', () => {
  const body = {
    selectedRoutes: [
      {
        routeId: 'st',
        routeName: 'S2W上行 > T3上行',
        routeCode: 'ST',
        stationIds: ['s2w', 't3'],
        stationDwells: [
          { stationId: 's2w', stationName: 'S2W', dwellSeconds: 0, dwellRequired: false },
          { stationId: 't3', stationName: 'T3上行', dwellSeconds: 40 },
        ],
        stationLegTravels: [
          {
            fromStationId: 's2w',
            toStationId: 't3',
            avgTravelTimeSeconds: 100,
            minTravelTimeSeconds: 100,
          },
        ],
        minTravelTimeSeconds: 100,
        avgTravelTimeSeconds: 100,
        dwellSlackSeconds: 5,
      },
      {
        routeId: 'tn',
        routeName: 'T3上行 > N2W上行',
        routeCode: 'TN',
        stationIds: ['t3', 'n2w'],
        stationDwells: [
          { stationId: 't3', stationName: 'T3上行', dwellSeconds: 0, dwellRequired: false },
          { stationId: 'n2w', stationName: 'N2W', dwellSeconds: 40 },
        ],
        stationLegTravels: [
          {
            fromStationId: 't3',
            toStationId: 'n2w',
            avgTravelTimeSeconds: 100,
            minTravelTimeSeconds: 100,
          },
        ],
        minTravelTimeSeconds: 100,
        avgTravelTimeSeconds: 100,
        dwellSlackSeconds: 5,
      },
    ],
    scheduleOutput: {
      generatedAt: '2026-08-04T00:00:00.000Z',
      plan: {
        generatedAt: '2026-08-04T00:00:00.000Z',
        scheduleRowCount: 1,
        timelines: [
          {
            row: 1,
            blocks: [
              {
                id: 'b-st',
                timelineRow: 1,
                taskType: 'passenger',
                routeId: 'st',
                routeCode: 'ST',
                routeName: 'S2W上行 > T3上行',
                plannedStartMinute: (7 * 60 + 40) / 60,
                plannedEndMinute: (11 * 60 + 30) / 60,
                source: 'template_bar',
              },
              {
                id: 'b-tn',
                timelineRow: 1,
                taskType: 'passenger',
                routeId: 'tn',
                routeCode: 'TN',
                routeName: 'T3上行 > N2W上行',
                plannedStartMinute: (11 * 60 + 30) / 60,
                plannedEndMinute: (15 * 60 + 10) / 60,
                source: 'template_bar',
              },
            ],
          },
        ],
      },
    },
  };

  it('expands trips with origin depart = card start', () => {
    const trips = expandTimetableTrips({
      body,
      range: parseTimeRangeQuery({}),
    });
    expect(trips).toHaveLength(2);
    expect(trips[0]!.trip_code).toBe('ST0007');
    expect(trips[0]!.card_start).toBe('00:07:40');
    expect(trips[0]!.stations[0]!.role).toBe('origin');
    expect(trips[0]!.stations[0]!.departure).toBe('00:07:40');
    expect(trips[0]!.stations[0]!.arrival).toBeNull();
    const last = trips[0]!.stations[trips[0]!.stations.length - 1]!;
    expect(last.role).toBe('terminal');
    expect(last.dwell_complete).toBe('00:11:30');
    expect(trips[1]!.stations[0]!.departure).toBe('00:11:30');
  });

  it('filters by time range on card overlap', () => {
    const trips = expandTimetableTrips({
      body,
      range: parseTimeRangeQuery({ from: '00:12:00', to: '00:16:00' }),
    });
    expect(trips.map((t) => t.trip_code)).toEqual(['TN0011']);
  });

  it('builds station etas filtered by window', () => {
    const etas = expandStationEtas({
      body,
      range: parseTimeRangeQuery({ from: '00:11:00', to: '00:12:00' }),
      stationId: 't3',
    });
    expect(etas.length).toBeGreaterThan(0);
    expect(etas.every((e) => e.station_id === 't3')).toBe(true);
    expect(etas.every((e) => e.vehicle_id === null)).toBe(true);
    expect(etas.every((e) => typeof e.base_dwell_seconds === 'number')).toBe(true);
    expect(etas.every((e) => typeof e.buffer_seconds === 'number')).toBe(true);
    expect(etas.every((e) => typeof e.station_alias === 'string')).toBe(true);
    expect(etas.every((e) => typeof e.non_stop === 'boolean')).toBe(true);
  });

  it('filters virtual crossover portals from passenger-stop etas', () => {
    const withXo = {
      selectedRoutes: [
        {
          routeId: 'tn',
          routeName: 'TN',
          routeCode: 'TN',
          stationIds: ['t3', 'xo_1_a', 'n2w'],
          stationDwells: [
            { stationId: 't3', stationName: 'T3', dwellSeconds: 0, dwellRequired: false },
            { stationId: 'xo_1_a', stationName: '渡線', dwellSeconds: 0, dwellRequired: false },
            { stationId: 'n2w', stationName: 'N2W', dwellSeconds: 40 },
          ],
          stationLegTravels: [
            { fromStationId: 't3', toStationId: 'xo_1_a', avgTravelTimeSeconds: 50, minTravelTimeSeconds: 50 },
            { fromStationId: 'xo_1_a', toStationId: 'n2w', avgTravelTimeSeconds: 50, minTravelTimeSeconds: 50 },
          ],
          minTravelTimeSeconds: 100,
          avgTravelTimeSeconds: 100,
          dwellSlackSeconds: 0,
        },
      ],
      scheduleOutput: {
        plan: {
          timelines: [
            {
              row: 1,
              blocks: [
                {
                  id: 'b1',
                  timelineRow: 1,
                  taskType: 'passenger',
                  routeId: 'tn',
                  routeCode: 'TN',
                  plannedStartMinute: 0,
                  plannedEndMinute: 150 / 60,
                  source: 'template_bar',
                },
              ],
            },
          ],
        },
      },
    };
    const etas = expandStationEtas({
      body: withXo,
      range: parseTimeRangeQuery({}),
      passengerStopsOnly: true,
    });
    expect(etas.every((e) => e.station_id !== 'xo_1_a')).toBe(true);
    expect(etas.some((e) => e.station_id === 't3')).toBe(true);
    expect(etas.some((e) => e.station_id === 'n2w')).toBe(true);
  });
});

describe('groupStationEtasIncludingMapAliases', () => {
  it('includes map docking aliases even when eta count is 0', () => {
    const mapDocument = {
      areas: [
        {
          facilities: [
            {
              id: 'd1',
              type: 'DockingPoint',
              customName: '[備用]N2W上行停靠',
              parameters: { stationId: 'station_1', refFieldXM: 1, refFieldYM: 2 },
            },
            {
              id: 'd2',
              type: 'DockingPoint',
              customName: 'N2W下行出發',
              parameters: { stationId: 'station_2', refFieldXM: 3, refFieldYM: 4 },
            },
            {
              id: 'f1',
              type: 'Platform',
              customName: 'P1',
              parameters: {
                facilityDockingPoint: { xM: 10, yM: 20, alias: 'P1停靠點' },
              },
            },
          ],
        },
      ],
    };
    const groups = groupStationEtasIncludingMapAliases({
      etas: [
        {
          station_id: 'station_2',
          station_alias: 'N2W下行出發',
          station_name: 'N2W下行出發',
          role: 'intermediate',
          eta_arrive: '00:01:00',
          eta_depart: '00:01:30',
          eta_arrive_second: 60,
          eta_depart_second: 90,
          non_stop: false,
          base_dwell_seconds: 30,
          dwell_seconds: 30,
          buffer_seconds: 0,
          trip_code: 'NT0001',
          block_id: 'b1',
          timeline_row: 1,
          route_code: 'NT',
          route_name: 'NT',
          vehicle_id: null,
        },
      ],
      mapDocument,
    });
    const byId = Object.fromEntries(groups.map((g) => [g.station_id, g]));
    expect(byId.station_1?.station_alias).toBe('[備用]N2W上行停靠');
    expect(byId.station_1?.eta_count).toBe(0);
    expect(byId.station_2?.eta_count).toBe(1);
    expect(byId['fdock:f1']?.station_alias).toBe('P1停靠點');
    expect(byId['fdock:f1']?.eta_count).toBe(0);
  });

  it('includes docking points even without coordinates', () => {
    const mapDocument = {
      areas: [
        {
          facilities: [
            {
              id: 'd7',
              type: 'DockingPoint',
              customName: 'S2W上行出發',
              parameters: { stationId: 'station_7', refFieldXM: null, refFieldYM: null },
            },
          ],
        },
      ],
    };
    const groups = groupStationEtasIncludingMapAliases({
      etas: [],
      mapDocument,
    });
    expect(groups).toEqual([
      expect.objectContaining({
        station_id: 'station_7',
        station_alias: 'S2W上行出發',
        eta_count: 0,
      }),
    ]);
  });
});

describe('buildTimetableStationStops', () => {
  it('absorbs trailer into terminal dwell_complete', () => {
    const stops = buildTimetableStationStops(
      {
        id: 'b1',
        timelineRow: 1,
        taskType: 'passenger',
        plannedStartMinute: 0,
        plannedEndMinute: 160 / 60,
        routeId: 'r1',
      },
      {
        routeId: 'r1',
        stationIds: ['a', 'b'],
        stationDwells: [
          { stationId: 'a', stationName: 'A', dwellSeconds: 0, dwellRequired: false },
          { stationId: 'b', stationName: 'B', dwellSeconds: 40 },
        ],
        stationLegTravels: [
          {
            fromStationId: 'a',
            toStationId: 'b',
            avgTravelTimeSeconds: 100,
            minTravelTimeSeconds: 100,
          },
        ],
        minTravelTimeSeconds: 100,
        avgTravelTimeSeconds: 100,
        dwellSlackSeconds: 0,
      },
    );
    expect(stops).toHaveLength(2);
    expect(stops[1]!.departureSecond).toBe(160);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveYardDispatchPrefixForBlock,
  scrubMidMainlineDispatchArtifacts,
  tagYardDispatchTrips,
} from './tagYardDispatchTrips';
import type { GeneratedScheduleBlock } from './types';
import type { MaintenanceFirstTripOrigin } from '../maintenanceFirstTripOrigins';
import type { MaintenanceSectionCodeBySection } from '../maintenanceSectionCode';

const ORIGINS_T3: MaintenanceFirstTripOrigin[] = [
  {
    stationId: 'T3',
    label: 'T3上行',
    deadheadSeconds: 0,
    facilityNodeIds: ['fac-A'],
    facilityLabels: ['A'],
  },
  {
    stationId: 'N2W',
    label: 'N2W上行',
    deadheadSeconds: 120,
    facilityNodeIds: ['fac-B'],
    facilityLabels: ['B'],
  },
];

const SECTION_CODES: MaintenanceSectionCodeBySection = {
  charging: 'C',
  carWash: 'W',
  maintenance: 'M',
  preTrip: 'P',
  mobile: 'S',
  parkIn: 'I',
  parkOut: 'O',
};

function makeBlock(overrides: Partial<GeneratedScheduleBlock> & { id: string }): GeneratedScheduleBlock {
  return {
    id: overrides.id,
    timelineRow: 1,
    taskType: 'inspection',
    label: 'test',
    anchorStartMinute: 0,
    plannedStartMinute: 0,
    plannedEndMinute: 10,
    travelSeconds: 0,
    dwellSeconds: 0,
    source: 'template_bar',
    ...overrides,
  };
}

describe('resolveYardDispatchPrefixForBlock', () => {
  it('always returns PTN after inspection even when exit station == TN first station (T3)', () => {
    // 產品規則：保養／行前都在 T3 發車可走 TN，仍要掛代號（不是一般首班）
    const result = resolveYardDispatchPrefixForBlock({
      yardBlock: makeBlock({ id: 'y1', taskType: 'inspection' }),
      passengerBlock: makeBlock({
        id: 'p1',
        taskType: 'passenger',
        routeCode: 'TN',
        source: 'template_bar',
        firstTripOriginStationId: 'T3',
      }),
      origins: ORIGINS_T3,
      maintenanceBody: {
        preTrip: { stepEnabled: true, equipmentRows: [{ mapCode: 'A' }] },
      },
      sectionCodes: SECTION_CODES,
      selectedRoutes: [
        {
          routeId: 'r-tn',
          routeName: 'TN',
          routeCode: 'TN',
          stationIds: ['T3', 'N2W'],
          avgTravelTimeSeconds: 100,
          minTravelTimeSeconds: 80,
          stationDwells: [],
          dwellSlackSeconds: 0,
          switchBufferAfterSeconds: 0,
          executionOrder: 1,
        } as never,
      ],
    });
    assert.equal(result, 'PTN');
  });

  it('returns MNT after servicing', () => {
    const result = resolveYardDispatchPrefixForBlock({
      yardBlock: makeBlock({ id: 'y2', taskType: 'servicing' }),
      passengerBlock: makeBlock({
        id: 'p2',
        taskType: 'passenger',
        routeCode: 'NT',
        source: 'template_bar',
      }),
      origins: ORIGINS_T3,
      maintenanceBody: {},
      sectionCodes: SECTION_CODES,
    });
    assert.equal(result, 'MNT');
  });

  it('returns null when sectionCodes has no preTrip code', () => {
    const result = resolveYardDispatchPrefixForBlock({
      yardBlock: makeBlock({ id: 'y5', taskType: 'inspection' }),
      passengerBlock: makeBlock({ id: 'p5', taskType: 'passenger', routeCode: 'TN', source: 'template_bar' }),
      origins: ORIGINS_T3,
      maintenanceBody: {},
      sectionCodes: { ...SECTION_CODES, preTrip: '' },
    });
    assert.equal(result, null);
  });

  it('returns CTN for charging', () => {
    const result = resolveYardDispatchPrefixForBlock({
      yardBlock: makeBlock({ id: 'y6', taskType: 'charging' }),
      passengerBlock: makeBlock({ id: 'p6', taskType: 'passenger', routeCode: 'TN', source: 'template_bar' }),
      origins: [],
      maintenanceBody: {},
      sectionCodes: SECTION_CODES,
    });
    assert.equal(result, 'CTN');
  });
});

describe('tagYardDispatchTrips', () => {
  it('tags first passenger after inspection with PNT', () => {
    const timelines = tagYardDispatchTrips({
      timelines: [
        {
          row: 1,
          blocks: [
            makeBlock({
              id: 'insp',
              taskType: 'inspection',
              plannedStartMinute: 9 * 60 + 30,
              plannedEndMinute: 10 * 60,
            }),
            makeBlock({
              id: 'pax',
              taskType: 'passenger',
              routeCode: 'TN',
              routeId: 'r-tn',
              plannedStartMinute: 10 * 60 + 2,
              plannedEndMinute: 10 * 60 + 6,
              source: 'template_bar',
            }),
          ],
        },
      ],
      origins: ORIGINS_T3,
      maintenanceBody: {},
      sectionCodes: SECTION_CODES,
    });
    assert.equal(timelines[0]!.blocks.find((b) => b.id === 'pax')?.yardDispatchPrefix, 'PTN');
  });

  it('tags with trailing yard code on charging→servicing→inspection chain (P wins)', () => {
    const timelines = tagYardDispatchTrips({
      timelines: [
        {
          row: 1,
          blocks: [
            makeBlock({
              id: 'chg',
              taskType: 'charging',
              plannedStartMinute: 5 * 60 + 40,
              plannedEndMinute: 7 * 60 + 10,
            }),
            makeBlock({
              id: 'svc',
              taskType: 'servicing',
              plannedStartMinute: 7 * 60 + 10,
              plannedEndMinute: 10 * 60 + 50,
            }),
            makeBlock({
              id: 'insp',
              taskType: 'inspection',
              plannedStartMinute: 10 * 60 + 50,
              plannedEndMinute: 11 * 60 + 20,
            }),
            makeBlock({
              id: 'pax',
              taskType: 'passenger',
              routeCode: 'TN',
              plannedStartMinute: 11 * 60 + 26,
              plannedEndMinute: 11 * 60 + 30,
              source: 'template_bar',
            }),
          ],
        },
      ],
      origins: ORIGINS_T3,
      maintenanceBody: {},
      sectionCodes: SECTION_CODES,
    });
    assert.equal(timelines[0]!.blocks.find((b) => b.id === 'pax')?.yardDispatchPrefix, 'PTN');
  });

  it('tags first passenger after servicing-only with M', () => {
    const timelines = tagYardDispatchTrips({
      timelines: [
        {
          row: 1,
          blocks: [
            makeBlock({
              id: 'svc',
              taskType: 'servicing',
              plannedStartMinute: 14 * 60 + 30,
              plannedEndMinute: 17 * 60 + 30,
            }),
            makeBlock({
              id: 'pax',
              taskType: 'passenger',
              routeCode: 'NT',
              plannedStartMinute: 17 * 60 + 30 + 0.5,
              plannedEndMinute: 17 * 60 + 34,
              source: 'template_bar',
            }),
          ],
        },
      ],
      origins: ORIGINS_T3,
      maintenanceBody: {},
      sectionCodes: SECTION_CODES,
    });
    assert.equal(timelines[0]!.blocks.find((b) => b.id === 'pax')?.yardDispatchPrefix, 'MNT');
  });

  it('does not tag when yard is preceded by mainline passenger', () => {
    const timelines = tagYardDispatchTrips({
      timelines: [
        {
          row: 1,
          blocks: [
            makeBlock({
              id: 'earlier',
              taskType: 'passenger',
              routeCode: 'ST',
              plannedStartMinute: 9 * 60,
              plannedEndMinute: 9 * 60 + 4,
              source: 'template_bar',
            }),
            makeBlock({
              id: 'insp',
              taskType: 'inspection',
              plannedStartMinute: 9 * 60 + 30,
              plannedEndMinute: 10 * 60,
            }),
            makeBlock({
              id: 'pax',
              taskType: 'passenger',
              routeCode: 'TN',
              plannedStartMinute: 10 * 60 + 2,
              plannedEndMinute: 10 * 60 + 6,
              source: 'template_bar',
            }),
          ],
        },
      ],
      origins: ORIGINS_T3,
      maintenanceBody: {},
      sectionCodes: SECTION_CODES,
    });
    assert.equal(timelines[0]!.blocks.find((b) => b.id === 'pax')?.yardDispatchPrefix, undefined);
  });
});

describe('scrubMidMainlineDispatchArtifacts', () => {
  it('clears yardDispatchPrefix when passenger follows another passenger', () => {
    const timelines = scrubMidMainlineDispatchArtifacts([
      {
        row: 1,
        blocks: [
          makeBlock({
            id: 'a',
            taskType: 'passenger',
            routeCode: 'TS',
            plannedStartMinute: 10,
            plannedEndMinute: 14,
            source: 'template_bar',
          }),
          makeBlock({
            id: 'b',
            taskType: 'passenger',
            routeCode: 'TN',
            plannedStartMinute: 14,
            plannedEndMinute: 18,
            source: 'template_bar',
            yardDispatchPrefix: 'MTN',
          }),
        ],
      },
    ]);
    assert.equal(timelines[0]!.blocks.find((b) => b.id === 'b')?.yardDispatchPrefix, undefined);
  });
});

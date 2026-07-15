import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  emptyShiftScheduleCreateDraft,
  type ShiftScheduleCreateDraft,
  type ShiftScheduleSelectedRoute,
} from '../types/create';
import type { ScheduleTask } from '../../time-templates/types/editor';
import { generateShiftSchedule } from './schedule-engine/generate';
import { expandRowBlocks } from './schedule-engine/expand';
import {
  generateDeparturesFromHeadway,
  assignDeparturesToEarliestTimeline,
  buildIntervalEndSecondByDepartureStart,
} from './schedule-engine/generateDepartures';
import type { FeasibilityIssue } from './schedule-engine/types';

function passengerRoute(
  id: string,
  name: string,
  avg: number,
  min: number,
  order: number,
  dwellSeconds = 180,
  switchBufferAfterSeconds = 0,
  dwellSlackPercent = 0,
): ShiftScheduleSelectedRoute {
  return {
    routeId: id,
    routeName: name,
    groupId: 'g1',
    groupName: 'G1',
    stationIds: ['S1'],
    stationDwells: [
      { stationId: 'S1', stationName: 'S1', dwellSeconds },
    ],
    stationDwellsConfirmed: true,
    avgTravelTimeSeconds: avg,
    minTravelTimeSeconds: min,
    executionOrder: order,
    switchBufferAfterSeconds,
    dwellSlackPercent,
  };
}

function buildDraft(
  patch: Partial<ShiftScheduleCreateDraft> = {},
): ShiftScheduleCreateDraft {
  return {
    ...emptyShiftScheduleCreateDraft(),
    timeTemplate: {
      templateId: 'TT-1',
      templateName: '模板',
    },
    routeGroups: {
      mapId: 'map-1',
      selectedRoutes: [passengerRoute('r1', '路線 A', 1080, 900, 1)],
      minimumRecoveryTimeSeconds: 30,
    },
    ...patch,
  };
}

function templateBody(tasks: ScheduleTask[], scheduleRowCount = 2, headwaySeconds = 600) {
  return {
    editorVersion: 1,
    vehicleCapacity: 50,
    scheduleRowCount,
    attributes: [
      {
        id: 'attr-1',
        name: '尖峰',
        color: '#ff0000',
        headwaySeconds,
        capacityPphpd: 300,
        isDraft: false,
      },
    ],
    intervals: [
      {
        id: 'slot-1',
        attributeId: 'attr-1',
        name: '早尖峰',
        startTime: '06:00',
        endTime: '22:00',
        isDraft: false,
      },
    ],
    tasks,
  };
}

describe('generateShiftSchedule', () => {
  it('expands passenger blocks with route physics and transition gaps', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 600,
        durationMinutes: 30,
        label: '正線',
      },
    ];

    const result = generateShiftSchedule({
      draft: buildDraft(),
      templateBody: templateBody(tasks, 1),
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, true);
    assert.ok(result.plan);
    const blocks = result.plan!.timelines[0]!.blocks;
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.travelSeconds, 1080);
    assert.equal(blocks[0]!.dwellSeconds, 180);
    assert.equal(blocks[0]!.plannedStartMinute, 600);
    assert.equal(blocks[0]!.plannedEndMinute, 621);
  });

  it('inserts transition block when physics end is before next anchor', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 600,
        durationMinutes: 30,
        label: '正線 1',
      },
      {
        id: 't2',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 630,
        durationMinutes: 30,
        label: '正線 2',
      },
    ];

    const result = generateShiftSchedule({
      draft: buildDraft(),
      templateBody: templateBody(tasks, 1),
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, true);
    const blocks = result.plan!.timelines[0]!.blocks;
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.source, 'template_bar');
    assert.equal(blocks[1]!.source, 'transition');
    assert.equal(blocks[1]!.taskType, 'idle');
    assert.equal(blocks[1]!.plannedStartMinute, 621);
    assert.equal(blocks[1]!.plannedEndMinute, 630);
  });

  it('fails when physics end exceeds next anchor on same timeline', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 600,
        durationMinutes: 15,
        label: '正線 1',
      },
      {
        id: 't2',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 615,
        durationMinutes: 30,
        label: '正線 2',
      },
    ];

    const result = generateShiftSchedule({
      draft: buildDraft(),
      templateBody: templateBody(tasks, 1),
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, false);
    assert.equal(result.plan, null);
    assert.ok(
      result.report.errors.some((issue) => issue.code === 'ANCHOR_CONFLICT'),
    );
  });

  it('flags headway physically impossible across departures', () => {
    // 單車最短一圈 ≈ 900+180=1080s；2 時間線物理班距下限 ≈ 540s
    // 相鄰發車僅隔 300s → 即使兩車並行仍不可達
    const tasks: ScheduleTask[] = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 600,
        durationMinutes: 30,
        label: '正線 1',
      },
      {
        id: 't2',
        rowIndex: 2,
        taskType: 'passenger',
        startMinute: 605,
        durationMinutes: 30,
        label: '正線 2',
      },
    ];

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [passengerRoute('r1', '路線 A', 1080, 900, 1)],
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: templateBody(tasks, 2),
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, false);
    assert.ok(
      result.report.errors.some((issue) => issue.code === 'HEADWAY_PHYSICAL_IMPOSSIBLE'),
    );
  });

  it('rotates routes by execution order for same task type', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 600,
        durationMinutes: 30,
        label: '正線 1',
      },
      {
        id: 't2',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 660,
        durationMinutes: 30,
        label: '正線 2',
      },
    ];

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [
            passengerRoute('r1', '路線 A', 1080, 900, 1),
            passengerRoute('r2', '路線 B', 1080, 900, 2),
          ],
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: templateBody(tasks, 1),
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, true);
    const passengerBlocks = result.plan!.timelines[0]!.blocks.filter(
      (block) => block.source === 'template_bar',
    );
    assert.equal(passengerBlocks[0]!.routeId, 'r1');
    assert.equal(passengerBlocks[1]!.routeId, 'r2');
    assert.equal(result.plan!.routeAssignmentAlgorithm, 'constraint-greedy-v1');
  });

  it('avoids high switch-buffer route when gap is tight (constraint-greedy)', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 600,
        durationMinutes: 30,
        label: '正線 1',
      },
      {
        id: 't2',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 604,
        durationMinutes: 30,
        label: '正線 2',
      },
    ];

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [
            passengerRoute('r1', '路線 A', 100, 90, 1, 30, 200),
            passengerRoute('r2', '路線 B', 100, 90, 2, 30, 0),
          ],
          minimumRecoveryTimeSeconds: 0,
        },
      }),
      templateBody: templateBody(tasks, 1),
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, true);
    const passengerBlocks = result.plan!.timelines[0]!.blocks.filter(
      (block) => block.source === 'template_bar',
    );
    assert.equal(passengerBlocks[0]!.routeId, 'r1');
    assert.equal(passengerBlocks[1]!.routeId, 'r1');
    assert.ok(
      !result.report.errors.some((issue) => issue.code === 'ROUTE_SWITCH_BUFFER_INSUFFICIENT'),
    );
  });

  it('applies per-route dwell slack percent into occupancy (S4)', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 600,
        durationMinutes: 30,
        label: '正線',
      },
    ];

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [passengerRoute('r1', '路線 A', 100, 90, 1, 36, 0, 10)],
          minimumRecoveryTimeSeconds: 0,
        },
      }),
      templateBody: templateBody(tasks, 1),
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, true);
    assert.equal(result.plan!.timelines[0]!.blocks[0]!.dwellSeconds, 40);
    assert.equal(result.plan!.timelines[0]!.blocks[0]!.travelSeconds, 100);
  });

  it('snaps occupancy up to 10-second clock grid (S3)', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 600,
        durationMinutes: 30,
        label: '正線',
      },
    ];

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [passengerRoute('r1', '路線 A', 101, 90, 1, 36)],
          minimumRecoveryTimeSeconds: 0,
        },
      }),
      templateBody: templateBody(tasks, 1),
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, true);
    const block = result.plan!.timelines[0]!.blocks[0]!;
    assert.equal(block.plannedEndMinute, 600 + 140 / 60);
  });

  it('fails when anchor is not on 10-second grid (S3)', () => {
    const errors: FeasibilityIssue[] = [];
    const task = {
      id: 't1',
      rowIndex: 1,
      taskType: 'passenger' as const,
      startMinute: 600 + 7 / 60,
      durationMinutes: 30,
      label: '正線',
    };
    expandRowBlocks(
      [task],
      new Map([
        [
          't1',
          {
            task,
            route: null,
            occupancySeconds: 130,
            travelSeconds: 100,
            dwellSeconds: 30,
          },
        ],
      ]),
      errors,
      0,
    );
    assert.ok(errors.some((issue) => issue.code === 'CLOCK_ALIGN_VIOLATION'));
  });

  it('fails when recovery gap is insufficient (S1)', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 602,
        durationMinutes: 30,
        label: '正線 1',
      },
      {
        id: 't2',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 605,
        durationMinutes: 30,
        label: '正線 2',
      },
    ];

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [passengerRoute('r1', '路線 A', 100, 90, 1, 30)],
          minimumRecoveryTimeSeconds: 60,
        },
      }),
      templateBody: templateBody(tasks, 1),
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, false);
    assert.ok(
      result.report.errors.some((issue) => issue.code === 'RECOVERY_INSUFFICIENT'),
    );
  });

  it('fails when route switch buffer is insufficient (S2)', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 600,
        durationMinutes: 30,
        label: '正線 1',
      },
      {
        id: 't2',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 604,
        durationMinutes: 30,
        label: '正線 2',
      },
      {
        id: 't3',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 606,
        durationMinutes: 30,
        label: '正線 3',
      },
    ];

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [
            passengerRoute('r1', '路線 A', 100, 90, 1, 30, 120),
            passengerRoute('r2', '路線 B', 50, 40, 2, 30, 0),
          ],
          minimumRecoveryTimeSeconds: 0,
        },
      }),
      templateBody: templateBody(tasks, 1),
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, false);
    assert.ok(
      result.report.errors.some((issue) => issue.code === 'ROUTE_SWITCH_BUFFER_INSUFFICIENT'),
    );
  });

  it('fails when single route exceeds turnaround limit (1.6)', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 600,
        durationMinutes: 30,
        label: '正線',
      },
    ];

    const result = generateShiftSchedule({
      draft: buildDraft(),
      templateBody: templateBody(tasks, 1),
      turnaroundLimitSeconds: 1000,
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, false);
    assert.ok(
      result.report.errors.some((issue) => issue.code === 'TURNAROUND_LIMIT_EXCEEDED'),
    );
  });

  it('warns when multi-route rotation exceeds turnaround limit (1.6)', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 600,
        durationMinutes: 30,
        label: '正線 1',
      },
      {
        id: 't2',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 660,
        durationMinutes: 30,
        label: '正線 2',
      },
    ];

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [
            passengerRoute('r1', '路線 A', 100, 90, 1, 30, 50),
            passengerRoute('r2', '路線 B', 100, 90, 2, 30, 50),
          ],
          minimumRecoveryTimeSeconds: 0,
        },
      }),
      templateBody: templateBody(tasks, 1),
      turnaroundLimitSeconds: 300,
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, true);
    assert.ok(result.plan);
    assert.ok(
      result.report.warnings.some((issue) => issue.code === 'ROUTE_ROTATION_OVER_TURNAROUND'),
    );
  });

  it('generates passenger departures from headway and assigns earliest timeline (§4.2)', () => {
    // 10:00–10:30, headway 600s → 10:00, 10:10, 10:20
    // occupancy estimate 1080+180=1260s → needs multiple timelines
    const body = {
      editorVersion: 1,
      vehicleCapacity: 50,
      scheduleRowCount: 3,
      attributes: [
        {
          id: 'attr-1',
          name: '尖峰',
          color: '#ff0000',
          headwaySeconds: 600,
          capacityPphpd: 300,
          isDraft: false,
        },
      ],
      intervals: [
        {
          id: 'slot-1',
          attributeId: 'attr-1',
          name: '測試時段',
          startTime: '10:00',
          endTime: '10:30',
          isDraft: false,
        },
      ],
      tasks: [] as ScheduleTask[],
    };

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [passengerRoute('r1', '路線 A', 1080, 900, 1)],
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: body,
      passengerTimetableMode: 'headway',
    });

    assert.equal(result.report.ok, true);
    assert.ok(result.plan);
    assert.equal(result.plan!.timetableGenerationAlgorithm, 'periodic-headway-eat-v1');
    assert.equal(result.plan!.routeAssignmentAlgorithm, 'constraint-greedy-v1');

    const passengerBars = result.plan!.timelines
      .flatMap((timeline) => timeline.blocks)
      .filter((block) => block.source === 'template_bar' && block.taskType === 'passenger');
    assert.equal(passengerBars.length, 3);
    assert.equal(passengerBars[0]!.plannedStartMinute, 600);
    assert.equal(passengerBars[1]!.plannedStartMinute, 610);
    assert.equal(passengerBars[2]!.plannedStartMinute, 620);

    const rowsUsed = new Set(passengerBars.map((block) => block.timelineRow));
    assert.ok(rowsUsed.size >= 2);
  });
});

describe('generateDeparturesFromHeadway', () => {
  it('emits 10s-aligned departures inside interval', () => {
    const departures = generateDeparturesFromHeadway({
      intervals: [
        {
          id: 'slot-1',
          attributeId: 'attr-1',
          name: '測試',
          startTime: '08:00',
          endTime: '08:21',
          isDraft: false,
        },
      ],
      attributes: [
        {
          id: 'attr-1',
          name: '尖峰',
          color: '#f00',
          headwaySeconds: 600,
          capacityPphpd: 1,
          isDraft: false,
        },
      ],
    });
    // 08:00, 08:10, 08:20 — 08:30 would be >= end
    assert.deepEqual(
      departures.map((item) => item.startSecond),
      [8 * 3600, 8 * 3600 + 600, 8 * 3600 + 1200],
    );
  });

  it('delays onto earliest free timeline when all busy', () => {
    const departures = generateDeparturesFromHeadway({
      intervals: [
        {
          id: 'slot-1',
          attributeId: 'attr-1',
          name: '測試',
          startTime: '10:00',
          endTime: '10:20',
          isDraft: false,
        },
      ],
      attributes: [
        {
          id: 'attr-1',
          name: '尖峰',
          color: '#f00',
          headwaySeconds: 60,
          capacityPphpd: 1,
          isDraft: false,
        },
      ],
    });
    const endMap = buildIntervalEndSecondByDepartureStart(departures, [
      {
        id: 'slot-1',
        attributeId: 'attr-1',
        name: '測試',
        startTime: '10:00',
        endTime: '10:20',
        isDraft: false,
      },
    ]);
    const tasks = assignDeparturesToEarliestTimeline({
      departures,
      scheduleRowCount: 1,
      estimatedOccupancySeconds: 180,
      intervalEndSecondByDepartureStart: endMap,
    });
    assert.ok(tasks.length >= 2);
    assert.equal(tasks[0]!.rowIndex, 1);
    // second departure ideally 10:01 but timeline busy until 10:03 → delayed
    assert.ok(tasks[1]!.startMinute >= tasks[0]!.startMinute + 180 / 60);
  });
});

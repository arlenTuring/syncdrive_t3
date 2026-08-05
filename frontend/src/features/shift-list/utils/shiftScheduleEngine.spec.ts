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
import {
  applyRotationCycleCompletion,
  buildRotationCompletionTasks,
} from './schedule-engine/completeRotationCycles';
import { assignPassengerRoutesConstraintGreedy } from './schedule-engine/assignRoutes';
import { validateRouteSwitchBuffers, validatePassengerHeadway } from './schedule-engine/validate';
import type { FeasibilityIssue, GeneratedSchedulePlan } from './schedule-engine/types';
import { resolveInterTripGapSeconds } from './schedule-engine/physics';

function passengerRoute(
  id: string,
  name: string,
  avg: number,
  min: number,
  order: number,
  dwellSeconds = 180,
  switchBufferAfterSeconds = 0,
  dwellSlackSeconds = 0,
): ShiftScheduleSelectedRoute {
  return {
    routeId: id,
    routeName: name,
    groupId: 'g1',
    groupName: 'G1',
    // 雙站：首站停靠不計入占用，終站停靠才計入（與引擎 physics 一致）
    stationIds: [`${id}-origin`, `${id}-terminal`],
    stationDwells: [
      { stationId: `${id}-origin`, stationName: `${id}-origin`, dwellSeconds: 0 },
      {
        stationId: `${id}-terminal`,
        stationName: `${id}-terminal`,
        dwellSeconds,
      },
    ],
    stationDwellsConfirmed: true,
    stationLegTravels: [],
    avgTravelTimeSeconds: avg,
    minTravelTimeSeconds: min,
    executionOrder: order,
    switchBufferAfterSeconds,
    dwellSlackSeconds,
  };
}

function buildDraft(
  patch: Partial<ShiftScheduleCreateDraft> = {},
): ShiftScheduleCreateDraft {
  const base = emptyShiftScheduleCreateDraft();
  return {
    ...base,
    timeTemplate: {
      ...base.timeTemplate,
      templateId: 'TT-1',
      templateName: '模板',
    },
    routeGroups: {
      mapId: 'map-1',
      selectedRoutes: [passengerRoute('r1', '路線 A', 1080, 900, 1)],
      minimumRecoveryTimeSeconds: 30,
    },
    ...patch,
    ...(patch.timeTemplate
      ? {
          timeTemplate: {
            ...base.timeTemplate,
            ...patch.timeTemplate,
          },
        }
      : {}),
    ...(patch.maintenanceTask
      ? {
          maintenanceTask: {
            ...base.maintenanceTask,
            ...patch.maintenanceTask,
            entrySlackBySection: {
              ...base.maintenanceTask.entrySlackBySection,
              ...patch.maintenanceTask.entrySlackBySection,
            },
          },
        }
      : {}),
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
    // 正線視窗 10:00–10:10、班距 600s → 只有 10:00 一趟發車
    const tasks: ScheduleTask[] = [
      {
        id: 't1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 600,
        durationMinutes: 10,
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

  it('allows small delay within one headway when vehicle is slightly late', () => {
    // 正線視窗 10:00–10:30；一圈均 1260s + 恢復 30s。
    // 10:10 脈衝：用均就緒太晚；壓到快後可掛上（本測驗證快補班）。
    // 占用改為最快 1080s → 10:00–10:18，下一班約 10:18:30。
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
    const bars = result.plan!.timelines[0]!.blocks.filter(
      (block) => block.source === 'template_bar',
    );
    assert.equal(bars.length, 2);
    assert.equal(bars[0]!.plannedStartMinute, 600);
    assert.equal(bars[0]!.plannedEndMinute, 618);
    assert.equal(bars[1]!.plannedStartMinute, 618.5);
  });

  it('fails when physics end exceeds next anchor on same timeline', () => {
    const route = passengerRoute('r1', '路線 A', 1080, 900, 1);
    const t1: ScheduleTask = {
      id: 't1',
      rowIndex: 1,
      taskType: 'passenger',
      startMinute: 600,
      durationMinutes: 21,
      label: '正線 1',
    };
    const t2: ScheduleTask = {
      id: 't2',
      rowIndex: 1,
      taskType: 'passenger',
      startMinute: 615,
      durationMinutes: 21,
      label: '正線 2',
    };
    const errors: FeasibilityIssue[] = [];
    expandRowBlocks(
      [t1, t2],
      new Map([
        ['t1', { task: t1, route, occupancySeconds: 1260, travelSeconds: 1080, dwellSeconds: 180 }],
        ['t2', { task: t2, route, occupancySeconds: 1260, travelSeconds: 1080, dwellSeconds: 180 }],
      ]),
      errors,
      30,
    );
    assert.ok(errors.some((issue) => issue.code === 'ANCHOR_CONFLICT'));
  });

  it('defers charging start and locks original end when mainline overruns (正線優先壓縮)', () => {
    // 充電模板 14:00–15:00；正線 13:53 起、占用 460s → 14:00:40 回來
    // 整備應為 14:00:40–15:00:00（鎖尾壓縮），不得整段平移到 15:00:40
    const route = passengerRoute('r-up', '上行路線', 320, 265, 1, 36, 0, 10);
    route.stationDwells = [
      { stationId: 'a', stationName: 'a', dwellSeconds: 36 },
      { stationId: 'b', stationName: 'b', dwellSeconds: 36 },
      { stationId: 'c', stationName: 'c', dwellSeconds: 36 },
    ];
    const pax: ScheduleTask = {
      id: 'p1',
      rowIndex: 1,
      taskType: 'passenger',
      startMinute: 13 * 60 + 53,
      durationMinutes: 8,
      label: '正線',
    };
    const chg: ScheduleTask = {
      id: 'c1',
      rowIndex: 1,
      taskType: 'charging',
      startMinute: 14 * 60,
      durationMinutes: 60,
      label: '充電',
    };
    const errors: FeasibilityIssue[] = [];
    const blocks = expandRowBlocks(
      [pax, chg],
      new Map([
        [
          'p1',
          {
            task: pax,
            route,
            occupancySeconds: 460,
            travelSeconds: 320,
            dwellSeconds: 138,
          },
        ],
        [
          'c1',
          {
            task: chg,
            route: null,
            occupancySeconds: 3600,
            travelSeconds: 0,
            dwellSeconds: 3600,
          },
        ],
      ]),
      errors,
      30,
    );
    const charging = blocks.find((block) => block.taskType === 'charging');
    assert.ok(charging);
    assert.equal(Math.round(charging!.plannedStartMinute * 60), 14 * 3600 + 40);
    assert.equal(Math.round(charging!.plannedEndMinute * 60), 15 * 3600);
  });

  it('flags headway physically impossible across departures', () => {
    // 單車最短一圈 ≈ 900+180=1080s；2 時間線物理班距下限 ≈ 540s
    // 相鄰同方向發車僅隔 300s → 即使兩車並行仍不可達。
    // 引擎的掛車階段現在會主動避開此情況（延後發車補班距），
    // 因此直接對驗證器餵入違規發車，確認守門仍在。
    const route = passengerRoute('r1', '路線 A', 1080, 900, 1);
    const block = (id: string, row: number, startMinute: number) => ({
      id,
      timelineRow: row,
      taskType: 'passenger' as const,
      label: '正線',
      routeId: 'r1',
      anchorStartMinute: startMinute,
      plannedStartMinute: startMinute,
      plannedEndMinute: startMinute + 21,
      travelSeconds: 1080,
      dwellSeconds: 180,
      source: 'template_bar' as const,
    });

    const errors: FeasibilityIssue[] = [];
    const warnings: FeasibilityIssue[] = [];
    validatePassengerHeadway(
      [block('b1', 1, 600), block('b2', 2, 605)],
      [],
      [],
      new Map([['r1', route]]),
      errors,
      warnings,
      2,
    );

    assert.ok(errors.some((issue) => issue.code === 'HEADWAY_PHYSICAL_IMPOSSIBLE'));
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

  it('hard-rotates execution order even when switch gap is tight (reports error)', () => {
    // 執行順序為硬約束：第 1 趟 r1、第 2 趟 r2；空檔不足時不可改選同路線逃避
    const routes = [
      passengerRoute('r1', '路線 A', 100, 90, 1, 30, 200),
      passengerRoute('r2', '路線 B', 100, 90, 2, 30, 0),
    ];
    const tasksByRow = new Map<number, ScheduleTask[]>([
      [
        1,
        [
          {
            id: 't1',
            rowIndex: 1,
            taskType: 'passenger',
            startMinute: 600,
            durationMinutes: 3,
            label: '正線 1',
          },
          {
            id: 't2',
            rowIndex: 1,
            taskType: 'passenger',
            startMinute: 604,
            durationMinutes: 3,
            label: '正線 2',
          },
        ],
      ],
    ]);

    const decisions = assignPassengerRoutesConstraintGreedy({
      passengerTasksByRow: tasksByRow,
      passengerRoutes: routes,
      minimumRecoveryTimeSeconds: 0,
    });
    assert.equal(decisions.get('t1')!.route.routeId, 'r1');
    assert.equal(decisions.get('t2')!.route.routeId, 'r2');
    assert.equal(decisions.get('t2')!.feasible, false);

    const requiredGap = resolveInterTripGapSeconds({
      minimumRecoveryTimeSeconds: 0,
      previousRouteSwitchBufferSeconds: 200,
      isRouteSwitch: true,
    });
    assert.equal(requiredGap, 200);

    const plan: GeneratedSchedulePlan = {
      generatedAt: new Date().toISOString(),
      scheduleRowCount: 1,
      timelines: [
        {
          row: 1,
          blocks: [
            {
              id: 't1',
              timelineRow: 1,
              taskType: 'passenger',
              label: '正線 1',
              routeId: 'r1',
              routeName: '路線 A',
              anchorStartMinute: 600,
              plannedStartMinute: 600,
              plannedEndMinute: 600 + 130 / 60,
              travelSeconds: 100,
              dwellSeconds: 30,
              source: 'template_bar',
            },
            {
              id: 't2',
              timelineRow: 1,
              taskType: 'passenger',
              label: '正線 2',
              routeId: 'r2',
              routeName: '路線 B',
              anchorStartMinute: 604,
              plannedStartMinute: 604,
              plannedEndMinute: 604 + 130 / 60,
              travelSeconds: 100,
              dwellSeconds: 30,
              source: 'template_bar',
            },
          ],
        },
      ],
    };
    const errors: FeasibilityIssue[] = [];
    validateRouteSwitchBuffers(
      plan.timelines,
      new Map(routes.map((route) => [route.routeId, route])),
      errors,
      0,
    );
    assert.ok(errors.some((issue) => issue.code === 'ROUTE_SWITCH_BUFFER_INSUFFICIENT'));
  });

  it('applies per-route dwell slack seconds into occupancy (S4)', () => {
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
    // 有效停靠 36 + 10 = 46
    assert.equal(result.plan!.timelines[0]!.blocks[0]!.dwellSeconds, 46);
    assert.equal(result.plan!.timelines[0]!.blocks[0]!.travelSeconds, 100);
  });

  it('snaps occupancy down to 10-second clock grid within avg (S3)', () => {
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
    // 101+36=137 → snap↓130（不大於均）
    assert.equal(block.plannedEndMinute, 600 + 130 / 60);
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
    const route = passengerRoute('r1', '路線 A', 100, 90, 1, 30);
    const t1: ScheduleTask = {
      id: 't1',
      rowIndex: 1,
      taskType: 'passenger',
      startMinute: 602,
      durationMinutes: 3,
      label: '正線 1',
    };
    const t2: ScheduleTask = {
      id: 't2',
      rowIndex: 1,
      taskType: 'passenger',
      startMinute: 605,
      durationMinutes: 3,
      label: '正線 2',
    };
    const errors: FeasibilityIssue[] = [];
    expandRowBlocks(
      [t1, t2],
      new Map([
        ['t1', { task: t1, route, occupancySeconds: 130, travelSeconds: 100, dwellSeconds: 30 }],
        ['t2', { task: t2, route, occupancySeconds: 130, travelSeconds: 100, dwellSeconds: 30 }],
      ]),
      errors,
      60,
    );
    assert.ok(errors.some((issue) => issue.code === 'RECOVERY_INSUFFICIENT'));
  });

  it('fails when route switch buffer is insufficient (S2)', () => {
    const routes = [
      passengerRoute('r1', '路線 A', 100, 90, 1, 30, 120),
      passengerRoute('r2', '路線 B', 50, 40, 2, 30, 0),
    ];
    const plan: GeneratedSchedulePlan = {
      generatedAt: new Date().toISOString(),
      scheduleRowCount: 1,
      timelines: [
        {
          row: 1,
          blocks: [
            {
              id: 't1',
              timelineRow: 1,
              taskType: 'passenger',
              label: '正線 1',
              routeId: 'r1',
              routeName: '路線 A',
              anchorStartMinute: 600,
              plannedStartMinute: 600,
              plannedEndMinute: 602,
              travelSeconds: 100,
              dwellSeconds: 30,
              source: 'template_bar',
            },
            {
              id: 't2',
              timelineRow: 1,
              taskType: 'passenger',
              label: '正線 2',
              routeId: 'r2',
              routeName: '路線 B',
              anchorStartMinute: 604,
              plannedStartMinute: 604,
              plannedEndMinute: 605.5,
              travelSeconds: 50,
              dwellSeconds: 30,
              source: 'template_bar',
            },
          ],
        },
      ],
    };
    // 空檔 120s，但需換線 120（中段不扣恢復）；再縮到 60s 空檔才算不足
    plan.timelines[0]!.blocks[1]!.plannedStartMinute = 603;
    const errors: FeasibilityIssue[] = [];
    validateRouteSwitchBuffers(
      plan.timelines,
      new Map(routes.map((route) => [route.routeId, route])),
      errors,
      0,
    );
    assert.ok(errors.some((issue) => issue.code === 'ROUTE_SWITCH_BUFFER_INSUFFICIENT'));
    // 中段僅換線：空檔 180s、恢復 30（不計入）、換線 120 → 需 120，應通過
    const okErrors: FeasibilityIssue[] = [];
    plan.timelines[0]!.blocks[1]!.plannedStartMinute = 605;
    validateRouteSwitchBuffers(
      plan.timelines,
      new Map(routes.map((route) => [route.routeId, route])),
      okErrors,
      30,
    );
    assert.equal(okErrors.length, 0);
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
    assert.equal(result.plan!.timetableGenerationAlgorithm, 'periodic-cycle-headway-v2');
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

describe('rotation cycle completion（來回約束）', () => {
  const downRoute = passengerRoute('r-down', '下行路線', 300, 60, 1, 140);
  const upRoute = passengerRoute('r-up', '上行路線', 300, 60, 2, 140);

  it('inserts missing return trip before a non-passenger task', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 'pax-1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 10,
        durationMinutes: 440 / 60,
        label: '正線',
      },
      {
        id: 'chg-1',
        rowIndex: 1,
        taskType: 'charging',
        startMinute: 30,
        durationMinutes: 60,
        label: '充電',
      },
    ];

    const additions = buildRotationCompletionTasks({
      tasks,
      passengerRoutes: [downRoute, upRoute],
      scheduleRowCount: 1,
      minimumRecoveryTimeSeconds: 30,
    });

    assert.equal(additions.length, 1);
    // 最後一趟 10:00+440s=1040s → 導通中段換線不重複扣恢復（僅換線緩衝，此測為 0）→ 1040s
    assert.equal(Math.round(additions[0]!.startMinute * 60), 1040);
    assert.equal(additions[0]!.taskType, 'passenger');
    assert.equal(additions[0]!.rowIndex, 1);
  });

  it('adds switch buffer only on mid-ring return (recovery reserved for wrap)', () => {
    const downWithSwitch = passengerRoute('r-down', '下行路線', 320, 265, 1, 36, 20, 10);
    // 三站 (36+10)=46 → 138s；占用 snap(320+138)=460（此測以模板 duration 440 為準）
    downWithSwitch.stationDwells = [
      { stationId: 'a', stationName: 'a', dwellSeconds: 36 },
      { stationId: 'b', stationName: 'b', dwellSeconds: 36 },
      { stationId: 'c', stationName: 'c', dwellSeconds: 36 },
    ];
    const up = passengerRoute('r-up', '上行路線', 320, 265, 2, 36, 20, 10);
    up.stationDwells = [
      { stationId: 'd', stationName: 'd', dwellSeconds: 36 },
      { stationId: 'e', stationName: 'e', dwellSeconds: 36 },
      { stationId: 'f', stationName: 'f', dwellSeconds: 36 },
    ];

    const tasks: ScheduleTask[] = [
      {
        id: 'pax-1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 10,
        durationMinutes: 440 / 60,
        label: '正線',
      },
      {
        id: 'chg-1',
        rowIndex: 1,
        taskType: 'charging',
        startMinute: 30,
        durationMinutes: 60,
        label: '充電',
      },
    ];

    const additions = buildRotationCompletionTasks({
      tasks,
      passengerRoutes: [downWithSwitch, up],
      scheduleRowCount: 1,
      minimumRecoveryTimeSeconds: 30,
    });

    assert.equal(additions.length, 1);
    // 中段下行→上行：僅換線 20（恢復留給折返繞回）→ 1040+20=1060s
    assert.equal(Math.round(additions[0]!.startMinute * 60), 1060);
  });

  it('completes cycle at end of day even without non-passenger tasks', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 'pax-1',
        rowIndex: 2,
        taskType: 'passenger',
        startMinute: 0,
        durationMinutes: 440 / 60,
        label: '正線',
      },
    ];

    const additions = buildRotationCompletionTasks({
      tasks,
      passengerRoutes: [downRoute, upRoute],
      scheduleRowCount: 2,
      minimumRecoveryTimeSeconds: 30,
    });

    assert.equal(additions.length, 1);
    assert.equal(additions[0]!.rowIndex, 2);
    // 中段換線不扣恢復 → 440s
    assert.equal(Math.round(additions[0]!.startMinute * 60), 440);
  });

  it('no-op when every cycle is already complete', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 'pax-1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 0,
        durationMinutes: 440 / 60,
        label: '正線',
      },
      {
        id: 'pax-2',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 20,
        durationMinutes: 440 / 60,
        label: '正線',
      },
      {
        id: 'chg-1',
        rowIndex: 1,
        taskType: 'charging',
        startMinute: 30,
        durationMinutes: 60,
        label: '充電',
      },
    ];

    const additions = buildRotationCompletionTasks({
      tasks,
      passengerRoutes: [downRoute, upRoute],
      scheduleRowCount: 1,
      minimumRecoveryTimeSeconds: 30,
    });

    assert.equal(additions.length, 0);
  });

  it('no-op with a single route (每趟即一整輪)', () => {
    const tasks: ScheduleTask[] = [
      {
        id: 'pax-1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 0,
        durationMinutes: 440 / 60,
        label: '正線',
      },
    ];

    const additions = buildRotationCompletionTasks({
      tasks,
      passengerRoutes: [downRoute],
      scheduleRowCount: 1,
      minimumRecoveryTimeSeconds: 30,
    });

    assert.equal(additions.length, 0);
  });

  it('does not push return trip past maintenance into later hung trip（R-CYCLE-ROW）', () => {
    // 凌晨下行結束 → 01:30 保養；同車早高峰已掛下行 06:40。
    // 全車隊整夜上行很密時，舊算法會把回程對齊到 06:32 並與 06:40 零秒對接。
    // 新算法：補完須在整備起點前發出，並與同車下一班留換線空檔。
    const downWithSwitch = passengerRoute('r-down', '下行路線', 320, 265, 1, 0, 20);
    const upWithSwitch = passengerRoute('r-up', '上行路線', 320, 265, 2, 0, 20);
    downWithSwitch.stationDwells = [
      { stationId: 'a', stationName: 'a', dwellSeconds: 40 },
      { stationId: 'b', stationName: 'b', dwellSeconds: 40 },
      { stationId: 'c', stationName: 'c', dwellSeconds: 40 },
    ];
    upWithSwitch.stationDwells = [
      { stationId: 'd', stationName: 'd', dwellSeconds: 40 },
      { stationId: 'e', stationName: 'e', dwellSeconds: 40 },
      { stationId: 'f', stationName: 'f', dwellSeconds: 40 },
    ];

    const fleetUpStarts: ScheduleTask[] = [];
    for (let i = 0; i < 40; i += 1) {
      fleetUpStarts.push({
        id: `fleet-up-${i}`,
        rowIndex: 2,
        taskType: 'passenger',
        startMinute: (10 + i * 8) / 60,
        durationMinutes: 440 / 60,
        label: '正線',
      });
    }

    const tasks: ScheduleTask[] = [
      {
        id: 'pax-down',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 20 / 60,
        durationMinutes: 460 / 60,
        label: '正線',
      },
      {
        id: 'maint',
        rowIndex: 1,
        taskType: 'servicing',
        startMinute: 90,
        durationMinutes: 270,
        label: '保養',
      },
      {
        id: 'pax-morning-down',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 6 * 60 + 40,
        durationMinutes: 460 / 60,
        label: '正線',
      },
      ...fleetUpStarts,
    ];

    const result = applyRotationCycleCompletion({
      tasks,
      passengerRoutes: [downWithSwitch, upWithSwitch],
      scheduleRowCount: 2,
      minimumRecoveryTimeSeconds: 30,
      intervals: [
        {
          id: 'all-day',
          attributeId: 'attr-peak',
          name: '全日',
          startTime: '00:00',
          endTime: '24:00',
          isDraft: false,
        },
      ],
      attributes: [
        {
          id: 'attr-peak',
          name: '尖峰',
          color: '#f00',
          headwaySeconds: 180,
          capacityPphpd: 1000,
          isDraft: false,
        },
      ],
    });

    const returnTrip = result.find((task) => task.id.startsWith('pax-cycle-completion-1-'));
    assert.ok(returnTrip);
    const returnStart = Math.round(returnTrip!.startMinute * 60);
    const returnEnd = returnStart + Math.round(returnTrip!.durationMinutes * 60);
    const morningStart = (6 * 60 + 40) * 60;
    // 必須在整備 01:30 前發出，且與 06:40 下行至少留 50s 空檔
    assert.ok(returnStart <= 90 * 60, `return start ${returnStart} should be before maint`);
    assert.ok(
      morningStart - returnEnd >= 50,
      `gap ${morningStart - returnEnd}s should be >= 50`,
    );
    const deferredMaint = result.find((task) => task.id === 'maint');
    assert.ok(deferredMaint);
    assert.ok(deferredMaint!.startMinute * 60 >= returnEnd - 1e-6);
  });

  it('withdraws an auto-generated outbound when no legal return slot exists', () => {
    // 即使壓到快也排不進回程（整備太早 + 同方向班距被另一車佔住）
    const tightDown = passengerRoute('r-down', '下行路線', 300, 280, 1, 140);
    const tightUp = passengerRoute('r-up', '上行路線', 300, 280, 2, 140);
    const tasks: ScheduleTask[] = [
      {
        id: 'template-pax-slot-r-down-1-0',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 0,
        durationMinutes: 440 / 60,
        label: '正線',
      },
      {
        id: 'maint',
        rowIndex: 1,
        taskType: 'servicing',
        startMinute: 15,
        durationMinutes: 45,
        label: '保養',
      },
      {
        id: 'fleet-down',
        rowIndex: 2,
        taskType: 'passenger',
        startMinute: 0,
        durationMinutes: 440 / 60,
        label: '正線',
      },
      {
        id: 'fleet-up',
        rowIndex: 2,
        taskType: 'passenger',
        startMinute: 10,
        durationMinutes: 440 / 60,
        label: '正線',
      },
    ];
    const errors: FeasibilityIssue[] = [];

    const result = applyRotationCycleCompletion({
      tasks,
      passengerRoutes: [tightDown, tightUp],
      scheduleRowCount: 2,
      minimumRecoveryTimeSeconds: 30,
      intervals: [
        {
          id: 'all-day',
          attributeId: 'attr',
          name: '全日',
          startTime: '00:00',
          endTime: '24:00',
          isDraft: false,
        },
      ],
      attributes: [
        {
          id: 'attr',
          name: '離峰',
          color: '#0f0',
          headwaySeconds: 600,
          capacityPphpd: 300,
          isDraft: false,
        },
      ],
      errors,
    });

    assert.equal(
      result.some((task) => task.id === 'template-pax-slot-r-down-1-0'),
      false,
    );
    assert.equal(
      result.some((task) => task.id.startsWith('pax-cycle-completion-1-')),
      false,
    );
    assert.equal(errors.length, 0);
  });

  it('withdraws outbound at 180s→300s boundary when return misses maintenance slack', () => {
    const down = passengerRoute('r-down', '下行路線', 320, 265, 1, 120, 20);
    const up = passengerRoute('r-up', '上行路線', 320, 265, 2, 120, 20);
    const tasks: ScheduleTask[] = [
      {
        id: 'template-pax-old-r-down-1',
        rowIndex: 1,
        taskType: 'passenger',
        startMinute: 13 * 60 + 53,
        durationMinutes: 460 / 60,
        label: '正線',
      },
      {
        id: 'charging-row-1',
        rowIndex: 1,
        taskType: 'charging',
        startMinute: 14 * 60,
        durationMinutes: 60,
        label: '充電',
      },
      {
        id: 'fleet-down-before',
        rowIndex: 2,
        taskType: 'passenger',
        startMinute: 13 * 60 + 50,
        durationMinutes: 460 / 60,
        label: '正線',
      },
      {
        id: 'fleet-up-before',
        rowIndex: 2,
        taskType: 'passenger',
        startMinute: 13 * 60 + 58.5,
        durationMinutes: 460 / 60,
        label: '正線',
      },
      {
        id: 'fleet-down-after',
        rowIndex: 3,
        taskType: 'passenger',
        startMinute: 13 * 60 + 56,
        durationMinutes: 460 / 60,
        label: '正線',
      },
      {
        id: 'fleet-up-after',
        rowIndex: 3,
        taskType: 'passenger',
        startMinute: 14 * 60 + 4.5,
        durationMinutes: 460 / 60,
        label: '正線',
      },
    ];

    const result = applyRotationCycleCompletion({
      tasks,
      passengerRoutes: [down, up],
      scheduleRowCount: 3,
      minimumRecoveryTimeSeconds: 30,
      intervals: [
        {
          id: 'old',
          attributeId: 'old-attr',
          name: '180秒',
          startTime: '10:00',
          endTime: '14:00',
          isDraft: false,
        },
        {
          id: 'new',
          attributeId: 'new-attr',
          name: '300秒',
          startTime: '14:00',
          endTime: '17:00',
          isDraft: false,
        },
      ],
      attributes: [
        {
          id: 'old-attr',
          name: '180秒',
          color: '#0f0',
          headwaySeconds: 180,
          capacityPphpd: 1000,
          isDraft: false,
        },
        {
          id: 'new-attr',
          name: '300秒',
          color: '#f00',
          headwaySeconds: 300,
          capacityPphpd: 600,
          isDraft: false,
        },
      ],
      maintenanceEntrySlackBySection: {
        charging: 600,
        carWash: 600,
        maintenance: 600,
        preTrip: 600,
        mobile: 600,
      },
    });

    // D13:53 物理回程可於 14:09:10 完成，但跨時段 300 秒班距無合法 U 槽位。
    // 鐵則：不能留下單趟去程，故撤回 D13:53。
    assert.equal(
      result.some((task) => task.id === 'template-pax-old-r-down-1'),
      false,
    );
    assert.equal(
      result.some((task) => task.id.startsWith('pax-cycle-completion-1-')),
      false,
    );
  });

  it('engine appends return trip so every vehicle runs round trips（第六列車情境）', () => {
    // 兩條時間線、正線視窗 00:00–00:30（班距 600s）、00:30 起充電。
    // 每方向獨立脈衝：下行 00:00/00:10/00:20、上行 00:00/00:10/00:20；
    // 開班時上行 00:00 無車可掛（略過），之後各車自然完成來回。
    const body = {
      editorVersion: 1,
      vehicleCapacity: 50,
      scheduleRowCount: 2,
      attributes: [
        {
          id: 'attr-1',
          name: '離峰',
          color: '#00ff00',
          headwaySeconds: 600,
          capacityPphpd: 300,
          isDraft: false,
        },
      ],
      intervals: [
        {
          id: 'slot-1',
          attributeId: 'attr-1',
          name: '凌晨',
          startTime: '00:00',
          endTime: '00:30',
          isDraft: false,
        },
      ],
      tasks: [
        { id: 'w1', rowIndex: 1, taskType: 'passenger', startMinute: 0, durationMinutes: 30, label: '正線' },
        { id: 'w2', rowIndex: 2, taskType: 'passenger', startMinute: 0, durationMinutes: 30, label: '正線' },
        { id: 'c1', rowIndex: 1, taskType: 'charging', startMinute: 30, durationMinutes: 60, label: '充電' },
        { id: 'c2', rowIndex: 2, taskType: 'charging', startMinute: 30, durationMinutes: 60, label: '充電' },
      ] as ScheduleTask[],
    };

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [downRoute, upRoute],
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: body,
      passengerTimetableMode: 'template',
    });

    // 末站後接充電 ≠ 繼續佔正線末站；此情境仍應可完成來回
    assert.equal(result.report.ok, true);
    assert.ok(result.plan);

    for (const timeline of result.plan!.timelines) {
      const paxBars = timeline.blocks.filter(
        (block) => block.source === 'template_bar' && block.taskType === 'passenger',
      );
      if (paxBars.length === 0) continue;
      // 每條時間線的正線趟數必須是路線數（2）的整數倍：出去一定要回來
      assert.equal(
        paxBars.length % 2,
        0,
        `時間線 ${timeline.row} 正線趟數 ${paxBars.length} 未完成來回`,
      );
      const routeIds = paxBars
        .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute)
        .map((block) => block.routeId);
      for (let i = 0; i < routeIds.length; i += 2) {
        assert.equal(routeIds[i], 'r-down');
        assert.equal(routeIds[i + 1], 'r-up');
      }
    }

    // 完整交路掛車後：列2 = D 00:10，接著立即完成 U，不再等另一個 route 脈衝。
    const row2 = result.plan!.timelines.find((timeline) => timeline.row === 2)!;
    const row2Bars = row2.blocks
      .filter((block) => block.source === 'template_bar' && block.taskType === 'passenger')
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    assert.equal(row2Bars.length, 2);
    assert.equal(row2Bars[0]!.routeId, 'r-down');
    assert.equal(Math.round(row2Bars[0]!.plannedStartMinute * 60), 600);
    assert.equal(row2Bars[1]!.routeId, 'r-up');
    assert.equal(Math.round(row2Bars[1]!.plannedStartMinute * 60), 1040);

    // 回程 00:27:20 結束，充電仍準時 00:30 開始
    const row2Charging = row2.blocks.find((block) => block.taskType === 'charging');
    assert.ok(row2Charging);
    assert.equal(row2Charging!.plannedStartMinute, 30);

    // 全車隊同方向班距：下行與上行各自穩定 600s（允許開班略過後的首班）
    for (const routeId of ['r-down', 'r-up'] as const) {
      const starts = result.plan!.timelines
        .flatMap((timeline) => timeline.blocks)
        .filter((block) => block.taskType === 'passenger' && block.routeId === routeId)
        .map((block) => Math.round(block.plannedStartMinute * 60))
        .sort((a, b) => a - b);
      for (let i = 1; i < starts.length; i += 1) {
        assert.equal(starts[i]! - starts[i - 1]!, 600);
      }
    }
  });

  it('allows opening a cycle that finishes within maintenance entry slack (可偷整備開頭)', () => {
    // 餘裕 600＝最多可晚於充電開始 600s 才結束來回
    // 第二個 00:10 脈衝在上一輪完成後立刻補掛（約 00:15:10），
    // 完整來回於充電前結束，不得為等待整點脈衝而閒置。
    const body = {
      editorVersion: 1,
      vehicleCapacity: 50,
      scheduleRowCount: 1,
      attributes: [
        {
          id: 'attr-1',
          name: '離峰',
          color: '#00ff00',
          headwaySeconds: 600,
          capacityPphpd: 300,
          isDraft: false,
        },
      ],
      intervals: [
        {
          id: 'slot-1',
          attributeId: 'attr-1',
          name: '凌晨',
          startTime: '00:00',
          endTime: '00:30',
          isDraft: false,
        },
      ],
      tasks: [
        { id: 'w1', rowIndex: 1, taskType: 'passenger', startMinute: 0, durationMinutes: 30, label: '正線' },
        { id: 'c1', rowIndex: 1, taskType: 'charging', startMinute: 30, durationMinutes: 60, label: '充電' },
      ] as ScheduleTask[],
    };

    const withSlack = generateShiftSchedule({
      draft: buildDraft({
        maintenanceTask: {
          taskId: 'mt-1',
          taskName: '整備',
          skipped: false,
          entrySlackBySection: {
            charging: '600',
            carWash: '600',
            maintenance: '600',
            preTrip: '600',
            mobile: '600',
          },
        },
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [downRoute, upRoute],
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: body,
      maintenanceTaskBody: {
        charging: { stepEnabled: true },
      },
      passengerTimetableMode: 'template',
    });
    assert.equal(withSlack.report.ok, true);
    const startsWithSlack = withSlack.plan!.timelines[0]!.blocks
      .filter((block) => block.taskType === 'passenger')
      .map((block) => Math.round(block.plannedStartMinute * 60));
    assert.ok(startsWithSlack.includes(910), '上一輪完成後應立即補掛漏掉的 00:10 脈衝');

    const withoutSlack = generateShiftSchedule({
      draft: buildDraft({
        maintenanceTask: {
          taskId: 'mt-1',
          taskName: '整備',
          skipped: false,
          entrySlackBySection: {
            charging: '0',
            carWash: '0',
            maintenance: '0',
            preTrip: '0',
            mobile: '0',
          },
        },
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [downRoute, upRoute],
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: body,
      maintenanceTaskBody: {
        charging: { stepEnabled: true },
      },
      passengerTimetableMode: 'template',
    });
    assert.equal(withoutSlack.report.ok, true);
    const startsNoSlack = withoutSlack.plan!.timelines[0]!.blocks
      .filter((block) => block.taskType === 'passenger')
      .map((block) => Math.round(block.plannedStartMinute * 60));
    assert.ok(!startsNoSlack.includes(1200), '餘裕 0 時 00:20 來回會超過充電開始，應不發');
  });

  it('does not pre-dispatch by cutting the preceding maintenance tail', () => {
    // 讓渡餘裕只允許占用「接下整備開頭」；
    // 09:00–10:00 整備不得為了 10:00 正線視窗被提前裁尾出車。
    const tasks: ScheduleTask[] = [];
    for (let row = 1; row <= 4; row += 1) {
      tasks.push(
        {
          id: `maint-${row}`,
          rowIndex: row,
          taskType: 'servicing',
          startMinute: 9 * 60,
          durationMinutes: 60,
          label: '保養',
        },
        {
          id: `pax-${row}`,
          rowIndex: row,
          taskType: 'passenger',
          startMinute: 10 * 60,
          durationMinutes: 60,
          label: '正線',
        },
      );
    }
    const body = {
      editorVersion: 1,
      vehicleCapacity: 50,
      scheduleRowCount: 4,
      attributes: [
        {
          id: 'attr-1',
          name: '尖峰',
          color: '#ff0000',
          headwaySeconds: 300,
          capacityPphpd: 600,
          isDraft: false,
        },
      ],
      intervals: [
        {
          id: 'slot-1',
          attributeId: 'attr-1',
          name: '上午',
          startTime: '09:00',
          endTime: '11:00',
          isDraft: false,
        },
      ],
      tasks,
    };

    const result = generateShiftSchedule({
      draft: buildDraft({
        maintenanceTask: {
          taskId: 'mt-1',
          taskName: '整備',
          skipped: false,
          entrySlackBySection: {
            charging: '600',
            carWash: '600',
            maintenance: '600',
            preTrip: '600',
            mobile: '600',
          },
        },
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [downRoute, upRoute],
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: body,
      maintenanceTaskBody: {
        maintenance: { stepEnabled: true },
      },
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, true);
    const allBlocks = result.plan!.timelines.flatMap((timeline) => timeline.blocks);
    const preDispatched = allBlocks.filter(
      (block) =>
        block.taskType === 'passenger'
        && Math.round(block.plannedStartMinute * 60) < 10 * 3600,
    );
    assert.equal(preDispatched.length, 0, '不得提前裁整備尾端出車');

    for (const timeline of result.plan!.timelines) {
      const servicing = timeline.blocks.find((block) => block.taskType === 'servicing');
      if (!servicing) continue;
      assert.ok(
        Math.abs(servicing.plannedEndMinute - 10 * 60) < 1e-6,
        `row ${timeline.row} 整備結束時間應維持 10:00，實際=${servicing.plannedEndMinute}`,
      );
    }
  });

  it('skips opening a cycle that would overrun maintenance beyond entry slack', () => {
    // 餘裕僅 120s；00:20 開新輪約 00:35 結束 > 00:30+120=00:32 → 不發
    const body = {
      editorVersion: 1,
      vehicleCapacity: 50,
      scheduleRowCount: 1,
      attributes: [
        {
          id: 'attr-1',
          name: '離峰',
          color: '#00ff00',
          headwaySeconds: 600,
          capacityPphpd: 300,
          isDraft: false,
        },
      ],
      intervals: [
        {
          id: 'slot-1',
          attributeId: 'attr-1',
          name: '凌晨',
          startTime: '00:00',
          endTime: '00:30',
          isDraft: false,
        },
      ],
      tasks: [
        { id: 'w1', rowIndex: 1, taskType: 'passenger', startMinute: 0, durationMinutes: 30, label: '正線' },
        { id: 'c1', rowIndex: 1, taskType: 'charging', startMinute: 30, durationMinutes: 60, label: '充電' },
      ] as ScheduleTask[],
    };

    const result = generateShiftSchedule({
      draft: buildDraft({
        maintenanceTask: {
          taskId: 'mt-1',
          taskName: '整備',
          skipped: false,
          entrySlackBySection: {
            charging: '120',
            carWash: '120',
            maintenance: '120',
            preTrip: '120',
            mobile: '120',
          },
        },
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [downRoute, upRoute],
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: body,
      maintenanceTaskBody: {
        charging: { stepEnabled: true },
      },
      passengerTimetableMode: 'template',
    });
    assert.equal(result.report.ok, true);
    const starts = result.plan!.timelines[0]!.blocks
      .filter((block) => block.taskType === 'passenger')
      .map((block) => Math.round(block.plannedStartMinute * 60));
    assert.ok(!starts.includes(1200), '超出餘裕時 00:20 不應開新輪');
    assert.ok(starts.includes(0), '00:00 開新輪應仍可發');
  });

  it('does not pre-dispatch into the tail of a preceding empty attribute period', () => {
    // 空時段讓渡只允許占用「開頭」（正線結束後）；
    // 不可像截圖那樣提前占用 04:00 前空時段的尾端。
    const tasks: ScheduleTask[] = [];
    for (let row = 1; row <= 4; row += 1) {
      tasks.push({
        id: `pax-${row}`,
        rowIndex: row,
        taskType: 'passenger',
        startMinute: 10 * 60,
        durationMinutes: 60,
        label: '正線',
      });
    }
    const body = {
      editorVersion: 1,
      vehicleCapacity: 50,
      scheduleRowCount: 4,
      attributes: [
        {
          id: 'attr-1',
          name: '尖峰',
          color: '#ff0000',
          headwaySeconds: 300,
          capacityPphpd: 600,
          isDraft: false,
        },
      ],
      intervals: [
        {
          id: 'slot-1',
          attributeId: 'attr-1',
          name: '上午',
          startTime: '10:00',
          endTime: '11:00',
          isDraft: false,
        },
      ],
      tasks,
    };

    const result = generateShiftSchedule({
      draft: buildDraft({
        timeTemplate: {
          templateId: 'TT-1',
          templateName: '模板',
          emptyIntervalMainlineSlackSeconds: '600',
        },
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [downRoute, upRoute],
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: body,
      passengerTimetableMode: 'template',
    });
    assert.equal(result.report.ok, true);
    const early = result.plan!.timelines
      .flatMap((timeline) => timeline.blocks)
      .filter(
        (block) =>
          block.taskType === 'passenger'
          && Math.round(block.plannedStartMinute * 60) < 10 * 3600,
      );
    assert.equal(early.length, 0, '不得提前占用空時段尾端出車');
  });

  it('keeps cross-interval same-direction gap at max(old, new) headway（300→180）', () => {
    // 切班：00:00–00:10 班距 300；00:10–00:40 班距 180。
    // 真實需求：跨時段相鄰下行須 ≥ max(300,180)=300，不得只守 180。
    const body = {
      editorVersion: 1,
      vehicleCapacity: 50,
      scheduleRowCount: 4,
      attributes: [
        {
          id: 'attr-300',
          name: '疏',
          color: '#00ff00',
          headwaySeconds: 300,
          capacityPphpd: 300,
          isDraft: false,
        },
        {
          id: 'attr-180',
          name: '密',
          color: '#0000ff',
          headwaySeconds: 180,
          capacityPphpd: 500,
          isDraft: false,
        },
      ],
      intervals: [
        {
          id: 'slot-a',
          attributeId: 'attr-300',
          name: '前段',
          startTime: '00:00',
          endTime: '00:10',
          isDraft: false,
        },
        {
          id: 'slot-b',
          attributeId: 'attr-180',
          name: '後段',
          startTime: '00:10',
          endTime: '00:40',
          isDraft: false,
        },
      ],
      tasks: [
        { id: 'w1', rowIndex: 1, taskType: 'passenger', startMinute: 0, durationMinutes: 40, label: '正線' },
        { id: 'w2', rowIndex: 2, taskType: 'passenger', startMinute: 0, durationMinutes: 40, label: '正線' },
        { id: 'w3', rowIndex: 3, taskType: 'passenger', startMinute: 0, durationMinutes: 40, label: '正線' },
        { id: 'w4', rowIndex: 4, taskType: 'passenger', startMinute: 0, durationMinutes: 40, label: '正線' },
      ] as ScheduleTask[],
    };

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [downRoute, upRoute],
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: body,
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, true);
    assert.ok(
      !result.report.warnings.some((issue) => issue.code === 'HEADWAY_BELOW_TARGET'),
      `不應有班距警告：${result.report.warnings.map((issue) => issue.message).join('; ')}`,
    );

    const downStarts = result.plan!.timelines
      .flatMap((timeline) => timeline.blocks)
      .filter((block) => block.taskType === 'passenger' && block.routeId === 'r-down')
      .map((block) => Math.round(block.plannedStartMinute * 60))
      .sort((a, b) => a - b);

    assert.ok(downStarts.length >= 2, '至少兩班下行');
    for (let i = 1; i < downStarts.length; i += 1) {
      const earlier = downStarts[i - 1]!;
      const later = downStarts[i]!;
      const gap = later - earlier;
      // 若任一端落在 300 秒時段（<600s），跨縫須 ≥300；純 180 時段內 ≥180
      const earlierInSparse = earlier < 10 * 60;
      const laterInSparse = later < 10 * 60;
      const required = earlierInSparse || laterInSparse ? 300 : 180;
      assert.ok(
        gap >= required,
        `下行 ${earlier}→${later} 間隔 ${gap} 應 ≥ ${required}`,
      );
    }
  });

  it('keeps same-direction headway regular（D0030→D0040→D0110 不再跳格）', () => {
    // 模擬使用者截圖情境：兩車、班距 600s、下行→上行輪替
    const body = {
      editorVersion: 1,
      vehicleCapacity: 50,
      scheduleRowCount: 2,
      attributes: [
        {
          id: 'attr-1',
          name: '離峰',
          color: '#00ff00',
          headwaySeconds: 600,
          capacityPphpd: 300,
          isDraft: false,
        },
      ],
      intervals: [
        {
          id: 'slot-1',
          attributeId: 'attr-1',
          name: '凌晨',
          startTime: '00:30',
          endTime: '01:30',
          isDraft: false,
        },
      ],
      tasks: [
        { id: 'w1', rowIndex: 1, taskType: 'passenger', startMinute: 30, durationMinutes: 60, label: '正線' },
        { id: 'w2', rowIndex: 2, taskType: 'passenger', startMinute: 30, durationMinutes: 60, label: '正線' },
      ] as ScheduleTask[],
    };

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [
            passengerRoute('r-down', '下行路線', 320, 265, 1, 36, 20, 10),
            passengerRoute('r-up', '上行路線', 320, 265, 2, 36, 20, 10),
          ].map((route) => ({
            ...route,
            stationDwells: [
              { stationId: 'a', stationName: 'a', dwellSeconds: 36 },
              { stationId: 'b', stationName: 'b', dwellSeconds: 36 },
              { stationId: 'c', stationName: 'c', dwellSeconds: 36 },
            ],
          })),
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: body,
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, true);
    assert.ok(result.plan);

    const downStarts = result.plan!.timelines
      .flatMap((t) => t.blocks)
      .filter((b) => b.taskType === 'passenger' && b.routeId === 'r-down')
      .map((b) => Math.round(b.plannedStartMinute * 60))
      .sort((a, b) => a - b);

    // 下行應為 00:30, 00:40, 00:50, 01:00, 01:10, 01:20…（穩定 600s，不再跳到 01:10）
    assert.ok(downStarts.length >= 3, `下行班次太少：${downStarts.join(',')}`);
    for (let i = 1; i < downStarts.length; i += 1) {
      assert.equal(
        downStarts[i]! - downStarts[i - 1]!,
        600,
        `下行班距跳格：${downStarts.map((s) => {
          const hh = String(Math.floor(s / 3600)).padStart(2, '0');
          const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
          return `${hh}:${mm}`;
        }).join(' → ')}`,
      );
    }

    const upStarts = result.plan!.timelines
      .flatMap((t) => t.blocks)
      .filter((b) => b.taskType === 'passenger' && b.routeId === 'r-up')
      .map((b) => Math.round(b.plannedStartMinute * 60))
      .sort((a, b) => a - b);
    for (let i = 1; i < upStarts.length; i += 1) {
      assert.equal(upStarts[i]! - upStarts[i - 1]!, 600, `上行班距跳格`);
    }
  });

  it('does not double headway when turnaround is slightly longer than headway（D0400→D0416）', () => {
    // 離峰H 600s → 離峰N 480s；占用 440 + 空檔 50 = 490 > 480。
    // 舊行為：04:08 脈衝因晚 10 秒被略過 → D0400 到下一班變成 16 分。
    // 新行為：允許小於一個班距的小幅延後，掛在 ≈04:08:10。
    const withPhysics = (route: ShiftScheduleSelectedRoute) => ({
      ...route,
      stationDwells: [
        { stationId: 'a', stationName: 'a', dwellSeconds: 36 },
        { stationId: 'b', stationName: 'b', dwellSeconds: 36 },
        { stationId: 'c', stationName: 'c', dwellSeconds: 36 },
      ],
    });
    const body = {
      editorVersion: 1,
      vehicleCapacity: 70,
      scheduleRowCount: 2,
      attributes: [
        {
          id: 'attr-h',
          name: '離峰H',
          color: '#00ff00',
          headwaySeconds: 600,
          capacityPphpd: 420,
          isDraft: false,
        },
        {
          id: 'attr-n',
          name: '離峰N',
          color: '#00ffff',
          headwaySeconds: 480,
          capacityPphpd: 525,
          isDraft: false,
        },
      ],
      intervals: [
        {
          id: 'slot-h',
          attributeId: 'attr-h',
          name: '離峰H段',
          startTime: '03:00',
          endTime: '04:00',
          isDraft: false,
        },
        {
          id: 'slot-n',
          attributeId: 'attr-n',
          name: '離峰N段',
          startTime: '04:00',
          endTime: '05:00',
          isDraft: false,
        },
      ],
      tasks: [
        { id: 'w1', rowIndex: 1, taskType: 'passenger', startMinute: 180, durationMinutes: 120, label: '正線' },
        { id: 'w2', rowIndex: 2, taskType: 'passenger', startMinute: 180, durationMinutes: 120, label: '正線' },
      ] as ScheduleTask[],
    };

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [
            withPhysics(passengerRoute('r-down', '下行路線', 320, 265, 1, 36, 20, 10)),
            withPhysics(passengerRoute('r-up', '上行路線', 320, 265, 2, 36, 20, 10)),
          ],
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: body,
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, true);
    assert.ok(result.plan);

    const downAroundTransition = result.plan!.timelines
      .flatMap((t) => t.blocks)
      .filter(
        (b) =>
          b.taskType === 'passenger'
          && b.routeId === 'r-down'
          && b.plannedStartMinute >= 235
          && b.plannedStartMinute <= 265,
      )
      .map((b) => Math.round(b.plannedStartMinute * 60))
      .sort((a, b) => a - b);

    // 04:00 之後應有 ≈04:08 的班，不可直接跳到 04:16
    const after0400 = downAroundTransition.filter((s) => s >= 14400);
    assert.ok(after0400.length >= 2, `過渡後下行太少：${after0400.join(',')}`);
    assert.equal(after0400[0], 14400, '應有 04:00 下行');
    const gap = after0400[1]! - after0400[0]!;
    assert.ok(
      gap >= 480 && gap < 600,
      `D0400 後班距應接近 480s 而非 960s，實際 ${gap}s（${after0400.map((s) => {
        const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        return `04:${mm}:${ss}`;
      }).join(' → ')}）`,
    );
  });

  it('does not skip mid-stream pulse when cumulative soft-delay exceeds 120s（D0538→D0552）', () => {
    // 離峰N 480s：前班若已略延，下一脈衝可能晚 >120s 才就緒；
    // 舊硬上限 120s 會整格略過 → 班距跳成 14 分。營運中應仍掛上。
    const withPhysics = (route: ShiftScheduleSelectedRoute) => ({
      ...route,
      stationDwells: [
        { stationId: 'a', stationName: 'a', dwellSeconds: 36 },
        { stationId: 'b', stationName: 'b', dwellSeconds: 36 },
        { stationId: 'c', stationName: 'c', dwellSeconds: 36 },
      ],
    });
    const body = {
      editorVersion: 1,
      vehicleCapacity: 70,
      scheduleRowCount: 2,
      attributes: [
        {
          id: 'attr-n',
          name: '離峰N',
          color: '#00ffff',
          headwaySeconds: 480,
          capacityPphpd: 525,
          isDraft: false,
        },
      ],
      intervals: [
        {
          id: 'slot-n',
          attributeId: 'attr-n',
          name: '離峰N段',
          startTime: '05:00',
          endTime: '06:30',
          isDraft: false,
        },
      ],
      tasks: [
        { id: 'w1', rowIndex: 1, taskType: 'passenger', startMinute: 300, durationMinutes: 90, label: '正線' },
        { id: 'w2', rowIndex: 2, taskType: 'passenger', startMinute: 300, durationMinutes: 90, label: '正線' },
      ] as ScheduleTask[],
    };

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [
            withPhysics(passengerRoute('r-down', '下行路線', 320, 265, 1, 36, 20, 10)),
            withPhysics(passengerRoute('r-up', '上行路線', 320, 265, 2, 36, 20, 10)),
          ],
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: body,
      passengerTimetableMode: 'template',
    });

    assert.equal(result.report.ok, true);
    assert.ok(result.plan);

    const downStarts = result.plan!.timelines
      .flatMap((t) => t.blocks)
      .filter((b) => b.taskType === 'passenger' && b.routeId === 'r-down')
      .map((b) => Math.round(b.plannedStartMinute * 60))
      .sort((a, b) => a - b);

    assert.ok(downStarts.length >= 4, `下行班次太少：${downStarts.join(',')}`);
    for (let i = 1; i < downStarts.length; i += 1) {
      const gap = downStarts[i]! - downStarts[i - 1]!;
      assert.ok(
        gap < 700,
        `下行班距跳格（疑似略過脈衝）：${downStarts.map((s) => {
          const hh = String(Math.floor(s / 3600)).padStart(2, '0');
          const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
          return `${hh}:${mm}`;
        }).join(' → ')}`,
      );
    }
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

describe('cycle pulse vehicle assignment regressions', () => {
  it('uses both available vehicles while rows 1-8 are under maintenance', () => {
    const down = {
      ...passengerRoute('r-down-loop', '主線下行', 320, 265, 1, 80),
      stationIds: ['p1', 't3'],
      stationDwells: [
        { stationId: 'p1', stationName: 'P1', dwellSeconds: 0 },
        { stationId: 't3', stationName: 'T3', dwellSeconds: 80 },
      ],
      serviceDirectionId: 'down',
    };
    const up = {
      ...passengerRoute('r-up-loop', '主線上行', 320, 265, 2, 80),
      stationIds: ['t3', 'p1'],
      stationDwells: [
        { stationId: 't3', stationName: 'T3', dwellSeconds: 0 },
        { stationId: 'p1', stationName: 'P1', dwellSeconds: 80 },
      ],
      serviceDirectionId: 'up',
    };
    const tasks: ScheduleTask[] = [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `maintenance-${index + 1}`,
        rowIndex: index + 1,
        taskType: 'servicing' as const,
        startMinute: 0,
        durationMinutes: 60,
        label: '保養',
      })),
      {
        id: 'vehicle-9-mainline',
        rowIndex: 9,
        taskType: 'passenger',
        startMinute: 0,
        durationMinutes: 60,
        label: '正線',
      },
      {
        id: 'vehicle-10-mainline',
        rowIndex: 10,
        taskType: 'passenger',
        startMinute: 0,
        durationMinutes: 60,
        label: '正線',
      },
    ];
    const body = {
      editorVersion: 1,
      vehicleCapacity: 70,
      scheduleRowCount: 10,
      attributes: [{
        id: 'attr-600',
        name: '離峰',
        color: '#0f0',
        headwaySeconds: 600,
        capacityPphpd: 420,
        isDraft: false,
      }],
      intervals: [{
        id: 'slot-midnight',
        attributeId: 'attr-600',
        name: '凌晨',
        startTime: '00:00',
        endTime: '01:00',
        isDraft: false,
      }],
      tasks,
    };

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [down, up],
          minimumRecoveryTimeSeconds: 30,
        },
      }),
      templateBody: body,
      passengerTimetableMode: 'template',
    });

    assert.equal(
      result.report.ok,
      true,
      result.report.errors.map((issue) => issue.message).join('; '),
    );
    const rowsWithPassenger = result.plan!.timelines
      .filter((timeline) =>
        timeline.blocks.some(
          (block) => block.taskType === 'passenger' && block.source === 'template_bar',
        ),
      )
      .map((timeline) => timeline.row)
      .sort((a, b) => a - b);
    assert.deepEqual(rowsWithPassenger, [9, 10]);

    for (const row of rowsWithPassenger) {
      const routeIds = result.plan!.timelines
        .find((timeline) => timeline.row === row)!
        .blocks
        .filter((block) => block.taskType === 'passenger')
        .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute)
        .map((block) => block.routeId);
      for (let i = 0; i < routeIds.length; i += 2) {
        assert.deepEqual(routeIds.slice(i, i + 2), ['r-down-loop', 'r-up-loop']);
      }
    }
  });

  it('after 行前 at T, starts cycle from T-origin route (not locked to NT pulse index 0)', () => {
    const down = {
      ...passengerRoute('r-nt', 'NT', 260, 200, 1, 40),
      stationIds: ['p1', 't3'],
      stationDwells: [
        { stationId: 'p1', stationName: 'P1', dwellSeconds: 0 },
        { stationId: 't3', stationName: 'T3', dwellSeconds: 40 },
      ],
      serviceDirectionId: 'down',
    };
    const up = {
      ...passengerRoute('r-tn', 'TN', 260, 200, 2, 40),
      stationIds: ['t3', 'p1'],
      stationDwells: [
        { stationId: 't3', stationName: 'T3', dwellSeconds: 0 },
        { stationId: 'p1', stationName: 'P1', dwellSeconds: 40 },
      ],
      serviceDirectionId: 'up',
    };
    const body = {
      editorVersion: 1,
      vehicleCapacity: 70,
      scheduleRowCount: 1,
      attributes: [{
        id: 'attr-600',
        name: '離峰',
        color: '#0f0',
        headwaySeconds: 600,
        capacityPphpd: 420,
        isDraft: false,
      }],
      intervals: [{
        id: 'slot-night',
        attributeId: 'attr-600',
        name: '凌晨',
        startTime: '01:00',
        endTime: '02:00',
        isDraft: false,
      }],
      tasks: [
        {
          id: 'insp-1',
          rowIndex: 1,
          taskType: 'inspection' as const,
          startMinute: 30,
          durationMinutes: 20,
          label: '行前',
        },
        {
          id: 'pax-win-1',
          rowIndex: 1,
          taskType: 'passenger' as const,
          startMinute: 60,
          durationMinutes: 60,
          label: '正線',
        },
      ],
    };

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [down, up],
          minimumRecoveryTimeSeconds: 30,
        },
        maintenanceTask: {
          skipped: false,
          taskId: 'MT-1',
          taskName: '整備',
          entrySlackBySection: {
            maintenance: 0,
            charging: 0,
            carWash: 0,
            preTrip: 0,
            mobile: 0,
          },
        },
      }),
      templateBody: body,
      maintenanceTaskBody: {
        preTrip: {
          stepEnabled: true,
          equipmentRows: [{ id: 'fac-m1', mapCode: 'M1' }],
        },
      },
      firstTripOrigins: [{
        stationId: 't3',
        label: 'T3',
        deadheadSeconds: 0,
        facilityNodeIds: ['fac-m1'],
        facilityLabels: ['M1'],
      }],
      passengerTimetableMode: 'template',
    });

    assert.equal(
      result.report.ok,
      true,
      result.report.errors.map((issue) => issue.message).join('; '),
    );
    const phaseRejects = result.report.errors.filter((issue) =>
      JSON.stringify(issue.detail ?? {}).includes('出場站／輪替相位不允許此起班路線'),
    );
    assert.equal(phaseRejects.length, 0);

    const firstPassenger = result.plan!.timelines
      .find((timeline) => timeline.row === 1)!
      .blocks
      .filter((block) => block.taskType === 'passenger' && block.source === 'template_bar')
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute)[0];
    assert.ok(firstPassenger, 'row 1 should get passenger after 行前');
    assert.equal(
      firstPassenger!.routeId,
      'r-tn',
      '行前出場 T 應對齊 TN（t3 起點），而非被脈衝鎖死在 NT',
    );
    assert.ok(firstPassenger!.plannedStartMinute >= 60);
  });

  it('after 行前 with only 機動 (no 正線), does not hang passenger toward exit', () => {
    const down = {
      ...passengerRoute('r-nt', 'NT', 260, 200, 1, 40),
      stationIds: ['p1', 't3'],
      stationDwells: [
        { stationId: 'p1', stationName: 'P1', dwellSeconds: 0 },
        { stationId: 't3', stationName: 'T3', dwellSeconds: 40 },
      ],
      serviceDirectionId: 'down',
    };
    const up = {
      ...passengerRoute('r-tn', 'TN', 260, 200, 2, 40),
      stationIds: ['t3', 'p1'],
      stationDwells: [
        { stationId: 't3', stationName: 'T3', dwellSeconds: 0 },
        { stationId: 'p1', stationName: 'P1', dwellSeconds: 40 },
      ],
      serviceDirectionId: 'up',
    };
    const body = {
      editorVersion: 1,
      vehicleCapacity: 70,
      scheduleRowCount: 1,
      attributes: [{
        id: 'attr-600',
        name: '離峰',
        color: '#0f0',
        headwaySeconds: 600,
        capacityPphpd: 420,
        isDraft: false,
      }],
      intervals: [{
        id: 'slot-night',
        attributeId: 'attr-600',
        name: '凌晨',
        startTime: '01:00',
        endTime: '02:00',
        isDraft: false,
      }],
      tasks: [
        {
          id: 'insp-1',
          rowIndex: 1,
          taskType: 'inspection' as const,
          startMinute: 30,
          durationMinutes: 20,
          label: '行前',
        },
        {
          id: 'sb-1',
          rowIndex: 1,
          taskType: 'standby' as const,
          startMinute: 60,
          durationMinutes: 60,
          label: '機動',
        },
      ],
    };

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [down, up],
          minimumRecoveryTimeSeconds: 30,
        },
        maintenanceTask: {
          skipped: false,
          taskId: 'MT-1',
          taskName: '整備',
          entrySlackBySection: {
            maintenance: 0,
            charging: 0,
            carWash: 0,
            preTrip: 0,
            mobile: 0,
          },
        },
      }),
      templateBody: body,
      maintenanceTaskBody: {
        preTrip: {
          stepEnabled: true,
          equipmentRows: [{ id: 'fac-m1', mapCode: 'M1' }],
        },
      },
      firstTripOrigins: [{
        stationId: 't3',
        label: 'T3',
        deadheadSeconds: 0,
        facilityNodeIds: ['fac-m1'],
        facilityLabels: ['M1'],
      }],
      passengerTimetableMode: 'template',
    });

    const passengerBars = result.plan!.timelines
      .find((timeline) => timeline.row === 1)!
      .blocks
      .filter((block) => block.taskType === 'passenger' && block.source === 'template_bar');
    assert.equal(
      passengerBars.length,
      0,
      '純機動列不應為了行前出場對齊而掛正線（不必特地跑向 N2W／T 出場方向）',
    );
    const standby = result.plan!.timelines
      .find((timeline) => timeline.row === 1)!
      .blocks
      .find((block) => block.taskType === 'standby');
    assert.ok(standby, '應保留機動視窗');
  });

  it('yields an already-placed same-direction trip so a yard-exit car can take the pulse', () => {
    const down = {
      ...passengerRoute('r-nt', 'NT', 280, 220, 1, 40),
      stationIds: ['p1', 't3'],
      stationDwells: [
        { stationId: 'p1', stationName: 'P1', dwellSeconds: 0 },
        { stationId: 't3', stationName: 'T3', dwellSeconds: 40 },
      ],
      serviceDirectionId: 'down',
    };
    const up = {
      ...passengerRoute('r-tn', 'TN', 280, 220, 2, 40),
      stationIds: ['t3', 'p1'],
      stationDwells: [
        { stationId: 't3', stationName: 'T3', dwellSeconds: 0 },
        { stationId: 'p1', stationName: 'P1', dwellSeconds: 40 },
      ],
      serviceDirectionId: 'up',
    };
    // 車 2 跑到 01:00 進充電；車 1 行前後 01:00 開窗且相位＝TN。
    // 車 2 最後一輪的 TN 會堵住班距；讓路後車 1 應承接 01:00 脈衝。
    const body = {
      editorVersion: 1,
      vehicleCapacity: 70,
      scheduleRowCount: 2,
      attributes: [{
        id: 'attr-600',
        name: '離峰',
        color: '#0f0',
        headwaySeconds: 600,
        capacityPphpd: 420,
        isDraft: false,
      }],
      intervals: [{
        id: 'slot-night',
        attributeId: 'attr-600',
        name: '凌晨',
        startTime: '00:00',
        endTime: '02:00',
        isDraft: false,
      }],
      tasks: [
        {
          id: 'insp-1',
          rowIndex: 1,
          taskType: 'inspection' as const,
          startMinute: 30,
          durationMinutes: 20,
          label: '行前',
        },
        {
          id: 'pax-win-1',
          rowIndex: 1,
          taskType: 'passenger' as const,
          startMinute: 60,
          durationMinutes: 60,
          label: '正線',
        },
        {
          id: 'pax-win-2',
          rowIndex: 2,
          taskType: 'passenger' as const,
          startMinute: 0,
          durationMinutes: 60,
          label: '正線',
        },
        {
          id: 'chg-2',
          rowIndex: 2,
          taskType: 'charging' as const,
          startMinute: 60,
          durationMinutes: 60,
          label: '充電',
        },
      ],
    };

    const result = generateShiftSchedule({
      draft: buildDraft({
        routeGroups: {
          mapId: 'map-1',
          selectedRoutes: [down, up],
          minimumRecoveryTimeSeconds: 10,
        },
        maintenanceTask: {
          skipped: false,
          taskId: 'MT-1',
          taskName: '整備',
          entrySlackBySection: {
            maintenance: 600,
            charging: 600,
            carWash: 0,
            preTrip: 0,
            mobile: 0,
          },
        },
      }),
      templateBody: body,
      maintenanceTaskBody: {
        preTrip: {
          stepEnabled: true,
          equipmentRows: [{ id: 'fac-m1', mapCode: 'M1' }],
        },
      },
      firstTripOrigins: [{
        stationId: 't3',
        label: 'T3',
        deadheadSeconds: 0,
        facilityNodeIds: ['fac-m1'],
        facilityLabels: ['M1'],
      }],
      passengerTimetableMode: 'template',
    });

    const unservedAt0100 = result.report.errors.filter(
      (issue) =>
        issue.code === 'UNSERVED_SERVICE_PULSE'
        && String(issue.message).includes('01:00'),
    );
    assert.equal(
      unservedAt0100.length,
      0,
      unservedAt0100.map((issue) => JSON.stringify(issue.detail)).join('; '),
    );

    const row1Passengers = result.plan!.timelines
      .find((timeline) => timeline.row === 1)!
      .blocks
      .filter((block) => block.taskType === 'passenger' && block.source === 'template_bar')
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    assert.ok(row1Passengers.length >= 1, 'yard-exit row should receive passenger trips');
    assert.equal(row1Passengers[0]!.routeId, 'r-tn');
    assert.ok(
      row1Passengers[0]!.plannedStartMinute >= 60
      && row1Passengers[0]!.plannedStartMinute < 70,
      `expected row1 TN near 01:00, got ${row1Passengers[0]!.plannedStartMinute}`,
    );

    const tnTrips = result.plan!.timelines
      .flatMap((timeline) =>
        timeline.blocks
          .filter(
            (block) =>
              block.taskType === 'passenger'
              && block.routeId === 'r-tn'
              && block.plannedStartMinute >= 45
              && block.plannedStartMinute <= 85,
          )
          .map((block) => ({
            row: timeline.row,
            start: block.plannedStartMinute,
          })),
      )
      .sort((a, b) => a.start - b.start || a.row - b.row);

    const row1Tn = tnTrips.find((trip) => trip.row === 1);
    const row2TnAfter = tnTrips.find(
      (trip) => trip.row === 2 && row1Tn != null && trip.start >= row1Tn.start - 1e-9,
    );
    assert.ok(row1Tn, `row1 TN missing: ${JSON.stringify(tnTrips)}`);
    if (row2TnAfter) {
      assert.ok(
        row2TnAfter.start - row1Tn!.start >= 10 - 1e-9,
        `TN headway broken after yield: ${JSON.stringify(tnTrips)}`,
      );
    }
  });
});

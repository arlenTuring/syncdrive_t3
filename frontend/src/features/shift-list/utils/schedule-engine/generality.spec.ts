import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  emptyShiftScheduleCreateDraft,
  type ShiftScheduleCreateDraft,
  type ShiftScheduleSelectedRoute,
} from '../../types/create';
import type { ScheduleTask } from '../../../time-templates/types/editor';
import { generateShiftSchedule, type GenerateShiftScheduleInput } from './generate';
import type { GeneratedSchedulePlan } from './types';
import { buildPlanFingerprint } from '../schedulePublishCheck';

/**
 * 泛用性：結果只由輸入條件決定。
 *
 * 同一組條件換名字、整體平移時刻、重跑、拿上次的產出再生成，結果必須等價。
 * 真實資料的大規模版本在 scripts/generality-schedule-engine.mts（需要本機 log）。
 */

const ROUTE_IDS = ['down', 'up'] as const;

function route(id: string, name: string, order: number, prefix = ''): ShiftScheduleSelectedRoute {
  const stations = ['a', 'b', 'c'].map((station) => `${prefix}${station}`);
  return {
    routeId: `${prefix}${id}`,
    routeName: `${prefix}${name}`,
    groupId: `${prefix}g1`,
    groupName: `${prefix}G1`,
    stationIds: order === 1 ? stations : [...stations].reverse(),
    stationDwells: (order === 1 ? stations : [...stations].reverse()).map((stationId) => ({
      stationId,
      stationName: `${prefix}站${stationId}`,
      dwellSeconds: 36,
    })),
    stationDwellsConfirmed: true,
    stationLegTravels: [],
    avgTravelTimeSeconds: 320,
    minTravelTimeSeconds: 265,
    executionOrder: order,
    switchBufferAfterSeconds: 20,
    dwellSlackSeconds: 10,
  };
}

function input(options: { shiftMinutes?: number; prefix?: string } = {}): GenerateShiftScheduleInput {
  const shift = options.shiftMinutes ?? 0;
  const prefix = options.prefix ?? '';
  const clock = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  const base = emptyShiftScheduleCreateDraft();
  const draft: ShiftScheduleCreateDraft = {
    ...base,
    timeTemplate: { ...base.timeTemplate, templateId: `${prefix}TT-1`, templateName: `${prefix}模板` },
    routeGroups: {
      mapId: `${prefix}map-1`,
      selectedRoutes: [route(ROUTE_IDS[0], '下行', 1, prefix), route(ROUTE_IDS[1], '上行', 2, prefix)],
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
    },
  };
  const tasks: ScheduleTask[] = [
    { id: `${prefix}w1`, rowIndex: 1, taskType: 'passenger', startMinute: 30 + shift, durationMinutes: 90, label: `${prefix}正線` },
    { id: `${prefix}w2`, rowIndex: 2, taskType: 'passenger', startMinute: 30 + shift, durationMinutes: 90, label: `${prefix}正線` },
    { id: `${prefix}w3`, rowIndex: 3, taskType: 'passenger', startMinute: 60 + shift, durationMinutes: 60, label: `${prefix}正線` },
  ] as ScheduleTask[];
  return {
    draft,
    templateBody: {
      editorVersion: 1,
      vehicleCapacity: 50,
      scheduleRowCount: 3,
      attributes: [
        { id: `${prefix}attr-1`, name: `${prefix}離峰`, color: '#00ff00', headwaySeconds: 600, capacityPphpd: 300, isDraft: false },
        { id: `${prefix}attr-2`, name: `${prefix}尖峰`, color: '#ff0000', headwaySeconds: 420, capacityPphpd: 600, isDraft: false },
      ],
      intervals: [
        { id: `${prefix}slot-1`, attributeId: `${prefix}attr-1`, name: `${prefix}凌晨`, startTime: clock(30 + shift), endTime: clock(60 + shift), isDraft: false },
        { id: `${prefix}slot-2`, attributeId: `${prefix}attr-2`, name: `${prefix}早`, startTime: clock(60 + shift), endTime: clock(120 + shift), isDraft: false },
      ],
      tasks,
    },
    passengerTimetableMode: 'template',
  };
}

/** 時刻＋列＋種類＋路線的正規化指紋（不含識別碼，改名後仍可比） */
function shape(plan: GeneratedSchedulePlan, options: { shiftMinutes?: number; prefix?: string } = {}): string[] {
  const shiftSeconds = (options.shiftMinutes ?? 0) * 60;
  const strip = (value: string | undefined) =>
    value && options.prefix && value.startsWith(options.prefix) ? value.slice(options.prefix.length) : value ?? '';
  return plan.timelines
    .flatMap((timeline) =>
      timeline.blocks.map((block) =>
        [
          timeline.row,
          block.taskType,
          block.source,
          strip(block.routeId),
          Math.round(block.plannedStartMinute * 60) - shiftSeconds,
          Math.round(block.plannedEndMinute * 60) - shiftSeconds,
          block.dwellSlackAdjustment?.addedSeconds ?? 0,
        ].join('|'),
      ))
    .sort();
}

function issueCodes(result: ReturnType<typeof generateShiftSchedule>): string[] {
  return [...result.report.errors, ...result.report.warnings].map((issue) => issue.code).sort();
}

describe('排班引擎泛用性', () => {
  const baseline = generateShiftSchedule(input());

  it('基準情境產得出班表', () => {
    assert.ok(baseline.plan);
    const trips = baseline.plan!.timelines.flatMap((timeline) => timeline.blocks).filter((block) => block.taskType === 'passenger');
    assert.ok(trips.length >= 6, `班次太少：${trips.length}`);
  });

  it('整體平移（+70 分、+11 小時 10 分）：每張卡的時刻差固定值，問題種類不變', () => {
    for (const shiftMinutes of [70, 670]) {
      const shifted = generateShiftSchedule(input({ shiftMinutes }));
      assert.ok(shifted.plan);
      assert.deepEqual(shape(shifted.plan!, { shiftMinutes }), shape(baseline.plan!), `平移 ${shiftMinutes} 分後結果不等價`);
      assert.deepEqual(issueCodes(shifted), issueCodes(baseline));
    }
  });

  it('所有識別碼與名稱換掉：結果等價（引擎不認特定名字）', () => {
    const prefix = '改名_';
    const renamed = generateShiftSchedule(input({ prefix }));
    assert.ok(renamed.plan);
    assert.deepEqual(shape(renamed.plan!, { prefix }), shape(baseline.plan!));
    assert.deepEqual(issueCodes(renamed), issueCodes(baseline));
  });

  it('同一份輸入重跑：完全一樣', () => {
    const again = generateShiftSchedule(input());
    assert.equal(buildPlanFingerprint(again.plan), buildPlanFingerprint(baseline.plan));
  });

  it('草稿帶著上次的產出（含系統增加緩衝）再生成：從原始設定算起，不累加', () => {
    const next = input();
    const previousPlan = structuredClone(baseline.plan!);
    // 就算上次的產出每一趟都被加過緩衝，也不能被當成這次的原始設定
    for (const timeline of previousPlan.timelines) {
      for (const block of timeline.blocks) {
        if (block.taskType !== 'passenger') continue;
        block.dwellSlackAdjustment = {
          baseSlackSeconds: 10,
          addedSeconds: 90,
          reason: { code: 'X', resourceId: 'a', resourceLabel: 'a', counterpartBlockIds: [], message: '' },
          affectedStops: [],
          blockBefore: { startMinute: block.plannedStartMinute, endMinute: block.plannedEndMinute },
        };
      }
    }
    next.draft = {
      ...next.draft,
      scheduleOutput: {
        outputVersion: 2,
        generatedAt: '',
        plan: previousPlan,
        feasibilityReport: baseline.report,
      },
    } as ShiftScheduleCreateDraft;
    const regenerated = generateShiftSchedule(next);
    assert.equal(buildPlanFingerprint(regenerated.plan), buildPlanFingerprint(baseline.plan));
  });

  it('保存／重開：JSON 來回後指紋與緩衝紀錄不變', () => {
    const reopened = JSON.parse(JSON.stringify(baseline.plan)) as GeneratedSchedulePlan;
    assert.equal(buildPlanFingerprint(reopened), buildPlanFingerprint(baseline.plan));
  });
});

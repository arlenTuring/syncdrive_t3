import { describe, expect, it } from 'vitest';
import { createEmptyManualSchedulePlan } from './buildManualShiftScheduleOutput';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import {
  applyManualBlockDwells,
  applyManualBlockTimeRange,
  duplicateManualScheduleBlock,
  hydrateManualPlanStationDwellsFromRoutes,
  insertManualScheduleBlock,
  resolveManualBlockMinDurationMinutes,
  wouldManualBlockOverlap,
} from './manualScheduleEdit';

describe('manualScheduleEdit', () => {
  it('inserts a 10-minute block and rejects overlap', () => {
    const empty = createEmptyManualSchedulePlan({ scheduleRowCount: 2 });
    const first = insertManualScheduleBlock({
      plan: empty,
      timelineRow: 1,
      startMinute: 13 * 60 + 30,
      taskType: 'servicing',
    });
    expect(first).not.toBeNull();
    expect(first!.plan.timelines[0]!.blocks.some((b) => b.source === 'template_bar')).toBe(true);
    const bar = first!.plan.timelines[0]!.blocks.find((b) => b.source === 'template_bar');
    expect(bar!.plannedEndMinute - bar!.plannedStartMinute).toBe(10);

    expect(
      wouldManualBlockOverlap({
        plan: first!.plan,
        timelineRow: 1,
        startMinute: 13 * 60 + 35,
        endMinute: 13 * 60 + 45,
      }),
    ).toBe(true);

    const overlapping = insertManualScheduleBlock({
      plan: first!.plan,
      timelineRow: 1,
      startMinute: 13 * 60 + 35,
      taskType: 'charging',
    });
    expect(overlapping).toBeNull();
  });

  it('moves block on 10-second snap without overlap', () => {
    const empty = createEmptyManualSchedulePlan({ scheduleRowCount: 1 });
    const inserted = insertManualScheduleBlock({
      plan: empty,
      timelineRow: 1,
      startMinute: 60,
      taskType: 'charging',
    });
    expect(inserted).not.toBeNull();
    const blockId = inserted!.blockId;
    const moved = applyManualBlockTimeRange({
      plan: inserted!.plan,
      blockId,
      startMinute: 60 + 10 / 60,
      endMinute: 90 + 10 / 60,
    });
    expect(moved).not.toBeNull();
    const bar = moved!.plan.timelines[0]!.blocks.find((b) => b.id === blockId);
    expect(bar?.plannedStartMinute).toBeCloseTo(60 + 10 / 60, 5);
    expect(bar?.plannedEndMinute).toBeCloseTo(90 + 10 / 60, 5);
  });

  it('rejects shrink below dwell total and duplicates after end', () => {
    const empty = createEmptyManualSchedulePlan({ scheduleRowCount: 1 });
    const inserted = insertManualScheduleBlock({
      plan: empty,
      timelineRow: 1,
      startMinute: 60,
      taskType: 'passenger',
    });
    expect(inserted).not.toBeNull();
    const withDwells = applyManualBlockDwells({
      plan: inserted!.plan,
      blockId: inserted!.blockId,
      stationDwells: [
        { stationId: 'a', stationName: 'A', dwellSeconds: 120 },
        { stationId: 'b', stationName: 'B', dwellSeconds: 180 },
      ],
      dwellSlackSeconds: 30,
    });
    expect(withDwells).not.toBeNull();
    const block = withDwells!.plan.timelines[0]!.blocks.find((b) => b.id === inserted!.blockId)!;
    // 首站不計——班次卡從「起點離站」起算，A 站的靠站發生在卡開始之前
    // （applyStationDwellWithSlack 的 index === 0 分支）。所以只有 B：180+30 = 210s = 3.5 min
    expect(resolveManualBlockMinDurationMinutes(block)).toBe(3.5);
    const tooShort = applyManualBlockTimeRange({
      plan: withDwells!.plan,
      blockId: inserted!.blockId,
      startMinute: block.plannedStartMinute,
      endMinute: block.plannedStartMinute + 3,
    });
    expect(tooShort).toBeNull();

    const duplicated = duplicateManualScheduleBlock({
      plan: withDwells!.plan,
      blockId: inserted!.blockId,
    });
    expect(duplicated.ok).toBe(true);
    if (duplicated.ok) {
      const clone = duplicated.plan.timelines[0]!.blocks.find((b) => b.id === duplicated.blockId)!;
      expect(clone.plannedStartMinute).toBe(block.plannedEndMinute);
      expect(clone.plannedEndMinute - clone.plannedStartMinute).toBe(10);
      expect(clone.stationDwells?.length).toBe(2);
    }
  });

  it('hydrates passenger blocks missing station dwells from routes', () => {
    const empty = createEmptyManualSchedulePlan({ scheduleRowCount: 1 });
    const inserted = insertManualScheduleBlock({
      plan: empty,
      timelineRow: 1,
      startMinute: 60,
      taskType: 'passenger',
    });
    expect(inserted).not.toBeNull();
    const blockId = inserted!.blockId;
    const withoutDwells = {
      ...inserted!.plan,
      timelines: inserted!.plan.timelines.map((timeline) => ({
        ...timeline,
        blocks: timeline.blocks.map((block) =>
          block.id === blockId
            ? {
                ...block,
                routeId: 'r1',
                routeName: '下行',
                stationDwells: undefined,
                dwellSlackSeconds: undefined,
                dwellSeconds: 300,
              }
            : block,
        ),
      })),
    };
    const route: ShiftScheduleSelectedRoute = {
      routeId: 'r1',
      routeName: '下行',
      routeCode: 'D',
      groupId: 'g1',
      groupName: 'G',
      stationIds: ['a', 'b'],
      avgTravelTimeSeconds: 100,
      minTravelTimeSeconds: 90,
      stationDwells: [
        { stationId: 'a', stationName: 'A', dwellSeconds: 40 },
        { stationId: 'b', stationName: 'B', dwellSeconds: 50 },
      ],
      stationDwellsConfirmed: true,
      stationLegTravels: [],
      switchBufferAfterSeconds: 0,
      dwellSlackSeconds: 10,
      executionOrder: 1,
    };
    const hydrated = hydrateManualPlanStationDwellsFromRoutes({
      plan: withoutDwells,
      routes: [route],
    });
    const block = hydrated.timelines[0]!.blocks.find((item) => item.id === blockId)!;
    expect(block.stationDwells).toEqual(route.stationDwells);
    expect(block.dwellSlackSeconds).toBe(10);
    // 首站 a 不計（同上），只有 b：50+10 = 60
    expect(block.dwellSeconds).toBe(60);

    const again = hydrateManualPlanStationDwellsFromRoutes({
      plan: hydrated,
      routes: [route],
    });
    expect(again).toBe(hydrated);
  });

  it('warns when duplicate has no space', () => {
    const empty = createEmptyManualSchedulePlan({ scheduleRowCount: 1 });
    const first = insertManualScheduleBlock({
      plan: empty,
      timelineRow: 1,
      startMinute: 24 * 60 - 5,
      taskType: 'charging',
      durationMinutes: 5,
    });
    expect(first).not.toBeNull();
    const result = duplicateManualScheduleBlock({
      plan: first!.plan,
      blockId: first!.blockId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('沒有足夠的空間');
    }
  });
});

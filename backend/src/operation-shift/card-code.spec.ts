import {
  cardDisplayCode,
  checkShiftCardCodes,
  describeCardCodeConflict,
  readCardCodeSettings,
} from './card-code';
import { extractYardTasks } from '../dispatch/dispatch.yard-tasks';
import { extractYardMoves } from '../dispatch/dispatch.yard-moves';
import { buildOrderId, dropDuplicateOrderIds, type PlannedDispatch } from '../dispatch/dispatch.plan';
import { resolveTimetableTripCode } from './timetable/trip-code';

const sectionCodes = { charging: 'E', carWash: 'W', maintenance: 'M', preTrip: 'P', mobile: 'S' };
const transitionCardCodes = { entry: 'IN', exit: 'OU', hold: 'H' };

type Block = Record<string, unknown>;
const charging = (row: number, start: number, slot = 'E3', node = '149'): Block => ({
  id: `chg-${row}-${start}`, taskType: 'charging', source: 'template_bar', timelineRow: row,
  plannedStartMinute: start, plannedEndMinute: start + 60, yardFacilityNodeId: node, yardFacilityLabel: slot,
});
const hold = (row: number, start: number): Block => ({
  id: `hold-${row}-${start}`, taskType: 'idle', source: 'hold', timelineRow: row,
  plannedStartMinute: start, plannedEndMinute: start + 5, yardFacilityNodeId: '139', yardFacilityLabel: 'D3',
});
const stay = (row: number, start: number): Block => ({
  id: `stay-${row}-${start}`, taskType: 'idle', source: 'transition', label: '暫停放 · E1', timelineRow: row,
  plannedStartMinute: start, plannedEndMinute: start + 2, yardFacilityNodeId: '147', yardFacilityLabel: 'E1',
});
const move = (row: number, start: number, source: 'yard_exit_move' | 'yard_entry_move'): Block => ({
  id: `${source}-${row}-${start}`, taskType: 'dispatch', source, timelineRow: row,
  plannedStartMinute: start, plannedEndMinute: start + 3, yardExitFacilityNodeId: '149', yardExitFacilityLabel: 'E3',
  yardExitStationId: 't3_u', yardExitStationLabel: 'T3上行', yardExitSectionCode: 'E',
});
const passenger = (row: number, start: number, routeCode = 'TN'): Block => ({
  id: `pax-${row}-${start}`, taskType: 'passenger', source: 'template_bar', timelineRow: row, routeCode,
  plannedStartMinute: start, plannedEndMinute: start + 20,
});

function body(blocks: Block[], withTransitionCodes = true): Record<string, unknown> {
  const rows = new Map<number, Block[]>();
  for (const block of blocks) rows.set(Number(block.timelineRow), [...(rows.get(Number(block.timelineRow)) ?? []), block]);
  return {
    maintenanceSectionCodeBySection: sectionCodes,
    ...(withTransitionCodes ? { transitionCardCodes } : {}),
    selectedRoutes: [{ routeId: 'r1', routeCode: 'TN' }],
    scheduleOutput: { plan: { timelines: [...rows.entries()].map(([row, list]) => ({ row, blocks: list })) } },
  };
}

describe('maintenance / transition card codes', () => {
  it('row 2 charging (E) at 18:30 shows E021830 — no MT-, slot, row letter or seconds', () => {
    const settings = readCardCodeSettings(body([]));
    expect(cardDisplayCode(charging(2, 18 * 60 + 30.75), settings)).toBe('E021830');
    expect(cardDisplayCode(move(10, 21 * 60 + 35, 'yard_entry_move'), settings)).toBe('IN102135');
    const { tasks } = extractYardTasks(body([charging(2, 18 * 60 + 30)]));
    expect(tasks[0].tripCode).toBe('E021830');
    expect(buildOrderId(tasks[0].tripCode, Date.UTC(2026, 9, 11, 10, 30))).toBe('261011-E021830');
  });

  it('entry, exit and hold/stay cards follow the same rule with their own codes', () => {
    const plan = body([move(1, 600, 'yard_exit_move'), move(1, 700, 'yard_entry_move'), hold(1, 705), stay(1, 800)]);
    expect(extractYardMoves(plan).moves.map((m) => m.tripCode)).toEqual(['OU011000', 'IN011140']);
    expect(extractYardTasks(plan).tasks.map((t) => t.tripCode)).toEqual(['H011145', 'H011320']);
  });

  it('timetable API, task orders and the shared rule give the same code', () => {
    const plan = body([charging(1, 18 * 60 + 30)]);
    const settings = readCardCodeSettings(plan);
    const block = (plan.scheduleOutput as { plan: { timelines: Array<{ blocks: Block[] }> } }).plan.timelines[0].blocks[0];
    expect(resolveTimetableTripCode(block as never, 0, settings)).toBe('E011830');
    expect(extractYardTasks(plan).tasks[0].tripCode).toBe('E011830');
  });

  it('a changed planned start regenerates the code; the code only depends on the plan', () => {
    expect(extractYardTasks(body([charging(1, 18 * 60 + 30)])).tasks[0].tripCode).toBe('E011830');
    expect(extractYardTasks(body([charging(1, 18 * 60 + 45)])).tasks[0].tripCode).toBe('E011845');
  });

  it('old shifts without transition codes keep their legacy codes (existing orders keep their keys)', () => {
    const plan = body([charging(1, 18 * 60 + 30), move(1, 600, 'yard_exit_move')], false);
    expect(readCardCodeSettings(plan).version).toBe(1);
    expect(extractYardTasks(plan).tasks[0].tripCode).toBe('MT-E3-R1-66600');
    expect(extractYardMoves(plan).moves[0].tripCode).toBe('MVOUT-R1-36000');
    expect(checkShiftCardCodes(plan).conflicts).toEqual([]);
  });

  it('missing code on a used card type is reported and no order is invented', () => {
    const plan = { ...body([hold(1, 705)]), transitionCardCodes: { entry: 'IN', exit: 'OU', hold: '' } };
    const report = checkShiftCardCodes(plan);
    expect(report.configIssues.map((i) => i.message)).toEqual(['「暫停／停留」卡有排入班表，但還沒設定代號']);
    const extracted = extractYardTasks(plan);
    expect(extracted.tasks).toEqual([]);
    expect(extracted.skipped[0].reason).toContain('待補設定');
  });

  it('rejects the same code for two purposes and a code equal to a route code', () => {
    const plan = { ...body([charging(1, 600), hold(1, 700), passenger(2, 600)]), transitionCardCodes: { entry: 'IN', exit: 'OU', hold: 'E' } };
    const messages = checkShiftCardCodes(plan).configIssues.map((i) => i.message);
    expect(messages).toContain('代號「E」同時用在 充電、暫停／停留，不同用途不能共用');
    const routeClash = { ...body([charging(1, 600)]), selectedRoutes: [{ routeCode: 'E' }] };
    expect(checkShiftCardCodes(routeClash).configIssues.map((i) => i.message)).toContain('「充電」代號「E」與正線路線代號相同，班次代號會混淆');
  });

  it('two vehicles charging in the same minute get different codes because of the row', () => {
    const plan = body([charging(2, 18 * 60 + 30, 'E1', '147'), charging(5, 18 * 60 + 30.5, 'E3', '149')]);
    expect(extractYardTasks(plan).tasks.map((t) => t.tripCode)).toEqual(['E021830', 'E051830']);
    expect(checkShiftCardCodes(plan).conflicts).toEqual([]);
  });

  it('two cards of the same kind in the same row and minute are listed as a conflict, nothing appended', () => {
    const plan = body([charging(2, 18 * 60 + 30, 'E1', '147'), charging(2, 18 * 60 + 30.5, 'E3', '149')]);
    const report = checkShiftCardCodes(plan);
    expect(report.conflicts).toHaveLength(1);
    expect(describeCardCodeConflict(report.conflicts[0])).toBe('E021830：充電（第 2 列 18:30）／充電（第 2 列 18:30）');
    expect(extractYardTasks(plan).tasks.map((t) => t.tripCode)).toEqual(['E021830', 'E021830']);
  });

  it('final check includes passenger codes from the timetable', () => {
    const plan = body([charging(1, 600)]);
    const report = checkShiftCardCodes(plan, [{ code: 'E011000', kind: '正線', blockId: 'p', timelineRow: 3, plannedStartMinute: 600, time: '10:00' }]);
    expect(report.conflicts.map((c) => c.code)).toEqual(['E011000']);
  });

  it('the dispatcher never issues two orders with the same id (no cross-vehicle overwrite)', () => {
    const item = (vehicleCode: string, row: number) => ({
      orderId: '261011-E021830', tripCode: 'E021830', vehicleCode, timelineRow: row, cardLabel: '充電',
    }) as PlannedDispatch;
    const other = { ...item('PMS03', 3), orderId: '261011-E031900', tripCode: 'E031900' } as PlannedDispatch;
    const result = dropDuplicateOrderIds([item('PMS02', 2), item('PMS05', 5), other]);
    expect(result.planned.map((p) => p.orderId)).toEqual(['261011-E031900']);
    expect(result.skipped[0].reason).toContain('代號衝突：E021830 同一份班表出現 2 次');
  });

  it('the same display code on different days is a different order', () => {
    expect(buildOrderId('E021830', Date.UTC(2026, 9, 11, 10, 30))).not.toBe(buildOrderId('E021830', Date.UTC(2026, 9, 12, 10, 30)));
  });
});

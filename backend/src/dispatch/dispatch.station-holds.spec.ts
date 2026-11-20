import { planStationHolds, type PlannedDispatch } from './dispatch.plan';
import { extractStationHolds, extractYardTasks } from './dispatch.yard-tasks';
import { dispatchOrderFields } from './dispatch-order-kind';
import { planDigestOf } from './dispatch.simulation-plan';

/**
 * 月台上的暫停卡也要發成訂單（使用者 2026-11-20：排班排出的每一張卡都要是車輛可以遵守的訂單）。
 * 實例：1118 班表「列車 2 · 暫停」02:19:50–02:29:30 停在 NWD，以前沒有訂單，車輛卡一片空白。
 */
const body = (blocks: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({
  transitionCardCodes: { exit: 'OT', hold: 'WT', entry: 'IN' },
  ...extra,
  scheduleOutput: { plan: { timelines: [{ blocks }] } },
});

const platformHold = {
  id: 'hold-template-pax-slot-12-4',
  label: '列車 2 · 暫停',
  source: 'hold',
  taskType: 'idle',
  timelineRow: 2,
  plannedStartMinute: 139 + 50 / 60,
  plannedEndMinute: 149.5,
  yardFacilityLabel: 'NWD',
  yardFacilityStationId: 'n2w_d',
};
const yardHold = {
  id: 'hold-yard-1',
  source: 'hold',
  taskType: 'idle',
  timelineRow: 3,
  plannedStartMinute: 60,
  plannedEndMinute: 70,
  yardFacilityNodeId: '138',
  yardFacilityLabel: 'H3',
};

// 2026-11-20 00:00（台北）
const reference = new Date('2026-11-20T00:00:00+08:00').getTime();
const fleet = ['PMS01', 'PMS02', 'PMS03'];

describe('月台暫停卡發成訂單', () => {
  it('抽出月台暫停卡：代號照暫停代號＋列號＋HHMM，起訖是那個月台', () => {
    const { holds, skipped } = extractStationHolds(body([platformHold, yardHold]));
    expect(skipped).toEqual([]);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ tripCode: 'WT020219', stationId: 'n2w_d', stationName: 'NWD', taskType: 'idle', timelineRow: 2, cardLabel: '暫停' });
  });

  it('場區格位上的暫停卡照舊是整備抽取那邊的；月台暫停卡不進整備（不佔格位）', () => {
    const { tasks } = extractYardTasks(body([platformHold, yardHold]));
    expect(tasks.map((t) => t.yardSlotId)).toEqual(['H3']);
  });

  it('既沒有格位也沒有月台的卡不再靜靜略過，列進 skipped 說明原因', () => {
    const { tasks, skipped } = extractYardTasks(body([{ ...yardHold, id: 'lost', yardFacilityNodeId: undefined, yardFacilityLabel: undefined }]));
    expect(tasks).toEqual([]);
    expect(skipped).toEqual([{ blockId: 'lost', reason: expect.stringContaining('沒有格位也沒有月台') }]);
  });

  it('訂單：停在 NWD 從 02:19:50 到 02:29:30，業務分類是過渡、不帶整備格位，卡片短名稱「暫停 NWD」', () => {
    const { holds } = extractStationHolds(body([platformHold]));
    const { planned } = planStationHolds({ holds, fleet, reference });
    expect(planned).toHaveLength(1);
    const item = planned[0];
    expect(item).toMatchObject({
      orderId: '261120-WT020219',
      vehicleCode: 'PMS02',
      kind: 'maintenance',
      maintenance: null,
      stationHold: true,
      departAt: reference + (2 * 3600 + 19 * 60 + 50) * 1000,
      arriveAt: reference + (2 * 3600 + 29 * 60 + 30) * 1000,
      origin: { id: 'n2w_d', name: 'NWD', kind: 'station' },
      destination: { id: 'n2w_d', name: 'NWD', kind: 'station' },
      stations: [],
    });
    const fields = dispatchOrderFields(item);
    expect(fields.line_kind).toBe('TRANSITION');
    expect(fields.maint_station).toBeUndefined();
    expect(fields.payload).toMatchObject({ kind: 'maintenance', task_type: 'idle', transition_purpose: 'hold', transition_label: '暫停 NWD' });
  });

  it('計畫版本摘要不算月台暫停卡：已採用的每日計畫版本不因開始發這種單而對不上', () => {
    const { holds } = extractStationHolds(body([platformHold]));
    const { planned: holdOrders } = planStationHolds({ holds, fleet, reference });
    const trip: PlannedDispatch = {
      kind: 'passenger',
      maintenance: null,
      orderId: '261120-TN0216',
      tripCode: 'TN0216',
      vehicleCode: 'PMS02',
      timelineRow: 2,
      taskType: 'passenger',
      cardLabel: '正線',
      routeCode: 'TN',
      routeName: 'TN',
      departAt: reference + 8180_000,
      arriveAt: reference + 8390_000,
      origin: { id: 't3_u', name: 'T3U', kind: 'station', arriveAt: null, departAt: reference + 8180_000 },
      destination: { id: 'n2w_d', name: 'NWD', kind: 'station', arriveAt: reference + 8390_000, departAt: null },
      stations: [],
    };
    expect(planDigestOf([trip, ...holdOrders])).toBe(planDigestOf([trip]));
  });
});

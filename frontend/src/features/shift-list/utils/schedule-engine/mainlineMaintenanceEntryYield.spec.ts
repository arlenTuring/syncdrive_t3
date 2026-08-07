import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyMainlineMaintenanceEntryYield,
  pushPassengerPastPrecedingYard,
} from '../mainlineMaintenanceEntryYield.ts';
import type { GeneratedScheduleBlock } from './types.ts';

function block(
  partial: Partial<GeneratedScheduleBlock> & {
    id: string;
    taskType: GeneratedScheduleBlock['taskType'];
    plannedStartMinute: number;
    plannedEndMinute: number;
  },
): GeneratedScheduleBlock {
  return {
    timelineRow: 1,
    label: partial.id,
    anchorStartMinute: partial.plannedStartMinute,
    travelSeconds: 0,
    dwellSeconds: 0,
    source: 'template_bar',
    ...partial,
  };
}

describe('applyMainlineMaintenanceEntryYield', () => {
  it('pushes charging start when ST ends after charging template start (EB0333 case)', () => {
    // ST 03:30:40–03:33:40；充電原 03:33:30–04:30 → 應推到 03:33:40，尾鎖 04:30
    const stStart = (3 * 3600 + 30 * 60 + 40) / 60;
    const stEnd = (3 * 3600 + 33 * 60 + 40) / 60;
    const chStart = (3 * 3600 + 33 * 60 + 30) / 60;
    const chEnd = (4 * 3600 + 30 * 60) / 60;

    const timelines = applyMainlineMaintenanceEntryYield([
      {
        row: 1,
        blocks: [
          block({
            id: 'st',
            taskType: 'passenger',
            plannedStartMinute: stStart,
            plannedEndMinute: stEnd,
            routeCode: 'ST',
          }),
          block({
            id: 'eb',
            taskType: 'charging',
            plannedStartMinute: chStart,
            plannedEndMinute: chEnd,
            label: '充電',
          }),
        ],
      },
    ]);

    const eb = timelines[0]!.blocks.find((item) => item.id === 'eb')!;
    assert.ok(eb);
    assert.ok(eb.plannedStartMinute >= stEnd - 1e-9);
    assert.equal(Math.round(eb.plannedStartMinute * 60), Math.round(stEnd * 60));
    assert.equal(Math.round(eb.plannedEndMinute * 60), Math.round(chEnd * 60));
  });

  it('does not compress 行前 when passenger starts mid-yard (steal tail)', () => {
    const inspectionStart = 9 * 60 + 30;
    const inspectionEnd = 10 * 60;
    const ntStart = 9 * 60 + 56 + 40 / 60;
    const ntEnd = 10 * 60 + 10 / 60;

    const timelines = applyMainlineMaintenanceEntryYield([
      {
        row: 1,
        blocks: [
          block({
            id: 'pre',
            taskType: 'inspection',
            plannedStartMinute: inspectionStart,
            plannedEndMinute: inspectionEnd,
            label: '行前',
          }),
          block({
            id: 'nt',
            taskType: 'passenger',
            plannedStartMinute: ntStart,
            plannedEndMinute: ntEnd,
            routeCode: 'NT',
          }),
        ],
      },
    ]);

    const pre = timelines[0]!.blocks.find((item) => item.id === 'pre')!;
    assert.ok(pre, '行前 must remain');
    assert.equal(Math.round(pre.plannedStartMinute * 60), inspectionStart * 60);
    assert.equal(Math.round(pre.plannedEndMinute * 60), inspectionEnd * 60);
  });

  it('does NOT yield servicing start for a regular passenger trip (P0 fix)', () => {
    // 保養 14:03–16:00；正線 TN 與保養同時刻起始 14:03–14:06:40
    // yield 不得壓縮保養開頭（只有 entry_service 才能 yield servicing）
    const servicingStart = 14 * 60 + 3;
    const servicingEnd = 16 * 60;
    const tnStart = 14 * 60 + 3;       // 與保養完全同時刻
    const tnEnd = 14 * 60 + 6 + 40 / 60;

    const timelines = applyMainlineMaintenanceEntryYield([
      {
        row: 1,
        blocks: [
          block({
            id: 'servicing',
            taskType: 'servicing',
            plannedStartMinute: servicingStart,
            plannedEndMinute: servicingEnd,
            label: '保養',
          }),
          block({
            id: 'tn',
            taskType: 'passenger',
            plannedStartMinute: tnStart,
            plannedEndMinute: tnEnd,
            routeCode: 'TN',
          }),
        ],
      },
    ]);

    const svc = timelines[0]!.blocks.find((item) => item.id === 'servicing')!;
    assert.ok(svc, '保養 must remain');
    // 保養開頭不應被 yield 壓縮；仍應保持原始 servicingStart
    assert.equal(
      Math.round(svc.plannedStartMinute * 60),
      servicingStart * 60,
      'servicing start must NOT be pushed by regular passenger yield',
    );
    assert.equal(Math.round(svc.plannedEndMinute * 60), servicingEnd * 60);
  });

  it('snaps charging start back to template when ghost passenger was pushed away (ED0548)', () => {
    // 模板充電 05:40–07:10；曾被 05:45–05:48:50 的班讓渡到 05:48:50，
    // 但該班已被推到整備後 11:20——充電必須縮回 05:40，不是掛著空的八分鐘。
    const templateChargeStart = 5 * 60 + 40;
    const chargeEnd = 7 * 60 + 10;
    const deferredChargeStart = 5 * 60 + 48 + 50 / 60;
    const tnEnd = 5 * 60 + 31 + 40 / 60;
    const ghostStart = 11 * 60 + 20 + 10 / 60;
    const ghostEnd = ghostStart + 3 + 30 / 60;

    const timelines = applyMainlineMaintenanceEntryYield([
      {
        row: 2,
        blocks: [
          block({
            id: 'tn0528',
            taskType: 'passenger',
            plannedStartMinute: 5 * 60 + 28,
            plannedEndMinute: tnEnd,
            routeCode: 'TN',
          }),
          block({
            id: 'ed0548',
            taskType: 'charging',
            plannedStartMinute: deferredChargeStart,
            plannedEndMinute: chargeEnd,
            anchorStartMinute: templateChargeStart,
            label: '充電',
          }),
          block({
            id: 'ghost-tnb',
            taskType: 'passenger',
            plannedStartMinute: ghostStart,
            plannedEndMinute: ghostEnd,
            routeCode: 'TNB',
            anchorStartMinute: 5 * 60 + 45 + 10 / 60,
          }),
        ],
      },
    ]);

    const charging = timelines[0]!.blocks.find((item) => item.id === 'ed0548')!;
    assert.ok(charging);
    assert.equal(
      Math.round(charging.plannedStartMinute * 60),
      templateChargeStart * 60,
      'charging must snap back to template start',
    );
    assert.equal(Math.round(charging.plannedEndMinute * 60), chargeEnd * 60);
  });
});

describe('pushPassengerPastPrecedingYard', () => {
  it('pushes passenger that steals 行前 tail to after 行前 end', () => {
    const inspectionStart = 9 * 60 + 30;
    const inspectionEnd = 10 * 60;
    const ntStart = 9 * 60 + 56 + 40 / 60;
    const ntEnd = 10 * 60 + 10 / 60;
    const occ = ntEnd - ntStart;

    const timelines = pushPassengerPastPrecedingYard([
      {
        row: 1,
        blocks: [
          block({
            id: 'pre',
            taskType: 'inspection',
            plannedStartMinute: inspectionStart,
            plannedEndMinute: inspectionEnd,
            label: '行前',
          }),
          block({
            id: 'nt',
            taskType: 'passenger',
            plannedStartMinute: ntStart,
            plannedEndMinute: ntEnd,
            routeCode: 'NT',
          }),
        ],
      },
    ]);

    const pre = timelines[0]!.blocks.find((item) => item.id === 'pre')!;
    const nt = timelines[0]!.blocks.find((item) => item.id === 'nt')!;
    assert.equal(Math.round(pre.plannedStartMinute * 60), inspectionStart * 60);
    assert.equal(Math.round(pre.plannedEndMinute * 60), inspectionEnd * 60);
    assert.ok(nt.plannedStartMinute >= inspectionEnd - 1e-9);
    assert.ok(
      Math.abs((nt.plannedEndMinute - nt.plannedStartMinute) - occ) < 1e-6,
    );
  });

  it('pushes passenger past servicing end when start times are identical (P0 fix)', () => {
    // 保養 14:03–16:00；正線 TN 與保養完全同時刻起始 → push 應把正線整趟推過 16:00
    const servicingStart = 14 * 60 + 3;
    const servicingEnd = 16 * 60;
    const tnStart = 14 * 60 + 3;
    const tnEnd = 14 * 60 + 6 + 40 / 60;
    const occ = tnEnd - tnStart;

    const timelines = pushPassengerPastPrecedingYard([
      {
        row: 1,
        blocks: [
          block({
            id: 'servicing',
            taskType: 'servicing',
            plannedStartMinute: servicingStart,
            plannedEndMinute: servicingEnd,
            label: '保養',
          }),
          block({
            id: 'tn',
            taskType: 'passenger',
            plannedStartMinute: tnStart,
            plannedEndMinute: tnEnd,
            routeCode: 'TN',
          }),
        ],
      },
    ]);

    const svc = timelines[0]!.blocks.find((item) => item.id === 'servicing')!;
    const tn = timelines[0]!.blocks.find((item) => item.id === 'tn')!;
    // 保養不動
    assert.equal(Math.round(svc.plannedStartMinute * 60), servicingStart * 60);
    assert.equal(Math.round(svc.plannedEndMinute * 60), servicingEnd * 60);
    // 正線必須被推過保養結束
    assert.ok(
      tn.plannedStartMinute >= servicingEnd - 1e-9,
      `passenger must start at or after servicing end (${servicingEnd}), got ${tn.plannedStartMinute}`,
    );
    assert.ok(
      Math.abs((tn.plannedEndMinute - tn.plannedStartMinute) - occ) < 1e-6,
      'occupancy must be preserved after push',
    );
  });

  it('removes midnight passenger that sits inside overnight servicing morning half', () => {
    // 跨夜保養拆兩段：21:00–24:00 + 00:00–06:00；正線被推到 24:00 起 → 撞清晨保養
    const eveningStart = 21 * 60;
    const eveningEnd = 24 * 60;
    const morningStart = 0;
    const morningEnd = 6 * 60;
    const tnStart = 24 * 60;
    const tnEnd = 24 * 60 + 3 + 40 / 60;

    const timelines = pushPassengerPastPrecedingYard([
      {
        row: 5,
        blocks: [
          block({
            id: 'svc-evening',
            taskType: 'servicing',
            plannedStartMinute: eveningStart,
            plannedEndMinute: eveningEnd,
            label: '保養',
          }),
          block({
            id: 'svc-morning',
            taskType: 'servicing',
            plannedStartMinute: morningStart,
            plannedEndMinute: morningEnd,
            label: '保養',
          }),
          block({
            id: 'tn',
            taskType: 'passenger',
            plannedStartMinute: tnStart,
            plannedEndMinute: tnEnd,
            routeCode: 'TN',
            routeName: 'T3上行 > N2W上行',
          }),
        ],
      },
    ]);

    const svcMorning = timelines[0]!.blocks.find((item) => item.id === 'svc-morning')!;
    const svcEvening = timelines[0]!.blocks.find((item) => item.id === 'svc-evening')!;
    const tn = timelines[0]!.blocks.find((item) => item.id === 'tn');
    assert.ok(svcMorning);
    assert.ok(svcEvening);
    assert.equal(svcMorning.plannedStartMinute, morningStart);
    assert.equal(svcMorning.plannedEndMinute, morningEnd);
    assert.equal(
      tn,
      undefined,
      '正線不得留在跨夜保養窗內（推過 06:00 後應刪除）',
    );
  });

  it('pushes passenger at 保養→行前 junction past the whole yard chain', () => {
    // 保養 02:00–09:30 + 行前 09:30–10:00；正線誤掛在 09:30 → 必須推過 10:00
    const servicingStart = 2 * 60;
    const servicingEnd = 9 * 60 + 30;
    const inspectionStart = 9 * 60 + 30;
    const inspectionEnd = 10 * 60;
    const tnStart = 9 * 60 + 30;
    const tnEnd = 9 * 60 + 33 + 40 / 60;
    const occ = tnEnd - tnStart;

    const timelines = pushPassengerPastPrecedingYard([
      {
        row: 1,
        blocks: [
          block({
            id: 'svc',
            taskType: 'servicing',
            plannedStartMinute: servicingStart,
            plannedEndMinute: servicingEnd,
            label: '保養',
          }),
          block({
            id: 'pre',
            taskType: 'inspection',
            plannedStartMinute: inspectionStart,
            plannedEndMinute: inspectionEnd,
            label: '行前',
          }),
          block({
            id: 'tn',
            taskType: 'passenger',
            plannedStartMinute: tnStart,
            plannedEndMinute: tnEnd,
            routeCode: 'TN',
            routeName: 'T3上行 > N2W上行',
          }),
        ],
      },
    ]);

    const pre = timelines[0]!.blocks.find((item) => item.id === 'pre')!;
    const tn = timelines[0]!.blocks.find((item) => item.id === 'tn')!;
    assert.equal(Math.round(pre.plannedStartMinute * 60), inspectionStart * 60);
    assert.equal(Math.round(pre.plannedEndMinute * 60), inspectionEnd * 60);
    assert.ok(
      tn.plannedStartMinute >= inspectionEnd - 1e-9,
      `passenger must start at or after 行前 end (${inspectionEnd}), got ${tn.plannedStartMinute}`,
    );
    assert.ok(
      Math.abs((tn.plannedEndMinute - tn.plannedStartMinute) - occ) < 1e-6,
    );
  });

  it('drops mid-yard ghost instead of relocating after long charging+servicing+inspection chain', () => {
    // 正線誤掛在充電中段 05:45；整備串到 11:20 → 刪掉，不要變成 11:20 幽靈班
    const chargeStart = 5 * 60 + 40;
    const chargeEnd = 7 * 60 + 10;
    const serviceEnd = 10 * 60 + 50;
    const inspectEnd = 11 * 60 + 20;
    const ghostStart = 5 * 60 + 45 + 10 / 60;
    const ghostEnd = 5 * 60 + 48 + 50 / 60;

    const timelines = pushPassengerPastPrecedingYard([
      {
        row: 4,
        blocks: [
          block({
            id: 'chg',
            taskType: 'charging',
            plannedStartMinute: chargeStart,
            plannedEndMinute: chargeEnd,
            label: '充電',
          }),
          block({
            id: 'svc',
            taskType: 'servicing',
            plannedStartMinute: chargeEnd,
            plannedEndMinute: serviceEnd,
            label: '保養',
          }),
          block({
            id: 'pre',
            taskType: 'inspection',
            plannedStartMinute: serviceEnd,
            plannedEndMinute: inspectEnd,
            label: '行前',
          }),
          block({
            id: 'ghost',
            taskType: 'passenger',
            plannedStartMinute: ghostStart,
            plannedEndMinute: ghostEnd,
            routeCode: 'TNB',
          }),
        ],
      },
    ]);

    assert.equal(
      timelines[0]!.blocks.find((item) => item.id === 'ghost'),
      undefined,
      'mid-yard ghost must be dropped, not relocated after yard',
    );
    assert.ok(timelines[0]!.blocks.find((item) => item.id === 'chg'));
  });
});

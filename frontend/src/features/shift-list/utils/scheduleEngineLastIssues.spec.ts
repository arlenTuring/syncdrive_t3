import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShiftScheduleCreateDraft } from '../types/create.ts';
import { emptyShiftScheduleCreateDraft } from '../types/create.ts';
import {
  buildScheduleEngineLastIssuesSnapshot,
  renderLastIssuesStandaloneHtml,
} from './scheduleEngineLastIssues.ts';

describe('scheduleEngineLastIssues', () => {
  it('lists each error/warning as its own item and layers hard before policy', () => {
    const draft = emptyShiftScheduleCreateDraft();
    draft.basic.name = '測試班表';
    draft.timeTemplate.templateName = '尖峰模板';

    const snapshot = buildScheduleEngineLastIssuesSnapshot({
      draft: draft as ShiftScheduleCreateDraft,
      shiftId: 'shift-1',
      updatedAt: '2026-08-06T00:00:00.000Z',
      result: {
        plan: null,
        report: {
          ok: false,
          errors: [
            {
              code: 'TIMELINE_OVERLAP',
              severity: 'error',
              message: '時間線 1 任務時間重疊',
              detail: { tripCode: 'MA1403' },
            },
            {
              code: 'TIMELINE_OVERLAP',
              severity: 'error',
              message: '時間線 2 任務時間重疊',
              detail: { tripCode: 'ME1503' },
            },
          ],
          warnings: [
            {
              code: 'STATION_BERTH_DELAYED',
              severity: 'warning',
              message: '延後 10 秒',
              detail: { tripCode: 'ST0007' },
            },
            {
              code: 'UNSERVED_SERVICE_PULSE',
              severity: 'warning',
              message: '班距需求 01:10 無可用車承接',
            },
          ],
        },
      },
    });

    assert.equal(snapshot.items.length, 4);
    assert.equal(snapshot.items[0]!.layer, 'hard');
    assert.equal(snapshot.items[0]!.tripCode, 'MA1403');
    assert.equal(snapshot.items[1]!.tripCode, 'ME1503');
    assert.equal(snapshot.items[2]!.layer, 'limit');
    assert.equal(snapshot.items[3]!.layer, 'policy');
    assert.equal(snapshot.acceptance.gatePassed, false);
    assert.equal(snapshot.acceptance.qualityPassed, false);
    assert.equal(snapshot.acceptance.policyNoiseCount, 1);
    assert.ok(snapshot.standaloneHtml.includes('驗收定義'));
    assert.ok(snapshot.standaloneHtml.includes('策略說明'));
    assert.ok(snapshot.standaloneHtml.includes('預設摺疊'));

    const html = renderLastIssuesStandaloneHtml(snapshot);
    assert.match(html, /硬錯誤（阻擋驗收）/);
    assert.match(html, /MA1403/);
    assert.match(html, /班距需求 01:10/);
  });
});

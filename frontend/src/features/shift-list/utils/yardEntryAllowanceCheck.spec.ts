import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkYardEntryAllowance } from './yardEntryAllowanceCheck';

/** 名稱、時刻都只是測試資料 */
const slack = (seconds: number) => ({ charging: seconds, carWash: seconds, maintenance: seconds, preTrip: seconds, mobile: seconds });
const inspection = (minutes: number) => ({ id: 'i1', rowIndex: 1, taskType: 'inspection', label: '行檢', startMinute: 540, durationMinutes: minutes });
const servicing = (minutes: number) => ({ id: 's1', rowIndex: 2, taskType: 'servicing', label: '保養', startMinute: 600, durationMinutes: minutes });

describe('正線可壓縮整備開頭的即時檢查（白皮書 YARD-02、YARD-04、YARD-06）', () => {
  it('H ≥ 整備長度：不合法（行檢 5 分、H 5 分）', () => {
    const rows = checkYardEntryAllowance({ templateTasks: [inspection(5)], slackSecondsBySection: slack(300), maintenanceBody: null, lockedRotationSeconds: null });
    assert.equal(rows[0]!.status, 'invalid');
    assert.match(rows[0]!.message, /吃光/);
  });

  it('H < 整備長度：合法；有設定作業時長時給模板建議 W＋H', () => {
    const rows = checkYardEntryAllowance({
      templateTasks: [inspection(25)],
      slackSecondsBySection: slack(300),
      maintenanceBody: { preTrip: { operationDurationMinutes: '25' } },
      lockedRotationSeconds: null,
    });
    assert.equal(rows[0]!.status, 'short');
    assert.equal(rows[0]!.suggestedSeconds, 25 * 60 + 300);
  });

  it('路線組合選好後：超過 1 小時的整備改用一輪額度重算', () => {
    const rows = checkYardEntryAllowance({
      templateTasks: [servicing(70), inspection(30)],
      slackSecondsBySection: slack(300),
      maintenanceBody: { maintenance: { cycleConditions: [{ durationMinutes: '30' }] } },
      lockedRotationSeconds: 18 * 60,
    });
    const long = rows.find((row) => row.taskId === 's1')!;
    const short = rows.find((row) => row.taskId === 'i1')!;
    assert.equal(long.allowanceKind, 'rotation');
    assert.equal(long.allowanceSeconds, 18 * 60);
    assert.equal(long.suggestedSeconds, 30 * 60 + 18 * 60);
    assert.equal(short.allowanceKind, 'manual', '不到 1 小時仍用手填額度');
  });

  it('一輪額度會吃到最低工作時間以下：標示實際最多讓多少', () => {
    const rows = checkYardEntryAllowance({
      templateTasks: [servicing(70)],
      slackSecondsBySection: slack(300),
      maintenanceBody: { maintenance: { cycleConditions: [{ durationMinutes: '30' }] } },
      lockedRotationSeconds: 60 * 60,
    });
    assert.equal(rows[0]!.status, 'clamped');
    assert.match(rows[0]!.message, /最多只會讓出 40 分/);
  });

  it('沒啟用的區段不檢查', () => {
    const rows = checkYardEntryAllowance({
      templateTasks: [inspection(5)], slackSecondsBySection: slack(300), sectionEnabled: { preTrip: false },
      maintenanceBody: null, lockedRotationSeconds: null,
    });
    assert.equal(rows.length, 0);
  });
});

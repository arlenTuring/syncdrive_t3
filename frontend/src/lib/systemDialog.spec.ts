import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  settleSystemDialog,
  subscribeSystemDialogs,
  systemAlert,
  systemConfirm,
  systemDialogSnapshot,
} from './systemDialog';

describe('系統樣式的確認／提示對話框', () => {
  it('畫面上沒有掛顯示端：確認當作取消、提示當作看過，不會卡住', async () => {
    assert.equal(await systemConfirm('刪除？'), false);
    await systemAlert('完成');
  });

  it('依序排隊；使用者按了哪個就回哪個', async () => {
    const unsubscribe = subscribeSystemDialogs(() => {});
    try {
      const first = systemConfirm('第一個', { tone: 'danger' });
      const second = systemAlert('第二個');
      const queue = systemDialogSnapshot();
      assert.deepEqual(queue.map((item) => [item.kind, item.message, item.tone]), [
        ['confirm', '第一個', 'danger'],
        ['alert', '第二個', 'default'],
      ]);
      settleSystemDialog(queue[0]!.id, true);
      assert.equal(await first, true);
      assert.equal(systemDialogSnapshot().length, 1);
      settleSystemDialog(systemDialogSnapshot()[0]!.id, true);
      await second;
      assert.equal(systemDialogSnapshot().length, 0);

      const third = systemConfirm('第三個');
      settleSystemDialog(systemDialogSnapshot()[0]!.id, false);
      assert.equal(await third, false);
    } finally {
      unsubscribe();
    }
  });
});

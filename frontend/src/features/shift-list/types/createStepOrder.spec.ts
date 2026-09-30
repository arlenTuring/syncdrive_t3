import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CREATE_SHIFT_SCHEDULE_STEPS,
  SHIFT_SCHEDULE_BODY_EDITOR_VERSION,
  buildShiftScheduleDraftFromStored,
} from './create';

describe('步驟順序：第 2 步時間模板、第 3 步整備任務（白皮書 YARD-01）', () => {
  it('步驟清單', () => {
    assert.deepEqual(CREATE_SHIFT_SCHEDULE_STEPS.slice(0, 3).map((item) => item.label), ['基本資料', '時間模板', '整備任務']);
    assert.equal(SHIFT_SCHEDULE_BODY_EDITOR_VERSION, 4);
  });

  const stored = (editorVersion: number, currentStep: number, maxReachedStep: number) =>
    buildShiftScheduleDraftFromStored('草稿', { editorVersion, currentStep, maxReachedStep });

  it('舊草稿（v3）停在整備任務：現在是第 3 步', () => {
    const draft = stored(3, 2, 2);
    assert.equal(draft.currentStep, 3);
    assert.equal(draft.maxReachedStep, 3);
  });

  it('舊草稿（v3）停在時間模板：現在是第 2 步，已走到的最遠步驟不變', () => {
    const draft = stored(3, 3, 3);
    assert.equal(draft.currentStep, 2);
    assert.equal(draft.maxReachedStep, 3);
  });

  it('第 4 步以後不受影響；新版草稿不再對調', () => {
    assert.equal(stored(3, 6, 7).currentStep, 6);
    assert.equal(stored(4, 2, 3).currentStep, 2);
    assert.equal(stored(4, 3, 3).currentStep, 3);
  });
});

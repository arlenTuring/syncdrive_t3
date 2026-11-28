import { describe, expect, it } from 'vitest';
import {
  buildMaintenanceTaskDraftFromStored,
  createMaintenanceTaskStepIncompleteReason,
  emptyMaintenanceTaskCreateDraft,
  isCreateMaintenanceTaskStepComplete,
  MAINTENANCE_EDITOR_VERSION,
  serializeMaintenanceTaskBody,
} from './create';

const filledStation = (follow?: boolean) => ({
  stepEnabled: true,
  equipmentRows: [{ id: 'r1', equipmentId: '093', mapCode: 'NW下發2', waypointCode: '' }],
  operationDurationMinutes: '',
  ...(follow === undefined ? {} : { durationFollowTemplate: follow }),
});

describe('maintenance task wizard steps', () => {
  it('current bodies are not shifted on reload (no more 7→6→5 drift)', () => {
    const draft = { ...emptyMaintenanceTaskCreateDraft(), currentStep: 8 as const, maxReachedStep: 8 as const };
    const body = serializeMaintenanceTaskBody(draft);
    expect(body.editorVersion).toBe(MAINTENANCE_EDITOR_VERSION);
    let reopened = buildMaintenanceTaskDraftFromStored('t', body);
    for (let i = 0; i < 3; i += 1) reopened = buildMaintenanceTaskDraftFromStored('t', serializeMaintenanceTaskBody(reopened));
    expect([reopened.currentStep, reopened.maxReachedStep]).toEqual([8, 8]);
    // editorVersion 1 without the legacy parking section is 7-step numbering: review (7) is now step 8
    expect(buildMaintenanceTaskDraftFromStored('t', { editorVersion: 1, currentStep: 7, maxReachedStep: 7 }).maxReachedStep).toBe(8);
  });

  it('7-step bodies (editorVersion 2) move the review step from 7 to 8; earlier steps stay', () => {
    const review = buildMaintenanceTaskDraftFromStored('t', { editorVersion: 2, currentStep: 7, maxReachedStep: 7 });
    expect([review.currentStep, review.maxReachedStep]).toEqual([8, 8]);
    const standby = buildMaintenanceTaskDraftFromStored('t', { editorVersion: 2, currentStep: 6, maxReachedStep: 6 });
    expect([standby.currentStep, standby.maxReachedStep]).toEqual([6, 6]);
  });

  it('only legacy 8-step bodies (with the old parking section) are renumbered', () => {
    const legacy = buildMaintenanceTaskDraftFromStored('t', { editorVersion: 1, currentStep: 8, maxReachedStep: 8, parking: {} });
    expect([legacy.currentStep, legacy.maxReachedStep]).toEqual([8, 8]);
    const legacyMid = buildMaintenanceTaskDraftFromStored('t', { editorVersion: 1, currentStep: 4, maxReachedStep: 7, parking: {} });
    expect([legacyMid.currentStep, legacyMid.maxReachedStep]).toEqual([4, 6]);
  });

  it('a completed task reopens with every step reachable; drafts are not marked completed', () => {
    const done = buildMaintenanceTaskDraftFromStored('t', {
      editorVersion: 2, currentStep: 3, maxReachedStep: 3, editorStatus: 'completed', editorCompletedAt: '2026-10-11T01:00:00.000Z',
    });
    expect(done.maxReachedStep).toBe(8);
    expect(done.editorCompletedAt).toBe('2026-10-11T01:00:00.000Z');
    const draft = buildMaintenanceTaskDraftFromStored('t', { editorVersion: 2, currentStep: 6, maxReachedStep: 6, editorStatus: 'editing' });
    expect([draft.maxReachedStep, draft.editorCompletedAt]).toEqual([6, null]);
    expect(buildMaintenanceTaskDraftFromStored('t', { editorStatus: 'completed' }).editorCompletedAt).toBeNull();
  });

  it('standby following the template does not require a duration; a manual duration is still required when not following', () => {
    const base = emptyMaintenanceTaskCreateDraft();
    expect(isCreateMaintenanceTaskStepComplete(6, { ...base, mobile: filledStation(true) })).toBe(true);
    expect(isCreateMaintenanceTaskStepComplete(6, { ...base, mobile: filledStation(false) })).toBe(false);
    expect(createMaintenanceTaskStepIncompleteReason(6, { ...base, mobile: filledStation(false) })).toContain('作業時長');
    expect(createMaintenanceTaskStepIncompleteReason(6, { ...base, mobile: { ...filledStation(true), equipmentRows: [] } })).toContain('設施');
    // 停用的選填項目不卡完成
    expect(isCreateMaintenanceTaskStepComplete(6, { ...base, mobile: { ...filledStation(false), stepEnabled: false } })).toBe(true);
    // 行檢沒有「跟模板」選項：作業時長必填
    expect(isCreateMaintenanceTaskStepComplete(5, { ...base, preTrip: filledStation(true) })).toBe(false);
  });

  it('maneuver is its own step 7: off for old tasks, same rules as standby, saved separately', () => {
    const old = buildMaintenanceTaskDraftFromStored('t', { editorVersion: 2, mobile: filledStation(true) });
    expect(old.maneuver.stepEnabled).toBe(false);
    expect(isCreateMaintenanceTaskStepComplete(7, old)).toBe(true);
    const base = emptyMaintenanceTaskCreateDraft();
    expect(isCreateMaintenanceTaskStepComplete(7, { ...base, maneuver: filledStation(true) })).toBe(true);
    // 機動沒有作業時長可填：時長一律照時間模板
    expect(isCreateMaintenanceTaskStepComplete(7, { ...base, maneuver: filledStation(false) })).toBe(true);
    expect(createMaintenanceTaskStepIncompleteReason(7, { ...base, maneuver: { ...filledStation(true), equipmentRows: [] } })).toContain('設施');
    const body = serializeMaintenanceTaskBody({ ...base, maneuver: filledStation(true) });
    expect(body.maneuver).toMatchObject({ stepEnabled: true, durationFollowTemplate: true, equipmentRows: [{ equipmentId: '093' }] });
    expect(buildMaintenanceTaskDraftFromStored('t', body).maneuver.equipmentRows[0]).toMatchObject({ equipmentId: '093' });
  });

  it('a facility missing from the map blocks the step with a reason', () => {
    const base = emptyMaintenanceTaskCreateDraft();
    const mobile = { ...filledStation(true), equipmentRows: [{ id: 'r', equipmentId: '999', mapCode: 'X', waypointCode: '', unresolved: true }] };
    expect(createMaintenanceTaskStepIncompleteReason(6, { ...base, mobile })).toContain('找不到');
  });

  it('saves the facility id and the follow-template choice, and reads them back', () => {
    const draft = { ...emptyMaintenanceTaskCreateDraft(), mobile: filledStation(false) };
    draft.mobile.operationDurationMinutes = '20';
    const body = serializeMaintenanceTaskBody(draft);
    expect((body.mobile as { equipmentRows: unknown[]; durationFollowTemplate: boolean })).toMatchObject({
      durationFollowTemplate: false,
      equipmentRows: [{ id: 'r1', equipmentId: '093', mapCode: 'NW下發2' }],
    });
    const back = buildMaintenanceTaskDraftFromStored('t', body);
    expect(back.mobile.durationFollowTemplate).toBe(false);
    expect(back.mobile.equipmentRows[0]).toMatchObject({ equipmentId: '093', mapCode: 'NW下發2' });
  });
});

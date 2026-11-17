import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DashboardPlane } from '../types';
import { bindOperationStatusBadges, LEGACY_OPERATION_STATUS_PLACEHOLDER, OPERATION_STATUS_URL } from './operationStatusBadge';

const plane = (children: unknown[]): DashboardPlane => ({ id: 'p', name: 'p', elements: [{ id: 'e', children }] } as unknown as DashboardPlane);

describe('營運狀態標籤', () => {
  it('範本留下、沒接資料的那一個補上綁定；再跑一次不變', () => {
    const before = plane([{ id: 'b', type: 'status-badge', defaultLabel: LEGACY_OPERATION_STATUS_PLACEHOLDER, valueField: '', rules: [] }]);
    const first = bindOperationStatusBadges(before);
    assert.deepEqual(first.bound, ['b']);
    const badge = (first.plane.elements[0]!.children as Array<Record<string, unknown>>)[0]!;
    assert.equal(badge.dataUrl, OPERATION_STATUS_URL);
    assert.equal(badge.valueField, 'status_code');
    assert.equal(badge.refreshMode, 'event');
    assert.deepEqual(badge.invalidateTags, ['domain:operation_status']);
    assert.deepEqual((badge.rules as Array<{ value: string }>).map((rule) => rule.value), ['normal', 'dispatch_paused', 'no_schedule', 'degraded', 'unknown']);
    assert.deepEqual(bindOperationStatusBadges(first.plane).bound, []);
  });

  it('使用者自己綁過資料、或改過文字的不動', () => {
    const custom = plane([
      { id: 'a', type: 'status-badge', defaultLabel: LEGACY_OPERATION_STATUS_PLACEHOLDER, dataUrl: '/x', valueField: 'v', rules: [] },
      { id: 'b', type: 'status-badge', defaultLabel: '我的標籤', valueField: '', rules: [] },
    ]);
    const result = bindOperationStatusBadges(custom);
    assert.deepEqual(result.bound, []);
    assert.equal(result.plane, custom);
  });
});

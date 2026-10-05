import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CanvasElementProps, DashboardPlane } from '../types';
import { EVENT_CENTER_LIST_SQL } from '../constants/demoSql';
import { migratePlane, switchEventCarouselKey } from './migrateDashboardPlane';

/** 2026-10-05 之前的系統版事件中心清單（沒有 event_key） */
const OLD_EVENT_CENTER_LIST_SQL = EVENT_CENTER_LIST_SQL
  .replace(/\n  -- event_key：[^\n]*\n  -- [^\n]*\n  id::text AS event_key,/, '');

function plane(sqlQuery: string, slotKeyField = 'event_id'): DashboardPlane {
  return {
    id: 'p', name: 'p',
    elements: [{ id: 'e1', type: 'canvas', label: '事件輪播', isGroup: true, slotKeyField, sqlQuery, children: [] } as unknown as CanvasElementProps],
  } as unknown as DashboardPlane;
}

describe('事件輪播改用 event_key', () => {
  it('舊版測試資料確實是沒有 event_key 的版本', () => {
    assert.doesNotMatch(OLD_EVENT_CENTER_LIST_SQL, /event_key/);
    assert.match(EVENT_CENTER_LIST_SQL, /id::text AS event_key/);
  });

  it('目前系統版 SQL＋key 還是 event_id：改成 event_key', () => {
    const next = switchEventCarouselKey(plane(EVENT_CENTER_LIST_SQL));
    assert.equal(next.elements[0].slotKeyField, 'event_key');
  });

  it('使用者自訂的查詢（沒有 event_key）：不動', () => {
    const custom = plane('SELECT event_id, detail FROM security_event_logs');
    assert.equal(switchEventCarouselKey(custom), custom);
  });

  it('已儲存的舊版系統 SQL：載入時升級成新版，key 一併換成 event_key', () => {
    const migrated = migratePlane(plane(OLD_EVENT_CENTER_LIST_SQL));
    assert.equal(migrated.elements[0].sqlQuery, EVENT_CENTER_LIST_SQL);
    assert.equal(migrated.elements[0].slotKeyField, 'event_key');
  });
});

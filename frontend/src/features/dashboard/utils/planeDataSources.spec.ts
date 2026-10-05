import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DashboardPlane } from '../types';
import { resolvePlaneSourceId } from '../context/PlaneDataSourceContext';
import { withSourceSelection, collectPlaneSourceRefs } from './planeDataSources';
import { applySourceRemap, clonePlaneWithNewIds } from '../template/importTemplate';
import { stripUrlCredentials } from '../template/exportTemplate';
import { resolvePlaneRestUrl } from '../elements/useWidgetData';

const plane = (id: string, sourceMap?: Record<string, string>): DashboardPlane => ({
  id, name: id, width: 100, height: 100, createdAt: 0, updatedAt: 0,
  elements: [{ id: 'e', type: 'canvas', dataSourceId: 'default-internal', sqlQuery: 'SELECT 1', children: [] } as never],
  ...(sourceMap ? { dataSettings: { sourceMap } } : {}),
});

describe('每張儀表板自己的資料設定', () => {
  it('沒設定就照元件原本的來源；有對應就用對應的', () => {
    assert.equal(resolvePlaneSourceId(undefined, 'default-internal'), 'default-internal');
    assert.equal(resolvePlaneSourceId({ sourceMap: { 'default-internal': 'sql-b' } }, 'default-internal'), 'sql-b');
    assert.equal(resolvePlaneSourceId({ sourceMap: { 'default-internal': 'sql-b' } }, 'default-mqtt'), 'default-mqtt');
  });

  it('改 A 的選擇是新的物件，不會改到 B', () => {
    const a = plane('A');
    const b = plane('B', { 'default-internal': 'sql-b' });
    const next = withSourceSelection(a.dataSettings, 'default-internal', 'sql-a');
    assert.deepEqual(next, { sourceMap: { 'default-internal': 'sql-a' } });
    assert.deepEqual(b.dataSettings, { sourceMap: { 'default-internal': 'sql-b' } });
    assert.deepEqual(withSourceSelection(next, 'default-internal', 'default-internal'), { sourceMap: {} }, '選回原本的就拿掉對應');
  });

  it('列出的來源包含站內 REST 與車隊 MQTT hub', () => {
    const refs = collectPlaneSourceRefs(plane('A'));
    assert.ok(refs.sql.includes('default-internal'));
    assert.ok(refs.mqtt.includes('default-mqtt'));
  });

  it('複製儀表板帶上資料設定；匯入另建的專用連線只套在新儀表板', () => {
    const src = plane('A', { 'default-internal': 'sql-b' });
    const copy = clonePlaneWithNewIds(src, 'A 複本');
    assert.notEqual(copy.id, src.id);
    assert.deepEqual(copy.dataSettings, { sourceMap: { 'default-internal': 'sql-b' } });
    copy.dataSettings!.sourceMap!['default-internal'] = 'sql-c';
    assert.equal(src.dataSettings!.sourceMap!['default-internal'], 'sql-b', '複本各改各的');
    const remapped = applySourceRemap(copy, { 'sql-c': 'sql-c-import-1', 'default-mqtt': 'mqtt-import-1' });
    assert.deepEqual(remapped.dataSettings!.sourceMap, { 'default-internal': 'sql-c-import-1', 'default-mqtt': 'mqtt-import-1' });
  });

  it('匯出不帶網址裡的帳密', () => {
    assert.equal(stripUrlCredentials('http://user:secret@10.0.0.5:3000'), 'http://10.0.0.5:3000');
    assert.equal(stripUrlCredentials(''), '');
    assert.equal(stripUrlCredentials('http://10.0.0.5:3000'), 'http://10.0.0.5:3000');
  });

  it('站內 REST 跟著這張選的 SQL 連線打到同一台後端', () => {
    assert.equal(resolvePlaneRestUrl('/syncdrive-api/x', ''), '/syncdrive-api/x');
    assert.equal(resolvePlaneRestUrl('/syncdrive-api/x', 'http://10.0.0.5:3000/'), 'http://10.0.0.5:3000/syncdrive-api/x');
    assert.equal(resolvePlaneRestUrl('https://other/api', 'http://10.0.0.5:3000'), 'https://other/api');
  });
});

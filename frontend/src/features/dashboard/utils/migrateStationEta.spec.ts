import { describe, expect, it } from 'vitest';
import { createWidget, type ChildWidget, type TabListWidget, type TextWidget } from '../types';
import { migrateStationEtaChildren, STATION_ETA_LAYOUT } from './migrateDashboardPlane';

const URL_N2W = '/syncdrive-api/operation-metrics/station-eta?arrive=n2w_d_end,n2w_u_end&depart=n2w_d_start,n2w_u_start&limit=2';

/** 圖台上實際的舊配置：直排站名文字＋表格（形狀取自正式圖台 vq53epo） */
function legacyPair(id: string, url: string, x: number, y: number): ChildWidget[] {
  const label: TextWidget = {
    ...(createWidget('text', x, y) as TextWidget), id: `${id}-station-label`, width: 38, height: 95, content: 'N\n2\nW',
  };
  const list: TabListWidget = {
    ...(createWidget('tab-list', x + 38, y) as TabListWidget), id, label: 'N2W', width: 418, height: 95,
    tabs: [{
      id: 'events', label: 'N2W', dataUrl: url, dataRowPath: 'events', rowKeyField: 'row_key', refreshMode: 'event',
      invalidateTags: ['table:operation_orders', 'domain:operating_clock'],
      columns: [{ id: `${id}-at`, name: '剩餘時間', fieldKey: 'at', width: 61, format: 'countdown', children: [] }],
    }],
  };
  return [label, list];
}

describe('站點到站：舊表格改回到站動態卡片', () => {
  it('已確認的表格與站名合成一張直式卡：ID、站點、到站／出發、筆數、重查設定保留，位置尺寸用量好的空白區', () => {
    const other = { ...createWidget('clock', 0, 0), id: 'clock-1' } as ChildWidget;
    const out = migrateStationEtaChildren([other, ...legacyPair('eta-n2w', URL_N2W, 2581, 256)]);
    expect(out.map(w => w.id)).toEqual(['clock-1', 'eta-n2w']);
    const card = out[1];
    expect(card.type).toBe('station-eta');
    if (card.type !== 'station-eta') return;
    expect({ x: card.x, y: card.y, width: card.width, height: card.height }).toEqual(STATION_ETA_LAYOUT['eta-n2w']);
    expect(card.title).toBe('N2W 進站動態');
    expect(card.borderRadius).toBe(20);
    expect(card.limit).toBe(2);
    expect(card.dataUrl).toBe('/syncdrive-api/operation-metrics/station-eta');
    expect(card.stations).toEqual([
      { stationId: 'n2w_d_end', label: 'n2w_d_end', events: ['arrive'] },
      { stationId: 'n2w_u_end', label: 'n2w_u_end', events: ['arrive'] },
      { stationId: 'n2w_d_start', label: 'n2w_d_start', events: ['depart'] },
      { stationId: 'n2w_u_start', label: 'n2w_u_start', events: ['depart'] },
    ]);
    expect(card.invalidateTags).toEqual(['table:operation_orders', 'domain:operating_clock']);
    expect(out[0]).toBe(other);
  });

  it('同一站到站與出發都要：一個停靠點兩種都列；有出發標題也是進站動態，出發設定不刪', () => {
    const both = migrateStationEtaChildren(legacyPair('eta-t3', '/syncdrive-api/operation-metrics/station-eta?arrive=t3_u,t3_d&depart=t3_u,t3_d&limit=2', 369, 235))[0];
    expect(both.type === 'station-eta' && both.stations).toEqual([
      { stationId: 't3_u', label: 't3_u', events: ['arrive', 'depart'] },
      { stationId: 't3_d', label: 't3_d', events: ['arrive', 'depart'] },
    ]);
    expect(both.type === 'station-eta' && both.title).toBe('N2W 進站動態');
    const arriveOnly = migrateStationEtaChildren(legacyPair('eta-s2w', '/syncdrive-api/operation-metrics/station-eta?arrive=s2w_d_end&limit=3', 0, 0))[0];
    expect(arriveOnly.type === 'station-eta' && arriveOnly.title).toBe('N2W 進站動態');
  });

  it('冪等：第二次不變；已經是卡片的不動', () => {
    const once = migrateStationEtaChildren(legacyPair('eta-n2w', URL_N2W, 10, 20));
    expect(migrateStationEtaChildren(once)).toBe(once);
    const card = { ...createWidget('station-eta', 5, 5), id: 'eta-x' } as ChildWidget;
    const kept = [card];
    expect(migrateStationEtaChildren(kept)).toBe(kept);
  });

  it('不是那三張、或資料來源不是 station-eta 的表格不轉', () => {
    const [label, list] = legacyPair('eta-n2w', URL_N2W, 0, 0) as [TextWidget, TabListWidget];
    const renamed = [{ ...label, id: 'my-list-station-label' }, { ...list, id: 'my-list' }];
    expect(migrateStationEtaChildren(renamed)).toBe(renamed);
    const otherSource = [label, { ...list, tabs: list.tabs.map(t => ({ ...t, dataUrl: '/syncdrive-api/other' })) }];
    expect(migrateStationEtaChildren(otherSource)).toBe(otherSource);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CanvasElementProps, ChildWidget, DashboardPlane } from '../types';
import { cloneDemoPlane } from '../constants/demoPlane';
import { migratePlane } from './migrateDashboardPlane';
import { dataSourceSelectionPatch, describeWidgetDataLineage } from './widgetDataLineage';
import { enrichMainlineShiftFields } from './mainlineTaskModel';
import { enrichMaintenanceShiftFields } from './maintenanceTaskModel';
import { resolveWidgetEditPreview, resolveNumericEditPreview } from './widgetEditPreview';
import { buildGroupPreviewVariables } from './groupTemplateContext';
import { resolveVehicleMonitorBadge } from './resolveVehicleMonitorBadge';
import { withRowSourceMetadata } from './rowRules';

const text = (content: string, extra: Record<string, unknown> = {}) =>
  ({ id: `t-${content}`, type: 'text', x: 0, y: 0, width: 10, height: 10, content, ...extra }) as unknown as ChildWidget;

const mainlineGroup = {
  id: 'g', type: 'canvas', label: '正線 / 整備班次', isGroup: true, children: [],
  genericGroup: {
    enabled: true,
    sources: [
      { id: 's1', label: '正線', dataSourceId: 'default-internal', sqlQuery: 'SELECT 1', postProcessId: 'mainline-mqtt-merge' },
      { id: 's2', label: '整備', dataSourceId: 'default-internal', sqlQuery: 'SELECT 2' },
    ],
  },
} as unknown as CanvasElementProps;

describe('元件資料來源：面板說的就是實際跑的', () => {
  it('讀取繼承群組來源不會把設定複製進子元件', () => {
    const child = text('{eta_remain}');
    const before = JSON.stringify(child);

    const lineage = describeWidgetDataLineage(child, mainlineGroup);

    assert.equal(lineage.status, 'group-row');
    assert.equal(JSON.stringify(child), before);
    assert.equal((child as unknown as Record<string, unknown>).dataSourceId, undefined);
    assert.equal((child as unknown as Record<string, unknown>).mqttDataSourceId, undefined);
  });

  it('切換或修改某一類來源不會清掉其他有效綁定', () => {
    const binding = {
      dataSourceId: 'sql-a',
      sqlQuery: 'SELECT battery_level FROM vehicle',
      mqttDataSourceId: 'mqtt-a',
      mqttTopic: 'v1/vehicle/update',
      mqttValuePath: 'battery_level',
      dataUrl: '/syncdrive-api/vehicle',
    };

    const next = { ...binding, ...dataSourceSelectionPatch('mqtt', 'mqtt-b') };

    assert.equal(next.mqttDataSourceId, 'mqtt-b');
    assert.equal(next.dataSourceId, binding.dataSourceId);
    assert.equal(next.sqlQuery, binding.sqlQuery);
    assert.equal(next.dataUrl, binding.dataUrl);
  });

  it('沒有真實預覽列時只列可能來源，不宣稱 MQTT 覆寫已生效', () => {
    const lineage = describeWidgetDataLineage(text('{eta_remain}'), mainlineGroup);
    assert.equal(lineage.status, 'group-row');
    assert.deepEqual(lineage.group?.sources.map((source) => [source.kind, source.target, source.postProcessId]), [
      ['sql', 'SELECT 1', 'mainline-mqtt-merge'],
      ['sql', 'SELECT 2', undefined],
    ]);
    assert.equal(lineage.fields[0].name, 'eta_remain');
    assert.equal(lineage.fields[0].derivedFrom, undefined);
  });

  it('同群組的正線與整備 eta_remain 依實際預覽列來源分開說明', () => {
    const mainlineRow = withRowSourceMetadata({ eta_remain: '00:10' }, {
      sourceId: 's1', sourceLabel: '正線', postProcessId: 'mainline-mqtt-merge',
    });
    const maintenanceRow = withRowSourceMetadata({ eta_remain: '00:20' }, {
      sourceId: 's2', sourceLabel: '整備',
    });
    const mainline = describeWidgetDataLineage(text('{eta_remain}'), mainlineGroup, mainlineRow);
    const maintenance = describeWidgetDataLineage(text('{eta_remain}'), mainlineGroup, maintenanceRow);

    assert.deepEqual(mainline.group?.sources.map((source) => source.target), ['SELECT 1']);
    assert.match(mainline.fields[0].derivedFrom ?? '', /current_leg\.eta_seconds/);
    assert.deepEqual(maintenance.group?.sources.map((source) => source.target), ['SELECT 2']);
    assert.equal(maintenance.fields[0].derivedFrom, undefined);
  });

  it('沒有資料來源又帶數字的字是寫死的值；面板標成警告', () => {
    const lineage = describeWidgetDataLineage(text('班距 03:00'), null);
    assert.equal(lineage.status, 'static');
    assert.equal(lineage.staticText, '班距 03:00');
  });

  it('標題文字（沒數字）不需要資料來源', () => {
    assert.equal(describeWidgetDataLineage(text('事件中心'), null).status, 'label');
  });

  it('寫了 SQL 沒選資料來源要說出來', () => {
    const lineage = describeWidgetDataLineage(text('', { sqlQuery: 'SELECT 1 AS a', valueField: 'a' }), null);
    assert.equal(lineage.status, 'own');
    assert.deepEqual(lineage.problems, ['寫了 SQL 但沒有選資料來源']);
  });

  it('群組沒有任何資料來源時，樣板裡的 {欄位} 不會有值，要說出來', () => {
    const empty = { ...mainlineGroup, genericGroup: { enabled: true, sources: [] } } as unknown as CanvasElementProps;
    const lineage = describeWidgetDataLineage(text('{trip_code}'), empty);
    assert.match(lineage.problems.join(), /沒有設定資料來源/);
  });
});

describe('內建總控大屏：載入後每個顯示資料的元件都有來源', () => {
  it('只剩「營運模式」徽章沒有資料來源（系統裡還沒有這份資料，待決定），其他都接上了', () => {
    const plane = migratePlane(cloneDemoPlane() as DashboardPlane);
    const unbound: string[] = [];
    for (const element of plane.elements) {
      for (const child of element.children ?? []) {
        const lineage = describeWidgetDataLineage(child, element.isGroup ? element : null);
        if (lineage.status === 'static' || lineage.problems.length > 0) {
          unbound.push(`${element.label}:${child.type}:${lineage.staticText ?? ''}`);
        }
      }
    }
    assert.deepEqual(unbound, ['即時圖台:status-badge:尚未設定（營運狀態來源）']);
  });

  it('「班距」接營運指標的目前時段班距，「正線營運」接訂單查詢，不再是寫死的字', () => {
    const plane = migratePlane(cloneDemoPlane() as DashboardPlane);
    const map = plane.elements.find((element) => element.label === '即時圖台')!;
    const headway = map.children.find((child) => (child as { content?: string }).content?.startsWith('班距')) as unknown as Record<string, unknown>;
    assert.equal(headway.dataUrl, '/syncdrive-api/operation-metrics/capacity-summary');
    assert.equal(headway.valueField, 'headway_line');
    const fleet = map.children.find((child) => (child as { content?: string }).content?.includes('正線營運')) as unknown as Record<string, unknown>;
    assert.match(String(fleet.sqlQuery), /mainline_fleet_line/);
  });
});

describe('前端不再自己生資料', () => {
  it('正線列：SQL 沒給的站名、方向、發車時間就留空，不從班次代號推', () => {
    const row = enrichMainlineShiftFields({ trip_code: 'D1133', vehicle_code: 'PMS01', order_status: 'PENDING' });
    assert.equal(row.st_a, undefined);
    assert.equal(row.direction_label, undefined);
    assert.equal(row.depart_time, undefined);
    assert.equal(row.route_stations, undefined);
    assert.equal(row.next_station, undefined);
  });

  it('正線列：狀態不明時不替它判「準時」', () => {
    const row = enrichMainlineShiftFields({ trip_code: 'NT1337' });
    assert.equal(row.status_label, undefined);
  });

  it('正線列：下一站只用這一列 SQL 站序對照；對不到就保留 SQL 值', () => {
    const base = {
      trip_code: 'NT1337', next_station: 'SQL站', order_status: 'PROCESSING',
      route_stations: JSON.stringify([{ station_id: 'a', name: '甲' }, { station_id: 'b', name: '乙' }]),
    };
    assert.equal(enrichMainlineShiftFields(base, { current_leg: { target_station_id: 'b' } }).next_station, '乙');
    assert.equal(enrichMainlineShiftFields(base, { current_leg: { target_station_id: 'station_2' } }).next_station, 'SQL站');
  });

  it('整備列：不補 S2W 起站、00:30:00、現在時間', () => {
    const row = enrichMaintenanceShiftFields({ vehicle_code: 'PMS02', next_station: 'E1' });
    assert.equal(row.st_a, undefined);
    assert.equal(row.eta_remain, undefined);
    assert.equal(row.depart_time, undefined);
    assert.equal(row.end_time, undefined);
    assert.equal(row.maint_type_label, undefined);
  });

  it('車輛徽章：沒有訂單也沒有任務標籤時不看格位字母猜任務', () => {
    const badge = resolveVehicleMonitorBadge({ segment_label: 'E1', yard_slot_id: 'E1' }, {});
    assert.equal(badge.label, '');
  });

  it('編輯模式沒資料：顯示 {欄位名}、數值停在最小值，不放示範值', () => {
    assert.equal(resolveWidgetEditPreview({ valueField: 'trip_code' }), '{trip_code}');
    assert.equal(resolveWidgetEditPreview({ valueField: 'eta_remain', content: '{eta_remain}' }), '{eta_remain}');
    assert.equal(resolveNumericEditPreview({ valueField: 'battery_level', min: 0, max: 100 }), 0);
  });

  it('子畫布預覽變數：只放真實列；沒有列就沒有欄位', () => {
    const group = { variableName: 'row', iteratorField: 'shift_key' } as unknown as CanvasElementProps;
    assert.deepEqual(buildGroupPreviewVariables(group, null, 0), {});
    assert.deepEqual(
      buildGroupPreviewVariables(group, { shift_key: 'K1', eta_remain: '02:10' }, 0),
      { shift_key: 'K1', eta_remain: '02:10', row: 'K1' },
    );
  });
});

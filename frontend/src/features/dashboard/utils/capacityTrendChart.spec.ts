import { describe, expect, it } from 'vitest';
import type { DashboardPlane, LineChartWidget } from '../types';
import { upgradeCapacityTrendChart, upgradeCapacityTrendCharts } from './capacityTrendChart';

const legacy = {
  id: '3yea3d2',
  type: 'line-chart',
  x: 12, y: 78, width: 647, height: 188,
  dataUrl: '/syncdrive-api/operation-metrics/capacity-trend',
  xField: 'time',
  yFields: ['forecast_util', 'actual_util'],
  series: [
    { id: 'capacity-forecast', yField: 'forecast_util', color: '#99A1AF' },
    { id: 'capacity-actual', yField: 'actual_util', color: '#51A2FF', areaFill: true, eventLabelsEnabled: true },
  ],
  axisBands: [{ axis: 'x', startField: 'time', segmentField: 'segment_code', colorRules: [{ value: 'IN_SERVICE', color: '#FD9A00' }], thickness: 2 }],
  refreshInterval: 0,
} as unknown as LineChartWidget;

describe('capacity trend chart upgrade', () => {
  it('switches to dated timestamps, template band colours, hides sample dots, keeps layout', () => {
    const next = upgradeCapacityTrendChart(legacy);
    expect(next).toMatchObject({ id: '3yea3d2', x: 12, y: 78, width: 647, height: 188, xField: 'ts', dataIssueField: 'data_issue', refreshInterval: 30 });
    expect(next.series!.every((s) => s.showPoints === false)).toBe(true);
    expect(next.series![1]).toMatchObject({ color: '#51A2FF', areaFill: true, eventLabelsEnabled: true, nowEndpoint: true });
    expect(next.series![0].nowEndpoint).toBeUndefined();
    expect(next.axisBands![0]).toMatchObject({ startField: 'ts', segmentField: 'segment_id', colorField: 'segment_color', colorRules: [], thickness: 2 });
  });

  it('is idempotent and leaves other charts alone', () => {
    const once = upgradeCapacityTrendChart(legacy);
    expect(upgradeCapacityTrendChart(once)).toBe(once);
    const other = { ...legacy, id: 'other', dataUrl: '/syncdrive-api/other' } as LineChartWidget;
    const plane = { id: 'p', name: 'p', elements: [{ id: 'card', type: 'canvas', children: [legacy, other] }] } as unknown as DashboardPlane;
    const { plane: next, upgraded } = upgradeCapacityTrendCharts(plane);
    expect(upgraded).toEqual(['3yea3d2']);
    expect(next.elements[0].children[1]).toBe(other);
    expect(upgradeCapacityTrendCharts(next).upgraded).toEqual([]);
  });
});

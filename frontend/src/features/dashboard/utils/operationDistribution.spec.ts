import { describe, expect, it } from 'vitest';
import type { CanvasElementProps, DashboardPlane } from '../types';
import { renameOperationDistributions } from './operationDistribution';

const distribution = {
  id: 'ctd87mt', type: 'canvas', label: '車輛分佈', x: 32, y: 752, width: 680, height: 91,
  children: [{ id: 'extoq49', type: 'segment-bar', title: '車輛分佈', dataUrl: '/syncdrive-api/facility/vehicle-distribution', x: 1, y: 2 }],
} as unknown as CanvasElementProps;
const vehicleCards = { id: 'la2s16b', type: 'canvas', label: '車輛狀態', isGroup: true, children: [] } as unknown as CanvasElementProps;
const otherWithSameWords = { id: 'x', type: 'canvas', label: '車輛分佈', children: [{ id: 't', type: 'text', content: '車輛分佈' }] } as unknown as CanvasElementProps;

describe('營運分佈改名', () => {
  it('只改綁定車輛分佈 API 的那個元件的名稱，位置與綁定不動；可重複執行', () => {
    const plane = { id: 'p', name: 'p', elements: [distribution, vehicleCards, otherWithSameWords] } as DashboardPlane;
    const { plane: next, upgraded } = renameOperationDistributions(plane);
    expect(upgraded).toEqual(['ctd87mt']);
    expect(next.elements[0]).toMatchObject({ label: '營運分佈', x: 32, y: 752, width: 680, height: 91 });
    expect(next.elements[0].children[0]).toMatchObject({ title: '營運分佈', dataUrl: '/syncdrive-api/facility/vehicle-distribution', x: 1 });
    expect(next.elements[1]).toBe(vehicleCards);
    expect(next.elements[2]).toBe(otherWithSameWords);
    expect(renameOperationDistributions(next).upgraded).toEqual([]);
  });

  it('使用者自訂過的名稱不覆蓋', () => {
    const custom = { ...distribution, label: '我的分佈', children: [{ ...distribution.children[0], title: '我的分佈' }] } as CanvasElementProps;
    expect(renameOperationDistributions({ id: 'p', name: 'p', elements: [custom] } as DashboardPlane).upgraded).toEqual([]);
  });
});

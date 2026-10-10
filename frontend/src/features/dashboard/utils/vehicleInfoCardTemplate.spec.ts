import { describe, expect, it } from 'vitest';
import demoSnapshot from '../constants/demoPlane.snapshot.json';
import type { CanvasElementProps, DashboardPlane, GaugeWidget, ObstacleRingWidget } from '../types';
import { isLegacyVehicleCardTemplate, upgradeVehicleCardGroup, upgradeVehicleCardTemplate } from './vehicleInfoCardTemplate';

const legacyGroup: CanvasElementProps = {
  id: 'grp',
  type: 'canvas',
  x: 32,
  y: 856,
  width: 3776,
  height: 192,
  label: '車輛狀態',
  isGroup: true,
  backgroundColor: '#09090b',
  backgroundImage: '',
  opacity: 100,
  iteratorField: 'vehicle_code',
  sqlQuery: 'SELECT ... ORDER BY v.vehicle_code',
  templateWidth: 330,
  templateHeight: 192,
  children: [
    { id: 'card', type: 'color-block', x: 0, y: 0, width: 330, height: 192 },
    { id: 'name', type: 'text', x: 13, y: 13, width: 206, height: 24, content: '{vehicle_code}' },
    { id: 'badge', type: 'status-badge', x: 203, y: 13, width: 124, height: 24, valueField: '{badge_label}', mqttTopic: 'v1/vtms/${vehicle_code}/operation/update' },
    { id: 'speed', type: 'gauge', x: 13, y: 45, width: 149, height: 82, gaugeVariant: 'semi-arc', min: 0, max: 40, unit: 'km/h', mqttTopic: 'v1/vtms/${vehicle_code}/telemetry/update', mqttValuePath: 'kinematics.velocity' },
    { id: 'battery', type: 'gauge', x: 168, y: 45, width: 149, height: 82, gaugeVariant: 'semi-arc', min: 0, max: 100, unit: '%', mqttTopic: 'v1/vtms/${vehicle_code}/telemetry/update', mqttValuePath: 'energy.battery_level' },
    { id: 'cpu', type: 'text', x: 13, y: 137, width: 71, height: 24, content: '運算', colorOnlyField: 'status_computing' },
    { id: 'loc', type: 'text', x: 15, y: 172, width: 301, height: 20, content: '{segment_label}' },
    { id: 'mine', type: 'text', x: 1, y: 1, width: 10, height: 10, content: '使用者自己加的' },
  ] as unknown as CanvasElementProps['children'],
} as CanvasElementProps;

describe('vehicle info card template upgrade', () => {
  it('keeps ids, bindings and group settings; replaces semi-arc gauges with bands; adds image and obstacle ring', () => {
    const next = upgradeVehicleCardGroup(legacyGroup);
    const byId = Object.fromEntries(next.children.map((child) => [child.id, child]));
    expect(next).toMatchObject({ id: 'grp', x: 32, y: 856, width: 3776, height: 192, sqlQuery: legacyGroup.sqlQuery, iteratorField: 'vehicle_code' });
    expect(next.backgroundImage).toBe('/dashboard-icons/background/bg1.svg');
    expect(next.backgroundImageFit).toBe('contain');
    expect(byId.card).toBeUndefined();
    expect(byId.speed).toMatchObject({ gaugeVariant: 'band', arcVariant: 'speed', gaugeDecimals: 1, min: 0, max: 40, mqttValuePath: 'kinematics.velocity' });
    expect(byId.battery).toMatchObject({ gaugeVariant: 'band', arcVariant: 'load', mqttValuePath: 'energy.battery_level' });
    expect(byId.badge).toMatchObject({ mqttTopic: 'v1/vtms/${vehicle_code}/operation/update' });
    expect((byId.name as { content: string }).content).toBe('{vehicle_display}');
    expect(byId.mine).toEqual(legacyGroup.children.find((c) => c.id === 'mine'));
    const ring = byId['grp-obstacle-ring'] as ObstacleRingWidget;
    expect(ring.mqttTopic).toBe('v1/vtms/${vehicle_code}/telemetry/update');
    expect(Object.values(ring.directions).every((d) => d.path === '')).toBe(true);
    expect(byId['grp-vehicle-top-view']).toMatchObject({ type: 'image', objectFit: 'contain', src: '/dashboard-icons/vehicles/vehicles.svg' });
  });

  it('centres the obstacle ring on the vehicle image', () => {
    const next = upgradeVehicleCardGroup(legacyGroup);
    const ring = next.children.find((c) => c.type === 'obstacle-ring')!;
    const image = next.children.find((c) => c.type === 'image')!;
    expect(ring.x + ring.width / 2).toBeCloseTo(image.x + image.width / 2, 0);
    expect(ring.y + ring.height / 2).toBeCloseTo(image.y + image.height / 2, 0);
    expect(image.width / image.height).toBeCloseTo(38 / 72, 2);
  });

  it('is idempotent and never overwrites a template that already has the obstacle ring', () => {
    const once = upgradeVehicleCardGroup(legacyGroup);
    expect(isLegacyVehicleCardTemplate(once)).toBe(false);
    expect(upgradeVehicleCardGroup(once)).toBe(once);
    const tweaked = { ...once, children: once.children.map((c) => (c.type === 'gauge' ? { ...c, x: c.x + 3 } : c)) };
    expect(upgradeVehicleCardGroup(tweaked)).toBe(tweaked);
    expect(tweaked.children.filter((c) => c.type === 'obstacle-ring')).toHaveLength(1);
  });

  it('leaves other elements untouched (same object references)', () => {
    const other = { ...legacyGroup, id: 'other', label: '車輛分佈' } as CanvasElementProps;
    const plane = { id: 'p', name: 'p', elements: [other, legacyGroup] } as DashboardPlane;
    const { plane: next, upgraded } = upgradeVehicleCardTemplate(plane);
    expect(upgraded).toEqual(['grp']);
    expect(next.elements[0]).toBe(other);
  });

  it('the shipped demo snapshot already has the new card', () => {
    const group = (demoSnapshot as unknown as DashboardPlane).elements.find((e) => e.label === '車輛狀態')!;
    expect(isLegacyVehicleCardTemplate(group)).toBe(false);
    expect(group.children.some((c) => c.type === 'gauge' && (c as GaugeWidget).gaugeVariant === 'band')).toBe(true);
  });
});

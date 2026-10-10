import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createWidget, OBSTACLE_DIRECTIONS, type ObstacleRingWidget as ObstacleRingWidgetType } from '../types';

const mqtt = vi.hoisted(() => ({ data: null as unknown }));
vi.mock('./useMqttData', () => ({ useMqttData: () => ({ data: mqtt.data }) }));

import { ObstacleRingWidget } from './ObstacleRingWidget';

/** 測試專用綁定：協定目前沒有八方向資料，預設模板不設定任何欄位 */
function testWidget(): ObstacleRingWidgetType {
  const widget = createWidget('obstacle-ring', 0, 0) as ObstacleRingWidgetType;
  return {
    ...widget,
    directions: Object.fromEntries(
      OBSTACLE_DIRECTIONS.map((direction) => [direction, { path: `test.${direction}`, mode: 'boolean' as const }]),
    ) as ObstacleRingWidgetType['directions'],
  };
}

function states(widget: ObstacleRingWidgetType, data: unknown): Record<string, string> {
  mqtt.data = data;
  const html = renderToStaticMarkup(createElement(ObstacleRingWidget, { widget }));
  return Object.fromEntries([...html.matchAll(/data-direction="([a-z_]+)" data-state="([a-z]+)"/g)].map((m) => [m[1], m[2]]));
}

describe('ObstacleRingWidget', () => {
  it('draws eight dots and no red by default (unconfigured template)', () => {
    mqtt.data = { test: { front: true } };
    const html = renderToStaticMarkup(createElement(ObstacleRingWidget, { widget: createWidget('obstacle-ring', 0, 0) as ObstacleRingWidgetType }));
    expect(html.match(/data-direction=/g)).toHaveLength(8);
    expect(html).not.toContain('#FB2C36');
    expect(html).not.toContain('data-state="detected"');
  });

  it('toggles each direction independently', () => {
    const widget = testWidget();
    for (const direction of OBSTACLE_DIRECTIONS) {
      const test = Object.fromEntries(OBSTACLE_DIRECTIONS.map((d) => [d, d === direction]));
      const result = states(widget, { test });
      expect(Object.entries(result).filter(([, s]) => s === 'detected').map(([d]) => d)).toEqual([direction]);
    }
  });

  it('stays grey for "false", unknown values and stale/offline data', () => {
    const widget = testWidget();
    expect(Object.values(states(widget, { test: { front: 'false', rear: 'yes' } }))).not.toContain('detected');
    expect(new Set(Object.values(states(widget, null)))).toEqual(new Set(['unknown']));
  });
});

import { describe, expect, it } from 'vitest';
import type { RouteProgressWidget } from '../types';
import { resolveStationLabelAppearance } from './stationLabelAppearance';

const widget = {
  activeColor: '#111111',
  inactiveColor: '#222222',
} as RouteProgressWidget;

describe('resolveStationLabelAppearance', () => {
  it('uses route colors and wrapping defaults for existing widgets', () => {
    expect(resolveStationLabelAppearance(widget, true, 14)).toEqual({
      color: '#111111', fontSize: 14, wrap: true, maxLines: 2,
    });
  });

  it('uses configured station label appearance', () => {
    expect(resolveStationLabelAppearance({
      ...widget,
      fontSize: 11,
      stationLabelActiveColor: '#abcdef',
      stationLabelWrap: false,
      stationLabelMaxLines: 99,
    }, true, 14)).toEqual({
      color: '#abcdef', fontSize: 11, wrap: false, maxLines: 6,
    });
  });
});

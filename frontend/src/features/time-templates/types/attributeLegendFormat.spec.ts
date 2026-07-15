import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_NAME_MAX_UNITS,
  clampAttributeNameInput,
  formatAttributeLegendBadgeText,
  isAttributeNameWithinLimit,
  measureAttributeNameUnits,
  type AttributeIntervalLegend,
} from './editor';

describe('attribute name length limit', () => {
  it('allows up to 8 Chinese characters', () => {
    const name = '一二三四五六七八';
    expect(measureAttributeNameUnits(name)).toBe(ATTRIBUTE_NAME_MAX_UNITS);
    expect(isAttributeNameWithinLimit(name)).toBe(true);
    expect(isAttributeNameWithinLimit(`${name}九`)).toBe(false);
  });

  it('allows up to 12 ASCII characters', () => {
    const name = 'ABCDEFGHIJKL';
    expect(measureAttributeNameUnits(name)).toBe(12);
    expect(isAttributeNameWithinLimit(name)).toBe(true);
    expect(isAttributeNameWithinLimit(`${name}M`)).toBe(false);
  });

  it('clamps mixed input by weighted units', () => {
    expect(clampAttributeNameInput('凌晨尖峰ABCD')).toBe('凌晨尖峰ABCD');
    expect(clampAttributeNameInput('一二三四五六七八九')).toBe('一二三四五六七八');
  });
});

describe('formatAttributeLegendBadgeText', () => {
  it('uses pipe-separated name, headway, and capacity', () => {
    const item: AttributeIntervalLegend = {
      attributeId: 'a1',
      name: '凌晨時段',
      color: '#fff',
      timeRangesLabel: '00:00-06:00',
      headwaySeconds: 540,
      capacityPphpd: 400,
    };
    expect(formatAttributeLegendBadgeText(item)).toBe('凌晨時段 | 540秒 | 400pphpd');
  });

  it('formats large capacity with grouping', () => {
    const item: AttributeIntervalLegend = {
      attributeId: 'a2',
      name: '尖峰時段',
      color: '#fff',
      timeRangesLabel: '',
      headwaySeconds: 180,
      capacityPphpd: 1200,
    };
    expect(formatAttributeLegendBadgeText(item)).toBe('尖峰時段 | 180秒 | 1,200pphpd');
  });
});

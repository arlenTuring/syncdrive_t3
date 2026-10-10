import { describe, expect, it } from 'vitest';
import { bandColorAt, bandPosition, formatGaugeValue, LOAD_BAND_SEGMENTS, SPEED_BAND_SEGMENTS } from './gaugeBand';

describe('band gauge math', () => {
  it('shows "—" for unknown instead of 0, and honours the precision', () => {
    expect(formatGaugeValue(null, 1)).toBe('—');
    expect(formatGaugeValue(Number.NaN, 1)).toBe('—');
    expect(formatGaugeValue(20.34, 1)).toBe('20.3');
    expect(formatGaugeValue(92.7, 1)).toBe('92.7');
    expect(formatGaugeValue(0, 1)).toBe('0.0');
  });

  it('places the dot by the real value and clamps it to the band without changing the shown value', () => {
    expect(bandPosition(20, 0, 40)).toBe(0.5);
    expect(bandPosition(55, 0, 40)).toBe(1);
    expect(bandPosition(-3, 0, 40)).toBe(0);
    expect(formatGaugeValue(55, 1)).toBe('55.0');
    expect(bandPosition(null, 0, 40)).toBeNull();
  });

  it('colours speed low=green high=red and battery low=red high=green', () => {
    expect(bandColorAt(SPEED_BAND_SEGMENTS, 0.2)).toBe('#00D492');
    expect(bandColorAt(SPEED_BAND_SEGMENTS, 0.95)).toBe('#FB2C36');
    expect(bandColorAt(LOAD_BAND_SEGMENTS, 0.05)).toBe('#FB2C36');
    expect(bandColorAt(LOAD_BAND_SEGMENTS, 0.9)).toBe('#00D492');
  });
});

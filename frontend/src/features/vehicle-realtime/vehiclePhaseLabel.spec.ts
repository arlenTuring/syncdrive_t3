import { describe, expect, it } from 'vitest';
import { vehiclePhaseLabel } from './vehiclePhaseLabel';

describe('vehiclePhaseLabel', () => {
  it('uses the vehicle integration Wiki labels in Traditional Chinese', () => {
    expect(vehiclePhaseLabel('IDLE', 'zh-TW')).toBe('待命');
    expect(vehiclePhaseLabel('TRANSITING', 'zh-TW')).toBe('行駛中');
    expect(vehiclePhaseLabel('DWELLING', 'zh-TW')).toBe('停靠中');
    expect(vehiclePhaseLabel('DOCKING', 'zh-TW')).toBe('精準對位停靠');
    expect(vehiclePhaseLabel('AWAITING_DEPARTURE', 'zh-TW')).toBe('已就位，尚未發車');
  });

  it('switches to English only for an English locale and preserves unknown protocol values', () => {
    expect(vehiclePhaseLabel('RUNNING', 'en-US')).toBe('In transit');
    expect(vehiclePhaseLabel('NEW_STATE', 'zh-TW')).toBe('NEW_STATE');
    expect(vehiclePhaseLabel(undefined, 'zh-TW')).toBeNull();
  });
});

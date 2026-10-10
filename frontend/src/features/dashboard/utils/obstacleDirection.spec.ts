import { describe, expect, it } from 'vitest';
import { evaluateObstacleDirection } from './obstacleDirection';

const bool = (path: string) => ({ path, mode: 'boolean' as const });

describe('evaluateObstacleDirection', () => {
  it('turns red only on an explicit detection', () => {
    for (const value of [true, 'true', 'TRUE', 1, '1'])
      expect(evaluateObstacleDirection({ o: { front: value } }, bool('o.front'))).toEqual({ state: 'detected' });
    for (const value of [false, 'false', 'False', 0, '0'])
      expect(evaluateObstacleDirection({ o: { front: value } }, bool('o.front'))).toEqual({ state: 'clear' });
  });

  it('never treats the string "false" or other truthy junk as an obstacle', () => {
    expect(evaluateObstacleDirection({ v: 'false' }, bool('v')).state).toBe('clear');
    for (const value of ['yes', 'detected', '', 2, {}, []])
      expect(evaluateObstacleDirection({ v: value }, bool('v')).state).toBe('unknown');
  });

  it('is unknown (not red, not safe) when unconfigured, missing, offline or stale', () => {
    expect(evaluateObstacleDirection({ v: true }, bool(''))).toEqual({ state: 'unknown', reason: 'unconfigured' });
    expect(evaluateObstacleDirection(null, bool('v'))).toEqual({ state: 'unknown', reason: 'no-data' });
    expect(evaluateObstacleDirection({}, bool('v'))).toEqual({ state: 'unknown', reason: 'missing' });
    expect(evaluateObstacleDirection({ v: null }, bool('v'))).toEqual({ state: 'unknown', reason: 'missing' });
  });

  it('uses a configured distance threshold and refuses to guess one', () => {
    const binding = { path: 'd', mode: 'distance' as const, threshold: 1.5 };
    expect(evaluateObstacleDirection({ d: 1.2 }, binding).state).toBe('detected');
    expect(evaluateObstacleDirection({ d: '1.5' }, binding).state).toBe('detected');
    expect(evaluateObstacleDirection({ d: 3 }, binding).state).toBe('clear');
    expect(evaluateObstacleDirection({ d: 'far' }, binding).state).toBe('unknown');
    expect(evaluateObstacleDirection({ d: 0.1 }, { path: 'd', mode: 'distance' })).toEqual({
      state: 'unknown',
      reason: 'no-threshold',
    });
  });

  it('evaluates each direction independently from the same payload', () => {
    const payload = { s: { fl: false, f: true, fr: 'false' } };
    expect(evaluateObstacleDirection(payload, bool('s.f')).state).toBe('detected');
    expect(evaluateObstacleDirection(payload, bool('s.fl')).state).toBe('clear');
    expect(evaluateObstacleDirection(payload, bool('s.fr')).state).toBe('clear');
    expect(evaluateObstacleDirection(payload, bool('s.r')).state).toBe('unknown');
  });
});

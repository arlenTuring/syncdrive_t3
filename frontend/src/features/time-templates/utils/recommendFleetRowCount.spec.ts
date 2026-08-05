import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recommendFleetRowCount } from './recommendFleetRowCount';

describe('recommendFleetRowCount', () => {
  it('returns ceil(cycle/headway) as theoretical min', () => {
    const result = recommendFleetRowCount({
      cycleSeconds: 900,
      headwaySeconds: 180,
    });
    assert.ok(result);
    assert.equal(result!.theoreticalMin, 5);
    assert.equal(result!.recommended, 5);
  });

  it('adds a spare row when interval is shorter than cycle+headway', () => {
    const result = recommendFleetRowCount({
      cycleSeconds: 900,
      headwaySeconds: 180,
      intervalDurationSeconds: 600,
    });
    assert.ok(result);
    assert.equal(result!.theoreticalMin, 5);
    assert.equal(result!.recommended, 6);
    assert.ok(result!.tips.some((tip) => tip.includes('短於週期')));
  });

  it('returns null for invalid inputs', () => {
    assert.equal(
      recommendFleetRowCount({ cycleSeconds: 0, headwaySeconds: 180 }),
      null,
    );
  });
});

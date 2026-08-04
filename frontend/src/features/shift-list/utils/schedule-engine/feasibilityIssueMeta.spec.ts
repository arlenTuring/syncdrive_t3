import { describe, expect, it } from 'vitest';
import {
  enrichFeasibilityIssue,
  resolveFeasibilityIssueMeta,
} from './feasibilityIssueMeta';

describe('feasibilityIssueMeta', () => {
  it('tags entry-service skip as policy with guidance', () => {
    const issue = enrichFeasibilityIssue({
      code: 'MAINTENANCE_DISPATCH_UNREACHABLE',
      severity: 'warning',
      message: '略過進場載客',
    });
    expect(issue.kind).toBe('policy');
    expect(issue.guidance).toMatch(/略過/);
    expect(resolveFeasibilityIssueMeta(issue).kindLabel).toBe('策略說明');
    expect(resolveFeasibilityIssueMeta(issue).groupTitle).toBe('略過進場載客');
  });

  it('tags headway-below-target as algorithm limit', () => {
    const meta = resolveFeasibilityIssueMeta({
      code: 'HEADWAY_BELOW_TARGET',
    });
    expect(meta.kind).toBe('limit');
    expect(meta.guidance).toMatch(/較嚴者/);
    expect(meta.kindLabel).toBe('演算法極限');
  });

  it('allows caller override of guidance', () => {
    const issue = enrichFeasibilityIssue({
      code: 'HEADWAY_BELOW_TARGET',
      severity: 'warning',
      message: 'x',
      guidance: '自訂建議',
    });
    expect(issue.guidance).toBe('自訂建議');
    expect(issue.kind).toBe('limit');
  });
});

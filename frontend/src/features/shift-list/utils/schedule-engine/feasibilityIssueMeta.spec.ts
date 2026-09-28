import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_FEASIBILITY_VIOLATION_CODES,
  enrichFeasibilityIssue,
  resolveFeasibilityIssueMeta,
} from './feasibilityIssueMeta';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALGO_OVERVIEW_HTML_PATH = path.resolve(
  __dirname,
  '../../../../../../document/排班引擎算法全覽-審核.html',
);

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
    expect(meta.guidance).toMatch(/實際班距未達設定目標/);
    expect(meta.kindLabel).toBe('尚未排妥');
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

  it('every code has a docAnchor into the algorithm overview', () => {
    for (const code of ALL_FEASIBILITY_VIOLATION_CODES) {
      const meta = resolveFeasibilityIssueMeta({ code });
      expect(meta.docAnchor, `${code} missing docAnchor`).not.toBeNull();
    }
  });

  it('every FeasibilityViolationCode is documented in §13 of the algorithm overview', () => {
    // 防漂移：§13 曾只列 14/26 個代號，程式加了新代號卻忘記補文件不會被發現。
    // GROUP_TITLE（ALL_FEASIBILITY_VIOLATION_CODES 的來源）是 exhaustive Record，
    // 少一個代號 TS 就編譯失敗，所以這裡不需要另外手抄一份代號清單。
    const html = readFileSync(ALGO_OVERVIEW_HTML_PATH, 'utf8');
    const s13Match = html.match(/<section id="s13">([\s\S]*?)<\/section>/);
    expect(s13Match, '§13 section (id="s13") not found in algorithm overview HTML').not.toBeNull();
    const s13Html = s13Match![1]!;

    const missing = ALL_FEASIBILITY_VIOLATION_CODES.filter(
      (code) => !s13Html.includes(`<code>${code}</code>`),
    );
    expect(missing, `codes missing from §13: ${missing.join(', ')}`).toEqual([]);
  });
});

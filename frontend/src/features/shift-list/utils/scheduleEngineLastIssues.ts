/**
 * 每次重新生成班表後覆寫「最近一次可行性」快照。
 * 分層：硬錯誤置頂；策略說明預設摺疊。含驗收閘門摘要。
 */

import type { ShiftScheduleCreateDraft } from '../types/create';
import { resolveGeneratedBlockTripCode } from './maintenanceSectionCode';
import {
  evaluateScheduleAcceptance,
  ISSUE_DISPLAY_LAYER_LABEL,
  ISSUE_DISPLAY_LAYER_ORDER,
  layerSortKey,
  resolveIssueDisplayLayer,
  type IssueDisplayLayer,
  type ScheduleAcceptanceSummary,
} from './scheduleAcceptance';
import {
  resolveFeasibilityIssueMeta,
  type FeasibilityIssueKind,
} from './schedule-engine/feasibilityIssueMeta';
import type {
  FeasibilityIssue,
  GenerateShiftScheduleResult,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
} from './schedule-engine/types';

export type ScheduleEngineLastIssueItem = {
  index: number;
  severity: 'error' | 'warning';
  code: FeasibilityIssue['code'];
  kind: FeasibilityIssueKind;
  kindLabel: string;
  groupTitle: string;
  tripCode: string;
  message: string;
  guidance: string;
  detail: Record<string, unknown> | null;
  /** 展示分層 */
  layer: IssueDisplayLayer;
  /** 對應算法全覽章節錨點，可能無對應 */
  docAnchor: { id: string; label: string } | null;
};

export type ScheduleEngineLastIssuesSnapshot = {
  updatedAt: string;
  ok: boolean;
  shiftId: string | null;
  shiftName: string | null;
  templateName: string | null;
  errorCount: number;
  warningCount: number;
  acceptance: ScheduleAcceptanceSummary;
  /** 依硬錯誤 → 極限 → 可調 → 策略排序後的逐則 */
  items: ScheduleEngineLastIssueItem[];
  /** 後端直接覆寫用，避免雙端 HTML 漂移 */
  standaloneHtml: string;
};

function findPlanBlock(
  plan: GeneratedSchedulePlan,
  blockId: string,
): { block: GeneratedScheduleBlock; index: number } | null {
  for (const timeline of plan.timelines) {
    const index = timeline.blocks.findIndex((b) => b.id === blockId);
    if (index >= 0) return { block: timeline.blocks[index]!, index };
  }
  return null;
}

function resolveIssueJumpBlockId(
  issue: FeasibilityIssue,
  plan: GeneratedSchedulePlan | null,
): string | null {
  const detail = issue.detail;
  if (!detail || !plan) return null;
  for (const key of ['blockId', 'nextBlockId', 'earlierBlockId'] as const) {
    const raw = detail[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return null;
}

function resolveIssueTripCode(
  issue: FeasibilityIssue,
  plan: GeneratedSchedulePlan | null,
  draft: ShiftScheduleCreateDraft,
): string {
  const fromDetail = issue.detail?.tripCode;
  if (typeof fromDetail === 'string' && fromDetail.trim()) {
    return fromDetail.trim();
  }

  const sectionCodes = draft.maintenanceTask.skipped
    ? null
    : draft.maintenanceTask.sectionCodeBySection;

  if (plan) {
    const blockId = resolveIssueJumpBlockId(issue, plan);
    if (blockId) {
      const found = findPlanBlock(plan, blockId);
      if (found) {
        return resolveGeneratedBlockTripCode(
          found.block,
          found.index,
          sectionCodes,
        );
      }
    }
  }

  const row = issue.detail?.timelineRow;
  if (typeof row === 'number') return `L${row}`;
  if (
    typeof issue.detail?.routeCode === 'string'
    && issue.detail.routeCode.trim()
  ) {
    return String(issue.detail.routeCode).trim();
  }
  return '----';
}

function toItem(
  issue: FeasibilityIssue,
  severity: 'error' | 'warning',
  plan: GeneratedSchedulePlan | null,
  draft: ShiftScheduleCreateDraft,
): Omit<ScheduleEngineLastIssueItem, 'index'> {
  const meta = resolveFeasibilityIssueMeta(issue);
  const layer = resolveIssueDisplayLayer(severity, meta.kind, issue.code);
  return {
    severity,
    code: issue.code,
    kind: meta.kind,
    kindLabel: meta.kindLabel,
    groupTitle: meta.groupTitle,
    tripCode: resolveIssueTripCode(issue, plan, draft),
    message: issue.message,
    guidance: meta.guidance,
    detail:
      issue.detail && typeof issue.detail === 'object'
        ? (issue.detail as Record<string, unknown>)
        : null,
    layer,
    docAnchor: meta.docAnchor,
  };
}

type SeverityBand = 'severe' | 'moderate' | 'mild';

const SEVERITY_BAND_RANK: Record<SeverityBand, number> = {
  severe: 0,
  moderate: 1,
  mild: 2,
};

/**
 * 少數代號（如 UNSERVED_SERVICE_PULSE：完全無車承接）沒有 detail.severityBand，
 * 但實質上不輸給 severe 的班距警告，需給定排序提示，避免被字母序（H < U）壓到底部。
 */
const CODE_SEVERITY_HINT: Partial<Record<FeasibilityIssue['code'], SeverityBand>> = {
  UNSERVED_SERVICE_PULSE: 'severe',
};

function resolveSeverityBand(
  item: Omit<ScheduleEngineLastIssueItem, 'index'>,
): SeverityBand | null {
  const raw = item.detail?.severityBand;
  if (typeof raw === 'string' && raw in SEVERITY_BAND_RANK) {
    return raw as SeverityBand;
  }
  return CODE_SEVERITY_HINT[item.code] ?? null;
}

function severityBandRank(item: Omit<ScheduleEngineLastIssueItem, 'index'>): number {
  const band = resolveSeverityBand(item);
  return band ? SEVERITY_BAND_RANK[band] : SEVERITY_BAND_RANK.moderate;
}

function deficitSecondsOf(item: Omit<ScheduleEngineLastIssueItem, 'index'>): number {
  const raw = item.detail?.deficitSeconds;
  return typeof raw === 'number' ? raw : 0;
}

function compareLayerThenStable(
  a: Omit<ScheduleEngineLastIssueItem, 'index'>,
  b: Omit<ScheduleEngineLastIssueItem, 'index'>,
): number {
  const layerDiff = layerSortKey(a.layer) - layerSortKey(b.layer);
  if (layerDiff !== 0) return layerDiff;
  const severityDiff = severityBandRank(a) - severityBandRank(b);
  if (severityDiff !== 0) return severityDiff;
  const deficitDiff = deficitSecondsOf(b) - deficitSecondsOf(a);
  if (deficitDiff !== 0) return deficitDiff;
  return a.code.localeCompare(b.code);
}

export function buildScheduleEngineLastIssuesSnapshot(args: {
  draft: ShiftScheduleCreateDraft;
  result: GenerateShiftScheduleResult;
  shiftId?: string;
  updatedAt?: string;
}): ScheduleEngineLastIssuesSnapshot {
  const { draft, result, shiftId } = args;
  const updatedAt = args.updatedAt ?? new Date().toISOString();
  const { plan, report } = result;
  const acceptance = evaluateScheduleAcceptance(report);

  const unordered: Omit<ScheduleEngineLastIssueItem, 'index'>[] = [];
  for (const issue of report.errors) {
    unordered.push(toItem(issue, 'error', plan, draft));
  }
  for (const issue of report.warnings) {
    unordered.push(toItem(issue, 'warning', plan, draft));
  }
  unordered.sort(compareLayerThenStable);

  const items: ScheduleEngineLastIssueItem[] = unordered.map((item, i) => ({
    ...item,
    index: i + 1,
  }));

  const snapshotWithoutHtml: Omit<ScheduleEngineLastIssuesSnapshot, 'standaloneHtml'> = {
    updatedAt,
    ok: report.ok,
    shiftId: shiftId ?? null,
    shiftName: draft.basic.name?.trim() || null,
    templateName: draft.timeTemplate.templateName?.trim() || null,
    errorCount: report.errors.length,
    warningCount: report.warnings.length,
    acceptance,
    items,
  };

  return {
    ...snapshotWithoutHtml,
    standaloneHtml: renderLastIssuesStandaloneHtml(snapshotWithoutHtml),
  };
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** 逐則完整 detail JSON 只展開前 N 則（依排序後，通常是最嚴重那批）；其餘給精簡摘要，避免整檔被 JSON 灌爆。 */
const FULL_DETAIL_CAP = 20;

/** 精簡摘要允許透出的欄位；涵蓋班距／站位／進場載客等常見 detail 形狀。 */
const COMPACT_DETAIL_KEYS = [
  'severityBand',
  'deficitSeconds',
  'gapSeconds',
  'targetHeadwaySeconds',
  'delaySeconds',
  'candidateCount',
  'topologySource',
  'timelineRow',
  'fromRouteId',
  'toRouteId',
] as const;

function renderCompactDetail(detail: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of COMPACT_DETAIL_KEYS) {
    const v = detail[key];
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${key}=${escapeHtml(String(v))}`);
  }
  return parts.join(' · ');
}

function renderIssueArticle(item: ScheduleEngineLastIssueItem): string {
  const band = resolveSeverityBand(item);
  const bandBadge = band
    ? `<span class="band band-${escapeHtml(band)}">${escapeHtml(band)}</span>`
    : '';

  let detailBlock = '';
  if (item.detail) {
    if (item.index <= FULL_DETAIL_CAP) {
      const detailJson = escapeHtml(JSON.stringify(item.detail, null, 2));
      detailBlock = `<details><summary>detail</summary><pre>${detailJson}</pre></details>`;
    } else {
      const compact = renderCompactDetail(item.detail);
      detailBlock = `<p class="detail-compact">${
        compact ? `${compact} · ` : ''
      }完整 detail 見 <code>frontend/.dev/schedule-engine-last-issues.json</code>（index=${item.index}）</p>`;
    }
  }

  return `
<article id="issue-${item.index}" class="row ${escapeHtml(item.severity)} kind-${escapeHtml(item.kind)} layer-${escapeHtml(item.layer)}">
  <div class="row-head">
    <span class="idx">#${item.index}</span>
    <span class="sev">${escapeHtml(item.severity)}</span>
    <span class="kind">${escapeHtml(item.kindLabel)}</span>
    ${bandBadge}
    <span class="trip">${escapeHtml(item.tripCode)}</span>
  </div>
  <h2>${escapeHtml(item.groupTitle)}</h2>
  <p class="code"><code>${escapeHtml(item.code)}</code></p>
  <p class="msg">${escapeHtml(item.message)}</p>
  <p class="guide">${escapeHtml(item.guidance)}</p>
  ${
    item.docAnchor
      ? `<p class="doc-link"><a href="./排班引擎算法全覽-審核.html#${escapeHtml(item.docAnchor.id)}">→ 詳見 ${escapeHtml(item.docAnchor.label)}</a></p>`
      : ''
  }
  ${detailBlock}
</article>`;
}

type CauseGroup = {
  layer: IssueDisplayLayer;
  code: FeasibilityIssue['code'];
  kindLabel: string;
  groupTitle: string;
  band: SeverityBand | null;
  count: number;
  deficitTotal: number;
  deficitCount: number;
  exampleIndexes: number[];
};

/**
 * 270 則逐一等權卡片沒有結構；先依「代號 × 嚴重度」聚合，
 * 讓使用者看見「這是幾個成因、不是 N 個獨立問題」，再點進逐則。
 */
function buildCauseSummary(items: ScheduleEngineLastIssueItem[]): CauseGroup[] {
  const groups = new Map<string, CauseGroup>();
  for (const item of items) {
    const band = resolveSeverityBand(item);
    const key = `${item.layer}|${item.code}|${band ?? 'n/a'}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        layer: item.layer,
        code: item.code,
        kindLabel: item.kindLabel,
        groupTitle: item.groupTitle,
        band,
        count: 0,
        deficitTotal: 0,
        deficitCount: 0,
        exampleIndexes: [],
      };
      groups.set(key, group);
    }
    group.count += 1;
    const deficit = item.detail?.deficitSeconds;
    if (typeof deficit === 'number') {
      group.deficitTotal += deficit;
      group.deficitCount += 1;
    }
    if (group.exampleIndexes.length < 3) group.exampleIndexes.push(item.index);
  }
  return [...groups.values()].sort((a, b) => {
    const layerDiff = layerSortKey(a.layer) - layerSortKey(b.layer);
    if (layerDiff !== 0) return layerDiff;
    const bandDiff = SEVERITY_BAND_RANK[a.band ?? 'moderate'] - SEVERITY_BAND_RANK[b.band ?? 'moderate'];
    if (bandDiff !== 0) return bandDiff;
    return b.count - a.count;
  });
}

function renderCauseSummary(items: ScheduleEngineLastIssueItem[]): string {
  const groups = buildCauseSummary(items);
  if (groups.length === 0) return '';
  const rows = groups
    .map((g) => {
      const bandBadge = g.band
        ? `<span class="band band-${escapeHtml(g.band)}">${escapeHtml(g.band)}</span>`
        : '<span class="band-none">—</span>';
      const avgDeficit = g.deficitCount > 0
        ? `${Math.round(g.deficitTotal / g.deficitCount)}s`
        : '—';
      const examples = g.exampleIndexes
        .map((i) => `<a href="#issue-${i}">#${i}</a>`)
        .join(' ');
      return `
    <tr>
      <td>${escapeHtml(g.groupTitle)}</td>
      <td><code>${escapeHtml(g.code)}</code></td>
      <td>${bandBadge}</td>
      <td>${g.count}</td>
      <td>${escapeHtml(avgDeficit)}</td>
      <td>${examples}</td>
    </tr>`;
    })
    .join('');
  return `
<section class="cause-summary">
  <h2>成因摘要（依代號 × 嚴重度分群，${groups.length} 群 · 共 ${items.length} 則）</h2>
  <table>
    <thead><tr><th>分類</th><th>代號</th><th>嚴重度</th><th>則數</th><th>平均落差</th><th>範例</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function renderLayeredIssueList(items: ScheduleEngineLastIssueItem[]): string {
  if (items.length === 0) {
    return `<p class="empty">本次生成無錯誤／警告。</p>`;
  }

  const byLayer = new Map<IssueDisplayLayer, ScheduleEngineLastIssueItem[]>();
  for (const layer of ISSUE_DISPLAY_LAYER_ORDER) byLayer.set(layer, []);
  for (const item of items) {
    byLayer.get(item.layer)!.push(item);
  }

  return ISSUE_DISPLAY_LAYER_ORDER.map((layer) => {
    const layerItems = byLayer.get(layer) ?? [];
    if (layerItems.length === 0) return '';
    const label = ISSUE_DISPLAY_LAYER_LABEL[layer];
    const body = layerItems.map(renderIssueArticle).join('\n');
    if (layer === 'policy') {
      return `
<section class="layer layer-policy">
  <details class="layer-fold">
    <summary>${escapeHtml(label)} · ${layerItems.length} 則（預設摺疊）</summary>
    <div class="list">${body}</div>
  </details>
</section>`;
    }
    const openAttr = layer === 'hard' || layerItems.length <= 12 ? ' open' : '';
    return `
<section class="layer layer-${escapeHtml(layer)}">
  <details class="layer-fold"${openAttr}>
    <summary>${escapeHtml(label)} · ${layerItems.length} 則</summary>
    <div class="list">${body}</div>
  </details>
</section>`;
  })
    .filter(Boolean)
    .join('\n');
}

function renderAcceptanceBox(
  acceptance: ScheduleAcceptanceSummary,
  ok: boolean,
): string {
  const gateClass = acceptance.gatePassed ? 'gate-ok' : 'gate-fail';
  const qualityClass = acceptance.qualityPassed ? 'gate-ok' : 'gate-warn';
  const hardCodes = Object.entries(acceptance.hardErrorsByCode)
    .map(([code, n]) => `${code}×${n}`)
    .join('、');
  const qualityCodes = Object.entries(acceptance.qualityFailByCode)
    .map(([code, n]) => `${code}×${n}`)
    .join('、');
  const criteria = acceptance.criteria
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');

  return `
<section class="accept">
  <h2>驗收定義</h2>
  <p class="accept-pill ${gateClass}">硬閘 gatePassed=<code>${acceptance.gatePassed}</code>（report.ok=<code>${ok}</code>）· 硬錯誤 ${acceptance.hardErrorCount}</p>
  <p class="accept-pill ${qualityClass}">品質目標 qualityPassed=<code>${acceptance.qualityPassed}</code>${
    qualityCodes ? ` · 未清零：${escapeHtml(qualityCodes)}` : ' · 無班距／脈衝品質警告'
  }</p>
  <p class="meta">策略噪音 ${acceptance.policyNoiseCount}／極限警告 ${acceptance.limitWarningCount}／可調警告 ${acceptance.actionableWarningCount}</p>
  ${hardCodes ? `<p class="meta">硬錯誤代號：${escapeHtml(hardCodes)}</p>` : ''}
  <ul class="criteria">${criteria}</ul>
</section>`;
}

/** 獨立問題分頁完整 HTML（覆寫用）。 */
export function renderLastIssuesStandaloneHtml(
  snapshot: Omit<ScheduleEngineLastIssuesSnapshot, 'standaloneHtml'> | ScheduleEngineLastIssuesSnapshot,
): string {
  const when = escapeHtml(snapshot.updatedAt);
  const acceptance =
    snapshot.acceptance
    ?? evaluateScheduleAcceptance({
      ok: snapshot.ok,
      errors: snapshot.items
        .filter((i) => i.severity === 'error')
        .map((i) => ({
          code: i.code,
          severity: 'error' as const,
          message: i.message,
          kind: i.kind,
        })),
      warnings: snapshot.items
        .filter((i) => i.severity === 'warning')
        .map((i) => ({
          code: i.code,
          severity: 'warning' as const,
          message: i.message,
          kind: i.kind,
        })),
    });

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>排班引擎 · 最近一次生成的問題</title>
  <style>
    :root {
      --bg: #12151a; --card: #1a1f26; --ink: #e8eef2; --muted: #9aa3ad;
      --line: #2a323c; --err: #f07178; --warn: #c9a227; --ok: #7fd99a;
      --policy: #6cb6ff; --limit: #c3a6ff; --action: #f0a46a;
      --sans: "IBM Plex Sans", "Noto Sans TC", sans-serif;
      --mono: "IBM Plex Mono", ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 28px 20px 64px;
      font-family: var(--sans); background: var(--bg); color: var(--ink);
      line-height: 1.55; font-size: 14px;
    }
    header, .accept { max-width: 920px; margin: 0 auto 24px; }
    h1 { font-size: 1.35rem; margin: 0 0 8px; }
    .meta { color: var(--muted); font-size: 13px; }
    .meta code { font-family: var(--mono); font-size: 12px; }
    .back { color: #8ed4c8; }
    .accept {
      background: var(--card); border: 1px solid var(--line);
      border-radius: 10px; padding: 14px 16px;
    }
    .accept h2 { font-size: 1rem; margin: 0 0 10px; }
    .accept-pill { margin: 0 0 6px; font-size: 13px; }
    .gate-ok { color: var(--ok); }
    .gate-fail { color: var(--err); }
    .gate-warn { color: var(--warn); }
    .criteria { margin: 10px 0 0; padding-left: 1.2em; color: var(--muted); font-size: 13px; }
    .layer { max-width: 920px; margin: 0 auto 16px; }
    .layer-fold > summary {
      cursor: pointer; list-style: none;
      background: var(--card); border: 1px solid var(--line);
      border-radius: 10px; padding: 10px 14px; font-weight: 600;
    }
    .layer-fold > summary::-webkit-details-marker { display: none; }
    .layer-hard > .layer-fold > summary { border-left: 4px solid var(--err); }
    .layer-limit > .layer-fold > summary { border-left: 4px solid var(--limit); }
    .layer-actionable > .layer-fold > summary { border-left: 4px solid var(--action); }
    .layer-policy > .layer-fold > summary { border-left: 4px solid var(--policy); color: var(--muted); font-weight: 500; }
    .layer-fold[open] > summary { margin-bottom: 10px; }
    .list { display: grid; gap: 12px; }
    .row {
      background: var(--card); border: 1px solid var(--line);
      border-radius: 10px; padding: 12px 14px;
    }
    .row.error { border-left: 4px solid var(--err); }
    .row.warning { border-left: 4px solid var(--warn); }
    .row-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 6px; }
    .idx { color: var(--muted); font-family: var(--mono); font-size: 12px; }
    .sev, .kind, .trip {
      font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line);
    }
    .sev { text-transform: uppercase; letter-spacing: 0.04em; }
    .row.error .sev { color: var(--err); border-color: #5a3034; }
    .row.warning .sev { color: var(--warn); border-color: #5a4a20; }
    .kind-policy .kind { color: var(--policy); }
    .kind-limit .kind { color: var(--limit); }
    .kind-actionable .kind { color: var(--action); }
    .band {
      font-size: 11px; padding: 2px 8px; border-radius: 999px;
      text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;
    }
    .band-severe { background: #4a1f24; color: var(--err); }
    .band-moderate { background: #3a3320; color: var(--warn); }
    .band-mild { background: #22303a; color: #8ed4c8; }
    .band-none { color: var(--muted); }
    .trip { font-family: var(--mono); }
    .cause-summary { max-width: 920px; margin: 0 auto 24px; }
    .cause-summary h2 { font-size: 1rem; margin: 0 0 10px; }
    .cause-summary table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .cause-summary th, .cause-summary td {
      border-bottom: 1px solid var(--line); padding: 6px 10px; text-align: left;
    }
    .cause-summary th { color: var(--muted); font-weight: 600; }
    .cause-summary a { color: #8ed4c8; text-decoration: none; margin-right: 6px; }
    .cause-summary a:hover { text-decoration: underline; }
    .detail-compact { margin: 0; color: var(--muted); font-size: 12px; font-family: var(--mono); }
    .toolbar {
      max-width: 920px; margin: 0 auto 16px; position: sticky; top: 0; z-index: 10;
      background: var(--bg); padding: 8px 0; display: flex; align-items: center; gap: 10px;
    }
    .toolbar input {
      flex: 1; background: var(--card); border: 1px solid var(--line); color: var(--ink);
      border-radius: 8px; padding: 8px 12px; font-size: 13px; font-family: var(--sans);
    }
    .toolbar input:focus { outline: 1px solid var(--policy); }
    .toolbar-count { color: var(--muted); font-size: 12px; white-space: nowrap; }
    :target { outline: 2px solid var(--policy); outline-offset: 2px; }
    h2 { font-size: 1rem; margin: 0 0 4px; font-weight: 600; }
    .code { margin: 0 0 8px; }
    .code code { font-family: var(--mono); font-size: 12px; color: var(--muted); }
    .msg { margin: 0 0 8px; white-space: pre-wrap; }
    .guide { margin: 0; color: var(--muted); font-size: 13px; }
    .doc-link { margin: 6px 0 0; font-size: 12px; }
    .doc-link a { color: #8ed4c8; text-decoration: none; }
    .doc-link a:hover { text-decoration: underline; }
    details.row-detail, .row details { margin-top: 10px; }
    summary { cursor: pointer; color: var(--muted); font-size: 12px; }
    pre {
      margin: 8px 0 0; padding: 10px; overflow: auto;
      background: #0e1116; border-radius: 6px; font-family: var(--mono); font-size: 11px;
    }
    .empty { color: var(--ok); max-width: 920px; margin: 0 auto; }
  </style>
</head>
<body>
  <header>
    <p><a class="back" href="./排班引擎算法全覽-審核.html">← 回算法／策略審核</a></p>
    <h1>最近一次生成的問題（分層）</h1>
    <p class="meta">
      更新：${when}
      ${snapshot.shiftName ? ` · 班表「${escapeHtml(snapshot.shiftName)}」` : ''}
      ${snapshot.templateName ? ` · 模板「${escapeHtml(snapshot.templateName)}」` : ''}
      · ok=<code>${snapshot.ok ? 'true' : 'false'}</code>
      · 錯誤 ${snapshot.errorCount}／警告 ${snapshot.warningCount}／共 ${snapshot.items.length} 則
    </p>
    <p class="meta">每次重新生成整份覆寫，不累加。機器可讀：<code>frontend/.dev/schedule-engine-last-issues.json</code></p>
  </header>
  ${renderAcceptanceBox(acceptance, snapshot.ok)}
  ${renderCauseSummary(snapshot.items)}
  <div class="toolbar">
    <input id="issue-search" type="search" placeholder="搜尋代號／班次／訊息…" autocomplete="off" />
    <span class="toolbar-count" id="issue-search-count"></span>
  </div>
  ${renderLayeredIssueList(snapshot.items)}
  <script>
  (function () {
    var input = document.getElementById('issue-search');
    var countEl = document.getElementById('issue-search-count');
    if (!input) return;
    var rows = Array.prototype.slice.call(document.querySelectorAll('.row'));
    function apply() {
      var q = (input.value || '').trim().toLowerCase();
      var shown = 0;
      rows.forEach(function (row) {
        var hit = !q || row.textContent.toLowerCase().indexOf(q) !== -1;
        row.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      countEl.textContent = q ? (shown + ' / ' + rows.length + ' 則符合') : '';
      document.querySelectorAll('.layer-fold').forEach(function (details) {
        if (!q) return;
        var anyVisible = Array.prototype.some.call(
          details.querySelectorAll('.row'),
          function (r) { return r.style.display !== 'none'; },
        );
        details.open = anyVisible;
      });
    }
    input.addEventListener('input', apply);
  })();
  </script>
</body>
</html>
`;
}

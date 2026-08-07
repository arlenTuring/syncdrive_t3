import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { promises as fs } from 'fs';
import * as path from 'path';

function sanitizeLabel(raw: unknown): string {
  if (typeof raw !== 'string') return 'run';
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60);
  return cleaned || 'run';
}

function timestampSlug(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function repoRootFromCwd(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'backend') return path.resolve(cwd, '..');
  return cwd;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

type LastIssueItem = {
  index?: number;
  severity?: string;
  code?: string;
  kind?: string;
  kindLabel?: string;
  groupTitle?: string;
  tripCode?: string;
  message?: string;
  guidance?: string;
  detail?: Record<string, unknown> | null;
};

type LastIssuesSnapshot = {
  updatedAt?: string;
  ok?: boolean;
  shiftName?: string | null;
  templateName?: string | null;
  errorCount?: number;
  warningCount?: number;
  items?: LastIssueItem[];
  /** 前端已渲染完整 HTML 時優先覆寫，避免雙端模板漂移 */
  standaloneHtml?: string;
  acceptance?: {
    gatePassed?: boolean;
    qualityPassed?: boolean;
    hardErrorCount?: number;
    policyNoiseCount?: number;
    limitWarningCount?: number;
    actionableWarningCount?: number;
    criteria?: string[];
  };
};

function renderStandaloneIssuesHtml(snapshot: LastIssuesSnapshot): string {
  const when = escapeHtml(snapshot.updatedAt ?? new Date().toISOString());
  const items = snapshot.items ?? [];
  const rows =
    items.length === 0
      ? `<p class="empty">本次生成無錯誤／警告。</p>`
      : items
          .map((item) => {
            const detailJson = item.detail
              ? escapeHtml(JSON.stringify(item.detail, null, 2))
              : '';
            const severity = item.severity === 'error' ? 'error' : 'warning';
            const kind = item.kind ?? 'actionable';
            return `
<article class="row ${severity} kind-${escapeHtml(kind)}">
  <div class="row-head">
    <span class="idx">#${Number(item.index) || 0}</span>
    <span class="sev">${escapeHtml(severity)}</span>
    <span class="kind">${escapeHtml(item.kindLabel ?? '')}</span>
    <span class="trip">${escapeHtml(item.tripCode ?? '----')}</span>
  </div>
  <h2>${escapeHtml(item.groupTitle ?? item.code ?? '')}</h2>
  <p class="code"><code>${escapeHtml(item.code ?? '')}</code></p>
  <p class="msg">${escapeHtml(item.message ?? '')}</p>
  <p class="guide">${escapeHtml(item.guidance ?? '')}</p>
  ${
    detailJson
      ? `<details><summary>detail</summary><pre>${detailJson}</pre></details>`
      : ''
  }
</article>`;
          })
          .join('\n');

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
    header { max-width: 920px; margin: 0 auto 24px; }
    h1 { font-size: 1.35rem; margin: 0 0 8px; }
    .meta { color: var(--muted); font-size: 13px; }
    .meta code { font-family: var(--mono); font-size: 12px; }
    .back { color: #8ed4c8; }
    .list { max-width: 920px; margin: 0 auto; display: grid; gap: 12px; }
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
    .trip { font-family: var(--mono); }
    h2 { font-size: 1rem; margin: 0 0 4px; font-weight: 600; }
    .code { margin: 0 0 8px; }
    .code code { font-family: var(--mono); font-size: 12px; color: var(--muted); }
    .msg { margin: 0 0 8px; white-space: pre-wrap; }
    .guide { margin: 0; color: var(--muted); font-size: 13px; }
    details { margin-top: 10px; }
    summary { cursor: pointer; color: var(--muted); font-size: 12px; }
    pre {
      margin: 8px 0 0; padding: 10px; overflow: auto;
      background: #0e1116; border-radius: 6px; font-family: var(--mono); font-size: 11px;
    }
    .empty { color: var(--ok); }
  </style>
</head>
<body>
  <header>
    <p><a class="back" href="./排班引擎算法全覽-審核.html">← 回算法／策略審核</a></p>
    <h1>最近一次生成的問題（逐則）</h1>
    <p class="meta">
      更新：${when}
      ${snapshot.shiftName ? ` · 班表「${escapeHtml(snapshot.shiftName)}」` : ''}
      ${snapshot.templateName ? ` · 模板「${escapeHtml(snapshot.templateName)}」` : ''}
      · ok=<code>${snapshot.ok ? 'true' : 'false'}</code>
      · 錯誤 ${snapshot.errorCount ?? 0}／警告 ${snapshot.warningCount ?? 0}／共 ${items.length} 則
    </p>
    <p class="meta">每次重新生成整份覆寫，不累加。機器可讀：<code>frontend/.dev/schedule-engine-last-issues.json</code></p>
  </header>
  <div class="list">
${rows}
  </div>
</body>
</html>
`;
}

type SeverityCounts = {
  errorCount: number;
  warningCount: number;
  severe: number;
  moderate: number;
  mild: number;
};

/** UNSERVED_SERVICE_PULSE 沒有 detail.severityBand，但代表完全無車承接，等同 severe（與前端排序提示一致）。 */
function countSeverities(snapshot: LastIssuesSnapshot): SeverityCounts {
  const items = snapshot.items ?? [];
  const counts: SeverityCounts = { errorCount: 0, warningCount: 0, severe: 0, moderate: 0, mild: 0 };
  for (const item of items) {
    if (item.severity === 'error') counts.errorCount += 1;
    else counts.warningCount += 1;
    const band = item.detail?.severityBand;
    if (band === 'severe' || item.code === 'UNSERVED_SERVICE_PULSE') counts.severe += 1;
    else if (band === 'moderate') counts.moderate += 1;
    else if (band === 'mild') counts.mild += 1;
  }
  return counts;
}

async function readPreviousSeverityCounts(jsonPath: string): Promise<SeverityCounts | null> {
  try {
    const raw = await fs.readFile(jsonPath, 'utf8');
    const prev = JSON.parse(raw) as LastIssuesSnapshot;
    return countSeverities(prev);
  } catch {
    return null;
  }
}

function fmtDelta(previous: number, current: number): string {
  const diff = current - previous;
  const sign = diff > 0 ? '+' : diff < 0 ? '' : '±';
  return `${previous}→${current}（${sign}${diff}）`;
}

function buildDeltaBanner(previous: SeverityCounts, current: SeverityCounts): string {
  return (
    `與上次生成相比：錯誤 ${fmtDelta(previous.errorCount, current.errorCount)}`
    + ` · 警告 ${fmtDelta(previous.warningCount, current.warningCount)}`
    + ` · severe ${fmtDelta(previous.severe, current.severe)}`
    + ` · moderate ${fmtDelta(previous.moderate, current.moderate)}`
    + ` · mild ${fmtDelta(previous.mild, current.mild)}`
  );
}

/** 在「每次重新生成整份覆寫」提示後插入一行 delta；找不到該錨點字串（雙端模板已漂移）就原樣放行，不強行破版。 */
function withDeltaBanner(html: string, previous: SeverityCounts | null, current: SeverityCounts): string {
  if (!previous) return html;
  const marker = '每次重新生成整份覆寫，不累加。機器可讀：<code>frontend/.dev/schedule-engine-last-issues.json</code></p>';
  if (!html.includes(marker)) return html;
  const banner = escapeHtml(buildDeltaBanner(previous, current));
  return html.replace(marker, `${marker}\n    <p class="meta delta">${banner}</p>`);
}

async function overwriteLastIssuesArtifacts(
  snapshot: LastIssuesSnapshot,
): Promise<{ jsonFile: string; htmlFile: string }> {
  const root = repoRootFromCwd();
  const jsonPath = path.join(
    root,
    'frontend',
    '.dev',
    'schedule-engine-last-issues.json',
  );
  await fs.mkdir(path.dirname(jsonPath), { recursive: true });

  // 覆寫前先讀舊快照算 delta；讀不到（首次生成／格式變了）就跳過比較，不擋主流程。
  const previousCounts = await readPreviousSeverityCounts(jsonPath);

  // standaloneHtml 可能很大；JSON 仍保留完整快照供機器讀取
  await fs.writeFile(jsonPath, JSON.stringify(snapshot, null, 2), 'utf8');

  const htmlPath = path.join(root, 'document', '排班引擎最近問題.html');
  const html =
    typeof snapshot.standaloneHtml === 'string' && snapshot.standaloneHtml.trim()
      ? snapshot.standaloneHtml
      : renderStandaloneIssuesHtml(snapshot);
  const htmlWithDelta = withDeltaBanner(html, previousCounts, countSeverities(snapshot));
  await fs.writeFile(htmlPath, htmlWithDelta, 'utf8');

  return {
    jsonFile: path.relative(root, jsonPath),
    htmlFile: path.relative(root, htmlPath),
  };
}

/**
 * 開發輔助：排班引擎每次生成寫 timestamp log，並覆寫最近一次問題分頁／JSON。
 */
@ApiTags('Dev Log')
@Controller('syncdrive-api/dev-log')
export class DevLogController {
  @Post('schedule-engine')
  @HttpCode(200)
  @ApiOperation({ summary: '寫入一次排班引擎生成 log（開發用）' })
  async writeScheduleEngineLog(
    @Body() body: { label?: string; payload?: unknown },
  ) {
    const dir = path.resolve(process.cwd(), 'logs', 'schedule-engine');
    await fs.mkdir(dir, { recursive: true });

    const fileName = `${timestampSlug(new Date())}-${sanitizeLabel(body?.label)}.json`;
    const filePath = path.join(dir, fileName);
    await fs.writeFile(
      filePath,
      JSON.stringify(body?.payload ?? body ?? {}, null, 2),
      'utf8',
    );

    let lastIssuesResult: { jsonFile: string; htmlFile: string } | null = null;
    const payload = body?.payload;
    if (
      payload
      && typeof payload === 'object'
      && payload !== null
      && 'lastIssues' in payload
      && (payload as { lastIssues?: unknown }).lastIssues
      && typeof (payload as { lastIssues: unknown }).lastIssues === 'object'
    ) {
      lastIssuesResult = await overwriteLastIssuesArtifacts(
        (payload as { lastIssues: LastIssuesSnapshot }).lastIssues,
      );
    }

    return {
      ok: true,
      file: path.relative(process.cwd(), filePath),
      lastIssues: lastIssuesResult,
    };
  }
}

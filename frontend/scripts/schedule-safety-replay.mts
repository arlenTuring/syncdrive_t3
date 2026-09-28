#!/usr/bin/env -S npx tsx
/**
 * 排班安全重播：照清單跑每一份輸入，每個案例一個子程序，父程序負責逾時、進度與結果。
 *
 * 為什麼要子程序：生成是同步運算，程序內的 setTimeout 打斷不了它；先前整批在同一個程序裡跑，
 * 一個案例卡住數小時，前面跑完的結果也看不到。現在每個案例開始、完成、失敗、逾時都立即寫進
 * status.json，個別案例出事不影響其他案例的結果。
 *
 * 清單（JSON，放在測試資料旁；班次名稱與時刻只出現在資料裡，不在程式裡）：
 *   {
 *     "cases": [
 *       {
 *         "name": "base",
 *         "input": "base-input.json",                    // 相對清單所在目錄
 *         "from": "另一個案例名稱",                        // 選填：沿用那個案例的輸入與變形，再疊加自己的
 *         "transforms": [{ "kind": "shift-minutes", "minutes": 30 }],
 *         "assumption": "路段時間為假設補值（來源…）",      // 選填：寫進結果，避免把假設當成正式資料
 *         "expect": "safe"
 *           或 { "outcomes": ["blocked"], "codes": ["MISSING_TRAVEL_TIME"], "reasons": ["missing-travel-time"] }
 *       }
 *     ]
 *   }
 *
 * 結果分類（子程序寫出）：safe、blocked、invalid-input、search-exhausted；父程序另判 timeout、crash。
 * 判定：
 * - expect=safe：分類必須是 safe（生成報告通過、沒有擋發布的問題、獨立重驗也通過）。
 * - expect 物件：分類必須在 outcomes 內，且 codes／reasons 列的每一項都要出現。
 *   逾時、崩潰、變形本身不正確，除非明寫在 outcomes，否則一律不算符合——不能拿來代替「成功擋下」。
 *
 * 用法：
 *   npx tsx scripts/schedule-safety-replay.mts <manifest.json> [--only a,b] [--timeout-ms 900000] [--out-dir dir]
 *
 * 不經過任何會存檔／部署班表的入口。
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReplayCaseSpec, ReplayCaseSummary, ReplayOutcome, ReplayTransform } from './schedule-safety-replay-case.mts';

type Expectation =
  | 'safe'
  | { outcomes: ReplayOutcome[]; codes?: string[]; reasons?: string[] };
type ManifestCase = {
  name: string;
  input?: string;
  from?: string;
  transforms?: ReplayTransform[];
  assumption?: string;
  expect: Expectation;
};
type Manifest = { cases: ManifestCase[] };

type Row = {
  name: string;
  expect: Expectation;
  outcome: ReplayOutcome;
  /** 測試是否符合預期 */
  matchesExpectation: boolean;
  /** 班表本身是否安全可發布 */
  publishSafe: boolean;
  mismatch: string[];
  elapsedMs: number;
  assumption?: string;
  summary: ReplayCaseSummary | null;
  caseDir: string;
};

const here = dirname(fileURLToPath(import.meta.url));
const caseScript = join(here, 'schedule-safety-replay-case.mts');

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? null : null;
};
const manifestPath = args[0];
if (!manifestPath || manifestPath.startsWith('--')) {
  console.error('用法：npx tsx scripts/schedule-safety-replay.mts <manifest.json> [--only a,b] [--timeout-ms 900000] [--out-dir dir]');
  process.exit(2);
}
const manifestDir = dirname(resolve(manifestPath));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Manifest;
const only = flag('only')?.split(',').map((name) => name.trim()).filter(Boolean) ?? null;
const timeoutMs = Number(flag('timeout-ms') ?? 900_000);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const outDir = resolve(flag('out-dir') ?? join(manifestDir, 'replay-runs', stamp));
mkdirSync(outDir, { recursive: true });

// ───────── 規格展開 ─────────

const byName = new Map(manifest.cases.map((item) => [item.name, item] as const));
function resolveSpec(item: ManifestCase, seen = new Set<string>()): ReplayCaseSpec {
  if (seen.has(item.name)) throw new Error(`案例 ${item.name} 的 from 形成循環`);
  seen.add(item.name);
  if (item.from) {
    const parent = byName.get(item.from);
    if (!parent) throw new Error(`案例 ${item.name} 的來源 ${item.from} 不在清單裡`);
    const base = resolveSpec(parent, seen);
    return { name: item.name, inputPath: base.inputPath, transforms: [...base.transforms, ...(item.transforms ?? [])] };
  }
  if (!item.input) throw new Error(`案例 ${item.name} 沒有 input 也沒有 from`);
  return { name: item.name, inputPath: resolve(manifestDir, item.input), transforms: item.transforms ?? [] };
}

function judge(expect: Expectation, outcome: ReplayOutcome, summary: ReplayCaseSummary | null): string[] {
  const mismatch: string[] = [];
  if (expect === 'safe') {
    if (outcome !== 'safe') mismatch.push(`預期安全通過，實際為 ${outcome}`);
    return mismatch;
  }
  if (!expect.outcomes.includes(outcome)) mismatch.push(`預期 ${expect.outcomes.join('／')}，實際為 ${outcome}`);
  const codes = new Set([
    ...Object.keys(summary?.blockingByCode ?? {}),
    ...Object.keys(summary?.recheckBlockingByCode ?? {}),
  ]);
  for (const code of expect.codes ?? []) if (!codes.has(code)) mismatch.push(`缺少預期的問題 ${code}`);
  for (const reason of expect.reasons ?? []) {
    if (!(summary?.reasons ?? []).includes(reason)) mismatch.push(`缺少預期的原因 ${reason}`);
  }
  return mismatch;
}

// ───────── 狀態檔 ─────────

type CaseStatus = {
  status: 'pending' | 'running' | 'done';
  startedAt?: string;
  finishedAt?: string;
  pid?: number;
  outcome?: ReplayOutcome;
  matchesExpectation?: boolean;
  publishSafe?: boolean;
};
const status: { manifest: string; outDir: string; timeoutMs: number; startedAt: string; cases: Record<string, CaseStatus> } = {
  manifest: resolve(manifestPath),
  outDir,
  timeoutMs,
  startedAt: new Date().toISOString(),
  cases: {},
};
const selected = manifest.cases.filter((item) => !only || only.includes(item.name));
if (only) {
  const unknown = only.filter((name) => !byName.has(name));
  if (unknown.length > 0) throw new Error(`清單裡沒有：${unknown.join('、')}`);
}
for (const item of selected) status.cases[item.name] = { status: 'pending' };
const writeStatus = () => writeFileSync(join(outDir, 'status.json'), JSON.stringify(status, null, 2));
const rows: Row[] = [];
const writeResults = () => writeFileSync(join(outDir, 'results.json'), JSON.stringify(rows, null, 2));
writeStatus();

// ───────── 執行 ─────────

let activeChild: ReturnType<typeof spawn> | null = null;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    activeChild?.kill('SIGKILL');
    process.exit(130);
  });
}

function runCase(item: ManifestCase): Promise<Row> {
  const spec = resolveSpec(item);
  const caseDir = join(outDir, item.name.replace(/[^\w.+-]/g, '_'));
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, 'spec.json'), JSON.stringify({ ...spec, assumption: item.assumption, expect: item.expect }, null, 2));
  const log = createWriteStream(join(caseDir, 'child.log'));
  const startedAt = Date.now();
  // 直接啟動 node（不經 npx 包一層），終止時才殺得到真正在算的那個程序
  const child = spawn(process.execPath, ['--import', 'tsx', caseScript, caseDir], {
    cwd: resolve(here, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeChild = child;
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  status.cases[item.name] = { status: 'running', startedAt: new Date(startedAt).toISOString(), pid: child.pid };
  writeStatus();
  console.error(`[${item.name}] 開始（PID ${child.pid}，逾時 ${Math.round(timeoutMs / 1000)} 秒）`);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);
  const heartbeat = setInterval(() => {
    console.error(`[${item.name}] 執行中 ${Math.round((Date.now() - startedAt) / 1000)} 秒`);
  }, 30_000);

  return new Promise((done) => {
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      activeChild = null;
      log.end();
      const elapsedMs = Date.now() - startedAt;
      const summaryPath = join(caseDir, 'summary.json');
      const summary = !timedOut && existsSync(summaryPath)
        ? JSON.parse(readFileSync(summaryPath, 'utf-8')) as ReplayCaseSummary
        : null;
      let outcome: ReplayOutcome;
      const extra: string[] = [];
      if (timedOut) {
        outcome = 'timeout';
        extra.push(`超過 ${Math.round(timeoutMs / 1000)} 秒，已終止`);
      } else if (!summary || code !== 0) {
        outcome = 'crash';
        const crashPath = join(caseDir, 'crash.txt');
        extra.push(existsSync(crashPath)
          ? `崩潰：${readFileSync(crashPath, 'utf-8').split('\n')[0]}`
          : `子程序結束碼 ${code ?? '—'}${signal ? `（${signal}）` : ''}，沒有結果檔`);
      } else {
        outcome = summary.outcome;
        if (summary.invalidInput?.length) extra.push(`變形不正確：${summary.invalidInput.slice(0, 3).join('；')}`);
      }
      const mismatch = [...judge(item.expect, outcome, summary), ...extra];
      const row: Row = {
        name: item.name,
        expect: item.expect,
        outcome,
        matchesExpectation: judge(item.expect, outcome, summary).length === 0,
        publishSafe: summary?.publishSafe ?? false,
        mismatch,
        elapsedMs,
        assumption: item.assumption,
        summary,
        caseDir,
      };
      status.cases[item.name] = {
        ...status.cases[item.name],
        status: 'done',
        finishedAt: new Date().toISOString(),
        outcome,
        matchesExpectation: row.matchesExpectation,
        publishSafe: row.publishSafe,
      };
      writeStatus();
      console.error(
        `[${item.name}] ${outcome}｜測試${row.matchesExpectation ? '符合' : '不符'}預期｜班表${row.publishSafe ? '安全' : '不可發布'}`
        + `｜${Math.round(elapsedMs / 1000)} 秒｜${JSON.stringify(summary?.blockingByCode ?? {})}`
        + (mismatch.length ? `｜${mismatch.join('；')}` : ''),
      );
      done(row);
    });
  });
}

for (const item of selected) {
  rows.push(await runCase(item));
  writeResults();
}

const expectLabel = (expect: Expectation) => expect === 'safe'
  ? 'safe'
  : `${expect.outcomes.join('/')}${expect.codes?.length ? ` [${expect.codes.join(',')}]` : ''}`;
console.log('\n| 案例 | 預期 | 結果分類 | 測試符合預期 | 班表安全通過 | 秒 | 擋發布問題 |');
console.log('|---|---|---|---|---|---:|---|');
for (const row of rows) {
  console.log(`| ${row.name}${row.assumption ? '（假設資料）' : ''} | ${expectLabel(row.expect)} | ${row.outcome} | ${row.matchesExpectation ? '是' : '否'} | ${row.publishSafe ? '是' : '否'} | ${Math.round(row.elapsedMs / 1000)} | ${JSON.stringify(row.summary?.blockingByCode ?? {})} |`);
}
console.log(`\n結果目錄：${outDir}`);
process.exit(rows.every((row) => row.matchesExpectation) ? 0 : 1);

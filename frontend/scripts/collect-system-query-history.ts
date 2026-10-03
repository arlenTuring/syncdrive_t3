/**
 * 從 git 歷史收集「系統內建查詢」每一版的指紋，寫進
 * src/features/dashboard/constants/systemQueryHistory.ts。
 *
 * 用途：載入舊儀表板時，判斷某個來源的 SQL 是不是系統某一版內建查詢的原文——是才換成
 * 目前版本；使用者自己改過的（指紋對不上）一律不動。
 *
 * 用法（在 frontend 目錄）：npx tsx scripts/collect-system-query-history.ts
 * 改了 demoSql.ts 裡這幾個查詢並提交之後要重跑一次，把舊版加進歷史。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sqlFingerprint } from '../src/features/dashboard/utils/sqlFingerprint.ts';
import { SYSTEM_QUERY_FAMILIES } from '../src/features/dashboard/constants/systemQueryFamilies.ts';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const file = 'frontend/src/features/dashboard/constants/demoSql.ts';
const commits = execFileSync('git', ['log', 'HEAD', '--remotes=origin', '--format=%H %cs', '--', file], { cwd: repoRoot, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [sha, date] = line.split(' ');
    return { sha, date };
  });

const work = mkdtempSync(join(tmpdir(), 'sysq-'));
const entries = new Map<string, { family: string; fingerprint: string; firstSeen: string; commit: string }>();

for (const { sha, date } of commits.reverse()) {
  const source = execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot, encoding: 'utf8' });
  const path = join(work, `demoSql_${sha}.ts`);
  writeFileSync(path, source);
  let mod: Record<string, unknown>;
  try {
    mod = await import(path);
  } catch (err) {
    console.warn(`略過 ${sha.slice(0, 7)}：${(err as Error).message}`);
    continue;
  }
  for (const family of SYSTEM_QUERY_FAMILIES) {
    const sql = mod[family.constantName];
    if (typeof sql !== 'string' || !sql.trim()) continue;
    const fingerprint = sqlFingerprint(sql);
    const key = `${family.id}:${fingerprint}`;
    if (!entries.has(key)) entries.set(key, { family: family.id, fingerprint, firstSeen: date, commit: sha.slice(0, 7) });
  }
}

const rows = [...entries.values()].sort((a, b) => a.family.localeCompare(b.family) || a.firstSeen.localeCompare(b.firstSeen));
const out = `/* 由 scripts/collect-system-query-history.ts 產生，請勿手改。 */
/**
 * 系統內建查詢在 git 歷史裡出現過的每一版（指紋見 utils/sqlFingerprint.ts）。
 * 使用中的版面若某個來源的 SQL 指紋在這裡，代表它是系統某一版的原文，可以安全換成目前版本。
 */
export const SYSTEM_QUERY_HISTORY: ReadonlyArray<{ family: string; fingerprint: string; firstSeen: string; commit: string }> = ${JSON.stringify(rows, null, 2)};
`;
const target = resolve(repoRoot, 'frontend/src/features/dashboard/constants/systemQueryHistory.ts');
writeFileSync(target, out);
console.log(`寫入 ${rows.length} 筆歷史版本 → ${target}`);

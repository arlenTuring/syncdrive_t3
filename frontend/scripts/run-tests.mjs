#!/usr/bin/env node
/**
 * 跑完整套測試。
 *
 * 專案裡有兩種測試寫法：node:test 與 vitest。兩邊的 describe／it 長得一樣，但
 * runner 不同——混在一起跑，被錯配的那一批會報「No test suite found」，看起來像
 * 測試壞了，其實只是拿錯工具。
 *
 * 分流看檔案自己 import 誰，不看目錄或檔名。新加的測試寫哪一種就被哪一個 runner
 * 收走，不必記規則，也不會因為放錯目錄而靜靜地不被執行——那正是這 20 支 vitest
 * 測試從來沒跑過的原因。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/** Node 20 的 fs 還沒有 globSync，自己走一遍目錄 */
function specFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...specFiles(full))
    else if (/\.spec\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = specFiles('src').sort()
const vitest = []
const nodeTest = []
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  if (/from ['"]vitest['"]/.test(source)) vitest.push(file)
  else if (/from ['"]node:test['"]/.test(source)) nodeTest.push(file)
}

console.log(`node:test ${nodeTest.length} 支、vitest ${vitest.length} 支`)

let failed = false
if (nodeTest.length > 0) {
  const r = spawnSync('npx', ['tsx', '--test', ...nodeTest], { stdio: 'inherit' })
  if (r.status !== 0) failed = true
}
if (vitest.length > 0) {
  const r = spawnSync('npx', ['vitest', 'run', ...vitest], { stdio: 'inherit' })
  if (r.status !== 0) failed = true
}
process.exit(failed ? 1 : 0)

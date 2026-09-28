#!/usr/bin/env -S npx tsx
/**
 * 排班引擎決策追蹤：跑一份輸入，把引擎各階段的決策（engineTrace）與最終阻擋問題寫成 JSONL，
 * 用來比對兩份輸入（例如原始與改名）第一個不同的決策。
 *
 * 用法：
 *   npx tsx scripts/trace-schedule-engine.mts <engine-input.json> --out <trace.jsonl> [--result <result.json>]
 *
 * 不經過任何會存檔／部署班表的入口。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateShiftSchedule } from '../src/features/shift-list/utils/schedule-engine/generate';
import type { GenerateShiftScheduleInput } from '../src/features/shift-list/utils/schedule-engine/generate';
import { setEngineTraceSink, type EngineTraceEvent } from '../src/features/shift-list/utils/schedule-engine/engineTrace';
import { PUBLISH_BLOCKING_CODES } from '../src/features/shift-list/utils/scheduleAcceptance';

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? null : null;
};
const inputPath = args[0];
const outPath = flag('out');
if (!inputPath || !outPath) {
  console.error('用法：npx tsx scripts/trace-schedule-engine.mts <engine-input.json> --out <trace.jsonl> [--result <result.json>]');
  process.exit(1);
}

const input = JSON.parse(readFileSync(inputPath, 'utf-8')) as GenerateShiftScheduleInput;
const events: EngineTraceEvent[] = [];
const traceStartedAt = Date.now();
setEngineTraceSink((event) => events.push({ ...structuredClone(event), atMs: Date.now() - traceStartedAt }));
const startedAt = Date.now();
const result = generateShiftSchedule(input);
setEngineTraceSink(null);

const blocking = [...result.report.errors, ...result.report.warnings]
  .filter((issue) => issue.severity === 'error' || PUBLISH_BLOCKING_CODES.has(issue.code));
events.push({
  stage: 'final',
  elapsedMs: Date.now() - startedAt,
  ok: result.report.ok,
  blocking: blocking.map((issue) => ({ code: issue.code, message: issue.message, detail: issue.detail })),
});
writeFileSync(outPath, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
const resultPath = flag('result');
if (resultPath) writeFileSync(resultPath, JSON.stringify(result));
console.error(`${events.length} 筆追蹤，阻擋 ${blocking.length} 筆：${blocking.map((issue) => issue.code).join('、') || '無'}`);

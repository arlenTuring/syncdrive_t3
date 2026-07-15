#!/usr/bin/env node
/** 刪除 Agent 驗收產生的 .dev/verify/ 截圖與 report.json */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '.dev/verify');

if (fs.existsSync(OUT)) {
  fs.rmSync(OUT, { recursive: true, force: true });
}
console.log('已清理 .dev/verify/');

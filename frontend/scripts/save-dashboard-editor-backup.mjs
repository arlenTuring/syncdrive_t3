#!/usr/bin/env node
/**
 * 從本機 Chrome 完整備份儀表板編輯器（不覆寫 demoPlane.snapshot.json）。
 * 實作：capture-chrome-dashboard-backup.mjs
 *
 * 用法：node scripts/save-dashboard-editor-backup.mjs [label] [url]
 */
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const label = process.argv[2] ?? 'user-tuned';
const url = process.argv[3] ?? 'http://localhost:5173/';
const script = resolve(__dirname, 'capture-chrome-dashboard-backup.mjs');

const result = spawnSync(process.execPath, [script, label, url], { stdio: 'inherit' });
process.exit(result.status ?? 1);

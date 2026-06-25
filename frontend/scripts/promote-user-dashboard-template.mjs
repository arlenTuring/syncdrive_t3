#!/usr/bin/env node
/**
 * 將使用者匯出的儀表板樣板設為內建 snapshot（保留版面座標，不從 demoPlane.ts 程式重建）。
 *
 * 用法：
 *   node scripts/promote-user-dashboard-template.mjs <template.json> [layoutVersion]
 *
 * 範例：
 *   node scripts/promote-user-dashboard-template.mjs \
 *     "/path/SyncDrive-總控大屏-3840-1080-dashboard-template-2026-06-21_113617.json" 113
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const constantsDir = resolve(__dirname, '../src/features/dashboard/constants');
const backupsDir = resolve(constantsDir, 'backups');
const templatesDir = resolve(__dirname, '../public/dashboard-templates');

const inPath = resolve(process.argv[2] ?? '');
const layoutVersion = Number(process.argv[3] ?? 113);

if (!inPath || !existsSync(inPath)) {
  console.error('用法: node scripts/promote-user-dashboard-template.mjs <template.json> [layoutVersion]');
  process.exit(1);
}

const parsed = JSON.parse(readFileSync(inPath, 'utf8'));
const plane = Array.isArray(parsed)
  ? (parsed.find((p) => p.id === 'demo-plane') ?? parsed[0])
  : parsed.plane ?? parsed;

if (!plane?.elements?.length) {
  console.error('無效的樣板（缺少 plane.elements）');
  process.exit(1);
}

const snapshotOut = resolve(constantsDir, 'demoPlane.snapshot.json');
const masterTemplateOut = resolve(templatesDir, 'syncdrive-master-dashboard-3840x1080.json');

if (existsSync(snapshotOut)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const preserved = resolve(backupsDir, `demoPlane.snapshot.before-promote-${stamp}.json`);
  copyFileSync(snapshotOut, preserved);
  console.log(`已備份現有 snapshot → ${preserved}`);
}

const now = Date.now();
const planeToWrite = {
  ...plane,
  id: 'demo-plane',
  demoLayoutVersion: layoutVersion,
  createdAt: plane.createdAt ?? now,
  updatedAt: now,
};

writeFileSync(snapshotOut, JSON.stringify(planeToWrite, null, 2), 'utf8');
console.log(`已寫入 ${snapshotOut}`);
console.log(`  elements: ${planeToWrite.elements.length}, version: ${layoutVersion}`);
console.log(`  首個畫布: ${planeToWrite.elements[0]?.label} @ (${planeToWrite.elements[0]?.x}, ${planeToWrite.elements[0]?.y})`);

if (parsed.kind === 'syncdrive-dashboard-template') {
  const templateToWrite = {
    ...parsed,
    plane: {
      ...parsed.plane,
      id: 'demo-plane',
      demoLayoutVersion: layoutVersion,
      updatedAt: now,
    },
  };
  writeFileSync(masterTemplateOut, JSON.stringify(templateToWrite, null, 2), 'utf8');
  console.log(`已同步樣板 ${masterTemplateOut}`);
} else {
  console.log('輸入非完整樣板格式，略過 public/dashboard-templates 同步');
}

console.log('完成。版面以樣板為準；SQL／資料綁定由 patchDashboardRuntimeFixes 於執行期套用。');

#!/usr/bin/env node
/**
 * 將備份還原為專案內建預設（保留 backups/ 原始檔，不刪除 preserved 副本）。
 *
 * 用法：node scripts/restore-dashboard-editor-backup.mjs [backup-base-name]
 * 預設：dashboard-editor-backup-2026-06-14-user-tuned
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const constantsDir = resolve(__dirname, '../src/features/dashboard/constants');
const backupsDir = resolve(constantsDir, 'backups');
const templatesDir = resolve(__dirname, '../public/dashboard-templates');
const vehicleConstantsDir = resolve(__dirname, '../src/features/vehicle-editor/constants');

const backupBase = process.argv[2] ?? 'dashboard-editor-backup-2026-06-14-user-tuned';
const demoPlaneSrc = resolve(backupsDir, `${backupBase}.demo-plane.json`);
const fullSrc = resolve(backupsDir, `${backupBase}.full.json`);
const templateSrc = resolve(templatesDir, `${backupBase}.template.json`);
const vehiclesSrc = resolve(backupsDir, `${backupBase}.vehicles.json`);

const snapshotOut = resolve(constantsDir, 'demoPlane.snapshot.json');
const masterTemplateOut = resolve(templatesDir, 'syncdrive-master-dashboard-3840x1080.json');
const vehicleSnapshotOut = resolve(vehicleConstantsDir, 'vehicleDefinitions.snapshot.json');

function requireFile(path) {
  if (!existsSync(path)) {
    console.error(`找不到備份檔：${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

requireFile(demoPlaneSrc);
const demoPlane = requireFile(demoPlaneSrc);
const template = existsSync(templateSrc) ? requireFile(templateSrc) : null;
const vehiclesBackup = existsSync(vehiclesSrc) ? requireFile(vehiclesSrc) : null;
const fullBackup = existsSync(fullSrc) ? requireFile(fullSrc) : null;

// 還原前再保險複製一份目前 snapshot
if (existsSync(snapshotOut)) {
  const stamp = new Date().toISOString().slice(0, 10);
  const preserved = resolve(backupsDir, `demoPlane.snapshot.before-restore-${stamp}.json`);
  copyFileSync(snapshotOut, preserved);
  console.log(`已保留還原前快照：${preserved}`);
}

const planeToWrite = {
  ...demoPlane,
  id: 'demo-plane',
  updatedAt: Date.now(),
};

writeFileSync(snapshotOut, JSON.stringify(planeToWrite, null, 2), 'utf8');
console.log(`已還原 demoPlane.snapshot.json（${planeToWrite.elements?.length ?? 0} 畫布, v${planeToWrite.demoLayoutVersion ?? '?'})`);

if (template) {
  writeFileSync(masterTemplateOut, JSON.stringify(template, null, 2), 'utf8');
  console.log(`已還原樣板：${masterTemplateOut}`);
}

if (vehiclesBackup?.vehicles?.length) {
  writeFileSync(
    vehicleSnapshotOut,
    JSON.stringify(vehiclesBackup.vehicles, null, 2),
    'utf8',
  );
  console.log(`已還原載具定義快照：${vehicleSnapshotOut}（${vehiclesBackup.vehicles.length} 筆）`);
}

if (fullBackup?.storage) {
  const seedOut = resolve(templatesDir, 'dashboard-localStorage-seed.json');
  writeFileSync(seedOut, JSON.stringify(fullBackup.storage, null, 2), 'utf8');
  console.log(`已寫入 localStorage 種子：${seedOut}`);
}

console.log('還原完成。請重新整理瀏覽器或執行 inject 腳本套用 localStorage。');

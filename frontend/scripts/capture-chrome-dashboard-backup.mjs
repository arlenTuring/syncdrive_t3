#!/usr/bin/env node
/**
 * 從本機 Chrome（Default profile）讀取儀表板 localStorage 並寫入版本化備份。
 * 不覆寫 demoPlane.snapshot.json。
 *
 * 用法：node scripts/capture-chrome-dashboard-backup.mjs [label]
 * 注意：執行時請關閉 Chrome，避免 profile 鎖定。
 */
import { chromium } from 'playwright';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir, tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const constantsDir = resolve(__dirname, '../src/features/dashboard/constants');
const backupsDir = resolve(constantsDir, 'backups');
const templatesDir = resolve(__dirname, '../public/dashboard-templates');
const snapshotPath = resolve(constantsDir, 'demoPlane.snapshot.json');

const chromeDefault = resolve(homedir(), 'Library/Application Support/Google/Chrome/Default');
const url = process.argv[3] ?? 'http://localhost:5173/';
const label = (process.argv[2] ?? 'user-tuned').replace(/[^a-zA-Z0-9_-]/g, '-');
const stamp = new Date().toISOString().slice(0, 10);
const backupBase = `dashboard-editor-backup-${stamp}-${label}`;

const STORAGE_KEYS = [
  'syncdrive_dashboard_planes',
  'syncdrive_dashboard_layout_seed',
  'syncdrive_datasources',
  'syncdrive_vehicle_definitions',
  'syncdrive-map-library-v1',
];

function collectReferencedDataSources(plane, allSources) {
  const needed = new Set();
  for (const el of plane.elements ?? []) {
    if (el.dataSourceId) needed.add(el.dataSourceId);
    for (const child of el.children ?? []) {
      if (child.dataSourceId) needed.add(child.dataSourceId);
      if (child.mqttDataSourceId) needed.add(child.mqttDataSourceId);
    }
  }
  return (allSources ?? []).filter((ds) => needed.has(ds.id));
}

async function readStorage(page) {
  return page.evaluate((keys) => {
    const out = {};
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) {
        out[key] = null;
        continue;
      }
      try {
        out[key] = JSON.parse(raw);
      } catch {
        out[key] = raw;
      }
    }
    return out;
  }, STORAGE_KEYS);
}

let context;
let tempProfileDir = null;
try {
  tempProfileDir = mkdtempSync(resolve(tmpdir(), 'syncdrive-chrome-backup-'));
  const tempDefault = resolve(tempProfileDir, 'Default');
  mkdirSync(resolve(tempDefault, 'Local Storage'), { recursive: true });
  cpSync(
    resolve(chromeDefault, 'Local Storage/leveldb'),
    resolve(tempDefault, 'Local Storage/leveldb'),
    { recursive: true },
  );

  context = await chromium.launchPersistentContext(tempProfileDir, {
    channel: 'chrome',
    headless: true,
    args: [
      '--profile-directory=Default',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
    ],
  });
} catch (err) {
  if (tempProfileDir) rmSync(tempProfileDir, { recursive: true, force: true });
  console.error('無法讀取 Chrome localStorage 備份：', err?.message ?? err);
  process.exit(1);
}

try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const storage = await readStorage(page);
  const planes = storage['syncdrive_dashboard_planes'];

  if (!Array.isArray(planes) || planes.length === 0) {
    console.error('Chrome localStorage 無 syncdrive_dashboard_planes');
    console.error('請確認：1) 曾用 Chrome 開啟並儲存儀表板  2) URL 正確', url);
    process.exit(1);
  }

  const demoPlane = planes.find((p) => p.id === 'demo-plane') ?? planes[0];
  const dataSources = storage['syncdrive_datasources'] ?? [];
  const exportedAt = new Date().toISOString();

  const fullBackup = {
    kind: 'syncdrive-dashboard-editor-backup',
    version: 1,
    exportedAt,
    label,
    source: 'chrome-default-localStorage',
    storage,
    summary: {
      planeCount: planes.length,
      demoPlaneName: demoPlane.name,
      demoElementCount: demoPlane.elements?.length ?? 0,
      demoLayoutVersion: demoPlane.demoLayoutVersion,
      vehicleDefinitionCount: storage['syncdrive_vehicle_definitions']?.length ?? 0,
      dataSourceCount: dataSources.length,
      mapLibraryCount: storage['syncdrive-map-library-v1']?.length ?? 0,
    },
  };

  const { id: _id, createdAt: _c, updatedAt: _u, ...planeBody } = demoPlane;
  const templateFile = {
    kind: 'syncdrive-dashboard-template',
    version: 1,
    exportedAt,
    meta: {
      name: demoPlane.name ?? 'Dashboard backup',
      description: `User backup (${label}) — do not auto-restore`,
    },
    dataSources: collectReferencedDataSources(demoPlane, dataSources),
    plane: planeBody,
  };

  const vehicleBackup = {
    kind: 'syncdrive-vehicle-definitions-backup',
    version: 1,
    exportedAt,
    label,
    vehicles: storage['syncdrive_vehicle_definitions'] ?? [],
  };

  mkdirSync(backupsDir, { recursive: true });
  mkdirSync(templatesDir, { recursive: true });

  const fullBackupPath = resolve(backupsDir, `${backupBase}.full.json`);
  const templatePath = resolve(templatesDir, `${backupBase}.template.json`);
  const planeSnapshotPath = resolve(backupsDir, `${backupBase}.demo-plane.json`);
  const vehiclePath = resolve(backupsDir, `${backupBase}.vehicles.json`);
  const preservedSnapshotPath = resolve(backupsDir, `demoPlane.snapshot.preserved-${stamp}.json`);

  writeFileSync(fullBackupPath, JSON.stringify(fullBackup, null, 2), 'utf8');
  writeFileSync(templatePath, JSON.stringify(templateFile, null, 2), 'utf8');
  writeFileSync(planeSnapshotPath, JSON.stringify(demoPlane, null, 2), 'utf8');
  writeFileSync(vehiclePath, JSON.stringify(vehicleBackup, null, 2), 'utf8');

  if (readFileSync(snapshotPath, 'utf8')) {
    copyFileSync(snapshotPath, preservedSnapshotPath);
  }

  console.log('Dashboard editor backup saved (existing files NOT overwritten):');
  console.log(`  full:      ${fullBackupPath}`);
  console.log(`  template:  ${templatePath}`);
  console.log(`  demoPlane: ${planeSnapshotPath}`);
  console.log(`  vehicles:  ${vehiclePath}`);
  console.log(`  preserved: ${preservedSnapshotPath}`);
  console.log(
    `  summary: ${fullBackup.summary.planeCount} plane(s), `
      + `${fullBackup.summary.demoElementCount} elements, `
      + `v${fullBackup.summary.demoLayoutVersion ?? '?'}, `
      + `${fullBackup.summary.vehicleDefinitionCount} vehicle defs`,
  );
} finally {
  await context.close();
  if (tempProfileDir) rmSync(tempProfileDir, { recursive: true, force: true });
}

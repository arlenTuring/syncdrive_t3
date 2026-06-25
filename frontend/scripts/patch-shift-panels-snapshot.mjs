#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatePaths = [
  resolve(__dirname, '../src/features/dashboard/constants/demoPlane.snapshot.json'),
  resolve(__dirname, '../public/dashboard-templates/syncdrive-master-dashboard-3840x1080.json'),
  resolve(__dirname, '../public/dashboard-templates/dashboard-localStorage-seed.json'),
  resolve(__dirname, '../public/dashboard-templates/dashboard-editor-backup-2026-06-14-user-tuned.template.json'),
];
const sqlPath = resolve(__dirname, '../src/features/dashboard/constants/demoSql.ts');

const DAY_MS = `(EXTRACT(EPOCH FROM (NOW() - INTERVAL '7 days')) * 1000)::bigint`;
const SHIFT_ROSTER_REFRESH_INTERVAL = 15;

const sqlSource = readFileSync(sqlPath, 'utf8');
function extractSql(name) {
  const match = sqlSource.match(new RegExp(`export const ${name} = \`([\\s\\S]*?)\`\\.trim\\(\\)`));
  if (!match) throw new Error(`無法解析 ${name}`);
  return match[1].trim().replace(/\$\{DAY_MS\}/g, DAY_MS);
}

const MAINLINE_SHIFTS_SQL = extractSql('MAINLINE_SHIFTS_SQL');
const MAINTENANCE_SHIFTS_SQL = extractSql('MAINTENANCE_SHIFTS_SQL');

function patchPlane(plane) {
  if (!plane || typeof plane !== 'object') return false;
  let changed = false;
  for (const el of plane.elements ?? []) {
    if (el.label === '正線班次' && el.isGroup) {
      el.sqlQuery = MAINLINE_SHIFTS_SQL;
      el.refreshInterval = SHIFT_ROSTER_REFRESH_INTERVAL;
      changed = true;
    }
    if (el.label === '整備班表' && el.isGroup) {
      el.sqlQuery = MAINTENANCE_SHIFTS_SQL;
      el.refreshInterval = SHIFT_ROSTER_REFRESH_INTERVAL;
      changed = true;
    }
  }
  if (changed) {
    plane.demoLayoutVersion = Math.max(plane.demoLayoutVersion ?? 0, 112);
  }
  return changed;
}

function patchDocument(doc) {
  let changed = false;
  changed = patchPlane(doc) || changed;
  changed = patchPlane(doc?.plane) || changed;
  for (const plane of doc?.syncdrive_dashboard_planes ?? []) {
    changed = patchPlane(plane) || changed;
  }
  return changed;
}

for (const targetPath of templatePaths) {
  const doc = JSON.parse(readFileSync(targetPath, 'utf8'));
  const changed = patchDocument(doc);
  if (changed) {
    writeFileSync(targetPath, JSON.stringify(doc, null, 2), 'utf8');
  }
  console.log(`${changed ? '已更新' : '無需更新'} ${targetPath}`);
}

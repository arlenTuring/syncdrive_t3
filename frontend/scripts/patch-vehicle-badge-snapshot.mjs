#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(__dirname, '../src/features/dashboard/constants/demoPlane.snapshot.json');
const sqlPath = resolve(__dirname, '../src/features/dashboard/constants/demoSql.ts');

const sqlSource = readFileSync(sqlPath, 'utf8');
const match = sqlSource.match(/export const VEHICLE_STATUS_ROW_SQL = `([\s\S]*?)`\.trim\(\)/);
if (!match) {
  console.error('無法解析 VEHICLE_STATUS_ROW_SQL');
  process.exit(1);
}
const VEHICLE_STATUS_ROW_SQL = match[1].trim();

const plane = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const el = plane.elements.find((e) => e.label === '車輛狀態' && e.isGroup);
if (!el) {
  console.error('找不到車輛狀態群組');
  process.exit(1);
}

el.sqlQuery = VEHICLE_STATUS_ROW_SQL;
for (const child of el.children ?? []) {
  if (child.type !== 'status-badge') continue;
  const field = String(child.valueField ?? '');
  if (!field.includes('badge_label') && !field.includes('trip_code')) continue;
  child.mqttDataSourceId = child.mqttDataSourceId ?? 'default-mqtt';
  child.mqttTopic = child.mqttTopic ?? 'v1/vtms/${vehicle_code}/operation/update';
  if (child.defaultLabel === '—' || child.defaultLabel === '-') child.defaultLabel = '';
}

writeFileSync(snapshotPath, JSON.stringify(plane, null, 2), 'utf8');
console.log('已更新 demoPlane.snapshot.json（車輛狀態 SQL + 徽章 MQTT）');

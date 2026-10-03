import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cloneDemoPlane } from '../constants/demoPlane';
import { MAINTENANCE_SHIFTS_SQL, VEHICLE_STATUS_ROW_SQL } from '../constants/demoSql';
import { patchDashboardRuntimeFixes } from './migrateVehicleMonitorProtocol';

/** 2026-09-24 遷移前備份裡存的整備查詢＝系統當時版本的原文 */
const backup = JSON.parse(readFileSync(new URL('../../../../../document/backups/SyncDrive總控大屏-遷移前備份.json', import.meta.url), 'utf8'));
const OLD_MAINTENANCE_SQL: string = backup.elements.find((el: { label: string }) => el.label === '整備班表').sqlQuery;

describe('dashboard saved-source migration', () => {
  it('upgrades stale built-in sources without changing layout and is idempotent', () => {
    const plane = cloneDemoPlane();
    const maintenance = plane.elements.find((element) => element.label === '整備班表')!;
    const vehicle = plane.elements.find((element) => element.label === '車輛狀態')!;
    const layout = {
      maintenance: [maintenance.x, maintenance.y, maintenance.width, maintenance.height],
      vehicle: [vehicle.x, vehicle.y, vehicle.width, vehicle.height],
    };
    maintenance.sqlQuery = OLD_MAINTENANCE_SQL;
    vehicle.sqlQuery = "SELECT COALESCE(m.overall_health, 'OK') FROM deployed";

    const once = patchDashboardRuntimeFixes(plane);
    const twice = patchDashboardRuntimeFixes(once);
    const nextMaintenance = once.elements.find((element) => element.label === '整備班表')!;
    const nextVehicle = once.elements.find((element) => element.label === '車輛狀態')!;

    expect(nextMaintenance.sqlQuery).toBe(MAINTENANCE_SHIFTS_SQL);
    expect(nextVehicle.sqlQuery).toBe(VEHICLE_STATUS_ROW_SQL);
    expect([nextMaintenance.x, nextMaintenance.y, nextMaintenance.width, nextMaintenance.height]).toEqual(layout.maintenance);
    expect([nextVehicle.x, nextVehicle.y, nextVehicle.width, nextVehicle.height]).toEqual(layout.vehicle);
    expect(twice).toEqual(once);
  });

  it('keeps a maintenance query that is not a known system version (user edited)', () => {
    const plane = cloneDemoPlane();
    const maintenance = plane.elements.find((element) => element.label === '整備班表')!;
    const custom = "SELECT 'PMS' || LPAD(row_no, 2, '0'), '進行中' AS status_label FROM current_blocks";
    maintenance.sqlQuery = custom;
    const next = patchDashboardRuntimeFixes(plane).elements.find((element) => element.label === '整備班表')!;
    expect(next.sqlQuery).toBe(custom);
  });
});

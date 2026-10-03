import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { CanvasElementProps, DashboardPlane } from '../types';
import { MAINLINE_SHIFTS_SQL, MAINTENANCE_SHIFTS_SQL } from '../constants/demoSql';
import { auditSystemQueries, classifySql, systemQueryOrKeep, upgradeSystemQueries } from './systemQueries';
import { migratePlane } from './migrateDashboardPlane';

/** 2026-09-24 遷移前備份：正線／整備兩個群組存的就是當時的系統查詢原文 */
const backup = JSON.parse(readFileSync(new URL('../../../../../document/backups/SyncDrive總控大屏-遷移前備份.json', import.meta.url), 'utf8'));
const OLD_MAINTENANCE_SQL: string = backup.elements.find((el: { label: string }) => el.label === '整備班表').sqlQuery;
const OLD_MAINLINE_SQL: string = backup.elements.find((el: { label: string }) => el.label === '正線班次').sqlQuery;

/** 合併成泛用群組之後的樣子：舊查詢藏在 genericGroup.sources[] 裡，外層群組名稱也不是「整備班表」 */
function planeWithGroupSources(sources: Array<{ id: string; sqlQuery: string }>): DashboardPlane {
  const group = {
    id: 'g1', type: 'canvas', label: '任意名稱的群組', isGroup: true, children: [],
    x: 0, y: 0, width: 100, height: 100, backgroundColor: '', backgroundImage: '', opacity: 100,
    genericGroup: { enabled: true, sources: sources.map((s) => ({ ...s, label: s.id, dataSourceId: 'default-internal' })) },
  } as unknown as CanvasElementProps;
  return { id: 'p1', name: '測試', width: 100, height: 100, elements: [group], createdAt: 0, updatedAt: 0 };
}

describe('系統內建查詢升級：只換系統原文，不碰使用者改過的', () => {
  it('備份裡的整備／正線查詢被認成系統舊版', () => {
    assert.equal(classifySql(OLD_MAINTENANCE_SQL).kind, 'outdated-system');
    assert.equal(classifySql(OLD_MAINLINE_SQL).kind, 'outdated-system');
    assert.equal(classifySql(MAINTENANCE_SHIFTS_SQL).kind, 'current');
  });

  it('泛用群組內部來源（不看群組名稱、不看來源 ID）的舊查詢換成目前版本，其他欄位不動', () => {
    const plane = planeWithGroupSources([{ id: 'whatever', sqlQuery: OLD_MAINTENANCE_SQL }]);
    const { plane: next, changes } = upgradeSystemQueries(plane);
    const source = next.elements[0].genericGroup!.sources![0];
    assert.equal(source.sqlQuery, MAINTENANCE_SHIFTS_SQL);
    assert.equal(source.id, 'whatever');
    assert.equal(source.dataSourceId, 'default-internal');
    assert.equal(changes.length, 1);
    assert.match(changes[0].location, /來源「whatever」/);
  });

  it('使用者改過一個字的舊查詢：不覆寫，列為無法確認', () => {
    const edited = OLD_MAINTENANCE_SQL.replace("'進行中' AS status_label", "'執行中' AS status_label");
    const plane = planeWithGroupSources([{ id: 'm', sqlQuery: edited }]);
    const { plane: next, changes, unconfirmed } = upgradeSystemQueries(plane);
    assert.equal(next.elements[0].genericGroup!.sources![0].sqlQuery, edited);
    assert.equal(changes.length, 0);
    assert.equal(unconfirmed.length, 1);
  });

  it('使用者自己寫的查詢完全不動', () => {
    const custom = 'SELECT order_id AS shift_key FROM operation_orders WHERE line_kind = \'MAINTENANCE\'';
    const plane = planeWithGroupSources([{ id: 'c', sqlQuery: custom }]);
    assert.equal(upgradeSystemQueries(plane).plane, plane);
    assert.equal(systemQueryOrKeep(custom, 'maintenance-shifts'), custom);
  });

  it('可以重複執行：第二次不再變', () => {
    const plane = planeWithGroupSources([
      { id: 'a', sqlQuery: OLD_MAINLINE_SQL },
      { id: 'b', sqlQuery: OLD_MAINTENANCE_SQL },
    ]);
    const once = upgradeSystemQueries(plane);
    const twice = upgradeSystemQueries(once.plane);
    assert.equal(once.changes.length, 2);
    assert.equal(twice.changes.length, 0);
    assert.equal(twice.plane, once.plane);
    assert.deepEqual(auditSystemQueries(twice.plane).map((row) => row.verdict), ['current', 'current']);
  });

  it('載入版面時（migratePlane）就會升級泛用群組內部來源', () => {
    const plane = planeWithGroupSources([{ id: 'maintenance', sqlQuery: OLD_MAINTENANCE_SQL }]);
    const migrated = migratePlane(plane);
    assert.equal(migrated.elements[0].genericGroup!.sources![0].sqlQuery, MAINTENANCE_SHIFTS_SQL);
    assert.equal(MAINLINE_SHIFTS_SQL.includes('operation_shifts'), false, '正線／過渡名冊不從班表補列');
    assert.equal(MAINTENANCE_SHIFTS_SQL.includes('operation_shifts'), false, '整備名冊不從班表補列');
  });
});

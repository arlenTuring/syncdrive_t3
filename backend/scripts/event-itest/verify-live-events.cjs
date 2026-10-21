// 事件整合測試：事件管理清單的 pending／confirmed 集合、必填確認緣由、資料清理保護待確認事件。
//
//   EVENT_ITEST_ALLOW=1 EVENT_ITEST_ENV=backend/.env node backend/scripts/event-itest/verify-live-events.cjs
//
// 只建立並刪除自己標記的事件（車號 ITESTLV／ITESTRT、event_id 前綴 ITEST-LIVE-）與其確認稽核。
// 資料庫內原有事件會一起出現在工作集合，所以計數一律比對「插入前後的差值」。
const path = require('path');
if (process.env.EVENT_ITEST_ALLOW !== '1') {
  console.error('此測試會建立並刪除測試資料，只在測試環境執行；確認後設定 EVENT_ITEST_ALLOW=1');
  process.exit(2);
}
if (process.env.EVENT_ITEST_ENV) {
  require('dotenv').config({ path: path.resolve(process.env.EVENT_ITEST_ENV), quiet: true });
  process.chdir(path.dirname(path.resolve(process.env.EVENT_ITEST_ENV)));
}
const D = process.env.EVENT_ITEST_DIST ? path.resolve(process.env.EVENT_ITEST_DIST) : path.join(__dirname, '../../dist');
const { DataSource } = require('typeorm');
const { EventsService } = require(D + '/event-log/events.service.js');
const { AuditService } = require(D + '/audit/audit.service.js');
const { DataRetentionService } = require(D + '/data-admin/data-retention.service.js');
const { OperatorActionLog } = require(D + '/database/entities/operator-action-log.entity.js');

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${c ? '' : ' ' + extra}`); };
const rejects = async (p, re) => p.then(() => 'ok', (e) => (re.test(`${e.message} ${JSON.stringify(e.getResponse?.() ?? '')}`) ? true : `${e.message}`));
const HOUR = 3_600_000;

(async () => {
  const ds = new DataSource({ type: 'postgres', host: process.env.DB_HOST, port: Number(process.env.DB_PORT), username: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, entities: [D + '/database/entities/*.entity.js'], synchronize: false });
  await ds.initialize();
  const audit = new AuditService(ds.getRepository(OperatorActionLog));
  const events = new EventsService(ds, audit);
  const ids = {};
  const cleanup = async () => {
    await ds.query(`DELETE FROM operator_action_logs WHERE target_type = 'EVENT' AND target_id IN (SELECT id::text FROM security_event_logs WHERE event_id LIKE 'ITEST-LIVE-%')`);
    await ds.query(`DELETE FROM security_event_logs WHERE event_id LIKE 'ITEST-LIVE-%'`);
  };
  const insert = async (key, { severity, createdAt, ack = null, vehicle = 'ITESTLV', receivedAt = createdAt }) => {
    const [row] = await ds.query(
      `INSERT INTO security_event_logs (event_id, dedup_key, vehicle_code, source_type, source_id, origin, event_code, severity, created_at, received_at, occurred_at_valid, display_message,
                                        is_acknowledged, acknowledged_at, acknowledged_by_name)
       VALUES ($1, $1, $2, 'VEHICLE', $2, 'REPORTED', 'OBSTACLE_DETECTED', $3, $4, $5, true, $6, $7, $8, $9) RETURNING id::text`,
      [`ITEST-LIVE-${key}`, vehicle, severity, createdAt, receivedAt, `itest ${key}`, ack !== null, ack === 'legacy' ? null : ack, ack !== null ? '舊確認人' : null],
    );
    ids[key] = row.id;
  };
  const walk = async (bucket, limit) => {
    const seen = [];
    let after;
    for (let i = 0; i < 1000; i++) {
      const page = await events.live({ bucket, limit: String(limit), after });
      seen.push(...page.items.map((x) => x.id));
      if (!page.hasMore) return { seen, last: page };
      after = page.nextCursor;
    }
    throw new Error('游標沒有結束');
  };
  try {
    await cleanup();
    const before = await events.live({ bucket: 'pending' });
    const now = Date.now();
    await insert('p4', { severity: 'CRITICAL', createdAt: now - 72 * HOUR });
    await insert('p1', { severity: 'CRITICAL', createdAt: now - 1000 });
    await insert('p5', { severity: 'CRITICAL', createdAt: now - 1000 });
    await insert('p2', { severity: 'WARNING', createdAt: now - 500 });
    await insert('p3', { severity: 'INFO', createdAt: now - 100 });
    await insert('a1', { severity: 'INFO', createdAt: now - 2 * HOUR, ack: now - HOUR });
    await insert('a2', { severity: 'CRITICAL', createdAt: now - 72 * HOUR, ack: now - 2 * HOUR });
    await insert('a3', { severity: 'CRITICAL', createdAt: now - 40 * HOUR, ack: now - 30 * HOUR });
    await insert('a4', { severity: 'WARNING', createdAt: now - 3 * HOUR, ack: 'legacy' });

    // ── 工作集合與計數 ──
    const first = await events.live({ bucket: 'pending' });
    ok(first.items.length <= 8 && first.items.length >= 1, '預設初載 8 筆以內', String(first.items.length));
    ok(first.pendingTotal - before.pendingTotal === 5, '待確認計數來自資料庫（含 3 天前未確認）', `${before.pendingTotal}→${first.pendingTotal}`);
    ok(first.confirmedTotal - before.confirmedTotal === 4, '已確認計數不受 24 小時限制且包含 legacy', `${before.confirmedTotal}→${first.confirmedTotal}`);
    ok(typeof first.serverTime === 'number' && first.timeZone && first.version, '回應帶 serverTime／timeZone／version');

    const { seen } = await walk('pending', 3);
    ok(new Set(seen).size === seen.length, '游標分頁沒有重複');
    ok(seen.length === first.pendingTotal, 'pending 游標走完筆數＝待確認總數', `${seen.length} vs ${first.pendingTotal}`);
    const order = ['p5', 'p1', 'p4', 'p2', 'p3'].map((k) => seen.indexOf(ids[k]));
    ok(order.every((v, i) => v >= 0 && (i === 0 || order[i - 1] < v)), '待確認順序：嚴重→警告→資訊、時間、ID 降冪', JSON.stringify(order));
    const confirmed = await walk('confirmed', 2);
    ok(confirmed.seen.includes(ids.a3), '超過 24 小時的已確認事件仍在 confirmed');
    ok(confirmed.seen.includes(ids.a4), '缺確認時間的 legacy 仍在 confirmed 並排最後');
    ok(confirmed.seen.indexOf(ids.a4) > confirmed.seen.indexOf(ids.a3), 'NULL 確認時間明確排最後');

    // ── 列內確認：游標中途確認不漏列 ──
    const p1 = await events.live({ bucket: 'pending', limit: '2' });
    await events.acknowledge(ids.p2, '列內確認緣由', { id: 'itest-live', display_name: '測試員甲' }, { ip: '127.0.0.1' });
    const rest = await walk('confirmed', 100);
    ok(rest.seen.includes(ids.p2), '確認後由 confirmed 集合查到');
    const p2page = await events.live({ bucket: 'pending', limit: '100', after: p1.nextCursor });
    ok(!p2page.items.some((x) => p1.items.some((y) => y.id === x.id)), '確認改變排序後，續用游標不與第一頁重複');
    const again = await events.acknowledge(ids.p2, '後到者', { id: 'itest-live-2', display_name: '測試員乙' }, { ip: '127.0.0.1' });
    ok(again.alreadyAcknowledged === true && again.acknowledgedByName === '測試員甲' && again.acknowledgementNote === '列內確認緣由', '後到者看到第一位確認人與緣由，不覆寫');
    const [{ n }] = await ds.query(`SELECT count(*)::int n FROM operator_action_logs WHERE target_type='EVENT' AND target_id=$1 AND action_type='EVENT_ACKNOWLEDGE'`, [ids.p2]);
    ok(n === 1, '同一事件只記一次成功確認稽核', String(n));
    const both = await Promise.allSettled([
      events.acknowledge(ids.p3, '甲的確認緣由', { id: 'a', display_name: '甲' }, {}),
      events.acknowledge(ids.p3, '乙的確認緣由', { id: 'b', display_name: '乙' }, {}),
    ]);
    const firsts = both.filter((r) => r.status === 'fulfilled' && r.value.alreadyAcknowledged === false).length;
    ok(firsts === 1, '兩人同時確認：只有一人成功', JSON.stringify(both.map((r) => r.status)));
    const afterAck = await events.live({ bucket: 'pending' });
    ok(afterAck.pendingTotal - before.pendingTotal === 3, '確認後待確認計數同步減少', `${before.pendingTotal}→${afterAck.pendingTotal}`);

    // ── 參數驗證 ──
    ok((await rejects(events.live({ bucket: 'pending', after: 'abc' }), /游標/)) === true, '不正確的游標被拒');
    ok((await rejects(events.live({ bucket: 'pending', limit: '101' }), /筆數/)) === true, '單次筆數上限 100');
    ok((await rejects(events.live({ bucket: 'other' }), /事件集合/)) === true, '非白名單 bucket 被拒');
    ok((await rejects(events.live({ bucket: 'pending', from: '1700000000000' }), /不支援/)) === true, '工作集合不接受歷史時間條件');
    ok((await rejects(events.acknowledge(ids.p1, undefined, { id: 'a', display_name: '甲' }, {}), /必填/)) === true, '未提供確認緣由被拒');
    ok((await rejects(events.acknowledge(ids.p1, '   ', { id: 'a', display_name: '甲' }, {}), /請填寫/)) === true, '全空白確認緣由被拒');

    // ── 查詢計畫 ──
    const plan = await ds.query(`EXPLAIN SELECT id FROM security_event_logs e WHERE e.is_acknowledged = true ORDER BY e.acknowledged_at DESC NULLS LAST, e.id DESC LIMIT 9`);
    console.log('  已確認段查詢計畫：' + plan.map((r) => r['QUERY PLAN']).join(' / '));

    // ── 資料清理：待確認事件保留 ──
    const old = Date.UTC(2001, 0, 1);
    await insert('r1', { severity: 'INFO', createdAt: old, vehicle: 'ITESTRT' });
    await insert('r2', { severity: 'INFO', createdAt: old + 1, vehicle: 'ITESTRT', ack: old + 2 });
    const retention = new DataRetentionService(ds, null, null, null);
    const criteria = { category: 'security_events', from: old - 1, to: old + 10, vehicleCode: 'ITESTRT' };
    const deleted = await retention.deleteBatch(criteria);
    const left = await ds.query(`SELECT event_id FROM security_event_logs WHERE vehicle_code = 'ITESTRT'`);
    ok(deleted === 1 && left.length === 1 && left[0].event_id === 'ITEST-LIVE-r1', '資料清理只刪已確認事件，待確認事件保留', `${deleted} ${JSON.stringify(left)}`);
  } catch (e) {
    fail++;
    console.log('FAIL 例外：' + (e.stack || e.message));
  } finally {
    await cleanup();
    const [{ n }] = await ds.query(`SELECT count(*)::int n FROM security_event_logs WHERE event_id LIKE 'ITEST-LIVE-%'`);
    console.log(`殘留測試事件 ${n} 筆`);
    await ds.destroy();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();

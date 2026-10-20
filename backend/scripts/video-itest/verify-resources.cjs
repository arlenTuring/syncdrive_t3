// 影像整合測試：影像資源管理與即時監控版面（來源標籤、儲存錄影、啟停、一鍵複製、版面、格子綁定、刪除、健康探測）。
//
//   VIDEO_ITEST_ALLOW=1 VIDEO_ITEST_ENV=backend/.env node backend/scripts/video-itest/verify-resources.cjs [攝影機主機 IP]
//
// 有給攝影機主機時（例如模擬器或 scripts/video-test-cameras.sh），另外驗證背景健康探測：
//   SIM_URL（預設 http://127.0.0.1:4300）存在時用模擬器 PMS01/front 的讀取帳密，否則用 cam/camtest 與 /cam1。
// 只建立並刪除自己標記 itest-video 的資料。
const path = require('path');
if (process.env.VIDEO_ITEST_ALLOW !== '1') {
  console.error('此測試會建立並刪除測試資料，只在測試環境執行；確認後設定 VIDEO_ITEST_ALLOW=1');
  process.exit(2);
}
if (process.env.VIDEO_ITEST_ENV) {
  require('dotenv').config({ path: path.resolve(process.env.VIDEO_ITEST_ENV), quiet: true });
  process.chdir(path.dirname(path.resolve(process.env.VIDEO_ITEST_ENV)));
}
const D = process.env.VIDEO_ITEST_DIST ? path.resolve(process.env.VIDEO_ITEST_DIST) : path.join(__dirname, '../../dist');
const { DataSource } = require('typeorm');
const { VideoConfigService } = require(D + '/video/video-config.service.js');
const { VideoReconcilerService } = require(D + '/video/video-reconciler.service.js');
const { MediaMtxClient } = require(D + '/video/mediamtx.client.js');
const { decryptSecret } = require(D + '/video/video-secrets.js');

const IP = process.argv[2] || null;
const SIM = process.env.SIM_URL || 'http://127.0.0.1:4300';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${c ? '' : ' ' + extra}`); };
const rejects = async (p, re) => p.then(() => 'ok', (e) => (re.test(`${e.message} ${JSON.stringify(e.getResponse?.() ?? '')}`) ? true : `${e.message}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => `itest${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

(async () => {
  const ds = new DataSource({ type: 'postgres', host: process.env.DB_HOST, port: Number(process.env.DB_PORT), username: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, entities: [D + '/database/entities/*.entity.js', D + '/database/entities/video.entities.js'], synchronize: false });
  await ds.initialize();
  const media = new MediaMtxClient();
  const config = new VideoConfigService(ds);
  const reconciler = new VideoReconcilerService(ds, media, config);
  const actor = { id: 'itest-video', display_name: '測試員', roles: [], permissions: [] };
  const full = { canManageRecording: true };
  const noRec = { canManageRecording: false };
  const created = { sources: [], tabs: [] };
  const conn = (p = '/cam1') => ({ mode: 'fields', protocol: 'rtsp', host: '192.168.31.217', port: 18554, path: p, username: 'cam', password: 'camtest' });
  try {
    // ── 來源：儲存錄影權限、標籤 ──
    ok((await rejects(config.createSource({ name: 'x', connection: conn() }, actor, noRec), /錄影管理權限/)) === true, '沒有錄影管理權限：新增預設儲存錄影的來源被整個拒絕');
    const a = await config.createSource({ name: 'itest 前門', connection: conn('/a'), tags: [' 前門 ', 'ＧＡＴＥ', 'gate', ''], vehicleCode: 'PMS01' }, actor, full);
    created.sources.push(a);
    const srcA = await config.getSource(a);
    ok(srcA.recordingEnabled === true && srcA.desiredRecording === true, '新來源預設儲存錄影');
    ok(JSON.stringify(srcA.tags) === JSON.stringify(['前門', 'ＧＡＴＥ']), '標籤 trim、去空、全半形大小寫去重', JSON.stringify(srcA.tags));
    ok(!JSON.stringify(srcA).includes('camtest') && srcA.connection.hasPassword, '來源回應不含密碼');
    const b = await config.createSource({ name: 'itest 後門', connection: conn('/b'), tags: ['後門'], recordingEnabled: false }, actor, noRec);
    created.sources.push(b);
    ok((await config.getSource(b)).recordingEnabled === false, '不儲存錄影的來源，沒有錄影權限也可新增');

    // ── 只改名稱／標籤不建立新版本 ──
    const revBefore = srcA.revisionId;
    const renamed = await config.updateSource(a, { name: 'itest 前門 改名', tags: ['前門', '入口'], expectedVersion: srcA.version }, actor, full);
    ok(renamed.revisionId === revBefore && renamed.name === 'itest 前門 改名', '只改名稱與標籤：不建立新版本、不重啟媒體');
    ok((await rejects(config.updateSource(a, { recordingEnabled: false, expectedVersion: renamed.version }, actor, noRec), /錄影管理權限/)) === true, '沒有錄影管理權限不能切換儲存錄影');

    // ── 清單：分頁、標籤、關鍵字、啟用 ──
    const byTag = await config.querySources({ tags: '入口', pageSize: 50 });
    ok(byTag.items.some((s) => s.id === a) && !byTag.items.some((s) => s.id === b), '依來源標籤篩選');
    const byQ = await config.querySources({ q: 'PMS01', pageSize: 50 });
    ok(byQ.items.some((s) => s.id === a), '關鍵字可搜載具');
    const page1 = await config.querySources({ q: 'itest', pageSize: 5, page: 1 });
    ok(page1.total >= 2 && page1.items.every((s, i, arr) => i === 0 || arr[i - 1].name.toLowerCase() <= s.name.toLowerCase()), '分頁與穩定排序', JSON.stringify(page1.items.map((s) => s.name)));
    ok(page1.items.every((s) => typeof s.actualStatus.stale === 'boolean'), '清單狀態帶 stale（過期不沿用綠燈）');

    // ── 啟停 ──
    let cur = await config.getSource(a);
    const off = await config.setEnabled(a, { expectedVersion: cur.version, enabled: false });
    ok(off.enabled === false && off.settingAccepted === true && off.desiredRecording === false, '停用：設定已接受、不再要求錄影');
    ok((await rejects(config.setEnabled(a, { expectedVersion: cur.version, enabled: true }), /其他人修改/)) === true, '啟停使用預期版本，舊版本被拒絕');
    cur = await config.setEnabled(a, { expectedVersion: off.version, enabled: true });

    // ── 錄影需求以來源為準（沒綁任何格子也錄） ──
    let demand = await config.recordingDemand();
    ok(demand.has(a) && demand.get(a).tiles === 0, '啟用＋儲存錄影的來源沒綁格子也列入錄影需求');
    ok(!demand.has(b), '不儲存錄影的來源不列入');

    // ── 一鍵複製 ──
    const req1 = rid();
    const dup = await config.duplicateSource(a, { expectedVersion: cur.version, requestId: req1 }, actor, full);
    created.sources.push(dup.id);
    ok(dup.name === 'itest 前門 改名的複製' && dup.id !== a, '複製名稱為「原名稱的複製」、新 sourceId');
    ok(JSON.stringify(dup.tags) === JSON.stringify(cur.tags) && dup.enabled === cur.enabled && dup.recordingEnabled === cur.recordingEnabled, '複製標籤、啟用、儲存錄影');
    const [ra, rd] = await Promise.all([ds.query(`SELECT * FROM video_source_revisions WHERE id = $1`, [cur.revisionId]), ds.query(`SELECT * FROM video_source_revisions WHERE id = $1`, [dup.revisionId])]);
    ok(rd[0].media_path !== ra[0].media_path && rd[0].id !== ra[0].id && rd[0].path === ra[0].path && rd[0].vehicle_code === 'PMS01', '新 revision 與新媒體路徑、連線相同');
    ok(rd[0].secret_ciphertext !== ra[0].secret_ciphertext && decryptSecret(rd[0].secret_ciphertext) === 'camtest', '密碼在伺服器內重新加密（密文不同、內容相同）');
    ok(Object.keys(dup.actualStatus).filter((k) => !['checkedAt', 'stale'].includes(k)).length === 0, '複本狀態從待檢查開始');
    const again = await config.duplicateSource(a, { expectedVersion: cur.version, requestId: req1 }, actor, full);
    ok(again.id === dup.id, '同一 requestId 重送不會建立第二份');
    const dup2 = await config.duplicateSource(a, { expectedVersion: cur.version, requestId: rid() }, actor, full);
    created.sources.push(dup2.id);
    ok(dup2.id !== dup.id && (await config.getSource(a)).version === cur.version, '明確再按一次可再複製一份；原來源版本不變');
    ok((await rejects(config.duplicateSource(a, { expectedVersion: cur.version, requestId: rid() }, actor, noRec), /錄影管理權限/)) === true, '沒有錄影權限不能複製會儲存錄影的來源');
    ok((await rejects(config.duplicateSource(a, { expectedVersion: cur.version + 9, requestId: rid() }, actor, full), /其他人修改/)) === true, '複製檢查來源版本');
    const longId = await config.createSource({ name: '長'.repeat(120), connection: conn('/long'), recordingEnabled: false }, actor, full);
    created.sources.push(longId);
    const longDup = await config.duplicateSource(longId, { expectedVersion: 1, requestId: rid() }, actor, full);
    created.sources.push(longDup.id);
    ok([...longDup.name].length === 120 && longDup.name.endsWith('的複製'), '名稱太長時保留完整後綴');
    const patched = await config.updateSource(dup.id, { connection: { ...conn('/changed') }, expectedVersion: dup.version }, actor, full);
    ok(patched.connection.path === '/changed' && (await config.getSource(a)).connection.path === '/a', '改副本的路徑不會影響原來源');

    // ── 監控版面 ──
    const tab = await config.createTab({ name: 'itest 版面', tiles: [{ x: 0, y: 0, w: 5000, h: 10000 }, { x: 5000, y: 0, w: 5000, h: 10000 }] }, actor);
    created.tabs.push(tab.id);
    ok(tab.tiles.length === 2 && tab.tiles[1].x === 5000 && Math.abs(tab.canvasAspectRatio - 16 / 9) < 0.001, '新增標籤頁：2 格左右均分、畫布 16:9');
    const [t1, t2] = tab.tiles;
    let bound = await config.bindTileSource(tab.id, t1.id, { expectedVersion: t1.version, sourceId: a });
    ok(bound.version === tab.version && bound.tiles.find((t) => t.id === t1.id).sourceId === a, '格子綁定來源不改標籤頁版本（版面與綁定互不覆蓋）');
    const moved = await config.saveLayout(tab.id, { expectedVersion: tab.version, tiles: [{ tileId: t1.id, x: 0, y: 0, w: 7000, h: 10000 }, { tileId: t2.id, x: 7000, y: 0, w: 3000, h: 5000 }, { x: 7000, y: 5000, w: 3000, h: 5000 }] });
    ok(moved.tiles.length === 3 && moved.tiles.find((t) => t.id === t1.id).sourceId === a && moved.tiles.find((t) => t.id === t2.id).w === 3000, '保存版面：既有格子保留 tileId 與來源，新增一格');
    ok((await rejects(config.saveLayout(tab.id, { expectedVersion: tab.version, tiles: [{ x: 0, y: 0, w: 10000, h: 10000 }] }), /其他人修改/)) === true, '版面使用預期版本');
    ok((await rejects(config.saveLayout(tab.id, { expectedVersion: moved.version, tiles: [{ x: 0, y: 0, w: 6000, h: 10000 }, { x: 5000, y: 0, w: 5000, h: 10000 }] }), /重疊/)) === true, '後端拒絕重疊');
    ok((await rejects(config.saveLayout(tab.id, { expectedVersion: moved.version, tiles: [{ tileId: '00000000-0000-4000-8000-000000000001', x: 0, y: 0, w: 10000, h: 10000 }] }), /不屬於/)) === true, '後端拒絕其他標籤頁或不存在的 tileId');
    ok((await rejects(config.saveLayout(tab.id, { expectedVersion: moved.version, tiles: [] }), /至少/)) === true, '版面不能 0 格');
    ok((await rejects(config.createTab({ name: 'x', tiles: Array.from({ length: 13 }, (_, i) => ({ x: (i % 4) * 2500, y: Math.floor(i / 4) * 2000, w: 2500, h: 2000 })) }, actor), /最多 12/)) === true, '後端拒絕第 13 格');
    const shrunk = await config.saveLayout(tab.id, { expectedVersion: moved.version, tiles: [{ tileId: t1.id, x: 0, y: 0, w: 7000, h: 10000 }] });
    ok(shrunk.tiles.length === 1 && shrunk.tiles[0].id === t1.id, '刪格只刪版面格子');
    ok((await config.recordingDemand()).has(a), '刪格不影響來源錄影');
    ok((await rejects(config.bindTileSource(tab.id, t1.id, { expectedVersion: t1.version, sourceId: b }), /其他人修改/)) === true, '綁定使用格子的預期版本');
    cur = await config.getSource(b);
    await config.setEnabled(b, { expectedVersion: cur.version, enabled: false });
    ok((await rejects(config.bindTileSource(tab.id, t1.id, { expectedVersion: shrunk.tiles[0].version, sourceId: b }), /已停用/)) === true, '停用來源不接受新綁定');
    ok((await rejects(config.saveTilesDeprecated ? Promise.resolve().then(() => config.saveTilesDeprecated()) : Promise.reject(new Error('CONTRACT_CHANGED')), /CONTRACT_CHANGED|已更新/)) === true, '舊的整頁格子保存回明確的契約錯誤');

    // ── 刪除來源：格子保留位置與綁定 ──
    const impact = await config.deleteImpact(a);
    ok(impact.tabs === 1 && impact.tiles === 1 && impact.stopsRecording === true, '刪除前列出引用的標籤頁與將停止錄影', JSON.stringify(impact));
    cur = await config.getSource(a);
    await config.deleteSource(a, cur.version);
    const afterDelete = (await config.listTabs()).find((t) => t.id === tab.id);
    ok(afterDelete.tiles[0].sourceId === a && afterDelete.tiles[0].w === 7000, '來源刪除後格子保留尺寸與綁定（顯示已刪除、可重新選）');
    ok(!(await config.recordingDemand()).has(a), '刪除的來源停止錄影需求');
    const opts = await config.sourceOptions({ includeDeleted: 'true' });
    ok(opts.items.find((o) => o.id === a)?.state === 'deleted' && !JSON.stringify(opts).includes('192.168.31.217'), '安全來源選項：可列已刪除來源（歷史用），沒有任何連線資訊');

    // ── 背景健康探測（沒人看、沒錄影的來源） ──
    if (IP) {
      let good = { path: '/cam1', username: 'cam', password: 'camtest' };
      try {
        const cred = await (await fetch(`${SIM}/api/video/read-credential`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
        if (cred.password) good = { path: '/sim/pms01/front', username: cred.username, password: cred.password };
      } catch { /* 沒有模擬器就用測試攝影機 */ }
      const live = await config.createSource({ name: 'itest 探測可連', connection: { mode: 'fields', protocol: 'rtsp', host: IP, port: 18554, ...good }, recordingEnabled: false }, actor, full);
      const dead = await config.createSource({ name: 'itest 探測連不上', connection: { mode: 'fields', protocol: 'rtsp', host: IP, port: 18555, path: '/x' }, recordingEnabled: false }, actor, full);
      created.sources.push(live, dead);
      reconciler.leader = true; // 測試程序自己探測（正式環境只有持有 lease 的 worker 會做）
      await reconciler.probeIdle();
      await reconciler.reconcile();
      const [sl, sd] = await Promise.all([config.getSource(live), config.getSource(dead)]);
      ok(sl.actualStatus.state === 'online' && sl.actualStatus.stale === false, '沒人看也沒錄影的來源：背景探測判為在線', JSON.stringify(sl.actualStatus));
      ok(sd.actualStatus.state === 'offline' && sd.actualStatus.reason, '連不上的來源判為離線並附原因', JSON.stringify(sd.actualStatus));
    }
  } catch (e) {
    ok(false, '例外', e.stack);
  } finally {
    for (const id of created.tabs) await ds.query(`DELETE FROM video_monitor_tabs WHERE id = $1`, [id]);
    for (const id of created.sources) {
      const revs = await ds.query(`SELECT media_path FROM video_source_revisions WHERE source_id = $1`, [id]);
      await ds.query(`UPDATE video_monitor_tiles SET source_id = NULL WHERE source_id = $1`, [id]);
      await ds.query(`UPDATE video_sources SET current_revision_id = NULL, deleted_at = 1 WHERE id = $1`, [id]);
      for (const r of revs) await media.deletePath(r.media_path).catch(() => undefined);
    }
    await sleep(500);
    for (const id of created.sources) {
      await ds.query(`DELETE FROM video_segment_objects WHERE segment_id IN (SELECT id FROM video_recording_segments WHERE source_id = $1)`, [id]);
      await ds.query(`DELETE FROM video_recording_segments WHERE source_id = $1`, [id]);
      await ds.query(`DELETE FROM video_source_revisions WHERE source_id = $1`, [id]);
      await ds.query(`DELETE FROM video_sources WHERE id = $1`, [id]);
    }
    const left = await ds.query(`SELECT (SELECT count(*) FROM video_sources WHERE created_by = 'itest-video') AS n`);
    console.log(`殘留測試資料：${left[0].n}`);
    await ds.destroy();
  }
  console.log(`${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

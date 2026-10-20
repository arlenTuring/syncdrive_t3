// 影像整合測試：接入與監控標籤。
//
// 用法（在媒體 worker 容器內：它有錄影空間寫入權、ffmpeg 與 vmaf）：
//   docker exec -e VIDEO_ITEST_ALLOW=1 syncdrive_video_worker node scripts/video-itest/verify-video.cjs <測試攝影機主機 IP>
// 本機開發：
//   VIDEO_ITEST_ALLOW=1 VIDEO_ITEST_ENV=backend/.env node backend/scripts/video-itest/verify-video.cjs <測試攝影機主機 IP>
//
// 會在資料庫建立標記為 itest-video 的測試來源與片段、跑完清除；測試期間會暫時改動錄影儲存政策
// （例如把預算設成極小值驗證暫停錄影），所以只在測試環境執行，必須明確設定 VIDEO_ITEST_ALLOW=1。
// 測試攝影機用 scripts/video-test-cameras.sh 啟動；不要指向真實攝影機或正式 bucket。
const path = require('path');
if (process.env.VIDEO_ITEST_ALLOW !== '1') {
  console.error('此測試會暫時改動錄影儲存政策，只在測試環境執行；確認後設定 VIDEO_ITEST_ALLOW=1');
  process.exit(2);
}
if (process.env.VIDEO_ITEST_ENV) {
  require('dotenv').config({ path: path.resolve(process.env.VIDEO_ITEST_ENV), quiet: true });
  process.chdir(path.dirname(path.resolve(process.env.VIDEO_ITEST_ENV)));
}
const D = process.env.VIDEO_ITEST_DIST ? path.resolve(process.env.VIDEO_ITEST_DIST) : path.join(__dirname, '../../dist');
const VIDEO_CFG = require(D + '/video/video.config.js').videoConfig();
const { DataSource } = require('typeorm');
const fs = require('fs');
const { VideoConfigService } = require(D + '/video/video-config.service.js');
const { VideoReconcilerService } = require(D + '/video/video-reconciler.service.js');
const { VideoLiveService } = require(D + '/video/video-live.service.js');
const { MediaMtxClient } = require(D + '/video/mediamtx.client.js');
const IP = process.argv[2];
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${c ? '' : ' ' + extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ds = new DataSource({ type: 'postgres', host: process.env.DB_HOST, port: Number(process.env.DB_PORT), username: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, entities: [D + '/database/entities/*.entity.js', D + '/database/entities/video.entities.js'], synchronize: false });
  await ds.initialize();
  // 測試期間暫時放寬容量（預算 50 GiB、最低剩餘 0）：同時運行的 worker 會依正式政策回收片段或暫停錄影，
  // 主機剩餘空間低於自動最低保留時，測試片段會被當成要回收的錄影刪掉。結束時還原。
  const [held] = await ds.query(`SELECT max_bytes, min_free_bytes FROM video_storage_policies WHERE id = 'default'`);
  // 原政策下錄影暫停時，同時運行的 worker 每分鐘才重算；等它依測試政策恢復，避免兩個協調器互相改錄影設定
  const pausedBefore = await new (require(D + '/video/video-storage.service.js').VideoStorageService)(ds, new (require(D + '/video/mediamtx.client.js').MediaMtxClient)(), new (require(D + '/video/video-config.service.js').VideoConfigService)(ds), { kick() {} }).status().then((st) => Boolean(st.paused), () => false);
  await ds.query(`UPDATE video_storage_policies SET max_bytes = 53687091200, min_free_bytes = 0 WHERE id = 'default'`);
  if (pausedBefore) {
    console.log('  · 原儲存政策下錄影暫停中，等候 worker 依測試政策恢復（約 1 分鐘）');
    await new Promise((r) => setTimeout(r, 65_000));
  }
  const releaseHold = () => ds.query(`UPDATE video_storage_policies SET max_bytes = $1, min_free_bytes = $2 WHERE id = 'default'`, [held?.max_bytes ?? null, held?.min_free_bytes ?? null]);
  const media = new MediaMtxClient();
  const config = new VideoConfigService(ds);
  const reconciler = new VideoReconcilerService(ds, media, config);
  const live = new VideoLiveService(media, config, { authenticate: async () => null });
  const actor = { id: 'itest-video', display_name: '測試員', roles: [], permissions: [] };
  const req = { headers: {} };
  const created = { sources: [], tabs: [] };
  try {
    // 連線範圍 / SSRF
    const bad = await config.createSource({ name: 'x', connection: { mode: 'url', url: 'rtsp://127.0.0.1:554/a' } }, actor).then(() => 'created', (e) => e.message);
    ok(/不允許/.test(bad), '本機位址被連線範圍擋下', bad);
    const meta = await config.createSource({ name: 'x', connection: { mode: 'url', url: 'http://169.254.169.254/latest' } }, actor).then(() => 'created', (e) => e.message);
    ok(/不允許/.test(meta), '雲端 metadata 被擋下', meta);
    // 測試連線：錯誤分類
    const wrongPw = await live.createTest({ connection: { mode: 'url', url: `rtsp://cam:wrong@${IP}:18554/cam1` } }, actor, req);
    ok(wrongPw.status === 'failed' && wrongPw.error === '帳號或密碼錯誤', '測試：密碼錯誤', JSON.stringify(wrongPw));
    const wrongPath = await live.createTest({ connection: { mode: 'url', url: `rtsp://cam:camtest@${IP}:18554/nope` } }, actor, req);
    ok(wrongPath.status === 'failed' && /路徑不存在/.test(wrongPath.error), '測試：路徑不存在', JSON.stringify(wrongPath));
    const refused = await live.createTest({ connection: { mode: 'url', url: `rtsp://cam:camtest@${IP}:18555/cam1` } }, actor, req);
    ok(refused.status === 'failed' && /拒絕|逾時/.test(refused.error), '測試：連接埠沒有服務', JSON.stringify(refused));
    const good = await live.createTest({ connection: { mode: 'url', url: `rtsp://cam:camtest@${IP}:18554/cam1` } }, actor, req);
    ok(good.status === 'ready' && good.tracks.includes('H264') && good.hlsUrl && !JSON.stringify(good).includes('camtest'), '測試：成功、取得編碼、預覽網址不含密碼', JSON.stringify(good));
    const testPaths = (await media.listConfigPaths()).filter((p) => p.name.startsWith('vt_'));
    ok(testPaths.length >= 1 && testPaths.every((p) => p.record !== true), '測試路徑不錄影');
    await live.deleteTest(good.id, actor);
    ok(!(await media.listConfigPaths()).some((p) => p.name === `vt_${good.id.replace(/-/g, '')}`), '關閉預覽即清除暫時路徑');
    // 來源與標籤
    const sid = await config.createSource({ name: '測試前鏡頭', connection: { mode: 'url', url: `rtsp://cam:camtest@${IP}:18554/cam1` }, vehicleCode: 'PMS01' }, actor);
    created.sources.push(sid);
    const src = await config.getSource(sid);
    ok(src.connection.hasPassword && !JSON.stringify(src).includes('camtest') && src.connection.maskedUrl.includes('***'), '來源回應遮蔽密碼');
    const grid = (n) => Array.from({ length: n }, (_, i) => ({ x: (i % 4) * 2500, y: Math.floor(i / 4) * 3333, w: 2500, h: 3333 }));
    const tab = await config.createTab({ name: '測試標籤', tiles: grid(12) }, actor);
    created.tabs.push(tab.id);
    ok(tab.tiles.length === 12 && tab.tiles.every((t) => t.sourceId === null && t.w === 2500), '12 格版面都可用（正規化座標）');
    const bad13 = await config.createTab({ name: 'x', tiles: [...grid(12), { x: 0, y: 9999 - 600, w: 600, h: 600 }] }, actor).then(() => 'ok', (e) => e.message);
    ok(/最多 12/.test(bad13), '13 格被拒');
    const t0 = tab.tiles[0];
    const t11 = tab.tiles[11];
    await config.bindTileSource(tab.id, t0.id, { expectedVersion: t0.version, sourceId: sid });
    let t = await config.bindTileSource(tab.id, t11.id, { expectedVersion: t11.version, sourceId: sid });
    const stale = await config.bindTileSource(tab.id, t0.id, { expectedVersion: t0.version, sourceId: null }).then(() => 'ok', (e) => e.message);
    ok(/其他人修改/.test(stale), '舊版本不能覆蓋格子綁定');
    await reconciler.reconcile();
    const rev = (await config.revisionFor(sid)).revision;
    const paths = (await media.listConfigPaths()).filter((p) => p.name === rev.mediaPath);
    ok(paths.length === 1 && paths[0].record === true && paths[0].sourceOnDemand === false, '同源兩格只建一條路徑並持續錄影（第 12 格可用）');
    await sleep(6000);
    await reconciler.reconcile();
    const st = (await config.getSource(sid)).actualStatus;
    ok(st.state === 'online' && st.recording === true && st.desiredRecording === true, '實際狀態：連線中且錄影中', JSON.stringify(st));
    const dir = path.join(VIDEO_CFG.recordingsDir, rev.mediaPath);
    ok(fs.existsSync(dir) && fs.readdirSync(dir).length >= 1, '伺服器端已寫入錄影檔（與瀏覽器無關）');
    // 刪格（只留第 1 格）：錄影以來源為準，照常錄
    t = await config.saveLayout(tab.id, { expectedVersion: t.version, tiles: [{ tileId: t0.id, x: 0, y: 0, w: 10000, h: 10000 }] });
    await reconciler.reconcile();
    ok(t.tiles.length === 1 && (await media.listConfigPaths()).find((p) => p.name === rev.mediaPath).record === true, '刪除格子不停止來源錄影');
    // 來源取消儲存錄影：停止新錄影、仍可即時（有人看才接入），既有錄影保留
    const sv = (await config.getSource(sid)).version;
    await config.updateSource(sid, { expectedVersion: sv, recordingEnabled: false }, actor);
    await reconciler.reconcile();
    const live2 = (await media.listConfigPaths()).find((p) => p.name === rev.mediaPath);
    ok(live2.record === false && live2.sourceOnDemand === true, '來源取消儲存錄影：停止新錄影、改為有人看才接入');
    ok(fs.readdirSync(dir).length >= 1, '取消錄影不刪既有錄影');
    // 修改連線 → 新版本、新路徑，舊路徑移除
    const v = (await config.getSource(sid)).version;
    await config.updateSource(sid, { expectedVersion: v, connection: { mode: 'fields', protocol: 'rtsp', host: IP, port: 18554, path: '/cam2', username: 'cam' } }, actor);
    const rev2 = (await config.revisionFor(sid)).revision;
    ok(rev2.revisionNo === 2 && rev2.mediaPath !== rev.mediaPath && rev2.secretCiphertext === rev.secretCiphertext, '改路徑建立新版本；密碼留空沿用原密碼');
    await reconciler.reconcile();
    const names = (await media.listConfigPaths()).map((p) => p.name);
    ok(names.includes(rev2.mediaPath) && !names.includes(rev.mediaPath), '媒體服務換成新版本路徑');
  } finally {
    for (const id of created.tabs) await ds.query(`DELETE FROM video_monitor_tabs WHERE id = $1`, [id]);
    for (const id of created.sources) {
      const revs = await ds.query(`SELECT media_path FROM video_source_revisions WHERE source_id = $1`, [id]);
      await ds.query(`UPDATE video_sources SET current_revision_id = NULL WHERE id = $1`, [id]);
      await ds.query(`DELETE FROM video_recording_segments WHERE source_id = $1`, [id]);
      await ds.query(`DELETE FROM video_source_revisions WHERE source_id = $1`, [id]);
      await ds.query(`DELETE FROM video_sources WHERE id = $1`, [id]);
      for (const r of revs) {
        await media.deletePath(r.media_path).catch(() => undefined);
        fs.rmSync(path.join(VIDEO_CFG.recordingsDir, r.media_path), { recursive: true, force: true });
      }
    }
    for (const p of (await media.listConfigPaths()).filter((p) => p.name.startsWith('vt_'))) await media.deletePath(p.name);
    const left = await ds.query(`SELECT (SELECT count(*) FROM video_sources WHERE created_by = 'itest-video') + (SELECT count(*) FROM video_monitor_tabs WHERE created_by = 'itest-video') AS n`);
    console.log(`殘留測試資料：${left[0].n}`);
    await releaseHold();
    await ds.destroy();
  }
  console.log(`${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

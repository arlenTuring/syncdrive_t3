// 影像整合測試：持續錄影、歷史播放、下載與容量保護。
//
// 用法（在媒體 worker 容器內：它有錄影空間寫入權、ffmpeg 與 vmaf）：
//   docker exec -e VIDEO_ITEST_ALLOW=1 syncdrive_video_worker node scripts/video-itest/verify-recording.cjs <測試攝影機主機 IP>
// 本機開發：
//   VIDEO_ITEST_ALLOW=1 VIDEO_ITEST_ENV=backend/.env node backend/scripts/video-itest/verify-recording.cjs <測試攝影機主機 IP>
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
const http = require('http');
const express = require('express');
const { VideoConfigService } = require(D + '/video/video-config.service.js');
const { VideoReconcilerService } = require(D + '/video/video-reconciler.service.js');
const { VideoStorageService } = require(D + '/video/video-storage.service.js');
const { VideoHistoryService } = require(D + '/video/video-history.service.js');
const { MediaMtxClient } = require(D + '/video/mediamtx.client.js');
const { sessionHash } = require(D + '/video/video-live.service.js');
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
  await ds.query(`UPDATE video_storage_policies SET max_bytes = 53687091200, min_free_bytes = 0 WHERE id = 'default'`);
  const releaseHold = () => ds.query(`UPDATE video_storage_policies SET max_bytes = $1, min_free_bytes = $2 WHERE id = 'default'`, [held?.max_bytes ?? null, held?.min_free_bytes ?? null]);
  const media = new MediaMtxClient();
  const config = new VideoConfigService(ds);
  const reconciler = new VideoReconcilerService(ds, media, config);
  const storage = new VideoStorageService(ds, media, config, reconciler);
  const cookie = 'itest-cookie';
  const actor = { id: 'itest-video', display_name: '測試員', roles: [], permissions: ['events.video-history.view', 'events.video-history.export'] };
  const auth = { authenticate: async (c) => (c === cookie ? { user: actor } : null) };
  const history = new VideoHistoryService(ds, storage, auth);
  const req = { headers: { cookie: `syncdrive_session=${cookie}` } };
  const created = { sources: [], tabs: [] };
  const policy0 = await storage.policy();
  let server;
  try {
    const sid = await config.createSource({ name: '錄影測試鏡頭', connection: { mode: 'url', url: `rtsp://cam:camtest@${IP}:18554/cam2` }, vehicleCode: 'PMS02' }, actor);
    created.sources.push(sid);
    const tab = await config.createTab({ name: '錄影測試', tileCount: 1 }, actor);
    created.tabs.push(tab.id);
    await config.saveTiles(tab.id, { expectedVersion: tab.version, tiles: [{ position: 0, sourceId: sid }] });
    const t0 = Date.now();
    await reconciler.reconcile();
    // 等兩個片段完成並由 hook 建立索引（本機分段 20 秒、正式 60 秒；等待時間依分段長度）
    let segs = [];
    const rounds = Math.ceil((require(D + '/video/video.config.js').SEGMENT_SECONDS * 2 + 60) / 3);
    for (let i = 0; i < rounds && segs.length < 2; i++) {
      await sleep(3000);
      segs = await ds.query(`SELECT * FROM video_recording_segments WHERE source_id = $1 AND status = 'READY' ORDER BY start_at`, [sid]);
    }
    ok(segs.length >= 2, '伺服器持續錄影，片段完成後建立索引（READY）', `segments=${segs.length}`);
    const s0 = segs[0];
    ok(Number(s0.bytes) > 0 && Number(s0.end_at) > Number(s0.start_at) && Math.abs(Number(s0.start_at) - t0) < 60_000, '片段有大小與實際起訖', JSON.stringify({ b: s0.bytes, st: s0.start_at, en: s0.end_at }));
    ok(fs.existsSync(storage.localPath(s0.segment_key)), '索引對應的檔案存在');
    const tl = await history.timeline(sid, t0 - 60_000, Date.now(), true);
    ok(tl.some((x) => x.kind === 'available') && tl[0].kind === 'gap', '時間軸：開始錄影前是缺段、之後有錄影', JSON.stringify(tl.map((x) => x.kind)));
    // 播放：manifest 與 Range
    const pb = await history.createPlayback({ sourceIds: [sid], from: t0 - 60_000, to: Date.now() }, actor, req);
    const token = pb.sessions[0].manifestUrl.split('/')[4];
    const manifest = await history.manifest(token, req);
    ok(manifest.segments.length >= 2 && manifest.segments[0].url.includes('/segments/'), 'manifest 列出可播放片段');
    const app = express();
    app.get('/seg/:id', (q, r) => history.sendSegment(token, q.params.id, { headers: req.headers }, r).catch((e) => r.status(e.getStatus?.() ?? 500).end()));
    server = app.listen(0);
    const port = server.address().port;
    const range = await new Promise((resolve) => http.get({ port, path: `/seg/${manifest.segments[0].id}`, headers: { Range: 'bytes=0-999' } }, (r) => { let n = 0; r.on('data', (c) => (n += c.length)); r.on('end', () => resolve({ status: r.statusCode, n, type: r.headers['content-type'] })); }));
    ok(range.status === 206 && range.n === 1000 && /video\/mp4/.test(range.type), '片段支援 Range／206', JSON.stringify(range));
    const other = await config.createSource({ name: '別的來源', connection: { mode: 'url', url: `rtsp://cam:camtest@${IP}:18554/cam1` } }, actor);
    created.sources.push(other);
    const denied = await history.manifest(token, { headers: { cookie: 'syncdrive_session=other' } }).then(() => 'ok', (e) => e.message);
    ok(/登入狀態|權限/.test(denied), '換了登入 Session 的權杖不能用');
    // 下載
    const job = await history.createExport({ sourceId: sid, from: Number(s0.start_at), to: Number(s0.start_at) + 10_000 }, actor);
    for (let i = 0; i < 20; i++) { await history.runJobs(); const j = await history.job(job.id, actor); if (j.status === 'succeeded' || j.status === 'failed') break; await sleep(1000); }
    const done = await history.job(job.id, actor);
    ok(done.status === 'succeeded' && done.downloadUrl && done.result.bytes > 0, '快速下載任務完成並給短效下載網址', JSON.stringify(done));
    const tooLong = await history.createExport({ sourceId: sid, from: t0, to: t0 + 31 * 60_000 }, actor).then(() => 'ok', (e) => e.message);
    ok(/最長/.test(tooLong), '下載區間有上限');
    // 保護與到期
    await history.protect({ sourceIds: [sid], from: Number(segs[1].start_at), to: Number(segs[1].end_at), until: Date.now() + 30 * 86_400_000 });
    await storage.retention(Date.now() + 8 * 86_400_000);
    const leasedRow = (await ds.query(`SELECT status FROM video_recording_segments WHERE id = $1`, [s0.id]))[0];
    ok(leasedRow.status === 'READY', '播放中（lease）的片段即使到期也不刪');
    storage.leases.clear();
    const ret = await storage.retention(Date.now() + 8 * 86_400_000);
    const after = await ds.query(`SELECT id, status FROM video_recording_segments WHERE id = ANY($1::uuid[])`, [[s0.id, segs[1].id]]);
    const st = Object.fromEntries(after.map((r) => [r.id, r.status]));
    ok(st[s0.id] === 'DELETED' && !fs.existsSync(storage.localPath(s0.segment_key)), '超過保留天數：刪檔並標已到期');
    ok(st[segs[1].id] === 'READY', '受保護片段不自動刪除');
    const tl2 = await history.timeline(sid, t0 - 60_000, Date.now(), true);
    ok(tl2.some((x) => x.kind === 'expired'), '時間軸顯示已到期');
    // 容量水位：預算極小 → 回收並暫停新錄影
    await ds.query(`UPDATE video_storage_policies SET max_bytes = 1 WHERE id = 'default'`);
    const ret2 = await storage.retention();
    ok(ret2.paused && ret2.paused.reason === '空間不足', '超過預算且無法回收（只剩受保護片段）：暫停新錄影', JSON.stringify(ret2.paused));
    reconciler.storageGate = async () => ({ ok: false, reason: '空間不足' });
    await reconciler.reconcile();
    const rev = (await config.revisionFor(sid)).revision;
    const p = (await media.listConfigPaths()).find((x) => x.name === rev.mediaPath);
    ok(p && p.record === false, '空間不足時媒體服務停止錄影（即時監看照常）');
    const srcStatus = (await config.getSource(sid)).actualStatus;
    ok(srcStatus.desiredRecording === true && srcStatus.recording === false && /空間不足/.test(srcStatus.reason || ''), '需求錄影與實際狀態分開回報原因', JSON.stringify(srcStatus));
    // 手動刪除（受保護不刪）
    const prev = await history.deletePreview({ sourceIds: [sid], from: t0 - 60_000, to: Date.now() + 60_000 });
    ok(prev.protectedSegments >= 1, '刪除預覽列出受保護片段');
  } finally {
    if (server) server.close();
    await ds.query(`UPDATE video_storage_policies SET max_bytes = $1, retention_days = $2 WHERE id = 'default'`, [policy0.maxBytes, policy0.retentionDays]);
    for (const id of created.tabs) await ds.query(`DELETE FROM video_monitor_tabs WHERE id = $1`, [id]);
    for (const id of created.sources) {
      const revs = await ds.query(`SELECT media_path FROM video_source_revisions WHERE source_id = $1`, [id]);
      await ds.query(`UPDATE video_sources SET current_revision_id = NULL, deleted_at = 1 WHERE id = $1`, [id]);
      for (const r of revs) await media.deletePath(r.media_path).catch(() => undefined);
    }
    await sleep(1500);
    for (const id of created.sources) {
      const revs = await ds.query(`SELECT media_path FROM video_source_revisions WHERE source_id = $1`, [id]);
      await ds.query(`DELETE FROM video_segment_objects WHERE segment_id IN (SELECT id FROM video_recording_segments WHERE source_id = $1)`, [id]);
      await ds.query(`DELETE FROM video_recording_segments WHERE source_id = $1`, [id]);
      await ds.query(`DELETE FROM video_source_revisions WHERE source_id = $1`, [id]);
      await ds.query(`DELETE FROM video_sources WHERE id = $1`, [id]);
      for (const r of revs) fs.rmSync(path.join(VIDEO_CFG.recordingsDir, r.media_path), { recursive: true, force: true });
    }
    const jobs = await ds.query(`DELETE FROM video_jobs WHERE created_by = 'itest-video' RETURNING id`);
    for (const j of jobs) fs.rmSync(path.join(VIDEO_CFG.exportsDir, `${j.id}.mp4`), { force: true });
    const left = await ds.query(`SELECT (SELECT count(*) FROM video_sources WHERE created_by = 'itest-video') + (SELECT count(*) FROM video_jobs WHERE created_by = 'itest-video') AS n`);
    console.log(`殘留測試資料：${left[0].n}`);
    await releaseHold();
    await ds.destroy();
  }
  console.log(`${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

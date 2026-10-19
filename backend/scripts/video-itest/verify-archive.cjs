// 影像整合測試：背景壓縮、雲端副本回收與能力偵測。
//
// 用法（在媒體 worker 容器內：它有錄影空間寫入權、ffmpeg 與 vmaf）：
//   docker exec -e VIDEO_ITEST_ALLOW=1 syncdrive_video_worker node scripts/video-itest/verify-archive.cjs
// 本機開發：
//   VIDEO_ITEST_ALLOW=1 VIDEO_ITEST_ENV=backend/.env node backend/scripts/video-itest/verify-archive.cjs
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
const { execFileSync } = require('child_process');
const { VideoConfigService } = require(D + '/video/video-config.service.js');
const { VideoReconcilerService } = require(D + '/video/video-reconciler.service.js');
const { VideoStorageService } = require(D + '/video/video-storage.service.js');
const { VideoHistoryService } = require(D + '/video/video-history.service.js');
const { VideoArchiveService, renditionKey } = require(D + '/video/video-archive.service.js');
const { probeCapabilities } = require(D + '/video/video-capabilities.js');
const { MediaMtxClient } = require(D + '/video/mediamtx.client.js');
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${c ? '' : ' ' + extra}`); };
const fname = (t) => new Date(t).toISOString().replace(/T/, '_').replace(/:/g, '-').replace(/\..*/, '') + '-000000.mp4';
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
  const actor = { id: 'itest-video', display_name: '測試員', roles: [], permissions: ['events.video-history.view'] };
  const auth = { authenticate: async (c) => (c === cookie ? { user: actor } : null) };
  const history = new VideoHistoryService(ds, storage, auth);
  const archive = new VideoArchiveService(ds, storage);
  const req = { headers: { cookie: `syncdrive_session=${cookie}` } };
  const created = [];
  const policy0 = await storage.policy();
  let server;
  try {
    const caps = await probeCapabilities(true);
    ok(caps.ffmpeg && caps.encoders.av1.includes('libsvtav1') && caps.encoders.hevc.includes('libx265') && caps.vmaf, `實際偵測到 SVT-AV1、x265 與 VMAF（${caps.vmafTool}）`, JSON.stringify(caps));
    ok(typeof caps.storage.gcs === 'boolean', `GCS 可用性依主機服務身分偵測（此主機：${caps.storage.gcs ? '可用' : '不可用'}）`);

    const sid = await config.createSource({ name: '壓縮測試來源', connection: { mode: 'url', url: 'rtsp://cam:camtest@192.168.31.217:18554/cz' } }, actor);
    created.push(sid);
    const [rev] = await ds.query(`SELECT media_path FROM video_source_revisions WHERE source_id = $1`, [sid]);
    const dir = path.join(VIDEO_CFG.recordingsDir, rev.media_path);
    fs.mkdirSync(dir, { recursive: true });
    const t0 = Date.now() - 3_600_000;
    const make = (t) => {
      const key = `${rev.media_path}/${fname(t)}`;
      // 模擬監視器：720p 15fps、約 2 Mbps 的 H.264
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=15', '-t', '20', '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2M', '-g', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(VIDEO_CFG.recordingsDir, key)]);
      return key;
    };
    const k1 = make(t0);
    const k2 = make(t0 + 20_000);
    const id1 = await storage.indexSegment(rev.media_path, k1, 20_000);
    const id2 = await storage.indexSegment(rev.media_path, k2, 20_000);
    await storage.fillChecksums(50);
    const segs = await ds.query(`SELECT id, status, checksum, bytes FROM video_recording_segments WHERE source_id = $1 ORDER BY start_at`, [sid]);
    ok(segs.length === 2 && segs.every((s) => s.status === 'READY' && s.checksum), '測試片段已索引並算好 checksum');
    const origBytes = Number(segs[0].bytes);
    const used0 = (await storage.numbers()).usedBytes;

    const hi = await archive.compressSegment(id1, 'av1', { minSavingPct: 10, minVmaf: 100, replaceOriginal: false });
    ok(hi.kept === false && /VMAF/.test(hi.reason) && !fs.existsSync(storage.localPath(renditionKey(k1, 'av1'))), 'VMAF 未達門檻：丟掉成品、保留原檔', JSON.stringify(hi));
    const t = Date.now();
    const good = await archive.compressSegment(id1, 'av1', { minSavingPct: 10, minVmaf: 80, replaceOriginal: false });
    console.log('  AV1 結果', JSON.stringify(good), `${Date.now() - t}ms`);
    ok(good.kept === true && good.vmaf >= 80 && good.savingPct >= 10 && Math.abs(good.durationIn - good.durationOut) <= 0.5, 'AV1 壓縮：節省、VMAF、時長都達標才保留');
    const objs = await ds.query(`SELECT rendition, storage_type, status, bytes FROM video_segment_objects WHERE segment_id = $1 ORDER BY rendition`, [id1]);
    ok(objs.length === 2 && objs.every((o) => o.status === 'READY') && fs.existsSync(storage.localPath(k1)), '預設保留原檔，另登記壓縮成品', JSON.stringify(objs));
    const used1 = (await storage.numbers()).usedBytes;
    ok(used1 === used0 + good.outBytes, '本機用量含壓縮成品', `${used0} ${used1}`);

    // 播放：優先原檔
    const pb = await history.createPlayback({ sourceIds: [sid], from: t0 - 1000, to: t0 + 60_000 }, actor, req);
    const token = pb.sessions[0].manifestUrl.split('/')[4];
    const app = express();
    app.get('/seg/:id', (q, r) => history.sendSegment(token, q.params.id, { headers: { ...req.headers, range: q.headers.range } }, r).catch((e) => r.status(e.getStatus?.() ?? 500).end(e.message)));
    server = app.listen(0);
    const port = server.address().port;
    const get = (id, range = 'bytes=0-999') => new Promise((resolve) => http.get({ port, path: `/seg/${id}`, headers: { Range: range } }, (r) => { const c = []; r.on('data', (x) => c.push(x)); r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(c), len: r.headers['content-length'] })); }));
    const first = await get(id1);
    ok(first.status === 206 && first.body.equals(fs.readFileSync(storage.localPath(k1)).subarray(0, 1000)), '有原檔時播放原檔（Range 206）');

    // 取代原檔
    fs.rmSync(storage.localPath(renditionKey(k1, 'av1')));
    await ds.query(`DELETE FROM video_segment_objects WHERE segment_id = $1 AND rendition = 'av1'`, [id1]);
    const rep = await archive.compressSegment(id1, 'av1', { minSavingPct: 10, minVmaf: 80, replaceOriginal: true });
    const after = await ds.query(`SELECT rendition, status FROM video_segment_objects WHERE segment_id = $1 ORDER BY rendition`, [id1]);
    ok(rep.replaced && !fs.existsSync(storage.localPath(k1)) && after.find((o) => o.rendition === 'original').status === 'DELETED', '明確開啟取代原檔：驗證後才刪原檔', JSON.stringify(after));
    const second = await get(id1);
    ok(second.status === 206 && second.body.equals(fs.readFileSync(storage.localPath(renditionKey(k1, 'av1'))).subarray(0, 1000)), '原檔取代後改播壓縮成品（Range 206）');
    const used2 = (await storage.numbers()).usedBytes;
    ok(used2 === used1 - origBytes, '取代後本機用量扣掉原檔', `${used1} ${used2} ${origBytes}`);

    // 背景工作：排入與執行（HEVC）
    const queued = await archive.enqueueCompression({ codec: 'hevc', maxConcurrency: 1 });
    ok(queued >= 1, '背景排入壓縮工作', String(queued));
    const again = await archive.enqueueCompression({ codec: 'hevc', maxConcurrency: 1 });
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM video_jobs WHERE kind = 'compress' AND dedupe_key LIKE $1`, [`compress:${id2}:hevc`]);
    ok(n === 1, '同一片段不重複排入', `again=${again} n=${n}`);
    let ran = 0;
    for (let i = 0; i < 3; i++) ran += await archive.runCompression({ codec: 'hevc', maxConcurrency: 1, minSavingPct: 10, minVmaf: 80, replaceOriginal: false });
    const jobs = await ds.query(`SELECT status, result, error FROM video_jobs WHERE kind = 'compress' AND dedupe_key = $1`, [`compress:${id2}:hevc`]);
    console.log('  HEVC 結果', JSON.stringify(jobs[0]?.result ?? jobs[0]?.error));
    ok(ran >= 1 && jobs[0].status === 'succeeded' && jobs[0].result.kept === true, '背景 HEVC 壓縮完成並記錄結果', JSON.stringify(jobs));
    const stats = await archive.compressionStats();
    ok(stats.kept >= 1 && stats.savedBytes > 0 && stats.avgVmaf >= 80, '壓縮成果摘要', JSON.stringify(stats));

    // 雲端已有副本時回收本機檔（模擬 GCS 物件列）
    await ds.query(`INSERT INTO video_segment_objects (segment_id, rendition, storage_type, object_key, generation, bytes, status, created_at, updated_at) VALUES ($1, 'original', 'gcs', $2, '1', $3, 'READY', 1, 1)`, [id2, `itest/${k2}`, origBytes]);
    await ds.query(`UPDATE video_recording_segments SET status = 'REMOTE_READY' WHERE id = $1`, [id2]);
    storage.release([id2]);
    const freed = await storage.evictLocalCopies(1);
    const o2 = await ds.query(`SELECT rendition, storage_type, status FROM video_segment_objects WHERE segment_id = $1 ORDER BY storage_type, rendition`, [id2]);
    ok(freed > 0 && !fs.existsSync(storage.localPath(k2)) && o2.find((o) => o.storage_type === 'local' && o.rendition === 'original').status === 'DELETED', '雲端有完整副本才回收本機原檔', JSON.stringify(o2));
    ok(o2.find((o) => o.rendition === 'hevc').status === 'READY', '雲端沒有的壓縮成品不回收');
    await ds.query(`UPDATE video_segment_objects SET status = 'DELETED' WHERE segment_id = $1 AND rendition = 'hevc'`, [id2]);
    await ds.query(`UPDATE video_storage_policies SET gcs_bucket = 'itest-bucket' WHERE id = 'default'`);
    const remote = await get(id2);
    await ds.query(`UPDATE video_storage_policies SET gcs_bucket = $1 WHERE id = 'default'`, [policy0.gcsBucket]);
    ok(remote.status === 503 && /雲端片段暫時無法讀取/.test(remote.body.toString()), '本機已回收時改向雲端讀取（測試 bucket 不存在時明確報錯）', `${remote.status} ${remote.body}`);

    // 政策驗證
    const p = await storage.policy();
    const bad = await storage.updatePolicy({ expectedVersion: p.version, storageType: 'gcs', gcsBucket: 'itest-bucket' }, actor).then(() => 'ok', (e) => e.message);
    ok(/無法存取 GCS bucket/.test(bad), '切換 GCS 前先驗證 bucket 可存取', bad);
    const st = await storage.updatePolicy({ expectedVersion: p.version, compression: { enabled: true, codec: 'av1', minSavingPct: 15, minVmaf: 90 } }, actor);
    ok(st.policy.compression.enabled && st.policy.compression.replaceOriginal === false, '偵測到編碼器與 libvmaf 時可開啟壓縮，預設不取代原檔');
    await storage.updatePolicy({ expectedVersion: st.policy.version, compression: { ...policy0.compression } }, actor);
  } catch (e) {
    ok(false, '例外', e.stack);
  } finally {
    if (server) server.close();
    await ds.query(`UPDATE video_storage_policies SET compression = $1, gcs_bucket = $2 WHERE id = 'default'`, [JSON.stringify(policy0.compression), policy0.gcsBucket]);
    for (const id of created) {
      const revs = await ds.query(`SELECT media_path FROM video_source_revisions WHERE source_id = $1`, [id]);
      const segIds = (await ds.query(`SELECT id FROM video_recording_segments WHERE source_id = $1`, [id])).map((r) => r.id);
      for (const s of segIds) await ds.query(`DELETE FROM video_jobs WHERE kind = 'compress' AND dedupe_key LIKE $1`, [`compress:${s}:%`]);
      await ds.query(`DELETE FROM video_segment_objects WHERE segment_id = ANY($1::uuid[])`, [segIds]);
      await ds.query(`DELETE FROM video_recording_segments WHERE source_id = $1`, [id]);
      await ds.query(`UPDATE video_sources SET current_revision_id = NULL WHERE id = $1`, [id]);
      await ds.query(`DELETE FROM video_source_revisions WHERE source_id = $1`, [id]);
      await ds.query(`DELETE FROM video_sources WHERE id = $1`, [id]);
      for (const r of revs) fs.rmSync(path.join(VIDEO_CFG.recordingsDir, r.media_path), { recursive: true, force: true });
    }
    const left = await ds.query(`SELECT (SELECT count(*) FROM video_sources WHERE created_by = 'itest-video') + (SELECT count(*) FROM video_jobs WHERE kind = 'compress') AS n`);
    console.log(`殘留測試資料：${left[0].n}`);
    await releaseHold();
    await ds.destroy();
  }
  console.log(`${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

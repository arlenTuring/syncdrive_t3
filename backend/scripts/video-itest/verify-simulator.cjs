// 影像整合測試：模擬器上傳影片 → 模擬器攝影機（RTSP）→ 主系統來源、即時、錄影、歷史。
//
// 前提：模擬器（../syncdrive_t3_simulator）已啟動、影片庫至少有一個轉好相容格式的影片、
// 已設定「攝影機對外主機」為主系統拉得到的區網 IP。測試在模擬器建立自己的通道（itest-*），跑完刪除。
//
// 本機開發：
//   VIDEO_ITEST_ALLOW=1 VIDEO_ITEST_ENV=backend/.env node backend/scripts/video-itest/verify-simulator.cjs
// 參數（環境變數）：SIM_URL（預設 http://127.0.0.1:4300）
//
// 會在資料庫建立標記為 itest-video 的測試來源、標籤與片段、跑完清除；測試期間暫時放寬錄影儲存政策，結束還原。
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
const { videoConfig, segmentSeconds } = require(D + '/video/video.config.js');
const SEGMENT_SECONDS = segmentSeconds();
const VIDEO_CFG = videoConfig();
const { DataSource } = require('typeorm');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { execFileSync } = require('child_process');
const { VideoConfigService } = require(D + '/video/video-config.service.js');
const { VideoReconcilerService } = require(D + '/video/video-reconciler.service.js');
const { VideoLiveService } = require(D + '/video/video-live.service.js');
const { VideoStorageService } = require(D + '/video/video-storage.service.js');
const { VideoHistoryService } = require(D + '/video/video-history.service.js');
const { MediaMtxClient } = require(D + '/video/mediamtx.client.js');

const SIM = process.env.SIM_URL || 'http://127.0.0.1:4300';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${c ? '' : ' ' + extra}`); };
const note = (m) => console.log(`  · ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (t) => new Date(Number(t)).toISOString();

async function sim(method, route, body, retry = true) {
  let res;
  try {
    res = await fetch(`${SIM}/api/video${route}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch (error) {
    // 閒置太久後重用的 keep-alive 連線可能已被模擬器關掉：連線層失敗重試一次
    if (retry) return sim(method, route, body, false);
    throw error;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`模擬器 ${method} ${route} → ${res.status} ${json.error ?? ''}`);
  return json;
}

async function waitFor(fn, timeoutMs, stepMs = 1000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(stepMs);
  }
  return null;
}

(async () => {
  const ds = new DataSource({ type: 'postgres', host: process.env.DB_HOST, port: Number(process.env.DB_PORT), username: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, entities: [D + '/database/entities/*.entity.js', D + '/database/entities/video.entities.js'], synchronize: false });
  await ds.initialize();
  const [held] = await ds.query(`SELECT max_bytes, min_free_bytes FROM video_storage_policies WHERE id = 'default'`);
  const pausedBefore = await new VideoStorageService(ds, new MediaMtxClient(), new VideoConfigService(ds), { kick() {} }).status().then((st) => Boolean(st.paused), () => false);
  await ds.query(`UPDATE video_storage_policies SET max_bytes = 53687091200, min_free_bytes = 0 WHERE id = 'default'`);
  const releaseHold = () => ds.query(`UPDATE video_storage_policies SET max_bytes = $1, min_free_bytes = $2 WHERE id = 'default'`, [held?.max_bytes ?? null, held?.min_free_bytes ?? null]);
  const media = new MediaMtxClient();
  const config = new VideoConfigService(ds);
  const reconciler = new VideoReconcilerService(ds, media, config);
  const storage = new VideoStorageService(ds, media, config, reconciler);
  const cookie = 'itest-cookie';
  const actor = { id: 'itest-video', display_name: '測試員', roles: [], permissions: ['events.video-history.view'] };
  const auth = { authenticate: async (c) => (c === cookie ? { user: actor } : null) };
  const live = new VideoLiveService(media, config, auth);
  const history = new VideoHistoryService(ds, storage, auth);
  const req = { headers: { cookie: `syncdrive_session=${cookie}` } };
  const created = { sources: [], tabs: [], channel: null };
  let server;
  try {
    if (pausedBefore) {
      // 同時運行的後端／worker 每分鐘才重算一次空間；原政策下是暫停錄影，等它依放寬後的政策恢復
      note('原儲存政策下錄影暫停中，等候 worker 依測試政策恢復（約 1 分鐘）');
      await sleep(65_000);
    }
    // ── 模擬器端：建立並啟動測試通道 ──
    const state = await sim('GET', '/state');
    const asset = state.assets.find((a) => a.derived.some((d) => d.state === 'READY'));
    if (!asset) throw new Error('模擬器影片庫沒有轉好相容格式的影片；請先在模擬器上傳一個影片');
    if (!state.network.advertiseHost) throw new Error('模擬器尚未設定攝影機對外主機');
    const camera = `itest-${Date.now().toString(36)}`;
    const ch = await sim('POST', '/channels', { assetId: asset.id, vehicleCode: 'PMS01', cameraId: camera, name: `整合測試 ${camera}`, runSec: 600, loop: true });
    created.channel = ch.id;
    await sim('POST', `/channels/${ch.id}/start`, {});
    const running = await waitFor(async () => (await sim('GET', '/channels')).channels.find((c) => c.id === ch.id && c.state === 'RUNNING'), 60_000);
    ok(Boolean(running), '模擬器通道發布中（攝影機服務確認有影像）', JSON.stringify((await sim('GET', '/channels')).channels.find((c) => c.id === ch.id)));
    note(`影片 ${asset.name}（${asset.probe.durationSec}s，循環播放）→ /${ch.path}`);
    const sc = await sim('GET', `/channels/${ch.id}/source-config`);
    const cred = await sim('POST', '/read-credential', {});
    const connection = { mode: 'fields', protocol: sc.protocol, host: sc.host, port: sc.port, path: sc.path, username: sc.username, password: cred.password };
    ok(sc.host && !/^127\./.test(sc.host) && sc.recordingProfile === 'original' && sc.timestampBasis === 'center', '模擬器提供主系統來源欄位（區網主機、original、center）', JSON.stringify(sc));

    // ── 主系統：SSRF 保護仍在 ──
    const loop = await live.createTest({ connection: { ...connection, host: '127.0.0.1' } }, actor, req).then((r) => r.error ?? r.status, (e) => e.message);
    ok(/不允許|範圍/.test(loop), '127.0.0.1 仍被連線範圍擋下（未放寬 SSRF）', loop);

    // ── 主系統：測試連線（真實拉流、取得編碼） ──
    const test = await live.createTest({ connection }, actor, req);
    const tracks = (test.tracks ?? []).map((t) => String(t.codec ?? t).toLowerCase());
    ok(test.status === 'ready' && tracks.some((t) => t.includes('264')) && !JSON.stringify(test).includes(cred.password), '主系統測試連線成功、取得 H.264、回應不含密碼', JSON.stringify(test));
    if (test.id) await live.deleteTest(test.id, actor).catch(() => undefined);

    // ── 主系統：建立來源、兩格同源並要求錄影 ──
    const sid = await config.createSource({ name: sc.name, connection, vehicleCode: sc.vehicleCode, cameraId: sc.cameraId, recordingProfile: 'original', timestampBasis: 'center' }, actor);
    created.sources.push(sid);
    const tab = await config.createTab({ name: '模擬器整合測試', tileCount: 4 }, actor);
    created.tabs.push(tab.id);
    let tiles = await config.saveTiles(tab.id, { expectedVersion: tab.version, tiles: [{ position: 0, sourceId: sid }, { position: 1, sourceId: sid }] });
    await reconciler.reconcile();
    const rev = (await config.getSource(sid));
    const revRow = (await ds.query(`SELECT id, media_path FROM video_source_revisions WHERE source_id = $1`, [sid]))[0];
    const mtxPaths = (await media.listConfigPaths()).filter((p) => p.name === revRow.media_path);
    ok(mtxPaths.length === 1 && mtxPaths[0].record === true, '兩格同源只建立一條媒體路徑並錄影', JSON.stringify(mtxPaths.map((p) => ({ n: p.name, r: p.record }))));
    note(`sourceId=${sid} revision=${revRow.id} mediaPath=${revRow.media_path} vehicle=${rev.vehicleCode}`);
    const online = await waitFor(async () => {
      await reconciler.reconcile();
      const st = (await config.getSource(sid)).actualStatus;
      return st.state === 'online' && st.recording ? st : null;
    }, 30_000);
    ok(Boolean(online), '主系統來源連線中且錄影中', JSON.stringify((await config.getSource(sid)).actualStatus));
    const simReaders = await waitFor(async () => {
      const c = (await sim('GET', '/channels')).channels.find((x) => x.id === ch.id);
      return c.readers > 0 ? c.readers : null;
    }, 15_000);
    ok(simReaders >= 1, '模擬器看到主系統在讀取', String(simReaders));

    // ── 即時：主系統媒體服務的 HLS（瀏覽器 HLS 備援用的同一條）有內容 ──
    const authHeader = `Basic ${Buffer.from(`${VIDEO_CFG.user}:${VIDEO_CFG.password}`).toString('base64')}`;
    const hls = await waitFor(async () => {
      const r = await fetch(`${VIDEO_CFG.hlsUrl}/${revRow.media_path}/index.m3u8`, { headers: { Authorization: authHeader } }).catch(() => null);
      return r?.ok ? r.text() : null;
    }, 20_000);
    ok(Boolean(hls && hls.includes('#EXTM3U')), '主系統媒體服務產生 HLS（播放器備援路徑）', String(hls).slice(0, 80));

    // ── 錄影：至少兩個真實完成的片段 ──
    const t0 = Date.now();
    const rounds = Math.ceil((SEGMENT_SECONDS * 2 + 60) / 3);
    let segs = [];
    for (let i = 0; i < rounds && segs.length < 2; i++) {
      await sleep(3000);
      segs = await ds.query(`SELECT * FROM video_recording_segments WHERE source_id = $1 AND status = 'READY' ORDER BY start_at`, [sid]);
    }
    ok(segs.length >= 2, `錄影完成至少兩段（分段 ${SEGMENT_SECONDS} 秒）`, `segments=${segs.length}`);
    for (const s of segs.slice(0, 3)) note(`片段 ${iso(s.start_at)} → ${iso(s.end_at)}（${Number(s.bytes)} bytes）${s.segment_key}`);
    const file = storage.localPath(segs[0].segment_key);
    ok(fs.existsSync(file) && fs.statSync(file).size > 0, '片段實體檔存在');
    const probe = JSON.parse(execFileSync(VIDEO_CFG.ffprobePath || 'ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_packets:format=duration', '-of', 'json', file]).toString());
    const vs = probe.streams[0];
    ok(vs.codec_name === 'h264' && Number(vs.nb_read_packets) > 10 && Number(probe.format.duration) > 1, '錄影片段可解碼、有實際影像內容', JSON.stringify(probe));
    const gapBetween = Number(segs[1].start_at) - Number(segs[0].end_at);
    ok(Math.abs(gapBetween) < 1500, '循環播放跨檔尾：相鄰片段連續（無固定缺段）', `${gapBetween}ms`);

    // ── 歷史：manifest、Range 206 ──
    const pb = await history.createPlayback({ sourceIds: [sid], from: t0 - 120_000, to: Date.now() }, actor, req);
    const token = pb.sessions[0].manifestUrl.split('/')[4];
    const manifest = await history.manifest(token, req);
    ok(manifest.segments.length >= 2 && manifest.timeline.some((x) => x.kind === 'available'), '歷史 manifest 列出片段與可用時段');
    const app = express();
    app.get('/seg/:id', (q, r) => history.sendSegment(token, q.params.id, { headers: { ...req.headers, range: q.headers.range } }, r).catch((e) => r.status(e.getStatus?.() ?? 500).end(e.message)));
    server = app.listen(0);
    const port = server.address().port;
    const range = await new Promise((resolve) => http.get({ port, path: `/seg/${manifest.segments[0].id}`, headers: { Range: 'bytes=0-65535' } }, (r) => { let n = 0; r.on('data', (c) => (n += c.length)); r.on('end', () => resolve({ status: r.statusCode, n })); }));
    ok(range.status === 206 && range.n === 65536, '歷史片段 Range 回 206', JSON.stringify(range));

    // ── 中斷：停止模擬器通道 → 主系統離線；重新開始 → 有真實缺段與新錄影 ──
    const stopAt = Date.now();
    await sim('POST', `/channels/${ch.id}/stop`, {});
    const offline = await waitFor(async () => {
      await reconciler.reconcile();
      const st = (await config.getSource(sid)).actualStatus;
      return st.state !== 'online' ? st : null;
    }, 30_000, 2000);
    ok(Boolean(offline), '模擬器停止後主系統來源顯示未連線', JSON.stringify((await config.getSource(sid)).actualStatus));
    await sleep(Math.max(5000, 20_000 - (Date.now() - stopAt)));
    const restartAt = Date.now();
    await sim('POST', `/channels/${ch.id}/start`, {});
    await waitFor(async () => (await sim('GET', '/channels')).channels.find((c) => c.id === ch.id && c.state === 'RUNNING'), 60_000);
    const resumed = await waitFor(async () => {
      await reconciler.reconcile();
      const rows = await ds.query(`SELECT * FROM video_recording_segments WHERE source_id = $1 AND status = 'READY' AND start_at >= $2 ORDER BY start_at`, [sid, restartAt - 2000]);
      return rows.length ? rows : null;
    }, (SEGMENT_SECONDS * 2 + 60) * 1000, 3000);
    ok(Boolean(resumed), '重新開始後有新錄影片段', `restartAt=${iso(restartAt)}`);
    const tl = await history.timeline(sid, t0 - 60_000, Date.now(), true);
    const gap = tl.find((x) => x.kind === 'gap' && x.from >= stopAt - SEGMENT_SECONDS * 1000 && x.to <= restartAt + SEGMENT_SECONDS * 1000);
    ok(Boolean(gap), '時間軸在停止期間顯示真實缺段', JSON.stringify(tl.map((x) => [x.kind, iso(x.from).slice(11, 19), iso(x.to).slice(11, 19)])));
    if (gap) note(`缺段 ${iso(gap.from)} → ${iso(gap.to)}`);

    // ── 取消錄影需求：即時仍可看、不再新增正式錄影、歷史保留 ──
    const before = Number((await ds.query(`SELECT count(*) FROM video_recording_segments WHERE source_id = $1 AND status = 'READY'`, [sid]))[0].count);
    tiles = await config.saveTiles(tab.id, { expectedVersion: tiles.version, tiles: [{ position: 0, sourceId: sid, recordingRequested: false }, { position: 1, sourceId: sid, recordingRequested: false }] });
    const cancelAt = Date.now();
    await reconciler.reconcile();
    const pathAfter = (await media.listConfigPaths()).find((p) => p.name === revRow.media_path);
    ok(pathAfter && pathAfter.record === false, '取消錄影需求後媒體服務停止錄影（路徑仍在供即時）', JSON.stringify(pathAfter && { record: pathAfter.record }));
    await sleep((SEGMENT_SECONDS + 15) * 1000);
    const newer = await ds.query(`SELECT count(*) FROM video_recording_segments WHERE source_id = $1 AND start_at > $2`, [sid, cancelAt + 3000]);
    const after = Number((await ds.query(`SELECT count(*) FROM video_recording_segments WHERE source_id = $1 AND status = 'READY'`, [sid]))[0].count);
    ok(Number(newer[0].count) === 0 && after >= before, '取消後沒有新增錄影、既有歷史保留', `new=${newer[0].count} before=${before} after=${after}`);
    const hls2 = await fetch(`${VIDEO_CFG.hlsUrl}/${revRow.media_path}/index.m3u8`, { headers: { Authorization: authHeader } }).catch(() => null);
    ok(Boolean(hls2?.ok), '取消錄影後即時串流仍可用');
  } catch (e) {
    ok(false, '例外', e.stack);
  } finally {
    if (server) server.close();
    if (created.channel) {
      await sim('POST', `/channels/${created.channel}/stop`, {}).catch(() => undefined);
      await sim('DELETE', `/channels/${created.channel}`).catch(() => undefined);
    }
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
    for (const p of (await media.listConfigPaths().catch(() => [])).filter((p) => p.name.startsWith('vt_'))) await media.deletePath(p.name);
    const left = await ds.query(`SELECT (SELECT count(*) FROM video_sources WHERE created_by = 'itest-video') AS n`);
    console.log(`殘留測試資料：${left[0].n}`);
    await releaseHold();
    await ds.destroy();
  }
  console.log(`${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

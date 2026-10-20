// 影像負載測試（限時）：模擬器 N 個獨立通道 → 主系統 N 個來源同時拉流並錄影。
//
// 量測：模擬器通道就緒時間、主系統來源連線時間、每路錄影片段實測 fps（ffprobe 解碼）、
// 模擬器推流程序與兩個媒體服務容器的 CPU／記憶體、模擬器影片庫是否沒有複製檔案。
// 每路都是獨立通道與獨立來源（不是 12 格指同一來源）。
//
//   VIDEO_ITEST_ALLOW=1 VIDEO_ITEST_ENV=backend/.env node backend/scripts/video-itest/verify-simulator-load.cjs [路數=12]
//
// 只建立並刪除自己的測試通道（itest-load-*）與來源；暫時放寬錄影儲存政策，結束還原。
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
const VIDEO_CFG = videoConfig();
const { DataSource } = require('typeorm');
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const { VideoConfigService } = require(D + '/video/video-config.service.js');
const { VideoReconcilerService } = require(D + '/video/video-reconciler.service.js');
const { VideoStorageService } = require(D + '/video/video-storage.service.js');
const { MediaMtxClient } = require(D + '/video/mediamtx.client.js');

const SIM = process.env.SIM_URL || 'http://127.0.0.1:4300';
const N = Math.min(12, Math.max(1, Number(process.argv[2]) || 12));
const DOCKER = process.env.DOCKER || (fs.existsSync('/Applications/Docker.app/Contents/Resources/bin/docker') ? '/Applications/Docker.app/Contents/Resources/bin/docker' : 'docker');
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${c ? '' : ' ' + extra}`); };
const note = (m) => console.log(`  · ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

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

function dockerStats(names) {
  const r = spawnSync(DOCKER, ['stats', '--no-stream', '--format', '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}', ...names], { encoding: 'utf8', timeout: 30_000 });
  return (r.stdout ?? '').trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
}

function simPublishers() {
  const r = spawnSync('ps', ['-axo', 'pid=,%cpu=,rss=,command='], { encoding: 'utf8' });
  return (r.stdout ?? '').split('\n').filter((l) => /ffmpeg .* -f rtsp /.test(l) && l.includes('/sim/')).map((l) => {
    const [pid, cpu, rss] = l.trim().split(/\s+/);
    return { pid: Number(pid), cpu: Number(cpu), rssMb: Number(rss) / 1024 };
  });
}

(async () => {
  const ds = new DataSource({ type: 'postgres', host: process.env.DB_HOST, port: Number(process.env.DB_PORT), username: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, entities: [D + '/database/entities/*.entity.js', D + '/database/entities/video.entities.js'], synchronize: false });
  await ds.initialize();
  const [held] = await ds.query(`SELECT max_bytes, min_free_bytes FROM video_storage_policies WHERE id = 'default'`);
  const pausedBefore = await new VideoStorageService(ds, new MediaMtxClient(), new VideoConfigService(ds), { kick() {} }).status().then((st) => Boolean(st.paused), () => false);
  await ds.query(`UPDATE video_storage_policies SET max_bytes = 53687091200, min_free_bytes = 0 WHERE id = 'default'`);
  const media = new MediaMtxClient();
  const config = new VideoConfigService(ds);
  const reconciler = new VideoReconcilerService(ds, media, config);
  const actor = { id: 'itest-video', display_name: '測試員', roles: [], permissions: [] };
  const created = { channels: [], sources: [], tabs: [] };
  try {
    if (pausedBefore) {
      note('原儲存政策下錄影暫停中，等候 worker 依測試政策恢復（約 1 分鐘）');
      await sleep(65_000);
    }
    const state = await sim('GET', '/state');
    const asset = state.assets.find((a) => a.derived.some((d) => d.state === 'READY'));
    if (!asset) throw new Error('模擬器影片庫沒有轉好相容格式的影片');
    const libraryBefore = state.usage.originals + state.usage.derived;
    const cred = await sim('POST', '/read-credential', {});
    const vehicles = ['PMS01', 'PMS02', 'PMS03', 'PMS04', 'PMS05', 'PMS06', 'PMS07', 'PMS08', 'PMS09', 'PMS10', 'PMS11', null];
    const tag = Date.now().toString(36);
    for (let i = 0; i < N; i++) {
      const ch = await sim('POST', '/channels', { assetId: asset.id, vehicleCode: vehicles[i], cameraId: `itest-load-${tag}-${i + 1}`, name: `負載測試 ${i + 1}`, runSec: 600, loop: true });
      created.channels.push(ch.id);
    }
    const t0 = Date.now();
    await Promise.all(created.channels.map((id) => sim('POST', `/channels/${id}/start`, {})));
    const readyAt = new Map();
    while (readyAt.size < N && Date.now() - t0 < 120_000) {
      for (const c of (await sim('GET', '/channels')).channels) if (created.channels.includes(c.id) && c.state === 'RUNNING' && !readyAt.has(c.id)) readyAt.set(c.id, Date.now() - t0);
      await sleep(250);
    }
    const simReady = [...readyAt.values()];
    ok(readyAt.size === N, `模擬器 ${N} 個獨立通道都在發布`, `${readyAt.size}/${N}`);
    note(`模擬器通道就緒（啟動到攝影機服務確認有影像）p50 ${pct(simReady, 50)} ms、p95 ${pct(simReady, 95)} ms`);
    const libraryAfter = (await sim('GET', '/state')).usage;
    ok(libraryAfter.originals + libraryAfter.derived === libraryBefore, `${N} 路共用同一份相容檔，影片庫沒有增加檔案`, `${libraryBefore} → ${libraryAfter.originals + libraryAfter.derived}`);

    // 主系統：N 個來源、一個 N 格標籤，全部要求錄影
    const tab = await config.createTab({ name: `模擬器負載 ${N} 路`, tiles: Array.from({ length: N }, (_, i) => ({ x: (i % 4) * 2500, y: Math.floor(i / 4) * 3333, w: 2500, h: 3333 })) }, actor);
    created.tabs.push(tab.id);
    const tiles = [];
    for (const [i, id] of created.channels.entries()) {
      const sc = await sim('GET', `/channels/${id}/source-config`);
      const sid = await config.createSource({ name: sc.name, connection: { mode: 'fields', protocol: 'rtsp', host: sc.host, port: sc.port, path: sc.path, username: sc.username, password: cred.password }, vehicleCode: sc.vehicleCode, cameraId: sc.cameraId, recordingProfile: 'original', timestampBasis: 'center' }, actor);
      created.sources.push(sid);
      tiles.push(sid);
    }
    for (const [i, sid] of tiles.entries()) await config.bindTileSource(tab.id, tab.tiles[i].id, { expectedVersion: tab.tiles[i].version, sourceId: sid });
    const p0 = Date.now();
    await reconciler.reconcile();
    const onlineAt = new Map();
    while (onlineAt.size < N && Date.now() - p0 < 90_000) {
      await reconciler.reconcile();
      for (const sid of created.sources) {
        if (onlineAt.has(sid)) continue;
        const st = (await config.getSource(sid)).actualStatus;
        if (st.state === 'online' && st.recording) onlineAt.set(sid, Date.now() - p0);
      }
      await sleep(1000);
    }
    ok(onlineAt.size === N, `主系統 ${N} 個來源都連線並錄影`, `${onlineAt.size}/${N}`);
    note(`主系統來源連線（設定到媒體服務回報 online）p50 ${pct([...onlineAt.values()], 50)} ms、p95 ${pct([...onlineAt.values()], 95)} ms（含 reconcile 輪詢間隔）`);

    // 資源量測：穩定後取 3 次
    await sleep(10_000);
    const samples = [];
    for (let i = 0; i < 3; i++) {
      samples.push({ pubs: simPublishers(), stats: dockerStats(['syncdrive_sim_video', 'syncdrive_mediamtx']) });
      await sleep(4000);
    }
    const pubs = samples.at(-1).pubs;
    ok(pubs.length === N, `模擬器有 ${N} 個推流程序`, String(pubs.length));
    const avgCpu = samples.map((s) => s.pubs.reduce((a, p) => a + p.cpu, 0));
    note(`模擬器推流 ffmpeg 合計 CPU ${avgCpu.map((c) => c.toFixed(1)).join('／')} %（單核百分比，三次取樣），每個約 ${(pubs.reduce((a, p) => a + p.rssMb, 0) / Math.max(1, pubs.length)).toFixed(1)} MB RSS`);
    for (const [name, cpu, mem] of samples.at(-1).stats) note(`${name}：CPU ${cpu}、記憶體 ${mem}`);
    const chs = (await sim('GET', '/channels')).channels.filter((c) => created.channels.includes(c.id));
    const fpsList = chs.map((c) => c.stats?.fps).filter((v) => typeof v === 'number');
    note(`模擬器實測推流 fps：最低 ${Math.min(...fpsList)}、最高 ${Math.max(...fpsList)}；碼率 ${chs.map((c) => c.stats?.bitrateKbps ?? '—').join('、')} kbps`);
    ok(fpsList.length === N && Math.min(...fpsList) >= 14, `每路推流實測 ≥14 fps（目標 15 fps，官方要求 ≥10 Hz）`, JSON.stringify(fpsList));
    ok(chs.every((c) => c.readers >= 1), '每路都有主系統在讀取', JSON.stringify(chs.map((c) => c.readers)));

    // 每路至少一個完成片段，並實際解碼量 fps
    const deadline = Date.now() + (segmentSeconds() * 2 + 60) * 1000;
    let rows = [];
    while (Date.now() < deadline) {
      rows = await ds.query(`SELECT DISTINCT ON (source_id) source_id, segment_key, start_at, end_at FROM video_recording_segments WHERE source_id = ANY($1::uuid[]) AND status = 'READY' AND end_at - start_at >= $2 ORDER BY source_id, start_at`, [created.sources, (segmentSeconds() - 2) * 1000]);
      if (rows.length >= N) break;
      await sleep(3000);
    }
    ok(rows.length === N, `${N} 路都有完整錄影片段`, `${rows.length}/${N}`);
    const decoded = [];
    for (const r of rows) {
      const file = path.join(VIDEO_CFG.recordingsDir, r.segment_key);
      const out = JSON.parse(execFileSync(VIDEO_CFG.ffprobePath || 'ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames:format=duration', '-of', 'json', file]).toString());
      const frames = Number(out.streams[0].nb_read_frames);
      const duration = Number(out.format.duration);
      decoded.push({ fps: Math.round((frames / duration) * 10) / 10, w: out.streams[0].width, h: out.streams[0].height });
    }
    const fpsRec = decoded.map((d) => d.fps);
    note(`主系統錄影片段解碼實測 fps：最低 ${Math.min(...fpsRec)}、最高 ${Math.max(...fpsRec)}（${decoded[0]?.w}×${decoded[0]?.h}）`);
    ok(decoded.length === N && Math.min(...fpsRec) >= 14, `${N} 路錄影實際解碼都 ≥14 fps`, JSON.stringify(fpsRec));
  } catch (e) {
    ok(false, '例外', e.stack);
  } finally {
    for (const id of created.channels) {
      await sim('POST', `/channels/${id}/stop`, {}).catch(() => undefined);
      await sim('DELETE', `/channels/${id}`).catch(() => undefined);
    }
    const leftover = await sim('GET', '/channels').then((r) => r.channels.filter((c) => created.channels.includes(c.id)), () => []);
    if (leftover.length) console.log(`  ! 模擬器仍有 ${leftover.length} 個測試通道未清除：${leftover.map((c) => `${c.name}=${c.state}`).join('、')}`);
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
    const left = await ds.query(`SELECT (SELECT count(*) FROM video_sources WHERE created_by = 'itest-video') AS n`);
    console.log(`殘留測試資料：${left[0].n}`);
    await ds.query(`UPDATE video_storage_policies SET max_bytes = $1, min_free_bytes = $2 WHERE id = 'default'`, [held?.max_bytes ?? null, held?.min_free_bytes ?? null]);
    await ds.destroy();
  }
  console.log(`${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

import { join, resolve } from 'node:path';

/**
 * 影像服務的部署設定（環境變數）。一般使用者在畫面上不會看到這些名詞。
 *
 * - MediaMTX：負責接入（RTSP／RTMP／HLS／SRT）、即時 HLS／WebRTC 與分段錄影；後端只管設定、授權與索引。
 * - 錄影根目錄由部署指定（獨立 volume），不能由使用者輸入路徑。
 */
export const videoConfig = () => {
  const recordingsDir = resolve(process.env.VIDEO_RECORDINGS_DIR || join(process.cwd(), 'data', 'video', 'recordings'));
  return {
    apiUrl: process.env.VIDEO_MEDIAMTX_API_URL || 'http://127.0.0.1:9997',
    playbackUrl: process.env.VIDEO_MEDIAMTX_PLAYBACK_URL || 'http://127.0.0.1:9996',
    hlsUrl: process.env.VIDEO_MEDIAMTX_HLS_URL || 'http://127.0.0.1:8888',
    webrtcUrl: process.env.VIDEO_MEDIAMTX_WEBRTC_URL || 'http://127.0.0.1:8889',
    user: process.env.VIDEO_MEDIAMTX_USER || 'vtms',
    password: process.env.VIDEO_MEDIAMTX_PASSWORD || '',
    /** 後端看到的錄影根目錄 */
    recordingsDir,
    /** MediaMTX 容器內的錄影根目錄（寫在 recordPath 與 hook 回報的檔案路徑） */
    mediamtxRecordingsDir: process.env.VIDEO_MEDIAMTX_RECORDINGS_DIR || '/recordings',
    exportsDir: resolve(process.env.VIDEO_EXPORTS_DIR || join(process.cwd(), 'data', 'video', 'exports')),
    hookSecret: process.env.VIDEO_HOOK_SECRET || '',
    /** 正式環境由 nginx 直接送檔（X-Accel-Redirect 內部路徑前綴）；空白＝後端以串流送檔 */
    accelRedirectPrefix: process.env.VIDEO_ACCEL_REDIRECT_PREFIX || '',
    /** api：只處理 API；worker：只跑背景工作；all：兩者（本機開發） */
    role: (process.env.VIDEO_ROLE || 'all') as 'api' | 'worker' | 'all',
    enabled: process.env.VIDEO_ENABLED !== '0' && process.env.NODE_ENV !== 'test',
    ffmpegPath: process.env.VIDEO_FFMPEG_PATH || 'ffmpeg',
    ffprobePath: process.env.VIDEO_FFPROBE_PATH || 'ffprobe',
    /** ffmpeg 沒有 libvmaf 時改用 Netflix 的 vmaf 程式（正式映像建置時編譯） */
    vmafPath: process.env.VIDEO_VMAF_PATH || 'vmaf',
  };
};

export const MEDIA_PATH_PREFIX = 'vs_';
export const TEST_PATH_PREFIX = 'vt_';
export const TILE_MAX = 12;
export const PLAYBACK_SOURCES_MAX = 12;
export const PLAYBACK_SPAN_MAX_MS = 24 * 3_600_000;
export const EXPORT_SPAN_MAX_MS = 30 * 60_000;
export const SOURCE_TEST_TTL_MS = 2 * 60_000;
export const SOURCE_TEST_CONCURRENCY = 3;
/** 持久片段長度（初值約 60 秒；實際切分依關鍵幀）。VIDEO_SEGMENT_SECONDS 僅供測試縮短，最少 10 秒 */
export const SEGMENT_SECONDS = Math.max(10, Number(process.env.VIDEO_SEGMENT_SECONDS) || 60);
export const GIB = 1024 ** 3;

export const mediaPathOf = (revisionId: string) => `${MEDIA_PATH_PREFIX}${revisionId.replace(/-/g, '')}`;

import { spawn } from 'node:child_process';
import { accessToken } from './gcs.client';
import { videoConfig } from './video.config';

/** 以固定參數（argv，不經 shell）執行程式並收集輸出；有逾時與輸出上限 */
export function run(cmd: string, args: string[], timeoutMs: number, nice = false): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const [bin, argv] = nice && process.platform !== 'win32' ? ['nice', ['-n', '19', cmd, ...args]] : [cmd, args];
    const child = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const cap = (s: string, chunk: Buffer) => (s.length > 200_000 ? s : s + chunk.toString('utf8'));
    child.stdout.on('data', (c: Buffer) => (stdout = cap(stdout, c)));
    child.stderr.on('data', (c: Buffer) => (stderr = cap(stderr, c)));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr || 'spawn failed' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export type Capabilities = {
  ffmpeg: boolean;
  encoders: { h264: string[]; hevc: string[]; av1: string[] };
  vmaf: boolean;
  /** 畫質評估工具：ffmpeg 內建 libvmaf，或獨立的 vmaf 程式 */
  vmafTool: 'ffmpeg' | 'cli' | null;
  hwaccels: string[];
  storage: { local: true; gcs: boolean };
  protocols: string[];
  checkedAt: number;
};

let cached: Capabilities | null = null;

/** 實際探測可用的編碼器、品質評估與硬體加速（快取 10 分鐘）；畫面只依這個結果顯示可選項目 */
export async function probeCapabilities(force = false): Promise<Capabilities> {
  // 偵測失敗（例如主機忙碌逾時）只快取 30 秒，避免一次失敗就整段時間顯示不可用
  if (cached && !force && Date.now() - cached.checkedAt < (cached.ffmpeg ? 600_000 : 30_000)) return cached;
  const { ffmpegPath, vmafPath } = videoConfig();
  const [enc, fil, hw, gcs, cli] = await Promise.all([
    run(ffmpegPath, ['-hide_banner', '-encoders'], 10_000),
    run(ffmpegPath, ['-hide_banner', '-filters'], 10_000),
    run(ffmpegPath, ['-hide_banner', '-hwaccels'], 10_000),
    // 只有在 GCP 主機上（有服務身分）才能用 GCS
    accessToken().then(() => true, () => false),
    run(vmafPath, ['--version'], 10_000),
  ]);
  const filterVmaf = fil.code === 0 && /\blibvmaf\b/.test(fil.stdout);
  const cliVmaf = cli.code === 0;
  const names = enc.code === 0 ? [...enc.stdout.matchAll(/^\s*V\S*\s+(\S+)\s+.*\(codec (\w+)\)/gm)].map((m) => ({ name: m[1], codec: m[2] })) : [];
  const pick = (codec: string) => names.filter((n) => n.codec === codec).map((n) => n.name);
  cached = {
    ffmpeg: enc.code === 0,
    encoders: { h264: pick('h264'), hevc: pick('hevc'), av1: pick('av1') },
    vmaf: filterVmaf || cliVmaf,
    vmafTool: filterVmaf ? 'ffmpeg' : cliVmaf ? 'cli' : null,
    hwaccels: hw.code === 0 ? hw.stdout.split('\n').slice(1).map((s) => s.trim()).filter(Boolean) : [],
    storage: { local: true, gcs },
    protocols: ['rtsp', 'rtsps', 'rtmp', 'rtmps', 'hls（http/https）', 'srt'],
    checkedAt: Date.now(),
  };
  return cached;
}

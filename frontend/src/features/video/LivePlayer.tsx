import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from './api';

export type PlayerStats = {
  state: 'idle' | 'connecting' | 'playing' | 'error';
  transport: 'webrtc' | 'hls' | null;
  error: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  droppedFrames: number | null;
  latencyMs: number | null;
};

const EMPTY: PlayerStats = { state: 'idle', transport: null, error: null, width: null, height: null, fps: null, droppedFrames: null, latencyMs: null };
const RETRY_BASE_MS = 3_000;
const RETRY_MAX_MS = 60_000;

/**
 * 即時播放器：先試 WebRTC（WHEP），5 秒內沒有畫面就改用 HLS（hls.js；Safari 用原生）。
 *
 * - 預設靜音；只有使用者開啟的那一格才有聲音。
 * - 斷線時有上限的指數退避重連（含抖動），避免多格同時高頻重試。
 * - 品質數據來自實際量測（畫面每幀回呼算 fps、播放品質的丟幀數）；量不到就是 null（畫面顯示未知），不填假數字。
 * - 卸載、換來源時關閉連線並釋放播放器。
 */
export function LivePlayer({
  hlsUrl,
  whepUrl,
  muted = true,
  onStats,
  onExpired,
  className = '',
  preferHls = false,
}: {
  hlsUrl: string | null;
  whepUrl: string | null;
  muted?: boolean;
  onStats?: (stats: PlayerStats) => void;
  /** 權杖過期（403）時要求外層重新取得播放資訊 */
  onExpired?: () => void;
  className?: string;
  preferHls?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const statsRef = useRef<PlayerStats>(EMPTY);
  const onStatsRef = useRef(onStats);
  const onExpiredRef = useRef(onExpired);
  useEffect(() => {
    onStatsRef.current = onStats;
    onExpiredRef.current = onExpired;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return undefined;
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let whepSession: string | null = null;
    let hls: Hls | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let frameHandle = 0;
    let frames = 0;
    let lastSample = performance.now();

    const report = (patch: Partial<PlayerStats>) => {
      statsRef.current = { ...statsRef.current, ...patch };
      onStatsRef.current?.(statsRef.current);
    };
    const retry = (message: string) => {
      if (cancelled) return;
      report({ state: 'error', error: message });
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempt, 5)) * (0.8 + Math.random() * 0.4);
      retryTimer = setTimeout(() => !cancelled && setAttempt((n) => n + 1), delay);
    };
    const countFrames = () => {
      if (cancelled || !('requestVideoFrameCallback' in video)) return;
      frameHandle = (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(() => {
        frames += 1;
        countFrames();
      });
    };
    const sampler = setInterval(() => {
      const now = performance.now();
      const fps = 'requestVideoFrameCallback' in video && frames > 0 ? Math.round((frames * 1000) / (now - lastSample)) : null;
      frames = 0;
      lastSample = now;
      const quality = typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality() : null;
      const latency = hls?.latency ? Math.round(hls.latency * 1000) : null;
      report({ width: video.videoWidth || null, height: video.videoHeight || null, fps, droppedFrames: quality ? quality.droppedVideoFrames : null, latencyMs: latency });
    }, 2_000);

    const startHls = () => {
      if (cancelled) return;
      report({ state: 'connecting', transport: 'hls', error: null });
      const src = mediaUrl(hlsUrl);
      if (Hls.isSupported()) {
        hls = new Hls({ lowLatencyMode: true, backBufferLength: 10, xhrSetup: (xhr) => { xhr.withCredentials = true; } });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          const status = (data.response as { code?: number } | undefined)?.code;
          if (status === 403) onExpiredRef.current?.();
          retry(status === 403 ? '播放授權已過期' : status === 404 ? '來源尚未連線或沒有畫面' : '影像中斷，稍後自動重連');
        });
        hls.loadSource(src);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
      } else {
        report({ state: 'error', error: '此瀏覽器無法播放 HLS' });
      }
    };

    const startWebRtc = async () => {
      if (!whepUrl || typeof RTCPeerConnection === 'undefined') return false;
      report({ state: 'connecting', transport: 'webrtc', error: null });
      try {
        pc = new RTCPeerConnection();
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
        const stream = new MediaStream();
        pc.ontrack = (event) => {
          stream.addTrack(event.track);
          video.srcObject = stream;
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const response = await fetch(mediaUrl(whepUrl), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp });
        if (response.status === 403) onExpiredRef.current?.();
        if (!response.ok) throw new Error(String(response.status));
        whepSession = response.headers.get('Location');
        await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
        // 5 秒內沒有實際畫面（例如 UDP 不通）就改用 HLS
        const playing = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), 5_000);
          video.addEventListener('playing', () => {
            clearTimeout(timer);
            resolve(true);
          }, { once: true });
          void video.play().catch(() => undefined);
        });
        if (!playing) throw new Error('timeout');
        pc.onconnectionstatechange = () => {
          if (pc && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) retry('影像中斷，稍後自動重連');
        };
        return true;
      } catch {
        pc?.close();
        pc = null;
        video.srcObject = null;
        return false;
      }
    };

    const onPlaying = () => report({ state: 'playing', error: null });
    video.addEventListener('playing', onPlaying);
    countFrames();
    void (async () => {
      const ok = !preferHls && (await startWebRtc());
      if (!ok && !cancelled) startHls();
      void video.play().catch(() => undefined);
    })();

    return () => {
      cancelled = true;
      clearInterval(sampler);
      if (retryTimer) clearTimeout(retryTimer);
      if (frameHandle && 'cancelVideoFrameCallback' in video) (video as HTMLVideoElement & { cancelVideoFrameCallback: (h: number) => void }).cancelVideoFrameCallback(frameHandle);
      video.removeEventListener('playing', onPlaying);
      hls?.destroy();
      pc?.close();
      if (whepSession) void fetch(mediaUrl(whepSession), { method: 'DELETE', credentials: 'include' }).catch(() => undefined);
      video.srcObject = null;
      video.removeAttribute('src');
      video.load();
      statsRef.current = EMPTY;
    };
  }, [hlsUrl, whepUrl, attempt, preferHls]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  return <video ref={videoRef} muted={muted} playsInline autoPlay className={`h-full w-full bg-black object-contain ${className}`} />;
}

import { useEffect, useRef, useState } from 'react';
import { mediaUrl, type Manifest } from './api';
import { nextAvailable, segmentAt, syncAction, timelineAt } from './sync';

/**
 * 跟隨外部絕對時間游標播放歷史片段（多來源同步與事件回放共用）。
 *
 * - 片段以 UTC 絕對起點＋媒體相對時間對齊；換片段時載入該片段並定位。
 * - 缺段顯示空白狀態與原因，不拿上一幀假裝；其他來源照常播放。
 * - 回報實際量到的同步誤差（毫秒）。
 */
export function SegmentFollower({
  manifest,
  cursor,
  playing,
  speed,
  muted = true,
  onDrift,
  onJump,
}: {
  manifest: Manifest | null;
  cursor: number | null;
  playing: boolean;
  speed: number;
  muted?: boolean;
  onDrift?: (ms: number | null) => void;
  onJump?: (t: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const segment = segmentAt(manifest, cursor);
  const onDriftRef = useRef(onDrift);
  useEffect(() => {
    onDriftRef.current = onDrift;
  });

  // 換片段：載入新檔並定位到游標
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!segment) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      onDriftRef.current?.(null);
      return;
    }
    if (segment.id === loadedId) return;
    video.src = mediaUrl(segment.url);
    const start = segment.start;
    const onMeta = () => {
      if (cursor !== null) video.currentTime = Math.max(0, (cursor - start) / 1000);
      setError('');
      setLoadedId(segment.id);
    };
    const onError = () => setError('片段無法播放（可能已到期或瀏覽器不支援此編碼）');
    video.addEventListener('loadedmetadata', onMeta, { once: true });
    video.addEventListener('error', onError, { once: true });
    return () => {
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('error', onError);
    };
    // cursor 只在載入當下用一次；之後由下面的同步處理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment?.id]);

  // 播放／暫停與倍速
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !segment || loadedId !== segment.id) return;
    video.playbackRate = speed;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing, speed, loadedId, segment]);

  // 每次游標更新檢查誤差
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !segment || cursor === null || loadedId !== segment.id) return;
    const expected = (cursor - segment.start) / 1000;
    const action = syncAction(expected, video.currentTime, speed);
    onDriftRef.current?.(Math.round((video.currentTime - expected) * 1000));
    if (action.kind === 'seek') video.currentTime = Math.max(0, action.to);
    else if (action.kind === 'rate' && playing) video.playbackRate = action.rate;
    else if (action.kind === 'none' && video.playbackRate !== speed) video.playbackRate = speed;
  }, [cursor, segment, loadedId, speed, playing]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  const gap = !segment ? timelineAt(manifest?.timeline, cursor) : null;
  const next = !segment && cursor !== null ? nextAvailable(manifest, cursor) : null;
  return (
    <div className="relative h-full w-full bg-black">
      <video ref={videoRef} crossOrigin="use-credentials" playsInline muted={muted} className={`h-full w-full object-contain ${segment ? '' : 'invisible'}`} />
      {!segment ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-sm text-zinc-400">
          <span>{!manifest ? '載入中…' : gap?.kind === 'expired' ? '此時段的錄影已到期刪除' : gap?.kind === 'recording' ? '錄製中，片段完成後可回放' : gap?.kind === 'failed' ? '此時段錄影損壞' : '此時段沒有錄影'}</span>
          {gap?.reason && gap.kind === 'gap' ? <span className="text-xs text-zinc-500">{gap.reason}</span> : null}
          {next && onJump ? (
            <button type="button" onClick={() => onJump(next)} className="rounded-lg border border-zinc-600 px-3 py-1 text-xs text-zinc-200 hover:bg-white/5">跳至下一段</button>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="absolute inset-x-0 bottom-0 bg-red-900/70 px-3 py-1 text-xs text-red-100">{error}</div> : null}
    </div>
  );
}

import { Maximize2, Minimize2, Settings2, Video, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LivePlayer, type PlayerStats } from './LivePlayer';
import { videoApi, type LiveSession, type Tile, type VideoSourceItem } from './api';
import { BADGE_TONE, tileBadges } from './status';

/**
 * 監控格子：名稱、來源摘要、連線與錄影狀態、設定、放大／全螢幕。
 * 只有目前標籤的格子會建立播放器；切換標籤時釋放，後端錄影照常。
 */
export function TileView({
  tile,
  source,
  active,
  zoomed,
  audio,
  onZoom,
  onAudio,
  onSettings,
}: {
  tile: Tile;
  source: VideoSourceItem | undefined;
  active: boolean;
  zoomed: boolean;
  audio: boolean;
  onZoom: () => void;
  onAudio: () => void;
  onSettings: () => void;
}) {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const sourceId = tile.sourceId && source?.enabled ? tile.sourceId : null;
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);

  useEffect(() => {
    if (!active || !sourceId) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void videoApi.liveSession(sourceId).then(
      (next) => {
        if (cancelled) return;
        setSession(next);
        setSessionError('');
        // 權杖到期前 1 分鐘換新
        timer = setTimeout(() => !cancelled && setRefreshKey((n) => n + 1), Math.max(30_000, next.expiresAt - Date.now() - 60_000));
      },
      (error: Error) => !cancelled && setSessionError(error.message),
    );
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      setSession(null);
      setStats(null);
    };
  }, [active, sourceId, refreshKey]);

  const fullscreen = () => {
    const el = boxRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const title = tile.displayName || source?.name || `第 ${tile.position + 1} 格`;
  const badges = tileBadges(tile, source, sessionError ? { ...(stats ?? ({} as PlayerStats)), state: 'error', error: sessionError } : stats);
  return (
    <div ref={boxRef} className={`relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-black ${zoomed ? 'col-span-full row-span-2' : ''}`}>
      <div className="flex items-center gap-2 bg-[#141416] px-3 py-1.5 text-xs">
        <span className="max-w-[40%] truncate font-medium text-zinc-100" title={title}>{title}</span>
        <span className="hidden truncate text-zinc-500 md:inline" title={source?.connection?.maskedUrl}>{source?.connection ? source.connection.maskedUrl.replace(/^\w+:\/\/([^@]*@)?/, '') : ''}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {tile.sourceId ? (
            <button type="button" onClick={onAudio} aria-label={audio ? `關閉 ${title} 聲音` : `開啟 ${title} 聲音`} className="rounded p-1 text-zinc-400 hover:text-white">
              {audio ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            </button>
          ) : null}
          <button type="button" onClick={onSettings} aria-label={`設定 ${title}`} className="rounded p-1 text-zinc-400 hover:text-white">
            <Settings2 className="size-3.5" />
          </button>
          <button type="button" onClick={onZoom} aria-label={zoomed ? `縮小 ${title}` : `放大 ${title}`} className="rounded p-1 text-zinc-400 hover:text-white">
            {zoomed ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
          <button type="button" onClick={fullscreen} aria-label={`${title} 全螢幕`} className="rounded p-1 text-zinc-400 hover:text-white">
            <Video className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="relative aspect-video w-full">
        {sourceId && session ? (
          <LivePlayer hlsUrl={session.hlsUrl} whepUrl={session.whepUrl} muted={!audio} onStats={setStats} onExpired={refresh} />
        ) : tile.sourceId ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">{sessionError || (source?.enabled === false ? '來源已停用' : '準備播放…')}</div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <button type="button" onClick={onSettings} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-white/5">設定影像來源</button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1 bg-[#141416] px-3 py-1.5 text-[11px]">
        {badges.map((b) => <span key={b.text} className={`rounded px-1.5 py-0.5 ${BADGE_TONE[b.tone]}`}>{b.text}</span>)}
        <span className="ml-auto text-zinc-500">
          {stats?.width && stats.height ? `${stats.width}×${stats.height}` : '解析度未知'}・{stats?.fps ? `${stats.fps} fps` : 'fps 未知'}
          {stats?.droppedFrames !== null && stats?.droppedFrames !== undefined ? `・丟幀 ${stats.droppedFrames}` : ''}
          {stats?.transport ? `・${stats.transport === 'webrtc' ? 'WebRTC' : 'HLS'}` : ''}
        </span>
      </div>
    </div>
  );
}

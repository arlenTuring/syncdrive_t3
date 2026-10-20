import { Maximize, Settings2, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LivePlayer, type PlayerStats } from './LivePlayer';
import { SourcePicker } from './SourcePicker';
import { videoApi, type LiveSession, type SourceOption, type Tile } from './api';
import { BADGE_TONE, tileBadges } from './status';

/**
 * 監控格子：大小由版面決定（父層絕對定位），影片 cover 填滿、置中裁切，不因影片尺寸改變格子。
 *
 * - 沒有來源：格內直接顯示可搜尋分組下拉，選了就綁定並開始播放。
 * - 已綁定：右上「設定」開簡短對話框（重新選來源／清除綁定）；格子不提供連線或錄影設定。
 * - 只有目前標籤頁的格子會建立播放器；換來源時釋放舊的播放資源，舊請求的回應不會蓋過新來源。
 */
export function TileView({
  tile,
  source,
  options,
  active,
  audio,
  canConfigure,
  onAudio,
  onBind,
  onSettings,
}: {
  tile: Tile;
  source: SourceOption | undefined;
  options: SourceOption[];
  active: boolean;
  audio: boolean;
  canConfigure: boolean;
  onAudio: () => void;
  onBind: (sourceId: string) => void;
  onSettings: () => void;
}) {
  const [session, setSession] = useState<{ sourceId: string; value: LiveSession } | null>(null);
  const [sessionError, setSessionError] = useState<{ sourceId: string; text: string } | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const playable = Boolean(tile.sourceId && source && source.enabled && !source.deleted);
  const sourceId = playable ? tile.sourceId : null;
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);

  useEffect(() => {
    if (!active || !sourceId) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void videoApi.liveSession(sourceId).then(
      (next) => {
        if (cancelled) return;
        setSession({ sourceId, value: next });
        setSessionError(null);
        // 權杖到期前 1 分鐘換新
        timer = setTimeout(() => !cancelled && setRefreshKey((n) => n + 1), Math.max(30_000, next.expiresAt - Date.now() - 60_000));
      },
      (error: Error) => !cancelled && setSessionError({ sourceId, text: error.message }),
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

  const live = session && session.sourceId === sourceId ? session.value : null;
  const error = sessionError && sessionError.sourceId === sourceId ? sessionError.text : '';
  const title = tile.displayName || source?.name || `第 ${tile.position + 1} 格`;
  const badges = tileBadges(source, Boolean(tile.sourceId), error ? { ...(stats ?? ({} as PlayerStats)), state: 'error', error } : stats);

  return (
    <div ref={boxRef} className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-black">
      <div className="flex h-8 shrink-0 items-center gap-2 bg-[#141416] px-2 text-xs">
        <span className="min-w-0 truncate font-medium text-zinc-100" title={title}>{title}</span>
        {badges.map((b) => <span key={b.text} className={`hidden shrink-0 rounded px-1.5 py-0.5 text-[11px] sm:inline ${BADGE_TONE[b.tone]}`}>{b.text}</span>)}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {live ? (
            <span className="mr-1 hidden text-[11px] text-zinc-500 md:inline">
              {stats?.fps ? `${stats.fps} fps` : ''}{stats?.transport ? `・${stats.transport === 'webrtc' ? 'WebRTC' : 'HLS'}` : ''}
            </span>
          ) : null}
          {tile.sourceId ? (
            <button type="button" onClick={onAudio} aria-label={audio ? `關閉 ${title} 聲音` : `開啟 ${title} 聲音`} className="rounded p-1 text-zinc-400 hover:text-white">
              {audio ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            </button>
          ) : null}
          {tile.sourceId ? (
            <button type="button" onClick={fullscreen} aria-label={`${title} 全螢幕`} className="rounded p-1 text-zinc-400 hover:text-white">
              <Maximize className="size-3.5" />
            </button>
          ) : null}
          {tile.sourceId ? (
            <button type="button" onClick={onSettings} aria-label={`設定 ${title} 的來源`} className="rounded p-1 text-zinc-400 hover:text-white">
              <Settings2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {sourceId && live ? (
          <LivePlayer hlsUrl={live.hlsUrl} whepUrl={live.whepUrl} muted={!audio} fit="cover" onStats={setStats} onExpired={refresh} className="absolute inset-0" />
        ) : tile.sourceId ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center text-xs text-zinc-400">
            <span>{error || (!source || source.deleted ? '來源已刪除，請重新選擇來源' : !source.enabled ? '來源已停用' : source.state === 'offline' ? '來源離線，等待恢復' : '準備播放…')}</span>
            {!source || source.deleted || !source.enabled ? (
              <button type="button" onClick={onSettings} className="rounded-lg border border-zinc-700 px-3 py-1 text-zinc-200 hover:bg-white/5">重新選擇來源</button>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-3">
            <SourcePicker options={options} value={null} onPick={onBind} className="w-full max-w-xs" placeholder={canConfigure ? '選擇影像來源' : '尚未設定來源'} />
          </div>
        )}
      </div>
    </div>
  );
}

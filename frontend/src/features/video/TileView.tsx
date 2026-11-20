import { Maximize, Minimize, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LivePlayer, type PlayerStats } from './LivePlayer';
import { videoApi, type LiveSession, type SourceOption, type Tile } from './api';
import { pillLabelParts, tileBadges } from './status';
import { SourcePill } from './SourcePill';
import { Button, IconButton } from '../../components/ui';

/**
 * 監控格子（設計稿 2026-11-20）：圓角卡片，左上角是兩位數編號；大小由版面決定（父層絕對定位），
 * 影片 cover 填滿、置中裁切，不因影片尺寸改變格子。
 *
 * - 沒有來源：置中「尚未選擇影像來源」與「選擇影像來源」按鈕，按下開選擇來源對話框（onSettings）。
 * - 已綁定：右上「設定」開同一個對話框（重新選來源／清除綁定）；格子不提供連線或錄影設定。
 * - 只有目前標籤頁的格子會建立播放器；換來源時釋放舊的播放資源，舊請求的回應不會蓋過新來源。
 * - 單格全螢幕：一般模式用原生全螢幕；整個標籤頁已全螢幕時改成容器內暫時放大（onZoom），避免兩層原生全螢幕互相打架。
 */
export function TileView({
  tile,
  source,
  active,
  audio,
  canConfigure,
  onAudio,
  onSettings,
  pageFullscreen = false,
  zoomed = false,
  onZoom,
}: {
  tile: Tile;
  source: SourceOption | undefined;
  active: boolean;
  audio: boolean;
  canConfigure: boolean;
  onAudio: () => void;
  /** 開選擇影像來源對話框 */
  onSettings: () => void;
  /** 整個監控標籤頁正在全螢幕（原生或網頁滿版） */
  pageFullscreen?: boolean;
  zoomed?: boolean;
  onZoom?: () => void;
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
    if (pageFullscreen) return onZoom?.();
    const el = boxRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const live = session && session.sourceId === sourceId ? session.value : null;
  const error = sessionError && sessionError.sourceId === sourceId ? sessionError.text : '';
  const title = tile.displayName || source?.name || `第 ${tile.position + 1} 格`;
  const badges = tileBadges(source, Boolean(tile.sourceId), error ? { ...(stats ?? ({} as PlayerStats)), state: 'error', error } : stats);

  const number = String(tile.position + 1).padStart(2, '0');
  const [code, label] = pillLabelParts(tile.displayName || source?.name || `第 ${tile.position + 1} 個視窗`, source?.vehicleCode);
  const status = badges[0];
  const statusText = [status?.text, live && stats?.fps ? `${stats.fps} fps` : '', live && stats?.transport ? (stats.transport === 'webrtc' ? 'WebRTC' : 'HLS') : ''].filter(Boolean).join('・');

  // 沒有來源：卡片左上角編號、正中間「選擇影像來源」（設計稿 2026-11-20）
  if (!tile.sourceId) {
    return (
      <div ref={boxRef} className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-surface-primary">
        <div className="flex h-11 shrink-0 items-center px-4 text-body-m text-text-secondary">{number}</div>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-3 pb-11 text-center text-body-m text-text-secondary">
          <span>尚未選擇影像來源</span>
          {canConfigure ? <Button hierarchy="subordinate" variant="tonal" onPress={onSettings}>選擇影像來源</Button> : null}
        </div>
      </div>
    );
  }

  // 已綁定：影像鋪滿整張卡片，左上角狀態點＋「代號｜名稱」膠囊，右上角聲音、全螢幕、切換來源浮在影像上
  return (
    <div ref={boxRef} className="relative h-full w-full min-h-0 min-w-0 overflow-hidden rounded-lg bg-surface-primary">
      {sourceId && live ? (
        <LivePlayer hlsUrl={live.hlsUrl} whepUrl={live.whepUrl} muted={!audio} fit="cover" onStats={setStats} onExpired={refresh} className="absolute inset-0" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-3 text-center text-body-m text-text-secondary">
          <span>{error || (!source || source.deleted ? '來源已刪除，請重新選擇來源' : !source.enabled ? '來源已停用' : source.state === 'offline' ? '來源離線，等待恢復' : '準備播放…')}</span>
          {!source || source.deleted || !source.enabled ? (
            <Button hierarchy="subordinate" variant="tonal" onPress={onSettings}>重新選擇來源</Button>
          ) : null}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-3">
        <SourcePill code={code} label={label} tone={status?.tone ?? 'zinc'} statusText={statusText} />
        <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1">
          <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={onAudio} label={audio ? `關閉 ${title} 聲音` : `開啟 ${title} 聲音`} icon={audio ? <Volume2 /> : <VolumeX />} />
          <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={fullscreen} label={zoomed ? `${title} 返回整頁` : pageFullscreen ? `${title} 放大` : `${title} 全螢幕`} icon={zoomed ? <Minimize /> : <Maximize />} />
          <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={onSettings} label={`設定 ${title} 的來源`} icon={<SlidersHorizontal />} />
        </div>
      </div>
    </div>
  );
}

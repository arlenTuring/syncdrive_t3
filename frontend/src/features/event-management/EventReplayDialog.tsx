import { VideoOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Dialog, ErrorLine, GhostButton } from '../media-groups/dialogs';
import { formatDateTime } from '../event-log-shared/time';
import { resolveRange } from '../vehicle-run-history/api';
import type { Resolved } from '../vehicle-run-history/queryConditions';
import { ReplayStage } from '../vehicle-run-history/RunHistoryPage';
import { fetchPlayback, fetchVideoStatus, type Playback, type VideoStatus } from './api';

/**
 * 事件回放：固定該事件與該載具，時間窗為事件前 30 秒到後 30 秒。
 *
 * 左側沿用運行管理紀錄的回放（同一份歷史資料與播放器，地圖高亮該車、逐幀只走該車、不換車、不拿即時位置填補）。
 * 右側事件影像：目前沒有影像來源，明確顯示「尚未設定影像來源」，軌跡照常可看；有來源後再與同一時間軸對齊。
 */
export function EventReplayDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [video, setVideo] = useState<VideoStatus | null>(null);
  const [videoError, setVideoError] = useState('');
  const [error, setError] = useState('');
  const [panelSlot, setPanelSlot] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const pb = await fetchPlayback(id, controller.signal);
        setPlayback(pb);
        if (pb.permissions.video) {
          fetchVideoStatus(controller.signal).then(setVideo, (reason: Error) => !controller.signal.aborted && setVideoError(reason.message));
        }
        if (!pb.vehicle || !pb.permissions.trajectory) return;
        const value = await resolveRange(
          { vehicleId: pb.vehicle.id, from: new Date(pb.window.from).toISOString(), to: new Date(pb.window.to).toISOString(), tz: pb.timeZone },
          controller.signal,
        );
        setResolved({ id: `event:${id}`, kind: 'range', value });
      } catch (reason) {
        if (!controller.signal.aborted) setError((reason as Error).message);
      }
    })();
    return () => controller.abort();
  }, [id]);

  const tz = playback?.timeZone ?? 'Asia/Taipei';
  return (
    <Dialog title="事件回放" width="max-w-[min(96vw,1600px)]" onClose={onClose} footer={<GhostButton onClick={onClose}>關閉</GhostButton>}>
      {playback ? (
        <p className="mb-3 text-sm text-zinc-300">
          {playback.event.eventLabel}・{playback.vehicle?.displayName ?? playback.event.vehicleCode ?? '非載具事件'}・事件時間 {formatDateTime(playback.event.occurredAt, tz)}
          <span className="ml-2 text-zinc-500">
            回放 {formatDateTime(playback.window.from, tz)} 至 {formatDateTime(playback.window.to, tz)}（前 {playback.window.beforeMs / 1000} 秒、後 {playback.window.afterMs / 1000} 秒）
          </span>
          {playback.event.occurredAtValid === false ? <span className="ml-2 text-amber-300">事件來源沒有提供時間，時間窗以接收時間為準</span> : null}
        </p>
      ) : null}
      {error ? <ErrorLine text={`回放載入失敗：${error}`} /> : null}
      <div className="grid h-[70vh] min-h-0 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <section className="relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-black">
          {!playback ? (
            <p className="m-auto text-zinc-500">載入中…</p>
          ) : !playback.vehicle ? (
            <p className="m-auto text-zinc-400">此事件沒有對應的載具，沒有載具軌跡可回放</p>
          ) : !playback.permissions.trajectory ? (
            <p className="m-auto text-zinc-400">權限不足：需要「運行管理紀錄」檢視權限才能看軌跡</p>
          ) : (
            <ReplayStage key={resolved?.id ?? 'pending'} resolved={resolved} panelSlot={panelSlot} />
          )}
        </section>
        <aside className="flex min-h-0 flex-col gap-3">
          <section className="rounded-xl border border-zinc-800 bg-[#121214] p-4">
            <h3 className="text-sm font-medium">事件影像</h3>
            {!playback ? null : !playback.permissions.video ? (
              <p className="mt-2 text-sm text-zinc-400">權限不足：需要「影像監控管理」檢視權限</p>
            ) : videoError ? (
              <p className="mt-2 text-sm text-red-300">影像來源查詢失敗：{videoError}</p>
            ) : video && !video.configured ? (
              <div className="mt-3 flex flex-col items-center gap-2 rounded-lg bg-black/40 py-8 text-center text-zinc-400">
                <VideoOff className="size-8" />
                <span>尚未設定影像來源</span>
                <span className="text-xs text-zinc-500">軌跡回放不受影響；接上影像來源後，影像會與同一時間軸對齊</span>
              </div>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">查詢影像來源中…</p>
            )}
          </section>
          <div ref={setPanelSlot} className="min-h-0 flex-1 overflow-auto rounded-xl border border-zinc-800 bg-[#121214]" aria-label="車輛資料" />
        </aside>
      </div>
    </Dialog>
  );
}

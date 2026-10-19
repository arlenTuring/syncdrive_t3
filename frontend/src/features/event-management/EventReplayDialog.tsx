import { Film } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Dialog, ErrorLine, GhostButton } from '../media-groups/dialogs';
import { formatDateTime } from '../event-log-shared/time';
import { resolveRange } from '../vehicle-run-history/api';
import type { Resolved } from '../vehicle-run-history/queryConditions';
import { ReplayStage } from '../vehicle-run-history/RunHistoryPage';
import { videoApi, type Manifest } from '../video/api';
import { SegmentFollower } from '../video/SegmentFollower';
import { openVideoHistory } from '../video/history-link';
import { fetchPlayback, type Playback } from './api';

/**
 * 事件回放：固定該事件與該載具，事件前 30 秒到後 30 秒。
 *
 * 左側沿用運行管理紀錄的回放（地圖高亮該車、逐幀只走該車、不換車、不拿即時位置填補）。
 * 右側事件影像用歷史影像的同一套播放服務，跟著左側的時間游標對齊（同一絕對時間軸）；
 * 影像來源以「當時」綁定這台車的來源版本為準，不用現在的標籤位置推定。
 */
export function EventReplayDialog({ id, onClose, onOpenHistory }: { id: string; onClose: () => void; onOpenHistory?: () => void }) {
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [error, setError] = useState('');
  const [panelSlot, setPanelSlot] = useState<HTMLDivElement | null>(null);
  const [manifests, setManifests] = useState<Manifest[] | null>(null);
  const [videoError, setVideoError] = useState('');
  const [clock, setClock] = useState<{ t: number | null; playing: boolean; speed: number }>({ t: null, playing: false, speed: 1 });
  const [drift, setDrift] = useState<number | null>(null);
  const onClock = useCallback((c: { t: number | null; playing: boolean; speed: number }) => setClock(c), []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const pb = await fetchPlayback(id, controller.signal);
        setPlayback(pb);
        if (pb.permissions.video && pb.event.vehicleCode) {
          // 以當時的來源版本找這台車的影像
          void videoApi.sources(true).then(async (sources) => {
            const ids = sources.map((s) => s.id).slice(0, 12);
            if (!ids.length) return setManifests([]);
            const avail = await videoApi.availability(ids, pb.window.from, pb.window.to);
            const matched = avail.sources.filter((s) => s.revisions.some((r) => r.vehicleCode === pb.event.vehicleCode)).map((s) => s.sourceId).slice(0, 4);
            if (!matched.length) return setManifests([]);
            const session = await videoApi.playback({ sourceIds: matched, from: pb.window.from, to: pb.window.to });
            setManifests(await Promise.all(session.sessions.map((s) => videoApi.manifest(s.manifestUrl))));
          }).catch((reason: Error) => !controller.signal.aborted && setVideoError(reason.message));
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
  const openHistory = () => {
    if (!playback) return;
    openVideoHistory({ from: playback.window.from, to: playback.window.to, vehicleCode: playback.event.vehicleCode, sourceIds: manifests?.map((m) => m.sourceId), at: playback.window.from });
    onOpenHistory?.();
    onClose();
  };
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
            <ReplayStage key={resolved?.id ?? 'pending'} resolved={resolved} panelSlot={panelSlot} onClock={onClock} />
          )}
        </section>
        <aside className="flex min-h-0 flex-col gap-3">
          <section className="rounded-xl border border-zinc-800 bg-[#121214] p-3">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-medium">事件影像</h3>
              {drift !== null ? <span className="text-xs text-zinc-500">與軌跡誤差 {drift} ms</span> : null}
              {playback?.permissions.video && playback.event.vehicleCode ? (
                <button type="button" onClick={openHistory} className="ml-auto inline-flex items-center gap-1 text-xs text-sky-300 hover:underline"><Film className="size-3.5" />在歷史影像查詢開啟</button>
              ) : null}
            </div>
            {!playback ? null : !playback.permissions.video ? (
              <p className="text-sm text-zinc-400">權限不足：需要「影像監控管理」檢視權限</p>
            ) : !playback.event.vehicleCode ? (
              <p className="text-sm text-zinc-400">非載具事件，沒有對應的車載影像</p>
            ) : videoError ? (
              <p className="text-sm text-red-300">影像查詢失敗：{videoError}</p>
            ) : manifests === null ? (
              <p className="text-sm text-zinc-500">查詢影像中…</p>
            ) : !manifests.length ? (
              <p className="text-sm text-zinc-400">這段時間沒有綁定 {playback.event.vehicleCode} 的影像來源；軌跡回放不受影響</p>
            ) : (
              <div className="space-y-2">
                {manifests.map((m, i) => (
                  <div key={m.sourceId}>
                    <div className="mb-1 text-xs text-zinc-400">{m.name}</div>
                    <div className="aspect-video overflow-hidden rounded-lg">
                      <SegmentFollower manifest={m} cursor={clock.t ?? playback.window.from} playing={clock.playing} speed={clock.speed} onDrift={i === 0 ? setDrift : undefined} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <div ref={setPanelSlot} className="min-h-0 flex-1 overflow-auto rounded-xl border border-zinc-800 bg-[#121214]" aria-label="車輛資料" />
        </aside>
      </div>
    </Dialog>
  );
}

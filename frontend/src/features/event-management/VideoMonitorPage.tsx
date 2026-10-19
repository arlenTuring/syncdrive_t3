import { Maximize2, VideoOff, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ErrorLine } from '../media-groups/dialogs';
import { QueryActions, RangeFilter, TextFilter } from '../event-log-shared/ui';
import { formatDateTime, rangeToQuery, recentRange, type RangeDraft } from '../event-log-shared/time';
import { fetchRecordings, fetchVideoStatus, type VideoStatus } from './api';

const LAYOUTS = [1, 4, 9, 12] as const;
const TZ = 'Asia/Taipei';

/**
 * 事件管理模組 → 影像監控管理。
 *
 * 影像來源經後端 provider 解析（不接受前端任意 URL）。目前專案沒有任何車載攝影機／NVR／影像閘道契約，
 * 所以每格顯示「尚未設定影像來源」、品質「未知」，不播放假影片、不顯示固定假數值；
 * 版型、放大、全螢幕與歷史片段查詢的畫面與 API 已就緒，接上 provider 後直接使用。
 */
export function VideoMonitorPage() {
  const [status, setStatus] = useState<VideoStatus | null>(null);
  const [error, setError] = useState('');
  const [layout, setLayout] = useState<(typeof LAYOUTS)[number]>(12);
  const [zoomed, setZoomed] = useState<number | null>(null);
  const [history, setHistory] = useState<{ vehicle: string; range: RangeDraft }>({ vehicle: '', range: recentRange(3_600_000, TZ) });
  const [historyResult, setHistoryResult] = useState('');
  const cells = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchVideoStatus(controller.signal).then(setStatus, (reason: Error) => !controller.signal.aborted && setError(reason.message));
    return () => controller.abort();
  }, []);

  const searchHistory = async () => {
    const range = rangeToQuery(history.range, TZ);
    if ('error' in range) return setHistoryResult(range.error);
    if (!history.vehicle.trim()) return setHistoryResult('請輸入載具 ID');
    try {
      const items = await fetchRecordings({ vehicleCode: history.vehicle.trim(), ...range });
      setHistoryResult(`找到 ${items.length} 段歷史影像（${formatDateTime(range.from, TZ)} 起）`);
    } catch (reason) {
      setHistoryResult(`無法查詢歷史影像：${(reason as Error).message}`);
    }
  };

  const cols = layout === 1 ? 'grid-cols-1' : layout === 4 ? 'grid-cols-2' : layout === 9 ? 'grid-cols-3' : 'grid-cols-4';
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-5 text-zinc-100">
      {error ? <ErrorLine text={`影像來源查詢失敗：${error}`} /> : null}
      {status && !status.configured ? (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-medium">尚未設定影像來源</p>
          <p className="mt-1 text-amber-200/80">需要下列介接資料才能播放即時與歷史影像（瀏覽器不能直接播 RTSP，需經 HLS／WebRTC 閘道）：</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-100/90">
            {status.missing.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p className="mt-2 text-xs text-amber-200/70">{status.recording.note}</p>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-400">版型</span>
        {LAYOUTS.map((n) => (
          <button key={n} type="button" onClick={() => setLayout(n)} aria-pressed={layout === n} className={`rounded-lg px-3 py-1.5 text-sm ${layout === n ? 'bg-blue-600 text-white' : 'border border-zinc-700 text-zinc-300 hover:bg-white/5'}`}>
            {n} 畫面
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-500">同時監看上限 11 台載具（12 格版型最後一格保留）</span>
      </div>

      <div className={`grid gap-2 ${cols}`}>
        {Array.from({ length: layout }, (_, i) => {
          const source = status?.sources[i];
          return (
            <div key={i} ref={(el) => { cells.current[i] = el; }} className={`relative flex aspect-video flex-col overflow-hidden rounded-xl border border-zinc-800 bg-black ${zoomed === i ? 'col-span-full row-span-2' : ''}`}>
              <div className="flex items-center gap-2 bg-black/70 px-3 py-1.5 text-xs">
                <span className="truncate text-zinc-200">{source ? source.name : layout === 12 && i === 11 ? '（保留）' : `畫面 ${i + 1}`}</span>
                <span className="ml-auto text-zinc-500">連線：{source ? '未連線' : '未設定'}・品質：未知</span>
                <button type="button" onClick={() => setZoomed(zoomed === i ? null : i)} aria-label={zoomed === i ? `縮小畫面 ${i + 1}` : `放大畫面 ${i + 1}`} className="rounded p-1 text-zinc-400 hover:text-white">
                  {zoomed === i ? <ZoomOut className="size-3.5" /> : <ZoomIn className="size-3.5" />}
                </button>
                <button type="button" onClick={() => void cells.current[i]?.requestFullscreen?.()} aria-label={`畫面 ${i + 1} 全螢幕`} className="rounded p-1 text-zinc-400 hover:text-white">
                  <Maximize2 className="size-3.5" />
                </button>
              </div>
              <div className="flex flex-1 flex-col items-center justify-center gap-1 text-zinc-500">
                <VideoOff className="size-6" />
                <span className="text-xs">尚未設定影像來源</span>
              </div>
            </div>
          );
        })}
      </div>

      <section className="rounded-xl border border-zinc-800 p-4">
        <h3 className="mb-3 text-sm font-medium">歷史影像查詢</h3>
        <div className="flex flex-wrap items-end gap-3">
          <TextFilter label="載具 ID" value={history.vehicle} onChange={(v) => setHistory({ ...history, vehicle: v })} onEnter={() => void searchHistory()} placeholder="例如 PMS01" />
          <RangeFilter value={history.range} onChange={(range) => setHistory({ ...history, range })} timeZone={TZ} />
          <QueryActions onSearch={() => void searchHistory()} onReset={() => { setHistory({ vehicle: '', range: recentRange(3_600_000, TZ) }); setHistoryResult(''); }} />
        </div>
        {historyResult ? <p className="mt-3 text-sm text-zinc-300" role="status">{historyResult}</p> : null}
        <p className="mt-2 text-xs text-zinc-500">也可以從事件詳情的「事件回放」直接看該事件前後的影像（有影像來源後）。</p>
      </section>
    </div>
  );
}

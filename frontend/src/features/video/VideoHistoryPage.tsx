import { Download, Maximize2, Pause, Play, Shield, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SiteSelect } from '../../components/SiteSelect';
import { useAuth } from '../access-control/AuthContext';
import { Dialog, ErrorLine, GhostButton, PrimaryButton, Toast } from '../media-groups/dialogs';
import { QueryActions, RangeFilter } from '../event-log-shared/ui';
import { formatDateTime, rangeToQuery, toLocalInput, type RangeDraft } from '../event-log-shared/time';
import { formatBytes, mediaUrl, videoApi, type Availability, type Job, type Manifest, type Tab, type TimelineItem, type VideoSourceItem } from './api';
import { SegmentFollower } from './SegmentFollower';
import { gridColumns } from './layout';
import { OPEN_VIDEO_HISTORY_EVENT, takeHistoryRequest } from './history-link';

const TZ = 'Asia/Taipei';
const HOUR = 3_600_000;
const SPEEDS = [0.5, 1, 2, 4, 8];
const KIND_STYLE: Record<TimelineItem['kind'], string> = {
  available: 'bg-emerald-500/70',
  gap: 'bg-zinc-700/60',
  expired: 'bg-zinc-500/40 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,.35)_4px,rgba(0,0,0,.35)_8px)]',
  failed: 'bg-red-500/60',
  recording: 'bg-sky-500/60 animate-pulse',
};
const KIND_LABEL: Record<TimelineItem['kind'], string> = { available: '有錄影', gap: '缺段', expired: '已到期', failed: '損壞', recording: '錄製中' };

/** 主時鐘：播放時依倍速推進絕對時間；多個畫面共用 */
function useMasterClock(from: number, to: number) {
  const [state, setState] = useState({ t: from, playing: false, speed: 1 });
  const raf = useRef(0);
  const last = useRef(0);
  useEffect(() => {
    if (!state.playing) return undefined;
    last.current = performance.now();
    const step = (now: number) => {
      const dt = now - last.current;
      last.current = now;
      setState((s) => {
        const t = Math.min(to, s.t + dt * s.speed);
        return { ...s, t, playing: t < to && s.playing };
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [state.playing, to]);
  return {
    ...state,
    seek: useCallback((t: number) => setState((s) => ({ ...s, t: Math.max(from, Math.min(to, t)) })), [from, to]),
    setPlaying: (playing: boolean) => setState((s) => ({ ...s, playing })),
    setSpeed: (speed: number) => setState((s) => ({ ...s, speed })),
    reset: (t: number) => setState({ t, playing: false, speed: 1 }),
  };
}

function Timeline({ items, from, to, cursor, onSeek }: { items: TimelineItem[]; from: number; to: number; cursor: number; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const span = to - from;
  const at = (e: ReactPointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return from + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * span;
  };
  // 拖曳時只更新游標顯示，停下 150ms 才真的定位（不為每次移動產生一次載入）
  const drag = (e: ReactPointerEvent) => {
    if (!(e.buttons & 1)) return setHover(at(e));
    const t = at(e);
    setHover(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSeek(t), 150);
  };
  return (
    <div
      ref={ref}
      role="slider"
      aria-label="時間軸"
      aria-valuemin={from}
      aria-valuemax={to}
      aria-valuenow={cursor}
      aria-valuetext={formatDateTime(cursor, TZ)}
      tabIndex={0}
      onPointerDown={(e) => onSeek(at(e))}
      onPointerMove={drag}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(cursor + 10_000);
        if (e.key === 'ArrowLeft') onSeek(cursor - 10_000);
      }}
      className="relative h-5 w-full cursor-pointer overflow-hidden rounded bg-zinc-800 focus:ring-1 focus:ring-sky-500"
    >
      {items.map((item, i) => (
        <div key={i} title={`${KIND_LABEL[item.kind]}${item.protected ? '（受保護）' : ''}：${formatDateTime(item.from, TZ)}–${formatDateTime(item.to, TZ)}${item.reason ? `・${item.reason}` : ''}`}
          className={`absolute inset-y-0 ${KIND_STYLE[item.kind]} ${item.protected ? 'border-y-2 border-amber-300' : ''}`}
          style={{ left: `${((item.from - from) / span) * 100}%`, width: `${Math.max(0.2, ((item.to - item.from) / span) * 100)}%` }} />
      ))}
      <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${((cursor - from) / span) * 100}%` }} />
      {hover !== null ? <div className="pointer-events-none absolute -top-0.5 rounded bg-black/80 px-1 text-[10px] text-white" style={{ left: `calc(${((hover - from) / span) * 100}% + 4px)` }}>{formatDateTime(hover, TZ).slice(11)}</div> : null}
    </div>
  );
}

/**
 * 事件管理模組 → 歷史影像查詢。
 * 先查可用區間（只讀索引），需要時才載入片段；多畫面共用絕對時間游標，缺段的畫面顯示空白狀態，不暫停其他畫面。
 */
export function VideoHistoryPage() {
  const auth = useAuth();
  const [sources, setSources] = useState<VideoSourceItem[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [range, setRange] = useState<RangeDraft>(() => ({ from: toLocalInput(Date.now() - HOUR, TZ), to: toLocalInput(Date.now(), TZ) }));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [window_, setWindow] = useState<{ from: number; to: number }>(() => ({ from: Date.now() - HOUR, to: Date.now() }));
  const [multi, setMulti] = useState(false);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [manifests, setManifests] = useState<Record<string, Manifest>>({});
  const [days, setDays] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [drifts, setDrifts] = useState<Record<string, number | null>>({});
  const [job, setJob] = useState<Job | null>(null);
  const [exportMinutes, setExportMinutes] = useState('5');
  const [deletePreview, setDeletePreview] = useState<{ segments: number; bytes: number; protectedSegments: number; note: string } | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error'; id: number } | null>(null);
  const notify = useCallback((text: string, tone: 'success' | 'error') => setNotice((n) => ({ text, tone, id: (n?.id ?? 0) + 1 })), []);
  const [audio, setAudio] = useState<string | null>(null);
  const clock = useMasterClock(window_.from, window_.to);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void videoApi.sources(true).then(setSources, (e: Error) => setError(e.message));
    void videoApi.bootstrap().then((b) => setTabs(b.tabs), () => undefined);
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const query = useCallback(async (ids: string[], win: { from: number; to: number }, at?: number) => {
    if (!ids.length) return setError('請選擇影像來源');
    setError('');
    try {
      const [avail, playback] = await Promise.all([videoApi.availability(ids, win.from, win.to), videoApi.playback({ sourceIds: ids, from: win.from, to: win.to })]);
      setAvailability(avail);
      const loaded = await Promise.all(playback.sessions.map((s) => videoApi.manifest(s.manifestUrl)));
      setManifests(Object.fromEntries(loaded.map((m) => [m.sourceId, m])));
      setWindow(win);
      clock.reset(at ?? (loaded.flatMap((m) => m.segments).sort((a, b) => a.start - b.start)[0]?.start ?? win.from));
      const monthStart = new Date(win.from);
      void videoApi.calendar(ids, Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1) - 8 * HOUR, Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1), TZ).then((r) => setDays(r.days), () => undefined);
    } catch (reason) {
      setError((reason as Error).message);
    }
    // clock.reset 是穩定的動作
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 從事件詳情帶參數開啟：依當時的載具關聯找來源
  useEffect(() => {
    const consume = async () => {
      const req = takeHistoryRequest();
      if (!req) return;
      setRange({ from: toLocalInput(req.from, TZ), to: toLocalInput(req.to, TZ) });
      let ids = req.sourceIds ?? [];
      if (!ids.length && req.vehicleCode) {
        const rows = await videoApi.availability(sources.map((s) => s.id).slice(0, 12), req.from, req.to).catch(() => null);
        ids = rows ? rows.sources.filter((s) => s.revisions.some((r) => r.vehicleCode === req.vehicleCode)).map((s) => s.sourceId) : [];
        setVehicleFilter(req.vehicleCode);
      }
      setSelected(ids);
      setMulti(ids.length > 1);
      if (ids.length) await query(ids, { from: req.from, to: req.to }, req.at);
      else setError(req.vehicleCode ? `找不到 ${req.vehicleCode} 在這段期間的影像來源` : '請選擇影像來源');
    };
    if (sources.length) void consume();
    const onOpen = () => void consume();
    window.addEventListener(OPEN_VIDEO_HISTORY_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_VIDEO_HISTORY_EVENT, onOpen);
  }, [sources, query]);

  const search = () => {
    const r = rangeToQuery(range, TZ);
    if ('error' in r) return setRangeError(r.error);
    setRangeError(null);
    const ids = multi ? selected : selected.slice(0, 1);
    void query(ids, r);
  };

  // 下載任務輪詢
  useEffect(() => {
    if (!job || job.status === 'succeeded' || job.status === 'failed' || job.status === 'expired') return undefined;
    const timer = setTimeout(() => void videoApi.job(job.id).then(setJob, () => undefined), 1_500);
    return () => clearTimeout(timer);
  }, [job]);

  const filteredSources = sources.filter((s) => !vehicleFilter || (s.vehicleCode ?? '').toLowerCase().includes(vehicleFilter.toLowerCase()));
  const playing = useMemo(() => (multi ? selected : selected.slice(0, 1)).filter((id) => manifests[id]), [multi, selected, manifests]);
  const toggleSource = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : multi ? (cur.length >= 12 ? cur : [...cur, id]) : [id]));

  const startExport = async () => {
    if (!auth.require('events.video-history.export') || !playing[0]) return;
    const minutes = Number(exportMinutes);
    try {
      setJob(await videoApi.createExport({ sourceId: playing[0], from: Math.floor(clock.t), to: Math.floor(clock.t) + minutes * 60_000 }));
    } catch (reason) {
      notify((reason as Error).message, 'error');
    }
  };
  const previewDelete = async () => {
    if (!auth.require('events.video-history.delete') || !playing.length) return;
    try {
      setDeletePreview(await videoApi.deletePreview({ sourceIds: playing, from: window_.from, to: window_.to }));
    } catch (reason) {
      notify((reason as Error).message, 'error');
    }
  };
  const protect = async () => {
    if (!auth.require('events.video.recording-manage') || !playing.length) return;
    try {
      const r = await videoApi.protect({ sourceIds: playing, from: window_.from, to: window_.to, until: Date.now() + 30 * 24 * HOUR });
      notify(`已保護 ${r.updated} 個片段 30 天（不會被自動回收）`, 'success');
      void query(playing, window_, clock.t);
    } catch (reason) {
      notify((reason as Error).message, 'error');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4 text-zinc-100">
      <div className="flex flex-wrap items-end gap-3">
        <RangeFilter value={range} onChange={setRange} timeZone={TZ} error={rangeError} />
        <label className="flex min-w-[11rem] flex-col gap-1.5">
          <span className="text-xs text-zinc-400">監控標籤（帶入該頁來源）</span>
          <SiteSelect aria-label="監控標籤" value="" options={[{ value: '', label: '選擇標籤' }, ...tabs.map((t) => ({ value: t.id, label: t.name }))]}
            onChange={(e) => {
              const tab = tabs.find((t) => t.id === e.target.value);
              if (!tab) return;
              const ids = [...new Set(tab.tiles.map((t) => t.sourceId).filter(Boolean) as string[])].slice(0, 12);
              setSelected(ids);
              setMulti(ids.length > 1);
            }}
            className="h-10 rounded-xl bg-[#222831] px-3 text-sm" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-zinc-400">載具／位置</span>
          <input value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)} placeholder="篩選來源" className="h-10 w-36 rounded-xl bg-[#222831] px-3 text-sm outline-none focus:ring-1 focus:ring-sky-500" />
        </label>
        <div className="flex items-center gap-2 pb-2 text-sm">
          <label className="flex items-center gap-1.5"><input type="radio" checked={!multi} onChange={() => { setMulti(false); setSelected((s) => s.slice(0, 1)); }} className="accent-blue-600" />單一來源</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={multi} onChange={() => setMulti(true)} className="accent-blue-600" />多來源同步（最多 12）</label>
        </div>
        <QueryActions onSearch={search} onReset={() => { setSelected([]); setAvailability(null); setManifests({}); setRange({ from: toLocalInput(Date.now() - HOUR, TZ), to: toLocalInput(Date.now(), TZ) }); }} />
      </div>

      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-auto" aria-label="影像來源">
        {filteredSources.map((s) => (
          <button key={s.id} type="button" onClick={() => toggleSource(s.id)} aria-pressed={selected.includes(s.id)}
            className={`rounded-lg border px-2.5 py-1 text-xs ${selected.includes(s.id) ? 'border-blue-500 bg-blue-500/15 text-white' : 'border-zinc-700 text-zinc-300 hover:bg-white/5'}`}>
            {s.name}{s.vehicleCode ? `（${s.vehicleCode}）` : ''}{s.deleted ? '［已移除］' : ''}
          </button>
        ))}
        {!filteredSources.length ? <span className="text-sm text-zinc-500">沒有影像來源</span> : null}
      </div>
      {error ? <ErrorLine text={error} /> : null}

      {availability ? (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#16181d] px-3 py-2 text-sm">
            <button type="button" onClick={() => clock.setPlaying(!clock.playing)} aria-label={clock.playing ? '暫停' : '播放'} className="rounded-lg bg-blue-600 p-1.5 hover:bg-blue-500">
              {clock.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <span className="tabular-nums">{formatDateTime(clock.t, TZ)}</span>
            <SiteSelect aria-label="倍速" value={String(clock.speed)} options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))} onChange={(e) => clock.setSpeed(Number(e.target.value))} className="h-8 w-20 rounded-lg bg-[#222831] px-2 text-sm" />
            <button type="button" disabled title="來源沒有提供逐幀所需的影格時間資訊，暫不提供逐幀" className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-500">逐幀（不支援）</button>
            <button type="button" onClick={() => void stageRef.current?.requestFullscreen?.()} aria-label="全螢幕" className="rounded-lg p-1.5 text-zinc-300 hover:bg-white/5"><Maximize2 className="size-4" /></button>
            <span className="text-xs text-zinc-500">同步誤差：{Object.values(drifts).filter((d): d is number => d !== null).map((d) => `${d} ms`).join('、') || '—'}</span>
            <div className="ml-auto flex items-center gap-2">
              <SiteSelect aria-label="下載長度" value={exportMinutes} options={['1', '5', '10', '30'].map((m) => ({ value: m, label: `${m} 分鐘` }))} onChange={(e) => setExportMinutes(e.target.value)} className="h-8 w-24 rounded-lg bg-[#222831] px-2 text-xs" />
              <button type="button" onClick={() => void startExport()} className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1 text-xs hover:bg-white/5"><Download className="size-3.5" />下載目前起</button>
              <button type="button" onClick={() => void protect()} className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1 text-xs hover:bg-white/5"><Shield className="size-3.5" />保護此區間</button>
              <button type="button" onClick={() => void previewDelete()} className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10"><Trash2 className="size-3.5" />刪除此區間</button>
            </div>
          </div>
          {job ? (
            <p className="text-xs text-zinc-300" role="status">
              下載：{job.status === 'succeeded' && job.downloadUrl ? <a href={mediaUrl(job.downloadUrl)} className="text-sky-300 underline">下載檔案（{formatBytes(Number(job.result?.bytes ?? 0))}）</a> : job.status === 'failed' ? `失敗：${job.error}` : '準備中…'}
              {job.note ? <span className="ml-2 text-zinc-500">{job.note}</span> : null}
            </p>
          ) : null}

          <div className="space-y-1.5">
            {availability.sources.filter((s) => playing.includes(s.sourceId)).map((s) => (
              <div key={s.sourceId} className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-2 text-xs">
                <span className="truncate text-zinc-300" title={s.revisions.map((r) => `版本 ${r.revisionNo}${r.vehicleCode ? `・${r.vehicleCode}` : ''}`).join('；')}>{s.name}{s.removed ? '［已移除］' : ''}</span>
                <Timeline items={s.timeline} from={window_.from} to={window_.to} cursor={clock.t} onSeek={clock.seek} />
              </div>
            ))}
            <div className="flex flex-wrap gap-3 pl-[10.5rem] text-[11px] text-zinc-500">
              {(Object.keys(KIND_LABEL) as Array<TimelineItem['kind']>).map((k) => <span key={k} className="inline-flex items-center gap-1"><span className={`inline-block size-2.5 rounded-sm ${KIND_STYLE[k]}`} />{KIND_LABEL[k]}</span>)}
              <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm border-2 border-amber-300" />受保護</span>
            </div>
          </div>

          <div ref={stageRef} className={`grid min-h-[20rem] flex-1 gap-2 ${gridColumns(playing.length || 1)}`}>
            {playing.map((id) => (
              <div key={id} className="flex flex-col overflow-hidden rounded-xl border border-zinc-800">
                <div className="flex items-center gap-2 bg-[#141416] px-3 py-1 text-xs">
                  <span className="truncate">{manifests[id]?.name}</span>
                  <button type="button" onClick={() => setAudio(audio === id ? null : id)} className="ml-auto text-zinc-400 hover:text-white">{audio === id ? '關閉聲音' : '開啟聲音'}</button>
                </div>
                <div className="aspect-video">
                  <SegmentFollower manifest={manifests[id]} cursor={clock.t} playing={clock.playing} speed={clock.speed} muted={audio !== id}
                    onDrift={(ms) => setDrifts((d) => (d[id] === ms ? d : { ...d, [id]: ms }))} onJump={clock.seek} />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500">
          選擇影像來源與時間後按「搜尋」。預設查最近一小時。
          {days.length ? <div className="mt-2">本月有錄影的日期：{days.join('、')}</div> : null}
        </div>
      )}
      {availability && days.length ? (
        <div className="text-xs text-zinc-500">本月有錄影的日期：{days.map((d) => (
          <button key={d} type="button" onClick={() => { const from = new Date(`${d}T00:00:00+08:00`).getTime(); setRange({ from: toLocalInput(from, TZ), to: toLocalInput(from + 24 * HOUR - 1000, TZ) }); }} className="mr-1 text-sky-300 underline">{d.slice(5)}</button>
        ))}</div>
      ) : null}

      {deletePreview ? (
        <Dialog title="刪除錄影" onClose={() => setDeletePreview(null)} footer={<><GhostButton onClick={() => setDeletePreview(null)}>取消</GhostButton><PrimaryButton danger disabled={!deletePreview.segments} onClick={() => { setDeletePreview(null); void videoApi.deleteRecordings({ sourceIds: playing, from: window_.from, to: window_.to, confirm: true }).then((j) => { setJob(null); notify(`已建立刪除工作（${j.status}）`, 'success'); setTimeout(() => void query(playing, window_, clock.t), 3000); }, (e: Error) => notify(e.message, 'error')); }}>刪除 {deletePreview.segments} 個片段</PrimaryButton></>}>
          <p className="text-sm text-zinc-300">{formatDateTime(window_.from, TZ)} 至 {formatDateTime(window_.to, TZ)}：將刪除 {deletePreview.segments} 個片段（{formatBytes(deletePreview.bytes)}）。{deletePreview.protectedSegments ? `受保護的 ${deletePreview.protectedSegments} 個片段不會刪除。` : ''}</p>
          <p className="mt-2 text-xs text-zinc-500">{deletePreview.note}</p>
        </Dialog>
      ) : null}
      {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}

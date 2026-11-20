import { ArrowRight, CalendarDays, Check, Maximize, Minimize, MoreHorizontal, Pause, Play, RotateCw, Search, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SiteDateTimeInput } from '../../components/SiteDateTimeInput';
import { SiteMultiSelect } from '../../components/SiteMultiSelect';
import { AnchoredPopover } from '../../lib/AnchoredPopover';
import { useAuth } from '../access-control/AuthContext';
import { ErrorLine, Toast } from '../media-groups/dialogs';
import { formatDateTime, rangeToQuery, timeZoneLabel, toLocalInput, type RangeDraft } from '../event-log-shared/time';
import { formatBytes, mediaUrl, videoApi, type Availability, type Job, type Manifest, type SourceOption, type TimelineItem } from './api';
import { SegmentFollower } from './SegmentFollower';
import { SourcePill } from './SourcePill';
import type { HistoryRequest } from './history-link';
import { OPTION_STATE_LABEL, pillLabelParts } from './status';
import { segmentAt } from './sync';
import { Button, cn, Dialog, fieldClass, IconButton, MENU_CHECK_CLASS, MENU_GROUP_LABEL_CLASS, MENU_PANEL_CLASS, menuItemClass, TRIGGER_ICON_CLASS } from '../../components/ui';

/** 歷史多畫面：依路數決定欄數，列數平分高度（設計稿：兩路上下各一整列） */
function historyGrid(count: number) {
  if (count <= 2) return 'grid-cols-1';
  if (count <= 4) return 'grid-cols-1 sm:grid-cols-2';
  if (count <= 9) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
}

const DEFAULT_TZ = 'Asia/Taipei';
const HOUR = 3_600_000;
const SPEEDS = [0.5, 1, 2, 4, 8];
const EXPORT_MINUTES = [1, 5, 10, 30];
const EMPTY_RANGE: RangeDraft = { from: '', to: '' };

/** 播放列的經過時間：從查詢起點算，未滿一小時顯示 mm:ss */
function elapsedText(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

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

/** 時間區間：一個外框裝「開始 → 結束」兩個欄位，右邊一個日曆圖示（設計稿 2026-11-20） */
function RangeField({ value, onChange, timeZone, error }: { value: RangeDraft; onChange: (v: RangeDraft) => void; timeZone: string; error?: string | null }) {
  return (
    <div className="flex w-full max-w-[31rem] flex-col gap-1">
      <div className={cn(fieldClass({ fullWidth: true, invalid: Boolean(error) }), 'flex items-center gap-3')} title={`時間區間（${timeZoneLabel(timeZone)}；含結束那一秒）`}>
        <SiteDateTimeInput type="datetime-local" step={1} aria-label="開始時間" placeholder="開始" hideIcon value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className="flex-1" />
        <ArrowRight className={TRIGGER_ICON_CLASS} aria-hidden />
        <SiteDateTimeInput type="datetime-local" step={1} aria-label="結束時間" placeholder="結束" hideIcon value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} className="flex-1" />
        <CalendarDays className={TRIGGER_ICON_CLASS} aria-hidden />
      </div>
      {error ? <span role="alert" className="text-body-xs text-status-error-emphasis">{error}</span> : null}
    </div>
  );
}

/**
 * 播放進度：細軌道＋藍色圓鈕。軌道上較亮的區段＝有錄影；拖曳時只更新游標顯示，停下 150ms 才真的定位（不為每次移動產生一次載入）。
 */
function PlaybackSlider({ items, from, to, cursor, timeZone, onSeek }: { items: TimelineItem[]; from: number; to: number; cursor: number; timeZone: string; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const span = Math.max(1, to - from);
  const pct = (t: number) => `${Math.max(0, Math.min(1, (t - from) / span)) * 100}%`;
  const at = (e: ReactPointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return from + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * span;
  };
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
      aria-label="播放進度"
      aria-valuemin={from}
      aria-valuemax={to}
      aria-valuenow={cursor}
      aria-valuetext={formatDateTime(cursor, timeZone)}
      tabIndex={0}
      onPointerDown={(e) => onSeek(at(e))}
      onPointerMove={drag}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(cursor + 10_000);
        if (e.key === 'ArrowLeft') onSeek(cursor - 10_000);
      }}
      className="group relative flex h-6 min-w-0 flex-1 cursor-pointer items-center rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme"
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-surface-secondary">
        {items.map((item, i) => (
          <div key={i} className="absolute inset-y-0 bg-border-tertiary" style={{ left: pct(item.from), width: `max(2px, calc(${pct(item.to)} - ${pct(item.from)}))` }} />
        ))}
        <div className="absolute inset-y-0 left-0 bg-link-theme-filled" style={{ width: pct(cursor) }} />
      </div>
      <div className="absolute size-4 -translate-x-1/2 rounded-full bg-link-theme-filled" style={{ left: pct(cursor) }} aria-hidden />
      {hover !== null ? (
        <div className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-black-50 px-2 py-0.5 text-body-xs text-text-primary" style={{ left: pct(hover) }}>
          {formatDateTime(hover, timeZone)}
        </div>
      ) : null}
    </div>
  );
}

/** 一路歷史影像：影像鋪滿圓角卡片，左上「● 代號｜名稱」，右上聲音、全螢幕（設計稿 2026-11-20） */
function HistoryTile({
  manifest,
  code,
  label,
  cursor,
  playing,
  speed,
  audio,
  onAudio,
  onJump,
}: {
  manifest: Manifest;
  code: string | null;
  label: string;
  cursor: number;
  playing: boolean;
  speed: number;
  audio: boolean;
  onAudio: () => void;
  onJump: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const title = [code, label].filter(Boolean).join(' ');
  const hasFootage = Boolean(segmentAt(manifest, cursor));
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen?.();
  };
  return (
    <div ref={ref} className="relative min-h-0 min-w-0 overflow-hidden rounded-lg bg-surface-primary">
      <div className="absolute inset-0">
        <SegmentFollower manifest={manifest} cursor={cursor} playing={playing} speed={speed} muted={!audio} fit="cover" onJump={onJump} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-3">
        <SourcePill code={code} label={label} tone={hasFootage ? 'green' : 'zinc'} statusText={hasFootage ? '有錄影' : '此時段沒有錄影'} />
        <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1">
          <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={onAudio} label={audio ? `關閉 ${title} 聲音` : `開啟 ${title} 聲音`} icon={audio ? <Volume2 /> : <VolumeX />} />
          <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={toggleFullscreen} label={fullscreen ? `${title} 離開全螢幕` : `${title} 全螢幕`} icon={fullscreen ? <Minimize /> : <Maximize />} />
        </div>
      </div>
    </div>
  );
}

/** 播放列右側「更多」：倍速、下載、保護、刪除（設計稿沒畫，收在選單裡不佔版面） */
function MoreMenu({
  speed,
  onSpeed,
  onExport,
  onProtect,
  onDelete,
}: {
  speed: number;
  onSpeed: (speed: number) => void;
  onExport: (minutes: number) => void;
  onProtect: () => void;
  onDelete: () => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <>
      <div ref={anchorRef}>
        <IconButton size="small" hierarchy="subordinate" variant="standard" label="更多播放操作" icon={<MoreHorizontal />} pressed={open} onPress={() => setOpen((v) => !v)} />
      </div>
      <AnchoredPopover open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} role="menu" ariaLabel="播放操作" align="end" className={cn(MENU_PANEL_CLASS, 'w-52 max-h-[70vh]')}>
        <div className={MENU_GROUP_LABEL_CLASS}>播放速度</div>
        {SPEEDS.map((s) => (
          <button key={s} type="button" role="menuitemradio" aria-checked={s === speed} className={menuItemClass(s === speed)} onClick={run(() => onSpeed(s))}>
            <span className="flex-1">{s}×</span>
            {s === speed ? <Check className={MENU_CHECK_CLASS} aria-hidden /> : null}
          </button>
        ))}
        <div className={cn(MENU_GROUP_LABEL_CLASS, 'border-t border-border-quaternary')}>從目前位置下載</div>
        {EXPORT_MINUTES.map((m) => (
          <button key={m} type="button" role="menuitem" className={menuItemClass()} onClick={run(() => onExport(m))}>
            下載 {m} 分鐘
          </button>
        ))}
        <button type="button" role="menuitem" className={cn(menuItemClass(), 'border-t border-border-quaternary')} onClick={run(onProtect)}>
          保護此區間 30 天
        </button>
        <button type="button" role="menuitem" className={cn(menuItemClass(), 'text-status-error-emphasis')} onClick={run(onDelete)}>
          刪除此區間的錄影
        </button>
      </AnchoredPopover>
    </>
  );
}

/**
 * 獨立「歷史影像紀錄」頁（設計稿 2026-11-20）。
 * 先查可用區間（只讀索引），需要時才載入片段；多畫面共用絕對時間游標，缺段的畫面顯示空白狀態，不暫停其他畫面。
 * 可查停用或已刪除但仍有錄影的來源；來源清單只用安全摘要，不需要也拿不到連線資訊。
 */
export function VideoHistoryPage({ request }: { request?: HistoryRequest | null }) {
  const auth = useAuth();
  const [timeZone, setTimeZone] = useState(DEFAULT_TZ);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const [prefillVehicleCode, setPrefillVehicleCode] = useState('');
  const [range, setRange] = useState<RangeDraft>(EMPTY_RANGE);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [window_, setWindow] = useState<{ from: number; to: number }>(() => ({ from: Date.now() - HOUR, to: Date.now() }));
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [manifests, setManifests] = useState<Record<string, Manifest>>({});
  const [error, setError] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [deletePreview, setDeletePreview] = useState<{ segments: number; bytes: number; protectedSegments: number; note: string } | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error'; id: number } | null>(null);
  const notify = useCallback((text: string, tone: 'success' | 'error') => setNotice((n) => ({ text, tone, id: (n?.id ?? 0) + 1 })), []);
  const [audio, setAudio] = useState<string | null>(null);
  const clock = useMasterClock(window_.from, window_.to);
  const requestVersion = useRef(0);
  const queryAbort = useRef<AbortController | null>(null);

  useEffect(() => () => {
    requestVersion.current += 1;
    queryAbort.current?.abort();
  }, []);

  useEffect(() => {
    void videoApi.sourceOptions(true).then((r) => {
      setSources(r.items);
      setTimeZone(r.timeZone || DEFAULT_TZ);
    }, (e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const query = useCallback(async (ids: string[], win: { from: number; to: number }, at?: number) => {
    if (!ids.length) return setError('請選擇影像來源');
    queryAbort.current?.abort();
    const controller = new AbortController();
    queryAbort.current = controller;
    const version = ++requestVersion.current;
    setError('');
    setAvailability(null);
    setManifests({});
    setAppliedIds(ids);
    try {
      const avail = await videoApi.availability(ids, win.from, win.to, controller.signal);
      if (version !== requestVersion.current) return;
      setAvailability(avail);
      setWindow(win);
      const playableIds = avail.sources
        .filter((source) => source.timeline.some((item) => item.kind === 'available' || item.kind === 'recording'))
        .map((source) => source.sourceId);
      if (!playableIds.length) {
        clock.reset(win.from);
        return;
      }
      const playback = await videoApi.playback({ sourceIds: playableIds, from: win.from, to: win.to }, controller.signal);
      if (version !== requestVersion.current) return;
      const loaded = await Promise.all(playback.sessions.map((s) => videoApi.manifest(s.manifestUrl, controller.signal)));
      if (version !== requestVersion.current) return;
      setManifests(Object.fromEntries(loaded.map((m) => [m.sourceId, m])));
      clock.reset(at ?? (loaded.flatMap((m) => m.segments).sort((a, b) => a.start - b.start)[0]?.start ?? win.from));
    } catch (reason) {
      if (version === requestVersion.current && !controller.signal.aborted) setError((reason as Error).message);
    }
    // clock.reset 是穩定的動作
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部條件只預填。即使事件／來源帶入完整條件，也必須由使用者按搜尋。
  useEffect(() => {
    queryAbort.current?.abort();
    requestVersion.current += 1;
    // 外部導覽條件是頁面輸入事件；收到時必須同步清掉上一個已套用結果。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvailability(null);
    setManifests({});
    setAppliedIds([]);
    setError('');
    if (!request) {
      setSelected([]);
      setPrefillVehicleCode('');
      setRange(EMPTY_RANGE);
      return;
    }
    setRange({ from: toLocalInput(request.from, timeZone), to: toLocalInput(request.to, timeZone) });
    const ids = (request.sourceIds ?? []).slice(0, 12);
    setSelected([...new Set(ids)]);
    setPrefillVehicleCode(request.vehicleCode ?? '');
  }, [request, timeZone]);

  const canSearch = Boolean(range.from && range.to && (selected.length || prefillVehicleCode.trim()));
  const canReset = Boolean(range.from || range.to || selected.length || prefillVehicleCode || availability || appliedIds.length || error || rangeError);

  const search = () => {
    const r = rangeToQuery(range, timeZone);
    if ('error' in r) return setRangeError(r.error);
    setRangeError(null);
    void (async () => {
      const candidateVersion = ++requestVersion.current;
      queryAbort.current?.abort();
      const candidateAbort = new AbortController();
      queryAbort.current = candidateAbort;
      let ids = [...new Set(selected)].slice(0, 12);
      if (!ids.length && prefillVehicleCode.trim()) {
        const candidates = await videoApi.sourceCandidates(prefillVehicleCode.trim(), r.from, r.to, candidateAbort.signal).catch((reason: Error) => {
          if (!candidateAbort.signal.aborted && candidateVersion === requestVersion.current) setError(reason.message);
          return null;
        });
        if (!candidates || candidateAbort.signal.aborted || candidateVersion !== requestVersion.current) return;
        ids = [...new Set(candidates.items.map((item) => item.id))].slice(0, 12);
        setSelected(ids);
      }
      if (candidateAbort.signal.aborted || candidateVersion !== requestVersion.current) return;
      if (!ids.length) return setError(prefillVehicleCode.trim() ? `找不到 ${prefillVehicleCode.trim()} 在這段期間的影像來源` : '請選擇影像來源');
      await query(ids, r, request?.at);
    })();
  };

  const reset = () => {
    queryAbort.current?.abort();
    requestVersion.current += 1;
    setSelected([]);
    setPrefillVehicleCode('');
    setAvailability(null);
    setManifests({});
    setAppliedIds([]);
    setError('');
    setRangeError(null);
    setAudio(null);
    setJob(null);
    setRange(EMPTY_RANGE);
    clock.reset(Date.now() - HOUR);
  };

  // 下載任務輪詢
  useEffect(() => {
    if (!job || job.status === 'succeeded' || job.status === 'failed' || job.status === 'expired') return undefined;
    const timer = setTimeout(() => void videoApi.job(job.id).then(setJob, () => undefined), 1_500);
    return () => clearTimeout(timer);
  }, [job]);

  const sourceOptions = useMemo(
    () => sources.map((source) => ({
      value: source.id,
      label: source.name,
      badge: source.deleted ? '已刪除' : !source.enabled ? '已停用' : source.state === 'online' ? undefined : OPTION_STATE_LABEL[source.state],
    })),
    [sources],
  );
  const playing = useMemo(() => appliedIds.filter((id) => manifests[id]), [appliedIds, manifests]);
  const selectedNames = selected.map((id) => sources.find((source) => source.id === id)?.name ?? id);
  const footage = useMemo(
    () => (availability?.sources ?? []).filter((s) => playing.includes(s.sourceId)).flatMap((s) => s.timeline.filter((item) => item.kind === 'available' || item.kind === 'recording')),
    [availability, playing],
  );

  const startExport = async (minutes: number) => {
    if (!auth.require('events.video-history.export') || !playing[0]) return;
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
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-auto p-4 text-text-primary">
      <div className="flex flex-wrap items-start gap-3">
        <RangeField value={range} onChange={setRange} timeZone={timeZone} error={rangeError} />
        <SiteMultiSelect
          ariaLabel="選擇影像來源"
          values={selected}
          options={sourceOptions}
          onChange={(values) => {
            setSelected(values);
            setPrefillVehicleCode('');
          }}
          allLabel="選擇影像來源"
          hideAllOption
          maxSelections={12}
          filterPlaceholder="搜尋影像來源"
          emptyLabel="沒有可查詢的影像來源"
          triggerLabel={selectedNames.length ? selectedNames.join('、') : prefillVehicleCode ? `${prefillVehicleCode} 的影像來源` : undefined}
          className="w-[15.5rem]"
        />
        <IconButton label="搜尋" icon={<Search />} disabled={!canSearch} onPress={search} />
        <Button variant="outlined" leadingIcon={<RotateCw />} disabled={!canReset} onPress={reset}>重置</Button>
      </div>
      {error ? <ErrorLine text={error} /> : null}

      {availability && playing.length ? (
        <>
          <div className={cn('grid min-h-[20rem] flex-1 auto-rows-fr gap-4', historyGrid(playing.length))}>
            {playing.map((id) => {
              const [code, label] = pillLabelParts(manifests[id].name, sources.find((s) => s.id === id)?.vehicleCode);
              return (
                <HistoryTile
                  key={id}
                  manifest={manifests[id]}
                  code={code}
                  label={label}
                  cursor={clock.t}
                  playing={clock.playing}
                  speed={clock.speed}
                  audio={audio === id}
                  onAudio={() => setAudio(audio === id ? null : id)}
                  onJump={clock.seek}
                />
              );
            })}
          </div>
          <div className="flex shrink-0 items-center gap-3 px-5">
            <IconButton hierarchy="subordinate" variant="tonal" label={clock.playing ? '暫停' : '播放'} icon={clock.playing ? <Pause /> : <Play />} onPress={() => clock.setPlaying(!clock.playing)} />
            <span className="shrink-0 text-body-m tabular-nums" title={formatDateTime(clock.t, timeZone)}>{elapsedText(clock.t - window_.from)}</span>
            <PlaybackSlider items={footage} from={window_.from} to={window_.to} cursor={clock.t} timeZone={timeZone} onSeek={clock.seek} />
            {clock.speed !== 1 ? <span className="shrink-0 text-body-s text-text-tertiary">{clock.speed}×</span> : null}
            {job ? (
              <span className="shrink-0 text-body-xs text-text-secondary" role="status" title={job.note ?? undefined}>
                {job.status === 'succeeded' && job.downloadUrl ? <a href={mediaUrl(job.downloadUrl)} className="text-text-theme underline">下載檔案（{formatBytes(Number(job.result?.bytes ?? 0))}）</a> : job.status === 'failed' ? `下載失敗：${job.error}` : '下載準備中…'}
              </span>
            ) : null}
            <MoreMenu speed={clock.speed} onSpeed={clock.setSpeed} onExport={(m) => void startExport(m)} onProtect={() => void protect()} onDelete={() => void previewDelete()} />
          </div>
        </>
      ) : availability ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-text-secondary">
          <p className="text-headline-4">( ˘-˘ )ง</p>
          <p className="text-body-m">這段時間沒有可播放的錄影</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-text-secondary">
          <p className="text-headline-4">( ¯ㄴ¯ )ง</p>
          <p className="text-body-m">尚未條件篩選</p>
        </div>
      )}

      {deletePreview ? (
        <Dialog
          title="刪除錄影"
          onClose={() => setDeletePreview(null)}
          footer={
            <>
              <Button hierarchy="subordinate" variant="standard" onPress={() => setDeletePreview(null)}>取消</Button>
              <Button
                hierarchy="danger"
                disabled={!deletePreview.segments}
                onPress={() => {
                  setDeletePreview(null);
                  void videoApi.deleteRecordings({ sourceIds: playing, from: window_.from, to: window_.to, confirm: true }).then((j) => {
                    setJob(null);
                    notify(`已建立刪除工作（${j.status}）`, 'success');
                    setTimeout(() => void query(playing, window_, clock.t), 3000);
                  }, (e: Error) => notify(e.message, 'error'));
                }}
              >
                刪除 {deletePreview.segments} 個片段
              </Button>
            </>
          }
        >
          <p className="text-body-s text-text-secondary">{formatDateTime(window_.from, timeZone)} 至 {formatDateTime(window_.to, timeZone)}：將刪除 {deletePreview.segments} 個片段（{formatBytes(deletePreview.bytes)}）。{deletePreview.protectedSegments ? `受保護的 ${deletePreview.protectedSegments} 個片段不會刪除。` : ''}</p>
          <p className="mt-2 text-body-xs text-text-quaternary">{deletePreview.note}</p>
        </Dialog>
      ) : null}
      {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}

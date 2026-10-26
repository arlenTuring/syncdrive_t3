import { Check, Download, Maximize2, Pause, Play, Shield, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SiteSelect } from '../../components/SiteSelect';
import { useAuth } from '../access-control/AuthContext';
import { Dialog, ErrorLine, GhostButton, PrimaryButton, Toast } from '../media-groups/dialogs';
import { QueryActions, RangeFilter } from '../event-log-shared/ui';
import { formatDateTime, rangeToQuery, toLocalInput, type RangeDraft } from '../event-log-shared/time';
import { formatBytes, mediaUrl, videoApi, type Availability, type Job, type Manifest, type SourceOption, type TimelineItem } from './api';
import { SegmentFollower } from './SegmentFollower';
import type { HistoryRequest } from './history-link';
import { OPTION_STATE_LABEL } from './status';

/** 歷史多畫面：依路數決定欄數（歷史回放的格子大小不需保存） */
function historyGrid(count: number) {
  if (count <= 1) return 'grid-cols-1';
  if (count <= 4) return 'grid-cols-1 sm:grid-cols-2';
  if (count <= 9) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
}

const DEFAULT_TZ = 'Asia/Taipei';
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

function Timeline({ items, from, to, cursor, timeZone, onSeek }: { items: TimelineItem[]; from: number; to: number; cursor: number; timeZone: string; onSeek: (t: number) => void }) {
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
      aria-valuetext={formatDateTime(cursor, timeZone)}
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
        <div key={i} title={`${KIND_LABEL[item.kind]}${item.protected ? '（受保護）' : ''}：${formatDateTime(item.from, timeZone)}–${formatDateTime(item.to, timeZone)}${item.reason ? `・${item.reason}` : ''}`}
          className={`absolute inset-y-0 ${KIND_STYLE[item.kind]} ${item.protected ? 'border-y-2 border-amber-300' : ''}`}
          style={{ left: `${((item.from - from) / span) * 100}%`, width: `${Math.max(0.2, ((item.to - item.from) / span) * 100)}%` }} />
      ))}
      <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${((cursor - from) / span) * 100}%` }} />
      {hover !== null ? <div className="pointer-events-none absolute -top-0.5 rounded bg-black/80 px-1 text-[10px] text-white" style={{ left: `calc(${((hover - from) / span) * 100}% + 4px)` }}>{formatDateTime(hover, timeZone).slice(11)}</div> : null}
    </div>
  );
}

/**
 * 獨立「影像管理紀錄」頁。
 * 先查可用區間（只讀索引），需要時才載入片段；多畫面共用絕對時間游標，缺段的畫面顯示空白狀態，不暫停其他畫面。
 * 可查停用或已刪除但仍有錄影的來源；來源清單只用安全摘要，不需要也拿不到連線資訊。
 */
export function VideoHistoryPage({ request }: { request?: HistoryRequest | null }) {
  const auth = useAuth();
  const [timeZone, setTimeZone] = useState(DEFAULT_TZ);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [tempSelected, setTempSelected] = useState<string[]>([]);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const [prefillVehicleCode, setPrefillVehicleCode] = useState('');
  const [range, setRange] = useState<RangeDraft>(() => ({ from: toLocalInput(Date.now() - HOUR, DEFAULT_TZ), to: toLocalInput(Date.now(), DEFAULT_TZ) }));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [window_, setWindow] = useState<{ from: number; to: number }>(() => ({ from: Date.now() - HOUR, to: Date.now() }));
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
    setDays([]);
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
      const monthStart = new Date(win.from);
      void videoApi.calendar(ids, Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1) - 8 * HOUR, Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1), timeZone, controller.signal).then((r) => version === requestVersion.current && setDays(r.days), () => undefined);
    } catch (reason) {
      if (version === requestVersion.current && !controller.signal.aborted) setError((reason as Error).message);
    }
    // clock.reset 是穩定的動作
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeZone]);

  // 外部條件只預填。即使事件／來源帶入完整條件，也必須由使用者按搜尋。
  useEffect(() => {
    queryAbort.current?.abort();
    requestVersion.current += 1;
    // 外部導覽條件是頁面輸入事件；收到時必須同步清掉上一個已套用結果。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvailability(null);
    setManifests({});
    setDays([]);
    setAppliedIds([]);
    setError('');
    if (!request) {
      setSelected([]);
      setPrefillVehicleCode('');
      setRange({ from: toLocalInput(Date.now() - HOUR, timeZone), to: toLocalInput(Date.now(), timeZone) });
      return;
    }
    setRange({ from: toLocalInput(request.from, timeZone), to: toLocalInput(request.to, timeZone) });
    const ids = (request.sourceIds ?? []).slice(0, 12);
    setSelected([...new Set(ids)]);
    setPrefillVehicleCode(request.vehicleCode ?? '');
  }, [request, timeZone]);

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
    setSourceDialogOpen(false);
    setTempSelected([]);
    setAvailability(null);
    setManifests({});
    setDays([]);
    setAppliedIds([]);
    setError('');
    setRangeError(null);
    setAudio(null);
    setDrifts({});
    setJob(null);
    setRange({ from: toLocalInput(Date.now() - HOUR, timeZone), to: toLocalInput(Date.now(), timeZone) });
    clock.reset(Date.now() - HOUR);
  };

  // 下載任務輪詢
  useEffect(() => {
    if (!job || job.status === 'succeeded' || job.status === 'failed' || job.status === 'expired') return undefined;
    const timer = setTimeout(() => void videoApi.job(job.id).then(setJob, () => undefined), 1_500);
    return () => clearTimeout(timer);
  }, [job]);

  const sourceGroups = useMemo(() => {
    const groups = new Map<string, SourceOption[]>();
    for (const source of sources) {
      const labels = source.tags.length ? [...new Set(source.tags)] : ['未分類'];
      for (const label of labels) groups.set(label, [...(groups.get(label) ?? []), source]);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === '未分類' ? 1 : b === '未分類' ? -1 : a.localeCompare(b, 'zh-Hant')));
  }, [sources]);
  const playing = useMemo(() => appliedIds.filter((id) => manifests[id]), [appliedIds, manifests]);
  const selectedNames = selected.map((id) => sources.find((source) => source.id === id)?.name ?? id);

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
        <RangeFilter compact value={range} onChange={setRange} timeZone={timeZone} error={rangeError} />
        <label className="flex min-w-[15rem] flex-col gap-1.5">
          <span className="text-xs text-zinc-400">影像來源</span>
          <button type="button" onClick={() => { setTempSelected(selected); setSourceDialogOpen(true); }} className="flex h-10 max-w-80 items-center justify-between gap-2 rounded-xl bg-[#222831] px-3 text-left text-sm hover:bg-[#2b313b]" aria-label="選擇影像來源"><span className="truncate">{selectedNames.length ? selectedNames.join('、') : '選擇影像來源'}</span><span className="shrink-0 text-xs text-zinc-400">{selected.length}/12</span></button>
        </label>
        <QueryActions onSearch={search} onReset={reset} />
      </div>
      {error ? <ErrorLine text={error} /> : null}

      {availability && playing.length ? (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#16181d] px-3 py-2 text-sm">
            <button type="button" onClick={() => clock.setPlaying(!clock.playing)} aria-label={clock.playing ? '暫停' : '播放'} className="rounded-lg bg-blue-600 p-1.5 hover:bg-blue-500">
              {clock.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <span className="tabular-nums">{formatDateTime(clock.t, timeZone)}</span>
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
                <Timeline items={s.timeline} from={window_.from} to={window_.to} cursor={clock.t} timeZone={timeZone} onSeek={clock.seek} />
              </div>
            ))}
            <div className="flex flex-wrap gap-3 pl-[10.5rem] text-[11px] text-zinc-500">
              {(Object.keys(KIND_LABEL) as Array<TimelineItem['kind']>).map((k) => <span key={k} className="inline-flex items-center gap-1"><span className={`inline-block size-2.5 rounded-sm ${KIND_STYLE[k]}`} />{KIND_LABEL[k]}</span>)}
              <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm border-2 border-amber-300" />受保護</span>
            </div>
          </div>

          <div ref={stageRef} className={`grid min-h-[20rem] flex-1 gap-2 ${historyGrid(playing.length || 1)}`}>
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
      ) : availability ? (
        <div className="rounded-xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-400">
          這段時間沒有可播放片段。沒有建立播放工作階段，也沒有自動播放。
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500">
          選擇影像來源與時間後按「搜尋」。進入本頁不會自動查詢或播放。
          {days.length ? <div className="mt-2">本月有錄影的日期：{days.join('、')}</div> : null}
        </div>
      )}
      {availability && days.length ? (
        <div className="text-xs text-zinc-500">本月有錄影的日期：{days.map((d) => (
          <button key={d} type="button" onClick={() => { const parsed = rangeToQuery({ from: `${d}T00:00:00`, to: `${d}T23:59:59` }, timeZone); if (!('error' in parsed)) setRange({ from: toLocalInput(parsed.from, timeZone), to: toLocalInput(parsed.to - 1000, timeZone) }); }} className="mr-1 text-sky-300 underline">{d.slice(5)}</button>
        ))}</div>
      ) : null}

      {deletePreview ? (
        <Dialog title="刪除錄影" onClose={() => setDeletePreview(null)} footer={<><GhostButton onClick={() => setDeletePreview(null)}>取消</GhostButton><PrimaryButton danger disabled={!deletePreview.segments} onClick={() => { setDeletePreview(null); void videoApi.deleteRecordings({ sourceIds: playing, from: window_.from, to: window_.to, confirm: true }).then((j) => { setJob(null); notify(`已建立刪除工作（${j.status}）`, 'success'); setTimeout(() => void query(playing, window_, clock.t), 3000); }, (e: Error) => notify(e.message, 'error')); }}>刪除 {deletePreview.segments} 個片段</PrimaryButton></>}>
          <p className="text-sm text-zinc-300">{formatDateTime(window_.from, timeZone)} 至 {formatDateTime(window_.to, timeZone)}：將刪除 {deletePreview.segments} 個片段（{formatBytes(deletePreview.bytes)}）。{deletePreview.protectedSegments ? `受保護的 ${deletePreview.protectedSegments} 個片段不會刪除。` : ''}</p>
          <p className="mt-2 text-xs text-zinc-500">{deletePreview.note}</p>
        </Dialog>
      ) : null}
      {sourceDialogOpen ? <Dialog title="選擇影像來源" width="max-w-2xl" onClose={() => setSourceDialogOpen(false)} footer={<><GhostButton onClick={() => setSourceDialogOpen(false)}>取消</GhostButton><PrimaryButton disabled={tempSelected.length === 0} onClick={() => { setSelected([...new Set(tempSelected)].slice(0, 12)); setPrefillVehicleCode(''); setSourceDialogOpen(false); }}>確定（{tempSelected.length}/12）</PrimaryButton></>}>
        <p className="mb-3 text-sm text-zinc-400">可選 1–12 個來源；確認只套用選擇，不會自動查詢或播放。</p>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {sourceGroups.map(([label, group]) => <section key={label} className="overflow-hidden rounded-xl border border-zinc-700"><h3 className="bg-[#232730] px-4 py-2 text-sm font-medium">{label}</h3>{group.map((source) => { const active = tempSelected.includes(source.id); const limit = !active && tempSelected.length >= 12; return <button key={`${label}:${source.id}`} type="button" disabled={limit} aria-pressed={active} onClick={() => setTempSelected((current) => active ? current.filter((id) => id !== source.id) : [...current, source.id])} className="flex w-full items-center gap-3 border-t border-zinc-800 px-4 py-3 text-left text-sm hover:bg-white/5 disabled:opacity-40"><span className={`flex size-5 shrink-0 items-center justify-center rounded border ${active ? 'border-blue-500 bg-blue-600' : 'border-zinc-600'}`}>{active ? <Check className="size-3.5" /> : null}</span><span className="min-w-0 flex-1"><span className="block truncate">{source.name}</span><span className="text-xs text-zinc-500">{[source.vehicleCode, source.location].filter(Boolean).join('・') || '未綁定載具／位置'}</span></span><span className="text-xs text-zinc-400">{source.deleted ? '已刪除' : !source.enabled ? '已停用' : OPTION_STATE_LABEL[source.state]}</span></button>; })}</section>)}
          {!sourceGroups.length ? <p className="py-8 text-center text-sm text-zinc-500">沒有可查詢的影像來源</p> : null}
        </div>
      </Dialog> : null}
      {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}

import { Copy, Film, HardDrive, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../access-control/AuthContext';
import { subscribeDatasourceInvalidation } from '../dashboard/utils/datasourceInvalidationBus';
import { ListFooter, ListState, QueryActions, SelectFilter, TextFilter } from '../event-log-shared/ui';
import { Dialog, ErrorLine, GhostButton, PrimaryButton, Toast } from '../media-groups/dialogs';
import { videoApi, type Defaults, type Settings, type SourceQuery, type StorageStatus, type VideoSourceItem } from './api';
import { DefaultsDialog } from './DefaultsDialog';
import { OPEN_VIDEO_RESOURCES_EVENT, takeHistoryRequest, type HistoryRequest } from './history-link';
import { tagKey } from './layout';
import { SourceDialog } from './SourceDialog';
import { BADGE_TONE, onlineBadge, recordingBadge } from './status';
import { StorageDialog } from './StorageDialog';
import { VideoHistoryPage } from './VideoHistoryPage';

const PAGE_SIZE = 20;
const HOUR = 3_600_000;
const emptyFilters = { q: '', tags: [] as string[], enabled: '' as SourceQuery['enabled'], online: '' as SourceQuery['online'] };
type Filters = typeof emptyFilters;
type HistoryView = { request: HistoryRequest; title?: string };

const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);

/**
 * 影像資源管理：來源清單（分頁、篩選、真實狀態）、啟停、新增／編輯、一鍵複製、刪除、分類標籤、儲存錄影、歷史錄影入口。
 *
 * - 清單不播放影片、不建立任何播放 session、不載入縮圖；歷史錄影在明確點入的子畫面才播放。
 * - 「啟用」是使用者指令、「上線」是實際探測結果、「錄影」又是另一件事，三者分開顯示；過期狀態顯示「狀態待更新」。
 * - 全域來源預設、連線範圍與錄影儲存設定在「進階設定」。
 */
export function VideoResourcesPage() {
  const auth = useAuth();
  const canConfigure = auth.can('events.video.configure');
  const canManageRecording = auth.can('events.video.recording-manage');
  const canHistory = auth.can('events.video-history.view');
  const canList = canConfigure || canManageRecording;

  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<VideoSourceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState('');
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [tagOptions, setTagOptions] = useState<Array<{ tag: string; count: number }>>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [highlight, setHighlight] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ source: VideoSourceItem | null } | null>(null);
  const [deleting, setDeleting] = useState<{ source: VideoSourceItem; impact: { tabs: number; tiles: number; stopsRecording: boolean } } | null>(null);
  const [advanced, setAdvanced] = useState<null | 'defaults' | 'storage'>(null);
  const [defaultsData, setDefaultsData] = useState<{ defaults: Defaults; settings: Settings } | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [history, setHistory] = useState<HistoryView | null>(() => {
    const req = takeHistoryRequest();
    return req ? { request: req } : null;
  });
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error'; id: number } | null>(null);
  const notify = useCallback((text: string, tone: 'success' | 'error') => setNotice((n) => ({ text, tone, id: (n?.id ?? 0) + 1 })), []);

  // 清單只在條件、頁碼或明確重新整理時查詢；舊請求的回應不會蓋過新條件
  const requestKey = JSON.stringify({ filters, page, reload });
  const loading = canList && loadedKey !== requestKey;
  useEffect(() => {
    if (!canList) return undefined;
    const controller = new AbortController();
    videoApi.sources({ ...filters, page, pageSize: PAGE_SIZE }, controller.signal).then(
      (result) => {
        setItems(result.items);
        setTotal(result.total);
        setError('');
        setLoadedKey(requestKey);
      },
      (reason: Error) => {
        if (controller.signal.aborted) return;
        setError(reason.message);
        setLoadedKey(requestKey);
      },
    );
    return () => controller.abort();
  }, [canList, filters, page, requestKey]);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    void videoApi.sourceTags().then(setTagOptions, () => undefined);
    if (canList || canHistory) void videoApi.storageStatus().then(setStorage, () => undefined);
  }, [canList, canHistory]);
  // 狀態變化（worker 探測、其他人修改）：有界地重新取得目前這一頁，不建立任何播放
  useEffect(() => subscribeDatasourceInvalidation((payload) => {
    if (payload.tags.includes('table:video_sources')) refresh();
  }), [refresh]);
  useEffect(() => {
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  // 其他頁面帶條件進來（事件前後、舊歷史連結）
  useEffect(() => {
    const onOpen = (event: Event) => {
      const wantsHistory = (event as CustomEvent<{ history?: boolean }>).detail?.history;
      const req = takeHistoryRequest();
      setHistory(wantsHistory && req ? { request: req } : null);
    };
    window.addEventListener(OPEN_VIDEO_RESOURCES_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_VIDEO_RESOURCES_EVENT, onOpen);
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const search = () => {
    setPage(1);
    setFilters({ ...draft });
  };
  const reset = () => {
    setDraft(emptyFilters);
    setFilters(emptyFilters);
    setPage(1);
  };
  const replaceItem = (next: VideoSourceItem) => setItems((list) => list.map((s) => (s.id === next.id ? next : s)));

  const toggleEnabled = async (s: VideoSourceItem) => {
    if (!auth.require('events.video.configure') || pending[s.id]) return;
    setPending((p) => ({ ...p, [s.id]: s.enabled ? '停用中…' : '啟用中…' }));
    try {
      replaceItem(await videoApi.setSourceEnabled(s.id, { expectedVersion: s.version, enabled: !s.enabled }));
      notify(s.enabled ? `已停用「${s.name}」：停止本站接入與新錄影，歷史保留` : `已啟用「${s.name}」：連線由背景套用，狀態會在清單更新`, 'success');
    } catch (reason) {
      notify(`「${s.name}」${s.enabled ? '停用' : '啟用'}失敗：${(reason as Error).message}`, 'error');
      refresh();
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[s.id];
        return next;
      });
    }
  };

  const duplicate = async (s: VideoSourceItem) => {
    if (!auth.require('events.video.configure') || pending[s.id]) return;
    setPending((p) => ({ ...p, [s.id]: '複製中…' }));
    try {
      const copy = await videoApi.duplicateSource(s.id, { expectedVersion: s.version, requestId: newRequestId() });
      // 新列直接出現在原來源下方並標示；依排序可能不在這一頁，提示可用名稱找到它
      setItems((list) => {
        const i = list.findIndex((x) => x.id === s.id);
        const next = list.filter((x) => x.id !== copy.id);
        next.splice(i + 1, 0, copy);
        return next;
      });
      setTotal((t) => t + 1);
      setHighlight(copy.id);
      notify(`已複製為「${copy.name}」（新的來源，沒有沿用原來源的歷史）；重新整理後依名稱排序`, 'success');
    } catch (reason) {
      notify(`複製失敗：${(reason as Error).message}`, 'error');
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[s.id];
        return next;
      });
    }
  };

  const askDelete = async (s: VideoSourceItem) => {
    if (!auth.require('events.video.configure')) return;
    try {
      const impact = await videoApi.deleteImpact(s.id);
      setDeleting({ source: s, impact });
    } catch (reason) {
      notify((reason as Error).message, 'error');
    }
  };

  const openAdvanced = async (which: 'defaults' | 'storage') => {
    if (which === 'defaults') {
      if (!auth.require('events.video.configure')) return;
      try {
        const [defaults, settings] = await Promise.all([videoApi.defaults(), videoApi.settings()]);
        setDefaultsData({ defaults, settings });
        setAdvanced('defaults');
      } catch (reason) {
        notify((reason as Error).message, 'error');
      }
      return;
    }
    try {
      setStorage(await videoApi.storageStatus());
      setAdvanced('storage');
    } catch (reason) {
      notify((reason as Error).message, 'error');
    }
  };

  const openHistory = (s?: VideoSourceItem) => {
    if (!auth.require('events.video-history.view')) return;
    const now = Date.now();
    setHistory({ request: { from: now - HOUR, to: now, sourceIds: s ? [s.id] : [] }, title: s?.name });
  };

  const tagSuggestions = useMemo(() => tagOptions.map((t) => t.tag), [tagOptions]);

  if (history) {
    return <VideoHistoryPage key={JSON.stringify(history.request)} request={history.request.sourceIds?.length || history.request.vehicleCode ? history.request : null} title={history.title} onBack={() => setHistory(null)} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 text-zinc-100">
      <div className="flex flex-wrap items-end gap-3">
        <TextFilter label="名稱／載具／位置" value={draft.q} onChange={(q) => setDraft((d) => ({ ...d, q }))} onEnter={search} placeholder="關鍵字" />
        <SelectFilter label="啟用狀態" value={draft.enabled ?? ''} options={[{ value: 'true', label: '已啟用' }, { value: 'false', label: '已停用' }]} onChange={(v) => setDraft((d) => ({ ...d, enabled: v as Filters['enabled'] }))} />
        <SelectFilter label="上線狀態" value={draft.online ?? ''} options={[{ value: 'online', label: '線上' }, { value: 'offline', label: '離線' }, { value: 'unknown', label: '狀態待更新' }, { value: 'disabled', label: '已停用' }]} onChange={(v) => setDraft((d) => ({ ...d, online: v as Filters['online'] }))} />
        <QueryActions onSearch={search} onReset={reset} />
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <button type="button" onClick={() => openHistory()} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-white/5">
            <Film className="size-4" />歷史錄影
          </button>
          <button type="button" onClick={() => void openAdvanced('storage')} className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm hover:bg-white/5 ${storage?.paused ? 'border-amber-500/40 text-amber-200' : 'border-zinc-700 text-zinc-200'}`}>
            <HardDrive className="size-4" />{storage?.paused ? `錄影暫停：${storage.paused.reason}` : '錄影儲存設定'}
          </button>
          <button type="button" onClick={() => void openAdvanced('defaults')} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-white/5">
            <SlidersHorizontal className="size-4" />全域預設與連線範圍
          </button>
          <button type="button" onClick={() => auth.require('events.video.configure') && setDialog({ source: null })} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-medium hover:bg-blue-500">
            <Plus className="size-4" />新增來源
          </button>
        </div>
      </div>
      {tagOptions.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="來源標籤篩選">
          <span className="text-zinc-400">來源標籤</span>
          {tagOptions.map(({ tag, count }) => {
            const key = tagKey(tag);
            const on = draft.tags.includes(key);
            return (
              <button key={key} type="button" aria-pressed={on} onClick={() => setDraft((d) => ({ ...d, tags: on ? d.tags.filter((t) => t !== key) : [...d.tags, key] }))}
                className={`rounded-md border px-2 py-1 ${on ? 'border-sky-500 bg-sky-500/15 text-sky-100' : 'border-zinc-700 text-zinc-300 hover:bg-white/5'}`}>
                {tag}<span className="ml-1 text-zinc-500">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {!canList ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-zinc-400">
          <p>你的帳號可以查詢歷史錄影，但沒有管理影像來源的權限。</p>
          <PrimaryButton onClick={() => openHistory()}>查詢歷史錄影</PrimaryButton>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-zinc-800">
            <table className="w-full min-w-[78rem] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-[#16181d] text-zinc-400">
                <tr className="border-b border-zinc-800">
                  <th className="w-10 px-3 py-3"><span className="sr-only">勾選</span></th>
                  <th className="px-3 py-3 font-normal">名稱</th>
                  <th className="px-3 py-3 font-normal">來源標籤</th>
                  <th className="px-3 py-3 font-normal">載具／位置</th>
                  <th className="px-3 py-3 font-normal">啟用</th>
                  <th className="px-3 py-3 font-normal">上線狀態</th>
                  <th className="px-3 py-3 font-normal">儲存錄影</th>
                  <th className="px-3 py-3 font-normal">實際錄影</th>
                  <th className="px-3 py-3 font-normal">來源</th>
                  <th className="px-3 py-3 font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const online = onlineBadge(s);
                  const rec = recordingBadge(s);
                  const busy = pending[s.id];
                  return (
                    <tr key={s.id} className={`border-b border-zinc-800/80 align-top ${highlight === s.id ? 'bg-sky-500/10' : ''}`}>
                      <td className="px-3 py-3">
                        <input type="checkbox" aria-label={`勾選 ${s.name}`} checked={selected.includes(s.id)} onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))} className="accent-blue-600" />
                      </td>
                      <td className="max-w-[14rem] px-3 py-3"><span className="block truncate" title={s.name}>{s.name}</span>{highlight === s.id ? <span className="text-xs text-sky-300">新複製</span> : null}</td>
                      <td className="max-w-[12rem] px-3 py-3">
                        <div className="flex flex-wrap gap-1">{s.tags.length ? s.tags.map((t) => <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">{t}</span>) : <span className="text-xs text-zinc-600">—</span>}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-zinc-300">{[s.vehicleCode, s.location].filter(Boolean).join('・') || '—'}</td>
                      <td className="px-3 py-3">
                        <button type="button" role="switch" aria-checked={s.enabled} aria-label={`${s.name} ${s.enabled ? '停用' : '啟用'}`} disabled={Boolean(busy)} onClick={() => void toggleEnabled(s)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-60 ${s.enabled ? 'bg-blue-600' : 'bg-zinc-600'}`}>
                          <span className={`inline-block size-4 rounded-full bg-white transition-transform ${s.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                        {busy ? <span className="ml-2 text-xs text-zinc-400">{busy}</span> : null}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${BADGE_TONE[online.tone]}`} title={s.actualStatus.reason ?? undefined}>{online.text}</span>
                        {s.enabled && s.actualStatus.state === 'offline' && s.actualStatus.reason && !s.actualStatus.stale ? <span className="mt-1 block max-w-[12rem] truncate text-[11px] text-zinc-500" title={s.actualStatus.reason}>{s.actualStatus.reason}</span> : null}
                      </td>
                      <td className="px-3 py-3 text-xs">{s.recordingEnabled ? '儲存' : '不儲存'}</td>
                      <td className="px-3 py-3"><span className={`rounded px-1.5 py-0.5 text-xs ${BADGE_TONE[rec.tone]}`}>{rec.text}</span></td>
                      <td className="max-w-[16rem] px-3 py-3"><span className="block truncate font-mono text-xs text-zinc-400" title={s.connection?.maskedUrl}>{s.connection?.maskedUrl ?? '—'}</span></td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          <button type="button" onClick={() => auth.require('events.video.configure') && setDialog({ source: s })} aria-label={`編輯 ${s.name}`} className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-xs hover:bg-white/5"><Pencil className="size-3.5" />編輯</button>
                          <button type="button" onClick={() => void duplicate(s)} disabled={Boolean(busy)} aria-label={`複製 ${s.name}`} className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-50"><Copy className="size-3.5" />複製</button>
                          <button type="button" onClick={() => openHistory(s)} aria-label={`${s.name} 歷史錄影`} className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-xs hover:bg-white/5"><Film className="size-3.5" />歷史錄影</button>
                          <button type="button" onClick={() => void askDelete(s)} aria-label={`刪除 ${s.name}`} className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-xs text-red-300 hover:bg-white/5"><Trash2 className="size-3.5" />刪除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ListState loading={loading} error={error} empty={!items.length} emptyText={filters === emptyFilters ? '還沒有影像來源' : '沒有符合條件的來源'} onRetry={refresh} />
            {!items.length && !loading && !error && filters === emptyFilters ? (
              <div className="-mt-8 pb-10 text-center">
                <PrimaryButton onClick={() => auth.require('events.video.configure') && setDialog({ source: null })}>新增第一個來源</PrimaryButton>
              </div>
            ) : null}
          </div>
          <ListFooter page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} summary={<>共 {total} 個來源{selected.length ? `・已勾選 ${selected.length} 個（可在「全域預設」批次套用）` : ''}</>} />
        </>
      )}

      {dialog ? (
        <SourceDialog
          source={dialog.source}
          tagSuggestions={tagSuggestions}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            const isNew = !dialog.source;
            setDialog(null);
            if (isNew) {
              setItems((list) => [saved, ...list.filter((x) => x.id !== saved.id)]);
              setTotal((t) => t + 1);
              setHighlight(saved.id);
            } else replaceItem(saved);
            void videoApi.sourceTags().then(setTagOptions, () => undefined);
            notify(isNew ? `已新增「${saved.name}」${saved.recordingEnabled ? '，啟用後由伺服器持續錄影' : ''}` : `已儲存「${saved.name}」`, 'success');
          }}
        />
      ) : null}
      {deleting ? (
        <Dialog
          title="刪除影像來源"
          onClose={() => setDeleting(null)}
          footer={<><GhostButton onClick={() => setDeleting(null)}>取消</GhostButton><PrimaryButton danger onClick={() => {
            const d = deleting;
            setDeleting(null);
            void videoApi.deleteSource(d.source.id, d.source.version).then(
              () => { notify(`已刪除「${d.source.name}」；已錄的影片仍可在歷史錄影查詢`, 'success'); refresh(); },
              (reason: Error) => notify(reason.message, 'error'),
            );
          }}>刪除</PrimaryButton></>}
        >
          <div className="space-y-2 text-sm text-zinc-300">
            <p>確定刪除「{deleting.source.name}」？</p>
            <ul className="list-disc space-y-1 pl-5 text-zinc-400">
              <li>{deleting.impact.tabs ? `${deleting.impact.tabs} 個監控標籤頁（${deleting.impact.tiles} 格）引用這個來源：格子保留位置，顯示「來源已刪除」，可重新選擇。` : '沒有監控標籤頁引用這個來源。'}</li>
              <li>{deleting.impact.stopsRecording ? '會停止這個來源的錄影（完成目前片段）。' : '這個來源目前沒有錄影。'}</li>
              <li>已錄的影片與稽核紀錄保留，仍可從「歷史錄影」查詢；刪除影片需要另外的權限。</li>
            </ul>
          </div>
        </Dialog>
      ) : null}
      {advanced === 'defaults' && defaultsData ? (
        <DefaultsDialog defaults={defaultsData.defaults} settings={defaultsData.settings} selectedSourceIds={selected} tagOptions={tagSuggestions} onClose={() => setAdvanced(null)} onChanged={refresh} />
      ) : null}
      {advanced === 'storage' && storage ? (
        <StorageDialog status={storage} timeZone="Asia/Taipei" onClose={() => setAdvanced(null)} onChanged={(next) => { setStorage(next); notify('已儲存錄影設定', 'success'); }} />
      ) : null}
      {error && !canList ? <ErrorLine text={error} /> : null}
      {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}

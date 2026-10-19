import { HardDrive, MoreHorizontal, Plus, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useAuth } from '../access-control/AuthContext';
import { subscribeDatasourceInvalidation } from '../dashboard/utils/datasourceInvalidationBus';
import { Dialog, ErrorLine, GhostButton, PrimaryButton, Toast } from '../media-groups/dialogs';
import { formatBytes, videoApi, type Bootstrap, type Tab, type Tile } from './api';
import { DefaultsDialog } from './DefaultsDialog';
import { StorageDialog } from './StorageDialog';
import { TileSettingsDialog } from './TileSettingsDialog';
import { gridColumns } from './layout';
import { TileView } from './TileView';

const PREF_KEY = 'vtms.video.monitor';
const QUICK = [1, 4, 9, 12];

function readPref(): { tabId?: string; audio?: string } {
  try {
    return JSON.parse(window.localStorage.getItem(PREF_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function writePref(pref: { tabId?: string; audio?: string }) {
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify(pref));
  } catch {
    /* 個人偏好存不了不影響功能 */
  }
}

type ShrinkPrompt = { tab: Tab; count: number; removed: Array<{ position: number; displayName: string | null }>; stopping: Array<{ name: string }> };

/**
 * 事件管理模組 → 影像監控管理：使用者自建的監控標籤頁（每頁 1–12 格，每格都能用）。
 *
 * - 標籤與格子是場站共用設定（存在後端）；目前所在標籤與開聲音的格子是個人偏好（只存在這台瀏覽器）。
 * - 只有目前標籤的格子會播放；切換標籤會釋放播放器，後端錄影照常。
 * - 錄影由伺服器持續進行，與這個頁面是否開著無關。
 */
export function VideoMonitorPage() {
  const auth = useAuth();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');
  const [tabId, setTabId] = useState<string | undefined>(() => readPref().tabId);
  const [audioTile, setAudioTile] = useState<string | undefined>(() => readPref().audio);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [editingTile, setEditingTile] = useState<Tile | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [showDefaults, setShowDefaults] = useState(false);
  const [showStorage, setShowStorage] = useState(false);
  const [shrink, setShrink] = useState<ShrinkPrompt | null>(null);
  const [deleting, setDeleting] = useState<Tab | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error'; id: number } | null>(null);
  const notify = useCallback((text: string, tone: 'success' | 'error') => setNotice((n) => ({ text, tone, id: (n?.id ?? 0) + 1 })), []);
  const [customCount, setCustomCount] = useState('');
  const dragging = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await videoApi.bootstrap());
      setError('');
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    videoApi.bootstrap().then((next) => !cancelled && setData(next), (reason: Error) => !cancelled && setError(reason.message));
    return () => {
      cancelled = true;
    };
  }, []);
  // 來源狀態（連線、錄影）變化與其他人修改設定：重新取得
  useEffect(() => subscribeDatasourceInvalidation((payload) => {
    if (payload.tags.includes('table:video_sources')) void load();
  }), [load]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const tabs = useMemo(() => data?.tabs ?? [], [data]);
  const current = tabs.find((t) => t.id === tabId) ?? tabs[0] ?? null;
  const sourceById = useMemo(() => new Map((data?.sources ?? []).map((s) => [s.id, s])), [data]);
  useEffect(() => writePref({ tabId: current?.id, audio: audioTile }), [current?.id, audioTile]);

  const mutate = async (fn: () => Promise<unknown>, success?: string) => {
    setSaving(true);
    try {
      await fn();
      await load();
      if (success) notify(success, 'success');
    } catch (reason) {
      notify((reason as Error).message, 'error');
      await load();
    } finally {
      setSaving(false);
    }
  };
  const canConfigure = () => auth.require('events.video.configure');

  const addTab = () => canConfigure() && mutate(async () => {
    const tab = await videoApi.createTab({ name: `監控 ${tabs.length + 1}`, tileCount: 4 });
    setTabId(tab.id);
    setRenaming(tab.id);
  }, '已新增標籤');

  const setTileCount = async (count: number) => {
    if (!current || count === current.tileCount || !canConfigure()) return;
    if (count < 1 || count > 12) return notify('每頁格數必須是 1–12', 'error');
    if (count < current.tileCount) {
      const impact = await videoApi.tileCountPreview(current.id, count);
      if (impact.removedTiles.length || impact.stoppingRecordings.length) {
        setShrink({ tab: current, count, removed: impact.removedTiles, stopping: impact.stoppingRecordings });
        return;
      }
    }
    await mutate(() => videoApi.updateTab(current.id, { tileCount: count, expectedVersion: current.version }));
  };

  const onDrop = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    const from = dragging.current;
    dragging.current = null;
    if (!from || from === targetId || !canConfigure()) return;
    const ids = tabs.map((t) => t.id).filter((id) => id !== from);
    ids.splice(ids.indexOf(targetId), 0, from);
    void mutate(() => videoApi.reorderTabs(ids));
  };
  const move = (tab: Tab, delta: number) => {
    const ids = tabs.map((t) => t.id);
    const i = ids.indexOf(tab.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length || !canConfigure()) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void mutate(() => videoApi.reorderTabs(ids));
  };

  const storage = data?.storage;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 text-zinc-100">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-1" role="tablist" aria-label="監控標籤">
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              draggable={renaming !== tab.id}
              onDragStart={() => (dragging.current = tab.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, tab.id)}
              className={`relative flex shrink-0 items-center rounded-lg ${tab.id === current?.id ? 'bg-[#2a3445] text-white' : 'text-zinc-400 hover:bg-white/5'}`}
            >
              {renaming === tab.id ? (
                <input
                  autoFocus
                  defaultValue={tab.name}
                  maxLength={60}
                  aria-label="標籤名稱"
                  onBlur={(e) => {
                    setRenaming(null);
                    const name = e.target.value.trim();
                    if (name && name !== tab.name) void mutate(() => videoApi.updateTab(tab.id, { name, expectedVersion: tab.version }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  className="h-8 w-36 rounded bg-[#1b1d23] px-2 text-sm outline-none"
                />
              ) : (
                <button type="button" role="tab" aria-selected={tab.id === current?.id} onClick={() => setTabId(tab.id)} onDoubleClick={() => canConfigure() && setRenaming(tab.id)} className="h-8 px-3 text-sm">
                  {tab.name}
                  <span className="ml-1.5 text-xs text-zinc-500">{tab.tileCount} 格</span>
                </button>
              )}
              <button type="button" aria-label={`${tab.name} 更多操作`} onClick={() => setMenu(menu === tab.id ? null : tab.id)} className="rounded p-1 text-zinc-500 hover:text-white">
                <MoreHorizontal className="size-3.5" />
              </button>
              {menu === tab.id ? (
                <div role="menu" className="absolute top-full left-0 z-30 mt-1 w-40 overflow-hidden rounded-lg border border-zinc-700 bg-[#141416] py-1 text-sm shadow-xl">
                  {[
                    ['改名', () => canConfigure() && setRenaming(tab.id)],
                    ['複製', () => canConfigure() && mutate(async () => setTabId((await videoApi.duplicateTab(tab.id)).id), '已複製標籤（共用相同來源，不複製錄影）')],
                    ['往左移', () => move(tab, -1), index === 0],
                    ['往右移', () => move(tab, 1), index === tabs.length - 1],
                    ['刪除', () => canConfigure() && setDeleting(tab)],
                  ].map(([label, fn, disabled]) => (
                    <button key={label as string} type="button" role="menuitem" disabled={Boolean(disabled)} onClick={() => { setMenu(null); (fn as () => void)(); }} className={`block w-full px-3 py-1.5 text-left hover:bg-white/5 disabled:opacity-40 ${label === '刪除' ? 'text-red-300' : ''}`}>
                      {label as string}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          <button type="button" onClick={() => void addTab()} aria-label="新增標籤" className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-white">
            <Plus className="size-4" />新增標籤
          </button>
        </div>
        <span className="shrink-0 text-xs text-zinc-500" aria-live="polite">{saving ? '儲存中…' : '設定已儲存'}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-400">每頁格數</span>
        {QUICK.map((n) => (
          <button key={n} type="button" onClick={() => void setTileCount(n)} aria-pressed={current?.tileCount === n} className={`rounded-lg px-3 py-1 text-sm ${current?.tileCount === n ? 'bg-blue-600 text-white' : 'border border-zinc-700 text-zinc-300 hover:bg-white/5'}`}>
            {n}
          </button>
        ))}
        <input
          value={customCount}
          inputMode="numeric"
          maxLength={2}
          aria-label="自訂格數（1–12）"
          placeholder="1–12"
          onChange={(e) => setCustomCount(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customCount) {
              void setTileCount(Number(customCount));
              setCustomCount('');
            }
          }}
          className="h-8 w-16 rounded-lg bg-[#222831] px-2 text-sm outline-none focus:ring-1 focus:ring-sky-500"
        />
        <div className="ml-auto flex items-center gap-2">
          {storage ? (
            <button type="button" onClick={() => setShowStorage(true)} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${storage.paused ? 'border-amber-500/40 text-amber-200' : 'border-zinc-700 text-zinc-300'} hover:bg-white/5`}>
              <HardDrive className="size-3.5" />
              {storage.paused ? `錄影暫停：${storage.paused.reason}` : `錄影用量 ${storage.usagePct}%（${formatBytes(storage.usedBytes)}）${storage.estimatedDays !== null ? `・可存約 ${storage.estimatedDays} 天` : ''}`}
            </button>
          ) : null}
          <button type="button" onClick={() => canConfigure() && setShowDefaults(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5">
            <SlidersHorizontal className="size-3.5" />全域來源預設
          </button>
        </div>
      </div>

      {error ? <ErrorLine text={`載入失敗：${error}`} /> : null}
      {!data && !error ? <p className="py-16 text-center text-zinc-500">載入中…</p> : null}
      {current ? (
        <div className={`grid min-h-0 flex-1 auto-rows-max gap-2 overflow-auto ${gridColumns(current.tileCount)}`}>
          {current.tiles.map((tile) => (
            <TileView
              key={tile.id}
              tile={tile}
              source={tile.sourceId ? sourceById.get(tile.sourceId) : undefined}
              active
              zoomed={zoomed === tile.id}
              audio={audioTile === tile.id}
              onZoom={() => setZoomed(zoomed === tile.id ? null : tile.id)}
              onAudio={() => setAudioTile(audioTile === tile.id ? undefined : tile.id)}
              onSettings={() => canConfigure() && setEditingTile(tile)}
            />
          ))}
        </div>
      ) : null}

      {editingTile && current && data ? (
        <TileSettingsDialog tab={current} tile={editingTile} sources={data.sources} onClose={() => setEditingTile(null)} onSaved={() => { setEditingTile(null); void load(); notify('已儲存格子設定', 'success'); }} />
      ) : null}
      {showDefaults && data ? <DefaultsDialog defaults={data.defaults} settings={data.settings} tabs={tabs} currentTab={current} onClose={() => setShowDefaults(false)} onChanged={() => void load()} /> : null}
      {showStorage && storage ? <StorageDialog status={storage} timeZone="Asia/Taipei" onClose={() => setShowStorage(false)} onChanged={(next) => { setData((d) => (d ? { ...d, storage: next } : d)); notify('已儲存錄影設定', 'success'); }} /> : null}
      {shrink ? (
        <Dialog title="減少格數" onClose={() => setShrink(null)} footer={<><GhostButton onClick={() => setShrink(null)}>取消</GhostButton><PrimaryButton onClick={() => { const s = shrink; setShrink(null); void mutate(() => videoApi.updateTab(s.tab.id, { tileCount: s.count, expectedVersion: s.tab.version, confirm: true })); }}>確認減少</PrimaryButton></>}>
          <p className="text-sm text-zinc-300">改成 {shrink.count} 格後，這些格子會從「{shrink.tab.name}」移除（不刪來源、不刪錄影）：</p>
          <ul className="mt-2 list-disc pl-5 text-sm text-zinc-200">{shrink.removed.map((r) => <li key={r.position}>第 {r.position + 1} 格{r.displayName ? `：${r.displayName}` : ''}</li>)}</ul>
          {shrink.stopping.length ? <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-100">這些來源沒有其他格子要求錄影，會停止新的錄影（已錄的保留到期）：{shrink.stopping.map((s) => s.name).join('、')}</p> : null}
        </Dialog>
      ) : null}
      {deleting ? (
        <Dialog title="刪除監控標籤" onClose={() => setDeleting(null)} footer={<><GhostButton onClick={() => setDeleting(null)}>取消</GhostButton><PrimaryButton danger onClick={() => { const t = deleting; setDeleting(null); void mutate(() => videoApi.deleteTab(t.id, t.version), '已刪除標籤'); }}>刪除</PrimaryButton></>}>
          <p className="text-sm text-zinc-300">確定刪除「{deleting.name}」？只移除這一頁的設定，不刪影像來源，也不刪已錄的影片；若某來源沒有其他格子要求錄影，會停止新的錄影。</p>
        </Dialog>
      ) : null}
      {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}

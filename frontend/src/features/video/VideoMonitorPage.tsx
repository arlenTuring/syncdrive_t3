import { HardDrive, LayoutDashboard, MoreHorizontal, Plus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useAuth } from '../access-control/AuthContext';
import { subscribeDatasourceInvalidation } from '../dashboard/utils/datasourceInvalidationBus';
import { Dialog, ErrorLine, GhostButton, PrimaryButton, Toast } from '../media-groups/dialogs';
import { videoApi, type Bootstrap, type Tab, type Tile } from './api';
import { openVideoResources } from './history-link';
import { CANVAS } from './layout';
import { LayoutEditorDialog } from './LayoutEditorDialog';
import { SourcePicker } from './SourcePicker';
import { TileView } from './TileView';

const PREF_KEY = 'vtms.video.monitor';

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

/**
 * 即時影像監控：使用者自訂的監控標籤頁（每頁 1–12 格、自由版面），格子綁定既有來源後播放。
 *
 * - 版面與綁定存在後端，所有有權帳號看到相同版面；目前所在標籤頁與開聲音的格子是個人偏好（只存在這台瀏覽器）。
 * - 平常監看時版面鎖定，要調整請按「編輯版面」；螢幕大小改變只等比例縮放整個畫布，不重排。
 * - 只有目前標籤頁的格子會播放；切換會釋放播放器。錄影是來源的設定，與這個頁面無關。
 * - 這裡不能建立攝影機連線或改錄影；來源在「影像資源管理」設定。
 */
export function VideoMonitorPage() {
  const auth = useAuth();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');
  const [tabId, setTabId] = useState<string | undefined>(() => readPref().tabId);
  const [audioTile, setAudioTile] = useState<string | undefined>(() => readPref().audio);
  const [rebinding, setRebinding] = useState<Tile | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ tab: Tab | null } | null>(null);
  const [deleting, setDeleting] = useState<Tab | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error'; id: number } | null>(null);
  const notify = useCallback((text: string, tone: 'success' | 'error') => setNotice((n) => ({ text, tone, id: (n?.id ?? 0) + 1 })), []);
  const dragging = useRef<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

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
  // 來源狀態與其他人修改的版面：重新取得
  useEffect(() => subscribeDatasourceInvalidation((payload) => {
    if (payload.tags.includes('table:video_sources')) void load();
  }), [load]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const update = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const tabs = useMemo(() => data?.tabs ?? [], [data]);
  const current = tabs.find((t) => t.id === tabId) ?? tabs[0] ?? null;
  const options = useMemo(() => data?.sources ?? [], [data]);
  const optionById = useMemo(() => new Map(options.map((s) => [s.id, s])), [options]);
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
  const canConfigure = auth.can('events.video.configure');
  const requireConfigure = () => auth.require('events.video.configure');

  const bind = (tile: Tile, sourceId: string | null) => {
    if (!current || !requireConfigure()) return;
    void mutate(() => videoApi.bindTile(current.id, tile.id, { expectedVersion: tile.version, sourceId }), sourceId ? undefined : '已清除這一格的來源');
  };

  const onDrop = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    const from = dragging.current;
    dragging.current = null;
    if (!from || from === targetId || !requireConfigure()) return;
    const ids = tabs.map((t) => t.id).filter((id) => id !== from);
    ids.splice(ids.indexOf(targetId), 0, from);
    void mutate(() => videoApi.reorderTabs(ids));
  };
  const move = (tab: Tab, delta: number) => {
    const ids = tabs.map((t) => t.id);
    const i = ids.indexOf(tab.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length || !requireConfigure()) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void mutate(() => videoApi.reorderTabs(ids));
  };

  // 畫布依保存的長寬比等比例 fit 到可用區；格子座標依畫布換算，不依影片大小
  const aspect = current?.canvasAspectRatio ?? 16 / 9;
  const minW = 640;
  const fitW = Math.max(minW, Math.min(stage.w, stage.h > 0 ? stage.h * aspect : stage.w));
  const fitH = fitW / aspect;
  const storage = data?.storage;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 text-zinc-100">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-1" role="tablist" aria-label="監控標籤頁">
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
                  aria-label="標籤頁名稱"
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
                <button type="button" role="tab" aria-selected={tab.id === current?.id} onClick={() => setTabId(tab.id)} onDoubleClick={() => requireConfigure() && setRenaming(tab.id)} className="h-8 px-3 text-sm">
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
                    ['編輯版面', () => requireConfigure() && setEditor({ tab })],
                    ['改名', () => requireConfigure() && setRenaming(tab.id)],
                    ['複製', () => requireConfigure() && mutate(async () => setTabId((await videoApi.duplicateTab(tab.id)).id), '已複製標籤頁（引用相同來源，不複製來源或錄影）')],
                    ['往左移', () => move(tab, -1), index === 0],
                    ['往右移', () => move(tab, 1), index === tabs.length - 1],
                    ['刪除', () => requireConfigure() && setDeleting(tab)],
                  ].map(([label, fn, disabled]) => (
                    <button key={label as string} type="button" role="menuitem" disabled={Boolean(disabled)} onClick={() => { setMenu(null); (fn as () => void)(); }} className={`block w-full px-3 py-1.5 text-left hover:bg-white/5 disabled:opacity-40 ${label === '刪除' ? 'text-red-300' : ''}`}>
                      {label as string}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          <button type="button" onClick={() => requireConfigure() && setEditor({ tab: null })} aria-label="新增監控標籤頁" className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-white">
            <Plus className="size-4" />新增標籤頁
          </button>
        </div>
        {current ? (
          <button type="button" onClick={() => requireConfigure() && setEditor({ tab: current })} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5">
            <LayoutDashboard className="size-3.5" />編輯版面
          </button>
        ) : null}
        {storage ? (
          <button
            type="button"
            onClick={() => openVideoResources()}
            title="錄影儲存設定在「影像資源管理」"
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${storage.paused ? 'border-amber-500/40 text-amber-200' : 'border-zinc-700 text-zinc-300'} hover:bg-white/5`}
          >
            <HardDrive className="size-3.5" />
            {storage.paused ? `錄影暫停：${storage.paused.reason}` : `錄影用量 ${storage.usagePct}%`}
          </button>
        ) : null}
        <span className="shrink-0 text-xs text-zinc-500" aria-live="polite">{saving ? '儲存中…' : ''}</span>
      </div>

      {error ? <ErrorLine text={`載入失敗：${error}`} /> : null}
      {!data && !error ? <p className="py-16 text-center text-zinc-500">載入中…</p> : null}
      {data && !current ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-400">
          <p>還沒有監控標籤頁</p>
          <PrimaryButton onClick={() => requireConfigure() && setEditor({ tab: null })}>新增標籤頁</PrimaryButton>
        </div>
      ) : null}
      {current ? (
        <div ref={stageRef} className="min-h-0 flex-1 overflow-auto">
          <div className="relative mx-auto" style={{ width: fitW, height: fitH }} aria-label={`${current.name} 監控畫面`}>
            {current.tiles.map((tile) => (
              <div
                key={tile.id}
                className="absolute p-1"
                style={{ left: `${(tile.x / CANVAS) * 100}%`, top: `${(tile.y / CANVAS) * 100}%`, width: `${(tile.w / CANVAS) * 100}%`, height: `${(tile.h / CANVAS) * 100}%` }}
              >
                <TileView
                  tile={tile}
                  source={tile.sourceId ? optionById.get(tile.sourceId) : undefined}
                  options={options}
                  active
                  audio={audioTile === tile.id}
                  canConfigure={canConfigure}
                  onAudio={() => setAudioTile(audioTile === tile.id ? undefined : tile.id)}
                  onBind={(sourceId) => bind(tile, sourceId)}
                  onSettings={() => requireConfigure() && setRebinding(tile)}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {rebinding && current ? (
        <RebindDialog
          tile={rebinding}
          options={options}
          onClose={() => setRebinding(null)}
          onPick={(sourceId) => {
            const tile = rebinding;
            setRebinding(null);
            bind(tile, sourceId);
          }}
        />
      ) : null}
      {editor ? (
        <LayoutEditorDialog
          tab={editor.tab}
          options={options}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            setEditor(null);
            setTabId(saved.id);
            void load();
            notify(editor.tab ? '已儲存版面' : '已新增標籤頁', 'success');
          }}
        />
      ) : null}
      {deleting ? (
        <Dialog title="刪除監控標籤頁" onClose={() => setDeleting(null)} footer={<><GhostButton onClick={() => setDeleting(null)}>取消</GhostButton><PrimaryButton danger onClick={() => { const t = deleting; setDeleting(null); void mutate(() => videoApi.deleteTab(t.id, t.version), '已刪除標籤頁'); }}>刪除</PrimaryButton></>}>
          <p className="text-sm text-zinc-300">確定刪除「{deleting.name}」？只移除這個版面，不刪影像來源，也不影響任何來源的錄影。</p>
        </Dialog>
      ) : null}
      {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}

/** 已綁定格子的設定：只能重新選來源或清除綁定；取消沒有任何副作用 */
function RebindDialog({ tile, options, onClose, onPick }: { tile: Tile; options: import('./api').SourceOption[]; onClose: () => void; onPick: (sourceId: string | null) => void }) {
  const [picked, setPicked] = useState<string | null>(tile.sourceId);
  const current = options.find((o) => o.id === tile.sourceId);
  return (
    <Dialog
      title={`第 ${tile.position + 1} 格的來源`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={() => onPick(null)} className="mr-auto text-sm text-zinc-400 hover:text-red-300">清除綁定</button>
          <GhostButton onClick={onClose}>取消</GhostButton>
          <PrimaryButton onClick={() => (picked && picked !== tile.sourceId ? onPick(picked) : onClose())} disabled={!picked}>套用</PrimaryButton>
        </>
      }
    >
      <p className="mb-2 text-xs text-zinc-400">目前：{current ? current.name : tile.sourceId ? '來源已刪除' : '未設定'}。換來源不改版面，也不影響任何來源的錄影；連線與錄影請到「影像資源管理」設定。</p>
      <SourcePicker options={options} value={picked} onPick={setPicked} className="w-full" />
    </Dialog>
  );
}

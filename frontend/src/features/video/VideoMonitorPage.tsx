import { Copy, HardDrive, LayoutGrid, Maximize, Minimize2, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { AnchoredPopover } from '../../lib/AnchoredPopover';
import { useAuth } from '../access-control/AuthContext';
import { subscribeDatasourceInvalidation } from '../dashboard/utils/datasourceInvalidationBus';
import { Dialog, ErrorLine, GhostButton, PrimaryButton, Toast } from '../media-groups/dialogs';
import { videoApi, type Bootstrap, type Tab, type Tile } from './api';
import { openVideoResources } from './history-link';
import { CANVAS } from './layout';
import { LayoutEditorDialog } from './LayoutEditorDialog';
import { SourceSelectDialog } from './SourceSelectDialog';
import { TileView } from './TileView';
import { Button, cn, fieldClass, IconButton, MENU_PANEL_CLASS, menuItemClass } from '../../components/ui';

const PREF_KEY = 'vtms.video.monitor';
/** 標籤頁整體全螢幕容器的標記（判斷目前的原生全螢幕是不是這一頁的） */
const ROOT_ATTR = 'data-video-monitor-root';

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
 * 即時影像監控：使用者自訂的監控分頁（每頁 1–12 個視窗、自由版面），視窗綁定既有來源後播放。
 * 畫面照設計稿 2026-11-20：底線分頁（名稱旁「⋯」：重新命名、複製、刪除）、右側「編輯版面」與全螢幕圖示、
 * 視窗是左上角編號的圓角卡片，選來源用「選擇影像來源」對話框。分頁順序用拖曳調整。
 *
 * - 版面與綁定存在後端，所有有權帳號看到相同版面；目前所在標籤頁與開聲音的格子是個人偏好（只存在這台瀏覽器）。
 * - 平常監看時版面鎖定，要調整請按「編輯版面」；螢幕大小改變只等比例縮放整個畫布，不重排。
 * - 只有目前標籤頁的格子會播放；切換會釋放播放器。錄影是來源的設定，與這個頁面無關。
 * - 這裡不能建立攝影機連線或改錄影；來源在「影像資源管理」設定。
 * - 標籤頁整體全螢幕：對包住標籤名稱與整個畫布的容器呼叫 requestFullscreen()；狀態以 document.fullscreenElement
 *   與 fullscreenchange 為準。進出只改容器樣式，不重建播放器、不寫回版面。不支援原生 API 時用同一容器「網頁滿版」。
 */
export function VideoMonitorPage() {
  const auth = useAuth();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');
  const [tabId, setTabId] = useState<string | undefined>(() => readPref().tabId);
  const [audioTile, setAudioTile] = useState<string | undefined>(() => readPref().audio);
  const [picking, setPicking] = useState<Tile | null>(null);
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
  /** 標籤頁整體全螢幕：native＝瀏覽器原生全螢幕；web＝不支援時的網頁滿版 */
  const [full, setFull] = useState<'native' | 'web' | null>(null);
  /** 整體全螢幕中暫時放大的格子（不寫回版面） */
  const [zoomTile, setZoomTile] = useState<string | null>(null);

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
  // 原生全螢幕狀態以瀏覽器為準（Esc、瀏覽器退出、其他程式退出都會反映）；離開這頁時只退出自己的全螢幕
  useEffect(() => {
    const ours = () => document.fullscreenElement?.getAttribute(ROOT_ATTR) === 'true';
    const onChange = () => {
      const native = ours();
      setFull((prev) => (native ? 'native' : prev === 'native' ? null : prev));
      if (!native) setZoomTile(null);
    };
    const onError = () => notify('無法進入全螢幕：瀏覽器拒絕了要求', 'error');
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('fullscreenerror', onError);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('fullscreenerror', onError);
      if (ours()) void document.exitFullscreen().catch(() => undefined);
    };
  }, [notify]);
  // 網頁滿版沒有瀏覽器的 Esc 處理：自己聽 Esc（原生全螢幕不攔截 Esc）
  useEffect(() => {
    if (full !== 'web') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setFull(null);
      setZoomTile(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);
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
    void mutate(() => videoApi.bindTile(current.id, tile.id, { expectedVersion: tile.version, sourceId }), sourceId ? undefined : '已清除這個視窗的來源');
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
  const enterFull = (tab: Tab) => {
    setMenu(null);
    setTabId(tab.id);
    setZoomTile(null);
    // 容器一直掛著（只切換樣式），所以先切標籤頁再對同一個容器要求全螢幕，仍在使用者手勢內
    const root = document.querySelector<HTMLElement>(`[${ROOT_ATTR}="true"]`);
    if (!root) return;
    if (document.fullscreenEnabled && typeof root.requestFullscreen === 'function') {
      root.requestFullscreen().catch((reason: Error) => notify(`無法進入全螢幕：${reason?.message || '瀏覽器拒絕了要求'}`, 'error'));
    } else {
      setFull('web');
    }
  };
  const exitFull = () => {
    setZoomTile(null);
    if (full === 'web') setFull(null);
    else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  };

  // 畫布依保存的長寬比換算高度；格子座標依畫布換算，不依影片大小。
  // 一般頁面：寬度鋪滿可用區（設計稿 2026-11-20），比可用區高就往下捲；全螢幕：整張畫布塞進螢幕（不捲動）。
  const aspect = current?.canvasAspectRatio ?? 16 / 9;
  const fitW = full ? Math.min(stage.w, stage.h > 0 ? stage.h * aspect : stage.w) : Math.max(640, stage.w);
  const fitH = fitW / aspect;
  const storage = data?.storage;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 text-text-primary">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-end gap-2 overflow-x-auto" role="tablist" aria-label="監控分頁">
          {tabs.map((tab) => {
            const active = tab.id === current?.id;
            return (
              <div
                key={tab.id}
                draggable={renaming !== tab.id}
                onDragStart={() => (dragging.current = tab.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, tab.id)}
                className={cn('relative flex shrink-0 items-center gap-1 px-3 py-2', active ? 'text-text-theme' : 'text-text-tertiary hover:text-text-primary')}
              >
                {renaming === tab.id ? (
                  <input
                    autoFocus
                    defaultValue={tab.name}
                    maxLength={60}
                    aria-label="分頁名稱"
                    onBlur={(e) => {
                      setRenaming(null);
                      const name = e.target.value.trim();
                      if (name && name !== tab.name) void mutate(() => videoApi.updateTab(tab.id, { name, expectedVersion: tab.version }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    className={cn(fieldClass({ size: 'sm', fullWidth: false }), 'w-36')}
                  />
                ) : (
                  <button type="button" role="tab" aria-selected={active} title={`${tab.tileCount} 個視窗`} onClick={() => setTabId(tab.id)} onDoubleClick={() => requireConfigure() && setRenaming(tab.id)} className={active ? 'text-body-m-bold' : 'text-body-m'}>
                    {tab.name}
                  </button>
                )}
                <TabMenu
                  name={tab.name}
                  open={menu === tab.id}
                  onToggle={(open) => setMenu(open ? tab.id : null)}
                  items={[
                    { label: '重新命名', icon: <Pencil />, run: () => requireConfigure() && setRenaming(tab.id) },
                    { label: '複製', icon: <Copy />, run: () => requireConfigure() && void mutate(async () => setTabId((await videoApi.duplicateTab(tab.id)).id), '已複製分頁（引用相同來源，不複製來源或錄影）') },
                    { label: '刪除', icon: <Trash2 />, run: () => requireConfigure() && setDeleting(tab), divided: true },
                  ]}
                />
                {active ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-border-theme" aria-hidden /> : null}
              </div>
            );
          })}
          <Button hierarchy="subordinate" variant="standard" aria-label="新增分頁" leadingIcon={<Plus />} onPress={() => requireConfigure() && setEditor({ tab: null })}>新增分頁</Button>
        </div>
        <span className="shrink-0 text-body-xs text-text-quaternary" aria-live="polite">{saving ? '儲存中…' : ''}</span>
        {storage?.paused ? (
          <Button hierarchy="danger" variant="outlined" onPress={() => openVideoResources()} title="錄影儲存設定在「影像來源管理」" leadingIcon={<HardDrive />}>
            錄影暫停：{storage.paused.reason}
          </Button>
        ) : null}
        {current ? (
          <Button hierarchy="subordinate" variant="outlined" leadingIcon={<LayoutGrid />} onPress={() => requireConfigure() && setEditor({ tab: current })}>編輯版面</Button>
        ) : null}
        {current ? (
          <IconButton hierarchy="subordinate" variant="standard" label="分頁全螢幕" icon={<Maximize />} onPress={() => enterFull(current)} />
        ) : null}
      </div>

      {error ? <ErrorLine text={`載入失敗：${error}`} /> : null}
      {!data && !error ? <p className="py-16 text-center text-text-quaternary">載入中…</p> : null}
      {data && !current ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-tertiary">
          <p>還沒有監控分頁</p>
          <PrimaryButton onClick={() => requireConfigure() && setEditor({ tab: null })}>新增分頁</PrimaryButton>
        </div>
      ) : null}
      {current ? (
        <div
          {...{ [ROOT_ATTR]: 'true' }}
          className={full ? `flex flex-col bg-surface-sub-background ${full === 'web' ? 'fixed inset-0 z-[200]' : 'h-full w-full'}` : 'flex min-h-0 flex-1 flex-col'}
        >
          {full ? (
            <div className="flex shrink-0 items-center gap-3 px-3 py-2 text-text-primary" title={full === 'web' ? '網頁滿版：瀏覽器不支援全螢幕，瀏覽器工具列仍會顯示' : undefined}>
              <span className="truncate text-body-l">{current.name}</span>
              {zoomTile ? (
                <Button hierarchy="subordinate" variant="outlined" onPress={() => setZoomTile(null)}>返回整頁</Button>
              ) : null}
              <Button hierarchy="subordinate" variant="tonal" className="ml-auto" leadingIcon={<Minimize2 />} onPress={exitFull}>離開全螢幕</Button>
            </div>
          ) : null}
          <div ref={stageRef} className={full ? 'flex min-h-0 flex-1 items-start justify-center overflow-hidden p-1' : '-mx-1.5 -mt-1.5 min-h-0 flex-1 overflow-y-auto overflow-x-hidden'}>
            <div className="relative mx-auto shrink-0" style={{ width: fitW, height: fitH }} aria-label={`${current.name} 監控畫面`}>
              {current.tiles.map((tile) => {
                const zoomed = zoomTile === tile.id;
                return (
                  <div
                    key={tile.id}
                    className={`absolute p-1.5 ${zoomTile && !zoomed ? 'invisible' : ''}`}
                    style={
                      zoomed
                        ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: 10 }
                        : { left: `${(tile.x / CANVAS) * 100}%`, top: `${(tile.y / CANVAS) * 100}%`, width: `${(tile.w / CANVAS) * 100}%`, height: `${(tile.h / CANVAS) * 100}%` }
                    }
                  >
                    <TileView
                      tile={tile}
                      source={tile.sourceId ? optionById.get(tile.sourceId) : undefined}
                      active
                      audio={audioTile === tile.id}
                      canConfigure={canConfigure}
                      onAudio={() => setAudioTile(audioTile === tile.id ? undefined : tile.id)}
                      onSettings={() => requireConfigure() && setPicking(tile)}
                      pageFullscreen={Boolean(full)}
                      zoomed={zoomed}
                      onZoom={() => setZoomTile(zoomed ? null : tile.id)}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* 對話框與通知放在全螢幕容器內，原生全螢幕時才看得到 */}
          {picking ? (
            <SourceSelectDialog
              options={options}
              value={picking.sourceId}
              onClose={() => setPicking(null)}
              onPick={(sourceId) => {
                const tile = picking;
                setPicking(null);
                bind(tile, sourceId);
              }}
              onClear={picking.sourceId ? () => {
                const tile = picking;
                setPicking(null);
                bind(tile, null);
              } : undefined}
            />
          ) : null}
          {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
        </div>
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
            notify(editor.tab ? '已儲存版面' : '已新增分頁', 'success');
          }}
        />
      ) : null}
      {deleting ? (
        <Dialog title="刪除監控分頁" onClose={() => setDeleting(null)} footer={<><GhostButton onClick={() => setDeleting(null)}>取消</GhostButton><PrimaryButton danger onClick={() => { const t = deleting; setDeleting(null); void mutate(() => videoApi.deleteTab(t.id, t.version), '已刪除分頁'); }}>刪除</PrimaryButton></>}>
          <p className="text-body-s text-text-secondary">確定刪除「{deleting.name}」？只移除這個版面，不刪影像來源，也不影響任何來源的錄影。</p>
        </Dialog>
      ) : null}
      {notice && !current ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}

/**
 * 分頁名稱旁的「⋯」選單：重新命名、複製、刪除（設計稿 2026-11-20）。
 * 按鈕跟著分頁文字顏色、不加底色，所以不用 IconButton（34×34 會撐高分頁列）；
 * 選單用浮層，分頁列是橫向捲動區，放在裡面會被裁掉。
 */
function TabMenu({
  name,
  open,
  onToggle,
  items,
}: {
  name: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  items: Array<{ label: string; icon: ReactNode; run: () => unknown; divided?: boolean }>;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={`${name} 更多操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onToggle(!open)}
        className="flex size-6 items-center justify-center rounded hover:bg-link-standard"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      <AnchoredPopover open={open} anchorRef={anchorRef} onClose={() => onToggle(false)} role="menu" ariaLabel={`${name} 操作`} align="start" className={cn(MENU_PANEL_CLASS, 'w-40')}>
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            onClick={() => {
              onToggle(false);
              item.run();
            }}
            className={cn(menuItemClass(), item.divided && 'border-t border-border-quaternary', '[&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-text-tertiary')}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </AnchoredPopover>
    </>
  );
}

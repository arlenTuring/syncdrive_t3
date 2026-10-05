import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardPlane, CanvasElementProps, ChildWidget, WidgetType, CanvasKind } from './types';
import { createWidget } from './types';
import { validatePlane, validateGroupTemplate, type LayoutIssue } from './utils/collision';
import {
  useDashboardHistory,
  type DashboardEditorSnapshot,
} from './hooks/useDashboardHistory';

import {
  DASHBOARD_PLANES_STORAGE_KEY as STORAGE_KEY,
} from '../../lib/canvasCacheReset';
import { createBlankVehicleForContainer } from '../vehicle-editor/storage/vehicleDefinitionStorage';
import { canAddWidgetToCanvas } from './utils/widgetPlacementRules';
import { DASHBOARD_PLANES_TAG, fetchDashboardPlanes, saveDashboardPlane, saveDashboardPlanes } from './api/dashboardPlanesApi';
import { cloneDemoPlane } from './constants/demoPlane';
import {
  applyWidgetFormat,
  canApplyWidgetFormat,
  extractWidgetFormat,
  type WidgetFormatSnapshot,
} from './utils/widgetFormatPainter';
import {
  getDefaultChildren,
  patchGroupChildrenByLane,
  type DualCanvasLane,
} from './utils/dualCanvas';
import { migratePlane } from './utils/migrateDashboardPlane';
import { subscribeDatasourceInvalidation } from './utils/datasourceInvalidationBus';

/** 後端版面存檔後推送的失效標籤（見 backend dashboard-plane.service.ts） */

const DEMO_LAYOUT_VERSION = 114;

function freshDemoPlane(): DashboardPlane {
  return { ...cloneDemoPlane(), demoLayoutVersion: DEMO_LAYOUT_VERSION } as DashboardPlane;
}























function getInitialPlanes(): DashboardPlane[] {
  return loadPlanes();
}

/**
 * 從快取讀版面。
 *
 * 這裡曾經先呼叫 ensureLayoutSeed()——那支程式在「種子字串」變動時會
 * localStorage.removeItem(STORAGE_KEY)，直接把使用者存好的版面刪掉重種。
 * 已移除：改個常數就清掉別人的資料，不是遷移，是破壞。
 *
 * 快取只是第一幀用的，掛載後會立刻跟資料庫要最新的覆蓋掉。
 */
function loadPlanes(): DashboardPlane[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [migratePlane(freshDemoPlane())];
    const planes: DashboardPlane[] = JSON.parse(raw);
    if (planes.length === 0) return [migratePlane(freshDemoPlane())];
    return planes.map(migratePlane);
  } catch {
    return [migratePlane(freshDemoPlane())];
  }
}

/**
 * <strong>後端是真相，localStorage 只是離線快取。</strong>
 *
 * 版面原本只存在瀏覽器（<code>syncdrive_dashboard_planes</code>）：換一台電腦或清一次
 * 快取就沒了，也沒有任何伺服器端版本紀錄。營運全景圖台是規範要求的核心功能，版面
 * 屬於系統資產，TP13C §1.4 已把它列入介面資源類。
 *
 * 快取沒有拿掉，因為圖台編輯器是重度互動介面（拖曳、縮放每秒數十次），每一次都打
 * 後端不切實際；後端連不上時畫面也必須能開。所以寫入是「先寫快取、再送後端」，
 * 後端失敗<strong>不擋畫面</strong>——編輯已經在快取裡，下一次成功儲存會整批補上
 * （整批覆寫語意，不會只補一半）。
 */
/**
 * <strong>後端寫入要節流，本機快取不節流。</strong>
 *
 * savePlanes 有十九個呼叫點，而且拖曳與縮放是<strong>每個事件</strong>呼叫一次——
 * 不節流的話拖一下就會送出數十個 PUT，每個都夾帶整份版面 JSON。
 *
 * 本機快取維持立即寫入：它是離線保命用的，晚寫一秒就多一秒可能掉東西的視窗。
 * 後端則延後到「停手之後」再送一次——整批覆寫語意讓最後那一次自然涵蓋前面所有
 * 中間狀態，不必逐次上傳。
 */
const BACKEND_SAVE_DEBOUNCE_MS = 800;
let backendSaveTimer: ReturnType<typeof setTimeout> | undefined;
/** 還沒送到後端的那一份。離開頁面前要把它補送掉。 */
let pendingPlanes: DashboardPlane[] | null = null;

/**
 * 把還沒送出的版面立刻送到後端。
 *
 * 節流是為了拖曳縮放（每個事件都會呼叫 savePlanes），但<strong>使用者離開頁面時
 * 不能還在等</strong>：關分頁、重整、或 800 毫秒內跳頁，那個 PUT 就永遠不會送，
 * 資料庫裡沒有這一次的修改。原本註解寫「下一次儲存會整批補上」——那是僥倖，
 * 使用者不再編輯就永遠補不上，而他明明按過儲存。
 */
export function flushDashboardPlanes(): void {
  if (backendSaveTimer) {
    clearTimeout(backendSaveTimer);
    backendSaveTimer = undefined;
  }
  const planes = pendingPlanes;
  if (!planes) return;
  pendingPlanes = null;
  void saveDashboardPlanes(planes).catch(() => {
    /* 送不出去就留在快取，下次進來會比對時間 */
  });
}

if (typeof window !== 'undefined') {
  // pagehide 比 beforeunload 可靠：手機與 bfcache 情境下 beforeunload 不一定會觸發
  window.addEventListener('pagehide', flushDashboardPlanes);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDashboardPlanes();
  });
}

function savePlanes(planes: DashboardPlane[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(planes));
  } catch (err) {
    console.error('Failed to save dashboard planes to localStorage:', err);
  }
  pendingPlanes = planes;
  if (backendSaveTimer) clearTimeout(backendSaveTimer);
  backendSaveTimer = setTimeout(() => {
    backendSaveTimer = undefined;
    const snapshot = pendingPlanes;
    pendingPlanes = null;
    if (!snapshot) return;
    void saveDashboardPlanes(snapshot).catch(() => {
      /* 送不出去就留在快取，下次進來會比對時間 */
    });
  }, BACKEND_SAVE_DEBOUNCE_MS);
}

export function useDashboardEditor() {
  const [planes, setPlanes] = useState<DashboardPlane[]>(() => getInitialPlanes());
  const [activePlaneId, setActivePlaneId] = useState<string | null>(() => getInitialPlanes()[0]?.id ?? null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  /** 加一就重新跟資料庫要一次版面 */
  const [reloadNonce, setReloadNonce] = useState(0);

  /**
   * 開啟時用後端內容覆蓋快取。
   *
   * 後端空的（第一次跑、或還沒有人存過）就不覆蓋——那代表尚未遷移，直接沿用本機
   * 既有版面，下一次存檔會把它整批送上去，等於一次自動遷移。後端不可用時同樣
   * 沿用快取，畫面照常運作。
   */
  useEffect(() => {
    let cancelled = false;
    void fetchDashboardPlanes()
      .then((remote) => {
        if (cancelled) return;
        /**
         * 伺服器是空的＝這台機器還沒遷移過，<strong>主動把本機那份推上去</strong>。
         *
         * 原本只寫「下一次儲存會整批送上去」，但那是被動的——使用者不去編輯儀表板
         * 就永遠不會觸發。實測（2026-08-24）就卡在這裡：模組頁面對應因為使用者剛好
         * 編輯過而存進資料庫了，版面卻還是 0 筆，於是那筆對應指向的 demo-plane 在
         * 伺服器上根本不存在——換一台電腦開就會指到不存在的版面。
         *
         * 只在<strong>伺服器確實是空的</strong>時候推，永遠不拿本機的舊快取覆蓋
         * 伺服器上已有的內容。
         */
        if (remote.length === 0) {
          const local = loadPlanes();
          if (local.length > 0) {
            void saveDashboardPlanes(local).catch(() => {
              /* 後端暫時不可用：下一次儲存仍會補上 */
            });
          }
          return;
        }
        const migrated = remote.map(migratePlane);
        /*
         * 內建來源的修正要成為共用版本：有變動的那幾張<strong>逐張</strong>存回去。
         * 不用整批覆寫——整批的語意是「送出的清單就是全部」，這時候別人剛新增的版面
         * 會被刪掉。單張存檔帶讀到的版本，期間有人存過就不覆蓋（下次載入再升級）。
         */
        remote.forEach((original, index) => {
          const upgraded = migrated[index];
          if (JSON.stringify(original.elements) === JSON.stringify(upgraded.elements)) return;
          void saveDashboardPlane(upgraded)
            .then((saved) => {
              if (cancelled) return;
              setPlanes((current) => current.map((plane) => (
                plane.id === saved.id ? { ...plane, serverVersion: saved.serverVersion } : plane
              )));
            })
            .catch((err: unknown) => {
              console.warn('[dashboard] 版面升級沒有存回伺服器：', err);
            });
        });
        setPlanes(migrated);
        setActivePlaneId((current) =>
          current && migrated.some((plane) => plane.id === current)
            ? current
            : (migrated[0]?.id ?? null),
        );
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        } catch {
          /* ignore quota */
        }
      })
      .catch(() => {
        /* 後端不可用：沿用快取 */
      });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  /**
   * 回到這一頁就重新跟資料庫要。
   *
   * 掛載時抓一次是不夠的：SPA 裡跳去別的模組再回來，元件不一定重新掛載，
   * 看到的就是離開前那份。使用者在別的地方改了地圖、或用另一台電腦改過，
   * 這裡永遠不知道。
   *
   * <strong>有還沒送出的修改就不重抓</strong>：那代表使用者正在編輯，
   * 這時候拿資料庫覆蓋等於吃掉他手上的工作。等 flush 送出去之後再說。
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (pendingPlanes) return;
      setReloadNonce((n) => n + 1);
    };
    window.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    // 別的頁面（其他帳號、其他瀏覽器、升級程序）存了版面：沒有未送出的修改就重新讀取
    const unsubscribe = subscribeDatasourceInvalidation((payload) => {
      if (!payload.tags.includes(DASHBOARD_PLANES_TAG)) return;
      if (pendingPlanes) return;
      setReloadNonce((n) => n + 1);
    });
    return () => {
      window.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      unsubscribe();
    };
  }, []);
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);

  const planesRef = useRef(planes);
  const activePlaneIdRef = useRef(activePlaneId);
  const selectedElementIdRef = useRef(selectedElementId);
  const selectedElementIdsRef = useRef(selectedElementIds);
  const selectedChildIdRef = useRef(selectedChildId);
  const selectedChildIdsRef = useRef(selectedChildIds);
  planesRef.current = planes;
  activePlaneIdRef.current = activePlaneId;
  selectedElementIdRef.current = selectedElementId;
  selectedElementIdsRef.current = selectedElementIds;
  selectedChildIdRef.current = selectedChildId;
  selectedChildIdsRef.current = selectedChildIds;

  const applyingHistoryRef = useRef(false);

  const getSnapshot = useCallback((): DashboardEditorSnapshot => ({
    planes: structuredClone(planesRef.current),
    activePlaneId: activePlaneIdRef.current,
    selectedElementId: selectedElementIdRef.current,
    selectedElementIds: [...selectedElementIdsRef.current],
    selectedChildId: selectedChildIdRef.current,
    selectedChildIds: [...selectedChildIdsRef.current],
  }), []);

  const applySnapshot = useCallback((snap: DashboardEditorSnapshot) => {
    applyingHistoryRef.current = true;
    setPlanes(snap.planes);
    setActivePlaneId(snap.activePlaneId);
    setSelectedElementId(snap.selectedElementId);
    setSelectedElementIds(snap.selectedElementIds ?? (snap.selectedElementId ? [snap.selectedElementId] : []));
    setSelectedChildId(snap.selectedChildId);
    setSelectedChildIds(snap.selectedChildIds ?? (snap.selectedChildId ? [snap.selectedChildId] : []));
    savePlanes(snap.planes);
    queueMicrotask(() => {
      applyingHistoryRef.current = false;
    });
  }, []);

  const {
    pushHistory,
    undo,
    redo,
    resetHistory,
    canUndo,
    canRedo,
  } = useDashboardHistory({ getSnapshot, applySnapshot });

  const recordHistory = useCallback(() => {
    if (applyingHistoryRef.current) return;
    pushHistory();
  }, [pushHistory]);

  // ─── 剪貼簿（記憶體內） ────────────────────────────────────────
  type ClipboardEntry =
    | { kind: 'canvas'; data: CanvasElementProps }
    | { kind: 'widget'; data: ChildWidget; parentCanvasId: string };
  const [clipboard, setClipboard] = useState<ClipboardEntry | null>(null);
  const [formatPainter, setFormatPainter] = useState<WidgetFormatSnapshot | null>(null);

  const activePlane = planes.find(p => p.id === activePlaneId) ?? null;
  const selectedElement = activePlane?.elements.find(e => e.id === selectedElementId) ?? null;
  const selectedChild = selectedElement?.children.find(c => c.id === selectedChildId) ?? null;

  // ─── 選取邏輯 ─────────────────────────────────────────────────────

  const selectElement = useCallback((canvasId: string | null, opts?: { additive?: boolean }) => {
    if (!canvasId) {
      setSelectedElementId(null);
      setSelectedElementIds([]);
      setSelectedChildId(null);
      setSelectedChildIds([]);
      return;
    }
    if (opts?.additive) {
      setSelectedChildId(null);
      setSelectedChildIds([]);
      setSelectedElementIds(prev => {
        const has = prev.includes(canvasId);
        const next = has ? prev.filter(id => id !== canvasId) : [...prev, canvasId];
        setSelectedElementId(next[next.length - 1] ?? null);
        return next;
      });
      return;
    }
    setSelectedElementId(canvasId);
    setSelectedElementIds([canvasId]);
    setSelectedChildId(null);
    setSelectedChildIds([]);
  }, []);

  const selectElements = useCallback((ids: string[], opts?: { additive?: boolean }) => {
    setSelectedChildId(null);
    setSelectedChildIds([]);
    if (opts?.additive) {
      setSelectedElementIds(prev => {
        const next = [...new Set([...prev, ...ids])];
        setSelectedElementId(next[next.length - 1] ?? null);
        return next;
      });
    } else {
      setSelectedElementIds(ids);
      setSelectedElementId(ids[ids.length - 1] ?? null);
    }
  }, []);

  const selectChild = useCallback((canvasId: string, childId: string, opts?: { additive?: boolean }) => {
    setSelectedElementId(canvasId);
    setSelectedElementIds([canvasId]);
    if (opts?.additive) {
      setSelectedChildIds(prev => {
        const has = prev.includes(childId);
        const next = has ? prev.filter(id => id !== childId) : [...prev, childId];
        setSelectedChildId(next.length === 1 ? next[0] : null);
        return next;
      });
      return;
    }
    setSelectedChildIds([childId]);
    setSelectedChildId(childId);
  }, []);

  const selectChildren = useCallback((canvasId: string, childIds: string[], opts?: { additive?: boolean }) => {
    setSelectedElementId(canvasId);
    setSelectedElementIds([canvasId]);
    if (opts?.additive) {
      setSelectedChildIds(prev => {
        const next = [...new Set([...prev, ...childIds])];
        setSelectedChildId(next.length === 1 ? next[0] : null);
        return next;
      });
    } else {
      setSelectedChildIds(childIds);
      setSelectedChildId(childIds.length === 1 ? childIds[0] : null);
    }
  }, []);

  // ─── Plane CRUD ────────────────────────────────────────────────────

  const createPlane = useCallback((name: string, width: number, height: number) => {
    recordHistory();
    const newPlane: DashboardPlane = {
      id: `plane-${Date.now()}`, name, width, height, elements: [],
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    setPlanes(prev => { const next = [...prev, newPlane]; savePlanes(next); return next; });
    setActivePlaneId(newPlane.id);
    setSelectedElementId(null);
    setSelectedElementIds([]);
    setSelectedChildId(null);
    setSelectedChildIds([]);
    return newPlane;
  }, [recordHistory]);

  const updatePlane = useCallback((id: string, patch: Partial<Pick<DashboardPlane, 'name' | 'width' | 'height' | 'viewportMode' | 'dataSettings'>>) => {
    setPlanes(prev => {
      const next = prev.map(p => p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p);
      savePlanes(next); return next;
    });
  }, []);

  const deletePlane = useCallback((id: string) => {
    recordHistory();
    setPlanes(prev => { const next = prev.filter(p => p.id !== id); savePlanes(next); return next; });
    setActivePlaneId(prev => prev === id ? null : prev);
  }, [recordHistory]);

  const importPlane = useCallback((plane: DashboardPlane) => {
    recordHistory();
    setPlanes(prev => {
      const next = [...prev, plane];
      savePlanes(next);
      return next;
    });
    setActivePlaneId(plane.id);
    setSelectedElementId(null);
    setSelectedElementIds([]);
    setSelectedChildId(null);
    setSelectedChildIds([]);
    return plane;
  }, [recordHistory]);

  // ─── Canvas Element CRUD ───────────────────────────────────────────

  const addCanvasElement = useCallback((
    isGroup: boolean = false,
    dropX?: number,
    dropY?: number,
    canvasKind: CanvasKind = 'standard',
    initialWidgetType?: WidgetType,
  ) => {
    if (!activePlaneId) return;
    recordHistory();
    const x = dropX ?? 40;
    const y = dropY ?? 40;
    const isMap = canvasKind === 'map-platform';
    const isTabList = initialWidgetType === 'tab-list' || initialWidgetType === 'shift-list';

    const defaultW = isMap ? 1200 : isTabList ? 1000 : isGroup ? 500 : 400;
    const defaultH = isMap ? 680 : isTabList ? 460 : isGroup ? 320 : 250;

    let initialChildren: ChildWidget[] = [];
    if (initialWidgetType) {
      const w = createWidget(initialWidgetType, 0, 0);
      w.width = defaultW;
      w.height = defaultH;
      initialChildren = [w];
    }

    const el: CanvasElementProps = {
      id: `canvas-${Date.now()}`, type: 'canvas', x, y,
      width: defaultW,
      height: defaultH,
      label: isMap ? '圖台' : isTabList ? 'Tab 清單表格' : isGroup ? '新畫布群組' : '新畫布',
      backgroundColor: isMap ? '#020617' : isTabList ? 'transparent' : '#0f172a',
      backgroundImage: '',
      opacity: 100,
      children: initialChildren,
      canvasKind: isMap ? 'map-platform' : 'standard',
      mapId: isMap ? 't3-main-version' : '',
      zoomFactor: isMap ? 1.35 : undefined,
      isGroup: isMap ? false : isGroup,
      ...(isGroup ? {
        templateWidth: 300,
        templateHeight: 180,
        groupTileFit: 'fill' as const,
        layoutMode: 'grid' as const,
        gridColumns: 1,
        gapX: 12,
        gapY: 12,
      } : {}),
    };
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? { ...p, elements: [...p.elements, el], updatedAt: Date.now() } : p);
      savePlanes(next); return next;
    });
    selectElement(el.id);
    if (initialChildren.length > 0) {
      selectChild(el.id, initialChildren[0].id);
    }
  }, [activePlaneId, selectElement, selectChild, recordHistory]);

  const updateElement = useCallback((elementId: string, patch: Partial<CanvasElementProps>) => {
    if (!activePlaneId) return;
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? { ...p, elements: p.elements.map(el => el.id === elementId ? { ...el, ...patch } : el), updatedAt: Date.now() }
        : p);
      savePlanes(next); return next;
    });
  }, [activePlaneId]);

  const updateElementsBatch = useCallback((
    updates: Array<{ elementId: string; patch: Partial<CanvasElementProps> }>,
  ) => {
    if (!activePlaneId || updates.length === 0) return;
    const patchMap = new Map(updates.map(u => [u.elementId, u.patch]));
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? {
            ...p,
            elements: p.elements.map(el => {
              const patch = patchMap.get(el.id);
              return patch ? { ...el, ...patch } : el;
            }),
            updatedAt: Date.now(),
          }
        : p);
      savePlanes(next); return next;
    });
  }, [activePlaneId]);

  const deleteElement = useCallback((elementId: string) => {
    if (!activePlaneId) return;
    recordHistory();
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? { ...p, elements: p.elements.filter(el => el.id !== elementId), updatedAt: Date.now() } : p);
      savePlanes(next); return next;
    });
    selectElement(null);
  }, [activePlaneId, selectElement, recordHistory]);

  const deleteElementsBatch = useCallback((elementIds: string[]) => {
    if (!activePlaneId || elementIds.length === 0) return;
    recordHistory();
    const idSet = new Set(elementIds);
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? { ...p, elements: p.elements.filter(el => !idSet.has(el.id)), updatedAt: Date.now() }
        : p);
      savePlanes(next); return next;
    });
    selectElement(null);
  }, [activePlaneId, selectElement, recordHistory]);

  // ─── Child Widget CRUD ─────────────────────────────────────────────

  const addChildWidget = useCallback((
    canvasId: string,
    widgetType: WidgetType,
    x: number,
    y: number,
    lane?: DualCanvasLane | null,
  ): string | undefined => {
    if (!activePlaneId) return undefined;
    const plane = planesRef.current.find((p) => p.id === activePlaneId);
    const canvas = plane?.elements.find((el) => el.id === canvasId);
    if (!canAddWidgetToCanvas(canvas, widgetType)) return undefined;
    recordHistory();
    let widget = createWidget(widgetType, x, y);
    if (widgetType === 'vehicle-container') {
      const vehicleDefinitionId = createBlankVehicleForContainer();
      widget = { ...widget, vehicleDefinitionId } as ChildWidget;
    }
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? {
            ...p,
            elements: p.elements.map(el => {
              if (el.id !== canvasId) return el;
              if (el.dualCanvasEnabled && lane) {
                return patchGroupChildrenByLane(el, lane, ch => [...ch, widget]);
              }
              return { ...el, children: [...(el.children ?? []), widget] };
            }),
            updatedAt: Date.now(),
          }
        : p);
      savePlanes(next); return next;
    });
    selectChild(canvasId, widget.id);
    return widget.id;
  }, [activePlaneId, selectChild, recordHistory]);

  const updateChildWidget = useCallback((
    canvasId: string,
    childId: string,
    patch: Partial<ChildWidget>,
    lane?: DualCanvasLane | null,
  ) => {
    if (!activePlaneId) return;
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? {
            ...p,
            elements: p.elements.map(el => {
              if (el.id !== canvasId) return el;
              if (el.dualCanvasEnabled && lane) {
                return patchGroupChildrenByLane(el, lane, ch =>
                  ch.map(c => (c.id === childId ? { ...c, ...patch } as ChildWidget : c)),
                );
              }
              return {
                ...el,
                children: (el.children ?? []).map(c =>
                  c.id === childId ? { ...c, ...patch } as ChildWidget : c,
                ),
              };
            }),
            updatedAt: Date.now(),
          }
        : p);
      savePlanes(next); return next;
    });
  }, [activePlaneId]);

  const updateChildrenBatch = useCallback((
    canvasId: string,
    updates: Array<{ childId: string; patch: Partial<ChildWidget> }>,
    lane?: DualCanvasLane | null,
  ) => {
    if (!activePlaneId || updates.length === 0) return;
    const patchMap = new Map(updates.map(u => [u.childId, u.patch]));
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? {
            ...p,
            elements: p.elements.map(el => {
              if (el.id !== canvasId) return el;
              const apply = (ch: ChildWidget[]) =>
                ch.map(c => {
                  const patch = patchMap.get(c.id);
                  return patch ? { ...c, ...patch } as ChildWidget : c;
                });
              if (el.dualCanvasEnabled && lane) {
                return patchGroupChildrenByLane(el, lane, apply);
              }
              return { ...el, children: apply(el.children ?? []) };
            }),
            updatedAt: Date.now(),
          }
        : p);
      savePlanes(next); return next;
    });
  }, [activePlaneId]);

  const deleteChildWidget = useCallback((
    canvasId: string,
    childId: string,
    lane?: DualCanvasLane | null,
  ) => {
    if (!activePlaneId) return;
    recordHistory();
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? {
            ...p,
            elements: p.elements.map(el => {
              if (el.id !== canvasId) return el;
              if (el.dualCanvasEnabled && lane) {
                return patchGroupChildrenByLane(el, lane, ch => ch.filter(c => c.id !== childId));
              }
              return { ...el, children: (el.children ?? []).filter(c => c.id !== childId) };
            }),
            updatedAt: Date.now(),
          }
        : p);
      savePlanes(next); return next;
    });
    selectElement(canvasId);
  }, [activePlaneId, selectElement, recordHistory]);

  const deleteChildrenBatch = useCallback((
    canvasId: string,
    childIds: string[],
    lane?: DualCanvasLane | null,
  ) => {
    if (!activePlaneId || childIds.length === 0) return;
    recordHistory();
    const idSet = new Set(childIds);
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? {
            ...p,
            elements: p.elements.map(el => {
              if (el.id !== canvasId) return el;
              const filter = (ch: ChildWidget[]) => ch.filter(c => !idSet.has(c.id));
              if (el.dualCanvasEnabled && lane) {
                return patchGroupChildrenByLane(el, lane, filter);
              }
              return { ...el, children: filter(el.children ?? []) };
            }),
            updatedAt: Date.now(),
          }
        : p);
      savePlanes(next); return next;
    });
    selectElement(canvasId);
  }, [activePlaneId, selectElement, recordHistory]);

  // ─── 複製 / 貼上 ───────────────────────────────────────────────

  const copySelected = useCallback((
    childOverride?: ChildWidget | null,
    parentCanvasIdOverride?: string | null,
  ) => {
    const child = childOverride ?? selectedChild;
    const parent = parentCanvasIdOverride ?? selectedElement?.id;
    if (child && parent) {
      setClipboard({ kind: 'widget', data: { ...child }, parentCanvasId: parent });
    } else if (selectedElement) {
      const el = selectedElement;
      setClipboard({
        kind: 'canvas',
        data: {
          ...el,
          children: [...(el.children ?? [])],
          childrenNormal: el.childrenNormal ? [...el.childrenNormal] : undefined,
          childrenDefault: el.childrenDefault ? [...el.childrenDefault] : undefined,
        },
      });
    }
  }, [selectedChild, selectedElement]);

  const armFormatPainter = useCallback((widget: ChildWidget) => {
    setFormatPainter(extractWidgetFormat(widget));
  }, []);

  const cancelFormatPainter = useCallback(() => {
    setFormatPainter(null);
  }, []);

  const applyFormatToChild = useCallback(
    (canvasId: string, child: ChildWidget, snapshot: WidgetFormatSnapshot): boolean => {
      if (!activePlaneId) return false;
      if (!canApplyWidgetFormat(snapshot, child)) return false;
      const next = applyWidgetFormat(child, snapshot);
      if (!next) return false;
      recordHistory();
      setPlanes(prev => {
        const nextPlanes = prev.map(p =>
          p.id === activePlaneId
            ? {
                ...p,
                elements: p.elements.map(el => {
                  if (el.id !== canvasId) return el;
                  if (el.dualCanvasEnabled) {
                    const lane = getDefaultChildren(el).some(c => c.id === child.id)
                      ? 'default'
                      : 'normal';
                    return patchGroupChildrenByLane(el, lane, ch =>
                      ch.map(c => (c.id === child.id ? next : c)),
                    );
                  }
                  return {
                    ...el,
                    children: (el.children ?? []).map(c => (c.id === child.id ? next : c)),
                  };
                }),
                updatedAt: Date.now(),
              }
            : p,
        );
        savePlanes(nextPlanes);
        return nextPlanes;
      });
      return true;
    },
    [activePlaneId, recordHistory],
  );

  const applyFormatPainter = useCallback(
    (canvasId: string, child: ChildWidget): boolean => {
      if (!formatPainter) return false;
      const ok = applyFormatToChild(canvasId, child, formatPainter);
      if (ok) {
        setFormatPainter(null);
        selectChild(canvasId, child.id);
      }
      return ok;
    },
    [formatPainter, applyFormatToChild, selectChild],
  );

  const pasteClipboard = useCallback((lane?: DualCanvasLane | null) => {
    if (!activePlaneId || !clipboard || !activePlane) return null;
    recordHistory();
    const offset = 20;

    if (clipboard.kind === 'canvas') {
      const src = clipboard.data;
      const remap = (list: ChildWidget[]) =>
        list.map(c => ({ ...c, id: `${c.type}-${Date.now()}-${Math.random().toString(36).slice(2)}` }));
      const newEl: CanvasElementProps = {
        ...src,
        id: `canvas-${Date.now()}`,
        x: src.x + offset,
        y: src.y + offset,
        children: remap(src.children ?? []),
        childrenNormal: src.childrenNormal ? remap(src.childrenNormal) : undefined,
        childrenDefault: src.childrenDefault ? remap(src.childrenDefault) : undefined,
      };

      setPlanes(prev => {
        const next = prev.map(p => p.id === activePlaneId ? { ...p, elements: [...p.elements, newEl], updatedAt: Date.now() } : p);
        savePlanes(next); return next;
      });
      selectElement(newEl.id);
    } else {
      const canvasId = clipboard.parentCanvasId;
      const newWidget: ChildWidget = {
        ...clipboard.data,
        id: `${clipboard.data.type}-${Date.now()}`,
        x: clipboard.data.x + offset,
        y: clipboard.data.y + offset,
      };

      setPlanes(prev => {
        const next = prev.map(p => p.id === activePlaneId
          ? {
              ...p,
              elements: p.elements.map(el => {
                if (el.id !== canvasId) return el;
                if (el.dualCanvasEnabled && lane) {
                  return patchGroupChildrenByLane(el, lane, ch => [...ch, newWidget]);
                }
                return { ...el, children: [...(el.children ?? []), newWidget] };
              }),
              updatedAt: Date.now(),
            }
          : p);
        savePlanes(next); return next;
      });
      selectChild(canvasId, newWidget.id);
    }
    return null;
  }, [activePlaneId, clipboard, activePlane, selectElement, selectChild, recordHistory]);

  const validateActivePlane = useCallback((): { valid: boolean; error?: string; issues: LayoutIssue[] } => {
    if (!activePlane) return { valid: true, issues: [] };
    return validatePlane(activePlane);
  }, [activePlane]);

  const validateGroupTemplateById = useCallback(
    (groupId: string): { valid: boolean; error?: string; issues: LayoutIssue[] } => {
      const group = activePlane?.elements.find(e => e.id === groupId);
      if (!group?.isGroup) return { valid: true, issues: [] };
      return validateGroupTemplate(group);
    },
    [activePlane],
  );

  return {
    planes, activePlane, activePlaneId, setActivePlaneId,
    selectedElementId, selectedElement, selectedElementIds,
    selectedChildId, selectedChild, selectedChildIds,
    selectElement, selectElements, selectChild, selectChildren,
    createPlane, updatePlane, deletePlane, importPlane,
    addCanvasElement, updateElement, updateElementsBatch, deleteElement, deleteElementsBatch,
    addChildWidget, updateChildWidget, updateChildrenBatch,
    deleteChildWidget, deleteChildrenBatch,
    clipboard, copySelected, pasteClipboard,
    formatPainter,
    armFormatPainter, cancelFormatPainter, applyFormatPainter,
    validateActivePlane, validateGroupTemplateById,
    recordHistory, undo, redo, resetHistory, canUndo, canRedo,
    clearAllData: () => {
      recordHistory();
      setPlanes([]);
      setActivePlaneId(null);
      localStorage.removeItem(STORAGE_KEY);
    },
  };
}

import { Crosshair, Lock, LockOpen, ZoomIn, ZoomOut } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { stepPlaneZoom } from "../dashboard/utils/planeViewScaleLock";

/**
 * 降級頁的地圖視角：縮放、平移、適配、鎖定。
 *
 * 地圖本身照舊用嵌入模式等比塞進容器（圖台、車輛、標記在同一個座標系），這裡只在外面
 * 多套一層 translate＋scale——所有東西跟著同一個變換走，縮放後不會分離。比例 1 就是
 * 「適配」。視角用相對於適配狀態的比例與位移保存，容器大小改變不會把使用者調好的
 * 視角洗掉。
 *
 * 鎖定只鎖視角（不能拖、不能縮放），地圖內容照常即時更新；控制列仍可按，才能解鎖。
 * 每個 storageKey 各存各的，不碰其他儀表板的縮放設定（換 storageKey 請一併換 key 重建）。
 */
type ViewState = { zoom: number; x: number; y: number; locked: boolean };

const DEFAULT_VIEW: ViewState = { zoom: 1, x: 0, y: 0, locked: false };
const STORAGE_PREFIX = "syncdrive_degraded_map_view:";
const DRAG_THRESHOLD_PX = 4;

function readView(key: string): ViewState {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return DEFAULT_VIEW;
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    const zoom = Number(parsed.zoom);
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    return {
      zoom: Number.isFinite(zoom) ? Math.max(0.2, Math.min(5, zoom)) : 1,
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      locked: parsed.locked === true,
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

function writeView(key: string, view: ViewState) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(view));
  } catch {
    /* 存不進去只是下次回到適配 */
  }
}

/** 以容器內某點為中心改變比例：該點底下的地圖位置不動 */
export function zoomAround(
  view: ViewState,
  nextZoom: number,
  point: { x: number; y: number },
): ViewState {
  if (nextZoom === view.zoom) return view;
  const ratio = nextZoom / view.zoom;
  return {
    ...view,
    zoom: nextZoom,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  };
}

export function MapViewport({
  storageKey,
  children,
}: {
  storageKey: string;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>(() => readView(storageKey));
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  });

  useEffect(() => {
    writeView(storageKey, view);
  }, [storageKey, view]);

  const center = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 };
  };
  const step = (direction: 1 | -1) =>
    setView((current) =>
      current.locked
        ? current
        : zoomAround(current, stepPlaneZoom(current.zoom, direction), center()),
    );
  const fit = () =>
    setView((current) =>
      current.locked ? current : { ...DEFAULT_VIEW, locked: false },
    );
  const toggleLock = () =>
    setView((current) => ({ ...current, locked: !current.locked }));

  // 觸控板雙指＝平移；捏合（瀏覽器送 ctrl＋wheel）＝縮放。要能 preventDefault，所以自己掛
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (viewRef.current.locked) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (event.ctrlKey || event.metaKey) {
        setView((current) =>
          zoomAround(
            current,
            stepPlaneZoom(current.zoom, event.deltaY < 0 ? 1 : -1),
            point,
          ),
        );
        return;
      }
      setView((current) => ({
        ...current,
        x: current.x - event.deltaX,
        y: current.y - event.deltaY,
      }));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    active: boolean;
  } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (viewRef.current.locked || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-map-viewport-controls]"))
      return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
      active: false,
    };
  }, []);
  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      state.active = true;
      containerRef.current?.setPointerCapture(event.pointerId);
    }
    setView((current) =>
      current.locked
        ? current
        : { ...current, x: state.originX + dx, y: state.originY + dy },
    );
  }, []);
  const endDrag = useCallback((event: React.PointerEvent) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (containerRef.current?.hasPointerCapture(event.pointerId))
      containerRef.current.releasePointerCapture(event.pointerId);
    drag.current = null;
  }, []);

  const button =
    "flex size-8 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-700/70 disabled:cursor-not-allowed disabled:opacity-35";

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`relative h-full w-full touch-none overflow-hidden ${view.locked ? "" : "cursor-grab active:cursor-grabbing"}`}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
      <div
        data-map-viewport-controls
        className="absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-xl border border-zinc-700 bg-zinc-900/90 p-1 shadow-lg"
      >
        <button
          type="button"
          className={button}
          onClick={() => step(-1)}
          disabled={view.locked}
          aria-label="縮小"
          title={view.locked ? "視角已鎖定" : "縮小 5%"}
        >
          <ZoomOut className="size-4" />
        </button>
        <span
          className="min-w-12 text-center font-mono text-xs text-zinc-300"
          aria-label="目前縮放比例"
        >
          {Math.round(view.zoom * 100)}%
        </span>
        <button
          type="button"
          className={button}
          onClick={() => step(1)}
          disabled={view.locked}
          aria-label="放大"
          title={view.locked ? "視角已鎖定" : "放大 5%"}
        >
          <ZoomIn className="size-4" />
        </button>
        <button
          type="button"
          className={button}
          onClick={fit}
          disabled={view.locked}
          aria-label="適配視角"
          title={view.locked ? "視角已鎖定" : "適配並重置視角"}
        >
          <Crosshair className="size-4" />
        </button>
        <button
          type="button"
          className={`${button} ${view.locked ? "text-amber-300" : ""}`}
          onClick={toggleLock}
          aria-pressed={view.locked}
          aria-label={view.locked ? "解鎖視角" : "鎖定視角"}
          title={view.locked ? "解鎖視角" : "鎖定視角（內容照常更新）"}
        >
          {view.locked ? (
            <Lock className="size-4" />
          ) : (
            <LockOpen className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}

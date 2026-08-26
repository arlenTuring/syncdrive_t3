import { useEffect, useMemo, useRef, useState } from 'react'
import { MapAreaCanvas } from '@fe/features/map-editor/components/MapAreaCanvas'
import { parseMapFileJson } from '@fe/features/map-editor/utils/mapFileJson'
import {
  clampMapPixelZoomLevel,
  MAP_PIXEL_ZOOM_DEFAULT_LEVEL,
  MAP_PIXEL_ZOOM_LEVEL_COUNT,
} from '@fe/features/map-editor/utils/mapPixelZoom'
import type { MapAreaObject, MapPixelSize } from '@fe/features/map-editor/types/area'
import {
  fetchFieldBoxes,
  fetchMapDocument,
  fetchRoutes,
  resetRoutePath,
  saveRoutePath,
  type FieldBox,
  type RouteEntry,
} from './api'
import { RoutePathOverlay, type EditPoint } from './RoutePathOverlay'

type MapState = {
  areas: MapAreaObject[]
  pixelSize: MapPixelSize
  pixelOrigin: { x: number; y: number }
  displayName: string
}

/**
 * <code>MapAreaCanvas</code> 內部的實際圖面元素。
 *
 * 它把地圖包在「捲動層 &gt; 縮放層 &gt; 圖面」三層裡，覆層要量的是最裡面那一層的
 * 螢幕矩形——量外層會把捲動位移和縮放算進去兩次。虛擬圍籬用的是同一段。
 */
function findMapRoot(viewport: HTMLDivElement | null): HTMLElement | null {
  const scrollSurface = viewport?.firstElementChild as HTMLElement | null
  const scaledWrap = scrollSurface?.firstElementChild as HTMLElement | null
  return (scaledWrap?.firstElementChild as HTMLElement | null) ?? null
}

/**
 * 這一頁畫得出來的元件。
 *
 * 路徑只跟「車能走到哪、停在哪」有關：軌道、交叉、停靠點，以及站台這一類設施。
 * 號誌、月台門、智慧桿在圖台上是密密麻麻的小圖示，對畫路徑沒有幫助，只會擋住
 * 折線點與那個 ＋。
 */
const VISIBLE_FACILITY_TYPES = new Set(['Track', 'TrackCrossover', 'DockingPoint', 'Facility'])

function keepRelevantFacilities(areas: MapAreaObject[]): MapAreaObject[] {
  return areas.map((area) => ({
    ...area,
    facilities: area.facilities.filter((f) => VISIBLE_FACILITY_TYPES.has(f.type)),
  }))
}

/** 路線目前的折線頂點，轉成編輯器用的形狀（只有像素） */
function toEditPoints(route: RouteEntry): EditPoint[] {
  const nameById = new Map(route.stations.map((s) => [s.id, s.name]))
  return route.waypoints
    .filter((w) => Number.isFinite(w.px) && Number.isFinite(w.py))
    .map((w) => ({
      px: w.px as number,
      py: w.py as number,
      ...(w.stationId ? { stationId: w.stationId, name: nameById.get(w.stationId) } : {}),
    }))
}

export function RoutePathApp() {
  const viewportRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const [map, setMap] = useState<MapState | null>(null)
  const [routes, setRoutes] = useState<RouteEntry[]>([])
  const [fieldBoxes, setFieldBoxes] = useState<FieldBox[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<EditPoint[]>([])
  const [dirty, setDirty] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(MAP_PIXEL_ZOOM_DEFAULT_LEVEL)
  const [layoutEpoch, setLayoutEpoch] = useState(0)
  const [status, setStatus] = useState('載入圖資中…')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selected = useMemo(
    () => routes.find((r) => r.routeId === selectedId) ?? null,
    [routes, selectedId],
  )

  async function load(keepSelection = true) {
    setError(null)
    setStatus('載入圖資中…')
    try {
      const [doc, list, boxes] = await Promise.all([
        fetchMapDocument(),
        fetchRoutes(),
        fetchFieldBoxes(),
      ])
      const parsed = parseMapFileJson(doc)
      setMap({
        areas: keepRelevantFacilities(parsed.areas),
        pixelSize: parsed.pixelSize,
        pixelOrigin: parsed.pixelOrigin,
        displayName: parsed.displayName,
      })
      setRoutes(list)
      setFieldBoxes(boxes)
      const next = keepSelection && selectedId
        ? list.find((r) => r.routeId === selectedId)
        : list.find((r) => r.editable)
      if (next) {
        setSelectedId(next.routeId)
        setDraft(toEditPoints(next))
        setDirty(false)
      }
      setStatus('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('')
    }
  }

  useEffect(() => {
    void load(false)
    // 開頁就載入。切過去時該是畫好的，不是才開始等。
  }, [])

  useEffect(() => {
    setLayoutEpoch((n) => n + 1)
  }, [zoomLevel, map?.pixelSize.width, map?.pixelSize.height, draft])

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const bump = () => setLayoutEpoch((n) => n + 1)
    vp.addEventListener('scroll', bump, { passive: true })
    const ro = new ResizeObserver(bump)
    ro.observe(vp)
    return () => {
      vp.removeEventListener('scroll', bump)
      ro.disconnect()
    }
  }, [map])

  const pixelSize = map?.pixelSize ?? { width: 3152, height: 642 }
  const pixelOrigin = map?.pixelOrigin ?? { x: 0, y: 0 }

  const clientToMapPx = (clientX: number, clientY: number) => {
    const mapRoot = findMapRoot(viewportRef.current)
    if (!mapRoot) return { x: 0, y: 0 }
    const rect = mapRoot.getBoundingClientRect()
    return {
      x: (clientX - rect.left) * (pixelSize.width / Math.max(1, rect.width)) + pixelOrigin.x,
      y: (clientY - rect.top) * (pixelSize.height / Math.max(1, rect.height)) + pixelOrigin.y,
    }
  }

  const mapToScreen = (v: { x: number; y: number }) => {
    const mapRoot = findMapRoot(viewportRef.current)
    const root = rootRef.current?.getBoundingClientRect()
    if (!mapRoot || !root) return null
    const rect = mapRoot.getBoundingClientRect()
    return {
      x: rect.left - root.left + (v.x - pixelOrigin.x) * (rect.width / Math.max(1, pixelSize.width)),
      y: rect.top - root.top + (v.y - pixelOrigin.y) * (rect.height / Math.max(1, pixelSize.height)),
    }
  }

  /** 折線點有沒有落在方塊上。純命中判斷，座標換算仍然只在伺服器做。 */
  const isOnField = (p: { x: number; y: number }) =>
    fieldBoxes.some(
      (f) => p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h,
    )

  const strayCount = draft.filter((p) => !p.stationId && !isOnField({ x: p.px, y: p.py })).length

  /** 選中路線經過的方塊標亮——圖台本來就會highlight選取的設施，直接借用 */
  const highlightIds = useMemo(
    () => (selected ? [...new Set(selected.tracks.map((t) => t.id))] : []),
    [selected],
  )

  const onSelectRoute = (routeId: string) => {
    const route = routes.find((r) => r.routeId === routeId)
    setSelectedId(routeId)
    setDraft(route ? toEditPoints(route) : [])
    setDirty(false)
    setError(null)
  }

  const onSave = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const saved = await saveRoutePath(
        selected.routeId,
        draft.map((p) => ({
          px: p.px,
          py: p.py,
          ...(p.stationId ? { stationId: p.stationId } : {}),
        })),
      )
      setRoutes((prev) =>
        prev.map((r) => (r.routeId === saved.routeId ? { ...r, ...saved } : r)),
      )
      setDirty(false)
      setStatus(
        `已儲存：${saved.waypoints.length} 個折線頂點、經過 ${saved.tracks.length} 個方塊、`
        + `${saved.samples.length} 個路徑點、全長 ${saved.lengthM} 公尺`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onReset = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const reverted = await resetRoutePath(selected.routeId)
      setRoutes((prev) =>
        prev.map((r) => (r.routeId === reverted.routeId ? { ...r, ...reverted } : r)),
      )
      setDraft(toEditPoints({ ...selected, ...reverted }))
      setDirty(false)
      setStatus('已還原成站點直線')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const bendCount = draft.filter((p) => !p.stationId).length

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-base font-medium text-zinc-100">路線路徑</h1>
          <p className="text-xs text-zinc-500">
            圖台與路線都是從伺服器讀來的，這裡<strong className="text-zinc-300">不能新增或刪除任何元件</strong>。
            能改的只有一件事：每條路線怎麼從這一站開到下一站。
          </p>
        </div>

        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          路線
          <select
            className="min-w-56 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            value={selectedId ?? ''}
            onChange={(e) => onSelectRoute(e.target.value)}
          >
            {routes.length === 0 ? <option value="">（沒有路線）</option> : null}
            {routes.map((r) => (
              <option key={r.routeId} value={r.routeId} disabled={!r.editable}>
                {r.displayName}
                {r.customised ? '（已自訂）' : ''}
                {r.editable ? '' : '（站點在圖資裡找不到）'}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="rounded-md border border-cyan-800 bg-cyan-950 px-3 py-1.5 text-sm text-cyan-200 disabled:opacity-40"
          disabled={busy || !selected || !dirty || strayCount > 0}
          onClick={() => void onSave()}
        >
          儲存路徑
        </button>
        <button
          type="button"
          className="rounded-md border border-red-900 bg-red-950/60 px-3 py-1.5 text-sm text-red-300 disabled:opacity-40"
          disabled={busy || !selected}
          onClick={() => void onReset()}
        >
          還原成直線
        </button>
        <button
          type="button"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 disabled:opacity-40"
          disabled={busy}
          onClick={() => void load()}
        >
          重新載入圖資
        </button>

        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
          <span>縮放</span>
          <input
            type="range"
            min={1}
            max={MAP_PIXEL_ZOOM_LEVEL_COUNT}
            value={zoomLevel}
            onChange={(e) => setZoomLevel(clampMapPixelZoomLevel(Number(e.target.value)))}
          />
        </div>
      </header>

      {error ? (
        <p className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}
      {status && !error ? <p className="text-xs text-zinc-500">{status}</p> : null}

      <p className="text-xs text-zinc-500">
        點線段中央的 <strong className="text-zinc-300">＋</strong> 會在該處長出一個折線點，線就分成兩段；
        拖動折線點改變線徑，按右鍵刪除。
        <strong className="text-zinc-300">綠色的站點是固定的</strong>——那是班表定的停靠順序。
        {selected ? `　目前 ${bendCount} 個折線點${dirty ? '（未儲存）' : ''}` : null}
        {strayCount > 0 ? (
          <strong className="text-red-400">
            　有 {strayCount} 個紅色的點不在任何方塊上，存不進去
          </strong>
        ) : null}
      </p>

      <div
        ref={rootRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-800/80 bg-[#0c0c0e]"
      >
        {map ? (
          <>
            <MapAreaCanvas
              pixelSize={pixelSize}
              pixelOrigin={pixelOrigin}
              areas={map.areas}
              selectedAreaId={null}
              selectedFacilityIds={highlightIds}
              geofenceSelectedLabelId={null}
              viewportRef={viewportRef}
              displayMode="editor"
              wheelZoomMode="pinch"
              zoomLevel={zoomLevel}
              onZoomLevelChange={setZoomLevel}
              readOnly
              editMode={false}
              liveById={{}}
              areaVehicles={[]}
              vehicleEditSizer={null}
              slotPreview={null}
              onSelectArea={() => {}}
              onSelectFacility={() => {}}
              onSelectGeofenceLabel={() => {}}
              onDragFacility={() => {}}
              onDragSessionStart={() => {}}
            />
            <RoutePathOverlay
              points={draft}
              mapToScreen={mapToScreen}
              clientToMap={clientToMapPx}
              layoutEpoch={layoutEpoch}
              isOnField={isOnField}
              onChange={(next) => {
                setDraft(next)
                setDirty(true)
              }}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            {error ? '圖資載入失敗' : '載入圖資中…'}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <section>
          <h2 className="mb-1 text-xs text-zinc-500">經過的方塊</h2>
          <pre className="max-h-40 overflow-auto rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-[11px] text-zinc-400">
            {selected?.tracks.length
              ? selected.tracks
                  .map(
                    (t) =>
                      `${t.code.padEnd(6)} x ${t.refField.xMinM}–${t.refField.xMaxM}`
                      + `  y ${t.refField.yMinM}–${t.refField.yMaxM}`,
                  )
                  .join('\n')
              : '尚未選擇路線'}
          </pre>
        </section>
        <section>
          <h2 className="mb-1 text-xs text-zinc-500">路徑點（車輛實際照著走）</h2>
          <pre className="max-h-40 overflow-auto rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-[11px] text-zinc-400">
            {selected?.samples.length
              ? `共 ${selected.samples.length} 點，總長 ${selected.lengthM} 公尺\n`
                + selected.samples
                    .slice(0, 12)
                    .map((s) => `(${s.x.toFixed(1)}, ${s.y.toFixed(1)})`)
                    .join('  ')
                + (selected.samples.length > 12 ? '  …' : '')
              : '尚未選擇路線'}
          </pre>
        </section>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapAreaCanvas } from '@fe/features/map-editor/components/MapAreaCanvas'
import { parseMapFileJson } from '@fe/features/map-editor/utils/mapFileJson'
import { resolveRoutePreviewGeometry } from '@fe/features/map-editor/utils/routeTrackPath'
import {
  clampMapPixelZoomLevel,
  MAP_PIXEL_ZOOM_DEFAULT_LEVEL,
  MAP_PIXEL_ZOOM_LEVEL_COUNT,
} from '@fe/features/map-editor/utils/mapPixelZoom'
import type { MapAreaObject, MapPixelSize } from '@fe/features/map-editor/types/area'
import type { PointTopology } from '@fe/features/map-editor/types/pointTopology'
import {
  fetchFieldTargets,
  fetchMapDocument,
  fetchRoutes,
  resetRoutePath,
  saveRoutePath,
  type FieldTargets,
  type RouteEntry,
} from './api'
import { RoutePathOverlay, type EditPoint } from './RoutePathOverlay'

type MapState = {
  /** 圖台要畫的：只留與路徑有關的元件 */
  areas: MapAreaObject[]
  /** 算路徑要用的：完整的，少了設施會算不出軌道網路 */
  allAreas: MapAreaObject[]
  pointTopology: PointTopology | null
  pixelSize: MapPixelSize
  pixelOrigin: { x: number; y: number }
  displayName: string
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

/**
 * 路線的預設路徑：<strong>沿軌道走</strong>，不是站點直線。
 *
 * 用的是地圖編輯器自己那支 <code>resolveRoutePreviewGeometry</code>——它會把站點吸附
 * 到軌道中心線、在軌道網路上找最短路、走該走的橫渡線。所以一打開看到的就是編輯器
 * 上顯示的那條線，會過 cross，不會斜穿空地。
 *
 * <h3>為什麼一段一段算，不整條丟進去</h3>
 * 整條丟進去時，回傳的 <code>pathLegs</code> 與站序<strong>不保證一一對應</strong>：
 * 只要有一段連不起來，後面全部錯位，折線點會插到別段去——存出來的路徑點順序是亂的，
 * 車輛會照著倒退的座標開。一次只問兩站，回來的就只可能是這兩站之間的東西。
 *
 * <h3>站點座標不用它算的</h3>
 * 幾何回傳的站點是<strong>吸附到軌道中心線之後</strong>的位置，與班表定義的停靠點
 * 差得可能很遠（實測有一站從 y=170 變成 y=111）。錨點一律用伺服器給的真實站點座標，
 * 幾何只拿中間的轉折。
 */
function defaultPathPoints(
  areas: MapAreaObject[],
  pointTopology: PointTopology | null,
  route: RouteEntry,
): { points: EditPoint[]; followsTracks: boolean; warnings: string[] } {
  const stations = route.stations.filter(
    (s) => Number.isFinite(s.px) && Number.isFinite(s.py),
  )
  if (stations.length < 2) return { points: [], followsTracks: false, warnings: [] }

  const points: EditPoint[] = []
  const warnings: string[] = []
  let allFollowTracks = true

  for (let i = 0; i < stations.length; i += 1) {
    const station = stations[i]!
    points.push({
      px: station.px as number,
      py: station.py as number,
      stationId: station.id,
      name: station.name,
    })

    const nextStation = stations[i + 1]
    if (!nextStation) break

    const geometry = resolveRoutePreviewGeometry(
      areas,
      [station.id, nextStation.id],
      pointTopology,
    )
    if (!geometry.followsTracks) allFollowTracks = false
    for (const w of geometry.warnings) warnings.push(w.message)

    /*
     * 頭尾是被吸附過的兩端，這裡只收中間的轉折，而且只收<strong>真的走在兩站之間</strong>的。
     *
     * 吸附後的端點與真正的站點差幾個像素，於是頭尾附近會冒出幾乎重疊、甚至超過站點的
     * 轉折點。留著的話路徑會在站點旁邊回鉤一下——畫面上看不太出來，但存下去的路徑點
     * 順序是往回走的。
     *
     * 判斷方式是投影到「這一站→下一站」的向量上：投影比例落在 0～1 之外就是沒有前進，
     * 丟掉。這比用距離門檻乾淨——門檻要調，投影不用。
     */
    const leg = geometry.pathLegs?.[0] ?? geometry.pathPx
    if (leg && leg.length > 2) {
      const ax = station.px as number
      const ay = station.py as number
      const dx = (nextStation.px as number) - ax
      const dy = (nextStation.py as number) - ay
      const lenSq = dx * dx + dy * dy
      for (const p of leg.slice(1, -1)) {
        const t = lenSq > 0 ? ((p.x - ax) * dx + (p.y - ay) * dy) / lenSq : 0.5
        if (t <= 0.02 || t >= 0.98) continue
        points.push({ px: p.x, py: p.y })
      }
    }
  }

  return { points, followsTracks: allFollowTracks, warnings: [...new Set(warnings)] }
}

/** 已存檔的路徑，轉成編輯器用的形狀（只有像素） */
function savedPathPoints(route: RouteEntry): EditPoint[] {
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

  const [map, setMap] = useState<MapState | null>(null)
  const [routes, setRoutes] = useState<RouteEntry[]>([])
  const [targets, setTargets] = useState<FieldTargets>({ boxes: [], crossovers: [] })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<EditPoint[]>([])
  const [dirty, setDirty] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(MAP_PIXEL_ZOOM_DEFAULT_LEVEL)
  const [status, setStatus] = useState('載入圖資中…')
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selected = useMemo(
    () => routes.find((r) => r.routeId === selectedId) ?? null,
    [routes, selectedId],
  )

  /**
   * 選一條路線：存過的用存的，沒存過的用沿軌道算出來的預設。
   *
   * 沒存過時要講明白——編輯器上看到的是算出來的，車輛還沒吃到，按下儲存才算數。
   */
  function selectRoute(route: RouteEntry | null, source: MapState | null) {
    setError(null)
    setNote(null)
    setSelectedId(route?.routeId ?? null)
    if (!route || !source) {
      setDraft([])
      return
    }
    if (route.customised) {
      setDraft(savedPathPoints(route))
      setStatus('目前是自訂路徑')
    } else {
      const built = defaultPathPoints(source.allAreas, source.pointTopology, route)
      setDraft(built.points)
      setStatus(
        built.followsTracks
          ? '目前是沿軌道算出來的預設路徑；還沒儲存，車輛不會照這條走'
          : '這條路線沒辦法完全沿軌道連起來',
      )
      if (built.warnings.length > 0) setNote(built.warnings.join('；'))
    }
    setDirty(false)
  }

  async function load(keepSelection = true) {
    setError(null)
    setStatus('載入圖資中…')
    try {
      const [doc, list, fieldTargets] = await Promise.all([
        fetchMapDocument(),
        fetchRoutes(),
        fetchFieldTargets(),
      ])
      const parsed = parseMapFileJson(doc)
      const next: MapState = {
        areas: keepRelevantFacilities(parsed.areas),
        allAreas: parsed.areas,
        pointTopology: parsed.pointTopology,
        pixelSize: parsed.pixelSize,
        pixelOrigin: parsed.pixelOrigin,
        displayName: parsed.displayName,
      }
      setMap(next)
      setRoutes(list)
      setTargets(fieldTargets)
      selectRoute(
        (keepSelection && selectedId ? list.find((r) => r.routeId === selectedId) : null)
          ?? list.find((r) => r.editable)
          ?? null,
        next,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('')
    }
  }

  useEffect(() => {
    void load(false)
    // 開頁就載入。切過去時該是畫好的，不是才開始等。
  }, [])

  /**
   * 折線點存不存得進去：落在某個方塊裡，或壓在某條橫渡線上。
   *
   * 純命中判斷，座標換算仍然只在伺服器做。容忍距離與伺服器的 24px 一致——
   * 兩邊不一樣的話，畫面說可以存、按下去卻被打回來。
   */
  const isOnField = (p: { x: number; y: number }) => {
    if (targets.boxes.some((f) => p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h)) {
      return true
    }
    return targets.crossovers.some((xo) => {
      const dx = xo.b.px - xo.a.px
      const dy = xo.b.py - xo.a.py
      const lenSq = dx * dx + dy * dy
      if (lenSq <= 0) return false
      const t = Math.max(0, Math.min(1, ((p.x - xo.a.px) * dx + (p.y - xo.a.py) * dy) / lenSq))
      return Math.hypot(p.x - (xo.a.px + dx * t), p.y - (xo.a.py + dy * t)) <= 24
    })
  }

  const strayCount = draft.filter((p) => !p.stationId && !isOnField({ x: p.px, y: p.py })).length
  const bendCount = draft.filter((p) => !p.stationId).length

  /** 選中路線經過的方塊標亮——圖台本來就會 highlight 選取的設施，直接借用 */
  const highlightIds = useMemo(
    () => (selected ? [...new Set(selected.tracks.map((t) => t.id))] : []),
    [selected],
  )

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
      setRoutes((prev) => prev.map((r) => (r.routeId === saved.routeId ? { ...r, ...saved } : r)))
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
    if (!selected || !map) return
    setBusy(true)
    setError(null)
    try {
      const reverted = await resetRoutePath(selected.routeId)
      const merged = { ...selected, ...reverted, customised: false }
      setRoutes((prev) => prev.map((r) => (r.routeId === merged.routeId ? merged : r)))
      selectRoute(merged, map)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-base font-medium text-zinc-100">路線路徑</h1>
          <p className="text-xs text-zinc-500">
            圖台與路線都是從伺服器讀來的，這裡
            <strong className="text-zinc-300">不能新增或刪除任何元件</strong>。
            能改的只有一件事：每條路線怎麼從這一站開到下一站。
          </p>
        </div>

        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          路線
          <select
            className="min-w-56 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            value={selectedId ?? ''}
            onChange={(e) =>
              selectRoute(routes.find((r) => r.routeId === e.target.value) ?? null, map)
            }
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
          disabled={busy || !selected || strayCount > 0}
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
          還原成預設
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
      {note && !error ? (
        <p className="rounded-md border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          {note}
        </p>
      ) : null}

      <p className="text-xs text-zinc-500">
        點線段中央的 <strong className="text-zinc-300">＋</strong> 會在該處長出一個折線點，
        線就分成兩段；拖動折線點改變線徑，按右鍵刪除。
        <strong className="text-zinc-300">綠色的站點是固定的</strong>——那是班表定的停靠順序。
        {selected ? `　${status}　（${bendCount} 個折線點${dirty ? '，未儲存' : ''}）` : null}
        {strayCount > 0 ? (
          <strong className="text-red-400">
            　有 {strayCount} 個紅色的點不在任何方塊上，存不進去
          </strong>
        ) : null}
      </p>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-800/80 bg-[#0c0c0e]">
        {map ? (
          <MapAreaCanvas
            pixelSize={map.pixelSize}
            pixelOrigin={map.pixelOrigin}
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
            /*
             * 走圖台自己的路線插槽，而不是另外疊一層。
             * 插槽在圖面內容容器裡，座標就是圖面像素——縮放與捲動由瀏覽器連同底圖
             * 一起處理，不會飄。
             */
            routePlanningOverlay={
              <RoutePathOverlay
                points={draft}
                isOnField={isOnField}
                onChange={(next) => {
                  setDraft(next)
                  setDirty(true)
                }}
              />
            }
          />
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

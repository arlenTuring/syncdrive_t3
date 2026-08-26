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
 * 只留下真正的轉折點。
 *
 * <h3>為什麼一定要收</h3>
 * <code>pathLegs</code> 是<strong>畫線用</strong>的密集折線：一條斜穿橫渡線的直線可能有
 * 十幾個頂點。地圖編輯器把它整條畫出來，看起來就是一條直線——因為它只在站點放徽章，
 * 中間的頂點不顯示。
 *
 * 這一頁不一樣：每個頂點都是可以拖的控制點。不收的話，一條直線上會排滿十幾個方塊，
 * 既擋住底圖也沒有任何意義——沒有人要去拖一條直線中間的第七個點。
 *
 * <code>collapseColinearPathPx</code> 不夠用：它只收<strong>軸向</strong>的共線點，而橫渡線
 * 是斜的，一個都收不掉。這裡改用轉向角判斷，斜的直線一樣收得掉。
 */
function keepCorners(
  points: Array<{ x: number; y: number }>,
  minTurnDeg = 4,
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points.map((p) => ({ ...p }))
  const out = [{ ...points[0]! }]
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = out[out.length - 1]!
    const b = points[i]!
    const c = points[i + 1]!
    const inAngle = Math.atan2(b.y - a.y, b.x - a.x)
    const outAngle = Math.atan2(c.y - b.y, c.x - b.x)
    let turn = Math.abs((outAngle - inAngle) * (180 / Math.PI)) % 360
    if (turn > 180) turn = 360 - turn
    if (turn >= minTurnDeg) out.push({ ...b })
  }
  out.push({ ...points[points.length - 1]! })
  return out
}

/**
 * 路線的預設路徑：<strong>沿軌道走</strong>，不是站點直線。
 *
 * 整條路徑——站點位置與線徑——都是地圖編輯器那支 <code>resolveRoutePreviewGeometry</code>
 * 算的，跟編輯器上顯示的是同一份結果。<strong>這裡不另外算一套</strong>：站點吸附到哪、
 * 走哪條橫渡線、在哪裡轉，全部照它的。
 *
 * <h3>為什麼一次只問兩站</h3>
 * 整條丟進去時，回傳的 <code>pathLegs</code> 與站序<strong>不保證一一對應</strong>：
 * 只要有一段連不起來，後面全部錯位，折線點會插到別段去。一次只問兩站，回來的就只
 * 可能是這兩站之間的東西。
 */
function defaultPathPoints(
  areas: MapAreaObject[],
  pointTopology: PointTopology | null,
  route: RouteEntry,
): { points: EditPoint[]; followsTracks: boolean; warnings: string[] } {
  const ids = route.stationIds
  if (ids.length < 2) return { points: [], followsTracks: false, warnings: [] }
  const nameById = new Map(route.stations.map((s) => [s.id, s.name]))

  const points: EditPoint[] = []
  const warnings: string[] = []
  let allFollowTracks = true

  for (let i = 0; i < ids.length - 1; i += 1) {
    const geometry = resolveRoutePreviewGeometry(areas, [ids[i]!, ids[i + 1]!], pointTopology)
    const from = geometry.stations[0]
    const to = geometry.stations[1]
    if (!from || !to) continue
    if (!geometry.followsTracks) allFollowTracks = false
    for (const w of geometry.warnings) warnings.push(w.message)

    // 站點位置用編輯器算的：它會吸附到軌道上，橫渡線端點就落在 cross 的角上
    if (points.length === 0) {
      points.push({
        px: from.x,
        py: from.y,
        stationId: from.stationId,
        name: nameById.get(from.stationId) ?? from.stationName,
      })
    }
    // 這一段沿不了軌道：畫成紅虛線，那是佔位的直線，不是真的路徑
    if (!geometry.followsTracks) points[points.length - 1]!.brokenAhead = true

    const leg = geometry.pathLegs?.[0] ?? geometry.pathPx
    if (leg && leg.length > 2) {
      for (const p of keepCorners(leg).slice(1, -1)) points.push({ px: p.x, py: p.y })
    }

    points.push({
      px: to.x,
      py: to.y,
      stationId: to.stationId,
      name: nameById.get(to.stationId) ?? to.stationName,
    })
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

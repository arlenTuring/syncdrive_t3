import { Plus } from 'lucide-react'
import { useState } from 'react'

export type EditPoint = {
  px: number
  py: number
  /** 有值＝班表定的停靠站：位置固定，不能拖也不能刪 */
  stationId?: string
  name?: string
}

type ScreenPt = { x: number; y: number }

type RoutePathOverlayProps = {
  points: EditPoint[]
  /** 圖面像素 → 相對 root 的螢幕座標 */
  mapToScreen: (p: { x: number; y: number }) => ScreenPt | null
  /** 螢幕 client → 圖面像素 */
  clientToMap: (clientX: number, clientY: number) => { x: number; y: number }
  /** 訂閱縮放／捲動以重算螢幕位置 */
  layoutEpoch: number
  /** 這個點有沒有落在方塊上；false 會標紅，因為它存不進去 */
  isOnField: (p: { x: number; y: number }) => boolean
  onChange: (next: EditPoint[]) => void
}

/**
 * 路線路徑覆層：站點兩兩相接的折線，中間可以加折線點。
 *
 * 疊在地圖編輯圖台（<code>MapAreaCanvas</code>）上，做法與虛擬圍籬的
 * <code>FenceShapeOverlay</code> 一樣——底下那張圖是同一支元件畫的，所以這裡看到的
 * 方塊位置就是圖台上的位置，不是另外描一份像的。
 *
 * 只負責「怎麼從這一站開到下一站」：站點是班表定義的停靠順序，這裡動不了。
 */
export function RoutePathOverlay({
  points,
  mapToScreen,
  clientToMap,
  layoutEpoch,
  isOnField,
  onChange,
}: RoutePathOverlayProps) {
  const [activeLeg, setActiveLeg] = useState<number | null>(null)
  // layoutEpoch 進到 render：縮放／捲動之後螢幕座標要重算
  void layoutEpoch

  if (points.length < 2) return null

  const screen = points.map((p) => mapToScreen({ x: p.px, y: p.py }))
  const drawable = screen.every((p): p is ScreenPt => p != null)
  if (!drawable) return null
  const pts = screen as ScreenPt[]

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ')

  const onPointDrag = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (points[index]?.stationId) return
    e.stopPropagation()
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const start = points.map((p) => ({ ...p }))

    const onMove = (ev: PointerEvent) => {
      const p = clientToMap(ev.clientX, ev.clientY)
      onChange(start.map((v, i) => (i === index ? { ...v, px: p.x, py: p.y } : v)))
    }
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  const onDeletePoint = (e: React.MouseEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    if (points[index]?.stationId) return
    onChange(points.filter((_, i) => i !== index))
    setActiveLeg(null)
  }

  const onInsert = (e: React.MouseEvent, legIndex: number) => {
    e.stopPropagation()
    const a = points[legIndex]!
    const b = points[legIndex + 1]!
    const mid: EditPoint = { px: (a.px + b.px) / 2, py: (a.py + b.py) / 2 }
    const next = [...points]
    next.splice(legIndex + 1, 0, mid)
    onChange(next)
    setActiveLeg(null)
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-[15]">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <polyline
          points={polyline}
          fill="none"
          stroke="#38bdf8"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {pts.slice(0, -1).map((a, i) => {
          const b = pts[i + 1]!
          return (
            <line
              key={`leg-${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="transparent"
              strokeWidth={16}
              className="pointer-events-auto cursor-pointer"
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                setActiveLeg(i)
              }}
            />
          )
        })}
      </svg>

      {pts.map((p, i) => {
        const point = points[i]!
        const isStation = Boolean(point.stationId)
        // 不在任何方塊上＝沒有對應的場域座標，存不進去。當場標紅，別等到按儲存。
        const stray = !isStation && !isOnField({ x: point.px, y: point.py })
        return (
          <button
            key={`pt-${i}`}
            type="button"
            className={
              isStation
                ? 'pointer-events-auto absolute size-4 -translate-x-1/2 -translate-y-1/2 cursor-not-allowed rounded-full border-2 border-white bg-emerald-400 shadow'
                : `pointer-events-auto absolute size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-sm border-2 shadow active:cursor-grabbing ${
                    stray ? 'animate-pulse border-red-300 bg-red-500' : 'border-white bg-sky-400'
                  }`
            }
            style={{ left: p.x, top: p.y }}
            title={
              isStation
                ? `${point.name ?? point.stationId}（班表定的停靠站，不能移動）`
                : stray
                  ? '這個點不在任何方塊上，存不進去——拖回軌道或站台範圍內'
                  : '拖曳可改變路徑；按右鍵刪除'
            }
            onPointerDown={(e) => onPointDrag(e, i)}
            onContextMenu={(e) => onDeletePoint(e, i)}
          />
        )
      })}

      {activeLeg != null && activeLeg < pts.length - 1
        ? (() => {
            const a = pts[activeLeg]!
            const b = pts[activeLeg + 1]!
            return (
              <button
                type="button"
                className="pointer-events-auto absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-sky-400 bg-zinc-900 text-sky-300 shadow-lg"
                style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 }}
                title="在這裡加一個折線點"
                onClick={(e) => onInsert(e, activeLeg)}
              >
                <Plus className="size-5" strokeWidth={2.5} aria-hidden />
              </button>
            )
          })()
        : null}
    </div>
  )
}

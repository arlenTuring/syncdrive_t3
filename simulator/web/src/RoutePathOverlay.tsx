import { useLayoutEffect, useRef, useState } from 'react'

export type EditPoint = {
  /** 圖面像素，與圖資的 layout/areaPosition 同一套座標 */
  px: number
  py: number
  /** 有值＝班表定的停靠站：位置固定，不能拖也不能刪 */
  stationId?: string
  name?: string
}

type RoutePathOverlayProps = {
  points: EditPoint[]
  /** 這個點有沒有落在方塊上；false 會標紅，因為它存不進去 */
  isOnField: (p: { x: number; y: number }) => boolean
  onChange: (next: EditPoint[]) => void
}

/** 螢幕座標 → SVG 使用者座標（＝圖面像素） */
function toUserSpace(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

/**
 * 路線路徑覆層：站點兩兩相接的折線，中間可以加折線點。
 *
 * <h3>為什麼是掛在圖面裡，而不是疊一層在上面</h3>
 * 先前的寫法是在圖台<strong>外面</strong>另外絕對定位一個 div，靠
 * <code>getBoundingClientRect()</code> 把圖面像素換算成螢幕位置。那必然會飄：
 * 量到的是「上一次 render 當下」的矩形，捲動、縮放、版面重排都會讓它與底圖脫節，
 * 而且拖曳時每動一下就得重量一次。
 *
 * 現在走 <code>MapAreaCanvas</code> 的 <code>routePlanningOverlay</code> 插槽——
 * 地圖編輯器自己畫路線用的就是這個。插槽在圖面內容容器裡面（該容器是
 * <code>left:-pixelOrigin.x; top:-pixelOrigin.y</code>），所以
 * <strong>SVG 的使用者座標直接就是圖面像素</strong>：座標原封不動畫下去就對齊，
 * 縮放與捲動由瀏覽器連同底圖一起處理，不可能對不上。
 *
 * 反向（滑鼠 → 圖面像素）用 <code>getScreenCTM().inverse()</code>，那是瀏覽器
 * 當下真正在用的變換矩陣，不是我們自己推算的比例。
 */
export function RoutePathOverlay({ points, isOnField, onChange }: RoutePathOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [activeLeg, setActiveLeg] = useState<number | null>(null)
  /** 圖面縮放倍率：控制點要照這個反向縮放，否則縮小時會小到點不到 */
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const sync = () => {
      const a = svg.getScreenCTM()?.a
      if (a && Number.isFinite(a) && a > 0) setScale(a)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(svg)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  })

  if (points.length < 2) return null

  /** 控制點在螢幕上要維持的大小，換算回使用者座標 */
  const u = (screenPx: number) => screenPx / scale
  const polyline = points.map((p) => `${p.px},${p.py}`).join(' ')

  const startDrag = (e: React.PointerEvent, index: number) => {
    const svg = svgRef.current
    if (!svg || points[index]?.stationId) return
    e.stopPropagation()
    e.preventDefault()
    const target = e.currentTarget as SVGElement
    target.setPointerCapture(e.pointerId)
    const start = points.map((p) => ({ ...p }))

    const onMove = (ev: PointerEvent) => {
      const p = toUserSpace(svg, ev.clientX, ev.clientY)
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

  const deletePoint = (e: React.MouseEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    if (points[index]?.stationId) return
    onChange(points.filter((_, i) => i !== index))
    setActiveLeg(null)
  }

  /** 在線段中央插一個折線點，線就分成兩段 */
  const insertOnLeg = (e: React.MouseEvent, legIndex: number) => {
    e.stopPropagation()
    const a = points[legIndex]!
    const b = points[legIndex + 1]!
    const next = [...points]
    next.splice(legIndex + 1, 0, { px: (a.px + b.px) / 2, py: (a.py + b.py) / 2 })
    onChange(next)
    setActiveLeg(null)
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-[9000]">
      <svg
        ref={svgRef}
        className="absolute left-0 top-0 overflow-visible"
        width="100%"
        height="100%"
      >
        <polyline
          points={polyline}
          fill="none"
          stroke="#38bdf8"
          strokeWidth={u(2.5)}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* 點得到的線段：透明加粗，寬度照螢幕大小而不是圖面大小 */}
        {points.slice(0, -1).map((a, i) => {
          const b = points[i + 1]!
          return (
            <line
              key={`leg-${i}`}
              x1={a.px}
              y1={a.py}
              x2={b.px}
              y2={b.py}
              stroke="transparent"
              strokeWidth={u(16)}
              style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                setActiveLeg(i)
              }}
            />
          )
        })}

        {points.map((p, i) => {
          const isStation = Boolean(p.stationId)
          // 不在任何方塊上＝沒有對應的場域座標，存不進去。當場標紅，別等到按儲存。
          const stray = !isStation && !isOnField({ x: p.px, y: p.py })
          return isStation ? (
            <circle
              key={`pt-${i}`}
              cx={p.px}
              cy={p.py}
              r={u(7)}
              fill="#34d399"
              stroke="#fff"
              strokeWidth={u(2)}
              style={{ pointerEvents: 'auto', cursor: 'not-allowed' }}
            >
              <title>{`${p.name ?? p.stationId}（班表定的停靠站，不能移動）`}</title>
            </circle>
          ) : (
            <rect
              key={`pt-${i}`}
              x={p.px - u(6)}
              y={p.py - u(6)}
              width={u(12)}
              height={u(12)}
              rx={u(2)}
              fill={stray ? '#ef4444' : '#38bdf8'}
              stroke={stray ? '#fca5a5' : '#fff'}
              strokeWidth={u(2)}
              style={{ pointerEvents: 'auto', cursor: 'grab' }}
              onPointerDown={(e) => startDrag(e, i)}
              onContextMenu={(e) => deletePoint(e, i)}
            >
              <title>
                {stray
                  ? '這個點不在任何方塊上，存不進去——拖回軌道或站台範圍內'
                  : '拖曳可改變路徑；按右鍵刪除'}
              </title>
            </rect>
          )
        })}

        {activeLeg != null && activeLeg < points.length - 1
          ? (() => {
              const a = points[activeLeg]!
              const b = points[activeLeg + 1]!
              const cx = (a.px + b.px) / 2
              const cy = (a.py + b.py) / 2
              const r = u(14)
              return (
                <g
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onClick={(e) => insertOnLeg(e, activeLeg)}
                >
                  <title>在這裡加一個折線點</title>
                  <circle cx={cx} cy={cy} r={r} fill="#18181b" stroke="#38bdf8" strokeWidth={u(2)} />
                  <path
                    d={`M ${cx - u(7)} ${cy} H ${cx + u(7)} M ${cx} ${cy - u(7)} V ${cy + u(7)}`}
                    stroke="#7dd3fc"
                    strokeWidth={u(2.5)}
                    strokeLinecap="round"
                  />
                </g>
              )
            })()
          : null}
      </svg>
    </div>
  )
}

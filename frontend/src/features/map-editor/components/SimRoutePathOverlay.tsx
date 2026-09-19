import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type EditPoint = {
  /** 圖面像素，與圖資的 layout/areaPosition 同一套座標 */
  px: number
  py: number
  /** 有值＝班表定的停靠站：位置固定，不能拖也不能刪 */
  stationId?: string
  name?: string
  /** 這個點到下一點之間，自動找路找不到——畫紅虛線，等人自己畫 */
  brokenAhead?: boolean
}

/**
 * 一條可以吸附的直線。<code>value</code> 是它固定的那一軸（垂直線是 x、水平線是 y），
 * <code>from</code>／<code>to</code> 是它在另一軸上的範圍——點要落在範圍內才算數，
 * 否則畫面另一頭的軌道也會把點吸走。
 */
export type SnapLine = {
  value: number
  from: number
  to: number
  /**
   * 允許超出 <code>from</code>／<code>to</code> 多少。
   *
   * 轉角<strong>本來就落在軌道末端外面</strong>：直軌到頭了才轉上橫軌，交會處在
   * 直軌的端點之外。範圍卡得剛剛好的話，正要收尾的那一段永遠吸不到自己那條直軌。
   * 呼叫端給的是軌道自己的厚度——超出一個軌寬以內都還算在這條軌道的端點上。
   */
  slack: number
  label: string
  /** track＝軌道中心線；point＝跟相鄰的點對齊 */
  kind: 'track' | 'point'
}

/** 交叉軌道的對角線那種斜的線段，只能整段投影上去，沒辦法拆成 x／y 兩軸 */
export type SnapSegment = {
  ax: number
  ay: number
  bx: number
  by: number
  label: string
}

export type SnapTargets = {
  verticals: SnapLine[]
  horizontals: SnapLine[]
  segments: SnapSegment[]
}

type ActiveGuide = {
  vertical?: SnapLine
  horizontal?: SnapLine
  segment?: SnapSegment
}

type RoutePathOverlayProps = {
  points: EditPoint[]
  /** 這個點有沒有落在方塊上；false 會標紅，因為它存不進去 */
  isOnField: (p: { x: number; y: number }) => boolean
  /** 拖曳時可以吸附的東西：軌道中心線與交叉軌道的對角線 */
  snapTargets: SnapTargets
  /** 對齊線要畫多長——畫滿整張圖，才看得出來是跟哪一條軌道對齊 */
  bounds: { left: number; top: number; right: number; bottom: number }
  onChange: (next: EditPoint[]) => void
  /**
   * 車輛實際照著走的虛擬路徑點（等距樣點）。只顯示、不能拖也不能刪——
   * 用來核對折線有沒有沿軌道／對角線，還是弦切過空地。
   */
  vehicleSamples?: Array<{ px: number; py: number }>
}

/** 螢幕座標 → SVG 使用者座標（＝圖面像素） */
function toUserSpace(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

/**
 * 找最近的一條可吸附直線。
 *
 * <code>lines</code> 的順序就是優先序：距離一樣近時<strong>先出現的贏</strong>。
 * 呼叫端把軌道中心線排在相鄰點前面，所以兩者重合時吸的是軌道——那是實際線形，
 * 而跟相鄰點對齊只是剛好同一個位置。
 */
function nearestLine(lines: SnapLine[], value: number, along: number, tolerance: number): SnapLine | null {
  let best: SnapLine | null = null
  let bestDelta = tolerance
  for (const line of lines) {
    const delta = Math.abs(line.value - value)
    if (delta >= bestDelta) continue
    const slack = Math.max(tolerance, line.slack)
    if (along < Math.min(line.from, line.to) - slack) continue
    if (along > Math.max(line.from, line.to) + slack) continue
    best = line
    bestDelta = delta
  }
  return best
}

/** 點到線段的垂足，連同距離 */
function projectOnSegment(x: number, y: number, seg: SnapSegment) {
  const dx = seg.bx - seg.ax
  const dy = seg.by - seg.ay
  const lengthSq = dx * dx + dy * dy
  if (lengthSq <= 0) return null
  const t = Math.max(0, Math.min(1, ((x - seg.ax) * dx + (y - seg.ay) * dy) / lengthSq))
  const foot = { x: seg.ax + dx * t, y: seg.ay + dy * t }
  return { ...foot, distance: Math.hypot(x - foot.x, y - foot.y) }
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
export function SimRoutePathOverlay({
  points,
  isOnField,
  snapTargets,
  bounds,
  onChange,
  vehicleSamples = [],
}: RoutePathOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [activeLeg, setActiveLeg] = useState<number | null>(null)
  /** 點選中的折線點：旁邊會長出一個 ✕，按 Delete 也刪它 */
  const [selected, setSelected] = useState<number | null>(null)
  /** 圖面縮放倍率：控制點要照這個反向縮放，否則縮小時會小到點不到 */
  const [scale, setScale] = useState(1)
  /** 這一刻吸到了什麼，畫成對齊線 */
  const [guide, setGuide] = useState<ActiveGuide | null>(null)

  /**
   * 跟著圖台的縮放倍率走。
   *
   * <h3>為什麼要每一影格量，不能用 ResizeObserver</h3>
   * 圖台的縮放是掛在祖先 div 上的 <code>transform: matrix(...)</code>。CSS transform
   * <strong>不改變 layout box</strong>——SVG 量到的寬高從頭到尾都一樣，所以縮放時
   * ResizeObserver 一次都不會觸發。那個 div 還帶著 <code>transition</code>，於是在
   * render 當下讀 <code>getScreenCTM()</code> 拿到的是動畫<strong>中途</strong>的倍率，
   * 之後沒有任何事件會再叫我們重量一次，倍率就卡在那個中途值上。
   *
   * 症狀很明顯：控制點是照 <code>u()</code> 反向縮放的，倍率偏小十倍，方塊就會脹成
   * 近百像素，蓋住底圖也拉不準——正好毀掉這一頁唯一要做的事。
   *
   * 一影格讀一次矩陣，成本可以忽略，而且天然跟得上 transition。
   */
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    let frame = 0
    let current = 0
    const tick = () => {
      const a = svg.getScreenCTM()?.a
      if (a && Number.isFinite(a) && a > 0 && Math.abs(a - current) > current * 0.001 + 1e-9) {
        current = a
        setScale(a)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  /**
   * 選中的折線點按 Delete／Backspace 就刪掉。
   *
   * 掛在 window 上，因為 SVG 元素預設拿不到鍵盤焦點。要擋掉在輸入欄位裡按
   * Backspace 的情況——那是在刪字，不是在刪點。
   */
  useEffect(() => {
    if (selected == null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return
      if (points[selected]?.stationId) return
      event.preventDefault()
      onChange(points.filter((_, i) => i !== selected))
      setSelected(null)
      setActiveLeg(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, points, onChange])

  if (points.length < 2) return null

  /** 控制點在螢幕上要維持的大小，換算回使用者座標 */
  const u = (screenPx: number) => screenPx / scale

  /**
   * 把拖到的位置吸附到軌道中心線或相鄰的點上。
   *
   * <h3>為什麼要有這個</h3>
   * 車頭方向就是路徑方向。折線點只要離軌道中心線幾公尺，那一段就帶著幾度的側偏，
   * 圖台上的車便是斜著跑的——用眼睛拖不可能拖到 0.01 像素，所以吸附不是方便功能，
   * 是唯一能拉出正交路徑的辦法。
   *
   * <h3>兩軸分開吸</h3>
   * x 與 y 各自找最近的一條線，互不影響。所以可以「x 貼上直軌中心線、y 跟前一點齊平」
   * ——那正好就是一個直角轉角，兩段各自水平與垂直。
   *
   * 相鄰點也當成吸附目標，是為了<strong>平行</strong>：跟前一點齊平，這一段就是正橫；
   * 跟後一點對齊，下一段就是正直。
   *
   * 兩軸都沒吸到才試交叉軌道的對角線——那是斜的，只能整個點投影上去，沒辦法拆成兩軸。
   */
  const snap = (x: number, y: number, index: number): { x: number; y: number; guide: ActiveGuide } => {
    const tolerance = u(9)

    // 軌道中心線排在前面：跟相鄰點重合時，吸的是軌道
    const verticals = [...snapTargets.verticals]
    const horizontals = [...snapTargets.horizontals]
    for (const neighbourIndex of [index - 1, index + 1]) {
      const neighbour = points[neighbourIndex]
      if (!neighbour) continue
      const label = neighbour.stationId
        ? (neighbour.name ?? '站點')
        : (neighbourIndex < index ? '上一個點' : '下一個點')
      verticals.push({ value: neighbour.px, from: -Infinity, to: Infinity, slack: 0, label, kind: 'point' })
      horizontals.push({ value: neighbour.py, from: -Infinity, to: Infinity, slack: 0, label, kind: 'point' })
    }

    /*
     * 兩軸要互相迭代一次，不能各自拿原始座標去找。
     *
     * 軌道中心線帶著範圍——點得落在那條軌道的長度內才算數，否則畫面另一頭的軌道
     * 也會把點吸走。麻煩的是<strong>轉角正好落在軌道的端點附近</strong>：滑鼠位置
     * 常常已經超出直軌的下緣一點點，於是直軌被範圍擋掉，x 只好去吸別的東西——
     * 但只要 y 先吸上橫軌，點就回到直軌範圍內了。
     *
     * 先用原始座標各找一次，再拿對方吸附後的值重找。收斂一輪就夠：轉角因此落在
     * 兩條軌道真正的交叉點上，兩段各自剛好水平與垂直。
     */
    const firstHorizontal = nearestLine(horizontals, y, x, tolerance)
    const vertical = nearestLine(verticals, x, firstHorizontal ? firstHorizontal.value : y, tolerance)
    const horizontal = nearestLine(horizontals, y, vertical ? vertical.value : x, tolerance)
    if (vertical || horizontal) {
      return {
        x: vertical ? vertical.value : x,
        y: horizontal ? horizontal.value : y,
        guide: { ...(vertical ? { vertical } : {}), ...(horizontal ? { horizontal } : {}) },
      }
    }

    let closest: { x: number; y: number; distance: number; segment: SnapSegment } | null = null
    for (const segment of snapTargets.segments) {
      const foot = projectOnSegment(x, y, segment)
      if (!foot || foot.distance > tolerance) continue
      if (!closest || foot.distance < closest.distance) closest = { ...foot, segment }
    }
    if (closest) return { x: closest.x, y: closest.y, guide: { segment: closest.segment } }

    return { x, y, guide: {} }
  }

  const startDrag = (e: React.PointerEvent, index: number) => {
    const svg = svgRef.current
    if (!svg || points[index]?.stationId) return
    e.stopPropagation()
    e.preventDefault()
    // 按下去就算選中：放開沒移動就是單純點選，移動了就是拖曳，兩者都留著選取狀態
    setSelected(index)
    setActiveLeg(null)
    const target = e.currentTarget as SVGElement
    target.setPointerCapture(e.pointerId)
    const start = points.map((p) => ({ ...p }))

    const onMove = (ev: PointerEvent) => {
      const raw = toUserSpace(svg, ev.clientX, ev.clientY)
      // 按住 Alt 暫時關掉吸附：偶爾就是要放在中心線以外的地方
      const applied = ev.altKey ? { x: raw.x, y: raw.y, guide: {} } : snap(raw.x, raw.y, index)
      setGuide(applied.guide)
      onChange(start.map((v, i) => (i === index ? { ...v, px: applied.x, py: applied.y } : v)))
    }
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      setGuide(null)
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
    setSelected(null)
  }

  /** 在線段中央插一個折線點，線就分成兩段 */
  const insertOnLeg = (e: React.MouseEvent, legIndex: number) => {
    e.stopPropagation()
    const a = points[legIndex]!
    const b = points[legIndex + 1]!
    const next = [...points]
    // 人一旦動手畫這一段，就不再是「自動找不到路」的佔位線了
    next[legIndex] = { ...a, brokenAhead: false }
    // 新點也吸附一次：中點常常就差幾像素，先擺正比讓人再拖一次省事
    const mid = snap((a.px + b.px) / 2, (a.py + b.py) / 2, legIndex + 1)
    next.splice(legIndex + 1, 0, { px: mid.x, py: mid.y })
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
        {/*
          * 對齊線畫在最底下：它是拖曳當下的輔助，不該蓋住路徑或控制點。
          * 畫滿整張圖的寬（或高），才看得出來現在是跟哪一條軌道對齊。
          * 顏色分兩種——琥珀色＝軌道中心線，紫色＝跟相鄰的點齊平。
          */}
        {guide?.vertical ? (
          <g>
            <line
              x1={guide.vertical.value}
              y1={bounds.top}
              x2={guide.vertical.value}
              y2={bounds.bottom}
              stroke={guide.vertical.kind === 'track' ? '#fbbf24' : '#c084fc'}
              strokeWidth={u(1)}
              strokeDasharray={`${u(6)} ${u(4)}`}
            />
            <text
              x={guide.vertical.value + u(6)}
              y={bounds.top + u(14)}
              fill={guide.vertical.kind === 'track' ? '#fbbf24' : '#c084fc'}
              fontSize={u(11)}
            >
              {guide.vertical.label}
            </text>
          </g>
        ) : null}
        {guide?.horizontal ? (
          <g>
            <line
              x1={bounds.left}
              y1={guide.horizontal.value}
              x2={bounds.right}
              y2={guide.horizontal.value}
              stroke={guide.horizontal.kind === 'track' ? '#fbbf24' : '#c084fc'}
              strokeWidth={u(1)}
              strokeDasharray={`${u(6)} ${u(4)}`}
            />
            <text
              x={bounds.left + u(6)}
              y={guide.horizontal.value - u(6)}
              fill={guide.horizontal.kind === 'track' ? '#fbbf24' : '#c084fc'}
              fontSize={u(11)}
            >
              {guide.horizontal.label}
            </text>
          </g>
        ) : null}
        {guide?.segment ? (
          <g>
            <line
              x1={guide.segment.ax}
              y1={guide.segment.ay}
              x2={guide.segment.bx}
              y2={guide.segment.by}
              stroke="#fbbf24"
              strokeWidth={u(2)}
              strokeDasharray={`${u(6)} ${u(4)}`}
            />
            <text
              x={(guide.segment.ax + guide.segment.bx) / 2 + u(8)}
              y={(guide.segment.ay + guide.segment.by) / 2 - u(8)}
              fill="#fbbf24"
              fontSize={u(11)}
            >
              {guide.segment.label}
            </text>
          </g>
        ) : null}

        {/*
          * 逐段畫，不是一條 polyline：連不起來的那一段要能單獨標成紅虛線。
          * 地圖編輯器就是這樣顯示 brokenLegs 的——那條線是佔位用的，不是真的路徑。
          */}
        {points.slice(0, -1).map((a, i) => {
          const b = points[i + 1]!
          const broken = Boolean(a.brokenAhead)
          return (
            <line
              key={`seg-${i}`}
              x1={a.px}
              y1={a.py}
              x2={b.px}
              y2={b.py}
              stroke={broken ? '#f87171' : '#38bdf8'}
              strokeWidth={u(2.5)}
              strokeLinecap="round"
              strokeDasharray={broken ? `${u(8)} ${u(6)}` : undefined}
            />
          )
        })}

        {/*
          * 車輛虛擬路徑點：等距樣點，只讀。畫在折線之上、控制點之下，
          * 一眼看出車實際走的弦有沒有貼軌道；pointer-events 關掉，不會擋編輯。
          */}
        {vehicleSamples.map((s, i) => (
          <circle
            key={`sample-${i}`}
            cx={s.px}
            cy={s.py}
            r={u(2.2)}
            fill="#fbbf24"
            fillOpacity={0.9}
            stroke="#78350f"
            strokeWidth={u(0.6)}
            style={{ pointerEvents: 'none' }}
          >
            <title>{`車輛路徑點 #${i + 1}（不可編輯）`}</title>
          </circle>
        ))}

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
                setSelected(null)
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
              stroke={selected === i ? '#fbbf24' : stray ? '#fca5a5' : '#fff'}
              strokeWidth={u(selected === i ? 3 : 2)}
              style={{ pointerEvents: 'auto', cursor: 'grab' }}
              onPointerDown={(e) => startDrag(e, i)}
              onContextMenu={(e) => deletePoint(e, i)}
            >
              <title>
                {stray
                  ? '這個點不在任何方塊上，存不進去——拖回軌道或站台範圍內'
                  : '拖曳可改變路徑；點一下選取後按旁邊的 ✕ 或 Delete 刪除'}
              </title>
            </rect>
          )
        })}

        {/*
          * 選中的折線點旁邊長出一個 ✕，按下去直接刪掉——不問、不提示。
          *
          * 畫在點的右上角，離一個控制點寬，這樣 ✕ 不會蓋住點本身，也不會擋到
          * 要拖的方向。位置照螢幕大小算，縮放時跟控制點維持一樣的相對距離。
          */}
        {selected != null && points[selected] && !points[selected]!.stationId
          ? (() => {
              const p = points[selected]!
              const cx = p.px + u(17)
              const cy = p.py - u(17)
              return (
                <g
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                  }}
                  onClick={(e) => deletePoint(e, selected)}
                >
                  <title>刪除這個折線點</title>
                  <circle cx={cx} cy={cy} r={u(10)} fill="#18181b" stroke="#f87171" strokeWidth={u(2)} />
                  <path
                    d={`M ${cx - u(4.5)} ${cy - u(4.5)} L ${cx + u(4.5)} ${cy + u(4.5)}`
                      + ` M ${cx + u(4.5)} ${cy - u(4.5)} L ${cx - u(4.5)} ${cy + u(4.5)}`}
                    stroke="#fca5a5"
                    strokeWidth={u(2.5)}
                    strokeLinecap="round"
                  />
                </g>
              )
            })()
          : null}

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

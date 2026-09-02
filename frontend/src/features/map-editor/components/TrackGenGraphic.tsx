import { useMemo, useState } from 'react'
import { Plus, Route } from 'lucide-react'
import type { LaneCenterlinePlan, RoadInfo } from '../opendrive/laneCenterlines'
import type { TrackGenResult, Vec2 } from '../utils/trackGenerator'

/**
 * 軌道生成元件的內容：只畫<strong>道路中心線</strong>。
 *
 * 這個元件的職責是「載入路網、看清楚載進來的是什麼、按下生成」。生成出來的是
 * 地圖上真正的軌道元件（圓角／斜接／一般軌道），不是這裡的示意圖形——先畫一份
 * 藍色示意方塊、再按一次「套用」把它變成真元件，中間那一層對使用者沒有意義。
 */

type Props = {
  width: number
  height: number
  centerlines: LaneCenterlinePlan | null
  parseFailed: boolean
  result: TrackGenResult | null
  fileName: string | null
  readOnly: boolean
  selected: boolean
  onPickClick: () => void
}

/**
 * 把路網<strong>填滿</strong>元件框：橫向與縱向各自縮放。
 *
 * 不等比。使用者拖出多寬多高，載入的路網就畫成多寬多高——這個元件的框就是他要
 * 的版面比例，等比縮放只會在兩側留下大片空白，反而看不清楚。
 *
 * 留 1 像素的邊：線寬 1.4，不留的話貼著邊界的那幾條會被切掉半條。
 */
function fitTransform(
  points: Vec2[],
  width: number,
  height: number,
  padPx: number,
): { sx: number; sy: number; tx: number; ty: number } {
  if (!points.length) return { sx: 1, sy: 1, tx: 0, ty: 0 }
  let xmin = Infinity
  let ymin = Infinity
  let xmax = -Infinity
  let ymax = -Infinity
  for (const p of points) {
    if (p.x < xmin) xmin = p.x
    if (p.y < ymin) ymin = p.y
    if (p.x > xmax) xmax = p.x
    if (p.y > ymax) ymax = p.y
  }
  const w = Math.max(1e-6, xmax - xmin)
  const h = Math.max(1e-6, ymax - ymin)
  const sx = Math.max(1e-6, width - padPx * 2) / w
  const sy = Math.max(1e-6, height - padPx * 2) / h
  return { sx, sy, tx: padPx - xmin * sx, ty: padPx - ymin * sy }
}

export function TrackGenGraphic({
  width,
  height,
  centerlines,
  parseFailed,
  result,
  fileName,
  readOnly,
  selected,
  onPickClick,
}: Props) {
  const buttonSize = Math.max(28, Math.min(width, height) * 0.14)
  /**
   * 滑過哪一條 road，以及滑鼠在元件內的位置。
   *
   * 卡片跟著滑鼠走：這個元件可以被拉得很長很扁，固定貼在角落的話滑鼠在另一頭時
   * 根本看不到。
   */
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const hoverRoadId = hover?.id ?? null
  /** 量出來的卡片尺寸，用來決定要往左還是往右翻 */
  const [cardSize, setCardSize] = useState({ w: 220, h: 140 })

  const view = useMemo(() => {
    if (!centerlines) return null
    const pts = centerlines.lanes.flatMap((l) => l.points.map((p) => ({ x: p.x, y: -p.y })))
    return fitTransform(pts, width, height, 1)
  }, [centerlines, width, height])

  if (parseFailed) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-rose-500/50 bg-rose-950/20 px-3 text-center">
        <span className="text-xs text-rose-300">OpenDRIVE 解析失敗</span>
        {!readOnly ? (
          <button
            type="button"
            data-trackgen-pick
            onClick={(e) => {
              e.stopPropagation()
              onPickClick()
            }}
            className="text-[11px] text-cyan-300 underline"
          >
            重新選擇檔案
          </button>
        ) : null}
      </div>
    )
  }

  if (!centerlines) {
    return (
      <div className="relative flex size-full flex-col items-center justify-center gap-2 overflow-hidden rounded-sm border border-dashed border-zinc-500/70 bg-zinc-900/20">
        {!readOnly ? (
          <button
            type="button"
            data-trackgen-pick
            title="載入 OpenDRIVE"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onPickClick()
            }}
            className="flex items-center justify-center rounded-full border border-zinc-500/80 bg-zinc-800/90 text-zinc-200 shadow-md transition hover:border-cyan-500/70 hover:bg-zinc-700 hover:text-cyan-100"
            style={{ width: buttonSize, height: buttonSize }}
          >
            <Plus className="size-[55%]" strokeWidth={2.25} aria-hidden />
            <span className="sr-only">載入 OpenDRIVE</span>
          </button>
        ) : (
          <Route
            className="text-zinc-600"
            style={{ width: buttonSize * 0.55, height: buttonSize * 0.55 }}
            aria-hidden
          />
        )}
        <span className="pointer-events-none select-none px-3 text-center text-[11px] text-zinc-500">
          {readOnly ? '尚未載入路網' : '點擊或拖曳 .xodr 至此'}
        </span>
      </div>
    )
  }

  const sx = view?.sx ?? 1
  const sy = view?.sy ?? 1
  const tx = view?.tx ?? 0
  const ty = view?.ty ?? 0
  const T = (p: Vec2) => `${(p.x * sx + tx).toFixed(1)},${(p.y * sy + ty).toFixed(1)}`

  /*
   * 逐 road 畫，不是逐車道。
   *
   * road 是 OpenDRIVE 本來的單位：一條 road 有自己的 id、長度、屬於哪個 junction、
   * 前後接誰、左右各有哪些車道。以它為單位畫，使用者才點得到「一條路」而不是
   * 「一條車道」，也才看得出這張圖是由幾段路組成的。
   */
  const laneByRoad = new Map<string, LaneCenterlinePlan['lanes']>()
  for (const lane of centerlines.lanes) {
    const list = laneByRoad.get(lane.roadId)
    if (list) list.push(lane)
    else laneByRoad.set(lane.roadId, [lane])
  }
  const hoveredRoad: RoadInfo | null =
    centerlines.roads.find((r) => r.id === hoverRoadId) ?? null

  return (
    <div className="relative size-full overflow-hidden rounded-sm border border-zinc-600/60 bg-zinc-950/45">
      <svg width={width} height={height} className="block">
        {centerlines.roads.map((road) => {
          const lanesOfRoad = laneByRoad.get(road.id) ?? []
          const inJunction = road.junctionId !== '-1'
          const active = hoverRoadId === road.id
          return (
            <g
              key={road.id}
              onPointerMove={(e) => {
                const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect()
                if (!box || box.width < 1) return
                /*
                 * 換算回元件的本地座標。
                 *
                 * 卡片是這個容器的子元素，而容器被地圖縮放過；直接拿螢幕像素去設
                 * left/top，滑鼠移了幾百像素卡片才動幾十——實測滑鼠從 96 移到 885，
                 * 卡片只從 19 移到 59。
                 */
                const scale = box.width / Math.max(1, width)
                setHover({
                  id: road.id,
                  x: (e.clientX - box.left) / scale,
                  y: (e.clientY - box.top) / scale,
                })
              }}
              onPointerLeave={() => setHover((v) => (v?.id === road.id ? null : v))}
              style={{ cursor: 'pointer' }}
            >
              {/* 加粗的透明線只為了好按到——中心線本身太細，滑鼠很難命中 */}
              {lanesOfRoad.map((lane) => (
                <polyline
                  key={`hit-${lane.key}`}
                  points={lane.points.map((p) => T({ x: p.x, y: -p.y })).join(' ')}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={10}
                  strokeLinecap="round"
                />
              ))}
              {lanesOfRoad.map((lane) => (
                <polyline
                  key={lane.key}
                  points={lane.points.map((p) => T({ x: p.x, y: -p.y })).join(' ')}
                  fill="none"
                  stroke={active ? '#34d399' : inJunction ? '#c08a48' : '#7f9ec2'}
                  strokeWidth={active ? 3 : 1.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={active ? 1 : 0.9}
                />
              ))}
            </g>
          )
        })}
      </svg>

      {hoveredRoad && hover ? (
        <div
          ref={(el) => {
            if (!el) return
            // 量到的也是螢幕像素，同樣要換回本地座標才能跟 left/top 比
            const r = el.getBoundingClientRect()
            const box = el.parentElement?.getBoundingClientRect()
            const scale = box && box.width > 1 ? box.width / Math.max(1, width) : 1
            const wLocal = r.width / scale
            const hLocal = r.height / scale
            if (Math.abs(wLocal - cardSize.w) > 1 || Math.abs(hLocal - cardSize.h) > 1) {
              setCardSize({ w: wLocal, h: hLocal })
            }
          }}
          className="pointer-events-none absolute z-[3] max-w-[250px] rounded-md border border-emerald-500/60 bg-zinc-900/95 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-300 shadow-lg"
          style={{
            // 預設放在滑鼠右下，靠近邊界就翻到另一邊，卡片才不會被切掉
            left: Math.max(
              4,
              hover.x + 14 + cardSize.w > width ? hover.x - 14 - cardSize.w : hover.x + 14,
            ),
            top: Math.max(
              4,
              hover.y + 14 + cardSize.h > height ? hover.y - 14 - cardSize.h : hover.y + 14,
            ),
          }}
        >
          <div className="mb-1 font-medium text-emerald-300">
            road {hoveredRoad.id}
            {hoveredRoad.name && hoveredRoad.name !== hoveredRoad.id
              ? ` · ${hoveredRoad.name}`
              : ''}
          </div>
          <div>
            長度{' '}
            <b className="font-mono tabular-nums text-zinc-100">
              {hoveredRoad.lengthM.toFixed(1)} m
            </b>
            {hoveredRoad.junctionId !== '-1' ? (
              <span className="text-amber-300">{` · junction ${hoveredRoad.junctionId}`}</span>
            ) : null}
          </div>
          <div>
            方位{' '}
            <b className="font-mono tabular-nums text-zinc-100">
              {hoveredRoad.headingFromDeg.toFixed(0)}° → {hoveredRoad.headingToDeg.toFixed(0)}°
            </b>
          </div>
          <div>
            前接{' '}
            <b className="font-mono text-zinc-100">
              {hoveredRoad.predecessor
                ? `${hoveredRoad.predecessor.type} ${hoveredRoad.predecessor.id}`
                : '—'}
            </b>
            {' · 後接 '}
            <b className="font-mono text-zinc-100">
              {hoveredRoad.successor
                ? `${hoveredRoad.successor.type} ${hoveredRoad.successor.id}`
                : '—'}
            </b>
          </div>
          <div className="mt-1 border-t border-zinc-700/70 pt-1">
            車道（左正右負）
            {hoveredRoad.lanes.map((l) => (
              <div key={l.id} className="font-mono tabular-nums">
                {l.id > 0 ? `+${l.id}` : l.id}{' '}
                <span className={l.type === 'driving' ? 'text-emerald-300' : 'text-zinc-500'}>
                  {l.type}
                </span>
                {l.widthM > 0 ? ` ${l.widthM.toFixed(2)} m` : ''}
                {l.mmslLaneId ? ` · mmsl ${l.mmslLaneId}` : ''}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {selected ? (
        <div className="pointer-events-none absolute left-2 top-2 z-[2] rounded-md border border-zinc-600/70 bg-zinc-900/85 px-2 py-1 text-[10px] text-zinc-400">
          {`${centerlines.roads.length} 條 road · ${centerlines.laneCount} 車道${fileName ? ` · ${fileName}` : ''}`}
          {result ? ` ｜ 已生成 ${result.lines.length} 條線到地圖上` : ''}
        </div>
      ) : null}

      {!readOnly && selected ? (
        <button
          type="button"
          data-trackgen-pick
          title="更換 OpenDRIVE"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onPickClick()
          }}
          className="absolute bottom-2 right-2 z-[2] rounded-md border border-zinc-500/80 bg-zinc-900/90 px-2 py-1 text-[11px] text-zinc-200 shadow-md transition hover:border-cyan-500/70 hover:text-cyan-100"
        >
          更換路網
        </button>
      ) : null}
    </div>
  )
}

import { useMemo } from 'react'
import { Plus, Route } from 'lucide-react'
import type { LaneCenterlinePlan } from '../opendrive/laneCenterlines'
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

function fitTransform(
  points: Vec2[],
  width: number,
  height: number,
  padPx: number,
): { scale: number; tx: number; ty: number } {
  if (!points.length) return { scale: 1, tx: 0, ty: 0 }
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
  const scale = Math.min((width - padPx * 2) / w, (height - padPx * 2) / h)
  return {
    scale,
    tx: padPx - xmin * scale + (width - padPx * 2 - w * scale) / 2,
    ty: padPx - ymin * scale + (height - padPx * 2 - h * scale) / 2,
  }
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

  const view = useMemo(() => {
    if (!centerlines) return null
    const pts = centerlines.lanes.flatMap((l) => l.points.map((p) => ({ x: p.x, y: -p.y })))
    return fitTransform(pts, width, height, 10)
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

  const sc = view?.scale ?? 1
  const tx = view?.tx ?? 0
  const ty = view?.ty ?? 0
  const T = (p: Vec2) => `${(p.x * sc + tx).toFixed(1)},${(p.y * sc + ty).toFixed(1)}`

  return (
    <div className="relative size-full overflow-hidden rounded-sm border border-zinc-600/60 bg-zinc-950/45">
      <svg width={width} height={height} className="block">
        {centerlines.lanes.map((lane) => (
          <polyline
            key={lane.key}
            points={lane.points.map((p) => T({ x: p.x, y: -p.y })).join(' ')}
            fill="none"
            stroke={lane.inJunction ? '#c08a48' : '#7f9ec2'}
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.9}
          />
        ))}
      </svg>

      {selected ? (
        <div className="pointer-events-none absolute left-2 top-2 z-[2] rounded-md border border-zinc-600/70 bg-zinc-900/85 px-2 py-1 text-[10px] text-zinc-400">
          {`中心線 ${centerlines.roadCount} 道路 · ${centerlines.laneCount} 車道${fileName ? ` · ${fileName}` : ''}`}
          {result
            ? ` ｜ 已生成 ${result.blocks.length * 2} 塊軌道 · ${result.lanes.filter((l) => l.role === 'crossover').length} 渡線 · ${result.lanes.filter((l) => l.role === 'siding').length} 側線到地圖上`
            : ''}
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

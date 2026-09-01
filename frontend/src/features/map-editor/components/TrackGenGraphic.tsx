import { useMemo } from 'react'
import { Plus, Route } from 'lucide-react'
import type { LaneCenterlinePlan } from '../opendrive/laneCenterlines'
import {
  placePoint,
  placeSpine,
  type TrackGenSettings,
} from '../utils/trackGenFacility'
import type { LaneRole, TrackGenResult, Vec2 } from '../utils/trackGenerator'

/**
 * 軌道生成元件的內容。
 *
 * 三種狀態：尚未載入（顯示 ＋）、已載入但未生成（只畫車道中心線）、已生成
 * （畫出上下行軌道、渡線與側線）。中心線先畫出來，是為了讓使用者在按下生成
 * 之前就能確認載進來的是不是對的路網。
 */

const LANE_W_M = 3.35

const ROLE_STROKE: Record<LaneRole, string> = {
  down: '#7f9ec2',
  up: '#5b82ad',
  crossover: '#c08a48',
  siding: '#9c8560',
}

type Props = {
  width: number
  height: number
  centerlines: LaneCenterlinePlan | null
  parseFailed: boolean
  result: TrackGenResult | null
  settings: TrackGenSettings
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
  settings,
  fileName,
  readOnly,
  selected,
  onPickClick,
}: Props) {
  const buttonSize = Math.max(28, Math.min(width, height) * 0.14)

  /**
   * 已生成的軌道。
   *
   * 每一塊都畫成<strong>封閉多邊形</strong>而不是一條粗線。相鄰兩塊共用同一組端點，
   * 所以接縫處是完全貼合的；粗線的做法在橫向偏移改變的地方會撕出裂縫與尖角，
   * 那正是先前看起來破碎的原因。
   *
   * 三種形狀對應三種軌道元件：直線段是矩形、彎道是環狀扇形、渡線與側線是
   * 兩端各自有寬度的四邊形。
   */
  const generated = useMemo(() => {
    if (!result || !result.spine.length) return null
    // 沿線固定 1 px/m：整體尺寸交給 fitTransform，由元件大小決定。
    const placed = placeSpine(result.spine, 1, settings.cornerRadiusM)
    const lt = settings.lateralScale
    const halfW = (LANE_W_M / 2) * lt

    type Poly = { role: LaneRole; key: string; pts: Vec2[] }
    const polys: Poly[] = []
    const labels: Array<{ at: Vec2; text: string; angle: number }> = []
    const seams: Array<{ a: Vec2; b: Vec2 }> = []

    /** 沿里程取一段的左右緣，組成封閉四邊形；彎道多取幾個中間點讓弧平滑 */
    const bandPolygon = (
      sFrom: number,
      sTo: number,
      latAt: (s: number) => number,
      steps: number,
    ): Vec2[] => {
      const left: Vec2[] = []
      const right: Vec2[] = []
      for (let i = 0; i <= steps; i += 1) {
        const s = sFrom + ((sTo - sFrom) * i) / steps
        const lat = latAt(s)
        left.push(placePoint(s, lat + LANE_W_M / 2, placed, lt))
        right.push(placePoint(s, lat - LANE_W_M / 2, placed, lt))
      }
      return [...left, ...right.reverse()]
    }

    for (const b of result.blocks) {
      const onArc = b.spineKind === 'arc'
      const steps = onArc ? 10 : 1
      for (const [lat, name, role] of [
        [0, b.nameDown, 'down'],
        [b.lateralM, b.nameUp, 'up'],
      ] as Array<[number, string, LaneRole]>) {
        polys.push({
          role,
          key: `${name}`,
          pts: bandPolygon(b.sFrom, b.sTo, () => lat, steps),
        })
        // 接縫線：畫在每塊的起點，讓相鄰塊看得出是兩個物件
        const p0 = placePoint(b.sFrom, lat + LANE_W_M / 2, placed, lt)
        const p1 = placePoint(b.sFrom, lat - LANE_W_M / 2, placed, lt)
        seams.push({ a: p0, b: p1 })
        if (settings.labelSizePx > 0) {
          const mid = placePoint((b.sFrom + b.sTo) / 2, lat, placed, lt)
          const e0 = placePoint(b.sFrom, lat, placed, lt)
          const e1 = placePoint(b.sTo, lat, placed, lt)
          const deg = (Math.atan2(e1.y - e0.y, e1.x - e0.x) * 180) / Math.PI
          labels.push({ at: mid, text: name, angle: deg > 90 || deg < -90 ? deg + 180 : deg })
        }
      }
    }

    // 渡線與側線：橫向偏移沿里程改變，所以自然是斜的四邊形
    for (const lane of result.lanes) {
      if (lane.role === 'down' || lane.role === 'up') continue
      if (lane.role === 'crossover' && !settings.showCrossovers) continue
      if (lane.role === 'siding' && !settings.showSidings) continue
      const prof = lane.profile
      if (prof.length < 2) continue
      const left: Vec2[] = []
      const right: Vec2[] = []
      for (const [s, lat] of prof) {
        left.push(placePoint(s, lat + LANE_W_M / 2, placed, lt))
        right.push(placePoint(s, lat - LANE_W_M / 2, placed, lt))
      }
      polys.push({ role: lane.role, key: lane.key, pts: [...left, ...right.reverse()] })
    }

    const extent = polys.flatMap((p) => p.pts)
    const blockSpanM = result.blocks[0]?.lengthM ?? 50
    return { polys, labels, seams, thick: halfW * 2, extent, blockSpanPx: blockSpanM }
  }, [result, settings])

  const view = useMemo(() => {
    if (generated) return fitTransform(generated.extent, width, height, 10 + generated.thick / 2)
    if (centerlines) {
      const pts = centerlines.lanes.flatMap((l) => l.points.map((p) => ({ x: p.x, y: -p.y })))
      return fitTransform(pts, width, height, 10)
    }
    return null
  }, [generated, centerlines, width, height])

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

  const T = (p: Vec2) => `${(p.x * (view?.scale ?? 1) + (view?.tx ?? 0)).toFixed(1)},${(p.y * (view?.scale ?? 1) + (view?.ty ?? 0)).toFixed(1)}`

  return (
    <div className="relative size-full overflow-hidden rounded-sm border border-zinc-600/60 bg-zinc-950/45">
      <svg width={width} height={height} className="block">
        {generated ? (
          <>
            {(['siding', 'crossover', 'down', 'up'] as LaneRole[]).map((role) =>
              generated.polys
                .filter((p) => p.role === role)
                .map((p) => (
                  <polygon
                    key={`${role}-${p.key}`}
                    points={p.pts.map(T).join(' ')}
                    fill={ROLE_STROKE[role]}
                    stroke={ROLE_STROKE[role]}
                    strokeWidth={0.5}
                    strokeLinejoin="round"
                  />
                )),
            )}
            {generated.seams.map((s, i) => (
              <line
                key={`seam-${i}`}
                x1={s.a.x * (view?.scale ?? 1) + (view?.tx ?? 0)}
                y1={s.a.y * (view?.scale ?? 1) + (view?.ty ?? 0)}
                x2={s.b.x * (view?.scale ?? 1) + (view?.tx ?? 0)}
                y2={s.b.y * (view?.scale ?? 1) + (view?.ty ?? 0)}
                stroke="#0b1020"
                strokeWidth={1}
                opacity={0.45}
              />
            ))}
            {generated.labels.map((l, i) => {
              const x = l.at.x * (view?.scale ?? 1) + (view?.tx ?? 0)
              const y = l.at.y * (view?.scale ?? 1) + (view?.ty ?? 0)
              const size = settings.labelSizePx
              const spanPx = generated.blockSpanPx * (view?.scale ?? 1)
              if (size < 5 || spanPx < size * 2.1) return null
              return (
                <text
                  key={`lb-${i}`}
                  x={x}
                  y={y + size * 0.35}
                  fill="#0b1020"
                  fontSize={size}
                  textAnchor="middle"
                  fontFamily="ui-monospace, monospace"
                  transform={`rotate(${l.angle.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})`}
                >
                  {l.text}
                </text>
              )
            })}
          </>
        ) : (
          centerlines.lanes.map((lane) => (
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
          ))
        )}
      </svg>

      {selected ? (
        <div className="pointer-events-none absolute left-2 top-2 z-[2] rounded-md border border-zinc-600/70 bg-zinc-900/85 px-2 py-1 text-[10px] text-zinc-400">
          {result
            ? `已生成 · ${result.blocks.length * 2} 塊軌道 · ${result.lanes.filter((l) => l.role === 'crossover').length} 渡線 · ${result.lanes.filter((l) => l.role === 'siding').length} 側線`
            : `中心線 · ${centerlines.roadCount} 道路 · ${centerlines.laneCount} 車道${fileName ? ` · ${fileName}` : ''}`}
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

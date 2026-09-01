import { useMemo } from 'react'
import { Plus, Route } from 'lucide-react'
import type { LaneCenterlinePlan } from '../opendrive/laneCenterlines'
import type { TrackGenSettings } from '../utils/trackGenFacility'
import { LANE_W_M, layoutTrackGen, rectPolygon } from '../utils/trackGenLayout'
import {
  cornerArcCentrePx,
  cornerTrackEndsPx,
  cornerTrackPath,
  taperTrackPath,
} from '../utils/trackShapes'
import type { LaneRole, TrackGenResult, Vec2 } from '../utils/trackGenerator'

/**
 * 軌道生成元件的內容。
 *
 * 兩種狀態：尚未載入（顯示 ＋）、已載入（直接畫出生成的軌道）。載入 .xodr 之後
 * 立刻生成，中間不再多一步——使用者要的是軌道，中心線只是中繼產物。
 *
 * <h3>形狀由元件自己算</h3>
 * 彎道與斜接段的填色外框直接呼叫 {@link cornerTrackPath} 與 {@link taperTrackPath}，
 * 也就是「套用到地圖」之後那些真正的軌道元件在用的同一支。預覽自己描一條帶子的
 * 話，兩邊的角度慣例一有出入，畫面上好看、套用出來卻是散的——發生過。
 */

const ROLE_FILL: Record<LaneRole, string> = {
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

type Drawn =
  | { kind: 'poly'; role: LaneRole; key: string; pts: Vec2[]; z: number }
  | {
      kind: 'path'
      role: LaneRole
      key: string
      /** 未縮放的方框（版面公尺） */
      box: { xM: number; yM: number; wM: number; hM: number }
      /** 給定像素尺寸後產生填色外框 */
      d: (wPx: number, hPx: number) => string
      z: number
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

  const generated = useMemo(() => {
    if (!result || !result.spine.length) return null
    const layout = layoutTrackGen(result, settings)
    const drawn: Drawn[] = []
    const labels: Array<{ at: Vec2; text: string; angle: number }> = []
    const extent: Vec2[] = []
    let minBlockLen = Infinity

    for (const s of layout.shapes) {
      if (s.kind === 'rect') {
        const pts = rectPolygon(s)
        drawn.push({ kind: 'poly', role: s.role, key: s.name, pts, z: 3000 })
        extent.push(...pts)
        // 只拿主線的區塊來決定字級門檻：轉角旁邊被裁短的側線殘段只有幾公尺，
        // 拿它當門檻會把整張圖的標籤全部關掉
        if (s.role === 'down' || s.role === 'up') {
          minBlockLen = Math.min(minBlockLen, s.lengthM)
        }
        const deg = s.rotationDeg
        labels.push({ at: s.centre, text: s.name, angle: deg > 90 || deg < -90 ? deg + 180 : deg })
        continue
      }
      const box = s.box
      extent.push({ x: box.xM, y: box.yM }, { x: box.xM + box.wM, y: box.yM + box.hM })
      if (s.kind === 'corner') {
        drawn.push({
          kind: 'path',
          role: s.role,
          key: s.name,
          box,
          d: (w, h) => cornerTrackPath(s.geometry, w, h),
          z: 2500,
        })
        /*
         * 標籤放在弧帶的正中央，不是方框中央。
         *
         * 上下行的方框同心但大小不同，兩個中央離得很近，標籤會疊在一起；弧帶
         * 中央本來就分得開，也才真的落在軌道上。
         */
        const c = cornerArcCentrePx(s.geometry.entryDeg, box.wM, box.hM)
        const ends = cornerTrackEndsPx(s.geometry, box.wM, box.hM)
        const mx = (ends.a.x + ends.b.x) / 2 - c.x
        const my = (ends.a.y + ends.b.y) / 2 - c.y
        const m = Math.hypot(mx, my) || 1
        const midR = box.wM * (1 - s.geometry.depthRatio / 2)
        labels.push({
          at: { x: box.xM + c.x + (mx / m) * midR, y: box.yM + c.y + (my / m) * midR },
          text: s.name,
          angle: 0,
        })
      } else {
        drawn.push({
          kind: 'path',
          role: s.role,
          key: s.name,
          box,
          d: (w, h) => taperTrackPath(s.geometry, w, h),
          z: 1000,
        })
      }
    }

    drawn.sort((a, b) => a.z - b.z)
    return {
      drawn,
      labels,
      thick: LANE_W_M * settings.lateralScale,
      extent,
      blockSpanPx: Number.isFinite(minBlockLen) ? minBlockLen : 50,
    }
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

  const sc = view?.scale ?? 1
  const tx = view?.tx ?? 0
  const ty = view?.ty ?? 0
  const T = (p: Vec2) => `${(p.x * sc + tx).toFixed(1)},${(p.y * sc + ty).toFixed(1)}`

  /*
   * 中心線一律畫出來。
   *
   * 生成之後也留著，淡淡地墊在軌道底下：那是判斷「載進來的路網對不對」唯一的
   * 依據，看不到就只能相信生成結果。生成前它是主角，生成後降成對照。
   */
  const centerlineStroke = generated ? 0.7 : 1.4
  const centerlineOpacity = generated ? 0.32 : 0.9
  const centerView = generated
    ? fitTransform(
        centerlines.lanes.flatMap((l) => l.points.map((p) => ({ x: p.x, y: -p.y }))),
        width,
        height,
        10,
      )
    : view
  const CT = (p: Vec2) =>
    `${(p.x * (centerView?.scale ?? 1) + (centerView?.tx ?? 0)).toFixed(1)},${(p.y * (centerView?.scale ?? 1) + (centerView?.ty ?? 0)).toFixed(1)}`

  return (
    <div className="relative size-full overflow-hidden rounded-sm border border-zinc-600/60 bg-zinc-950/45">
      <svg width={width} height={height} className="block">
        {centerlines.lanes.map((lane) => (
          <polyline
            key={`c-${lane.key}`}
            points={lane.points.map((p) => CT({ x: p.x, y: -p.y })).join(' ')}
            fill="none"
            stroke={lane.inJunction ? '#c08a48' : '#7f9ec2'}
            strokeWidth={centerlineStroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={centerlineOpacity}
          />
        ))}
        {generated ? (
          <>
            {generated.drawn.map((p, i) =>
              p.kind === 'poly' ? (
                <polygon
                  key={`${p.key}-${i}`}
                  points={p.pts.map(T).join(' ')}
                  fill={ROLE_FILL[p.role]}
                  stroke={ROLE_FILL[p.role]}
                  strokeWidth={0.5}
                  strokeLinejoin="round"
                />
              ) : (
                <path
                  key={`${p.key}-${i}`}
                  d={p.d(p.box.wM * sc, p.box.hM * sc)}
                  transform={`translate(${(p.box.xM * sc + tx).toFixed(1)} ${(p.box.yM * sc + ty).toFixed(1)})`}
                  fill={ROLE_FILL[p.role]}
                  stroke={ROLE_FILL[p.role]}
                  strokeWidth={0.5}
                  strokeLinejoin="round"
                />
              ),
            )}
            {generated.labels.map((l, i) => {
              const x = l.at.x * sc + tx
              const y = l.at.y * sc + ty
              const size = settings.labelSizePx
              const spanPx = generated.blockSpanPx * sc
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
        ) : null}
      </svg>

      {selected ? (
        <div className="pointer-events-none absolute left-2 top-2 z-[2] rounded-md border border-zinc-600/70 bg-zinc-900/85 px-2 py-1 text-[10px] text-zinc-400">
          {`中心線 ${centerlines.roadCount} 道路 · ${centerlines.laneCount} 車道${fileName ? ` · ${fileName}` : ''}`}
          {result
            ? ` ｜ 已生成 ${result.blocks.length * 2} 塊軌道 · ${result.lanes.filter((l) => l.role === 'crossover').length} 渡線 · ${result.lanes.filter((l) => l.role === 'siding').length} 側線`
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

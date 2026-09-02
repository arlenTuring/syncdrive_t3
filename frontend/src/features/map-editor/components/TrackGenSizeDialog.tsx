import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * 生成前先決定「一塊軌道多大」。
 *
 * <h3>為什麼要有這一步</h3>
 * 目標是用簡單明瞭的幾何表示這個場域，不是把真實路網模擬得很像。既然如此，一塊
 * 軌道畫多長多寬就該由使用者決定，而不是從 .xodr 的公尺數推。使用者在意的是
 * 「在我的畫布上這塊看起來多大」，所以這裡的單位一律是<strong>畫布像素</strong>。
 *
 * <h3>背景是畫布的等比縮圖</h3>
 * 光給數字感覺不出大小，所以背景畫一個依畫布長寬等比縮小的框，示意軌道就放在裡面。
 * 橫三塊、縱三塊各擺一排——單看一塊看不出並排起來會多擠。改任何一塊，其他八塊
 * 跟著動。
 */

export type TrackGenSizeParams = {
  /** 一塊軌道的長度（畫布像素） */
  blockLengthPx: number
  /** 一塊軌道的寬度（畫布像素） */
  blockWidthPx: number
  /** 一塊軌道代表多少公尺的路 */
  metersPerBlock: number
}

type Props = {
  open: boolean
  /** 畫布尺寸（像素），用來畫等比縮圖 */
  canvasPx: { width: number; height: number }
  /** 這份路網總長（公尺），用來估會生出幾塊 */
  totalM: number
  initial: TrackGenSizeParams
  onCancel: () => void
  onConfirm: (params: TrackGenSizeParams) => void
}

const MIN_LEN = 8
const MIN_WID = 4

function NumberField({
  label,
  value,
  suffix,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  suffix: string
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-zinc-400">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={Math.round(value)}
          min={min}
          max={max}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)))
          }}
          className="w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[12px] tabular-nums text-zinc-100 focus:border-cyan-500 focus:outline-none"
        />
        <span className="text-[11px] text-zinc-500">{suffix}</span>
      </div>
    </label>
  )
}

export function TrackGenSizeDialog(props: Props) {
  if (!props.open) return null
  // 每次開啟都是新的一份：用 key 重掛比在 effect 裡同步狀態乾淨
  return <SizeDialogBody {...props} />
}

function SizeDialogBody({ canvasPx, totalM, initial, onCancel, onConfirm }: Props) {
  const [params, setParams] = useState<TrackGenSizeParams>(initial)

  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    axis: 'length' | 'width' | 'both'
    startX: number
    startY: number
    base: TrackGenSizeParams
    /** 縮圖的縮小倍率，拖曳量要換回畫布像素 */
    scale: number
  } | null>(null)

  /*
   * 縮圖要盡量大。
   *
   * 畫布可能有兩千多像素寬，縮圖只給 520 的話一塊 90 像素的軌道畫出來只剩 18——
   * 螞蟻才看得到，根本沒辦法判斷大小。所以吃滿視窗：畫布放得下就 1:1，放不下才
   * 等比縮，並把縮小倍率寫出來，使用者才知道自己在看的是幾成大小。
   */
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === 'undefined' ? 1280 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  }))
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const canvasW = Math.max(1, Math.round(canvasPx.width))
  const canvasH = Math.max(1, Math.round(canvasPx.height))
  // 對話框本身的留白與其他區塊大約吃掉這些
  const availW = Math.max(320, Math.min(1600, viewport.w * 0.94) - 56)
  const availH = Math.max(160, viewport.h * 0.94 - 320)
  const scale = Math.min(1, availW / canvasW, availH / canvasH)
  const stageW = Math.round(canvasW * scale)
  const stageH = Math.round(canvasH * scale)

  const onPointerDown = useCallback(
    (axis: 'length' | 'width' | 'both', e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = {
        axis,
        startX: e.clientX,
        startY: e.clientY,
        base: params,
        scale,
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    },
    [params, scale],
  )

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragRef.current
    if (!st) return
    const dx = (e.clientX - st.startX) / Math.max(0.01, st.scale)
    const dy = (e.clientY - st.startY) / Math.max(0.01, st.scale)
    setParams((p) => ({
      ...p,
      blockLengthPx:
        st.axis === 'width' ? p.blockLengthPx : Math.max(MIN_LEN, st.base.blockLengthPx + dx),
      blockWidthPx:
        st.axis === 'length' ? p.blockWidthPx : Math.max(MIN_WID, st.base.blockWidthPx + dy),
    }))
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  const lenPx = Math.round(params.blockLengthPx)
  const widPx = Math.round(params.blockWidthPx)
  const blocks = Math.max(1, Math.round(totalM / Math.max(1, params.metersPerBlock)))

  /** 示意用：橫三塊一排、縱三塊一排，讓人看得出並排起來的樣子 */
  const pad = Math.round(Math.min(40, stageW * 0.04))
  const vCol = Math.round(stageW * 0.55)
  const sample = (i: number, vertical: boolean) => {
    const w = (vertical ? widPx : lenPx) * scale
    const h = (vertical ? lenPx : widPx) * scale
    const gap = Math.max(1, 2 * scale)
    return {
      width: w,
      height: h,
      left: vertical ? vCol + i * (w + gap) : pad,
      top: vertical ? pad : pad + i * (h + gap),
    }
  }

  /*
   * 一定要 portal 到 body。
   *
   * 這個對話框掛在圖台節點底下，而圖台外層帶著縮放用的 transform。有 transform 的
   * 祖先會變成 fixed 的定位基準，所以 `fixed inset-0` 不是貼齊視窗、而是貼齊那個被
   * 縮放過的容器——量出來對話框被連帶縮成 0.898 倍，還被推到畫面下緣切掉一半。
   */
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="flex max-h-full flex-col gap-3 overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"
        style={{ width: Math.max(360, stageW + 42) }}
        data-trackgen-size-dialog
      >
        <div>
          <div className="text-base font-medium text-zinc-100">一塊軌道要多大</div>
          <p className="mt-1 text-[12px] leading-snug text-zinc-500">
            背景是畫布 {canvasW} × {canvasH} px
            {scale >= 0.999
              ? '，以原尺寸顯示'
              : `，縮到 ${(scale * 100).toFixed(0)}% 顯示`}
            。拖曳示意軌道的把手改大小，橫三塊、縱三塊會一起變——並排起來多擠，看這裡最準。
          </p>
        </div>

        <div
          ref={stageRef}
          className="relative shrink-0 self-center overflow-hidden rounded-md border border-cyan-500/40 bg-zinc-900"
          style={{ width: stageW, height: stageH }}
        >
          {[0, 1, 2].map((i) => {
            const s = sample(i, false)
            return (
              <div
                key={`h${i}`}
                className="absolute rounded-[1px] border border-sky-300/70 bg-sky-400/35"
                style={{ left: s.left, top: s.top, width: s.width, height: s.height }}
              />
            )
          })}
          {[0, 1, 2].map((i) => {
            const s = sample(i, true)
            return (
              <div
                key={`v${i}`}
                className="absolute rounded-[1px] border border-emerald-300/70 bg-emerald-400/30"
                style={{ left: s.left, top: s.top, width: s.width, height: s.height }}
              />
            )
          })}

          {/* 只有第一塊帶把手，其他八塊跟著動 */}
          <div
            className="absolute"
            style={{ left: pad, top: pad, width: lenPx * scale, height: widPx * scale }}
          >
            <div
              data-trackgen-size-handle="both"
              className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize touch-none rounded-sm border-2 border-cyan-300 bg-zinc-900"
              onPointerDown={(e) => onPointerDown('both', e)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            <div
              data-trackgen-size-handle="length"
              className="absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 cursor-ew-resize touch-none rounded-sm border-2 border-cyan-300 bg-zinc-900"
              onPointerDown={(e) => onPointerDown('length', e)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            <div
              data-trackgen-size-handle="width"
              className="absolute -bottom-1.5 left-1/2 size-3 -translate-x-1/2 cursor-ns-resize touch-none rounded-sm border-2 border-cyan-300 bg-zinc-900"
              onPointerDown={(e) => onPointerDown('width', e)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>

          <div className="pointer-events-none absolute bottom-1.5 right-3 font-mono text-[13px] tabular-nums text-cyan-300">
            {lenPx} × {widPx} px
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <NumberField
            label="軌道長度"
            value={params.blockLengthPx}
            suffix="px"
            min={MIN_LEN}
            max={2000}
            onChange={(v) => setParams((p) => ({ ...p, blockLengthPx: v }))}
          />
          <NumberField
            label="軌道寬度"
            value={params.blockWidthPx}
            suffix="px"
            min={MIN_WID}
            max={2000}
            onChange={(v) => setParams((p) => ({ ...p, blockWidthPx: v }))}
          />
          <NumberField
            label="一塊代表"
            value={params.metersPerBlock}
            suffix="公尺"
            min={1}
            max={2000}
            onChange={(v) => setParams((p) => ({ ...p, metersPerBlock: v }))}
          />
        </div>

        <div className="rounded-md border border-zinc-700/70 bg-zinc-900/60 px-3 py-2 text-[11px] text-zinc-400">
          路網總長{' '}
          <b className="font-mono tabular-nums text-zinc-200">{totalM.toFixed(0)} m</b>
          {' · 一塊 '}
          <b className="font-mono tabular-nums text-zinc-200">{params.metersPerBlock} m</b>
          {' → 約 '}
          <b className="font-mono tabular-nums text-zinc-200">{blocks}</b> 塊
          {'，一條線攤開約 '}
          <b className="font-mono tabular-nums text-zinc-200">
            {Math.round(blocks * params.blockLengthPx)}
          </b>{' '}
          px
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-600 px-3 py-1.5 text-[12px] text-zinc-300 transition hover:border-zinc-400 hover:text-zinc-100"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(params)}
            className="rounded-md border border-cyan-500/70 bg-cyan-500/15 px-3 py-1.5 text-[12px] text-cyan-200 transition hover:bg-cyan-500/25"
          >
            開始生成
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

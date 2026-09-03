import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { TrackGenBlockSize } from '../utils/trackGenFacility'

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
 * 橫的五塊相連、縱的兩塊接下來，排成 L 形——場域本來就是折的，兩軸各自看才準。
 *
 * <h3>橫縱的公尺數分開</h3>
 * 畫布通常又寬又扁，而場域是折起來的。同一個公尺數套在兩軸上時，橫向還很寬鬆、
 * 縱向早就滿了。分開之後縱向可以壓得比橫向兇，整張圖才塞得進扁畫布。
 */

export type TrackGenSizeParams = TrackGenBlockSize

type Props = {
  open: boolean
  /** 畫布尺寸（像素），用來畫等比縮圖 */
  canvasPx: { width: number; height: number }
  /** 脊線上橫的路與縱的路各幾公尺，用來估兩軸各生幾塊 */
  totals?: { xM: number; yM: number }
  initial: TrackGenSizeParams
  /**
   * 這組參數排出來會佔多大（畫布像素）。回傳 null 表示還算不出來。
   *
   * 排版對這兩個尺度是<strong>齊次</strong>的：長度與寬度同時乘上 k，整份版面就等比
   * 放大 k 倍（塊數只由「一塊代表幾公尺」決定，不受 k 影響）。所以「縮到塞得下」
   * 一次除法就求得出來，不必二分搜尋。
   */
  measure?: (params: TrackGenSizeParams) => { wPx: number; hPx: number } | null
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

/**
 * 把「一塊多大」縮到整份版面塞得進畫布。
 *
 * 排版對這兩個尺度是<strong>齊次</strong>的：長度與寬度同時乘上 k，版面就等比放大
 * k 倍（塊數只由「一塊代表幾公尺」決定，不受 k 影響），所以需要的倍率就是兩軸比值
 * 取小的那個，一次除法就求得出來。取整會差個一像素，再量一次修掉。
 */
function shrinkToFit(
  params: TrackGenSizeParams,
  measure: ((p: TrackGenSizeParams) => { wPx: number; hPx: number } | null) | undefined,
  canvasW: number,
  canvasH: number,
): TrackGenSizeParams {
  if (!measure) return params
  let next = params
  for (let i = 0; i < 3; i += 1) {
    const got = measure(next)
    if (!got) return next
    const k = Math.min(canvasW / got.wPx, canvasH / got.hPx)
    if (k >= 0.999) break
    const shrunk = {
      ...next,
      blockLengthPx: Math.max(MIN_LEN, Math.floor(next.blockLengthPx * k)),
      blockWidthPx: Math.max(MIN_WID, Math.floor(next.blockWidthPx * k)),
    }
    if (
      shrunk.blockLengthPx === next.blockLengthPx &&
      shrunk.blockWidthPx === next.blockWidthPx
    ) {
      break
    }
    next = shrunk
  }
  return next
}

export function TrackGenSizeDialog(props: Props) {
  if (!props.open) return null
  // 每次開啟都是新的一份：用 key 重掛比在 effect 裡同步狀態乾淨
  return <SizeDialogBody {...props} />
}

function SizeDialogBody({ canvasPx, totals, initial, measure, onCancel, onConfirm }: Props) {
  /*
   * 一開啟就先塞好。
   *
   * 上一次記住的大小配上這一份路網不一定塞得下，開起來就是一個已經溢出的預設值；
   * 使用者要的是「打開就是能用的」。想再拉大是他的自由，拉大時下面那行會轉紅。
   */
  const [params, setParams] = useState<TrackGenSizeParams>(() =>
    shrinkToFit(
      initial,
      measure,
      Math.max(1, Math.round(canvasPx.width)),
      Math.max(1, Math.round(canvasPx.height)),
    ),
  )
  /** 點過那一塊才長出把手：沒點之前只是示意，長一堆把手反而看不出主角是誰 */
  const [editing, setEditing] = useState(false)

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
  /*
   * 兩軸各估幾塊。
   *
   * 用脊線上橫的路與縱的路各自的公尺數去除，不是拿路網總長除一次——折起來之後
   * 兩軸的塊數差很多，合在一起講等於沒講。
   */
  const countX = Math.max(1, Math.round((totals?.xM ?? 0) / Math.max(1, params.metersPerBlockX)))
  const countY = Math.max(0, Math.round((totals?.yM ?? 0) / Math.max(1, params.metersPerBlockY)))

  /*
   * 生成出來塞不塞得進畫布。
   *
   * 「一條線攤開約 N px」不是答案：版面會轉彎、會折回來，攤開的長度跟實際佔的
   * 矩形是兩回事。這裡直接把整份版面排一次，量它的外接矩形。
   */
  const extent = useMemo(() => measure?.(params) ?? null, [measure, params])
  /*
   * 哪一軸超出要講清楚。
   *
   * 只說「超出畫布 3152 × 642」時，使用者看到寬 2948 比 3152 小，會以為判斷錯了；
   * 實際上超出的是高——版面會折回來，堆疊起來的高度跟一塊有多長沒有直覺關係。
   */
  const overW = extent !== null && extent.wPx > canvasW + 0.5
  const overH = extent !== null && extent.hPx > canvasH + 0.5
  const overflow = overW || overH

  const fitToCanvas = useCallback(
    () => setParams((p) => shrinkToFit(p, measure, canvasW, canvasH)),
    [canvasH, canvasW, measure],
  )

  /*
   * 示意排成 L 形，全部用同一個縮放倍率，看到的就是畫布上的真實大小。
   *
   * 橫的五塊相連、從左端往下接兩塊：場域本來就是折的，只看橫排感覺得到寬度、
   * 感覺不到高度——而高度才是扁畫布會先滿的那一軸。每一塊上面寫它代表幾公尺，
   * 兩軸的公尺數不同時一眼就分得出來。
   *
   * 右邊<strong>另外一塊</strong>才是可以拉的；要拉的東西如果是示意裡的某一塊，
   * 使用者得先猜哪一塊才是能動的。
   */
  const STRIP_N = 5
  const COL_N = 2
  const bw = lenPx * scale
  const bh = widPx * scale
  const pad = Math.round(Math.max(10, Math.min(32, stageW * 0.03)))
  const stripLeft = pad
  const stripTop = pad
  const colTop = stripTop + bh
  const editLeft = Math.max(stripLeft + bh + 12, stageW - pad - bw)
  const editTop = colTop + Math.round(bw * 0.35)
  /** 塊夠寬才塞得下「50 m」，塞不下就只在整排上方寫一次 */
  const labelInStrip = bw >= 34

  const handle = (
    axis: 'both' | 'length' | 'width',
    cls: string,
  ) => (
    <div
      data-trackgen-size-handle={axis}
      className={`absolute size-3 touch-none rounded-sm border-2 border-cyan-300 bg-zinc-900 ${cls}`}
      onPointerDown={(e) => onPointerDown(axis, e)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )

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
            。左邊是橫五塊接上縱兩塊，每塊上面寫它代表幾公尺；右邊那一塊點下去就能拉大小。
          </p>
        </div>

        <div
          ref={stageRef}
          className="relative shrink-0 self-center overflow-hidden rounded-md border border-cyan-500/40 bg-zinc-900"
          style={{ width: stageW, height: stageH }}
        >
          {Array.from({ length: STRIP_N }, (_, i) => (
            <div
              key={`s${i}`}
              data-trackgen-size-strip
              className="absolute flex items-center justify-center overflow-hidden border border-sky-300/70 bg-sky-400/30 text-[10px] tabular-nums text-sky-100"
              style={{ left: stripLeft + i * bw, top: stripTop, width: bw, height: bh }}
            >
              {labelInStrip ? `${Math.round(params.metersPerBlockX)} m` : null}
            </div>
          ))}
          {labelInStrip ? null : (
            <div
              className="pointer-events-none absolute whitespace-nowrap text-[10px] tabular-nums text-sky-200"
              style={{ left: stripLeft, top: Math.max(0, stripTop - 13) }}
            >
              一塊 {Math.round(params.metersPerBlockX)} m
            </div>
          )}

          {Array.from({ length: COL_N }, (_, i) => (
            <div
              key={`v${i}`}
              data-trackgen-size-col
              className="absolute flex items-center justify-center overflow-hidden border border-emerald-300/70 bg-emerald-400/25"
              style={{ left: stripLeft, top: colTop + i * bw, width: bh, height: bw }}
            />
          ))}
          {Array.from({ length: COL_N }, (_, i) => (
            <div
              key={`vl${i}`}
              className="pointer-events-none absolute whitespace-nowrap text-[10px] tabular-nums text-emerald-200"
              style={{ left: stripLeft + bh + 5, top: colTop + i * bw + bw / 2 - 7 }}
            >
              {Math.round(params.metersPerBlockY)} m
            </div>
          ))}

          <div
            data-trackgen-size-edit
            className={`absolute cursor-pointer bg-cyan-400/25 ${
              editing
                ? 'border border-cyan-300'
                : 'border border-dashed border-cyan-300/70 hover:bg-cyan-400/40'
            }`}
            style={{ left: editLeft, top: editTop, width: bw, height: bh }}
            onPointerDown={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
          >
            {editing ? (
              <>
                {handle('both', '-bottom-1.5 -right-1.5 cursor-nwse-resize')}
                {handle('length', '-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize')}
                {handle('width', '-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize')}
              </>
            ) : null}
          </div>

          {/* 寬度不綁那一塊：塊很窄時 `125 × 52 px` 會被折成三行 */}
          <div
            className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap font-mono text-[12px] tabular-nums text-cyan-300"
            style={{ left: editLeft + bw / 2, top: editTop + bh + 8 }}
          >
            {editing ? `${lenPx} × ${widPx} px` : '點我拉大小'}
          </div>
        </div>

        {/* 參數就擺在那一塊的正下方，改哪一個都對得起來 */}
        <div className="flex flex-wrap justify-center gap-4">
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
            label="橫向一塊代表"
            value={params.metersPerBlockX}
            suffix="公尺"
            min={1}
            max={2000}
            onChange={(v) => setParams((p) => ({ ...p, metersPerBlockX: v }))}
          />
          <NumberField
            label="縱向一塊代表"
            value={params.metersPerBlockY}
            suffix="公尺"
            min={1}
            max={2000}
            onChange={(v) => setParams((p) => ({ ...p, metersPerBlockY: v }))}
          />
        </div>

        <div className="rounded-md border border-zinc-700/70 bg-zinc-900/60 px-3 py-2 text-[11px] text-zinc-400">
          {/*
            不寫「路網總長」。那個數字是最長的<strong>單一車道</strong>（732 m），而
            排版走的是把車道串起來的參考鏈（實測 1873 m）；兩個數字擺在一起只會讓人
            以為算錯。兩軸各自的公尺數才是塊數的來源。
          */}
          軌道{' '}
          <b className="font-mono tabular-nums text-zinc-200">
            {Math.round((totals?.xM ?? 0) + (totals?.yM ?? 0))} m
          </b>
          {' · 橫向 '}
          <b className="font-mono tabular-nums text-sky-200" data-trackgen-count-x>
            {countX}
          </b>
          {' 塊（'}
          <span className="font-mono tabular-nums">{Math.round(totals?.xM ?? 0)} m</span>
          {'）· 縱向 '}
          <b className="font-mono tabular-nums text-emerald-200" data-trackgen-count-y>
            {countY}
          </b>
          {' 塊（'}
          <span className="font-mono tabular-nums">{Math.round(totals?.yM ?? 0)} m</span>
          {'）'}
          {extent ? (
            <>
              {'，生成後佔 '}
              <b
                className={`font-mono tabular-nums ${
                  overflow ? 'text-amber-300' : 'text-zinc-200'
                }`}
                data-trackgen-extent
              >
                {Math.round(extent.wPx)} × {Math.round(extent.hPx)} px
              </b>
              {overflow ? (
                <>
                  {overW && overH ? '，長寬都超出畫布 ' : overW ? '，寬度超出畫布 ' : '，高度超出畫布 '}
                  <b className="font-mono tabular-nums text-zinc-200">
                    {overW && overH
                      ? `${canvasW} × ${canvasH} px`
                      : `${overW ? canvasW : canvasH} px`}
                  </b>
                  <button
                    type="button"
                    data-trackgen-fit
                    onClick={fitToCanvas}
                    className="ml-2 rounded border border-amber-400/70 px-2 py-0.5 text-[11px] text-amber-200 transition hover:bg-amber-400/15"
                  >
                    縮到塞得下
                  </button>
                </>
              ) : (
                '，塞得進畫布'
              )}
            </>
          ) : null}
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

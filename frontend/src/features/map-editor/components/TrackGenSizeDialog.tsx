import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'

import { NumberInput } from '../../../components/NumberInput'
import type { TrackGenBlockSize } from '../utils/trackGenFacility'
import { TRACK_GEN_KIND_COLOR, type LayoutShape } from '../utils/trackGenLayout'
import { cornerTrackPath, switchTrackPath, taperTrackPath } from '../utils/trackShapes'

/**
 * 生成前的三個參數。
 *
 * <h3>只有三個</h3>
 * 大小不必填：版面鋪滿軌道生成元件的框，而那個框是使用者自己拉好的。填「一塊幾像素」
 * 反而是負擔——他要的只是把軌道畫粗一點，好讓車子在上面看得清楚。
 *
 *   軌道寬度       帶子多粗，也就是車輛在圖上的解析度
 *   橫向一塊代表   橫的路每幾公尺切一刀
 *   縱向一塊代表   縱的路每幾公尺切一刀
 *
 * <h3>整份版面直接畫出來</h3>
 * 改任何一個參數就重排一次並重畫，看到什麼就會生成什麼——三種軌道用的是它們自己的
 * path 函式，預覽與生成不可能各說各話。
 */

export type TrackGenSizeParams = TrackGenBlockSize

/** 排一次版得到的全部結果：尺寸、塊數、形狀 */
export type TrackGenPreview = {
  wPx: number
  hPx: number
  countX: number
  countY: number
  shapes: LayoutShape[]
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number }
  /** 生成出來會落在畫布的哪個位置（已經夾進畫布內） */
  originPx: { x: number; y: number }
  /** 圖模型排好的版面，套用時直接沿用，預覽與生成才是同一份 */
  layout?: unknown
}

type Props = {
  open: boolean
  /** 畫布尺寸（像素），用來畫等比縮圖 */
  canvasPx: { width: number; height: number }
  /** 要鋪滿的框（軌道生成元件的大小，畫布像素） */
  boxPx?: { wPx: number; hPx: number }
  /** 脊線上橫的路與縱的路各有哪幾段（公尺） */
  totals?: { x: number[]; y: number[] }
  initial: TrackGenSizeParams
  measure?: (params: TrackGenSizeParams) => TrackGenPreview | null
  onCancel: () => void
  onConfirm: (params: TrackGenSizeParams) => void
}

/**
 * 四種軌道在預覽裡各給一個顏色。
 *
 * 全部同色時，一眼分不出哪一段是轉角、哪一段是分岔——先前只能靠外框長寬去猜。顏色
 * 只用在預覽，生成出來的元件仍照圖台原本的樣式。
 */
/*
 * 四種軌道的顏色。
 *
 * 全部<strong>不透明</strong>，而且亮度接近，只有色相不同。半透明的填色疊在深色底上會
 * 一塊亮一塊暗，看起來像有光源、像立體的斜面——這是一張平面示意圖，不該有那種暗示。
 * 斜接原本用黃色，亮度比其他三種高一截，那個問題最明顯，改成同一個亮度的藍。
 */
// 預覽與生成共用同一份底色（見 trackGenLayout）
const KIND_STYLE = TRACK_GEN_KIND_COLOR

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
        <NumberInput
          value={Math.round(value)}
          min={min}
          max={max}
          onChange={onChange}
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

function SizeDialogBody({ canvasPx, boxPx, totals, initial, measure, onCancel, onConfirm }: Props) {
  const { t } = useTranslation()
  const [params, setParams] = useState<TrackGenSizeParams>(initial)

  /*
   * 縮圖要盡量大。
   *
   * 畫布可能有兩千多像素寬，縮圖只給 520 的話一條 26 像素的軌道畫出來只剩 5——螞蟻才
   * 看得到。所以吃滿視窗：畫布放得下就 1:1，放不下才等比縮，並把倍率寫出來。
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
  const availW = Math.max(320, Math.min(1600, viewport.w * 0.94) - 56)
  const availH = Math.max(160, viewport.h * 0.94 - 300)
  const scale = Math.min(1, availW / canvasW, availH / canvasH)
  const stageW = Math.round(canvasW * scale)
  const stageH = Math.round(canvasH * scale)

  const extent = useMemo(() => measure?.(params) ?? null, [measure, params])

  const sum = (a: number[] | undefined) => (a ?? []).reduce((t, v) => t + v, 0)
  const totalXM = sum(totals?.x)
  const totalYM = sum(totals?.y)

  /*
   * 軌道太粗時鋪不滿也塞不下。
   *
   * 高度有個下限：最外側的股道疊起來就是「股數 × 軌道寬」，再加上轉角的外緣。壓縮
   * 沿線的比例尺救不了這件事——那是橫向的帳。與其默默溢出，不如講出來。
   */
  const over = boxPx && extent
    ? {
        w: Math.max(0, Math.round(extent.wPx - boxPx.wPx)),
        h: Math.max(0, Math.round(extent.hPx - boxPx.hPx)),
      }
    : null

  const confirm = useCallback(() => onConfirm(params), [onConfirm, params])

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
          <div className="text-base font-medium text-zinc-100">{t('mapEditor.trackGen.title')}</div>
          <p className="mt-1 text-[12px] leading-snug text-zinc-500">
            {scale >= 0.999
              ? t('mapEditor.trackGen.hintFull', { w: canvasW, h: canvasH })
              : t('mapEditor.trackGen.hintScaled', {
                  w: canvasW,
                  h: canvasH,
                  pct: (scale * 100).toFixed(0),
                })}
          </p>
        </div>

        <div
          className="relative shrink-0 self-center overflow-hidden rounded-md border border-cyan-500/40 bg-zinc-900"
          style={{ width: stageW, height: stageH }}
        >
          {/*
            用 SVG 畫，每一塊都描邊。
            先前是一堆同色的 div，兩條並排的軌道糊成一片，數不出來有幾條；描邊之後
            塊與塊、線與線的界線都看得見。三種軌道用的仍是它們自己的 path 函式。
          */}
          <svg
            width={stageW}
            height={stageH}
            className="pointer-events-none absolute inset-0"
            aria-hidden
          >
            {extent?.shapes.map((sh, i) => {
              const ox = extent.originPx.x - extent.bounds.xMin
              const oy = extent.originPx.y - extent.bounds.yMin
              const { fill, stroke } = KIND_STYLE[sh.kind]
              if (sh.kind === 'rect') {
                const w = Math.max(1, sh.lengthM * scale)
                const h = Math.max(1, sh.widthM * scale)
                const cx = (ox + sh.centre.x) * scale
                const cy = (oy + sh.centre.y) * scale
                return (
                  <rect
                    key={`p${i}`}
                    data-trackgen-preview
                    x={cx - w / 2}
                    y={cy - h / 2}
                    width={w}
                    height={h}
                    transform={`rotate(${sh.rotationDeg} ${cx} ${cy})`}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={0.75}
                  />
                )
              }
              const w = Math.max(1, sh.box.wM * scale)
              const h = Math.max(1, sh.box.hM * scale)
              const d =
                sh.kind === 'corner'
                  ? cornerTrackPath(sh.geometry, w, h)
                  : sh.kind === 'switch'
                    ? switchTrackPath(sh.geometry, w, h)
                    : taperTrackPath(sh.geometry, w, h)
              return (
                <path
                  key={`p${i}`}
                  data-trackgen-preview
                  d={d}
                  transform={`translate(${(ox + sh.box.xM) * scale} ${(oy + sh.box.yM) * scale})`}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={0.75}
                />
              )
            })}
          </svg>
        </div>

        <div className="flex flex-wrap justify-center gap-5">
          <NumberField
            label={t('mapEditor.trackGen.trackWidth')}
            value={params.trackWidthPx}
            suffix="px"
            min={MIN_WID}
            max={400}
            onChange={(v) => setParams((p) => ({ ...p, trackWidthPx: v }))}
          />
          <NumberField
            label={t('mapEditor.trackGen.metersPerBlockX')}
            value={params.metersPerBlockX}
            suffix={t('mapEditor.trackGen.meters')}
            min={1}
            max={2000}
            onChange={(v) => setParams((p) => ({ ...p, metersPerBlockX: v }))}
          />
          <NumberField
            label={t('mapEditor.trackGen.metersPerBlockY')}
            value={params.metersPerBlockY}
            suffix={t('mapEditor.trackGen.meters')}
            min={1}
            max={2000}
            onChange={(v) => setParams((p) => ({ ...p, metersPerBlockY: v }))}
          />
        </div>

        <div className="rounded-md border border-zinc-700/70 bg-zinc-900/60 px-3 py-2 text-[11px] text-zinc-400">
          {t('mapEditor.trackGen.axisX')}{' '}
          <b className="font-mono tabular-nums text-sky-200" data-trackgen-count-x>
            {extent?.countX ?? 0}
          </b>
          {' '}{t('mapEditor.trackGen.blockUnit')}（
          <span className="font-mono tabular-nums">{Math.round(totalXM)} m</span>
          ）· {t('mapEditor.trackGen.axisY')}{' '}
          <b className="font-mono tabular-nums text-emerald-200" data-trackgen-count-y>
            {extent?.countY ?? 0}
          </b>
          {' '}{t('mapEditor.trackGen.blockUnit')}（
          <span className="font-mono tabular-nums">{Math.round(totalYM)} m</span>
          ）· {t('mapEditor.trackGen.occupies')}{' '}
          <b
            className={`font-mono tabular-nums ${
              over && (over.w > 1 || over.h > 1) ? 'text-amber-300' : 'text-zinc-200'
            }`}
            data-trackgen-extent
          >
            {Math.round(extent?.wPx ?? 0)} × {Math.round(extent?.hPx ?? 0)} px
          </b>
          {over && (over.w > 1 || over.h > 1) ? (
            <span className="text-amber-300" data-trackgen-over>
              {t('mapEditor.trackGen.overflowBefore')}
              <b className="font-mono tabular-nums">
                {over.w > 1 ? `${over.w}` : '0'} × {over.h > 1 ? `${over.h}` : '0'} px
              </b>
              {t('mapEditor.trackGen.overflowAfter')}
            </span>
          ) : null}
        </div>

        {/*
          四種軌道的對照。顏色只用在預覽——生成出來的元件仍照圖台原本的樣式；這裡是
          為了讓人一眼看出哪一段是轉角、哪一段是分岔，不必去比對外框長寬。
        */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-zinc-700/70 bg-zinc-900/60 px-3 py-2 text-[11px] text-zinc-400"
          data-trackgen-legend
        >
          {(['rect', 'corner', 'switch', 'taper'] as const).map((kind) => {
            const st = KIND_STYLE[kind]
            const n = extent?.shapes.filter((sh) => sh.kind === kind).length ?? 0
            return (
              <span key={kind} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-3 rounded-[2px] border"
                  style={{ background: st.fill, borderColor: st.stroke }}
                  aria-hidden
                />
                {t(`mapEditor.trackGen.kinds.${kind}`)}
                <b className="font-mono tabular-nums text-zinc-200">{n}</b>
              </span>
            )
          })}
          <span className="text-zinc-500">{t('mapEditor.trackGen.legendNote')}</span>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-600 px-3 py-1.5 text-[12px] text-zinc-300 transition hover:border-zinc-400 hover:text-zinc-100"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={confirm}
            className="rounded-md border border-cyan-500/70 bg-cyan-500/15 px-3 py-1.5 text-[12px] text-cyan-200 transition hover:bg-cyan-500/25"
          >
            {t('mapEditor.trackGen.generate')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

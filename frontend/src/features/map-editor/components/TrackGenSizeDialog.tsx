import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'

import { NumberInput } from '../../../components/NumberInput'
import type { TrackGenBlockSize } from '../utils/trackGenFacility'
import type { TaperTrackGeometry } from '../utils/trackShapes'
import {
  MAX_GROUP_MEMBERS,
  memberKey,
  partsOfKind,
  splitMemberKey,
  TRACK_GEN_GROUP_COLORS,
  normalizeGroupCode,
  trackGenGroupIndex,
  trackGenGroupLabel,
  type TrackGenGroup,
} from '../utils/trackGenGroups'
import { TRACK_GEN_KIND_COLOR, type LayoutShape } from '../utils/trackGenLayout'
import {
  cornerTrackPath,
  crossTrackPartPaths,
  switchTrackPartPaths,
  taperTrackPath,
} from '../utils/trackShapes'

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
  onConfirm: (params: TrackGenSizeParams, groups: TrackGenGroup[]) => void
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
   * 分組命名的狀態。
   *
   * <code>editingId</code> 有值時預覽變成可點選——沒在編輯就不該攔滑鼠，不然使用者
   * 只是想看圖也會不小心把方塊選進組裡。
   */
  const [groups, setGroups] = useState<TrackGenGroup[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  /** 進入編輯時先存一份，取消就整組還原 */
  const [draftBackup, setDraftBackup] = useState<TrackGenGroup | null>(null)

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

  /*
   * 參數一改就重排，形狀的名字可能跟著變。留下來的只有還存在的那些——不然按下生成時
   * 會照著一份已經不存在的清單去命名。
   */
  const shapeNames = useMemo(
    () => new Set((extent?.shapes ?? []).map((sh) => sh.name)),
    [extent],
  )
  /*
   * 顯示與生成都看<strong>還存在的那些</strong>，但選單本身不刪。
   *
   * 使用者可能只是把「一塊幾公尺」調過去又調回來；當場把成員刪掉，調回來就救不回了。
   * 所以原始清單留著，只在用到的時候濾掉現在不存在的。
   */
  const liveGroups = useMemo(
    () =>
      groups.map((g) => ({
        // 成員鍵可能帶著「哪一半」，比對時要拆掉再看那個形狀還在不在
        ...g,
        members: g.members.filter((m) => shapeNames.has(splitMemberKey(m).name)),
      })),
    [groups, shapeNames],
  )
  const editing = liveGroups.find((g) => g.id === editingId) ?? null
  const memberOf = useMemo(() => trackGenGroupIndex(liveGroups), [liveGroups])

  const patchEditing = useCallback(
    (patch: Partial<TrackGenGroup>) => {
      setGroups((prev) => prev.map((g) => (g.id === editingId ? { ...g, ...patch } : g)))
    },
    [editingId],
  )

  const startGroup = useCallback(() => {
    const id = `g${Date.now().toString(36)}`
    setGroups((prev) => [
      ...prev,
      {
        id,
        code: '',
        color: TRACK_GEN_GROUP_COLORS[prev.length % TRACK_GEN_GROUP_COLORS.length]!,
        members: [],
      },
    ])
    setDraftBackup(null)
    setEditingId(id)
  }, [])

  const editGroup = useCallback(
    (g: TrackGenGroup) => {
      setDraftBackup({ ...g, members: [...g.members] })
      setEditingId(g.id)
    },
    [],
  )

  /** 取消這一次設定：新開的整組丟掉，改到一半的還原成進來時的樣子 */
  const cancelGroup = useCallback(() => {
    setGroups((prev) => {
      if (draftBackup) return prev.map((g) => (g.id === draftBackup.id ? draftBackup : g))
      return prev.filter((g) => g.id !== editingId)
    })
    setDraftBackup(null)
    setEditingId(null)
  }, [draftBackup, editingId])

  const deleteGroup = useCallback((id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id))
    setEditingId((cur) => (cur === id ? null : cur))
    setDraftBackup(null)
  }, [])

  /** 點一塊：已經在這一組裡就取消選取，並把後面的順序補上來 */
  const toggleMember = useCallback(
    (name: string) => {
      if (!editingId) return
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== editingId) {
            // 一塊只能屬於一組，換組就從舊的那組移出去
            return g.members.includes(name)
              ? { ...g, members: g.members.filter((m) => m !== name) }
              : g
          }
          if (g.members.includes(name)) {
            return { ...g, members: g.members.filter((m) => m !== name) }
          }
          if (g.members.length >= MAX_GROUP_MEMBERS) return g
          return { ...g, members: [...g.members, name] }
        }),
      )
    },
    [editingId],
  )

  const confirm = useCallback(
    () => onConfirm(params, liveGroups.filter((g) => g.code && g.members.length)),
    [onConfirm, params, liveGroups],
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
            className={`absolute inset-0 ${editingId ? '' : 'pointer-events-none'}`}
            aria-hidden
          >
            {extent?.shapes.map((sh, i) => {
              const ox = extent.originPx.x - extent.bounds.xMin
              const oy = extent.originPx.y - extent.bounds.yMin
              const mine = memberOf.get(sh.name)
              // 選進組裡的塊換成那一組的底色，其餘照種類的顏色
              const { fill, stroke } = mine
                ? { fill: mine.color, stroke: '#fafafa' }
                : KIND_STYLE[sh.kind]
              const pick = editingId
                ? {
                    onPointerDown: (e: React.PointerEvent) => {
                      e.stopPropagation()
                      toggleMember(sh.name)
                    },
                    style: { cursor: 'pointer' },
                  }
                : {}
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
                    strokeWidth={mine ? 1.25 : 0.75}
                    {...pick}
                  />
                )
              }
              const w = Math.max(1, sh.box.wM * scale)
              const h = Math.max(1, sh.box.hM * scale)
              const shift = `translate(${(ox + sh.box.xM) * scale} ${(oy + sh.box.yM) * scale})`
              /*
               * 交叉與分岔<strong>兩半各畫各的</strong>。
               *
               * 它們在現場是兩條軌道（交叉是上下行，分岔是主線與岔線），要分開選、
               * 分開命名，所以圖上就得分開畫——一整片的話點下去只能選到整塊。
               */
              if (sh.kind === 'cross' || sh.kind === 'switch') {
                const parts = partsOfKind(sh.kind)!
                const dd =
                  sh.kind === 'cross'
                    ? crossTrackPartPaths(sh.geometry, w, h)
                    : switchTrackPartPaths(sh.geometry, w, h)
                return (
                  <g key={`p${i}`} transform={shift}>
                    {parts.map((part) => {
                      const own = memberOf.get(memberKey(sh.name, part))
                      const st = own
                        ? { fill: own.color, stroke: '#fafafa' }
                        : KIND_STYLE[sh.kind]
                      return (
                        <path
                          key={part}
                          data-trackgen-preview
                          d={(dd as Record<string, string>)[part]!}
                          fill={st.fill}
                          stroke={st.stroke}
                          strokeWidth={own ? 1.25 : 0.75}
                          {...(editingId
                            ? {
                                onPointerDown: (e: React.PointerEvent) => {
                                  e.stopPropagation()
                                  toggleMember(memberKey(sh.name, part))
                                },
                                style: { cursor: 'pointer' },
                              }
                            : {})}
                        />
                      )
                    })}
                  </g>
                )
              }
              const d =
                sh.kind === 'corner'
                  ? cornerTrackPath(sh.geometry, w, h)
                  : taperTrackPath(sh.geometry as TaperTrackGeometry, w, h)
              return (
                <path
                  key={`p${i}`}
                  data-trackgen-preview
                  d={d}
                  transform={shift}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={mine ? 1.25 : 0.75}
                  {...pick}
                />
              )
            })}
            {/*
              選取順序<strong>直接標在塊上</strong>。編號就是它生成出來的名字尾巴，
              先看到才知道自己點的順序對不對——事後改名要一塊一塊找回來，代價差很多。
            */}
            {extent?.shapes.flatMap((sh, i) => {
              const ox = extent.originPx.x - extent.bounds.xMin
              const oy = extent.originPx.y - extent.bounds.yMin
              const parts = partsOfKind(sh.kind)
              const at = (dy: number) =>
                sh.kind === 'rect'
                  ? { x: (ox + sh.centre.x) * scale, y: (oy + sh.centre.y) * scale + dy }
                  : {
                      x: (ox + sh.box.xM + sh.box.wM / 2) * scale,
                      y: (oy + sh.box.yM + sh.box.hM / 2) * scale + dy,
                    }
              const label = (m: { code: string; order: number }) =>
                m.code ? trackGenGroupLabel(m.code, m.order) : String(m.order + 1)
              const draw = (key: string, m: { code: string; order: number }, dy: number) => (
                <text
                  key={key}
                  x={at(dy).x}
                  y={at(dy).y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={11}
                  fontWeight={700}
                  fill="#fafafa"
                  className="pointer-events-none"
                  style={{ paintOrder: 'stroke', stroke: '#09090b', strokeWidth: 3 }}
                >
                  {label(m)}
                </text>
              )
              if (parts && sh.kind !== 'rect') {
                // 兩半各標各的：上（橫）在上、下（斜）在下，位置錯開才看得清楚
                const gap = Math.max(7, (sh.box.hM * scale) / 4)
                return parts
                  .map((part, k) => {
                    const own = memberOf.get(memberKey(sh.name, part))
                    return own ? draw(`n${i}-${part}`, own, k === 0 ? -gap : gap) : null
                  })
                  .filter(Boolean)
              }
              const mine = memberOf.get(sh.name)
              return mine ? [draw(`n${i}`, mine, 0)] : []
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

        {/*
          分組命名。
          按 + 進入選取，照順序點過去；編號直接標在塊上。頭字只收兩個大寫字母，因為
          它要接在兩位順序前面變成 D04 那種現場叫得出口的代號。
        */}
        <div
          className="rounded-md border border-zinc-700/70 bg-zinc-900/60 px-3 py-2"
          data-trackgen-groups
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-zinc-300">
              {t('mapEditor.trackGen.groups.title')}
            </span>
            {liveGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => (editingId === g.id ? undefined : editGroup(g))}
                className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] transition ${
                  editingId === g.id
                    ? 'border-cyan-400 text-cyan-100'
                    : 'border-zinc-600 text-zinc-300 hover:border-zinc-400'
                }`}
              >
                <span
                  className="inline-block size-3 rounded-[2px] border border-zinc-500"
                  style={{ background: g.color }}
                  aria-hidden
                />
                <span className="font-mono">{g.code || '—'}</span>
                <span className="tabular-nums text-zinc-500">{g.members.length}</span>
              </button>
            ))}
            {editingId ? null : (
              <button
                type="button"
                onClick={startGroup}
                data-trackgen-group-add
                className="rounded border border-cyan-500/70 bg-cyan-500/10 px-2 py-1 text-[12px] leading-none text-cyan-200 transition hover:bg-cyan-500/25"
                title={t('mapEditor.trackGen.groups.add')}
              >
                ＋
              </button>
            )}
          </div>

          {editing ? (
            <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-zinc-800 pt-2">
              <label className="flex flex-col gap-1 text-[10px] text-zinc-400">
                {t('mapEditor.trackGen.groups.code')}
                <input
                  value={editing.code}
                  onChange={(e) => patchEditing({ code: normalizeGroupCode(e.target.value) })}
                  // 提示字要暗得夠明顯：先前跟真的填了一樣，使用者以為頭字已經有了
                  placeholder="AB"
                  maxLength={2}
                  className="w-16 rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-center font-mono text-[13px] uppercase text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-sky-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] text-zinc-400">
                {t('mapEditor.trackGen.groups.color')}
                <input
                  type="color"
                  value={editing.color}
                  onChange={(e) => patchEditing({ color: e.target.value })}
                  className="h-[30px] w-14 cursor-pointer rounded border border-zinc-600 bg-zinc-950"
                />
              </label>
              <div className="flex-1 text-[11px] text-zinc-400">
                {t('mapEditor.trackGen.groups.picked', { n: editing.members.length })}
                <div className="text-[10px] text-zinc-500">
                  {editing.code
                    ? t('mapEditor.trackGen.groups.previewName', {
                        first: trackGenGroupLabel(editing.code, 0),
                        last: trackGenGroupLabel(
                          editing.code,
                          Math.max(0, editing.members.length - 1),
                        ),
                      })
                    : t('mapEditor.trackGen.groups.needCode')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteGroup(editing.id)}
                className="rounded border border-red-500/60 px-2 py-1 text-[11px] text-red-300 transition hover:bg-red-500/15"
              >
                {t('mapEditor.trackGen.groups.remove')}
              </button>
              <button
                type="button"
                onClick={cancelGroup}
                className="rounded border border-zinc-600 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-400"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-trackgen-group-done
                disabled={!editing.code || !editing.members.length}
                onClick={() => {
                  setDraftBackup(null)
                  setEditingId(null)
                }}
                className="rounded border border-cyan-500/70 bg-cyan-500/15 px-2 py-1 text-[11px] text-cyan-200 transition hover:bg-cyan-500/25 disabled:opacity-40"
              >
                {t('mapEditor.trackGen.groups.done')}
              </button>
            </div>
          ) : (
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
              {t('mapEditor.trackGen.groups.hint')}
            </p>
          )}
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

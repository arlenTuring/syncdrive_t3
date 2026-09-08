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
  canMergeTrackGen,
  type TrackGenMerge,
  type TrackGenMergeRefusal,
} from '../utils/trackGenMerge'
import {
  axisOf,
  canNudge,
  extentOf,
  nudgeRangeFor,
  snapTargetsFor,
  type Axis,
  type NudgeEnd,
  type NudgeError,
  type TrackGenNudge,
} from '../utils/trackGenNudge'
import {
  cornerTrackPath,
  crossTrackPartPaths,
  crossTrackPath,
  switchTrackPartPaths,
  switchTrackPath,
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
  /**
   * 使用者的合併<strong>真的做成了幾筆</strong>。
   *
   * 合併是照形狀的名字記的，而參數一改就重排、名字跟著變，對不上的那幾筆會被跳過。
   * 數字寫出來，使用者才知道自己那幾筆還在不在。
   */
  mergesApplied?: number
  /** 微調真的做成了幾筆，以及逐塊的長度誤差 */
  nudgesApplied?: number
  nudgeErrors?: NudgeError[]
  nudgeTotalM?: number
  nudgeMaxM?: number
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
  /** 上一次生成用的合併與微調，重新開啟時沿用 */
  initialMerges?: TrackGenMerge[]
  initialNudges?: TrackGenNudge[]
  measure?: (
    params: TrackGenSizeParams,
    merges: TrackGenMerge[],
    nudges: TrackGenNudge[],
  ) => TrackGenPreview | null
  onCancel: () => void
  onConfirm: (
    params: TrackGenSizeParams,
    groups: TrackGenGroup[],
    merges: TrackGenMerge[],
    nudges: TrackGenNudge[],
  ) => void
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

function SizeDialogBody({
  canvasPx,
  boxPx,
  totals,
  initial,
  initialMerges,
  initialNudges,
  measure,
  onCancel,
  onConfirm,
}: Props) {
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
   * 合併：使用者自己決定哪兩塊要變成一塊。
   *
   * <code>picks</code> 是這一次點的兩塊，順序就是畫面上的 1 與 2；<code>merges</code>
   * 是已經成立的每一次合併，<strong>依序</strong>套在版面上。順序不能亂：併過一次
   * 之後名字與相鄰關係都變了，後面那一次是使用者在已經併過的預覽上點的。
   */
  const [mergeMode, setMergeMode] = useState(false)
  const [picks, setPicks] = useState<string[]>([])
  const [merges, setMerges] = useState<TrackGenMerge[]>(initialMerges ?? [])
  /*
   * 微調：一塊一塊拖長度。
   *
   * <code>drag</code> 是拖到一半的那一筆，還沒進 <code>nudges</code>；放開才收下。
   * 拖的時候預覽已經照著畫，所以看到的就是放開之後的樣子。
   */
  const [nudgeMode, setNudgeMode] = useState(false)
  const [nudges, setNudges] = useState<TrackGenNudge[]>(initialNudges ?? [])
  const [drag, setDrag] = useState<{
    name: string
    end: NudgeEnd
    axis: Axis
    /** 這一端原本在哪（版面單位） */
    from: number
    /** 現在拖到哪（已經吸附過） */
    to: number
    /** 吸附到的那條線，沒吸到就是 null */
    snapped: number | null
    /** 對齊候選：畫面座標用來吸附，版面座標用來畫出來給人看 */
    targetsClient: number[]
    targets: number[]
    /** 按下去的那一刻，這一端在畫面上的位置 */
    fromClient: number
    /** 按下去的那一刻，游標在畫面上的位置 */
    grabClient: number
    /** 一個版面單位等於畫面上幾像素（量出來的） */
    per: number
    /** 這一端拖得到的範圍：兩塊都要留一點長度 */
    min: number
    max: number
  } | null>(null)

  /*
   * 一步一步復原：合併與微調共用一條時間軸。
   *
   * 兩種操作都是一筆一筆疊上去的，使用者記得的是「剛才做的那一件」，不是「剛才那一件
   * 合併」。所以記下先後順序，Cmd/Ctrl+Z 就退掉最後做的那一件，不管它是哪一種。
   */
  const [, setHistory] = useState<('merge' | 'nudge')[]>([])
  const undoLast = useCallback(() => {
    setHistory((prev) => {
      const last = prev[prev.length - 1]
      if (!last) return prev
      if (last === 'merge') setMerges((m) => m.slice(0, -1))
      else setNudges((n) => n.slice(0, -1))
      return prev.slice(0, -1)
    })
    setDrag(null)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'z' && e.key !== 'Z') return
      if (!e.metaKey && !e.ctrlKey) return
      // 在輸入格裡打字時交給輸入格自己處理
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      e.preventDefault()
      undoLast()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undoLast])

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

  /* 拖到一半的那一筆也要算進去，畫面才會跟著手走 */
  const liveNudges = useMemo(
    () =>
      drag && Math.abs(drag.to - drag.from) > 0.01
        ? [...nudges, { name: drag.name, end: drag.end, dPx: drag.to - drag.from }]
        : nudges,
    [nudges, drag],
  )
  const extent = useMemo(
    () => measure?.(params, merges, liveNudges) ?? null,
    [measure, params, merges, liveNudges],
  )
  /*
   * 原始邊界：沒有微調過的版面。
   *
   * 使用者調的時候要知道自己離原本多遠——他的目標是整體長度盡量不變，所以每一塊原本
   * 的界線要看得見，才有東西可以對回去。
   */
  const baseExtent = useMemo(
    () => measure?.(params, merges, []) ?? null,
    [measure, params, merges],
  )

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

  /** 點一塊當合併對象：再點一次取消，最多兩塊 */
  const togglePick = useCallback((name: string) => {
    setPicks((prev) =>
      prev.includes(name)
        ? prev.filter((n) => n !== name)
        : prev.length >= 2
          ? prev
          : [...prev, name],
    )
  }, [])

  const pickIndex = useMemo(() => new Map(picks.map((n, i) => [n, i + 1])), [picks])
  /* 兩個方向各驗一次：不能併的那個方向按鈕就是灰的，理由寫在旁邊 */
  const mergeChecks = useMemo(() => {
    const shapes = extent?.shapes ?? []
    if (picks.length < 2) return null
    const [a, b] = picks as [string, string]
    return {
      aToB: canMergeTrackGen(shapes, a, b),
      bToA: canMergeTrackGen(shapes, b, a),
    }
  }, [extent, picks])

  const commitMerge = useCallback(
    (from: string, to: string) => {
      setMerges((prev) => [...prev, { from, to }])
      setHistory((prev) => [...prev, 'merge'])
      setPicks([])
    },
    [],
  )

  const enterMerge = useCallback(() => {
    setEditingId(null)
    setDraftBackup(null)
    setMergeMode(true)
    setPicks([])
  }, [])

  const exitMerge = useCallback(() => {
    setMergeMode(false)
    setPicks([])
  }, [])

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
    () =>
      onConfirm(
        params,
        liveGroups.filter((g) => g.code && g.members.length),
        merges,
        nudges,
      ),
    [onConfirm, params, liveGroups, merges, nudges],
  )

  /*
   * 版面座標 → 縮圖座標的共用位移。
   *
   * 微調時<strong>用沒調過的那一份</strong>當座標框。拖動會改變外框（塊往外長時
   * bounds 跟著變），而位移是拿外框算的——用當下這一份的話，每動一格座標框就跟著移，
   * 游標沒動圖也會自己走，吸附也就永遠對不準。座標框固定住，拖到哪就是哪。
   */
  const frame = baseExtent ?? extent
  const gx = frame ? frame.originPx.x - frame.bounds.xMin : 0
  const gy = frame ? frame.originPx.y - frame.bounds.yMin : 0

  /** 這一塊兩端的把手位置（版面座標） */
  const handlesOf = (sh: LayoutShape) => {
    const ax = axisOf(sh)
    const { lo, hi } = extentOf(sh, ax)
    const perp =
      sh.samples.reduce((t, p) => t + (ax === 'x' ? p.y : p.x), 0) /
      Math.max(1, sh.samples.length)
    const at = (v: number) => (ax === 'x' ? { x: v, y: perp } : { x: perp, y: v })
    return { ax, lo, hi, at }
  }

  const startDrag = useCallback(
    (sh: LayoutShape, end: NudgeEnd, e: React.PointerEvent<SVGRectElement>) => {
      const shapes = extent?.shapes ?? []
      const range = nudgeRangeFor(shapes, sh, end)
      const svg = e.currentTarget.ownerSVGElement
      if (!range || !svg) return
      const ax = axisOf(sh)
      const { lo, hi } = extentOf(sh, ax)
      const from = end === 'lo' ? lo : hi
      /*
       * 候選與起點都<strong>先換算成畫面座標</strong>，之後只看游標移了幾像素。
       *
       * 不再每次把游標換回版面座標：換算要用座標框，而座標框會隨著外框變動，一動就
       * 對不準——手停著圖卻自己走，吸附到的位置跟放開後的落點也就不一樣。
       */
      /*
       * 一個版面單位在螢幕上是幾像素，<strong>量出來</strong>，不用算的。
       *
       * 縮圖的 svg 有自己的 width，而它在畫面上實際多寬還會被外層的縮放影響。拿 scale
       * 直接當換算率的話，只要外層有縮放，游標移一像素就換出錯的距離——愈拖愈偏。
       */
      const r = svg.getBoundingClientRect()
      const per = (r.width / Math.max(1, stageW)) * scale
      const base = ax === 'x' ? r.left + gx * per : r.top + gy * per
      setDrag({
        name: sh.name,
        end,
        axis: ax,
        from,
        to: from,
        snapped: null,
        /*
         * 候選不先照範圍濾掉。
         *
         * 濾掉的話，拖不到的那幾條就整條消失，使用者只會覺得「怎麼樣都對不齊」，卻
         * 看不出是被範圍擋住。留著、畫出來，拖到範圍邊界自然停住，至少看得見。
         */
        targets: snapTargetsFor(shapes, sh, ax),
        targetsClient: snapTargetsFor(shapes, sh, ax).map((t) => base + t * per),
        fromClient: base + from * per,
        per,
        // 抓在把手的哪一點：位移從這裡算，才不會一按下去就跳一段
        grabClient: ax === 'x' ? e.clientX : e.clientY,
        min: range.min,
        max: range.max,
      })
    },
    [extent, gx, gy, scale, stageW],
  )

  /*
   * 拖曳的滑鼠事件掛在 window 上，不掛在圖上。
   *
   * 拖到一半手常常會滑出縮圖的範圍——掛在圖上的話那一刻就收不到 move 與 up，放開了
   * 卻沒人收下，這一次調整就白做。
   */
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const now = drag.axis === 'x' ? e.clientX : e.clientY
      // 這一端現在被拖到畫面上的哪裡
      let at = drag.fromClient + (now - drag.grabClient)
      // 吸附：離候選夠近就貼上去（畫面上量，所以縮圖縮多少手感都一樣）
      let hit = false
      let bestD = 10
      for (const t of drag.targetsClient) {
        const d = Math.abs(t - at)
        if (d <= bestD) {
          bestD = d
          at = t
          hit = true
        }
      }
      const raw = drag.from + (at - drag.fromClient) / Math.max(1e-6, drag.per)
      const to = Math.max(drag.min, Math.min(drag.max, raw))
      setDrag((cur) => (cur ? { ...cur, to, snapped: hit && to === raw ? to : null } : cur))
    }
    const up = () => {
      setDrag((cur) => {
        // 手抖的那幾像素不算數
        if (cur && Math.abs(cur.to - cur.from) > 0.5) {
          const one = { name: cur.name, end: cur.end, dPx: cur.to - cur.from }
          queueMicrotask(() => {
            setNudges((prev) => [...prev, one])
            setHistory((prev) => [...prev, 'nudge'])
          })
        }
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag])

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
            className={`absolute inset-0 ${
              editingId || mergeMode || nudgeMode ? '' : 'pointer-events-none'
            }`}
            aria-hidden
          >
            {/*
              原始邊界。
              微調的目標是整體長度盡量不變，所以每一塊原本的界線要看得見，才有東西可以
              對回去。畫在底下，只留虛線外框。
            */}
            {(nudgeMode ? baseExtent?.shapes : null)?.map((sh, i) => {
              const st = { fill: 'none', stroke: '#52525b', strokeDasharray: '3 3' }
              if (sh.kind === 'rect') {
                const w = Math.max(1, sh.lengthM * scale)
                const h = Math.max(1, sh.widthM * scale)
                const cx = (gx + sh.centre.x) * scale
                const cy = (gy + sh.centre.y) * scale
                return (
                  <rect
                    key={`g${i}`}
                    x={cx - w / 2}
                    y={cy - h / 2}
                    width={w}
                    height={h}
                    transform={`rotate(${sh.rotationDeg} ${cx} ${cy})`}
                    strokeWidth={0.75}
                    {...st}
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
                    : sh.kind === 'cross'
                      ? crossTrackPath(sh.geometry, w, h)
                      : taperTrackPath(sh.geometry as TaperTrackGeometry, w, h)
              return (
                <path
                  key={`g${i}`}
                  d={d}
                  transform={`translate(${(gx + sh.box.xM) * scale} ${(gy + sh.box.yM) * scale})`}
                  strokeWidth={0.75}
                  {...st}
                />
              )
            })}
            {extent?.shapes.map((sh, i) => {
              const ox = gx
              const oy = gy
              const mine = memberOf.get(sh.name)
              const picked = pickIndex.get(sh.name)
              /*
               * 合併模式下只看有沒有被點到，不看分組的底色——這兩件事同時上色的話，
               * 使用者分不出「這塊在某一組」和「這塊正要被併掉」。
               */
              const { fill, stroke } = picked
                ? { fill: KIND_STYLE[sh.kind].fill, stroke: '#fbbf24' }
                : mine
                  ? { fill: mine.color, stroke: '#fafafa' }
                  : KIND_STYLE[sh.kind]
              const hit = mergeMode
                ? {
                    onPointerDown: (e: React.PointerEvent) => {
                      e.stopPropagation()
                      togglePick(sh.name)
                    },
                    style: { cursor: 'pointer' },
                  }
                : editingId
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
                    data-trackgen-name={sh.name}
                    x={cx - w / 2}
                    y={cy - h / 2}
                    width={w}
                    height={h}
                    transform={`rotate(${sh.rotationDeg} ${cx} ${cy})`}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={picked ? 2 : mine ? 1.25 : 0.75}
                    {...hit}
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
                      // 合併是整個元件的事：分岔長出一隻腳，兩半都跟著長
                      const st = picked
                        ? { fill: KIND_STYLE[sh.kind].fill, stroke: '#fbbf24' }
                        : own
                          ? { fill: own.color, stroke: '#fafafa' }
                          : KIND_STYLE[sh.kind]
                      return (
                        <path
                          key={part}
                          data-trackgen-preview
                          data-trackgen-name={sh.name}
                          d={(dd as Record<string, string>)[part]!}
                          fill={st.fill}
                          stroke={st.stroke}
                          strokeWidth={picked ? 2 : own ? 1.25 : 0.75}
                          {...(mergeMode
                            ? {
                                onPointerDown: (e: React.PointerEvent) => {
                                  e.stopPropagation()
                                  togglePick(sh.name)
                                },
                                style: { cursor: 'pointer' },
                              }
                            : editingId
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
                  data-trackgen-name={sh.name}
                  d={d}
                  transform={shift}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={picked ? 2 : mine ? 1.25 : 0.75}
                  {...hit}
                />
              )
            })}
            {/*
              選取順序<strong>直接標在塊上</strong>。編號就是它生成出來的名字尾巴，
              先看到才知道自己點的順序對不對——事後改名要一塊一塊找回來，代價差很多。
            */}
            {extent?.shapes.flatMap((sh, i) => {
              const ox = gx
              const oy = gy
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
              /* 合併模式：標的是這一次點的順序，1 併到 2 還是 2 併到 1 靠它分辨 */
              const picked = pickIndex.get(sh.name)
              if (mergeMode) {
                return picked
                  ? [
                      <text
                        key={`m${i}`}
                        x={at(0).x}
                        y={at(0).y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={14}
                        fontWeight={800}
                        fill="#fbbf24"
                        className="pointer-events-none"
                        style={{ paintOrder: 'stroke', stroke: '#09090b', strokeWidth: 3.5 }}
                      >
                        {picked}
                      </text>,
                    ]
                  : []
              }
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

            {/*
              微調的把手：一塊兩個，各管一端。
              橫的塊拖左右、縱的塊拖上下——拖的是那一端的位置，不是整塊縮放，所以另一端
              留在原地。
            */}
            {nudgeMode
              ? extent?.shapes.flatMap((sh, i) => {
                  if (!canNudge(sh)) return []
                  const { ax, lo, hi, at } = handlesOf(sh)
                  const bar = 9
                  return ([['lo', lo], ['hi', hi]] as [NudgeEnd, number][])
                    .filter(([end]) => nudgeRangeFor(extent?.shapes ?? [], sh, end))
                    .map(([end, v]) => {
                    const p = at(v)
                    const cx = (gx + p.x) * scale
                    const cy = (gy + p.y) * scale
                    const w = ax === 'x' ? 3 : bar
                    const h = ax === 'x' ? bar : 3
                    const on = drag?.name === sh.name && drag.end === end
                    return (
                      <rect
                        key={`h${i}-${end}`}
                        data-trackgen-handle={`${sh.name}|${end}`}
                        x={cx - w / 2}
                        y={cy - h / 2}
                        width={w}
                        height={h}
                        rx={1}
                        fill={on ? '#fbbf24' : '#22d3ee'}
                        stroke="#09090b"
                        strokeWidth={0.5}
                        style={{ cursor: ax === 'x' ? 'ew-resize' : 'ns-resize' }}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          startDrag(sh, end, e)
                        }}
                      />
                    )
                  })
                })
              : null}

            {/*
              對準線。
              拖到哪畫到哪，橫跨整張圖，這樣才看得出跟上下那條線對不對得上；吸附到別條
              線的塊界時換成琥珀色，並把原本的位置留一條暗線當參考。
            */}
            {drag ? (
              <g className="pointer-events-none">
                {/*
                  對齊的候選全部畫出來。
                  看不見的話，對不齊時分不清是「沒有可以對的線」還是「拖不過去」。
                */}
                {drag.targets.map((t) =>
                  drag.axis === 'x' ? (
                    <line
                      key={`t${t}`}
                      data-trackgen-snap-tick
                      x1={(gx + t) * scale}
                      y1={0}
                      x2={(gx + t) * scale}
                      y2={stageH}
                      stroke={t >= drag.min && t <= drag.max ? '#71717a' : '#3f3f46'}
                      strokeWidth={t >= drag.min && t <= drag.max ? 1 : 0.6}
                      strokeDasharray="2 5"
                    />
                  ) : (
                    <line
                      key={`t${t}`}
                      data-trackgen-snap-tick
                      x1={0}
                      y1={(gy + t) * scale}
                      x2={stageW}
                      y2={(gy + t) * scale}
                      stroke={t >= drag.min && t <= drag.max ? '#71717a' : '#3f3f46'}
                      strokeWidth={t >= drag.min && t <= drag.max ? 1 : 0.6}
                      strokeDasharray="2 5"
                    />
                  ),
                )}
                {drag.axis === 'x' ? (
                  <>
                    <line
                      x1={(gx + drag.from) * scale}
                      y1={0}
                      x2={(gx + drag.from) * scale}
                      y2={stageH}
                      stroke="#52525b"
                      strokeWidth={1}
                      strokeDasharray="2 4"
                    />
                    <line
                      data-trackgen-guide
                      x1={(gx + drag.to) * scale}
                      y1={0}
                      x2={(gx + drag.to) * scale}
                      y2={stageH}
                      stroke={drag.snapped === null ? '#22d3ee' : '#fbbf24'}
                      strokeWidth={drag.snapped === null ? 1 : 1.5}
                    />
                  </>
                ) : (
                  <>
                    <line
                      x1={0}
                      y1={(gy + drag.from) * scale}
                      x2={stageW}
                      y2={(gy + drag.from) * scale}
                      stroke="#52525b"
                      strokeWidth={1}
                      strokeDasharray="2 4"
                    />
                    <line
                      data-trackgen-guide
                      x1={0}
                      y1={(gy + drag.to) * scale}
                      x2={stageW}
                      y2={(gy + drag.to) * scale}
                      stroke={drag.snapped === null ? '#22d3ee' : '#fbbf24'}
                      strokeWidth={drag.snapped === null ? 1 : 1.5}
                    />
                  </>
                )}
              </g>
            ) : null}
          </svg>
        </div>

        {/*
          參數在左，量出來的結果在右，同一列。

          先前參數、合併、分組、塊數、圖例各自佔一條橫槓，五條疊起來比預覽本身還高。
          真正要一直看著的只有「改了之後變多大」；其餘不是動作就是提示——動作收進下面
          那條工具列，提示收進按鈕的 title 與展開區，不佔常駐空間。
        */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-end gap-4">
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

          <div className="flex min-w-[15rem] flex-1 flex-col items-start gap-1 sm:items-end">
            <div
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-zinc-400"
              data-trackgen-stats
            >
              <span>
                {t('mapEditor.trackGen.axisX')}{' '}
                <b className="font-mono tabular-nums text-sky-200" data-trackgen-count-x>
                  {extent?.countX ?? 0}
                </b>{' '}
                {t('mapEditor.trackGen.blockUnit')}
                <span className="ml-1 font-mono tabular-nums text-zinc-600">
                  {Math.round(totalXM)} m
                </span>
              </span>
              <span aria-hidden className="text-zinc-700">
                ·
              </span>
              <span>
                {t('mapEditor.trackGen.axisY')}{' '}
                <b className="font-mono tabular-nums text-emerald-200" data-trackgen-count-y>
                  {extent?.countY ?? 0}
                </b>{' '}
                {t('mapEditor.trackGen.blockUnit')}
                <span className="ml-1 font-mono tabular-nums text-zinc-600">
                  {Math.round(totalYM)} m
                </span>
              </span>
              <span aria-hidden className="text-zinc-700">
                ·
              </span>
              <span>
                {t('mapEditor.trackGen.occupies')}{' '}
                <b
                  className={`font-mono tabular-nums ${
                    over && (over.w > 1 || over.h > 1) ? 'text-amber-300' : 'text-zinc-200'
                  }`}
                  data-trackgen-extent
                >
                  {Math.round(extent?.wPx ?? 0)} × {Math.round(extent?.hPx ?? 0)} px
                </b>
              </span>
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
              圖例跟著統計走：兩者都是「這組參數排出來長什麼樣」，放一起才讀得成一件事。
              顏色只用在預覽，生成出來的元件仍照圖台原本的樣式——這句話進 title，不必
              每次都佔一行。
            */}
            <div
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-zinc-500"
              title={t('mapEditor.trackGen.legendNote')}
              data-trackgen-legend
            >
              {(['rect', 'corner', 'switch', 'cross', 'taper'] as const).map((kind) => {
                const st = KIND_STYLE[kind]
                const n = extent?.shapes.filter((sh) => sh.kind === kind).length ?? 0
                return (
                  <span key={kind} className="flex items-center gap-1">
                    <span
                      className="inline-block size-2.5 rounded-[2px] border"
                      style={{ background: st.fill, borderColor: st.stroke }}
                      aria-hidden
                    />
                    {t(`mapEditor.trackGen.kinds.${kind}`)}
                    <b className="font-mono tabular-nums text-zinc-300">{n}</b>
                  </span>
                )
              })}
            </div>
          </div>
        </div>

        {/*
          分組與合併同一條工具列。

          兩者都是「在預覽上點軌道」的工具，一次只會用一個，所以只留一個展開區：誰在
          用就展開誰。收起來時整條只有一列高。
        */}
        <div className="rounded-md border border-zinc-700/70 bg-zinc-900/60">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5" data-trackgen-groups>
              <span className="text-[11px] font-medium text-zinc-300">
                {t('mapEditor.trackGen.groups.title')}
              </span>
              {liveGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  disabled={mergeMode || nudgeMode}
                  onClick={() => (editingId === g.id ? undefined : editGroup(g))}
                  className={`flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] transition disabled:opacity-40 ${
                    editingId === g.id
                      ? 'border-cyan-400 text-cyan-100'
                      : 'border-zinc-600 text-zinc-300 hover:border-zinc-400'
                  }`}
                >
                  <span
                    className="inline-block size-2.5 rounded-[2px] border border-zinc-500"
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
                  disabled={mergeMode}
                  data-trackgen-group-add
                  className="rounded border border-cyan-500/70 bg-cyan-500/10 px-1.5 py-0.5 text-[12px] leading-none text-cyan-200 transition hover:bg-cyan-500/25 disabled:opacity-40"
                  title={t('mapEditor.trackGen.groups.hint')}
                >
                  ＋
                </button>
              )}
            </div>

            <span className="mx-1 h-4 w-px shrink-0 bg-zinc-700" aria-hidden />

            <div className="flex flex-wrap items-center gap-1.5" data-trackgen-nudge>
              <span className="text-[11px] font-medium text-zinc-300">
                {t('mapEditor.trackGen.nudge.title')}
              </span>
              {nudges.length ? (
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    (extent?.nudgesApplied ?? nudges.length) < nudges.length
                      ? 'text-amber-300'
                      : 'text-zinc-500'
                  }`}
                  data-trackgen-nudge-count
                >
                  {extent?.nudgesApplied ?? nudges.length}/{nudges.length}
                </span>
              ) : null}
              {nudgeMode ? (
                <button
                  type="button"
                  data-trackgen-nudge-exit
                  onClick={() => {
                    setNudgeMode(false)
                    setDrag(null)
                  }}
                  className="rounded border border-zinc-600 px-1.5 py-0.5 text-[11px] text-zinc-300 transition hover:border-zinc-400"
                >
                  {t('mapEditor.trackGen.nudge.exit')}
                </button>
              ) : (
                <button
                  type="button"
                  data-trackgen-nudge-enter
                  disabled={!!editingId || mergeMode}
                  title={t('mapEditor.trackGen.nudge.hint')}
                  onClick={() => {
                    setEditingId(null)
                    setDraftBackup(null)
                    setNudgeMode(true)
                  }}
                  className="rounded border border-cyan-500/70 bg-cyan-500/10 px-1.5 py-0.5 text-[11px] text-cyan-200 transition hover:bg-cyan-500/25 disabled:opacity-40"
                >
                  {t('mapEditor.trackGen.nudge.enter')}
                </button>
              )}
              {nudges.length ? (
                <button
                  type="button"
                  data-trackgen-nudge-undo
                  title={t('mapEditor.trackGen.undoHint')}
                  onClick={undoLast}
                  className="rounded border border-zinc-600 px-1.5 py-0.5 text-[11px] text-zinc-300 transition hover:border-zinc-400"
                >
                  {t('mapEditor.trackGen.nudge.undo')}
                </button>
              ) : null}
            </div>

            <span className="mx-1 h-4 w-px shrink-0 bg-zinc-700" aria-hidden />

            <div className="flex flex-wrap items-center gap-1.5" data-trackgen-merge>
              <span className="text-[11px] font-medium text-zinc-300">
                {t('mapEditor.trackGen.merge.title')}
              </span>
              {merges.length ? (
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    (extent?.mergesApplied ?? merges.length) < merges.length
                      ? 'text-amber-300'
                      : 'text-zinc-500'
                  }`}
                  data-trackgen-merge-count
                >
                  {extent?.mergesApplied ?? merges.length}/{merges.length}
                </span>
              ) : null}
              {mergeMode ? (
                <button
                  type="button"
                  data-trackgen-merge-exit
                  onClick={exitMerge}
                  className="rounded border border-zinc-600 px-1.5 py-0.5 text-[11px] text-zinc-300 transition hover:border-zinc-400"
                >
                  {t('mapEditor.trackGen.merge.exit')}
                </button>
              ) : (
                <button
                  type="button"
                  data-trackgen-merge-enter
                  disabled={!!editingId || nudgeMode}
                  onClick={enterMerge}
                  title={t('mapEditor.trackGen.merge.hint')}
                  className="rounded border border-amber-500/70 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-200 transition hover:bg-amber-500/25 disabled:opacity-40"
                >
                  {t('mapEditor.trackGen.merge.enter')}
                </button>
              )}
              {merges.length ? (
                <button
                  type="button"
                  data-trackgen-merge-undo
                  onClick={() => {
                    setMerges((prev) => prev.slice(0, -1))
                    setPicks([])
                  }}
                  className="rounded border border-zinc-600 px-1.5 py-0.5 text-[11px] text-zinc-300 transition hover:border-zinc-400"
                >
                  {t('mapEditor.trackGen.merge.undo')}
                </button>
              ) : null}
            </div>
          </div>

          {editing ? (
            <div className="flex flex-wrap items-end gap-3 border-t border-zinc-800 px-3 py-2">
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
          ) : nudgeMode ? (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-800 px-3 py-2 text-[10px] text-zinc-400"
              data-trackgen-nudge-panel
            >
              <span>{t('mapEditor.trackGen.nudge.pickHandle')}</span>
              {extent?.nudgeErrors?.length ? (
                <>
                  <span className="text-zinc-600">·</span>
                  <span data-trackgen-nudge-error>
                    {t('mapEditor.trackGen.nudge.error', {
                      total: extent.nudgeTotalM ?? 0,
                      max: extent.nudgeMaxM ?? 0,
                    })}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {extent.nudgeErrors.slice(0, 6).map((x) => (
                      <span
                        key={x.name}
                        className={`rounded border px-1 py-0.5 font-mono ${
                          x.deltaM > 0
                            ? 'border-emerald-600/50 text-emerald-300'
                            : 'border-rose-600/50 text-rose-300'
                        }`}
                      >
                        {x.name} {x.deltaM > 0 ? '+' : ''}
                        {x.deltaM.toFixed(1)} m
                      </span>
                    ))}
                  </span>
                </>
              ) : null}
            </div>
          ) : mergeMode ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 px-3 py-2">
              {picks.map((n, i) => (
                <span
                  key={n}
                  className="rounded border border-amber-500/50 px-1.5 py-0.5 font-mono text-[11px] text-amber-200"
                >
                  {i + 1}. {n}
                </span>
              ))}
              {mergeChecks ? (
                <>
                  <button
                    type="button"
                    data-trackgen-merge-1to2
                    disabled={!mergeChecks.aToB.ok}
                    onClick={() => commitMerge(picks[0]!, picks[1]!)}
                    className="rounded border border-amber-500/70 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-100 transition hover:bg-amber-500/30 disabled:opacity-35"
                  >
                    {t('mapEditor.trackGen.merge.oneIntoTwo')}
                  </button>
                  <button
                    type="button"
                    data-trackgen-merge-2to1
                    disabled={!mergeChecks.bToA.ok}
                    onClick={() => commitMerge(picks[1]!, picks[0]!)}
                    className="rounded border border-amber-500/70 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-100 transition hover:bg-amber-500/30 disabled:opacity-35"
                  >
                    {t('mapEditor.trackGen.merge.twoIntoOne')}
                  </button>
                  {!mergeChecks.aToB.ok && !mergeChecks.bToA.ok ? (
                    <span className="text-[10px] text-amber-300/80" data-trackgen-merge-reason>
                      {t(
                        `mapEditor.trackGen.merge.reason.${
                          (mergeChecks.aToB as { reason: TrackGenMergeRefusal }).reason
                        }`,
                      )}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-[10px] text-zinc-500">
                  {t('mapEditor.trackGen.merge.pickTwo')}
                </span>
              )}
            </div>
          ) : null}
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

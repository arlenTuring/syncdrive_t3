#!/usr/bin/env node
/**
 * 重建「畫出來的中心線塌掉」的那幾塊。
 *
 * <h3>壞成什麼樣</h3>
 * T3 的兩塊分岔（D04/T01、U04/T03）身上存的是
 *   圖面 (1.000,0.875) → (0.000,0.500) → (0.000,0.875) → (0.000,0.125)
 * 四個點有三個 x 都是 0，整條擠在左邊緣；而渲染器實際畫出來的主線道是一條橫貫外框
 * 的直線（switchTrackPartCenterlinePaths 給的是 M 172.82 124.18 L 0.49 124.18）。
 * 存的跟畫的是兩回事。
 *
 * 現場那條也壞：十三個點好好地走完 road 2 的 7.5 公尺，然後<strong>一步跳到終點再
 * 重複三次</strong>，完全沒有跟著 road 12 的弧線。
 *
 * <h3>後果</h3>
 * 反推位置靠「沿線那一軸等於某個值」去找（alongAtAxisValue）。塌掉之後只有第一段
 * 有效，後半段永遠找不到，回推就飽和在同一個地方——實測後半段的回推 x 全部落在
 * −125 附近，真值卻一路走到 −136，差十二公尺。
 *
 * <h3>怎麼重建</h3>
 * 兩邊都照各自的權威來源重來，不自己編：
 *   現場那條 ← .xodr。身上的 trackGenSpans 已經寫明走哪條 road、哪條 lane、哪一段
 *              里程，照著取樣就是真正的路徑。
 *   圖面那條 ← 渲染器。switchTrackPartCenterlinePaths 給的就是畫在螢幕上的那條線。
 *   f 切點  ← 用新路徑的累積弧長重算，兩條線才對得起來。
 *
 * 用法：
 *   node --import tsx scripts/rebuild-collapsed-track-paths.mts <地圖.json> <T3.xodr> [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const [, , mapPath, xodrPath, ...flags] = process.argv
if (!mapPath || !xodrPath) {
  console.error('用法：node --import tsx scripts/rebuild-collapsed-track-paths.mts <地圖.json> <T3.xodr> [--write]')
  process.exit(1)
}
const write = flags.includes('--write')

const dom = new JSDOM('')
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node

const B = '../src/features/map-editor'
const { parseLaneCenterlines } = await import(`${B}/opendrive/laneCenterlines.ts`)
const { parseMapFileJson } = await import(`${B}/utils/mapFileJson.ts`)
const { resolveFacilityAreaSize } = await import(`${B}/utils/facilityAreaCoords.ts`)
const { readSwitchTrack, switchTrackHandlesPx } = await import(`${B}/utils/trackShapes.ts`)

const lanes = parseLaneCenterlines(readFileSync(xodrPath, 'utf8')).lanes
const laneOf = (road: string, lane: number) =>
  lanes.find((l: any) => String(l.roadId) === String(road) && l.laneId === lane)

/** 長邊上的相異值少於三個＝塌掉（兩點的直線是正常的） */
function collapsed(local: Array<[number, number]>): boolean {
  if (local.length < 3) return false
  const first = local[0]!
  const last = local[local.length - 1]!
  const axis = Math.abs(last[0] - first[0]) >= Math.abs(last[1] - first[1]) ? 0 : 1
  return new Set(local.map((p) => p[axis].toFixed(3))).size < 3
}

/** 照給定的里程範圍，把車道中心線上的點抓出來（含兩端） */
function samplesIn(span: any, s0: number, s1: number): Array<[number, number]> {
  const lane = laneOf(span.road, span.lane)
  if (!lane) return []
  const lo = Math.min(s0, s1)
  const hi = Math.max(s0, s1)
  const out: Array<[number, number]> = []
  for (let i = 0; i < lane.points.length; i++) {
    const st = lane.stations[i]
    if (st < lo - 0.01 || st > hi + 0.01) continue
    out.push([Number(lane.points[i].x.toFixed(2)), Number(lane.points[i].y.toFixed(2))])
  }
  if (s0 > s1) out.reverse()
  return out
}

/**
 * 同一段里程的兩個可能位置。
 *
 * 正號車道的里程與 road 的 s 反向，所以「s 7.5 到 15」在 lane 1 上指的是哪半段，
 * 會因為當初是用哪一種慣例寫的而不同。實測 U04/T03 存的是 road 2 lane 1 s 7.5~15，
 * 但它畫的那一段在 lane 1 上其實是 7.79 到 0.29——存的指到了另外半段，接起來會跳
 * 十四公尺。
 *
 * 不用猜是哪一種：兩個都試，取接起來<strong>連續</strong>的那一個。接不起來就不重建。
 */
function candidateRanges(span: any): Array<[number, number]> {
  const lane = laneOf(span.road, span.lane)
  if (!lane) return []
  const L = lane.lengthM
  const mirrored: [number, number] = [L - span.s0, L - span.s1]
  return [[span.s0, span.s1], mirrored]
}

/** 這條路徑最大的相鄰間距；接得起來的話應該接近取樣間距 */
function maxGapOf(path: Array<[number, number]>): number {
  let max = 0
  for (let i = 1; i < path.length; i++) {
    const g = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
    if (g > max) max = g
  }
  return max
}

/** 接起來還算連續的間距上限（公尺）。車道取樣間距約 1 公尺。 */
const MAX_JOIN_GAP_M = 2

const rawMap = JSON.parse(readFileSync(mapPath, 'utf8'))
const doc = rawMap.mapDocument ?? rawMap
const parsedAreas = parseMapFileJson(doc).areas

let rebuilt = 0
let skipped = 0

for (const [ai, area] of (doc.areas ?? []).entries()) {
  const parsedArea = parsedAreas[ai]
  for (const f of area.facilities ?? []) {
    const params = f.parameters ?? {}
    const local = params.trackGenLocalPath
    const spans = params.trackGenSpans
    if (!Array.isArray(local) || !Array.isArray(spans) || spans.length === 0) continue
    if (!collapsed(local)) continue

    const label = (f.customName ?? f.id ?? '').trim()
    if (f.name !== 'RailSwitch') {
      console.log(`  ${label}：不是分岔（${f.name}），這支只處理分岔，略過`)
      skipped++
      continue
    }

    // 1. 現場那條：照 spans 逐段從 .xodr 取樣，里程方向兩種都試，取接得起來的
    const ordered = [...spans].sort((a, b) => Math.min(a.f0, a.f1) - Math.min(b.f0, b.f1))
    const perSpan = ordered.map((sp) => candidateRanges(sp))
    if (perSpan.some((c) => c.length === 0)) {
      console.log(`  ${label}：.xodr 裡找不到它指的車道，不重建`)
      skipped++
      continue
    }
    const assemble = (pick: number[]) => {
      const segs = ordered.map((sp, i) => samplesIn(sp, perSpan[i][pick[i]][0], perSpan[i][pick[i]][1]))
      if (segs.some((g) => g.length < 2)) return null
      const out: Array<[number, number]> = []
      for (const g of segs) {
        for (const p of g) {
          const last = out[out.length - 1]
          if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 0.01) continue
          out.push(p)
        }
      }
      return out.length >= 3 ? { path: out, gap: maxGapOf(out), segs } : null
    }
    let bestPick: { pick: number[]; path: Array<[number, number]>; gap: number; segs: Array<Array<[number, number]>> } | null = null
    const combos = perSpan.reduce<number[][]>(
      (acc, c) => acc.flatMap((prefix) => c.map((_, i) => [...prefix, i])),
      [[]],
    )
    for (const pick of combos) {
      const got = assemble(pick)
      if (!got) continue
      if (!bestPick || got.gap < bestPick.gap) bestPick = { pick, ...got }
    }
    if (!bestPick || bestPick.gap > MAX_JOIN_GAP_M) {
      console.log(
        `  ${label}：各段接不起來（最大間距 ${bestPick ? bestPick.gap.toFixed(2) : '?'}m 超過 ${MAX_JOIN_GAP_M}m），不重建`,
      )
      skipped++
      continue
    }
    const real = bestPick.path
    // 里程方向被翻過的，把 span 上的值一起更正，否則存的跟畫的又對不起來
    ordered.forEach((sp, i) => {
      const [a, b] = perSpan[i][bestPick!.pick[i]]
      sp.s0 = Number(a.toFixed(2))
      sp.s1 = Number(b.toFixed(2))
    })

    // 2. f 切點：照新路徑的累積弧長重算
    const cum = [0]
    for (let i = 1; i < real.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(real[i][0] - real[i - 1][0], real[i][1] - real[i - 1][1]))
    }
    const total = cum[cum.length - 1]
    let consumed = 0
    for (const [i, sp] of ordered.entries()) {
      const pts = bestPick.segs[i]
      let len = 0
      for (let i = 1; i < pts.length; i++) {
        len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      }
      sp.f0 = Number((consumed / total).toFixed(4))
      consumed += len
      sp.f1 = Number(Math.min(1, consumed / total).toFixed(4))
    }
    ordered[ordered.length - 1].f1 = 1
    params.trackGenSpans = ordered

    // 3. 圖面那條：主線道的端面，就是渲染器畫出來的那一條
    const size = resolveFacilityAreaSize(
      parsedArea.facilities.find((x: any) => x.id === f.id),
      parsedArea.domain,
      parsedArea.layout,
    )
    const handles = switchTrackHandlesPx(readSwitchTrack(params), size.w, size.h)
    const uv = (p: { x: number; y: number }) => [
      Number(Math.max(0, Math.min(1, p.x / size.w)).toFixed(4)),
      Number(Math.max(0, Math.min(1, p.y / size.h)).toFixed(4)),
    ] as [number, number]
    const nextLocal: Array<[number, number]> = [uv(handles.a), uv(handles.m)]

    console.log(`  ${label}`)
    console.log(`    圖面 ${JSON.stringify(local)}`)
    console.log(`      →  ${JSON.stringify(nextLocal)}`)
    console.log(`    現場 ${real.length} 點（原 ${params.trackGenRealPath.length} 點），`
      + `${real[0]} → ${real[real.length - 1]}，全長 ${total.toFixed(1)}m`)
    console.log(`    里程 ${ordered.map((s: any) => `road ${s.road} f ${s.f0}~${s.f1}`).join('、')}`)

    params.trackGenLocalPath = nextLocal
    params.trackGenRealPath = real
    // 場域範圍照新的中心線重算（往兩側各撐半個車道）
    const HALF = 1.675
    params.refFieldXMinM = Number((Math.min(...real.map((p) => p[0])) - HALF).toFixed(2))
    params.refFieldXMaxM = Number((Math.max(...real.map((p) => p[0])) + HALF).toFixed(2))
    params.refFieldYMinM = Number((Math.min(...real.map((p) => p[1])) - HALF).toFixed(2))
    params.refFieldYMaxM = Number((Math.max(...real.map((p) => p[1])) + HALF).toFixed(2))
    rebuilt++
  }
}

console.log(`\n重建 ${rebuilt} 塊、略過 ${skipped} 塊`)
if (write && rebuilt > 0) {
  writeFileSync(mapPath, JSON.stringify(rawMap, null, 2))
  console.log(`已寫回 ${mapPath}`)
} else if (!write) {
  console.log('（未加 --write，檔案沒有變動）')
}

#!/usr/bin/env node
/**
 * 補上路口方塊缺的里程對應。
 *
 * <h3>為什麼會缺</h3>
 * 路口方塊（分岔、交叉）畫出來的中心線會延伸進 junction 的連接道，而連接道在
 * OpenDRIVE 裡是<strong>另一組 road</strong>。軌道生成時只登記了主線那一段，
 * 連接道那一截沒有 road／lane／里程。
 *
 * 沒有里程對應 = 不會進定位索引（buildTrackGenIndex 開頭就是 if (!spans.length)
 * continue，而且逐段登記，沒蓋到的那一截同樣查不到）。落在那裡的點只能被附近
 * 別的段搶去解釋，投影到錯的位置。T3 實測：D04/T01 只蓋到 25%，往返誤差 17 公尺，
 * 九個取樣點有三個被判給 D05。
 *
 * <h3>怎麼補</h3>
 * 不猜。把沒蓋到的那一截沿中心線取樣，拿去跟 .xodr 裡<strong>每一條</strong>車道
 * 中心線比對，取平均距離最小的那一條；距離超過門檻就不補——寧可沒有，也不要把車
 * 放到錯的分支上。
 *
 * 用法：
 *   node scripts/fill-junction-track-spans.mjs <地圖.json> <T3.xodr> [--write]
 *
 * 不加 --write 只印出會怎麼補，不動檔案。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const [, , mapPath, xodrPath, ...flags] = process.argv
if (!mapPath || !xodrPath) {
  console.error('用法：node scripts/fill-junction-track-spans.mjs <地圖.json> <T3.xodr> [--write]')
  process.exit(1)
}
const write = flags.includes('--write')

// parseLaneCenterlines 用瀏覽器的 DOMParser
const dom = new JSDOM('')
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node

const { parseLaneCenterlines } = await import('../src/features/map-editor/opendrive/laneCenterlines.ts')

/** 中心線上取 t（0–1）處的點；與 trackGenPaths.pointAlongPath 同樣按弧長 */
function pointAt(path, t) {
  const lens = [0]
  for (let i = 1; i < path.length; i++) {
    lens.push(lens[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
  }
  const total = lens[lens.length - 1]
  if (total <= 0) return { x: path[0][0], y: path[0][1] }
  const target = total * Math.min(1, Math.max(0, t))
  let i = 1
  while (i < lens.length - 1 && lens[i] < target) i++
  const seg = lens[i] - lens[i - 1] || 1
  const f = (target - lens[i - 1]) / seg
  return {
    x: path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f,
    y: path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f,
  }
}

/** 這個點落在該車道中心線的哪一段里程，以及離它多遠 */
function nearestOnLane(lane, p) {
  let best = { d: Infinity, s: 0 }
  for (let i = 0; i < lane.points.length; i++) {
    const q = lane.points[i]
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d < best.d) best = { d, s: lane.stations[i] }
  }
  return best
}

const rawMap = JSON.parse(readFileSync(mapPath, 'utf8'))
const doc = rawMap.mapDocument ?? rawMap
const lanes = parseLaneCenterlines(readFileSync(xodrPath, 'utf8')).lanes
  .filter((l) => l.laneType === 'driving')

/** 補進來的里程離中心線平均多遠還能接受（公尺） */
const MAX_FIT_M = 3.5
const SAMPLES = 9

let filled = 0
let skipped = 0

for (const area of doc.areas ?? []) {
  for (const f of area.facilities ?? []) {
    const params = f.parameters ?? {}
    const real = params.trackGenRealPath
    const spans = params.trackGenSpans
    if (!Array.isArray(real) || real.length < 2) continue
    if (!Array.isArray(spans) || spans.length === 0) continue

    // 目前蓋到哪些 f 區間
    const merged = spans
      .map((s) => [Math.min(s.f0, s.f1), Math.max(s.f0, s.f1)])
      .sort((a, b) => a[0] - b[0])
      .reduce((acc, seg) => {
        const last = acc[acc.length - 1]
        if (last && seg[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], seg[1])
        else acc.push([...seg])
        return acc
      }, [])

    const holes = []
    let cursor = 0
    for (const [a, b] of merged) {
      if (a > cursor + 1e-6) holes.push([cursor, a])
      cursor = Math.max(cursor, b)
    }
    if (cursor < 1 - 1e-6) holes.push([cursor, 1])
    if (holes.length === 0) continue

    const label = (f.customName ?? f.id ?? '').trim()
    for (const [from, to] of holes) {
      // 缺口內取樣，找最合的那一條車道
      const pts = Array.from({ length: SAMPLES }, (_, i) =>
        pointAt(real, from + ((to - from) * (i + 0.5)) / SAMPLES),
      )
      let best = null
      for (const lane of lanes) {
        let sum = 0
        let worst = 0
        for (const p of pts) {
          const hit = nearestOnLane(lane, p)
          sum += hit.d
          if (hit.d > worst) worst = hit.d
        }
        const mean = sum / pts.length
        if (!best || mean < best.mean) best = { lane, mean, worst }
      }
      if (!best || best.mean > MAX_FIT_M) {
        console.log(
          `  ${label} f ${from.toFixed(3)}~${to.toFixed(3)}：最接近的是 road ${best?.lane.roadId} lane ${best?.lane.laneId}，`
          + `平均差 ${best?.mean.toFixed(2)}m 超過門檻 ${MAX_FIT_M}m，不補`,
        )
        skipped++
        continue
      }
      const s0 = nearestOnLane(best.lane, pointAt(real, from)).s
      const s1 = nearestOnLane(best.lane, pointAt(real, to)).s
      if (Math.abs(s1 - s0) < 0.5) {
        console.log(`  ${label} f ${from.toFixed(3)}~${to.toFixed(3)}：對到的里程幾乎沒有長度，不補`)
        skipped++
        continue
      }
      const span = {
        road: String(best.lane.roadId),
        lane: best.lane.laneId,
        s0: Number(s0.toFixed(2)),
        s1: Number(s1.toFixed(2)),
        h: null,
        f0: Number(from.toFixed(4)),
        f1: Number(to.toFixed(4)),
      }
      spans.push(span)
      filled++
      console.log(
        `  ${label} f ${span.f0}~${span.f1} → road ${span.road} lane ${span.lane} `
        + `s ${span.s0}~${span.s1}（平均差 ${best.mean.toFixed(2)}m、最遠 ${best.worst.toFixed(2)}m）`,
      )
    }
    spans.sort((a, b) => Math.min(a.f0, a.f1) - Math.min(b.f0, b.f1))
  }
}

console.log(`\n補上 ${filled} 段、略過 ${skipped} 段`)
if (write && filled > 0) {
  writeFileSync(mapPath, JSON.stringify(rawMap, null, 2))
  console.log(`已寫回 ${mapPath}`)
} else if (!write) {
  console.log('（未加 --write，檔案沒有變動）')
}

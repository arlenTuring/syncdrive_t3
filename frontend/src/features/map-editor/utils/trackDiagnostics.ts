import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { resolveFacilityAreaSize } from './facilityAreaCoords'
import {
  collectTrackAnchors,
  nearestTrackAnchor,
  faceUvOfHandle,
  type TrackAnchor,
} from './shapedTrackPaths'
import { getTrackGenPaths, getTrackGenSpans, pointAlongPath } from './trackGenPaths'
import { readSwitchTrack, switchTrackHandlesPx } from './trackShapes'
import { trackLocalPathPointToAreaLocal } from '../vehicles/resolveVehicleTrackPlacement'

/**
 * 軌道檢查：整張圖的軌道，圖面位置與現場座標對不對得上。
 *
 * 使用者看不出一塊軌道的圖面路徑是不是上下顛倒、現場中心線是不是抄到別處，所以由系統判斷，
 * 只把有問題的列出來。判斷的依據永遠是同一件事：軌道是接起來的——圖上貼著的兩塊，端點的現場座標
 * 也該貼著。載入時能自動修的（複製來的軌道、分岔比路口短、分岔圖面路徑）已經修掉了，這裡列的是
 * 修完之後還對不上、機器又看不出誰對誰錯的。
 */

export type TrackIssueSeverity = 'error' | 'warn'
export type TrackIssueKind = 'junction' | 'overlap' | 'switch-face'

export type TrackIssue = {
  /** 穩定的鍵，給列表用 */
  key: string
  areaId: string
  facilityId: string
  label: string
  kind: TrackIssueKind
  severity: TrackIssueSeverity
  title: string
  detail: string
  suggestion: string
}

export type TrackDiagnostics = {
  issues: TrackIssue[]
  /** 每塊有問題的軌道最嚴重的狀態；沒有問題的不在裡面 */
  statusByFacility: Map<string, TrackIssueSeverity>
}

/** 端點與隔壁差這麼多公尺以內算接得上（生成的軌道差 0.0x 公尺） */
export const JUNCTION_OK_M = 3
/** 差超過這麼多公尺是明顯錯誤，不是偏移 */
export const JUNCTION_ERROR_M = 15
/** 「貼著」的圖面距離（區域像素），與過期偵測一致 */
const NEAR_PX = 12
/** 同一條車道上兩塊軌道的里程重疊超過這麼多公尺，就是有一塊多算了 */
export const SPAN_OVERLAP_M = 5

function isPlainTrack(f: FacilityObject): boolean {
  return f.type === 'Track' && (f.name === 'Rail' || f.name === 'RailTaper' || f.name === 'RailCorner')
}

function labelOf(f: FacilityObject | undefined): string {
  if (!f) return '?'
  const parts = f.parameters?.trackGenPartNames as Record<string, string> | undefined
  const partLabel = parts ? Object.values(parts).filter(Boolean).join('/') : ''
  return f.customName?.trim() || partLabel || `${f.name} ${f.id}`
}

export function diagnoseTracks(areas: MapAreaObject[]): TrackDiagnostics {
  const issues: TrackIssue[] = []
  const statusByFacility = new Map<string, TrackIssueSeverity>()
  // 同一個接點從兩邊各報一次太吵：一般軌道那一側已經報過的，分岔那一側不再重複
  const junctionPairs = new Set<string>()
  const switchIssues: Array<{ issue: TrackIssue; pair: string; facilityId: string }> = []
  const mark = (id: string, severity: TrackIssueSeverity) => {
    if (severity === 'error' || !statusByFacility.has(id)) statusByFacility.set(id, severity)
  }

  for (const area of areas) {
    const anchors = collectTrackAnchors(area)
    const byId = new Map(area.facilities.map((f) => [f.id, f]))

    // 同一條車道（road:lane）上，兩塊軌道的里程不該重疊：重疊就是有一塊的中心線多算了一段
    // （U18 的現場中心線長 168 公尺，是圖上兩塊的長度加起來，與 U17 重疊 85 公尺）
    const byLane = new Map<string, Array<{ f: FacilityObject; lo: number; hi: number }>>()
    for (const f of area.facilities) {
      if (!isPlainTrack(f)) continue
      for (const sp of getTrackGenSpans(f.parameters)) {
        const key = `${sp.road}:${sp.lane}`
        const list = byLane.get(key) ?? []
        list.push({ f, lo: Math.min(sp.s0, sp.s1), hi: Math.max(sp.s0, sp.s1) })
        byLane.set(key, list)
      }
    }
    // 同一對軌道可能在好幾段里程上重疊（一塊有兩段 span），合併成一筆
    const pairs = new Map<
      string,
      { lane: string; longer: FacilityObject; shorter: FacilityObject; overlap: number; lLo: number; lHi: number; sLo: number; sHi: number }
    >()
    for (const [lane, list] of byLane) {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i]!
          const b = list[j]!
          if (a.f.id === b.f.id) continue
          const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo)
          if (overlap <= 0) continue
          // 較長的那塊多半是多算的
          const [longer, shorter] = a.hi - a.lo >= b.hi - b.lo ? [a, b] : [b, a]
          const key = `${lane}|${longer.f.id}|${shorter.f.id}`
          const prev = pairs.get(key)
          if (prev) {
            prev.overlap += overlap
            prev.sLo = Math.min(prev.sLo, shorter.lo)
            prev.sHi = Math.max(prev.sHi, shorter.hi)
          } else {
            pairs.set(key, {
              lane,
              longer: longer.f,
              shorter: shorter.f,
              overlap,
              lLo: longer.lo,
              lHi: longer.hi,
              sLo: shorter.lo,
              sHi: shorter.hi,
            })
          }
        }
      }
    }
    for (const p of pairs.values()) {
      if (p.overlap <= SPAN_OVERLAP_M) continue
      const ln = labelOf(p.longer)
      const sn = labelOf(p.shorter)
      issues.push({
        key: `${p.longer.id}:overlap:${p.shorter.id}`,
        areaId: area.id,
        facilityId: p.longer.id,
        label: ln,
        kind: 'overlap',
        severity: 'error',
        title: `${ln} 與 ${sn} 覆蓋了同一段路（${p.overlap.toFixed(0)} 公尺）`,
        detail:
          `車道 ${p.lane} 上，${ln} 的里程 ${p.lLo.toFixed(0)}～${p.lHi.toFixed(0)} 與 ` +
          `${sn} 的 ${p.sLo.toFixed(0)}～${p.sHi.toFixed(0)} 重疊 ${p.overlap.toFixed(0)} 公尺。`,
        suggestion:
          `${ln} 的現場中心線多半多算了一段（可能是兩塊軌道的長度合起來卻畫成一塊）。` +
          `把 ${ln} 的現場中心線縮短到只涵蓋它自己那段。`,
      })
      mark(p.longer.id, 'error')
      mark(p.shorter.id, 'warn')
    }

    for (const f of area.facilities) {
      if (f.type !== 'Track') continue
      const paths = getTrackGenPaths(f.parameters)
      if (!paths) continue
      const label = labelOf(f)

      if (isPlainTrack(f)) {
        const neighbourIds = new Set<string>()
        for (const t of [0, 1] as const) {
          const uv = pointAlongPath(paths.local, t)
          const at = trackLocalPathPointToAreaLocal(f, area, uv)
          const near = nearestTrackAnchor(anchors, at.x, at.y, f.id, NEAR_PX)
          if (!near) continue
          neighbourIds.add(near.facilityId)
          const own = pointAlongPath(paths.real, t)
          const diffM = Math.hypot(near.xM - own.x, near.yM - own.y)
          if (diffM <= JUNCTION_OK_M) continue
          const severity: TrackIssueSeverity = diffM > JUNCTION_ERROR_M ? 'error' : 'warn'
          junctionPairs.add(`${f.id}|${near.facilityId}`)
          const nb = labelOf(byId.get(near.facilityId))
          const endName = t === 0 ? '起點' : '終點'
          issues.push({
            key: `${f.id}:junction:${t}`,
            areaId: area.id,
            facilityId: f.id,
            label,
            kind: 'junction',
            severity,
            title: `${label} 的${endName}接不上 ${nb}`,
            detail: `圖上 ${label} 的${endName}貼著 ${nb}，但兩者的現場座標差 ${diffM.toFixed(1)} 公尺。`,
            suggestion:
              `多半是 ${label} 或 ${nb} 的現場中心線抄到別處、或圖面路徑上下顛倒。` +
              `在圖上稍微移動 ${label}，系統會依鄰居重建它的中心線；` +
              `若兩塊互相對不上，請確認哪一塊的現場座標才是對的。`,
          })
          mark(f.id, severity)
        }

            } else if (f.name === 'RailSwitch') {
        // 分岔各個口貼著的一般軌道，端點該接得上中心線的其中一端；差在正常出口偏移以內不算
        const size = resolveFacilityAreaSize(f, area.domain, area.layout)
        const handles = switchTrackHandlesPx(readSwitchTrack(f.parameters), size.w, size.h)
        const plain = anchors.filter((a) => isPlainTrack(byId.get(a.facilityId) ?? f))
        const first = paths.real[0]!
        const last = paths.real[paths.real.length - 1]!
        for (const k of ['a', 'm', 'b'] as const) {
          const uv = faceUvOfHandle(handles[k], size)
          const at = trackLocalPathPointToAreaLocal(f, area, uv)
          const near = nearestTrackAnchor(plain, at.x, at.y, f.id, 40)
          if (!near) continue
          const d = Math.min(
            Math.hypot(near.xM - first[0], near.yM - first[1]),
            Math.hypot(near.xM - last[0], near.yM - last[1]),
          )
          if (d <= JUNCTION_ERROR_M) continue
          const nb = labelOf(byId.get(near.facilityId))
          const face = k === 'a' ? '進口' : k === 'm' ? '直行出口' : '岔出出口'
          switchIssues.push({ pair: `${near.facilityId}|${f.id}`, facilityId: f.id, issue: {
            key: `${f.id}:switch:${k}`,
            areaId: area.id,
            facilityId: f.id,
            label,
            kind: 'switch-face',
            severity: 'error',
            title: `分岔 ${label} 的${face}接不上 ${nb}`,
            detail: `分岔 ${label} 的${face}貼著 ${nb}，但 ${nb} 的端點離分岔中心線的兩端都超過 ${d.toFixed(0)} 公尺。`,
            suggestion: `檢查 ${nb} 的現場中心線是否正確（是否誤抄、或圖面路徑上下顛倒）。`,
          } })
        }
      }
    }
  }

  for (const c of switchIssues) {
    if (junctionPairs.has(c.pair)) continue
    issues.push(c.issue)
    mark(c.facilityId, 'error')
  }

  const order = { error: 0, warn: 1 } as const
  issues.sort((a, b) => order[a.severity] - order[b.severity] || a.label.localeCompare(b.label))
  return { issues, statusByFacility }
}

export type { TrackAnchor }

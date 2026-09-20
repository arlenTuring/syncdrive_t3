import type { MapAreaObject, TrackJoint } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { collectTrackAnchors, type TrackAnchor } from './shapedTrackPaths'
import { getTrackGenPaths, TRACKGEN_REAL_PATH_KEY } from './trackGenPaths'

/**
 * 軌道接點。
 *
 * 兩塊軌道相接時，「接在哪個現場座標」原本由兩邊各存一份（各自中心線的端點），
 * 兩份可以不一樣，於是有了一整套「發現不一致再修」的機制。改成<strong>接點只存一份</strong>：
 * 軌道端點只記「我接在哪個接點」，現場中心線的頭尾由接點決定，不一致在結構上不會發生。
 *
 * 綁定存在軌道自己的 <code>parameters.trackGenEnds</code>：
 * 一般／斜接／圓角 → <code>{ start, end }</code>，交叉軌道 → <code>{ lt, lb, rt, rb }</code>，值是接點 id。
 * 接點在圖上的位置（px/py）只是快取，每次同步依成員重算；現場座標（xM/yM）是<strong>唯一真相</strong>，
 * 建立時取成員現場端點的平均，之後軌道被拖動也不變（停靠點留在現場座標）。
 */
export const TRACKGEN_ENDS_KEY = 'trackGenEnds'

/** 圖面上兩個端點近到這麼多像素，且現場座標也夠近，才併成同一個接點 */
export const JOINT_CLUSTER_PX = 24
/** 併成同一個接點的現場距離上限（公尺）；差更遠的是接錯了，不硬併 */
export const JOINT_CLUSTER_M = 6
/** 已綁定的端點離接點超過這麼多像素，視為被拖開了，放掉再重新找 */
export const JOINT_KEEP_PX = 60

export type TrackEnds = Record<string, string>

/** 一個端點在 trackGenEnds 裡的鍵 */
export function endSlotOf(a: { end: 0 | 1; port?: string }): string {
  return a.port ?? (a.end === 0 ? 'start' : 'end')
}

export function getTrackEnds(parameters: Record<string, unknown> | undefined): TrackEnds {
  const raw = parameters?.[TRACKGEN_ENDS_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: TrackEnds = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v
  }
  return out
}

function round2(n: number): number {
  return Number(n.toFixed(2))
}

function nextJointId(used: Set<string>): string {
  let n = used.size + 1
  while (used.has(`J${n}`)) n += 1
  const id = `J${n}`
  used.add(id)
  return id
}

type Member = { anchor: TrackAnchor; slot: string }

/**
 * 依端點位置整理接點：保留還貼著的綁定、放掉被拖開的、把新貼在一起的端點併成新接點。
 * 只動 trackJoints 與各軌道的 trackGenEnds，不動中心線（那是 {@link applyTrackJointsInAreas} 的事）。
 */
export function syncTrackJointsInAreas(areas: MapAreaObject[]): {
  areas: MapAreaObject[]
  created: number
  dropped: number
} {
  let created = 0
  let dropped = 0
  const next = areas.map((area) => {
    const anchors = collectTrackAnchors(area)
    const existing = new Map((area.trackJoints ?? []).map((j) => [j.id, j]))
    const usedIds = new Set(existing.keys())
    const bindings = new Map<string, Member[]>() // jointId → members
    const free: Member[] = []
    const facById = new Map(area.facilities.map((f) => [f.id, f]))

    for (const anchor of anchors) {
      const slot = endSlotOf(anchor)
      const f = facById.get(anchor.facilityId)
      const jointId = f ? getTrackEnds(f.parameters)[slot] : undefined
      const joint = jointId ? existing.get(jointId) : undefined
      if (joint && Math.hypot(anchor.px - joint.px, anchor.py - joint.py) <= JOINT_KEEP_PX) {
        const list = bindings.get(joint.id) ?? []
        list.push({ anchor, slot })
        bindings.set(joint.id, list)
      } else {
        free.push({ anchor, slot })
      }
    }

    // 自由端點先找貼得上的既有接點
    const stillFree: Member[] = []
    for (const m of free) {
      let best: TrackJoint | null = null
      let bestD = Infinity
      for (const j of existing.values()) {
        if (!bindings.has(j.id)) continue
        const d = Math.hypot(m.anchor.px - j.px, m.anchor.py - j.py)
        const dm = Math.hypot(m.anchor.xM - j.xM, m.anchor.yM - j.yM)
        if (d <= JOINT_CLUSTER_PX && dm <= JOINT_CLUSTER_M && d < bestD) {
          best = j
          bestD = d
        }
      }
      if (best) bindings.get(best.id)!.push(m)
      else stillFree.push(m)
    }

    // 剩下的彼此貼在一起的併成新接點（並查集）
    const parent = stillFree.map((_, i) => i)
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
    for (let i = 0; i < stillFree.length; i += 1) {
      for (let j = i + 1; j < stillFree.length; j += 1) {
        const a = stillFree[i]!.anchor
        const b = stillFree[j]!.anchor
        if (a.facilityId === b.facilityId) continue
        if (
          Math.hypot(a.px - b.px, a.py - b.py) <= JOINT_CLUSTER_PX &&
          Math.hypot(a.xM - b.xM, a.yM - b.yM) <= JOINT_CLUSTER_M
        ) {
          parent[find(i)] = find(j)
        }
      }
    }
    const groups = new Map<number, Member[]>()
    stillFree.forEach((m, i) => {
      const root = find(i)
      groups.set(root, [...(groups.get(root) ?? []), m])
    })
    const fresh: TrackJoint[] = []
    for (const members of groups.values()) {
      if (new Set(members.map((m) => m.anchor.facilityId)).size < 2) continue
      const n = members.length
      const joint: TrackJoint = {
        id: nextJointId(usedIds),
        px: round2(members.reduce((s, m) => s + m.anchor.px, 0) / n),
        py: round2(members.reduce((s, m) => s + m.anchor.py, 0) / n),
        xM: round2(members.reduce((s, m) => s + m.anchor.xM, 0) / n),
        yM: round2(members.reduce((s, m) => s + m.anchor.yM, 0) / n),
      }
      fresh.push(joint)
      bindings.set(joint.id, members)
      created += 1
    }

    // 整理：少於兩塊的接點不留；位置快取依成員重算
    const all = [...existing.values(), ...fresh]
    const joints: TrackJoint[] = []
    const slotOf = new Map<string, Record<string, string>>() // facilityId → ends
    for (const j of all) {
      const members = bindings.get(j.id) ?? []
      if (new Set(members.map((m) => m.anchor.facilityId)).size < 2) {
        if (existing.has(j.id)) dropped += 1
        continue
      }
      const n = members.length
      joints.push({
        ...j,
        px: round2(members.reduce((s, m) => s + m.anchor.px, 0) / n),
        py: round2(members.reduce((s, m) => s + m.anchor.py, 0) / n),
      })
      for (const m of members) {
        const ends = slotOf.get(m.anchor.facilityId) ?? {}
        ends[m.slot] = j.id
        slotOf.set(m.anchor.facilityId, ends)
      }
    }

    let touched = false
    const facilities = area.facilities.map((f) => {
      if (f.type !== 'Track') return f
      const want = slotOf.get(f.id) ?? {}
      const have = getTrackEnds(f.parameters)
      const same =
        Object.keys(want).length === Object.keys(have).length &&
        Object.entries(want).every(([k, v]) => have[k] === v)
      if (same) return f
      touched = true
      const parameters = { ...(f.parameters ?? {}) } as Record<string, unknown>
      if (Object.keys(want).length > 0) parameters[TRACKGEN_ENDS_KEY] = want
      else delete parameters[TRACKGEN_ENDS_KEY]
      return { ...f, parameters } as FacilityObject
    })
    const jointsChanged = JSON.stringify(joints) !== JSON.stringify(area.trackJoints ?? [])
    if (!touched && !jointsChanged) return area
    const out = { ...area, facilities } as MapAreaObject
    if (joints.length > 0) out.trackJoints = joints
    else delete out.trackJoints
    return out
  })
  return { areas: next, created, dropped }
}

/** 中心線頭尾改成接點的現場座標。交叉軌道的口由鄰居端點解析，鄰居改了它就跟著改。 */
export function applyTrackJointsInAreas(areas: MapAreaObject[]): {
  areas: MapAreaObject[]
  moved: number
} {
  let moved = 0
  const next = areas.map((area) => {
    const joints = new Map((area.trackJoints ?? []).map((j) => [j.id, j]))
    if (joints.size === 0) return area
    let touched = false
    const facilities = area.facilities.map((f) => {
      if (f.type !== 'Track' || f.name === 'RailCross') return f
      const ends = getTrackEnds(f.parameters)
      const paths = getTrackGenPaths(f.parameters)
      if (!paths) return f
      const real = paths.real.map((p) => [p[0], p[1]] as [number, number])
      let changed = false
      const set = (idx: number, jointId: string | undefined) => {
        const j = jointId ? joints.get(jointId) : undefined
        if (!j) return
        const cur = real[idx]!
        if (Math.hypot(cur[0] - j.xM, cur[1] - j.yM) < 0.005) return
        real[idx] = [j.xM, j.yM]
        changed = true
      }
      set(0, ends.start)
      set(real.length - 1, ends.end)
      if (!changed) return f
      touched = true
      moved += 1
      return {
        ...f,
        parameters: { ...(f.parameters ?? {}), [TRACKGEN_REAL_PATH_KEY]: real },
      } as FacilityObject
    })
    return touched ? { ...area, facilities } : area
  })
  return { areas: next, moved }
}

export type TrackJointIssue = {
  areaId: string
  jointId: string
  facilityId?: string
  kind: 'dangling' | 'lonely' | 'drift'
  detail: string
}

/** 結構檢查：綁到不存在的接點、只剩一塊的接點、中心線端點離接點太遠 */
export function validateTrackJoints(area: MapAreaObject, driftM = 0.5): TrackJointIssue[] {
  const issues: TrackJointIssue[] = []
  const joints = new Map((area.trackJoints ?? []).map((j) => [j.id, j]))
  const refs = new Map<string, Set<string>>()
  for (const f of area.facilities) {
    if (f.type !== 'Track') continue
    const ends = getTrackEnds(f.parameters)
    const paths = getTrackGenPaths(f.parameters)
    for (const [slot, id] of Object.entries(ends)) {
      const j = joints.get(id)
      if (!j) {
        issues.push({ areaId: area.id, jointId: id, facilityId: f.id, kind: 'dangling', detail: `${f.id}.${slot}` })
        continue
      }
      refs.set(id, (refs.get(id) ?? new Set()).add(f.id))
      if (!paths || f.name === 'RailCross') continue
      const p = slot === 'start' ? paths.real[0] : slot === 'end' ? paths.real[paths.real.length - 1] : null
      if (p && Math.hypot(p[0] - j.xM, p[1] - j.yM) > driftM) {
        issues.push({ areaId: area.id, jointId: id, facilityId: f.id, kind: 'drift', detail: `${f.id}.${slot}` })
      }
    }
  }
  for (const j of joints.values()) {
    if ((refs.get(j.id)?.size ?? 0) < 2) {
      issues.push({ areaId: area.id, jointId: j.id, kind: 'lonely', detail: j.id })
    }
  }
  return issues
}

/** 讀檔／編輯後一次做完：整理接點 → 套到中心線 */
export function settleTrackJointsInAreas(areas: MapAreaObject[]): {
  areas: MapAreaObject[]
  created: number
  dropped: number
  moved: number
} {
  const synced = syncTrackJointsInAreas(areas)
  const applied = applyTrackJointsInAreas(synced.areas)
  return { areas: applied.areas, created: synced.created, dropped: synced.dropped, moved: applied.moved }
}

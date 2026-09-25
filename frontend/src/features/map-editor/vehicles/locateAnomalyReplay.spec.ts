import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { MapAreaObject } from '../types/area'
import type { MapPlannedRoute } from '../types/mapFile'
import { withCrossBranchTracks } from '../utils/crossBranches'
import type { BranchIdentity, LocateCandidateDiag } from '../utils/trackGenLocate'
import { buildRouteCorridors, buildRoutePath, resolveStationPieces, routeWindow, type RoutePath } from './routeCorridor'
import { buildTrackNetwork, resolveVehiclePlacementAcrossAreas } from './resolveVehicleTrackPlacement'
import { trackerNext, trackerPrior, type BranchTrackState } from './vehicleBranchTracker'

/**
 * 2026-09-25 本機實錄的判位異常，離線重播比較修改前後。
 *
 * fixture 是修改前圖台每次重算判位時錄下的輸入（座標、heading、車速、目標站、原始遙測欄位）
 * 與當時的結果（舊版 confidence／margin），連同當時的地圖與路線、各訂單的有序站序。
 * 這裡用同一批輸入，照圖台現在的流程（任務路徑、跨時間分支狀態）逐筆重播。
 */

type Frame = {
  t: number
  vehicleId: string
  xM: number
  yM: number
  headingRad: number | null
  speedMps: number | null
  targetStationId: string | null
  raw: Record<string, unknown>
  preferYard: boolean
  result: {
    trackId: string | null
    alongFrac: number | null
    distanceM: number | null
    confidence?: number | null
    margin?: number | null
    headingConflict: boolean | null
  }
  oldUnconfirmed: boolean
  candidates: LocateCandidateDiag[] | null
}

type Fixture = {
  map: { areas: MapAreaObject[]; routes: MapPlannedRoute[] }
  orders: Record<string, { stations?: string[] }>
  frames: Frame[]
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/locate-anomalies-20260925.json'), 'utf-8'),
) as Fixture

type Replayed = {
  frame: Frame
  trackId: string | null
  identity: BranchIdentity | null
  headingConflict: boolean
  distanceM: number | null
  offRoute: boolean | null
}

function replay(): Replayed[] {
  const areas = withCrossBranchTracks(fixture.map.areas)
  const network = buildTrackNetwork(areas)
  const index = network.genIndex!
  const stationPieces = resolveStationPieces(areas, index)
  const corridors = buildRouteCorridors(areas, fixture.map.routes, index)
  const trackers = new Map<string, BranchTrackState>()
  const paths = new Map<string, RoutePath | null>()
  const out: Replayed[] = []
  const frames = [...fixture.frames].sort((a, b) => a.t - b.t)
  for (const f of frames) {
    if (f.preferYard) {
      trackers.delete(f.vehicleId)
      continue
    }
    const orderKey = typeof f.raw.order_id === 'string' ? f.raw.order_id : null
    const stations = orderKey ? fixture.orders[orderKey]?.stations : undefined
    let path: RoutePath | null = null
    if (orderKey && stations && stations.length >= 2) {
      if (!paths.has(orderKey)) paths.set(orderKey, buildRoutePath(index, stationPieces, stations, `${orderKey}|${stations.join('>')}`))
      path = paths.get(orderKey) ?? null
    }
    const frame = { t: f.t, xM: f.xM, yM: f.yM, orderKey, routeKey: path?.key ?? null, mapKey: 'fixture', speedMps: f.speedMps }
    const state = trackers.get(f.vehicleId)
    const prior = trackerPrior(state, frame)
    const hit = resolveVehiclePlacementAcrossAreas(areas, f.xM, f.yM, network, {
      headingRad: f.headingRad ?? undefined,
      speedMps: f.speedMps ?? undefined,
      previousTrackId: prior.previousBranchId,
      corridorFacilityIds: !path && f.targetStationId ? corridors.byTargetStation.get(f.targetStationId) : undefined,
      routeBranchIds: path ? routeWindow(path, prior.routeIndex) : undefined,
    })
    const fix = hit?.placement.network
    const next = trackerNext(
      state,
      frame,
      prior,
      hit && fix ? { branchId: hit.placement.trackId, alongFrac: fix.alongFrac, confirmed: fix.identity?.status === 'confirmed' } : null,
      path,
    )
    if (next) trackers.set(f.vehicleId, next)
    else trackers.delete(f.vehicleId)
    out.push({
      frame: f,
      trackId: hit?.placement.trackId ?? null,
      identity: fix?.identity ?? null,
      headingConflict: fix?.headingConflict === true,
      distanceM: fix?.distanceM ?? null,
      offRoute: fix?.offRoute ?? null,
    })
  }
  return out
}

describe('實錄判位異常：修改前後重播比較', () => {
  const rows = replay()
  const anomalies = rows.filter((r) => r.frame.oldUnconfirmed)

  it('摘要（供報告）', () => {
    const byVehicle: Record<string, { frames: number; oldUnconfirmed: number; newAmbiguous: number; changedPick: number }> = {}
    for (const r of rows) {
      const v = (byVehicle[r.frame.vehicleId] ??= { frames: 0, oldUnconfirmed: 0, newAmbiguous: 0, changedPick: 0 })
      v.frames += 1
      if (r.frame.oldUnconfirmed) v.oldUnconfirmed += 1
      if (r.identity?.status === 'ambiguous') v.newAmbiguous += 1
      if (r.trackId !== r.frame.result.trackId) v.changedPick += 1
    }
    console.log('LOCATE_REPLAY_SUMMARY ' + JSON.stringify(byVehicle))
    const detail = anomalies.map((r) => ({
      v: r.frame.vehicleId,
      t: r.frame.t,
      old: r.frame.result.trackId,
      oldWhy: r.frame.result.headingConflict ? 'headingConflict' : (r.frame.result.margin ?? Infinity) < 1 ? 'scoreMargin<1' : 'confidence<0.5',
      new: r.trackId,
      identity: r.identity ? `${r.identity.status}/${r.identity.reason}` : null,
      rivals: r.identity?.rivals ?? [],
      d: r.distanceM == null ? null : Number(r.distanceM.toFixed(2)),
      heading: r.headingConflict,
    }))
    console.log('LOCATE_REPLAY_DETAIL ' + JSON.stringify(detail))
    expect(rows.length).toBeGreaterThan(400)
  })

  it('舊規則標「未確認」的每一筆，現在都有明確判定；分不開的要列出對手', () => {
    for (const r of anomalies) {
      expect(r.identity).not.toBeNull()
      if (r.identity!.status === 'ambiguous') expect(r.identity!.rivals.length).toBeGreaterThan(0)
    }
  })

  it('相鄰段接縫：判給座標所在的那一段（距離接近 0），不因上一段的端點而不確定', () => {
    const seams = anomalies.filter((r) => !r.frame.result.headingConflict && !(r.trackId ?? '').includes('~'))
    expect(seams.length).toBeGreaterThan(5)
    for (const r of seams) {
      expect(r.identity?.status).toBe('confirmed')
      expect(r.distanceM!).toBeLessThan(0.3)
    }
  })

  it('座標明確、只有方向矛盾：身分確認，另外回報方向異常', () => {
    const heading = anomalies.filter((r) => r.frame.result.headingConflict)
    expect(heading.length).toBeGreaterThan(0)
    for (const r of heading) {
      expect(r.trackId).toBe(r.frame.result.trackId)
      expect(r.identity?.status).toBe('confirmed')
      expect(r.headingConflict).toBe(true)
    }
  })

  it('交叉分支：都判給確定的分支', () => {
    const cross = anomalies.filter((r) => (r.trackId ?? '').includes('~'))
    for (const r of cross) expect(r.identity?.status).toBe('confirmed')
  })

  it('整段重播：分不開的筆數遠少於舊規則的「未確認」', () => {
    const ambiguous = rows.filter((r) => r.identity?.status === 'ambiguous').length
    expect(ambiguous).toBeLessThan(anomalies.length / 4)
  })
})

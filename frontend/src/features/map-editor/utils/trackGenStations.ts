import type { MapAreaObject } from '../types/area'
import {
  getDockingPointStationId,
  getDockingPointStationName,
} from './dockingPointFacility'
import { getRefFieldPosition } from './facilityRefFieldPosition'
import { locateByField, type TrackGenIndex } from './trackGenLocate'

/**
 * 停靠站落在路網的哪一點——把<strong>人放的站</strong>換算成里程。
 */

export type StationFix = {
  facilityId: string
  stationId: string
  stationName: string
  roadId: string
  laneId: number
  /** 沿該 road 參考線的里程（公尺） */
  sM: number
  /** 這個站離該段軌道中心線多遠（公尺）；月台放在旁邊時本來就不是 0 */
  offsetM: number
}

export type StationMileageIndex = {
  stations: StationFix[]
  /** `road:lane` → 依里程由小到大排好的站 */
  byLane: Map<string, StationFix[]>
}

const laneKey = (roadId: string, laneId: number) => `${roadId}:${laneId}`

/**
 * 掃全圖的 DockingPoint，換算成里程。
 *
 * 沒填站號、沒有場域座標、或反查不到軌道的都略過——那三種都代表這個點還沒有被
 * 放到路網上，硬給一個里程只會讓後面的計算看起來有答案而已。
 */
export function buildStationMileageIndex(
  areas: MapAreaObject[],
  index: TrackGenIndex | null,
): StationMileageIndex {
  const stations: StationFix[] = []
  if (!index) return { stations, byLane: new Map() }

  for (const area of areas) {
    for (const facility of area.facilities ?? []) {
      if (facility.type !== 'DockingPoint') continue
      const stationId = getDockingPointStationId(facility)
      if (!stationId) continue
      const { xM, yM } = getRefFieldPosition(facility.parameters)
      if (xM === null || yM === null) continue
      /*
       * 站點沒有行車方向可比，所以不給 heading：純取最近的那一條車道。上下行各自
       * 放一個 DockingPoint 時，各自最近的就是自己那一條。
       */
      const hit = locateByField(index, xM, yM)
      if (!hit) continue
      stations.push({
        facilityId: facility.id,
        stationId,
        stationName: getDockingPointStationName(facility) || stationId,
        roadId: hit.road,
        laneId: hit.lane,
        sM: hit.sM,
        offsetM: hit.offsetM,
      })
    }
  }

  const byLane = new Map<string, StationFix[]>()
  for (const s of stations) {
    const key = laneKey(s.roadId, s.laneId)
    const list = byLane.get(key)
    if (list) list.push(s)
    else byLane.set(key, [s])
  }
  for (const list of byLane.values()) list.sort((a, b) => a.sM - b.sM)

  return { stations, byLane }
}

export type StationProgress = {
  /** 剛過的那一站（行車方向上在車輛後方最近的一個） */
  from: StationFix | null
  /** 下一站（行車方向上在車輛前方最近的一個） */
  next: StationFix | null
  /** 離下一站還有多遠（公尺，沿參考線的里程差） */
  distanceToNextM: number | null
  /** 已經離開上一站多遠（公尺） */
  distanceFromM: number | null
}

const EMPTY_PROGRESS: StationProgress = {
  from: null,
  next: null,
  distanceToNextM: null,
  distanceFromM: null,
}

/**
 * 這一點的前後站。
 */
export function stationProgressAt(
  index: StationMileageIndex,
  fix: { roadId: string; laneId: number; sM: number },
): StationProgress {
  const list = index.byLane.get(laneKey(fix.roadId, fix.laneId))
  if (!list?.length) return EMPTY_PROGRESS

  // 依里程排好的清單裡，車輛卡在哪兩站之間
  let lower: StationFix | null = null
  let upper: StationFix | null = null
  for (const s of list) {
    if (s.sM <= fix.sM) lower = s
    else {
      upper = s
      break
    }
  }

  const forward = fix.laneId < 0
  const next = forward ? upper : lower
  const from = forward ? lower : upper
  return {
    from,
    next,
    distanceToNextM: next ? Math.abs(next.sM - fix.sM) : null,
    distanceFromM: from ? Math.abs(fix.sM - from.sM) : null,
  }
}

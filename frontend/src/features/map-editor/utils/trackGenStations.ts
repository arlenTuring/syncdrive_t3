import type { MapAreaObject } from '../types/area'
import {
  getDockingPointStationId,
  getDockingPointStationName,
} from './dockingPointFacility'
import { getRefFieldPosition } from './facilityRefFieldPosition'
import { locateByField, type TrackGenIndex } from './trackGenLocate'

/**
 * 停靠站落在路網的哪一點——把<strong>人放的站</strong>換算成里程。
 *
 * <h3>為什麼要這一層</h3>
 * 站點不是生成出來的：是人在圖上放 DockingPoint，填站號與站名。所以站與軌道之間本來
 * 沒有任何關聯，只有各自的場域座標。要回答「這台車在哪一站、離下一站多遠」，兩邊得
 * 換到<strong>同一把尺</strong>上——那把尺就是 OpenDRIVE 的里程。
 *
 * 做法是把站點的場域座標丟進與車輛同一支反查（{@link locateByField}），得到它的
 * road / lane / 里程。之後比距離就只是兩個里程相減，不必再碰座標，也不受簡圖的比例
 * 尺影響（圖上被壓扁的那一段，里程仍然是真的）。
 *
 * <h3>刻意不做的事</h3>
 * <ul>
 *   <li><strong>不篩掉離軌道遠的站。</strong>月台本來就放在軌道旁邊，離中心線幾公尺是
 *       正常的；要多遠才算「沒放在軌道上」是現場的事，不是這裡該拍板的數字。離多遠
 *       照實回報（offsetM），要不要採用由呼叫端決定。</li>
 *   <li><strong>不跨 road 找下一站。</strong>「下一站」只在同一條 road 的同一條車道上
 *       找。跨到下一條 road 要走路線與路口的通行配對，那是 topologyRouteTravel 的事；
 *       這裡只回答里程問題，不假裝知道車要往哪一條岔路走。</li>
 * </ul>
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
 * 沒填站號、沒有參照場域位置、或反查不到軌道的都略過——那三種都代表這個點還沒有被
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
 *
 * 行車方向由<strong>車道編號的正負</strong>決定，不必另外傳：OpenDRIVE 裡負號車道在
 * 參考線右側、與里程同向，正號車道在左側、與里程反向。所以正號車道的「下一站」是
 * 里程<strong>更小</strong>的那一個。
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

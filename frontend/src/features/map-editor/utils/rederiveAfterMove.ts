import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { rederiveIfStale } from './shapedTrackPaths'

/**
 * 移動、縮放、複製貼上之後，把「兩端接不上隔壁」的軌道中心線重建。
 *
 * 生成的軌道現場座標由自己身上的中心線決定，圖上移動它不會改變中心線——複製一塊軌道
 * 再拖到別處，連中心線一起複製過去，就指著原本那塊的位置。這裡負責在<strong>剛動過</strong>
 * 的那幾塊上補上「軌道是接起來的」這條規則。
 *
 * 只看剛動過的：載入時、選取時都不動。兩塊互相對不上時（U18／U19）看不出誰對誰錯，
 * 只有使用者剛動的那一塊才知道是誰該改。
 */

/** 一塊設施在圖上的位置與大小，換成字串好比對 */
export function facilityGeometrySignature(f: FacilityObject): string {
  const pos = f.areaPosition
  const size = f.areaSizePx
  const r = f.rotation ?? 0
  return [pos?.x, pos?.y, size?.w, size?.h, r].map((v) => (typeof v === 'number' ? v.toFixed(2) : '-')).join(',')
}

export type GeometrySnapshot = Map<string, string>

export function snapshotGeometry(areas: MapAreaObject[]): GeometrySnapshot {
  const out: GeometrySnapshot = new Map()
  for (const a of areas) {
    for (const f of a.facilities ?? []) out.set(`${a.id}|${f.id}`, facilityGeometrySignature(f))
  }
  return out
}

/** 超過這麼多塊同時變動就不是使用者動手，是換圖、還原或整批操作 */
export const MAX_MOVED_FOR_REBUILD = 12

/**
 * 相對於上一份快照，剛動過或剛出現的設施（areaId|facilityId）。
 * 換了一張圖（大部分都不一樣）回 null——那不是移動。
 */
export function movedFacilityKeys(prev: GeometrySnapshot, next: GeometrySnapshot): string[] | null {
  if (prev.size === 0) return null
  const moved: string[] = []
  let kept = 0
  for (const [key, sig] of next) {
    const before = prev.get(key)
    if (before === undefined || before !== sig) moved.push(key)
    else kept += 1
  }
  // 大部分都沒動才算「使用者動了幾塊」；否則是載入了別的圖
  if (kept < next.size * 0.8) return null
  if (moved.length > MAX_MOVED_FOR_REBUILD) return null
  return moved
}

export type RebuildOutcome = {
  areas: MapAreaObject[]
  rebuilt: Array<{ areaId: string; facilityId: string; label: string; changedM: number }>
}

/** 對剛動過的軌道逐塊檢查，過期的重建；沒有要動的回同一個陣列 */
export function rebuildStaleAmong(areas: MapAreaObject[], keys: string[]): RebuildOutcome {
  const rebuilt: RebuildOutcome['rebuilt'] = []
  let next = areas
  for (const key of keys) {
    const [areaId, facilityId] = key.split('|')
    const area = next.find((a) => a.id === areaId)
    const f = area?.facilities.find((x) => x.id === facilityId)
    if (!area || !f || f.type !== 'Track') continue
    const res = rederiveIfStale(f, area)
    if (!res || !res.ok) continue
    rebuilt.push({ areaId: area.id, facilityId: f.id, label: f.customName?.trim() || f.id, changedM: res.changedM })
    next = next.map((a) =>
      a.id !== area.id
        ? a
        : { ...a, facilities: a.facilities.map((x) => (x.id === f.id ? res.facility : x)) },
    )
  }
  return { areas: next, rebuilt }
}

import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  resolveFacilityAreaPosition,
  resolveFacilityAreaSize,
} from './facilityAreaCoords'
import { fieldMetersAtAreaLocal } from './fieldFromArea'
import {
  getRefFieldBounds,
  hasValidRefFieldBounds,
} from './facilityRefFieldBounds'
import {
  getRefFieldPosition,
  hasValidRefFieldPosition,
} from './facilityRefFieldPosition'
import {
  isZoneEntrance,
  isZonePartition,
  readParentZoneId,
  readZoneEntranceLinks,
  readZoneLocalField,
  readZonePartitionBinding,
  zoneLocalRectToAbsolute,
} from './zonePartition'

/**
 * 圖資健檢：停靠點、分區、格位。
 *
 * <h3>為什麼要驗這三類</h3>
 * 它們的共同點是「<strong>值寫一次就不再重算</strong>」：停靠點的場域座標、分區的場域
 * 範圍、格位的外框，都是某一刻算好存下來的。後來軌道被合併、微調、重放，或分區改接到
 * 別條連結，那些值就過期了——而且不會報錯，畫面上也看不出來。
 *
 * 這一輪踩到的每一個都列在下面，每一項對應一條檢查：
 *
 * <pre>
 *   停靠點  畫在 D19／U19，座標卻是上面一塊 D18／U18 的範圍   差 76 公尺
 *   月台門  場域座標是 167.55, 344.49——那是容器網域的格線     根本沒映射過
 *   分區    兩個分區綁到同一條入口連結                        兩區設施疊在一起
 *   分區    連結指向已刪除的圖元，而且沒有地方可以接回來      整備區整個沒有場域
 *   格位    E1 高 24 公尺，比它所在的分區（9 公尺）還高        場域與圖面長邊相反
 *   格位    M3 與 M4 的場域範圍一模一樣                        兩台車疊在同一點
 * </pre>
 */

export type MapDataIssue = {
  /** 哪一類：停靠點／分區／格位 */
  kind: 'docking' | 'zone' | 'slot'
  /** 出問題的元件 */
  target: string
  detail: string
}

/** 停靠點的座標與它畫的位置可以差多遠（公尺） */
const DOCKING_TOLERANCE_M = 3

function label(f: FacilityObject): string {
  return f.customName?.trim() || f.id
}

function centreAreaLocal(
  f: FacilityObject,
  area: MapAreaObject,
): { x: number; y: number } {
  const pos = resolveFacilityAreaPosition(f, area.domain, area.layout)
  const size = resolveFacilityAreaSize(f, area.domain, area.layout)
  return { x: pos.x + size.w / 2, y: pos.y + size.h / 2 }
}

/**
 * 停靠點：身上記的座標，跟它畫在圖上的位置對不對得起來。
 *
 * 畫的位置才是人決定的，座標是照它換算出來的；兩者差很多就表示座標是舊的。
 */
function auditDockingPoints(area: MapAreaObject): MapDataIssue[] {
  const out: MapDataIssue[] = []
  for (const f of area.facilities) {
    // 停靠點與月台門都是「放在軌道旁邊、身上記一個座標」的點狀元件
    if (f.type !== 'DockingPoint' && f.type !== 'PSD') continue
    if (!hasValidRefFieldPosition(f.parameters)) {
      out.push({ kind: 'docking', target: label(f), detail: '沒有場域座標' })
      continue
    }
    const stored = getRefFieldPosition(f.parameters)
    const centre = centreAreaLocal(f, area)
    const mapped = fieldMetersAtAreaLocal(area, centre.x, centre.y)
    if (mapped.source === 'area') {
      out.push({
        kind: 'docking',
        target: label(f),
        detail: `畫的位置底下沒有可以解釋它的軌道，座標 ${stored.xM}, ${stored.yM} 無從驗證`,
      })
      continue
    }
    const gap = Math.hypot(
      (stored.xM ?? 0) - mapped.xM,
      (stored.yM ?? 0) - mapped.yM,
    )
    if (gap > DOCKING_TOLERANCE_M) {
      out.push({
        kind: 'docking',
        target: label(f),
        detail:
          `座標 ${stored.xM}, ${stored.yM} 與它畫的位置對應到的 `
          + `${mapped.xM.toFixed(2)}, ${mapped.yM.toFixed(2)} 差 ${gap.toFixed(1)} 公尺`,
      })
    }
  }
  return out
}

/** 分區：綁定是不是完整、範圍是不是跟著入口連結走 */
function auditZones(area: MapAreaObject): MapDataIssue[] {
  const out: MapDataIssue[] = []
  const partitions = area.facilities.filter(isZonePartition)
  const entrances = area.facilities.filter(isZoneEntrance)

  /** linkId → 綁到它的分區 */
  const byLink = new Map<string, FacilityObject[]>()
  for (const zone of partitions) {
    const binding = readZonePartitionBinding(zone.parameters)
    if (!binding?.linkId) {
      out.push({ kind: 'zone', target: label(zone), detail: '沒有綁到任何入口連結' })
      continue
    }
    byLink.set(binding.linkId, [...(byLink.get(binding.linkId) ?? []), zone])
  }
  for (const [linkId, zones] of byLink) {
    if (zones.length > 1) {
      out.push({
        kind: 'zone',
        target: zones.map(label).join('、'),
        detail: `都綁在同一條入口連結 ${linkId} 上，兩區的設施會落在同一塊現場`,
      })
    }
  }

  for (const entrance of entrances) {
    for (const link of readZoneEntranceLinks(entrance.parameters)) {
      if (!link.zoneFacilityId) {
        out.push({
          kind: 'zone',
          target: `${label(entrance)}／${link.name}`,
          detail: '這一條連結還沒接上場上的分區',
        })
        continue
      }
      const zone = area.facilities.find((f) => f.id === link.zoneFacilityId)
      if (!zone) {
        out.push({
          kind: 'zone',
          target: `${label(entrance)}／${link.name}`,
          detail: `連結指向的圖元 ${link.zoneFacilityId} 已經不在了`,
        })
        continue
      }
      const bounds = getRefFieldBounds(zone.parameters)
      const same =
        bounds.xMinM === link.xMinM
        && bounds.xMaxM === link.xMaxM
        && bounds.yMinM === link.yMinM
        && bounds.yMaxM === link.yMaxM
      if (!same) {
        out.push({
          kind: 'zone',
          target: label(zone),
          detail:
            `場域範圍 x[${bounds.xMinM}, ${bounds.xMaxM}] y[${bounds.yMinM}, ${bounds.yMaxM}] `
            + `與入口連結「${link.name}」的 x[${link.xMinM}, ${link.xMaxM}] y[${link.yMinM}, ${link.yMaxM}] 不一致`,
        })
      }
    }
  }
  return out
}

/** 格位：在不在自己的分區裡、長邊對不對、有沒有跟別人重疊 */
function auditZoneSlots(area: MapAreaObject): MapDataIssue[] {
  const out: MapDataIssue[] = []
  const boxes = new Map<string, string>()

  for (const f of area.facilities) {
    const parentId = readParentZoneId(f.parameters)
    if (!parentId) continue
    if (!hasValidRefFieldBounds(f.parameters)) {
      out.push({ kind: 'slot', target: label(f), detail: '沒有場域範圍' })
      continue
    }
    const b = getRefFieldBounds(f.parameters)
    const zone = area.facilities.find((x) => x.id === parentId)
    if (!zone) {
      out.push({ kind: 'slot', target: label(f), detail: `隸屬的分區 ${parentId} 不在了` })
      continue
    }

    // 1. 不該超出自己的分區
    if (hasValidRefFieldBounds(zone.parameters)) {
      const z = getRefFieldBounds(zone.parameters)
      const outside =
        (b.xMinM ?? 0) < (z.xMinM ?? 0) - 0.5
        || (b.xMaxM ?? 0) > (z.xMaxM ?? 0) + 0.5
        || (b.yMinM ?? 0) < (z.yMinM ?? 0) - 0.5
        || (b.yMaxM ?? 0) > (z.yMaxM ?? 0) + 0.5
      if (outside) {
        out.push({
          kind: 'slot',
          target: label(f),
          detail:
            `場域範圍 x[${b.xMinM}, ${b.xMaxM}] y[${b.yMinM}, ${b.yMaxM}] `
            + `超出分區「${label(zone)}」x[${z.xMinM}, ${z.xMaxM}] y[${z.yMinM}, ${z.yMaxM}]`,
        })
      }
    }

    // 2. 場域的長邊要跟圖面的長邊同一個方向
    const size = resolveFacilityAreaSize(f, area.domain, area.layout)
    const fieldWide = (b.xMaxM ?? 0) - (b.xMinM ?? 0) >= (b.yMaxM ?? 0) - (b.yMinM ?? 0)
    const drawnWide = size.w >= size.h
    if (fieldWide !== drawnWide) {
      out.push({
        kind: 'slot',
        target: label(f),
        detail:
          `場域是${fieldWide ? '橫' : '直'}的、圖上畫成${drawnWide ? '橫' : '直'}的`
          + '——車頭會橫跨在格子上',
      })
    }

    // 3. 兩個格位不該共用同一塊現場
    const key = [b.xMinM, b.xMaxM, b.yMinM, b.yMaxM].join(',')
    const taken = boxes.get(key)
    if (taken) {
      out.push({
        kind: 'slot',
        target: `${taken}、${label(f)}`,
        detail: '場域範圍一模一樣，停在裡面的車會疊在同一點',
      })
    } else {
      boxes.set(key, label(f))
    }

    // 4. 存的外框要跟 zoneLocalField 算出來的一致
    const local = readZoneLocalField(f.parameters)
    if (local && hasValidRefFieldBounds(zone.parameters)) {
      const rect = zoneLocalRectToAbsolute(local, getRefFieldBounds(zone.parameters))
      if (rect) {
        const drift = Math.max(
          Math.abs(rect.xMinM - (b.xMinM ?? 0)),
          Math.abs(rect.yMinM - (b.yMinM ?? 0)),
        )
        if (drift > 1) {
          out.push({
            kind: 'slot',
            target: label(f),
            detail:
              `存的場域範圍與 zoneLocalField 算出來的差 ${drift.toFixed(1)} 公尺`
              + '——相對位置改過，範圍沒跟著重算',
          })
        }
      }
    }
  }
  return out
}

export function auditMapData(areas: MapAreaObject[]): MapDataIssue[] {
  const out: MapDataIssue[] = []
  for (const area of areas) {
    out.push(...auditDockingPoints(area))
    out.push(...auditZones(area))
    out.push(...auditZoneSlots(area))
  }
  return out
}

/** 印成一段話，給 console 用 */
export function describeMapDataIssues(issues: MapDataIssue[]): string {
  if (issues.length === 0) return '[圖資健檢] 停靠點／分區／格位：沒有問題'
  const name = { docking: '停靠點', zone: '分區', slot: '格位' } as const
  return [
    `[圖資健檢] ${issues.length} 項要看：`,
    ...issues.map((i) => `  ${name[i.kind]} ${i.target}：${i.detail}`),
  ].join('\n')
}

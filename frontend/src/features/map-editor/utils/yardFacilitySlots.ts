import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { getValidRefFieldBounds } from './facilityRefFieldBounds'

/**
 * 場區停車格的<strong>代號長相</strong>：一個字母加一到兩位數字（E1、M3、D5、P12）。
 *
 * <h3>為什麼不是寫死的清單</h3>
 * 這裡原本是一組列舉（E1–E4、H1–H3、M1–M4、W1、P1–P4）。後來圖上多了調度區
 * D1–D5，清單沒跟著加，於是停在那五格的車<strong>整條定位鏈直接回傳 null</strong>——
 * 不是停錯位置，是連位置都算不出來，圖台只能沿用上一幀，車散在莫名其妙的地方。
 * 每加一個分區就要記得回來改一行，這種清單一定會過期。
 *
 * 真正該問的不是「代號在不在清單裡」，而是「圖上有沒有這個設施、它是不是軌道、
 * 有沒有場域範圍」——那三件事 {@link resolveYardFacilityFieldMeters} 本來就在查。
 * 所以這裡只做形狀的預篩，實際認定交給圖資。
 *
 * 下行軌道叫 D01～D37、上行叫 U01～U37，形狀上也會通過這一關，但它們的 type 是
 * Track，會在下一步被擋掉。
 */
const YARD_SLOT_ID_SHAPE = /^[A-Z]\d{1,2}$/i

export function isYardParkableFacilityId(slotId: string): boolean {
  return YARD_SLOT_ID_SHAPE.test(slotId.trim())
}

export function parseYardSlotFromPayload(
  payload: Record<string, unknown> | undefined,
): { slotId: string; subIndex?: number } | null {
  if (!payload) return null

  const explicit = payload.yard_slot_id ?? payload.yardSlotId
  if (typeof explicit === 'string' && explicit.trim()) {
    const slotId = explicit.trim()
    if (!isYardParkableFacilityId(slotId)) return null
    return { slotId }
  }

  const segment = payload.segment_label
  if (typeof segment === 'string') {
    const trimmed = segment.trim()
    if (isYardParkableFacilityId(trimmed)) {
      return { slotId: trimmed }
    }
    const parts = trimmed.split(/\s+/)
    if (parts.length >= 2) {
      const slotId = parts[parts.length - 1]?.trim()
      if (slotId && isYardParkableFacilityId(slotId)) return { slotId }
    }
  }

  return null
}

function findFacilityByName(
  areas: MapAreaObject[],
  name: string,
): { facility: FacilityObject; area: MapAreaObject } | null {
  for (const area of areas) {
    const facility = (area.facilities ?? []).find(
      (f) => f.customName?.trim() === name,
    )
    if (facility) return { facility, area }
  }
  return null
}

/**
 * 場區停車格的場域範圍清單，給「這個座標落在哪一格」用。
 *
 * 先算好一份再逐台車比對，比每台車都走一次 areas 便宜；圖資變了才重算。
 */
export function collectYardSlotFieldBoxes(
  areas: MapAreaObject[],
): Array<{ slotId: string; xMinM: number; xMaxM: number; yMinM: number; yMaxM: number }> {
  const boxes: Array<{ slotId: string; xMinM: number; xMaxM: number; yMinM: number; yMaxM: number }> = []
  for (const area of areas) {
    for (const facility of area.facilities ?? []) {
      if (facility.type === 'Track') continue
      const slotId = facility.customName?.trim()
      if (!slotId || !isYardParkableFacilityId(slotId)) continue
      const bounds = getValidRefFieldBounds(facility.parameters)
      if (!bounds) continue
      boxes.push({ slotId, ...bounds })
    }
  }
  return boxes
}

/**
 * 這個座標是不是停在某一格裡。
 *
 * 車端執行任務時<strong>不回報格位</strong>——協議規定格位由中心端比對座標自動判定
 * （車只說自己在哪裡）。少了這一步，正開進充電格的車會被當成正線車，硬貼到最近的
 * 軌道格上；充電區就在正線旁邊，畫面上就是好幾台車疊在下行線上不動。
 */
export function findYardSlotAtFieldMeters(
  boxes: ReturnType<typeof collectYardSlotFieldBoxes>,
  xM: number,
  yM: number,
): string | null {
  if (!Number.isFinite(xM) || !Number.isFinite(yM)) return null
  for (const box of boxes) {
    if (xM >= box.xMinM && xM <= box.xMaxM && yM >= box.yMinM && yM <= box.yMaxM) {
      return box.slotId
    }
  }
  return null
}

/** 依設施格代號（E1、P1、H1…）解析場域座標 */
export function resolveYardFacilityFieldMeters(
  slotId: string,
  areas: MapAreaObject[],
  _options?: { subIndex?: number },
): { xM: number; yM: number; facility: FacilityObject; area: MapAreaObject } | null {
  const id = slotId.trim()
  if (!isYardParkableFacilityId(id)) return null

  const hit = findFacilityByName(areas, id)
  if (!hit) return null
  if (hit.facility.type === 'Track') return null

  const bounds = getValidRefFieldBounds(hit.facility.parameters)
  if (!bounds) return null

  return {
    xM: (bounds.xMinM + bounds.xMaxM) / 2,
    yM: (bounds.yMinM + bounds.yMaxM) / 2,
    facility: hit.facility,
    area: hit.area,
  }
}

/** @deprecated 請改用 resolveYardFacilityFieldMeters */
export function resolveParkingSlotFieldMeters(
  slotId: string,
  areas: MapAreaObject[],
  options?: { subIndex?: number },
) {
  return resolveYardFacilityFieldMeters(slotId, areas, options)
}

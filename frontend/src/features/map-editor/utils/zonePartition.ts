/**
 * 分區入口（ZoneEntrance）↔ 分區（ZonePartition）資料模型。
 *
 * - 入口：圖台上的虛線方塊；可設定多個分區連結（名稱＋絕對場域範圍）。
 * - 分區：場域範圍<strong>完全</strong>由入口連結決定，與分區在圖台上的放置無關。
 * - 分區內設施：以相對分區場域範圍的座標換算真實場域位置。
 */

import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  resolveFacilityAreaPosition,
  resolveFacilityAreaSize,
  facilityWithAreaPosition,
  facilityWithAreaSize,
} from './facilityAreaCoords'
import {
  getRefFieldBounds,
  hasValidRefFieldBounds,
  patchRefFieldBounds,
  REF_FIELD_X_MAX_M,
  REF_FIELD_X_MIN_M,
  REF_FIELD_Y_MAX_M,
  REF_FIELD_Y_MIN_M,
  type RefFieldBoundsMeters,
} from './facilityRefFieldBounds'
import {
  getRefFieldPosition,
  hasValidRefFieldPosition,
  patchRefFieldPosition,
  REF_FIELD_X_M,
  REF_FIELD_Y_M,
} from './facilityRefFieldPosition'
import { usesRefFieldBounds, usesRefFieldPoint } from './facilityRefFieldBinding'

export const ZONE_ENTRANCE_LINKS_KEY = 'zoneEntranceLinks'
export const ZONE_PARTITION_LINK_ID_KEY = 'zonePartitionLinkId'
export const ZONE_PARTITION_ENTRANCE_ID_KEY = 'zonePartitionEntranceId'
/** 設施隸屬的分區 id（sibling facility） */
export const PARENT_ZONE_ID_KEY = 'parentZoneId'
/**
 * 相對分區場域的正規化座標（0–1，原點左下）。
 * 真實場域 = 分區 refField 外框線性映射。
 */
export const ZONE_LOCAL_FIELD_KEY = 'zoneLocalField'

export type ZoneEntranceLink = {
  /** 連結穩定 id（入口內唯一） */
  id: string
  /** 分區顯示名稱 */
  name: string
  /** 此分區代表的絕對場域範圍（公尺） */
  xMinM: number
  xMaxM: number
  yMinM: number
  yMaxM: number
  /** 已建立／綁定的分區設施 id；未建立時為空 */
  zoneFacilityId?: string
}

export type ZoneLocalField = {
  /** 中心相對分區寬 0–1（左→右） */
  u: number
  /** 中心相對分區高 0–1（下→上） */
  v: number
  /**
   * 外框寬相對分區寬 0–1。
   *
   * <h3>為什麼位置不夠，尺寸也要記</h3>
   * 分區的意義是「圖上這一塊＝現場那一塊」，所以裡面的設施<strong>整個外框</strong>
   * 都該照同一個比例換算，不只是中心點。先前只換算中心、尺寸沿用設施身上原本那一組
   * 數字，於是圖改版之後格位還帶著上一版的大小——實測充電格畫成 82×39 像素（橫的），
   * 場域範圍卻還是 9.42×24.02 公尺（直的），而且比它所在的分區（9 公尺高）還高。
   *
   * 車端拿場域範圍判斷「我停在哪一格」、圖台拿它的長邊擺車頭，兩邊都會錯。
   *
   * 舊資料沒有這兩個值；沒有時維持舊行為（只搬中心、尺寸不動）。
   */
  du?: number
  /** 外框高相對分區高 0–1 */
  dv?: number
}

export function isZoneEntrance(f: FacilityObject): boolean {
  return f.type === 'Facility' && f.name === 'ZoneEntrance'
}

export function isZonePartition(f: FacilityObject): boolean {
  return f.type === 'Facility' && f.name === 'ZonePartition'
}

export function isFacilityAreaBlock(f: FacilityObject): boolean {
  return f.type === 'Facility' && f.name === 'FacilityArea'
}

/** 可隸屬分區者：僅「設施」元件（FacilityArea） */
export function canBelongToParentZone(f: FacilityObject): boolean {
  return isFacilityAreaBlock(f)
}

/**
 * 剝除非對應元件的分區相關參數，避免軌道／號誌等誤帶 parentZoneId 等欄位。
 * - parentZoneId / zoneLocalField → 僅 FacilityArea
 * - zoneEntranceLinks → 僅 ZoneEntrance
 * - zonePartitionEntranceId / zonePartitionLinkId → 僅 ZonePartition
 */
export function sanitizeZoneParameters(
  facility: FacilityObject,
): FacilityObject {
  const params = facility.parameters
  if (!params) return facility
  const next = { ...params }
  let changed = false
  const drop = (key: string) => {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      delete next[key]
      changed = true
    }
  }
  if (!isFacilityAreaBlock(facility)) {
    drop(PARENT_ZONE_ID_KEY)
    drop(ZONE_LOCAL_FIELD_KEY)
  }
  if (!isZoneEntrance(facility)) {
    drop(ZONE_ENTRANCE_LINKS_KEY)
  }
  if (!isZonePartition(facility)) {
    drop(ZONE_PARTITION_ENTRANCE_ID_KEY)
    drop(ZONE_PARTITION_LINK_ID_KEY)
  }
  if (!changed) return facility
  return {
    ...facility,
    parameters: Object.keys(next).length > 0 ? next : undefined,
  }
}

/** 設施區塊類（含分區入口／分區）：共用方塊渲染，但屬性與停靠點語意不同 */
export function isFacilityFamilyBlock(f: FacilityObject): boolean {
  return isFacilityAreaBlock(f) || isZoneEntrance(f) || isZonePartition(f)
}

function num(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function readZoneEntranceLinks(
  parameters: Record<string, unknown> | undefined,
): ZoneEntranceLink[] {
  const raw = parameters?.[ZONE_ENTRANCE_LINKS_KEY]
  if (!Array.isArray(raw)) return []
  const out: ZoneEntranceLink[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : ''
    if (!id) continue
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    const xMinM = num(o.xMinM)
    const xMaxM = num(o.xMaxM)
    const yMinM = num(o.yMinM)
    const yMaxM = num(o.yMaxM)
    const zoneFacilityId =
      typeof o.zoneFacilityId === 'string' && o.zoneFacilityId.trim()
        ? o.zoneFacilityId.trim()
        : undefined
    out.push({
      id,
      name: name || id,
      xMinM,
      xMaxM: xMaxM >= xMinM ? xMaxM : xMinM,
      yMinM,
      yMaxM: yMaxM >= yMinM ? yMaxM : yMinM,
      zoneFacilityId,
    })
  }
  return out
}

export function patchZoneEntranceLinks(
  links: ZoneEntranceLink[],
): Record<string, unknown> {
  return {
    [ZONE_ENTRANCE_LINKS_KEY]: links.map((l) => ({
      id: l.id,
      name: l.name,
      xMinM: l.xMinM,
      xMaxM: l.xMaxM,
      yMinM: l.yMinM,
      yMaxM: l.yMaxM,
      ...(l.zoneFacilityId ? { zoneFacilityId: l.zoneFacilityId } : {}),
    })),
  }
}

export function createZoneEntranceLink(
  partial?: Partial<ZoneEntranceLink>,
): ZoneEntranceLink {
  const id =
    partial?.id?.trim() ||
    `zl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  return {
    id,
    name: partial?.name?.trim() || '分區',
    xMinM: partial?.xMinM ?? 0,
    xMaxM: partial?.xMaxM ?? 10,
    yMinM: partial?.yMinM ?? 0,
    yMaxM: partial?.yMaxM ?? 10,
    zoneFacilityId: partial?.zoneFacilityId,
  }
}

export function linkBounds(link: ZoneEntranceLink): {
  xMinM: number
  xMaxM: number
  yMinM: number
  yMaxM: number
} {
  return {
    xMinM: link.xMinM,
    xMaxM: link.xMaxM,
    yMinM: link.yMinM,
    yMaxM: link.yMaxM,
  }
}

/** 分區設施參數：綁定入口＋連結 id，並寫入與連結一致的 refField 範圍 */
export function zonePartitionParametersFromLink(
  entranceId: string,
  link: ZoneEntranceLink,
): Record<string, unknown> {
  const b = linkBounds(link)
  return {
    [ZONE_PARTITION_ENTRANCE_ID_KEY]: entranceId,
    [ZONE_PARTITION_LINK_ID_KEY]: link.id,
    [REF_FIELD_X_MIN_M]: b.xMinM,
    [REF_FIELD_X_MAX_M]: b.xMaxM,
    [REF_FIELD_Y_MIN_M]: b.yMinM,
    [REF_FIELD_Y_MAX_M]: b.yMaxM,
  }
}

export function readZonePartitionBinding(
  parameters: Record<string, unknown> | undefined,
): { entranceId: string; linkId: string } | null {
  const entranceId = parameters?.[ZONE_PARTITION_ENTRANCE_ID_KEY]
  const linkId = parameters?.[ZONE_PARTITION_LINK_ID_KEY]
  if (typeof entranceId !== 'string' || !entranceId.trim()) return null
  if (typeof linkId !== 'string' || !linkId.trim()) return null
  return { entranceId: entranceId.trim(), linkId: linkId.trim() }
}

export function readParentZoneId(
  parameters: Record<string, unknown> | undefined,
): string | null {
  const v = parameters?.[PARENT_ZONE_ID_KEY]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function readZoneLocalField(
  parameters: Record<string, unknown> | undefined,
): ZoneLocalField | null {
  const raw = parameters?.[ZONE_LOCAL_FIELD_KEY]
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { u?: unknown; v?: unknown }
  const u = num(o.u, NaN)
  const v = num(o.v, NaN)
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null
  const du = num((o as { du?: unknown }).du, NaN)
  const dv = num((o as { dv?: unknown }).dv, NaN)
  return {
    u: Math.max(0, Math.min(1, u)),
    v: Math.max(0, Math.min(1, v)),
    ...(Number.isFinite(du) && du > 0 ? { du: Math.min(1, du) } : {}),
    ...(Number.isFinite(dv) && dv > 0 ? { dv: Math.min(1, dv) } : {}),
  }
}

/** 分區絕對場域 → 相對 0–1 */
export function absoluteToZoneLocal(
  xM: number,
  yM: number,
  bounds: Pick<RefFieldBoundsMeters, 'xMinM' | 'xMaxM' | 'yMinM' | 'yMaxM'>,
): ZoneLocalField {
  const xMin = bounds.xMinM ?? 0
  const xMax = bounds.xMaxM ?? 0
  const yMin = bounds.yMinM ?? 0
  const yMax = bounds.yMaxM ?? 0
  const w = Math.max(1e-9, xMax - xMin)
  const h = Math.max(1e-9, yMax - yMin)
  return {
    u: Math.max(0, Math.min(1, (xM - xMin) / w)),
    v: Math.max(0, Math.min(1, (yM - yMin) / h)),
  }
}

/**
 * 相對 0–1 的外框 → 分區絕對場域外框。
 *
 * 沒有記尺寸（舊資料）就回 null，呼叫端維持「只搬中心」的舊行為。
 */
export function zoneLocalRectToAbsolute(
  local: ZoneLocalField,
  bounds: Pick<RefFieldBoundsMeters, 'xMinM' | 'xMaxM' | 'yMinM' | 'yMaxM'>,
): { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number } | null {
  if (local.du == null || local.dv == null) return null
  const xMin = bounds.xMinM ?? 0
  const xMax = bounds.xMaxM ?? 0
  const yMin = bounds.yMinM ?? 0
  const yMax = bounds.yMaxM ?? 0
  const w = xMax - xMin
  const h = yMax - yMin
  const centre = zoneLocalToAbsolute(local, bounds)
  const halfW = Math.abs(local.du * w) / 2
  const halfH = Math.abs(local.dv * h) / 2
  return {
    xMinM: centre.xM - halfW,
    xMaxM: centre.xM + halfW,
    yMinM: centre.yM - halfH,
    yMaxM: centre.yM + halfH,
  }
}

/** 相對 0–1 → 分區絕對場域 */
export function zoneLocalToAbsolute(
  local: ZoneLocalField,
  bounds: Pick<RefFieldBoundsMeters, 'xMinM' | 'xMaxM' | 'yMinM' | 'yMaxM'>,
): { xM: number; yM: number } {
  const xMin = bounds.xMinM ?? 0
  const xMax = bounds.xMaxM ?? 0
  const yMin = bounds.yMinM ?? 0
  const yMax = bounds.yMaxM ?? 0
  const w = xMax - xMin
  const h = yMax - yMin
  return {
    xM: xMin + local.u * w,
    yM: yMin + local.v * h,
  }
}

/**
 * 依入口連結表，回傳應套用到各已綁定分區設施的 parameters patch。
 * key = zoneFacilityId
 */
export function syncPatchesFromEntranceLinks(
  links: ZoneEntranceLink[],
  entranceId: string,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const link of links) {
    if (!link.zoneFacilityId) continue
    out[link.zoneFacilityId] = {
      ...zonePartitionParametersFromLink(entranceId, link),
      customNameSync: link.name,
    }
  }
  return out
}

/** 子設施中心相對分區圖台外框的 0–1（Area 區域座標，左下原點） */
export function zoneLocalFromCanvasPlacement(
  child: FacilityObject,
  zone: FacilityObject,
  area: MapAreaObject,
): ZoneLocalField | null {
  if (!isZonePartition(zone)) return null
  const zPos = resolveFacilityAreaPosition(zone, area.domain, area.layout)
  const zSize = resolveFacilityAreaSize(zone, area.domain, area.layout)
  if (zSize.w <= 1e-9 || zSize.h <= 1e-9) return null
  const cPos = resolveFacilityAreaPosition(child, area.domain, area.layout)
  const cSize = resolveFacilityAreaSize(child, area.domain, area.layout)
  const cx = cPos.x + cSize.w / 2
  const cy = cPos.y + cSize.h / 2
  return {
    u: Math.max(0, Math.min(1, (cx - zPos.x) / zSize.w)),
    v: Math.max(0, Math.min(1, (cy - zPos.y) / zSize.h)),
    // 外框也一起記：分區的兩個軸比例尺可以不同，尺寸必須各乘各的
    du: Math.max(0, Math.min(1, cSize.w / zSize.w)),
    dv: Math.max(0, Math.min(1, cSize.h / zSize.h)),
  }
}

/**
 * 將隸屬分區的設施外框限制在分區圖台範圍內（不可超出）。
 * 先縮小尺寸（若大於分區），再夾住位置。
 */
export function clampFacilityInsideParentZone(
  facility: FacilityObject,
  area: MapAreaObject,
): FacilityObject {
  if (!canBelongToParentZone(facility)) return facility
  const parentId = readParentZoneId(facility.parameters)
  if (!parentId) return facility
  const zone = area.facilities.find((f) => f.id === parentId)
  if (!zone || !isZonePartition(zone)) return facility

  const zPos = resolveFacilityAreaPosition(zone, area.domain, area.layout)
  const zSize = resolveFacilityAreaSize(zone, area.domain, area.layout)
  if (!(zSize.w > 0) || !(zSize.h > 0)) return facility

  const cSize = resolveFacilityAreaSize(facility, area.domain, area.layout)
  const w = Math.min(Math.max(1, cSize.w), zSize.w)
  const h = Math.min(Math.max(1, cSize.h), zSize.h)
  const cPos = resolveFacilityAreaPosition(facility, area.domain, area.layout)
  const x = Math.min(
    Math.max(cPos.x, zPos.x),
    zPos.x + zSize.w - w,
  )
  const y = Math.min(
    Math.max(cPos.y, zPos.y),
    zPos.y + zSize.h - h,
  )

  let next = facility
  if (Math.abs(w - cSize.w) > 1e-6 || Math.abs(h - cSize.h) > 1e-6) {
    next = facilityWithAreaSize(next, { w, h })
  }
  if (
    Math.abs(x - cPos.x) > 1e-6 ||
    Math.abs(y - cPos.y) > 1e-6 ||
    next !== facility
  ) {
    next = facilityWithAreaPosition(
      next,
      { x, y },
      area.domain,
      area.layout,
    )
  }
  return next
}

/**
 * 在分區內建立一般設施（FacilityArea），綁定 parentZoneId，置於分區中央。
 */
export function createFacilityAreaInsideZone(
  zone: FacilityObject,
  area: MapAreaObject,
  id: string,
  sizePx?: { w: number; h: number },
): FacilityObject | null {
  if (!isZonePartition(zone)) return null
  const zPos = resolveFacilityAreaPosition(zone, area.domain, area.layout)
  const zSize = resolveFacilityAreaSize(zone, area.domain, area.layout)
  if (!(zSize.w > 8) || !(zSize.h > 8)) return null

  const w = Math.min(
    Math.max(16, sizePx?.w ?? Math.round(zSize.w * 0.35)),
    zSize.w * 0.85,
  )
  const h = Math.min(
    Math.max(16, sizePx?.h ?? Math.round(zSize.h * 0.35)),
    zSize.h * 0.85,
  )
  const areaPosition = {
    x: zPos.x + (zSize.w - w) / 2,
    y: zPos.y + (zSize.h - h) / 2,
  }

  let created: FacilityObject = {
    id,
    type: 'Facility',
    name: 'FacilityArea',
    customName: '',
    areaPosition,
    areaSizePx: { w, h },
    position: { x: 0, y: 0 },
    rotation: 0,
    currentState: 'Normal',
    parameters: {
      purpose: '',
      remarks: '',
      defaultFillColor: '#1e293b',
      colorRules: [],
      [PARENT_ZONE_ID_KEY]: zone.id,
      [REF_FIELD_X_MIN_M]: null,
      [REF_FIELD_X_MAX_M]: null,
      [REF_FIELD_Y_MIN_M]: null,
      [REF_FIELD_Y_MAX_M]: null,
    },
  }
  created = facilityWithAreaPosition(
    created,
    areaPosition,
    area.domain,
    area.layout,
  )
  const areaForSync: MapAreaObject = {
    ...area,
    facilities: [...area.facilities, created],
  }
  created = clampFacilityInsideParentZone(created, areaForSync)
  created = syncZoneChildFieldFromPlacement(created, {
    ...area,
    facilities: [...area.facilities, created],
  })
  // 依圖台佔分區比例，給設施一個非零場域外框（路網／停靠點可用）
  if (hasValidRefFieldBounds(zone.parameters)) {
    const zb = getRefFieldBounds(zone.parameters)
    const spanW = Math.max(
      0.1,
      ((zb.xMaxM ?? 0) - (zb.xMinM ?? 0)) * (w / zSize.w),
    )
    const spanH = Math.max(
      0.1,
      ((zb.yMaxM ?? 0) - (zb.yMinM ?? 0)) * (h / zSize.h),
    )
    const local = readZoneLocalField(created.parameters) ?? { u: 0.5, v: 0.5 }
    const abs = zoneLocalToAbsolute(local, zb)
    created = {
      ...created,
      parameters: patchRefFieldBounds(created.parameters, {
        xMinM: round2(abs.xM - spanW / 2),
        xMaxM: round2(abs.xM + spanW / 2),
        yMinM: round2(abs.yM - spanH / 2),
        yMaxM: round2(abs.yM + spanH / 2),
      }),
    }
  }
  return created
}

function applyAbsoluteFieldToFacility(
  facility: FacilityObject,
  xM: number,
  yM: number,
  /**
   * 照分區比例換算出來的外框。
   *
   * 給了就整個外框照它寫；沒給（舊資料沒記尺寸）才退回「只搬中心、尺寸不動」。
   */
  rect?: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number } | null,
): FacilityObject {
  const rx = round2(xM)
  const ry = round2(yM)
  if (usesRefFieldPoint(facility.type)) {
    return {
      ...facility,
      parameters: patchRefFieldPosition(facility.parameters, { xM: rx, yM: ry }),
    }
  }
  if (usesRefFieldBounds(facility.type)) {
    if (rect) {
      return {
        ...facility,
        parameters: patchRefFieldBounds(facility.parameters, {
          xMinM: round2(rect.xMinM),
          xMaxM: round2(rect.xMaxM),
          yMinM: round2(rect.yMinM),
          yMaxM: round2(rect.yMaxM),
        }),
      }
    }
    const b = getRefFieldBounds(facility.parameters)
    if (hasValidRefFieldBounds(facility.parameters)) {
      const halfW = ((b.xMaxM ?? 0) - (b.xMinM ?? 0)) / 2
      const halfH = ((b.yMaxM ?? 0) - (b.yMinM ?? 0)) / 2
      return {
        ...facility,
        parameters: patchRefFieldBounds(facility.parameters, {
          xMinM: round2(rx - halfW),
          xMaxM: round2(rx + halfW),
          yMinM: round2(ry - halfH),
          yMaxM: round2(ry + halfH),
        }),
      }
    }
    return {
      ...facility,
      parameters: patchRefFieldBounds(facility.parameters, {
        xMinM: rx,
        xMaxM: rx,
        yMinM: ry,
        yMaxM: ry,
      }),
    }
  }
  return {
    ...facility,
    parameters: {
      ...(facility.parameters ?? {}),
      [REF_FIELD_X_M]: rx,
      [REF_FIELD_Y_M]: ry,
    },
  }
}

/**
 * 拖曳後：若設施隸屬分區，依其在分區圖台內的相對位置換算真實場域座標。
 */
export function syncZoneChildFieldFromPlacement(
  facility: FacilityObject,
  area: MapAreaObject,
): FacilityObject {
  if (!canBelongToParentZone(facility)) return facility
  const parentId = readParentZoneId(facility.parameters)
  if (!parentId) return facility
  const zone = area.facilities.find((f) => f.id === parentId)
  if (!zone || !isZonePartition(zone)) return facility
  if (!hasValidRefFieldBounds(zone.parameters)) return facility
  const local = zoneLocalFromCanvasPlacement(facility, zone, area)
  if (!local) return facility
  const bounds = getRefFieldBounds(zone.parameters)
  const abs = zoneLocalToAbsolute(local, bounds)
  const withLocal: FacilityObject = {
    ...facility,
    parameters: {
      ...(facility.parameters ?? {}),
      [ZONE_LOCAL_FIELD_KEY]: local,
      [PARENT_ZONE_ID_KEY]: parentId,
    },
  }
  return applyAbsoluteFieldToFacility(
    withLocal,
    abs.xM,
    abs.yM,
    zoneLocalRectToAbsolute(local, bounds),
  )
}

/**
 * 分區場域範圍變更後：依已存 zoneLocalField 重算子設施真實場域座標。
 */
export function resyncZoneChildrenFromLocal(
  facilities: FacilityObject[],
  zoneId: string,
  /** 有給就可以在舊資料缺尺寸時回圖上量一次 */
  area?: MapAreaObject,
): FacilityObject[] {
  const zone = facilities.find((f) => f.id === zoneId)
  if (!zone || !isZonePartition(zone) || !hasValidRefFieldBounds(zone.parameters)) {
    return facilities
  }
  const bounds = getRefFieldBounds(zone.parameters)
  return facilities.map((f) => {
    if (!canBelongToParentZone(f)) return f
    if (readParentZoneId(f.parameters) !== zoneId) return f
    /*
     * 舊資料只記了中心、沒記外框尺寸。
     *
     * 這種時候要回圖上量一次，不能只搬中心——只搬中心就會留著上一版的大小，而這一步
     * 正是「分區範圍換了」才跑的，大小沿用舊的等於沒換。實測整備區改接之後，D1–D5
     * 的中心跟著移動了，尺寸卻還是 9.54×23.84（圖上量出來是 5.33×11.84）。
     */
    const stored = readZoneLocalField(f.parameters)
    const local =
      stored && stored.du != null && stored.dv != null
        ? stored
        : (area ? zoneLocalFromCanvasPlacement(f, zone, area) : null) ?? stored
    if (!local) return f
    const abs = zoneLocalToAbsolute(local, bounds)
    return applyAbsoluteFieldToFacility(
      {
        ...f,
        parameters: { ...(f.parameters ?? {}), [ZONE_LOCAL_FIELD_KEY]: local },
      },
      abs.xM,
      abs.yM,
      zoneLocalRectToAbsolute(local, bounds),
    )
  })
}

/** 列出隸屬某分區的子設施 id */
export function listChildFacilityIdsInZone(
  facilities: readonly FacilityObject[],
  zoneId: string,
): string[] {
  return facilities
    .filter(
      (f) =>
        canBelongToParentZone(f)
        && readParentZoneId(f.parameters) === zoneId,
    )
    .map((f) => f.id)
}

/**
 * 確保子設施已寫入 zoneLocalField（相對目前分區圖台外框）。
 * 分區縮放前呼叫，避免之後 rematerialize 失去相對位置。
 */
export function ensureZoneChildrenLocalFields(
  facilities: FacilityObject[],
  zoneId: string,
  area: MapAreaObject,
): FacilityObject[] {
  const zone = facilities.find((f) => f.id === zoneId)
  if (!zone || !isZonePartition(zone)) return facilities
  const areaCtx: MapAreaObject = { ...area, facilities }
  return facilities.map((f) => {
    if (!canBelongToParentZone(f)) return f
    if (readParentZoneId(f.parameters) !== zoneId) return f
    // 已經記過、而且連尺寸都記了就不動；只有 u／v 的舊資料要補上尺寸
    const existing = readZoneLocalField(f.parameters)
    if (existing && existing.du != null && existing.dv != null) return f
    const local = zoneLocalFromCanvasPlacement(f, zone, areaCtx)
    if (!local) return f
    return {
      ...f,
      parameters: {
        ...(f.parameters ?? {}),
        [ZONE_LOCAL_FIELD_KEY]: local,
        [PARENT_ZONE_ID_KEY]: zoneId,
      },
    }
  })
}

/**
 * 分區圖台位置／尺寸變更後：依 zoneLocalField 把子設施重放到新外框內，
 * 並同步真實場域座標（若分區有有效 refField）。
 */
export function rematerializeZoneChildrenOntoZoneCanvas(
  facilities: FacilityObject[],
  zoneId: string,
  area: MapAreaObject,
): FacilityObject[] {
  const zone = facilities.find((f) => f.id === zoneId)
  if (!zone || !isZonePartition(zone)) return facilities
  const zPos = resolveFacilityAreaPosition(zone, area.domain, area.layout)
  const zSize = resolveFacilityAreaSize(zone, area.domain, area.layout)
  if (!(zSize.w > 0) || !(zSize.h > 0)) return facilities
  const areaCtx: MapAreaObject = { ...area, facilities }
  const hasField = hasValidRefFieldBounds(zone.parameters)
  const bounds = hasField ? getRefFieldBounds(zone.parameters) : null

  return facilities.map((f) => {
    if (!canBelongToParentZone(f)) return f
    if (readParentZoneId(f.parameters) !== zoneId) return f
    const local =
      readZoneLocalField(f.parameters) ??
      zoneLocalFromCanvasPlacement(f, zone, areaCtx) ??
      ({ u: 0.5, v: 0.5 } as ZoneLocalField)
    const cSize = resolveFacilityAreaSize(f, area.domain, area.layout)
    const cx = zPos.x + local.u * zSize.w
    const cy = zPos.y + local.v * zSize.h
    let next = facilityWithAreaPosition(
      f,
      { x: cx - cSize.w / 2, y: cy - cSize.h / 2 },
      area.domain,
      area.layout,
    )
    next = {
      ...next,
      parameters: {
        ...(next.parameters ?? {}),
        [ZONE_LOCAL_FIELD_KEY]: local,
        [PARENT_ZONE_ID_KEY]: zoneId,
      },
    }
    next = clampFacilityInsideParentZone(next, areaCtx)
    if (bounds) {
      /*
       * 夾進分區之後外框可能被縮過，所以相對尺寸要照<strong>夾完</strong>的結果重算，
       * 不能沿用夾之前那一組——不然場域範圍會比圖上畫的還大。
       */
      const settled = zoneLocalFromCanvasPlacement(next, zone, {
        ...areaCtx,
        facilities: areaCtx.facilities.map((x) => (x.id === next.id ? next : x)),
      }) ?? local
      next = {
        ...next,
        parameters: { ...(next.parameters ?? {}), [ZONE_LOCAL_FIELD_KEY]: settled },
      }
      const abs = zoneLocalToAbsolute(settled, bounds)
      next = applyAbsoluteFieldToFacility(
        next,
        abs.xM,
        abs.yM,
        zoneLocalRectToAbsolute(settled, bounds),
      )
    }
    return next
  })
}

/** 入口連結變更後：同步分區參數，並重算各分區內子設施場域 */
export function applyEntranceLinksToAreaFacilities(
  facilities: FacilityObject[],
  entranceId: string,
  links: ZoneEntranceLink[],
  /** 有給就可以在舊資料缺尺寸時回圖上量一次，見 resyncZoneChildrenFromLocal */
  area?: MapAreaObject,
): FacilityObject[] {
  const entrance = facilities.find((f) => f.id === entranceId)
  if (!entrance || !isZoneEntrance(entrance)) return facilities

  const patches = syncPatchesFromEntranceLinks(links, entranceId)
  let next = facilities.map((f) => {
    if (f.id === entranceId) {
      return {
        ...f,
        parameters: {
          ...(f.parameters ?? {}),
          ...patchZoneEntranceLinks(links),
        },
      }
    }
    const patch = patches[f.id]
    if (!patch || !isZonePartition(f)) return f
    const { customNameSync, ...paramPatch } = patch
    const merged = { ...(f.parameters ?? {}), ...paramPatch }
    const customName =
      typeof customNameSync === 'string' && customNameSync.trim()
        ? customNameSync.trim()
        : f.customName
    return {
      ...f,
      customName: f.customName?.trim() ? f.customName : customName,
      parameters: merged,
    }
  })
  for (const link of links) {
    if (!link.zoneFacilityId) continue
    next = resyncZoneChildrenFromLocal(
      next,
      link.zoneFacilityId,
      area ? { ...area, facilities: next } : undefined,
    )
  }
  return next
}

export function listZonePartitionsInArea(
  facilities: readonly FacilityObject[],
): FacilityObject[] {
  return facilities.filter(isZonePartition)
}

/** 場上已被任一入口連結佔用的分區 id */
export function linkedZoneFacilityIds(
  facilities: readonly FacilityObject[],
): Set<string> {
  const ids = new Set<string>()
  for (const f of facilities) {
    if (!isZoneEntrance(f)) continue
    for (const link of readZoneEntranceLinks(f.parameters)) {
      if (link.zoneFacilityId) ids.add(link.zoneFacilityId)
    }
  }
  return ids
}

/**
 * 可加入此入口的分區：場上 ZonePartition，且尚未被任何入口連結。
 * （目前連結列上正在使用的 id 也會排除，避免重複。）
 */
export function availableZonePartitionsForEntrance(
  facilities: readonly FacilityObject[],
): FacilityObject[] {
  const taken = linkedZoneFacilityIds(facilities)
  return listZonePartitionsInArea(facilities).filter((z) => !taken.has(z.id))
}

/** 從既有分區圖元建立一筆入口連結（名稱／範圍先帶入分區現值，之後由入口覆寫同步） */
export function createZoneEntranceLinkFromPartition(
  zone: FacilityObject,
): ZoneEntranceLink {
  const bounds = getRefFieldBounds(zone.parameters)
  const hasSpan = hasValidRefFieldBounds(zone.parameters)
  const name =
    (typeof zone.customName === 'string' && zone.customName.trim()) ||
    zone.id
  return createZoneEntranceLink({
    name,
    zoneFacilityId: zone.id,
    xMinM: hasSpan ? (bounds.xMinM ?? 0) : 0,
    xMaxM: hasSpan ? (bounds.xMaxM ?? 10) : 10,
    yMinM: hasSpan ? (bounds.yMinM ?? 0) : 0,
    yMaxM: hasSpan ? (bounds.yMaxM ?? 10) : 10,
  })
}

export function facilityAbsoluteFieldCenter(
  facility: FacilityObject,
): { xM: number; yM: number } | null {
  if (
    usesRefFieldPoint(facility.type) &&
    hasValidRefFieldPosition(facility.parameters)
  ) {
    const p = getRefFieldPosition(facility.parameters)
    if (p.xM == null || p.yM == null) return null
    return { xM: p.xM, yM: p.yM }
  }
  if (
    usesRefFieldBounds(facility.type) &&
    hasValidRefFieldBounds(facility.parameters)
  ) {
    const b = getRefFieldBounds(facility.parameters)
    return {
      xM: ((b.xMinM ?? 0) + (b.xMaxM ?? 0)) / 2,
      yM: ((b.yMinM ?? 0) + (b.yMaxM ?? 0)) / 2,
    }
  }
  return null
}

/**
 * 載入地圖後：把分區內設施的場域範圍照「圖上外框 × 分區對應」重算一次。
 *
 * <h3>為什麼載入時就要做</h3>
 * 分區的意義是「圖上這一塊＝現場那一塊」，裡面的設施場域範圍是<strong>推導出來的</strong>，
 * 不是自己帶的。先前只換算中心、尺寸沿用舊值，於是換過圖的檔案裡留著上一版的大小——
 * 充電格畫成橫的、場域範圍卻是直的，比整個分區還高。那份數字沒有任何跡象說自己過期了，
 * 車端照它判斷停在哪一格、圖台照它的長邊擺車頭，兩邊都錯。
 *
 * 只改記憶體裡的內容，要等使用者存檔才寫回去；差距在 1 公分以內就當作沒變。
 */
export function resyncZoneChildBoundsInAreas(areas: MapAreaObject[]): {
  areas: MapAreaObject[]
  changed: string[]
} {
  const changed: string[] = []
  const nextAreas = areas.map((area) => {
    const zones = area.facilities.filter(
      (f) => isZonePartition(f) && hasValidRefFieldBounds(f.parameters),
    )
    if (zones.length === 0) return area

    const facilities = area.facilities.map((f) => {
      if (!canBelongToParentZone(f)) return f
      const parentId = readParentZoneId(f.parameters)
      if (!parentId) return f
      const zone = zones.find((z) => z.id === parentId)
      if (!zone) return f
      const local = zoneLocalFromCanvasPlacement(f, zone, area)
      if (!local) return f
      const bounds = getRefFieldBounds(zone.parameters)
      const rect = zoneLocalRectToAbsolute(local, bounds)
      if (!rect) return f
      const before = getRefFieldBounds(f.parameters)
      const same =
        hasValidRefFieldBounds(f.parameters)
        && Math.abs((before.xMinM ?? 0) - rect.xMinM) < 0.01
        && Math.abs((before.xMaxM ?? 0) - rect.xMaxM) < 0.01
        && Math.abs((before.yMinM ?? 0) - rect.yMinM) < 0.01
        && Math.abs((before.yMaxM ?? 0) - rect.yMaxM) < 0.01
      const abs = zoneLocalToAbsolute(local, bounds)
      const next = applyAbsoluteFieldToFacility(
        {
          ...f,
          parameters: {
            ...(f.parameters ?? {}),
            [ZONE_LOCAL_FIELD_KEY]: local,
            [PARENT_ZONE_ID_KEY]: parentId,
          },
        },
        abs.xM,
        abs.yM,
        rect,
      )
      if (!same) changed.push(f.customName || f.id)
      return next
    })

    return { ...area, facilities }
  })

  return { areas: nextAreas, changed }
}

/**
 * 貼上時：分區的「現場身分」也留在本尊身上。
 *
 * 一個分區不只是圖上的框，它同時宣告「我就是入口連結上的那一塊現場」。複製貼上把
 * 整包 parameters 照抄，於是兩個分區指向同一個連結、各自宣稱自己是那塊現場——實測
 * 這張圖的「整備區」就綁在「調度區」那條連結上，兩區的設施因此落在同一塊 27×68
 * 公尺的範圍裡互相重疊，圖上完全看不出來。
 *
 * 所以貼出來的分區是<strong>沒有綁定</strong>的空框，等使用者自己接到入口連結；
 * 分區裡的設施則拿掉相對座標與場域範圍，照它貼到的新位置重算。
 */
export function facilityCopyWithoutZoneBinding(facility: FacilityObject): FacilityObject {
  const p = { ...(facility.parameters ?? {}) } as Record<string, unknown>

  if (isZonePartition(facility)) {
    delete p[ZONE_PARTITION_ENTRANCE_ID_KEY]
    delete p[ZONE_PARTITION_LINK_ID_KEY]
    delete p[REF_FIELD_X_MIN_M]
    delete p[REF_FIELD_X_MAX_M]
    delete p[REF_FIELD_Y_MIN_M]
    delete p[REF_FIELD_Y_MAX_M]
    return { ...facility, parameters: p } as FacilityObject
  }

  if (isZoneEntrance(facility)) {
    // 連結裡記著「這個分區是哪一塊」，照抄會讓兩個入口爭同一個分區
    delete p[ZONE_ENTRANCE_LINKS_KEY]
    return { ...facility, parameters: p } as FacilityObject
  }

  if (canBelongToParentZone(facility) && readParentZoneId(p)) {
    delete p[ZONE_LOCAL_FIELD_KEY]
    delete p[REF_FIELD_X_MIN_M]
    delete p[REF_FIELD_X_MAX_M]
    delete p[REF_FIELD_Y_MIN_M]
    delete p[REF_FIELD_Y_MAX_M]
    return { ...facility, parameters: p } as FacilityObject
  }

  return facility
}

/**
 * 載入地圖後：一條入口連結只能有一個分區。
 *
 * 兩個分區綁同一條連結時，它們會算出同一塊現場範圍——裡面的設施疊在一起，而且沒有
 * 任何跡象。留下連結自己指名的那一個（<code>zoneFacilityId</code>），指名的不在就
 * 留文件順序裡先出現的；其餘解除綁定，等使用者重新接。
 *
 * 只改記憶體裡的內容，要等使用者存檔才寫回去。
 */
export function dropDuplicateZoneBindingsInAreas(areas: MapAreaObject[]): {
  areas: MapAreaObject[]
  unbound: string[]
} {
  const unbound: string[] = []
  const nextAreas = areas.map((area) => {
    const entrances = area.facilities.filter(isZoneEntrance)
    const keep = new Set<string>()
    const seen = new Map<string, string>()

    for (const zone of area.facilities) {
      if (!isZonePartition(zone)) continue
      const binding = readZonePartitionBinding(zone.parameters)
      if (!binding?.entranceId || !binding.linkId) continue
      const key = `${binding.entranceId}|${binding.linkId}`
      const entrance = entrances.find((e) => e.id === binding.entranceId)
      const link = entrance
        ? readZoneEntranceLinks(entrance.parameters).find((l) => l.id === binding.linkId)
        : undefined
      // 連結指名誰就是誰；沒指名（或指名的不在）才用先來後到
      if (link?.zoneFacilityId === zone.id) keep.add(zone.id)
      else if (!seen.has(key)) seen.set(key, zone.id)
    }
    for (const [key, id] of seen) {
      const claimed = area.facilities.some((f) => {
        if (!isZonePartition(f) || !keep.has(f.id)) return false
        const b = readZonePartitionBinding(f.parameters)
        return b != null && `${b.entranceId}|${b.linkId}` === key
      })
      if (!claimed) keep.add(id)
    }

    let touched = false
    const facilities = area.facilities.map((zone) => {
      if (!isZonePartition(zone)) return zone
      const binding = readZonePartitionBinding(zone.parameters)
      if (!binding?.entranceId || !binding.linkId) return zone
      if (keep.has(zone.id)) return zone
      touched = true
      unbound.push(zone.customName || zone.id)
      const p = { ...(zone.parameters ?? {}) } as Record<string, unknown>
      delete p[ZONE_PARTITION_ENTRANCE_ID_KEY]
      delete p[ZONE_PARTITION_LINK_ID_KEY]
      delete p[REF_FIELD_X_MIN_M]
      delete p[REF_FIELD_X_MAX_M]
      delete p[REF_FIELD_Y_MIN_M]
      delete p[REF_FIELD_Y_MAX_M]
      return { ...zone, parameters: p } as FacilityObject
    })

    return touched ? { ...area, facilities } : area
  })

  return { areas: nextAreas, unbound }
}

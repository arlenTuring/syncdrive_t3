import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  TRACKGEN_LAT_MODE_KEY,
  TRACKGEN_LAT_PER_BOX_KEY,
  TRACKGEN_LOCAL_PATH_KEY,
  TRACKGEN_REAL_PATH_KEY,
  TRACKGEN_SPANS_KEY,
} from './trackGenPaths'
import {
  REF_FIELD_X_MAX_M,
  REF_FIELD_X_MIN_M,
  REF_FIELD_Y_MAX_M,
  REF_FIELD_Y_MIN_M,
} from './facilityRefFieldBounds'
import { REF_FIELD_CORNERS_M } from './facilityRefFieldCorners'
import {
  CROSS_PORTAL_KEYS,
  CROSS_PORTALS_KEY,
  defaultCrossPortalCode,
} from './crossTrackPortals'

/**
 * 生成軌道的「現場身分」。
 *
 * <h3>什麼是身分</h3>
 * 一塊生成出來的軌道不只是畫在圖上的方塊，它同時宣告「我就是路網上的<strong>那一段</strong>」：
 *
 * <pre>
 *   trackGenRealPath    現場那條中心線的實際座標
 *   trackGenSpans       road／lane／里程起訖
 *   refField*           這一塊涵蓋現場的哪個範圍
 * </pre>
 *
 * 這些是<strong>不可共享</strong>的：同一段路不會同時在兩個地方。
 *
 * <h3>為什麼要有這一支</h3>
 * 複製貼上會把整包 parameters 照抄過去，於是新的那一塊也宣稱自己是同一段路。圖上
 * 完全看不出來——兩塊長得一樣、各自待在各自的位置——但換算現場座標時兩塊會給出
 * 同一個答案。實測一張圖裡有六組這樣的方塊，其中交叉軌道 D03/U03 與 D34/U34 相隔
 * 330 公尺卻共用同一條中心線，模擬器把 S2W 那段的路徑點算到了 N2W 上，路線長度多
 * 算 600 公尺，車輛在圖上會瞬移。
 *
 * 複製出來的那一塊該是「一個一樣形狀的方塊」，不是「同一段路」。所以貼上時把身分
 * 拿掉，讓它照自己待的位置重新推算場域範圍。
 */
const IDENTITY_KEYS = [
  TRACKGEN_REAL_PATH_KEY,
  TRACKGEN_LOCAL_PATH_KEY,
  TRACKGEN_SPANS_KEY,
  TRACKGEN_LAT_PER_BOX_KEY,
  TRACKGEN_LAT_MODE_KEY,
  'trackGenRole',
  'trackGenLine',
  'trackGenLineLengthM',
  'segmentId',
  REF_FIELD_X_MIN_M,
  REF_FIELD_X_MAX_M,
  REF_FIELD_Y_MIN_M,
  REF_FIELD_Y_MAX_M,
  REF_FIELD_CORNERS_M,
] as const

export function hasTrackGenIdentity(
  parameters: Record<string, unknown> | undefined,
): boolean {
  return Array.isArray(parameters?.[TRACKGEN_REAL_PATH_KEY])
}

/** 拿掉現場身分，形狀與顏色原封不動 */
export function stripTrackGenIdentity(
  parameters: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next = { ...(parameters ?? {}) }
  for (const key of IDENTITY_KEYS) delete next[key]
  return next
}

/**
 * 同一條中心線被幾塊共用時的簽章。
 *
 * 只看真實路徑：圖面路徑、外框、顏色都可以合理地一樣（並排的兩條軌道本來就長得
 * 一樣），只有「現場的哪一段」不能一樣。
 */
function identitySignature(
  parameters: Record<string, unknown> | undefined,
): string | null {
  const real = parameters?.[TRACKGEN_REAL_PATH_KEY]
  if (!Array.isArray(real) || real.length < 2) return null
  return JSON.stringify(real)
}

export type TrackGenIdentityRepair = {
  areas: MapAreaObject[]
  /** 被拿掉身分的方塊代號，照出現順序 */
  stripped: string[]
  /** 場域範圍不是場域座標、已清掉等著重算的方塊代號 */
  cleared: string[]
}

/** 生成軌道實際涵蓋的現場範圍，外擴一點當容許值 */
function generatedFieldExtent(area: MapAreaObject): {
  xMinM: number
  xMaxM: number
  yMinM: number
  yMaxM: number
} | null {
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (const f of area.facilities) {
    if (f.type !== 'Track') continue
    const real = f.parameters?.[TRACKGEN_REAL_PATH_KEY]
    if (!Array.isArray(real)) continue
    for (const point of real) {
      if (!Array.isArray(point) || point.length < 2) continue
      const x = Number(point[0])
      const y = Number(point[1])
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      if (x < xMin) xMin = x
      if (x > xMax) xMax = x
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
    }
  }
  if (!Number.isFinite(xMin) || !(xMax > xMin) || !(yMax > yMin)) return null
  // 軌道可以稍微超出路網本身（端面、外框），但不會超出一個街廓
  const pad = Math.max(50, (xMax - xMin) * 0.1, (yMax - yMin) * 0.1)
  return { xMinM: xMin - pad, xMaxM: xMax + pad, yMinM: yMin - pad, yMaxM: yMax + pad }
}

/**
 * 這個場域範圍根本不是場域座標。
 *
 * 自動推算會在「沒有任何一塊軌道解釋得了這個角」時退回容器自己的網域，那是 0 到寬、
 * 0 到高的格線，與 .xodr 的座標不是同一套。四個角混著兩套數字寫進去，出來的範圍會
 * 橫跨整張圖——實測一塊斜接的範圍是 x −884～119、y −194～447，而整個路網只在
 * x −885～−14、y −338～3 之間。
 *
 * 現在的推算已經不會再寫出這種值（見 facilityRefFieldBoundsAuto），這裡是清掉<strong>
 * 已經寫進圖資</strong>的那些。
 */
function refFieldOutsideNetwork(
  parameters: Record<string, unknown> | undefined,
  extent: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number },
): boolean {
  const outX = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && (v < extent.xMinM || v > extent.xMaxM)
  const outY = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && (v < extent.yMinM || v > extent.yMaxM)
  const p = parameters ?? {}
  if (outX(p[REF_FIELD_X_MIN_M]) || outX(p[REF_FIELD_X_MAX_M])) return true
  if (outY(p[REF_FIELD_Y_MIN_M]) || outY(p[REF_FIELD_Y_MAX_M])) return true
  const corners = p[REF_FIELD_CORNERS_M]
  if (Array.isArray(corners)) {
    for (const c of corners) {
      if (!c || typeof c !== 'object') continue
      const one = c as { xM?: unknown; yM?: unknown }
      if (outX(one.xM) || outY(one.yM)) return true
    }
  }
  return false
}

/** 只清場域範圍，生成軌道的身分留著 */
function clearRefField(
  parameters: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next = { ...(parameters ?? {}) }
  delete next[REF_FIELD_X_MIN_M]
  delete next[REF_FIELD_X_MAX_M]
  delete next[REF_FIELD_Y_MIN_M]
  delete next[REF_FIELD_Y_MAX_M]
  delete next[REF_FIELD_CORNERS_M]
  return next
}

/**
 * 修掉已經存在圖資裡的共用身分。
 *
 * 先出現的那一塊留著——貼上是往後加的，所以文件順序裡先出現的才是本尊。後面每一塊
 * 都把身分拿掉，它們的場域範圍會在 <code>ensureAutoRefFieldBoundsInAreas</code> 那一步
 * 照自己的位置重新推算。
 *
 * 這是<strong>載入時</strong>做的修補，不是靜靜地改使用者的檔案：改完的內容要等到
 * 使用者自己存檔才會寫回去，而畫面上會說明清掉了幾塊。
 */
export function dropSharedTrackGenIdentityInAreas(
  areas: MapAreaObject[],
): TrackGenIdentityRepair {
  const seen = new Set<string>()
  const stripped: string[] = []
  const cleared: string[] = []

  const next = areas.map((area) => {
    const extent = generatedFieldExtent(area)
    let changed = false
    const facilities = area.facilities.map((facility: FacilityObject) => {
      if (facility.type !== 'Track') return facility
      const signature = identitySignature(facility.parameters)

      if (signature && seen.has(signature)) {
        changed = true
        stripped.push(facility.customName || facility.id)
        return {
          ...facility,
          parameters: stripTrackGenIdentity(facility.parameters),
        } as FacilityObject
      }
      if (signature) seen.add(signature)

      if (extent && refFieldOutsideNetwork(facility.parameters, extent)) {
        changed = true
        cleared.push(facility.customName || facility.id)
        return {
          ...facility,
          parameters: clearRefField(facility.parameters),
        } as FacilityObject
      }
      return facility
    })
    return changed ? { ...area, facilities } : area
  })

  const touched = stripped.length > 0 || cleared.length > 0
  return { areas: touched ? next : areas, stripped, cleared }
}

/** 圖上已經有人用的代號 */
function usedNames(areas: MapAreaObject[]): Set<string> {
  const names = new Set<string>()
  for (const area of areas) {
    for (const f of area.facilities) {
      const name = (f.customName ?? '').trim()
      if (name) names.add(name)
    }
  }
  return names
}

/**
 * 貼上一塊軌道時，把「現場身分」留在本尊身上。
 *
 * 三件事：
 * <pre>
 *   現場身分   拿掉（見 stripTrackGenIdentity）——貼出來的是一樣形狀的方塊，不是同一段路
 *   代號       不重複——兩塊同名時，照代號查座標的那一邊只查得到先出現的那一塊
 *   交叉的口   換成新的途經點代號——沿用會讓兩個路口宣稱自己是同一個轉線點
 * </pre>
 *
 * 其餘（外型、顏色、標籤、端面比例）原封不動：使用者複製的就是那些。
 */
export function facilityCopyWithoutTrackGenIdentity(
  facility: FacilityObject,
  areas: MapAreaObject[],
): FacilityObject {
  let parameters: Record<string, unknown> = { ...(facility.parameters ?? {}) }

  if (hasTrackGenIdentity(parameters)) {
    parameters = stripTrackGenIdentity(parameters)
  }

  const portals = parameters[CROSS_PORTALS_KEY]
  if (portals && typeof portals === 'object') {
    const next: Record<string, unknown> = {}
    for (const key of CROSS_PORTAL_KEYS) {
      const one = (portals as Record<string, unknown>)[key]
      next[key] = {
        ...(one && typeof one === 'object' ? one : {}),
        waypointCode: defaultCrossPortalCode(facility.id, key),
      }
    }
    parameters = { ...parameters, [CROSS_PORTALS_KEY]: next }
  }

  const base = (facility.customName ?? '').trim()
  let customName = facility.customName
  if (base) {
    const taken = usedNames(areas)
    if (taken.has(base)) {
      let n = 2
      while (taken.has(`${base}-${n}`)) n += 1
      customName = `${base}-${n}`
    }
  }

  return { ...facility, customName, parameters } as FacilityObject
}

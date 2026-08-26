/** 模擬器控制面的 HTTP 介面。網頁與伺服器同源，所以是相對路徑。 */

export type Waypoint = {
  /** 場域公尺——車輛用的，伺服器換算後回填 */
  x: number
  y: number
  /** 圖面像素——圖台上的位置，編輯器只碰這一組 */
  px: number | null
  py: number | null
  /** 有值＝這是班表定的停靠站，不能拖也不能刪 */
  stationId?: string
}

export type RouteStation = {
  id: string
  name: string
  x: number
  y: number
  px: number | null
  py: number | null
}

export type TrackHit = {
  id: string
  code: string
  areaId: string
  refField: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number }
}

export type RouteEntry = {
  routeId: string
  displayName: string
  stationIds: string[]
  stations: RouteStation[]
  missing: string[]
  editable: boolean
  customised: boolean
  waypoints: Waypoint[]
  tracks: TrackHit[]
  samples: Array<{ x: number; y: number }>
  lengthM: number
}

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error((body as { error?: string } | null)?.error ?? `${input} 回應 ${response.status}`)
  }
  return body as T
}

export function fetchMapDocument(): Promise<unknown> {
  return json<unknown>('/api/map/document')
}

/** 有場域範圍的方塊，含圖面上的絕對像素框 */
export type FieldBox = { id: string; code: string; x: number; y: number; w: number; h: number }

/**
 * 方塊的像素框，只拿來做<strong>命中判斷</strong>：這個折線點有沒有落在某個方塊上。
 *
 * 判斷而已，不做座標換算——換算留在伺服器一份就好。少了這個判斷，使用者要按下
 * 儲存才知道某個點飄到軌道外面去了。
 */
export async function fetchFieldBoxes(): Promise<FieldBox[]> {
  const body = await json<{
    facilities: Array<FieldBox & { field: unknown | null }>
  }>('/api/map/geometry')
  return body.facilities
    .filter((f) => f.field != null)
    .map(({ id, code, x, y, w, h }) => ({ id, code, x, y, w, h }))
}

export async function fetchRoutes(): Promise<RouteEntry[]> {
  const body = await json<{ routes: RouteEntry[] }>('/api/routes')
  return body.routes
}

/** 只送像素：換成場域公尺是伺服器的事，換算邏輯不該有第二份。 */
export function saveRoutePath(
  routeId: string,
  waypoints: Array<{ px: number; py: number; stationId?: string }>,
): Promise<RouteEntry> {
  return json<RouteEntry>('/api/routes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routeId, waypoints }),
  })
}

export function resetRoutePath(routeId: string): Promise<RouteEntry> {
  return json<RouteEntry>('/api/routes/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routeId }),
  })
}

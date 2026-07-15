import type { MapPlannedRoute, MapRouteGroup } from '../types/mapFile'

const GROUP_ID_PATTERN = /^route_group_(\d+)$/

export type RouteGroupSection = {
  group: MapRouteGroup
  routes: MapPlannedRoute[]
}

export function generateNextRouteGroupId(groups: MapRouteGroup[]): string {
  const ids = new Set(groups.map((g) => g.groupId))
  let max = 0
  for (const id of ids) {
    const match = GROUP_ID_PATTERN.exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  let next = max + 1
  let candidate = `route_group_${next}`
  while (ids.has(candidate)) {
    next += 1
    candidate = `route_group_${next}`
  }
  return candidate
}

export function parseMapRouteGroups(raw: unknown): MapRouteGroup[] {
  if (!Array.isArray(raw)) return []
  const out: MapRouteGroup[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const groupId = typeof o.groupId === 'string' ? o.groupId.trim() : ''
    const displayName = typeof o.displayName === 'string' ? o.displayName.trim() : ''
    if (!groupId || !displayName) continue
    const routeIds = Array.isArray(o.routeIds)
      ? o.routeIds
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => id.trim())
      : []
    out.push({
      groupId,
      displayName,
      routeIds,
      ...(typeof o.createdAt === 'string' ? { createdAt: o.createdAt } : {}),
      ...(typeof o.updatedAt === 'string' ? { updatedAt: o.updatedAt } : {}),
    })
  }
  return out
}

/** 載入舊地圖：若無群組但有路線，建立預設「T3接駁路線」群組 */
export function ensureRouteGroupsForRoutes(
  routes: MapPlannedRoute[],
  groups: MapRouteGroup[],
): MapRouteGroup[] {
  if (groups.length > 0) return groups
  if (routes.length === 0) return []
  const now = new Date().toISOString()
  return [
    {
      groupId: 'route_group_1',
      displayName: 'T3接駁路線',
      routeIds: routes.map((r) => r.routeId),
      createdAt: now,
      updatedAt: now,
    },
  ]
}

export function findRouteGroupForRoute(
  groups: MapRouteGroup[],
  routeId: string,
): MapRouteGroup | null {
  return groups.find((g) => g.routeIds.includes(routeId)) ?? null
}

export function removeRouteFromAllGroups(
  groups: MapRouteGroup[],
  routeId: string,
): MapRouteGroup[] {
  return groups.map((g) => ({
    ...g,
    routeIds: g.routeIds.filter((id) => id !== routeId),
  }))
}

export function assignRouteToGroup(
  groups: MapRouteGroup[],
  routeId: string,
  groupId: string | null,
): MapRouteGroup[] {
  const without = removeRouteFromAllGroups(groups, routeId)
  if (!groupId) return without
  return without.map((g) =>
    g.groupId === groupId
      ? { ...g, routeIds: g.routeIds.includes(routeId) ? g.routeIds : [...g.routeIds, routeId] }
      : g,
  )
}

export function organizeRoutesByGroups(
  groups: MapRouteGroup[],
  routes: MapPlannedRoute[],
): { sections: RouteGroupSection[]; ungrouped: MapPlannedRoute[] } {
  const routeById = new Map(routes.map((r) => [r.routeId, r]))
  const assigned = new Set<string>()

  const sections: RouteGroupSection[] = []
  for (const group of groups) {
    const groupRoutes: MapPlannedRoute[] = []
    for (const routeId of group.routeIds) {
      const route = routeById.get(routeId)
      if (!route) continue
      groupRoutes.push(route)
      assigned.add(routeId)
    }
    sections.push({ group, routes: groupRoutes })
  }

  const ungrouped = routes.filter((r) => !assigned.has(r.routeId))
  return { sections, ungrouped }
}

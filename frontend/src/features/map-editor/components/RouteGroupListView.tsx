import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FolderOpen,
  GitBranch,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MapAreaObject } from '../types/area'
import type { MapPlannedRoute, MapRouteGroup } from '../types/mapFile'
import { organizeRoutesByGroups } from '../utils/routeGroupPlanning'
import { stationDisplayLabel, formatRouteTravelTimeSummary } from '../utils/routePlanning'
import type { PointTopology } from '../types/pointTopology'
import { buildTopologyRouteTravelBreakdown } from '../utils/topologyRouteTravel'

type Props = {
  areas: MapAreaObject[]
  routeGroups: MapRouteGroup[]
  routes: MapPlannedRoute[]
  pointTopology: PointTopology
  editMode: boolean
  visibleRouteIds: ReadonlySet<string>
  onToggleRouteVisibility: (routeId: string) => void
  onToggleGroupRouteVisibility: (routeIds: string[]) => void
  onEditRoute: (routeId: string) => void
  onDeleteRoute: (routeId: string) => void
  onEditGroup: (groupId: string) => void
  onDeleteGroup: (groupId: string) => void
  onStartNewRoute: (groupId: string | null) => void
  onStartNewGroup: () => void
}

type MenuKey = `route:${string}` | `group:${string}`

type GroupVisibility = 'all' | 'none' | 'partial'

function resolveGroupVisibility(
  routeIds: string[],
  visibleRouteIds: ReadonlySet<string>,
): GroupVisibility {
  if (routeIds.length === 0) return 'none'
  const visibleCount = routeIds.filter((id) => visibleRouteIds.has(id)).length
  if (visibleCount === 0) return 'none'
  if (visibleCount === routeIds.length) return 'all'
  return 'partial'
}

function RowActionsMenu({
  menuKey,
  openMenuKey,
  onOpenMenu,
  onCloseMenu,
  onEdit,
  onDelete,
}: {
  menuKey: MenuKey
  openMenuKey: MenuKey | null
  onOpenMenu: (key: MenuKey) => void
  onCloseMenu: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const open = openMenuKey === menuKey
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        onCloseMenu()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onCloseMenu])

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => onOpenMenu(menuKey)}
        title="更多操作"
        className="flex items-center justify-center rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
      >
        <MoreHorizontal className="size-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[7.5rem] overflow-hidden rounded-md border border-zinc-600 bg-zinc-950 py-1 shadow-xl">
          <button
            type="button"
            onClick={() => {
              onCloseMenu()
              onEdit()
            }}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-zinc-200 hover:bg-zinc-800"
          >
            <Pencil className="size-3 text-zinc-400" />
            編輯
          </button>
          <button
            type="button"
            onClick={() => {
              onCloseMenu()
              onDelete()
            }}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-red-300 hover:bg-red-950/40"
          >
            <Trash2 className="size-3 text-red-400" />
            刪除
          </button>
        </div>
      ) : null}
    </div>
  )
}

function RouteRow({
  areas,
  route,
  pointTopology,
  editMode,
  isVisible,
  menuKey,
  openMenuKey,
  onOpenMenu,
  onCloseMenu,
  onToggleVisibility,
  onEdit,
  onDelete,
}: {
  areas: MapAreaObject[]
  route: MapPlannedRoute
  pointTopology: PointTopology
  editMode: boolean
  isVisible: boolean
  menuKey: MenuKey
  openMenuKey: MenuKey | null
  onOpenMenu: (key: MenuKey) => void
  onCloseMenu: () => void
  onToggleVisibility: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const pathLabel =
    route.stationIds.map((id) => stationDisplayLabel(areas, id)).join(' → ') ||
    '（無有效站點）'
  const topology = useMemo(
    () =>
      route.stationIds.length >= 2
        ? buildTopologyRouteTravelBreakdown(pointTopology, areas, route.stationIds)
        : null,
    [route.stationIds, pointTopology, areas],
  )
  const topologyAvailable = Boolean(
    topology?.pathsComplete && topology?.timesComplete,
  )
  const topologyPathOk = Boolean(topology?.pathsComplete)
  const timeSummary = topologyAvailable
    ? formatRouteTravelTimeSummary(
        topology!.totalAvgTravelTimeSeconds,
        topology!.totalMinTravelTimeSeconds,
      )
    : formatRouteTravelTimeSummary(
        route.avgTravelTimeSeconds,
        route.minTravelTimeSeconds,
      )

  return (
    <div
      className={[
        'ml-3 flex items-stretch gap-1 rounded-md border',
        topologyAvailable
          ? isVisible
            ? 'border-cyan-500/30 bg-zinc-950/30'
            : 'border-zinc-800/80 bg-zinc-950/30'
          : 'border-zinc-800/50 bg-zinc-950/20 opacity-45',
      ].join(' ')}
      title={
        topologyAvailable
          ? undefined
          : topologyPathOk
            ? '拓撲路徑已連但時間未完整 — 路線不可用'
            : '拓撲無此站序組合 — 路線不可用'
      }
    >
      <button
        type="button"
        onClick={onToggleVisibility}
        disabled={!topologyAvailable}
        title={
          !topologyAvailable
            ? '拓撲組合不成立，無法顯示'
            : isVisible
              ? '隱藏地圖路線'
              : '顯示地圖路線'
        }
        className={[
          'flex shrink-0 items-center justify-center rounded-l-md px-2 transition-colors',
          !topologyAvailable
            ? 'cursor-not-allowed text-zinc-700'
            : isVisible
              ? 'text-cyan-300 hover:bg-cyan-950/40'
              : 'text-zinc-600 hover:bg-zinc-800/80 hover:text-zinc-300',
        ].join(' ')}
      >
        {isVisible && topologyAvailable ? (
          <Eye className="size-3.5" />
        ) : (
          <EyeOff className="size-3.5" />
        )}
      </button>
      <div className="min-w-0 flex-1 py-2 pr-1">
        <div className="flex items-center gap-1.5">
          <p
            className={[
              'min-w-0 truncate text-[11px] font-medium',
              topologyAvailable ? 'text-zinc-200' : 'text-zinc-500',
            ].join(' ')}
          >
            {route.displayName}
          </p>
        </div>
        <p className="mt-0.5 truncate text-[10px] text-zinc-600">{pathLabel}</p>
        {timeSummary && topologyAvailable ? (
          <p className="mt-0.5 text-[9px] text-zinc-600">
            {timeSummary}
            {topology?.totalDistanceMeters != null
              ? ` · ${topology.totalDistanceMeters} m`
              : ''}
          </p>
        ) : null}
        {!topologyAvailable ? (
          <p className="mt-0.5 text-[9px] text-zinc-600">
            {topologyPathOk ? '拓撲時間未完整 · 不可用' : '拓撲無此組合 · 不可用'}
          </p>
        ) : null}
      </div>
      {editMode ? (
        <RowActionsMenu
          menuKey={menuKey}
          openMenuKey={openMenuKey}
          onOpenMenu={onOpenMenu}
          onCloseMenu={onCloseMenu}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ) : null}
    </div>
  )
}

export function RouteGroupListView({
  areas,
  routeGroups,
  routes,
  pointTopology,
  editMode,
  visibleRouteIds,
  onToggleRouteVisibility,
  onToggleGroupRouteVisibility,
  onEditRoute,
  onDeleteRoute,
  onEditGroup,
  onDeleteGroup,
  onStartNewRoute,
  onStartNewGroup,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [openMenuKey, setOpenMenuKey] = useState<MenuKey | null>(null)

  const { sections, ungrouped } = useMemo(
    () => organizeRoutesByGroups(routeGroups, routes),
    [routeGroups, routes],
  )

  const isEmpty = routeGroups.length === 0 && routes.length === 0

  const toggleCollapsed = (groupId: string) => {
    setCollapsed((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  const isGroupOpen = (groupId: string) => !collapsed[groupId]

  const handleOpenMenu = (key: MenuKey) => {
    setOpenMenuKey((prev) => (prev === key ? null : key))
  }

  const handleCloseMenu = () => setOpenMenuKey(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-[10px] leading-snug text-zinc-500">
        路線依群組管理；點眼睛可顯示或隱藏地圖路徑，群組眼睛會一次切換組內所有路線。
      </p>

      {isEmpty ? (
        <p className="rounded-md border border-dashed border-zinc-700/70 px-2 py-6 text-center text-[10px] text-zinc-600">
          尚無路線群組。
          {editMode ? '請先新增群組，再製作路線。' : '請進入編輯模式以管理路線。'}
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {sections.map(({ group, routes: groupRoutes }) => {
            const open = isGroupOpen(group.groupId)
            const groupRouteIds = groupRoutes.map((r) => r.routeId)
            const groupVisibility = resolveGroupVisibility(groupRouteIds, visibleRouteIds)
            const groupEyeTitle =
              groupRouteIds.length === 0
                ? '此群組尚無路線'
                : groupVisibility === 'all'
                  ? '隱藏群組內所有路線'
                  : '顯示群組內所有路線'

            return (
              <section
                key={group.groupId}
                className="overflow-hidden rounded-lg border border-zinc-700/80 bg-zinc-950/40"
              >
                <div className="flex items-stretch gap-0.5">
                  <button
                    type="button"
                    onClick={() => onToggleGroupRouteVisibility(groupRouteIds)}
                    disabled={groupRouteIds.length === 0}
                    title={groupEyeTitle}
                    className={[
                      'flex shrink-0 items-center justify-center px-2 transition-colors disabled:cursor-default disabled:opacity-40',
                      groupVisibility === 'all'
                        ? 'text-cyan-300 hover:bg-cyan-950/40'
                        : groupVisibility === 'partial'
                          ? 'text-cyan-300/50 hover:bg-cyan-950/30'
                          : 'text-zinc-600 hover:bg-zinc-800/80 hover:text-zinc-300',
                    ].join(' ')}
                  >
                    {groupVisibility === 'none' ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(group.groupId)}
                    className="flex min-w-0 flex-1 items-start gap-2 px-1 py-2.5 text-left hover:bg-zinc-900/50"
                  >
                    {open ? (
                      <ChevronDown className="mt-0.5 size-4 shrink-0 text-zinc-500" />
                    ) : (
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-zinc-500" />
                    )}
                    <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] font-semibold text-zinc-100">
                      <FolderOpen className="size-3.5 shrink-0 text-sky-400/90" />
                      <span className="truncate">{group.displayName}</span>
                    </p>
                  </button>
                  {editMode ? (
                    <div className="flex shrink-0 items-center pr-1">
                      <RowActionsMenu
                        menuKey={`group:${group.groupId}`}
                        openMenuKey={openMenuKey}
                        onOpenMenu={handleOpenMenu}
                        onCloseMenu={handleCloseMenu}
                        onEdit={() => onEditGroup(group.groupId)}
                        onDelete={() => onDeleteGroup(group.groupId)}
                      />
                    </div>
                  ) : null}
                </div>

                {open ? (
                  <div className="space-y-1.5 border-t border-zinc-800/80 px-2 pb-2.5 pt-2">
                    {groupRoutes.length === 0 ? (
                      <p className="px-1 py-2 text-[10px] text-zinc-600">此群組尚無路線</p>
                    ) : (
                      groupRoutes.map((route) => (
                        <RouteRow
                          key={route.routeId}
                          areas={areas}
                          route={route}
                          pointTopology={pointTopology}
                          editMode={editMode}
                          isVisible={visibleRouteIds.has(route.routeId)}
                          menuKey={`route:${route.routeId}`}
                          openMenuKey={openMenuKey}
                          onOpenMenu={handleOpenMenu}
                          onCloseMenu={handleCloseMenu}
                          onToggleVisibility={() => onToggleRouteVisibility(route.routeId)}
                          onEdit={() => onEditRoute(route.routeId)}
                          onDelete={() => onDeleteRoute(route.routeId)}
                        />
                      ))
                    )}
                    {editMode ? (
                      <button
                        type="button"
                        onClick={() => onStartNewRoute(group.groupId)}
                        className="ml-3 flex w-[calc(100%-0.75rem)] items-center justify-center gap-1 rounded-md border border-dashed border-amber-600/40 py-1.5 text-[10px] text-amber-200/90 hover:bg-amber-950/30"
                      >
                        <Plus className="size-3" />
                        在此群組製作路線
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            )
          })}

          {ungrouped.length > 0 ? (
            <section className="rounded-lg border border-dashed border-zinc-700/80 bg-zinc-950/20 p-2.5">
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                <GitBranch className="size-3.5" />
                未分組路線
              </p>
              <div className="space-y-1.5">
                {ungrouped.map((route) => (
                  <RouteRow
                    key={route.routeId}
                    areas={areas}
                    route={route}
                    pointTopology={pointTopology}
                    editMode={editMode}
                    isVisible={visibleRouteIds.has(route.routeId)}
                    menuKey={`route:${route.routeId}`}
                    openMenuKey={openMenuKey}
                    onOpenMenu={handleOpenMenu}
                    onCloseMenu={handleCloseMenu}
                    onToggleVisibility={() => onToggleRouteVisibility(route.routeId)}
                    onEdit={() => onEditRoute(route.routeId)}
                    onDelete={() => onDeleteRoute(route.routeId)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      {editMode ? (
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            type="button"
            onClick={onStartNewGroup}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-sky-600/50 bg-sky-950/30 px-3 py-2 text-[11px] font-medium text-sky-200 hover:bg-sky-900/40"
          >
            <Plus className="size-4" />
            新增路線群組
          </button>
          {routeGroups.length === 0 ? (
            <button
              type="button"
              onClick={() => onStartNewRoute(null)}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-950/40 px-3 py-2 text-[11px] font-medium text-amber-200 hover:bg-amber-900/50"
            >
              <Plus className="size-4" />
              製作路線（未分組）
            </button>
          ) : null}
        </div>
      ) : (
        <p className="shrink-0 rounded-md border border-zinc-700/70 bg-zinc-950/50 px-2.5 py-2 text-center text-[10px] text-zinc-500">
          請進入編輯模式以管理路線群組
        </p>
      )}
    </div>
  )
}

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
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
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
  const { t } = useTranslation()
  const open = openMenuKey === menuKey
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => {
    if (!open) {
      setMenuPos(null)
      return
    }
    const updatePos = () => {
      const btn = buttonRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      })
    }
    updatePos()
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target) || portalRef.current?.contains(target)) {
        return
      }
      onCloseMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onCloseMenu])

  return (
    <div ref={rootRef} className="relative shrink-0 self-start">
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenMenu(menuKey)
        }}
        title={t('mapEditor.routeGroupList.moreActions')}
        className="flex items-center justify-center rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
      >
        <MoreHorizontal className="size-3.5" />
      </button>
      {open && menuPos
        ? createPortal(
            <div
              ref={portalRef}
              className="fixed z-[12000] w-max overflow-hidden rounded-md border border-zinc-600 bg-zinc-950 py-0.5 shadow-xl"
              style={{ top: menuPos.top, right: menuPos.right }}
            >
              <button
                type="button"
                onClick={() => {
                  onCloseMenu()
                  onEdit()
                }}
                className="flex w-full items-center gap-1.5 whitespace-nowrap px-2 py-1 text-left text-[11px] text-zinc-200 hover:bg-zinc-800"
              >
                <Pencil className="size-3 shrink-0 text-zinc-400" />
                {t('mapEditor.routeGroupList.edit')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onCloseMenu()
                  onDelete()
                }}
                className="flex w-full items-center gap-1.5 whitespace-nowrap px-2 py-1 text-left text-[11px] text-red-300 hover:bg-red-950/40"
              >
                <Trash2 className="size-3 shrink-0 text-red-400" />
                {t('mapEditor.routeGroupList.delete')}
              </button>
            </div>,
            document.body,
          )
        : null}
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
  const { t } = useTranslation()
  const pathLabel =
    route.stationIds.map((id) => stationDisplayLabel(areas, id)).join(' → ') ||
    t('mapEditor.routeGroupList.noValidStations')
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

  const unavailableDetail = useMemo(() => {
    if (topologyAvailable) return null
    if (route.stationIds.length < 2) return t('mapEditor.routeGroupList.stationsTooFew')
    const legHint = topology?.legs.find((leg) => leg.message)?.message
    if (legHint) return legHint
    if (topologyPathOk) return t('mapEditor.routeGroupList.topologyTimesIncomplete')
    return t('mapEditor.routeGroupList.topologyNoPath')
  }, [topologyAvailable, topologyPathOk, topology, route.stationIds.length, t])

  return (
    <div
      className={[
        'ml-3 flex items-stretch gap-1 rounded-md border',
        topologyAvailable
          ? isVisible
            ? 'border-cyan-500/30 bg-zinc-950/30'
            : 'border-zinc-800/80 bg-zinc-950/30'
          : 'border-amber-800/40 bg-amber-950/15',
      ].join(' ')}
      title={
        topologyAvailable
          ? undefined
          : unavailableDetail
            ? t('mapEditor.routeGroupList.unavailableWithDetail', { detail: unavailableDetail })
            : t('mapEditor.routeGroupList.unavailable')
      }
    >
      <button
        type="button"
        onClick={onToggleVisibility}
        disabled={!topologyAvailable}
        title={
          !topologyAvailable
            ? t('mapEditor.routeGroupList.topologyNotReady')
            : isVisible
              ? t('mapEditor.routeGroupList.hideRoute')
              : t('mapEditor.routeGroupList.showRoute')
        }
        className={[
          'flex shrink-0 items-center justify-center rounded-l-md px-2 transition-colors',
          !topologyAvailable
            ? 'cursor-not-allowed text-zinc-500'
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
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="min-w-0 truncate text-[11px] font-medium text-zinc-100">
            {route.displayName}
          </p>
          {!topologyAvailable ? (
            <span className="shrink-0 rounded border border-amber-700/50 bg-amber-950/40 px-1 py-px text-[8px] font-semibold tracking-wide text-amber-200">
              {t('mapEditor.routeGroupList.unavailableBadge')}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[10px] text-zinc-400">{pathLabel}</p>
        {timeSummary && topologyAvailable ? (
          <p className="mt-0.5 text-[9px] text-zinc-500">
            {timeSummary}
            {topology?.totalDistanceMeters != null
              ? ` · ${topology.totalDistanceMeters} m`
              : ''}
          </p>
        ) : null}
        {!topologyAvailable && unavailableDetail ? (
          <p className="mt-0.5 text-[9px] leading-snug text-amber-200/90">
            {t('mapEditor.routeGroupList.missing', { detail: unavailableDetail })}
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
  const { t } = useTranslation()
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
        {t('mapEditor.routeGroupList.intro')}
      </p>

      {isEmpty ? (
        <p className="rounded-md border border-dashed border-zinc-700/70 px-2 py-6 text-center text-[10px] text-zinc-600">
          {t('mapEditor.routeGroupList.empty')}
          {editMode ? t('mapEditor.routeGroupList.emptyEdit') : t('mapEditor.routeGroupList.emptyView')}
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {sections.map(({ group, routes: groupRoutes }) => {
            const open = isGroupOpen(group.groupId)
            const groupRouteIds = groupRoutes.map((r) => r.routeId)
            const groupVisibility = resolveGroupVisibility(groupRouteIds, visibleRouteIds)
            const groupEyeTitle =
              groupRouteIds.length === 0
                ? t('mapEditor.routeGroupList.groupEmpty')
                : groupVisibility === 'all'
                  ? t('mapEditor.routeGroupList.hideGroupRoutes')
                  : t('mapEditor.routeGroupList.showGroupRoutes')

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
                      <p className="px-1 py-2 text-[10px] text-zinc-600">{t('mapEditor.routeGroupList.groupEmpty')}</p>
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
                        {t('mapEditor.routeGroupList.createInGroup')}
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
                {t('mapEditor.routeGroupList.ungrouped')}
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
            {t('mapEditor.routeGroupList.addGroup')}
          </button>
          {routeGroups.length === 0 ? (
            <button
              type="button"
              onClick={() => onStartNewRoute(null)}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-950/40 px-3 py-2 text-[11px] font-medium text-amber-200 hover:bg-amber-900/50"
            >
              <Plus className="size-4" />
              {t('mapEditor.routeGroupList.createUngrouped')}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="shrink-0 rounded-md border border-zinc-700/70 bg-zinc-950/50 px-2.5 py-2 text-center text-[10px] text-zinc-500">
          {t('mapEditor.routeGroupList.enterEdit')}
        </p>
      )}
    </div>
  )
}

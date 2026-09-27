import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AREA_PALETTE_ITEM,
  FACILITY_PALETTE_ITEMS,
  TRACKGEN_PALETTE_ITEM,
  type FacilityPaletteItem,
  type PaletteItem,
} from '../constants/palette'
import type { FacilityName } from '../types/facility'
import {
  encodePaletteDragItem,
  isAreaPaletteItem,
  isBasemapPaletteItem,
  isTrackGenPaletteItem,
  PALETTE_DRAG_MIME,
} from '../utils/paletteDrag'
import {
  AddRoad,
  HorizontalRule,
  KeyboardArrowLeft,
  Login,
  TurnSlightRight,
  VerticalSplit,
} from './MaterialSymbols'

/** 元件庫高度（設計稿 105：上下 8 ＋ 內容 88 ＋ 上框 1） */
export const PALETTE_DRAWER_HEIGHT_CLASS = 'h-[105px]'

const ICON_BASE = '/map-editor-icons/object-lib-icons'

/**
 * 元件圖示。設計稿提供的 SVG（整顆 48px 圓鈕，含底色與外框）直接用；
 * 還沒有圖檔的元件用同一套 Material Symbols 畫在同樣的圓鈕裡，看起來一致。
 */
type PaletteIcon = { src: string } | { Symbol: ComponentType<{ className?: string }> }

const ICON_BY_NAME: Partial<Record<FacilityName, PaletteIcon>> = {
  FacilityArea: { src: `${ICON_BASE}/facility.svg` },
  ZoneEntrance: { Symbol: Login },
  ZonePartition: { Symbol: VerticalSplit },
  Light: { src: `${ICON_BASE}/traffic-lights.svg` },
  SmartPole: { src: `${ICON_BASE}/smart-pole.svg` },
  Gate: { src: `${ICON_BASE}/gate.svg` },
  RailCorner: { src: `${ICON_BASE}/circle-track.svg` },
  RailCross: { src: `${ICON_BASE}/cross-tracker.svg` },
  Rail: { Symbol: HorizontalRule },
  RailTaper: { Symbol: TurnSlightRight },
  DockingPoint: { src: `${ICON_BASE}/stop-point.svg` },
  Waypoint: { src: `${ICON_BASE}/route-point.svg` },
  RoadLine: { Symbol: AddRoad },
}

function iconFor(item: PaletteItem): PaletteIcon {
  if (isTrackGenPaletteItem(item)) return { src: `${ICON_BASE}/hd-map.svg` }
  if (isAreaPaletteItem(item)) return { src: `${ICON_BASE}/area.svg` }
  if (isBasemapPaletteItem(item)) return { src: `${ICON_BASE}/hd-map.svg` }
  return ICON_BY_NAME[(item as FacilityPaletteItem).name] ?? { Symbol: HorizontalRule }
}

function itemKey(item: PaletteItem): string {
  if (isAreaPaletteItem(item)) return 'area'
  if (isBasemapPaletteItem(item)) return 'basemap'
  if (isTrackGenPaletteItem(item)) return 'trackgen'
  return `${item.label}-${(item as FacilityPaletteItem).name}`
}

type PaletteGroup = { key: string; labelKey: string; items: PaletteItem[] }

/** 各組的排列照設計稿；設計稿沒畫到的元件接在該組後面 */
const GROUP_ORDER: Array<{ key: string; labelKey: string; names: FacilityName[] }> = [
  { key: 'facility', labelKey: 'mapEditor.palette.groups.facility', names: ['FacilityArea', 'ZoneEntrance', 'ZonePartition'] },
  { key: 'equipment', labelKey: 'mapEditor.palette.groups.equipment', names: ['Light', 'SmartPole', 'Gate'] },
  { key: 'track', labelKey: 'mapEditor.palette.groups.track', names: ['RailCorner', 'RailCross', 'Rail', 'RailTaper'] },
  { key: 'other', labelKey: 'mapEditor.palette.groups.other', names: ['DockingPoint', 'Waypoint', 'RoadLine'] },
]

function buildPaletteGroups(): PaletteGroup[] {
  const byName = new Map(FACILITY_PALETTE_ITEMS.map((item) => [item.name, item] as const))
  const placed = new Set<FacilityName>()
  const groups: PaletteGroup[] = [
    {
      key: 'map-layer',
      labelKey: 'mapEditor.palette.groups.mapLayer',
      // 底圖不再放進元件庫：載入 .xodr 這件事由高精地圖元件做，兩個並存只會讓人選錯
      items: [TRACKGEN_PALETTE_ITEM, AREA_PALETTE_ITEM],
    },
  ]
  for (const group of GROUP_ORDER) {
    const items: PaletteItem[] = []
    for (const name of group.names) {
      const item = byName.get(name)
      if (item) {
        items.push(item)
        placed.add(name)
      }
    }
    groups.push({ key: group.key, labelKey: group.labelKey, items })
  }
  // 新加的元件還沒排進設計稿：放在「其他」，不會因為沒分組就消失
  const rest = FACILITY_PALETTE_ITEMS.filter((item) => !placed.has(item.name))
  if (rest.length > 0) groups[groups.length - 1]!.items.push(...rest)
  return groups.filter((group) => group.items.length > 0)
}

const PALETTE_GROUPS = buildPaletteGroups()

type AssetPaletteBarProps = {
  onPick: (item: PaletteItem) => void
  /** 再按左側「元件庫」把手 → 收合 */
  onToggle: () => void
}

/**
 * 元件庫（編輯模式，貼在地圖面板底部）：設計稿「Bottom/元件庫」。
 * 左側藍色把手收合；各組「標題 ｜ 元件…」，組與組之間一條長分隔線。
 */
export function AssetPaletteBar({ onPick, onToggle }: AssetPaletteBarProps) {
  const { t } = useTranslation()

  return (
    <div
      className={`pointer-events-auto absolute bottom-0 left-0 right-0 z-50 flex ${PALETTE_DRAWER_HEIGHT_CLASS} items-center border-t border-[rgba(212,212,212,0.15)] bg-black p-2`}
      role="toolbar"
      aria-label={t('mapEditor.palette.library')}
    >
      <button
        type="button"
        title={t('mapEditor.palette.collapse')}
        onClick={onToggle}
        className="flex h-[88px] w-[46px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-[#2B7FFF] px-1.5 py-2 text-sm font-medium leading-[18px] tracking-[0.5px] text-white transition hover:bg-[#2569e6]"
      >
        <KeyboardArrowLeft className="size-4 shrink-0" />
        <span style={{ writingMode: 'vertical-rl', letterSpacing: '4px' }}>
          {t('mapEditor.palette.library')}
        </span>
      </button>

      <div className="flex h-[88px] min-w-0 flex-1 flex-row flex-nowrap items-center gap-3 overflow-x-auto px-3">
        {PALETTE_GROUPS.map((group, groupIndex) => (
          <div key={group.key} className="flex h-full shrink-0 flex-row items-center gap-3">
            {groupIndex > 0 ? (
              <span className="h-16 w-px shrink-0 bg-[rgba(212,212,212,0.15)]" aria-hidden />
            ) : null}
            <span className="shrink-0 text-sm leading-[18px] tracking-[0.5px] text-[#6A7282]">
              {t(group.labelKey)}
            </span>
            <span className="h-4 w-px shrink-0 bg-[rgba(212,212,212,0.15)]" aria-hidden />
            {group.items.map((item) => {
              const icon = iconFor(item)
              const clickEnabled =
                isAreaPaletteItem(item) || isBasemapPaletteItem(item) || isTrackGenPaletteItem(item)
              const itemLabel = t(item.label)
              const itemHint = t(item.hint)
              return (
                <div key={itemKey(item)} className="flex w-[65px] shrink-0 flex-col items-center gap-0.5">
                  <button
                    type="button"
                    draggable
                    onClick={() => {
                      if (clickEnabled) onPick(item)
                    }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PALETTE_DRAG_MIME, encodePaletteDragItem(item))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    title={
                      clickEnabled
                        ? isBasemapPaletteItem(item) || isTrackGenPaletteItem(item)
                          ? `${itemHint}\n${t('mapEditor.palette.clickOrDragAnywhere')}`
                          : `${itemHint}\n${t('mapEditor.palette.clickCenterOrDrag')}`
                        : `${itemHint}\n${t('mapEditor.palette.dragIntoAreaOnly')}`
                    }
                    aria-label={t('mapEditor.palette.addAria', { label: itemLabel, hint: itemHint })}
                    className="group flex size-12 cursor-grab items-center justify-center rounded-full transition hover:brightness-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#51A2FF]/60 active:cursor-grabbing"
                  >
                    {'src' in icon ? (
                      <img src={icon.src} alt="" draggable={false} className="size-12" />
                    ) : (
                      <span className="flex size-12 items-center justify-center rounded-full border border-[rgba(212,212,212,0.15)] bg-[rgba(142,197,255,0.08)] text-[#99A1AF]">
                        <icon.Symbol className="size-7" />
                      </span>
                    )}
                  </button>
                  <span className="w-full select-none truncate text-center text-sm leading-[18px] tracking-[0.5px] text-[#6A7282]">
                    {itemLabel}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

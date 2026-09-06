import { LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  AREA_PALETTE_ITEM,
  FACILITY_PALETTE_ITEMS,
  TRACKGEN_PALETTE_ITEM,
  type FacilityPaletteItem,
  type PaletteItem,
} from '../constants/palette'
import {
  isMapEquipmentType,
  isMapFacilityAreaType,
  isMapTrackType,
} from '../constants/facilityTaxonomy'
import { AREA_PALETTE_ICON, PALETTE_ICON_BY_NAME } from '../utils/facilityIcons'
import { Image as ImageIcon, Route } from 'lucide-react'
import {
  encodePaletteDragItem,
  isAreaPaletteItem,
  isBasemapPaletteItem,
  isTrackGenPaletteItem,
  PALETTE_DRAG_MIME,
} from '../utils/paletteDrag'

/** 抽屜總高（把手與內容同一塊） */
export const PALETTE_DRAWER_HEIGHT_CLASS = 'h-24'

type PaletteGroup = {
  key: string
  labelKey: string | null
  items: PaletteItem[]
}

function buildPaletteGroups(): PaletteGroup[] {
  const facilityItems: FacilityPaletteItem[] = []
  const equipmentItems: FacilityPaletteItem[] = []
  const trackItems: FacilityPaletteItem[] = []
  const otherItems: FacilityPaletteItem[] = []

  for (const item of FACILITY_PALETTE_ITEMS) {
    if (isMapFacilityAreaType(item.type)) facilityItems.push(item)
    else if (isMapEquipmentType(item.type)) equipmentItems.push(item)
    else if (isMapTrackType(item.type)) trackItems.push(item)
    else otherItems.push(item)
  }

  return [
    {
      key: 'map-layer',
      labelKey: 'mapEditor.palette.groups.mapLayer',
      // 底圖不再放進元件庫：載入 .xodr 這件事由高精地圖元件做，兩個並存只會讓人選錯
      items: [TRACKGEN_PALETTE_ITEM, AREA_PALETTE_ITEM],
    },
    { key: 'facility', labelKey: 'mapEditor.palette.groups.facility', items: facilityItems },
    { key: 'equipment', labelKey: 'mapEditor.palette.groups.equipment', items: equipmentItems },
    { key: 'track', labelKey: 'mapEditor.palette.groups.track', items: trackItems },
    { key: 'other', labelKey: 'mapEditor.palette.groups.other', items: otherItems },
  ].filter((group) => group.items.length > 0)
}

const PALETTE_GROUPS = buildPaletteGroups()

type AssetPaletteBarProps = {
  onPick: (item: PaletteItem) => void
  /** 再按左側「元件庫」把手 → 收合 */
  onToggle: () => void
}

/**
 * 元件庫抽屜：把手與展開區同一外框，高度／上下緣天然對齊。
 * 再開合只靠左側把手。
 */
export function AssetPaletteBar({ onPick, onToggle }: AssetPaletteBarProps) {
  const { t } = useTranslation()

  return (
    <div
      className={`pointer-events-auto absolute bottom-0 left-0 right-0 z-50 flex ${PALETTE_DRAWER_HEIGHT_CLASS} border-t border-cyan-500/55 bg-zinc-900/95 shadow-[0_-10px_32px_rgba(0,0,0,0.35)] backdrop-blur-md`}
      role="toolbar"
      aria-label={t('mapEditor.palette.library')}
    >
      <button
        type="button"
        title={t('mapEditor.palette.collapse')}
        onClick={onToggle}
        className="flex w-11 shrink-0 flex-col items-center justify-center gap-1 border-r border-cyan-500/35 text-[10px] font-medium text-cyan-200 transition hover:bg-cyan-950/40"
      >
        <LayoutGrid className="size-4 shrink-0" />
        <span style={{ writingMode: 'vertical-rl' }}>{t('mapEditor.palette.library')}</span>
      </button>

      <div className="flex min-w-0 flex-1 items-center px-3">
        <div className="flex h-full flex-row flex-nowrap items-center justify-start gap-x-5 overflow-x-auto">
          {PALETTE_GROUPS.map((group, groupIndex) => (
            <div
              key={group.key}
              className={[
                'flex h-full flex-row items-center gap-x-4',
                groupIndex > 0 ? 'border-l border-zinc-700/80 pl-5' : '',
              ].join(' ')}
            >
              {group.labelKey ? (
                <span className="shrink-0 text-[10px] font-medium tracking-wide text-zinc-500">
                  {t(group.labelKey)}
                </span>
              ) : null}
              {group.items.map((item) => {
                const Icon = isAreaPaletteItem(item)
                  ? AREA_PALETTE_ICON
                  : isBasemapPaletteItem(item)
                    ? ImageIcon
                    : isTrackGenPaletteItem(item)
                      ? Route
                      : PALETTE_ICON_BY_NAME[item.name]
                const clickEnabled =
                  isAreaPaletteItem(item) || isBasemapPaletteItem(item) || isTrackGenPaletteItem(item)
                const itemLabel = t(item.label)
                const itemHint = t(item.hint)
                return (
                  <div
                    key={
                      isAreaPaletteItem(item)
                        ? 'area'
                        : isBasemapPaletteItem(item)
                          ? 'basemap'
                          : isTrackGenPaletteItem(item)
                            ? 'trackgen'
                            : `${item.label}-${item.name}`
                    }
                    className="flex w-[3.75rem] shrink-0 flex-col items-center justify-center gap-1"
                  >
                    <button
                      type="button"
                      draggable
                      onClick={() => {
                        if (clickEnabled) onPick(item)
                      }}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          PALETTE_DRAG_MIME,
                          encodePaletteDragItem(item),
                        )
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      title={
                        clickEnabled
                          ? isBasemapPaletteItem(item) || isTrackGenPaletteItem(item)
                            ? `${itemHint}\n${t('mapEditor.palette.clickOrDragAnywhere')}`
                            : `${itemHint}\n${t('mapEditor.palette.clickCenterOrDrag')}`
                          : `${itemHint}\n${t('mapEditor.palette.dragIntoAreaOnly')}`
                      }
                      aria-label={t('mapEditor.palette.addAria', {
                        label: itemLabel,
                        hint: itemHint,
                      })}
                      className="group flex size-11 cursor-grab items-center justify-center rounded-full border border-zinc-600 bg-zinc-800/90 text-cyan-300 shadow-md transition hover:border-cyan-500/70 hover:bg-zinc-700 hover:text-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 active:cursor-grabbing sm:size-12"
                    >
                      <Icon
                        className="size-5 transition-transform group-hover:scale-105 sm:size-6"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    </button>
                    <span className="w-full select-none text-center text-[10px] leading-tight text-zinc-300">
                      {itemLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

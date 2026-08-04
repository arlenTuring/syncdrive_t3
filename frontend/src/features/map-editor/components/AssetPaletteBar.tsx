import { LayoutGrid } from 'lucide-react'
import {
  AREA_PALETTE_ITEM,
  FACILITY_PALETTE_ITEMS,
  type FacilityPaletteItem,
  type PaletteItem,
} from '../constants/palette'
import { isMapEquipmentType, isMapFacilityAreaType } from '../constants/facilityTaxonomy'
import { AREA_PALETTE_ICON, PALETTE_ICON_BY_NAME } from '../utils/facilityIcons'
import {
  encodePaletteDragItem,
  isAreaPaletteItem,
  PALETTE_DRAG_MIME,
} from '../utils/paletteDrag'

/** 抽屜總高（把手與內容同一塊） */
export const PALETTE_DRAWER_HEIGHT_CLASS = 'h-24'

type PaletteGroup = {
  key: string
  label: string | null
  items: PaletteItem[]
}

function buildPaletteGroups(): PaletteGroup[] {
  const facilityItems: FacilityPaletteItem[] = []
  const equipmentItems: FacilityPaletteItem[] = []
  const otherItems: FacilityPaletteItem[] = []

  for (const item of FACILITY_PALETTE_ITEMS) {
    if (isMapFacilityAreaType(item.type)) facilityItems.push(item)
    else if (isMapEquipmentType(item.type)) equipmentItems.push(item)
    else otherItems.push(item)
  }

  return [
    { key: 'area', label: null, items: [AREA_PALETTE_ITEM] },
    { key: 'facility', label: '設施', items: facilityItems },
    { key: 'equipment', label: '設備', items: equipmentItems },
    { key: 'other', label: '其他', items: otherItems },
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
  return (
    <div
      className={`pointer-events-auto absolute bottom-0 left-0 right-0 z-50 flex ${PALETTE_DRAWER_HEIGHT_CLASS} border-t border-cyan-500/55 bg-zinc-900/95 shadow-[0_-10px_32px_rgba(0,0,0,0.35)] backdrop-blur-md`}
      role="toolbar"
      aria-label="元件庫"
    >
      <button
        type="button"
        title="收合元件庫"
        onClick={onToggle}
        className="flex w-11 shrink-0 flex-col items-center justify-center gap-1 border-r border-cyan-500/35 text-[10px] font-medium text-cyan-200 transition hover:bg-cyan-950/40"
      >
        <LayoutGrid className="size-4 shrink-0" />
        <span style={{ writingMode: 'vertical-rl' }}>元件庫</span>
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
              {group.label ? (
                <span className="shrink-0 text-[10px] font-medium tracking-wide text-zinc-500">
                  {group.label}
                </span>
              ) : null}
              {group.items.map((item) => {
                const Icon = isAreaPaletteItem(item)
                  ? AREA_PALETTE_ICON
                  : PALETTE_ICON_BY_NAME[item.name]
                const clickEnabled = isAreaPaletteItem(item)
                return (
                  <div
                    key={isAreaPaletteItem(item) ? 'area' : `${item.label}-${item.name}`}
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
                          ? `${item.hint}\n拖曳至地圖可指定位置`
                          : `${item.hint}\n僅可拖曳至 Area 內`
                      }
                      aria-label={`加入：${item.label}。${item.hint}`}
                      className="group flex size-11 cursor-grab items-center justify-center rounded-full border border-zinc-600 bg-zinc-800/90 text-cyan-300 shadow-md transition hover:border-cyan-500/70 hover:bg-zinc-700 hover:text-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 active:cursor-grabbing sm:size-12"
                    >
                      <Icon
                        className="size-5 transition-transform group-hover:scale-105 sm:size-6"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    </button>
                    <span className="w-full select-none text-center text-[10px] leading-tight text-zinc-300">
                      {item.label}
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

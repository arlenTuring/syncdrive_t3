import { LayoutGrid } from 'lucide-react'
import {
  AREA_PALETTE_ITEM,
  FACILITY_PALETTE_ITEMS,
  type PaletteItem,
} from '../constants/palette'
import { AREA_PALETTE_ICON, PALETTE_ICON_BY_NAME } from '../utils/facilityIcons'
import {
  encodePaletteDragItem,
  isAreaPaletteItem,
  PALETTE_DRAG_MIME,
} from '../utils/paletteDrag'

/** 抽屜總高（把手與內容同一塊） */
export const PALETTE_DRAWER_HEIGHT_CLASS = 'h-24'

const PALETTE_ENTRIES: PaletteItem[] = [AREA_PALETTE_ITEM, ...FACILITY_PALETTE_ITEMS]

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
        <div className="flex h-full flex-row flex-nowrap items-center justify-start gap-x-4 overflow-x-auto">
          {PALETTE_ENTRIES.map((item) => {
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
      </div>
    </div>
  )
}

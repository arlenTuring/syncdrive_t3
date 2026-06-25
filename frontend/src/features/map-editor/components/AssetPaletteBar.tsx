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

type AssetPaletteBarProps = {
  onPick: (item: PaletteItem) => void
}

const PALETTE_ENTRIES: PaletteItem[] = [AREA_PALETTE_ITEM, ...FACILITY_PALETTE_ITEMS]

export function AssetPaletteBar({ onPick }: AssetPaletteBarProps) {
  return (
    <div
      className="pointer-events-auto absolute bottom-0 left-0 right-0 z-40 border-t border-zinc-700/80 bg-zinc-950/95 px-3 py-3 shadow-[0_-8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md"
      role="toolbar"
      aria-label="加入 Area 或設施"
    >
      <p className="mb-2 text-center text-[11px] text-zinc-500">
        Area：點擊加在畫布中心 · 拖曳指定位置 · 設施僅可拖入 Area 內
      </p>
      <div className="mx-auto flex max-w-[min(100%,1200px)] flex-row flex-wrap items-end justify-center gap-x-4 gap-y-3 pl-14 pr-4 sm:pl-16">
        {PALETTE_ENTRIES.map((item) => {
          const Icon = isAreaPaletteItem(item)
            ? AREA_PALETTE_ICON
            : PALETTE_ICON_BY_NAME[item.name]
          const clickEnabled = isAreaPaletteItem(item)
          return (
            <div
              key={isAreaPaletteItem(item) ? 'area' : `${item.label}-${item.name}`}
              className="flex shrink-0 flex-col items-center gap-1.5"
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
                className={`group flex size-14 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800/90 text-cyan-300 shadow-md transition hover:border-cyan-500/70 hover:bg-zinc-700 hover:text-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 active:cursor-grabbing sm:size-16 ${
                  clickEnabled ? 'cursor-grab' : 'cursor-grab opacity-95'
                }`}
              >
                <Icon
                  className="size-7 transition-transform group-hover:scale-105 sm:size-8"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </button>
              <span className="max-w-[4.5rem] select-none text-center text-[10px] leading-tight text-zinc-400 sm:max-w-[5rem] sm:text-[11px]">
                {item.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

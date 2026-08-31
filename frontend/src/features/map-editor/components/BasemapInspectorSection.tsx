import type { MapBasemapObject } from '../types/basemap'
import {
  BASEMAP_OPACITY_KEY,
  getBasemapFileName,
  getBasemapOpacity,
  getBasemapSourceType,
} from '../utils/basemapFacility'

type Props = {
  basemap: MapBasemapObject
  readOnly: boolean
  onChangeCustomName: (customName: string) => void
  onPatchParameters: (patch: Record<string, unknown>) => void
  onDelete: () => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

export function BasemapInspectorSection({
  basemap,
  readOnly,
  onChangeCustomName,
  onPatchParameters,
  onDelete,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const opacity = getBasemapOpacity(basemap.parameters)
  const opacityPct = Math.round(opacity * 100)
  const sourceType = getBasemapSourceType(basemap.parameters)
  const fileName = getBasemapFileName(basemap.parameters)

  return (
    <aside
      data-inspector
      className="flex h-full min-h-0 w-72 flex-col border-l border-zinc-700/80 bg-zinc-900"
    >
      <div className="border-b border-zinc-700/80 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        底圖屬性
        {readOnly && (
          <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-normal normal-case text-zinc-400">
            檢視
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3 text-sm text-zinc-200">
        <section className="space-y-2.5 rounded-lg border border-zinc-800/70 bg-zinc-950/45 p-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            識別
          </h3>
          <div>
            <label htmlFor="basemap-id" className="mb-1 block text-[10px] text-zinc-500">
              底圖 ID
            </label>
            <input
              id="basemap-id"
              value={basemap.id}
              readOnly
              className="w-full cursor-default rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-zinc-100 opacity-90 outline-none"
            />
          </div>
          <div>
            <label htmlFor="basemap-name" className="mb-1 block text-[10px] text-zinc-500">
              顯示名稱
            </label>
            <input
              id="basemap-name"
              value={basemap.customName}
              readOnly={readOnly}
              onChange={(e) => onChangeCustomName(e.target.value)}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none focus:border-cyan-500 read-only:cursor-default read-only:opacity-90"
            />
          </div>
          {fileName ? (
            <p className="text-[10px] text-zinc-600">
              檔案：{fileName}
              {sourceType ? `（${sourceType === 'xodr' ? 'OpenDRIVE' : '圖片'}）` : ''}
            </p>
          ) : null}
        </section>

        <section className="space-y-2.5 rounded-lg border border-zinc-800/70 bg-zinc-950/45 p-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            顯示
          </h3>
          <div>
            <label
              htmlFor="basemap-opacity"
              className="mb-1 flex items-center justify-between text-[10px] text-zinc-500"
            >
              <span>底圖透明度</span>
              <span className="font-mono text-cyan-400/90">{opacityPct}%</span>
            </label>
            <input
              id="basemap-opacity"
              type="range"
              min={0}
              max={100}
              step={1}
              disabled={readOnly}
              value={opacityPct}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              onChange={(e) => {
                if (readOnly) return
                onPatchParameters({
                  [BASEMAP_OPACITY_KEY]: Number(e.target.value) / 100,
                })
              }}
              className="h-2 w-full cursor-pointer accent-cyan-500 disabled:opacity-40"
            />
            <div className="mt-1 flex justify-between text-[9px] text-zinc-600">
              <span>全透明</span>
              <span>不透明</span>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
              僅影響圖片或 OpenDRIVE 圖層；格線與距離刻度維持不透明，方便對齊。
            </p>
          </div>
        </section>

        {!readOnly ? (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200 transition hover:bg-red-950/70"
          >
            刪除底圖
          </button>
        ) : null}
      </div>
    </aside>
  )
}

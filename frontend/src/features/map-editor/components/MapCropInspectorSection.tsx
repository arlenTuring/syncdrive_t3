import type { MapCropWorkspace } from '../utils/mapCropMode'
import type { MapPixelSize } from '../types/area'

type Props = {
  workspace: MapCropWorkspace
  outputSize: MapPixelSize
}

export function MapCropInspectorSection({
  workspace,
  outputSize,
}: Props) {
  const { cropRect, contentExtent } = workspace
  const viewOrigin = {
    x: cropRect.x - workspace.mapOffset.x,
    y: cropRect.y - workspace.mapOffset.y,
  }
  return (
    <aside data-inspector className="flex h-full min-h-0 flex-col bg-zinc-900/50">
      <div className="border-b border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs font-medium uppercase tracking-wide text-amber-300">
        裁減模式
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-sm">
        <p className="text-xs leading-relaxed text-zinc-500">
          請使用上方工具列 <strong className="text-amber-200/90">套用裁切</strong>
          或 <strong className="text-zinc-300">取消</strong>
          。拖曳琥珀框的邊或角調整輸出範圍；拖上邊往下為從上方裁切（底邊固定）。
          Area 座標不會被移動。
        </p>
        <dl className="space-y-2 font-mono text-[11px] text-zinc-400">
          <div className="flex justify-between gap-2">
            <dt className="text-zinc-600">工作區</dt>
            <dd>
              {workspace.workspace.width}×{workspace.workspace.height} px
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-zinc-600">內容範圍</dt>
            <dd>
              {contentExtent.width}×{contentExtent.height} px
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-zinc-600">可視原點</dt>
            <dd>
              {viewOrigin.x}, {viewOrigin.y}
            </dd>
          </div>
          <div className="rounded-md border border-amber-700/40 bg-amber-950/40 px-3 py-2.5">
            <dt className="text-xs font-medium text-amber-200/80">輸出解析度</dt>
            <dd className="mt-1 font-mono text-xl font-semibold tabular-nums text-amber-50">
              {outputSize.width}×{outputSize.height}
              <span className="ml-1 text-sm font-medium text-amber-200/70">px</span>
            </dd>
          </div>
        </dl>
      </div>
    </aside>
  )
}

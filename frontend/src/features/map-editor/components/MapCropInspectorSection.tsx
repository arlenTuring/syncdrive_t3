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
    <aside data-inspector className="flex h-full min-h-0 flex-col bg-surface-primary">
      <div className="border-b border-status-warning-light bg-status-warning-light px-3 py-2 text-body-xs-bold uppercase text-status-warning">
        裁減模式
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-body-s">
        <p className="text-body-xs text-text-quaternary">
          請使用上方工具列 <strong className="text-status-warning">套用裁切</strong>
          或 <strong className="text-text-secondary">取消</strong>
          。拖曳琥珀框的邊或角調整輸出範圍；拖上邊往下為從上方裁切（底邊固定）。
          Area 座標不會被移動。
        </p>
        <dl className="space-y-2 font-mono text-body-xs text-text-tertiary">
          <div className="flex justify-between gap-2">
            <dt className="text-text-disabled">工作區</dt>
            <dd>
              {workspace.workspace.width}×{workspace.workspace.height} px
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-text-disabled">內容範圍</dt>
            <dd>
              {contentExtent.width}×{contentExtent.height} px
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-text-disabled">可視原點</dt>
            <dd>
              {viewOrigin.x}, {viewOrigin.y}
            </dd>
          </div>
          <div className="rounded-md border border-status-warning-light bg-status-warning-light px-3 py-2.5">
            <dt className="text-body-xs-bold text-status-warning">輸出解析度</dt>
            <dd className="mt-1 font-mono text-headline-4 tabular-nums text-status-warning">
              {outputSize.width}×{outputSize.height}
              <span className="ml-1 text-body-s-bold text-status-warning">px</span>
            </dd>
          </div>
        </dl>
      </div>
    </aside>
  )
}
